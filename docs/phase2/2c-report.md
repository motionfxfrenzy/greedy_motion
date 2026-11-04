# Phase 2c Report — Final Render and Exports Draw on Demand for Live Projects

## 1. Files Created and Changed

### Created
- `backend/src/db/migrations/020_plate_draw_on_demand.sql` — Idempotent migration adding `draw_aspects text[] not null default '{}'` to `app.plate_state` to persist on-demand draw intent per aspect ratio.
- `backend/test/plate-live-render.mjs` — Hermetic integration test against real Postgres and `pg-boss` covering migration 020 idempotency, `requestDraws` on `checked`/`bundled`/already-clipped variants, no per-project clip cap (6 variants), deferred `commitBundle` enqueueing, `reconcilePlates` recovery scoped to `draw_aspects`, clip-mode no-op, and `PLATE_LIVE_FORCE_OFF` clearing `draw_aspects`.
- `docs/phase2/2c-report.md` — This Phase 2c implementation and acceptance report.

### Changed
- `backend/src/plates/store.ts` — Factored single-variant enqueue logic into `enqueueVariantClipWithClient(client, row, cap)` shared by `requestVariantClip` and the new `requestDraws(projectId, aspects)` (with `cap = null`), updated `commitBundle` and `reconcileVariants` to enqueue `plate-render` when a live variant's aspect is in `draw_aspects`, fenced out late check reports once `stage = 'queued for rendering'`, and added `drawAspects` to `readProjectState`.
- `backend/src/plates/reconcile.ts` — Updated `reconcilePlates` to re-enqueue lost `plate-render` messages (with `singletonKey`) for live variants whose aspect is in `draw_aspects` while leaving live variants outside `draw_aspects` untouched, and cleared `draw_aspects` to `'{}'` on `PLATE_LIVE_FORCE_OFF` rollback.
- `backend/src/plates/exports.ts` — Updated `requestExport` to call `requestDraws(project.id, [aspect])` before rethrowing `NotDrawn("...", "drawing")` when a ratio is not yet fully drawn.
- `backend/src/render/service.ts` — Updated the plate branch of `prepareFilm` to call `await requestDraws(project.id, [aspect])` right after `await startPlates(project.id)` and before `await buildExport(project, aspect, prep.watermark, { pending: true })`.
- `backend/package.json` — Added the `"test:plate-live-render": "node --env-file-if-exists=.env test/plate-live-render.mjs"` script.
- `tools/phase2/e2e/live-e2e.mjs` — Updated Scenario H for Phase 2c draw-on-demand expectations and added Scenarios J (final render of a browser-checked live project + idempotent repeat render) and K (immediate final render with no browser check + companion export for a second ratio).

---

## 2. Exact Commands Run

```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes

# 1. Baseline checks before changes
docker ps
cd frontend && npm run typecheck && npm test
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done

# 2. Run new backend integration test and all plate-* backend tests
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend
npm run typecheck
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-live-render.mjs
for f in test/plate-*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done

# 3. Build and start the plates-e2e compose stack with PLATE_LIVE_PREVIEW=on
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker

# 4. Run end-to-end acceptance suite (Scenarios A through K)
node tools/phase2/e2e/live-e2e.mjs

# 5. Tear down only the plates-e2e services (preserving user's postgres and worker)
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore
docker ps

# 6. Post-change full frontend and backend suites
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/frontend && npm run typecheck && npm test
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend && npm run typecheck
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done
```

---

## 3. Results of `plate-live-render.mjs` and End-to-End Scenarios A to K

