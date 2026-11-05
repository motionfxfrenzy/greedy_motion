# Engine Indexed Point-in-Polygon (`insideRing`) — Final Verification & Timing Report

## 1. Summary of Changes

Commit `23e1963` (base) had ten separate copies of the $O(N)$ even-odd ray-casting loop (`a[1] > y !== b[1] > y && x < ...`), dominated in crayon and hatched scenes by `hatchRuns()` in `packages/plate-engine/src/canvas-core/gallery.ts` calling `inside(pts, x, y)` hundreds of thousands of times per frame (`85,091` to `915,907` calls/frame in the four staging crayon scenes).

All ten call sites now route through a single shared, exact, height-bucketed implementation `insideRing(pts, x, y)` in `packages/plate-engine/src/canvas-core/core.ts`, guarded by a per-frame epoch counter `ringNewFrame()` called from `renderFrame()` in `packages/plate-engine/src/canvas-core/film.ts`.

### Files Changed Since `23e1963`

| File | Lines (`+` / `-`) | Purpose |
| :--- | :---: | :--- |
| `packages/plate-engine/src/canvas-core/core.ts` | `+70 / -0` | `RingIndex`, `ringCache` (`WeakMap`), `ringEpoch`, `ringNewFrame()`, `ringSame()` (`Object.is` full-vertex check), `ringBuild()`, `insideRing()` |
| `packages/plate-engine/src/canvas-core/film.ts` | `+2 / -1` | Calls `ringNewFrame()` at the start of every `renderFrame()` call |
| `packages/plate-engine/src/canvas-core/gallery.ts` | `+2 / -2` | Routes `inside(pts0, x, y)` to `insideRing(adaptPts(pts0), x, y)` (`hatchRuns` untouched) |
| `packages/plate-engine/src/canvas-core/riso.ts` | `+2 / -2` | Routes `inside` to `insideRing` |
| `packages/plate-engine/src/canvas-core/colouredPencilKit.ts` | `+2 / -2` | Routes `inPoly` to `insideRing` |
| `packages/plate-engine/src/canvas-core/scrapbookKit.ts` | `+2 / -2` | Routes `inPoly` to `insideRing` |
| `packages/plate-engine/src/canvas-core/scratchboardKit.ts` | `+2 / -2` | Routes `insidePoly` to `insideRing` |
| `packages/plate-engine/src/canvas-core/brokenColour.ts` | `+2 / -2` | Routes `inPoly` to `insideRing` |
| `packages/plate-engine/src/canvas-core/folkTale.ts` | `+2 / -2` | Routes `inPath` to `insideRing` |
| `packages/plate-engine/src/canvas-core/scrapbookEngraving.ts` | `+2 / -2` | Routes `occHit` to `insideRing` (after its existing bounding-box check) |
| `packages/plate-engine/src/canvas-core/woodcut.ts` | `+3 / -3` | Routes the two inline ray-casting loops (`HERONS` and `BRIDGE`) to `insideRing` |
| `packages/plate-engine/package.json` | `+1 / -1` | Version bumped `0.6.4 -> 0.6.5` (`engineDigest()` hashes `package.json` `version` + `src/**`, producing `4b817fc4988078cebb0e4391`) |
| `packages/plate-engine/manifest.json` | `+1 / -1` | Regenerated via `node packages/plate-engine/scripts/build-manifest.mjs` (`engineVersion: "0.6.5"`) |
| `packages/plate-engine/PROVENANCE.md` | `+12 / -1` | Records the local Apache-2.0 change (`insideRing` + `ringNewFrame`) |
| `packages/plate-engine/NOTICE` | `+6 / -0` | Apache-2.0 section 4(b) modification notice |
| `packages/plate-engine/test/inside-identity.mjs` | `+287 / -0` | Randomized property tests (`336,000` points $\times$ `420` outlines), `Object.is` NaN/`-0` tests, within-frame vs between-frame mutation tests, and `bundleScene` VM integration test |
| `tools/phase3/engine-identity.mjs` | `+169 / -0` | Old-vs-new identity + timing harness across all 31 styles (`16:9` and `1:1`, incl. `storybook` wrapper) + 5 animated fixtures at small and full sizes |
| `tools/phase3/crayon-fixtures.mjs` | `+167 / -0` | Before/after timing, pixel hash verification, and per-frame guard overhead benchmark on the 4 staging crayon fixtures |
| `docs/phase3/engine-identity-result.json` | regenerated | Full 67-item identity & timing output in software mode (`allIdentical: true`, `skipped: []`) |
| `docs/phase3/engine-identity-result-gpu.json` | regenerated | Full 67-item identity & timing output in GPU mode (`allIdentical: true`, `skipped: []`) |
| `docs/phase3/rebundle-proposal.md` | new file | Write-only design proposal for re-bundling existing scenes without model calls |

---

## 2. Guard Design, Bundled-Film Call Path, and Documented Limitation (Step `(c)`)

### 2.1 How the Guard Works (`packages/plate-engine/src/canvas-core/core.ts:68-127`)
1. **Small or non-finite outlines (`n < 16` or any coordinate with `!(Math.abs(v) < 1e100)`):**
   - Outlines with `< 16` vertices bypass indexing and run `ringLoop` directly.
   - Outlines with `>= 16` vertices that contain `NaN`, `±Infinity`, or `>= 1e100` store a `RingIndex` with `fast: false` and a snapshot `xy: Float64Array(2 * n)` of all vertex coordinates, then delegate to `ringLoop`.
2. **Per-frame epoch invalidation (`ringEpoch` / `ringNewFrame()`):**
   - `renderFrame(film, ctx, frame, env)` in `packages/plate-engine/src/canvas-core/film.ts:75` calls `ringNewFrame()`, incrementing `ringEpoch` before every frame draw.
   - On the **first use** of an outline array `p` in a new frame (`c.ep !== ringEpoch`), `insideRing` checks `c.n === n && ringSame(p, c)`, where `ringSame` compares all `2 * n` coordinates in `p` against `c.xy` using `Object.is(p[i][0], xy[2 * i]) && Object.is(p[i][1], xy[2 * i + 1])`:
     - Because `Object.is(NaN, NaN)` is `true`, an outline containing `NaN` is recognized as unchanged across frames and does **not** rebuild every frame (nor on every query within a frame).
     - Because `Object.is(-0, +0)` is `false`, a vertex changing sign between `-0` and `+0` is treated as a mutation and triggers a harmless extra rebuild, never a stale index.
   - If `ringSame` passes, `c.ep` is updated to `ringEpoch`; otherwise `ringBuild(p)` rebuilds the index.
3. **Per-query cheap check:**
   - Every query checks `!c || c.n !== n || !Object.is(p[0][0], c.fx) || !Object.is(p[0][1], c.fy) || !Object.is(p[n >> 1][0], c.mx) || !Object.is(p[n >> 1][1], c.my) || !Object.is(p[n - 1][0], c.lx) || !Object.is(p[n - 1][1], c.ly)`.

### 2.2 Verification That `bundleScene` Reaches `renderFrame` -> `ringNewFrame`
Every scene compiled by `bundleScene()` (`packages/plate-engine/lib/engine.mjs:148-152`) uses the entry point:
```ts
import { sceneFilm } from "scene:film";
import { mountFilm } from "./hosts/page";
mountFilm(sceneFilm);
```
Inside `mountFilm` (`packages/plate-engine/src/hosts/page.ts:52, 77, 116`), `window.FILM.seek(frame)` and `window.FILM.blur(frame, spec)` call `renderFrame(film, ctx, frame, env)` (`packages/plate-engine/src/canvas-core/film.ts:72-78`), which calls `ringNewFrame()` before `s.draw(ctx, frame - s.start, env)`. Both the live browser player (`page.ts:181-191`) and the render worker (`packages/plate-engine/lib/capture.mjs:59, 75`) drive frames exclusively through `window.FILM.seek(f)`.

This path is proven end-to-end by the `bundled scene path: bundleScene -> mountFilm -> FILM.seek -> renderFrame -> ringNewFrame` test in `packages/plate-engine/test/inside-identity.mjs:169-277`, which compiles a scene with `bundleScene`, mutates both an interior vertex (`RING[8]`) and the middle vertex (`RING[16]`) in place between frames `0 -> 1 -> 2`, drives `window.FILM.seek(0..2)`, and verifies the exact expected inside/outside fills on every frame.

