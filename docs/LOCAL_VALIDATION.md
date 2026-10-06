# Local validation protocol and evidence

Date: 2026-10-02. Status: local smoke export succeeded; metadata and sampled frames reviewed. Full product/customer validation remains pending.

## Observed environment

| Item | Observation |
| --- | --- |
| Workspace | `/Users/osamaehsaan/Code/Market_apps/VideoSaaS` |
| Initial files | Source PDF only; no application or package manifest |
| Git | Initially not a Git repository |
| Node | v26.9.0 |
| npm | 11.19.1 |
| FFmpeg | 9.0.1; `ffmpeg` and `ffprobe` on PATH |
| Chrome | Application executable exists at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| HyperFrames | No global executable found in initial PATH check |
| Local renderer installed | HyperFrames 0.8.111 and GSAP 3.14.2, pinned in `validation/package-lock.json` |
| Hardware | Apple M1 Pro, 8 CPU cores, 16 GB RAM (reported by doctor) |

Installed tools alone do not validate rendering or customer value.

## Experiments

| ID | Experiment | Pass condition | Status |
| --- | --- | --- | --- |
| V00 | Environment inspection | Locate runtime, encoder, browser | Completed; versions above |
| V01 | Renderer availability and doctor | Pinned release loads; required render dependencies usable | Renderer installed and render verified; initial sandboxed doctor Chrome probe timed out |
| V02 | Six-second animated smoke render | Valid MP4 and visibly changing frames | Metadata and sampled-frame checks passed; continuous playback review pending |
| V03 | Screenshot demo | Twenty-second video uses supplied screenshots and correct copy | Pending |
| V04 | Scene-only revision | Targeted change with unrelated scenes preserved | Pending |
| V05 | Portrait layout | Legible vertical composition with deliberate reflow | Pending |
| V06 | Repeatability | Three same-input runs have consistent layout/timing | Pending |
| V07 | Edge cases and recovery | Controlled failures; interrupted job recoverable | Pending |
| V08 | Batch benchmark | Twenty runs; metrics and failures retained | Pending |
| V09 | Customer trials | Five reviews, ≥3 publishable, ≥2 paid-pilot commitments | Pending; requires customer participation |

## V02 procedure

Create a six-second composition with a title, moving shape, and visible counter. This isolates animation and encoding from AI planning. Install the renderer as an exact local dependency. Use installed CLI help for actual command syntax, then run doctor, composition checks, render, and ffprobe. Inspect frames at the beginning, middle, and end; play the complete MP4 before marking motion quality reviewed.

Save composition source, command output, dependency lockfile, tool versions, output metadata, frames, timings, and MP4 under the validation directory. A static composition that encodes successfully does not pass the animation test.

## V03 fixture intake

- Three screenshots of a real or explicitly labeled fictional app.
- Product name, exact hook, three approved feature statements, CTA.
- Brand colors and licensed local font.
- Highlight/focal region for each screenshot.
- 20 seconds, 600 frames, 1920×1080, 30 fps.
- No fabricated metrics or synthetic customer endorsements.

Use synthetic/public assets only with clear provenance for development. Customer validation requires customer-approved inputs. Never treat a synthetic demo as proof of willingness to pay.

## Fixture matrix

| Input | Purpose |
| --- | --- |
| Normal dashboard + three short features | Baseline |
| Dense dashboard and tiny UI labels | Crop/focus selection and readable callouts |
| Tall mobile screenshots | Containment and portrait reflow |
| Long product name and long feature copy | Copy overflow rejection or visible warning |
| Missing/corrupt screenshot | Actionable validation error before render |
| Repeated submission of same operation | Idempotency |
| Terminated renderer | Failure cleanup and controlled retry |
| Invalid brand color/unknown font | Schema and font-fallback handling |

Run at least twenty jobs spanning five input sets. Do not combine deliberately invalid inputs with normal-job success rate without labeling them; report expected rejections separately.

## Scorecard per run

