// Live plate state machine against real Postgres + pg-boss: live vs clip bundling, fenced check reports,
// deduplicated idempotency, bounded code repair, env fallback, reviseScene invalidation, and sticky live_mode.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-live.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

// --- 0. Startup config validation for PLATE_LIVE_PREVIEW and PLATE_LIVE_FORCE_OFF
{
  const root = resolve(import.meta.dirname, "../..");
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    APP_ENV: "local",
    PLANNER: "deterministic",
    DATABASE_URL: process.env.DATABASE_URL,
    STORAGE_DRIVER: "r2",
    R2_ENDPOINT: "http://localhost:9000",
    R2_ACCESS_KEY_ID: "a",
    R2_SECRET_ACCESS_KEY: "b",
    R2_UPLOADS_BUCKET: "u",
    R2_OUTPUTS_BUCKET: "o"
  };
  const runConfig = (extra) =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", "const { config } = await import('./backend/src/config.ts'); console.log(JSON.stringify(config.plates));"],
      { cwd: root, env: { ...baseEnv, ...extra }, encoding: "utf8" }
    );

  const invalidVal = runConfig({ PLATE_PIPELINE: "worker", PLATE_LIVE_PREVIEW: "maybe" });
  assert.notEqual(invalidVal.status, 0, "invalid PLATE_LIVE_PREVIEW value throws at startup");
  assert.match(invalidVal.stderr, /PLATE_LIVE_PREVIEW must be "off" or "on"/);

  const liveWithoutWorker = runConfig({ PLATE_PIPELINE: "off", PLATE_LIVE_PREVIEW: "on" });
  assert.notEqual(liveWithoutWorker.status, 0, "PLATE_LIVE_PREVIEW=on with PLATE_PIPELINE=off throws at startup");
  assert.match(liveWithoutWorker.stderr, /PLATE_LIVE_PREVIEW=on requires PLATE_PIPELINE=worker/);

  const validLive = runConfig({ PLATE_PIPELINE: "worker", PLATE_LIVE_PREVIEW: "on", PLATE_LIVE_FORCE_OFF: "1" });
  assert.equal(validLive.status, 0, validLive.stderr);
  const parsed = JSON.parse(validLive.stdout.trim().split("\n").pop());
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.live, true);
  assert.equal(parsed.liveForceOff, true);
  assert.equal(parsed.projectClipCap, 16);
}

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
const { plateStatus } = await import("../src/plates/service.ts");
const { reconcilePlates } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const liveProject = randomUUID();
const clipProject = randomUUID();
const flipProject = randomUUID();
const projects = [liveProject, clipProject, flipProject];

const msgs = async (name, id) =>
  Number((await pool.query("select count(*) n from pgboss.job where name = $1 and data->>'variantId' = $2", [name, id])).rows[0].n);
const reportCount = async (variantId) =>
  Number((await pool.query("select count(*) n from app.plate_check_reports where variant_id = $1", [variantId])).rows[0].n);
const desired = (sigPrefix = "v3:s") =>
  [0, 1, 2].map((index) => ({
    index,
    aspect: "16:9",
    signature: `${sigPrefix}${index}-16:9`,
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: `k${index}`
  }));

