# V2 plan: what goes into v2

The list of features and engine changes held for v2 of the product. Each item says why it's in v2, what's
already proven, and what building it involves, so it can be picked up without redoing the research.
The v2 creation flow itself (Script & Style → Storyboard → Motion → Render → Review) is in
[PRODUCT_FLOW_V2.md](../PRODUCT_FLOW_V2.md).

| # | Item | Area | Status | Size |
|---|---|---|---|---|
| 1 | [Physics springs from Motion (motion.dev)](#1-physics-springs-from-motion-motiondev) | motion engine | spike passed (2026-10-10), not built | S (2-3 days) |

---

## 1. Physics springs from Motion (motion.dev)

**What it gives users:** entrances and moves that overshoot and settle like real objects (a card that lands with
a small bounce, a stat that springs into place, a staggered grid that ripples out from the centre). GSAP has
only fixed curves (`back`, `elastic`) that look mechanical next to a real spring.

**Library:** [motiondivision/motion](https://github.com/motiondivision/motion), MIT, so hosted and commercial use is fine. Pinned to `motion@13.4.4`.

**What's proven** (`experiments/motion-lib-test/`, numbers in its README):

- **Motion's maths under our GSAP clock is exact** in both the preview scrubber and the rendered MP4. This means `spring()` and `stagger()`, with GSAP writing the styles. Every one of 180 frames matched the spring exactly, and two renders were byte-identical.
- **Render speed is unchanged:** about 9 s for 6 s of 1080p, the same as GSAP alone.
- **Motion's `animate()` must not be used in compositions.**
  - As-is, it freezes in the preview scrubber.
  - Driven by our clock, it shows the previous frame while scrubbing.
  - It only renders right because the renderer simulates the clock.
- **Out of scope for video:** layout/FLIP animations, `scroll()`, gestures and the React components. They need live input, not a seekable clock.

**What to build:**

1. **Ship the file.**
   - Add `motion` (13.4.4) to the root and worker `package.json`.
   - Copy `dist/motion.js` to `vendor/motion.js` next to GSAP in every place that copies GSAP today:
     - `worker/src/compose.mjs:63`
     - `worker/src/self-test.mjs:46`
     - `backend/src/plan/render-project.ts:39`, plus a `config.motionPath` alongside `gsapPath` in `backend/src/config.ts`
     - the preview bootstrap in `backend/src/plan/preview.ts:107`
   - The file is 147 KB and needs no network.
2. **Add a `springEase()` helper** to the composition runtime, so authors stay inside GSAP:
   ```js
   gsap.to(card, { y: 0, duration: 0.9, ease: springEase({ stiffness: 120, damping: 14 }) });
   ```
   - It builds a GSAP ease from Motion's `spring()` generator, normalised over the spring's settle time.
   - It also takes `{ duration, bounce }` for authors who think in those terms.
   - Also expose `stagger()` (with `from: "center"`) for grids and lists.
3. **Skills and craft.**
   - Add a "physics spring entrance" recipe to the shared craft notes (`.claude/skills/gm-skill-authoring/references/shared-craft.md`, which feeds the director and hosted author).
   - Add a spring option to the gm-* skills where the motion personality is playful or tactile, not calm/editorial.
   - Rebuild the skill bundle.
4. **Guard.**
   - Add a lint/check rule that rejects `Motion.animate(`, `animate(` from Motion, `scroll(` and layout animations in compositions.
   - Add a test that renders the spike's lane C and checks every frame against the spring (port `experiments/motion-lib-test/measure.mjs`).

**Done when:**

- A hosted render and the storyboard preview both show the same spring frame for frame. The `measure.mjs` and `probe.mjs` checks must give 0 frames more than 2 px off.
- At least one gm-* skill uses it.
- The lint rule is in `hyperframes check`/CI.

**Risks:**

- Bundle drift between the preview and the worker. Mitigation: one pinned version, copied from `node_modules` the same way as GSAP.
- Springs that never visibly settle inside a beat. The helper should clamp to the beat length, and the pacing gate already flags dead space.
