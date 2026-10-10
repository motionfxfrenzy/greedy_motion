// Motion blur for a FINAL render, by supersampling time: the composition is captured at (output fps x sub-frames) and every
// output frame is the mean of its sub-frames, which is what an open camera shutter does. A fast move smears along its path,
// a slow one stays sharp, and no composition has to author any blur. Audio is the render's own track, copied untouched.
//
// Only a final render the person asked for (`motionBlur: true`, set at submission) takes this path. A preview never does,
// and a film longer than the cap renders normally: the backend refuses that request, this is the worker's own guard.
// Mirrors packages/contracts/src/motion-blur.ts (the worker image does not ship the contracts package) and
// scripts/subframe-render.mjs (the same method, for local use).
import { rm } from "node:fs/promises";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const MOTION_BLUR = {
  // 30 fps x 8 = 240 fps, the render CLI's ceiling. Fewer sub-frames render faster and ghost more on very fast moves.
  subframes: clamp(Math.round(Number(process.env.MOTION_BLUR_SUBFRAMES) || 8), 2, 8),
  maxSeconds: Number(process.env.MOTION_BLUR_MAX_SECONDS) || 20
};

export const FRAME_RATE = 30;

/** True only for a final render that asked for blur and fits the cap. `isPreview` is the worker's own preview test. */
export const wantsMotionBlur = (input, isPreview) =>
  input?.motionBlur === true && !isPreview(input) && (Number(input.durationSeconds) || 0) <= MOTION_BLUR.maxSeconds;

/** The ffmpeg filter that averages each frame's sub-frames and keeps one frame per group. */
export const blendFilter = (subframes) => `tmix=frames=${subframes},select='eq(mod(n\\,${subframes})\\,${subframes - 1})',setpts=PTS-STARTPTS`;

/**
 * Renders `folder` at the fine frame rate into `${output}.fine.mp4`, blends it into `output`, and removes the fine file.
 * `hyperframesArgs(fineOutput, fps)` returns the CLI arguments for the capture; `run` is the worker's process runner.
 */
export async function renderWithMotionBlur({ run, hyperframes, hyperframesArgs, output, options, subframes = MOTION_BLUR.subframes }) {
  const fine = `${output}.fine.mp4`;
  try {
    await run(hyperframes, hyperframesArgs(fine, FRAME_RATE * subframes), options);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", fine, "-vf", blendFilter(subframes), "-r", String(FRAME_RATE), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output], options);
  } finally {
    await rm(fine, { force: true });
  }
}
