// Brand asset intake: logos are decoded and re-encoded as PNG (SVG is rasterized, so scripts in it never
// run and nothing but pixels reaches the renderer); fonts are accepted only by their binary signature.
// Uploads are staged until a brand kit is saved.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { readMedia, saveMedia } from "../media.ts";

export const LOGO_MAX_BYTES = 5_000_000;
export const FONT_MAX_BYTES = 3_000_000;

export type FontFormat = "woff2" | "woff" | "ttf" | "otf";
/** Monochrome logos can be inverted for backgrounds they would vanish on; colored logos are never altered. */
export type LogoTone = "dark" | "light" | "color";
export type StagedAsset = { assetId: string; kind: "logo" | "font"; format: "png" | FontFormat; width?: number; height?: number; tone?: LogoTone };

export class AssetRejected extends Error {}

const stagingDir = () => join(config.brandsDir, "_staging");
const ASSET_ID = /^[0-9a-f-]{36}$/;

export async function normalizeLogo(input: Buffer) {
  if (input.length > LOGO_MAX_BYTES) throw new AssetRejected("Logo must be 5 MB or smaller.");
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000, density: 300 });
    const meta = await image.metadata();
    if (!meta.format || !["png", "jpeg", "webp", "gif", "svg", "avif", "tiff"].includes(meta.format)) throw new AssetRejected("Logo must be PNG, JPEG, WebP, GIF, AVIF, or SVG.");
    const { data, info } = await image.rotate().resize({ width: 1200, height: 600, fit: "inside", withoutEnlargement: meta.format !== "svg" }).png().toBuffer({ resolveWithObject: true });
    if (info.width < 16 || info.height < 16) throw new AssetRejected("Logo is too small (minimum 16 × 16 px).");
    // A logo that disappears on white (blank, or white-only artwork) is not usable on light themes.
    const { data: grey } = await sharp(data).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    for (const value of grey) if (value < 200) visible++;
    if (visible / grey.length < 0.01) throw new AssetRejected("That logo is blank or white-only. Upload a version that shows on a light background.");
    return { data, width: info.width, height: info.height, tone: await logoTone(data) };
  } catch (error) {
    if (error instanceof AssetRejected) throw error;
    throw new AssetRejected("That file could not be read as an image.");
  }
}

/** Classifies the visible (opaque) pixels: low saturation means monochrome, then light or dark by luminance. */
export async function logoTone(png: Buffer): Promise<LogoTone> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0, lum = 0, sat = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue;
    const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += max === 0 ? 0 : (max - min) / max;
    count++;
  }
  if (count === 0) return "color";
  if (sat / count > 0.18) return "color";
  return lum / count < 0.5 ? "dark" : "light";
}

export function detectFont(input: Buffer): FontFormat {
  if (input.length > FONT_MAX_BYTES) throw new AssetRejected("Font files must be 3 MB or smaller.");
  const signature = input.subarray(0, 4).toString("latin1");
  if (signature === "wOF2") return "woff2";
  if (signature === "wOFF") return "woff";
  if (signature === "OTTO") return "otf";
  if (input.readUInt32BE(0) === 0x00010000 || signature === "true") return "ttf";
  throw new AssetRejected("Fonts must be WOFF2, WOFF, TTF, or OTF files.");
}

export async function stageLogo(input: Buffer): Promise<StagedAsset> {
  const { data, width, height, tone } = await normalizeLogo(input);
  const asset: StagedAsset = { assetId: randomUUID(), kind: "logo", format: "png", width, height, tone };
  await writeStaged(asset, data);
  return asset;
}

export async function stageFont(input: Buffer): Promise<StagedAsset> {
  const asset: StagedAsset = { assetId: randomUUID(), kind: "font", format: detectFont(input) };
  await writeStaged(asset, input);
  return asset;
}

async function writeStaged(asset: StagedAsset, data: Buffer) {
  await saveMedia(join(stagingDir(), `${asset.assetId}.${asset.format}`), data);
  await saveMedia(join(stagingDir(), `${asset.assetId}.json`), JSON.stringify(asset));
}

export async function readStaged(assetId: string, kind: StagedAsset["kind"]) {
  if (!ASSET_ID.test(assetId)) throw new AssetRejected("Unknown asset.");
  const metaBytes = await readMedia(join(stagingDir(), `${assetId}.json`));
  if (!metaBytes) throw new AssetRejected("Unknown or expired asset.");
  const meta = JSON.parse(metaBytes.toString("utf8")) as StagedAsset;
  if (meta.kind !== kind) throw new AssetRejected(`Asset is not a ${kind}.`);
  const data = await readMedia(join(stagingDir(), `${assetId}.${meta.format}`));
  if (!data) throw new AssetRejected("Unknown or expired asset.");
  return { meta, data };
}
