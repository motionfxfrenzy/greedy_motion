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
`render.noteRetry`, `render.finish`, `plate.claim`, `plate.progress`, `plate.drawn`, `plate.sendBackForRepair`,
`plate.failed`, `plate.retry`, `plate.sendLater`, `plate.state`, `clip.lookup`, `clip.record`, `export.claim`,
`export.progress`, `export.ready`, `export.failed`, `export.requeue`, `scenes.states`, `demand.idle`. Names are an allow-list; unknown names are 404.

* **`clip.lookup`:** looks up cached scene clips in `app.plate_clips` by `(bundleDigest, engineDigest, fontSetDigest, size)` (supports single lookup or batch `{ keys: [...] }`).
* **`clip.record`:** records a worker-drawn scene clip into `app.plate_clips` keyed by `(bundleDigest, engineDigest, fontSetDigest, size)`. Fenced by the owning job attempt (`jobId` + `attempt` on `app.render_jobs` in state `'rendering'`, `exportId` + `attempt` on `app.plate_exports` in state `'assembling'`, or `variantId` + `gen` + `renderAttempt` on `app.plate_variants`); idempotent on conflict (`do nothing` + returns existing row with `duplicate: true`).
* **`plate.drawn`:** in addition to publishing a preview/fallback clip on `app.plate_variants`, writes the same content-addressed entry into `app.plate_clips` in the same transaction so final renders and companion exports reuse preview-drawn clips without redrawing.
* **`plate.sendBackForRepair`:** supports both `plate-render` attempts (fenced by `renderAttempt` in state `'rendering'`) and manifest-verification failures in `render-video` / `plate-export` (fenced by `(id, gen)`, advancing `rev` and queueing `plate-author` so the scene returns to preview as a repair revision).

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

### Recommended connection budget (staging & production)

* **Measured locally** (laptop with Docker, Postgres 17 + `plate-api` + up to 6 `plate-worker` containers / 100 simulated workers):
  * Worker Postgres connections: **`0`** at every concurrency (`W = 1..6` real containers, `W = 10..100` simulated workers).
  * `pg-boss` inside one API replica (`max: 4`, `useListenNotify: true`): holds **`4`** pool connections plus **`3`** session-pinned `LISTEN` connections (**`7`** total under load).
  * API `pg.Pool`: capped at `DATABASE_POOL_SIZE` (default `10` locally; measured `4` in use at `W = 10, U = 20 req/s`, `10` in use at `U = 100–200 req/s`).
* **Extrapolated to Supabase session pooler (limit = 15 session clients) and Postgres (`max_connections = 60`):**

| Parameter | Staging (1 API replica, session pooler ≤ 15) | Production (1 API replica on session pooler ≤ 15) | Production (direct IPv6 / dedicated pooler, `max_connections = 60`) | Source |
| --- | --- | --- | --- | --- |
| `DATABASE_POOL_SIZE` (`api_pool`) | **`5`** | **`5`** | **`12`** per API replica (up to 2 replicas = `24`) | Extrapolated from 15-client session pooler cap (`5 + 4 + 3 + 3 = 15`) |
| `pg-boss` pool (`api_boss`, `max`) | **`4`** | **`4`** | **`4`** per API replica (up to 2 replicas = `8`) | Measured (`queues.ts` `max: 4`) |
| `pg-boss` `LISTEN` clients (`listeners`) | **`3`** | **`3`** | **`3`** per API replica (up to 2 replicas = `6`) | Measured (`pg_stat_activity` under load) |
| Headroom / reserve (migrations, psql, admin) | **`3`** | **`3`** | **`22`** (of `60` `max_connections`) | Extrapolated safety reserve |
| Worker DB connections (`W × 0`) | **`0`** | **`0`** | **`0`** | **Measured** (`0` for `W = 1..100`) |
| **Total session pooler clients** | **`12` active + `3` reserve = `15` / `15`** | **`12` active + `3` reserve = `15` / `15`** | **`38` active + `22` reserve = `60` / `60`** | Validated budget |
| **Safe `ECS_WORKER_MAX_TASKS`** | **`8–12`** (16–24 concurrent scenes) | **`20–25`** (40–50 concurrent scenes) | **`40–50`** (80–100 concurrent scenes) | Extrapolated from load test degradation point (below) |

Because workers contribute **0** database connections, `ECS_WORKER_MAX_TASKS` is no longer a function of the 15-client session pooler limit. Instead, it is bounded only by API `pg.Pool` contention from concurrent control operations (`ECS_WORKER_MAX_TASKS ≤ 25` tasks = `50` concurrent jobs when `DATABASE_POOL_SIZE = 5–10`, where control `p95` stays `< 31 ms`).

