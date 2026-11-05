/**
 * Pre-draw decisions for live plate scenes (phase 3f). Pure: no DOM, no timers, no Worker.
 *
 * Preview draws every `PREVIEW_FRAME_STEP`-th source frame (0, 2, 4, ...) and shows each for `PREVIEW_FRAME_STEP` ticks of the
 * 30 fps clock. A scene that cannot be drawn as fast as it plays (draw rate `p` below the preview rate `r`) is not sent to its
 * MP4 clip at once: enough frames are drawn ahead first (`L`), then it plays while the rest keeps being drawn, and every frame is
 * freed as soon as it has been shown. The clip is the fallback only when that wait would be too long or does not fit memory.
 */

/** Source frames per preview frame: preview draws source frames 0, 2, 4, ... (15 fps for a 30 fps scene). */
export const PREVIEW_FRAME_STEP = 2;

/** Default upper bound, in seconds, on the predicted wait before a pre-drawn scene starts. */
export const DEFAULT_MAX_PREDRAW_SECONDS = 20;

/** While pre-drawing, the scene falls back when the re-measured wait exceeds the limit by more than this factor. */
export const PREDRAW_REASSESS_TOLERANCE = 1.25;

/** Seconds of cushion added to the frames needed ahead (the existing 0.5 s gate cushion). */
export const PREDRAW_CUSHION_SECONDS = 0.5;

/** A jump of more than this many preview frames from the last shown one is a seek, so the lead is rebuilt (about 0.5 s). */
export const PREDRAW_JUMP_FRAMES = 8;

/** A pre-drawn scene that has been holding a missing frame this long (ms) rebuilds its lead instead of stuttering on. */
export const PREDRAW_STALL_REPREPARE_MS = 1500;

/** Safe read of the optional environment override, the same way `flag.ts` reads its flag. */
export function readPredrawMaxSeconds(override?: unknown): number {
  let raw: unknown = override;
  if (raw === undefined) {
    try {
      raw = process.env.NEXT_PUBLIC_PLATE_PREDRAW_MAX_S;
    } catch {
      raw = undefined;
    }
  }
  const n = typeof raw === "string" ? Number(raw.trim()) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PREDRAW_SECONDS;
}

/** Longest predicted wait (seconds) before a pre-drawn scene starts; falls back to the clip beyond it. */
export const MAX_PREDRAW_SECONDS: number = readPredrawMaxSeconds();

/** Preview frames per second for a scene of `fps` (30 fps at step 2 gives 15). */
export function previewRate(fps: number, step = PREVIEW_FRAME_STEP): number {
  return (fps > 0 ? fps : 30) / Math.max(1, step);
}

/** Number of preview frames of a scene of `frames` source frames: source frames 0, step, 2*step, ... */
export function previewFrameCount(frames: number, step = PREVIEW_FRAME_STEP): number {
  return Math.max(1, Math.ceil(Math.max(1, frames) / Math.max(1, step)));
}

/** Preview index shown at source frame `frame` (the frame is held for `step` source frames). */
export function previewIndexForFrame(frame: number, frames: number, step = PREVIEW_FRAME_STEP): number {
  const count = previewFrameCount(frames, step);
  const f = Number.isFinite(frame) ? Math.floor(frame) : 0;
  return Math.max(0, Math.min(count - 1, Math.floor(f / Math.max(1, step))));
}

/** The engine's source frame index drawn for preview index `idx` (always `<= frames - 1`). */
export function sourceFrameForPreview(idx: number, frames: number, step = PREVIEW_FRAME_STEP): number {
  return Math.max(0, Math.min(Math.max(0, frames - 1), Math.floor(idx) * Math.max(1, step)));
}

/** Cached preview indices that the playhead has passed: all of them must be closed, only the on-screen frame stays. */
export function indicesToEvict(cached: Iterable<number>, playhead: number): number[] {
  const out: number[] = [];
  for (const i of cached) if (i < playhead) out.push(i);
  return out.sort((a, b) => a - b);
}

/** Consecutive cached preview frames from `from` (inclusive). */
export function contiguousFrom(cached: ReadonlySet<number> | Iterable<number>, from: number): number {
  const set = cached instanceof Set ? cached : new Set(cached);
  let n = 0;
  while (set.has(from + n)) n++;
  return n;
}

export type PredrawInput = {
  /** Preview frames still to play from the start position (the whole scene at the start). */
  previewFrames: number;
  /** Preview frames per second at playback. */
  rate: number;
  /** Measured average cost of one draw, in ms (0 or less: not measured yet). */
  avgDrawMs: number;
  bytesPerFrame: number;
  budgetBytes: number;
  /** Longest wait allowed in seconds (default `MAX_PREDRAW_SECONDS`). */
  maxSeconds?: number;
  /** Re-assessment while pre-drawing: seconds waited so far, and frames already ready ahead. */
  elapsedSeconds?: number;
  readyAhead?: number;
  /** 1 for the first decision, `PREDRAW_REASSESS_TOLERANCE` for re-assessments. */
  tolerance?: number;
  cushionSeconds?: number;
  unhealthy?: boolean;
  supported?: boolean;
  envStatus?: "verified" | "unverified" | "unsupported";
};

