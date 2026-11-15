// Builds the nine `foley-<kind>.mp3` sounds of the shipped SFX library (worker/templates/beat-plan/sfx) from our own foley
// synthesiser (foley.mjs, from the story engine; recipes from experiments/dark-fable-template/test-run2/sfx.mjs). A template
// pack's scenes export `sounds: [{ kind, frame }]` (SCENE_SOUND_KINDS in backend/src/plan/template-packs.ts) and each is
// mixed as `foley-<kind>` at scene start + frame / 30. Every file starts exactly on its hit (sync 0).
//
//   node scripts/foley/build-sfx.mjs          writes the mp3s and prints the duration table for backend/src/plan/sound.ts
//
// Deterministic: the same seed per kind, so a rebuild gives the same sound (the mp3 bytes may differ across ffmpeg versions).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as F from "./foley.mjs";

const OUT = join(import.meta.dirname, "..", "..", "worker", "templates", "beat-plan", "sfx");
const SR = F.SR;
const GAIN_DB = 7;

/** A short frightened bleat: a vibrato buzz through three vowel formants. */
function bleat(seed) {
  const r = F.rng(seed), n = Math.round(0.62 * SR), x = new Float32Array(n), f0 = 240 + r() * 60;
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 9 * t)) * (1 - 0.15 * t); ph += f / SR; const saw = 2 * (ph % 1) - 1; x[i] = saw * Math.min(1, t / 0.04) * Math.min(1, (0.62 - t) / 0.15) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 7 * t)); }
  const bp = (fc, q) => { const y = new Float32Array(n), w = 2 * Math.PI * fc / SR, al = Math.sin(w) / (2 * q), b0 = al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const v = (b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
  const a = bp(750, 4), b = bp(1250, 5), c = bp(2600, 6), y = new Float32Array(n);
  let pk = 0;
  for (let i = 0; i < n; i++) { y[i] = a[i] + 0.6 * b[i] + 0.25 * c[i]; pk = Math.max(pk, Math.abs(y[i])); }
  for (let i = 0; i < n; i++) y[i] *= Math.pow(10, -22 / 20) / pk;
  return y;
}

/** The recipes: each kind is a list of [sound, delay seconds]. */
const make = {
  mark: (s) => [[F.hit("scrape", { seconds: 0.28, seed: s }), 0], [F.hit("tap", { seed: s }), 0]],
  tuft: (s) => [[F.hit("flutter", { seconds: 0.6, seed: s }), 0], [F.hit("cloth", { seconds: 0.4, seed: s }), 0.05]],
  thud: (s) => [[F.hit("thud", { weight: 1, seed: s }), 0]],
  step: (s) => [[F.hit("footstep", { surface: "dirt", weight: 0.9, seed: s }), 0]],
  shuffle: (s) => [...[0, 0.11, 0.2, 0.33, 0.42].map((d, k) => [F.hit("footstep", { surface: "dirt", weight: 0.35, seed: s * 7 + k }), d]), [F.hit("cloth", { seconds: 0.6, seed: s }), 0]],
  bleat: (s) => [[bleat(s), 0]],
  whoosh: (s) => [[F.hit("whoosh", { seconds: 0.45, seed: s }), 0]],
  hit: (s) => [[F.hit("impact", { seed: s }), 0]],
  drop: (s) => [[F.hit("tap", { seed: s }), 0], [F.hit("thud", { weight: 0.3, seed: s }), 0.02]]
};

const wav = (x) => {
  const pcm = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};

const tmp = mkdtempSync(join(tmpdir(), "foley-sfx-"));
const table = {};
try {
  for (const [kind, recipe] of Object.entries(make)) {
    const parts = recipe(kind.length * 11 + 3);
    const length = Math.max(...parts.map(([x, d]) => x.length + Math.round(d * SR)));
    const out = new Float32Array(length), g = Math.pow(10, GAIN_DB / 20);
    for (const [x, d] of parts) { const o = Math.round(d * SR); for (let i = 0; i < x.length; i++) out[o + i] += x[i] * g; }
    // Trim the silent tail (below -60 dBFS), keep a 20 ms fade so the file never clicks off.
    let end = out.length;
    while (end > 1 && Math.abs(out[end - 1]) < 0.001) end -= 1;
    const x = out.slice(0, Math.min(out.length, end + Math.round(0.02 * SR)));
    const fade = Math.min(x.length, Math.round(0.02 * SR));
    for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
    const src = join(tmp, `${kind}.wav`), dst = join(OUT, `foley-${kind}.mp3`);
    writeFileSync(src, wav(x));
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-q:a", "3", dst]);
    table[`foley-${kind}`] = Math.round((x.length / SR) * 100) / 100;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
for (const [name, seconds] of Object.entries(table)) console.log(`  "${name}": { duration: ${seconds}, sync: 0, volume: 0.9 },`);
