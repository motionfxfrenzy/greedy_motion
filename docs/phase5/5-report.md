# Phase 5 Report — Frozen Export Manifest, Worker-Side Drawing & Clip Cache, and Verified Billing

## 1. Files Created and Changed

### Created
- `backend/src/db/migrations/021_plate_clips.sql` — Idempotent migration creating `app.plate_clips` keyed by `(bundle_digest, engine_digest, font_set_digest, size)`, adding `app.render_jobs.idempotency_key` with partial unique index `(project_id, idempotency_key)`, and adding a deprecation comment on `app.plate_state.draw_aspects`.
- `backend/test/plate-export-manifest.mjs` — Hermetic backend integration test against real Postgres and an in-process S3 server covering Schema 2 manifest freezing, content-addressed immutability, `waitForAuthoring` progress and scene-named failure, `clip.lookup` / `clip.record` attempt fencing and idempotency, `plate.drawn` clip caching, and `plate.sendBackForRepair` repair revisions.
- `backend/test/plate-render-billing.mjs` — Hermetic backend integration test covering `POST /v1/projects/:id/render` token spending, `Idempotency-Key` header deduplication (concurrent and sequential), refunds on `scene_needs_fix`, `author_exhausted`, `videoDead` retries exhausted, and `render_invalid`, non-refund on user cancellation, settlement on success, and zero-cost companion exports.
- `worker/test/plates-phase5.mjs` — Plain Node worker test suite covering trailing-NUL `bundleSha` and `verifyBundleDigest` tamper rejection before drawing, `verify-all-then-draw` ordering, non-retriable `SceneNeedsFixError` (`code: "scene_needs_fix"`) + `plate.sendBackForRepair`, `isSoftwareRenderer` / `checkSoftwareRenderer` decision table (`GpuPathDetectedError`), `clip.lookup` cache hit/miss and fenced `clip.record`, and Schema 1 compatibility.
- `docs/phase5/5-report.md` — This Phase 5 implementation and verification report.

### Changed
- `backend/src/plates/exports.ts` — Upgraded `buildExport` to freeze Schema 2 manifests under content-addressed keys (`plates/<projectId>/manifests/<sha256(canonicalJson)>/manifest.json`) with per-scene revision/bundle/params digests and audio SHA-256 digests, added `waitForAuthoring`, and removed `requestDraws` from `requestExport`.
- `backend/src/plates/store.ts` — Stopped reading `draw_aspects` in `reconcileVariants`, `commitBundle`, and `readProjectState`; stored repair params consistently in `app.plate_revisions`; made `requestDraws` a deprecated no-op; added `getCachedClip` lookup on `app.plate_clips`.
- `backend/src/plates/reconcile.ts` — Stopped reading `draw_aspects` in `reconcilePlates()` and updated `sweepGarbage()` to also protect prefixes referenced by `app.plate_clips`.
- `backend/src/plates/routes.ts` — Updated `GET /v1/projects/:id/plates/:index/clip` and `/still` to fall back to `app.plate_clips` by `(bundle_digest, width, height)` when `row.clip_key` / `row.still_key` is null.
- `backend/src/jobs/control.ts` — Added `clip.lookup` and attempt-fenced idempotent `clip.record`, updated `plate.drawn` to populate `app.plate_clips`, extended `plate.sendBackForRepair` for manifest-verification failures (bumping `rev`), updated `render.finish` to immediately refund `prep.spendEvent` on non-cancelled failure, removed `draw_aspects` from `demand.idle`, and deduplicated reconnecting worker polls by `workerId`.
- `backend/src/render/quote.ts` — Added `preHandler` / `onSend` / `onResponse` / `onError` hooks in `registerRenderQuote(app)` to support optional `Idempotency-Key` headers on `POST /v1/projects/:id/render`.
- `backend/src/render/repository.ts` — Added `findByIdempotencyKey` and persisted `idempotency_key` on `app.render_jobs` in `createAndEnqueue` with conflict-safe duplicate-spend refund.
- `backend/src/render/service.ts` — Updated the plate branch of `prepareFilm` to wait for in-flight authoring (`waitForAuthoring`) and freeze the Schema 2 manifest without calling `requestDraws`, and updated `failForGood` and `syncProject` to refund `prep.spendEvent` on every non-cancelled failure (including after `render_queued_at` is set).
- `backend/test/plate-live-render.mjs` — Updated to verify Migration `020` and `021` idempotency, `draw_aspects` deprecation comment, `draw_aspects` ignored by `commitBundle` / `reconcilePlates` / `demand.idle`, and unchanged `/clip-request` and `PLATE_LIVE_FORCE_OFF` rollback behaviour.
- `worker/src/plates.mjs` — Implemented Schema 2 manifest verification and drawing (`prepareManifestClips`: download and verify all bundles before drawing any frame, `SceneNeedsFixError` + `plate.sendBackForRepair`, Software-GL self-check `checkSoftwareRenderer` / `GpuPathDetectedError`, `clip.lookup` / `clip.record` digest cache, audio digest verification in `assemble`, and Schema 1 backward compatibility).
- `worker/src/worker.mjs` — Preserved typed `error.code` (such as `scene_needs_fix` and `gpu_path_detected`) on `PermanentError` and `noteRetry` in `handle(job)`.
- `worker/package.json` — Added `"test:plates-phase5": "node test/plates-phase5.mjs"` test script.
- `tools/phase2/e2e/live-e2e.mjs` — Updated Scenarios H, J, and K for zero `plate-render` jobs and added Scenarios L, M, N, O, P, Q, R, S, and T (146 assertions total).
- `tools/phase2/job-control/chaos.mjs` — Updated Scenario 1 (`app.plate_clips` verification on mid-render worker kill) and Scenario 5 (`clip`-mode seeding for 6-worker `plate-render` fan-out).
- `docs/LIVE_SCENES_PLAN.md` — Appended short `"Resolved in phase 5"` notes to the four resolved items in Section 21.
- `docs/JOB_CONTROL.md` — Documented `clip.lookup`, `clip.record`, and the updated `plate.drawn` and `plate.sendBackForRepair` operations.

