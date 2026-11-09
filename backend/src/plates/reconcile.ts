import { pool } from "../db/database.ts";
import { boss, POLL, QUEUES, sendOnce } from "../jobs/queues.ts";
import { startSweep } from "../jobs/sweep.ts";
import { kickPlateWorkers } from "../jobs/worker-launcher.ts";
import { config } from "../config.ts";
import { deletePrefix } from "../storage.ts";
import { handleAuthor, handleAuthorDead, type AuthorMessage } from "./author.ts";
import { failVariant, fallbackCheckVariantClipWithClient, type VariantRetrying } from "./store.ts";

/**
 * Recovery. Queue messages and rows commit together, but a message can still be lost (queue maintenance, a crash between a
 * lease expiring and its retry, a worker task that never started). This sweep re-sends a message for every row that has
 * waited too long in a state that needs one, and asks for workers while any work is open. Re-sending is always safe: every
 * consumer claims its row atomically and acts only if its generation still matches.
 */
const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));
const RESEND_AFTER = "90 seconds";
const ROLLBACK_PASS_LIMIT = 20;
export const CHECK_GRACE_SECONDS = Math.max(1, Number.parseInt(process.env.PLATE_CHECK_GRACE_SECONDS ?? "180", 10) || 180);
export const CHECK_GRACE = CHECK_GRACE_SECONDS;
export const CHECK_FALLBACK_REASON = "the preview check did not report; drawing it on the server";
export const PLATE_MAX_SWEEP_RETRIES = Math.max(1, Number.parseInt(process.env.PLATE_MAX_SWEEP_RETRIES ?? "4", 10) || 4);
export const MAX_SWEEP_RETRIES = PLATE_MAX_SWEEP_RETRIES;
const checkGraceSeconds = () => Math.max(1, Number.parseInt(process.env.PLATE_CHECK_GRACE_SECONDS ?? String(config.plates.checkGraceSeconds ?? CHECK_GRACE_SECONDS), 10) || CHECK_GRACE_SECONDS);
const maxSweepRetries = () => Math.max(1, Number.parseInt(process.env.PLATE_MAX_SWEEP_RETRIES ?? String(PLATE_MAX_SWEEP_RETRIES), 10) || PLATE_MAX_SWEEP_RETRIES);

export type CheckGraceCandidate = {
  id: string;
  gen: number;
  state: string;
  stage?: string | null;
  liveMode?: "live" | "clip" | null;
  bundleDigest?: string | null;
  clipKey?: string | null;
  hasCheckReport?: boolean;
  checkReportIsWatchdogTimeout?: boolean;
  updatedAt: Date | string | number;
  timings?: { retrying?: { attempt?: number; reason?: string } } | null;
};

export type CheckGraceEvaluation =
  | {
      fallback: true;
      stage: "queued for rendering";
      singletonKey: string;
      retrying: { attempt: number; reason: string; at: number };
    }
  | {
      fallback: false;
      reason: "not_live" | "wrong_state" | "wrong_stage" | "has_clip" | "no_digest" | "already_reported" | "within_grace";
    };

/**
 * Pure DB-free evaluator for the live check-grace watchdog (testable with a fake clock `now`).
 */
export function evaluateCheckGraceFallback(
  candidate: CheckGraceCandidate,
  options: { now?: number; checkGraceSeconds?: number } = {}
): CheckGraceEvaluation {
  const now = options.now ?? Date.now();
  const graceMs = (options.checkGraceSeconds ?? checkGraceSeconds()) * 1000;
  if (candidate.liveMode !== "live") return { fallback: false, reason: "not_live" };
  if (candidate.state !== "bundled") return { fallback: false, reason: "wrong_state" };
  if (candidate.stage !== "checking") return { fallback: false, reason: "wrong_stage" };
  if (candidate.clipKey) return { fallback: false, reason: "has_clip" };
  if (!candidate.bundleDigest) return { fallback: false, reason: "no_digest" };
  if (candidate.hasCheckReport && !candidate.checkReportIsWatchdogTimeout) {
    return { fallback: false, reason: "already_reported" };
  }

  const updatedMs =
    candidate.updatedAt instanceof Date
      ? candidate.updatedAt.getTime()
      : typeof candidate.updatedAt === "number"
        ? candidate.updatedAt
        : Date.parse(String(candidate.updatedAt));
  if (!Number.isFinite(updatedMs) || now - updatedMs < graceMs) {
    return { fallback: false, reason: "within_grace" };
  }

  const prevAttempt = Number(candidate.timings?.retrying?.attempt ?? 0);
  const attempt = (Number.isFinite(prevAttempt) && prevAttempt > 0 ? prevAttempt : 0) + 1;
  return {
    fallback: true,
    stage: "queued for rendering",
    singletonKey: `${candidate.id}:${candidate.gen}`,
    retrying: {
      attempt,
      reason: CHECK_FALLBACK_REASON,
      at: now
    }
  };
}

