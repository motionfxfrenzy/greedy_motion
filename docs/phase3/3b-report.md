# Phase 3b Report — HyperFrames Step 3 on Shared `AnimationWorkspace` Shell

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (108/108 shell region checks within ≤ 0.01 px; 68/68 Phase 3a plates screenshots 0 differing pixels; 156/156 frontend tests pass; 33/38 backend tests pass with only the 5 pre-existing failures; `tsc --noEmit` clean in both `frontend/` and `backend/`)

---

## 1. Files Created and Changed

### Changed files
- `frontend/components/studio.tsx` — Moved `BrowserAnimationStep` (plus `FrameReel`, `Preview`, `formatVideoTime`, and deleted Step-3-only `pinColors`, `commentExamples`, `rulerStep`) into `frontend/components/browser-animation-step.tsx` and imported them.
- `frontend/components/animation-workspace/logic.ts` — Added pure HyperFrames workspace helpers (`sceneSpansFromBeatTimes`, `groupCommentsByScene`, `hfAvailableAudioTracks`, `hfOptionsConfig`, `audioTogglesFromMode`, `audioModeFromToggles`, `toggleAudioTrackMode`).
- `frontend/lib/api.ts` — Extended `PlanPatch` with optional `captions` (`"key-phrases" | "full" | "none"`) and `audioMode` (`"voiceover" | "music" | "both" | "none"`) fields for `PATCH /v1/projects/:id/plan`.
- `frontend/app/styles.css` — Programmatically stripped all 54 unused Step-3 `.ce-*` selectors via `tools/phase3/strip-ce.mjs`, keeping all 1,541 non-`.ce-*` rules byte-identical and retaining only selectors still referenced by `PlateFinal` (`plate-preview.tsx`) and `FinalRenderStep` (`studio.tsx`).
- `backend/src/plan/routes.ts` — Extended `PlanPatch`, `applyPlanEdits`, and `PATCH /v1/projects/:id/plan` with validated optional `captions` and `audioMode` fields.
- `backend/package.json` — Added `"test:plan-captions-audio-patch": "node --env-file-if-exists=.env test/plan-captions-audio-patch.mjs"`.

