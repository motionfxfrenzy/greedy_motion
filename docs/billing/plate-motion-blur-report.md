# Plate Motion-Blur Length Check & Workspace Capability Report

Date: 2026-11-06  
Branch: `codex/plate-motion-blur` (cut from `codex/integrate` at `86e0c2d`)  
Owner decisions (2026-11-06):
1. *"Skip the motion-blur length check for plate films in a small follow-up after this deploy. A setting the renderer ignores shouldn't block submission. Update both the server and storyboard checks, preserve the 20-second limit for HyperFrames, and test that plate films over 20 seconds can submit with the flag enabled. Ideally, hide or disable the motion-blur control for plate films so users aren't offered an effect they won't receive."*
2. **AMENDMENT 2:** *"Yes, add it back"* (answering *"Should HyperFrames users get a visible motion-blur control?"*) — add the visible motion-blur control to the live HyperFrames step-3 animation workspace (`frontend/components/browser-animation-step.tsx` and `frontend/components/animation-workspace/OptionsBar.tsx`), driven by the `motionBlur` capability flag (`true` for HyperFrames, `false` for plates) and wired to `Studio`'s existing `motionBlur` / `setMotionBlur` state.

---

## 1. Diff Summary

| File | Change |
| --- | --- |
| `backend/src/server.ts` | Imported `isPlateLook` from `./plates/inputs.ts` and guarded the `motionBlurProblem` check in `POST /v1/projects/:id/render` with `if (blur.on && !isPlateLook(project.brief?.look))`. Kept `parseMotionBlur` validation (`400 invalid_request`), `!project.beatPlan` check (`400 motion_blur_unavailable`), readiness, and token charging untouched. |
| `frontend/components/animation-workspace/types.ts` | Added `motionBlur?: boolean` (and optional `motionBlurControls?: WorkspaceMotionBlurControlState` passthrough) to `WorkspaceOptionsConfig`, `motionBlur: boolean` to `ResolvedWorkspaceOptions`, `WorkspaceMotionBlurControlState` interface, and `motionBlurControls?: WorkspaceMotionBlurControlState` to `AnimationWorkspaceProps`. |
| `frontend/components/animation-workspace/logic.ts` | Updated `resolveVisibleOptions` to resolve `motionBlur: config?.motionBlur ?? true` (default `true`); kept `hfOptionsConfig` unchanged; added `isPlateLookId`, `plateOptionsConfig(look)` returning `{ motionBlur: false }` for plate looks, and `motionBlurControl(look, lengthSeconds)`. |
| `frontend/components/animation-workspace/OptionsBar.tsx` | Added `motionBlur?: WorkspaceMotionBlurControlState` to `OptionsBarProps` and rendered `<label className="aw-blur">` with `<input type="checkbox">`, `motionBlurCopy.label`, and `tooLong ?? motionBlurCopy.help` only when `visible.motionBlur` is `true` and control state is provided. Disabled and unchecked when `motionBlurProblem(durationSeconds)` returns a problem string. |
| `frontend/app/animation-workspace.css` | Added `.aw-blur` pill/checkbox/note rules matching existing `OptionsBar` control styling. |
| `frontend/components/browser-animation-step.tsx` | Added `motionBlur`, `setMotionBlur`, and `durationSeconds` props; built `motionBlurControls` from the composition `duration` (read at `comp.durationSeconds`, ~l.386) and passed it through `optionsConfig` and `AnimationWorkspace` for non-plate projects while hiding it via `plateOptionsConfig` for plate projects. |
| `frontend/components/studio.tsx` | Passed `motionBlur={motionBlur}` and `setMotionBlur={setMotionBlur}` to `<BrowserAnimationStep>` (2 lines, nothing else changed). |
| `frontend/components/beat-storyboard.tsx` | Replaced the unconditional `.bs-blur` render with `resolveVisibleOptions(plateLook ? plateOptionsConfig() : undefined).motionBlur`, hiding the control and skipping `motionBlurProblem(lengthSeconds)` for plate looks (`illus-*`) while keeping both for non-plate looks. |
| `backend/test/plate-motion-blur.mjs` | New real-route test spawning `src/server.ts` against `plates_unit_blur_test` covering cases (a)–(f) and (n). |
| `backend/test/plate-film-length.mjs` | Updated the inline route mirror and section (g).1 assertion to match the 2026-11-06 owner decision (21 s plate film accepted with `202`; 21 s non-plate film refused with `400 motion_blur_too_long`). |
| `frontend/test/plate-motion-blur.mjs` | New frontend logic + headless Chrome DOM test covering cases (g)–(m) across `logic.ts`, `BeatStoryboardStep`, `OptionsBar`, and `BrowserAnimationStep`. |
| `frontend/test/workspace-logic.mjs` & `frontend/test/hf-step-logic.mjs` | Extended `resolveVisibleOptions` assertions for `motionBlur` default (`true`), `plateOptionsConfig()` (`false`), and `hfOptionsConfig` (`true`). |
| `docs/LIVE_SCENES_PLAN.md` & `docs/PRICING.md` | Recorded the 2026-11-06 owner decision in section 22 of `docs/LIVE_SCENES_PLAN.md` and in the motion-blur row of `docs/PRICING.md`. |

