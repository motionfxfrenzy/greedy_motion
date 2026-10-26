import { access } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { plainText } from "@videosaas/contracts";
import sharp from "sharp";
import { FetchRefused, safeFetch, validateUrl } from "../brand/safe-fetch.ts";
import { inPage, snapshotSection } from "./in-page.ts";
import { readSiteWithGemini } from "./gemini.ts";
import { SITE_RULES, SiteUnavailable } from "./rules.ts";

/**
 * Reads a product website: the product's own words (facts for the director) and, when a browser is
 * available, labelled section screenshots plus a self-contained HTML/CSS snapshot of each section.
 *
 * Security (a browser on a user-supplied URL is a wide SSRF surface):
 * - Chrome never opens a connection itself. Every request is intercepted and answered with
 *   `safeFetch` (http/https GET only, public addresses checked at connect time, so DNS rebinding
 *   fails too); anything that escapes interception (WebSocket, WebRTC, service workers) hits a dead
 *   proxy. Non-GET requests, other schemes, media, websockets and pings are aborted.
 * - Caps: one page, 35 s overall, 600 requests, 40 MB in total, 8 MB per resource, 6 screenshots.
 * - No popups, downloads or dialogs. The page text is untrusted data for the director.
 */
export { SITE_RULES, SiteUnavailable };

export type CapturedSection = { heading: string; png: Buffer; snapshot: string | null };
/** A picture on the page that shows the product (not a logo, icon or banner); fetched safely by the route that stores it. */
export type SiteImage = { url: string; alt: string };
export type SiteRead = {
  url: string;
  title: string;
  description: string;
  facts: string[];
  text: string;
  sections: CapturedSection[];
  mode: "browser" | "html-only";
  /** Saturated colours the rendered page uses on buttons, links, logo and accents (browser mode only). */
  colors: string[];
  /** Relevant product pictures found on the page, best first. */
  images: SiteImage[];
  warnings: string[];
};

/** A Chrome or Chromium binary: CHROME_PATH, the worker image's Chromium, or the HyperFrames cache. */
export async function chromePath(): Promise<string | null> {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  try {
    const base = join(homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
    for (const version of readdirSync(base).sort().reverse()) {
      for (const dir of readdirSync(join(base, version))) candidates.push(join(base, version, dir, "chrome-headless-shell"));
    }
  } catch { /* no cache */ }
  for (const path of candidates) if (path && (await access(path).then(() => true, () => false))) return path;
  return null;
}

// ---------- static HTML (always; the only source when no browser is available) ----------

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const stripTags = (html: string) => plainText(decode(html.replace(/<[^>]+>/g, " ")));

export function readHtml(html: string): Pick<SiteRead, "title" | "description" | "facts" | "text"> {
  const body = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "").slice(0, 160);
  const description = decode(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)["']/i.exec(body)?.[1] ?? "").trim().slice(0, 300);
  const facts: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/<(h1|h2|h3|button|li|a)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const value = stripTags(match[2]);
    const words = value.split(" ").length;
    const keep = /^h/i.test(match[1]) ? words <= 16 : /^li$/i.test(match[1]) ? words >= 3 && words <= 18 : words >= 2 && words <= 5;
    if (keep && value.length >= 3 && !seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); facts.push(value); }
    if (facts.length >= SITE_RULES.factsMax) break;
  }
  const text = stripTags(body.replace(/<\/(p|div|h\d|li|section)>/gi, ". ")).replace(/(\.\s*){2,}/g, ". ").slice(0, SITE_RULES.textMax);
  return { title, description, facts, text };
}

/** Without a browser: the page's own share image (og:image / twitter:image), resolved to an absolute URL. */
function htmlImages(html: string, base: string): SiteImage[] {
  const out: SiteImage[] = [];
  for (const match of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi)) {
    try { const url = new URL(decode(match[1]), base).toString(); if (/^https?:/.test(url) && !/logo|icon|favicon|placeholder/i.test(url) && !out.some((image) => image.url === url)) out.push({ url, alt: "Share image" }); } catch { /* skip */ }
  }
  return out.slice(0, 2);
}

// ---------- browser capture ----------

