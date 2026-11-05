# Task for the coding agent: phase 3h, the step-3 options bar must be fully usable at 400 px

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

## Goal
At phone width (400 px) every control in the shared options bar `.aw-floating-bar` of the animation workspace is reachable and usable, with touch and keyboard, and its popovers stay on screen. Today the bar (`frontend/app/animation-workspace.css:9`: `inline-flex`, `max-width:100%`, `white-space:nowrap`, `flex-wrap:nowrap`, no overflow handling, no media rule) overflows past its right edge: the Subtitle tab's controls were already clipped before phase 3g, and the new Plates-only preview-quality pill ("Standard") added by 3g is unreachable. Nothing may change at 1280 px except what the brief allows (nothing), and HyperFrames (which shares this component) must keep working.

## Worktree
`/Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw` (branch `codex/live-predraw`, HEAD at or after `c891283`). Do not touch `../VideoSaaS-live-scenes`, `../VideoSaaS-engine`, `../VideoSaaS-smoke`. Dependencies are installed.

## Read first (exact files)
1. `frontend/app/animation-workspace.css`: `.aw-floating-bar` (:9), `.aw-mode-tabs` (:11), `.aw-inline-group` (:19), `.aw-track-chip` (:21), `.aw-bar-sep` (:27), `.aw-menu-wrap` (:29), `.aw-pill-item` (:31), `.aw-inline-stepper` (:43), `.aw-dialog` and its variants (:61, :63, :65), the media queries at :274, :276, :303, and the wrapping patterns `.aw-controls` (:186), `.aw-swatches` (:111), `.aw-at` (:248).
2. `frontend/components/animation-workspace/OptionsBar.tsx`: Audio tab (:107-157), Subtitle tab (:159-500), popover triggers (captions :164-197, style :207-241, colours :277-349, opacity :357-387, position :394-495, quality :502-541), the status chip after :544, and the outside-click dismissal scoped to `headBarRef` (:37-55).
3. `frontend/components/animation-workspace/logic.ts` (what HyperFrames shows: :335-349; Plates defaults :39-40), `AnimationWorkspace.tsx`, `frontend/components/plate-preview.tsx` (:830-838).
4. Existing narrow-width patterns elsewhere: `frontend/app/styles.css:341-344` (`.gallery-row`: horizontal scroll with a fade mask and an `.at-end` class), `frontend/app/editor.css:98, :317`.
5. Capture tools: `tools/phase3/capture.mjs` (WIDTHS [1280, 400]; the `options-bar` region is compared on centre X only, so a clip does not fail it), `tools/phase3/compare.mjs`, `capture-hf.mjs`, `layout-compare.mjs`.

## Architecture rules
- Reuse the existing workspace CSS and the patterns above; no new dependencies, no new CSS framework, no JS layout measurement unless CSS cannot do it.
- All popovers (`.aw-dialog`) are children of the bar (`position:absolute` under their `.aw-menu-wrap`, no portal), so **do not put `overflow:auto|hidden` on the bar itself** (it would clip them). The two acceptable shapes: (a) **wrap** the bar into rows below a breakpoint (preferred starting point: `@media (max-width: 560px)`: `flex-wrap:wrap; height:auto; max-height:none; row-gap`; hide `.aw-bar-sep`s that would land at a row edge), or (b) scroll an **inner** track of non-popover controls while the popover-bearing controls sit outside the scroller. Choose with evidence from captures and say why in the report.
- Popovers at 400 px: each `.aw-dialog` (width 270 px, centred on its trigger) must stay inside the viewport. Below the breakpoint anchor dialogs to the bar (not to the trigger) or clamp them (`left`/`right` within the viewport), whichever is simpler.
- Touch targets at the breakpoint at least 36 px high; no horizontal page scroll (`document.scrollingElement.scrollWidth <= innerWidth`).
- Keyboard: tab order unchanged; every control reachable and its popover openable with the keyboard; Escape/outside-click dismissal unchanged.
- HyperFrames shares `OptionsBar`: its bar (fewer controls) must look and behave the same as before at 1280 px and not worse at 400 px.
- Seek-safe/deterministic rules do not apply (CSS and markup only), but no change to behaviour or props of the controls.

## Files allowed to change
`frontend/app/animation-workspace.css`; `frontend/components/animation-workspace/OptionsBar.tsx` (class names or wrapper elements only, no behaviour change); `frontend/test/` (new test file for the 400 px layout); `tools/phase3/` (new capture states or a layout check script; do not alter existing expected baselines except to add new ones); `docs/phase3/3h-report.md`.
**Forbidden:** `frontend/lib/`, other components, `backend/`, `worker/`, `packages/`, any `package.json` or lockfile, `tools/phase3/baseline`, `hf-after`, `hf-final-after` contents (compare against them, never overwrite them).

