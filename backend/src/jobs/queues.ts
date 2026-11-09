// The render pipeline's queues (pg-boss on Postgres). The backend owns queue creation; the
// render worker only consumes `render-video` and produces `render-finished`.
//
//   POST /render ─▶ app.render_jobs row + render-plan ─▶ backend: plan + audio
//                                                       └▶ render-video ─▶ worker replicas (N)
//                                                                          └▶ render-finished ─▶ backend: project state
//
// Every message carries only { jobId }. Consumers reload the row and act only if its state allows,
// so duplicate or late deliveries are harmless. Keep these names in sync with worker/src/jobs.mjs.
import type pg from "pg";
import { PgBoss, type Db, type Queue, type SendOptions } from "pg-boss";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";

export const QUEUES = {
  visuals: "plan-visuals",
  visualsDead: "plan-visuals-dead",
  plan: "render-plan",
  planDead: "render-plan-dead",
  video: "render-video",
  videoDead: "render-video-dead",
  finished: "render-finished",
  // Plate scenes (plates/): authoring runs in the backend, verification + rendering + export on the worker. Messages carry
  // only { variantId, gen } / { exportId }; consumers reload the row and act only if their fence still matches.
  plateAuthor: "plate-author",
  plateAuthorDead: "plate-author-dead",
  plateRender: "plate-render",
  plateRenderDead: "plate-render-dead",
  plateExport: "plate-export",
  plateRebundle: "plate-rebundle"
} as const;

export type RenderMessage = { jobId: string };

/** The planning queue's retry delay; the planning consumer wakes itself when a retry comes due (render/service.ts). */
export const PLAN_RETRY_DELAY_SECONDS = 5;

const queueOptions: Array<Omit<Queue, "name"> & { name: string }> = [
  // Dead-letter queues first: a queue can only name a dead-letter queue that already exists.
  { name: QUEUES.visualsDead, notify: true, retryLimit: 0 },
  // Wait past the application's five-minute ownership lease after a worker crash.
  { name: QUEUES.visuals, notify: true, retryLimit: 2, retryDelay: 310, expireInSeconds: 3600, heartbeatSeconds: 30, deadLetter: QUEUES.visualsDead },
  { name: QUEUES.planDead, notify: true, retryLimit: 0 },
  { name: QUEUES.videoDead, notify: true, retryLimit: 0 },
  // Planning calls Claude and the audio APIs; one retry covers a transient API error without
  // paying for repeated failures. A missed heartbeat (backend crashed) also triggers the retry.
  { name: QUEUES.plan, notify: true, retryLimit: 1, retryDelay: PLAN_RETRY_DELAY_SECONDS, expireInSeconds: 600, heartbeatSeconds: 30, deadLetter: QUEUES.planDead },
  // Rendering: heartbeats detect a dead worker within ~30 s; the expiry bounds a hung render.
  { name: QUEUES.video, notify: true, retryLimit: config.renderRetries, retryDelay: 10, retryBackoff: true, retryDelayMax: 120, expireInSeconds: config.renderTimeoutSeconds, heartbeatSeconds: 30, deadLetter: QUEUES.videoDead },
  { name: QUEUES.finished, notify: true, retryLimit: 5, retryDelay: 2, retryBackoff: true },
  // Plate authoring calls the model (up to three authoring calls of up to five minutes each); an interrupted or failed model
  // call is retried with the SAME row, which keeps what was already authored.
  { name: QUEUES.plateAuthorDead, notify: true, retryLimit: 0 },
  { name: QUEUES.plateAuthor, notify: true, retryLimit: 2, retryDelay: 15, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 1800, heartbeatSeconds: 30, deadLetter: QUEUES.plateAuthorDead },
  // Verification + rendering of one scene: browser start-up failures, Spot interruptions and network errors retry the same
  // bundle (no model call). Deterministic scene-code failures never retry here; they go back to authoring as a bounded repair.
  { name: QUEUES.plateRenderDead, notify: true, retryLimit: 0 },
  { name: QUEUES.plateRender, notify: true, retryLimit: 2, retryDelay: 10, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 1200, heartbeatSeconds: 30, deadLetter: QUEUES.plateRenderDead },
  { name: QUEUES.plateExport, notify: true, retryLimit: 2, retryDelay: 10, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 1800, heartbeatSeconds: 30 },
  { name: QUEUES.plateRebundle, notify: true, retryLimit: 2, retryDelay: 10, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 600, heartbeatSeconds: 30 }
];

