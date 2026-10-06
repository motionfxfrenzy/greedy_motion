// Brand kits: types and the brand → theme derivation shared by the frontend (live preview) and backend
// (render theme). Derived themes always meet WCAG contrast for the roles templates use as text.
import type { Theme, ThemeTokens } from "./themes.ts";

export type BrandFontSource = "bundled" | "google" | "upload";
export type BrandFont = { source: BrandFontSource; family: string; assetId?: string };

export type BrandColors = { primary: string; accent?: string; background?: string; text?: string };

export type BrandKitInput = {
  name: string;
  url?: string;
  description?: string;
  colors: BrandColors;
  fonts: { heading: BrandFont; body: BrandFont };
  logoAssetId?: string;
  mode?: "light" | "dark";
};

export type BrandKit = Omit<BrandKitInput, "logoAssetId"> & {
  id: string;
  hasLogo: boolean;
  createdAt: string;
  /** Adjustments made so text stays readable, shown to the user. */
  adjustments: string[];
};

/** Result of reading a product website; every field is a suggestion the user reviews. */
export type BrandExtraction = {
  url: string;
  name?: string;
  description?: string;
  colors: BrandColors & { candidates: string[] };
  fonts: { heading?: BrandFont; body?: BrandFont; candidates: string[]; selfHosted: string[] };
  logo?: { assetId: string; source: string; tone?: "dark" | "light" | "color" };
  notes: string[];
};

/** Fonts bundled in the worker (worker/fonts), usable with no download. */
export const bundledFonts = [
  "Archivo", "Archivo Black", "Barlow", "Bebas Neue", "Bodoni Moda", "DM Mono", "EB Garamond", "Fredoka",
  "Hanken Grotesk", "IBM Plex Mono", "Instrument Serif", "Inter", "JetBrains Mono", "Libre Baskerville",
  "Newsreader", "Playfair Display", "Quicksand", "Shrikhand", "Source Serif 4", "Space Grotesk"
] as const;

export const BRAND_NAME_MAX = 28;
export const FONT_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;

// ---------- color math ----------

type Rgb = [number, number, number];

export function parseColor(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const value = input.trim().toLowerCase();
  let match = /^#([0-9a-f]{3})$/.exec(value);
  if (match) return `#${match[1].split("").map((c) => c + c).join("")}`;
  match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);
  if (match) return `#${match[1]}`;
  match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    if (alpha < 0.9) return undefined;
    return toHex([Number(match[1]), Number(match[2]), Number(match[3])].map((n) => Math.min(255, n)) as Rgb);
  }
  return undefined;
}

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("")}`;

function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

export function mix(a: string, b: string, amount: number) {
  const [ra, rb] = [toRgb(a), toRgb(b)];
  return toHex(ra.map((c, i) => c + (rb[i] - c) * amount) as Rgb);
}

export function saturation(hex: string) {
  const [r, g, b] = toRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** Moves a color toward black or white until it reaches `target` contrast against every background. */
function readableOn(color: string, backgrounds: string[], target: number) {
  const towardDark = luminance(backgrounds[0]) > 0.4;
  const end = towardDark ? "#000000" : "#ffffff";
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, end, step * 0.05);
    if (backgrounds.every((bg) => contrast(candidate, bg) >= target)) return candidate;
  }
  return end;
}

// ---------- brand → theme ----------

const fontStack = (font: BrandFont, fallback: string) => {
  const family = font.source === "upload" ? uploadedFamily(font) : font.family;
  return `"${family}", ${fallback}`;
};

/** Uploaded fonts get an internal family name so the user's file name never reaches CSS. */
export function uploadedFamily(font: BrandFont) {
  return `Brand ${font.assetId?.slice(0, 8) ?? "Font"}`;
}

export function deriveBrandTheme(kit: Pick<BrandKitInput, "name" | "colors" | "fonts" | "mode">, id = "brand"): { theme: Theme; adjustments: string[] } {
  const adjustments: string[] = [];
  const primary = parseColor(kit.colors.primary) ?? "#1d4ed8";
  const accent = parseColor(kit.colors.accent) ?? primary;
  let bg = parseColor(kit.colors.background);
  const mode = kit.mode ?? (bg && luminance(bg) < 0.2 ? "dark" : "light");
  if (!bg) bg = mode === "dark" ? mix("#0b0b0f", primary, 0.08) : mix("#ffffff", primary, 0.04);

  const textWanted = parseColor(kit.colors.text);
  let fg = textWanted && contrast(textWanted, bg) >= 7 ? textWanted : (luminance(bg) > 0.4 ? "#111318" : "#f5f5f7");
  if (textWanted && fg !== textWanted) adjustments.push(`Text color ${textWanted} was not readable on the background; using ${fg}.`);

  const surface = mix(bg, fg, 0.05);
  const border = mix(bg, fg, 0.16);
  // --brand is used as text on bg/surface and as a fill behind bg-colored text (CTA pill): needs 4.5:1 both ways.
  const brand = readableOn(primary, [bg, surface], 4.5);
  if (brand !== primary) adjustments.push(`Primary ${primary} was adjusted to ${brand} so text in your brand color stays readable.`);
  const muted = readableOn(mix(fg, bg, 0.45), [bg, surface], 4.5);
  if (contrast(fg, bg) < 7) fg = readableOn(fg, [bg, surface], 7);

  const tokens: ThemeTokens = {
    bg, fg, muted, surface, border, brand, accent, accent2: mix(accent, fg, 0.35),
    fontDisplay: fontStack(kit.fonts.heading, "Inter, Arial, sans-serif"),
    fontBody: fontStack(kit.fonts.body, "Inter, Arial, sans-serif"),
    fontMono: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    radius: "1.2cqmin", space1: "1.2cqmin", space2: "2.4cqmin", space3: "4cqmin",
    durBeat: "0.4s", easeStandard: "cubic-bezier(0.215, 0.61, 0.355, 1)", easeEmphasis: "cubic-bezier(0.19, 1, 0.22, 1)"
  };
  return {
    theme: { id, name: `${kit.name} brand`, description: "Derived from your brand kit.", mode, source: "brand", tokens },
    adjustments
  };
}
