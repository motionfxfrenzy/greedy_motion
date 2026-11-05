# Merge plan, 2026-11-05: engine + re-bundle + playback line + live-scenes, then staging

Written read-only by the playback manager session (no merges, no branch changes; `git merge-tree --write-tree` touches no worktree; two throwaway commit objects were created with `commit-tree` to chain step 2, nothing refers to them). Nothing here is done yet; every step needs the user's go-ahead. State of the lines (all local, nothing pushed):

| Line | Branch | Head | Based on |
| --- | --- | --- | --- |
| Playback (3g, 3h) | `codex/live-predraw` | `ec3ba9c` (+ the handoff commits that follow) | `23e1963` (= `origin/staging`) |
| Engine | `codex/engine-inside` | `c2f0248` | `23e1963` |
| Re-bundle (contains the engine) | `codex/rebundle` | `4c3c878` (`b4e5907` + worker wiring) | `c2f0248` |
| Live scenes (4a, meter) | `codex/live-scenes` | `3b4564f` | `88d4efa`, which forked from staging at `3271abd` |
| Smoke script | `codex/staging-smoke` | `7a00e01` | `88d4efa` (independent files; merge last or not at all) |

Ancestry facts that shape the plan: `origin/staging` is `23e1963`; it is an ancestor of the playback line, the engine and the re-bundle line; `codex/live-scenes` lacks `23e1963` (it forked at `3271abd`, which staging contains), so merging it brings in only its own 7 commits. `origin/production` is not an ancestor of anything here (31 commits ahead of staging); the production merge is the one described in `docs/HANDOFF_2026-11-05_LIVE_SCENES.md` section 7, after staging is proven.

## 1. Order

1. **Step 1:** merge `codex/rebundle` (engine + re-bundle) into `codex/live-predraw`. Engine first because the re-bundle line is built on it and the playback speed numbers assume it.
2. **Step 2:** merge `codex/live-scenes` into the result.
3. **Step 3 (optional, separate):** `codex/staging-smoke` (touches only `tools/staging/` and `docs/staging/`; no conflicts expected).
4. Then the staging deploy (section 5), then the re-bundle roll-out (section 6).

Do the merges in a **new clean worktree** (for example `../VideoSaaS-integrate`, branch `codex/integrate`, created from `codex/live-predraw`), never in a worktree an agent is using.

## 2. Expected conflicts (from `git merge-tree --write-tree`)

- **Step 1** (`codex/live-predraw` + `codex/rebundle`): **clean, no conflicts** (result tree `73db8f1`). The 30-odd files both sides touch relative to `3271abd` (`frontend/lib/live/*`, `frontend/test/live-*`, the crayon fixtures, `plate-live-stage.tsx`) are the 3f commits both lines already contain, with identical content.
- **Step 2** (step-1 result + `codex/live-scenes`): **clean, no conflicts** (result tree `ea9b159`). Files changed on both sides: `frontend/components/animation-workspace/logic.ts` and `types.ts` (3g added the preview-quality option; 4a added element-edit comment types). Textually clean, so the risk is semantic: check these two files by eye and with the typecheck.
- `codex/live-predraw` + `codex/live-scenes` directly: also clean (`69be7b2`).
- Because merges are textually clean, **the typecheck and test matrix after each step is the real conflict detector**.

## 3. Migrations

Present: `021_plate_clips.sql` on every line; the re-bundle line adds `030_plate_revision_manifest.sql`; the live-scenes line adds none; the playback and engine lines add none. No collision. Rule for any later branch: pick a number above 030. The runner (`backend/src/db/database.ts`) applies files in sorted order, each once, and tolerates gaps. Migration 030 is additive (`alter table app.plate_revisions add column if not exists bundle_manifest jsonb`).

## 4. Test matrix after each step

Use a **fresh database** per full backend loop (create it, run, drop it): reused databases fail `job-control` and `plate-live-render` on leftover rows (follow-up: scope those counts). Locks: Chrome playback and timing tests take `/Users/osamaehsaan/Code/Market_apps/.lock-timing`; the Docker plates-e2e stack needs `.lock-plates-e2e`.

