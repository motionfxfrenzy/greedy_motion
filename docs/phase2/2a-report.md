# Phase 2a Report — Backend for Live Plate Scenes

## 1. Files Created and Changed

### Created
- `backend/src/db/migrations/019_plate_live.sql` — Idempotent migration adding live columns and `'checked'` state constraint on `app.plate_variants`, `live_mode` / `live_mode_set_at` on `app.plate_state`, `app.plate_revisions`, and `app.plate_check_reports`, with manual rollback instructions.
- `backend/src/plates/digest.ts` — Pure identity helpers (`canonicalJson`, `paramsDigest`, `fontSetDigest`, `setFontSetDescriptor`, `bundleDigest`).
- `backend/test/plate-digest.mjs` — Unit tests for `canonicalJson`, `paramsDigest`, `fontSetDigest`, and `bundleDigest` properties.
- `backend/test/plate-live.mjs` — Integration tests for startup config validation, sticky `live_mode` decision, live vs clip bundling, check report fencing/idempotency, bounded code repair, env fallback, and `reviseScene` invalidation.
- `backend/test/plate-rollback.mjs` — Integration tests for `PLATE_LIVE_FORCE_OFF=1` reconciliation (`live_mode='clip'`, `checked`/`bundled` enqueueing, idempotency across passes, 20-per-pass rate limit, untouched in-flight authoring and `drawn` rows).
- `backend/test/plate-revisions.mjs` — Integration tests verifying atomic revision 0 creation on `commitBundle` and `sweepGarbage` skipping object prefixes referenced by `app.plate_revisions`.
- `backend/test/plate-live-routes.mjs` — HTTP route tests via Fastify `app.inject` for `/bundle`, `/check`, and `/clip-request`.
- `docs/phase2/2a-report.md` — This phase 2a implementation report.

### Changed
- `backend/src/config.ts` — Added `PLATE_LIVE_PREVIEW` (`config.plates.live`), `PLATE_LIVE_FORCE_OFF` (`config.plates.liveForceOff`), and `PLATE_PROJECT_CLIP_CAP` (`config.plates.projectClipCap`, default 4) with startup validation.
- `backend/.env.example` — Documented `PLATE_PIPELINE`, `PLATE_LIVE_PREVIEW`, `PLATE_LIVE_FORCE_OFF`, and `PLATE_PROJECT_CLIP_CAP`.
- `backend/src/plates/model.ts` — Extended `PlateState` / `VariantState` with `"checked"` and `"bundled"`, added `LiveMode`, and added `mode`, `variantId`, `bundleDigest`, and `live` fields to `PlateStatus`, `PlateScene`, and `PlateVariantView`.
- `backend/src/plates/store.ts` — Added `decideLiveMode`, `getLiveMode`, `listRevisions`, `getRevision`, `sendBackForRepair`, `submitCheckReport`, and `requestVariantClip`; updated `commitBundle` (records `bundle_digest`, writes revision row, skips `plate-render` in `live` mode), `reconcileVariants`, `reviseScene` (resets `checked` rows), and `readProjectState`.
- `backend/src/plates/service.ts` — Updated `startPlates` to decide `live_mode` on first entry and `plateStatus` to include `mode`, per-scene `variantId` / `bundleDigest` / `live`, and treat `checked` variants as playable in `live` mode.
- `backend/src/plates/reconcile.ts` — Updated `reconcilePlates` to skip `bundled`/`checked` variants for `live` projects, execute the rate-limited (20/pass) rollback when `config.plates.liveForceOff` is enabled, and updated `sweepGarbage` to skip prefixes referenced by `app.plate_revisions`.
- `backend/src/plates/routes.ts` — Added `GET /v1/projects/:id/plates/:variantId/bundle`, `POST /v1/projects/:id/plates/:variantId/check`, and `POST /v1/projects/:id/plates/:variantId/clip-request`.
- `backend/package.json` — Added test scripts `test:plate-digest`, `test:plate-live`, `test:plate-rollback`, `test:plate-revisions`, and `test:plate-live-routes`.

---

## 2. Commands Run and Test Results (Baseline vs After)

### Commands Run
```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend

# Individual plate tests
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-model.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-store.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-digest.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-live.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-rollback.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-revisions.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-live-routes.mjs

# TypeScript typecheck
npm run typecheck

# Full backend/test/*.mjs suite
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done
```

