---
name: bs-hyperframes-agent-chorus-reel
description: Build a launch film that proves a capability works everywhere by showing four different surfaces typing the identical prompt, then drops into a beat-cut reel of what came out and closes on the install command. Delivered as a rendered MP4 plus the editable project.
---

# Agent-Chorus Capability Reel

A launch film in three movements. Four different surfaces type the **same** prompt, one
after another, so the claim "this works wherever you already are" is demonstrated rather
than asserted. Then the music drops and the film becomes a reel: outputs cutting on the
beat, faster than they can be studied, for long enough to establish range. Then one
command, and it ends. Built as HTML, CSS, SVG, and GSAP, rendered to MP4 by the HyperFrames
CLI.

## Style origin

The chorus device, the drop into a beat-cut reel, and the close-on-the-command structure
are abstracted from a publicly published HyperFrames launch film. The subject, copy,
palette values, and every asset are authored fresh for the caller's product. Nothing in the
output states or implies affiliation with, endorsement by, or authorization from any
company the caller does not own.

## When to use

Use this when the product is **surface-independent** — a CLI, a package, a skill, an MCP
server, anything that works the same in several places — and the launch's job is to say
"wherever you already work." The chorus is the argument; the reel is the evidence.

Do not use it when the product only runs in one place, when there is no library of real
outputs to cut into a reel, or when the caller cannot supply or license a track with a
usable drop. The drop is structural here, not decorative.

## The two rules this film lives by

**One. The prompt is identical in all four surfaces — same words, same order, character
for character.** The chorus works because the audience recognises the second instance and
starts predicting the third. Varying the wording "to keep it interesting" destroys the only
thing the device does.

**Two. The reel cuts on the beat.** Not near it. The cut lands on the transient, and the
cut rate is derived from the track's tempo rather than chosen by eye. A reel cut by feel
against a track with a drop reads as slightly wrong for its entire length, and nobody can
say why.

## Required input

- The product and the one prompt or command that invokes it.
- **Four surfaces** it genuinely works in, and the caller's rights position on each. See the
  rights rule below.
- **Real outputs** — at least eight, ideally twelve — that the product has actually
  produced. The reel is evidence, and a reel of mockups is not.
- **A music track with a real drop**, licensed for the caller's distribution.
- The install or invocation command the film closes on, which must actually work.

## The rights rule for the four surfaces

This film shows four interfaces, which is four times the exposure of a single-app film and
the highest of any structure in this family:

- For any surface the caller owns, build it from their real tokens.
- For every surface they do not, build a **neutral original**: generic chrome, original
  iconography, no third-party wordmark, product name, model chip, menu structure, or
  signature layout. The surfaces should differ from one another in *shape* — a terminal, a
  panel, an inline field, a chat — not in borrowed identity.
- Never recreate a named third-party tool's UI, and never use a screen recording of one,
  without written permission for each one.
- Say plainly in the deliverable which surfaces are representative. "Works in four places"
  is a claim about the product; showing four specific companies' UIs is a claim about them.

Differentiating the surfaces by shape rather than by brand is also better filmmaking: four
recognisable logos invite the audience to look for their own, and the ones who do not find
it conclude the product does not support them.

## Retarget to the user's product

1. **Lock the prompt.** One line, short enough to type four times inside seven seconds.
2. **Choose four surface shapes** that read as different in half a second: a full-bleed
   terminal, a docked panel, an inline field in a document, a floating composer.
3. **Gather the outputs and cut the weak ones.** Eight strong beats a stronger reel than
   twelve uneven ones; the reel's speed hides nothing.
4. **Find the drop and build the reel to it.** `references/reel-mechanics.md` has the
   tempo maths.
5. **Fill the four copy slots** in `references/film-blueprint.md`.

`references/retarget-checklist.md` gates all of this.

## Workflow

1. **Load the HyperFrames stack.** Read `/hyperframes`, then `/hyperframes-core`,
   `/hyperframes-audio` for the beat grid, `/motion-doctrine`, and `/oversized-cursor`.
2. **Run the retarget gate**, including the rights position on all four surfaces.
3. **Lock the music first and find the drop's exact timestamp.** Everything downstream is
   built to it; the drop is not something to be nudged later.
4. **Derive the cut grid** from the tempo, per `references/reel-mechanics.md`, and write it
   into `STORYBOARD.md` as timecodes before any reel HTML exists.
5. **Build the chorus**, four surfaces sharing one prompt string declared once in code so it
   cannot drift.
6. **Build the reel** against the cut grid. `npx hyperframes lint` after the first HTML
   pass; `npx hyperframes check` before moving on.
7. **Assemble the master timeline.** Every `<audio>` needs an `id`.
8. **Verify the beat alignment**: snapshot the frames either side of three reel cuts and
   confirm each lands on its grid timecode, not a frame late.
9. **Verify.** `npx hyperframes check` at zero findings, then snapshot every movement.
10. **Preview, then render.** `npx hyperframes render --quality high --fps 30`, then
    `ffprobe`.

## The three movements

Copy slots, durations, and the cut grid are in `references/film-blueprint.md`. The shape:

| Movement | Beat | Runtime |
| --- | --- | --- |
| I · The prompt | The line, alone, before any surface exists | ~3s |
| II · The chorus | Four surfaces, the same prompt, accelerating | ~7s |
| III · The reel | The drop; outputs cutting on the beat | ~14s |
| IV · The command | One line, and it ends | ~4s |

Movement II accelerates: the first surface types in full, the second faster, the third and
fourth as flashes. By the fourth the audience is not reading — they are recognising, which
is the point.

## Commands

```bash
npx hyperframes init launch-film
npx hyperframes beats assets/track.mp3
npx hyperframes catalog --query "a fast cut reel of panels"
npx hyperframes check
npx hyperframes snapshot --at 1.5,5,8,11.5,15,19,23,26
npx hyperframes preview --background
npx hyperframes render --quality high --fps 30 --output renders/launch.mp4
ffprobe -v error -show_streams renders/launch.mp4 | grep codec_type
```

`npx hyperframes beats` detects the track's beat grid and writes it to
`beats/<audio>.json` — use it rather than counting by ear. The CLI needs Node.js 22 or
newer and FFmpeg. No generation-model credential is used anywhere in this workflow.

## Output contract

- One MP4 at 1920x1080, 30fps, 24–45s, H.264 + AAC.
- A HyperFrames project: `index.html`, one composition per movement, `STORYBOARD.md`
  carrying the cut grid as timecodes, the beat JSON, and `ledger.json`.
- A handoff note listing the prompt, the four surface shapes and their rights positions, the
  outputs used and any cut, the track's tempo and drop timestamp, and the command.
- `npx hyperframes check` at zero findings, pasted into the handoff.

## Failure rules

- If the prompt differs between surfaces in any way, fix it. The chorus is the film's
  argument and it only works on exact repetition.
- If the reel's cuts are not on the beat grid, re-time them. Do not adjust by eye — a reel
  that is consistently two frames late reads as wrong for its whole length.
- If the outputs are mockups rather than real product output, stop. The reel is the
  evidence, and evidence that was designed for the film is not evidence.
- If the caller cannot confirm rights for a surface, build the neutral original. Four
  surfaces means four separate rights positions, not one.
- If the track has no real drop, this is the wrong structure. The transition into the reel
  is carried by the music, and a fade there leaves the film with two unrelated halves.
- If the closing command has not been run, run it. It is the only instruction in the film.
- Never call an image, video, or avatar generation model. Every frame is HTML, CSS, SVG,
  GSAP, or material the caller supplied.
