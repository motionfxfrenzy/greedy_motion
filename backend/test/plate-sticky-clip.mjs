// Sticky fallback clips and the Retry for a scene stuck on its check.
//   1. A clip request records timings.playback = { mode: "clip", gen, digest }, so once the clip is drawn every later
//      load plays it (the service honours the marker only for the same bundle digest and generation) and a new
//      bundle (an edit) starts again from live code.
//   2. The check-grace sweep records the same marker when it moves a stuck check to the clip path.
//   3. Retry (force) redraws over an old clip and may also redraw a drawn scene; without force a drawn scene is refused.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node backend/test/plate-sticky-clip.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
await migrate();
await startQueues();

const project = randomUUID();
const seen = new Set();
const desired = [{ index: 0, aspect: "16:9", signature: "v1:s0-16:9", keyword: "lantern", frames: 90, width: 1920, height: 1080 }];
const row = async () => (await store.listVariants(project))[0];
// A pending plate-render job makes a repeat request a no-op (deduplicated), so each step starts with an empty queue.
const set = async (sql, params = []) => {
  await pool.query("delete from pgboss.job where name = 'plate-render' and data->>'variantId' = any($1)", [[...seen]]);
  return pool.query(`update app.plate_variants set ${sql} where project_id = $1`, [project, ...params]);
};
try {
  await store.reconcileVariants(project, desired, { scenes: 1 });
  seen.add((await row()).id);
  const bundled = `state = 'bundled', stage = 'checking', source_key = 's', bundle_key = 'b', bundle_digest = 'dg1', clip_key = 'outputs/stale.mp4', still_key = 'outputs/stale.jpg'`;

  // 1. A plain clip request keeps the clip, queues the render and records the sticky marker.
  await set(bundled);
  let v = await row();
  assert.equal((await store.requestVariantClip(project, v.id)).status, "ok");
  v = await row();
  assert.equal(v.stage, "queued for rendering");
  assert.equal(v.clip_key, "outputs/stale.mp4", "a plain request does not discard the clip");
  assert.deepEqual({ mode: v.timings.playback.mode, gen: v.timings.playback.gen, digest: v.timings.playback.digest }, { mode: "clip", gen: v.gen, digest: "dg1" });
  assert.equal(v.timings.playback.reason, "fallback");

  // The worker publishes the clip; the marker survives, so the scene still plays its clip on the next load.
  await set(`state = 'drawn', stage = null, clip_key = 'outputs/new.mp4'`);
  v = await row();
  assert.equal(v.timings.playback.digest, v.bundle_digest, "the marker still matches the drawn bundle");
  assert.equal(v.timings.playback.gen, v.gen);

  // 3. Without force a drawn scene is refused; with force it is redrawn over its old clip.
  assert.equal((await store.requestVariantClip(project, v.id)).status, "invalid_state");
  assert.equal((await store.requestVariantClip(project, v.id, undefined, { force: true })).status, "ok");
  v = await row();
  assert.equal(v.state, "bundled");
  assert.equal(v.clip_key, null, "Retry discards the old clip so the scene is drawn again");
  assert.equal(v.still_key, null);
  assert.equal(v.timings.playback.reason, "retry");

  // Retry also rescues a scene stuck on its check, whose old clip was never cleared.
  await set(bundled);
  assert.equal((await store.requestVariantClip(project, v.id, undefined, { force: true })).status, "ok");
  v = await row();
  assert.equal(v.stage, "queued for rendering");
  assert.equal(v.clip_key, null);

  // 2. The sweep records the marker too (a scene whose check never reported, with no clip).
  await set(`${bundled.replace("clip_key = 'outputs/stale.mp4', still_key = 'outputs/stale.jpg'", "clip_key = null, still_key = null")}, timings = '{}'::jsonb`);
  v = await row();
  const client = await pool.connect();
  try {
    const out = await store.fallbackCheckVariantClipWithClient(client, v, null);
    assert.equal(out.status, "ok");
  } finally {
    client.release();
  }
  v = await row();
  assert.equal(v.stage, "queued for rendering");
  assert.deepEqual({ mode: v.timings.playback.mode, gen: v.timings.playback.gen, digest: v.timings.playback.digest, reason: v.timings.playback.reason }, { mode: "clip", gen: v.gen, digest: "dg1", reason: "check-timeout" });

  // An edit gives the scene a new bundle: the marker no longer matches, so it starts again from live code.
  await set(`state = 'bundled', stage = 'checking', bundle_digest = 'dg2', clip_key = null`);
  v = await row();
  assert.notEqual(v.timings.playback.digest, v.bundle_digest, "a new bundle outgrows the old marker");
  console.log("plate sticky clip: ok");
} finally {
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [[...seen]]);
  await pool.query("delete from app.plate_variants where project_id = $1", [project]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [project]);
  await pool.query("delete from app.plate_state where project_id = $1", [project]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
