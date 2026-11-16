// History-reel pack: registration, places and pictures, the kit, the author prompt and the script rules. No database, no network.
// Run: node backend/test/history-reel-pack.mjs   (the frame-drawing proof is history-reel-render.mjs)
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const { templatePack, packScriptIssues, withPackKit } = await import("../src/plan/template-packs.ts");
const { placesFrom, parsePlaces, placeOfBeat, SET_STYLE } = await import("../src/plan/packs/history-reel/index.ts");
const { buildAuthorMessages } = await import("../src/plates/prompt.ts");
const { wireSceneAssets, sceneAssetNames } = await import("../src/plates/pack-assets.ts");

const pack = templatePack("history-reel");
assert.ok(pack, "registered");
assert.equal(pack.voice.id, "Puck");
assert.equal(pack.voice.tighten, true);
assert.ok(pack.voice.direction.length <= 200, "voice direction fits 200 characters");
assert.equal(pack.sceneSounds, true);
assert.deepEqual(pack.captions, { wordsPerCue: 2, style: "shadow", size: 84, y: 70 });
assert.match(pack.scriptVoice, /You see/);
assert.match(pack.scriptVoice, /EXAMPLE: PLACES:/);
assert.match(pack.sceneDirection, /K\.set\(ctx, env, cam/);

// ---- places: from the EXAMPLE note (OBJECTS is clipped to 400 characters), the [place] tags, and the fallback
const notes = { idea: "Blondin crosses Niagara, 1859", example: "PLACES: gorge = Niagara Gorge in 1859 from the cliff top; afternoon sun from the left; bedroom = a Victorian bedroom at night, lamp at left", objects: "CAST: blondin = maroon top; harry = bowler, grey suit PROPS: rope, pole" };
const beats = [
  { keyword: "Niagara", line: "In 1859 a man walked across Niagara.", visual: "[gorge] wide, push in on across", onScreen: null },
  { keyword: "fall", line: "Thousands came to watch him fall.", visual: "close on the crowd", onScreen: null },
  { keyword: "bed", line: "He died in his own bed.", visual: "[Bedroom] slow push in", onScreen: null }
];
assert.deepEqual(parsePlaces(notes.example).map((p) => p.id), ["gorge", "bedroom"]);
assert.match(parsePlaces(notes.example)[0].description, /sun from the left$/, "a semicolon inside a description does not split it");
const input = { projectId: "p", brief: { scriptNotes: notes }, beats, words: [], aspect: "9:16" };
assert.deepEqual(placesFrom(input).map((p) => p.id), ["gorge", "bedroom"]);
assert.deepEqual(placesFrom({ beats }).map((p) => p.id), ["gorge", "bedroom"], "tags alone still give the places");
assert.deepEqual(placesFrom({ beats: [{ keyword: "x", line: "y", visual: "a field", onScreen: null }] }).map((p) => p.id), ["main"]);
assert.equal(placeOfBeat(1, beats), "gorge", "an untagged beat stays in the last place");
assert.equal(placeOfBeat(2, beats), "bedroom");
const specs = pack.assets(input);
assert.deepEqual(specs.map((s) => [s.name, s.aspect, s.size, s.depth, s.noText]), [["set-gorge", "9:16", "2K", true, true], ["set-bedroom", "9:16", "2K", true, true]]);
assert.ok(specs[0].prompt.startsWith(SET_STYLE) && /Niagara Gorge/.test(specs[0].prompt) && /no people/i.test(specs[0].prompt));
assert.deepEqual(pack.sceneAssets(1, beats), ["set-gorge", "depth-gorge"]);
assert.deepEqual(sceneAssetNames(pack, specs, 2, beats), ["set-bedroom", "depth-bedroom"], "no duplicate depth name");

// ---- the kit: global K, inlined, and accepted by the engine's picture check with the beat's names
const scenes = pack.scenes();
assert.equal(scenes.images.length, 3);
for (const fn of ["camera", "set", "puppet", "actors", "drawPuppet", "drawPiggyback", "makeCast", "crowd", "ropeCurve", "motes"]) assert.match(scenes.kit, new RegExp(`\\b${fn}\\b`), `K.${fn}`);
assert.ok(!/fillText|strokeText/.test(scenes.kit), "the kit draws no text");
const scene = 'import type { Ctx, Env } from "./core";\nimport type { Film } from "./film";\nfunction draw(ctx: Ctx, frame: number, env: Env) { const cam = K.camera(frame, []); K.set(ctx, env, cam, "gorge"); }\nexport const film: Film = { meta: { title: "x", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames: 30 }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: 30, draw }] };\n';
const wired = wireSceneAssets(withPackKit(scene, pack), ["set-gorge", "depth-gorge"], ["set-gorge", "depth-gorge", "set-bedroom", "depth-bedroom"]);
assert.match(wired, /const K = \(\(\) =>/);
assert.match(wired, /__ASSETS__/, "the scene's assets are wired to the host's pictures");

// ---- the author prompt carries the direction, the kit and the word frames
const req = await buildAuthorMessages({ look: "illus-flat-vector", plateName: "x", film: "f", beats, aspect: "9:16", index: 0, frames: 60, styleExample: "history-reel", scriptNotes: notes, assetNames: ["set-gorge", "depth-gorge"], words: [{ text: "In", start: 0 }, { text: "across", start: 1.4 }] });
assert.match(req.system, /History reel: scene direction/);
assert.match(req.system, /const K = \(\(\) =>/);
assert.match(req.messages[0].content.at(-1).text, /across@42/);

// ---- script rules: long run-ons are fine up to 28 words, the payoff is short, nothing is forbidden by word
const line = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const ok = Array.from({ length: 16 }, (_, i) => ({ keyword: `b${i}`, line: line(i % 4 === 0 ? 3 : 12), visual: "[gorge] medium" }));
assert.deepEqual(packScriptIssues(pack, ok), []);
const bad = ok.map((b) => ({ ...b })); bad[3].line = line(30); bad[15].line = line(20); bad[5].visual = "[gorge] the rope and a hanging lamp";
assert.deepEqual(packScriptIssues(pack, bad).map((x) => x.index), [3, 15]);
console.log("history-reel pack: places, pictures, kit, author prompt and script rules: ok");
