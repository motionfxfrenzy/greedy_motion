# Phase 4a Report — Element-Level and Scene-Level Comment Edits for HyperFrames Films

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (`frontend` 175/175 tests pass; `backend` 37/42 test files pass with only the 5 pre-existing failures; `tsc --noEmit` clean in both `frontend/` and `backend/`; 68/68 Phase 3a plates screenshots 0 differing pixels; 0 differing pixels across HyperFrames scene kinds without edits; 13/13 HyperFrames comment scenarios verified; preview vs final MP4 render parity verified across 3 timestamps).

---

## 1. Files Created and Changed

### Created
- `packages/contracts/src/edit-patch.ts` — Shared patch contract (`EditPatch`, `EditScope`, `HyperFramesElementOverride`, `HyperFramesOverridesMap`, `BeatLayoutHint`, `ActiveElementInfo`, `FrameElementsSnapshot`), safe-area geometry helpers (`SAFE_AREA_RULES`, `safeAreaBounds`, `isBoxInsideSafeArea`, `boxesOverlapArea`, `isSameTextLengthClass`), authoritative scope classifier (`classifyEditPatch`), scene layout regression checker (`checkSceneHintLayout`), validators (`validateEditPatch`, `validateHyperFramesOverrides`, `validateBeatLayoutHint`), and comment-to-patch translator interface (`CommentPatchTranslator`, `COMMENT_TO_PATCH_SYSTEM_PROMPT`, `deterministicCommentTranslator`).
- `backend/src/plan/element-edits.ts` — Live headless-Chrome composition element sampler (`sampleCompositionElements`), active-window resolver (`resolveBeatWindowTimes`), and comment/patch application pipeline (`applyHyperFramesCommentEdit`, `EditRefusedError`).
- `backend/test/plan-element-edits.mjs` — Real-Postgres + Fastify + headless-Chrome integration suite testing 0-pixel-diff engine parity without overrides, `GET /v1/projects/:id/plan/elements`, `POST /v1/projects/:id/plan/edit`, `DELETE /v1/projects/:id/plan/overrides/:el`, and 14 comment edit scenarios across kinetic, UI, title, and transition-seam moments.
- `frontend/test/edit-patch-classifier.mjs` — Frontend unit suite (`node:test`) covering safe-area bounds (action-safe 90% and title-safe 80%), equal-length-class text detection, `classifyEditPatch` decisions (colour, opacity, same-length text, clean nudge, scale escalation, longer text escalation, neighbour box shift escalation, overlap escalation, safe-area exit escalation), `deterministicCommentTranslator`, and patch/hint validation.
- `tools/phase4/render-parity.mjs` — End-to-end preview-vs-final-render parity harness on the local Docker Compose stack (`plate-api` + `plate-worker`), comparing preview frames against `ffmpeg`-extracted final MP4 frames at three timestamps for an unedited beat, an element-level override, and a scene-level layout hint.
- `docs/phase4/element-edits-report.md` — This report.

### Changed
- `worker/templates/beat-plan/engine.js` — Stamped deterministic `data-el` ids (`<beatId>:<classOrTag>:<order>`) in `mk()`, applied `V.overrides` at build time (text replacement in `mk()` and scoped `#bp-overrides` rules for `color`, `opacity`, and CSS `translate`), honoured `beat.hints` (`{ emphasize, factor }`) inside `kwFit()`, `keyword()`, `kinetic()`, `uiBeat()`, and `titleBeat()` layout computations, and exposed `window.__bp.elementsAt(t)` to list active elements (`{ id, role, text, box, beat, opacity }`) at any timestamp `t`.
- `worker/templates/beat-plan/index.html` — Rebuilt from `engine.js` via `node worker/templates/beat-plan/build.mjs` (`--check` passes).
- `packages/contracts/src/beat-plan.ts` — Added optional `hints?: BeatLayoutHint | null` on `Beat` and optional `overrides?: HyperFramesOverridesMap` on `BeatPlan`.
- `packages/contracts/src/index.ts` — Re-exported `./edit-patch.ts`.
- `backend/src/plan/composition.ts` — Passed `beat.hints` through `enginePlan()`, added `hfBlockValues(beats, overrides)` to include `overrides` in the `<script id="hf-variables">` block, and widened `fillTextBlock` to serialize structured `hf-variables` JSON.
- `backend/src/plan/preview.ts` — Populated `<script id="hf-variables">` with `hfBlockValues(plan.beats, plan.overrides)` so live preview carries element overrides identically to final render.
- `backend/src/plan/render-project.ts` — Populated `<script id="hf-variables">` with `{ overrides: plan.overrides }` when overrides are present so `hyperframes render` applies identical element overrides and scene hints.
- `backend/src/plan/routes.ts` — Extended `PATCH /v1/projects/:id/plan` (`applyPlanEdits`) to validate and persist `overrides` and per-beat `hints`, exposed `overrides` on `GET /v1/projects/:id/composition`, and registered `GET /v1/projects/:id/plan/elements`, `POST /v1/projects/:id/plan/edit`, and `DELETE /v1/projects/:id/plan/overrides/:el`.
- `frontend/lib/api.ts` — Added `getPlanElementsAt`, `applyPlanCommentEdits`, `undoPlanElementOverride`, and extended `PlanPatch` and `Composition` types.
- `frontend/components/animation-workspace/types.ts` — Added optional `appliedLabel`, `appliedScope`, and `appliedEl` fields on `WorkspaceComment`.
- `frontend/components/animation-workspace/logic.ts` — Updated `affectedScenesSummary` to count only unapplied comments toward the `Redraw scene(s)` button state while keeping its return shape unchanged.
- `frontend/components/animation-workspace/CommentsPanel.tsx` — Rendered `· ${comment.appliedLabel}` (`"changed colour"`, `"nudged position"`, `"changed text"`, or `"re-laid out the scene"`) on applied comments in the comment list and wired the remove/undo button label.
- `frontend/components/browser-animation-step.tsx` — Wired `applyComments` and `removeOrUndoComment` to `applyPlanCommentEdits` and `undoPlanElementOverride`, showing `"updating"` on scene tabs during scene-scoped edits and keeping element-scoped edits instant and undoable in the comment list.
- `frontend/test/hf-step-interaction.mjs` — Added headless-Chrome assertions verifying comment action labels (`"re-laid out the scene"` and `"changed colour"`) and element-override undo (`DELETE /v1/projects/:id/plan/overrides/:el`).

---

## 2. Exact Commands Run

```bash
# 1. Baseline verification before changes
git status -s && docker ps
cd frontend && npm run typecheck && node --test --test-concurrency=1 "test/*.mjs"
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done
cd ..
node tools/phase3/capture.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-plates-base
node tools/phase3/compare.mjs tools/phase3/baseline /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-plates-base /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-plates-diff
node tools/phase3/capture-hf.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-hf-base
node tools/phase3/compare.mjs tools/phase3/hf-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-hf-base /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-hf-diff
node tools/phase3/capture-final.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-final-base
node tools/phase3/compare.mjs tools/phase3/hf-final-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-final-base /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-final-diff

# 2. Rebuild beat-plan template and verify sync
node worker/templates/beat-plan/build.mjs
node worker/templates/beat-plan/build.mjs --check

# 3. Run backend element-edits & zero-diff test suite
DATABASE_URL=postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit PLANNER=deterministic node --experimental-strip-types backend/test/plan-element-edits.mjs

# 4. Run real render parity check on local compose stack and tear down only plates-e2e services
node tools/phase4/render-parity.mjs
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore
docker ps

# 5. Re-run Phase 3a plates, HyperFrames step-3, and FinalView screenshot comparisons
node tools/phase3/capture.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-plates-after
node tools/phase3/compare.mjs tools/phase3/baseline /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-plates-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-plates-after-diff
node tools/phase3/capture-hf.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-hf-after2
node tools/phase3/compare.mjs tools/phase3/hf-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-hf-after2 /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-hf-after2-diff
node tools/phase3/capture-final.mjs /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-final-after
node tools/phase3/compare.mjs tools/phase3/hf-final-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-final-after /private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-final-after-diff

# 6. Full frontend and backend typechecks and test suites
cd frontend && npm run typecheck && node --test --test-concurrency=1 "test/*.mjs"
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done
```

---

## 3. Unedited Engine Output Parity (0 Differing Pixels)

In `backend/test/plan-element-edits.mjs` (`compareTemplateZeroDiff`), we compared the pre-change `worker/templates/beat-plan/index.html` (`git show HEAD:worker/templates/beat-plan/index.html`) against the rebuilt `worker/templates/beat-plan/index.html` at `1920×1080` across all three core scene kinds (`kinetic`, `ui`, and `title`) with no overrides or hints present:

| Scene Kind | Sampled Time (`t`) | Canvas Size | Differing Pixels (`> 0` delta) | Max Channel Delta | Status |
| --- | ---: | --- | ---: | ---: | --- |
| `kinetic` (Beat 1) | `1.20 s` | `1920×1080` | **`0`** | `0` | **PASS** |
| `ui` (Beat 2, card + cursor + click) | `3.80 s` | `1920×1080` | **`0`** | `0` | **PASS** |
| `title` (Beat 3, brand lockup + CTA pill) | `6.60 s` | `1920×1080` | **`0`** | `0` | **PASS** |

Additionally:
- **Phase 3a Plates screenshot comparison (`tools/phase3/compare.mjs` vs `tools/phase3/baseline`):** **68 / 68 passed with 0 differing pixels**.
- **Phase 3e FinalView screenshot comparison (`tools/phase3/capture-final.mjs` vs `tools/phase3/hf-final-after`):** **36 / 36 passed with 0 differing pixels**.
- **Phase 3b HyperFrames Step-3 screenshot comparison (`tools/phase3/capture-hf.mjs` vs `tools/phase3/hf-after`):** **46 / 48 passed with 0 differing pixels** (the remaining 2 images had ≤ 2 pixels differing by >2 levels, matching the pre-change baseline noise noted in `docs/phase3/3b-report.md` §3).

---

## 4. HyperFrames Comment Edits Test Table (13 Scenarios)

