// Brand-kit store. Metadata lives in Postgres (app.brand_kits); the files the renderer reads are kept in
// R2 (media.ts) and cached on disk at <brandsDir>/<id>/ (shared read-only with the worker at /brands locally):
//   logo.png     normalized logo (optional)
//   theme.css    18-token theme derived from the brand colors and fonts
//   fonts.css    @font-face rules for downloaded or uploaded fonts, relative to brand-fonts/
//   fonts/       font files
import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BRAND_NAME_MAX, FONT_FAMILY_PATTERN, bundledFonts, deriveBrandTheme, parseColor, themeToCss, uploadedFamily,
  type BrandFont, type BrandKit, type BrandKitInput
} from "@videosaas/contracts";
import { config } from "../config.ts";
import { query } from "../db/database.ts";
import sharp from "sharp";
import { ensureMedia, ensureMediaDir, persistMedia, removeMedia } from "../media.ts";
import { readStaged } from "./assets.ts";
import { downloadGoogleFont } from "./fonts.ts";

const BRAND_ID = /^[0-9a-f-]{36}$/;
const brandDir = (id: string) => join(config.brandsDir, id);

export class BrandInvalid extends Error {}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanFont(value: unknown, role: string): BrandFont {
  const font = value as Partial<BrandFont> | undefined;
  const source = font?.source;
  const family = cleanText(font?.family, 40);
  if (source === "bundled" && bundledFonts.includes(family as (typeof bundledFonts)[number])) return { source, family };
  if (source === "google" && FONT_FAMILY_PATTERN.test(family)) return { source, family };
  if (source === "upload" && typeof font?.assetId === "string") return { source, family: family || `${role} font`, assetId: font.assetId };
  throw new BrandInvalid(`Choose a valid ${role} font.`);
}

export function validateBrandInput(body: unknown): BrandKitInput {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = cleanText(input.name, BRAND_NAME_MAX);
  if (!name) throw new BrandInvalid("Brand name is required.");
  const colors = (input.colors ?? {}) as Record<string, unknown>;
  const primary = parseColor(String(colors.primary ?? ""));
  if (!primary) throw new BrandInvalid("A primary brand color is required (hex, e.g. #635BFF).");
  const optional = (key: string) => {
    const raw = colors[key];
    if (raw === undefined || raw === null || raw === "") return undefined;
    const value = parseColor(String(raw));
    if (!value) throw new BrandInvalid(`${key} must be a hex color.`);
    return value;
  };
  const fonts = (input.fonts ?? {}) as Record<string, unknown>;
  const url = cleanText(input.url, 200);
  return {
    name,
    ...(url ? { url } : {}),
    ...(cleanText(input.description, 300) ? { description: cleanText(input.description, 300) } : {}),
    colors: { primary, accent: optional("accent"), background: optional("background"), text: optional("text") },
    fonts: { heading: cleanFont(fonts.heading, "heading"), body: cleanFont(fonts.body, "body") },
    ...(typeof input.logoAssetId === "string" && input.logoAssetId ? { logoAssetId: input.logoAssetId } : {}),
    ...(input.mode === "light" || input.mode === "dark" ? { mode: input.mode } : {})
  };
}

/** Writes font files for non-bundled fonts and returns the @font-face rules. */
async function materializeFont(dir: string, font: BrandFont, ownerId?: string): Promise<string[]> {
  if (font.source === "bundled") return [];
  await mkdir(join(dir, "fonts"), { recursive: true });
  const slug = font.family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (font.source === "google") {
    const faces = await downloadGoogleFont(font.family);
    const rules: string[] = [];
    for (const face of faces) {
      const file = `${slug}-${face.weight}.woff2`;
      await writeFile(join(dir, "fonts", file), face.data);
      rules.push(`@font-face { font-family: "${font.family}"; font-weight: ${face.weight}; font-display: block; src: url("brand-fonts/${file}") format("woff2");${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ""} }`);
    }
    return rules;
  }
  const { meta, data } = await readStaged(font.assetId!, "font", ownerId);
  const family = uploadedFamily(font);
  const file = `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${meta.format}`;
  await writeFile(join(dir, "fonts", file), data);
  const format = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype", png: "" }[meta.format];
  // One uploaded file covers every weight the templates ask for.
  return [`@font-face { font-family: "${family}"; font-weight: 100 900; font-display: block; src: url("brand-fonts/${file}") format("${format}"); }`];
}

