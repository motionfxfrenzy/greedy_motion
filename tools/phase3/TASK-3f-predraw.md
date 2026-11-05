# Task for the coding agent: phase 3f, pre-draw slow scenes in the browser instead of falling back to the MP4 clip

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

You work **only** in the worktree `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-predraw` (branch `codex/live-predraw`, based on `780d868`, which is what staging runs). Other agents work at the same time in `../VideoSaaS-live-scenes` and `../VideoSaaS-smoke`: never write there. Use absolute paths in every command.

## Why (what we measured on staging, 2026-11-05)
Live preview draws each plate scene in the browser (a Worker with `OffscreenCanvas`, `frontend/lib/live/`). On staging, a real film written by the real model in the crayon style ("Crayon story", look `illus-balloon`) **never played live**: every scene hit the buffering gate in `evaluatePlaybackGate` (`frontend/lib/live/plate-player.ts`), with reasons `gate-exceeded: lead 3.30s > ahead 2.23s`, `lead 5.22s > ahead 2.23s`, `lead 5.19s > ahead 2.23s`, `lead 4.92s > ahead 2.73s`. From the gate formula that is about **2 frames per second of drawing at 854x480** against 30 fps playback. So every scene switched to its MP4 clip, drawn on AWS, and a comment again costs a server render, which is what live preview exists to avoid.

The owner's decisions (do not reopen them):
1. **Never limit the model's drawing**: no drawing-time budget in authoring. Scenes may be heavy; the player must cope.
2. **Preview draws at low resolution by default.** The final render on AWS is unchanged (1920x1080, 30 fps).
3. **Pre-draw before playing:** when a scene cannot be drawn as fast as it plays, draw enough frames ahead first (show progress), then play, and **free each frame as soon as it has been shown** so memory stays flat.
4. **Fall back to the MP4 only when pre-drawing would take too long** (the scene itself is too heavy), or the Worker is unhealthy, or the browser is unverified/unsupported (unchanged).

## Read first
1. `docs/LIVE_SCENES_PLAN.md` sections 6 (cache, budget, rolling window), 7, 20 (live-first fallback), 21; `docs/HANDOFF_2026-11-05_LIVE_SCENES.md` sections 2 and 10.
2. `frontend/lib/live/plate-player.ts` (whole file: `previewSizeForAspect`, `evaluatePlaybackGate`, `PlatePlayer.mount`, `fillUntilGate`, `pumpScheduler`, `showFrame`, `createFilmPlayer`, scene-boundary recycle), `frame-cache.ts` (`computeRollingWindow`, `FrameCache`), `frame-scheduler.ts` (`advice()`, `next()`), `clock.ts`, `worker-host.ts` (watchdog 2 s, heartbeat, 60 s lifetime recycle, byte accounting), `support.ts` (`resolveCacheBudgetBytes`: 160 MB, 80 MB at `deviceMemory <= 4`, 60 MB on iOS), `live-stage-logic.ts` (`decideSceneMode`, rule 3d), `frontend/components/plate-live-stage.tsx` (stage, `forcedClipRef`, status/waiting UI, `AnimationPrep`).
3. Tests: `frontend/test/live-plate-player.mjs`, `live-scheduler.mjs`, `live-cache.mjs`, `live-stage-logic.mjs`, `live-stage-leak.mjs`, `live-chrome-integration.mjs` (how a real bundle is driven in headless Chrome via `playwright-core` and `/Applications/Google Chrome.app`).
4. **Real heavy scenes to measure against:** `frontend/test/fixtures/crayon-staging/scene{0..3}.html` (the exact bundles from staging; bundle HTML) with `scene{0..3}.json` (manifest, params, digest). Scene 0 has 90 frames, scenes 1 to 3 have 150, all 30 fps, 1920x1080 base. Load them into `WorkerHost` exactly as the stage does (`new WorkerHost({ html, params })`).

## What to build

### 1. Measure first (before changing behaviour)
Write `tools/phase3/predraw-bench.mjs`: headless Chrome (same launch as `live-chrome-integration.mjs`) drives each crayon fixture through `WorkerHost` and records the per-frame draw time (median, p90, max over at least 30 frames spread across the scene) at **854x480, 640x360 and 480x270** (16:9 scales of the 1920 base). Also record the GPU status of that Chrome (WebGL `UNMASKED_RENDERER_WEBGL` string, or "unavailable") so we know whether the numbers are software-rendered. Write the table to the report. Keep this script; the manager will rerun it.

### 2. Lower preview defaults
- Preview size: 16:9 **640x360**, 9:16 **360x640**, 1:1 **480x480** (from 854x480 / 480x854 / 640x640) in `previewSizeForAspect`. Keep the label fields consistent.
- Preview frame rate: **15 fps by default** for plates live preview: draw source frames `0, 2, 4, ...` and show each for two 30 fps ticks (the clock and audio stay at real time; the scene's frame index stays the engine's 30 fps index, so the final render and checks are unaffected). Put the step in one constant (`PREVIEW_FRAME_STEP = 2`) used everywhere frame indices are chosen, cached or scheduled. The browser **check** (`runCheck`, digest verification) must keep using the exact frames it uses today: do not change what is checked.
- If the bench (step 1) shows 480x270 is more than 1.5x faster than 640x360 on the crayon scenes, say so in the report with numbers; do not switch to it yourself.

