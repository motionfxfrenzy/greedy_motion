# Task for the coding agent: make staged re-bundle jobs wake a scaled-to-zero worker (and stop counting once done)

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in order. If a rule blocks you, stop that part and say so in the report; never work around a rule. **Do not stop after reading: keep working through every step and write the report.**

## Goal
Worker-mode re-bundle (`backend/src/plates/rebundle.ts`) stages a bundle and enqueues a job on the `plate-rebundle` queue; a worker verifies it and commits the switch. On staging and production the worker is scaled to zero (ECS tasks launched on demand by `backend/src/jobs/worker-launcher.ts`). Today nothing wakes a worker for that queue: `plateDemand()` ignores `plate-rebundle` jobs and `rebundleVariant` never kicks the launcher. Fix both, with tests, so that with the worker scaled to zero a staged re-bundle job triggers a launch, demand drops back to zero when the job is done, and a lost kick is still repaired by the launcher's next tick.

## Worktree
`/Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle`, branch `codex/rebundle` (HEAD at or after `4c3c878`). Do not touch other worktrees. Dependencies are installed.

## Read first (exact files)
1. `backend/src/jobs/worker-launcher.ts` (whole file: `ensure()` ~:57-76, `PLATE_SLOTS`, `plateDemand()` ~:81-92, `kickPlateWorkers()` ~:96, `kickWorkers()` ~:105, `startSweep` use, `tasksToStart`), `backend/src/jobs/demand.ts`, `backend/src/jobs/sweep.ts`, `backend/src/jobs/queues.ts` (`QUEUES.plateRebundle`, its queue options).
2. `backend/src/plates/rebundle.ts` (the `boss.send(QUEUES.plateRebundle, ...)` ~:405 and the code around it), and how neighbouring code queues work and kicks: `backend/src/plates/store.ts` (~:207, :246, :351, :419 call `void kickPlateWorkers()` after queueing), `exports.ts` (~:352), `reconcile.ts` (~:156).
3. Existing tests and their harness (**map first, reuse**): `backend/test/worker-launcher.mjs` (stubs `ECSClient.prototype.send` and `boss.getQueueStats`, no AWS, no database: `ListTasksCommand` and `RunTaskCommand` calls are recorded), `backend/test/sweep-cadence.mjs`, and the plate tests that touch the database with `plates_rebundle` (for example `backend/test/plate-rebundle.mjs`).
4. How an existing job is counted from the tables: `backend/src/plates/store.ts` ~:572 (`select count(*) from pgboss.job where name = $1 and ... state in ('created', 'retry', 'active')`).

## Architecture rules
- Reuse `kickPlateWorkers()` (it records a ping counted as one worker and calls `kickWorkers`); do not invent a second kick mechanism. Call it after the send in worker mode, `void` and never throwing into the caller (same idiom as the neighbours).
- Count the demand **from the table**, not from queue statistics, for the same reason the existing comment gives (stats can be minutes old, and a lost message or kick must still be seen by the next tick): in `plateDemand()` add the number of **runnable** re-bundle jobs to the existing sum, as one more subselect in the same query (keep it one round trip): jobs of the `plate-rebundle` queue in state `created` or `retry` **with `start_after <= now()`**, plus jobs in state `active`. A delayed job (pg-boss `start_after` in the future, for example a retry delay) is not runnable yet: counting it would launch a task that finds nothing to do, exits, and launches again on the next tick. Respect `config.plates.enabled` as today. The kick ping stays a single worker's worth.
- The worker takes one re-bundle job at a time per task (`PLATE_REBUNDLE_QUEUE` slot is 1 in `worker/src/worker.mjs`), and `ensure()` divides plate work by `PLATE_SLOTS`; do not change the arithmetic, only the counted work. If you believe re-bundle jobs should not each ask for a task (a hundred staged jobs would launch up to `maxTasks`), say so in the report and cap their contribution with a named constant (for example at most `PLATE_SLOTS * 1` per kick), with a test; the existing `maxTasks` cap still applies.
- **Schema and table:** use the pg-boss schema the app configures (the same constant or option that is passed to `new PgBoss(...)` in `backend/src/jobs/queues.ts`), not a hard-coded `pgboss`. Check the installed pg-boss version's job table layout (`node_modules/pg-boss`, and `package.json` for the version; pg-boss v10 and later partition the job table per queue) and query it the way that version supports; cite the version and the layout you found in the report. The existing `store.ts` ~:572 query is a starting point, not proof that it is right for this version.
- **Cost:** `plateDemand` runs on every launcher tick. `EXPLAIN` (and `EXPLAIN (ANALYZE, BUFFERS)` on the local database with some rows) the new subselect and confirm it uses an index on queue name and state (pg-boss creates its own), or explain in the report why a scan of that size is fine. Do not add an index or a migration without asking in the report.
- No new dependencies, no migrations, no frontend or engine changes, no change to what `rebundle.ts` stages or how it commits.

