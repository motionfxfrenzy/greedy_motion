# Phase 3 Report: Re-bundle Worker Wake-up & Demand Counting (`plate-rebundle`)

## 1. Map of Existing Launcher, Tests, and `kickPlateWorkers()` Call Sites

### 1.1 How `backend/test/worker-launcher.mjs` Stubs ECS and Queue Statistics
- **Environment:** Sets `DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused"`, `PLANNER ??= "deterministic"`, `ALLOW_CLOUD_IN_LOCAL="1"`, `WORKER_LAUNCH="ecs"`, `ECS_REGION="ap-southeast-1"`, `ECS_CLUSTER="greedymotion-staging"`, `ECS_WORKER_TASK_DEFINITION="greedymotion-staging-worker"`, `ECS_SUBNETS="subnet-a, subnet-b"`, `ECS_SECURITY_GROUPS="sg-1"`, `ECS_WORKER_CONCURRENCY="2"`, and `ECS_WORKER_MAX_TASKS="3"`.
- **ECS stub:** Patches `ECSClient.prototype.send` prior to importing `worker-launcher.ts`, pushing `{ name: command.constructor.name, input: command.input }` into `calls`:
  - `ListTasksCommand` returns `{ taskArns: Array.from({ length: running }, (_, i) => \`arn:task/${i}\`) }`.
  - `RunTaskCommand` checks `Boolean(command.input.capacityProviderStrategy)` to distinguish `FARGATE_SPOT` from on-demand `FARGATE`, caps Spot launches at `spotCapacity`, and returns `{ tasks, failures }`.
- **Queue stats stub:** Patches `boss.getQueueStats = async () => [stats]` where `stats = { queuedCount: 0, activeCount: 0 }`.

### 1.2 How `plateDemand()` Is Exercised Today
- In `backend/src/jobs/worker-launcher.ts`, `plateDemand()` returns `0` immediately when `!config.plates.enabled` (`PLATE_PIPELINE !== "worker"`).
- In `backend/test/worker-launcher.mjs`, `PLATE_PIPELINE` is unset (`"off"`), so `config.plates.enabled` is `false` and `plateDemand()` returns `0` before reaching `pool.query`. Even if `config.plates.enabled` were `true`, `DATABASE_URL` in `worker-launcher.mjs` points to `127.0.0.1:1/unused`, so `pool.query` would throw and enter `catch { return pinged; }`.
- **Test harness decision:** Keep `backend/test/worker-launcher.mjs` completely unchanged as a fast, database-free unit test, and add `backend/test/worker-launcher-rebundle.mjs` using the same `ECSClient.prototype.send` and `boss.getQueueStats` stubs while connected to the real `plates_rebundle` (and `plates_rebundle_wake`) Postgres database with `PLATE_PIPELINE="worker"`.

### 1.3 Exact Call Sites of `kickPlateWorkers()`
- **Definition:** `backend/src/jobs/worker-launcher.ts:98` (`export function kickPlateWorkers(): Promise<void>`), which records `platePingAt = Date.now()` (counted as 1 worker for 120 s) and calls `kickWorkers(false)`.
- **Existing callers:**
  1. `backend/src/plates/store.ts:207` — `reconcileVariants()`: `if (queued) void kickPlateWorkers();` after committing newly queued `plate-author` / `plate-render` jobs.
  2. `backend/src/plates/store.ts:246` — `reviseScene()`: `if (n) void kickPlateWorkers();` after committing revision jobs on `plate-author`.
  3. `backend/src/plates/store.ts:351` — `commitBundle()`: `if (shouldKick) void kickPlateWorkers();` after committing a bundle that queued `plate-render`.
  4. `backend/src/plates/store.ts:419` — `sendBackForRepair()`: `if (outcome.applied && !outcome.exhausted) void kickPlateWorkers();` after committing a bounded repair job.
  5. `backend/src/plates/store.ts:548` — `submitCheckReport()`: `if (shouldKick) void kickPlateWorkers();` after a browser/worker code-check failure queues a repair.
  6. `backend/src/plates/store.ts:649` — `requestVariantClip()`: `if (shouldKick) void kickPlateWorkers();` after enqueuing a non-duplicate `plate-render` clip job.
  7. `backend/src/plates/exports.ts:352` — `requestExport()`: `void kickPlateWorkers();` after committing a `plate-export` job.
  8. `backend/src/plates/reconcile.ts:156` — `reconcilePlates()`: `if (open) await kickPlateWorkers().catch(() => undefined);` during periodic plate reconciliation.
