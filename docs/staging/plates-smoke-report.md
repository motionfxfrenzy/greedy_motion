# Plates smoke script: report

Worktree `VideoSaaS-smoke`, branch `codex/staging-smoke`. Nothing committed. No Docker, no database, no network except the mock on `127.0.0.1`/`localhost`.

## 1. What was built

| File | Lines | Purpose |
| --- | --- | --- |
| `tools/staging/plates-smoke.mjs` | 627 | The smoke script (Node 20+, built-in `fetch`, no dependencies). |
| `tools/staging/mock-api.mjs` | 314 | In-process mock of every route the script calls, with failure switches. Also runnable alone (`MOCK_PORT`, `MOCK_FAIL`, `MOCK_MODE`, `MOCK_TOKEN`). |
| `tools/staging/plates-smoke.test.mjs` | 216 | `node:test` suite: starts the mock on a random free port and runs the script as a child process. |
| `tools/staging/fixtures/film.mp4`, `clip.mp4` | 452 kB, 85 kB | Real H.264 files made with ffmpeg (1920x1080, 72 frames; 640x360). The mock falls back to a synthetic non-decodable MP4 if they are missing (then run with `SMOKE_FFPROBE=off`). |

Configuration (environment only): `SMOKE_API` (required; a trailing `/v1` or `/` is stripped, so `/v1` is never doubled), `SMOKE_TOKEN`, `SMOKE_LOOK` (default `illus-blueprint`), `SMOKE_BEATS` (3), `SMOKE_ASPECT` (16:9), `SMOKE_OUT` (default `tools/staging/out/<timestamp>`), `SMOKE_STEPS`, `SMOKE_MAX_TOKENS` (20), `SMOKE_KEEP`. Extras I added: `SMOKE_AUDIO` (`voiceover` default, `music|both|none`), `SMOKE_DURATION`, `SMOKE_PROJECT` (reuse an existing project for a subset of steps), `SMOKE_POLL_MS` (3000), `SMOKE_*_TIMEOUT_MS` (PLAN 5 min, STREAM 5 min, ANIMATE 15 min, CLIP 10 min, RENDER 20 min), `SMOKE_FFPROBE=off`, flag `--continue`.

Output: one line per step `step <name> ok <ms>` / `step <name> FAIL <reason>`; the last line is `SMOKE PASS <report.json>` or `SMOKE FAIL <step> <report.json>` (exit 0 / 1). Third outcome I added: a quote above `SMOKE_MAX_TOKENS` prints `step quote ABORT ...` and ends `SMOKE ABORT quote <report.json>` (exit 3, nothing spent). `out/` is not git-ignored (I may only write under `tools/staging/`); do not `git add` it.

The bearer token is sent only to the API's own origin (never to the presigned object-store link), never printed (every output line goes through `redact()`, which also masks `?t=` and `Bearer ...`), never written to the report, never put in a URL. The media token (`GET /v1/media-token`, a different short-lived token the browser puts in `?t=`) is used for the clip and the final MP4 exactly as the UI does, and is masked in output.

## 2. Real-frontend call sequence that was copied

Plates project = brief `look` starting `illus-` (`ScriptBrief.look`, `packages/contracts/src/beat-plan.ts` `parseScriptBrief`; `isPlateLook` in `backend/src/plates/inputs.ts` also needs `PLATE_PIPELINE=worker` and a style in `packages/plate-engine/styles.json`). The UI decides "plate" with `getPlates().available` (`studio.tsx` `plateKnown`/`isPlateStyle`).

