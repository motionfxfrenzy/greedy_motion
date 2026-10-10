---
name: scroll-brake
description: A long list streaks past as a blurred band, brakes exponentially and stops with the target row dead centre; the target lifts and the others dim. Mode B adds an overshoot and four corner brackets that clamp the target on the brake frame. Blur is computed from the scroll's own per-frame speed, never hand-keyed.
metadata:
  tags: list, scroll, changelog, blur, brake, rhythm, ui
---

# Scroll brake

"We ship all year, and this one is the biggest." Density says the first half (a year of entries blurred into a band); the
hard stop says the second (this one). Use it for changelogs, release histories, any long list with one entry that
matters.

**Do not use it** with a list that has no clear target, or where the entry must be read before the stop (the band is
unreadable by design). One use per film; it is not a general scroll.

## Two modes

| Mode | Scroll | Stop | Blur |
|---|---|---|---|
| A (default) | one tween, `expo.out`, 50 frames | dead stop, then the target lifts (scale 1.03, 3 px border, shadow) and the others fade to 0.38 | `min(6 px, speed x 0.1)` |
| B (`LOCK = true`) | accelerate with `sine.in` (38 frames), brake with `power3.out` past the stop by 30 px (9 frames), settle with `power2.out` (4 frames) | four L brackets fly in from 620 / 320 px off-screen with `back.out(2.4)` and clamp the target **on the brake frame** | `min(24 px, speed x 0.12)` |

In mode B the "thud" (the list braking) and the "click" (the brackets clamping) land on one frame. Move either by two
frames or more and they read as two separate moves.

## Mechanism (full file: `examples/scroll-brake.html`)

The scroll is described once, as pieces, and everything is derived from it:

```js
const PIECES = [{ f0: 14, f1: 64, from: 40, to: S_FINAL, ease: "expo.out" }];   // mode A
const scrollAt = (f) => /* evaluate the pieces with gsap.parseEase(piece.ease) */;
// 1. the list moves:   tl.fromTo("#col", { y: -p.from }, { y: -p.to, duration, ease: p.ease, immediateRender: false }, p.f0 / FPS)
// 2. blur from speed:  v = |scrollAt(f) - scrollAt(f-1)|;  blur = min(CAP, v * K)
//    one explicit from -> to step per frame: tl.fromTo("#col", { filter: "blur(prev px)" }, { filter: "blur(b px)", duration: 1/FPS, ease: "none", immediateRender: false }, (f-1)/FPS)
```

A hand-keyed blur can never match the speed of an eased scroll. Differencing the same function makes the two
impossible to drift apart (and it is deterministic, so it is seek-safe).

## Constraints specific to this recipe

- **The target is centred on purpose.** `S_FINAL = targetCenterY - 540`. A stop off centre reads as an accident.
- **Fast rows carry no readable text** (grey blocks are enough; they are a band). **The target row carries real,
  readable content**, at or above the text floors (the example's target text is 48 px, the pill and date 32 px).
- **Never dim the others to 0.** 0.38 keeps the context; at 0 the list disappears and the stop means nothing.
- **Declare the scroll surface.** The rows sit far outside their parent's box by design; `check` flags that as
  `escaped_container`. Put `data-layout-allow-overflow` on the scroll surface (`#col`), as the example does.
- **End soon after the lift.** Eased tweens go visually still about 0.15 s before their nominal end. The first version
  of this example ended 0.57 s after the lift's nominal end and measured a **0.867 s** hold (gate fail). Cut to 3.0 s and
  it measures 0.5 s (mode A) and 0.567 s (mode B), both passing. In a film, cut away or move into the next beat rather
  than sitting after the lift.
- Keep the list one vertical vector: an exit from this scene should continue upward or push on, not reverse
  (motion-doctrine, vector law). This recipe does not decide the seam.
- Sound, if the film has a bed: a low riser under the streak, one impact on the brake frame, and in mode B a short click
  on the same frame (a different voice, same frame).

