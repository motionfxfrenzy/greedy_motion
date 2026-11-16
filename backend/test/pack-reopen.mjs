// Reopening a finished template film: its pictures live in object storage (index + files), its scenes in the database, and a clip drawn
// without the pictures (a stale worker) is never served, so the preview plays the scene live with its pictures. No database, no network.
// Run: node backend/test/pack-reopen.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const pa = await import("../src/plates/pack-assets.ts");

const withPics = { bundle_manifest: { assetNames: ["shot-01-a", "set-gorge"] } };
assert.equal(pa.staleClip({ ...withPics, timings: {} }), true, "a picture scene whose clip carries no picture mark is stale");
assert.equal(pa.staleClip({ ...withPics, timings: null }), true);
assert.equal(pa.staleClip({ ...withPics, timings: { picturesClip: true } }), false, "a clip drawn with its pictures is kept");
assert.equal(pa.staleClip({ bundle_manifest: {}, timings: {} }), false, "scenes without pictures are never stale");
assert.equal(pa.staleClip({ bundle_manifest: { assetNames: [] }, timings: {} }), false);
assert.equal(pa.staleClip({ bundle_manifest: null, timings: null }), false);

// the stored picture index survives a restart: a new process reads the same index and resolves the same links
const store = new Map();
const deps = {
  getObject: async (_b, k) => store.get(k) ?? null, putObject: async (_b, k, v) => { store.set(k, Buffer.from(v)); }, objectSize: async (_b, k) => store.get(k)?.length ?? null,
  image: async (p) => ({ data: Buffer.from(p), mime: "image/jpeg" }), checkText: async () => ({ extra: [], usd: 0 }), enqueueDepth: async () => {}
};
const PID = "11111111-2222-3333-4444-555555555555";
await pa.generatePackAssets(PID, [{ name: "set-a", prompt: "a", aspect: "9:16", noText: true }, { name: "shot-1", prompt: "b", aspect: "9:16", refs: ["set-a"], noText: true }], deps);
const first = await pa.resolveSceneAssets(PID, ["set-a", "shot-1"], deps);
const again = await pa.resolveSceneAssets(PID, ["set-a", "shot-1"], { getObject: deps.getObject, putObject: deps.putObject, objectSize: deps.objectSize });
assert.deepEqual(again, first, "a fresh reader (after a redeploy) resolves the same pictures and digest");
assert.equal(Object.keys(first.refs).length, 2);
// the shot plan: one call, stored with the project, reused until the script changes; a failing call falls back (undefined)
const { templatePack } = await import("../src/plan/template-packs.ts");
const pack = templatePack("picture-film");
const project = { id: PID, brief: { scriptBeats: [{ keyword: "Gum", line: "You swallowed your gum. Does it stay for seven years?", visual: "wide street: you chew", onScreen: null }], scriptNotes: { idea: "gum", objects: "cast: you = stick figure | sets: street = a street" } } };
let calls = 0;
const call = async () => { calls += 1; return { text: JSON.stringify({ characters: [{ id: "you", look: "stick figure" }], sets: [{ id: "street", look: "a street" }], shots: [] }), usd: 0.001 }; };
const p1 = await pa.loadShotPlan(project, pack, { ...deps, call });
const p2 = await pa.loadShotPlan(project, pack, { ...deps, call });
assert.ok(p1 && p2 && calls === 1, "planned once, then read back from storage");
project.brief.scriptBeats[0].line = "A different line entirely about swallowed gum and stomachs.";
await pa.loadShotPlan(project, pack, { ...deps, call });
assert.equal(calls, 2, "a changed script is planned again");
assert.equal(await pa.loadShotPlan(project, pack, { getObject: async () => null, putObject: async () => {}, call: async () => { throw new Error("down"); } }), undefined, "a failing call falls back to the script's own shot list");
assert.equal(await pa.loadShotPlan(project, templatePack("history-reel"), deps), undefined, "packs without a plan step are untouched");
// a smaller preview copy is stored next to each picture (and made for a cached one), the full picture stays untouched
const pstore = new Map();
const pdeps = { ...deps, getObject: async (_b, k) => pstore.get(k) ?? null, putObject: async (_b, k, v) => { pstore.set(k, Buffer.from(v)); }, objectSize: async (_b, k) => pstore.get(k)?.length ?? null, preview: async (d) => Buffer.from("small:" + d.length) };
const PID2 = "11111111-2222-3333-4444-555555555556";
await pa.generatePackAssets(PID2, [{ name: "set-a", prompt: "a", aspect: "9:16", noText: true }], pdeps);
const rec = JSON.parse(pstore.get(pa.assetIndexKey(PID2)).toString()).assets["set-a"];
assert.ok(pstore.get(pa.previewKeyFor(PID2, rec.hash)).toString().startsWith("small:"), "preview copy stored");
pstore.delete(pa.previewKeyFor(PID2, rec.hash));
await pa.generatePackAssets(PID2, [{ name: "set-a", prompt: "a", aspect: "9:16", noText: true }], pdeps);
assert.ok(pstore.has(pa.previewKeyFor(PID2, rec.hash)), "a cached picture gets its preview copy");
// charges never overlap (a small database pool must not be filled by parallel spenders)
let running = 0, peak = 0;
const charge = pa.serialCharge(async () => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running -= 1; });
await Promise.all([1, 2, 3, 4, 5].map((i) => charge(0.01, "r" + i)));
assert.equal(peak, 1, "charges run one at a time");
// a restart part way through never draws a stored picture again and never charges one twice
{
  const store2 = new Map(), ledger = new Map(); // ledger: ref -> times charged (the real ledger refuses a repeated ref)
  let draws = 0, crashAfter = 3, calls = 0;
  const mk = () => ({
    getObject: async (_b, k) => store2.get(k) ?? null, putObject: async (_b, k, v) => { store2.set(k, Buffer.from(v)); }, objectSize: async (_b, k) => store2.get(k)?.length ?? null,
    image: async (p) => { calls += 1; if (crashAfter && calls > crashAfter) throw new Error("process died"); draws += 1; return { data: Buffer.from("img:" + p), mime: "image/jpeg" }; },
    checkText: async () => ({ extra: [], usd: 0 }), enqueueDepth: async () => {},
    charge: async (usd, ref) => { ledger.set(ref, (ledger.get(ref) ?? 0) + 1); }, parallel: 1
  });
  const specs2 = [{ name: "style", prompt: "s", aspect: "9:16", noText: true }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: "shot-" + n, prompt: "p" + n, aspect: "9:16", refs: ["style"], noText: true }))];
  const PID3 = "11111111-2222-3333-4444-555555555557";
  await assert.rejects(pa.generatePackAssets(PID3, specs2, mk()), /process died/);
  const drawnBefore = draws;
  crashAfter = 0; calls = 0;
  await pa.generatePackAssets(PID3, specs2, mk()); // the restarted job
  assert.equal(draws, specs2.length, "every picture is drawn exactly once across both runs (" + draws + " draws for " + specs2.length + " pictures; " + drawnBefore + " before the crash)");
  assert.ok([...ledger.values()].every((n) => n === 1), "no picture is charged twice");
  assert.equal(ledger.size, specs2.length, "every picture is charged once");
  // and a third run (another restart after success) changes nothing
  const draws3 = draws; await pa.generatePackAssets(PID3, specs2, mk());
  assert.equal(draws, draws3, "a finished film is never drawn again");
}
// the shot plan is asked for once even when two steps ask at the same time (two answers = two sets of prompts = every picture twice)
{
  const store3 = new Map();
  const dd = { getObject: async (_b, k) => store3.get(k) ?? null, putObject: async (_b, k, v) => { store3.set(k, Buffer.from(v)); } };
  let n = 0; const slow = async () => { n += 1; await new Promise((r) => setTimeout(r, 20)); return { text: JSON.stringify({ characters: [], sets: [{ id: "x" + n, look: "l" }], shots: [] }), usd: 0 }; };
  const proj = { id: "11111111-2222-3333-4444-555555555558", brief: { scriptBeats: [{ keyword: "k", line: "one two three four five six seven", visual: "wide x: y", onScreen: null }], scriptNotes: null } };
  const [a, b] = await Promise.all([pa.loadShotPlan(proj, templatePack("picture-film"), { ...dd, call: slow }), pa.loadShotPlan(proj, templatePack("picture-film"), { ...dd, call: slow })]);
  assert.equal(n, 1, "one planning call for two simultaneous askers");
  assert.deepEqual(a, b, "both askers see the same plan");
}
// the ledger itself refuses a second charge for the same picture: a unique index on the spend ref (migration 034) and an insert that ignores the repeat
{
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(new URL("../src/db/migrations/034_pack_asset_charge_once.sql", import.meta.url), "utf8");
  assert.match(migration, /create unique index[\s\S]*token_ledger \(user_id, ref\)[\s\S]*material:pack-asset:/, "the ledger has a unique index on pack-asset spend refs");
  const store = readFileSync(new URL("../src/tokens/store.ts", import.meta.url), "utf8");
  assert.match(store, /values \(\$1, \$2, 'spend'[^\n]*on conflict do nothing/, "a repeated spend insert is ignored by the database");
  const src = readFileSync(new URL("../src/plates/pack-assets.ts", import.meta.url), "utf8");
  assert.match(src, /\$\{projectId\}:\$\{spec\.name\}:\$\{createHash\("sha256"\)\.update\(spec\.prompt \+ extra\)/, "the charge ref is project + picture key + prompt (an attempt with a redraw note is its own attempt)");
}
console.log("pack-reopen: ok");
