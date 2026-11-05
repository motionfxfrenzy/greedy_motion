# Tooling Follow-Ups Report: Engine Identity Cold-Frame Flag & HyperFrames Comments-Panel Pixel Diffs

Date: 2026-11-06  
Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-followups-tools` (`codex/followups-tools`, from `20585df`)

---

## Part 1: Plate Engine Identity Tool (`tools/phase3/engine-identity.mjs`)

### 1.1 Reproduction on `fixture:balloon-0@9:16` Across 10 Fresh Pages (`--gpu`)

Under `/Users/osamaehsaan/Code/Market_apps/.lock-timing`, `fixture:balloon-0@9:16` (`small` `360x640` and `full` `1080x1920`) was run across **10 fresh browser pages** for both the **OLD engine (`23e1963`)** and the **NEW engine (`HEAD` / `0.6.5`)** in `--gpu` mode, recording the FNV pixel hash of frame `0` for:
1. **First draw (`Draw 1`)** right after `window.FILM.mount(scale)`,
2. **Each of the next 4 draws of the same frame `0` (`Draws 2..5`)**, and
3. **Each of the next 4 draws of frame `0` after drawing frame `1` (`d18f2998` small / `87ee7dd4` full) and seeking back to frame `0`**.

#### 10-Page Frame-0 Hash Counts for `fixture:balloon-0@9:16` (`--gpu`)

| Size | Engine | Draw 1 (Cold 1st Draw) | Draw 2 (+1 after Draw 1) | Draw 3 (+2) | Draw 4 (+3) | Draw 5 (+4) | Frame 1 Hash | Draws 1..4 of Frame 0 After Frame 1 | Frames `26, 52, 78, 104` |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `small` (`360x640`) | OLD (`23e1963`) | `bc276fb9` (10/10) | `bc276fb9` (9/10), **`c3ad9c5f` (1/10, p6)** | `bc276fb9` (10/10) | `bc276fb9` (10/10) | `bc276fb9` (10/10) | `d18f2998` (10/10) | `bc276fb9` (40/40 across 10 pages) | `a53855b3, 34995a1d, d3e969b5, 317c6dda` (10/10) |
| `small` (`360x640`) | NEW (`0.6.5`) | `bc276fb9` (10/10) | `bc276fb9` (10/10) *(and `c3ad9c5f` in prior full-suite run)* | `bc276fb9` (10/10) | `bc276fb9` (10/10) | `bc276fb9` (10/10) | `d18f2998` (10/10) | `bc276fb9` (40/40 across 10 pages) | `a53855b3, 34995a1d, d3e969b5, 317c6dda` (10/10) |
| `full` (`1080x1920`) | OLD (`23e1963`) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `87ee7dd4` (10/10) | `e8257f3f` (40/40 across 10 pages) | `ceab5b0f, bac1f57c, 45b146a1, 56461de2` (10/10) |
| `full` (`1080x1920`) | NEW (`0.6.5`) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `e8257f3f` (10/10) | `87ee7dd4` (10/10) | `e8257f3f` (40/40 across 10 pages) | `ceab5b0f, bac1f57c, 45b146a1, 56461de2` (10/10) |

### 1.2 Root Cause of Frame 0 Being Two-Valued on Draw 2 (`c3ad9c5f` vs `bc276fb9`)

Inspection of `packages/plate-engine/test/fixtures/balloon-0.ts`, `packages/plate-engine/src/canvas-core/core.ts`, `packages/plate-engine/src/hosts/page.ts`, and the 10-page diagnostic run above establishes the exact mechanism:

1. **What happens on Draw 1 (`firstHash`, the 1st warm-up draw after `mount(scale)`):**
   - `window.FILM.mount(scale)` resizes `<canvas id="film">` (`360x640` at `scale = 640/1920 = 1/3`) and resets `env.cache = new Map()`. Because `meta.raster` is not `"cpu"`, `<canvas id="film">` starts as a GPU-backed 2D canvas (`CanvasResourceProviderSharedImage`).
   - In `balloon-0.ts`, `sky(g, 0)` and `sea(g, 0)` compute 7 cached `hatchRuns` scribble arrays (`cache: true` on lines `48, 49, 53, 54, 55, 70, 71`, taking `~75 ms` of CPU time on Draw 1) and store them in `env.cache`.
   - `wax(g, fn)` (`g.group("plain", fn, { textures: ["pencilTooth"] })`) allocates a new `OffscreenCanvas(360, 640)` layer `L` (with `L.dirty = null`, so the first `sky()` call does not call `clearRect`), and `tile(env, "pencilTooth")` + `tile(env, "paper")` allocate two `OffscreenCanvas(171, 171)` texture tiles and upload their pixel data via `putImageData`.
   - At the end of Draw 1, `seek(0)` calls `ctx.getImageData(0, 0, 1, 1)` (readback #1) and `hash()` calls `ctx.getImageData(0, 0, 360, 640)` (readback #2). Those readbacks trigger Chromium Blink's readback heuristic (`WillReadFrequently`), demoting `<canvas id="film">` from GPU rasterization to CPU software rasterization.

2. **Why Draw 2 (`next4Same[0]`, previously recorded as `hashes[0]`) is a transitional draw that can flip to `c3ad9c5f`:**
   - Draw 2 is the **first draw after `<canvas id="film">` is demoted to CPU** AND the **first draw that hits `env.cache`** for all 7 `cache: true` scribble arrays, the pooled GPU `OffscreenCanvas(360, 640)` layer `L` (now popped from `Gfx.pool` with a non-null `L.dirty = r_boat` cleared via `L.ctx.clearRect`), and the two `OffscreenCanvas(171, 171)` pattern tiles (`pencilTooth` and `paper`).
   - Because Draw 2 skips the `~75 ms` CPU `hatchRuns` computation and `putImageData` tile generation, it immediately composites the GPU `OffscreenCanvas` layer `L` onto the newly-demoted CPU `<canvas id="film">` in `~25 ms`. On that first post-demotion / first warm-cache cycle (Draw 2), the GPU-to-CPU `OffscreenCanvas` composite occasionally yields `c3ad9c5f` (observed on Page 6 of OLD in the 10-page standalone test above, and on both OLD and NEW in the full 67-item browser session) before settling on `bc276fb9` for all subsequent draws (**Draws 3, 4, 5 are `bc276fb9` on 10/10 OLD pages and 10/10 NEW pages**, and **all 4 draws of frame 0 after drawing frame 1 are `bc276fb9` on 10/10 OLD pages and 10/10 NEW pages**).
   - The exact same Draw-2 transitional behaviour was also observed on `lighthouse@1:1` (`small` `640x640`), where Page 3 of OLD gave `4237c42b` on Draw 1, flipped to `e7526e5a` on Draw 2 (`next5Draws[0]`), and then stayed on `4237c42b` across Draws 3, 4, 5, and 6 (`10/10` pages, `40/40` draws).

### 1.3 10-Page Stability Across All Four Known Flip Items With 2 Discarded Warm-Up Draws (`WARMUP_DRAWS = 2`)

| Item | Size | Engine | Draw 1 (Cold 1st Draw, Informational) | Draw 2 (2nd Warm-Up Draw, Discarded) | Draw 3 (1st Compared Draw `hashes[0]` at `WARMUP_DRAWS = 2`) | Draws 4..6 (Subsequent Warm Draws) | Old == New at `WARMUP_DRAWS = 2`? |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :---: |
| `fixture:balloon-0@9:16` | `360x640` | OLD | `bc276fb9` (10/10) | `bc276fb9` (9/10), `c3ad9c5f` (1/10) | **`bc276fb9` (10/10)** | `bc276fb9` (20/20; + 40/40 after frame 1) | **YES (`10/10`)** |
| `fixture:balloon-0@9:16` | `360x640` | NEW | `bc276fb9` (10/10) | `bc276fb9` (10/10) | **`bc276fb9` (10/10)** | `bc276fb9` (20/20; + 40/40 after frame 1) | **YES (`10/10`)** |
| `fixture:balloon-0@9:16` | `1080x1920` | OLD | `e8257f3f` (10/10) | `e8257f3f` (10/10) | **`e8257f3f` (10/10)** | `e8257f3f` (20/20; + 40/40 after frame 1) | **YES (`10/10`)** |
| `fixture:balloon-0@9:16` | `1080x1920` | NEW | `e8257f3f` (10/10) | `e8257f3f` (10/10) | **`e8257f3f` (10/10)** | `e8257f3f` (20/20; + 40/40 after frame 1) | **YES (`10/10`)** |
| `lighthouse@16:9` | `640x360` | OLD | `405fd0e3` (10/10) | `405fd0e3` (10/10) | **`405fd0e3` (10/10)** | `405fd0e3` (29/30), `99bc9560` (1/30) | **YES (`10/10`)** |
| `lighthouse@16:9` | `640x360` | NEW | `405fd0e3` (9/10), `ec8fce48` (1/10) | `405fd0e3` (10/10) | **`405fd0e3` (10/10)** | `405fd0e3` (30/30) | **YES (`10/10`)** |
| `lighthouse@16:9` | `1920x1080` | OLD | `e4dd5f94` (5/10), `3697e3b2` (5/10) | `e4dd5f94` (10/10) | **`e4dd5f94` (10/10)** | `e4dd5f94` (30/30) | **YES (`10/10`)** |
| `lighthouse@16:9` | `1920x1080` | NEW | `3697e3b2` (7/10), `e4dd5f94` (3/10) | `e4dd5f94` (10/10) | **`e4dd5f94` (10/10)** | `e4dd5f94` (29/30), `962f1af` (1/30) | **YES (`10/10`)** |
| `lighthouse@1:1` | `640x640` | OLD | `4237c42b` (10/10) | `4237c42b` (9/10), `e7526e5a` (1/10) | **`4237c42b` (10/10)** | `4237c42b` (30/30) | **YES (`10/10`)** |
| `lighthouse@1:1` | `640x640` | NEW | `4237c42b` (10/10) | `4237c42b` (10/10) | **`4237c42b` (10/10)** | `4237c42b` (30/30) | **YES (`10/10`)** |
| `lighthouse@1:1` | `1080x1080` | OLD | `a9c03be8` (10/10) | `a9c03be8` (10/10) | **`a9c03be8` (10/10)** | `a9c03be8` (30/30) | **YES (`10/10`)** |
| `lighthouse@1:1` | `1080x1080` | NEW | `86d09c95` (10/10) | `a9c03be8` (10/10) | **`a9c03be8` (10/10)** | `a9c03be8` (30/30) | **YES (`10/10`)** |
| `moonPhases@1:1` | `640x640` | OLD | `bc530dce` (9/10), `78449fd1` (1/10) | `4a663266` (10/10) | **`4a663266` (10/10)** | `4a663266` (30/30) | **YES (`10/10`)** |
| `moonPhases@1:1` | `640x640` | NEW | `bc530dce` (9/10), `78449fd1` (1/10) | `4a663266` (10/10) | **`4a663266` (10/10)** | `4a663266` (30/30) | **YES (`10/10`)** |
| `moonPhases@1:1` | `1080x1080` | OLD | `f39c561e` (10/10) | `ddb94e5c` (10/10) | **`ddb94e5c` (10/10)** | `ddb94e5c` (30/30) | **YES (`10/10`)** |
| `moonPhases@1:1` | `1080x1080` | NEW | `f39c561e` (10/10) | `ddb94e5c` (10/10) | **`ddb94e5c` (10/10)** | `ddb94e5c` (30/30) | **YES (`10/10`)** |

### 1.4 Changes Made to `tools/phase3/engine-identity.mjs`

1. **Minimum warm-up count set to `WARMUP_DRAWS = 2`:**
   - Warm-up Draw 1 (`window.FILM.seek(hashIdx[0]); window.FILM.hash()`) is timed (`firstMs`) and hashed (`firstHash`) for the informational `coldFirstDraw` report.
   - Warm-up Draw 2 (`window.FILM.seek(hashIdx[0]); window.FILM.hash()`) completes the post-demotion / warm-cache GPU composite before the 5 compared verification frames (`0, 1/4, 1/2, 3/4, last`) are drawn and hashed.
2. **Added `--items <comma-list>` CLI filter:**
   - Supports filtering by item ID (`--items fixture:balloon-0@9:16` or `--items lighthouse@16:9,moonPhases@1:1`) in addition to `--styles`.
3. **Added top-level `coldFirstDraw` informational section:**
   - Records `warmupDrawsDiscarded`, `smallIdenticalCount`, `fullIdenticalCount`, `total`, and per-item `{ small, full }` cold first-draw hashes and timings without ever affecting `allIdentical`.
4. **Retry-vote guard for single-draw transient GPU blips:**
   - In `--gpu` mode, if a 1-in-40 single-draw GPU riso-drum blip occurs on the initial page of `NEW` while all 3 fresh retry pages of `NEW` (`rn2`) match `oldMode` (`newMode === oldMode && rn2.every(h => h === oldMode)`), it is classified as a transient GPU raster blip rather than a false `"REAL DIFFERENCE"`. Real old/new differences continue to fail strictly.

### 1.5 Final Verification Runs (Software + Two Consecutive GPU Runs Under `.lock-timing`)

| Run | Command | `items` | `skipped` | `allIdentical` | Rows Needing Retry | `coldFirstDraw` Small Identical | `coldFirstDraw` Full Identical | Output Saved To |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Software** | `node tools/phase3/engine-identity.mjs --out ...` | `67/67` | `[]` (`0`) | **`true`** | `0` (`[]`) | `67/67` (`100%`) | `67/67` (`100%`) | `docs/phase3/engine-identity-result.json` |
| **GPU Run 1** | `node tools/phase3/engine-identity.mjs --gpu --out ...` | `67/67` | `[]` (`0`) | **`true`** | `0` (`[]`) | `65/67` | `66/67` | (verified in `.scratch/gpu1.json`) |
| **GPU Run 2** | `node tools/phase3/engine-identity.mjs --gpu --out ...` | `67/67` | `[]` (`0`) | **`true`** | `0` (`[]`) | `64/67` | `66/67` | `docs/phase3/engine-identity-result-gpu.json` |

#### Cold First-Draw (`coldFirstDraw`) Differences Summary Across the Final Runs

All cold first-draw differences in `--gpu` mode occur exclusively on `lighthouse` and `moonPhases@1:1` (the exact cold-GPU Draw 1 hash pairs documented in Section 1.3), and never affect `allIdentical`:

| Run | Item | Size | `oldFirstHash` | `newFirstHash` | `oldFirstMs` | `newFirstMs` | Warm Compared `hashes[0]` (Old == New) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Software** | *(none — all 67/67 small & 67/67 full identical)* | — | — | — | — | — | — |
| **GPU Run 1** | `lighthouse@1:1` | `640x640` (`small`) | `4237c42b` | `4d5962ef` | `344.1 ms` | `258.5 ms` | `4237c42b` (`identical: true`) |
| **GPU Run 1** | `moonPhases@1:1` | `640x640` (`small`) | `bc530dce` | `78449fd1` | `131.8 ms` | `117.9 ms` | `4a663266` (`identical: true`) |
| **GPU Run 1** | `lighthouse@1:1` | `1080x1080` (`full`) | `86d09c95` | `a9c03be8` | `480.4 ms` | `368.2 ms` | `a9c03be8` (`identical: true`) |
| **GPU Run 2** | `lighthouse@16:9` | `640x360` (`small`) | `405fd0e3` | `943de533` | `298.0 ms` | `201.1 ms` | `405fd0e3` (`identical: true`) |
| **GPU Run 2** | `lighthouse@1:1` | `640x640` (`small`) | `4237c42b` | `e5a3d563` | `345.2 ms` | `254.6 ms` | `4237c42b` (`identical: true`) |
| **GPU Run 2** | `moonPhases@1:1` | `640x640` (`small`) | `bc530dce` | `78449fd1` | `129.5 ms` | `124.8 ms` | `4a663266` (`identical: true`) |
| **GPU Run 2** | `lighthouse@16:9` | `1920x1080` (`full`) | `3697e3b2` | `e4dd5f94` | `471.1 ms` | `376.8 ms` | `e4dd5f94` (`identical: true`) |

---

## Part 2: HyperFrames Comments-Panel Pixel Diffs

### 2.1 Baseline Directories & Scope

1. **History of the committed HyperFrames capture directories:**
   - `tools/phase3/hf-baseline`: Last changed in `54aed0e` (Phase 3b). Captured **before** migrating `BrowserAnimationStep` from the legacy `.ce-*` layout to the shared `AnimationWorkspace` (`.aw-*`) shell. Every post-3b capture differs from `hf-baseline` across all 48 files by `15%–91%` of pixels (`48,134` to `936,874` pixels, `maxDelta = 87..255`).
   - `tools/phase3/hf-after`: Last changed in `54aed0e` (Phase 3b). Captured **after** migrating `BrowserAnimationStep` to `AnimationWorkspace`, before Phase 3h (`ec3ba9c`). Because `88d4efa` (`c760509^`), `c760509`, and `7ba5f0c` are on the `codex/live-scenes` branch prior to merging Phase 3h (`ec3ba9c`), **`tools/phase3/hf-after` is the matching post-3b baseline for `88d4efa`, `c760509`, and `7ba5f0c`**.
   - `tools/phase3/3h-hf-after`: Last changed in `ec3ba9c` (Phase 3h). Includes the deliberate Phase 3h `@media (max-width: 560px)` options-bar wrap on `g2-preview-error-400-{light,dark}.png`. Because `HEAD` (`20585df` / `7555f46`) merges Phase 3h (`ec3ba9c`) with Phase 4a (`3b4564f`), **`tools/phase3/3h-hf-after` is the matching baseline for `HEAD`** (and `tools/phase3/hf-after` matches `HEAD` on all 46 non-`g2-preview-error-400` files).
   - `tools/phase3/hf-final-baseline` & `tools/phase3/hf-final-after` (`capture-final.mjs`, last changed in `2899052`, Phase 3e): Inspected `frontend/components/final-render-step.tsx` and `frontend/components/animation-workspace/FinalView.tsx`. Step 4 (`FinalRenderStep` / `FinalView`) renders the MP4 video review stage and download actions and **never renders `CommentsPanel`**.

### 2.2 3-Run Capture Tables Across `88d4efa` (`c760509^`), `c760509`, `7ba5f0c`, and `HEAD`

Each of the four commits was extracted into `tools/phase3/.scratch/repo-<commit>` via `git archive` (with `node_modules` symlinked read-only to `../VideoSaaS-engine/node_modules`) and captured **three times** with `tools/phase3/capture-hf.mjs` under `/Users/osamaehsaan/Code/Market_apps/.lock-timing` (12 runs $\times$ 48 PNGs = 576 PNGs).

Across all 12 runs (576 images), **39 of the 48 images had `0` differing pixels (`maxDelta = 0`) in every single run** against `hf-after` and `3h-hf-after`. The table below lists every image that had `> 0` differing pixels in any run (plus all 8 comments-panel state files `d-comments-*` and `g3-applying-comments-*`), formatted as **`over2 / any (maxDelta)`**:

#### A. Comparison Against `tools/phase3/hf-after` (Phase 3b Post-Adapter Baseline)

| State File | `88d4efa` (`c760509^`) Run 1 / Run 2 / Run 3 | `c760509` (Phase 4a) Run 1 / Run 2 / Run 3 | `7ba5f0c` (Phase 4a v2) Run 1 / Run 2 / Run 3 | `HEAD` Run 1 / Run 2 / Run 3 |
| :--- | :---: | :---: | :---: | :---: |
| `d-comments-1280-light.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | **`2/4 (7)`** / `0/0 (0)` / `0/0 (0)` |
| `d-comments-1280-dark.png` | `0/0 (0)` / `0/0 (0)` / **`2/4 (6)`** | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | **`2/4 (6)`** / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `d-comments-400-light.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / **`56/176 (17)`** / **`56/176 (17)`** | `0/0 (0)` / **`56/176 (17)`** / `0/2 (1)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `d-comments-400-dark.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | **`35/155 (18)`** / `0/2 (2)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `g3-applying-comments-1280-light.png` | `0/0 (0)` / **`4/7 (18)`** / `0/0 (0)` | `0/0 (0)` / **`4/7 (18)`** / `0/0 (0)` | **`2/2 (7)`** / **`4/7 (18)`** / **`4/7 (18)`** | `0/0 (0)` / **`2/5 (18)`** / `0/0 (0)` |
| `g3-applying-comments-1280-dark.png` | **`2/7 (15)`** / `0/0 (0)` / `0/0 (0)` | **`2/5 (15)`** / **`2/7 (15)`** / **`2/7 (15)`** | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / **`2/7 (15)`** / **`2/7 (15)`** |
| `g3-applying-comments-400-light.png` | `0/0 (0)` / **`32/138 (17)`** / `0/0 (0)` | `0/0 (0)` / **`32/138 (17)`** / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `g3-applying-comments-400-dark.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `g2-preview-error-400-light.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `136996/145323 (255)` *(3h wrap)* |
| `g2-preview-error-400-dark.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `133745/142112 (244)` *(3h wrap)* |
| **All other 38 files** | **`0/0 (0)` on all 3 runs** | **`0/0 (0)` on all 3 runs** | **`0/0 (0)` on all 3 runs** | **`0/0 (0)` on all 3 runs** |

#### B. Comparison Against `tools/phase3/3h-hf-after` (Phase 3h Baseline)

Note that `3h-hf-after` itself was captured with `d-comments-400-dark.png` in the `35/155 (max 18)` partial-raster state and `g3-applying-comments-400-light.png` in the `32/138 (max 17)` partial-raster state, so comparing against `3h-hf-after` simply inverts which of the two states reads as `0/0` vs `35/155` / `32/138`:

| State File | `88d4efa` (`c760509^`) Run 1 / Run 2 / Run 3 | `c760509` (Phase 4a) Run 1 / Run 2 / Run 3 | `7ba5f0c` (Phase 4a v2) Run 1 / Run 2 / Run 3 | `HEAD` Run 1 / Run 2 / Run 3 |
| :--- | :---: | :---: | :---: | :---: |
| `d-comments-1280-light.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | **`2/4 (7)`** / `0/0 (0)` / `0/0 (0)` |
| `d-comments-1280-dark.png` | `0/0 (0)` / `0/0 (0)` / **`2/4 (6)`** | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | **`2/4 (6)`** / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `d-comments-400-light.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / **`56/176 (17)`** / **`56/176 (17)`** | `0/0 (0)` / **`56/176 (17)`** / `0/2 (1)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `d-comments-400-dark.png` | **`35/155 (18)`** / **`35/155 (18)`** / **`35/155 (18)`** | `0/0 (0)` / **`35/157 (18)`** / **`35/155 (18)`** | **`35/155 (18)`** / **`35/155 (18)`** / **`35/155 (18)`** | **`35/155 (18)`** / **`35/155 (18)`** / **`35/155 (18)`** |
| `g3-applying-comments-1280-light.png` | **`2/2 (7)`** / **`2/5 (18)`** / **`2/2 (7)`** | **`2/2 (7)`** / **`2/5 (18)`** / **`2/2 (7)`** | `0/0 (0)` / **`2/5 (18)`** / **`2/5 (18)`** | **`2/2 (7)`** / **`4/7 (18)`** / **`2/2 (7)`** |
| `g3-applying-comments-1280-dark.png` | **`2/7 (15)`** / `0/0 (0)` / `0/0 (0)` | **`2/5 (15)`** / **`2/7 (15)`** / **`2/7 (15)`** | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / **`2/7 (15)`** / **`2/7 (15)`** |
| `g3-applying-comments-400-light.png` | **`32/138 (17)`** / `0/0 (0)` / **`32/138 (17)`** | **`32/138 (17)`** / `0/0 (0)` / **`32/138 (17)`** | **`32/138 (17)`** / **`32/138 (17)`** / **`32/138 (17)`** | **`32/138 (17)`** / **`32/138 (17)`** / **`32/138 (17)`** |
| `g3-applying-comments-400-dark.png` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` | `0/0 (0)` / `0/0 (0)` / `0/0 (0)` |
| `g2-preview-error-400-light.png` | `136996/145323 (255)` | `136996/145323 (255)` | `136996/145323 (255)` | **`0/0 (0)` on all 3 runs** |
| `g2-preview-error-400-dark.png` | `133745/142112 (244)` | `133745/142112 (244)` | `133745/142112 (244)` | **`0/0 (0)` on all 3 runs** |
| **All other 38 files** | **`0/0 (0)` on all 3 runs** | **`0/0 (0)` on all 3 runs** | **`0/0 (0)` on all 3 runs** | **`0/0 (0)` on all 3 runs** |

#### C. Within-Commit Pairwise Comparisons (`Run 1 vs Run 2`, `Run 1 vs Run 3`, `Run 2 vs Run 3`)

| Commit | State File | `Run 1 vs Run 2` | `Run 1 vs Run 3` | `Run 2 vs Run 3` | Repeatable Within Commit? |
| :---: | :--- | :---: | :---: | :---: | :---: |
| **`88d4efa`** | `d-comments-1280-dark.png` | `0/0 (0)` | `2/4 (6)` | `2/4 (6)` | **NO** (flips between runs of `88d4efa`) |
| **`88d4efa`** | `g3-applying-comments-1280-dark.png` | `2/7 (15)` | `2/7 (15)` | `0/0 (0)` | **NO** (flips between runs of `88d4efa`) |
| **`88d4efa`** | `g3-applying-comments-1280-light.png` | `4/7 (18)` | `0/0 (0)` | `4/7 (18)` | **NO** (flips between runs of `88d4efa`) |
| **`88d4efa`** | `g3-applying-comments-400-light.png` | `32/138 (17)` | `0/0 (0)` | `32/138 (17)` | **NO** (flips between runs of `88d4efa`) |
| **`c760509`** | `d-comments-400-dark.png` | `35/157 (18)` | `35/155 (18)` | `0/2 (2)` | **NO** (flips between runs of `c760509`) |
| **`c760509`** | `d-comments-400-light.png` | `56/176 (17)` | `56/176 (17)` | `0/0 (0)` | **NO** (flips between runs of `c760509`) |
| **`c760509`** | `g3-applying-comments-1280-dark.png` | `0/2 (1)` | `0/2 (1)` | `0/0 (0)` | **NO** (flips between runs of `c760509`) |
| **`c760509`** | `g3-applying-comments-1280-light.png` | `4/7 (18)` | `0/0 (0)` | `4/7 (18)` | **NO** (flips between runs of `c760509`) |
| **`c760509`** | `g3-applying-comments-400-light.png` | `32/138 (17)` | `0/0 (0)` | `32/138 (17)` | **NO** (flips between runs of `c760509`) |
| **`7ba5f0c`** | `d-comments-1280-dark.png` | `2/4 (6)` | `2/4 (6)` | `0/0 (0)` | **NO** (flips between runs of `7ba5f0c`) |
| **`7ba5f0c`** | `d-comments-400-light.png` | `56/176 (17)` | `0/2 (1)` | `56/178 (17)` | **NO** (flips between runs of `7ba5f0c`) |
| **`7ba5f0c`** | `g3-applying-comments-1280-light.png` | `2/5 (18)` | `2/5 (18)` | `0/0 (0)` | **NO** (flips between runs of `7ba5f0c`) |
| **`HEAD`** | `d-comments-1280-light.png` | `2/4 (7)` | `2/4 (7)` | `0/0 (0)` | **NO** (flips between runs of `HEAD`) |
| **`HEAD`** | `g3-applying-comments-1280-dark.png` | `2/7 (15)` | `2/7 (15)` | `0/0 (0)` | **NO** (flips between runs of `HEAD`) |
| **`HEAD`** | `g3-applying-comments-1280-light.png` | `2/5 (18)` | `0/0 (0)` | `2/5 (18)` | **NO** (flips between runs of `HEAD`) |

#### D. Comparison Against `tools/phase3/hf-baseline` (Pre-3b `.ce-*` Baseline, For Completeness)

Against `hf-baseline` (the old `.ce-*` layout before Phase 3b), all 48 files fail on all 4 commits (`0/48` pass); for the 8 comments-panel state files:
- `d-comments-1280-light.png`: `614,465 / 618,897 (maxDelta = 255)` across all 12 runs
- `d-comments-1280-dark.png`: `627,341 / 636,332 (maxDelta = 246)` across all 12 runs
- `d-comments-400-light.png`: `267,058–267,059 / 268,404 (maxDelta = 255)` across all 12 runs
- `d-comments-400-dark.png`: `259,198–259,219 / 267,886–267,887 (maxDelta = 246)` across all 12 runs
- `g3-applying-comments-1280-light.png`: `611,842 / 616,091 (maxDelta = 255)` across all 12 runs
- `g3-applying-comments-1280-dark.png`: `624,089 / 633,314 (maxDelta = 246)` across all 12 runs
- `g3-applying-comments-400-light.png`: `257,061 / 258,137 (maxDelta = 255)` across all 12 runs
- `g3-applying-comments-400-dark.png`: `249,394 / 257,018 (maxDelta = 246)` across all 12 runs

---

### 2.3 Introducing Commit, Root Cause Mechanism, and Confirming One-Line Experiment

#### 1. Which commit introduced the behavior?
- **Commit `54aed0e` (Phase 3b)** — when `tools/phase3/capture-hf.mjs` and the `d-comments` / `g3-applying-comments` interactive capture steps were created — **not** Phase 4a (`c760509` or `7ba5f0c`).
- Direct proof from commit history and the 3-run table above:
  1. `88d4efa` (`c760509^`, immediately before Phase 4a) already produces the exact same `32/138 (max 17)`, `35/155 (max 18)`, `4/7 (max 18)`, `2/7 (max 15)`, and `2/4 (max 6)` diffs between runs of the same commit.
  2. `docs/phase3/3b-report.md` (line 108, committed in `54aed0e`) and `docs/phase3/3h-report.md` (lines 192–193, committed in `ec3ba9c` before Phase 4a was merged) both recorded the exact same `2` to `35` px (`maxDelta = 7..18`) diffs on `d-comments` and `g3-applying-comments` in `tools/phase3/3h-hf-diff/`.

#### 2. Why `CommentsPanel.tsx` changes in `88d4efa..c760509` and `c760509..7ba5f0c` have zero visual effect on `d-comments` and `g3-applying-comments`:
- **`className="aw-comment-refused"` (`c760509`):**
  1. In `d-comments` and `g3-applying-comments`, neither comment has `refusedReason` set (`comment.refusedReason` is `undefined`), so the class is not applied in the DOM.
  2. **Confirmed finding:** `.aw-comment-refused` has **no CSS rule anywhere in the repository** (`grep -rn "aw-comment-refused" frontend/` matches only `CommentsPanel.tsx:142` and the test selector in `frontend/test/hf-step-interaction.mjs:558,572,573`).
- **`role="status"`, `aria-label`, `title` (`c760509` & `7ba5f0c`):** Accessibility attributes with no matching CSS selectors in `animation-workspace.css`, `styles.css`, or `theme.css`.
- **`disabled={!applySummary.scenes.length || applying}` on `.aw-apply` (`c760509`):** Evaluates to `false` in `d-comments` (2 unapplied comments) and `true` in `g3-applying-comments` (`applying = true`), identical to `!comments.length || applying`.
- **`disabled={applying}` on `button.aw-x` (`7ba5f0c`):** In `d-comments`, `applying` is `false`. In `g3-applying-comments`, `frontend/test/fixtures/hf/composition.html` was generated in `54aed0e` before `window.__bp.elementsAt` existed, so `BrowserAnimationStep.applyComments()` takes the `typeof iframeWin?.__bp?.elementsAt !== "function"` fallback path (`browser-animation-step.tsx:531-535`), which synchronously clears `timedComments` to `[]` before `await onApplySceneComments(payload)`. Thus `comments.length === 0` during `g3-applying-comments` and no `button.aw-x` is in the DOM.

#### 3. Exact mechanism of the `2 to 56 px, maxDelta = 18` corner-antialias diffs:
- `d-comments` and `g3-applying-comments` are the **only** states in `capture-hf.mjs` (`lines 482-493`) that perform multi-step post-load DOM mutations separated by `setTimeout(80)` / `setTimeout(40)` waits (`addCommentInUi` -> `seekOnTimeline(page, 6)` -> `lockPlayerAtTime(page, 6)` -> `addCommentInUi` -> `applyBtn.dispatchEvent("click")` -> `lockPlayerAtTime(page, 6)`).
- Depending on whether intermediate `setTimeout(80)` / `setTimeout(40)` frames commit before or after the final DOM mutation, Chromium's GPU tile compositor (`cc::TileManager`) either:
  - **State A (Full-tile raster):** Rasterizes the full tile (matching initial page load), or
  - **State B (Partial-raster damage rect clip):** Re-rasterizes only the damaged rect clipped to the final mutation bounds:
    - **At `400x800` (`32–56` px >2 levels, `138–176` px any diff, `maxDelta = 17..18`):** Every single differing pixel lies strictly inside the horizontal band **`y = 312..481`** (spanning from the newly inserted `.aw-pin` at `y = 312` on `.aw-track` down to `.aw-at` at `y = 481`). Above `y = 312` (`y = 0..311`) and below `y = 481` (`y = 482..799` — including `.aw-compose textarea`, `Add`, the two `li` comment rows, and `Redraw scenes 1, 2` inside the **very same `<aside class="aw-side">` element**!) there are **0 differing pixels**. Inside `y = 312..481`, clipping the Skia GPU pass to the partial damage rect shifts rounded-corner AA coverage by 1 step ($\approx 1/16$th of local foreground-to-background contrast: `17..18` levels where blue `#0a6cff`/`#4aa0ff` meets `#ebf5ff`/`#0a0f16` at `.aw-segments li.on` corners `x = 91..94, 156..159, y = 320..363`; `6..11` levels at `button.aw-render-top` corners `y = 374..409`; `1..3` levels at `aside.aw-side` top corners `y = 423..429` and `.aw-at span` corners `y = 464..481`).
    - **At `1280x800` (`2–4` px >2 levels, `2–7` px any diff, `maxDelta = 6..18`):** The partial damage rect clips across `(933, 571)` and `(927, 577)` (the bottom-right `18px` rounded corner of `.aw-canvas`, `maxDelta = 6..7`), `(978, 614)` and `(976, 616)` (the top-left rounded corner of `button.aw-apply`, `maxDelta = 6`), and in `g3-applying-comments` across `y = 675` at `x = 203, 386, 569, 752, 935` (the 5 vertical borders of `.aw-segments li`, `maxDelta = 15..18`).

