// Dark Fable pack (viral-formula update, 2026-11-16): scene pacing, the voice pause trim, the script rules and the scene-author prompt.
// No database, no network. Run: node backend/test/dark-fable-pack.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const { templatePack, packScriptIssues, SCENE_SOUND_KINDS, withPackKit } = await import("../src/plan/template-packs.ts");
const { packSceneSeconds } = await import("../src/plates/inputs.ts");
const { tightenPauses, pcmSeconds } = await import("../src/plan/pcm.ts");
const { buildAuthorMessages } = await import("../src/plates/prompt.ts");

const pack = templatePack("dark-fable");
assert.ok(pack, "the dark-fable pack exists");
assert.equal(pack.voice.id, "Algenib");
assert.ok(pack.voice.direction.length <= 200, "voice direction fits the 200-character limit");
assert.equal(pack.voice.tighten, true);
assert.equal(pack.sceneSounds, true);
assert.deepEqual(pack.captions, { wordsPerCue: 1, style: "shadow", size: 72, y: 46 });
assert.match(pack.scriptVoice, /THE NINE BEATS/);
assert.match(pack.sceneDirection, /K\.camera/);
assert.match(pack.sceneDirection, /K\.flock/);
const scenes = pack.scenes();
for (const fn of ["camera", "flock", "burst", "pile", "glow", "shake", "move"]) assert.match(scenes.kit, new RegExp(`\\b${fn}\\b`), `the kit has K.${fn}`);
assert.equal(scenes.images.length, 3, "kit shots, camera/motion test, example film");
assert.ok(withPackKit('import type { Ctx } from "./core";\nconst a = 1;\n', pack).includes("const K = (() =>"), "the kit is inlined after the imports");
assert.ok(SCENE_SOUND_KINDS.includes("bleat") && SCENE_SOUND_KINDS.includes("mark"));
assert.equal(templatePack("clean"), undefined, "other templates have no pack");

// ---- pacing: line + short gap, no half-second rounding, no 3 s floor; long gaps around the title and before the last line
const beats = ["A", "B", "THE BYSTANDER EFFECT", "C", "D", "E"].map((keyword) => ({ keyword, visual: null, onScreen: null, line: "words here" }));
const takes = [2.48, 0.76, 1.28, 3.06, 2.0, 4.16];
const secs = packSceneSeconds(beats, (i) => takes[i], pack.pacing);
const close = (a, b) => Math.abs(a - b) < 1 / 30 + 1e-9;
assert.ok(close(secs[0], 2.63), `line + 0.15 (${secs[0]})`);
assert.ok(close(secs[1], 1.36), `the line before the title gets the long gap (${secs[1]})`);
assert.ok(close(secs[2], 1.88), `the title gets the long gap and at least 1.6 s (${secs[2]})`);
assert.ok(close(secs[3], 3.21), `${secs[3]}`);
assert.ok(close(secs[4], 2.5), `before the last line: 0.5 s (${secs[4]})`);
assert.ok(close(secs[5], 5.36), `the last scene lands with 1.2 s (${secs[5]})`);
for (const s of secs) assert.ok(Math.abs(s * 30 - Math.round(s * 30)) < 1e-6, "whole frames");
const tiny = packSceneSeconds([{ keyword: "x", visual: null, onScreen: null, line: "It cried." }, ...beats.slice(3)], (i) => [0.4, 1, 1, 1][i], pack.pacing);
assert.ok(close(tiny[0], 0.9), `a very short line still lasts at least 0.9 s (${tiny[0]})`);
const unvoiced = packSceneSeconds([{ keyword: "x", visual: null, onScreen: null, line: "one two three four five six" }], () => undefined, pack.pacing);
assert.ok(unvoiced[0] >= 3, "a scene with no take keeps the usual estimate");

// ---- the voice: long pauses inside a take are cut to 0.2 s, edges untouched
const sr = 24000, tone = (s) => { const b = Buffer.alloc(Math.round(s * sr) * 2); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * 12000), i * 2); return b; };
const silence = (s) => Buffer.alloc(Math.round(s * sr) * 2);
const take = { sampleRate: sr, channels: 1, data: Buffer.concat([tone(0.5), silence(0.9), tone(0.4), silence(0.2), tone(0.3)]) };
const tight = tightenPauses(take);
assert.ok(Math.abs(pcmSeconds(tight) - (0.5 + 0.2 + 0.4 + 0.2 + 0.3)) < 0.03, `the 0.9 s pause became about 0.2 s (${pcmSeconds(tight).toFixed(2)} s)`);
assert.equal(pcmSeconds(tightenPauses({ ...take, data: Buffer.concat([tone(0.5), silence(0.2), tone(0.5)]) })), 1.2, "short pauses are kept");

// ---- script rules
const line = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const ok = Array.from({ length: 12 }, (_, i) => ({ keyword: i === 6 ? "STIGMA" : `b${i}`, line: line(i % 3 === 0 ? 3 : 9), visual: "medium shot" }));
assert.deepEqual(packScriptIssues(pack, ok), [], "a script that keeps the rules passes");
const bad = ok.map((b) => ({ ...b }));
bad[2].line = line(18); bad[11].line = line(20); bad[4].visual = "the rope tightens"; bad[6].visual = "an empty frame with the title";
const issues = packScriptIssues(pack, bad);
assert.deepEqual(issues.map((x) => x.index), [2, 4, 6, 11]);
assert.match(issues[3].message, /last line/);
const fewShort = ok.map((b) => ({ ...b, line: line(9) }));
assert.ok(packScriptIssues(pack, fewShort).length >= 3, "too few short lines asks the longest lines to become short");
assert.deepEqual(packScriptIssues(undefined, bad), [], "no pack, no rules");

// ---- the scene-author prompt: the sounds rule and the word frames
const req = await buildAuthorMessages({ look: "illus-flat-vector", plateName: "x", film: "f", beats: ok.map((b) => ({ ...b, onScreen: null })), aspect: "9:16", index: 1, frames: 90, styleExample: "dark-fable", words: [{ text: "Yesterday,", start: 0 }, { text: "I", start: 0.62 }] });
assert.match(req.system, /export const sounds/);
const sceneText = req.messages[0].content.at(-1).text;
assert.match(sceneText, /WORD START FRAMES[^\n]*Yesterday,@0 I@19/);
console.log("dark-fable pack: voice, kit, pacing, pause trim, script rules and the author prompt: ok");