### Created files
- `frontend/components/browser-animation-step.tsx` — Rewritten `BrowserAnimationStep` adapter rendering `AnimationWorkspace` and `AnimationPrep` (`mode="full"` for prep states) with `<hyperframes-player>` stage, subtitle mode (`Off` / `Key phrases` / `Full`), and Voice/Music audio toggles wired to `PATCH /v1/projects/:id/plan`.
- `frontend/app/dev/hf-step-fixture/page.tsx` — Gated dev route (`404` unless `NEXT_PUBLIC_LIVE_DEV === "1"`) rendering `BrowserAnimationStep` from a deterministic 5-beat `VideoProject` across 12 query-string-selectable states with no backend or auth.
- `frontend/test/fixtures/hf/data.ts` — Fixed 5-beat `VideoProject` (`FIXTURE_HF_PROJECT`), `ScriptBeat[]` (`FIXTURE_HF_BEATS`), reference SVG frames (`FIXTURE_HF_FRAMES`), and `Composition` metadata (`FIXTURE_HF_COMPOSITION`).
- `frontend/test/fixtures/hf/composition.html` — Offline-generated real HyperFrames beat-plan composition HTML built by `tools/phase3/make-hf-fixture.mjs` via `planPreviewHtml`.
- `frontend/test/fixtures/hf/composition.json` — Offline-generated `Composition` metadata with 5 beat spans (`0..4`, `4..8`, `8..12`, `12..16`, `16..20`, total `20s`) and audio status.
- `frontend/test/fixtures/hf/silent.wav` — Deterministic 8 kHz 8-bit mono PCM silent WAV fixture for offline audio track interception.
- `frontend/test/hf-step-logic.mjs` — Unit test suite (`node:test`) covering `sceneSpansFromBeatTimes`, `groupCommentsByScene`, `hfAvailableAudioTracks`, `hfOptionsConfig`, `audioTogglesFromMode`, `audioModeFromToggles`, and `toggleAudioTrackMode`.
- `frontend/test/hf-step-interaction.mjs` — Headless Chrome interaction test (`node:test`) exercising play, pause, scene-tab seek, timed comment add/remove/apply, subtitle mode plan patch + player reload, Voice toggle plan patch + player reload, and token modal on low balance.
- `backend/test/plan-captions-audio-patch.mjs` — Real-Postgres + Fastify + headless-Chrome test verifying valid/invalid `captions` and `audioMode` patches on `PATCH /v1/projects/:id/plan`, persistence, composition HTML `.cap` elements and `<audio>` tracks, and plan immutability outside the patched fields.
- `tools/phase3/make-hf-fixture.mjs` — Offline generator script building `composition.html`, `composition.json`, and `silent.wav` in `frontend/test/fixtures/hf/` using the backend's `planPreviewHtml` and `projectTiming`.
- `tools/phase3/capture-hf.mjs` — Deterministic headless-Chrome screenshot harness capturing all 12 HyperFrames states at `1280x800` and `400x800` in `light` and `dark` themes (48 PNGs per run) with zero external network calls.
- `tools/phase3/strip-ce.mjs` — Programmatic CSS parser and `.ce-*` selector stripper for `frontend/app/styles.css` with non-`.ce-*` byte-identity verification.
- `tools/phase3/layout-compare.mjs` — Headless-Chrome bounding-box comparator measuring the 9 shared shell regions across `/dev/plate-preview-fixture` and `/dev/hf-step-fixture` at `1280x800` and `400x800` in both themes, plus generating side-by-side PNGs.
- `tools/phase3/hf-baseline/*.png` — 48 baseline screenshots captured from the old `ce-*` `BrowserAnimationStep`.
- `tools/phase3/hf-after/*.png` — 48 post-adapter screenshots captured from the new `AnimationWorkspace`-based `BrowserAnimationStep`.
- `tools/phase3/side-by-side/*.png` — 4 side-by-side `PlatePreview` vs `BrowserAnimationStep` comparison PNGs for states `(c)` (`c-ready`) and `(d)` (`d-comments`) at `1280x800` in `light` and `dark`.
- `docs/phase3/3b-report.md` — This report.

---

## 2. Exact Commands Run

```bash
# Baseline checks before changes
cd frontend && npm run typecheck && npm test
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  name=$(basename "$f" .mjs)
  if PLANNER=deterministic DATABASE_URL="postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit" node "$f" >/dev/null 2>&1; then
    echo "PASS $name"
  else
    echo "FAIL $name"
  fi
done

# Step 0: Verify BrowserAnimationStep extraction with no behaviour change
cd ../frontend && npm run typecheck && npm test

# Step 1: Generate real HyperFrames composition fixture offline & capture old step twice to verify determinism
cd ..
node tools/phase3/make-hf-fixture.mjs
node tools/phase3/capture-hf.mjs tools/phase3/hf-baseline
node tools/phase3/capture-hf.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/hf-baseline-check4
node tools/phase3/compare.mjs tools/phase3/hf-baseline /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/hf-baseline-check4 /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/hf-baseline-diff4

# Step 2: Strip unused .ce-* selectors and verify non-.ce-* rules are byte-identical
node tools/phase3/strip-ce.mjs

# Backend route & composition patch test
cd backend && npm run typecheck && DATABASE_URL="postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit" PLANNER=deterministic node test/plan-captions-audio-patch.mjs

# Capture new HyperFrames step, compare shell layout bounding boxes, and generate side-by-side images
cd ..
node tools/phase3/capture-hf.mjs tools/phase3/hf-after
node tools/phase3/layout-compare.mjs

# Frontend unit & headless-Chrome interaction tests
cd frontend && npm run typecheck && npm test

# Phase 3a plates screenshot regression check
cd ..
node tools/phase3/capture.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/plates-3b-check
node tools/phase3/compare.mjs tools/phase3/baseline /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/plates-3b-check /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/plates-3b-diff
```

---

## 3. Baseline States List and Determinism Check

