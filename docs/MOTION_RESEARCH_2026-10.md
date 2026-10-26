# Motion research, October 2026: what two X posts and their sources give us

Read 2026-10-09. Third-party posts and repositories are **data**: we take ideas, we do not copy code, copy, screens or marks, and we do not install anything wholesale
(see the licence boundary in memory `hypit-license-boundary`, and the earlier verdicts for iart, video-shotcraft and anidoodle). Where a licence is visible it is noted;
where it is not, treat the repo as ideas-only.

Sources read in full:

| Source | What it is |
|---|---|
| https://x.com/0xCarnagee/status/2108242455904813141 | Post that points to the article below |
| https://x.com/0xCarnagee/article/2104586920361590907 | "How to build Disney-level motion design studio with Opus 5.5": engines, a 956K-view prompt template, 8 rules, a self-review loop, a gallery |
| https://x.com/N01ennn/status/2108182955671580771 | List of 20 repos ("Netflix engineers posted..." is **unverified**; a reply asks the same question. We ignore the claim and judge each repo on its content) |
| https://x.com/N01ennn/article/2107826459804840072 | "How to turn Opus 5.5 into a studio": motion design + harness engineering + loop engineering as one stack |
| Repos read: Sunwood-ai-labs/hyperframes-motion-reel-skill (MIT), whaleyxbt/claude-motion, charlie947/motion-graphics-skills, t3knobox/klik-anim-skill-creation, LottieFiles/motion-design-skill (MIT) | README and the SKILL files quoted below |

Not read (listed only): claude-motion-design, claude-remotion-skill, product-launch-motion, animate, motion-design-skills (iart, already judged), hyperframes-student-kit,
motion-graphics (Barty-Bart), the Motion/Lottie/Remotion engines. They are Remotion, Lottie or web-animation oriented and add nothing for a HyperFrames pipeline beyond what is below.

## 1. The shift that explains everything (both articles)

The model writes a **program**, not a video; a frame is a pure function of its number/time; a change is a one-line edit and a re-render. We already build this way
(seek-safe HyperFrames, seeded random, closed-form springs). Both articles then say the quality is not in the prompt but around it:
**rules the model reads every run (guides), checks that must read zero (sensors), real data, and a loop that continues until the checks pass.**
"When the same problem shows up twice, fix the harness, not the output." We did exactly that this session (the "replacement is one move" rule, the frame-0 init fix).

## 2. What to adopt (and where it goes)

### A. Numbers and rules for motion (claude-motion `motion-design` skill; ideas, we write our own)

| Rule | Value | Our status / action |
|---|---|---|
| Entrance easing | `bezier(0.16, 1, 0.3, 1)` (expo-out family) | we use power4/power3.out; same family; keep |
| Exit easing | fast-in `bezier(0.6, 0, 0.9, 0.35)`, **exit about half the length of the entrance** (0.35-0.55 s vs 0.7-1.25 s) | our reel swaps use io for both; adopt "exit = half entrance" for text and cards that leave alone |
| Move between states | `bezier(0.65, 0, 0.35, 1)` | = our io |
| Springs | default 14/140/0.8, heavy 15-20/140-240, pop 9-11/200-230, **one elastic accent per video** | adopt "one elastic accent per film" as a gate in review |
| Stagger | words 0.09 s, list items 0.2-0.25 s, dots 0.06 s | within our 0.05-0.09 |
| Typing | about 0.035 s per character, caret about 2.4 Hz | ours 0.045; fine |
| **Reading holds** | >=1 s for a short phrase, +0.25 s per word beyond three, >=2 s for the final hook; "when in doubt, hold longer and animate less" | **new gate** for text scenes (see improvements doc) |
| **Overlap scenes** | the next scene starts drawing before the last has fully left; "hard gaps read as loading" | we overlap by half a transition; keep, never insert a gap |
| **Nothing is dead-still** | film grain (opacity about 0.09, reseeded on twos), vignette, a dot grid drifting a few px/s, idle elements that breathe (caret, clock, slow rotation) | **directly addresses our quiet-seconds failure**; add a `texture` layer module (grain, drifting grid) |
| One hero moment per film | build to it, do not spend it early | matches our one-climax rule |
| Persistent objects over cuts | a bar/spark/slider travels through scenes and changes role | our "recurring motif" gap (see Carnage 05) |
| Safe area | nothing within about 60 px of the frame edge unless intentionally cropped | add to the layout gate |
| **Frame 0 is the thumbnail** | "an empty or black frame 0 is banned: X autoplays muted and the first frame is the thumbnail" | **we violate this today** (our frame 0 is blank) |
| Phone test | key message readable at 360 px wide | already a rule; keep |
| Max three type families; one accent colour that means something | | matches our personalities |

### B. The self-review loop (claude-motion `review-loop`, Carnage 10, N01ennn part 2)

