# Phase 3 Report: Staging Opt-In Re-bundle CLI, Batching, Status & Roll-Out Runbook

## 1. Map of the Guard and Flows (Step 1)

| File & Symbol | Pre-Change Behaviour | Role After This Change |
| :--- | :--- | :--- |
| `backend/src/scripts/rebundle-plates.ts:23-55` — `enforceLocalSafetyGuard(env)` | Refused unless `env.APP_ENV === "local"`, `DATABASE_URL` hostname is `"localhost"` or `"127.0.0.1"`, and (if set) `R2_ENDPOINT` hostname is `"localhost"` or `"127.0.0.1"`. | Preserved **byte-for-byte** for `APP_ENV === "local"`. |
| `backend/src/scripts/rebundle-plates.ts` — `enforceStagingOptIn(env, options)` & `PRODUCTION_FORBID_LIST` | Did not exist; non-local environments were unconditionally refused. | Added `enforceStagingOptIn(env, options)` used only when `APP_ENV === "staging"`. Enforces the checked-in `PRODUCTION_FORBID_LIST` (`db.bwwquxhexwyodsavsjar.supabase.co`, `bwwquxhexwyodsavsjar`, `greedymotion-production-*`, `videosaas-production-*`, and any `prod`/`production` token) plus operator-supplied `REBUNDLE_FORBID_DB_HOST` and `REBUNDLE_FORBID_R2_BUCKET`. On every write path (`--apply`, `--rollback`, `--rollback-last`), requires `REBUNDLE_STAGING_OPT_IN === "I-understand-this-is-staging"`, `REBUNDLE_EXPECT_DB_HOST === dbHost`, `REBUNDLE_EXPECT_R2_BUCKET === R2_UPLOADS_BUCKET`, non-empty `REBUNDLE_FORBID_DB_HOST` / `REBUNDLE_FORBID_R2_BUCKET`, and `--mode worker`. Read-only paths (`--dry-run` and `--status`) may skip the opt-in variables while still enforcing the production forbid-list and refusing non-staging/non-local environments. |
| `backend/src/scripts/rebundle-plates.ts` — `parseCliArgs(argv)` | Parsed `--apply`, `--dry-run`, `--limit`, `--project`, `--rollback`, `--mode`, `--skip-browser-verify`. | Added `--after <variantId>`, `--max-in-flight <N>` (default `5`), `--sample <N>` (default `5`), `--status [minutes]` / `--minutes <N>` (default `60`), and `--rollback-last <N>`. |
| `backend/src/plates/rebundle.ts` — `scanRebundleCandidates(options)` | Scanned `app.plate_variants` for stale candidates (`engineDigest` distinct from current) ordered by `created_at, project_id, scene_index, aspect`, plus state counts and legacy project skips. | Added ordered cursor filtering (`--after <variantId>` via `(created_at, project_id, scene_index, aspect, id) > (...)`), `countsByEngineDigest` & `staleCountsByEngineDigest`, informational counts for variants with a frozen manifest (`frozenManifestVariantCount`) or export/render in flight (`exportInFlightVariantCount`, `frozenOrInFlightVariantCount`, `frozenOrInFlightVariantIds`), `totalBytesToStage` (sum of current bundle sizes from `bundle_manifest`), `sampleCandidateIds` (`--sample`, default `5`), and `nextCursor`. |
| `backend/src/plates/rebundle.ts:303-528` — `rebundleVariant(variantId, options)` | Stages content-addressed bundle (`bundles/<bundleSha>/bundle.html` and `manifest.json`), verifies storage size, and in `mode === "worker"` sends a job to `QUEUES.plateRebundle` (`"plate-rebundle"`) and calls `void kickPlateWorkers()`. | **Unchanged** (no change to staging or commit logic). |
| `backend/src/plates/rebundle.ts` — `rebundleStaleVariants(options)` | Ran `scanRebundleCandidates` and iterated over candidates calling `rebundleVariant`. | Added `after`, `sample`, and `maxInFlight` (default `5` in worker mode) support via `countInFlightRebundleJobs()` (`SELECT count(*) FROM pgboss.job WHERE name = 'plate-rebundle' AND state IN ('created', 'retry', 'active')`). Stops enqueuing when `inFlight >= maxInFlight` and reports `stoppedByMaxInFlight`, `inFlight`, `maxInFlight`, and `nextCursor`. |
| `backend/src/plates/rebundle.ts` — `getRebundleStatus(options)` | Did not exist. | Added strictly read-only (`BEGIN READ ONLY`) status inspection for variants touched in the last `N` minutes: reports `pgboss.job` state (`jobState`, `job`), the `author = 'engine-rebundle'` row from `app.plate_revisions` (`revision`), and `activeBundleIsNew`. |
| `backend/src/plates/rebundle.ts` — `rollbackRebundleTarget` & `rollbackLastRebundleCommits` | `rollbackRebundleTarget` rolled back a single `<variantId>` or `all-engine-rebundle`. | Kept `rollbackRebundleTarget` unchanged and added `rollbackLastRebundleCommits(count, options)` (`--rollback-last <n>`) which selects the `n` most recent active `author = 'engine-rebundle'` commits ordered by `r.created_at DESC, v.updated_at DESC, r.rev DESC, v.id DESC LIMIT $1` and rolls each back via `rollbackRebundleRevision`. |
| `worker/src/plates.mjs:1074-1153` — `handlePlateRebundle` | Worker consumer for `plate-rebundle`: downloads staged bundle, verifies `verifyBundleDigest`, bakes revision params, runs `verifyScene` in Chromium, and calls `control.op("rebundle.commit", ...)`. | Unchanged (read-only reference). |
| `backend/src/config.ts:14-154` | Reads `APP_ENV` (`local`, `staging`, `production`), validates `AUTH_MODE=supabase`, `STORAGE_DRIVER=r2`, `PLANNER=anthropic`, and non-local `DATABASE_URL` when `APP_ENV !== "local"`. | Unchanged (read-only reference). |

