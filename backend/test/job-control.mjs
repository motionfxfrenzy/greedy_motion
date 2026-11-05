// Job control against a real Postgres + pg-boss, with the worker's real client: bounded long polls, leases, fencing across
// attempts, idempotent completion, stale heartbeats, authorisation, and "the worker opens no database connection".
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types backend/test/job-control.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_unit|plates_rebundle|test/.test(process.env.DATABASE_URL ?? "")) throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues, QUEUES } = await import("../src/jobs/queues.ts");
const { registerJobControlRoutes, waitingWorkers } = await import("../src/jobs/control.ts");
const store = await import("../src/plates/store.ts");
const { reconcilePlates } = await import("../src/plates/reconcile.ts");
const { createControl, runLeased } = await import("../../worker/src/control.mjs");
await migrate();
await startQueues();
// Hermetic: jobs left by an earlier run must not be handed to this one.
await pool.query("delete from pgboss.job where name in ('render-video', 'render-finished', 'plate-render', 'plate-export')");

const TOKEN = "t".repeat(32);
const app = Fastify();
await registerJobControlRoutes(app, TOKEN);
await app.listen({ port: 0, host: "127.0.0.1" });
const url = `http://127.0.0.1:${app.server.address().port}`;
const control = createControl({ url, token: TOKEN });

const newRenderJob = async () => {
  const id = randomUUID();
  await pool.query(
    `insert into app.render_jobs (id, project_id, state, stage, progress, request, revision, render_input, render_queued_at)
     values ($1, $2, 'rendering', 'queued', 0, '{}', '{}', '{"template":"x"}', now())`, [id, randomUUID()]);
  await boss.send(QUEUES.video, { jobId: id });
  return id;
};
const slots = { "render-video": 1, "plate-render": 0, "plate-export": 0 };
const jobState = async (id) => (await pool.query("select state from pgboss.job where name = 'render-video' and data->>'jobId' = $1 order by created_on desc limit 1", [id])).rows[0]?.state;
const poolClients = () => Number(pool.totalCount);

