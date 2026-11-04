# Phase 2 End-to-End Acceptance Report (Local Stack, `PLATE_LIVE_PREVIEW=on`)

## 1. Exact Commands Run

```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes

# 1. Baseline typecheck and full test suites (before e2e run / fixes)
cd frontend && npm run typecheck && npm test
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done

# 2. Build and start the plates-e2e stack with PLATE_LIVE_PREVIEW=on
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker

# 3. Run the end-to-end acceptance suite (scenarios A through I)
node tools/phase2/e2e/live-e2e.mjs

# 4. Post-fix typecheck and full test suites (after fixing frontend/lib/live/api.ts)
cd frontend && npm run typecheck && npm test
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done

# 5. Tear down only the plates-e2e containers started for this run (preserving user's postgres and worker)
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore
docker ps
```

---

## 2. Scenario Results (A to I) and Key Numbers

All **9 scenarios (A–I)** and **79/79 explicit assertions** passed.

| Scenario | Description | Status | Key Numbers & Measurements |
| --- | --- | --- | --- |
| **A** | **Happy path, live** (`illus-fox`, 16:9, 3 beats) | **PASS** | Draw request → all 3 `bundled`: **`614 ms`** (`0.61 s`)<br>Draw request → all 3 `checked` (browser fetch + SHA + Worker `runCheck` + `reportCheck`): **`6,295 ms`** (`6.30 s`)<br>Browser `WorkerHost` draw rate (`fox` @ `854×480`): **`22.7 fps`** (`44.1 ms/frame` mean)<br>`PlatePlayer` vs page-thread host pixel diff (frames `0`, `45`, `89`): **`0` differing pixels** (`maxDelta = 0`)<br>`pgboss.job` `plate-render` count: **`0`**; clips/stills in object storage: **`0`** |
| **B** | **Clip fallback & project clip cap** | **PASS** | Single `checked` variant (`165` frames) `requestClip` → `202 { state: "rendering" }` → `drawn`: **`64,845 ms`** (`64.8 s`)<br>`GET .../plates/2/clip` → `302` → `ffprobe` packet count: **`165 / 165` frames**<br>5 concurrent clip requests in 1 project: first 4 returned **`202`**, 5th refused with **`429 { code: "clip_cap" }`**; first 4 unaffected in Postgres, 5th untouched in `bundled` (`stage = "checking"`) |
| **C** | **Fencing over HTTP** (`POST .../check`) | **PASS** | Stale/wrong `gen` → **`204`** (state unchanged)<br>Wrong `bundleDigest` → **`204`** (state unchanged)<br>Variant not in `bundled` (`state = "drawn"`) → **`204`** (state unchanged)<br>Duplicate valid report → identical **`200 { state: "checked" }`**; `app.plate_check_reports` count = **`1`**<br>`host: "main"` → **`400 { code: "invalid_check" }`**<br>Project in `clip` mode → **`409 { code: "not_live" }`** |
| **D** | **Comment and revision** (`POST .../comments`, `POST .../fix`) | **PASS** | `gen` incremented **`1 → 2`**, `rev` **`0 → 1`**, state reset from `checked` → `queued` → `authoring` → `bundled`<br>Stale `gen = 1` report → **`204`**<br>New bundle written to `.../g2/bundle.html` with identical `variantSignature` (`v3:119240debe07568aa681e030`)<br>Browser re-fetched & re-checked `gen = 2` → **`200 { state: "checked" }`**<br>`sweepGarbage()` kept `g1/` objects (protected by `plate_revisions` `rev = 0`) and deleted unreferenced `g99/` object |
| **E** | **Tamper** (replace `bundle.html` in S3Mock) | **PASS** | `fetchBundle` rejected modified HTML with `Bundle SHA-256 verification failed: HTML does not match manifest bundleSha prefix "6197eb182c2c1d47e24f1ea7"`<br>Iframes created: **`0`**, Worker spawned: **`false`**, tampered script executed: **`false`** |
| **F** | **Rollback** (`PLATE_LIVE_FORCE_OFF=1` via `compose.rollback.yaml`) | **PASS** | `app.plate_state.live_mode` flipped `'live' → 'clip'` on startup sweep<br>2 remaining `checked` variants rendered by `plate-worker` to `drawn` in **`78,093 ms`** (`78.1 s`)<br>Second `reconcilePlates()` pass enqueued **`0`** extra jobs (`open = 0`, job count `3 → 3`)<br>`GET .../plates/0..2/clip` returned `302` with valid MP4s (`90`, `165`, `165` frames via `ffprobe`) |
| **G** | **Flag semantics** (`PLATE_LIVE_PREVIEW` on → off) | **PASS** | Project created while flag `on` stayed `live_mode = 'live'` (`GET .../plates` `mode: "live"`) after restarting stack with flag `off`, and continued accepting `/check` (`200 { state: "checked" }`)<br>Project created while flag `off` got `live_mode = 'clip'`, auto-rendered `bundled → rendering → drawn` in **`33,328 ms`** (`33.3 s`), and rejected `/check` with **`409 { code: "not_live" }`** |
| **H** | **Final render expectation** (`live` project, `checked` variants, no clips) | **PASS** *(documented)* | Companion export `POST .../plates/export` returned **`202 { state: "drawing", progress: 0, aspect: "16:9" }`**; `GET .../plates/export/16-9` returned **`404`**<br>Billed final render `POST .../render` returned **`202`**, advanced to `state: "rendering", stage: "frames", progress: 52, frames: { done: 0, total: 2 }`, and waited in `resolveClips` (see §7) |
| **I** | **Unsupported environment** (Safari macOS UA override) | **PASS** | `environmentStatus()` returned **`"unverified"`**, `supportsWorkerHost()` returned **`false`**<br>`PlatePlayer` chose **`{ mode: "clip", reason: "unverified-environment" }`**<br>`player.workerHost`: **`null`**, `<iframe>` count: **`0`**, `new Worker()` count: **`0`** |

