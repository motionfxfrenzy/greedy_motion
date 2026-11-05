# Task for the coding agent: charge and quote a plate film by its real rendered length

Owner decision, 2026-11-05 ("Charge real film length", option A). Work ONLY in the worktree `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-billing` (branch `codex/billing-real-length`, cut from `codex/integrate` at 8f435ad). Never touch other worktrees. Read the whole file first; do the steps in order; if a rule blocks you, stop that part and say so.

## Goal
For plate looks (`brief.look` starting `illus-`) the render quote, the render charge and the length the storyboard shows must all equal the length of the film the export will actually produce: the sum of the scenes' frames from `buildTimeline` (voice takes included) divided by `FPS`. HyperFrames and every other look keep the planner clock (`planTiming`), unchanged.

Why (evidence from the staging baseline, report `tools/staging/out/staging-baseline-1/report.json` on branch `codex/staging-smoke`; now also under `tools/staging/` on this branch): quote 12 s (planner clock scaled toward `target_duration_s`), film 18.00 s (6 scenes with a 3 s floor from `secondsFor`), so the render was undercharged (9.6 tokens instead of 11.4). `docs/PRICING.md` says the button price is what is taken, 6 tokens + 0.3 per finished second, each started second counted whole.

## Read first
- `backend/src/plates/model.ts` (`FPS` l.10, `secondsFor` l.280, `framesForSeconds` l.284, `takeFor` l.288, `buildTimeline` l.300), `backend/src/plates/inputs.ts` (`sceneFrames` l.16)
- `backend/src/plates/exports.ts` (`buildExport` l.177: takes l.202, `buildTimeline` l.203, `durSec` l.204, returned `durationSeconds` l.322)
- `backend/src/plan/readiness.ts` (`planReadiness` l.32, `durationSeconds` at l.76, the existing `isPlate` test at ~l.40), `backend/src/plan/preview.ts` (`projectTiming` l.37)
- `backend/src/render/quote.ts` (`quoteFrom` l.28, GET quote route l.75-82), `backend/src/server.ts` POST render (l.262-300, spend at ~l.289)
- `backend/src/plan/routes.ts` composition route (l.937-958: `durationSeconds`, `readiness`)
- `frontend/components/studio.tsx` l.723-727, `frontend/components/beat-storyboard.tsx` l.321 (they only display what the API returns; verify this and change NO frontend file)
- Tests to imitate: `backend/test/render-quote.mjs` (no DB), `backend/test/plate-model.mjs` (no DB), `backend/test/plate-render-billing.mjs` (DB; Idempotency-Key, one charge, refund once; fixture `buildPlateProjectData` plus raw insert into `app.projects`), `backend/test/plate-export-manifest.mjs`
- `docs/PRICING.md` (l.9-13, l.54-62), `docs/phase5/5-report.md` (idempotency/refund semantics)

