# Phase 3a Report — Shared `AnimationWorkspace` Shell Extraction

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (68/68 screenshots 0 differing pixels; 151/151 frontend tests passing; `tsc --noEmit` clean)

---

## 1. Files Created and Changed

### Changed files
- `frontend/app/layout.tsx` — Added `import "./animation-workspace.css";` immediately before `./plate-preview.css`.
- `frontend/app/plate-preview.css` — Reduced from 337 lines to 23 lines containing only plates-specific `.aw-canvas>video` rules and `PlateFinal` (`.pf*`, `.pp-track-chip`) styles.
- `frontend/components/plate-preview.tsx` — Reduced from 1,222 lines to 810 lines as an adapter that keeps `PlatePreview`, `PlateFinal`, and `usePlateRatios`, retains plate polling/SFX/subtitle persistence/video-clip stage, and renders `AnimationWorkspace` + `AnimationPrep`.

### Created files
- `frontend/app/animation-workspace.css` — Shared workspace shell stylesheet (303 lines) with `.animation-workspace` and `.aw-*` classes extracted from `plate-preview.css`.
- `frontend/components/animation-workspace/index.ts` — Barrel module exporting `AnimationWorkspace`, `OptionsBar`, `StatusLine`, `ProgressButton`, `ControlRow`, `SceneTabs`, `CommentsPanel`, `AnimationPrep`, types, and pure logic helpers.
- `frontend/components/animation-workspace/types.ts` — Engine-neutral TypeScript interfaces for `AnimationWorkspace` props, options visibility config, audio/subtitle control contracts, scene spans/tabs, and comments.
- `frontend/components/animation-workspace/logic.ts` — Pure helper functions for `formatClock`, `sceneSpansFromDurations`, `anchorCommentAtTime`, `sortWorkspaceComments`, `affectedScenesSummary`, `mapSceneTabState`, `resolveVisibleOptions`, `buildSubtitleCues`, and `activeSubtitleCueAt`.
- `frontend/components/animation-workspace/AnimationWorkspace.tsx` — Shared step-3 shell layout composing `OptionsBar`, stage frame with floating aspect ratio rail and `renderStage()`, `ControlRow`, `SceneTabs`, and `CommentsPanel`.
- `frontend/components/animation-workspace/OptionsBar.tsx` — Floating top toolbar with `Audio` | `Subtitle` mode switcher, track toggles, subtitle mode/style/size/color/opacity/position controls (hiding unsupported engine options), and inline `StatusLine`.
- `frontend/components/animation-workspace/StatusLine.tsx` — Reusable status indicator supporting both compact inline toolbar chip mode (with optional `Retry` pill) and `role="status" aria-live="polite"` line mode with `.sc-live` indicator.
- `frontend/components/animation-workspace/ProgressButton.tsx` — Reusable action button that transitions into a `role="progressbar"` button with tabular percentage and progress fill bar when a numeric progress is active.
- `frontend/components/animation-workspace/ControlRow.tsx` — Minimal playback control row (play/pause, tabular clock, current scene label, line-icon mute toggle, hover/focus-revealed volume slider, line-icon full screen toggle).
- `frontend/components/animation-workspace/SceneTabs.tsx` — Interactive timeline slider (`role="slider"`) with proportional scene tabs, playhead fill/line, comment pins, pointer scrubbing, and keyboard navigation (`Space`, `ArrowLeft`, `ArrowRight`).
- `frontend/components/animation-workspace/CommentsPanel.tsx` — Right-hand column with top `Render · N tokens` button and timed comments panel (`At M:SS` + `Scene N` chips, composer, pinned comment list, `ProgressButton` apply action).
- `frontend/components/animation-workspace/AnimationPrep.tsx` — Preparation and error state component supporting both in-stage `.aw-wait` overlay mode and standalone two-column per-scene progress mode.
- `frontend/app/dev/plate-preview-fixture/page.tsx` — Gated dev route (`404` unless `NEXT_PUBLIC_LIVE_DEV === "1"`) rendering `PlatePreview`, `PlateFinal`, and `TokenModal` from `FIXTURE_PROJECT` with no backend or auth.
- `frontend/test/fixtures/workspace/data.ts` — Deterministic 5-scene `illus-fox` (16:9) `VideoProject` fixture and per-state `PlateStatus` / `PlateExportState` generators.
- `frontend/test/fixtures/workspace/clip-16x9.mp4` — 11 KB deterministic I-frame-only 16:9 H.264 fixture video clip.
- `frontend/test/fixtures/workspace/clip-9x16.mp4` — 11 KB deterministic I-frame-only 9:16 H.264 fixture video clip.
- `frontend/test/fixtures/workspace/clip-1x1.mp4` — 11 KB deterministic I-frame-only 1:1 H.264 fixture video clip.
- `frontend/test/fixtures/workspace/still-16x9.png` — 1.5 KB 16:9 PNG still matching `clip-16x9.mp4`.
- `frontend/test/fixtures/workspace/still-9x16.png` — 2.1 KB 9:16 PNG still matching `clip-9x16.mp4`.
- `frontend/test/fixtures/workspace/still-1x1.png` — 1.8 KB 1:1 PNG still matching `clip-1x1.mp4`.
- `frontend/test/fixtures/workspace/voice.wav` — 27 KB silent WAV audio fixture for voice, music, and SFX interception.
- `frontend/test/workspace-logic.mjs` — Unit test suite (`node:test`) covering comment anchoring, scene-tab state mapping, option visibility rules, clock formatting, and subtitle cue building.
- `tools/phase3/capture.mjs` — Self-contained headless Chrome screenshot harness that boots `next dev` on a free `127.0.0.1` port, intercepts all API/media/font calls locally, freezes animations/transitions/media, and captures all 68 state × width × theme PNGs.
- `tools/phase3/compare.mjs` — Pure Node per-pixel PNG comparator reporting pixels differing by >2 levels, percentage >2 levels, total differing pixels, max channel delta, and writing amplified diff PNGs into `tools/phase3/diff/`.
- `tools/phase3/baseline/*.png` — 68 baseline screenshots captured from the unchanged `PlatePreview` and `PlateFinal`.
- `tools/phase3/after/*.png` — 68 post-extraction screenshots captured after wiring `PlatePreview` onto `AnimationWorkspace`.
- `docs/phase3/3a-report.md` — This report.