try {
  // --- 1. live_mode is decided once per project and a later flag flip does not change it
  config.plates.live = true;
  assert.equal(await store.decideLiveMode(flipProject, config.plates.live), "live");
  config.plates.live = false;
  assert.equal(await store.decideLiveMode(flipProject, config.plates.live), "live", "later flag flip to off does not change live_mode");
  assert.equal(await store.getLiveMode(flipProject), "live");

  // And in the opposite direction: decided as 'clip' when off, stays 'clip' when flipped to on
  assert.equal(await store.decideLiveMode(clipProject, false), "clip");
  config.plates.live = true;
  assert.equal(await store.decideLiveMode(clipProject, config.plates.live), "clip", "later flag flip to on does not change clip project");

  // --- 2. With live off (clipProject): bundled enqueues exactly one plate-render as before
  config.plates.live = false;
  await store.reconcileVariants(clipProject, desired("v3:clip"), { scenes: 3 });
  const clipV0 = (await store.listVariants(clipProject))[0];
  const clipOwner = store.newOwner();
  await store.claimAuthor(clipV0.id, clipV0.gen, clipOwner, 60, 10);
  assert.equal(
    await store.commitBundle(clipV0, clipOwner, {
      sourceKey: `plates/${clipProject}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${clipProject}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "clipsha00000000000000000", engineDigest: "eng1" },
      timings: {}
    }),
    true
  );
  assert.equal(await msgs("plate-render", clipV0.id), 1, "clip mode enqueues plate-render at bundled");
  const clipBundled = await store.getVariant(clipV0.id);
  const clipCheckAttempt = await store.submitCheckReport(clipBundled.id, {
    gen: clipBundled.gen,
    bundleDigest: clipBundled.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal(clipCheckAttempt.status, "not_live", "check report rejected for clip project");

  // --- 3. With live on (liveProject): variant reaches bundled with ZERO plate-render messages
  config.plates.live = true;
  await store.reconcileVariants(liveProject, desired("v3:live"), { scenes: 3 });
  assert.equal(await store.getLiveMode(liveProject), "live");
  const liveVariants = await store.listVariants(liveProject);
  const v0 = liveVariants[0];
  const v1 = liveVariants[1];
  const v2 = liveVariants[2];

  for (const v of [v0, v1, v2]) {
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.noteAuthorCall(v.id, v.gen, owner, { authorMs: 10 });
    assert.equal(
      await store.commitBundle(v, owner, {
        sourceKey: `plates/${liveProject}/16x9/${v.scene_index}/g1/source.ts`,
        bundleKey: `plates/${liveProject}/16x9/${v.scene_index}/g1/bundle.html`,
        manifest: { bundleSha: `livesha0000000000000000${v.scene_index}`, engineDigest: "eng1" },
        timings: {}
      }),
      true
    );
    assert.equal(await msgs("plate-render", v.id), 0, "live mode enqueues zero plate-render messages at bundled");
  }

  const b0 = await store.getVariant(v0.id);
  assert.equal(b0.state, "bundled");
  assert.ok(b0.bundle_digest, "bundle_digest recorded on bundled variant");

  // (within the check grace; after PLATE_CHECK_GRACE_SECONDS the server fallback draws it, see plate-check-fallback.mjs)
  // Reconciler must NOT treat a live project's bundled variant as needing plate-render
  await pool.query("update app.plate_variants set updated_at = now() - interval '30 seconds' where id = $1", [b0.id]);
  await reconcilePlates();
  assert.equal(await msgs("plate-render", b0.id), 0, "reconciler does not enqueue plate-render for live bundled variant");

  // --- 4. Fencing on check reports: stale gen, wrong digest, forged host, wrong state all dropped with no change
  const staleGenRes = await store.submitCheckReport(b0.id, {
    gen: b0.gen + 1,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal(staleGenRes.status, "dropped");
  assert.equal((await store.getVariant(b0.id)).state, "bundled");
  assert.equal(await reportCount(b0.id), 0);

  const wrongDigestRes = await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: "0".repeat(64),
    host: "worker",
    results: { ok: true }
  });
  assert.equal(wrongDigestRes.status, "dropped");
  assert.equal((await store.getVariant(b0.id)).state, "bundled");
  assert.equal(await reportCount(b0.id), 0);

  const forgedHostRes = await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "iframe-forged",
    results: { ok: true }
  });
  assert.equal(forgedHostRes.status, "invalid_host");
  assert.equal((await store.getVariant(b0.id)).state, "bundled");
  assert.equal(await reportCount(b0.id), 0);

  // --- 5. Valid check report moves bundled -> checked; duplicate report is idempotent (one row); never reaches drawn
  const passRes = await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    device: { ua: "Chrome/156" },
    results: { ok: true, state: "drawn" }
  });
  assert.equal(passRes.status, "ok");
  assert.deepEqual(passRes.body, { state: "checked" });
  const checked0 = await store.getVariant(b0.id);
  assert.equal(checked0.state, "checked", "client report moves variant to checked, never to drawn");
  assert.notEqual(checked0.state, "drawn");
  assert.ok(checked0.checked_at instanceof Date);
  assert.equal(checked0.host, "worker");
  assert.equal(await reportCount(b0.id), 1);

  // Duplicate report for the same (variant_id, gen, bundle_digest, host)
  const dupRes = await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal(dupRes.status, "ok");
  assert.equal(dupRes.duplicate, true);
  assert.deepEqual(dupRes.body, { state: "checked" });
  assert.equal(await reportCount(b0.id), 1, "duplicate report writes only one row in plate_check_reports");

  // Another report with a different digest while state is 'checked' is dropped (wrong state / digest)
  const wrongStateRes = await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    results: { ok: false, kind: "code", error: "late error" }
  });
  assert.equal(wrongStateRes.status, "ok", "same tuple returns cached idempotent answer without mutating checked variant");
  assert.equal((await store.getVariant(b0.id)).state, "checked");

  // Reconciler does not treat checked variant as needing rendering
  await reconcilePlates();
  assert.equal(await msgs("plate-render", b0.id), 0, "checked variant is not queued for rendering by reconciler");

  // --- 6. kind: "env" changes nothing and returns { state: "bundled", fallback: true }
  const b1 = await store.getVariant(v1.id);
  const envRes = await store.submitCheckReport(b1.id, {
    gen: b1.gen,
    bundleDigest: b1.bundle_digest,
    host: "worker",
    results: { ok: false, kind: "env", message: "OffscreenCanvas context lost" }
  });
  assert.equal(envRes.status, "ok");
  assert.deepEqual(envRes.body, { state: "bundled", fallback: true });
  const afterEnv = await store.getVariant(b1.id);
  assert.equal(afterEnv.state, "bundled", "kind: env leaves variant in bundled state");
  assert.equal(afterEnv.checked_at, null);
  assert.equal(afterEnv.repairs, 0);

  // --- 7. kind: "code" starts the existing bounded repair path once (idempotent on duplicate)
  const b2 = await store.getVariant(v2.id);
  const authorMsgsBefore = await msgs("plate-author", b2.id);
  const codeRes = await store.submitCheckReport(b2.id, {
    gen: b2.gen,
    bundleDigest: b2.bundle_digest,
    host: "worker",
    results: { ok: false, kind: "code", error: "ReferenceError: moon is not defined at frame 0" }
  });
  assert.equal(codeRes.status, "ok");
  assert.deepEqual(codeRes.body, { state: "queued", repair: true });
  const repairing = await store.getVariant(b2.id);
  assert.equal(repairing.state, "queued");
  assert.equal(repairing.stage, "repairing");
  assert.equal(repairing.repairs, 1);
  assert.equal(repairing.repair.previousKey, b2.source_key);
  assert.match(repairing.repair.error, /moon is not defined/);
  assert.equal(await msgs("plate-author", b2.id), authorMsgsBefore + 1, "code failure queues one plate-author repair job");

  // Duplicate code failure report for the same (variant_id, gen, bundle_digest, host) does not repair a second time
  const dupCodeRes = await store.submitCheckReport(b2.id, {
    gen: b2.gen,
    bundleDigest: b2.bundle_digest,
    host: "worker",
    results: { ok: false, kind: "code", error: "ReferenceError: moon is not defined at frame 0" }
  });
  assert.equal(dupCodeRes.status, "ok");
  assert.equal(dupCodeRes.duplicate, true);
  assert.equal((await store.getVariant(b2.id)).repairs, 1, "duplicate report does not trigger a second repair");
  assert.equal(await msgs("plate-author", b2.id), authorMsgsBefore + 1);

  // --- 8. plateStatus reports mode, variantId, bundleDigest, live: boolean, and counts checked as playable
  const statusBeforeAllChecked = await plateStatus(liveProject);
  assert.equal(statusBeforeAllChecked.mode, "live");
  const s0 = statusBeforeAllChecked.scenes.find((s) => s.index === 0);
  assert.equal(s0.state, "checked");
  assert.equal(s0.variantId, b0.id);
  assert.equal(s0.bundleDigest, b0.bundle_digest);
  assert.equal(s0.live, true);

  // --- 9. Editing (reviseScene) after checked resets to queued with gen + 1 and invalidates the old report
  const revisedCount = await store.reviseScene(liveProject, 0, "- at 0.5 s: make the lantern green");
  assert.equal(revisedCount, 1, "reviseScene resets checked variant");
  const afterRevise = await store.getVariant(b0.id);
  assert.equal(afterRevise.state, "queued");
  assert.equal(afterRevise.gen, b0.gen + 1);
  assert.equal(afterRevise.rev, b0.rev + 1);
  assert.equal(afterRevise.checked_at, null);
  assert.equal(afterRevise.check_report, null);
  assert.equal(afterRevise.bundle_digest, null);

  const staleAfterRevise = await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal(staleAfterRevise.status, "dropped", "old gen report after reviseScene is dropped");
  assert.equal((await store.getVariant(b0.id)).state, "queued");

  console.log("plate live: ok");
} finally {
  config.plates.live = false;
  const vIds = (await pool.query("select id::text as id from app.plate_variants where project_id = any($1)", [projects])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [vIds]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
