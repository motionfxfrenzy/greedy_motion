---
name: flood-handoff
description: A colour floods out of an object to fill the frame in 0.35 s, carries a copy of the object's words as the shared element, then contracts into the next object (a chat bubble) and hands over on one frame. A scene-to-scene transition that is also a piece of storytelling.
metadata:
  tags: transition, flood, shared-element, handoff, button, chat, continuity
---

# Flood handoff

The transition is not a wipe: it is the button's colour leaving the button, becoming the page, and then folding into the
next object. The WORDS are the shared element: the label is copied into the flood, grows to headline size, and later
travels into the bubble's text, so the eye never loses what it was following.

**Use it** at a hinge in a product story: a press that causes something (Order now -> your order), a prompt that becomes a
message. **Do not use it** twice in one film, on a light-on-light colour pair (the flood must be a strong accent), or when
the two objects have no relationship (a flood with nothing carried is a flash).

## Parts (full file: `examples/flood-handoff.html`)

| Part | Mechanism | Numbers |
|---|---|---|
| Flood out | a full-frame accent div, `clip-path: circle(r at button centre)`, r from 0 to the distance to the FARTHEST corner (+ a few px) | 0.35 s, `power2.out` |
| Carried words | a copy of the label above the flood, unclipped, starting exactly on the real label; the real label hides on the SAME frame the copy shows; colour flips to the flood's ink colour in 0.2 s | grows to ~3.4x, 0.5 s, `power3.out` |
| Flood in | a second identical full-frame layer swapped in on one frame (`hide(out)`, `show(in)`), `clip-path: inset(...) round R` tweened to the bubble's exact rectangle | 0.55 s, `power3.inOut` |
| Handoff | the real bubble appears and the flood and carried words hide, all on the frame the flood lands | one frame |
| Follow-on | the reply rises out of a mask line | 0.55 s, `power3.out`, 0.12 s stagger |

Two flood layers, not one, because `clip-path` cannot interpolate between a `circle()` and an `inset()`; both are the
same full-frame accent colour, so the swap is invisible.

## Constraints

- **The flood must reach the farthest corner and take about 0.35 s.** Shorter reads as a flash; if the circle's radius is
  short of the farthest corner, the last corner fills late and the wave looks broken. Compute `R` from the button centre.
- **Set `z-index` on every layer**: page 0, bubble 5, button 10, flood 20, carried words 30. Without it, cards float above the
  flood and the wave looks like it is behind the content.
- **Swap on one frame.** The label hide / copy show, the flood layers swap and the bubble handoff are each ONE frame, written
  with zero-duration `fromTo`, never a bare `tl.set` (seek safety).
- **Declare the intended occlusion.** The page text under the flood is hidden on purpose; mark it `data-layout-allow-occlusion`
  or `check` reports `text_occluded`.
- **Identity transforms first** (`gsap.set(..., { x: 0, y: 0, scale: 1 })`), see `spring-settle`.
- **Keep every read-at-rest element inside the title-safe box** (10% inset). The first draft of this example failed that by eye
  on the seam sheet; look at it, do not trust the timeline.
- Sound: a soft press click on the press frame, one whoosh whose PEAK lands on the flood's first full-frame frame (measure the
  clip's peak, do not place by file start), a low pop on the bubble handoff frame.
- A flood is a fast move of about 10 frames. If it smears badly, shorten its travel, do not blur it.

