// Storyboard previews (plates/storyboard-previews.ts): the sets first through the pack's real asset step, then one still per beat.
// Guards: Animation reuses the very same pictures (keys, digest) and pays nothing again; one charge per picture content; an edited beat
// redraws only its own picture; a failed picture is never charged and keeps its key-phrase card; only the pack that opts in changes.
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
assert.equal(pack.storyboardPreviews, "image");
assert.ok(pack.noSketches && pack.assets && pack.previewCast && pack.previewDirection);
for (const id of ["dark-fable", "picture-film"]) assert.equal(templatePack(id)?.storyboardPreviews, undefined, `${id} keeps what it shows today`);

// ---- the cast sheet is our own kit's, never the reference character
const cast = pack.previewCast();
assert.equal(cast.subarray(0, 4).toString("hex"), "89504e47", "a PNG");
assert.deepEqual(cast, readFileSync(new URL("../src/plan/packs/history-reel/pose-sheet.png", import.meta.url)), "the kit's own pose sheet");

// ---- the film: 9 beats over 3 places
const places = "gorge = a rocky gorge with a wide river below; village = a small stone village street; camp = a campfire clearing at night";
const tags = ["gorge", "gorge", "gorge", "village", "village", "village", "camp", "camp", "camp"];
const beats = tags.map((t, i) => ({ id: `b${i}`, keyword: `Beat ${i}`, line: `Line ${i}.`, onScreen: null, visual: `[${t}] wide: a man does thing number ${i}` }));
const brief = { styleExample: "history-reel", aspect: "9:16", text: "a true story", scriptNotes: { places } };
const project = { id: PID, request: { format: "portrait" }, brief: { ...brief, scriptBeats: beats } };
const all = beats.map((_, i) => i);

// ---- prompt and hash
const p0 = sp.previewPrompt(beats[0], pack.previewDirection);
assert.match(p0, /a man does thing number 0/);
assert.ok(!/\[gorge\]/.test(p0), "the place tag is not part of the action");
assert.match(p0, /NO TEXT/);
assert.match(p0, /first reference picture/);
assert.ok(!/POSE_RULES|reference character/i.test(p0));
const storeFake = () => { const m = new Map(); return { m, getObject: async (b, k) => m.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { m.set(`${b}:${k}`, Buffer.isBuffer(body) ? body : Buffer.from(body)); }, objectSize: async (b, k) => (m.has(`${b}:${k}`) ? m.get(`${b}:${k}`).length : null) }; };

const planA = await sp.planPreviews(project, pack, brief, beats, brief.scriptNotes, all, storeFake());
assert.equal(planA.items.length, 9);
assert.deepEqual([...new Set(planA.items.map((i) => i.set))].sort(), ["set-camp", "set-gorge", "set-village"]);
assert.equal(new Set(planA.items.map((i) => i.hash)).size, 9, "every beat has its own picture");

// an edited beat changes only its own hash; the voiceover line and the key phrase are not part of the picture
const edited = beats.map((b, i) => (i === 4 ? { ...b, visual: "[village] close: a different action" } : i === 5 ? { ...b, line: "A new line.", keyword: "New key" } : b));
const planB = await sp.planPreviews({ ...project, brief: { ...brief, scriptBeats: edited } }, pack, brief, edited, brief.scriptNotes, all, storeFake());
assert.deepEqual(planB.items.filter((it, i) => it.hash !== planA.items[i].hash).map((it) => it.index), [4], "only the edited beat redraws");
assert.equal(planB.specs.length, planA.specs.length);

// ---- cost: the per-picture material rule at the 30% margin
assert.equal(sp.previewMilli(), materialCostMillitokensV2(0.039));
assert.equal(sp.setMilli(), materialCostMillitokensV2(0.067));
const filmMilli = 9 * sp.previewMilli() + 3 * sp.setMilli();
console.log(`cost: one preview ${sp.previewMilli() / 1000}t, one set ${sp.setMilli() / 1000}t, 9 previews ${(9 * sp.previewMilli()) / 1000}t, 9 previews + 3 sets ${filmMilli / 1000}t`);

