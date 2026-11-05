# Task for the coding agent: phase 4a fix, measure in the user's browser, persist what is applied, wire the model translator

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` (branch `codex/live-scenes`). Your phase 4a work is still uncommitted there; build on it. Read your own report `docs/phase4/element-edits-report.md` first.

## Why (manager review of 4a, 2026-11-05)
4a works on this Mac, but it cannot work where the app is deployed:
1. `backend/src/plan/element-edits.ts` launches headless Chrome inside the API process (`getSharedBrowser`, dynamic `playwright-core`). The deployed backend image (`backend/Dockerfile`) has **no Chromium** and `playwright-core` is only a root devDependency, so on staging/production every `POST /v1/projects/:id/plan/edit` and `GET /plan/elements` fails. (The manager's own brief asked for "headless Chrome with the real engine"; that was the mistake, not yours.)
2. When the route fails, `frontend/components/browser-animation-step.tsx` (`applyComments`, the `__bp.elementsAt` branch around lines 494 to 608) classifies in the browser and marks comments `changed colour` / `nudged position`, but **never saves the override** (no API call persists `elementUpdates[].override`). The user would see "changed colour" and nothing changes: a silent false success.
3. Comments are turned into patches only by `deterministicCommentTranslator` (regexes). `COMMENT_TO_PATCH_SYSTEM_PROMPT` exists but no model translator is wired, so ordinary comments ("make the headline pop") never become element or scene patches.

Decision (final): **the user's browser measures; the server decides and saves.** The preview iframe already runs the same engine and exposes `window.__bp.elementsAt(t)`. No Chrome on the API server.

## What to build

### 1. Two-step edit protocol (replace server-side Chrome sampling)
- `POST /v1/projects/:id/plan/edit/propose` body `{ comments: [{ id, at, scene, body }], measured: { canvas, snapshots: { [commentId]: FrameElementsSnapshot[] } } }`. The browser sends, for each comment, snapshots of the active elements sampled across the **whole active window of the beat** (the same times `resolveBeatWindowTimes` picks today; move that helper to `packages/contracts` so both sides use it). The server validates the snapshot shape strictly (ids that exist in this plan's `data-el` scheme, finite boxes, bounded counts: at most 64 elements per snapshot, at most 24 snapshots per comment), runs the translator (step 3) and returns, per comment, a **candidate** `EditPatch` (or `{ refused: reason }`), plus the plan version it was proposed against. Nothing is saved.
- The browser applies each candidate **locally** to the preview (element overrides and beat hints through the same `hf-variables` path the engine already reads; reload the srcdoc composition, never a server render), re-samples the same window, and sends `POST /v1/projects/:id/plan/edit/commit` `{ planVersion, items: [{ id, patch, before, after }] }`.
- The server re-runs the pure `classifyEditPatch` / `checkSceneHintLayout` on those snapshots (the classifier, not the model, decides scope, as before), refuses a stale `planVersion` with 409, and saves element `overrides` or beat `hints` / re-fitted text exactly as 4a does. It returns the saved plan and per-comment `{ scope, uiLabel, el }`.
- Remove `getSharedBrowser`, the `playwright-core` import and `sampleCompositionElements` from the backend request path. `GET /plan/elements` either goes (the browser asks its own iframe) or is kept only as a test helper outside the server; say which in the report. Keep the old `POST /plan/edit` only if you need it for a test; it must not be called by the app.
- Trust note to implement: measurements come from the user's own browser and only ever affect that user's own project; validate shapes and bounds, never execute anything from them.

### 2. Frontend: never claim a change that was not saved
- `applyComments` uses propose -> local apply + measure -> commit. A comment is labelled `changed colour` / `nudged position` / `changed text` / `re-laid out the scene` **only after commit returns it as saved**. On a refusal, show the plain reason on that comment and keep it unapplied. On any network or server error, show an error and leave the comment unapplied; delete the silent `__bp.elementsAt` classify-only branch.
- Undo stays `DELETE /plan/overrides/:el`, then reload the preview.
- If the iframe has no `__bp.elementsAt` (an old composition), fall back to the existing scene-level storyboard rewrite path, labelled as today.

### 3. Translator: rules first, then the model
- Keep `deterministicCommentTranslator` first. When it finds no patch, call a model translator implementing `CommentPatchTranslator` with `COMMENT_TO_PATCH_SYSTEM_PROMPT` through the backend's existing model client (find how `backend/src/plan/` calls the model today and reuse it, including timeouts, cost logging and the preview meter rules). Output must pass `validateEditPatch`; anything invalid becomes "scene" with the existing storyboard rewrite, never a guess.
- Tests use the existing stub/recorded-response pattern; **no real model API calls**. Add at least 8 recorded comment cases (vague, multi-element, impossible, non-English short phrase) with their expected patch or fallback.

### 4. Tests and checks (acceptance criteria)
- A backend test proving the server path never imports or launches Chrome (for example: run the route tests with `playwright-core` resolution blocked) and that propose/commit work with snapshots only.
- Port the 13+1 scenario table from your report to the new protocol: snapshots come from headless Chrome **in the test harness** (as the browser would produce them), the server only receives JSON. Same expected scopes and outcomes.
- Frontend: a headless-Chrome interaction test of the real protocol against a stub server: element edit saved and labelled; refused edit shows the reason, not a label; server error shows an error, not a label; undo.
- Engine output without edits stays **pixel-identical** (you must not change `engine.js` layout for unedited films; re-run `capture-hf.mjs` and `capture-final.mjs` and compare with `tools/phase3/hf-baseline` and `tools/phase3/hf-final-baseline`, and the plates `capture.mjs` 68/68 against `tools/phase3/baseline`).
- `tools/phase4/render-parity.mjs` still passes on the local stack (preview equals final render for an override and a hint).
- Frontend typecheck and suite, backend typecheck and suite: only the 5 known backend failures (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`).

## Rules (hard limits)
- Allowed paths: `backend/src/plan/`, `backend/test/`, `packages/contracts/src/`, `frontend/components/browser-animation-step.tsx`, `frontend/components/animation-workspace/`, `frontend/lib/api.ts`, `frontend/test/`, `worker/templates/beat-plan/` (only if a bug forces it; then rebuild `index.html` and prove pixel identity), `tools/phase4/`, `docs/phase4/`. Do **not** touch `frontend/lib/live/`, `frontend/components/plate-live-stage.tsx`, `backend/Dockerfile`, `package.json` files or lockfiles.
- Local only: no commits, pushes, deploys, cloud, Railway, Supabase or AWS calls, no real model API, no secrets. Servers bind `127.0.0.1` on free ports.
- Docker: only the plates-e2e services for `render-parity.mjs`, started with `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker` and stopped with the targeted `... down plate-worker plate-api llm-stub objectstore`. Never touch `videosaas-local-postgres-1` or `videosaas-local-worker-1`. Another agent works in `../VideoSaaS-predraw` and is forbidden Docker, so the stack is yours while you run.

## Deliverable
Append a section "4a fix: browser measurement" to `docs/phase4/element-edits-report.md`: files changed, the protocol (requests and responses), the ported scenario table, the model-translator recorded cases, all before/after test counts and pixel comparisons, and anything you could not do. End your final message with exactly one line: `DONE docs/phase4/element-edits-report.md#4a-fix`.