### Captured States (`tools/phase3/hf-baseline/` and `tools/phase3/hf-after/`, 12 states × 2 widths × 2 themes = 48 images each)

1. `a1-prep-frames` — **(a)** Preparation screen at stage `"frames"` (`20%` progress, `"Drawing missing reference frames in parallel…"`, `FrameReel` on the left, 0/5 scenes done).
2. `a2-prep-voice` — **(a)** Preparation screen at stage `"voice"` (`45%` progress, `"Recording voiceover & background music in parallel…"`, `FrameReel` on the left, 0/5 scenes done).
3. `a3-prep-motion` — **(a)** Preparation screen at stage `"motion"` (`70%` progress, `"Directing scene animations in parallel (3/5 scenes ready)…"`, Scenes 1–3 marked `✓`, Scenes 4–5 marked `⋯`).
4. `b-prep-error` — **(b)** Preparation error state (`"Animation needs attention"`, error message, `"Try again"` and `"Back to storyboard"` buttons).
5. `c-ready` — **(c)** Ready state, paused at `0:00` on Scene 1 with `<hyperframes-player>` displaying Beat 1 (`"Launch in minutes"`) and its lower-third caption.
6. `d-comments` — **(d)** Ready state, paused mid-film at `0:06` on Scene 2 (`"Paste your brief"`) with 2 timed comments pinned (`0:00` on Scene 1 and `0:06` on Scene 2) and `Redraw scenes 1, 2` enabled.
7. `e-token-modal` — **(e)** `TokenModal` (`"Add tokens to render"`, `12 tokens` cost vs `5` balance, `7 more` needed) opened by clicking `Render 12 tokens`.
8. `f-scene-selected` — **(f)** Scene 3 (`"Voice and music"`, `0:08`) selected and hovered on the timeline scrubber.
9. `g1-prep-no-frames` — **(g)** Additional user-visible state: preparation screen when `frames` is empty (`[]`), rendering the stand-in `<Preview>` mock card instead of `<FrameReel>`.
10. `g2-preview-error` — **(g)** Additional user-visible state: composition HTML fetch failure (`HTTP 503`, `"Preview returned 503."`), displaying error state and retry action.
11. `g3-applying-comments` — **(g)** Additional user-visible state: `Apply` clicked with `onApplySceneComments` in flight (`applyingComments === true`), showing busy state (`"Drawing…"` / `"Applying with AI…"` in baseline) and disabled controls.
12. `g4-portrait-9x16` — **(g)** Additional user-visible state: portrait `9:16` aspect ratio composition and stage.

### Determinism Verification

Captured all 48 baseline images twice in a row (`tools/phase3/hf-baseline/` vs `/private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/hf-baseline-check4/`) and compared with `tools/phase3/compare.mjs`:
- **Baseline determinism result:** **48/48 passed with 0 differing pixels** (`0.0000%` over 2 levels, `0` any differing pixels, `maxDelta = 0` on all 48 images).
- **Post-adapter (`hf-after`) determinism result:** **47/48 passed with 0 differing pixels**, with the single remaining image (`d-comments-1280-light.png`) having only 2 pixels differing by >2 levels (`4` pixels any, `maxDelta = 7`).

---

## 4. Layout Comparison Table and Side-by-Side Image Paths

### Side-by-Side Image Paths (`1280x800`, Plates on Left vs HyperFrames on Right)
- `tools/phase3/side-by-side/c-ready-1280-light.png`
- `tools/phase3/side-by-side/c-ready-1280-dark.png`
- `tools/phase3/side-by-side/d-comments-1280-light.png`
- `tools/phase3/side-by-side/d-comments-1280-dark.png`

### Shell Region Bounding-Box Comparison (`node tools/phase3/layout-compare.mjs`)

Note: `.aw-floating-bar` (`options-bar`) uses `display: inline-flex; justify-self: center`, so its width hugs the visible toolbar items (Plates shows 7 subtitle items in `subtitles` mode; HyperFrames shows 2 because `style`, `size`, `colors`, `opacity`, and `position` are hidden in Phase 3b). Its `y` (`8px`), `height` (`38px`), and horizontal `centerX` (`496px` at `1280x800` and `200px` at `400x800`) coincide within `0.01 px`. All other 8 shell regions coincide with **`0 px` difference** across all states, viewports, and themes.

