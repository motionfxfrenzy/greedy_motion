// Pack-declared image assets (plates/pack-assets.ts): spec plumbing, ordered generation with refs, the content-hash cache, the
// noText redraw, depth queueing, material charging, what a scene waits for, the sceneCode path (no model), the prompt carrying
// the picture names, and the bundle carrying the picture keys. No database, no network.
// Run: node backend/test/pack-assets.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { registerTemplatePack, templatePack } = await import("../src/plan/template-packs.ts");
const pa = await import("../src/plates/pack-assets.ts");
const { buildAuthorMessages } = await import("../src/plates/prompt.ts");
const { packSceneModule } = await import("../src/plates/author.ts");
const { bundleScene } = await import("@videosaas/plate-engine");

const PID = "11111111-2222-3333-4444-555555555555";

// ---- names and specs
assert.equal(pa.depthNameOf("set-gorge"), "depth-gorge");
assert.equal(pa.depthNameOf("shot-01"), "depth-shot-01");
assert.throws(() => pa.validateSpecs([{ name: "a", prompt: "x", aspect: "9:16", refs: ["b"] }, { name: "b", prompt: "y", aspect: "9:16" }]), /not an earlier asset/);
assert.throws(() => pa.validateSpecs([{ name: "depth-x", prompt: "x", aspect: "9:16" }]), /depth-/);
assert.throws(() => pa.validateSpecs([{ name: "a", prompt: "x", aspect: "9:16" }, { name: "a", prompt: "x", aspect: "9:16" }]), /twice/);

const specs = [
  { name: "style", prompt: "the style anchor", aspect: "9:16" },
  { name: "set-gorge", prompt: "an empty gorge", refs: ["style"], aspect: "9:16", size: "2K", depth: true, noText: true },
  { name: "set-bedroom", prompt: "an empty bedroom", refs: ["style"], aspect: "9:16", size: "2K", depth: true, noText: true },
  { name: "shot-01", prompt: "a still", refs: ["style", "set-gorge"], aspect: "9:16", noText: true }
];
const beats = [
  { keyword: "One", visual: "v", onScreen: null, line: "first line", place: "gorge" },
  { keyword: "Two", visual: "v", onScreen: null, line: "second line", place: "bedroom" }
];
const pack = {
  id: "test-pictures", scriptVoice: "", voice: { id: "Puck", direction: "" }, music: "", sceneDirection: "TEST DIRECTION",
  scenes: () => ({ kit: "const K = { rng: (s: number) => () => s };", images: [], hash: "kit1" }),
  assets: () => specs,
  sceneAssets: (i, bs) => [`set-${bs[i].place}`]
};
const unregister = registerTemplatePack(pack);
assert.equal(templatePack("test-pictures"), pack, "registered packs are found by id");
assert.deepEqual(pa.sceneAssetNames(pack, specs, 0, beats), ["set-gorge", "depth-gorge"], "a set brings its depth name");
assert.deepEqual(pa.sceneAssetNames(pack, specs, 1, beats), ["set-bedroom", "depth-bedroom"]);
assert.notEqual(pa.specsDigest(specs, ["set-gorge"]), pa.specsDigest(specs, ["set-bedroom"]), "scenes on different sets have different picture digests");
assert.equal(pa.specsDigest(specs, ["set-gorge"]), pa.specsDigest([...specs.slice(0, 2), { ...specs[2], prompt: "changed" }, specs[3]], ["set-gorge"]), "a change to another set does not touch this scene");
assert.notEqual(pa.specsDigest(specs, ["set-gorge"]), pa.specsDigest([{ ...specs[0], prompt: "new style" }, ...specs.slice(1)], ["set-gorge"]), "a change to a reference does");

