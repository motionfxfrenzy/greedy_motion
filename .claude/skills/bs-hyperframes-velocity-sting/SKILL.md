---
name: bs-hyperframes-velocity-sting
description: Build a short product sting where every cut is velocity-matched, so seven scenes read as one continuous camera move instead of a stack of screens. Delivered as a rendered MP4 plus a single-file project carrying a seam ledger, so the piece can be re-branded later without the motion coming apart.
---

# Velocity-Matched UI Sting

A ten-to-thirteen second product sting: a lockup, an entry surface, a number that matters, a
list of places to go, one action taken, and an endcard. Nothing in it settles. Every scene is
still travelling when its cut arrives and the next one enters already in flight on the same
axis, which is why the piece reads as one move rather than seven.

Built as one HTML file — no sub-compositions, no build step — and rendered to MP4 by the
HyperFrames CLI.

## Style origin

The velocity-matched cut, the single-ease-family discipline, the seam ledger, and the
seven-slot structure are abstracted from a publicly published set of HyperFrames motion
templates. The subject, copy, palette values, frame plan, and every asset are authored fresh
for the caller's product. Nothing in the output states or implies affiliation with,
endorsement by, or authorization from any company the caller does not own.

## When to use

Use this for a product sting: a social post, a launch-day loop, a conference-screen bumper,
the ten seconds at the top of a longer film. It wants a product with real surfaces — a
sign-in, a number, a nav, a create button — and it wants to be short.

Do not use it to explain anything. There is no room; the piece is a texture and a feeling,
not an argument. If the brief is "explain what we do", this is the wrong structure.

## The two rules this film lives by

**One. One ease family.** Every decelerating move uses the same curve and every accelerating
move uses its mirror. Nothing overshoots, nothing is linear, nothing bounces on a stock
elastic. Because it is one family, moves that were never individually tuned still look like
they belong together.

**Two. Matched vectors at every cut.** No scene settles before its cut and none starts from
rest after one. The outgoing element is still travelling when the frame changes and the
incoming element enters already moving — same axis, same direction, similar speed. That one
rule is the whole difference between a continuous move and a slideshow.

Both rules are written down rather than remembered: the eases are two named functions, and
the seams are a `ledger.json` with one row per cut naming the axis and sign each side must
satisfy. `references/motion-contract.md` and `references/seam-ledger.md` carry both.

## Required input

- The product, and its **seven slots** — see `references/slot-map.md`. A lockup in two
  parts, an entry surface, one number, a real navigation, one create affordance, an endcard.
- **Brand tokens**: a ground, an ink, one accent, a hairline. Four values is enough.
- **The mark**, as a real file, in two parts if it has them.
- The canvas: square for feed, vertical for stories, wide for a bumper.
- Optionally a music bed under whatever licence the caller holds.

## The rights rule for brand capture

The CLI has a `capture` step that pulls a site's real logo files, colour values, and font
references. It is the right way to get a brand's assets and the wrong way to get someone
else's:

- Run `capture` **only** against a site the caller owns or holds written permission for.
- If there is no such site, ask for a mark and three hex values. That is enough.
- Never lift a third-party product's UI, iconography, or screenshots into the slots. The
  surfaces are the caller's own or neutral originals.
- Type is a separate question from the mark. If the brand face is not redistributable,
  substitute an open one with a similar skeleton and say so in the handoff.

## Retarget to the user's product

1. **Fill the seven slots** with surfaces the product actually has, in the product's own
   language. A design tool has files and frames; a payments app has balances; a library app
   has collections. Getting this mapping right is most of what separates a re-brand from a
   recolour.
2. **Set the four tokens** and place the mark. Run the mark's real path bounding box before
   placing it — supplied art is frequently not centred in its own viewBox, and a guessed
   viewBox clips glyphs silently.
3. **Keep the frame plan and the eases.** Retiming is allowed, but a moved frame number
   means re-checking the seams either side of it.
4. **Re-measure what cannot be guessed.** Nothing measures text at runtime, on purpose.
   See the workflow step below.

