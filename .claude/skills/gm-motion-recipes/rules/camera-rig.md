---
name: camera-rig
description: One camera for a whole scene. A single transform on a world container, computed from time alone by interpolating keys of [time, zoom, x, y], with zoom interpolated in log space so every push and pull feels equally fast. Seek-safe by construction (no state between frames).
metadata:
  tags: camera, zoom, pan, push-in, log-space, keyframes, continuity
---

# Camera rig

Every scene gets exactly one camera, and it is a function of time: `cameraAt(t) -> { zoom, x, y }` written to ONE
transform on a `#world` container. Nothing inside the scene carries its own zoom. Because the function takes only `t`,
a frame can be drawn in any order, which is the seek-safety rule (shared-craft, Determinism) satisfied by construction.

**Use it** for any scene where the camera pushes, pans or pulls: product tours, UI close-ups, a feature walk. **Do not
use it** for a scene whose camera is deliberately handheld, or where a seam handoff (motion-doctrine) needs the camera
to continue the previous scene's vector: set the first key's velocity from the seam ledger instead of the default.

## Mechanism (full file: `examples/camera-rig.html`)

```js
const KEYS = [[0, 1.0, 960, 540], [1.2, 2.0, 500, 350], [2.2, 2.0, 1380, 700], ...];  // [time, zoom, x, y]
// x,y is the WORLD point under the screen centre. The world is frame-sized, so zoom 1 at (960, 540) is the whole picture.
const u = SEGMENT_EASE((t - t0) / (t1 - t0));
const zoom = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * u);   // log space
world.style.transform = `translate(960px, 540px) scale(${zoom}) translate(${-x}px, ${-y}px)`;
// one linear tween drives it: tl.fromTo(clock, { t: 0 }, { t: DURATION, duration: DURATION, ease: "none", onUpdate: applyCamera }, 0)
```

## Why log space

Perceived zoom speed is the RATIO of sizes, not the difference. A linear tween from 1x to 4x spends its first half going
1 -> 2.5 (a 2.5x change) and its second half 2.5 -> 4 (1.6x), so the push seems to slow as it arrives. Interpolating
`ln(zoom)` makes 1 -> 2 and 2 -> 4 take the same time at the same eased pace. It matters on every push of more than ~1.5x.

## Rules

- **One eased move per scene segment, and never in-out-in.** A push, then a pan, then a push is fine; zoom in followed
  at once by zoom out reads as a wobble. At most ONE reversal of zoom direction in a film, and it is the final pull back.
  The camera never reverses a pan direction either (motion-doctrine, vector law).
- **Ease each segment, chain the segments.** `power3.inOut` per segment gives a smooth stop at every key; use `power2.out`
  for a segment that must hand its speed to the next scene.
- **Keys carry the story.** Put a key on every beat the camera answers to (the verb, the reveal), not on a regular grid.
- **Content must read at the zoom it is shown at.** Text sizes are measured on what the viewer sees (zoom x font-size),
  so a 36 px label at zoom 1 passes the text gate in a close-up and a card that is only seen at zoom 1 must carry
  floor-size text at zoom 1.
- **Keep elements that must stay put off the world.** A fixed caption, logo bug or progress bar sits in a sibling of
  `#world`, not inside it.
- **Write the transform with `element.style`, not a tween.** The camera is the only thing that writes `#world.style`.
  Do not also tween `#world` with GSAP.
- A fast camera move is a motion-blur candidate: slow the move down before adding blur. <!-- cloud:skip-from --> Local tool: `scripts/subframe-render.mjs`.

## Verified (2026-10-09)

`check` 0 errors, seek safety pass, text floors pass, rendered: pop gate 0 pops / 0 cuts, pacing 0.0% held, longest hold 0.
Frames viewed on the 1x, 2x, 2x-pan, 3.2x and pull-back segments.

Source of the idea: a public prompt-and-guide pair read on 2026-10-09 (see `ATTRIBUTION.md`); the implementation is ours.
