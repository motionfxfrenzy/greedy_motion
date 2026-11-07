// Hindi (and any non-English) narration: the brief carries the language, the writer is told, and word times survive non-Latin letters.
//   node test/voice-language.mjs
import assert from "node:assert/strict";
// Pure checks: no model or database is called, so the backend config gets local placeholders.
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
const { parseScriptBrief, voiceLanguageIds } = await import("@videosaas/contracts");
const { alignWords, estimateWords } = await import("../src/plan/voice.ts");
const { userMessage } = await import("../src/plan/director.ts");

const base = { scriptMode: "own", text: "क्या आपने कभी एक ही बात को बार-बार सोचा है?", durationSeconds: 15, aspect: "9:16", motionProfile: "smooth", pace: "balanced", audio: { mode: "voiceover" } };
const parse = (audio) => parseScriptBrief({ ...base, audio });

// The language is kept only when it is one we support; English is the unmarked default.
assert.equal(parse({ mode: "voiceover", language: "hi" }).brief.audio.language, "hi");
assert.equal(parse({ mode: "voiceover", language: "en" }).brief.audio.language, undefined);
assert.equal(parse({ mode: "voiceover", language: "xx" }).brief.audio.language, undefined);
assert.ok(voiceLanguageIds.includes("hi"));

// The writer is told to keep the person's own words and letters, and to leave on-screen words in English.
const context = { screenshots: [], site: null };
const own = userMessage(parse({ mode: "voiceover", language: "hi" }).brief, context);
assert.match(own, /VOICE LANGUAGE: Hindi/);
assert.match(own, /never translate/);
assert.doesNotMatch(userMessage(parse({ mode: "voiceover" }).brief, context), /VOICE LANGUAGE/);
assert.doesNotMatch(userMessage(parse({ mode: "none", language: "hi" }).brief, context), /VOICE LANGUAGE/);

// Word times: Devanagari and Roman words are matched to what was heard (before, every non-a-z word scored as a miss).
for (const text of ["क्या आपने कभी एक ही बात सोची", "kya aapne kabhi ek hi baat sochi"]) {
  const words = text.split(" ");
  const heard = words.map((word, i) => ({ text: word, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const out = alignWords(text, heard, 4);
  assert.deepEqual(out.map((w) => w.start), words.map((_, i) => i * 0.5), text);
}
// Without a transcript the estimate still spans the take and runs forward.
const est = estimateWords("क्या आपने कभी एक ही बात सोची", 3);
assert.equal(est.length, 7);
assert.ok(est.every((w, i) => w.end > w.start && (i === 0 || w.start >= est[i - 1].start)));
assert.ok(est.at(-1).end <= 3);
console.log("voice language passed (brief parse, writer rule, Devanagari and Roman word times)");

// Timing follows the measured audio: short Hindi lines are not held to the default minimum or stretched toward the chosen length.
const { planTiming } = await import("../src/plan/timing.ts");
const lens = [3.58, 1.8, 2.26, 1.07, 0.84];
const roles = ["hook", "problem", "problem", "reveal", "cta"];
const plan = { target_duration_s: 15, canvas: "9:16", motion_profile: "smooth", captions: "key-phrases", beats: lens.map((_, i) => ({ id: `b${i + 1}`, role: roles[i], kind: "kinetic", keyword: `Key ${i}`, on_screen: null, line: `line ${i}`, verb: null, success: false, energy: "high", ui: null, motion: { entry: "rise", exit: "fade" }, transition_out: "cut", fallback: null })) };
const measured = { lineSeconds: Object.fromEntries(lens.map((s, i) => [`b${i + 1}`, s])) };
const measuredRun = planTiming(plan, { pace: "balanced", audio: { language: "hi" } }, measured);
const total = measuredRun.beats.reduce((sum, b) => sum + (b.end - b.start), 0);
assert.ok(total < 15 * 0.9, `film follows the audio, not the 15s target (got ${total.toFixed(1)}s)`);
for (const [i, b] of measuredRun.beats.entries()) assert.ok(b.end - b.start <= lens[i] + (i === lens.length - 1 ? 2.0 : 1.3), `beat ${i + 1} holds ${(b.end - b.start).toFixed(2)}s for a ${lens[i]}s line`);
const estimatedRun = planTiming(plan, { pace: "balanced" }, {});
assert.ok(estimatedRun.beats.reduce((sum, b) => sum + (b.end - b.start), 0) >= 15 * 0.9 - 0.01, "without measured takes the film still fills its target");
// English narration keeps today's timing even with measured takes: it still fills its chosen length.
const englishRun = planTiming(plan, { pace: "balanced", audio: {} }, measured);
assert.ok(englishRun.beats.reduce((sum, b) => sum + (b.end - b.start), 0) >= 15 * 0.9 - 0.01, "English films with measured takes still fill their target");
assert.deepEqual(planTiming(plan, { pace: "balanced" }, measured).beats, englishRun.beats, "no language means English");

// Plate scenes: Hindi follows its clip (floor 1.5 s), English keeps the word-count floor.
const { secondsFor, followsAudio } = await import("../src/plates/model.ts");
const shortBeat = { line: "एक दो तीन चार पाँच छह", keyword: "k" };
assert.equal(secondsFor(shortBeat, 0.8, true), 1.5, "a 0.8 s Hindi line runs 1.5 s");
assert.equal(secondsFor(shortBeat, 2.0, true), 2.5, "a 2.0 s Hindi line runs 2.5 s");
assert.equal(secondsFor(shortBeat, 2.0), 3, "English keeps the 3 s floor");
assert.equal(secondsFor(shortBeat, 2.0, false), 3, "English keeps the 3 s floor");
assert.equal(secondsFor(shortBeat), 3, "unvoiced scenes use the estimate");
assert.equal(followsAudio({ brief: { audio: { mode: "voiceover", language: "hi" } } }), true);
assert.equal(followsAudio({ brief: { audio: { mode: "voiceover" } } }), false);
assert.equal(followsAudio({ brief: { audio: { mode: "voiceover", language: "en" } } }), false);
console.log("timing follows audio:", measuredRun.beats.map((b) => (b.end - b.start).toFixed(2)).join(" "), "total", total.toFixed(1));
