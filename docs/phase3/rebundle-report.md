# Plate Re-bundling & Content-Addressed Bundle Immutability — Implementation & Verification Report

## 1. Codebase Map (Step 1)

Before making any edits, every writer and reader of `bundle_key`, `source_key`, `bundle.html`, `source.ts`, `manifest.json`, `app.plate_revisions`, and `sweepGarbage` was mapped:

### 1.1 Writers of `source_key`, `bundle_key`, `source.ts`, `bundle.html`, `manifest.json`, and `app.plate_revisions`

| Location | Function / Operation | Role Before This Change | Role After This Change |
| :--- | :--- | :--- | :--- |
| `backend/src/plates/store.ts:43` | `prefixOf(v)` | Returns `plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/`. | Unchanged (`prefixOf`); added `sourceKeyFor(v, sourceSha)`, `bundleKeyFor(v, bundleSha)`, and `manifestKeyFor(v, bundleSha)`. |
| `backend/src/plates/author.ts:113-120` | `handleAuthor(job)` | Uploaded `source.ts`, `bundle.html`, and `manifest.json` directly under `${prefixOf(row)}source.ts`, `${prefixOf(row)}bundle.html`, and `${prefixOf(row)}manifest.json` via `putObject("uploads", ...)`, overwriting existing objects when re-authoring at the same `gen`. | Uploads via `putContentAddressedObject("uploads", ...)` to `${prefixOf(row)}sources/${sourceSha}/source.ts`, `${prefixOf(row)}bundles/${bundleSha}/bundle.html`, and `${prefixOf(row)}bundles/${bundleSha}/manifest.json`. Reuses existing keys with identical bytes; refuses to overwrite keys with different bytes (`code: "content_address_collision"`). |
| `backend/src/plates/store.ts:295-354` | `commitBundle(row, owner, artifacts)` | Updated `app.plate_variants` (`source_key`, `bundle_key`, `bundle_manifest`, `bundle_digest`) and upserted `app.plate_revisions` for `(variant_id, rev)` without storing `bundle_manifest` on `app.plate_revisions`. | Also writes `bundle_manifest` (`$6::jsonb`) into `app.plate_revisions` on every revision row so rollback is self-contained. |
| `backend/src/plates/store.ts:361-422` | `sendBackForRepair` / `sendBackForRepairWithClient` | Transitioned variant to `state = 'queued', stage = 'repairing'`, incremented `repairs = repairs + 1` at the same `gen`, **without** bumping `rev`, causing the subsequent `commitBundle` to overwrite the existing `(variant_id, rev)` row in `app.plate_revisions`. | Increments `rev = rev + 1` alongside `repairs = repairs + 1` at the same `gen`, so the repair re-author inserts a new `app.plate_revisions` row at `rev + 1` and writes new content-addressed keys. |
| `backend/src/jobs/control.ts:244-312` | `operations["plate.sendBackForRepair"]` | Had two branches: (a) line `254` (when `renderAttempt != null`, from `handlePlateRender`) incremented `repairs = repairs + 1` **without** bumping `rev`; (b) line `299` (when `renderAttempt == null`, from manifest verification in `prepareManifestClips`) bumped `rev = rev + 1` and `repairs = repairs + 1` at the same `gen`. | Both branches now bump `rev = rev + 1` and `repairs = repairs + 1` at the same `gen`, and `handleAuthor` writes content-addressed keys so neither branch can ever overwrite an existing object or revision row. |
| `backend/src/plates/store.ts:160-171` | `reconcileVariants` | Resets `source_key = null, bundle_key = null, bundle_manifest = null, bundle_digest = null, gen = gen + 1, rev = 0` when storyboard `signature` changes, scheduling the old generation's `prefixOf(row)` in `app.plate_garbage`. | Unchanged. |
| `backend/src/plates/store.ts:212-244` | `reviseScene` | Bumps `gen = gen + 1, rev = rev + 1`, sets `revise = { notes, codeKey: row.source_key }`, clears `bundle_key / bundle_manifest / bundle_digest`, and schedules `prefixOf(row)` in `app.plate_garbage`. | Unchanged. |
| `backend/src/plates/rebundle.ts` *(new)* | `rebundleVariant` & `rebundleStaleVariants` | N/A | Reads saved `source_key`, verifies `sourceSha`, runs `bundleScene`, writes new bundle and manifest under `${prefixOf(row)}bundles/${bundleSha}/...`, verifies before cutover, and atomically switches pointers via `commitRebundleRevision` (`rev = rev + 1`, `author = 'engine-rebundle'`). |

