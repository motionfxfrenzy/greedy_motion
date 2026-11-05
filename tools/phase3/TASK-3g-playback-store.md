# Task for the coding agent: phase 3g, smooth 30 fps playback of code-drawn plate scenes, video-style buffering with sound in step, draw-once frame storage, quality setting with a background job, background drawing

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

**Worktree:** `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw` (branch `codex/live-predraw`, HEAD `23e1963` plus the plan documents; this is what staging runs). Dependencies are installed. Do not work in `../VideoSaaS-live-scenes` (your phase 4a work waits there for the manager's review and commit; leave it untouched) or in `../VideoSaaS-engine` (another agent is changing the plate engine there).

## Why
Read **`docs/LIVE_PLAYBACK_PLAN.md`** in full first: it is the design you are implementing (changes B, C, D, E and F; change A, the engine speed-up, is being done separately and you must not touch `packages/`). Then `docs/LIVE_SCENES_PLAN.md` sections 6, 20, 22 and 26, and `docs/phase3/3f-report.md` (phase 3f and its follow-up: pre-draw, the measurement queue, lazy decisions, `FallbackLatch`; you build on that code).

In one paragraph: plate scenes are drawn by their code in the user's browser (a Worker per scene, `frontend/lib/live/worker-host.ts`). Drawing can be slow (3 to 30 fps); the owner accepts waiting for drawing but requires **smooth 30 fps playback with voice, music and sound effects in step**, **no fallback to the server MP4 for slowness**, and **draw once**: every drawn frame is saved in the browser as lossy WebP so a scene replays without running its code again. Stored quality is **0.4 by default**, user-selectable **Low 0.2 / Standard 0.4 / High 0.6**, and changing it runs as a **background job** that never blocks playback.

## Read first (code)
1. `frontend/lib/live/predraw.ts` (`PREVIEW_FRAME_STEP`, `decidePredraw`, `FallbackLatch`, constants), `plate-player.ts` (whole file: `PlatePlayer`, `mount`, `fillUntilGate`, `pumpScheduler`, `showFrame`, `activeDrawWork`, the measurement queue, `createFilmPlayer`, lazy next-scene decisions), `frame-cache.ts`, `frame-scheduler.ts`, `clock.ts` (`PlaybackClock`), `worker-host.ts` (watchdog, heartbeat, recycle, byte accounting), `support.ts` (`resolveCacheBudgetBytes`, environment status), `live-stage-logic.ts` (`decideSceneMode` and its reasons), `api.ts`, `index.ts`, `types.ts`.
2. `frontend/components/plate-live-stage.tsx` (the stage: bundles, checks, clip requests, `forcedClipRef`, `LIVE_API`, status, waits) and `frontend/components/plate-preview.tsx` (the plates step-3 page: **all audio today**: per-scene voice `HTMLAudioElement`s, music, `playSceneSfx` with `setTimeout`s, the `requestAnimationFrame` tick, `wantPlay`, scene seeking), `frontend/components/animation-workspace/` (`OptionsBar`, `ControlRow`, `StatusLine`, `types.ts`, `logic.ts`), and `frontend/components/plate-preview.css` or wherever its styles live.
3. Tests: `frontend/test/live-predraw.mjs`, `live-predraw-chrome.mjs` (headless Chrome with the four crayon fixtures in `frontend/test/fixtures/crayon-staging/`), `live-plate-player.mjs`, `live-stage-logic.mjs`, `live-stage-leak.mjs`, `live-scheduler.mjs`, `live-cache.mjs`, `live-chrome-integration.mjs`, `plate-preview`-related tests, and `tools/phase3/capture.mjs` + `compare.mjs` (the 68 plates screenshots).

## What to build (in this order; commit nothing)

### 1. 30 fps (plan change B)
- Set `PREVIEW_FRAME_STEP = 1`. Update comments and tests that assumed 2 (list each one in the report). `runCheck` must stay exactly as it is.

### 2. Video-style buffering and one clock (plan change C)
- **Player states** per scene and for the film: `drawing` (no frame ready yet), `ready`, `playing`, `buffering`, `clip` (only `unverified-environment`, `unsupported-environment`, `worker-unhealthy`, bundle-load failure). Remove the `predraw-too-slow` and `predraw-over-budget` clip reasons and their fallback paths (keep the measurement queue, lazy decisions and `FallbackLatch` for the remaining reasons). `decidePredraw` keeps computing the lead `L` from the draw rate; it no longer decides `clip` for slowness.
- **Start rule:** playback starts when `max(30 frames, L)` frames are ready ahead (from memory or the store, step 3). **Window:** keep up to about 90 frames (3 s) decoded ahead within `resolveCacheBudgetBytes`; close each frame's bitmap once shown.
- **Catch-up:** if the frame due is not ready, enter `buffering`: hold the last frame, show "Buffering…" on the stage, pause the clock; resume when `min(30, frames left in scene)` frames are ready again. Never show a frame other than the one due.
- **One clock:** make `PlaybackClock` (or a small film clock built on it) the single source of time for the picture **and** the audio in `plate-preview.tsx`. When the stage reports `buffering`, pause voice, music and sound effects at the same instant; on resume, set each audio element's `currentTime` from the clock and play them together. Replace `setTimeout` sound-effect scheduling with cue crossings checked on each clock tick (a cue fires when the clock passes its time while playing; seeking never fires cues it jumps over). Scrubbing and scene clicks move the clock; audio follows. Keep every existing audio feature (voice, music, SFX and transition toggles, scene-relative voice takes).
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
- **First play shows the freshly drawn bitmap** (exact); replays and seeks to saved frames show the stored copy.

### 4. Quality setting and the background quality job (plan change E)
- Setting: `Preview quality: Low / Standard / High` = 0.2 / 0.4 / 0.6 for **plate films only**, in the step-3 options bar (`OptionsBar`; follow the capability rules of plan section 22: show it only where the engine supports it). Default Standard. Remember it in `localStorage` (wrapped in try/catch).
- Changing it starts `QualityJob` (in `frame-store.ts` or its own module):
  - It never blocks playback, scrubbing or clicks: they always use whatever stored frame exists.
  - **Raise:** redraw frames with the scene code (an idle `WorkerHost` for that scene, through the 3f measurement/draw queue so only one scene draws at a time) and save at the new quality. **Lower:** load the stored copy, re-encode at the lower quality, save. Each frame switches the moment it is saved.
  - Order: the frames just ahead of the playhead first, then outward from the playhead, then the rest of the film; a scrub or click re-centres the queue.
  - Playback always gets the CPU first: the job yields whenever a frame is due within the next tick and pauses while the film is `buffering`.
  - Progress is persisted (quality per frame in the store), so the job resumes after a reload. Status line: "Raising preview quality… 120 / 450 frames" / "Lowering…".

### 5. Background drawing ahead (plan change F)
- While the film is paused or the user is on step 3 without playing, draw and save undrawn frames of the current scene, then the following scenes in order, **one scene at a time** (reuse the 3f measurement queue; never two drawing Workers drawing at once except the active scene plus at most one next scene, as in 3f). Stop as soon as playback needs the CPU.

### 6. Tests and evidence (acceptance)
- **Unit (in-memory fake store):** keys; completion; resume from the first missing frame; revision deletion; LRU eviction never removes the open film; quality job ordering (ahead of the playhead first, re-centre on scrub), raise = redraw path, lower = re-encode path, persistence and resume; buffering state machine (start rule, catch-up, resume threshold); sound-effect cue crossing (plays once when crossed while playing, never when jumped over by a seek, never while buffering).
- **Headless Chrome (extend `live-predraw-chrome.mjs` or add `live-playback-chrome.mjs`)** with the four crayon fixtures at 30 fps, using the real `IndexedDB` of the test browser:
  - first play: zero wrong frames; count the buffering pauses;
  - with a stub audio track per scene: every buffering pause pauses the audio within one frame; after resume, picture time and audio `currentTime` differ by at most one frame (33 ms);
  - replay after a page reload: **zero** `WorkerHost.frame` calls for complete scenes, zero wrong frames, no buffering;
  - quality change 0.4 -> 0.6 during playback: no pause caused by the job, frames nearest the playhead upgraded first, job completes; 0.6 -> 0.2 completes without any `WorkerHost.frame` call;
  - a changed `bundleDigest` for one scene: only that scene redraws;
  - stored bytes per frame at 0.2 / 0.4 / 0.6 within 20 % of 20 / 34 / 48 KB;
  - report every number.
- Keep all correctness assertions hard. Timing-sensitive "nice to have" assertions (for example head starts) may be diagnostics, hard only with an env flag, as in 3f; say which.
- `cd frontend && npm run typecheck && npm test`: all green except the known cold-start timeouts of the two Next-dev-server interaction tests, which must pass when run alone (say so explicitly with output).
- Plates screenshots: `node tools/phase3/capture.mjs <dir>` and `node tools/phase3/compare.mjs tools/phase3/baseline <dir> <diffdir>`. The new options-bar control and status texts will change some captures: **list every changed capture with why**; nothing else may change.

## Rules (hard limits)
- Allowed paths: `frontend/lib/live/`, `frontend/components/plate-live-stage.tsx`, `frontend/components/plate-preview.tsx`, `frontend/components/animation-workspace/` (options bar control, status texts, types), the plate-preview stylesheet, `frontend/test/`, `tools/phase3/`, `docs/phase3/3g-report.md`. **Not** `packages/`, `backend/`, `worker/`, `frontend/lib/api.ts` (unless a type export is unavoidable; then say why), `package.json` files or lockfiles.
- Do not change `runCheck`, the bundle/check/clip routes, the auth wrapper `withBackendAuth`, or HyperFrames behaviour.
- No Docker at all. No network except localhost servers you start on random free ports (never 3000, 4000, 4100, 8766, 55432, 58787, 59000). No staging, production, cloud or model APIs. Do not read `.env*`, `.env.credentials`, `infra/aws/.env*`, `*accessKeys*` or token files.
- No `git commit`, `push`, branch changes or deploys; no new dependencies.
- Do not stop or interfere with other processes, agents or OpenCode sessions.

## Deliverable
`docs/phase3/3g-report.md`: files changed (line counts), the state machine and constants, the store schema, the quality-job ordering, every test added or changed and why, all measured numbers (buffering pauses, audio sync, replay draw counts, quality job timings, bytes per frame), screenshot comparison results with each deliberate change explained, known gaps. End your final message with exactly one line: `DONE docs/phase3/3g-report.md`.