#### 4. Confirming one-line experiment in the scratch copy:
- In `tools/phase3/.scratch/repo-c760509/tools/phase3/capture-hf.mjs`, we added `args: ["--disable-partial-raster"]` to `chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ["--disable-partial-raster"] })` and ran two full 48-image captures (`cap-c760509-nopartial1` and `cap-c760509-nopartial2`) under `.lock-timing`.
- **Result:** Comparing `cap-c760509-nopartial1` vs `cap-c760509-nopartial2` with `compare.mjs` passed **48 / 48 images with `0` differing pixels (`0` any diff px, `maxDelta = 0` on all 48 images)** — the run-to-run variance on `d-comments` and `g3-applying-comments` vanished completely.

---

### 2.4 Selected Outcome and Proposals (Part 2 Step 4)

Per Part 2 Step 4, we select **Outcome (b) / plain render-state report** (no baseline recapture in `tools/phase3/hf-after` or `hf-final-after`, and no tolerance loosening in `tools/phase3/compare.mjs`, since `maxDelta = 18` is Chromium partial-raster render state and `compare.mjs` must not be loosened to admit a delta of 18):

1. **Proposal 1 — Eliminate partial-raster non-determinism in `tools/phase3/capture-hf.mjs` (1 line):**
   - Pass `args: ["--disable-partial-raster"]` to `chromium.launch` in `tools/phase3/capture-hf.mjs:308` (and `capture.mjs` / `capture-final.mjs`), then recapture the baseline once with `--disable-partial-raster` active so every state is always rasterized with full tiles (`48/48` deterministic with `0` differing pixels across runs while keeping `compare.mjs` at strict `0`-pixel tolerance).
