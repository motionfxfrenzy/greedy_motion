import type { PlaybackRenderMode, StillUpgradeState } from "./draft-profile.ts";

export type { PlaybackRenderMode, StillUpgradeState };

/** One scene's place on the film's timeline, in seconds. */
export type SceneSpan = { id: string; start: number; end: number };

export type PlayerMeta = { width: number; height: number; fps: number; frames: number; sceneSpans: SceneSpan[] };

export type PlayerEvent = "ready" | "buffering" | "error" | "mode";

/**
 * Per-scene and film-level playback states (phase 3g, plan change C):
 * - `drawing`: initial buffer (`max(30, L)` frames in Full mode, or `15..30` frames in Draft mode) is not ready yet;
 * - `ready`: buffer is ready and the player is paused;
 * - `playing`: buffer is ready and playback is advancing at 30 fps;
 * - `buffering`: the frame due was not ready; holds the last frame and pauses the clock until resume frames are ready;
 * - `clip`: fallback MP4 clip (`unverified-environment`, `unsupported-environment`, `worker-unhealthy`, or bundle-load failure).
 */
export type PlaybackState = "drawing" | "ready" | "playing" | "buffering" | "clip";

export type PlayerDecision = {
  mode: "live" | "clip";
  reason: string;
  /** Explicit 3g player state (`drawing`, `ready`, `playing`, `buffering`, `clip`). */
  state?: PlaybackState;
  /** `predraw` when the scene draws slower than 30 fps (frames are buffered ahead first). */
  variant?: "live" | "predraw";
  /** Set (0..1) while the scene is drawing its initial buffer before playback; absent once ready. */
  progress?: number;
  /** Frames that must be ready ahead before playback starts, and the predicted wait in seconds. */
  neededFrames?: number;
  waitSeconds?: number;
  /** Active playback render mode (`"draft"` or `"full"`). */
  renderMode?: PlaybackRenderMode;
  /** Effective render mode (`"full"` if a legacy bundle lacks draft support). */
  effectiveRenderMode?: PlaybackRenderMode;
  /** Pause full-quality still upgrade state (`"idle" | "pending-still" | "drawing-still" | "showing-still"`). */
  stillUpgradeState?: StillUpgradeState;
  /** Configured single tunable draft vertex budget (`draftTargetVerticesPerFrame`). */
  draftTargetVerticesPerFrame?: number;
};

/**
 * What the studio's animation workspace needs from an engine (docs/LIVE_SCENES_PLAN.md §5). The HyperFrames adapter wraps
 * <hyperframes-player>; the plate adapter draws a sandboxed scene bundle into the frame cache.
 */
export interface ScenePlayer {
  readonly meta: PlayerMeta;
  mount(el: HTMLElement): Promise<void>;
  /** Draws (or blits from the cache) a frame now. Never throws: a frame that cannot be shown keeps the previous one. */
  showFrame(frame: number): void;
  /** True when `frame` can be shown without drawing it first. */
  ready(frame: number): boolean;
  /** Frame ranges that are cached, for the buffer bar. Inclusive, sorted, non-overlapping. */
  buffered(): { from: number; to: number }[];
  on(event: PlayerEvent, callback: (detail?: unknown) => void): () => void;
  destroy(): void;
}
