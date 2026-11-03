// Parity of the worker's assembler with the pipeline it replaced: the same clips, voice, music, effects and subtitle overlay are
// assembled by (a) a verbatim copy of the previous in-process ffmpeg graph (backend plates.ts renderPlateFilm, encode branch) and
// (b) the worker's assemble(); decoded video frames and decoded audio samples must be identical.
// Run inside the worker image:
//   docker compose --profile plates-e2e run --rm --no-deps -v $PWD/worker/test:/app/test:ro --entrypoint node plate-worker test/plates-legacy-parity.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { assemble, renderSubtitlePng } = await import("../src/plates.mjs");

const dir = mkdtempSync(join(tmpdir(), "plate-parity-"));
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const md5 = (file, map) => execFileSync("ffmpeg", ["-v", "error", "-i", file, ...map, "-f", "md5", "-"]).toString().trim();
const W = 1920, H = 1080, FPS = 30;
try {
  const clip = (name, frames) => { const f = join(dir, name); ff("-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=30`, "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "ultrafast", f); return f; };
  const clips = [clip("c0.mp4", 75), clip("c1.mp4", 105)];
  const tone = (name, hz, sec) => { const f = join(dir, name); ff("-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${sec}`, f); return f; };
  const voice = [tone("v0.wav", 330, 2.0), tone("v1.wav", 440, 3.0)];
  const music = tone("m.wav", 220, 1.2);
  const sfx = [{ scene: 0, name: "pop", offset: 0.2, volume: 0.72 }, { scene: 1, name: "chime", offset: 0.18, mediaStart: 0.2, volume: 0.9 }];
  const cues = [{ scene: 0, start: 0.1, end: 2.3, text: "A first caption" }, { scene: 1, start: 2.6, end: 5.9, text: "The second caption here" }];
  const subtitles = { mode: "full", style: "pill", size: 100, opacity: 100, x: 50, y: 88 };
  const manifest = {
    schema: 1, projectId: "p", aspect: "16:9", width: W, height: H, fps: FPS, totalFrames: 180, watermark: false, voiceOn: true, subtitles, cues, sfx,
    scenes: [{ index: 0, startFrame: 0, frames: 75, voice: { key: "k0", seconds: 2.0 } }, { index: 1, startFrame: 75, frames: 105, voice: { key: "k1", seconds: 3.0 } }], music: { key: "m" }
  };
  // ---- (a) the previous graph, verbatim in structure
  const total = 6, starts = [0, 2.5], durs = [2.5, 3.5], SFX = "/app/templates/beat-plan/sfx";
  const inputs = [], filters = [];
  clips.forEach((f, i) => { inputs.push("-i", f); const ratio = durs[i] / (clips.length && (i ? 3.5 : 2.5)); filters.push(`[${i}:v]setpts=${ratio.toFixed(6)}*PTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${durs[i].toFixed(3)},setpts=PTS-STARTPTS[v${i}]`); });
  filters.push(`[v0][v1]concat=n=2:v=1:a=0[vbase0]`);
  let nextIdx = 2;
  for (const [i, cue] of cues.entries()) { const png = join(dir, `old-sub-${i}.png`); writeFileSync(png, await renderSubtitlePng(cue.text, subtitles, W, H)); inputs.push("-i", png); filters.push(`[vbase${i}][${nextIdx}:v]overlay=0:0:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'[${i === cues.length - 1 ? "vout" : `vbase${i + 1}`}]`); nextIdx++; }
  const labels = [];
  voice.forEach((f, i) => { inputs.push("-i", f); const d = Math.round(starts[i] * 1000); filters.push(`[${nextIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${d}|${d},apad=whole_dur=${total.toFixed(3)}[avo${i}]`); labels.push(`[avo${i}]`); nextIdx++; });
  inputs.push("-stream_loop", "-1", "-i", music);
  filters.push(`[${nextIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.22,atrim=0:${total.toFixed(3)},afade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5,asetpts=PTS-STARTPTS[amusic]`); labels.push("[amusic]"); nextIdx++;
  sfx.forEach((cue, k) => { inputs.push("-i", join(SFX, `${cue.name}.mp3`)); const d = Math.round((starts[cue.scene] + cue.offset) * 1000); const trim = cue.mediaStart ? `atrim=start=${cue.mediaStart.toFixed(3)},asetpts=PTS-STARTPTS,` : ""; filters.push(`[${nextIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${trim}volume=${cue.volume.toFixed(2)},adelay=${d}|${d},apad=whole_dur=${total.toFixed(3)}[asfx_${k}]`); labels.push(`[asfx_${k}]`); nextIdx++; });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  const oldOut = join(dir, "old.mp4");
  ff(...inputs.length ? ["-y", ...inputs] : [], "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", oldOut);

  // ---- (b) the worker's assembler, same inputs (audio files are read from a local map instead of R2)
  const storage = await import("../src/storage.mjs");
  const files = { k0: voice[0], k1: voice[1], m: music };
  const newOut = join(dir, "new.mp4");
  // assemble() downloads audio by key; stage them as the worker would, through a local stand-in for the bucket
  process.env.PLATE_LOCAL_AUDIO = JSON.stringify(files);
  const r = await assemble(manifest, { clipFiles: clips, scratch: dir, output: newOut, audioFiles: files });
  assert.equal(r.streamCopy, false);
  const v0 = md5(oldOut, ["-map", "0:v:0"]), v1 = md5(newOut, ["-map", "0:v:0"]);
  const a0 = md5(oldOut, ["-map", "0:a:0", "-c:a", "pcm_s16le"]), a1 = md5(newOut, ["-map", "0:a:0", "-c:a", "pcm_s16le"]);
  console.log({ video: [v0, v1], audio: [a0, a1] });
  assert.equal(v1, v0, "decoded video frames are identical to the previous graph's");
  assert.equal(a1, a0, "decoded audio samples are identical to the previous graph's");
  void storage;
  console.log("plate legacy parity: ok");
} finally { rmSync(dir, { recursive: true, force: true }); }
