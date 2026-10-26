# Showreel modules: one library, a different film every time

Code: `worker/templates/showreel/`. Demo and proof: `experiments/showreel-modular/`. Targets: [BENCHMARKS.md](BENCHMARKS.md) and
[BENCHMARK_FRAME_ANALYSIS.md](BENCHMARK_FRAME_ANALYSIS.md). Research behind the personalities: [MOTION_PERSONALITIES.md](MOTION_PERSONALITIES.md).

The idea: a film is not a template with the words swapped. It is **chosen from parts**. A brand's colours, its personality (bold, calm,
explainer, playful, premium), its facts and a seed decide the palette, the type, the tempo, which scenes, in what order, joined by which
transitions, with which sounds. The same brand with another seed is another film; two brands with different personalities look unrelated.
Everything is a pure function of its inputs (no clock, no random), so a film can be re-planned, re-rendered, and explained.

## The parts (all reusable on their own)

```
worker/templates/showreel/
  compose.mjs        the planner: composeShowreel(input) -> plan; writeShowreelProject(dir, film, assets)
  personalities.mjs  feel -> numbers (ground, BPM, scene count/length, easing, spring, fonts, pools, transitions, sfx level, music prompt)
  catalogue.mjs      every scene module: length, needed facts, role, which benchmark it comes from; the transition list
  copy.mjs           defaults for every field a module may ask for (never invents a product claim)
  sound.mjs          sound plan derived from the scene plan (effect placed so its peak lands on the event)
  palette.mjs        brand colours -> a complete palette (WCAG-safe text/ground pairs) for a dark or light ground
  lib.mjs            seeded random, weighted pick, beat and frame snapping
  bundle.mjs         joins the in-page engine from only the parts a film uses
  engine.css         all styling, driven by CSS variables (nothing in it is a brand value)
  core/              runtime.js (helpers, faux product screens, registries), layers.js (background, frame, HUD), build.js (scenes, cameras, transitions)
  scenes/<name>.js   one file per scene module: S["name"] = (c) => { ...adds DOM and tweens... }
  transitions/<n>.js one file per transition: TR["name"] = (outgoing, incoming, t, d) => {...}
```

A module only touches `c` (its container, id, duration `D`, `at(r)` to place a time, variant `v`, `sfx()`), the plan (`brand`, `product`, `pal`, `P`),
and the shared helpers. That is why it can be lifted into another film: copy `scenes/<name>.js` into any engine bundle, or call `bundleEngine({scenes, transitions})`
for a custom set.

## Scene modules

| Module | Role | Needs | From | What it shows |
|---|---|---|---|---|
| hook-type | open | prompt | both benchmarks | a request typed into a composer, send pressed |
| hook-kinetic | open | hook | craft | two big kinetic lines from a mask, an underline draws |
| pill-cycle | open | cycle | A 0-2.8 s | a selected pill cycles words fast and lands on the claim |
| app-fill | mid | rows, stat | B | the window fills up, statuses flip, a counter |
| field-3d | mid | icons | B 9.4-11.2 s | tilted field of screens and icons, camera glide |
| wall-zoom | mid | - | A 5.6-7.2 s | land on one card, pull back to a wall |
| lines-stack | mid | lines | craft | big lines in turn, the last pushes |
| lines-climb | mid | climb | B 11.4-12.8 s | lines that grow, each dims the last, optional proof badges |
| stat-hero | mid | stat | craft | one giant number counting up |
| trio-cards | mid | features | craft | three cards, each takes a turn to lift |
| hub-orbit | mid | features | A 7.6-9.2 s | the product at the centre, features on a turning ring |
| split-compare | mid | before, after | craft | a divider wipes from before to after |
| chat-demo | mid | chat | A 3-5 s | ask, answer types, action chip |
| step-path | mid | steps | explainer | numbered steps on a drawn path, a cursor travels |
| rapid-fire | mid | rapid | B 6.6-9.4 s | one layout, a new tilted card every beat, hard cuts |
| reskin-proof | mid | reskin | A 9.4-11.8 s | one window re-skinned 3-4 times, accent words follow |
| end-burst | end | - | A 12-15 s | flood, shards, mark, name, tagline, URL pill |
| end-sting | end | - | B 13-15 s | dip to black, rings, mark pop, typed wordmark, URL pill |
| end-calm | end | - | calm research | bloom, mark, name, tagline, soft URL |
| end-cta | end | recap, cta | explainer | recap ticks, button, logo line |

Transitions: cut, whip-x, whip-y, push, iris, zoom-through, flood, cover-wipe.

Every scene lives in its **own camera** (core/build.js): a slow seeded push-in or pull-out over its whole length, so no hold is a still image.
Every personality sets how strong that drift is.

## Motion rules the engine enforces (found by reading renders at 5 frames per second)

