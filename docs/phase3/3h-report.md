# Phase 3h Report — Step-3 Options Bar Usable at 400 px

## 1. Map of Clipped / Covered Controls at 400 px Before Changes (`c891283` / `3h-before`)

### Root CSS & Markup Ownership of the 400 px Failures

1. **`frontend/app/animation-workspace.css:9` (`.aw-floating-bar`)**
   - `display: inline-flex; height: 38px; min-height: 38px; max-height: 38px; max-width: 100%; flex-wrap: nowrap; white-space: nowrap` with no narrow-width `@media` rule.
   - At `400 px` viewport width, `.animation-workspace` (`@media (max-width: 1100px)` at `:274`, `padding: 8px 16px 12px`) gives `.aw-stage` and `.aw-floating-bar` a maximum width of `368 px` (`x = 16..384`, inner content width `354 px`). Because `flex-wrap: nowrap` and `flex: none` on `.aw-mode-tabs` (`:11`), `.aw-bar-sep` (`:27`), `.aw-menu-wrap` (`:29`), and `.aw-inline-stepper` (`:43`) prevented wrapping or shrinking, controls on the Subtitle tab overflowed past the right border of `.aw-floating-bar` (`384 px`) and past the `400 px` viewport right edge (`x = 401.72..677.72 px`).
2. **`frontend/app/animation-workspace.css:19` (`.aw-inline-group`)**
   - `display: inline-flex; align-items: center; gap: 3px; min-width: 0` (with default `flex-shrink: 1` and no `flex-wrap: wrap`).
   - On the Plates Audio tab (`OptionsBar.tsx:110-155`), `.aw-inline-group` contains four `.aw-track-chip` buttons (`Voice`, `Music`, `SFX`, `Transitions`, intrinsic width `227.16 px`). Because `.aw-inline-group` had `min-width: 0`, flexbox shrank `.aw-inline-group`'s box to `114.27 px` so that the following `.aw-bar-sep` and `Standard ▾` (`.aw-menu-wrap`, `:505`) were positioned at `x = 301.77..377.00 px` — **directly on top of** `SFX` (`x = 282.92..323.30 px`) and `Transitions` (`x = 326.30..405.66 px`). When `statusBadge` (`3/5 drawn…`) was also present (`h-scene-updating`), `Standard ▾` and `.aw-mini-status` covered `Music`, `SFX`, and `Transitions`.
3. **`frontend/app/animation-workspace.css:29, :61-65` (`.aw-menu-wrap` & `.aw-dialog`)**
   - `.aw-menu-wrap` had `position: relative` and `.aw-dialog` had `position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 270px` (`.aw-dialog-styles`: `290px`, `.aw-dialog-opacity`: `210px`).
   - Because each popover was centered on its individual `.aw-menu-wrap` trigger, five of the six popovers overflowed past the `400 px` viewport right edge (`style` right = `447.58 px`, `colors` right = `589.72 px`, `opacity` right = `605.22 px`, `position` right = `693.09 px`, `quality` right = `775.09 px`).
4. **`frontend/app/animation-workspace.css:9, :143` (`.aw-floating-bar` `z-index: 20` vs `.aw-dim-rail` `z-index: 25`)**
   - `.aw-floating-bar` created a stacking context at `z-index: 20`, so even though `.aw-dialog` declared `z-index: 50`, `.aw-dim-rail` (`z-index: 25` inside `.aw-frame`) painted over the left edge of open dialogs at `400 px`.
5. **`frontend/app/animation-workspace.css:13, :21, :31, :43-45` (Touch target heights)**
   - `.aw-mode-tab` (`height: 26px`), `.aw-track-chip` (`height: 26px`), `.aw-pill-item` (`height: 28px`), and `.aw-inline-stepper button` (`height: 24px` inside `26px` border-box) were all below the `32 px` floor / `36 px` touch target guidance.

### Pre-Change Playwright `boundingBox()` & `elementFromPoint()` Measurements at 400 px

