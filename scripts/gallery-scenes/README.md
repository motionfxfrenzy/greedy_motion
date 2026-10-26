# Gallery preview scenes

Each folder `scripts/gallery-scenes/<id>/` is one hand-authored preview: a self-contained HyperFrames composition of about
5 seconds (`index.html`, plus any local assets) and a `row.json` with its catalog fields. Render one with

    node --experimental-strip-types scripts/build-gallery-scenes.mjs <id>

which writes `var/gallery-src/<id>.mp4` and `<id>.jpg`. `scripts/merge-gallery-scenes.mjs` collects the rows into the catalog.

Contract for `index.html`
- Root element: `<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="1280" data-height="720">`;
  1280x720 keeps WebGL renders quick. Duration is exactly 5 (set `data-duration` explicitly, especially for Three.js).
- One paused GSAP timeline registered as `window.__timelines["main"]`. Everything is a pure function of time: no
  `Date.now`, no unseeded `Math.random` (use a seeded PRNG), no `requestAnimationFrame` loop, no CSS keyframe animation, no network.
- Load libraries from `vendor/`: `<script src="vendor/gsap.min.js"></script>`; Three.js as
  `import * as THREE from "./vendor/three/three.module.js"` (r181, local, no CDN). For Three.js render on every seek:
  `window.addEventListener("hf-seek", e => draw(e.detail.time))` and once at load (see `.claude/skills/hyperframes-animation/adapters/three.md`).
- Fonts are injected for you (`Inter`, `Space Grotesk`, `JetBrains Mono`, `Source Serif 4`, `EB Garamond`, `Newsreader`, `Instrument Serif`,
  `DM Mono`, `IBM Plex Mono`, `Archivo Black`, `Bebas Neue`, `Playfair Display`, `Libre Baskerville`, `Fredoka`, `Quicksand`).
- Set an opaque background on the root. Text must be readable at 480 px wide (the preview is shown small): big type, few words.
- No real people, brands or logos. No invented statistics. The first 0.4 s must already show something; the last 0.5 s holds the finished frame.
- Read `.claude/skills/hyperframes-core`, `hyperframes-animation` and the example `worker/templates/product-launch/index.html` for the composition rules.

Longer or square clips: a `row.json` may carry `"duration"` (seconds, up to 16) when the reference is a full piece rather
than a 5-second moment; set `data-duration` and the timeline to match. A square composition (`data-width`/`data-height`
equal) is shown in a square card because the catalog row's `aspect` is `1:1`. `"previewOnly": true` rows only supply
the clip for a catalog row that lives elsewhere (the id must equal that row's id).