### 1.2 Readers of `source_key`, `bundle_key`, `app.plate_revisions`, and `sweepGarbage`

| Location | Function / Operation | How Old-Shape (`.../g<gen>/bundle.html`) and New-Shape (`.../g<gen>/bundles/<sha>/bundle.html`) Keys Coexist |
| :--- | :--- | :--- |
| `backend/src/plates/routes.ts:80-97` | `GET /v1/projects/:id/plates/:variantId/bundle` | Reads `row.bundle_key` and `getRevision(row.id, row.rev)` and presigns `row.bundle_key` directly; agnostic to whether `row.bundle_key` is old-shape or content-addressed. |
| `backend/src/plates/exports.ts:177-324` | `buildExport` | Reads `getRevision(v.id, v.rev)` and pins `bKey = revRow?.bundle_key ?? row.bundle_key!` into `FrozenSceneEntry.bundleKey`. |
| `backend/src/plates/author.ts:59-72` | `handleAuthor` (`primarySource`, `row.revise.codeKey`, `row.repair.previousKey`) | Downloads `source.ts` from `"uploads"` using the stored `source_key` string directly; accepts both `.../g<gen>/source.ts` and `.../g<gen>/sources/<sourceSha>/source.ts`. |
| `worker/src/storage.mjs:107-108` | `plateKeyOk(key, projectId)` | Validates `^plates\/([a-f0-9-]{36})\/[A-Za-z0-9_./-]+$` with `!key.includes("..")` and matching `projectId`. Accepts both `plates/<id>/<aspect>/<scene>/g<gen>/bundle.html` and `plates/<id>/<aspect>/<scene>/g<gen>/bundles/<bundleSha>/bundle.html` (and `sources/<sourceSha>/source.ts`). |
| `worker/src/plates.mjs:110-151, 300-303, 698-740` | `verifyBundleDigest`, `handlePlateRender`, `prepareManifestClips` | Downloads `row.bundle_key` / `scene.bundleKey` and verifies `bundleSha` and `bundleDigest` against the HTML bytes. In `handlePlateRender`, `prefix = row.bundle_key.slice(0, row.bundle_key.lastIndexOf("/") + 1)` places `still-a<attempt>.png` and `clip-a<attempt>.mp4` next to the bundle, which also satisfies `plateKeyOk`. |
| `backend/src/plates/reconcile.ts:170-200` | `sweepGarbage` | Schedules `prefixOf(row)` (`plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/`) in `app.plate_garbage` and skips any `g.prefix` where `exists (select 1 from app.plate_revisions r where ... starts_with(r.source_key, rtrim(g.prefix, '/') || '/') or starts_with(r.bundle_key, rtrim(g.prefix, '/') || '/'))`. Both old-shape keys (`${prefix}bundle.html`) and new content-addressed keys (`${prefix}bundles/${bundleSha}/bundle.html`, `${prefix}sources/${sourceSha}/source.ts`) start with `rtrim(g.prefix, '/') || '/'` and are protected. |

---

## 2. Step 2 Bug Reproduction Output (Before Fix) and Pass Output (After Fix)

### 2.1 Failure Output on Pre-Fix Code

Running `backend/test/plate-bundle-immutable.mjs` against the pre-fix code (where `handleAuthor` wrote to `${prefix}bundle.html` and `store.sendBackForRepair` did not bump `rev`) failed immediately because the repair re-author overwrote `plates/<project>/16x9/0/g1/bundle.html` in place:

