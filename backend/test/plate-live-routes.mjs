// HTTP route tests for live plate scenes using Fastify app.inject:
//   GET  /v1/projects/:id/plates/:variantId/bundle
//   POST /v1/projects/:id/plates/:variantId/check
//   POST /v1/projects/:id/plates/:variantId/clip-request
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-live-routes.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");

await migrate();
await startQueues();

const app = Fastify();
await registerPlateRoutes(app, {
  presign: async (bucket, key, opts) => `https://r2.example.test/${bucket}/${key}?ttl=${opts?.seconds ?? 900}`
});
await app.ready();

const liveProject = randomUUID();
const otherProject = randomUUID();
const clipProject = randomUUID();
const projects = [liveProject, otherProject, clipProject];

const renderMsgs = async (variantId) =>
  Number((await pool.query("select count(*) n from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [variantId])).rows[0].n);

try {
  config.plates.live = true;
  const desired = [0, 1, 2, 3, 4, 5].map((index) => ({
    index,
    aspect: "16:9",
    signature: `v3:route-${index}`,
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: `k${index}`
  }));
  await store.reconcileVariants(liveProject, desired, { scenes: 6 });
  await store.reconcileVariants(otherProject, desired.slice(0, 1), { scenes: 1 });
  config.plates.live = false;
  await store.reconcileVariants(clipProject, desired.slice(0, 1), { scenes: 1 });
  config.plates.live = true;

  const vars = await store.listVariants(liveProject);
  const [v0, v1, v2, v3, v4, v5] = vars;
  const clipV0 = (await store.listVariants(clipProject))[0];

  // --- 1. Bundle route: 404 when variant is queued / authoring / failed, or belongs to another project
  const queuedBundleRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/bundle`
  });
  assert.equal(queuedBundleRes.statusCode, 404, "queued variant returns 404 on bundle route");

  // Bundle v0..v4
  for (const v of [v0, v1, v2, v3, v4]) {
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.commitBundle(v, owner, {
      sourceKey: `plates/${liveProject}/16x9/${v.scene_index}/g1/source.ts`,
      bundleKey: `plates/${liveProject}/16x9/${v.scene_index}/g1/bundle.html`,
      manifest: { bundleSha: `routesha000000000000000${v.scene_index}`, engineDigest: "eng-route", frames: 90 },
      timings: {}
    });
  }

  // Bundle route returns 404 for a variant of another project
  const wrongProjBundle = await app.inject({
    method: "GET",
    url: `/v1/projects/${otherProject}/plates/${v0.id}/bundle`
  });
  assert.equal(wrongProjBundle.statusCode, 404, "bundle route 404s when variant belongs to another project");

  // Bundle route returns 200 with url, expiresAt, bundleDigest, manifest, params and Cache-Control: no-store
  const b0 = await store.getVariant(v0.id);
  const okBundleRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/bundle`
  });
  assert.equal(okBundleRes.statusCode, 200);
  assert.equal(okBundleRes.headers["cache-control"], "no-store");
  const bundleBody = okBundleRes.json();
  assert.match(bundleBody.url, /^https:\/\/r2\.example\.test\/uploads\/plates\//);
  assert.ok(!Number.isNaN(Date.parse(bundleBody.expiresAt)));
  assert.equal(bundleBody.bundleDigest, b0.bundle_digest);
  assert.equal(bundleBody.manifest.bundleSha, "routesha0000000000000000");
  assert.deepEqual(bundleBody.params, {});

  // --- 2. Check route validation (400), fencing (204), clip mode (409), idempotency (200)
  for (const badBody of [
    { gen: 0, bundleDigest: b0.bundle_digest, host: "worker", results: { ok: true } },
    { gen: 1, bundleDigest: "", host: "worker", results: { ok: true } },
    { gen: 1, bundleDigest: b0.bundle_digest, host: "iframe", results: { ok: true } },
    { gen: 1, bundleDigest: b0.bundle_digest, host: "worker", results: { ok: false } },
    { gen: 1, bundleDigest: b0.bundle_digest, host: "worker", device: { big: "x".repeat(17_000) }, results: { ok: true } },
    { gen: 1, bundleDigest: b0.bundle_digest, host: "worker", results: { ok: true, big: "x".repeat(17_000) } }
  ]) {
    const badRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${liveProject}/plates/${v0.id}/check`,
      payload: badBody
    });
    assert.equal(badRes.statusCode, 400, `expected 400 for invalid check payload: ${JSON.stringify(badBody).slice(0, 80)}`);
  }

  // Fencing: wrong gen or wrong digest returns 204
  const fencedGenRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/check`,
    payload: { gen: 99, bundleDigest: b0.bundle_digest, host: "worker", results: { ok: true } }
  });
  assert.equal(fencedGenRes.statusCode, 204);

  const fencedDigestRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/check`,
    payload: { gen: b0.gen, bundleDigest: "f".repeat(64), host: "worker", results: { ok: true } }
  });
  assert.equal(fencedDigestRes.statusCode, 204);

  // Fencing: variant in queued state (v5) returns 204
  const fencedStateRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v5.id}/check`,
    payload: { gen: v5.gen, bundleDigest: "a".repeat(64), host: "worker", results: { ok: true } }
  });
  assert.equal(fencedStateRes.statusCode, 204);

  // Check route on a clip-mode project returns 409 { code: "not_live" }
  const clipCheckRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${clipProject}/plates/${clipV0.id}/check`,
    payload: { gen: clipV0.gen, bundleDigest: "a".repeat(64), host: "worker", results: { ok: true } }
  });
  assert.equal(clipCheckRes.statusCode, 409);
  assert.equal(clipCheckRes.json().error.code, "not_live");

  // Valid check report returns 200 { state: "checked" } and is idempotent on repeat
  const checkPass1 = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/check`,
    payload: { gen: b0.gen, bundleDigest: b0.bundle_digest, host: "worker", device: { gpu: "Apple M3" }, results: { ok: true } }
  });
  assert.equal(checkPass1.statusCode, 200);
  assert.deepEqual(checkPass1.json(), { state: "checked" });

  const checkPass2 = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/check`,
    payload: { gen: b0.gen, bundleDigest: b0.bundle_digest, host: "worker", device: { gpu: "Apple M3" }, results: { ok: true } }
  });
  assert.equal(checkPass2.statusCode, 200);
  assert.deepEqual(checkPass2.json(), { state: "checked" });

  // Bundle route still works in checked state
  const checkedBundleRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/bundle`
  });
  assert.equal(checkedBundleRes.statusCode, 200);

  // --- 3. Clip-request route: 404 wrong project, 409 wrong state, 202 idempotent, 429 cap at projectClipCap
  const origClipCap = config.plates.projectClipCap;
  config.plates.projectClipCap = 4;
  try {
  const wrongProjClip = await app.inject({
    method: "POST",
    url: `/v1/projects/${otherProject}/plates/${v0.id}/clip-request`
  });
  assert.equal(wrongProjClip.statusCode, 404);

  const wrongStateClip = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v5.id}/clip-request`
  });
  assert.equal(wrongStateClip.statusCode, 409);

  // Request clip for v0 (checked) twice: idempotent, 1 message
  const clipReq1 = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/clip-request`
  });
  assert.equal(clipReq1.statusCode, 202);
  assert.deepEqual(clipReq1.json(), { state: "rendering" });
  assert.equal(await renderMsgs(v0.id), 1);

  const clipReq1Dup = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/clip-request`
  });
  assert.equal(clipReq1Dup.statusCode, 202);
  assert.deepEqual(clipReq1Dup.json(), { state: "rendering" });
  assert.equal(await renderMsgs(v0.id), 1, "duplicate clip-request enqueues only once");

  // Request clips for v1, v2, v3 (reaches cap of 4 for liveProject)
  for (const v of [v1, v2, v3]) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${liveProject}/plates/${v.id}/clip-request`
    });
    assert.equal(res.statusCode, 202);
    assert.equal(await renderMsgs(v.id), 1);
  }

  // 5th variant (v4) hits the per-project cap of 4 -> 429 { code: "clip_cap" }
  const cappedRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v4.id}/clip-request`
  });
  assert.equal(cappedRes.statusCode, 429);
  assert.equal(cappedRes.json().error.code, "clip_cap");
  assert.equal(cappedRes.json().code, "clip_cap");
  assert.equal(await renderMsgs(v4.id), 0);

  // Repeating clip-request on an already-queued variant (v0) still returns 202 even when at cap
  const repeatAtCap = await app.inject({
    method: "POST",
    url: `/v1/projects/${liveProject}/plates/${v0.id}/clip-request`
  });
  assert.equal(repeatAtCap.statusCode, 202);
  } finally {
    config.plates.projectClipCap = origClipCap;
  }

  console.log("plate live routes: ok");
} finally {
  config.plates.live = false;
  await app.close();
  const vIds = (await pool.query("select id::text as id from app.plate_variants where project_id = any($1)", [projects])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [vIds]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
