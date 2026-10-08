---
name: skeleton-ads
description: "Turn an e-commerce product into a skeleton ad - a narrated, escalating-progression video where a recurring literal 3D cartoon skeleton lives out a second-person journey ('What happens if you ___? Day 1 → Day 30 → Day 365'), modeled on viral 'What happens if you ___?' Shorts. An animated voiceover + B-roll format with one locked hero skeleton character across every beat. Use when the user asks for a 'skeleton ad', a 'What happens if you ___' / progression / escalation / 'Day 1 Day 30' ad, or pastes a product and wants this format. Runs one chat in four stages: (1) write the script, (2) visual concept board, (3) lock the skeleton hero + per-beat start frames, (4) batch the video generations synced to the voiceover. Also fires on the hand-offs: an approved script pasted back → stage 2, chosen style/theme/beats → stage 3, stills done → stage 4. Built on three fundamentals: direct-response copywriting, one locked hero character, and voiceover-first pacing."
---

# Skeleton ad

A **skeleton ad** is a narrated, escalating-progression video: a recurring literal cartoon skeleton lives out a second-person journey - _"What happens if you \_\_\_? Day 1… Day 30… Day 365"_ - carried by a single voiceover, with generated animated visuals and one **locked hero skeleton** in every beat. Borrowed from viral "What happens if you \_\_\_?" Shorts. It wins on two things: an **escalating spine** that makes one benefit impossible to look away from, and a skeleton that stays the _exact same character_ across every beat. Mechanically it is voiceover-first - the whole narration generated as one continuous take, setting the clock for every visual - with a fixed spine and a fixed recurring character.

Three fundamentals this skill assumes: every generation is self-contained (the model remembers nothing between generations, so the skeleton is re-described and re-attached in every beat); recurring elements hold via one locked **hero reference**; and pacing is voiceover-first (the whole narration is generated as one take before any visual, and everything is timed to it). On top of those it runs standard direct-response craft: open a curiosity loop, escalate, land the product on one clean turn, close the loop at the payoff.

You take the user from product → finished production kit across **four stages, all in one chat**. They are smart marketers, not prompt experts - do the thinking and hand them copy-paste-ready outputs at every step.

---

## When this fires + stage map

Fires on: "skeleton ad", a "What happens if you \_\_\_" / progression / escalation / "Day 1 Day 30" ad, or a product plus a want for this format. One chat, four stages, hand-offs between them - **detect the stage from what the user gives you this turn:**

| They gave you…                                                           | Run                                        |
| ------------------------------------------------------------------------ | ------------------------------------------ |
| A product (brief / link / notes), no script yet                          | **Stage 1 - Script**                       |
| An approved or edited skeleton script pasted back (a Day-1/Day-30 block) | **Stage 2 - Visual concept board**         |
| A chosen style + theme + favorite beats                                  | **Stage 3 - Hero skeleton + start frames** |
| "Stills are done" / uploaded stills                                      | **Stage 4 - Video generations**            |

Ambiguous → ask one short question. If they name a stage, obey it.

---

## The format strategy (skeleton-specific)

The skeleton format runs on a **curiosity-gap hook + an escalating spine + a payoff**. The general craft that makes any script convert - opening the loop and paying it off, the turn to the product, visceral specificity, escalating the stakes, one idea per beat - applies as usual. What is specific to THIS format:

**A. The hook is a curiosity-gap question.** Templates: _"What would happen if you \_\_\_?"_ · _"What happens if you \_\_\_ every day?"_ · _"How long can you *** before ***?"_ · _"How many *** does it take to ***?"_ · _"What if you NEVER \_\_\_?"_

**B. The spine is an escalating progression** - a ladder of markers that intensify. Three spine types:

- **Time** - Day 1 → Day 30 → Day 365 (or Hour / Week / Year).
- **Quantity** - 1 → 5 → 25 → 42.
- **Stage / Level** - Stage 1 → Stage 5.

One VO line → one beat → one rung of the ladder.