// ---- generation: order, refs, cache, noText redraw, depth, charge
function memoryDeps({ wordsFor = () => [] } = {}) {
  const store = { uploads: new Map(), outputs: new Map() };
  const calls = [], depth = [], charges = [], checks = [];
  let active = 0, peak = 0;
  return {
    store, calls, depth, charges, checks, peak: () => peak,
    deps: {
      getObject: async (b, k) => store[b].get(k) ?? null,
      putObject: async (b, k, body) => { store[b].set(k, Buffer.isBuffer(body) ? body : Buffer.from(body)); },
      objectSize: async (b, k) => (store[b].has(k) ? store[b].get(k).length : null),
      image: async (prompt, refs, spec) => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        calls.push({ name: spec.name, refs: refs.map((r) => r.name), prompt });
        return { data: Buffer.from(`img:${spec.name}:${calls.length}`), mime: "image/jpeg" };
      },
      checkText: async (data) => { checks.push(data.toString()); return { extra: wordsFor(data.toString()), usd: 0.0002 }; },
      enqueueDepth: async (job) => { depth.push(job); },
      charge: async (usd, ref) => { charges.push({ usd, ref }); },
      parallel: 2
    }
  };
}

{
  // the first gorge picture has a stray word; its redraw is clean
  const m = memoryDeps({ wordsFor: (s) => (s.startsWith("img:set-gorge:") && !m.calls.some((c) => c.name === "set-gorge" && c.prompt.includes("ABSOLUTELY NO WRITING")) ? ["EXIT"] : []) });
  const index = await pa.generatePackAssets(PID, specs, m.deps);
  assert.equal(index.status, "ready");
  const order = m.calls.map((c) => c.name);
  assert.ok(order.indexOf("style") < order.indexOf("set-gorge") && order.indexOf("set-gorge") < order.indexOf("shot-01"), `refs resolve first (${order})`);
  assert.deepEqual(m.calls.find((c) => c.name === "shot-01").refs, ["style", "set-gorge"], "references are passed as images, in order");
  assert.equal(m.calls.filter((c) => c.name === "set-gorge").length, 2, "a picture with stray words is redrawn once");
  assert.equal(m.calls.filter((c) => c.name === "set-bedroom").length, 1);
  assert.ok(index.assets["set-gorge"].redrawn);
  assert.ok(m.peak() <= 2, "bounded parallelism");
  assert.equal(m.depth.length, 2, "one depth job per set with depth");
  assert.deepEqual(m.depth.map((d) => d.name).sort(), ["depth-bedroom", "depth-gorge"]);
  for (const d of m.depth) { assert.ok(d.depthKey.startsWith(`plates/${PID}/assets/`) && d.depthKey.endsWith(".depth.png")); assert.equal(d.imageKey, index.assets[d.name.replace("depth-", "set-")].key); }
  assert.equal(m.charges.length, m.calls.length, "every generated picture (redraws included) is charged");
  assert.ok(Math.abs(m.charges.reduce((a, c) => a + c.usd, 0) - (2 * pa.IMAGE_USD["1K"] + 3 * pa.IMAGE_USD["2K"])) < 1e-9);
  assert.equal(new Set(m.charges.map((c) => c.ref)).size, m.charges.length, "charge refs are unique");
  assert.equal(m.checks.length, 3, "noText pictures are checked once each (the redraw is not re-checked)");
  const stored = JSON.parse(m.store.uploads.get(pa.assetIndexKey(PID)).toString());
  assert.equal(stored.status, "ready");
  assert.equal(stored.digest, pa.specsDigest(specs));

  // ---- re-run: everything cached, nothing paid, no depth re-queued once the map exists
  for (const d of m.depth) m.store.outputs.set(d.depthKey, Buffer.from("png"));
  const before = { calls: m.calls.length, charges: m.charges.length, depth: m.depth.length };
  const again = await pa.generatePackAssets(PID, specs, m.deps);
  assert.equal(m.calls.length, before.calls, "a re-run with the same prompts makes no image calls");
  assert.equal(m.charges.length, before.charges, "and charges nothing");
  assert.equal(m.depth.length, before.depth, "and queues no depth for maps that exist");
  assert.deepEqual(Object.fromEntries(Object.entries(again.assets).map(([k, v]) => [k, v.key])), Object.fromEntries(Object.entries(index.assets).map(([k, v]) => [k, v.key])));
  assert.ok(again.assets["set-gorge"].redrawn, "the cached record keeps what it was");

  // ---- what a scene may bundle with, and what it reads when loaded
  assert.equal((await pa.sceneAssetState(PID, ["set-gorge", "depth-gorge"], m.deps)).state, "ready");
  const now1 = await pa.resolveSceneAssets(PID, ["set-gorge", "depth-gorge"], m.deps);
  assert.match(now1.refs["set-gorge"], /^u:plates\/.+\.jpg$/);
  assert.match(now1.refs["depth-gorge"], /^o:plates\/.+\.depth\.png$/);

  // ---- a changed reference redraws what depends on it, only that
  const changed = [{ ...specs[0], prompt: "a new style" }, ...specs.slice(1)];
  const n = m.calls.length;
  await pa.generatePackAssets(PID, changed, m.deps);
  assert.equal(m.calls.length - n, 4, "a changed reference makes every picture built on it new");

  // ---- redrawing ONE picture: only that name resolves to a new file; every other scene's pictures (and digest) stay the same
  const one = [...changed.slice(0, 2), { ...changed[2], prompt: "an empty bedroom, at night" }, changed[3]];
  const k = m.calls.length;
  const keysBefore = Object.fromEntries(Object.entries(JSON.parse(m.store.uploads.get(pa.assetIndexKey(PID)).toString()).assets).map(([a, r]) => [a, r.key]));
  await pa.generatePackAssets(PID, one, m.deps);
  assert.deepEqual(m.calls.slice(k).map((c) => c.name), ["set-bedroom"], "only the changed picture is drawn (and paid for)");
  const keysAfter = Object.fromEntries(Object.entries(JSON.parse(m.store.uploads.get(pa.assetIndexKey(PID)).toString()).assets).map(([a, r]) => [a, r.key]));
  for (const name of ["style", "set-gorge", "shot-01"]) assert.equal(keysAfter[name], keysBefore[name], `${name} keeps its file`);
  assert.notEqual(keysAfter["set-bedroom"], keysBefore["set-bedroom"]);

}

