---
name: glow-flyline
description: Data flow on a dark ground. A glowing bezier arc is shot from one card to the next (bright head, dim tail that evens out), and the landing frame fires the target card's edge pulse and a surge in the nearest ambient glow orb together. Three parts on one clock - ambient orbs, the arc, the relay.
metadata:
  tags: dark, glow, data, dashboard, connection, bezier, svg, relay, orbs
---

# Glow fly-line

The ambient orbs give the dark ground a pulse. The arc gives a metric a direction: this number flows into that one.
The relay welds them: on the frame the arc lands, the target card pulses and the nearest orb surges **on the same
frame**, so background and event answer each other. If the surge is two frames off the pulse, the effect falls apart
into two unrelated things.

**Use it** for one dark-ground segment of a film (a dashboard story, "data in, result out"). **Do not use it** on a
light ground (see the constraint below), or for three or more connections in a row without the relay, where plain arcs
read as a big-screen template. At most one dark segment per film: switching light to dark and back needs a hidden cut.

## Parameters (starting points; retune with the brand's own colour pair)

| Part | Value | Notes |
|---|---|---|
| arc growth | 22 frames (0.733 s), `power3.out` | one ease for base, hot window, head and halo, so they stay locked |
| arc line | 4.5 px bright line over a 15 px translucent glow stroke | the glow stroke replaces a blur filter (cheaper, same read) |
| hot window | 0.3 of the arc length trails the head | the "bright head, dim tail" |
| tail | base line appears at 0.45 opacity, evens to 1.0 over 10 frames after landing | |
| head | 18 px dot + 56 px halo at 45%, only while the arc is growing | removed at landing (opacity 0), never left idling on the line |
| landing pulse | ring scales 1 to 1.06 in 0.2 s (`power3.out`), fades over 0.4 s; card border brightens in 0.267 s and settles to 30% | |
| orb surge | opacity x2.6 over 5 frames, back to base over 15 frames, on the landing frame | the orb nearest the target |
| orbs | three radial gradients 760 px at 32 / 22 / 18% opacity; x and y drift on unequal periods | no blur filter needed; they keep drifting to the last frame |

## Mechanism (full file: `examples/glow-flyline.html`)

The arc is drawn with SVG dash windows on a path with `pathLength="1"`, so dash units are fractions of the arc:

```js
// base + glow stroke: dashoffset 1 -> 0 reveals the line from the start
tl.fromTo(base, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: GROW, ease: "power3.out", immediateRender: false }, start);
// hot window: dasharray "0.3 2", dashoffset 0.3 -> -0.7 keeps a 0.3-long bright stripe just behind the head
// head: dasharray "0.0005 2" with a round cap is a dot; dashoffset 0 -> -1 rides the tip
// relay: pulse + card edge + orb surge all start on `land = start + GROW`
```

## Constraints specific to this recipe

- **Tween `attr:{"stroke-dashoffset":...}`, never the CSS property.** GSAP rounds a CSS `stroke-dashoffset` tween to
  whole pixels. With `pathLength="1"` that means the value goes 1 to 0 in one jump, so the arc pops on instead of
  growing. Measured in the page: a CSS tween whose value should have been about 0.38 read `0px`; the same tween as an
  attribute read `0.379456`. Keep the initial offset as an attribute in the markup and never also set it in a stylesheet (CSS beats the
  attribute).
- **Dark ground only as built.** On a white ground a white line vanishes and a glow cannot brighten. A light-ground
  version needs a dark underlay under the line and a darkening pulse instead of a glow; that version is not built or
  tested here.
- **Initial states belong in CSS or markup.** `tl.set(..., 0)` hides do not render while the playhead is at 0, so frame 0
  would show the un-hidden state (`check` flags it). Use CSS for the opacity and dash starting values, and `gsap.set`
  outside the timeline for the orbs' baseline.
- **Orbs must keep moving.** Easing them to a frozen stop makes a visible brake and then a hold. Let them drift to the
  last frame (the pacing standard has no still holds).
- Give each arc its own end state: head and halo are removed at the landing frame (an unused opacity-0 element is fine,
  an idling glowing dot is not).
- Sound, if the film has a bed: a soft tick on each landing frame; the orbs are silent.

## Verified

`check` 0 errors; seek safety pass; text floors pass (smallest read text 32 px); pacing 0.0% held, longest hold 0.5 s;
render 3.6 s in 5.6 s. Frames viewed at 1.0, 1.43, 1.9 and 2.48 s plus zoomed crops of the second arc at 1.8 to 2.1 s.

Source: see `ATTRIBUTION.md`.
