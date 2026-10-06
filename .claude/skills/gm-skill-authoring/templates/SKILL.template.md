---
name: gm-<structure>
description: Build a <length> <kind of film> where <the device, in one clause>. Delivered as a rendered MP4 plus <the editable project + its plan file>, so it can be re-branded later without <the thing that would break>.
---

# <Title>

<One paragraph. What the film is, how long, its shape in one sentence, and what the viewer
feels. End with: "Built as HTML, CSS, SVG, and GSAP, rendered to MP4 by the HyperFrames CLI.">

## Style origin

<The structure and technique are abstracted from <a publicly published film / an internal
build>. The subject, copy, palette values, frame plan, and every asset are authored fresh for
the caller's product. Nothing in the output states or implies affiliation with, endorsement by,
or authorization from any company the caller does not own.>

## When to use

<The briefs it fits. Which products have the surfaces or outputs it needs.>

Do not use it <the briefs it fails. Name the closest gm-* skill to use instead.>

## The two rules this film lives by

**One. <Rule name>.** <What it is, why breaking it kills the film, how it is enforced.>

**Two. <Rule name>.** <Same.>

<Where the rules are written down as data: ledger.json / beats/*.json / transcript.>

## Required input

- <The product and its N slots — see `references/slots.json` and `references/blueprint.md`.>
- Brand: from the brand kit (theme tokens, mark, fonts).
- The canvas.
- <Audio: a track / a voiceover script / none.>

## The rights rule for <riskiest element>

- <The safe default.>
- <What is never allowed without written permission.>
- <What the handoff must state.>

## Retarget to the user's product

1. **Fill the slots** with things the product really has, in its own language.
2. **Apply the brand kit.** <Which tokens map to which roles.>
3. **Keep the <clock> and the rules.** <What may be retimed and what that re-opens.>
4. **Re-measure what cannot be guessed.**

`references/checklist.md` gates all of this.

## Workflow

1. **Load the stack:** `/hyperframes`, `/hyperframes-core`, `/motion-doctrine`, <others>, and
   `.claude/skills/gm-skill-authoring/references/shared-craft.md`.
2. **Run the checklist's fit and rights sections.**
3. **Lock the clock first:** <write the ledger / lock and transcribe the VO / run beats on the
   track>. Everything downstream is timed to it.
4. **Write `STORYBOARD.md`** from `references/blueprint.md` with real timecodes.
5. **Build** <in what order>. Run `lint` after the first HTML pass.
6. **Render once, then measure** any number that depends on rendered text.
7. **Verify the invariant:** <exactly how — snapshots either side of each cut, beat table, …>.
8. `check` at zero findings; snapshot every scene.
9. **Render** with `--quality high`, `ffprobe`, and loudness.

## Structure

| Slot / scene | What it is | Roughly |
|---|---|---|
| A | | |

## Commands

```bash
HF=worker/node_modules/.bin/hyperframes
$HF lint && $HF check
$HF snapshot --at <scene midpoints>
$HF render --quality high --fps 30 --output renders/<name>.mp4
ffprobe -v error -show_streams renders/<name>.mp4 | grep codec_type
```

## Output contract

- One MP4: <canvas>, <fps>, <length>, H.264 + AAC.
- Project: `index.html`, <plan file>, `STORYBOARD.md`, assets.
- `HANDOFF.md`: each slot and its value, brand tokens used, rights position, measured numbers
  with their source frames, pasted `check` output, `COST.md` link.

## Failure rules

- If <the invariant is broken>, fix it.
- If <the clock changes>, re-open <what>.
- If <a number was guessed>, render and measure it.
- If <the rights default can't be confirmed>, build the neutral original.
- <Each later line names a defect a real test build hit.>
