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
assert.match(pack.scriptVoice, /\nPLACES: gorge =/);
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
// the shot mix is enforced in code: script rules and the scene module
{
  const { sceneShotIssues } = await import("../src/plan/packs/history-reel/index.ts");
  const { packScriptIssues } = await import("../src/plan/template-packs.ts");
  const hr = templatePack("history-reel");
  const mk = (sizes) => sizes.map((z, i) => ({ keyword: "k" + i, line: "line " + i, visual: `[gorge] ${z}, he walks` }));
  const bad = packScriptIssues(hr, mk(["close", "close", "close", "close", "wide", "close", "close", "medium", "close", "close"]));
  assert.ok(bad.length >= 2 && bad.every((x) => /close-up/.test(x.message)), "too many close-ups are sent back for rewriting");
  assert.ok(!bad.some((x) => x.index === 0 || x.index === 9), "the opening and closing shots are left alone");
  assert.equal(packScriptIssues(hr, mk(["wide", "medium", "close", "wide", "medium", "close", "wide", "medium", "wide", "close"])).filter((x) => /close-up/.test(x.message)).length, 0, "a good mix passes");
  const scene = (z, h) => `const KEYS = [[0, { x: 540, y: 1250, z: 1.1 }], [40, { x: 470, y: 980, z: ${z} }, "snap"]];\nK.puppet(g, cam, hero, 300, 1640, ${h}, {});`;
  assert.ok(sceneShotIssues(scene(2.6, 300), { visual: "[gorge] wide, x" }).length >= 1, "a wide that zooms past 1.6 is rejected");
  assert.ok(sceneShotIssues(scene(1.4, 900), { visual: "[gorge] wide, x" }).length >= 1, "a wide with a huge puppet is rejected");
  assert.equal(sceneShotIssues(scene(1.4, 300), { visual: "[gorge] wide, x" }).length, 0);
  assert.equal(sceneShotIssues(scene(3.2, 900), { visual: "[gorge] close, x" }).length, 0, "a close-up may zoom in");
}
{
  // its own PLACES note, per-pack prompt rules, era music
  const { parseScriptStream } = await import("@videosaas/contracts");
  const parsed = parseScriptStream("IDEA: x in 1859\nPLACES: gorge = a gorge; fort = a fort\nOBJECTS: CAST: a = b\nBEAT: k\nVISUAL: [gorge] wide\nSCREEN: -\nVOICE: Hi.");
  assert.match(parsed.notes.places ?? "", /^gorge = a gorge; fort = a fort$/);
  assert.deepEqual(placesFrom({ scriptNotes: { places: parsed.notes.places } }).map((p) => p.id), ["gorge", "fort"]);
  assert.match(pack.drawRule, /no K\.backdrop/);
  assert.doesNotMatch(pack.soundsRule, /bleat|tuft/);
  assert.match(pack.musicFor({ idea: "A rope walk in 1859" }), /banjo/);
  assert.match(pack.musicFor({ idea: "Rome, 44 BC" }), /lyre/);
  assert.equal(pack.musicFor({ idea: "a story" }), null);
}
console.log("history-reel pack: places, pictures, kit, author prompt and script rules: ok");
