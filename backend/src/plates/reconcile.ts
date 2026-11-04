import { pool } from "../db/database.ts";
import { boss, inTransaction, POLL, QUEUES } from "../jobs/queues.ts";
import { startSweep } from "../jobs/sweep.ts";
import { kickPlateWorkers } from "../jobs/worker-launcher.ts";
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
const ROLLBACK_PASS_LIMIT = 20;

export async function reconcilePlates(): Promise<number> {
  const client = await pool.connect();
  let resent = 0, open = 0;
  const forceOff = config.plates.liveForceOff;
  try {
    await client.query("begin");

    if (forceOff) {
      const flipped = await client.query<{ project_id: string }>(
        "update app.plate_state set live_mode = 'clip', draw_aspects = '{}'::text[], updated_at = now() where live_mode = 'live' or cardinality(draw_aspects) > 0 returning project_id"
      );
      if (flipped.rowCount && flipped.rowCount > 0) {
        log("info", "plate_live_force_off", { projects: flipped.rows.map((r) => r.project_id) });
      }
      const rollbackRows = await client.query<{ id: string; gen: number }>(
        `select v.id, v.gen
           from app.plate_variants v
           left join app.plate_state s on s.project_id = v.project_id
          where v.state in ('checked', 'bundled')
            and coalesce(s.live_mode, 'clip') = 'clip'
            and not exists (
              select 1 from pgboss.job j
               where j.name = $1
                 and j.data->>'variantId' = v.id::text
                 and (j.data->>'gen')::int = v.gen
                 and j.state in ('created', 'retry', 'active')
            )
            and (
              select count(*) from app.plate_variants o
               where o.project_id = v.project_id
                 and o.state = 'rendering'
                 and o.updated_at >= now() - $2::interval
            ) < $3
          order by v.created_at, v.scene_index, v.aspect
          limit $4
          for update of v skip locked`,
        [QUEUES.plateRender, RESEND_AFTER, config.plates.projectClipCap, ROLLBACK_PASS_LIMIT]
      );
      for (const v of rollbackRows.rows) {
        await client.query(
          "update app.plate_variants set state = 'bundled', stage = 'queued for rendering', enqueued_at = now(), updated_at = now() where id = $1",
          [v.id]
        );
        await boss.send(QUEUES.plateRender, { variantId: v.id, gen: v.gen }, { db: inTransaction(client), singletonKey: `${v.id}:${v.gen}` });
        resent++;
      }
    }

    const variants = await client.query<{ id: string; gen: number; state: string }>(
      `select v.id, v.gen, v.state
         from app.plate_variants v
         left join app.plate_state s on s.project_id = v.project_id
        where (
            v.state in ('queued', 'authoring', 'rendering')
            or (
              not $2::boolean
              and v.state in ('bundled', 'checked')
              and v.clip_key is null
              and (coalesce(s.live_mode, 'clip') <> 'live' or v.aspect = any(coalesce(s.draw_aspects, '{}'::text[])))
            )
          )
          and (v.enqueued_at is null or v.enqueued_at < now() - $1::interval)
          and (v.state <> 'authoring' or v.author_until < now())
          and (v.state <> 'rendering' or v.updated_at < now() - $1::interval)
        for update of v skip locked`,
      [RESEND_AFTER, forceOff]
    );
    for (const v of variants.rows) {
      const kind = v.state === "bundled" || v.state === "checked" || v.state === "rendering" ? "render" : "author";
      if (kind === "render" && (v.state === "bundled" || v.state === "checked")) {
        await client.query(
          "update app.plate_variants set state = 'bundled', stage = 'queued for rendering', enqueued_at = now(), updated_at = now() where id = $1",
          [v.id]
        );
        await boss.send(QUEUES.plateRender, { variantId: v.id, gen: v.gen }, { db: inTransaction(client), singletonKey: `${v.id}:${v.gen}` });
      } else {
        await client.query("update app.plate_variants set enqueued_at = now() where id = $1", [v.id]);
        await boss.send(
          kind === "render" ? QUEUES.plateRender : QUEUES.plateAuthor,
          { variantId: v.id, gen: v.gen },
          { db: inTransaction(client), ...(kind === "render" ? { singletonKey: `${v.id}:${v.gen}` } : {}) }
        );
      }
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
    // A render that could not even be claimed (database/pooler/worker trouble) is dead-lettered as `render_unavailable`; its bundle is
    // intact, so retry it from the bundle (no model call) up to twice before leaving it for the person's Draw.
    const revived = await client.query<{ id: string; gen: number }>(
      `update app.plate_variants set state = 'bundled', gen = gen + 1, render_attempt = 0, error = null, stage = 'retrying', enqueued_at = now(), updated_at = now(),
         timings = timings || jsonb_build_object('autoRetries', coalesce((timings->>'autoRetries')::int, 0) + 1)
        where state = 'failed' and error->>'code' = 'render_unavailable' and bundle_key is not null and updated_at < now() - $1::interval
          and coalesce((timings->>'autoRetries')::int, 0) < 2 returning id, gen`, [RESEND_AFTER]);
    for (const v of revived.rows) { await boss.send(QUEUES.plateRender, { variantId: v.id, gen: v.gen }, { db: inTransaction(client), singletonKey: `${v.id}:${v.gen}` }); resent++; }
    open = Number(
      (
        await client.query(
          `select (
             select count(*)
               from app.plate_variants v
               left join app.plate_state s on s.project_id = v.project_id
              where v.state in ('queued', 'authoring', 'rendering')
                 or (
                   v.state in ('bundled', 'checked')
                   and v.clip_key is null
                   and (
                     coalesce(s.live_mode, 'clip') <> 'live'
                     or v.aspect = any(coalesce(s.draw_aspects, '{}'::text[]))
                     or v.stage = 'queued for rendering'
                   )
                 )
           ) + (
             select count(*) from app.plate_exports where state in ('queued', 'assembling')
           ) as n`
        )
      ).rows[0].n
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (resent) log("info", "plate_reconciled", { resent, open });
  // Workers for the open work: covers a kick that failed at enqueue time and workers that exited with jobs still queued.
  if (open) await kickPlateWorkers().catch(() => undefined);
  await sweepGarbage().catch((error) => log("warn", "plate_garbage_failed", { message: error instanceof Error ? error.message : String(error) }));
  return open;
}

const defaultRemove = async (bucket: "uploads" | "outputs", prefix: string) => {
  if (config.storageDriver !== "r2") return 0;
  return deletePrefix(bucket, prefix);
};

/**
 * Deletes the artifacts of superseded generations, twice (an hour and a day apart) so a late upload from a stale worker is
 * caught too. Skips any prefix whose object keys are still referenced by `app.plate_revisions`.
 */
export async function sweepGarbage(
  limit = 20,
  remove: (bucket: "uploads" | "outputs", prefix: string) => Promise<unknown> = defaultRemove
): Promise<string[]> {
  const { rows } = await pool.query<{ prefix: string; sweeps: number }>(
    `select g.prefix, g.sweeps
       from app.plate_garbage g
      where g.next_sweep_at <= now()
        and not exists (
          select 1 from app.plate_revisions r
           where (r.source_key is not null and (r.source_key = g.prefix or starts_with(r.source_key, rtrim(g.prefix, '/') || '/')))
              or (r.bundle_key is not null and (r.bundle_key = g.prefix or starts_with(r.bundle_key, rtrim(g.prefix, '/') || '/')))
        )
      order by g.next_sweep_at
      limit $1`,
    [limit]
  );
  const swept: string[] = [];
  for (const row of rows) {
    await Promise.all([remove("uploads", row.prefix), remove("outputs", row.prefix)]);
    if (row.sweeps >= 1) await pool.query("delete from app.plate_garbage where prefix = $1", [row.prefix]);
    else await pool.query("update app.plate_garbage set sweeps = sweeps + 1, next_sweep_at = now() + interval '24 hours' where prefix = $1", [row.prefix]);
    swept.push(row.prefix);
  }
  return swept;
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
