import { timingSafeEqual } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "../db/database.ts";
import { boss, inTransaction, QUEUES } from "./queues.ts";

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

/**
 * Job control: the only place render workers touch Postgres and pg-boss (docs/JOB_CONTROL.md). Workers call these routes with a
 * shared bearer secret; they hold no database credentials and open no database connections, so adding workers adds HTTP
 * concurrency, never pooler clients. Everything is bounded: a poll is held at most POLL_MAX_SECONDS, one dispatcher loop runs per
 * queue that has waiting workers, and every persistence step is a named, parameterised operation (workers never send SQL).
 *
 * Ownership is the attempt number (pg-boss retryCount + 1), exactly as in the direct worker: every domain write is conditional
 * on it, so a stale attempt changes nothing. Acknowledgment (`complete`/`fail`) is sent after the domain write commits; if the
 * process dies between the two, pg-boss redelivers and the handler finds a terminal state and returns, as it always has.
 */

const POLL_MAX_SECONDS = 25;
const FETCH_BACKSTOP_MS = 3000;
const LEASE_SECONDS = 30;
const QUEUE_NAMES: readonly string[] = [QUEUES.video, QUEUES.plateRender, QUEUES.plateExport];

const FPS = 30;
const PROJECT_CAP = Number.parseInt(process.env.PLATE_PROJECT_CAP ?? "2", 10);
const STALE_SECONDS = Number.parseInt(process.env.PLATE_STALE_SECONDS ?? "90", 10);
const MAX_AUTHOR_CALLS = Number.parseInt(process.env.PLATE_MAX_AUTHOR_CALLS ?? "3", 10);

type Row = Record<string, unknown>;
type Args = Record<string, any>;

// ------------------------------------------------------------------ dispatcher (long-held work requests)

type Leased = { queue: string; id: string; attempt: number; data: unknown; leaseSeconds: number };
type Waiter = { workerId: string; slots: Record<string, number>; got: Leased[]; resolve: (jobs: Leased[]) => void };
const waiters = new Set<Waiter>();
let dispatching = false;
let dispatchPending = false;
let backstop: NodeJS.Timeout | null = null;

const freeSlots = (queue: string) => [...waiters].reduce((sum, w) => sum + Math.max(0, Math.floor(w.slots[queue] ?? 0)), 0);

/** One fetch per queue that has waiting workers, however many workers wait. Idle platform cost: no loop, no query. */
async function dispatch() {
  if (dispatching) { dispatchPending = true; return; }
  dispatching = true;
  try {
    do {
      dispatchPending = false;
      for (const queue of QUEUE_NAMES) {
        const free = freeSlots(queue);
        if (free <= 0) continue;
        const jobs = await boss.fetch<Args>(queue, { batchSize: Math.min(free, 5) }).catch((error: unknown) => {
          console.warn(JSON.stringify({ level: "warn", event: "control_fetch_failed", queue, message: error instanceof Error ? error.message : String(error) }));
          return [];
        });
        for (const job of jobs) {
          const lease: Leased = { queue, id: job.id, attempt: job.retryCount + 1, data: job.data, leaseSeconds: LEASE_SECONDS };
          const taker = [...waiters].find((w) => (w.slots[queue] ?? 0) > 0);
          if (!taker) { await boss.fail(queue, { id: job.id, retryCount: job.retryCount }, { reason: "no taker" }).catch(() => undefined); continue; }
          taker.slots[queue] = (taker.slots[queue] ?? 0) - 1;
          taker.got.push(lease);
        }
      }
      for (const w of [...waiters]) {
        if (w.got.length) { waiters.delete(w); w.resolve(w.got); }
      }
    } while (dispatchPending && waiters.size > 0);
  } finally {
    dispatching = false;
    if (waiters.size === 0 && backstop) { clearInterval(backstop); backstop = null; }
  }
}

