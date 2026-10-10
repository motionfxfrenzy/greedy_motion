#!/usr/bin/env node
// pop_gate.mjs: scans a finished video for single-frame pops and counts hard cuts.
//
//   node pop_gate.mjs <video.mp4> [--max-cuts N] [--json] [--size 160]
//   node pop_gate.mjs --self-test
//
// A single-frame pop is a frame that differs from BOTH neighbours while the neighbours still resemble each other:
// a z-index flash, a state flip that lasts one frame, a layer that blinks, a white flash at a seam. A person misses
// these at speed and the other gates (lint, seek safety, freezedetect) cannot see them, because they read the
// composition or look for stillness, not for a frame that disagrees with its own surroundings.
//
// A hard cut is a frame pair whose difference is far above the local run of differences and does not return.
// Cuts are reported, never failed, unless --max-cuts is given: a one-take film passes `--max-cuts 0`, a launch film
// with N designed hard cuts passes N, so an accidental cut still fails.
//
// Exit 1 on any pop, or on more cuts than --max-cuts. Needs ffmpeg on PATH.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const POP_MIN = 0.02;      // both flanking differences must exceed this (mean absolute luma difference, 0..1)
const POP_RETURN = 0.4;    // and the frames either side of the pop must differ by < 40% of the smaller flank
const CUT_MIN = 0.08;      // a cut moves at least this much of the frame...
const CUT_RUN = 3;         // a cut lasts at most this many frames; longer is fast motion
const CUT_RATIO = 6;       // ...and at least this many times the local median difference

