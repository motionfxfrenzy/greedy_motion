# The seven slots

The film is seven **slots**, not seven fixed screens. Fill them with surfaces the product
actually has, in the product's own language.

| Slot | What it is | What to put there | Budget |
| --- | --- | --- | --- |
| A | Brand lockup | The mark and the wordmark, as **two parts** | ~1.3s |
| B | An entry surface | Sign-in, onboarding, or first-run | ~1.3s |
| C | The same surface, closer | One thing happening in it — a field filling, a toggle | ~1.5s |
| D | One number that matters | The metric the product's users care about, counting | ~1.5s |
| E | A list of places to go | The real primary navigation, and one of them chosen | ~1.9s |
| F | One action, taken | The real primary create affordance, arrived at and clicked | ~3.1s |
| G | The endcard | The lockup lands, plus at most one line | ~1.3s |

## Slot rules

- **A needs two parts.** The counter-bounce is what makes the lockup read as alive, and it
  needs something to bounce against. A single-piece mark can be split into mark and wordmark,
  or a wordmark into two words.
- **B and C are the same surface.** C is closer and doing one thing. Two different screens
  here reads as a tour.
- **D is one number.** Not three. Not a chart. The number the product's users would actually
  quote.
- **E is the real navigation.** Invented labels are the fastest way to make the piece read
  as a template someone recoloured.
- **F is the only slot where something is done.** It gets three times the budget of any
  other slot because arriving at a control, reaching it, and getting an answer is three
  beats, not one.
- **G is at most one line.** The lockup is the message.

## Copy budgets

| Slot | Field | Budget |
| --- | --- | --- |
| A / G | Wordmark | ≤ 12 chars |
| B / C | Surface title | ≤ 16 chars |
| B / C | Field labels | ≤ 14 chars each |
| D | Number label | ≤ 20 chars |
| E | Nav rows | 4–6 rows, ≤ 14 chars each |
| F | Button label | ≤ 16 chars |
| F | Menu rows | 3–4 rows, ≤ 18 chars each |
| G | Closing line | ≤ 34 chars, optional |

## Canvas

| Canvas | Use | Note |
| --- | --- | --- |
| Square | Feed | The default. Everything below is laid out for it first |
| Vertical | Stories, shorts | The card and nav stack; the lockup gets more room |
| Wide | A bumper at the top of a longer film | The nav becomes a row, not a column |

Changing canvas is a re-layout, not a scale. A nav column scaled into a wide frame leaves
two thirds of the frame empty and the piece reads as a crop.

## Numbers that must be measured, not guessed

Two kinds, both in slot E:

- **A row's off-screen start.** Each row slides in from just past its own rendered text
  width, so relabelling changes it.
- **The highlight's resting width.** Text width plus a fixed padding.

Nothing in the film measures text at runtime, on purpose: browser text measurement races
font loading and hands back fallback metrics. Render once, measure a settled frame, paste
the numbers back. The highlight's stamped track is re-anchored onto those numbers, so
relabelling never disturbs the timing.

## Traps that each cost a round

- **A dark theme needs a second list layer.** Light type disappears on a coloured highlight,
  so a dark treatment needs a near-black copy of the rows clipped to the highlight's rect.
- **An icon-only button needs a bigger entry scale** than a wide labelled pill, or the cut
  into it reads as a drop in visual mass.
- **Changing the create affordance moves three numbers together**: the button box, the
  menu's origin (it opens off the button's corner, not over it), and the group nudge that
  re-centres the menu afterwards. Change one, change all three.
- **Measure the mark's real path bounding box** before placing it. Supplied art is often not
  centred in its own viewBox, and a guessed viewBox clips glyphs with no error.