1. **Replacement is one move.** A new word, line, card or scene replaces the old one in the same move: same direction, same easing, same start, offset by more than the clipping box
   (pill-cycle is a reel: a new word pushes the old one up; rapid-fire cards and headlines leave and enter together; lines-stack lines push each other). Two words never share a pixel.
   Small labels (kickers) fade in only after the old words have gone.
2. **Every scene carries its own opaque ground**, so an incoming scene covers the outgoing one. (A transparent scene layer showed the previous scene's words through the next one.)
   The frame and HUD live in one overlay above all scenes.
3. **Whips use the same easing on both sides**, so the two panels stay exactly one frame apart; zoom-through puts the outgoing scene on top and fades it as it rushes at the camera.
4. **Nothing waits visible at its end state.** Entrance tweens only set their start state when they start; `core/build.js` therefore records every `fromTo` and applies each element's earliest
   start state at time 0. Without it, every element showed for a moment, then jumped back and animated in.
5. **Satellites and shards never cross text.** Hub satellites arrive from outside the ring; burst shards sit behind the wordmark; a text line over a busy wall gets a ground under it.

Review method: `ffmpeg -ss S -t 5 -i film.mp4 -vf "fps=5,scale=400:-1,tile=5x5" sheet.png` for each 5-second part, then read every frame of every swap.

## Personalities

| | bold | calm | explainer | playful | premium |
|---|---|---|---|---|---|
| Ground | dark, deep | light, soft | light | light | dark |
| BPM / scenes | 120 / 7-9 | 90 / 6-7 | 100 / 6-8 | 120 / 6-8 | 90 / 5-6 |
| Easing | power4 snaps | sine, gentle | power3 clear | back overshoot | sine slow |
| Transitions | whips, zoom-through, flood | push, iris | push, whip-x, iris | iris, flood, whip-y | push, iris |
| Background | glow + grid, HUD | soft gradient, frame | dots, frame, HUD | dots | soft gradient, frame |
| Ending | burst / sting (flood) | calm | CTA / calm | burst | calm / sting |

`inferPersonality({brand, hint, purpose})` picks one if the caller does not: an explicit word in the brief wins ("explainer", "calm", "bold"...),
then the purpose, then the brand colour (a pale low-saturation colour reads calm, very dark reads premium, a vivid mid colour reads playful, else bold).
Always overridable with `personality: "..."`.

## Brand colours

`palette.mjs` turns `{primary, accent?}` into the whole palette for the chosen ground: accent and second accent (an analogous neighbour when none is given),
panel, line, text and muted text, ink on the accent, a soft tint, and the end card's colours. Every text/ground pair is nudged until it reads (WCAG 4.5:1 body,
3:1 large), so a very pale or very dark brand colour is adjusted, never trusted. Fonts come from the personality's pair (all in `worker/fonts`).

## Make a film

```js
import { composeShowreel, writeShowreelProject } from "worker/templates/showreel/compose.mjs";
const film = composeShowreel({
  brand: { name: "Lumen", tagline: "Rest, made simple.", url: "lumen.app", primary: "#a8d5ba", accent: "#e8b4a0" },
  product: { features: [{ title, detail }, ...3], stat: { n: 40, suffix: "%", label, kicker }, /* anything else is optional */ },
  hint: "calm", seed: 5, seconds: 15
});
await writeShowreelProject(dir, film, { fontsDir: "worker/fonts", sfxDir, musicFile }); // then: hyperframes check, render
```

Demo: `node experiments/showreel-modular/demo.mjs all` builds three projects; `sh experiments/showreel-modular/render.sh bold` renders one in the worker image
(2 CPUs, 4 GB, as in production) and masters the audio. Music: `node --env-file=backend/.env experiments/showreel-modular/music.mjs calm` (paid Lyria),
`beat.mjs` finds the beat phase so the first beat is at 0:00; use BPMs with whole-frame beats at 30 fps (90, 100, 120).

Uniqueness: `node experiments/showreel-modular/unique.mjs bold 40` plans 40 seeds for one brand: 40 different scene-and-transition sequences, and on average
only 21-32% of the scenes sit in the same slot in two films.

## Add a scene module (checklist)

1. `scenes/<name>.js`: `S["name"] = (c) => {...}`. Every animated property in both the from and the to, baseline with `baseline(...)`, springs via `SP`, no random (use `c.rng`),
   z-index on layers, `data-layout-allow-*` via `allow()`/`decor()` where overlap is intended. Mark a hold with motion in it (a highlight, a draw, a counter), never a still.
2. A row in `catalogue.mjs` (length range, needed facts, role, which benchmark moment it answers).
3. Weights in the pools of the personalities that should use it (`personalities.mjs`), copy defaults in `copy.mjs`, sounds in `sound.mjs`, styles in `engine.css`.
4. `node experiments/showreel-modular/demo.mjs all`, then `hyperframes check`, then render and run `node scripts/benchmark-metrics.mjs`. Compare with the benchmark moment it comes from.

## Gates a film must pass (from the benchmarks)

