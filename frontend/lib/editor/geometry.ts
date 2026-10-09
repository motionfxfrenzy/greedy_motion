import { valueAt } from "./anim.ts";
import type { Box, Canvas, Clip, Layer, Rect } from "./types.ts";

export const ACTION_SAFE = 0.05;
export const TITLE_SAFE = 0.1;

/** A layer's box on the canvas at time `t`, after position / scale / rotation. */
export function layerBox(layer: Layer, t: number): Box {
  const pos = valueAt(layer, "pos", t) as number[];
  const scale = valueAt(layer, "scale", t) as number[];
  return { cx: pos[0]!, cy: pos[1]!, w: (layer.w * scale[0]!) / 100, h: (layer.h * scale[1]!) / 100, rot: valueAt(layer, "rot", t) as number };
}

export const safeRect = (canvas: Canvas, inset: number): Rect => ({
  x: canvas.width * inset,
  y: canvas.height * inset,
  w: canvas.width * (1 - 2 * inset),
  h: canvas.height * (1 - 2 * inset)
});

const cssValue = (clip: Clip, key: string) => clip.css.find((row) => row[0] === key)?.[1];
const px = (value: string | undefined) => Number.parseFloat(value ?? "") || 0;

/** Approximate on-canvas rectangle of an HTML clip, read from its inline CSS (the live frame reports exact ones). */
export function clipRect(clip: Clip, canvas: Canvas): Rect & { full?: boolean } {
  const left = px(cssValue(clip, "left"));
  const top = px(cssValue(clip, "top"));
  switch (clip.kind) {
    case "audio": return { x: 0, y: 0, w: 0, h: 0 };
    case "img":
    case "video": { const w = px(cssValue(clip, "width")) || 400; return { x: left, y: top, w, h: px(cssValue(clip, "height")) || (clip.kind === "video" ? (w * 9) / 16 : w / 3) }; }
    case "text": {
      const fontSize = px(/(\d+(?:\.\d+)?)px/.exec(cssValue(clip, "font") ?? "")?.[1]) || px(cssValue(clip, "font-size")) || 48;
      const full = cssValue(clip, "left") === "0" && cssValue(clip, "right") === "0";
      return { x: full ? 0 : left, y: top, w: full ? canvas.width : Math.max(200, clip.text.length * fontSize * 0.55), h: fontSize * 1.25, full };
    }
    default: {
      const fullBleed = ["left", "right", "top", "bottom"].every((key) => px(cssValue(clip, key)) === 0 && cssValue(clip, key) !== undefined);
      if (fullBleed) return { x: 0, y: 0, w: canvas.width, h: canvas.height, full: true };
      return { x: left, y: top, w: px(cssValue(clip, "width")) || 120, h: px(cssValue(clip, "height")) || px(cssValue(clip, "width")) || 120 };
    }
  }
}

const rotate = (x: number, y: number, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
};

/** Is the canvas point inside the (possibly rotated) box? */
export function pointInBox(box: Box, x: number, y: number): boolean {
  const local = rotate(x - box.cx, y - box.cy, -box.rot);
  return Math.abs(local.x) <= box.w / 2 && Math.abs(local.y) <= box.h / 2;
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLE_SIGNS: Record<HandleId, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
export const HANDLE_IDS = Object.keys(HANDLE_SIGNS) as HandleId[];

/** Canvas position of one of the eight resize handles. */
export function handlePoint(box: Box, id: HandleId): { x: number; y: number } {
  const [sx, sy] = HANDLE_SIGNS[id];
  const p = rotate((sx * box.w) / 2, (sy * box.h) / 2, box.rot);
  return { x: box.cx + p.x, y: box.cy + p.y };
}

/**
 * New scale (percent) for a layer when a handle is dragged to canvas point (x, y). Corner handles scale
 * both axes (kept proportional when `linked`), edge handles scale one axis. The opposite side stays put.
 */
export function scaleFromHandle(box: Box, scale: number[], id: HandleId, x: number, y: number, linked: boolean): number[] {
  const [sx, sy] = HANDLE_SIGNS[id];
  const local = rotate(x - box.cx, y - box.cy, -box.rot);
  const baseW = box.w / (scale[0]! / 100) || 1;
  const baseH = box.h / (scale[1]! / 100) || 1;
  const nextW = sx ? Math.max(2, Math.abs(local.x) * 2) : box.w;
  const nextH = sy ? Math.max(2, Math.abs(local.y) * 2) : box.h;
  let scaleX = (nextW / baseW) * 100;
  let scaleY = (nextH / baseH) * 100;
  if (linked && sx && sy) {
    const uniform = Math.max(scaleX / scale[0]!, scaleY / scale[1]!);
    scaleX = scale[0]! * uniform;
    scaleY = scale[1]! * uniform;
  } else if (linked && sx) scaleY = scale[1]! * (scaleX / scale[0]!);
  else if (linked && sy) scaleX = scale[0]! * (scaleY / scale[1]!);
  return [Math.round(scaleX * 10) / 10, Math.round(scaleY * 10) / 10];
}

/** Angle in degrees from the box centre to a canvas point, with 0 pointing up. Shift snaps to 15°. */
export function angleToPoint(box: Box, x: number, y: number, step15 = false): number {
  const deg = (Math.atan2(y - box.cy, x - box.cx) * 180) / Math.PI + 90;
  const wrapped = ((deg + 180) % 360 + 360) % 360 - 180;
  return step15 ? Math.round(wrapped / 15) * 15 : Math.round(wrapped * 10) / 10;
}

export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const boxBounds = (box: Box): Rect => {
  const corners = HANDLE_IDS.filter((id) => id.length === 2).map((id) => handlePoint(box, id));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