---

## 2. Exact Commands Run

```bash
# Baseline typecheck and test suite
cd frontend && npm run typecheck && npm test

# Generate small deterministic fixture media (~65 KB total)
ffmpeg -y -f lavfi -i "color=c=0x2a1f2d:s=640x360:r=10:d=4" -vf "drawbox=x=48:y=48:w=544:h=256:color=0xd97736:t=16,drawbox=x=224:y=112:w=192:h=128:color=0xf5ebe0:t=fill" -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 10 -bf 0 -g 1 -an frontend/test/fixtures/workspace/clip-16x9.mp4
ffmpeg -y -f lavfi -i "color=c=0x2a1f2d:s=360x640:r=10:d=4" -vf "drawbox=x=48:y=80:w=256:h=480:color=0xd97736:t=16,drawbox=x=96:y=240:w=160:h=160:color=0xf5ebe0:t=fill" -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 10 -bf 0 -g 1 -an frontend/test/fixtures/workspace/clip-9x16.mp4
ffmpeg -y -f lavfi -i "color=c=0x2a1f2d:s=480x480:r=10:d=4" -vf "drawbox=x=48:y=48:w=384:h=384:color=0xd97736:t=16,drawbox=x=160:y=160:w=160:h=160:color=0xf5ebe0:t=fill" -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 10 -bf 0 -g 1 -an frontend/test/fixtures/workspace/clip-1x1.mp4
ffmpeg -y -f lavfi -i "color=c=0x2a1f2d:s=640x360" -vf "drawbox=x=48:y=48:w=544:h=256:color=0xd97736:t=16,drawbox=x=224:y=112:w=192:h=128:color=0xf5ebe0:t=fill" -frames:v 1 -update 1 frontend/test/fixtures/workspace/still-16x9.png
ffmpeg -y -f lavfi -i "color=c=0x2a1f2d:s=360x640" -vf "drawbox=x=48:y=80:w=256:h=480:color=0xd97736:t=16,drawbox=x=96:y=240:w=160:h=160:color=0xf5ebe0:t=fill" -frames:v 1 -update 1 frontend/test/fixtures/workspace/still-9x16.png
ffmpeg -y -f lavfi -i "color=c=0x2a1f2d:s=480x480" -vf "drawbox=x=48:y=48:w=384:h=384:color=0xd97736:t=16,drawbox=x=160:y=160:w=160:h=160:color=0xf5ebe0:t=fill" -frames:v 1 -update 1 frontend/test/fixtures/workspace/still-1x1.png
ffmpeg -y -f lavfi -i "anullsrc=r=8000:cl=mono" -t 3.5 -c:a pcm_u8 frontend/test/fixtures/workspace/voice.wav

# Step 1: Capture baseline twice from unchanged PlatePreview and verify determinism
node tools/phase3/capture.mjs tools/phase3/baseline
node tools/phase3/capture.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/baseline-check
node tools/phase3/compare.mjs tools/phase3/baseline /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/baseline-check /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/baseline-diff

# Step 2: Capture after extraction and compare against baseline
node tools/phase3/capture.mjs tools/phase3/after
node tools/phase3/compare.mjs tools/phase3/baseline tools/phase3/after tools/phase3/diff

# Deliberate sanity check (change .animation-workspace top padding 8px -> 16px, verify failure, then revert)
node tools/phase3/capture.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/sanity-after
node tools/phase3/compare.mjs tools/phase3/baseline /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/sanity-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/sanity-diff

# Post-extraction typecheck and full frontend test suite
cd frontend && npm run typecheck && npm test
```