export type PredrawDecision = {
  mode: "live" | "predraw" | "clip";
  reason: string;
  /** Frames that must be ready ahead before playback can run without stalling (`L`, capped at the frames to play). */
  neededFrames: number;
  /** Predicted wait in seconds (`L / p`; for re-assessments: waited so far plus the rest). */
  waitSeconds: number;
  produceFps: number;
  consumeFps: number;
  /** Memory the needed frames hold. */
  bytesNeeded: number;
  /** Frames the byte budget can hold. */
  budgetFrames: number;
};

/**
 * Decides how a plate scene plays at the preview rate:
 * - `live` when it draws at least as fast as it plays (`p >= r`): normal small lead (the cushion);
 * - `predraw` when it draws slower but the frames needed ahead `L = ceil(N * max(0, 1 - p/r)) + cushion` fit the byte budget and
 *   the predicted wait `W = L / p` is at most the limit;
 * - `clip` otherwise: `predraw-over-budget`, `predraw-too-slow: wait Ws > 20s`, or the unchanged unsupported / unhealthy reasons.
 */
export function decidePredraw(input: PredrawInput): PredrawDecision {
  const rate = input.rate > 0 ? input.rate : PREVIEW_FRAME_STEP > 0 ? 30 / PREVIEW_FRAME_STEP : 15;
  const n = Math.max(1, Math.floor(input.previewFrames));
  const bpf = input.bytesPerFrame > 0 ? input.bytesPerFrame : 1;
  const budgetFrames = input.budgetBytes > 0 ? Math.floor(input.budgetBytes / bpf) : 0;
  const base = { consumeFps: rate, budgetFrames, neededFrames: 0, waitSeconds: 0, produceFps: 0, bytesNeeded: 0 };

  if (input.supported === false) {
    const reason = input.envStatus === "unverified" ? "unverified-environment" : "unsupported-environment";
    return { ...base, mode: "clip", reason };
  }
  if (input.unhealthy) return { ...base, mode: "clip", reason: "worker-unhealthy" };

  const cushionFrames = Math.ceil((input.cushionSeconds ?? PREDRAW_CUSHION_SECONDS) * rate - 1e-9);

  if (!(input.avgDrawMs > 0)) {
    const needed = Math.min(n, cushionFrames);
    return { ...base, mode: "live", reason: "measuring", neededFrames: needed, produceFps: rate, bytesNeeded: needed * bpf };
  }

  const p = 1000 / input.avgDrawMs;
  const needed = Math.min(n, Math.ceil(n * Math.max(0, 1 - p / rate) - 1e-9) + cushionFrames);
  const bytesNeeded = needed * bpf;
  const ready = Math.max(0, Math.min(needed, input.readyAhead ?? 0));
  const wait = (input.elapsedSeconds ?? 0) + (input.elapsedSeconds !== undefined ? Math.max(0, needed - ready) / p : needed / p);
  const out = { ...base, neededFrames: needed, waitSeconds: wait, produceFps: p, bytesNeeded };

  if (p >= rate) return { ...out, mode: "live", reason: "ok" };

  if (needed > budgetFrames) {
    const mb = (x: number) => (x / (1024 * 1024)).toFixed(1);
    return {
      ...out,
      mode: "clip",
      reason: `predraw-over-budget: need ${needed} frames (${mb(bytesNeeded)} MB) > budget ${mb(input.budgetBytes)} MB`
    };
  }

  const maxSeconds = input.maxSeconds ?? MAX_PREDRAW_SECONDS;
  const limit = maxSeconds * (input.tolerance ?? 1);
  if (wait > limit + 1e-9) {
    return { ...out, mode: "clip", reason: `predraw-too-slow: wait ${wait.toFixed(1)}s > ${maxSeconds}s` };
  }
  return { ...out, mode: "predraw", reason: "predraw" };
}

/** Fraction (0..1) of the needed frames that are ready. */
export function predrawProgress(ready: number, needed: number): number {
  if (!(needed > 0)) return 1;
  return Math.max(0, Math.min(1, ready / needed));
}

/**
 * Remembers which scenes fell back to the clip so a later, better measurement never flips them back to live in the same page.
 * (The stage keys it `variantId:gen:digest`; the player also keeps its own clip decision terminal.)
 */
export class FallbackLatch {
  private readonly reasons = new Map<string, string>();
  /** Records a fallback; the first reason sticks. */
  fall(key: string, reason: string): void {
    if (!this.reasons.has(key)) this.reasons.set(key, reason);
  }
  reason(key: string): string | undefined {
    return this.reasons.get(key);
  }
  /** Applies a fresh decision: a key that already fell back stays a clip with its original reason. */
  apply(key: string, decision: PredrawDecision): PredrawDecision {
    const kept = this.reasons.get(key);
    if (kept) return { ...decision, mode: "clip", reason: kept };
    if (decision.mode === "clip") this.reasons.set(key, decision.reason);
    return decision;
  }
}
