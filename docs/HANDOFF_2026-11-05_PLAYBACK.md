# Handoff, 2026-11-05 (afternoon): live playback, engine speed-up, 4a review, second-opinion findings

Written by the manager session that took over from `docs/HANDOFF_2026-11-05_LIVE_SCENES.md` (on branch `codex/live-scenes`, commit 88d4efa; read that first for the whole programme, credentials by name, harness limits and the containers never to touch). This file covers everything that happened after it. No secret values here.

---

> **Read section 10 first.** At the end of this session the owner asked to stop every background task: Argon's phase 3g and the Sonnet engine agent were stopped mid-work. Section 10 says exactly what each left on disk and how to resume. Wherever this file says "running", read "stopped, resume per section 10".

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
7. Engine speed-up must be **exact** (identical pixels); measured 4.5x to 4.9x on three crayon scenes and 1.9x on the fourth (GPU, 640x360; engine c2f0248).
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

## 10. Background tasks: stopped at the end of this session, and how to resume each

All stopped on the owner's request at about 13:55 +08 on 2026-11-05. Nothing is running now (`opencode api session.active` returned `{"data":{}}`; the Sonnet subagent and the watcher were stopped).

### 10.1 Phase 3g (Gemini Argon) in `../VideoSaaS-predraw`: stopped, NO changes on disk
- OpenCode session `ses_e55c92b3cffeF5Ns4O1qZy0zc2` ("phase3g playback store", started 13:47) was interrupted while still reading; `git status` in the worktree was clean afterwards (only the committed brief and plan exist).
- **Resume:** do NOT relaunch on the current brief. First revise `docs/LIVE_PLAYBACK_PLAN.md` and `tools/phase3/TASK-3g-playback-store.md` with section 6 items 3 to 6 and the wording fixes (owner's decision on item 3 first: may frames drawn ahead be shown from the stored 0.4 copy on first play, or must first play stay exact?). Also add to the brief: lowering quality redraws from code (not re-encode), "replays while stored", the 1.25x start-buffer margin, bounded encoder queue / bitmap close / cancellation / priority order, Web Audio timeline and the extra audio tests. Commit, then launch from a terminal tab:
  `cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw && opencode run -m google/gemini-4-argon --title "phase3g playback store v2" "Read tools/phase3/TASK-3g-playback-store.md in full and do exactly what it says, in order. Start with docs/LIVE_PLAYBACK_PLAN.md. Work only in this worktree; do not touch ../VideoSaaS-live-scenes or ../VideoSaaS-engine. Follow every rule in the brief. End your final message with exactly: DONE docs/phase3/3g-report.md"`
- **Watcher** (Monitor tool; OBSOLETE form below: with parallel tracks `session.active` is never empty. Use the id-specific form in section 11):
  `cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw; sleep 60; while true; do if opencode api session.active 2>/dev/null | grep -q '"type":"running"'; then :; else sleep 20; if ! opencode api session.active 2>/dev/null | grep -q '"type":"running"'; then if [ -f docs/phase3/3g-report.md ]; then echo "ARGON DONE phase-3g"; else echo "ARGON STOPPED phase-3g: no report"; fi; exit 0; fi; fi; if [ -z "$(find frontend tools docs -type f -mmin -45 -not -path '*/node_modules/*' -not -path '*/.next/*' 2>/dev/null | head -1)" ]; then echo "ARGON STALLED? phase-3g"; sleep 2400; fi; sleep 300; done`

### 10.2 Engine fix (Sonnet subagent) in `../VideoSaaS-engine`: stopped, PARTIAL work on disk (uncommitted)
- Last message before it was stopped: "All 65 items identical under software rendering. Now the crayon fixtures."
- On disk (branch `codex/engine-inside`, base 23e1963, nothing committed):
  - Code: `packages/plate-engine/src/canvas-core/gallery.ts`, `core.ts` (the indexed `inside`, `RingIndex`, `ringCache`, guard on length + first/middle/last vertex, `RING_MIN = 16`, non-finite/huge inputs take the original loop), and the other engine copies of the even-odd test it routed to the shared one: `brokenColour.ts`, `colouredPencilKit.ts`, `folkTale.ts`, `riso.ts`, `scrapbookEngraving.ts`, `scrapbookKit.ts`, `scratchboardKit.ts`, `woodcut.ts`; plus `NOTICE`, `PROVENANCE.md`, `manifest.json`, `package.json` (version). 14 files, +97 / -22.
  - Tests and tools: `packages/plate-engine/test/inside-identity.mjs`, `tools/phase3/engine-identity.mjs`, `tools/phase3/crayon-fixtures.mjs`.
  - Evidence: `docs/phase3/engine-identity-result.json` (13:50, **software rendering: 65 items, allIdentical true**, storybook@16:9 and @1:1 skipped: "no `: Film` export to alias as `film`"); `docs/phase3/engine-identity-result-gpu.json` (13:39, **GPU rendering: allIdentical false**: `lighthouse@16:9` at 640 and 1920, `moonPhases@1:1` at 640; in each the first draw's hash differs from the following draws of the same frame).
  - NOT done: the crayon-fixture speed measurement with the new engine, the re-bundle proposal, the report `docs/phase3/engine-inside-report.md`, the stronger mutation guard (section 6.2).
- **Resume:** start a new agent (Sonnet subagent or Argon) in that worktree with a follow-up brief: (1) read `tools/phase3/TASK-engine-inside.md` and the existing uncommitted changes; (2) explain the GPU differences: run the OLD engine twice on GPU for lighthouse and moonPhases and show whether its first draw also varies, then compare old vs new after one warm-up draw; (3) cover storybook (alias its export or bundle it another way); (4) replace the guard with "rebuild each outline's index once per frame (clear at `seek`) after a full-content check", with a test editing a middle vertex between frames; (5) the crayon-fixture timing; (6) the re-bundle proposal with the section 6.7 safeguards; (7) write the report. Then the manager reruns `node packages/plate-engine/test/engine.test.mjs`, `node packages/plate-engine/test/inside-identity.mjs`, `node tools/phase3/engine-identity.mjs` (both rendering modes) before committing.

### 10.3 Phase 4a review (manager task, not an agent): paused
- Argon's 4a and 4a-fix work is complete and uncommitted in `../VideoSaaS-live-scenes` (all OpenCode sessions there are finished). Resume with section 5: review the diffs, fix or explain the flaky `plan-element-edits` (fails in the full parallel backend run, passes alone), decide the preview-meter counting, rerun plates screenshots and `node tools/phase4/render-parity.mjs` on the local stack, then commit.

### 10.4 Smoke script (Sonnet, finished earlier): waiting for review
- `../VideoSaaS-smoke` (branch `codex/staging-smoke`), uncommitted: `tools/staging/plates-smoke.mjs`, `mock-api.mjs`, `plates-smoke.test.mjs`, `fixtures/`, `docs/staging/plates-smoke-report.md`. Manager reran its 25 mock tests (25/25). Next: review, commit, run against the local plates-e2e stack (`SMOKE_PROJECT` recipe in its report), then staging as the test user.

### 10.5 Things only the owner can do
- Decide section 6 item 3 (first play from the stored copy or exact).
- Run harness-blocked commands when asked (plan grants, Secrets Manager writes, R2 CORS writes).

---

## 11. Update, 2026-11-05 evening (playback manager session)

**Owner decisions recorded:** (1) Interrupt and relaunch 3g on a revised brief (done: Argon's v1 diff is the WIP commit `26b5d5a` on `codex/live-predraw`). (2) 2026-11-05, "Yes, 0.4 is fine": a frame shown at the moment it is drawn is exact; a frame drawn ahead of playback is shown from the stored copy at the chosen quality (0.4 default); it replays while stored; no lossless temporary storage, no flag. (3) Argon does the coding; Sonnet sessions manage, brief and verify; Haiku explores; Opus advises.

**Done this session:** 4a committed as `c760509` on `codex/live-scenes` (review fixes: plan canvas on commit, dx/dy and text bounded, font floors restored for hint-free plans, flaky `plan-element-edits` timeout 10 s to 60 s; the preview-meter keeps counting `plan/edit/propose` toward the per-film call cap on purpose: it only uses an extra call on an already counted film). Engine: stronger per-frame guard written (uncommitted in `../VideoSaaS-engine`, now owned by engine-track). Plan and 3g brief revised to v2 (brief standard: Goal, Read first, Architecture rules, Locks, Acceptance criteria, Forbidden).

### Parallel tracks
| Track | Worktree | Manager session | State |
| --- | --- | --- | --- |
| engine | `../VideoSaaS-engine` (`codex/engine-inside`) | engine-track `local_05177cbd-7978-4b30-869c-4b3b5500c69e` | working: GPU first-draw explanation, storybook, timing, re-bundle proposal, report |
| 4a | `../VideoSaaS-live-scenes` (`codex/live-scenes`) | 4a-track `local_684975af-392e-4302-be34-48fde9dd39b8` | working (4a already committed c760509) |
| smoke | `../VideoSaaS-smoke` (`codex/staging-smoke`) | smoke-track `local_047b5434-ec92-4eb5-b529-4bbe7899412f` | working |
| 3g playback | `../VideoSaaS-predraw` (`codex/live-predraw`) | this session | brief v2 awaiting advisor OK, then relaunch Argon |

Locks: `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` (Docker stack) and `.lock-timing` (timing-sensitive tests); file holds the track name and time; delete when done.

### Watching Argon with parallel tracks
Record your own OpenCode session id right after launch (`opencode session list | grep "<your --title>"`); never interrupt an id you did not launch. Prefix titles with the track (`3g ...`, `engine ...`, `4a ...`, `smoke ...`). Watcher: done when your id is gone from `opencode api session.active` and the report exists; stopped when your id is gone and there is no report; stalled after 45 minutes without file changes in your worktree: replace the first test in the old loop by `grep -q "$ID"` on the active list.

3g v2 run: session `ses_e553b590effeG2e50l1dOJ6GaS` ("phase3g playback store v2", started 16:13 on 2026-11-05), brief commit `a102b4b`, base WIP `26b5d5a`.

### Engine track status (from engine-track, 2026-11-05 evening)
My guard work is WIP commit `26528e9` on `codex/engine-inside`; its brief v2 is `209f34f`; Argon session "engine inside v2" is running. Findings for the later **re-bundle brief** (step 4): the repair paths (`backend` `control.ts:299`, `store.ts:390`) keep `gen` and re-author into the same `g{gen}` object keys, overwriting `bundle.html`/`source.ts` that earlier `plate_revisions` rows point at, which contradicts the "immutable" claim in `author.ts:13`; `variantSignature` (`model.ts:316`) includes `engineDigest`, so an engine change re-authors at gen+1 (a model call) and nothing re-bundles from stored `source.ts` today; `bundleScene` is called only from `author.ts:106`. The re-bundle brief must add a no-model re-bundle path writing new content-addressed keys, and must stop repairs overwriting keys a frozen manifest references.

### Smoke track status (from smoke-track)
WIP smoke script `772b571`, v2 brief `4b0b8e8` on `codex/staging-smoke`; Argon session `ses_e553915cdffeFmt4d5CqF6DNWz` ("smoke plates v2") is doing mock fixes, then a real local-stack run that needs BOTH `.lock-plates-e2e` and `.lock-timing` (it waits up to 90 min). The staging run is not started and needs the user's go-ahead via the advisor. Expect lock contention with 3g's Chrome tests.

### 4a track status (from 4a-track)
4a + 4a fix are ONE commit `c760509` on `codex/live-scenes` (correcting section 5/10.3 above: not uncommitted, and not splittable per file). Brief v2 is `70337ae`; Argon session `ses_e5537af78ffeLXPJOWezLYWKBV` ("4a v2 element edits") is running. 4a-track's review of c760509 found: committed `worker/templates/beat-plan/index.html` stale vs `engine.js` (`build.mjs --check` fails), a lost-update race in commit/override-delete (version check outside the store lock), 500s that should be 4xx/502, override CSS emission not hardened against injection, frontend partial-commit/409/undo gaps, and the flaky test's root causes (fonts/layout not settled, fixed sleeps, git-HEAD baseline, shared ownerless rows); the 10 s to 60 s timeout bump will be reverted. Whether a rule-only `plan/edit/propose` counts toward the preview allowance is BLOCKED on the owner (my section 5 note was a guess; no decision was made).

**Owner decision, 2026-11-05 (via the advisor, relayed by 4a-track): preview meter.** `plan/edit/propose` is charged only when the model translator runs, once per comment batch; rule-based edits and failed requests (400/404/409) are free; a film with only rule-based edits takes no monthly film slot; at the cap the rule-only part is still returned and the model part gets the existing 402 refusal. Implementation brief `tools/phase4/TASK-4a-v2-meter.md` (on `codex/live-scenes`) runs after the current 4a v2 Argon run is verified. This supersedes the "blocked on the owner" line above.

### Engine track status, later (from engine-track)
Argon finished the engine fix: `docs/phase3/engine-inside-report.md` and `docs/phase3/rebundle-proposal.md` in `../VideoSaaS-engine` (uncommitted when reported). Report claims identity 67/67 in software and GPU at matched warm state (old-vs-old cold first-draw GPU variance shown; cause: GPU canvas demoted to CPU raster after the first readback plus cold caches), no skips (storybook wrapped), guard cost 0.02 to 0.07 % of draw time, engine version 0.6.4 to 0.6.5 (new `engineDigest`). engine-track is re-running both identity modes under `.lock-timing` before committing; it is the verdict owner.

### Engine and smoke: committed (from their track managers)
- **Engine:** committed as `a3cdfaf` on `codex/engine-inside` (on 209f34f brief and 26528e9 WIP; base 23e1963; not merged, not pushed). Shared indexed `insideRing` plus per-frame epoch guard, version 0.6.5, `inside-identity` 9/9, `engine.test` 7/7, `golden.json` unchanged, storybook covered, software identity 67/67 verified by engine-track. GPU identity and crayon timing rerun pending behind `.lock-timing`. **Real speed-ups to use instead of the plan's 5 to 6x:** crayon fixtures about 3.9 to 4.8x on GPU, 2.9 to 3.6x in software; style plates like lighthouse only about 1.5 to 1.8x (report section 7). Write-only re-bundle proposal: `docs/phase3/rebundle-proposal.md` (section 10: repair paths overwrite same-gen bundle keys, a prerequisite for any re-bundle brief).
- **Smoke:** committed on `codex/staging-smoke`; mock suite 33/33; two clean SMOKE PASS runs on the local plates-e2e stack (health, animate, preview-assets, comment, quote, render with a single spend, download of a real 1920x1080 H.264 MP4, refund); no app bugs found; create/script/plan mock-only until the staging run, which needs the user's go-ahead via the advisor. Not pushed.
- **Engine final:** `c2f0248` on `codex/engine-inside` (after a3cdfaf; nothing merged or pushed). GPU identity 66/67 (the one flag is the old engine's own two-valued cold first draw, same two values old and new). Crayon fixtures on GPU at 640x360: 147 to 32.5, 267 to 54.4, 185 to 46.8, 34.5 to 18 ms per frame (4.5x, 4.9x, 4.0x, 1.9x), pixels identical; guard cost 0.04 to 0.07 % of draw time. Use these numbers, not the plan's 5 to 6x.
- **Engine ACCEPTED by the advisor** (`a3cdfaf` + `c2f0248` on `codex/engine-inside`, base 23e1963, not merged, not pushed). Numbers as above; style plates like lighthouse 1.5 to 1.8x; software identity 67/67, GPU 66/67 (the one flag, `balloon-0@9:16` small, is cold-GPU first-draw variance shared by old and new). Engine version 0.6.5, so **every existing scene bundle needs re-bundling** (`docs/phase3/rebundle-proposal.md` in that worktree, including section 10: repair paths overwrite same-gen bundle keys, a prerequisite). Later tooling note: `tools/phase3/engine-identity.mjs`'s 3-page majority vote can flag items whose cold frame 0 is two-valued on GPU.
