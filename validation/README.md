# Local renderer smoke test

This directory contains a small feasibility experiment, separate from the planned product implementation.

## Reproduce

Prerequisites: Node >=22, npm, FFmpeg/ffprobe, and a working Chrome installation. Dependencies are pinned by `package-lock.json`. Install and run from this directory:

```sh
npm ci
node run-smoke.mjs
```

The script stages the locally installed GSAP file, checks the composition, renders a six-second video, probes its metadata, extracts review frames, and writes a run report. It needs permission to launch headless Chrome and bind a local preview server. It stops on a failed command or failed output metadata assertion.

Outputs:

- `smoke/renders/smoke.mp4`
- `smoke/renders/report.json`
- `smoke/renders/metadata.json`
- `smoke/renders/*.log`
- `smoke/frames/second-0.png`, `second-2.png`, `second-5.png`

The report marks visual/playback review as pending because encoding and metadata cannot establish aesthetic or animation quality. Human/agent review findings belong in `../docs/LOCAL_VALIDATION.md`.

The current test uses Arial from the system, and the renderer's compiler may fetch/cache its default Inter font. Offline rendering and bundled font determinism remain a separate production validation step. This test does not call a model API or validate screenshot-to-video generation, customer demand, or hosted performance.

Re-running overwrites this fixture's generated evidence files only. Preserve an evidence snapshot before benchmarking multiple runs; the later benchmark harness must keep every attempt.