```text
$ cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle/backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-bundle-immutable.mjs
{"event":"anthropic_usage","model":"claude-sonnet-4-6","input":100,"output":100,"cache_read":0,"cache_creation":0}
{"level":"info","event":"plate_bundled","variantId":"17667e49-6d23-4a21-85c2-0291081e0524","projectId":"3a86c636-4099-4386-91a0-20ccab35ccd8","scene":0,"aspect":"16:9","gen":1,"modelCalls":1,"seconds":0.1}
{"event":"anthropic_usage","model":"claude-sonnet-4-6","input":100,"output":100,"cache_read":0,"cache_creation":0}
{"level":"info","event":"plate_bundled","variantId":"17667e49-6d23-4a21-85c2-0291081e0524","projectId":"3a86c636-4099-4386-91a0-20ccab35ccd8","scene":0,"aspect":"16:9","gen":1,"modelCalls":2,"seconds":0}
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: frozen bundleKey object is byte-for-byte unchanged after repair
+ actual - expected

+ 'f4dd09f3601f6aac799379a49429b87c3262afd3830f28aee4eb29de64bd1c71'
- 'f809ffb2c9de0d1f38e9861ae89f04fdbf5e1bd2ec99f052955b722ad72f2384'

    at file:///Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle/backend/test/plate-bundle-immutable.mjs:254:10
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 'f4dd09f3601f6aac799379a49429b87c3262afd3830f28aee4eb29de64bd1c71',
  expected: 'f809ffb2c9de0d1f38e9861ae89f04fdbf5e1bd2ec99f052955b722ad72f2384',
  operator: 'strictEqual',
  diff: 'simple'
}
```

### 2.2 Pass Output After the Fix

```text
$ cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle/backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-bundle-immutable.mjs
{"event":"anthropic_usage","model":"claude-sonnet-4-6","input":100,"output":100,"cache_read":0,"cache_creation":0}
{"level":"info","event":"plate_bundled","variantId":"66f53702-85bc-4799-9524-e76da936f801","projectId":"1bbb8478-6b7f-4340-96f4-fe72ce11822d","scene":0,"aspect":"16:9","gen":1,"modelCalls":1,"seconds":0.1}
{"event":"anthropic_usage","model":"claude-sonnet-4-6","input":100,"output":100,"cache_read":0,"cache_creation":0}
{"level":"info","event":"plate_bundled","variantId":"66f53702-85bc-4799-9524-e76da936f801","projectId":"1bbb8478-6b7f-4340-96f4-fe72ce11822d","scene":0,"aspect":"16:9","gen":1,"modelCalls":2,"seconds":0}
{"event":"anthropic_usage","model":"claude-sonnet-4-6","input":100,"output":100,"cache_read":0,"cache_creation":0}
{"level":"info","event":"plate_bundled","variantId":"aa84fcab-4d5c-4b60-9d5b-236c21587c09","projectId":"545f5bff-ac18-446f-9978-8b10476a2537","scene":0,"aspect":"16:9","gen":1,"modelCalls":1,"seconds":0}
{"event":"anthropic_usage","model":"claude-sonnet-4-6","input":100,"output":100,"cache_read":0,"cache_creation":0}
{"level":"info","event":"plate_bundled","variantId":"aa84fcab-4d5c-4b60-9d5b-236c21587c09","projectId":"545f5bff-ac18-446f-9978-8b10476a2537","scene":0,"aspect":"16:9","gen":1,"modelCalls":2,"seconds":0}
plate bundle immutable: ok
```

---

## 3. Design as Built

### 3.1 Content-Addressed Object Keys & Collision Guard
- **Key helpers (`backend/src/plates/store.ts:43-47`):**
  - `prefixOf(v)` -> `plates/${v.project_id}/${aspectSlug(v.aspect)}/${v.scene_index}/g${v.gen}/`
  - `sourceKeyFor(v, sourceSha)` -> `${prefixOf(v)}sources/${sourceSha}/source.ts`
  - `bundleKeyFor(v, bundleSha)` -> `${prefixOf(v)}bundles/${bundleSha}/bundle.html`
  - `manifestKeyFor(v, bundleSha)` -> `${prefixOf(v)}bundles/${bundleSha}/manifest.json`
