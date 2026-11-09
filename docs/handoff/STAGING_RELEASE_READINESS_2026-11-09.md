# Staging Release Readiness & Rollout Report (2026-11-09)

## 1. Executive Summary & Deployment Status

- **Status**: **DEPLOYED TO STAGING & PROMOTED TO PRODUCTION (`64570b64c338375b06d3ca1c8c8c4cb4612036e5`)** — All Hosted API, Worker E2E, Interactive Browser Flow, Stuck-Checking Recovery, Provider Email Hook, and Stacked Workspace Scrolling Verified. See `docs/handoff/PRODUCTION_RELEASE_2026-11-09.md` for full production rollout details.
- **Production Status**: **LIVE AT `64570b64c338375b06d3ca1c8c8c4cb4612036e5`** (Railway `8b126a59-1283-44c8-8e50-91a359e05441`, Vercel `dpl_8876aYyp8wWQYuW27TteiALQka8v`, ECS worker `greedymotion-production-worker:2`, Supabase `pylqstxqvucrrzpcjkem` `Before User Created` hook enabled).
- **Candidate Code Commits on `origin/staging`**:
  - `6d60bf5df38d51fbd8d5066a00c3e8f93f3d751d` (`6d60bf5`): Accept live check reports on worker-drawn variants and add RAF tick fallback.
  - `1cffafeca627c18e0d01893428ddb02a0eaec5e8` (`1cffafe`): Fix stuck live scene checking after `init-timeout` and enable storyboard sketch playback while scenes are still being processed.
  - `7fabc68bf136f5b49cc444ba973270ae25236d54` (`7fabc68`): Per-step model routing, all-Gemini planner, two-pane brief, character/Hindi voices, live plate playback, and worker resilience.
- **Deployed Staging Targets**:
  - **Railway Backend (`lively-presence` / `Greedy Motion Backend`)**:
    - Project ID: `5298f20e-3531-44a5-a32e-7b99b0cb5b09`
    - Environment ID (`staging`): `07084322-b9de-41c1-8bd0-225ffa063faf`
    - Service ID (`backend`): `df6c5746-6c6e-4275-897d-75bb0cd6370b`
    - Deployment ID: `3ec47d80-f2a0-465c-8bee-ccf15f3f56b5` (`SUCCESS`, commit `6d60bf5df38d51fbd8d5066a00c3e8f93f3d751d`; prior `3815568e-9a05-48b2-a6af-a8c259760ebc` at `1cffafe`)
    - Public URL: `https://backend-staging-aec6.up.railway.app` (`/healthz` -> `200`, `/readyz` -> `200`)
  - **Vercel Staging Frontend (`greddy-motion/greedy-motion-staging`)**:
    - Deployment ID: `dpl_9V6G4FDpPuTEmYBChgqjcAuijrBv` (`https://vercel.com/greddy-motion/greedy-motion-staging/9V6G4FDpPuTEmYBChgqjcAuijrBv`, `READY`, commit `6d60bf5df38d51fbd8d5066a00c3e8f93f3d751d`; prior `dpl_CeDDjSYQknhiSNDoXmm6eGXVaMX5` at `1cffafe`)
    - Public URL: `https://greedy-motion-staging.vercel.app` (`https://staging.greedymotion.com`)
    - Production Vercel (`greedy-motion`): Untouched.
  - **GitHub Actions CI**:
    - Run `42581734023` on `staging`: `completed / success` (1m21s).
  - **AWS ECS Staging Render Worker (`ap-southeast-1`, Account `369904858685`)**:
    - ECR Image: `369904858685.dkr.ecr.ap-southeast-1.amazonaws.com/greedymotion-staging-worker:7fabc68-130732`
    - Immutable Image Digest: `sha256:8a691103410d927bbf8c595e8c2c0d21589a68ba5f2e16b36d963e405524aab5`
    - Task Definition ARN: `arn:aws:ecs:ap-southeast-1:369904858685:task-definition/greedymotion-staging-worker:21` (8 vCPU / 16 GB ARM64, `RENDER_CONCURRENCY=1`, `PLATE_CONCURRENCY=1`, `WORKER_CONTROL_URL=https://backend-staging-aec6.up.railway.app`)
    - Backend `ECS_WORKER_TASK_DEFINITION`: `greedymotion-staging-worker:21`.

