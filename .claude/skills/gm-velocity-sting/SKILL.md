---
name: gm-velocity-sting
description: Build a 12-second square product sting where every cut is velocity-matched, so seven product surfaces read as one continuous camera move instead of a stack of screens. Delivered as a rendered MP4 plus the editable project and its seam ledger, so it can be re-branded or re-filled later without the motion coming apart.
---

# Velocity sting

A 11.933-second, 1:1 product sting: a lockup, an entry surface, the same surface closer with
one thing happening, one number that matters, the real navigation with one row chosen, the
primary create action taken, and an endcard. Nothing in it settles: every scene is still
travelling when its cut arrives, and the next enters already in flight on the same axis, so
the piece reads as one move. Built as HTML, CSS, SVG, and GSAP, rendered to MP4 by the
HyperFrames CLI.

## Style origin

The velocity-matched cut, the single ease family, the seam ledger and the seven-slot structure
are abstracted from the third-party `bs-hyperframes-velocity-sting` skill
(`third_party/creative-packs/`), first built for Greedy Motion in `experiments/gm-ad-test/`.
The subject, copy, palette, frame plan and every asset are authored for the caller's product.
Nothing in the output states or implies affiliation with any company the caller does not own.

## When to use

A social post, a launch-day loop, a conference bumper, the opening seconds of a longer film,
for a product with real surfaces: a sign-in, a number its users quote, a navigation, a create
button.

Do not use it to explain anything; there is no room for an argument. For a narrated demo use
`gm-feature-explainer`. Do not use it for a product without a navigation and a create
affordance: two of seven slots would be invented, and it shows.

## The two rules this film lives by

**One. One ease family.** Every arrival uses `EO`, every exit its mirror `EI`, passed as
functions (GSAP's similarly named eases are different polynomials and shift exits by pixels).
Nothing overshoots, nothing is linear, nothing idles.

**Two. Matched vectors at every cut.** The outgoing element is still moving on the last frame
before the cut, and the incoming one is already moving on the first frame after it: same axis,
same sign, same speed. Because `EI` ends at the speed `EO` starts, equal distance and duration
on both sides make the speeds identical (measured 75.8 px/frame on every x/y seam).

Both rules are data: the eases are two named functions in `template/engine.js`; the seams are
`references/ledger.json`, one row per cut, checked mechanically by `scripts/verify-seams.mjs`.

## Required input

- The product and its slots: `references/slots.json` (budgets, which are product facts).
- Brand: from the brand kit (theme tokens, fonts, logo). Never typed in.
- Canvas: 1:1 only today (9:16 and 16:9 need a re-layout, not a scale; see blueprint).
- Audio: none to supply. The template ships a bed and SFX premixed to the fixed frame plan.

## The rights rule for product surfaces

- Every surface is the caller's own product, rebuilt in HTML/CSS from its real labels. Never a
  screenshot of, or labels from, a third party's UI.
- `brand capture` only against a site the caller owns or has written permission for;
  otherwise use the saved brand kit, or a mark plus three colours.
- The typed value in C is sample data, never a real person's address.
- The handoff states the source of every slot value.

## Retarget to the user's product

1. **Fill the slots** with things the product really has, in its own words
   (`mustBeReal` slots are never invented; ask for them).
2. **Apply the brand kit.** The template reads only theme tokens: `--bg` ground, `--surface`
   cards, `--fg` ink, `--accent` highlight/focus/progress, `--border` hairlines, `--muted`
   secondary text, `--font-display` / `--font-body` / `--font-mono`. Text on the accent and the
   readable accent ink are picked at runtime from the tokens by contrast.
3. **Keep the ledger and the frame plan.** Retiming a scene re-opens both seams beside it.
4. **Nothing to measure.** Nav rows slide by their own width (`xPercent`) and each carries its
   own highlight pill, so no text width is ever pasted in.

`references/checklist.md` gates all of this.

## Workflow

1. Load `/hyperframes`, `/hyperframes-core`, `/motion-doctrine`, `/cut-the-curve`,
   `/oversized-cursor`, and `.claude/skills/gm-skill-authoring/references/shared-craft.md`.
2. Run the checklist's fit and rights sections.
3. Write the slot values as JSON against `slots.json`.
4. Build: `node scripts/build-format.mjs --skill gm-velocity-sting --values values.json
   --brand var/brands/<id> --out <dir>` (or `--theme <id>` for a gallery theme).
5. Verify: `hyperframes check` at zero findings; `node scripts/verify-seams.mjs <dir>
   .claude/skills/gm-velocity-sting/references/ledger.json`; snapshot every slot.
6. Render `--quality high --fps 30`; run the pacing gate; measure loudness.

## Structure

| Slot | Frames | What it is |
|---|---|---|
| A | f1–f40 | Mark and wordmark counter-bounce (mark +A, word −A) |
| B | f41–f79 | Entry surface; rows arrive as a wave |
| C | f80–f124 | Same surface, closer; the field types on a stamped uneven rhythm; the press ignites the cut |
| D | f125–f169 | One number counting on a stamped odometer; the active step ticks done |
| E | f170–f226 | Real navigation; the highlight climbs to the first row; a press confirms it |
| F | f227–f319 | The create action: cursor, click, menu off the button's corner, second click chooses |
| G | f320–f358 | The lockup lands on a pull-back, plus at most one line |

Blueprint with timings, seams and budgets: `references/blueprint.md`. Motion rules:
`references/craft.md`.

## Commands

```bash
node scripts/build-format.mjs --skill gm-velocity-sting --values values.json --brand var/brands/<id> --out out
npx hyperframes check out
node scripts/verify-seams.mjs out .claude/skills/gm-velocity-sting/references/ledger.json
npx hyperframes render out --quality high --fps 30 -o out/renders/sting.mp4
python3 .claude/skills/gm-feature-explainer/template/tools/pacing_gate.py out/renders/sting.mp4
```

## Output contract

- One MP4: 1080×1080, 30 fps, 11.933 s, H.264 + AAC, about −14 LUFS, ≤ −2 dBTP.
- The project folder (`index.html`, `variables.json`, theme, fonts, assets) and
  `seams-verified.json`.
- A handoff: each slot and its source, the brand kit used, the rights position, the `check`,
  seam and pacing outputs.

## Failure rules

- If anything sits still at a cut, fix it; the seam verifier fails on it.
- If a beat holds still for more than 0.6 s, add information to it (a press, a line arriving),
  never idle motion. (Hit in test build #1: the nav after the highlight landed, and F after
  the second click.)
- If a one-word brand is split into two parts to make a counter-bounce, undo it: the mark and
  the wordmark are already the two parts. (Hit in test build #2: "Ledger ly".)
- If a colour or typeface is typed into the template, replace it with a theme token
  (`npm run check:brand-tokens` fails on it).
- If a stock ease name replaces `EO`/`EI`, revert it.
- If a slot is filled with a number, a nav label or a button the product does not have, stop and
  ask for the real one.
