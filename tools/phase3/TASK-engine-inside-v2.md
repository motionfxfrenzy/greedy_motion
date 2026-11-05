# Task v2 for the coding agent: finish and PROVE the exact engine speed-up (indexed point-in-shape)

You work for a manager (Claude) who re-runs your key checks. Read this whole file, then `tools/phase3/TASK-engine-inside.md` (v1: why, measurements, original rules; v2 overrides it where they differ). Do the steps in order. If a rule blocks you, stop that part and say so in the report; never work around a rule.

## Goal
Change A: the plate engine's even-odd `inside()` is indexed (bounding box + height buckets) and produces **pixel-identical output** to the engine at commit `23e1963`. Branch `codex/engine-inside` already holds an unreviewed WIP commit (HEAD `26528e9`) with: the indexed `inside`/`insideRing`/`RingIndex` in `packages/plate-engine/src/canvas-core/core.ts` and `gallery.ts`, eight other engine files routed to it, a per-frame guard (`ringEpoch`, `ringNewFrame()`, called from `renderFrame` in `film.ts`), tests `packages/plate-engine/test/inside-identity.mjs`, tools `tools/phase3/engine-identity.mjs` and `tools/phase3/crayon-fixtures.mjs`, and two result JSONs in `docs/phase3/`. The second-opinion review found the proof incomplete. This task closes it.

## Read first (exact files)
- `tools/phase3/TASK-engine-inside.md` (v1 brief) and `git diff 23e1963 -- packages/plate-engine` (all WIP changes).
- `packages/plate-engine/src/canvas-core/core.ts` (`adaptPts`, `ringNewFrame`, `insideRing`, `ringSame`), `gallery.ts` (`inside`, `hatchRuns`), `film.ts` (`renderFrame`), `storybook.ts` (exports `drawStorybook(ctx, frame, env)`, not a Film).
- `packages/plate-engine/lib/engine.mjs` (`bundleScene`, `engineDigest`), `lib/capture.mjs`, `test/engine.test.mjs`, `test/golden.json`, `PROVENANCE.md`, `NOTICE`.
- `tools/phase3/engine-identity.mjs`, `tools/phase3/crayon-fixtures.mjs`, `docs/phase3/engine-identity-result*.json` (the previous results are possibly partial; regenerate).
- Re-bundle context (read only): `backend/src/plates/author.ts`, `store.ts`, `digest.ts`, `worker/src/plates.mjs`; review wording below in step (e).

## Architecture rules
- Reuse the existing shared `inside`/`insideRing` in `core.ts`; no new point-in-polygon copies. Keep to the existing TypeScript style of `canvas-core/` and the `.mjs` test style of `packages/plate-engine/test/` (`node:assert`, plain scripts that exit non-zero on failure).
- Do not change `hatchRuns` sampling, order, steps, random draws, or any style's look. No new dependencies; no changes to `packages/contracts`, public APIs or `golden.json`.
- Rendering stays deterministic and seek-safe: any cache lives only inside one frame epoch; nothing carries state across frames except the index validated by the guard below.
- Report other hot spots with numbers; do not fix them.

## Files allowed to change
`packages/plate-engine/**` (src, test, lib only if needed for the bundled-film call path, `PROVENANCE.md`, `NOTICE`, `manifest.json`, `package.json` version only), `tools/phase3/**`, `docs/phase3/engine-inside-report.md`, `docs/phase3/engine-identity-result*.json`, `docs/phase3/rebundle-proposal.md`.
## Files forbidden
Everything else: `backend/`, `worker/`, `frontend/`, other packages, lockfiles, `.env*` and credential files, other worktrees (`../VideoSaaS-*`).

## Steps in order

