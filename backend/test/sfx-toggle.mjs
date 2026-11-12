import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { soundTracks } = await import("../src/plan/sound.ts");

const input = (extra = {}) => ({
  plan: { beats: [{ id: "b1", role: "hook", kind: "kinetic", energy: "high", success: false, ui: null, transition_out: { type: "j-cut" }, sfx: null }] },
  timing: { pace: "balanced", target: 5, total: 5, beats: [{ id: "b1", start: 0, end: 5, actAt: null, successAt: null, vo: null }], warnings: [] },
  audio: null,
  fileUrl: (file) => `audio/${file}`,
  sfxUrl: (name) => `sfx/${name}.mp3`,
  hasShot: () => false,
  mode: "music",
  ...extra
});

test("sound effects are on unless the person turned them off", () => {
  const on = soundTracks(input());
  assert.ok(on.tracks.some((track) => track.id.startsWith("sfx-")), "has a sound effect");
  assert.ok(on.cues.length > 0);
  const explicit = soundTracks(input({ sfx: true }));
  assert.equal(explicit.tracks.length, on.tracks.length);
  const off = soundTracks(input({ sfx: false }));
  assert.equal(off.tracks.filter((track) => track.id.startsWith("sfx-")).length, 0);
  assert.equal(off.cues.length, 0);
});

test("with no sound at all there are no effects either", () => {
  assert.deepEqual(soundTracks(input({ mode: "none" })), { tracks: [], cues: [] });
});
