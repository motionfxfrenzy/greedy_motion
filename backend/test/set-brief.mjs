// The set brief (plan/packs/history-reel/set-brief.ts): a set prompt carries the REAL place, era, landmarks, camera, ground/standing area and light, never a bare
// beat action, and the set check asks whether the picture really shows that place. The case is staging film e9ea7a6e (Blondin, Niagara Gorge, 1859), whose set 1 came out
// as a castle town square: that film had NO script notes, so each place note was the first beat's character action ("medium, blondin, a full cartoon character, steps
// right onto rope ..."), and the image model painted a generic stylised town. Offline. Run: node backend/test/set-brief.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const here = dirname(fileURLToPath(import.meta.url));
const sb = await import("../src/plan/packs/history-reel/set-brief.ts");
const pa = await import("../src/plates/pack-assets.ts");
const gem = await import("../src/plates/pack-assets-gemini.ts");
const { templatePack } = await import("../src/plan/template-packs.ts");
const pack = templatePack("history-reel");

// ---- the film as it is on staging (13 beats; no scriptNotes)
const beats = [
  [1, "Over Niagara Falls", "[gorge] medium, blondin, a full cartoon character, steps right onto rope holding balancing-pole, snap reveal out on steps"],
  [2, "A quarter-mile wire", "[rope] wide, blondin, a full cartoon character holding balancing-pole, walks steadily along center rope, slow drift"],
  [3, "Getting bored", "[rope] close, blondin, a full cartoon character balancing on one foot, shrugs his shoulders, push in on shrugs"],
  [4, "He needed a stunt", "[gorge] medium, blondin, a full cartoon character, gestures to colcord, a full cartoon character sweating, whip in"],
  [12, "Safely across", "[gorge] medium, blondin, a full cartoon character, steps onto grass and colcord, a full cartoon character, collapses flat, snap reveal out on collapses"]
].map(([, keyword, visual]) => ({ keyword, line: `${keyword}.`, visual, onScreen: null }));
const TOPIC = "In 1859 Charles Blondin crossed Niagara Gorge on a tightrope, then did it again carrying his manager on his back.";
const PID = "e9ea7a6e-4423-4598-80b3-00ad6d846957";
const project = { id: PID, request: { format: "portrait" }, brief: { styleExample: "history-reel", aspect: "9:16", text: TOPIC, scriptBeats: beats } };

// ---- 1. the cause, reproduced: before the fix the set prompt was this
const placeNote = pack.assets({ projectId: PID, brief: project.brief, beats, words: [], aspect: "9:16" })[0].prompt;
assert.ok(!/a full cartoon character|balancing-pole|snap reveal/.test(placeNote), "a beat's action is never part of a set prompt");

// ---- 2. the full brief from the script's topic alone (no plan, no notes): Niagara Gorge, 1859
const specs = pa.packSpecs(project, pack);
const gorge = specs.find((s) => s.name === "set-gorge"), rope = specs.find((s) => s.name === "set-rope");
assert.ok(gorge && rope);
assert.match(gorge.prompt, /LOCATION AND ERA: Niagara Gorge, in 1859\. This must be the REAL place in the REAL era/);
assert.match(gorge.prompt, /never a generic, fantasy or European town, castle or palace/);
assert.deepEqual(gorge.expect, { location: "Niagara Gorge", era: "1859", landmarks: [] });
assert.match(rope.prompt, /LOCATION AND ERA: Niagara Gorge, in 1859/, "the rope crossing is at Niagara Gorge too");
// the fixed order: style, place, what the set shows, view, camera, ground, light, look, empty-set rules
const order = ["A vertical 9:16 frame", "LOCATION AND ERA:", "THE SET SHOWS:", "VIEW:", "CAMERA:", "GROUND AND STANDING AREA:", "LIGHT:", "Look: bright", "An empty set:"];
const at = order.map((h) => gorge.prompt.indexOf(h));
assert.ok(at.every((i) => i >= 0), `every part is present: ${order.filter((_, i) => at[i] < 0)}`);
assert.deepEqual([...at].sort((a, b) => a - b), at, "in the fixed order");
// camera and standing area: consistent with the subtitle band (the cast stands at ~70% of the frame height; the bottom quarter is plain ground)
assert.match(gorge.prompt, /eye-level camera about 1\.6 metres above the ground, held level/);
assert.match(gorge.prompt, /horizon sits about 40% down from the top/);
assert.match(gorge.prompt, /35 mm lens/);
assert.match(gorge.prompt, /lower 60% of the frame/);
assert.match(gorge.prompt, /feet at about 70% of the frame height/);
assert.match(gorge.prompt, /band between 55% and 75% of the frame height completely open, flat and empty/);
assert.match(gorge.prompt, /bottom quarter of the frame \(below 75%\) is the same plain ground.*subtitles sit over it/);
assert.match(gorge.prompt, /LIGHT: bright natural daylight: the sun high and to the upper left/);
assert.match(gorge.prompt, /no people, no characters/i); assert.match(gorge.prompt, /no rope, wire or bridge strung across/);
assert.notEqual(gorge.prompt, rope.prompt);

