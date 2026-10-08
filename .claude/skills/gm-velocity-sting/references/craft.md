# Craft: velocity sting

Determinism, audio and pacing rules shared by every gm skill are in
`.claude/skills/gm-skill-authoring/references/shared-craft.md`; this file adds only what is
specific to this structure.

## The ease family

```js
const EO = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));  // arriving
const EI = (p) => (p <= 0 ? 0 : Math.pow(2, 10 * (p - 1)));  // leaving
```

Pass the functions. `"expo.out"` / `"expo.in"` look the same and are not: they shift exits by
several pixels and break the matched cut.

## Tween or stamp

Curves are tweens (a card sliding, a blur ramping with it). Decisions are stamped with
`tl.set(...)`: the typing rhythm, the odometer values, the highlight's path, class changes
(`attr: { class }`; GSAP 3 has no `className` tween). Stamps are exact and seek-safe.

## Uneven on purpose

Rows arrive with shrinking gaps; typing and the odometer come from fixed uneven patterns, so
the same values always produce the same frames, and nothing reads as generated.

## Derived blur

Seam blur ramps on the same ease as the move, so it peaks when the element is fastest:
10 px on x/y seams, 18 px on full-frame z seams.

## Brand

Only theme tokens. `--on-accent` (text on the accent) is the most readable of `--bg`, `--fg`,
`--surface`; `--accent-ink` is `--accent` (else `--brand`) when it reaches 3:1 on `--bg`, else
`--fg`; `--muted-ink` is `--muted` when it reaches 4.5:1 on `--surface`. Shadows are neutral
black at low alpha. Logos come from the brand kit; with none, a monogram in the accent.

## Layout without measurement

Text width is never measured or pasted: nav rows slide by `xPercent: −100` plus 24 px, each row
is its own pill (the highlight is the row's own background, stamped on and off), and buttons
sit in a flex row so a longer label pushes its neighbour instead of overlapping it.

## No idle motion

Nothing floats or breathes. An empty beat gets information (a press, a line arriving), checked
by the pacing gate.