---

## 2. Step 1 Evidence: `BeatStoryboardStep` Is Unreachable Dead Code in the Live UI

Command 1:
```sh
$ grep -rn "BeatStoryboardStep" frontend --include="*.tsx" --include="*.ts" --include="*.mjs"
frontend/components/studio.tsx:14:import { BeatStoryboardStep, FrameCard, type FrameLook } from "./beat-storyboard";
frontend/components/beat-storyboard.tsx:117:export function BeatStoryboardStep({ approvedFrames, project, look, warnings, busy, onSaved, back, submit, openStudio, regenerate, motionBlur, setMotionBlur }: {
```

Command 2 (checking all `beat-storyboard` imports, dynamic imports, and `frontend/app/`):
```sh
$ grep -rn "beat-storyboard" frontend --include="*.tsx" --include="*.ts" --include="*.mjs"
frontend/app/dev/hf-final-fixture/page.tsx:11:import type { FrameLook } from "../../../components/beat-storyboard";
frontend/components/final-render-step.tsx:6:import type { FrameLook } from "./beat-storyboard";
frontend/components/studio.tsx:14:import { BeatStoryboardStep, FrameCard, type FrameLook } from "./beat-storyboard";
frontend/components/beat-storyboard.tsx:336:  return <div className="beat-storyboard">
frontend/components/browser-animation-step.tsx:39:import type { FrameLook } from "./beat-storyboard";
```

**Finding:**
- `BeatStoryboardStep` is defined at `frontend/components/beat-storyboard.tsx:117` and imported at `frontend/components/studio.tsx:14`, but `<BeatStoryboardStep` is never rendered anywhere in `frontend/components/` or `frontend/app/`.
- In the live 4-step `Studio` flow (`frontend/components/studio.tsx:956-1016`):
  - Step 1 (`STORYBOARD`) renders `<ScriptCanvas>` (`studio.tsx:956`).
  - Step 2 (`RENDER`, labeled `"Animation"`) renders `<PlatePreview>` for plate projects (`studio.tsx:974`) and `<BrowserAnimationStep>` for HyperFrames projects (`studio.tsx:981`).
  - Step 3 (`REVIEW`, labeled `"Render"`) renders `<PlateFinal>` (`studio.tsx:1003`) or `<FinalRenderStep>` (`studio.tsx:1005`).
- Per the brief and Amendment 2: `BeatStoryboardStep` was left unmounted and not deleted, updated to use `plateOptionsConfig` / `resolveVisibleOptions`, and the live motion-blur control for HyperFrames users was added to `BrowserAnimationStep` and `OptionsBar`.

---

## 3. Before / After Behaviour Table

