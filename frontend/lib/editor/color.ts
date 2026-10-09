/** Colour maths for the editor's picker. Pure, so the picker's behaviour is tested without a browser. */

export type Rgb = [number, number, number];
export type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "#abc", "abc" and "#aabbcc" are colours; anything else is not finished yet. Returns "#RRGGBB" or null. */
export function normaliseHex(text: string): string | null {
  const t = text.trim().replace(/^#?/, "#");
  if (/^#[0-9a-f]{3}$/i.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toUpperCase() : null;
}

export function hexToRgb(hex: string): Rgb {
  const h = normaliseHex(hex) ?? "#000000";
  return [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
}

export const rgbToHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Position of a pointer inside a box as 0–1 on each axis, clamped, so a drag that leaves the box pins to its edge. */
export function unitIn(box: { left: number; top: number; width: number; height: number }, x: number, y: number): { x: number; y: number } {
  return { x: clamp((x - box.left) / Math.max(1, box.width), 0, 1), y: clamp((y - box.top) / Math.max(1, box.height), 0, 1) };
}
