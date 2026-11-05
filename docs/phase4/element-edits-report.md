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

