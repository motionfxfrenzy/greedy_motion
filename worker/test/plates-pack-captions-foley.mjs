// A template pack's film through the worker's assembler: one-word "shadow" captions (more than FULL_FRAME_SUBTITLES_MAX, so each
// overlay is cropped to its box) and the pack's own foley cues from the shipped library. Checks the crop puts the word exactly
// where the full-frame overlay does, and that the film encodes with the foley audible on its frame.
//   node worker/test/plates-pack-captions-foley.mjs        (needs ffmpeg; runs on the host or in the worker image)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
const { assemble, renderSubtitlePng, renderSubtitleOverlay, FULL_FRAME_SUBTITLES_MAX } = await import("../src/plates.mjs");

const W = 1080, H = 1920, FPS = 30;
const sub = { mode: "full", style: "shadow", size: 101, opacity: 100, x: 50, y: 46, wordsPerCue: 1 };

// The cropped overlay is the full-frame one, cut to its box at even offsets.
const full = await sharp(await renderSubtitlePng("Yesterday,", sub, W, H)).raw().toBuffer({ resolveWithObject: true });
const crop = await renderSubtitleOverlay("Yesterday,", sub, W, H);
const part = await sharp(crop.png).raw().toBuffer({ resolveWithObject: true });
assert.equal(crop.x % 2, 0); assert.equal(crop.y % 2, 0);
assert.ok(part.info.width < W / 1.2 && part.info.height < H / 6, "the overlay is only the caption's box");
let opaque = 0, outside = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = full.data[(y * W + x) * 4 + 3];
  if (!a) continue;
  opaque += 1;
  const inBox = x >= crop.x && x < crop.x + part.info.width && y >= crop.y && y < crop.y + part.info.height;
  if (!inBox) outside += 1;
  else assert.equal(part.data[((y - crop.y) * part.info.width + (x - crop.x)) * 4 + 3], a);
}
assert.ok(opaque > 1000, "the word and its shadow are drawn"); assert.equal(outside, 0, "nothing of the caption falls outside the crop");
// centred on y 46%
const rows = []; for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) if (full.data[(y * W + x) * 4 + 3] > 200) { rows.push(y); break; } }
const mid = (rows[0] + rows.at(-1)) / 2;
assert.ok(Math.abs(mid / H - 0.46) < 0.02, `caption centred near 46% of the height (got ${(mid / H * 100).toFixed(1)}%)`);

const dir = mkdtempSync(join(tmpdir(), "plate-pack-"));
try {
  const clip = join(dir, "c0.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x24262c:size=${W}x${H}:rate=30`, "-frames:v", "150", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", clip]);
  const words = "Yesterday I put one red dot on a sheep and by morning the whole flock had turned away from it without one sound or look back at the dot I made with my marker and that was all it took to start".split(" ");
  assert.ok(words.length > FULL_FRAME_SUBTITLES_MAX);
  const cues = words.map((text, k) => ({ scene: 0, start: k * 0.1, end: (k + 1) * 0.1, text }));
  const sfx = [{ scene: 0, name: "foley-mark", offset: 2, volume: 0.9 }, { scene: 0, name: "foley-bleat", offset: 3, volume: 0.9 }];
  const manifest = { schema: 2, projectId: "p", aspect: "9:16", width: W, height: H, fps: FPS, totalFrames: 150, watermark: false, voiceOn: false, subtitles: sub, cues, sfx, music: null, scenes: [{ index: 0, startFrame: 0, frames: 150, voice: null }] };
  const out = join(dir, "film.mp4");
  const r = await assemble(manifest, { clipFiles: [clip], scratch: dir, output: out, audioFiles: {} });
  assert.equal(r.streamCopy, false);
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
  const peakIn = (a, b) => { let p = 0; for (let i = Math.round(a * 8000); i < Math.round(b * 8000); i++) p = Math.max(p, Math.abs(pcm.readInt16LE(i * 2))); return p; };
  assert.ok(peakIn(0, 1.9) < 50, "silence before the first foley cue");
  assert.ok(peakIn(1.98, 2.3) > 1000, "foley-mark lands on its frame (2 s)");
  assert.ok(peakIn(2.98, 3.6) > 1000, "foley-bleat lands on its frame (3 s)");
  const frame = await sharp(execFileSync("ffmpeg", ["-v", "error", "-ss", "0.05", "-i", out, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 1 << 26 })).raw().toBuffer({ resolveWithObject: true });
  let bright = 0; for (let i = 0; i < frame.data.length; i += frame.info.channels) if (frame.data[i] > 200) bright += 1;
  assert.ok(bright > 500, "the first word is burnt into the picture");
  console.log("plate pack captions + foley: ok");
} finally { rmSync(dir, { recursive: true, force: true }); }