#### A. Plates — Subtitle Tab (`c-ready`, `h-scene-updating`) at `400×800`
`barRect`: `x = 16, y = 8, width = 368, height = 38, right = 384`

| # | Control | Selector / Owner | `x` (px) | `y` (px) | `right` (px) | `w × h` (px) | In 400 px Viewport? | Uncovered (`elementFromPoint`)? | Status Before 3h |
| ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | `♫ Audio` | `button.aw-mode-tab` (`.aw-mode-tabs`) | 25.00 | 14.00 | 87.33 | `62.33 × 26` | Yes | Yes (`SPAN`) | Visible, height 26 px (< 32 px) |
| 2 | `💬 Subtitle` | `button.aw-mode-tab.on` (`.aw-mode-tabs`) | 89.33 | 14.00 | 167.50 | `78.17 × 26` | Yes | Yes (`SPAN`) | Visible, height 26 px (< 32 px) |
| 3 | `Subtitles ▾` | `button.aw-pill-item` (`.aw-menu-wrap` :164) | 178.50 | 13.00 | 252.45 | `73.95 × 28` | Yes | Yes (`SPAN`) | Visible, height 28 px (< 32 px) |
| 4 | `Storybook ▾` | `button.aw-pill-item` (`.aw-menu-wrap` :207) | 261.45 | 13.00 | 343.72 | `82.27 × 28` | Yes | Yes (`SPAN`) | Visible, height 28 px (< 32 px) |
| 5 | `−` (Decrease size) | `.aw-inline-stepper button:first-child` (:250) | 353.72 | 15.00 | 373.72 | `20.00 × 24` | Yes | Yes (`BUTTON`) | Partially inside bar, height 24 px |
| 6 | `+` (Increase size) | `.aw-inline-stepper button:last-child` (:260) | 401.72 | 15.00 | 421.72 | `20.00 × 24` | **No** (`> 400`) | **No** (`null`) | **Clipped off-screen** |
| 7 | `Subtitle colors` | `button.aw-pill-swatches` (`.aw-menu-wrap` :277) | 431.72 | 13.00 | 477.72 | `46.00 × 28` | **No** (`> 400`) | **No** (`null`) | **Clipped off-screen** |
| 8 | `Transparency` | `button.aw-pill-icon` (`.aw-menu-wrap` :357) | 486.72 | 13.00 | 513.72 | `27.00 × 28` | **No** (`> 400`) | **No** (`null`) | **Clipped off-screen** |
| 9 | `Position ▾` | `button.aw-pill-item` (`.aw-menu-wrap` :394) | 522.72 | 13.00 | 593.48 | `70.77 × 28` | **No** (`> 400`) | **No** (`null`) | **Clipped off-screen** |
| 10 | `Standard ▾` | `button[aria-label="Preview quality"]` (:505) | 602.48 | 13.00 | 677.72 | `75.23 × 28` | **No** (`> 400`) | **No** (`null`) | **Clipped off-screen** |
| 11 | `3/5 drawn…` | `span.aw-mini-status` (`StatusLine` :549) | 686.72 | 19.50 | 764.80 | `78.08 × 15` | **No** (`> 400`) | **No** (`null`) | **Clipped off-screen** |

#### B. Plates — Open Popovers (`role="dialog"`) at `400×800` Before Changes

