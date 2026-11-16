// Picture film pack ("Illustrated facts"): shot slots and splitting, the shot list (from the script and from a model reply),
// the image list's order and refs, and the deterministic scene module (cut frames, and that it bundles in the plate engine).
// No database, no network, no browser. Run: node backend/test/picture-film-pack.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const { templatePack } = await import("../src/plan/template-packs.ts");
const pf = await import("../src/plan/packs/picture-film/index.ts");
const { bundleScene } = await import("@videosaas/plate-engine");

// ---- the pack is registered and shaped like the reference
const pack = templatePack("picture-film");
assert.ok(pack, "the picture-film pack is registered");
assert.equal(pack, pf.pictureFilm);
assert.equal(pack.voice.id, "Charon");
assert.equal(pack.voice.tighten, true);
assert.ok(pack.voice.direction.length <= 200, "voice direction fits the 200-character limit");
assert.equal(pack.music, "", "no music, as in the reference");
assert.equal(pack.sceneSounds, false);
assert.ok(pack.pacing.gap <= 0.15 && pack.pacing.min <= 0.6, "tight pacing");
for (const part of ["PLAN FIRST", "OBJECTS: cast:", "| sets:", "REAL FACTS ONLY", "three possible outcomes", "round(words / 6)", "pop:", "[LABEL]", "SCREEN: -"]) assert.ok(pack.scriptVoice.includes(part), `script voice has ${part}`);
assert.equal(typeof pack.assets, "function");
assert.equal(typeof pack.sceneAssets, "function");
assert.equal(typeof pack.sceneCode, "function");

// ---- slots: one still per ~6 words, split on a pause when one is next to the even split
assert.equal(pf.shotNames(0, "").length, 1);
assert.equal(pf.shotNames(0, "It cried.").length, 1);
assert.equal(pf.shotNames(2, "You are walking down the street, chewing a fresh piece of mint gum.").join(), "shot-03-1,shot-03-2");
assert.equal(pf.shotNames(0, Array(60).fill("w").join(" ")).length, 4, "at most 4 stills a beat");
const gum = pf.shotSlots(0, "You are walking down the street, chewing a fresh piece of mint gum.");
assert.deepEqual(gum.map((s) => s.text), ["You are walking down the street,", "chewing a fresh piece of mint gum."], "split after the comma (as the test's shots 1 and 2)");
const three = "Does it dissolve in stomach acid, stick for seven years, or block your gut?".split(" ");
assert.deepEqual(pf.splitStarts(three, 3), [0, 6, 10], "three stills split on both commas (the test's shots 5, 6, 7)");
assert.deepEqual(pf.splitStarts("a b c d e f g h".split(" "), 2), [0, 4], "no pause: the even split");
for (let n = 1; n <= 30; n++) for (let c = 1; c <= Math.min(4, n); c++) {
  const s = pf.splitStarts(Array(n).fill("w"), c);
  assert.equal(s.length, c); assert.equal(s[0], 0);
  for (let k = 1; k < c; k++) assert.ok(s[k] > s[k - 1] && s[k] < n, `strictly increasing starts for ${n} words / ${c}`);
}

// ---- labels: only words spoken in that still
assert.equal(pf.checkLabel("mint gum", "chewing a fresh piece of mint gum."), "MINT GUM");
assert.equal(pf.checkLabel("SEVEN YEARS", "stick for seven years,"), "SEVEN YEARS");
assert.equal(pf.checkLabel("7 YEARS", "stick for seven years,"), "7 YEARS", "a spoken number may be digits");
assert.equal(pf.checkLabel("STOMACH ACID", "stick for seven years,"), null, "not spoken in this still");
assert.equal(pf.checkLabel("ONE TWO THREE FOUR", "one two three four"), null, "at most 3 words");
assert.equal(pf.checkLabel(null, "x"), null);