Record run/project/revision IDs; fixture hash; template, renderer, browser, runtime and font versions; hardware/OS; resolution/fps/duration; draft/final setting; cold/warm cache; planning/check/render/total seconds; peak RSS and output bytes; model tokens/cost; operator minutes; errors/retries; metadata results; visual-review result; and artifact paths.

Capture p50/p95 timing with sample count and method. For twenty observations use nearest-rank percentiles and retain raw values. A p95 from twenty samples is preliminary, not a production SLO claim.

## Visual acceptance rubric

Rate 1–5 for readability, brand consistency, motion/pacing, screenshot fidelity, and clarity of product value. Target mean ≥4 with no critical defects. Inspect at native export size and phone-sized playback. Check transitions as well as static scene midpoints. Review exact wording against the brief.

Critical defects: false claim, missing/wrong asset, clipped important text, illegible focal UI, accidental blank frame, corrupt file, severely wrong timing, or unintended changes outside the requested scene.

## Customer interview record

Before showing the output: current workflow, time/cost, last video created, next planned video, frequency, and purchasing authority. After review: publishable yes/no, exact changes needed, preferred use case, value relative to current method, price acceptance, and next project commitment. Record real behavior separately from opinions.

## Executed smoke test results

Source: `../validation/smoke/index.html`; reproduce using `node run-smoke.mjs` from `../validation`.

| Measurement | Result |
| --- | --- |
| Lint | Passed, zero errors; one non-fatal nested-subcomposition warning |
| Browser check | Passed; zero runtime and motion errors, zero layout issues across nine samples |
| Text contrast | 27/27 sampled checks passed |
| Final render command time | 18.335 seconds, one worker, delivery quality |
| Composition check time | 7.827 seconds on successful rerun |
| Output codec | H.264, yuv420p |
| Dimensions | 1920×1080 |
| Frame rate/count | 30 fps, 180 decoded frames |
| Duration | 6.000 seconds |
| File size | 367,722 bytes |
| Visual samples | 0s: intended entrance state; 2s: counter 40 and partial bar; 5s: counter 100, full bar, visible completion text |
| Visible clipping in inspected samples | None observed |
| Continuous playback | Not yet reviewed; do not infer all-frame quality from three images |

Evidence files are `../validation/smoke/renders/report.json`, `metadata.json`, command logs, `smoke.mp4`, and `../validation/smoke/frames/second-{0,2,5}.png`. Generated media/logs are intentionally ignored by Git; keep these artifacts alongside any published validation report.

### Issues found and resolved or retained

1. npm registry access failed under sandbox DNS restrictions. Authorized external access allowed installation.
2. The first authoring pass failed lint because CSS and GSAP both controlled the progress bar transform. Moved the initial state into a GSAP `fromTo` animation and reran checks successfully.
3. The first render waited in managed-browser setup. Stopped that attempt after approximately 150 seconds and explicitly selected the installed Chrome through `HYPERFRAMES_BROWSER_PATH`. The next export succeeded. The cancelled attempt's report/log are preserved under `renders/attempt-browser-setup/`.
4. A nested-card composition warning remains. It does not block the smoke export; production scene templates should use proper sub-compositions for timeline editing.
5. The compiler fetched/cached Inter despite this smoke fixture specifying system Arial. Fully offline, bundled-font rendering is unproven and remains an explicit M1/M2 check.
6. Optional transcription, voice/music models, and Docker daemon were unavailable in the initial doctor run. They were not needed for this native, silent smoke test.

This single successful export is not a benchmark of screenshot videos, AI planning, customer demand, or cloud performance. The render timing is one warm-environment observation and excludes the cancelled setup attempt and authoring corrections. No model API or customer asset was used.

## Decision record

Basic local rendering feasibility: demonstrated with metadata and sampled-frame evidence. Full technical gate: pending V03–V08 and continuous playback review. Customer gate: pending. Hosted build gate: pending. Proceed to the local screenshot-demo implementation; the hosted app remains gated by the broader tests.
