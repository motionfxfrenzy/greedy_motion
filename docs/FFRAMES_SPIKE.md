# fframes spike (2026-10-09)

Question: can we use fframes (Rust video framework, v1.2) next to HyperFrames, using `mrsarac/ff-tracking` as the test project? Origin of the question: docs/RESEARCH_MOTION_REPOS.md section 4.

Everything is under `experiments/fframes-spike/`. The upstream clone, the Python venv and the patched copies live in the session scratchpad, not in the repo.

## What was run

| # | Run | Result |
|---|---|---|
| 1 | ff-tracking as shipped (`tools/render.sh`), Mac arm64 (8 CPUs), Skia **Metal** | **works first time.** Cold compile 4 min 07 s. Render: pass 1 (flat SVG, 4K) 4.9 s, sound synthesis a few seconds, pass 2 (lens shader, 1080p) 42.9 s including audio encode. 180 frames. Output 65.8 MB at the project's crf 16 `tune=grain` (14.8 MB at crf 24). Audio -14.0 LUFS as claimed. |
| 2 | Same project, **CPU raster** (`SkiaCpuCtx` instead of Metal; patches in `patches/`) | works, nearly the same picture (SSIM 0.76 over the whole film, which is low because tear rows and grain are per-pixel hash noise; frame 4.0 s side by side was visually the same). Pass 1 7.8 s, **pass 2 592 s** at ~188% CPU, i.e. about **14x slower** than Metal. |
| 3 | The film inside a **HyperFrames composition** (`hybrid/`): 3 s HF-native brand intro, the fframes clip as a `<video>` plus its audio as `<audio>`, 3 s HF-native end card | `hyperframes check` passes (2 warnings; the first attempt failed on a `<video>` nested in a timed wrapper, so the clip must be a direct child of the root). Rendered in the worker image (`--cpus=2 --memory=4g`) in **81 s** for 12 s, 1080p, video and audio intact. |
| 4 | Build and run on **Linux** (the worker image, Debian 12 aarch64) | **not done.** The image has no compiler, curl or Rust, and downloads here ran at ~220 KB/s; apt alone would have taken the best part of an hour before cargo started. I stopped it. See "Linux: what is known". |

Review of the film (5 fps sheet, `out/ff-tracking-5fps.png`; judged from stills and metrics, not watched at playback speed): the grammar reads clearly in every shot: tilted close-up, strong focus pull, LED grid, hatched tracker boxes with real coordinates, a palette change per cut, collapse of boxes into a "Done" pill. `scripts/benchmark-metrics.mjs`: mean motion 0.081 (our gate is 0.015-0.035, but this is a 6 s style piece with a cut every 0.5 s), 0 quiet seconds, 3 hard hits (our gate allows 1). Different film type, so those two numbers are not a failure, just not comparable with the showreel gates.

## What it is, from the code

- Every frame is an SVG tree built in Rust (`svgr!`), rendered with Skia; text, boxes and the HUD are data (`hud/src/lib.rs`, `SCENE_LIST`), the camera is computed per frame on the CPU and mirrored in the shader. Text, palette, tilt, zoom and blur are **compiled in**; changing the words means editing Rust and rebuilding (incremental builds are fast, the cold 4 min is the dependency tree).
- Two passes: pass 1 `flat` writes a near-lossless mp4 (crf 8); pass 2 `lens` binds that mp4 as a texture for the SkSL shader (`lens/shaders/lens.sksl`, 171 lines).
- Sound is made by `tools/sfx.py` (numpy, scipy) from `out/tracks.json`, the same data file the visuals use; audio is mastered to -14 LUFS.
- fframes itself has `inspect` (missing fonts, clipped text), `strip`/`frame` (PNG previews), `audio analyze`, `snapshot` and `--json`; the maker/checker idea built in.
- The `fframes-video` skill (`npx skills add dmtrKovalenko/fframes`) is meant for coding agents; not read or installed in this spike.

## Linux: what is known (not tested)

