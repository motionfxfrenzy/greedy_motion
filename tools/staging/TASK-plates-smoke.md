# Task for the coding agent: a staging/production smoke script for the plates film path

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

You work **only** in the worktree `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-smoke` (branch `codex/staging-smoke`, based on commit `88d4efa`). Another coding agent is working at the same time in `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes`; never read its uncommitted files as truth and never write there.

## Why
Staging runs the new plates pipeline (frozen export manifest schema 2, worker-side drawing, clip cache, job control with no worker DB access), but a **plate film has never gone through it on staging with the real model and real R2**. The existing acceptance harnesses (`scripts/plates-e2e/run.mjs`, `tools/phase2/e2e/live-e2e.mjs`) cheat for speed: they **seed projects directly into Postgres** (`seedProject` in `scripts/plates-e2e/lib.mjs`) and inspect the database. On staging and production we have no database access, only the public HTTPS API as a normal signed-in user. We need one script that drives the **same API calls the real frontend makes**, from an empty account to a downloaded MP4, and asserts everything that can be asserted from outside.

## Read first
1. `docs/HANDOFF_2026-11-05_LIVE_SCENES.md` (whole file; sections 2, 6, 9 item 2 are the context for this task).
2. `docs/LIVE_SCENES_PLAN.md` sections 3, 9, 11 (API), 21, 24; `docs/phase5/5-report.md` (frozen manifest, refunds, idempotency, the L to T scenarios); `docs/JOB_CONTROL.md` (only to understand job states).
3. Frontend, to copy the **real call sequence** of a plates film: `frontend/lib/api.ts` (`createProject`, `draftScriptProject`, `streamScript`, `planProject`, `streamScriptVoice`, `streamScriptAnimate`, `getPlates`, `drawPlates`, `addPlateComment`, `fixPlates`, `savePlateSubtitles`, `getRenderQuote`, `renderProject`, `getRenderJob`/`watchRenderJob`, `requestPlateExport`, `plateExportUrl`, `plateClipUrl`, `getMyTokens`, `outputUrl`), and the components that call them in the plates flow: `frontend/components/studio.tsx`, `plate-preview.tsx`, `script-style.tsx`, `frontend/components/animation-workspace/`, `FinalView`. Find out exactly which brief fields make a project a **plates** project (an `illus-*` look; check `packages/contracts` and `backend/src/plates/inputs.ts`), what order the UI calls things in, and what each streaming endpoint sends (SSE/NDJSON parsing).
4. Backend routes that serve those calls: `backend/src/server.ts` (project and render routes, auth, the `Idempotency-Key` header), `backend/src/plan/routes.ts`, `backend/src/plates/routes.ts`, `backend/src/render/*` (render quote, render job, output redirect), `backend/src/tokens/store.ts` (spend/refund shape as seen by `getMyTokens`).
5. The existing harnesses for helpers and assertions you can reuse in spirit (do not import their DB helpers): `scripts/plates-e2e/lib.mjs`, `run.mjs`, `tools/phase2/e2e/live-e2e.mjs` scenarios L to T, `scripts/plates-e2e/llm-stub.mjs` (what the stub answers for script, plan and plate authoring calls).

## What to build
Create `tools/staging/plates-smoke.mjs` (plain Node 20+, ESM, built-in `fetch` only; no new npm dependencies; no `pg`, no S3 client, no database or object-store access of any kind).

### Configuration (environment variables only)
- `SMOKE_API` (required): API base, e.g. `http://localhost:4100` or `https://backend-staging-aec6.up.railway.app`. Handle the `/v1` prefix exactly as `frontend/lib/api.ts` does (a doubled `/v1` was a real bug once).
- `SMOKE_TOKEN` (optional): bearer token sent as `Authorization: Bearer ...`. Absent = local `AUTH_MODE=none` stack. **Never print the token**, never write it to a file, never put it in a URL; redact it in any logged request.
- `SMOKE_LOOK` (default a cheap `illus-*` look), `SMOKE_BEATS` (default 3, the smallest film the flow allows), `SMOKE_ASPECT` (default `16:9`), `SMOKE_OUT` (directory for the MP4 and the JSON report, default `tools/staging/out/<timestamp>`), `SMOKE_STEPS` (comma list to run a subset, see below), `SMOKE_MAX_TOKENS` (abort before Render if the quote is above this; default a small number, e.g. 20), `SMOKE_KEEP` (default off: archive the project at the end via `updateProject(..., { archived: true })` if the API supports it; never hard-delete).

