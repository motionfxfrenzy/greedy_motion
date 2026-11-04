# Task for the coding agent: phase 2 end-to-end acceptance test (local stack, live preview on)

You work for a manager (Claude) who reviews everything you produce. Read this whole file first. Do what it says, nothing more. If a rule blocks you, stop that part and say so in the report; never work around a rule.

## Goal

Phases 2a (backend) and 2b (browser player) were built and unit-tested separately. Prove that they work **together**, end to end, on the local production-shaped stack, with `PLATE_LIVE_PREVIEW=on`, before any staging trial. Find real bugs. Fix only what this brief allows; report the rest.

## Read first

- `docs/LIVE_SCENES_PLAN.md`: sections 0b, 7, 10, 11, 17, 20, 21.
- `docs/phase2/2a-report.md` (routes and shapes) and `docs/phase2/2b-report.md` (module, risks; especially the open question about CORS for the browser fetching a presigned bundle URL).
- The existing acceptance harness for the pipeline: `scripts/plates-e2e/run.mjs`, `scripts/plates-e2e/lib.mjs` (helpers: `api`, `seedProject`, `variants`, `waitFor`, `redirectOf`, `compose`, `resetStub`, `stubStats`), `scripts/plates-e2e/llm-stub.mjs`, and the `plates-e2e` profile in `compose.yaml` (services `objectstore` (S3Mock), `llm-stub`, `plate-api`, `plate-worker`; database `plates_e2e`; API on `http://localhost:4100`).
- `frontend/lib/live/` (the player, host, API client, support gate) and `frontend/test/live-chrome-integration.mjs` (how to bundle `lib/live/index.ts` with esbuild and drive headless Google Chrome through `playwright-core`).
- `backend/src/plates/routes.ts`, `store.ts`, `reconcile.ts`, `service.ts`.

## What to build

All new files go under `tools/phase2/e2e/`.

1. **`compose.live.yaml`**, a compose override used as `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e ...`. It sets `PLATE_LIVE_PREVIEW=on` on `plate-api` and `plate-worker`, and nothing else. Do NOT edit `compose.yaml`. Rebuild `plate-api` and `plate-worker` images from this worktree so they contain the 2a code (`--build`). The model API stays the stub.
2. **`live-e2e.mjs`**: a Node script (reuse `scripts/plates-e2e/lib.mjs` by import; do not edit it) that runs the scenarios below against the running stack and prints one line per assertion plus a final summary; it exits non-zero on any failure. Add a small browser helper that loads a test page in headless Google Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `playwright-core` from the root `node_modules`), serving that page from a localhost-only static server on a free `127.0.0.1` port, with the bundled `frontend/lib/live/index.ts` (esbuild, as the integration test does) so the page uses the real `fetchBundle`, `runCheck`, `reportCheck`, `PlatePlayer`, `requestClip`.

### Scenarios (each must have explicit assertions)

