# Phase 0 Spike: Linux Worker Parity, Text & Image Assets

Date: 2026-11-04  
Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` (branch `codex/live-scenes`)  
Scratch directory (`$P0`): `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0`

> **Manager's note (2026-11-04).** The PASS/FAIL columns below apply the per-pixel tolerance from an earlier draft of the plan (at most 2 % of pixels over 2 levels, none over 16). That tolerance has since been **withdrawn**: the product owner reviewed the difference images for all 14 scenes and approved them as visually coherent (a few hairlines offset by a pixel is accepted; pixel-perfect is not a goal). Read the FAIL labels as "differs at the pixel level", not as a rejected result. The causes given for the rasteriser differences (macOS GPU versus Linux software anti-aliasing, and Worker-versus-page gradient dithering on blueprint) are well supported by the measurements but not proven. **The one difference that is not just anti-aliasing is `text-font`: different typefaces on the two platforms (section 4d). Named-font `fillText` is not parity-safe unless fonts are embedded.**

---

## 1. What Was Run

### Worker image and environment inspected
- **Docker image:** `videosaas-worker:plates-e2e`
- **Image ID:** `sha256:c8fa7e3c2153a97032d275b7847aaa616a9aaefcaa07f2a36e1c0de4c4f72840` (`linux/arm64`)
- **Node version inside image:** `v24.22.2` (`/usr/local/bin/node`)
- **Chromium version inside image:** `Chromium 156.0.8078.79 built on Debian GNU/Linux 12 (bookworm)` (`/usr/bin/chromium`)
- **Engine location inside image:** `/app/plate-engine/capture.mjs` and `/app/plate-engine/rules.mjs` (copied by `worker/Dockerfile` from `packages/plate-engine/lib/`); `playwright-core` is installed in `/app/node_modules/playwright-core`.
- **Environment variables set in image (`worker/Dockerfile`):**
  - `DEBIAN_FRONTEND=noninteractive`
  - `NODE_ENV=production`
  - `HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium`
  - `HYPERFRAMES_NO_TELEMETRY=1`
  - `HYPERFRAMES_NO_UPDATE_CHECK=1`
- **Chromium launch flags used by `openScene` (`packages/plate-engine/lib/capture.mjs`):**
  - `--disable-background-timer-throttling`
  - `--disable-extensions`
  - `--disable-dev-shm-usage`
  - `--no-sandbox`
  - `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost`
  - Plus `PLATE_CHROME_ARGS` when set. Inside the container (no GPU device), Chromium reports `UNMASKED_RENDERER_WEBGL = ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 16.0.0) (0x0000C0DE)), SwiftShader driver)` both with default args and with `--disable-gpu --use-gl=angle --use-angle=swiftshader`, producing identical SHA-256 frame hashes.
- **macOS host Chrome (for Worker preview and macOS export):** Google Chrome `156.0.8078.79` at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

### Commands executed
```bash
# 1. Build Job B scenes (text-stroke, text-font, image-asset) and macOS reference PNGs in $P0
P0="/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0"
node tools/spike-phase0/build-job-b.mjs "$P0"

# 2. Render Linux reference PNGs inside videosaas-worker:plates-e2e with --network none
mkdir -p "$P0/linux"
docker run --rm --network none \
  -v "$P0:/p0:ro" \
  -v "$P0/linux:/out:rw" \
  -v "/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/tools/spike-phase0:/tools:ro" \
  --entrypoint node videosaas-worker:plates-e2e \
  /tools/linux-ref.mjs /p0 /out