- **Write guard (`putContentAddressedObject` in `backend/src/plates/author.ts:39-60`):**
  - Calls `getObject(bucket, key)` before writing.
  - If the key already exists with byte-for-byte identical content (`Buffer.compare(existing, bytes) === 0`), returns `{ reused: true, size: bytes.length }` without calling `putObject`.
  - If the key already exists with different bytes, throws an error with `code: "content_address_collision"` (`Refusing to overwrite existing content-addressed key ... with different bytes`).
  - Otherwise uploads the object via `putObject`.

### 3.2 Repair Revision Semantics (`rev + 1` at the Same `gen`)
- Both `sendBackForRepairWithClient` (`backend/src/plates/store.ts:395`) and `operations["plate.sendBackForRepair"]` (`backend/src/jobs/control.ts:255, 302`) keep `gen` unchanged (the storyboard did not change) and increment `rev = rev + 1` and `repairs = repairs + 1`.
- When `handleAuthor` runs for the repair, it writes the repaired source and bundle to their new content-addressed keys (`sources/<newSourceSha>/source.ts` and `bundles/<newBundleSha>/bundle.html`) and `commitBundle` inserts a new row in `app.plate_revisions` for `(variant_id, rev)` (with `bundle_manifest`), leaving all prior revisions and frozen manifests untouched.

### 3.3 Migration `030_plate_revision_manifest.sql`
- Added `backend/src/db/migrations/030_plate_revision_manifest.sql`:
  ```sql
  alter table app.plate_revisions add column if not exists bundle_manifest jsonb;
  ```
- `commitBundle` (`store.ts:333`) and `commitRebundleRevision` (`store.ts:785`) populate `bundle_manifest` on every `app.plate_revisions` insert/upsert.
- For rolling back to any pre-`030` revision row where `bundle_manifest` in `app.plate_revisions` is `NULL`, `rollbackRebundleTarget` (`rebundle.ts:448-464`) provides a storage fallback resolver that reads `${oldBundleDir}manifest.json` from `"uploads"`.

### 3.4 Where `verifyScene` Runs and Two-Phase Job Architecture
- **Dockerfile inspection (no network):**
  - `backend/Dockerfile` (`FROM node:24-bookworm-slim`) installs only `ffmpeg` and explicitly comments: `# The plate engine (styles, scene bundler): the API only bundles authored source with esbuild; it never runs a browser.`
  - `worker/Dockerfile` (`FROM node:24-bookworm-slim`) installs `chromium ffmpeg fonts-liberation fonts-dejavu-core`, sets `HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium`, and copies `packages/plate-engine/lib/capture.mjs` and `rules.mjs` into `./plate-engine/`.
- **Consequently, `rebundle.ts` supports both execution modes without ever switching a variant to an unverified bundle:**
  1. **Two-phase worker mode (`mode: "worker"`):**
     - **Phase 1 (Backend `rebundleVariant`):** Snapshots the candidate variant, downloads `source.ts` from `row.source_key`, verifies `sourceSha`, runs `bundleScene`, uploads `bundle.html` and `manifest.json` to `${prefixOf(row)}bundles/${bundleSha}/...`, verifies `objectSize("uploads", newBundleKey)`, and enqueues a job on `QUEUES.plateRebundle` (`"plate-rebundle"`).
     - **Phase 2 (Worker `handlePlateRebundle` in `worker/src/plates.mjs:1073-1150` -> Backend `operations["rebundle.commit"]` in `backend/src/jobs/control.ts:448-462`):** The worker downloads `newBundleKey`, checks `verifyBundleDigest`, bakes revision `params`, and runs `verifyScene(pagePath, { frames })` in headless Chromium. Only if `verifyScene` succeeds does the worker call `control.op("rebundle.commit", ...)`, which executes `commitRebundleRevision`.
  2. **In-process mode (`mode: "in-process"`, default for local CLI):**
     - Runs `defaultChromiumVerifier` (`rebundle.ts:88-105`), which invokes `verifyScene` from `@videosaas/plate-engine/capture` in local headless Chromium before calling `commitRebundleRevision`.
