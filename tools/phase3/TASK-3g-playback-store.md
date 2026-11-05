# Task for the coding agent: phase 3g, smooth 30 fps playback of code-drawn plate scenes, video-style buffering with sound in step, draw-once frame storage, quality setting with a background job, background drawing

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

**Worktree:** `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw` (branch `codex/live-predraw`; HEAD is the WIP commit `26b5d5a`, an earlier unreviewed run of this task on an older version of this brief, on top of `23e1963`, what staging runs). Dependencies are installed. Do not touch `../VideoSaaS-live-scenes` or `../VideoSaaS-engine`: other tracks (each with its own manager and agent) own them.

## Revision 2 (2026-11-05): start here
This brief was revised after a second-opinion review and the owner's decisions. A previous run (WIP commit `26b5d5a`, no report) implemented most of v1. **First review that commit against this revised brief** (`git show --stat 26b5d5a`, read `frontend/lib/live/frame-store.ts` and the diffs of `plate-player.ts`, `predraw.ts`, `plate-preview.tsx`, `plate-live-stage.tsx`), keep what fits, and rework what does not. Begin the report with a table: each section below, `kept` / `reworked` / `new`. Differences from v1 that matter:
- **Owner decision (2026-11-05, "Yes, 0.4 is fine"):** a frame shown at the moment it is drawn is exact; a frame drawn ahead of playback is shown from the stored copy at the chosen quality (0.4 by default). No lossless temporary storage and no setting for this.
- Playing audio uses **one Web Audio timeline**, not several `<audio>` elements (section 2).
- The start buffer carries a **1.25x safety margin** and the decoded memory window is kept apart from the frames prepared on disk (section 2).
- **Lowering** quality also **redraws from the code** (section 4).
- Background work has **limits** (section 3a).
- Manager's read-only audit of `26b5d5a` (verify yourself): done and likely keepable: 30 fps, states and start/resume rules, frame store schema, complete-scene-skips-Worker, LRU, quality ordering, draw-ahead, cue-crossing SFX. Known gaps: `plate-preview.tsx` hard-codes `buffering: false` so voice and music do not pause on buffering; audio still uses `<audio>` elements; encoder `pending` map unbounded; no cancellation on `bundleDigest` change; no 1.25x margin; lowering re-encodes (must redraw); no "Raising/Lowering preview quality…" status text; no `docs/phase3/3g-report.md`; the `live-predraw-chrome.mjs` phases need the revised assertions.
- Wording: stored frames "replay **while stored**" (browsers can evict storage; then the scene draws again), never "forever".

## Goal
Smooth 30 fps playback of code-drawn plate scenes with voice, music and sound effects in step; every drawn frame stored once in the browser (WebP, 0.4 default) so scenes replay while stored; a Low/Standard/High quality setting applied by a background job; drawing ahead of playback. Measurable acceptance is the section "Acceptance criteria" below.

## Why
Read **`docs/LIVE_PLAYBACK_PLAN.md`** in full first: it is the design you are implementing (changes B, C, D, E and F; change A, the engine speed-up, is being done separately and you must not touch `packages/`). Then `docs/LIVE_SCENES_PLAN.md` sections 6, 20, 22 and 26, and `docs/phase3/3f-report.md` (phase 3f and its follow-up: pre-draw, the measurement queue, lazy decisions, `FallbackLatch`; you build on that code).

In one paragraph: plate scenes are drawn by their code in the user's browser (a Worker per scene, `frontend/lib/live/worker-host.ts`). Drawing can be slow (3 to 30 fps); the owner accepts waiting for drawing but requires **smooth 30 fps playback with voice, music and sound effects in step**, **no fallback to the server MP4 for slowness**, and **draw once**: every drawn frame is saved in the browser as lossy WebP so a scene replays without running its code again. Stored quality is **0.4 by default**, user-selectable **Low 0.2 / Standard 0.4 / High 0.6**, and changing it runs as a **background job** that never blocks playback.