## Merged-branch verification (`codex/live-scenes` + `codex/job-control`, 2026-11-05)

All numbers below were **measured on a local macOS laptop with Docker** (`videosaas-local` compose stack, `adobe/s3mock`, `llm-stub`), not on AWS/Supabase.

### End-to-end suites on the merged tree

* **Worker database isolation proof:** `plate-worker` runs with `DATABASE_URL=postgres://nobody:nobody@127.0.0.1:1/none`, `extra_hosts: ["postgres:127.0.0.1"]`, and no `pg` or `pg-boss` package installed (`pgInstalled: false`). `docker exec` TCP checks from `plate-worker` to both `postgres:5432` and `DATABASE_URL` fail with `ECONNREFUSED`, and `/proc/1/net/tcp{,6}` shows **`0`** open sockets to port `5432`.
* **Clip-mode acceptance (`scripts/plates-e2e/run.mjs happy durability cache failures`):** **PASS** — `happy` (371.1 sdraw + 56.7 s for 3 aspect exports), `durability` (469 s, including API restart during authoring, worker `docker kill` mid-render recovered at attempt 2, 4× duplicate delivery, edit superseding in-flight render, container recreate), `cache` (224 s), `failures` (167 s).
* **Live-scenes acceptance (`tools/phase2/e2e/live-e2e.mjs`, Scenarios A–K):** **PASS (108 / 108 assertions)** — including Scenario B clip fallback (61.4 s), Scenario F `PLATE_LIVE_FORCE_OFF` rollback (69.9 s), Scenario J final render of browser-checked live project (141.8 s), Scenario K immediate final render with no browser (61.3 s) + `9:16` companion export (73.5 s).
* **Live UI acceptance (`tools/phase2/e2e/live-ui-e2e.mjs`):** **PASS (15 / 15 assertions)** — 3 scenes checked in 4.35 s, 9.99 s live playback at 29.3 fps (`lateFrames = 0`), comment revision re-checked in 2.49 s, unverified browser clip fallback in 41.1 s, final render MP4 in 75.3 s.

### Chaos test results (`tools/phase2/job-control/chaos.mjs`, 28 / 28 assertions)

| Scenario | What was done | Key assertions & measurements (local Docker) | Result |
| --- | --- | --- | --- |
| **1. Kill worker mid-render** | `docker kill plate-worker` while drawing frames (`attempt = 1`) on a billed final render (`POST /v1/projects/:id/render`), then restart worker | Lease expired in pg-boss; restarted worker completed scene (`render_attempt = 2`, `clip-a2.mp4`) and render job (`attempt = 2`, `renders/<id>/a2.mp4`) in **149.3 s**; `render-finished` count = `1`; token ledger `spend` count = **`1`** (no double charge) | **PASS** |
| **2. Cut control link (20 s)** | `docker pause plate-api` for **20.15 s** while worker held an active `plate-render` lease, then unpause | Worker retried control calls with bounded backoff, kept its 30 s lease, completed in **31.6 s** total with `render_attempt = 1` and `0` duplicate publications | **PASS** |
| **3. Restart API during poll & finish** | `docker compose restart plate-api` (5.51 s) while worker held a long poll; also dropped first `render.finish` HTTP reply and restarted API before retry | Worker reconnected poll and claimed new job in **1.05 s**; retried `render.finish` answered `{ committed: true, duplicate: true }` in **473 ms** and kept worker's output with `1` `render-finished` message | **PASS** |
| **4. Duplicate & stale completion** | Sent `render.finish` and `plate.drawn` from superseded `attempt = 1` (before & after commit) and twice from winning `attempt = 2` | Stale attempt 1 rejected (`{ committed: false }` / `{ ok: false }`); attempt 2 committed once and returned `duplicate: true` on second call (**119 ms**) | **PASS** |
| **5. Many waiting workers (6 containers)** | Scaled `plate-worker=6`, queued 10 scenes across 2 projects (178 `pg_stat_activity` + `/proc/1/net/tcp` samples) | All 10 scenes drawn in **406.2 s** across 4 workers; `render_attempt = 1` on all 10; **worker DB connections = `0`** (`maxWorkerContainerSockets5432 = 0`); API DB connections ≤ **`13`** | **PASS** |
| **6. HyperFrames render** | Non-plate project (`look: "clean"`, 3 kinetic beats) rendered via `POST /v1/projects/:id/render` | Finished in **52.7 s** to a valid `1920×1080` H.264 MP4 (`370 / 370` frames) with worker holding `0` DB connections | **PASS** |

