# Phase 3f report: pre-draw slow scenes in the browser

Worktree `VideoSaaS-predraw`, branch `codex/live-predraw` (nothing committed). No backend, worker, package or Docker changes.

## 1. Bench (measured before any behaviour change)

`node tools/phase3/predraw-bench.mjs [--frames 40] [--json out.json]`. Headless Chrome 156 through `WorkerHost`, 40 frames spread across each scene.
GPU string: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)` (hardware WebGL available on this machine; the Worker's 2D canvas path may still be CPU).
Per-frame wall time in ms (median / p90 / max); worker-side `drawMs` is within 1 ms of it. Raw numbers: `tools/phase3/3f-bench.json`.

| scene (frames) | 854x480 | 640x360 | 480x270 |
|---|---|---|---|
| 0 (90) | 150.5 / 161.6 / 621.8 | 154.9 / 189.3 / 363.3 | 149.1 / 154.2 / 251.7 |
| 1 (150) | 273.0 / 298.2 / 435.4 | 270.4 / 281.2 / 303.6 | 270.2 / 278.8 / 315.4 |
| 2 (150) | 190.4 / 196.8 / 303.1 | 190.0 / 211.5 / 589.3 | 187.3 / 194.2 / 250.1 |
| 3 (150) | 35.7 / 37.8 / 178.5 | 35.8 / 37.6 / 174.1 | 36.9 / 40.2 / 159.0 |

Implications:
- **Draw time does not depend on resolution.** 480x270 is 1.00x the speed of 640x360 on every crayon scene (not the 1.5x that would trigger a recommendation). The cost is a fixed per-frame cost in the scene code, so lowering the size alone would not have fixed staging; the 15 fps step (half the frames) and pre-draw are what make these scenes playable. I did not switch to 480x270.
- At 30 fps playback scenes 0-2 draw at 3.7-6.5 fps (the staging "about 2 fps" was a slower machine/GPU path); scene 3 draws at about 25 fps.

## 2. What was built

Files (lines): `frontend/lib/live/predraw.ts` (new, 198), `plate-player.ts` (rewritten PlatePlayer, +film pipeline; 1245 total), `frame-cache.ts` (`release`, `sceneBytes`, `frameIndices`), `frame-scheduler.ts` (`strictAhead`), `types.ts` (PlayerDecision gets `variant`, `progress`, `neededFrames`, `waitSeconds`), `live-stage-logic.ts` (preparing resolution), `components/plate-live-stage.tsx` (progress passthrough, clock gated while preparing), `index.ts` (export). Bench `tools/phase3/predraw-bench.mjs` (108). Tests: `test/live-predraw.mjs` (332), `test/live-predraw-chrome.mjs` (171).

Cache, scheduler and buffering work in **preview indices** (index i = engine source frame i*`PREVIEW_FRAME_STEP`); only `WorkerHost.frame()` and the public `showFrame/ready/buffered` use the engine's 30 fps indices. `runCheck` is untouched (still frames 0, floor(n/2), n-1).

## 3. Decision rules and constants

- `PREVIEW_FRAME_STEP = 2` (predraw.ts, used for indices, cache, scheduler, rate). Preview sizes: 640x360, 360x640, 480x480. Final render unchanged.
- `p` = 1000 / median of the first 3 draws (re-measured from the scheduler average after 3 scheduler draws); `r = 30/2 = 15`; `N` = preview frames to play.
- `p >= r` -> **live** (lead = cushion, `ceil(0.5 * r) = 8` frames; existing rolling window kept).
- else `L = min(N, ceil(N * (1 - p/r)) + 8)`, `W = L / p`.
  - `L * bytesPerFrame > resolveCacheBudgetBytes()` -> clip `predraw-over-budget: need ...`.
  - `W > MAX_PREDRAW_SECONDS` (**20**, `NEXT_PUBLIC_PLATE_PREDRAW_MAX_S` override, read like flag.ts) -> clip `predraw-too-slow: wait Ws > 20s`.
  - else **predraw**: stage shows `Preparing this scene… N%`, tab `Preparing`, clock starts when `L` frames are ready.
- During pre-draw: re-assessed after each draw; `elapsed + (L - ready)/p > 20 * 1.25` -> clip. A clip is terminal for that player (stage `forcedClipRef` keeps it per variant+gen+digest): no flip-flop.
- Pre-draw window is all-ahead: scheduler `strictAhead`, `lookahead = min(remaining, L, room)`. Every frame behind the on-screen one is closed and evicted when the frame is shown; on leaving a pre-drawn scene all its frames are dropped. Seeks (back, or more than 8 preview frames ahead) and a 1.5 s hold on a missing frame rebuild the lead from the new position (and may fall back). A missing frame at its time holds the last frame and shows Buffering as before.
- Pipeline: while scene k plays (or plays as its clip) and is not itself preparing, scene k+1 `prefetch()`es with `budget - reserved(k) - 2 frames`; one extra scene at a time. Scene change calls `deactivate()` (pause scheduler, free pre-draw frames) then the existing recycle.
- Stage: preparing scenes stay `isPlayable` (so the parent can advance into them and toggle play), but the clock/audio effect only runs once `isPreparing` is false. Fallback scenes look exactly as today.

## 4. Crayon scenes at the new defaults (real Chrome, `live-predraw-chrome.mjs`)

Budget 160 MB (167,772,160 B), 640x360 = 921,600 B/frame.

| scene | draw fps | decision | L | predicted W | measured wait |
|---|---|---|---|---|---|
| 0 (90f) | 4.9 | pre-draw | 39 | 8.0 s | 5.4 s |
| 1 (150f) | 3.6 | pre-draw | 65 | 18.0 s | 14.2 s |
| 2 (150f) | 5.1 | pre-draw | 58 | 11.4 s | 5.6 s (28 frames already drawn during scene 1) |
| 3 (150f) | 26.6 | live | 8 | 0.3 s | none |

Play-through of all four scenes (18 s of film): wrong frames 0, stalls 0, peak tracked bytes (cache and host) 69,120,000 B = 75 frames, well under 167,772,160; every frame closed when a pre-drawn scene is left (0 open); 0 open after destroy; next scene had frames before it started (13 / 28 / 8 frames ahead). Scene 1 at 18 s predicted is close to the 20 s limit: a slower machine will send it to its clip. Numbers: `tools/phase3/3f-chrome-run.json` (written by the test).

## 5. Tests

Frontend before: 173 (last count in brief). After: **189** = 173 + 14 (`live-predraw.mjs`) + 1 (`live-predraw-chrome.mjs`) + 1 (preparing resolution in `live-stage-logic.mjs`). `npm run typecheck` clean. `npm test`: 188 pass on the first run; `final-view-interaction.mjs` failed cold (timeout), passed rerun alone; so 189/189.

Changed existing tests (`live-plate-player.mjs`):
- preview labels now 640x360 / 360x640 / 480x480 (new defaults);
- heavy-scene gate case: 65 ms/frame is now 15.4 fps = live at the 15 fps preview, so it uses 250 ms/frame and expects `predraw-too-slow`;
- showFrame/seek case: source frame 75 is held on preview frame 74 (drawn bitmap `frameIndex` 74, not 75);
- cache-key tests: label strings 854x480 -> 640x360 (cosmetic).
`live-chrome-integration.mjs` uses its own 854 scale directly with WorkerHost: unchanged and passing.

## 6. Known gaps / open questions

- Resolution does not speed these scenes (see bench); the cost is in the scene code. Worth a look at where the fixed per-frame time goes (not in my allowed paths).
- All scene Workers are still spawned at film mount (as before) to measure each scene up front; only the active and next scene draw. Not reduced to one extra Worker; idle Workers remain.
- Pre-draw measurement sets W from sample draws made while other scenes mount; real waits were lower than predicted on all three scenes.
- Pipelining gives only partial head start (scene 0 -> 1: 13 of 65 frames) because the two Workers share the CPU.
- On re-prepare after a stall/seek the audio keeps playing while the stage clock is held; it resyncs from the clock when drawing resumes.
- The `evaluatePlaybackGate` function is kept exported but no longer used by the player.
- Not verified in the real stage UI (no browser session of the Next app); stage wording is covered by the `decideSceneMode` unit test only.

## Manager verification (2026-11-05)
- Footprint: only allowed paths changed (frontend/lib/live, plate-live-stage.tsx, frontend/test, tools/phase3, docs/phase3); nothing committed by the agent.
- Read `frontend/lib/live/predraw.ts` in full: pure decision module, one source for PREVIEW_FRAME_STEP, MAX_PREDRAW_SECONDS (20, env override), 25% re-assessment tolerance, terminal fallback latch. `runCheck` untouched.
- Typecheck clean. Full frontend suite 189 tests: all pass; the two headless-Chrome interaction tests that need a warm Next dev server (`final-view-interaction.mjs`) time out on a cold parallel run and pass alone (pre-existing).
- Re-ran the crayon Chrome play-through myself: scene 0 pre-draw L=33 W=4.9 s, scene 1 L=65 W=17.6 s, scene 2 L=57 W=10.9 s, scene 3 live (27 fps); 0 wrong frames, 0 stalls, bytes within budget, frames closed.
- Changed by the manager: the "next scene started pre-drawing" assertion in `live-predraw-chrome.mjs` failed inside the full parallel suite (a dozen headless Chromes, no spare CPU for the head start; correctness assertions all held). It is now a diagnostic, hard only with `PREDRAW_STRICT=1`; strict mode passes when the file runs alone.
- Finding for a follow-up: draw time is independent of resolution (150 ms at 854x480, 149 ms at 480x270 for scene 0), so the cost is fixed per-frame work in the scene/engine code (likely texture and stroke regeneration each frame), not pixels. Caching static layers in the plate engine is the next lever.
- Risk: scene 1 predicts 17.6 s against the 20 s limit on an M1 Pro; slower machines will send scenes like it to the clip.
