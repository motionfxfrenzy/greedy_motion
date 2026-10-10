# Combined film: fframes + Canvas 2D + HyperFrames (2026-10-09)

"See it think. Watch it make." A 20 s, 1080p, 30 fps, 120 BPM film for Greedy Motion, made with three engines. Everything is in `experiments/fframes-spike/combined/` (README there has the commands). Films and 5 fps sheets: `out/film-small.mp4`, `out/film-lumen-small.mp4`, `out/sheets/`. **All judgement below comes from 5 fps contact sheets, `scripts/benchmark-metrics.mjs`, `ffmpeg` loudness and a scene-cut audit; the film was not watched at playback speed.**

## Concept and script as built
One motif: the tracker box. It locks onto words (act 1), becomes the frame that opens a tile wall (act 2), collapses again (act 3), floods the brand colour (act 4) and finally expands into the video frame of the lockup (act 5). Value flips at every act change (ink, paper, accent, ink, paper, ink).

| Time | Act | Engine | What happens |
|---|---|---|---|
| 0-4 | 1 THE BRIEF | fframes | cursor, typed line "make a launch / film for Kinetic", four reads ("reading brand.json", "14 colours · 3 fonts", "6 screens found", "building…"), a cut every 0.5 s, palette cycles per cut, fourteen boxes collapse into one at 3.5-4.0 |
| 4-10 | 2 THE BUILD | Canvas 2D | hit at 4.0: ink to paper iris from the box, tile wall; accent wipe, "Every frame," then "built in code." (one-move swap); about 5,000 particles resolve into FRAME and a cursor drags a tracker box around it; easing curve with a playhead that replays; flurry of four 0.25 s cuts (tiles, rings, dot matrix, box) |
| 10-14 | 3 THE CHECK | fframes | readouts "contrast 4.9 : 1" (gauge), "overlaps 0" (bars), "dead air 0 s" (heat grid), "seek-safe" (radar), a gates table that locks on its last row, "all gates pass", boxes collapse again |
| 14-18 | 4 THE BRAND | Canvas + HyperFrames | hit at 14.0: accent flood from the box; live product card (typed prompt, three scene cards, a cursor clicks "Swap colours" at 15.3): the canvas ground, dots, card and swatch re-skin together through indigo and green and back; flurry of five product screens at 0.25 s; the last screen folds into the box |
| 18-20 | 5 LOCKUP | HyperFrames | box expands into the frame (hit at 18.0), name, tagline typed with a caret, a small second beat, fade |

Changes from the brief, and why: act 2's flurry is four cuts of 0.25 s, not six (six do not fit one second at that length); act 4's flurry is five screens at 0.25 s (the first draft used 0.2 s, which is not a musical subdivision; the audit caught it). The pre-drop dips are 3.0-4.0 s and 13.5-14.0 s on the music bed.

## What each engine did, and the numbers
| Part | Engine | Why this engine | Cost measured |
|---|---|---|---|
| Acts 1 and 3 (4 s each) | fframes on Mac Metal | the lens: focus pull following the tracked word, perspective, LED grid, tracker with real coordinates, sound from the same events | per act: pass 1 about 4-8 s, lens pass about 27 s, plus an incremental build; `cargo test -p hud` caught off-frame targets before rendering |
| Act 2, act 4 background | Canvas 2D (about 258 lines, pure functions of time, parametric from brand.json) | procedural graphics (tile wall, particles from a text mask, curve, ring tunnel) are cheap and deterministic | negligible per frame inside the HyperFrames render |
| Assembly, UI, lockup, HUD chip and ruler, timing, skin sync | HyperFrames | live text and layout, exact brand colours, our checks, the `<video>` and `<canvas>` clips on one timeline | whole film renders in **147-156 s** in the worker image at 2 CPUs / 4 GB (about 7.5 s per film second) |
| Sound | Lyria music bed (24 s generated, 120 BPM, trimmed from 0.05 s so beat 1 is at 0) + fframes act sounds + synthesised cues | one cue list drives picture and sound | mastered to -14.1 LUFS, true peak -2.8 dBFS (target at most -2.2) |

