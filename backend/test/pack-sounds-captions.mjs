// Template pack scene sounds and one-word captions (Dark Fable): the sounds parser, pack cues replacing keyword cues in the
// preview status and the export, the shipped foley files, one-word cue timing from the voiceover's word times, and the
// "shadow" caption defaults. Run: node backend/test/pack-sounds-captions.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

const m = await import("../src/plates/model.ts");
const { SFX } = await import("../src/plan/sound.ts");
const { SCENE_SOUND_KINDS } = await import("../src/plan/template-packs.ts");

// ---------------------------------------------------------------- the sounds parser
const module = (list) => `import { x } from "y";\nexport const frames = 90;\n${list}\nexport default function draw(ctx, frame) {}\n`;
assert.deepEqual(
  m.parseSceneSounds(module(`export const sounds: { kind: string; frame: number }[] = [ { kind: "mark", frame: 53 }, { kind: 'thud', frame: 12, }, ];`), 90),
  [{ kind: "thud", frame: 12 }, { kind: "mark", frame: 53 }],
  "typed TS literal, single quotes, trailing commas: sorted by frame"
);
assert.deepEqual(
  m.parseSceneSounds(module(`export const sounds = [\n  // the hand lands\n  { kind: "mark", frame: 4 }, /* then */ { "kind": "bleat", "frame": 20.4 }\n] as const;`), 90),
  [{ kind: "mark", frame: 4 }, { kind: "bleat", frame: 20 }],
  "comments, quoted keys, as const, fractional frames rounded"
);
assert.equal(m.parseSceneSounds(module(""), 90), null, "no export: null (keyword sounds)");
assert.equal(m.parseSceneSounds(module(`export const sounds = [{ kind: "mark", frame: 3 * 10 }];`), 90), null, "an expression is never evaluated: null");
assert.equal(m.parseSceneSounds(module(`export const sounds = makeSounds();`), 90), null, "not a literal: null");
assert.equal(m.parseSceneSounds(module(`export const sounds = [{ kind: "mark", frame: 3 }`), 90), null, "unterminated junk: null");
assert.deepEqual(m.parseSceneSounds(module(`export const sounds = [];`), 90), [], "an empty list is the scene's choice: silence");
assert.deepEqual(
  m.parseSceneSounds(module(`export const sounds = [{ kind: "explosion", frame: 3 }, { kind: "laugh", frame: 9 }, { kind: "hit", frame: 30 }, "mark", null, { kind: "drop" }];`), 90),
  [{ kind: "hit", frame: 30 }],
  "unknown kinds, non-objects and missing frames are dropped"
);
assert.deepEqual(
  m.parseSceneSounds(module(`export const sounds = [{ kind: "step", frame: -1 }, { kind: "step", frame: 0 }, { kind: "step", frame: 89 }, { kind: "step", frame: 90 }, { kind: "step", frame: 400 }];`), 90),
  [{ kind: "step", frame: 0 }, { kind: "step", frame: 89 }],
  "frames outside the scene (0 <= frame < frames) are dropped"
);
assert.equal(m.parseSceneSounds(module(`export const sounds = [${Array.from({ length: 30 }, (_, k) => `{ kind: "step", frame: ${k} }`).join(",")}];`), 90).length, 16, "at most 16 per scene");

// ---------------------------------------------------------------- pack cues and the library
const cues = m.sceneSoundCues([{ kind: "mark", frame: 53 }, { kind: "bleat", frame: 0 }]);
assert.deepEqual(cues, [{ name: "foley-mark", offset: 1.767, volume: 0.9 }, { name: "foley-bleat", offset: 0, volume: 0.9 }], "offset = frame / 30, named foley-<kind>");
for (const kind of SCENE_SOUND_KINDS) {
  const name = `foley-${kind}`;
  assert.ok(SFX[name], `${name} is in the SFX table (served by /v1/preview/plan-sfx)`);
  assert.equal(SFX[name].sync, 0, `${name} starts on its hit`);
  assert.ok(SFX[name].duration > 0.2 && SFX[name].duration < 1.7, `${name} lasts a few hundred ms to ~1.6 s`);
  assert.ok(existsSync(join(import.meta.dirname, "..", "..", "worker", "templates", "beat-plan", "sfx", `${name}.mp3`)), `${name}.mp3 ships in the library`);
}

// sceneSoundsByRow: only for a pack with sceneSounds; a module without a list keeps the keyword sounds (no entry).
// config.ts needs these to load; nothing connects and no model is called (the source loader is injected).
process.env.DATABASE_URL ??= "postgres://test@127.0.0.1:1/none";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";
const { sceneSoundsByRow } = await import("../src/plates/scene-sounds.ts");
const sources = {
  "a/source.ts": module(`export const sounds = [{ kind: "mark", frame: 10 }, { kind: "hit", frame: 80 }];`),
  "b/source.ts": module(""),
  "c/source.ts": module(`export const sounds = [{ kind: "tuft", frame: 5 }];`)
};
let reads = 0;
const load = async (key) => { reads += 1; return sources[key] ?? null; };
const rows = [{ id: "r1", source_key: "a/source.ts", frames: 60 }, { id: "r2", source_key: "b/source.ts", frames: 90 }, { id: "r3", source_key: null, frames: 90 }];
const fable = { brief: { styleExample: "dark-fable" } };
const byRow = await sceneSoundsByRow(fable, rows, load);
assert.deepEqual(byRow.get("r1"), [{ kind: "mark", frame: 10 }], "the row's own frame count bounds the list");
assert.equal(byRow.has("r2"), false, "no list: keyword sounds");
assert.equal(byRow.has("r3"), false, "no source yet: keyword sounds");
const before = reads;
await sceneSoundsByRow(fable, rows, load);
assert.equal(reads, before, "a stored module is read once (content-addressed cache)");
assert.equal((await sceneSoundsByRow({ brief: { styleExample: null } }, [{ id: "r4", source_key: "c/source.ts", frames: 90 }], load)).size, 0, "other projects never read a source");

