// Worker re-bundle consumer: (1) worker.mjs registers the plate-rebundle queue the way its neighbours are registered (handler, leased
// counter, poll slot); (2) handlePlateRebundle verifies a staged bundle (digest, then verifyScene) and only then calls rebundle.commit;
// a failing verification or a tampered bundle never commits.
// Run: node test/plates-rebundle-queue.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATE_REBUNDLE_QUEUE, bundleDigest, fontSetDigest, handlePlateRebundle, paramsDigest } from "../src/plates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/worker.mjs"), "utf8");
assert.match(src, /import \{[^}]*PLATE_REBUNDLE_QUEUE[^}]*handlePlateRebundle[^}]*\} from "\.\/plates\.mjs"/, "worker imports the rebundle queue and handler");
assert.match(src, /const leased = \{[^}]*\[PLATE_REBUNDLE_QUEUE\]: 0/, "leased counter exists");
assert.match(src, /\[PLATE_REBUNDLE_QUEUE\]: async \(job\) => \{[\s\S]*?handlePlateRebundle\(job, \{ control \}\)/, "handler registered");
assert.match(src, /\[PLATE_REBUNDLE_QUEUE\]: drawsPlates \? Math\.max\(0, 1 - leased\[PLATE_REBUNDLE_QUEUE\]\) : 0/, "one poll slot, only on workers that draw plates");
assert.equal(PLATE_REBUNDLE_QUEUE, "plate-rebundle");

const projectId = randomUUID(), variantId = randomUUID();
const html = "<!doctype html><html><body>rebundled scene</body></html>";
const bundleSha = createHash("sha256").update(html).update("\0").digest("hex").slice(0, 24);
const params = {};
const engineDigest = "0bf69b95af4599883cac8e1c";
const bDigest = bundleDigest({ bundleSha, params, engineDigest, fontSetDigest: fontSetDigest() });
const bundleKey = `plates/${projectId}/16x9/0/g1/bundles/${bundleSha}/bundle.html`;
const data = (over = {}) => ({ variantId, projectId, gen: 1, rev: 0, frames: 30, expectedBundleDigest: "old", bundleKey, bundleDigest: bDigest, bundleSha, bundleManifest: { engineDigest }, sourceKey: `plates/${projectId}/16x9/0/g1/source.ts`, params, ...over });
const harness = (served, verify) => {
  const ops = [];
  return {
    ops,
    deps: {
      control: { op: async (name, body) => { ops.push({ name, body }); return { committed: true, rev: 1 }; } },
      engineImpl: { verifyScene: verify },
      storageImpl: { downloadPlateInput: async (_key, path) => { writeFileSync(path, served); } }
    }
  };
};

// success: digest ok, verifyScene ok -> exactly one rebundle.commit with the engine-rebundle author
{
  let verified = 0;
  const h = harness(html, async () => { verified += 1; return {}; });
  const out = await handlePlateRebundle({ data: data() }, h.deps);
  assert.equal(out.status, "committed");
  assert.equal(verified, 1, "verifyScene ran before the commit");
  assert.equal(h.ops.length, 1);
  assert.equal(h.ops[0].name, "rebundle.commit");
  assert.equal(h.ops[0].body.author, "engine-rebundle");
  assert.equal(h.ops[0].body.bundleKey, bundleKey);
}
// verifyScene fails -> no commit
{
  const h = harness(html, async () => { throw new Error("page error in scene"); });
  const out = await handlePlateRebundle({ data: data() }, h.deps);
  assert.equal(out.status, "failed");
  assert.equal(h.ops.length, 0, "a bundle that fails verification is never committed");
}
// tampered bytes -> rejected before verifyScene, no commit
{
  let verified = 0;
  const h = harness(html + "<!-- tampered -->", async () => { verified += 1; return {}; });
  const out = await handlePlateRebundle({ data: data() }, h.deps);
  assert.equal(out.status, "failed");
  assert.equal(verified, 0);
  assert.equal(h.ops.length, 0);
}
// a key outside the project's plates prefix is refused
{
  const h = harness(html, async () => ({}));
  const out = await handlePlateRebundle({ data: data({ bundleKey: `plates/${randomUUID()}/16x9/0/g1/bundles/${bundleSha}/bundle.html` }) }, h.deps);
  assert.equal(out.status, "failed");
  assert.equal(h.ops.length, 0);
}
console.log("plates rebundle queue: ok");
