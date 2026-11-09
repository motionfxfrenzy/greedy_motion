// Film briefs (stories and explainers): character voices, the SPEAKER script tag, the style's hidden world rules, and
// that narrator-only films are unchanged. Pure checks: no model or database is called.
//   node test/story-film.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
const c = await import("@videosaas/contracts");
const { userMessage } = await import("../src/plan/director.ts");
const { speakerSettings, takeKey, voiceSettings } = await import("../src/plan/voice.ts");

// SPEAKER tag: parsed onto the beat, written back, optional, and absent for narration.
const text = "BEAT: Steam\nVISUAL: A cup shivers\nSCREEN: -\nSPEAKER: Cup\nVOICE: Brr.\n\nBEAT: Cover it\nVISUAL: A saucer lands\nSCREEN: -\nVOICE: Keep the steam in.";
const { beats } = c.parseScriptStream(text);
assert.equal(beats[0].speaker, "Cup");
assert.equal("speaker" in beats[1], false, "narration carries no speaker");
assert.match(c.formatScript(beats), /SCREEN: -\nSPEAKER: Cup\nVOICE: Brr\./);
assert.doesNotMatch(c.formatScript([beats[1]]), /SPEAKER/);
assert.deepEqual(c.parseScriptStream(c.formatScript(beats)).beats, beats, "format and parse round-trip");
assert.equal(c.parseScriptBeats([{ keyword: "k", speaker: "  Pot  " }])[0].speaker, "Pot");
assert.equal("speaker" in c.parseScriptBeats([{ keyword: "k", speaker: "" }])[0], false);
assert.equal(c.parseScriptBeats([{ keyword: "k", speaker: "x".repeat(60) }])[0].speaker.length, 24);
assert.deepEqual(c.castOf([{ speaker: "Cup", line: "a" }, { speaker: "narrator", line: "b" }, { speaker: "cup", line: "c" }, { speaker: "Pot", line: null }, { speaker: "Pot", line: "d" }]), ["Cup", "Pot"]);

// Voices: the narrator keeps its voice; a character gets the person's pick, else a stable one that is never the narrator's.
assert.equal(c.voiceForSpeaker(null, "Kore"), "Kore");
assert.equal(c.voiceForSpeaker("Narrator", "Kore"), "Kore");
assert.equal(c.voiceForSpeaker("Cup", "Kore", { cup: "Puck" }), "Puck", "picks match names case-insensitively");
for (const name of ["Cup", "Pot", "Fox", "Moon", "A very long name"]) {
  const voice = c.voiceForSpeaker(name, "Kore");
  assert.notEqual(voice, "Kore", `${name} never sounds like the narrator`);
  assert.equal(c.voiceForSpeaker(name, "Kore"), voice, `${name} always gets the same voice`);
}
assert.notEqual(c.voiceForSpeaker("Cup", "Kore", { Cup: "nonsense" }), "nonsense", "an unknown pick is ignored");

// Brief: cast and voice picks survive parsing, bounded and checked.
const base = { scriptMode: "problem", text: "A coffee pot dances on the counter.", durationSeconds: 30, aspect: "16:9", motionProfile: "smooth", pace: "balanced", captions: "key-phrases" };
const parse = (audio) => c.parseScriptBrief({ ...base, audio }).brief;
assert.equal(parse({ mode: "voiceover", cast: "characters" }).audio.cast, "characters");
assert.equal(parse({ mode: "voiceover", cast: "narrator" }).audio.cast, undefined, "one narrator is the unmarked default");
assert.deepEqual(parse({ mode: "voiceover", cast: "characters", voices: { Cup: "Puck", Pot: "nope", "": "Kore" } }).audio.voices, { Cup: "Puck" });
assert.equal(Object.keys(parse({ mode: "voiceover", voices: { a: "Puck", b: "Leda", c: "Aoede", d: "Charon", e: "Fenrir" } }).audio.voices).length, c.CAST_MAX);

// Film briefs: story and explainer templates or a story style; product templates are not films.
assert.equal(c.isFilmBrief({ look: "illus-rubber-hose" }), true);
assert.equal(c.isFilmBrief({ styleExample: "story-illus-rubber-hose" }), true);
assert.equal(c.isFilmBrief({ styleExample: "product-launch" }), false);
assert.equal(c.isFilmBrief({}), false);
const explain = c.galleryTemplates.find((item) => c.useCaseOf(item) === "explain");
if (explain) assert.equal(c.isFilmBrief({ styleExample: explain.id, look: explain.look }), true, "an educational template is a film");