/** A small grey fingerprint of the top of a screenshot, to tell repeats and blanks from real sections. */
async function fingerprint(png: Buffer) {
  const image = sharp(png);
  const { width = 0, height = 0 } = await image.metadata();
  return image.extract({ left: 0, top: 0, width, height: Math.min(height, 900) }).resize(24, 14, { fit: "fill" }).greyscale().raw().toBuffer();
}

/** Keeps each different-looking section once, in order: drops a screenshot that repeats an earlier one (the hero captured twice,
 *  a banner shown again lower down) and one that is nearly blank. */
export async function distinctShots(sections: CapturedSection[]): Promise<CapturedSection[]> {
  const kept: CapturedSection[] = [];
  const prints: Buffer[] = [];
  const headings: string[] = [];
  for (const section of sections) {
    const heading = section.heading.trim().toLowerCase();
    let print: Buffer;
    try { print = await fingerprint(section.png); } catch { kept.push(section); continue; }
    const mean = print.reduce((sum, v) => sum + v, 0) / print.length;
    const spread = print.reduce((sum, v) => sum + Math.abs(v - mean), 0) / print.length;
    if (spread < 8) continue; // a near-uniform or text-only strip: nothing to show
    const gaps = prints.map((earlier) => earlier.reduce((sum, v, i) => sum + Math.abs(v - print[i]!), 0) / print.length);
    // Repeats: the same picture, or the same heading over a similar picture (a carousel's next slide, the hero shown twice).
    const repeat = gaps.some((gap, index) => gap < 10 || (gap < 32 && headings[index] === heading));
    headings.push(heading);
    if (repeat) continue;
    prints.push(print);
    kept.push(section);
  }
  return kept;
}

const BLOCKED_TYPES = new Set(["media", "websocket", "eventsource", "ping", "cspviolationreport"]);

async function browserRead(chrome: string, url: string): Promise<Omit<SiteRead, "mode" | "warnings"> & { warnings: string[] }> {
  const { default: puppeteer } = await import("puppeteer-core");
  const args = [
    // Anything that is not intercepted below (WebSocket, WebRTC, service workers) goes nowhere.
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-background-networking", "--disable-sync", "--disable-extensions", "--no-first-run", "--mute-audio", "--disable-dev-shm-usage", "--hide-scrollbars",
    ...(process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])
  ];
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args, defaultViewport: { ...SITE_RULES.viewport, deviceScaleFactor: 1 } });
  const warnings: string[] = [];
  try {
    const main = await browser.newPage();
    // One page only: popups and new windows are closed as they open.
    browser.on("targetcreated", (target) => { void target.page().then((page) => (page && page !== main ? page.close() : undefined)).catch(() => undefined); });
    const cdp = await main.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => undefined);
    await main.setBypassServiceWorker(true);
    main.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
    let requests = 0;
    let bytes = 0;
    await main.setRequestInterception(true);
    main.on("request", (request) => {
      void (async () => {
        const target = request.url();
        if (target.startsWith("data:")) return request.continue();
        if (++requests > SITE_RULES.maxRequests || bytes > SITE_RULES.maxBytes) return request.abort("blockedbyclient");
        if (request.method() !== "GET" || !/^https?:\/\//i.test(target) || BLOCKED_TYPES.has(request.resourceType())) return request.abort("blockedbyclient");
        try {
          const response = await safeFetch(target, { maxBytes: SITE_RULES.perResourceBytes, timeoutMs: 8000 });
          bytes += response.body.length;
          return request.respond({ status: response.status || 200, headers: { "content-type": response.contentType || "application/octet-stream", "access-control-allow-origin": "*" }, body: response.body });
        } catch {
          return request.abort("blockedbyclient");
        }
      })().catch(() => undefined);
    });
    // Reduced motion: most sites then show reveal-on-scroll and hero content without waiting for animations.
    await main.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await main.goto(url, { waitUntil: "networkidle2", timeout: SITE_RULES.navigationMs }).catch((error: Error) => {
      if (!/timeout/i.test(error.message)) throw error;
      warnings.push("The site kept loading; captured what had arrived.");
    });
    // Scroll through once so lazy images and reveal-on-scroll sections render, then back to the top.
    await main.evaluate(async () => {
      for (let y = 0; y < Math.min(document.body.scrollHeight, 12000); y += innerHeight * 0.8) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 1200));
    });
    const read = await main.evaluate(inPage, { factsMax: SITE_RULES.factsMax, textMax: SITE_RULES.textMax, minH: SITE_RULES.sectionMinHeight, maxShots: SITE_RULES.maxShots });
    const sections: CapturedSection[] = [];
    const heroCovered = read.sections[0] && read.sections[0].top < 40;
    if (!heroCovered) {
      const png = Buffer.from(await main.screenshot({ type: "png", clip: { x: 0, y: 0, ...SITE_RULES.viewport } }));
      sections.push({ heading: read.title || "Home", png, snapshot: null });
    }
    for (const section of read.sections) {
      if (sections.length >= SITE_RULES.maxShots) break;
      const height = Math.min(section.height, SITE_RULES.sectionMaxHeight);
      const png = Buffer.from(await main.screenshot({ type: "png", captureBeyondViewport: true, clip: { x: 0, y: section.top, width: SITE_RULES.viewport.width, height } }));
      const snapshot = await main.evaluate(snapshotSection, section.index, SITE_RULES.snapshotMaxBytes).catch(() => null);
      sections.push({ heading: section.heading || (section.index === 0 ? read.title || "Home" : `Section ${section.index + 1}`), png, snapshot });
    }
    return { url: main.url(), title: read.title, description: read.description, colors: read.colors, images: read.images, facts: read.facts.map(plainText).filter(Boolean), text: read.text, sections: await distinctShots(sections), warnings };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

