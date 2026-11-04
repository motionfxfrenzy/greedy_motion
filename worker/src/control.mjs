// The worker's only link to Postgres and pg-boss: HTTPS calls to the backend's job-control routes (docs/JOB_CONTROL.md).
// No database credentials, no pooler clients. Every call is bounded: timeouts, capped retries with jittered backoff.
import { randomUUID } from "node:crypto";

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});
const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));

export class ControlError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createControl({ url = process.env.WORKER_CONTROL_URL, token = process.env.WORKER_CONTROL_TOKEN, workerId = randomUUID(), fetchImpl = fetch } = {}) {
  if (!url || !token) throw new Error("WORKER_CONTROL_URL and WORKER_CONTROL_TOKEN are required: the worker reaches Postgres only through the backend.");
  const base = url.replace(/\/$/, "");

  async function post(path, body, { timeoutMs = 20_000, signal } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!response.ok) throw new ControlError(json?.error?.message ?? `Job control answered ${response.status}.`, response.status);
    return json;
  }

  /** Retries network failures and 5xx a few times (bounded); a 4xx is final. */
  async function withRetry(run, { tries, signal }) {
    let delay = 500;
    for (let attempt = 1; ; attempt++) {
      try { return await run(); }
      catch (error) {
        const final = attempt >= tries || signal?.aborted || (error instanceof ControlError && error.status >= 400 && error.status < 500);
        if (final) throw error;
        await sleep(jitter(delay), signal);
        delay = Math.min(delay * 2, 8000);
      }
    }
  }

  return {
    workerId,
    /**
     * A persistence step. `retry: false` for claims: repeating a claim after a lost answer would see the row already taken and skip
     * a job this worker actually holds, so a failed claim is raised and the job is handed back to pg-boss instead.
     */
    op: (name, args = {}, { retry = true, signal } = {}) => withRetry(() => post(`/internal/worker/op/${name}`, args, { signal }), { tries: retry ? 4 : 1, signal }),
    /** Held open by the backend for up to waitSeconds; resolves with 0..n leased jobs. */
    poll: (slots, { waitSeconds = 25, signal } = {}) => post("/internal/worker/poll", { workerId, slots, waitSeconds }, { timeoutMs: (waitSeconds + 10) * 1000, signal }),
    heartbeat: (queue, id, attempt, signal) => post(`/internal/worker/jobs/${queue}/${id}/heartbeat`, { workerId, attempt }, { timeoutMs: 10_000, signal }),
    complete: (queue, id, attempt) => withRetry(() => post(`/internal/worker/jobs/${queue}/${id}/complete`, { workerId, attempt }), { tries: 5 }),
    fail: (queue, id, attempt, reason) => withRetry(() => post(`/internal/worker/jobs/${queue}/${id}/fail`, { workerId, attempt, reason }), { tries: 5 })
  };
}

/**
 * Runs `handler(job)` for one leased job, keeping the lease alive and acknowledging the outcome.
 *  - the lease is renewed every leaseSeconds/3; an answer of "not yours", or no successful renewal for leaseSeconds, aborts job.signal;
 *  - handler returns   -> complete;  handler throws -> fail (pg-boss retries with its own back-off);
 *  - aborted by the lease or shutdown -> no acknowledgment: the lease lapses and the attempt is retried, never lost.
 */
export async function runLeased(control, lease, handler, { shutdown } = {}) {
  const lost = new AbortController();
  const job = { id: lease.id, queue: lease.queue, data: lease.data, retryCount: lease.attempt - 1, signal: AbortSignal.any([lost.signal, ...(shutdown ? [shutdown] : [])]) };
  let lastOk = Date.now();
  const timer = setInterval(async () => {
    try {
      const answer = await control.heartbeat(lease.queue, lease.id, lease.attempt);
      if (answer?.ok) lastOk = Date.now();
      else lost.abort(new Error(`The lease was lost (${answer?.reason ?? "unknown"}).`));
    } catch {
      if (Date.now() - lastOk > lease.leaseSeconds * 1000) lost.abort(new Error("Job control was unreachable for a whole lease."));
    }
  }, Math.max(2000, Math.floor((lease.leaseSeconds * 1000) / 3)));
  try {
    await handler(job);
    if (lost.signal.aborted) return "lost";
    await control.complete(lease.queue, lease.id, lease.attempt);
    return "completed";
  } catch (error) {
    if (lost.signal.aborted || shutdown?.aborted) return "abandoned";
    await control.fail(lease.queue, lease.id, lease.attempt, error instanceof Error ? error.message : "failed").catch(() => undefined);
    return "failed";
  } finally {
    clearInterval(timer);
  }
}

/**
 * The consume loop: one outstanding poll at a time while any slot is free, capped backoff after errors. Returns when `stop` aborts.
 * `slots()` says how many jobs of each queue this worker can take right now; `onJob(lease)` starts one (it must not block the loop).
 */
export async function consume(control, { slots, onJob, stop, log = () => {} }) {
  let backoff = 1000;
  while (!stop.aborted) {
    const free = slots();
    if (!Object.values(free).some((n) => n > 0)) { await sleep(500, stop); continue; }
    try {
      const { jobs } = await control.poll(free, { signal: stop });
      backoff = 1000;
      for (const lease of jobs ?? []) onJob(lease);
    } catch (error) {
      if (stop.aborted) break;
      log("warn", "poll_failed", { message: error instanceof Error ? error.message : String(error), retryInMs: backoff });
      await sleep(jitter(backoff), stop);
      backoff = Math.min(backoff * 2, 15_000);
    }
  }
}
