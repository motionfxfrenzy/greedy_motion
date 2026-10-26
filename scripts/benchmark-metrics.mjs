#!/usr/bin/env node
// benchmark-metrics.mjs: the same measurements we took from the two benchmark videos (docs/BENCHMARKS.md), for any MP4.
//   node scripts/benchmark-metrics.mjs <video.mp4> [--json]
// 10 samples per second at 64x36: per-second motion (mean absolute RGB change between samples, 0..1), the hard hits
// (a change above 0.2 in one sample), the strongest peaks, and the average colour every 1.5 s. A benchmark video is one
// whose numbers we are trying to match in character: steady motion everywhere (no dead second), rare hard hits on purpose.
import { spawnSync } from "node:child_process";
const [file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!file) { console.error("usage: benchmark-metrics.mjs <video.mp4> [--json]"); process.exit(2); }
const W = 64, H = 36, bytes = W * H * 3;
const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `fps=10,scale=${W}:${H}:flags=area`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
const buf = r.stdout, n = Math.floor(buf.length / bytes), rows = [];
for (let f = 0; f < n; f++) {
  let R = 0, G = 0, B = 0, d = 0;
  for (let i = 0; i < bytes; i += 3) { R += buf[f * bytes + i]; G += buf[f * bytes + i + 1]; B += buf[f * bytes + i + 2]; if (f) d += Math.abs(buf[f * bytes + i] - buf[(f - 1) * bytes + i]) + Math.abs(buf[f * bytes + i + 1] - buf[(f - 1) * bytes + i + 1]) + Math.abs(buf[f * bytes + i + 2] - buf[(f - 1) * bytes + i + 2]); }
  const px = bytes / 3; rows.push({ t: f / 10, rgb: [Math.round(R / px), Math.round(G / px), Math.round(B / px)], motion: f ? d / px / 765 : 0 });
}
const seconds = Math.ceil(n / 10), perSecond = Array.from({ length: seconds }, (_, s) => { const x = rows.filter((q) => q.t >= s && q.t < s + 1); return +(x.reduce((a, q) => a + q.motion, 0) / x.length).toFixed(3); });
const result = {
  file, seconds: n / 10, meanMotion: +(rows.reduce((a, q) => a + q.motion, 0) / n).toFixed(3), perSecond,
  quietSeconds: perSecond.filter((m) => m < 0.008).length,           // a second with almost no change: dead air
  hardHits: rows.filter((q) => q.motion > 0.2).map((q) => ({ t: +q.t.toFixed(1), motion: +q.motion.toFixed(2) })),
  peaks: rows.filter((q) => q.motion > 0.06).map((q) => `${q.t.toFixed(1)}:${q.motion.toFixed(2)}`),
  colour: rows.filter((_, i) => i % 15 === 0).map((q) => `${q.t.toFixed(1)}s rgb(${q.rgb})`)
};
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else { console.log(`${file}: ${result.seconds}s, mean motion ${result.meanMotion}, quiet seconds ${result.quietSeconds}`); console.log("per second:", perSecond.join(" ")); console.log("hard hits:", result.hardHits.map((h) => `${h.t}s(${h.motion})`).join(" ") || "none"); console.log("peaks:", result.peaks.join(" ")); }