**(a) First-draw differences: prove the cause.** The GPU run showed `lighthouse` (16:9, both sizes) and `moonPhases` (1:1, 640x360) where the first draw's hash differs from later draws. Using `tools/phase3/engine-identity.mjs --gpu`:
1. Run the OLD engine (from `git show 23e1963:...` into a temp copy outside the repo's tracked files, e.g. under `/tmp`-like scratch inside `tools/phase3/.tmp`, gitignored or deleted afterwards) at least 10 fresh pages each for lighthouse and moonPhases; for each page draw the same frame 5 times and record hashes. Show whether the OLD engine's first draw also varies between draws/pages.
2. Compare old vs new **after one discarded warm-up draw** of the same frame (and also report first-draw old vs new).
3. Find the cause (candidates: font or image not ready on first draw, a lazily created pattern/canvas, GPU-raster timing). Show evidence (e.g. what differs: a pixel diff region, a font-load promise, `document.fonts.status`). If the cause is the harness (not the engine), make the identity tool warm up (draw once and discard, await fonts/images) and say so. If you cannot find the cause, say so plainly; do not hide it.
4. Acceptance: identity compares old-vs-new at matched warm state; old-vs-old variance is documented with counts.

**(b) Cover storybook.** `storybook.ts` exports `drawStorybook(ctx, frame, env)`, not a Film. Add a tiny Film wrapper in the identity tool's bundling (not in engine source) so storybook is drawn and hashed old vs new at both sizes and aspect ratios. A skip is acceptable ONLY if, after a real attempt, it cannot be drawn AND the report contains a proof by full transitive import-graph check over storybook's code (every module it imports, directly or indirectly) that none reaches ANY function changed in `git diff 23e1963` (not only `insideRing`/`inside`: list every changed function and show the graph result). Otherwise cover it.

**(c) Replace/finish the mutation guard.** The WIP already has `ringEpoch`, `ringNewFrame()` (called in `renderFrame`), and a full-content `ringSame` check on first use per outline per epoch. Review it and:
1. Verify scenes bundled via `bundleScene` actually reach `renderFrame` (the bundled `FILM` path), so the per-frame reset runs in a bundled scene in the browser and in the worker. Prove it with a test that bundles a scene, edits an outline vertex (middle vertex, not just ends) between two frames, and gets the correct answer.
2. Confirm the index cache is cleared/invalidated at the start of every frame (epoch bump) and an outline is fully re-checked (all vertices, compared with `Object.is`: NaN equals NaN so an outline containing NaN does not rebuild every frame, and -0 vs 0 counts as a change, a harmless extra rebuild and never a stale index; say this in the `core.ts` comment) at its first use in each frame. Keep the cheap per-query length check.
3. Document in `core.ts` comments and the report: in-place edits of an outline **within one frame** are unsupported and are caught by the determinism check (the identical-frame double-draw check). Add a test that demonstrates the documented behaviour (edit between frames: correct; edit within frame: documented limitation, no crash).
4. Property test still passes: >=200,000 points x >=300 outlines (convex, concave, self-touching, spiky, duplicate and horizontal edges, points exactly on vertices/edges, NaN/Infinity) equal to a copy of the old function.

**(d) Crayon-film draw timing, before and after.** Use `tools/phase3/crayon-fixtures.mjs` against `frontend/test/fixtures/crayon-staging/` (read only): median ms per frame at 640x360 (and 1920x1080 if the script supports it), old engine vs new engine, per fixture, with the exact methodology. **Take the timing lock first** (see Forbidden). Report old and new hashes of the drawn frames too (must match). Also measure the per-frame cost of the guard's full-content check on the crayon fixtures (ms per frame and as a % of draw time); report it and flag it if above 5% of draw time.

**(e) Re-bundle proposal (WRITE ONLY, implement nothing).** Write `docs/phase3/rebundle-proposal.md` following review point 6.7: existing scenes embed the old engine in their bundle; produce a new bundle from the saved source with no model call. Required content: where each scene's source is stored and under what key (cite files/lines); what new `engineDigest`/`bundleDigest` mean and what they invalidate (clip cache keyed by digest); the rule that a re-bundle creates a **new content-addressed revision and never overwrites a bundle object that a frozen render manifest points to**; previews switch to the new bundle **only after the new bundle object exists and is verified**; rollback; which code path (repair? a job?) and which backend/worker files would change; a test plan. Say what is unknown.

**(f) Report** `docs/phase3/engine-inside-report.md`: what changed (files, line counts), the guard design and its documented limit, old-vs-old variance table, old-vs-new identity table per style (incl. storybook) at both sizes in software and GPU modes (counts of identical / total), property-test counts, golden test result, timing tables, hot spots seen, anything not done. Update `PROVENANCE.md` / `NOTICE` if the guard changes them; bump `package.json` `version` only if `engineDigest` depends on it (say which).

## Tests to add and exact commands to run (all from `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-engine`)
```
node packages/plate-engine/test/engine.test.mjs
node packages/plate-engine/test/inside-identity.mjs
node tools/phase3/engine-identity.mjs            # software rendering
node tools/phase3/engine-identity.mjs --gpu      # GPU rendering (needs the timing lock)
node tools/phase3/crayon-fixtures.mjs            # timing (needs the timing lock)
```
Use whatever flags the tools actually define; document them in the report.

## Measurable acceptance criteria
1. `engine.test.mjs` passes with unchanged `golden.json`; `inside-identity.mjs` passes, including the new bundled-scene mutation test and the property test at the stated sizes.
2. Identity tool: `allIdentical: true` in both software and GPU modes, **no skipped cases**, unless storybook is skipped with the full import-graph proof required in (b), in which case the report says so in the identity table; old==new at both sizes for every item, and old-vs-old variance explained with numbers.
3. Report states the cause of the first-draw differences with evidence, or states plainly that it is unknown.
4. Crayon timing table old vs new with identical frame hashes, plus the guard's per-frame cost (ms and % of draw time).
5. `docs/phase3/rebundle-proposal.md` exists and covers every item in (e); no backend/worker file is changed.
6. `git diff` touches only allowed files.

## Forbidden actions
- No `git commit`, push, reset, stash, checkout or branch change (the manager commits). No deploys. No secrets, no `.env*`, no credential files. No network except localhost servers on random free ports (never 3000, 4000, 4100, 8766, 55432, 58787, 59000). No staging/production/cloud/model calls. No other worktrees.
- **No Docker / plates-e2e stack.** Timing-sensitive runs (GPU identity, crayon timing, first-draw experiments) only while you hold the lock: create `/Users/osamaehsaan/Code/Market_apps/.lock-timing` containing `engine <time>`; write it atomically (`set -o noclobber; echo "engine $(date)" > FILE`, or `mkdir`), never check-then-create. If the lock is held by someone else, do the non-timing parts first ((b) in software mode, (c), (e), the property test), then come back to the timing runs; never delete or overwrite a lock you did not create; if it is still held after 90 minutes in total, stop the timing part and say so in the report. Delete your own lock when done, even on failure.
- Never use `--auto`-style shortcuts; never change a test's expectation to make it pass.

## Report path
`docs/phase3/engine-inside-report.md`. End your final message with exactly: `DONE docs/phase3/engine-inside-report.md`
