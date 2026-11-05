# Provenance

Vendored from **anidoodle** engine 0.6.4 (Alex Greenshpun, Apache-2.0; see `LICENSE` and `NOTICE`).

* Source: `experiments/anidoodle-try` (a local working copy of the upstream engine).
* Included: the import closure of the 31 `illus-*` style plates (`src/canvas-core/<plate>.ts` and their kit
  modules), the engine core (`core.ts`, `film.ts`, `gallery.ts`, `music/dsp.ts`) and the browser host (`src/hosts/page.ts`,
  `src/hosts/audio.ts`). `worked-example.txt` is the authoring prompt's worked example.
* Excluded: generated scenes, stories, render outputs, bake caches, browser downloads, experiment tooling and every
  other film module.
* The engine needs no images, fonts or other assets (`assets.images` is always `{}` for plate scenes).
* The optional sound pack and the Van Gogh reference mentioned in `NOTICE` are **not** vendored.

Local changes to vendored files must be listed here and bump `version` in `package.json`.
Currently (version 0.6.5): one local change to the vendored Apache-2.0 sources, a speed fix with identical output (2026-11-05):

* `src/canvas-core/core.ts`: new `insideRing(pts, x, y)`, an exact indexed even-odd point-in-polygon test (bounding box plus edges bucketed
  by height, built once per outline array in a `WeakMap`, with a length / first / middle / last vertex guard; small or non-finite outlines use
  the original loop). It evaluates the identical comparison and arithmetic as the loop it replaces, on only the edges that can toggle.
* The copies of that loop now call it: `gallery.ts` `inside` (still through `adaptPts`), `riso.ts` `inside`, `colouredPencilKit.ts` `inPoly`,
  `scrapbookKit.ts` `inPoly`, `scratchboardKit.ts` `insidePoly`, `brokenColour.ts` `inPoly`, `folkTale.ts` `inPath`, `scrapbookEngraving.ts`
  `occHit`, and the two inline copies in `woodcut.ts`. Nothing else in the files changed.
* Proof of identical output: `test/inside-identity.mjs` (property test against the old loop) and `tools/phase3/engine-identity.mjs`
  (per-style frame hashes, old engine at 23e1963 against this one). See `docs/phase3/engine-inside-report.md`.

`manifest.json` is generated (`npm run manifest -w @videosaas/plate-engine`): it lists the supported styles and the
content digests that enter every cache signature. `manifest:check` fails when a source file changed without it.
