---
name: song-style-ad
description: "Turn an e-commerce product into a song-style ad - a micro music video where an original song carries the story over animated (Pixar-style) visuals, with one or two lip-sync beats of the animated lead singing on camera and the rest silent B-roll. Use when the user asks for a 'song ad', 'song-style ad', 'music video ad', 'musical ad', 'jingle', or wants their product sung. Runs in one chat: (1) write 2-3 song scripts (lyrics + style prompt + visual concept) matched to the audience's genre and generate the song; (2) transcribe the generated song for pacing, design the animated lead, and storyboard beats onto it; (3) generate the lip-sync + B-roll clips and assemble."
---

# Song-style ad

A **song-style ad** plays like a micro music video: an original **song** carries the product story over animated (usually Pixar-style) visuals. It wins when the song is a _real song people would actually hear out_ (not a jingle) whose hook lands the product's angle in the first five seconds.

**The format's identity (always true):** the song is the spine - it sets the pacing, the mood, and the emotional arc, and the visuals ride on top of it. It is a **Mix**: one or two **lip-sync beats** where the animated lead sings on camera, and the rest **silent B-roll** cut to the music. The pacing is audio-first by construction - the generated song's real timestamps are the clock everything else is timed to.

Three fundamentals this skill assumes: every generation is self-contained (the model remembers nothing between generations, so anything that must stay consistent is re-described and re-attached every time); recurring elements hold via one locked **hero reference** (one clean shot of the lead, one of the product) reused in every beat they appear in; and pacing is audio-first (the song is generated first and everything else is timed to its real timestamps).

## What this format fixes, and what to settle

