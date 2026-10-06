// Google Fonts lookup and download (fixed host, Latin subset, woff2). Fonts are stored with the brand kit
// so the network-blocked worker never fetches them at render time.
import { FONT_FAMILY_PATTERN } from "@videosaas/contracts";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
export type DownloadedFace = { weight: number; data: Buffer; unicodeRange?: string };

async function googleCss(family: string, weights?: number[]) {
  const name = family.trim().replace(/ /g, "+");
  const query = weights ? `${name}:wght@${weights.join(";")}` : name;
  const response = await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=block`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) });
  return response.ok ? await response.text() : null;
}

/** True when Google Fonts serves this family. */
export async function isGoogleFont(family: string) {
  if (!FONT_FAMILY_PATTERN.test(family)) return false;
  return (await googleCss(family)) !== null;
}

export async function downloadGoogleFont(family: string): Promise<DownloadedFace[]> {
  if (!FONT_FAMILY_PATTERN.test(family)) throw new Error("Font names may contain letters, numbers, and spaces only.");
  // Prefer regular + bold; single-weight families only offer their one weight.
  const css = (await googleCss(family, [400, 700])) ?? (await googleCss(family));
  if (!css) throw new Error(`"${family}" is not available on Google Fonts. Upload the font files instead.`);
  const faces: DownloadedFace[] = [];
  for (const match of css.matchAll(/\/\* latin \*\/\s*@font-face\s*{([^}]*)}/g)) {
    const block = match[1];
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(block)?.[1];
    if (!url) continue;
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) continue;
    faces.push({
      weight: Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400),
      data: Buffer.from(await response.arrayBuffer()),
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(block)?.[1]
    });
  }
  if (faces.length === 0) throw new Error(`Could not download "${family}" from Google Fonts.`);
  return faces;
}