# 3. Start localhost-only harness server (127.0.0.1:8766), run parity comparisons and generate x40 diff images, then stop server
node tools/spike-phase0/server.mjs "$P0" > "$P0/server2.log" 2>&1 &
SRV=$!
node tools/spike-phase0/run.mjs linux > "$P0/r-linux.txt"
node tools/spike-phase0/run.mjs job-b > "$P0/r-job-b.txt"
node tools/spike-phase0/linux-diffs.mjs "$P0"
kill $SRV
```

---

## 2. Parity Results: Worker Preview vs Linux Export & macOS Export vs Linux Export

**Proposed plan tolerance (§9):** `over2Pct <= 2.0%` (no more than 2% of pixels differ by more than 2 levels) **and** `maxChannel <= 16` (no pixel differs by more than 16 levels of 255).

### 2a. The 9 Real Production Scenes + Parameter-Edit Scenes (`foxparamsA`, `foxparamsB`)

| Scene | Frame | Worker vs Linux: diff % | Worker vs Linux: >2 lv % | Worker vs Linux: max lv | Worker vs Linux: mean abs | Worker vs Linux: Pass/Fail | macOS Export vs Linux: diff % | macOS Export vs Linux: >2 lv % | macOS Export vs Linux: max lv | macOS Export vs Linux: mean abs | macOS Export vs Linux: Pass/Fail | Worker vs macOS Export: >2 lv % (max lv) |
| --- | ---: | ---: | ---: | ---: | ---: | :---: | ---: | ---: | ---: | ---: | :---: | ---: |
| `balloon-2ee0ac2f-0` | 0 | 69.6346% | 22.0095% | 139 | 3.0767 | **FAIL** | 69.6346% | 22.0095% | 139 | 3.0767 | **FAIL** | 0% (0) |
| `balloon-2ee0ac2f-0` | 52 | 69.6344% | 21.9969% | 139 | 3.0746 | **FAIL** | 69.6344% | 21.9969% | 139 | 3.0746 | **FAIL** | 0% (0) |
| `balloon-2ee0ac2f-0` | 104 | 69.6425% | 22.0463% | 139 | 3.0765 | **FAIL** | 69.6425% | 22.0463% | 139 | 3.0765 | **FAIL** | 0% (0) |
| `balloon-2ee0ac2f-3` | 0 | 58.1942% | 20.3601% | 159 | 2.7277 | **FAIL** | 58.1942% | 20.3601% | 159 | 2.7277 | **FAIL** | 0% (0) |
| `balloon-2ee0ac2f-3` | 97 | 59.1749% | 20.9645% | 159 | 2.7609 | **FAIL** | 59.1749% | 20.9645% | 159 | 2.7609 | **FAIL** | 0% (0) |
| `balloon-2ee0ac2f-3` | 194 | 59.0821% | 20.9151% | 159 | 2.7603 | **FAIL** | 59.0821% | 20.9151% | 159 | 2.7603 | **FAIL** | 0% (0) |
| `balloon-a55da10d-2` | 0 | 65.6878% | 22.3566% | 129 | 2.4753 | **FAIL** | 65.6878% | 22.3566% | 129 | 2.4753 | **FAIL** | 0% (0) |
| `balloon-a55da10d-2` | 112 | 67.2708% | 23.2125% | 129 | 2.4834 | **FAIL** | 67.2708% | 23.2125% | 129 | 2.4834 | **FAIL** | 0% (0) |
| `balloon-a55da10d-2` | 224 | 67.3497% | 23.2717% | 129 | 2.4950 | **FAIL** | 67.3497% | 23.2717% | 129 | 2.4950 | **FAIL** | 0% (0) |
| `fox-397b0ec8-0` | 0 | 9.8685% | 2.0981% | 112 | 0.3747 | **FAIL** | 9.8685% | 2.0981% | 112 | 0.3747 | **FAIL** | 0% (0) |
| `fox-397b0ec8-0` | 45 | 9.7402% | 2.0438% | 112 | 0.3677 | **FAIL** | 9.7402% | 2.0438% | 112 | 0.3677 | **FAIL** | 0% (0) |
| `fox-397b0ec8-0` | 89 | 9.8251% | 2.0893% | 112 | 0.3701 | **FAIL** | 9.8251% | 2.0893% | 112 | 0.3701 | **FAIL** | 0% (0) |
| `fox-397b0ec8-2` | 0 | 10.3746% | 2.1321% | 120 | 0.3773 | **FAIL** | 10.3746% | 2.1321% | 120 | 0.3773 | **FAIL** | 0% (0) |
| `fox-397b0ec8-2` | 105 | 9.4659% | 1.9894% | 107 | 0.3514 | **FAIL** | 9.4659% | 1.9894% | 107 | 0.3514 | **FAIL** | 0% (0) |
| `fox-397b0ec8-2` | 209 | 8.0489% | 1.7679% | 125 | 0.3115 | **FAIL** | 8.0489% | 1.7679% | 125 | 0.3115 | **FAIL** | 0% (0) |
| `fox-397b0ec8-5` | 0 | 6.4263% | 1.5941% | 129 | 0.3246 | **FAIL** | 6.4263% | 1.5941% | 129 | 0.3246 | **FAIL** | 0% (0) |
| `fox-397b0ec8-5` | 67 | 6.1937% | 1.5125% | 123 | 0.2916 | **FAIL** | 6.1937% | 1.5125% | 123 | 0.2916 | **FAIL** | 0% (0) |
| `fox-397b0ec8-5` | 134 | 6.3271% | 1.5164% | 128 | 0.2913 | **FAIL** | 6.3271% | 1.5164% | 128 | 0.2913 | **FAIL** | 0% (0) |
| `blueprint-dcd88501-0` | 0 | 46.9351% | 0.2346% | 45 | 0.4882 | **FAIL** | 1.0445% | 0.2150% | 45 | 0.0268 | **FAIL** | 0.0090% (4) |
| `blueprint-dcd88501-0` | 45 | 50.3872% | 1.8261% | 72 | 0.6997 | **FAIL** | 7.8342% | 1.6941% | 72 | 0.2648 | **FAIL** | 0.0089% (4) |
| `blueprint-dcd88501-0` | 89 | 50.4244% | 1.8393% | 72 | 0.7012 | **FAIL** | 7.8827% | 1.7042% | 72 | 0.2663 | **FAIL** | 0.0090% (4) |
| `blueprint-dcd88501-2` | 0 | 46.5002% | 0.0441% | 26 | 0.4681 | **FAIL** | 0.1417% | 0.0344% | 27 | 0.0031 | **FAIL** | 0.0090% (4) |
| `blueprint-dcd88501-2` | 112 | 50.9544% | 1.9151% | 68 | 0.7297 | **FAIL** | 8.9483% | 1.7538% | 68 | 0.2988 | **FAIL** | 0.0089% (4) |
| `blueprint-dcd88501-2` | 224 | 52.2704% | 2.5655% | 68 | 0.8237 | **FAIL** | 11.4273% | 2.3681% | 68 | 0.4021 | **FAIL** | 0.0089% (4) |
| `blueprint-dcd88501-4` | 0 | 46.5002% | 0.0441% | 26 | 0.4681 | **FAIL** | 0.1417% | 0.0345% | 27 | 0.0031 | **FAIL** | 0.0090% (4) |
| `blueprint-dcd88501-4` | 60 | 51.8441% | 2.2473% | 69 | 0.7799 | **FAIL** | 10.4106% | 2.1238% | 69 | 0.3540 | **FAIL** | 0.0083% (4) |
| `blueprint-dcd88501-4` | 119 | 51.8292% | 2.2326% | 69 | 0.7788 | **FAIL** | 10.3964% | 2.1119% | 69 | 0.3530 | **FAIL** | 0.0083% (4) |
| `foxparamsA` | 0 | 9.8685% | 2.0981% | 112 | 0.3747 | **FAIL** | 9.8685% | 2.0981% | 112 | 0.3747 | **FAIL** | 0% (0) |
| `foxparamsA` | 45 | 9.7402% | 2.0438% | 112 | 0.3677 | **FAIL** | 9.7402% | 2.0438% | 112 | 0.3677 | **FAIL** | 0% (0) |
| `foxparamsB` | 0 | 9.6356% | 2.0984% | 112 | 0.3731 | **FAIL** | 9.6356% | 2.0984% | 112 | 0.3731 | **FAIL** | 0% (0) |
| `foxparamsB` | 45 | 9.5073% | 2.0441% | 112 | 0.3661 | **FAIL** | 9.5073% | 2.0441% | 112 | 0.3661 | **FAIL** | 0% (0) |

### 2b. Job B Scenes (Text & Image Assets)

| Scene | Frame | Worker vs Linux: diff % | Worker vs Linux: >2 lv % | Worker vs Linux: max lv | Worker vs Linux: mean abs | Worker vs Linux: Pass/Fail | macOS Export vs Linux: diff % | macOS Export vs Linux: >2 lv % | macOS Export vs Linux: max lv | macOS Export vs Linux: mean abs | macOS Export vs Linux: Pass/Fail | Worker vs macOS Export: >2 lv % (max lv) |
| --- | ---: | ---: | ---: | ---: | ---: | :---: | ---: | ---: | ---: | ---: | :---: | ---: |
| `text-stroke` (`illus-blueprint`) | 0 | 46.5002% | 0.0441% | 26 | 0.4681 | **FAIL** | 0.1418% | 0.0344% | 27 | 0.0031 | **FAIL** | 0.0090% (4) |
| `text-stroke` (`illus-blueprint`) | 45 | 50.2128% | 1.7351% | 68 | 0.7016 | **FAIL** | 7.4506% | 1.6005% | 68 | 0.2651 | **FAIL** | 0.0091% (4) |
| `text-stroke` (`illus-blueprint`) | 89 | 51.0008% | 2.2700% | 79 | 0.7633 | **FAIL** | 8.9944% | 2.1073% | 79 | 0.3331 | **FAIL** | 0.0089% (4) |
| `text-font` (`illus-fox`, `fillText`) | 0 | 4.0679% | 3.9158% | 225 | 5.1984 | **FAIL** | 4.0679% | 3.9158% | 225 | 5.1984 | **FAIL** | 0% (0) |
| `text-font` (`illus-fox`, `fillText`) | 45 | 4.0743% | 3.9214% | 225 | 5.2030 | **FAIL** | 4.0743% | 3.9214% | 225 | 5.2030 | **FAIL** | 0% (0) |
| `text-font` (`illus-fox`, `fillText`) | 89 | 4.0775% | 3.9244% | 225 | 5.2034 | **FAIL** | 4.0775% | 3.9244% | 225 | 5.2034 | **FAIL** | 0% (0) |
| `image-asset` (`illus-fox`, `__ASSETS__`) | 0 | 0.6947% | 0.5390% | 69 | 0.0790 | **FAIL** | 0.6947% | 0.5390% | 69 | 0.0790 | **FAIL** | 0% (0) |
| `image-asset` (`illus-fox`, `__ASSETS__`) | 45 | 0.6947% | 0.5390% | 69 | 0.0790 | **FAIL** | 0.6947% | 0.5390% | 69 | 0.0790 | **FAIL** | 0% (0) |
| `image-asset` (`illus-fox`, `__ASSETS__`) | 89 | 0.6947% | 0.5390% | 69 | 0.0790 | **FAIL** | 0.6947% | 0.5390% | 69 | 0.0790 | **FAIL** | 0% (0) |

### Worst offenders (ranked by `% > 2 levels` and `maxChannel`)
1. **By `% > 2 levels`:**
   - `balloon-a55da10d-2` frame 224: **23.2717%** over 2 levels (max 129, mean abs 2.4950)
   - `balloon-a55da10d-2` frame 112: **23.2125%** over 2 levels (max 129, mean abs 2.4834)
   - `balloon-2ee0ac2f-0` frame 104: **22.0463%** over 2 levels (max 139, mean abs 3.0765)
   - `balloon-2ee0ac2f-3` frame 97: **20.9645%** over 2 levels (max 159, mean abs 2.7609)
   - `text-font` frame 89: **3.9244%** over 2 levels (max 225, mean abs 5.2034 — different system fonts between macOS and Debian)
   - `blueprint-dcd88501-2` frame 224: **2.5655%** over 2 levels (max 68, mean abs 0.8237)
   - `text-stroke` frame 89: **2.2700%** over 2 levels (max 79, mean abs 0.7633)
   - `blueprint-dcd88501-4` frame 60: **2.2473%** over 2 levels (max 69, mean abs 0.7799)
   - `fox-397b0ec8-2` frame 0: **2.1321%** over 2 levels (max 120, mean abs 0.3773)
   - `fox-397b0ec8-0` frame 0: **2.0981%** over 2 levels (max 112, mean abs 0.3747)
2. **By `maxChannel`:**
   - `text-font`: **225** (different glyph shapes from system fallback fonts)
   - `balloon-2ee0ac2f-3`: **159** (fine dense crayon hatch lines anti-aliased on macOS GPU vs Linux SwiftShader)
   - `balloon-2ee0ac2f-0`: **139**
   - `balloon-a55da10d-2` / `fox-397b0ec8-5`: **129**
   - `fox-397b0ec8-2`: **125**
   - `fox-397b0ec8-0` / `foxparamsA` / `foxparamsB`: **112**
   - `text-stroke`: **79**
   - `blueprint-dcd88501-0`: **72**
   - `blueprint-dcd88501-4` / `image-asset`: **69**
   - `blueprint-dcd88501-2`: **68**

### Rasteriser vs Worker host attribution (Job A step 6)
Comparing **Worker preview vs macOS export** with **macOS export vs Linux export** isolates the two effects:
1. **Worker host vs Page host on the same OS/GPU (`Worker vs macOS Export`):**
   - For all 6 `balloon` and `fox` scenes, `foxparamsA/B`, `text-font`, and `image-asset`: **0 differing pixels** (byte-identical).
   - For the 3 `blueprint` scenes and `text-stroke`: ~46% of pixels differ by 1 level (max 4 levels, `over2Pct = 0.0089%`), which comes from radial gradient dithering differences between an `OffscreenCanvas` in a Worker and a DOM `<canvas>` on macOS.
2. **macOS GPU rasteriser vs Linux SwiftShader/CPU rasteriser (`macOS Export vs Linux Export`):**
   - For `balloon` and `fox`, `macOS Export vs Linux Export` is **identical to `Worker vs Linux Export`** down to the last pixel (`diffPx`, `over2Pct`, `maxChannel`, `meanAbsOverAll` are 100% equal).
   - Why? Because `openScene` on macOS ran Chrome with hardware GPU acceleration (Apple Silicon Metal/Ganesh), whereas `openScene` inside `videosaas-worker:plates-e2e` ran Chromium on Linux with SwiftShader/CPU rasterisation (`meta.raster` is not set to `"cpu"` on any of the authored scenes in `var/plates/`).
   - Every anti-aliased polygon edge (`ctx.fill()` on torn paper in `fox`, thousands of thin crayon ribbons in `balloon`, and ruling-pen strokes in `blueprint`) and every `ctx.quadraticCurveTo` paper fibre stroke is coverage-sampled differently by macOS GPU MSAA/analytic AA vs Linux SwiftShader/Skia software AA. Along sub-pixel stroke edges, coverage differs by up to 50–60%, producing channel deltas of 68–159 levels even though the frames look visually identical at normal viewing distance.

---

## 3. Amplified (x40) Difference Images for Failures

All scenes failed the strict `maxChannel <= 16` (and most failed `over2Pct <= 2%`) against the Linux worker export. Amplified (`x40`) side-by-side comparison PNGs (Linux export | Worker preview | difference x40) were generated and saved under `$P0/linux/`:

- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/balloon-2ee0ac2f-0-diff.png` (frame 52)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/balloon-2ee0ac2f-3-diff.png` (frame 97)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/balloon-a55da10d-2-diff.png` (frame 112)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/fox-397b0ec8-0-diff.png` (frame 45)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/fox-397b0ec8-2-diff.png` (frame 105)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/fox-397b0ec8-5-diff.png` (frame 67)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/blueprint-dcd88501-0-diff.png` (frame 45)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/blueprint-dcd88501-2-diff.png` (frame 112)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/blueprint-dcd88501-4-diff.png` (frame 60)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/foxparamsA-diff.png` (frame 45)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/foxparamsB-diff.png` (frame 45)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/text-stroke-diff.png` (frame 45)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/text-font-diff.png` (frame 45)
- `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/linux/image-asset-diff.png` (frame 45)