| # | Smoke step | Function (`frontend/lib/api.ts`) | Method + path | Called by |
| --- | --- | --- | --- | --- |
| 1 | health | `getMyTokens` | `GET /healthz`, `GET /v1/me/tokens` | `beat-storyboard.tsx`, account menu |
| 2 | create | `createProject`, `updateProject` | `POST /v1/projects` (201), `PUT /v1/projects/:id` | `studio.tsx` `ensureProject`, `writeScript` |
| 3 | script | `streamScript` | `POST /v1/projects/:id/script/stream` (SSE `{t}`... `{done,beats,notes,flags,ms}` or `{error}`) | `studio.tsx` `writeScript` |
| 4a | plan | `planProject` + poll `getProject` | `POST /v1/projects/:id/plan` (202 `{project}`), `GET /v1/projects/:id` until `planning` clears and `beatPlan` exists (or `planning.status "failed"`) | `studio.tsx` `buildStoryboard`, `watching` effect |
| 4b | plan | `streamScriptVoice` | `POST /v1/projects/:id/script/voice` (SSE `start`, `take`, `take-error`, `music`, `music-error`, `done`) | `studio.tsx` `recordVoice` / `confirmScript` |
| 4c | plan | `getComposition` | `GET /v1/projects/:id/composition` (`beatTimes`, `durationSeconds`, `readiness`) | `beat-storyboard.tsx` |
| 5a | animate | `streamScriptAnimate` | `POST /v1/projects/:id/script/animate` (SSE `stage`, `frame`, `voice`, `music`, `motion`, `done` or `error`) | `studio.tsx` `startBrowserAnimation` (the Render click on the script page) |
| 5b | animate | `ensureMediaToken`, `getPlates`, `drawPlates` | `GET /v1/media-token`, `GET /v1/projects/:id/plates`, `POST .../plates/draw` (202) only if not running and a scene is not done, then poll `GET .../plates` (3 s; 1.5 s in live) | `plate-preview.tsx` mount effect |
| 6 | preview-assets | (live client, `frontend/lib/live/api`) | `GET .../plates/:variantId/bundle`, then GET of the returned `url`; `POST .../plates/:variantId/clip-request` (if no clip yet); `GET .../plates/:index/clip?aspect=&t=<media token>` (302) then the link | `PlatePlayer` / `plateClipUrl` |
| 7 | comment | `addPlateComment`, `fixPlates`, `getPlates` | `POST .../plates/comments` (201), `POST .../plates/fix` (202), poll | `plate-preview.tsx` |
| 8 | quote | `getRenderQuote` | `GET /v1/projects/:id/render/quote` | `studio.tsx` effect (plateTokens) |
| 9 | render | `renderProject` (+ the header the UI does not send yet) | `POST /v1/projects/:id/render` with `Idempotency-Key`, then `GET /v1/render-jobs/:id` (`getRenderJob`, the poll fallback of `watchRenderJob`) | `studio.tsx` `submit` |
| 10 | download | `outputUrl`, `plateExportUrl` style | `GET /v1/renders/:id?t=` (302 to the MP4, `server.ts`) | `PlateFinal` / `FinalView` |

Skipped from the UI sequence on purpose: `script/frames` (`streamFrames`, background reference sketches; `script/animate` draws any missing ones), `savePlateSubtitles`, `requestPlateExport` (free companion export; not part of the paid render), `approveProject`.

## 3. Mock shapes and sources

Each route carries a source comment in `mock-api.mjs`.

