# gm-velocity-sting changelog

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
