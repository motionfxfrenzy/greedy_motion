import type { PlaybackState } from "./types.ts";

/**
 * Pre-draw lead calculation and video-style buffering state machine for live plate scenes (phase 3f + 3g).
 * Pure: no DOM, no timers, no Worker.
 *
 * Phase 3g (docs/LIVE_PLAYBACK_PLAN.md changes B and C):
 * - `PREVIEW_FRAME_STEP = 1`: every source frame is drawn and shown at 30 fps.
 * - `decidePredraw` computes the lead `L` from the scene's draw rate `p` so slow scenes buffer enough frames ahead before
 *   starting; it never sends a scene to the MP4 clip for slowness or memory budget (frames ahead can wait in IndexedDB).
 * - Playback starts when `max(30 frames, L)` frames are ready ahead (capped at the frames left in the scene).
 * - If the frame due is not ready during playback, the player enters `buffering`, holds the last frame, pauses the clock,
 *   and resumes when `min(30, frames left in scene)` frames are ready again.
 */

/** Source frames per preview frame: 1 = full 30 fps playback (every source frame is drawn and shown). */
export const PREVIEW_FRAME_STEP = 1;

/** Minimum start buffer in frames (1 s at 30 fps): playback starts when `max(START_BUFFER_FRAMES, L)` frames are ready ahead. */
export const START_BUFFER_FRAMES = 30;

/** Safety margin applied to the measured draw time (`avgDrawMs * 1.25`) when computing the start buffer lead `L`. */
export const DRAW_TIME_SAFETY_MARGIN = 1.25;

/** Decoded `ImageBitmap` memory window kept ahead of the playhead in RAM (~3 s at 30 fps, within `resolveCacheBudgetBytes`). */
export const DECODED_WINDOW_FRAMES = 90;
export const PLAYBACK_WINDOW_FRAMES = DECODED_WINDOW_FRAMES;

/** Catch-up resume threshold in frames: buffering resumes when `min(RESUME_BUFFER_FRAMES, framesLeft)` frames are ready ahead. */
export const RESUME_BUFFER_FRAMES = 30;

/** Seconds of cushion added to the frames needed ahead (the 0.5 s gate cushion = 15 frames at 30 fps). */
export const PREDRAW_CUSHION_SECONDS = 0.5;

/** A jump of more than this many preview frames from the last shown one is a seek. */
export const PREDRAW_JUMP_FRAMES = 8;

/** Preview frames per second for a scene of `fps` (30 fps at step 1 gives 30). */
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

/** Consecutive ready preview frames from `from` (inclusive). */
export function contiguousFrom(cached: ReadonlySet<number> | Iterable<number>, from: number): number {
  const set = cached instanceof Set ? cached : new Set(cached);
  let n = 0;
  while (set.has(from + n)) n++;
  return n;
}

/**
 * Start rule (plan change C): playback starts when `max(30 frames, L)` frames are ready ahead,
 * capped by the number of frames remaining in the scene from the current position.
 */
export function startBufferFrames(remainingFrames: number, leadFrames: number): number {
  const rem = Math.max(1, Math.floor(remainingFrames));
  const lead = Math.max(0, Math.floor(leadFrames));
  return Math.min(rem, Math.max(START_BUFFER_FRAMES, lead));
}

/**
 * Catch-up resume rule (plan change C): buffering resumes when `min(30, frames left in scene)` frames are ready ahead.
 */
export function resumeBufferFrames(remainingFrames: number): number {
  const rem = Math.max(1, Math.floor(remainingFrames));
  return Math.min(RESUME_BUFFER_FRAMES, rem);
}

export type PredrawInput = {
  /** Preview frames still to play from the start position (the whole scene at the start). */
  previewFrames: number;
  /** Preview frames per second at playback (default 30). */
  rate?: number;
  /** Measured average cost of one draw, in ms (0 or less: not measured yet). */
  avgDrawMs: number;
  /** Safety margin factor applied to `avgDrawMs` when planning the lead `L` (default `DRAW_TIME_SAFETY_MARGIN` = 1.25). */
  safetyMargin?: number;
  bytesPerFrame?: number;
  budgetBytes?: number;
  /** Re-assessment while drawing: seconds waited so far, and frames already ready ahead. */
  elapsedSeconds?: number;
  readyAhead?: number;
  cushionSeconds?: number;
  unhealthy?: boolean;
  supported?: boolean;
  envStatus?: "verified" | "unverified" | "unsupported";
};

export type PredrawDecision = {
  mode: "live" | "predraw" | "clip";
  reason: string;
  /** Lead `L` computed from the draw rate with the 1.25x safety margin on measured draw time (`ceil(N * max(0, 1 - p_safe/r)) + cushion`, capped at `N`). */
  neededFrames: number;
  /** Frames required to start playback (`min(N, max(30, L))`). */
  startFrames: number;
  /** Predicted wait in seconds (`L / p_safe`; for re-assessments: waited so far plus the rest). */
  waitSeconds: number;
  /** Raw measured drawing rate (`1000 / avgDrawMs`). */
  produceFps: number;
  /** Planned drawing rate after applying the 1.25x safety margin (`1000 / (avgDrawMs * 1.25)`). */
  plannedProduceFps: number;
  /** Planned draw cost per frame in ms (`avgDrawMs * 1.25`). */
  plannedDrawMs: number;
  /** Safety margin applied to `avgDrawMs` (default 1.25). */
  safetyMargin: number;
  consumeFps: number;
  /** Memory the needed frames would occupy if all held in RAM. */
  bytesNeeded: number;
  /** Frames the RAM byte budget can hold at once. */
  budgetFrames: number;
  /** The numbers came from draws made while another scene was drawing. */
  provisional?: boolean;
};