/**
 * Keep pg-boss quiet when nothing is happening. The database is billed by egress and an idle project was sending about 5 GB a month, all of it pg-boss
 * housekeeping (October 2026: 7.3 million job fetches, 318 thousand queue-list reads, 53 thousand heartbeats). What each line removes:
 *  - useListenNotify + `notify` on every queue: a worker is woken the moment a job is sent and falls back to a 30 s backstop poll (it was every 2 s,
 *    for ten pollers). Needs a session-pinned connection (a direct URL or the Supabase session pooler, never the transaction pooler); if LISTEN cannot be
 *    established pg-boss warns and polls at POLL.live, so a wrong URL costs egress, never jobs.
 *  - flowIntervalSeconds: the job-dependency resolver ran every 5 s and listed every queue each time (the biggest read). We use no dependent jobs.
 *  - schedule: false: the cron clock polled every few seconds. We use no cron jobs.
 *  - registerInstance: false: a heartbeat row written every 30 s, only a monitoring registry.
 *  - bamIntervalSeconds, queueCacheIntervalSeconds: background schema migrations and the queue list refresh, both needed rarely.
 *  - idleTimeoutMillis: pg closes an idle connection after 10 s by default; with slow polls that meant a new connection (and a pooler auth lookup) every
 *    poll. Keep them for two minutes.
 * supervise stays on at superviseIntervalSeconds: 30 (default 60) so a dead worker's missed 30 s heartbeat is reclaimed in ~30-60 s; supervise is a
 * cheap indexed query, so doubling its cadence costs negligible egress while halving recovery latency.
 */
export const POLL = { live: 5, dead: 30 } as const;
export const quietBoss = { useListenNotify: true, schedule: false, registerInstance: false, superviseIntervalSeconds: 30, flowIntervalSeconds: 3600, bamIntervalSeconds: 600, queueCacheIntervalSeconds: 300, idleTimeoutMillis: 120_000 } as const;
export const boss = new PgBoss({ connectionString: config.databaseUrl, max: 4, ...quietBoss });
boss.on("warning", (warning) => console.warn(JSON.stringify({ level: "warn", event: "queue_warning", message: warning.message })));
boss.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "queue_error", message: error.message })));

/** Starts pg-boss (installing or migrating its schema) and creates or updates the queues. */
export async function startQueues() {
  await boss.start();
  for (const { name, ...options } of queueOptions) {
    if (await boss.getQueue(name)) {
      await boss.updateQueue(name, options);
    } else {
      await boss.createQueue(name, options);
    }
  }
}

/** Lets pg-boss write its job inside the caller's transaction, so the row and the message commit together. */
export function inTransaction(client: pg.PoolClient): Db {
  return { executeSql: (text: string, values?: unknown[]) => client.query(text, values) };
}

/**
 * Deduplicated transactional enqueue: pg-boss 12's `singletonKey` without `singletonSeconds` does not deduplicate on standard
 * queues. Takes a transaction-scoped advisory lock on `send:<name>:<key>`, returns `null` if a job with the same `name` and
 * `singleton_key` is already in `created`, `retry`, or `active`, and otherwise sends inside the caller's transaction.
 */
export async function sendOnce(
  client: pg.PoolClient | null,
  name: string,
  data: object,
  key: string,
  opts?: SendOptions
): Promise<string | null> {
  if (!client) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const out = await sendOnce(c, name, data, key, opts);
      await c.query("commit");
      return out;
    } catch (err) {
      await c.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }
  await client.query("select pg_advisory_xact_lock(hashtextextended('send:' || $1 || ':' || $2, 0))", [name, key]);
  const existing = await client.query<{ id: string }>(
    "select id from pgboss.job where name = $1 and singleton_key = $2 and state in ('created', 'retry', 'active') limit 1",
    [name, key]
  );
  if (existing.rows.length > 0) return null;
  return boss.send(name, data, { singletonKey: key, db: inTransaction(client), ...opts });
}