---

## 2. Priority Regression Investigation & Fix: Project `d5be733f-b834-45e6-b469-fb7a8dc63592` Stuck in `Checking`

### 2.1 Authoritative Evidence Captured Before Recovery
Inspection of `app.plate_variants`, `app.plate_check_reports`, `pgboss.job`, Railway staging logs, and browser network/telemetry for project `d5be733f-b834-45e6-b469-fb7a8dc63592` (`"A tiny brass compass and an old sextant on a drafting table argue over which way"`, `illus-blueprint`, `16:9` + `9:16`, 3 scenes) established the exact state prior to recovery:
1. **Scene 0 (`16:9`, `variantId: faf99b5f-b602-4c5c-8a73-a0d7d5cc26b2`)**:
   - Stored DB state: `state = "bundled"`, `stage = "checking"`, `gen = 1`, `rev = 0`, `bundle_digest = "7c893f2d9cf3e7ec917aa5ed97847ed0e5d6111e0342709a4acd73ef18f2148e"`, `updated_at = "2026-11-09T06:16:23.820Z"`.
   - Stored check report in `app.plate_check_reports` (`created_at = "2026-11-09T06:16:32.701Z"`, `host = "worker"`):
     `results: { ok: false, kind: "env", error: "Watchdog timeout (init-timeout) after 2000ms", initRetries: 1 }`, `response: { state: "bundled", fallback: true }`.
2. **Scenes 1 & 2 (`16:9`, `7b4f3fba-765b-4c15-9cc4-1632971b328f` and `d865f90a-804e-4a53-a716-574489036795`)**:
   - Stored DB state: `state = "checked"`, `stage = null`, `live = true`.
3. **Scenes 0, 1 & 2 (`9:16`, `5a857c1f-2819-4628-9746-c5c4ede95223`, `d67f7e9c-8901-4cb1-85ae-980b999a95e2`, `f13b0b6c-62f4-4f86-87bb-01020dca4490`)**:
   - Stored DB state: `state = "bundled"`, `stage = "queued for rendering"`, `timings.retrying = { attempt: 23, reason: "the scene was waiting for a worker" }`, with `plate-render` jobs `a6a29dde-b7fb-4dde-bd7e-93b397b736b2`, `d7537532-21a6-4956-8fd6-153ba2e21522`, and `10d729de-760c-4ecc-a847-a516be138e2d` in `state = "created"`.

### 2.2 Root Causes Identified
1. **`submitCheckReport` Idempotency Deadlock After Transient `kind: "env"` (`backend/src/plates/store.ts`)**:
   - At `06:16:32Z`, while other scenes were concurrently authoring/bundling, Scene 0's initial browser worker `init` hit the 2000ms watchdog (`Watchdog timeout (init-timeout) after 2000ms`), which was reported as `ok: false, kind: "env"`.
   - `submitCheckReport` left `app.plate_variants` in `state = 'bundled', stage = 'checking'` (`response = { state: "bundled", fallback: true }`) and inserted that row into `app.plate_check_reports`.
   - When the user's browser subsequently opened/reloaded the project, Scene 0's browser check **succeeded (`ok: true`)**, enabling the local player (`Ready for review`, `Render · 8.7 tokens`, playback to `0:09 / 0:09`). However, when the browser POSTed `ok: true` to `/v1/projects/:id/plates/:variantId/check`, `submitCheckReport` saw the existing `app.plate_check_reports` row for `(variant_id, gen, bundle_digest, host = 'worker')` and returned `duplicate: true` (`{ state: "bundled", fallback: true }`) without transitioning `app.plate_variants` from `bundled` to `checked`.
   - Similarly, when a variant had already been drawn by the server check-grace worker fallback (`row.state === "drawn"`) and a browser ran a live check (`needsCheck = true` for `drawn` variants with a bundle), `submitCheckReport` rejected `row.state !== "bundled"` with `204 dropped`, causing `PlateLiveStage` to delete the bundle and re-check in a loop.
