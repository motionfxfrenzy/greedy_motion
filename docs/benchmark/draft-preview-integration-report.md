# Draft Preview Integration & All-Style Native Optimization Report

- **Worktree**: `/private/tmp/gm-draft-preview-integration` (`codex/draft-preview-integration`, base commit `453f10cbb1bf5d7c0df61e6cad539f77b62faffe`)
- **Raw Evidence Directory**: `/private/tmp/gm-draft-preview-integration-results` (`0700`)
- **Visual Review Server**: `node tools/benchmark/serve-visual-review.mjs` (`http://127.0.0.1:4477/visual-review.html`)
- **Host / Provenance**: macOS (`darwin` `arm64`), Desktop Google Chrome Headless `156.0`, viewport `1280×800` (`deviceScaleFactor = 1`), preview resolutions `640×360` (`16:9`) and `480×480` (`1:1`), export resolutions `1920×1080` (`16:9`) and `1080×1080` (`1:1`), `DEFAULT_WATCHDOG_MS = 2000`, `DEFAULT_HEARTBEAT_INTERVAL_MS = 500`, `DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME = 75000`
- **Date**: 2026-11-07
- **Status / Recommendation**: **`local-ready` on verified desktop Chromium host (awaiting owner visual sign-off on remaining styles/crops/motion and authorized staging rebundle; no deployment performed)**

---

## 1. Executive Summary

This integration implements **bounded Draft preview playback**, **debounced (250 ms) full-quality paused stills**, **explicit buffered Full playback mode**, a **single authoritative `draftTargetVerticesPerFrame` configuration (`NEXT_PUBLIC_DRAFT_TARGET_VERTICES`, default `75000`)**, and **per-style Draft rendering support** across `@videosaas/plate-engine` and the Next.js studio application (`frontend/lib/live/` and `frontend/components/`).

### Key Verified Results

1. **Production `WorkerHost` Watchdog (`DEFAULT_WATCHDOG_MS = 2000`) & `halftone` / `stipple` Cold Full Draw Fix (`real-app-autonomous-playback-and-audio.json` & `visual-crops-and-masks-summary.json`)**:
   - **Root Cause Found**: Profiling `halftone` Full cold seek (`12,467.6 ms`) under Chrome DevTools CPU Profiler revealed that `99.98%` of the `12.2 s` inside `inkDots` (`packages/plate-engine/src/canvas-core/halftoneKit.ts`) was spent in Blink's `CanvasPath::closePath()` (`7,653` profiler ticks on `c.closePath()` vs `1` tick / `2.0 ms` on `c.fill()`) because calling `closePath()` `66,909` times inside a single compound `c.beginPath()` triggers $O(M^2)$ subpath handling in Chromium. Because `inkDots` already loops `for (let k = 0; k <= sides; k++)` back to the start vertex and only calls `c.fill()` (which implicitly closes every subpath per the HTML5 Canvas 2D spec), removing the redundant `closePath()` inside `halftoneKit.ts` (`inkDots`) and `stipple.ts` (`inkRange`):
     - Reduced **`halftone` Full cold first seek from `12,467.6 ms` to `654.3 ms` (19.05× faster)** and **`Draft 75k` cold first seek from `671.0 ms` to `267.3 ms` (46.6× faster than original Full)**,
     - Reduced **`stipple` Full cold first seek from `607.0 ms` to `511.8 ms`** and **`Draft 75k` cold first seek to `154.4 ms`**,
     - Preserved **100% byte-identical Full output (`diffPixels = 0`, identical FNV-1a hashes `a7474527` at `480×480` preview and `6b54d759` at `1080×1080` export)** against untouched base commit `453f10cbb1bf5d7c0df61e6cad539f77b62faffe` across all tested frames!
   - **Real Next.js UI Heavy-Style Watchdog Verification (`DEFAULT_WATCHDOG_MS = 2000`, `heartbeat = 500ms`)**: Tested `halftone`, `stipple`, `paintedOil`, and `mellan` through the real Next.js `PlatePreview` UI across Draft playback -> rapid pause/play fencing (`80 ms < 250 ms` debounce cancelled cleanly) -> intentional pause 250 ms Full-quality still upgrade (`861.41 ms` `halftone`, `829.87 ms` `stipple`, `948.33 ms` `paintedOil`, `422.30 ms` `mellan`) -> explicit `Full` mode switch (`77.28 ms` `halftone`, `78.65 ms` `stipple`, `78.32 ms` `paintedOil`, `67.71 ms` `mellan`), with **`0` watchdog terminations** and **`0` `requestClip` (AWS) calls**.
2. **Bounded Worker & Heap Residency (`peakWorkersDuringPlay <= 2`), Backseek/Replay & 10 Lifecycle Cycles (`real-app-autonomous-playback-and-audio.json`)**:
   - **Root Cause Found & Fixed**: Previously, `PlatePlayer.recycle()` at scene boundaries called `WorkerHost.recycle("scene-boundary")`, which terminated the leaving scene's Worker and immediately spawned + initialized a fresh idle Worker and bootstrap `<iframe>` for the deactivated scene, causing `peakWorkersDuringPlay` to accumulate to `6` across a 6-scene film.
   - Updated `PlatePlayer.deactivate()` (incrementing `this.requestEpoch++` to fence any late in-flight frames from repopulating `FrameCache`), `PlatePlayer.recycle()` (calling `this.host.terminateIdle("scene-boundary")` when `!this.active`), and `PlatePlayer.releaseIdleWorker()` (releasing non-adjacent scenes on jump seeks).
   - Across the full 35.0 s (`1,050`-frame) autonomous 6-scene playback in the real Next.js app:
     - **`peakWorkersDuringPlay = 2`** and **`peakIframesDuringPlay = 2`** (`activeWorkers = 1, iframes = 1` at every 5 s checkpoint, rising to `2` only during the last `1.0 s` next-scene 6-frame head prefetch).
     - **Peak RAM `FrameCache`**: **`19.34 MiB` (`20,275,200` bytes <= `32.00 MiB` budget)**, **`0` `FrameStore` writes**, **`0` repeated blits**, **`1,043 / 1,050` unique frames presented** (`29.7 fps` over `35.07 s`), and real `window.AudioContext` drift **`p50 = 16.0 ms / p95 = 32.0 ms / max = 32.0 ms`**.
     - **Automatic natural-end cleanup**: `cacheBytes = 0`, `activeWorkers = 0`, `iframesAfterNaturalEnd = 0` with zero test-invoked cleanup calls.
     - **Backwards seek (`Scene 5 -> Scene 1 -> Scene 0`) & replay**: transparently respawned Scene 1 and Scene 0 Workers on demand (`backseekReplayMs = 96.42 ms`, `scene0PresentedFrame = 89`, `activeWorkers <= 2`, `0` late repopulation).
     - **10 Open / Play / Seek / Close (`about:blank`) UI cycles**: `10 / 10` cycles maintained `activeWorkers <= 2` during play and `0` iframes / `0` canvases after unmount.
