# Film blueprint — seven scenes

Durations below are the reference cut at 1920x1080 / 60fps, total 39.5s. They are a
starting grid only. **The voiceover is the clock**: lock the audio, transcribe it, and
derive every scene boundary from real word timestamps. A regenerated read re-opens every
seam it touches.

| Scene | id | Start | Dur | Beat | Sustained-motion route | Seam OUT |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `connector` | 0.0 | 6.7 | Cursor opens a menu, scrolls to your product's row, and flips the toggle; the row lifts and the mark lights | Cursor-led action | Hard cut, composer aligned |
| 2 | `ask` | 6.7 | 6.9 | The question types into the composer; cursor taps send; the composer settles into the thread | Cursor-led, then sequenced UI life | Cut-the-curve LEFT |
| 3 | `answer` | 13.0 | 6.7 | Prose streams in editorial serif and scrolls under a soft top/bottom mask; a tool pill appears mid-answer | Sequenced UI life | Cut-the-curve LEFT |
| 4 | `followup` | 19.4 | 6.0 | The second prompt types — the one that needs your product — and sends | Cursor-led | Z-forward into the composer |
| 5 | `thinking` | 25.0 | 1.5 | One big quiet beat. A single mark, a single breath | Stillness before climax | Z-forward, still growing |
| 6 | `result` | 26.3 | 10.0 | Checklist rows cross off, the list morphs into the output card, the card plays, and the headline number counts up | Animated sequence, then sequenced UI life | Upward into the outro |
| 7 | `outro` | 36.1 | 3.4 | The lockup rises onto the canvas and holds | Staged reveal | End |

Scene 1's final composer position must match Scene 2's opening composer position exactly.
The hard cut between them works because the composer does not move across it — it is the
carrier.

---

## The eight copy slots

| Slot | Count | Budget | Purpose |
| --- | --- | --- | --- |
| `product_row` | 1 | ≤ 28 chars | Your product's name as it reads in the connector menu |
| `question` | 1 | ≤ 90 chars | The first ask, in a real user's voice |
| `answer_prose` | 3–5 | ≤ 110 chars each | Short paragraph lines; editorial, not marketing |
| `tool_pill` | 1 | ≤ 24 chars | The label on the tool chip that appears mid-answer |
| `followup` | 1 | ≤ 110 chars | The ask that invokes your product |
| `tasks` | 4–6 | ≤ 42 chars each | The checklist rows the product actually runs |
| `hero_stat` + `hero_label` | 1 pair | number + ≤ 30 chars | The count-up and what it measures |
| `outro_line` | 1 | ≤ 44 chars | The closing line above the lockup |

Slot rules:

- `question` is a question a user would genuinely type, not a setup line. If it reads as
  written by marketing, the whole film reads as staged.
- `answer_prose` is what makes the middle of the film watchable. It must be actual content
  worth reading for three seconds, in serif, with real specificity.
- `followup` is the hinge. It is the only line whose job is to name what your product does.
- `tasks` must be things the product really runs, in the order it really runs them.
- `hero_stat` is a real, defensible number. If it is not, cut the count-up entirely.

---

## Scene 1 — connector

The film opens inside software, not on a title.

1. The canvas holds a compact lockup and a composer. Nothing else. It should read as "this
   is an app" within half a second, without faking a full home screen.
2. The cursor enters off-screen, travels to a control, and opens a dark menu panel. The
   menu is a panel, not a light popover — a light popover breaks the whole frame.
3. It scrolls one row at a time. Rows highlight on the elevated panel value; the selected
   row uses the pressed value.
4. It lands on `product_row` and clicks the toggle. The toggle track flips to ink with a
   canvas-colored knob; the row lifts ~2px; your mark's accent pair lights for the first
   time in the film.
5. The menu compresses away and the composer is left in its Scene 2 position.

Click SFX at the exact frames of the two menu clicks and the toggle. A low sub hit on the
toggle sells it as a state change rather than a hover.

## Scene 2 — the ask

1. `question` types into the composer at ~26 chars/second. Reveal by animating the clipped
   line's width, never by mutating text per frame — a per-frame text mutation is not
   seekable and the render will disagree with the preview.
2. A block caret rides the reveal edge. The simplest correct implementation is a
   `border-right` on the clipped element, so the caret is the edge.
3. Keyboard SFX runs under the type, ducked well below the voice.
4. The cursor taps the send control: press ~0.92 for 80ms, release on `back.out(1.5)` over
   140ms. The send flash and the composer's dock start on the **same frame** as the press.
5. The typed line detaches and settles into the thread as a user message.

## Scene 3 — the answer

1. Prose streams in as whole lines, ~0.28s apart, in the editorial serif at 30–34px.
   Streaming character-by-character at this length is unreadable at video speed.
2. The thread scrolls upward under a soft mask at the top and bottom of the panel
   (`mask-image` with a linear gradient), so lines fade rather than clip.
3. Around 60% through, `tool_pill` appears as a mono chip — the first visible sign that
   the assistant is using your product.
4. Do not add idle motion here. The scroll is the sustained motion, and the reading is the
   content.

## Scene 4 — the follow-up

The same typing grammar as Scene 2, faster (~30 chars/second), because the viewer already
knows how it works. On send, push into the composer on Z-forward — the film is about to go
somewhere.

## Scene 5 — thinking

1.5 seconds. One mark, shimmering at a low amplitude with a **finite** repeat count. No
progress bar, no percentage, no spinner text. The frame is nearly still and the voice
carries it.

This scene will feel too long while you are building it and exactly right in the cut.

## Scene 6 — the result

The payoff, and the longest scene. Three movements:

1. **The checklist completes.** `tasks` rows are already on screen; the last three cross
   off on a 0.55s cadence. A strike-through draws left to right, the row dims, and a check
   snaps in. This is an animated sequence, not a fade.
2. **The list morphs into the card.** The list container's own box becomes the output
   card: same element, tweened width/height/radius, contents swapped at the midpoint. The
   morph is the carrier — do not cut here.
3. **The number counts up.** The headline value climbs to `hero_stat` over ~1.6s on
   `power2.out`, with the label revealing underneath. Drive it from a plain object tweened
   by GSAP and write the formatted value into the DOM in `onUpdate`, so seeking to any
   frame produces the same number. Never drive it from a clock or an interval.

A short flash and a small burst at the moment the number lands is the one decorative
flourish this film gets.

## Scene 7 — outro

The lockup rises — the film's one upward vector — onto the empty canvas, with
`outro_line` above it. Hold. The music bed resolves. End on stillness.

---

## Audio

This film is narrated, and the mix has four layers:

| Layer | Level | Notes |
| --- | --- | --- |
| Voiceover | 1.0 | The clock. Scene boundaries derive from its word timestamps. |
| Music bed | ~0.13 | One continuous track under the whole runtime. |
| Interaction SFX | 0.5–0.55 | Mouse clicks, on the exact frames of cursor presses. |
| Typing | ~0.24 | Under the two typing scenes only. |

Rules:

- Every `<audio>` element needs an `id`. An id-less `<audio>` is never picked up by the
  mixer and the render is silent with no warning.
- Place a click SFX on the frame of the press, not after it.
- Duck the bed ~4dB under the thinking beat so the silence reads as deliberate.
- Verify the audio stream exists in the final `ffprobe` output before delivering.
