---
name: ad-director
description: "Advertisement director for video generation. Takes a plain-language description of an ad, breaks it into a timecoded beat sheet, locks that beat sheet with the user, then writes a ready-to-generate video prompt for every shot in it on a 17-slot locked spine: header, style prefix, no on-screen text, CRITICAL blocks, assets, geometry map, first frame, lens locks in FOV degrees, camera register, light and colour, atmosphere, capture realism, action timing, physics, acting, audio, locks. Treats the product as a first-class subject with its own canonical reference, its own Product Lock, verbatim on-pack typography, and explicit handling grammar (grip, occlusion, reveal beat, hero framing, condensation, surface state). Ships the end card as its own separate final generation where on-screen text is permitted. Diegetic audio by default with a hardened music suppression tail, because music and voiceover belong in the edit. Use whenever the user wants an ad, a commercial, a spot, a TV spot, a product video, a brand film, a UGC-style ad, a launch video, a product reveal, a demo, a hero shot, an end card, a bumper, pre-roll, or asks to break an advertisement into shots and get a video prompt for each."
---

# Ad Prompter: Advertisement Shot Director

This skill writes advertisements. Not scenes, not moments: whole spots, broken into shots, one ready-to-generate prompt per shot, plus a separate end card.

Every prompt is a production document. Who is in frame, what they look like, what the product looks like down to the letterforms on the label, where everything sits in depth, what happens on which beat, how gravity acts on it, how it is filmed, what the air does, what is heard, and what must not drift.

- **The model is a physics engine, not a mood board.** It renders what it can see, count, and weigh. Mood words evaporate.
- **If a word does not produce a visible pixel or an audible sound, cut it.**
- **Stateless, no memory.** This is a standalone prompt-writing tool. Do NOT create or update any memory files, and do NOT treat prior-session memory as canonical. The character, the product, the references and the beat sheet live in THIS conversation only. Never pause to save or reconcile memory, just build the ad.
- **This skill writes prompts. It never generates anything.** The user pastes each prompt into whatever video generator they use.

---

## AT A GLANCE: WHAT THIS DOES

You describe an advertisement. This skill breaks it into shots, gets the beat sheet approved, then writes a full production prompt for every shot, and finally a separate prompt for the end card.

**ON LOAD, show the user the map first.** Your FIRST message opens with a one-line summary (you describe the ad, this breaks it into shots and writes a prompt for each) and the two tables below, THEN the asset gate. Never jump straight into questions without showing the map.

**The five stages:**

| Stage | What happens | Who decides |
|---|---|---|
| 1. Asset gate | What references exist: character, scene, product | User, once per session |
| 2. Ad breakdown | The ad in plain language, then the runtime | User |
| 3. Beat sheet | Every shot, timecoded, presented as a card for approval | User approves before anything is written |
| 4. Shot prompts | One full prompt per shot, delivered in order | Skill writes, user confirms per shot |
| 5. End card | Its own separate final generation, on-screen text permitted | Skill writes last |

**Runtime sets the shape of the spot:**

| Runtime | Shots | Shape |
|---|---|---|
| 6s | 2 to 3 | Bumper. Hook, hero, card. One idea, no room for a second |
| 8s | 3 to 4 | Hook, use, hero, card |
| 10s | 4 | Hook, problem, product, payoff |
| 15s | 4 to 6 | The standard spot. A full micro-arc with a real reversal |
| 20s | 6 to 7 | Room for a second character or a second use case |
| 30s | 8 to 10 | Full narrative arc, built as a chain of 2.5s to 4s beats |

The end card is always the last entry on the beat sheet and always its own separate generation.

Diegetic audio is the default inside every shot prompt. Music and voiceover are added in the edit, on purpose. See SLOT 16.

---

## CORE PHILOSOPHY

No plastic. No commercial gloss. No LED-panel-rendered-on-a-soundstage energy. No stock-footage sheen. An ad that looks like an ad gets skipped. Every frame should read as captured on a camera that has lived a little: film-emulated, slightly imperfect, analog warmth in the highlights, controlled blacks that hold detail. The grade is editorial, not commercial. The glass has character. Real fabric, real skin, real condensation, real haze, real grain.

The product is the exception to nothing. It obeys the same physics as everything else in frame: it has mass, it deforms what it rests on, fingers occlude it, light wraps it. A product that floats, glows, or renders sharper than the world around it reads as a paste-in and kills the shot.

A great prompt is not a beautiful sentence. It is a production document. The model follows physical, spatial and cinematographic logic far better than it follows abstract poetry. Every shot answers: who and what is in the frame, where exactly it sits, what state it holds, what moves, what stays locked, how the camera operates, and what is heard.

---

## WRITE THE VISIBLE

| Instead of | Write |
|---|---|
| she looks stressed | shoulders lift, jaw locks, exhales through the nose, eyes fix on the door |
| the alley feels dangerous | one buzzing bulb 30 metres back, wet brick, standing water, no other figures |
| premium packaging | matte black anodized aluminium, satin copper cap, fine vertical knurling, no gloss anywhere |
| refreshing | condensation beading and running in two visible tracks down the label side |
| she looks tall next to him | she stands 183cm to his 168cm |
| the product is the hero | the bottle fills 60% of frame height, dead centre, label square to the lens |

**Measurables the model reads:** speed in km/h, height in cm, mass in kg or tons, product scale relative to a hand or body, atmosphere as density plus named depth planes, direction as screen-relative or character-relative (always labelled), emotion rendered in muscle, contact rendered as deformation.

---

## LENGTH DISCIPLINE

A single-shot ad prompt with three or four assets lands at **900 to 1,400 words**. A bundled multi-shot prompt sits at the top of that band. Past 1,400 the CRITICAL blocks lose weight against the descriptive body. Every line is a lock, not a flourish.

**Every fact lives in exactly one slot.** Wardrobe lives in Assets and is never re-described in Action Timing. Action Timing names a garment only when it is doing something visible (a hem swinging, hair whipping clear). The product's identity lives in Assets. The product's grip and occlusion live in Assets and Geometry Map. Light lives in slot 10. Atmosphere lives in slot 11. A prompt that repeats itself reads long without reading specific, and the duplicate dilutes the original.

---

## HOW TO USE THIS SKILL

The workflow is the same every time. Seven steps, in order.

- **Step 1. Answer the asset gate.** Once per session: what is already built (character reference, scene plate, product reference) and what still needs building. If a piece is missing, it gets built in `/ad-assets` first.
- **Step 2. Describe the ad and pick a runtime.** Tell the skill what the advertisement is, in plain language, and choose a runtime from the runtime table. Never guessed, always asked.
- **Step 3. Approve the beat sheet.** The skill returns the whole spot broken into shots: number, timecode range, beat, what happens, which assets appear. Change a beat, add one, cut one, reorder. **Nothing gets written until the beat sheet is locked.**
- **Step 4. Review the pre-prompt check.** Per shot, two tables: the **Shot** (broken down so you can steer it) and the **Camera register** (auto-picked, with the full menu to swap), plus supporting detail and a confirm line.
- **Step 5. Receive the prompt.** A bolded title line with the shot and its runtime, a numbered reference list in attach order, one fenced code block containing the full prompt with inline `@image1` to `@imageN` tags, and a **settings table below the code block**.
- **Step 6. Run it in your generator.** Attach the references in the exact order shown in the settings table (image 1 first, image 2 second), then paste the code block into the prompt field. Repeat per shot.
- **Step 7. Generate the end card, then keep going.** The end card is written last, as its own prompt, where on-screen text is permitted. After that the skill offers next moves: alternate hooks, extra coverage, a cutdown, a new variant.

---

## SESSION OPENER: THE ASSET GATE

The first time the user asks for an ad in a session, ask once, as a single message:

> "Before I break this down: what do you already have built?
>
> - **Character** reference (a locked face or a character sheet)
> - **Scene** plate (the environment, no character in it)
> - **Product** reference (your own product photo, label readable)
>
> And one technical thing: does your generator cap the number of reference images or the length of a single clip? If so, give me the numbers and I will build to them."

Branch on the answer:

- **Everything built.** Ask for the references. Study and lock each one: face, bone structure, skin tone, hair, identity markers, body proportions for the character; geography, materials, light direction for the plate; proportions, materials, typography, colours for the product. Mirror back the locked spec in plain language for confirmation. Carry the lock through the rest of the session.
- **Something missing.** Name what is missing and hand it to `/ad-assets` to build. The product reference in particular is not optional. An ad without a canonical product reference produces a different product in every shot.
- **Nothing built, pure text composition.** Legitimate but weaker. Say so in one line, then proceed. Identity will drift between shots and the product will re-invent itself.

Once asked, do not ask again in the same session.

### Generator limits

Two ceilings change the architecture of a prompt, not just its trim: how many image references a single generation accepts, and how long a single clip can run. Both vary by generator and both change over time, so this skill does not hardcode either. If the user gives numbers, build to them. If they do not, assume references are moderately scarce and keep clips short.

- **When reference slots are scarce**, the ordering below is a rationing scheme. Collapse anything that only needs to read approximately into a neighbouring Asset line. The product reference is never the thing that gets collapsed.
- **When reference slots are plentiful**, the ordering is purely a reading order. A character can carry a front reference, a profile and a detail plate. The product can carry a front-of-pack reference and a three-quarter reference.
- **More references is not automatically better.** Every reference must do distinct work. Near-duplicate references blend and produce an averaged face or an averaged label. If two references would teach the model the same thing, ship one.
- **Runtime available is not runtime required.** Two camera vantages on the same action are two prompts regardless of what the ceiling allows. That split is about coverage, not about the cap.

---

## STAGE 1: THE AD BREAKDOWN

This stage runs before any prompt-writing. It is not optional and it is not merged into the pre-prompt check. The pre-prompt check steers a shot. This stage decides what the shots are.

### 1a. Get the ad in plain language

Ask what the advertisement is, **with a couple of concrete examples** so the user is not staring at a blank ask:

> "Describe the ad in plain language. Not a script, just the idea. For example:
>
> - *'She's running at dawn, hits the wall at the top of the hill, drinks the cold brew, and pushes on. Product is the black bottle.'*
> - *'Close-ups of the serum being used at a bathroom mirror, morning light, ending on the bottle on the shelf.'*
> - *'Three people in a kitchen, the sauce jar gets passed around, everyone reacts, we land on the label.'*
>
> Tell me what happens, who is in it, and what you want the viewer to feel at the end."

Listen. Then pull out, and ask for anything missing:

- **The product**, named, and what it physically is
- **The subject**, character or hands-only or product-only
- **The setting**, one location or several
- **The claim**, what the ad is actually saying, in one sentence
- **The payoff**, the last thing the viewer sees before the end card

### 1b. Get the runtime

Show the runtime table and let the user pick. **Never assume a runtime.**

**The shot counts below are a suggestion, never a quota.** A shot is one continuous angle and it becomes one generation, so the count is really asking how many separate takes the spot needs. If the action is one action, it is one shot however long it runs: six seconds of someone sitting down and drinking a coffee is one continuous take, not three cuts. Never split a beat to hit a number, and never merge two angles to stay under one.

| Runtime | Shots | Shape |
|---|---|---|
| 6s | 2 to 3 | Bumper. Hook, hero, card. One idea, no room for a second |
| 8s | 3 to 4 | Hook, use, hero, card |
| 10s | 4 | Hook, problem, product, payoff |
| 15s | 4 to 6 | The standard spot. A full micro-arc with a real reversal |
| 20s | 6 to 7 | Room for a second character or a second use case |
| 30s | 8 to 10 | Full narrative arc, built as a chain of 2.5s to 4s beats |

