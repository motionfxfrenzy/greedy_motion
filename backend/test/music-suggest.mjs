import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { cleanMusicPrompt, musicContext, MUSIC_PROMPT_MAX } = await import("../src/plan/music-suggest.ts");

test("a suggestion becomes one clean line the brief can keep", () => {
  assert.equal(cleanMusicPrompt('  "Warm, upbeat electronic with soft plucks."  '), "Warm, upbeat electronic with soft plucks.");
  assert.equal(cleanMusicPrompt("Line one\n\nline   two"), "Line one line two");
  const long = "Bright modern electronic with crisp percussion, glassy synth plucks and a steady pulse that lifts in the final third, then resolves on a clean hit";
  const cut = cleanMusicPrompt(long);
  assert.ok(cut.length <= MUSIC_PROMPT_MAX, `${cut.length} > ${MUSIC_PROMPT_MAX}`);
  assert.ok(long.startsWith(cut));
  assert.doesNotMatch(cut, /[,\s]$/);
});

test("the context describes the film: idea, pace, narrator and scenes", () => {
  const project = {
    brief: { text: "Launch video for Relay", look: "clean", pace: "fast", audio: { mode: "voiceover" }, scriptBeats: [] },
    beatPlan: { beats: [{ keyword: "Hook", line: "Still animating by hand?" }, { keyword: "Meet Relay", line: null }] }
  };
  const text = musicContext(project, 32.4);
  assert.match(text, /Launch video for Relay/);
  assert.match(text, /Pace: fast\. Motion feel: smooth\. Length: about 32 seconds/);
  assert.match(text, /A narrator speaks/);
  assert.match(text, /Scenes in order: Hook, Meet Relay\./);
  assert.match(text, /Motion feel: smooth/);
  assert.match(text, /Tone cues[^\n]*\n- Still animating by hand\?/);
  const silent = musicContext({ brief: { text: "x", audio: { mode: "music" }, scriptBeats: [{ keyword: "A" }] }, beatPlan: null }, 10);
  assert.match(silent, /No narrator/);
});