/**
 * Computes the pre-draw lead `L` from the scene's measured draw time `avgDrawMs` with a 1.25x safety margin
 * (`plannedDrawMs = avgDrawMs * 1.25`, `p_safe = 1000 / plannedDrawMs`):
 * - `clip` ONLY when `supported === false` (`unverified-environment` or `unsupported-environment`) or `unhealthy` (`worker-unhealthy`).
 *   Never falls back to `clip` for slowness or memory budget.
 * - `live` when `p_safe >= rate`: `L = min(N, cushionFrames)`, `startFrames = min(N, max(30, L))`.
 * - `predraw` when `p_safe < rate`: `L = min(N, ceil(N * (1 - p_safe/rate)) + cushionFrames)`, `startFrames = min(N, max(30, L))`.
 */
export function decidePredraw(input: PredrawInput): PredrawDecision {
  const rate = input.rate && input.rate > 0 ? input.rate : PREVIEW_FRAME_STEP > 0 ? 30 / PREVIEW_FRAME_STEP : 30;
  const n = Math.max(1, Math.floor(input.previewFrames));
  const bpf = input.bytesPerFrame && input.bytesPerFrame > 0 ? input.bytesPerFrame : 640 * 360 * 4;
  const budgetFrames = input.budgetBytes && input.budgetBytes > 0 ? Math.floor(input.budgetBytes / bpf) : DECODED_WINDOW_FRAMES;
  const safetyMargin = input.safetyMargin && input.safetyMargin > 0 ? input.safetyMargin : DRAW_TIME_SAFETY_MARGIN;
  const base = {
    consumeFps: rate,
    budgetFrames,
    neededFrames: 0,
    startFrames: 0,
    waitSeconds: 0,
    produceFps: 0,
    plannedProduceFps: 0,
    plannedDrawMs: 0,
    safetyMargin,
    bytesNeeded: 0
  };

  if (input.supported === false) {
    const reason = input.envStatus === "unverified" ? "unverified-environment" : "unsupported-environment";
    return { ...base, mode: "clip", reason };
  }
  if (input.unhealthy) {
    return { ...base, mode: "clip", reason: "worker-unhealthy" };
  }

  const cushionFrames = Math.ceil((input.cushionSeconds ?? PREDRAW_CUSHION_SECONDS) * rate - 1e-9);

  if (!(input.avgDrawMs > 0)) {
    const needed = Math.min(n, cushionFrames);
    const startFrames = startBufferFrames(n, needed);
    return {
      ...base,
      mode: "live",
      reason: "measuring",
      neededFrames: needed,
      startFrames,
      produceFps: rate,
      plannedProduceFps: rate,
      bytesNeeded: needed * bpf
    };
  }

  const produceFps = 1000 / input.avgDrawMs;
  const plannedDrawMs = input.avgDrawMs * safetyMargin;
  const plannedProduceFps = 1000 / plannedDrawMs;
  const needed = Math.min(n, Math.ceil(n * Math.max(0, 1 - plannedProduceFps / rate) - 1e-9) + cushionFrames);
  const startFrames = startBufferFrames(n, needed);
  const bytesNeeded = needed * bpf;
  const ready = Math.max(0, Math.min(startFrames, input.readyAhead ?? 0));
  const wait =
    (input.elapsedSeconds ?? 0) +
    (input.elapsedSeconds !== undefined ? Math.max(0, startFrames - ready) / plannedProduceFps : startFrames / plannedProduceFps);
  const out = {
    ...base,
    neededFrames: needed,
    startFrames,
    waitSeconds: wait,
    produceFps,
    plannedProduceFps,
    plannedDrawMs,
    bytesNeeded
  };

  if (plannedProduceFps >= rate) {
    return { ...out, mode: "live", reason: "ok" };
  }
  return { ...out, mode: "predraw", reason: "predraw" };
}

/** Fraction (0..1) of the needed frames that are ready. */
export function predrawProgress(ready: number, needed: number): number {
  if (!(needed > 0)) return 1;
  return Math.max(0, Math.min(1, ready / needed));
}

/**
 * Remembers which scenes fell back to the clip (`unverified-environment`, `unsupported-environment`, `worker-unhealthy`,
 * or bundle failure) so a scene that fell back stays a clip for the lifetime of the page.
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

export type BufferingMachineStepInput = {
  /** Current target preview frame index (0 .. totalFrames - 1). */
  currentFrame: number;
  /** Total preview frames in the scene. */
  totalFrames: number;
  /** Lead `L` computed by `decidePredraw`. */
  leadFrames: number;
  /** Consecutive frames ready ahead from `currentFrame` (inclusive). */
  readyAhead: number;
  /** Whether the user/film wants playback running. */
  wantPlay: boolean;
  /** Set if the scene must use its MP4 clip (`unverified-environment`, `unsupported-environment`, `worker-unhealthy`, etc.). */
  clipReason?: string | null;
};

