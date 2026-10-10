# Benchmark videos: the quality we are targeting

> Frame-by-frame detail (5 frames per second, in 5-second parts, with the module gap list): [BENCHMARK_FRAME_ANALYSIS.md](BENCHMARK_FRAME_ANALYSIS.md).

Written 2026-10-09. These two 15-second product showreels are the bar for every Greedy Motion product film that is not hand-drawn. Both were
made by one prompt to Claude Opus 5.5 for the same product (TypingMind, a third-party product: **we study them, we never copy their copy,
screens or marks**). Measurements are ours, taken from the posted videos by sampling frames in the browser; the metrics script is
`scripts/benchmark-metrics.mjs` and reproduces the numbers for any MP4.

| | Benchmark A (Ann Nguyen) | Benchmark B (Tony Dinh) | Ours, showreel v2 (Ledgerly) |
|---|---|---|---|
| Post | https://x.com/ann_nnng/status/2103723183899852885 | https://x.com/tdinh_me/status/2103705600542601511 | `experiments/showreel-test/` |
| Size, length | 1920x1080 as served (earlier note said 1280x720), 15 s | 640x360 (posted copy), 15 s | 1920x1080, 15 s |
| Look | **Light**: pale lavender-white (#eef1f6 average), blue accent, dotted grid, rounded app frame, tiny mono HUD labels in the corners | **Dark**: deep navy (#0a132d to #12203a), white type with one blue accent word, soft star-field texture, perspective camera | Dark green-black, amber accent, grid, glow |
| Prompt | "Make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are. The content should focus on [your product]. You should visit the pages first to learn about the product, then write the video content yourself." (8.3K likes on the reply) | "...like it's your showreel for a résumé. go all out... Use actual product screenshot/logo/assets. Must have music and motion must match the music. Do it like a real professional production video, not like a demo or prototype." | |
| Mean motion (0..1, 10 samples/s) | **0.027** | **0.020** | **0.023** |
| Motion per second | 0.012 0.022 0.023 0.005 0.017 0.029 0.022 0.051 0.036 0.026 0.007 0.025 **0.113** 0.018 0.008 | 0.002 0.009 0.018 0.023 0.020 0.024 0.016 0.014 0.019 0.034 0.033 0.036 0.011 0.036 0.001 | 0.007 0.014 0.009 0.030 0.041 0.026 0.028 0.014 0.014 0.012 0.003 0.012 **0.122** 0.006 0.001 |
| Hard hit (>0.2 in one sample) | one: **12.0-12.2 s** (0.34), the shard burst | none; strongest peaks 0.14 at 11.3 s and 13.1 s | one: 12.0 s (0.58) |
| Strong peaks (>0.06) | 5.7-6.0, 7.2-7.7, 11.8-12.2, 12.6 | 5.7, 9.4, 11.3, 13.1 | 3.7, 5.5, 12.0 |

**Reading the numbers.** A benchmark film has steady, moderate motion in every second (0.01-0.04), an energy build to the middle (A: 0.05 at 7 s;
B: 0.03-0.04 at 9-11 s), **one** deliberate climax, and a calm last second. The hard cuts are few: both spend almost every transition
as a continuous camera or layout move, not as a cut. Our v2 sits inside that envelope; what it lacks is not energy, it is density and variety (below).

## Benchmark A: "light, layered, systematic" (Ann Nguyen)

Persistent frame: the app is shown inside a rounded window on a pale dotted ground; corner HUD micro-labels (tiny mono text) stay on all film long, which makes
every scene feel like part of one machine.

| Time | What is on screen | Technique |
|---|---|---|
| 0.0-1.5 | "Chat with" + a selected word with design-tool selection handles; the word is swapped ("Claude" → **every model.** in a blue pill) | Typography as a live text-edit: the selection box and size label are part of the animation. Words change inside a pill that resizes |
| 3.0-4.5 | A composer pill with model chips (GPT-5, Claude, Gemini); a line is typed ("Plan ou…") | Typing with a caret; chips pop in with spring settle |
| 4.8-5.5 | "Ask them all at once." with a blue "Plan our product launch" button; three answer cards type their replies in parallel (GPT-5, Claude, Gemini) | Parallel typing in three cards; one composer under them. Real product UI, simplified |
| 5.7-6.0 | The three cards **zoom out** to a wall of department cards (Engineering, Sales, Support, Design, Operations, Product, Data, Leadership), each with a colour dot | Camera pull-back reveals scale: from one idea to many. Cards are the same component with different content |
| 7.2-7.7 | "TypingMind Teams" centred; about a dozen small cards (colour tiles, a dark card, a stat card "5,000+") orbit and scatter around it | Exploded-view hub: the product is the centre, features are satellites. Peak at 7.6 s |
| 8.5-11.5 | "Your brand. Your domain. Your data." with a branded app window re-skinned twice ("Acme AI" in orange, "Orbit Assist" in green) | Re-skin morph: the same window changes brand colour and name, proof of white-labelling by showing it |
| 11.8-12.2 | **Shard burst**: dozens of triangles in muted warm colours fly out of a dark gradient inside the rounded frame; grain over everything | The one hard hit (0.34). The frame goes from light to dark here: the light film resolves into a dark end card |
| 12.6-15.0 | Dark gradient end card: logo mark (a brain glyph), "TypingMind" in white with a blue accent, a one-line promise, two URL pills | Brand lockup with the product's own mark; calm last second (0.008) |

Craft traits to carry over: one persistent frame and HUD, one component reused in many contexts, text that is edited on screen instead of faded, a camera
pull-back that reveals scale, an orbit hub scene, a re-skin proof scene, one burst, one dark resolve.

## Benchmark B: "dark, cinematic, perspective" (Tony Dinh)

| Time | What is on screen | Technique |
|---|---|---|
| 0.0-1.5 | A composer bar on a deep navy ground; "Write a tiny" typed, then "Write a launch tagline for TypingMind" with a blue Send button | Typed request is the hook: the viewer's first action is the product's own action |
| 3.0 | The real app window floats in perspective, centred, with four AI-provider marks drifting around it | Camera lifts from the composer into the product; brand marks as satellites |
| 4.5 | Three chat panes side by side with answers; big white "One prompt." bottom-left under a small label "MULTI-MODEL CHAT" | Small mono kicker + big headline: a hierarchy that appears on every text scene |
| 6.0 | "All your AI models. **In one place.**" with the model picker dropdown tilted on the right (search box, a list of models) | Tilted 3D UI card as the hero; headline with a blue accent half |
| 8.0 | "Plugins" kicker "AND PLUGINS OR BUILD YOUR OWN" and a grid of plugin cards in perspective | Perspective grid as texture; text rises from a mask |
| 9.4-10.0 | Many windows stacked in a steep perspective field; "The AI client **you actually own.**" | Peak at 9.4: the camera dives into a field of screens (3D) |
| 11.3-12.0 | Empty navy with the star-field texture: "No subscription." then "Pay once." | The calm line: a still, short, pure-text beat after the busy field, then a hard peak (0.14) to cut |
| 13.1-15.0 | End card: the product mark (rounded app icon), "TypingMind" in white with a blue accent, "The best frontend for LLMs", a URL pill | Calm resolve (0.001 in the last second) |

Craft traits to carry over: perspective camera over real UI, kicker + headline hierarchy, one blue accent word, a text-only breath before the end,
fewer but heavier hits, very consistent dark palette (navy + one blue).

## Benchmark C (documented, not frame-analysed by us): the 15 s "Motion Reel" at 128 BPM

Source: the reference breakdown shipped in `nateherkai/hyperframes-student-kit` (`motion-showreel/references/reference-breakdown.md`, MIT), described in docs/RESEARCH_MOTION_REPOS.md.
We did not capture its frames; its numbers are the repo author's measurements. It is a **brand showreel of craft chapters**, not a product film, so it is the bar for rhythm and grammar, not for product UI.

| Shot | Time (s) | Length | What | Out |
|---|---|---|---|---|
| 1 | 0.00-1.78 | 1.78 | a dot bounces on a tick ruler, squash and stretch, live POS/SCL/VEL readout | dot becomes a laser, white flash, next paper |
| 2 | 1.78-5.30 | 3.52 | kinetic type with a selection box, repeated into a wallpaper, invert at 4.23 | wallpaper bands, invert to black on the beat |
| 3 | 5.30-7.40 | 2.10 | dot row to a full-frame grid, a red wave, shape morphs, camera push | grid tunnels into a lens iris |
| 4 | 7.40-9.30 | 1.90 | iris flash (the drop at 7.50), particle swirl, condenses to a ring | ring solidifies into a chrome torus |
| 5 | 9.30-11.25 | 1.95 | chrome torus morphs to a cube, readout counts up | push into a lens, hard cut |
| 6-11 | 11.25-13.13 | six cuts, 0.2-0.5 s each | easing graph, op art, glitch, isometric blocks, kaleidoscope, pixel noise | noise resolves to the wordmark |
| 12 | 13.13-15.06 | 1.93 | wordmark blooms from noise, a rule draws, mono lines type with a block cursor, the dot lands as the period, a quiet tagline | hold |

Measured by the author: 10 hard cuts, every one within 2 frames of a grid line; luminance alternates dark, paper, dark, saturated, navy, paper, flurry, black (every chapter flips value);
density curve one dot, one word, a wall of words, a grid of 100, thousands of particles, one object, a flurry, one word; about 75% development, 13% flurry, 12% resolve; music bed about -12 dB RMS,
a dip to about -25 dB at 7.25 s and a hit at 7.50 s. What it adds to our bar: **a value flip at every chapter, accelerating lengths ending in a flurry, alternating density, one motif, one pre-drop gap and one hit.**

## What both share (the bar)

1. **A hook in the first second that is the product's own action** (typing into the composer), no logo first.
2. **Seven to nine scenes in 15 s, none the same composition twice**: typed hook, UI close-up, feature in context, scale reveal (wall/field), product hub, brand/proof, end card.
3. **Real product UI is the visual** (dense screens, real labels), never abstract blobs. Text lines are short (2-5 words), one accent word in the brand colour.
4. **Movement is continuous**: a camera or layout move in every second; transitions are the camera still moving, not cuts. Average motion 0.02-0.03; no second flat except the first and the last.
5. **One climax, then calm**: one hard hit near 12 s, then a quiet brand lockup with a URL pill.
6. **Music-driven** (the briefs demand it): cuts and hits on beats; ours uses a 120 BPM track with a breath before the drop.
7. **A persistent visual system**: one palette (a dominant, one accent), one type family for headlines, one UI component language, a texture (dots, grain, stars).

## Where we stand against them (honest)

| Trait | Benchmarks | Ours (v2) | Gap |
|---|---|---|---|
| Screen density and realism | Real, dense, many different components | Simple HTML mock-ups, 4 kinds | Larger UI kit; real screenshots when supplied |
| Scene variety | 7-9 distinct compositions | 6 | Add stat, hub/orbit, re-skin proof, split compare, step path, chat |
| Persistent frame / HUD / texture | Yes (A: HUD + dots; B: stars) | Grid only | Add a frame + HUD module |
| Text as UI | Selection handles, pill swaps, kickers | Plain rising lines | Add kicker + text-edit treatments |
| Camera | Perspective dives, orbit | One tilted plane | Add orbit hub, dive-through |
| End | Brand mark + promise + URL pill(s) | Same idea, one burst | Parity once the modules above exist |

The measurable gates for a new film: `node scripts/benchmark-metrics.mjs <mp4>` reports mean motion within **0.015-0.035**, **at most one hard hit**, **at most three quiet seconds** (the
first, the last and one breath), and the existing gates (`pop_gate.mjs`, `pacing_gate.py`, `seam_sheet.mjs`) pass.
