# Task for the coding agent: finish the phase 0 feasibility checks

You are working for a manager (Claude) who reviews your output. Read this whole file first. Do exactly what it says, no more.

## Context

Repository worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` (branch `codex/live-scenes`). Read `docs/LIVE_SCENES_PLAN.md`, sections 0b, 9, 10 and 14, before you start. Summary: the product wants to draw model-written canvas scenes ("plates") live in the user's browser inside a Worker on an `OffscreenCanvas`, and to render the final MP4 on a CPU-only AWS worker (Chromium with software GL). Phase 0 is a feasibility spike. A harness already exists in `tools/spike-phase0/`:

- `build.mjs` bundles 9 real scenes into `<out>/*.html` and renders CPU-export reference PNGs with `packages/plate-engine/lib/capture.mjs` (`openScene`).
- `build-params.mjs` builds one scene that reads `__PARAMS__`.
- `server.mjs` serves a scratch directory plus the harness on `127.0.0.1:8766` (localhost only; never bind another interface).
- `harness.html` / `harness.js` runs scenes in a Worker host and exposes `window.phase0.*` (speed, identity, paramEdit, containment, hang, leak, ...).
- `run.mjs` drives it with headless Google Chrome via `playwright-core` (`node run.mjs <step>`).
- Generated bundles and reference PNGs live in `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/phase0/` (call it `$P0`). Scene sources are in `/Users/osamaehsaan/Code/Market_apps/VideoSaaS/var/plates/<project>/scene-N.ts`.

Results so far: Worker preview matched the export frames exactly for balloon and fox scenes; the 3 blueprint scenes differed by at most 4 levels of 255 against a GPU-rendered export on this Mac, and about 21 000 pixels (line edges) by 8 or more levels against a software-rendered export. The reference we compared with was produced on macOS, not on the real worker image.

## Job A: parity against the real Linux worker image

Goal: replace the macOS reference with frames produced by the same image the AWS worker uses, then re-measure.

1. Docker is running. The local image `videosaas-worker:plates-e2e` contains the real worker (Chromium, software GL, `packages/plate-engine`). Inspect it (`docker run --rm --entrypoint sh videosaas-worker:plates-e2e -c '...'`) to find where Chromium, node and the engine live and which env vars the worker sets for Chromium (look at `worker/Dockerfile` and `worker/src/plates.mjs`, `packages/plate-engine/lib/capture.mjs`).
2. Write `tools/spike-phase0/linux-ref.mjs` (or a shell script) that, inside that image with NO network (`--network none`), runs the same `openScene` capture code against each of the 9 bundles plus `foxparamsA.html` and `foxparamsB.html` in `$P0`, and writes PNGs for the same frames the harness uses (first, middle, last for the 9 scenes; frames 0 and 45 for the params files) as `$P0/linux/<name>-ref-<n>.png`. Mount `$P0` read-only and the output directory read-write. Do not change the image or any file under `packages/` or `worker/`.
3. Extend the harness/runner (new files or additions in `tools/spike-phase0/` only) to compare the Worker-preview frame (full size, from Chrome on this Mac) with each Linux reference and report per frame: percent of pixels differing at all, percent differing by more than 2 levels, maximum level difference, and mean absolute difference. Use the existing `diffImages` in `harness.js`.
4. Apply the proposed tolerance from the plan: no more than 2% of pixels differ by more than 2 levels and no pixel differs by more than 16 levels. Report pass or fail per scene and per frame, and list the worst offenders.
5. For any scene that fails, produce an amplified (x40) difference image like `blueprint-diff.png` (see `diff.html` and `shot.mjs`) and save it under `$P0/linux/`.
6. Also compare the Linux export with the macOS-Chrome export (`$P0/*-ref-*.png`) so we learn how much of any difference comes from the rasteriser and how much from the Worker host.

## Job B: text and image-asset scenes

Goal: find out whether scenes with text and with image assets work in the Worker host, because the current host shim does not support images.

1. Search `packages/plate-engine/src/canvas-core/` and `packages/plate-engine/test/fixtures/` for how text (lettering, captions, labels) and image assets (`film.assets.images`, `window.__ASSETS__`) are used. Read-only.
2. Find or construct (in `$P0`, using `bundleScene` from `packages/plate-engine/lib/engine.mjs` the way `build.mjs` does) one scene that draws text with a named font or the engine's lettering, and one scene that loads an image asset. Do not modify the engine or any existing scene source; build test scenes only in `tools/spike-phase0/` or `$P0`.
3. Make the harness Worker host support image assets: replace the throwing `Image` shim in `harness.js` so assets named in `__ASSETS__` (data URLs) are decoded with `createImageBitmap` before the scene's `ready` runs and `new Image()` / `decode()` work for them. Keep everything else in the Worker contained (no fetch).
4. Run both scenes through the Worker host and the Linux image export and report pixel differences with the same metrics and tolerance as Job A. Report whether fonts differ between macOS and the Linux image and which font families are actually drawn.

## Rules (hard limits)

- Edit or create files ONLY under `tools/spike-phase0/` and under `docs/spikes/` in this worktree. Do not touch `packages/`, `backend/`, `frontend/`, `worker/`, other worktrees, or the main folder `/Users/osamaehsaan/Code/Market_apps/VideoSaaS` (except reading `var/plates`).
- No `git push`, no deploys, no cloud or AWS calls, no Railway, no database. No `git commit`: leave changes uncommitted for the manager to review.
- Servers bind `127.0.0.1` only. Stop every server and container you start before you finish.
- Do not install global packages. Do not read or print API keys or secrets.
- If something blocks you (a command is denied, the image lacks Chromium, a scene cannot be built), do not work around it in a risky way: write what blocked you into the report and stop that job.
- Do not change the tolerance or the test definitions to make results pass.

## Deliverable

Write `docs/spikes/phase0-linux-parity.md` containing:

1. What you ran (commands, image id, Chromium version inside the image, the flags used).
2. A table: scene, frame, percent differing, percent over 2 levels, max level, pass/fail against the tolerance, for Worker preview vs Linux export, and for macOS export vs Linux export.
3. The amplified difference images' paths for failures.
4. Job B findings: what the text and image scenes needed, what you changed in the harness, the measured differences, fonts.
5. A short "what this means for the plan" list (facts only; do not edit `docs/LIVE_SCENES_PLAN.md`).
6. Anything you could not do and why.

Finish by printing `DONE` and the path of the report on a line by itself.