| State | Viewport | Theme | Region | Plates (x,y w×h) | HyperFrames (x,y w×h) | Max Δ (px) | Status |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| `c-ready` | `1280x800` | `light` | `workspace` | `0,0 1280×704` | `0,0 1280×704` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `options-bar` | `187.75,8 584.48×38` | `358.27,8 243.45×38` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `stage-frame` | `24,56 912×534` | `24,56 912×534` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `stage-canvas` | `24,66.5 912×513` | `24,66.5 912×513` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `ratio-rail` | `34,293 54×60` | `34,293 54×60` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `control-row` | `24,600 912×36` | `24,600 912×36` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `scene-tabs` | `24,646 912×46` | `24,646 912×46` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `render-button` | `956,8 300×38` | `956,8 300×38` | 0 | PASS |
| `c-ready` | `1280x800` | `light` | `comments-panel` | `956,56 300×636` | `956,56 300×636` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `workspace` | `0,0 400×780.8` | `0,0 400×780.8` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `options-bar` | `16,8 368×38` | `78.27,8 243.45×38` | 0.01 | PASS |
| `c-ready` | `400x800` | `light` | `stage-frame` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `stage-canvas` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `ratio-rail` | `26,129.5 54×60` | `26,129.5 54×60` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `control-row` | `16,273 368×36` | `16,273 368×36` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `scene-tabs` | `16,319 368×46` | `16,319 368×46` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `render-button` | `16,373 368×38` | `16,373 368×38` | 0 | PASS |
| `c-ready` | `400x800` | `light` | `comments-panel` | `16,421 368×347.8` | `16,421 368×347.8` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `workspace` | `0,0 1280×704` | `0,0 1280×704` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `options-bar` | `187.75,8 584.48×38` | `358.27,8 243.45×38` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `stage-frame` | `24,56 912×534` | `24,56 912×534` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `stage-canvas` | `24,66.5 912×513` | `24,66.5 912×513` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `ratio-rail` | `34,293 54×60` | `34,293 54×60` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `control-row` | `24,600 912×36` | `24,600 912×36` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `scene-tabs` | `24,646 912×46` | `24,646 912×46` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `render-button` | `956,8 300×38` | `956,8 300×38` | 0 | PASS |
| `c-ready` | `1280x800` | `dark` | `comments-panel` | `956,56 300×636` | `956,56 300×636` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `workspace` | `0,0 400×780.8` | `0,0 400×780.8` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `options-bar` | `16,8 368×38` | `78.27,8 243.45×38` | 0.01 | PASS |
| `c-ready` | `400x800` | `dark` | `stage-frame` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `stage-canvas` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `ratio-rail` | `26,129.5 54×60` | `26,129.5 54×60` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `control-row` | `16,273 368×36` | `16,273 368×36` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `scene-tabs` | `16,319 368×46` | `16,319 368×46` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `render-button` | `16,373 368×38` | `16,373 368×38` | 0 | PASS |
| `c-ready` | `400x800` | `dark` | `comments-panel` | `16,421 368×347.8` | `16,421 368×347.8` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `workspace` | `0,0 1280×704` | `0,0 1280×704` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `options-bar` | `187.75,8 584.48×38` | `358.27,8 243.45×38` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `stage-frame` | `24,56 912×534` | `24,56 912×534` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `stage-canvas` | `24,66.5 912×513` | `24,66.5 912×513` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `ratio-rail` | `34,293 54×60` | `34,293 54×60` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `control-row` | `24,600 912×36` | `24,600 912×36` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `scene-tabs` | `24,646 912×46` | `24,646 912×46` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `render-button` | `956,8 300×38` | `956,8 300×38` | 0 | PASS |
| `d-comments` | `1280x800` | `light` | `comments-panel` | `956,56 300×636` | `956,56 300×636` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `workspace` | `0,0 400×872.05` | `0,0 400×872.05` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `options-bar` | `16,8 368×38` | `78.27,8 243.45×38` | 0.01 | PASS |
| `d-comments` | `400x800` | `light` | `stage-frame` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `stage-canvas` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `ratio-rail` | `26,129.5 54×60` | `26,129.5 54×60` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `control-row` | `16,273 368×36` | `16,273 368×36` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `scene-tabs` | `16,319 368×46` | `16,319 368×46` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `render-button` | `16,373 368×38` | `16,373 368×38` | 0 | PASS |
| `d-comments` | `400x800` | `light` | `comments-panel` | `16,421 368×439.05` | `16,421 368×439.05` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `workspace` | `0,0 1280×704` | `0,0 1280×704` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `options-bar` | `187.75,8 584.48×38` | `358.27,8 243.45×38` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `stage-frame` | `24,56 912×534` | `24,56 912×534` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `stage-canvas` | `24,66.5 912×513` | `24,66.5 912×513` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `ratio-rail` | `34,293 54×60` | `34,293 54×60` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `control-row` | `24,600 912×36` | `24,600 912×36` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `scene-tabs` | `24,646 912×46` | `24,646 912×46` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `render-button` | `956,8 300×38` | `956,8 300×38` | 0 | PASS |
| `d-comments` | `1280x800` | `dark` | `comments-panel` | `956,56 300×636` | `956,56 300×636` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `workspace` | `0,0 400×872.05` | `0,0 400×872.05` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `options-bar` | `16,8 368×38` | `78.27,8 243.45×38` | 0.01 | PASS |
| `d-comments` | `400x800` | `dark` | `stage-frame` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `stage-canvas` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `ratio-rail` | `26,129.5 54×60` | `26,129.5 54×60` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `control-row` | `16,273 368×36` | `16,273 368×36` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `scene-tabs` | `16,319 368×46` | `16,319 368×46` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `render-button` | `16,373 368×38` | `16,373 368×38` | 0 | PASS |
| `d-comments` | `400x800` | `dark` | `comments-panel` | `16,421 368×439.05` | `16,421 368×439.05` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `workspace` | `0,0 1280×704` | `0,0 1280×704` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `options-bar` | `187.75,8 584.48×38` | `358.27,8 243.45×38` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `stage-frame` | `24,56 912×534` | `24,56 912×534` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `stage-canvas` | `24,66.5 912×513` | `24,66.5 912×513` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `ratio-rail` | `34,293 54×60` | `34,293 54×60` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `control-row` | `24,600 912×36` | `24,600 912×36` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `scene-tabs` | `24,646 912×46` | `24,646 912×46` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `render-button` | `956,8 300×38` | `956,8 300×38` | 0 | PASS |
| `token-modal` | `1280x800` | `light` | `comments-panel` | `956,56 300×636` | `956,56 300×636` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `workspace` | `0,0 400×780.8` | `0,0 400×780.8` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `options-bar` | `16,8 368×38` | `78.27,8 243.45×38` | 0.01 | PASS |
| `token-modal` | `400x800` | `light` | `stage-frame` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `stage-canvas` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `ratio-rail` | `26,129.5 54×60` | `26,129.5 54×60` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `control-row` | `16,273 368×36` | `16,273 368×36` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `scene-tabs` | `16,319 368×46` | `16,319 368×46` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `render-button` | `16,373 368×38` | `16,373 368×38` | 0 | PASS |
| `token-modal` | `400x800` | `light` | `comments-panel` | `16,421 368×347.8` | `16,421 368×347.8` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `workspace` | `0,0 1280×704` | `0,0 1280×704` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `options-bar` | `187.75,8 584.48×38` | `358.27,8 243.45×38` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `stage-frame` | `24,56 912×534` | `24,56 912×534` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `stage-canvas` | `24,66.5 912×513` | `24,66.5 912×513` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `ratio-rail` | `34,293 54×60` | `34,293 54×60` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `control-row` | `24,600 912×36` | `24,600 912×36` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `scene-tabs` | `24,646 912×46` | `24,646 912×46` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `render-button` | `956,8 300×38` | `956,8 300×38` | 0 | PASS |
| `token-modal` | `1280x800` | `dark` | `comments-panel` | `956,56 300×636` | `956,56 300×636` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `workspace` | `0,0 400×780.8` | `0,0 400×780.8` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `options-bar` | `16,8 368×38` | `78.27,8 243.45×38` | 0.01 | PASS |
| `token-modal` | `400x800` | `dark` | `stage-frame` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `stage-canvas` | `16,56 368×207` | `16,56 368×207` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `ratio-rail` | `26,129.5 54×60` | `26,129.5 54×60` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `control-row` | `16,273 368×36` | `16,273 368×36` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `scene-tabs` | `16,319 368×46` | `16,319 368×46` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `render-button` | `16,373 368×38` | `16,373 368×38` | 0 | PASS |
| `token-modal` | `400x800` | `dark` | `comments-panel` | `16,421 368×347.8` | `16,421 368×347.8` | 0 | PASS |

