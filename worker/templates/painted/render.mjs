#!/usr/bin/env node
/*
 * Painted shorts: a spec (lines, the picture for each, the look, the voice recordings) in, a captioned, narrated MP4 out.
 *
 *   node render.mjs <spec.json> <out.mp4> [--width 720] [--sheet <dir>]
 *   node render.mjs <spec.json> --preview <dir> [--width 540]    no video: writes the timeline and the mixed sound for the live player (preview.mjs)
 *
 * --sheet writes one painted still per shot and a contact sheet (sheet.jpg) instead of the film: look at it before rendering.
 * The spec is the director's output (see SPEC.md). Each line is narrated by its own recording (`audio.file`, e.g. Gemini TTS); the
 * lines are laid end to end with a short pause, the shots of a line share its time, and the captions follow the spoken words.
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findBrowser } from "./browser.mjs";
import { serve } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const previewDir = flag("--preview"), widthArg = flag("--width") ?? (previewDir ? "540" : null), sheetDir = flag("--sheet");
const [specPath, outPath] = args;
if (!specPath || (!outPath && !sheetDir && !previewDir)) { console.error("usage: node render.mjs <spec.json> <out.mp4> [--width 720] [--sheet <dir>] | <spec.json> --preview <dir> [--width 540]"); process.exit(2); }
const { normalize } = await import("./lint.mjs");
const linted = normalize(JSON.parse(fs.readFileSync(specPath, "utf8")));
const spec = linted.spec;
for (const n of linted.notes) console.log("· lint " + n);
const base = path.dirname(path.resolve(specPath));

const FORMATS = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
const [fw, fh] = FORMATS[spec.format ?? "9:16"] ?? FORMATS["9:16"];
const scale = widthArg ? Number(widthArg) / fw : 1;
const W = Math.round((fw * scale) / 2) * 2, H = Math.round((fh * scale) / 2) * 2;
const fps = spec.fps ?? 24, twos = spec.twos ?? 2;
const run = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || "").slice(-400)}`); return r.stdout; };
const duration = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());

// lightning in a storm shot: seconds into the shot, the same times for the picture and the thunder
function lightningTimes(shot, dur, id) {
  if (shot.weather !== "storm") return [];
  let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = []; let t = 0.6 + ((h >>> 0) % 9) / 10;
  for (let i = 0; t < dur - 0.3; i++) { out.push(Number(t.toFixed(2))); t += 2.4 + (((h >>> (i * 3)) & 7) / 7) * 1.6; }
  return out;
}
// ---- timeline: lines laid end to end, shots share a line's time, captions in chunks of at most five words ----
const MOVES = ["push", "drift", "pull", "rise", "push", "pan-right", "drift", "fall"];
const pause = spec.pause ?? 0.3, lead = spec.lead ?? 0.35, tail = spec.tail ?? 0.9;
let cursor = lead; const beats = [], captions = [], voiceFiles = [];
(spec.lines ?? []).forEach((line, li) => {
  const file = line.audio?.file ? path.resolve(base, line.audio.file) : null;
  const spoken = file ? duration(file) : line.audio?.seconds ?? Math.max(1.5, (line.say?.split(/\s+/).length ?? 4) * 0.45);
  const start = cursor, end = start + spoken + (line.hold ?? 0);
  if (file) voiceFiles.push({ file, start, spoken });
  const shots = line.shots?.length ? line.shots : [{ place: "meadow", time: "day" }];
  const n = shots.length, per = (end - start) / n;
  shots.forEach((shot, si) => beats.push({ flashes: lightningTimes(shot, (end - start) / n, `l${li}s${si}`), id: `l${li}s${si}`, t0: start + si * per, t1: start + (si + 1) * per, move: shot.move ?? MOVES[beats.length % MOVES.length], moveAmount: shot.moveAmount, shot, seed: shot.seed ?? ""}));
  // captions: chunks of <=5 words, timed by character share of the spoken span (word timings from the aligner replace this when present)
  const words = (line.caption ?? line.say ?? "").trim().split(/\s+/).filter(Boolean), chunks = [];
  for (let i = 0; i < words.length; i += 5) chunks.push(words.slice(i, i + 5));
  const even = Math.ceil(words.length / Math.max(1, Math.ceil(words.length / 5)));
  const sized = []; for (let i = 0; i < words.length; i += even) sized.push(words.slice(i, i + even));
  const totalChars = sized.reduce((s, c) => s + c.join(" ").length + 1, 0); let c0 = start;
  sized.forEach((ch) => { const share = ((ch.join(" ").length + 1) / totalChars) * spoken; captions.push({ text: ch.join(" "), t0: c0, t1: c0 + share }); c0 += share; });
  cursor = end + pause;
});
const total = cursor - pause + tail;
// a plate's frames depend on the film, so its content hash goes into the beat (and from there into every drawing's cache key)
{ const { PLATES } = await import("./vocab.mjs"); for (const b of beats) if (b.shot.place === "plate") b.plateHash = PLATES[b.shot.plate]?.hash; }
if (beats.length) { beats[0].fadeIn = 0.4; beats[beats.length - 1].t1 = total; beats[beats.length - 1].fadeOut = 0.8; }


// ---- sound: the voice is the loudest thing; music and effects sit under it and duck whenever it speaks ----
const AMBIENCE = (shot) => {
  const out = [], place = shot.place ?? "meadow", wx = shot.weather ?? "clear", night = ["night", "dusk"].includes(shot.time);
  if (["sea", "lake", "shore"].includes(place)) out.push({ src: "anoisesrc=c=brown:a=0.9", fx: "lowpass=f=420,tremolo=f=0.16:d=0.7", vol: wx === "storm" ? 0.75 : wx === "rain" ? 0.55 : 0.4 });
  if (wx === "rain" || wx === "storm") out.push({ src: "anoisesrc=c=pink:a=0.6", fx: "highpass=f=1400,lowpass=f=9000", vol: wx === "storm" ? 0.42 : 0.32 });
  if (wx === "blizzard" || wx === "sandstorm") out.push({ src: "anoisesrc=c=pink:a=0.8", fx: "bandpass=f=700:width_type=h:w=600,tremolo=f=0.4:d=0.85", vol: 0.5 }, { src: "anoisesrc=c=white:a=0.5", fx: "highpass=f=3000,tremolo=f=0.3:d=0.7", vol: 0.12 });
  if (wx === "storm") out.push({ src: "anoisesrc=c=brown:a=0.9", fx: "bandpass=f=500:width_type=h:w=400,tremolo=f=0.3:d=0.8", vol: 0.3 });
  if (wx === "snow" || wx === "fog" || wx === "cloudy" || place === "mountains" || place === "hills" || place === "field") out.push({ src: "anoisesrc=c=brown:a=0.8", fx: "bandpass=f=350:width_type=h:w=300,tremolo=f=0.1:d=0.8", vol: 0.28 });
  if (["city", "street", "village"].includes(place)) out.push({ src: "anoisesrc=c=brown:a=0.8", fx: "lowpass=f=260", vol: 0.22 });
  if (["meadow", "forest", "field", "road"].includes(place) && !night && wx === "clear") out.push({ src: "anoisesrc=c=pink:a=0.5", fx: "bandpass=f=3200:width_type=h:w=1800,tremolo=f=5:d=0.95,tremolo=f=0.25:d=0.8", vol: 0.05 });
  if (place === "interior") { out.length = 0; out.push({ src: "anoisesrc=c=pink:a=0.6", fx: "highpass=f=2500,tremolo=f=11:d=0.9", vol: 0.1 }, { src: "anoisesrc=c=brown:a=0.8", fx: "lowpass=f=200", vol: 0.12 }); if (wx === "snow" || wx === "blizzard" || wx === "storm" || wx === "rain") out.push({ src: "anoisesrc=c=pink:a=0.6", fx: "lowpass=f=900", vol: 0.12 }); }
  if (!out.length) out.push({ src: "anoisesrc=c=brown:a=0.8", fx: "lowpass=f=300,tremolo=f=0.12:d=0.6", vol: 0.2 });
  return out;
};
// Accents: the sounds of the moments that matter (a flash of lightning, a light seen, a cheer). They have their own layer, mid-range so that a
// phone speaker plays them, and duck under the voice only a little, so they are never lost. Each is a list of layers: [source, filter, seconds, volume, offset].
const ACCENTS = {
  thunder: [["anoisesrc=c=white:a=0.9", "bandpass=f=2200:width_type=h:w=3500,afade=t=out:st=0.05:d=0.5", 0.6, 1.0, 0], ["anoisesrc=c=brown:a=0.9", "lowpass=f=450,tremolo=f=11:d=0.45", 3.6, 1.2, 0.05], ["anoisesrc=c=pink:a=0.6", "bandpass=f=220:width_type=h:w=240", 2.6, 0.8, 0.2]],
  crash: [["anoisesrc=c=white:a=0.8", "bandpass=f=900:width_type=h:w=1800,afade=t=in:d=0.5", 1.8, 0.7, 0], ["anoisesrc=c=brown:a=0.9", "lowpass=f=300", 2.0, 0.9, 0.1]],
  splash: [["anoisesrc=c=white:a=0.8", "lowpass=f=3800", 0.6, 0.6, 0]],
  chime: [["aevalsrc='0.5*sin(2*PI*880*t)*exp(-3*t)+0.3*sin(2*PI*1320*t)*exp(-4*t)':s=48000", "", 2.4, 0.5, 0]],
  bell: [["aevalsrc='0.5*sin(2*PI*392*t)*exp(-1.4*t)+0.3*sin(2*PI*784*t)*exp(-2*t)+0.2*sin(2*PI*1176*t)*exp(-3*t)':s=48000", "", 3.2, 0.5, 0]],
  cheer: [["anoisesrc=c=pink:a=0.7", "bandpass=f=1300:width_type=h:w=1800,tremolo=f=7:d=0.5", 2.6, 0.45, 0]],
  knock: [["aevalsrc='0.9*sin(2*PI*120*t)*exp(-28*t)':s=48000", "", 0.5, 1.0, 0], ["aevalsrc='0.9*sin(2*PI*110*t)*exp(-28*t)':s=48000", "", 0.5, 1.0, 0.32]],
  birds: [["aevalsrc='0.3*sin(2*PI*(3200+900*sin(2*PI*10*t))*t)*lt(mod(t,0.7),0.15)*sin(PI*mod(t,0.7)/0.15)':s=48000", "", 3.0, 0.5, 0]]
};
const stormy = (s) => ["rain", "storm"].includes(s?.weather);
/** The moments that matter in beat i, from what is in the shot, plus anything the director asked for by name. */
function momentsOf(i) {
  const b = beats[i], prev = beats[i - 1], sh = b.shot, has = (s, ...k) => s?.props?.some((p) => k.includes(p.kind)), out = new Map();
  const put = (name, at) => { if (!out.has(name)) out.set(name, at); };
  for (const f of b.flashes || []) out.set("thunder@" + f, f + 0.2);
  if (sh.weather === "storm" && prev?.shot.weather !== "storm") put("crash", 0.15);
  if (has(sh, "beam", "lamp") && !has(prev?.shot, "beam", "lamp")) put("chime", 0.1);
  if ((sh.subjects ?? []).filter((s) => s.pose === "cheer").length >= 2) put("cheer", 0.2);
  if (["dawn", "morning"].includes(sh.time) && (sh.weather ?? "clear") === "clear" && stormy(prev?.shot)) put("birds", 0.4);
  for (const name of sh.sfx ?? []) if (ACCENTS[name]) put(name, 0.2);
  return [...out].map(([name, at]) => ({ name: name.split("@")[0], at: b.t0 + at }));
}
function buildMix({ track, music, mix }) {
  const inputs = [], chains = [], sfx = [], acc = []; let n = 0;
  const add = (src, fx, t0, dur, vol, fade, bucket = sfx) => {
    const i = n++; inputs.push("-f", "lavfi", "-t", dur.toFixed(2), "-i", src);
    chains.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,${fx ? fx + "," : ""}volume=${vol},afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, dur - fade).toFixed(2)}:d=${fade},adelay=${Math.round(t0 * 1000)}:all=1[s${i}]`); bucket.push(`[s${i}]`);
  };
  beats.forEach((b, i) => {
    const t0 = Math.max(0, b.t0 - 0.5), dur = b.t1 - t0 + 0.5;
    for (const a of AMBIENCE(b.shot)) add(a.src + `:d=${dur.toFixed(2)}:r=48000`, a.fx, t0, dur, a.vol, 0.5);
    if (i > 0) add("anoisesrc=c=white:a=0.5:d=0.7:r=48000", "bandpass=f=1800:width_type=h:w=1800,afade=t=in:d=0.25", Math.max(0, b.t0 - 0.2), 0.7, 0.07, 0.3);
    for (const m of momentsOf(i)) for (const [src, fx, secs, vol, off] of ACCENTS[m.name]) add(src.includes("aevalsrc") ? `${src}:d=${secs}` : `${src}:d=${secs}:r=48000`, fx, m.at + off, secs, vol, Math.min(0.3, secs / 3), acc);
  });
  { const tally = {}; beats.forEach((_, i) => momentsOf(i).forEach((m) => { tally[m.name] = (tally[m.name] || 0) + 1; })); console.log("· sound: " + beats.length + " shots of ambience, " + Object.entries(tally).map(([k, v]) => v + "x " + k).join(", ") + (music ? ", music bed" : ", no music")); }
  let bed = [];
  if (music) { const i = n++; inputs.push("-stream_loop", "-1", "-i", music); chains.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${spec.audio?.musicVolume ?? 0.55},afade=t=in:d=1.5,afade=t=out:st=${(total - 3).toFixed(2)}:d=3,atrim=0:${total.toFixed(2)}[mus]`); bed.push("[mus]"); }
  chains.push(`${sfx.join("")}amix=inputs=${sfx.length}:normalize=0,atrim=0:${total.toFixed(2)}[fx]`); bed.push("[fx]");
  if (acc.length) chains.push(`${acc.join("")}amix=inputs=${acc.length}:normalize=0,atrim=0:${total.toFixed(2)}[accraw]`);
  let filter = chains.join(";") + `;${bed.join("")}amix=inputs=${bed.length}:normalize=0[bedraw]`;
  if (track) {
    const v = n++; inputs.push("-i", track);
    filter += `;[${v}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=3[vox][key][key2]`;
    filter += `;[bedraw][key]sidechaincompress=threshold=0.015:ratio=12:attack=15:release=450:makeup=1[bed];[bed]volume=0.5[bedq]`;
    if (acc.length) filter += `;[accraw][key2]sidechaincompress=threshold=0.04:ratio=2.5:attack=10:release=200:makeup=1[accq]`; else filter += `;[key2]anullsink`;
    filter += `;[vox]volume=1.0[voxq];[voxq][bedq]${acc.length ? "[accq]" : ""}amix=inputs=${acc.length ? 3 : 2}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]`;
  } else filter += `;${acc.length ? "[bedraw][accraw]amix=inputs=2:normalize=0," : "[bedraw]"}loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-t", total.toFixed(3), mix]);
}

/** The narration (every recording at its place on one track), then the music and effects under it: one mixed WAV in `work`. */
function makeMix(work) {
  const track = path.join(work, "voice.wav");
  if (voiceFiles.length) {
    const inputs = voiceFiles.flatMap((v) => ["-i", v.file]);
    const filter = voiceFiles.map((v, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(v.start * 1000)}:all=1[a${i}]`).join(";") + ";" + voiceFiles.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${voiceFiles.length}:normalize=0,apad=whole_dur=${total.toFixed(3)}[v]`;
    run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-t", total.toFixed(3), track]);
  }
  const music = spec.audio?.music ? path.resolve(base, spec.audio.music) : null, mix = path.join(work, "mix.wav");
  buildMix({ track: voiceFiles.length > 0 ? track : null, music, mix });
  return mix;
}
// ---- preview: no browser, no video. The timeline and the mixed sound are all the live player needs (it draws the frames itself).
if (previewDir) {
  fs.mkdirSync(previewDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "painted-")), mix = makeMix(work);
  run("ffmpeg", ["-v", "error", "-y", "-i", mix, "-c:a", "aac", "-b:a", "128k", path.join(previewDir, "audio.m4a")]);
  fs.rmSync(work, { recursive: true, force: true });
  const timeline = { W, H, fps, twos, duration: total, look: spec.look ?? "oil", style: spec.style, doodle: spec.doodle, drawIn: spec.drawIn, beats, captions, captionStyle: spec.captions?.style ?? "box", captionSize: spec.captions?.size, captionY: spec.captions?.y };
  fs.writeFileSync(path.join(previewDir, "preview.json"), JSON.stringify({ version: Date.now(), audio: "audio.m4a", timeline }));
  console.log(`✓ ${path.join(previewDir, "preview.json")}  ${total.toFixed(1)}s · ${W}x${H} · ${beats.length} shots`);
  process.exit(0);
}

// ---- the browser ----
const { default: puppeteer } = await import("puppeteer-core");
// Plate films are separate pages the painter drives from an iframe, and Chrome blocks that between file:// pages (opaque origin), so a film with plates is
// served over a local HTTP server (same origin for the painter and the plates). Films without plates keep the file:// page.
const usesPlates = beats.some((b) => b.shot.place === "plate");
const plateServer = usesPlates ? await serve() : null;
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, ignoreDefaultArgs: ["--disable-gpu"], args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist", "--use-angle=" + (process.env.PAINTED_ANGLE || (process.platform === "darwin" ? "metal" : process.env.PAINTED_REQUIRE_GPU === "1" && spec.style !== "doodle" ? "vulkan" : "swiftshader")), "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
let cacheDir, cacheOwned = false;
try {
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on("console", (m) => { if (m.type() === "error") console.error("page:", m.text()); }); page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(plateServer ? `http://127.0.0.1:${plateServer.port}/index.html` : pathToFileURL(path.join(here, "index.html")).href);
  if (usesPlates) { const t0 = Date.now(); await page.evaluate((s) => window.preparePlates(s), { beats }); console.log(`· plates ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`); }
  const info = await page.evaluate((s) => window.initShort(s), { W, H, fps, twos, duration: total, look: spec.look ?? "oil", style: spec.style, doodle: spec.doodle, drawIn: spec.drawIn, beats, captions, captionStyle: spec.captions?.style ?? "box", captionSize: spec.captions?.size, captionY: spec.captions?.y });
  // Hardware GPU only: refuse a software renderer (SwiftShader / llvmpipe / Mesa) instead of silently painting on the CPU.
  // Mac always requires Metal; elsewhere only when PAINTED_REQUIRE_GPU=1 (the AWS GPU worker sets it).
  const GPU_BLOCKED = /swiftshader|llvmpipe|software|mesa|lvp/i;
  const gpuBackend = process.env.PAINTED_ANGLE || (process.platform === "darwin" ? "metal" : "vulkan");
  // A doodle film is plain Canvas 2D (the brush pass never runs), so it never needs the GPU: it may render on a CPU worker (PAINTED_ANGLE=swiftshader, PAINTED_REQUIRE_GPU=0 in that task definition).
  const gpuRequired = spec.style !== "doodle" && (process.platform === "darwin" || process.env.PAINTED_REQUIRE_GPU === "1");
  if (gpuRequired && GPU_BLOCKED.test(info.renderer || "")) throw new Error(`Render requires a hardware GPU (${gpuBackend}); refusing software fallback (renderer: ${info.renderer || "?"})`);
  console.log(`· ${beats.length} shots, ${total.toFixed(1)}s, ${W}x${H}, painter: ${info.renderer || "?"}`);

  if (sheetDir) {
    fs.mkdirSync(sheetDir, { recursive: true });
    // every shot at its start and its end (the camera and the rocking move), labelled with what was asked for
    const describe = (b, at) => {
      const sh = b.shot, who = (sh.subjects || []).map((s) => `${s.pose || "stand"}${s.size ? "/" + s.size : ""}@${s.x ?? "auto"}`).join(", ") || "none", props = (sh.props || []).map((p) => `${p.id || p.kind}${p.on ? " on " + p.on : "@" + (p.x ?? "auto")}`).join(", ") || "none";
      return `#${b.id.replace(/^l(\d+)s(\d+)$/, "$1.$2")} ${at < 0.5 ? "start" : "end"} ${b.t0.toFixed(1)}s ${b.move}\n${sh.place}/${sh.time}/${sh.weather || "clear"}\npeople: ${who}\nprops: ${props}`;
    };
    let n = 0;
    for (let i = 0; i < beats.length; i++) for (const at of [0.08, 0.92]) {
      const data = await page.evaluate(([k, a, text]) => window.still(k, a, text), [i, at, describe(beats[i], at)]);
      fs.writeFileSync(path.join(sheetDir, `s${String(n++).padStart(3, "0")}.jpg`), Buffer.from(data.split(",")[1], "base64"));
    }
    const cols = 6; run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(sheetDir, "s%03d.jpg"), "-vf", `scale=340:-2,tile=${cols}x${Math.ceil(n / cols)}:padding=6:color=white`, "-frames:v", "1", "-q:v", "3", path.join(sheetDir, "sheet.jpg")]);
    console.log("✓ " + path.join(sheetDir, "sheet.jpg")); await browser.close(); process.exit(0);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "painted-")), mix = makeMix(work);
  const ffArgs = ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps / twos), "-i", "-", "-i", mix, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "160k"];
  ffArgs.push("-vf", `fps=${fps}`, "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "9M", "-bufsize", "18M", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", total.toFixed(3), path.resolve(outPath));
  const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => { ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exited " + c)))); ff.stdin.on("error", () => {}); });
  const count = Math.ceil((total * fps) / twos); const t0 = Date.now();
  // Every drawing is cached under a key made of its scene (what is in it, how long, the captions over it), the look, the size and the engine's own
  // code. Change one scene and only its drawings are painted again; the rest are read from disk.
  // The cache is a scratch folder: it is removed when the render ends (done or failed) so drawings never pile up on disk (a film is several GB of frames).
  // PAINTED_KEEP_CACHE=1 keeps it between renders (change one scene, repaint only that one); PAINTED_CACHE=<dir> picks the folder and is never removed.
  cacheOwned = !process.env.PAINTED_CACHE && process.env.PAINTED_KEEP_CACHE !== "1";
  cacheDir = path.resolve(process.env.PAINTED_CACHE || path.join(base, "frames-cache")); fs.mkdirSync(cacheDir, { recursive: true });
  const engine = crypto.createHash("sha1"); for (const f of ["runtime/kit.js", "runtime/layout.js", "runtime/plates.js", "runtime/doodle.js", "runtime/scenes.js", "runtime/paint.js", "runtime/stage.js", "index.html"]) engine.update(fs.readFileSync(path.join(here, f)));
  const engineKey = engine.digest("hex").slice(0, 12);
  const beatIndexAt = (t) => { for (let i = 0; i < beats.length; i++) if (t < beats[i].t1) return i; return beats.length - 1; };
  const keyOf = (d) => {
    const t = Math.min((d * twos) / fps + 1 / (2 * fps), total - 1e-3), b = beats[beatIndexAt(t)];
    const caps = captions.filter((c) => c.t1 > b.t0 && c.t0 < b.t1);
    return crypto.createHash("sha1").update(JSON.stringify([engineKey, W, H, fps, twos, spec.look ?? "oil", spec.style, spec.doodle, spec.drawIn, spec.captions, b, caps, d])).digest("hex").slice(0, 24);
  };
  let painted = 0, reused = 0;
  for (let d = 0; d < count; d++) {
    const file = path.join(cacheDir, keyOf(d) + ".jpg"); let bytes;
    if (fs.existsSync(file)) { bytes = fs.readFileSync(file); reused++; }
    else { const data = await page.evaluate((n) => window.drawing(n), d); bytes = Buffer.from(data.split(",")[1], "base64"); fs.writeFileSync(file, bytes); painted++; }
    if (!ff.stdin.write(bytes)) await new Promise((r) => ff.stdin.once("drain", r));
    if (d % 10 === 0) process.stdout.write(`\r· drawing ${d}/${count}  ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  console.log(`\n· ${painted} drawings painted, ${reused} reused from the cache`);
  ff.stdin.end(); await done; process.stdout.write("\n");
  for (const w of (await page.evaluate(() => window.PaintedWarnings || []).catch(() => []))) console.log("· warning: " + w);
  console.log(`✓ ${outPath}  ${total.toFixed(1)}s · ${W}x${H} · ${Math.round((Date.now() - t0) / 1000)}s to paint`);
  fs.rmSync(work, { recursive: true, force: true });
} finally { await browser.close().catch(() => {}); plateServer?.server.close(); if (cacheOwned) fs.rmSync(cacheDir, { recursive: true, force: true }); }
