// Slow scenes play from a worker clip: the browser check reports its measured draw cost (results.drawMs); over the threshold the server
// queues the worker clip render (fenced, one job, no model call), marks the scene playback "clip" and exposes it through /plates.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_resil node --experimental-strip-types test/plate-slow-scene.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { operations } = await import("../src/jobs/control.ts");
const store = await import("../src/plates/store.ts");
const { plateStatus } = await import("../src/plates/service.ts");
await migrate();
await startQueues();

// ---- the threshold decision (pure)
assert.equal(store.SLOW_DRAW_MEDIAN_MS, 60);
assert.equal(store.SLOW_DRAW_P90_MS, 80);
assert.equal(store.slowDraw({ medianMs: 59, p90Ms: 79 }), null, "just under both: live");
assert.deepEqual(store.slowDraw({ medianMs: 61, p90Ms: 70 }), { medianMs: 61, p90Ms: 70 }, "median over 60: clip");
assert.deepEqual(store.slowDraw({ medianMs: 20, p90Ms: 81 }), { medianMs: 20, p90Ms: 81 }, "p90 over 80: clip");
assert.equal(store.slowDraw(undefined), null, "no measurement: live");
assert.equal(store.slowDraw({ medianMs: "x", p90Ms: -5 }), null, "garbage: live");
assert.equal(store.slowDraw({ medianMs: 5, p90Ms: 9 }), null, "fast scene: live");

