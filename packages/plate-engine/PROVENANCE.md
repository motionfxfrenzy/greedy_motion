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
Currently: none (files are byte-identical to upstream 0.6.4).

`manifest.json` is generated (`npm run manifest -w @videosaas/plate-engine`): it lists the supported styles and the
content digests that enter every cache signature. `manifest:check` fails when a source file changed without it.
