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
  plan: "render-plan",
  planDead: "render-plan-dead",
  video: "render-video",
  videoDead: "render-video-dead",
  finished: "render-finished"
} as const;

export type RenderMessage = { jobId: string };

const queueOptions: Array<Omit<Queue, "name"> & { name: string }> = [
  // Dead-letter queues first: a queue can only name a dead-letter queue that already exists.
  { name: QUEUES.planDead, retryLimit: 0 },
  { name: QUEUES.videoDead, retryLimit: 0 },
  // Planning calls Claude and the audio APIs; one retry covers a transient API error without
  // paying for repeated failures. A missed heartbeat (backend crashed) also triggers the retry.
  { name: QUEUES.plan, retryLimit: 1, retryDelay: 5, expireInSeconds: 600, heartbeatSeconds: 30, deadLetter: QUEUES.planDead },
  // Rendering: heartbeats detect a dead worker within ~30 s; the expiry bounds a hung render.
  { name: QUEUES.video, retryLimit: config.renderRetries, retryDelay: 10, retryBackoff: true, retryDelayMax: 120, expireInSeconds: config.renderTimeoutSeconds, heartbeatSeconds: 30, deadLetter: QUEUES.videoDead },
  { name: QUEUES.finished, retryLimit: 5, retryDelay: 2, retryBackoff: true }
];

export const boss = new PgBoss({ connectionString: config.databaseUrl, max: 4 });
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