| Scenario | Before | After |
| --- | --- | --- |
| `POST /v1/projects/:id/render` — Plate film > 20 s (e.g. 7 scenes = 21 s) with `{ motionBlur: true }` | `400 motion_blur_too_long` (0 spend) | **`202 Accepted`**, charged `renderCostMillitokens(21)` (`12,300` millitokens = `12.3` tokens), 1 spend; `plate-film` `render_input` does not carry `motionBlur` |
| `POST /v1/projects/:id/render` — Plate film > 20 s (21 s) with `{ motionBlur: false }` or field absent `{}` | `202 Accepted`, charged `renderCostMillitokens(21)` | **`202 Accepted`**, charged `renderCostMillitokens(21)` (unchanged) |
| `POST /v1/projects/:id/render` — HyperFrames / non-plate film > 20 s (21 s) with `{ motionBlur: true }` | `400 motion_blur_too_long` (0 spend) | **`400 motion_blur_too_long`** (unchanged, 0 spend) |
| `POST /v1/projects/:id/render` — HyperFrames or plate film <= 20 s with `{ motionBlur: true }` | `202 Accepted` | **`202 Accepted`** (unchanged; HyperFrames `beat-plan` `render_input` carries `motionBlur: true`, plate `plate-film` `render_input` omits it) |
| `POST /v1/projects/:id/render` — Malformed `motionBlur` (`"yes"`) on plate film | `400 invalid_request` | **`400 invalid_request`** (`"\`motionBlur\` must be true or false."`, unchanged) |
| `POST /v1/projects/:id/render` — Project without `beatPlan` + `{ motionBlur: true }` | `400 motion_blur_unavailable` | **`400 motion_blur_unavailable`** (unchanged) |
| Plate project with saved draft `motionBlur=true` submitting render | Blocked (`400 motion_blur_too_long`) when > 20 s | **Submits cleanly (`202`)** at any length; flag is harmless and ignored by plate renderer |
| Live Step 3 (`OptionsBar` in `BrowserAnimationStep`) — HyperFrames film <= 20 s | No motion-blur control shown | **Control visible & enabled** (`.aw-blur`); reflects saved draft `motionBlur`, toggles `setMotionBlur`, and next `submit()` sends `{ motionBlur }` to `renderProject` |
| Live Step 3 (`OptionsBar` in `BrowserAnimationStep`) — HyperFrames film > 20 s | No motion-blur control shown | **Control visible, unchecked & disabled**; displays `motionBlurProblem(lengthSeconds)` message without resetting saved draft state |
| Live Step 3 (`PlatePreview` / `OptionsBar` with plate config) — Plate film | No motion-blur control shown | **Control hidden (not rendered in DOM)**, no length check |
| `BeatStoryboardStep` — Plate film > 20 s | `.bs-blur` rendered and disabled with `motionBlurProblem` message | **`.bs-blur` hidden (not rendered in DOM)**, no length check, Submit enabled |
| `BeatStoryboardStep` — HyperFrames film <= 20 s / > 20 s | `.bs-blur` rendered (enabled <= 20 s, disabled > 20 s) | **Unchanged** (`.bs-blur` rendered, enabled <= 20 s, disabled with `motionBlurProblem` > 20 s) |

---

## 4. Capability Design & Section 22 Fit

Section 22 of `docs/LIVE_SCENES_PLAN.md` establishes that engine-specific options are controlled through `WorkspaceOptionsConfig` and `resolveVisibleOptions(config)` in `frontend/components/animation-workspace/`: unsupported engine capabilities are omitted/hidden (`false`), never rendered as permanently dead controls for an engine that ignores them.

1. **Capability flag (`types.ts`, `logic.ts`):**
   - `WorkspaceOptionsConfig.motionBlur?: boolean` defaults to `true` in `resolveVisibleOptions(config)` (`motionBlur: config?.motionBlur ?? true`), matching `previewQuality`.
   - `hfOptionsConfig(availableAudio)` requires no change and resolves `motionBlur: true`.
   - `plateOptionsConfig(look)` returns `{ motionBlur: false }` for plate looks (`illus-*`), so `resolveVisibleOptions(plateOptionsConfig()).motionBlur` is `false`.
2. **Control state & Studio wiring (`studio.tsx`, `browser-animation-step.tsx`, `OptionsBar.tsx`):**
   - `studio.tsx` holds `const [motionBlur, setMotionBlur] = useState(false)` (l.93), restores it from `localStorage` draft (`readDraft` at l.298, l.353), persists it on draft edits (`writeDraft` at l.343), and sends it at submission (`renderProject(project.id, { motionBlur })` at l.878).
   - `studio.tsx` now passes `motionBlur={motionBlur}` and `setMotionBlur={setMotionBlur}` to `<BrowserAnimationStep>` (l.993–994).
   - `BrowserAnimationStep` reads the composition's `durationSeconds` (`comp.durationSeconds`, ~l.386) into `duration` and constructs `motionBlurControls: WorkspaceMotionBlurControlState` (`{ enabled, disabled: busy, durationSeconds, onToggle }`) for non-plate projects.
   - Because `AnimationWorkspace.tsx` is outside the allowed-files list and forwards `optionsConfig` directly to `<OptionsBar optionsConfig={optionsConfig} ... />`, `OptionsBar` accepts `motionBlur?: WorkspaceMotionBlurControlState` as a direct prop (matching `audio`, `subtitles`, `previewQuality`) and also reads `optionsConfig?.motionBlurControls` when rendered inside `AnimationWorkspace`. `OptionsBar` renders `<label className="aw-blur">` only when `visible.motionBlur && blurControl` is truthy.

---

## 5. Verification & Test Results

