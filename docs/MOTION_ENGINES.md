# Motion engines: one stack per kind of video?

October 10 update: the historical proposal below is now partially implemented. See [mixed-renderer production plan and verification](MIXED_RENDERER_PRODUCTION_PLAN.md) for the actual shipped-local scope: browser scene routing, Canvas geometry with live text, per-scene native treatments, export manifests and tested Linux images. Rust remains unavailable.

**Status: proposal for discussion (2026-10-08).** Nothing here is built. It records the idea ("math videos use Manim, canvas styles use canvas, Three.js, sketch, p5, motion…, harness each engine"), the evidence gathered for it, and where it should change before anyone writes code.

## The idea, and what is right about it

Different videos want different machinery. An equation morph is native to Manim; a painted film suits p5 and p5.brush; a doodle explainer suits anidoodle's canvas styles; a 3D shot suits a model-generated clip. Picking the best tool per intent beats forcing every video through one library.

## Evidence

| Source | What it shows | Limit |
|---|---|---|
| [PDoomVideo](https://github.com/JohnHeibel/PDoomVideo) | A 156.6 s music video written entirely by Claude: p5.js + p5.brush watercolour in headless Chrome, frames captured and encoded with ffmpeg. Nine chapter files authored by parallel subagents from one style guide and one storyboard. Every shot is a pure function of time ("frames render in parallel and out of order"), the same contract our recipes and anidoodle use | **No licence**: ideas only, like hypit. One film by one author on a GPU; the guide budgets up to 2.5 s per frame (never more than about 4 s) |
| [ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) (same author) | A starter kit for p5 + p5.brush cartoons with a guide for the model. **MIT**, so code could be reused with its notice | Not read in detail, not run |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas) | MIT, 19.3k stars; generator-based timelines and a good editor for voice-over-synced vector animation | Last release 3.17.2 (Dec 2024), last alpha Feb 2025; the 60 most recent commits span Apr 2024 to Feb 2025 plus one docs change in Jul 2026. **Headless rendering is an open request** (issues #415, #1218; a renderer PR was closed unmerged on 2024-05-30). The README does not document export, and I could not load its rendering docs |
| [Remotion vs HyperFrames](REMOTION_VS_HYPERFRAMES.md) (our own test) | Claude wrote the same 8 s film for both; both usable. Remotion 162 s / 17.5k output tokens / 26 s render; HyperFrames 132 s / 14.3k tokens / 7 s render (one warm local run, not a general ratio). Decision: HyperFrames stays primary | Remotion's Company License applies above 3 people and has rules for rendering services |
| [anidoodle](../experiments/anidoodle-try/RESULTS.md) | Apache-2.0. 31 styles render deterministically; a transparent callout layer composites in HyperFrames; `hyperframes check` passes | Every plate is one hand-authored subject; authoring a new one for a customer is untested |
| Manim | Fills the one gap we have (typeset maths, live-value graphs) | Not installed, not tried; needs Python, Cairo and LaTeX |

Cost per frame of worker time, order of magnitude only (different machines and settings): HyperFrames about 0.15 s, Remotion about 0.5 s (both from the test above), p5.brush watercolour up to 2.5 s by the PDoomVideo guide's own budget. A film's price differs by 10× or more across engines.

## Where I push back

1. **Route by outcome, not by engine.** Customers choose a result (launch sting, explainer, maths explainer, doodle explainer), not a library. An engine is an implementation detail of a *format skill* (`gm-math-explainer`, `gm-doodle-explainer`, `gm-3d-shot`). The director picks a format from a closed list; the user may override the format, never the engine. Exposing "Manim vs p5" in the product invites choices nobody can judge.
2. **Most of this list is already free.** HyperFrames runs GSAP, Lottie, Three.js, Anime.js, CSS, WAAPI and TypeGPU, and the repo already vendors Rough.js, Anime.js, p5 (LGPL, shipped unmodified as its own file) and p5.brush; the Sketch look on main uses Rough.js. Those are libraries inside the page the worker already renders: no new image, no new queue. Only three things need new runtime: **Manim** (Python + LaTeX), **heavy painted p5.brush films** (cost), **generated 3D** (Veo). Plan for those three, not for ten engines.
3. **Keep one boundary.** Every engine's output is a **layer in a HyperFrames film** (a transparent WebM or frame sequence under the HTML), and HyperFrames owns text, brand, captions, timing, transitions and audio. That is what keeps the pacing gate, the text floors, the seam ledger and the brand tokens meaningful. Text that is the content of a layer (an equation, hand lettering) is a declared exemption, checked by frame review rather than by the DOM gate. Without this boundary each engine needs its own gates.
4. **Price and queue by engine class.** A 15 s painted film at the guide's budget is roughly 15 × 24 × 2.5 s ≈ 15 minutes of single-worker time, against seconds for a DOM scene. Heavy classes get their own queue (as `generate-3d-shot` is planned to) and a credit cost, or they will starve the render workers.
5. **The real cost is maintenance, not the first render.** Each engine means a skill, slot schema, fill guidance, gates, brand mapping and two test builds. We have two library-ready skills after weeks of work. Cap it at **one new engine per quarter**, each behind a spike with numeric exit criteria.
6. **Do not adopt Motion Canvas, and do not build a third editor.** It is effectively dormant for 20 months, it has no headless path (we would write our own capture harness, as PDoomVideo and anidoodle do), and its strength (sequencing, voice-over sync) is what HyperFrames timelines and `gm-editor` already cover. Take the idea (generator-style sequencing) if the director needs a way to describe flows.
7. **One film is not a benchmark.** PDoomVideo proves a model can author a long p5 film. It does not prove customer briefs, Linux CPU rendering without a GPU, or cost per video. Measure before promising.

## Proposed sequence (each step ends in a decision, not a feature)

| Step | Proves | Exit criteria |
|---|---|---|
| 0. Hosted fill mode (done, main only) | Skills can run in the app without a local machine | [SKILL_DELIVERY.md](SKILL_DELIVERY.md) |
| 1. Manim spike (needs approval to install) | A transparent Manim layer composites into a HyperFrames film | An equation morph and a graph render and pass `check`; render ≤ 1.5× the clip's length on 2 vCPU; image growth measured (a separate queue is acceptable) |
| 2. Painted p5 format, own kit (ideas from PDoomVideo, code only from MIT sources) | Claude can author a 15 s painted film from a brief, on CPU | ms/frame and cost per film measured on 2 vCPU with no GPU; passes pacing and seek safety; a person likes it |
| 3. Doodle format (anidoodle) | A new subject can be authored for a real brief | One subject authored from a Greedy Motion brief; effort and quality recorded |
| 4. Format router in the director | The closed list picks the right format | Built only when at least three formats beyond the sting exist |

## Questions that decide the order

- Who would pay for a maths video first, and is that customer real or hypothetical?
- What is the ceiling on cost per video, and is CPU-only rendering acceptable for the painted formats?
- Is "one new engine per quarter" acceptable, or is breadth the product?
