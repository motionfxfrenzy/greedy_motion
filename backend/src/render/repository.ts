// Render jobs in Postgres (app.render_jobs). The backend writes the planning half of a job's life;
// the render worker writes the rendering half, fenced by `attempt` (see worker/src/jobs.mjs).
import { AsyncLocalStorage } from "node:async_hooks";
import { motionBlur, type RenderJob, type RenderRequest, type RenderStage } from "@videosaas/contracts";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { boss, inTransaction, QUEUES } from "../jobs/queues.ts";
import { kickWorkers } from "../jobs/worker-launcher.ts";
import { refundSpend } from "../tokens/store.ts";
import type { Plan } from "./planner.ts";

const activeIdempotencyKeys = new Map<string, string>();
export const setProjectIdempotencyKey = (projectId: string, key: string): void => {
  activeIdempotencyKeys.set(projectId.toLowerCase(), key);
};
export const clearProjectIdempotencyKey = (projectId: string): void => {
  activeIdempotencyKeys.delete(projectId.toLowerCase());
};
export const getProjectIdempotencyKey = (projectId?: string | null): string | undefined =>
  projectId ? activeIdempotencyKeys.get(projectId.toLowerCase()) : undefined;

/** A motion-blur render captures several times the frames, so its queue expiry (and the worker's claim) is stretched by the same factor. */
const blurExpiry = (renderInput: Record<string, unknown>) => (renderInput.motionBlur === true ? { expireInSeconds: config.renderTimeoutSeconds * motionBlur.slowdown } : {});
/** A story film writes, draws props, speaks, composes and paints in one job: far longer than a template render. */

type Row = {
  id: string;
  project_id: string | null;
  owner_id: string | null;
  state: RenderJob["state"];
  stage: RenderStage;
  progress: number;
  attempt: number;
  frames_done: number | null;
  frames_total: number | null;
  request: RenderRequest;
  planned_revision: Plan | null;
  revision: RenderJob["revision"];
  output: (NonNullable<RenderJob["output"]> & { file?: string }) | null;
  error: (NonNullable<RenderJob["error"]> & { detail?: string }) | null;
  created_at: Date;
  updated_at: Date;
  render_queued_at: Date | null;
  prep: FilmPrep | null;
  idempotency_key?: string | null;
};

/** A storyboard film's backend preparation, done by the planning consumer before the job reaches the render queue. */
export type FilmPrep = { kind: "beat-plan"; watermark: boolean; motionBlur: boolean; ownerId: string; spendEvent: string | null };

export type StoredRenderJob = Row;