2. **Proposal 2 — Add missing CSS rule for `.aw-comment-refused` in `frontend/app/animation-workspace.css` (1 line):**
   - `.aw-comment-refused` in `frontend/components/animation-workspace/CommentsPanel.tsx:142` currently has no CSS rule anywhere in `frontend/`. Adding `.aw-comments p small.aw-comment-refused{color:var(--d-tx-c2410c)}` in `frontend/app/animation-workspace.css` styles refused comment reasons in the workspace warning/error ink token.
3. **Proposal 3 — Regenerate `frontend/test/fixtures/hf/composition.html` via `node tools/phase3/make-hf-fixture.mjs`:**
   - `frontend/test/fixtures/hf/composition.html` was last generated in `54aed0e` before `window.__bp.elementsAt` was added to the beat-plan template, causing `g3-applying-comments` in `capture-hf.mjs` to hit the legacy no-`__bp.elementsAt` fallback branch in `BrowserAnimationStep.applyComments()`.

---

## Part 3: Anything Not Done

Nothing was skipped or left undone. All scratch worktrees and `tools/phase3/.scratch/` directories and temporary symlinks were cleaned up before completing this report.

---

## Part 4: Manager verification and rule change (2026-11-05/06)

- Rerunning Argon's tool: software 67/67; GPU run 1 passed, but GPU run 2 **failed** on `lighthouse@1:1` full size: NEW had a rare single-draw GPU blip (`47309557`, frame 4) in 2 of its 4 runs, OLD in none, and Argon's rule ("all 3 retry pages must equal OLD's mode") rejected it. Software rendering of that item is identical; the blip is load-dependent GPU raster noise (OLD showed the same kind of blip in Argon's own 10-page data), so "twice in a row" did not reproduce with that rule.
- **Rule now in the tool (header comment and `--help`):** software = exact equality of every compared frame hash. `--gpu` = when the first page differs, 3 more fresh pages per engine are drawn and a frame is identical when OLD's plurality hash (>= 3 of 4 runs) also appears in >= 2 of NEW's 4 runs. Why: GPU raster noise exists in OLD too, while a real engine difference is deterministic and gives 0 of 4, so it still fails; the strict software run is the exactness proof.
- Final verification under `.lock-timing` with the final tool: software 67/67, GPU run 1 67/67 (one blip on `lighthouse@16:9` resolved by the vote), GPU run 2 67/67 with no retries; `skipped: []`; `coldFirstDraw` informational only. The regenerated `docs/phase3/engine-identity-result*.json` are these final runs (software, GPU run 2).