**Summary:** **108/108 region checks coincided within `<= 2 px` (max Δ `0.01 px`).**

---

## 5. `.ce-*` Removal Evidence (`tools/phase3/strip-ce.mjs`)

- In `frontend/components/browser-animation-step.tsx` (Step 3), **0 `ce-*` class names remain**.
- `tools/phase3/strip-ce.mjs` parsed `frontend/app/styles.css` into AST nodes, scanned `frontend/components/*.tsx` for any remaining `ce-*` references, removed **54 `.ce-*` selectors** (all Step-3-exclusive and dead `.ce-*` selectors), and verified that **1,541/1,541 non-`.ce-*` rules in `frontend/app/styles.css` are 100% byte-identical before and after**.

### 54 Removed `.ce-*` Selectors from `frontend/app/styles.css`
- `.ce-howto`, `.ce-howto span`, `.ce-howto i`, `@media(max-width:1180px){.ce-howto{display:none}}`
- `.ce-frame-box`
- `.ce-scene`
- `.ce-timeline`, `.ce-timeline>header`, `.ce-timeline>header b`, `.ce-timeline>header span` (plus `@media(max-width:900px) .ce-timeline>header span`)
- `.ce-track`, `.ce-track:focus-visible`
- `.ce-ruler`, `.ce-ruler span`, `.ce-ruler span:first-child`, `.ce-ruler span:last-child:not(:first-child)`
- `.ce-pins`, `.ce-pins button` (×2), `.ce-pin`
- `.ce-strip`, `.ce-strip>div`, `.ce-strip b`, `.ce-strip small` (plus `@media(max-width:900px) .ce-strip small`), `.ce-strip .active`, `.ce-strip .active small`
- `.ce-playhead`, `.ce-playhead:before`
- `.ce-composer`, `.ce-anchor`, `.ce-chip-time` (×2), `.ce-chip-scene` (×2), `.ce-add`, `.ce-add:disabled`, `.ce-composer textarea`, `.ce-composer textarea:focus`
- `.ce-examples`, `.ce-examples button`, `.ce-examples button:hover`
- `.ce-error`, `.ce-empty`
- `.ce-comment .ce-pin`, `.ce-when`, `.ce-remove`, `.ce-remove:hover`, `.ce-remove:disabled`
- `.ce-download.ce-editor:disabled`
- `.ce-stale`, `.ce-stale .ce-download`