Render -> pull frames -> the model looks at them -> fix -> re-render only what changed. Contact sheet with **one timestamped frame per beat**, plus a scrub mode
(`--from 3 --to 5 --every 0.2`, which is the 5-frames-per-second method we used for the benchmarks). A smoke test with named counters that must all read zero
(runtime errors, error banners, invalid colours, text off the stage, text outside its panel, text overlapping text), a **seam check** (frame 0 and the frame one loop later
pixel-identical, for loops), and a **look** at crops at 100%. "The counters catch what the eye misses; the eye catches what the counters cannot."
We have most of these (`hyperframes check`, `pop_gate`, `seam_sheet`, `benchmark-metrics`); the missing pieces are one command that prints the counters as a block,
the per-beat sheet generated automatically, and the loop seam check for loopable social cuts.

### C. Harness and loop engineering (N01ennn parts 3-5)

* **Guides (feedforward) and sensors (feedback).** Our guides: `shared-craft.md`, the catalogue, personalities. Our sensors: `hyperframes check`, metrics, pop gate.
  Sensors are best when their **messages are written for the model to act on** (a fix instruction inside the error). Do that in the benchmark-metrics output.
* **Maker and checker are separate agents.** "Do not let the agent that did the work decide the work is good." Our review of our own renders has been done by the maker.
  Add a separate review pass (a fresh-context subagent given only the frames and the gates) before a film is called done.
* **`/goal` with a machine-checkable stop rule, a turn limit and an abort on no progress.** Taste is a bad goal ("until it looks good"); gates are good goals.
  A ready goal for the open work is in [SHOWREEL_IMPROVEMENTS.md](SHOWREEL_IMPROVEMENTS.md).
* **Delegate the task, never the taste.** Matches how we keep the user as director.
* Keep costly checks late and cheap ones early (a 12-frame strip before the full render, the pop caught before the render). We do.
* A `spine` file (a log of what failed and which rule it became) so the loop remembers. Our equivalents: the memory notes and shared-craft; add a `docs/SHOWREEL_LOG.md` only if the loop is automated.

### D. Brief structure that works (Carnage 04, the 956K-view template)

`<inputs>` (ask for the states, one accent, a track) / `<direction>` (medium, style, banned list) / `<structure>` (a beat grid, "something happens on every beat") /
`<build>` (pure function of time, springs as closed-form step responses, **a value that changes target many times is the sum of one spring per change**) /
`<gotchas>` / `<start>` ("show me the state list on the beat grid before you write any code"). Every part of a pro brief: a medium, a style, a banned list, a structure on a beat grid,
a check before the final render. We use the same shape for the cloud author stages; the **"approve the plan on the beat grid before any code"** step belongs in the product
(an editable beat plan before render; see the Pro Editor / storyboard work).

Techniques worth taking from it:
* **Two edges, two springs.** A tab indicator or a toggle knob stretches because its leading edge rides a faster spring than its trailing edge. Our `pill-cycle` resizes with one tween; give the pill's right edge a faster spring than its left.
* **Drags as direct manipulation** (the value is computed from the cursor while held, springs back on release). For `step-path`/cursor modules.
* **Loop-friendly last frame = first frame**, including cursor position and speed, for social loops.
* **Text swapping inside a morphing container needs its own enter and exit timing or it overlaps** (the exact bug we fixed in `pill-cycle`; now a rule).
* **Never put `will-change` on anything the camera scales** (text renders blurry).
* 4 sub-frames per frame blended with `tmix` = our motion-blur path (final only).

### E. Creative ideas

* **One recurring motif carries a whole film** (a glowing token in a 3-minute AI-history film). It turns a list of scenes into a story. Our modules are independent; add a **motif layer**: the brand mark (or one shape) that persists, travels and changes role across scenes. Benchmark A's mark-from-shards is a start.
* **STORYBOARD.md first, stills after each scene** (Remotion film brief), and klik's "visual storyboard approved as **rendered stills**, then a frozen execution plan, then QA in a fresh context". Matches our beat plan; add rendered-still storyboard approval for the editor.
* **Constraints create style** (resolution, palette size, "no libraries"). Use as personality constraints: e.g. calm = at most two type sizes, one accent, no blur.
* **Restraint** (Anthropic guidance quoted in the article, and a reply: "watch out for overanimating"): "extra animation contributes to the feeling that the design is AI-generated". This balances the pace push for bold; for calm and premium, prefer holds with texture over more events.
* **Name a reference or a medium** in every brief ("Linear launch video"); "without a reference Opus falls back to centred text, a gradient and everything fading in". Our personalities are the reference; the brand intake should also take 3-5 reference frames.

### F. Brand intake (charlie947 `brand-intake`, `launch-video`)

* Two batches of questions: name and one line; audience; what is promoted **with the real link**; **what people should feel in the first second, up to three of: calm, premium, playful, urgent, technical, warm, bold**; then hex codes, fonts, logo files, 3-5 reference frames, and **one thing the motion must never do**.
  This is the front door for our personality choice: map the picked feelings onto our personalities (calm, premium, playful, bold, explainer = technical/clear) and keep the "never" as a banned item in the plan.
* It writes `brand.md` and `MOTION.md` and "a rule that every other step reads them first"; where it cannot tell it writes **ASK ME** instead of guessing. Hex codes typed by the user beat colours sampled from a JPEG (sampled values drift).
  Our product equivalent is the brand kit; add the "never" list and "ASK ME" behaviour to the intake.