// ---- the script's plan lines
const notes = { idea: "Swallowed gum passes through in a few days.", example: null, objects: "cast: you = stick figure in a red cap; doctor = lab coat, round glasses | sets: street = sidewalk, lamp post, plain sky; gut = side-on cross-section of stomach and intestines; card = plain cream info card" };
const objs = pf.parseObjects(notes.objects);
assert.deepEqual(objs.characters.map((c) => c.id), ["you", "doctor"]);
assert.deepEqual(objs.sets.map((s) => s.id), ["street", "gut", "card"]);
assert.equal(objs.sets[0].look, "sidewalk, lamp post, plain sky");
const segs = pf.parseVisual("wide street: you walk past a lamp post / close street: you blow a tiny bubble [MINT GUM] / pop: a red arrow at the throat");
assert.deepEqual(segs.map((s) => [s.kind, s.framing, s.set, s.label]), [["new", "wide", "street", null], ["new", "close", "street", "MINT GUM"], ["pop", null, null, null]]);

const beats = [
  { keyword: "Walking with gum", visual: "wide street: you walk past a lamp post, chewing / close street: you blow a tiny bubble [MINT GUM]", onScreen: null, line: "You are walking down the street, chewing a fresh piece of mint gum." },
  { keyword: "The gulp", visual: "close street: you gasp / pop: a red arrow points down your throat [GULP]", onScreen: null, line: "You take a sudden breath and accidentally gulp the whole wad down." },
  { keyword: "Three outcomes", visual: "cutaway gut: gum ball in the stomach [ACID] / insert card: a calendar [SEVEN YEARS] / extra segment folds in", onScreen: null, line: "Does it dissolve in stomach acid, stick for seven years, or block your gut?" },
  { keyword: "Short", visual: null, onScreen: null, line: "It passes." }
];
const fromScript = pf.planFromScript(beats, notes);
assert.deepEqual(fromScript.shots.map((s) => s.name), ["shot-01-1", "shot-01-2", "shot-02-1", "shot-02-2", "shot-03-1", "shot-03-2", "shot-04-1"]);
assert.deepEqual(fromScript.shots.map((s) => s.kind), ["new", "new", "new", "pop", "new", "new", "new"]);
assert.equal(fromScript.shots[1].label, "MINT GUM");
assert.equal(fromScript.shots[3].label, "GULP");
assert.equal(fromScript.shots[3].set, "street", "a pop keeps the picture's set");
assert.equal(fromScript.shots[4].framing, "cutaway");
assert.equal(fromScript.shots[4].label, "ACID");
assert.equal(fromScript.shots[5].label, "SEVEN YEARS");
assert.match(fromScript.shots[5].picture, /calendar.*extra segment/, "extra VISUAL segments fold into the last still");
assert.equal(fromScript.shots[6].picture, "It passes.", "a beat without VISUAL draws its line");
assert.equal(fromScript.shots[6].set, "card", "and keeps the set before it");