export async function createBrand(input: BrandKitInput, ownerId: string): Promise<BrandKit> {
  const id = randomUUID();
  const dir = brandDir(id);
  await mkdir(dir, { recursive: true });
  try {
    let hasLogo = false;
    const { theme, adjustments } = deriveBrandTheme(input, `brand-${id}`);
    if (input.logoAssetId) {
      const { data, meta } = await readStaged(input.logoAssetId, "logo", ownerId);
      await writeFile(join(dir, "logo-original.png"), data);
      // A one-color logo that matches the background would vanish: store an inverted copy for this theme.
      const vanishes = (meta.tone === "dark" && theme.mode === "dark") || (meta.tone === "light" && theme.mode === "light");
      if (vanishes) adjustments.push(`Your ${meta.tone} logo was inverted so it shows on the ${theme.mode} background.`);
      if (meta.tone === "color" && theme.mode === "dark") adjustments.push("Your logo is multicolor and kept as is; check it reads well on the dark background.");
      await writeFile(join(dir, "logo.png"), vanishes ? await sharp(data).negate({ alpha: false }).png().toBuffer() : data);
      hasLogo = true;
    }
    const fontRules = [
      ...(await materializeFont(dir, input.fonts.heading, ownerId)),
      ...(input.fonts.body.family === input.fonts.heading.family && input.fonts.body.source === input.fonts.heading.source ? [] : await materializeFont(dir, input.fonts.body, ownerId))
    ];
    await writeFile(join(dir, "fonts.css"), `${fontRules.join("\n")}\n`);
    await writeFile(join(dir, "theme.css"), themeToCss(theme));
    await persistMedia(dir);
    const { logoAssetId: _logo, ...rest } = input;
    const kit: BrandKit = { ...rest, id, ownerId, hasLogo, adjustments, createdAt: new Date().toISOString() };
    await query("insert into app.brand_kits (id, owner_id, name, data, created_at) values ($1, $2, $3, $4, $5)", [id, ownerId, kit.name, kit, kit.createdAt]);
    return kit;
  } catch (error) {
    await removeMedia(dir).catch(() => rm(dir, { recursive: true, force: true }));
    throw error;
  }
}

/**
 * The kit row in Postgres is the source of truth for a brand (colours, fonts, mode). The files beside it are
 * derived from that row, so when they are missing (a fresh volume, another replica) they are rebuilt here
 * instead of the brand silently dropping out of a video: theme.css always, fonts.css and Google font files
 * by downloading them again. Only an uploaded font and the logo cannot be rebuilt; they are reported.
 */
export async function restoreBrandFiles(kit: BrandKit): Promise<{ restored: string[]; missing: string[] }> {
  const dir = brandDir(kit.id);
  await ensureMediaDir(dir);
  const exists = (file: string) => access(join(dir, file)).then(() => true, () => false);
  const restored: string[] = [];
  const missing: string[] = [];
  if (!(await exists("theme.css"))) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "theme.css"), themeToCss(deriveBrandTheme(kit, `brand-${kit.id}`).theme));
    restored.push("theme.css");
  }
  if (!(await exists("fonts.css"))) {
    const sameFace = kit.fonts.body.family === kit.fonts.heading.family && kit.fonts.body.source === kit.fonts.heading.source;
    const faces = sameFace ? [kit.fonts.heading] : [kit.fonts.heading, kit.fonts.body];
    if (faces.some((font) => font.source === "upload")) missing.push("uploaded font");
    else {
      const rules: string[] = [];
      for (const font of faces) rules.push(...(await materializeFont(dir, font)));
      await writeFile(join(dir, "fonts.css"), `${rules.join("\n")}\n`);
      restored.push("fonts.css");
    }
  }
  if (kit.hasLogo && !(await exists("logo.png"))) missing.push("logo");
  if (restored.length) await persistMedia(dir);
  return { restored, missing };
}

export async function getBrand(id: string): Promise<BrandKit | null> {
  if (!BRAND_ID.test(id)) return null;
  const { rows } = await query<{ data: BrandKit }>("select data from app.brand_kits where id = $1", [id]);
  return rows[0]?.data ?? null;
}

export const brandOwner = (kit: Pick<BrandKit, "ownerId">) => kit.ownerId ?? config.legacyOwnerId;

export async function listBrands(ownerId?: string): Promise<BrandKit[]> {
  const { rows } = ownerId === undefined
    ? await query<{ data: BrandKit }>("select data from app.brand_kits order by created_at desc")
    : await query<{ data: BrandKit }>(
        "select data from app.brand_kits where owner_id = $1 or (owner_id is null and $1 = $2) order by created_at desc",
        [ownerId, config.legacyOwnerId || null]
      );
  return rows.map((row) => row.data);
}

/** The logo as uploaded, for the app UI; the renderer uses logo.png, which may be inverted for the theme. */
export async function brandLogoPath(id: string) {
  if (!BRAND_ID.test(id)) return null;
  const path = join(brandDir(id), "logo-original.png");
  return (await ensureMedia(path)) ? path : null;
}

/** Makes the brand's files (logo, CSS, fonts) present in the local cache. */
export const ensureBrandFiles = (id: string) => (BRAND_ID.test(id) ? ensureMediaDir(brandDir(id)) : Promise.resolve());
