# V2 plan: what goes into v2

The list of features and engine changes held for v2 of the product. Each item says why it's in v2, what's
already proven, and what building it involves, so it can be picked up without redoing the research.
The v2 creation flow itself (Script & Style → Storyboard → Motion → Render → Review) is in
[PRODUCT_FLOW_V2.md](../PRODUCT_FLOW_V2.md).

| # | Item | Area | Status | Size |
|---|---|---|---|---|
| 1 | [Physics springs from Motion (motion.dev)](#1-physics-springs-from-motion-motiondev) | motion engine | spike passed (2026-10-10), not built | S (2-3 days) |
| 2 | [Paper, clay and illustration styles, and a drawn parts library](#2-paper-clay-and-illustration-styles-and-a-drawn-parts-library) | styles / engine | held from the gallery and picker (2026-10-11), not built | M per style |
| 3 | [Scenes as nested compositions: a real timeline in the Pro editor](#3-scenes-as-nested-compositions-a-real-timeline-in-the-pro-editor) | Pro editor / engine | designed (2026-10-14), not built, no spike yet | L (several days; sketch-style prototype first) |

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

---

## 2. Paper, clay and illustration styles, and a drawn parts library

**Why it is held:** 43 looks have `renderMode: "generated"` (Paper 6, Clay 4, Illustration 31, Editorial collage 2). The engine cannot paint those from a person's script, so choosing one gave a plain layout draft in the style's colours, not the look on the card. The cards were hand-built SVG scenes (`scripts/gallery-scenes/`), so they showed a promise the product could not keep.

**What is held now:** `HOLD_GENERATED_STYLES` in `packages/contracts/src/gallery.ts`. While it is `true`, those styles and every template made in them are left out of the gallery, the style picker and the Templates tabs (a tab with no templates is hidden). Nothing is deleted: the look catalogue, the scene sources, the published previews and the manifest are unchanged, existing projects in those looks still open and render as before, and `findGalleryTemplate` still resolves them. Set the flag to `false` to bring them all back.

**The plan:**

1. **Pull the parts out** of the hand-built scenes into one kit per style: its filters (for clay: soft bevel from blurred alpha, thumb dents, contact shadow, wobbly outline), palette and a parts library (sun, cloud, tree, house, hills, boat, balloon, simple character poses, props). Start from `style-clay-goofy`, then paper cut-out, then crayon and watercolour.
2. **Scene schema for the director:** a scene is a list of parts with positions and a motion per part ("boy waving on a hill, house right, sun top right"). The engine assembles it with the style's kit and animates it with GSAP. The same description renders in any style that has a kit.
3. **Storyboard stills** are drawn from the same schema, so the frame the person edits is the frame that animates.
4. **Fallback** for a subject the kit cannot draw (a specific product, interior or person): the nearest part, or a generated keyframe or clip for that scene only (Nano Banana, Veo; see `motion-pipeline-direction`).
5. **Release one style at a time:** replace the single flag with an allow-list and add a look once its kit can draw a scene written from a script.

**No new dependency:** SVG, GSAP and the rough.js already in the engine. Not planned: a third-party illustration pack (static art, licence and palette problems) or a large runtime graphics engine (slows deterministic rendering). Optional: commission a small set of vector character parts if hand-drawn ones are not good enough.

**Proven:** the hand-built scenes (`style-clay-goofy`, `style-paper-diorama`, `story-illus-balloon` and the others) show the look is reachable in SVG and GSAP. **Not proven:** a scene composed by the director from a script.

---

## 3. Scenes as nested compositions: a real timeline in the Pro editor

**Why it is in v2:** a film opened from a storyboard is one `#root` layer. Its scenes, text and shapes are drawn by the
engine's script from the plan when the page loads, so the Pro editor's timeline shows only the root and the audio clips.
Nothing is selectable, trimmable or movable. v1 handles the common need with a **Text tab** (`frontend/components/editor/Inspector.tsx`,
`frontend/lib/editor/beat-text.ts`): each frame's keyword and on-screen text are editable and the preview redraws. That
edits the plan behind the scenes; it does not give scenes timing or elements of their own. Making a scene something you
can drag needs a different structure, which is a v2 piece of work.

**What it gives users:** every frame is a clip on the timeline that can be moved, trimmed, split and reordered, and its
words are real text clips with the usual text controls (font, colour, position, timing).

**What was found while looking into it (2026-10-14):**

- The editor loads one `index.html` into the preview frame (`packages/contracts/src/frame.ts`: the shell page,
  `load` message, `document.write`). It does not follow `data-composition-src` to separate files, and the Comps tab lists
  only the main composition. Scenes therefore have to be **nested inline in the same file**, not separate files, unless
  the editor is extended.
- The frame's bridge seeks only the first timeline in `window.__timelines`. The page needs **one master timeline** that
  nests each scene's timeline.
- A drag in the editor changes `data-start` and `data-duration` on the clip. The master timeline must **read those
  attributes when the page loads**, not use numbers baked into the script, or a retime has no effect.
- The film's own script places every animation at absolute film times taken from the plan (`start`, `end`, `vo`,
  per-word times), and the style code assumes it knows the whole film. This is the largest piece.
- The editor's frame hides any timed clip outside its start and duration, so the root needs an explicit duration and
  pixel size. This is already handled when a storyboard is opened in the editor (`withEditorRoot` in
  `backend/src/pro/routes.ts`), which fixed a blank preview on 2026-10-14.

**What to build:**

1. **Scene-local animation.** The engine builds one scene's animation from local time zero, given only that scene's plan.
   Pull each style's draw code apart so nothing in a scene refers to another scene or to absolute film time.
2. **Inline scene wrappers.** Each frame is written as
   `<div id="scene-b1" data-composition-id="b1" data-start data-duration data-track-index>` under `#root`, with its words
   as separate elements with their own ids. Shapes and hand-drawn effects stay as the scene's artwork.
3. **Master timeline.** Built at load: for each scene element, add its timeline at the element's `data-start`, read from
   the attribute. Register it as the one timeline the frame bridge seeks.
4. **Joins between scenes.** Today the exit direction of one frame sets the entry of the next, with wipes and overlap
   (`motion-doctrine`, `cut-the-curve`). Make each join an explicit overlap owned by the later scene, so a retime keeps
   the seam. A seam check (`scripts/verify-seams.mjs`) should run on a moved scene.
5. **Voice and captions follow the scene.** Voice clips already carry their own `data-start`; tie each to its scene so
   moving a scene moves its voice. Captions come from per-word times and need the same link.
6. **Open and convert.** Opening a storyboard in the editor runs the new build. A project already opened in the old
   single-layer form stays as it is (it keeps the Text tab) unless the person reopens it from the storyboard.

**Prototype first, on one style:** the sketch style (the Xiaomi film used to find this: three scenes, `treatment: sketch`,
rough SVG). Success is: drag scene 2 to a new start, trim scene 3, edit a word as a text clip, and the preview and the
rendered MP4 match a render of the same plan, with the seams intact. Only then convert the other styles, one at a time.

**Not planned:** retiming a scene without moving its voice (the narration is the clock), and editing the spoken line
as text (the voice is recorded audio; changing the words means regenerating it in Studio).

**Proven:** a storyboard film renders and previews correctly as one layer, and its words can be edited through the plan
(Text tab). **Not proven:** scene-local animation for any style, the master timeline reading attributes through the
editor's retime, and joins that survive a move.