// ---- fakes for the run
function runWorld({ failBeats = [], poorAfter = Infinity, store = storeFake() } = {}) {
  const log = { images: [], charges: new Map(), chargeCalls: 0, events: [], depth: [] };
  let charged = 0;
  const charge = async (usd, ref) => {
    log.chargeCalls += 1;
    if (!log.charges.has(ref)) { if (charged >= poorAfter) { const e = new Error("Not enough tokens"); e.name = "InsufficientTokens"; throw e; } charged += 1; log.charges.set(ref, usd); }
  };
  const image = async (prompt, refs, spec) => {
    log.images.push({ prompt, refs: refs.map((r) => r.name), spec });
    if (spec.name.startsWith("preview-") && failBeats.includes(Number(spec.name.slice(8)))) throw new Error("came back empty (safety filtered)");
    return { data: Buffer.from(`img:${spec.name}:${log.images.length}`), mime: "image/jpeg" };
  };
  const assetDeps = { ...store, image, checkText: async () => ({ extra: [], figures: [], usd: 0.0002 }), enqueueDepth: async (j) => { log.depth.push(j); }, charge: async (usd, ref) => charge(usd, `set:${ref}`), parallel: 3 };
  const deps = {
    ...store, image, charge: async (usd, ref) => charge(usd, `preview:${ref}`),
    shrink: async (d) => d, normalise: async (i) => ({ data: i.data, mime: "image/jpeg" }), small: async (d) => Buffer.from(`small:${d.toString()}`),
    sets: (specs) => pa.generatePackAssets(PID, specs, assetDeps), parallel: 4, pollMs: 1, sleep: async () => { await new Promise((r) => setImmediate(r)); }
  };
  return { log, deps, store, send: (e) => log.events.push(e) };
}

// first run: sets are drawn once, then one picture per beat, referencing the set and the cast sheet
{
  const w = runWorld();
  const stats = await sp.runStoryboardPreviews(PID, pack, planA, w.deps, w.send);
  assert.equal(stats.drawn, 9); assert.equal(stats.failed, 0);
  assert.equal(w.log.events.filter((e) => e.image).length, 9, "every card gets its picture");
  assert.ok(w.log.events.every((e) => !e.image || e.image.startsWith("data:image/jpeg;base64,")));
  const setImages = w.log.images.filter((i) => i.spec.name.startsWith("set-")), stills = w.log.images.filter((i) => i.spec.name.startsWith("preview-"));
  assert.equal(setImages.length, 3, "the three sets, once each");
  assert.equal(stills.length, 9);
  assert.ok(stills.every((s) => s.refs[0].startsWith("set") && s.refs[1].startsWith("cast")), "two references: the set, then the cast sheet");
  assert.ok(stills.every((s) => s.spec.size === "1K" && s.spec.aspect === "9:16"));
  const paidSets = [...w.log.charges.keys()].filter((k) => k.startsWith("set:")).length, paidStills = [...w.log.charges.keys()].filter((k) => k.startsWith("preview:")).length;
  assert.equal(paidSets, 3); assert.equal(paidStills, 9, "one charge per picture");

  // Animation reuses the very same pictures: same specs digest, same keys, nothing drawn or charged again
  const animationSpecs = pa.applyAssetNotes(pa.packSpecs(project, pack), {});
  const index = await pa.readAssetIndex(PID, w.store);
  assert.equal(index.status, "ready");
  assert.equal(index.digest, pa.specsDigest(animationSpecs), "the digest Animation computes is the digest the previews stored");
  const imagesBefore = w.log.images.length, chargesBefore = w.log.charges.size;
  const again = await pa.generatePackAssets(PID, animationSpecs, { ...w.store, image: async () => { throw new Error("must not draw"); }, checkText: async () => ({ extra: [], figures: [], usd: 0 }), enqueueDepth: async () => {}, charge: async () => { throw new Error("must not charge"); } });
  assert.equal(w.log.images.length, imagesBefore); assert.equal(w.log.charges.size, chargesBefore);
  for (const name of Object.keys(index.assets)) assert.equal(again.assets[name].key, index.assets[name].key, `${name}: same key`);
  assert.equal(w.log.depth.length, 3, "each set's depth map is queued once, as Animation would");

  // opening the storyboard again: every picture comes back stored, no drawing and no new charge
  const reopen = runWorld({ store: w.store });
  reopen.log.charges = new Map(w.log.charges); // the same ledger
  const s2 = await sp.runStoryboardPreviews(PID, pack, planA, reopen.deps, reopen.send);
  assert.equal(s2.cached, 9); assert.equal(s2.drawn, 0); assert.equal(reopen.log.images.length, 0, "nothing is drawn again");
  assert.equal(reopen.log.charges.size, w.log.charges.size, "and nothing is charged again");

  // one beat edited: only its picture is drawn (and charged)
  const ed = runWorld({ store: w.store });
  ed.log.charges = new Map(w.log.charges);
  const s3 = await sp.runStoryboardPreviews(PID, pack, planB, ed.deps, ed.send);
  assert.equal(s3.drawn, 1); assert.equal(s3.cached, 8);
  assert.equal(ed.log.images.length, 1, "a single new picture, and no set is redrawn");
  assert.equal(ed.log.charges.size, w.log.charges.size + 1);
  assert.deepEqual(ed.log.events.filter((e) => e.image && !e.cached).map((e) => e.index), [4]);
}