## Files allowed to change
`backend/src/jobs/worker-launcher.ts`, `backend/src/plates/rebundle.ts` (only the kick after the send), `backend/test/` (extend `worker-launcher.mjs` or add `worker-launcher-rebundle.mjs`, and extend the rebundle test if needed), `tools/backend/`, `docs/phase3/rebundle-wake-report.md`.
**Forbidden:** `worker/`, `frontend/`, `packages/`, migrations, `package.json` and lockfiles, anything not listed.

## Steps, in order
1. Map: in the report, list how `worker-launcher.mjs` stubs ECS and the queue stats, how `plateDemand` is exercised today (it needs `pool.query`: the existing test uses an unused database URL so the query throws and the ping path is returned; decide whether your test uses the real `plates_rebundle` database for the table count, which it should for the counting test), and the exact call sites of `kickPlateWorkers`.
2. Write the failing tests first (show them failing on the current code), then implement.
3. Tests (reuse the stubbed-ECS harness; for the table-count cases use the real database `plates_rebundle` or a fresh database you create from the migration runner: **do not use `plates_unit` or `plates_e2e`**):
   - **Wake from zero:** no tasks running (`ListTasksCommand` returns none), one staged `plate-rebundle` job in `pgboss.job` (state `created`), no render queue work, no plate variants or exports in work: `kickWorkers()` issues exactly one `RunTaskCommand`.
   - **Kick after the send:** `rebundleVariant` in worker mode ends by calling the launcher (assert one `RunTaskCommand` follows the enqueue, with ECS stubbed; the scene staging can use the existing rebundle test setup).
   - **Lost kick:** enqueue a job and do NOT call any kick (simulate the lost kick); then run the launcher's check the way the periodic sweep does (`kickWorkers()` without the ping, with the ping time old): it still starts a worker because the count comes from the table.
   - **Demand drops to zero:** after the job's state becomes `completed` (or `failed`/`cancelled`), a later `kickWorkers()` calls no ECS command and `lastDemand` is 0 (use whatever the module exposes, or assert `ListTasksCommand` and `RunTaskCommand` are never called; do not add exports just for the test unless necessary and say so).
   - **Already running:** with one task already running for that job (`running = 1`), no second task starts for one job.
   - **Cap:** many staged jobs never start more than `maxTasks` tasks.
   - **Delayed job:** a job in state `created` (and one in `retry`) with `start_after` ten minutes in the future gives 0 demand and starts nothing; after its `start_after` is moved into the past (update the row in the test) it counts 1 and starts one task.
   - **Plates disabled:** `config.plates.enabled` false keeps demand at 0.
   - The existing `worker-launcher.mjs` assertions still pass unchanged.
4. Full checks (commands below), report.

## Tests and exact commands
`cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle/backend` then, for each test:
`DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/<file>.mjs`
Run the full loop on a **fresh database** you create for the purpose (name it `plates_rebundle_wake`, drop it afterwards with the same `docker exec videosaas-local-postgres-1 psql -U videosaas -c ...` approach the manager used, or ask the manager in the report; the existing working database `plates_rebundle` holds leftovers that make `job-control` and `plate-live-render` fail): `for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle_wake PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` (expected failures only: billing, brand-files, render-prep, styles, visuals). `cd backend && npm run typecheck`. `node --check` is not needed (no worker changes).
No Chrome and no timing tests are involved: no locks needed. No Docker commands except the single `docker exec` to create and drop your own test database.

## Acceptance criteria
1. The new tests fail on the current code (output shown) and pass after the change; the existing `worker-launcher.mjs` and `sweep-cadence.mjs` still pass.
2. A delayed job (`start_after` in the future) never launches a task; once due it does. The report cites the pg-boss version, the table layout and the schema constant used, and shows the `EXPLAIN` output with the index (or the written justification).
3. With ECS stubbed and no tasks running, exactly one staged re-bundle job makes exactly one `RunTaskCommand`; with the kick suppressed, the periodic check still launches (lost-kick case); after completion no ECS call is made.
4. Backend loop on a fresh database: only the 5 known failures; typecheck clean.
5. The diff touches only the allowed files; the report lists them with line counts.

## Forbidden actions
No `git commit`, `git push`, `git reset`, `git stash`, `git checkout` or branch changes, no deploys, no staging, production or cloud calls (the AWS client is stubbed in tests; never create real AWS clients with real credentials), no secrets or credential files (`.env*`, `.env.credentials`, `infra/aws/.env*`, `*accessKeys*`, token files), no other worktrees, no other databases than `plates_rebundle` and your own fresh one, no new dependencies.

## Deliverable
`docs/phase3/rebundle-wake-report.md`: the map, the failing output, the design (query, constant, call site), every test and result, the full-loop result, open questions. End your final message with exactly one line: `DONE docs/phase3/rebundle-wake-report.md`
