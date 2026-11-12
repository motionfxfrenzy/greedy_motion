import sharp from "sharp";

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Hue in degrees (0-360) of a #rrggbb colour. */
export function hueOf(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Smallest angle between two colours' hues (0-180). */
export const hueDistance = (a: string, b: string) => { const d = Math.abs(hueOf(a) - hueOf(b)); return d > 180 ? 360 - d : d; };

/**
 * The colours a logo is made of, most prominent first: from raw RGBA pixels, transparent pixels, whites, blacks and greys are
 * ignored; the rest is grouped into small colour buckets, nearby hues are merged, and each colour is the average of its group.
 */
export function dominantColors(rgba: ArrayLike<number>, max = 4): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!, a = rgba[i + 3]!;
    if (a < 200) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 90 || hi === 0 || (hi - lo) / hi < 0.45 || lo > 200) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const groups: { n: number; r: number; g: number; b: number; color: string }[] = [];
  for (const bucket of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const color = hex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n);
    const near = groups.find((group) => hueDistance(group.color, color) < 18);
    if (near) { near.n += bucket.n; continue; }
    groups.push({ ...bucket, color });
  }
  return groups.sort((x, y) => y.n - x.n).slice(0, max).filter((group) => group.n >= 12).map((group) => group.color);
}

/** The colours of a logo image (any format sharp reads). */
export async function logoColors(image: Buffer): Promise<string[]> {
  const { data } = await sharp(image, { limitInputPixels: 40_000_000 }).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return dominantColors(data);
}
