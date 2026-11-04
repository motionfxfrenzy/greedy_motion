// Step 3: Load test and limits for job control on the local stack.
// Simulates W = 10, 25, 50, 100 workers using the real worker control client (worker/src/control.mjs)
// with stub handlers that hold leases for a few seconds, while U = 20, 100, 200 req/s of ordinary read
// routes (GET /v1/projects/:id/plates) hit the API.
//   node tools/phase2/job-control/load.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API, api, log, now, pool, resetStub, seedProject, sleep, waitFor } from "../../../scripts/plates-e2e/lib.mjs";
import { consume, createControl, runLeased } from "../../../worker/src/control.mjs";
import { QUEUES, claim, finish, progress } from "../../../worker/src/jobs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const CONTROL_TOKEN = "plates-e2e-control-token-0123456789";

const WORKER_COUNTS = [10, 25, 50, 100];
const USER_RPS_LEVELS = [20, 100, 200];
const STEP_DURATION_MS = 10_000;
const LEASE_HOLD_MS = 2_000;

function composeLive(...args) {
  return execFileSync(
    "docker",
    ["compose", "-f", "compose.yaml", "-f", "tools/phase2/e2e/compose.live.yaml", "--profile", "plates-e2e", ...args],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

function summarizeLatencies(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    count: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s.length ? Math.round(s[s.length - 1] * 10) / 10 : 0
  };
}

async function seedBatchRenderJobs(projectId, count) {
  if (count <= 0) return;
  const ids = Array.from({ length: count }, () => randomUUID());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO app.render_jobs (id, project_id, state, stage, progress, attempt, request, revision, render_input, render_queued_at)
       SELECT u.id, $1, 'rendering', 'queued', 0, 0, '{}'::jsonb, '{}'::jsonb, jsonb_build_object('id', u.id, 'template', 'load-stub'), now()
         FROM unnest($2::uuid[]) AS u(id)`,
      [projectId, ids]
    );
    await client.query(
      `INSERT INTO pgboss.job (name, data, state, retry_limit, expire_seconds, heartbeat_seconds)
       SELECT 'render-video', jsonb_build_object('jobId', u.id::text), 'created', 2, 1200, 30
         FROM unnest($1::uuid[]) AS u(id)`,
      [ids]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function runStep(W, U, projectId) {
  // Clean queues before each step and pre-seed enough jobs so workers always have work ready
  await pool.query("DELETE FROM pgboss.job WHERE name IN ('render-video', 'render-finished', 'plate-render', 'plate-export')");
  await pool.query("TRUNCATE TABLE app.render_jobs");
  const initialJobs = Math.max(W * 6, 120);
  await seedBatchRenderJobs(projectId, initialJobs);

  const controlOpLatencies = [];
  const controlPollLatencies = [];
  const ordinaryLatencies = [];
  let control5xx = 0;
  let ordinary5xx = 0;
  let ordinaryTotal = 0;
  let jobsCompleted = 0;

  // Reset API event-loop lag histogram at start of step
  const adminControl = createControl({ url: API, token: CONTROL_TOKEN });
  await adminControl.op("demand.idle").catch(() => null);

  const stop = new AbortController();
  const stepStart = now();

  // Feeder: top up render-video jobs if queued count drops below W * 2
  const feederPromise = (async () => {
    while (!stop.signal.aborted) {
      await sleep(1000);
      if (stop.signal.aborted) break;
      try {
        const r = await pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'render-video' AND state = 'created'");
        if ((r.rows[0]?.n ?? 0) < W * 2) {
          await seedBatchRenderJobs(projectId, W * 3);
        }
      } catch {}
    }
  })();

  // DB connection & pool sampler
  let maxApiDbConns = 0;
  let maxPoolTotal = 0;
  let maxPoolWaiting = 0;
  const lagP50Samples = [];
  const lagP95Samples = [];
  let maxLagMs = 0;

  const samplerPromise = (async () => {
    while (!stop.signal.aborted) {
      await sleep(1000);
      if (stop.signal.aborted) break;
      try {
        const [statRes, idleRes] = await Promise.all([
          pool.query(
            `SELECT client_addr::text AS ip, application_name, state
               FROM pg_stat_activity
              WHERE datname = 'plates_e2e' AND pid <> pg_backend_pid()`
          ),
          adminControl.op("demand.idle").catch(() => null)
        ]);
        const apiConns = statRes.rows.filter((r) => r.ip && !r.ip.endsWith(".0.1")).length;
        if (apiConns > maxApiDbConns) maxApiDbConns = apiConns;
        if (idleRes?.pool) {
          if (idleRes.pool.total > maxPoolTotal) maxPoolTotal = idleRes.pool.total;
          if (idleRes.pool.waiting > maxPoolWaiting) maxPoolWaiting = idleRes.pool.waiting;
        }
        if (idleRes?.lagMs) {
          lagP50Samples.push(idleRes.lagMs.p50);
          lagP95Samples.push(idleRes.lagMs.p95);
          if (idleRes.lagMs.max > maxLagMs) maxLagMs = idleRes.lagMs.max;
        }
      } catch {}
    }
  })();

  // Start W simulated workers using the real worker control client (worker/src/control.mjs)
  const workerPromises = Array.from({ length: W }, (_, idx) => {
    let leasedCount = 0;
    const inFlight = new Set();

    const customFetch = async (url, init) => {
      const t0 = performance.now();
      const res = await fetch(url, init);
      const dt = performance.now() - t0;
      if (res.status >= 500) control5xx++;
      if (!stop.signal.aborted) {
        if (String(url).endsWith("/internal/worker/poll")) {
          controlPollLatencies.push(dt);
        } else {
          controlOpLatencies.push(dt);
        }
      }
      return res;
    };

    const ctrl = createControl({ url: API, token: CONTROL_TOKEN, fetchImpl: customFetch });

    const handler = async (job) => {
      const { jobId } = job.data ?? {};
      const attempt = job.retryCount + 1;
      const input = await claim(ctrl, jobId, attempt);
      if (!input) return;
      // Hold lease for ~2 seconds while sending a progress write mid-lease
      await sleep(Math.floor(LEASE_HOLD_MS / 2));
      if (job.signal.aborted || stop.signal.aborted) return;
      await progress(ctrl, jobId, attempt, { stage: "frames", progress: 65, framesDone: 45, framesTotal: 90 });
      await sleep(Math.floor(LEASE_HOLD_MS / 2));
      if (job.signal.aborted || stop.signal.aborted) return;
      const committed = await finish(ctrl, jobId, attempt, {
        outcome: { output: { key: `renders/${jobId}/a${attempt}.mp4`, format: "mp4" } }
      });
      if (committed && !stop.signal.aborted) {
        jobsCompleted++;
      }
    };

    return (async () => {
      // Stagger initial poll slightly across 200ms to avoid artificial 0ms lockstep
      await sleep((idx % 10) * 20);
      await consume(ctrl, {
        stop: stop.signal,
        slots: () => (stop.signal.aborted ? {} : { [QUEUES.video]: Math.max(0, 1 - leasedCount), "plate-render": 0, "plate-export": 0 }),
        onJob: (lease) => {
          leasedCount += 1;
          const p = runLeased(ctrl, lease, handler, { shutdown: stop.signal })
            .catch(() => {})
            .finally(() => {
              leasedCount -= 1;
              inFlight.delete(p);
            });
          inFlight.add(p);
        }
      });
      await Promise.allSettled([...inFlight]);
    })();
  });

  // Start U req/s of ordinary read route: GET /v1/projects/:id/plates
  const inFlightUsers = new Set();
  const userIntervalMs = 50; // 20 ticks per second
  const requestsPerTick = U / (1000 / userIntervalMs);
  let carry = 0;

  const userTimer = setInterval(() => {
    if (stop.signal.aborted) return;
    carry += requestsPerTick;
    const n = Math.floor(carry);
    carry -= n;
    for (let i = 0; i < n; i++) {
      const reqPromise = (async () => {
        const t0 = performance.now();
        try {
          const res = await fetch(`${API}/v1/projects/${projectId}/plates`);
          await res.arrayBuffer();
          const dt = performance.now() - t0;
          if (!stop.signal.aborted) {
            ordinaryTotal++;
            ordinaryLatencies.push(dt);
            if (res.status >= 500) ordinary5xx++;
          }
        } catch {
          if (!stop.signal.aborted) {
            ordinaryTotal++;
            ordinary5xx++;
          }
        } finally {
          inFlightUsers.delete(reqPromise);
        }
      })();
      inFlightUsers.add(reqPromise);
    }
  }, userIntervalMs);

  await sleep(STEP_DURATION_MS);
  const elapsedSec = (now() - stepStart) / 1000;
  clearInterval(userTimer);
  stop.abort();

  await Promise.allSettled([feederPromise, samplerPromise, ...workerPromises, ...inFlightUsers]);

  const ctrlOps = summarizeLatencies(controlOpLatencies);
  const ctrlPolls = summarizeLatencies(controlPollLatencies);
  const ordReads = summarizeLatencies(ordinaryLatencies);
  const lagP50 = lagP50Samples.length ? Math.round((lagP50Samples.reduce((a, b) => a + b, 0) / lagP50Samples.length) * 100) / 100 : 0;
  const lagP95 = lagP95Samples.length ? Math.round(Math.max(...lagP95Samples) * 100) / 100 : 0;

  return {
    W,
    U,
    achievedRps: Math.round((ordinaryTotal / elapsedSec) * 10) / 10,
    apiDbConnsMax: maxApiDbConns,
    apiPoolTotalMax: maxPoolTotal,
    apiPoolWaitingMax: maxPoolWaiting,
    controlOpP50Ms: ctrlOps.p50,
    controlOpP95Ms: ctrlOps.p95,
    controlPollP50Ms: ctrlPolls.p50,
    controlPollP95Ms: ctrlPolls.p95,
    ordinaryP50Ms: ordReads.p50,
    ordinaryP95Ms: ordReads.p95,
    eventLoopLagP50Ms: lagP50,
    eventLoopLagP95Ms: lagP95,
    eventLoopLagMaxMs: maxLagMs,
    jobsCompleted,
    jobsPerSec: Math.round((jobsCompleted / elapsedSec) * 100) / 100,
    control5xx,
    ordinary5xx,
    total5xx: control5xx + ordinary5xx
  };
}

async function main() {
  try {
    // Stop plate-worker container during the synthetic load test so it does not consume our stub render-video jobs
    composeLive("up", "-d", "plate-api");
    composeLive("stop", "plate-worker");

    await waitFor(
      "plate-api ready",
      async () => {
        try {
          const r = await api("/readyz");
          return r.status === 200 && r.json?.ready === true;
        } catch {
          return false;
        }
      },
      { timeout: 60_000, every: 400 }
    );

    await pool.query(`
      TRUNCATE TABLE
        app.plate_check_reports,
        app.plate_revisions,
        app.plate_garbage,
        app.plate_exports,
        app.plate_variants,
        app.plate_state,
        app.render_jobs
      CASCADE
    `);
    await resetStub();

    // Seed a real project with 3 variants so GET /v1/projects/:id/plates reads real rows from Postgres
    const { id: projectId } = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 3, audio: false });
    await api(`/v1/projects/${projectId}/plates/draw`, { method: "POST" });
    await waitFor(
      "3 variants bundled for load test project",
      async () => {
        const r = await pool.query("SELECT count(*)::int AS n FROM app.plate_variants WHERE project_id = $1 AND state = 'bundled'", [projectId]);
        return r.rows[0]?.n === 3;
      },
      { timeout: 60_000, every: 300 }
    );

    const table = [];
    for (const W of WORKER_COUNTS) {
      for (const U of USER_RPS_LEVELS) {
        log(`Running load step: W=${W} workers, U=${U} req/s for ${STEP_DURATION_MS / 1000}s...`);
        const row = await runStep(W, U, projectId);
        table.push(row);
        log(
          `Step W=${W}, U=${U}: apiDbConns=${row.apiDbConnsMax} (pool=${row.apiPoolTotalMax}, wait=${row.apiPoolWaitingMax}), ` +
            `ctrlOp p50/p95=${row.controlOpP50Ms}/${row.controlOpP95Ms}ms, poll p50/p95=${row.controlPollP50Ms}/${row.controlPollP95Ms}ms, ` +
            `ordinary p50/p95=${row.ordinaryP50Ms}/${row.ordinaryP95Ms}ms, lag p50/p95=${row.eventLoopLagP50Ms}/${row.eventLoopLagP95Ms}ms, ` +
            `jobs/s=${row.jobsPerSec}, 5xx=${row.total5xx}`
        );
      }
    }

    console.log("\nLOAD_RESULTS_JSON:" + JSON.stringify(table));
  } finally {
    composeLive("up", "-d", "--scale", "plate-worker=1", "plate-worker");
    await pool.end().catch(() => {});
  }
}

await main();