## Steps, in order
1. Map first: list in the report which CSS rule or element owns each clipped control at 400 px (use a real capture or Playwright `boundingBox()` on every control in the Plates Audio and Subtitle tabs, and in the HyperFrames bar).
2. Implement the narrow-width behaviour chosen above, CSS first.
3. Add a Chrome layout test `frontend/test/workspace-bar-narrow.mjs` (headless Chrome at 400 px and at 1280 px, using the same fixture pages the capture tool uses; start the Next dev server on a random free port as `capture.mjs` does): for every control in the bar on the Audio tab, on the Subtitle tab with mode "Subtitles" (all controls), and on a HyperFrames fixture page, assert: its bounding box lies inside the viewport horizontally (after any scroll the user can do, if you chose scrolling: assert it scrolls into view), it is not covered by another element (`document.elementFromPoint` at its centre returns it or a descendant), it is focusable by Tab; open each popover and assert its box is inside the viewport; assert no horizontal page scroll.
4. Capture and compare (commands below). The 1280 captures must be **pixel identical to the current `c891283` captures** (take them first as your baseline: `node tools/phase3/capture.mjs tools/phase3/3h-before`, before any change). The 400 px captures that show the bar will change deliberately: list each with why.
5. Write the report.

## Tests and exact commands
- `cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw/frontend && npm run typecheck && npm test` (two Next-dev-server tests may time out cold: rerun each alone with `node --test test/<file>.mjs` and show it pass).
- `node frontend/test/workspace-bar-narrow.mjs` (your new test; wire it so `npm test` runs it).
- `node tools/phase3/capture.mjs tools/phase3/3h-after && node tools/phase3/compare.mjs tools/phase3/3h-before tools/phase3/3h-after tools/phase3/3h-diff` (run from the repo root).
- HyperFrames: `node tools/phase3/capture-hf.mjs tools/phase3/3h-hf-after && node tools/phase3/compare.mjs tools/phase3/hf-after tools/phase3/3h-hf-after tools/phase3/3h-hf-diff` (the manager's own run of this against `hf-after` showed 44/48 identical and four captures at 2 to 56 px of capture noise; yours must be no worse).
- These runs are not timing-sensitive. Do NOT run them while the plates-e2e Docker stack is being used by another track (`/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` exists): wait for it to go away.

## Acceptance criteria (measurable)
1. At 400 px, on the Plates Audio tab and on the Subtitle tab with every control shown, every control passes the layout test (inside viewport, not covered, Tab-focusable); every popover opens fully inside the viewport; `scrollWidth <= innerWidth`.
2. A 400 px capture of each of: Audio tab, Subtitle tab (mode Subtitles), and the colour and position popovers open, shows every control visible or reachable by an obvious affordance; attach the four capture paths in the report.
3. 1280 px captures (all 34 that exist) pixel-identical to `3h-before`.
4. HyperFrames captures no worse than the manager's 44/48 (0 to 56 px of noise on four files); the HyperFrames bar at 1280 px identical.
5. `npm run typecheck` clean; `npm test` passes (cold-start Next-dev-server tests pass alone).
6. **No overlap with the stage:** the bar is floating, so if it wraps to more than one row at 400 px it gets taller and can cover the stage. The layout test asserts, for Plates and HyperFrames at 400 px, that the (wrapped) bar does not overlap the visible area of the canvas/stage element (or that the stage is pushed down or resized to make room). If there is not room for both wrapping and an uncovered stage, the inner-scroll shape wins over wrapping, and the report says which shape you chose and why.
7. **Touch size:** each control's hit area is at least 32 px tall at touch widths (400 px), so wrapping does not shrink controls (the earlier 36 px guidance is the target; 32 px is the hard floor the test asserts).
8. The diff touches only allowed files.

## Forbidden actions
No `git commit`, `git push`, `git reset`, `git stash`, `git checkout` or branch changes, no deploys, no secrets or credential files (`.env*`, `.env.credentials`, `infra/aws/.env*`, `*accessKeys*`, token files), no other worktrees, no Docker, no network except localhost servers on random free ports (never 3000, 4000, 4100, 8766, 55432, 58787, 59000), no staging/production/cloud/model calls, no new dependencies, no use of any shared resource lock you do not hold.

## Deliverable
`docs/phase3/3h-report.md`: the map (step 1), the chosen approach and why, files changed with line counts, the test's results per control, capture comparison with each deliberate 400 px change explained, known gaps. End your final message with exactly one line: `DONE docs/phase3/3h-report.md`