| Popover | Dialog Selector | `x` (px) | `y` (px) | `right` (px) | `w × h` (px) | In 400 px Viewport? |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `captions` | `[role="dialog"][aria-label="Subtitle mode"]` | 80.47 | 49.00 | 350.47 | `270 × 232` | Yes |
| `style` | `[role="dialog"][aria-label="Subtitle style"]` | 157.58 | 49.00 | **447.58** | `290 × 272.39` | **No** (overflows right by `47.58 px`) |
| `colors` | `[role="dialog"][aria-label="Colors"]` | 319.72 | 49.00 | **589.72** | `270 × 172` | **No** (overflows right by `189.72 px`) |
| `opacity` | `[role="dialog"][aria-label="Transparency"]` | 395.22 | 49.00 | **605.22** | `210 × 70` | **No** (overflows right by `205.22 px`) |
| `position` | `[role="dialog"][aria-label*="subtitle position"]` | 423.09 | 49.00 | **693.09** | `270 × 255` | **No** (completely off-screen, `x > 400`) |
| `quality` | `[role="dialog"][aria-label="Preview quality"]` | 505.09 | 49.00 | **775.09** | `270 × 232` | **No** (completely off-screen, `x > 400`) |

#### C. Plates — Audio Tab (`e-audio-open` & `h-scene-updating`) at `400×800` Before Changes

| # | Control | Selector / Owner | `x` (px) | `y` (px) | `right` (px) | `w × h` (px) | In 400 px Viewport? | Uncovered (`elementFromPoint`)? | Status Before 3h |
| ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | `♫ Audio` | `button.aw-mode-tab.on` | 25.00 | 14.00 | 87.33 | `62.33 × 26` | Yes | Yes | Visible, height 26 px |
| 2 | `💬 Subtitle` | `button.aw-mode-tab` | 89.33 | 14.00 | 167.50 | `78.17 × 26` | Yes | Yes | Visible, height 26 px |
| 3 | `Voice` | `button.aw-track-chip.on` (`.aw-inline-group`) | 178.50 | 14.00 | 226.33 | `47.83 × 26` | Yes | Yes | Visible, height 26 px |
| 4 | `Music` | `button.aw-track-chip.on` (`.aw-inline-group`) | 229.33 | 14.00 | 279.92 | `50.59 × 26` | Yes | Yes in `e-audio-open`, **No** in `h-scene-updating` (covered by `Standard ▾`) | Covered when status chip present |
| 5 | `SFX` | `button.aw-track-chip.on` (`.aw-inline-group`) | 282.92 | 14.00 | 323.30 | `40.38 × 26` | Yes | **No** (covered by `Standard ▾` at `x = 301.77..377.00`) | **Covered by `Standard ▾`** |
| 6 | `Transitions` | `button.aw-track-chip` (`.aw-inline-group`) | 326.30 | 14.00 | **405.66** | `79.36 × 26` | **No** (`> 400`) | **No** (covered by `Standard ▾` / `.aw-mini-status`) | **Covered & clipped** |
| 7 | `Standard ▾` | `button[aria-label="Preview quality"]` | 301.77 | 13.00 | 377.00 | `75.23 × 28` | Yes | Yes | Overlaps `SFX` & `Transitions` |

#### D. HyperFrames Bar (`c-ready` & `g2-preview-error`) at `400×800` Before Changes
- **Subtitle tab (`c-ready`)**: `barRect` `x = 78.27, y = 8, w = 243.45, h = 38, right = 321.72`. Controls: `♫ Audio` (`x = 87.27..149.59, h = 26`), `💬 Subtitle` (`x = 151.59..229.77, h = 26`), `Subtitles ▾` (`x = 240.77..314.72, h = 28`). Inside viewport, but heights `26–28 px < 32 px`.
- **Audio tab (`c-ready`)**: `barRect` `x = 64.53, y = 8, w = 270.92, h = 38, right = 335.45`. Controls: `♫ Audio`, `💬 Subtitle`, `Voice` (`x = 227.03..274.86, h = 26`), `Music` (`x = 277.86..328.45, h = 26`). Inside viewport, but heights `26 px < 32 px`.
- **Preview error state (`g2-preview-error`)**: `statusBadge` adds `Preview unavailable` + `button.aw-pill-item` (`Retry`). `Retry` sat at `x = 394..440`, **clipped off the right edge of the 400 px viewport**.

---

## 2. Chosen Approach and Why

