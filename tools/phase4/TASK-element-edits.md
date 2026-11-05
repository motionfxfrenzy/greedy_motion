# Brief (RELEASED 2026-11-05, phase 4a): element-level and scene-level comment edits for HyperFrames films

Status: released by the manager on 2026-11-05 after phases 3a to 3e, the job-control integration and phase 5 were finished, reviewed and committed. Scope of this release: **the HyperFrames side only (4a)**. The plates side (params schema authored by the model, params-first edits, revision pruning) is phase 4b and needs a real model, so it is NOT part of this task; keep the shared patch module independent of it, as written below.

You work for a manager (Claude) who reviews everything you produce. Read this whole file first. Do what it says, nothing more. If a rule blocks you, stop that part and say so in the report; never work around a rule.

## The decision (product owner)

A timed comment can change one element or a whole scene, and the system must tell which:
- **Element-level** (applied directly, instantly, undoable): a change that **cannot affect anything else on screen**, such as text colour, opacity, or text of the same length class when no other element depends on its size, or a position nudge that stays clear of every other element and inside the safe area.
- **Scene-level** (handled by re-laying-out or re-authoring the whole scene with the whole space in mind): any change that **affects other elements or the layout**, such as making something bigger or smaller, longer text, moving something into another element's space. Scaling in particular is never a blind per-element transform: growing one word must make the scene reconsider the whole frame (as the owner put it, "it should consider the whole space").

## Facts from the spike (read `docs/phase3/element-edit-spike.md`)
- HyperFrames: elements can be listed at a time T; they have no stable ids; every element is created by `mk()` in `worker/templates/beat-plan/engine.js` (one central place); colour, `translate` and `scale` overrides apply cleanly and survive seeking; **font-size reflows the whole line; scale grows in place and overlaps neighbours because the engine lays out from character counts**; the `hf-variables` block already carries edits to both preview and the final render (`backend/src/plan/composition.ts` `fillTextBlock`, `backend/src/plan/preview.ts`).
- Plates (`docs/LIVE_SCENES_PLAN.md` sections 8 and 13): params-first edits with a schema, `plate_revisions` for undo, `bundleDigest` includes the params digest.

## What to build

1. **One shared patch format and one classifier**, in a shared module (for example `packages/contracts/src/edit-patch.ts`) used by both engines:
   - Patch: `{ "scope": "element" | "scene", "scene": <index or beat id>, "atSeconds": n, "el"?: "<stable id>", "set": { ...typed properties... }, "text"?: string }`.
   - **The classifier decides the scope; the model does not.** For an element-scoped candidate, the classifier applies the change on the live composition (HyperFrames: in headless Chrome with the real engine; plates: in the Worker host) and measures: (a) the bounding boxes of every other element active during the whole window of the target element, (b) overlaps between the target and any other element, (c) whether the target stays inside the safe area (action-safe 90 %, title-safe 80 % for text and captions, from `hyperframes-studio` rules). If any other element's box changes, an overlap appears, or the safe area is left, the patch is **escalated to scene scope**. Colour, opacity and equal-length text never escalate unless they change layout.
2. **Stable element ids for HyperFrames:** stamp `data-el` in `mk()` (id from beat id, class, order within the beat) and publish the list of active elements at a time (id, role, text, box) to the editing layer. No other engine behaviour changes; the existing scene render output must stay pixel-identical when no override is present (prove with the `worker` snapshot or the Chrome-based comparison the spike scripts show).
3. **Element scope for HyperFrames:** an `overrides` object in the `hf-variables` block (`{ "<id>": { color?, opacity?, dx?, dy?, text? } }`), applied by the engine at build time (not by an external stylesheet), identical in preview and in the final render. Undo = delete the entry. Overrides use CSS `translate` and `scale` semantics that compose with the animation (the spike needed `!important`; implement it in the engine instead).
4. **Scene scope for HyperFrames:** a layout hint in the plan's beat (for example `beat.hints = { emphasize: "<id>", factor: 1.3 }`) that the engine honours **inside its own layout computation** (it sizes from character counts), so the whole line or block is re-laid-out and nothing overlaps; the model or a rule translates the comment into the hint. Add a regression check that a hint never produces overlaps or leaves the safe area (the same measurement as the classifier). If the engine cannot satisfy the hint, the edit is refused with a plain explanation, not applied.
5. **Plates:** the same patch format. Element scope = params the plate code reads (colour, opacity, offset that does not collide); scene scope = a model re-authoring of that scene with the params schema, current values, elements active at the time and the comment (the existing authoring job), producing a new revision with a new `bundleDigest`. Do not build plates' side until the plates phase 4 params work exists; keep this task's shared module independent of it.
6. **UI (shared workspace):** nothing new for the user to learn: they pin a comment at a time, `Apply comments` runs it. Element-scope edits show instantly in the preview and are undoable; scene-scope edits show an "updating scene" state on the scene tab (as plates already do) and finish by reloading that scene. The comment list says which kind of change was made ("changed colour" or "re-laid out the scene").