## Read first (code)
1. `frontend/lib/live/predraw.ts` (`PREVIEW_FRAME_STEP`, `decidePredraw`, `FallbackLatch`, constants), `plate-player.ts` (whole file: `PlatePlayer`, `mount`, `fillUntilGate`, `pumpScheduler`, `showFrame`, `activeDrawWork`, the measurement queue, `createFilmPlayer`, lazy next-scene decisions), `frame-cache.ts`, `frame-scheduler.ts`, `clock.ts` (`PlaybackClock`), `worker-host.ts` (watchdog, heartbeat, recycle, byte accounting), `support.ts` (`resolveCacheBudgetBytes`, environment status), `live-stage-logic.ts` (`decideSceneMode` and its reasons), `api.ts`, `index.ts`, `types.ts`.
2. `frontend/components/plate-live-stage.tsx` (the stage: bundles, checks, clip requests, `forcedClipRef`, `LIVE_API`, status, waits) and `frontend/components/plate-preview.tsx` (the plates step-3 page: **all audio today**: per-scene voice `HTMLAudioElement`s, music, `playSceneSfx` with `setTimeout`s, the `requestAnimationFrame` tick, `wantPlay`, scene seeking), `frontend/components/animation-workspace/` (`OptionsBar`, `ControlRow`, `StatusLine`, `types.ts`, `logic.ts`), and `frontend/components/plate-preview.css` or wherever its styles live.
3. Tests: `frontend/test/live-predraw.mjs`, `live-predraw-chrome.mjs` (headless Chrome with the four crayon fixtures in `frontend/test/fixtures/crayon-staging/`), `live-plate-player.mjs`, `live-stage-logic.mjs`, `live-stage-leak.mjs`, `live-scheduler.mjs`, `live-cache.mjs`, `live-chrome-integration.mjs`, `plate-preview`-related tests, and `tools/phase3/capture.mjs` + `compare.mjs` (the 68 plates screenshots).

## Architecture rules
- Reuse, do not replace: `PlaybackClock` (`clock.ts`), `PlatePlayer`/`createFilmPlayer` (`plate-player.ts`), `FrameScheduler` (`frame-scheduler.ts`), `FrameCache` (`frame-cache.ts`), `WorkerHost` (`worker-host.ts`), `decidePredraw`/`FallbackLatch` (`predraw.ts`), `decideSceneMode` (`live-stage-logic.ts`). Extend them where the sections below say; add new code in new modules under `frontend/lib/live/` (`frame-store.ts` exists from the WIP; an audio module such as `frontend/lib/live/film-audio.ts` is new). Keep pure logic apart from browser APIs (IndexedDB, AudioContext, Worker) behind small interfaces so unit tests use fakes.
- No new dependencies, no `package.json` or lockfile changes, no shared-contract (`packages/`) changes, no backend or worker changes, no `frontend/lib/api.ts` changes.
- Deterministic and seek-safe: the frame shown for a clock time depends only on that time and the stored/drawn frames, never on how playback got there; seeking must not fire cues it jumps over, must not leave sources playing, must not draw out of order. Every timer, source node, Worker, bitmap and IndexedDB transaction has an owner and is released on destroy.
- Map the code first: before editing, list in the report which existing function owns each behaviour you change (read-only searches), so the manager can check you extended the right place.

## What to build (in this order)

### 1. 30 fps (plan change B)
- Set `PREVIEW_FRAME_STEP = 1`. Update comments and tests that assumed 2 (list each one in the report). `runCheck` must stay exactly as it is.