| Check | Step 1 | Step 2 | Command |
| --- | --- | --- | --- |
| Typecheck frontend and backend | yes | yes | `cd frontend && npm run typecheck`, `cd backend && npm run typecheck` |
| Frontend suite | yes | yes | `cd frontend && npm test` (two cold-start Next-dev tests: run each alone) |
| Backend loop, fresh DB | yes | yes | the loop in the handoff section 8, with `DATABASE_URL` on the fresh database; expected failures only: billing, brand-files, render-prep, styles, visuals |
| New backend tests | yes (re-bundle six: `plate-bundle-immutable`, `plate-legacy-keys`, `plate-rebundle`, `-fence`, `-gc`, `-rollback`) | yes (`plan-element-edits`, `plan-edit-no-chrome`, meter test) | each alone |
| Worker tests | yes | yes | `node --check worker/src/plates.mjs worker/src/worker.mjs`; `node worker/test/plates-phase5.mjs`; `node worker/test/plates-rebundle-queue.mjs`; `node worker/test/motion-blur.mjs` |
| Build check | no | yes | `node worker/templates/beat-plan/build.mjs --check` (4a-track rebuilt the stale `index.html`; a merge could undo it) |
| Engine identity spot-check | yes (a few styles, software mode) | no | `node tools/phase3/engine-identity.mjs --styles balloon,lighthouse,fox` under `.lock-timing`; engine-track's full 67/67 (software) and 66/67 (GPU, cold-first-draw flag) stand |
| Chrome playback test | yes | yes | `cd frontend && PREDRAW_STRICT=1 node --test test/live-predraw-chrome.mjs` under `.lock-timing` (includes the honest AudioContext assertions) |
| Bar layout test | no | yes | `node --test test/workspace-bar-narrow.mjs` |
| Plates captures | after step 2 | yes | `node tools/phase3/capture.mjs <dir>`, compare with the `tools/phase3/3h-after` captures (the playback line's current state): expect 0 changes except where 4a changed the plates page (list each) |
| HyperFrames captures | after step 2 | yes | `capture-hf.mjs`, compare with `tools/phase3/hf-after`; `capture-final.mjs` with `hf-final-after` (4a-track got 36/36) |

**Baselines to recapture on purpose** (after step 2 is green, as separate commits, each listing every changed file): `tools/phase3/baseline` (plates) to the 3h state (3g added the preview-quality pill to every 1280 page; 3h changed the 400 px pages); `tools/phase3/hf-after`: first identify the 2 to 33 px comments-panel difference 4a-track found (capture `c760509` vs `7ba5f0c`), then recapture. Do not recapture before the cause is known.

## 5. Staging deploy path

`origin/staging` (`23e1963`) is an ancestor of the integrated line, so the integrated branch is a descendant: a fast-forward of staging is possible if nobody pushes to staging first. Still follow the deploy-lineage rule: create a clean worktree from `origin/staging`, bring the integrated commits in (merge of `codex/integrate`, or cherry-pick if staging moved), run the matrix once more there, then push. Order of the three services matters:

1. **Backend (Railway)**: migration 030, the repair-path change (content-addressed keys), the `plate-rebundle` queue, the 4a routes (`plan/edit/propose`, `plan/edit/commit`), the meter change. Backend before frontend, because the new frontend calls the new routes and keeps the new options.
2. **Worker image (ECS, `ENV= deploy-worker.sh` from a clean worktree, as in the memory notes)**: engine 0.6.5 (new `engineDigest`: every cached clip becomes a cache miss and redraws lazily at the faster speed), the `plate-rebundle` consumer. Stage the new worker before any re-bundle is enqueued.
3. **Frontend (Vercel `greedy-motion-staging`)**: 3g, 3h, 4a UI. Flags already set on staging: `PLATE_LIVE_PREVIEW=on` (Railway), `NEXT_PUBLIC_PLATE_LIVE=1` (Vercel). Rollback: previous deployment of each service; migration 030 is additive and can stay.

After the deploy: time the crayon film in Chrome on staging (time to first play, buffering pauses, replay after reload makes 0 frame calls, quality change), then the staging smoke run (`tools/staging/plates-smoke.mjs`, 20-token cap, `SMOKE_AUDIO=none`, test user), both with the user's go-ahead.

## 6. Re-bundle roll-out and the scale-to-zero check (must be settled BEFORE any worker-mode re-bundle)

Finding (read-only, `codex/rebundle` at `4c3c878`):
- `demand.idle` (`backend/src/jobs/control.ts` ~line 467) counts queued and active jobs of every name in `QUEUE_NAMES`, which already includes `plate-rebundle`, so a worker that is running will not exit while re-bundle jobs wait. Good.
- The **launcher** does not: `plateDemand()` in `backend/src/jobs/worker-launcher.ts` counts only `app.plate_variants` in states `bundled` and `rendering` and `app.plate_exports` in `queued` or `assembling` (plus a recent ping). Staged re-bundle jobs are in neither, and `rebundleVariant` in `backend/src/plates/rebundle.ts` (the `boss.send` at line ~405) does not call `kickWorkers`. With the worker scaled to zero, **nothing wakes it**: the jobs would sit queued.
- Fix options for a small follow-up (brief for Argon or by hand, with a test): after `boss.send(QUEUES.plateRebundle ...)` call `kickWorkers(true)`, and make `plateDemand()` also count queued `plate-rebundle` jobs (a `pgboss` queue-stats or table count, like the other kinds). Alternatively run the roll-out only while a worker is up (start one by hand), which needs no code change but is easy to get wrong.

Roll-out steps (each needs the user's go-ahead; the manager cannot run Railway SSH commands that the harness blocks; the owner runs those): (1) staging: CLI dry-run against staging data (the CLI refuses non-local databases by design; a staging variant needs its own reviewed brief and an explicit guard change) or enqueue via an admin route; (2) apply with a small limit, watch `plate_rebundle_*` logs, check the bundle route and one frozen render; (3) rollback command ready (`--rollback`); (4) only then production, after the production merge.

## 7. Risks and open points

- Textually clean merges can still break at runtime in the shared workspace files (`logic.ts`, `types.ts`): the frontend suite, the bar layout test and the captures are the check.
- Every cached plate clip is invalidated by the engine change (new `engineDigest`); final renders redraw on demand at the faster speed; first renders after the deploy are slower than steady state.
- The identity proof has one known flag on GPU (cold first draw, shared by old and new engine); if the user wants stronger evidence, re-run engine-track's three-page vote on a GPU machine under the lock.
- `tools/phase3/3g-chrome-run.json` and `3f-chrome-run.json` are overwritten by every playback Chrome run; commit only when intended.
- Production: separate merge and the earlier handoff's checklist; not part of this plan.