---

## 2. Step 2 Failing Test Output (Before Implementation) and Pass Output (After Implementation)

### 2.1 Failing Output on Pre-Implementation Code (`plates_rebundle_test_staging`)

```text
$ DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle_test_staging PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-staging.mjs
AssertionError [ERR_ASSERTION]: enforceStagingOptIn must be exported from rebundle-plates.ts
+ actual - expected

+ 'undefined'
- 'function'

    at file:///Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle-staging/backend/test/plate-rebundle-staging.mjs:153:10
```

### 2.2 Passing Output After Implementation (`plates_rebundle_test_staging`)

```text
$ DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle_test_staging PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-staging.mjs
{"level":"info","event":"plate_rebundle_committed","variantId":"41326e03-068d-4077-9c0b-625bd401f66e","projectId":"8d838d98-5e88-450c-9184-330870673f1f","gen":1,"oldRev":0,"newRev":1,"oldEngineDigest":"06400000000000000000064a","newEngineDigest":"0bf69b95af4599883cac8e1c","newBundleKey":"plates/8d838d98-5e88-450c-9184-330870673f1f/16x9/0/g1/bundles/0747a1a0cf1ce2147657d89e/bundle.html","newBundleDigest":"e5b986579c7474a748deb420ad00dcfc07ded89b7f135e371ce453737188d83d"}
{"level":"info","event":"plate_rebundle_committed","variantId":"eb0231fc-ebe6-4f53-b0de-4d9a247ad1eb","projectId":"8d838d98-5e88-450c-9184-330870673f1f","gen":1,"oldRev":0,"newRev":1,"oldEngineDigest":"06400000000000000000064a","newEngineDigest":"0bf69b95af4599883cac8e1c","newBundleKey":"plates/8d838d98-5e88-450c-9184-330870673f1f/16x9/1/g1/bundles/0747a1a0cf1ce2147657d89e/bundle.html","newBundleDigest":"e5b986579c7474a748deb420ad00dcfc07ded89b7f135e371ce453737188d83d"}
{"level":"info","event":"plate_rebundle_committed","variantId":"ac483a01-a4f8-4d32-862c-37f2192eb63e","projectId":"8d838d98-5e88-450c-9184-330870673f1f","gen":1,"oldRev":0,"newRev":1,"oldEngineDigest":"06400000000000000000064b","newEngineDigest":"0bf69b95af4599883cac8e1c","newBundleKey":"plates/8d838d98-5e88-450c-9184-330870673f1f/16x9/2/g1/bundles/0747a1a0cf1ce2147657d89e/bundle.html","newBundleDigest":"e5b986579c7474a748deb420ad00dcfc07ded89b7f135e371ce453737188d83d"}
{"level":"info","event":"plate_rebundle_committed","variantId":"077f7920-8a1b-4f1f-a5ca-fd97bc86dc44","projectId":"8d838d98-5e88-450c-9184-330870673f1f","gen":1,"oldRev":0,"newRev":1,"oldEngineDigest":"06400000000000000000064b","newEngineDigest":"0bf69b95af4599883cac8e1c","newBundleKey":"plates/8d838d98-5e88-450c-9184-330870673f1f/16x9/3/g1/bundles/0747a1a0cf1ce2147657d89e/bundle.html","newBundleDigest":"e5b986579c7474a748deb420ad00dcfc07ded89b7f135e371ce453737188d83d"}
{"level":"info","event":"plate_rebundle_committed","variantId":"6ed2964f-ceca-4102-9967-f15fb93ce44c","projectId":"6412a91e-484b-4406-ae6a-c61db32640ca","gen":1,"rev":1,"bundleKey":"plates/6412a91e-484b-4406-ae6a-c61db32640ca/16x9/1/g1/bundles/0747a1a0cf1ce2147657d89e/bundle.html","bundleDigest":"e5b986579c7474a748deb420ad00dcfc07ded89b7f135e371ce453737188d83d"}
{"level":"info","event":"plate_rebundle_committed","variantId":"c356e3c1-faf7-4db0-bdbd-b3dd55bb9604","projectId":"6412a91e-484b-4406-ae6a-c61db32640ca","gen":1,"rev":1,"bundleKey":"plates/6412a91e-484b-4406-ae6a-c61db32640ca/16x9/0/g1/bundles/0747a1a0cf1ce2147657d89e/bundle.html","bundleDigest":"e5b986579c7474a748deb420ad00dcfc07ded89b7f135e371ce453737188d83d"}
plate rebundle staging: ok
```

