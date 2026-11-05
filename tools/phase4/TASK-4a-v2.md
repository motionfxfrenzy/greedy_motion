# Task for the coding agent: phase 4a v2, reliable tests, safe commit, review gaps (meter blocked)

You work for a manager (Claude) who re-runs your key checks and reads your diff. Read this whole file first and do what it says, in order. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` (branch `codex/live-scenes`). HEAD `c760509` holds phase 4a and the 4a fix (already committed; do not commit). Read `docs/phase4/element-edits-report.md` and `tools/phase4/TASK-4a-fix-browser-measure.md` first. A manager review of `c760509` found the gaps below; fix them. Work only in this worktree.

## Goal
1. Make `backend/test/plan-element-edits.mjs` reliable under load by removing the root causes (not retries, not longer timeouts) and prove it with the full backend loop three times in a row, zero failures beyond the 5 known ones.
2. Fix the correctness and safety gaps in the 4a code listed in "Gaps".

## Read first
- `docs/phase4/element-edits-report.md`, `tools/phase4/TASK-element-edits.md`, `tools/phase4/TASK-4a-fix-browser-measure.md`
- `backend/test/plan-element-edits.mjs`, `backend/test/plan-edit-no-chrome.mjs` (copy its style: randomUUID ids, scoped deletes), `backend/test/plan-captions-audio-patch.mjs`, `backend/test/entitlements.mjs` (per-run owner and cleanup pattern, lines ~38-40), `backend/test/job-control.mjs` (database-name guard, line ~9)
- `backend/src/plan/element-edits.ts`, `backend/src/plan/routes.ts` (edit/propose, edit/commit, overrides delete, PATCH /plan), `backend/src/plan/preview-meter.ts`, `backend/src/projects/store.ts` (`updateProjectPlan`, its serialisation)
- `packages/contracts/src/edit-patch.ts`, `worker/templates/beat-plan/engine.js`, `build.mjs`
- `frontend/components/browser-animation-step.tsx`, `frontend/lib/api.ts`, `frontend/components/animation-workspace/CommentsPanel.tsx`, `frontend/test/hf-step-interaction.mjs`

## Architecture rules
- Keep the decided design: the user's browser measures, the server classifies and saves; no Chrome, Playwright or Puppeteer in `backend/src/plan/` (the test harness may still use `playwright-core`).
- Reuse existing helpers and error shapes; do not invent new ones. For HTTP errors reuse the helpers and status mapping the neighbouring routes in `routes.ts` use (the PATCH route maps `ProjectInvalid` to 400 at about line 908: copy that).
- No new dependencies; no changes to `package.json` or lockfiles; no change to public API shapes except where a Gap below says so. Deterministic and seek-safe rendering: no `Math.random`, `Date.now`, `performance.now`, or layout-dependent state in `engine.js`.
- Engine output for films without edits must stay pixel-identical (see acceptance).

## Files allowed to change
`backend/src/plan/`, `backend/src/projects/store.ts` (only for the compare-and-set support in Gap B1), `backend/test/` (only `plan-*` files, plus the new test files you add), `packages/contracts/src/edit-patch.ts`, `worker/templates/beat-plan/` (`engine.js` and the rebuilt `index.html`), `frontend/components/browser-animation-step.tsx`, `frontend/components/animation-workspace/`, `frontend/lib/api.ts`, `frontend/test/` (edit-patch and hf-step files, plus new ones), `tools/phase4/`, `docs/phase4/`.

## Files forbidden
`frontend/lib/live/`, `frontend/components/plate-live-stage.tsx`, `backend/Dockerfile`, any `package.json` or lockfile, `backend/src/site/`, other backend tests (e.g. `plate-export-manifest.mjs`: do not edit it even though its unscoped deletes are a hazard; list it in the report), all other worktrees.

## Part A: make `plan-element-edits` reliable (root causes)
The manager's analysis found these causes; verify each and fix the real ones. Do not add retries and do not lengthen timeouts.
- A1. The test samples element boxes right after `window.__bp.elementsAt` exists (about line 262-268) before fonts and layout settle. Wait on explicit readiness (`document.fonts.ready` plus a settled animation frame) inside `sampleHtmlInTestBrowser`, as `compareTemplateZeroDiff` partly does.
- A2. Fixed sleeps before screenshots (about lines 470, 477, 483) feed a strict zero-difference check. Replace them with an explicit ready signal.
- A3. Non-hermetic baseline: the old template comes from `git show HEAD:...` while the new one is read from the working tree (about lines 368, 372). Make the baseline a fixture: commit-independent (for example a checked-in copy of the old template under `backend/test/fixtures/`, taken from `git show 88d4efa:worker/templates/beat-plan/index.html`) so the test does not change meaning when HEAD moves.
- A4. Hard-coded origins and ports (`127.0.0.1:18999`, `18998`), also in the production builder `buildStandaloneCompositionHtml`. Use an ephemeral port (listen on 0) in the test; if the production constant is only a bootstrap placeholder, make it relative; say what you did.
- A5. The 10 s to 60 s timeout bump in commit `c760509` (`waitForFunction`, about line 276) hides the cause. Revert it to the original value unless you measure (with numbers in the report) that readiness genuinely needs longer, and then wait on a readiness signal instead.
- A6. Ownerless project rows (`createProject` without an owner): give each run its own `randomUUID` owner and delete by that owner before and after (pattern in `entitlements.mjs`), so a killed run leaves nothing visible to the local user.
- A7. Environment gates: set `PLANNER = "deterministic"` and `CREEM_API_KEY = ""` unconditionally (not `??=`) so inherited variables cannot send the test to a model or to moderation.
- A8. Scenario coupling: the 14 scenarios mutate one project and depend on each other (scenario 5 depends on scenario 4's delete, scenario 6's hints check on a PATCH at about line 883, scenario 8 rewrites `b1.on_screen`). Seed one project per scenario (or reset explicitly and assert the reset). Check the unchecked PATCH response.
- A9. The server contract checks (propose, commit, 409, 422) already run without Chrome in `plan-edit-no-chrome.mjs`; keep Chrome only where measured boxes are needed.
- A10. Look for any further cause (shared DB rows, leaked servers or browsers, handles that keep the process alive) by running the file under artificial load (see Tests). Write down what you found and what you fixed.

## Part B: gaps in the 4a code
B1. **Lost-update race on commit and override delete.** `POST /plan/edit/commit` reads the project, checks `planVersion` against that snapshot outside any lock, then `updateProjectPlan` writes a plan built from the stale read (`routes.ts` about lines 1091-1132, `store.ts` about lines 411-421). Two commits on the same version both pass; a concurrent `PATCH /plan` can be lost. `DELETE /plan/overrides/:el` (about lines 1150-1169) has the same read-modify-write. Fix: do the version check and the commit inside the store's serialised mutate (compare-and-set), throwing the stale-version error from inside; apply the same to the override delete. Test: two concurrent commits on the same `planVersion`: exactly one succeeds, the other gets 409 `stale_plan_version`; and a commit racing a `PATCH /plan` never loses either write silently.
B2. **Errors that surface as 500.** Map `ProjectInvalid` thrown by `updateProjectPlan` (state "Rendering draft") on commit and override delete to the same 4xx the PATCH route uses; map model transport errors (timeout, 502) in propose to a plain 502/503 with a user-readable message (use the existing error helper pattern); guard `decodeURIComponent` of `:el` and return 400. Remove the dead `canvas` input on commit or use it (say which).
B3. **Preview meter: BLOCKED pending the owner's decision.** Do NOT change the `COUNTED` list or the metering of `plan/edit/propose` in `preview-meter.ts`. Leave the current behaviour and record in the report the facts you observe (what is charged today and when). A follow-up brief will add the chosen design. Write no meter-design tests.
B3a. **No usage row for an unknown or unowned project (a bug whatever the owner chooses).** Today the meter hook inserts an `app.preview_usage` row for any well-formed project UUID, even one that does not exist or belongs to someone else (the ownership hook lets an unknown id through). Make the charge happen only after the project is found and owned by the caller, for every route in `COUNTED`, without changing which routes are counted or how much they cost. This is the only change allowed in `preview-meter.ts`. Test: a random UUID creates no `preview_usage` row and gets the same response as before; a real owned project is charged exactly as before.
B4. **Stale `worker/templates/beat-plan/index.html`.** `node worker/templates/beat-plan/build.mjs --check` exits 1 at HEAD: `index.html` is older than `engine.js` (it lacks the review fixes "bounded offsets and text, original font floors"). Rebuild it with `node worker/templates/beat-plan/build.mjs`, then prove the unedited output is still pixel-identical (acceptance), and make `--check` part of a backend or frontend test so this cannot drift again.
B5. **Unsafe override CSS and weak validators.**
  - `engine.js` writes `ov.color`, `ov.opacity`, `dx`, `dy` raw into the runtime `<style id="bp-overrides">` and element ids are only quote-stripped. Validate in the engine as well: colour must be `#rgb`/`#rrggbb`/`#rrggbbaa` or a known named colour (own-property check), opacity and offsets finite numbers within the same bounds the contract enforces, element ids matching the `data-el` scheme; anything else is ignored. A colour like `red}*{display:none` must not reach the stylesheet. Keep the engine seek-safe.
  - `normalizeColorValue` (`edit-patch.ts` about line 619) accepts prototype keys (`constructor`, `toString`, `__proto__`): use an own-property check.
  - Add: upper bound on `atSeconds`, scene id format check, a length cap on override text, rejection of duplicate element ids in a snapshot, `validateBeatLayoutHint` applied to `set.scale` before it becomes `hints.factor`, and a re-check of accumulated `dx`/`dy` (the ±4000 cap) in `applyCandidatePatchToPreviewHtml`.
  - Classifier: an explicit `scope: "scene"` patch with an `el` must not be downgraded to `"element"`; unequal before/after snapshot lengths must be refused rather than silently truncated.
  Tests for each (colour injection string, prototype keys, duplicates, the scope downgrade, unequal lengths).
