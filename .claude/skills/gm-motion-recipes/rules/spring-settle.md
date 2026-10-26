---
name: spring-settle
description: Closed-form damped-spring step response as a GSAP ease function, plus the motion-weight classes that say when to use it. A pop or settle that overshoots and rings down, with no simulation and no state, so it is correct from any playhead position.
metadata:
  tags: spring, overshoot, settle, pop, ease, weight, micro-ui
---

# Spring settle

A spring is the most natural description of "this has weight and lands": it overshoots, rings, and comes to rest. The way
to make one seek-safe is not to simulate it but to use its **exact step response**, a pure function of progress. Pass it
to GSAP as the `ease`; it is stateless, so it is right on any frame in either direction.

```js
function spring(zeta = 0.5, rest = 0.02) {
  const w = Math.log(1 / rest) / Math.max(zeta, 1e-3);          // so the envelope is within `rest` of 1 at p = 1
  return (p) => {
    if (p <= 0) return 0; if (p >= 1) return 1;
    if (zeta < 1) { const wd = w * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w * p) * (Math.cos(wd * p) + ((zeta * w) / wd) * Math.sin(wd * p)); }
    if (zeta === 1) return 1 - Math.exp(-w * p) * (1 + w * p);
    const r = Math.sqrt(zeta * zeta - 1), s1 = -w * (zeta - r), s2 = -w * (zeta + r);
    return 1 - (s2 * Math.exp(s1 * p) - s1 * Math.exp(s2 * p)) / (s2 - s1);
  };
}
tl.fromTo(el, { y: 30 }, { y: 0, duration: 0.7, ease: spring(0.45) }, t);
```

Full file: `examples/spring-settle.html`.

## Weight classes (use the class, not a taste for bounce)

If everything overshoots, nothing feels precise. Give each class of object ONE setting and keep it for the whole film.

| Class | zeta | rest | Duration | Looks like |
|---|---|---|---|---|
| Micro UI (chip, toggle, button press) | 0.55 - 0.7 | 0.05 | 0.25 - 0.45 s | quick, one small overshoot |
| Pop-in (chips, badges, stat cards) | 0.40 - 0.50 | 0.02 | 0.6 - 0.8 s | clear overshoot (~20% at 0.45), rings down |
| Panel / card / sheet | 0.75 - 0.9 | 0.02 | 0.7 - 1.0 s | controlled settle, ~1-3% overshoot |
| Camera | none: `power3.inOut`, see `camera-rig` | | | smooth, almost invisible |
| Headline | none: strong entrance (`power4.out` / waterfall) then a stable hold | | | arrives fast, held long enough to read |
| Mascot / playful brand | 0.30 - 0.40 | 0.02 | 0.8 - 1.0 s | exaggerated, clearly intentional (springy profile only) |

Overshoot of an underdamped spring is `exp(-pi*zeta / sqrt(1 - zeta^2))`: 0.45 -> 20.5%, 0.5 -> 16.3%, 0.8 -> 1.5%.
The brand's motion profile picks the row set: **snappy** uses zeta >= 0.6 everywhere, **smooth** uses panels only,
**springy** uses pop-ins and a mascot row.

## Constraints that matter

- **Never drive opacity (or any value clamped to 0..1) with a spring.** It overshoots past 1. Fade with a linear tween
  and let the spring drive position or scale.
- **Scale the shape, move the words.** The example scales a `.bg` shape and only translates the label. Large scale ranges on
  text make the glyphs re-rasterise as they grow, which shimmers; a rounded shape scales cleanly.
- **Give every moving element an explicit identity transform before the timeline runs**:
  `gsap.set(els, { x: 0, y: 0, scale: 1 })`. An element GSAP has not touched has `transform: none`; once touched it has
  `matrix(1,0,0,1,0,0)`, which changes how the layer rasterises. Without the baseline, a frame differs by a few pixels
  depending on which frames were drawn first (found while verifying `flood-handoff`: it failed seek safety until set).
- Frame counts are not a spring's friend: `rest` near 0.001 rings for many cycles in a short duration and looks like
  jitter. Prefer `rest` 0.02-0.05 and a duration that gives 1.5-2.5 visible oscillations at most.
- A spring is for arrivals and presses. A looping idle wobble is banned (motion-doctrine, idle motion).

## Verified (2026-10-09)

`check` 0 errors, seek safety pass (byte-identical), text floors pass, rendered 2.45 s: pop gate 0 pops, pacing 0.0% held.