- **Fixed:** deliverable = an animated music-video ad · speech = Mix, sung (lip-sync beats + silent B-roll) · pacing = audio-first (the song).
- **Ask (this format's open questions):** which product (Stage 1) · genre + duration - inferred from the audience, stated, validated (Stage 1) · the animated lead - one consistent hero character across beats, and what it is (Stage 2) · which lines are the lip-sync-on-camera moments (Stage 2).

---

## Stage map

One chat, three stages - **detect the stage from what the user gives you this turn:**

| They gave you…                                                                   | Run                               |
| -------------------------------------------------------------------------------- | --------------------------------- |
| A product (brief / link / notes), no song yet                                    | **Stage 1 - Song scripts**        |
| A generated song ("the song's done", a completed music draft, an uploaded track) | **Stage 2 - Storyboard the song** |
| An approved lead design + storyboard                                             | **Stage 3 - Generate the video**  |

Ambiguous → ask one short question. If they name a stage, obey it.

---

## Stage 1 - Write the song scripts and stage the music draft

**Goal:** 2–3 distinct song scripts for the user to pick from; the pick becomes a staged music draft.

1. **Ground in the product** - from the product page, brief, or notes, pull the brand voice, the target customer, the main pain, and the hero benefit. Never invent proof.
2. **Settle the angle, awareness stage, genre, and duration - infer, state, validate.** The **angle** is the customer outcome the song is about (a specific transformation, _not_ a brand brag or a feature); the **awareness stage** decides how much the lyric has to teach. Infer the **genre** from the audience with the genre map below, and a **duration** (15 / 30 / 60s). State all four in a line and let the user adjust.
3. **Write 2–3 distinct song scripts** in the output format below. Each must feel genuinely different - vary the POV (product POV / customer POV / narrator), the mood (upbeat / emotional / playful / intimate), or the structural hook. Apply every Lyric rule.
4. **Generate the song** for the option picked, on a music model with a custom/lyrics mode (e.g. Suno): the song title, the concise musical description as the style, and the exact lyrics as the lyrics input. Custom mode matters - simple mode reinterprets its prompt and will not preserve the lyrics. The finished song is the input to Stage 2.

### The genre map (infer the genre from the audience)

| Audience                    | Genres that resonate                              |
| --------------------------- | ------------------------------------------------- |
| Moms (general)              | pop, indie pop, light acoustic                    |
| Moms (Gen X / 40+)          | country, soft pop, throwback pop                  |
| Gen Z women                 | pop, hyperpop, R&B, indie pop                     |
| Gen Z men                   | hip-hop, trap, EDM, indie rock                    |
| Millennial women            | pop, indie pop, R&B, alt-pop                      |
| Millennial men              | indie rock, hip-hop, alt-rock                     |
| Black men / women (general) | hip-hop, R&B, trap, neo-soul / R&B, neo-soul, pop |
| Latino / Latina market      | reggaeton, Latin pop, bachata, trap latino        |
| Fitness enthusiasts         | hip-hop, EDM, hard rock, trap                     |
| Skincare / beauty           | pop, R&B, indie pop, hyperpop                     |
| Luxury buyers               | ambient, modern jazz, cinematic pop               |
| Pet owners                  | folk, indie pop, country                          |
| Wellness / spiritual        | ambient, indie folk, soft acoustic                |
| Outdoor adventurers         | folk, indie folk, alt-rock, americana             |
| Gamers / tech               | EDM, synthwave, hyperpop / lo-fi, electro-pop     |
| Foodies                     | indie pop, jazz-pop, acoustic                     |

No exact match → use the closest fit and say why.

### Lyric + style-prompt rules (apply to every option)

- **Hook in the first 5 seconds.** Whatever the duration, the catchiest line lands immediately.
- **Lyrics carry the ANGLE, not the brand.** Sing the customer outcome; don't just chant the product name.
- **A real song, not a jingle.** Real verses, a real chorus, a real rhyme scheme - never "buy buy buy."
- **Short, singable lines** - 4–8 syllables for a pop hook. Long lines feel forced when sung.
- **Match vocabulary + energy to the genre + audience.** Hip-hop ≠ country ≠ pop.
- **Chorus cadence by duration** - 15s = hook + one chorus pass; 30s = verse-chorus-verse-chorus; 60s = full song with a bridge.
- **Keep the style description tight (<25 words):** `[genre], [vocal - e.g. female lead / male rap / choir], [tempo / BPM], [mood], [production - modern polished / lo-fi / vintage]`. Music models do better with a concise style prompt. Never include an artist or band name - Suno rejects it; describe the sound instead.
- **The visual concept must be producible** as animated beats - animated objects, a stylized character, simple Pixar-feel visuals. Not "live-action cinematic crane shots."
- Each of the 2–3 options is **meaningfully different** - don't ship near-duplicates.

### Stage 1 output format (per option)

```
### OPTION [N]: "[Hook line / song title]"
**Concept:** [1–2 sentences — the song's vibe + the animated visual treatment idea.]

**Lyrics:**
[Verse 1] … [Chorus] … [Verse 2 — 30s+] … [Bridge — 60s only]

**Style:** [genre], [vocal], [tempo], [mood], [production]   ← under 25 words

**Visual concept:** [2–3 sentences — what's on screen, tied to specific lyric moments; which lines are lip-sync-on-stage vs B-roll.]
```

After the options: _"Pick your favorite (or ask for more variations) and I'll stage the song for you to generate - then I'll storyboard the video to it."_

---

## Stage 2 - Storyboard the song

**Goal:** turn the generated song into a beat plan mapped onto its real timing. Runs once the song exists.

1. **Transcribe the song for pacing** - the generated song is the factual pacing source. Transcribe it with word-level timestamps and note the total duration; the storyboard maps beats onto real timing, not estimates. The song is generated whole, once - music models aren't deterministic, so never regenerate sections separately.
2. **Settle the elements - infer → state → validate:**
   - **The animated lead** - the singer/character. Design it once and lock one clean reference shot of it in the chosen animated style (the hero reference). Every lip-sync beat and any beat it appears in points back to that shot.
   - **The product** - its hero product reference (a clean, accurate shot) for every beat the product appears in.
   - **The recurring set** - e.g. a neon stage for the lip-sync beats; establish a hero reference only if it must stay consistent (usually just the stage).
3. **Map beats onto the song's timestamps** - one row per beat, each tied to a time range of the song. Two beat kinds:
   - **Lip-sync beat** - the lead sings a **slice of the song** on camera (the chorus, the hook, the payoff line). Carries the speech slice for that time range.
   - **B-roll beat** - silent animated visuals illustrating the lyric at that moment (the product, the ingredients, a pastoral setting), generated with no audio and overlaid on the song in the editor.
     Most of the ad is B-roll with one or two lip-sync beats (the hook and the final chorus are the usual lip-sync moments - see the worked example). Vary the framing across B-roll beats.
4. **Present the storyboard for approval**, then say generating the stills is next.

---

## Stage 3 - Generate the video

**Goal:** the drafts, assembled over the song.

1. **Per-beat start frames** - generate the hero lead reference first, then one start frame per beat with your image model: attach the lead / product / set references again, re-state them in the prompt, and add the beat's action, setting, framing, and lighting. No text in any still. Attach the product reference in any beat the product appears.
2. **Video generations** - group beats into clips up to your video model's cap (usually ~10-15s):
   - **Lip-sync beats** - use a lip-sync-capable video model: pass the beat's **start frame + its song slice** and have the lead sing that slice. Cut the whole song into slices (never regenerate sections), cutting on natural musical beats - never mid-word.
   - **B-roll beats** - generate **silent** (no audio); the model only needs the pacing so the visual lands with its lyric. These are overlaid on the song in the editor.
3. **Assemble** the clips over the full song in the editor; add any captions there - never burned into the footage.

---

## Locked rules

- **R1 - The song is the spine.** Everything is timed to the generated song's real timestamps; never storyboard against a guessed duration. The song is generated whole, once; never regenerate sections separately.
- **R2 - Lyrics carry the angle, not the brand.** The song sings the customer outcome; the product name is not the hook.
- **R3 - The lead is a hero character.** One locked reference shot, re-attached and re-stated in every beat it appears in; never chain off a previous beat's output.
- **R4 - Lip-sync beats carry a song slice; B-roll beats are silent.** Only the on-stage singing beats get the audio (cut to ≤~15s on natural beats); B-roll is generated silent and laid over the song in the editor.
- **R5 - Producible animated visuals.** Animated objects, a stylized lead, simple Pixar-feel visuals - no live-action cinematic crane shots.
- **R6 - Footage stays clean of text.** Captions are an editor layer, only if the user asks - never in an image or video prompt.

---

## Worked example (the quality bar - not a template to copy)

**HolyCow Whipped Tallow Balm** - animated Pixar musical, 9:16, ~42s. Song "Holy Cow (I've Arrived)" (animated pop, female lead, upbeat, 120 BPM). Angle = "something real, finally" (clean tallow vs. labels full of lies).

- **Elements (settled first):** the lead character (one shot), the HolyCow jar (hero product), Pixar 3D style, a recurring neon stage.
- **Beats mapped onto the song:** **[0:00–0:06] lip-sync** - the lead belts the opening line on the neon stage · **[0:06–0:14] B-roll** - hands bin the old products, open the jar · **[0:14–0:20] B-roll** - clean-vs-bad ingredient cards · **[0:20–0:28] B-roll** - a golden-hour pasture with a friendly cow · **[0:28–0:34] B-roll** - four scent jars rotate into a wheel · **[0:34–0:40] lip-sync** - back on stage, glowing, sings the chorus · **[0:40–0:42] B-roll** - the hero jar lands on a pedestal, CTA lockup.
- **Why it works:** two lip-sync beats (hook + final chorus) bookend five silent B-roll beats; every B-roll beat visualizes the lyric at that exact moment; one locked lead and one locked jar across all seven beats.

---

## What you need

- An AI chat that can hold the whole flow (script, storyboard, prompts).
- A music model with a custom/lyrics mode (e.g. Suno) so the lyrics stay exact.
- An image model for the hero references and per-beat start frames.
- A lip-sync-capable video model for the singing beats; any video model for silent B-roll.
- A transcription tool with word timestamps, and an editor for assembly.