B6. **Frontend (`browser-animation-step.tsx`, `api.ts`, `CommentsPanel.tsx`).**
  - 409 on propose or commit shows "The plan changed; apply again" and leaves comments pending (today it falls to the generic "Could not save comment edits.").
  - Partial results: comments missing from `candidates` or `results` get a visible reason; a 422 with `commentId` marks that comment and, for the rest of the batch, says whether they were saved (the commit is all-or-nothing on the server: confirm that and state it in the UI message).
  - If the scene-level storyboard fallback (`onApplySceneComments`) throws after element items were committed, keep their saved labels but show the error for the failed part, and reload the preview so it matches the saved plan.
  - Measure each candidate in isolation (`before` and `after` for item N must not include items 1 to N-1 applied in the same working copy, or the commit must send the combined sequence consistently; pick one, say which, and test it).
  - `if (player && workingHtml)` must not send `after = before` when the player is missing: treat it as an error.
  - Guard double triggers with a ref; cancel the 25 ms ready-poll on unmount and on a newer call; confirm the iframe document is the one just loaded.
  - Undo: do the DELETE first and remove the comment only on success; on failure keep the comment and show the error; always reload the preview and restore the playhead; for items without `appliedEl` (scene and fallback), the button must say "Remove comment" and not claim to undo.
  - Disable remove and undo while an apply is running.
  - A11y: the refusal message lives in a persistent `role="status"` container; the undo/remove buttons get an accessible name that includes the comment text or time.
  Add headless-Chrome interaction tests in `frontend/test/hf-step-interaction.mjs` for: 409, partial 422, undo failure keeps the comment, fallback failure after a committed element item.

