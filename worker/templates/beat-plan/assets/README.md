# Hairline geometry

`hairline-plates.json` contains the four SVG plate interiors from the approved
`experiments/hairline-shot` example. Upstream: https://github.com/lucasmarkes/hairline,
commit `a2217852fed6d1a4f20bc7d43d4fad1a3de117b8`.

The experiment's `build.mjs` projects `figures/exploded.ts` through `core/iso.ts`.
The checked-in geometry removes editor-only `data-hf-id` attributes. Production
builds read this frozen geometry and do not depend on an experiment checkout.
`engine.js` applies theme tokens and a seekable GSAP separation/reassembly animation.

Copyright (c) 2026 Lucas Marques, MIT. See `HAIRLINE-LICENSE`. The template builder
embeds the complete notice in generated HTML so prepared preview and render
projects retain it. The public style sample has its own adjacent license copy.
