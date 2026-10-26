# Evaluation: `iart-ai/motion-skills` (2026-10-08)

**Decision: not adopted.** Nothing from this repo is installed in the project and none of it is vendored. The one open item is **Manim**, which would add a capability we lack. It is gated on a spike (§5) that has not been run.

Source: <https://github.com/iart-ai/motion-skills>. MIT licence, published by iart.ai, which sells an AI motion agent and presents these skills as its open-source craft layer.

## 1. What it is

| Fact (as seen 2026-10-08) | Value |
|---|---|
| Structure | A hub repo plus 17 pack repos in the `iart-ai` org, installed per pack with `npx skills add iart-ai/<pack>` |
| Size claim | README: 54 skills in 17 packs. The repo About text still says 50 skills, 14 packs |
| Activity | 736 stars, 61 forks, 5 commits on master. Pack repos were last pushed 2026-06-22 (a few 2026-09-30) |
| Skill shape | `SKILL.md` + `references/` + a small `scripts/` kit (contact sheet, MP4 probe, frozen-frame screenshot) |
| Renderer | Video skills render through **Remotion** (`useCurrentFrame()`, `npx remotion still/render`) or **Manim**. Web skills output standalone HTML |
| Evidence of quality | None. The README has a showcase GIF but no before/after comparison, benchmark or sample output |

## 2. What was read

Read in full: `kinetic-typography`, `animation-principles`, `motion-art-direction`, `beat-sync-editing`, `short-form-video`, `manim` (SKILL.md only).
Read in part (the first 70–120 lines): `caption-animation`, `launch-video`, `shot-composition`.
Not read: the `references/` folders, the remaining ~40 skills (After Effects, WebGL, e-commerce, text-message, maps, web-animation and others), and the hub repo's `tools/verify`. Nothing was installed or executed.

## 3. Comparison with what we already have