### Pass / Fail Per Test File (Before vs After)

| Test File | Baseline (Before) | After Phase 2a | Notes |
| --- | --- | --- | --- |
| `test/anthropic.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/billing.mjs` | FAIL (0/1) | FAIL (0/1) | Pre-existing (`actual: 'edit', expected: 'none'`) |
| `test/brand-files.mjs` | FAIL (0/1) | FAIL (0/1) | Pre-existing (`ENOENT: .../var/brands`) |
| `test/cloud-skills.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/entitlements-eval.mjs` | PASS (30/30) | PASS (30/30) | |
| `test/entitlements.mjs` | PASS (4/4) | PASS (4/4) | |
| `test/env-profiles.mjs` | PASS (10/10) | PASS (10/10) | |
| `test/formats.mjs` | PASS (7/7) | PASS (7/7) | |
| `test/mail.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/material-billing.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/media.mjs` | PASS (4/4) | PASS (4/4) | |
| `test/ownership.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/plate-model.mjs` | PASS (1/1) | PASS (1/1) | Unchanged |
| `test/plate-store.mjs` | PASS (1/1) | PASS (1/1) | Unchanged |
| `test/plate-digest.mjs` | *(new)* | PASS (1/1) | Added in phase 2a |
| `test/plate-live.mjs` | *(new)* | PASS (1/1) | Added in phase 2a |
| `test/plate-rollback.mjs` | *(new)* | PASS (1/1) | Added in phase 2a |
| `test/plate-revisions.mjs` | *(new)* | PASS (1/1) | Added in phase 2a |
| `test/plate-live-routes.mjs` | *(new)* | PASS (1/1) | Added in phase 2a |
| `test/preview-meter.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/pricing-lock.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/pro.mjs` | PASS (7/7) | PASS (7/7) | |
| `test/queue-notify.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/render-prep.mjs` | FAIL (0/1) | FAIL (0/1) | Pre-existing (`at least one beat` vs `/at least three beats/`) |
| `test/render-quote.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/render-ready-email.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/revision-meter.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/rough-seeds.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/scene-rendering.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/script-rules.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/styles.mjs` | FAIL (0/1) | FAIL (0/1) | Pre-existing (`ENOENT: .../engine-hairline/index.html`) |
| `test/sweep-cadence.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/tokens.mjs` | PASS (1/1) | PASS (1/1) | |
| `test/visuals-db.mjs` | PASS (5/5) | PASS (5/5) | |
| `test/visuals.mjs` | FAIL (0/1) | FAIL (0/1) | Pre-existing (`illus-wren` style error) |
| `test/worker-launcher.mjs` | PASS (1/1) | PASS (1/1) | |

- **Baseline Summary:** 26 test files passed, 5 test files failed (all pre-existing, unrelated to plates).
- **After Summary:** 31 test files passed (all 26 baseline passing files + all 5 new phase 2a test files), 5 test files failed (same pre-existing 5). `npm run typecheck` passed with 0 errors.

---

## 3. Decisions Made Where the Brief Was Silent

1. **Worker `claimVariant` compatibility for `/clip-request` (`state = 'bundled'`, `stage = 'queued for rendering'`):**
   - `worker/src/plates.mjs` (`claimVariant`) only claims variants where `v.state = 'bundled' or (v.state = 'rendering' and v.updated_at < now() - make_interval(secs => 90))`, and `backend/src/plates/service.ts` maps `state = 'bundled'` (when queued for rendering) to `shown(v) === 'rendering'`.
   - Therefore, when `/clip-request` accepts a `bundled` or `checked` variant, it sets the database row to `state = 'bundled', stage = 'queued for rendering', enqueued_at = now()`, enqueues `plate-render`, and returns HTTP 202 `{ state: "rendering" }`. This allows the worker to claim the job immediately without waiting 90 seconds for a stale `rendering` lease timeout.
2. **Idempotency vs fencing order on `POST .../check`:**
   - When a valid check report moves a variant from `bundled` to `checked` (or `queued` for `kind: "code"`), a retry of the exact same `(variant_id, gen, bundle_digest, host)` arrives when the variant is no longer in `bundled`.
   - Inside the row-locked transaction, `submitCheckReport` checks `row.gen === input.gen` first, then checks `app.plate_check_reports` for an existing `(variant_id, gen, bundle_digest, host)` record and returns its stored response (`200`) before checking `row.state === 'bundled'`. Reports for a different `gen`, different `bundle_digest`, or a different report arriving after the state left `bundled` still get dropped with HTTP 204.
