/** One scene's place on the film's timeline, in seconds. */
export type SceneSpan = { id: string; start: number; end: number };

export type PlayerMeta = { width: number; height: number; fps: number; frames: number; sceneSpans: SceneSpan[] };

export type PlayerEvent = "ready" | "buffering" | "error" | "mode";

export type PlayerDecision = {
  mode: "live" | "clip";
  reason: string;
  /** `predraw` when the scene is drawn slower than it plays (frames are drawn ahead before playback starts). */
  variant?: "live" | "predraw";
  /** Set (0..1) only while the scene is being pre-drawn before playback; absent once it can play. */
  progress?: number;
  /** Frames that must be ready ahead before playback starts, and the predicted wait in seconds (pre-draw only). */
  neededFrames?: number;
  waitSeconds?: number;
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
