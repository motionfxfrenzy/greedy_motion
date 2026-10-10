#!/usr/bin/env node
// seam_sheet.mjs: a phone-sized contact sheet of the frames in the MIDDLE of every transition, with the safe zones drawn.
//
//   node seam_sheet.mjs <video.mp4> --auto [--out sheet.png]       frames at every cut or fast move pop_gate.mjs finds
//   node seam_sheet.mjs <video.mp4> --at 2.6,5.1,7.9 [--out ...]   frames at the times you give (scene boundaries)
//
// Why: a laptop shows every frame bigger than a viewer will see it, and the defects that survive every other gate sit in
// the middle of a seam: a layer that vanishes against its background, a prop over a face, text clipped by a flood, an
// element floating above a wipe it should be under. Look at the sheet, not at the timeline.
//
// Safe zones: portrait (taller than 1.5:1) gets the platform UI strips, top 13% and bottom 21.9% (250 and 420 px of a
// 1080x1920 frame); landscape and square get the 90% action-safe and 80% title-safe boxes (Premiere defaults, the same
// numbers Studio uses). Anything that matters and sits in a shaded strip or outside the inner box is a finding.
// Needs ffmpeg and ffprobe on PATH. Prints the time of each cell in reading order.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const video = args.find((a, i) => !a.startsWith("--") && !["--at", "--out", "--width", "--cols"].includes(args[i - 1]));
if (!video || (!has("auto") && !has("at"))) { console.error("usage: seam_sheet.mjs <video.mp4> (--auto | --at t1,t2,...) [--out sheet.png] [--width 390] [--cols 6]"); process.exit(2); }

const run = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`); return r.stdout; };
const src = resolve(video);
const probe = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", src]));
const { width: W, height: H } = probe.streams[0];
const duration = Number(probe.format.duration);

let times;
if (has("auto")) {
  const gate = join(dirname(fileURLToPath(import.meta.url)), "pop_gate.mjs");
  const r = spawnSync(process.execPath, [gate, src, "--json"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const found = JSON.parse(r.stdout);
  times = [...found.cuts, ...found.fast].map((e) => e.time);
  if (!times.length) { console.log("No cuts or fast moves found; nothing to sample. Give scene boundaries with --at."); process.exit(0); }
} else times = val("at").split(",").map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t < duration);
times = [...new Set(times)].sort((a, b) => a - b).slice(0, 48);

const cellW = Math.round(Number(val("width", 390)) / 2) * 2, cellH = Math.round((cellW * H) / W / 2) * 2;
const portrait = H / W > 1.5;
const box = (x, y, w, h, color, t) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=${t}`;
const zones = portrait
  ? [box(0, 0, cellW, Math.round(cellH * 0.13), "red@0.35", "fill"), box(0, Math.round(cellH * (1 - 0.219)), cellW, Math.round(cellH * 0.219), "red@0.35", "fill")]
  : [box(Math.round(cellW * 0.05), Math.round(cellH * 0.05), Math.round(cellW * 0.9), Math.round(cellH * 0.9), "yellow@0.9", 1), box(Math.round(cellW * 0.1), Math.round(cellH * 0.1), Math.round(cellW * 0.8), Math.round(cellH * 0.8), "cyan@0.9", 1)];

const dir = mkdtempSync(join(tmpdir(), "seam-sheet-"));
try {
  times.forEach((t, i) => run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", src, "-frames:v", "1", "-vf", [`scale=${cellW}:${cellH}:flags=area`, ...zones].join(","), join(dir, `${String(i + 1).padStart(3, "0")}.png`)]));
  const cols = Math.min(Number(val("cols", 6)), times.length), rows = Math.ceil(times.length / cols);
  const out = resolve(val("out", "seam-sheet.png"));
  mkdirSync(dirname(out), { recursive: true });
  run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", join(dir, "%03d.png"), "-vf", `tile=${cols}x${rows}:padding=6:color=0x202020`, "-frames:v", "1", out]);
  console.log(`${out}  (${cellW}x${cellH} per cell, ${cols}x${rows}, ${portrait ? "platform UI strips shaded red" : "yellow = action safe 90%, cyan = title safe 80%"})`);
  times.forEach((t, i) => console.log(`  cell ${i + 1}: ${t.toFixed(3)}s`));
} finally { rmSync(dir, { recursive: true, force: true }); }