2. **`reconcilePlates` Blocked by Watchdog-Timeout `kind: "env"` Row (`backend/src/plates/reconcile.ts`, `backend/src/plates/store.ts`)**:
   - Client logic (`canTriggerClipRequestForReason`) intentionally never calls `POST .../clip-request` for a watchdog timeout (`init-timeout`, `frame-timeout`, `check-watchdog`).
   - Meanwhile, the server check-grace query (`reconcilePlates` / `fallbackCheckVariantClipWithClient`) checked `not exists (select 1 from app.plate_check_reports ...)`, which treated the watchdog-timeout `kind: "env"` row as if the client had handled it, preventing `CHECK_GRACE_SECONDS` (180s) fallback from ever queueing `plate-render`.
3. **Indefinite `"under a minute"` ETA on Overdue `checking` Scenes (`backend/src/plates/eta.ts`, `frontend/components/animation-workspace/progress.ts`)**:
   - Both `eta.ts` (`stage === "checking"`) and `progress.ts` (`phase === "checking"`) computed a floor remaining time (`20s` / `5s` -> `{ low: 10..20, high: 10..30 }` -> `"under a minute"`) regardless of how long the scene had been in `checking`, and `PlatePreview` computed `perSceneProgress` / `filmToast` from the raw server `bundled` state even after `liveResolutions` had verified the scene in the browser.
4. **Empty `WORKER_CONTROL_URL` in ECS Task Definition `greedymotion-staging-worker:20`**:
   - Task definition `:20` was registered with `WORKER_CONTROL_URL=""`, causing Fargate tasks launched by `worker_launched` to exit immediately at startup in `createControl()`.

### 2.3 Fixes Implemented & Deployed (`1cffafe` + `6d60bf5` + ECS `:21`)
1. **`backend/src/plates/store.ts` & `backend/src/plates/reconcile.ts`**:
   - `submitCheckReport` now allows a decisive report (`ok: true` or `kind: "code"`) to supersede a prior non-mutating `kind: "env"` (`fallback: true`) report in `app.plate_check_reports` and transition the variant out of `bundled / checking`.
   - `submitCheckReport` accepts browser check reports on `state = 'drawn'` variants (recording `checked_at` / `check_report` / `timings.playback` while preserving `state = 'drawn'` and `clip_key`) instead of returning `204 dropped`.
   - `reconcilePlates` and `fallbackCheckVariantClipWithClient` no longer allow a watchdog-timeout `kind: "env"` report (`init-timeout`, `frame-timeout`, `check-watchdog`, `heartbeat-timeout`) to block `CHECK_GRACE_SECONDS` fallback.
2. **`backend/src/plates/eta.ts` & `frontend/components/animation-workspace/progress.ts`**:
   - Added `CHECKING_TAKING_LONGER_SECONDS = 90`: once a scene has been in `checking` for `>= 90s`, `etaSeconds` is cleared to `null` and the frontend displays `"taking longer than usual"` (`"Checking scene 1 · taking longer than usual"`) instead of promising `"under a minute"` indefinitely.
3. **`frontend/components/plate-preview.tsx` & `frontend/components/plate-live-stage.tsx`**:
   - Synced `effectiveScenesForProgress` and `isEffectiveViewAspectDrawing` with `liveResolutions` so once a scene is verified live in the browser (`mode === "live" && isPlayable && tabState === "checked"`), the top toast and timeline chips immediately reflect `Ready`.
   - Enabled storyboard sketch playback (`canPlaySceneWithSketch` / `activeSceneShowsSketchFallback`) with voiceover, music, SFX, subtitles, and continuous scene-to-scene advance while scenes are still being processed, keeping `.aw-film-toast` visible at the top.
   - Added a 33ms timer fallback (`scheduleNextTick`) alongside `requestAnimationFrame` when `!isDocumentHidden()` so playback and scene transitions continue smoothly even when the window is occluded.
4. **AWS ECS Task Definition `greedymotion-staging-worker:21`**:
   - Registered `arn:aws:ecs:ap-southeast-1:369904858685:task-definition/greedymotion-staging-worker:21` with `WORKER_CONTROL_URL="https://backend-staging-aec6.up.railway.app"` and updated `ECS_WORKER_TASK_DEFINITION=greedymotion-staging-worker:21` on Railway staging.

