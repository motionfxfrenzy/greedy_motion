// Phase 2c draw-on-demand for live plate projects against real Postgres + pg-boss:
//   - migration 020 idempotency (apply twice)
//   - requestDraws on checked and bundled variants enqueues 1 plate-render each
//   - calling requestDraws twice enqueues nothing more
//   - variants that already have a clip are untouched
//   - no per-project clip cap applies (6 variants all enqueued)
//   - variants still queued/authoring when requestDraws ran enqueue plate-render right after commitBundle
//   - reconciler re-enqueues a lost message for a draw_aspects live variant and never touches a live variant outside draw_aspects
//   - clip-mode projects: requestDraws is a no-op
//   - PLATE_LIVE_FORCE_OFF clears draw_aspects
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
const store = await import("../src/plates/store.ts");
const { reconcilePlates } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const projBasic = randomUUID();
const projSix = randomUUID();
const projDeferred = randomUUID();
const projReconcile = randomUUID();
const projClip = randomUUID();
const projects = [projBasic, projSix, projDeferred, projReconcile, projClip];

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
  // --- 0. Migration 020 is idempotent (apply twice)
  const mig020Path = resolve(import.meta.dirname, "../src/db/migrations/020_plate_draw_on_demand.sql");
  const mig020Sql = await readFile(mig020Path, "utf8");
  await pool.query(mig020Sql);
  await pool.query(mig020Sql);
  const colRes = await pool.query(
    `select data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'app' and table_name = 'plate_state' and column_name = 'draw_aspects'`
  );
  assert.equal(colRes.rows.length, 1, "draw_aspects column exists on app.plate_state");
  assert.equal(colRes.rows[0].data_type, "ARRAY");
  assert.equal(colRes.rows[0].is_nullable, "NO");

  // --- 1. requestDraws on checked and bundled variants enqueues 1 plate-render each;
  //        calling twice enqueues nothing more; variants that already have a clip are untouched
  config.plates.live = true;
  config.plates.liveForceOff = false;

  await store.reconcileVariants(projBasic, makeDesired(4, ["16:9"], "v3:basic"), { scenes: 4 });
  const basicVars = await store.listVariants(projBasic);
  const [vChecked, vBundled, vDrawnWithClip, vCheckedWithClip] = basicVars;

  // Bundle vChecked and mark it checked
  const bChecked = await bundleVariant(vChecked, projBasic, 0);
  const checkRes = await store.submitCheckReport(bChecked.id, {
    gen: bChecked.gen,
    bundleDigest: bChecked.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal(checkRes.status, "ok");
  assert.equal((await store.getVariant(vChecked.id)).state, "checked");

  // Bundle vBundled and leave it in 'bundled' (stage = 'checking')
  await bundleVariant(vBundled, projBasic, 1);
  assert.equal((await store.getVariant(vBundled.id)).state, "bundled");
  assert.equal((await store.getVariant(vBundled.id)).stage, "checking");

  // vDrawnWithClip already has state = 'drawn' and a clip_key
  await bundleVariant(vDrawnWithClip, projBasic, 2);
  await pool.query(
    "update app.plate_variants set state = 'drawn', stage = null, clip_key = $2, drawn_at = now() where id = $1",
    [vDrawnWithClip.id, `plates/${projBasic}/16x9/2/g1/clip-a1.mp4`]
  );

  // vCheckedWithClip is in 'checked' state but already has a clip_key
  const bCheckedClip = await bundleVariant(vCheckedWithClip, projBasic, 3);
  await store.submitCheckReport(bCheckedClip.id, {
    gen: bCheckedClip.gen,
    bundleDigest: bCheckedClip.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  await pool.query(
    "update app.plate_variants set clip_key = $2 where id = $1",
    [vCheckedWithClip.id, `plates/${projBasic}/16x9/3/g1/clip-a1.mp4`]
  );

  for (const v of basicVars) {
    assert.equal(await renderMsgs(v.id), 0, "zero plate-render jobs before requestDraws");
  }

  const firstDrawReq = await store.requestDraws(projBasic, ["16:9"]);
  assert.equal(firstDrawReq.enqueued, 2, "requestDraws enqueues checked and bundled variants without clip_key");
  assert.deepEqual((await store.readProjectState(projBasic)).drawAspects, ["16:9"]);

  const afterChecked = await store.getVariant(vChecked.id);
  const afterBundled = await store.getVariant(vBundled.id);
  assert.equal(afterChecked.state, "bundled");
  assert.equal(afterChecked.stage, "queued for rendering");
  assert.ok(afterChecked.enqueued_at instanceof Date);
  assert.equal(await renderMsgs(vChecked.id), 1, "checked variant gets 1 plate-render job");

  assert.equal(afterBundled.state, "bundled");
  assert.equal(afterBundled.stage, "queued for rendering");
  assert.ok(afterBundled.enqueued_at instanceof Date);
  assert.equal(await renderMsgs(vBundled.id), 1, "bundled variant gets 1 plate-render job");

  // Variants with existing clip_key are untouched
  const afterDrawnClip = await store.getVariant(vDrawnWithClip.id);
  assert.equal(afterDrawnClip.state, "drawn");
  assert.equal(afterDrawnClip.stage, null);
  assert.equal(afterDrawnClip.clip_key, `plates/${projBasic}/16x9/2/g1/clip-a1.mp4`);
  assert.equal(await renderMsgs(vDrawnWithClip.id), 0, "drawn variant with clip_key is untouched");

  const afterCheckedClip = await store.getVariant(vCheckedWithClip.id);
  assert.equal(afterCheckedClip.state, "checked");
  assert.equal(afterCheckedClip.clip_key, `plates/${projBasic}/16x9/3/g1/clip-a1.mp4`);
  assert.equal(await renderMsgs(vCheckedWithClip.id), 0, "checked variant with existing clip_key is untouched");

  // Calling requestDraws a second time enqueues nothing more
  const secondDrawReq = await store.requestDraws(projBasic, ["16:9"]);
  assert.equal(secondDrawReq.enqueued, 0, "second requestDraws enqueues 0 jobs");
  assert.equal(await renderMsgs(vChecked.id), 1, "still 1 job for checked variant");
  assert.equal(await renderMsgs(vBundled.id), 1, "still 1 job for bundled variant");
  assert.equal(await renderMsgs(vDrawnWithClip.id), 0);
  assert.equal(await renderMsgs(vCheckedWithClip.id), 0);

  // --- 2. No clip cap applies (6 variants all enqueued even though projectClipCap is 4)
  assert.equal(config.plates.projectClipCap, 4);
  await store.reconcileVariants(projSix, makeDesired(6, ["16:9"], "v3:six"), { scenes: 6 });
  const sixVars = await store.listVariants(projSix);
  assert.equal(sixVars.length, 6);
  for (let i = 0; i < sixVars.length; i++) {
    const b = await bundleVariant(sixVars[i], projSix, i);
    if (i % 2 === 0) {
      await store.submitCheckReport(b.id, {
        gen: b.gen,
        bundleDigest: b.bundle_digest,
        host: "worker",
        results: { ok: true }
      });
    }
  }
  const sixDrawReq = await store.requestDraws(projSix, ["16:9"]);
  assert.equal(sixDrawReq.enqueued, 6, "all 6 variants enqueued without clip cap");
  for (const v of sixVars) {
    assert.equal(await renderMsgs(v.id), 1, `scene ${v.scene_index} enqueued once`);
    const updated = await store.getVariant(v.id);
    assert.equal(updated.state, "bundled");
    assert.equal(updated.stage, "queued for rendering");
  }

  // --- 3. A variant still queued or authoring when requestDraws ran is drawn right after commitBundle
  await store.reconcileVariants(projDeferred, makeDesired(2, ["16:9", "9:16"], "v3:def"), { scenes: 2 });
  const defVars = await store.listVariants(projDeferred);
  const v169Queued = defVars.find((r) => r.scene_index === 0 && r.aspect === "16:9");
  const v169Authoring = defVars.find((r) => r.scene_index === 1 && r.aspect === "16:9");
  const v916Queued = defVars.find((r) => r.scene_index === 0 && r.aspect === "9:16");

  // Claim v169Authoring so it is in 'authoring' when requestDraws runs, while v169Queued stays 'queued'
  const authoringOwner = store.newOwner();
  await store.claimAuthor(v169Authoring.id, v169Authoring.gen, authoringOwner, 60, 10);
  assert.equal((await store.getVariant(v169Authoring.id)).state, "authoring");
  assert.equal((await store.getVariant(v169Queued.id)).state, "queued");

  // Call requestDraws for 16:9 while both 16:9 scenes are queued/authoring
  const defDrawReq = await store.requestDraws(projDeferred, ["16:9"]);
  assert.equal(defDrawReq.enqueued, 0, "nothing bundled/checked yet when requestDraws runs");
  assert.deepEqual((await store.readProjectState(projDeferred)).drawAspects, ["16:9"]);
  assert.equal(await renderMsgs(v169Authoring.id), 0);
  assert.equal(await renderMsgs(v169Queued.id), 0);

  // Now commitBundle on v169Authoring (which was 'authoring' when requestDraws ran)
  assert.equal(
    await store.commitBundle(v169Authoring, authoringOwner, {
      sourceKey: `plates/${projDeferred}/16x9/1/g1/source.ts`,
      bundleKey: `plates/${projDeferred}/16x9/1/g1/bundle.html`,
      manifest: { bundleSha: "defsha000000000000000001", engineDigest: "eng-def" },
      timings: {}
    }),
    true
  );
  const afterCommitAuthoring = await store.getVariant(v169Authoring.id);
  assert.equal(afterCommitAuthoring.state, "bundled");
  assert.equal(afterCommitAuthoring.stage, "queued for rendering");
  assert.equal(await renderMsgs(v169Authoring.id), 1, "authoring variant enqueued plate-render immediately on commitBundle");

  // Now claim and commitBundle on v169Queued (which was 'queued' when requestDraws ran)
  const queuedOwner = store.newOwner();
  await store.claimAuthor(v169Queued.id, v169Queued.gen, queuedOwner, 60, 10);
  assert.equal(
    await store.commitBundle(v169Queued, queuedOwner, {
      sourceKey: `plates/${projDeferred}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${projDeferred}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "defsha000000000000000000", engineDigest: "eng-def" },
      timings: {}
    }),
    true
  );
  const afterCommitQueued = await store.getVariant(v169Queued.id);
  assert.equal(afterCommitQueued.state, "bundled");
  assert.equal(afterCommitQueued.stage, "queued for rendering");
  assert.equal(await renderMsgs(v169Queued.id), 1, "queued variant enqueued plate-render immediately on commitBundle");

  // Calling requestDraws again after commitBundle enqueues nothing more
  const defDrawReqAfter = await store.requestDraws(projDeferred, ["16:9"]);
  assert.equal(defDrawReqAfter.enqueued, 0);
  assert.equal(await renderMsgs(v169Authoring.id), 1);
  assert.equal(await renderMsgs(v169Queued.id), 1);

  // Meanwhile, a variant of 9:16 (not in draw_aspects) on the same live project does NOT enqueue plate-render on commitBundle
  const owner916 = store.newOwner();
  await store.claimAuthor(v916Queued.id, v916Queued.gen, owner916, 60, 10);
  assert.equal(
    await store.commitBundle(v916Queued, owner916, {
      sourceKey: `plates/${projDeferred}/9x16/0/g1/source.ts`,
      bundleKey: `plates/${projDeferred}/9x16/0/g1/bundle.html`,
      manifest: { bundleSha: "defsha916000000000000000", engineDigest: "eng-def" },
      timings: {}
    }),
    true
  );
  const afterCommit916 = await store.getVariant(v916Queued.id);
  assert.equal(afterCommit916.state, "bundled");
  assert.equal(afterCommit916.stage, "checking");
  assert.equal(await renderMsgs(v916Queued.id), 0, "aspect outside draw_aspects does not enqueue plate-render on commitBundle");

  // --- 4. Reconciler re-enqueues a lost message for a draw_aspects live variant and never touches a live variant outside draw_aspects
  await store.reconcileVariants(projReconcile, makeDesired(1, ["16:9", "9:16"], "v3:rec"), { scenes: 1 });
  const recVars = await store.listVariants(projReconcile);
  const rec169 = recVars.find((r) => r.aspect === "16:9");
  const rec916 = recVars.find((r) => r.aspect === "9:16");
  await bundleVariant(rec169, projReconcile, 0);
  await bundleVariant(rec916, projReconcile, 1);

  await store.requestDraws(projReconcile, ["16:9"]);
  assert.equal(await renderMsgs(rec169.id), 1);
  assert.equal(await renderMsgs(rec916.id), 0);

  // Simulate lost plate-render message for rec169 and age both rec169 and rec916 past RESEND_AFTER (90s)
  await pool.query("delete from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [rec169.id]);
  await pool.query(
    "update app.plate_variants set enqueued_at = now() - interval '10 minutes', updated_at = now() - interval '10 minutes' where project_id = $1",
    [projReconcile]
  );
  assert.equal(await renderMsgs(rec169.id), 0);

  await reconcilePlates();
  assert.equal(await renderMsgs(rec169.id), 1, "reconciler re-enqueued lost plate-render for draw_aspects live variant");
  assert.equal(await renderMsgs(rec916.id), 0, "reconciler never touched live variant outside draw_aspects");
  assert.equal((await store.getVariant(rec916.id)).stage, "checking");

  // Running reconcilePlates again immediately does not enqueue a second message
  await reconcilePlates();
  assert.equal(await renderMsgs(rec169.id), 1, "reconciler does not duplicate active plate-render job");
  assert.equal(await renderMsgs(rec916.id), 0);

  // --- 5. Clip-mode projects: requestDraws is a no-op
  config.plates.live = false;
  await store.reconcileVariants(projClip, makeDesired(2, ["16:9"], "v3:clip"), { scenes: 2 });
  assert.equal(await store.getLiveMode(projClip), "clip");
  const clipVars = await store.listVariants(projClip);
  await bundleVariant(clipVars[0], projClip, 0);
  // Clear pgboss plate-render jobs for clipVars[0] so we can verify requestDraws does nothing at all on a clip project
  await pool.query("delete from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [clipVars[0].id]);
  await pool.query("update app.plate_variants set stage = 'checking' where id = $1", [clipVars[0].id]);

  config.plates.live = true; // even if global flag is on, projClip has sticky live_mode = 'clip'
  const clipDrawReq = await store.requestDraws(projClip, ["16:9"]);
  assert.equal(clipDrawReq.enqueued, 0, "requestDraws is a no-op on clip-mode project");
  assert.deepEqual((await store.readProjectState(projClip)).drawAspects, [], "draw_aspects stays empty on clip-mode project");
  assert.equal(await renderMsgs(clipVars[0].id), 0, "no plate-render enqueued by requestDraws on clip-mode project");

  // --- 6. PLATE_LIVE_FORCE_OFF clears draw_aspects
  await store.requestDraws(projReconcile, ["16:9", "9:16"]);
  assert.deepEqual((await store.readProjectState(projReconcile)).drawAspects, ["16:9", "9:16"]);
  config.plates.liveForceOff = true;
  await reconcilePlates();

  const afterForceOff = await store.readProjectState(projReconcile);
  assert.equal(afterForceOff.liveMode, "clip", "PLATE_LIVE_FORCE_OFF flips live_mode to clip");
  assert.deepEqual(afterForceOff.drawAspects, [], "PLATE_LIVE_FORCE_OFF clears draw_aspects");

  const basicAfterForceOff = await store.readProjectState(projBasic);
  assert.equal(basicAfterForceOff.liveMode, "clip");
  assert.deepEqual(basicAfterForceOff.drawAspects, []);

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
