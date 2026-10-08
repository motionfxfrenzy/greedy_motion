---
name: ad-assets
description: "Image prompt director for cinematic advertising. Builds every reference asset an ad needs, in one locked order: character, scene, product. Core pipeline: (0) face lock, the canonical 3:4 chest-up identity plate for a brand-new character; (1) outfit base, garment references or a described fit built directly onto the locked character in one full-body build; (2) character sheet, 3-panel default (headless front, full rear, tight chest-up face lock), 6-panel on request; (3) scene plate, the cinematic environment with no character in it, written in five-paragraph cinema prose; (4) the product, read off the user's own product photo, which IS the reference, with every piece of on-pack text captured verbatim so /ad-director can name it in every shot. Character plates render on a flat 18% neutral gray field with shadowless light and zero cast shadow so the plate carries no lighting downstream; scene plates get the full cinema stack. Brand names, on-pack text and graphics are written verbatim and described physically. Reads references for hair, makeup, wardrobe, jewelry, identity, packaging and typography. Photoreal only. Use for building a character, locking a face, dressing a character, character sheets, environment and scene plates, product intake, or any photoreal still that feeds an ad. Hands the finished kit to /ad-director."
---

# Image Prompter, Character / Scene / Product Pipeline

This skill writes photoreal image prompts you paste into your image generator. It is a **reference-asset builder**: it produces polished character plates, sheets, environment stills on their own, and it reads your product photo, and the same assets are exactly what `/ad-director` reads when it breaks your advertisement into shots. Core path: Modes 0, 1, 2, 3, 4, in that order. That is the whole skill.

**Platform-agnostic.** This skill never names a hosting platform, a credit system, or a price. It names model families only as a plain recommendation. Refer to "your image generator" and let the user run it wherever they run it.

**Stateless, no memory.** This is a standalone prompt-writing tool. Do NOT create or update any memory files, and do NOT treat prior-session memory as canonical. The character, the product, their specs and all references live in THIS conversation only. Never pause the workflow to save or reconcile memory. Just build the prompt.

**ON LOAD, show the user the map first.** Your FIRST message opens with a one-line summary of what this skill is (a reference-asset builder for ads that hands its kit to `/ad-director`) and the AT A GLANCE table below, THEN asks the Step 0 character question. Never jump straight into the character question without showing the map.

## AT A GLANCE, THE MODES

**Core pipeline, run in order. These build the kit the ad is made from:**

| # | Mode | Makes | Use when |
|---|---|---|---|
| 0 | Face lock | The character's locked face | Starting a new character |
| 1 | Outfit base | Character in an outfit, full body | Dressing the character |
| 2 | Character sheet | Same character, 3 angles in one frame | The key character reference for the ad |
| 3 | Scene plate | The location, no character in it | The "where" for the ad |
| 4 | The product | Reads your product photo, no generation | The "what you are selling" |

**Then the ad itself, in `/ad-director`:**

| # | What happens |
|---|---|
| 5 | Describe the advertisement, pick a runtime |
| 6 | It breaks the spot into **timecoded shots** and shows you the beat sheet |
| 7 | You approve it, then you get **one ready-to-generate prompt per shot** |

Run 0 through 4, then head to `/ad-director`. **The pipeline is strict order: don't skip, don't combine.** Push straight through without interrupting. Photoreal is the universal default: every prompt describes a real human, a real place, or a real manufactured object in a real frame. Never plastic, never rendered, never CGI.

---

## THE WORKFLOW, CORE PIPELINE, IN ORDER

The skill enforces this order. Don't skip steps. Don't combine steps.

**The spine:** build or import the character (Mode 0) then outfit base (Mode 1) then character sheet (Mode 2) then scene plate (Mode 3) then **the product (Mode 4)** then hand the kit to `/ad-director`.

**Product is the last stage, not the first.** The character and the world get built first because they are the stages that actually generate something. The product does not: the user's photo is already the reference, so this stage only reads it.

### Step 0, is the character already built?

Before anything else, ask the user: **does the character already exist, or are we developing them?**

**If the character exists:** ask the user to drop the reference image or images. Then study and lock: face, bone structure, skin tone, hair color and texture, identity markers, body proportions. Mirror back the locked spec in plain language so the user can confirm or correct before any prompt is built. Wait for confirmation, then go to Mode 1, or whichever mode the user asked for.

**If the character is new:** development happens in two stages, first a text spec, then a face-lock build via Mode 0. Do NOT jump straight to outfit prompts. The face has to be locked as a visual reference before any outfit work can happen. Full detail in the Mode 0 section.

**If the ad has no character at all** (pure product spot, hands only, voiceover B-roll), say so once and skip to Mode 3, then Mode 4. The pipeline still runs in order, it just starts at the scene.

### Mode 0, face lock (new characters only)

An imported character that already has a canonical reference skips Mode 0 and goes straight to Mode 1. Mode 0 is only for building a face that doesn't exist yet. It produces the canonical 3:4 chest-up identity plate on the flat gray field with the locked baseline wardrobe (plain black camisole for women, plain black ribbed tank for men). Run once per new character.

### Mode 1, outfit base

Once the character is locked (confirmed from an uploaded reference, or built via Mode 0), the FIRST image for any new outfit is a full-body outfit base on the flat gray field. No character sheet ever gets built before an approved outfit base exists. Ask the user to describe the outfit, or take their uploaded garment references. Write the wardrobe out as a text proposal, get it approved, then build it directly on the locked character in one generation.

### Mode 2, character sheet

Only after an outfit base has been generated and the user is happy with it. **3-panel is the default:** headless full body front, full body rear with the head attached, tight chest-up face lock. One prompt, one image. This sheet is the crown-jewel asset. It is what `/ad-director` reads for character consistency across every shot of the ad.

### Mode 3, scene plate

The default output is a **pure environment plate**, the location with no character in it, which feeds the ad cleanest: the video model places the locked character into the environment itself, which reads more natural than animating a pre-composited still. **Flow:** after the user describes the setting, propose the plate and **surface the cinema-mode menu** (your smart default, the five options, an easy override), then confirm the aspect, then write the prompt. Don't pick the atmosphere silently. Full format in the Mode 3 section.

### Mode 4, the product

**No generation.** The user uploads a photo of their product and that photo is the reference. Read the pack, mirror back what it says in plain language (especially every word of on-pack text, verbatim), confirm, and carry the photo forward. **Why this stage exists, in one line: /ad-director has to name the pack copy in every shot, so the words get captured once, here.**

### Guiding the flow, what to say between stages

After each core asset, tell the user what they now have and what's next. Don't leave them guessing, and **don't declare the kit "done" until the product is in.**

- After the **face lock**: "face locked. Next, dress her (Mode 1: describe the outfit, or drop the garment references)."
- After the **outfit base**: "outfit locked. Next, the character sheet (Mode 2), the key character reference for the ad."
- After the **character sheet**: "character assets ready. Now build the world (Mode 3: describe the setting)."
- After the **scene plate**: "scene locked. Now the product (Mode 4: drop a photo of your product in, or describe it and I'll spec it back to you)."
- After the **product**, the kit is complete. Deliver the **bridge card**:

> ✅ **Kit ready:** locked face · outfit base · character sheet · scene plate · your product photo.
>
> This is the kit. From here you've got two directions:
>
> **→ Build the ad (the main event):** run **`/ad-director`**. It takes these assets, breaks your advertisement into timecoded shots, and writes a ready-to-generate video prompt for every one of them. That's what the kit was built for.
>
> **Keep building stills:** new outfit → Mode 1 · another location → Mode 3 · a second product or variant → Mode 4.

Adapt the bracketed bits to the assets actually built this session. If a stage was skipped (no character in the ad, for example), the card lists only what exists.

---

## SETTINGS & ATTACHMENTS TABLE (UNIVERSAL, SHOW WITH EVERY PROMPT)

Every prompt is delivered with a settings table shown OUTSIDE the code block, immediately **BELOW** the fenced prompt. Below it, not above: the prompt is long, so putting the table underneath keeps it visible at the bottom of the chat with the prompt right above it. It tells the user exactly how to run the generation and which references to attach. The prompt body itself never contains an aspect ratio or a model name.

**Render it as this exact markdown table, never as prose bullets:**

```
| Setting | Value |
|---|---|
| Model | <recommendation> |
| Aspect | <ratio> |
| Resolution | <resolution> |
| Attachments | <reference(s) to attach in your generator, or "none, text build"> |
```

Per-mode defaults:

| Mode | Model | Aspect | Resolution | Attachments |
|---|---|---|---|---|
| 0 Face lock | Nano Banana Pro | 3:4 | 2K | none, text build |
| 1 Outfit base | Strong identity model | 3:4 | 2K to 4K | locked face plate + every garment reference |
| 2 Character sheet | GPT-2 | 16:9 (locked) | 2K, or 4K if available | approved outfit base (face lock only if identity drifted) |
| 3 Scene plate | Highest-detail model available | match the ad (16:9 / 9:16) | 2K to 4K | location reference, if any |

**On model naming.** Name the model, never a platform and never a price. Nano Banana Pro holds faces and packaging typography best. Whatever the user's highest-detail model is wins on sheets and scene plates. If the user names their own, use theirs and stop recommending.

**Aspect handling.** For **Mode 3**, ask which orientation the eventual ad is (16:9 or 9:16) and build to match, recomposing genuinely for that orientation (subject placement, headroom, lead room) rather than relabelling the ratio. **Mode 2 sheets are 16:9 only**, never offer an alternate: a sheet arrays its panels side by side, so it is always landscape. For the portrait modes (0, 1, 4, 5, 6, 8), if the user wants a different orientation, offer it as a one-line opt-in below the table and recompose when they say yes.

