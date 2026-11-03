// Assembly rules shared by the backend (which plans the export) and the worker (which performs it).
export const FPS = 30;

/**
 * Whether scene clips can be joined without re-encoding. Every clip must be what the timeline expects, to the frame (the
 * probe's real frame count, never a saved number of seconds), and nothing may touch pixels: no subtitle or watermark overlay,
 * no retiming. The timeline is never shortened or lengthened to make this true.
 */
export function canStreamCopy(facts, timelineFrames, size, overlays) {
  if (overlays > 0) return false;
  return facts.length > 0 && facts.length === timelineFrames.length && facts.every((f, i) =>
    f.codec === "h264" && f.width === size.w && f.height === size.h && f.pixFmt === "yuv420p" && Math.abs((f.fps ?? 0) - FPS) < 1e-6 && f.frames === timelineFrames[i]);
}
