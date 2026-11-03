import { pool } from "../db/database.ts";
import { boss, inTransaction, POLL, QUEUES } from "../jobs/queues.ts";
import { startSweep } from "../jobs/sweep.ts";
import { kickWorkers } from "../jobs/worker-launcher.ts";
import { config } from "../config.ts";
import { deletePrefix } from "../storage.ts";
import { handleAuthor, handleAuthorDead, type AuthorMessage } from "./author.ts";
import { failVariant } from "./store.ts";

/**
 * Recovery. Queue messages and rows commit together, but a message can still be lost (queue maintenance, a crash between a
 * lease expiring and its retry, a worker task that never started). This sweep re-sends a message for every row that has
 * waited too long in a state that needs one, and asks for workers while any work is open. Re-sending is always safe: every
 * consumer claims its row atomically and acts only if its generation still matches.
 */
const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));
const RESEND_AFTER = "90 seconds";

export async function reconcilePlates(): Promise<number> {
  const client = await pool.connect();
  let resent = 0, open = 0;
  try {
    await client.query("begin");
    const variants = await client.query<{ id: string; gen: number; state: string }>(
      `select id, gen, state from app.plate_variants
        where state in ('queued', 'authoring', 'bundled', 'rendering')
          and (enqueued_at is null or enqueued_at < now() - $1::interval)
          and (state <> 'authoring' or author_until < now())
          and (state <> 'rendering' or updated_at < now() - $1::interval)
        for update skip locked`, [RESEND_AFTER]);
    for (const v of variants.rows) {
      const kind = v.state === "bundled" || v.state === "rendering" ? "render" : "author";
      await client.query("update app.plate_variants set enqueued_at = now() where id = $1", [v.id]);
      await boss.send(kind === "render" ? QUEUES.plateRender : QUEUES.plateAuthor, { variantId: v.id, gen: v.gen }, { db: inTransaction(client) });
      resent++;
    }
    const exports = await client.query<{ id: string }>(
      `select id from app.plate_exports
        where state in ('queued', 'assembling') and (enqueued_at is null or enqueued_at < now() - $1::interval) and updated_at < now() - $1::interval
        for update skip locked`, [RESEND_AFTER]);
    for (const e of exports.rows) {
      await client.query("update app.plate_exports set enqueued_at = now() where id = $1", [e.id]);
      await boss.send(QUEUES.plateExport, { exportId: e.id }, { db: inTransaction(client) });
      resent++;
    }
    open = Number((await client.query("select (select count(*) from app.plate_variants where state in ('queued','authoring','bundled','rendering')) + (select count(*) from app.plate_exports where state in ('queued','assembling')) as n")).rows[0].n);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (resent) log("info", "plate_reconciled", { resent, open });
  // Workers for the open work: covers a kick that failed at enqueue time and workers that exited with jobs still queued.
  if (open) await kickWorkers(true).catch(() => undefined);
  await sweepGarbage().catch((error) => log("warn", "plate_garbage_failed", { message: error instanceof Error ? error.message : String(error) }));
  return open;
}

/** Deletes the artifacts of superseded generations, twice (an hour and a day apart) so a late upload from a stale worker is caught too. */
async function sweepGarbage(limit = 20) {
  const { rows } = await pool.query<{ prefix: string; sweeps: number }>("select prefix, sweeps from app.plate_garbage where next_sweep_at <= now() order by next_sweep_at limit $1", [limit]);
  for (const row of rows) {
    await Promise.all([deletePrefix("uploads", row.prefix), deletePrefix("outputs", row.prefix)]);
    if (row.sweeps >= 1) await pool.query("delete from app.plate_garbage where prefix = $1", [row.prefix]);
    else await pool.query("update app.plate_garbage set sweeps = sweeps + 1, next_sweep_at = now() + interval '24 hours' where prefix = $1", [row.prefix]);
  }
}

/** Starts the consumers and the recovery sweep. Returns a stop function. A no-op unless PLATE_PIPELINE=worker. */
export async function startPlates(): Promise<() => void> {
  if (!config.plates.enabled) return () => undefined;
  await boss.work<AuthorMessage>(QUEUES.plateAuthor, { localConcurrency: config.plates.authorConcurrency, pollingIntervalSeconds: POLL.live }, async ([job]) => handleAuthor(job!));
  await boss.work<AuthorMessage>(QUEUES.plateAuthorDead, { pollingIntervalSeconds: POLL.dead }, async ([job]) => handleAuthorDead(job!));
  await boss.work<AuthorMessage>(QUEUES.plateRenderDead, { pollingIntervalSeconds: POLL.dead }, async ([job]) => {
    const { variantId, gen } = job!.data;
    await failVariant(variantId, gen, null, { code: "render_unavailable", message: "This scene could not be drawn. Press Draw to try again." });
  });
  log("info", "plate_pipeline_on", { authorConcurrency: config.plates.authorConcurrency });
  return startSweep(() => reconcilePlates(), 30_000, 120_000);
}
