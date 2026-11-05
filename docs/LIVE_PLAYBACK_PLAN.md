# Live playback plan: draw once, play smooth (2026-11-05)

Owner of the decisions: the product owner, in the manager session of 2026-11-05. Referenced from `docs/LIVE_SCENES_PLAN.md` section 26. Visual comparison and summary page: https://claude.ai/code/artifact/ad1ba183-94e8-4c4d-8b9d-31f292bc2ea8

This plan covers how a plate film's **code-drawn frames** play in the user's browser at step 3 (Animation). It does not change the final render (the AWS worker still runs the scene code itself at 1920x1080, 30 fps, from the frozen manifest of phase 5), HyperFrames films, or the MP4 clips except where they stop being a fallback for slowness.

---

## 1. The owner's rules (final)

1. The scene code draws every frame **on the user's computer**. Nothing in this plan renders on a server.
2. The user may **wait while a scene draws**; drawing can be slower than real time (3 to 10 fps is acceptable). Faster is better.
3. **Playback must be smooth at 30 fps**, with voiceover, music and sound effects in step with the picture, like a video.
4. **Draw once.** When a scene has been drawn, it replays, loops and seeks without running its code again.
5. **Quality must not drop because of speed work.** The model's drawing is never restricted (no drawing-time budget in authoring).
6. Stored copies of drawn frames are **lossy WebP at quality 0.4 by default**; the user can choose **Low 0.2 / Standard 0.4 / High 0.6**. **Decided by the owner on 2026-11-05 ("Yes, 0.4 is fine"):** a frame shown at the moment it is drawn is exact; a frame drawn ahead of playback is shown from the stored copy at the chosen quality (0.4 by default), and it replays while stored. There is no lossless temporary storage and no setting for this. The final render is not affected.
7. Changing the quality setting runs **in the background** on the user's computer: playback and scrubbing never wait for it.
8. The server MP4 clip is used **only** for browsers that cannot run the live player (unverified or unsupported) or a drawing worker that keeps crashing. Never for slowness.

## 2. What we measured (why this plan)

All numbers: Chrome on an M1 Pro, the four scenes of the staging crayon film (`frontend/test/fixtures/crayon-staging/`, look `illus-balloon`), 640x360 unless stated. Scripts in the manager's scratchpad (`draw-diag.mjs`, `memo-diag.mjs`, `inside-diag.mjs`, `store-diag.mjs`, `webp-fidelity.mjs`, `quality-cost.mjs`).

| Fact | Number |
| --- | --- |
| Code drawing time per frame, scenes 1 to 4 | 148, 268, 186, 35 ms (6.8, 3.7, 5.4, 28.6 fps) |
| Same bundle on the page's main thread vs our Worker | equal (149 vs 152, 279 vs 297, 195 vs 189, 38 vs 37 ms) |
| Resolution 854x480 vs 640x360 vs 480x270 | no change (cost is not pixels) |
| Share of frame time in the engine's crayon fill (`hatchRuns` -> `inside`) | 83 to 90 % |
| Canvas painting (stroke, lineTo, drawImage) | under 2 % |
| Fill calls per frame / share that repeat between frames | about 70 / 3 to 18 % (caching whole fills does not help) |
| With an exact indexed `inside` (measurement patch) | 28.5, 43.9, 39.9, 18.7 ms per frame; byte-identical frames at 640x360 and 1920x1080 |
| Showing an already drawn frame on screen | 0.07 ms |
| One raw frame in memory | 900 KB (15 s film: 396 MB) |
| Stored WebP 0.2 / 0.4 / 0.6 per frame | 20 / 34 / 48 KB; save 19 / 22 / 24 ms; load 2.4 / 3.0 / 3.6 ms; PSNR 25.0 / 26.1 / 27.0 dB |
| 15 s film at 30 fps stored at 0.2 / 0.4 / 0.6 | 9 / 15 / 21 MB (60 s: 36 / 60 / 84 MB) |

Why the user's local scenes are fast: the hand-written `canvas-core/balloon.ts` computes each scribble fill once per call site and keeps it (`env.cache`), and its shapes stay still. The crayon style has no `*Kit.ts`, so the model writes its own fill helper per scene, mostly without that cache, and its shapes move or redraw every frame. The work is real; it has to get cheaper (change A).

## 3. The changes