// ---- 3. with the planning call's facts: landmarks, the part of the place, the view, the light
const PLAN_REPLY = JSON.stringify({ places: [
  { id: "gorge", location: "Niagara Gorge below the Horseshoe Falls, on the border of Ontario and New York", era: "1859", landmarks: ["the Horseshoe Falls with rising white mist", "steep limestone cliffs", "the wide green Niagara River far below", "a grassy cliff-top bank with a few rocks"], summary: "the grassy cliff-top where the rope is anchored, the gorge dropping away in front", view: "standing on the cliff-top looking across the gorge towards the falls", light: "bright midday summer sun high to the upper left, soft shadows, a thin mist rising from the falls" },
  { id: "rope", location: "Niagara Gorge", era: "1859", landmarks: ["the gorge and the falls in the distance"], summary: "the open air over the gorge seen from the cliff edge", view: "looking along the line of the rope across the gorge", light: "" }
] });
const plan = sb.parseSetBriefs(PLAN_REPLY);
assert.deepEqual(Object.keys(plan.sets), ["gorge", "rope"]);
const planned = pa.packSpecs(project, pack, plan).find((s) => s.name === "set-gorge");
assert.match(planned.prompt, /Niagara Gorge below the Horseshoe Falls, on the border of Ontario and New York, in 1859/);
assert.match(planned.prompt, /Its unmistakable landmarks, all recognisable: the Horseshoe Falls with rising white mist; steep limestone cliffs; the wide green Niagara River far below/);
assert.match(planned.prompt, /THE SET SHOWS: the grassy cliff-top where the rope is anchored/);
assert.match(planned.prompt, /VIEW: standing on the cliff-top looking across the gorge towards the falls/);
assert.match(planned.prompt, /LIGHT: bright midday summer sun high to the upper left, soft shadows, a thin mist rising from the falls\./);
assert.deepEqual(planned.expect.landmarks.length, 4);
assert.notEqual(planned.prompt, gorge.prompt, "the planned brief is a different (richer) request");
// a plan that misses fields never leaves them empty: they are built from the script
const thin = pa.packSpecs(project, pack, sb.parseSetBriefs('{"places":[{"id":"gorge","landmarks":["the falls"]}]}')).find((s) => s.name === "set-gorge");
assert.match(thin.prompt, /LOCATION AND ERA: Niagara Gorge, in 1859/); assert.match(thin.prompt, /landmarks, all recognisable: the falls/);
assert.deepEqual(sb.parseSetBriefs("not json"), { sets: {} });

// ---- 4. the script's own PLACES note (a painter's brief) is kept as the summary; an action line never is
const withNotes = { ...project, brief: { ...project.brief, scriptNotes: { idea: TOPIC, places: "gorge = Niagara Gorge in 1859, seen from the top of the American cliff. Foreground: a flat grassy cliff-top with a few rocks. Background: the great horseshoe waterfall in the distance." } } };
const noted = pa.packSpecs(withNotes, pack).find((s) => s.name === "set-gorge");
assert.match(noted.prompt, /THE SET SHOWS: Niagara Gorge in 1859, seen from the top of the American cliff\. Foreground: a flat grassy cliff-top/);
assert.match(noted.prompt, /LOCATION AND ERA: Niagara Gorge, in 1859/);
assert.equal(sb.looksLikeAction("medium, blondin, a full cartoon character, steps right onto rope"), true);
assert.equal(sb.looksLikeAction("Niagara Gorge in 1859, seen from the top of the American cliff."), false);
// no topic, no notes: the place's own name, never a bare action
const bare = sb.resolveSetBrief({ id: "fort", description: "wide, a soldier steps forward, a full cartoon character" }, "", null);
assert.equal(bare.location, "fort"); assert.equal(bare.era, "the period of the story"); assert.equal(bare.summary, "the fort of fort"); assert.ok(!/soldier/.test(sb.composeSetPrompt(bare, { style: "S", look: "L", empty: "E" })));

