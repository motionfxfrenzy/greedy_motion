// Render job protocol, worker half. The backend creates app.render_jobs rows and queues `render-video` with { jobId }; this
// module claims a row for one attempt and writes progress and the result, all through the backend's job-control operations
// (control.mjs): the worker holds no database connection. The statements themselves live in backend/src/jobs/control.ts.
//
// Fencing: pg-boss gives each claim of a message a new retryCount. The worker's attempt number is retryCount + 1, and every
// write is conditional on `attempt = <mine>`. If this worker stalls and the message is redelivered to another worker, the newer
// attempt raises `attempt` and every later write from the stale attempt affects zero rows, so it can never overwrite the newer result.

// Keep in sync with backend/src/jobs/queues.ts.
export const QUEUES = { video: "render-video", finished: "render-finished" };

/** Claims the job for this attempt. Returns the render input, or null if there is nothing to do. Never retried: see control.mjs. */
export async function claim(control, jobId, attempt) {
  return (await control.op("render.claim", { jobId, attempt }, { retry: false })).input ?? null;
}

/** Fenced progress write. Returns false when this attempt no longer owns the job. */
export async function progress(control, jobId, attempt, { stage, progress: percent, framesDone = null, framesTotal = null }) {
  return (await control.op("render.progress", { jobId, attempt, stage, progress: percent, framesDone, framesTotal })).ok === true;
}

/** Records why an attempt failed while pg-boss schedules the retry; the backend shows it if retries run out. */
export async function noteRetry(control, jobId, attempt, error) {
  await control.op("render.noteRetry", { jobId, attempt, error });
}

/** Commits the final state and queues `render-finished` in one transaction (on the backend). False if this attempt was superseded. */
export async function finish(control, jobId, attempt, outcome) {
  return (await control.op("render.finish", { jobId, attempt, outcome })).committed === true;
}
