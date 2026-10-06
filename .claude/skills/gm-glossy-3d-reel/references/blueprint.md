# Blueprint: seven shots, one camera

Timings are the reference cut at 30fps (17s total) on a 120 BPM grid (0.5s per beat). In a real
build, every boundary moves to the nearest beat of the locked track.

| # | id | Start | Dur | Camera (35mm unless noted) | Subject | Seam out (axis, sign) |
|---|---|---|---|---|---|---|
| 1 | `studio` | 0.0 | 2.5 | Slow dolly-forward plus a right truck; a 3° roll eases to 0 | Props drift on independent offsets; one accent prop drifts toward the lens | Whip up (y −1) |
| 2 | `verb` | 2.5 | 2.5 | 50mm, 20° top-down, tiny push at the snap | Keycaps fall staggered, tumble, and snap into `verb` on a beat; last key in the accent | Match-cut (z +1): last key → mark wedge |
| 3 | `ring` | 5.0 | 2.5 | Orbit ~40°/s, slightly low angle | The mark turns; `inputs` ride a ring tilted 25°; the nearest word passes the lens blurred | Push through the mark (z +1) |
| 4 | `cards` | 7.5 | 2.5 | 28mm lateral arc, right → left | `cards` un-fan into a row, each with UI subtly moving; `headline` fades up | Whip right (x +1) |
| 5 | `range` | 10.0 | 2.5 | 50mm front-on, ~3% push | `pills_left` / `pills_right` slide in staggered; accent arrow rises | Tilt up with the arrow (y −1) |
| 6 | `before-after` | 12.5 | 2.0 | Front-on, then a fast dolly into the after card | Before card static and grey; arrow draws; after card alive with speed trails | Fly-through (z +1) into the lockup ground |
| 7 | `lockup` | 14.5 | 2.5+ | Locked, ~1% push | Speed-dashes streak in, mark lands, lockup wipes, `closing_line` fades; hold 1.2s or more | End on the music hit |

## Copy budgets (also enforced by `slots.json`)

| Slot | Budget | Why |
|---|---|---|
| `verb` | 4–5 chars | Keycaps must read at 1/6 frame width each |
| `inputs` | 4–5 × ≤ 12 | One word fully legible per ring position |
| `headline` | ≤ 26 | One line at 64px+ |
| `pills_*` | ≤ 18 each | Pill text ≥ 28px at 1080p; the reference build was too small at 18px |
| `closing_line` | ≤ 40 | One line under the lockup |

## Audio

| Layer | Level | Notes |
|---|---|---|
| Music | 0.7 | Structural; shot changes land on beats |
| Hits / whooshes | 0.4–0.5 | On every seam and the keycap snap |
| Sub-hit | 0.6 | The lockup only |

Master to -14 LUFS / ≤ -2 dBTP after encode.