3. **Owner-Requested `Draft 40k` (`draftTargetVerticesPerFrame = 40000`) Comparison Across Four Styles (`stipple`, `halftone`, `mellan`, `balloon`) & Recorded Owner Visual Feedback (`visual-crops-and-masks-summary.json`)**:
   - Benchmarked and rendered **`Draft 40k` (`40,000` target vertices)** across **`stipple`**, **`halftone`**, **`mellan`**, and **`balloon`** alongside `Full`, `Draft 75k`, `Draft 60k`, `Draft 6k`, and `Draft 4k` on `http://127.0.0.1:4477/visual-review.html` (visibly marking the other 5 styles as `40k not tested` and keeping the `75,000` production default unchanged):
     - **`stipple` (`frame 320/450`, `480×480` preview) at `Draft 40k`**: **`27,476` vertices** (vs `184,660` Full / `51,380` `75k` / `9,288` `6k`), Cold first-seek **`124.8 ms`**, Advancing-frame draw `p50 / p95 / max` **`1.6 / 1.9 / 1.9 ms`** (**`625.0 FPS`** derived draw rate), `exact IoU = 0.698`, `1px IoU = 0.836`, `coverage = 0.830`, `PSNR = 17.20 dB`.
     - **`halftone` (`frame 260/360`, `480×480` preview) at `Draft 40k`**: **`36,890` vertices** (vs `468,363` Full / `69,055` `75k` / `24,085` `6k`), Cold first-seek **`261.0 ms`**, Advancing-frame draw `p50 / p95 / max` **`1.6 / 2.4 / 2.5 ms`** (**`625.0 FPS`** derived draw rate), `exact IoU = 0.663`, `1px IoU = 0.945`, `coverage = 0.675`, `PSNR = 10.51 dB`.
     - **`mellan` (`frame 300/360`, `480×480` preview) at `Draft 40k`**: **`263,858` vertices** (vs `429,038` Full / `321,778` `75k` / `167,754` `6k`), Cold first-seek **`67.6 ms`**, Advancing-frame draw `p50 / p95 / max` **`40.3 / 43.5 / 45.9 ms`** (**`24.8 FPS`** derived draw rate), `exact IoU = 0.988`, `1px IoU = 1.000`, `coverage = 1.001`, `PSNR = 30.15 dB`.
     - **`balloon` (`frame 180/240`, `640×360` preview) at `Draft 40k`**: **`24,605` vertices** (vs `647,627` Full / `24,767` `75k` / `20,293` `6k`), Cold first-seek **`59.1 ms`**, Advancing-frame draw `p50 / p95 / max` **`14.3 / 18.5 / 18.9 ms`** (**`69.9 FPS`** derived draw rate), `exact IoU = 0.754`, `1px IoU = 0.988`, `coverage = 0.997`, `PSNR = 22.57 dB` (avoids the `minClosed = 3` floor degradation that caused `6k`/`4k` to be rejected).

---

## 2. Single Authoritative Configuration: `NEXT_PUBLIC_DRAFT_TARGET_VERTICES` & `draftTargetVerticesPerFrame`

- **Single Source of Truth**: `DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME = 75_000`, `MIN_DRAFT_TARGET_VERTICES_PER_FRAME = 500`, `MAX_DRAFT_TARGET_VERTICES_PER_FRAME = 2_000_000`, `DRAFT_PROFILE_VERSION = "v1"`, `validateDraftTargetVerticesPerFrame(value)`, and `resolveDraftTargetVerticesFromEnv(rawValue)` are defined in **`packages/plate-engine/src/canvas-core/core.ts`** and imported directly by **`frontend/lib/live/draft-profile.ts`**.
- **Environment Variable (`NEXT_PUBLIC_DRAFT_TARGET_VERTICES=75000`)**:
  - Documented in **`frontend/.env.example`** and read via statically analyzable `process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES` in `frontend/lib/live/draft-profile.ts`.
  - Unset, empty, non-numeric, non-finite, fractional, or out-of-range (`< 500` or `> 2000000`) values safely fall back to **`75000`**.
  - Programmatic setter `setDraftTargetVerticesPerFrame(value)` enforces strict `RangeError` validation and notifies all active `PlatePlayer` / `FilmPlayer` instances (`:tb4000:`, `:tb6000:`, `:tb40000:`, `:tb60000:`, `:tb75000:`).

---

## 3. Real Next.js App Autonomous 1,050-Frame Playback, Worker Residency, Heavy-Style Watchdog & Lifecycle Verification

### 3.1 Real Next.js App Autonomous 1,050-Frame (35.0 s) Playback & Worker Residency (`real-app-autonomous-playback-and-audio.json`)

Executed by `node tools/benchmark/run-real-app-playback-verification.mjs` against `/dev/plate-preview-fixture?project=e9ce7b08-759d-4604-a277-a2b9ec8763fc&state=live-c-ready` in headless Chromium (`1280×800`, `640×360` preview stage) with real `window.AudioContext` (`WebAudioFilmTimeline`), synthetic WAV voiceovers + music bed, and production `PlateLiveStage` RAF loop:

