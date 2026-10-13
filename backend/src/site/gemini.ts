import { plainText } from "@videosaas/contracts";
import { config } from "../config.ts";
import type { SiteRead } from "./capture.ts";
import { SITE_RULES, SiteUnavailable } from "./rules.ts";

/**
 * Fallback reader: when this server cannot fetch or render the page itself (bot protection, a 4xx from the
 * site, a page that never settles), Gemini reads the public URL with its own URL-context tool and returns
 * the product's words. Only the URL leaves this server. The answer is untrusted text, like any page content:
 * it is capped, flattened to plain text, and never carries screenshots or colours.
 */
export const siteReadModel = process.env.SITE_READ_MODEL || "gemini-2.5-flash";

const clean = (value: unknown, max: number) => (typeof value === "string" ? plainText(value).slice(0, max) : "");

/** What the fallback reader reports about a page: its words, its brand and its relevant pictures. */
export type GeminiPage = {
  title: string; description: string; facts: string[]; text: string;
  brand: { name: string; colors: { primary?: string; accent?: string; background?: string; text?: string; others: string[] }; logoUrl: string | null; fonts: string[] };
  images: { url: string; alt: string }[];
};

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value: unknown) => (typeof value === "string" && HEX.test(value.trim()) ? value.trim().toLowerCase() : undefined);
const httpUrl = (value: unknown) => { try { const url = new URL(String(value)); return /^https?:$/.test(url.protocol) && url.toString().length <= 600 ? url.toString() : null; } catch { return null; } };

/** One call per page per few minutes: the site read and the brand read both need it, and run side by side. */
const inflight = new Map<string, { at: number; page: Promise<GeminiPage> }>();

