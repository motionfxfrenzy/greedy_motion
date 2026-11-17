// Storyboard previews (plates/storyboard-previews.ts): the image model paints ONLY the pack's real sets; the page draws the cast on them (no model call).
// Guards: Animation reuses the very same sets (keys, digest) and pays nothing again; no per-scene picture is ever generated or charged; cards need no charge.
// No database, no network. Run: node backend/test/storyboard-previews.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const sp = await import("../src/plates/storyboard-previews.ts");
const pa = await import("../src/plates/pack-assets.ts");
const { templatePack } = await import("../src/plan/template-packs.ts");
const { materialCostMillitokensV2 } = await import("@videosaas/contracts");

const PID = "11111111-2222-3333-4444-555555555555";
const pack = templatePack("history-reel");

// ---- only the pack that opts in changes
assert.equal(pack.storyboardPreviews, "cast");
assert.ok(pack.noSketches && pack.assets && pack.scenes, "needs the sets and the kit");
for (const id of ["dark-fable", "picture-film"]) assert.equal(templatePack(id)?.storyboardPreviews, undefined, `${id} keeps what it shows today`);
for (const gone of ["previewCast", "previewDirection"]) assert.equal(pack[gone], undefined, `${gone}: no per-scene picture is made any more`);

// ---- the film: 9 beats over 3 places, and an 8-beat film in 1 place
const places = "gorge = a rocky gorge with a wide river below; village = a small stone village street; camp = a campfire clearing at night";
const tags = ["gorge", "gorge", "gorge", "village", "village", "village", "camp", "camp", "camp"];
const mk = (tagList) => tagList.map((t, i) => ({ id: `b${i}`, keyword: `Beat ${i}`, line: `Line ${i}.`, onScreen: null, visual: `[${t}] wide: a man does thing number ${i}` }));
const beats = mk(tags);
const brief = { styleExample: "history-reel", aspect: "9:16", text: "a true story", scriptNotes: { places } };
const project = { id: PID, request: { format: "portrait" }, brief: { ...brief, scriptBeats: beats } };
const all = beats.map((_, i) => i);
const storeFake = () => { const m = new Map(); return { m, getObject: async (b, k) => m.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { m.set(`${b}:${k}`, Buffer.isBuffer(body) ? body : Buffer.from(body)); }, objectSize: async (b, k) => (m.has(`${b}:${k}`) ? m.get(`${b}:${k}`).length : null) }; };

const plan = await sp.planPreviews(project, pack, brief, beats, brief.scriptNotes, all, storeFake());
assert.equal(plan.items.length, 9);
assert.deepEqual([...new Set(plan.items.map((i) => i.set))].sort(), ["set-camp", "set-gorge", "set-village"]);
assert.deepEqual(plan.items.slice(0, 4).map((i) => i.set), ["set-gorge", "set-gorge", "set-gorge", "set-village"]);
assert.equal(plan.specs.length, 3, "the sets are the pack's own specs, nothing else is planned");

// an edited beat (action or line) changes nothing the server does: the sets depend on the places only
const edited = beats.map((b, i) => (i === 4 ? { ...b, visual: "[village] close: a different action" } : i === 5 ? { ...b, line: "A new line.", keyword: "New key" } : b));
const planEdited = await sp.planPreviews({ ...project, brief: { ...brief, scriptBeats: edited } }, pack, brief, edited, brief.scriptNotes, all, storeFake());
assert.deepEqual(planEdited.items, plan.items, "an edited beat re-poses in the page; no set is redrawn");
// a beat moved to another place changes only which set its card uses
const moved = beats.map((b, i) => (i === 4 ? { ...b, visual: "[camp] wide: moved to the camp" } : b));
const planMoved = await sp.planPreviews({ ...project, brief: { ...brief, scriptBeats: moved } }, pack, brief, moved, brief.scriptNotes, all, storeFake());
assert.equal(planMoved.items[4].set, "set-camp");
assert.equal(planMoved.items[4].setHash, plan.items[6].setHash, "the camp set is the same picture (same hash): nothing new to draw");

