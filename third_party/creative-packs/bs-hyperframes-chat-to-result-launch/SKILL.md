---
name: bs-hyperframes-chat-to-result-launch
description: Build a narrated launch film that plays out entirely inside a dark app interface — a prompt is typed, an answer streams back, a follow-up triggers your product, and the finished result lands with a count-up headline number. You get the seven-scene storyboard, the interface system, and a rendered MP4.
---

# Chat-to-Result Launch Film

A launch film shot entirely inside software. There is no title card, no product tour, and
no talking head: a cursor turns your integration on, someone types a question, the answer
streams back, a follow-up asks for the thing your product makes, and the result assembles
on screen while a voiceover carries the argument. Built as HTML, CSS, SVG, and GSAP,
rendered to MP4 by the HyperFrames CLI.

## Style origin

The scene order, monochrome interface system, and count-up result card are abstracted
from a publicly published HyperFrames launch film whose subject is an assistant gaining a
new integration. Every interface, palette value, string, and voice line is authored fresh
for the caller's product. Nothing in the output states or implies affiliation with,
endorsement by, or authorization from any company the caller does not own.

## When to use

Use this when the product is something a user invokes from inside another surface — an
integration, a connector, a plugin, an agent skill, an API that another app calls — and
the launch argument is "watch it actually work." It also fits a first-run film for a tool
whose value only shows up in its output.

Do not use it for a product with no interface to show, for a feature that cannot be
demonstrated in one continuous flow, or when the film must be silent. This one is narrated
and the voiceover is the clock.

## Required input

- The product, and the exact action a user takes to invoke it.
- **The interface the film takes place in.** This must be an interface the caller owns, or
  a neutral original interface authored for the film. See the rights rule below.
- The question a real user would ask, and the follow-up that triggers the product.
- The result the product produces, and one number worth counting up to.
- Voiceover: either a script to synthesize, or a supplied recording. Either way the film
  is cut to the audio's real word timestamps.
- Brand tokens: a near-black canvas, three panel elevations, ink, two muted greys, and
  one hairline. Plus exactly one accent pair, reserved for your product's mark.

## The rights rule for the host interface

The film's whole effect comes from looking like real software, which is exactly why this
is the one thing that must not be borrowed. Before Scene 1:

- If the caller owns the surface, build it from their real tokens.
- If the caller does not own it, build a **neutral original** interface: generic chrome,
  original iconography, no third-party wordmark, mark, menu structure, or signature
  layout. Say plainly in the deliverable that the surrounding app is a representative
  interface, not a specific product.
- Never recreate a third-party assistant's or app's UI, and never use a screen recording
  of one, unless the caller supplies written permission. Refuse that element and offer the
  neutral build instead.
- The caller's own mark is the only logo in the film.

## Retarget to the user's product

1. **Read the product.** Get the real invocation, the real output type, and the real
   number. `npx hyperframes capture <url>` pulls the caller's site when they give one.
2. **Fill the eight copy slots** in `references/film-blueprint.md`.
3. **Rebuild the palette** from the role table in `references/interface-system.md`. Keep
   the monochrome rule: the interface is greyscale, and the only color in the entire film
   is the accent pair inside your product's mark and its progress details.
4. **Write or record the voiceover, then transcribe it.** `npx hyperframes transcribe`
   gives word-level timestamps. Scene durations come from those timestamps, never the
   other way around. Never rush a read to fit a slot.
5. **Choose the result.** The count-up number must be real and defensible; the checklist
   rows must be things the product actually does.

`references/retarget-checklist.md` gates all of this.

## Workflow

1. **Load the HyperFrames stack.** Read `/hyperframes`, then `/hyperframes-core`,
   `/motion-doctrine` for the seam law, `/oversized-cursor` for the cursor mechanics, and
   `/hyperframes-audio` for the voice bed. Install with
   `npx hyperframes skills update product-launch-video`.
2. **Run the retarget gate**, including the host-interface rights rule.
3. **Lock the voiceover first.** Generate or import the audio, transcribe it, and write
   `SCRIPT.md`. Everything downstream is timed to it.
