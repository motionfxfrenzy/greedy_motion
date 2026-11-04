// Job control against a real Postgres + pg-boss, with the worker's real client: bounded long polls, leases, fencing across
// attempts, idempotent completion, stale heartbeats, authorisation, and "the worker opens no database connection".
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types backend/test/job-control.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_unit|test/.test(process.env.DATABASE_URL ?? "")) throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues, QUEUES } = await import("../src/jobs/queues.ts");
const { registerJobControlRoutes, waitingWorkers } = await import("../src/jobs/control.ts");
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

  // --- the point of it all: serving every call above took no more database clients than the API's own pool allows
  assert.ok(poolClients() <= Number(process.env.DATABASE_POOL_SIZE ?? 10), `API pool stays within its budget (${poolClients()})`);
  console.log("job-control: ok");
} finally {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 }).catch(() => undefined);
  await pool.end();
}