## Acceptance (the manager will check these)
- A test table of at least 12 comments for HyperFrames (colour, text, nudge, bigger, smaller, longer text, move onto another element, off-screen push, undo, two comments on the same element, comment on a scene kind other than kinetic and title, comment at a transition) with the expected scope and the measured result; no applied edit may leave an overlap or leave the safe area.
- Preview equals final render for an element override and for a scene hint (a real render through the existing HyperFrames render path, compared frame by frame at three times; differences listed).
- Existing HyperFrames output without edits is unchanged (frame comparison across the engine's scene kinds, 0 differing pixels).
- Backend tests for the patch validation and persistence; frontend tests for the classifier decisions; all existing suites pass, with the known pre-existing failures unchanged.

## Rules (hard limits)
- Local only: no commits, no pushes, no deploys, no cloud, Railway, Supabase or AWS calls, no real model API (use the stub or recorded responses), no secrets. Servers bind `127.0.0.1`. Stop everything you start. Never kill processes you did not start.
- Edit only the paths the manager lists when the task is released; until then none. Do not weaken or delete tests; do not add dependencies.
- If the brief contradicts the code, keep to its intent and record the contradiction with evidence.

## Deliverable
`docs/phase4/element-edits-report.md` with files changed, commands run, the test table with measurements, the render-parity evidence, decisions, deviations, risks. Then print `DONE` and the report path on a line by itself.


## Released scope, paths and baselines (added at release)

**Read first, in addition to the facts above:** `docs/phase3/hyperframes-capabilities.md`, `docs/phase3/3b-report.md` (the HyperFrames step 3 now sits on the shared workspace and already has a comment flow: timed comments call `onApplySceneComments`, which rewrites storyboard lines per scene), `docs/phase5/5-report.md` (the final render path and manifest), and the spike scripts `tools/spike-hf-elements/`.

**You may edit or create files only in:** `worker/templates/beat-plan/` (the engine: `engine.js`, then rebuild `index.html` with `node worker/templates/beat-plan/build.mjs`; commit the rebuilt file as part of the change), `packages/contracts/src/` (the shared patch format and classifier types, new files; additive exports only), `backend/src/plan/` (patch fields and routes for element edits; apply through the `hf-variables` block in `composition.ts` and `preview.ts`), `backend/test/`, `frontend/lib/` (a small client for the edit API), `frontend/components/browser-animation-step.tsx` and `frontend/components/animation-workspace/` (only what the comment list needs to say which kind of change was made; any change to the shared workspace must keep the plates screenshots at 0 differing pixels: re-run `tools/phase3/compare.mjs` against `tools/phase3/baseline`), `frontend/test/`, `tools/phase4/`, `docs/phase4/`. Do NOT touch `worker/src/` (the render job runs the same composition HTML; if the final render needs a change, report it), `backend/src/plates/`, `frontend/lib/live/`, `plate-preview.tsx`, other worktrees, or the main folder `/Users/osamaehsaan/Code/Market_apps/VideoSaaS`.

**Baselines before you start (record them first):** `frontend` 169 tests pass; backend typecheck clean and 36 test files pass with the five known failures (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`); the plates screenshot comparison is 68/68; the HyperFrames step-3 and final-page fixtures and captures exist under `tools/phase3/` (`capture-hf.mjs`, `capture-final.mjs`) and must stay identical for films with no edits.

**How to render and compare:** the HyperFrames render path is exercised by chaos scenario 6 (`tools/phase2/job-control/chaos.mjs`) on the local stack (`docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker`); you may add an element-edit scenario there. Tear down only what you started: `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore`; never touch `videosaas-local-postgres-1` or `videosaas-local-worker-1`.

**Model use:** no real model API. Where the design needs a model to turn a comment into a patch, implement it behind an interface with a deterministic rule-based implementation for the tests and a documented prompt for the real one; do not call any external API.

**Process rules still apply:** one writer; no commit, no push, no deploy, no cloud calls, no secrets; do not weaken or delete tests; do not add dependencies.