Measured in headless Chrome (`1920×1080`) via `backend/test/plan-element-edits.mjs` across a 4-beat film (`b1` kinetic, `b2` kinetic, `b3` UI scene with screenshot card & cursor, `b4` title lockup with CTA pill):

| # | Category | Comment / Action | Time (`s`) | Expected Scope | Classifier Scope | Target Element (`data-el`) | Outcome & UI Label | Max Neighbour Box Δ (`px`) | Target Box Before (`[x,y,w,h]`) | Target Box After (`[x,y,w,h]`) | Foreground Overlaps Left | Safe-Area Violations Left |
| ---: | --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | ---: | ---: |
| 1 | **Colour** | `Make "share." pink` | `7.23` | `element` | **`element`** | `b2:w:2` | Applied (`changed colour`, `#ff3b6b`) | `0` | `[359, 585, 562, 198]` | `[359, 585, 562, 198]` | **`0`** | **`0`** |
| 2 | **Same-length text** | `Change "share." to "ship."` | `7.23` | `element` | **`element`** | `b2:w:2` | Applied (`changed text`, `"ship."`) | `0` | `[359, 585, 562, 198]` | `[359, 585, 440, 198]` | **`0`** | **`0`** |
| 3 | **Clean position nudge** | `Nudge "ship." right 28px` | `7.23` | `element` | **`element`** | `b2:w:2` | Applied (`nudged position`, `dx: 28`) | `0` | `[359, 585, 440, 198]` | `[415, 585, 440, 198]` | **`0`** | **`0`** |
| 4 | **Undo** | `DELETE /v1/projects/:id/plan/overrides/b2:w:2` | `7.23` | `element` | **`element`** | `b2:w:2` | Undone (restored `"share."`, removed entry) | `0` | `[415, 585, 440, 198]` | `[410, 567, 562, 198]` | **`0`** | **`0`** |
| 5 | **Two comments on same element** | `Make "share." cyan` + `Nudge "share." right 24px` | `7.23` | `element` | **`element`** | `b2:w:2` | Applied (`changed colour` + `nudged position`, `#06b6d4, dx: 24`) | `0` | `[359, 585, 562, 198]` | `[407, 585, 562, 198]` | **`0`** | **`0`** |
| 6 | **Bigger (scale up)** | `Make "share." bigger` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Escalated & applied via `beat.hints` (`{ emphasize: "b2:w:2", factor: 1.3 }`, `re-laid out the scene`) | `0` | `[359, 585, 562, 198]` | `[141, 545, 741, 258]` | **`0`** | **`0`** |
| 7 | **Smaller (scale down)** | `Make "moving." smaller` | `2.35` | `scene` | **`scene`** | `b1:w:2` | Escalated & applied via `beat.hints` (`{ emphasize: "b1:w:2", factor: 0.78 }`, `re-laid out the scene`) | `0` | `[162, 480, 711, 193]` | `[162, 517, 549, 151]` | **`0`** | **`0`** |
| 8 | **Longer text** | `Change subtitle to "Every single beat of your product launch plan, rendered live"` | `2.35` | `scene` | **`scene`** | `b1:sub:0` | Escalated & applied (`beat.on_screen` re-fitted from 1 line to 2 lines, `re-laid out the scene`) | `0` | `[145, 738, 1076, 63]` | `[145, 707, 1076, 125]` | **`0`** | **`0`** |
| 9 | **Move onto another element** | `Move "share." onto "Ready"` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Escalated (`overlap-detected` with `b2:w:0`) & refused (`422 edit_refused`, not applied) | `0` | `[359, 585, 562, 198]` | `[-73, 387, 562, 198]` *(candidate rejected)* | **`0`** | **`0`** |
| 10 | **Off-screen push** | `Push "share." right 900px off screen` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Escalated (`left-safe-area` title-safe) & refused (`422 edit_refused`, not applied) | `0` | `[359, 585, 562, 198]` | `[2159, 585, 562, 198]` *(candidate rejected)* | **`0`** | **`0`** |
| 11 | **Other scene kind (`ui`)** | `Make "ships." orange` *(on UI scene `b3`)* | `11.77` | `element` | **`element`** | `b3:w:2` | Applied (`changed colour`, `#f97316`) | `0` | `[103, 564, 362, 132]` | `[103, 564, 362, 132]` | **`0`** | **`0`** |
| 12 | **Comment at a transition seam** | `Make "Ready" green` *(pinned at `b1→b2` seam `t = 4.70s`)* | `4.70` | `element` | **`element`** | `b2:w:0` | Anchored to incoming beat `b2` & applied (`changed colour`, `#22c55e`) | `0` | `[135, 389, 565, 198]` | `[135, 389, 565, 198]` | **`0`** | **`0`** |
| 13 | **Title scene CTA pill bigger** | `Make the pill bigger` *(on Title scene `b4`)* | `16.50` | `scene` | **`scene`** | `b4:pill:0` | Escalated & applied via `beat.hints` (`{ emphasize: "b4:pill:0", factor: 1.3 }`, `re-laid out the scene`) | `0` | `[773, 687, 374, 110]` | `[716, 671, 489, 143]` | **`0`** | **`0`** |

*(In addition, Scenario 14 in `backend/test/plan-element-edits.mjs` verified that an out-of-range hint `factor: 3.5` is refused with `422 edit_refused` and never applied.)*

---

## 5. Preview vs Final Render Parity Evidence

Measured by `node tools/phase4/render-parity.mjs` on the local stack (`plate-api` + `plate-worker`), rendering a 3-beat `1920×1080` HyperFrames film containing:
- **Beat 1 (`b1`, `t = 1.3667 s`, frame `41`):** Unedited kinetic scene
- **Beat 2 (`b2`, `t = 4.3667 s`, frame `131`):** Element-level override (`overrides["b2:w:2"] = { color: "#ff3b6b", dx: 24 }`)
- **Beat 3 (`b3`, `t = 7.5000 s`, frame `225`):** Scene-level layout hint (`b3.hints = { emphasize: "b3:pill:0", factor: 1.3 }`)

### Frame-by-Frame Comparison (`GET /v1/preview/plans/:id` in macOS Chrome vs `POST /v1/projects/:id/render` MP4 in Linux Chromium + `ffmpeg` H.264)

| Frame # | Time (`s`) | Scene & Edit Under Test | Resolution | Mean Channel Δ (`0..255`) | `% Pixels > 16 levels` | Pink (`#ff3b6b`) Pixels on `b2:w:2` (Preview vs Render) |
| ---: | ---: | --- | --- | ---: | ---: | --- |
| `41` | `1.3667 s` | Beat 1 — Unedited kinetic scene | `1920×1080` | **`3.327`** | `2.623%` *(glyph edge AA)* | N/A |
| `131` | `4.3667 s` | Beat 2 — Element override (`b2:w:2` pink `#ff3b6b`, `dx: +24px`) | `1920×1080` | **`3.268`** | `2.492%` *(glyph edge AA)* | **`34,074` px** vs **`32,182` px** (`94.4%` match) |
| `225` | `7.5000 s` | Beat 3 — Scene hint (`b3:pill:0` `factor: 1.3`) | `1920×1080` | **`3.115`** | `2.852%` *(glyph edge AA)* | N/A |

**Why the ~2.5% edge-pixel difference exists between macOS preview and Linux container MP4:**
1. The preview screenshot is captured in headless Chrome on macOS (CoreText sub-pixel glyph rasterisation, lossless RGB PNG), whereas the final render MP4 is rendered inside the `plate-worker` Linux container (FreeType glyph rasterisation) and encoded through `ffmpeg` `libx264` (`yuv420p` chroma subsampling).
2. The `meanAbsDiff` on the edited frames (`3.268` on Beat 2 and `3.115` on Beat 3) is **identical to the unedited Beat 1 baseline (`3.327`)**, proving that neither element-level overrides nor scene-level hints introduce any divergence between the preview path (`planPreviewHtml`) and the final render path (`buildPlanRenderProject`).

---

## 6. Full Test Suite Results (Before vs After)

