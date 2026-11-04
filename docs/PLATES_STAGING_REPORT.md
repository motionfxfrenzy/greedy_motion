# Plates on staging: deployment and verification report (2026-11-04)

## Deployed
- Branch `codex/plates-staging-integration` fast-forwarded onto `staging` (no force-push). Last commit at time of writing: see `git log staging`.
- Worker image `greedymotion-staging-worker:13478c0-104339`, digest `sha256:85e49a02f28a01c9d7754e71273f413a2cdab109e68fca770b8e6ccaeac029c9`, task definition **`greedymotion-staging-worker:16`** (earlier: rev 15 `e6fe0e1-095417`, digest `sha256:89205f0b…6e1b`).
- The Railway staging backend pins `ECS_WORKER_TASK_DEFINITION=greedymotion-staging-worker:16` (it used to name only the family, i.e. "latest"). Revision 13 (`5d73e92-211516`) is the last pre-plates worker; revision 14 was built from an unintegrated branch and must not be used.
- Railway staging variables set: `PLATE_PIPELINE=worker`, `PLATE_CONCURRENCY=1` (backend: launcher slots per task; worker task definition: plate scenes drawn at once), `DATABASE_POOL_SIZE=3`, `ECS_WORKER_MAX_TASKS=2` (see "Supabase pooler").

## Verified on staging (real R2, ECS Fargate, Claude, Gemini; signed-in staging user)
| Check | Result |
| --- | --- |
| Plate styles reachable | The gallery hid them; they are listed again when the flag is on (28 templates). |
| Create from a plate template, storyboard, voiceover | 6 scenes, 6/6 voiced. |
| Drawing 6 scenes (16:9) | authoring 56–108 s per scene (real model), verify 5–16 s, render 23–55 s; cold start from zero tasks 42 s (task created 7 s after the click, overlapping the model call). |
| 9:16 and 1:1 | 12 more variants authored with the 16:9 module as reference and drawn; all 18 drawn. |
| Cache | Retrying failed scenes used the saved bundle: 0 model calls. |
| Comment + revision | Scene 4 revised (1 call, 56 s), comment cleared; scene 2 revised across all 3 ratios while the backend was restarted twice. |
| Subtitles | Switched to full subtitles; persisted; used by the final render. |
| Final render (billed) | 14.1 tokens charged once (ledger: only that spend); `plate_film_assembled` 570 frames, 15 audio tracks, assembly 13.5 s, job 21 s on ECS. |
| Downloads | 16:9 1920×1080, 9:16 1080×1920, 1:1 1080×1080, all 19 s, load in the browser. |
| Scale to zero | All tasks idle-exited (0 running) after the idle timeout; the next click started one. |
| Interrupted-job recovery | A task stopped mid-render left two scenes `failed` (pooler errors, below); after the fixes they were revived automatically from their bundles without a model call. A backend restart during authoring recovered without user action. |
| Existing HyperFrames render | A new non-plate 15 s project rendered on revision 16 (`render_completed`, 54 s) and plays in staging's own player. |
| Authorization | Unauthenticated plate routes (list, draw, export, clip, bad media token) return 401. |
| Revision 15/16 smoke on Fargate | HyperFrames self-test (lint, check, render, probe) exit 0; plates capability; Chromium; sharp; painted-engine files present. |

## Not verified on staging
- Painted (GPU) story films: the GPU task family and queue are untouched by this change; no film was rendered.
- Duplicate delivery and stale-attempt rejection: proven locally (docs/PLATES_PIPELINE.md); no database access to force them on staging.
- Refund of tokens for a failed plate-film job, and cross-account authorization (one account only).
- `aws ecs stop-task` was denied by the permission system during the second interruption test; the first (allowed) stop and the natural restarts are the evidence above.

## Defects found on staging and fixed
1. **Launcher over-provisioning**: every plate message counted as a render job (3 tasks for 6 scenes). Fixed with a single worker-sized "ping" (`kickPlateWorkers`).
2. **Supabase session pooler (15 clients)**: backend pool 10 + pg-boss 4 + 3 workers × 8 exhausted it (`EMAXCONNSESSION`), also failing ordinary API requests and dead-lettering two scene renders. Fixed: backend pool 3, ≤2 tasks, worker pools 2 + 2 (`PG_POOL_MAX`, `BOSS_POOL_MAX`), and dead-lettered renders with an intact bundle are retried twice by the reconciler. **Keep total connections under 15** when raising task counts.
3. A redelivered plate-render whose previous holder was still recent completed silently; it now looks again later.
4. UI: staging's animation editor flashed on reload and its storyboard-frame poster appeared on the final page; the final page of a plate project is now one player with a switch per ratio and a download each (no scene list); volume, mute and full screen added to the plate preview; the Render step stays reachable once a render exists; a clip that fails to load is retried.

## Rollback
- Instant: `PLATE_PIPELINE=off` on Railway staging.
- Worker: set `ECS_WORKER_TASK_DEFINITION=greedymotion-staging-worker:13` (pre-plates image `5d73e92-211516`).
- Code: Railway rollback to deployment `87fd171f` (commit `b197bcc`) or a revert commit on `staging`; migration `018` is additive and can stay.
