// Comments on template-written scenes (plates/pack-assets.ts): a note changes only the named pictures' hashes, and
// allowedText words are not stray. No database, no network. Run: node backend/test/pack-notes.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const pa = await import("../src/plates/pack-assets.ts");

const specs = [
  { name: "style", prompt: "s", aspect: "9:16", noText: true },
  { name: "shot-01", prompt: "a", aspect: "9:16", refs: ["style"], noText: true },
  { name: "shot-02", prompt: "b", aspect: "9:16", refs: ["style"], noText: true }
];
const noted = pa.applyAssetNotes(specs, { "shot-02": ["make the cap blue"] });
assert.equal(noted[0].prompt, "s");
assert.equal(noted[1].prompt, "a");
assert.match(noted[2].prompt, /make the cap blue/);
const h = (list, i) => pa.assetHash(list[i], list[i].refs ? [pa.assetHash(list[0], [])] : []);
assert.equal(h(specs, 1), h(noted, 1), "an untouched picture keeps its hash (cached)");
assert.notEqual(h(specs, 2), h(noted, 2), "the noted picture is redrawn");
assert.notEqual(pa.specsDigest(specs), pa.specsDigest(noted), "the digest changes so the asset step runs again");

// labelled picture: its own label is not stray, other words are
const store = new Map();
const deps = {
  getObject: async (_b, k) => store.get(k) ?? null, putObject: async (_b, k, v) => { store.set(k, Buffer.from(v)); }, objectSize: async (_b, k) => store.get(k)?.length ?? null,
  image: async (prompt) => ({ data: Buffer.from(prompt.includes("ABSOLUTELY") ? "clean" : "dirty"), mime: "image/jpeg" }),
  checkText: async (data) => ({ extra: data.toString() === "dirty" ? ["MINT", "GUM", "oops"] : [], usd: 0 }),
  enqueueDepth: async () => {}
};
const idx = await pa.generatePackAssets("11111111-2222-3333-4444-555555555555", [{ name: "label", prompt: "p", aspect: "9:16", noText: false, allowedText: ["MINT GUM"] }], deps);
assert.equal(idx.assets.label.redrawn, true, "stray word oops triggers one redraw");
const ok = await pa.generatePackAssets("11111111-2222-3333-4444-555555555556", [{ name: "label", prompt: "p", aspect: "9:16", allowedText: ["MINT GUM"] }], { ...deps, checkText: async () => ({ extra: ["MINT", "GUM"], usd: 0 }) });
assert.ok(!ok.assets.label.redrawn, "only the allowed label words: no redraw");
// a set that must be empty: a figure the vision check finds (a person on a rope) triggers one redraw with the figure named
{
  const prompts = [];
  const fdeps = { ...deps, image: async (prompt) => { prompts.push(prompt); return { data: Buffer.from(prompts.length === 1 ? "dirty" : "clean"), mime: "image/jpeg" }; }, checkText: async (data) => ({ extra: [], figures: data.toString() === "dirty" ? ["a person walking on a rope"] : [], usd: 0 }) };
  const set = await pa.generatePackAssets("11111111-2222-3333-4444-555555555557", [{ name: "set-gorge", prompt: "gorge", aspect: "9:16", noText: true, noFigures: true }], fdeps);
  assert.equal(set.assets["set-gorge"].redrawn, true, "a figure in an empty set triggers one redraw");
  assert.match(prompts[1], /NO PEOPLE.*a person walking on a rope/s);
  assert.equal(prompts.length, 2, "at most one redraw");
  assert.notEqual(pa.assetHash({ name: "a", prompt: "p", aspect: "9:16", noText: true, noFigures: true }, []), pa.assetHash({ name: "a", prompt: "p", aspect: "9:16", noText: true }, []), "the flag is part of the hash");
}
// the owner's rule: the image model never puts a character into a film. Up to two redraws with the figure named; a picture that still
// fails the check is never stored (the asset step fails with a clear message); a check that cannot run is a failure too.
{
  const spec = { name: "set-gorge", prompt: "gorge", aspect: "9:16", noText: true, noFigures: true };
  const mk = (dirtyDraws, checkFails = false) => {
    const prompts = [], store2 = new Map();
    return { prompts, store2, deps: {
      getObject: async (_b, k) => store2.get(k) ?? null, putObject: async (_b, k, v) => { store2.set(k, Buffer.from(v)); }, objectSize: async (_b, k) => store2.get(k)?.length ?? null,
      image: async (prompt) => { prompts.push(prompt); return { data: Buffer.from(prompts.length <= dirtyDraws ? "dirty" : "clean"), mime: "image/jpeg" }; },
      checkText: async (data) => { if (checkFails) throw new Error("vision down"); return { extra: [], figures: data.toString() === "dirty" ? ["a man on a rope"] : [], usd: 0 }; },
      enqueueDepth: async () => {}
    } };
  };
  const two = mk(2);
  const ok2 = await pa.generatePackAssets("11111111-2222-3333-4444-5555555555a1", [spec], two.deps);
  assert.equal(two.prompts.length, 3, "two redraws are allowed");
  assert.match(two.prompts[2], /a man on a rope/);
  assert.equal(ok2.assets["set-gorge"].redrawn, true);
  const three = mk(3);
  await assert.rejects(pa.generatePackAssets("11111111-2222-3333-4444-5555555555a2", [spec], three.deps), /kept coming back with "a man on a rope".*not used/);
  assert.equal(three.prompts.length, 3, "no more than two redraws");
  assert.ok(![...three.store2.keys()].some((k) => /assets\/[0-9a-f]{20,}\.(jpg|png)$/.test(k)), "a picture that failed the check is never stored");
  const down = mk(0, true);
  await assert.rejects(pa.generatePackAssets("11111111-2222-3333-4444-5555555555a3", [spec], down.deps), /could not be checked/);
  // a set regenerated by a comment keeps the rule (the note changes the prompt only)
  assert.equal(pa.applyAssetNotes([spec], { "set-gorge": ["make it sunnier"] })[0].noFigures, true);
}
console.log("pack-notes: ok");