---

## 4. Job B Findings: Text & Image Assets in the Worker Host

### 4a. How text and image assets are used in `packages/plate-engine`
1. **Text in `canvas-core`:**
   - All vendored plates (`blueprint.ts`, `moonPhases.ts`, `scrapbook.ts`, `pocketWatch.ts`) draw text using **engine stroke glyph tables** (`drafting.ts` `letter()`, `blueprintKit.ts` `k.text()` / `k.callout()` / `k.dim()`, `scrapbookKit.ts` `glyph()` / `typed()` / `handWrite()`), which stroke vector polylines with the canvas pen and never call `ctx.fillText`.
   - `hosts/page.ts` also instruments `CanvasRenderingContext2D.prototype.fillText` and `OffscreenCanvasRenderingContext2D.prototype.fillText` for the frame probe, and `worker/src/plates.mjs` (`renderSubtitlePng`) uses CSS font stacks (`'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif`, `'Georgia', 'Times New Roman', serif`, `'SF Mono', 'Menlo', 'Courier New', monospace`).
2. **Image assets in `canvas-core` and `hosts/page.ts`:**
   - `Film.assets` declares `{ images: Record<string, string>; fonts?: Record<string, string> }`.
   - `bundleScene` (`packages/plate-engine/lib/engine.mjs`) emits `<script>window.__ASSETS__={};window.__BAKE_SRC__={};</script>` before the bundle script.
   - `mountFilm` (`packages/plate-engine/src/hosts/page.ts` line 49) loads every entry in `film.assets.images` during `FILM.ready`:
     ```ts
     await Promise.all(Object.entries(film.assets.images).map(async ([name, url]) => {
       const img = new Image();
       img.src = window.__ASSETS__?.[name] ?? url;
       await img.decode();
       images.set(name, img);
     }));
     ```
     and exposes `env.image = (n) => images.get(n)` so scenes pass `env.image("...")` directly to `ctx.drawImage(...)`.