### `backend/test/plate-live-render.mjs`
- **Status:** **PASS (`plate live render: ok`)**
- **Verified assertions:**
  1. `020_plate_draw_on_demand.sql` applied twice idempotently; `app.plate_state.draw_aspects` (`ARRAY`, `NOT NULL`, default `'{}'::text[]`) verified.
  2. `requestDraws` on a `checked` variant and a `bundled` variant (both with `clip_key = null`) set `state = 'bundled'`, `stage = 'queued for rendering'`, `enqueued_at = now()`, persisted `draw_aspects = ['16:9']`, and enqueued `1` `plate-render` job each (`enqueued = 2`).
  3. Calling `requestDraws` a second time returned `{ enqueued: 0 }` and enqueued `0` additional `plate-render` jobs (`1` job per variant total).
  4. Variants that already had a `clip_key` (both `state = 'drawn'` and `state = 'checked'` with `clip_key` present) were untouched (`0` `plate-render` jobs).
  5. With 6 variants in a live project (`config.plates.projectClipCap = 4`), `requestDraws` enqueued all `6` variants (`enqueued = 6`, `1` `plate-render` job each).
  6. Variants still in `queued` and `authoring` when `requestDraws` ran (`enqueued = 0`) transitioned to `state = 'bundled', stage = 'queued for rendering'` and enqueued `1` `plate-render` job each immediately upon `commitBundle`, while a `9:16` variant (not in `draw_aspects`) on the same live project stayed in `stage = 'checking'` with `0` `plate-render` jobs.
  7. After deleting a `16:9` variant's `plate-render` job and aging both `16:9` (in `draw_aspects`) and `9:16` (outside `draw_aspects`) past 90 seconds, `reconcilePlates()` re-enqueued the lost `16:9` `plate-render` job once and left the `9:16` variant untouched (`0` jobs, `stage = 'checking'`).
  8. On a `clip`-mode project, `requestDraws` was a complete no-op (`enqueued = 0`, `draw_aspects = []`, `0` jobs enqueued).
  9. Setting `config.plates.liveForceOff = true` and running `reconcilePlates()` flipped `live_mode` to `'clip'` and cleared `draw_aspects` to `[]`.

### End-to-End Acceptance Suite (`tools/phase2/e2e/live-e2e.mjs`, Scenarios A–K)

All **11 scenarios (A–K)** and **108 / 108 explicit assertions** passed.

| Scenario | Description | Status | Key Numbers & Measurements |
| --- | --- | --- | --- |
| **A** | **Happy path, live** (`illus-fox`, 16:9, 3 beats) | **PASS** | Draw request → all 3 `bundled`: **`615 ms`** (`0.62 s`)<br>Draw request → all 3 `checked`: **`6,651 ms`** (`6.65 s`)<br>Browser `WorkerHost` draw rate (`854×480`): **`23.0 fps`** (`43.5 ms/frame` mean)<br>`PlatePlayer` vs page-thread host pixel diff (frames `0`, `45`, `89`): **`0` differing pixels**<br>`pgboss.job` `plate-render` count: **`0`** |
| **B** | **Clip fallback & project clip cap** | **PASS** | Single `checked` variant (`165` frames) `requestClip` → `drawn`: **`71,734 ms`** (`71.7 s`), `165 / 165` frames<br>5 concurrent clip requests in 1 project: first 4 returned **`202`**, 5th refused with **`429 { code: "clip_cap" }`** |
| **C** | **Fencing over HTTP** (`POST .../check`) | **PASS** | Stale `gen` → **`204`**; wrong `bundleDigest` → **`204`**; non-`bundled` (`drawn`) → **`204`**<br>Duplicate valid report → identical **`200 { state: "checked" }`**, `plate_check_reports` rows = **`1`**<br>`host: "main"` → **`400`**; `clip` mode project → **`409 { code: "not_live" }`** |
| **D** | **Comment and revision** (`POST .../comments`, `POST .../fix`) | **PASS** | `gen` incremented **`1 → 2`**, `rev` **`0 → 1`**, state reset to `queued` → `authoring` → `bundled`<br>Stale `gen = 1` report → **`204`**; browser re-checked `gen = 2` → **`200 { state: "checked" }`**<br>`sweepGarbage()` kept `g1/` objects (protected by `plate_revisions`) and deleted unreferenced `g99/` object |
| **E** | **Tamper** (replace `bundle.html` in S3Mock) | **PASS** | `fetchBundle` rejected modified HTML with SHA-256 mismatch; `0` iframes created, `WorkerHost` not constructed |
| **F** | **Rollback** (`PLATE_LIVE_FORCE_OFF=1`) | **PASS** | `live_mode` flipped `'live' → 'clip'`, `draw_aspects` cleared<br>2 remaining `checked` variants rendered by `plate-worker` to `drawn` in **`90,331 ms`** (`90.3 s`)<br>Second `reconcilePlates()` pass enqueued **`0`** extra jobs (`3 → 3`) |
| **G** | **Flag semantics** (`PLATE_LIVE_PREVIEW` on → off) | **PASS** | Project created while flag `on` stayed `live_mode = 'live'` after restart with flag `off` and accepted `/check` (`200`)<br>Project created while flag `off` got `live_mode = 'clip'`, auto-rendered to `drawn` in **`35,447 ms`** (`35.4 s`), and rejected `/check` (`409`) |
| **H** | **Final render & export expectation** *(updated for Phase 2c)* | **PASS** | `POST .../plates/export` (`16:9`) on a 2-scene `checked` live project returned **`202 { state: "drawing", progress: 0, aspect: "16:9" }`**, persisted `draw_aspects = ["16:9"]`, and enqueued **`2`** `plate-render` jobs (`1` per scene)<br>`POST .../render` returned **`202`**, prepared the `plate-film` manifest, and kept `plate-render` count at **`2`** (no duplicate jobs) |
| **I** | **Unsupported environment** (Safari macOS UA override) | **PASS** | `environmentStatus()` = **`"unverified"`**, `supportsWorkerHost()` = **`false`**<br>`PlatePlayer` selected **`{ mode: "clip", reason: "unverified-environment" }`**, `0` iframes, `0` Workers |
| **J** | **Final render of a browser-checked live project** (`illus-fox`, 16:9, 3 beats) | **PASS** | Render request → finished MP4 (`state: "ready"`): **`160,954 ms`** (`161.0 s`)<br>Scenes drawn: **`3 / 3`**<br>`pgboss.job` `plate-render` count: **`3`** (`1` per scene)<br>Repeated `POST .../render` `plate-render` count: **`3`** (`0` additional jobs enqueued)<br>Downloaded MP4 (`ffprobe`): **`1920×1080`**, `aac` audio stream, **`480 / 480` frames** matching manifest |
| **K** | **Final render with no browser at all + companion export** (`illus-balloon`, 16:9 + 9:16, 2 beats) | **PASS** | Immediate `POST .../render` (before `bundled`, no check reports) → finished MP4: **`79,923 ms`** (`79.9 s`)<br>Rows ever reaching `checked`: **`0`** (`checked_at = null` on all 4 rows)<br>Primary `16:9` scenes drawn: **`2 / 2`**, `plate-render` count: **`2`** (`1` per scene)<br>Final render MP4 (`ffprobe`): **`1920×1080`**, `aac` audio stream, **`270 / 270` frames**<br>Companion export `POST .../plates/export` (`9:16`): initial **`202 { state: "drawing" }`** → **`ready` in `93,561 ms`** (`93.6 s`), `9:16` scenes drawn: **`2 / 2`**, `plate-render` count: **`2`**, downloaded MP4 **`1080×1920`**, `aac` audio stream, **`270 / 270` frames** |