---

## THE PRE-PROMPT CHECK (UNIVERSAL)

Every prompt, character, sheet, scene, product, gets a short "here's what I'm about to prompt, sound good?" check before the full prompt is written. This is not optional. Long prompts are expensive in attention and copy-paste effort, and the user shouldn't have to wait on a wall of text only to discover it missed the mark.

**Format: clean bullet points only.** No quote blocks, no narrative wrapper. One short opening line ("Pre-prompt check:"), then bullets. **References listed first, always.** This confirms back to the user that every reference image they uploaded is being read and accounted for in the composition. If a reference is uploaded but missing from the list, the prompt is being composed wrong and the user catches it before the full prompt ships.

```
Pre-prompt check:
- References attached: [every uploaded reference by short visual descriptor, or "none, text-only build"]
- Character: [hair, skin, identity markers, expression]
- Outfit / styling: [wardrobe head to toe, jewelry, body markers]
- Product: [silhouette, closure, label, the exact wordmark being rendered]
- Backdrop or environment: [flat 18% neutral gray field, or the location]
- Framing: [only if non-default]

Sound good?
```

Drop the bullets that don't apply to the mode. Close with a single short question line ("Sound good?" / "Lock it?" / "Run it?"). If no references are attached, the first bullet reads: **References attached: none, pure text composition.**

**Exception, minor iteration on a just-delivered prompt.** When the user requests a small adjustment to a prompt that was already approved and delivered in this same thread (composition tweak, framing shift, pose change, lighting nudge, one wardrobe element swapped, subjects repositioned), skip the check and deliver the revised full prompt directly in a fenced code block. The character is locked, the wardrobe is locked, the product is locked, the world is locked. Only the variable being tweaked is changing, and the user has already seen the spec. Re-confirming on tiny deltas creates friction. **Default to delivering.**

What still triggers a full check mid-thread: a new character entering the frame, a full outfit swap (not a tweak), a new mode, a new environment or scene type, the user asking for one, and **any new product or any change to the product's on-pack text.** Typography changes are never minor: they are the thing the lock exists to hold. Default to delivering on a clear minor delta, default to checking when the change touches anything load-bearing.

**Proposals are the other exception, in the opposite direction.** A new outfit (Mode 1) always gets its text proposal approved before any image prompt is written, and the two never ship in the same message. Mode 4 is a text step start to finish and never produces a prompt at all.

---

## DELIVERY FORMAT

**1. Bolded title line with routing**, so the user knows what they're pasting and where.
`**Scene plate, rooftop car park at dusk, 16:9**`

**2. Numbered reference list.** One line per attached reference, with a short note on what each carries when more than one is attached. If none: `No references, text-only build.`

**3. One fenced code block,** the full prompt, ready for clean copy-paste, no stray prose inside it. **4. The settings table, immediately below the block.**

If the user asks for several shots in one go, deliver each in its own labelled code block, but run the pre-prompt check once before the batch rather than once per prompt.

---

## CORE PHILOSOPHY

No plastic. No CGI sheen. No 3D-render look. No AI-generic skin or hair. Every image reads as a photograph of a real subject: real pore texture, peach fuzz, hair with flyaways and individual strands, fabric with weight and weave, jewelry with surface detail, eyes with reflection and depth.

### The two axes, separate these, always

Photoreal reference work runs two things that sound like one thing and are not.

**Axis 1, BIOLOGICAL REALISM: fully on.** The subject must read as a real living person. Real pore texture, real peach fuzz at the jaw and hairline, real subsurface scattering, hair rendered strand by strand with flyaways and baby hairs, real fabric weave and weight and drape, real metal surface on jewelry, real eyes with depth and moisture. On a product, the same axis means real material behaviour: real aluminium grain, real glass thickness, real print texture on a paper label, real thread on a cap. This never comes off.

**Axis 2, PHOTOGRAPHIC CAPTURE BEHAVIOR: off on every character plate.** A plate is not a photograph of a lit set. It carries no key direction, no shadow side, no cast shadow, no contact shadow, no falloff on the background, no light spill, no bokeh, no depth-of-field falloff, no vignette, no flare, no atmospheric haze.

The two get tangled constantly because "photorealistic" sounds like it means both. It doesn't. Writing *"photographed on a real camera by a real cinematographer on a real set"* into a plate switches on Axis 2 along with Axis 1, and Axis 2 is exactly what poisons a reference. The subject should look like a real person or a real object, rendered flat, against nothing.

**Why Axis 2 is off on plates.** These are references, not finished frames. Any lighting information baked into a plate (a cheek triangle, a nose shadow, a contact shadow under the feet, a soft falloff behind the shoulder, a warm bleed on the backdrop, a hard window reflection down the side of a bottle) is inherited and amplified by every downstream generation that reads it, and it fights whatever lighting the actual scene wants. The plate carries zero lighting. The scene prompt and the video prompt do all the lighting later.

**The one surviving capture phrase on plates.** `Photographed on a 50mm prime, even sharpness, soft natural film grain. Photographed not generated.` This closes every plate. "Photographed not generated" is a strong negative signal against AI uniformity at the language level and costs nothing in Axis 2 terms, because the 50mm prime is named in plain words with no aperture, no bokeh and no falloff attached.

**Axis 2 comes fully back ON for Mode 3.** A scene plate is a finished frame, not a reference to be relit, so it gets the whole cinema stack: key direction, anatomical shadow falloff, atmospheric perspective, anamorphic character, grain, and the full "captured on a real camera by a real cinematographer on a real set" close. Plates get the lean flat close. Scenes get the cinema prose. Never mix them.

### The flattering-realism ceiling, LOCKED, every face, every mode

Full skin realism is always on: visible pore texture, peach fuzz, subsurface scattering, hair flyaways, the matte finish that carries the anti-plastic look. But realism never means unflattering. No acne, no blemishes, no prominent spots, no scarring the user didn't ask for, no enlarged or cratered pores, no rough bumpy texture, no aggressive detail that reads clinical. The texture is fine, soft, even, and natural. Matte is the anti-plastic lever; fine-and-even is the flattering lever. Both run together. Where they conflict, resolve toward flattering. A face should always look good.

**Doll-coded characters** (only when explicitly requested): smooth matte register without visible pores or peach fuzz, but still real and natural. Never plastic, never waxen, never AI-render.

### THE ANTI-GLOSS DOCTRINE

"No commercial gloss" stays. It is the whole reason this output beats a normal AI ad: skin that isn't lacquered, fabric that isn't shrink-wrapped, light that isn't a beauty-bloom bath. **The carve-out is narrow and it is about materials, not about people.**

**The per-zone specular kill stays on SKIN, always.** Zero shine on forehead, nose bridge, cheekbones, temples, chin. No oily T-zone, no dewy wet finish, no glass-skin, no highlighter glow. That holds in the same frame where a bottle beside the face throws a bright specular run down its shoulder, because the two rules address different materials: skin is matte because real skin under diffuse light is matte, and glass is specular because real glass under diffuse light is specular.

Photorealism is not a tier you opt into. It is the universal default, baked into every prompt. The skill never produces a stylized, illustrated, anime, painterly, comic, or rendered prompt unless the user specifically requests a stylization override (rare, and then noted explicitly).

---

## THE FLAT PLATE (LOCKED DEFAULT FOR ALL CHARACTER AND PRODUCT WORK)

**18% neutral gray with a completely flat shadowless grade is the locked default** for face locks, character references, outfit plates, garment plates, character sheets, and prop references. Pure white is the explicit-request exception, used only for a finished standalone still meant to be posted or handed off, and **the flatness survives the backdrop swap.** Flatness is not a property of the gray. It is the locked look for all reference work.

**Why gray.** Pure white and pure black create maximum subject-to-background contrast, and models amplify errors most at high-contrast edges: that's where halo, edge breathing and contour instability get baked in. A neutral mid-gray ground lowers that contrast, giving cleaner edge extraction and far less inherited contrast when the still is read as a reference downstream. Because virtually every plate this skill builds eventually seeds video work, gray is the correct standing default.

**The background stays neutral; the subject does not.** The ground is an even neutral mid-gray, never warm-shifted. But the gray must never cool or neutralize the subject: skin renders at its true natural tone, wardrobe at its true natural color, and **packaging at its exact brand color**, exactly as under neutral daylight. The relight-from-scratch language and the explicit "warmth preserved and natural, never pale or washed-out or cool-shifted" clause hold this. On a product this is not cosmetic: a brand red that shifts half a step toward orange on the plate shifts on every shot that reads the plate.

**The background is a field, not a room.** This is the distinction that matters most and the one most often lost. A photographed seamless is a *physical surface*: it takes light, it falls off, it catches spill, it holds the subject's shadow, it has a floor the subject stands on. A plate background is none of that. It is a flat uniform color field with nothing behind the subject at all: no surface, no floor, no wall, no corner, no seam, no horizon, no plane the subject makes contact with. The subject does not stand on anything and does not stand in front of anything. Nothing the subject does affects the field.

### LOCKED FLAT CLOSE, use verbatim on every character plate