### A. Faster engine, identical pictures (being built by a Sonnet agent)
- **Where:** `packages/plate-engine/src/canvas-core/gallery.ts` `inside()` and every other copy of the even-odd point-in-polygon test in the engine. Branch `codex/engine-inside`, worktree `../VideoSaaS-engine`, brief `tools/phase3/TASK-engine-inside.md` there.
- **What:** per outline array (module `WeakMap`, keyed like `adaptPts` already is): bounding box and edges bucketed by height, built once. A query outside the box returns `false` (the old loop's answer there); inside, only the edges of the point's height bucket are tested with the **identical comparison and arithmetic**. Guard: length and end vertices on every query, and a full-content check of each outline once per frame (`ringNewFrame` in `renderFrame`); a mismatch rebuilds the index.
- **Quality:** none changes. Proofs required: engine golden hashes unchanged; 200,000 random points over 300 random outlines give the old answer; frame fingerprints of every style identical at 640x360 and 1920x1080; an in-place outline edit test.
- **Effect:** 5 to 6x faster drawing for crayon scenes (all four then draw at 23 to 53 fps), and the same speed-up for the AWS final render.
- **Rollout (needs a backend brief after A lands):** every bundle embeds its engine, so existing scenes must be **re-bundled from their saved source with no model call** (new `engineDigest` and `bundleDigest`); their cached clips are redrawn once on next use. The engine agent reports the exact re-bundle path; the manager writes that brief.

### B. Play at 30 fps
- `PREVIEW_FRAME_STEP` in `frontend/lib/live/predraw.ts` goes from 2 to 1 (show every frame). Everything that maps preview indices to source frames already goes through that constant (phase 3f).
- The browser check (`runCheck`) is unchanged.

### C. Buffer like a video, with sound in step
- **Start:** play when a small buffer is ready: the larger of about 1 s of frames and the lead the scene's draw rate needs (`decidePredraw`'s `L`, computed from the frames still to be prepared and the measured rate with frames waiting on disk), **planned with a 1.25x safety margin on the measured draw time and re-measured as drawing continues**, so slow scenes rarely pause. Two different stores are never mixed in wording or code: the **decoded memory window** (ImageBitmaps, byte-budgeted) and the **frames prepared on disk** (IndexedDB).
- **Window:** keep about 2 to 3 s of frames ready ahead of the playhead (decoded `ImageBitmap`s within the byte budget of `resolveCacheBudgetBytes`); free each frame once shown (the stored copy remains, change D).
- **Catch-up:** if playback reaches the last ready frame, show **Buffering...** and pause; resume when the buffer is back. Never show a wrong frame.
- **No time limit:** remove the `predraw-too-slow` and `predraw-over-budget` fallbacks (over-budget no longer applies: frames ahead can wait on disk). Keep the MP4 only for `unverified-environment`, `unsupported-environment` and `worker-unhealthy` (and the bundle-load failure path from `780d868`).
- **One clock for everything:** `frontend/lib/live/clock.ts` (`PlaybackClock`) drives the picture **and** voiceover, music and sound effects in `frontend/components/plate-preview.tsx`. Audio runs on **one Web Audio timeline** (`AudioContext.currentTime` is the master time; voice, music and effects are `AudioBufferSourceNode`s scheduled against it), not several `<audio>` elements. Buffering suspends the timeline for all of them at the same instant and resumes them together. Sound effects are scheduled from the clock (cue crossings), never from fire-and-forget `setTimeout`s. Scrubbing moves the clock; audio is rescheduled from it. Required test cases: seek into the middle of an active sound effect, backward seek, loop, scene boundary, repeated buffering, hidden tab, device sleep/resume.

### D. Draw once, replay forever (stored frames)
- **When:** each frame is saved **the moment the code draws it**, not at the end of the scene. A partly drawn scene resumes from its first missing frame.
- **What is shown:** a frame shown at the moment it is drawn is the freshly drawn bitmap (exact); a frame drawn ahead is shown from the stored copy at the chosen quality (owner decision 2026-11-05). The saver gets a copy (`createImageBitmap(bitmap)`, transferred) so the shown frame is never delayed.
- **Saver:** a dedicated encoder Worker: `OffscreenCanvas.convertToBlob({ type: "image/webp", quality })`. If the browser returns a type other than `image/webp`, storing is disabled for that browser (the scene redraws on replay) and the status says so.
- **Where:** IndexedDB database `gm-live-frames` on the user's disk. Keys: `bundleDigest | width x height | quality | frame`. A scene record per `bundleDigest x size`: frames saved, quality per frame, `complete`, bytes, last used. Only the 2 to 3 s playback window lives in memory.
- **Complete scene ("replays while stored"; browsers can evict storage, then the scene draws again):** when every frame of a revision is saved, playback, loop and seek load stored frames (decode 2.4 to 3.6 ms) and never call the scene code; the scene's drawing Worker is not created at all.
- **New revision:** a comment produces a new `bundleDigest`; that scene draws again and its superseded frames are deleted. Other scenes keep theirs.
- **Cap:** about 500 MB per site (check `navigator.storage.estimate()`), least recently used films cleared first, never the open film. If the browser refuses space, the scene simply redraws on replay.