### 2. Video-style buffering and one clock (plan change C)
- **Player states** per scene and for the film: `drawing` (no frame ready yet), `ready`, `playing`, `buffering`, `clip` (only `unverified-environment`, `unsupported-environment`, `worker-unhealthy`, bundle-load failure). Remove the `predraw-too-slow` and `predraw-over-budget` clip reasons and their fallback paths (keep the measurement queue, lazy decisions and `FallbackLatch` for the remaining reasons). `decidePredraw` keeps computing the lead `L` from the draw rate; it no longer decides `clip` for slowness.
- **Start rule:** playback starts when `max(30 frames, L)` frames are ready ahead, where `L` is computed from the frames still to be prepared and the measured drawing rate **with a 1.25x safety margin on the measured draw time, re-measured while drawing continues**. "Ready" means a frame in memory or prepared in the store (step 3); frames waiting on disk count (they cost 3 ms to decode). **Window:** the *decoded memory window* is a separate thing: keep up to about 90 frames (3 s) decoded ahead within `resolveCacheBudgetBytes`; close each frame's bitmap once shown. Keep the two notions apart in names, comments and the report (`prepared on disk` vs `decoded window`).
- **Catch-up:** if the frame due is not ready, enter `buffering`: hold the last frame, show "Buffering…" on the stage, pause the clock; resume when `min(30, frames left in scene)` frames are ready again. Never show a frame other than the one due.
- **One clock, one audio timeline:** make `PlaybackClock` (or a small film clock built on it) the single source of time for the picture **and** the audio in `plate-preview.tsx`. All audio (per-scene voice takes, music, sound effects) plays through **one `AudioContext`**: decode each file once to an `AudioBuffer` and play it with `AudioBufferSourceNode`s started against `AudioContext.currentTime`; the film time is `contextTime - offset`. When the stage reports `buffering`, `suspend()` the context (everything stops at the same instant); on resume, `resume()` and reschedule the sources from the clock. Seeking stops the active sources and reschedules from the new time. If `AudioContext` is unavailable, fall back to the existing elements and say so in the report. Replace `setTimeout` sound-effect scheduling with cue crossings checked on each clock tick (a cue fires when the clock passes its time while playing; seeking never fires cues it jumps over). Scrubbing and scene clicks move the clock; audio follows. Keep every existing audio feature (voice, music, SFX and transition toggles, scene-relative voice takes).
- **Audio master time:** while audio is active, the film clock is derived from `AudioContext.currentTime` (film time = context time - offset), not from `requestAnimationFrame`/`performance.now` with audio following; with no audio, use the existing clock. On `visibilitychange` to hidden pick ONE behaviour, test it, and report which: either keep audio running and let the picture catch up on return, or pause both.
- **Autoplay policy:** create the `AudioContext`, or `resume()` it, inside the play click handler; decode the buffers ahead of time. If the context is `suspended` because there was no user gesture, show the normal play-button state; never play silently.
- Required audio test cases (fake `AudioContext` in unit tests, real one in Chrome where possible): seek into the middle of an active sound effect (it plays its remainder, in step); backward seek (cues re-arm); loop; scene boundary; repeated buffering (offset does not drift over 20 pauses); hidden tab (clock and audio stay together after the tab returns); device sleep / resume (no burst of cues, no drift).
- Expose the state to the shared workspace so `StatusLine` / the stage show "Drawing scene 2… 40 %", "Buffering…", and the play button behaves like a video player's.

### 3. Draw once: the frame store (plan change D)
- New module `frontend/lib/live/frame-store.ts` (pure logic separated from IndexedDB access so it can be unit tested with an in-memory fake):
  - IndexedDB database `gm-live-frames`: object store `frames` keyed `${bundleDigest}|${w}x${h}|${frame}` with `{ blob, quality, savedAt }`; object store `scenes` keyed `${bundleDigest}|${w}x${h}` with `{ frames, saved: count, complete, quality: number | "mixed", bytes, lastUsed, filmKey }`.
  - `save(frameBitmap, key, quality)` through a dedicated **encoder Worker** (`OffscreenCanvas` + `convertToBlob({ type: "image/webp", quality })`); the shown bitmap is never delayed: pass the encoder a `createImageBitmap(bitmap)` copy, transferred. If the returned blob type is not `image/webp`, disable storing for this browser session and say so in the status line (replays redraw).
  - `load(key)` -> `ImageBitmap` via `createImageBitmap(blob)`; prefetch into the playback window ahead of the playhead.
  - Completion: when every frame of a `bundleDigest x size` is saved, mark the scene `complete`; the film player then plays it **without creating its drawing Worker at all**, including after a page reload.
  - Resume: a partly saved scene draws only its missing frames.
  - Revisions: when a scene's `bundleDigest` changes (comment revision, re-bundle), delete the superseded digest's frames for that variant once the new revision exists.
  - Cap: 500 MB per site (constant), using `navigator.storage.estimate()` where available; evict whole films least recently used, never the open film.
