// Reads a product website and suggests a brand kit: name, description, colors, fonts, and logo.
// Everything here is a suggestion for the user to review; nothing is saved until they confirm.
import { bundledFonts, parseColor, saturation, type BrandExtraction, type BrandFont } from "@videosaas/contracts";
import { stageLogo } from "./assets.ts";
import { isGoogleFont } from "./fonts.ts";
import { askGemini, askGeminiBrand, type GeminiBrand } from "../site/gemini.ts";
import { FetchRefused, safeFetch, validateUrl } from "./safe-fetch.ts";

const GENERIC_FONTS = new Set([
  "inherit", "initial", "unset", "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif",
  "ui-monospace", "ui-rounded", "-apple-system", "blinkmacsystemfont", "segoe ui", "segoe ui emoji", "segoe ui symbol", "apple color emoji",
  "noto color emoji", "helvetica", "helvetica neue", "arial", "roboto", "oxygen", "ubuntu", "cantarell", "fira sans", "droid sans",
  "noto sans", "times new roman", "times", "georgia", "courier new", "courier", "menlo", "monaco", "consolas", "sfmono-regular", "liberation mono", "emoji"
]);

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((v) => v !== undefined);
const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];

function meta(html: string, key: string) {
  for (const tag of tags(html, "meta")) {
    const id = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (id === key) return decode(attr(tag, "content") ?? "").trim() || undefined;
  }
  return undefined;
}

/**
 * The product's name from a site name or page title: "Resend · Email for developers" → "Resend".
 * Splits on · | – — : - and prefers the part that matches the domain, else the first part.
 */
export function brandNameFrom(raw: string | undefined, hostname: string): string | undefined {
  const parts = (raw ?? "").split(/\s*[·•|–—]\s*|\s+-\s+|:\s+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const domain = hostname.replace(/^www\./, "").split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = parts.find((part) => domain && (squash(part) === domain || squash(part).startsWith(domain) || domain.startsWith(squash(part)) && squash(part).length >= 3));
  return (match ?? parts[0]).slice(0, 28) || undefined;
}

function firstFamily(value: string) {
  for (const part of value.split(",")) {
    const family = part.trim().replace(/^["']|["']$/g, "").trim();
    if (family && !family.startsWith("var(") && !GENERIC_FONTS.has(family.toLowerCase())) return family;
  }
  return undefined;
}

function rankColors(css: string, html: string) {
  const scores = new Map<string, number>();
  const add = (raw: string | undefined, weight: number) => {
    const color = parseColor(raw);
    if (!color || saturation(color) < 0.2) return; // greys, black, white are not brand colors
    // Pale tints are usually backgrounds or highlights, not the brand color itself.
    const lightness = (Math.max(...[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))) + Math.min(...[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)))) / 510;
    scores.set(color, (scores.get(color) ?? 0) + weight * (lightness > 0.82 ? 0.25 : 1));
  };
  add(meta(html, "theme-color"), 40);
  add(meta(html, "msapplication-tilecolor"), 20);
  for (const match of css.matchAll(/--[\w-]*(primary|brand|accent|main|secondary)[\w-]*\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi)) add(match[2], /secondary/i.test(match[1]) ? 6 : 15);
  for (const match of css.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+[^)]*\)/gi)) add(match[0], 1);
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
}

function bodyColor(css: string, property: "background" | "color") {
  for (const match of css.matchAll(/(?:^|[},\s])(?:html|body|:root)\s*{([^}]*)}/gi)) {
    const rule = property === "background" ? /background(?:-color)?\s*:\s*([^;}\s]+)/i : /(?:^|;|\s)color\s*:\s*([^;}\s]+)/i;
    const value = parseColor(rule.exec(match[1])?.[1]);
    if (value) return value;
  }
  return undefined;
}

async function absoluteLinks(html: string, base: URL, predicate: (tag: string) => boolean) {
  return tags(html, "link").filter(predicate).map((tag) => attr(tag, "href")).filter((href): href is string => Boolean(href)).map((href) => new URL(decode(href), base).toString());
}

