#!/usr/bin/env node
// subframe-render.mjs: render a HyperFrames project with real motion blur by supersampling time.
//
//   node scripts/subframe-render.mjs <project dir> --output out.mp4 [--fps 30] [--subframes 8] [--quality standard]
//
// The composition is captured at fps x subframes (the CLI's ceiling is 240 fps, so 30 fps takes up to 8 sub-frames,
// 60 fps up to 4). Every output frame is the mean of its sub-frames (ffmpeg tmix), which is what an open camera shutter
// does: a fast move smears along its path and a slow one stays sharp, with no filter and no per-element blur to author.
// Audio is the render's own track, copied untouched.
//
// When to use it: on a render whose fast moves look steppy (pop_gate.mjs reports them as `fast`): a whip, a flood, a
// snap. Do not use it as a default; it costs about `subframes` times the capture time. Four sub-frames leave a visible
// ghost copy on a very fast move (more than ~1/8 of the frame per output frame), so slow that move down rather than
// reaching for more blur. The blurred frame is centred half an output frame later than the sharp one (N-1 sub-frames
// of 240 fps, about 29 ms at 8 sub-frames); cuts are not moved by it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const project = args.find((a, i) => !a.startsWith("--") && !["--output", "--fps", "--subframes", "--quality"].includes(args[i - 1]));
if (!project || !val("output")) { console.error("usage: subframe-render.mjs <project dir> --output out.mp4 [--fps 30] [--subframes 8] [--quality standard]"); process.exit(2); }

const fps = Number(val("fps", 30)), n = Number(val("subframes", 8)), quality = val("quality", "standard");
if (!Number.isInteger(n) || n < 2 || fps * n > 240) { console.error(`--subframes must be an integer >= 2 with fps x subframes <= 240 (got ${fps} x ${n}).`); process.exit(2); }

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "worker/node_modules/.bin/hyperframes");
if (!existsSync(cli)) { console.error(`pinned hyperframes CLI not found at ${cli}; run npm ci in worker/`); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "subframe-"));
const fine = join(dir, "fine.mp4");
const started = Date.now();
try {
  const render = spawnSync(cli, ["render", resolve(project), "--output", fine, "--fps", String(fps * n), "--workers", "1", "--quality", quality, "--no-browser-gpu", "--quiet"], { stdio: ["ignore", "inherit", "inherit"] });
  if (render.status !== 0) { console.error("the capture render failed"); process.exit(1); }
  const captured = (Date.now() - started) / 1000;
  const blend = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", fine,
    "-vf", `tmix=frames=${n},select='eq(mod(n\\,${n})\\,${n - 1})',setpts=PTS-STARTPTS`,
    "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", resolve(val("output"))], { stdio: ["ignore", "inherit", "inherit"] });
  if (blend.status !== 0) { console.error("the sub-frame blend failed"); process.exit(1); }
  console.log(`wrote ${resolve(val("output"))}: ${fps} fps from ${fps * n} fps capture (${n} sub-frames); capture ${captured.toFixed(1)} s, total ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally { rmSync(dir, { recursive: true, force: true }); }