### 5.1 Step 1 Baseline Test Run (Before Any Changes)
- `cd backend && npm run typecheck` -> PASS
- `cd backend && node test/script-rules.mjs && node test/render-quote.mjs && node test/plate-model.mjs` -> PASS
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-film-length.mjs` -> PASS (`plate film length: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-render-billing.mjs` -> PASS (`plate render billing: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-export-manifest.mjs` -> PASS (`plate export manifest: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/render-prep.mjs` -> Pre-existing failure (`AssertionError [ERR_ASSERTION]: The input did not match the regular expression /at least three beats/. Input: 'A plan needs at least one beat.'`)
- `cd frontend && npm run typecheck` -> PASS
- `cd frontend && node --test test/workspace-logic.mjs test/hf-step-logic.mjs` -> PASS (10/10)
- `cd frontend && node --test test/hf-step-interaction.mjs` -> PASS (1/1, 19.7 s)
- `cd frontend && node --test test/final-view-interaction.mjs` -> PASS (1/1, 17.4 s)

### 5.2 Step 2 Red Run (New Tests Failing Before Implementation)

**Backend (`backend/test/plate-motion-blur.mjs` before editing `backend/src/server.ts`):**
```text
AssertionError [ERR_ASSERTION]: (a) 21 s plate film with motionBlur: true must return 202 (got 400: {"error":{"code":"motion_blur_too_long","message":"Motion blur is available for films up to 20 seconds; this one is 21. Render without it."}})

400 !== 202

    at file:///Users/osamaehsaan/Code/Market_apps/VideoSaaS-plate-blur/backend/test/plate-motion-blur.mjs:324:10
```

**Frontend (`frontend/test/plate-motion-blur.mjs` before editing frontend files):**
```text
✖ (g) resolveVisibleOptions defaults motionBlur to true, plateOptionsConfig yields false, and hfOptionsConfig is unchanged (0.872959ms)
  AssertionError [ERR_ASSERTION]: resolveVisibleOptions() defaults motionBlur to true
  + actual - expected
  + undefined
  - true

✖ (h)-(m) DOM tests for BeatStoryboardStep, OptionsBar, and BrowserAnimationStep motion-blur control (1024.971416ms)
  Error: Build failed with 1 error:
  blur-harness.tsx:6:30: ERROR: No matching export in "components/animation-workspace/logic.ts" for import "plateOptionsConfig"
