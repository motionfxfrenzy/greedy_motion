// Phase 2c / Phase 5 render & draw-aspects regression test against real Postgres + pg-boss:
//   - migrations 020 and 021 are idempotent (apply twice); draw_aspects column kept in schema with deprecation comment
//   - requestDraws is a no-op; draw_aspects is no longer read by commitBundle, reconcileVariants, reconcilePlates, or demand.idle
//   - /clip-request (requestVariantClip) and PLATE_LIVE_FORCE_OFF rollback still enqueue plate-render as before
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-live-render.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_unit|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { operations } = await import("../src/jobs/control.ts");
const store = await import("../src/plates/store.ts");
const { reconcilePlates } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const projLive = randomUUID();
const projClip = randomUUID();
const projRollback = randomUUID();
const projects = [projLive, projClip, projRollback];

const renderMsgs = async (variantId) =>
  Number((await pool.query("select count(*) as n from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [variantId])).rows[0].n);

const makeDesired = (count, aspects = ["16:9"], sigPrefix = "v3:lr") =>
  Array.from({ length: count }, (_, index) =>
    aspects.map((aspect) => ({
      index,
      aspect,
      signature: `${sigPrefix}-${index}-${aspect}`,
      frames: 90,
      width: aspect === "16:9" ? 1920 : aspect === "9:16" ? 1080 : 1080,
      height: aspect === "16:9" ? 1080 : aspect === "9:16" ? 1920 : 1080,
      keyword: `k${index}`
    }))
  ).flat();

async function bundleVariant(v, projectId, indexLabel = v.scene_index) {
  const owner = store.newOwner();
  const claimed = await store.claimAuthor(v.id, v.gen, owner, 60, 10);
  assert.ok(claimed, `claimed variant ${v.id} for authoring`);
  const ok = await store.commitBundle(v, owner, {
    sourceKey: `plates/${projectId}/16x9/${indexLabel}/g${v.gen}/source.ts`,
    bundleKey: `plates/${projectId}/16x9/${indexLabel}/g${v.gen}/bundle.html`,
    manifest: { bundleSha: `lrsha00000000000000000${indexLabel}`, engineDigest: "eng-lr" },
    timings: {}
  });
  assert.equal(ok, true, `committed bundle for variant ${v.id}`);
  return await store.getVariant(v.id);
}

try {
  // --- 0. Migrations 020 and 021 are idempotent (apply twice); draw_aspects stays in schema with deprecation comment
  const mig020Path = resolve(import.meta.dirname, "../src/db/migrations/020_plate_draw_on_demand.sql");
  const mig021Path = resolve(import.meta.dirname, "../src/db/migrations/021_plate_clips.sql");
  const mig020Sql = await readFile(mig020Path, "utf8");
  const mig021Sql = await readFile(mig021Path, "utf8");
  await pool.query(mig020Sql);
  await pool.query(mig020Sql);
  await pool.query(mig021Sql);
  await pool.query(mig021Sql);

  const colRes = await pool.query(
    `select c.data_type, c.is_nullable, pg_catalog.col_description('app.plate_state'::regclass, a.attnum) as comment
       from information_schema.columns c
       join pg_attribute a on a.attrelid = 'app.plate_state'::regclass and a.attname = c.column_name
      where c.table_schema = 'app' and c.table_name = 'plate_state' and c.column_name = 'draw_aspects'`
  );
  assert.equal(colRes.rows.length, 1, "draw_aspects column remains in schema");
  assert.equal(colRes.rows[0].data_type, "ARRAY");
  assert.match(colRes.rows[0].comment ?? "", /Deprecated in phase 5/i, "draw_aspects has deprecation comment");

  // --- 1. draw_aspects is no longer read by commitBundle, reconcilePlates, or demand.idle
  config.plates.live = true;
  config.plates.liveForceOff = false;

  await store.reconcileVariants(projLive, makeDesired(2, ["16:9"], "v3:live"), { scenes: 2 });
  // Manually populate draw_aspects in Postgres to prove nothing reads it
  await pool.query("update app.plate_state set draw_aspects = array['16:9'] where project_id = $1", [projLive]);

  const liveVars = await store.listVariants(projLive);
  await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render')");
  const b0 = await bundleVariant(liveVars[0], projLive, 0);
  const b1 = await bundleVariant(liveVars[1], projLive, 1);

  assert.equal(b0.state, "bundled");
  assert.equal(b0.stage, "checking", "commitBundle ignores draw_aspects and sets stage='checking'");
  assert.equal(await renderMsgs(b0.id), 0, "commitBundle enqueues 0 plate-render jobs even when draw_aspects contains aspect");
  assert.equal(await renderMsgs(b1.id), 0);

  // Check b0 to 'checked', age both variants past 90s, and verify reconcilePlates and demand.idle ignore draw_aspects
  await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  await pool.query(
    "update app.plate_variants set enqueued_at = now() - interval '10 minutes', updated_at = now() - interval '10 minutes' where project_id = $1",
    [projLive]
  );

  await reconcilePlates();
  assert.equal(await renderMsgs(b0.id), 0, "reconcilePlates ignores draw_aspects for checked live variant");
  assert.equal(await renderMsgs(b1.id), 0, "reconcilePlates ignores draw_aspects for bundled live variant");

  const idleOut = await operations["demand.idle"]({});
  assert.equal(idleOut.plate, 0, "demand.idle ignores draw_aspects on live variants");

  // requestDraws is a no-op
  const noopReq = await store.requestDraws(projLive, ["16:9"]);
  assert.equal(noopReq.enqueued, 0, "requestDraws is a no-op in phase 5");
  assert.equal(await renderMsgs(b0.id), 0);

  // --- 2. /clip-request (requestVariantClip) still enqueues plate-render and reconciler recovers it
  const clipReq = await store.requestVariantClip(projLive, b0.id);
  assert.equal(clipReq.status, "ok");
  assert.equal(await renderMsgs(b0.id), 1, "/clip-request enqueues 1 plate-render job");
  assert.equal((await store.getVariant(b0.id)).stage, "queued for rendering");

  // --- 3. PLATE_LIVE_FORCE_OFF rollback still flips live_mode to 'clip' and enqueues plate-render
  await store.reconcileVariants(projRollback, makeDesired(1, ["16:9"], "v3:rb"), { scenes: 1 });
  const [rbVar] = await store.listVariants(projRollback);
  const rbBundled = await bundleVariant(rbVar, projRollback, 0);
  await store.submitCheckReport(rbBundled.id, {
    gen: rbBundled.gen,
    bundleDigest: rbBundled.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  await pool.query("delete from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [rbVar.id]);

  config.plates.liveForceOff = true;
  await reconcilePlates();
  assert.equal((await store.readProjectState(projRollback)).liveMode, "clip");
  assert.equal(await renderMsgs(rbVar.id), 1, "PLATE_LIVE_FORCE_OFF rollback enqueues plate-render");

  console.log("plate live render: ok");
} finally {
  config.plates.live = false;
  config.plates.liveForceOff = false;
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await pool.query("delete from pgboss.job where name like 'plate-%'");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