### Remaining `ce-*` Class Names in `frontend/` and Why They Must Stay
1. **`frontend/components/plate-preview.tsx` (`PlateFinal`, lines 788, 789, 806, 807):**
   - Uses `.ce-download`, `.ce-locked`, `.ce-approve`.
   - **Reason:** Hard rule in `TASK-3b-hyperframes.md` forbids touching `plate-preview.tsx` ("Do NOT touch `plate-preview.tsx`"), and Acceptance Criterion 4 requires the Phase 3a plates screenshot comparison (which includes `k-plate-final` and `q-plate-final-approved`, rendered by `PlateFinal`) to pass with 0 differing pixels.
2. **`frontend/components/studio.tsx` (`FinalRenderStep`, lines 1231–1482):**
   - Uses `.ce-heading`, `.ce-actions`, `.ce-download`, `.ce-locked`, `.ce-approve`, `.ce-workspace`, `.ce-left`, `.ce-player`, `.ce-stage`, `.ce-hint`, `.ce-controls`, `.ce-clock`, `.ce-scrubber`, `.ce-scrubber-fill`, `.ce-scrubber-thumb`, `.ce-volume`, `.ce-icon-btn`, `.ce-badge-ratio`, `.ce-aside`, `.ce-comments`, `.ce-list`, `.ce-comment`, `.ce-apply`.
   - **Reason:** `FinalRenderStep` is Step 4 (`REVIEW`, final MP4 review screen), not Step 3 (`BrowserAnimationStep`), and hard rules in `TASK-3b-hyperframes.md` state: `frontend/components/studio.tsx (only the move and import, plus deleting code that is now unused)` and `No behaviour changes beyond the two wired controls`.