- **What is shown:** a frame shown at the moment it is drawn is the freshly drawn bitmap (exact). A frame drawn ahead of playback is shown from the stored copy at the chosen quality (owner decision, top of this file). Replays and seeks show the stored copy. A complete scene "replays while stored".

### 3a. Background-work limits (apply to steps 3, 4 and 5)
- The encoder queue is **bounded** (for example 8 frames); when full, the drawing side waits rather than queueing more bitmaps.
- Every `ImageBitmap` you create or receive is `close()`d on every path (success, error, cancel, worker restart). A test counts opens against closes.
- All background work (encoding, quality job, draw-ahead) is **cancelled** when a scene's revision (`bundleDigest`) changes, when the quality setting changes (the old job stops, the new one starts) and when the player is destroyed.
- Priority: playback > drawing frames for playback > draw-ahead of future scenes > quality upgrades. Lower priorities yield while a higher one has work due.

### 4. Quality setting and the background quality job (plan change E)
- Setting: `Preview quality: Low / Standard / High` = 0.2 / 0.4 / 0.6 for **plate films only**, in the step-3 options bar (`OptionsBar`; follow the capability rules of plan section 22: show it only where the engine supports it). Default Standard. Remember it in `localStorage` (wrapped in try/catch).
- Changing it starts `QualityJob` (in `frame-store.ts` or its own module):
  - It never blocks playback, scrubbing or clicks: they always use whatever stored frame exists.
  - **Raise and lower both redraw** with the scene code (an idle `WorkerHost` for that scene, through the 3f measurement/draw queue so only one scene draws at a time) and save at the new quality. Never re-encode a stored lossy copy (detail would be lost twice). Each frame switches the moment it is saved.
  - Order: the frames just ahead of the playhead first, then outward from the playhead, then the rest of the film; a scrub or click re-centres the queue.
  - Playback always gets the CPU first: the job yields whenever a frame is due within the next tick and pauses while the film is `buffering`.
  - Progress is persisted (quality per frame in the store), so the job resumes after a reload. Status line: "Raising preview quality… 120 / 450 frames" / "Lowering…".

### 5. Background drawing ahead (plan change F)
- While the film is paused or the user is on step 3 without playing, draw and save undrawn frames of the current scene, then the following scenes in order, **one scene at a time** (reuse the 3f measurement queue; never two drawing Workers drawing at once except the active scene plus at most one next scene, as in 3f). Stop as soon as playback needs the CPU.

### 6. Tests and evidence (acceptance)
- **Unit (in-memory fake store):** keys; completion; resume from the first missing frame; revision deletion; LRU eviction never removes the open film; quality job ordering (ahead of the playhead first, re-centre on scrub), raise and lower = redraw path, cancellation on setting/revision change, bounded encoder queue, bitmap opens == closes, persistence and resume; buffering state machine (start rule, catch-up, resume threshold); sound-effect cue crossing (plays once when crossed while playing, never when jumped over by a seek, never while buffering).
- **Headless Chrome (extend `live-predraw-chrome.mjs` or add `live-playback-chrome.mjs`)** with the four crayon fixtures at 30 fps, using the real `IndexedDB` of the test browser:
  - first play: zero wrong frames; count the buffering pauses;
  - with a stub audio track per scene: every buffering pause pauses the audio within one frame; after every resume, the film time derived from the AudioContext schedule and the shown frame index are at most 33 ms apart, with no drift across 20 buffering pauses;
  - replay after a page reload: **zero** `WorkerHost.frame` calls for complete scenes, zero wrong frames, no buffering;
  - quality change 0.4 -> 0.6 during playback: no pause caused by the job, frames nearest the playhead upgraded first, job completes; 0.6 -> 0.2 completes by redrawing (it does call `WorkerHost.frame`) and never decodes-and-re-encodes a stored copy;
  - a changed `bundleDigest` for one scene: only that scene redraws;
  - stored bytes per frame at 0.2 / 0.4 / 0.6 within 20 % of 20 / 34 / 48 KB;
  - report every number.
