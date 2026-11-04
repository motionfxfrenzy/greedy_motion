# Phase 2b Report — Browser-Side Live Scene Player

## 1. Files Created and Changed

### Created
- `frontend/lib/live/support.ts` — Verified-environment matrix (`VERIFIED_ENVIRONMENTS`), `environmentStatus()`, `supportsWorkerHost()`, and `LIVE_CACHE_MB` byte-budget helpers (`resolveCacheBudgetMB`, `resolveCacheBudgetBytes`).
- `frontend/lib/live/worker-host.ts` — Contained Worker + `OffscreenCanvas` host using a sandboxed (`allow-scripts`, no `allow-same-origin`) CSP bootstrap iframe, `MessageChannel` port protocol, 2 s draw/heartbeat watchdog, 60 s lifetime and scene-boundary recycling, and host-side bitmap byte-budget tracking.
- `frontend/lib/live/api.ts` — Browser API client (`fetchBundle`, `reportCheck`, `requestClip`) and Worker browser check runner (`runCheck`) with SHA-256 verification and expired-link refresh.
- `frontend/lib/live/plate-player.ts` — `PlatePlayer` (`ScenePlayer` implementation for one plate scene) and `createFilmPlayer` (multi-scene timeline sequencer with `PlaybackClock` and scene-boundary Worker recycling), buffering gate, and preview-size scaling.
- `frontend/lib/live/index.ts` — Barrel re-export of all `frontend/lib/live/` modules.
- `frontend/app/dev/live-preview/page.tsx` — Minimal unstyled Next.js dev page (returns 404 unless `NEXT_PUBLIC_LIVE_DEV === "1"`) to preview live-eligible scenes of `?project=<id>`.
- `frontend/test/live-support-api.mjs` — Node unit tests for `VERIFIED_ENVIRONMENTS`, `environmentStatus`, `supportsWorkerHost`, `resolveCacheBudgetMB`, `fetchBundle` (SHA-256 tamper refusal and expired-link refresh), `reportCheck` (200, 204, network error), `requestClip` (202, 429 `clip_cap`), and `runCheck` (meta, determinism, `code` vs `env`).
- `frontend/test/live-worker-host-unit.mjs` — Node unit tests for `WorkerHost` with a fake port and fake clock covering request/response ID correlation, missed-heartbeat and draw-timeout watchdogs, 2-strike `unhealthy` transition, 60 s lifetime recycle across buffering/scrubbing/playing, scene-boundary recycle, and `bitmap.close()` on every eviction/replacement/destroy path.
- `frontend/test/live-plate-player.mjs` — Node unit tests for `computeRollingWindow`, resident bytes `<= budget` across all window splits and aspect ratios, buffering gate and clip decision table, non-blocking `showFrame` and seek re-prioritisation, `bundleDigest` cache isolation on params-only changes, and `createFilmPlayer` scene-boundary Worker recycling.
- `frontend/test/live-chrome-integration.mjs` — Headless Google Chrome integration test via `playwright-core` testing real `fox` and `balloon` bundles from `bundleScene` (0 differing pixels vs page host), sandboxed Worker network isolation (0 `/probe-hit` requests), infinite-loop watchdog recovery (`<100 ms` main-thread stall), memory-bomb survival, byte-budget enforcement, and clean `destroy()`.
- `docs/phase2/2b-report.md` — This phase 2b implementation report.

### Changed
- `frontend/lib/live/types.ts` — Added `"mode"` to `PlayerEvent` and exported `PlayerDecision` (`{ mode: "live" | "clip"; reason: string }`).
- `frontend/lib/live/frame-cache.ts` — Added `sceneCacheKey`, `frameCacheKey`, `computeRollingWindow`, and weighted focus-scene eviction distances by the rolling-window split (20% behind vs 65% ahead).
- `frontend/lib/live/frame-scheduler.ts` — Added optional `behind` rolling-window share to `SchedulerOptions`, `setWindow()`, and `runNext()` for single-frame Worker draw pumping.

---

## 2. Commands Run and Per-Test Results (Baseline vs After)

