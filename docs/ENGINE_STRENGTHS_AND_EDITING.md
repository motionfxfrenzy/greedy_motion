# Engine strengths and what the editor can edit (2026-10-09)

Status: planning note, nothing built. Written after the fframes spike (docs/FFRAMES_SPIKE.md). Facts about the editor come from memory notes (`pro-editor-build`, `own-editor-direction`), not a fresh read of the editor code.

## Three levels of editability

| Level | What it is | What the editor can do |
|---|---|---|
| 1. Live elements | HyperFrames HTML, CSS, GSAP | Everything: select a word, box or card; edit text, colour, position, easing, keyframes. The Pro editor's HTML clips sit here. |
| 2. Parametric layers | p5 / p5.brush, Rough.js, Lottie, Three.js, Canvas 2D running inside a HyperFrames clip | Edit through exposed parameters (seed, colours, stroke width, copy). Individual strokes or sprites are not selectable unless we expose them. |
| 3. Baked clips | fframes film, anidoodle webm/mp4 (alpha), Veo video | One clip: trim, move, scale, crop, opacity, blend, volume, speed. Changing its content = re-render from its inputs. |

fframes is level 3: its tracker boxes and labels exist as data (`tracks.json`) but not as anything the editor can reach inside the mp4.

## Strengths by engine

| Engine | Strong at | Weak at | Role |
|---|---|---|---|
| HyperFrames | UI, text, cards, layout, cause-and-effect, timing, sound sync, our quality checks | real optics (depth of field, bloom, tear), hand-drawn texture | base of every film; owns text, logo, timing, audio mix |
| Doodle (anidoodle) | sketchy hand-drawn scenes and callouts, alpha overlays | authoring a new subject (about 300 lines per scene, unproven), tidy not messy handwriting | overlay clip |
| p5 / p5.brush | strokes, watercolour, generative patterns, particles | slow painted looks (up to about 2.5 s per frame), small text | parametric layer under HF text |
| Canvas 2D | procedural graphics, particles, type made of points, driven from timeline time (see the Motion Library) | text editing, layout | parametric layer or whole scene |
| fframes | lens look (perspective, focus pull, LED grid, bloom, tear), per-pixel shaders, sound from one data file | Rust, words compiled in, no GPU on our worker (about 14x slower on CPU), Linux untested, not editable inside | offline hero clip |
| Veo / Nano Banana | real 3D, photoreal footage | garbled text, no beat timing, paid | 3D shots only, text on top in HyperFrames |

Routing stays by film type (docs/MOTION_ENGINES.md): every non-HyperFrames output is a layer under HyperFrames text so the quality gates stay valid.

## Making baked clips feel editable

1. Edit inputs, not pixels: a form per baked clip (words, palette, tilt, brand colour, seed); Apply re-renders. Works for doodle plates and the fframes tracker film once its scene list moves from compiled Rust to runtime JSON.
2. Keep what must stay editable in HyperFrames: brand name, headlines, logo, CTA, captions as live elements over the clip; bake only the lens/texture layer.
3. Cache renders keyed by inputs; fframes cost only matters on a miss and a miss can run on a Mac or GPU machine.
4. Build the tracker overlay as a HyperFrames module (RESEARCH_MOTION_REPOS.md rows 15-19): boxes, coordinates and links are live; optics are an approximation.

## Editor state and next steps

Pro editor Layers mode is not connected to EffectCraft; `gm-editor` has a HyperFrames mode (timeline, inspector, render). Neither has a parametric-clip panel or a baked-clip input form, and baked-clip layers (alpha, trim, audio) were not checked there. Proposed order, to revisit later: (1) `tracker-hud` module in HyperFrames; (2) a generic "baked clip with inputs" layer type in the editor spec; (3) runtime JSON for fframes' scene list.