- Keep all correctness assertions hard. Timing-sensitive "nice to have" assertions (for example head starts) may be diagnostics, hard only with an env flag, as in 3f; say which.
- `cd frontend && npm run typecheck && npm test`: all green except the known cold-start timeouts of the two Next-dev-server interaction tests, which must pass when run alone (say so explicitly with output).
- Plates screenshots: `node tools/phase3/capture.mjs <dir>` and `node tools/phase3/compare.mjs tools/phase3/baseline <dir> <diffdir>`. The new options-bar control and status texts will change some captures: **list every changed capture with why**; nothing else may change.

## Locks (shared with other tracks)
The Chrome tests (`live-predraw-chrome.mjs` / `live-playback-chrome.mjs`) and any timing measurement run ONLY while you hold `/Users/osamaehsaan/Code/Market_apps/.lock-timing` (create it containing `3g-argon <time>`; wait while it exists; delete it after, also on failure). The plates-e2e Docker stack needs `.lock-plates-e2e` the same way. The Chrome pre-draw tests, the replay/quality timing tests and any Docker plates-e2e use are timing-sensitive or exclusive. Before running them create `/Users/osamaehsaan/Code/Market_apps/.lock-timing` (or `.lock-plates-e2e` for the Docker stack, which you should not need) containing `3g-argon <time>`; if the file already exists, wait and retry every few minutes (do other work meanwhile); delete it when your run ends, also on failure. Unit tests that do not drive Chrome need no lock.

## Acceptance criteria (all measurable, reported with numbers)
1. `cd frontend && npm run typecheck` passes; `npm test` passes except the two cold-start Next-dev-server tests, each of which passes alone.
2. Headless Chrome, four crayon fixtures, 30 fps: 0 wrong frames; every buffering pause suspends the audio timeline within 1 frame; after resume the film time derived from the AudioContext schedule and the shown frame index are at most 33 ms apart after every resume, with no drift across 20 buffering pauses.
3. Replay after a page reload: 0 `WorkerHost.frame` calls for complete scenes; 0 buffering pauses.
4. Quality 0.4 -> 0.6 and 0.6 -> 0.2 during playback: 0 pauses caused by the job; nearest-playhead frames first; both complete; both redraw (no stored-copy re-encode anywhere: a grep in the report proves it).
5. A changed `bundleDigest` for one scene redraws only that scene and cancels its old background work.
6. Bytes per frame at 0.2/0.4/0.6 within 20 % of 20/34/48 KB.
7. Bitmap opens equal closes in the leak test; the encoder queue never exceeds its bound.
8. Start rule: a test with a slow fake scene shows the start threshold uses 1.25x the measured draw time.
9. Plates screenshots: only the listed deliberate changes; HyperFrames screenshots unchanged.

## Rules (hard limits)
- Allowed paths: `frontend/lib/live/`, `frontend/components/plate-live-stage.tsx`, `frontend/components/plate-preview.tsx`, `frontend/components/animation-workspace/` (options bar control, status texts, types), the plate-preview stylesheet, `frontend/test/`, `tools/phase3/`, `docs/phase3/3g-report.md`. **Not** `packages/`, `backend/`, `worker/`, `frontend/lib/api.ts` (unless a type export is unavoidable; then say why), `package.json` files or lockfiles.
- Do not change `runCheck`, the bundle/check/clip routes, the auth wrapper `withBackendAuth`, or HyperFrames behaviour.
- No Docker at all. No network except localhost servers you start on random free ports (never 3000, 4000, 4100, 8766, 55432, 58787, 59000). No staging, production, cloud or model APIs. Do not read `.env*`, `.env.credentials`, `infra/aws/.env*`, `*accessKeys*` or token files.
- Forbidden: `git commit`, `git push`, `git reset`, `git stash`, `git checkout` or branch changes, deploys, secrets, any other worktree, any secret or credential file, any resource held under a lock you do not hold. No new dependencies.
- Do not stop or interfere with other processes, agents or OpenCode sessions.

## Deliverable
`docs/phase3/3g-report.md`: files changed (line counts), the state machine and constants, the store schema, the quality-job ordering, every test added or changed and why, all measured numbers (buffering pauses, audio sync, replay draw counts, quality job timings, bytes per frame), screenshot comparison results with each deliberate change explained, known gaps. End your final message with exactly one line: `DONE docs/phase3/3g-report.md`.
