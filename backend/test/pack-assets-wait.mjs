// A render never pays for pictures it then throws away (plates/pack-assets.ts waitForAssetsReady, render/service.ts prepareFilm).
// Cause this guards: a rule change (noFigures) changes an old project's specs digest, Render queued the redraw and froze the export from
// the OLD pictures a moment later, so the sets were redrawn and charged but the film still used the old ones (cached clips).
// No database, no network. Run: node backend/test/pack-assets-wait.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const pa = await import("../src/plates/pack-assets.ts");
const PID = "11111111-2222-3333-4444-555555555555";

// ---- a fake clock: sleeping advances it, and a script can change the world at chosen times
function world({ index, depthSettled = () => true, ensure = async () => "D2" }) {
  let t = 0, sleeps = 0, ensured = 0;
  const w = {
    at: [], index, get sleeps() { return sleeps; }, get ensured() { return ensured; },
    deps: {
      ensure: async () => { ensured += 1; return ensure(); },
      readIndex: async () => { for (const [when, fn] of w.at) if (t >= when) fn(w); return w.index; },
      depthSettled: async (r) => depthSettled(r, t),
      sleep: async (ms) => { sleeps += 1; t += ms; },
      now: () => t
    }
  };
  return w;
}
const ready = (digest, assets = {}) => ({ version: 1, digest, status: "ready", assets, usd: 0, updatedAt: "x" });

// a template without pictures: nothing to wait for
{ const w = world({ index: null, ensure: async () => null }); await pa.waitForAssetsReady(w.deps, { timeoutMs: 1000 }); assert.equal(w.sleeps, 0); }

// pictures already current: no waiting at all (and the asset step is only asked, never forced)
{ const w = world({ index: ready("D2") }); await pa.waitForAssetsReady(w.deps, { timeoutMs: 1000 }); assert.equal(w.sleeps, 0, "current pictures: no wait"); assert.equal(w.ensured, 1); }

// an old index (made before the rule) is stale: the render waits until the new pictures are stored, then goes on
{
  const w = world({ index: ready("D1") });
  w.at.push([6000, (x) => { x.index = { ...ready("D2"), status: "generating" }; }], [10000, (x) => { x.index = ready("D2"); }]);
  await pa.waitForAssetsReady(w.deps, { timeoutMs: 60_000, pollMs: 2000 });
  assert.ok(w.sleeps >= 5, `waited for the redraw (${w.sleeps} polls)`);
  assert.equal(w.index.digest, "D2");
}

// the new digest's step failed: the render stops with a clear message instead of using old pictures
{
  const w = world({ index: { ...ready("D2"), status: "failed", error: "The picture \"set-rope\" kept coming back with \"person\" in it." } });
  await assert.rejects(pa.waitForAssetsReady(w.deps, { timeoutMs: 1000 }), (e) => e.code === "pictures_failed" && /set-rope/.test(e.message));
}
// an old failed index of ANOTHER digest does not stop the render: the new step is still to run
{
  const w = world({ index: { ...ready("D1"), status: "failed", error: "old" } });
  w.at.push([2000, (x) => { x.index = ready("D2"); }]);
  await pa.waitForAssetsReady(w.deps, { timeoutMs: 60_000, pollMs: 1000 });
}
// never ready: a clear "still drawing" error, not a film with old pictures
{
  const w = world({ index: ready("D1") });
  await assert.rejects(pa.waitForAssetsReady(w.deps, { timeoutMs: 10_000, pollMs: 2000 }), (e) => e.code === "pictures_pending");
}