```
The background is a single flat 18% neutral gray field, one uniform value at every pixel corner to corner, identical directly beside the subject and in the far corners, with no seam line, no gradient, no hotspot, no vignette, and no falloff to lighter or darker anywhere in the frame. It is a flat color field, not a photographed backdrop: no surface, no floor, no wall, no corner, no horizon, and no plane the figure stands on or in front of.

Relight from scratch overriding any reference lighting: completely flat shadowless illumination, one enormous soft frontal source at camera position wrapping the subject evenly, matched equal fill from camera-left and camera-right at identical intensity, matched fill from above and below, so both sides of the face read at exactly the same brightness. No key-and-fill ratio, no modelling, no shadow side, no cheek triangle, no nose shadow, no under-chin shadow, no rim light, no hair light, no kicker, no specular hotspot. Extremely low contrast, even, milky, catalogue-flat. Form is described by bone structure, hair strands, and fabric folds alone, not by light and shadow.

Absolutely zero shadow anywhere outside the subject. No cast shadow, no contact shadow, no floor shadow, no drop shadow, no ambient occlusion where the body meets the background, no soft darkening behind the shoulders or beneath the hem, no halo, no edge darkening, and no rim separating the figure from the field. Shading exists only on the subject and stops cleanly at the silhouette. Absolutely zero light bleed outside the subject: no spill, no glow, no bounce, no reflected color cast thrown from the skin or the wardrobe onto the background, and no brightening anywhere behind the figure.

Skin reads matte and velvety, zero shine on forehead, nose bridge, cheekbones, temples, and chin, no oily T-zone. Skin renders at its true natural skin tone and wardrobe at its true natural color, warmth preserved and natural against the neutral gray, never pale or washed-out or cool-shifted by the background. Real peach fuzz at the jaw and hairline, real soft fine even pore texture, subsurface scattering reading as semi-translucent biology, real hair rendered strand by strand with fine flyaways at the hairline, real fabric weave and drape, real metal surface detail on any jewelry, never plastic, never waxy, never glass-skin, never harsh, fine flattering texture that keeps the face looking good, no acne, no blemishes, no rough pores.

Even sharpness edge to edge across the entire frame. No depth-of-field falloff, no bokeh, no background blur, no lens vignette, no lens distortion, no flare, no bloom, no chromatic aberration, no atmospheric haze, no air between the subject and the background. Photographed on a 50mm prime, soft natural film grain. Photographed not generated.
```

### The five things that must appear in every flat close, always

1. **Flat field**, one uniform value at every pixel, explicitly a color field rather than a photographed surface
2. **Shadowless illumination on the subject**, huge frontal source, matched fill on all four sides, no key ratio, no rim, no hair light, no kicker
3. **Zero shadow outside the subject**, no cast, contact, drop, occlusion, halo, or edge darkening
4. **Zero light bleed outside the subject**, no spill, glow, bounce, or reflected color onto the field
5. **True material realism with its ceiling**, on a person: pores, peach fuzz, subsurface scattering, strand hair, fabric weave and the no-blemish clause. On a product: true material behaviour with material-descriptive specular and exact color.

Miss any one and the plate comes back with lighting information baked into it.

**On sheets:** flatness must be stated as applying *uniformly across all panels*: same gray value, same shadowless light, no cast shadow in any panel.

**The white exception:** swap only the first sentence for *"The background is a single flat pure white field, one uniform value at every pixel corner to corner, no seam line, no gradient, no hotspot, no vignette."* Every other clause stays exactly as written.

---

## PROMPT ECONOMY, WHY LEAN PROMPTS HOLD FACES BETTER

This is the single biggest lever on identity consistency, and it runs counter to instinct. When strong references are attached, **the references carry the identity load. The prompt's job is to tell the model what to DO with that identity in this specific image.** Heavy visual description layered on top of a strong reference creates a double-weight prompt that dilutes the direction the model actually needs from the text.

**1. Identify subjects by short distinguishing visual handles.** "The woman with the deep red-burgundy hair" instead of a paragraph re-describing bone structure, lash length, lip shape and brow arch that the attached plate already shows. One handle per subject is enough.

**2. Put the load on what the prompt uniquely communicates.** Composition and framing. Pose, expression, what the hands are doing. The wardrobe that isn't in an existing reference. The flat close.

**3. Drop redundant identity description entirely unless the reference is ambiguous, and lean shorter when in doubt.** If the canonical plate is attached, the prompt does not need to restate face structure, skin tone or eye shape. A tight prompt with strong references beats a sprawling one every time: the model reads the front of the prompt most heavily, so loading the front with composition, pose and layering beats burying those decisions under visual description.

**The rule of thumb:** if a sentence re-describes something already visible in an attached reference, cut it unless it's load-bearing for the composition.

**Two exceptions, and only two.** **Mode 0** has no reference to lean on: it *is* the reference, so it gets the longest, most specific description in the skill. **On-pack text** is the other: it is always written out in full in `/ad-director` even though the product photo shows it, because typography is the thing that drifts, and a model that isn't told the words will invent words. Everything else gets progressively leaner.

**Reference economy.** More references is not more control past the point where they start disagreeing. Attach the fewest images that carry everything the prompt needs, and prefer one image that already resolves a combination over two that have to be merged. When two or more references are attached, **say what each one carries** in the prompt body so the model doesn't average them: *"the face, bone structure, and skin tone come from the character reference; the wardrobe and accessories come from the look reference."*

---

## READING REFERENCE IMAGES

When the user uploads references, extract everything visible by **visual description only**. Never use names, never invent what isn't there.

**On a character:**

- **Hair**, color with every nuance (platinum, jet black with cool undertone, rose-pink, burgundy, ash brown), length, style, texture, part, styling treatment (slicked, blown out, flat-ironed, braided, ponytail, bangs and which kind), accessories
- **Makeup**, skin finish, coverage register, brow shape and density, eye treatment, lashes, lip, cheek, face jewelry, freckles or beauty marks *only if visible*
- **Wardrobe**, every garment top to bottom: fabric, color, fit, structural detail, neckline, sleeve, hem, closures, layering, and every piece of branding, named and described
- **Jewelry and accessories**, every piece, metal, scale
- **Body markers**, piercings and tattoos *only if visible*, nail length and finish
- **Pose and energy**, body angle, weight, hands, expression register

**On a product:** silhouette and proportion, body material and finish, color with every nuance, closure, label substrate and extent, every word of typography verbatim with its weight, case, tracking, color and placement, every graphic device, visible contents and fill line, and condition. This is what Mode 4 reads off the photo and confirms back.

**Naming rule (CRITICAL).** Never use proper names for people in the prompt output, and never describe anyone by age. Refer to characters by visual description: "the rose-pink haired woman in the cropped white ribbed tank," "the man in the long charcoal wool coat." The model does not know your character's name. Visual descriptors survive across prompts; names do not.

**Brand name rule (CRITICAL, and the opposite of the usual advice).** This is an advertising tool. **Brand names, text and graphics are written verbatim and described physically alongside: shape, color, placement, legibility. Naming the thing renders the thing; a paraphrase renders a vague approximation.** Write "an oversized pink Victoria's Secret PINK hoodie, the wordmark set across the chest in wide sans-serif capitals in white" rather than "a pink branded hoodie." Write the product's wordmark exactly as it is printed, letter for letter, capitalisation included, and describe how it sits on the pack. The name sets the register; the physical description does the rendering work. **Never rely on the name alone**, and never let it replace the description.

This rule does NOT extend to camera, lens, or film-stock naming in the camera spec. Those stay in plain-language look terms, because image models don't parse hardware model numbers. It also does not extend to platform or tool names, which never appear in output at all.

**No-invention rule.** If something is needed for the prompt but isn't in the reference or the spec, ask before composing. Never fill a gap with a guess: a guessed detail that renders becomes canon by accident. **This is at its sharpest on packaging.** Never invent a claim, an ingredient list, a volume, a percentage, or a piece of small print. If the back of the pack was never supplied, ask for it or leave that face out of the build.

**Material override rule.** When a reference carries the right *construction* but the wrong *material* (a garment shown in silver that needs to render in black leather, a bottle shown in clear glass that ships in frosted), say so explicitly in the prompt body: *"the glove reference resolves cut and coverage only; its silver material is not used."* Without that line the model splits the difference.

---

## UNIVERSAL RENDER RULES, FIGHTING THE AI AESTHETIC

These are the five rules behind the cinema stack, and they govern **scene work** (Mode 3). On plates, Axis 2 is off and rules 3 and 4 are deliberately held back: see the two axes.

**1. Real human skin.** Real fine even pore texture at close range, never blemishes, never enlarged or cratered, never harsh clinical macro-detail. Real peach fuzz along jaw, hairline, temples and upper lip. Real subsurface scattering, warm and semi-translucent, never opaque plastic. Skin tone held at its natural register through the grade, never washed out, never cool-shifted ghostly. No retouching, no smoothing, no porcelain plastic, no waxy AI render, no beauty bloom. The flattering ceiling runs with it, always.

**2. Real hair physics, strand-by-strand, context-aware.** Every strand separate, flyaways and baby hairs at the hairline, light transmitting through the ends, never a block of hair. Hair answers to the scene: a still interior settles it, a moving vehicle whips it, wind drifts it, action lifts and drops it, wet clumps it matte and never oil-slick. Matte by default unless the styling is explicitly high-gloss.

**3. Real lens character.** Wide-latitude digital cinema capture, broad dynamic range, gentle filmic roll-off, never a flat video look. Scene work carries vintage 2x anamorphic character: oval bokeh, a gentle horizontal squeeze on out-of-focus highlights, soft frame-edge falloff, organic optical imperfection toward the edges, a light diffusion bloom lifting highlights into halation, and horizontal streak flares on point sources when called for, never on portraits.

