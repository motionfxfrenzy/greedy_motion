---
name: gm-glossy-3d-reel
description: Build a 15–20 second brand reel set in a bright, glossy 3D studio, where floating props, tumbling keycaps and orbiting 3D words carry one continuous camera from "what goes in" to "what comes out" and land on the logo. Delivered as a rendered MP4 plus the editable project and its seam ledger, so the reel can be re-branded without the camera coming apart.
---

# Glossy 3D Studio Reel

A fifteen-to-twenty second brand reel. A soft-lit white studio is full of glossy plastic props;
the camera never stops. Keycaps spell the product's verb, the product's mark turns at the centre
of a ring of its inputs, cards fan past, two columns of capabilities rise, a before-and-after
pair is flown through, and the logo resolves on a clean ground. It reads as play, then as range,
then as one confident lockup. Built as HTML, CSS, SVG, GSAP and Three.js, rendered to MP4 by the
HyperFrames CLI.

**Status: ON HOLD (2026-10-04).** The Three.js studio approach is replaced by the Nano Banana + Veo 3D pipeline in `docs/MOTION_PIPELINE.md`; this skill will be rewritten after tests T1–T5 there pass. Previous status: draft, (predicted) rules not yet confirmed by a build of this skill.** The failure
rules marked (seen) were hit in the 2026-10-04 test builds in `experiments/gm-ad-test/`.

## Style origin

The studio look, the keycap word, the orbiting-word ring and the before→after fly-through are
abstracted from a publicly published 3D product intro. The subject, copy, palette values, props,
and every asset are authored fresh for the caller's product. Nothing in the output states or
implies affiliation with, endorsement by, or authorization from any company the caller does not
own.

## When to use

Brand and launch moments where the product is a *transformation*: inputs go in, something better
comes out. That covers creative tools, AI generation, editors, converters and builders. It fits social
openers, launch-page heroes and event bumpers.

Do not use it to show real UI flows (use the velocity sting), to make an argument with narration
(use the chat-to-result launch), or for a product with no visual "before → after". With no
transformation, the fly-through has nothing to fly into.

## The two rules this film lives by

**One. One accent at a time.** The world is paper-white and soft grey. The brand accent appears on
one or two objects per shot, never more, and the second brand colour appears only inside the mark.
This is what makes it read as premium rather than as a toy box. It is checked by sampling frames
(`references/craft.md`).

**Two. The camera never cuts.** Every shot ends in a camera move (whip, push-through, match-cut
or fly-through) that the next shot continues on the same vector. It is written down in
`ledger.json` before any scene exists, and every row is verified by frames either side of the
seam. A transition that passes through empty frames counts as a cut.

## Required input

- The product, and its slots (`references/slots.json`): a verb of 4–5 letters, 5 inputs, a
  headline, 4 + 4 capability pills, the before and after labels, and a closing line.
- Brand: the theme tokens, the mark as SVG (in two parts if it has them), the lockup, and fonts.
- Two or three real product screens or outputs for the cards. These must be the caller's own;
  never invent dashboards with numbers.
- The canvas: 16:9 by default. 9:16 is a re-layout (the ring becomes vertical and the pills
  stack), not a scale.
- Music: a licensed or generated track at 110–128 BPM with a hit we can land the lockup on.
- Optional: text-free 3D plates from a video model (see the rights rule and `craft.md` → Hybrid).

## The rights rule for props and plates

- Props are original primitives built in Three.js (rounded boxes, extrusions of the caller's own
  SVGs, tori, cards). No downloaded models without a logged licence.
- Keycap and orbit words are the caller's words. Never use another product's name or a model
  vendor's name as decoration.
- If video-model plates are used, they must contain **no text and no logo**. All words and the
  mark sit in the HTML layer above them. Log the model, prompt and cost.

## Retarget to the user's product

1. **Fill the slots** from the product's own language: its verb, its real inputs, and its real
   output types. Copy budgets are in `references/blueprint.md`.
2. **Map the brand.** World = `surface` / `canvas` tokens. Accent = `primary`. The mark's second
   colour stays inside the mark. Read the lit colour from a rendered frame, because lighting
   shifts hex values.
3. **Keep the ledger and the shot order.** Retiming one shot re-opens the seams either side of it.
4. **Re-measure** every word's extruded width after the font loads (render, then measure).

## Workflow