Verification results:
- `hyperframes check`: passes, 0 errors; 4 warnings (three "nested structure needs sub-composition" notices as in our other films, one lint label for the proxy tweens); contrast 11/11 text checks pass for both brands.
- `scripts/benchmark-metrics.mjs`: mean motion 0.069 (Lumen 0.065), **1 quiet second** (the final hold, 0.004). The first render had a second at 0.002 (the curve hold, 8-9 s); fixed by an area-filled playhead that replays every 0.5 s. 16 hard hits, all on cuts and hits; the "at most 1 hard hit" gate belongs to the continuous showreels and does not fit a cut-per-beat film.
- Cut audit (`audit/cuts.mjs`, scene detection against the beat and eighth-note grid): 24 cuts found, 20 within 35 ms of the grid, the other 4 (6.567, 7.567, 7.633, 9.8 s) are progressive iris or flurry transitions that start on the grid but are detected a few frames late. fframes cuts are exact multiples of 15 frames (from `tracks.json`).
- Contact sheets read for overlap, early appearance and dead holds: three loops (act 1 cameras too close and cropping words; frame rectangle expanding from its corner instead of its centre; flurry off the music grid; a 0.8 s static hold at 17.0-17.4; slow iris at 4.0). Remaining weak spots: the gates table in act 3 is small and hard to read at 5 fps; act 1 words are partly hidden by the chain of boxes while they type (by design of the lens film, but legibility is limited at 0.5 s per shot).

## Seams
- **fframes to Canvas (act 1 to 2) and Canvas/fframes to Canvas (act 3 to 4):** the box handoff works (160 px box on ink in both layers); the Canvas draws the lock red like the lens does. There is no matching element between act 2's flurry and act 3's gauge; that is a hard cut on a hit.
- **Canvas to HyperFrames (act 4):** the accent colour is one function of time (`skinAt`) used by the canvas and the DOM through a CSS variable, so the click re-skins both in the same frame.
- **HyperFrames lockup:** the box in the canvas and the SVG rectangle share position and size, so it reads as one object.
- fframes colour is a brightness-to-palette remap: the Brand palette (five stops through the accent) carries the brand tint, but the shots using the Phosphor and Neon palettes (act 3) are fixed green, and the lock colour is fixed pure red.

## Re-skin test (Lumen, from `brand.lumen.json` only)
No code was edited; the acts were rebuilt (about 3 min), the project regenerated and rendered (149 s). Colours, product, customer, lines and the whole UI changed and `hyperframes check` still passes contrast. What broke or stayed off-brand:
1. **Stale copy in the template:** the share link in the product UI still reads "kinetic-launch" (hard-coded in `template/index.html`); the scene-card names (Hook, Demo, Call to action) and screen contents are not in brand.json.
2. **Contrast:** "built in code." is paper on the accent; on mint (#a8d5ba) it is weak.
3. **Fixed colours:** act 3's neon/phosphor greens and the red lock do not follow the brand (they happen to suit a green brand).
4. A light accent makes the particle word and tile wall less punchy; the film needs a per-brand check, not just a swap.

## What was hard
The lens film's built-in checker only proves a target is in frame, not that words are legible: two rebuilds of act 1 and 3 cameras. HyperFrames' rule against a timed wrapper around `<video>`; GSAP baselines on repeated `fromTo`; SVG transform origins (use attribute tweens for a growing rectangle). Fonts must be loaded before canvas text is measured. Each text change in fframes is a Rust rebuild; here that is generated from brand.json, which works but costs minutes.

## What each engine could not do
- fframes: no live editing, fixed palettes, words compiled in, Mac Metal only so far (Linux untested, CPU about 14 times slower).
- Canvas 2D: no selectable text; everything in the film that must stay editable (brand, tagline, UI) is HyperFrames DOM instead.
- HyperFrames: no real depth of field, bloom or perspective of a whole scene; fine for everything else.

## Verdict
The three-engine pipeline works and produces a film none of the three would make alone, and the re-skin proves brand.json can drive it. It is worth productising in parts, not as one pipeline today:
- **Productise now:** Canvas 2D layers + HyperFrames assembly + brand.json (cheap, runs on our worker, editable as parameters and live DOM).
- **Optional premium layer:** fframes acts as cached "lens clips" rendered per brand on a Mac or GPU machine (about 3 min of machine time per brand plus the template), dropped into the HyperFrames film as `<video>` clips. Do not promise this in the cloud until a Linux build is shown.
- **Before any of this ships:** move every string and colour into brand.json (including template copy and the lock colour), add a contrast check on the chosen accent against paper and ink, and add a legibility check on lens text (a minimum on-screen size after zoom), which the fframes crate does not have.
- Open: not watched at playback speed; 9:16 untried; Linux fframes untried; the music was generated once (Lyria, about one 24 s call) and the film uses no other paid service.
