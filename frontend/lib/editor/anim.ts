import { DEFAULT_FPS, snapToFrame } from "./time.ts";
import type { Keyframe, Layer, PropValue } from "./types.ts";

/** Cubic-bezier easing with control points (x1,y1) (x2,y2): the y for a given x, solved by bisection. */
export function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  let lo = 0;
  let hi = 1;
  let u = x;
  for (let step = 0; step < 22; step++) {
    u = (lo + hi) / 2;
    const bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    if (bx < x) lo = u;
    else hi = u;
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

export const lerp = (a: PropValue, b: PropValue, u: number): PropValue =>
  Array.isArray(a) ? a.map((x, i) => x + ((b as number[])[i]! - x) * u) : a + ((b as number) - a) * u;

/** Eased progress between two keys; linear keys are a straight line, eased keys use their influences. */
export function segmentProgress(a: Keyframe, b: Keyframe, u: number): number {
  return a.lin ? u : bezier(a.o / 100, 0, 1 - b.i / 100, 1, u);
}

/** The value of a layer property at time `t`: its keys when animated, otherwise the static value. */
export function valueAt(layer: Layer, prop: string, t: number): PropValue {
  const keys = layer.keys[prop];
  const staticValue = (layer as unknown as Record<string, PropValue>)[prop]!;
  if (!keys?.length) return staticValue;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t <= first.t) return first.v;
  if (t >= last.t) return last.v;
  for (let j = 0; j < keys.length - 1; j++) {
    const a = keys[j]!;
    const b = keys[j + 1]!;
    if (t >= a.t && t <= b.t) return lerp(a.v, b.v, segmentProgress(a, b, (t - a.t) / (b.t - a.t || 1)));
  }
  return staticValue;
}

/**
 * Write a value at time `t`. On an animated property this edits the key at `t` (within half a frame)
 * or creates one; on a static property it sets the base value. Mutates `layer`, so call it on a draft.
 */
export function writeProperty(layer: Layer, prop: string, value: PropValue, t: number, fps = DEFAULT_FPS): void {
  const keys = layer.keys[prop];
  if (!keys?.length) {
    (layer as unknown as Record<string, PropValue>)[prop] = value;
    return;
  }
  const at = snapToFrame(t, fps);
  const key = keys.find((k) => Math.abs(k.t - at) < 0.5 / fps);
  if (key) key.v = value;
  else {
    keys.push({ t: at, v: value, o: 33, i: 33, lin: true });
    keys.sort((a, b) => a.t - b.t);
  }
}

/** Sample the speed curve of one segment (units per second of the eased progress, normalised to its peak). */
export function speedCurve(a: Keyframe, b: Keyframe, samples = 48): { points: number[]; peak: number } {
  const points: number[] = [];
  let peak = 0;
  const eps = 1 / (samples * 4);
  for (let n = 0; n <= samples; n++) {
    const u = n / samples;
    const u0 = Math.max(0, u - eps);
    const u1 = Math.min(1, u + eps);
    const speed = (segmentProgress(a, b, u1) - segmentProgress(a, b, u0)) / (u1 - u0);
    points.push(speed);
    if (speed > peak) peak = speed;
  }
  return { points, peak };
}

export const EASE_PRESETS = {
  linear: { lin: true, o: 0, i: 0 },
  easeIn: { lin: false, o: 0.1, i: 60 },
  easeOut: { lin: false, o: 60, i: 0.1 },
  easyEase: { lin: false, o: 33, i: 33 }
} as const;