| Metric | Measured Value (`real-app-autonomous-playback-and-audio.json`) | Notes |
|---|---:|---|
| **Initial 6-Scene Ready & First Stage Blit (`initialReadyMs`)** | **`2,112.92 ms`** | Includes Next.js hydration, 6 bundle fetches, WAV decodes, and Scene 0 initial Draft runway |
| **Total Film Frames / Autonomous Play Duration** | **`1,050` frames (`35.07 s` / `35,924.03 ms` wall)** | Driven autonomously by `WebAudioFilmTimeline` (`AudioContext.currentTime`) + `PlateLiveStage` RAF |
| **Unique Presented `ImageBitmap` Frames (`uniquePresentedFrames`)** | **`1,043 / 1,050` (`99.3%`)** | Per-scene unique presented frames: `[90, 237, 206, 240, 135, 135]`; `1,043` total stage blits, **`0` repeated blits**, `2` late frames (`29.7 fps` displayed) |
| **Real `window.AudioContext` Drift (`p50 / p95 / max`)** | **`16.0 ms / 32.0 ms / 32.0 ms`** | Measured across `2,088` RAF samples comparing `WebAudioFilmTimeline` vs presented bitmap frame |
| **Peak Active Workers / Bootstrap Iframes During Play** | **`2` Workers / `2` iframes** | `1` Worker during steady play; `2` only during last `1.0 s` next-scene 6-frame head prefetch (`deactivate()` + `recycle()` calls `terminateIdle("scene-boundary")`) |
| **Peak RAM `FrameCache` During Playback** | **`19.34 MiB` (`20,275,200` bytes)** | Bounded within `32.00 MiB` (`33,554,432` bytes) shared film budget; **`0` `FrameStore` writes** |
| **Automatic Natural-End Cleanup (`naturalEndCleanupTriggered`)** | **`true` (`cacheBytes = 0`, `activeWorkers = 0`, `iframes = 0`)** | Triggered automatically by `PlateLiveStage` at the natural end of Scene 5 with **zero** test-invoked cleanup calls |
| **Post-End Paused Full Still Upgrade (`pauseUpgradeLatencyMs`)** | **`653.27 ms` (`"showing-still"`, `quality = "full"`, frame `127`)** | Includes 250 ms debounce + Scene 1 Worker respawn + Full-quality still draw (`activeWorkers = 1`) |
| **Backwards Seek (`Scene 1 -> Scene 0`) & Replay (`backseekReplayMs`)** | **`96.42 ms` (`scene0PresentedFrame = 89`, `activeWorkers <= 2`)** | Transparently respawned Scene 0 Worker after prior scene-boundary & natural-end termination with `0` late repopulation |
| **10 Open / Play / Boundary-Cross / Close (`about:blank`) Cycles** | **`10 / 10 PASS` (`activeWorkers <= 2` live; `0` iframes / `0` canvases on close)** | Verified across 10 consecutive full page mount/play/seek/unmount cycles |

### 3.2 Real Next.js UI Heavy-Style Production Watchdog Verification (`DEFAULT_WATCHDOG_MS = 2000`, `heartbeat = 500ms`)

Tested `halftone` (`illus-halftone`, 420 frames with `firstSheet: 0` so all 66,909 dots draw from frame 0), `stipple` (`illus-stipple`, 450 frames), `paintedOil` (`illus-painted-oil`, 240 frames), and `mellan` (`illus-mellan`, 90 frames animated spiral) through the real Next.js UI (`real-app-autonomous-playback-and-audio.json`):

| Style (`look`) | Draft Stage Ready (`ms`) | Short Pause `< 250ms` Fencing State | Intentional Pause -> Full Still Upgrade (`ms`, incl. 250ms debounce) | Explicit `Full` Mode Switch Ready (`ms`) | Presented Quality After Pause & Full Switch | Mode After Full Play | Watchdog Terminations / `requestClip` (AWS) Calls |
|---|---:|---|---:|---:|---|---|---:|
| **`halftone` (`illus-halftone`)** | `44.27 ms` | `"pending-still"` (cancelled on resume) | **`861.41 ms`** (`< 2000 ms` watchdog) | **`77.28 ms`** | `"full"` (frame `222`) | `"live"` (`predraw`) | **`0 / 0`** |
| **`stipple` (`illus-stipple`)** | `779.50 ms` | `"pending-still"` (cancelled on resume) | **`829.87 ms`** (`< 2000 ms` watchdog) | **`78.65 ms`** | `"full"` (frame `236`) | `"live"` (`ok`) | **`0 / 0`** |
| **`paintedOil` (`illus-painted-oil`)** | `1,188.17 ms` | `"pending-still"` (cancelled on resume) | **`948.33 ms`** (`< 2000 ms` watchdog) | **`78.32 ms`** | `"full"` (frame `131`) | `"live"` (`predraw`) | **`0 / 0`** |
| **`mellan` (`illus-mellan`)** | `258.27 ms` | `"pending-still"` (cancelled on resume) | **`422.30 ms`** (`< 2000 ms` watchdog) | **`67.71 ms`** | `"full"` (frame `89`) | `"live"` (`ok`) | **`0 / 0`** |

### 3.3 Paced Sequential-Frame `FilmPlayer` Harness & 10-Loop Lifecycle Stress Test (`full-1050-frame-film-and-lifecycle.json`)

Standalone `createFilmPlayer` paced 30 fps frame-stepper (`1,050` frames across all 6 crayon scenes; note that `real-app-autonomous-playback-and-audio.json` in §3.1 is the authoritative real-app autonomous RAF + `AudioContext` benchmark):
- **Draft 75k (3-run median)**: `1,050 / 1,050` unique frames shown, `443.1 ms` startup wait (vs `4,411.0 ms` in Full, **9.9× faster**), `0 ms` scene-boundary waits across `S0->S1..S4->S5`, `0` warm buffering pauses, `27.25 MiB` peak RAM cache (`<= 32 MiB`), `0` `FrameStore` writes, and `10 / 10` destroy loops with `createdBitmaps === closedBitmaps` (`0` leaked bitmaps/Workers/iframes).

---

## 4. Per-Style Page-Level `FILM.seek` Timings, Derived Draw-Rate FPS & `Draft 40k` Deep-Dive (`visual-crops-and-masks-summary.json`)

### 4.1 Timing Methodology & Label Definitions
- **Normal Headless Chrome DOM `<canvas>` vs Forced-SwiftShader**:
  - `measureGpuProfile` runs synchronous `window.FILM.seek()` and `await createImageBitmap(canvas)` on a DOM `<canvas>` in a normal headless Chrome `newPage` (default browser rendering backend enabled, without `--use-angle=swiftshader --disable-gpu`; hardware GPU rasterization is not asserted without GPU backend diagnostics), whereas `swColdFirstSeekMs` runs in a separate forced-SwiftShader instance (`--use-gl=angle --use-angle=swiftshader --disable-gpu`) used for deterministic pixel hashing.
  - Actual Worker (`OffscreenCanvas` + `MessagePort` transfer) and live-player (`PlatePlayer` / `PlateLiveStage`) playback metrics are measured and reported separately in Section 3 (`real-app-autonomous-playback-and-audio.json` and `full-1050-frame-film-and-lifecycle.json`).
