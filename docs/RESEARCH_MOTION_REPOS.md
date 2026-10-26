# Research: Opus 5.5 motion posts and repos (2026-10-09)

Sources read in full: the post https://x.com/0xCarnagee/status/2108242455904813141 and its article https://x.com/0xCarnagee/article/2104586920361590907
("How to build Disney-level motion design studio with Opus 5.5"); the post https://x.com/N01ennn/status/2108182955671580771 (a list of 20 repos) and its
article "How to Turn Opus 5.5 Into a Studio: Motion Design, Harnesses and Loops". Repos read (READMEs, and the SKILL and reference files where the page showed them):
`nateherkai/hyperframes-student-kit` (the `motion-showreel` skill and its two reference files, LICENSE MIT), `Sunwood-ai-labs/hyperframes-motion-reel-skill` (MIT),
`charlie947/motion-graphics-skills` (MIT), `whaleyxbt/claude-motion` (MIT), `AbubakrChan/product-launch-motion` (MIT), `howseen-ai/claude-motion-design` (MIT),
`LottieFiles/motion-design-skill` (MIT, README only). Not read: the other 13 (klik-anim, animate, claude-remotion-skill, motion-graphics, the engines, Lottie, and so on).
We take **ideas, not code**; where something is built here it is our own implementation. Third-party films and brands are studied, never copied.

**Reliability notes.** The post calls the repos "Netflix engineers" and the other "ex. Anthropic designer": neither claim is shown by the pages (the repos belong to
individual authors; one reply asks the same question). The Opus 5.5 / Fable 5.1 numbers in the article are the article's own claims; none of our decisions depends on them.
One commenter's warning applies to us: **over-animation reads as AI-made; less movement tells a cleaner story** (and Anthropic's own design guidance says the same).

## 1. What the sources agree on (and we already do)

Frame = pure function of time (no clocks, no CSS transitions, no unseeded random); one paused timeline; fonts embedded; vendored GSAP; 2-frame wait after a seek;
closed-form springs; log-space camera; masked word reveals; shared-element handoffs; colour floods that clear the farthest corner; subframe motion blur on a 180° shutter;
beat map as the single source for picture and sound; sounds placed by measured peak; loudness -14 LUFS with true peak under -2 dB; check stills before the full render;
`hyperframes check` clean. (Our shared-craft.md, gm-motion-recipes and the showreel engine already carry these.)

## 2. New and useful, by area

### A. The showreel grammar (hyperframes-student-kit `motion-showreel`; the documented reference reel is a 15 s film at 128 BPM)

Eleven rules; the ones we do not yet have are marked **new**:

1. **One motif, transformed.** The brand's most reduced element (dot, triangle, letter) opens the film, becomes each chapter's material, closes as punctuation in the lockup. Almost every transition turns the current object into the next; hard cuts are reserved for the flurry. **new**
2. **Six or seven labelled chapters**, named in the HUD by discipline ("01 · SQUASH & STRETCH"), using the brand's own vocabulary. Our HUD is static text. **new**
3. **Show the work:** each chapter has one tool overlay (physics readout, selection box, parameter panel, bezier graph). We have the selection box in `pill-cycle` only. **new (more overlays)**
4. **Persistent HUD:** crop marks, title, spec line with a blinking dot, timecode, a progress ruler with chapter gaps, chapter label. Mono caps, 0.2em tracking, about 16 px, flips ink/paper with the ground. **partly (we have 4 labels)**
5. **Palette:** ink, paper, one accent, plus **one held-back colour that appears only in the climax**. Each chapter change **flips value or saturation**. We never flip value in the light films; this is the strongest lever against our "quiet seconds". **new**
6. **Cut on the beat** at 120-130 BPM, within 2 frames of a grid line; **one pre-drop gap (music ducked about 13 dB for half a beat) before the mid-film hit: one gap, one hit.** **new (the dip)**
7. **Accelerate, then hold.** 15 s at 129 BPM = 32 beats: intro 4, type chapter 8, three chapters of 4, a flurry of about 6 cuts in 4 beats, lockup 4. About 75% development, 13% flurry, 12% resolve. Our scenes are near-equal length. **new**
8. **Density breathes:** one dot, a wall of type, a grid of 100, thousands of particles, one hero object, the flurry, one word again. Our films stay at a medium density throughout. **new**
9. **Three type voices:** heavy display, a contrasting accent voice (e.g. red italic serif), wide-tracked mono for the machine layer. Type as texture (repeated, banded, inverted). **partly**
10. **Physical finish:** squash and stretch, motion blur, bloom on light-on-dark, slight chromatic fringe, grain, vignette, a dot grid on dark frames. **new (grain, fringe, squash)**
11. **Bookend:** the lockup resolves from noise (blur 20 px to 0 and opacity over 12 frames), a rule draws, subtitles type with a block cursor, the motif lands with a squash, a quiet tagline arrives last. **partly (end-sting has typed wordmark)**

