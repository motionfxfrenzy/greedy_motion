import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { detectBeatGrid, beatTimes } = await import("../src/plan/beat-grid.ts");

const RATE = 11025;

/** A click track: a short decaying noise burst on every beat (plus a quieter off-beat), over a little background noise. */
function clicks(bpm, offset, seconds, { accent = true } = {}) {
  const out = new Float32Array(Math.floor(seconds * RATE));
  let seed = 1234;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 0.02;
  const period = 60 / bpm;
  for (let k = 0; offset + k * period < seconds - 0.1; k++) {
    const start = Math.floor((offset + k * period) * RATE);
    const strength = accent && k % 4 === 0 ? 0.9 : 0.6;
    for (let n = 0; n < RATE * 0.05 && start + n < out.length; n++) out[start + n] += rnd() * strength * Math.exp(-n / (RATE * 0.012));
    const off = Math.floor((offset + (k + 0.5) * period) * RATE);
    for (let n = 0; n < RATE * 0.03 && off + n < out.length; n++) out[off + n] += rnd() * 0.12 * Math.exp(-n / (RATE * 0.008));
  }
  return out;
}

for (const [bpm, offset] of [[120, 0.12], [96, 0.31], [140, 0.05], [84, 0.2]]) {
  test(`finds ${bpm} BPM with its first beat at ${offset}s`, () => {
    const grid = detectBeatGrid(clicks(bpm, offset, 30), RATE);
    assert.ok(grid, "a steady beat is found");
    assert.ok(Math.abs(grid.bpm - bpm) < 2, `bpm ${grid.bpm} vs ${bpm}`);
    const period = 60 / bpm;
    const phaseError = Math.abs(((grid.offset - offset + period / 2) % period + period) % period - period / 2);
    assert.ok(phaseError < 0.04, `phase off by ${phaseError.toFixed(3)}s`);
  });
}

test("silence and unsteady noise have no beat", () => {
  assert.equal(detectBeatGrid(new Float32Array(RATE * 20), RATE), null);
  let seed = 7;
  const noise = new Float32Array(RATE * 20).map(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 2 ** 32 - 0.5) * 0.3; });
  assert.equal(detectBeatGrid(noise, RATE), null);
  assert.equal(detectBeatGrid(new Float32Array(100), RATE), null, "too short");
});

test("beat times follow each copy of the music bed, thin out for fast music, and drop duplicates where copies overlap", () => {
  const tracks = [{ id: "music-bed", start: 0, duration: 4 }, { id: "music-bed-2", start: 3.5, duration: 4 }, { id: "vo-b1", start: 0, duration: 9 }];
  const times = beatTimes(tracks, { bpm: 120, offset: 0.1, confidence: 3 });
  assert.equal(times[0], 0.1);
  assert.ok(times.every((t, i) => i === 0 || t - times[i - 1] >= 0.12), "no doubled beats");
  assert.ok(times.some((t) => t > 3.5), "second copy has beats");
  assert.ok(!times.some((t) => t > 7.5), "stops at the end of the last copy");
  const fast = beatTimes([{ id: "music-bed", start: 0, duration: 4 }], { bpm: 160, offset: 0, confidence: 3 });
  const slow = beatTimes([{ id: "music-bed", start: 0, duration: 4 }], { bpm: 80, offset: 0, confidence: 3 });
  assert.ok(Math.abs(fast.length - slow.length) <= 1, "160 BPM pulses every other beat, like 80");
  assert.deepEqual(beatTimes(tracks, null), []);
});