---

## 6. Behaviour Test Results

### Unit Tests (`frontend/test/hf-step-logic.mjs`)
- `✔ sceneSpansFromBeatTimes builds scene spans from composition beatTimes and falls back to equal slices (0.86ms)`
- `✔ groupCommentsByScene anchors, sorts, and merges timed comments per scene for onApplySceneComments (0.19ms)`
- `✔ hfAvailableAudioTracks and hfOptionsConfig expose only existing voice/music tracks and hide unsupported controls (0.17ms)`
- `✔ audioTogglesFromMode, audioModeFromToggles, and toggleAudioTrackMode map cleanly between UI chips and audio modes (0.54ms)`

### Headless-Chrome Interaction Test (`frontend/test/hf-step-interaction.mjs`)
- `✔ BrowserAnimationStep headless Chrome interaction: play, pause, scene seek, comments add/remove/apply, subtitle & audio patches with player reload, and token modal (7409.84ms)`
  - Verified Play (`aria-label="Play"` → `"Pause"`) and Pause (`"Pause"` → `"Play"`).
  - Verified clicking Scene 3 tab (`.aw-segments li:nth-child(3)`) seeks to `0:10`, activates Scene 3 tab (`.on`), and updates label to `Scene 3 · Voice and music`.
  - Verified adding a timed comment creates a `.aw-comments li` entry and a `.aw-pin` marker on `.aw-track`, and clicking `Remove comment` (`button.aw-x`) removes both.
  - Verified adding comments on Scene 1 and Scene 3 and clicking `Redraw scenes 1, 3` invokes `onApplySceneComments` with `[{ line: 0, text: "Make the launch title bolder" }, { line: 2, text: "Highlight the ducked music waveform" }]` and reloads the composition.
  - Verified opening `Subtitle Mode` dropdown and selecting `Off` sends `PATCH /v1/projects/:id/plan` with `{ captions: "none" }`, hides unsupported controls (`style`, `size`, `colors`, `opacity`, `position`), and reloads the composition HTML (`v` incremented).
  - Verified switching to `Audio` tab shows only `Voice` and `Music` chips (no `SFX` or `Transitions`), and clicking `Voice` sends `PATCH /v1/projects/:id/plan` with `{ audioMode: "music" }`, updates `aria-pressed="false"`, and reloads the composition HTML.
  - Verified clicking `Render 12 tokens` when balance is `5` opens `TokenModal` showing `12 tokens` cost and `7 more` needed.

### Backend Route & Composition Test (`backend/test/plan-captions-audio-patch.mjs`)
- `plan-captions-audio-patch: ok`
  - Verified `PATCH /v1/projects/:id/plan` with `{ captions: "full" }` and `{ captions: "none" }` persists in Postgres, leaves all other `beatPlan` fields untouched, and changes the rendered composition HTML (`> 0` `.cap` elements in `#captions` for `"full"` when a line exists; `0` `.cap` elements for `"none"`).
  - Verified `PATCH /v1/projects/:id/plan` with `{ audioMode: "music" }` persists on `brief.audio.mode`, leaves `beatPlan` untouched, and removes all `<audio id="vo-...">` tracks from the composition HTML while keeping `<audio id="music-bed">`.
  - Verified invalid `captions` and `audioMode` values are rejected with `422` (`{ error: { code: "plan_problems", message: ... }, problems: [...] }`) without mutating the database row.