---

## 3. Captured States, Comparison Table, Determinism Check, and Sanity Check

### List of Captured States (17 states × 2 widths × 2 themes = 68 images)

1. `a-prep-drawing` — **(a)** Prep/waiting state with scenes still drawing (3/5 scenes drawn = 60%, scene 1 `rendering` on stage with spinner, scene 5 `authoring`, toolbar status `3/5 drawn…`, `Render` and `Drawing…` buttons disabled).
2. `b-prep-error` — **(b)** Prep/error state where scene 1 and scene 5 failed (`This scene didn't draw` + error message on stage, amber border on failed scene tabs, `3/5 drawn` status and `Retry` button in toolbar).
3. `c-ready` — **(c)** Ready state, paused at `0:00`, scene 1 selected, `Storybook` subtitle cue visible on stage, no comments (`Comments you add are pinned to this moment of the film.`).
4. `d-comments` — **(d)** Ready state with 2 comments in the `Comments` panel (one untimed at `0:00` on Scene 1, one timed at `0:06` on Scene 2), two timeline pins, and `Redraw scenes 1, 2` enabled.
5. `e-audio-open` — **(e)** `Audio` toolbar mode open showing inline `Voice`, `Music`, `SFX`, and `Transitions` track chips.
6. `f-subtitle-style` — **(f)** `Subtitle` toolbar mode with the `Subtitle Style` dialog open (`Pill`, `Cinema`, `Kinetic`, `Storybook`, `Blueprint` cards).
7. `g-token-modal` — **(g)** `TokenModal` (`Add tokens to render`, 15 tokens cost vs 5 balance, 100-token pack + Starter/Pro/Studio plans) opened by clicking `Render · 15 tokens`.
8. `h-scene-updating` — **(h)** Scene 1 ready and shown on stage while Scene 2 tab shows updating (`rendering` striped state) and Scene 4 tab shows needs-update/failed (`failed` amber border), with 1 pinned comment.
9. `i-aspect-picker` — **(i)** Floating dimension rail open showing all three ratios (`16:9`, `9:16`, `1:1`) with non-primary `9:16` selected and stage resized to portrait `9:16`.
10. `j-hover-volume-fullscreen` — **(j)** Full-screen button hovered/focused with the hover-only volume slider (`.aw-volume`) expanded in `.aw-options`.
11. `k-plate-final` — **(k)** `PlateFinal` review screen showing `16:9` (ready), `9:16` (ready), and `1:1 · 65%` (preparing) ratio tabs, video player, download actions, `← Back to Animation`, and `Approve final`.
12. `l-subtitle-mode` — Additional state: `Subtitle Mode` dropdown open (`Off`, `Key phrases`, `Subtitles`).
13. `m-subtitle-colors` — Additional state: `Subtitle Colors` dialog open (Text Color and Box/Outline Color swatches + custom color pickers).
14. `n-subtitle-opacity` — Additional state: `Transparency` popover open (`100%` range slider).
15. `o-subtitle-position` — Additional state: `Subtitle Position · Scene 1` dialog open (6-way alignment grid, vertical Y offset slider, `Apply to all scenes`, `Reset all`).
16. `p-aspect-drawing` — Additional state: Non-primary aspect `9:16` selected while `drawingAspects` includes `9:16`, showing `Drawing scenes in 9:16…` in-stage prep overlay.
17. `q-plate-final-approved` — Additional state: `PlateFinal` in `approved={true}` (`✓ Approved · locked`) state with a failed companion ratio (`1:1 · failed`).