### Commands Run
```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/frontend

# Baseline and post-change full test suite
npm test

# TypeScript typecheck
npm run typecheck

# Focused live test suite
node --test test/live-support-api.mjs test/live-worker-host-unit.mjs test/live-plate-player.mjs test/live-chrome-integration.mjs
```

### Per-Test Results (Baseline vs After)

| Test File | Baseline (Before) | After Phase 2b | Notes |
| --- | --- | --- | --- |
| `test/editor-beat-text.mjs` | PASS (5/5) | PASS (5/5) | Unchanged |
| `test/editor-color.mjs` | PASS (3/3) | PASS (3/3) | Unchanged |
| `test/editor-core.mjs` | PASS (18/18) | PASS (18/18) | Unchanged |
| `test/editor-frame.mjs` | PASS (6/6) | PASS (6/6) | Unchanged |
| `test/editor-html-source.mjs` | PASS (9/9) | PASS (9/9) | Unchanged |
| `test/editor-nav.mjs` | PASS (2/2) | PASS (2/2) | Unchanged |
| `test/editor-ops.mjs` | PASS (9/9) | PASS (9/9) | Unchanged |
| `test/editor-readonly.mjs` | PASS (5/5) | PASS (5/5) | Unchanged |
| `test/editor-remote.mjs` | PASS (5/5) | PASS (5/5) | Unchanged |
| `test/editor-select.mjs` | PASS (8/8) | PASS (8/8) | Unchanged |
| `test/editor-speed.mjs` | PASS (7/7) | PASS (7/7) | Unchanged |
| `test/editor-store.mjs` | PASS (10/10) | PASS (10/10) | Unchanged |
| `test/engine-contract.mjs` | PASS (0/0) | PASS (0/0) | Unchanged |
| `test/entitlements-store.mjs` | PASS (10/10) | PASS (10/10) | Unchanged |
| `test/live-cache.mjs` | PASS (11/11) | PASS (11/11) | Unchanged |
| `test/live-clock.mjs` | PASS (5/5) | PASS (5/5) | Unchanged |
| `test/live-scheduler.mjs` | PASS (11/11) | PASS (11/11) | Unchanged |
| `test/optimistic.mjs` | PASS (2/2) | PASS (2/2) | Unchanged |
| `test/live-support-api.mjs` | *(new)* | PASS (7/7) | Added in phase 2b |
| `test/live-worker-host-unit.mjs` | *(new)* | PASS (5/5) | Added in phase 2b |
| `test/live-plate-player.mjs` | *(new)* | PASS (5/5) | Added in phase 2b |
| `test/live-chrome-integration.mjs` | *(new)* | PASS (1/1) | Added in phase 2b (real headless Chrome) |

- **Baseline Summary:** 18 test files, 126 passing tests, 0 failures; `npm run typecheck` passed with 0 errors.
- **After Summary:** 22 test files, 144 passing tests, 0 failures; `npm run typecheck` passed with 0 errors.

---

## 3. Decisions Where the Brief Was Silent

1. **Injectable transport and clock on `WorkerHost` for Node unit tests:**
   - The brief required Node unit tests (without a browser) for protocol, watchdog, 60 s lifetime recycling, and byte-budget enforcement, as well as a real headless Chrome integration test.
   - `WorkerHost` defaults to `createBrowserTransport` (which builds the hidden `<iframe sandbox="allow-scripts">` with the CSP `srcdoc` and returns the `MessageChannel` port) and `defaultClock` (`performance.now` + native timers), while accepting optional `transportFactory` and `clock` in `WorkerHostOptions` so Node unit tests can deterministically drive fake ports and advance fake clocks.
2. **Idempotent `bitmap.close()` hook for unified host and cache byte accounting:**
   - Both `WorkerHost` and `FrameCache` track resident bytes and close evicted/replaced bitmaps. `WorkerHost.trackBitmap()` wraps each returned `ImageBitmap`'s `close()` method idempotently so that whether a bitmap is closed by `FrameCache` eviction, `WorkerHost` replacement/capacity eviction, `evictFrame()`, or `destroy()`, `host.bytes` is decremented once and `close()` is never double-called.