From the fframes README and the crate source (fframes_skia_renderer 1.2.0): Metal on macOS, Vulkan on Linux and Windows, a built-in CPU backend (`--backend cpu`, no preview, "about 10x" slower per the project), prebuilt Skia and FFmpeg for macOS and Linux (arm64 and x86_64). The ff-tracking `main.rs` files hard-code Metal and the native preview player, so on Linux they must be edited (swap the context, drop the `metal` feature and `fframes_native_player`); I prepared that copy (`ff-linux` in the scratchpad) but did not build it. Our worker has no GPU, so Linux means the CPU path. Measured on a laptop, that path took about 10 minutes for 6 s of this film; a 2-CPU worker will not be faster. The built-in CPU backend is said to be faster than `SkiaCpuCtx` (which is only a compatibility shim), so 10 minutes is an upper bound, not a forecast.

## Licence notes

- fframes: MIT (per its README). ff-tracking: MIT, JetBrains Mono under OFL. The visual style is Michael Nowak's; we take the grammar, never his footage.
- The workspace enables fframes' `h264` plus `libav-agree-gpl` features, i.e. it links GPL x264. That is the same family of exposure as our worker's ffmpeg, but it must be checked before any binary leaves our servers.

## Answers

1. **Does it run on our Linux worker?** Unknown. It runs on Mac Metal and on Mac CPU. On Linux the only realistic backend for us is CPU, which was about 14x slower than Metal on this film.
2. **Can the lens look be reached in HyperFrames?** Not with the same quality via CSS/SVG alone; the depth of field, per-pixel perspective, bloom and LED grid are real shader work. A WebGL pass inside a HyperFrames clip is the other route, still unmeasured. Cheaper approximations (CSS 3D tilt, blur pull, RGB-offset layers, a repeating-gradient pixel grid, SVG tear) would give the grammar without the optics.
3. **Can fframes output be dropped into HyperFrames?** Yes, shown in `hybrid/`: mp4 + wav as direct-child `<video>` and `<audio>` clips; brand intro and end card stay in HF. 81 s render at 2 CPUs for 12 s.
4. **Cost and determinism:** per rendered second on Metal about 7 s of wall time for the 1080p lens film (48 s for 6 s including pass 1 and sound); about 100 s per second on CPU on a laptop. Determinism was not tested (SSIM 0.76 between Metal and CPU says outputs are not bit-identical; two Metal runs were not compared).

## Verdict

- **Adopt as an offline asset producer for one hero film type** ("agent is thinking / tracker" clips), rendered on a Mac or a GPU machine and dropped into a HyperFrames showreel as a `<video>` clip. Do not put it in the Fargate/CPU worker path.
- **Do not make it a second general pipeline.** Words are compiled into the Rust code, so every brand needs a rebuild unless we first move `SCENE_LIST` into a runtime JSON (a small change in `hud`, not done).
- **Port the grammar to HyperFrames** as the `tracker-hud` module (rows 15-19 in RESEARCH_MOTION_REPOS.md): boxes with coordinates, links with a travelling dot, the lock beat, a per-cut palette flurry, a box collapse into a pill; with CSS/SVG approximations for the optics.
- **Open spikes, in order:** (a) a Linux build to get real numbers (needs a faster network or a prebuilt builder image with Rust, gcc, nasm, pkg-config; try the built-in CPU backend, not the shim); (b) runtime JSON for `SCENE_LIST` so one binary renders any brand; (c) a WebGL lens clip in HyperFrames, measured against item 2 above; (d) read the `fframes-video` skill and compare it with our `shared-craft.md`.

## Files

- `experiments/fframes-spike/out/ff-tracking-small.mp4`, `ff-tracking-5fps.png` (6x5 tiles at 5 fps, row-major), `hybrid.mp4`, `hybrid-2fps.png`
- `experiments/fframes-spike/hybrid/` (the HyperFrames project), `patches/` (CPU-backend edits), `PROMPT-ff-tracking.md` (the upstream prompt that made the film), `tracks.json`
- Upstream: https://github.com/mrsarac/ff-tracking (commit 4c195bd), https://github.com/dmtrKovalenko/fframes

## Follow-up (same day)

Two new films (HUD dashboard, typography) and a Canvas 2D library check are in docs/ENGINE_CAPABILITY_TEST.md. Incremental builds take 17 s and each film renders in about a minute on Metal; the crate's own tests (`cargo test -p hud`) caught off-frame tracker targets before any render.
