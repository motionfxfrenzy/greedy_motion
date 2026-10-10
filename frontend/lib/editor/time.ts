export const DEFAULT_FPS = 30;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Snap a time to the frame grid. */
export const snapToFrame = (t: number, fps = DEFAULT_FPS) => Math.round(t * fps) / fps;

/** `M:SS:FF`, the timecode used across the editor. Negative times clamp to zero. */
export function formatTime(t: number, fps = DEFAULT_FPS): string {
  const total = Math.max(0, Math.round(t * fps));
  const whole = Math.floor(total / fps);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}:${String(total % fps).padStart(2, "0")}`;
}

export const timeToX = (t: number, pxPerSecond: number, origin = 0) => origin + t * pxPerSecond;
export const xToTime = (x: number, pxPerSecond: number, origin = 0) => (x - origin) / pxPerSecond;