3. **Response body for `results.ok === false, results.kind === "code"` on `POST .../check`:**
   - The brief specified `200 { state: "checked" }` for `ok: true` and `200 { state: "bundled", fallback: true }` for `kind: "env"`, and stated that `kind: "code"` triggers the bounded repair path. We return `200 { state: "queued", repair: true }` when queued for repair and `200 { state: "failed", repair: false }` when `authored >= maxAuthorCalls`.
4. **Error payload shape on 400 / 409 / 429 routes:**
   - To satisfy both the existing route style (`{ error: { code, message } }`) and callers checking top-level `{ code }` (e.g. `409 { code: "not_live" }`, `429 { code: "clip_cap" }`), error responses include both top-level `code` and nested `error: { code, message }`.
5. **Cascade delete on `app.plate_revisions` and `app.plate_check_reports`:**
   - Added `references app.plate_variants(id) on delete cascade` on `variant_id` in both new tables so that shrinking a storyboard (`reconcileVariants`) or cleaning up variants in tests leaves no orphan revision or check-report rows.
6. **Presigning in local `filesystem` storage mode:**
   - `presignKey` in `backend/src/storage.ts` throws when `STORAGE_DRIVER=filesystem`. `registerPlateRoutes` accepts an optional `{ presign }` dependency injection for tests and falls back to a deterministic local path URL when `config.storageDriver !== "r2"`, while calling `presignKey("uploads", ...)` in R2 mode.

---

## 4. Deviations from the Brief

1. **Bucket class for `GET .../bundle` presigned URL (`"uploads"` instead of `"outputs"`):**
   - Section 5 of the brief wrote: ``use `presignKey("outputs", key, { seconds: 900, contentType: "text/html" })` or whatever bucket class the existing bundle uploads use; check `author.ts` ``.
   - Checking `backend/src/plates/author.ts` (line 118: `putObject("uploads", `${prefix}bundle.html`, bundle.html, "text/html")`) confirmed that bundles are uploaded to the `"uploads"` bucket, so `GET .../bundle` calls `presignKey("uploads", row.bundle_key, { seconds: 900, contentType: "text/html" })`.
2. **Bounded repair helper location (`backend/src/plates/store.ts`):**
   - Section 5 noted: *"look at how the worker's failure is handled in the store and reuse that function; do not invent a second repair loop"*.
   - In the codebase, `sendBackForRepair` lived in `worker/src/plates.mjs` (lines 81–104), not yet in `backend/src/plates/store.ts`, and `worker/` is off-limits in Phase 2a. We ported the exact same `sendBackForRepair` transaction into `backend/src/plates/store.ts` (updating the same `repair`, `repairs`, `stage = 'repairing'`, `state = 'queued'` columns and enqueuing `plate-author`, which `author.ts` consumes identically).
3. **`backend/src/jobs/queues.ts` untouched:**
   - No new queue options were needed in `queues.ts`; `boss.send` in `pg-boss` v12 already accepts `singletonKey` in `JobOptions` and transactional deduplication is enforced under the `for update` variant lock.

---

## 5. Open Questions and Risks Noticed

1. **Companion export (`backend/src/plates/exports.ts`) in `live` mode:**
   - `buildExport` in `exports.ts` (line 55) still checks `ordered.some((v) => v!.state !== "drawn" || !v!.clip_key)` when `options.pending` is not set. Until Phase 5 (when final render / export draws missing clips on demand from the frozen manifest), companion exports on a `live` project will report `NotDrawn ("drawing")` unless clips were generated via `/clip-request`.
2. **Unbounded growth of `app.plate_revisions` before Phase 4 pruning:**
   - `sweepGarbage` now skips any prefix referenced by `app.plate_revisions`. `LIVE_SCENES_PLAN.md` §8 specifies keeping the last 20 revisions per scene; until revision pruning is added in Phase 4, all revisions of a live variant remain protected from garbage collection until the variant/project is deleted.
3. **Rollback override with >20 variants:**
   - When `PLATE_LIVE_FORCE_OFF=1` is set, `reconcilePlates()` flips `live_mode` to `'clip'` and enqueues up to 20 `checked`/`bundled` variants per pass (every 30–120s). Projects with more than 20 unrendered variants drain across consecutive reconciler passes.

