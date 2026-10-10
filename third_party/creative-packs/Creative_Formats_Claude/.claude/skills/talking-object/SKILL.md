---
name: talking-object
description: "Use when the user wants an animated talking character video ad - a hook or a full video where one or more characters, rendered in an animated style, talk to camera and deliver a script. A character can be anything animated: a person, an animal, a creature, or an anthropomorphized object, product, ingredient, organ, or molecule - each given a face and a voice. Works in any rendering style (Pixar-style 3D, claymation, watercolor, paper-craft, Lego, and so on). Also activate when the user shares a reference video that, once analyzed, is an animated talking-character ad and they want to replicate that format for their brand. Covers the end-to-end storyboard-to-start-frame workflow: designing the character(s), storyboarding beats, generating a start frame per beat, and batching them into Seedance 2.0 omni-reference video generations. The defining trait is an animated (not photoreal) character speaking; a real, photorealistic person talking to camera is live-action UGC, not this skill."
---

# Talking object

A video ad whose engine is a **character talking to camera**, rendered in an animated style. The character can be anything: a person, an animal, a creature, or an object, product, ingredient, organ, or molecule given a face and a voice. One character or several. A short hook, or a full end-to-end ad. Two things are always true - it's **animated** (not photoreal), and **someone is talking**.

These are _yapping_ videos: a character delivers a script, and the job of the visuals is to make that script land and hold attention. People over-index on the look. The look is a tool. The discipline of this format is: a character worth watching says something worth hearing, and the visuals tell a story while it does. A creative, unexpected character (an ingredient, an object) often helps - but it isn't required; an animated person or animal is just as valid when it fits the script.

Three fundamentals this skill assumes: every generation is self-contained (the model remembers nothing between generations, so anything that must stay consistent is re-described and re-attached every time); reference images are role-labelled in the prompt (say which attached image is which); and spoken lines are written into the prompt in quotation marks with a stated voice emotion, in plain easily pronounced words.

---

## When this skill activates

Two sub-modes: a standalone animated **hook**, or a **full** end-to-end animated talking-character ad. Also fires when the user shares a **reference video** that, once analyzed, is an animated talking-character ad and wants that format replicated for their brand - read the execution against the format you know.

The defining trait is an **animated** character speaking. A real, photorealistic person talking to camera is live-action UGC - a different skill.

---

## The core idea (the only thing that is always true)

The hard constraints of the format are exactly two: the video is **animated**, and a **character is talking.** Everything else is a creative variable - who the character is, how many, the rendering style, and the narrative angle.

- **Every character has a face and can emote.** A person, animal, or creature already is a character - render it in the chosen style and it talks. An object, product, ingredient, organ, or molecule must be _anthropomorphized_: give it eyes, a mouth, and a way to gesture, and decide where the face lives (a jar with eyes on the label and a mouth below; a pill where the dent is the mouth; a molecule whose central atom is the head). If a subject can't look at camera and emote, it isn't a character yet.
- **Don't over-bias to the exotic.** A creative, unexpected character is great when it serves the script, but an animated person or animal is equally valid - choose what carries the message, not novelty for its own sake.
- **Rendering style is a swappable skin, not the format.** "Pixar style" means 3D-rendered, "claymation" means stop-motion clay, plus watercolor, paper-craft, Lego, and others. The format is "a character talks"; the style is a parameter you pick once and hold across every beat.
- **The visual is the proof of the line.** The script carries the message; every environment and action is the visual proof of what's being said at that exact moment. A viewer should understand the message with the sound off.
- **Don't be static.** A character standing still and talking is dead air. Every beat moves, and beats flow into each other with intentional transitions - especially when handing off between characters.

---

## The pipeline - storyboard to start frame

This is the high-control workflow this format runs on. Order matters.

1. **Design the character(s).** Generate a clean **character plate**: the character alone, neutral pose, plain background, in the chosen rendering style. One plate per character. Iterate until you love it - this is the reusable source of truth for that character's look across the whole video (and future videos). See R1 for how to write the plate prompt.
2. **Write the script, pick the hook, and storyboard.** Choose the script variation and tone (see The script layer), write and lock the script one line per beat, and choose the **visual hook** - the first frame, before a word is spoken, that must stop the scroll with the sound off. Then storyboard each beat: its environment, the character's action, the framing.
3. **Generate one start frame per beat.** For each beat, take the character plate as a **reference image** and render that character _in that beat's environment, doing that beat's action_, in the chosen style. A separate image generation per beat (two-step: plate → in-beat start frame). Multiple characters in a beat → attach each character's plate.
4. **Batch the start frames into video generations.** Group consecutive beats into one Seedance 2.0 (Fast) omni-reference generation up to the model's ~15s limit; attach each beat's start frame and address each one (see R3 - the heart of the workflow).
5. **Assemble.** Cut the batched clips into the finished hook or ad.