### Steps (each a named function, each logs one line `step <name> ok <ms>` or `step <name> FAIL <reason>`; stop at the first failure unless `--continue`)
1. `health`: API reachable; `getMyTokens` works (auth works); record the token balance.
2. `create`: create a plates project with a short fixed brief (a two-sentence topic in the script; pick the look/aspect from env) exactly as the UI does.
3. `script`: draft the script through the same endpoint the UI uses (streaming or not, whichever the UI calls); assert `SMOKE_BEATS` beats (or the closest the API produces; record it).
4. `plan`: storyboard/plan as the UI does; then voice and music generation as the UI does (`streamScriptVoice` or `generatePlanAudio`; follow the UI). Assert the plan has beats with timing.
5. `animate`: start plates drawing/authoring (`drawPlates` or `streamScriptAnimate`, whichever the plates UI calls); poll `getPlates` (with the same interval the UI uses, and a timeout, default 15 min) until every scene reaches its ready state (`checked`/`drawn`/whatever the UI treats as playable; read `backend/src/plates/store.ts`); fail with the scene's error if any scene is `failed`.
6. `preview-assets`: for every scene, fetch what the browser would fetch for preview: the live bundle (the bundle route from plan section 11; check status 200, `content-type`, size > 0, and that it is a single HTML document) and, for at least one scene, the clip fallback (`plateClipUrl` / the clip-request route) once; record sizes and times. Do **not** run any canvas code.
7. `comment`: add one timed comment (`addPlateComment` at 1.0 s, a harmless instruction like "make the sky slightly warmer"), apply it as the UI does (`fixPlates`), wait for that scene's revision to be ready, assert the scene's revision/`bundleDigest` changed and other scenes' did not.
8. `quote`: `getRenderQuote`; abort (not fail) if above `SMOKE_MAX_TOKENS`.
9. `render`: `renderProject` with an `Idempotency-Key` header (a random UUID); immediately send the **same** request again with the **same** key and assert it returns the same job and does not spend twice (balance from `getMyTokens` drops exactly once by the quoted amount). Poll the job (same way as `watchRenderJob`, but plain polling is fine) to a terminal state, default timeout 20 min.
10. `download`: fetch the output. **The output route answers with a redirect to the MP4 when ready** (do not expect JSON; the previous manager's poller broke on exactly this): follow it, save `film.mp4` to `SMOKE_OUT`, assert size > 100 kB and that the first bytes are an MP4 (`ftyp` box at offset 4). If `ffprobe` is on PATH, record width, height, duration, frame count, codec; otherwise skip that check and say so.
11. `report`: write `SMOKE_OUT/report.json` (api base without token, project id, job id, per-step status and ms, balances before/after, quote, scene count, bundle sizes, clip size, mp4 facts) and print a final line exactly `SMOKE PASS <report path>` or `SMOKE FAIL <step> <report path>`.

Things you cannot see from outside (zero `plate-render` jobs, manifest schema): assert what the API exposes (job type/fields, plate status fields) and list the rest in the report as "checked by the manager in the DB/logs".

Optional, behind `SMOKE_STEPS=refund` only (never by default): a refund check that is triggerable from the public API without breaking anything (e.g. cancel a render immediately and assert the documented cancel semantics; read `docs/phase5/5-report.md`: user cancel is **not** refunded, failures are). If no safe public trigger exists, write that down and skip it.

### How to test it (no Docker)
**You must not start, stop, build or rebuild any Docker container or compose service**, including the `plates-e2e` profile: the compose project name is fixed (`videosaas-local`), so any `up` from your worktree would replace the containers the other agent is using. Instead:
- Write `tools/staging/mock-api.mjs`: a tiny in-process HTTP server (Node `http`) that implements just enough of each route the smoke script calls, with response shapes **copied from the real backend code** (cite the source file/function for each shape in a comment), including: streaming responses in the real format, a plate status that goes through the real states over a few polls, the idempotent render (same key = same job, spend once), the output route answering **302 to an MP4** (serve a tiny valid MP4: write the minimal `ftyp`+`moov` bytes yourself, or generate one with `ffmpeg` if it is on PATH, into `tools/staging/fixtures/`), and failure switches (`?fail=animate`, `fail=render`, `fail=auth`, a scene that goes `failed`).
- Write `tools/staging/plates-smoke.test.mjs` that starts the mock on a random free port (not 4100, 4000, 3000, 8766, 55432, 58787, 59000) and runs the smoke script against it: the happy path passes; each failure switch produces `SMOKE FAIL <right step>`; a double render with the same key spends once; the token never appears in stdout/stderr or the report (pass a sentinel token and grep for it).
- Run `node --check` on every file and the test file to green.
- The manager will run the script against the real local plates-e2e stack and then staging. Make that easy: put the exact commands in the report.

## Rules (hard limits)
- Write only under `tools/staging/` and the report path below. Do not modify any other file in the repo (if the real API is missing something the smoke needs, write it down in the report instead of changing backend/frontend code).
- No Docker (see above). Do not touch the containers `videosaas-local-postgres-1` or `videosaas-local-worker-1`. No database connections at all.
- Do not call staging, production, Railway, Vercel, AWS, Cloudflare, Supabase or any real model API. No network except `localhost` to your own mock.
- Do not read secret files (`.env*`, `infra/aws/.env*`, `.env.credentials`, `*accessKeys*`, the scratchpad token files). The script takes the token from the environment only.
- No `git commit`, `git push`, branch changes, or deploys. The manager commits.
- No new npm dependencies; no edits to any `package.json` or lockfile.
- Do not stop or interfere with any other process (OpenCode sessions, dev servers, the Python server on port 8766).

## Deliverable
`docs/staging/plates-smoke-report.md` in this worktree with: what you built (files, line counts), the exact real-frontend call sequence you copied (function -> method + path -> which component calls it, in order), every response shape the mock fakes with its source citation, test results (paste the test output summary), anything in the real API that made a step impossible or awkward from outside, open questions for the manager, and the exact commands to run against (a) the local plates-e2e stack (`SMOKE_API=http://localhost:4100`, no token) and (b) staging (`SMOKE_API=https://backend-staging-aec6.up.railway.app SMOKE_TOKEN=...`). End your final message with exactly one line: `DONE docs/staging/plates-smoke-report.md`.
