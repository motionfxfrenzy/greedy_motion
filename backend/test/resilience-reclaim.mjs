// Backend resilience suite (Requirements 1, 2, 4, 5, 6):
//   1. sendOnce transactional deduplication (concurrent racers, startAfter, post-completion, new gen, repair rev key)
//   2. No double-paid scene writes (claimAuthor expired-lease takeover counter restartsDuringWrite, 4th takeover failure, clean release)
//   3. Watchdog + retry accounting (timings.retrying reasons/attempts, PLATE_MAX_SWEEP_RETRIES=4 -> scene_stalled, clearing on claim/drawn/checked)
//   4. Dead worker reclaim via pg-boss supervise (scratch queue heartbeatSeconds=10 + plate-render retryCount fencing on heartbeat/complete/fail + duplicate plate.claim)
//   5. Launcher tasksToStart ("demand > 0, running 0 -> starts a task")
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_resil node --experimental-strip-types test/resilience-reclaim.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, quietBoss, startQueues, QUEUES, sendOnce } = await import("../src/jobs/queues.ts");
const { operations, registerJobControlRoutes } = await import("../src/jobs/control.ts");
const { tasksToStart } = await import("../src/jobs/worker-launcher.ts");
const store = await import("../src/plates/store.ts");
const { PLATE_MAX_SWEEP_RETRIES, reconcilePlates } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const TOKEN = "r".repeat(32);
const app = Fastify();
await registerJobControlRoutes(app, TOKEN);
await app.listen({ port: 0, host: "127.0.0.1" });
const baseUrl = `http://127.0.0.1:${app.server.address().port}`;

const postControl = async (path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
};

const trackedProjects = [];
const newProject = () => {
  const id = randomUUID();
  trackedProjects.push(id);
  return id;
};
const scratchQueues = [];

const withTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  PASS: ${name}`);
};

try {
  // ------------------------------------------------------------------
  // 0. Queue config & quietBoss verification
  // ------------------------------------------------------------------
  await check("0. quietBoss.superviseIntervalSeconds is 30 and queues preserve heartbeatSeconds=30 on updateQueue", async () => {
    assert.equal(quietBoss.superviseIntervalSeconds, 30);
    for (const qName of [QUEUES.plateAuthor, QUEUES.plateRender, QUEUES.plateExport, QUEUES.plateRebundle, QUEUES.video]) {
      const q = await boss.getQueue(qName);
      assert.equal(q?.heartbeatSeconds, 30, `queue ${qName} has heartbeatSeconds=30`);
    }
  });

  // ------------------------------------------------------------------
  // 1. sendOnce deduplication (Requirement 1)
  // ------------------------------------------------------------------
  await check("1a. sendOnce: N=8 concurrent enqueues for one key leave exactly one job", async () => {
    const vId = randomUUID();
    const key = `${vId}:1`;
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          withTx((client) => sendOnce(client, QUEUES.plateAuthor, { variantId: vId, gen: 1 }, key))
        )
      );
      const nonNull = results.filter((id) => typeof id === "string" && id.length > 0);
      assert.equal(nonNull.length, 1, "only 1 of 8 concurrent callers created a job");
      const countRes = await pool.query(
        "select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2",
        [QUEUES.plateAuthor, key]
      );
      assert.equal(countRes.rows[0].n, 1, "exactly 1 row in pgboss.job for singleton_key");

      // Second send after completion IS allowed
      await pool.query("update pgboss.job set state = 'completed' where id = $1", [nonNull[0]]);
      const afterCompleteId = await withTx((client) =>
        sendOnce(client, QUEUES.plateAuthor, { variantId: vId, gen: 1 }, key)
      );
      assert.ok(afterCompleteId, "second send after completion succeeds");
      assert.notEqual(afterCompleteId, nonNull[0]);

      // Different gen is allowed while gen 1 is active/created
      const gen2Id = await withTx((client) =>
        sendOnce(client, QUEUES.plateAuthor, { variantId: vId, gen: 2 }, `${vId}:2`)
      );
      assert.ok(gen2Id, "different gen is allowed");
    } finally {
      await pool.query("delete from pgboss.job where name = $1 and data->>'variantId' = $2", [QUEUES.plateAuthor, vId]);
    }
  });

  await check("1b. sendOnce: startAfter job in state='created' blocks duplicate send, and repair key includes :r<rev>", async () => {
    const proj = newProject();
    await store.reconcileVariants(
      proj,
      [{ index: 0, aspect: "16:9", signature: "v3:s0", frames: 90, width: 1920, height: 1080, keyword: "k0" }],
      { scenes: 1 }
    );
    const [v] = await store.listVariants(proj);

    // plate.sendLater uses sendOnce with startAfter; calling twice leaves 1 job
    await operations["plate.sendLater"]({ variantId: v.id, gen: v.gen, startAfter: 60 });
    await operations["plate.sendLater"]({ variantId: v.id, gen: v.gen, startAfter: 60 });
    const renderCount = await pool.query(
      "select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2",
      [QUEUES.plateRender, `${v.id}:${v.gen}`]
    );
    assert.equal(renderCount.rows[0].n, 1, "startAfter send in 'created' blocks second sendLater");

    // Repair send: initial plate-author job (${v.id}:${v.gen}) is still in 'created', yet sendBackForRepair
    // enqueues with key `${v.id}:${v.gen}:r1` so the legitimate repair is queued while duplicate repair is blocked
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.noteAuthorCall(v.id, v.gen, owner, { authorMs: 5 });
    await store.commitBundle(v, owner, {
      sourceKey: `plates/${proj}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${proj}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "rep000000000000000000000", engineDigest: "e1" },
      timings: {}
    });
    const claim = await operations["plate.claim"]({ variantId: v.id, gen: v.gen });
    assert.equal(claim.row.render_attempt, 1);

    const rep = await operations["plate.sendBackForRepair"]({
      id: v.id,
      gen: v.gen,
      renderAttempt: 1,
      authored: 1,
      sourceKey: `plates/${proj}/16x9/0/g1/source.ts`,
      detail: "syntax error in scene"
    });
    assert.equal(rep.applied, true);
    assert.equal(rep.rev, 1);

    const repairJobs = await pool.query(
      "select singleton_key from pgboss.job where name = $1 and data->>'variantId' = $2 order by created_on asc",
      [QUEUES.plateAuthor, v.id]
    );
    assert.deepEqual(
      repairJobs.rows.map((r) => r.singleton_key),
      [`${v.id}:${v.gen}`, `${v.id}:${v.gen}:r1`],
      "repair job uses singleton_key ${id}:${gen}:r${rev}"
    );
  });

  // ------------------------------------------------------------------
  // 2. No double-paid scene writes (Requirement 2)
  // ------------------------------------------------------------------
  await check("2. claimAuthor: expired-lease takeover increments restartsDuringWrite, 4th takeover fails with author_restarts, clean release does not count, clears timings.retrying", async () => {
    assert.equal(store.PLATE_MAX_WRITE_RESTARTS, 3, "default PLATE_MAX_WRITE_RESTARTS is 3");
    const proj = newProject();
    await store.reconcileVariants(
      proj,
      [{ index: 0, aspect: "16:9", signature: "v3:w0", frames: 90, width: 1920, height: 1080, keyword: "k0" }],
      { scenes: 1 }
    );
    const [v] = await store.listVariants(proj);

    // Seed a timings.retrying marker before first claim to verify claimAuthor clears it
    await pool.query(
      `update app.plate_variants set timings = jsonb_build_object('retrying', jsonb_build_object('attempt', 2, 'reason', 'the scene was waiting for a worker', 'at', 1000)) where id = $1`,
      [v.id]
    );

    // Initial claim from 'queued' -> restartsDuringWrite is undefined, timings.retrying is cleared
    const owner0 = store.newOwner();
    const claimed0 = await store.claimAuthor(v.id, v.gen, owner0, 60, 10);
    assert.ok(claimed0, "initial claim succeeds");
    assert.equal(claimed0.timings?.retrying, undefined, "claimAuthor clears timings.retrying");
    assert.equal(claimed0.timings?.restartsDuringWrite, undefined, "initial claim from queued does not increment restartsDuringWrite");

    // Clean release (releaseAuthor -> state='queued') and re-claim -> still does not increment restartsDuringWrite
    await store.releaseAuthor(v.id, v.gen, owner0, "waiting for primary ratio");
    const ownerClean = store.newOwner();
    const claimedClean = await store.claimAuthor(v.id, v.gen, ownerClean, 60, 10);
    assert.ok(claimedClean, "claim after clean release succeeds");
    assert.equal(claimedClean.timings?.restartsDuringWrite, undefined, "clean release does not count as restart during write");

    // Expired lease takeovers 1, 2, 3 increment restartsDuringWrite to 1, 2, 3
    for (let expectedRestart = 1; expectedRestart <= 3; expectedRestart++) {
      await pool.query(
        `update app.plate_variants
            set author_until = now() - interval '10 seconds',
                timings = timings || jsonb_build_object('retrying', jsonb_build_object('attempt', 1, 'reason', 'the writing process restarted', 'at', 2000))
          where id = $1`,
        [v.id]
      );
      const nextOwner = store.newOwner();
      const taken = await store.claimAuthor(v.id, v.gen, nextOwner, 60, 10);
      assert.ok(taken, `takeover #${expectedRestart} succeeds`);
      assert.equal(taken.timings?.restartsDuringWrite, expectedRestart, `takeover #${expectedRestart} sets restartsDuringWrite=${expectedRestart}`);
      assert.equal(taken.timings?.retrying, undefined, `takeover #${expectedRestart} clears timings.retrying`);
    }

    // 4th expired-lease takeover (restartsDuringWrite is already 3 >= PLATE_MAX_WRITE_RESTARTS):
    // must NOT claim, must return null, and must mark row failed with code='author_restarts'
    await pool.query("update app.plate_variants set author_until = now() - interval '10 seconds' where id = $1", [v.id]);
    const fourthOwner = store.newOwner();
    const fourthClaim = await store.claimAuthor(v.id, v.gen, fourthOwner, 60, 10);
    assert.equal(fourthClaim, null, "4th takeover returns null");

    const failedRow = await store.getVariant(v.id);
    assert.equal(failedRow.state, "failed");
    assert.equal(failedRow.stage, null);
    assert.equal(failedRow.author_owner, null);
    assert.equal(failedRow.author_until, null);
    assert.deepEqual(failedRow.error, {
      code: "author_restarts",
      message: "This scene's drawing was interrupted several times. Press Draw to try again."
    });
  });

  // ------------------------------------------------------------------
  // 3. Watchdog + retry accounting for plate rows (Requirement 4)
  // ------------------------------------------------------------------
  await check("3a. Watchdog reasons for authoring, rendering, and queued/bundled, and clearing on plate.claim / plate.drawn / submitCheckReport", async () => {
    assert.equal(PLATE_MAX_SWEEP_RETRIES, 4, "default PLATE_MAX_SWEEP_RETRIES is 4");
    const proj = newProject();
    config.plates.live = false;
    await store.reconcileVariants(
      proj,
      [0, 1, 2].map((index) => ({
        index,
        aspect: "16:9",
        signature: `v3:wd-${index}`,
        frames: 90,
        width: 1920,
        height: 1080,
        keyword: `k${index}`
      })),
      { scenes: 3 }
    );
    const [vQueued, vAuthoring, vRendering] = await store.listVariants(proj);

    // Put vAuthoring in authoring with expired lease
    const authOwner = store.newOwner();
    await store.claimAuthor(vAuthoring.id, vAuthoring.gen, authOwner, 60, 10);
    await pool.query(
      "update app.plate_variants set author_until = now() - interval '10 seconds', enqueued_at = now() - interval '2 minutes' where id = $1",
      [vAuthoring.id]
    );

    // Put vRendering in rendering with stale updated_at
    await pool.query(
      `update app.plate_variants
          set state = 'rendering', stage = 'rendering', render_attempt = 1,
              bundle_key = 'plates/x/b.html', bundle_digest = 'd1',
              enqueued_at = now() - interval '2 minutes', updated_at = now() - interval '2 minutes'
        where id = $1`,
      [vRendering.id]
    );

    // Age vQueued past RESEND_AFTER
    await pool.query(
      "update app.plate_variants set enqueued_at = now() - interval '2 minutes', updated_at = now() - interval '2 minutes' where id = $1",
      [vQueued.id]
    );

    await reconcilePlates();

    const afterQueued = await store.getVariant(vQueued.id);
    const afterAuthoring = await store.getVariant(vAuthoring.id);
    const afterRendering = await store.getVariant(vRendering.id);

    assert.equal(afterQueued.timings?.retrying, undefined, "a scene queued for its author slot is resent quietly, not marked retrying");

    assert.equal(afterAuthoring.timings?.retrying?.attempt, 1);
    assert.equal(afterAuthoring.timings?.retrying?.reason, "the writing process restarted");

    assert.equal(afterRendering.timings?.retrying?.attempt, 1);
    assert.equal(afterRendering.timings?.retrying?.reason, "the drawing worker restarted");

    // Claiming vRendering again via plate.claim clears timings.retrying
    const claimedRender = await operations["plate.claim"]({ variantId: vRendering.id, gen: vRendering.gen });
    assert.equal(claimedRender.row?.render_attempt, 2);
    assert.equal(claimedRender.row?.timings?.retrying, undefined, "plate.claim clears timings.retrying");

    // Seed timings.retrying again and verify plate.drawn clears it too
    await pool.query(
      `update app.plate_variants set timings = timings || jsonb_build_object('retrying', jsonb_build_object('attempt', 2, 'reason', 'the drawing worker restarted', 'at', 123)) where id = $1`,
      [vRendering.id]
    );
    const drawnOut = await operations["plate.drawn"]({
      id: vRendering.id,
      gen: vRendering.gen,
      renderAttempt: 2,
      clipKey: `plates/${proj}/16x9/2/g1/clip.mp4`,
      stillKey: `plates/${proj}/16x9/2/g1/still.png`,
      clipMeta: {},
      timings: { renderMs: 500 }
    });
    assert.equal(drawnOut.ok, true);
    const drawnRow = await store.getVariant(vRendering.id);
    assert.equal(drawnRow.state, "drawn");
    assert.equal(drawnRow.timings?.retrying, undefined, "plate.drawn clears timings.retrying");
    assert.equal(drawnRow.timings?.renderMs, 500);

    // Verify submitCheckReport (state -> 'checked') clears timings.retrying on a live project
    const liveProj = newProject();
    config.plates.live = true;
    await store.reconcileVariants(
      liveProj,
      [{ index: 0, aspect: "16:9", signature: "v3:live-clr", frames: 90, width: 1920, height: 1080, keyword: "k0" }],
      { scenes: 1 }
    );
    const [liveV] = await store.listVariants(liveProj);
    const liveOw = store.newOwner();
    await store.claimAuthor(liveV.id, liveV.gen, liveOw, 60, 10);
    await store.commitBundle(liveV, liveOw, {
      sourceKey: `plates/${liveProj}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${liveProj}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "clrsha000000000000000000", engineDigest: "e1" },
      timings: {}
    });
    await pool.query(
      `update app.plate_variants set timings = timings || jsonb_build_object('retrying', jsonb_build_object('attempt', 1, 'reason', 'test', 'at', 1)) where id = $1`,
      [liveV.id]
    );
    const bundledLive = await store.getVariant(liveV.id);
    const checkOut = await store.submitCheckReport(bundledLive.id, {
      gen: bundledLive.gen,
      bundleDigest: bundledLive.bundle_digest,
      host: "worker",
      results: { ok: true }
    });
    assert.equal(checkOut.status, "ok");
    const checkedLive = await store.getVariant(liveV.id);
    assert.equal(checkedLive.state, "checked");
    assert.equal(checkedLive.timings?.retrying, undefined, "submitCheckReport clears timings.retrying when moving to checked");
    config.plates.live = false;
  });

  await check("3b. A scene that lost its worker (rendering, no progress) fails with scene_stalled after 4 sweep resends; one merely waiting never fails", async () => {
    const proj = newProject();
    config.plates.live = false;
    await store.reconcileVariants(
      proj,
      [
        { index: 0, aspect: "16:9", signature: "v3:stall-0", frames: 90, width: 1920, height: 1080, keyword: "k0" },
        { index: 1, aspect: "16:9", signature: "v3:stall-1", frames: 90, width: 1920, height: 1080, keyword: "k1" }
      ],
      { scenes: 2 }
    );
    const [v, waiting] = await store.listVariants(proj);
    // v: a render attempt whose worker died (rendering, no progress); waiting: still queued for its author slot.
    await pool.query("update app.plate_variants set state = 'rendering', stage = 'drawing', render_attempt = 1 where id = $1", [v.id]);

    for (let expectedAttempt = 1; expectedAttempt <= 4; expectedAttempt++) {
      await pool.query("update app.plate_variants set enqueued_at = now() - interval '2 minutes', updated_at = now() - interval '2 minutes' where id = any($1)", [[v.id, waiting.id]]);
      await reconcilePlates();
      const row = await store.getVariant(v.id);
      assert.equal(row.state, "rendering", `still rendering on sweep resend #${expectedAttempt}`);
      assert.equal(row.timings?.retrying?.attempt, expectedAttempt, `attempt is ${expectedAttempt}`);
      assert.equal(row.timings?.retrying?.reason, "the drawing worker restarted");
    }
    const jobCount = await pool.query("select count(*)::int as n from pgboss.job where name = $1 and data->>'variantId' = $2", [QUEUES.plateRender, v.id]);
    assert.equal(jobCount.rows[0].n, 1, "sendOnce kept at most 1 render job across all 4 sweep resends");

    await pool.query("update app.plate_variants set enqueued_at = now() - interval '2 minutes', updated_at = now() - interval '2 minutes' where id = any($1)", [[v.id, waiting.id]]);
    await reconcilePlates();
    const stalled = await store.getVariant(v.id);
    assert.equal(stalled.state, "failed");
    assert.equal(stalled.stage, null);
    assert.equal(stalled.timings?.retrying, undefined, "stalled transition clears timings.retrying");
    assert.deepEqual(stalled.error, { code: "scene_stalled", message: "This scene stopped making progress. Press Draw to try again." });

    // The scene that only waited for its turn was resent every sweep and is still queued: waiting never fails a scene.
    for (let i = 0; i < 6; i++) {
      await pool.query("update app.plate_variants set enqueued_at = now() - interval '2 minutes' where id = $1", [waiting.id]);
      await reconcilePlates();
    }
    assert.equal((await store.getVariant(waiting.id)).state, "queued", "a scene waiting its turn is never failed by the sweep");
    const authorJobs = await pool.query("select count(*)::int as n from pgboss.job where name = $1 and data->>'variantId' = $2", [QUEUES.plateAuthor, waiting.id]);
    assert.equal(authorJobs.rows[0].n, 1, "still exactly one author job for the waiting scene");
  });

  // ------------------------------------------------------------------
  // 4. Dead worker reclaim, proven (Requirement 5)
  // ------------------------------------------------------------------
  await check("4a. Scratch queue with heartbeatSeconds=10: job left without heartbeats is reclaimed by boss.supervise()", async () => {
    const scratchQueue = `reclaim-scratch-${Date.now()}`;
    scratchQueues.push(scratchQueue);
    await boss.createQueue(scratchQueue, {
      retryLimit: 2,
      retryDelay: 1,
      expireInSeconds: 600,
      heartbeatSeconds: 10
    });

    const jobId = await boss.send(scratchQueue, { test: "reclaim" });
    assert.ok(jobId, "sent job to scratch queue");

    const [fetched1] = await boss.fetch(scratchQueue);
    assert.equal(fetched1.id, jobId);
    assert.equal(fetched1.retryCount, 0);

    // Simulate missed heartbeats past heartbeatSeconds (10 s)
    await pool.query(
      "update pgboss.job set heartbeat_on = now() - interval '15 seconds' where id = $1",
      [jobId]
    );
    const expiredCheck = await pool.query(
      "select (heartbeat_on + heartbeat_seconds * interval '1 second') < now() as expired from pgboss.job where id = $1",
      [jobId]
    );
    assert.equal(expiredCheck.rows[0].expired, true, "SQL condition heartbeat_on + heartbeat_seconds < now() holds");

    // Ensure queue is due for monitor pass and run boss.supervise(scratchQueue)
    await pool.query("update pgboss.queue set monitor_claim_on = null, monitor_on = null where name = $1", [scratchQueue]);
    await boss.supervise(scratchQueue);

    const afterSupervise = await pool.query("select state, retry_count from pgboss.job where id = $1", [jobId]);
    assert.equal(afterSupervise.rows[0].state, "retry", "supervise moved silent active job to 'retry'");

    // Advance start_after so the retry is immediately fetchable by the next worker
    await pool.query("update pgboss.job set start_after = now() where id = $1", [jobId]);
    const [fetched2] = await boss.fetch(scratchQueue);
    assert.equal(fetched2?.id, jobId, "reclaimed job is fetched again");
    assert.equal(fetched2?.retryCount, 1, "re-fetched job has retryCount = 1 (attempt 2)");
  });

  await check("4b. Late complete / fail / heartbeat from old attempt through /internal/worker/jobs/... is rejected after retry started", async () => {
    const proj = newProject();
    config.plates.live = false;
    await store.reconcileVariants(
      proj,
      [{ index: 0, aspect: "16:9", signature: "v3:fenced-ack", frames: 90, width: 1920, height: 1080, keyword: "k0" }],
      { scenes: 1 }
    );
    const [v] = await store.listVariants(proj);
    const ow = store.newOwner();
    await store.claimAuthor(v.id, v.gen, ow, 60, 10);
    await store.commitBundle(v, ow, {
      sourceKey: `plates/${proj}/16x9/0/g1/source.ts`,
      bundleKey: `plates/${proj}/16x9/0/g1/bundle.html`,
      manifest: { bundleSha: "acksha000000000000000000", engineDigest: "e1" },
      timings: {}
    });

    // Clear any unrelated plate-render jobs so poll deterministically gets our job
    await pool.query("delete from pgboss.job where name = $1 and data->>'variantId' <> $2", [QUEUES.plateRender, v.id]);

    // Worker 1 polls and gets attempt 1
    const poll1 = await postControl("/internal/worker/poll", {
      workerId: randomUUID(),
      slots: { "plate-render": 1 },
      waitSeconds: 5
    });
    assert.equal(poll1.status, 200);
    assert.equal(poll1.body.jobs.length, 1);
    const lease1 = poll1.body.jobs[0];
    assert.equal(lease1.attempt, 1);
    assert.equal(lease1.data.variantId, v.id);

    // Worker 1 goes silent: expire heartbeat_on and run pg-boss supervise on plate-render
    await pool.query("update pgboss.job set heartbeat_on = now() - interval '45 seconds' where id = $1", [lease1.id]);
    await pool.query("update pgboss.queue set monitor_claim_on = null, monitor_on = null where name = $1", [QUEUES.plateRender]);
    await boss.supervise(QUEUES.plateRender);
    await pool.query("update pgboss.job set start_after = now() where id = $1", [lease1.id]);

    // Worker 2 polls and gets attempt 2
    const poll2 = await postControl("/internal/worker/poll", {
      workerId: randomUUID(),
      slots: { "plate-render": 1 },
      waitSeconds: 5
    });
    assert.equal(poll2.status, 200);
    assert.equal(poll2.body.jobs.length, 1);
    const lease2 = poll2.body.jobs[0];
    assert.equal(lease2.id, lease1.id);
    assert.equal(lease2.attempt, 2, "Worker 2 receives attempt 2");

    // Late heartbeat, complete, and fail from old attempt 1 must all be rejected (fenced by retryCount)
    const lateHb = await postControl(`/internal/worker/jobs/${QUEUES.plateRender}/${lease1.id}/heartbeat`, { attempt: 1 });
    assert.equal(lateHb.status, 200);
    assert.equal(lateHb.body.ok, false, "late heartbeat from attempt 1 is rejected (ok: false)");
    assert.equal(lateHb.body.reason, "superseded");

    const lateComplete = await postControl(`/internal/worker/jobs/${QUEUES.plateRender}/${lease1.id}/complete`, { attempt: 1 });
    assert.equal(lateComplete.status, 200);
    assert.equal(lateComplete.body.applied, false, "late complete from attempt 1 is rejected (applied: false)");

    const lateFail = await postControl(`/internal/worker/jobs/${QUEUES.plateRender}/${lease1.id}/fail`, {
      attempt: 1,
      reason: "late failure from dead worker"
    });
    assert.equal(lateFail.status, 200);
    assert.equal(lateFail.body.applied, false, "late fail from attempt 1 is rejected (applied: false)");

    // Meanwhile attempt 2 is still active in pgboss.job and can heartbeat and complete normally
    const jobStillActive = await pool.query("select state, retry_count from pgboss.job where id = $1", [lease2.id]);
    assert.equal(jobStillActive.rows[0].state, "active");
    assert.equal(jobStillActive.rows[0].retry_count, 1);

    const validHb = await postControl(`/internal/worker/jobs/${QUEUES.plateRender}/${lease2.id}/heartbeat`, { attempt: 2 });
    assert.deepEqual(validHb.body, { ok: true });

    const validComplete = await postControl(`/internal/worker/jobs/${QUEUES.plateRender}/${lease2.id}/complete`, { attempt: 2 });
    assert.deepEqual(validComplete.body, { ok: true, applied: true });
  });

  await check("4c. Duplicate delivery: plate.claim twice for the same (variant, gen) only succeeds once (second returns row null)", async () => {
    const proj = newProject();
    config.plates.live = false;
    await store.reconcileVariants(
      proj,
      [
        { index: 0, aspect: "16:9", signature: "v3:dup-0", frames: 90, width: 1920, height: 1080, keyword: "k0" },
        { index: 1, aspect: "16:9", signature: "v3:dup-1", frames: 90, width: 1920, height: 1080, keyword: "k1" }
      ],
      { scenes: 2 }
    );
    const [vSeq, vConc] = await store.listVariants(proj);
    for (const v of [vSeq, vConc]) {
      const ow = store.newOwner();
      await store.claimAuthor(v.id, v.gen, ow, 60, 10);
      await store.commitBundle(v, ow, {
        sourceKey: `plates/${proj}/16x9/${v.scene_index}/g1/source.ts`,
        bundleKey: `plates/${proj}/16x9/${v.scene_index}/g1/bundle.html`,
        manifest: { bundleSha: `dupsha00000000000000000${v.scene_index}`, engineDigest: "e1" },
        timings: {}
      });
    }

    // Sequential duplicate claim
    const first = await operations["plate.claim"]({ variantId: vSeq.id, gen: vSeq.gen });
    const second = await operations["plate.claim"]({ variantId: vSeq.id, gen: vSeq.gen });
    assert.ok(first.row, "first plate.claim succeeds");
    assert.equal(first.row.state, "rendering");
    assert.equal(first.row.render_attempt, 1);
    assert.equal(second.row, null, "second sequential plate.claim returns row: null");

    // Release vSeq slot by marking drawn so project cap (2) doesn't interfere with vConc race
    await operations["plate.drawn"]({
      id: vSeq.id,
      gen: vSeq.gen,
      renderAttempt: 1,
      clipKey: "plates/x/c.mp4",
      stillKey: "plates/x/s.png",
      clipMeta: {},
      timings: {}
    });

    // Concurrent duplicate claim
    const [c1, c2] = await Promise.all([
      operations["plate.claim"]({ variantId: vConc.id, gen: vConc.gen }),
      operations["plate.claim"]({ variantId: vConc.id, gen: vConc.gen })
    ]);
    const winners = [c1.row, c2.row].filter(Boolean);
    const losers = [c1.row, c2.row].filter((r) => r === null);
    assert.equal(winners.length, 1, "exactly one concurrent plate.claim wins");
    assert.equal(losers.length, 1, "the other concurrent plate.claim gets row: null");
  });

  // ------------------------------------------------------------------
  // 5. Launcher / supervision unit test (Requirement 6)
  // ------------------------------------------------------------------
  await check("5. Launcher supervision: demand > 0, running 0 -> starts a task (tasksToStart)", async () => {
    assert.equal(tasksToStart(1, 0, 2, 3), 1, "demand=1, running=0 -> starts 1 task");
    assert.equal(tasksToStart(2, 0, 2, 3), 1, "demand=2, running=0, perTask=2 -> starts 1 task");
    assert.equal(tasksToStart(4, 0, 2, 3), 2, "demand=4, running=0, perTask=2 -> starts 2 tasks");
    assert.equal(tasksToStart(0, 0, 2, 3), 0, "demand=0, running=0 -> starts 0 tasks");
  });

  console.log(`resilience-reclaim: ok (${passed} test blocks passed)`);
} finally {
  config.plates.live = false;
  config.plates.liveForceOff = false;
  await app.close();
  for (const sq of scratchQueues) {
    await boss.deleteQueue(sq).catch(() => undefined);
  }
  if (trackedProjects.length > 0) {
    const vIds = (
      await pool.query("select id::text as id from app.plate_variants where project_id = any($1)", [trackedProjects])
    ).rows.map((r) => r.id);
    await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [vIds]);
    await pool.query("delete from app.plate_variants where project_id = any($1)", [trackedProjects]);
    await pool.query("delete from app.plate_garbage where project_id = any($1)", [trackedProjects]);
    await pool.query("delete from app.plate_state where project_id = any($1)", [trackedProjects]);
  }
  await boss.stop({ graceful: false, timeout: 2000 }).catch(() => undefined);
  await pool.end();
}