We chose **Shape (a): wrapping `.aw-floating-bar` into rows below `@media (max-width: 560px)`** rather than Shape (b) (scrolling an inner track of non-popover controls):

1. **Why Shape (b) cannot work for the Subtitle tab**:
   - All popovers (`.aw-dialog`) are `position: absolute` children inside their `.aw-menu-wrap` (no portal), so any ancestor with `overflow-x: auto | hidden` clips open popovers.
   - On the Plates Subtitle tab, 5 of the 6 controls after `.aw-mode-tabs` are popover-bearing `.aw-menu-wrap` elements (`Subtitles ▾`, `Storybook ▾`, `Subtitle colors`, `Transparency`, `Position ▾`, `Standard ▾`). Those popover triggers alone require `~375 px` plus `.aw-mode-tabs` (`146.5 px`) = `~521.5 px > 368 px`, so keeping popover-bearing controls outside a scroller still overflows `400 px`.
2. **Why Shape (a) works cleanly with zero stage overlap**:
   - In `frontend/app/animation-workspace.css:137`, `.aw-stage` is a CSS grid (`grid-template-rows: auto minmax(0,1fr) auto auto; gap: 10px`) where row 1 (`auto`) is `.aw-floating-bar` and row 2 (`minmax(0,1fr)`) is `.aw-frame` (containing `.aw-canvas`).
   - At `@media (max-width: 860px)` (`:276`), `.animation-workspace` already switches to `height: auto; max-height: none; overflow: visible; grid-template-columns: minmax(0,1fr); grid-template-rows: none`.
   - Consequently, when `.aw-floating-bar` wraps into two rows (`height: 74 px`, `y = 8..82`) on Plates at `400 px`, `.aw-stage` automatically pushes `.aw-frame` and `.aw-canvas` down to `y = 92..299` (preserving the full `368 × 207 px` 16:9 stage with the exact `10 px` grid gap and zero overlap).
3. **Separators, Popovers, Stacking, and 36 px Touch Targets**:
   - **Row-edge separators**: `.aw-bar-sep:has(+.aw-inline-stepper)`, `.aw-bar-sep:has(+.aw-status-wrap)`, and `.aw-bar-sep:has(+.aw-inline-group .aw-track-chip:nth-child(3))` hide only the dividers that fall at a row wrap boundary while keeping in-row dividers intact.
   - **Popovers anchored to the bar**: `.aw-menu-wrap { position: static }` at `@media (max-width: 560px)` makes `.aw-floating-bar` (`position: relative; z-index: 30`) the positioning context for `.aw-dialog`. Every popover opens `8 px` below the bottom of the full bar (`y = 89` on a 2-row bar, never covering Row 2 triggers), centered horizontally at `x = 200 px` (`x = 65..335` for `270 px` dialogs, `x = 55..345` for `290 px` `.aw-dialog-styles`, `x = 95..305` for `210 px` `.aw-dialog-opacity`), and above `.aw-dim-rail` (`z-index: 25`).
   - **36 px touch targets without altering 1-row bar geometry**: At `@media (max-width: 560px)`, `.aw-mode-tab`, `.aw-pill-item`, `.aw-track-chip`, and `.aw-inline-stepper button` are `height: 36px` with negative `margin-block` (`-5px` / `-4px`) and `::before` visual pill layers (`pointer-events: none; z-index: -1`). Every control's `getBoundingClientRect().height` is `36 px` (meeting the `36 px` target and `32 px` floor), while a 1-row bar (HyperFrames `c-ready` at `400 px`) retains its exact `38 px` height and pixel-identical appearance.

---

## 3. Files Changed with Line Counts