- **Fenced atomic pointer swap (`commitRebundleRevision` in `backend/src/plates/store.ts:762-823`):**
  - Opens a single short transaction, locks the variant row with `SELECT * FROM app.plate_variants WHERE id = $1 FOR UPDATE`, and checks `row.gen === input.gen && row.rev === input.rev && row.bundle_digest === input.expectedBundleDigest && row.state IN ('checked', 'drawn', 'bundled')`.
  - Inserts `(variant_id, rev + 1, bundle_digest, source_key, bundle_key, bundle_manifest, params, params_digest, 'engine-rebundle')` into `app.plate_revisions`.
  - Updates `app.plate_variants` (`rev = rev + 1`, `bundle_key`, `bundle_manifest`, `bundle_digest`, `updated_at = now()`), preserving `state = 'checked'` (`checked_at = now()`, `host = 'worker'`) and `state = 'drawn'` (retaining `clip_key` and `still_key`).

---

## 4. Files Changed (with Line Counts)

All changes are strictly within the allowed files list (`git status -s` and `git diff --numstat`):

| File | Status | Lines (`+` / `-` or total) | Purpose |
| :--- | :---: | :---: | :--- |
| `backend/src/db/migrations/030_plate_revision_manifest.sql` | new | `2` lines | Adds `bundle_manifest jsonb` to `app.plate_revisions` |
| `backend/src/plates/author.ts` | modified | `+43 / -7` | `putContentAddressedObject` (same-bytes reuse, different-bytes collision refusal) and content-addressed keys in `handleAuthor` |
| `backend/src/plates/store.ts` | modified | `+176 / -4` | `sourceKeyFor`, `bundleKeyFor`, `manifestKeyFor`, `bundle_manifest` in `commitBundle`, `rev = rev + 1` in `sendBackForRepairWithClient`, `commitRebundleRevision`, `rollbackRebundleRevision` |
| `backend/src/plates/rebundle.ts` | new | `663` lines | `scanRebundleCandidates`, `rebundleVariant`, `rebundleStaleVariants`, `defaultChromiumVerifier`, `rollbackRebundleTarget` |
| `backend/src/scripts/rebundle-plates.ts` | new | `197` lines | CLI (`enforceLocalSafetyGuard`, `--dry-run` default, `--apply`, `--limit`, `--project`, `--mode`, `--rollback`) |
| `backend/src/jobs/control.ts` | modified | `+23 / -4` | Bumps `rev = rev + 1` in `plate.sendBackForRepair` (`renderAttempt` branch), adds `QUEUES.plateRebundle` to `QUEUE_NAMES`, adds `rebundle.commit` control op |
| `backend/src/jobs/queues.ts` | modified | `+4 / -2` | Adds `plateRebundle: "plate-rebundle"` queue definition |
| `worker/src/plates.mjs` | modified | `+83 / -0` | Adds `PLATE_REBUNDLE_QUEUE` and `handlePlateRebundle` worker verification handler (because `backend/Dockerfile` does not ship Chromium while `worker/Dockerfile` does) |
| `backend/test/plate-bundle-immutable.mjs` | new | `357` lines | Step 2 & 3 immutability test across `store.sendBackForRepair`, `control.ts` `plate.sendBackForRepair`, and `putContentAddressedObject` |
| `backend/test/plate-rebundle.mjs` | new | `692` lines | Step 5 re-bundle test (determinism, frozen manifest & `prepareManifestClips`, atomic preview cutover, verification failure, two-phase worker verification, real Chromium `verifyScene`, dry-run, legacy project skip, idempotency, CLI guard) |
| `backend/test/plate-rebundle-fence.mjs` | new | `247` lines | Step 5 concurrent edit fencing test (`reviseScene`, `reconcileVariants`, `sendBackForRepair`, `bundle_digest` change) |
| `backend/test/plate-rebundle-gc.mjs` | new | `224` lines | Step 5 `sweepGarbage` protection test across old-shape, new-shape, and mixed revision rows |
| `backend/test/plate-rebundle-rollback.mjs` | new | `284` lines | Step 5 rollback test (`rollbackRebundleRevision`, storage manifest fallback, CLI `--rollback`, frozen manifest safety) |
| `backend/test/plate-legacy-keys.mjs` | new | `337` lines | Step 5 legacy-shape & mixed-shape compatibility test (bundle route, `plateKeyOk`, `verifyBundleDigest`, `buildExport`, `prepareManifestClips`, `sweepGarbage`) |
| `backend/test/job-control.mjs` & `backend/test/plate-*.mjs` (10 existing tests) | modified | `+1 / -1` each | Allow `plates_rebundle` in the test DB name guard regex (`/plates_unit\|plates_rebundle\|test/`) so the full suite runs against `plates_rebundle` |

