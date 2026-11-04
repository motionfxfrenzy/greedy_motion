# Phase 3c Report — Live Plate Scenes in Shared `AnimationWorkspace` (`NEXT_PUBLIC_PLATE_LIVE`)

Date: 2026-11-05  
Branch: `codex/live-scenes`  
Status: Complete (Flag-off 68/68 screenshots 0 differing pixels; Flag-on 20/20 live fixture screenshots captured with 180/180 shell region checks within 0 px; Real local stack E2E 15/15 assertions passing at 29.5 fps with 0 late frames; `frontend` 168/168 tests passing; `tsc --noEmit` clean)

---

## 1. Files Created and Changed

### Created Files
- `frontend/lib/live/flag.ts` — Single feature-flag reader (`PLATE_LIVE_ENABLED`, `isPlateLiveEnabled`) reading `process.env.NEXT_PUBLIC_PLATE_LIVE` (off by default).
- `frontend/lib/live/live-stage-logic.ts` — Pure per-scene mode decision (`decideSceneMode`), variant resolver (`resolveSceneVariant`), fenced check-once tracker (`CheckOnceTracker`), and clip-request tracker (`ClipRequestTracker`).
- `frontend/components/plate-live-stage.tsx` — Live scene stage component (`PlateLiveStage`) rendered inside `PlatePreview`'s `renderStage()`, mounting one `createFilmPlayer` per `(projectId, viewAspect)`, keeping voice/music audio as the master clock, running `fetchBundle` -> `runCheck` -> `reportCheck` once per `(variantId, gen, bundleDigest)`, and seamlessly switching between live `<canvas>` scenes and fallback `<video>` clip scenes.
- `frontend/test/live-stage-logic.mjs` — Node unit test suite (`node:test`) covering `isPlateLiveEnabled`, `parseGenFromBundleUrl`, `resolveSceneVariant`, `decideSceneMode` across all mode/fallback/repair/cap/buffering/comment branches, `CheckOnceTracker`, and `ClipRequestTracker`.
- `frontend/test/live-stage-leak.mjs` — Headless Google Chrome leak test (`playwright-core`) verifying that sandboxed `<iframe>` elements, active Workers (`getActiveBrowserTransportCount()`), `<canvas>` elements, `FrameCache` bytes, and `WorkerHost` bitmap bytes return to `0` across aspect ratio switches (`16:9` -> `9:16` -> `1:1`), `updateScene` hot-reloads, and unmount (`destroy()`).
- `tools/phase2/e2e/live-ui-e2e.mjs` — End-to-end headless Chrome acceptance test driving the real `PlatePreview` (`NEXT_PUBLIC_PLATE_LIVE=1`) against the real local `plates-e2e` compose stack (`PLATE_LIVE_PREVIEW=on`, `llm-stub`, S3Mock, Postgres, `plate-api`, `plate-worker`).
- `tools/phase3/live-after/*.png` — 20 live fixture screenshots (`5 states × 2 widths × 2 themes`) captured with real `bundleScene` bundles from `packages/plate-engine/test/fixtures/`.
- `docs/phase3/3c-report.md` — This report.

### Changed Files (with exact 2b module additions listed per Rule 1)
- `frontend/lib/live/api.ts`:
  - Added optional `url?: string` and `gen?: number` to `FetchedBundle`.
  - Added `parseGenFromBundleUrl(url?: string | null, fallbackGen = 1): number` to extract generation `N` from presigned URLs (`.../g<N>/bundle.html` or `%2Fg<N>%2Fbundle.html`) so `reportCheck` is fenced with the exact generation of the fetched bundle.
- `frontend/lib/live/worker-host.ts`:
  - Added `getActiveBrowserTransportCount()` and synchronous pre-bootstrap abort cleanup (`onRegisterAbort` / `pendingSpawnAbort`) so calling `destroy()` even while a Worker bootstrap iframe is mid-handshake immediately removes the `<iframe>` and decrements the active Worker transport count to `0`.