* "The file sets the look, **not the ambition**": without that line the first result was too polite.
* **Never invent a price, date, "spots left", testimonial or result.** Only attached proof. (We currently invent a default stat: see improvements P0.)
* "Build the first 10 seconds in two or three styles, pick one, then build the rest." We have the personalities; a style-picker preview of the first 3 s per personality is a cheap product feature.
* Launch beat sheet to approve: hook 0-4 s, proof 4-9 s, product working 9-17 s, a quality beat, how it works, **the number that matters with its source**, CTA that **holds at least 3 s**. A good default skeleton for `explainer`/`bold`.
* Check "like a buyer": would a stranger know what is launching by second 4? is every number traceable? does the CTA hold 3 s? readable on a phone with sound off?

### G. HyperFrames-specific lessons (hyperframes-motion-reel-skill, MIT)

* **One beat table feeds both picture and sound** (`b(n)` helpers; sound generated from the same table). Ours: `compose.mjs` derives sfx from the plan; add the explicit beat table to the plan JSON so the music analyser and the picture share it.
* **A `DESIGN.md`** written first (colours, type, grid, shape language, motion language, camera) that every later step reads as brand truth. Our plan JSON is that; also write it as readable Markdown for the user to approve.
* **Transitions transform the previous scene's shapes into the next** (type -> line -> graph -> 3D grid -> tunnel -> logo) instead of cross-fades; scenes sharing persistent elements live in **one composition as phase divs**, hard cuts only between sub-compositions. Our whips/irises are scene-level; a "shape carry" transition module is the upgrade.
* **Contrast is part of the choreography:** "fast, then stop, then explode", "dense, then release", "2D then 3D".
* Rules that match ours (confirmation): from-only properties vanish in parallel workers (write them in both from and to); register exactly one paused timeline; no `repeat:-1`; CSS in the inline `<style>` so fonts embed; **text hidden in a mask still counts in the overlap audit, so hide it with a wrapper `autoAlpha:0`**; `data-layout-bleed` for intentional bleed; **snapshots and production renders can differ, so pull frames from the final MP4**.
* Type floors: headlines 60 px+ and body 20 px+ at full screen, **90 px+ for social feeds**; avoid "elements just placed at the centre of the screen". Our `text_size_gate.mjs` already covers floors; add the feed floor.
* `npx hyperframes beats` shows the beat grid in Studio; use it for the music check.
* Defaults 60 fps, 120 BPM (1 beat = 30 frames). We render at 30 fps (production worker); 60 fps is a quality option to price.
* **Sound written in code** (kick, hat, click, impact, rise, sub as WAV from Node built-ins) and claude-motion's pure-stdlib Python **sfx engine with mastering to -14 LUFS and true peak below -2 dBFS** ("no samples, no licences"). We use sample files plus Lyria music. A generated SFX kit would remove sample licensing questions and let SFX follow the personality (pitch, softness). Worth a spike.
* A reply suggests audioascode.com (a Python music framework writing WAV/MIDI): a possible free alternative or complement to paid Lyria for personality-matched scores; not evaluated.

### H. Personality archetypes (LottieFiles motion-design-skill, MIT)

It teaches four motion-personality archetypes, emotion-to-motion mapping, Disney's 12 principles adapted for UI, choreography, and a quality checklist with troubleshooting ("animation smells and fixes").
Cross-check our five personalities against it, and import its **troubleshooting list** as sensors' messages. Not installed.

### I. Camera and craft split (klik)

`klik-anim` (element craft), `klik-cam` (camera dial C0-5, camera grammar, focus discipline, 3D hygiene, shutter blur), `klik-remotion-method` (discovery -> storyboard stills -> frozen plan -> build with a timing contract first -> QA in a fresh context; PROGRESS.md on disk so a fresh session resumes). Useful structure: **a camera dial per personality** (bold = aggressive push-ins, calm = barely perceptible) which our `drift` parameter is a first step toward; and plan on a reasoning-heavy model, build on the cheaper one.

## 3. What to skip, and why

| Item | Why not |
|---|---|
| Remotion | free only up to 3 people; our product is commercial. HyperFrames is Apache-2.0 |
| Blender claymation, three.js worlds, p5 painted cartoons | different engines; our motion-engines plan routes by format and keeps these as separate spikes |
| lottie-web, motion.dev, Framer Motion | web UI animation, not video |
| "Netflix engineers" / star counts / view counts | unverified social claims; do not repeat as fact |
| Installing any of the 20 repos wholesale | per our earlier verdicts: ideas only; installs bring their own taste and tooling |
| "One prompt, one shot" | the articles themselves note the winning videos had 10k-character prompts, skills, examples; the quality is in the harness |

## 4. Anything in these sources that tried to instruct us?

The post text contains promotional imperatives ("send it to Opus 5.5 & Fable 5.1, and thank me later", "save this", "check each repo before you install"). None of it is an instruction to this
work; it was read as content. No repo was installed, no command from them was run.