| Route | Shape faked | Source |
| --- | --- | --- |
| `GET /healthz` | `{status:"ok",service:"backend"}` | `backend/src/server.ts` line 64 |
| `GET /v1/me/tokens` | `{remaining, plan, free{granted,used,remaining}, packs{remaining}, recent[{id,amount,kind,reason,pool,projectId,createdAt}]}` | `tokens/store.ts` `tokenSummary`, `frontend/lib/api.ts` `getMyTokens` |
| `GET /v1/media-token` | `{token, expiresAt}` | `media-links.ts` `mediaToken` |
| `POST /v1/projects` | 201 project `{id,ownerId,name,state:"Ready to create",createdAt,updatedAt,request,screenshots:[],comments:[]}` | `projects/store.ts` `createProject` |
| `GET /v1/projects/:id` | project plus `brief`, `beatPlan`, `planning` (cleared when the plan lands) | `server.ts` line 202, `store.ts` `updateProjectPlan` |
| `POST script/stream` | SSE `data: {"t":..}` blocks, last `{done:true,beats[{keyword,visual,onScreen,line}],notes,flags,ms}` or `{error}` | `plan/routes.ts` line 255 |
| `POST plan` | 202 `{project}` with `planning:{status:"running",startedAt}` | `plan/routes.ts` line 725 |
| `POST script/voice` | SSE `start`, `take{index,file,seconds,progress}`, `music`, `done{progress,failed,project}`; 503 `audio_unavailable` without a Gemini key | `plan/routes.ts` line 363 |
| `GET composition` | `{engine,canvas,durationSeconds,beatTimes,audio,readiness,...}`; 409 `no_plan` | `plan/routes.ts` line 937 |
| `POST script/animate` | SSE `stage`, `frame`, `motion`, `done{progress,project}`, `{type:"error"}` | `plan/routes.ts` line 521 |
| `GET plates` | `{available,look,mode,scenes[{index,keyword,state,seconds,frames,sig,rev,variantId,bundleDigest,live,error,variants}],comments,subtitles,running,drawnAspects,drawingAspects}`; states queued, authoring, bundled, rendering, drawn, failed; in clip mode `bundled` is shown as `rendering` | `plates/service.ts` `plateStatus`, `shown`, `viewOf` |
| `POST plates/draw` | 202 status; 409 without a script | `plates/routes.ts`, `service.ts` `startPlates` |
| `POST plates/comments` | 201 `{id(12 hex),at,scene,sceneAt,body}` | `service.ts` `addPlateComment` |
| `POST plates/fix` | 202 status; 409 "Wait for the scenes that are being drawn." while a target scene is open; `rev` rises, state back to queued | `service.ts` `fixPlates`, `store.ts` `reviseScene` |
| `GET plates/:variantId/bundle` | `{url,expiresAt,bundleDigest,manifest,params}`; 404 unless state is bundled/checked/rendering/drawn; link on a different origin | `plates/routes.ts` bundle route |
| `POST plates/:variantId/clip-request` | 202 `{state:"rendering"}`; 409 `invalid_state` | `plates/routes.ts`, `store.ts` `requestVariantClip` |
| `GET plates/:index/clip` | 302 to an object-store link; 404 until a clip exists; accepts `?t=` | `plates/routes.ts`, `auth.ts` `mediaGets` |
| `GET render/quote` | `{seconds,tokens,parts,ready,material,balance,enough}` | `render/quote.ts` `quoteFrom` |
| `POST render` | 202 `RenderJob`; same `(project, Idempotency-Key)` returns 202 with the existing job before any spend; 400 `script_unconfirmed` without a storyboard | `server.ts` line 261, `render/quote.ts` hook |
| `GET render-jobs/:id` | `RenderJob` advancing queued, planning/directing, rendering/waiting, frames, encoding, ready (or failed with refund) | `server.ts` line 429, `contracts` `RenderJob` |
| `GET renders/:id` | 302 to the MP4 when ready; 503 `video_unavailable` otherwise | `server.ts` line 475 |
| `/obj/*` | stand-in for presigned R2 links: no auth allowed (400 if an `Authorization` header arrives) | n/a |

Failure switches (`startMock({fail})` or `POST /__control`): `auth`, `script`, `plan`, `voice`, `animate`, `scene-failed`, `no-bundle`, `bundle-not-html`, `fix-same`, `fix-spill`, `render`, `double-spend`, `not-mp4`, `quote-high`; option `mode: "live"`. The task asked for `?fail=` query switches; I used constructor options and a `/__control` endpoint instead because the smoke script's requests are fixed.

## 4. Test results

```
node --check tools/staging/plates-smoke.mjs tools/staging/mock-api.mjs tools/staging/plates-smoke.test.mjs   -> all ok
node --test tools/staging/plates-smoke.test.mjs
ℹ tests 25   ℹ pass 25   ℹ fail 0   (about 7 s)
```

Covered: happy path (all 11 steps ok, `SMOKE PASS`, exit 0, mock spent once for four render requests with one key, balance 40 to 34, project archived, bearer never sent to the object-store origin, film is a real 1920x1080 H.264 file with frames checked by ffprobe); live mode (scenes stop at `bundled`, clip fallback exercised); `SMOKE_API` ending in `/v1/`; 13 failure switches each ending `SMOKE FAIL <right step>` with no later step run; failed render says whether tokens came back; `double-spend` caught at render; quote above max ends `SMOKE ABORT quote` with zero spend; wrong token fails at health; sentinel token absent from stdout, stderr and `report.json` in the success and every failure run; `SMOKE_STEPS=refund`; `SMOKE_PROJECT` resume; `--continue`; mock never on ports 4100, 4000, 3000, 8766, 55432, 58787, 59000.

Not run by me (rules): anything against the local plates-e2e stack, staging or production.

## 5. What was impossible or awkward from outside