try {
  // --- authorisation and allow-list
  const raw = (path, token, body = {}) => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await raw("/internal/worker/poll", null, { workerId: randomUUID(), slots })).status, 401, "no token");
  assert.equal((await raw("/internal/worker/poll", "x".repeat(32), { workerId: randomUUID(), slots })).status, 401, "wrong token");
  assert.equal((await raw("/internal/worker/op/drop_table", TOKEN)).status, 404, "unknown operation");
  assert.equal((await raw("/internal/worker/op/__proto__", TOKEN)).status, 404, "prototype names are not operations");
  assert.equal((await raw("/internal/worker/jobs/not-a-queue/" + randomUUID() + "/heartbeat", TOKEN, { attempt: 1 })).status, 400, "queue allow-list");

  // --- a poll with nothing to take is bounded (and costs no waiter afterwards)
  const t0 = Date.now();
  assert.deepEqual((await control.poll(slots, { waitSeconds: 2 })).jobs, [], "empty poll answers empty");
  const took = Date.now() - t0;
  assert.ok(took >= 1800 && took < 4500, `the poll is held about as long as asked (took ${took} ms)`);
  assert.equal(waitingWorkers(), 0, "no waiter left behind");
  assert.deepEqual((await control.poll({ "render-video": 0, "plate-render": 0, "plate-export": 0 }, { waitSeconds: 25 })).jobs, [], "no free slot: answered at once, not held");

  // --- a job arriving during a held poll is delivered by the backstop; lease + claim + heartbeat + finish + ack
  const jobId = await newRenderJob();
  const [lease] = (await control.poll(slots, { waitSeconds: 10 })).jobs;
  assert.equal(lease.data.jobId, jobId);
  assert.equal(lease.attempt, 1, "first claim is attempt 1");
  assert.deepEqual(await control.heartbeat(lease.queue, lease.id, 1), { ok: true }, "a live lease renews");
  assert.ok((await control.op("render.claim", { jobId, attempt: 1 }, { retry: false })).input, "domain claim returns the input");
  assert.equal((await control.op("render.claim", { jobId, attempt: 1 }, { retry: false })).input, null, "claiming twice returns nothing (why claims are never retried)");
  assert.equal((await control.op("render.progress", { jobId, attempt: 1, stage: "rendering", progress: 60 })).ok, true);
  assert.equal((await control.op("render.progress", { jobId, attempt: 2, stage: "rendering", progress: 99 })).ok, false, "a different attempt cannot write");
  const finished = await control.op("render.finish", { jobId, attempt: 1, outcome: { output: { key: "renders/x/a1.mp4", format: "mp4" } } });
  assert.deepEqual(finished, { committed: true });
  const again = await control.op("render.finish", { jobId, attempt: 1, outcome: { output: { key: "renders/x/a1.mp4", format: "mp4" } } });
  assert.deepEqual(again, { committed: true, duplicate: true }, "a retried finish whose answer was lost keeps the worker's output");
  const stale = await control.op("render.finish", { jobId, attempt: 2, outcome: { output: { key: "renders/x/a2.mp4" } } });
  assert.equal(stale.committed, false, "another attempt did not commit");
  assert.equal(Number((await pool.query("select count(*) n from pgboss.job where name = 'render-finished' and data->>'jobId' = $1", [jobId])).rows[0].n), 1, "render-finished queued exactly once");
  assert.equal((await control.complete(lease.queue, lease.id, 1)).ok, true);
  assert.equal(await jobState(jobId), "completed", "acknowledged in pg-boss");
  assert.equal((await control.complete(lease.queue, lease.id, 1)).applied, false, "acknowledging twice is harmless");
  assert.equal((await control.heartbeat(lease.queue, lease.id, 1)).ok, false, "a finished job has no lease to renew");

  // --- attempt fencing across a lost worker: the first holder goes silent, pg-boss hands the job on, the old holder is fenced out
  const job2 = await newRenderJob();
  const [first] = (await control.poll(slots, { waitSeconds: 10 })).jobs;
  assert.equal(first.attempt, 1);
  await control.op("render.claim", { jobId: job2, attempt: 1 }, { retry: false });
  await boss.fail(first.queue, { id: first.id, retryCount: 0 }, { reason: "simulated lost worker" }); // what the supervisor does after a missed heartbeat
  await pool.query("update pgboss.job set start_after = now() where id = $1", [first.id]); // do not wait out the retry back-off
  const [second] = (await control.poll(slots, { waitSeconds: 15 })).jobs;
  assert.equal(second.id, first.id);
  assert.equal(second.attempt, 2, "the retry is attempt 2");
  assert.equal((await control.heartbeat(first.queue, first.id, 1)).ok, false, "the old attempt's lease is gone");
  assert.equal((await control.op("render.claim", { jobId: job2, attempt: 2 }, { retry: false })).input !== null, true, "the new attempt claims the domain row");
  assert.equal((await control.op("render.finish", { jobId: job2, attempt: 1, outcome: { output: { key: "old" } } })).committed, false, "the stale attempt cannot publish");
  assert.equal((await control.op("render.finish", { jobId: job2, attempt: 2, outcome: { output: { key: "new" } } })).committed, true);
  await control.complete(second.queue, second.id, 2);

  // --- runLeased: lease loss aborts the handler; a clean return acknowledges; a throw is a failure the queue retries
  const job3 = await newRenderJob();
  const [l3] = (await control.poll(slots, { waitSeconds: 10 })).jobs;
  const flaky = { ...control, heartbeat: async () => ({ ok: false, reason: "superseded" }) };
  const outcome = await runLeased(flaky, { ...l3, leaseSeconds: 6 }, (job) => new Promise((resolve, reject) => { job.signal.addEventListener("abort", () => reject(job.signal.reason), { once: true }); }));
  assert.equal(outcome, "abandoned", "a lost lease aborts the work and sends no acknowledgment");
  assert.equal(await jobState(job3), "active", "still the queue's to retry, nothing was completed behind its back");
  await boss.fail(l3.queue, { id: l3.id, retryCount: 0 }, {});
  await pool.query("update pgboss.job set start_after = now() where id = $1", [l3.id]);
  const [l3b] = (await control.poll(slots, { waitSeconds: 15 })).jobs;
  assert.equal(await runLeased(control, l3b, async () => {}), "completed");
  assert.equal(await jobState(job3), "completed");
  const job4 = await newRenderJob();
  const [l4] = (await control.poll(slots, { waitSeconds: 10 })).jobs;
  assert.equal(await runLeased(control, l4, async () => { throw new Error("boom"); }), "failed");
  assert.ok(["retry", "failed"].includes(await jobState(job4)), "a thrown handler fails the attempt so pg-boss retries it");

  // --- live-scenes + job-control seams (a)-(e)
  const seamProject = randomUUID();
  const rollbackProject = randomUUID();
  try {
    config.plates.live = true;
    config.plates.liveForceOff = false;
    await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export')");

    const desired = [0, 1, 2].map((index) => ({
      index, aspect: "16:9", signature: `v3:seam-${index}`, frames: 90, width: 1920, height: 1080, keyword: `k${index}`
    }));
    await store.reconcileVariants(seamProject, desired, { scenes: 3 });
    const vars = await store.listVariants(seamProject);
    for (const v of vars) {
      const owner = store.newOwner();
      await store.claimAuthor(v.id, v.gen, owner, 60, 10);
      await store.commitBundle(v, owner, {
        sourceKey: `plates/${seamProject}/16x9/${v.scene_index}/g1/source.ts`,
        bundleKey: `plates/${seamProject}/16x9/${v.scene_index}/g1/bundle.html`,
        manifest: { bundleSha: `seamsha0000000000000000${v.scene_index}`, engineDigest: "eng-seam" },
        timings: {}
      });
    }
    await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render')");

    // Seam (b) idle check: live project with unchecked bundled variants outside draw_aspects reports plate = 0
    const idleBefore = await control.op("demand.idle");
    assert.equal(idleBefore.plate, 0, "live variants waiting for browser check do not keep workers awake");

    // Browser check code-failure repair: commitBundle clears prior check report and gives repaired bundle a fresh digest
    const repairLiveProj = randomUUID();
    await store.reconcileVariants(repairLiveProj, [desired[0]], { scenes: 1 });
    const [repLiveVar] = await store.listVariants(repairLiveProj);
    const rlOwner1 = store.newOwner();
    await store.claimAuthor(repLiveVar.id, repLiveVar.gen, rlOwner1, 60, 10);
    await store.commitBundle(repLiveVar, rlOwner1, {
      sourceKey: `plates/${repairLiveProj}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${repairLiveProj}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "rlsha0000000000000000000", engineDigest: "eng-seam" },
      timings: {}
    });
    const rlBefore = await store.getVariant(repLiveVar.id);
    const rlFailReport = await store.submitCheckReport(rlBefore.id, {
      gen: rlBefore.gen, bundleDigest: rlBefore.bundle_digest, host: "worker",
      results: { ok: false, kind: "code", error: "Non-deterministic draw" }
    });
    assert.deepEqual(rlFailReport.body, { state: "queued", repair: true });
    const rlRepairing = await store.getVariant(repLiveVar.id);
    const rlOwner2 = store.newOwner();
    await store.claimAuthor(rlRepairing.id, rlRepairing.gen, rlOwner2, 60, 10);
    await store.commitBundle(await store.getVariant(rlRepairing.id), rlOwner2, {
      sourceKey: `plates/${repairLiveProj}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${repairLiveProj}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "rlsha0000000000000000000", engineDigest: "eng-seam" },
      timings: {}
    });
    const rlAfterRepair = await store.getVariant(repLiveVar.id);
    assert.notEqual(rlAfterRepair.bundle_digest, rlBefore.bundle_digest, "repaired bundle gets a fresh bundle_digest even when stub returns identical manifest");
    const rlPassReport = await store.submitCheckReport(rlAfterRepair.id, {
      gen: rlAfterRepair.gen, bundleDigest: rlAfterRepair.bundle_digest, host: "worker",
      results: { ok: true }
    });
    assert.deepEqual(rlPassReport.body, { state: "checked" }, "repaired bundle accepts subsequent passing check report");
    await pool.query("delete from app.plate_variants where project_id = $1", [repairLiveProj]);
    await pool.query("delete from app.plate_state where project_id = $1", [repairLiveProj]);

    // Put v0 in 'checked', v1 in 'bundled' with stage='queued for rendering' via requestVariantClip, and v2 via requestDraws
    const b0 = await store.getVariant(vars[0].id);
    await store.submitCheckReport(b0.id, { gen: b0.gen, bundleDigest: b0.bundle_digest, host: "worker", results: { ok: true } });
    assert.equal((await store.getVariant(b0.id)).state, "checked");

    const clipReq1 = await store.requestVariantClip(seamProject, vars[1].id);
    assert.equal(clipReq1.status, "ok");
    assert.equal((await store.getVariant(vars[1].id)).stage, "queued for rendering");
    assert.equal((await control.op("demand.idle")).plate, 1, "queued-for-rendering variant is counted by demand.idle");

    // Seam (a): claim v0 directly from 'checked', claim v1 from 'bundled' ('queued for rendering'), and claim v2 reached via requestDraws
    const claim0 = await control.op("plate.claim", { variantId: b0.id, gen: b0.gen }, { retry: false });
    assert.equal(claim0.row?.state, "rendering", "seam (a): variant in state 'checked' is claimable via plate.claim");
    assert.equal(claim0.row?.render_attempt, 1);

    const claim1 = await control.op("plate.claim", { variantId: vars[1].id, gen: vars[1].gen }, { retry: false });
    assert.equal(claim1.row?.state, "rendering", "seam (a): variant in 'bundled' ('queued for rendering') is claimable via plate.claim");
    assert.equal(claim1.row?.render_attempt, 1);

    // Finish v0 so project cap (2) has a free slot for v2
    assert.equal(
      (await control.op("plate.drawn", {
        id: b0.id, gen: b0.gen, renderAttempt: 1,
        clipKey: `plates/${seamProject}/16x9/0/g1/clip-a1.mp4`,
        stillKey: `plates/${seamProject}/16x9/0/g1/still-a1.mp4`,
        clipMeta: { frames: 90 }, timings: {}
      })).ok,
      true
    );

    await store.requestDraws(seamProject, ["16:9"]);
    const claim2 = await control.op("plate.claim", { variantId: vars[2].id, gen: vars[2].gen }, { retry: false });
    assert.equal(claim2.row?.state, "rendering", "seam (a): variant reached through requestDraws is claimable via plate.claim");

    // Seam (b): scenes.states reflects drawn + rendering states; worker repair re-queues plate-render on commitBundle even if draw_aspects is empty
    const statesOut = await control.op("scenes.states", { ids: vars.map((v) => v.id) });
    assert.equal(statesOut.rows.length, 3);
    assert.equal(statesOut.rows.find((r) => r.id === b0.id).state, "drawn");

    await pool.query("update app.plate_state set draw_aspects = '{}'::text[] where project_id = $1", [seamProject]);
    await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render')");
    const repairOut = await control.op("plate.sendBackForRepair", {
      id: vars[1].id, gen: vars[1].gen, renderAttempt: 1, authored: 1,
      sourceKey: `plates/${seamProject}/16x9/1/g1/source.ts`, detail: "determinism mismatch"
    });
    assert.equal(repairOut.applied, true);
    const repOwner = store.newOwner();
    await store.claimAuthor(vars[1].id, vars[1].gen, repOwner, 60, 10);
    await store.commitBundle(await store.getVariant(vars[1].id), repOwner, {
      sourceKey: `plates/${seamProject}/16x9/1/g1/source-r1.ts`,
      bundleKey: `plates/${seamProject}/16x9/1/g1/bundle-r1.html`,
      manifest: { bundleSha: "seamsha1rep0000000000000", engineDigest: "eng-seam" },
      timings: {}
    });
    assert.equal((await store.getVariant(vars[1].id)).stage, "queued for rendering", "worker-repaired variant re-enters rendering queue");

    // Seam (c): reconciler re-enqueues lost plate-render message (including stage='queued for rendering') and control.poll receives it
    await pool.query("delete from pgboss.job where name = 'plate-render'");
    await pool.query(
      "update app.plate_variants set enqueued_at = now() - interval '10 minutes', updated_at = now() - interval '10 minutes' where id = $1",
      [vars[1].id]
    );
    await reconcilePlates();
    const [reconciledLease] = (await control.poll({ "render-video": 0, "plate-render": 1, "plate-export": 0 }, { waitSeconds: 5 })).jobs;
    assert.equal(reconciledLease?.data?.variantId, vars[1].id, "seam (c): control.poll receives reconciler's re-enqueued plate-render job");
    const recClaim1 = await control.op("plate.claim", { variantId: vars[1].id, gen: vars[1].gen }, { retry: false });
    await control.op("plate.drawn", {
      id: vars[1].id, gen: vars[1].gen, renderAttempt: recClaim1.row.render_attempt,
      clipKey: `plates/${seamProject}/16x9/1/g1/clip-a2.mp4`,
      stillKey: `plates/${seamProject}/16x9/1/g1/still-a2.png`,
      clipMeta: {}, timings: {}
    });
    await control.complete(reconciledLease.queue, reconciledLease.id, reconciledLease.attempt);

    // Seam (e): fenced render_attempt survives a retry after a lost worker and fences out stale attempt
    await pool.query("update app.plate_variants set updated_at = now() - interval '10 minutes' where id = $1", [vars[2].id]);
    const retryClaim2 = await control.op("plate.claim", { variantId: vars[2].id, gen: vars[2].gen }, { retry: false });
    assert.equal(retryClaim2.row?.render_attempt, 2, "seam (e): stale rendering variant is taken over as render_attempt 2");
    assert.equal((await control.op("plate.progress", { id: vars[2].id, gen: vars[2].gen, renderAttempt: 1, stage: "rendering", framesDone: 10 })).ok, false, "stale attempt 1 cannot write progress");
    assert.equal(
      (await control.op("plate.drawn", {
        id: vars[2].id, gen: vars[2].gen, renderAttempt: 1,
        clipKey: "stale.mp4", stillKey: "stale.png", clipMeta: {}, timings: {}
      })).ok,
      false,
      "stale attempt 1 cannot publish clip"
    );
    const drawn2 = await control.op("plate.drawn", {
      id: vars[2].id, gen: vars[2].gen, renderAttempt: 2,
      clipKey: `plates/${seamProject}/16x9/2/g1/clip-a2.mp4`,
      stillKey: `plates/${seamProject}/16x9/2/g1/still-a2.png`,
      clipMeta: { attempt: 2 }, timings: {}
    });
    assert.deepEqual(drawn2, { ok: true }, "current attempt 2 publishes clip");
    const drawn2Dup = await control.op("plate.drawn", {
      id: vars[2].id, gen: vars[2].gen, renderAttempt: 2,
      clipKey: `plates/${seamProject}/16x9/2/g1/clip-a2.mp4`,
      stillKey: `plates/${seamProject}/16x9/2/g1/still-a2.png`,
      clipMeta: { attempt: 2 }, timings: {}
    });
    assert.deepEqual(drawn2Dup, { ok: true, duplicate: true }, "duplicate plate.drawn is idempotent");

    // Seam (d): PLATE_LIVE_FORCE_OFF rollback drains 'checked' variants through control-driven workers
    await store.reconcileVariants(rollbackProject, [desired[0]], { scenes: 1 });
    const [rbVar] = await store.listVariants(rollbackProject);
    const rbOwner = store.newOwner();
    await store.claimAuthor(rbVar.id, rbVar.gen, rbOwner, 60, 10);
    await store.commitBundle(rbVar, rbOwner, {
      sourceKey: `plates/${rollbackProject}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${rollbackProject}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "rbsha0000000000000000000", engineDigest: "eng-seam" },
      timings: {}
    });
    const rbBundled = await store.getVariant(rbVar.id);
    await store.submitCheckReport(rbBundled.id, { gen: rbBundled.gen, bundleDigest: rbBundled.bundle_digest, host: "worker", results: { ok: true } });
    assert.equal((await store.getVariant(rbVar.id)).state, "checked");
    await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render')");

    config.plates.liveForceOff = true;
    await reconcilePlates();
    const [rbLease] = (await control.poll({ "render-video": 0, "plate-render": 1, "plate-export": 0 }, { waitSeconds: 5 })).jobs;
    assert.equal(rbLease?.data?.variantId, rbVar.id, "seam (d): rollback enqueues plate-render consumed via control.poll");
    const rbClaim = await control.op("plate.claim", { variantId: rbVar.id, gen: rbVar.gen }, { retry: false });
    assert.equal(rbClaim.row?.state, "rendering");
    await control.op("plate.drawn", {
      id: rbVar.id, gen: rbVar.gen, renderAttempt: rbClaim.row.render_attempt,
      clipKey: `plates/${rollbackProject}/16x9/0/g1/clip-a1.mp4`,
      stillKey: `plates/${rollbackProject}/16x9/0/g1/still-a1.png`,
      clipMeta: {}, timings: {}
    });
    await control.complete(rbLease.queue, rbLease.id, rbLease.attempt);
    assert.equal((await store.getVariant(rbVar.id)).state, "drawn");
  } finally {
    config.plates.live = false;
    config.plates.liveForceOff = false;
    await pool.query("delete from app.plate_variants where project_id = any($1)", [[seamProject, rollbackProject]]);
    await pool.query("delete from app.plate_garbage where project_id = any($1)", [[seamProject, rollbackProject]]);
    await pool.query("delete from app.plate_state where project_id = any($1)", [[seamProject, rollbackProject]]);
    await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export')");
  }

  // --- the point of it all: serving every call above took no more database clients than the API's own pool allows
  assert.ok(poolClients() <= Number(process.env.DATABASE_POOL_SIZE ?? 10), `API pool stays within its budget (${poolClients()})`);
  console.log("job-control: ok");
} finally {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 }).catch(() => undefined);
  await pool.end();
}
