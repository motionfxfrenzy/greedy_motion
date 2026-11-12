import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { alignBedEnd, endOnBeat, soundTracks, levelAt } = await import("../src/plan/sound.ts");
const { beatTimes } = await import("../src/plan/beat-grid.ts");
const { brandAddress, showsAddress } = await import("../src/plan/frame-sketch.ts");

const nearBeat = (t, grid, tolerance = 0.012) => {
  const period = 60 / grid.bpm;
  const phase = (((t - grid.offset) % period) + period) % period;
  return Math.min(phase, period - phase) < tolerance;
};

test("the bed is shifted by less than half a beat so a beat lands 0.35 s before the film ends", () => {
  for (const [total, grid] of [[45.48, { bpm: 104, offset: 0.254 }], [26.2, { bpm: 123.54, offset: 0.396 }], [30, { bpm: 140.05, offset: 0.348 }]]) {
    const bed = alignBedEnd(total, 120, grid);
    assert.equal(bed.hit, +(total - 0.35).toFixed(3));
    const period = 60 / grid.bpm;
    assert.ok(Math.max(bed.start, bed.mediaStart) <= period / 2 + 0.002, `shift ${bed.start}/${bed.mediaStart} within half a beat (${period / 2})`);
    // The beat that plays at the film's hit time is a real beat of the file.
    const inFile = bed.hit - bed.start + bed.mediaStart;
    assert.ok(nearBeat(inFile, grid), `file time ${inFile} is on the grid`);
    assert.ok(Math.abs(bed.start + bed.duration - total) < 0.002, "still covers the whole film");
    assert.ok(bed.mediaStart + bed.duration <= 120 + 1e-6);
  }
});

test("without a beat, a very short film, or a bed too short to cover, the bed is unchanged", () => {
  const plain = { start: 0, mediaStart: 0, duration: 45, hit: null };
  assert.deepEqual(alignBedEnd(45, 120, null), plain);
  assert.deepEqual(alignBedEnd(3, 120, { bpm: 120, offset: 0 }), { start: 0, mediaStart: 0, duration: 3, hit: null });
});

test("the volume holds through the last beat and then decays to silence at the film's end", () => {
  const lane = [{ t: 0, v: 0 }, { t: 1, v: 0.4 }, { t: 40, v: 0.4 }, { t: 44.2, v: 0.1 }, { t: 45, v: 0 }];
  const out = endOnBeat(lane, 44.65, 45);
  assert.deepEqual(out.at(-1), { t: 45, v: 0 });
  assert.ok(out.every((p, i) => i === 0 || p.t > out[i - 1].t), "strictly increasing");
  const held = out.filter((p) => p.t >= 44.6 && p.t <= 44.75);
  assert.equal(held.length, 2);
  assert.equal(held[0].v, held[1].v, "held level through the beat");
  assert.ok(levelAt(out, 44.9) < held[0].v, "decaying after it");
  assert.ok(!out.some((p) => p.t > 44.6 && p.t < 44.62 && p.v === 0.1), "the old fade is gone");
});

test("soundTracks places the single bed on the beat and keeps its lane on the track's own clock", () => {
  const input = {
    plan: { beats: [{ id: "b1", role: "hook", kind: "kinetic", energy: "low", success: false, ui: null, transition_out: { type: "j-cut" }, sfx: null }] },
    timing: { pace: "balanced", target: 20, total: 20, beats: [{ id: "b1", start: 0, end: 20, actAt: null, successAt: null, vo: null }], warnings: [] },
    audio: { music: { source: "lyria", model: "m", prompt: "p", file: "music/x.mp3", seconds: 60 } },
    fileUrl: (f) => f, sfxUrl: (n) => `sfx/${n}.mp3`, hasShot: () => false, mode: "music", sfx: false
  };
  const grid = { bpm: 100, offset: 0.2 };
  const bed = soundTracks({ ...input, beatGrid: grid }).tracks.find((t) => t.id === "music-bed");
  assert.ok(bed.automation.at(-1).t <= bed.duration + 1e-6, "lane ends within the track");
  assert.equal(bed.automation.at(-1).v, 0);
  const times = beatTimes([bed], grid);
  const last = times.at(-1);
  assert.ok(last > 20 - 0.5 && last < 20 - 0.2, `last beat at ${last}`);
  assert.ok(Math.abs(last - (20 - 0.35)) < 0.02, "the last beat is the planned hit");
  const plain = soundTracks(input).tracks.find((t) => t.id === "music-bed");
  assert.equal(plain.start, 0);
  assert.equal(plain.mediaStart, undefined);
});

test("beat times follow a bed's trimmed or delayed start", () => {
  const grid = { bpm: 120, offset: 0.1, confidence: 3 };
  const trimmed = beatTimes([{ id: "music-bed", start: 0, duration: 5, mediaStart: 0.3 }], grid);
  assert.ok(Math.abs(trimmed[0] - 0.3) < 0.001, `first beat after the trim: ${trimmed[0]}`);
  const delayed = beatTimes([{ id: "music-bed", start: 0.2, duration: 5 }], grid);
  assert.ok(Math.abs(delayed[0] - 0.3) < 0.001, `first beat after the delay: ${delayed[0]}`);
});

test("the closing frame's address: from the brand's url, and checked in the drawing", () => {
  assert.equal(brandAddress({ name: "x", url: "https://www.greedymotion.com/", colors: { primary: "#000000" } }), "greedymotion.com");
  assert.equal(brandAddress({ name: "x", url: "greedymotion.com", colors: { primary: "#000000" } }), "greedymotion.com");
  assert.equal(brandAddress({ name: "x", colors: { primary: "#000000" } }), "");
  assert.equal(brandAddress(null), "");
  assert.ok(showsAddress('<svg><text>Try free now</text><text> greedy<tspan>motion.com </tspan></text></svg>', "greedymotion.com"));
  assert.ok(!showsAddress('<svg><text>Try free now</text></svg>', "greedymotion.com"));
  assert.ok(showsAddress("<svg/>", ""), "no address to show");
});