---

## 6. Exact Request and Response Shapes of the Three New Routes

### 1. `GET /v1/projects/:id/plates/:variantId/bundle`
- **Path Parameters:**
  - `id`: UUID string (project ID)
  - `variantId`: UUID string (variant ID belonging to `id`)
- **Response Headers:** `Cache-Control: no-store`
- **Success Response (`200 OK`):** (when variant state is `bundled`, `checked`, `rendering`, or `drawn` and `bundle_key` is present)
  ```json
  {
    "url": "https://...",
    "expiresAt": "2026-11-04T12:15:00.000Z",
    "bundleDigest": "<64-char sha256 hex>",
    "manifest": {
      "schema": 1,
      "kind": "anidoodle",
      "engineVersion": "0.1.0",
      "engineDigest": "<24-char hex>",
      "styleDigest": "<16-char hex>",
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "frames": 90,
      "aspect": "16:9",
      "sourceSha": "<24-char hex>",
      "bundleSha": "<24-char hex>",
      "imports": []
    },
    "params": {}
  }
  ```
- **Error Responses:**
  - `404 Not Found`: `{ "error": { "code": "not_found", "message": "Not found." } }` (invalid UUID, unknown variant, variant belongs to another project, or variant state is `queued` / `authoring` / `failed`).

### 2. `POST /v1/projects/:id/plates/:variantId/check`
- **Path Parameters:**
  - `id`: UUID string (project ID)
  - `variantId`: UUID string (variant ID belonging to `id`)
- **Request Body:**
  ```json
  {
    "gen": 1,
    "bundleDigest": "<sha256 hex>",
    "host": "worker",
    "device": { "ua": "..." },
    "results": {
      "ok": true,
      "kind": "code | env",
      "error": "optional error detail"
    }
  }
  ```
  *(Validation: `gen` positive integer; `bundleDigest` non-empty string <= 128 chars; `host === "worker"`; `device` optional plain object <= 16 KB serialised; `results` plain object <= 16 KB serialised with boolean `ok`, and if `ok === false`, `kind` in `["code", "env"]`.)*
- **Responses:**
  - `200 OK` (passing check):
    ```json
    { "state": "checked" }
    ```
  - `200 OK` (code failure triggering bounded repair):
    ```json
    { "state": "queued", "repair": true }
    ```
    *(or `{ "state": "failed", "repair": false }` if `authored >= PLATE_MAX_AUTHOR_CALLS`)*
  - `200 OK` (environment failure, no state change):
    ```json
    { "state": "bundled", "fallback": true }
    ```
  - `204 No Content` (empty body): Report fenced out (`gen` mismatch, `bundle_digest` mismatch, or variant not in `bundled` state and no prior matching report).
  - `400 Bad Request`:
    ```json
    {
      "code": "invalid_check",
      "error": { "code": "invalid_check", "message": "..." }
    }
    ```
  - `404 Not Found`:
    ```json
    { "error": { "code": "not_found", "message": "Not found." } }
    ```
  - `409 Conflict` (project is in `clip` mode):
    ```json
    {
      "code": "not_live",
      "error": { "code": "not_live", "message": "This project is not in live preview mode." }
    }
    ```

### 3. `POST /v1/projects/:id/plates/:variantId/clip-request`
- **Path Parameters:**
  - `id`: UUID string (project ID)
  - `variantId`: UUID string (variant ID belonging to `id`)
- **Request Body:** None required.
- **Responses:**
  - `202 Accepted` (enqueued `plate-render`, or idempotent repeat for an already queued/rendering variant):
    ```json
    { "state": "rendering" }
    ```
  - `404 Not Found`:
    ```json
    { "error": { "code": "not_found", "message": "Not found." } }
    ```
  - `409 Conflict` (variant is not in `bundled`, `checked`, or `rendering` state):
    ```json
    {
      "code": "invalid_state",
      "error": { "code": "invalid_state", "message": "Scene is not in bundled or checked state." }
    }
    ```
  - `429 Too Many Requests` (project already has `PLATE_PROJECT_CLIP_CAP` [default 4] clips queued or rendering):
    ```json
    {
      "code": "clip_cap",
      "error": { "code": "clip_cap", "message": "Too many preview clips are already queued or rendering for this project." }
    }
    ```