---

## 4. Full Backend and Frontend Suites (Before vs After)

### `frontend` (`npm run typecheck` & `npm test`)

| Metric | Before Phase 2c | After Phase 2c |
| --- | --- | --- |
| `npm run typecheck` | PASS (`0` errors) | PASS (`0` errors) |
| Test files (`test/*.mjs`) | `22 / 22` PASS | `22 / 22` PASS |
| Individual tests | `145 / 145` PASS (`0` failed) | `145 / 145` PASS (`0` failed) |

### `backend` (`npm run typecheck` & `test/*.mjs`)

| Metric | Before Phase 2c | After Phase 2c |
| --- | --- | --- |
| `npm run typecheck` | PASS (`0` errors) | PASS (`0` errors) |
| Passing test files | `31 / 36` PASS (incl. all 7 `test/plate-*.mjs` suites) | `32 / 37` PASS (incl. all 8 `test/plate-*.mjs` suites, with new `test/plate-live-render.mjs`) |
| Pre-existing failing test files | `5 / 36` FAIL (`billing.mjs`, `brand-files.mjs`, `render-prep.mjs`, `styles.mjs`, `visuals.mjs`) | `5 / 37` FAIL (`billing.mjs`, `brand-files.mjs`, `render-prep.mjs`, `styles.mjs`, `visuals.mjs` — identical) |

---

## 5. Decisions Where the Brief Was Silent and Deviations

1. **Guarding `submitCheckReport` against overwriting `stage = 'queued for rendering'`:**
   - When a live variant is queued for worker rendering via `requestDraws`, `requestVariantClip`, or `commitBundle` (for an aspect in `draw_aspects`), its DB row has `state = 'bundled'` and `stage = 'queued for rendering'` so the worker's `claimVariant` (which requires `state = 'bundled'`) can claim it.
   - If a browser tab had a check in flight at the same moment and submitted `POST .../check` before the worker claimed the row, transitioning `state` to `'checked'` would prevent `claimVariant` from claiming the variant.
   - We therefore added `row.stage === "queued for rendering"` to the state fence in `submitCheckReport` (`if (row.state !== "bundled" || row.stage === "queued for rendering")`), dropping any late browser check report with `204` once a variant has entered the worker render queue.
2. **Handling `requestDraws` when `app.plate_state` has not yet been initialized:**
   - In production, `startPlates` calls `decideLiveMode` before `requestDraws`. To ensure `requestDraws` also works if called standalone in a unit test before `decideLiveMode` when `config.plates.live` is `true`, `requestDraws` initializes `live_mode = 'live'` via `decideLiveModeWithClient` if no `plate_state` row exists yet, while remaining a strict no-op when `live_mode` is `'clip'` or `config.plates.live` is `false`.
