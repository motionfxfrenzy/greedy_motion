# Blueprint — four acts, one clock

The voiceover is the clock. Lock it (`pipeline.py vo`), derive it (`pipeline.py timing`), then
build. Every time below is *derived*, never typed: a scene's exit starts on the last stressed word
of its outgoing line and its cut (exit end) snaps to a bed beat within ±0.15 s (a J-cut; v1 cut at
the midpoint of a 1.2 s pause, which left the picture waiting); a beat's action is its verb's probed onset.

## Scene table (as built in v1.1; pacing rule three in `craft.md` §5)

| # | Scene | Starts at | Ends at | Beats inside | Seam out |
|---|---|---|---|---|---|
| 1 | Problem | 0 | J-cut on the last problem line's last stressed word | persona flies in (0.6 s) and keeps travelling; one chip pops on each chip word; continuous push 1.00→1.14 + drift | chips + persona converge on centre and shrink (power3.in, 0.36 s) — Z pull |
| 2 | Reveal | that cut | J-cut on the reveal line's last stressed word | shapes slide in from three edges, already moving (0.55 s, power3.out); optional declared stillness ≤ 0.9 s; lockup lands on the name word (scale 1.25→1, expo.out); positioning line on the next clause; push 1.09 + shape parallax to the cut | whole group LEFT, 600 px in 0.32 s, power3.in |
| 3…n | Beat i | previous J-cut (before line i starts) | J-cut on line i's last stressed word (beat-snapped) | field + card enter from the right (900 px / 0.5 s, power3.out; card trails +260 px); screen assembles in a waterfall on the first clause; cursor travels and lands 0.16 s before the verb; press + target reaction on the verb; result; keyword slab on its word; cursor drifts aside; push 1.07 on the target + field/shape parallax to the cut | LEFT, 600 px in 0.32 s, power3.in |
| n+1 | CTA | last J-cut | VO end + 1.2 s | shapes + people enter from the right, people pop on the opener's words; collapse into the lockup on the name word; pill +0.4 s; cursor presses the pill on the CTA verb; ring pulse; cursor leaves; push 1.1 about the press point to the last frame | (end) |

Exit 3·600/0.32 = 5625 px/s matches entry 3·900/0.5 = 5400 px/s: every tour seam is a
velocity-matched cut on the film's one current, LEFT. Shapes on alternating edges and three field
layouts (full-bleed, right 2/3, top band) give variety without new vectors.

Measured from the builds: GM 50.0 s (problem 8.5, reveal 5.7, six beats 4.3–5.5 s each, CTA 7.1);
sample 44.4 s (5.7, 6.6, five beats 4.0–5.8 s, CTA 7.5). Reference: 113 s, beats ~6.5 s.

## Copy budgets (measured on the reference, re-set for video scale)

| Slot | Budget | Why |
|---|---|---|
| problem line | 1–3 × ≤ 90 chars | reference: 3 sentences in 17 s |
| problem chip | 3–6 × ≤ 24 chars | reference bubbles (~50 chars) were unreadable at 720p |
| positioning line | ≤ 56 chars | reference 48 chars, read in ~4 s at 40 px |
| beat line | ≤ 95 chars, verb ≥ 3 words in (≥ 0.7 s) | Kokoro reads ~150 wpm; a 95-char line ≈ 4.2 s |
| beat chip | ≤ 16 chars | reference: "SEO", "Social Media" |
| editor `to` text | ≤ 24 chars | must fit the preview at 44 px display and the field at 25 px |
| player comment | ≤ 40 chars | types at 24 cps inside the beat |
| CTA label | ≤ 22 chars | pill at 36 px |
| CTA line | opener + name + verb phrase | name ≥ 1.2 s after the cut, verb ≥ 0.9 s after the name |

## The six screen kinds (`beats[i].screen.kind`)

Each is a fixed grid inside a 1500×840 card at (210, 150); the cursor target is a computed
constant. Chrome: `stepper` (real step names, active step) or `sidebar` (real nav, active item),
plus brand row (mark + name) and a status pill with the product's real status label.

| Kind | Body | Actions | Target |
|---|---|---|---|
| `tiles` | title, subtitle, 2–4 tiles (image or colour thumb, title, desc, meta), button | select / click | tile `target` → ring + tick, button enables |
| `rows` | title, optional field + button, 1–4 rows (tag, text, sub, swatch, badge) | click button → rows stream in, or badges swap to `badge_after`; select row → ring + tick (+ `badge_after`) | button or row |
| `toggles` | title, optional brand-kit card, rows of toggles or segmented options | toggle | the `target` row's switch |
| `editor` | 16:9 preview frame + scene strip + side panel with a field | type: field focus, old text clears, `to` types at 24 cps, preview headline types in sync | the field |
| `stages` | preview frame + progress panel (stages, a real counter, button) | click: stages tick, counter counts to its real value | the button |
| `player` | video frame with an element, timeline segments, comment panel | click: selection outline + tag, pin drops at the playhead, comment types | the element |

## Per-beat rhythm

1. **0–0.5 s** — the seam: field and card arrive mid-flight; chip rides the field.
2. **to verb − 0.16 s** — the cursor travels (power2.inOut, ≤ 0.9 s) from the last pose; on beat 1
   it enters from below the frame.
3. **verb** — press (scale 0.84, 0.1 s / back 0.22 s) and the target's reaction on the same frame.
4. **verb → +0.4…3 s** — the result plays (ring, toggle, stream, count, typing).
5. **+0.45 s** — the cursor drifts aside (0.6 s) when there is time, never sits on the result.
6. **last 0.32 s** — exit LEFT; the cursor's next travel may start 0.3 s before the cut (handoff).

## Audio

| Layer | Level | Notes |
|---|---|---|
| Voiceover | 1.0 | Kokoro per line at speed 1.1, authored gaps: 0.3 s inside an act (problem lines, tour beats), 0.45 s between acts |
| Bed | 0.2, ducked 7 dB only under words (50 ms / 150 ms) | owned 120 BPM track, looped/trimmed, 0.3 s in / 1.5 s out; cuts snap to its beats ±0.15 s |
| SFX | 0.12–0.55 | whoosh with its peak on every cut, soft click on each keyword, click on every verb, pops on chips/streams, typing under typing, impact + sparkle on the reveal name |