---

## 3. Architecture & Implementation Details (Step 3)

1. **Guards & Production Forbid-List (`backend/src/scripts/rebundle-plates.ts`):**
   - `enforceLocalSafetyGuard(env)` is unchanged byte-for-byte.
   - `enforceStagingOptIn(env, options)` runs only when `APP_ENV === "staging"`. Any other `APP_ENV` (`"production"`, `""`, `undefined`, unknown values) is refused.
   - Checked-in non-secret `PRODUCTION_FORBID_LIST` blocks known production hosts (`db.bwwquxhexwyodsavsjar.supabase.co`, `bwwquxhexwyodsavsjar.supabase.co`), the production Supabase project ref (`bwwquxhexwyodsavsjar` in hostname or pooler username), known production R2 buckets (`greedymotion-production-uploads`, `greedymotion-production-outputs`, `greedymotion-production-media`, `videosaas-production-*`), and any host or bucket containing a `prod`/`production` token (`/(^|[._-])prod(uction)?([._-]|$)/i`).
   - Write paths (`--apply`, `--rollback`, `--rollback-last`) all invoke `enforceStagingOptIn` with `readOnly: false`, requiring:
     - `REBUNDLE_STAGING_OPT_IN === "I-understand-this-is-staging"`
     - `REBUNDLE_EXPECT_DB_HOST === new URL(DATABASE_URL).hostname`
     - `REBUNDLE_EXPECT_R2_BUCKET === R2_UPLOADS_BUCKET`
     - Non-empty `REBUNDLE_FORBID_DB_HOST` and `REBUNDLE_FORBID_R2_BUCKET` that do not match the configured database host or R2 buckets
     - `--mode worker` (`in-process` and `--skip-browser-verify` are refused).
   - Read-only paths (`--dry-run` and `--status`) still enforce `APP_ENV === "local" | "staging"` and the production forbid-list, and print only `{ appEnv, dbHost, r2Host, r2Bucket }` (never URLs, passwords, keys, or tokens).