3. **Updating Scenario H in `tools/phase2/e2e/live-e2e.mjs`:**
   - As instructed in the brief (*"Scenario H's expectations change from 'waits forever' to the new behaviour; update its assertions and say so in the report"*), Scenario H now asserts that `POST /v1/projects/:id/plates/export` returns `202 { state: "drawing", progress: 0, aspect: "16:9" }` while persisting `"16:9"` in `app.plate_state.draw_aspects` and enqueuing `1` `plate-render` job per scene, and that a subsequent `POST /v1/projects/:id/render` prepares the `plate-film` job without enqueuing duplicate `plate-render` jobs.
4. **Deviations from the brief:**
   - None. All rules and file boundaries were respected strictly.

---

## 6. Risks and Open Questions

1. **User edits a scene (or storyboard) while a billed final render is waiting for clips:**
   - **Comment revision (`reviseScene`) while render is waiting:** `reviseScene` increments `gen` and `rev`, resets `state` to `'queued'` (leaving `signature` unchanged), and clears `clip_key` only when the new clip is published (or if it wasn't drawn yet, `clip_key` is still `null`). Because `draw_aspects` already contains the aspect, when the revised scene finishes authoring (`commitBundle`), it will automatically enqueue `plate-render` for the new generation `gen + 1`. Meanwhile, `resolveClips` in `worker/src/plates.mjs` checks `row.signature !== scene.sig` (which is still equal on a comment revision) and waits for `row.state === 'drawn' && row.clip_key`. Thus a comment revision mid-render could cause the in-flight render to assemble the newly revised clip (or an older clip if `reviseScene` did not clear `clip_key`), rather than the exact revision that existed when `Render` was clicked. Full Phase 5 (frozen export manifest with `bundleDigest` verification and clip lookup by `bundleDigest`) is needed to guarantee "render what I previewed" under concurrent comment edits.
   - **Storyboard input change (`reconcileVariants` with a new `signature`) while render is waiting:** `reconcileVariants` updates `signature` on `app.plate_variants` and sets `clip_key = null, state = 'queued'`. On its next 2-second poll, `resolveClips` in `worker/src/plates.mjs` sees `row.signature !== scene.sig` and immediately throws `InputError("The scenes were changed after this film was started. Start it again to export the latest version.")`, failing the render job permanently without retrying.
2. **Is the 20-minute stall limit in `resolveClips` (`worker/src/plates.mjs`) adequate when drawing happens only at render time?**
   - Note that the 20-minute timer in `resolveClips` (`if (Date.now() - stalledSince > 20 * 60_000)`) resets `stalledSince = Date.now()` **every time `done` (the number of `drawn` scenes) changes**. So the limit is **20 minutes per batch of `PLATE_PROJECT_CAP` scenes without a single scene completing**, not 20 minutes for the entire film.
   - However, if a user clicks `Render` immediately after storyboard creation (as in Scenario K), the first scene must complete **both** LLM authoring (`plate-author`, which may include a 429 backoff or up to 3 repair attempts) **and** CPU frame rendering (`plate-render`, ~35–90s per scene) before `done` increments from `0` to `1`. Under normal conditions (authoring ~20–60s + rendering ~45–90s = ~1–3 minutes for the first scene), 20 minutes has a ~7–10× safety margin.
   - **Where it could still be tight:** (a) if all workers are saturated with other projects' `plate-render` jobs or ECS cold-start + queue backlog exceeds 20 minutes before the first scene of this project finishes; or (b) if `render-video` itself hits `config.renderTimeoutSeconds` in `pg-boss` while waiting in `resolveClips`. Holding a `render-video` worker slot idle in a `setTimeout(..., 2000)` poll loop while scenes are authored and drawn also ties up a worker concurrency slot; in Phase 5, either driving scene draws inside the job or queuing `render-video` only after all manifest clips are ready would avoid holding a worker slot during scene authoring/drawing.
3. **Single-device live preview during on-demand draw (`checked -> bundled`):**
   - As noted in `LIVE_SCENES_PLAN.md` §21, transitioning a `checked` variant to `state = 'bundled', stage = 'queued for rendering'` so the worker's `claimVariant` can claim it causes `plateStatus` to report `state: "rendering", live: false` until the worker finishes drawing `state = 'drawn'`. Once `state = 'drawn'`, the clip is playable (`isPlayable` is `true`).