/** Same page, same key: "https://www.zara.com" and "https://www.zara.com/" must share one call (the site read and the brand read use both spellings). */
const keyOf = (url: string) => { try { const u = new URL(url); return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`; } catch { return url; } };

export function askGemini(rawUrl: string): Promise<GeminiPage> {
  const url = rawUrl, key = keyOf(rawUrl);
  const known = inflight.get(key);
  if (known && Date.now() - known.at < 10 * 60_000) return known.page;
  // One retry: the reader sometimes answers with prose, a truncated object or a transient error.
  const page = fetchPage(url).catch((error: unknown) => (error instanceof SiteUnavailable && /No fallback reader is configured/.test(error.message) ? Promise.reject(error) : fetchPage(url)));
  inflight.set(key, { at: Date.now(), page });
  page.catch(() => inflight.delete(key));
  for (const [key, value] of inflight) if (Date.now() - value.at > 10 * 60_000) inflight.delete(key);
  return page;
}

async function fetchPage(url: string): Promise<GeminiPage> {
  if (!config.geminiApiKey) throw new SiteUnavailable("No fallback reader is configured.");
  const prompt = [
    `Read the public web page ${url} and report only what the page itself shows and says.`,
    "Reply with one JSON object and nothing else, shaped as:",
    '{"title": string, "description": string (one sentence), "facts": string[] (up to 30 short statements the page makes about the product, its offers, prices, guarantees, categories; each under 120 characters, no marketing filler),',
    ' "brand": {"name": string, "colors": {"primary": "#rrggbb" (the brand\'s main colour: its logo, buttons and links), "accent": "#rrggbb" or null, "background": "#rrggbb" (the page background), "text": "#rrggbb" (body text), "others": ["#rrggbb", ...up to 4 more brand colours]}, "logoUrl": string (absolute https URL of the brand\'s own logo image file, SVG or PNG preferred) or null, "fonts": string[] (up to 2 font family names the page uses for headings and body, if you can tell)},',
    ' "images": [{"url": string (absolute https URL of an image file), "alt": string (what it shows, under 80 characters)}] (up to 8 images that show the product itself, its range, people using it or its key features: product photos, feature visuals. Never logos, icons, payment or social badges, flags, avatars, banners about legal terms, cookies, delivery or newsletters. No duplicates or near-duplicates)}',
    "Use only hex colours that appear on the page. Do not add claims, numbers, names or URLs that are not on the page. If the page cannot be opened, reply {\"error\": \"unreadable\"}."
  ].join("\n");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${siteReadModel}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ url_context: {} }], generationConfig: { temperature: 0.1 } })
  });
  if (!response.ok) {
    // Never echo the key: status and the API's own message only.
    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new SiteUnavailable(`The fallback reader failed (${response.status})${detail.error?.message ? `: ${detail.error.message.slice(0, 160)}` : "."}`);
  }
  const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  type Raw = { title?: unknown; description?: unknown; facts?: unknown; text?: unknown; error?: unknown; brand?: { name?: unknown; colors?: Record<string, unknown>; logoUrl?: unknown; fonts?: unknown }; images?: unknown };
  let parsed: Raw;
  try { parsed = JSON.parse(json ?? ""); } catch { throw new SiteUnavailable("The fallback reader returned nothing usable."); }
  if (parsed.error) throw new SiteUnavailable("That website could not be opened by the fallback reader either.");
  const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).map((fact) => clean(fact, 160)).filter((fact) => fact.length >= 3).slice(0, SITE_RULES.factsMax);
  const text = clean(parsed.text, SITE_RULES.textMax);
  const colors = parsed.brand?.colors ?? {};
  const seen = new Set<string>();
  const images = (Array.isArray(parsed.images) ? parsed.images : []).flatMap((entry: { url?: unknown; alt?: unknown }) => {
    const imageUrl = httpUrl(entry?.url);
    const key = imageUrl?.split("?")[0];
    if (!imageUrl || !key || seen.has(key)) return [];
    seen.add(key);
    return [{ url: imageUrl, alt: clean(entry.alt, 80) }];
  }).slice(0, 8);
  return {
    title: clean(parsed.title, 160), description: clean(parsed.description, 300), facts, text,
    brand: {
      name: clean(parsed.brand?.name, 60),
      colors: { primary: hex(colors.primary), accent: hex(colors.accent), background: hex(colors.background), text: hex(colors.text), others: (Array.isArray(colors.others) ? colors.others : []).map(hex).filter((value): value is string => Boolean(value)).slice(0, 4) },
      logoUrl: httpUrl(parsed.brand?.logoUrl),
      fonts: (Array.isArray(parsed.brand?.fonts) ? parsed.brand!.fonts as unknown[] : []).map((font) => clean(font, 60)).filter(Boolean).slice(0, 2)
    },
    images
  };
}

export async function readSiteWithGemini(url: string): Promise<SiteRead> {
  const page = await askGemini(url);
  if (!page.facts.length && page.text.length < 80) throw new SiteUnavailable("The fallback reader found no usable content.");
  return {
    url, title: page.title, description: page.description, facts: page.facts, text: page.text,
    sections: [], colors: [], images: page.images, mode: "html-only",
    warnings: ["This site blocked direct reading, so the facts were read by a fallback reader and there are no screenshots. The pictures listed are the ones the reader found relevant; check them, and upload screenshots to show the product."]
  };
}

export type GeminiBrand = GeminiPage["brand"];
const brandInflight = new Map<string, { at: number; brand: Promise<GeminiBrand> }>();

/**
 * A second, brand-only question for pages where the first read gave no real colour (only black, white or grey) or no logo:
 * what are this brand's signature colours and where is its logo file. It may also look the brand up (Google Search grounding),
 * so the answer is lower confidence than a read of the page itself; the caller marks it so.
 */
export function askGeminiBrand(rawUrl: string): Promise<GeminiBrand> {
  const key = keyOf(rawUrl);
  const known = brandInflight.get(key);
  if (known && Date.now() - known.at < 10 * 60_000) return known.brand;
  const brand = fetchBrand(rawUrl);
  brandInflight.set(key, { at: Date.now(), brand });
  brand.catch(() => brandInflight.delete(key));
  return brand;
}

async function fetchBrand(url: string): Promise<GeminiBrand> {
  if (!config.geminiApiKey) throw new SiteUnavailable("No fallback reader is configured.");
  const prompt = [
    `What does the brand behind ${url} look like? Use the page and, if the page cannot be read, the brand's official site, press kit or brand guidelines.`,
    "Reply with one JSON object and nothing else:",
    '{"name": string, "colors": {"primary": "#rrggbb" (the brand\'s signature colour: the colour of its logo, main buttons or accents; if the brand is genuinely black and white, say so), "accent": "#rrggbb" or null, "background": "#rrggbb" or null, "text": "#rrggbb" or null, "others": ["#rrggbb", ...up to 4]}, "logoUrl": string (absolute https URL of the brand\'s own logo image file: SVG or PNG; not a favicon unless that is all there is) or null, "fonts": string[] (up to 2 font family names)}',
    "Only report colours and URLs you are confident are real. Use null rather than guessing."
  ].join("\n");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${siteReadModel}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ url_context: {} }, { google_search: {} }], generationConfig: { temperature: 0.1 } })
  });
  if (!response.ok) throw new SiteUnavailable(`The fallback reader failed (${response.status}).`);
  const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  let parsed: { name?: unknown; colors?: Record<string, unknown>; logoUrl?: unknown; fonts?: unknown };
  try { parsed = JSON.parse(json ?? ""); } catch { throw new SiteUnavailable("The fallback reader returned nothing usable."); }
  const colors = parsed.colors ?? {};
  return {
    name: clean(parsed.name, 60),
    colors: { primary: hex(colors.primary), accent: hex(colors.accent), background: hex(colors.background), text: hex(colors.text), others: (Array.isArray(colors.others) ? colors.others : []).map(hex).filter((value): value is string => Boolean(value)).slice(0, 4) },
    logoUrl: httpUrl(parsed.logoUrl),
    fonts: (Array.isArray(parsed.fonts) ? parsed.fonts as unknown[] : []).map((font) => clean(font, 60)).filter(Boolean).slice(0, 2)
  };
}