---

## 2. Exact Commands Run

```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes

# 1. Baseline checks before changes
docker ps
cd frontend && npm run typecheck && node --test --test-concurrency=1 "test/*.mjs"
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done
cd ../worker && npm run test:motion-blur
cd ..
docker compose --profile plates-e2e run --rm --no-deps -v "$PWD/worker/test:/app/test:ro" --entrypoint node plate-worker test/plates-assemble.mjs
docker compose --profile plates-e2e run --rm --no-deps -v "$PWD/worker/test:/app/test:ro" --entrypoint node plate-worker test/plates-legacy-parity.mjs

# 2. Backend and worker unit/integration tests for Phase 5
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend
npm run typecheck
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/job-control.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-live-render.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-export-manifest.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-render-billing.mjs

cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/worker
npm run test:plates-phase5

# 3. Build and start the local plates-e2e compose stack (PLATE_LIVE_PREVIEW=on)
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker

# 4. Run worker container tests inside plate-worker image
docker compose --profile plates-e2e run --rm --no-deps -v "$PWD/worker/test:/app/test:ro" --entrypoint node plate-worker test/plates-assemble.mjs
docker compose --profile plates-e2e run --rm --no-deps -v "$PWD/worker/test:/app/test:ro" --entrypoint node plate-worker test/plates-legacy-parity.mjs
docker compose --profile plates-e2e run --rm --no-deps -v "$PWD/worker/test:/app/test:ro" --entrypoint node plate-worker test/plates-phase5.mjs

# 5. Run live E2E acceptance suite (Scenarios A through T)
node tools/phase2/e2e/live-e2e.mjs

# 6. Run job-control chaos suite (Scenarios 1 through 6, including HyperFrames render path)
node tools/phase2/job-control/chaos.mjs

# 7. Run clip-mode acceptance suite (PLATE_LIVE_PREVIEW=off)
docker compose -f compose.yaml --profile plates-e2e up -d plate-api plate-worker
until curl -sf http://localhost:4100/readyz >/dev/null; do sleep 0.5; done
node scripts/plates-e2e/run.mjs happy cache
node scripts/plates-e2e/run.mjs failures durability

# 8. Targeted teardown of plates-e2e services only (preserving videosaas-local-postgres-1 and videosaas-local-worker-1)
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore
docker ps

# 9. Post-change full frontend, backend, and worker test suites & typechecks
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/frontend && npm run typecheck && node --test --test-concurrency=1 "test/*.mjs"
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend && npm run typecheck
for f in test/*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/worker && npm run test:motion-blur && npm run test:plates-phase5
```

---

## 3. Manifest Schema 2, Content-Addressed Key Scheme, New Table, and Control Operations

### 3.1 Frozen Export Manifest (Schema 2)
```ts
export type FrozenSceneEntry = {
  index: number;
  variantId: string;
  gen: number;
  rev: number;
  sig: string;
  bundleDigest: string;
  bundleKey: string;
  bundleSha: string;
  paramsDigest: string;
  params: Record<string, unknown>;
  frames: number;
  bundleFrames: number;
  startFrame: number;
  clipKey: string | null;
  voice: { key: string; digest: string; seconds: number } | null;
};

export type ExportManifest = {
  schema: 2;
  assembler: number;
  projectId: string;
  aspect: "16:9" | "9:16" | "1:1";
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  watermark: boolean;
  engineDigest: string;
  fontSetDigest: string;
  signature: string;
  timing: { frames: number[]; starts: number[]; totalFrames: number };
  scenes: FrozenSceneEntry[];
  music: { key: string; digest: string } | null;
  voiceOn: boolean;
  subtitles: PlateSubtitles;
  cues: { scene: number; start: number; end: number; text: string }[];
  sfx: { scene: number; name: PlateSfxCue["name"]; offset: number; volume: number; mediaStart?: number }[];
};
```
- **Content-addressed key scheme:**
  - The manifest is serialised with `canonicalJson(manifest)` (lexicographically sorted keys at every nesting level).
  - `manifestDigest = sha256(canonicalJson(manifest))` (64-char hex).
  - Stored in the `uploads` bucket under `plates/${projectId}/manifests/${manifestDigest}/manifest.json`.
  - Before writing, `buildExport` checks `objectSize("uploads", manifestKey) === Buffer.byteLength(canonical, "utf8")`; an existing manifest object is never overwritten or mutated.
  - On the worker, `loadManifest` verifies that `sha256(canonicalJson(manifest))` equals the `<manifestDigest>` path segment in `manifestKey`.
  - Legacy `schema: 1` manifests remain accepted by `loadManifest`, `renderPlateFilmJob`, and `handlePlateExport` so any in-flight Schema 1 job drains cleanly.