// depth: a map still being made is waited for (bounded), and the scenes of a map that never lands draw flat
{
  const rec = { name: "set-rope", hash: "h", key: "k", mime: "image/jpeg", size: "2K", storedAt: "x", depth: { key: "d.png", failedKey: "d.failed", queuedAt: "x" } };
  const w = world({ index: ready("D2", { "set-rope": rec }), depthSettled: (_r, t) => t >= 8000 });
  await pa.waitForAssetsReady(w.deps, { timeoutMs: 60_000, depthMs: 60_000, pollMs: 2000 });
  assert.ok(w.sleeps >= 4, "waited for the depth map to land");
  const slow = world({ index: ready("D2", { "set-rope": rec }), depthSettled: () => false });
  await pa.waitForAssetsReady(slow.deps, { timeoutMs: 60_000, depthMs: 10_000, pollMs: 2000 });
  assert.ok(slow.sleeps <= 6, "a depth map that does not land is given up on after depthMs");
}

// ---- the whole story with the real generator: old pictures -> rule change -> ONE redraw, charged once, and a second run charges nothing
{
  const store = { uploads: new Map(), outputs: new Map() };
  const calls = [], charges = [], depth = [];
  const deps = {
    getObject: async (b, k) => store[b].get(k) ?? null,
    putObject: async (b, k, body) => { store[b].set(k, Buffer.isBuffer(body) ? body : Buffer.from(body)); },
    objectSize: async (b, k) => (store[b].has(k) ? store[b].get(k).length : null),
    image: async (_p, _r, spec) => { calls.push(spec.name); return { data: Buffer.from(`img:${spec.name}:${calls.length}`), mime: "image/jpeg" }; },
    checkText: async () => ({ extra: [], figures: [], usd: 0.0002 }),
    enqueueDepth: async (job) => { depth.push(job); },
    charge: async (usd, ref) => { charges.push({ usd, ref }); },
    parallel: 2
  };
  const oldSpecs = [{ name: "set-rope", prompt: "an empty rope bridge", aspect: "9:16", size: "2K", depth: true, noText: true }];
  await pa.generatePackAssets(PID, oldSpecs, deps);
  const oldKey = JSON.parse(store.uploads.get(pa.assetIndexKey(PID)).toString()).assets["set-rope"].key;
  for (const d of depth) store.outputs.set(d.depthKey, Buffer.from("png"));
  const paidBefore = charges.length, depthBefore = depth.length;

  const newSpecs = oldSpecs.map((s) => ({ ...s, noFigures: true }));
  assert.notEqual(pa.specsDigest(newSpecs), pa.specsDigest(oldSpecs), "the rule changes the digest, which is what makes an old project redraw");
  const next = await pa.generatePackAssets(PID, newSpecs, deps);
  assert.equal(charges.length - paidBefore, 1, "the redraw is charged once");
  assert.notEqual(next.assets["set-rope"].key, oldKey, "and stored under a new key: a scene resolving by name now reads the new picture");
  const before = await pa.resolveSceneAssets(PID, ["set-rope", "depth-rope"], { ...deps, getObject: async (b, k) => (b === "uploads" && k === pa.assetIndexKey(PID) ? Buffer.from(JSON.stringify({ ...next, assets: { "set-rope": { ...next.assets["set-rope"], key: oldKey } } })) : null) });
  const after = await pa.resolveSceneAssets(PID, ["set-rope", "depth-rope"], deps);
  assert.notEqual(before.digest, after.digest, "the pictures digest changes, so the clip cache misses for scenes that use the set");
  assert.equal(depth.length - depthBefore, 1, "the depth map is queued again for the new picture");

  const paid = charges.length;
  for (const d of depth) store.outputs.set(d.depthKey, Buffer.from("png"));
  await pa.generatePackAssets(PID, newSpecs, deps);
  assert.equal(charges.length, paid, "a second run charges nothing");
}

// ---- the render waits for pictures before it freezes the export (source guard: prepareFilm calls it before buildExport)
{
  const src = readFileSync(new URL("../src/render/service.ts", import.meta.url), "utf8");
  const wait = src.indexOf("await d.waitForPackAssets(project)");
  const build = src.indexOf("await d.buildExport(project, aspect, prep.watermark)");
  assert.ok(wait > 0 && build > wait, "prepareFilm waits for the project's pictures, then freezes the export");
}

console.log("pack-assets-wait: a render never pays for pictures it leaves out: ok");