// ---- cost: the sets not stored yet, nothing else
assert.equal(sp.setMilli(), materialCostMillitokensV2(0.067));
const oneStore = storeFake();
const oneBeats = mk(Array(8).fill("lab"));
const oneBrief = { ...brief, scriptNotes: { places: "lab = a long wooden workshop with a big window" } };
const oneProject = { id: PID, request: { format: "portrait" }, brief: { ...oneBrief, scriptBeats: oneBeats } };
{
  const onePlan = await sp.planPreviews(oneProject, pack, oneBrief, oneBeats, oneBrief.scriptNotes, oneBeats.map((_, i) => i), oneStore);
  assert.deepEqual([...new Set(onePlan.items.map((i) => i.set))], ["set-lab"]);
  console.log(`cost: an 8-scene, 1-place film's storyboard step = 1 set = ${sp.setMilli() / 1000} tokens (the cast on the cards costs nothing); 9 scenes over 3 places = ${(3 * sp.setMilli()) / 1000} tokens`);
}

// ---- fakes for the run
function runWorld({ failSets = false, poorAfter = Infinity, store = storeFake() } = {}) {
  const log = { images: [], charges: new Map(), events: [], depth: [] };
  let charged = 0;
  const charge = async (usd, ref) => {
    if (!log.charges.has(ref)) { if (charged >= poorAfter) { const e = new Error("Not enough tokens"); e.name = "InsufficientTokens"; throw e; } charged += 1; log.charges.set(ref, usd); }
  };
  const image = async (prompt, refs, spec) => { log.images.push(spec.name); return { data: Buffer.from(`img:${spec.name}:${log.images.length}`), mime: "image/jpeg" }; };
  const assetDeps = { ...store, image, checkText: async () => ({ extra: [], figures: [], usd: 0.0002 }), enqueueDepth: async (j) => { log.depth.push(j); }, charge, parallel: 3 };
  const deps = { ...store, small: async (d) => Buffer.from(`small:${d.toString()}`), sets: failSets ? async () => { throw new Error('the picture "set-gorge" kept coming back with a person in it'); } : (specs) => pa.generatePackAssets(PID, specs, assetDeps), pollMs: 1, sleep: async () => { await new Promise((r) => setImmediate(r)); } };
  return { log, deps, store, send: (e) => log.events.push(e) };
}

// first run: the plan first, then each set as it is stored; no per-scene picture, one charge per set
{
  const w = runWorld();
  const stats = await sp.runStoryboardSets(PID, plan, w.deps, w.send);
  assert.deepEqual(Object.keys(w.log.events[0]), ["plan"], "the plan (which set each beat stands in) goes out first, at once");
  assert.equal(w.log.events[0].plan.length, 9);
  const setEvents = w.log.events.filter((e) => e.set);
  assert.equal(setEvents.length, 3); assert.ok(setEvents.every((e) => e.image.startsWith("data:image/jpeg;base64,") && e.cached === false));
  assert.deepEqual(w.log.images.slice().sort(), ["set-camp", "set-gorge", "set-village"], "the image model drew the three sets and nothing else");
  assert.ok(![...w.log.charges.keys()].some((k) => /preview|storyboard/.test(k)), "no per-scene charge exists");
  assert.equal(w.log.charges.size, 3, "one charge per set");
  assert.equal(stats.drawn, 3); assert.equal(stats.failed, 0);

  // Animation reuses the very same sets: same specs digest, same keys, nothing drawn or charged again
  const animationSpecs = pa.applyAssetNotes(pa.packSpecs(project, pack), {});
  const index = await pa.readAssetIndex(PID, w.store);
  assert.equal(index.status, "ready");
  assert.equal(index.digest, pa.specsDigest(animationSpecs), "the digest Animation computes is the digest the storyboard stored");
  const imagesBefore = w.log.images.length, chargesBefore = w.log.charges.size;
  const again = await pa.generatePackAssets(PID, animationSpecs, { ...w.store, image: async () => { throw new Error("must not draw"); }, checkText: async () => ({ extra: [], figures: [], usd: 0 }), enqueueDepth: async () => {}, charge: async () => { throw new Error("must not charge"); } });
  assert.equal(w.log.images.length, imagesBefore); assert.equal(w.log.charges.size, chargesBefore);
  for (const name of Object.keys(index.assets)) assert.equal(again.assets[name].key, index.assets[name].key, `${name}: same key`);
  assert.equal(w.log.depth.length, 3, "each set's depth map is queued once, as Animation would");

  // opening the storyboard again: every set comes back stored, nothing drawn, nothing charged
  const reopen = runWorld({ store: w.store });
  const s2 = await sp.runStoryboardSets(PID, plan, reopen.deps, reopen.send);
  assert.equal(s2.cached, 3); assert.equal(s2.drawn, 0); assert.equal(reopen.log.images.length, 0); assert.equal(reopen.log.charges.size, 0);
  assert.ok(reopen.log.events.filter((e) => e.set).every((e) => e.cached));

  // an edited beat and a moved beat cost nothing: the sets are all stored
  const ed = runWorld({ store: w.store });
  const s3 = await sp.runStoryboardSets(PID, planMoved, ed.deps, ed.send);
  assert.equal(s3.drawn, 0); assert.equal(ed.log.images.length, 0); assert.equal(ed.log.charges.size, 0);

  // the quote counts only sets not stored yet: all three before, none after
  const missing = async (store, pl) => (await Promise.all([...new Map(pl.items.map((i) => [i.set, i.setHash]))].map(async ([, h]) => (await store.objectSize("uploads", pa.assetKeyFor(PID, h))) === null))).filter(Boolean).length;
  assert.equal(await missing(storeFake(), plan), 3);
  assert.equal(await missing(w.store, plan), 0);
}