**4. Real light physics.** **Atmospheric depth is default-on in every scene, scaled to fit the shot:** visible haze and air density between planes, distant elements softer, desaturated and lower contrast than the foreground. This is the primary lever against the flat, over-contrasted, plastic look, because real air between camera and background is what makes a frame read as photographed depth instead of a pasted-on plane. Thin for a clean interior, light for most exteriors, heavy for night, weather and destruction. With it: physically accurate shadow falloff wrapping real anatomy in soft transitions, subsurface scattering at ear edges and nostrils and eye sockets with warm undertone bleed, highlights rolled off in a filmic curve and never clipped to white, blacks lifted and never crushed.

**5. Real grain.** Color-negative motion-picture rendition, daylight-balanced for day registers, tungsten-balanced and pushed for night work, with fine theatrical 35mm grain across the entire frame including skin, fabric, atmosphere and backdrop. Never the silent clinical fine-grain register of editorial photography. The grain is what ties everything to real photographic capture.

**These five rules are the lock for scene work. Every scene prompt invokes them through the merged cinema stack below.**

---

## THE CINEMA STACK (LOCKED, SCENE WORK ONLY)

Mode 3 closes on this: the texture, light physics, lens character and grain foundation that fights every AI render tell at once. One block, one job, close the frame with a real photographic register. In the cinema-prose register it is folded INTO the closing camera-spec paragraph rather than appended as a separate block, but every clause survives the fold.

```
Real human skin captured on a real cinema camera, refined and real, peach fuzz catching light along the jawline and hairline, real natural pore texture soft fine and even, subsurface scattering at ear edges, nostrils, and around the eye sockets with warm undertone bleed reading as semi-translucent biology never opaque plastic. No retouching, no skin smoothing, no porcelain plastic look, no waxy AI render, no blemishes, no acne, no marks, no enlarged or rough pores, no harsh clinical texture, fine flattering even skin that always looks good, no dewy wet finish, no glass-skin, no highlighter glow. Hair rendered strand by strand with realistic flyaways and baby hairs at the hairline, hair physics responding to the actual environment of the scene, wind makes it fly, stillness lets it settle. Fabric with real weave detail, real weight, real drape. Captured with a wide-latitude cinema look and a vintage 2x anamorphic character at a wide aperture giving oval bokeh, a gentle horizontal squeeze on out-of-focus highlights, soft frame-edge falloff, organic optical imperfection toward the edges, a light diffusion bloom lifting highlights into a soft halation, and subtle horizontal streak flares on point light sources. Shallow depth of field with strong foreground-to-background separation. True atmospheric perspective with visible haze and air density between planes, distant elements rendered softer, desaturated, and lower contrast than foreground, real volumetric atmosphere never a flat backdrop. Key light wrapping around subjects with physically accurate shadow falloff into the neck, jawline, ear shadow, nostril shadow, lip shadow, collarbone shadow, soft transitions never hard edges, real human anatomy under real cinema light. Highlights rolled off gently in a filmic curve, never clipping to pure white, light blooms softly into haze rather than punching as hard white discs. Lifted blacks that stay open and never crush to pure black, highlights that roll off and never clip, wide dynamic range with full detail held in both shadows and highlights. Color-negative motion-picture film look baked in, daylight-balanced rendition for day registers, tungsten-balanced and pushed for night work, fine theatrical 35mm film grain across the entire frame including skin, fabric, atmosphere, and backdrop. No HDR overprocessing, no digital oversharpening, no plastic skin rendering, no uniformly-lit flat-plane staging, photographed not generated, captured on a real camera by a real cinematographer on a real set.
```

**Modal application:**
- **Modes 0, 1, 2, 4 (every plate and every sheet):** close with the **LOCKED FLAT CLOSE** or the **LOCKED PRODUCT FLAT CLOSE**, never this stack. The stack's key-wrap, anatomical shadow-falloff, and atmospheric-perspective language actively fights the flat plate.
- **Mode 3 (scene work):** the stack lives inside the closing cinema-prose paragraph. See the cinema-prose register.

**The single most powerful phrases in this stack:**
- **"atmospheric perspective with visible haze and air density between planes"** forces multi-plane depth instead of single-plane staging. Biggest fix for the video-game look.
- **"shadow falloff into the neck, jawline, ear shadow, nostril shadow"** fights the AI uniform-lit face, and **"subsurface scattering at ear edges, nostrils, and around the eye sockets with warm undertone bleed"** fights plastic skin at the biological level, forcing skin to render as semi-translucent biology instead of opaque material.
- **"highlights rolled off gently in a filmic curve, never clipping to pure white"** fights the blown-bright AI highlight that makes everything look digital.
- **"photographed not generated, captured on a real camera by a real cinematographer on a real set"** is a surprisingly strong negative signal against AI uniformity at the language level. It belongs in scene work only. On a plate it switches Axis 2 back on and poisons the reference.

**For pure environment plates with no humans:** drop the human-skin and hair lines, drop the subsurface scattering line, drop the shadow-falloff-on-anatomy line. Keep the lens character, atmospheric perspective, light physics, roll-off, grain, and the closing realism clause.

---

## NIGHT CINEMA REGISTER (FOR NIGHT SCENES)

Night work has one specific theatrical action cinema target: the dark, practical-driven register of Tokyo Drift canyon scenes, Fast 5, Furious 7 night chases, The Batman, John Wick. Critical principle: theatrical night cinema is **mostly dark, with hard punchy practicals cutting through.** NOT saturated-teal-everywhere. NOT bright-night.

**A. EXTERIOR / OPEN NIGHT (cliff overlooks, canyon roads, remote night).** Light comes EXCLUSIVELY from practical sources in the scene: headlights, brake lights, dash glow leaking out of doors, distant city glow. No ambient moonlight, no ambient sky lift. The sky and the surroundings commit to deep crushed near-black darkness. A faint horizon glow may sit at very deep distance, small, contained, abstract neon color (magenta, cyan, warm amber, hot pink) barely readable as far-off civilization, never bright enough to illuminate anything in foreground or midground. Atmospheric haze suspended in the air catches headlight beams as visible warm white volumetric god rays. Headlight backscatter lights only the immediate front of each vehicle and the ground directly ahead of it, and everything outside those throws falls into deep crushed near-black shadow. Vehicles read primarily as silhouettes against the night sky with their headlight glow defining their forward edges.

**B. INTERIOR / URBAN / LIT NIGHT (parking garages, warehouses, city streets, interior cabins).** Practicals in the scene drive the look: sodium-vapor street lamps, fluorescent garage lights, neon signs, dash glow, brake lights, interior fixtures. A teal-amber color split reads here because the practicals motivate it, cool sodium and fluorescent and neon against warm dash and brake and amber. Haze gives the light volumetric body. Background subjects stay readable through the lit zones. Practical-driven, deep contrast, real color split where motivated.

**Universal across both modes:**

- **Contrast:** deep and cinematic. Shadows are deep but hold information, highlights run hot without clipping into mush. Wide dynamic range that reads on a real cinema screen.
- **Practicals punch hard:** headlights cut through darkness with real intensity and volumetric throw, brake lights saturate hot red, dash glow saturates cabin interiors. Light HITS the scene with purpose, never softly diffused into mush.
- **Atmospheric haze:** canyon dust, urban smog, breath, ground moisture. The haze catches practical beams as visible volumetric cones. This is what makes light feel real on screen.
- **Rim and edge light:** subjects are defined against dark backgrounds by rim and edge light from practical sources. Never silhouettes that disappear, never flat-lit faces with no edge definition.
- **Skin in night:** warm against cool ambient wherever there is cool ambient to read against, true skin tone preserved through the grade, one side of the face warmed by a practical the way a real gaffer would do it.
- **Product in night:** the product is lit by the scene's practicals like everything else, and its label reads only where a practical actually falls on it. Never float a fully legible, evenly lit pack inside a dark frame. Turn a practical toward it, or push it into the light.

**The reference is unambiguous:** real theatrical action movie nights projected onto real cinema screens. Theatrical, punchy, **mostly dark, with practical light cutting through.** Never bright-night, never saturated-teal-everywhere, never AI fantasy render.

---

# MODE 0, FACE LOCK

For any character with no existing canonical reference. Two stages, in order: text spec, then build.

## Stage 1, the text spec

Let the user describe the character in their own words. Listen, then mirror back a locked spec in plain language covering:

- **Apparent register**, described by build and bearing, never an age word or number
- **Face**, head shape, bone structure, jaw, chin, cheekbones, brow shape, eye shape and color, nose, lip shape
- **Skin**, tone and finish
- **Hair**, color with every nuance, length, texture, part, styling
- **Body**, build, proportions, posture
- **Default makeup register**, if any
- **Default expression and energy**
- **Identity markers**, piercings with position and metal, scars with placement and size, beauty marks, tattoos, signature jewelry

Iterate the text spec freely until the user says it's locked. **Nothing gets generated until they lock it.** Fixing a face in text costs nothing; fixing it after twelve outfits and a finished ad have been built on it costs everything.

**Model note, said once and then dropped.** Run the lock on Nano Banana Pro. If the user has a higher-fidelity model, use it, and keep the framing chest-up when you do, since anything wider spends its resolution on things that aren't the face. The tool changes; the grammar does not.

**Wardrobe lock for every face plate:** plain black thin-strap camisole for women, plain black ribbed tank for men. No jewelry, no logos, no graphics. Identity-pure, and it gives every downstream outfit build a clean neutral starting reference.

## Stage 2, the canonical 3:4 chest-up lock

**This is the most important image in the character's life.** Everything downstream anchors here. Write it long and write it specific. This is the one place prompt economy does not apply.