### 4b. What was changed in `tools/spike-phase0/harness.js`
To support image assets in the Worker host without modifying `packages/plate-engine/` or relaxing Worker containment (`connect-src 'none'`):
1. **Pre-decoding `__ASSETS__` with `createImageBitmap`:** After the first `<script>` sets `window.__ASSETS__`, `__preloadAssets()` decodes every `data:` URL in `self.__ASSETS__` into an `ImageBitmap` via `createImageBitmap(new Blob([u8], { type: mime }))` and caches it in `__assetBitmaps` before the bundle script starts `mountFilm` / `FILM.ready`.
2. **`self.Image` shim:** Replaced the throwing `self.Image` class with a shim whose `src` setter looks up the pre-decoded `ImageBitmap` (or decodes `data:` URLs on `decode()`), populates `width` and `height`, and rejects non-`data:` URLs.
3. **`OffscreenCanvasRenderingContext2D.prototype.drawImage` wrapper:** Because `mountFilm` stores the `new Image()` instance in its `images` map and passes it to `ctx.drawImage(img, ...)`, and native `OffscreenCanvasRenderingContext2D.drawImage` only accepts native `CanvasImageSource` objects (such as `ImageBitmap`), a thin wrapper unwraps `img._bm` when present.

### 4c. Measured differences for Job B scenes
1. **`text-stroke` (engine stroke lettering via `drafting.ts` / `blueprintKit.ts`):**
   - Runs cleanly in the Worker host.
   - **Worker vs macOS Export:** `0.009%` over 2 levels, `maxChannel = 4` (passes tolerance).
   - **Worker vs Linux Export:** `0.0441%` to `2.2700%` over 2 levels, `maxChannel = 26` to `79` (fails tolerance along stroke edges for the same GPU-vs-SwiftShader AA reason as the 3 `blueprint` scenes).