Pace is script-driven - lean fast and punchy, avoid monologues, but don't force a fixed beat length; the line decides. Estimate runtime by reading the script aloud, pausing at every full stop, then add a beat of breathing room (AI voices run slower than you expect - err longer).

Negative result to respect: don't skip the character plate and generate each beat from scratch - the character drifts. Plate first, then derive every beat from it.

---

## Locked rules

### R1 - Give every character a face that can emote, in a layered design prompt

**Rule:** Each character must be able to look at camera, emote, and gesture. A person/animal/creature has this inherently - render it in the chosen style. An object/product/ingredient/organ/molecule must be **anthropomorphized**: give it eyes, a mouth, and a way to gesture, and decide where the face lives. **Why:** the format's hard constraint is a character _talking_; a subject that can't emote isn't a character yet. **Pattern:** write the plate prompt in layers - opening line anchors the rendering style + subject + 2–3 defining adjectives, then body form, then color/texture, then face, then limbs, then a pose of active intent. Push the design slightly past the obvious so the character is memorable.

- ✅ object: "A friendly HolyCow tallow jar character: large expressive eyes on the upper label, a wide mouth across the lower label, short stylized arms; Pixar-style 3D, plain background."
- ✅ person: "A warm claymation pediatrician, mid-40s, round glasses, white coat, gentle smile; stop-motion clay style, plain background."
- ❌ "The HolyCow jar, animated." (No face, no emoting - the model won't make it a character.)

### R2 - One character plate, re-described and re-attached every beat

**Rule:** Lock each character with a single clean plate, then derive every beat's start frame from that plate - re-attaching it and re-describing the character each time. **Why:** drafts are self-contained (the one law); "the same character as before" means nothing to the model, so consistency comes only from re-attaching the plate and repeating the description. **Pattern:** generate the plate once (step 1); for each beat's start-frame image, attach the plate and restate the character's anatomy + style (abbreviated is fine after beat 1) alongside the new environment and action.

- ✅ Beat 3 start frame: attach jar plate → "image 1 = the HolyCow jar character (large eyes on the label, wide mouth, short arms, Pixar 3D); render it standing on a stylized skin cross-section, pointing at cracks in the barrier."
- ❌ Generating beat 3 from a text-only prompt because "we already made the jar earlier."

### R3 - Batch start frames into one Seedance 2.0 generation; role-label every reference and write the line in

**Rule:** Pass multiple beat start frames into a single Seedance 2.0 omni-reference generation (up to ~15s), label which attached image is which beat's start frame, describe each beat's action and the transition to the next, and write each spoken line into the prompt with an explicit voice emotion. **Why:** Seedance generates up to ~15s per draft; batching consecutive beats under one prompt holds continuity and pacing instead of stitching disconnected clips. Role-labelling stops the model blending the references. This is the workflow's core mechanic. **Pattern** - the standard video backbone (style one-liner → role-labelled `@image[N]` refs → time-blocked beats → camera → dialogue), e.g.:

```
Pixar-style 3D animated spot.
Reference: @image[1] as the start frame of beat 1 (jar in the nursery, facing the mother);
@image[2] as the start frame of beat 2 (jar on a stylized skin cross-section).
[0–5s] Beat 1: the jar turns to camera. It talks to camera in a warm, reassuring voice,
  saying in english: "Because those products were never designed the way your baby's skin was."
  Mother reacts behind it. Cut to —
[5–10s] Beat 2 (from @image[2]): the jar points at cracks in the skin barrier; moisture
  particles escape upward; the walls react. Slow push-in.
Camera: subtle handheld feel; one push-in in beat 2.
No captions. No background music.
```

Aspect ratio, resolution, model, and duration are settings on the generation - never write them into the prompt. Default to **native dialogue** written into the prompt like this; only when a line has complex or unusual words the video model would mangle, generate the speech first with a voice model (e.g. ElevenLabs) and attach it for the video model to lip-sync over.

- ✅ One generation, three short beats, each attached image called out as "start frame of beat N," each line written in with its voice emotion, transitions named.
- ❌ Three images attached with no statement of which starts which beat (the model blends them); or cramming far past ~15s into one generation.

### R4 - Move every beat: the three-layer rule

**Rule:** Every beat needs at least two of these three layers of motion at once (three is better): **camera moving** (orbit, push-in, pull-back, whip-pan, tilt), **character moving** (entering, leaning, gesturing, performing the action that matches the line), **environment reacting** (walls responding, particles radiating, light shifting). **Why:** a static character in a static environment is boring no matter how good the script is; stacked motion is what carries the line. **Pattern:** per beat pick the entrance (the arrival is a reveal - always specify the direction), the character's action, the camera move, and the environment reaction; when handing off between characters, choreograph the transition rather than hard-cutting between two static heads.

- ✅ Jar bursts in from frame-left, presses both hands to the gut wall (cracks seal around it), slow push-in - three layers.
- ❌ Three consecutive beats of the character in the same spot, same framing, just talking.

### R5 - The character carries the brand; the setting can travel

**Rule:** A character's design must carry the brand's visual identity - palette, mood, and lighting are **brand signal, not defaults**. Lock that brand DNA at the plate (R1); then the per-beat _setting_ can change freely with the script (a gym, a kitchen, the body interior) while the character stays brand-consistent. **Why:** the most-missed mistake is defaulting the look (a generic "dark premium" background) and throwing away brand signal. The only exception is intentional contrast - a villain, or a deliberately ugly "before" state. **Pattern:** read the brand (site, packaging, product page) before designing; a feminine pink brand → warm peachy palette and soft pink world; a bold masculine brand → deeper saturation, harder rim light, grounded energy; premium clinical → cool clean whites, sharp light.

- ✅ Plate locks the character's brand-aligned palette/lighting; beat 1 is a nursery, beat 2 is a skin cross-section - same character, brand intact, setting changed.
- ❌ Giving every brand the same default "dark studio, blue rim light" character world.

### R6 - Make the visual the proof of the line

**Rule:** Every beat's environment and action is a direct visual translation of the exact line being said. Read the line, ask "what would this look like if you could see it happening?", and show that. Environment reactions are literal metaphors for the line - never effects for decoration. **Why:** the visuals exist to communicate the message; if they don't depict the line, they're wasted. The test: a viewer understands the message with the sound off. **Pattern:** "I seal the holes in your gut wall" → the character presses both hands to the wall and the cracks close around it; "I calm the inflammation" → cool light pulses out and red walls turn healthy pink.

- ✅ Line says "when you drink" → the character is in a dim bar surrounded by bottles; line says "I filter toxins" → it's inside the body absorbing toxic particles.
- ❌ A character delivering "I increase blood flow" while standing in a neutral studio with nothing happening around it.

---

## The script layer (format-specific)

Only script and hook concepts specific to this format live here; general direct-response copywriting craft applies on top as usual.

**The core script structure - "I am X. I do Y. So Z."** Each character self-identifies, states its mechanism, then states the physical or emotional consequence: _"I'm X. I do Y. So Z happens to you."_ It is modular (works with one character or twenty), inherently visual (each "I am X" is a character-reveal moment), and credible (mechanism + consequence). Everything below is a variation of it.

**Three proven variations:**

- **Pure Introduction** - straight positive, no problem framing. Each character introduces itself, states what it does, states the benefit; the closing character/packaging delivers the CTA. Best for premium brands, awareness, ensemble ingredient casts.
- **Problem then Solution** - open by agitating a real problem the viewer lives with (stated by a narrator, the product, or the body - not a villain), then the solution characters arrive and the "I am X" structure kicks in. Best for cold audiences and scroll-stopping hooks. (The HolyCow worked example is this - a "guide enters" cut of it.)
- **Villain to Hero** - the problem is personified as a villain who speaks first with the structure turned negative ("I'm X. I'm the reason you suffer"), then a dramatic transition and the hero takes over with the positive version. Best for maximum drama and entertainment-first cold-audience content.

**Tone** - pick one register before writing and hold it across every line (e.g. calm specialist crew; quiet ancient defenders; the unbothered fixer; frustrated-and-direct; exhausted-but-hopeful). Offer the user a few options with a vivid analogy each, then lock it.

**The hook** - both layers matter and are format-specific: the **visual hook** is the first frame before any word (stop the scroll with sound off - see step 2), and the **verbal hook** is the first line (call out the viewer's exact problem or desire). Always brainstorm the hook deliberately; never default it.

**One format-specific copy note:** write consequences as visceral, physical, see-able effects ("I seal the holes so toxins stop leaking into your blood"), because each line has to become a visual (R6) - abstract benefit language gives the visuals nothing to show.

---

## Style register (rendering styles)

Pick one rendering style per video and hold it across every plate, start frame, and clip - the style one-liner is the first line of every prompt (it carries the most weight). Common styles: **Pixar-style 3D**, **claymation** (stop-motion clay), **watercolor / aquarelle**, **paper-craft / cut-paper**, **Lego**. The style is a creative parameter, never the substance of the format - the same script and storyboard can be rendered in any of them.

---

## Character types

A quick menu of what the character can be and where its face lives - anthropomorphized ingredient/molecule, object/product, packaging (usually the hero closer that delivers the CTA), body part/organ, or a person/animal rendered in the style.

---

## What you need

- An AI chat that can hold the whole flow (script, storyboard, prompts).
- An image model for the character plates and per-beat start frames (Nano Banana 2 or GPT Image 2 class).
- A video model that takes multiple reference images in one generation (Seedance 2.0 class, ~15s per clip) and can perform native dialogue.
- A voice model (e.g. ElevenLabs) only for lines the video model would mispronounce.
- An editor for assembly.