**Framing:** 3:4 vertical, forehead to upper chest, the face filling most of the frame. A true close-up headshot, not a portrait with air around it. Chest-up, never waist-up. The whole point is resolution on the face.

**Everything gets written out in full, in this order:**

1. **Framing declaration**, 3:4 chest-up, forehead to upper chest, face filling the frame
2. **Reference anchor**, "the same character as the attached face plate" (omit when building single-pass with no prior plate)
3. **Build and heritage**, one clause
4. **Skin**, tone, undertone, finish
5. **Head and face structure**, head shape, forehead, temples, cheekbone height and projection, cheek hollow, jaw angle and definition, chin shape and projection, the line from ear to chin
6. **Eyes**, shape, set, spacing, tilt at the outer corner, lid crease depth and visibility, iris color with its variation across the iris, limbal ring, pupil, the wet line at the inner corner, under-eye structure
7. **Brows**, shape, arch position, thickness, density, hair direction, color relative to the hair
8. **Lashes**, length, density, curl, separation, upper and lower
9. **Nose**, bridge width and straightness, tip shape and projection, nostril shape and visibility, the plane transitions
10. **Lips**, fullness upper versus lower, cupid's bow definition, philtrum length and depth, mouth width, corner shape, natural lip color and surface texture
11. **Ears**, shape and set, whether visible under the hair
12. **Hair**, color with every nuance and tonal variation root to tip, length, texture, part, how it falls, hairline shape, baby hairs
13. **Makeup register**, if any, as a default that swaps freely later
14. **Identity markers**, each with exact placement: piercings by position and metal, beauty marks by location, scars by placement and size, visible tattoos
15. **Wardrobe**, plain black camisole or ribbed tank, no jewelry, no logos
16. **Pose and expression**, squared to camera, head level, neutral relaxed, eyes to camera, lips closed
17. **The LOCKED FLAT CLOSE**, verbatim

```
A clean cinema-character-reference 3:4 headshot, framed from the forehead down to the upper chest with the face filling most of the frame, a true close-up, not a portrait with space around it.

[Build and heritage.] [Skin tone, undertone, and finish.] [Head and face structure: head shape, forehead, temples, cheekbone height and projection, cheek hollow, jaw angle, chin shape, the line from ear to chin.] [Eyes: shape, set, spacing, outer-corner tilt, lid crease, iris color and its variation across the iris, limbal ring, under-eye structure.] [Brows: shape, arch position, thickness, density, direction, color.] [Lashes: length, density, curl, separation, upper and lower.] [Nose: bridge, tip, nostrils.] [Lips: upper versus lower fullness, cupid's bow, philtrum, mouth width, corner shape, natural color and surface texture.] [Ears: shape, set, visibility under the hair.] [Hair: color with every nuance and tonal variation root to tip, length, texture, part, fall, hairline shape, baby hairs.] [Default makeup register, if any.] [Every identity marker with exact placement: piercings by position and metal, beauty marks by location, scars by placement and size, visible tattoos.]

[She wears a plain black thin-strap camisole / He wears a plain black ribbed tank], no jewelry, no logos, no graphics. Body squared to camera, head level, neutral relaxed expression, eyes directly to camera, lips closed and relaxed, subtle controlled energy.

[LOCKED FLAT CLOSE, verbatim]
```

The output is the canonical character reference. Every future prompt for this character attaches it.

**High-fidelity addition.** When the lock runs on a model with a stronger micro-detail read, insert one dedicated fidelity paragraph between the pose line and the flat close. High-detail models reward explicit micro-detail language in a way balanced models do not:

```
Extreme face fidelity. Real skin texture with visible individual pores, fine peach fuzz along the jawline and upper lip, subtle subsurface scattering across the nose bridge, cheeks, and ear edges reading as semi-translucent biology. Individual lash separation, upper and lower. Real moisture and reflection in the iris with a visible fibrous iris pattern radiating from the pupil and a soft limbal ring at the outer edge. Real lip surface texture with fine natural vertical lip lines. Hair rendered strand by strand at the hairline with visible baby hairs and individual flyaways. Visible fabric weave at the collar and shoulder. Micro-expression detail held in the eye corners and the mouth corners.
```

**Mode 0 is one-and-done per character.** Once the locked 3:4 headshot exists, every future prompt anchors to it.

**What Mode 0 is NOT for:** refining a character who already has a canonical reference (skip to Mode 1), outfit design (Mode 1; the black camisole is an identity baseline, not a styled look), or multi-angle sheets (Mode 2, and only after Mode 1).

---

# MODE 1, OUTFIT BASE

For a character with a locked face. Two steps: agree the outfit in text, then build it directly on the character.

## The default is direct, never gate it

**When the user uploads garment references and says put this on the character, that is the whole instruction. Build it directly, in one generation, on the locked character.** Do not route them through a neutral model first. Do not build the outfit on someone else and composite it. Do not propose a test pass. Uploaded references (product shots, runway stills, flat-lays, screenshots, material swatches) are already the outfit reference, and duplicating them onto a stand-in model costs a generation and a reconciliation step while adding nothing.

The direct build is the default for outfits described in text too. The intermediate path exists for one narrow case, below, and the user has to be better off for taking it.

## Step 1, the wardrobe proposal (text only)

Before any image, write the outfit out in plain text and wait for approval. Never combine a wardrobe proposal with an image prompt in the same message. This is a text step, not a generation step. It costs nothing and catches the misreads that would otherwise burn a generation.

Cover, head to toe:
- **Every garment**, color, fabric, weave or finish, cut, fit, neckline, sleeve, hem position, closures, how it sits on the body
- **Layering**, what goes over what, what's open, what's tucked, plus **structural detail**: cutouts, panels, boning, ruching, pleats, distressing, hardware
- **Branding on the garment**, named and described physically: the wordmark verbatim, its placement, scale, color and legibility
- **Footwear**, style, material, heel height and shape, how it interacts with the hem
- **Jewelry and accessories**, every piece, metal, scale, plus bags, belts, gloves, eyewear, headwear
- **Nails**, length, shape, finish
- **Hair and makeup for this outfit**, only where they differ from the character's default

Iterate on text until locked. Text iteration is free.

**End the proposal with any open decisions the references don't resolve**, which hand a single glove goes on, whether a back is fully open or strapped, exact counts of repeated elements. Ask them as a short numbered list rather than guessing.

## Step 2, build it

| Path | Use when |
|---|---|
| **A, direct on the character** (default) | Everything. Uploaded garment references, described outfits, layered looks, custom construction. This is the answer unless Path A has already failed. |
| **B, invisible mannequin garment plate** | Only after a direct build came back with a specific piece rounded off toward generic, and then only for that one piece. |

**Path B is a repair, not a starting point.** Never open with it, never propose it preemptively because an outfit looks complicated, and never build plates for pieces that already have a usable reference. Run Path A, look at what came back, and reach for a mannequin plate only for the garment that actually failed.

### Path A, DIRECT ON THE CHARACTER (default)

Build the outfit straight onto the locked character in one generation, **full body, tall vertical framing**. The character reference is attached alongside every garment reference; the prompt handles layering, fit, pose, and anything the references don't resolve. One generation instead of several, the fit reads on the character's actual proportions from the start, and there's no compositing step to degrade identity.

**With uploaded garment references, describe less.** Each attached reference already carries its garment's cut, construction, and hardware. The prompt's job is what the references can't say on their own: **layering order** (what sits over what), **how each piece sits on this body** (where a hem lands, how much skin shows between two pieces), **material overrides** where a reference shows the right construction in the wrong material, **which side or hand** an asymmetric piece goes on, and **anything cropped out of the reference frame**, a back a front-facing product shot never shows, a boot top a thigh crop cuts off.

State what each reference carries when several are attached, and say plainly when one is being used for construction only:

```
The character reference carries face, skin, hair, and build. Each garment reference carries that garment's cut and construction. The material reference carries the finish applied across every piece. The glove reference resolves cut and coverage only, its silver material is not used.
```

**Why tall vertical.** A full-body outfit reference needs the frame taller than wide: vertical gives the garment the pixel budget, so hem lengths, the break at the ankle, footwear and drape all read at usable resolution instead of getting squeezed into the middle of a square. Describe it as "a tall vertical frame with the full figure and the footwear entirely within the frame," never as a numerical ratio. **Default pose:** the cocked-hip model stance, weight on one hip, body angled 15 to 30 degrees from camera, chin level, eyes to camera. **Default expression:** model face-card neutral, subtle and controlled, a slight closed-lip smirk at most.

```
A full-body character reference of the same [woman / man] as the attached character reference, standing [pose], framed head to toe in a tall vertical frame with the full figure and the footwear entirely within the frame.

[What each attached reference carries, when more than one.]

[Identity restated briefly: build, skin, hair, face register. Two or three clauses only, the reference carries the rest.]

[The outfit head to toe: every garment with color, fabric, weave or finish, cut, fit, neckline, sleeve, hem position, closures, structural detail, how it sits and moves on the body, layering, footwear, jewelry, accessories, nails, and any branding written verbatim with its placement and scale. Lean on the references for construction and spend the words on layering, fit on this body, material overrides, and anything cropped out of a reference frame.]

[Pose and expression.]

[LOCKED FLAT CLOSE, verbatim, adjusted to full-body framing.]
```

### Path B, INVISIBLE MANNEQUIN GARMENT PLATE (repair only)

**Only reached after a direct build returned a specific garment rounded off toward generic, and only for that garment.** Every other piece stays as it came back. **Step 2B.1, build the failed piece on an invisible mannequin:** with no face and no body competing for attention, the entire prompt can be about the garment, which is what makes it hold construction a direct build lost.