1. **Load the stack:** `/hyperframes`, `/hyperframes-core`, `/hyperframes-animation` (Three.js
   adapter), `/motion-doctrine`, `/cut-the-curve`, `/hyperframes-keyframes`, and
   `.claude/skills/gm-skill-authoring/references/shared-craft.md`.
2. **Run** `references/checklist.md` sections 1–3.
3. **Lock the clock:** pick or generate the track, run `hyperframes beats`, and put every shot
   boundary on a beat. Write `ledger.json` (one row per seam, with axis and sign) and
   `STORYBOARD.md`.
4. **Build the studio first:** one Three.js scene, camera rig, lights, materials (glossy white,
   satin accent, satin mark colour) and the ground. Every shot is a camera position in this
   one world; shots are not separate scenes.
5. **Build the shots in order.** HTML type goes over the WebGL canvas. Run `lint` after the first
   pass.
6. **Render once, then measure** word widths and the lit accent colour.
7. **Verify the two rules:**
   - **Accent:** sample 1 frame per beat and count accent-coloured objects.
   - **Camera:** take snapshots either side of each ledger seam, check both sides are moving, and
     check no frame is ≥ 90% empty ground.
8. `check` at zero findings. Then do a production-equivalent CPU render (`--no-browser-gpu`) and
   record its time.
9. **Render** with `--quality high`, then run `ffprobe` and measure loudness.

## Structure

| Shot | What it is | Roughly | Seam out |
|---|---|---|---|
| 1 Studio | Camera drifts through floating props | 2.5s | Whip up |
| 2 Verb | Keycaps fall and snap into the verb; last key in the accent | 2.5s | Match-cut: accent key → mark |
| 3 Ring | The mark turns; the inputs orbit as extruded words | 2.5s | Push through the mark |
| 4 Cards | Real product cards un-fan; headline | 2.5s | Whip right |
| 5 Range | Two pill columns; accent arrow rises | 2.5s | Tilt up with the arrow |
| 6 Before→After | Card pair; push and fly through "after" | 2.0s | Fly-through into ground |
| 7 Lockup | Mark assembles, lockup, one line | 2.5s+ | End on the music hit |

## Commands

```bash
HF=worker/node_modules/.bin/hyperframes
$HF beats assets/track.wav
$HF lint && $HF check
$HF snapshot --at 1.2,3.7,6.2,8.7,11.2,13.5,15.8
$HF render . --fps 30 --workers 1 --quality standard --no-browser-gpu --output renders/cpu-check.mp4
$HF render . --quality high --fps 30 --output renders/reel.mp4
```

## Output contract

- One MP4: 1920×1080 (or 1080×1920), 30fps, 15–20s, H.264 + AAC.
- Project: `index.html`, `scene.js` (the one Three.js world), `ledger.json`, `STORYBOARD.md`,
  `beats/`, assets.
- `HANDOFF.md`: slots and values, brand token mapping, measured lit colours, measured widths with
  their source frames, seam evidence, accent-count table, CPU render time, `check` output, and
  `COST.md`.

## Failure rules

- If a transition passes through 3 or more near-empty frames, it is a cut. Put an object on the
  vector through the seam. (seen: whips with 3–6 blurred empty frames)
- If the fly-through ends on a blank flash, end it on the lockup's first element instead.
  (seen: white flash at about 14s)
- If any card shows a number, percentage or metric the caller didn't supply, remove it.
  (seen: "12.4k", "+38% this week" on mock dashboards)
- If the lit accent reads as a different hue in the render, adjust the material, not the token.
  Check it on a rendered frame. (seen: the orange key read as red)
- If a video-model plate contains text or a logo, regenerate it text-free or composite over it.
  Never ship generated letters. (seen: Veo garbled orbiting words in 4/4 takes and invented a
  mark)
- If generated music runs long, trim and fade it to the clock; don't retime the picture to the
  track. (seen: Lyria returned 58.9s for a 17s request)
- If a match-cut is only a scale-up and a cut, it is not a match-cut. The outgoing shape must
  become the incoming one across the seam. (seen)
- If the CPU render exceeds the plan's render budget, lower the motion-blur samples before
  cutting shots. (predicted: GPU 56s; CPU time is to be measured)
- If more than two objects in a frame carry the accent, take it off the extras. (predicted)
- Never let the logo pass through a generation model. The mark and lockup are always the
  caller's files.