- **Derived draw-rate FPS (`1000 / Advancing-frame p50 ms`)**: Derived from the median per-frame draw time across 10 consecutive advancing frames (`f - 15 .. f - 6` × 3 repeats = 30 samples per profile). This is a derived draw rate (`1000 / p50 ms`), **not** achieved display FPS. Scenes whose advancing-frame draw time exceeds `33.33 ms` (`< 30.0 FPS` derived draw rate, such as `mellan` at `75k` / `60k` / `40k` / `6k`) buffer locally in `PlatePlayer`'s RAM runway without calling AWS `requestClip`.
- **Representative Heavy `mellan` Frame Selection (`frame 300 / 360`)**: Bundled as a 360-frame unspooling scene (`progress = Math.min(1, (f + 1) / 300)`), **`frame 300`** (`progress = 1.0`) shows the **100% fully developed lit moon engraving** across the `480×480` (`1080×1080` logical) plate, while the 10-frame advancing window (`frames 285..294`) advances `progress` from `0.953` to `0.983` (`95.3%–98.3%` of peak spiral vertex load).

### 4.2 Complete 9-Style Timing, Derived Draw-Rate FPS & Vertex Table (Including `Draft 40k` on `stipple`, `halftone`, `mellan`, and `balloon`)

All measurements below were collected sequentially under `/Users/osamaehsaan/Code/Market_apps/.lock-timing` across `>= 3` repeats (`30` advancing-frame samples per profile) and are interactive on **`http://127.0.0.1:4477/visual-review.html`**:

| Style (`look`, frame) | Profile | Total Vertices | Derived Draw-Rate FPS (`1000/p50`) | 30 FPS (`33.3 ms`) Target | Advancing-Frame Draw Time `p50 / p95 / max` (`ms`) | Cold First-Seek Time (`ms`, init+build) | Warm Same-Frame Seek (`ms`) | Draw + Bitmap-Ready Time (`ms`, DOM probe) | Forced-SwiftShader Cold 1st Seek (`ms`) |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|
| **`stipple` (`320/450`)** | **Full (Ref)** | 184,660 | `588.2 FPS` | `<= 33.3 ms` | `1.7 / 1.9 / 2.2 ms` | 518.3 ms | 3.7 ms | 2.6 ms | 600.5 ms |
| **`stipple` (`320/450`)** | **Draft 75k (Default)** | **51,380** | **`555.6 FPS`** | **`<= 33.3 ms`** | **`1.8 / 2.0 / 2.0 ms`** | **151.1 ms (3.43×)** | **2.2 ms** | **1.6 ms** | 189.5 ms |
| **`stipple` (`320/450`)** | **Draft 60k** | **41,244** | **`625.0 FPS`** | **`<= 33.3 ms`** | **`1.6 / 1.9 / 2.0 ms`** | **141.4 ms (3.67×)** | **2.1 ms** | **1.7 ms** | 182.5 ms |
| **`stipple` (`320/450`)** | **Draft 40k *(New)*** | **27,476** | **`625.0 FPS`** | **`<= 33.3 ms`** | **`1.6 / 1.9 / 1.9 ms`** | **124.8 ms (4.15×)** | **2.2 ms** | **1.6 ms** | 108.8 ms |
| **`stipple` (`320/450`)** | **Draft 6k** | **9,288** *(floor)* | **`370.4 FPS`** | **`<= 33.3 ms`** | **`2.7 / 3.9 / 4.4 ms`** | **109.0 ms (4.76×)** | **3.4 ms** | **2.9 ms** | 80.8 ms |
| **`stipple` (`320/450`)** | **Draft 4k** | **5,980** *(floor)* | **`370.4 FPS`** | **`<= 33.3 ms`** | **`2.7 / 3.9 / 4.5 ms`** | **100.3 ms (5.17×)** | **3.3 ms** | **3.0 ms** | 81.2 ms |
| **`halftone` (`260/360`)** | **Full (Ref)** | 468,363 | `769.2 FPS` | `<= 33.3 ms` | `1.3 / 2.4 / 2.6 ms` | **617.3 ms** *(was 12,467.6 ms)* | 8.2 ms | 2.1 ms | 702.8 ms |
| **`halftone` (`260/360`)** | **Draft 75k (Default)** | **69,055** | **`666.7 FPS`** | **`<= 33.3 ms`** | **`1.5 / 2.4 / 2.5 ms`** | **265.7 ms (2.32× vs fixed Full; 46.9× vs old Full)** | **8.2 ms** | **2.1 ms** | 265.0 ms |
| **`halftone` (`260/360`)** | **Draft 60k** | **55,350** | **`625.0 FPS`** | **`<= 33.3 ms`** | **`1.6 / 2.4 / 2.5 ms`** | **264.2 ms** | **8.2 ms** | **2.0 ms** | 260.0 ms |
| **`halftone` (`260/360`)** | **Draft 40k *(New)*** | **36,890** | **`625.0 FPS`** | **`<= 33.3 ms`** | **`1.6 / 2.4 / 2.5 ms`** | **261.0 ms (2.37×)** | **8.1 ms** | **2.0 ms** | 230.0 ms |
| **`halftone` (`260/360`)** | **Draft 6k** | **24,085** *(floor)* | **`625.0 FPS`** | **`<= 33.3 ms`** | **`1.6 / 2.5 / 2.7 ms`** | **252.0 ms** | **8.1 ms** | **2.0 ms** | 250.0 ms |
| **`halftone` (`260/360`)** | **Draft 4k** | **16,070** *(floor)* | **`625.0 FPS`** | **`<= 33.3 ms`** | **`1.6 / 2.5 / 2.6 ms`** | **255.0 ms** | **8.1 ms** | **2.0 ms** | 221.2 ms |
| **`mellan` (`300/360`)** | **Full (Ref)** | 429,038 | `19.6 FPS` | `> 33.3 ms` (buffers locally) | `51.0 / 56.2 / 60.0 ms` | 109.2 ms | 65.5 ms | 59.7 ms | 142.3 ms |
| **`mellan` (`300/360`)** | **Draft 75k (Default)** | **321,778** *(>target floor)* | **`22.7 FPS`** | `> 33.3 ms` (buffers locally) | **`44.0 / 46.1 / 46.7 ms`** | **80.8 ms** | **53.4 ms** | **50.1 ms** | 97.6 ms |
| **`mellan` (`300/360`)** | **Draft 60k** | **299,038** *(>target floor)* | **`23.5 FPS`** | `> 33.3 ms` (buffers locally) | **`42.5 / 45.2 / 47.2 ms`** | **73.5 ms** | **51.0 ms** | **48.1 ms** | 91.8 ms |
| **`mellan` (`300/360`)** | **Draft 40k *(New)*** | **263,858** *(>target floor)* | **`25.0 FPS`** | `> 33.3 ms` (buffers locally) | **`40.0 / 42.7 / 43.8 ms`** | **73.7 ms** | **46.9 ms** | **46.5 ms** | 82.8 ms |
| **`mellan` (`300/360`)** | **Draft 6k** | **167,754** *(>target floor)* | **`29.9 FPS`** | `> 33.3 ms` (buffers locally) | **`33.4 / 34.8 / 34.9 ms`** | **50.7 ms** | **38.8 ms** | **36.9 ms** | 60.7 ms |
| **`mellan` (`300/360`)** | **Draft 4k *(Accepted Control)*** | **156,600** *(>target floor)* | **`30.3 FPS`** | **`<= 33.3 ms` (meets 30fps)** | **`33.0 / 34.5 / 34.5 ms`** | **47.8 ms** | **37.9 ms** | **36.7 ms** | 85.8 ms |
| **`mellan` (`300/360`)** | **Draft 2k (`arcStep`, Pending Review)** | **99,800** *(>target floor)* | **`36.1 FPS`** | **`<= 33.3 ms` (meets 30fps)** | **`27.7 / 29.5 / 30.5 ms`** | **34.3 ms** | **31.5 ms** | **31.0 ms** | 44.2 ms |
| **`mellan` (`300/360`)** | **Draft 1k (`arcStep`, Pending Review)** | **63,604** *(>target floor)* | **`39.7 FPS`** | **`<= 33.3 ms` (meets 30fps)** | **`25.2 / 27.2 / 27.4 ms`** | **27.0 ms** | **28.2 ms** | **28.0 ms** | 36.5 ms |
| **`mellan` (`300/360`)** | **Draft 500 (`arcStep`, Pending Review)** | **40,542** *(>target floor)* | **`42.2 FPS`** | **`<= 33.3 ms` (meets 30fps)** | **`23.7 / 24.4 / 24.6 ms`** | **20.3 ms** | **26.4 ms** | **25.7 ms** | 30.5 ms |
| **`mellan` (`300/360`)** | **Pitch 75% Turns (`effPitch=8.27px`, Chosen)** | **280,164** *(>target floor)* | **`33.3 FPS`** | **`<= 33.3 ms` (meets 30fps)** | **`30.0 / 32.0 / 32.2 ms`** | **74.0 ms** | **38.7 ms** | **36.1 ms** | 75.4 ms |
| **`mellan` (`300/360`)** | **Pitch 75% + 4k `arcStep` *(New Combined)*** | **118,080** *(>target floor)* | **`54.9 FPS`** | **`<= 33.3 ms` (1.65× vs Pitch75)** | **`18.2 / 19.1 / 19.6 ms`** | **35.6 ms** | **21.5 ms** | **21.2 ms** | 36.2 ms |
| **`mellan` (`300/360`)** | **Pitch 50% Turns (`effPitch=12.40px`)** | **154,138** *(>target floor)* | **`65.8 FPS`** | **`<= 33.3 ms` (2.17× vs 4k)** | **`15.2 / 17.6 / 18.1 ms`** | **43.0 ms** | **22.8 ms** | **18.7 ms** | 37.9 ms |
| **`mellan` (`300/360`)** | **Pitch 25% Turns (`effPitch=24.80px`)** | **56,248** | **`166.7 FPS`** | **`<= 33.3 ms` (8.50× vs Full)** | **`6.0 / 7.1 / 8.2 ms`** | **22.6 ms** | **7.9 ms** | **7.3 ms** | 15.8 ms |
| **`balloon` (`180/240`)** | **Full (Ref)** | 647,627 | `13.3 FPS` | `> 33.3 ms` (buffers locally) | `75.1 / 88.6 / 90.8 ms` | 144.5 ms | 90.6 ms | 77.3 ms | 177.2 ms |
| **`balloon` (`180/240`)** | **Draft 75k *(Approved)*** | **24,767** | **`70.9 FPS`** | **`<= 33.3 ms` (5.33×)** | **`14.1 / 16.4 / 16.9 ms`** | **65.6 ms** | **16.0 ms** | **15.2 ms** | 74.8 ms |
| **`balloon` (`180/240`)** | **Draft 60k** | **24,697** | **`68.0 FPS`** | **`<= 33.3 ms`** | **`14.7 / 17.6 / 18.5 ms`** | **53.8 ms** | **17.0 ms** | **15.9 ms** | 59.8 ms |
| **`balloon` (`180/240`)** | **Draft 40k *(New)*** | **24,605** | **`69.9 FPS`** | **`<= 33.3 ms` (5.25×)** | **`14.3 / 18.5 / 18.9 ms`** | **59.1 ms** | **14.6 ms** | **14.4 ms** | 57.1 ms |
| **`balloon` (`180/240`)** | **Draft 6k *(Rejected)*** | **20,293** | **`70.9 FPS`** | **`<= 33.3 ms`** | **`14.1 / 16.8 / 17.0 ms`** | **55.5 ms** | **15.4 ms** | **15.1 ms** | 61.3 ms |
| **`balloon` (`180/240`)** | **Draft 4k *(Rejected)*** | **19,267** | **`79.4 FPS`** | **`<= 33.3 ms`** | **`12.6 / 15.7 / 16.3 ms`** | **57.0 ms** | **14.4 ms** | **14.3 ms** | 59.3 ms |
| **`paintedOil` (`180/240`)** | **Full (Ref)** | 856,800 | `90.9 FPS` | `<= 33.3 ms` | `11.0 / 13.1 / 14.4 ms` | 641.6 ms | 10.9 ms | 11.3 ms | 643.7 ms |
| **`paintedOil` (`180/240`)** | **Draft 75k *(Approved)*** | **196,912** | **`222.2 FPS`** | **`<= 33.3 ms`** | **`4.5 / 5.7 / 5.8 ms` (2.44×)** | **159.5 ms (4.02×)** | **5.1 ms** | **5.0 ms** | 163.1 ms |
| **`paintedOil` (`180/240`)** | **Draft 60k** | **99,712** | **`270.3 FPS`** | **`<= 33.3 ms`** | **`3.7 / 4.3 / 5.0 ms` (2.97×)** | **101.2 ms (6.34×)** | **3.7 ms** | **3.6 ms** | 92.4 ms |
| **`paintedOil` (`180/240`)** | **Draft 6k** | **45,560** | **`384.6 FPS`** | **`<= 33.3 ms`** | **`2.6 / 3.1 / 3.1 ms` (4.23×)** | **66.0 ms (9.72×)** | **2.8 ms** | **2.9 ms** | 55.3 ms |
| **`paintedOil` (`180/240`)** | **Draft 4k** | **30,409** | **`454.5 FPS`** | **`<= 33.3 ms`** | **`2.2 / 3.2 / 4.6 ms` (5.00×)** | **49.9 ms (12.86×)** | **2.5 ms** | **2.4 ms** | 57.9 ms |
| **`pocketWatch` (`180/240`)** | **Full (Ref)** | 280,625 | `24.9 FPS` | `> 33.3 ms` (buffers locally) | `40.1 / 44.6 / 44.7 ms` | 88.5 ms | 43.8 ms | 39.1 ms | 89.4 ms |
| **`pocketWatch` (`180/240`)** | **Draft 75k (Default)** | **44,049** | **`67.1 FPS`** | **`<= 33.3 ms` (2.69×)** | **`14.9 / 17.3 / 17.3 ms`** | **38.2 ms (2.32×)** | **19.6 ms** | **14.5 ms** | 32.5 ms |
| **`pocketWatch` (`180/240`)** | **Draft 60k** | **44,049** | **`66.7 FPS`** | **`<= 33.3 ms`** | **`15.0 / 16.2 / 16.2 ms`** | **40.8 ms** | **19.6 ms** | **14.7 ms** | 24.1 ms |
| **`pocketWatch` (`180/240`)** | **Draft 6k** | **21,785** | **`73.5 FPS`** | **`<= 33.3 ms`** | **`13.6 / 15.4 / 17.2 ms`** | **37.9 ms** | **13.7 ms** | **13.1 ms** | 21.7 ms |
| **`pocketWatch` (`180/240`)** | **Draft 4k** | **18,297** | **`78.1 FPS`** | **`<= 33.3 ms`** | **`12.8 / 14.3 / 14.9 ms`** | **39.5 ms** | **13.2 ms** | **12.2 ms** | 23.4 ms |
| **`blueprint` (`70/90`)** | **Full (Ref)** | 44,750 | `90.1 FPS` | `<= 33.3 ms` | `11.1 / 14.3 / 14.7 ms` | 59.1 ms | 13.9 ms | 11.6 ms | 64.3 ms |
| **`blueprint` (`70/90`)** | **Draft 75k (Default)** | **4,870** | **`123.5 FPS`** | **`<= 33.3 ms`** | **`8.1 / 10.7 / 11.3 ms`** | **34.9 ms** | **10.5 ms** | **9.4 ms** | 32.4 ms |
| **`blueprint` (`70/90`)** | **Draft 60k** | **4,870** | **`112.4 FPS`** | **`<= 33.3 ms`** | **`8.9 / 9.6 / 9.7 ms`** | **30.0 ms** | **10.1 ms** | **8.3 ms** | 28.1 ms |
| **`blueprint` (`70/90`)** | **Draft 6k** | **3,810** | **`112.4 FPS`** | **`<= 33.3 ms`** | **`8.9 / 10.4 / 11.0 ms`** | **30.7 ms** | **11.4 ms** | **9.4 ms** | 23.9 ms |
| **`blueprint` (`70/90`)** | **Draft 4k** | **3,252** | **`128.2 FPS`** | **`<= 33.3 ms`** | **`7.8 / 9.2 / 10.4 ms`** | **31.1 ms** | **10.3 ms** | **7.7 ms** | 29.2 ms |
| **`embroidery` (`180/240`)** | **Full (Ref)** | 81,700 | `69.0 FPS` | `<= 33.3 ms` | `14.5 / 16.1 / 16.1 ms` | 60.2 ms | 15.9 ms | 14.6 ms | 57.9 ms |
| **`embroidery` (`180/240`)** | **Draft 75k *(Approved)*** | **31,304** | **`87.0 FPS`** | **`<= 33.3 ms`** | **`11.5 / 12.4 / 12.5 ms`** | **45.5 ms** | **12.6 ms** | **11.1 ms** | 44.0 ms |
| **`embroidery` (`180/240`)** | **Draft 60k** | **29,708** | **`88.5 FPS`** | **`<= 33.3 ms`** | **`11.3 / 12.3 / 13.9 ms`** | **44.5 ms** | **12.6 ms** | **11.4 ms** | 41.1 ms |
| **`embroidery` (`180/240`)** | **Draft 6k** | **17,622** | **`101.0 FPS`** | **`<= 33.3 ms`** | **`9.9 / 11.3 / 11.4 ms`** | **41.9 ms** | **10.6 ms** | **9.8 ms** | 55.1 ms |
| **`embroidery` (`180/240`)** | **Draft 4k** | **15,422** | **`105.3 FPS`** | **`<= 33.3 ms`** | **`9.5 / 10.8 / 20.3 ms`** | **42.1 ms** | **10.4 ms** | **9.2 ms** | 35.6 ms |
| **`charcoalErasure` (`180/240`)** | **Full (Ref)** | 14,596 | `97.1 FPS` | `<= 33.3 ms` | `10.3 / 12.2 / 14.8 ms` | 76.7 ms | 11.0 ms | 10.3 ms | 96.3 ms |
| **`charcoalErasure` (`180/240`)** | **Draft 75k (Default)** | **7,596** | **`122.0 FPS`** | **`<= 33.3 ms`** | **`8.2 / 11.2 / 11.4 ms`** | **46.8 ms** | **10.9 ms** | **9.0 ms** | 63.2 ms |
| **`charcoalErasure` (`180/240`)** | **Draft 60k** | **7,112** | **`109.9 FPS`** | **`<= 33.3 ms`** | **`9.1 / 10.9 / 11.9 ms`** | **44.4 ms** | **10.0 ms** | **10.8 ms** | 50.8 ms |
| **`charcoalErasure` (`180/240`)** | **Draft 6k** | **4,252** | **`101.0 FPS`** | **`<= 33.3 ms`** | **`9.9 / 14.1 / 18.6 ms`** | **48.6 ms** | **10.6 ms** | **11.0 ms** | 48.6 ms |
| **`charcoalErasure` (`180/240`)** | **Draft 4k** | **3,548** | **`126.6 FPS`** | **`<= 33.3 ms`** | **`7.9 / 12.4 / 13.2 ms`** | **46.1 ms** | **11.2 ms** | **9.5 ms** | 49.2 ms |