2. **`text-font` (named font stacks via `ctx.fillText`):**
   - Runs cleanly in the Worker host.
   - **Worker vs macOS Export:** **0 differing pixels** across all frames (`diffPx = 0`, `maxChannel = 0`). `OffscreenCanvas` in a Worker on macOS renders `fillText` identically to DOM `<canvas>` on macOS.
   - **Worker vs Linux Export (and macOS Export vs Linux Export):** **3.92% of pixels differ by >2 levels, `maxChannel = 225`, mean abs `5.20` (FAIL)**. The amplified diff (`$P0/linux/text-font-diff.png`) shows completely different glyph shapes and advance widths between macOS and the Linux worker container.
3. **`image-asset` (`film.assets.images` + `window.__ASSETS__` data URLs):**
   - Runs cleanly in the Worker host with the new `Image` / `createImageBitmap` shim.
   - **Worker vs macOS Export:** **0 differing pixels** across all frames (`diffPx = 0`, `maxChannel = 0`), both for nearest-neighbour (`imageSmoothingEnabled = false`) and sub-pixel bilinear (`imageSmoothingEnabled = true`) draws.
   - **Worker vs Linux Export (and macOS Export vs Linux Export):**
     - When `image-asset` drew only integer-aligned nearest-neighbour images on the card, the **image pixels themselves had 0 difference** between macOS and Linux; the only difference was `0.1971%` (`4,514` pixels, `maxChannel = 69`) along the anti-aliased border of the background card polygon.
     - When sub-pixel bilinear-filtered `drawImage(badge, 320.35, 680.65, 180, 180)` was added, bilinear filtering at sub-pixel coordinates added `9,891` differing pixels (`over2Pct = 0.5390%`, `maxChannel = 69`) due to GPU vs SwiftShader texture filtering rounding.

