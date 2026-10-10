# Shot direction: writing generated shots (Nano Banana Pro keyframe → Veo 3.1 clip)

How the director writes `generation.keyframe_prompt` and `generation.veo_prompt` for `3d` and `footage`
beats. Curated from The Ad Director pack (`third_party/creative-packs/The Ad Director/`, free to use) and
rewritten for the two models we run, at their lengths. HyperFrames owns every word, logo and number on
screen; a generated shot is a picture under the HTML, never a carrier of text.

## The keyframe prompt (Nano Banana Pro), 120–200 words, in this order

1. **The moment.** The beat's verb happening right now, in a real place: who or what is doing what, mid-action
   ("a hand tilts the carton and the first ribbon of milk meets the coffee"). Write the visible thing, not the
   feeling ("condensation running in two tracks", not "refreshing"). An action beat shows the action; it is
   never turned into a still product portrait. The product performs its own action: if the product pours,
   the hand holds that product and it is the thing pouring; never a second, unseen source.
   **A keyframe is a still photograph.** Show motion by position (mid-slide, mid-pour), never by drawn
   streaks, smears or trails; Veo adds the motion.
2. **NO TEXT (always second, never softened).** `No text of any kind anywhere in the image: no letters,
   words, numbers, logos, wordmarks, labels, signage, captions, watermarks, UI or screens with content.
   Every surface that would carry text is blank.` No "except". An exception invites invented lettering.
3. **The product, when there is one.** Identity cues only: shape, material and finish, colours as named
   hues tied to the brand, the label area as a plain colour field, and its size against a hand when a hand
   is near it. With a product photo attached: `The product is exactly the object in the reference image:
   same shape, proportions, colours and finish; blank where the reference has text.` The reference governs
   identity, never the composition.
4. **Geometry and room for the HTML.** Thirds and depth planes for the subject; name the empty area the
   keyword and logo will use ("the upper-right third is calm, uncluttered wall").
5. **Lens by beat role, in degrees.** Action and footage: 47–63° (28–50 mm), the scene around the action
   visible. Detail of hands or a texture: 29° (75–85 mm). **Hero framing (18°, the product filling the
   frame) only when the beat is a product reveal with nothing else happening.**
6. **Light, then colour.** Light by direction, quality and temperature, never a fixture. Colour as
   ~70 / 20 / 10 with every band on a physical source, one band the brand colour.
7. **Photographed, not rendered.** `Natural light, real materials, slight imperfection, shallow depth of
   field; reads as a photograph, not a CGI render or packshot.` Add a skin line only when a face is in
   frame (natural texture, matte, flattering).
8. **Physics.** A contact shadow under anything resting on a surface; liquids pour with weight; `nothing
   floats.`

## The clip prompt (Veo 3.1), 60–140 words

The keyframe already fixes the look; the clip prompt is about **time**. One continuous take.

1. **First frame is already moving**: `Already in motion from the first frame; no static hold.`
2. **Camera**: one move, its axis and direction matching the beat's `veo_vector` (the 2D cut it joins),
   with its speed in plain words. One register (locked, gentle handheld, heavy handheld); held all shot.
3. **Action, timecoded**: `0–1.5 s: …; 1.5–4 s: …`. Every figure and the product get an action in every
   span, even if it is "stays exactly where it is".
4. **Physics**: mass, lag, settle (liquid lags the move; fabric trails; a set-down settles).
5. **Same NO TEXT block**, shortened: `No text, letters, logos or captions appear at any point.`
6. **Audio**: diegetic sounds only, named by surface, and `no music, no score`. Our music is mixed later.
7. **Locks, positive**: `The product keeps the same shape, colour and size throughout; the frame holds one
   continuous take; light direction never changes.`

## Rules that override the pack

- **No legible text in pixels, ever.** The pack writes on-pack text verbatim; we never do (Veo and Nano
  Banana garble type, and our HTML puts the real name and logo on top). Labels are colour fields.
- **No people unless the beat is `footage`.** A `footage` beat names one character, described by role,
  hair, wardrobe and build, never by name; `character` is set so later shots reuse the same reference.
- **No platform names, aspect ratios, shot numbers or "previous shot" references** inside a prompt.
- **Prefer positive locks** ("the base sits flat with a contact shadow") over prohibitions; the only
  sanctioned negatives are the NO TEXT block, `nothing floats`, `no CGI packshot` and `no music`.
- **One idea per shot.** If a beat needs two actions, it is two beats.

## Repair table (failures seen in our own runs, 2026-10-04)

| Seen | Fix in the prompt |
|---|---|
| Two stacked copies of the scene | One subject in one place; say "a single continuous scene" |
| Studio gear in frame (lights, stands) | Light by direction and source only, no fixture words |
| Ignored "move the camera closer" | Give the lens in degrees and the product's % of frame height |
| Brand shape drawn backwards or generic | Do not ask the model to draw the mark; leave its space empty for the HTML |
| Grey → glossy change read as goo | Describe a material change as light moving across a fixed surface, not as liquid |
| Clip moves 10–40× slower than the cut | Expected: the HTML layer carries cut speed; the clip only needs the right axis and sign |
| An action beat came back as a static CGI packshot (A/B, 2026-10-08) | Lead with the action; hero framing and product-first ordering only for a product-only reveal |
| Milk poured from an unseen source beside a standing carton (A/B) | The product performs the action: the hand holds the product and it pours |
| A motion smear drawn behind a "sliding" keycap (A/B) | A keyframe is a still: position mid-move, no streaks or trails |
| An object half off the frame edge read as floating (A/B) | Every object in the frame rests fully on a surface, with a contact shadow |