// ---- 5. year, place names and light from the script
assert.equal(sb.eraFrom("In 1859 Charles Blondin"), "1859"); assert.equal(sb.eraFrom("the 1960s"), "the 1960s"); assert.equal(sb.eraFrom("in 44 BC Caesar"), "44 BC"); assert.equal(sb.eraFrom("a story"), null);
assert.equal(sb.locationFrom(TOPIC, "gorge"), "Niagara Gorge"); assert.equal(sb.locationFrom(TOPIC, "rope"), "Niagara Gorge", "a place id with no phrase of its own takes the film's place");
assert.equal(sb.locationFrom("In 1666 Thomas Farriner's oven on Pudding Lane started the Great Fire of London", "street"), "Pudding Lane");
assert.equal(sb.locationFrom("Charles Blondin crossed", "x"), null, "a person is not a place");
assert.match(sb.lightFrom("Midnight on Pudding Lane, a spark drops into straw"), /^night/); assert.match(sb.lightFrom("a quiet noon"), /^bright natural daylight/); assert.match(sb.lightFrom("sunset over the bay"), /^golden hour/);

// ---- 6. the planning request carries the topic, the places and their scenes, and never the action as a place
const req = sb.setBriefRequest([{ id: "gorge", description: "medium, blondin, a full cartoon character, steps" }, { id: "rope", description: "Niagara Gorge in 1859, the open air over the gorge" }], beats, null, TOPIC);
assert.match(req.user, /TOPIC: In 1859 Charles Blondin crossed Niagara Gorge/); assert.match(req.user, /- id "gorge" \(used by: scene 1: Over Niagara Falls/);
assert.ok(!/id "gorge": medium/.test(req.user), "an action note is not offered as the place's description"); assert.match(req.user, /id "rope": Niagara Gorge in 1859/);
assert.match(req.system, /the REAL place in the REAL era/);
// the shot plan reaches assets: loadShotPlan passes the topic and the parsed sets
const store = new Map(); let seenUser = "";
const plan2 = await pa.loadShotPlan(project, pack, { getObject: async (b, k) => store.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { store.set(`${b}:${k}`, Buffer.from(body)); }, call: async (request) => { seenUser = request.user; return { text: PLAN_REPLY, usd: 0.001 }; } });
assert.match(seenUser, /TOPIC: In 1859 Charles Blondin/); assert.deepEqual(Object.keys(plan2.sets), ["gorge", "rope"]);

// ---- 7. the check: the same request carries the place question; a wrong place is redrawn with the reason, within the cap, every try kept as a candidate
const q = gem.placeQuestion({ location: "Niagara Gorge", era: "1859", landmarks: ["the Horseshoe Falls", "limestone cliffs"] });
assert.match(q, /Niagara Gorge in 1859, with its recognisable landmarks \(the Horseshoe Falls; limestone cliffs\)/); assert.match(q, /"place": \{"match": true or false, "reason":/); assert.match(q, /generic European town, castle, palace or fantasy/);
const gsrc = readFileSync(join(here, "../src/plates/pack-assets-gemini.ts"), "utf8");
assert.match(gsrc, /text: expect \? CHECK_PROMPT \+ placeQuestion\(expect\) : CHECK_PROMPT/, "ONE request: the place question is appended to the existing check prompt");
const checkBody = gsrc.slice(gsrc.indexOf("async function checkWith"), gsrc.indexOf("export async function geminiTextCheck"));
assert.equal((checkBody.match(/await callModel\(/g) ?? []).length, 1, "the check is still one model call per provider: the place question adds no call");

function world(verdicts) {
  const files = new Map(), log = { prompts: [], expects: [], depth: [] };
  let n = 0;
  const deps = {
    getObject: async (b, k) => files.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { files.set(`${b}:${k}`, Buffer.isBuffer(body) ? body : Buffer.from(body)); },
    objectSize: async (b, k) => (files.has(`${b}:${k}`) ? files.get(`${b}:${k}`).length : null),
    image: async (prompt) => { log.prompts.push(prompt); n += 1; return { data: Buffer.from(`pic${n}`), mime: "image/jpeg" }; },
    checkText: async (image, _mime, expect) => { log.expects.push(expect); const v = verdicts[image.toString()] ?? { match: true, reason: "" }; return { extra: [], figures: [], place: v, usd: 0.0002 }; },
    enqueueDepth: async (j) => { log.depth.push(j); }, parallel: 1
  };
  return { deps, log, files };
}
{
  const w = world({ pic1: { match: false, reason: "it shows a European castle town square with cobbles and stairs" } });
  const index = await pa.generatePackAssets(PID, [planned], w.deps);
  assert.equal(index.status, "ready"); assert.equal(w.log.prompts.length, 2, "one redraw");
  assert.match(w.log.prompts[1], /WRONG PLACE: it shows a European castle town square with cobbles and stairs\. This MUST be Niagara Gorge below the Horseshoe Falls.* in 1859, showing the Horseshoe Falls with rising white mist/);
  assert.ok(w.log.expects.every((e) => e?.era === "1859"), "every check call carried the expected place");
  const kept = JSON.parse(w.files.get(`uploads:${pa.candidateListKey(PID, index.assets["set-gorge"].hash)}`).toString());
  assert.equal(kept.length, 2, "both tries are kept as candidates (paid for once)");
  assert.equal(Buffer.from(w.files.get(`uploads:${index.assets["set-gorge"].key}`)).toString(), "pic2", "the matching picture is the one used");
}
{
  // never matching: after the cap (2 redraws) the best of the tries is used, not a failed film; every try is a candidate
  const w = world({ pic1: { match: false, reason: "castle" }, pic2: { match: false, reason: "castle" }, pic3: { match: false, reason: "castle" } });
  const index = await pa.generatePackAssets(PID, [planned], w.deps);
  assert.equal(index.status, "ready"); assert.equal(w.log.prompts.length, 1 + pa.MAX_FIGURE_REDRAWS, "within the existing redraw cap");
  assert.equal(JSON.parse(w.files.get(`uploads:${pa.candidateListKey(PID, index.assets["set-gorge"].hash)}`).toString()).length, 3);
}
{
  // a later run of the same picture checks the kept candidates (with the place question) before painting again
  const first = world({ pic1: { match: false, reason: "castle" }, pic2: { match: false, reason: "castle" }, pic3: { match: false, reason: "castle" } });
  await pa.generatePackAssets(PID, [planned], first.deps);
  for (const k of [...first.files.keys()].filter((k) => !k.includes("candidates/"))) first.files.delete(k);
  const again = world({ pic2: { match: true, reason: "" } });
  again.files = first.files; again.deps.getObject = async (b, k) => first.files.get(`${b}:${k}`) ?? null; again.deps.putObject = async (b, k, body) => { first.files.set(`${b}:${k}`, Buffer.isBuffer(body) ? body : Buffer.from(body)); }; again.deps.objectSize = async (b, k) => (first.files.has(`${b}:${k}`) ? first.files.get(`${b}:${k}`).length : null);
  const idx = await pa.generatePackAssets(PID, [planned], again.deps);
  assert.equal(again.log.prompts.length, 0, "a kept candidate that now passes the place check is reused: nothing painted"); assert.equal(idx.status, "ready");
}
{
  // a check that answers nothing about the place never fails a picture
  const w = world({}); w.deps.checkText = async () => ({ extra: [], figures: [], usd: 0 });
  const index = await pa.generatePackAssets(PID, [planned], w.deps); assert.equal(w.log.prompts.length, 1); assert.equal(index.status, "ready");
}
// a spec without an expectation (other packs) is checked exactly as before
{ const w = world({}); const spec = { name: "set-x", prompt: "p", aspect: "9:16", size: "2K", noText: true, noFigures: true }; await pa.generatePackAssets(PID, [spec], w.deps); assert.deepEqual(w.log.expects, [undefined]); }

// ---- a saved picture is never paid for twice: a set stored under an EARLIER prompt that passes the checks (and the place question) is kept under the new hash:
// no image call, no charge; one that fails is repainted once
{
  const oldSpec = { ...planned, prompt: "the old prompt: a castle town square", expect: planned.expect };
  const run = async (late = {}) => {
    const verdicts = {}; const w = world(verdicts); const charges = []; w.deps.charge = async (usd, ref) => { charges.push(ref); };
    // 1. the film as it was: its set painted from the old prompt (its own check passed then)
    const oldWorld = await pa.generatePackAssets(PID, [oldSpec], w.deps);
    const oldRecord = oldWorld.assets["set-gorge"];
    w.files.set(`outputs:${oldRecord.depth.key}`, Buffer.from("old-depth-map"));
    Object.assign(verdicts, late); // from now on the check sees the old picture for what it is
    const paintedBefore = w.log.prompts.length, chargedBefore = charges.length;
    // 2. the new prompt: a new hash
    assert.notEqual(pa.assetHash(planned, []), oldRecord.hash);
    const next = await pa.generatePackAssets(PID, [planned], w.deps);
    return { w, charges, oldRecord, next, painted: w.log.prompts.length - paintedBefore, charged: charges.length - chargedBefore };
  };
  const good = await run({});
  assert.equal(good.painted, 0, "the old set passes the place question: no image call"); assert.equal(good.charged, 0, "and no charge");
  assert.equal(Buffer.from(good.w.files.get(`uploads:${good.next.assets["set-gorge"].key}`)).toString(), Buffer.from(good.w.files.get(`uploads:${good.oldRecord.key}`)).toString(), "the new hash holds the very same picture");
  assert.notEqual(good.next.assets["set-gorge"].key, good.oldRecord.key); assert.equal(good.next.status, "ready");
  assert.equal(Buffer.from(good.w.files.get(`outputs:${good.next.assets["set-gorge"].depth.key}`)).toString(), "old-depth-map", "its depth map is copied too, not made again");
  assert.equal(good.w.log.depth.filter((d) => d.depthKey === good.next.assets["set-gorge"].depth.key).length, 0, "no depth job for the new hash");
  const bad = await run({ pic1: { match: false, reason: "it shows a European castle town square" } });
  assert.equal(bad.painted, 1, "an old set that fails the place question is repainted once"); assert.equal(bad.charged, 1, "and paid for once");
  assert.match(bad.w.log.prompts.at(-1), /LOCATION AND ERA: Niagara Gorge below the Horseshoe Falls/);
  assert.notEqual(Buffer.from(bad.w.files.get(`uploads:${bad.next.assets["set-gorge"].key}`)).toString(), "pic1");
  // an old picture the check cannot confirm (no place answer) is not trusted: it is repainted
  const unknown = world({}); unknown.deps.checkText = async (image) => ({ extra: [], figures: [], ...(image.toString() === "pic1" ? {} : { place: { match: true, reason: "" } }), usd: 0 });
  await pa.generatePackAssets(PID, [oldSpec], unknown.deps); const before = unknown.log.prompts.length;
  await pa.generatePackAssets(PID, [planned], unknown.deps); assert.equal(unknown.log.prompts.length - before, 1, "an unconfirmed old picture is repainted");
  // only specs with an expectation (the sets) look back: another pack's picture keeps its hash rules
  const plain = world({}); const a = { name: "set-p", prompt: "one", aspect: "9:16", size: "2K", noText: true, noFigures: true }; const b = { ...a, prompt: "two" };
  await pa.generatePackAssets(PID, [a], plain.deps); const n0 = plain.log.prompts.length; await pa.generatePackAssets(PID, [b], plain.deps); assert.equal(plain.log.prompts.length - n0, 1);
}

console.log("set-brief: a set is painted as the real place (Niagara Gorge, 1859), from a full brief, and checked against it: ok");
