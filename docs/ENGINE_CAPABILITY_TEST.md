# Engine capability test: fframes (HUD, typography) and the Canvas 2D library (2026-10-09)

Follows docs/FFRAMES_SPIKE.md and docs/ENGINE_STRENGTHS_AND_EDITING.md. Everything is under `experiments/fframes-spike/`. All films were judged from 5 fps contact sheets and `scripts/benchmark-metrics.mjs`, not watched at playback speed.

## 1. fframes on two new scenes

Both films reuse the ff-tracking pipeline unchanged (flat SVG pass, lens shader pass, code-made sound) and only replace the content: `hud/src/lib.rs` (scene list, tracker boxes) and `flat/src/lib.rs` (drawing). Sources: `scenes/film-hud/`, `scenes/film-type/`, `scenes/README.md`.

| | HUD film | Typography film |
|---|---|---|
| Content (12 shots, 6 s) | KPI count-up, latency line chart, 3-ring gauge, bar chart, table, heat grid, radar sweep, service map, two type shots, box collapse, "Done" pill | drop, wide-to-tight tracking, stretch, outline, stacked wall, slice, spin, two-line stack, wipe, zoom, collapse, "Kinetic" pill |
| Font | JetBrains Mono (shipped) | Inter Bold (OFL; advances measured with fontTools and compiled in, so boxes sit on real letters) |
| New code | about 100 lines in `hud`, about 200 in `flat` | about 100 in `hud`, about 70 in `flat` |
| Build | first build after edit 1 min 38 s (deps reused from a copy of the target dir); later 17 s | 17 s |
| Render | flat 8.8 s, lens 42.9 s, whole pipeline about 1 min 15 s | flat 9.0 s, lens 46.9 s, about 1 min |
| Metrics | mean motion 0.103, 0 quiet seconds, 4 hard hits | mean motion 0.112, 0 quiet seconds, 4 hard hits |
| Size | 14 MB at crf 24 (65 MB at the project's crf 16) | 16 MB at crf 24 |

What the 5 fps sheets show:
- **HUD:** every widget reads and takes the same lens (focus pull, grid, bloom, palette, tracker). The line chart, gauge, bars, heat grid, radar and service map are the strongest; the bar tops, gauge tip and chart peak get locked boxes with real coordinates. The table shot is the weakest (small text, blur makes rows hard to read). Palette per shot works as rhythm.
- **Typography:** each move reads (drop, tracking, stretch, outline, wall, slice, spin, stack, wipe, zoom) and the boxes follow the animated letters. Weaker: the wall shot crops its top row at the frame edge, "MEANING" is cropped on the left at the start, the first shot shows a stray box before the word is complete. All fixable by camera tuning.
- **The built-in checker earned its keep:** `cargo test -p hud` ("target stays in frame", "lines fit") failed on 11 frames of the HUD film and 8 of the typography film before any render, all caused by wide hops of the tracker box under a zoomed camera. Fixing hop order, zoom and entrance offsets until the tests passed saved renders.

What the lens gives that HyperFrames cannot (without a new WebGL pass): real depth of field that follows the tracked element, perspective tilt of the whole screen, chromatic fringe, bloom and LED grid, scanline tear on a lock, and a palette remap per shot from one flat black-and-white pass. What HyperFrames does better: live selectable text, layout, exact brand fonts and colours (the palette remap makes brand colour a gradient map, not exact colour), and editing.

Limits seen: typography uses one font family at a time; box positions for proportional fonts need a measured advance table (done here for A-Z, not general); text is baked into video so it is not editable or searchable; every film is a Rust rebuild; no 9:16 attempted; sound is the shipped sfx script driven by cut/lock/key events (works for the new films without change).

## 2. The Canvas 2D library (http://127.0.0.1:8027, `Effectcraft_templates/Motion_gallery`)

Checked in the running page and the source:
- **Canvas 2D only.** `engine.js` (53 dense lines, 14.8 KB) does `canvas.getContext('2d')` on a 1280x720 logical space scaled to the 1920x1080 canvas. No WebGL anywhere in the templates or projects.
- **Deterministic.** `window.renderAt(t)` is a pure function of time driven by one paused GSAP timeline (`window.__timelines['gallery-showreel']`); the file contains no `Math.random`, `Date.now`, `performance.now` or `requestAnimationFrame`. Verified in the browser: for six times (0.5 to 14.5 s) the pixel hash after `renderAt(t)` was identical after drawing another frame in between.
- **Cheap.** A draw call takes well under a millisecond in the browser. Through HyperFrames in our worker image (`--cpus=2 --memory=4g`, 30 fps, 1080p): **Showreel 15 s in 55 s, Product Story 15 s in 54 s** (about 0.12 s per frame, the same class as our HTML films).
- `hyperframes check` passes both projects; Showreel has one warning (canvas content touches the frame edge, expected for full-bleed grounds).

Quality (5 fps sheets, `canvas2d/`):
- **Graphic Showreel:** strong. Easing curve, split type, iridescent blob, geometric tile wall, particle assembly of "MOTION", concentric ring tunnel, fluid-filled "FORM", voxel wave, rotated type wall, beat words (EVERY / FRAME / IN / SYNC), lockup. Value flips between ink and paper and colour fields happen in nearly every chapter, as the research recommends. Metrics: mean motion 0.07, 3 quiet seconds (the first second and the last two: the opening curve and the lockup hold), 15 hard hits (a cut per beat, so the "at most 1 hard hit" gate does not apply to this film type). Audio as rendered: -16.6 LUFS, peak -1.1 dBFS (hotter than our -2.2 dB limit; the film's own score file, not our mastering chain).
- **Product Story:** clean, readable SaaS look (rotating keyword pill, prompt box, three cards, card wall, orbit of benefit chips, UI mock, shard burst, end card) but **static between moves**: mean motion 0.012, 11 quiet seconds. It has the same pacing problem as our calm and explainer films; the research items (second beat in every hold, accelerate then hold) apply to it too.
- **Editability:** text is drawn into the canvas, so there are no live elements. Copy, brand and accent flow in through `templates/config.js` (four badges, three feature titles, eight orbit benefits are fixed array sizes in this prototype). That is level 2 in docs/ENGINE_STRENGTHS_AND_EDITING.md: editable by parameters, not by selecting a word.

## 3. Which engine wins per scene type (evidence so far)

| Scene type | Best engine | Why |
|---|---|---|
| Product UI, cards, text over layout, brand colours | HyperFrames | live elements, exact brand colour, our checks, editable |
| Dashboard / HUD / telemetry with a camera feel | fframes (baked) or a HyperFrames tracker module with lens approximations | the lens gives focus pull and perspective that HTML cannot; widgets take about 15-30 lines each |
| Kinetic typography as a graphic idea (outline, slice, spin, wall) | HyperFrames or Canvas 2D for editable work; fframes for the lens look on a hero shot | all three do it; HyperFrames keeps text editable |
| Procedural graphics (tiles, particles, ring tunnel, voxel wave, blobs) | Canvas 2D | cheapest, deterministic, runs in our worker as it is |
| Sketch / hand-drawn overlays | doodle (anidoodle), baked alpha clips | texture HyperFrames lacks |
| Strokes / watercolour | p5 / p5.brush as a parametric layer | slow per frame, use sparingly |
| 3D / photoreal | Veo / Nano Banana, text on top in HyperFrames | unchanged |

## 4. Not done / next

- No Linux build of fframes (see FFRAMES_SPIKE.md); both new films were rendered on Mac Metal only.
- Not measured: determinism across two Metal runs; 9:16; brand colours through the palette remap (the lens maps brightness to fixed palettes, so a brand-colour palette would need a new `Palette` entry).
- Open: whether to port the widget and type shots to HyperFrames modules with CSS/SVG optics (RESEARCH_MOTION_REPOS.md rows 15-19) and compare side by side with these films; apply the pacing fixes to the Canvas Product Story; move fframes' scene list to runtime JSON.

## 5. Follow-up: the combined film

The three engines were then used together in one 20 s film, with a re-skin test from brand.json: see docs/COMBINED_FILM.md.
