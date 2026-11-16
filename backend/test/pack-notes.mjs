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
console.log("pack-notes: ok");