### 4d. Font differences between macOS and the Linux worker image
- **Fonts installed in `videosaas-worker:plates-e2e`:**
  - System fonts (`/usr/share/fonts/truetype/`): **Liberation** (`Liberation Sans`, `Liberation Sans Narrow`, `Liberation Serif`, `Liberation Mono`) and **DejaVu** (`DejaVu Sans`, `DejaVu Serif`, `DejaVu Sans Mono`).
  - App WOFF2 fonts (`/app/fonts/`): 17 Google font families (`Archivo`, `Barlow`, `Bebas Neue`, `Bodoni Moda`, `DM Mono`, `EB Garamond`, `Fredoka`, `Hanken Grotesk`, `IBM Plex Mono`, `Instrument Serif`, `Inter`, `JetBrains Mono`, `Libre Baskerville`, `Newsreader`, `Playfair Display`, `Quicksand`, `Shrikhand`, `Source Serif 4`, `Space Grotesk`), which are **not** installed into `/usr/share/fonts` and are **not** embedded by `bundleScene`.
- **Which font families are actually drawn for each stack (`measureText` verification on both platforms):**

| CSS `ctx.font` stack tested | Drawn on macOS Chrome (Worker & Export) | Drawn on Linux Worker Image (`videosaas-worker:plates-e2e`) |
| --- | --- | --- |
| `'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif` | **Helvetica Neue** (`Plus Jakarta Sans` is not installed on either; macOS has `Helvetica Neue`) | **Liberation Sans** (Debian fontconfig aliases `Arial` and `sans-serif` to `Liberation Sans`) |
| `'Georgia', 'Times New Roman', serif` | **Georgia** | **Liberation Serif** (neither `Georgia` nor `Times New Roman` is installed; `serif` resolves to `Liberation Serif`) |
| `'SF Mono', 'Menlo', 'Courier New', monospace` | **Menlo** (`SF Mono` is not exposed to web canvas by name; falls back to `Menlo`) | **Liberation Mono** (Debian fontconfig aliases `Courier New` to `Liberation Mono`; generic `monospace` resolves to `DejaVu Sans Mono`) |
| `'Liberation Sans', 'DejaVu Sans', sans-serif` | **Helvetica** (macOS lacks `Liberation Sans` and `DejaVu Sans`, so it falls through to generic `sans-serif` = `Helvetica`) | **Liberation Sans** |
| `sans-serif` | **Helvetica** | **Liberation Sans** |