export type BufferingMachineSnapshot = {
  state: PlaybackState;
  /** Frame shown on screen (never a wrong frame: either `currentFrame` when ready, or the held `lastShownFrame`). */
  shownFrame: number | null;
  /** Whether the clock and audio must be paused right now (`true` during `drawing`, `buffering`, or when `!wantPlay`). */
  clockPaused: boolean;
  /** Frames needed to exit `drawing` or `buffering`. */
  neededFrames: number;
  /** Progress (0..1) toward `neededFrames`. */
  progress: number;
  /** Total times the machine entered `buffering`. */
  bufferingCount: number;
};

/**
 * Pure state machine implementing the phase 3g video-style buffering rules:
 * - States: `drawing` (initial buffer not ready yet), `ready`, `playing`, `buffering`, `clip`.
 * - Start rule: exits `drawing` when `readyAhead >= min(framesLeft, max(30, L))`.
 * - Catch-up: if while `playing` (or `ready`) the due frame is not ready (`readyAhead < 1`), enters `buffering`,
 *   holds `lastShownFrame`, and pauses the clock.
 * - Resume rule: exits `buffering` only when `readyAhead >= min(30, framesLeft)`.
 */
export class BufferingStateMachine {
  private currentState: PlaybackState = "drawing";
  private lastShown: number | null = null;
  private initialBufferDone = false;
  private bufferCount = 0;

  get state(): PlaybackState {
    return this.currentState;
  }

  get lastShownFrame(): number | null {
    return this.lastShown;
  }

  get bufferingCount(): number {
    return this.bufferCount;
  }

  resetForSeek(): void {
    // Seeking keeps `initialBufferDone` if already started; if the target frame is missing it will enter `buffering`.
  }

  step(input: BufferingMachineStepInput): BufferingMachineSnapshot {
    const total = Math.max(1, Math.floor(input.totalFrames));
    const frame = Math.max(0, Math.min(total - 1, Math.floor(input.currentFrame)));
    const remaining = Math.max(1, total - frame);
    const readyAhead = Math.max(0, Math.floor(input.readyAhead));
    const isDueReady = readyAhead >= 1;

    if (input.clipReason) {
      this.currentState = "clip";
      return {
        state: "clip",
        shownFrame: this.lastShown,
        clockPaused: true,
        neededFrames: 0,
        progress: 0,
        bufferingCount: this.bufferCount
      };
    }

    if (!this.initialBufferDone) {
      const startTarget = startBufferFrames(remaining, input.leadFrames);
      if (readyAhead >= startTarget && isDueReady) {
        this.initialBufferDone = true;
        this.lastShown = frame;
        this.currentState = input.wantPlay ? "playing" : "ready";
        return {
          state: this.currentState,
          shownFrame: this.lastShown,
          clockPaused: !input.wantPlay,
          neededFrames: startTarget,
          progress: 1,
          bufferingCount: this.bufferCount
        };
      }
      this.currentState = "drawing";
      if (isDueReady && this.lastShown === null) {
        this.lastShown = frame;
      }
      return {
        state: "drawing",
        shownFrame: this.lastShown,
        clockPaused: true,
        neededFrames: startTarget,
        progress: predrawProgress(readyAhead, startTarget),
        bufferingCount: this.bufferCount
      };
    }

    if (this.currentState === "buffering") {
      const resumeTarget = resumeBufferFrames(remaining);
      if (readyAhead >= resumeTarget && isDueReady) {
        this.lastShown = frame;
        this.currentState = input.wantPlay ? "playing" : "ready";
        return {
          state: this.currentState,
          shownFrame: this.lastShown,
          clockPaused: !input.wantPlay,
          neededFrames: resumeTarget,
          progress: 1,
          bufferingCount: this.bufferCount
        };
      }
      return {
        state: "buffering",
        shownFrame: this.lastShown,
        clockPaused: true,
        neededFrames: resumeTarget,
        progress: predrawProgress(readyAhead, resumeTarget),
        bufferingCount: this.bufferCount
      };
    }

    // Currently `ready` or `playing`: check whether the due frame is ready.
    if (!isDueReady) {
      this.currentState = "buffering";
      this.bufferCount++;
      const resumeTarget = resumeBufferFrames(remaining);
      return {
        state: "buffering",
        shownFrame: this.lastShown,
        clockPaused: true,
        neededFrames: resumeTarget,
        progress: predrawProgress(readyAhead, resumeTarget),
        bufferingCount: this.bufferCount
      };
    }

    this.lastShown = frame;
    this.currentState = input.wantPlay ? "playing" : "ready";
    return {
      state: this.currentState,
      shownFrame: this.lastShown,
      clockPaused: !input.wantPlay,
      neededFrames: 0,
      progress: 1,
      bufferingCount: this.bufferCount
    };
  }
}
