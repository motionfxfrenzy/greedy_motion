# Job control: workers without database pools

Status: design, 2026-11-04. Implementation behind `WORKER_MODE=remote` (default `direct`, today's behaviour).

## Why

Production's Supabase session pooler allows **15 clients**. Measured on 2026-11-04:

| Holder | Connections |
| --- | --- |
| Backend at rest (pool 3 + pg-boss 4 + LISTEN + a few lazily held) | 7–9 |
| One worker task (`PG_POOL_MAX=1`, `BOSS_POOL_MAX=2`, pg-boss LISTEN/queues) | **+5** (9 → 14 under load) |

Two worker tasks cannot fit, even with minimal pools, and the API itself returned `EMAXCONNSESSION` while workers were up.
Every extra worker costs connections, so capacity is tied to a limit that has nothing to do with CPU. The fix is to stop
workers holding database connections at all: the **API process role owns every Postgres and pg-boss connection**, and
workers talk to it over HTTPS.

Keep pg-boss. Defer SQS until measured throughput or operations justify it.

## Shape

```
worker  --HTTPS-->  /internal/worker/*  (API process role "job-control")  -->  Postgres + pg-boss
```

* One shared bearer secret per environment (`WORKER_CONTROL_TOKEN`), compared in constant time. Workers hold no database
  credentials, only that token and R2 credentials. A leaked worker token can claim and report on jobs, nothing else.
* The job-control routes live in the backend image and run in the API process (`JOB_CONTROL=on`). Splitting them to a separate
  service later is a deployment change only; the protocol does not change.

## Protocol

All bodies are JSON. Every request carries `workerId` (uuid per process) so leases and logs are attributable.

### Claim: a bounded long poll

`POST /internal/worker/poll { workerId, slots: { "render-video": 1, "plate-render": 1, "plate-export": 0 }, waitSeconds }`

* Held open at most `min(waitSeconds, 25)` seconds. Returns as soon as a job exists, else `{ jobs: [] }` and the worker asks
  again. **No tight polling in HTTP:** at idle a worker makes one request per 25 s.
* The API side keeps **one dispatcher loop per queue that currently has waiting workers** (not per worker). It calls
  `boss.fetch(queue, { batchSize })` when woken (pg-boss LISTEN `notify`, already enabled) and at a 5 s backstop while any
  worker waits. Idle platform cost: zero loops when no worker waits.
* A fetched job is **leased to the polling worker**. The response carries `{ queue, id, attempt, data, leaseSeconds }`. `attempt`
  is pg-boss's `retryCount + 1`, the number every fenced write below is conditional on, exactly as today.
* If the HTTP response is lost, the job is Active in pg-boss with nobody holding it. Its lease is never renewed, so it expires
  and pg-boss retries it as a new attempt (below).

### Lease renewal (heartbeat)

`POST /internal/worker/jobs/:queue/:id/heartbeat { workerId, attempt }` every `leaseSeconds / 3`.

* API calls `boss.touch(queue, { id, attempt })` and checks the job is still Active at this attempt.
* Response `{ ok: true }` or `{ ok: false, reason: "superseded" | "cancelled" | "expired" }`. On `ok: false` the worker aborts
  the attempt at once (same path as today's `lost` AbortController) and uploads nothing more.
* **Cancellation is carried by the heartbeat reply** (and by any fenced write answering "not yours"): there is no separate push
  channel to lose. Worst-case delay to stop = one heartbeat interval.
* Queue heartbeat (`heartbeatSeconds` on the queue) stays the pg-boss-side guard: if the API stops hearing from a worker, the
  job is failed/retried by pg-boss itself, independent of any HTTP.

### Completion and acknowledgment

`POST /internal/worker/jobs/:queue/:id/complete { workerId, attempt, result }` and `.../fail { ..., retry }`.

The API performs, **in one Postgres transaction**: the fenced domain write (`app.render_jobs` / `app.plate_variants` /
`app.plate_exports` conditional on the attempt), the follow-up `boss.send` (e.g. `render-finished`, repair re-authoring), and
the pg-boss `complete`/`fail` for the claimed attempt. Then it answers. Rules:

1. Domain write and acknowledgment commit together or not at all. A crash between them cannot leave a drawn scene with a job
   that is retried and a duplicate charge: billing already commits in the same transaction as the fenced state change.
2. Stale attempt: the conditional write affects zero rows, the answer is `{ applied: false }`, the worker deletes its
   attempt-scoped artifacts and stops. Never an error.
3. Idempotent: completing an already completed attempt returns `{ applied: false, duplicate: true }` (the response may have been lost).
   The worker retries the call with backoff for up to `leaseSeconds`, then abandons; the reconciler finishes the story.

### Domain operations

Workers never send SQL. Each persistence step in `worker/src/jobs.mjs` and `worker/src/plates.mjs` becomes a named operation
with a fixed, parameterised statement on the API (`backend/src/jobs/control.ts`): `render.claim`, `render.progress`,
`render.note_retry`, `render.finish`, `plate.claim`, `plate.progress`, `plate.finish_drawn`, `plate.send_back_for_repair`,
`plate.fail`, `plate.requeue_cap`, `plate.state`, `export.claim`, `export.progress`, `export.finish`, `export.fail`,
`export.scene_states`, `demand.count`. Names are an allow-list; unknown names are 404.

## What happens when either side restarts

| Event | Outcome |
| --- | --- |
| Worker killed mid-render (Spot reclaim) | Heartbeats stop. After `leaseSeconds` pg-boss expires the claim; the next poll gets the job as a new attempt (`attempt + 1`). The old attempt's writes are fenced off. |
| Worker SIGTERM (scale-in, deploy) | Stops polling, finishes or hands back in-flight jobs within `DRAIN_SECONDS`, sends `fail { retry: true }` for what it cannot finish so the retry starts at once instead of after the lease. |
| API restarts (deploy) | In-flight long polls break; workers reconnect with jittered backoff. Heartbeats retry for up to `leaseSeconds`. Jobs fetched by the old process but not yet delivered expire and retry. No job state lives in API memory except the waiter list (rebuilt by the next polls). |
| API unreachable for longer than the lease | Workers abort their attempts (they cannot prove ownership); pg-boss retries them later. Work is repeated, never lost or double-applied. |
| Duplicate poll response / duplicate completion | Harmless: attempt fencing and idempotent completion. |
| Job cancelled or superseded while rendering | The next heartbeat or fenced write says so; the worker aborts and deletes its artifacts. |

## Bounds (nothing unbounded)

* Waiting polls per worker: 1 per queue kind with free slots. Poll hold ≤ 25 s. Backoff on errors 1–15 s with jitter.
* Dispatcher loops: ≤ 3 (one per queue). Fetch batch ≤ free slots reported.
* Heartbeat rate: ≤ 1 per `leaseSeconds / 3` per running job. Progress writes keep today's ≥ 1 s coalescing.
* API database use for the whole worker fleet: the API's own pool (`DATABASE_POOL_SIZE`) regardless of worker count. Adding
  workers adds HTTP concurrency, not connections.

## Connection budgets (explicit, validated)

See `infra/terraform/` (`connection_budget` check): for each environment `pooler_limit >= api_pool + api_boss + listeners
+ reserve`, with workers contributing **0** in remote mode and `workers × (pg + boss + listeners)` in direct mode. A plan that
exceeds the limit fails validation.

## Rollout

1. Deploy backend with routes (inert unless a worker uses them). Staging first.
2. Staging worker revision with `WORKER_MODE=remote`; run the chaos list (docs/JOB_CONTROL_CHAOS.md) against it.
3. Production only after a clean staging run, and as a separate approved promotion. `direct` mode stays as the rollback.