// ---------------------------------------------------------------- one-word captions from word times
const scene = (seconds) => ({ index: 0, keyword: "k", state: "drawn", seconds, frames: Math.round(seconds * 30), sig: "s" });
const beats = [{ keyword: "dot", visual: null, onScreen: null, line: "Yesterday, I put one red dot." }, { keyword: "THE BYSTANDER EFFECT", visual: null, onScreen: null, line: "The bystander effect." }];
const words = [
  [{ text: "yesterday", start: 0.1, end: 0.6 }, { text: "i", start: 0.7, end: 0.8 }, { text: "put", start: 0.8, end: 1.0 }, { text: "one", start: 1.1, end: 1.3 }, { text: "red", start: 1.4, end: 1.6 }, { text: "dot", start: 1.7, end: 2.1 }],
  undefined
];
const one = m.buildSubtitleCues([scene(3), scene(2)], beats, [3, 2], [0, 3], "full", { wordsPerCue: 1, words });
const first = one.filter((c) => c.scene === 0);
assert.deepEqual(first.map((c) => c.text), ["Yesterday,", "I", "put", "one", "red", "dot."], "one spoken word per cue, the script's own words and punctuation");
assert.equal(first[0].start, 0, "the first word opens with the scene");
assert.deepEqual(first.slice(1).map((c) => c.start), [0.7, 0.8, 1.1, 1.4, 1.7], "each word appears on its voiceover time");
for (let k = 0; k < first.length - 1; k++) assert.equal(first[k].end, first[k + 1].start, "back to back: no blink between words");
assert.equal(first.at(-1).end, 2.95, "the last word holds until just before the cut");
const title = one.filter((c) => c.scene === 1);
assert.deepEqual(title.map((c) => c.text), ["The", "bystander", "effect."], "no word times: the title line's words are spread over its scene");
assert.equal(title[0].start, 3);
assert.ok(title.every((c, k) => c.end > c.start && c.start >= 3 && c.end <= 4.95 && (k === 0 || c.start > title[k - 1].start)), "estimated cues stay inside the scene, in order");
const mismatch = m.buildSubtitleCues([scene(3)], [{ ...beats[0], line: "Yesterday I put a dot" }], [3], [0], "full", { wordsPerCue: 1, words: [words[0]] });
assert.deepEqual(mismatch.map((c) => c.text), ["yesterday", "i", "put", "one", "red", "dot"], "a take whose words differ from the line shows what was spoken");
const two = m.buildSubtitleCues([scene(3)], beats, [3], [0], "full", { wordsPerCue: 2, words });
assert.deepEqual(two.map((c) => c.text), ["Yesterday, I", "put one", "red dot."]);
assert.equal(m.buildSubtitleCues([scene(3)], beats, [3], [0], "full").length, 1, "without wordsPerCue: the 6-word chunks as before");
assert.equal(m.buildSubtitleCues([scene(3)], beats, [3], [0], "key-phrases", { wordsPerCue: 1, words }).length, 1, "key phrases ignore wordsPerCue");

// ---------------------------------------------------------------- shadow style and the pack's caption defaults
const d = m.defaultSubtitlesFor({ brief: { styleExample: "dark-fable", look: "illus-koi", aspect: "9:16" } });
assert.equal(d.style, "shadow"); assert.equal(d.mode, "full"); assert.equal(d.y, 46); assert.equal(d.x, 50); assert.equal(d.wordsPerCue, 1);
assert.equal(d.size, m.captionSizePercent(72)); assert.ok(d.size >= 95 && d.size <= 105, "72 px on a 1080-wide frame is the shadow style at about 100%");
const plain = m.defaultSubtitlesFor({ brief: { look: "illus-koi" } });
assert.equal(plain.style, "pill"); assert.equal(plain.wordsPerCue, undefined);
assert.equal(m.mergeSubtitles(d, { style: "shadow", size: 120 }, "9:16").wordsPerCue, 1, "an update keeps wordsPerCue");
assert.equal(m.mergeSubtitles(plain, { style: "shadow" }, "9:16").style, "shadow", "shadow is a valid style");
assert.equal(m.mergeSubtitles(d, { wordsPerCue: 3 }, "9:16").wordsPerCue, 3);
assert.equal(m.mergeSubtitles(d, { wordsPerCue: 99 }, "9:16").wordsPerCue, 12);
assert.equal(m.mergeSubtitles(d, { wordsPerCue: null }, "9:16").wordsPerCue, undefined, "null goes back to the chunks");
console.log("pack sounds + captions: ok");