---

## 5. Original Base (`453f10c`) Full/Export Parity vs Cache-Isolation Checks (`base-453f10c-vs-modified-full-parity.json`)

- Extracted the untouched base engine from `git archive 453f10cbb1bf5d7c0df61e6cad539f77b62faffe packages/plate-engine` and compared its rendered output against the modified engine's `Full` mode (`seek(f, "full")`) — both fresh and immediately after `Draft` seeks on the same page — at **both preview scale (`640×360` / `480×480`) and full `1080p` export scale (`1920×1080` / `1080×1080`)** across all 11 style families (`balloon-scene3`, `blueprint`, `pocketWatch`, `toyBrick`, `woodcut`, `paintedOil`, `embroidery`, `charcoalErasure`, `stipple`, `halftone`, `mellan`).
- Result: **100% byte-identical (`diffPixels = 0`, identical FNV-1a hashes)** across all checks, with **zero updated goldens**.

---

## 6. Visual, Silhouette Mask, Coverage & Crop Analysis (`visual-crops-and-masks-summary.json`) & Recorded Owner Visual Feedback

**Scope of Recorded Owner Visual Feedback**: All owner feedback below applies strictly to the viewed comparison stills/crops on `visual-review.html` and does **not** constitute blanket motion/production sign-off. The global default remains **`75,000` (`NEXT_PUBLIC_DRAFT_TARGET_VERTICES=75000`)**, and no per-style production defaults have been introduced yet.