### 2.3 Documented Limitation: Within-Frame In-Place Edits
- **Supported:** Creating new outline arrays per call (`region.map(...)`, `smooth(...)`, `blob(...)`) or mutating an outline array in place **between frames** (detected on first use in the new frame via `ringNewFrame()` + `ringSame()`).
- **Unsupported (documented in `core.ts:71-76`):** Mutating an interior vertex (other than index `0`, `n >> 1`, or `n - 1`) of an outline array **within a single frame** after `insideRing` has already indexed it in that same frame epoch. Within the same epoch, `insideRing` reuses the current frame's cached bounding box and height buckets without crashing, and updates the index at the start of the next frame (`ringNewFrame()`). Any scene that mutates module-scope state across draws fails `verifyScene()`'s double-draw determinism check (`packages/plate-engine/lib/capture.mjs:105-114`). This behaviour is demonstrated in `packages/plate-engine/test/inside-identity.mjs:141-167`.

---

## 3. Cause of First-Draw GPU Differences & Old-vs-Old Variance (Step `(a)`)

### 3.1 Root Cause of First-Draw vs Warm-Draw Differences in `--gpu` Mode
In `packages/plate-engine/src/hosts/page.ts:42-53`:
```ts
const opts = film.meta.raster === "cpu" ? { willReadFrequently: true } : undefined;
const surface = (w: number, h: number): Layer => {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : ...;
  return { canvas: c, ctx: c.getContext("2d", opts) as unknown as Ctx } as Layer;
};
const mount = (scale = 1) => {
  canvas.width = Math.round(film.meta.W * scale);
  canvas.height = Math.round(film.meta.H * scale);
  ctx = canvas.getContext("2d", opts) as CanvasRenderingContext2D;
  env = { W: film.meta.W, H: film.meta.H, scale, cache: new Map(), canvas: surface, ... };
  return film.meta;
};
const seek = (frame: number) => {
  const t0 = performance.now();
  const shot = renderFrame(film, ctx, frame, env);
  ctx.getImageData(0, 0, 1, 1);
  current = frame;
  return { shot, ms: performance.now() - t0 };
};
```
Two distinct GPU mechanisms explain the cold first-draw differences observed when Chrome runs with GPU enabled (`--gpu`):