{
  // depth is never waited for: a scene is bundled once its set exists, reads the set flat, and picks the depth map up by name later
  const m = memoryDeps();
  const index = await pa.generatePackAssets(PID, specs.slice(0, 2), m.deps);
  const rec = index.assets["set-gorge"];
  assert.equal((await pa.sceneAssetState(PID, ["set-gorge", "depth-gorge"], m.deps)).state, "ready", "no wait for a depth map still running");
  const flat = await pa.resolveSceneAssets(PID, ["set-gorge", "depth-gorge"], m.deps);
  assert.deepEqual(Object.keys(flat.refs), ["set-gorge"], "before the depth map lands the scene reads the set alone (flat)");
  m.store.outputs.set(rec.depth.failedKey, Buffer.from("failed"));
  assert.deepEqual(Object.keys((await pa.resolveSceneAssets(PID, ["set-gorge", "depth-gorge"], m.deps)).refs), ["set-gorge"], "a failed depth map stays flat");
  m.store.outputs.set(rec.depth.key, Buffer.from("png"));
  const deep = await pa.resolveSceneAssets(PID, ["set-gorge", "depth-gorge"], m.deps);
  assert.match(deep.refs["depth-gorge"], /^o:plates\/.+\.depth\.png$/, "the landed depth map is read from the outputs bucket");
  assert.notEqual(deep.digest, flat.digest, "and the pictures' digest changes, so caches redraw this scene only");
  assert.equal(deep.refs["set-gorge"], flat.refs["set-gorge"]);
  assert.equal((await pa.sceneAssetState(PID, ["shot-01"], m.deps)).state, "failed", "a name the pack never made fails with a message");
  assert.equal((await pa.sceneAssetState("22222222-2222-3333-4444-555555555555", ["set-gorge"], m.deps)).state, "wait", "no index yet: wait");
  assert.equal((await pa.sceneAssetState(PID, ["depth-gorge"], m.deps)).state, "none", "depth names alone never block");
  assert.equal((await pa.resolveSceneAssets(PID, [], m.deps)).digest, null);
}