```

### 5.3 Step 3 & Step 5 Green Run (After Implementation)

- `cd backend && npm run typecheck` -> **PASS**
- `cd backend && node test/script-rules.mjs` -> **PASS** (`script rules passed (5 voice-text cases, motion-blur option rules)`)
- `cd backend && node test/render-quote.mjs` -> **PASS** (`render quote: ok`)
- `cd backend && node test/plate-model.mjs` -> **PASS** (`plate model: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-film-length.mjs` -> **PASS** (`plate film length: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-render-billing.mjs` -> **PASS** (`plate render billing: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-export-manifest.mjs` -> **PASS** (`plate export manifest: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-motion-blur.mjs` -> **PASS** (`plate motion blur: ok`)
- `cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/render-prep.mjs` -> Identical pre-existing failure (`'A plan needs at least one beat.'` vs `/at least three beats/`)
- `cd frontend && npm run typecheck` -> **PASS**
- `cd frontend && node --test test/workspace-logic.mjs test/hf-step-logic.mjs test/plate-motion-blur.mjs` -> **PASS** (12/12 tests passing in 2.66 s)
- `cd frontend && node --test test/hf-step-interaction.mjs` (run alone) -> **PASS** (1/1, 13.2 s)
- `cd frontend && node --test test/final-view-interaction.mjs` (run alone) -> **PASS** (1/1, 15.2 s)
- Dropped temporary database: `docker exec videosaas-local-postgres-1 dropdb -U videosaas plates_unit_blur_test` -> **DONE**

---

## 6. Screenshot Baseline Impact (AMENDMENT 2)

No capture scripts were run and no baseline images under `tools/phase3/*baseline*` were modified (`git diff` touches 0 PNG files).

### 6.1 HyperFrames Step-3 Captures (`tools/phase3/capture-hf.mjs` -> `tools/phase3/hf-baseline/`)

In `tools/phase3/capture-hf.mjs`, 7 of the 12 states render `<BrowserAnimationStep>` in its ready/workspace branch (which mounts `<AnimationWorkspace>` and `<OptionsBar>`), so **28 baseline files** under `tools/phase3/hf-baseline/` will deliberately show the new `.aw-blur` ("Add motion blur") control in the top floating options bar when recaptured by the manager:

1. `c-ready` (4 files):
   - `tools/phase3/hf-baseline/c-ready-1280-light.png`
   - `tools/phase3/hf-baseline/c-ready-1280-dark.png`
   - `tools/phase3/hf-baseline/c-ready-400-light.png`
   - `tools/phase3/hf-baseline/c-ready-400-dark.png`
2. `d-comments` (4 files):
   - `tools/phase3/hf-baseline/d-comments-1280-light.png`
   - `tools/phase3/hf-baseline/d-comments-1280-dark.png`
   - `tools/phase3/hf-baseline/d-comments-400-light.png`
   - `tools/phase3/hf-baseline/d-comments-400-dark.png`
3. `e-token-modal` (4 files):
   - `tools/phase3/hf-baseline/e-token-modal-1280-light.png`
   - `tools/phase3/hf-baseline/e-token-modal-1280-dark.png`
   - `tools/phase3/hf-baseline/e-token-modal-400-light.png`
   - `tools/phase3/hf-baseline/e-token-modal-400-dark.png`
4. `f-scene-selected` (4 files):
   - `tools/phase3/hf-baseline/f-scene-selected-1280-light.png`
   - `tools/phase3/hf-baseline/f-scene-selected-1280-dark.png`
   - `tools/phase3/hf-baseline/f-scene-selected-400-light.png`
   - `tools/phase3/hf-baseline/f-scene-selected-400-dark.png`
5. `g2-preview-error` (4 files):
   - `tools/phase3/hf-baseline/g2-preview-error-1280-light.png`
   - `tools/phase3/hf-baseline/g2-preview-error-1280-dark.png`
   - `tools/phase3/hf-baseline/g2-preview-error-400-light.png`
   - `tools/phase3/hf-baseline/g2-preview-error-400-dark.png`
6. `g3-applying-comments` (4 files):
   - `tools/phase3/hf-baseline/g3-applying-comments-1280-light.png`
   - `tools/phase3/hf-baseline/g3-applying-comments-1280-dark.png`
   - `tools/phase3/hf-baseline/g3-applying-comments-400-light.png`
   - `tools/phase3/hf-baseline/g3-applying-comments-400-dark.png`
7. `g4-portrait-9x16` (4 files):
   - `tools/phase3/hf-baseline/g4-portrait-9x16-1280-light.png`
   - `tools/phase3/hf-baseline/g4-portrait-9x16-1280-dark.png`
   - `tools/phase3/hf-baseline/g4-portrait-9x16-400-light.png`
   - `tools/phase3/hf-baseline/g4-portrait-9x16-400-dark.png`

The remaining 5 states in `tools/phase3/capture-hf.mjs` (`a1-prep-frames`, `a2-prep-voice`, `a3-prep-motion`, `b-prep-error`, `g1-prep-no-frames` — 20 files in `tools/phase3/hf-baseline/`) render `<AnimationPrep mode="full">` without `<OptionsBar>` and are **unchanged**.

### 6.2 HyperFrames Step-4 Final Captures (`tools/phase3/capture-final.mjs` -> `tools/phase3/hf-final-baseline/`)

`tools/phase3/capture-final.mjs` captures `/dev/hf-final-fixture` (`FinalRenderStep` / `FinalView` / `.render-workspace`), which does not render `OptionsBar`. All **36 files** in `tools/phase3/hf-final-baseline/` (`a-ready-16x9`, `b-ready-9x16`, `c-ready-approved`, `d-ready-seek-mid`, `e1-rendering-waiting`, `e2-rendering-frames`, `e3-rendering-encoding`, `f-rendering-retry`, `g-failed` × `{1280, 400}` × `{light, dark}`) are **unchanged**.

### 6.3 Plate Captures (`tools/phase3/capture.mjs` -> `tools/phase3/baseline/`)

All **68 files** in `tools/phase3/baseline/` are **unchanged by construction**:
- Plate pages (`PlatePreview` and `PlateFinal`) do not pass `motionBlur` control state, and `plateOptionsConfig` sets `motionBlur: false` (`resolveVisibleOptions(config).motionBlur === false`), so `OptionsBar` renders zero motion-blur DOM nodes on plate pages.

---

## 7. Open Questions

- None blocking. When `frontend/components/animation-workspace/AnimationWorkspace.tsx` is next in scope, it can also pass `motionBlur={motionBlurControls}` directly to `<OptionsBar>` alongside the existing `optionsConfig.motionBlurControls` forwarding path.