### Determinism Check (Baseline Run 1 vs Baseline Run 2 on Unchanged `PlatePreview`)

Captured all 68 images twice in a row into `tools/phase3/baseline/` and `/private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/baseline-check/` and compared with `tools/phase3/compare.mjs`:
- **Result:** **68/68 passed with 0 differing pixels** (`0.0000%` over 2 levels, `0` any differing pixels, `maxDelta = 0` on all 68 images).

### Baseline vs After Comparison Table (`tools/phase3/baseline` vs `tools/phase3/after`)

| Image | Differing px (>2 levels) | % > 2 levels | Any diff px | Max delta | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `a-prep-drawing-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `a-prep-drawing-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `a-prep-drawing-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `a-prep-drawing-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `b-prep-error-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `b-prep-error-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `b-prep-error-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `b-prep-error-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `c-ready-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `c-ready-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `c-ready-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `c-ready-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `d-comments-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `d-comments-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `d-comments-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `d-comments-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `e-audio-open-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `e-audio-open-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `e-audio-open-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `e-audio-open-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `f-subtitle-style-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `f-subtitle-style-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `f-subtitle-style-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `f-subtitle-style-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `g-token-modal-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `g-token-modal-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `g-token-modal-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `g-token-modal-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `h-scene-updating-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `h-scene-updating-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `h-scene-updating-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `h-scene-updating-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `i-aspect-picker-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `i-aspect-picker-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `i-aspect-picker-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `i-aspect-picker-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `j-hover-volume-fullscreen-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `j-hover-volume-fullscreen-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `j-hover-volume-fullscreen-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `j-hover-volume-fullscreen-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `k-plate-final-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `k-plate-final-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `k-plate-final-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `k-plate-final-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `l-subtitle-mode-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `l-subtitle-mode-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `l-subtitle-mode-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `l-subtitle-mode-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `m-subtitle-colors-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `m-subtitle-colors-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `m-subtitle-colors-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `m-subtitle-colors-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `n-subtitle-opacity-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `n-subtitle-opacity-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `n-subtitle-opacity-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `n-subtitle-opacity-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `o-subtitle-position-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `o-subtitle-position-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `o-subtitle-position-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `o-subtitle-position-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `p-aspect-drawing-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `p-aspect-drawing-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `p-aspect-drawing-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `p-aspect-drawing-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `q-plate-final-approved-1280-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `q-plate-final-approved-1280-light.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `q-plate-final-approved-400-dark.png` | 0 | 0.0000% | 0 | 0 | PASS |
| `q-plate-final-approved-400-light.png` | 0 | 0.0000% | 0 | 0 | PASS |

**Summary:** **68/68 passed with 0 differing pixels** (`tools/phase3/diff/` is empty because 0 images differed).

### Deliberate Sanity Check Evidence

Temporarily changed `.animation-workspace` top padding in `frontend/app/animation-workspace.css` from `padding: 8px 24px 12px` to `padding: 16px 24px 12px` and ran `tools/phase3/capture.mjs` + `tools/phase3/compare.mjs`:
- **Result:** `compare.mjs` exited with code `1` (`38/68 passed`); all 30 desktop (`1280x800`) `AnimationWorkspace` states failed immediately with **5.4954% to 12.9978%** of pixels differing by >2 levels (`56,273` to `133,097` pixels per image, `maxDelta = 255`), and generated amplified diff PNGs.
- Reverted `padding: 16px 24px 12px` back to `padding: 8px 24px 12px` and re-ran `compare.mjs`, restoring **68/68 PASS (0 differing pixels)**.

---

## 4. Before and After for Typecheck and Frontend Test Suite

| Check | Before (Baseline) | After (Phase 3a) |
| --- | --- | --- |
| `npm run typecheck` (`tsc --noEmit` in `frontend/`) | Pass (0 errors) | Pass (0 errors) |
| `npm test` (`node --test "test/*.mjs"` in `frontend/`) | **145 pass**, 0 fail | **151 pass**, 0 fail (+6 unit tests in `test/workspace-logic.mjs`) |
| `frontend/components/studio.tsx` | Untouched | Untouched (`git diff` empty) |

