# Showreel modules: what still needs improving

Written 2026-10-09 after the third review pass. Status of the work in [SHOWREEL_MODULES.md](SHOWREEL_MODULES.md); targets in [BENCHMARKS.md](BENCHMARKS.md) and
[BENCHMARK_FRAME_ANALYSIS.md](BENCHMARK_FRAME_ANALYSIS.md); outside ideas to adopt in [MOTION_RESEARCH_2026-10.md](MOTION_RESEARCH_2026-10.md).
The user's verdict on the latest renders: **the videos still need improvement.** This is the honest list, with causes, in priority order.

## Where the three demo films stand (experiments/showreel-modular/out)

| Film | Personality | Mean motion (0.015-0.035) | Quiet seconds (limit 3) | Hard hits (limit 1 event) | Verdict |
|---|---|---|---|---|---|
| Kinetic | bold, dark, 120 BPM | 0.024 | 2 | 1 event | passes the gates; look still short of the benchmark (see P2, P3) |
| Lumen | calm, light, 90 BPM | 0.011 | 8 | none | **fails**: static holds |
| Tidyflow | explainer, light, 100 BPM | 0.010 | 7 | none | **fails**: static holds |

Fixed this session and verified at 5 frames per second: stacked words (pill reel, lines, rapid-fire), the previous scene showing through the next, elements visible before their entrance,
labels crossing text, satellites and shards over text.

## P0. Integrity: invented facts