---

## 5. What This Means for the Plan (Facts Only)

1. **Worker preview vs same-machine page export is identical (or within 4 levels on `blueprint`), but macOS GPU vs Linux SwiftShader fails the proposed `<= 2% over 2 levels, max <= 16` tolerance on every scene.**
   - On `balloon` scenes, 20.4%–23.3% of pixels differ by >2 levels (max 129–159).
   - On `fox` scenes, 1.5%–2.1% of pixels differ by >2 levels (max 107–129).
   - On `blueprint` scenes, 0.04%–2.57% of pixels differ by >2 levels (max 26–72).
2. **100% of the `balloon` and `fox` difference, and all >4-level differences on `blueprint`, come from the rasteriser (macOS Metal GPU vs Linux SwiftShader CPU), not from the Worker host.**
   - `macOS Export vs Linux Export` has the exact same error metrics as `Worker Preview vs Linux Export` on `balloon`, `fox`, `foxparams`, `text-font`, and `image-asset`.
   - None of the authored scenes in `var/plates/` set `meta.raster = "cpu"`, so client browsers rasterise them on the OS GPU while the Linux worker rasterises them in software.
3. **A per-pixel max-channel cap of `16` cannot pass across GPU vs software anti-aliasing.**
   - Sub-pixel coverage differences on high-contrast stroke edges (white ink on Prussian blue, dark crayon on pale sky, dark outline on cream paper) routinely reach 68–159 levels on 1-pixel-wide boundary rings even when the images look indistinguishable to a viewer.
4. **Canvas `fillText` with named or generic CSS fonts renders different typefaces on macOS vs the Linux worker unless fonts are embedded in the bundle.**
   - Engine stroke lettering (`drafting.ts`, `scrapbookKit.ts`) uses vector paths and has no font dependency.
   - Any scene or caption using `ctx.fillText` with system font names will draw `Helvetica Neue` / `Georgia` / `Menlo` / `Helvetica` on macOS and `Liberation Sans` / `Liberation Serif` / `Liberation Mono` / `DejaVu Sans Mono` on the Linux worker unless `@font-face` / `FontFace` data URLs are bundled and loaded in both hosts.
5. **Image assets (`film.assets.images` + `window.__ASSETS__`) work in the contained Worker host with a ~25-line `createImageBitmap` preload + `Image` / `drawImage` shim, with 0 pixel difference between Worker and page host on the same OS.**

---

## 6. Anything That Could Not Be Done and Why

- Everything requested in `TASK.md` (Job A steps 1–6 and Job B steps 1–4) was completed without blockers.
