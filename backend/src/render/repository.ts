// Render jobs in Postgres (app.render_jobs). The backend writes the planning half of a job's life;
// the render worker writes the rendering half, fenced by `attempt` (see worker/src/jobs.mjs).
import type { RenderJob, RenderRequest, RenderStage } from "@videosaas/contracts";
import { pool } from "../db/database.ts";
import { boss, inTransaction, QUEUES } from "../jobs/queues.ts";
import type { Plan } from "./planner.ts";

type Row = {
  id: string;
  project_id: string | null;
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
};

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
  /** Inserts the job and its planning message in one transaction: no job without a message, and vice versa. */
  async createAndEnqueue(job: RenderJob, input: { request: RenderRequest; projectId?: string; plannedRevision?: Plan }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into app.render_jobs (id, project_id, state, stage, progress, request, planned_revision, revision, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [job.id, input.projectId ?? null, job.state, "queued", job.progress, input.request, input.plannedRevision ?? null, job.revision, job.createdAt]
      );
      await boss.send(QUEUES.plan, { jobId: job.id }, { db: inTransaction(client) });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
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
      await boss.send(QUEUES.video, { jobId: job.id }, { db: inTransaction(client) });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { ...job, state: "rendering" as const, stage: "waiting" as const, progress: 45 };
  },

  async row(id: string) {
    const result = await pool.query<Row>("select * from app.render_jobs where id = $1", [id]);
    return result.rows[0] ?? null;
  },

  async find(id: string) {
    const row = await this.row(id);
    if (!row) return null;
    if (row.state === "rendering" && row.stage === "waiting" && row.render_queued_at) {
      const ahead = await pool.query<{ count: string }>(
        "select count(*) from app.render_jobs where state = 'rendering' and stage = 'waiting' and render_queued_at < $1",
        [row.render_queued_at]
      );
      return toView(row, Number(ahead.rows[0]?.count ?? 0));
    }
    return toView(row);
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
      if (moved.rowCount === 1) await boss.send(QUEUES.video, { jobId: id }, { db: inTransaction(client) });
      await client.query("commit");
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