---

## 3. Exact CORS Outcome of Scenario A

### Local Stack (`adobe/s3mock:4.7.0` on `http://localhost:59000`)
- **Outcome:** **Succeeded (`HTTP 200 OK`, `0` console errors).**
- When the browser page served at `http://127.0.0.1:<port>` executed `fetchBundle(projectId, variantId)`:
  1. `GET /v1/projects/:id/plates/:variantId/bundle` returned the presigned URL `http://localhost:59000/plates-uploads/plates/<projectId>/16x9/<scene>/g1/bundle.html?X-Amz-Algorithm=AWS4-HMAC-SHA256&...&response-content-type=text%2Fhtml&x-id=GetObject`.
  2. The browser performed a cross-origin `fetch()` from `Origin: http://127.0.0.1:<port>` directly to `http://localhost:59000/plates-uploads/...`.
  3. `adobe/s3mock:4.7.0` responded with:
     ```http
     HTTP/1.1 200 OK
     Access-Control-Allow-Origin: *
     Access-Control-Expose-Headers: *
     Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
     Content-Type: text/html
     ```
- **Why local S3Mock passed while staging/production R2 is still a risk:**
  - `adobe/s3mock:4.7.0` enables permissive Spring CORS (`Access-Control-Allow-Origin: *`) on all endpoints by default.
  - Real **Cloudflare R2** buckets (`https://<account>.r2.cloudflarestorage.com/<uploads-bucket>/...`) do **not** send `Access-Control-Allow-Origin` headers by default. Unlike `<video src="...">` or `<img src="...">` (which load without CORS), `fetchBundle` uses `fetch(presignedUrl)` to read the HTML text and verify its SHA-256 digest before constructing the Worker blob.
  - **Configuration required on staging/production Cloudflare R2 (`R2_UPLOADS_BUCKET`):** Configure a CORS rule on the R2 uploads bucket allowing:
    ```json
    [
      {
        "AllowedOrigins": [
          "https://staging.greedymotion.com",
          "https://greedymotion.com",
          "http://localhost:3000"
        ],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
        "MaxAgeSeconds": 3600
      }
    ]
    ```
  - **API CORS note (`plate-api`):** In the real Next.js frontend (`frontend/next.config.ts`), `/api/backend/:path*` rewrites same-origin to `${backendOrigin}/v1/:path*`, so API calls (`/bundle`, `/check`, `/clip-request`) are same-origin with the page; if called cross-origin directly against `plate-api`, the frontend origin must be listed in `CORS_ORIGINS`.

---

## 4. Bugs Found and Contradictions Noted

### Bugs Found and Fixed