---

## 5. Line Counts and `AnimationWorkspace` Component API (for Phase 3b)

### Line Counts

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `frontend/components/plate-preview.tsx` | 1,222 | 810 | -412 |
| `frontend/app/plate-preview.css` | 337 | 23 | -314 |
| `frontend/app/animation-workspace.css` | — | 303 | +303 (new) |
| `frontend/components/animation-workspace/AnimationWorkspace.tsx` | — | 184 | +184 (new) |
| `frontend/components/animation-workspace/OptionsBar.tsx` | — | 507 | +507 (new) |
| `frontend/components/animation-workspace/CommentsPanel.tsx` | — | 163 | +163 (new) |
| `frontend/components/animation-workspace/AnimationPrep.tsx` | — | 136 | +136 (new) |
| `frontend/components/animation-workspace/ControlRow.tsx` | — | 120 | +120 (new) |
| `frontend/components/animation-workspace/SceneTabs.tsx` | — | 98 | +98 (new) |
| `frontend/components/animation-workspace/ProgressButton.tsx` | — | 83 | +83 (new) |
| `frontend/components/animation-workspace/StatusLine.tsx` | — | 49 | +49 (new) |
| `frontend/components/animation-workspace/logic.ts` | — | 235 | +235 (new) |
| `frontend/components/animation-workspace/types.ts` | — | 170 | +170 (new) |
| `frontend/components/animation-workspace/index.ts` | — | 10 | +10 (new) |

### Component API (`AnimationWorkspaceProps`) for Phase 3b HyperFrames Adoption

```ts
export interface AnimationWorkspaceProps {
  /** Current viewed aspect ratio ("16:9" | "9:16" | "1:1"). */
  aspect: WorkspaceAspect;
  /** Aspect picker options and selection callback. */
  aspects: readonly WorkspaceAspectOption[];
  onSelectAspect: (aspect: WorkspaceAspect) => void;
  /** Top-level error alert banners, if any. */
  errors?: readonly string[];
  /**
   * Which options the engine honours (omitted options are hidden, never disabled).
   * For HyperFrames in 3b, pass e.g.:
   * `{ audioTracks: ["voice", "music"], subtitleModes: ["none", "key-phrases"], subtitleStyle: false, subtitleSize: false, subtitleColors: false, subtitleOpacity: false, subtitlePosition: false }`
   */
  optionsConfig?: WorkspaceOptionsConfig;
  /** Audio track toggle state and handlers. */
  audioControls?: WorkspaceAudioControlState;
  /** Subtitle customization state and handlers. */
  subtitleControls?: WorkspaceSubtitleControlState;
  /** Optional status chip and retry button at the end of the options bar. */
  statusBadge?: WorkspaceStatusBadge | null;
  /** Renders the engine-specific stage surface inside `.aw-canvas`. */
  renderStage: () => ReactNode;
  /** Optional click handler on the stage canvas (e.g. toggle play/pause). */
  onStageClick?: () => void;
  /** Optional ref to `.aw-canvas` (used for pointer drag calculations). */
  canvasRef?: RefObject<HTMLDivElement | null>;
  /** Extra hidden media elements (e.g. `<audio>` tags) mounted inside `.aw-frame`. */
  frameExtras?: ReactNode;
  /** Playback controls state. */
  playing: boolean;
  playDisabled?: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  totalDuration: number;
  currentSceneIndex: number;
  currentSceneLabel: string;
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  onChangeVolume: (volume: number) => void;
  /** Scene tabs & timeline scrubbing. */
  scenes: readonly WorkspaceSceneTab[];
  onSeek: (seconds: number) => void;
  /** Comments panel state and handlers. */
  comments: readonly WorkspaceComment[];
  commentDraft: string;
  onChangeCommentDraft: (draft: string) => void;
  onCommentFocus?: () => void;
  canAddComment: boolean;
  addingComment?: boolean;
  onAddComment: () => void;
  onRemoveComment: (id: string) => void;
  onApplyComments: () => void;
  applyingComments?: boolean;
  applyBusyLabel?: string;
  applyIdleEmptyLabel?: string;
  applyPrefix?: string;
  commentsNote?: string;
  /** Primary render action at the top of the right column. */
  onRender?: () => void;
  rendering?: boolean;
  cost?: number;
}
```