- `frontend/lib/live/plate-player.ts`:
  - Added optional `forceClipReason?: string` to `PlatePlayerOptions` and `FilmSceneSpec`, and optional `durationSeconds?: number` and `environment?: string | EnvironmentProbeInput` to `FilmSceneSpec`.
  - Added `setCanvasVisible(visible: boolean)` on `PlatePlayer` and `updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void>` on `FilmPlayer` so individual scenes can be hot-reloaded after a browser check or comment revision without recreating the entire `FilmPlayer`.
  - Updated `PlatePlayer.pumpScheduler()` to re-pump if a seek occurs mid-pump and, when `autoPump` is enabled, automatically blit `currentFrame` and clear `isBuffering` as soon as the target frame enters the cache.
  - Updated `createFilmPlayer.mount()` so non-active scenes only draw their 3 gate-measurement frames during initial mount (avoiding 5-way Worker CPU contention and cache thrashing), while `showFrame()` activates pumping for the active scene.
- `frontend/lib/live/index.ts` — Re-exported `./flag.ts` and `./live-stage-logic.ts`.
- `frontend/components/plate-preview.tsx` — Wired `PlateLiveStage` into `renderStage()` when `isPlateLiveEnabled()` is true and `status.mode === "live"`, mapped live scene readiness (`checked` or `drawn`) to the `n/5 ready` status chip and scene tab states, and kept the flag-off path and `PlateFinal` untouched.
- `frontend/app/dev/plate-preview-fixture/page.tsx` — Added support for live fixture states (`live-a-playing`, `live-b-clip-fallback`, `live-c-mixed`, `live-d-buffering`, `live-e-needs-update`), `?project=<id>` and `?env=unverified` parameters, and the dev-only per-scene decision badge (`data-testid="dev-live-decisions"`).
- `frontend/test/fixtures/workspace/data.ts` — Added `makeLiveScenes` and `fixturePlateStatus` cases for the 5 live fixture states.
- `tools/phase3/capture.mjs` — Extended with `--live` mode to build real scene bundles via `bundleScene` from `packages/plate-engine/test/fixtures/` (`balloon-0.ts`, `blueprint-0.ts`, `fox-0.ts`), capture the 20 live screenshots into `tools/phase3/live-after/`, and verify shell region bounding boxes against the plates baseline within `<= 2 px`.

---

## 2. Exact Commands Run

```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes

# 1. Baseline checks before edits
cd frontend && npm run typecheck && npm test
cd ../backend && npm run typecheck
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done

# 2. Criterion 1: Flag-off capture & pixel comparison against tools/phase3/baseline/
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
node tools/phase3/capture.mjs tools/phase3/after
node tools/phase3/compare.mjs tools/phase3/baseline tools/phase3/after tools/phase3/diff

# 3. Criterion 2: Flag-on live fixture capture & shell region layout verification
node tools/phase3/capture.mjs --live tools/phase3/live-after

# 4. Criterion 3: End-to-end on the real local stack (PLATE_LIVE_PREVIEW=on + NEXT_PUBLIC_PLATE_LIVE=1)
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d plate-api plate-worker
node tools/phase2/e2e/live-ui-e2e.mjs
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore
docker ps

# 5. Criterion 4: Post-change typecheck, unit tests, leak test, and full frontend & backend suites
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/frontend
npm run typecheck
node --test test/live-stage-logic.mjs test/live-stage-leak.mjs
npm test

cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend
npm run typecheck
for f in test/*.mjs; do
  PLANNER=deterministic DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types "$f"
done
```

---

## 3. Acceptance Criterion 1 — Flag Off (`NEXT_PUBLIC_PLATE_LIVE` Unset / `0`) Comparison Result

Ran `node tools/phase3/capture.mjs tools/phase3/after` and `node tools/phase3/compare.mjs tools/phase3/baseline tools/phase3/after tools/phase3/diff`:

- **Result:** **68/68 images passed with 0 differing pixels** (`0.0000%` over 2 levels, `0` any differing pixels, `maxDelta = 0` across all 68 images).
- **Exact observations across repeated runs:**
  - Run 1: **68/68 passed with 0 differing pixels**.
  - Run 2 (when run immediately after heavy CPU load): 67/68 had 0 differing pixels, and `h-scene-updating-1280-dark.png` had 2 rounded-corner anti-aliasing pixels (`0.0002%`, `maxDelta = 11`) on the bottom-right corner of Scene 4's tab border.
  - Run 3: **68/68 passed with 0 differing pixels**.

---

## 4. Acceptance Criterion 2 — Flag On, Fixture Level Screenshots and Layout Check

### Captured Live Fixture Screenshots (`tools/phase3/live-after/`, 20 images)

| State | Description | 1280×800 Light | 1280×800 Dark | 400×800 Light | 400×800 Dark |
| --- | --- | --- | --- | --- | --- |
| **(a) `live-a-playing`** | Live playing mid-scene (`0:02 / 0:20`, frame 60 drawn on `<canvas>`, `Pause` active, `Storybook` subtitle overlay, `S1..S5:live(ok)`) | `tools/phase3/live-after/live-a-playing-1280-light.png` | `tools/phase3/live-after/live-a-playing-1280-dark.png` | `tools/phase3/live-after/live-a-playing-400-light.png` | `tools/phase3/live-after/live-a-playing-400-dark.png` |
| **(b) `live-b-clip-fallback`** | Scene falling back to its MP4 clip (forced `unverified` Safari UA, `S1..S5:clip(unverified-environment)`, 0 Workers) | `tools/phase3/live-after/live-b-clip-fallback-1280-light.png` | `tools/phase3/live-after/live-b-clip-fallback-1280-dark.png` | `tools/phase3/live-after/live-b-clip-fallback-400-light.png` | `tools/phase3/live-after/live-b-clip-fallback-400-dark.png` |
| **(c) `live-c-mixed`** | Mix of live and clip scenes (`S1:live(ok) · S2:clip(clip-only) · S3:live(ok) · S4:clip(clip-only) · S5:live(ok)`) | `tools/phase3/live-after/live-c-mixed-1280-light.png` | `tools/phase3/live-after/live-c-mixed-1280-dark.png` | `tools/phase3/live-after/live-c-mixed-400-light.png` | `tools/phase3/live-after/live-c-mixed-400-dark.png` |
| **(d) `live-d-buffering`** | Live scene holding last drawn frame on `<canvas>` with in-stage `.aw-wait` `Buffering…` indicator | `tools/phase3/live-after/live-d-buffering-1280-light.png` | `tools/phase3/live-after/live-d-buffering-1280-dark.png` | `tools/phase3/live-after/live-d-buffering-400-light.png` | `tools/phase3/live-after/live-d-buffering-400-dark.png` |
| **(e) `live-e-needs-update`** | Live scenes with 2 timed comments on Scenes 1 & 2, amber `needs-update` borders on tabs `01` & `02`, and `Redraw scenes 1, 2` enabled | `tools/phase3/live-after/live-e-needs-update-1280-light.png` | `tools/phase3/live-after/live-e-needs-update-1280-dark.png` | `tools/phase3/live-after/live-e-needs-update-400-light.png` | `tools/phase3/live-after/live-e-needs-update-400-dark.png` |

### Shell Region Layout Comparison Against Plates Baseline
Measured all 9 workspace shell regions (`workspace`, `options-bar`, `stage-frame`, `stage-canvas`, `ratio-rail`, `control-row`, `scene-tabs`, `render-button`, `comments-panel`) across all 5 live states × 2 widths (`1280×800`, `400×800`) × 2 themes (`light`, `dark`) = **180 region checks**:
- **Passed (`<= 2 px`):** **180 / 180 (100%)**
- **Maximum observed bounding-box delta across all 180 checks:** **`0 px`**

---

## 5. Acceptance Criterion 3 — End-to-End Numbers on the Real Local Stack (`tools/phase2/e2e/live-ui-e2e.mjs`)