A. **Happy path, live.** Seed a project (illus-fox, 16:9 only is enough, 3 beats) and start the plates. Assert: the project's `plate_state.live_mode` becomes `live`; variants reach `bundled` and **stay there**; **zero** `plate-render` messages exist for them in `pgboss.job`; no clip or still exists for them in object storage. In the browser page: `fetchBundle` for each variant succeeds (record whether the browser's `fetch` of the presigned URL works from the page's origin, **this tests the CORS risk against S3Mock; record the exact outcome, including the browser console error if it fails**), the SHA check passes, `runCheck` reports ok, `reportCheck` returns 200 `{state:"checked"}`, the variant becomes `checked` in Postgres, `GET /v1/projects/:id/plates` reports `mode:"live"`, the scene `live:true` and the right `bundleDigest`, and the `PlatePlayer` draws frames (first frame, a middle frame, last frame) into a canvas whose pixels are non-blank and equal the pixels of the same frame from the page-thread host at the same scale.
B. **Clip fallback.** For one `checked` variant, `requestClip` returns 202 `{state:"rendering"}`; the worker draws it to `drawn`; `GET .../plates/:index/clip` redirects to a downloadable MP4 whose frame count equals the variant's frames (use `ffprobe` like the existing harness). Request clips for 5 variants in one project and assert the fifth is refused with 429 `clip_cap` and the first four are not affected.
C. **Fencing over HTTP.** Using the real digest and gen: a report with a stale `gen`, a wrong `bundleDigest`, or sent for a variant that is not `bundled` returns 204 and changes nothing; the same valid report twice returns the same answer and leaves one row in `plate_check_reports`; `host:"main"` returns 400; a report for a project in clip mode returns 409 `not_live`.
D. **Comment and revision.** Add a comment through the existing comment route and trigger the existing apply/fix path so `reviseScene` runs for one scene. Assert: `gen` increases, the old `checked` state resets to `queued`, the old check report no longer applies (204), a new bundle appears with a **different** `bundleDigest` but the same `variantSignature`, the browser re-fetches and re-checks it to `checked`, and the earlier revision's objects still exist in storage (they are protected by `plate_revisions`) while an unreferenced superseded object is not protected.
E. **Tamper.** Replace the bundle object of one variant in the object store with different HTML (use the S3 API on `http://localhost:59000` with the stack's credentials from `compose.yaml`; this is a local test store only). Assert the browser's `fetchBundle` refuses it (digest mismatch) and nothing runs.
F. **Rollback.** Restart `plate-api` with `PLATE_LIVE_FORCE_OFF=1` (use a second override file `compose.rollback.yaml`). Assert: `live_mode` becomes `clip` for the project, every `checked` or `bundled` variant is rendered by the worker to `drawn`, a second reconciler pass enqueues nothing more, and the clip routes serve MP4s. Then restart without the override.
G. **Flag semantics.** A project created while the flag is on stays `live` after the stack is restarted with the flag **off**; a project created while the flag is off is `clip` and behaves exactly like today (variants go `bundled` to `rendering` to `drawn`, no check route use, `/check` returns 409).
H. **Final render expectation.** For a `live` project whose variants are `checked` (never drawn), start the existing final render or companion export path and record exactly what happens (the plan says phase 5 will fix this; companion exports are expected to report "drawing" until clips exist). This scenario does not fail the run; it documents behaviour.
I. **Unsupported environment.** In the browser page, force `environmentStatus()` to `unverified` (for example by overriding `navigator.userAgent` in the page context before loading the module) and assert the player chooses `clip` and never starts a Worker.

## How to run

```
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker
node tools/phase2/e2e/live-e2e.mjs
```
Look at how `scripts/plates-e2e/run.mjs` handles the first run (databases, waiting for the API) and follow it. The shared local Postgres container and the container `videosaas-local-worker-1` belong to the user and are already running: do NOT stop, recreate or remove them. At the end tear down only what you started: `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down` (without `-v`), and confirm with `docker ps` that the user's containers are still running.

## Fixing bugs

If a scenario fails because of a bug in 2a or 2b code, you may fix it, only in `backend/src/plates/`, `frontend/lib/live/`, or `backend/src/db/migrations/019_plate_live.sql` (019 is uncommitted-to-staging, so it may be amended, but keep it idempotent), and only with a regression test added next to the existing tests in `backend/test/` or `frontend/test/` (do not weaken or skip existing tests; run both full suites and `npm run typecheck` in both packages before and after). Every fix must be listed in the report with the failing assertion, the root cause, and the test that now covers it. If a fix would be larger than about 60 changed lines, or needs a design decision, do not implement it: describe it instead.

## Rules (hard limits)
- Edit or create files ONLY in `tools/phase2/e2e/`, `docs/phase2/`, and (for bug fixes only, as described) the paths named in "Fixing bugs" with their tests. Do not edit `compose.yaml`, `scripts/plates-e2e/`, `worker/`, `packages/`, other worktrees, or the main folder `/Users/osamaehsaan/Code/Market_apps/VideoSaaS`.
- Local only: no `git commit`, no `git push`, no deploys, no cloud, AWS, Railway, Supabase or real model API calls (the stub only), no secrets read or printed. Servers bind `127.0.0.1`. Stop every process, browser and container you started. Never kill processes or containers you did not start (a stale Python server may hold port 8766).
- Do not add dependencies.
- If the brief contradicts reality, keep to its intent and write the contradiction in the report.

## Deliverable
`docs/phase2/e2e-report.md` containing: (1) the exact commands run; (2) a table of every scenario A to I with pass/fail and the key numbers (time from draw request to `bundled`, to `checked`, frames drawn per second in the browser, clip draw time); (3) the exact CORS outcome of scenario A and, if it failed, what configuration would fix it (do not change the object store's configuration); (4) every bug found, with root cause and whether you fixed it (and the covering test) or only described it; (5) the full-suite results before and after for `backend` and `frontend`; (6) anything you could not test and why; (7) what the scenario H behaviour is. Then print `DONE` and the report path on a line by itself.