### 3.2 New Database Table (`backend/src/db/migrations/021_plate_clips.sql`)
- **`app.plate_clips`**:
  - Primary key: `(bundle_digest, engine_digest, font_set_digest, size)` where `size` is `"${width}x${height}"` (e.g. `"1920x1080"`).
  - Columns: `bundle_digest text`, `engine_digest text`, `font_set_digest text`, `size text`, `width integer`, `height integer`, `fps integer`, `frames integer`, `clip_key text`, `still_key text`, `clip_meta jsonb`, `created_at timestamptz`, `updated_at timestamptz`.
  - Content-addressed object keys in `outputs`: `plates/${projectId}/clips/${bundleDigest.slice(0, 32)}-${engineDigest.slice(0, 12)}-${fontSetDigest.slice(0, 12)}-${width}x${height}.mp4` (and `.png` for `still_key`).
- **`app.render_jobs.idempotency_key`**:
  - `alter table app.render_jobs add column if not exists idempotency_key text;`
  - Partial unique index `render_jobs_project_idempotency_idx` on `(project_id, idempotency_key) where idempotency_key is not null and project_id is not null`.
- **`app.plate_state.draw_aspects`**:
  - Left in schema without dropping data; annotated with SQL `COMMENT` marking it deprecated and unused in Phase 5.

### 3.3 New and Updated Job-Control Operations (`backend/src/jobs/control.ts`)
- **`clip.lookup`**:
  - Accepts `{ keys: [{ bundleDigest, engineDigest, fontSetDigest, size, width, height }, ...] }` (batch) or single key fields.
  - Returns `{ clips: Row[] }` (plus `{ clip: Row | null }` for single-key calls).
- **`clip.record`**:
  - Fenced by the active job attempt:
    - `render-video` job: `exists (select 1 from app.render_jobs where id = $jobId and attempt = $attempt and state = 'rendering')`
    - `plate-export` job: `exists (select 1 from app.plate_exports where id = $exportId and attempt = $attempt and state = 'assembling')`
    - `plate-render` job: `exists (select 1 from app.plate_variants where id = $variantId and gen = $gen and render_attempt = $renderAttempt and state in ('rendering', 'drawn'))`
  - If the fence check fails, returns `{ ok: false, fenced: true }` without writing to `app.plate_clips` (and the worker deletes its newly uploaded clip/still objects).
  - Inserts into `app.plate_clips ... on conflict (bundle_digest, engine_digest, font_set_digest, size) do nothing returning *`; idempotent on repeat or concurrent cache population (`{ ok: true, duplicate: true, clip }`).
- **`plate.drawn`**:
  - In the same transaction that marks a preview/fallback clip `drawn` on `app.plate_variants`, inserts the clip into `app.plate_clips` so subsequent final renders and companion exports reuse preview-drawn clips without redrawing.
- **`plate.sendBackForRepair`**:
  - Supports both `plate-render` callers (`renderAttempt != null`, fenced on `state = 'rendering'`) and manifest-verification failures in `renderPlateFilmJob` / `handlePlateExport` (`renderAttempt == null`, fenced on `(id, gen)`, incrementing `rev = rev + 1` and `repairs = repairs + 1`, resetting `state = 'queued', stage = 'repairing'`, and enqueueing `plate-author`).

---

## 4. Test Suite Results and Measured Times

### 4.1 Frontend, Backend, and Worker Unit/Integration Suites (Before vs After)