`worker/templates/showreel/copy.mjs` fills a missing `stat` with `{ n: 100, suffix: "%", label: "less busywork" }`, and fills lines and recap from feature titles. That is an **invented claim**,
the thing the best launch skills forbid ("never invent a price, date, testimonial or result") and our own craft rule ("real facts only"). The demo films also use invented numbers (12x, 40%, 8h) for invented brands, which is fine only because the brands are invented.
Fix: modules that show a number (`stat-hero`, `app-fill` counter, `lines-climb` proof) **must not be chosen unless the caller supplies the fact** (add `needs: ["stat"]` against the caller's own input, not the defaults); `fillCopy` may format, never fabricate.
A default for layout-only text (placeholder rows in screen mock-ups) stays, marked decorative.

## P1. Frame 0 is empty (the thumbnail)

After the "initial state at time 0" fix every film starts on a blank ground with only the HUD. Platforms autoplay muted and use frame 0 as the thumbnail; the research is explicit that an empty or black first frame is banned
(and benchmark B opens on its composer, benchmark A on a HUD plus a word at 0.2 s).
Fix: the first scene's entrance should be **pre-rolled** (start the hook already 40-60% in at t=0), or the plan carries a `poster` frame (the settled frame of the hook) used as frame 0 for one frame.
Gate: frame 0 must contain the headline or the hero object (measure ink above the ground colour).

## P2. Static holds in the light films (the failing gates)

Causes found:
1. **Events are front-loaded.** Most modules do their entrance in the first 0.5-1.2 s and then hold for 1.5-2.5 s with only a 5-9% camera drift. The motion measure and the eye both read that as dead.
2. **Light, low-contrast grounds hide motion** from the 64x36 grey-scale metric: a moving white card on a pale ground barely registers. Benchmark A does reach 0.027 on a light ground, with large blur-based moves.
3. **End cards hold 2.6 s with nothing moving** (0.001 and 0 in the last two seconds). A calm last second is right (benchmark: 0.008); a still last two is not.
4. **No texture layer.** claude-motion's "nothing is dead-still" rule: grain, a drifting dot grid, vignette, breathing idle elements. We have none of them.

Fixes, in order of value:
* **Second beat in every hold.** Each module declares secondary events at fixed fractions of its length (a highlight sweep along rows, a counter tick, a cursor visit, a row added, a badge pulse). `trio-cards` and `hook-kinetic` got a first version; do it for all, driven from the module catalogue, with the rule *the second beat never moves the text being read* (reading holds: at least 1 s for a short phrase, +0.25 s per word beyond three, at least 2 s for the final hook).
* **Texture layer** module (per personality): film grain reseeded on twos, a dot grid drifting 4-8 px/s, soft vignette. Bold and playful use grain lightly; calm uses only the drifting grid and breathing; premium uses vignette + slow grain.
* **Blur-based transitions on light grounds** (whip with real directional blur; iris with scale), sized so the transition itself registers.
* **Shorter scenes, more of them** for explainer (benchmark A averages 2.5 s; B 1.25 s): explainer is at 7 scenes of 1.8-3 s but several are single-idea holds.
* **End card with a living last second**: slow bloom, mark breathing, URL pill gentle pulse; keep the motion low but non-zero (target 0.004-0.008).
* Re-measure with `scripts/benchmark-metrics.mjs`. **Do not tune only to the metric:** read the 5-fps sheets; a calm film may legitimately sit near the low end of the envelope (consider a personality-specific envelope: calm 0.010-0.025, quiet seconds at most 4, only if the sheets read as alive).

## P3. Craft gaps against the benchmarks (from the frame analysis)

* **Whip blur is isotropic** (a Gaussian blur), not directional. Benchmark A's moves smear along the direction of travel. Needs a per-axis blur (SVG `feGaussianBlur stdDeviation="x 0"` or a stacked-copy blur).
* **Real product UI.** Our faux screens are four generic mock-ups; the benchmarks win on dense, specific UI. Products with screenshots should use `product.screens` (supported, untested end to end); otherwise grow the faux-UI kit (a command palette, a table with filters, a settings sheet, a code panel).
* **Per-scene ground flip** (benchmark B: navy -> saturated brand colour -> near-black on a cut) exists only inside `rapid-fire` (bold). Make it a scene-level option for all personalities with a safe palette.
* **Two-edge spring** on the pill and any resizing container (leading edge faster than trailing).
* **Shape carry transitions** (a shape from scene N becomes the next scene's shape) instead of whole-scene whips.
* **Recurring motif**: the brand mark (or one shape) persists, travels and changes role across scenes.
* **Typed wordmark with accent letters** exists in `end-sting`; `end-burst` and `end-calm` still use letter rises.
* **One elastic accent per film**; right now several modules use back/overshoot independently.
* **Type floors for feeds**: headlines 90 px+ if the film is for social; our 1920x1080 sizes pass, 1080x1350 and 9:16 are not built.

## P4. Modules built but never rendered end to end

`reskin-proof`, `lines-climb` (and its proof badges) and `end-sting` pass `hyperframes check` but no demo brand selects them (their `needs` are not met by the demo copy, or the seed never picked them).
Add a fourth demo brand whose copy supplies a re-skin set and a proof line, and render it; then review at 5 fps. Until then they are unverified.

## P5. Copy quality

Auto-filled copy ("Plan.", "Track.", "Report." from feature titles; "Projects that / run themselves" from a tagline split) is acceptable for tests and weak for a product.
Production copy should come from a **storyboard step with the user's facts** (beat plan with real lines, approved before render), not from `fillCopy`. Use the brand-intake pattern: ask, and write ASK ME where unknown.

## P6. Audio

Levels differ by film (mean -13.7, -12.9, -16.8 dB) because each track is simply gained by a fixed amount. Normalise per film to about -14 LUFS (two-pass loudnorm to a target, then the limiter) instead of a fixed `volume=3.4dB`.
Music beat phase is found by autocorrelation; verify with the picture's hit frames (the first beat should land on the first strong visual hit). Consider generated SFX (pure-code kit) to avoid sample licensing, and compare with a code-generated score as an alternative to paid Lyria.

## P7. Process (from the harness and loop research)

* A single `showreel-check` command: `hyperframes check`, `benchmark-metrics`, the per-beat contact sheet, the 5-fps sheets for each 5 s part, frame-0 check, loudness, and a printed **counter block** (all must read zero), with fix instructions written into the messages.
* A separate reviewer pass (a fresh subagent given only the frames and the gates) before a film is called done: maker and checker apart.
* Pull review frames from the **final MP4**, not from snapshots (they can differ).
* A loop goal to run the improvement work unattended once P0-P2 are specified:

```
/goal Re-render experiments/showreel-modular films bold, calm and explainer until: hyperframes check passes on all three; scripts/benchmark-metrics.mjs
reports mean motion >= 0.015 and quiet seconds <= 3 for each (calm may use <= 4 and >= 0.010 if the 5-fps sheets read as alive); frame 0 of each film
contains its headline or hero object; no text overlaps in any 5-fps sheet; audio within 1.5 dB of -14 LUFS. Fix the worst failure each round, one module at a time.
Abort if two rounds improve nothing. Stop after 8 rounds. Write what failed and the rule it became to docs/SHOWREEL_LOG.md.
```

## Not started

Vertical 9:16 and 4:5 outputs (safe zones top 14%, bottom 35%, sides 6%), the backend and worker routes that call the planner, an editable beat-plan step in the product,
the brand intake with the "feel" picker and the "never" list, a motif layer, a generated SFX kit, and a 60 fps quality option.
