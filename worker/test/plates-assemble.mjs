// The worker's final assembler: stream copy only when the clips are exactly the timeline and nothing touches pixels; the
// timeline is never shortened; audio mixes to the timeline's length. Uses synthetic clips; needs ffmpeg + ffprobe on PATH.
// Run inside the worker image (it assumes the image's /app layout):
//   docker compose --profile plates-e2e run --rm --no-deps -v $PWD/worker/test:/app/test:ro --entrypoint node plate-worker test/plates-assemble.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { assemble, PLATE_FINAL_VIDEO_ARGS } = await import("../src/plates.mjs");
assert.equal(PLATE_FINAL_VIDEO_ARGS.join(" "), "-c:v libx264 -preset medium -crf 16 -profile:v high -pix_fmt yuv420p", "final re-encode matches the scene clips (CRF 16, medium)");
const { probeVideo } = await import("../plate-engine/capture.mjs").catch(() => import("../../packages/plate-engine/lib/capture.mjs"));

const dir = mkdtempSync(join(tmpdir(), "plate-asm-"));
const ff = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const clip = (name, frames, w = 1920, h = 1080) => { const f = join(dir, name); ff("-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=30`, "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-preset", "ultrafast", f); return f; };
const manifest = (over = {}) => ({ schema: 1, projectId: "p", aspect: "16:9", width: 1920, height: 1080, fps: 30, totalFrames: 150, watermark: false, scenes: [{ index: 0, startFrame: 0, frames: 60, voice: null }, { index: 1, startFrame: 60, frames: 90, voice: null }], music: null, voiceOn: false, subtitles: { mode: "full", style: "pill" }, cues: [], sfx: [], ...over });
try {
  const a = clip("a.mp4", 60), b = clip("b.mp4", 90);
  const probe = async (f) => probeVideo(f);

  let out = join(dir, "copy.mp4");
  let r = await assemble(manifest(), { clipFiles: [a, b], scratch: dir, output: out });
  assert.equal(r.streamCopy, true, "exact frames, no overlays: the pictures are not re-encoded");
  assert.equal((await probe(out)).frames, 150);

  out = join(dir, "subs.mp4");
  r = await assemble(manifest({ cues: [{ scene: 0, start: 0.2, end: 1.5, text: "Hello there" }] }), { clipFiles: [a, b], scratch: dir, output: out });
  assert.equal(r.streamCopy, false, "burned-in subtitles need an encode");
  assert.equal(r.frames, 150);

  out = join(dir, "wm.mp4");
  r = await assemble(manifest({ watermark: true }), { clipFiles: [a, b], scratch: dir, output: out });
  assert.equal(r.streamCopy, false, "the plan's watermark needs an encode");

  // a clip one frame short is never "close enough": it is retimed to its slot and the timeline keeps its length
  const short = clip("short.mp4", 89);
  out = join(dir, "out-short.mp4");
  r = await assemble(manifest(), { clipFiles: [a, short], scratch: dir, output: out });
  assert.equal(r.streamCopy, false);
  assert.equal(r.frames, 150, "the timeline is not shortened to fit the clip");

  // a clip of the wrong size cannot be stream-copied either
  const small = clip("small.mp4", 90, 1280, 720);
  out = join(dir, "out-small.mp4");
  r = await assemble(manifest(), { clipFiles: [a, small], scratch: dir, output: out });
  assert.equal(r.streamCopy, false);
  const p = await probe(out); assert.equal(p.width, 1920); assert.equal(p.frames, 150);

  // sound effects only (no voice, no music): audio exists and ends with the picture
  out = join(dir, "sfx.mp4");
  r = await assemble(manifest({ sfx: [{ scene: 1, name: "pop", offset: 0.2, volume: 0.7 }] }), { clipFiles: [a, b], scratch: dir, output: out });
  assert.equal(r.audioTracks, 1);
  const dur = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", out])).streams;
  const vd = Number(dur.find((s) => s.codec_type === "video").duration), ad = Number(dur.find((s) => s.codec_type === "audio").duration);
  assert.ok(Math.abs(vd - ad) < 0.06, `audio (${ad}) ends with the picture (${vd})`);
  assert.ok(Math.abs(vd - 5) < 0.04, "150 frames at 30 fps");
  console.log("plate assemble: ok");
} finally { rmSync(dir, { recursive: true, force: true }); }