`hyperframes check` clean; `scripts/benchmark-metrics.mjs`: mean motion 0.015-0.035, one hard-hit event at most, at most three quiet seconds; audio about -14 LUFS with the peak below -2 dB;
every beat boundary on the 30 fps grid; scene lengths and scene counts in the personality's range (bold 7-9 scenes, calm 6-7 ...).

## First results (2026-10-09, rendered in the worker image)

| Film | Personality | Scenes | Mean motion | Quiet seconds (<0.008) | Hard hits | Audio |
|---|---|---|---|---|---|---|
| Kinetic | bold, 120 BPM, dark orange | 7 | 0.024 (in 0.015-0.035) | 2 (ok) | 1 event (12.5 s) | -13.7 dB mean, peak -2.3 |
| Lumen | calm, 90 BPM, light sage/blush | 7 | 0.011 (**below**) | 8 (**fails, limit 3**) | none | -12.9 dB, peak -2.6 |
| Tidyflow | explainer, 100 BPM, light blue | 7 | 0.010 (**below**) | 7 (**fails**) | none | -16.8 dB, peak -2.6 |

Bold meets the benchmark envelope. The two light films look right (palette, type, modules, transitions) but still have static holds: the motion metric
reads low-contrast light scenes as quiet, and our light modules put their events early and then hold. Next work: more secondary events per scene (a second beat in every hold),
bigger blurred transitions on light grounds (benchmark A reaches 0.027 on a light ground with blur-based moves), and a rapid-fire-style cut rate for explainer.

## Open problems (2026-10-09): the films still need improvement

Measured on the third render of each film (rendered in the worker image, judged at 5 frames per second per 5-second part):

| Film | Mean motion (target 0.015-0.035) | Quiet seconds (limit 3) | What is wrong |
|---|---|---|---|
| Kinetic (bold) | 0.024 ok | 2 ok | 3 s in the middle is the weakest (wall-zoom and hub-orbit holds); hub satellites are small; the end card is strong. Needs a flurry before the end and a density breath |
| Lumen (calm) | 0.011 **below** | 8 **fails** | trio-cards, app-fill and hub-orbit hold 2-3 s with one entrance and then almost nothing; light low-contrast scenes read as quiet; no value flip between chapters; end card static for 2 s |
| Tidyflow (explainer) | 0.010 **below** | 7 **fails** | chat-demo, split-compare, trio-cards: entrance then still; every scene has the same density; rapid-fire is the only scene with a cut rhythm |

Specific defects seen at 5 fps (all other overlap and pre-entrance defects were fixed, see "Motion rules"):
- Light films never change value between scenes, so the eye gets no chapter rhythm; benchmarks A, B and the documented reel C all flip value at every chapter change.
- Scene lengths are near-equal; the benchmarks accelerate (A: 2.8, 2.8, 1.6, 1.8, 2.4 s; B: 12 scenes, 5 under 1 s; C: 1.8, 3.5, 2.1, 1.9, 1.9 then six cuts of 0.2-0.5 s).
- Holds repeat one density; the benchmarks alternate one object, a wall, a field.
- `pill-cycle` tweens `width` (the transforms-only rule); `wall-zoom` text needs the ground (added) but the wall itself is sparse at the bottom.
- The calm and explainer end cards are quiet by design but static for the last 2 s (benchmarks end calm at 0.001-0.008, so this is acceptable only if the previous 1.5 s is busy).
- Not watched at playback speed: judged from contact sheets and metrics.

Plan (from docs/RESEARCH_MOTION_REPOS.md section 3): (1) value flip per chapter; (2) accelerate-then-hold allocation with a flurry for bold and playful; (3) density per module, alternating; (4) a second beat in every hold;
(5) chapter HUD with a progress ruler; (6) one brand motif carried through the film; (7) pre-drop dip and music spliced to the beat structure; (8) physical finish pack; (9) new modules (physics, letters-to-grid, particle ring, easing graph, flurry, noise-resolve lockup, shape-morph loop);
(10) per-personality banned lists; (11) harness: beat-tile contact sheet, cut-on-beat gate, stills approval; (12) product flow (brand intake, facts list, three directions, storyboard approval).
Acceptance for a personality is the benchmark envelope for its speed class: mean motion 0.015-0.035, at most 3 quiet seconds, at most one hard-hit event, every cut within 35 ms of a beat, and a clean 5 fps read of every swap.

See [SHOWREEL_IMPROVEMENTS.md](SHOWREEL_IMPROVEMENTS.md) for the open problems in priority order and [MOTION_RESEARCH_2026-10.md](MOTION_RESEARCH_2026-10.md) for what was taken from outside sources.

## Not done yet

Vertical 9:16 (safe zones: top 14%, bottom 35%, sides 6%); the backend and worker routes that call the planner; real product screenshots through `product.screens`
(supported by the engine, untested end to end); a directional (not isotropic) blur on whips; per-module sound mixing beyond the shared kit.
