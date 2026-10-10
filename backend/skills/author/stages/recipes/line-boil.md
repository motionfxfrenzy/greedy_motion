---
name: line-boil
description: A living hold for ink and drawn styles. An SVG noise filter re-traces the outlines every 3 frames while position and content stay put, so a title card can hold for seconds without reading as frozen. The filter exists only inside the boil window.
metadata:
  tags: ink, hand-drawn, hold, svg-filter, typography, texture, living-hold
---

# Line boil

Hand-drawn animation has always kept still frames alive by re-tracing the outline every few frames. Nothing moves; the
edges breathe in discrete steps. Here that is `feTurbulence` + `feDisplacementMap` on the ink layer, with the noise seed
stepping every 3 frames (10 Hz).

**Use it** for the long hold of a title card, an end card, or an outline-only element in a drawn or ink style (the
anidoodle styles, paper-and-ink brands). **Do not use it** on photos, screenshots, the logo, or small solid shapes
(icons, avatars read as blur), and not in clean/vector brand styles, where it looks like a defect.

## Parameters (starting points; retune on the real artwork)

| Parameter | Value | Feel |
|---|---|---|
| displacement `scale` | 8 for large headlines; 5–6 for small type and thin strokes | below 4 is imperceptible; above 12 reads as a glitch |
| re-trace rate | seed steps every 3 frames (10 Hz) | every 2 is electrical noise; every 4 or more reads as dropped frames |
| `baseFrequency` | 0.015, `numOctaves` 2 | the deformation is about one letter-height in scale; 0.05+ becomes rough-edge noise, not a re-trace |
| groups boiling at once | at most 1 | headline and card boiling together leaves no focal point |
| clean tail | at most 0.6 s before the end (see pacing, below) | the snap back to clean is itself a small resolve |

## Mechanism (full file: `examples/line-boil.html`)

```js
tl.set("#ink", { filter: "none" }, 0);
tl.set("#boil-noise", { attr: { seed: 1 } }, 0);
// attached for the window only
tl.fromTo("#ink", { filter: "none" },        { filter: "url(#boil)", duration: 0, immediateRender: false }, BOIL_START);
tl.fromTo("#ink", { filter: "url(#boil)" },  { filter: "none",       duration: 0, immediateRender: false }, BOIL_END);
// baked seed steps: explicit from -> to, so seeking backwards restores the previous seed
let prev = 1;
for (let k = 0, t = BOIL_START; t < BOIL_END - 1e-6; k++, t += 3 / 30) {
  const seed = 2 + k;
  tl.fromTo("#boil-noise", { attr: { seed: prev } }, { attr: { seed }, duration: 0, immediateRender: false }, t);
  prev = seed;
}
```

## Constraints specific to this recipe

- **Remove the filter outside the window; do not fade it.** An attached filter at opacity 0 still costs paint and the
  layer never settles. The window is `filter: url(#boil)`; before and after it is `none`.
- **No `Math.random`, no `onUpdate`.** Seeds are baked, one explicit `fromTo` per step, so any seek order gives the same
  frame. Verified: `seek_safety.mjs` passes (forward, reverse, shuffled, fresh page).
- **Only ink goes in the layer.** Put type and outlines inside the filtered element; everything else (logo, screenshots,
  video) sits outside it.
- SVG filters cost more on large areas. A full-frame ink layer at 1080p rendered 6 s in 8.5 s here; do not wrap a whole
  page screenshot in it.

## Pacing and the idle-wobble ban (measured)

`motion-doctrine` bans idle wobble, motion that breathes without performing. This is not that: it is discrete re-trace
steps on a drawn hold, and it is the hold's only motion. Our pacing gate agrees:

| Same 6 s ink title card | Held at 0.6 s | Longest hold | Gate |
|---|---|---|---|
| boil off (the layer just sits) | 89.5% | 5.37 s | **fail** |
| boil on (0.6 s to 5.4 s) | 0.0% | 0.6 s (the clean tail) | pass |

So a boiling hold is legal under the no-dead-space standard, and a still one is not. Use it only where the style is
drawn, and do not let it excuse a scene that has nothing to say.

Sound: none. Source: see `ATTRIBUTION.md`.
