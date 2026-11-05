# Staging Plate Re-bundle Roll-out Runbook

This runbook covers the staging roll-out of existing plate variants onto the current `@videosaas/plate-engine` (`0.6.5`) using `/app/backend/src/scripts/rebundle-plates.ts` inside the Railway staging `backend` container.

> **Operator note:** The coding agent / manager session cannot run `railway ssh`; the owner executes these commands directly in a terminal authenticated to Railway and AWS.

---

## 1. Preconditions (Must All Hold Before Starting)

1. **Worker image deployed and healthy on ECS (`greedymotion-staging`):**
   - The staging worker image includes `@videosaas/plate-engine` `0.6.5`, `PLATE_REBUNDLE_QUEUE` (`"plate-rebundle"`), and `handlePlateRebundle` wired in `worker/src/worker.mjs` (`startConsuming()`).
   - Verify the latest active task definition in `ap-southeast-1` (`greedymotion-staging-worker`) is deployed via `infra/aws/deploy-worker.sh` and CloudWatch log group `/ecs/greedymotion-staging-worker` shows clean startup when a task launches.
2. **Backend deployed on Railway (`staging` / `backend`):**
   - Migration `030_plate_revision_manifest.sql` (`alter table app.plate_revisions add column if not exists bundle_manifest jsonb`) has been applied at backend startup.
   - Content-addressed key helpers (`sources/<sourceSha>/source.ts`, `bundles/<bundleSha>/bundle.html`, `bundles/<bundleSha>/manifest.json`) and the `rebundle.commit` control operation are active.
   - `GET https://backend-staging-aec6.up.railway.app/healthz` returns `200 OK`.
3. **Worker wake-up & demand fix present (`backend/src/jobs/worker-launcher.ts` & `backend/src/plates/rebundle.ts`):**
   - `rebundleVariant(..., { mode: "worker" })` calls `void kickPlateWorkers()` immediately after `boss.send(QUEUES.plateRebundle, ...)`.
   - `plateDemand()` in `worker-launcher.ts` counts runnable (`created`/`retry` with `start_after <= now()`) and `active` `plate-rebundle` rows in `pgboss.job`, waking Fargate tasks from zero when the worker pool is idle.

---

## 2. Opening a Shell or Running Commands in the Staging Backend Container

Target Railway coordinates (non-secret, from `docs/SYSTEM_GUIDE.md`):
- **Project:** `lively-presence` (`5298f20e-3531-44a5-a32e-7b99b0cb5b09`)
- **Environment:** `staging` (`07084322-b9de-41c1-8bd0-225ffa063faf`)
- **Service:** `backend` (`df6c5746-6c6e-4275-897d-75bb0cd6370b`)
- **Container working directory:** `/app/backend`

Open an interactive shell inside the staging backend container:

```sh
railway ssh --project 5298f20e-3531-44a5-a32e-7b99b0cb5b09 --environment staging --service backend
```

*(Alternatively, prefix any single command below with `railway ssh --project 5298f20e-3531-44a5-a32e-7b99b0cb5b09 --environment staging --service backend -- `.)*

---

## 3. Step 1 — Read-Only Dry-Run Scan

Run the dry-run first. It writes nothing to Postgres or R2, requires no opt-in write variables, and prints only sanitized host/bucket names (never URLs, passwords, keys, or tokens):

```sh
node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts --dry-run --sample 5
```

Inspect the JSON output and record:
- `environment.appEnv` (must be `"staging"`), `environment.dbHost` (expected `aws-0-ap-southeast-1.pooler.supabase.com`), and `environment.r2Bucket` (expected `greedymotion-staging-uploads`).
- `currentEngineVersion` (`"0.6.5"`) and `currentEngineDigest`.
- `countsByState` and `staleCountsByState` (how many `checked`, `drawn`, `bundled` variants exist and how many need re-bundling).
- `countsByEngineDigest` and `staleCountsByEngineDigest` (distribution of old engine digests vs `currentEngineDigest`).
- `legacySkippedProjects` and `legacyprojectIds` (pre-018 projects without `app.plate_variants` rows that are safely skipped).
- `frozenManifestVariantCount`, `exportInFlightVariantCount`, and `frozenOrInFlightVariantCount` (informational: variants belonging to ratios with frozen export manifests or active exports/renders).
- `totalBytesToStage` (sum of current bundle sizes from `bundle_manifest`).
- `sampleCandidateIds` (first 5 candidate `variantId`s) and `candidateCount`.