```
A garment reference of a single [garment type] worn on an invisible body, floating in frame and holding its full three-dimensional worn shape.

[The garment in complete detail: color, fabric, weave or finish, cut, fit, collar or neckline construction, sleeve, hem, closures, seams, panels, hardware, pockets, print or pattern with its scale and layout, any branding written verbatim with placement and scale, lining if visible.]

There is no head, no neck, no hands, and no body anywhere in the frame. The garment reads as worn by an invisible figure with full volume, natural drape, and real fabric tension across the chest and shoulders, the collar and cuffs holding their own three-dimensional shape, every opening reading as an empty dark hollow looking down into the inside of the garment with the inner back of the fabric faintly visible. No stump, no skin, no cut edge, no anatomy, no mannequin form, no hanger, no stand, not blurred, not faded, no ghosting, no transparency.

[LOCKED FLAT CLOSE, verbatim]
```

**Step 2B.2, rebuild the look with the plate in the stack.** Attach the character reference, the new garment plate, and the references for the pieces that already worked.

```
A full-body character reference of the same [woman / man] as the character reference, wearing the garments from the attached references, framed head to toe in a tall vertical frame.

Keep every garment exactly as shown in its reference: the same color, the same fabric, the same cut and fit, the same collar and cuffs, the same hem position, the same closures, the same hardware, and the same print or pattern at the same scale. Keep the character's identity exactly as shown: the same face, the same bone structure, the same eye shape and color, the same skin tone, the same hair, and every identity marker in the same position.

[Layering: what goes over what, what is open or closed, what is tucked.] [Footwear, jewelry, and accessories not covered by a reference.] [Pose and expression.]

[LOCKED FLAT CLOSE, verbatim, adjusted to full-body framing.]
```

**Variation strategy when building several bases for the same character:** keep the flat gray field locked and vary one parameter per shot, pose, framing, or expression. Never vary face, skin, or core identity markers. Those stay locked.

---

# MODE 2, CHARACTER SHEET

Built only after an outfit base exists on the locked character and the user is happy with it. One image, one prompt.

**The 3-panel is the default.** When the user asks for "a character sheet" with no format named, build the 3-panel. Don't ask which, don't offer the 6-panel. **Why 3 beats 6:** the sheet is one image with a fixed pixel budget, and six cells splits that budget six ways, landing the face (the one thing the sheet exists to lock) in cells too small to hold real identity detail. Three cells give each panel roughly double the resolution, which is what makes the chest-up face panel usable as a downstream anchor for every shot of the ad.

**6-panel is legacy, explicit request only.** If the user names it, say this once, then proceed on their go-ahead and never re-litigate:

> Heads up, splitting into six panels cuts the pixel budget per cell, so the face panels hold noticeably less identity detail than the 3-panel's chest-up lock. Happy to run it if you want it.

## Which references to attach

**Default: the approved outfit base alone.** It already carries the face, hair, skin, build, wardrobe, and every accessory in one image, all agreeing with each other, so it needs no reconciliation. **Adding the canonical face lock alongside it is usually a downgrade:** two references means two sources for the same face, in different framing, a different crop, a different neutral wardrobe and a different hair state, and reconciling them costs attention that should go to panel geometry and the garment. On a multi-panel sheet that budget is already split, and overloading references is one of the most reliable ways to get a mushy sheet.

**Attach the face lock as a second reference only when:** identity has visibly drifted in the outfit base, the outfit base obscures the face, the face came out soft or low-detail, a previous sheet attempt returned a wrong face, or the user explicitly wants it re-anchored. When it is attached, say what each reference carries.

## 3-panel layout

1. **LEFT, full body front, headless.** Full headroom preserved: the head is *removed from the body*, not cropped by the frame edge. Isolates the garment, silhouette, and proportions with no facial data competing.
2. **CENTER, full body rear, head attached.** Hair fall, back construction, hem, and footwear readable from behind.
3. **RIGHT, tight chest-up face lock.** Just above the crown down to the collarbones. The face fills the panel. This is the identity anchor and it must be tight, chest-up, never waist-up. If the framing drifts wider the sheet loses its whole reason for existing.

## The headless cut, pick by garment

**Variant A, ghost mannequin.** For structured or closed necklines sitting at or above the collarbone: collars, crew necks, ribbed tanks, turtlenecks, hoods, jacket collars, keyholes. Anything with a real opening the eye expects a neck to come out of.

```
LEFT PANEL, full body front view, no head, no neck, and no hair. The body stands squared to camera from the shoulders down to [the shoes / the hem], arms relaxed at the sides, hands open and loose, weight even across both feet. There is no head, no neck, and no hair at all, nothing rises above the shoulder line, and no hair falls across the chest or shoulders. The [collar type] holds its own three-dimensional shape at the top of the garment and its opening is an empty dark hollow looking down into the inside of the garment, with the inner back of the fabric faintly visible inside the opening. The garment reads as worn by an invisible body, full volume, natural drape, real fabric tension across the chest and shoulders, but nothing emerging from the neckline. No stump, no skin, no cut edge, no anatomy, no blood, not blurred, not faded, no ghosting, no transparency in the body. The panel keeps full headroom, a generous empty field above the shoulders, so the figure sits at the same scale and position in the frame as a normal full-body portrait.
```

**Variant B, clean neck cut.** For garments with no neckline to hollow: strapless, halter, spaghetti strap, deep cowl, scooped or plunging.

```
LEFT PANEL, full body front view, headless. The full figure stands squared to camera from the shoulders down to [the shoes / the hem], arms relaxed at the sides, hands open and loose, weight even across both feet. There is no head and no hair, no hair falls across the chest or shoulders. The neck rises a short way from the shoulders and terminates in a clean, flat, sharply defined horizontal edge at the base of the throat, exactly like a headless dress-form mannequin, a crisp sculptural cut with a clean visible edge, not blurred, not faded, not dissolving, no wisps, no smoke, no ghosting, no transparency, no blood, no anatomy detail at the cut. Above that clean edge there is only empty field. The panel keeps full headroom so the figure sits at the same scale and position in the frame as a normal full-body portrait.
```

## 3-panel prompt structure

```
A three-panel character reference sheet composed as one horizontal frame, divided into three equal vertical panels side by side, thin clean separation between panels, the same figure and the same outfit rendered identically across all three. No text, no labels, no numbering anywhere in the image.

[If more than one reference is attached: what each reference carries.]

[Identity paragraph: build, skin, hair color and styling, makeup register, identity markers, nails. Described ONCE, applies to all three panels.]

[Wardrobe paragraph: full outfit head to toe, every garment, fabric, color, construction detail, footwear, jewelry, any branding verbatim with placement. Described ONCE, applies to all three panels.]

[LEFT PANEL, Variant A or B locked language, per the garment.]

CENTER PANEL, full body rear, head attached. The complete figure from above the crown down to [the shoes / the hem], seen directly from behind, standing squared away from camera, weight even, arms relaxed at the sides. [Hair fall, back construction, hem, and footwear as they read from behind.]

RIGHT PANEL, tight chest-up face lock. Framed from just above the crown down to the collarbones with the face filling the panel, squared to camera, head level, eyes directly to camera, neutral model face-card expression, lips closed and relaxed. [What enters at the bottom of frame.] Every facial plane, the full eye construction, brow, nose, lip shape, and hairline read at maximum detail.

Skin renders at its true natural skin tone, identical in value and hue across the face, arms, hands, back, and body in every panel, never darkened, never tanned, never pale or washed-out or cool-shifted.

[LOCKED FLAT CLOSE, verbatim, with the flatness stated as applying uniformly across all three panels.]
```

## 6-panel layout (legacy)

3x2 grid, single frame. Default panels: full body front; left side profile close headshot; full body back; right side profile close headshot; front face close headshot; one detail close-up (nails, a key jewelry piece, a piercing, a tattoo, or a held prop, the user picks at the pre-prompt check).

Swap panels by name if the user wants a different mix, but keep the 3x2 grid and the single-prompt format. Every panel carries its explicit position label so the grid composes correctly, and flatness is stated as uniform across all six.

## Critical rules for both formats

- One prompt, one code block, one image. Never separate prompts per panel.
- Identity and wardrobe described **once** in opening paragraphs, applying to every panel.
- Each panel describes only what differs: angle, framing, head state.
- **Skin-tone consistency clause is mandatory.** Rear panels drift darker without it.
- Backdrop and lighting stated explicitly as uniform across every panel.
- Every panel carries its position label.
- No text, labels, or numbering rendered inside the image.

---

# MODE 3, SCENE PLATE

**When to use:** when the user asks for a scene, an environment, a plate, a moment or a setting, and as stage four of the core pipeline. The default output is a **pure environment plate**: the location with no character in it, weather, light, atmosphere, set dressing. It is the "where," and it is the cleanest feed for the ad.


**Mode 3 flow, run it in this order:**

1. **The user describes the setting.** Read it, understand the location, palette, and light.
2. **Propose the plate and surface the cinema mode, BEFORE writing the prompt.** Once you understand the scene you already have a sense of the right register. Present it as a smart default the user can override. Reply with a one-line read of the proposed environment, then the cinema-mode choice as a table (your default named, all five listed, an invitation to override), then the aspect question. Keep it professional. Format:

   > **Proposed plate:** [one-line read, location, palette, light register].
   >
   > **Atmosphere, cinema mode.** For this setting I'd shoot **M1, Narrative** (grounded, natural daylight). Want a different register?
   >
   > | Mode | Atmosphere |
   > |---|---|
   > | M1, Narrative | Real-world, lived-in, natural light |
   > | M2, Studio / Editorial | Clean set, fashion-film, crafted look |
   > | M3, Action | Chase / combat energy, handheld, slow-mo beats |
   > | M4, Performance | Stage / concert / stadium energy |
   > | M5, Atmospheric | Moody, empty, weather, establishing |
   >
   > Go with **M1**, or name another. And which aspect is the ad, **16:9 or 9:16**?