1. **Bug 1 — Uncaught `ReferenceError: process is not defined` in `resolveApiUrl` (`frontend/lib/live/api.ts`):**
   - **Failing assertion:** Scenario A — `scene 0 fetchBundle succeeded in browser from page origin` threw `ReferenceError: process is not defined at resolveApiUrl (frontend/lib/live/api.ts:92)`.
   - **Root cause:** `resolveApiUrl` evaluated `baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? ""`. In Node unit tests (`frontend/test/live-support-api.mjs`), global `process` exists; in the Phase 2b Chrome integration test (`frontend/test/live-chrome-integration.mjs`), only `WorkerHost` and `PlatePlayer` were invoked in the browser, not `fetchBundle`, `reportCheck`, or `requestClip`. In a real browser bundle (or when `options.baseUrl` is omitted), `process` is undefined on `globalThis`, throwing a `ReferenceError`.
   - **Fix (8 lines changed in `frontend/lib/live/api.ts`):** Guarded `process` access with `typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_API_URL : undefined`.
   - **Covering regression test:** Added `fetchBundle, reportCheck, and requestClip work in browser environments where globalThis.process is undefined` in `frontend/test/live-support-api.mjs` (and exercised in headless Chrome in `tools/phase2/e2e/live-e2e.mjs` Scenarios A, B, D, E).

2. **Bug 2 — Duplicate `/v1` path prefix when `baseUrl` is Next.js proxy `/api/backend` (`frontend/lib/live/api.ts`):**
   - **Failing path:** `frontend/app/dev/live-preview/page.tsx` calls `fetchBundle(projectId, variantId, { baseUrl: "/api/backend" })`, `reportCheck(..., { baseUrl: "/api/backend" })`, and `requestClip(..., { baseUrl: "/api/backend" })`.
   - **Root cause:** `frontend/next.config.ts` rewrites `/api/backend/:path*` to `${backendOrigin}/v1/:path*`. Because `fetchBundle`, `reportCheck`, and `requestClip` pass `/v1/projects/...` to `resolveApiUrl`, concatenating `baseUrl: "/api/backend"` produced `/api/backend/v1/projects/...`, which Next.js rewrites to `${backendOrigin}/v1/v1/projects/...` (`404 Not Found`).
   - **Fix (included in `resolveApiUrl` in `frontend/lib/live/api.ts`):** When `base` ends with `/api/backend` or `/v1` and `path` starts with `/v1/`, `resolveApiUrl` strips the duplicate `/v1` prefix so `/api/backend/projects/...` is requested.
   - **Covering regression test:** Added assertion in `frontend/test/live-support-api.mjs` verifying `fetchBundle("p1", "v1", { baseUrl: "/api/backend" })` requests `/api/backend/projects/p1/plates/v1/bundle` while still fetching the absolute presigned URL `https://r2.test/bundle.html` unchanged.

### Contradictions Between the Brief and Reality

1. **Scenario D (`bundleDigest` after comment revision with `scripts/plates-e2e/llm-stub.mjs`):**
   - The brief states: *"a new bundle appears with a **different** `bundleDigest` but the same `variantSignature`"*.
   - In reality, `scripts/plates-e2e/llm-stub.mjs` (which cannot be edited per Rule 1) always returns the exact same static fixture file (`fox-0.ts`) on a comment revision (`revise = true`) as on initial authoring (`rev = 0`). Because `bundleScene` is deterministic and `bundleDigest` hashes `[bundleSha, paramsDigest(params), fontSetDigest(), engineDigest]` (which `docs/LIVE_SCENES_PLAN.md` §6 and `backend/test/plate-digest.mjs` require to be equal when code, params, fonts, and engine are unchanged), the stub's identical TypeScript output produces a new object at `plates/<id>/16x9/0/g2/bundle.html` (`gen = 2, rev = 1`) with the **same** `bundleSha` and `bundleDigest` (`73caa2b2b425...`). When either the authored code or `params` changes (tested in `backend/test/plate-live.mjs` and `backend/test/plate-digest.mjs`), `bundleDigest` changes while `variantSignature` stays constant.
2. **Teardown command in "How to run" (`docker compose ... down`):**
   - The brief states: *"The shared local Postgres container and the container `videosaas-local-worker-1` belong to the user and are already running: do NOT stop, recreate or remove them. At the end tear down only what you started: `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down` (without `-v`)"*.
   - Because `postgres` and `worker` in `compose.yaml` have no `profiles:` key, running `docker compose ... down` without service names stops all services in `compose.yaml`, including `videosaas-local-postgres-1` and `videosaas-local-worker-1`. Passing the `plates-e2e` service names (`docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore`) tears down only the four `plates-e2e` containers while keeping `videosaas-local-postgres-1` and `videosaas-local-worker-1` running.

