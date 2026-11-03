## What this is
The code-drawn **plate scenes** (`illus-*` styles) moved off the Railway API: authoring and bundling stay on the API; Chromium verification, frame drawing, FFmpeg encode and final assembly run on the ECS worker. State is in Postgres, artifacts in R2. **Behind `PLATE_PIPELINE=worker` (default off)**; with it off, staging behaves as today.

Based on `origin/staging` (`b197bcc`). Only the plates feature and the worker-pipeline changes are included. No billing, pricing, landing-page or other branch work. The original uncommitted work is preserved on the local branch `codex/plates-wip-snapshot`.

Design, cache rules, recovery, config, measurements and the production plan: `docs/PLATES_PIPELINE.md`. Speed-up ideas, criticisms and open items: `docs/PLATES_SPEEDUP_PLAN.md`.

## Exact changes (4 commits, 132 files; +18.6k, mostly the vendored engine)
- `packages/plate-engine`: vendored anidoodle 0.6.4 (Apache-2.0; LICENSE, NOTICE, PROVENANCE), 31 style plates, bundler, capture adapter, manifest.
- Backend: `src/plates/*` (author, store, service, exports, reconcile, routes, prompt, inputs, model); migration `018_plate_pipeline.sql` (additive: `plate_variants`, `plate_exports`, `plate_garbage`, new columns on `plate_state`); queues `plate-author|render|export` (+dead letters); `render/service.ts` hands plate films to a `plate-film` render job; `worker-launcher.ts` counts plate demand from tables (only when the flag is on); `auth.ts` media-token routes for plate clips/stills/exports; `config.ts` flag + object-store allowance for a local S3; `storage.ts` plate artifact helpers; `plan/readiness.ts`, `plan/visual-state.ts` skip scene-engine checks for plate looks; `media.ts` unique temp names for cache downloads.
- Worker: `src/plates.mjs` (verify, render, export, assembler), `worker.mjs` (plate queues, `plate-film` input kind, idle-exit counts plate tables, `/capabilities` reports `plates`), `storage.mjs`, Dockerfile (+ playwright-core, sharp), task definition `PLATE_CONCURRENCY=1`.
- Frontend: `plate-preview.tsx` + CSS, studio wiring (plate preview in the Animation step, extra-ratio downloads in Render) **only when `getPlates().available`**; API client.
- Contracts: `aspects` on the brief.
- Compose `plates-e2e` profile and `scripts/plates-e2e/*` (isolated API + worker containers, S3-compatible store, model stub).

## Compatibility with staging's current behaviour
- Auth: plate routes sit under the existing `/v1/projects/:id/…` access hook; media-token whitelist extended for clips/stills/exports only.
- Billing/entitlements: the final render is staging's ordinary `POST /render` (tokens taken first, refunded on failure, `tierFor` watermark); completion goes through the existing `render-finished` path. Free plan now gets the "Made with Greedy Motion" mark on plate films (previously dropped).
- Render orchestration/HyperFrames: new `plate-film` kind only; `beat-plan`, `pro` and `painted` paths and the GPU queue are untouched. Worker self-test (lint/check/render/probe) passed in the integrated-lineage image earlier.
- Launcher: uses the task-definition **family** (`ECS_WORKER_TASK_DEFINITION=greedymotion-staging-worker`), i.e. the latest active revision. **Revision 14 was built from an unintegrated branch and must not stay the latest**; the integrated worker image must be registered as the new latest revision (`infra/aws/deploy-worker.sh ondemand` from this branch) before or with the backend.

## Validation on this branch
| Check | Result |
| --- | --- |
| Typecheck (backend, frontend, contracts) | clean |
| `plate-model`, `plate-store` (real Postgres + pg-boss, staging migrations 001–018), engine tests (bundle, byte parity with the legacy renderer, determinism gate, network isolation) | pass |
| `ownership`, `entitlements`, `tokens`, `env-profiles`, `worker-launcher`, `render-quote`, `pricing-lock`, `media`, `formats`, `pro`, `scene-rendering` | pass |
| `billing` | fails ("checkout is off until Lemon Squeezy is configured"); billing code is untouched here; env-dependent, not yet compared with a pure `origin/staging` run |
| Separate-container e2e on this branch (API and worker images built from it, isolated DB + S3-compatible store, model stub): happy path (3 scenes × 3 ratios, 3 exports), failure repairs, cache behaviour, comments/revision, durability (API restart during authoring, worker killed mid-render, duplicate delivery, edit during render, recreated containers) | pass |
| Earlier on the pre-integration branch (same code paths): 2 competing workers, exhausted-repair failure, real-model run (authoring 56–79 s/scene), byte-identical frames/audio vs the legacy pipeline | pass |

## Migrations, env, rollback
- Migration `018` is additive and idempotent; nothing reads it while the flag is off. pg-boss gets 5 new queues; existing workers ignore them.
- Railway staging backend: `PLATE_PIPELINE=worker` (enable only after the worker revision is live and `/capabilities` lists `plates`), `PLATE_CONCURRENCY=1` (launcher slots; matches the task definition). No new AWS or R2 variables.
- Rollback: `PLATE_PIPELINE=off` (instant), redeploy the previous backend if needed (migration stays), register the previous worker image as the latest task-definition revision. A queued `plate-film` job on an old worker fails permanently and is refunded; drain plate renders first.

## Not verified yet (needs staging)
Real R2 and ECS, cold start / scale-from-zero timing, interrupted-job recovery on ECS, the launcher's new demand counting, subtitle fonts in the worker image, all 31 styles (3 drawn end to end), authorization with real tokens.

## Do not merge yet
Review PR only. `staging` has not been advanced and the flag is not enabled.