**C. Diagnose the product, then pick the angle + spine + payoff** (don't default to "transformation" - diagnose first):

| If the product…                               | Angle                                                              | Spine        | Payoff      |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------ | ----------- |
| compounds with daily use                      | **Transformation** - "use it for 30 days"                          | Time         | Triumph     |
| replaces a painful, worsening status quo      | **Cost-of-inaction** - "what if you never fix this"                | Time         | Catastrophe |
| fixes an overdone, broken old way             | **Limit / overload** - "how far the old way goes before it breaks" | Quantity     | Catastrophe |
| is vivid dropped into an unexpected world/era | **Origin / scenario** - "what if you had this in [world]"          | Time / Stage | Triumph     |

Often you **fuse two** (the worked example fuses _origin/scenario_ + _transformation_). Pick the angle that makes the product's core benefit most visceral, and say why in one line.

**D. The payoff lands on a triumph** (transformed, unstoppable, crowned) **or a catastrophe** (system failure, ruin). An e-commerce product usually wants triumph (you use it) or catastrophe-from-inaction (you don't).

---

## The skeleton is the constant (the hero character)

The same skeleton appears in **every beat** - protecting its visual consistency is the single most important production rule. It is a **hero character** with a pre-made design (the Style Library below). Lock **one hero skeleton reference image**, then re-attach it and re-state its description in every beat's still - never chain off a previous beat's output (drift compounds until the skeleton has quietly changed). Fill each style's `[THEME]`, palette, and (for Dressed) wardrobe to the ad's world; **never change the character-defining wording** between beats.

### Style Library - pick one; the chosen block becomes the hero skeleton's character sheet

Recommend the best style for the product with a one-line reason. Default to **Bare-Bones Cinematic** unless the product points elsewhere (health/body/supplement → X-Ray with Organs; wearable/identity/lifestyle → Dressed Skeleton; a brand that is intentionally playful → Cute Mascot). **Never silently default to the cute look.**

**1. Bare-Bones Cinematic** - _default; the proven house look._ Best for origin/scenario and transformation ads.

> **CHARACTER:** A full anatomical skeleton with natural adult human proportions, tall and lanky, smooth ivory-cream bones with realistic bone detail (NOT toy-smooth, NOT chibi, NOT scary), and large expressive cartoon eyes with white sclera and dark pupils set in the eye sockets, giving an emotive, lovable face. No clothing. Same character in every beat. **STYLE:** cinematic 3D animated render, photoreal [THEME] environment, warm [palette] color grade, soft volumetric light with drifting steam/atmosphere, shallow depth of field.

**2. Dressed Skeleton** - the same skeleton wearing a full themed outfit. Best for wearable, fashion, lifestyle, or identity products.

> **CHARACTER:** The same friendly skeleton (ivory bones, large expressive cartoon eyes with white sclera and dark pupils) wearing a complete [THEME-appropriate wardrobe, e.g. tailored suit / cowboy attire / varsity jacket and cap]; skull, hands and any exposed bones still visible. Same character in every beat. **STYLE:** cinematic 3D animated render, photoreal [THEME] environment, warm [palette] color grade, soft volumetric light, shallow depth of field.

**3. X-Ray with Organs** - a translucent glowing body showing skeleton + internal organs. Best for health, body, supplement, or "what happens inside you" angles.

> **CHARACTER:** A translucent glowing anatomical human body revealing the full white skeleton PLUS visible internal organs (heart, lungs, intestines) glowing red and orange through a blue-tinted translucent skin outline, with large expressive cartoon eyes. Same character in every beat. **STYLE:** clean sci-fi medical 3D render, cool blue translucent body with warm organ glow, [environment: a real setting with x-ray glow OR a clean blue gradient backdrop], soft rim light.

**4. Cute Mascot** - chibi, toy-like, friendly. Best for playful, fun, or lighthearted brands only.

> **CHARACTER:** A cute chibi cartoon skeleton with an oversized round skull, big adorable eyes, a small rounded body, and smooth toy-like bones; bright, friendly, non-scary. Same character in every beat. **STYLE:** playful Pixar-style 3D animated render, simple clean [pastel/theme] background, soft even studio lighting, glossy finish.

(Aspect ratio and resolution are settings on the generation - never write them into the prompt.)

---

## The pipeline - four stages, native generation

The whole voiceover is generated first and becomes the factual pacing source; the beats are generated as **silent** animated B-roll and laid over the VO in the editor.

### Stage 1 - Write the script

1. **Ground in the product** - from the product page, brief, or notes, pull what it is, who it's for, the core transformation, the painful status quo, proof, the offer. Never invent proof. Missing something critical → one tight batch of questions, don't interrogate.
2. **Pick the angle + spine** with the strategy above. State the chosen angle + spine in one line with a one-line rationale.
3. **Write the script** in the swipe-file voice: a curiosity-gap hook question, then 5–7 escalating beats, then the payoff + a soft CTA tied to the offer. ~110–160 words (≈30–60s of VO), one sentence per beat. Open the loop in the hook; land the product on one clean "turn" beat; close the loop at the payoff.
4. **Deliver** in the Stage 1 format: the angle line, the full script, then the same script as a numbered **VO line list** (one line = one beat = what the user pastes into speech generation, one clip's worth of narration each).
5. **Invite edits**, then: _"Tweak anything, then paste the final script back and I'll build your visual concept board."_

```
**Angle:** [angle + spine] — [one-line rationale]
**Loop → turn:** [the question the hook opens] → [the beat where the product enters]

## Script — "[Hook title]"
[Full script: hook question + 5–7 escalating beats + payoff/CTA, swipe-file voice.]

## Voiceover line list (one line = one beat)
1. [hook question]
2. [beat 1] …
N. [payoff + CTA]

Tweak anything, then paste the final script back and I'll build your visual concept board.
```

### Stage 2 - Visual concept board

1. **Pick the skeleton style** from the Style Library with a one-line reason.
2. **Lock the world** - recommend the recurring theme/setting that dramatizes the angle, plus 1–2 alternative theme directions (modern office, 1940s, the product's literal industry, post-apocalyptic…).
3. **Map every VO line to a beat** in a grid - one row per line. The skeleton is in every row; what changes is its situation, the setting rung, and the props. Vary the framing across beats (wide establishing → medium → two-shot with a reacting human → close product handling → hero/triumph), and use reaction characters (period townsfolk, coworkers) to amplify the arc.
4. **Ask the user to confirm style + theme and mark favorite beats**, then say what triggers Stage 3.

```
## Visual concept board — "[Hook title]"
**Style:** [one of the 4] — [why it fits]   **Theme:** [world] — [why]   **Alternatives:** [B] · [C]

| # | VO line | Skeleton's situation & emotion | Setting (the spine rung) | Props / product | Caption idea (editor only — NOT in prompts) |
|---|---|---|---|---|---|
| 1 | [line] | [pose, expression, action] | [where] | [props] | "[optional editor caption]" |

The last column is a note for the editor to add later — it never goes into a prompt (generated footage stays clean of text).
Tell me the style + theme and mark any beats to change, then say "generate the stills" and I'll lock the skeleton and write each start frame.
```

### Stage 3 - Lock the hero skeleton + per-beat start frames

1. **Generate the hero skeleton reference FIRST** with your image model - the chosen style block, a clean neutral full-body shot filled to the theme. This is the source of truth every beat points back to.
2. **One start frame per beat** - re-attach the hero skeleton, re-state its character sheet, and add this beat's action, setting, framing, and lighting: a story **moment**, a committed camera **angle**, visible **animatable** emotion. Attach the product reference in any beat the product appears.
3. **No text in any still.**

### Stage 4 - Video generations, synced to the voiceover

1. **Generate the voiceover first** as ONE take with a voice model (one calm, dramatic narrator; ElevenLabs class) - the whole script in one clip, then transcribed word-by-word for pacing. This is the factual pacing source; generate it whole so it doesn't drift.
2. **Batch the beats into video generations** on a model that takes multiple reference images per clip (Seedance 2.0 class) - group consecutive beats up to the ~15s cap, role-label each beat's start frame (`@image[N] = start frame of beat N`), describe each beat's motion + one camera move + the transition to the next, and keep the clips **silent** (no dialogue - the VO is overlaid in the editor). Tell the model the pacing so the visuals land with their lines.
3. **Assemble** the clips over the voiceover in the editor; add background music (tense under the build, lift at the payoff) and any captions **there** - never burned into the footage.

---

## Locked rules

- **R1 - The skeleton is the constant.** One hero skeleton reference; re-attach it and re-state its character sheet in every beat's still; never chain off a previous beat's output. The Style Library block is locked once chosen - don't drift the eyes, bones, or proportions mid-ad.
- **R2 - One VO line = one beat = one rung of the spine.** Cramming two ideas into a beat kills the rhythm and the loop.
- **R3 - The visual is the proof of the line.** Each beat literally shows what the VO says at that moment - a viewer should follow the story with the sound off.
- **R4 - Swipe-file voice.** Second person, present tense, short punchy sentences, one concrete physical image per beat, escalating intensity. Say what physically happens; no corporate voice ("revolutionary", "seamless", "game-changer").
- **R5 - Don't default to one arc.** Diagnose the product first (the angle table); "transformation" is one option, not the default.
- **R6 - Footage stays clean of text.** Captions and on-screen words are an editor layer added later, only if the user asks - never in an image or video prompt.

---

## Worked example (the quality bar - not a template to copy)

A skeleton ad for a **men's fragrance**, angle = _origin/scenario + transformation_, theme = Industrial Revolution:

- **Hook:** "What would happen if you wore [scent] in the 1800s?"
- **Beats (escalating social reaction):** the skeleton sprays the scent in a steaming factory (workers stare) → walks a cobblestone street as townsfolk's heads turn → a noblewoman swoons over "your scent" in an opulent bedroom → an apothecary marvels "…at a fraction of the price" → **payoff:** the skeleton sits crowned on a throne flanked by admirers, "…with their 30-day money-back guarantee."
- **Why it works:** the benefit (irresistible attraction) is made visceral by dropping an ordinary skeleton into a vivid era and escalating the reactions from _recoil_ → _worship_. Triumph payoff + guarantee CTA.
- **Look:** Bare-Bones Cinematic, photoreal period sets, warm muted grade, the same ivory cartoon-eyed skeleton in every beat.

---

## Swipe file (study the voice; tag = angle / spine)

Every one opens on a curiosity-gap question, runs 5–7 escalating beats of concrete physical imagery in second person, and lands a payoff.

- **Transformation / Time** (best for "use the product"): _30 Days of Daily Creatine_ - "Day one, chalky water, you feel scammed… Day 14 saturation hits, jet fuel… Day 30 the brain fog lifts… Day 60 a different person." · _What Braces ACTUALLY Do_ - "Day one it feels weird… Day 30 gaps closing… Day 360 Hollywood smile."
- **Cost-of-inaction / Time** (best for "don't fix this"): _What If You NEVER Cleaned Your Room?_ - "Day one a hoodie on the floor… one month fuzzy green pizza… 3 years a fungal infection in your bloodstream." · _Stop Wearing Caps EVERY Day_ - "Day one you look sharp… Day 365 the roots have disappeared."
- **Limit / Overload / Quantity** (best for "the old way breaks"): _Don't Drink This Much Milk!_ - "One glass refreshing… 15 glasses curdling… 42 glasses your stomach ruptures." · _How Long Can You Drive?_ - "1 hour fresh… 17 hours legally-drunk sluggish… 72 hours total system failure."
- **Origin / Scenario** (best for "what if you had this in [world]"): _Raised by Gorillas_ - "Day one you lose the soft bed… Year 20 human society is an alien world." · _3 Years in Dagestan_ - "1 month out-wrestled by a 12-year-old… 3 years you return a world-class wrestler."

Hook templates across the file: _"What would happen if you \_\_\_?"_ · _"What happens if you \_\_\_ every day?"_ · _"How long can you \_\_\_?"_ · _"How many *** does it take to ***?"_ · _"What if you NEVER \_\_\_?"_

---

## What you need

- An AI chat that can hold the whole flow (script, concept board, prompts).
- A voice model (ElevenLabs class) for the single-take voiceover, and a transcription tool with word timestamps.
- An image model for the hero skeleton and per-beat start frames.
- A video model that takes multiple reference images per clip (Seedance 2.0 class, ~15s), generating silent.
- An editor for assembly, music, and captions.