3. **On the user's pick** (or "go with the default"), write the plate prompt in the chosen mode, with the settings table below it.

The mode is chosen *with the user here in chat*, but in the prompt body it only ever appears woven into the closing camera prose, never as a literal label on its own line.

**Goal:** a single still that captures the world and the camera grammar, as if a cinematographer locked off and grabbed a photo on the same camera package mid-take. **Camera grammar, five cinema modes paired to scene type:**

| If the scene is... | Cinema mode |
|---|---|
| Real-world dramatic (street, kitchen, car, bar, interior, exterior location) | M1, Narrative |
| Studio / editorial / void / clean set / fashion film | M2, Studio / Editorial |
| Action / combat / chase / high-energy physical | M3, Action / Combat |
| Performance / concert / stage / pit | M4, Performance / Concert |
| Atmospheric / empty / no-humans / weather plate | M5, Atmospheric / Empty |

This table is the internal scene-to-mode mapping. **Never pick the mode silently.** The cinema mode carries lens character, filtration look, film-stock rendition, grain, grade and color cast, all described as the visual *look*, never as brand names or model numbers the tools don't recognise.

### The silent 6-bucket checklist (pre-composition only)

Before writing, run this silently to make sure the composition is complete. The buckets are NEVER written as labeled blocks in the prompt. They get woven into continuous cinema prose. This is a thinking tool, not an output structure.

**1, Shot DNA.** Camera position, what the camera is looking at, the framing register, the mood. The spine of the shot.
**2, Subject behavior and spatial placement.** What the subject is doing, where they sit in the frame (as positional prose, not coordinates), direction of motion or gaze.
**3, Visible detail (resolution-aware).** Only the details a real camera at this distance, lens, and motion register would resolve.
**4, World.** Environment as ambience, not architecture. The space's register matters more than counting structural elements.
**5, Light and atmosphere.** What the light is doing, where the haze is, where shadows fall, color temperature, key against fill against rim.
**6, Camera spec and finish.** The full cinema stack as continuous prose, ending with the closing realism clause.

### RESOLUTION-AWARE DETAIL RULE (LOCKED)

**Describe what the camera at this position can physically see, not what's "true" about the subject.** Before writing any visual detail, run three diagnostics:

1. **At this distance, would a real cinema lens resolve this detail?** If no, drop it.
2. **At this motion blur level, would this detail read?** If no, drop it.
3. **At this lighting register, would this detail be visible?** If no, drop it.

**What this kills:** a car shot from 200 feet up at 120 mph at dawn has no resolvable decals, windshield text, badge logos or wheel spokes, so it reads as silhouette, color blocks, headlights and motion blur trails. A person crossing a wide plate at 50 yards has no resolvable expression, jewelry or fabric weave, so they read as silhouette, hair color, wardrobe color blocks and posture. A character in a moody night scene lit by one practical has no visible pore detail, peach fuzz or micro-expression, so they read as face shape, eye glints and the wardrobe pieces catching light.

**What this preserves:** the same car in a tight static shot at 20 feet has readable decals, readable windshield text and a legible badge. The same person in a medium two-shot at 8 feet has a readable expression, visible jewelry and clear wardrobe detail. Describe those.

**This rule governs packaging text harder than anything else.** A pack on a counter in a wide establishing shot does not have a legible ingredient panel, and writing one in produces a smeared hallucination of type. Either move the camera in or describe the label as a color block with the wordmark reading at its actual size. **Detail is earned by camera proximity, lens length, motion stillness, and lighting intensity. The skill respects this physics.**

### X/Y COORDINATE SYSTEM (INTERNAL COMPOSITION TOOL, NEVER OUTPUT NOTATION)

**The X/Y system is the skill's internal composition tool. It is NEVER written into the prompt body.** Use it silently to plan rule-of-thirds placement, motion direction, lead room and landmark anchoring, then translate into positional prose.

**Frame grid:** X axis, 0% left edge, 50% center, 100% right edge. Y axis, 0% top edge, 50% center, 100% bottom edge. Internal notation is always a bounding-box range (`X: 30 to 55% / Y: 55 to 85%`), never a single point.

**Standard placement library (internal):** hero subject on the left third `X: 28 to 38% / Y: 25 to 95%` or the right third `X: 62 to 72%`. Two-shot facing each other, A at `X: 15 to 40%` and B at `X: 60 to 85%`. Wide environmental with the hero on the lower-right third `X: 60 to 75% / Y: 55 to 80%`. Close-up with the eye line on the upper third, eyes at `Y: 33%`. Horizon on the upper third `Y: 33%` or the lower third `Y: 67%`. Vehicle in motion at `X: 30 to 55%` pointing toward `X: 100%`, lead room ahead of it and never trail room. Hero product in a scene at `X: 55 to 75% / Y: 45 to 75%` with its hero face turned toward the lens, never dead center unless the composition is deliberately symmetrical.

**Translation table, coordinates to prose:**

| Internal notation | Prose written into the prompt |
|---|---|
| `X: 38 to 62% / Y: 12 to 95%` | "centered in the frame" |
| `X: 18 to 55% / Y: 8 to 95%` | "filling the foreground left" |
| `X: 30 to 55% / Y: 55 to 85%` | "anchored to the lower-left third" |
| horizon at `Y: 33%` | "the horizon line sitting at the upper third" |
| second subject at `X: 60 to 85%` | "in the deeper right background" |

### THE CINEMA-PROSE REGISTER (LOCKED, NON-NEGOTIABLE)

**Scene prompts are written like a DP describing a real frame, not like a spec sheet.** The bucket logic still applies, but it dissolves INTO the prose. No labeled headers, no coordinate notation in the body, no CRITICAL LIGHTING RULES blocks, no explicit negations, no architectural enumeration of room geometry.

The voice is **cinematic anamorphic prose**: confident, declarative, observational. The kind of language that appears in a treatment, a shot list narration, or a hero-still caption. Like a real photograph being described, not a frame being engineered.

**Why this register works:** the model responds to confident scene description, not coordinate grids. References carry the heavy lifting on geometry, palette and continuity, and the prompt narrates the moment on top. Over-specification creates conflicting instructions. Spatial logic survives by being written positionally instead of numerically.

**The five-paragraph structure (LOCKED).** Paragraphs are not labeled in the output. They flow as continuous prose.

**Paragraph 1, opening shot description.** One long sentence establishing the medium ("a cinematic anamorphic still photograph"), the framing register, the subject or location at high level, the camera position and angle in prose, and the mood. This is the spine. Everything else hangs from it.

**Paragraph 2, character block.** The character in confident observational prose, identity pulled from the attached reference and written as visible fact in the frame, with pose, attention and held props woven in naturally. **On a pure environment plate this paragraph is dropped** and the frame's foreground element takes its place.

**Paragraph 3, world block.** The location as ambience and atmosphere, not architecture, anchored to the attached reference ("carrying identically from the attached world reference"). Background elements get positional language, not coordinates.

**Paragraph 4, subject anchor block.** Whatever the focal anchor of the shot is, a screen playing across the room, a car in the deep background, the dawn on the horizon, the product on the counter, gets its own paragraph. This is where any specific content, signage, graphics or on-pack text is described, at whatever legibility the camera distance actually earns. If the shot has no focal anchor, this folds into paragraph 3.

**Paragraph 5, camera spec and finish.** The full cinema look in one continuous descriptive paragraph: capture register, lens character, diffusion and filtration look, film-stock rendition, grain, grade, color cast, optical character, all in plain-language look terms, never brand or model names, closing with the realism clause. **The closing realism clause is mandatory.** The list of "no X, no Y, no Z" at the very end is load-bearing: it tells the model what not to lean toward, and it does so AFTER all the positive description, where the model handles it as a quality filter rather than a conflicting instruction.

### Key writing rules for the prose register

1. **No labeled blocks in output.** The structure is invisible. It lives in the writing order.
2. **No coordinate notation in the body.** Positional prose only.
3. **No CRITICAL / IMPORTANT / MUST rules.** Replace with descriptive prose about what IS happening: "the cool broadcast wash catching only the immediate floor patch around his feet and a soft cool rim on his shoulders."
4. **No explicit negations as instructions.** Write what IS there: "the sleeves cut off cleanly at the shoulder seam with raw unfinished armholes." The closing realism clause is the ONLY place negations appear, and only as quality filters.
5. **References do the geometry work.** With a world plate attached, write "carrying identically from the attached world reference" instead of re-enumerating the room.
6. **References do the identity work.** With a character sheet attached, write "carrying identically from the attached character reference" instead of re-describing the face.
7. **The prompt narrates THE MOMENT.** What is the light doing right now, what is the camera doing right now, what is the subject doing right now. Continuity is reference work.
8. **Brand and on-pack text are written verbatim** wherever the camera can resolve them, with their physical description alongside. This is the one kind of specificity that never gets economised away.
9. **The cinema mode is invoked by describing the look in plain language** in the final paragraph, with the M-tag as a brief identifier woven into the prose, never as a standalone label.
10. **No aspect ratios in the prompt body.** The aspect goes in the settings table.