/** The browser-facing view. Internal fields (file paths, raw renderer output) stay on the server. */
function toView(row: Row, queuePosition?: number): RenderJob {
  return {
    id: row.id,
    state: row.state,
    stage: row.stage,
    progress: row.progress,
    ...(row.frames_total ? { frames: { done: row.frames_done ?? 0, total: row.frames_total } } : {}),
    ...(queuePosition !== undefined ? { queuePosition } : {}),
    ...(row.attempt > 0 ? { attempt: row.attempt } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    revision: row.revision,
    ...(row.output ? { output: { url: row.output.url, format: row.output.format, durationSeconds: row.output.durationSeconds } } : {}),
    ...(row.error ? { error: { code: row.error.code, message: row.error.message } } : {})
  };
}

export const renderJobRepository = {
  async findByIdempotencyKey(projectId: string, idempotencyKey: string): Promise<RenderJob | null> {
    const clean = idempotencyKey.trim();
    if (!clean) return null;
    const { rows } = await pool.query<{ id: string }>(
      "select id from app.render_jobs where project_id = $1 and idempotency_key = $2 limit 1",
      [projectId, clean]
    );
    if (!rows[0]) return null;
    return this.find(rows[0].id);
  },

  /** Inserts the job and its planning message in one transaction: no job without a message, and vice versa. */
  async createAndEnqueue(job: RenderJob, input: { request: RenderRequest; projectId?: string; ownerId?: string; plannedRevision?: Plan; prep?: FilmPrep; idempotencyKey?: string }) {
    const idemKey = (input.idempotencyKey ?? getProjectIdempotencyKey(input.projectId) ?? "").trim() || null;
    const client = await pool.connect();
    let conflicted = false;
    try {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into app.render_jobs (id, project_id, owner_id, state, stage, progress, request, planned_revision, revision, prep, idempotency_key, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (project_id, idempotency_key) where idempotency_key is not null and project_id is not null do nothing
         returning id`,
        [job.id, input.projectId ?? null, input.ownerId ?? null, job.state, "queued", job.progress, input.request, input.plannedRevision ?? null, job.revision, input.prep ?? null, idemKey, job.createdAt]
      );
      if (inserted.rowCount === 1) {
        await boss.send(QUEUES.plan, { jobId: job.id }, { db: inTransaction(client) });
        await client.query("commit");
      } else {
        conflicted = true;
        await client.query("rollback");
      }
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (conflicted && input.projectId && idemKey) {
      if (input.prep?.spendEvent && input.prep?.ownerId) {
        await refundSpend(input.prep.ownerId, input.prep.spendEvent).catch(() => undefined);
      }
      const existing = await this.findByIdempotencyKey(input.projectId, idemKey);
      if (existing) return existing;
    }
    return { ...job, stage: "queued" as const };
  },

  /**
   * For work that needs no planning (an approved storyboard): the row starts in the render queue and the
   * render message is sent in the same transaction.
   */
  async createReadyAndEnqueue(job: RenderJob, input: { request: RenderRequest; projectId: string; renderInput: Record<string, unknown> }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into app.render_jobs (id, project_id, state, stage, progress, request, revision, render_input, render_queued_at, created_at)
         values ($1, $2, 'rendering', 'waiting', 45, $3, $4, $5, now(), $6)`,
        [job.id, input.projectId, input.request, job.revision, input.renderInput, job.createdAt]
      );
      await boss.send(QUEUES.video, { jobId: job.id }, { db: inTransaction(client), ...blurExpiry(input.renderInput) });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    void kickWorkers(true);
    return { ...job, state: "rendering" as const, stage: "waiting" as const, progress: 45 };
  },

  /**
   * A format render (formats/routes.ts): ready for the worker, owned by a user,
   * optionally linked to its project so completion updates the project's state.
   */
  async createFormatAndEnqueue(job: RenderJob, input: { request: Record<string, unknown>; ownerId: string; projectId?: string; renderInput: Record<string, unknown>; queue?: string }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into app.render_jobs (id, project_id, owner_id, state, stage, progress, request, revision, render_input, render_queued_at, created_at)
         values ($1, $2, $3, 'rendering', 'waiting', 45, $4, $5, $6, now(), $7)`,
        [job.id, input.projectId ?? null, input.ownerId, input.request, job.revision, input.renderInput, job.createdAt]
      );
      await boss.send(input.queue ?? QUEUES.video, { jobId: job.id }, { db: inTransaction(client), ...blurExpiry(input.renderInput) });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    void kickWorkers(true);
    return { ...job, state: "rendering" as const, stage: "waiting" as const, progress: 45 };
  },

  async row(id: string) {
    const result = await pool.query<Row>("select * from app.render_jobs where id = $1", [id]);
    return result.rows[0] ?? null;
  },

  /** Who a job belongs to, for the ownership check that runs on every job request. */
  async owners(id: string) {
    const result = await pool.query<Pick<Row, "project_id" | "owner_id">>("select project_id, owner_id from app.render_jobs where id = $1", [id]);
    return result.rows[0] ?? null;
  },

  /**
   * The browser view, read in one query: only the columns the view uses (not the request, plan or worker input), and the
   * queue position counted in the same statement while the job waits for a renderer.
   */
  async find(id: string) {
    const result = await pool.query<Row & { ahead: string | null }>(
      `select id, state, stage, progress, attempt, frames_done, frames_total, revision, created_at, updated_at, render_queued_at,
              output - 'file' as output, error - 'detail' as error,
              case when state = 'rendering' and stage = 'waiting' and render_queued_at is not null then
                (select count(*) from app.render_jobs w where w.state = 'rendering' and w.stage = 'waiting' and w.render_queued_at < j.render_queued_at)
              end as ahead
       from app.render_jobs j where id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return toView(row, row.ahead === null ? undefined : Number(row.ahead));
  },

  /** Claims a queued job for planning. Returns null when another delivery already moved it on. */
  async beginPlanning(id: string) {
    const result = await pool.query<Row>(
      `update app.render_jobs set state = 'planning', stage = 'planning', progress = 15, error = null, updated_at = now()
       where id = $1 and state in ('queued', 'planning') returning *`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  async updatePlanning(id: string, patch: { stage: RenderStage; progress: number; revision?: RenderJob["revision"] }) {
    await pool.query(
      `update app.render_jobs set stage = $2, progress = $3, revision = coalesce($4, revision), updated_at = now()
       where id = $1 and state = 'planning'`,
      [id, patch.stage, patch.progress, patch.revision ?? null]
    );
  },

  /** Records the error of a planning attempt that will be retried; the dead-letter handler reuses it. */
  async notePlanningError(id: string, error: { code: string; message: string }) {
    await pool.query("update app.render_jobs set error = $2, updated_at = now() where id = $1 and state = 'planning'", [id, error]);
  },

  /**
   * Hands a planned job to the render queue: the state change and the render message commit together,
   * and only the first delivery that finds the job still planning sends the message.
   */
  async queueRender(id: string, revision: RenderJob["revision"], renderInput: Record<string, unknown>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const moved = await client.query(
        `update app.render_jobs set state = 'rendering', stage = 'waiting', progress = 45, revision = $2, render_input = $3,
           error = null, render_queued_at = now(), updated_at = now()
         where id = $1 and state = 'planning' returning id`,
        [id, revision, renderInput]
      );
      if (moved.rowCount === 1) await boss.send(QUEUES.video, { jobId: id }, { db: inTransaction(client), ...blurExpiry(renderInput) });
      await client.query("commit");
      if (moved.rowCount === 1) void kickWorkers(true);
      return moved.rowCount === 1;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Marks a job failed unless it already finished. With `keepRecorded`, a more specific error recorded by
   * the last attempt wins (e.g. "brand kit no longer exists"); otherwise `failure` replaces it and the
   * recorded technical detail is kept for the logs.
   */
  async failIfUnfinished(id: string, failure: { code: string; message: string }, keepRecorded: boolean) {
    const result = await pool.query<Row>(
      `update app.render_jobs set state = 'failed', stage = 'failed', progress = 100,
         error = case when $3 and error is not null then error
                      else jsonb_strip_nulls(jsonb_build_object('code', $2::jsonb->>'code', 'message', $2::jsonb->>'message', 'detail', error->>'detail')) end,
         finished_at = now(), updated_at = now()
       where id = $1 and state not in ('ready', 'failed') returning *`,
      [id, failure, keepRecorded]
    );
    return result.rows[0] ?? null;
  }
};