`references/rebrand-checklist.md` gates all of this.

## Workflow

1. **Load the HyperFrames stack.** Read `/hyperframes`, then `/hyperframes-core`,
   `/motion-doctrine`, `/seam-craft`, `/cut-the-curve`, and `/oversized-cursor`.
2. **Run the retarget gate**, including the rights position on brand capture.
3. **Write the frame plan and the seam ledger first**, before any HTML. The ledger is a plan,
   not a record: authoring it after the fact means writing down whatever the film happens to
   do.
4. **Build the scenes in order**, one HTML file, no sub-compositions. `npx hyperframes lint`
   after the first pass.
5. **Stamp the choreography.** Anything that is a *curve* is a tween; anything that is a
   *decision* — a typing rhythm, an odometer's values, a highlight's path through a list —
   is stamped frame by frame with `tl.set(...)`, which keeps it exact and seek-safe.
6. **Render once, then measure.** Any number that depends on rendered text width — a row's
   off-screen start, a highlight's resting width — is measured from a settled frame of that
   render and pasted back. Browser text measurement races font loading and returns fallback
   metrics.
7. **Verify the seams.** For each ledger row, snapshot the frames either side of the cut and
   confirm both elements are moving, on the named axis, in the named direction.
8. **Verify.** `npx hyperframes check` at zero findings, then snapshot every scene.
9. **Preview, then render.** `npx hyperframes render --quality high --fps 30`, then `ffprobe`.

## The seven slots

Copy budgets and the beat plan are in `references/slot-map.md`. The shape:

| Slot | What it is | Roughly |
| --- | --- | --- |
| A | The lockup, in two parts, counter-bouncing | ~1.3s |
| B | The entry surface arrives | ~1.3s |
| C | The same surface, closer, doing one thing | ~1.5s |
| D | One number that matters, counting | ~1.5s |
| E | A list of places to go, and one of them chosen | ~1.9s |
| F | One action, taken — arrived at, clicked, answered | ~3.1s |
| G | The endcard lands | ~1.3s |

Slot F is the longest by a wide margin, and deliberately: it is the only slot where
something is *done* rather than shown.

## Commands

```bash
npx hyperframes init sting
npx hyperframes capture https://<a-site-you-own> --json
npx hyperframes lint
npx hyperframes check
npx hyperframes snapshot --at 0.6,1.9,3.2,4.8,6.5,8.9,11.2
npx hyperframes preview --background
npx hyperframes render --quality high --fps 30 --output renders/sting.mp4
ffprobe -v error -show_streams renders/sting.mp4 | grep codec_type
```

The CLI needs Node.js 22 or newer and FFmpeg. No generation-model credential is used
anywhere in this workflow.

## Output contract

- One MP4 at the chosen canvas, 30fps, 10–13s, H.264 + AAC.
- A HyperFrames project: a single `index.html`, `ledger.json`, `meta.json`, and the assets.
- A handoff note listing the seven slots and what was put in each, the brand tokens, the
  rights position on the mark and the type, and every number that was measured from a render.
- `npx hyperframes check` at zero findings, pasted into the handoff.

## Failure rules

- If anything sits still at a cut, fix it. A settled exit or a from-rest entry is the one
  defect this structure cannot absorb, and it is visible at full speed.
- If a scene is retimed, re-check the seams either side of it. Moving one frame number
  without its neighbours breaks the ledger silently.
- If a stock named ease is substituted for the ease functions, revert it. Built-ins that
  share those names are different polynomials and will shift exits by several pixels each.
- If a beat feels empty, add information, not motion. Nothing in this film floats, breathes,
  or pulses to fill time.
- If any number that depends on rendered text was guessed rather than measured, render and
  measure it.
- If the caller cannot confirm rights to capture a site, ask for a mark and three hex values
  instead. Never capture a third party's site to dress the slots.
- Never call an image, video, or avatar generation model. Every frame is HTML, CSS, SVG,
  GSAP, or material the caller supplied.