// a picture that fails keeps its key-phrase card and is never charged
{
  const w = runWorld({ failBeats: [2] });
  const stats = await sp.runStoryboardPreviews(PID, pack, planA, w.deps, w.send);
  assert.equal(stats.drawn, 8); assert.equal(stats.failed, 1);
  assert.ok(w.log.events.some((e) => e.index === 2 && e.error), "an error event, so the page keeps the card");
  assert.ok(![...w.log.charges.keys()].some((k) => k === `preview:${PID}:${planA.items[2].hash}`), "the failed picture was never charged");
  assert.equal([...w.log.charges.keys()].filter((k) => k.startsWith("preview:")).length, 8);
}

// a person out of tokens stops the run: no more pictures are drawn than can be paid for
{
  const w = runWorld({ poorAfter: 3 + 2 }); // the three sets, then two previews
  const stats = await sp.runStoryboardPreviews(PID, pack, planA, w.deps, w.send);
  assert.equal(stats.stopped, "tokens");
  assert.ok(stats.drawn <= 2 + 4, "the picture in flight when the balance ran out is the last one");
  assert.ok(w.log.events.some((e) => e.error && /tokens/i.test(e.error)));
}

// a set that cannot be drawn: every preview of it keeps its card, the run does not throw
{
  const w = runWorld();
  w.deps.sets = async () => { throw new Error("the picture \"set-gorge\" kept coming back with a person in it"); };
  const stats = await sp.runStoryboardPreviews(PID, pack, planA, w.deps, w.send);
  assert.equal(stats.drawn, 0); assert.match(stats.setsFailed, /set-gorge/);
  assert.equal(w.log.events.filter((e) => e.error).length, 9);
}

// ---- the route: placeholders first, then the pictures; no reservation for the previews; other packs untouched
{
  const src = readFileSync(new URL("../src/plan/routes.ts", import.meta.url), "utf8");
  const quiet = src.indexOf("const quietPack = templatePack(brief.styleExample)");
  const cards = src.indexOf("send({ index, svg: placeholderFrame(beats[index]!, brief.aspect) });", quiet);
  const run = src.indexOf("runStoryboardPreviews(", quiet);
  assert.ok(quiet > 0 && cards > quiet && run > cards, "key-phrase cards go out first, then the previews stream in");
  assert.match(src.slice(quiet, run), /storyboardPreviews === "image"/, "only a pack that opts in");
}
// the billing overview quotes the extra cost up front, and the sketch quote (which Animation reserves) is not touched
{
  const src = readFileSync(new URL("../src/billing/step-billing.ts", import.meta.url), "utf8");
  assert.match(src, /storyboardPreviews: await quoteStoryboardPreviews\(/);
  const sketch = src.slice(src.indexOf("export async function quoteFrameSketchStep"), src.indexOf("export async function quoteVoiceMusicStep"));
  assert.ok(!/previews/i.test(sketch), "the frame-sketch quote is unchanged, so Animation never reserves the previews twice");
}

console.log("storyboard-previews: sets first, one still per beat, charged once, reused by Animation: ok");