3. **Preview scale calculation for `854x480` (16:9) and `480x854` (9:16):**
   - `packages/plate-engine/src/hosts/page.ts` computes canvas dimensions via `Math.round(film.meta.W * scale)` and `Math.round(film.meta.H * scale)`. Using `scale = 854 / 1920` (`0.44479167`) yields `Math.round(1920 * scale) = 854` and `Math.round(1080 * scale) = Math.round(480.375) = 480` for both `16:9` (`854x480`) and `9:16` (`480x854`), whereas `0.445` (used in the Phase 0 spike) rounded `1080 * 0.445` to `481`.
4. **Refresh trigger in `fetchBundle`:**
   - `fetchBundle` refreshes the `/bundle` route once both when the returned `expiresAt` timestamp is already `<= now()` and when the presigned URL responds with HTTP `401`, `403`, or `410`.

---

## 4. Deviations from the Brief and Code Contradictions Found

1. **Contradiction between `packages/plate-engine/lib/engine.mjs` `bundleSha` and plain `sha256(html)`:**
   - The brief (§3) states: *"verifies the HTML's sha256 (full) against the manifest's `bundleSha` prefix when present"*.
   - In `packages/plate-engine/lib/engine.mjs` (line 21 & line 164), `sha` is defined as:
     ```js
     const sha = (...parts) => { const h = createHash("sha256"); for (const p of parts) h.update(p).update("\0"); return h.digest("hex"); };
     ```
     so `manifest.bundleSha` produced by `bundleScene` is actually `sha256(html + "\0").slice(0, 24)` (with a trailing NUL byte), whereas standard `sha256(html)` hashes `html` without `"\0"`.
   - To honour the brief's intent across both real `bundleScene` manifests and standard SHA-256 manifests in unit tests, `verifyBundleHtmlSha(html, bundleShaPrefix)` in `frontend/lib/live/api.ts` computes both `sha256Hex(html)` and `sha256Hex(html + "\0")` and checks whether either starts with `manifest.bundleSha`. Any tampered HTML fails both checks.
2. **`frontend/package.json` test script unchanged:**
   - `frontend/package.json` already defines `"test": "node --test \"test/*.mjs\""`, which automatically discovers and runs all four new `test/live-*.mjs` files alongside the existing 18 test files without needing a script edit.

---

## 5. Changes Made to Phase 1 `FrameCache` and `FrameScheduler`

1. **`frontend/lib/live/frame-cache.ts`:**
   - Added `sceneCacheKey(bundleDigest, previewSize)`, `frameCacheKey(bundleDigest, frame, previewSize)`, and `computeRollingWindow(budgetBytes, bytesPerFrame, hasNextScene)`.
   - Updated `farthestFrame()` for the active focus scene (`id === this.focusScene`) to weight eviction distance by the rolling-window split (`(anchor - frame) / 0.20` for frames behind the playhead vs `(frame - anchor) / 0.65` for frames ahead of the playhead). Previously, symmetric `Math.abs(frame - anchor)` would evict frames `+21..+64` ahead of the playhead before frames `-1..-20` behind the playhead, preventing the cache from holding the 65% ahead window when playing forward. All 11 existing `live-cache.mjs` unit tests pass unchanged.
2. **`frontend/lib/live/frame-scheduler.ts`:**
   - Added optional `behind?: number` to `SchedulerOptions` and `setWindow({ lookahead, head, behind })`. When `behind` is provided (rolling-window mode), `order()` yields in the exact Plan §6 sequence: `playhead -> ahead share -> head of next scene -> behind share` within phases 1–2 (`windowFrames` total frames), so a full rolling window does not churn far frames. When `behind` is omitted, `order()` is unchanged and all 11 existing `live-scheduler.mjs` tests pass unchanged.
   - Added `runNext(): Promise<boolean>` so `PlatePlayer` can pump one asynchronous Worker draw at a time instead of relying on a main-thread CPU time slice.

---

## 6. Risks and Open Questions