| Style (`look`) | Recorded Owner Visual Feedback (Viewed Comparison Stills/Crops) | Exact Pixel Mask IoU (`75k / 60k / [40k] / 6k / 4k`) | 1px-Dilated Mask IoU (`75k / 60k / [40k] / 6k / 4k`) | Foreground Coverage Ratio (`75k / 60k / [40k] / 6k / 4k`) | BBox IoU (`75k`) | PSNR dB (`75k / 60k / [40k] / 6k / 4k`) | Tradeoff & Default Policy Notes |
|---|---|---|---|---|---|---|---|
| **`balloon` (`illus-balloon`)** | **`75k` Approved (2026-11-06) · `4k` & `6k` Rejected · `40k` Awaits Review** | `0.754 / 0.754 / 0.754 / 0.752 / 0.748` | `0.988 / 0.988 / 0.988 / 0.988 / 0.988` | `0.997 / 0.997 / 0.997 / 0.996 / 0.993` | `1.000` | `22.58 / 22.58 / 22.57 / 20.56 / 20.04` | `40k` (`24,605` vertices, `14.3 ms` advancing p50 = `69.9 FPS` derived draw rate, `22.57 dB` PSNR) preserves `minClosed = 8` without triggering the `minClosed = 3` floor degradation that caused `6k`/`4k` to be rejected. |
| **`stipple` (`illus-stipple`)** | **`40k` & `75k` Await Owner Review** | `0.750 / 0.737 / 0.698 / 0.426 / 0.287` | `0.870 / 0.863 / 0.836 / 0.694 / 0.610` | `0.906 / 0.881 / 0.830 / 0.486 / 0.322` | `0.987` | `18.28 / 17.94 / 17.20 / 15.02 / 14.36` | `40k` (`27,476` vertices = `6,869` dots, `124.8 ms` cold / `1.6 ms` advancing) retains `0.830` coverage and `0.836` 1px IoU vs `75k` (`51,380` vertices = `12,845` dots, `151.1 ms` cold / `1.8 ms` advancing, `0.906` coverage). |
| **`halftone` (`illus-halftone`)** | **`40k` & `75k` Await Owner Review** | `0.773 / 0.731 / 0.663 / 0.604 / 0.558` | `0.978 / 0.972 / 0.945 / 0.896 / 0.836` | `0.784 / 0.744 / 0.675 / 0.617 / 0.571` | `1.000` | `11.13 / 10.86 / 10.51 / 10.17 / 9.94` | `40k` (`36,890` vertices = `7,378` dots, `261.0 ms` cold / `1.6 ms` advancing) retains `0.945` 1px-dilated IoU and `0.675` coverage vs `75k` (`69,055` vertices = `13,811` dots, `265.7 ms` cold / `1.5 ms` advancing, `0.978` 1px IoU). |
| **`mellan` (`illus-mellan`)** | **`4k` & `Pitch 75%` Accepted · `Pitch 75% + 4k arcStep` Awaiting Review** | `0.988 / 0.988 / 0.988 / 0.987 / 0.987` (`2k/1k/500`: `0.986 / 0.984 / 0.979`; `Pitch 75%`: `0.840`; `Pitch 75%+4k`: `0.841`; `Pitch 50%/25%`: `0.793 / 0.724`) | `1.000 / 1.000 / 1.000 / 1.000 / 1.000` (`2k/1k/500`: `1.000`; `Pitch 75%` & `Pitch 75%+4k`: `1.000`; `Pitch 50%/25%`: `0.981 / 0.893`) | `1.000 / 1.000 / 1.001 / 1.001 / 1.001` (`2k/1k/500`: `1.001`; `Pitch 75%` & `Pitch 75%+4k`: `0.954`; `Pitch 50%/25%`: `0.894 / 0.797`) | `1.000` | `30.40 / 30.29 / 30.15 / 29.70 / 29.61` (`2k/1k/500`: `29.30 / 28.73 / 27.23`; `Pitch 75%`: `9.82`; `Pitch 75%+4k`: `9.81`; `Pitch 50%/25%`: `8.87 / 8.61`) | Combining `Pitch 75% Turns` (`effPitch=8.27px`) with `4k arcStep` (`3.84px`) reduces vertices from `280,164` (`Pitch 75%`) / `156,600` (`4k`) to **`118,080`**, cutting DOM advancing p50 to **`18.2 ms` (`54.9 FPS` derived draw rate)**, DOM draw+bitmap to **`21.2 ms`**, and cold first-seek to **`35.6 ms`**, while keeping the exact same `0.954` coverage, `0.841` exact IoU, `1.000` 1px IoU, and `9.81 dB` PSNR as `Pitch 75%`. |
| **`charcoalErasure` (`illus-charcoal-erasure`)** | **`6k` Acceptable** (`40k` not tested) | `0.677 / 0.677 / — / 0.677 / 0.677` | `0.982 / 0.982 / — / 0.982 / 0.982` | `1.006 / 1.006 / — / 1.005 / 1.005` | `1.000` | `27.59 / 27.58 / — / 27.57 / 27.53` | `6k` (`4,252` vertices, `9.9 ms` advancing p50 = `101.0 FPS` derived draw rate) is acceptable per owner review. |
| **`blueprint` (`illus-blueprint`)** | **`4k` OR `6k` Acceptable — Final Choice Pending** (`40k` not tested) | `0.801 / 0.801 / — / 0.800 / 0.810` | `0.883 / 0.883 / — / 0.882 / 0.887` | `0.989 / 0.989 / — / 0.988 / 0.993` | `1.000` | `37.33 / 37.33 / — / 37.24 / 37.66` | Both `6k` (`3,810` vertices, `8.9 ms` advancing) and `4k` (`3,252` vertices, `7.8 ms` advancing) are acceptable; final choice pending. |
| **`pocketWatch` (`illus-pocket-watch`)** | **`4k` OR `6k` Acceptable — Final Choice Pending** (`40k` not tested) | `0.851 / 0.851 / — / 0.850 / 0.829` | `0.951 / 0.951 / — / 0.950 / 0.938` | `0.954 / 0.954 / — / 0.950 / 0.939` | `0.988` | `33.07 / 33.07 / — / 33.01 / 31.72` | Both `6k` (`21,785` vertices, `13.6 ms` advancing) and `4k` (`18,297` vertices, `12.8 ms` advancing) are acceptable; final choice pending. |
| **`paintedOil` (`illus-painted-oil`)** | **`75k` Approved (2026-11-06) · `6k` Acceptable** (`40k` not tested) | `0.988 / 0.987 / — / 0.986 / 0.986` | `0.996 / 0.996 / — / 0.996 / 0.996` | `1.000 / 1.001 / — / 1.001 / 1.004` | `1.000` | `31.50 / 29.30 / — / 28.06 / 28.20` | `6k` (`45,560` vertices, `66.0 ms` cold / `2.6 ms` advancing = `384.6 FPS` derived draw rate) is acceptable per owner review. |
| **`embroidery` (`illus-embroidery`)** | **`75k` Approved (2026-11-06) · `4k` OR `6k` Acceptable — Final Choice Pending** (`40k` not tested) | `0.976 / 0.976 / — / 0.976 / 0.976` | `1.000 / 1.000 / — / 1.000 / 1.000` | `1.000 / 1.000 / — / 1.000 / 1.000` | `1.000` | `19.38 / 19.38 / — / 19.37 / 19.37` | Both `6k` (`17,622` vertices, `9.9 ms` advancing) and `4k` (`15,422` vertices, `9.5 ms` advancing) are acceptable; final choice pending. |