---

## 5. Full-Suite Results Before and After (`backend` and `frontend`)

### `frontend` (`npm run typecheck` & `npm test`)

| Metric | Before | After |
| --- | --- | --- |
| `npm run typecheck` | PASS (`0` errors) | PASS (`0` errors) |
| Test files (`test/*.mjs`) | `22 / 22` PASS | `22 / 22` PASS |
| Individual tests | `144 / 144` PASS (`0` failed) | `145 / 145` PASS (`0` failed, +1 regression test in `test/live-support-api.mjs`) |

### `backend` (`npm run typecheck` & `test/*.mjs`)

| Metric | Before | After |
| --- | --- | --- |
| `npm run typecheck` | PASS (`0` errors) | PASS (`0` errors) |
| Passing test files | `31 / 36` PASS (incl. all 7 `test/plate-*.mjs` suites) | `31 / 36` PASS (incl. all 7 `test/plate-*.mjs` suites) |
| Pre-existing failing test files (unrelated to plates) | `5 / 36` FAIL (`billing.mjs`, `brand-files.mjs`, `render-prep.mjs`, `styles.mjs`, `visuals.mjs` — identical to `2a-report.md` baseline) | `5 / 36` FAIL (unchanged) |

---

## 6. Anything Not Tested and Why

1. **Real Cloudflare R2 presigned URL CORS in staging/production:** Local acceptance uses `adobe/s3mock:4.7.0`, which sends `Access-Control-Allow-Origin: *` by default. Real Cloudflare R2 bucket CORS headers cannot be tested until staging trial (as local-only rules prohibit cloud calls).
2. **Real Anthropic LLM code variation on comment revision (Scenario D):** Local rules require using `llm-stub` only; `llm-stub.mjs` returns fixed fixture code on revision rather than modified code (see §4 Contradiction 1).
3. **Real Safari (macOS/iOS), Firefox, and low-end Android hardware:** Scenario I tested the `unverified` gate in headless Chrome by overriding `navigator.userAgent` before module load; physical Safari/Firefox/Android devices remain `unverified` per `LIVE_SCENES_PLAN.md` §0b.

---

## 7. Scenario H Behaviour (Final Render & Companion Export on `live` Projects)

When a project is in `live` mode and all of its variants are in `state = 'checked'` with `clip_key = null` (never drawn by the worker):

1. **Companion Export (`POST /v1/projects/:id/plates/export` with `{ "aspect": "16:9" }`):**
   - `buildExport()` in `backend/src/plates/exports.ts` (line 55) checks `ordered.some((v) => v!.state !== "drawn" || !v!.clip_key)` when `options.pending` is not set and throws `NotDrawn("This ratio is still being drawn.", "drawing")`.
   - `routes.ts` catches `NotDrawn` and responds with **`HTTP 202`** and body:
     ```json
     { "state": "drawing", "progress": 0, "aspect": "16:9" }
     ```
   - No row is inserted into `app.plate_exports` and no `plate-export` job is queued. Calling `GET /v1/projects/:id/plates/export/16-9` returns **`HTTP 404`** `{ "error": { "code": "not_found", "message": "Not found." } }`.
2. **Billed Final Render (`POST /v1/projects/:id/render` with `{}`):**
   - Returns **`HTTP 202`** with a new `queued` render job.
   - The backend planning consumer runs `prepareFilm()` (`backend/src/render/service.ts` lines 77–92), which calls `startPlates(project.id)` and `buildExport(project, aspect, watermark, { pending: true })`, uploads the export manifest (where each scene's `clipKey` is `null`), and enqueues a `render-video` job of `kind: "plate-film"`.
   - Because `startPlates()` in `live` mode sees that the variants are already `checked` with matching signatures, it does **not** enqueue `plate-render` jobs for them.
   - `plate-worker` picks up the `render-video` job (`renderPlateFilmJob` → `resolveClips` in `worker/src/plates.mjs` lines 407–427), reports `state: "rendering", stage: "frames", progress: 52, frames: { done: 0, total: 2 }`, and polls `app.plate_variants` every 2 seconds waiting for `row.state === "drawn" && row.clip_key` (which will time out after 20 minutes unless clips are requested or Phase 5's on-demand worker draw from the frozen export manifest is implemented).
