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
import { PgBoss, type Db, type Queue } from "pg-boss";
import { config } from "../config.ts";

export const QUEUES = {
  visuals: "plan-visuals",
  visualsDead: "plan-visuals-dead",
  plan: "render-plan",
  planDead: "render-plan-dead",
  video: "render-video",
  videoDead: "render-video-dead",
  finished: "render-finished"
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
  { name: QUEUES.finished, notify: true, retryLimit: 5, retryDelay: 2, retryBackoff: true }
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
 * supervise stays on: it expires stuck jobs, retries after a missed heartbeat and archives, once a minute.
 */
export const POLL = { live: 5, dead: 30 } as const;
export const quietBoss = { useListenNotify: true, schedule: false, registerInstance: false, flowIntervalSeconds: 3600, bamIntervalSeconds: 600, queueCacheIntervalSeconds: 300, idleTimeoutMillis: 120_000 } as const;
export const boss = new PgBoss({ connectionString: config.databaseUrl, max: 4, ...quietBoss });
boss.on("warning", (warning) => console.warn(JSON.stringify({ level: "warn", event: "queue_warning", message: warning.message })));
boss.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "queue_error", message: error.message })));

/** Starts pg-boss (installing or migrating its schema) and creates or updates the queues. */
export async function startQueues() {
  await boss.start();
  for (const { name, ...options } of queueOptions) {
    if (await boss.getQueue(name)) {
      const { deadLetter: _deadLetter, heartbeatSeconds: _heartbeat, retryDelayMax: _delayMax, ...updatable } = options;
      await boss.updateQueue(name, updatable);
    } else {
      await boss.createQueue(name, options);
    }
  }
}

/** Lets pg-boss write its job inside the caller's transaction, so the row and the message commit together. */
export function inTransaction(client: pg.PoolClient): Db {
  return { executeSql: (text: string, values?: unknown[]) => client.query(text, values) };
}