---

## 7. Exact Verification Commands, Changed Files & Remaining Limitations

### 7.1 Verification Commands
1. `npm run manifest:check -w @videosaas/plate-engine` -> **PASS (`manifest ok: 31 styles`, exit 0)**
2. `npm run typecheck` -> **PASS (all 3 workspaces: `@videosaas/frontend`, `@videosaas/backend`, `@videosaas/contracts`, exit 0)**
3. `PLATE_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" PLATE_CHROME_ARGS="--use-gl=angle --use-angle=swiftshader --disable-gpu" npm test -w @videosaas/plate-engine` -> **9 / 9 PASS (`engine.test.mjs` 7/7 + `draft-preview.test.mjs` 2/2, exit 0)**
4. `node --experimental-strip-types --test frontend/test/live-draft-preview.mjs` -> **5 / 5 PASS (exit 0)**
5. `node --experimental-strip-types --test frontend/test/live-cache.mjs frontend/test/live-scheduler.mjs frontend/test/live-clock.mjs frontend/test/live-support-api.mjs frontend/test/live-worker-host-unit.mjs frontend/test/live-plate-player.mjs frontend/test/live-stage-logic.mjs frontend/test/live-predraw.mjs frontend/test/live-frame-store.mjs frontend/test/workspace-logic.mjs frontend/test/plate-motion-blur.mjs frontend/test/live-stage-leak.mjs` -> **83 / 83 PASS (exit 0)**
6. `node --experimental-strip-types --test frontend/test/live-chrome-integration.mjs` -> **1 / 1 PASS (exit 0)**
7. `node --experimental-strip-types --test frontend/test/workspace-bar-narrow.mjs` -> **1 / 1 PASS (`400×800` and `1280×800` toolbar & popover audit, exit 0)**
8. `node --experimental-strip-types --test frontend/test/live-predraw-chrome.mjs` -> **1 / 1 PASS (exit 0)**
9. `node tools/benchmark/run-coordinator-verification.mjs` -> **PASS (original `453f10c` preview + `1080p` parity, 9-style crops/motion/masks + `mellan` `40k`, 1,050-frame paced harness + 10 lifecycle loops, exit 0)**
10. `node tools/benchmark/run-real-app-playback-verification.mjs` -> **PASS (real Next.js `/dev/plate-preview-fixture` autonomous 1,050-frame RAF + real `AudioContext` playback, `<= 2` active Workers, backseek/replay, 10 UI lifecycle cycles, and 4 heavy-style production watchdog checks, exit 0)**

### 7.2 Remaining Limitations
1. **Owner Visual Approval Scope**: Only `balloon` (crayon), `paintedOil`, and `embroidery` `640×360` `Draft 75k` stills have explicit owner visual approval so far. All other styles and the `60k` / `40k` (`mellan`) / `6k` / `4k` profiles on `http://127.0.0.1:4477/visual-review.html` await owner visual review.
2. **Documented Geometry Overshoot (Soft Target vs Hard Cap)**: `draftTargetVerticesPerFrame` (`75000` default) is a soft scene-calibrated target with protected minimum stroke/dot floors (`budgetExceededByFloor`), not a hard polygon-clipping cap (`mellan` single spiral ribbon has `321,778` vertices at `75k` and `263,858` at `40k`; `paintedOil` has `196,912` bristle vertices at `75k`).
3. **Single-Host Provenance**: All benchmarks were collected on macOS (`darwin` `arm64`) in Desktop Chromium `156.0`. We do not claim universal 30 FPS across all styles or unverified devices; scenes whose draw cost exceeds `33.33 ms/frame` buffer locally in `PlatePlayer` without calling AWS `requestClip`.