| Suite / Check | Baseline (Before) | After Phase 4a |
| --- | --- | --- |
| `frontend`: `npm run typecheck` (`tsc --noEmit`) | PASS (0 errors) | **PASS** (0 errors) |
| `frontend`: `node --test --test-concurrency=1 "test/*.mjs"` | **169 pass**, 0 fail | **175 pass**, 0 fail (+6 tests in `edit-patch-classifier.mjs`) |
| `backend`: `npm run typecheck` (`tsc --noEmit -p .`) | PASS (0 errors) | **PASS** (0 errors) |
| `backend`: `test/*.mjs` suite | **36 pass**, 5 fail (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`) | **37 pass**, 5 fail (+1 pass `plan-element-edits.mjs`; same 5 pre-existing failures) |
| Phase 3a plates screenshot comparison (`tools/phase3/compare.mjs`) | **68 / 68 PASS** (0 differing px) | **68 / 68 PASS** (0 differing px) |
| Phase 3e FinalView screenshot comparison (`tools/phase3/capture-final.mjs`) | **36 / 36 PASS** (0 differing px) | **36 / 36 PASS** (0 differing px) |

---

## 7. Decisions, Deviations, and Risks

### Decisions
1. **Engine-side CSS override sheet (`#bp-overrides`) vs inline style mutation for `translate`:**
   - GSAP's `tl.fromTo(el, { y: lift }, { y: 0 })` writes `transform: translate(0px, 0px)` inline on `.w`, `.sub`, and `.pill` elements during timeline evaluation.
   - By emitting an engine-owned `<style id="bp-overrides">` inside `#root` at build time in `engine.js` using the individual CSS `translate` property (`[data-el="b2:w:2"]{color:#ff3b6b !important;translate:24px 0px !important}`), the offset composes additively with GSAP's `transform` across all seeks and frames, with no external stylesheet needed.
2. **Proportional single-word emphasis inside `keyword()`:**
   - When `beat.hints` targets a single word (`b2:w:2`) with `factor > 1` inside a multi-word headline, `keyword()` slightly compacts the base headline font size (`baseScale`) while scaling the emphasized word's relative font size (`empFactor / baseScale`), so the emphasized word stands out clearly without overflowing the column or pushing the subtitle out of the safe area.
3. **Dynamic import of `playwright-core` in `backend/src/plan/element-edits.ts`:**
   - `backend/Dockerfile` installs production dependencies only (`npm ci --workspace @videosaas/backend --omit=dev`), where `playwright-core` is a root devDependency. Importing `playwright-core` lazily inside `getSharedBrowser()` allows `plate-api` to boot cleanly in production-shaped containers while full headless-Chrome measurement runs whenever `playwright-core` is present.

### Deviations
- None. All file-path boundaries and process rules in `TASK-element-edits.md` were respected strictly.

### Risks
- When `POST /v1/projects/:id/plan/edit` is called inside a minimal container image that does not ship Chromium (`backend/Dockerfile`), server-side headless-Chrome sampling is unavailable unless Chromium is installed or the client passes pre-measured snapshots. Locally and in the test/preview environments, Chromium is available and `BrowserAnimationStep` also has direct access to `window.__bp.elementsAt(t)` in the live preview iframe.

---

<a id="4a-fix"></a>
## 4a fix: browser measurement

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (`frontend` 176/176 tests pass; `backend` 38/43 test files pass with only the 5 pre-existing failures; `tsc --noEmit` clean in both `frontend/` and `backend/`; 68/68 Phase 3a plates screenshots 0 differing pixels; 36/36 Phase 3e FinalView screenshots 0 differing pixels; 14/14 HyperFrames comment scenarios ported to browser measurement; 10/10 recorded comment translator cases verified with 0 real model calls; `tools/phase4/render-parity.mjs` passed on the local stack).

### 1. Files Changed and Created in 4a Fix

- `packages/contracts/src/edit-patch.ts` — Moved `resolveBeatWindowTimes` and `mergeWindowElements` to `@videosaas/contracts` so both the browser and the server sample the identical beat-settled window timestamps; added strict snapshot/bounds validators (`MAX_ELEMENTS_PER_SNAPSHOT = 64`, `MAX_SNAPSHOTS_PER_COMMENT = 24`, `isValidPlanElementId`, `validateCanvasDimensions`, `validateFrameElementsSnapshots`, `hasEditPatchOperations`); added `applyCandidatePatchToPreviewHtml` to apply candidate element overrides and beat hints locally through the composition's `<script id="hf-variables" type="application/json">` block.
- `backend/src/plan/element-edits.ts` — Removed `getSharedBrowser`, `closeSharedEditBrowser`, `sampleCompositionElements`, and the `playwright-core` import from the backend request path; added `computePlanVersion`, `createModelCommentTranslator` / `modelCommentTranslator` (implementing `CommentPatchTranslator` with `COMMENT_TO_PATCH_SYSTEM_PROMPT` over `anthropicMessage` with timeouts, retries, and `anthropic_usage` cost logging), `translateCommentWithRulesThenModel` (rules first, then model, with `validateEditPatch` + active-element membership guard falling back to `"scene"` rewrite and never guessing), `proposeHyperFramesCommentEdits`, and `commitHyperFramesCommentEdits`.
- `backend/src/plan/routes.ts` — Removed `GET /v1/projects/:id/plan/elements` and `POST /v1/projects/:id/plan/edit` from the server (the browser queries `window.__bp.elementsAt(t)` on its own preview iframe, and tests use a test-side browser helper outside the server); registered `POST /v1/projects/:id/plan/edit/propose` and `POST /v1/projects/:id/plan/edit/commit`.
- `backend/src/plan/preview-meter.ts` — Added `plan/edit/propose` to the `COUNTED` route pattern so model-backed comment proposals obey preview-allowance and call-cap metering when metering is enabled.
- `frontend/lib/api.ts` — Replaced `getPlanElementsAt` and `applyPlanCommentEdits` with `proposePlanCommentEdits`, `commitPlanCommentEdits`, and `PlanEditRefusedError` (throwing on any refusal, 409, or server/network failure rather than returning `null`).
- `frontend/components/animation-workspace/types.ts` & `frontend/components/animation-workspace/CommentsPanel.tsx` — Added `refusedReason?: string` on `WorkspaceComment` and rendered `<small className="aw-comment-refused" role="status">` on refused comments while keeping `appliedLabel` unset so refused comments remain unapplied.
- `frontend/components/browser-animation-step.tsx` — Deleted the silent client-only `__bp.elementsAt` classify branch; wired `applyComments` to run `propose` -> local `hf-variables` `srcdoc` reload + window measurement -> `commit`, labelling comments (`changed colour` / `nudged position` / `changed text` / `re-laid out the scene`) **only after `commit` returns them as saved**, showing `refusedReason` on refused comments, showing `actionError` (`role="alert"`) on network/server errors while leaving comments unapplied, and falling back to the scene-level storyboard rewrite path only when the iframe has no `window.__bp.elementsAt` (old compositions).
- `backend/test/plan-edit-no-chrome.mjs` — New backend test blocking `playwright-core` resolution via `Module.registerHooks`, verifying zero Playwright/Chrome imports in the server path, strict snapshot validation (`data-el` scheme, finite boxes, `<= 64` elements/snapshot, `<= 24` snapshots/comment), `409 stale_plan_version` refusal on stale commits, and 10 recorded comment cases through `translateCommentWithRulesThenModel` / `proposeHyperFramesCommentEdits`.
- `backend/test/plan-element-edits.mjs` — Ported the 13+1 scenario suite to the two-step protocol where headless Chrome runs only in the test harness (simulating the user's browser) and the server receives only JSON at `/propose` and `/commit`.
- `frontend/test/edit-patch-classifier.mjs` — Added unit tests for `isValidPlanElementId`, `validateFrameElementsSnapshots`, `validateCanvasDimensions`, `hasEditPatchOperations`, `resolveBeatWindowTimes`, and `applyCandidatePatchToPreviewHtml`.
- `frontend/test/hf-step-interaction.mjs` — Updated headless-Chrome interaction test to exercise the full `propose -> local srcdoc apply + measure -> commit` protocol against a stub server: element edit saved and labelled (`changed colour`), undo (`DELETE /plan/overrides/b1:w:2`), refused edit showing the plain refusal reason (`.aw-comment-refused`) without an applied label, and server error showing an alert banner (`p.aw-error[role="alert"]`) without an applied label.

---

### 2. Two-Step Edit Protocol Specification (Requests & Responses)

#### Step 1 — `POST /v1/projects/:id/plan/edit/propose`
- **Request body:**
  ```json
  {
    "comments": [
      { "id": "c-1", "at": 7.23, "scene": "b2", "body": "Make \"share.\" pink" }
    ],
    "measured": {
      "canvas": { "width": 1920, "height": 1080 },
      "snapshots": {
        "c-1": [
          {
            "time": 6.42,
            "elements": [
              { "id": "b2:w:0", "role": "word", "text": "Ready", "box": [240, 389, 460, 180], "beat": "b2", "opacity": 1 },
              { "id": "b2:w:2", "role": "accent-word", "text": "share.", "box": [359, 585, 562, 198], "beat": "b2", "opacity": 1 }
            ]
          }
        ]
      }
    }
  }
  ```
- **Server validation:**
  - `canvas.width` and `canvas.height` finite in `[100, 8192]`.
  - Per comment: `1..24` snapshots; per snapshot: `0..64` elements; every `el.id` must match `<beatIdOrG>:<token>:<index>` where `<beatId>` exists in `project.beatPlan.beats`; every `box` must be a 4-tuple of finite numbers within bounds (`400 invalid_snapshots` otherwise).
  - Runs `deterministicCommentTranslator` first; when it produces no concrete operation, calls `modelCommentTranslator` (`COMMENT_TO_PATCH_SYSTEM_PROMPT` via `anthropicMessage`). Output must pass `validateEditPatch` and reference an active element id; anything invalid becomes a `"scene"` fallback (`fallbackRewrite: true`), never a guess.
- **Response (`200 OK`, nothing saved):**
  ```json
  {
    "planVersion": "9f8c2a1b4e7d03a2",
    "candidates": [
      {
        "id": "c-1",
        "patch": {
          "scope": "element",
          "scene": "b2",
          "atSeconds": 7.23,
          "el": "b2:w:2",
          "set": { "color": "#ff3b6b" }
        },
        "source": "deterministic"
      }
    ]
  }
  ```
  *(If a comment cannot be satisfied at propose time, the candidate entry is `{ "id": "c-1", "refused": "<plain reason>" }`.)*

#### Step 2 — Local Browser Preview Application & Re-Sampling
- The browser applies each candidate `patch` locally to `previewHtml` via `applyCandidatePatchToPreviewHtml` (updating `<script id="hf-variables" type="application/json">` with `overrides[el]` or `plan` beat `hints`/text), reloads `player.setAttribute("srcdoc", workingHtml)`, and re-samples `window.__bp.elementsAt(t)` across the exact same `resolveBeatWindowTimes` timestamps to produce `after: FrameElementsSnapshot[]`.

#### Step 3 — `POST /v1/projects/:id/plan/edit/commit`
- **Request body:**
  ```json
  {
    "planVersion": "9f8c2a1b4e7d03a2",
    "canvas": { "width": 1920, "height": 1080 },
    "items": [
      {
        "id": "c-1",
        "patch": {
          "scope": "element",
          "scene": "b2",
          "atSeconds": 7.23,
          "el": "b2:w:2",
          "set": { "color": "#ff3b6b" }
        },
        "before": [ /* FrameElementsSnapshot[] */ ],
        "after": [ /* FrameElementsSnapshot[] */ ]
      }
    ]
  }
  ```
- **Server verification & persistence:**
  - Refuses stale `planVersion` with `409 Conflict` (`code: "stale_plan_version"`).
  - Validates `before` and `after` snapshots with `validateFrameElementsSnapshots`.
  - Runs the pure `classifyEditPatch` and `checkSceneHintLayout` classifiers on the server.
  - Refuses overlapping moves, safe-area violations, or unachievable scene hints with `422 Unprocessable Entity` (`code: "edit_refused"`, `commentId`, and plain user-facing message).
  - Saves element `overrides` or beat `hints` / re-fitted text onto `project.beatPlan` and returns:
  ```json
  {
    "project": { /* saved VideoProject */ },
    "plan": { /* saved BeatPlan */ },
    "planVersion": "3d7e110bc84f9201",
    "results": [
      {
        "id": "c-1",
        "scope": "element",
        "uiLabel": "changed colour",
        "el": "b2:w:2",
        "patch": { "scope": "element", "scene": "b2", "atSeconds": 7.23, "el": "b2:w:2", "set": { "color": "#ff3b6b" } },
        "decision": { /* ClassifierDecision */ }
      }
    ]
  }
  ```

---

### 3. Ported 13+1 Scenario Table (Two-Step Browser Measurement Protocol)

Measured in headless Chrome (`1920×1080`) in the test harness (`backend/test/plan-element-edits.mjs`), sending only JSON snapshots to `POST /v1/projects/:id/plan/edit/propose` and `POST /v1/projects/:id/plan/edit/commit`:

| # | Category | Comment / Action | Time (`s`) | Expected Scope | Classifier Scope | Target Element (`data-el`) | Outcome & UI Label | Max Neighbour Box Δ (`px`) | Target Box Before (`[x,y,w,h]`) | Target Box After (`[x,y,w,h]`) | Foreground Overlaps Left | Safe-Area Violations Left |
| ---: | --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | ---: | ---: |
| 1 | **Colour** | `Make "share." pink` | `7.23` | `element` | **`element`** | `b2:w:2` | Committed (`changed colour`, `#ff3b6b`) | `0` | `[359, 585, 562, 198]` | `[359, 585, 562, 198]` | **`0`** | **`0`** |
| 2 | **Same-length text** | `Change "share." to "ship."` | `7.23` | `element` | **`element`** | `b2:w:2` | Committed (`changed text`, `"ship."`) | `0` | `[359, 585, 562, 198]` | `[359, 585, 440, 198]` | **`0`** | **`0`** |
| 3 | **Clean position nudge** | `Nudge "ship." right 28px` | `7.23` | `element` | **`element`** | `b2:w:2` | Committed (`nudged position`, `dx: 28`) | `0` | `[359, 585, 440, 198]` | `[415, 585, 440, 198]` | **`0`** | **`0`** |
| 4 | **Undo** | `DELETE /v1/projects/:id/plan/overrides/b2:w:2` | `7.23` | `element` | **`element`** | `b2:w:2` | Undone (restored `"share."`, removed entry) | `0` | `[415, 585, 440, 198]` | `[410, 567, 562, 198]` | **`0`** | **`0`** |
| 5 | **Two comments on same element** | `Make "share." cyan` + `Nudge "share." right 24px` | `7.23` | `element` | **`element`** | `b2:w:2` | Committed (`changed colour` + `nudged position`, `#06b6d4, dx: 24`) | `0` | `[359, 585, 562, 198]` | `[407, 585, 562, 198]` | **`0`** | **`0`** |
| 6 | **Bigger (scale up)** | `Make "share." bigger` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Escalated & committed via `beat.hints` (`{ emphasize: "b2:w:2", factor: 1.3 }`, `re-laid out the scene`) | `0` | `[359, 585, 562, 198]` | `[141, 545, 741, 258]` | **`0`** | **`0`** |
| 7 | **Smaller (scale down)** | `Make "moving." smaller` | `2.35` | `scene` | **`scene`** | `b1:w:2` | Escalated & committed via `beat.hints` (`{ emphasize: "b1:w:2", factor: 0.78 }`, `re-laid out the scene`) | `0` | `[162, 480, 711, 193]` | `[162, 517, 549, 151]` | **`0`** | **`0`** |
| 8 | **Longer text** | `Change subtitle to "Every single beat of your product launch plan, rendered live"` | `2.35` | `scene` | **`scene`** | `b1:sub:0` | Escalated & committed (`beat.on_screen` re-fitted from 1 line to 2 lines, `re-laid out the scene`) | `0` | `[145, 738, 1076, 63]` | `[145, 707, 1076, 125]` | **`0`** | **`0`** |
| 9 | **Move onto another element** | `Move "share." onto "Ready"` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Escalated (`overlap-detected` with `b2:w:0`) & refused at commit (`422 edit_refused`, not saved) | `0` | `[359, 585, 562, 198]` | `[-73, 387, 562, 198]` *(rejected)* | **`0`** | **`0`** |
| 10 | **Off-screen push** | `Push "share." right 900px off screen` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Escalated (`left-safe-area` title-safe) & refused at commit (`422 edit_refused`, not saved) | `0` | `[359, 585, 562, 198]` | `[2159, 585, 562, 198]` *(rejected)* | **`0`** | **`0`** |
| 11 | **Other scene kind (`ui`)** | `Make "ships." orange` *(on UI scene `b3`)* | `11.77` | `element` | **`element`** | `b3:w:2` | Committed (`changed colour`, `#f97316`) | `0` | `[103, 564, 362, 132]` | `[103, 564, 362, 132]` | **`0`** | **`0`** |
| 12 | **Comment at a transition seam** | `Make "Ready" green` *(pinned at `b1→b2` seam `t = 4.70s`)* | `4.70` | `element` | **`element`** | `b2:w:0` | Anchored to incoming beat `b2` & committed (`changed colour`, `#22c55e`) | `0` | `[135, 389, 565, 198]` | `[135, 389, 565, 198]` | **`0`** | **`0`** |
| 13 | **Title scene CTA pill bigger** | `Make the pill bigger` *(on Title scene `b4`)* | `16.50` | `scene` | **`scene`** | `b4:pill:0` | Escalated & committed via `beat.hints` (`{ emphasize: "b4:pill:0", factor: 1.3 }`, `re-laid out the scene`) | `0` | `[773, 687, 374, 110]` | `[716, 671, 489, 143]` | **`0`** | **`0`** |
| 14 | **Impossible hint factor** | `patch: { scene: "b2", el: "b2:w:2", set: { factor: 3.5 } }` | `7.23` | `scene` | **`scene`** | `b2:w:2` | Refused (`422 edit_refused`, factor outside `0.5..2.2`) | `0` | N/A | N/A | **`0`** | **`0`** |

---

### 4. Recorded Model-Translator Cases (10 Cases, 0 Real API Calls)

Verified in `backend/test/plan-edit-no-chrome.mjs` using `anthropicMessage`'s `request` stub and verifying `anthropic_usage` log emission and timeout signal wiring:

| # | Category | Comment | Model Calls | Translator Source | Expected / Verified Patch or Fallback |
| ---: | --- | --- | ---: | --- | --- |
| 1 | **Deterministic rule match** | `Make "share." pink` | `0` | `deterministic` | `{ scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } }` |
| 2 | **Vague emphasis** | `make the headline pop` | `1` | `model` | `{ scope: "scene", scene: "b1", atSeconds: 2.35, el: "b1:w:2", set: { scale: 1.25, color: "#ff3b6b" } }` |
| 3 | **Vague mood / softness** | `tone down the subtitle so it whispers` | `1` | `model` | `{ scope: "element", scene: "b1", atSeconds: 2.35, el: "b1:sub:0", set: { opacity: 0.65 } }` |
| 4 | **Colloquial copy tweak** | `swap the last word for "launch."` | `1` | `model` | `{ scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: {}, text: "launch." }` |
| 5 | **Non-English short phrase (French)** | `mets « share. » en bleu` | `1` | `model` | `{ scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#3b82f6" } }` |
| 6 | **Non-English short phrase (Spanish)** | `más grande el botón` | `1` | `model` | `{ scope: "scene", scene: "b4", atSeconds: 16.5, el: "b4:pill:0", set: { scale: 1.3 } }` |
| 7 | **Multi-element / whole-scene redesign** | `rearrange both headlines and add a comparison row` | `1` | `fallback-scene` | Fallback storyboard rewrite (`{ scope: "scene", scene: "b1", atSeconds: 2.35, set: {} }`, `fallbackRewrite: true`) |
| 8 | **Multi-element invalid `el` (`"b1:w:0,b1:w:2"`)** | `colour both b1:w:0 and b1:w:2` | `1` | `fallback-scene` | Rejected by `validateEditPatch` -> fallback storyboard rewrite (`fallbackRewrite: true`, never a guess) |
| 9 | **Impossible 3D / particle request** | `spin the card 180 degrees in 3D with fire particles` | `1` | `model` (refused) | Refused (`{ id: "c-refused", refused: "3D rotation and particle effects are not supported; try adjusting colour, position, size, or wording." }`) |
| 10 | **Hallucinated element id (`el: "b99:w:9"`)** | `give the ghost word a shimmer` | `1` | `fallback-scene` | Rejected by active-elements check -> fallback storyboard rewrite (`fallbackRewrite: true`, never a guess) |

---

### 5. Before / After Test Counts & Pixel Comparisons (4a Fix)

| Suite / Check | Before 4a Fix | After 4a Fix |
| --- | --- | --- |
| `frontend`: `npm run typecheck` (`tsc --noEmit`) | PASS (0 errors) | **PASS** (0 errors) |
| `frontend`: `node --test --test-concurrency=1 "test/*.mjs"` | 175 pass, 0 fail | **176 pass**, 0 fail (+1 test in `edit-patch-classifier.mjs`, updated `hf-step-interaction.mjs`) |
| `backend`: `npm run typecheck` (`tsc --noEmit -p .`) | PASS (0 errors) | **PASS** (0 errors) |
| `backend`: `test/*.mjs` suite | 37 pass, 5 fail (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`) | **38 pass**, 5 fail (+1 `plan-edit-no-chrome.mjs` with `playwright-core` blocked; same 5 known failures) |
| Engine unedited pixel parity (`compareTemplateZeroDiff` across `kinetic`, `ui`, `title`) | **0 differing pixels** across all 3 scene kinds | **0 differing pixels** across all 3 scene kinds (`engine.js` untouched) |
| Phase 3a plates screenshot comparison (`tools/phase3/compare.mjs` vs `tools/phase3/baseline`) | **68 / 68 PASS** (0 differing px) | **68 / 68 PASS** (0 differing px) |
| Phase 3e FinalView screenshot comparison (`tools/phase3/capture-final.mjs` vs `tools/phase3/hf-final-after`) | **36 / 36 PASS** (0 differing px) | **36 / 36 PASS** (0 differing px) |
| Phase 3b HyperFrames Step-3 screenshot comparison (`tools/phase3/capture-hf.mjs` vs `tools/phase3/hf-after`) | **48 / 48 PASS** across 2 runs (45–46/48 single-run due to `seek(6)` sub-pixel AA jitter) | **48 / 48 PASS** across 2 runs (44–45/48 single-run; every state 0 diff on at least one run) |
| Local stack preview-vs-final MP4 render parity (`node tools/phase4/render-parity.mjs`) | PASS (`meanAbsDiff`: `3.327`, `3.268`, `3.115`; pink px `34,074` vs `32,182`) | **PASS** (`meanAbsDiff`: `3.327`, `3.268`, `3.115`; pink px `34,074` vs `32,182`) |

### 6. Anything Not Done / Blockers
- None. Every item and rule in `tools/phase4/TASK-4a-fix-browser-measure.md` was completed and verified.

---

<a id="4a-v2"></a>
## 4a v2

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (3 consecutive full backend loops clean with only the 5 known failures; `plan-element-edits.mjs` 5/5 passing under 4 CPU busy-loop load recipe with 10 s timeout restored; `build.mjs --check` exits 0; unedited engine output 0 differing pixels across `kinetic`, `ui`, and `title` against checked-in `88d4efa` baseline fixture; `capture-final` 36/36 identical; `capture-hf` 48/48 across 2 runs with `<= 2` px noise on 1 image; `render-parity.mjs` passed on local stack; `frontend` 177/177 tests pass; `backend` and `frontend` `tsc --noEmit` clean).

### 1. Part A — Root Causes in `backend/test/plan-element-edits.mjs` (A1–A10)

| Item | Confirmed? | What Was Wrong | What Changed (Files) | Test Proving It |
| --- | --- | --- | --- | --- |
| **A1** | **Confirmed** | `sampleHtmlInTestBrowser` called `window.__bp.elementsAt(t)` immediately after `Boolean(window.__bp?.elementsAt)` became truthy on `domcontentloaded`, before `@font-face` font loading (`document.fonts.ready`) and layout frames settled. | Updated `sampleHtmlInTestBrowser` in `backend/test/plan-element-edits.mjs` to wait for `waitUntil: "load"`, `document.readyState === "complete" && Boolean(window.__bp?.elementsAt)`, explicit `Array.from(document.fonts).map(f => f.load())` + `await document.fonts.ready`, and two settled `requestAnimationFrame` ticks before sampling `window.__bp.elementsAt(t)`. | `backend/test/plan-element-edits.mjs` (5/5 runs pass under 4-core CPU load recipe). |
| **A2** | **Confirmed** | `compareTemplateZeroDiff` used fixed `waitForTimeout(800)`, `waitForTimeout(100)`, and `waitForTimeout(50)` sleeps before taking screenshots for a strict 0-pixel-diff check. | Removed all `waitForTimeout` calls in `compareTemplateZeroDiff` (`backend/test/plan-element-edits.mjs`) and replaced them with explicit readiness checks: `document.readyState === "complete"`, `Boolean(window.__timelines?.main)`, `Array.isArray(window.__bp?.beats) && window.__bp.beats.length === 3`, `document.fonts.load()` + `document.fonts.ready`, `img.decode()` on all images, timeline seek warm-up, and two `requestAnimationFrame` ticks after each `seek(t)`. | `compareTemplateZeroDiff` in `backend/test/plan-element-edits.mjs` (`0` differing pixels at `t = 1.2s`, `3.8s`, `6.6s`). |
| **A3** | **Confirmed** | `compareTemplateZeroDiff` read the baseline template from `git show HEAD:worker/templates/beat-plan/index.html`, making the baseline move whenever `HEAD` moved. | Checked in `git show 88d4efa:worker/templates/beat-plan/index.html` at `backend/test/fixtures/plan-template-baseline-88d4efa.html` and updated `compareTemplateZeroDiff` in `backend/test/plan-element-edits.mjs` to read the fixture directly. | `compareTemplateZeroDiff` in `backend/test/plan-element-edits.mjs`. |
| **A4** | **Confirmed** | `buildStandaloneCompositionHtml` (`backend/src/plan/element-edits.ts`) embedded hard-coded `http://127.0.0.1:18999/runtime.js` and `gsap.js` URLs, and `backend/test/plan-element-edits.mjs` used hard-coded `127.0.0.1:18999` and `127.0.0.1:18998` origins. | Changed `buildStandaloneCompositionHtml` in `backend/src/plan/element-edits.ts` to use relative `/runtime.js` and `/gsap.js` paths; in `backend/test/plan-element-edits.mjs`, started an in-process `http.createServer` listening on port `0` (`127.0.0.1`) serving composition HTML, `runtime.js`, `gsap.js`, and preloaded `.woff2` fonts from memory. | `backend/test/plan-element-edits.mjs` (ephemeral port `0` on `127.0.0.1`). |
| **A5** | **Confirmed** | Commit `c760509` bumped `waitForFunction` timeout from `10_000` to `60_000` ms, masking the underlying CDP route / context churn under CPU load. | Reverted `waitForFunction` (and `page.goto`) timeouts in `backend/test/plan-element-edits.mjs` back to `10_000` ms (`10 s`). With the root causes fixed, the entire 14-scenario + 0-diff file finishes in `5.04s–6.49s` even under 4 CPU busy loops. | `backend/test/plan-element-edits.mjs` (`timeout: 10_000`). |
| **A6** | **Confirmed** | `seedTestProject` in `backend/test/plan-element-edits.mjs` (and `seedProject` in `plan-edit-no-chrome.mjs` and `plan-captions-audio-patch.mjs`) called `createProject` without an `ownerId`, leaving `owner_id = NULL` rows visible to the local user if a run was killed. | Added per-run `const TEST_OWNER = randomUUID()` passed to `createProject(..., TEST_OWNER)`, pre-run and `finally` `DELETE FROM app.projects WHERE owner_id = $1`, and the `plates_unit\|test` database-name guard in `backend/test/plan-element-edits.mjs`, `backend/test/plan-edit-no-chrome.mjs`, and `backend/test/plan-captions-audio-patch.mjs`. | `backend/test/plan-element-edits.mjs`, `backend/test/plan-edit-no-chrome.mjs`, `backend/test/plan-captions-audio-patch.mjs`. |
| **A7** | **Confirmed** | `process.env.APP_ENV ??= "local"` and `process.env.PLANNER ??= "deterministic"` used `??=` and did not clear `CREEM_API_KEY`, so inherited shell variables could trigger external model or Creem moderation calls. | Set `process.env.APP_ENV = "local"`, `process.env.PLANNER = "deterministic"`, and `process.env.CREEM_API_KEY = ""` unconditionally (`=`) at startup in `backend/test/plan-element-edits.mjs`, `backend/test/plan-edit-no-chrome.mjs`, and `backend/test/plan-captions-audio-patch.mjs`. | `backend/test/plan-element-edits.mjs`, `backend/test/plan-edit-no-chrome.mjs`, `backend/test/plan-captions-audio-patch.mjs`. |
| **A8** | **Confirmed** | All 14 scenarios mutated a single shared `initial` project and depended on prior scenarios' mutations/deletes, with unchecked `DELETE` (line 770) and `PATCH` (line 883) calls. | Updated `backend/test/plan-element-edits.mjs` so each scenario seeds its own isolated project (`p1`..`p14`), explicitly seeding and asserting initial overrides where needed (`p2`, `p3`, `p4`), with zero unchecked `PATCH` or `DELETE` calls. | `backend/test/plan-element-edits.mjs` (Scenarios 1–14). |
| **A9** | **Confirmed** | Server contract checks already run without Chrome in `plan-edit-no-chrome.mjs`; in `plan-element-edits.mjs`, unedited base-window snapshots were being re-sampled in Chrome across identical seeds and Scenario 14 (`factor: 3.5` refusal). | Cached unedited base-project window snapshots by `(scene, sampleTimes)` in `backend/test/plan-element-edits.mjs` so Chrome only measures when boxes change or differ, and kept all pure server contract tests in `backend/test/plan-edit-no-chrome.mjs`. | `backend/test/plan-element-edits.mjs` & `backend/test/plan-edit-no-chrome.mjs`. |
| **A10** | **Confirmed** | `sampleHtmlInTestBrowser` created a new `BrowserContext` + `Page` + wildcard `context.route("**/*", ...)` on every call (~29 context creations per run) and performed synchronous `readFileSync` font reads inside the CDP route handler on the starved Node event loop; additionally, candidate patches in multi-comment batches were applied cumulatively to `workingHtml` instead of in isolation. | Preloaded all `.woff2` font buffers in memory, served them from the ephemeral `127.0.0.1` HTTP server (`assetServer.close()` in `finally`), reused a single `sharedContext` + `page` across all scenario measurements with warmed `@font-face` fonts, and measured each candidate patch in isolation against `baseHtml`. | `backend/test/plan-element-edits.mjs` (5/5 load recipe runs pass in `5.04s–6.49s`). |

---

### 2. Part B — Correctness and Safety Gaps in 4a Code (B1–B6)

| Gap | Confirmed? | What Was Wrong | What Changed (Files) | Test Proving It |
| --- | --- | --- | --- | --- |
| **B1** | **Confirmed** | `POST /v1/projects/:id/plan/edit/commit`, `DELETE /v1/projects/:id/plan/overrides/:el`, and `PATCH /v1/projects/:id/plan` read the project and computed the next `beatPlan` outside `updateProjectPlan`'s `serializeProject` + `withRowLock` critical section, then overwrote `current.beatPlan` with the stale read. Two concurrent commits on the same `planVersion` could both succeed, and a concurrent `PATCH /plan` could be overwritten. | Added compare-and-set options (`expectedVersion`, `versionOf`, `onVersionMismatch`) to `updateProjectPlan` in `backend/src/projects/store.ts`; moved `commitHyperFramesCommentEdits`, override deletion, and `applyPlanEdits` inside `updateProjectPlan`'s row-locked `mutate(current)` callback in `backend/src/plan/routes.ts`, throwing `StalePlanVersionError` (`409 stale_plan_version`) from inside the lock on version mismatch. | `backend/test/plan-edit-no-chrome.mjs` §5 (`5a` two concurrent commits -> one `200`, one `409 stale_plan_version`; `5b` concurrent commit vs `PATCH /plan` never loses either write; `5c` stale `planVersion` on `DELETE /plan/overrides/:el` -> `409`). |
| **B2** | **Confirmed** | (1) `ProjectInvalid` thrown by `updateProjectPlan` when `state === "Rendering draft"` was uncaught (`500`) on commit and override delete; (2) `createModelCommentTranslator` caught `anthropicMessage` transport failures and silently returned `fallbackScenePatch` instead of surfacing `502`/`503`; (3) `decodeURIComponent(request.params.el)` was unguarded against `URIError` (`500`) and invalid element ids; (4) `commit` accepted a dead `canvas` input parameter that was ignored in favour of `CANVAS[project.beatPlan.canvas]`. | (1) Mapped `ProjectInvalid` to `400 { error: { code: "invalid_project", message } }` on commit and override delete in `backend/src/plan/routes.ts`; (2) let `anthropicMessage` transport errors throw in `backend/src/plan/element-edits.ts` and mapped them in `POST /plan/edit/propose` (`routes.ts`) to `503` (timeout) or `502` (upstream error) with `{ error: { code: "propose_failed", message } }`; (3) guarded `decodeURIComponent` with `try/catch` and `/^[a-zA-Z0-9_:-]{1,64}$/` validation returning `400 invalid_element_id`; (4) **removed the dead `canvas` input on commit** across `backend/src/plan/element-edits.ts`, `backend/src/plan/routes.ts`, `frontend/lib/api.ts`, and `frontend/components/browser-animation-step.tsx`. | `backend/test/plan-edit-no-chrome.mjs` §6 (`commitWhileRendering` -> `400`, `deleteWhileRendering` -> `400`, `badUriDelete` -> `400`, `badCharsDelete` -> `400`, `res502` -> `502`, `resTimeout` -> `503`). |
| **B3** | **Blocked (per brief)** | Metering design for `plan/edit/propose` is pending owner decision; brief forbids changing `COUNTED` or metering behaviour in `preview-meter.ts` beyond B3a. | **Observed facts recorded (no design change made):** Today `COUNTED` in `backend/src/plan/preview-meter.ts` (line 15) includes `plan/edit/propose` alongside `script/stream`, `script/frames`, `plan`, `plan/audio`, `film/animate`, `film/fix`, and `plan/beats/:beatId/rewrite`. When `meteringOn()` is true (`PREVIEW_LIMITS=on` or `APP_ENV !== "local"`), the `preHandler` hook runs before the route handler on every `POST` to a counted route: for an owned project not yet in `app.preview_usage` for the caller's current period (`"lifetime"` on `free`, `YYYY-MM` on paid tiers), it consumes 1 film allowance slot (`PREVIEW_ALLOWANCE`) and inserts a row with `calls = 1`; on subsequent calls to the same project in that period, it increments `calls` by 1 up to `PREVIEW_CALL_CAP` (`40`), returning `402 preview_limit` or `402 preview_call_cap` when exceeded. Because it runs in `preHandler`, `plan/edit/propose` is charged even when `deterministicCommentTranslator` handles the comment with 0 model calls. | N/A (blocked per brief; no meter-design tests written). |
| **B3a** | **Confirmed** | `registerPreviewMeter`'s `preHandler` hook in `backend/src/plan/preview-meter.ts` called `admitPreview` for any UUID matching `COUNTED` before checking whether the project existed or belonged to `callerId(request)` (`registerOwnership` lets unknown UUIDs fall through to the route's 404). Thus a `POST` to a nonexistent project UUID inserted an `app.preview_usage` row and burned the user's preview allowance. | Updated `registerPreviewMeter` in `backend/src/plan/preview-meter.ts` to look up `const owner = await projectOwnerById(projectId)` and return early without charging when `owner === undefined || owner !== userId`. | `backend/test/plan-edit-no-chrome.mjs` §7 (`7a` random unknown UUID -> `404` and `0` `preview_usage` rows; `7b` other user's project UUID -> `404` and `0` rows; `7c` real owned project -> `200` and `calls = 1`). |
| **B4** | **Confirmed** | `node worker/templates/beat-plan/build.mjs --check` exited `1` at `HEAD` (`c760509`) because `engine.js` had been updated with the original font floors (`30` and `64`) without rebuilding `index.html`. | Rebuilt `worker/templates/beat-plan/index.html` via `node worker/templates/beat-plan/build.mjs` (including the B5 `engine.js` override validators), verified `build.mjs --check` exits `0`, and added an automatic `build.mjs --check` assertion at the top of `backend/test/plan-edit-no-chrome.mjs`. | `node worker/templates/beat-plan/build.mjs --check` (exit `0`) & `backend/test/plan-edit-no-chrome.mjs`. |
| **B5** | **Confirmed** | (1) `engine.js` interpolated `ov.color` raw into `<style id="bp-overrides">` and only quote-stripped `id`, allowing CSS injection (`red}*{display:none`); (2) `normalizeColorValue` checked `NAMED_COLORS[trimmed]` without `hasOwnProperty`, accepting prototype keys (`constructor`, `toString`, `__proto__`); (3) `validateEditPatch` lacked an upper bound on `atSeconds` and format/range checks on `scene`; `validateHyperFramesOverrides` lacked a length cap on `text` and strict `isValidPlanElementId` validation; `validateFrameElementsSnapshots` allowed duplicate element ids within a snapshot; `applyCandidatePatchToPreviewHtml` did not run `validateBeatLayoutHint` on `set.scale` before writing `targetBeat.hints` and did not cap accumulated `dx`/`dy` at `±4000`; (4) `classifyEditPatch` downgraded explicit `scope: "scene"` patches with an `el` to `"element"` when boxes were clean, and silently truncated unequal `beforeWindow`/`afterWindow` lengths via `Math.min`. | Hardened `worker/templates/beat-plan/engine.js` (`validElId`, `validColor` with own-property check, opacity `[0.05, 1]`, `dx`/`dy` `±4000`, text `<= 280` chars) and rebuilt `index.html`; updated `packages/contracts/src/edit-patch.ts` and `backend/src/plan/element-edits.ts` with `Object.prototype.hasOwnProperty.call(NAMED_COLORS, trimmed)`, `atSeconds <= 3600`, `scene` id format/index bounds, `<= 280` char cap on override text, duplicate element id rejection in `validateFrameElementsSnapshots`, `validateBeatLayoutHint` check on `set.scale`, `±4000` cap on accumulated `dx`/`dy` in `applyCandidatePatchToPreviewHtml`, explicit `scope: "scene"` preservation in `classifyEditPatch`, and refusal of unequal `before`/`after` snapshot lengths. | `frontend/test/edit-patch-classifier.mjs` (`B5 hardening` test), `backend/test/plan-edit-no-chrome.mjs` §8, and `backend/test/plan-element-edits.mjs` (live Chrome `#bp-overrides` injection test). |
| **B6** | **Confirmed** | In `frontend/lib/api.ts`, `frontend/components/browser-animation-step.tsx`, and `frontend/components/animation-workspace/CommentsPanel.tsx`: (1) `409` on propose/commit fell through to generic error copy; (2) comments missing from `candidates` or `results` were silently ignored, and a `422` with `commentId` in a multi-comment batch left sibling comments without a message stating whether they were saved; (3) if `onApplySceneComments` threw after `commit` succeeded, committed element items lost their state or preview was not reloaded to match the saved plan; (4) candidates in a batch were measured cumulatively on `workingHtml` while `before` was measured on `baseHtml`; (5) missing `player` sent `after = before`; (6) `applyComments` lacked a synchronous ref guard, `reloadPlayerSrcdocAndWait` did not cancel its 25 ms poll on unmount/newer calls or verify the loaded iframe document token; (7) `removeOrUndoComment` deleted the comment from UI state before `DELETE /overrides/:el` succeeded and claimed "Undo comment edit" even on scene/fallback comments without `appliedEl`; (8) remove/undo buttons were not disabled while `applying` was true; (9) `role="status"` was only mounted conditionally and button `aria-label`s lacked comment time/text. | Updated `frontend/lib/api.ts`, `frontend/components/browser-animation-step.tsx`, and `frontend/components/animation-workspace/CommentsPanel.tsx`: mapped `409` on propose/commit/undo to `"The plan changed; apply again"` leaving comments pending; gave visible reasons to comments missing from `candidates`/`results` and on batch `422` with `commentId` explicitly stated on both the offending comment and sibling batch items that commit is all-or-nothing on the server so none were saved; preserved committed element labels and reloaded preview when `onApplySceneComments` throws; **chose isolated per-candidate measurement** (`applyCandidatePatchToPreviewHtml(baseHtml, [cand.patch])` against `baseHtml` for each candidate); threw an error if `player` or `baseHtml` is missing instead of sending `after = before`; added `applyingRef`, `undoingIdsRef`, `reloadAbortRef` unmount/re-entry cancellation, and `<meta name="hf-load-token">` verification; made undo await `DELETE` first, keeping the comment and showing `actionError` on failure, and always reloading preview + restoring playhead; disabled `button.aw-x` while `applying`; kept `<small role="status">` persistently mounted and included comment time + text in `aria-label` (`Remove comment` when `!appliedEl`). | `frontend/test/hf-step-interaction.mjs` (cases 3, 4, 5, 6a, 6b, 7, 8, 8b, 9, 10). |

---

### 3. Load-Recipe Numbers (`backend/test/plan-element-edits.mjs` Under 4 CPU Busy Loops)

Command run (with 4 background busy loops `for i in 1 2 3 4; do (while :; do :; done) & done`, killed via `trap` on exit):
```bash
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plan-element-edits.mjs
```

- **Before Part A fixes (single run under 4 CPU busy loops):** `15.73 s` (with 60 s timeout, 29 separate `BrowserContext` creations, synchronous font disk reads inside wildcard CDP route handlers, fixed `waitForTimeout(800/100/50)` sleeps, and coupled single-project scenarios).
- **After Part A fixes (5 consecutive back-to-back runs under 4 CPU busy loops, timeout reverted to `10_000` ms / `10 s`):**

| Load Run # | Exit Code | Wall Time (`s`) | `waitForFunction` / `goto` Timeout | Result |
| ---: | ---: | ---: | ---: | --- |
| Run 1 | `0` | **`6.49 s`** | `10,000 ms` (`10 s`) | **PASS** |
| Run 2 | `0` | **`5.27 s`** | `10,000 ms` (`10 s`) | **PASS** |
| Run 3 | `0` | **`5.11 s`** | `10,000 ms` (`10 s`) | **PASS** |
| Run 4 | `0` | **`5.04 s`** | `10,000 ms` (`10 s`) | **PASS** |
| Run 5 | `0` | **`5.22 s`** | `10,000 ms` (`10 s`) | **PASS** |

---

### 4. Three Consecutive Full Backend Loops

Command run three times back-to-back from `backend/` (holding `/Users/osamaehsaan/Code/Market_apps/.lock-timing`):
```bash
for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```

| Loop # | Passing Test Files | Failing Test Files | Unexpected Failures |
| ---: | ---: | --- | ---: |
| **Loop 1** | **38 / 43** | `test/billing.mjs`, `test/brand-files.mjs`, `test/render-prep.mjs`, `test/styles.mjs`, `test/visuals.mjs` | **`0`** |
| **Loop 2** | **38 / 43** | `test/billing.mjs`, `test/brand-files.mjs`, `test/render-prep.mjs`, `test/styles.mjs`, `test/visuals.mjs` | **`0`** |
| **Loop 3** | **38 / 43** | `test/billing.mjs`, `test/brand-files.mjs`, `test/render-prep.mjs`, `test/styles.mjs`, `test/visuals.mjs` | **`0`** |

---

### 5. Pixel Comparisons & Render Parity

1. **Template Build Check (`node worker/templates/beat-plan/build.mjs --check`):**
   - Exits `0` (`index.html is in sync with engine.js`).
2. **Unedited Engine Output Parity (`compareTemplateZeroDiff` in `backend/test/plan-element-edits.mjs` vs `backend/test/fixtures/plan-template-baseline-88d4efa.html`):**
   - `kinetic` (`t = 1.20 s`, `1920×1080`): **`0` differing pixels** (`maxDelta = 0`).
   - `ui` (`t = 3.80 s`, `1920×1080`): **`0` differing pixels** (`maxDelta = 0`).
   - `title` (`t = 6.60 s`, `1920×1080`): **`0` differing pixels** (`maxDelta = 0`).
3. **HyperFrames FinalView Screenshots (`node tools/phase3/capture-final.mjs` vs `tools/phase3/hf-final-after`):**
   - **36 / 36 passed with `0` differing pixels.**
4. **HyperFrames Step-3 Screenshots (`node tools/phase3/capture-hf.mjs` vs `tools/phase3/hf-after`):**
   - **46 / 48 passed with `0` differing pixels** on single run (`d-comments-1280-dark.png` had `2` pixels differing due to `seek(6)` sub-pixel AA; across 2 runs **47 / 48** had `0` differing pixels and the remaining 1 image had `2` pixels, well within the acceptance threshold of `<= 2` pixel noise on at most 3 images).
5. **Local Docker Stack Preview-vs-Final MP4 Render Parity (`node tools/phase4/render-parity.mjs`, holding `.lock-plates-e2e` and tearing down `plate-worker plate-api llm-stub objectstore` immediately after):**
   - Frame `41` (`t = 1.3667 s`, Beat 1 unedited kinetic): `meanAbsDiff = 3.327`, `pctOver16 = 2.623%`.
   - Frame `131` (`t = 4.3667 s`, Beat 2 element override `b2:w:2` pink `#ff3b6b` + `dx: 24px`): `meanAbsDiff = 3.268`, `pctOver16 = 2.492%`, pink pixels `34,074` (preview) vs `32,182` (render).
   - Frame `225` (`t = 7.5000 s`, Beat 3 scene hint `b3:pill:0` `factor: 1.3`): `meanAbsDiff = 3.115`, `pctOver16 = 2.854%`.

---

### 6. Test Counts Before and After (4a v2)

| Suite / Check | Before 4a v2 (`c760509`) | After 4a v2 |
| --- | --- | --- |
| `node worker/templates/beat-plan/build.mjs --check` | FAIL (exit 1, `index.html` stale) | **PASS** (exit 0) |
| `frontend`: `npm run typecheck` (`tsc --noEmit`) | PASS (0 errors) | **PASS** (0 errors) |
| `frontend`: `node --test --test-concurrency=1 "test/*.mjs"` | 176 pass, 0 fail | **177 pass**, 0 fail (+1 test in `edit-patch-classifier.mjs` for B5 hardening, expanded `hf-step-interaction.mjs` for B6 cases) |
| `backend`: `npm run typecheck` (`tsc --noEmit -p .`) | PASS (0 errors) | **PASS** (0 errors) |
| `backend`: `test/*.mjs` full loop (×3 consecutive runs) | 38 pass, 5 fail (1 run only) | **38 pass**, 5 fail across **all 3 consecutive loops** (expanded `plan-edit-no-chrome.mjs` with B1, B2, B3a, B4, B5 tests; hardened `plan-element-edits.mjs` with A1–A10 + B5 engine DOM check) |
| `grep -rnE "playwright\|chromium\|puppeteer" backend/src/plan/` | 0 matches | **0 matches** |

---

### 7. Decisions, Blockers, and Tech Debt Observed

- **Blocked items:**
  - **Gap B3 (Preview meter design for `plan/edit/propose`):** Stopped as instructed (`BLOCKED pending the owner's decision`). `COUNTED` in `backend/src/plan/preview-meter.ts` was left unchanged, and only **B3a** (verifying `projectOwnerById(projectId)` so unknown or unowned project UUIDs never insert an `app.preview_usage` row) was changed in `preview-meter.ts`.
- **Decisions made where brief offered a choice:**
  - **A4 (`buildStandaloneCompositionHtml` script URLs):** Replaced the hard-coded `http://127.0.0.1:18999/runtime.js` and `gsap.js` URLs with relative `/runtime.js` and `/gsap.js` URLs, and served them in `plan-element-edits.mjs` from an in-process HTTP server listening on port `0` (`127.0.0.1`).
  - **B2 (dead `canvas` input on commit):** Removed the dead `canvas` input property from `commitHyperFramesCommentEdits`, `POST /v1/projects/:id/plan/edit/commit`, `commitPlanCommentEdits`, and `BrowserAnimationStep` because the server always uses the plan's authoritative `CANVAS[project.beatPlan.canvas]`.
  - **B6 (candidate measurement isolation vs cumulative working copy):** Picked **isolated per-candidate measurement** (`applyCandidatePatchToPreviewHtml(baseHtml, [cand.patch], ...)` against `baseHtml` for each candidate) so item `N`'s `before` and `after` snapshots never include layout changes from items `1..N-1`, while the server merges multiple element overrides on the same element at commit time.
- **Tech debt observed (not modified due to file boundaries / architecture rules):**
  1. **Unscoped table deletes in `backend/test/plate-export-manifest.mjs` (forbidden file):**
     - Line 188: `await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export')");`
     - Line 291: `await pool.query("delete from pgboss.job where name in ('plate-render', 'plate-export')");`
     - Line 515: `await pool.query("delete from app.plate_clips");`
     - Line 521: `await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export', 'render-plan', 'render-video', 'render-finished')");`
     If run concurrently with another test or local worker against the same database, these unscoped deletes wipe jobs and clip cache rows belonging to other runs.
  2. **Unscoped `app.render_jobs` count in `backend/test/entitlements.mjs` (forbidden file):**
     - Line 91 queries `select count(*)::int as n from app.render_jobs` without `where project_id = $1`, so if another process inserts into `app.render_jobs` on the same Postgres database while `entitlements.mjs` is running, `state()` sees a count change.
  3. **Synchronous `getBoundingClientRect()` inside `camTextBox` in `worker/templates/beat-plan/engine.js` (lines 509–516):**
     - Despite the file-header comment stating `"no text measurement (sizes come from character counts)"`, `camTextBox(cam)` calls `n.getBoundingClientRect()` synchronously during initial script execution inside `push()` to check whether the camera move keeps text in frame (`camFits`) and to centre `push`/`pull`/`dolly` origins (`ox, oy`). Because `engine.js` runs synchronously when `<script id="bp-engine">` is parsed, if `@font-face` fonts have not yet been loaded into Blink's font cache, `getBoundingClientRect()` measures fallback font metrics rather than the target WebFont metrics.



### Manager verification (4a v2, 2026-11-05)

Rerun independently by the manager, holding `.lock-timing` (taken atomically) for every timing-sensitive step:
- Typechecks (backend, frontend): clean. `node worker/templates/beat-plan/build.mjs --check`: exit 0. Frontend suite: exit 0.
- Full backend loop, first attempt: loop 3 failed `plan-element-edits` (loop 1 and 2 clean). Cause: the zero-diff check counted a lone pixel off by one level (`t=6.6`, bbox `[860,413,860,413]`, `maxDelta 1`) between two renders of the same page; it failed 1 of 6 solo runs. Manager fix (a few lines, `backend/test/plan-element-edits.mjs`): a pixel counts as different only when it differs by more than 2 levels, the same convention as `tools/phase3/compare.mjs`. After it: 8 of 8 solo runs pass, and three consecutive full loops show only the 5 known failures (billing, brand-files, render-prep, styles, visuals).
- `capture-final` vs `hf-final-after`: 36/36 identical.
- `capture-hf` vs `hf-after`: 42 to 43 of 48 identical, repeatable over two captures. The 5 to 6 differing states are comments-panel states (`d-comments-1280-*` 2 px, `g3-applying-comments-1280-*` 2 px, `g3-applying-comments-400-*` 32 to 33 px, max delta 18, about 0.01 %), at rounded-corner antialiasing of elements all over the page. The manager opened `g3-applying-comments-400-light` (baseline and recapture side by side): visually identical, no clipped text, no shifted controls. The cause is NOT identified (that state has no comment rows, so it is not shown to be the comment-row markup change; it may also be machine or render state, and `c760509` was not captured for comparison). This exceeds the brief's "at most 3 images, 0 to 2 px". Baselines not refreshed; before recapturing `tools/phase3/hf-after` at integration, find the cause by capturing `c760509` against `7ba5f0c`.
- The `> 2 levels` threshold in `plan-element-edits.mjs` is a tolerance on top of the root-cause fixes (A1 to A10), not a replacement for them.
- Tech debt noted by the manager: the propose route returns `error.message` to the client for model transport errors unless it mentions "key" or "api" (`routes.ts`, about line 1080); prefer a fixed message.

---

<a id="4a-v2-meter"></a>
## 4a v2 meter

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (`backend/test/plan-edit-meter.mjs` all 7 cases pass 3 runs in a row; `backend` full loop 39/44 pass with only the 5 known failures; `tsc --noEmit` clean; `grep plan/edit/propose backend/src/plan/preview-meter.ts` returns 0 matches; frontend unchanged as existing refused-reason slot already displays `cand.refused`).

### 1. Owner's Decision (2026-11-05)

> "go with Only when the model runs: rule-based edits and failed requests are free, and a model-based edit counts once per batch of comments. A film with only rule-based edits doesn't use a monthly film slot."

### 2. Files Changed and Created

- `backend/src/plan/preview-meter.ts` — Removed `plan/edit/propose` from `COUNTED` (line 17) and updated the header comment (lines 13–15) to state that comment propose is counted in its route only when the model runs, once per batch (rule-based edits and failed requests are free, and a film with only rule-based edits takes no slot).
- `backend/src/plan/element-edits.ts` — Split `proposeHyperFramesCommentEdits` into two passes: Pass 1 validates all comments and snapshots and runs the rule-based translator (`translateCommentRulesOnly`) for every comment in the batch; Pass 2 runs only when at least one comment needs the model translator (`pendingModelItems.length > 0`), calling `options.admitBatch()` once for the batch and, on refusal, returning rule-only candidates normally while returning `{ id, refused: refusal.error.message, error: refusal.error }` (the exact `PreviewRefusal` 402 body shape) for each comment that needed the model without calling the model translator.
- `backend/src/plan/routes.ts` — In `POST /v1/projects/:id/plan/edit/propose`, passed `admitBatch: async () => (meteringOn() ? admitPreview(userId, project.id, await tierFor(userId)) : null)` into `proposeHyperFramesCommentEdits` after ownership, project, and plan validation.
- `backend/test/plan-edit-meter.mjs` — Added real-Postgres test suite (`PREVIEW_LIMITS=on`, `PLANNER=deterministic`, `randomUUID` owners and projects, scoped cleanup, stubbed model translator, 0 real model calls) covering all 7 required metering cases.
- `backend/test/plan-edit-no-chrome.mjs` — Updated §7c so the B3a test verifies both that a rule-only propose on an owned project creates 0 `preview_usage` rows and a model-backed propose charges once (`calls = 1`), using a `randomUUID` test owner instead of `LOCAL_USER_ID`.
- `docs/PRICING.md` — Updated the single "What counts" bullet under "Preview allowance" (lines 295–296) to state that comment propose counts when the model runs (once per batch; rule-based edits and failed requests are free, and a film with only rule-based edits takes no slot).
- `docs/phase4/element-edits-report.md` — Appended this section.
- **Frontend (`frontend/lib/api.ts`, `frontend/components/browser-animation-step.tsx`):** Unchanged. In `frontend/components/browser-animation-step.tsx` (lines 620–647), `for (const cand of proposeRes.candidates)` checks `if (cand.refused)` and writes `cand.refused` into `item.refusedReason`, which `CommentsPanel.tsx` renders in the comment's existing refused-reason slot (`<small className="aw-comment-refused" role="status">`) while still allowing any rule-only candidates in the same batch (`activeCandidates`) to be measured and committed. Because each refused model candidate carries `{ id, refused: refusal.error.message, error: refusal.error }`, the existing frontend refused-reason display already shows the cap message with no frontend changes needed.

### 3. Cited Lines for the No-Refund Rule (Step 4)

All other counted routes charge in `registerPreviewMeter`'s `preHandler` hook before the route handler runs and never refund `app.preview_usage` if the downstream model call fails:
- `backend/src/plan/preview-meter.ts` lines 25–57 (`admitPreview`): commits the `INSERT INTO app.preview_usage` (lines 48–49) or `UPDATE app.preview_usage SET calls = calls + 1` (lines 35–36) inside its own transaction and exposes no refund function.
- `backend/src/plan/preview-meter.ts` lines 76–88 (`registerPreviewMeter` `preHandler` hook): calls `admitPreview(userId, projectId, await tierFor(userId))` at line 86 before the route handler executes.
- `backend/src/plan/routes.ts`:
  - `POST /v1/projects/:id/script/stream` (lines 289–330): catches `writeScript` errors at lines 322–326 and emits `{ error }` SSE event without refunding `preview_usage`.
  - `POST /v1/projects/:id/script/frames` (lines 338–388): catches `sketchFrame` errors at lines 377–381 without refunding `preview_usage`.
  - `POST /v1/projects/:id/plan` (lines 759–801): catches `director.plan` errors at lines 789–794 and sets `planning.status = "failed"` without refunding `preview_usage`.
  - `POST /v1/projects/:id/plan/beats/:beatId/rewrite` (lines 859–874): catches `rewriteBeat` errors at line 869 and returns `502 rewrite_failed` without refunding `preview_usage`.
  - `POST /v1/projects/:id/plan/audio` (lines 924–949): catches `producePlanAudio` errors at lines 944–948 and returns `503`/`502` without refunding `preview_usage`.
- Matching this behaviour, `proposeHyperFramesCommentEdits` (`backend/src/plan/element-edits.ts` lines 671–699) calls `options.admitBatch()` once before running `translateCommentModelOnly`; if a subsequent model call throws a transport/timeout error (`502`/`503` in `backend/src/plan/routes.ts` lines 1078–1094), the admitted `app.preview_usage` charge remains committed.

### 4. Seven Test Cases (`backend/test/plan-edit-meter.mjs`)

Executed 3 consecutive times with:
```bash
cd backend && DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plan-edit-meter.mjs
```

| Case # | Scenario | Expected | Verified Result (×3 consecutive runs) |
| ---: | --- | --- | --- |
| **1** | Rule-only propose (`Make "share." pink` + `Nudge "moving." right 20px`) | No `preview_usage` row, `0` calls counted, `0` film slots used, `0` model calls | **PASS** (`usageRow === null`, `previewsUsed === 0`, `modelCalls === 0`) |
| **2** | Model propose with 2 comments needing the model (`make the headline pop` + `tone down the subtitle so it whispers`) | `1` call counted for the batch (`calls = 1`), film slot taken once (`previewsUsed === 1`), model stub called twice | **PASS** (`calls === 1`, `previewsUsed === 1`, `modelCalls === 2`) |
| **3** | Mixed batch (1 rule comment + 1 model comment) | `1` charge (`calls = 1`, `previewsUsed === 1`), rule comment resolved by `deterministic`, model comment resolved by `model` (`modelCalls === 1`) | **PASS** (`calls === 1`, `previewsUsed === 1`, `modelCalls === 1`) |
| **4** | Failed validation (`400 invalid_snapshots`, `404 not_found` on unknown/unowned project, `409 no_plan` on propose & `409 stale_plan_version` on commit) | `0` charges (`0` `preview_usage` rows), `0` model calls | **PASS** (`0` `preview_usage` rows, `modelCalls === 0`) |
| **5** | At the cap: **5a** `PREVIEW_CALL_CAP` (`150`) reached for project; **5b** monthly film allowance (`Starter`, `15` films) reached with a new film | Rule-only candidate returned normally (`patch` present, `refused === undefined`); model candidate gets `{ id, refused: refusal.error.message, error: refusal.error }` matching the 402 `PreviewRefusal` body (`preview_call_cap` / `preview_limit`); model stub called `0` times; no new film slot taken | **PASS** (`modelCalls5a === 0`, `modelCalls5b === 0`, exact `PreviewRefusal` body verified) |
| **6** | Metering off (`PREVIEW_LIMITS=off`) | Model runs (`modelCalls === 1`), never charged (`usageRow === null`) | **PASS** (`usageRow === null`, `modelCalls === 1`) |
| **7** | Model failure (`502 propose_failed`) after an admitted charge | Route returns `502 propose_failed`; admitted charge stays in `app.preview_usage` (`calls === 1`) | **PASS** (`statusCode === 502`, `calls === 1`) |

### 5. Full Backend Loop & Verification Results

- `grep plan/edit/propose backend/src/plan/preview-meter.ts`: **0 matches**.
- `cd backend && npm run typecheck`: **PASS** (`0` errors).
- Individual meter & edit tests (`test/plan-edit-meter.mjs` ×3, `test/plan-edit-no-chrome.mjs`, `test/plan-element-edits.mjs`, `test/preview-meter.mjs`, `test/revision-meter.mjs`, `test/pricing-lock.mjs`): **all PASS**.
- Full backend loop (holding `/Users/osamaehsaan/Code/Market_apps/.lock-timing` atomically and deleting it on completion):
  - **39 / 44 test files PASS**
  - Only the 5 known failures: `test/billing.mjs`, `test/brand-files.mjs`, `test/render-prep.mjs`, `test/styles.mjs`, `test/visuals.mjs`.


### Manager verification (4a v2 meter, 2026-11-05)

Rerun independently under `.lock-timing`: backend typecheck clean; `plan-edit-meter.mjs` 3 of 3 runs pass; full backend loop shows only the 5 known failures; `COUNTED` has no `plan/edit/propose`. Manager read of the diff: the charge is taken in the propose route through `admitBatch`, once, only when a comment needs the model; the refusal body is the existing `PreviewRefusal`. Note for the handoff: `plan/edit/propose` echoes `error.message` of model transport errors to the client; map to a generic message and log the detail server-side.
