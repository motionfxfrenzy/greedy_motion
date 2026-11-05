# Task for the coding agent: let the re-bundle CLI run against STAGING (opt-in), plus the staging roll-out runbook

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in order, and do not stop after reading: keep working through every step and write the report. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: /Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle-staging (branch codex/rebundle-staging, cut from codex/integrate at 8f435ad; node_modules already cloned in). Do not touch any other worktree.

## Goal
Today `backend/src/scripts/rebundle-plates.ts` refuses to run unless `APP_ENV=local` and the database and R2 hosts are localhost. For staging we need the same tool with an **explicit, narrow opt-in**, a worker-mode-only path (the backend image has no Chromium), clearer counts for the roll-out, and a written runbook. No change to how bundles are staged, verified or committed.

## Read first
`backend/src/scripts/rebundle-plates.ts` (guard `enforceLocalSafetyGuard`, `parseCliArgs`, the dry-run/apply/rollback paths), `backend/src/plates/rebundle.ts` (`scanRebundleCandidates`, `rebundleVariant`, `rollbackRebundleTarget`, the worker-mode `boss.send` and `kickPlateWorkers`), `docs/phase3/rebundle-report.md`, `docs/phase3/rebundle-wake-report.md`, `docs/MERGE_PLAN_2026-11-05.md` section 6, `backend/test/plate-rebundle.mjs`, `plate-rebundle-fence.mjs`, `plate-rebundle-rollback.mjs`, `worker/src/plates.mjs` (`handlePlateRebundle`), `backend/src/config.ts` (how `APP_ENV` and the staging values are read).

## Architecture rules
- Keep `enforceLocalSafetyGuard` behaviour for local runs byte-for-byte; add a second function `enforceStagingOptIn(env)` used only when `APP_ENV=staging`. It requires ALL of: `REBUNDLE_STAGING_OPT_IN` equal to the exact string `I-understand-this-is-staging`, `REBUNDLE_EXPECT_DB_HOST` equal to the actual database host from `DATABASE_URL`, `REBUNDLE_EXPECT_R2_BUCKET` equal to the configured bucket name, and `--mode worker` (in-process is refused for non-local). **The same guard applies to every write path**: `--apply`, `--rollback` and `--rollback-last` all call `enforceStagingOptIn`; only the read-only dry-run and `--status` may skip the opt-in variables (they still refuse production values and non-staging/non-local environments).
- **Production forbid-list (belt and braces against a copy-paste mistake):** the guard also refuses when the database host equals `REBUNDLE_FORBID_DB_HOST` or the bucket equals `REBUNDLE_FORBID_R2_BUCKET` (the production values, passed by the operator, or read from a non-secret config list checked into the repo that holds host and bucket names only, never credentials). Both variables are required for a staging write; a test proves a production-looking host or bucket is refused even when every opt-in variable is otherwise correct. Production (`APP_ENV=production`) and any other value stay refused, with a test that proves it for `production`, empty and unknown values.
- Never print the database URL, keys or tokens; the dry-run report prints host names only.
- **Dry-run output for the roll-out**: counts per state, per engine digest found vs current, legacy projects skipped, variants with a frozen manifest or export in flight (informational), total bytes to be staged (sum of current bundle sizes from `bundle_manifest`), and the first N candidate ids (`--sample`, default 5).
- **Batching**: `--apply` already takes `--limit`; add `--after <variantId>` (an ordered cursor) so successive batches continue where the last stopped, `--max-in-flight N` (do not enqueue more worker jobs while N staged jobs are still queued or active in `pgboss.job`; default 5), and a summary at the end with committed/failed/fenced counts. Idempotent as today.
- **Verification of a batch**: a read-only `--status` mode that prints, for variants touched in the last N minutes, the job state from `pgboss.job`, the revision row (`author = 'engine-rebundle'`), and whether the active bundle key is the new one.
- **Rollback**: unchanged, but add `--rollback-last <n>` (the n most recent engine-rebundle commits) so a bad batch can be undone without ids.
- No new dependencies, no migration, no change to `rebundle.ts` staging or commit logic except what the options above need.

## Files allowed to change
`backend/src/scripts/rebundle-plates.ts`, `backend/src/plates/rebundle.ts` (only the scan/summary/status helpers and cursor support), `backend/test/` (new tests), `docs/phase3/rebundle-staging-runbook.md`, `docs/phase3/rebundle-staging-report.md`, `tools/backend/`. **Forbidden:** worker code, frontend, packages, migrations, lockfiles, `.env*` and any credential file.

## Steps
1. Map the guard and the flows; list in the report.
2. Tests first (fail on current code): staging guard accepts only the full opt-in with matching host and bucket and worker mode; refuses production, empty, unknown, mismatching host or bucket, in-process mode; local guard unchanged; dry-run prints no secrets (assert the output contains neither the password nor the key of a fake URL); `--limit`/`--after` batching resumes correctly; `--max-in-flight` stops enqueuing; `--status` read-only (row counts unchanged); `--rollback-last`; **`--rollback` and `--rollback-last` are refused without the full staging opt-in and refused for a forbidden (production) host or bucket**.
3. Implement; local behaviour identical.
4. Runbook `docs/phase3/rebundle-staging-runbook.md`: preconditions (worker image with the rebundle consumer deployed and healthy; backend with migration 030; the wake fix present), the exact command lines to run **inside the staging backend container** (the manager cannot run Railway SSH; the owner does), dry-run, `--apply --limit 1 --mode worker`, how to verify that scene in the browser (bundle route returns the new key, the live preview plays, a frozen render of that project still works), the batch loop with `--max-in-flight`, what to watch (worker logs `plate_rebundle_committed`/`_failed`/`_fenced`, queue depth, error rate), stop conditions, rollback commands, what to record.

## Tests and commands
`cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/<fresh db named plates_rebundle_test_x> PLANNER=deterministic node --experimental-strip-types test/<file>.mjs` (create and drop your own fresh database; never `plates_unit`/`plates_e2e`); `npm run typecheck`; backend loop on a fresh database (only the 5 known failures). Real-Chromium tests only with `.lock-timing` held (set `TIMING_LOCK_HELD=1` for the rebundle test).

## Acceptance
1. New tests fail first, then pass; existing rebundle tests and the loop unchanged.
2. The staging guard refuses every case listed and accepts only the full opt-in; no secret appears in any output.
3. Batching and status behave as specified in tests; `--status` writes nothing.
4. Runbook exists with exact commands and stop conditions; the report lists files and line counts.

## Forbidden actions
No `git commit`/`push`/`reset`/`stash`/`checkout`, no deploys, no staging/production/cloud calls (tests use local databases and stubs), no secrets or credential files, no other worktrees, no new dependencies.

## Deliverable
`docs/phase3/rebundle-staging-report.md`. End with exactly: `DONE docs/phase3/rebundle-staging-report.md`