## Steps in order
1. Read all "Read first" files. Confirm the Gaps against the code; if one is wrong, say so in the report and skip it.
2. Part A (tests first): make the problems reproducible with the load recipe below, fix, rerun.
3. B1, B2 (backend), with their tests. Skip B3 (blocked); do B3a.
4. B5 and B4 (contracts and engine; rebuild `index.html`; pixel identity).
5. B6 (frontend) with tests.
6. Run all verification below, three full backend loops, and write the report.

## Tests to add and exact commands
Backend, per file: `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/<file>.mjs`.

Full backend loop (run it three times in a row; the third run must be clean, and so must the first two). Run it from `backend/`:
```
for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```
Expected output each time: exactly the 5 known failures `billing`, `brand-files`, `render-prep`, `styles`, `visuals`, and nothing else.

Load recipe (to reproduce and to prove the fix): run `plan-element-edits.mjs` while four CPU busy loops run (`for i in 1 2 3 4; do (while :; do :; done) & done`, then kill them), and run it five times back to back under that load, all must pass. Put the numbers in the report. Kill your busy loops when done.

Other commands:
- `cd frontend && npm run typecheck && node --test --test-concurrency=1 "test/*.mjs"`; if `test/hf-step-interaction.mjs` or `test/final-view-interaction.mjs` times out cold, rerun that file alone.
- `cd backend && npm run typecheck`
- `node worker/templates/beat-plan/build.mjs --check` (exit 0)
- Screenshots (HyperFrames, against the committed baselines): `node tools/phase3/capture-hf.mjs <dir>` then `node tools/phase3/compare.mjs tools/phase3/hf-after <dir> <diffdir>`; `node tools/phase3/capture-final.mjs <dir>` then compare against `tools/phase3/hf-final-after`. Use new directories under the scratchpad or `/tmp/opencode/` outside the repo; do not add images to the repo.
- Plates screenshots are not needed (no plates change).
- `node tools/phase4/render-parity.mjs` needs the Docker stack: take the lock below first; skip it if you changed nothing in the worker engine output path, but you did rebuild `index.html`, so run it.