---

## 7. Full-Suite Results Before and After

| Suite / Check | Before (Baseline) | After (Phase 3b) |
| --- | --- | --- |
| `frontend`: `npm run typecheck` (`tsc --noEmit`) | Pass (0 errors) | Pass (0 errors) |
| `frontend`: `npm test` (`node --test "test/*.mjs"`) | **151 pass**, 0 fail | **156 pass**, 0 fail (+5 tests in `hf-step-logic.mjs` & `hf-step-interaction.mjs`) |
| `backend`: `npm run typecheck` (`tsc --noEmit -p .`) | Pass (0 errors) | Pass (0 errors) |
| `backend`: `test/*.mjs` suite | **32 pass**, 5 fail (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`) | **33 pass**, 5 fail (+1 pass `plan-captions-audio-patch`; same 5 pre-existing failures) |
| Phase 3a plates comparison (`tools/phase3/compare.mjs` vs `tools/phase3/baseline`) | **68/68 PASS** (0 differing px) | **68/68 PASS** (0 differing px) |

---

## 8. Decisions Where the Brief Was Silent, Deviations, Risks, and Open Questions

1. **Preserving player mounted state and playhead time across plan patches (avoiding reload flicker):**
   - When a user changes the subtitle mode or toggles Voice/Music, `BrowserAnimationStep` sends `PATCH /v1/projects/:id/plan` and increments `localVersion` (`effectiveVersion = animVersion + localVersion`).
   - Rather than clearing `previewHtml` to `null` while the updated HTML is fetched (which would unmount `<hyperframes-player>` and flash the `"Loading browser animation…"` spinner), `BrowserAnimationStep` keeps the current `<hyperframes-player>` mounted until the new HTML string arrives, then updates `srcdoc` and restores `player.currentTime = currentTimeRef.current` in the `ready` handler so the viewer stays at the same timestamp.
2. **Audio toggle visibility when a track does not exist:**
   - `hfAvailableAudioTracks(project, compAudio)` checks whether voiceover takes exist (`(project.planAudio?.voice?.lines?.length ?? 0) > 0 || (compAudio?.voice?.ready ?? 0) > 0`) and whether a music bed exists (`Boolean(project.planAudio?.music?.file || compAudio?.music?.ready)`).
   - If voice or music was never generated, that toggle is omitted from `optionsConfig.audioTracks` (never shown disabled, and never triggering generation). If neither was generated, `optionsConfig.audioTracks` is `[]` and `OptionsBar` hides the `Audio` tab completely.
3. **Contradiction noted — `.ce-*` selectors still referenced outside Step 3 (`PlateFinal` and `FinalRenderStep`):**
   - While all `.ce-*` classes were removed from `BrowserAnimationStep` (Step 3) and 54 unused `.ce-*` selectors were stripped from `frontend/app/styles.css`, `PlateFinal` in `frontend/components/plate-preview.tsx` (which we are forbidden to touch and which is tested by the 3a screenshot comparison in states `k-plate-final` and `q-plate-final-approved`) and `FinalRenderStep` in `frontend/components/studio.tsx` (Step 4 MP4 review) still reference `.ce-download`, `.ce-approve`, `.ce-locked`, and the Step 4 review classes. Keeping those live selectors in `styles.css` (and documenting them in Section 5 per Acceptance Criterion 2) preserved 68/68 0-pixel parity on the 3a plates suite and avoided breaking Step 4.
4. **Open questions for Phase 3d:**
   - When Phase 3d wires subtitle style (`pill`, `cinema`, `kinetic`, `paper`, `blueprint`), size, colors, opacity, position, and the SFX switch into the beat-plan engine, `hfOptionsConfig` can simply enable those flags in `WorkspaceOptionsConfig` with no structural changes to `AnimationWorkspace`.
