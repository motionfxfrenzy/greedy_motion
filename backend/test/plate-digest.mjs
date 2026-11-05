// Plate bundle identity and canonical JSON digests (pure unit tests, no database or network).
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-digest.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://videosaas:videosaas@localhost:55432/plates_rebundle";
process.env.PLANNER ??= "deterministic";

const { bundleDigest, canonicalJson, fontSetDigest, paramsDigest, setFontSetDescriptor } = await import("../src/plates/digest.ts");
const { variantSignature } = await import("../src/plates/model.ts");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// --- canonicalJson: key-sorted objects, order-preserving arrays
assert.equal(canonicalJson({}), "{}");
assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
assert.equal(
  canonicalJson({ z: [3, 2, 1], a: { d: "x", c: true } }),
  canonicalJson({ a: { c: true, d: "x" }, z: [3, 2, 1] }),
  "nested object key order does not affect canonicalJson"
);
assert.notEqual(
  canonicalJson({ arr: [1, 2, 3] }),
  canonicalJson({ arr: [3, 2, 1] }),
  "arrays keep their order in canonicalJson"
);

// --- paramsDigest: sha256 of canonicalJson(params ?? {})
assert.equal(paramsDigest(), sha256("{}"));
assert.equal(paramsDigest(null), sha256("{}"));
assert.equal(paramsDigest({}), sha256("{}"));
assert.equal(
  paramsDigest({ sky: "#3b2c55", lantern: { glow: 0.8, color: "#ffcc00" } }),
  paramsDigest({ lantern: { color: "#ffcc00", glow: 0.8 }, sky: "#3b2c55" }),
  "params in any key order produce the same paramsDigest"
);
assert.notEqual(
  paramsDigest({ sky: "#3b2c55" }),
  paramsDigest({ sky: "#2a6b3a" }),
  "a changed param changes paramsDigest"
);

// --- fontSetDigest: sha256("fonts:none") by default
assert.equal(fontSetDigest(), sha256("fonts:none"));
assert.notEqual(fontSetDigest("fonts:noto-v1"), fontSetDigest(), "a different font set produces a different fontSetDigest");

// --- bundleDigest: exact formula and required properties
const base = { bundleSha: "0123456789abcdef01234567", params: { sky: "#3b2c55", speed: 1.2 }, engineDigest: "eng-v1" };
const expected = sha256([base.bundleSha, paramsDigest(base.params), fontSetDigest(), base.engineDigest].join("|"));
assert.equal(bundleDigest(base), expected, "bundleDigest matches sha256(bundleSha|paramsDigest|fontSetDigest|engineDigest)");
assert.equal(bundleDigest(base), bundleDigest({ ...base }), "same inputs give the same bundleDigest");
assert.equal(
  bundleDigest({ ...base, params: { speed: 1.2, sky: "#3b2c55" } }),
  bundleDigest(base),
  "params in any key order give the same bundleDigest"
);

// --- full bundleHash preferred over short bundleSha when present on manifest
const fullHash = sha256("<!doctype html><html>bundle</html>");
const shortSha = fullHash.slice(0, 24);
assert.equal(
  bundleDigest({ manifest: { bundleSha: shortSha, bundleHash: fullHash, engineDigest: "eng-v1" }, params: {} }),
  bundleDigest({ bundleSha: fullHash, params: {}, engineDigest: "eng-v1" }),
  "uses full bundleHash from manifest when present"
);
assert.equal(
  bundleDigest({ manifest: { bundleSha: shortSha, engineDigest: "eng-v1" }, params: {} }),
  bundleDigest({ bundleSha: shortSha, params: {}, engineDigest: "eng-v1" }),
  "falls back to manifest.bundleSha when bundleHash is absent"
);
assert.equal(
  bundleDigest({ bundleSha: shortSha, params: {} }),
  sha256([shortSha, paramsDigest({}), fontSetDigest(), "engine:unknown"].join("|")),
  "defaults missing engineDigest to engine:unknown"
);

// --- a params-only change changes bundleDigest while variantSignature is untouched
const sigInput = {
  look: "illus-fox",
  engineDigest: "eng-v1",
  styleDigest: "sty-v1",
  promptDigest: "prm-v1",
  film: "A film about a fox",
  castKeywords: ["Fox", "Lantern"],
  beat: { keyword: "Fox", visual: "A fox under a dark sky", onScreen: null, line: "The fox waits." },
  frames: 90,
  aspect: "16:9"
};
const sigBefore = variantSignature(sigInput);
const digestBefore = bundleDigest({ bundleSha: shortSha, params: { sky: "#3b2c55" }, engineDigest: "eng-v1" });
const digestAfter = bundleDigest({ bundleSha: shortSha, params: { sky: "#2a6b3a" }, engineDigest: "eng-v1" });
const sigAfter = variantSignature(sigInput);
assert.notEqual(digestBefore, digestAfter, "a params-only change changes bundleDigest");
assert.equal(sigBefore, sigAfter, "variantSignature is not an input to bundleDigest and stays untouched");

// --- a font-set change changes the digest
try {
  const withDefaultFonts = bundleDigest(base);
  setFontSetDescriptor("fonts:noto-sans-v1");
  const withEmbeddedFonts = bundleDigest(base);
  assert.notEqual(withDefaultFonts, withEmbeddedFonts, "a font-set change changes bundleDigest");
} finally {
  setFontSetDescriptor("fonts:none");
}

console.log("plate digest: ok");