### 2.4 Original Project `d5be733f-b834-45e6-b469-fb7a8dc63592` Recovery & End-to-End Verification
- **Automatic Recovery (No Manual DB Edits)**:
  - All 6 variants (`0:16:9`, `0:9:16`, `1:16:9`, `1:9:16`, `2:16:9`, `2:9:16`) recovered automatically:
    - `faf99b5f-b602-4c5c-8a73-a0d7d5cc26b2` (`0:16:9`): `state = "drawn"`, `stage = null`, `clip_key = "plates/d5be733f-b834-45e6-b469-fb7a8dc63592/16x9/0/g1/bundles/6c88f0f993664a200df59ba2/clip-a1.mp4"`, browser check report updated to `ok: true, response: { state: "checked" }`.
    - `7b4f3fba-765b-4c15-9cc4-1632971b328f` (`1:16:9`) & `d865f90a-804e-4a53-a716-574489036795` (`2:16:9`): `state = "checked"`, preserved.
    - `5a857c1f-2819-4628-9746-c5c4ede95223` (`0:9:16`), `d67f7e9c-8901-4cb1-85ae-980b999a95e2` (`1:9:16`), `f13b0b6c-62f4-4f86-87bb-01020dca4490` (`2:9:16`): `state = "drawn"`, `stage = null`, browser check reports recorded as `ok: true, response: { state: "checked" }`.
- **Browser UI & Playback Verification (`tab_f67f761a-d5f1-4a95-800e-a699b1384fbb`)**:
  - Reloaded `https://greedy-motion-staging.vercel.app/studio?p=d5be733f-b834-45e6-b469-fb7a8dc63592&step=2`:
    - `toastVisible: false`, `bannerVisible: false`, all 3 scene tabs show `Ready` (`01 Ready That way`, `02 Ready No, that way`, `03 Ready Light falls`).
    - All 3 scenes in `16:9` and all 3 scenes in `9:16` report `mode: "live", reason: "ok", state: "checked"` in `window.__plateLiveTelemetry.decisions`.
    - Full playback verified from `0:00 / 0:09` (`Scene 1 · That way`) -> `0:03 / 0:09` (`Scene 2 · No, that way`) -> `0:06 / 0:09` (`Scene 3 · Light falls`) -> `0:09 / 0:09` (`naturalEndCleanupTriggered: true`, `261` frames rendered).
- **Final Multi-Ratio Render Verification (`step=3` `FinalView`)**:
  - Triggered final render on `d5be733f-b834-45e6-b469-fb7a8dc63592` (`8.7` tokens):
    - **`16:9` Final Render (`render_jobs.id = c151423f-9dfe-4384-b9e0-b57ba214c94f`)**: `state = "ready"`, `270/270` frames, `1920x1080`, `duration = 9s`, `readyState = 4`, `error = null`.
    - **`9:16` Companion Export (`plate_exports.id = 0427c0b0-108b-4405-9dcf-6b947cd717c5`)**: `state = "ready"`, `progress = 100`, `1080x1920`, `duration = 9s`, `readyState = 4`, `error = null`.

---

## 3. All-Gemini Model Routing Configuration & Safe Rollback Procedure

### 3.1 Active Staging Environment Variables
```env
MODEL_DEFAULT=gemini:gemini-3.8-flash
MODEL_SCRIPT=gemini:gemini-4-argon
EFFORT_SCRIPT=low
MODEL_REWRITE_BEAT=gemini:gemini-4-argon
EFFORT_REWRITE_BEAT=low
MODEL_ELEMENT_EDITS=gemini:gemini-4-argon
EFFORT_ELEMENT_EDITS=low
MODEL_DIRECTOR=gemini:gemini-3.8-flash
EFFORT_DIRECTOR=medium
MODEL_SCENE_WRITER=gemini:gemini-3.8-flash
MODEL_FRAME_SKETCH=gemini:gemini-3.8-flash
MODEL_MOTION=gemini:gemini-3.8-flash
MODEL_SCREENSHOT=gemini:gemini-3.8-flash
MODEL_FORMAT_FILL=gemini:gemini-3.8-flash
MODEL_PRO_ASSISTANT=gemini:gemini-3.8-flash
MODEL_SKILL_ROUTING=gemini:gemini-3.8-flash
MODEL_PLANNER_FILL=gemini:gemini-3.8-flash
ECS_WORKER_TASK_DEFINITION=greedymotion-staging-worker:21
```