| File | Diff Stat (`+ / -`) | Total Lines | Description |
| --- | ---: | ---: | --- |
| `frontend/app/animation-workspace.css` | `+4 / -0` | 312 | Added `.aw-status-wrap{display:contents}` and `@media (max-width:560px)` rules for `.aw-floating-bar`, row-edge `.aw-bar-sep`, `.aw-inline-group`, `.aw-status-wrap`, 36 px touch targets, and bar-anchored `.aw-dialog` |
| `frontend/components/animation-workspace/OptionsBar.tsx` | `+5 / -3` | 558 | Wrapped `<StatusLine>` in `<span className="aw-status-wrap">` so status text and `Retry` button wrap together as a unit |
| `frontend/test/workspace-bar-narrow.mjs` | `+453 / -0` (new) | 453 | Headless Chrome layout, hit-test, touch-size, Tab-order, stage non-overlap, and popover bounds test at 400 px and 1280 px |
| `docs/phase3/3h-report.md` | `+205 / -0` (new) | 205 | Phase 3h report |

*(Note: `docs/HANDOFF_2026-11-05_PLAYBACK.md` was already modified in the working tree before this task and was left untouched.)*

---

## 4. Layout Test Results Per Control (`frontend/test/workspace-bar-narrow.mjs`)

Command: `node frontend/test/workspace-bar-narrow.mjs` — **PASS** (`1/1` passed, `scrollWidth === innerWidth` across all states).

### Post-Change Control Measurements at 400 px (`400×800`)

#### A. Plates — Subtitle Tab (`c-ready`, mode `"Subtitles"`, all 10 controls)
- `.aw-floating-bar`: `x = 16, y = 8, right = 384, bottom = 82, width = 368, height = 74`
- `.aw-frame` / `.aw-canvas`: `x = 16, y = 92, right = 384, bottom = 299, width = 368, height = 207` (`bar.bottom = 82 <= canvas.y = 92`, **0 px overlap**)
- `scrollWidth = 400 <= innerWidth = 400`

| Tab Stop | Control | Row | `x` (px) | `y` (px) | `right` (px) | `bottom` (px) | `w × h` (px) | Inside Viewport? | Uncovered (`elementFromPoint`)? | Touch Height `>= 32`? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 0 | `♫ Audio` | 1 | 41.64 | 9.00 | 103.97 | 45.00 | `62.33 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 1 | `💬 Subtitle` | 1 | 105.97 | 9.00 | 184.14 | 45.00 | `78.17 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 2 | `Subtitles ▾` | 1 | 195.14 | 9.00 | 269.09 | 45.00 | `73.95 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 3 | `Storybook ▾` | 1 | 278.09 | 9.00 | 360.36 | 45.00 | `82.27 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 4 | `−` (Decrease size) | 2 | 34.50 | 45.00 | 58.50 | 81.00 | `24.00 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 5 | `+` (Increase size) | 2 | 86.50 | 45.00 | 110.50 | 81.00 | `24.00 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 6 | `Subtitle colors` | 2 | 120.50 | 45.00 | 166.50 | 81.00 | `46.00 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 7 | `Transparency` | 2 | 175.50 | 45.00 | 202.50 | 81.00 | `27.00 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 8 | `Position ▾` | 2 | 211.50 | 45.00 | 282.27 | 81.00 | `70.77 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 9 | `Standard ▾` | 2 | 291.27 | 45.00 | 366.50 | 81.00 | `75.23 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |

#### B. Plates — Open Popover Measurements at 400 px (`400×800`)

| Popover | Dialog Selector | `x` (px) | `y` (px) | `right` (px) | `bottom` (px) | `w × h` (px) | Inside Viewport? | Uncovered? | Escape & Outside-Click Dismiss? |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `captions` | `[role="dialog"][aria-label="Subtitle mode"]` | 65.00 | 89.00 | 335.00 | 321.00 | `270 × 232` | PASS | PASS | PASS |
| `style` | `[role="dialog"][aria-label="Subtitle style"]` | 55.00 | 89.00 | 345.00 | 361.39 | `290 × 272.39` | PASS | PASS | PASS |
| `colors` | `[role="dialog"][aria-label="Colors"]` | 65.00 | 89.00 | 335.00 | 261.00 | `270 × 172` | PASS | PASS | PASS |
| `opacity` | `[role="dialog"][aria-label="Transparency"]` | 95.00 | 89.00 | 305.00 | 159.00 | `210 × 70` | PASS | PASS | PASS |
| `position` | `[role="dialog"][aria-label*="subtitle position"]` | 65.00 | 89.00 | 335.00 | 344.00 | `270 × 255` | PASS | PASS | PASS |
| `quality` | `[role="dialog"][aria-label="Preview quality"]` | 65.00 | 89.00 | 335.00 | 321.00 | `270 × 232` | PASS | PASS | PASS |

