import { join } from "node:path";
import sharp from "sharp";
import { deriveBrandTheme, type BrandKit, type BrandLogoVariant } from "@videosaas/contracts";
import { config } from "../config.ts";
import { ensureMedia, readMedia } from "../media.ts";
import { logoTone } from "./assets.ts";

/**
 * Which logo version a scene uses, so each one is used where it works:
 *  - lockup (the closing title / CTA, big and centred): the main logo when it already spells the name (a wide
 *    lockup); otherwise the wordmark, which does; otherwise the main logo (an icon, shown with the name beside it);
 *    a kit with no main logo falls back to its wordmark, mark, then silhouette.
 *  - bug (a small corner mark on content scenes, only when the kit has one): the logo mark, else the silhouette.
 * A one-colour logo that would vanish on the theme's background is inverted; a silhouette is drawn in the theme's
 * text colour, so it reads on any scene.
 */
export type SceneLogo = { data: Buffer; variant: "main" | BrandLogoVariant; /** The artwork already spells the brand name. */ spellsName: boolean };
export type LogoRole = "lockup" | "bug";

const WIDE = 2.2;
const fileFor = (brand: Pick<BrandKit, "id">, variant: "main" | BrandLogoVariant) => join(config.brandsDir, brand.id, variant === "main" ? "logo.png" : `logo-${variant}.png`);

async function load(brand: BrandKit, variant: "main" | BrandLogoVariant): Promise<{ data: Buffer; ratio: number } | null> {
  if (variant === "main" ? !brand.hasLogo : !brand.logoVariants?.includes(variant)) return null;
  const path = fileFor(brand, variant);
  if (!(await ensureMedia(path))) return null;
  const data = await readMedia(path).catch(() => null);
  if (!data) return null;
  const meta = await sharp(data).metadata().catch(() => null);
  return meta?.width && meta.height ? { data, ratio: meta.width / meta.height } : null;
}

/** Makes a variant readable on the theme: a silhouette takes the text colour, a vanishing one-colour logo is inverted. */
async function themed(brand: BrandKit, variant: "main" | BrandLogoVariant, data: Buffer): Promise<Buffer> {
  const { theme } = deriveBrandTheme(brand, `brand-${brand.id}`);
  if (variant === "silhouette") {
    const { fg } = theme.tokens;
    const { width = 1, height = 1 } = await sharp(data).metadata();
    const alpha = await sharp(data).ensureAlpha().extractChannel(3).toBuffer();
    return sharp({ create: { width, height, channels: 3, background: fg } }).joinChannel(alpha).png().toBuffer();
  }
  // The main logo was already inverted for the theme when the kit was saved.
  if (variant === "main") return data;
  const tone = await logoTone(data);
  const vanishes = (tone === "dark" && theme.mode === "dark") || (tone === "light" && theme.mode === "light");
  return vanishes ? sharp(data).negate({ alpha: false }).png().toBuffer() : data;
}

export async function sceneLogo(brand: BrandKit, role: LogoRole): Promise<SceneLogo | null> {
  const order: ("main" | BrandLogoVariant)[] = [];
  if (role === "bug") order.push("mark", "silhouette");
  else {
    const main = await load(brand, "main");
    if (main && main.ratio > WIDE) order.push("main", "wordmark", "mark", "silhouette");
    else order.push("wordmark", "main", "mark", "silhouette");
  }
  for (const variant of order) {
    const found = await load(brand, variant);
    if (!found) continue;
    const spellsName = variant === "wordmark" || (variant === "main" && found.ratio > WIDE);
    return { data: await themed(brand, variant, found.data), variant, spellsName };
  }
  return null;
}