---

## 4. Step 2 — Single-Variant Canary (`--apply --limit 1 --mode worker`)

Set the staging opt-in and production forbid-list environment variables (replacing `REBUNDLE_EXPECT_DB_HOST` and `REBUNDLE_EXPECT_R2_BUCKET` only if `environment.dbHost` / `environment.r2Bucket` from the dry-run differ) and stage **1** variant in worker mode:

```sh
REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging" \
REBUNDLE_EXPECT_DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com" \
REBUNDLE_EXPECT_R2_BUCKET="greedymotion-staging-uploads" \
REBUNDLE_FORBID_DB_HOST="db.bwwquxhexwyodsavsjar.supabase.co" \
REBUNDLE_FORBID_R2_BUCKET="greedymotion-production-uploads" \
  node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts \
  --apply --limit 1 --mode worker
```

What happens:
1. Phase 1 (backend): fetches `source.ts`, verifies `sourceSha`, compiles the new bundle on `@videosaas/plate-engine` `0.6.5` with zero model calls, uploads `bundles/<bundleSha>/bundle.html` and `manifest.json` to R2, verifies object size, enqueues 1 job on `plate-rebundle`, and calls `kickPlateWorkers()`.
2. Phase 2 (worker): the ECS Fargate worker downloads the staged bundle, verifies `bundleDigest`, runs the 2-page double-draw determinism check (`verifyScene`) in headless Chromium, and calls `rebundle.commit` to atomically bump `rev = rev + 1` (`author = 'engine-rebundle'`).

Check the canary status (read-only) until `inFlightJobs` drops to `0` and `activeBundleIsNew` is `true`:

```sh
node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts --status 15
```

Confirm in the `--status` JSON for the canary variant:
- `jobState`: `"completed"`
- `revision.author`: `"engine-rebundle"`
- `revision.rev`: `oldRev + 1`
- `activeBundleIsNew`: `true`
- `activeBundleKey`: `plates/<projectId>/<aspect>/<scene>/g<gen>/bundles/<bundleSha>/bundle.html`

---

## 5. Step 3 — Browser & Frozen-Render Verification of the Canary Scene

Before running the batch loop, verify the canary variant's project (`<projectId>` and `<variantId>` from the canary output) in the browser on <https://greedy-motion-staging.vercel.app>:

1. **Bundle route returns the new content-addressed key:**
   - Open DevTools Network tab on `/studio?p=<projectId>&step=3` (or call `GET /v1/projects/<projectId>/plates/<variantId>/bundle` with the staging user's Bearer token).
   - Confirm the response JSON has:
     - `url` pointing to `.../bundles/<bundleSha>/bundle.html` (the new `activeBundleKey`),
     - `bundleDigest` matching `activeBundleDigest` from `--status`,
     - `manifest.engineDigest` matching `currentEngineDigest` (`0.6.5`).
2. **Live preview plays cleanly:**
   - Press Play in the staging workspace for `<projectId>`.
   - Confirm the re-bundled scene renders on the live canvas with zero console errors, smooth frame pacing, and intact scene parameters/subtitles.
3. **Frozen render / export compatibility:**
   - If the project has an existing companion export or final render (or trigger an export), confirm that:
     - Any previously frozen manifest continues to verify and play its existing objects (old keys in R2 are untouched), and
     - A newly requested companion export freezes `rev = 1` (`bundles/<bundleSha>/bundle.html`) and assembles to `ready`.

---

## 6. Step 4 — Cursor Batch Loop with `--max-in-flight`

Once the canary is verified in the browser, process the remaining variants in batches using `--after <nextCursor>` and `--max-in-flight 5` (default `5`, which prevents enqueuing more worker jobs whenever 5 staged jobs are still `created`, `retry`, or `active` in `pgboss.job`):

```sh
CURSOR="<nextCursor-from-canary>"

while [ -n "$CURSOR" ] && [ "$CURSOR" != "null" ]; do
  echo "=== Starting batch after cursor: $CURSOR ==="
  OUT=$(
    REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging" \
    REBUNDLE_EXPECT_DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com" \
    REBUNDLE_EXPECT_R2_BUCKET="greedymotion-staging-uploads" \
    REBUNDLE_FORBID_DB_HOST="db.bwwquxhexwyodsavsjar.supabase.co" \
    REBUNDLE_FORBID_R2_BUCKET="greedymotion-production-uploads" \
      node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts \
      --apply --limit 10 --after "$CURSOR" --max-in-flight 5 --mode worker
  )
  echo "$OUT"

  # Wait until in-flight worker jobs drain before advancing
  while true; do
    STATUS=$(node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts --status 30)
    IN_FLIGHT=$(printf '%s' "$STATUS" | node -e '
      let d = "";
      process.stdin.on("data", c => d += c);
      process.stdin.on("end", () => {
        const idx = d.indexOf("{");
        const j = JSON.parse(d.slice(idx));
        console.log(j.inFlightJobs ?? 0);
      });
    ')
    echo "inFlightJobs=$IN_FLIGHT"
    [ "$IN_FLIGHT" -eq 0 ] && break
    sleep 10
  done

  CURSOR=$(printf '%s' "$OUT" | node -e '
    let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      const idx = d.indexOf("{");
      const j = JSON.parse(d.slice(idx));
      console.log(j.nextCursor ?? "");
    });
  ')
done
```

After the loop finishes, run a final `--dry-run` and `--status 60`:

```sh
node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts --dry-run
node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts --status 60
```

Confirm `candidateCount: 0` (or only newly-authored variants still in flight) and `inFlightJobs: 0`. Because re-bundling is idempotent, running `--apply` again when all variants are on `currentEngineDigest` is a no-op (`candidateCount: 0`).

---

## 7. What to Watch During the Roll-Out

1. **Worker CloudWatch logs (`/ecs/greedymotion-staging-worker`):**
   - `plate_rebundle_committed`: normal completion (`{ variantId, projectId, gen, rev, bundleKey, bundleDigest }`).
   - `plate_rebundle_fenced`: benign concurrent user edit/repair bumped `gen` or `rev` while the worker was verifying; the user's newer edit was preserved untouched.
   - `plate_rebundle_verify_failed`: Chromium `verifyScene` or digest check failed; the variant stayed on its previous working bundle without modifying Postgres.
2. **Backend Railway logs (`staging` / `backend`):**
   - `plate_rebundle_failed`: Phase 1 bundling or storage failure (`source_not_found_in_storage`, `sourceSha_mismatch`, `bundle_failed`, `storage_failed`).
   - `worker_launched`: ECS launcher waking Fargate worker tasks (`demand`, `running`, `wanted`, `started`).
3. **Queue depth & error rate (`--status 30`):**
   - `inFlightJobs` should stay `<= 5` (bounded by `--max-in-flight 5`) and drain to `0` within 30–90 seconds per batch.
   - `jobCountsByState.failed` should remain `0`.

---

## 8. Stop Conditions

**Stop the batch loop immediately and do not advance the cursor if any of the following occurs:**

1. **Any `sourceSha_mismatch` or `content_address_collision` error** appears in backend or worker logs.
2. **Failure rate exceeds 1 variant** (`failed > 1` in batch output or `jobCountsByState.failed > 1` in `--status`) due to `plate_rebundle_verify_failed` or `bundle_failed`.
3. **Queue stalls:** `inFlightJobs > 0` does not decrease for more than **5 minutes** (indicates ECS tasks are failing to launch or crashing).
4. **Live preview regression:** any re-bundled scene fails to load or throws a runtime error in the browser preview on `greedy-motion-staging.vercel.app`.
5. **Unexpected environment summary:** `environment.dbHost` or `environment.r2Bucket` does not match the staging Supabase pooler / `greedymotion-staging-uploads`.

---

## 9. Rollback Commands

Every rollback command is fenced (`FOR UPDATE`), restores `rev - 1` (`bundle_key`, `bundle_digest`, `bundle_manifest`, `source_key`) only if the active revision has `author = 'engine-rebundle'`, and leaves all content-addressed objects in R2 intact so any export manifest frozen while `newRev` was active still renders cleanly.

### 9.1 Roll back a single variant by ID

```sh
REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging" \
REBUNDLE_EXPECT_DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com" \
REBUNDLE_EXPECT_R2_BUCKET="greedymotion-staging-uploads" \
REBUNDLE_FORBID_DB_HOST="db.bwwquxhexwyodsavsjar.supabase.co" \
REBUNDLE_FORBID_R2_BUCKET="greedymotion-production-uploads" \
  node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts \
  --rollback <variantId> --mode worker
```

### 9.2 Roll back the last N `engine-rebundle` commits (undo a batch without listing IDs)

```sh
REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging" \
REBUNDLE_EXPECT_DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com" \
REBUNDLE_EXPECT_R2_BUCKET="greedymotion-staging-uploads" \
REBUNDLE_FORBID_DB_HOST="db.bwwquxhexwyodsavsjar.supabase.co" \
REBUNDLE_FORBID_R2_BUCKET="greedymotion-production-uploads" \
  node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts \
  --rollback-last 10 --mode worker
```

### 9.3 Roll back all `engine-rebundle` revisions (scoped to a project or globally)

```sh
# Scoped to one project:
REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging" \
REBUNDLE_EXPECT_DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com" \
REBUNDLE_EXPECT_R2_BUCKET="greedymotion-staging-uploads" \
REBUNDLE_FORBID_DB_HOST="db.bwwquxhexwyodsavsjar.supabase.co" \
REBUNDLE_FORBID_R2_BUCKET="greedymotion-production-uploads" \
  node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts \
  --rollback all-engine-rebundle --project <projectId> --mode worker

# Global across all staging projects:
REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging" \
REBUNDLE_EXPECT_DB_HOST="aws-0-ap-southeast-1.pooler.supabase.com" \
REBUNDLE_EXPECT_R2_BUCKET="greedymotion-staging-uploads" \
REBUNDLE_FORBID_DB_HOST="db.bwwquxhexwyodsavsjar.supabase.co" \
REBUNDLE_FORBID_R2_BUCKET="greedymotion-production-uploads" \
  node --experimental-strip-types /app/backend/src/scripts/rebundle-plates.ts \
  --rollback all-engine-rebundle --mode worker
```

---

## 10. What to Record After the Roll-Out

Record the following non-secret evidence in the release / roll-out log (never include database URLs, passwords, access keys, or signed URLs):
1. Deployed git commit SHA on Railway `staging` / `backend` and ECS task definition revision (`greedymotion-staging-worker:<rev>`).
2. Initial `--dry-run` JSON summary (`countsByState`, `staleCountsByState`, `countsByEngineDigest`, `legacySkippedProjects`, `frozenManifestVariantCount`, `exportInFlightVariantCount`, `totalBytesToStage`, `candidateCount`).
3. Canary `variantId`, `projectId`, old vs new `bundleKey` and `bundleDigest`, and browser verification result (live preview + frozen render check).
4. Per-batch summary counts (`queuedWorker`, `committedCount`, `fenced`, `failed`) and total elapsed wall time.
5. Final `--dry-run` and `--status 60` output confirming `candidateCount: 0` and `inFlightJobs: 0`.