{
  // while a picture is redrawn, scenes keep reading the old one (the index keeps it until the new file is stored)
  const m = memoryDeps();
  await pa.generatePackAssets(PID, specs.slice(0, 2), m.deps);
  const old = (await pa.resolveSceneAssets(PID, ["set-gorge"], m.deps)).refs["set-gorge"];
  let seenDuring;
  m.deps.image = async (prompt, refs, spec) => { seenDuring = (await pa.resolveSceneAssets(PID, ["set-gorge"], m.deps)).refs["set-gorge"]; return { data: Buffer.from(prompt), mime: "image/jpeg" }; };
  await pa.generatePackAssets(PID, [specs[0], { ...specs[1], prompt: "a wider gorge" }], m.deps);
  assert.equal(seenDuring, old, "the old picture stays readable during the redraw");
  assert.notEqual((await pa.resolveSceneAssets(PID, ["set-gorge"], m.deps)).refs["set-gorge"], old);
}

{
  // a failing picture marks the index failed and throws (the queue retries; stored pictures are reused)
  const m = memoryDeps();
  m.deps.image = async (prompt, refs, spec) => { if (spec.name === "set-bedroom") throw new Error("safety filtered"); return { data: Buffer.from(spec.name), mime: "image/jpeg" }; };
  await assert.rejects(pa.generatePackAssets(PID, specs.slice(0, 3), m.deps), /safety/);
  const idx = JSON.parse(m.store.uploads.get(pa.assetIndexKey(PID)).toString());
  assert.equal(idx.status, "failed");
  assert.ok(idx.assets["set-gorge"], "what was made is kept");
}

