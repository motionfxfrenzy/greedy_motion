/**
 * The speed graph's geometry (design handoff: Speed graph). One property's whole speed curve across its keyframes, the selected
 * segment highlighted, its two influence handles on the baseline. Pure: the panel only draws what this returns.
 */
import { speedCurve } from "./anim.ts";
import type { Keyframe } from "./types.ts";

export const GRAPH = { width: 300, height: 150, pad: 16, base: 134, top: 12 } as const;

export type SpeedModel = {
  /** Whole property curve, and the same closed to the baseline (faint fill). */
  path: string;
  areaAll: string;
  /** The selected segment closed to the baseline (stronger fill). */
  area: string;
  /** x of the keys strictly inside the curve, for the dashed segment boundaries. */
  bounds: number[];
  /** Influence handles: x on the baseline. */
  outX: number;
  inX: number;
  /** Dashed guides from the segment's ends to its handles. */
  g1: string;
  g2: string;
  /** Peak speed over the whole property, in value units per second. */
  peak: number;
  /** x extent of the selected segment, for labels and drags. */
  x0: number;
  x1: number;
};

const num = (n: number) => n.toFixed(1);
const magnitude = (a: Keyframe["v"], b: Keyframe["v"]) => (Array.isArray(a) ? Math.hypot(...a.map((v, i) => (b as number[])[i]! - v)) : Math.abs((b as number) - a));

export function buildSpeedModel(keys: readonly Keyframe[], selected: number, samples = 160): SpeedModel | null {
  if (keys.length < 2 || selected < 0 || selected >= keys.length - 1) return null;
  const { width, pad, base, top } = GRAPH;
  const t0 = keys[0]!.t;
  const span = Math.max(1e-6, keys[keys.length - 1]!.t - t0);
  const xOf = (t: number) => pad + ((t - t0) / span) * (width - 2 * pad);

  const segments = keys.slice(0, -1).map((a, i) => {
    const b = keys[i + 1]!;
    const seconds = Math.max(1e-6, b.t - a.t);
    const scale = magnitude(a.v, b.v) / seconds; // value units per second at progress-speed 1
    return { a, b, curve: speedCurve(a, b, samples).points.map((p) => p * scale) };
  });
  const peak = Math.max(0, ...segments.flatMap((s) => s.curve));
  const yOf = (speed: number) => (peak > 0 ? base - (speed / peak) * (base - top) : base);

  const points = (s: (typeof segments)[number]) => s.curve.map((v, n) => [xOf(s.a.t + (n / samples) * (s.b.t - s.a.t)), yOf(v)] as const);
  const line = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${num(x)} ${num(y)}`).join(" ");
  const closed = (pts: readonly (readonly [number, number])[]) => `${line(pts)} L${num(pts[pts.length - 1]![0])} ${base} L${num(pts[0]![0])} ${base} Z`;

  const all = segments.flatMap((s, i) => (i ? points(s).slice(1) : points(s)));
  const sel = segments[selected]!;
  const selPts = points(sel);
  const x0 = xOf(sel.a.t);
  const x1 = xOf(sel.b.t);
  const outX = x0 + (Math.min(100, Math.max(0, sel.a.o)) / 100) * (x1 - x0);
  const inX = x1 - (Math.min(100, Math.max(0, sel.b.i)) / 100) * (x1 - x0);

  return {
    path: line(all),
    areaAll: closed(all),
    area: closed(selPts),
    bounds: keys.slice(1, -1).map((k) => xOf(k.t)),
    outX, inX,
    g1: `M${num(x0)} ${num(selPts[0]![1])} L${num(outX)} ${base}`,
    g2: `M${num(x1)} ${num(selPts[selPts.length - 1]![1])} L${num(inX)} ${base}`,
    peak, x0, x1
  };
}

/** Which influence a handle drag at `x` sets (percent of the segment), clamped to the editor's 0.1–100 range. */
export function influenceAt(x: number, x0: number, x1: number, which: "out" | "in"): number {
  const u = Math.min(1, Math.max(0, (x - x0) / Math.max(1e-6, x1 - x0)));
  return Math.round(Math.min(100, Math.max(0.1, (which === "out" ? u : 1 - u) * 100)) * 10) / 10;
}