1. The real UI does not send an `Idempotency-Key` (`renderProject` in `api.ts`). The smoke sends one, so it proves the backend feature, not what the UI exercises today.
2. No public render cancel route exists (grep of `backend/src`: cancel is internal to the worker control path). The `refund` step therefore only proves that a refused render (empty project, `script_unconfirmed`) charges nothing. Refund after worker failure or user cancel must be checked in `app.token_ledger` by the manager.
3. Live mode (`PLATE_LIVE_PREVIEW=on`): the browser performs the scene check (`host:"worker"` Web Worker), so with no browser scenes stay `bundled`. The script treats `bundled` as authored when `status.mode === "live"` (the final render only needs authored bundles, `waitForAuthoring`), requests a clip for scene 1 via `clip-request` and waits for `drawn`, because `fixPlates` refuses while the commented scene is `bundled`. A real `checked` state cannot be produced from outside.
4. The plate status does not expose a job type, a manifest schema or a `plate-render` job count. The render job exposes only `state`, `stage`, `progress`, `attempt`, `revision.look`. Listed in the report JSON `notChecked`.
5. The local plates-e2e stack answers every model call with plate code (`llm-stub.mjs`), so the `script` and `plan` steps cannot pass there, and `script/voice` needs `GEMINI_API_KEY`. Use `SMOKE_PROJECT` with a project seeded by `scripts/plates-e2e/lib.mjs seedProject` and `SMOKE_STEPS=health,animate,...` (command in section 7).
6. The bundle's content type is only a warning (a store may serve `application/octet-stream`); the body must be exactly one HTML document or the step fails. An external `<script src>` is a warning.
7. `getPlates` shows a scene's `bundleDigest` as `null` until bundled; if both digests are null the comment step falls back to the `rev` number and warns.
8. The real clip route needs a bearer or a media token; the script uses the media token (as the browser does). In local `AUTH_MODE=none` this works with no token at all.

## 6. Open questions for the manager

1. Default look: I chose `illus-blueprint` (simple line scenes, used in the e2e suites). Is there a cheaper or more reliable look on staging?
2. Should `ABORT` (quote above `SMOKE_MAX_TOKENS`) be a third final line (`SMOKE ABORT quote ...`, exit 3), as built, or `SMOKE FAIL quote`?
3. Default `SMOKE_AUDIO=voiceover` costs real TTS per scene on staging. Prefer `none` as the default, or keep voice because the film must be as users make it?
4. The script archives the project at the end (`PUT {archived:true}`); the playground user's tokens are spent for real (about 6 tokens for 3 scenes of 4 s is the mock's number; read the real quote). Is a dedicated test user with a known balance planned?
5. Companion export (`requestPlateExport`) and the subtitles route are not covered; add them as optional steps?
6. Live-mode browser check (`/check` route) is out of scope without a browser; confirm that step 3 of the handoff (headless Chrome) covers it.

## 7. Commands

(a) Local plates-e2e stack (you start it; I did not). The stub cannot write scripts, so seed a project and resume:

```bash
# seed (uses the e2e Postgres through the existing harness helper, not this script):
#   node -e 'import("./scripts/plates-e2e/lib.mjs").then(async m=>{const p=await m.seedProject({look:"illus-blueprint",beats:3,audio:false});console.log(p.id);process.exit(0)})'
SMOKE_API=http://localhost:4100 SMOKE_PROJECT=<seeded-project-id> SMOKE_AUDIO=none SMOKE_KEEP=1 \
SMOKE_STEPS=health,animate,preview-assets,comment,quote,render,download,report \
node tools/staging/plates-smoke.mjs
```

If the local stack ever has real script/plan models, the full flow is simply `SMOKE_API=http://localhost:4100 SMOKE_AUDIO=none node tools/staging/plates-smoke.mjs`. Add `SMOKE_STEPS=...,refund` only when you want the refund check.

(b) Staging, full flow, real model and real R2 (spends tokens; quote capped at 20 by default):

```bash
SMOKE_API=https://backend-staging-aec6.up.railway.app SMOKE_TOKEN="$(cat /path/to/token-file)" \
SMOKE_AUDIO=voiceover SMOKE_MAX_TOKENS=20 node tools/staging/plates-smoke.mjs
```

Resume after a failure at render (same project, no new spend until `render`): `SMOKE_PROJECT=<id from report.json> SMOKE_STEPS=health,quote,render,download,report`.

Self-test (no network): `node --test tools/staging/plates-smoke.test.mjs`. Mock alone: `MOCK_PORT=5599 node tools/staging/mock-api.mjs`.