### Load test and measured limits (`tools/phase2/job-control/load.mjs`)

Simulated `W = 10, 25, 50, 100` concurrent workers using the real worker client (`worker/src/control.mjs`, 2 s lease hold per job) while `U = 20, 100, 200` req/s of `GET /v1/projects/:id/plates` hit `plate-api` (`DATABASE_POOL_SIZE = 10`, `pg-boss` `max = 4`):

| W (workers) | U (target req/s) | API DB conns (`pg_stat_activity` / pool / waiting) | Control op `p50 / p95` (ms) | Control `/poll` `p50 / p95` (ms) | Ordinary read `p50 / p95` (ms) | Event-loop lag `p50 / p95` (ms) | Jobs/s completed | 5xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **10** | **20** | `11` (`4` / `0`) | `4.8 / 16.5` | `4.9 / 9.3` | `8.5 / 19.3` | `11.25 / 15.10` | `4.00` | `0` |
| **10** | **100** | `17` (`10` / `0`) | `4.0 / 9.6` | `4.9 / 10.6` | `8.5 / 15.1` | `10.86 / 14.85` | `4.00` | `0` |
| **10** | **200** | `17` (`10` / `6`) | `3.3 / 9.0` | `4.6 / 10.2` | `9.4 / 15.9` | `11.14 / 14.76` | `4.00` | `0` |
| **25** | **20** | `17` (`10` / `0`) | `4.1 / 30.9` | `5.1 / 10.7` | `7.6 / 17.7` | `11.48 / 15.11` | `10.00` | `0` |
| **25** | **100** | `17` (`10` / `0`) | `3.7 / 14.5` | `4.9 / 18.2` | `7.9 / 20.4` | `11.19 / 15.55` | `10.00` | `0` |
| **25** | **200** | `17` (`10` / `0`) | `3.9 / 28.7` | `5.0 / 10.2` | `9.0 / 24.2` | `11.01 / 17.12` | `10.00` | `0` |
| **50** | **20** | `17` (`10` / `0`) | `4.5 / 21.9` | `5.5 / 10.7` | `7.8 / 14.2` | `11.34 / 15.08` | `19.60` | `0` |
| **50** | **100** | `17` (`10` / `0`) | `4.7 / 27.9` | `4.9 / 17.6` | `7.7 / 15.9` | `11.12 / 14.83` | `20.00` | `0` |
| **50** | **200** | `17` (`10` / `3`) | `4.1 / 12.9` | `4.7 / 12.9` | `9.1 / 17.0` | `10.76 / 14.70` | `20.00` | `0` |
| **100** | **20** | `17` (`10` / `41`) | `5.5 / 110.8` | `13.0 / 44.3` | `6.9 / 29.4` | `11.07 / 15.49` | `38.40` | `0` |
| **100** | **100** | `17` (`10` / `42`) | `5.6 / 459.1` | `6.6 / 33.3` | `8.2 / 376.5` | `10.83 / 24.38` | `30.59` | `0` |
| **100** | **200** | `17` (`10` / `2`) | `4.9 / 21.9` | `12.4 / 38.4` | `9.1 / 27.1` | `11.03 / 14.79` | `38.30` | `0` |

* **Point of degradation:** Up to **`W = 50` workers and `U = 200` req/s** (`20 jobs/s` completed = ~100 control writes/s), there is **no degradation** (`p95 < 31 ms` for control and ordinary routes, `0` 5xx, API DB connections capped at `17` = `10` pool + `7` pg-boss). At **`W = 100` workers** with 2 s synthetic leases (`30.6–38.4 jobs/s` = ~190 transactional control writes/s), `pg.Pool` queue wait (`waitingCount = 41–42` against the 10-connection pool) pushes control op `p95` up to `110.8–459.1 ms` and ordinary route `p95` up to `376.5 ms` during synchronized bursts, while `p50` remains `< 10 ms` and `5xx` remains `0`. Because real renders hold leases for `30–90 s` rather than `2 s`, 50 real worker tasks (`100` concurrent scenes) produce only `~1.5–3 jobs/s` (equivalent to `W = 10` in the table above).

## Rollout

1. Deploy backend with routes (inert unless a worker uses them). Staging first.
2. Staging worker revision with `WORKER_MODE=remote`; run the chaos list (docs/JOB_CONTROL_CHAOS.md) against it.
3. Production only after a clean staging run, and as a separate approved promotion. `direct` mode stays as the rollback.