- **Added caller:**
  9. `backend/src/plates/rebundle.ts:424` — `rebundleVariant()`: `void kickPlateWorkers();` immediately after `await boss.send(QUEUES.plateRebundle, ...)` in `mode === "worker"`.

---

## 2. Step 2: Failing Test Output Before Implementation

Running `backend/test/worker-launcher-rebundle.mjs` against `plates_rebundle` prior to editing `worker-launcher.ts` and `rebundle.ts`:

```text
$ DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/worker-launcher-rebundle.mjs
  FAIL: 1. Wake from zero -> expected 1 ListTasksCommand

0 !== 1

  FAIL: 2. Already running -> expected 1 ListTasksCommand when demand=1

0 !== 1

  FAIL: 3. Demand drops to zero (active -> completed / failed / cancelled) -> active plate-rebundle job counts as demand and launches 1 task

0 !== 1

  FAIL: 4. Delayed job (created and retry) -> due created job must start 1 task

0 !== 1

  FAIL: 5. Lost kick -> lost kick is repaired by table count on periodic kickWorkers()

0 !== 1

  FAIL: 6. Cap at maxTasks -> expected 1 RunTaskCommand for batch of staged jobs

0 !== 1

  PASS: 7. Plates disabled
  FAIL: 8. Kick after the send (rebundleVariant mode=worker) -> rebundleVariant(mode=worker) must kick the worker launcher and issue 1 RunTaskCommand

0 !== 1

Error: 7 test(s) failed: 1. Wake from zero, 2. Already running, 3. Demand drops to zero (active -> completed / failed / cancelled), 4. Delayed job (created and retry), 5. Lost kick, 6. Cap at maxTasks, 8. Kick after the send (rebundleVariant mode=worker)
```

---

## 3. Design: pg-boss Layout, Schema Constant, Query, and Cost Analysis

### 3.1 Installed `pg-boss` Version, Schema Constant, and Table Layout
- **Installed version:** `pg-boss` `12.36.0` (`backend/package.json` line 65 and `node_modules/pg-boss/package.json` line 3), running schema version `44` (`pgboss.version`).
- **Schema configuration:** In `backend/src/jobs/queues.ts:77-78`, `new PgBoss({ connectionString: config.databaseUrl, max: 4, ...quietBoss })` receives `quietBoss`. Because `queues.ts` is outside the allowed-to-change files for this task, `backend/src/jobs/worker-launcher.ts` imports `quietBoss` from `./queues.ts` and derives:
  ```ts
  const PGBOSS_SCHEMA = (quietBoss as { schema?: string }).schema ?? "pgboss";
  ```
  This mirrors `applySchemaConfig` in `node_modules/pg-boss/dist/attorney.js` (`config.schema = config.schema || DEFAULT_SCHEMA` where `DEFAULT_SCHEMA = 'pgboss'`).
- **Table layout in `pg-boss` 12.36.0 (`node_modules/pg-boss/dist/plans.js`):**
  - `pgboss.job` is a list-partitioned table (`CREATE TABLE pgboss.job (...) PARTITION BY LIST (name)`, `relkind = 'p'`).
  - `pgboss.job_common` is attached as the `DEFAULT` partition (`ALTER TABLE pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT`).
  - In `createQueueFunction` (`plans.js:986-1076`), per-queue partition tables (`j<sha224(name)>`) are created only when a queue sets `partition: true` (`QUEUE_DEFAULTS.partition` is `false`). In `backend/src/jobs/queues.ts`, all 13 application queues (including `plate-rebundle`) use the default `partition: false`, so every row in `pgboss.queue` has `partition = false` and `table_name = 'job_common'`.
  - Querying `${PGBOSS_SCHEMA}.job` with `WHERE name = $1` routes through Postgres partition pruning directly to `pgboss.job_common` (and remains forward-compatible if `partition: true` is ever enabled on `plate-rebundle`).

### 3.2 Single-Round-Trip Query in `plateDemand()`
In `backend/src/jobs/worker-launcher.ts`:

```ts
const PGBOSS_SCHEMA = (quietBoss as { schema?: string }).schema ?? "pgboss";

async function plateDemand(): Promise<number> {
  if (!config.plates.enabled) return 0;
  const pinged = Date.now() - platePingAt < 120_000 ? 1 : 0;
  try {
    const { rows } = await pool.query<{ n: string }>(
      `select (select count(*) from app.plate_variants where state in ('bundled', 'rendering')) + (select count(*) from app.plate_exports where state in ('queued', 'assembling')) + (select count(*) from ${PGBOSS_SCHEMA}.job where name = $1 and ((state in ('created', 'retry') and start_after <= now()) or state = 'active')) as n`,
      [QUEUES.plateRebundle]
    );
    return Math.max(Number(rows[0]?.n ?? 0), pinged);
  } catch { return pinged; }
}
```

- Counts jobs in `plate-rebundle` that are either:
  - `state in ('created', 'retry') and start_after <= now()` (immediately runnable, excluding delayed retries or scheduled future jobs), or
  - `state = 'active'` (currently leased to a worker).
- Once a job transitions to `completed`, `failed`, or `cancelled`, it is no longer counted.

### 3.3 `EXPLAIN (ANALYZE, BUFFERS)` and Index Usage
`pg-boss` v12.36.0 creates the following indexes on `pgboss.job_common`:
- `job_common_pkey`: `UNIQUE INDEX ON pgboss.job_common USING btree (name, id)`
- `job_common_i11`: `INDEX ON pgboss.job_common USING btree (name, priority DESC, created_on, start_after) WHERE ((state < 'active'::pgboss.job_state) AND (NOT blocked))`

Running `EXPLAIN (ANALYZE, BUFFERS)` on `plates_rebundle` with 500 rows across queues (`render-video`, `plate-render`, and `plate-rebundle`):

```text
Result  (cost=30.76..30.77 rows=1 width=8) (actual time=0.160..0.162 rows=1 loops=1)
  Buffers: shared hit=16
  InitPlan 1
    ->  Aggregate  (cost=1.05..1.06 rows=1 width=8) (actual time=0.049..0.050 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Seq Scan on plate_variants  (cost=0.00..1.04 rows=3 width=0) (actual time=0.039..0.039 rows=2 loops=1)
                Filter: (state = ANY ('{bundled,rendering}'::text[]))
                Rows Removed by Filter: 1
                Buffers: shared hit=1
  InitPlan 2
    ->  Aggregate  (cost=12.76..12.77 rows=1 width=8) (actual time=0.027..0.028 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Seq Scan on plate_exports  (cost=0.00..12.75 rows=2 width=0) (actual time=0.027..0.027 rows=0 loops=1)
                Filter: (state = ANY ('{queued,assembling}'::text[]))
                Buffers: shared hit=1
  InitPlan 3
    ->  Aggregate  (cost=16.93..16.94 rows=1 width=8) (actual time=0.081..0.081 rows=1 loops=1)
          Buffers: shared hit=14
          ->  Bitmap Heap Scan on job_common job  (cost=4.31..16.92 rows=2 width=0) (actual time=0.072..0.073 rows=1 loops=1)
                Recheck Cond: (name = 'plate-rebundle'::text)
                Filter: (((state = ANY ('{created,retry}'::pgboss.job_state[])) AND (start_after <= now())) OR (state = 'active'::pgboss.job_state))
                Rows Removed by Filter: 4
                Heap Blocks: exact=11
                Buffers: shared hit=14
                ->  Bitmap Index Scan on job_common_pkey  (cost=0.00..4.31 rows=5 width=0) (actual time=0.055..0.055 rows=205 loops=1)
                      Index Cond: (name = 'plate-rebundle'::text)
                      Buffers: shared hit=3
Planning:
  Buffers: shared hit=365
Planning Time: 2.620 ms
Execution Time: 0.350 ms
```

Because `job_common_pkey` has `name` as its leading key column `(name, id)` and `plate-rebundle` is a low-volume maintenance queue, Postgres uses a `Bitmap Index Scan on job_common_pkey` (`Index Cond: (name = 'plate-rebundle'::text)`) and filters `state` and `start_after` in `0.081 ms` (14 shared buffer hits). No extra index or migration is needed.

