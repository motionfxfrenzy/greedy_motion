// The worker's only link to Postgres and pg-boss: HTTPS calls to the backend's job-control routes (docs/JOB_CONTROL.md).
// No database credentials, no pooler clients. Every call is bounded: timeouts, capped retries with full-jitter backoff.
import { randomUUID } from "node:crypto";

const defaultSleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class ControlError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ESOCKETTIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE"
]);

const TRANSIENT_MESSAGE_RE = /\b(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|UND_ERR_[A-Z0-9_]+|other side closed|socket hang up|premature close|truncated response|empty poll response)\b/i;

function extractErrorCode(error) {
  if (!error || typeof error !== "object") return "";
  if (typeof error.code === "string" && error.code) return error.code;
  if (error.cause && typeof error.cause === "object" && typeof error.cause.code === "string") return error.cause.code;
  return "";
}

/**
 * Classifies transient errors (EPIPE, ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN, UND_ERR_*,
 * AbortError/TimeoutError from request timeouts, `TypeError: fetch failed` / `terminated` with such a cause,
 * HTTP 408/425/429/500/502/503/504) vs final errors (other 4xx, malformed JSON).
 */
export function isTransient(error, seen = new Set()) {
  if (!error || typeof error !== "object") return false;
  if (seen instanceof Set) {
    if (seen.has(error)) return false;
    seen.add(error);
  }
  if (error.malformed === true || error.code === "malformed" || error instanceof SyntaxError) {
    return false;
  }
  if (error instanceof ControlError || typeof error.status === "number") {
    const status = Number(error.status);
    if (TRANSIENT_HTTP_STATUS.has(status)) return true;
    if (status >= 400 && status < 600) return false;
  }
  const code = typeof error.code === "string" ? error.code : "";
  if (code && (TRANSIENT_CODES.has(code) || code.startsWith("UND_ERR_"))) {
    return true;
  }
  const name = typeof error.name === "string" ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError" || name === "SocketError") {
    return true;
  }
  if (error.cause && isTransient(error.cause, seen instanceof Set ? seen : new Set())) {
    return true;
  }
  if (Array.isArray(error.errors) && error.errors.some((e) => isTransient(e, seen instanceof Set ? seen : new Set()))) {
    return true;
  }
  const msg = typeof error.message === "string" ? error.message : "";
  if (error instanceof TypeError) {
    if (error.cause) return false;
    if (/^(fetch failed|terminated)\b/i.test(msg.trim())) return true;
    return TRANSIENT_MESSAGE_RE.test(msg);
  }
  if (TRANSIENT_MESSAGE_RE.test(msg)) {
    return true;
  }
  return false;
}

export const isTransientControlError = isTransient;