// World rules: every code-drawn story style has them, and they reach the writer only for that style.
const stories = c.galleryTemplates.filter((item) => item.id.startsWith("story-illus-"));
for (const item of stories) {
  const entry = c.storyWorldFor({ look: item.look });
  assert.ok(entry, `${item.look} has world rules`);
  assert.ok(entry.world.length <= 220, `${item.look} world is short (${entry.world.length})`);
  assert.ok(entry.elements.length >= 3 && entry.elements.length <= 5, `${item.look} has 3-5 elements`);
}
assert.equal(c.storyWorldFor({ look: "clean" }), null);
const context = { screenshots: [], site: null };
const storyBrief = parse({ mode: "voiceover", cast: "characters" });
const withStyle = userMessage({ ...storyBrief, look: "illus-rubber-hose" }, context);
assert.match(withStyle, /STORY NOTES \(a helper, not a rule\)/);
assert.doesNotMatch(withStyle, /follow it|Build every VISUAL|never ask for what the rules say/);
assert.match(withStyle, /Never change approved beats/, "writer and change requests: only the asked beats");
// The whole injected block stays short in every mode.
const notes = (brief) => userMessage(brief, context).split("\n").find((l) => l.startsWith("STORY NOTES"));
for (const item of stories) for (const extra of [{}, { scriptMode: "own" }, { scriptBeats: [{ keyword: "k", line: "L" }] }]) {
  const block = notes({ ...storyBrief, look: item.look, ...extra });
  assert.ok(block && block.length <= 300, `${item.look} notes block is ${block?.length} chars (max 300)`);
}
const own = userMessage({ ...storyBrief, look: "illus-rubber-hose", scriptMode: "own" }, context);
assert.match(own, /never change the person's words/, "own script: notes never touch the person's words");
const fixed = userMessage({ ...storyBrief, look: "illus-rubber-hose", scriptBeats: [{ keyword: "k", line: "L" }] }, context);
assert.match(fixed, /never change approved lines, keywords or scenes/, "fixed script: notes only plan pictures");
assert.match(withStyle, /CHARACTER VOICES/);
assert.match(withStyle, /SPEAKER: <name>/);
const plain = userMessage({ ...parse({ mode: "voiceover" }) }, context);
assert.doesNotMatch(plain, /STORY NOTES|CHARACTER VOICES/, "product and narrator-only briefs get neither rule");
assert.doesNotMatch(userMessage({ ...parse({ mode: "music", cast: "characters" }), look: "illus-rubber-hose" }, context), /CHARACTER VOICES/, "no voice, no characters");

// Narrator-only films are unchanged: same settings object, same take keys (their cached voice files stay valid).
const narratorOnly = voiceSettings({ brief: { pace: "balanced", audio: { mode: "voiceover", voice: "Kore" } }, request: {} });
assert.equal(speakerSettings(narratorOnly, "Cup"), narratorOnly, "without character voices a speaker changes nothing");
const withCast = voiceSettings({ brief: { pace: "balanced", audio: { mode: "voiceover", voice: "Kore", cast: "characters", voices: { Cup: "Puck" } } }, request: {} });
assert.equal(speakerSettings(withCast, null).voice, "Kore");
assert.equal(takeKey(speakerSettings(withCast, null), "line"), takeKey(narratorOnly, "line"), "narration keeps its cache key");
assert.equal(speakerSettings(withCast, "Cup").voice, "Puck");
assert.notEqual(takeKey(speakerSettings(withCast, "Cup"), "line"), takeKey(withCast, "line"), "a character's take is its own file");

console.log(`story film passed (speaker tag, voices, cast brief, film briefs, ${stories.length} world rules, writer rules, narrator unchanged)`);

// The writer's voice: story films are told as stories, educational templates as explainers, product films as neither.
const { systemBlocks } = await import("../src/plan/script-writer.ts");
const voiceOf = (brief, brandName) => systemBlocks({ brief, context: { screenshots: [], site: null, ...(brandName ? { brandName } : {}) } }).map((block) => block.text).join("\n");
assert.match(voiceOf({ ...storyBrief, look: "illus-rubber-hose" }), /a short told story/);
assert.doesNotMatch(voiceOf({ ...storyBrief, look: "illus-rubber-hose" }), /an explainer, the way/);
assert.match(voiceOf({ ...storyBrief, styleExample: "story-illus-rubber-hose" }), /a short told story/);
if (explain) assert.match(voiceOf({ ...storyBrief, styleExample: explain.id, look: explain.look }), /an explainer, the way/);
assert.match(voiceOf(parse({ mode: "voiceover" })), /an explainer, the way/, "a topic film without a product stays an explainer");
assert.doesNotMatch(voiceOf(parse({ mode: "voiceover" }), "Acme"), /a short told story|an explainer, the way/, "a product film gets neither voice");
assert.equal(c.filmKind({ styleExample: "product-launch" }), null);
console.log("writer voice passed (story, explainer, product)");