| Their skill | What it teaches | Already covered by | Net new |
|---|---|---|---|
| `animation-principles` | Ease-out for enters, durations by element size, 40–80ms stagger, 12 principles, anticipation, 1/3 rule | `hyperframes-animation` (rules, blueprints), `motion-doctrine`, `cut-the-curve` | Nothing. Ours adds velocity-matched mirrored eases (`power4`) and the vector ledger |
| `motion-art-direction` | One motion language per piece, named personalities (Playful / Premium / Corporate / Energetic), hero / support / texture, restraint | `hyperframes-creative` references (personality), `gm-skill-authoring/references/watchability.md` | The "one wow per piece" restraint rule, phrased more bluntly |
| `shot-composition` | Grids, thirds, safe areas, bg / mid / fg parallax | `hyperframes-keyframes`, `hyperframes-creative/frame-presets`, safe zones in `hyperframes-studio` | Nothing material |
| `beat-sync-editing` | BPM to frames, cut on phrases, match / J / L cuts, speed ramps, pacing arc | `hyperframes beats`, `hyperframes-audio`, `gm-velocity-sting` seam ledger, J-cuts in `shared-craft.md` | The tension-release arc table (Establish / Develop / Climax / Resolve) |
| `short-form-video` | Hook by 3s, pattern interrupt every 2–4s, loop, 9:16 safe zone | `watchability.md`, [pacing standard](SKILL_LIBRARY.md#7-script-and-watchability-standards-single-source-of-truth), the reel pipeline | Nothing |
| `caption-animation` | Word-level timing, 1–4 word pages, active-word highlight | `captions-overlay`, `media-use` transcription | Nothing (their code is Remotion `spring()`) |
| `launch-video` | Hook, tease, reveal, montage, end card; sound leads picture | `product-launch-video`, `gm-feature-explainer`, `gm-velocity-sting` | Nothing |
| `kinetic-typography` | Mask, blur, clip, char-stagger reveals; variable-font weight | `hyperframes-animation` (24 named text effects, variable-font technique) | Nothing |
| **`manim`** | Equation write-on and morphs (`TransformMatchingTex`), function plots, `ValueTracker` graphs, geometric proofs, 3D math | **No equivalent.** A search of our skills for LaTeX / KaTeX / MathJax found nothing | **Math typesetting and live-value graphs** |

### Where their rules contradict ours

Loading both rule sets would give the agent opposite instructions.

| Their rule | Our rule |
|---|---|
| Hard cut is the default transition; dissolves and wipes look amateur | Every seam is velocity-matched and cut mid-motion on both sides; a stop before the cut is a "dead beat" (`motion-doctrine`) |
| Premium personality: cut every 8–16 beats, long holds | No still hold longer than 0.6s, no voiceover gap longer than 0.65s ([pacing standard](SKILL_LIBRARY.md#7-script-and-watchability-standards-single-source-of-truth); `shared-craft.md` → Pacing) |
| End card held still for 2s or more | One declared stillness beat of at most 1.0s, listed in the handoff |
| Hold discipline: at least 0.3s of stillness after every beat | Continuous camera motion, content arriving on words |
| Frame-driven code uses `useCurrentFrame()` | HyperFrames: one paused, seek-safe GSAP timeline |

## 4. Verdict

- **The 16 non-Manim packs do not improve our motion.** They restate general motion-design knowledge that Claude already has and that we have already written down in stricter, gate-enforced form. They target Remotion, which we do not use, and they contradict the pacing standard.
- **Manim is the one real gap.** It fits only a narrow segment: math, physics, finance and science explainers. The pack's own text says it is not the tool for UI motion, social or marketing video. For the product's core use (product launches, feature explainers, reels) it adds nothing.
- Adopting by `npx skills add` would put third-party instructions and shell scripts into agent context with no review step. If we want an idea, we copy it into our own references with MIT attribution.

## 5. Manim: how it would fit, and the spike that decides it

Proposed shape: render a Manim scene with a **transparent background** (webm or mov) and place it as a `<video>` layer inside a HyperFrames film, under the HTML text. This is the same pattern as the Nano Banana + Veo layer in [MOTION_PIPELINE.md](MOTION_PIPELINE.md). HyperFrames already renders and ingests transparent webm (`hyperframes render --format webm`, `remove-background`). Manim supports transparent output. **The combination is untested.**

Costs and risks to measure:

| Item | Known now |
|---|---|
| Local install | `manim` is not installed. `latex` is not installed. `ffmpeg` is present |
| Worker image | `worker/Dockerfile` has Node 24, Chromium and ffmpeg only. Manim needs Python, Cairo, Pango and a LaTeX distribution (TinyTeX is the small option) |
| Where it runs | A separate image or queue is likely, so LaTeX does not bloat the render workers. Same shape as the planned `generate-3d-shot` queue |
| Render speed | Cairo, CPU only. Unmeasured |
| Seams | A Manim clip needs the same velocity-matched entry and exit as any other layer (`motion-doctrine`) |

Spike (all steps pass, or Manim stays out):

1. Install `manim` and a minimal LaTeX locally.
2. Render two transparent clips: one equation morph (`TransformMatchingTex`) and one function plot with a tracing dot.
3. Composite both into a HyperFrames scene under HTML text. Run `check` (zero findings) and confirm the alpha edges are clean.
4. Time the Manim render and the film render on 2 vCPU. Record the LaTeX install size for the worker image.
5. Decide: author `gm-math-explainer` with `/gm-skill-authoring`, or drop it.

Status: **not started.** It needs approval, because it installs software (`pip install manim`, cairo / pango via brew, TinyTeX).

## 6. Revisit conditions

- Reopen the 16 non-Manim packs only if a pack publishes measured before/after results, or targets HyperFrames.
- Reopen Manim immediately if customers ask for math or science explainers, or if a template needs live-value charts that HyperFrames blocks cannot do.