## Architecture rules
- ONE new shared function, `plateFilmSeconds(project: VideoProject): number | null`, in `backend/src/plates/inputs.ts` beside `sceneFrames`: frames = `sceneFrames(project).map(s => s.frames)`, voice seconds = `scriptBeats.map((_, i) => takeFor(project, i)?.seconds)`, result = `buildTimeline(frames, voice).totalFrames / FPS`. Sync, project-only, no I/O (`planReadiness` is sync; do not make it async, do not call `plateStatus`). Return `null` when there are no script beats.
- `planReadiness` (`readiness.ts`): when the project is a plate look (reuse the file's existing `isPlate` predicate; do not invent a second one) and `plateFilmSeconds` is non-null, `durationSeconds` = that value; otherwise `timing.total` as today. Everything else in `planReadiness` (blocking, warnings) stays as is. `server.ts` POST render and `render/quote.ts` already take `readiness.durationSeconds`, so they follow; do not duplicate the logic there. `quoteFrom` keeps `ceil` (each started second counts).
- Composition route (`plan/routes.ts` ~l.937-958): `durationSeconds` for plate looks must be the same `plateFilmSeconds` value so the storyboard shows the charged length. Do not change `beatTimes` or any other field.
- Do NOT change: `secondsFor`, `framesForSeconds`, `buildTimeline`, `planTiming` or `TIMING_RULES`, `renderCostMillitokens`/token constants (`tokens/plan.ts`), the render/refund/idempotency code, any contract in `packages/contracts`, any frontend file, any `package.json`. No new dependencies. Match the existing style (TS, `.ts` import suffixes, short doc comments saying why).
- The "target length" warning in `planReadiness` (`The film runs Ns; you chose Ms as a target`) compares `timing.total` with the target: keep it using the planner total (not the plate length). Say in the report what it does for plate films.

## Additional requirements (advisor, approved with edits)
1. **Every consumer of the changed number.** `planReadiness().durationSeconds` is now longer for plate films, so every consumer changes behaviour, not only the price. In the report list EVERY consumer of `durationSeconds` / `projectTiming(` / `planReadiness(` in `backend/src` and `frontend` with file:line and a verdict "behaviour changes: yes/no". At minimum check: the motion-blur length check (`server.ts` ~l.274-277, `motionBlurProblem(seconds)`), any plan/tier length limit (max seconds per plan, the free tier's 90 s film, `tokens/plan.ts` and `billing/`), the "film runs Ns" warning, the preview meter (`plan/preview-meter.ts`), exports, the quote route and the composition route. Write a test for each consumer whose behaviour changes (a plate film with a length on each side of the limit). **If any LIMIT changes (a film that was accepted before is now refused, or the reverse), do NOT quietly accept it: stop that item, describe it in the report with numbers, and keep the old behaviour behind the old number if that is possible without a design decision; the advisor takes it to the user.**
2. **Rounding.** State in the report and test it: the charged seconds are `Math.max(1, Math.ceil(durationSeconds))` in `quoteFrom` (`render/quote.ts` l.28-30) and the same `renderCostMillitokens(seconds)` in `server.ts` ~l.289; PRICING.md says each started second counts. `plateFilmSeconds` returns the exact frames/FPS (e.g. 540/30 = 18, 541/30 = 18.03); the quote and the charge must both turn 18.03 into 19 s and 18 into 18 s, and the smoke check will be `quote.seconds == ceil(mp4 duration)`. Test 18.00 s, 18.03 s and a fractional case with a voice take. Check that `server.ts` charges with the SAME rounded value as the quote (it passes `readiness.durationSeconds` unrounded to `renderCostMillitokens`: read that function, `tokens/plan.ts`, and say whether the charge rounds the same way as the quote; if the charge and the quote can differ, report it, do not fix `tokens/plan.ts`).
3. **Script beats vs plan beats.** `sceneFrames` reads `brief.scriptBeats`, the plan has `beatPlan.beats`. Add a test for a project where the two counts differ (a beat added or removed in the storyboard after the script) and state which list `buildExport` (`plates/exports.ts` l.177-322) and `desiredVariants` (`plates/inputs.ts` l.27-37) actually render; `plateFilmSeconds` must match what `buildExport` renders in that case, not the other list. If they cannot be made to agree without touching a forbidden file, report it with the numbers.

## Files allowed to change
`backend/src/plates/inputs.ts`, `backend/src/plan/readiness.ts`, `backend/src/plan/routes.ts`, `docs/PRICING.md` (one short paragraph/line saying plate films are priced from their rendered scene lengths via `plateFilmSeconds`), new test `backend/test/plate-film-length.mjs`, optionally a line in `backend/package.json`-free runner? NO: do not edit `package.json`; give the test command in the report instead. Report: `docs/billing/real-length-report.md` (new).

## Files forbidden
Everything else, in particular `backend/src/plates/model.ts`, `backend/src/plates/exports.ts`, `backend/src/plan/timing.ts`, `backend/src/tokens/*`, `backend/src/render/*` (read only), `backend/src/server.ts` (read only; if you find it cannot work without a change there, stop and report), all of `frontend/`, `packages/`, `worker/`, `infra/`, `compose*.yaml`, `.env*`.

## Steps in order
1. Read the files above. Run the baseline tests (below) once and record results.
2. Write `backend/test/plate-film-length.mjs` FIRST and run it to show it fails (record the failing output in the report). It must cover, for a plate project (look `illus-blueprint`, 6 script beats of ~8 words each, so every scene hits the 3 s floor):
   a. without audio: quote `seconds` (via `quoteFrom(planReadiness(project), …)`), the seconds charged (the `readiness.durationSeconds` the POST render route spends on), and `sum(buildTimeline(...).frames) / FPS` are equal; and equal what `buildExport` would put in the manifest if the existing export tests let you build one cheaply (follow `plate-export-manifest.mjs`; if not cheap, compare to `buildTimeline` over the stored variant frames and say so);
   b. with a voice take longer than a scene's floor (set `planAudio.voice.lines` like the existing tests do): the same equalities with the longer scene;
   c. a non-plate (HyperFrames/ordinary) storyboard: `planReadiness(...).durationSeconds` is byte-for-byte what it is on `codex/integrate` (assert a literal expected number computed from `planTiming` in the test, and that it is NOT changed by the plate rule);
   d. `plateFilmSeconds` returns `null` for a project with no script beats and does not throw for a project without `planAudio`;
   e. the composition route's `durationSeconds` equals the quote's source for a plate project (call the route handler the way other tests do, or assert through the same helper if the route cannot be called without a server; say which).
   Database-backed assertions (Idempotency-Key still yields one job and one spend at the NEW price; failure refunds exactly that amount once) go in the same file following `plate-render-billing.mjs`, using a fresh database: create `plates_unit_billing_test` (name contains both `plates_unit` and `test` so it passes every existing guard) with `docker exec videosaas-local-postgres-1 createdb -U videosaas plates_unit_billing_test`; never use `plates_unit`, `plates_rebundle` or `videosaas`. Do NOT start/stop/build any container or compose service; only that `createdb` and `dropdb` on your own database against the existing Postgres container are allowed (drop it at the end).
3. Implement `plateFilmSeconds`, the `readiness.ts` change and the composition route change. Re-run the new test until green.
4. Update `docs/PRICING.md` minimally.
5. Run all commands under "Tests" and record results. Write the report with: the exact diff summary (files, lines), before/after numbers for the 6-beat no-audio example (12 -> 18 s, 9.6 -> 11.4 tokens), the voice example, the non-plate unchanged proof, anything surprising (e.g. places that show film length from `projectTiming` that I did not list: grep `projectTiming(` and `durationSeconds` in `backend/src` and `frontend/` and list each use with a verdict), and open questions.

## Tests to add and exact commands
New: `backend/test/plate-film-length.mjs` (cases a to e above plus the three additional requirements). Commands (run from `backend/`):
```
node --check src/plates/inputs.ts   # skip if node cannot check .ts; use the typecheck below instead
npm run typecheck                    # or the repo's backend typecheck script; find it in package.json, do not edit it
node test/render-quote.mjs
node test/plate-model.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-film-length.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-render-billing.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-export-manifest.mjs
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/render-prep.mjs
```
If an existing test asserts the OLD plate duration, update only its expected number and say so loudly in the report (it is the intended change); any other existing failure: run it on a clean checkout of the base commit first, and report whether it already failed before your change.
Also run the frontend typecheck only if you touched nothing in `frontend/` is false: you must not touch it, so skip it.

## Measurable acceptance criteria
1. The new test fails before the change (output recorded) and passes after.
2. For the 6-beat no-audio plate example: quote seconds = charged seconds = 18 = frames/FPS; tokens 11.4; with a longer voice take the three numbers still match and equal `buildTimeline` over the take.
3. Non-plate quotes unchanged (literal assertion), `render-quote.mjs`, `plate-model.mjs`, `plate-render-billing.mjs`, `plate-export-manifest.mjs`, `render-prep.mjs` pass (or fail identically on the base commit).
4. `git diff --stat` touches only the allowed files; `secondsFor`, `buildTimeline`, `planTiming`, token constants and all frontend files are untouched (the manager will diff-check).
5. Idempotency (one job, one spend at the new price) and refund-once behaviour proven by the DB test.
6. `plates_unit_billing_test` dropped at the end; no container touched.

## Forbidden actions
No `git commit`, `git push`, `git reset`, `git stash`, `git checkout`, branch changes. No deploys. No secrets: do not read `.env*`, `infra/aws/.env*`, `*accessKeys*`, token files (including `.staging-test-token`). No staging, production, Railway, Vercel, AWS, Cloudflare, Supabase or any real model API; network only to `localhost`. No other worktrees. No Docker start/stop/build/compose commands and no use of the plates-e2e stack or ports 4100/4000/58787/59000; do not run Chrome or timing-sensitive tests (if you think you need either, stop and say so: that needs the locks `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` and `.lock-timing`, which you must not take). Do not touch the databases `plates_unit`, `plates_rebundle`, `plates_e2e`, `videosaas`.

## Report path and final line
Report: `docs/billing/real-length-report.md`. End your final message with exactly: `DONE docs/billing/real-length-report.md`