function wait(workerId: string, slots: Record<string, number>, seconds: number, signal: AbortSignal): Promise<Leased[]> {
  return new Promise((resolve) => {
    const waiter: Waiter = { workerId, slots: { ...slots }, got: [], resolve: (jobs) => { clearTimeout(timer); resolve(jobs); } };
    const timer = setTimeout(() => { waiters.delete(waiter); resolve([]); }, seconds * 1000);
    signal.addEventListener("abort", () => { waiters.delete(waiter); clearTimeout(timer); resolve([]); }, { once: true });
    waiters.add(waiter);
    backstop ??= setInterval(() => void dispatch(), FETCH_BACKSTOP_MS);
    void dispatch();
  });
}

// ------------------------------------------------------------------ operations (the worker's persistence, verbatim)

async function tx<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const plateFence = (set: string) => `update app.plate_variants set ${set}, updated_at = now() where id = $1 and gen = $2 and render_attempt = $3 and state = 'rendering'`;
const exportFence = (set: string) => `update app.plate_exports set ${set}, updated_at = now() where id = $1 and attempt = $2 and state = 'assembling'`;

export const operations: Record<string, (a: Args) => Promise<unknown>> = {
  // ---- render-video (HyperFrames and plate-film finals)
  async "render.claim"({ jobId, attempt }) {
    const result = await pool.query(
      `update app.render_jobs
          set attempt = $2, stage = 'preparing', progress = 50, frames_done = null, frames_total = null,
              error = null, render_started_at = now(), updated_at = now()
        where id = $1 and state = 'rendering' and attempt < $2
        returning render_input`, [jobId, attempt]);
    return { input: result.rows[0]?.render_input ?? null };
  },
  async "render.progress"({ jobId, attempt, stage, progress, framesDone = null, framesTotal = null }) {
    const result = await pool.query(
      `update app.render_jobs set stage = $3, progress = $4, frames_done = $5, frames_total = $6, updated_at = now()
        where id = $1 and attempt = $2 and state = 'rendering'`, [jobId, attempt, stage, progress, framesDone, framesTotal]);
    return { ok: result.rowCount === 1 };
  },
  async "render.noteRetry"({ jobId, attempt, error }) {
    await pool.query(
      `update app.render_jobs set stage = 'retrying', error = $3, updated_at = now()
        where id = $1 and attempt = $2 and state = 'rendering'`, [jobId, attempt, error]);
    return { ok: true };
  },
  async "render.finish"({ jobId, attempt, outcome }) {
    return tx(async (client) => {
      const result = outcome.output
        ? await client.query(
          `update app.render_jobs set state = 'ready', stage = 'done', progress = 100, output = $3, error = null,
                  frames_done = frames_total, finished_at = now(), updated_at = now()
            where id = $1 and attempt = $2 and state = 'rendering'`, [jobId, attempt, outcome.output])
        : await client.query(
          `update app.render_jobs set state = 'failed', stage = 'failed', progress = 100, error = $3,
                  finished_at = now(), updated_at = now()
            where id = $1 and attempt = $2 and state = 'rendering'`, [jobId, attempt, outcome.error]);
      if (result.rowCount === 1) await boss.send(QUEUES.finished, { jobId }, { db: inTransaction(client) });
      if (result.rowCount === 1) return { committed: true };
      // A retried request whose first answer was lost: this attempt already committed. Say so, so the worker keeps its output.
      const done = await client.query("select 1 from app.render_jobs where id = $1 and attempt = $2 and state in ('ready', 'failed')", [jobId, attempt]);
      return { committed: done.rowCount === 1, duplicate: done.rowCount === 1 };
    });
  },

  // ---- plate-render
  async "plate.claim"({ variantId, gen }) {
    return tx(async (client) => {
      const found = await client.query("select project_id from app.plate_variants where id = $1", [variantId]);
      if (!found.rows.length) return { row: null };
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate-cap:${found.rows[0].project_id}`]);
      const result = await client.query(
        `update app.plate_variants v
            set state = 'rendering', render_attempt = render_attempt + 1, stage = 'verifying', frames_done = 0, error = null, updated_at = now()
          where v.id = $1 and v.gen = $2
            and (v.state in ('bundled', 'checked') or (v.state = 'rendering' and v.updated_at < now() - make_interval(secs => $4)))
            and (select count(*) from app.plate_variants o where o.project_id = v.project_id and o.state = 'rendering' and o.id <> v.id
                   and o.updated_at >= now() - make_interval(secs => $4)) < $3
          returning v.*`, [variantId, gen, PROJECT_CAP, STALE_SECONDS]);
      return { row: result.rows[0] ?? null };
    });
  },
  async "plate.state"({ variantId }) {
    const { rows } = await pool.query("select state, gen from app.plate_variants where id = $1", [variantId]);
    return { row: rows[0] ?? null };
  },
  async "plate.sendLater"({ variantId, gen, looks, startAfter }) {
    await boss.send(QUEUES.plateRender, looks === undefined ? { variantId, gen } : { variantId, gen, looks }, { startAfter: Math.max(1, Math.min(120, Number(startAfter) || 4)) });
    return { ok: true };
  },
  /** Fenced writes of the one attempt that owns the row: progress, drawn (publish), failed, or back to bundled for a retry. */
  async "plate.progress"({ id, gen, renderAttempt, stage, framesDone }) {
    const r = await pool.query(plateFence("stage = $4, frames_done = $5"), [id, gen, renderAttempt, stage, framesDone]);
    return { ok: r.rowCount === 1 };
  },
  async "plate.drawn"({ id, gen, renderAttempt, clipKey, stillKey, clipMeta, timings }) {
    const r = await pool.query(plateFence("state = 'drawn', stage = null, frames_done = frames, clip_key = $4, still_key = $5, clip_meta = $6::jsonb, error = null, drawn_at = now(), timings = timings || $7::jsonb"),
      [id, gen, renderAttempt, clipKey, stillKey, JSON.stringify(clipMeta), JSON.stringify(timings)]);
    if (r.rowCount === 1) return { ok: true };
    const done = await pool.query("select 1 from app.plate_variants where id = $1 and gen = $2 and render_attempt = $3 and state = 'drawn' and clip_key = $4", [id, gen, renderAttempt, clipKey]);
    return { ok: done.rowCount === 1, duplicate: done.rowCount === 1 };
  },
  async "plate.failed"({ id, gen, renderAttempt, error }) {
    const r = await pool.query(plateFence("state = 'failed', stage = null, error = $4::jsonb"), [id, gen, renderAttempt, JSON.stringify(error)]);
    return { ok: r.rowCount === 1 };
  },
  async "plate.retry"({ id, gen, renderAttempt }) {
    const r = await pool.query(plateFence("state = 'bundled', stage = 'retrying'"), [id, gen, renderAttempt]);
    return { ok: r.rowCount === 1 };
  },
  /** A deterministic defect of the scene code goes back to authoring (bounded by PLATE_MAX_AUTHOR_CALLS). */
  async "plate.sendBackForRepair"({ id, gen, renderAttempt, authored, sourceKey, detail }) {
    return tx(async (client) => {
      const exhausted = Number(authored) >= MAX_AUTHOR_CALLS;
      const result = exhausted
        ? await client.query(
          `update app.plate_variants set state = 'failed', stage = null, error = $4::jsonb, updated_at = now()
            where id = $1 and gen = $2 and render_attempt = $3 and state = 'rendering'`,
          [id, gen, renderAttempt, JSON.stringify({ code: "scene_invalid", message: `This scene could not be drawn after ${authored} attempts. Press Draw to try again.`, detail: String(detail).slice(0, 800) })])
        : await client.query(
          `update app.plate_variants set state = 'queued', stage = 'repairing', repair = $4::jsonb, repairs = repairs + 1, author_owner = null, author_until = null, enqueued_at = now(), updated_at = now()
            where id = $1 and gen = $2 and render_attempt = $3 and state = 'rendering'`,
          [id, gen, renderAttempt, JSON.stringify({ error: String(detail).slice(-2500), previousKey: sourceKey })]);
      if (result.rowCount === 1 && !exhausted) await boss.send(QUEUES.plateAuthor, { variantId: id, gen }, { db: inTransaction(client) });
      return { applied: result.rowCount === 1, exhausted };
    });
  },

  // ---- plate-export and plate-film
  async "export.claim"({ exportId }) {
    const r = await pool.query(
      `update app.plate_exports set state = 'assembling', attempt = attempt + 1, stage = 'preparing', progress = 5, error = null, updated_at = now()
        where id = $1 and (state = 'queued' or (state = 'assembling' and updated_at < now() - make_interval(secs => $2))) returning *`, [exportId, STALE_SECONDS]);
    return { row: r.rows[0] ?? null };
  },
  async "export.progress"({ id, attempt, stage, progress }) {
    const r = await pool.query(exportFence("stage = $3, progress = $4"), [id, attempt, stage, progress]);
    return { ok: r.rowCount === 1 };
  },
  async "export.ready"({ id, attempt, outputKey }) {
    const r = await pool.query(exportFence("state = 'ready', stage = 'done', progress = 100, output_key = $3, finished_at = now()"), [id, attempt, outputKey]);
    if (r.rowCount === 1) return { ok: true };
    const done = await pool.query("select 1 from app.plate_exports where id = $1 and attempt = $2 and state = 'ready' and output_key = $3", [id, attempt, outputKey]);
    return { ok: done.rowCount === 1, duplicate: done.rowCount === 1 };
  },
  async "export.failed"({ id, attempt, error }) {
    const r = await pool.query(exportFence("state = 'failed', stage = null, error = $3::jsonb"), [id, attempt, JSON.stringify(error)]);
    return { ok: r.rowCount === 1 };
  },
  async "export.requeue"({ id, attempt }) {
    const r = await pool.query(exportFence("state = 'queued', stage = 'retrying'"), [id, attempt]);
    return { ok: r.rowCount === 1 };
  },
  async "scenes.states"({ ids }) {
    const { rows } = await pool.query("select id, project_id, signature, state, clip_key, error from app.plate_variants where id = any($1)", [ids]);
    return { rows };
  },

  // ---- idle check for scale-to-zero
  async "demand.idle"() {
    const stats = await Promise.all(QUEUE_NAMES.map((q) => boss.getQueueStats(q, { force: true }).then((rows) => rows[0] ?? null).catch(() => null)));
    const queued = stats.reduce((n, s) => n + Number(s?.queuedCount ?? 0) + Number(s?.activeCount ?? 0), 0);
    const plate = await pool.query(
      `select (
         select count(*)
           from app.plate_variants v
           left join app.plate_state s on s.project_id = v.project_id
          where v.state = 'rendering'
             or (
               v.state in ('bundled', 'checked')
               and v.clip_key is null
               and (
                 coalesce(s.live_mode, 'clip') <> 'live'
                 or v.aspect = any(coalesce(s.draw_aspects, '{}'::text[]))
                 or v.stage = 'queued for rendering'
               )
             )
       ) + (select count(*) from app.plate_exports where state in ('queued', 'assembling')) as n`
    ).then((r) => Number(r.rows[0]?.n ?? 0)).catch(() => null);
    const lagMs = {
      p50: Math.round((loopDelay.percentile(50) / 1e6) * 100) / 100,
      p95: Math.round((loopDelay.percentile(95) / 1e6) * 100) / 100,
      max: Math.round((loopDelay.max / 1e6) * 100) / 100
    };
    loopDelay.reset();
    return {
      queued,
      plate,
      lagMs,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
    };
  }
};

// ------------------------------------------------------------------ routes

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const authorised = (request: FastifyRequest, secret: string) => {
  const given = Buffer.from(String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
};

/** Registered only when WORKER_CONTROL_TOKEN is set; without it the routes do not exist (404). */
export async function registerJobControlRoutes(app: FastifyInstance, secret = process.env.WORKER_CONTROL_TOKEN ?? "") {
  if (!secret) return;
  const deny = { error: { code: "unauthorized", message: "Not authorised." } };
  const bad = (reply: any, message: string) => reply.code(400).send({ error: { code: "bad_request", message } });

  app.post<{ Body: { workerId?: string; slots?: Record<string, number>; waitSeconds?: number } }>("/internal/worker/poll", async (request, reply) => {
    if (!authorised(request, secret)) return reply.code(401).send(deny);
    const { workerId, slots, waitSeconds } = request.body ?? {};
    if (typeof workerId !== "string" || !UUID.test(workerId) || !slots || typeof slots !== "object") return bad(reply, "workerId and slots are required.");
    const clean: Record<string, number> = {};
    for (const queue of QUEUE_NAMES) clean[queue] = Math.max(0, Math.min(4, Math.floor(Number(slots[queue]) || 0)));
    if (!Object.values(clean).some((n) => n > 0)) return { jobs: [] };
    const seconds = Math.max(1, Math.min(POLL_MAX_SECONDS, Number(waitSeconds) || POLL_MAX_SECONDS));
    const gone = new AbortController();
    reply.raw.on("close", () => { if (!reply.raw.writableEnded) gone.abort(); }); // the response side: a request "close" fires as soon as the body is read
    const jobs = await wait(workerId, clean, seconds, gone.signal);
    return { jobs };
  });

  const ack = (verb: "heartbeat" | "complete" | "fail") => async (request: FastifyRequest<{ Params: { queue: string; id: string }; Body: { attempt?: number; reason?: string } }>, reply: any) => {
    if (!authorised(request, secret)) return reply.code(401).send(deny);
    const { queue, id } = request.params;
    const attempt = Number(request.body?.attempt);
    if (!QUEUE_NAMES.includes(queue) || !UUID.test(id) || !Number.isInteger(attempt) || attempt < 1) return bad(reply, "queue, id and attempt are required.");
    const target = { id, retryCount: attempt - 1 };
    try {
      if (verb === "heartbeat") {
        const result = (await boss.touch(queue, target)) as { affected?: number; jobs?: unknown[] };
        const ok = (result?.affected ?? result?.jobs?.length ?? 0) > 0;
        return ok ? { ok: true } : { ok: false, reason: "superseded" };
      }
      const result = (verb === "complete" ? await boss.complete(queue, target) : await boss.fail(queue, target, { reason: String(request.body?.reason ?? "worker").slice(0, 300) })) as { affected?: number; jobs?: unknown[] };
      // Acknowledging an attempt that is no longer active (already completed, retried by pg-boss, superseded) is not an error.
      return { ok: true, applied: (result?.affected ?? result?.jobs?.length ?? 0) > 0 };
    } catch (error) {
      return reply.code(500).send({ error: { code: "ack_failed", message: error instanceof Error ? error.message.slice(0, 200) : "Could not acknowledge." } });
    }
  };
  app.post("/internal/worker/jobs/:queue/:id/heartbeat", ack("heartbeat"));
  app.post("/internal/worker/jobs/:queue/:id/complete", ack("complete"));
  app.post("/internal/worker/jobs/:queue/:id/fail", ack("fail"));

  app.post<{ Params: { op: string }; Body: Args }>("/internal/worker/op/:op", async (request, reply) => {
    if (!authorised(request, secret)) return reply.code(401).send(deny);
    const op = Object.hasOwn(operations, request.params.op) ? operations[request.params.op] : undefined;
    if (!op) return reply.code(404).send({ error: { code: "not_found", message: "Unknown operation." } });
    try { return await op(request.body ?? {}); }
    catch (error) { return reply.code(500).send({ error: { code: "op_failed", message: error instanceof Error ? error.message.slice(0, 200) : "Operation failed." } }); }
  });
}

/** For tests: how many workers are currently waiting for a job. */
export const waitingWorkers = () => waiters.size;