async function scan(video, size = 160) {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,width,height", "-of", "json", video], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`ffprobe could not read ${video}`);
  const stream = JSON.parse(probe.stdout).streams[0];
  const [n, d] = stream.r_frame_rate.split("/").map(Number);
  const fps = n / (d || 1);
  const w = size, h = Math.max(2, Math.round((size * stream.height) / stream.width / 2) * 2);
  const frameBytes = w * h;
  const diffs = [];            // diffs[i] = difference between frame i-1 and frame i (index 0 unused)
  const skip = [];             // skip[i] = difference between frame i-2 and frame i
  const ring = [];
  let count = 0, pending = Buffer.alloc(0);
  const ff = spawn("ffmpeg", ["-v", "error", "-i", video, "-vf", `scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "inherit"] });
  const mad = (a, b) => { let s = 0; for (let i = 0; i < frameBytes; i++) s += Math.abs(a[i] - b[i]); return s / frameBytes / 255; };
  const push = (frame) => {
    ring.push(frame); if (ring.length > 3) ring.shift();
    diffs[count] = count > 0 ? mad(ring[ring.length - 2], frame) : 0;
    skip[count] = count > 1 ? mad(ring[0], frame) : 1;
    count++;
  };
  await new Promise((done, fail) => {
    ff.stdout.on("data", (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= frameBytes) { push(Buffer.from(pending.subarray(0, frameBytes))); pending = pending.subarray(frameBytes); }
    });
    ff.on("error", fail);
    ff.on("close", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
  });
  return { fps, frames: count, diffs, skip };
}

function analyse({ fps, frames, diffs, skip }) {
  const pops = [], cuts = [];
  // pop at frame t: diffs[t] and diffs[t+1] both large, skip[t+1] (frame t-1 vs t+1) small.
  for (let t = 1; t < frames - 1; t++) {
    const flank = Math.min(diffs[t], diffs[t + 1]);
    if (flank > POP_MIN && skip[t + 1] < POP_RETURN * flank) pops.push({ frame: t, time: +(t / fps).toFixed(3), flank: +flank.toFixed(3), returns: +skip[t + 1].toFixed(3) });
  }
  const popFrames = new Set(pops.flatMap((p) => [p.frame, p.frame + 1]));
  // Hard cuts: frames whose change is far above the local run. Adjacent over-threshold frames are one event; a run
  // longer than CUT_RUN is sustained fast motion (a push, a flood), not a cut, and is reported as `fast`.
  const over = [];
  for (let t = 1; t < frames; t++) {
    if (popFrames.has(t)) continue;
    const win = diffs.slice(Math.max(1, t - 15), Math.min(frames, t + 16)).sort((a, b) => a - b);
    const median = win[Math.floor(win.length / 2)] || 0;
    if (diffs[t] > CUT_MIN && diffs[t] > CUT_RATIO * Math.max(median, 0.002)) over.push(t);
  }
  const fast = [];
  for (let i = 0; i < over.length;) {
    let j = i;
    while (j + 1 < over.length && over[j + 1] - over[j] <= 2) j++;
    const run = over.slice(i, j + 1), peak = run.reduce((a, b) => (diffs[b] > diffs[a] ? b : a));
    const event = { frame: peak, time: +(peak / fps).toFixed(3), change: +diffs[peak].toFixed(3), frames: run.length };
    (run.length <= CUT_RUN ? cuts : fast).push(event);
    i = j + 1;
  }
  return { fps, frames, pops, cuts, fast };
}

async function gate(video, { maxCuts, json }) {
  const result = analyse(await scan(video, Number(val("size", 160))));
  const cutsFail = maxCuts != null && result.cuts.length > maxCuts;
  const ok = result.pops.length === 0 && !cutsFail;
  if (json) console.log(JSON.stringify({ ok, maxCuts: maxCuts ?? null, ...result }, null, 2));
  else {
    console.log(`${video}: ${result.frames} frames at ${result.fps.toFixed(2)} fps`);
    for (const p of result.pops) console.log(`  POP  frame ${p.frame} (${p.time}s): differs ${p.flank} from both neighbours, which differ only ${p.returns} from each other`);
    for (const c of result.cuts) console.log(`  cut  frame ${c.frame} (${c.time}s): ${c.change} of the frame changed at once`);
    for (const f of result.fast) console.log(`  fast frame ${f.frame} (${f.time}s): ${f.frames} frames of sustained large change, peak ${f.change} (a fast move: slow it down or render it with sub-frames)`);
    console.log(`${result.pops.length} pop${result.pops.length === 1 ? "" : "s"}, ${result.cuts.length} hard cut${result.cuts.length === 1 ? "" : "s"}${maxCuts != null ? ` (allowed ${maxCuts})` : ""}.`);
    console.log(ok ? "POP GATE: PASS" : "POP GATE: FAIL");
  }
  return ok;
}

async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "pop-gate-"));
  const make = (name, vf, extra = []) => {
    const out = join(dir, name);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3", "-vf", vf, "-pix_fmt", "yuv420p", "-crf", "12", ...extra, out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return out;
  };
  try {
    const clean = make("clean.mp4", "null");
    const popped = make("pop.mp4", "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,45)'");
    const cutSrc = join(dir, "cut.mp4");
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=1.5", "-f", "lavfi", "-i", "mandelbrot=size=320x180:rate=30", "-filter_complex", "[1:v]trim=duration=1.5,setpts=PTS-STARTPTS[b];[0:v][b]concat=n=2:v=1:a=0", "-pix_fmt", "yuv420p", "-crf", "12", cutSrc], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const a = analyse(await scan(clean)), b = analyse(await scan(popped)), c = analyse(await scan(cutSrc));
    const checks = [
      ["clean clip: no pops", a.pops.length === 0],
      ["clean clip: no cuts", a.cuts.length === 0],
      ["white flash on frame 45 is a pop", b.pops.some((p) => p.frame === 45)],
      ["hard cut is a cut, not a pop", c.cuts.length === 1 && c.pops.length === 0]
    ];
    let ok = true;
    for (const [label, pass] of checks) { console.log(`${pass ? "PASS" : "FAIL"}  ${label}`); ok &&= pass; }
    if (!ok) console.log(JSON.stringify({ a, b, c }, null, 1));
    return ok;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (has("self-test")) process.exit((await selfTest()) ? 0 : 1);
const video = args.find((a, i) => !a.startsWith("--") && !["--max-cuts", "--size"].includes(args[i - 1]));
if (!video) { console.error("usage: pop_gate.mjs <video.mp4> [--max-cuts N] [--json] | --self-test"); process.exit(2); }
const maxCuts = val("max-cuts") != null ? Number(val("max-cuts")) : undefined;
process.exit((await gate(resolve(video), { maxCuts, json: has("json") })) ? 0 : 1);