The reference reel's own numbers (for our benchmark C below): 10 hard cuts all within 2 frames of a grid line; chapters of 1.8, 3.5, 2.1, 1.9, 1.9 s then six cuts of 0.2-0.5 s;
luminance alternates dark / paper / dark / saturated / navy / paper / flurry / black (every chapter flips value); the density curve above; music bed about -12 dB RMS with a dip
to about -25 dB at 7.25 s and a hit at 7.50 s; fade out in the last 0.25 s.

Chapter recipes worth adding as modules (ours would be re-skinned to the brand's own objects): **physics** (a dot bounces on the beat, squash to scaleX 1.35 / scaleY 0.7 for 2-3 frames then elastic back, live POS/SCL/VEL readout, exits as a laser into a white flash that becomes the next ground), **letters to dots to grid** (a 16x9 grid with a per-cell wave `phase = t*speed - distance`, circle to square to cross morphs via border-radius and clip-path, a perspective push), **particle system** (2,000-4,000 seeded particles lerping to a ring, a logo sampled from pixels or a number; additive glow), **easing graph** (a drawn bezier with a ball and 8 onion-skin ghosts), **flurry** (6 full-bleed layers cut on beats then half beats, each with one internal move; a glitch with 3 offset RGB copies and 4-6 jittered slices), **lockup** (above).

### B. Process and harness (N01ennn article; claude-motion; howseen; product-launch-motion)

- **Guides and sensors.** Guides steer before (rules file, banned defaults, style guide, shot list, brand folder); sensors check after (computational: smoke test, seam check, beat grid, loudness; inferential: the model reading its own stills). Sensor messages should be written for an LLM to read, with the fix in them. Our gates exist; we should make their messages carry the fix.
- **Counters that must read zero:** runtime errors, error banners, invalid colours, text off the stage, text outside its panel, text overlap. A seam check: frame 0 and the frame one loop later pixel-identical (also on **velocity**, not only position). We have `hyperframes check` and `pop_gate`; we have no loop-seam check (only needed for loop films).
- **"When the same problem shows up twice, do not fix the output, fix the harness."** Every bad render becomes a rule (the banned-defaults list grows). We did exactly this on 2026-10-09 (replacement is one move; nothing visible before its entrance; opaque scene grounds) and recorded it in shared-craft.
- **Maker and checker are separate.** The agent that did the work does not decide it is good; a separate pass verifies. A `/goal`-style loop needs a machine-checkable stop rule, a turn cap, and an abort when a round fixes nothing; subjective goals ("until it looks good") are a bad fit. "Delegate the task, never the taste."
- **Contact sheet with one timestamped tile per timeline beat**, scrub with a time range and a step (claude-motion's `npm run sheet`); approval **4 stills** before the full render; a **540p draft** before the master; "pull one frame every 45 frames"; symptom to fix table. We now review at 5 frames per second per 5-second part; add the beat-tile sheet generated from `plan.json`.
- **Effort levels:** low for storyboarding, medium for building scenes, high for review and polish, xhigh/max only for autonomous end-to-end runs.
- **Brief rules:** describe the mechanism not the vibe; name every state (idle, live, done); give the real material (numbers, list, source text); show a reference and say what not to take (the type and spacing, never the layout, content or characters); ask for the plan before the code; name a reference or medium; **ban the defaults out loud**; give timing numbers ("camera moves 1.5 to 3 s on gentle ease-in-out; half the speed you would default to").
- **Product process (product-launch-motion):** write **three visual directions and discard two** so each film gets its own look; word-level timestamps from the voice so each reveal lands on its word; verify each sound cue is audible in the final mix (a cue at 0.35 and one at 0.85 differed by 0.1 dB: fix the source file, not the gain); watch effect files that open with silence (the cue starts late); hold grain across frames (a 9.3 MB file grew to 67 MB when re-randomised); never `mix-blend-mode` over per-track composites (the film can go white); tone-map before bloom (bloom over a near-white UI blows out); 34 documented traps with reproducing measurements.
- **Remake mode (howseen):** extract every frame of a reference, detect cuts, write a shot-by-shot spec, rebuild on a shared `seek(F)` engine, compare with side-by-side and stacked sync sheets; audio: find the real drop by band energy, do not trust an automatic beat grid, start the track so the drop lands on the key frame.
- **Brand intake (charlie947, student kit):** one `brand.md` / `MOTION.md` (colours, type, timing, motion rules) read first by every skill; exact colours from the current logo file; a signed-off list of facts (every name, date and number on screen comes from it); logos and screenshots only from the user's files, never redrawn from memory; confirm before paid generation.

### C. Rules from one source that conflict with our benchmarks (decision recorded)

- charlie947 bans **typewriter text, glow and gradients on text**, and purple-to-blue backgrounds by default. Both of our benchmarks (A and B) type text and use blue accents. **Decision:** we follow the benchmarks for typing (the product's own action) and keep glow off calm and premium; the "banned defaults" become a per-personality list (calm and premium ban bursts, glows, bounce; bold and playful allow them).
- Carnage's UI-morph template bans **bouncy easing, particle bursts, glows, gradients on UI chrome**; that is one style (a Dribbble-level UI film), not a general rule. Same decision: per-personality.
- charlie947 sets motion **on twos** (a pose held 2 frames at 24 fps) for a hand-made feel: a style option for hand-drawn films only, not for product showreels.

### D. Technical rules for HyperFrames builds (motion-showreel and product-launch-motion)

Tween only transforms and opacity, **never left/top/width/height** (our `pill-cycle` tweens `width`: change it to a clip or scale); compute shared flashes and invert swaps in the per-frame driver because tweens can stick on backward seeks; measure layout once at the top, never inside `onUpdate`; staggered phases must finish before their cut (start + max delay + duration); avoid `background-clip: text` (invisible in capture); videos go in an untimed wrapper, not a timed clip; morph shapes by scaling a drawn tile into a circle (`border-radius: 128px / 72px` on 256x144); `b(n) = n * PERIOD` for all timing; CFG object mirrored to root `data-*`; seeded values only.
Motion numbers (claude-motion): entrances `cubic-bezier(0.16, 1, 0.3, 1)`, **exits take half the entrance duration**, words stagger **0.09 s**; kinetic letters stagger y -120 to 0 with `back.out(2)` in shuffled order with 1-frame offsets; fake motion blur = blur 6 px to 0 with a scaleY stretch.

### E. Sound

Code-generated sound kits (kick, hat, impact, riser, sub, typing, click, pop, whoosh, chime, pads) as WAV with only standard libraries (claude-motion in Python; the Sunwood reel in Node): a **free fallback to paid Lyria and to our sample files**. A cue sheet is one function reading beat times from the shared timeline. Master to -14 LUFS (one source targets -1.2 dBTP; ours is under -2.2 dB, which is safer for AAC). Splice the music to a 32-beat structure: intro/build 16 ending on the drop downbeat, drop 8, break 4, return hit plus tail; re-measure the kick phase (within about 25 ms of 0).

### F. New film types and resources

- **One-shape UI morph film** (the 956K-view template): one shape never cut, morphing through 8-12 UI states (button, loader, player, slider, toggle, tabs, chart, command palette, toast), a cursor drives every change with real clicks and drags, 120 BPM and 7 bars with something on every beat, **the last frame equals the first so it loops**, springs only, drags as direct manipulation (the value follows the cursor while held; springs back on release); tab indicator edges ride different springs so the leading edge stretches. This is a different film type from the showreel and a strong **loop** product. Not built.
- Libraries: `X-RayLuan/awesome-opus-5-5-video-prompts` (48 examples; a local copy is in `experiments/awesome-opus5-5-videos`), `jacobbubu/claude-opus-5-5-js-animation-research` (30 cases ranked by views, with methods), `anthropics/skills` (algorithmic-art for p5.js), `hyperframes-student-kit` (406 draft motion cards in two styles, `registry.json`; MIT, a candidate to mine for module ideas), `frankxai/awesome-motion-design-agent-skills` (map of GSAP, Remotion, Lottie and Rive skills).
- Engines: HyperFrames (ours), Remotion (free up to 3 people, then a paid licence; we do not use it), Three.js, Blender Python, p5.js + p5.brush. Our routing by format stays as decided in `motion-engines-plan`.

## 3. What this changes for the showreel library (decisions)

| # | Change | Why | Where |
|---|---|---|---|
| 1 | **Value flip at every chapter change** (ink/paper, or saturation) on every personality that allows it; calm flips between two tints, not black | the main reason light films read quiet; also a rhythm tool | `core/build.js` per-scene ground, personalities |
| 2 | **Accelerate, then hold:** scene lengths fall through the film (75% development, 13% flurry, 12% resolve), a flurry of 4-6 short cuts before the end for bold and playful | benchmarks A, B and C all do it; ours is flat | `compose.mjs` allocation |
| 3 | **Density breathes:** each module declares a density (1 object, a wall, a field); the planner alternates sparse and dense | ours stays medium | `catalogue.mjs` + planner |
| 4 | **Second beat in every hold** (a tool overlay, a readout, a highlight, a cursor action) | "no dead space", and the metric | each module |
| 5 | **Chapter HUD:** scene tag, a progress ruler with chapter gaps, a blinking dot, live timecode, flipping ink | benchmark A and C | `core/layers.js` |
| 6 | **One motif** chosen from the brand mark; the planner passes it to every module that can use it | story, and unique-per-brand | `copy.mjs`, modules |
| 7 | **Pre-drop dip and a one-gap-one-hit music rule**; music spliced to the beat structure | the drop is the climax | `sound.mjs`, `music.mjs` |
| 8 | **Physical finish pack** (grain held across frames, vignette, chromatic fringe on hits, squash on landings) as personality options | bold, premium | `engine.css`, modules |
| 9 | **New modules:** physics, letters-to-grid, particle-ring, easing-graph, flurry, noise-resolve lockup, shape-morph loop | benchmark C chapters | `scenes/` |
| 10 | **Per-personality banned lists** enforced in `personalities.mjs` (e.g. calm bans burst, glow, bounce) | the over-animation warning | planner |
| 11 | **Harness additions:** beat-tile contact sheet from `plan.json`; a cut-on-beat gate (offsets within 35 ms); a stills approval step before the full render; messages with the fix; counters that must read zero | N01ennn, claude-motion, motion-showreel | `scripts/`, `experiments/showreel-modular/` |
| 12 | **Product flow:** brand intake file, a facts list the user approves, three directions (two discarded), storyboard approval, then build | product-launch-motion, charlie947 | backend and director plan |
| 13 | Replace the `width` tween in `pill-cycle` with a clip or scale | transforms-only rule | `scenes/pill-cycle.js` |
| 14 | Code-generated sound kit as a free fallback | cost; independence from samples | new `worker/templates/showreel/sfx-kit.mjs` |

Items 1-4 are the ones that address the calm and explainer films' failing pacing gates; see SHOWREEL_MODULES.md ("Open problems").

## 4. Addendum: "tracking camera" shader film (neogoose_btw post, 2026-10-09)

Sources: https://x.com/neogoose_btw/status/2108352673951219940 (Dmitriy Kovalenko, author of fframes, a Rust video framework) and the repo it ends up pointing to, `mrsarac/ff-tracking` (MIT, code only; JetBrains Mono under OFL). The post itself says "recreated this visual style using shaders, open-sourcing it" but links nothing; a later reply admits the PR was never posted and points to ff-tracking as the better recreation. The visual style belongs to Michael Nowak (@mnowakdesign, https://x.com/mnowakdesign/status/2108253918086176899; the page is login-gated, I only saw one still: a grey lens-blurred glyph with `x: 664 y: 451`-style coordinate labels, hatched tracker boxes and linking lines). Not read: the fframes framework itself, `docs/PROMPT.md` in the repo. Stats are tiny (4 stars), so treat it as a recipe, not a standard.

**What it is:** a 6 s, 12-shot film (a cut every 0.5 s) of a virtual camera filming an AI agent's terminal while a tracker box locks onto each new glyph. Every pixel and sound is generated by code.

**Techniques worth keeping (idea level only, none of it is ours yet):**
- **Two-pass render:** pass 1 draws the flat design (SVG, 4K, one element per glyph so positions are exact); pass 2 treats that frame as a texture and applies a "lens" shader. Same idea as our camera div, but with a real lens.
- **Lens stack:** perspective by per-pixel ray cast on a tilted plane; depth of field from a circle of confusion with golden-angle taps and bokeh-weighted highlights, focus racking to the tracked target; chromatic aberration that grows on a lock; bloom; LED-grid stripes; row-tear plus grain after cuts and locks.
- **Tracker HUD:** boxes carry real pixel coordinates, links run box to box in reading order with a dot travelling along each link, the focal plane follows the tracked box, a lock = two red frames + a scanline tear + a panned beep. One data file (`hud`) feeds the visuals AND the audio, so they cannot drift apart.
- **Palette per shot:** 7 palettes (Paper, Thermal, Mono, Phosphor, Amber, Navy, Neon) cycled every cut. This is the value-flip idea (row 1 above) taken to its limit: the colour change IS the rhythm.
- **Collapse ending:** 14 boxes collapse into one, which becomes a `Done` pill, then fade to black (a "many to one" resolve we have no module for).
- **Sound kit from code** (`tools/sfx.py`): hum, bit-crushed glitch per cut, click per keystroke, pentatonic beep per lock panned to the box, riser into the collapse, chime + sub on `Done`; normalised to -14 LUFS. Confirms row 14.
- **Process:** made with Claude Code from one prompt (kept in the repo), design spec and decisions in `docs/`, unit tests that check text fits and the camera keeps targets in frame (a checker separate from the maker, as in section 2B), contact-sheet and single-frame CLI commands.

**What can and cannot transfer to us:**
- The shader stack needs Skia/SkSL on Rust + Metal. HyperFrames renders HTML/GSAP in headless Chrome inside our Docker worker, so none of the code runs there. The HTML equivalents are: CSS `perspective`/`rotate3d`, SVG `feTurbulence`/`feDisplacementMap` for tear, `filter: blur()` for focus pull, offset RGB duplicate layers with `mix-blend-mode: screen` for chromatic fringe, a WebGL canvas (seek-safe if driven from the timeline time, never the clock) for true DoF. WebGL is the only route to the real lens; it is a spike, not a given.
- Costly per frame and hard to keep seek-safe, so it fits a `tracking-lens` hero/scene module (a dev-tool or AI-agent product demo), not the default engine.
- Licence: MIT code, but the look is Nowak's style; we take the grammar (tracker boxes, coordinates, lock beat), not his footage, and credit nothing as ours.

**New entries for the change table (section 3):**

| # | Change | Why | Where |
|---|---|---|---|
| 15 | **`tracker-hud` module:** boxes with live coordinate labels, links with travelling dots, a lock beat (2 red frames + tear + panned tick), box-collapse into a pill; for agent/dev-tool products | strongest "AI agent" visual we have seen; fits explainer/bold | new `scenes/tracker-hud.js`, `sound.mjs` |
| 16 | **Single source for visuals and audio:** every hit (lock, cut) in `plan.json` drives both the animation and the sfx cue, which we already do for scene boundaries; extend to in-scene hits | zero drift, supports the cut-on-beat gate (row 11) | `compose.mjs`, `sound.mjs` |
| 17 | **Per-shot palette cycle as a flurry style** (0.5 s cuts, a new palette per cut) | rhythm from colour alone; cheap in HTML | `flurry` module (row 9) |
| 18 | **Spike: WebGL lens pass** (DoF + chromatic + tear) driven by timeline time inside a HyperFrames clip; decide after measuring render time and seek-safety | only if the CSS/SVG approximations look flat | `experiments/` |
| 19 | **Unit-test style checker** that fails when text does not fit or a target leaves the frame, run before render | maker/checker split; faster than rendering | `scripts/` |

**Spike result (same day):** fframes and ff-tracking were built and run; see docs/FFRAMES_SPIKE.md. Short version: works on Mac Metal (43 s for the lens pass), works on CPU but ~14x slower, drops into a HyperFrames composition as a `<video>` clip; Linux in our worker image was not tested. Verdict: offline asset producer for one film type plus porting the grammar (rows 15-19).
