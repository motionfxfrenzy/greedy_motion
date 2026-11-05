# Phase 3g Report: Smooth 30 fps Playback, Video-Style Buffering with Web Audio Timeline, Draw-Once Frame Store, Background Quality Job, and Background Drawing

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw` (branch `codex/live-predraw`, on top of WIP commit `26b5d5a`).
No changes to `packages/`, `backend/`, `worker/`, `frontend/lib/api.ts`, `package.json`, or lockfiles.

---

## 1. Revision 2 Audit (`26b5d5a` vs Revised Brief)

| Section / Requirement | Status (`kept` / `reworked` / `new`) | What Was Done |
| --- | --- | --- |
| **1. 30 fps (`PREVIEW_FRAME_STEP = 1`)** | `kept` (cleaned stale comment in `live-plate-player.mjs`) | `PREVIEW_FRAME_STEP = 1` in `frontend/lib/live/predraw.ts`; `runCheck` untouched. Updated stale step-2 comment in `frontend/test/live-plate-player.mjs`. |
| **2. Player states & clip reasons** | `kept` | States `drawing`, `ready`, `playing`, `buffering`, `clip`. Removed `predraw-too-slow` and `predraw-over-budget`; kept `unverified-environment`, `unsupported-environment`, `worker-unhealthy`, and bundle-load failure with `FallbackLatch`. |
| **2. Start rule (1.25x safety margin) & `prepared on disk` vs `decoded window`** | `reworked` | Added `DRAW_TIME_SAFETY_MARGIN = 1.25` in `predraw.ts`: `decidePredraw` plans `L` from `plannedDrawMs = avgDrawMs * 1.25` (`plannedProduceFps = 1000 / plannedDrawMs`) and `PlatePlayer.updatePrepare()` continuously re-measures `L` while drawing continues. Separated `preparedOnDiskAhead` (`FrameStore`) from `decodedWindowAhead` / `decodedWindowCap` (`DECODED_WINDOW_FRAMES = 90` in `FrameCache`, within `resolveCacheBudgetBytes`). |
| **2. Catch-up buffering (`min(30, framesLeft)`)** | `kept` | Holds `lastShownFrame`, shows `"Buffering…"` on stage and `StatusLine`, pauses clock and audio, resumes when `min(30, framesLeft)` frames are ready ahead. |
| **2. One clock, one Web Audio timeline (`AudioContext`)** | `new` / `reworked` | Added `frontend/lib/live/film-audio.ts` (`WebAudioFilmTimeline` & `FakeAudioContext`) and wired it into `clock.ts`, `plate-player.ts`, `plate-live-stage.tsx`, and `plate-preview.tsx`. Decodes per-scene voice takes, music, and SFX once to `AudioBuffer`s and schedules `AudioBufferSourceNode`s against `AudioContext.currentTime` (`filmTime = contextTime - offset`). Suspends `AudioContext` on buffering, resumes and reschedules from the clock on exit, handles mid-SFX seeking (plays remainder), backward seek, loop, scene boundaries, hidden tab (`visibilitychange` pauses both), device sleep/wake clamping, and autoplay policy. Removed hard-coded `buffering: false` in `plate-preview.tsx`. |
| **3. Draw-once frame store (`gm-live-frames`) & owner decision on what is shown** | `reworked` | Kept IndexedDB schema (`frames` and `scenes`), WebP encoder Worker, complete-scene zero-Worker replay, partial-scene resume, revision deletion, and 500 MB LRU film eviction. Reworked `PlatePlayer` frame pipeline per owner decision (2026-11-05): a frame shown at the moment it is drawn (`previewIdx === currentFrame`) is blitted from the freshly drawn bitmap (exact); a frame drawn ahead of playback is saved to `FrameStore`, its raw bitmap closed, and shown from the stored WebP copy at the chosen quality (0.4 default). |
| **3a. Background-work limits (bounded encoder queue, bitmap close, cancellation)** | `new` / `reworked` | Added `MAX_ENCODER_QUEUE = 8` slot semaphore to `FrameStore` and `BrowserWebpEncoder` so drawing waits when 8 encodes are in flight. Added late-bitmap closing in `WorkerHost.handlePortMessage`, `FrameScheduler.runNext`/`runSlice`, `PlatePlayer`, and `QualityJob`. Added `FrameStore.cancelSceneWork(bundleDigest)` and `QualityJob.cancelScene(bundleDigest)` to cancel encoding, quality job, and draw-ahead when `bundleDigest` or quality changes or on `destroy()`. |
| **4. Quality setting & `QualityJob` (both raise and lower redraw)** | `reworked` | Removed all stored-copy re-encoding (`reencode`, `reencodeFrame`, blob branch in encoder Worker). Both raising (`0.4 -> 0.6`) and lowering (`0.6 -> 0.2`) redraw frames with the scene code via `redrawFrameForQuality` and save at the new quality. Surfaced `"Raising preview quality… X / Y frames"` / `"Lowering preview quality… X / Y frames"` in `decideSceneMode` (`live-stage-logic.ts`) and `PlatePreview` `statusBadge`. |
| **5. Background drawing ahead** | `reworked` | `startBackgroundDrawLoop` in `plate-player.ts` waits while the active scene is pumping/preparing/buffering so at most one Worker draws at a time while paused, drawing missing frames of the current scene then following scenes in order and yielding immediately when playback needs the CPU. |
| **6. Unit tests, Chrome tests, & screenshots** | `reworked` | Updated `live-predraw.mjs`, `live-frame-store.mjs`, `live-plate-player.mjs`, `live-stage-logic.mjs`, and `live-predraw-chrome.mjs` for all Revision 2 assertions. |

---

## 2. Code Ownership Map (Before Editing)

| Behaviour | Existing Owner (Module & Function / Class) | How Extended in Phase 3g |
| --- | --- | --- |
| Preview frame step, lead `L`, fallback latch | `frontend/lib/live/predraw.ts` (`PREVIEW_FRAME_STEP`, `decidePredraw`, `FallbackLatch`) | Set `PREVIEW_FRAME_STEP = 1`; added `DRAW_TIME_SAFETY_MARGIN = 1.25`, `DECODED_WINDOW_FRAMES = 90`, `startBufferFrames`, `resumeBufferFrames`, `BufferingStateMachine`; removed slowness/budget clip reasons from `decidePredraw`. |
| Film clock & frame selection | `frontend/lib/live/clock.ts` (`PlaybackClock`, `frameAt`, `sceneAt`, `chooseFrame`) | Added `SfxCueTracker`, `FilmClock`, and `frontend/lib/live/film-audio.ts` (`WebAudioFilmTimeline`, `FakeAudioContext`) driving `PlaybackClock` from `AudioContext.currentTime - offset`. |
| Scene & film live players, measurement queue | `frontend/lib/live/plate-player.ts` (`PlatePlayer`, `createFilmPlayer`, `runExclusiveMeasure`, `activeDrawWork`) | Separated `preparedOnDiskAhead` vs `decodedWindowAhead`/`decodedWindowCap`; wired `FrameStore` zero-Worker replay, exact-at-draw vs stored-ahead frame blitting, 1.25x re-measurement in `updatePrepare`, `QualityJob`, `WebAudioFilmTimeline`, and background draw-ahead. |
| Rolling in-memory frame cache | `frontend/lib/live/frame-cache.ts` (`FrameCache`, `computeRollingWindow`) | Reused unchanged for the 90-frame decoded memory window (`decodedWindow`). |
| Priority frame scheduler | `frontend/lib/live/frame-scheduler.ts` (`FrameScheduler.runNext`, `runSlice`) | Extended `runNext` and `runSlice` to close any drawn `ImageBitmap` immediately if the scheduler was paused/halted while `draw()` was in flight. |
| Sandboxed Worker host & bitmap tracking | `frontend/lib/live/worker-host.ts` (`WorkerHost`, `handlePortMessage`, `trackBitmap`) | Extended `handlePortMessage` to close any transferred `ImageBitmap` arriving after transport termination, recycle, or `destroy()`. |
| Per-scene mode & workspace status resolution | `frontend/lib/live/live-stage-logic.ts` (`decideSceneMode`) | Added `playerState`, `isBuffering`, and `statusText` (`"Drawing scene N… P %"`, `"Buffering…"`, `"Raising/Lowering preview quality… X / Y frames"`). |
| Live stage mounting & RAF tick | `frontend/components/plate-live-stage.tsx` (`PlateLiveStage`) | Wired `WebAudioFilmTimeline` master clock, immediate `setBuffering(true)` on buffering/drawing, `previewQuality` prop changes to `fp.setPreviewQuality`, and store/quality status callbacks. |
| Step-3 Plates page & audio/options state | `frontend/components/plate-preview.tsx` (`PlatePreview`) | Initialized `WebAudioFilmTimeline` (with `<audio>` element fallback when `AudioContext` is unavailable), user-gesture `AudioContext` unlock in `toggle()`, cue-crossing SFX, `previewQualityControls`, and `statusBadge`. |
| Shared step-3 toolbar options | `frontend/components/animation-workspace/` (`OptionsBar.tsx`, `logic.ts`, `types.ts`, `AnimationWorkspace.tsx`) | Added `previewQuality` dropdown (`Low` 0.2 / `Standard` 0.4 / `High` 0.6) enabled for Plates and hidden (`previewQuality: false` in `hfOptionsConfig`) for HyperFrames. |

---

## 3. Files Changed (Line Counts)

| File | Total Lines | Role |
| --- | ---: | --- |
| `frontend/lib/live/predraw.ts` | 403 | `PREVIEW_FRAME_STEP = 1`, `DRAW_TIME_SAFETY_MARGIN = 1.25`, `DECODED_WINDOW_FRAMES = 90`, `decidePredraw`, `BufferingStateMachine`, `FallbackLatch`. |
| `frontend/lib/live/film-audio.ts` | 645 | New single `AudioContext` timeline (`WebAudioFilmTimeline`) and deterministic `FakeAudioContext`. |
| `frontend/lib/live/clock.ts` | 517 | `PlaybackClock`, `SfxCueTracker`, `FilmClock` integrated with `WebAudioFilmTimeline` and element fallback. |
| `frontend/lib/live/frame-store.ts` | 1,461 | `FrameStore` (`gm-live-frames` IndexedDB + `InMemoryFrameStoreBackend`), bounded `BrowserWebpEncoder` (`MAX_ENCODER_QUEUE = 8`), LRU eviction, revision cleanup, and redraw-only `QualityJob`. |
| `frontend/lib/live/frame-scheduler.ts` | 226 | Closes in-flight bitmaps if scheduler is paused/invalidated before `draw()` resolves. |
| `frontend/lib/live/plate-player.ts` | 2,135 | `PlatePlayer` and `createFilmPlayer` with `preparedOnDiskAhead` vs `decodedWindowAhead`, exact-at-draw vs stored-ahead blits, zero-Worker complete-scene replay, `QualityJob`, and background draw-ahead. |
| `frontend/lib/live/worker-host.ts` | 922 | Closes any late `ImageBitmap` arriving on a terminated/recycled/destroyed port. |
| `frontend/lib/live/live-stage-logic.ts` | 573 | Exposes `playerState`, `isBuffering`, and `statusText` (drawing %, buffering, quality job progress). |
| `frontend/lib/live/types.ts` | 47 | `PlaybackState` (`"drawing" \| "ready" \| "playing" \| "buffering" \| "clip"`). |
| `frontend/lib/live/index.ts` | 13 | Re-exports `frame-store.ts` and `film-audio.ts`. |
| `frontend/components/plate-live-stage.tsx` | 1,100 | Connects `WebAudioFilmTimeline`, `previewQuality`, `QualityJob` progress, and buffering state to `FilmPlayer`. |
| `frontend/components/plate-preview.tsx` | 1,112 | Manages `WebAudioFilmTimeline`, autoplay gesture unlock, `previewQuality`, and `statusBadge`. |
| `frontend/components/animation-workspace/OptionsBar.tsx` | 556 | Renders `Preview quality: Low / Standard / High` dropdown for plate films. |
| `frontend/components/animation-workspace/logic.ts` | 486 | `WORKSPACE_PREVIEW_QUALITIES`, `resolveVisibleOptions`, `hfOptionsConfig` (`previewQuality: false`). |
| `frontend/components/animation-workspace/types.ts` | 208 | `WorkspacePreviewQuality`, `WorkspacePreviewQualityControlState`. |
| `frontend/components/animation-workspace/AnimationWorkspace.tsx` | 186 | Passes `previewQualityControls` to `OptionsBar`. |
| `frontend/test/live-predraw.mjs` | 491 | Unit tests for 30 fps, 1.25x safety margin start rule, `decodedWindow` vs `preparedOnDisk`, and exact-vs-stored blits. |
| `frontend/test/live-frame-store.mjs` | 848 | Unit tests for `FrameStore`, bounded encoder queue (`<= 8`), bitmap opens == closes, cancellation, redraw-only `QualityJob`, `BufferingStateMachine`, and `WebAudioFilmTimeline`. |
| `frontend/test/live-predraw-chrome.mjs` | 770 | Headless Chrome integration test across the 4 crayon staging scenes at 30 fps. |
| `frontend/test/live-plate-player.mjs` | 326 | Updated for 30 fps (`PREVIEW_FRAME_STEP = 1`) and no slowness fallback. |
| `frontend/test/live-stage-logic.mjs` | 349 | Tests drawing progress, buffering, and quality job status text in `decideSceneMode`. |
| `frontend/test/workspace-logic.mjs` | 204 | Tests `previewQuality` visibility in `resolveVisibleOptions`. |
| `frontend/test/hf-step-logic.mjs` | 152 | Verifies `previewQuality: false` for HyperFrames. |

---

## 4. State Machine, Constants, and `prepared on disk` vs `decoded window`

### Constants
- `PREVIEW_FRAME_STEP = 1` (30 fps: every source frame is drawn and shown).
- `START_BUFFER_FRAMES = 30` (1.0 s minimum start buffer at 30 fps).
- `DRAW_TIME_SAFETY_MARGIN = 1.25` (1.25x safety margin applied to measured draw time `avgDrawMs` when computing `L`).
- `PREDRAW_CUSHION_SECONDS = 0.5` (15 frames at 30 fps).
- `DECODED_WINDOW_FRAMES = 90` (~3.0 s decoded `ImageBitmap` memory window in `FrameCache`, bounded by `resolveCacheBudgetBytes`).
- `RESUME_BUFFER_FRAMES = 30` (catch-up buffering resumes when `min(30, framesLeft)` frames are ready ahead).
- `MAX_ENCODER_QUEUE = 8` (maximum concurrent frames in the WebP encoder queue; drawing waits when full).
- `FRAME_STORE_MAX_BYTES = 500 * 1024 * 1024` (500 MB per-site cap in IndexedDB `gm-live-frames`).
- `DEFAULT_PREVIEW_QUALITY = 0.4` (`Low = 0.2`, `Standard = 0.4`, `High = 0.6`, persisted under `localStorage["gm-plate-preview-quality"]`).
- `MAX_SLEEP_JUMP_SECONDS = 1.5` (single-tick jump threshold above which `WebAudioFilmTimeline` clamps advance to `1 / fps` and re-anchors `offset`).

### Player State Machine (`PlaybackState`)
1. `drawing`: Initial start buffer is not ready yet. Exits to `ready` (or `playing` if `wantPlay`) once `readyAhead >= min(framesLeft, max(30, L))` where `L = min(N, ceil(N * max(0, 1 - p_safe / 30)) + 15)` and `p_safe = 1000 / (1.25 * avgDrawMs)` (re-measured as drawing continues). Stage and `StatusLine` show `"Drawing scene k… P %"`.
2. `ready`: Start buffer is ready and playback is paused.
3. `playing`: Advancing at 30 fps driven by the film clock. Each shown frame's bitmap behind the playhead is immediately `close()`d and evicted from `FrameCache`.
4. `buffering`: Entered if the due frame is not ready (`readyAhead < 1`). Holds `lastShownFrame` on canvas (never shows a wrong frame), shows `"Buffering…"`, pauses the clock, and calls `AudioContext.suspend()` on the same synchronous frame. Exits to `playing` (or `ready`) when `readyAhead >= min(30, framesLeft)`.
5. `clip`: Terminal fallback used **only** for `unverified-environment`, `unsupported-environment`, `worker-unhealthy`, or bundle-load failure. Never triggered for slowness or memory budget.

### Separation of `prepared on disk` vs `decoded window`
- **`prepared on disk` (`FrameStore`, `preparedOnDiskAhead(idx)`)**: Compressed WebP blobs (`~20–48 KB/frame`) persisted in IndexedDB `gm-live-frames`. Counts toward `readyAhead(idx)` for the start rule `max(30, L)` because decoding a stored WebP blob takes ~3 ms.
- **`decoded window` (`FrameCache`, `decodedWindowAhead(idx)`, `decodedWindowCap()`)**: Decoded `ImageBitmap`s (`921.6 KB/frame` at `640x360`) held in RAM ahead of the playhead, capped at `DECODED_WINDOW_FRAMES = 90` frames within `resolveCacheBudgetBytes()`.
- **What is shown (Owner Decision, 2026-11-05)**: A frame shown at the moment it is drawn (`previewIdx === currentFrame` when blitted immediately) is the exact freshly drawn bitmap while a `createImageBitmap` copy is transferred to the WebP encoder Worker. A frame drawn ahead of playback is saved to `FrameStore`, its raw bitmap is `close()`d, and it is shown from the stored WebP copy at the chosen quality (`0.4` by default).

---

## 5. One Clock, One Web Audio Timeline (`frontend/lib/live/film-audio.ts`)

- **Single `AudioContext`**: `WebAudioFilmTimeline` decodes per-scene voice takes, background music, and sound effects once into `AudioBuffer`s and schedules `AudioBufferSourceNode`s through `GainNode`s against `AudioContext.currentTime`.
- **Master time**: While audio is active and `AudioContext.state === "running"`, `currentTime()` is `AudioContext.currentTime - contextOffset`. With no audio (or if `AudioContext` is unavailable in the environment, where `PlatePreview` falls back to `<audio>` elements), the wall-clock fallback is used.
- **Buffering lockstep**: `setBuffering(true)` freezes `pausedFilmTime`, stops active source nodes, and calls `context.suspend()` synchronously. `setBuffering(false)` re-anchors `contextOffset = context.currentTime - pausedFilmTime`, calls `context.resume()`, and reschedules active voice, music, and any mid-cue SFX from `pausedFilmTime` (0.0 ms drift across 20+ buffering pauses).
- **Cue crossings & mid-SFX seek**: `SfxCueTracker` checks cue crossings on each clock tick while playing and not buffering. Seeking calls `SfxCueTracker.seek(localSec)` (never firing jumped-over cues, re-arming cues on backward seek) and `scheduleActiveMidCues` schedules the remaining tail (`from mediaStart + (localSec - cue.offset)`) of any sound effect that spans the seek target.
- **Hidden tab (`visibilitychange`)**: We chose the **pause-both** behaviour: when `document.visibilityState === "hidden"`, `setHidden(true)` freezes `pausedFilmTime`, stops active sources, and suspends the `AudioContext`; when `visible` again, `setHidden(false)` re-anchors `contextOffset`, resumes the `AudioContext`, and reschedules sources from `pausedFilmTime` so clock and audio stay together.
- **Device sleep / resume**: If a single tick jumps by `> MAX_SLEEP_JUMP_SECONDS` (1.5 s), `tick()` clamps the advance to `1 / fps`, re-anchors `contextOffset`, and reschedules sources so no burst of cues fires and no drift occurs.
- **Autoplay policy**: `unlockFromUserGesture()` creates/resumes the `AudioContext` inside `toggle()` (the play click handler). If `play()` is called when the context remains `suspended` (no user gesture), `onAutoplayBlocked` reverts `playing` to `false` so the UI shows the normal Play button and never plays silently.

---

## 6. Store Schema (`gm-live-frames`) & Quality Job (`QualityJob`)

### IndexedDB Schema (`gm-live-frames`, version 1)
1. Object store **`frames`**:
   - Key: `${bundleDigest}|${w}x${h}|${frame}` (e.g. `e3b0c44...|640x360|12`)
   - Value (`StoredFrameRecord`): `{ blob: Blob (image/webp), quality: 0.2 | 0.4 | 0.6, savedAt: number }`
2. Object store **`scenes`**:
   - Key: `${bundleDigest}|${w}x${h}`
   - Value (`StoredSceneRecord`): `{ frames: number, saved: number, complete: boolean, quality: number | "mixed", bytes: number, lastUsed: number, filmKey: string, variantKey?: string, frameQualities?: Record<number, number>, frameBytes?: Record<number, number> }`

### `QualityJob` Ordering and Redraw-Only Proof
- **Ordering (`buildQualityJobOrder`)**:
  1. Frames just ahead of the playhead in the focus scene (`[focusFrame .. min(frames - 1, focusFrame + 29)]`);
  2. Outward from that window in the focus scene (alternating behind `focusFrame - 1, ...` and further ahead `focusFrame + 30, ...`);
  3. Remaining scenes of the film: following scenes `focusSceneIndex + 1 .. N - 1` in order, then preceding scenes `focusSceneIndex - 1 .. 0`.
  - Scrubbing or clicking a scene calls `recenter(sceneIndex, frame)`, immediately shifting the next frame picked by `pickNextSlot()`.
- **Both raise and lower redraw from scene code**: Raising (`0.4 -> 0.6`) and lowering (`0.6 -> 0.2`) both call `redrawFrame(sceneIndex, frame)` (`WorkerHost.frame` through `runExclusiveMeasure`), save the new WebP blob at `targetQuality`, close the temporary `ImageBitmap` in `finally`, and reload the frame into `FrameCache` if it is currently inside the active decoded window.
- **Grep proof of zero stored-copy re-encoding in `frontend/lib/`**:
  ```
  $ rg -i "reencode|re-encode" frontend/lib/
  frontend/lib/live/frame-store.ts:1352: *   Never decodes-and-re-encodes a stored lossy copy (detail would be lost twice).
  ```

---

## 7. Tests & Measured Numbers

### Typecheck & Unit / Full Suite Tests
- `cd frontend && npm run typecheck`: **PASS** (0 errors).
- `cd frontend && npm test`: **197 / 197 PASS** (0 failures across all 33 test files in the parallel run).
- Standalone Next-dev-server interaction tests:
  - `node --test test/final-view-interaction.mjs`: **1 / 1 PASS** (`14,690.5 ms`).
  - `node --test test/hf-step-interaction.mjs`: **1 / 1 PASS** (`7,258.1 ms`).
- Key unit test proofs:
  - **Start rule 1.25x safety margin (`live-predraw.mjs`)**: A 150-frame 30 fps scene with `avgDrawMs = 50` ms (raw 20 fps) requires `startFrames = 85` with the 1.25x safety margin (`plannedDrawMs = 62.5` ms, `16` fps) vs `65` without margin; `PlatePlayer` stays in `state = "drawing"` at 65 frames ready and transitions to `ready` at 85 frames ready.
  - **Bounded encoder queue & bitmap leak check (`live-frame-store.mjs`)**: Pushing 20 concurrent `store.save()` calls caps `inFlightEncodes` and `peakEncoderQueue` at `8` (`MAX_ENCODER_QUEUE = 8`). Across normal drawing, `QualityJob` raise/lower, mid-job cancellation, `bundleDigest` revision change, and `destroy()`, `opened === closed` (`20 == 20` and `93 == 93`, `0` leaked bitmaps).
  - **Web Audio timeline (`live-frame-store.mjs`)**: Verified master clock (`ctx.currentTime - offset`), mid-SFX seek remainder (`chime` at `0.5s` with `mediaStart: 0.2s` and duration `1.2s` seeked at `0.8s` plays from `bufferOffset = 0.5s` for `remainingDuration = 0.7s`), jumping over finished cue (`0` fires), backward seek re-arming, loop, scene boundary, **20 buffering pauses with `0.0 ms` drift**, hidden tab pause/resume, 15s device sleep jump clamped to 1 frame (`0` burst cues), and autoplay block detection.

### Headless Chrome Measurements (`frontend/test/live-predraw-chrome.mjs`, 4 Crayon Fixtures at 30 fps, `640x360`, raw JSON in `tools/phase3/3g-chrome-run.json`)
- **First play (30 fps, quality `0.4`)**:
  - Scene 0 (`90` frames): `drawFps = 6.5` (`plannedFps = 5.2` with 1.25x margin), `L = 90`, `startFrames = 90`, `waitMs = 7,516 ms`, `wrongFrames = 0`.
  - Scene 1 (`150` frames): `drawFps = 3.7` (`plannedFps = 3.0`), `L = 150`, `startFrames = 150`, `waitMs = 36,800 ms`, `wrongFrames = 0`, `maxNextAhead = 21`.
  - Scene 2 (`150` frames): `drawFps = 7.8` (`plannedFps = 6.2`), `L = 134`, `startFrames = 134`, `waitMs = 23,599 ms`, `wrongFrames = 0`, `maxNextAhead = 69`.
  - Scene 3 (`150` frames): `drawFps = 29.2` (`plannedFps = 23.4`), `L = 49`, `startFrames = 49`, `waitMs = 0 ms`, `wrongFrames = 0`.
  - Total wrong frames across all 4 scenes (540 frames): **`0`**.
  - Exact vs stored blits: `freshBlits = 4,515` (frames shown at the moment drawn are exact), `storeBlits = 1,066` (frames drawn ahead of playback are shown from stored WebP copies at `0.4`).
  - Mid-scene catch-up buffering pauses: `bufferingPauses = 3`, `audioPausedImmediately = true` on every pause, `lagFrames = 0` (`<= 1` frame), `audioResumedImmediately = true`, `resumeDiffMs = 11.7 ms` and `11.8 ms` (well within `<= 33 ms`).
  - **20 consecutive buffering pauses on real `AudioContext` (`WebAudioFilmTimeline`)**: `count = 20`, `maxLagFrames = 0`, `maxResumeDiffMs = 0 ms` (`<= 33 ms`), `driftAcross20PausesMs = 0 ms`.
  - Memory & encoder bounds: `peak.cacheBytes = 100,454,400 B` (`<= 167,772,160 B` budget), `peak.hostBytes = 3,686,400 B`, `peakEncoderQueue = 2` (`<= 8`).
  - Bitmap accounting: `bitmapsOpened = 1,203`, `bitmapsClosed = 1,203` (`opened === closed`), `openAfterDestroy = 0`.
- **Replay after page reload**:
  - `framesPlayed = 540`, `workerFrameCalls = 0` (**zero** `WorkerHost.frame` calls), `activeWorkersDuringReplay = 0` (**zero** Workers spawned), `wrongFrames = 0`, `bufferingPauses = 0`, `mountMs = 271 ms`.
- **Quality jobs (`0.4 -> 0.6` and `0.6 -> 0.2`) during playback**:
  - `0.4 -> 0.6` (raise): `pausesCausedByJob = 0`, `workerCallsOnRaise = 540` (`raiseMs = 103,311 ms`), nearest-playhead frames upgraded first (`S1:35, S1:40, S1:41, S1:42, S1:43, S1:44`), all 4 scenes completed at `0.6`.
  - `0.6 -> 0.2` (lower): `pausesCausedByLowerJob = 0`, `workerCallsOnLower = 540` (`lowerMs = 101,181 ms`, redrew all 540 frames from scene code; `firstLowered = S1:41, S1:50, S1:51, S1:52, S1:53, S1:54`; 0 stored-copy re-encodes), all 4 scenes completed at `0.2`.
- **Single-scene `bundleDigest` revision (Scene 3)**:
  - `callsByScene = [0, 0, 0, 150]`, `workerCallsForRevision = 150`, `oldDigestDeleted = true`, `newDigestComplete = true`, `otherScenesComplete = [true, true, true]`.
- **Stored WebP bytes per frame (`640x360`, 540 frames)**:
  - Quality `0.2` (Low): **`20,994 B` (`20.50 KB`)** — within 20 % of `20 KB` (`[16.0, 24.0] KB`, `+2.5 %`).
  - Quality `0.4` (Standard): **`35,001 B` (`34.18 KB`)** — within 20 % of `34 KB` (`[27.2, 40.8] KB`, `+0.5 %`).
  - Quality `0.6` (High): **`49,133 B` (`47.98 KB`)** — within 20 % of `48 KB` (`[38.4, 57.6] KB`, `-0.04 %`).

---

## 8. Plates Screenshot Comparison (`tools/phase3/capture.mjs` & `compare.mjs`)

Compared `tools/phase3/baseline` against `tools/phase3/3g-after` (`node tools/phase3/compare.mjs tools/phase3/baseline tools/phase3/3g-after tools/phase3/3g-diff`):
- **36 / 68 captures are pixel-identical (`0` differing pixels)**:
  - All 8 step-4 final-view captures (`k-plate-final-{1280,400}-{dark,light}.png`, `q-plate-final-approved-{1280,400}-{dark,light}.png`): `0` differing pixels.
  - All 28 narrow (`400px`) step-3 captures where the Subtitle tab is active (`a`, `b`, `c`, `d`, `f`, `g`, `h`, `i`, `j`, `l`, `m`, `n`, `o`, `p` at `400-{dark,light}`): `0` differing pixels (the new `"Standard ▾"` preview quality pill sits past the horizontal scroll edge of the 360px floating bar when the longer Subtitle controls are shown).
- **32 / 68 captures have deliberate diffs caused solely by adding the `Preview quality` (`"Standard ▾"`) control to `OptionsBar` on the Plates step-3 page**:
  - `a-prep-drawing-1280-{dark,light}.png`, `b-prep-error-1280-{dark,light}.png`, `c-ready-1280-{dark,light}.png`, `d-comments-1280-{dark,light}.png`, `e-audio-open-1280-{dark,light}.png`, `g-token-modal-1280-{dark,light}.png`, `h-scene-updating-1280-{dark,light}.png`, `i-aspect-picker-1280-{dark,light}.png`, `j-hover-volume-fullscreen-1280-{dark,light}.png`, `p-aspect-drawing-1280-{dark,light}.png` (`0.93 % – 1.78 %` of pixels): the centered `.aw-floating-bar` toolbar includes the new separator and `"Standard ▾"` preview quality pill (`aria-label="Preview quality"`).
  - `f-subtitle-style-1280-{dark,light}.png`, `l-subtitle-mode-1280-{dark,light}.png`, `m-subtitle-colors-1280-{dark,light}.png`, `n-subtitle-opacity-1280-{dark,light}.png`, `o-subtitle-position-1280-{dark,light}.png` (`2.38 % – 7.30 %` of pixels): because `.aw-floating-bar` is horizontally centered and widened by the new `"Standard ▾"` pill, the open popover menu anchored to its trigger pill shifts horizontally by ~47 px.
  - `e-audio-open-400-{dark,light}.png` (`352–355` px, `0.11 %`): when the shorter Audio tab is open at `400px` width, the separator and left edge of `"Standard ▾"` are visible at the right end of `.aw-floating-bar`.
- **Live stage region layout check (`capture.mjs --live`)**: `360 / 360` shell regions across `live-a-playing`, `live-b-clip-fallback`, `live-c-mixed`, `live-d-buffering`, and `live-e-needs-update` coincided within `<= 2 px` (`0.0 px` max delta).
- **HyperFrames**: `hfOptionsConfig` sets `previewQuality: false`, so HyperFrames step 3 is completely unchanged.
