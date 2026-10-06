# Script for motion

The single source of truth for how Greedy Motion writes scripts: voiceover, on-screen copy, and the
beat list. Every gm skill, the backend planner and the agent authoring mode follow this file.
Watchability (`watchability.md`) says what makes a film watchable; this file makes sure the
*script* hands the motion designer something worth animating.

## The principle

**Write beats, not paragraphs.** A script for motion is a list of beats. Each beat pairs one
spoken or on-screen line with one visible event. If a line has nothing to show, cut it or give it
something to show.

## Structure (per format)

| Format | Length | Beats | Shape |
|---|---|---|---|
| Social ad / teaser | 15–30s | 4–7 | Hook (pain or outcome) → product in action → success moment → CTA |
| Launch | 20–45s | 6–10 | Hook → reveal → 2–4 features shown → success moment → CTA |
| Explainer | 45–90s (≤120s for a feature page) | 8–14 | Hook/problem (≤ 15% of the runtime) → reveal (≤ 5s) → feature tour, one per sentence → success moment → CTA |

- **Hook by 3s, intro done by 5s.** The first line names the viewer's pain or the outcome, never "Introducing…".
- **The product is on screen by 15s** at the latest.
- **One problem, one outcome, one CTA.**

## Line rules (voiceover)

- **One sentence = one beat = one visible action.** Each feature line names exactly one action
  the screen can show: click, type, drag, toggle, count, send, export.
- **Lead with the verb, or put it at least 0.7s in.** The action lands on the verb. Don't bury it
  at the end of a long clause.
- **Short sentences.** 6–14 words; spoken at ~140–160 wpm with 0.3s gaps (Pacing rules).
- **Concrete over abstract:** "Drop in three screenshots" beats "Streamline your content workflow".
- **Name what the product learns or does, never the abstraction.**
- **CTA line:** a short opener, then the product name ≥ 1.2s into the line, then the action.
- **No invented results:** no %, multipliers, customer names or figures the brief can't support.
  Banned words: "magic", "revolutionary", "seamless", "game-changing".

## On-screen copy rules

- **Readable in 2 seconds:** ≤ 6 words for a headline, ≤ 3–4 for a kinetic keyword.
- **Every beat has a kinetic key phrase** (the verb or the outcome) that carries the message muted;
  the last word takes the brand accent.
- **Echo, don't duplicate.** On-screen text picks the key phrase from the line; it never repeats
  the whole sentence.
- **Respect slot budgets exactly** (`slots.json`); never truncate.

## Footage beats (real-looking people, generated)

Some films need a person on screen: someone using the laptop, or a founder saying one line. A
footage beat is written like any beat, plus these fields:

| Field | Example |
|---|---|
| `kind` | `footage` |
| `character` | the approved character (id from the character sheet) |
| `shot` | framing + camera + action: "medium over-the-shoulder, slow push-in; she types, then smiles at the screen" |
| `screen` | `replace` (HyperFrames pins the real UI onto the laptop) · `blank` · `away` |
| `dialogue` | the exact on-camera line in quotes, or none; ≤ ~8s / 15–20 words; one speaking clip per character per film |
| `overlay` | the key phrase or caption HyperFrames puts on top |
| `duration` | 2–4s silent, ≤ 8s with dialogue |

Production (prompts written with visual-skills: `image/references/characters.md`, `de-slop.md`,
`video/references/veo.md`, `camera-lighting-vocabulary.md`):

1. **Character design (Nano Banana):** a character sheet (front, ¾, profile, two expressions) and a
   wardrobe on brand colours, approved by the user once and reused as the identity reference
   ("keep facial features exactly the same") for every shot.
2. **Shot keyframe (Nano Banana):** the character sheet as reference + the exact camera angle,
   framing and lighting from the beat's `shot`; the laptop screen blank or angled away.
3. **Animate (Veo 3.1):** first frame (+ reference ingredients for identity); dialogue in Veo's
   quoted dialogue syntax with a voice-character modifier, following its timing rule. Keep Veo's
   audio for speaking clips; drop it for silent ones.
4. **Verify:** transcribe speaking clips; regenerate if a word is wrong. Captions use the real
   transcript.
5. **Composite (HyperFrames):** the real UI is pinned to the screen (still or slow-push cameras
   only; no tracking yet), overlays on top, and the clip cut in under the same pacing and
   transition rules. The narrator VO ducks or pauses under on-camera dialogue.

Rules:
- The video model **never draws the product screen or any text.**
- On-camera speakers are characters (founder, user, customer), never the narrator voice.
- At most 2–3 footage beats per film; each cuts back to a product-UI beat.
- Avoid close-ups of typing fingers; medium and over-the-shoulder framing hold up best.
- Generated people only, or customer footage with consent from everyone on camera.

## Every beat records (the motion handoff)

| Field | Example |
|---|---|
| `line` (VO) | "Drop in three screenshots of your new feature." |
| `keyword` (on screen) | "Drop it in." (plain text; the engine puts the last word in the accent, so never mark it with `**` or quotes) |
| `action` | `drag` → `#upload-zone` |
| `verb` | "Drop" |
| `success` | true on the beat where the result lands |
| `energy` | calm · medium · high (the film's energy curve rises toward the success moment) |
| `transition_hint` | carry the dragged card into the next scene (match-cut) |

The motion designer (skill or agent) must be able to animate every beat from these fields alone.

## Consistency

- **One brand motion profile** (snappy · smooth · springy) is chosen from the brand kit and drives
  the voice energy and the copy tone too: snappy = terse and technical; smooth = calm and assured;
  springy = playful.
- The same product name, terms and capitalisation throughout; terms come from the product's own UI.
- Music energy matches the profile and rises with the energy curve.

## Self-check before handing off

- [ ] First line is a hook (pain or outcome), and the intro is over by 5s.
- [ ] Every beat has one visible action and a kinetic key phrase.
- [ ] Exactly one success moment, before the CTA.
- [ ] Length fits the format.
- [ ] No invented results; no banned words.
- [ ] Muted test: the key phrases alone tell the story.