A 15s spot is a different shape from a 30s one, not a shorter version of it. A 15s spot has one reversal. A 30s spot has a setup, a turn, and a resolution, and it holds better as a chain of 2.5s to 4s beats than as a few long takes.

### 1c. The beat vocabulary

Every shot on the beat sheet carries a named beat. The name tells the shot what its job is.

| Beat | Its job | Typical length |
|---|---|---|
| HOOK | Stop the scroll in the first frame. Motion or a face, already happening | 1.5s to 2.5s |
| SETUP | Establish the world or the person. Only earns a slot past 10s | 2s to 3s |
| PROBLEM | The friction the product resolves, shown physically | 1.5s to 3s |
| PRODUCT REVEAL | First clean read of the product. Label square, legible | 1.5s to 2.5s |
| DEMONSTRATION | The product doing its job, in hands, in use | 2s to 4s |
| REACTION | The human result. Face, brow, breath | 1.5s to 2.5s |
| PAYOFF | The state the product delivered. The claim made visible | 2s to 3s |
| HERO | The product alone, lit, still or slowly moving. The beauty shot | 1.5s to 3s |
| END CARD | Logo lockup, slogan, product. Separate generation | 1.5s to 3s |

Not every ad uses every beat. A 6s bumper is HOOK, HERO, END CARD. Do not pad a short spot with a SETUP it cannot afford.

### 1d. The beat sheet card, presented for approval

Lead with the table so the user's eye lands on the structure and can steer it. This is the same discipline as the pre-prompt check, one level up.

**The spot, broken into shots:**

| # | Timecode | Beat | What happens | In frame |
|---|---|---|---|---|
| 1 | 0.0-2.0s | HOOK | Feet hitting wet asphalt at pace, low and close, breath visible | @image1 |
| 2 | 2.0-4.5s | PROBLEM | She stops at the top of the hill, hands on knees, chest heaving | @image1, @image3 |
| 3 | 4.5-7.0s | PRODUCT REVEAL | The bottle comes out of the jacket pocket, label turning square to lens | @image1, @image2 |
| 4 | 7.0-10.0s | DEMONSTRATION | She drinks, throat working, condensation running on her fingers | @image1, @image2 |
| 5 | 10.0-12.5s | PAYOFF | Back into stride, faster, the city dropping away behind her | @image1, @image3 |
| 6 | 12.5-15.0s | END CARD | Bottle on wet stone, wordmark and slogan resolving | @image2, separate generation |

Then the supporting detail as short bullets, there for detail-minded users, not the headline:

- **Product:** [what it is, and which shots it appears in]
- **Assets:** [each reference by short descriptor, numbered, which is the `@imageN` mapping]
- **Setting:** [location, time, light, and whether it holds across every shot]
- **Look:** [the invariant capture stack in one line, so every shot cuts together]
- **Audio:** [the diegetic bed, plus a note on where music and VO go in the edit]
- **Delivery:** [one prompt per shot, or bundled, see below]
- **Total runtime:** [and confirmation the timecodes sum exactly]

Close with a guiding confirm line: **"That's the spot. Change a beat, add one, cut one, reorder them, or lock it and I'll start writing the prompts."** **Wait for the green light. Nothing gets written until the beat sheet is locked.** This is a hard rule. Writing six prompts against an unapproved structure wastes the user's time and yours, and it invites them to accept a structure they never chose.

### 1e. The approved beat sheet flows straight into SLOT 1

SLOT 1 of the spine already IS the beat sheet in prompt form. The approved card is not a planning artefact that gets set aside, it is the literal source of the header on every prompt that follows.

- The **timecode range** of a row becomes that shot's runtime in its HEADER.
- The **what happens** column becomes that shot's ACTION TIMING beats.
- The **in frame** column becomes that shot's ASSETS and its reference list.
- The **beat name** decides the camera register, the lens, and how long the frame is allowed to be still.

### 1f. One prompt per shot, or bundled

Ask once at beat-sheet lock:

| Delivery | Header shape | Use when |
|---|---|---|
| **One prompt per shot (default)** | `1 continuous shot. Total 2.5 seconds, no cuts, no transitions. Real-time throughout.` | You want real cut control in the edit, and every generation gets the full identity budget for one shot |
| **Bundled multi-shot** | `4 shots. Total 8 seconds, shot 1 runs 0.0-2.0s, shot 2 runs 2.0-4.0s...` | Your generator holds hard cuts inside a single generation and you want the cut rhythm baked in |

- **Default to one prompt per shot.** An ad is cut, not generated whole. Separate generations give the editor a real choice of where the cut lands, let a single shot be re-rolled without losing the other five, and give each shot the whole reference budget.
- **Every prompt is standalone regardless.** No prompt ever refers to another one. No "as established in shot 2," no "matching the previous plate." Each restates identity, wardrobe, product, location, light and air fresh, in full. That redundancy across prompts is what holds the spot together visually.

---

## STAGE 2: PRE-PROMPT CHECK (CARDS, NOT BULLETS)

Every shot gets this before its full prompt is written. Lead with **two tables** so the user's eye lands on what matters, the shot and the camera, and can steer them. Auto-pick a default for each and present it as swappable.

**Shot**, the beat broken down:

| Element | This shot |
|---|---|
| Action | [what happens, beat by beat, inside this shot's runtime] |
| Setting | [location, time, light] |
| Framing | [shot size, and where each subject sits in frame] |
| Product | [in frame or not, how it reads, whose hands are on it] |

**Camera register.** Name the register you would default to and why, then the full menu:

> **Register: gentle handheld** (floating, riding breath, frames settle before moving on), my pick for this beat. Want a different energy?
>
> | Register | Feel |
> |---|---|
> | Locked-off | Stillness is the subject. Long held frames, tripod-weighted or an extremely slow push |
> | Gentle handheld | Floating, drifting, riding breath, small organic corrections |
> | Heavy handheld | Jolting, bobbing, snapping corrections, high-frequency vibration underneath |
> | Violent handheld | Punching in and ripping back, whip-pans, hard surges, nothing settles |

Then the supporting detail as short bullets, there for detail-minded users, not the headline:

- **References:** [each attached reference by short descriptor, numbered, which IS the `@imageN` mapping. If none, "none, pure text composition"]
- **Subjects:** [who and what is in frame, by visual marker]
- **Geometry:** [one-line read: lateral position, depth plane, what the frame favours]
- **Lens:** [FOV in degrees with mm, and why that FOV for this framing]
- **Light and colour:** [direction, quality, temperature, and the three colour bands]
- **Product handling:** [grip, contact points, what occludes the label, the reveal beat if there is one]
- **Audio:** [the diegetic sounds this shot carries]
- **Runtime:** [this shot's duration, from the beat sheet]

Close with a guiding confirm line: **"Here's the shot, the camera, and the details. Change anything, or good to go?"** Wait for the green light, then deliver.

**When to skip the pre-prompt check:** iterating on a prompt just delivered (lens tweak, time-of-day swap, grip change, framing shift, palette change), a batch the user pre-confirmed at beat-sheet lock, or the user says "skip the confirm." **Iterations deliver directly** as the revised full prompt, no confirmation bullets. Re-check only on a full scope change: a new shot, a new character set, a new location.

For a locked beat sheet the user has already approved, offer the fast path once: **"Want the pre-prompt check on every shot, or should I just write all six against the beat sheet?"**

---

## DELIVERY FORMAT (LOCKED)

Every prompt is delivered in this order:

1. **Bolded title line with the shot and its runtime.** Example: `**Shot 3 of 6, product reveal, 2.5s**`
2. **The numbered reference list**, in attach order. Bullet 1 is `@image1`, bullet 2 is `@image2`. Never a stale index.
3. **One fenced code block** containing the whole prompt, English only, the labelled slots in the locked order below, with `@imageN` tags inline wherever that reference is referred to.
4. **The settings table, BELOW the code block.** Below it, not above. The prompt is long, so the table stays visible at the bottom with the prompt right above it.

```
| Setting | Value |
|---|---|
| Model | [the user's video generator. Seedance handles this grammar well] |
| Aspect | [user's choice] |
| Duration | [this shot's runtime] |
| Attachments | 1) [ref] · 2) [ref]  (to @image1, @image2, in this order) |
```

No preamble, no post-amble around the code block. Flag a conflict in one or two lines above the title if one exists.

- **A NEGATIVE PROMPT block ships as an optional second code block**, only when the shot has a known drift risk (two similar products, locked spatial geometry, an identity swap risk, a population lock) or when asked. Group it by failure category, comma-separated, no sentences.
- **Always ship the full prompt.** Never partial swaps or "replace this line" unless a targeted patch is requested.
- **Split rather than overload.** Two camera vantages on the same action are two prompts. Anything past the generator's clip ceiling is two prompts. Say so and deliver both.

---

## THE SPINE (LOCKED ORDER)

```
1.  HEADER              shot count · runtime · timecodes · cut policy · speed policy
2.  STYLE PREFIX        the invariants: style, operating style, texture, skin, technical
3.  NO ON-SCREEN TEXT   mandatory, always here, never lower, never carved out
4.  CRITICAL BLOCKS     scene-specific, cap 4
5.  ASSETS              @tag = identity + THIS SCENE action + fidelity assertion
6.  GEOMETRY MAP        absolute frame position and depth planes
7.  FIRST FRAME         what is already happening at frame one
8.  OPTICS              lens lock in FOV degrees, per shot
9.  CAMERA              physicality register and behaviour
10. LIGHT & COLOUR      direction, quality, temperature + the percentage doctrine
11. ATMOSPHERE          air density, depth planes, source-bound vapor
12. CAPTURE REALISM     the real-footage engine: depth, moisture, specular kill, contrast
13. ACTION TIMING       timecoded beats, hard cuts inline
14. PHYSICS             mass, deformation, rebound, lag, contact
15. ACTING              face, eyes, brow, liveness
16. AUDIO               diegetic default, or attached-track sole source
17. LOCKS               positive ordered chain of what must hold
```

**HARD LOCK.** This order never changes. No slot may be omitted, reordered, merged, renamed, or replaced with flowing prose. Every slot ships with its label prefix. If a slot has little to say for a shot, its content is shortened, never dropped. The only conditional content is *inside* a slot: the moisture clause in Capture Realism drops on dry shots, the skin sentence drops on product-only shots, ACTING drops to one line when no face is in frame.

No mode label. No prose between blocks. No aspect ratio.

---

## SLOT 1: HEADER

Single shot, the default for ad delivery:

```
1 continuous shot. Total 2.5 seconds, no cuts, no transitions. Real-time throughout, no slow motion, no overcranking, no ramping, no speed change anywhere in this shot.
```

Bundled multi-shot, when the generator holds cuts:

```
4 shots. Total 8 seconds, shot 1 runs 0.0-2.0s, shot 2 runs 2.0-4.0s, shot 3 runs 4.0-6.0s, shot 4 runs 6.0-8.0s. Hard cuts between them, no transitions, no dissolves. All shots real-time, no slow motion, no overcranking, no ramping, no speed change anywhere in this sequence.
```

Timings sum exactly to the runtime on the beat sheet row.

Runtime guide: 1.5s to 2.5s per shot for high-energy cutting · 2.5s to 4s for narrative and product-use beats · 4s to 7s for a held line of dialogue · 8s and up for a continuous take.

- **Past 15 seconds in a bundled prompt, the header also declares the shot budget** so the model does not compress the whole sequence into the first third. `9 shots across 24 seconds` reads very differently from `24 seconds`. Long sequences hold better built as a chain of 2.5s to 4s beats than as one unbroken take.
- **Slow-motion accents are carved out explicitly**, both where they land and in the closing clause: `Brief slow motion on the pour only, 1.2-1.8s. All other footage real-time.` Ads reach for slow motion on the product beat more than any other genre, so state it or suppress it, never leave it open.

If cuts must never land mid-word: `the cuts fall between words and never inside a word.`

---

## SLOT 2: STYLE PREFIX

The invariant capture stack. Labelled lines, front-loaded, never restated later. **This block is identical across every shot of the spot.** That identity is what makes six separate generations cut together as one film.

```
Style: 8K, photorealism, real organic film grain and halation, high dynamic range, shot on large-format film. NOT a 3D render, NOT a game engine, NOT a game-cutscene aesthetic, NOT a cartoon, NOT anime cel-shading.

Operating style: large-scale realism with intimate handheld closeness, immersive in-camera feel, tactile textures, shallow depth of field on the face, documentary framing, photochemical look.

Texture: matte non-reflective surfaces, lived-in worn materials, organic 65mm film grain, no digital gloss, no plastic sheen.

Skin: pore-level realism, visible pores, fine vellus hair, natural asymmetry, no smoothing, no retouching. Half the face often falls into shadow.

Technical: 8K, real-time 24fps, true 180-degree shutter with a real 1/48 second exposure on every frame, genuine photographic motion blur, each frame blending smoothly into the next. Smooth stable motion, no flicker, no warping, no morphing, no frame interpolation, no frame blending, no ghosting, no double-imaging, no high-shutter video crispness.
```

- **The render quad is mandatory and always four items:** `NOT a 3D render, NOT a game engine, NOT a game-cutscene aesthetic, NOT a cartoon.` Add `NOT anime cel-shading` when the material is stylized enough to invite it. On product work add `NOT a CGI product render, NOT a packshot render` when the product is a bottle, a jar, a device or anything the model has seen ten thousand CGI versions of.
- **The cadence clause lives in Technical and nowhere else.** It is the single most important anti-artifact instruction in the prompt, which is why the Style Prefix sits second.

**Strobe quarantine.** When the shot contains strobe or hard flashing light, append to Technical:

```
The stepped, stuttering quality of this sequence comes entirely from the strobe lighting described below, from bodies revealed only in discrete flashes, and never from broken or choppy footage. The camera motion between flashes stays continuous and smooth even while bodies appear to jump between positions.
```

Without the quarantine the model returns genuinely broken footage.

**Named-DP shorthand is permitted and efficient.** `Operating style, HOYTE VAN HOYTEMA:` carries large-format realism, intimate handheld, in-camera feel, atmospheric depth and photochemical rendition in three words. Use a DP whose signature actually matches the spot, never stack two, and use the same one across every shot of the ad.

---

## SLOT 3: NO ON-SCREEN TEXT

Mandatory in every shot prompt, always in this position. Overlay text is generated early in the frame, so the instruction sits early.

```
NO ON-SCREEN TEXT (CRITICAL): no on-screen text of any kind anywhere in frame at any point. No captions, no subtitles, no burned-in dialogue, no auto-captions, no karaoke text, no lower thirds, no titles, no title cards, no credits, no watermarks, no logos, no timecode, no UI overlays, no social-media overlays, no interface elements, no Chinese characters, no Korean characters. The frame is clean of all overlay graphics from first frame to last.
```

- **Never carve out in-world text inside this block.** No "other than," no "except for." An exception clause reopens the door and captions return. This holds even when the product's own label is the point of the shot.
- **This is the rule that makes the end card a separate generation.** The moment you write "no on-screen text except the logo," the model reads permission, not restriction, and it starts painting captions, lower thirds and burned-in slogans across every frame of every shot. There is no safe way to soften this block. So the ad's on-screen text is not generated inside the spot at all. It gets its own final generation, with its own inverted text block. See THE END CARD.
- **Physical text that genuinely exists in the scene is not overlay text.** The wordmark printed on a bottle, the type on a carton, a street sign, a split-flap board: these are physical objects and they are described in Assets or Geometry Map with shape, colour, placement and legibility. That is a different mechanism entirely and it does not touch this block. See THE PRODUCT AS A FIRST-CLASS SUBJECT.

Weight this block hardest on phone, selfie, UGC and talking-head shots, which pull captions straight from social training data.

---

## SLOT 4: CRITICAL BLOCKS

Any element the model routinely drops, softens or gets wrong is promoted out of the descriptive body into its own ALL-CAPS named block here.

Format: `THE [THING] (CRITICAL):` followed by one exhaustive paragraph.

| Block | Use when |
|---|---|
| `THE SCRIPT` | any spoken dialogue the model generates, first block, top content priority |
| `THE SINGING` | any lipsync to an attached track, first block, top content priority |
| `THE MOUTH IS ALWAYS VISIBLE` | any lipsync, paired with the above |
| `THE PRODUCT` | the product must render exactly, first block on any reveal or hero shot |
| `THE ON-PACK TEXT` | the label typography must render verbatim and legibly |
| `THE PRODUCT IS NEVER OCCLUDED` | fingers, hair or motion blur could cover the wordmark |
| `THE GEOMETRY` | a spatial relationship must not invert (above/below, inside/outside) |
| `THE STAGING` | who stands where must not drift |
| `THE STROBE` / `THE LIGHT CHANGE` | flashing, pulsing, or lighting that shifts mid-take |
| `TWO DISTINCT DESIGNS` | two similar objects or products that must never merge |
| `NOBODY ELSE IS IN THE FRAME` | any shot that must be empty of extras |
| `EVERYONE IS LIVE` | dialogue or group scenes where backgrounded bodies freeze |
| `THE TONE` | comedic or emotionally specific shots that could be misread |
| `THE LANGUAGE` | foreign-language dialogue |
| `THE BEAT` | the dramatic point of the shot is a specific reversal |

- **Cap at four.** Past that they compete and all of them dilute. Order by importance, early text carries more weight.
- **On any shot where the product is on screen, one of the four is a product block.** Usually `THE PRODUCT`. On a reveal or hero beat, promote `THE ON-PACK TEXT` as well and spend two of your four slots there. The product is the reason the ad exists.

Each block is exhaustive within itself. Never split one idea across two. **The block is the instruction, downstream slots only apply it.** Never restate a CRITICAL block in full further down.

---

## SLOT 5: ASSETS

Every asset is one line: **tag, permanent identity, THIS SCENE action, fidelity assertion.** This merges what used to be a separate identity lock and per-shot action line into a single non-repeating unit.

```
@image1 = 177cm, dark bob with blonde balayage ends, centre part, warm fair skin. Navy short-sleeve polo, grey micro-shorts, olive suede wide belt, barefoot. Clean clear face, no beauty marks, no facial markings. Voice strict and focused, mezzo-soprano. THIS SCENE: seated centre of the sofa, speaking, irritation sliding into teasing surprise. 100% match to the reference.
```

- **Target 60 to 110 words per character asset.** Tight enough that five assets do not swamp the prompt.
- **Identity components, in order:** height in cm · build and skin · face and bone structure · hair colour, length, styling · permanent markers · makeup · clean-face negations · wardrobe head to toe, one clause per garment · jewellery and nails · voice descriptor · THIS SCENE · fidelity assertion.
- **Wardrobe is restated every prompt but written economically.** One clause per garment: colour, fabric, cut, how it sits.
  - Too long: *a long-sleeved charcoal-grey cropped top in soft washed matte jersey with a faded mineral-dyed finish, high round neckline, long slim sleeves fitted to the wrist, hem sitting just below the ribcage, the back left open*
  - Right: *a cropped charcoal washed-jersey long-sleeve, high round neck, open back, hem just under the ribcage*
- **Permanent features are declared permanent**, for example `the blunt bangs are permanent and present in every frame`.
- **State-conditional identity is declared with its state and its reason**, for example `no jacket in this shot, omit it entirely for continuity, the jacket is exterior-only`. This prevents the model splitting the difference.
- **Known-drift attributes get an inline anti-drift negation**, for example `BROWN eyes, never blue, never green`.
- **Clean-face negations are explicit.** The model invents facial detail otherwise.
- **Skin lock:** warm fair or as specified, `rendering true and natural, never cool-shifted, never pale porcelain, never tan`.

**Reference scoping.** State what a reference governs and what it does not:

```
@image4 = the location, a rain-slick stone terrace above the city at first light, wet flagstones, low iron railing, the skyline dropping away behind. Controls geography, materials, atmosphere and light direction only.
```

- **Group and crew assets** get one shared block: the full uniform, the permitted variation range (`some wear a sheer mesh layer, some have bare arms`), and the anonymity lock (`every face identical in styling, nobody ever unmasked`).
- **Reference ordering:** characters first in narrative order, then group wardrobe sheet, then **the product**, then any secondary props, then the environment plate, then video or audio last. Renumber cleanly if a reference is added, never leave a stale index.
- **Canonical-over-plate rule (HARD LOCK).** Every named subject that appears in the shot gets its canonical reference attached as its own `@imageN` slot, even when that subject is also visible inside the environment plate. The plate carries the world (location, weather, light, set dressing, composition). The canonical reference carries identity (face, body, livery, markings, silhouette, label). The plate is never a substitute for a canonical reference, and a subject's visible presence in the plate never reduces or removes the requirement to attach its canonical reference. Characters anchor to the character reference. **The product anchors to the product reference, always, in every shot it appears in.** If the product is sitting on the counter in the plate, it still gets its own slot. This is the rule that prevents identity drift between the plate and the rendered output.

---

## THE PRODUCT AS A FIRST-CLASS SUBJECT

The product is not a prop. It is the reason the ad exists, and it fails in ways a character does not: the silhouette survives while the label re-letters itself, the colour shifts half a step between shots, the cap changes finish, the proportions stretch. Every one of those is a re-shoot in the real world and a re-roll here.

### The Product Lock

The product gets its own Asset entry, its own canonical reference, and a Product Lock in every shot it appears in. Same four-part shape as a character asset, tuned to an object.

**Identity components, in order:** capacity or size · dimensions in cm · scale relative to a hand or body · body material and finish · body colour · closure or cap, material and finish · hardware and detailing · **on-pack text, verbatim** · typography, size, placement · secondary graphics · surface state · THIS SCENE · fidelity assertion.

```
@image2 = THE PRODUCT, a 250ml matte-black anodized aluminium bottle, 19cm tall and 6cm across, reading slightly taller than the span of a spread hand. Satin copper screw cap with fine vertical knurling, 3cm deep. A single 4mm copper band circles the neck below the cap. The front face carries the wordmark "AURELIS" in white extended sans, all caps, letter-spaced wide, centred at two-thirds height, 3cm cap height, legible from a metre. Directly below it "COLD BREW" in the same face at one third the size, and beneath that a thin white 2mm rule the full width of the wordmark. No other graphics anywhere on the body. Matte throughout, zero gloss, zero mirror. THIS SCENE: held in her right hand, label facing the lens square-on, fingers wrapped low around the base so no letterform is covered. 100% match to the reference, same proportions, same typography, same copper, same matte finish.
```

- **Scale is the component that fails.** State it against a hand or a body every time: `a 20cm bottle, noticeably taller than the width of a spread hand, it reads full-size, not a miniature`. Without a scale anchor the model renders a plausible-looking object at the wrong size and the shot dies in the edit.
- **Two similar products in one frame get a `TWO DISTINCT DESIGNS` CRITICAL block.** Two SKUs of the same line will merge into one averaged object otherwise.

### On-pack text fidelity

**Brand names, text and graphics are written verbatim** and described physically alongside: shape, colour, placement, legibility. **Naming the thing renders the thing, a paraphrase renders a vague approximation.**

"The bottle has the brand name on it" renders invented letterforms. `the wordmark "AURELIS" in white extended sans, all caps, letter-spaced wide, centred at two-thirds height, 3cm cap height` renders the wordmark. Every piece of on-pack text carries all six:

| Component | Example |
|---|---|
| The string, verbatim, in quotes | `"AURELIS"` |
| Case and letterspacing | `all caps, letter-spaced wide` |
| Typeface character | `white extended sans`, `a high-contrast serif`, `a condensed grotesque` |
| Colour | `white`, `foil copper`, `debossed with no ink` |
| Placement on the object | `centred at two-thirds height on the front face` |
| Physical size and legibility | `3cm cap height, legible from a metre` |

**Promote it to a CRITICAL block on any reveal or hero beat:**

```
THE ON-PACK TEXT (CRITICAL): the front face of the bottle carries exactly two lines of type and nothing else. Line one is the wordmark "AURELIS", white, extended sans, all capitals, letter-spaced wide, centred horizontally, sitting at two-thirds of the bottle's height, 3cm cap height. Line two is "COLD BREW", same typeface, same white, one third the cap height, centred directly beneath, with a 12mm gap. A thin 2mm white rule sits beneath that, matching the width of the wordmark. Every character is rendered exactly as written, correctly spelled, correctly spaced, upright, unmirrored, unwarped and in focus. No additional words, no invented text, no substituted lettering, no logo mark, no barcode, no ingredient panel visible on this face. The type sits flat on the curved surface and curves with it.
```

- **The two negations that matter most:** `never mirrored` and `no invented text`. Mirrored type is the classic failure on any surface the camera passes across, and the model will fill empty pack space with plausible-looking nonsense unless told the face is otherwise empty.
- **On-pack text is a physical object, not overlay text.** It does not touch SLOT 3 and SLOT 3 does not get softened for it. The label is printed on a bottle that exists in the world. The caption is painted on the frame. The model treats them as different things when you describe them as different things.

### Product handling

How a hand meets a product is the difference between a real ad and a stock render. Specify all five.

1. **Contact points.** Which hand, which grip, where the fingers land, how the weight sits. `her right hand, fingers wrapped low around the base, thumb along the seam, the weight resting into the palm, wrist relaxed`. Never `she holds the bottle`.
2. **The occlusion map.** Say explicitly what the hand covers and what it must not. This is where the label dies. `the fingers cover the lower third of the body only, the full wordmark clear of the hand at all times, no finger crossing any letterform, no thumb over the type`.
3. **The reveal beat.** If the shot contains a reveal, it is timed and it is physical. Name the frame the product enters, the rotation that brings the label square, and the frame it lands legible. `at 0.6s the bottle clears the jacket pocket, at 1.1s the wrist rotates 40 degrees bringing the front face square to the lens, from 1.4s to the end the wordmark is fully legible and holds still enough to read`.
4. **Hero framing.** On a HERO beat the product is the subject and the frame says so. State frame occupancy as a percentage, position, and the angle of the front face. `the bottle stands dead centre, filling 60% of frame height, front face square to the lens at eye height, the background falling three stops under`. Hero beats favour 29 degrees (75mm to 85mm) or 18 degrees (100mm to 135mm) for compression and a clean isolated read.
5. **Surface state.** Condensation, dust, fingerprints, wear, temperature. This is what separates a photographed object from a rendered one. Bind it to a cause: `just out of the cold, condensation beading across the upper two-thirds and running in two visible tracks down the label side, the lower third already wet-dark, a single drip hanging at the base ring`. And keep it matte: condensation that renders as glossy white specular beads is the CGI tell. See SLOT 12.

**Liquid obeys gravity.** A pour has a mass, an arc, a splash-back and a settle. `the pour lands off-centre and climbs the far wall of the glass before falling back, a head of foam settling over 0.8 seconds, nothing floating, nothing suspended mid-air.`

---

## SLOT 6: GEOMETRY MAP

Where everything sits in the frame and in depth. **This is the block that stops bodies and products drifting between cuts.**

```
GEOMETRY MAP: on the dark-green L-sofa, the woman with the black hair and brown eyes on the LEFT, the woman with the dark bob in the MIDDLE, the woman with the ashy-blonde shag on the RIGHT. A beanbag pouffe front-right, in front of the blonde. Windows and corkboard on the wall behind, thrown soft. Depth planes: sofa foreground, standing figure mid-ground, window wall background.
```

**Three things every geometry map states:**

1. **Absolute lateral position**, LEFT, MIDDLE, RIGHT, and what is off-frame in which direction
2. **Depth plane per subject**, foreground, mid-ground, background, and which planes are sharp and which fall soft
3. **Vertical relationship where it matters**, ABOVE, BELOW, inverted, suspended, and never let it invert

- **The product gets a geometry line of its own whenever it is on screen.** Lateral position, depth plane, height in frame, and the angle of its front face relative to the lens. `the bottle in the RIGHT third, foreground, standing upright on the counter, front face rotated 15 degrees toward the lens so the wordmark reads without distortion, sharp, the kitchen behind it thrown soft.`
- **Screen-relative and character-relative direction are always labelled.** `she turns to her OWN right` is not `screen-left`. Pick one per instruction and name it, unlabelled direction inverts about half the time.
- **Naming who or what the frame favours resolves ambiguous framing**, for example `three-quarter angle, off-centre, favouring the bottle in the right third`.
- **A locked spatial relationship gets promoted to a CRITICAL block** and defended in the negative prompt. Vertical inversions and above/below pairs are the most drift-prone geometry there is.
- **Scatter over lines.** When several figures share a frame, place them at different depths rather than side by side: `scattered at different depths, NOT in a row`. Line-ups read as posed group photos, which is exactly the stock-ad look the spot is trying to avoid.

---

## SLOT 7: FIRST FRAME

One or two lines. What is already happening at frame one.

```
FIRST FRAME: already mid-stride on the wet flagstones, breath already visible, the bottle already in her right hand at hip height. No empty establishing frame, no static hold before the action starts.
```

The empty establishing frame is a default the model volunteers and it costs half a second of a two-second shot. In a 15-second ad that is an entire beat lost to nothing. Kill it explicitly on every shot.

**This matters most on the HOOK.** The first frame of the spot is the whole job of the hook, and a hook that opens on a static hold has already lost. Open already in motion, or open on a face already reacting. When a reference image is the intended opening composition, say so: `open on the composition of @image4 exactly, already in motion`.

---

## SLOT 8: OPTICS

**The house default is spherical large-format.** Clean glass, natural halation around highlights, creamy focus falloff, subtle lens breathing, natural 180-degree motion blur. **No anamorphic streak flares, no oval bokeh, no artificial flares, no fisheye** unless the user asks for anamorphic by name.

Anamorphic is opt-in per prompt. When requested, state it once here and let the closing Locks carry it. If the ad uses anamorphic, it uses anamorphic on every shot. A single spherical shot inside an anamorphic spot reads as a mistake.

### FOV degree anchor

The model latches onto **degrees** as a snap value, millimetres read as suggestion. Write the degree first, mm in parentheses. Never use an off-ladder value.

| FOV | mm | Feel | Use for |
|---|---|---|---|
| 180° | fisheye | spherical bulge | POV, dream state, hallucination |
| 107° | 14-16mm | architectural ultra-wide | vast interior scale, epic establishing |
| 84° | 20-24mm | classic wide | full-body blocking, immersive action, environmental establish |
| 63° | 28-35mm | reportage wide | observational, walking alongside, doc feel, UGC register |
| 47° | 40-50mm | eye-level neutral | universal medium, two-shot, waist-up |
| 34° | 60-70mm | short tele | compressed group, stacked depth planes |
| 29° | 75-85mm | portrait compression | isolated bust, detail on hands, product in hand |
| 18° | 100-135mm | portrait tight | identity-hold close-up, held emotional beat, hero product |
| 12° | 180-200mm | tele detail | label insert, cap detail, texture, condensation |
| 8° | 300-400mm | extreme long lens | anchored-far observation, watchtower |

**Ad-beat defaults:** HOOK at 63° or 84° for immersion · DEMONSTRATION at 29° for hands · PRODUCT REVEAL at 29° or 18° · HERO at 18°, or 12° for a label insert · REACTION at 18°.

### Lens lock per shot

```
LENS LOCK = 29° (80mm) short telephoto, the bottle and the hand compressed, the kitchen behind thrown fully soft.
No focal drift mid-shot.
```

Bundled multi-shot declares one per shot:

```
LENS LOCK SHOT 1 = 84° (22mm) classic wide, low, the stride immersive.
LENS LOCK SHOT 2 = 29° (80mm) short telephoto, detail on the hands.
LENS LOCK SHOT 3 = 18° (120mm) portrait tight, the label held and readable.
No focal drift mid-shot.
```

**Unusual FOVs need a defense battery.** A long lens will be averaged back toward a normal unless you name what it is not:

```
This is a LONG lens, strong telephoto compression, flattened perspective, background pulled in close and thrown soft, only the bottle and the hand sharp, tight crop. NOT wide-angle, NOT large-format coverage, no fisheye, no edge distortion, no deep focus, no full-room coverage.
```

Same in reverse for ultra-wide. **Extreme FOV across several beats drifts fastest**, so declare the FOV at the top of every beat, repeat it in Locks, and hold one anchor reference across every beat.

---

## SLOT 9: CAMERA

Pick one register and hold it. Register governs cant, cut rate, and how much of the frame is allowed to be still.

| Register | Cant | Cuts | Language | Frame |
|---|---|---|---|---|
| **Locked-off** | 0° | 1 to 2 shots or a oner | tripod-weighted, or an extremely slow push | long held frames, stillness is the subject |
| **Gentle handheld** | 3-10° | 3 to 5 shots, 2.5s to 4s | floating, drifting, riding breath, small organic corrections | frames settle and hold before moving on |
| **Heavy handheld** | 12-25° | 4 to 6 shots, 1.5s to 2.5s | jolting, bobbing, lurching, snapping corrections, high-frequency vibration underneath | every frame mid-move, the eye can still land |
| **Violent handheld** | 25-45° | 4 to 6 shots, 1.5s to 2s | punching in and ripping back, whip-pans, hard surges, violent corrections | nothing settles, the frame never lands |

- **Deduce the register from the description, ask only if genuinely split.** Toward locked-off and gentle: grief, memory, waiting, ritual, solitude, portrait, a held product beat, "quiet," "still," "slow," "elegant," "premium." Toward heavy and violent: a beat drop, choreography, a chase, a fight, a crowd, a named BPM, "chaotic," "aggressive," "hard," "energy drink," "go crazy."
- **HERO and PRODUCT REVEAL beats trend locked-off or gentle.** A label that is bouncing is a label that cannot be read, and the read is the entire purpose of the beat.
- **Every register except locked-off closes with:**

```
never locked, never stabilized, never mechanically smooth, never gimbal-glide, never floaty drone, real shoulder-mounted mass, weight shifts, breath, human over-correction, every frame mid-move but always smooth and continuous in its own travel.
```

That last clause is load-bearing. Without it, violent handheld returns broken footage rather than energetic footage.

- **Dutch cant is a swinging range in degrees** plus `never passing through level, never settling square`.
- **Roaming coverage**, a camera that physically travels between subjects, is stated as an explicit behaviour with what it snaps to: `roams between them and zooms onto details, snapping to a hand closing around the cap, a mouth on the rim, a laughing face, then drifting to the next`.
- **A still subject inside a violent camera is a real choice.** The product held perfectly still while the camera tears around it is a strong ad move. State the split explicitly so the model does not average the two.
- **Keep the register consistent across the spot** unless a beat change justifies breaking it. A register change is a statement, so make it land on the reversal, not at random.

---

## SLOT 10: LIGHT & COLOUR

**Light is described by direction, quality and temperature. Never by fixture name.** No named lamps, no stock codes, no log profiles, no IRE.

```
LIGHT: motivated natural light, one soft key from camera-side and above, soft roll-off, faithful skin tones, no heavy grade. Cool daylight counter-note from the windows behind. Half-faces rolling through shadow as they move.
```

- **Light direction and colour temperature are identical across every shot of the spot.** This is the second thing after the Style Prefix that makes separate generations cut together. If shot 2 is keyed from camera-left and shot 3 is keyed from camera-right, the edit will feel wrong and nobody will be able to say why.
- **The product needs a named key.** State where the light on the label comes from and what shape it makes: `a soft broad key from camera-left and slightly above, wrapping the curve of the body, the far edge falling into a soft gradient, a single narrow specular running down the copper cap only`. Products lit by nothing in particular render flat and dead.

### The colour accent doctrine

Percentages, each nailed to a physical source. This allocates frame area, which a bare palette list does not.

```
COLOUR: ~70% desaturated green-grey room tone and raw concrete; ~20% warm orange-yellow accent from warm daylight and the warm ceiling wash through the netting; ~10% cool daylight blue as a counter-note from the windows.
```

Three bands, roughly 70 / 20 / 10. **Every band names its source.** A colour with no source in frame will not render.

**On an ad, one of the three bands should usually be the brand colour**, and it names a physical source in frame: the cap, a garment, a wall, a piece of signage, a spill of light. That is how a spot reads as branded without a single graphic on screen.

State where blacks sit, what blooms, what flares specular, what holds saturation. Attach every colour to a fabric, a surface or a light source.

---

## SLOT 11: ATMOSPHERE

**Air is always present. Vapor is always source-bound.**

Real air at real density, filling the entire frame including the foreground, a continuous scattering gradient from lens to horizon, blacks lifted at every depth, high micro-contrast inside the lift.

```
ATMOSPHERE: the air carries real density at every depth, a continuous scattering gradient from the lens to the far wall, blacks lifted at every plane, depth reading in clearly separated layers: [name the actual planes of this shot, nearest to furthest, and how each softens]. Razor skin and fabric texture up close, heavy grain inside the lifted shadows, natural bloom at point light sources. Low macro contrast, high micro contrast. Bodies pass through the air without disturbing it, leaving no wakes and no trails.
```

### The source rule

**Visible vapor shapes only exist when something in frame is physically making them.** Named source, named emission, and nothing anywhere else.

- Right: *a lit cigarette in her left hand, a thin ribbon of smoke rising off the ember and dissipating within 30cm*
- Right: *every footfall and impact blasts up dust that blooms and streams off in the wind*
- Right: *breath condensing in the cold, visible on the exhale only*
- Right: *steam lifting off the cup surface*

Without a source in frame, close the block:

```
No plumes, no banks, no tendrils, no wisps, no swirls, no rolling, no fog-machine texture, no smoke shapes, no volumetric shafts, no god rays. Nothing in the air is emitted by anything.
```

Naturally foggy exteriors are legitimate, cold morning fog, coastal haze, mist in a ruined city, and read as **uniform density and reduced visibility with distance**, not as shapes moving through frame. Write it as `thick cold fog holding at uniform density, visibility falling off with distance` and keep the shape negations.

- **Clean-air scenes state it just as hard:** `the air is clean, no haze, no density, no visible beams, no suspended particulate, full clarity to the back wall`.
- **Always name the actual depth planes of the actual shot.** Atmosphere is for depth separation, never for mood.
- **Atmosphere density holds uniform across the whole spot.** A hazy hook cutting to a clean hero looks like two different films.

---

## SLOT 12: CAPTURE REALISM (LOCKED, THE REAL-FOOTAGE ENGINE)

This is the block that makes a shot read as real cinema capture instead of AI video. Slot 2 names the *stack*, slot 11 names the *air*, this block names the *physics of the render*: the four mechanics that, in practice, are what separate footage that looks photographed from footage that looks generated. It ships on every prompt unless the user explicitly asks for a glossy, clean, commercial register.

- **Why it exists:** the most common AI-video failure is not bad framing or the wrong lens, it is the over-contrasty, over-plastic look. That look comes from three things the model does by default: it invents flat single-plane staging with no air between subject and background, it renders moisture and skin as glossy and specular, and it over-renders contrast cues into clipped highlights and crushed blacks. This block attacks all three at the source.
- **Ads are the worst offender**, because every commercial reference the model has ever seen is glossy. A product shot will render as a CGI packshot unless this block is on it.
- **The four mechanics. Every Capture Realism block tunes all four to the shot.** Mechanic 1 (depth via suspended atmosphere) is default-on in any shot that has planes to separate, which is nearly all of them. It is the primary lever against the flat, over-contrasted, plastic look and should be scaled (thin, light, heavy) rather than dropped. Mechanics 2 to 4 tune or drop per shot as noted below.

1. **Depth via suspended atmosphere between planes.** This is the single biggest lever for real-camera depth. State that atmosphere, haze, mist, air density, particulate, is *suspended in the air between the camera, the subject, and the background*, forcing the model to render distant planes softer, desaturated, and lower-contrast than the foreground. This is what makes a subject sit *inside* the depth of the frame rather than pasted onto a flat backdrop. Always tie it to the actual planes in this shot (foreground subject, midground, far background element). Slot 11 names the planes and the air's behaviour, slot 12 names how the sensor renders the separation. No overlap.
2. **Moisture without shine (only if the scene is wet, humid, sweaty, or the product is cold).** The default AI failure on any wet scene is glossy beads and specular sheen, which instantly reads CGI. If the shot has moisture of any kind, state it as *present but matte*: surfaces are damp, not beaded, wet but not glossy, moisture that mutes and saturates without producing a single specular hotspot. Damp matte hair, slight moisture on skin that stays matte, wet ground with muted (not mirror) reflection, condensation on the pack that stays matte, not showroom. If the shot is bone-dry, skip this mechanic entirely.
3. **Per-zone specular kill on skin, and the flattering ceiling.** "Matte skin" is too vague to hold. Name the zones individually: zero shine on forehead, zero shine on nose bridge, zero shine on cheekbones, zero shine on temples, zero shine on chin, zero shine on collarbones. The blown specular hotspot on a nose bridge or cheekbone is *the* AI-skin tell, and naming each zone kills each hotspot. Pair it with the biology cues: real peach fuzz at jaw and hairline, real soft pore texture, light absorbed like true subsurface scattering, warmth preserved (slightly desaturated is fine, washed-out, pale or cool-shifted is not). **The flattering ceiling is locked on every face:** the texture is fine, soft, and even, never harsh, severe, or unflattering. No acne, no blemishes, no prominent spots, no scarring, no enlarged, cratered or rough pores, no brutal clinical macro-detail. Realism never makes a face look ugly. Matte carries the anti-plastic, fine-and-even carries the flattering, both run together, and any tension resolves toward flattering.
4. **Contrast curve stated three ways.** Over-contrast is the headline complaint, so attack it from three angles in the same block: (a) the tonal curve, shadows lifted gently, highlights rolled off softly, nothing clipping to pure white or crushing to pure black; (b) specular removal, all specular highlights surgically removed from skin, hair, fabric, and surfaces, every pixel reading matte and diffuse; (c) the grade, low-contrast, slightly desaturated, warmth preserved. Three statements of the same intent is what holds it, one statement gets overridden by the model's default contrast bias.

**Canonical Capture Realism block (tune every bracket to the shot):**

```
CAPTURE REALISM: [foreground subject] sits inside real depth, [thin/light/heavy] atmosphere suspended in the air between camera, subject, and [the far background element], the background rendered softer, desaturated, and lower-contrast than the foreground so the figure sits within the air rather than pasted on a flat plane. [IF WET: Slight moisture has settled on every surface, damp matte hair, slight moisture on skin holding fully matte with no beading and no wet sheen, [wet ground with muted reflection / damp matte fabric / condensation on the pack damp but matte, not showroom], moisture that mutes and deepens without a single specular hotspot.] Skin reads true cinematic matte, zero shine on forehead, nose bridge, cheekbones, temples, chin, and collarbones, real peach fuzz catching light at the jaw and hairline, real soft fine even pore texture, light absorbed like true subsurface scattering, warmth preserved and natural, slightly desaturated but never pale or washed-out or cool-shifted, never plastic, never doll-skin, never AI-rendered, and never harsh, no acne, no blemishes, no enlarged or rough pores, fine flattering texture that keeps the face looking good. Low-contrast curve, shadows lifted gently holding texture, highlights rolled off softly never clipping to white, nothing crushed to black. All specular highlights surgically removed from skin, hair, fabric, and surrounding surfaces, every pixel reading matte and diffuse. Slightly desaturated grade with warmth preserved.
```

**Product-shot variant.** On a HERO or REVEAL beat with no face in frame, drop the skin sentence and run the same four mechanics on the object:

```
CAPTURE REALISM: the bottle sits inside real depth, thin atmosphere suspended in the air between camera, bottle, and the far wall, the background rendered softer, desaturated, and lower-contrast than the foreground so the object sits within the air rather than cut out and pasted on. Condensation reads damp and matte, beads holding their own soft shadow with no white specular pinpoints, the wet-dark lower third muting and deepening the black anodizing rather than glossing it. The matte body absorbs light with a broad soft falloff and no mirror, one narrow controlled specular permitted on the copper cap only. Low-contrast curve, shadows lifted gently holding texture in the black body, highlights rolled off softly never clipping to white, nothing crushed to black. Slightly desaturated grade with warmth preserved. Reads as photographed on set, never as a rendered packshot, never as a CGI product visualization.
```

**Tuning notes:**

- **Dry shots:** delete the entire `[IF WET: ...]` sentence. Do not force moisture into a dry environment.
- **No humans (hero, insert, pure environment):** drop the skin sentence entirely. Keep mechanics 1 and 4 and apply the matte-not-glossy logic to the object surfaces instead.
- **Deliberately glossy register:** if the user explicitly wants a crafted high-gloss editorial look, this block is reduced, not deleted. Keep mechanics 1 and 4, allow controlled intentional specular on chrome, glass and foil, and say so by name so the gloss is a choice rather than a default.
- **Atmosphere density** scales with the shot: "thin atmosphere" for a clean interior, "light haze" for most exteriors, "heavy suspended mist" for a moody pre-dawn. The denser the air, the stronger the depth separation.
- **This block does not name gear, grade values, frame rate, or runtime.** That lives in slot 2 and slot 1. Capture Realism is render physics, Style Prefix is the stack.
- **Because slot 12 now carries the per-zone skin lock in full, LOCKS does not restate it.** One clause pointing at it, never a rewrite. See SLOT 17.

**Relationship to the negative-to-positive rule:** this block leans positive ("reads matte," "lifted gently," "warmth preserved") rather than piling negatives, but the specular kill and the anti-plastic clauses are the sanctioned exception. Like the on-screen-text suppression, the "no shine, no plastic, no beading" phrasings are known-failure-mode suppressions that earn their place. Keep them tight, do not let the block balloon into a wall of negatives.

---

## SLOT 13: ACTION TIMING

Timecoded beats. Hard cuts on their own line. Every visible body accounted for in every beat.

Single shot, timed from zero within the shot:

```
0.0-0.6s: already mid-stride, right hand rising from the jacket pocket with the bottle, elbow leading.
0.6-1.1s: the wrist rotates 40 degrees, bringing the front face square to the lens, the wordmark coming clear of the fingers.
1.1-2.5s: the hand settles, the bottle holds steady at chest height, only breath and the drift of the ponytail moving. The wordmark stays legible and still enough to read for the full remaining beat.
```

Bundled multi-shot:

```
0.0-1.5s (SHOT 1, the stride): runs at 14 km/h on wet flagstones, breath visible, spray kicking off each footfall.
1.5s HARD CUT
1.5-3.0s (SHOT 2, the reveal): the bottle clears the pocket, the wrist rotates, the wordmark comes square to the lens and holds.
3.0s HARD CUT
```

- **Silence about a body means it drifts.** Every figure in frame gets an action in every beat, even if the action is small: `in the foreground she shifts and reacts, a small head turn, breathing, listening`.
- **Silence about the product means it drifts too.** If the product is in frame it gets an action in every beat, even when the action is stillness: `the bottle stays exactly where it is, upright, unmoved, front face square to the lens, only the condensation running`.
- **EVERYONE IS LIVE.** Backgrounded and foregrounded bodies freeze by default in dialogue scenes. State the counter explicitly: `nobody sits frozen, everyone is reacting throughout`.
- **Each figure on her own clock.** For group energy: `each moves differently at her own random timing, deliberately messy, never moving as one`.

**Dialogue is written verbatim in quotes**, with the emotional arc and the physical beat tied to the stressed word:

```
speaks to the woman beside her, lightly teasing without malice: "We've got HER, though." (clear stress on HER) and ON THAT WORD she turns her gaze to her OWN RIGHT and looks and nods directly toward the figure off-camera to her right, a pointed "right there, her" beat.
```

- **Synchronized choreography** needs the unison lock plus the anti-mannequin clause: `every dancer hits the same shape at the same moment while carrying her own micro-timing, head angle and limb height inside the count, so the group never reads as identical mannequins`.
- **Name four motion layers, always**, even when one is "nothing else moves": character motion · micro-motion (breath, hair, fabric, jewellery) · environmental motion (water, particles, dust) · camera motion, which lives in slot 9.
- **Hair and fabric as motion** is first-class on high-energy shots: hair whipping across faces and being pushed clear, fabric lifting and settling, chains swinging with real momentum. It reads as physical truth more than any body description.

---

## SLOT 14: PHYSICS

True gravity. **The chain is always the same, scaled to the mass in play.**

```
1. Stated mass:        kg, tons, or bodyweight
2. Contact event:      foot lands, body hits, hand grips, bottle sets down
3. Deformation:        the receiving surface gives: cushions compress, ground craters, fabric bunches, the grip flattens the fingertip pads
4. Rebound / recovery: the surface returns, knees absorb, the body recovers
5. Secondary lag:      hair, loose fabric, cables, liquid trail the primary motion
6. Contact shadow:     where the body or object meets the surface, grounded
7. Closing negation:   nothing floats, nothing slides, nothing teleports
```

Bodyweight scale:

```
PHYSICS: real gravity, inertia and mass, weighted body movement, jumping with real impact and recovery, sofa cushions compressing and rebounding under the jumps, knees absorbing the landings, hair and loose fabric whipping with the motion, accurate contact shadows where feet meet floor and cushion. Nothing floats, nothing slides.
```

Product scale, the one that matters most for ads:

```
PHYSICS: the bottle carries real mass at roughly 400 grams full, the fingertip pads flattening slightly where they grip the anodized body, the wrist and forearm carrying the weight with a small visible effort on the lift. When it sets down on the stone it makes contact with a small settle and a hard contact shadow directly beneath the base ring, no hover, no gap, no glow between base and surface. The liquid inside lags the motion, sloshing a beat behind each direction change and settling after the hand stops. Condensation runs downward under gravity in tracks, never sideways, never upward. Nothing floats, nothing slides, nothing rotates on its own.
```

**The floating product is the signature ad failure.** A product with no contact shadow, no settle and no weight reads as a composite. Steps 3 and 6 of the chain are the two that fix it, and neither is optional on a shot where the product touches anything.

Heavy scale, for vehicles and machinery: `real two-ton mass, the door swinging shut with real weight and a settle on its hinges, suspension compressing and rebounding as it takes the load, panels and cables lagging the motion. Nothing floats, nothing teleports.`

- **Effort is physics.** Strain, exhaustion and struggle are rendered in the body, not asserted: `shaking arms, slipping grips, hands slip and catch, the body trembles, boots scrabbling for purchase, hard breathing`.
- **Resistance is physics.** A thing that yields does so over time: `the cap resists for a beat, the wrist tightens, then it breaks seal and turns freely`.
- **Falling debris obeys gravity and is declared harmless** when it should be: `a scatter of grit falls past her with real gravity, she is unharmed and keeps climbing`.
- **Structures that must hold are declared to hold:** `the rig holds, no fall, no free fall, no snapping cable`.

---

## SLOT 15: ACTING

```
ACTING: natural eye blinking throughout, active forehead and brow micro-expression, no frozen mask-face, no dead eyes. Forehead and eyebrow movement precisely matches the emotion of each beat, brows up on the surprised peaks, scrunching down on the hard belts, foreheads alive throughout.
```

- **Brow and forehead matched to the beat is the single highest-yield acting instruction.** Faces go slack and generic without it, and a slack face is what makes an ad look like stock footage.
- **Eyelines are stated as targets**, for example `she looks at the bottle in her own hand, never into the lens`. Looking at camera is a strong default and must be suppressed explicitly in observational work. It is also sometimes exactly what an ad wants, in which case say so by name: `she looks directly into the lens and holds it`.
- **Emotional arcs inside a beat** are written as a slide, not a state: `first slightly irritated, then sliding into teasing surprise`.
- **REACTION beats are carried entirely by this slot.** A reaction shot with a generic ACTING block is a wasted beat. Name the muscle: `the exhale releases before the smile does, brow softening first, eyes closing for a beat on the swallow`.
- **Physical performance negations** where relevant: no mouthed words, no singing, no teeth-baring, unless the shot calls for them.
- **On a product-only shot** this slot shortens to one line rather than dropping: `ACTING: no figures in frame, no faces, no hands entering at any point.` The slot still ships with its label.

---

## SLOT 16: AUDIO

**Default: diegetic only.** Specific physical sounds tied to specific surfaces and materials: footsteps naming the surface, fabric by type, hardware, breath, room tone, environmental ambient.

### Why an ad prompt still suppresses music

This is deliberate and it is correct. Music and voiceover are added in the edit, not generated.

Three reasons, all practical:

1. **Generated score is uncuttable.** It is locked to that clip's timing, it will not match the next clip's generated score, and it cannot be ducked, trimmed or crossfaded. Six shots with six different invented music beds do not assemble into an ad.
2. **Generated music is legally and creatively worthless.** You cannot licence it, version it, or hand it to a client. The real track goes on in the edit, where it belongs.
3. **The model scores anything that looks like content.** A conversation, a walk, an emotional beat, a product reveal: all of it invites underscore. One word of negation is not enough, which is why the suppression tail below is long and specific.

What the shot prompts should produce is **clean diegetic stems**: footsteps, breath, fabric, the cap breaking seal, the pour, room tone. Those are exactly what a real edit wants under a real track. Suppressing music at generation time is not a limitation of this skill, it is the correct pipeline.

**Voiceover is the same.** If the ad has a VO, it is scripted and recorded in the edit. Never ask the model to generate it. On-camera dialogue is different and is generated, using the Dialogue Protocol below.

### The music suppression tail

Every diegetic prompt closes on this, and it is not optional.

```
No music, no score, no lyrics, no singing, no laugh track, no added foley beyond what is physically in frame, no subtitles.
```

Add `no ambient pad, no swell, no drone, no rising tone` on emotional or dramatic material, where the model reaches for underscore hardest. **Add it on every product reveal**, which is the single strongest trigger for an invented swell. Add `no crowd sound, no chatter, no voices off-frame` on any shot with a population lock, since the model tends to fill an empty exterior with people it did not render.

- **Never write song references, lyrics, or track-tied dialogue.** If a track is being lip-synced, it is uploaded separately as an audio reference and the attached-track lock below applies.
- **Everything audible names a source in frame.** A sound with no visible cause reads as a mix decision and pulls the model toward scoring. Footfalls name the surface, fabric names its weight, hardware names its material.
- **Product audio is a real category and it sells the shot.** Name it precisely: `the metal cap breaking seal with a short dry crack, the thread turning with a fine grating rasp, the first pour hitting glass, carbonation ticking as it settles`. A well-specified product sound does more for a reveal beat than any amount of visual adjective.
- **Ambience is named and levelled, not implied.** `Low park ambience, leaves overhead, birds, faint distant traffic` gives the silences something to sit in. An unspecified ambient bed comes back as a pad.
- **Silences are assigned to the ambience explicitly** so they do not get scored: `carrying both silences on its own`.

### Proximity-governed dialogue

When speakers hold their own microphones, level is a physical fact, not a mix choice, and it gets its own CRITICAL block:

```
THE MICROPHONE PROXIMITY (CRITICAL): voice level follows mouth-to-microphone distance. Close to the lips a voice is warm and broadcast-present with breath audible on the capsule; lowered, dropped to a lap or swung off-axis by a moving arm it immediately goes thin, distant and roomy with the room audible around it. In this take: [name the exact lines that depart from close and full, and the visible body action causing each]. Everything else is close and full. Transitions are immediate and driven by visible hand movement, never a fade.
```

Name the departures line by line. A general rule with no instances listed produces uniform level.

**Attached-track lock, HARD.** When an audio or video track is attached it is the sole and complete audio source:

```
AUDIO: the attached clip @video1 is the sole and complete audio source for this shot. Generate no additional audio of any kind, no room tone, no foley, no ambience, no breath, no added dialogue, no music.
```

The attached clip also owns all internal timing. Never impose per-beat timing on a lipsync take.

**The unheard-track technique** lets bodies sing or move to a beat without music in the mix:

```
AUDIO: no music in the mix, the track is not audible. Only the voices, loud and a little off-key, singing roughly in time to the unheard 87 BPM beat: "[lyric]". Plus room tone, footfalls, sofa creak, laughter, fabric. No track, no instrumental.
```

- **Spoken dialogue is allowed** when a shot has real on-camera speech. Line verbatim in quotes, plus delivery physics: mic distance, reverberation, compression, pitch level, accent.
- **Non-verbal shots** state it: `environmental sound and non-verbal effort sounds only, strained grips, hard breathing, an exertion grunt. No spoken words, no dialogue.`
- **Slow-motion beats** get their own audio treatment: `slow-motion accents drop ambient under a low pressurized tone`.

---

## SLOT 17: LOCKS

A positive ordered chain of what must hold. **Not a summary of the prompt**, only what could drift, phrased as what happens rather than what does not.

```
LOCKS: the shot runs in order, the hand rises with the bottle, the wrist rotates the front face square to the lens, the hand settles and holds. Same identity, same wardrobe, same bottle and same label continuous from first frame to last. The wordmark stays legible, upright, correctly spelled and unmirrored throughout. Wardrobe identical to the tagged reference, one look, no mixing. Light direction and colour temperature identical to the reference plate. The air holds uniform density throughout. Skin protection exactly as locked in Capture Realism above, holding across the whole shot.
```

Standard contents, one line each: **ordered action chain · identity continuity · product and label continuity · staging and geometry holds · wardrobe identical to references · permanent markers restated as a short list · environment identical across shots · every shot a different angle and height · light and colour temperature consistent · atmosphere uniform · a one-clause pointer to the skin protection in slot 12.**

- **The no-restatement rule.** If a CRITICAL block already locked it, Locks does not repeat it, one clause pointing at it, not a rewrite. The same applies to the per-zone skin lock, which now lives in full in slot 12.
- **The product line in Locks is mandatory whenever the product is on screen:**

```
The bottle is identical to @image2 in every frame, same proportions, same matte black body, same copper cap, same wordmark in the same place at the same size, correctly spelled and never mirrored, never re-lettered, never restyled, never resized relative to the hand.
```

**Closing negation tail**, tuned to the shot:

```
No CGI, no rendered look, no digital cleanliness, no plastic surfaces, no AI smoothness, no skin smoothing, no glow, no stiffness, no frozen posing, no stabilized camera, no gimbal glide, no video-look high-shutter crispness, no frame interpolation, no frame blending, no dropped frames.
```

On product shots add: `no packshot render, no CGI product visualization, no floating product, no drop shadow that is not cast by a real light in this scene.`

---

## THE END CARD: ITS OWN SEPARATE GENERATION

**The end card is not a shot in the sequence. It is a separate final generation with its own prompt.** This is an architectural decision, not a stylistic one, and it is worth understanding before you try to work around it.

### Why it is separate

SLOT 3 forbids on-screen text absolutely, with no carve-outs, because an exception clause reopens the door. Write "no on-screen text except the logo at the end" into a shot prompt and the model reads the sentence as permission. Captions come back. Lower thirds come back. Burned-in slogans appear at 0.4s on a shot that has no business carrying type. There is no reliable way to scope an exception inside that block, and the cost of a failure is the whole clip. So the ad's on-screen text moves out of the spot entirely. Every shot prompt stays absolutely clean, running the full unsoftened suppression. The end card gets its own generation with the text block **inverted**: text is not suppressed, it is specified, exhaustively, and everything else about text is suppressed instead. This is also how real ads are made. The end card is design, not cinematography, and it deserves its own pass.

### The honest alternative, offered every time

Say this to the user once, plainly, when you get to the end card:

> "Two ways to do this. I can write an end-card prompt and you generate it, which gives you real motion, real light and real depth on the product, but the type will need checking and may need a re-roll or two. Or you composite it in your editor: a still frame plus real type, which gives you pixel-perfect letterforms and a logo that is actually your logo. Most people generate the plate and set the type in the edit. Which do you want?"

Generators render type approximately. A wordmark that is 95% right is 100% wrong on a brand's end card. Say so.

### The end-card prompt

The same seventeen slots in the same order, with two changes: slot 3 inverts, and the CRITICAL blocks are all about type. Slot 15 shortens to one line when no face is in frame, but it still ships.

```
1.  HEADER              1 continuous shot, 2 to 3 seconds, real-time
2.  STYLE PREFIX        identical to the spot, so the card cuts from the last shot
3.  ON-SCREEN TEXT      INVERTED: exactly this text, and nothing else
4.  CRITICAL BLOCKS     THE LOCKUP, THE TYPE, THE PRODUCT
5.  ASSETS              the product, the logo reference if there is one
6.  GEOMETRY MAP        where the product sits, where the type sits, the space between
7.  FIRST FRAME         the card already resolving, or already still
8.  OPTICS              18° (120mm) or 12° (200mm), clean isolation
9.  CAMERA              locked-off or an extremely slow push, almost always
10. LIGHT & COLOUR      the brand band promoted, usually to 20% or 30%
11. ATMOSPHERE          thin, clean, just enough to separate product from ground
12. CAPTURE REALISM     the product variant, no skin sentence
13. ACTION TIMING       the resolve: what settles, what holds, for how long
14. PHYSICS             contact shadow under the product, no float
15. ACTING              one line: no figures, no faces, no hands entering at any point
16. AUDIO               one diegetic sound, or clean room tone, plus the suppression tail
17. LOCKS               type legible and correct, product identical, no drift
```

**The inverted text block:**

```
ON-SCREEN TEXT (CRITICAL): this frame carries exactly two pieces of on-screen text and nothing else. First, the wordmark "AURELIS" in white extended sans, all capitals, letter-spaced wide, centred horizontally, sitting at 55% of frame height, cap height equal to 6% of frame height. Second, directly beneath it with a gap equal to one cap height, the line "COLD, HONEST, AWAKE" in the same typeface, white, one third the cap height, centred, letter-spaced wide. Both are rendered flat on the frame, perfectly sharp, perfectly upright, correctly spelled character for character, unmirrored, unwarped, not distorted by perspective, fully opaque. No other text of any kind anywhere in frame: no captions, no subtitles, no lower thirds, no watermarks, no URLs, no social handles, no legal lines, no timecode, no UI elements, no Chinese characters, no Korean characters, no invented additional words.
```

**Three rules for that block:**

1. **Every string is verbatim, in quotes.** Naming the thing renders the thing.
2. **Every string carries typography, colour, placement and size** as a proportion of frame height, so it renders at a readable scale.
3. **The negation list still runs**, and it is longer than the shot version because it now has to exclude everything the model might add *alongside* the permitted text. Permitted text is a door, so close every other door explicitly.

- **Keep the Style Prefix identical to the spot.** The end card must cut from the last shot without a visible jump in grain, grade or texture. This is the most common end-card failure and the fix is free.
- **The product on the end card is the same Product Lock, unchanged.** Same reference, same asset line, same fidelity assertion. An end card that shows a slightly different bottle from the one in the spot is worse than no end card.

---

## THE DIALOGUE PROTOCOL

**This is for speech the model generates itself. The lipsync protocol below is for speech supplied on an attached track. They are opposites, never mix them.**

Generated dialogue fails one way: the model invents its own lines. It happens when the script is buried in Action Timing at slot 13, competing with four ALL-CAPS blocks above it that never mention speech, while Audio at slot 16, the slot where speech is actually produced, describes voices but restates no words. The model arrives at generation with a voice profile and no script, so it writes one.

The fix is stating the script **twice, plainly, in the two slots that matter**, and stating it nowhere else in a competing form.

**1. THE SCRIPT is the first CRITICAL block.** Above every other block including staging, geometry and camera. Speaker tags, verbatim lines, in order, with silences marked as beats.

```
THE SCRIPT (CRITICAL): these are the only words spoken in this take. Nothing improvised, added, paraphrased or skipped.

@tag-a: "Okay then what would you do."
@tag-b: "What?"
@tag-a: "Someone's watching this and they wanna make ads that don't suck."
(three seconds of silence, nobody speaks)
@tag-b: "Don't start with the product."

They speak naturally and conversationally at a relaxed pace, the way friends actually talk. Only the speaker's mouth moves, the listener's mouth stays closed or resting, never mouthing along, never forming the other's words.
```

**2. Audio restates the same script verbatim** with per-line delivery attached, proximity, tone, breath state, and closes with the anti-invention clause:

```
AUDIO: fully diegetic. The five scripted lines above, spoken by the assigned speakers in order, and nothing else, no invented dialogue, no substituted phrasing, no extra sentences.
```

**3. Action Timing carries the line again inside its physical beat**, because that is where mic distance and body action get bound to it. Three statements total is correct here and overrides the no-repetition rule. A fourth form does not help.

- **Never write phoneme or mouth mechanics for generated dialogue.** No tongue positions, no jaw-drop descriptions, no lip-rounding, no bilabial closure counts. Those instructions exist to sync a mouth to audio the model already has. When the model is producing the speech, they make it overarticulate, chew its words and deliver robotically. Write the line and the emotional intent, nothing about the face.
- **Every non-speaking body gets an explicit silence.** `@tag-b says nothing in this beat:` followed by what she is doing instead. Silence about a listener means the model gives her words.
- **Exclusive speech gets its own block when two or more people are in frame.**

```
ONE MOUTH SPEAKS AT A TIME (CRITICAL): each line belongs to exactly one person, and only that person's mouth forms those words. The listener never mouths along, never shadows the syllables, never half-forms the same words, and never looks like the line could be coming from her. Laughing, gasping, sniffing and exhaling are always allowed on the listener, only word-forming is exclusive.
```

Deliberate overlaps and unison lines are carved out explicitly or the model suppresses one speaker: `both mouths form those two words together, in sync, at full volume, both fully visible.`

- **Silence is written as a beat with a duration and a filler.** `three full seconds, neither woman speaks and neither mouth forms any word` plus what the ambience carries. Unmarked gaps get filled with invented speech.
- **Product claims spoken on camera are still dialogue and still go in THE SCRIPT verbatim.** Never paraphrase a claim. A legal line delivered approximately is a legal line delivered wrong.
- **Length discipline is part of this protocol.** A dialogue prompt past roughly 1,200 words drowns its own script. The block stops being loud and starts being one of fifteen things shouting. Cut caveats, cut restated wardrobe, cut anything that does not change a pixel or a sound, before cutting anything from the script block.

---

## THE LIPSYNC PROTOCOL

**For attached-track lipsync only.** When the model generates the speech, use the Dialogue Protocol above instead, the mechanics below actively damage generated delivery.

Lipsync fails for four diagnosable reasons: the lyric was stated abstractly instead of as a score, the mouth got obscured, too many cuts forced per-shot mouth re-initialization, or other CRITICAL blocks out-competed the singing instruction.

**1. Promote the singing to the first CRITICAL block.**

```
THE SINGING IS THE PRIMARY SUBJECT (CRITICAL): every other element is secondary. [Description by hair and wardrobe] sings out loud, full voice, mouth open and working hard, for all [X] seconds without stopping. She is a singer delivering a vocal, not a performer mouthing along. Her mouth is the focus of every shot.
```

**2. Write the lyric verbatim, then the mouth mechanics word by word.** Bilabials, **B, M, P**, get maximum emphasis. A visible lip seal is what the eye reads as real lipsync.

```
"TIME": the tongue taps up behind the teeth on the T, the mouth opens wide on a broad AH travelling into an EE, then BOTH LIPS PRESS FULLY AND VISIBLY TOGETHER AND SEAL SHUT on the M, a complete, unmistakable, hard lip closure with upper and lower lips meeting flat and pressing together, held a beat before releasing.
```

Non-bilabial words still get formation: where the tongue goes, how far the jaw opens, whether lips round or spread, whether teeth touch lip.

**3. State the closure count.** Scan the line for B, M, P, those are the hard seals. F and V are teeth-on-lip, described but not counted. Sustained final vowels are declared held open.

```
THE PATTERN OF CLOSURES: four hard lip seals across the sequence, on the M ending TIME, the M starting ME, the B starting BEEN, the B starting BEFORE, plus a smaller visible closure on the P of UP. Every one of the four is complete, fully visible and unmissable. The mouth is never lazily half-open and never mumbling between them.
```

**4. Lock mouth visibility in its own CRITICAL block.**

```
THE MOUTH IS ALWAYS VISIBLE AND ALWAYS READABLE (CRITICAL): her face is turned toward the lens, her mouth unobstructed, frontal and clearly readable in every single frame of every shot, and it stays readable through the camera movement, through the cant and through every flicker of the light. Nothing ever covers it, no hand, no hair, no arm, no other body, no product.
```

That last exclusion matters on ads. A bottle raised to the mouth at the wrong beat eats the closure.

**5. Hand timing to the clip and minimize cuts.** Prefer one continuous take. If cutting, cut between lyric lines or in breaths, never mid-word, and state it in the header.

**Strobe fights lipsync**, hard flash-to-black eats roughly half the closures. When both are wanted, flag it and soften the strobe on the singer only, a fast bright flicker that never drops her face fully to black, while background bodies keep the full treatment.

---

## STROBE GRAMMAR

```
THE STROBE IS THE DEFINING FEATURE (CRITICAL): the space is lit by hard white strobe flashes firing relentlessly on a fast [BPM] pulse. The rhythm is flash, black, flash, black, hard on, hard off, with occasional double and triple stutter runs. Each flash is instantaneous and brilliant, revealing the scene crisply frozen mid-motion, hard-edged and contrasty. Each black interval drops the frame to near-total darkness. No fade in, no fade out, every transition a hard snap. Because the bodies move continuously but are visible only during the flashes, every figure appears to jump between discrete frozen positions. Nothing sits at a comfortable normal exposure at any point.
```

Always pair with: a **secondary light** holding a dim constant glow between hits so forms stay readable in the black · the **cadence quarantine** in Style Prefix · a **continuous-motion clause**: `nothing is ever frozen, held or static between flashes, every body is in continuous motion at all times, it is only the light that stops them`.

- **Strobe eats product reads.** Never put the PRODUCT REVEAL or HERO beat inside a strobe shot. Let the strobe carry the hook or the energy beat and give the product a clean, constant-lit frame of its own.
- **Per-beat light pulsing causes perceived choppiness.** On a report of choppy output, soften the pulse to a slow continuous swell first, if it persists, kill the pulse and go constant.

---

## NEGATIVE → POSITIVE REWRITES

The model responds far better to positive locks than to negative prohibitions.

| Instinct (negative) | Lock (positive) |
|---|---|
| Don't change face | @image1 keeps the same face, hair, wardrobe, and silhouette throughout. |
| Don't switch positions | @image1 remains in the left third throughout; @image2 remains in the right third throughout. Neither crosses the centre line. |
| Don't drift | Boots stay planted on the same ground marks across the full runtime. Only breath, eyes, hair, and fabric move subtly. |
| Don't change costume | Wardrobe identical across the runtime. |
| Don't change the label | The wordmark stays in the same place at the same size, correctly spelled and upright, in every frame. |
| Don't shrink the product | The bottle holds at 19cm, reading slightly taller than a spread hand, its size relative to the hand constant throughout. |
| Don't cover the logo | The fingers stay below the wordmark, the full front face clear of the hand from first frame to last. |
| Don't float the product | The base sits flat on the stone with a hard contact shadow directly beneath it. |
| No extra people | The frame contains only @image1 and @image2 in their specified positions. No other figures enter or pass through. |
| No on-screen text | No on-screen text, no captions, no signage typography, no rendered text in the frame. |
| No camera chaos | Slow controlled handheld with natural operator breath, preserving @image1 in the left third throughout. |
| No blur | Subjects remain sharply focused; controlled cinematic motion blur appears only on falling rain and distant background light sources. |
| Don't blink mid-action | Gaze stays locked on @image2 across the full runtime, eyes steady, no break in eye contact. |
| No mode switching | The shot runs as one continuous take with no cuts, no scene change, no time jump. |

**Always prefer the positive form.** Negative phrasing belongs only in the explicit suppression lines for known failure modes: the on-screen text block, the music suppression tail, the render quad, the specular kill, the anti-invention clause on generated dialogue. Those earn their place. Nothing else does.

---

## HOUSE RULES

- **No character names anywhere in the prompt body.** Visual descriptors only, hair colour and style, wardrobe, identity markers. Applies universally including staging, geometry and camera lines. Semantic reference tags may alias to a name in the numbered list above the code block, never inside it.
- **Brand names, product names and on-pack text ARE written verbatim** and described physically alongside: shape, colour, placement, legibility. Naming the thing renders the thing, a paraphrase renders a vague approximation. This is the one deliberate reversal of the no-names rule and it exists because the product is the subject of the ad.
- **No aspect ratio in the prompt body.** Set it in the generator.
- **No internal production context.** No "carried through from the previous shot," no "matching the earlier plate," no "shot 3 of 6" inside the code block. Every prompt is standalone with everything restated fresh.
- **No platform or tool names** in the prompt body.
- **No meta-commentary.** Every word describes something visible or audible.
- **Age-blind.** Describe by role, hair, wardrobe, identity markers.
- **English only inside the code block.** No bilingual mode.
- **Lighting by direction, quality and temperature only.** Never a fixture name.
- **One main idea per shot.** One dominant action, one camera strategy, one lighting motivation. If a beat needs more, it is two beats, and the beat sheet gets amended before anything is written.

---

## PRE-DELIVERY PASS (SILENT QA, RUN BEFORE EVERY DELIVERY)

Before delivering a prompt, silently run this pass. If anything fails, fix it before the prompt ships. **Do not narrate this pass, it happens internally.**

- [ ] Asset gate asked (if first prompt of session), answer carried, generator limits respected if any were given
- [ ] Beat sheet presented as a card and explicitly approved before any prompt was written, and this shot's runtime and beat match its row
- [ ] Bolded title with the shot and runtime, numbered reference list in attach order, one code block, settings table BELOW the block
- [ ] Header timings sum exactly, speed policy stated, slow motion carved out or suppressed
- [ ] Style Prefix second, render quad present, cadence clause inside Technical, identical to every other shot in the spot
- [ ] NO ON-SCREEN TEXT third, no carve-out clause inside it, not softened for the label
- [ ] CRITICAL blocks capped at four and ordered by importance, with a product block among them on every shot where the product is on screen
- [ ] Every character has its own reference slot and its own Asset line with THIS SCENE
- [ ] **The product has its own canonical reference slot and its own Product Lock, even when it is visible in the plate**
- [ ] On-pack text written verbatim in quotes with typeface, case, colour, placement and size, and product scale anchored to a hand or a body
- [ ] Product handling stated: grip, contact points, occlusion map, reveal timing if there is one, surface state
- [ ] Fidelity assertion on every asset, reference scoping on the environment plate
- [ ] Geometry Map states lateral position, depth planes, vertical relationship, and the product's own geometry line
- [ ] Direction labelled screen-relative or character-relative, and First Frame kills the empty establishing hold
- [ ] Lens lock in FOV degrees with mm and unusual FOVs defended, camera register consistent with the beat, never-settles clause present unless locked-off
- [ ] Colour doctrine in three bands, every band sourced, brand colour bound to a physical source
- [ ] Atmosphere names the actual depth planes, every visible vapor has a source in frame
- [ ] Capture Realism present and tuned: depth between the actual planes, moisture clause only if wet, per-zone specular kill (or the product variant if no face), contrast curve stated three ways
- [ ] No gear, grade or frame-rate language duplicated between Capture Realism and Style Prefix
- [ ] Every visible body has an action in every beat and so does the product, brow and forehead matched to the emotion, eyeline target stated
- [ ] Physics runs the full chain at the right scale, contact shadow and deformation present on any product contact, closes with nothing floats
- [ ] Generated dialogue: THE SCRIPT is the first CRITICAL block, restated verbatim in Audio, carries no phoneme mechanics
- [ ] Every non-speaking body has an explicit silence in every beat, and every silent gap has a stated duration and a named ambience filling it
- [ ] Audio diegetic with the full music suppression tail, or the attached-track sole-source lock
- [ ] Locks is an ordered positive chain, includes the product continuity line, points at the skin protection rather than restating it
- [ ] Negation tail closes the prompt, negative prohibitions translated to positive locks throughout
- [ ] No character names, no aspect ratio, no tool names, no shot numbers, no internal production context inside the code block
- [ ] Nothing stated twice anywhere, word count in the 900 to 1,400 band

---

## REPAIR TABLE

| Symptom | Fix |
|---|---|
| Label re-lettering itself | on-pack text is not verbatim in quotes, or has no typeface, size and placement |
| Invented words appearing on the pack | the face was never declared otherwise empty, add "no additional words, no invented text" |
| Wordmark mirrored | add `unmirrored, upright, not reversed` to the on-pack CRITICAL block |
| Product changing size between shots | scale is not anchored to a hand or body in the Asset line |
| Product floating or hovering | physics chain is missing deformation or contact shadow |
| Product reading as CGI | Capture Realism product variant missing, or gloss not killed on the body |
| Fingers covering the logo | no occlusion map, state what the hand covers and what stays clear |
| Product appearing in a different design | two references teaching the same thing, or the plate standing in for the canonical reference |
| Captions appearing | the text block drifted down, or a carve-out crept into it for the logo. Move the logo to the end card |
| End card type misspelled | generate the plate only and set the type in the edit |
| End card not cutting from the last shot | Style Prefix differs, make it identical |
| Wardrobe drifting | restate every garment in the Asset, not just the changed one |
| Choppy output | check the cadence clause sits in Style Prefix, then soften or kill any per-beat light pulse |
| Bodies drifting between cuts | tighten Geometry Map, add depth planes and a favours-line |
| Geometry inverting | promote it to a CRITICAL block and defend it in the negative prompt |
| Air reading as fog machine | a vapor has no source in frame, bind it or cut it |
| Shots not cutting together | Style Prefix, light direction or atmosphere density differs between prompts |
| Background bodies frozen | add EVERYONE IS LIVE and give each an action per beat |
| Lens averaging back to normal | add the not-the-other-thing defense battery |
| Model inventing its own dialogue | THE SCRIPT is not the first CRITICAL block, or Audio never restated the lines verbatim |
| Delivery robotic, overarticulated, chewing the words | phoneme mechanics leaked into a generated-dialogue prompt, strip every mouth instruction |
| Listener mouthing the speaker's words | add the one-mouth-at-a-time block and give every listener an explicit silence per beat |
| Music or underscore appearing | the suppression tail is short, add score, swell, drone and pad by name |
| Invented crowd noise or off-frame voices | ambience unnamed, or the population lock has no audio counterpart |
| Lipsync closures missing | check mouth-visibility block, cut count, and whether strobe or the product is eating the face |
| Extras appearing | add the population lock as its own CRITICAL block |
| Slow motion appearing unbidden | add the explicit no-speed-change line to the header |
| Long but vague | something is stated twice, find the duplicate and delete the later copy |
| Over the clip ceiling or overloaded | split into two prompts by camera or by beat |
| References silently dropped | reference count exceeds the generator's ceiling, ask for the number and ration |
| Faces averaging or blending | two references are teaching the same thing, cut one |
| Long take compressing into the first third | declare the shot budget in the header, rebuild as 2.5s to 4s beats |
| Hook not landing | First Frame is not already in motion, or the shot opens on a static hold |
| The spot reads as stock footage | ACTING is generic, name the muscle, and check the register is not defaulting to gentle everywhere |

---

## AFTER DELIVERY: NEXT MOVES

After every prompt, offer a short menu so the user always sees where they can go next. Adapt it to what they just built, one short line each.

- **The next shot** on the beat sheet, ready when you are
- **An alternate hook** for the same spot, different opening beat, same everything else
- **More coverage** of this beat, a tighter insert, a wider angle, a reverse
- A **cutdown**, the same spot rebuilt at a shorter runtime with a new beat sheet
- A **variant** for a different placement, vertical framing, a different claim, a different payoff
- The **end card**, once the last shot is written
- A **new location or a new outfit** → build the plate or the sheet in `/ad-assets`, then come back
- A **new product reference** → `/ad-assets`

Once every shot on the beat sheet is written and the end card is delivered, say so plainly and stop offering more shots. The spot is finished.

---

## HANDOFF: IMAGE PROMPTER

Every reference this skill consumes is built in `/ad-assets`: the character face lock, the outfit base, the character sheet, and the environment plate. The product reference is your own product photo, read and confirmed in Mode 4, never generated.

Send the user back there when:

- The character does not exist yet, or needs a new outfit
- The location does not exist yet, or the ad needs a second location
- **The product has no canonical reference.** This is the one that is not optional. Without a locked product reference the label re-invents itself in every generation and no amount of prompt language fixes it.
- A shot needs a high-direction start frame rather than a plate

When a plate or sheet already exists, ask what capture register it was built with and match the Style Prefix and Light direction to it. The two skills share the same grammar, so a still and a shot built together share visual DNA.

Otherwise do not bring it up. This skill operates standalone once the references exist.
