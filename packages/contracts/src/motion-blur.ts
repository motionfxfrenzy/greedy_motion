/**
 * Motion blur is an opt-in option of a FINAL render, never of a preview. A preview (the storyboard player, the editor's 540p / 720p
 * render) stays fast and cheap; at submission the person may ask for a smoother film, and then the worker captures every frame as
 * `subframes` sub-frames and blends them, the way an open camera shutter does. That costs about `slowdown` times the render time,
 * so a film longer than `maxSeconds` is refused and the queue's expiry for such a job is stretched by the same factor.
 */
export const motionBlur = { subframes: 8, maxSeconds: 20, slowdown: 5 } as const;

/** What the final-submit checkbox says, so every surface (storyboard, editor, API errors) uses the same words. */
export const motionBlurCopy = {
  label: "Add motion blur",
  help: `Smoother fast moves, like a real camera shutter. The final render takes about ${motionBlur.slowdown}x longer, so it is available for films up to ${motionBlur.maxSeconds} seconds. Previews never use it.`
} as const;

/** Why this film cannot take motion blur, or null when it can. */
export const motionBlurProblem = (durationSeconds: number): string | null =>
  Number.isFinite(durationSeconds) && durationSeconds > motionBlur.maxSeconds
    ? `Motion blur is available for films up to ${motionBlur.maxSeconds} seconds; this one is ${Math.ceil(durationSeconds)}. Render without it.`
    : null;

/** The option as a request carries it: absent or false is off; anything but a boolean is an error the caller reports. */
export function parseMotionBlur(value: unknown): { ok: true; on: boolean } | { ok: false; message: string } {
  if (value === undefined || value === null || value === false) return { ok: true, on: false };
  if (value === true) return { ok: true, on: true };
  return { ok: false, message: "`motionBlur` must be true or false." };
}