| Suite | Before Phase 5 | After Phase 5 | Notes |
| --- | --- | --- | --- |
| `frontend` `npm run typecheck` | PASS (`0` errors) | PASS (`0` errors) | Untouched (`frontend/` not modified) |
| `frontend` test suite (`test/*.mjs`) | PASS (`169 / 169` tests in `45.7 s`) | PASS (`169 / 169` tests in `45.7 s`) | All 25 test files pass |
| `backend` `npm run typecheck` | PASS (`0` errors) | PASS (`0` errors) | `tsc --noEmit -p .` |
| `backend` passing `test/*.mjs` files | `34 / 39` PASS | **`36 / 41` PASS** | Added `plate-export-manifest.mjs` (`1.4 s`) & `plate-render-billing.mjs` (`1.6 s`); all 10 `plate-*` tests + `job-control` pass |
| `backend` pre-existing failing `test/*.mjs` files | `5 / 39` FAIL (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`) | **`5 / 41` FAIL** (identical 5 files) | See note on `billing.mjs` below |
| `worker` `test/motion-blur.mjs` | PASS (`0.3 s`) | PASS (`0.3 s`) | |
| `worker` `test/plates-assemble.mjs` | PASS (`16.8 s` in container) | PASS (`17.1 s` in container) | |
| `worker` `test/plates-legacy-parity.mjs` | PASS (`12.1 s` in container) | PASS (`11.8 s` in container) | |
| `worker` `test/plates-phase5.mjs` | *(new)* | **PASS** (`0.4 s` host & container) | Bundle digest tamper, verify-all-then-draw, `scene_needs_fix`, GPU self-check, cache hit/miss, Schema 1 |

*Why `backend/test/billing.mjs` fails today (pre-existing, unrelated to Phase 5 render billing):*
`backend/test/billing.mjs` line 74 asserts `assert.equal((await entitlementsFor(U, { fresh: true })).features.proEditor, "none")` for a free user before any subscription webhook is applied. However, `billing.mjs` does not set `AUTH_MODE=supabase` before importing `../src/entitlements/resolve.ts`. In local dev (`APP_ENV=local`), `config.auth.mode` defaults to `"none"`, which sets `local: true` in `resolve.ts` (line 46) and causes `entitlementsFor()` to return `localEntitlements()` where `features.proEditor` is `"edit"` for all users.

### 4.2 Live End-to-End Suite (`tools/phase2/e2e/live-e2e.mjs`, Scenarios A to T)

All **20 scenarios (A–T)** and **146 / 146 explicit assertions** passed.

| Scenario | Description | Status | Measured Time | Key Details |
| --- | --- | --- | --- | --- |
| **A** | Happy path, live (`illus-fox`, `16:9`, 3 beats) | **PASS** | `0.31 s` bundled, `6.08 s` checked | `22.2 fps` (`45.1 ms/frame`), `0` diff px vs page host, `0` `plate-render` jobs |
| **B** | Clip fallback (`/clip-request`) & per-project clip cap (`4`) | **PASS** | `62.3 s` | Single fallback clip drawn (`165` frames); 5th request refused with `429 clip_cap` |
| **C** | Fencing over HTTP (`POST .../check`) | **PASS** | `0.4 s` | Stale `gen` / wrong `bundleDigest` / `drawn` → `204`; duplicate → `200`; `clip` mode → `409` |
| **D** | Comment and revision (`POST .../comments`, `POST .../fix`) | **PASS** | `2.4 s` | `gen` `1 → 2`, `rev` `0 → 1`; `sweepGarbage` kept `g1/` (`plate_revisions`) and deleted `g99/` |
| **E** | Tamper (`bundle.html` modified in S3Mock) | **PASS** | `0.5 s` | Browser `fetchBundle` rejected modified HTML with SHA-256 mismatch; `0` iframes/Workers |
| **F** | Rollback (`PLATE_LIVE_FORCE_OFF=1`) | **PASS** | `72.8 s` | `live_mode` flipped `'live' → 'clip'`; 2 remaining `checked` scenes drawn by `plate-render` |
| **G** | Flag semantics (`PLATE_LIVE_PREVIEW` on → off) | **PASS** | `32.2 s` | Sticky `live_mode='live'` preserved; new project with flag `off` got `clip` mode and auto-drew |
| **H** | Final render & export manifest freezing *(updated for Phase 5)* | **PASS** | `3.1 s` | Both `POST .../plates/export` and `POST .../render` wrote Schema 2 manifests with **`0`** `plate-render` jobs and `draw_aspects = []` |
| **I** | Unsupported environment (Safari macOS UA override) | **PASS** | `0.6 s` | Selected `mode: "clip"` (`reason: "unverified-environment"`), `0` iframes, `0` Workers |
| **J** | Final render of browser-checked live project *(updated for Phase 5)* | **PASS** | **`135.4 s`** | 3 scenes verified & drawn inside `renderPlateFilmJob`; **`0`** `plate-render` jobs; `1920×1080` MP4, `480 / 480` frames with audio |
| **K** | Final render while authoring in progress + `9:16` export *(updated for Phase 5)* | **PASS** | **`81.7 s`** (`16:9`), **`85.7 s`** (`9:16`) | Waited for authoring, froze Schema 2 manifests, **`0`** `plate-render` jobs (`jobs169 = 0, jobs916 = 0`), `0` rows ever `checked` |
| **L** | *(New)* Final render of never-previewed project | **PASS** | **`71.1 s`** | **`0`** `plate-render` jobs; all `2` clips recorded in `app.plate_clips` with SwiftShader renderer and content-addressed keys |
| **M** | *(New)* Same film rendered twice draws once | **PASS** | **`71.1 s` → `23.2 s`** | Second render reused `2 / 2` clips from `app.plate_clips` (`0` cache misses); render time dropped **`67.3%`** (`71.1 s → 23.2 s`) |
| **N** | *(New)* Scene edited & re-authored during render; second render uses new revision | **PASS** | **`90.7 s`** (Render 1), **`63.8 s`** (Render 2) | Render 1 MP4 matched frozen `rev = 0` clip at `t = 0.3s, 1.2s, 2.1s` (`meanAbsDiff = 0.62`); `rev = 1` checked in browser; Render 2 froze new manifest, reused Scene 1 from cache, and rendered `rev = 1` (`66.9%` pixels changed in top band) |
| **O** | *(New)* Storyboard text changed during render | **PASS** | **`66.2 s`** | Mid-render beat edit + `POST /plates/draw` bumped `gen = 2`; in-flight render completed to `ready` with no `"scenes were changed"` error |
| **P** | *(New)* `nondeterministic` stub scene fails before drawing, refunds user, returns repair revision | **PASS** | **`23.4 s`** | Failed at `attempt = 1` with `code: "scene_needs_fix"` naming `Scene 2`; **`0`** clips drawn (`app.plate_clips` = `0`); **`14,100 / 14,100`** millitokens refunded; Scene 2 returned as repair revision (`rev = 1, repairs = 1`) |
| **Q** | *(New)* Kill worker mid-draw (`docker kill`), retry completes as `attempt = 2` reusing drawn scenes | **PASS** | **`250.7 s`** (incl. lease expiry) | Killed after `1 / 3` clips cached in `app.plate_clips`; `attempt = 2` reused cached clip (`cacheHits = 1, cacheMisses = 2`, timestamp unchanged) and finished `renders/<id>/a2.mp4` |
| **R** | *(New)* Two different projects rendering at once with 4 workers (`--scale plate-worker=4`) | **PASS** | **`157.9 s`** | Both projects completed at `attempt = 1` across scaled workers with **`0`** `plate-render` jobs |
| **S** | *(New)* Repeated click with same `Idempotency-Key` | **PASS** | `0.2 s` | 3 clicks (2 concurrent + 1 sequential) returned identical `jobId`, `1` `app.render_jobs` row, and `1` token spend event |
| **T** | *(New)* Companion export of `9:16` goes through manifest and cache | **PASS** | **`101.4 s` → `24.7 s`** | First `9:16` export drew and cached `2` `1080×1920` clips (`0` `plate-render` jobs, `0` tokens); second `9:16` export with updated subtitle style reused cached clips (`101.4 s → 24.7 s`, **`75.7%` faster**) |

### 4.3 Chaos Suite (`tools/phase2/job-control/chaos.mjs`) and Clip-Mode Suite (`scripts/plates-e2e/run.mjs`)

- **`tools/phase2/job-control/chaos.mjs`:** **PASS (`28 / 28` assertions across 6 scenarios)**
  1. Kill worker mid-render: recovered at `attempt = 2` (`116.6 s`), clip recorded in `app.plate_clips`, `1` `render-finished` message, `1` spend event.
  2. Cut control link (`20.18 s` pause): lease kept, completed at `render_attempt = 1` (`35.0 s`).
  3. Restart API during long poll (`4.91 s` restart, `0.80 s` reconnect) and during `render.finish` (`0.50 s` retry, `{ committed: true, duplicate: true }`).
  4. Duplicate completion and stale attempt fencing (`50 ms`).
  5. 6 waiting workers drawing 10 scenes across 2 projects (`433.9 s`, `render_attempt = 1` on all 10, **`0`** worker Postgres connections across 189 samples, API DB connections `≤ 13`).
  6. **HyperFrames render path (`Scenario 6`):** **PASS (`53.1 s`)** — non-plate `look: "clean"` project rendered to a valid `1920×1080` MP4 (`370 / 370` frames) with `0` worker DB connections.
- **`scripts/plates-e2e/run.mjs` (Clip-mode E2E):** **PASS (all 4 suites)**
  - `happy`: **PASS** (`357.0 s` for 9 variants across 3 ratios + `36.7 s` / `52.1 s` / `36.3 s` exports).
  - `cache`: **PASS** (`229.0 s`, 1-scene edit redrawn in `51.3 s`).
  - `failures`: **PASS** (`136.0 s`, `bad-import`, `nondeterministic`, and `http500`×3 outage).
  - `durability`: **PASS** (`485.0 s`, API restart during authoring, worker kill mid-render, 4× duplicate delivery, mid-render edit superseding stale worker, container recreate).

---

## 5. Billing Table as Implemented and Tested

| Event / Scenario | `Idempotency-Key` | `app.render_jobs` Rows | Spend Events (`kind='spend'`) | Refund Events (`kind='refund'`) | Net Tokens Charged | Tested In |
| --- | --- | --- | --- | --- | --- | --- |
| Readiness check fails before queuing (`409 not_ready`) | Optional | `0` | `0` | `0` | **`0`** | `plate-render-billing.mjs` §1 |
| Insufficient tokens (`402 insufficient_tokens`) | Optional | `0` | `0` | `0` | **`0`** | `tokens.mjs` / `server.ts` |
| Single accepted click (`POST /v1/projects/:id/render`) | None or unique | `1` | `1` | `0` (while in flight) | **`1 × cost`** | `plate-render-billing.mjs` §2–3 |
| Repeated clicks (concurrent or sequential) with same `Idempotency-Key` | Same key per click | **`1`** (returns same `job.id`) | **`1`** | `0` | **`1 × cost`** | `plate-render-billing.mjs` §2, `live-e2e.mjs` Scenario S |
| Repeated clicks without `Idempotency-Key` | Omitted | `1` per click | `1` per click | `0` | **`1 × cost` per click** | `plate-render-billing.mjs` §2, `live-e2e.mjs` Scenario M |
| Authoring fails / exhausts repair budget before drawing (`prepareFilm`) | Optional | `1` (`state='failed'`) | `1` | **`1`** (idempotent) | **`0`** | `plate-render-billing.mjs` §4b |
| Scene fails verification at worker before drawing (`scene_needs_fix`) | Optional | `1` (`state='failed'`) | `1` | **`1`** (idempotent) | **`0`** | `plate-render-billing.mjs` §4a, `live-e2e.mjs` Scenario P |
| Worker retries exhausted (`videoDead` -> `failForGood`, `render_queued_at != null`) | Optional | `1` (`state='failed'`) | `1` | **`1`** (idempotent) | **`0`** | `plate-render-billing.mjs` §4c |
| Worker permanent error (`render_invalid` via `render.finish`) | Optional | `1` (`state='failed'`) | `1` | **`1`** (idempotent) | **`0`** | `plate-render-billing.mjs` §4d |
| User cancellation (`code='cancelled'`) | Optional | `1` (`state='failed'`) | `1` | **`0`** | **`1 × cost`** | `plate-render-billing.mjs` §4e |
| Render succeeds (`state='ready'`) | Optional | `1` (`state='ready'`) | `1` | **`0`** | **`1 × cost` (settled)** | `plate-render-billing.mjs` §3, `chaos.mjs` Scenario 1 |
| Companion export (`POST /v1/projects/:id/plates/export`) | N/A | `0` (`app.plate_exports` row) | **`0`** | **`0`** | **`0` (free)** | `plate-render-billing.mjs` §5, `live-e2e.mjs` Scenario T |

*Client Idempotency-Key behaviour:* `POST /v1/projects/:id/render` accepts an optional `Idempotency-Key` (or `X-Idempotency-Key`) request header (or `idempotencyKey` body field, up to 128 chars). Requests for the same `(projectId, Idempotency-Key)` return `202` with the existing `RenderJob` before `spendTokens` is called; a partial unique index `render_jobs_project_idempotency_idx` on `app.render_jobs (project_id, idempotency_key)` also guards cross-replica races and refunds any losing replica's spend.

---

## 6. Answers to "What Happens When"

1. **Comment during render:**
   - Clicking `Render` freezes a Schema 2 manifest in object storage under its content-addressed SHA-256 key, pinning each scene's current `variantId`, `gen`, `rev`, `bundleDigest`, `bundleKey`, `paramsDigest`, and `params`.
   - When the user adds a comment and clicks `Apply comments` (`POST /plates/fix`) while the render runs, `reviseScene` bumps `gen` (`1 → 2`) and `rev` (`0 → 1`) on `app.plate_variants`, schedules the old prefix in `app.plate_garbage` (which `sweepGarbage` skips because `rev = 0` is referenced in `app.plate_revisions`), and authors `g2/bundle.html`.
   - The in-flight render reads only its frozen manifest (`g1/bundle.html`, `rev = 0`), caches the `rev = 0` clip in `app.plate_clips`, and produces the exact film the user clicked Render on (proven in Scenario N). Meanwhile, `rev = 1` (`g2`) is checked and playable in the browser preview, and a second `Render` click freezes a new manifest with `rev = 1`.
2. **Storyboard change during render:**
   - Editing the storyboard text and calling `POST /plates/draw` runs `reconcileVariants`, which updates `signature`, increments `gen`, and resets `app.plate_variants` to `queued`.
   - Because `renderPlateFilmJob` no longer calls `resolveClips` or compares `app.plate_variants.signature`, the in-flight render is completely unaffected and completes to `state = 'ready'` from its frozen manifest and retained `g1` bundles (proven in Scenario O).
3. **Worker killed mid-draw (`docker kill` / Spot interruption):**
   - Each scene clip drawn by `attempt = 1` before the kill is uploaded to its content-addressed key in `outputs` and committed to `app.plate_clips` via `clip.record`.
   - When `attempt = 1`'s lease expires in `pg-boss`, a worker claims the job as `attempt = 2`. `prepareManifestClips` verifies the bundles, calls `clip.lookup`, gets cache hits in `app.plate_clips` for every scene already drawn by `attempt = 1`, draws only the remaining uncached scene(s), and finishes `renders/<jobId>/a2.mp4` with a single token charge (proven in Scenario Q and Chaos Scenario 1).
4. **Scene fails verification:**
   - `prepareManifestClips` downloads and verifies **all** scene bundles (`verifyBundleDigest` + in-browser `verifyScene`) in Phase 1 **before** Phase 3 draws any scene.
   - If any scene fails verification, the worker calls `plate.sendBackForRepair` (which increments `rev` and `repairs`, sets `state = 'queued', stage = 'repairing'`, and enqueues `plate-author`) and throws `SceneNeedsFixError` (`code: "scene_needs_fix"`, `permanent: true`, naming the scene).
   - `worker.mjs` calls `render.finish` with `error: { code: "scene_needs_fix", message }`, which marks the render job `failed` without retrying and immediately calls `refundSpend` to return the user's tokens. Zero frames are drawn, the user pays nothing, and the repaired scene returns to Step 3 preview as a repair revision (proven in Scenario P).
5. **GPU path detected:**
   - Before drawing any cache miss, the worker probes Chromium's `UNMASKED_RENDERER_WEBGL` / `RENDERER` string and passes it to `checkSoftwareRenderer(renderer)`.
   - If the renderer is not a software rasteriser (SwiftShader, llvmpipe, softpipe, lavapipe, etc.), it throws `GpuPathDetectedError` (`code: "gpu_path_detected"`, `permanent: false`), refusing to draw a single frame. `worker.mjs` records `stage = 'retrying', error.code = 'gpu_path_detected'` via `render.noteRetry` and fails the lease so `pg-boss` retries the job on another worker; if all retries fail, `videoDead` (`failForGood`) marks the job `failed` and refunds the user's tokens.
6. **Authoring still running at click:**
   - In the planning stage of the render job (`prepareFilm` in `backend/src/render/service.ts`), after `startPlates(project.id)`, the backend calls `waitForAuthoring(project.id, aspect, ...)` which polls until every scene of the aspect has finished authoring (`bundle_key` present, `state` not in `queued`/`authoring`), emitting `directing` progress updates (`25%..40%`) while holding **zero** render-worker slots.
   - Once authoring finishes, `prepareFilm` freezes the Schema 2 manifest and queues `render-video` (proven in Scenario K).
   - If any scene fails authoring or exhausts `PLATE_MAX_AUTHOR_CALLS` while waiting, `waitForAuthoring` throws `NotDrawn` naming the scene, and `prepareFilm` calls `failForGood` which fails the job before `render-video` is ever queued and refunds the user's tokens in full (proven in `plate-render-billing.mjs` §4b).

---

## 7. Before and After Counts of `plate-render` Jobs for a Final Render

| Scenario | Before Phase 5 (`Phase 2c / 3`) | After Phase 5 |
| --- | --- | --- |
| **Scenario H** (2-scene live project, `POST /plates/export` + `POST /render`) | **`2`** `plate-render` jobs (`1` per scene) | **`0`** `plate-render` jobs |
| **Scenario J** (3-scene browser-checked live project, `POST /render`) | **`3`** `plate-render` jobs (`1` per scene) | **`0`** `plate-render` jobs |
| **Scenario K** (2-scene un-previewed project, `POST /render` `16:9` + `POST /plates/export` `9:16`) | **`4`** `plate-render` jobs (`2` for `16:9` + `2` for `9:16`) | **`0`** `plate-render` jobs (`0` for `16:9`, `0` for `9:16`) |
| **Scenario L** (2-scene never-previewed project, direct `POST /render`) | **`2`** `plate-render` jobs | **`0`** `plate-render` jobs |
| **Scenario R** (2 projects × 2 scenes concurrent `POST /render` on 4 workers) | **`4`** `plate-render` jobs | **`0`** `plate-render` jobs |
| **Scenario T** (2-scene `9:16` companion export, twice) | **`2`** `plate-render` jobs | **`0`** `plate-render` jobs |

*(Note: `plate-render` is now used only by `/clip-request` preview fallback on slow/unverified devices, clip-mode projects when `PLATE_LIVE_PREVIEW=off`, and `PLATE_LIVE_FORCE_OFF=1` operator rollback.)*

---

## 8. CPU and Memory Observations for a Worker Drawing Scenes Inside a Render Job

Measured on `videosaas-local-plate-worker-1` (`docker stats --no-stream` sampled every `1.5 s` during Scenario J's 3-scene `1920×1080` `illus-fox` final render, 50 samples):

- **Parallel CPU-bound draws per worker task:**
  - `RENDER_CONCURRENCY = 1` (`1` `render-video` job per worker task at a time).
  - Inside `prepareManifestClips`, cache misses are drawn with bounded concurrency `PLATE_CONCURRENCY = 2` (`2` scenes drawn in parallel per worker task).
  - Each `renderScene` call opens `1` headless Chromium instance with `PLATE_FRAME_WORKERS = 2` pages (`2` pages/scene × `2` concurrent scenes = **`4` Chromium pages + `2` `ffmpeg` `image2pipe` H.264 encoders** running in parallel at peak).
- **Observed CPU and Memory by Stage:**
  - **At rest (idle poll):** `1.8% – 34.5%` CPU, **`84.7 – 304.1 MiB`** RSS/cgroup memory, `12 – 18` PIDs.
  - **Phase 1 — `verifyScene` (1 scene at a time, 2 Chromium pages):** `113.0% – 134.4%` CPU (~1.2 cores), **`572.1 – 651.0 MiB`** memory, `157 – 159` PIDs.
  - **Phase 3 — `renderScene` with 2 scenes drawing in parallel (`PLATE_CONCURRENCY = 2`, 4 Chromium pages + 2 `ffmpeg` encoders):** `382.7% – 588.3%` CPU (~4.8–5.9 cores), **`1.588 – 2.577 GiB`** memory (peak **`2.577 GiB`**), `353 – 397` PIDs.
  - **Phase 3 — `renderScene` with 1 remaining scene drawing (`1` scene, 2 Chromium pages + 1 `ffmpeg` encoder):** `200.8% – 334.5%` CPU (~2.6 cores), **`1.358 – 1.425 GiB`** memory, `199` PIDs.
  - **Phase 4 — `assemble` (single `ffmpeg` filtergraph muxing video, subtitles, watermark, voice, music, SFX):** `155.4% – 570.4%` CPU, **`795 MiB – 1.167 GiB`** memory, `175 – 180` PIDs.
  - **Post-render cleanup (`finally` block closes Chromium and removes `/tmp/plate-film-*` scratch dir):** memory drops immediately from `2.577 GiB` back to **`304.1 MiB`** (`18` PIDs) with no leak across subsequent renders.

---

## 9. Decisions Where the Brief Was Silent, Deviations, Risks, and Open Questions

### Decisions Where the Brief Was Silent
1. **Implementing `Idempotency-Key` without editing `backend/src/server.ts`:**
   - Rule 47 restricts edits to `backend/src/render/`, `backend/src/plates/`, `backend/src/tokens/`, `backend/src/jobs/control.ts`, and `backend/src/db/migrations/` (excluding `backend/src/server.ts`, where `app.post("/v1/projects/:id/render", ...)` is defined).
   - Because `server.ts` calls `registerRenderQuote(app)` (defined in `backend/src/render/quote.ts`) on the root Fastify instance before registering `/v1/projects/:id/render`, we registered the `preHandler` / `onSend` / `onResponse` / `onError` idempotency hooks inside `registerRenderQuote(app)` and stored `idempotency_key` in `renderJobRepository.createAndEnqueue` (`backend/src/render/repository.ts`). This achieved full request-level idempotency (returning `202` with the existing job before `spendTokens` is called) while strictly respecting the file boundary.
2. **Repair revision numbering on manifest verification failure (`plate.sendBackForRepair`):**
   - When a scene fails verification inside `renderPlateFilmJob` or `handlePlateExport`, the variant in `app.plate_variants` is in `checked` or `bundled` state at `rev = R` (unlike `handlePlateRender`, where `state = 'rendering'` and `render_attempt > 0`).
   - Extending `plate.sendBackForRepair` to accept calls without `renderAttempt` and increment `rev = rev + 1` (while keeping `render_attempt = 0`) ensures that when `plate-author` commits the repaired bundle, `commitBundle` writes a new repair revision row `rev = R + 1` in `app.plate_revisions` (preserving `rev = R` for undo) and leaves the live variant in `state = 'bundled', stage = 'checking'` so it returns to the Step 3 preview as a repair revision without triggering a worker clip render.
3. **Baking `scene.params` into the worker's local scene HTML:**
   - When `scene.params` in the frozen Schema 2 manifest is non-empty, `prepareManifestClips` injects `window.__PARAMS__ = <canonicalJson(scene.params)>;` into the downloaded `scene-<index>.html` before running `verifyScene` and `renderScene`, ensuring parameter edits frozen in the manifest are rendered identically on the worker.

### Deviations
- None. Every rule and file boundary in `TASK-5-final-render.md` was followed strictly.

### Risks and Open Questions
1. **Worker task memory sizing on ECS Fargate:**
   - With `PLATE_CONCURRENCY = 2` and `PLATE_FRAME_WORKERS = 2`, peak container memory during concurrent `1920×1080` software-GL scene drawing reached **`2.58 GiB`**. ECS worker task definitions running `PLATE_CONCURRENCY = 2` should be provisioned with at least **`4 GB` (4096 MiB) of task memory** (or set `PLATE_CONCURRENCY = 1` on `2 GB` tasks, where single-scene draw memory peaked at **`1.43 GiB`**).
2. **Frontend `Idempotency-Key` header generation (client change note, `frontend/` untouched per Rule 47):**
   - The backend now honours `Idempotency-Key` on `POST /v1/projects/:id/render` (and keeps requests without the header working as today). To protect against double-clicks in the browser UI, the frontend `startRender` call in `frontend/components/plate-preview.tsx` / `frontend/components/studio.tsx` can generate one UUID per `Render` button click (`headers: { "Idempotency-Key": clickId }`) and reuse it across automatic network retries of that click.

---

## 10. Manager verification (independent re-check, 2026-11-05)

Rebuilt stack, run by the manager with targeted teardowns (the user's Postgres and worker containers were not touched): `live-e2e.mjs` **146 of 146 assertions (scenarios A to T)**; `chaos.mjs` **28 of 28**; clip-mode `scripts/plates-e2e/run.mjs failures cache` both pass (repair path and cache behaviour unchanged). Backend: typecheck clean, 36 test files pass, the same five known failures (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`) and nothing new; worker `plates-phase5` and `motion-blur` tests pass. Not re-run by the manager: clip-mode `happy` and `durability` suites (agent: pass), the frontend suite (frontend untouched).
Tech debt recorded, not fixed: the render idempotency key reaches `createAndEnqueue` through an in-process map guarded by a per-project lock (set in `registerRenderQuote` hooks) because the agent was not allowed to edit `server.ts`. It is correct on one API process and the unique index plus the refund cover several, but it should pass the key explicitly from the route through `createBeatPlanRender` (an unused `AsyncLocalStorage` import was also left in `repository.ts`).
