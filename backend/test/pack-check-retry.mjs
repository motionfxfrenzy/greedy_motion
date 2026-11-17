// A picture check that cannot run (a retired model, an outage) is not a bad picture: Haiku backs Gemini up, and a step that failed only
// for that reason runs again by itself, at most MAX_CHECK_RETRIES times. Run: node backend/test/pack-check-retry.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const pa = await import("../src/plates/pack-assets.ts");
const t0 = Date.parse("2026-11-17T03:14:12Z");
const failed = (extra) => ({ version: 1, digest: "D", status: "failed", assets: {}, usd: 0, updatedAt: new Date(t0).toISOString(), error: 'The picture "set-lab" could not be checked for people and props, so it was not used.', ...extra });

assert.equal(pa.checkFailureRetryable(failed({}), t0 + 30_000), false, "not within the first minute");
assert.equal(pa.checkFailureRetryable(failed({}), t0 + 61_000), true, "an old failure (no count yet) is retried");
assert.equal(pa.checkFailureRetryable(failed({ checkFailures: 2 }), t0 + 61_000), true, "second retry allowed");
assert.equal(pa.checkFailureRetryable(failed({ checkFailures: 3 }), t0 + 61_000), false, "then it stops (no endless paid redraws)");
assert.equal(pa.checkFailureRetryable(failed({ error: 'The picture "set-lab" kept coming back with "person" in it.' }), t0 + 61_000), false, "a bad picture is not retried by itself");
assert.equal(pa.checkFailureRetryable({ ...failed({}), status: "ready" }, t0 + 61_000), false);
assert.equal(pa.checkFailureRetryable(null), false);

// The count carries across runs of one digest: a run that fails the check again counts up.
{
  const store = { uploads: new Map(), outputs: new Map() };
  const PID = "11111111-2222-3333-4444-555555555599";
  const deps = {
    getObject: async (b, k) => store[b].get(k) ?? null,
    putObject: async (b, k, body) => { store[b].set(k, Buffer.isBuffer(body) ? body : Buffer.from(body)); },
    objectSize: async (b, k) => (store[b].has(k) ? store[b].get(k).length : null),
    image: async (_p, _r, spec) => ({ data: Buffer.from(`img:${spec.name}`), mime: "image/jpeg" }),
    checkText: async () => { throw new Error("Picture word check failed (gemini) (404). / backup: Picture word check failed (anthropic) (401)."); },
    enqueueDepth: async () => undefined, charge: async () => undefined, parallel: 1
  };
  const specs = [{ name: "set-lab", prompt: "an empty lab", aspect: "9:16", size: "2K", noText: true, noFigures: true }];
  for (const want of [1, 2, 3]) {
    await pa.generatePackAssets(PID, specs, deps).catch(() => undefined);
    const idx = JSON.parse(store.uploads.get(pa.assetIndexKey(PID)).toString());
    assert.equal(idx.status, "failed"); assert.equal(idx.checkFailures, want, `run ${want} counts`);
  }
}

// The "generating" mark written before an automatic rerun keeps the count, so the cap still holds.
{
  const store = { uploads: new Map(), outputs: new Map() };
  const PID = "11111111-2222-3333-4444-555555555598";
  const deps = {
    getObject: async (b, k) => store[b].get(k) ?? null,
    putObject: async (b, k, body) => { store[b].set(k, Buffer.isBuffer(body) ? body : Buffer.from(body)); },
    objectSize: async (b, k) => (store[b].has(k) ? store[b].get(k).length : null),
    image: async (_p, _r, spec) => ({ data: Buffer.from(`img:${spec.name}`), mime: "image/jpeg" }),
    checkText: async () => { throw new Error("down"); },
    enqueueDepth: async () => undefined, charge: async () => undefined, parallel: 1
  };
  const specs = [{ name: "set-lab", prompt: "an empty lab", aspect: "9:16", size: "2K", noText: true, noFigures: true }];
  store.uploads.set(pa.assetIndexKey(PID), Buffer.from(JSON.stringify({ version: 1, digest: pa.specsDigest(specs), status: "generating", assets: {}, usd: 0, updatedAt: "x", checkFailures: 2 })));
  await pa.generatePackAssets(PID, specs, deps).catch(() => undefined);
  assert.equal(JSON.parse(store.uploads.get(pa.assetIndexKey(PID)).toString()).checkFailures, 3, "count kept across the generating mark");
}

// Wiring guards: Haiku is the backup, and a waiting scene holds for a due retry instead of failing.
const gem = readFileSync(new URL("../src/plates/pack-assets-gemini.ts", import.meta.url), "utf8");
assert.match(gem, /CHECK_FALLBACK_MODEL = "claude-haiku-5-5"/);
assert.match(gem, /checkWith\("anthropic"/);
const author = readFileSync(new URL("../src/plates/author.ts", import.meta.url), "utf8");
assert.match(author, /checkFailureRetryable\(failedIndex\)/);
const routes = readFileSync(new URL("../src/plates/routes.ts", import.meta.url), "utf8");
assert.equal((routes.match(/ensurePackAssets\(project, \{ retryFailed: true \}\)/g) ?? []).length, 2, "Retry scene and Redraw both try failed pictures again");
console.log("pack-check-retry: Haiku backup, capped automatic retry of check failures: ok");
