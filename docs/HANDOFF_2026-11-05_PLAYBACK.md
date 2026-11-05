# Handoff, 2026-11-05 (afternoon): live playback, engine speed-up, 4a review, second-opinion findings

Written by the manager session that took over from `docs/HANDOFF_2026-11-05_LIVE_SCENES.md` (on branch `codex/live-scenes`, commit 88d4efa; read that first for the whole programme, credentials by name, harness limits and the containers never to touch). This file covers everything that happened after it. No secret values here.

---

## 0. Where things stand, in one paragraph

Staging runs `23e1963`: live preview on, with the auth fix (live calls carry the user's token), phase 3f pre-draw at 640x360 / 15 fps and a 20 s limit, and one-scene-at-a-time measurement. The owner then decided the final playback design (`docs/LIVE_PLAYBACK_PLAN.md`, changes A to F): an exact engine speed-up, 30 fps, video-style buffering with one clock for picture and sound, draw-once frame storage as lossy WebP 0.4 with a Low/Standard/High setting changed by a background job, and background drawing. **Change A** (engine) is being built by a Sonnet subagent in `../VideoSaaS-engine`; **changes B to F** (phase 3g) by Gemini Argon in `../VideoSaaS-predraw`. **Phase 4a** (HyperFrames element edits, Argon, with the browser-measurement fix) is finished but **uncommitted** in `../VideoSaaS-live-scenes`, awaiting the manager's review. A **second-opinion review** (section 6) found real gaps; the plan and briefs must be revised before shipping (section 7 lists the order).

## 1. Roles and how to run agents (unchanged; see the earlier handoff section 1)

- Manager = the Claude session: briefs, independent verification, commits, deploys. The owner wants parallel work: Gemini Argon through OpenCode plus Sonnet subagents.
- Argon: `opencode run -m google/gemini-4-argon --title "<name>" "<prompt pointing at a brief>"` typed into a terminal tab with `cd <worktree> && ...` (the terminal tool's `cwd` is refused for sibling worktrees). Never `--auto`. Active sessions: `opencode api session.active`; stop: `opencode api session.interrupt --param sessionID=<id>`. Closing a tab does not stop a session.
- Watcher used this session (re-arm every 30 minutes with the Monitor tool): a loop that prints DONE when `session.active` is empty and the report exists, STOPPED when empty without report, STALLED after 45 minutes without file changes.
- Sonnet subagents are launched with the Agent tool (`model: sonnet`, background). **They belong to the session that started them**; a new session cannot message them. Check their worktree and report file instead.
- Harness facts learned: the macOS shell has no `timeout`/`gtimeout`; the plan-grant command for test accounts (`railway ssh ... node /app/backend/scripts/plan.ts grant <email> pro --days 7 --by <name> --yes`) is blocked for the manager and was run by the owner; Railway CLI works from the main folder; Vercel CLI with `--scope greddy-motion --project greedy-motion-staging`.

## 2. Worktrees and branches

| Worktree | Branch | State |
| --- | --- | --- |
| `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` | `codex/live-scenes` (HEAD 88d4efa) | **Phase 4a + 4a fix uncommitted** (Argon done; manager review in progress, section 5). Behind staging: lacks 780d868, 9f52346, 23e1963, 1b8ee56. |
| `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw` | `codex/live-predraw` (HEAD 1b8ee56 + this file) | Playback line. 780d868 (auth fix), 9f52346 (3f), 23e1963 (3f follow-up) are on `origin/staging`; 1b8ee56 (plan + 3g brief) is local only. **Argon is running phase 3g here.** |
| `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-engine` | `codex/engine-inside` (base 23e1963) | **Engine fix uncommitted, Sonnet subagent running.** |
| `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-livefix` | `fix/live-auth` (780d868) | Done; source of the auth fix. Can be removed. |
| `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-smoke` | `codex/staging-smoke` (base 88d4efa) | Smoke script by Sonnet, **uncommitted**, tested against a mock only (25/25). Never run against the real stack or staging. |
| `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-deploy` | detached 3271abd | Worker image build; holds copies of secret files: delete when deploys finish. |

Merge order before production: engine (A) into the playback line, then 3g, then integrate with `codex/live-scenes` (4a), then the production merge described in the earlier handoff section 7.

## 3. Staging state

- `origin/staging` = `23e1963`. Railway backend deployment after it: SUCCESS. Vercel staging rebuilt from it.
- Flags: Railway staging `PLATE_LIVE_PREVIEW=on`; Vercel staging (Production and Preview env of project `greedy-motion-staging`) `NEXT_PUBLIC_PLATE_LIVE=1`. Rollback: remove both and redeploy.
- Test account `testing@example.com` (signed in already in the Claude app's browser pane) is on a manual Pro plan until 2026-11-12, 545.8 tokens left. Undo: `plan.ts end testing@example.com --by osama --yes` (owner runs it).
- Test film: project `130a0660-0f39-4900-99f0-6cd24b6f6860` ("A short 30-second film told as a crayon illustration: a hot-air balloon", look `illus-balloon`, 4 scenes, 18 s). Verified end to end on staging: model authoring, bundles from R2 through the CORS rule, sandboxed Worker checks, AWS clip drawing via job control (including a verification failure, repair and redraw), a comment that re-authored only scene 4, final render 1920x1080 18 s MP4, 11.4 tokens spent once, zero `plate-render` jobs.
- The four scenes of that film are fixtures: `frontend/test/fixtures/crayon-staging/scene{0..3}.html|json` (hashes verified).

## 4. Decisions of this session (owner's words and rationale are in the review pack; summary)

1. Scene code draws on the user's computer; the model's drawing is never restricted (no drawing-time budget).
2. The user may wait for drawing; playback must be smooth at **30 fps** with voice, music and sound effects in step ("a coherent video").
3. No MP4 fallback for slowness; the MP4 only for unverified/unsupported browsers or a crashing drawing worker.
4. **Draw once:** frames are saved as they are drawn; complete scenes replay without running their code (while stored; browsers can evict storage).
5. Stored quality: lossy WebP **0.4 default**, user setting **Low 0.2 / Standard 0.4 / High 0.6** (preview replays only; the final render runs the code at 1920x1080 30 fps on AWS). The owner compared real frames by eye with a split slider down to 0.3 and chose 0.4.
6. Changing quality runs as a **background job** on the user's computer, nearest the playhead first, never blocking playback or scrubbing.
7. Engine speed-up must be **exact** (identical pixels); measured 5 to 6x faster on the crayon scenes.
8. Root cause on record: the crayon fill's point-in-polygon test was 83 to 90 % of frame time; the crayon style has no kit, so model scenes recompute fills every frame; local hand-written scenes cache them.

Documents: `docs/LIVE_PLAYBACK_PLAN.md` (the plan), `docs/LIVE_SCENES_PLAN.md` section 26, `tools/phase3/TASK-3g-playback-store.md` (Argon's brief), `../VideoSaaS-engine/tools/phase3/TASK-engine-inside.md` (engine brief), comparison page https://claude.ai/code/artifact/ad1ba183-94e8-4c4d-8b9d-31f292bc2ea8 (source in the old session's scratchpad, see section 9).

## 5. Phase 4a (HyperFrames element edits) review status

- Argon finished both 4a and the 4a fix (browser measures with `window.__bp.elementsAt`, `POST /plan/edit/propose` then local apply and re-measure then `POST /plan/edit/commit`; server re-runs the pure classifier; no Chrome on the server, proven by `backend/test/plan-edit-no-chrome.mjs`; model translator behind the rule-based one; comments labelled only after commit). Report: `../VideoSaaS-live-scenes/docs/phase4/element-edits-report.md` (section "4a fix").
- Manager verification so far: typechecks clean; frontend 176/176; backend 37 pass with the 5 known failures **plus `plan-element-edits` failing in the full parallel run but passing alone** (flaky under load: fix before trusting); HyperFrames screenshots 45/48 vs `tools/phase3/hf-after` with the three at 0 to 2 px (known capture noise); plates screenshots: rerun (output was cut).
- Still to review: the diff of `backend/src/plan/element-edits.ts`, `routes.ts`, `browser-animation-step.tsx`; the `preview-meter.ts` change (every `plan/edit/propose` now counts against the preview allowance and call cap, including rule-only proposals that call no model: decide whether only model-backed proposals should count); `render-parity.mjs` on the local stack.
- **Baselines note:** the earlier handoff's checklist names `tools/phase3/hf-baseline` and `hf-final-baseline`; those predate phases 3b/3e. Compare against `tools/phase3/hf-after` and `hf-final-after`.
- Commit when clean: `git add -A backend worker frontend packages tools docs` in that worktree (check `git status` first; nothing outside those).

## 6. Second-opinion review (owner obtained it; manager verified the facts)

1. **Engine identity proof incomplete.** `../VideoSaaS-engine/docs/phase3/engine-identity-result-gpu.json` (13:39) has `allIdentical: false`: `lighthouse@16:9` differs at 640 and 1920, `moonPhases@1:1` at 640; `storybook@16:9` and `@1:1` skipped (no `: Film` export). Pattern: the first draw's hash differs from the next four (possible first-draw warm-up, not proven). Acceptance must show old-vs-old has the same variance and old == new after warm-up, and cover storybook.
2. **Mutation guard too weak** (`../VideoSaaS-engine/packages/plate-engine/src/canvas-core/core.ts` around line 60: length + first/middle/last only). Proposed fix: clear the index cache at the start of every frame (`seek`) and verify an outline's full contents on first use per frame; document in-place edits within a frame as unsupported, caught by the determinism check.
3. **"First play always exact" contradicts drawing ahead with bounded memory.** Frames drawn ahead and evicted come back only as the stored lossy copy. Manager's recommendation (owner to decide): frames shown as they are drawn are exact; frames drawn ahead show from the stored copy at the chosen quality. Alternative: temporary lossless storage (~221 MB per 15 s film).
4. **Start buffer for slow scenes:** the brief's start rule `max(30 frames, L)` already uses remaining frames and measured rate with frames waiting on disk, but needs a safety margin (plan for 1.25x the measured draw time, re-measured) and the plan's wording must separate the decoded memory window from frames prepared on disk.
5. **Background work limits** missing from the brief: bounded encoder queue, guaranteed bitmap close, cancellation on revision or setting change, priority playback > drawing for playback > future scenes > quality upgrades.
6. **Audio:** use one Web Audio timeline (`AudioContext.currentTime`) for music, voice and sound effects rather than several `<audio>` elements; add tests for seeking into an active sound effect, backward seeks, loops, scene boundaries, repeated buffering, hidden tab, device sleep.
7. **Re-bundling safety:** create new revisions, never overwrite bundle objects (content-addressed; frozen manifests reference them), switch previews only after the new bundle exists.
8. **Delivery:** 3g had just started; engine report absent; 4a, engine, smoke uncommitted; smoke tested only against a mock.
- Also accepted: lowering quality should **redraw from the code** too (re-encoding a lossy copy loses detail twice); say "replays while stored", not "forever".

## 7. Next steps, in order

1. **Revise the plan and the 3g brief** with section 6 items 3 to 6 and the two wording fixes. Argon's 3g session started at about 13:40 on the old brief: either interrupt it (`opencode api session.active` for the id, then `session.interrupt`), check `git status` in `../VideoSaaS-predraw` for partial work, and relaunch on the revised brief; or let it finish and issue a follow-up brief. Recommended: interrupt early and relaunch (it reads for a while first). Get the owner's decision on item 3 first.
2. **Engine:** when the Sonnet agent reports (`../VideoSaaS-engine/docs/phase3/engine-inside-report.md`), verify the identity evidence yourself (rerun `tools/phase3/engine-identity.mjs`, `packages/plate-engine/test/engine.test.mjs`, `packages/plate-engine/test/inside-identity.mjs`), resolve lighthouse/moonPhases/storybook (section 6.1), apply the stronger guard (6.2), then commit on `codex/engine-inside`.
3. **4a:** finish section 5, fix the flaky `plan-element-edits` under load, decide the preview-meter question, commit on `codex/live-scenes`.
4. **Re-bundle brief** (backend/worker) with section 6.7 safeguards, after the engine lands.
5. **Smoke script:** review and commit (`../VideoSaaS-smoke`), run it against the local plates-e2e stack, then staging as the test user.
6. **3g review** when Argon reports (`docs/phase3/3g-report.md`): rerun its Chrome tests, the audio-sync cases, replay-after-reload zero-draw, quality job, screenshots; then merge engine + 3g on the playback line, deploy staging, time the crayon film in Chrome.
7. Integrate with `codex/live-scenes`, then production (earlier handoff section 7). Clean-ups: delete secret copies in `VideoSaaS-deploy`, scratch token files, `infra/aws/.env.admin`; remove the `VideoSaaS-livefix` worktree; end the test account's manual Pro when testing ends.

## 8. Verification commands (copy-ready)

- Frontend: `cd <worktree>/frontend && npm run typecheck && npm test` (two Next-dev-server tests time out cold: rerun alone with `node --test test/final-view-interaction.mjs` / `test/hf-step-interaction.mjs`).
- Backend (no `timeout` on macOS): `cd <worktree>/backend && for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` (expected failures: billing, brand-files, render-prep, styles, visuals).
- Live pre-draw Chrome test: `cd <worktree>/frontend && PREDRAW_STRICT=1 node --test test/live-predraw-chrome.mjs` (run alone; machine load matters).
- Screenshots: `node tools/phase3/capture.mjs <dir> && node tools/phase3/compare.mjs tools/phase3/baseline <dir> <diff>`; HyperFrames: `capture-hf.mjs` vs `tools/phase3/hf-after`, `capture-final.mjs` vs `tools/phase3/hf-final-after`.
- The compose project name is fixed (`videosaas-local`): only one agent may use the plates-e2e stack at a time; tear down with the targeted command from the earlier handoff.

## 9. Files of this session

Full index with paths: section 8 of the review pack the owner holds; summary:
- Plans: `docs/LIVE_PLAYBACK_PLAN.md`, `docs/LIVE_SCENES_PLAN.md` s.26, this file (all on `codex/live-predraw`).
- Briefs: `tools/phase3/TASK-3f-predraw.md`, `tools/phase3/TASK-3g-playback-store.md` (predraw); `tools/phase3/TASK-engine-inside.md` (engine worktree); `tools/phase4/TASK-4a-fix-browser-measure.md` (live-scenes); `tools/staging/TASK-plates-smoke.md` (smoke worktree).
- Reports: `docs/phase3/3f-report.md` (predraw); `docs/phase4/element-edits-report.md` (live-scenes); `docs/staging/plates-smoke-report.md` (smoke). Pending: `docs/phase3/3g-report.md`, `../VideoSaaS-engine/docs/phase3/engine-inside-report.md`.
- Commits: 780d868 (auth fix), 9f52346 (3f), 23e1963 (3f follow-up), 1b8ee56 (plan + 3g brief), plus this handoff.
- Measurement scripts (old session scratchpad, may be cleaned by the system): `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/27148fa8-5b3f-43cb-8253-cd887b35dfeb/scratchpad/` `draw-diag.mjs`, `memo-diag.mjs`, `inside-diag.mjs`, `store-diag.mjs`, `webp-fidelity.mjs`, `export-frames.mjs`, `quality-cost.mjs`, `page-template.html`, `draw-once.html`, `frames.json`. Copied into the repo at `tools/phase3/measure/` by this handoff commit.