export async function reconcilePlates(): Promise<number> {
  const client = await pool.connect();
  let resent = 0, open = 0;
  const forceOff = config.plates.liveForceOff;
  const graceSecs = checkGraceSeconds();
  try {
    await client.query("begin");

    if (forceOff) {
      const flipped = await client.query<{ project_id: string }>(
        "update app.plate_state set live_mode = 'clip', updated_at = now() where live_mode = 'live' returning project_id"
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
        await sendOnce(client, QUEUES.plateRender, { variantId: v.id, gen: v.gen }, `${v.id}:${v.gen}`);
        resent++;
      }
    } else {
      const stuckChecks = await client.query<{
        id: string;
        project_id: string;
        scene_index: number;
        aspect: string;
        gen: number;
        bundle_digest: string;
        timings: { retrying?: VariantRetrying } | null;
      }>(
        `select v.id, v.project_id, v.scene_index, v.aspect, v.gen, v.bundle_digest, v.timings
           from app.plate_variants v
           join app.plate_state s on s.project_id = v.project_id
          where v.state = 'bundled'
            and v.stage = 'checking'
            and v.clip_key is null
            and v.bundle_digest is not null
            and s.live_mode = 'live'
            and v.updated_at < now() - make_interval(secs => $1)
            and not exists (
              select 1 from app.plate_check_reports r
               where r.variant_id = v.id
                 and r.gen = v.gen
                 and r.bundle_digest = v.bundle_digest
                 and not (
                   r.report->'results'->>'kind' = 'env'
                   and coalesce(r.report->'results'->>'error', r.report->'results'->>'message', '') ~* '(watchdog|init-timeout|frame-timeout|check-watchdog|heartbeat-timeout)'
                 )
            )
          order by v.created_at, v.scene_index, v.aspect
          for update of v skip locked`,
        [graceSecs]
      );
      for (const v of stuckChecks.rows) {
        const out = await fallbackCheckVariantClipWithClient(
          client,
          { ...v, aspect: v.aspect as any, timings: (v.timings ?? {}) as any },
          config.plates.projectClipCap
        );
        if (out.status === "ok") {
          resent++;
          log("info", "plate_check_fallback", {
            variantId: v.id,
            projectId: v.project_id,
            scene: v.scene_index,
            aspect: v.aspect,
            gen: v.gen,
            bundleDigest: v.bundle_digest,
            attempt: out.attempt
          });
        }
      }
    }

    const variants = await client.query<{ id: string; gen: number; state: string; timings: { retrying?: VariantRetrying } | null }>(
      `select v.id, v.gen, v.state, v.timings
         from app.plate_variants v
         left join app.plate_state s on s.project_id = v.project_id
        where (
            v.state in ('queued', 'authoring', 'rendering')
            or (
              not $2::boolean
              and v.state in ('bundled', 'checked')
              and v.clip_key is null
              and (
                coalesce(s.live_mode, 'clip') <> 'live'
                or v.stage = 'queued for rendering'
              )
            )
          )
          and (v.enqueued_at is null or v.enqueued_at < now() - $1::interval)
          and (v.state <> 'authoring' or v.author_until < now())
          and (v.state <> 'rendering' or v.updated_at < now() - $1::interval)
        for update of v skip locked`,
      [RESEND_AFTER, forceOff]
    );
    const maxRetries = maxSweepRetries();
    for (const v of variants.rows) {
      const prevAttempt = Number(v.timings?.retrying?.attempt ?? 0);
      const safePrev = Number.isFinite(prevAttempt) && prevAttempt > 0 ? prevAttempt : 0;
      // Only a scene that LOST progress (a worker or writer died) can stall out. One merely waiting for its turn (project caps, a worker
      // still starting) is resent forever without failing: a long film legitimately queues for many minutes.
      const lostProgress = v.state === "rendering" || v.state === "authoring";
      if (lostProgress && safePrev >= maxRetries) {
        await client.query(
          `update app.plate_variants
              set state = 'failed', stage = null,
                  error = $3::jsonb,
                  author_owner = null, author_until = null,
                  timings = coalesce(timings, '{}'::jsonb) - 'retrying',
                  updated_at = now()
            where id = $1 and gen = $2 and state in ('queued', 'authoring', 'bundled', 'checked', 'rendering')`,
          [
            v.id,
            v.gen,
            JSON.stringify({
              code: "scene_stalled",
              message: "This scene stopped making progress. Press Draw to try again."
            })
          ]
        );
        continue;
      }
      const attempt = safePrev + 1;
      const reason =
        v.state === "rendering"
          ? "the drawing worker restarted"
          : v.state === "authoring"
            ? "the writing process restarted"
            : "the scene was waiting for a worker";
      const retrying = JSON.stringify({ attempt, reason, at: Date.now() });
      const kind = v.state === "bundled" || v.state === "checked" || v.state === "rendering" ? "render" : "author";
      if (kind === "render" && (v.state === "bundled" || v.state === "checked")) {
        await client.query(
          `update app.plate_variants
              set state = 'bundled', stage = 'queued for rendering', enqueued_at = now(),
                  timings = coalesce(timings, '{}'::jsonb) || jsonb_build_object('retrying', $2::jsonb),
                  updated_at = now()
            where id = $1`,
          [v.id, retrying]
        );
        await sendOnce(client, QUEUES.plateRender, { variantId: v.id, gen: v.gen }, `${v.id}:${v.gen}`);
      } else {
        await client.query(
          `update app.plate_variants
              set enqueued_at = now(),
                  timings = case when $3::boolean then coalesce(timings, '{}'::jsonb) || jsonb_build_object('retrying', $2::jsonb) else timings end
            where id = $1`,
          // A scene still queued for its author slot is just waiting its turn: resent quietly, not shown as "retrying".
          [v.id, retrying, v.state !== "queued"]
        );
        await sendOnce(
          client,
          kind === "render" ? QUEUES.plateRender : QUEUES.plateAuthor,
          { variantId: v.id, gen: v.gen },
          `${v.id}:${v.gen}`
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
      await sendOnce(client, QUEUES.plateExport, { exportId: e.id }, `export:${e.id}`);
      resent++;
    }
    // A render that could not even be claimed (database/pooler/worker trouble) is dead-lettered as `render_unavailable`; its bundle is
    // intact, so retry it from the bundle (no model call) up to twice before leaving it for the person's Draw.
    const revived = await client.query<{ id: string; gen: number }>(
      `update app.plate_variants set state = 'bundled', gen = gen + 1, render_attempt = 0, error = null, stage = 'retrying', enqueued_at = now(), updated_at = now(),
         timings = (coalesce(timings, '{}'::jsonb) - 'retrying' - 'restartsDuringWrite') || jsonb_build_object('autoRetries', coalesce((timings->>'autoRetries')::int, 0) + 1)
        where state = 'failed' and error->>'code' = 'render_unavailable' and bundle_key is not null and updated_at < now() - $1::interval
          and coalesce((timings->>'autoRetries')::int, 0) < 2 returning id, gen`, [RESEND_AFTER]);
    for (const v of revived.rows) { await sendOnce(client, QUEUES.plateRender, { variantId: v.id, gen: v.gen }, `${v.id}:${v.gen}`); resent++; }
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
                     or v.stage = 'queued for rendering'
                     or (
                       v.state = 'bundled'
                       and v.stage = 'checking'
                       and v.bundle_digest is not null
                       and s.live_mode = 'live'
                       and v.updated_at < now() - make_interval(secs => $1)
                       and not exists (
                         select 1 from app.plate_check_reports r
                          where r.variant_id = v.id
                            and r.gen = v.gen
                            and r.bundle_digest = v.bundle_digest
                            and not (
                              r.report->'results'->>'kind' = 'env'
                              and coalesce(r.report->'results'->>'error', r.report->'results'->>'message', '') ~* '(watchdog|init-timeout|frame-timeout|check-watchdog|heartbeat-timeout)'
                            )
                       )
                     )
                   )
                 )
           ) + (
             select count(*) from app.plate_exports where state in ('queued', 'assembling')
           ) as n`,
          [graceSecs]
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
  if (open) await kickPlateWorkers(false).catch(() => undefined);
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
        and not exists (
          select 1 from app.plate_clips c
           where (c.clip_key = g.prefix or starts_with(c.clip_key, rtrim(g.prefix, '/') || '/'))
              or (c.still_key is not null and (c.still_key = g.prefix or starts_with(c.still_key, rtrim(g.prefix, '/') || '/')))
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