1. **R2 Presigned URL CORS Headers (`fetchBundle`):**
   - `fetchBundle` downloads the bundle HTML in the browser using `fetch(presignedUrl)` so it can verify the SHA-256 digest and build the blob Worker source. Unlike `<video src="...">` or `<img src="...">`, `fetch()` against a cross-origin R2 presigned URL (`https://<account>.r2.cloudflarestorage.com/...`) requires the R2 `uploads` bucket CORS policy to allow `GET` from the frontend origin (`Access-Control-Allow-Origin`). If the R2 `uploads` bucket does not have CORS enabled for the app origin, browser `fetch()` of presigned bundle URLs will fail with a CORS error unless CORS is added on the bucket or proxied through `/api/backend/...`.
2. **Application CSP Headers (if added later):**
   - Currently `frontend/next.config.ts` does not set a page-level `Content-Security-Policy` response header. If a page-level CSP header is added in production later, it must allow `frame-src 'self' blob: data:` (or sandboxed `srcdoc` frames) on the outer page and `connect-src` to the R2 presigned host so `fetchBundle` and the bootstrap `<iframe sandbox="allow-scripts">` are not blocked by the parent document's CSP.
3. **Named-font `fillText` parity (`docs/LIVE_SCENES_PLAN.md` §0b Open Item 4):**
   - As measured in Phase 0, engine stroke lettering has no font dependency, but scenes calling `ctx.fillText` with named CSS fonts need embedded `@font-face` / `FontFace` assets in the bundle to match the Linux worker image.

---

## 7. Measured Numbers from the Headless Chrome Integration Test

Measured in headless Google Chrome (`156.0.8078.79`, macOS Apple Silicon) via `frontend/test/live-chrome-integration.mjs`:

1. **Pixel parity (contained `WorkerHost` vs page-thread host at preview size `854x480`, `scale = 854/1920`):**
   - `fox` (`packages/plate-engine/test/fixtures/fox-0.ts`, 90 frames):
     - Frame 0: **0 differing pixels** (`maxDelta = 0`), draw time `69.7–74.1 ms`
     - Frame 45: **0 differing pixels** (`maxDelta = 0`), draw time `43.1–58.5 ms`
     - Frame 89: **0 differing pixels** (`maxDelta = 0`), draw time `39.8–43.9 ms`
     - Mean draw time across sampled frames: **`50.9–58.8 ms/frame`**
   - `balloon` (`packages/plate-engine/test/fixtures/balloon-0.ts`, 105 frames):
     - Frame 0: **0 differing pixels** (`maxDelta = 0`), draw time `57.5–60.2 ms` (first frame builds hatch run cache)
     - Frame 52: **0 differing pixels** (`maxDelta = 0`), draw time `18.4–19.9 ms`
     - Frame 104: **0 differing pixels** (`maxDelta = 0`), draw time `14.6 ms`
     - Mean draw time across sampled frames: **`30.7–31.1 ms/frame`** (~`16.5 ms/frame` steady-state after frame 0)
2. **Network containment (sandboxed `allow-scripts` iframe + `connect-src 'none'` Worker):**
   - Probe scene attempting `fetch`, `XMLHttpRequest`, and `WebSocket` to `http://127.0.0.1:<port>/probe-hit`: **`0` server hits**.
3. **Infinite-loop watchdog termination and main-thread responsiveness:**
   - Watchdog budget: `2000 ms`
   - Detected and terminated after: **`2004–2005 ms`**
   - Longest main-thread stall during the hang and termination: **`12.1 ms`** (requirement: `< 100 ms`)
   - Recreated Worker and drew frame 0 cleanly: **`true`**
4. **Memory-hungry loop (`25 MB` chunk allocation bomb in Worker):**
   - Terminated by watchdog without crashing the page; fresh Worker drew frame 0 afterwards: **`true`**
5. **Byte-budget enforcement and `destroy()` cleanup (`balloon` playback over 32 frames with a 24-frame / `39,352,320` byte budget):**
   - Peak `cache.bytes`: **`39,352,320` bytes** (`<= 39,352,320` budget, exactly 24 frames)
   - Peak `host.bytes`: **`39,352,320` bytes** (`<= 39,352,320` budget, exactly 24 frames)
   - After `destroy()`: `cache.bytes = 0`, `host.bytes = 0`, remaining `<iframe>` elements = **`0`**, remaining `<canvas>` elements = **`0`**.