const project = randomUUID();
const msgs = async (id) => Number((await pool.query("select count(*) n from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [id])).rows[0].n);
try {
  config.plates.live = true;
  await store.reconcileVariants(project, [0, 1, 2].map((index) => ({ index, aspect: "16:9", signature: `v3:slow${index}`, frames: 90, width: 1920, height: 1080, keyword: `k${index}` })), { scenes: 3 });
  const rows = await store.listVariants(project);
  for (const v of rows) {
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.commitBundle(v, owner, { sourceKey: `plates/${project}/16x9/${v.scene_index}/g1/source.ts`, bundleKey: `plates/${project}/16x9/${v.scene_index}/g1/bundle.html`, manifest: { bundleSha: `slowsha0000000000000000${v.scene_index}`, engineDigest: "eng1" }, timings: {} });
  }
  const [fast, slow, unmeasured] = await Promise.all(rows.map((v) => store.getVariant(v.id)));
  const report = (row, drawMs) => store.submitCheckReport(row.id, { gen: row.gen, bundleDigest: row.bundle_digest, host: "worker", results: { ok: true, ...(drawMs ? { drawMs } : {}) } });

  // fast scene keeps drawing live
  const r1 = await report(fast, { medianMs: 12, p90Ms: 20 });
  assert.deepEqual(r1.body, { state: "checked" });
  assert.equal((await store.getVariant(fast.id)).state, "checked");
  assert.equal(await msgs(fast.id), 0, "no worker job for a fast scene");

  // a report without a measurement behaves as before
  assert.deepEqual((await report(unmeasured)).body, { state: "checked" });

  // slow scene goes to the clip path
  const r2 = await report(slow, { medianMs: 150, p90Ms: 240 });
  assert.equal(r2.status, "ok");
  assert.deepEqual(r2.body, { state: "bundled", playback: "clip" });
  const after = await store.getVariant(slow.id);
  assert.equal(after.state, "bundled");
  assert.equal(after.stage, "queued for rendering");
  assert.equal(await msgs(slow.id), 1, "exactly one plate-render job");
  assert.equal(after.timings.playback.mode, "clip");
  assert.equal(after.timings.playback.medianMs, 150);

  // duplicate report: same answer, no second job
  const r3 = await report(slow, { medianMs: 150, p90Ms: 240 });
  assert.equal(r3.duplicate, true);
  assert.deepEqual(r3.body, { state: "bundled", playback: "clip" });
  assert.equal(await msgs(slow.id), 1, "duplicate report queues nothing");

  // what /plates shows
  const status = await plateStatus(project);
  const view = (i) => status.scenes.find((s) => s.index === i);
  assert.equal(view(1).playback, "clip");
  assert.equal(view(1).drawMsPerFrame, 150);
  assert.equal(view(1).live, false);
  assert.equal(view(1).state, "rendering");
  assert.equal(view(0).playback, undefined, "fast scene has no playback marker");
  assert.equal(view(0).live, true);
  assert.equal(view(1).variants["16:9"].playback, "clip");

  // the worker draws it; the marker survives to the drawn scene
  const claim = await operations["plate.claim"]({ variantId: slow.id, gen: slow.gen });
  assert.ok(claim.row, "worker claims the clip render");
  const drawn = await operations["plate.drawn"]({ id: slow.id, gen: slow.gen, renderAttempt: claim.row.render_attempt, clipKey: `plates/${project}/clip1.mp4`, stillKey: null, clipMeta: {}, timings: { renderMs: 1 } });
  assert.equal(drawn.ok, true);
  const afterDrawn = await plateStatus(project);
  assert.equal(afterDrawn.scenes.find((s) => s.index === 1).state, "drawn");
  assert.equal(afterDrawn.scenes.find((s) => s.index === 1).playback, "clip");

  // ---- measurement reports for rows ALREADY checked (checked before the slow decision existed, or measured under real playback)
  const playback = (row, drawMs, samples, extra = {}) => store.submitCheckReport(row.id, { gen: row.gen, bundleDigest: extra.digest ?? row.bundle_digest, host: "worker", results: { ok: true, source: "playback", samples, drawMs } });
  assert.equal((await store.getVariant(unmeasured.id)).state, "checked");
  const thin = await playback(unmeasured, { medianMs: 200, p90Ms: 300 }, 5);
  assert.deepEqual(thin.body, { state: "checked" }, "fewer than 8 samples: ignored");
  assert.equal((await store.getVariant(unmeasured.id)).state, "checked");
  assert.equal(await msgs(unmeasured.id), 0);
  const stale = await playback(unmeasured, { medianMs: 200, p90Ms: 300 }, 12, { digest: "not-the-digest" });
  assert.equal(stale.status, "dropped", "stale digest keeps today's fence");
  const fastPb = await playback(fast, { medianMs: 10, p90Ms: 18 }, 12);
  assert.deepEqual(fastPb.body, { state: "checked" });
  assert.equal((await store.getVariant(fast.id)).state, "checked", "a fast measurement changes nothing");
  assert.equal(await msgs(fast.id), 0);
  const slowPb = await playback(unmeasured, { medianMs: 200, p90Ms: 300 }, 12);
  assert.deepEqual(slowPb.body, { state: "bundled", playback: "clip" });
  const demoted = await store.getVariant(unmeasured.id);
  assert.equal(demoted.state, "bundled");
  assert.equal(demoted.stage, "queued for rendering");
  assert.equal(demoted.timings.playback.digest, unmeasured.bundle_digest);
  assert.equal(await msgs(unmeasured.id), 1, "one plate-render job");
  const again = await playback(unmeasured, { medianMs: 200, p90Ms: 300 }, 12);
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.body, { state: "bundled", playback: "clip" });
  assert.equal(await msgs(unmeasured.id), 1, "repeat queues nothing");
  assert.ok((await store.getVariant(unmeasured.id)).check_report, "the original check report is not clobbered");
  const rep = await pool.query("select host from app.plate_check_reports where variant_id = $1 order by host", [unmeasured.id]);
  assert.deepEqual(rep.rows.map((r) => r.host), ["worker", "worker:playback"], "the measurement is its own report row");
  const viewNow = (await plateStatus(project)).scenes.find((x) => x.index === 2);
  assert.equal(viewNow.playback, "clip");
  // a scene that is already drawn is never touched by a measurement
  const drawnPb = await playback(slow, { medianMs: 500, p90Ms: 900 }, 20);
  assert.equal(drawnPb.status, "dropped", "drawn scene: measurement dropped");

  // a revised scene (new bundle digest) never inherits the marker
  await pool.query("update app.plate_variants set bundle_digest = 'otherdigest' where id = $1", [slow.id]);
  assert.equal((await plateStatus(project)).scenes.find((s) => s.index === 1).playback, undefined, "marker is bound to its bundle digest");
  console.log("plate-slow-scene: ok");
} finally {
  config.plates.live = false;
  const ids = (await pool.query("select id::text as id from app.plate_variants where project_id = $1", [project])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [ids]);
  await pool.query("delete from app.plate_variants where project_id = $1", [project]);
  await pool.query("delete from app.plate_state where project_id = $1", [project]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