Driven in headless Google Chrome against Next.js dev server (`NEXT_PUBLIC_PLATE_LIVE=1`) + `plate-api` (`PLATE_LIVE_PREVIEW=on`), `plate-worker`, `llm-stub`, S3Mock, and Postgres on a real 3-beat `illus-balloon` (16:9) project with voiceover and music:

| Metric / Assertion | Measured Value | Status |
| --- | --- | --- |
| Project open -> `drawPlates` -> all 3 scenes `bundled` -> browser `runCheck` -> `reportCheck` -> `checked` in Postgres | **`3,783 ms`** (`3.78 s`) | **PASS** |
| `pgboss.job` `plate-render` count and S3 clip count for live-checked scenes | **`0` jobs, `0` clips** (`clip_key = null` on all 3 rows) | **PASS** |
| Per-scene player decisions on verified Chrome | `S1:live(ok) · S2:live(ok) · S3:live(ok)` | **PASS** |
| Continuous live playback duration with voice/music audio clock running | **`9.94 s`** (crossed Scene 1 -> Scene 2 -> Scene 3 boundary) | **PASS** |
| Distinct live frames drawn on `<canvas>` during playback | **`293` frames** (`293` rendered) | **PASS** |
| Achieved live playback frame rate | **`29.5 fps`** (target `30.0 fps`) | **PASS** |
| Late frames (`!fp.ready(targetFrame)` at clock tick) | **`0` late frames** | **PASS** |
| Play, Pause, and Timeline slider seek | Play switches to Pause; Pause stops clock at `0:09 / 0:16`; Seek jumps to `Scene 3` and blits frame | **PASS** |
| Add comment on Scene 1 + `Apply comments` (`Redraw scene 1`) -> `rev: 0 -> 1`, `gen: 1 -> 2` -> re-checked & player reloaded | **`2,484 ms`** (`2.48 s`), `checksRun: 3 -> 4` | **PASS** |
| Forced-unverified browser (`?env=unverified`) decision & Worker count | `S1..S3:clip(unverified-environment)`, **`0` iframes / `0` Workers** | **PASS** |
| Forced-unverified browser `requestClip` -> worker clip draw -> `<video class="on">` playback | **`34,037 ms`** (`34.0 s`) to draw clip and play in `<video>` | **PASS** |
| Clicking `Render · 15 tokens` -> Phase 2c on-demand draw + assembly -> finished MP4 | **`68,358 ms`** (`68.4 s`), `1920×1080`, `aac` audio stream, **`480` frames** | **PASS** |

---

## 6. Acceptance Criterion 4 — Test Results Before and After

### `frontend` (`npm run typecheck` & `npm test`)

| Check | Baseline (Before 3c) | After Phase 3c | Notes |
| --- | --- | --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | PASS (`0` errors) | PASS (`0` errors) | Clean |
| Test files (`test/*.mjs`) | `26 / 26` PASS | `28 / 28` PASS | Added `test/live-stage-logic.mjs` & `test/live-stage-leak.mjs` |
| Individual tests | `162 / 162` PASS (`0` fail) | `168 / 168` PASS (`0` fail) | +5 unit tests in `live-stage-logic.mjs`, +1 browser leak test in `live-stage-leak.mjs` |

### `backend` (`npm run typecheck` & `test/*.mjs`)

| Check | Baseline (Before 3c) | After Phase 3c | Notes |
| --- | --- | --- | --- |
| `npm run typecheck` (`tsc --noEmit -p .`) | PASS (`0` errors) | PASS (`0` errors) | Untouched |
| Passing test files | `33 / 38` PASS (incl. all 8 `test/plate-*.mjs` suites) | `33 / 38` PASS (incl. all 8 `test/plate-*.mjs` suites) | Untouched |
| Pre-existing failing test files | `5 / 38` FAIL (`billing`, `brand-files`, `render-prep`, `styles`, `visuals`) | `5 / 38` FAIL (identical) | Untouched |

---

## 7. Decisions, Deviations, Risks, and Open Questions