4. **Write `STORYBOARD.md`** from the scene table in `references/film-blueprint.md`, with
   durations derived from the transcript.
5. **Write `ledger.json`.** The current is LEFT. Reserve Z-forward for pushing into the
   composer, Z-backward for the result's arrival, and upward for the outro.
6. **Build the interface system first** — one stylesheet with the elevations, the three
   type ramps, the composer, the menu, the toggle, the tool pill, and the card. Scenes
   consume tokens.
7. **Build scenes in order, checking each.** `npx hyperframes lint` after the first HTML
   pass; `npx hyperframes check` before moving on.
8. **Assemble the master timeline**: scene hosts, the music bed, the voiceover, and the
   interaction SFX. Every `<audio>` needs an `id` or the mixer skips it and the render is
   silent. Paint an opaque stage ground or every seam flashes white.
9. **Verify.** `npx hyperframes check` at zero findings, then
   `npx hyperframes snapshot --at <scene midpoints>` and look at every frame.
10. **Preview, then render.** `npx hyperframes preview --background`, wait for approval,
    then `npx hyperframes render --quality high --fps 60`. Probe with `ffprobe` and report
    codec, dimensions, duration, and that the audio track is present.

## The seven scenes

Copy slots, durations, and per-scene motion routes are in
`references/film-blueprint.md`. The shape:

| Scene | Beat | Runtime |
| --- | --- | --- |
| 1 | Connector: a cursor opens a menu, finds your product, and flips the toggle on | ~6.5s |
| 2 | The ask: a question types into the composer; send | ~7s |
| 3 | The answer: prose streams in editorial serif and scrolls under a soft mask | ~6.5s |
| 4 | The follow-up: a second prompt types — this is the one that needs your product | ~6s |
| 5 | Thinking: one big, quiet beat. Do not cut it | ~1.5s |
| 6 | The result: a task list completes, morphs into the output card, and the headline number counts up | ~10s |
| 7 | Outro: the lockup on the canvas, held | ~3.5s |

Scene 5 is the stillness before the climax. Every instinct will say to trim it; trimming
it is what makes Scene 6 land flat.

## Commands

```bash
npx hyperframes init launch-film
npx hyperframes tts --text "$(cat script.txt)" --output assets/voiceover.mp3
npx hyperframes transcribe assets/voiceover.mp3
npx hyperframes catalog --query "number counting up to a large value"
npx hyperframes check
npx hyperframes snapshot --at 3.2,10.1,16.3,22.4,25.7,31.5,37.8
npx hyperframes preview --background
npx hyperframes render --quality high --fps 60 --output renders/launch.mp4
ffprobe -v error -show_streams renders/launch.mp4
```

The CLI needs Node.js 22 or newer and FFmpeg. Voice synthesis runs locally through the
CLI's own model; no generation-model credential is used anywhere in this workflow.

## Output contract

- One MP4 at 1920x1080, 60fps, 30–45s, H.264 + AAC, with the voice, music bed, and
  interaction SFX mixed in.
- A HyperFrames project: `index.html`, one composition per scene, `SCRIPT.md`,
  `STORYBOARD.md`, `ledger.json`, a transcript, and the interface stylesheet.
- A handoff note listing the copy slots, the palette, the voice source, and an explicit
  statement of whether the host interface is the caller's own or a neutral original.
- `npx hyperframes check` at zero findings, pasted into the handoff.

## Failure rules

- If the caller cannot confirm rights to the host interface, build the neutral original.
  Do not proceed with a recreated third-party UI on a verbal assurance.
- If the count-up number is not one the caller will defend publicly, cut the count-up and
  end Scene 6 on the output itself.
- If the voiceover changes, every scene boundary it touches is re-opened: re-time from the
  new transcript and re-run the checks. Do not stretch a scene to cover a longer read.
- If `check` reports a lint error, stop. A lint error switches off the layout and contrast
  audits, so a subsequent clean-looking result means nothing ran.
- If an `<audio>` element has no `id`, the mixer skips it and the film renders silent.
  Verify the audio stream exists in the probe before delivering.
- Never call an image, video, or avatar generation model. Every frame is HTML, CSS, SVG,
  GSAP, or material the caller supplied.
