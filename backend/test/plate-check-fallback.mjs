// Server fallback for live-mode scenes stuck in `bundled / checking` past CHECK_GRACE_SECONDS (Requirement 3).
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_resil node --experimental-strip-types test/plate-check-fallback.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues, QUEUES } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
const { CHECK_GRACE_SECONDS, reconcilePlates } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const liveProject = randomUUID();
const capProject = randomUUID();
const clipProject = randomUUID();
const projects = [liveProject, capProject, clipProject];

const renderMsgs = async (variantId) =>
  Number((await pool.query("select count(*) n from pgboss.job where name = $1 and data->>'variantId' = $2", [QUEUES.plateRender, variantId])).rows[0].n);

const desired = (prefix, count = 3) =>
  Array.from({ length: count }, (_, index) => ({
    index,
    aspect: "16:9",
    signature: `v3:${prefix}-${index}`,
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: `k${index}`
  }));

const bundleVariant = async (projectId, v) => {
  const owner = store.newOwner();
  await store.claimAuthor(v.id, v.gen, owner, 60, 10);
  await store.noteAuthorCall(v.id, v.gen, owner, { authorMs: 10 });
  const ok = await store.commitBundle(v, owner, {
    sourceKey: `plates/${projectId}/16x9/${v.scene_index}/g${v.gen}/source.ts`,
    bundleKey: `plates/${projectId}/16x9/${v.scene_index}/g${v.gen}/bundle.html`,
    manifest: { bundleSha: `fbsha000000000000000000${v.scene_index}`, engineDigest: "eng1" },
    timings: {}
  });
  assert.equal(ok, true);
  return store.getVariant(v.id);
};

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  PASS: ${name}`);
};

try {
  assert.equal(CHECK_GRACE_SECONDS, 180, "default CHECK_GRACE_SECONDS is 180 (3 minutes)");

  config.plates.live = true;
  config.plates.liveForceOff = false;

  await store.reconcileVariants(liveProject, desired("fb-live", 3), { scenes: 3 });
  assert.equal(await store.getLiveMode(liveProject), "live");
  const [v0, v1, v2] = await store.listVariants(liveProject);
  const b0 = await bundleVariant(liveProject, v0);
  const b1 = await bundleVariant(liveProject, v1);
  const b2 = await bundleVariant(liveProject, v2);

  await test("1. Within CHECK_GRACE_SECONDS (< 180s): live bundled/checking row is not moved", async () => {
    await pool.query("update app.plate_variants set updated_at = now() - interval '150 seconds' where id = $1", [b0.id]);
    await reconcilePlates();
    const after = await store.getVariant(b0.id);
    assert.equal(after.state, "bundled");
    assert.equal(after.stage, "checking");
    assert.equal(await renderMsgs(b0.id), 0);
    assert.equal(after.timings?.retrying, undefined);
  });

  await test("2. Row with an existing check report (e.g. kind='env') is not moved by the no-report fallback", async () => {
    const envRes = await store.submitCheckReport(b1.id, {
      gen: b1.gen,
      bundleDigest: b1.bundle_digest,
      host: "worker",
      results: { ok: false, kind: "env", message: "WebGL unavailable" }
    });
    assert.equal(envRes.status, "ok");
    await pool.query("update app.plate_variants set updated_at = now() - interval '200 seconds' where id = $1", [b1.id]);
    await reconcilePlates();
    const after = await store.getVariant(b1.id);
    assert.equal(after.state, "bundled");
    assert.equal(after.stage, "checking");
    assert.equal(await renderMsgs(b1.id), 0, "row with existing plate_check_reports entry is not auto-moved");
  });

  await test("3. Past CHECK_GRACE_SECONDS (> 180s) with no check report: moves to clip path, logs plate_check_fallback, records timings.retrying, counts in open", async () => {
    await pool.query("update app.plate_variants set updated_at = now() - interval '185 seconds' where id = $1", [b0.id]);
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(" "));
      origLog(...args);
    };
    let openCount;
    try {
      openCount = await reconcilePlates();
    } finally {
      console.log = origLog;
    }

    const after = await store.getVariant(b0.id);
    assert.equal(after.state, "bundled");
    assert.equal(after.stage, "queued for rendering");
    assert.ok(after.enqueued_at instanceof Date, "enqueued_at set to now()");
    assert.equal(await renderMsgs(b0.id), 1, "exactly one plate-render job enqueued");
    assert.equal(after.timings?.retrying?.attempt, 1);
    assert.equal(after.timings?.retrying?.reason, "the preview check did not report; drawing it on the server");
    assert.equal(typeof after.timings?.retrying?.at, "number");
    assert.ok(openCount >= 1, `fallback variant counted in sweep open (got ${openCount})`);

    const fallbackLogs = logs
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((entry) => entry && entry.event === "plate_check_fallback" && entry.variantId === b0.id);
    assert.equal(fallbackLogs.length, 1, "logged structured plate_check_fallback once for the row");
    assert.equal(fallbackLogs[0].attempt, 1);
    assert.equal(fallbackLogs[0].gen, b0.gen);
  });

  await test("4. Idempotent across subsequent sweeps: second sweep does nothing and never double-enqueues", async () => {
    const before = await store.getVariant(b0.id);
    await reconcilePlates();
    const after = await store.getVariant(b0.id);
    assert.equal(await renderMsgs(b0.id), 1, "still exactly one plate-render job");
    assert.equal(after.timings?.retrying?.attempt, 1, "attempt not bumped on immediate second sweep");
    assert.equal(after.enqueued_at.getTime(), before.enqueued_at.getTime());
  });

  await test("5. Respects per-project clip cap (projectClipCap): leaves excess rows for next sweep, then moves them once capacity frees", async () => {
    const origCap = config.plates.projectClipCap;
    config.plates.projectClipCap = 4;
    try {
      await store.reconcileVariants(capProject, desired("fb-cap", 6), { scenes: 6 });
      const capVars = await store.listVariants(capProject);
      const bundledCap = [];
      for (const v of capVars) {
        bundledCap.push(await bundleVariant(capProject, v));
      }
      // Age all 6 past CHECK_GRACE_SECONDS
      await pool.query(
        "update app.plate_variants set updated_at = now() - interval '200 seconds' where project_id = $1",
        [capProject]
      );

      const open1 = await reconcilePlates();
      assert.ok(open1 >= 6, "all 6 (4 queued + 2 waiting for cap) counted in open");

      const afterPass1 = await store.listVariants(capProject);
      const queuedPass1 = afterPass1.filter((v) => v.stage === "queued for rendering");
      const stillCheckingPass1 = afterPass1.filter((v) => v.stage === "checking");
      assert.equal(queuedPass1.length, config.plates.projectClipCap, `admitted exactly projectClipCap (${config.plates.projectClipCap})`);
      assert.equal(stillCheckingPass1.length, 2, "2 variants over cap left in checking for next sweep");
      for (const v of stillCheckingPass1) {
        assert.equal(await renderMsgs(v.id), 0, "capped variant has no plate-render job yet");
      }

      // Complete 2 of the queued variants (drawn + job completed) so 2 slots open up
      for (const doneVar of queuedPass1.slice(0, 2)) {
        await pool.query("update app.plate_variants set state = 'drawn', stage = null, clip_key = 'plates/x/clip.mp4' where id = $1", [doneVar.id]);
        await pool.query("update pgboss.job set state = 'completed' where name = $1 and data->>'variantId' = $2", [QUEUES.plateRender, doneVar.id]);
      }

      await reconcilePlates();
      const afterPass2 = await store.listVariants(capProject);
      const stillCheckingPass2 = afterPass2.filter((v) => v.stage === "checking");
      assert.equal(stillCheckingPass2.length, 0, "remaining 2 variants moved to clip path on next sweep");
      for (const v of stillCheckingPass1) {
        assert.equal(await renderMsgs(v.id), 1, "newly admitted variant got exactly one plate-render job");
      }
    } finally {
      config.plates.projectClipCap = origCap;
    }
  });

  console.log(`plate-check-fallback: ok (${passed} assertions/cases passed)`);
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