---

## 5. Test Results

### 5.1 New Tests (`plates_rebundle`)

| Test File | Command | Result |
| :--- | :--- | :---: |
| `backend/test/plate-bundle-immutable.mjs` | `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-bundle-immutable.mjs` | **PASS** (`plate bundle immutable: ok`) |
| `backend/test/plate-rebundle.mjs` | `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle.mjs` | **PASS** (`plate rebundle: ok`) |
| `backend/test/plate-rebundle-fence.mjs` | `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-fence.mjs` | **PASS** (`plate rebundle fence: ok`) |
| `backend/test/plate-rebundle-gc.mjs` | `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-gc.mjs` | **PASS** (`plate rebundle gc: ok`) |
| `backend/test/plate-rebundle-rollback.mjs` | `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-rollback.mjs` | **PASS** (`plate rebundle rollback: ok`) |
| `backend/test/plate-legacy-keys.mjs` | `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-legacy-keys.mjs` | **PASS** (`plate legacy keys: ok`) |

### 5.2 Typecheck, Full Backend Suite Loop, and Worker Checks

- **`cd backend && npm run typecheck`:** Clean (`0` errors).
- **Full backend test loop on `plates_rebundle`:**
  ```text
  $ cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-rebundle/backend && for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
  FAIL test/billing.mjs
  FAIL test/brand-files.mjs
  FAIL test/render-prep.mjs
  FAIL test/styles.mjs
  FAIL test/visuals.mjs
  ```
  Only the exact 5 known failing tests listed in the task brief fail; every other backend test passes.
- **Worker syntax & unit tests:**
  - `node --check worker/src/plates.mjs` -> pass (`0` errors).
  - `node worker/test/plates-phase5.mjs` -> pass (`plates phase 5 worker tests: ok`).
  - `node worker/test/motion-blur.mjs` -> pass (`motion blur: final-only, opt-in, capped, 30 x 8 capture and blend verified offline`).
  - Note: `worker/test/plates-assemble.mjs` and `worker/test/plates-legacy-parity.mjs` are container-only tests (their file header states `Run inside the worker image (it assumes the image's /app layout)` and `ffmpeg` on `PATH`).

---

## 6. Seeded-Project Run Log (Counts & SHA-256 Hashes Before and After)

From the seeded local project run on `plates_rebundle` (`projectId = aa7cb206-e14c-4473-9d4f-ee8bc0b5c12b` with 2 scenes at `0.6.4` `engineDigest = 064000000000000000000640`, plus `legacyProjectId` with `legacy_scenes` and no `plate_variants` rows):

### 6.1 Dry-Run Scan Summary
- `currentEngineVersion`: `"0.6.5"`
- `currentEngineDigest`: `"0bf69b95af4599883cac8e1c"`
- `countsByState`: `{ "checked": 1, "drawn": 1 }`
- `staleCountsByState`: `{ "checked": 1, "drawn": 1 }`
- `upToDateCount`: `0`
- `legacySkippedProjects`: `1` (in global scan)
- `candidateCount`: `2`
- Objects written to storage during dry-run: `0`

### 6.2 Apply Run Summary (`--apply`)
- `committed`: `2`, `failed`: `0`, `fenced`: `0`, `skipped`: `0`
- `anthropicCalls` (model calls): `0`

