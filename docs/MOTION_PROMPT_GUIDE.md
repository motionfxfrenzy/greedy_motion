# Writing motion prompts that lead to stronger films

Updated 2026-10-09. This guide responds to the three preferred gallery references and the two original local films. “Bad request” here means a prompt that produces weak work, not an HTTP/API error.

A useful motion prompt specifies **what the audience should understand, what changes on screen to demonstrate it, and how the result will be checked**. Adjectives communicate taste; concrete actions make that taste executable. No prompt guarantees excellent results. The renderer, available assets, model capability, implementation decisions, and revision process all matter.

## What the references actually show

| Reference | What its published prompt supplies | Transferable lesson | Limit of the evidence |
|---|---|---|---|
| [Code-synthesized showreel](https://motionpromptgallery.com/p/motion-showreel-with-a-fully-code-synthesized-soundtrack-pra/) | Short creative brief, 15 seconds, 1080p60, original synthesized music, cuts on beats, MP4 delivery | A narrow deliverable plus a strong rhythm constraint can leave useful creative freedom | A short prompt can succeed. We do not have the creator's full conversation, tool context, rejected takes, or revision history |
| [Reusable product prompt](https://motionpromptgallery.com/p/reusable-prompt-template-for-a-product-motion-video-ann-nnng/) | Product subject, short duration, research the product before scripting | Ground the story in the product before choosing effects | The published snippet leaves choreography and validation to the system |
| [TanStack AI launch reference](https://motionpromptgallery.com/p/create-and-render-a-15-second-motion-graphics-video-introduc/) | Timed story, signal continuity, demonstrations, short copy, editable text, audio direction, factual guardrails, inspect-and-fix instruction | Describe visible cause and effect: branching means parallelism; a retained checkpoint means recovery | Its archived preview measures **30.101 seconds at 1280×720/30 fps**, although the prompt requests 15 seconds at 1920×1080. The gallery preview may differ from the delivered master; we cannot infer why |
| [Portfolio showreel](https://motionpromptgallery.com/p/make-a-showreel-style-motion-graphics-video-for-my-portfolio/) | Real site capture, facts restricted to the site, limited palette, one idea per shot, varied pacing | Accurate assets and editorial selection help more than a long list of effects | Published instructions are not proof that every requirement was met |
| [Kinetic identity bumper](https://motionpromptgallery.com/p/20-second-kinetic-identity-bumper-for-techhalla-techhalla/) | Locked copy, palette, scene timing, explicit motion mechanisms, deterministic seek, still-frame review | Production constraints make intent testable | Overconstraint needs conflict resolution: a different opening and ending cannot also be an exact seamless loop without an explicit return transition |

The gallery archive contains 178 pages and 122 downloaded video previews. Six temporal samples per video were generated; the prior study inspected the 16 contact sheets. That is reference sampling, **not** a full shot-by-shot or audio review of every video. Detailed manually recorded notes currently cover the first 96 entries in `evidence/visual-notes.tsv`; the remaining write-up is pending. Other entries include interactive websites and simulations, not just rendered films. Do not label all 178 as implemented templates or promise exact reproduction from thumbnails.

These are comparative observations, not a controlled prompt experiment. A gallery selects impressive results; it does not show the failure rate. We cannot attribute a good result exclusively to its visible prompt.

## Why our two previous films work

The original local showreel and product story combine a restrained palette and local fonts, readable hierarchy, deliberately different silhouettes, deterministic animation, and a 120 BPM synthesized score. The showreel alternates types of visual energy; the product sequence gives the viewer recognizable objects to follow. Their scenes were implemented in code and inspected, not obtained by submitting one prompt to a video model.

The useful ingredients to preserve are:

1. **A clear visual hierarchy.** One main thing asks for attention at a time. Supporting detail does not compete with the headline.
2. **Coherent variety.** Change scale, density and tempo while retaining the same type, colors and spatial logic.
3. **Motion with a job.** A connector shows a relationship; a mask reveals a new state; a handoff preserves an object's identity.
4. **Rhythm with rests.** Impacts feel stronger when the viewer has time to read between them. Beat synchronization does not require continuous cuts.
5. **Deliberate finishing.** Local fonts, smooth easing, clean edges, deterministic export, audio headroom and a readable final hold.

These are design assessments, not audience engagement measurements. The Canvas films also have limitations: their internal graphics are flattened on import into EffectCraft; they are not native Pro editor objects. “Looks good” does not mean “production integration complete.”

## Write in three passes

### 1. Brief: lock meaning and inputs

Specify the audience, one desired takeaway, product facts with sources, exact copy, duration, aspect ratio, destination and assets. Mark unknowns. Distinguish product facts from illustrative diagrams. Say what to borrow from a reference: its pacing, contrast, diagram behavior or camera language; a URL alone is ambiguous.

For example: “For developers evaluating a workflow API, demonstrate that one request branches into independent jobs, then rejoins. Borrow the TanStack reference's continuous signal and restrained dark technical diagrams. Use our own branding. Show a conceptual diagram, not a screenshot of a shipped interface.”

### 2. Motion score: write states and handoffs

For each beat, specify **meaning → visible subject → action → settled result → next handoff**. This is our working prompt technique, not a proprietary or experimentally proven framework.

Weak: “Show durability with an amazing futuristic animation.”

Better: “A cyan packet advances halfway across the event rail, stops at checkpoint 042 for one second, then resumes from that same position. Keep the completed rail visible. Change the label from paused to resumed. Do not restart the packet from the left.”

Give timings as a useful starting point, not arbitrary micro-control of every property. For a 15-second technical promo, 4–6 beats is a practical starting range; dense material needs fewer beats or more time. State the final readable hold explicitly. Make transitions express relationships rather than adding a different wipe to every cut.

Animation craft supports this: staging directs attention, anticipation prepares an action, and timing/spacing shape how it feels. Apply these selectively to graphic objects; a technical connector need not bounce like a cartoon character. [Adobe's animation principles](https://www.adobe.com/creativecloud/animation/discover/principles-of-animation.html) provide the underlying vocabulary. Staggering can also separate messages so they can be read. [Adobe's stagger guidance](https://experienceleague.adobe.com/en/docs/creative-cloud-enterprise-learn/cce-learning-hub/expressoverview/expresshowto/stagger-animations).

### 3. Production contract: define inspectable success

Name the renderer and editable output, local assets, frame rate, duration, sound requirements, seek behavior and review artifacts. Ask for representative stills before the full encode, then inspect the exported file. Treat this as an engineering contract separate from the creative brief.

For our pipeline: HyperFrames composition, one finite paused GSAP timeline per composition, no network-dependent render assets, deterministic seeking, source SVG/DOM text where practical, explicit media timing. Canvas/WebGL is appropriate for procedural fields or 3D; it does not make painted words independently editable. A code-based renderer should render typography; a generated-footage model should receive shot descriptions and leave final titles to the compositor.

## Copyable production prompt

```text
Create and render an original [DURATION]-second motion film for [PRODUCT].
Audience: [WHO]. One takeaway: [WHAT THEY SHOULD UNDERSTAND].
Use only these verified facts: [FACTS + SOURCE URLS].
Required assets: [LOCAL LOGO / FONTS / CAPTURES / DATA].
If an essential asset is missing, identify it; do not invent product UI or claims.

Reference: [URL]. Borrow [SPECIFIC PACING / PALETTE / MOTION MECHANISM].
Create original artwork. Do not copy its creator credit or imply endorsement.
Design: [BACKGROUND], [ONE PRIMARY ACCENT], [SECONDARY ACCENT],
[TYPE SYSTEM]. One dominant focal object per beat; brief, readable copy.

Deliver [WIDTH × HEIGHT], [FPS], exactly [DURATION] seconds.
Use this timed story; each line specifies a visual demonstration:
- [START–END]: [MESSAGE]. [OBJECT] moves from [STATE A] to [STATE B].
  On-screen copy: [EXACT WORDS]. Handoff: [WHAT PERSISTS INTO NEXT BEAT].
- [...]
- Final [N] seconds: [LOCKUP / CTA], stable enough to read.

Motion: [CHARACTER, E.G. PRECISE / WEIGHTED / PAPER STOP-MOTION].
Use anticipation, purposeful acceleration and a settled reading state.
Keep continuous objects continuous across transitions.
Reserve [ACCENT EFFECT] for [SPECIFIC MOMENT]; do not apply it everywhere.
Audio: [ORIGINAL/PROVIDED TRACK], [BPM OR CUE TIMES], [HITS / REST / RESOLVE].
The story must remain understandable when muted.

Deliver the MP4, local source/assets, the exact build prompt, and a report.
Use [OUR HYPERFRAMES CONTRACT / OTHER CHOSEN RENDERER].
Keep editable text as DOM/SVG; disclose raster or flattened elements.
Verify fonts and assets load, duration/fps/aspect match, forward/reverse
seeking agrees, no clipped type, audio is present without clipping, and
all major beats remain understandable at the intended viewing size.
Inspect stills and the actual export; revise specific failures before delivery.
Report any unmet requirement. Do not silently substitute stock or a still image.
```

## Filled example: the new Signal study

This is an original mechanism study of the latest reference with fictional branding, not an official TanStack film. Current TanStack provider counts and release claims are intentionally not asserted.

| Time | What the viewer learns | Visible action / handoff | Copy |
|---|---|---|---|
| 0–2 | A small input can start a system | A central prompt arrives; a cyan rail draws outward | It starts with one signal. |
| 2–4 | One core routes into many outputs | Four connected nodes appear around the persistent core | One core. Many directions. |
| 4–6.5 | Different formats share a pattern | The same four labels become text, waveform, image and play symbols | A shared language. |
| 6.5–9 | Work can proceed concurrently | The connected graph returns with independently moving packets | Work in parallel. |
| 9–11.5 | Recovery retains progress | Checkpoint 042 holds at 50%, then completes from there | Pick up where you paused. |
| 11.5–15 | The ideas resolve into one identity | Nodes converge; an original geometric SIGNAL mark lands and holds | One idea. Connected possibilities. |

See [the implementation brief](../Effectcraft_templates/Motion_gallery/projects/signal-study/BRIEF.md) and [editable source](../Effectcraft_templates/Motion_gallery/projects/signal-study/index.html). The source contains native SVG text/shapes and a deterministic time function driven by GSAP. Its audio reuses our existing original product score. It is not a new soundtrack, a full source recreation, or a production editor integration.

## Why prompts produce poor results

| Prompt problem | Likely visible symptom | Better instruction |
|---|---|---|
| Only evaluative adjectives | Attractive but generic shapes | Name the subject, message and visible transformation |
| Feature list without a story | A slide deck of labels | Give each feature a demonstration and shared object |
| Too much copy for the duration | Tiny text and rushed cuts | Prioritize one takeaway; reduce words or extend duration |
| Multiple unrelated visual references | Inconsistent style | Assign each reference one purpose; choose one primary design system |
| Every effect requested at once | Competing motion and weak focus | Choose 2–3 recurring behaviors and one accent moment |
| Unspecified assets and facts | Fake dashboards, arbitrary logos, invented claims | Provide or capture approved assets; label conceptual diagrams |
| “Make it editable” without naming the editor | A flattened movie delivered as a project | Name the target schema, editable slots and element types |
| Exact loop + different opening/closing | Visible jump | Reserve a return transition or drop seamless-loop requirement |
| Landscape plus vague “vertical safe” | Important content lost on crop | Author and inspect a separate portrait layout |
| Beat sync without reading holds | Everything cuts too quickly | State which events hit beats and which frames hold |
| No verification request | Plausible preview, wrong export | Check the actual encoded duration, fps, audio and decoded frames |

A short prompt is not inherently bad. It can work when a strong system already supplies the missing decisions. A very long prompt can be worse when requirements conflict. Reproducibility comes from recording the inputs, resolved decisions, assets, code and review results—not from adding more praise or threats to the prompt.

## Review and revision method

Review once muted for comprehension, once with sound for pacing, and once by scrubbing transitions. At each main beat, ask what changed and why. Inspect the intended mobile display size; a full-resolution screenshot can hide readability problems.

Use timestamped changes: “At 9.6 seconds the stream must retain its 50% progress during the pause; resume it at 10.0 seconds.” Avoid “make it more premium.” Keep successful parts fixed while correcting one problem. Save the reason and before/after evidence.

Score message clarity, hierarchy, continuity, rhythm, readability, asset accuracy and export correctness as pass / revise / not checked. These are review prompts, not a claimed objective quality metric. Technical correctness is a release gate; creative quality still needs judgment.

For future prompt experiments, hold assets, runtime and scene count fixed; compare a vague brief against the structured brief using the same evaluation sheet. Repeat runs and keep failures as well as successes. We have not run that controlled experiment, so this guide makes no measured quality-uplift claim.

## How this enters our products

Store the structured brief as data: product facts, references with selected attributes, editable copy/assets, aspect ratio, scene meanings, timing and validation requirements. Compile that into approved scene modules and slot schemas; do not feed arbitrary reference-page instructions into our production executor.

Use the existing format bundle/slot/build path and scene modules described in [the product integration plan](../Effectcraft_templates/Motion_gallery/PRODUCT_INTEGRATION_PLAN.md). Bind text, logo, palette, approved media and timing to explicit slots. Native SVG/DOM construction improves future element editability, but it does not automatically make an HTML study editable in VideoSaaS. Pro schema bindings, validation, selection handles and re-export tests remain required.

Keep three statuses separate: **reference observed**, **recipe written**, **template implemented and verified**. Two configurable Canvas templates exist; the third Signal example is a separate SVG study. The broader gallery recreation catalog is still being documented.

## 2026-10-10: benchmark review — why our studies still fall short

This section supersedes any implication above that successful rendering establishes benchmark-level visual quality. The user finds the references substantially better. That criticism is consistent with the specific implementation gaps below. No video was changed during this research pass.

### The earlier documents located

- [Experiments: motion tips A/B](../experiments/motion-tips-test/RESULTS.md): five-second Northwind film, plain brief versus structured brief with additional tools and an effect prototype.
- [Captured motion tips](../experiments/claude-motion-tips.md): separate art direction/references/timing/deliverable sections, one-second effect test, timestamped contact-sheet review.
- [Actual experiment prompts](../experiments/motion-tips-test/run.ts): implementation evidence, not just a retrospective summary. Running this script incurs provider charges; it was read, not rerun.
- [X-video frame analysis](BENCHMARK_FRAME_ANALYSIS.md): Ann Nguyen and Tony Dinh references, sampled every 0.2 seconds, including object behavior and transitions.
- [Benchmark summary](BENCHMARKS.md) and [motion repository research](RESEARCH_MOTION_REPOS.md): quality gaps and reusable craft techniques.

The A/B experiment changed **several variables simultaneously**: brief detail and structure, effect libraries, number of generation calls, and a prototype supplied back as context. Its more distinctive result cannot be attributed to XML alone. There was one sample per condition, and the more ambitious result retained contrast, spacing and handoff problems. Reinspection of the two saved contact sheets confirms greater visual specificity, but also sparse transitional frames and unresolved closing layout. XML is organization, not a visual-quality switch.

The older benchmark summary also overgeneralizes: it says both references have 7–9 scenes and avoid cuts, while its detailed companion records **six scenes for A and twelve for B**, including deliberate hard cuts in B. Use the detailed shot tables. The motion-difference metric is a diagnostic, not a quality score; flicker can increase it. Sampling at 0.2 seconds cannot prove two-frame beat accuracy at 60 fps. Precise sync needs audio transients and frame-accurate boundary measurements.

### New X article: what is actually available

[Hamza Khalid's post](https://x.com/humzaakhalid/status/2105203643758895454) links to a course article. X returned 403 directly; its public article body and media were retrieved through the FxTwitter mirror. The author emphasizes a prepared brand folder, reference repositories, framework skills, and iteration. The public text explicitly sends readers to a newsletter for the brand brief, exact film prompt and fixes; those portions were not available here. Its “10% prompt / 90% setup” statement is an author's heuristic, not an experimental finding. The public material does not establish that every scene was specified in the final prompt.

The embedded 24.75-second portrait film was also sampled at two-second intervals: oversized statistic, browser/search views, course content, card grid, system diagram and phone mockup, with light/dark changes. This is visual sampling, not a complete shot/audio review. [Contact sheet and method](../experiments/motion-tips-test/reference-review-2026-10-10/README.md).

### Does the user need to describe every scene?

No. There are two useful modes:

1. **Creative delegation:** the user supplies brand, audience, message, assets, references and constraints. The agent must propose distinct visual directions, select a coherent one, and write the shot plan before coding. A short user prompt can sit on top of substantial prepared context.
2. **Controlled recreation:** the user or agent specifies shots and handoffs from a studied reference. For repeatable production, each shot needs timing, focal object, composition, action, copy, exit and sound cue. The user need not author all those details; the agent must resolve them.

The scene count is not the method. What matters is whether the execution has enough design information. Separate **what the user must communicate** from **what the agent must design**. Do not push the entire director's job back onto the user.

### Specific shortcomings in Signal

| What the implementation does | Why it feels simpler than the benchmark | What a stronger version needs |
|---|---|---|
| Reuses the central node diagram and lower headline layout | Little change in framing, visual hierarchy or density | Close detail, wider system reveal, then a deliberately quieter proof frame |
| Uses the same smoothstep easing helper for most arrivals | Different objects have similar weight and character | Separate motion profiles for text, packet travel, camera and large panels |
| Replaces graph/formats/recovery groups primarily with opacity ramps | The story says transformation; the pixels often show a dissolve | Keep the same rendered object through handoffs and animate its geometry/position |
| Uses labels and simple symbols | Explains categories without showing convincing product behavior | Approved real UI or detailed, explicitly conceptual demonstrations |
| Reuses the existing product music bed | No soundtrack designed around this film's own anticipation and resolution | Author a cue map and align a musical change or sound event to meaningful actions |
| Keeps one dark ground and similar scale throughout | Low contrast between chapters and limited escalation | Deliberate changes in scale, density or value, with one clear climax |
| Passes technical checks and has sampled frame inspection | Those checks cannot judge originality, pacing or resemblance | Matched reference/output contact sheets, transition clips and an explicit creative revision pass |

These are judgments grounded in the source and inspected frames, not audience-study scores. The code is competent as a simple diagram study; it should not have been presented as evidence that we had reached the reference's production quality. Simplifying the design was an implementation decision, not a limitation imposed by the user's prompt or by SVG.

### What Motion adds — and what it does not

[Motion's repository](https://github.com/motiondivision/motion) is an animation library, distinct from a complete film renderer. Its [animate API](https://motion.dev/docs/animate) provides sequences, springs, stagger and SVG animation. Its [React layout tools](https://motion.dev/docs/react-layout-animations) help animate layout changes and shared elements. Those are useful mechanisms for pill resizing, card rearrangements and object continuity. They do not choose a story, design attractive frames, source product assets or perform editorial review.

Adoption proposal: test one difficult shared-element handoff in isolation before adding another runtime to our film pipeline. Compare against our existing GSAP implementation. Require deterministic direct seeking and repeated export frames before production use; ordinary interactive playback alone is insufficient. No Motion package was installed or integrated in this review. Switching libraries is not the primary fix for the current quality gap.

### Stronger directing prompt for our next iteration

```text
Study the attached reference film and our current render side by side.
First identify the five biggest visual gaps with timestamps and frame evidence.
Do not begin by replacing the animation framework.

Use the approved brand assets and verified product facts. Propose three visual
directions that differ in composition and motion, then recommend one.
Translate the chosen direction into a shot table:
time / message / focal object / composition / entry / main action /
reading hold / persistent object / exit / sound cue.

Design a close-up, a scale reveal, a proof-by-showing moment, a breath,
and a deliberate climax followed by a readable ending. Use only the shots
that serve this product; do not force a fixed scene count.

For each adjacent pair of shots, say exactly what happens to the outgoing
object and how it becomes, reveals, or hands attention to the next one.
Do not claim a morph when the implementation only dissolves two objects.
Choose different timing and easing for typography, camera and physical objects.

Render the hardest 1–2 second transition first. Inspect it at normal speed
and by scrubbing. Then build the full film and compare representative frames
and transition clips against the reference at equivalent story moments.
Revise the identified visual gaps, not just lint errors. Report fidelity limits.
```

Next creative work should be a focused revision of one existing film against that shot plan. Installing every reference repository, increasing particle counts, or adding more prompt adjectives would not address these observed gaps.

## Worked build: jhylee95 / Demo Flow (October 10, 2026)

The [actual AI directing packet](../Effectcraft_templates/Motion_gallery/projects/demo-flow/PROMPT.md) and [render/comparison evidence](../Effectcraft_templates/Motion_gallery/projects/demo-flow/README.md) provide a concrete example of scene-level prompting. The user supplied the reference; the agent derived 18 editorial beats and delegated three contiguous chapters with explicit geometry and timings. The user did not need to invent every scene.

Useful structure: **intent → reference observations → visual constants → timed shot poses → action → exit/handoff → audio cue → acceptance checks**. For example, “embed” is not merely a title: the same word contracts into browser chrome, preserving its identity while proving the feature. The dashboard-to-video transition retains a familiar window while changing playback context. The agent chapter keeps one application alive through typing, answers, previews and camera movement. These continuity instructions give the builder more actionable context than “make it smooth.”

At 30 fps, describe an entrance in 6–8 frames, delay supporting action by 5–8 frames, reserve a readable hold, and name the exact next cut. Those are choices for this fast reference, not universal timings. Deliberate hard cuts are appropriate here; asking for transitions everywhere would change its rhythm. Include both a still pose and how the viewer reaches it.

The new build improves specificity and product-action variety over Signal, but the paired frames still show smaller hero typography and different UI spacing/cropping. Therefore detailed prompting alone does not guarantee fidelity. Close the loop with matched reference/output poses, transition review, hierarchy corrections and listening review. Technical audits validate renderability and sampled legibility, not taste. This build is not a controlled A/B test of prompting techniques, and its soundtrack has measurement evidence but no independent listening review.