/** Full jitter backoff in [1, cap] where cap = min(maxMs, baseMs * 2^(attempt-1)). */
export function fullJitterDelay(attempt, { baseMs = 500, maxMs = 15_000, random = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.max(1, Math.floor(random() * cap));
}

function attachStreamErrorGuard(stream) {
  if (stream && typeof stream === "object" && typeof stream.on === "function") {
    stream.on("error", () => {});
  }
}

export function createControl({
  url = process.env.WORKER_CONTROL_URL,
  token = process.env.WORKER_CONTROL_TOKEN,
  workerId = randomUUID(),
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  randomImpl = Math.random,
  nowImpl = Date.now,
  baseDelayMs = 500,
  maxDelayMs = 15_000,
  retryCapMs = 90_000,
  ackRetryCapMs,
  opRetryCapMs,
  log = (level, event, fields = {}) => console.log(JSON.stringify({ level, event, ...fields }))
} = {}) {
  if (!url || !token) throw new Error("WORKER_CONTROL_URL and WORKER_CONTROL_TOKEN are required: the worker reaches Postgres only through the backend.");
  const base = url.replace(/\/$/, "");
  const defaultAckCapMs = ackRetryCapMs ?? retryCapMs ?? 90_000;
  const defaultOpCapMs = opRetryCapMs ?? retryCapMs ?? 90_000;

  let inOutage = false;
  let outageStartedAt = 0;
  let outageFailures = 0;

  const markOutageFailure = (emitLog, error, retryInMs) => {
    outageFailures += 1;
    if (!inOutage) {
      inOutage = true;
      outageStartedAt = nowImpl();
      emitLog("warn", "poll_failed", {
        status: error instanceof ControlError ? error.status : undefined,
        code: extractErrorCode(error) || undefined,
        message: error instanceof Error ? error.message : String(error),
        retryInMs
      });
    }
  };

  const markOutageRecovered = (emitLog) => {
    if (!inOutage) return;
    const downMs = Math.max(0, nowImpl() - outageStartedAt);
    const failures = outageFailures;
    inOutage = false;
    outageStartedAt = 0;
    outageFailures = 0;
    emitLog("info", "control_recovered", { failures, downMs });
  };

  async function post(path, body, { timeoutMs = 20_000, signal } = {}) {
    const timeoutSig = AbortSignal.timeout(timeoutMs);
    const reqSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: reqSignal
    });
    attachStreamErrorGuard(response?.body);
    const text = await response.text();
    const trimmed = text ? text.trim() : "";
    let json = null;
    if (trimmed) {
      try {
        json = JSON.parse(trimmed);
      } catch {
        if (!response.ok) {
          throw new ControlError(`Job control answered ${response.status}.`, response.status);
        }
        // A response that started as JSON but was cut before its closing brace/bracket is a truncated stream (transient).
        if ((trimmed.startsWith("{") && !trimmed.endsWith("}")) || (trimmed.startsWith("[") && !trimmed.endsWith("]"))) {
          throw Object.assign(new Error(`Truncated response from ${path}.`), { code: "ECONNRESET" });
        }
        throw Object.assign(new ControlError(`Malformed JSON response from ${path}.`, response.status, "malformed"), { malformed: true });
      }
    }
    if (!response.ok) {
      throw new ControlError(json?.error?.message ?? `Job control answered ${response.status}.`, response.status, json?.error?.code);
    }
    return json;
  }

  /**
   * Time-bounded retry for `op`, `complete`, and `fail`.
   * - `retry: false` (claims): 1 try, never retried.
   * - Non-transient errors (e.g. 401/403/4xx/malformed): throw immediately.
   * - Transient errors: retry with full-jitter backoff (0.5 s .. 15 s) until `maxMs` (default 90 s).
   * - For `complete` / `fail` (`giveUpOnCap: true`): when the time cap is reached, log and return `{ ok: false, gaveUp: true }` without throwing.
   */
  async function withTimeBoundedRetry(run, { retry = true, maxMs = defaultOpCapMs, signal, giveUpOnCap = false, meta = {} } = {}) {
    const startedAt = nowImpl();
    const deadline = startedAt + maxMs;
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (!retry || !isTransient(error)) throw error;
        const now = nowImpl();
        const remaining = deadline - now;
        if (remaining <= 0 || signal?.aborted) {
          if (giveUpOnCap) {
            log("warn", "control_ack_gave_up", {
              ...meta,
              attempts: attempt,
              elapsedMs: now - startedAt,
              message: error instanceof Error ? error.message : String(error)
            });
            return { ok: false, gaveUp: true };
          }
          throw error;
        }
        const delay = Math.min(
          fullJitterDelay(attempt, { baseMs: baseDelayMs, maxMs: maxDelayMs, random: randomImpl }),
          remaining
        );
        await sleepImpl(delay, signal);
      }
    }
  }

  return {
    workerId,
    /**
     * A persistence step. `retry: false` for claims: repeating a claim after a lost answer would see the row already taken and skip
     * a job this worker actually holds, so a failed claim is raised and the job is handed back to pg-boss instead.
     */
    op: (name, args = {}, { retry = true, maxRetryMs, capMs, signal } = {}) =>
      withTimeBoundedRetry(() => post(`/internal/worker/op/${name}`, args, { signal }), {
        retry,
        maxMs: maxRetryMs ?? capMs ?? defaultOpCapMs,
        signal,
        giveUpOnCap: false,
        meta: { op: name }
      }),

    /**
     * Held open by the backend for up to waitSeconds; resolves with `{ jobs }`.
     * Any transient error or a cleanly ended/empty answer simply re-issues after capped backoff 0.5 s..15 s with full jitter;
     * logs ONE structured warning per outage episode (first failure) and ONE `control_recovered` info when it works again.
     */
    poll: async (slots, { waitSeconds = 25, signal, log: pollLog } = {}) => {
      const emitLog = pollLog ?? log;
      let attempt = 0;
      for (;;) {
        if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
        try {
          const json = await post("/internal/worker/poll", { workerId, slots, waitSeconds }, { timeoutMs: (waitSeconds + 10) * 1000, signal });
          if (!json || typeof json !== "object" || !Array.isArray(json.jobs)) {
            throw Object.assign(new Error("Empty poll response from job control."), { code: "ECONNRESET" });
          }
          markOutageRecovered(emitLog);
          return { jobs: json.jobs };
        } catch (error) {
          if (signal?.aborted) throw error;
          if (!isTransient(error)) throw error;
          attempt += 1;
          const delay = fullJitterDelay(attempt, { baseMs: baseDelayMs, maxMs: maxDelayMs, random: randomImpl });
          markOutageFailure(emitLog, error, delay);
          await sleepImpl(delay, signal);
        }
      }
    },

    /** Transient failures are retried by the existing timer in `runLeased`. */
    heartbeat: (queue, id, attempt, signal) =>
      post(`/internal/worker/jobs/${queue}/${id}/heartbeat`, { workerId, attempt }, { timeoutMs: 10_000, signal }),

    /** Retries transient errors for up to 90 s total, then gives up without throwing (`{ ok: false, gaveUp: true }`). */
    complete: (queue, id, attempt, { maxRetryMs, capMs, signal } = {}) =>
      withTimeBoundedRetry(
        () => post(`/internal/worker/jobs/${queue}/${id}/complete`, { workerId, attempt }, { timeoutMs: 10_000, signal }),
        {
          retry: true,
          maxMs: maxRetryMs ?? capMs ?? defaultAckCapMs,
          signal,
          giveUpOnCap: true,
          meta: { verb: "complete", queue, id, attempt }
        }
      ),

    /** Retries transient errors for up to 90 s total, then gives up without throwing (`{ ok: false, gaveUp: true }`). */
    fail: (queue, id, attempt, reason, { maxRetryMs, capMs, signal } = {}) =>
      withTimeBoundedRetry(
        () => post(`/internal/worker/jobs/${queue}/${id}/fail`, { workerId, attempt, reason }, { timeoutMs: 10_000, signal }),
        {
          retry: true,
          maxMs: maxRetryMs ?? capMs ?? defaultAckCapMs,
          signal,
          giveUpOnCap: true,
          meta: { verb: "fail", queue, id, attempt }
        }
      )
  };
}