### 3. Pre-draw instead of the immediate clip switch
Replace "lead > rolling window => clip" with a pre-draw mode:
- After the sample frames, compute the frames that must exist before playback can start without ever stalling: with draw rate `p` (frames per second, from the measured average) and the scene's preview frames `N` played at `r = 30 / PREVIEW_FRAME_STEP` per second, frames needed ahead `L = ceil(N * max(0, 1 - p / r))` (plus the existing 0.5 s cushion). Predicted wait `W = L / p` seconds.
- **Memory:** `L * bytesPerFrame` must fit the device byte budget (`resolveCacheBudgetBytes`). In pre-draw mode the window is all-ahead: keep **zero frames behind** the playhead except the frame on screen (scrubbing back simply redraws), and **close and evict every frame the moment the playhead has passed it**. If `L` does not fit the budget at the current size, that is a fallback reason (`predraw-over-budget`).
- **Time:** if `W > MAX_PREDRAW_SECONDS` (default **20**, one exported constant, also overridable by `NEXT_PUBLIC_PLATE_PREDRAW_MAX_S` read the same safe way `flag.ts` reads env), fall back to the clip with reason `predraw-too-slow: wait Ws > 20s`. Otherwise show the scene as **preparing** with a progress fraction (frames drawn / L) and start playback when `L` frames are ready.
- Keep re-measuring during pre-draw (the scheduler cost): if the updated `W` exceeds the limit by more than 25%, fall back then; never flip back and forth (once a variant+digest falls back in this page, it stays a clip: reuse `forcedClipRef`).
- **Pipeline across scenes:** while scene k plays, pre-draw scene k+1 with the spare budget (bytes not needed by scene k's remaining frames), so the next scene usually starts with no wait. A second Worker host for the next scene is allowed only one at a time (the handoff notes several full-size Workers at once can push Chromium off its GPU path; at 640x360 one extra is acceptable). Recycle rules stay: a Worker per scene, 60 s lifetime.
- Playback still never shows a wrong frame: if a frame is missing at its time (drawing fell behind anyway), hold the last frame and show the buffering state as today; do not skip ahead with a mismatched frame.

### 4. UI wording (plates step 3, `plate-live-stage.tsx` and its `StatusLine`/stage wait)
- While pre-drawing: stage text `Preparing this scene… 42%` (the scene tab shows `Preparing`), and the status line counts scenes ready as today.
- A scene that fell back shows exactly what clip fallback shows today; do not invent new states for the backend. No backend changes in this task.

### 5. Tests (acceptance criteria)
- Unit tests for the new decision function(s) (pure, no DOM): fast scene => live with the normal small lead; slow scene that fits => `predraw` with the right `L`, `W` and progress; too slow => clip with the `predraw-too-slow` reason; over budget => clip with `predraw-over-budget`; `PREVIEW_FRAME_STEP` mapping (frame indices, durations, last frame of odd-length scenes); eviction leaves at most the on-screen frame behind the playhead; no flip-flop once fallen back.
- Headless Chrome test with the **crayon fixtures**: at the new defaults, for each scene report whether it plays live, pre-draws (with measured wait), or falls back; for any scene that pre-draws, play it through and assert: zero wrong frames shown, no stall after playback starts, peak tracked bytes <= budget, every played frame closed (tracked bytes fall as it plays), and the next scene started pre-drawing while the current one played.
- All existing frontend tests stay green: `cd frontend && npm run typecheck && npm test` (173 at last count, plus yours). The two headless-Chrome interaction tests (`final-view-interaction.mjs`, `hf-step-interaction.mjs`) need a warm Next dev server and can time out on a cold first run; if they fail, rerun them alone once before reporting.
- Update every existing test whose expectation depended on 854x480 or 30 fps preview, and list each one with the reason in the report.

## Rules (hard limits)
- Write only under `frontend/lib/live/`, `frontend/components/plate-live-stage.tsx`, `frontend/components/plate-preview.tsx` (only if the stage needs a prop), `frontend/components/animation-workspace/` (only status/wording), `frontend/test/`, `tools/phase3/`, `docs/phase3/3f-report.md`. Nothing in `backend/`, `worker/`, `packages/`, `frontend/lib/api.ts`.
- **No Docker at all** (no compose, no build, no run): the compose project name is fixed, any `up` would replace containers another agent uses. Do not touch `videosaas-local-postgres-1` or `videosaas-local-worker-1`.
- No network except `localhost` servers you start yourself (pick random free ports; never 3000, 4000, 4100, 8766, 55432, 58787, 59000). No staging, production, cloud or model APIs. Do not read `.env*`, `.env.credentials`, `infra/aws/.env*`, `*accessKeys*` or any token file.
- No `git commit`, `push`, branch changes or deploys; no `package.json`/lockfile edits; no new dependencies.
- Do not stop or interfere with other processes (OpenCode sessions, other agents' servers).

## Deliverable
`docs/phase3/3f-report.md` with: the bench table (all scenes x 3 sizes, median/p90/max ms, GPU string) and what it implies; what you built (files, line counts); the decision rules with the exact constants; per crayon scene at the new defaults: live / pre-draw (L, W) / clip and why; test results before and after (counts, the Chrome test's numbers: waits, peak bytes, stalls); every test you changed and why; known gaps and anything you could not do. End your final message with exactly one line: `DONE docs/phase3/3f-report.md`.