## Measurable acceptance criteria
1. Three consecutive full backend loops: only the 5 known failures, none other.
2. `plan-element-edits.mjs` passes 5 of 5 runs under the load recipe, and the 60 s wait is reverted or justified with a measurement.
3. `build.mjs --check` exits 0; unedited HyperFrames output pixel-identical to the pre-change template for kinetic, ui and title scenes (the existing zero-diff test, now with the fixture baseline); `capture-hf` vs `hf-after` at most the known 0 to 2 pixel noise on at most 3 images, `capture-final` vs `hf-final-after` 36/36 identical.
4. The new tests exist and pass: B3a (no row for an unknown project), concurrent commits (one 200, one 409), commit vs PATCH, error mapping (4xx/502/400), colour injection and the validator additions, the frontend interaction cases.
5. Frontend typecheck and suite, backend typecheck: clean, with test counts before and after in the report.
6. No Chrome/Playwright import under `backend/src/plan/` (grep proves it).
7. `render-parity.mjs` passes on the local stack.

## Forbidden actions
- No `git commit`, `push`, `reset`, `stash`, `checkout`, `rebase`, `merge` (use `git diff` only). Do not discard the manager's `c760509`.
- No deploys, no Railway/Supabase/AWS/Cloudflare calls, no secrets, no real model API calls, no other worktrees (`../VideoSaaS-predraw`, `-engine`, `-smoke`, `-deploy` are off limits).
- No `opencode run --auto` and no launching other agents.
- Never touch the Docker containers `videosaas-local-postgres-1` or `videosaas-local-worker-1`.
- **Locks.** Only one track at a time may use (1) the plates-e2e Docker stack (compose project `videosaas-local`) and (2) timing-sensitive runs (Chrome pre-draw tests, identity or timing measurements). Before starting the stack for `render-parity.mjs`, create `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` containing `4a` and the time; if the file exists, wait (check every minute) until it is gone. Delete it as soon as you tear the stack down with `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore` (never a bare `down`). The full backend loop and the load recipe are timing-sensitive: before them create `/Users/osamaehsaan/Code/Market_apps/.lock-timing` the same way, and delete it when finished. Do not hold a lock while idle. Other tracks run Argon sessions at the same time; do not interrupt any OpenCode session that is not yours.

## Report
Append a section "4a v2" to `docs/phase4/element-edits-report.md`: for each of A1 to A10 and B1, B2, B3a, B4, B5, B6 (B3 is blocked), what was wrong (confirmed or not), what you changed (files), and the test that proves it; the load-recipe numbers; the three loop results; the pixel comparisons; test counts before and after; anything you could not do or decided differently, and tech debt you saw (for example the unscoped deletes in `plate-export-manifest.mjs`, and `camTextBox` in `engine.js` using `getBoundingClientRect`). End your final message with exactly one line:
`DONE docs/phase4/element-edits-report.md#4a-v2`
