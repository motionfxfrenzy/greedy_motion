import type { SceneSpan } from "./types.ts";

/** Frame shown at time `t` (seconds): floor(t * fps), clamped to the film. */
export function frameAt(t: number, fps: number, frames: number): number {
  if (!(fps > 0) || frames <= 0) return 0;
  const f = Math.floor((Number.isFinite(t) ? t : 0) * fps + 1e-9);
  return Math.min(frames - 1, Math.max(0, f));
}

/** Index of the scene playing at `t`: the last scene whose start is not after `t`; clamped. */
export function sceneAt(spans: SceneSpan[], t: number): number {
  if (!spans.length) return -1;
  let found = 0;
  for (let i = 0; i < spans.length; i++) if (spans[i]!.start <= t + 1e-9) found = i;
  return found;
}

/**
 * Which frame to put on screen. Audio is the master clock, so a frame that is not ready never delays it: the previous frame is
 * held and `stalled` tells the UI to show the buffering hint. Time never goes backwards on screen during play, except for a seek.
 */
export function chooseFrame(args: { target: number; lastShown: number | null; isReady: (frame: number) => boolean }): { frame: number; stalled: boolean } {
  const { target, lastShown, isReady } = args;
  if (isReady(target)) return { frame: target, stalled: false };
  if (lastShown === null) return { frame: target, stalled: true }; // nothing to hold: the caller draws the target now
  return { frame: lastShown, stalled: true };
}

/** Seconds of film that are cached ahead of `frame` (for the buffer bar and the "buffering" decision). */
export function bufferedAhead(ranges: { from: number; to: number }[], frame: number, fps: number): number {
  for (const r of ranges) if (frame >= r.from && frame <= r.to) return (r.to - frame + 1) / fps;
  return 0;
}

/** Source of time: the audio element in the studio, a fake in tests. */
export interface TimeSource { currentTime(): number; playing(): boolean }

export class PlaybackClock {
  private source: TimeSource;
  private fps: number;
  private frames: number;
  constructor(source: TimeSource, fps: number, frames: number) { this.source = source; this.fps = fps; this.frames = frames; }
  now() { return this.source.currentTime(); }
  frame() { return frameAt(this.source.currentTime(), this.fps, this.frames); }
  playing() { return this.source.playing(); }
}
