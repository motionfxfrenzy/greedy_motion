// Render job protocol, worker half. The backend creates app.render_jobs rows and queues `render-video`
// with { jobId }; this module claims a row for one attempt and writes progress and the result.
//
// Fencing: pg-boss gives each claim of a message a new retryCount. The worker's attempt number is
// retryCount + 1, and every write below is conditional on `attempt = <mine>`. If this worker stalls
// and the message is redelivered to another worker, the newer attempt raises `attempt` and every
// later write from the stale attempt affects zero rows, so it can never overwrite the newer result.
import pg from "pg";

// Keep in sync with backend/src/jobs/queues.ts.
export const QUEUES = { video: "render-video", finished: "render-finished" };

export function createPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 4 });
  pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "postgres_pool_error", message: error.message })));
  return pool;
}

/** Claims the job for this attempt. Returns the render input, or null if there is nothing to do. */
export async function claim(pool, jobId, attempt) {
  const result = await pool.query(
    `update app.render_jobs
        set attempt = $2, stage = 'preparing', progress = 50, frames_done = null, frames_total = null,
            error = null, render_started_at = now(), updated_at = now()
      where id = $1 and state = 'rendering' and attempt < $2
      returning render_input`,
    [jobId, attempt]
  );
  return result.rows[0]?.render_input ?? null;
}

/** Fenced progress write. Returns false when this attempt no longer owns the job. */
export async function progress(pool, jobId, attempt, { stage, progress: percent, framesDone = null, framesTotal = null }) {
  const result = await pool.query(
    `update app.render_jobs set stage = $3, progress = $4, frames_done = $5, frames_total = $6, updated_at = now()
      where id = $1 and attempt = $2 and state = 'rendering'`,
    [jobId, attempt, stage, percent, framesDone, framesTotal]
  );
  return result.rowCount === 1;
}

/** Records why an attempt failed while pg-boss schedules the retry; the backend shows it if retries run out. */
export async function noteRetry(pool, jobId, attempt, error) {
  await pool.query(
    `update app.render_jobs set stage = 'retrying', error = $3, updated_at = now()
      where id = $1 and attempt = $2 and state = 'rendering'`,
    [jobId, attempt, error]
  );
}

/**
 * Commits the final state and queues `render-finished` in one transaction, so the backend hears about
 * every committed result exactly when it becomes visible. Returns false if this attempt was superseded.
 */
export async function finish(pool, boss, jobId, attempt, outcome) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = outcome.output
      ? await client.query(
        `update app.render_jobs set state = 'ready', stage = 'done', progress = 100, output = $3, error = null,
                frames_done = frames_total, finished_at = now(), updated_at = now()
          where id = $1 and attempt = $2 and state = 'rendering'`,
        [jobId, attempt, outcome.output])
      : await client.query(
        `update app.render_jobs set state = 'failed', stage = 'failed', progress = 100, error = $3,
                finished_at = now(), updated_at = now()
          where id = $1 and attempt = $2 and state = 'rendering'`,
        [jobId, attempt, outcome.error]);
    if (result.rowCount === 1) {
      await boss.send(QUEUES.finished, { jobId }, { db: { executeSql: (text, values) => client.query(text, values) } });
    }
    await client.query("commit");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