// ---- the shot-list call: request lists every slot with its words; the reply fills them; bad entries fall back slot by slot
const req = pf.shotListRequest(beats, notes);
assert.match(req.user, /shot-01-2 \| beat 1 visual: .* \| words: "chewing a fresh piece of mint gum\."/);
assert.equal(req.user.split("\n").filter((l) => l.startsWith("shot-")).length, 7);
assert.match(req.system, /Do not add, remove, merge or rename stills/);
const reply = "```json\n" + JSON.stringify({
  characters: [{ id: "you", look: "stick figure, red cap, blue backpack" }, { id: "doctor", look: "lab coat, round glasses, clipboard" }],
  sets: [{ id: "street", look: "a sidewalk line, lamp post, low brick wall, plain sky" }, { id: "gut", look: "side-on cross-section of a J-shaped stomach and looping intestines" }, { id: "card", look: "plain cream card" }],
  shots: [
    { name: "shot-01-1", kind: "pop", set: "street", framing: "wide", picture: "you walk left to right", label: "STREET" },
    { name: "shot-01-2", kind: "new", set: "nowhere", framing: "zoomed", picture: "you chew, a tiny bubble", label: "PIZZA", annotations: "red arrow at the bubble" },
    { name: "shot-02-2", kind: "pop", set: "gut", framing: "insert", picture: "a red arrow down the throat", label: "GULP" },
    { name: "shot-03-1", kind: "new", set: "gut", framing: "cutaway", picture: "the gum ball in the stomach", label: "stomach acid" }
  ]
}) + "\n```";
const plan = pf.parseShotList(reply, beats, notes);
assert.equal(plan.characters[0].look, "stick figure, red cap, blue backpack", "the reply's looks win");
assert.deepEqual(plan.shots.map((s) => s.name), fromScript.shots.map((s) => s.name), "the slots never change");
assert.equal(plan.shots[0].kind, "new", "the first still is never a pop");
assert.equal(plan.shots[0].label, "STREET");
assert.equal(plan.shots[1].set, "street", "unknown set falls back");
assert.equal(plan.shots[1].framing, "close", "unknown framing falls back");
assert.equal(plan.shots[1].label, null, "an unspoken label is dropped");
assert.deepEqual(plan.shots[1].annotations, ["red arrow at the bubble"]);
assert.equal(plan.shots[2].picture, fromScript.shots[2].picture, "a slot the reply skipped comes from the script");
assert.equal(plan.shots[3].set, plan.shots[2].set, "a pop keeps the previous still's set");
assert.equal(plan.shots[3].framing, plan.shots[2].framing, "and its framing");
assert.equal(plan.shots[4].label, "STOMACH ACID");
assert.deepEqual(pf.parseShotList("not json at all", beats, notes), fromScript, "a broken reply is the script's own plan");

// ---- the image list: anchors first, then the stills; refs always name earlier entries
const specs = pack.assets({ beats, brief: { scriptNotes: notes }, aspect: "9:16", words: [], projectId: "p" });
const names = specs.map((s) => s.name);
assert.deepEqual(names.slice(0, 6), ["style", "set-street", "set-gut", "set-card", "char-you", "char-doctor"], "style anchor, set anchors, character sheets");
assert.deepEqual(names.slice(6), fromScript.shots.map((s) => s.name));
specs.forEach((spec, i) => {
  assert.equal(spec.aspect, "9:16"); assert.equal(spec.size, "1K");
  for (const ref of spec.refs ?? []) assert.ok(names.indexOf(ref) > -1 && names.indexOf(ref) < i, `${spec.name}: ref ${ref} comes earlier`);
});
const by = Object.fromEntries(specs.map((s) => [s.name, s]));
assert.equal(by.style.refs, undefined, "the style anchor is drawn from text");
assert.deepEqual(by["set-gut"].refs, ["style"]);
assert.deepEqual(by["char-doctor"].refs, ["style"]);
assert.deepEqual(by["shot-01-1"].refs, ["set-street", "char-you"], "a still: its set anchor and the sheets of the characters it names");
assert.deepEqual(by["shot-02-2"].refs, ["shot-02-1"], "a pop edits the still before it");
assert.match(by["shot-02-2"].prompt, /^Edit this picture/);
assert.match(by["style"].prompt, /vertical 9:16 portrait frame/, "the drawing style is adapted to 9:16");
assert.match(by["shot-01-1"].prompt, /Clean confident dark-brown\/black outlines/, "DRAWING_STYLE from test/style.mjs");
for (const n of ["style", "set-street", "char-you", "shot-01-1", "shot-02-1", "shot-04-1"]) assert.equal(by[n].noText, true, `${n} has no words`);
assert.equal(by["shot-01-2"].noText, false, "a labelled still is not word-checked as text-free");
assert.deepEqual(by["shot-01-2"].allowedText, ["MINT GUM"]);
assert.match(by["shot-01-2"].prompt, /The only words in the picture: "MINT GUM"/);
assert.deepEqual(by["shot-02-2"].allowedText, ["GULP"]);
const withPlan = pack.assets({ beats, brief: { scriptNotes: notes }, aspect: "16:9", plan, words: [], projectId: "p" });
assert.equal(withPlan[0].aspect, "16:9");
assert.match(withPlan.find((s) => s.name === "char-you").prompt, /blue backpack/, "a parsed shot list is used when given");
assert.equal(pack.assets({ beats, brief: { scriptNotes: notes }, aspect: "1:1" })[0].aspect, "9:16", "a square film uses 9:16 stills");
assert.deepEqual(pack.sceneAssets(2, beats), ["shot-03-1", "shot-03-2"]);