### 3.4 Task Arithmetic and Cap Discussion
- Each worker task offers 1 concurrent `plate-rebundle` slot (`[PLATE_REBUNDLE_QUEUE]: drawsPlates ? Math.max(0, 1 - leased[PLATE_REBUNDLE_QUEUE]) : 0` in `worker/src/worker.mjs:356`).
- In `ensure()`, plate demand is divided by `PLATE_SLOTS` (`Math.ceil(plateWork / PLATE_SLOTS)`) and total tasks are bounded by `launch.maxTasks` (default `3`).
- Counting runnable `plate-rebundle` jobs directly in `plateDemand()` means 1 staged job launches 1 worker task (`ceil(1 / PLATE_SLOTS) = 1`), and a batch re-bundle of many variants launches up to `maxTasks` (3) tasks in parallel to verify and commit the batch faster without ever exceeding `maxTasks`.

---

## 4. Tests and Verification Results

### 4.1 Targeted Tests on `plates_rebundle`
1. `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/worker-launcher-rebundle.mjs`
   ```text
   {"level":"info","event":"worker_launched","demand":1,"running":0,"wanted":1,"started":1}
     PASS: 1. Wake from zero
     PASS: 2. Already running
   {"level":"info","event":"worker_launched","demand":1,"running":0,"wanted":1,"started":1}
     PASS: 3. Demand drops to zero (active -> completed / failed / cancelled)
   {"level":"info","event":"worker_launched","demand":1,"running":0,"wanted":1,"started":1}
   {"level":"info","event":"worker_launched","demand":1,"running":0,"wanted":1,"started":1}
     PASS: 4. Delayed job (created and retry)
   {"level":"info","event":"worker_launched","demand":1,"running":0,"wanted":1,"started":1}
     PASS: 5. Lost kick
   {"level":"info","event":"worker_launched","demand":10,"running":0,"wanted":3,"started":3}
     PASS: 6. Cap at maxTasks
     PASS: 7. Plates disabled
   {"level":"info","event":"worker_launched","demand":1,"running":0,"wanted":1,"started":1}
     PASS: 8. Kick after the send (rebundleVariant mode=worker)
   worker launcher rebundle: ok
   ```
2. `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/worker-launcher.mjs` -> `worker launcher: ok`
3. `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/sweep-cadence.mjs` -> `sweep cadence: ok (idle 1, busy 12)` / `demand: ok`

### 4.2 Full Test Loop on Fresh Database (`plates_rebundle_wake`) and Typecheck
Created `plates_rebundle_wake`, ran all `backend/test/*.mjs`, and dropped `plates_rebundle_wake`:

```text
DROP DATABASE
NOTICE:  database "plates_rebundle_wake" does not exist, skipping
CREATE DATABASE
FAIL test/billing.mjs
FAIL test/brand-files.mjs
FAIL test/render-prep.mjs
FAIL test/styles.mjs
FAIL test/visuals.mjs
DROP DATABASE
```

Only the 5 expected pre-existing failures occurred (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`).

Typecheck:
```text
$ cd backend && npm run typecheck
> @videosaas/backend@0.1.0 typecheck
> tsc --noEmit -p .
```

---

## 5. Files Touched (with Line Counts)

| File | Status | Total Lines | Diff (`+` / `-`) |
| --- | --- | ---: | ---: |
| `backend/src/jobs/worker-launcher.ts` | Modified | 133 | `+5 / -3` |
| `backend/src/plates/rebundle.ts` | Modified | 664 | `+2 / -0` |
| `backend/test/worker-launcher-rebundle.mjs` | Added | 369 | `+369 / -0` |
| `docs/phase3/rebundle-wake-report.md` | Added | 226 | `+226 / -0` |

---

## 6. Open Questions
- **Worker idle exit check (`demand.idle` in `backend/src/jobs/control.ts:467-485`):** `demand.idle` already includes `QUEUES.plateRebundle` in `QUEUE_NAMES` via `boss.getQueueStats(q, { force: true })`, so a running worker will not idle-exit while `plate-rebundle` has queued or active jobs. No change to `control.ts` was needed or made.
- **Reconciler (`backend/src/plates/reconcile.ts`):** `reconcilePlates()` checks `app.plate_variants` and `app.plate_exports` (`open`), while `startWorkerSweep` in `worker-launcher.ts` calls `kickWorkers()` on its periodic sweep (`plateDemand()`), which now queries `${PGBOSS_SCHEMA}.job` directly for `plate-rebundle`.