### 3.2 Safe Rollback Procedure (No Force-Push or Destructive Reset)
1. **Model Routing Rollback**: Remove `MODEL_*` and `EFFORT_*` variables on Railway staging (`environmentId=07084322-b9de-41c1-8bd0-225ffa063faf`). `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL=claude-opus-5-5` remain in place.
2. **Worker Task Definition Rollback**: Set `ECS_WORKER_TASK_DEFINITION=greedymotion-staging-worker:19` on Railway staging.
3. **Code Rollback**: Create a forward revert commit on `staging` or redeploy the previous deployment in Railway and Vercel dashboards.

---

## 4. Complete Staging Verification Summary

| Check | Status | Evidence |
|---|---|---|
| **Health, Readiness & Boot Routing Table** | **PASS** | `GET /healthz` -> `200`, `GET /readyz` -> `200`. All 17 steps route to `gemini:gemini-4-argon`, `gemini:gemini-3.8-flash`, or `gemini:gemini-2.5-flash`. |
| **Fresh Plate Film Full E2E (`tools/staging/plates-smoke.mjs`)** | **PASS** | Project `50e40d60-a81c-4a8e-a7dc-1a97d388b5aa`, Job `1361b265-fa2b-4257-ac08-9436316e7d79` (`1920x1080`, `21.00 s`, `630 frames`, H.264). |
| **Starter-Template Render Planner (`planner` step)** | **PASS** | Project `83275a4a-a016-4e43-ab31-b4857c94a833` (`stat-highlight` template) on `gemini:gemini-3.8-flash` (`ms=9338`). |
| **Format Fill (`formatFill` step)** | **PASS** | `POST /v1/formats/gm-velocity-sting/render` -> Job `926565da-e19d-44e3-9d9f-2462f1de0848` on `gemini:gemini-3.8-flash` (`ms=11229`). |
| **Screenshot Vision Analysis (`screenshot` step)** | **PASS** | `POST /v1/projects/da50b74c-a628-4b70-80dd-2221f99295fb/screenshots` -> `776787bb-8d5a-4adb-802f-3dbdeb1535d6` on `gemini:gemini-3.8-flash` (`ms=6107`). |
| **Pro Assistant & Skill Routing (`skillRouting` + `proAssistant`)** | **PASS** | `POST /v1/projects/da50b74c-a628-4b70-80dd-2221f99295fb/pro/assist` -> `200 OK` (`stage="design"`, `ms=72189`) on `gemini:gemini-3.8-flash`. |
| **Interactive Studio Flow + Stuck-Checking Recovery (`d5be733f-b834-45e6-b469-fb7a8dc63592`)** | **PASS** | Two-pane `FilmBrief`, `VoicePickerModal` (`Compass -> Puck`, `Sextant -> Aoede`), storyboard insert/remove/undo, `Keep 8s`, Step 3 live `16:9` + `9:16` checks & playback, and Step 4 `16:9` (`c151423f-9dfe-4384-b9e0-b57ba214c94f`) + `9:16` (`0427c0b0-108b-4405-9dcf-6b947cd717c5`) final MP4 renders. |
| **Free-Tier Watermark Note** | **VERIFIED IN FIXTURES / PRO ACCOUNT ON STAGING** | The signed-in staging browser account (`tab_f67f761a-d5f1-4a95-800e-a699b1384fbb`) is on the `Pro` tier (`PLANS.pro.watermark === false`), so its renders are intentionally unwatermarked; the Free-tier 4-second alternating stacked watermark (`t=1s` left, `t=5s` right, `t=9s` left) is verified in automated worker assembly tests (`worker/test/plates-assemble.mjs`). |