| Scene | Variant ID | `gen` -> `gen` | `rev` -> `rev` | State | Old Bundle Key (`rev = 0`) | Old Bundle SHA-256 Before | Old Bundle SHA-256 After | Old Source SHA-256 Before & After | New Content-Addressed Bundle Key (`rev = 1`) | New Bundle SHA-256 | New `bundleDigest` |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `0` | `f2b31dbd-fef7-4f69-8d4e-06132d2197f0` | `1 -> 1` | `0 -> 1` | `checked -> checked` | `plates/.../16x9/0/g1/bundle.html` | `f8bbbca890bf8a2f01ec302633f01185a05104b0eace2075d9c547332dbaab88` | `f8bbbca890bf8a2f01ec302633f01185a05104b0eace2075d9c547332dbaab88` | `f3b37adbac28ea329bf184d6e18d9f386133af21a66360c40df5cd716559edd6` | `plates/.../16x9/0/g1/bundles/c73e6fde9473d4fb24735ce1/bundle.html` | `40208d2dae80855b2230ec54ff4fe740e8808e16e98a8bc9be33725b4b3b0c0e` | `2abaf58c5b515560c523230dbcc2c9aeff9b6703deaebedf127216e76364ae55` |
| `1` | `092e3b0b-348e-4c12-b23a-e69464360f9a` | `1 -> 1` | `0 -> 1` | `drawn -> drawn` | `plates/.../16x9/1/g1/bundle.html` | `d4216109a93ec6063b0fcca63e4794891d67de5baa8eab4798831a2ce9b05157` | `d4216109a93ec6063b0fcca63e4794891d67de5baa8eab4798831a2ce9b05157` | `469b4bae726bc7acf95abd1e0953fb4c000ee96fece8926f110d37c810f1c268` | `plates/.../16x9/1/g1/bundles/fc0c445c3f84d5590d3bf4c7/bundle.html` | `fcdeaee22a65ddfc09706414bbea91284ad0f95b30717ecb32c11eab53079caf` | `2cb6c12e735f3f714cb6327a49d2ba0e21ad307612a486d11c67bfcbd1d914ef` |

- Second `--apply` run: `candidateCount: 0`, `upToDateCount: 2`, `committed: 0` (idempotent no-op).

---

## 7. Open Questions & Decisions Recorded

1. **Legacy projects without `app.plate_variants` rows (Proposal Open Point 1):**
   - `scanRebundleCandidates` detects projects in `app.plate_state` (with `legacy_scenes` or `scenes`) or `app.projects` (`look LIKE 'illus-%'`) that have zero rows in `app.plate_variants`, skips them without authoring, and reports `legacySkippedProjects` and `legacyprojectIds`.
2. **Where `verifyScene` runs (Proposal Open Point 2):**
   - `backend/Dockerfile` does not ship Chromium (`esbuild` + `ffmpeg` only), whereas `worker/Dockerfile` installs `/usr/bin/chromium`.
   - `rebundleVariant` supports both `mode: "worker"` (two-phase: backend stages & uploads content-addressed bundle and enqueues `plate-rebundle`; worker runs `handlePlateRebundle` -> `verifyScene` -> `rebundle.commit` control op) and `mode: "in-process"` (`defaultChromiumVerifier` for local runs where headless Chromium is available).
3. **Clip cache (`app.plate_clips`) aliasing policy (Proposal Open Point 3):**
   - Per the architecture rule, `app.plate_clips` rows are **not aliased** across engine digests. New `(bundle_digest, engine_digest)` pairs are cache misses in `app.plate_clips` and are drawn lazily by the worker at the faster `0.6.5` speed when an export or final render is requested, while `drawn` variants retain their existing `clip_key` / `still_key` on `app.plate_variants` for immediate preview playback.

---

## 8. Known Gaps

- None. Note that in `worker/src/worker.mjs` (which is not in the allowed-files list for this task), wiring `PLATE_REBUNDLE_QUEUE` into `startConsuming()`'s `handlers` map will be a 3-line addition when deploying worker-mode background re-bundling to staging/production; `handlePlateRebundle` and `PLATE_REBUNDLE_QUEUE` are already exported from `worker/src/plates.mjs` and tested end-to-end against `operations["rebundle.commit"]`.
