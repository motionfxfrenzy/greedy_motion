# gm-velocity-sting changelog

## 1.1.2 — 2026-10-09

- Replace every timeline `set` flip with explicit zero-duration from/to states: focus, typing, CTA press, odometer, navigation selection, menu selection and scene cuts.
- Forward frame comparison against 1.1.1: all 358 frames are byte-identical for the bundled Ledgerly sample. Timing and visual design are unchanged.
- **Seek safety remains unresolved:** reverse/shuffled screenshots still differ after the explicit-state repair, on macOS and Linux Chromium. Keep the known gap; do not claim seek equivalence. The release gate now samples all 358 frame times and three fresh pages. See `docs/SKILL_DELIVERY.md` and `validation/skill-delivery/`.

## 1.1.1 — 2026-10-08

Fix found by the new seek-safety gate (`gm-skill-authoring/scripts/seek_safety.mjs`) while bundling for the hosted app.
- Scene D: the second step's tick and the row classes were flipped with bare `tl.set` calls, so after the playhead had
  passed 5.3 s a backward seek (scrubbing, a retry) still showed the tick. The tick is now always in the DOM and its
  opacity is tweened; the class swaps are explicit from -> to. A forward render is unchanged frame for frame.

## 1.1.0 — 2026-10-08

Made shippable to the hosted app (`docs/SKILL_DELIVERY.md`). No change to the film.
- `slots.json`: `f_menu_rows` declares its item fields (`itemFields`: name 18, meta 14) so the backend can
  validate the list of objects the template already reads.
- `references/fill-guidance.md`: the production fill prompt's skill section.
- `references/sample-values.json`: a complete invented sample (Ledgerly), used by the bundle's gates.

## 1.0.0 — 2026-10-08

Authored from `bs-hyperframes-velocity-sting` and the Greedy Motion build of it
(`experiments/gm-ad-test/velocity-sting/`, 2026-10-04), as a fill-mode template.

Generalised from the one-off build:
- Every string is a HyperFrames variable (`template/index.html` declarations; `slots.json`).
- Every colour and typeface is a theme token; text-on-accent and readable accent/muted inks are
  chosen from the tokens by contrast at runtime. The gradient became the plain accent.
- The mark is the brand kit logo, or a monogram when there is none.
- Nav rows slide by their own width and carry their own highlight pill, so the two pasted text
  measurements of the original are gone.
- The engine is readable `template/engine.js`, inlined minified by `scripts/build-format.mjs`
  (keeps `index.html` under the 300-line check).
- The bed and SFX are premixed to the fixed frame plan, so audio fits every product.

Defects found by the test builds and folded back:
- Build #1 (Greedy Motion): the pacing gate failed twice: a 0.70 s hold in E after the
  highlight landed, and a 0.63 s hold in F after the second click. Fixed with information, not
  motion: the highlight path spread to f202 plus a press on the chosen row (f209); the cursor
  leaves at f290 and the "needs" line arrives under it (f295). Failure rule added.
- Build #2 (Ledgerly, sample): a one-word brand split into "Ledger" + "ly" read as a typo.
  `brand_word_2` is now optional; the mark and wordmark are the two bouncing parts. Failure rule
  added.
- Tooling: GSAP 3 dropped `className` tweens, so class stamps use `attr: { class }`.