### Canonical scene plate, reference example

This is the locked register. Every scene prompt is written in this voice.

```
A cinematic anamorphic still photograph captured handheld on a real cinema set, a low-angle medium composition of an empty rooftop at dusk, the camera positioned slightly below the level of the parapet in a wide framing anchored to the left third of the frame, the deepening dusk sky filling the upper two-thirds of the frame, the city skyline reading in soft silhouette across the lower third of the background, the composition holding a quiet observational stillness.

The rooftop is the location carrying from the attached environment plate: weathered concrete edge, rusted railing in the foreground softened by shallow depth of field, a service door standing half open in the deeper background camera-left, the city skyline beyond reading as silhouette layers stacked into atmospheric haze, distant building lights coming on one by one as dusk falls. Light atmospheric haze suspended through the deeper space gives the air real physical body, the horizon glow warm magenta-orange transitioning into deep blue overhead. Practical warm light from a stairwell bulb off-frame at camera-right catches the near edge of the parapet and the top rail with restrained natural rim, the cool ambient dusk light wrapping faintly around everything it doesn't reach.

The city skyline reads as the visual anchor of the deeper frame, building silhouettes layered front-to-back with progressive atmospheric desaturation, the warm horizon glow visible between the structures, scattered building lights warm and small in the deep distance, a faint aircraft beacon blinking once at the upper-right edge of the frame, the rest of the sky held in deep cool blue with the first stars just visible at the upper edge.

Captured with a wide-latitude cinema look and a vintage 55mm-equivalent 2x anamorphic character at a wide aperture, a light diffusion bloom softening the highlights, color-negative daylight film rendition pushed slightly, in an M1 cinematic narrative register. Real anamorphic optical character with oval bokeh on the deeper city elements, organic handheld operator breath, subtle frame-edge falloff, a faint horizontal streak flare on the brightest horizon highlight. Theatrical fine 35mm film grain across the entire frame: concrete, sky, haze, rust. Contemporary teal-amber cinema grade with the warm horizon glow meeting the cool dusk wash, shadows lifted gently into deep cool blue-grey never crushed, highlights rolled off softly never blown. Real photographic frame captured on a real cinema camera, real anamorphic lens, real concrete and haze, no CGI, no rendered look, no digital cleanliness, no plastic surfaces, no AI smoothness, no skin smoothing, no glow, no halation bloom that reads as artificial, no glossy highlights.
```

---

# MODE 4, THE PRODUCT

**This mode does not generate anything. It reads.**

The user uploads a photo of their product. **That photo IS the lock.** It carries silhouette, proportion, material, finish, colour, closure and the full on-pack layout better than any prompt could describe them, and better than any plate generated from it. There is nothing to build here. A product arrives with its own reference, which is exactly what makes it different from a face: a face has no reference until Mode 0 makes one.

**Never generate a product plate. Never write a product image prompt. Never ask for a flat-lay, a studio shot, a multi-angle set, a photoshoot, or a cleaned-up version.** The user's product photo goes forward untouched, attached as a reference to every shot in `/ad-director` that features the product.

## What this mode actually does

**Read the pack and mirror it back.** One text step, no image. The reason is downstream: `/ad-director` has to write every piece of on-pack text verbatim into the shot prompts, because naming the thing renders the thing and a paraphrase renders a vague approximation. So the words have to be captured accurately here, once, in text.

Read off the supplied photo and confirm back in plain language:

- **The object.** What it is, its size, and its scale against a hand or a body. Scale is the component that fails in video: without an anchor the model renders a plausible object at the wrong size and the shot dies in the edit.
- **Every piece of on-pack text, verbatim.** Exactly as printed, in order, with its typography, colour and placement.
- **Anything the photo does not show.** A back panel, a base, a cap underside. Name what is missing rather than filling it in.

Then ask one question: **"Is that right?"**

**Never guess a word of packaging copy.** If the photo crops a line of type or the resolution smears it, ask. An invented ingredient panel renders as canon and is wrong on every shot after it.

**Optionally**, if the ad will cut to the back of the pack, the user can supply one image showing the front and the back side together, for higher consistency. If they do not and the ad needs a back, ask for it rather than inventing one.

## Delivery

No code block, no settings table. This stage produces a confirmed product spec in plain text and the user's own photo carried forward. Then the kit is complete and the bridge card ships.

## UNIVERSAL PROMPT RULES

1. **No character names in prompt output.** Describe by hair, wardrobe, and identity markers. The tools don't know names; visual descriptors survive across prompts.
2. **Brand names, on-pack text and graphics ARE written, verbatim,** with their physical description alongside: shape, color, placement, legibility. Naming the thing renders the thing. This does not extend to camera, lens or film-stock names, and never to platform or tool names.
3. **No aspect ratios in prompt output.** Never write "3:4 vertical," "16:9 horizontal," "4:5 portrait," or any ratio inside the prompt body. The ratio lives in the settings table. The prompt describes framing in words: "chest-up headshot," "full body in a tall vertical frame," "wide establishing shot."
4. **No `@image` tags, no `<<<image_n>>>` placeholders, no bracketed slot syntax.** Attachment happens in your generator. Every prompt refers to references in prose: "the attached face plate," "the character reference," "the first reference," "the attached product reference." This holds in every mode without exception, including the swap.
5. **No internal production context and no meta-commentary.** Every prompt is standalone and self-contained: no "matching the previous shot," no project references, no explanation of intent, no references to the medium. Pure visual description only.
6. **Age-blind.** Describe by build, bearing, role, and wardrobe, never by age word or number.
7. **No teeth-showing smiles** unless explicitly requested. Default is model face-card neutral, or a slight closed-lip smirk.
8. **No negative prompt blocks.** Negations live inline in the prose where they belong.
9. **Flat grade on every plate and sheet, no exceptions.** Directional lighting has no place in a reference. Scene work is the opposite: full cinema stack, always.
10. **Single fenced code block on output**, with the numbered reference list above it and the settings table below it.

---

## PRE-DELIVERY PASS

- [ ] Which mode applies, and the prerequisite for that mode exists
- [ ] The ON LOAD map was shown before the first question
- [ ] For a new character: text spec locked and approved before any generation
- [ ] For a new product: product spec locked and approved before any generation, and every unresolved question asked rather than guessed
- [ ] The lock pass is 3:4 chest-up with the face filling the frame, never waist-up
- [ ] Every facial plane, the eyes in full, and every identity marker with exact placement written into the face lock
- [ ] Every word on the pack read off the photo and confirmed back verbatim, with typography, color and placement
- [ ] Product changes carry the product hold clause, and trigger a re-lock if the pack reads differently at rest
- [ ] Outfits went through the text proposal, then a direct build on the locked character, no stand-in model, no preemptive garment plates
- [ ] Sheets have identity or product described once, the correct headless variant, and the consistency clause
- [ ] Reference economy: the fewest images that carry what the prompt needs, each one's role stated when more than one is attached, and any material override stated explicitly
- [ ] Prompt economy: nothing re-describes what a reference already shows, except the face lock and on-pack text
- [ ] On plates: Axis 1 on, Axis 2 off. Flat field, shadowless light, zero shadow outside the subject, zero light bleed, stated per panel on sheets
- [ ] On scene work: cinema-prose register, five paragraphs, positional prose not coordinates, resolution-aware detail, closing realism clause
- [ ] Cinema mode surfaced to the user as a menu, never picked silently
- [ ] No names, no aspect ratios, no placeholder tags, no platform names, no meta-commentary
- [ ] Bolded title, numbered reference list, one code block, settings table below
- [ ] The inter-stage line was said, and the bridge card was delivered if the kit is complete

---

## REPAIR PASS

| Symptom | Fix |
|---|---|
| Face drifting between outfits | The lock plate isn't tight enough. Rebuild it chest-up with fuller facial description |
| Outfit rendering generic or rounded off | Fall back to an invisible-mannequin plate for the piece that failed, and only that piece |
| Rear panel skin darker than front | The skin-tone consistency clause is missing |
| Shadow under the feet or behind the shoulder | The zero-shadow-outside-the-subject clause is missing or too short |
| Background brightening near the figure, or reading as a lit wall or floor | The zero-light-bleed clause or the "color field, not a photographed backdrop" line is missing |
| Modelling appearing on the face | One of the five flat requirements is missing |
| Grain, vignette, or background blur on a plate | Capture-behavior language leaked in from Axis 2 |
| Hair color change also changed the face | The hold clause is missing or too short |
| Identity marker in the wrong place | It was described relative to nothing. Anchor it to a fixed anatomical landmark |
| Sheet coming back mushy or averaged | Too many references disagreeing. Drop back to the single approved render |
| Face on a sheet drifting off canon | This is the case where the face lock earns its slot. Attach it and state what each reference carries |
| Garment rendering in the reference's material instead of the specified one | The material override line is missing |
| Wordmark misspelled, letters dropped, or type substituted | The text wasn't written verbatim in the prompt, or it was written once and not repeated per panel |
| Label drifting position or size between shots | The product hold clause is missing |
| Product reading dead, flat and plastic | The material paragraph got matte-killed. Restore the commercial-register specular for that material |
| A hard highlight streak or a reflected softbox on the pack | The specular went from material-descriptive to source-descriptive. Cut the source shape, keep the material |
| Label legible in a wide shot and smeared | Resolution-aware rule violated. Move the camera in or drop the type to a color block |
| Scene plate reading like a video game | Atmospheric perspective is missing from the closing paragraph |
| Output reading soft or over-described | Prompt economy failure. Cut everything the references already carry |