1. **Deterministic Draw 1 -> Draw 2 transition (`mellan`, `moonPhases`, `pocketWatch`):**
   - None of the style reference plates sets `meta.raster = "cpu"`, so `opts` is `undefined` (`willReadFrequently` is not set).
   - When `mount(scale)` resizes `<canvas id="film">`, Chromium allocates a GPU-backed 2D canvas resource provider (`CanvasResourceProviderSharedImage` / Skia GPU).
   - On **Draw 1** (`seek(0)` #1), `renderFrame` draws onto the GPU-backed `<canvas id="film">`. Then `seek()` calls `ctx.getImageData(0, 0, 1, 1)` (readback #1) and `hash()` calls `ctx.getImageData(0, 0, canvas.width, canvas.height)` (readback #2).
   - That `getImageData` readback on a dirty GPU canvas triggers Chromium Blink's readback fallback heuristic: `<canvas id="film">` is immediately demoted from GPU rasterization to CPU software rasterization (`willReadFrequently` mode) for all subsequent draws (`Draw 2+`).
   - **Direct Proof 1 (`mellan`):** `mellan.ts` draws exclusively on the main `ctx` (no `Gfx` offscreen layers). In `--gpu` mode, Draw 1 produces GPU hashes `e7e5f6e7` (`16:9` `640x360`), `25bfdc53` (`16:9` `1920x1080`), `86c47e0a` (`1:1` `640x640`), and `566a2bca` (`1:1` `1080x1080`). On Draws 2..5 in `--gpu` mode, it produces `cb0bd679`, `72c3b4d5`, `480c8d14`, and `cade52d5` — **byte-for-byte identical to the `--disable-gpu` software hashes**. Calling `ctx.fillRect(0,0,1,1); ctx.getImageData(0,0,1,1)` (or `getContext("2d", { willReadFrequently: true })`) before Draw 1 makes Draw 1 in `--gpu` mode immediately return `cb0bd679`.
   - **Direct Proof 2 (`moonPhases` pixel diff region):** In `moonPhases@1:1` (`1080x1080`), `document.fonts.status` is `"loaded"` (`document.fonts.size === 0`) and `assets.images` is `{}`. Comparing Draw 1 (`f39c561e`) against Draw 2 (`ddb94e5c`) shows `480,057` changed pixels (`maxDelta = 2`) confined to bounding box **`[34, 34, 1045, 953]`** (and `[20, 20, 619, 565]` at `640x640`). In `moonPhases.ts:21, 83-122`, `B0 = 34, B1 = 1046, LEDGE = 958` are the inner edges of the wooden chalkboard frame: `board(g, ctx)` draws a radial gradient and `g.paper("coldpress", 0.3)` directly onto the main `ctx` (which switches from GPU on Draw 1 to CPU on Draw 2), whereas `frame(g)` draws the opaque wooden border (`x < 34`, `x >= 1046`, `y < 34`, `y >= 954`) onto an `OffscreenCanvas` layer in `Gfx.pool` (which never has `getImageData` called on it and stays on the GPU) and composites it opaque over the border.

2. **Cold first-draw & occasional multi-layer GPU raster variance (`lighthouse` and `moonPhases@1:1` `640x640`):**
   - On Draw 1 after `mount(scale)`, `env.cache` is empty: `tile(env, kind)` (`core.ts:227-239`) creates new `OffscreenCanvas` tiles via `putImageData` and `Gfx.layer()` (`core.ts:278`) allocates new `OffscreenCanvas` layers before pushing them into `Gfx.pool`.
   - In `lighthouse.ts` (`riso.ts`), each of the three risograph drums (`yellowPlate`, `pinkPlate`, `bluePlate`) draws ~25,000 `ctx.arc()` halftone dots in a single path on an `OffscreenCanvas`, masks it with `destination-in` repeating patterns (`risoSpeck`, `risoMottle`), and composites it with `multiply` at subpixel offsets (`REG.yellow = [-4.5, 3.5]`, `REG.pink = [4.5, -3]`).
   - Pixel-diffing `lighthouse@16:9` (`1920x1080`) cold Draw 1 (`3697e3b2`) vs warm Draw 2 (`e4dd5f94`) shows `72,665` changed pixels (`maxDelta = 54`) in bounding box **`[410, 0, 1509, 1079]`** (the exact `1080x1080` plate centered at `tx = 420` with `±4.5` drum offsets). Pixel-diffing the rare (~1 in 25 warm draws) GPU variant `962f1af` vs `e4dd5f94` shows `48,290` changed pixels (`maxDelta = 6`) in **`[415, 0, 1514, 1076]`** (a single riso drum layer).

### 3.2 Old-vs-Old and New-vs-New 10-Page GPU Variance Table (`lighthouse` & `moonPhases`)

Each scene was run across **10 fresh browser pages** in `--gpu` mode on both the OLD engine (`23e1963`) and NEW engine (`0.6.5`), drawing frame `0` on a cold mounted canvas (Draw 1) followed by warm draws (Draws 2..5):

| Item & Size | Engine | Cold Draw 1 Hashes Across 10 Pages (counts) | Warm Draws 2..5 Hashes Across 10 Pages (counts) | Old Warm == New Warm? |
| :--- | :---: | :--- | :--- | :---: |
| `lighthouse@16:9` (`640x360`) | OLD (`23e1963`) | `405fd0e3` (9/10), `1204143c` (1/10) | `405fd0e3` (10/10 pages, 40/40 draws) | **YES** (`405fd0e3`) |
| `lighthouse@16:9` (`640x360`) | NEW (`0.6.5`) | `405fd0e3` (9/10), `943de533` (1/10) | `405fd0e3` (10/10 pages, 40/40 draws) | **YES** (`405fd0e3`) |
| `lighthouse@16:9` (`1920x1080`) | OLD (`23e1963`) | `e4dd5f94` (10/10 in run 2; `3697e3b2` 8/12, `e4dd5f94` 4/12 in run 1) | `e4dd5f94` (10/10 pages in run 2; `962f1af` on 2/48 draws in run 1) | **YES** (`e4dd5f94`) |
| `lighthouse@16:9` (`1920x1080`) | NEW (`0.6.5`) | `3697e3b2` (9/10), `e4dd5f94` (1/10) | `e4dd5f94` (39/40 draws), `962f1af` (1/40 draws) | **YES** (`e4dd5f94`) |
| `lighthouse@1:1` (`640x640`) | OLD (`23e1963`) | `4237c42b` (10/10) | `4237c42b` (10/10 pages, 40/40 draws) | **YES** (`4237c42b`) |
| `lighthouse@1:1` (`640x640`) | NEW (`0.6.5`) | `4237c42b` (6/10), `e5a3d563` (2/10), `4d5962ef` (1/10), `cadd6de` (1/10) | `4237c42b` (10/10 pages, 40/40 draws) | **YES** (`4237c42b`) |
| `lighthouse@1:1` (`1080x1080`) | OLD (`23e1963`) | `a9c03be8` (9/10), `86d09c95` (1/10) (`86d09c95` 12/12 in run 1) | `a9c03be8` (10/10 pages, 40/40 draws) | **YES** (`a9c03be8`) |
| `lighthouse@1:1` (`1080x1080`) | NEW (`0.6.5`) | `86d09c95` (10/10) | `a9c03be8` (10/10 pages, 40/40 draws) | **YES** (`a9c03be8`) |
| `moonPhases@16:9` (`640x360`) | OLD (`23e1963`) | `be1229a1` (10/10) | `195f4f2c` (10/10 pages, 40/40 draws) | **YES** (`195f4f2c`) |
| `moonPhases@16:9` (`640x360`) | NEW (`0.6.5`) | `be1229a1` (10/10) | `195f4f2c` (10/10 pages, 40/40 draws) | **YES** (`195f4f2c`) |
| `moonPhases@16:9` (`1920x1080`) | OLD (`23e1963`) | `c1351dc9` (10/10) | `65dad65` (10/10 pages, 40/40 draws) | **YES** (`65dad65`) |
| `moonPhases@16:9` (`1920x1080`) | NEW (`0.6.5`) | `c1351dc9` (10/10) | `65dad65` (10/10 pages, 40/40 draws) | **YES** (`65dad65`) |
| `moonPhases@1:1` (`640x640`) | OLD (`23e1963`) | `bc530dce` (7/10), `78449fd1` (3/10) | `4a663266` (10/10 pages, 40/40 draws) | **YES** (`4a663266`) |
| `moonPhases@1:1` (`640x640`) | NEW (`0.6.5`) | `bc530dce` (8/10), `78449fd1` (2/10) | `4a663266` (10/10 pages, 40/40 draws) | **YES** (`4a663266`) |
| `moonPhases@1:1` (`1080x1080`) | OLD (`23e1963`) | `f39c561e` (10/10) | `ddb94e5c` (10/10 pages, 40/40 draws) | **YES** (`ddb94e5c`) |
| `moonPhases@1:1` (`1080x1080`) | NEW (`0.6.5`) | `f39c561e` (10/10) | `ddb94e5c` (10/10 pages, 40/40 draws) | **YES** (`ddb94e5c`) |

**Harness update (`tools/phase3/engine-identity.mjs`):**
Matching `capture.mjs:59` (`window.FILM.warm()`), `engine-identity.mjs` now awaits `document.fonts?.ready`, performs **one warm-up draw** (`window.FILM.seek(hashIdx[0]); window.FILM.hash()`) after `window.FILM.mount(scale)` whose timing and hash are recorded separately as `oldFirstMs`/`newFirstMs` and `oldFirstHash`/`newFirstHash` (`firstDrawIdentical`), and then compares `hashes` across all 5 verification frames (`0, 1/4, 1/2, 3/4, last`) in the matched warm state.

---

## 4. Storybook Coverage (Step `(b)`)

`packages/plate-engine/src/canvas-core/storybook.ts` exports `drawStorybook(ctx, frame, env)` (line `113`) rather than a `Film` object.
- In `tools/phase3/engine-identity.mjs` (`plateSource`), when a style file has no `export const <name>: Film`, the harness wraps `export const drawStorybook = (ctx: Ctx, ...)` in a `Film` (`W: 560, H: 560, fps: 30, bpm: 120, durationFrames: 90`).
- `storybook@16:9` and `storybook@1:1` now bundle and draw at both `small` (`640x360` / `640x640`) and `full` (`1920x1080` / `1080x1080`) sizes in both software and GPU modes with **zero skipped items (`skipped: []`)** and **100% identical hashes** across all 5 sampled frames (`0, 22, 45, 67, 89`).
- Note also that `storybook.ts` imports only `{ Env, GRAPHITE, Gfx, P, PENCIL, TINT, arc, heart, line, oval, rng, tube, turn, Ctx }` from `./core` (none of which calls `insideRing` or `ringNewFrame`), while the bundled `mountFilm` host calls `renderFrame` (`ringNewFrame()`).

---

## 5. Property Test & Golden Test Results (Step `(c)`)

### 5.1 `node packages/plate-engine/test/inside-identity.mjs`
- **Result:** `9/9` tests pass (`0` failures).
- **Property test counts:** `420` randomized outlines across `14` geometry classes (`30` each of `convex`, `concave`, `spiky`, `touching`, `horizontal`, `integer`, `dups`, `figure8`, `tiny`, `nan`, `inf`, `huge`, `denormal`, `offset`) $\times$ `800` targeted & random query points per outline = **`336,000` query points** (`162,702` `true` answers, `173,298` `false` answers) + `40,000` cache-hit repeat queries + `20,000` `gallery.inside()` queries = **Zero mismatches (`0 / 396,000`)** against `oldInside`.
- **Mutation & `Object.is` guard tests:**
  - In-place edits of length (`push`/`pop`), first, middle, and last vertices within a frame: pass.
  - In-place edits of arbitrary interior vertices between frames (`ringNewFrame()`): pass (`12` interior mutations $\times$ `3,000` queries).
  - `Object.is` semantics for `NaN` outlines (no spurious rebuilds across `ringNewFrame()` epochs) and `-0` vs `+0` vertex edits (harmless rebuild, exact answer): pass.
  - Documented within-frame interior vertex edit (no crash, retains current frame's cached index until `ringNewFrame()`, then matches `oldInside` on the next frame): pass.
  - Bundled scene path (`bundleScene` -> `mountFilm` -> `window.FILM.seek(0..2)` -> `renderFrame` -> `ringNewFrame` -> `inside` -> `insideRing`) with interior (`RING[8]`) and midpoint (`RING[16]`) vertices mutated in place between frames: pass.

### 5.2 `node packages/plate-engine/test/engine.test.mjs`
- **Result:** All `4/4` non-browser unit tests pass immediately (`manifest lists the styles and matches the sources`, `source validation`, `bundler resolver is closed`, `bundles are byte-for-byte reproducible`); with `PLATE_BROWSER_PATH` pointing to the local headless Chromium shell, all **`7/7` tests pass**, including `legacy parity: new capture path draws the exact frames the legacy pipeline drew` against the **unchanged `packages/plate-engine/test/golden.json`**.

---

## 6. Per-Style & Fixture Identity and Timing Table (`67 / 67` Items)

- **Software mode (`node tools/phase3/engine-identity.mjs --out docs/phase3/engine-identity-result.json`):**
  - Warm identity: **`67 / 67` small (`100%`)** and **`67 / 67` full (`100%`)** identical (`allIdentical: true`, `skipped: []`).
  - Cold first-draw identity: **`67 / 67` small (`100%`)** and **`67 / 67` full (`100%`)** identical.
- **GPU mode (`node tools/phase3/engine-identity.mjs --gpu --out docs/phase3/engine-identity-result-gpu.json`):**
  - Warm identity: **`67 / 67` small (`100%`)** and **`67 / 67` full (`100%`)** identical (`allIdentical: true`, `skipped: []`).
  - Cold first-draw identity: **`66 / 67` small** and **`65 / 67` full** identical on the single cold draw (the only 3 differences are `moonPhases@1:1` small `bc530dce` vs `78449fd1`, `lighthouse@16:9` full `e4dd5f94` vs `3697e3b2`, and `lighthouse@1:1` full `a9c03be8` vs `86d09c95` — the exact cold-draw hash pairs that the old engine itself alternates between in Section 3.2).

| Item | Frames | Small Size | SW Small Identical (Frame 0 Hash) | SW Small Median ms (Old -> New, Speedup) | GPU Small Identical (Frame 0 Hash) | GPU Small Median ms (Old -> New, Speedup) | Full Size | SW Full Identical (Frame 0 Hash) | SW Full Median ms (Old -> New, Speedup) | GPU Full Identical (Frame 0 Hash) | GPU Full Median ms (Old -> New, Speedup) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `balloon@16:9` | 1 | 640x360 | YES (`38422616`) | 74.2 -> 72.1 (1.03x) | YES (`1bccee7d`) | 23.3 -> 23.6 (0.99x) | 1920x1080 | YES (`864c280a`) | 160.5 -> 145.3 (1.1x) | YES (`f23b1856`) | 24.6 -> 23.3 (1.06x) |
| `balloon@1:1` | 1 | 640x640 | YES (`1d5fb24d`) | 63.3 -> 63.2 (1x) | YES (`3d1e4c6c`) | 17.4 -> 19.2 (0.91x) | 1080x1080 | YES (`acf839d6`) | 103.4 -> 99.2 (1.04x) | YES (`ed47b171`) | 17.4 -> 17.4 (1x) |
| `blueprint@16:9` | 540 | 640x360 | YES (`f23ca3ae`) | 9.4 -> 9 (1.04x) | YES (`28800f90`) | 7.8 -> 7.3 (1.07x) | 1920x1080 | YES (`e1632ab`) | 37.1 -> 35.2 (1.05x) | YES (`2f048a18`) | 12.1 -> 13.5 (0.9x) |
| `blueprint@1:1` | 540 | 640x640 | YES (`bee4a4b3`) | 14.7 -> 12.4 (1.19x) | YES (`badc9066`) | 7.6 -> 7.6 (1x) | 1080x1080 | YES (`eb35c696`) | 28.9 -> 24.8 (1.17x) | YES (`566a6ce1`) | 10.8 -> 10.6 (1.02x) |
| `brokenColour@16:9` | 450 | 640x360 | YES (`8232a808`) | 12 -> 11.8 (1.02x) | YES (`8232a808`) | 12.6 -> 12.1 (1.04x) | 1920x1080 | YES (`e800c393`) | 25.3 -> 23.9 (1.06x) | YES (`e800c393`) | 23.7 -> 23.9 (0.99x) |
| `brokenColour@1:1` | 450 | 640x640 | YES (`3c6ea6de`) | 22.5 -> 23.1 (0.97x) | YES (`3c6ea6de`) | 23.3 -> 23.2 (1x) | 1080x1080 | YES (`eee2d309`) | 30.1 -> 31.3 (0.96x) | YES (`eee2d309`) | 30.1 -> 30.7 (0.98x) |
| `charcoalErasure@16:9` | 540 | 640x640 | YES (`98a33b3d`) | 30.5 -> 31.8 (0.96x) | YES (`59090236`) | 26.7 -> 27.6 (0.97x) | 1080x1080 | YES (`18dbffdf`) | 42.6 -> 43.9 (0.97x) | YES (`5b23c887`) | 29.6 -> 30 (0.99x) |
| `charcoalErasure@1:1` | 540 | 640x640 | YES (`7c8da44a`) | 21 -> 21.9 (0.96x) | YES (`a32fe71d`) | 17.2 -> 16.6 (1.04x) | 1080x1080 | YES (`da758f13`) | 36.9 -> 37.1 (0.99x) | YES (`c4565434`) | 21.1 -> 19.8 (1.07x) |
| `colouredPencil@16:9` | 540 | 640x360 | YES (`eda663bf`) | 10.2 -> 10.4 (0.98x) | YES (`eda663bf`) | 12.1 -> 9.7 (1.25x) | 1920x1080 | YES (`5cc1781d`) | 35.5 -> 35.7 (0.99x) | YES (`5cc1781d`) | 38.2 -> 36.8 (1.04x) |
| `colouredPencil@1:1` | 540 | 640x640 | YES (`113dd375`) | 12.3 -> 12.2 (1.01x) | YES (`113dd375`) | 16.9 -> 13.1 (1.29x) | 1080x1080 | YES (`f539b8e0`) | 23.9 -> 22.1 (1.08x) | YES (`f539b8e0`) | 24 -> 22.9 (1.05x) |
| `embroidery@16:9` | 540 | 640x640 | YES (`4ddcd892`) | 8 -> 8.5 (0.94x) | YES (`c8ade5e2`) | 6.6 -> 5.8 (1.14x) | 1080x1080 | YES (`aebb016d`) | 16.4 -> 17.1 (0.96x) | YES (`b16bf121`) | 8.4 -> 7.9 (1.06x) |
| `embroidery@1:1` | 540 | 640x640 | YES (`4ddcd892`) | 10.8 -> 9.9 (1.09x) | YES (`c8ade5e2`) | 6.1 -> 6 (1.02x) | 1080x1080 | YES (`aebb016d`) | 19.5 -> 19.7 (0.99x) | YES (`b16bf121`) | 8.3 -> 8 (1.04x) |
| `flatVector@16:9` | 525 | 640x640 | YES (`ce019dc5`) | 0.5 -> 0.5 (1x) | YES (`ce019dc5`) | 0.5 -> 0.5 (1x) | 1080x1080 | YES (`f5bebac5`) | 0.9 -> 0.9 (1x) | YES (`f5bebac5`) | 0.9 -> 0.8 (1.13x) |
| `flatVector@1:1` | 525 | 640x640 | YES (`ce019dc5`) | 0.5 -> 0.6 (0.83x) | YES (`ce019dc5`) | 0.6 -> 0.6 (1x) | 1080x1080 | YES (`f5bebac5`) | 1 -> 0.9 (1.11x) | YES (`f5bebac5`) | 1.1 -> 0.9 (1.22x) |
| `folkTale@16:9` | 540 | 640x360 | YES (`ba426c5e`) | 13.5 -> 13.9 (0.97x) | YES (`ba426c5e`) | 14.4 -> 13.6 (1.06x) | 1920x1080 | YES (`d1a4b4d2`) | 52.3 -> 52.4 (1x) | YES (`d1a4b4d2`) | 53.3 -> 54.3 (0.98x) |
| `folkTale@1:1` | 540 | 640x360 | YES (`ba426c5e`) | 13.3 -> 13.2 (1.01x) | YES (`ba426c5e`) | 13.6 -> 13.8 (0.99x) | 1920x1080 | YES (`d1a4b4d2`) | 41.9 -> 42.1 (1x) | YES (`d1a4b4d2`) | 42.8 -> 46.6 (0.92x) |
| `fox@16:9` | 1 | 640x360 | YES (`fade1b1a`) | 66.7 -> 65.2 (1.02x) | YES (`4a883a6d`) | 47.3 -> 46.7 (1.01x) | 1920x1080 | YES (`6458e2f2`) | 230.8 -> 223.8 (1.03x) | YES (`d4620afb`) | 52.6 -> 55.1 (0.95x) |
| `fox@1:1` | 1 | 640x640 | YES (`319edd7c`) | 65.8 -> 68.8 (0.96x) | YES (`8837ae2e`) | 24.6 -> 23.8 (1.03x) | 1080x1080 | YES (`585444f1`) | 147.2 -> 160.1 (0.92x) | YES (`c0705b44`) | 25.2 -> 26.6 (0.95x) |
| `halftone@16:9` | 420 | 640x360 | YES (`5a00c175`) | 4 -> 4 (1x) | YES (`c6186023`) | 1.8 -> 2.1 (0.86x) | 1920x1080 | YES (`65077d40`) | 30.3 -> 30.7 (0.99x) | YES (`7d66444b`) | 6.1 -> 7.3 (0.84x) |
| `halftone@1:1` | 420 | 640x640 | YES (`818b9053`) | 7.5 -> 7.1 (1.06x) | YES (`37c8155e`) | 2.5 -> 2.9 (0.86x) | 1080x1080 | YES (`8c9ca2db`) | 17.6 -> 18.1 (0.97x) | YES (`b15ae318`) | 4.6 -> 4.2 (1.1x) |
| `isometric@16:9` | 480 | 640x360 | YES (`1b8a25c5`) | 1.7 -> 1.8 (0.94x) | YES (`1b8a25c5`) | 1.9 -> 1.8 (1.06x) | 1920x1080 | YES (`f6f665c5`) | 4.8 -> 4.7 (1.02x) | YES (`f6f665c5`) | 5.3 -> 4.9 (1.08x) |
| `isometric@1:1` | 480 | 640x640 | YES (`2e511dc5`) | 2.8 -> 2.4 (1.17x) | YES (`2e511dc5`) | 2.5 -> 2.5 (1x) | 1080x1080 | YES (`c2362e45`) | 4.1 -> 4.2 (0.98x) | YES (`c2362e45`) | 4.8 -> 4.4 (1.09x) |
| `koi@16:9` | 1 | 640x360 | YES (`82c0b590`) | 7.9 -> 7.6 (1.04x) | YES (`f4393792`) | 6.5 -> 6.5 (1x) | 1920x1080 | YES (`3f0af69b`) | 33.6 -> 35.1 (0.96x) | YES (`8b6a64f4`) | 11.8 -> 9.8 (1.2x) |
| `koi@1:1` | 1 | 640x640 | YES (`213ba9c0`) | 11.1 -> 11.1 (1x) | YES (`c564749a`) | 5.8 -> 6.1 (0.95x) | 1080x1080 | YES (`a2a1895`) | 21.8 -> 21.5 (1.01x) | YES (`dacf4d83`) | 7 -> 7.2 (0.97x) |
| `lighthouse@16:9` | 1 | 640x360 | YES (`291e5680`) | 264.9 -> 178.1 (1.49x) | YES (`405fd0e3`) | 205.6 -> 113.7 (1.81x) | 1920x1080 | YES (`c1553c35`) | 360.4 -> 271 (1.33x) | YES (`e4dd5f94`) | 210.5 -> 119.3 (1.76x) |
| `lighthouse@1:1` | 1 | 640x640 | YES (`2d0d3ce7`) | 293.5 -> 199.5 (1.47x) | YES (`4237c42b`) | 201 -> 110.7 (1.82x) | 1080x1080 | YES (`dd460494`) | 344.8 -> 251.4 (1.37x) | YES (`a9c03be8`) | 203.9 -> 111.8 (1.82x) |
| `lowPoly@16:9` | 450 | 640x640 | YES (`854a8197`) | 7 -> 7.7 (0.91x) | YES (`854a8197`) | 7.1 -> 6.9 (1.03x) | 1080x1080 | YES (`b3fb8785`) | 7.9 -> 10.4 (0.76x) | YES (`b3fb8785`) | 7.7 -> 7.9 (0.97x) |
| `lowPoly@1:1` | 450 | 640x640 | YES (`854a8197`) | 6.8 -> 6.8 (1x) | YES (`854a8197`) | 6.7 -> 8.6 (0.78x) | 1080x1080 | YES (`b3fb8785`) | 7.7 -> 8.2 (0.94x) | YES (`b3fb8785`) | 7.6 -> 8.1 (0.94x) |
| `mellan@16:9` | 1 | 640x360 | YES (`cb0bd679`) | 55.5 -> 54.9 (1.01x) | YES (`cb0bd679`) | 53.4 -> 53.3 (1x) | 1920x1080 | YES (`72c3b4d5`) | 54.2 -> 55.8 (0.97x) | YES (`72c3b4d5`) | 55.2 -> 55.6 (0.99x) |
| `mellan@1:1` | 1 | 640x640 | YES (`480c8d14`) | 57.3 -> 55.3 (1.04x) | YES (`480c8d14`) | 56.8 -> 56.6 (1x) | 1080x1080 | YES (`cade52d5`) | 55.3 -> 56.1 (0.99x) | YES (`cade52d5`) | 54 -> 54.2 (1x) |
| `midCentury@16:9` | 540 | 640x640 | YES (`123c7ba6`) | 2.8 -> 2.7 (1.04x) | YES (`123c7ba6`) | 5.3 -> 3.7 (1.43x) | 1080x1080 | YES (`2bac3f30`) | 6.1 -> 5.8 (1.05x) | YES (`2bac3f30`) | 10.2 -> 7.2 (1.42x) |
| `midCentury@1:1` | 540 | 640x640 | YES (`123c7ba6`) | 3.1 -> 3.1 (1x) | YES (`123c7ba6`) | 9 -> 3.7 (2.43x) | 1080x1080 | YES (`2bac3f30`) | 6.7 -> 6.3 (1.06x) | YES (`2bac3f30`) | 7.9 -> 7.5 (1.05x) |
| `moonPhases@16:9` | 1 | 640x360 | YES (`3150ffc9`) | 53.5 -> 43.9 (1.22x) | YES (`195f4f2c`) | 42.1 -> 28.8 (1.46x) | 1920x1080 | YES (`6d59e02`) | 136.3 -> 129.6 (1.05x) | YES (`65dad65`) | 53.6 -> 42.6 (1.26x) |
| `moonPhases@1:1` | 1 | 640x640 | YES (`1e4a66e7`) | 71.5 -> 59.8 (1.2x) | YES (`4a663266`) | 38.9 -> 29.5 (1.32x) | 1080x1080 | YES (`d0075771`) | 119 -> 105.3 (1.13x) | YES (`ddb94e5c`) | 47.5 -> 35.9 (1.32x) |
| `paintedOil@16:9` | 540 | 640x640 | YES (`28511dc5`) | 284.6 -> 283.8 (1x) | YES (`28511dc5`) | 290.8 -> 305.8 (0.95x) | 1080x1080 | YES (`2f14e4f4`) | 323.7 -> 327.9 (0.99x) | YES (`2f14e4f4`) | 348.5 -> 342.5 (1.02x) |
| `paintedOil@1:1` | 540 | 640x640 | YES (`28511dc5`) | 232.5 -> 245.6 (0.95x) | YES (`28511dc5`) | 245 -> 232 (1.06x) | 1080x1080 | YES (`2f14e4f4`) | 273.4 -> 283.9 (0.96x) | YES (`2f14e4f4`) | 279.9 -> 272.5 (1.03x) |
| `paperCraft@16:9` | 390 | 640x360 | YES (`1918c4a6`) | 15.1 -> 14.6 (1.03x) | YES (`1918c4a6`) | 15.7 -> 15.3 (1.03x) | 1920x1080 | YES (`764a5ea4`) | 80 -> 79.4 (1.01x) | YES (`764a5ea4`) | 78.8 -> 78.2 (1.01x) |
| `paperCraft@1:1` | 390 | 640x640 | YES (`d1616d85`) | 28.6 -> 27.6 (1.04x) | YES (`d1616d85`) | 29.9 -> 28.8 (1.04x) | 1080x1080 | YES (`31d27da6`) | 61.6 -> 62.8 (0.98x) | YES (`31d27da6`) | 62 -> 62.3 (1x) |
| `pixelArt@16:9` | 450 | 640x360 | YES (`f75f7dc5`) | 0.6 -> 0.6 (1x) | YES (`f75f7dc5`) | 0.6 -> 0.6 (1x) | 1920x1080 | YES (`89767dc5`) | 1 -> 1.1 (0.91x) | YES (`89767dc5`) | 1 -> 1.2 (0.83x) |
| `pixelArt@1:1` | 450 | 640x640 | YES (`935a9dc5`) | 0.6 -> 0.6 (1x) | YES (`935a9dc5`) | 0.7 -> 0.7 (1x) | 1080x1080 | YES (`3dcb2bc5`) | 0.9 -> 0.9 (1x) | YES (`3dcb2bc5`) | 0.9 -> 0.9 (1x) |
| `pocketWatch@16:9` | 1 | 640x360 | YES (`61a64041`) | 156.1 -> 79.3 (1.97x) | YES (`f3d7db84`) | 154.8 -> 74.5 (2.08x) | 1920x1080 | YES (`60bd57b4`) | 172.3 -> 95.4 (1.81x) | YES (`9196426c`) | 161.6 -> 78.3 (2.06x) |
| `pocketWatch@1:1` | 1 | 640x640 | YES (`aeea5d36`) | 156.8 -> 78.5 (2x) | YES (`c14cf8b5`) | 152.5 -> 73.7 (2.07x) | 1080x1080 | YES (`b5aa011b`) | 164.9 -> 86.7 (1.9x) | YES (`ef28abea`) | 151.8 -> 73.2 (2.07x) |
| `ranunculus@16:9` | 1 | 640x360 | YES (`c9d19590`) | 50.5 -> 56.6 (0.89x) | YES (`4cd967bd`) | 60.4 -> 59.6 (1.01x) | 1920x1080 | YES (`c7a85742`) | 262 -> 292.9 (0.89x) | YES (`c438aa86`) | 84 -> 84.1 (1x) |
| `ranunculus@1:1` | 1 | 640x640 | YES (`4c9bd239`) | 89.8 -> 83.5 (1.08x) | YES (`493c00f0`) | 72.7 -> 68.4 (1.06x) | 1080x1080 | YES (`3084efc0`) | 179.4 -> 193.5 (0.93x) | YES (`bf3b7add`) | 97.9 -> 82.2 (1.19x) |
| `rubberHose@16:9` | 435 | 640x640 | YES (`fa76a6e2`) | 10 -> 9.8 (1.02x) | YES (`2e1f399b`) | 6.8 -> 6.7 (1.01x) | 1080x1080 | YES (`47bef0fc`) | 14 -> 14.6 (0.96x) | YES (`76d590eb`) | 7.5 -> 7.3 (1.03x) |
| `rubberHose@1:1` | 435 | 640x640 | YES (`86ce11c5`) | 10.5 -> 10.3 (1.02x) | YES (`5ddfaab9`) | 7.3 -> 7.3 (1x) | 1080x1080 | YES (`b40d3313`) | 16.7 -> 16.6 (1.01x) | YES (`6ee4d05d`) | 7.8 -> 7.8 (1x) |
| `scrapbook@16:9` | 510 | 640x360 | YES (`154b40`) | 6.1 -> 6.1 (1x) | YES (`154b40`) | 6.2 -> 6.3 (0.98x) | 1920x1080 | YES (`91e163c2`) | 28.7 -> 28.4 (1.01x) | YES (`91e163c2`) | 29 -> 30 (0.97x) |
| `scrapbook@1:1` | 510 | 640x640 | YES (`93d5c9be`) | 10 -> 10.8 (0.93x) | YES (`93d5c9be`) | 10.4 -> 10.6 (0.98x) | 1080x1080 | YES (`f67f5551`) | 19.6 -> 19.6 (1x) | YES (`f67f5551`) | 20 -> 19.4 (1.03x) |
| `scratchboard@16:9` | 480 | 640x360 | YES (`ac1c3dc5`) | 6.3 -> 6.7 (0.94x) | YES (`ac1c3dc5`) | 4.8 -> 4.6 (1.04x) | 1920x1080 | YES (`a4193dc5`) | 15.7 -> 17.7 (0.89x) | YES (`a4193dc5`) | 9 -> 8.8 (1.02x) |
| `scratchboard@1:1` | 480 | 640x640 | YES (`1bc69dc5`) | 3.8 -> 4.1 (0.93x) | YES (`1bc69dc5`) | 2.8 -> 3.1 (0.9x) | 1080x1080 | YES (`d09eb7c5`) | 7.6 -> 7.2 (1.06x) | YES (`d09eb7c5`) | 4.7 -> 4.7 (1x) |
| `stipple@16:9` | 450 | 640x360 | YES (`59a025f5`) | 2.2 -> 2.3 (0.96x) | YES (`59a025f5`) | 2.4 -> 2.2 (1.09x) | 1920x1080 | YES (`f3b073ce`) | 10.7 -> 10.6 (1.01x) | YES (`f3b073ce`) | 6.5 -> 8.4 (0.77x) |
| `stipple@1:1` | 450 | 640x640 | YES (`5d8d5a74`) | 4.7 -> 4.7 (1x) | YES (`5d8d5a74`) | 3.1 -> 4.8 (0.65x) | 1080x1080 | YES (`f0293803`) | 8.7 -> 8.7 (1x) | YES (`f0293803`) | 5.7 -> 6.8 (0.84x) |
| `storybook@16:9` | 90 | 640x360 | YES (`f4fbe8ff`) | 28.9 -> 29.4 (0.98x) | YES (`86074a0d`) | 23.4 -> 27.8 (0.84x) | 1920x1080 | YES (`af7613b9`) | 179.7 -> 182.5 (0.98x) | YES (`702cfbac`) | 30.9 -> 31.4 (0.98x) |
| `storybook@1:1` | 90 | 640x640 | YES (`c6278016`) | 53.7 -> 52.9 (1.02x) | YES (`40e1ae7f`) | 23.1 -> 24.3 (0.95x) | 1080x1080 | YES (`d09f1a03`) | 127.6 -> 128.5 (0.99x) | YES (`3a5c1dfa`) | 28.4 -> 26.8 (1.06x) |
| `sumiE@16:9` | 510 | 640x640 | YES (`784e9bba`) | 13.3 -> 13.1 (1.02x) | YES (`784e9bba`) | 13.7 -> 13.9 (0.99x) | 1080x1080 | YES (`6bf58e5f`) | 16.7 -> 16.7 (1x) | YES (`6bf58e5f`) | 20.9 -> 19.8 (1.06x) |
| `sumiE@1:1` | 510 | 640x640 | YES (`c5a9b6c5`) | 20.6 -> 19.5 (1.06x) | YES (`c5a9b6c5`) | 22.4 -> 20.7 (1.08x) | 1080x1080 | YES (`b2082043`) | 41.7 -> 38.2 (1.09x) | YES (`b2082043`) | 40.5 -> 43.2 (0.94x) |
| `toyBrick@16:9` | 540 | 640x360 | YES (`94275dc5`) | 12.2 -> 12.5 (0.98x) | YES (`94275dc5`) | 13.4 -> 12.9 (1.04x) | 1920x1080 | YES (`ec7d5dc5`) | 32.2 -> 31.7 (1.02x) | YES (`ec7d5dc5`) | 31.6 -> 31 (1.02x) |
| `toyBrick@1:1` | 540 | 640x640 | YES (`3f689dc5`) | 13.7 -> 13.8 (0.99x) | YES (`3f689dc5`) | 14.7 -> 14.4 (1.02x) | 1080x1080 | YES (`c51b09c5`) | 21 -> 21 (1x) | YES (`c51b09c5`) | 21.5 -> 21.4 (1x) |
| `woodcut@16:9` | 420 | 640x360 | YES (`fd8ce358`) | 3.1 -> 3.2 (0.97x) | YES (`fd8ce358`) | 3.5 -> 3.1 (1.13x) | 1920x1080 | YES (`d9bc4e4a`) | 10.9 -> 11.1 (0.98x) | YES (`d9bc4e4a`) | 12.7 -> 10.8 (1.18x) |
| `woodcut@1:1` | 420 | 640x640 | YES (`44e8b745`) | 7.7 -> 7.7 (1x) | YES (`44e8b745`) | 7.8 -> 7.6 (1.03x) | 1080x1080 | YES (`6b7335c8`) | 11.4 -> 11.4 (1x) | YES (`6b7335c8`) | 11.4 -> 11.4 (1x) |
| `wren@16:9` | 1 | 640x360 | YES (`f3eb18fd`) | 19.1 -> 19.3 (0.99x) | YES (`30edd7c9`) | 10.6 -> 10.9 (0.97x) | 1920x1080 | YES (`3001b700`) | 72.1 -> 70.8 (1.02x) | YES (`47d4d1ca`) | 13.5 -> 12.8 (1.05x) |
| `wren@1:1` | 1 | 640x640 | YES (`c985ea19`) | 28.3 -> 27.3 (1.04x) | YES (`8fc6101d`) | 12.1 -> 10.6 (1.14x) | 1080x1080 | YES (`c7eef12c`) | 50.4 -> 51.3 (0.98x) | YES (`2d10f396`) | 11.3 -> 11.2 (1.01x) |
| `fixture:fox-0@9:16` | 90 | 360x640 | YES (`8cfe5573`) | 45.4 -> 48 (0.95x) | YES (`3486db46`) | 22.7 -> 22.9 (0.99x) | 1080x1920 | YES (`f28d6c18`) | 213.2 -> 233.2 (0.91x) | YES (`f88e8475`) | 29.4 -> 30.1 (0.98x) |
| `fixture:fox-0@16:9` | 90 | 640x360 | YES (`ccb14a1f`) | 60.8 -> 59.5 (1.02x) | YES (`e656bcfe`) | 39.5 -> 41 (0.96x) | 1920x1080 | YES (`a600207f`) | 216.8 -> 203.6 (1.06x) | YES (`dc25bb4c`) | 43 -> 45.5 (0.95x) |
| `fixture:blueprint-0@16:9` | 90 | 640x360 | YES (`36966cb9`) | 17.2 -> 18.1 (0.95x) | YES (`7f80ee6e`) | 10.6 -> 10.8 (0.98x) | 1920x1080 | YES (`9add9a2f`) | 103 -> 103.5 (1x) | YES (`d96eb8e4`) | 31.1 -> 31 (1x) |
| `fixture:balloon-0@16:9` | 105 | 640x360 | YES (`a9862de9`) | 42.9 -> 42.7 (1x) | YES (`f9b22be6`) | 18.5 -> 16.3 (1.13x) | 1920x1080 | YES (`953bb3bd`) | 82.1 -> 81 (1.01x) | YES (`42398b34`) | 20.6 -> 18.7 (1.1x) |
| `fixture:balloon-0@9:16` | 105 | 360x640 | YES (`bd2ca8c2`) | 66.1 -> 65.3 (1.01x) | YES (`bc276fb9`) | 26.9 -> 25.4 (1.06x) | 1080x1920 | YES (`f6caf0a0`) | 137.5 -> 135.7 (1.01x) | YES (`e8257f3f`) | 30.8 -> 28.5 (1.08x) |

Note on `balloon@16:9` and `balloon@1:1` first-draw speedup: `balloon.ts` caches its `hatchRuns` output in `env.cache` on the first draw (`balloon.ts:43-45`). On that first draw where `inside()` actually runs, `balloon@16:9` drops from **`768.5 -> 263.4 ms` (`2.92x`)** at `640x360` (`894.7 -> 373.7 ms`, `2.39x` at `1920x1080`) in software mode and **`728.4 -> 215.5 ms` (`3.38x`)** at `640x360` (`745.7 -> 241.5 ms`, `3.09x` at `1920x1080`) in GPU mode. Styles that run `inside()` on every draw (`pocketWatch`, `lighthouse`, `moonPhases`) show **`1.8x–2.08x`** speedups on every frame, and model-authored crayon scenes (which do not cache `hatchRuns` across frames because shapes boil and move) show **`2.8x–4.8x`** speedups on every frame (Section 7).

---

## 7. Crayon Staging Fixtures Timing, Hashes, and Guard Cost (Step `(d)`)

### Methodology (`tools/phase3/crayon-fixtures.mjs`)
- Input: the 4 prebuilt staging crayon bundles in `frontend/test/fixtures/crayon-staging/scene{0..3}.html` (read-only).
- The new engine's `insideRing` and `ringNewFrame` (`packages/plate-engine/src/canvas-core/core.ts`) are compiled via `esbuild` and injected in place of the bundle's `inside` function (`patchedFns: 1`), with `ringNewFrame()` called at the start of every `window.FILM.seek(f)`.
- After `window.FILM.mount(scale)` (`scale = 640/1920` for `640x360`, `scale = 1` for `1920x1080`) and one warm-up draw, every even frame `0, 2, 4, ..., frames - 2` (`45` frames for `scene0`, `75` frames for `scene1..3`) is drawn and timed via `performance.now()`, and every 5th preview frame (`0, 10, 20, ...`) is hashed via `window.FILM.hash()`.
- All timing runs were executed while holding `/Users/osamaehsaan/Code/Market_apps/.lock-timing`.

### 7.1 GPU Mode (`node tools/phase3/crayon-fixtures.mjs --gpu` — Live Browser Path)

| Fixture | Preview Frames | `640x360` Old -> New Median ms (Speedup, FPS) | `1920x1080` Old -> New Median ms (Speedup) | Queries / Frame | Outlines / Frame | Guard Full-Check ms/frame (`%` of `640x360` Draw) | Pixels Identical (`640` / `1920`) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `scene0` | 45 | `149.2 -> 33.2 ms` (**`4.49x`**, `30.1 fps`) | `152.0 -> 36.0 ms` (**`4.22x`**) | `381,193` | `79.0` | `0.0237 ms` (**`0.07%`**) | **YES / YES** (`9/9` frames) |
| `scene1` | 75 | `270.1 -> 56.1 ms` (**`4.81x`**, `17.8 fps`) | `273.5 -> 58.9 ms` (**`4.64x`**) | `915,907` | `97.0` | `0.0309 ms` (**`0.06%`**) | **YES / YES** (`15/15` frames) |
| `scene2` | 75 | `186.3 -> 47.1 ms` (**`3.96x`**, `21.2 fps`) | `192.6 -> 49.9 ms` (**`3.86x`**) | `771,534` | `82.0` | `0.0213 ms` (**`0.05%`**) | **YES / YES** (`15/15` frames) |
| `scene3` | 75 | `34.8 -> 19.3 ms` (**`1.80x`**, `51.8 fps`) | `38.6 -> 22.6 ms` (**`1.71x`**) | `85,091` | `56.0` | `0.0124 ms` (**`0.06%`**) | **YES / YES** (`15/15` frames) |

### 7.2 Software Mode (`node tools/phase3/crayon-fixtures.mjs` — Worker Path)

| Fixture | Preview Frames | `640x360` Old -> New Median ms (Speedup, FPS) | `1920x1080` Old -> New Median ms (Speedup) | Queries / Frame | Outlines / Frame | Guard Full-Check ms/frame (`%` of `640x360` Draw) | Pixels Identical (`640` / `1920`) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `scene0` | 45 | `183.1 -> 64.2 ms` (**`2.85x`**, `15.6 fps`) | `233.7 -> 115.6 ms` (**`2.02x`**) | `381,193` | `79.0` | `0.0249 ms` (**`0.04%`**) | **YES / YES** (`9/9` frames) |
| `scene1` | 75 | `298.9 -> 84.3 ms` (**`3.55x`**, `11.9 fps`) | `342.4 -> 127.4 ms` (**`2.69x`**) | `915,907` | `97.0` | `0.0333 ms` (**`0.04%`**) | **YES / YES** (`15/15` frames) |
| `scene2` | 75 | `216.5 -> 74.8 ms` (**`2.89x`**, `13.4 fps`) | `259.5 -> 121.0 ms` (**`2.14x`**) | `771,534` | `82.0` | `0.0214 ms` (**`0.03%`**) | **YES / YES** (`15/15` frames) |
| `scene3` | 75 | `67.2 -> 51.6 ms` (**`1.30x`**, `19.4 fps`) | `119.1 -> 103.4 ms` (**`1.15x`**) | `85,091` | `56.0` | `0.0124 ms` (**`0.02%`**) | **YES / YES** (`15/15` frames) |

- **Guard cost verdict:** The guard's full-content `Object.is` vertex check (`ringSame` / `xy` snapshot across all `56–97` outlines per frame) costs **`0.012–0.033 ms/frame`**, which is **`0.02%–0.07%` of draw time** — nearly two orders of magnitude below the `5%` threshold.

### 7.3 Frame Hashes (Old == New at Both Sizes and Modes)
- **`scene0` (frames `0, 10, ..., 80`):**
  - Software `640x360`: `62c12552, 5c4ef34f, dfadf924, 52ba9ae3, 5c5593c7, 551797ed, e23a7825, 955888c7, ef02718a`
  - Software `1920x1080`: `e21d3e9e, 147592c5, 1609fa38, c615218a, c739f6e8, af5b5fde, ba29c8b, ed8a61d3, dab31095`
  - GPU `640x360`: `69e62cda, 520c2a60, dadb91ae, c4756046, 4b8feedf, 8d201d8a, c0d166b8, a77c1cda, b690beca`
  - GPU `1920x1080`: `8c43e7ba, 23be35e2, 42207deb, 87d57f3c, 93541cd1, 81102efe, 2c44129a, 59c548d1, 6e17922a`
- **`scene1` (frames `0, 10, ..., 140`):**
  - Software `640x360`: `c3868171, bff7fd98, a72accdf, 4759cd24, 5b389d64, ac330808, 8037c988, 9fab2b72, c0618703, cfb8f8f2, 14339038, 5286837, 7aede521, 11187179, faf97d7e`
  - Software `1920x1080`: `2afcae22, cc74ea12, a7aadc87, 399ad10, 7ae5bf0f, a0d12941, 84dec529, 1698ff83, 9db45431, 3941ca61, 38f6ae5d, d2fbbcbc, 7b282941, b4681292, 8181e269`
  - GPU `640x360`: `6b06e721, 49f163cb, dce40f, bc8a047e, 4b7a2e15, d24e086, 73896c15, e8ab125f, 423e0b1a, fe5a699e, 14350430, b8bfd7f6, 409b854e, 10688085, c74b8bfa`
  - GPU `1920x1080`: `8e6aa0ca, ba6e9f66, 830c04b5, c3b853dd, 211439f7, 7db77652, 3cbb48c6, dea606f0, 6ce1030d, 1c76ab38, 4aae79bb, ac2606d3, 937f3d47, 9df88881, 996a3a63`
- **`scene2` (frames `0, 10, ..., 140`):**
  - Software `640x360`: `12c2392e, 9eda3f79, 79fd0240, 91f86737, 63ace030, 8a1622b9, a9fb4949, 880536d8, 874dc0a9, a5e70c54, ecda41e0, ccb6d640, 55b19982, 9cb4089a, 36bafb13`
  - Software `1920x1080`: `e4ac1a86, a91d165e, e5b2299b, ac3c985e, 7d249816, 6fc07da1, a5f7e4b8, ebfd7f03, d7cd13a5, cbc2c673, fd40bc57, d7eb1a2e, cad7faca, a1b3f88a, 671a068e`
  - GPU `640x360`: `d30626da, 3e3d2b9f, 31528ff1, e514d65, 1536d19a, ddc92b92, 6a8cd74b, c96a9b78, 4e0eff1f, 2293e3ad, 6f5b66f6, 21f1ff07, b223cb9e, c9df7181, a79e6231`
  - GPU `1920x1080`: `131e4fbf, d2a32112, e63ed37a, b096841d, 48491523, 8f01d950, 6b79462a, 255041f6, e81deb80, fecbdf32, 4eb58da9, f3a49b24, 1b593ef, 55aedf65, 8fe339ce`
- **`scene3` (frames `0, 10, ..., 140`):**
  - Software `640x360`: `7a2cbf66, 6e97be09, bd9b5132, a9b3943a, bb0cc6c5, 443a660b, 8e77339e, 6355c746, 36fd1456, 68c5e184, 34afb842, ca81559e, b34b546d, a195f964, 591bb7bc`
  - Software `1920x1080`: `99bc82c8, 7ad9e707, f11778e8, e9b7fabe, dfd9b108, 1760d62c, 63baa4d2, e182f580, 9fc1102e, 1a0cfda7, d5f53666, eab92e35, 5c67c827, 5513c2c4, 5c80aa44`
  - GPU `640x360`: `66c83bad, 54f0c639, cac2a271, 67123cec, ae095112, 7d899e40, 18bb8ab8, ede3e42a, bdb38560, 4356db90, a9133a12, 6987be2b, 5b494a71, 48c06ff5, 9ea11c79`
  - GPU `1920x1080`: `4b30ae1a, 645c0dc6, ca875ad6, e2c8ed60, 8a19580a, 4f1d6d69, 544b5b79, 68d08261, c8d24d3, bf908a0d, 778db9ce, aae3a604, 33343a6b, 3366ab0a, 84d63e62`

---

## 8. Other Hot Spots Observed (Reported Only, Not Changed)

1. **`hatchRuns` grid stepping + `keep(x, y)` `fractal()` evaluation (`gallery.ts:103-111`):**
   After `insideRing` reduces point-in-polygon time by `3–5x` on the crayon fixtures, the remaining `19–56 ms/frame` (GPU) / `51–84 ms/frame` (software) in `scene0..3` is dominated by `hatchRuns` stepping across the full bounding Circle of radius `R = hypot(w, h)/2 + gap` (visiting `~27%` corner points outside `[x0..x1, y0..y1]`), calling `keep(x, y)` (which evaluates 2-octave `fractal()` noise for shade/burnish), and stroking thousands of short segments.
2. **`paintedOil` (`~284–328 ms/frame` median in software and GPU):**
   Spends its frame time in CPU `ImageData` bristle/impasto pixel loops (`paintedOil.ts`), unaffected by `insideRing` or GPU canvas acceleration.
3. **`lighthouse` (`~111–119 ms/frame` GPU, `~178–271 ms/frame` software after `1.8x` speedup):**
   Remaining time is spent in `halftone()` (`core.ts:208-212`) evaluating `fractal()` and `nearField()` tone functions across ~30,000 dots per riso drum and rasterizing one huge compound `ctx.arc` path per drum.
4. **Software layer blur & texture masking (`fox`, `ranunculus`, `storybook`):**
   At `1920x1080`, `fox` (`223.8 ms` SW vs `55.1 ms` GPU), `ranunculus` (`292.9 ms` SW vs `84.1 ms` GPU), and `storybook` (`182.5 ms` SW vs `31.4 ms` GPU) spend most of their software render time in `Gfx.soften()` (multi-pass `drawImage` downscale/upscale blur) and `Gfx.tooth()` (`destination-in` pattern fills).
5. **First-frame cold setup (`stipple` `~950–1035 ms`, `scratchboard` `~635–775 ms`, `colouredPencil` `~595–630 ms`):**
   One-time module/cache initialization on frame 0 (e.g., Poisson/stipple point placement, `LynxField` distance/fur field in `scratchboardKit.ts`, and `tile()` `512x512` `fractal()` texture generation in `core.ts:227-239`), after which steady-state median frame times are `2–37 ms`.

---

## 9. Exact Commands & Flags

```bash
node packages/plate-engine/test/engine.test.mjs
PLATE_BROWSER_PATH="/Users/osamaehsaan/Code/Market_apps/VideoSaaS/experiments/anidoodle-try/pw-cache/chromium_headless_shell-1/chrome-headless-shell-mac-arm64/chrome-headless-shell" node packages/plate-engine/test/engine.test.mjs
node packages/plate-engine/test/inside-identity.mjs
node tools/phase3/engine-identity.mjs --out docs/phase3/engine-identity-result.json
node tools/phase3/engine-identity.mjs --gpu --out docs/phase3/engine-identity-result-gpu.json
node tools/phase3/crayon-fixtures.mjs
node tools/phase3/crayon-fixtures.mjs --gpu
```
Flags supported:
- `tools/phase3/engine-identity.mjs`: `[--base <commit>]` (default `23e1963`), `[--styles <comma-list>]`, `[--out <path.json>]`, `[--gpu]` (launches Chrome without `--disable-gpu`).
- `tools/phase3/crayon-fixtures.mjs`: `[--gpu]` (launches Chrome without `--disable-gpu`).

---

## 10. Anything Not Done

Nothing was skipped or left undone. All acceptance criteria (`(a)` through `(f)`) are complete.

---

## 11. Manager rerun (2026-11-05, under `.lock-timing`)

- **Software identity** (no lock needed): 67/67 items identical, 0 skipped, no first-draw differences; every row's frame hashes at both sizes equal Argon's run.
- **GPU identity** (`--gpu`): 66/67 identical, 0 skipped; 66/67 rows' hashes equal Argon's run. The one row flagged `fixture:balloon-0@9:16` (small, 360x640) is the old engine's own cold-GPU two-valued first draw, not an engine difference: frame 0 alone takes either `c3ad9c5f` or `bc276fb9` per fresh page, frames 1..4 are always identical, and across three fresh pages the OLD engine gave `c3ad, bc27, c3ad` and the NEW engine `bc27, c3ad, bc27`. Both engines produce exactly the same two values, so the tool's three-page majority vote called it "different" by chance. It is the same cold-GPU first-draw variance explained in section 3 (the full-size row for the same fixture was identical). Not rerun to a third time; treat the three-page vote as a known weakness of the tool for items whose cold draw is two-valued.
- **Crayon fixtures, GPU, median ms per frame at 640x360 (raw old -> new):** scene0 147.1 -> 32.5 (4.5x), scene1 266.8 -> 54.4 (4.9x), scene2 184.9 -> 46.8 (4.0x), scene3 34.5 -> 18.0 (1.9x); pixels identical at 640 and 1920 for all four; at 1920x1080 new = 35.5 / 57.6 / 52.2 / 23.2 ms. Guard full-content check: 0.012 to 0.030 ms per frame, 0.04 to 0.07 % of the 640x360 draw time (threshold 5 %). These agree with section 7 within the 15 % tolerance.
- Real speed-up to quote in the handoff: about 4 to 5x on the three heavy crayon fixtures and 1.9x on the light one; style plates such as lighthouse only 1.5 to 1.8x.