#### C. Plates — Audio Tab (`e-audio-open`, all 7 controls) at 400 px (`400×800`)
- `.aw-floating-bar`: `x = 16, y = 8, right = 384, bottom = 82, width = 368, height = 74`
- `.aw-frame` / `.aw-canvas`: `x = 16, y = 92, right = 384, bottom = 299, width = 368, height = 207` (`bar.bottom = 82 <= canvas.y = 92`, **0 px overlap**)

| Tab Stop | Control | Row | `x` (px) | `y` (px) | `right` (px) | `bottom` (px) | `w × h` (px) | Inside Viewport? | Uncovered (`elementFromPoint`)? | Touch Height `>= 32`? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 0 | `♫ Audio` | 1 | 128.75 | 9.00 | 191.08 | 45.00 | `62.33 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 1 | `💬 Subtitle` | 1 | 193.08 | 9.00 | 271.25 | 45.00 | `78.17 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |
| 2 | `Voice` | 2 | 44.30 | 45.00 | 92.13 | 81.00 | `47.83 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 3 | `Music` | 2 | 95.13 | 45.00 | 145.72 | 81.00 | `50.59 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 4 | `SFX` | 2 | 148.72 | 45.00 | 189.09 | 81.00 | `40.38 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 5 | `Transitions` | 2 | 192.09 | 45.00 | 271.45 | 81.00 | `79.36 × 36` | PASS | PASS (`BUTTON`) | PASS (`36 px`) |
| 6 | `Standard ▾` | 2 | 280.45 | 45.00 | 355.69 | 81.00 | `75.23 × 36` | PASS | PASS (`SPAN`) | PASS (`36 px`) |

#### D. HyperFrames — Subtitle Tab, Audio Tab, and Error Retry State at 400 px (`400×800`)
- **Subtitle tab (`c-ready`)**: `.aw-floating-bar` `x = 78.27, y = 8, right = 321.72, bottom = 46, w = 243.45, h = 38`; `.aw-canvas` `y = 56` (`bar.bottom = 46 <= canvas.y = 56`). Controls: `♫ Audio` (`x = 87.27..149.59, h = 36`), `💬 Subtitle` (`x = 151.59..229.77, h = 36`), `Subtitles ▾` (`x = 240.77..314.72, h = 36`). All pass.
- **Audio tab (`c-ready`)**: `.aw-floating-bar` `x = 64.53, y = 8, right = 335.45, bottom = 46, w = 270.92, h = 38`; `.aw-canvas` `y = 56`. Controls: `♫ Audio` (`x = 73.53..135.86, h = 36`), `💬 Subtitle` (`x = 137.86..216.03, h = 36`), `Voice` (`x = 227.03..274.86, h = 36`), `Music` (`x = 277.86..328.45, h = 36`). All pass.
- **Preview error (`g2-preview-error`)**: `.aw-floating-bar` `x = 16, y = 48, right = 384, bottom = 122, w = 368, h = 74`; `.aw-canvas` `y = 132`. Row 1: `♫ Audio`, `💬 Subtitle`, `Subtitles ▾`. Row 2: `Preview unavailable` + `Retry` (`h = 36`, inside viewport, uncovered, Tab-focusable).

### Four Required 400 px Capture Paths (Acceptance Criterion 2)

1. **Audio tab (400 px)**: `tools/phase3/3h-after/e-audio-open-400-light.png` (and `tools/phase3/3h-after/e-audio-open-400-dark.png`)
2. **Subtitle tab, mode Subtitles (400 px)**: `tools/phase3/3h-after/c-ready-400-light.png` (and `tools/phase3/3h-after/c-ready-400-dark.png`)
3. **Colour popover open (400 px)**: `tools/phase3/3h-after/m-subtitle-colors-400-light.png` (and `tools/phase3/3h-after/m-subtitle-colors-400-dark.png`)
4. **Position popover open (400 px)**: `tools/phase3/3h-after/o-subtitle-position-400-light.png` (and `tools/phase3/3h-after/o-subtitle-position-400-dark.png`)

---

## 5. Capture Comparisons

### A. Plates Captures: `tools/phase3/3h-before` vs `tools/phase3/3h-after`

- **All 34 `1280 px` captures (`a-prep-drawing` through `q-plate-final-approved`, light & dark)**: **34 / 34 PASS with `0` differing pixels (`0.0000%`, `Max delta = 0`)**.
- **4 `400 px` `FinalView` captures (`k-plate-final-400-light/dark`, `q-plate-final-approved-400-light/dark`)**: **4 / 4 PASS with `0` differing pixels** (Step 4 `FinalView` does not render `OptionsBar`).
- **30 `400 px` `AnimationWorkspace` captures (15 states × 2 themes)**: Changed deliberately because `.aw-floating-bar` wraps into rows at `400 px` (pushing `.aw-frame` down by `36 px`, or `54 px` when a status badge row is also present) and anchors open `.aw-dialog` popovers inside the `400 px` viewport:

| State (400 px, light & dark) | Deliberate 400 px Change Reason |
| --- | --- |
| `a-prep-drawing-400-{light,dark}.png` | `.aw-floating-bar` wraps Subtitle controls into 2 rows + `3/5 drawn…` status chip on row 3 (`height: 92 px`), pushing the stage down by `54 px` so all controls and status text fit inside `400 px`. |
| `b-prep-error-400-{light,dark}.png` | Same 3-row wrapped bar (`Subtitle` controls + `2/5 drawn` + `Retry` button on row 3, now reachable inside `400 px` instead of clipped at `x > 680 px`). |
| `c-ready-400-{light,dark}.png` | `.aw-floating-bar` wraps the 10 Subtitle controls cleanly into 2 centered rows (`height: 74 px`), making `+`, `Subtitle colors`, `Transparency`, `Position ▾`, and `Standard ▾` visible and usable. |
| `d-comments-400-{light,dark}.png` | Same 2-row wrapped Subtitle bar as `c-ready-400`. |
| `e-audio-open-400-{light,dark}.png` | `.aw-floating-bar` wraps `.aw-mode-tabs` on row 1 and `Voice`, `Music`, `SFX`, `Transitions`, `|`, `Standard ▾` on row 2, eliminating the overlap where `Standard ▾` previously covered `SFX` and `Transitions`. |
| `f-subtitle-style-400-{light,dark}.png` | 2-row wrapped Subtitle bar + `Subtitle Style` dialog (`290 px` wide) anchored to `.aw-floating-bar` at `x = 55..345, y = 89` above `.aw-dim-rail` instead of overflowing to `right = 447.58 px`. |
| `g-token-modal-400-{light,dark}.png` | Background workspace under the token modal backdrop has the 2-row wrapped bar. |
| `h-scene-updating-400-{light,dark}.png` | 3-row wrapped Subtitle bar with `3/5 drawn…` status chip visible on row 3 instead of clipped at `x = 686.72 px`. |
| `i-aspect-picker-400-{light,dark}.png` | 2-row wrapped Subtitle bar above the `9:16` stage with open dimension rail. |
| `j-hover-volume-fullscreen-400-{light,dark}.png` | 2-row wrapped Subtitle bar above the stage with volume slider revealed. |
| `l-subtitle-mode-400-{light,dark}.png` | 2-row wrapped Subtitle bar + `Subtitle Mode` dialog centered on the bar at `x = 65..335, y = 89` (below row 2 instead of covering row 2). |
| `m-subtitle-colors-400-{light,dark}.png` | 2-row wrapped Subtitle bar + `Subtitle Colors` dialog centered at `x = 65..335, y = 89` above `.aw-dim-rail` instead of clipped off-screen at `x = 319.72..589.72 px`. |
| `n-subtitle-opacity-400-{light,dark}.png` | 2-row wrapped Subtitle bar + `Transparency` dialog centered at `x = 95..305, y = 89` instead of off-screen at `x = 395.22..605.22 px`. |
| `o-subtitle-position-400-{light,dark}.png` | 2-row wrapped Subtitle bar + `Subtitle Position` dialog centered at `x = 65..335, y = 89` above `.aw-dim-rail` instead of completely off-screen at `x = 423.09..693.09 px`. |
| `p-aspect-drawing-400-{light,dark}.png` | 3-row wrapped Subtitle bar (with drawing status chip) above the `9:16` stage. |

### B. HyperFrames Captures: `tools/phase3/hf-after` vs `tools/phase3/3h-hf-after`

- **All 24 `1280 px` captures**: **23 / 24 PASS with `0` differing pixels**, and `g3-applying-comments-1280-light.png` has `2` differing pixels (`Max delta = 7`) of HyperFrames player raster noise. The HyperFrames bar at `1280 px` is 100% pixel-identical across all 24 captures.
- **22 non-error `400 px` captures**: **20 / 22 PASS with `0` differing pixels** (including `c-ready-400-light/dark`, `d-comments-400-light`, `e-token-modal-400-light/dark`, `f-scene-selected-400-light/dark`, `g3-applying-comments-400-dark`, `g4-portrait-9x16-400-light/dark`, and all prep screens), and 2 captures (`d-comments-400-dark.png`: `35 px` >2 levels, `g3-applying-comments-400-light.png`: `32 px` >2 levels) have `32–35 px` (`<= 56 px`) of player noise.
- **2 `g2-preview-error-400-{light,dark}.png` captures**: Deliberately changed because `g2-preview-error` renders `statusBadge` (`Preview unavailable` + `Retry` button) inside `.aw-floating-bar`. In `hf-after/g2-preview-error-400-{light,dark}.png`, the `Retry` button overflowed `.aw-floating-bar` (`x = 394..440 px`) and was clipped off the right edge of the `400 px` viewport. With the phase 3h wrap rule, `Preview unavailable` + `Retry` wrap together onto row 2 inside `.aw-floating-bar` so `Retry` is fully visible and usable at `400 px`.

---

## 6. Verification Commands & Known Gaps

- `cd frontend && npm run typecheck`: **PASS** (`0` errors).
- `node frontend/test/workspace-bar-narrow.mjs`: **PASS** (`1/1` passed in ~19 s).
- `cd frontend && npm test`: **PASS** (`197/198` in parallel run; `live-predraw-chrome.mjs` rerun standalone via `node --test test/live-predraw-chrome.mjs` **PASS** `1/1`).
- `node tools/phase3/capture.mjs tools/phase3/3h-after && node tools/phase3/compare.mjs tools/phase3/3h-before tools/phase3/3h-after tools/phase3/3h-diff`: **34/34 `1280 px` captures 0-pixel identical**.
- `node tools/phase3/capture-hf.mjs tools/phase3/3h-hf-after && node tools/phase3/compare.mjs tools/phase3/hf-after tools/phase3/3h-hf-after tools/phase3/3h-hf-diff`: **43/46 non-error captures 0-pixel identical, 3 with 2–35 px (`<= 56 px`) player noise, plus the 2 deliberate `g2-preview-error-400` fixes**.
- **Known gaps**: None.