/**
 * Runs `handler(job)` for one leased job, keeping the lease alive and acknowledging the outcome.
 *  - the lease is renewed every leaseSeconds/3; an answer of "not yours", or no successful renewal for leaseSeconds, aborts job.signal;
 *  - handler returns   -> complete;  handler throws -> fail (pg-boss retries with its own back-off);
 *  - aborted by a lost lease -> no acknowledgment (someone else owns it);
 *  - aborted by `shutdown` -> calls `control.fail(queue, id, attempt, "worker shutting down")` once and returns "abandoned".
 */
export async function runLeased(control, lease, handler, { shutdown, inFlight, now = Date.now, intervalMs } = {}) {
  const lost = new AbortController();
  const leaseSeconds = Math.max(1, Number(lease.leaseSeconds) || 30);
  const leaseMs = leaseSeconds * 1000;
  const job = {
    id: lease.id,
    queue: lease.queue,
    data: lease.data,
    retryCount: lease.attempt - 1,
    signal: AbortSignal.any([lost.signal, ...(shutdown ? [shutdown] : [])])
  };
  let lastOk = now();
  let ackPromise = null;

  const entry = {
    queue: lease.queue,
    id: lease.id,
    attempt: lease.attempt,
    get lost() { return lost.signal.aborted; },
    get acked() { return ackPromise !== null; },
    failOnShutdown(signal) {
      if (lost.signal.aborted) return Promise.resolve({ ok: false, skipped: "lost" });
      ackPromise ??= Promise.resolve()
        .then(() => control.fail(lease.queue, lease.id, lease.attempt, "worker shutting down", signal ? { signal } : undefined))
        .catch(() => ({ ok: false }));
      return ackPromise;
    }
  };
  inFlight?.add(entry);

  const tickMs = intervalMs ?? Math.max(2000, Math.floor(leaseMs / 3));
  const timer = setInterval(async () => {
    if (lost.signal.aborted) return;
    try {
      const answer = await control.heartbeat(lease.queue, lease.id, lease.attempt);
      if (answer?.ok) lastOk = now();
      else lost.abort(new Error(`The lease was lost (${answer?.reason ?? "unknown"}).`));
    } catch {
      if (now() - lastOk > leaseMs) lost.abort(new Error("Job control was unreachable for a whole lease."));
    }
  }, tickMs);
  timer.unref?.();

  try {
    await handler(job);
    if (lost.signal.aborted) return "lost";
    // A handler that RETURNED finished its work, even if shutdown began meanwhile: acknowledge it, never hand it back.
    if (!ackPromise) {
      ackPromise = Promise.resolve().then(() => control.complete(lease.queue, lease.id, lease.attempt));
    }
    const res = await ackPromise;
    if (res && res.gaveUp) return "abandoned";
    return "completed";
  } catch (error) {
    if (lost.signal.aborted) return "abandoned";
    if (shutdown?.aborted) {
      await entry.failOnShutdown();
      return "abandoned";
    }
    if (!ackPromise) {
      const reason = error instanceof Error ? error.message : "failed";
      ackPromise = Promise.resolve()
        .then(() => control.fail(lease.queue, lease.id, lease.attempt, reason))
        .catch(() => undefined);
    }
    await ackPromise;
    return "failed";
  } finally {
    clearInterval(timer);
    inFlight?.delete(entry);
  }
}

/**
 * The consume loop: one outstanding poll at a time while any slot is free, capped backoff after errors. Returns when `stop` aborts.
 * `slots()` says how many jobs of each queue this worker can take right now; `onJob(lease)` starts one (it must not block the loop).
 */
export async function consume(control, { slots, onJob, stop, log = () => {} } = {}) {
  while (!stop.aborted) {
    const free = slots();
    if (!Object.values(free).some((n) => n > 0)) {
      await defaultSleep(500, stop);
      continue;
    }
    try {
      const { jobs } = await control.poll(free, { signal: stop, log });
      for (const lease of jobs ?? []) onJob(lease);
    } catch (error) {
      if (stop.aborted) break;
      throw error;
    }
  }
}