### E. Quality setting and the background quality job
- **Setting:** Low 0.2 / Standard 0.4 (default) / High 0.6 in the step-3 options bar for plate films (the shared workspace shows extras only where the engine supports them, plan section 22). Remembered per user in the browser.
- **Changing it starts a background job on the user's computer:**
  - Playback, scrubbing and clicking keep using whatever stored frames exist, immediately.
  - Raising **and lowering** quality: the job **redraws** frames with the scene code in a Worker and saves them at the new quality (re-encoding a lossy copy would lose detail twice, and detail lost to compression cannot be recovered).
  - Background limits: the encoder queue is bounded; every ImageBitmap is closed on all paths (success, error, cancel); work is cancelled when a revision or the setting changes; priority is playback > drawing for playback > future scenes > quality upgrades.
  - Order: frames just ahead of the playhead first, then outward, then the rest of the film. A scrub or click moves the job's focus there.
  - Each frame switches to the new quality the moment it is ready.
  - Playback always gets the CPU first: the job yields while a frame is due, and slows down on a busy machine rather than making playback stutter.
  - Progress is stored per frame, so the job resumes after a reload.
  - The status line shows it (for example "Raising preview quality... 120 / 450 frames").

### F. Draw ahead in the background
- While the user is paused, reading, or watching one scene, the next undrawn scenes keep drawing and saving, **one at a time** (the 3f measurement queue still applies), so most of the film is ready before they press play.

## 4. Order of work and owners

| Step | Change | Owner | Where | Depends on |
| --- | --- | --- | --- | --- |
| 1 | A engine fix | Sonnet subagent (running) | `../VideoSaaS-engine`, `codex/engine-inside` | none |
| 2 | B, C, D, E, F (phase 3g) | Argon (OpenCode, `google/gemini-4-argon`) | `../VideoSaaS-predraw`, `codex/live-predraw` | none (files do not overlap with A) |
| 3 | Re-bundle existing scenes with the new engine | manager brief after A | backend + worker | A |
| 4 | Merge A into the playback line, deploy staging, time the crayon film | manager | clean worktree | 1, 2, 3 |
| 5 | Integrate with the `codex/live-scenes` line (phase 4a HyperFrames edits) before production | manager | merge worktree | 4, 4a committed |

## 5. How each step is accepted

- **A:** golden hashes, random-point identity, per-style fingerprints at two sizes, mutation test, speed table; the manager re-runs all of them.
- **B to F (headless Chrome with the four crayon fixtures, 30 fps):** zero wrong frames; every buffering pause matched by a pause of voice, music and sound effects, and picture and voice within one frame of each other after resume; a replay after page reload makes **zero** calls to the scene code (`WorkerHost.frame` count 0) for complete scenes; a quality change from 0.4 to 0.6 starts no wait, upgrades frames nearest the playhead first, and finishes; a comment revision redraws only its scene; storage bytes match the table in section 2 within 20 %; the cap evicts the oldest film first.
- **All suites:** frontend typecheck and tests, backend tests (only the 5 known failures), plates screenshots 68/68 identical (the stage UI changes must be deliberate and listed), HyperFrames screenshots unchanged.
- **Staging:** the crayon film in Chrome: time to first play, buffering pauses, replay after reload with no drawing.

## 6. Risks and open points

- Only desktop Chromium is verified for the live player; Safari, Firefox and phones get the MP4 until the device report is run on them (`tools/spike-phase0/harness.html`).
- Some browsers may not encode WebP from `OffscreenCanvas`; storing is then disabled there (replays redraw).
- Change A assumes scene code does not edit an outline array in place after drawing with it (the engine already assumes this in `adaptPts`); each outline's full contents are verified once per frame (at `renderFrame`), so an edit between frames is seen; an edit within one frame is unsupported and caught by the determinism check.
- Storage quotas vary by browser; eviction must never remove the film being watched.
- The plates step-3 page (`plate-preview.tsx`) owns audio today; moving audio onto the stage clock touches HyperFrames-shared components only through the shared workspace props; HyperFrames playback is out of scope.
