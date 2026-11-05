// Rollback override (PLATE_LIVE_FORCE_OFF=1): flips live_mode to 'clip', transitions checked -> bundled,
// enqueues plate-render once per checked/bundled variant (idempotent across passes), enforces the 20-per-pass rate limit
// and per-project active cap, and leaves in-flight authoring and drawn variants untouched.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-rollback.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
const { reconcilePlates } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const projectA = randomUUID();
const projectB = randomUUID();
const projects = [projectA, projectB];

const renderMsgs = async (variantId) =>
  Number((await pool.query("select count(*) n from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [variantId])).rows[0].n);
const totalRenderMsgsForProject = async (projectId) => {
  const { rows } = await pool.query(
    `select count(*) as n
       from pgboss.job j
       join app.plate_variants v on v.id::text = j.data->>'variantId'
      where j.name = 'plate-render' and v.project_id = $1`,
    [projectId]
  );
  return Number(rows[0].n);
};

try {
  // --- 1. Set up projectA in live mode with mixed variant states: checked, bundled, authoring (in-flight), drawn
  config.plates.live = true;
  config.plates.liveForceOff = false;

  const desiredA = [0, 1, 2, 3].map((index) => ({
    index,
    aspect: "16:9",
    signature: `v3:rbA-${index}`,
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: `k${index}`
  }));
  await store.reconcileVariants(projectA, desiredA, { scenes: 4 });
  assert.equal(await store.getLiveMode(projectA), "live");
  const rowsA = await store.listVariants(projectA);
  const [vChecked, vBundled, vAuthoring, vDrawn] = rowsA;

  // Bundle vChecked and mark it checked
  for (const v of [vChecked, vBundled]) {
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.commitBundle(v, owner, {
      sourceKey: `plates/${projectA}/16x9/${v.scene_index}/g1/source.ts`,
      bundleKey: `plates/${projectA}/16x9/${v.scene_index}/g1/bundle.html`,
      manifest: { bundleSha: `rbsha000000000000000000${v.scene_index}`, engineDigest: "eng1" },
      timings: {}
    });
  }
  const bChecked = await store.getVariant(vChecked.id);
  await store.submitCheckReport(bChecked.id, {
    gen: bChecked.gen,
    bundleDigest: bChecked.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal((await store.getVariant(vChecked.id)).state, "checked");
  assert.equal((await store.getVariant(vBundled.id)).state, "bundled");

  // Put vAuthoring into active authoring lease
  const activeOwner = store.newOwner();
  await store.claimAuthor(vAuthoring.id, vAuthoring.gen, activeOwner, 120, 10);
  assert.equal((await store.getVariant(vAuthoring.id)).state, "authoring");

  // Put vDrawn into drawn state
  await pool.query(
    "update app.plate_variants set state = 'drawn', clip_key = $2, drawn_at = now() where id = $1",
    [vDrawn.id, `plates/${projectA}/16x9/3/g1/clip-a1.mp4`]
  );
  assert.equal((await store.getVariant(vDrawn.id)).state, "drawn");

  assert.equal(await totalRenderMsgsForProject(projectA), 0, "no plate-render jobs before force-off");

  // --- 2. Enable force-off and run pass 1
  config.plates.liveForceOff = true;
  await reconcilePlates();

  assert.equal(await store.getLiveMode(projectA), "clip", "live_mode flipped to clip");
  assert.equal((await store.getVariant(vChecked.id)).state, "bundled", "checked variant moved to bundled");
  assert.equal((await store.getVariant(vBundled.id)).state, "bundled", "bundled variant stays bundled");
  assert.equal(await renderMsgs(vChecked.id), 1, "checked variant gets one plate-render message");
  assert.equal(await renderMsgs(vBundled.id), 1, "bundled variant gets one plate-render message");

  // In-flight authoring and drawn variants are untouched
  const afterAuthoring = await store.getVariant(vAuthoring.id);
  assert.equal(afterAuthoring.state, "authoring", "in-flight authoring is untouched");
  assert.equal(afterAuthoring.author_owner, activeOwner);
  assert.equal(await renderMsgs(vAuthoring.id), 0);

  const afterDrawn = await store.getVariant(vDrawn.id);
  assert.equal(afterDrawn.state, "drawn", "drawn variant is untouched");
  assert.equal(await renderMsgs(vDrawn.id), 0);

  // --- 3. Second pass enqueues nothing more (idempotent)
  await reconcilePlates();
  assert.equal(await renderMsgs(vChecked.id), 1, "second pass does not enqueue another job for checked variant");
  assert.equal(await renderMsgs(vBundled.id), 1, "second pass does not enqueue another job for bundled variant");
  assert.equal(await totalRenderMsgsForProject(projectA), 2);

  // --- 4. 20-per-pass rate limit holds across 25 checked/bundled variants
  config.plates.liveForceOff = false;
  config.plates.live = true;
  const desiredB = Array.from({ length: 25 }, (_, index) => ({
    index,
    aspect: "16:9",
    signature: `v3:rbB-${index}`,
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: `k${index}`
  }));
  await store.reconcileVariants(projectB, desiredB, { scenes: 25 });
  const rowsB = await store.listVariants(projectB);
  for (let i = 0; i < rowsB.length; i++) {
    const v = rowsB[i];
    const state = i % 2 === 0 ? "checked" : "bundled";
    await pool.query(
      "update app.plate_variants set state = $2, stage = 'checking', bundle_key = $3, bundle_digest = $4, enqueued_at = null where id = $1",
      [v.id, state, `plates/${projectB}/16x9/${v.scene_index}/g1/bundle.html`, `digest-${i}`]
    );
  }
  assert.equal(await totalRenderMsgsForProject(projectB), 0);

  config.plates.liveForceOff = true;
  await reconcilePlates();
  assert.equal(await store.getLiveMode(projectB), "clip");
  assert.equal(await totalRenderMsgsForProject(projectB), 20, "first pass enqueues at most 20 variants");

  await reconcilePlates();
  assert.equal(await totalRenderMsgsForProject(projectB), 25, "second pass enqueues the remaining 5 variants");

  await reconcilePlates();
  assert.equal(await totalRenderMsgsForProject(projectB), 25, "third pass enqueues nothing more");
  for (const v of rowsB) {
    assert.equal(await renderMsgs(v.id), 1, `variant ${v.scene_index} enqueued exactly once`);
  }

  console.log("plate rollback: ok");
} finally {
  config.plates.live = false;
  config.plates.liveForceOff = false;
  const vIds = (await pool.query("select id::text as id from app.plate_variants where project_id = any($1)", [projects])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [vIds]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