// ---- scene module: cuts 2 frames before each still's first word, deterministic, no model
const words0 = [["You", 0.21], ["are", 0.27], ["walking", 0.42], ["down", 0.97], ["the", 1.2], ["street,", 1.41], ["chewing", 1.98], ["a", 2.33], ["fresh", 2.38], ["piece", 2.63], ["of", 2.88], ["mint", 2.98], ["gum.", 3.18]].map(([text, start]) => ({ text, start, end: start + 0.2 }));
const input0 = { beatIndex: 0, frames: 109, fps: 30, beatWords: words0, assetNames: pack.sceneAssets(0, beats), aspect: "9:16", beats };
const code0 = pack.sceneCode(input0);
assert.equal(code0, pack.sceneCode(input0), "same input, same module");
assert.match(code0, /const STILLS: \[string, number\]\[\] = \[\["shot-01-1", 0\], \["shot-01-2", 57\]\];/, "cut at round(1.98 * 30) - 2 = 57");
assert.match(code0, /export const sounds: \{ kind: string; frame: number \}\[\] = \[\];/);
assert.match(code0, /env\.image\(still\[0\]\)/);
assert.doesNotMatch(code0, /Math\.random|Date|fetch/);
assert.deepEqual(pf.cutFrames({ frames: 136, words: [], assets: ["a", "b", "c"], line: null }), [0, 45, 91], "no word times: even split");
const heard = [["Does", 0.1], ["it", 0.2], ["dissolve", 0.47], ["in", 0.97], ["stomach", 1.1], ["acid,", 1.53], ["stick", 1.99], ["for", 2.26], ["seven", 2.45], ["years,", 2.77], ["or", 3.21], ["block", 3.35], ["your", 3.8], ["gut?", 3.99]].map(([text, start]) => ({ text, start }));
const line2 = beats[2].line;
assert.deepEqual(pf.cutFrames({ frames: 136, words: heard, assets: ["a", "b", "c"], line: line2 }), [0, 58, 94]);
assert.deepEqual(pf.cutFrames({ frames: 136, words: heard.filter((w) => w.text !== "stick"), assets: ["a", "b", "c"], line: line2 }), [0, 66, 94], "an unmatched first word takes the next heard word's place");
assert.deepEqual(pf.cutFrames({ frames: 5, words: heard, assets: ["a", "b", "c"], line: line2 }), [0, 3, 4], "cuts stay inside a short scene");
assert.deepEqual(pf.alignTimes(["Forty-eight", "hours"], [{ text: "48", start: 0 }, { text: "hours", start: 0.5 }]), [undefined, 0.5]);

for (const aspect of ["9:16", "16:9"]) {
  const { html, manifest } = await bundleScene({ look: "illus-flat-vector", code: pack.sceneCode({ ...input0, aspect }), frames: 109, aspect });
  assert.ok(html.length > 1000 && /shot-01-2/.test(html), `the ${aspect} module bundles`);
  assert.equal(manifest.frames, 109);
  assert.equal(manifest.width, aspect === "9:16" ? 1080 : 1920);
}
console.log("picture-film pack: ok");