2. **Roll-Out Dry-Run Counts (`scanRebundleCandidates`):**
   - Reports `countsByState`, `staleCountsByState`, `countsByEngineDigest`, `staleCountsByEngineDigest`, `upToDateCount`, `legacySkippedProjects`, `frozenManifestVariantCount`, `exportInFlightVariantCount`, `frozenOrInFlightVariantCount`, `frozenOrInFlightVariantIds`, `totalBytesToStage` (sum of current bundle sizes from `bundle_manifest`), `sampleCandidateIds` (`--sample`, default `5`), `after`, and `nextCursor`.
3. **Batching & Queue Cap (`--limit`, `--after`, `--max-in-flight`):**
   - `--after <variantId>` looks up the cursor variant's `(created_at, project_id, scene_index, aspect, id)` in `app.plate_variants` and resumes strictly after it, even if the previous batch's worker jobs are still in flight or already committed.
   - `--max-in-flight N` (default `5`) queries `pgboss.job` (`name = 'plate-rebundle' AND state IN ('created', 'retry', 'active')`) before each candidate and stops staging/enqueuing once `N` jobs are in flight.
4. **Read-Only Batch Verification (`--status [minutes]`):**
   - `getRebundleStatus` runs inside a `BEGIN READ ONLY` transaction and does not invoke `migrate()` or `startQueues()`, guaranteeing zero database writes.
   - For every variant touched in the last `N` minutes (default `60`), prints its `pgboss.job` state (`jobState`, `job`), its `author = 'engine-rebundle'` revision row (`revision`), and `activeBundleIsNew`.
5. **Batch Rollback (`--rollback-last <n>`):**
   - `rollbackLastRebundleCommits(n)` queries active `author = 'engine-rebundle'` revisions ordered by `r.created_at DESC, v.updated_at DESC, r.rev DESC, v.id DESC LIMIT $1` and rolls each back atomically via `rollbackRebundleRevision`.

---

## 4. Verification & Test Suite Results

- **Typecheck (`cd backend && npm run typecheck`):** Clean (`0` errors).
- **New & existing re-bundle tests (`plates_rebundle_test_staging`, created and dropped):**
  - `test/plate-rebundle-staging.mjs` -> `plate rebundle staging: ok`
  - `TIMING_LOCK_HELD=1 ... test/plate-rebundle.mjs` -> `plate rebundle: ok`
  - `test/plate-rebundle-fence.mjs` -> `plate rebundle fence: ok`
  - `test/plate-rebundle-rollback.mjs` -> `plate rebundle rollback: ok`
  - `test/plate-rebundle-gc.mjs` -> `plate rebundle gc: ok`
  - `test/plate-bundle-immutable.mjs` -> `plate bundle immutable: ok`
  - `test/plate-legacy-keys.mjs` -> `plate legacy keys: ok`
  - `test/worker-launcher-rebundle.mjs` -> `worker launcher rebundle: ok`
- **Full backend test loop on a fresh database (`plates_rebundle_test_loop`, created and dropped):**
  - Only the 5 pre-existing known failures occurred (`test/billing.mjs`, `test/brand-files.mjs`, `test/render-prep.mjs`, `test/styles.mjs`, `test/visuals.mjs`); every other backend test passed.

---

## 5. Files Changed (with Line Counts)

| File | Status | Total Lines | Diff (`+` / `-`) | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| `backend/src/scripts/rebundle-plates.ts` | modified | `591` | `+418 / -24` | `enforceStagingOptIn`, `PRODUCTION_FORBID_LIST`, `--after`, `--max-in-flight`, `--sample`, `--status`, `--rollback-last`, secret-free environment summary |
| `backend/src/plates/rebundle.ts` | modified | `1106` | `+444 / -2` | Cursor pagination (`after`/`nextCursor`), roll-out dry-run counts, `countInFlightRebundleJobs`, `getRebundleStatus`, `rollbackLastRebundleCommits` |
| `backend/test/plate-rebundle-staging.mjs` | new | `832` | `+832 / -0` | Staging guard, production forbid-list, secret redaction, dry-run counts, `--after` batching, `--max-in-flight`, read-only `--status`, and `--rollback-last` tests |
| `docs/phase3/rebundle-staging-runbook.md` | new | `261` | `+261 / -0` | Operator runbook for staging dry-run, single-scene canary, browser verification, batch loop, monitoring, stop conditions, and rollback |
| `docs/phase3/rebundle-staging-report.md` | new | `114` | `+114 / -0` | Implementation and verification report |