async function extractBrandDirect(input: string, ownerId?: string): Promise<BrandExtraction> {
  const notes: string[] = [];
  const page = await safeFetch(validateUrl(input).toString(), { maxBytes: 2_000_000 });
  if (page.status >= 400) throw new Error(`The site returned HTTP ${page.status}.`);
  if (!/html/i.test(page.contentType)) throw new Error("That URL is not a web page.");
  const base = new URL(page.url);
  const html = page.body.toString("utf8");

  // Stylesheets: inline <style>, style attributes, and up to five linked sheets.
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const styleAttrs = [...html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(";\n");
  const sheetUrls = (await absoluteLinks(html, base, (tag) => /\brel\s*=\s*["']?stylesheet/i.test(tag))).filter((href) => !href.includes("fonts.googleapis.com")).slice(0, 5);
  const sheets = await Promise.all(sheetUrls.map((href) => safeFetch(href, { maxBytes: 1_500_000, timeoutMs: 6_000 }).then((r) => (r.status < 400 ? r.body.toString("utf8") : ""), () => "")));
  if (sheetUrls.length && sheets.every((sheet) => !sheet)) notes.push("Linked stylesheets could not be read; colors come from the page itself.");
  const css = [inline, styleAttrs, ...sheets].join("\n").slice(0, 4_000_000);

  // Name and description
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const name = brandNameFrom(meta(html, "og:site_name") ?? meta(html, "application-name") ?? title, base.hostname);
  const description = (meta(html, "description") ?? meta(html, "og:description"))?.slice(0, 300);

  // Colors
  const candidates = rankColors(css, html).slice(0, 8);
  if (candidates.length === 0) notes.push("No distinctive brand color was found; choose one manually.");
  const background = bodyColor(css, "background");
  const text = bodyColor(css, "color");

  // Fonts
  const googleFamilies = new Set<string>();
  for (const href of await absoluteLinks(html, base, (tag) => /fonts\.googleapis\.com/i.test(tag))) {
    for (const family of new URL(href).searchParams.getAll("family")) googleFamilies.add(family.split(":")[0].replace(/\+/g, " "));
  }
  for (const match of css.matchAll(/@import\s+url\(["']?(https:\/\/fonts\.googleapis\.com[^"')]+)/gi)) {
    for (const family of new URL(match[1]).searchParams.getAll("family")) googleFamilies.add(family.split(":")[0].replace(/\+/g, " "));
  }
  const selfHosted = new Set([...css.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*([^;}]+)/gi)].map((m) => firstFamily(m[1])).filter((f): f is string => Boolean(f)));
  const usage = new Map<string, number>();
  let headingFamily: string | undefined;
  let bodyFamily: string | undefined;
  for (const match of css.matchAll(/([^{}]+){[^}]*font-family\s*:\s*([^;}]+)/gi)) {
    const family = firstFamily(match[2]);
    if (!family) continue;
    usage.set(family, (usage.get(family) ?? 0) + 1);
    const selector = match[1].toLowerCase();
    if (!headingFamily && /\bh1\b|\bh2\b|heading|display|title/.test(selector)) headingFamily = family;
    if (!bodyFamily && /(^|[\s,])(body|html|:root)\b/.test(selector)) bodyFamily = family;
  }
  const ranked = [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
  const fontCandidates = [...new Set([...googleFamilies, ...ranked])].slice(0, 8);
  bodyFamily ??= ranked[0] ?? [...googleFamilies][0];
  headingFamily ??= ranked.find((family) => family !== bodyFamily) ?? bodyFamily;

  const resolveFont = async (family: string | undefined): Promise<BrandFont | undefined> => {
    if (!family) return undefined;
    const bundled = bundledFonts.find((item) => item.toLowerCase() === family.toLowerCase());
    if (bundled) return { source: "bundled", family: bundled };
    if (googleFamilies.has(family) || (await isGoogleFont(family))) return { source: "google", family };
    return undefined;
  };
  const heading = await resolveFont(headingFamily);
  const body = await resolveFont(bodyFamily);
  const custom = [...selfHosted].filter((family) => !bundledFonts.some((item) => item.toLowerCase() === family.toLowerCase()) && !googleFamilies.has(family));
  if ((headingFamily && !heading) || (bodyFamily && !body)) {
    notes.push(`The site uses a self-hosted font (${[...new Set([headingFamily, bodyFamily].filter(Boolean))].join(", ")}). Upload your licensed font files, or pick the closest Google font.`);
  }

  // Logo, most to least reliable. Customer-logo walls also say "logo", so the site's own header and name win.
  const brandWord = (name ?? base.hostname.replace(/^www\./, "").split(".")[0]).toLowerCase();
  const headerHtml = [/<header\b[\s\S]*?<\/header>/i.exec(html)?.[0], /<nav\b[\s\S]*?<\/nav>/i.exec(html)?.[0]].filter(Boolean).join("\n") || html.slice(0, 40_000);
  const imgText = (tag: string) => `${attr(tag, "class") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "src") ?? ""} ${attr(tag, "id") ?? ""}`.toLowerCase();
  // The strongest signal: the image or SVG inside the header link that points to the home page.
  const homeHref = new RegExp(`<a\\b[^>]*href\\s*=\\s*["'](?:/|${base.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?)(?:["'?#])[^>]*>([\\s\\S]*?)</a>`, "gi");
  const homeLinks = [...headerHtml.matchAll(homeHref)].map((m) => m[1]).join("\n");
  const homeImgs = tags(homeLinks, "img").map((tag) => attr(tag, "src"));
  const headerImgs = tags(headerHtml, "img").filter((tag) => imgText(tag).includes(brandWord) || imgText(tag).includes("logo")).map((tag) => attr(tag, "src"));
  // Inline <svg> logos: rasterized by sharp (scripts never run); currentColor becomes the page text color.
  const svgsIn = (fragment: string) => [...fragment.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map((m) => m[0]).filter((svg) => svg.length < 200_000);
  const homeSvgs = svgsIn(homeLinks).slice(0, 2);
  const headerSvgs = svgsIn(headerHtml).filter((svg) => !homeSvgs.includes(svg) && (/logo/i.test(svg.slice(0, 600)) || svg.toLowerCase().slice(0, 600).includes(brandWord))).slice(0, 2);
  const iconTags = tags(html, "link").filter((tag) => /\brel\s*=\s*["']?[^"'>]*icon/i.test(tag));
  const sizeOf = (tag: string) => Number((attr(tag, "sizes") ?? "").split("x")[0]) || (/\.svg(\?|$)/i.test(attr(tag, "href") ?? "") ? 512 : 0);
  const iconUrls = iconTags.sort((a, b) => sizeOf(b) - sizeOf(a)).filter((tag) => sizeOf(tag) >= 96 || /apple-touch/i.test(tag)).map((tag) => attr(tag, "href"));
  const namedImgs = tags(html, "img").filter((tag) => imgText(tag).includes(brandWord)).map((tag) => attr(tag, "src"));

  type Candidate = { kind: "url"; href: string; label: string } | { kind: "svg"; markup: string; label: string };
  const urls = (list: (string | undefined)[], label: string) => list.filter(Boolean).map((href) => ({ kind: "url" as const, href: href!, label }));
  const svgs = (list: string[], label: string) => list.map((markup) => ({ kind: "svg" as const, markup, label }));
  const logoCandidates: Candidate[] = [
    ...urls(homeImgs, "home-link logo"),
    ...svgs(homeSvgs, "home-link logo (inline SVG)"),
    ...urls(headerImgs, "header logo"),
    ...svgs(headerSvgs, "header logo (inline SVG)"),
    ...urls(iconUrls, "app icon"),
    ...urls(namedImgs, "image named after the brand")
  ].filter((c) => c.kind === "svg" || !c.href.startsWith("data:")).slice(0, 8);
  let logo: BrandExtraction["logo"];
  for (const candidate of logoCandidates) {
    try {
      let bytes: Buffer;
      let source: string;
      if (candidate.kind === "svg") {
        let markup = candidate.markup.replace(/currentColor/g, text ?? "#111111");
        if (!/xmlns=/.test(markup)) markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
        bytes = Buffer.from(markup);
        source = `${base.origin} (${candidate.label})`;
      } else {
        source = new URL(decode(candidate.href), base).toString();
        const response = await safeFetch(source, { maxBytes: 5_000_000, timeoutMs: 6_000 });
        if (response.status >= 400) continue;
        bytes = response.body;
      }
      const asset = await stageLogo(bytes, ownerId);
      logo = { assetId: asset.assetId, source: candidate.kind === "svg" ? source : `${source} (${candidate.label})`, tone: asset.tone };
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!logo) notes.push("No usable logo was found; upload one.");

  return {
    url: base.toString(),
    name,
    description,
    colors: { primary: candidates[0] ?? "", accent: candidates[1], background, text, candidates },
    fonts: { heading, body, candidates: fontCandidates, selfHosted: custom },
    logo,
    notes
  };
}

const LOW = "Read by a fallback reader (lower confidence): check the colours, fonts and logo before saving.";

/**
 * The brand as the fallback reader (Gemini, reading the public page) reports it, for sites this server cannot read itself
 * (bot walls, 4xx, pages that render nothing) or whose colours or logo it could not find. Everything it returns is untrusted:
 * colours must be hex, the logo is fetched through the same SSRF-safe client and re-encoded, fonts must be bundled or Google fonts.
 */
async function brandFromFallback(input: string, ownerId?: string): Promise<BrandExtraction> {
  const url = validateUrl(input).toString();
  const origin = new URL(url).origin;
  const page = await askGemini(url).catch(() => null);
  let brand: GeminiBrand | null = page?.brand ?? null;
  // A real brand look needs a real colour and a logo. If the page read gave only black, white or grey, or no logo, ask the brand-only question.
  const colourful = (b: GeminiBrand | null) => Boolean(b && [b.colors.primary, b.colors.accent, ...b.colors.others].some((value) => value && saturation(value) > 0.25));
  if (!colourful(brand) || !brand?.logoUrl) {
    const more = await askGeminiBrand(url).catch(() => null);
    if (more) {
      const first = brand;
      brand = {
        name: first?.name || more.name,
        // The brand-only answer wins on colour when it found a real one; otherwise the page's own palette stays.
        colors: colourful(more) || !first ? more.colors : first.colors,
        logoUrl: first?.logoUrl ?? more.logoUrl,
        fonts: first?.fonts.length ? first.fonts : more.fonts
      };
    }
  }
  if (!brand && !page) throw new Error("The fallback reader could not read this site.");
  const c = brand?.colors ?? { others: [] as string[] };
  const candidates = [...new Set([c.primary, c.accent, ...c.others, c.background, c.text].filter((value): value is string => Boolean(value)))].slice(0, 8);
  const notes = [LOW];
  const stage = async (href: string, label: string) => {
    try {
      const response = await safeFetch(href, { maxBytes: 5_000_000, timeoutMs: 6_000 });
      if (response.status >= 400 || !/image|svg|octet/i.test(response.contentType || "image")) return undefined;
      const asset = await stageLogo(response.body, ownerId);
      return { assetId: asset.assetId, source: `${href} (${label})`, tone: asset.tone } as BrandExtraction["logo"];
    } catch { return undefined; }
  };
  let logo: BrandExtraction["logo"];
  if (brand?.logoUrl) logo = await stage(brand.logoUrl, "found by the fallback reader");
  // Static icon files are often served even when the page is not: try the site's own, then a favicon service as the last resort.
  if (!logo) for (const path of ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/favicon.svg", "/icon.png", "/favicon.ico"]) { logo = await stage(`${origin}${path}`, "site icon"); if (logo) break; }
  if (!logo) logo = await stage(`https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`, "favicon");
  if (!logo) notes.push("No usable logo was found; upload one.");
  else if (/icon|favicon/.test(logo.source)) notes.push("The logo is the site's icon (its full logo file could not be found): replace it with your logo if you have one.");
  const font = async (family: string | undefined): Promise<BrandFont | undefined> => {
    if (!family) return undefined;
    const bundled = bundledFonts.find((item) => item.toLowerCase() === family.toLowerCase());
    if (bundled) return { source: "bundled", family: bundled };
    return (await isGoogleFont(family)) ? { source: "google", family } : undefined;
  };
  const fonts = brand?.fonts ?? [];
  const [heading, body] = await Promise.all([font(fonts[0]), font(fonts[1] ?? fonts[0])]);
  if (!candidates.length) notes.push("No brand colour was found; choose one manually.");
  else if (!candidates.some((value) => saturation(value) > 0.25)) notes.push("Only black, white or grey were found: pick the brand's accent colour if it has one.");
  return {
    url, name: brand?.name || page?.title.split(/[|·–—-]/)[0]?.trim() || undefined, description: page?.description || undefined,
    colors: { primary: c.primary ?? candidates[0] ?? "", accent: c.accent ?? candidates[1], background: c.background, text: c.text, candidates },
    fonts: { heading, body, candidates: fonts, selfHosted: [] },
    logo, notes
  };
}

/**
 * Suggests a brand kit for a site. The page's own CSS and markup come first (precise); when this server cannot read the
 * page, or the read found no colour or no logo, the fallback reader fills the gap and the kit says so.
 */
export async function extractBrand(input: string, ownerId?: string): Promise<BrandExtraction> {
  let direct: BrandExtraction | null = null;
  let failure: unknown;
  try { direct = await extractBrandDirect(input, ownerId); } catch (error) { if (error instanceof FetchRefused) throw error; failure = error; }
  const neutralOnly = (b: BrandExtraction) => b.colors.candidates.length > 0 && b.colors.candidates.every((value) => saturation(value) <= 0.25);
  if (direct && direct.colors.primary && direct.logo && !neutralOnly(direct)) return direct;
  const fallback = await brandFromFallback(input, ownerId).catch(() => null);
  if (!direct) { if (fallback) return fallback; throw failure; }
  if (!fallback) return direct;
  if ((!direct.colors.primary || neutralOnly(direct)) && fallback.colors.primary && !neutralOnly(fallback)) {
    direct.colors = { ...direct.colors, primary: fallback.colors.primary, accent: direct.colors.accent ?? fallback.colors.accent, background: direct.colors.background ?? fallback.colors.background, text: direct.colors.text ?? fallback.colors.text, candidates: fallback.colors.candidates };
    direct.notes = direct.notes.filter((note) => !/No distinctive brand colo/.test(note));
    direct.notes.push("The colours were read by a fallback reader (lower confidence): check them before saving.");
  }
  if (!direct.logo && fallback.logo) {
    direct.logo = fallback.logo;
    direct.notes = direct.notes.filter((note) => note !== "No usable logo was found; upload one.");
    direct.notes.push("The logo was found by a fallback reader (lower confidence): check it before saving.");
  }
  return direct;
}