// ---- scene code wiring: exact names, host-supplied pictures
const scene = (body) => `import type { Ctx, Env } from "./core";\nimport type { Film } from "./film";\nconst durationFrames = 30;\nfunction draw(ctx: Ctx, frame: number, env: Env) { ctx.setTransform(env.scale,0,0,env.scale,0,0); ${body} }\nexport const film: Film = { meta: { title: "t", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };\n`;
const allNames = ["style", "set-gorge", "depth-gorge", "set-bedroom", "depth-bedroom", "shot-01"];
const ok = scene(`const s = env.image("set-gorge"); const d = env.image?.("depth-gorge"); if (s) ctx.drawImage(s, 0, 0); void d;`);
const wired = pa.wireSceneAssets(ok, ["set-gorge", "depth-gorge"], allNames);
assert.match(wired, /assets: \{ images: \(\(globalThis as any\)\.__ASSETS__ \?\? \{\}\)/, "assets become the host's preloaded map");
assert.throws(() => pa.wireSceneAssets(scene(`env.image("set-bedroom");`), ["set-gorge", "depth-gorge"], allNames), (e) => e.repairable && /set-bedroom/.test(e.message), "another beat's picture is refused");
assert.throws(() => pa.wireSceneAssets(scene(`const n = "set-bedroom"; env.image(n);`), ["set-gorge"], allNames), /set-bedroom/, "also through a variable");
assert.throws(() => pa.wireSceneAssets(ok.replace("assets: { images: {} }", "assets: getAssets()"), ["set-gorge", "depth-gorge"], allNames), /assets: \{ images: \{\} \}/);
assert.ok(pa.wireSceneAssets(ok.replace("assets: { images: {} }", `assets: { images: { "set-gorge": "set-gorge" } }`), ["set-gorge", "depth-gorge"], allNames).includes("__ASSETS__"), "a filled declaration is replaced too");
assert.equal(pa.wireSceneAssets(ok, [], []), ok, "templates without pictures are untouched");

// ---- the bundle is the scene code only: the same pictures-agnostic page whatever pictures exist (no authoring when they change)
const look = "illus-flat-vector";
const plain = await bundleScene({ look, code: scene("ctx.fillRect(0,0,10,10);"), frames: 30, aspect: "9:16" });
assert.ok(plain.html.includes("<script>window.__ASSETS__={};window.__BAKE_SRC__={};</script>"), "the host fills window.__ASSETS__ at load");
const withPics = await bundleScene({ look, code: wired, frames: 30, aspect: "9:16" });
assert.match(withPics.html, /__ASSETS__/);
assert.doesNotMatch(withPics.html, /plates\//, "no storage keys in the page");
const refs = { "set-gorge": `u:plates/${PID}/assets/abc.jpg`, "depth-gorge": `o:plates/${PID}/assets/abc.depth.png` };
assert.deepEqual(pa.parseAssetRef(refs["depth-gorge"]), { bucket: "outputs", key: `plates/${PID}/assets/abc.depth.png` });
assert.equal(pa.parseAssetRef("u:plates/../x"), null);

// ---- the authoring prompt names exactly the beat's pictures; other templates keep "no images"
const base = { look: "illus-flat-vector", plateName: "flatVector", film: "f", beats, aspect: "9:16", index: 0, frames: 60, styleExample: "test-pictures" };
const req = await buildAuthorMessages({ ...base, assetNames: ["set-gorge", "depth-gorge"] });
const sceneText = req.messages[0].content.at(-1).text;
assert.match(sceneText, /PICTURES: this scene may read exactly these pictures, and no others: "set-gorge", "depth-gorge"/);
assert.match(sceneText, /env\.image\("<name>"\)/);
assert.match(sceneText, /draw the set flat/);
assert.match(req.system, /no images except the PICTURES listed/);
assert.doesNotMatch(req.system, /set-gorge/, "names stay out of the shared (cached) system prompt");
const req2 = await buildAuthorMessages({ ...base, index: 1, assetNames: ["set-bedroom", "depth-bedroom"] });
assert.equal(req2.system, req.system, "the system prompt is the same for every scene");
const fable = await buildAuthorMessages({ ...base, styleExample: "dark-fable", beats: [{ keyword: "A", visual: "v", onScreen: null, line: "l" }] });
assert.match(fable.system, /No Math\.random, Date, clock, fetch, images, fonts/, "templates without pictures keep the no-images rule");
assert.doesNotMatch(JSON.stringify(fable.messages), /PICTURES:/);

// ---- sceneCode: a pack's own module, no model
{
  let seen;
  const coded = { ...pack, id: "test-coded", scenes: undefined, sceneCode: (input) => { seen = input; return scene(`const s = env.image("set-gorge"); if (s) ctx.drawImage(s, 0, 0);`); } };
  const off = registerTemplatePack(coded);
  const project = { id: PID, brief: { styleExample: "test-coded", aspect: "9:16", scriptBeats: beats }, planAudio: { voice: { lines: [{ text: "first line", seconds: 1.2, words: [{ text: "first", start: 0.1, end: 0.4 }, { text: "line", start: 0.45, end: 0.9 }] }] } } };
  const code = packSceneModule(project, coded, 0, 48, ["set-gorge", "depth-gorge"]);
  assert.ok(code && /export const film/.test(code), "the pack's module is used as the scene");
  assert.equal(seen.beatIndex, 0);
  assert.equal(seen.frames, 48);
  assert.equal(seen.fps, 30);
  assert.deepEqual(seen.assetNames, ["set-gorge", "depth-gorge"]);
  assert.deepEqual(seen.beatWords.map((w) => [w.text, w.start]), [["first", 0.1], ["line", 0.45]], "word times relative to the scene");
  assert.equal(seen.beats[0].place, "gorge", "per-beat fields reach the pack");
  assert.equal(packSceneModule(project, templatePack("dark-fable"), 0, 48, []), undefined, "model-written templates get no module");
  const b = await bundleScene({ look, code: pa.wireSceneAssets(code, ["set-gorge", "depth-gorge"], allNames), frames: 48, aspect: "9:16" });
  assert.equal(b.manifest.frames, 48);
  off();
}

unregister();
assert.equal(templatePack("test-pictures"), undefined, "unregistering removes the test pack");
console.log("pack-assets: ok");

// the export's clip cache identity (backend) equals the worker's, with and without pictures (fast export + pictures share it)
{
  const { clipCacheDigest } = await import("../src/plates/exports.ts");
  const { clipCacheDigest: workerDigest } = await import("../../worker/src/pack-assets.mjs");
  for (const scene of [{ bundleDigest: "a".repeat(64) }, { bundleDigest: "a".repeat(64), assetsDigest: "1f2e3d" }]) assert.equal(clipCacheDigest(scene), workerDigest(scene));
  console.log("pack-assets: clip cache identity ok");
}
