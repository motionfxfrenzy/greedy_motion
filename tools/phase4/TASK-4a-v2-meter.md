# Task for the coding agent: phase 4a v2 meter, charge only when the model runs

You work for a manager (Claude) who re-runs your key checks and reads your diff. Read this whole file first and do what it says, in order. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` (branch `codex/live-scenes`). Phase 4a (`c760509`) and 4a v2 (committed by the manager before this run) are in place. Do not commit. Work only in this worktree.

## Goal
Implement the owner's decision on the preview meter, recorded 2026-11-05. Their words: "go with Only when the model runs: rule-based edits and failed requests are free, and a model-based edit counts once per batch of comments. A film with only rule-based edits doesn't use a monthly film slot."

## Read first
- `backend/src/plan/preview-meter.ts` (the `COUNTED` regex, `admitPreview`, `registerPreviewMeter`, `meteringOn`, `PreviewRefusal`), `docs/PRICING.md` (preview allowance), `backend/test/` files that test the meter (grep `admitPreview`, `preview_usage`, `meteringOn`, `PREVIEW_LIMITS`)
- `backend/src/plan/routes.ts` (`POST /v1/projects/:id/plan/edit/propose` and how other counted routes behave on a refusal)
- `backend/src/plan/element-edits.ts` (`proposeHyperFramesCommentEdits`, `translateCommentWithRulesThenModel`, where the model translator is called)
- `docs/phase4/element-edits-report.md` section "4a v2" (what was already changed, including the B3a ownership fix in the meter)

## Architecture rules
- Reuse `admitPreview` and the exact `PreviewRefusal` shape with the 402 status the other counted routes use; invent no new shape, helper or status. Do not change which other routes are counted or what they cost.
- No new dependencies; no changes to `package.json` or lockfiles; no change to public API shapes except that a propose candidate may carry a `refused` reason holding the existing refusal body.
- Keep the 4a v2 changes (compare-and-set, error mapping, B3a) intact.

## Files allowed to change
`backend/src/plan/preview-meter.ts`, `backend/src/plan/routes.ts`, `backend/src/plan/element-edits.ts`, `backend/test/` (a new `plan-edit-meter.mjs` and, only if needed, the existing `plan-edit-no-chrome.mjs`), `frontend/lib/api.ts` and `frontend/components/browser-animation-step.tsx` (only to show the cap-reached message on a refused comment, if the existing refused-reason display does not already show it), `frontend/test/` (a matching test), `docs/phase4/`, `docs/PRICING.md` (only a sentence if it describes comments as uncounted or counted).

## Files forbidden
Everything else, including `frontend/lib/live/`, `backend/Dockerfile`, any `package.json` or lockfile, `worker/`, `packages/contracts/`, all other worktrees.

## Steps in order
1. Remove `plan/edit/propose` from `COUNTED` in `preview-meter.ts`.
2. In the propose route, after ownership and plan validation, run the rule-based translator for every comment. If at least one comment needs the model translator, call `admitPreview` once for the batch (respect `meteringOn()`), then run the model for those comments. Rule-only batches and requests that fail validation (400, 404, 409) cost nothing.
3. If `admitPreview` refuses: return the rule-only candidates normally; each comment that needed the model comes back as `{ id, refused: <the refusal message> }` carrying the same code and body as the other counted routes' refusal (402 body), and the model is not called.
4. An admitted charge stays charged if the model call then fails. Check how the other counted routes behave (they count in the `preHandler` before the route runs and never refund) and match that; cite the lines in the report.
5. The film-slot rule is unchanged (the first counted call takes the slot, `admitPreview` already does this): a film with only rule-based edits takes no slot.
6. Fix the header comment in `preview-meter.ts` (lines 11 to 13) so it states the real rule, including that propose is counted only when the model runs, once per batch.
7. Frontend: a refused comment must show the cap message in its existing refused-reason slot; if that already works with the new candidate shape, change nothing there and say so.

## Tests to add and exact commands
New `backend/test/plan-edit-meter.mjs` (real Postgres, randomUUID owner and ids, scoped cleanup, `PREVIEW_LIMITS=on` set explicitly, `PLANNER=deterministic` plus a stubbed model translator as in `plan-edit-no-chrome.mjs`; no real model calls). Cases:
1. rule-only propose: no `preview_usage` row, no call counted, no film slot;
2. model propose with two comments needing the model: exactly one call counted for the batch, the film slot taken once;
3. mixed batch (one rule comment, one model comment): one charge;
4. failed validation (bad snapshots 400, unknown project 404, stale 409): no charge;
5. at the cap (`PREVIEW_CALL_CAP` reached for the project, and, separately, the monthly film allowance reached with a new film): the rule-only part is returned, the model part gets the documented 402 refusal body, the model stub is not called;
6. metering off (`PREVIEW_LIMITS=off`): never charged;
7. model failure after an admitted charge: the charge stays.
Run: `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plan-edit-meter.mjs` and `test/plan-edit-no-chrome.mjs`, `test/plan-element-edits.mjs`, plus any existing meter test.
Then the full backend loop once, from `backend/`:
```
for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```
Expected: only the 5 known failures (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`). Also `cd backend && npm run typecheck` and, if you touched the frontend, `cd frontend && npm run typecheck && node --test --test-concurrency=1 "test/*.mjs"`.

## Measurable acceptance criteria
1. All seven test cases pass, three runs in a row.
2. Full backend loop: only the 5 known failures.
3. Typechecks clean; frontend suite unchanged in pass count if touched.
4. `COUNTED` no longer contains `plan/edit/propose`; grep proves it; the header comment states the real rule.

## Forbidden actions
- No `git commit`, `push`, `reset`, `stash`, `checkout`, `rebase`, `merge`.
- No deploys, no Railway/Supabase/AWS/Cloudflare calls, no secrets, no real model API calls, no other worktrees, no `opencode run --auto`, no launching other agents, no touching `videosaas-local-postgres-1` or `videosaas-local-worker-1`.
- Locks: the full backend loop is timing-sensitive; before it create `/Users/osamaehsaan/Code/Market_apps/.lock-timing` containing `4a` and the time (wait if it exists), delete it when finished. This task needs no Docker stack. Do not interrupt any OpenCode session that is not yours.

## Report
Append a section "4a v2 meter" to `docs/phase4/element-edits-report.md`: the owner's decision (quote above, dated 2026-11-05), files changed, the seven test results, the cited lines for the no-refund rule, loop results. End your final message with exactly one line:
`DONE docs/phase4/element-edits-report.md#4a-v2-meter`