### Accessibility and Keyboard Parity
- Every role (`toolbar`, `tablist`, `tab`, `group`, `dialog`, `slider`, `alert`, `status`, `progressbar`), `aria-label`, `aria-selected`, `aria-pressed`, `aria-expanded`, `aria-valuemin`/`max`/`now`/`valuetext`, and `aria-live="polite"` attribute from `PlatePreview` is preserved unchanged.
- Keyboard shortcuts in `SceneTabs` (`Space` to toggle play/pause, `ArrowLeft` / `ArrowRight` to seek ±1s), `OptionsBar` (`Escape` to close open dropdowns), and `CommentsPanel` (`Cmd/Ctrl+Enter` to add comment) are preserved unchanged.

---

## 6. Decisions Where the Brief Was Silent, Contradictions, and Risks

1. **Contradiction noted — "(e) Audio control open / the voice preview modal":** `PlatePreview` has an inline `Audio` toolbar mode (`Voice`, `Music`, `SFX`, `Transitions` track chips inside `.pp-floating-bar`) and does not have a voice preview modal. We captured the inline `Audio` toolbar mode for `(e)`.
2. **Contradiction noted — "(g) the token modal for Render":** `PlatePreview` itself does not import or render `TokenModal`; it renders the `.pp-render-top` button (`Render · N tokens`) and invokes its `onRender` prop, while `TokenModal` is exported from `frontend/components/script-canvas.tsx`. To keep `PlatePreview` behaviour 100% unchanged while capturing `(g)`, `frontend/app/dev/plate-preview-fixture/page.tsx` wires `onRender` to open `<TokenModal cost={15} balance={5} />` when `Render` is clicked.
3. **Contradiction noted — `usePlateRatios` export:** The brief stated `also the exports PlatePreview, PlateFinal, usePlateRatios`, whereas `usePlateRatios` was previously a non-exported function in `plate-preview.tsx`. We added the `export` keyword to `usePlateRatios` so all three named symbols are exported.
4. **Contradiction noted — Prep screen in `PlatePreview` vs `BrowserAnimationStep`:** `PlatePreview` displays preparation progress and scene errors inside the workspace (`.aw-wait` on the stage, `n/5 drawn…` + `Retry` in the top bar, and striped/amber scene tabs), whereas `BrowserAnimationStep` in `studio.tsx` uses a separate two-column prep screen before mounting the player. `AnimationPrep` supports both `mode="stage"` (used by `PlatePreview` with 0 pixel diff) and `mode="full"` (the two-column progress + per-scene `✓`/`⋯` view for Phase 3b).
5. **Narrow viewport (`400x800`) observations (not changed per no-behaviour-change rule):**
   - At `400px` width, `.aw-floating-bar` (`flex-wrap: nowrap`) overflows horizontally past the viewport when all subtitle controls are open.
   - At `400px` width, hovering `.aw-options` expands `.aw-volume` from `0px` to `72px`, which causes `.aw-controls` (`flex-wrap: wrap`) to wrap `.aw-options` onto a second line if hovered by pointer alone; focusing `.aw-opt` first (`:focus-within`) keeps the volume slider stable.

---

## 7. Manager verification (independent re-check, 2026-11-05)

The agent's baseline was captured by the agent itself, so it was re-checked against the **committed original**: the original `plate-preview.tsx` and `plate-preview.css` from `HEAD` were put back temporarily (with `usePlateRatios` exported), the same capture script was run, and the files were restored (`git diff --stat` identical before and after). Results:

- HEAD original vs the agent's baseline: 67/68 identical; HEAD original vs the agent's `after`: 67/68 identical.
- HEAD original vs a fresh capture of the refactored component: 66/68 identical.
- The non-identical images are always the same kind: `n-subtitle-opacity-1280-dark` (every comparison) and `m-subtitle-colors-1280-dark` (one run), each **42 pixels over 2 levels (69 any, maximum 7 levels)**, at the corners of the selected subtitle box. The same difference appears between two captures of the **unchanged** original component, so it is capture noise in those two popover states, not a refactor difference.
- `frontend`: typecheck clean, 151 of 151 tests pass; `studio.tsx` untouched; `layout.tsx` gained one import line.