let running = 0;

/** Reads `input`: the static HTML always, plus the browser capture when Chrome is available. A site that cannot be read directly falls back to Gemini's URL reader (facts only). */
export async function readSite(input: string): Promise<SiteRead> {
  validateUrl(input);
  try {
    const read = await readSiteDirect(input);
    // A shell page (a single-page app that rendered nothing, a bot wall) is no better than no page.
    if (read.facts.length >= 3 || read.text.length >= 200) return read;
    return await readSiteWithGemini(input).catch(() => read);
  } catch (error) {
    if (error instanceof FetchRefused) throw error;
    try { return await readSiteWithGemini(input); } catch { throw error; }
  }
}

async function readSiteDirect(input: string): Promise<SiteRead> {
  const page = await safeFetch(input, { maxBytes: 3_000_000, timeoutMs: 10_000 });
  if (page.status >= 400) throw new SiteUnavailable(`The site answered ${page.status}.`);
  if (!/html/i.test(page.contentType)) throw new SiteUnavailable("That URL is not a web page.");
  const html = readHtml(page.body.toString("utf8"));
  const chrome = await chromePath();
  if (!chrome) return { url: page.url, ...html, sections: [], colors: [], images: htmlImages(page.body.toString("utf8"), page.url), mode: "html-only", warnings: ["Screenshots are unavailable on this server (no browser); facts come from the page HTML."] };
  if (running >= 2) return { url: page.url, ...html, sections: [], colors: [], images: htmlImages(page.body.toString("utf8"), page.url), mode: "html-only", warnings: ["The site reader is busy; facts come from the page HTML. Try again for screenshots."] };
  running++;
  try {
    const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new SiteUnavailable("Reading the site took too long.")), SITE_RULES.overallMs));
    const read = await Promise.race([browserRead(chrome, page.url), timer]);
    // The rendered page usually has more (single-page apps); keep the static facts it missed.
    const facts = [...new Set([...read.facts, ...html.facts])].slice(0, SITE_RULES.factsMax);
    return { ...read, title: read.title || html.title, description: read.description || html.description, facts, text: read.text.length > html.text.length ? read.text : html.text, mode: "browser" };
  } catch (error) {
    if (error instanceof FetchRefused) throw error;
    return { url: page.url, ...html, sections: [], colors: [], images: htmlImages(page.body.toString("utf8"), page.url), mode: "html-only", warnings: [`Screenshots failed (${error instanceof Error ? error.message : "browser error"}); facts come from the page HTML.`] };
  } finally {
    running--;
  }
}