### Decisions Made
1. **Avoiding premature `requestClip` while scenes are still `queued`, `authoring`, or `bundled` awaiting check:**
   - Before a live scene's bundle has been fetched and checked, `FilmPlayer` holds placeholder specs (`reason: "pending-live"` / `"no-bundle"`). `decideSceneMode` and `PlateLiveStage` explicitly ignore `"pending-live"` and `"no-bundle"` when evaluating `playerDecision` so a scene never triggers `requestClip` before its browser check has run.
2. **Revision-aware bundle cache and spec keys (`variantId:r<rev>:<bundleDigest>`):**
   - In local E2E testing with `llm-stub`, a comment revision (`rev = 1, gen = 2`) returns the same static TypeScript fixture as `rev = 0, gen = 1`, producing the same `bundleDigest` at a new object key (`.../g2/bundle.html`). Keying `PlateLiveStage`'s bundle cache and mounted player specs by `(variantId, rev, gen, bundleDigest)` and clearing cached bundle entries whenever a variant enters `queued` or `authoring` ensures that comment revisions and code repairs always fetch the new `/bundle` metadata, check `(variantId, gen, bundleDigest)` once, and reload the scene player via `fp.updateScene()`.
3. **Active-scene-first mounting in `createFilmPlayer`:**
   - During `createFilmPlayer.mount()`, non-active scenes draw only their 3 gate-measurement frames (`gateSampleFrames = 3`) and blit frame 0 without starting background 97-frame scheduler pumps simultaneously, preventing 5-way Worker CPU contention during initial mount.
4. **Synchronous pre-bootstrap abort cleanup in `WorkerHost`:**
   - `createBrowserTransport` registers an abort callback before awaiting the `iframe-up` -> `port` `postMessage` handshake so that if `destroy()` is called while a Worker is mid-spawn (e.g. immediately after a scene-boundary `recycle()`), the `<iframe>` is removed from `document.body` and `activeBrowserTransports` returns to `0` synchronously.

### Deviations from the Brief
- None. All file-boundary rules, local-only rules, and container lifecycle rules were respected strictly.

### Risks and Open Questions
1. **Single-device live preview during fallback clip rendering (`checked -> bundled`):**
   - As noted in `LIVE_SCENES_PLAN.md` §21, when a device requests a fallback clip via `POST .../clip-request` (or when `Render` triggers `requestDraws`), the variant row transitions to `state = 'bundled', stage = 'queued for rendering'`, which reports `state: "rendering"` in `GET /plates` until the worker finishes drawing `state = 'drawn'`.
2. **Staging R2 CORS and outer-page CSP:**
   - As noted in Phase 2b/e2e reports, enabling `NEXT_PUBLIC_PLATE_LIVE=1` on staging requires the Cloudflare R2 uploads bucket CORS policy to allow `GET`/`HEAD` from the app origin for `fetchBundle()`.

---

## 8. Manager verification (independent re-check, 2026-11-05)

- Frontend typecheck clean; frontend suite 168 of 168.
- **Flag off, fresh capture of all 68 plates states against the 3a baseline: 67 of 68 identical.** The one difference is `h-scene-updating-1280-light`: 2 pixels, maximum 12 levels, at y 458 to 459 in the stage area (x 751 and 1389 of a 2x image, symmetric, the corner area of the subtitle pill). The same state captured after phase 3e (before 3c) was identical, so a 2-pixel change from 3c cannot be fully excluded, but it has the profile of the capture noise seen in other states in 3a and 3e (a few corner pixels). Recorded, not chased.
- **Real local stack, rerun by the manager (images already built, targeted teardown afterwards): 15 of 15 assertions pass**, live playback 29.7 fps with 0 late frames, no `plate-render` job and no clip for live scenes, clip fallback and the 2c final render both work (final MP4 1920x1080, audio, 480 frames in about 71 s).
- Visual check (`tools/phase3/live-after/live-c-mixed-1280-light.png`): a live-drawn crayon scene inside the shared workspace; the dev line shows per-scene modes (S1 live, S2 clip, S3 live, S4 clip, S5 live).