// a set that cannot be made: its cards keep their key phrase (setError events), the run does not throw
{
  const w = runWorld({ failSets: true });
  const stats = await sp.runStoryboardSets(PID, plan, w.deps, w.send);
  assert.equal(stats.drawn, 0); assert.match(stats.setsFailed, /set-gorge/);
  assert.equal(w.log.events.filter((e) => e.setError).length, 3);
}
// out of tokens: the sets that were paid stay, the rest stop
{
  const w = runWorld({ poorAfter: 1 });
  const stats = await sp.runStoryboardSets(PID, plan, w.deps, w.send);
  assert.equal(stats.stopped, "tokens");
  assert.ok(stats.drawn <= 1);
}

// ---- the route: key-phrase cards first, then the plan and the sets; no reservation; the kit is served for the page
{
  const src = readFileSync(new URL("../src/plan/routes.ts", import.meta.url), "utf8");
  const quiet = src.indexOf("const quietPack = templatePack(brief.styleExample)");
  const cards = src.indexOf("send({ index, svg: placeholderFrame(beats[index]!, brief.aspect) });", quiet);
  const run = src.indexOf("runStoryboardSets(", quiet);
  assert.ok(quiet > 0 && cards > quiet && run > cards, "key-phrase cards go out first, then the sets stream in");
  assert.match(src.slice(quiet, run), /storyboardPreviews === "cast"/, "only a pack that opts in");
  assert.ok(!/runStoryboardPreviews|previewCast|image:\s*event\.image/.test(src), "no per-scene picture code is left in the route");
  assert.match(src, /"\/v1\/storyboard-kit\/:packId"/);
}
{
  const src = readFileSync(new URL("../src/billing/step-billing.ts", import.meta.url), "utf8");
  assert.match(src, /storyboardPreviews: await quoteStoryboardPreviews\(/);
  const sketch = src.slice(src.indexOf("export async function quoteFrameSketchStep"), src.indexOf("export async function quoteVoiceMusicStep"));
  assert.ok(!/previews/i.test(sketch), "the frame-sketch quote is unchanged, so Animation never reserves the sets twice");
  const sbp = readFileSync(new URL("../src/plates/storyboard-previews.ts", import.meta.url), "utf8");
  assert.ok(!/gemini|geminiImage|IMAGE_USD\["1K"\]/.test(sbp), "the storyboard step makes no model call of its own");
}

console.log("storyboard-previews: only the sets are painted and paid, Animation reuses them, the cast is drawn in the page: ok");
