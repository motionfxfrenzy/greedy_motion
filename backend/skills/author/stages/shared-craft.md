# Shared craft rules (every gm-* skill links here)

These apply to every HyperFrames film we build, by any author: a person, a local skill build, or the hosted Claude
author in the Pro Editor. Style skills link to this file instead of copying it, so a fix lands everywhere at once.


## Determinism (seek-safe rendering)

- Set `defaults: { immediateRender: false }` on every timeline.
- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that only
  appears in `fromVars` gets its end value resolved lazily. When a render worker seeks to an
  arbitrary frame, that can resolve to `visibility: hidden`, and the element never appears. A
  monotonic `snapshot` pass still looks correct, so this bug passes every gate except the real
  render.
- Give every hidden-at-start element an explicit `tl.set(el, {autoAlpha: 0}, 0)`.
- No `Math.random` and no clocks: variation comes from stamped arrays or the index.
- Tween transforms and opacity (and clip-path) only; never `left`, `top`, `width` or `height` (use scale, a clip, or a pre-sized element). Never
  `background-clip: text` (it renders invisible in capture): use a solid fill and `text-shadow`. Hold film grain across frames instead of
  re-randomising it (a re-randomised grain made a file seven times larger). Never `mix-blend-mode` over per-track composites (the whole film can
  render white); tone-map before a bloom over a near-white screen.
- A finite `repeat` everywhere. `repeat: -1` is banned.
- **Curves are tweens; decisions are stamps.** Typing rhythm, odometer values and highlight paths
  use `tl.set` frame by frame. Typing reveals use a width or clip tween, not per-frame substrings.
- Snap cut times to frames: `F(n) = (n - 1) / fps`; put clip boundaries just below the frame
  time.
- Count-ups tween a plain object and write the value in `onUpdate`, with tabular figures.
- Never pair a CSS initial `transform` with a GSAP tween on the same property.
- Give the root an opaque background colour; otherwise every seam flashes white.
- Mark deliberate overflow and off-canvas motion with `data-layout-allow-*` (`overflow`, `occlusion` for text a flood or panel
  deliberately covers).
- **Explicit identity baseline.** Before the timeline runs, `gsap.set(els, { x: 0, y: 0, scale: 1 })` on every element a tween
  will move. An untouched element has `transform: none`, a touched one `matrix(1,0,0,1,0,0)`, and the two rasterise text
  differently, so a frame differs by a few pixels depending on which frames were drawn first.
- **One frame, one swap.** A handoff (hide one thing, show another) is a zero-duration `fromTo` on one frame, never a bare
  `tl.set` in the middle of the timeline and never two frames apart.
- **Set `z-index` on every layer** of a scene that has overlays, floods or carried elements, so nothing floats above a layer
  it should be under. Declare every variable before the first `seek()`.
- **Fixed lines for typing.** Type a request over lines whose breaks are authored, so the camera never has to follow a wrapping
  cursor.

## Text that depends on rendering

Never measure text in the browser at runtime, because it races font loading. Render once,
measure from a settled frame, then paste the numbers back. Record the frame each number came
from in the handoff.

## Fonts and brand

- Bundle fonts locally under private family names. Renderers silently alias real system names.
- Measure the mark's real path bounding box before placing it. Supplied SVGs are often
  off-centre in their own viewBox.
- Brand values come from the brand kit / theme contract. Hard-code nothing that a customer's kit would change.
- No invented results: no %, multipliers, customer names or figures that the product can't
  stand behind.

## Pacing (every VO-clocked gm skill)

A narrated film must not feel slower than a music-driven one. These gates apply to every gm skill
whose clock is a voiceover (first written for `gm-feature-explainer` 1.1; its v1 measured 28–30%
held with 2.0–2.8 s holds and a 1.2 s gap after every sentence).

- **Tight VO assembly.** 0.25–0.4 s between sentences inside an act, ≤ 0.6 s between acts.
  Configurable, never a fixed 1 s+ "breath". Kokoro at speed ~1.1.
- **J-cuts.** A scene's exit starts on (just before) the last stressed word of its outgoing line,
  so the cut happens under speech and the next scene is already moving when its line starts. A
  result that must stay on screen may hold the exit later, never past ~0.25 s into the next line.
  Verb-sync gates (±0.25 s) still apply.
- **No settled frames.** Every scene carries a camera move (push and/or parallax) from entry to
  cut; content arrives on words (one element per spoken clause), never on an even timer. Still
  no idle wobble: the motion carries the camera or information (motion-doctrine). An entrance that
  eases to rest before a slower drift reads as a hold; ease into the drift's speed.
- **Gate:** no still hold > 0.6 s, except one declared stillness beat (≤ 1.0 s, the comma before a reveal), listed in the
  handoff. Report held % and the longest hold.
- **Music is the floor.** Duck the bed only under words (≈ 6–8 dB, attack ~50 ms, release
  ~150 ms) so it fills every gap; snap cuts to the bed's beats (`hyperframes beats`) within
  ±0.15 s, else the VO wins; a transition SFX on every scene change.
- **Kinetic type.** Where a skill has feature beats, the key verb/phrase may pop as big kinetic type
  on its word (budget it per beat) — the narrated equivalent of a music film's type hits.

## Holds, first frame and texture (every gm skill; added 2026-10-09 from two public motion guides and our own 5-fps reviews)

- **Frame 0 is the thumbnail.** Feeds autoplay muted and show the first frame. It must carry the headline or the hero object: never an empty or black ground. Pre-roll the opening
  entrance (start it 40-60% in at t=0), or give the film a one-frame poster. A fade from black is for a film, not for a feed.
- **Reading holds.** A readable state holds after it settles: at least 1 s for a short phrase, plus about 0.25 s per word beyond three, at least 2 s for the last hook or call to action
  (the CTA holds 3 s). When in doubt, hold longer and animate less. Secondary motion during a hold goes to things that are not being read (background, a card, a cursor), never to the words.
- **Exits are about half the length of entrances** and use ease-in (leave fast, do not linger). The next scene starts drawing before the last has fully left: a hard gap reads as "loading".
- **Nothing is dead-still.** A film with a still second has no texture: grain (low opacity, reseeded on twos), a slowly drifting dot grid, a vignette, an idle element that breathes (a caret,
  a pulse, a slow turn). Give every personality a texture layer; keep it quiet on calm and premium, and prefer holds with texture over more events there (extra animation reads as AI-made).
- **One hero moment and one elastic accent per film.** Build to the climax; do not spend it early; use one overshoot spring accent, not one per module.
- **Text that swaps inside a morphing container needs its own enter and exit timing** or the two words overlap. Never put `will-change` on anything the camera scales (text turns blurry).
- **The feed floor for headlines is 90 px at 1080** (60 px for full-screen viewing). Keep key content about 60 px inside the frame edge unless it is cropped on purpose.
- **Real facts only.** Never invent a number, price, date, testimonial or result to fill a module; a module that needs a fact is not chosen until the fact is supplied.

## Legibility (every gm skill)

Text that is meant to be read must be big enough to read in a phone-sized window. The floors are
fractions of the **shorter canvas edge**, so 16:9, 1:1 and 9:16 are held to one standard:

| Role | Floor | At a 1080 edge | Covers |
|---|---|---|---|
| `caption` | 5.2% | 56 px | narrative subtitles, verbatim captions |
| `supporting` (default) | 3.0% | 32 px | every other string meant to be read: labels, stats, URLs, UI the viewer must follow |
| `decorative` (alias `mock`) | exempt | — | faux-UI copy that is texture, not content |

- **Measured on what the viewer sees**, not on `font-size`: effective size = font-size × every ancestor
  scale, zoom and transform. A 20 px label inside a `scale(1.8)` card is 36 px; a 40 px headline scaled to
  0.6 is 24 px and fails.
- A run counts only if the same string stays under its floor for **≥ 0.4 s**. Entrance scale-ups and
  deliberate flashes are not read, so they are not gated; text below 60% opacity or mostly clipped is skipped.
- Role comes from the nearest `data-text-role="caption|supporting|decorative"`; unmarked text is
  `supporting`, and an ancestor whose id or class matches `caption|subtitle` makes it a caption.
- **Declaring `decorative` is a declaration, like the stillness beat.** List every decorative subtree in the
  handoff with one line of why. Text the voiceover or a callout points at is never decorative. If in doubt,
  enlarge it.
- **Gate:** no read-at-rest text under its floor.

## Camera, springs and weight

- **One camera per scene.** A single transform on a world container, computed from time alone from keys of
  `[time, zoom, x, y]`; nothing inside the scene carries its own zoom. Interpolate zoom in **log space** (`exp(lerp(ln z0, ln z1, u))`)
  so a push from 1x to 2x and from 2x to 4x take the same time at the same eased pace; linear zoom seems to slow as it arrives.
  Each segment is eased once. Never zoom in and straight back out; at most one zoom reversal in a film, and it is the last move.
  A camera never reverses a pan.
- **Springs are closed-form.** A pop or settle uses the exact damped-spring step response as the ease (a pure function of
  progress), never a simulation and never a value carried between frames, so it is correct from any playhead position. Never
  drive opacity, or any 0..1 value, with a spring (it overshoots). Scale shapes, move words.
- **One weight per class of object, kept for the whole film.** Micro UI (chip, toggle, press): quick, one small overshoot
  (damping ratio 0.55-0.7, 0.25-0.45 s). Pop-ins: damping 0.4-0.5, clear overshoot, rings down (0.6-0.8 s). Panels and cards:
  damping 0.75-0.9, controlled settle (0.7-1.0 s). Camera: smooth `power3.inOut`, almost invisible. Headlines: a strong entrance
  (`power4.out`, a waterfall), then a stable hold long enough to read. Mascot: playful on purpose, springy profile only. The brand's
  motion profile chooses the set: snappy uses damping >= 0.6 everywhere, smooth uses panels only, springy adds pop-ins and a mascot.
  If everything overshoots, nothing feels precise.

## Handoffs and transitions

- **Every handoff carries a shared element.** The words or shape that the eye is following travel across: a button's label becomes
  the headline, then the bubble text; a colour flood carries a copy of the words it covers. Nothing is faded in over nothing.
- **A colour flood** grows from the object that caused it, reaches the farthest corner (compute the radius from the object's
  centre) and takes about 0.35 s: shorter reads as a flash, a circle short of the corner fills it late. It is contracted back into the
  next object's exact rectangle, and the real object takes over on the frame it lands.
- **Replacement is one move (cause and effect).** When a word, line, card or scene replaces another, the old one leaves in the same
  move that brings the new one in: same direction, same easing, same start, offset by more than the clipping box so the two never share
  a pixel (a list "Git, CI, Previews" is a reel: when CI comes up, Git goes up). Never fade the old one while the new one arrives
  on top of it, never let two lines of text overlap for any frame. An incoming scene carries its own opaque ground, so it covers the
  outgoing one; a scene on a transparent layer shows the last scene's words through it. Check it by extracting 5 frames per second
  and reading every frame of every swap.
- **Banned in the continuous styles:** crossfades, blur-ins, whole-frame fades and cuts that do not carry an element. Text rises
  from a mask line; buttons expand into pages; colour floods out of one object before shrinking into another.

## Planning a film

- **Beats, states, reasons.** Every beat has an entry state, an exit state and a reason to exist. A UI sequence starts as a
  state chain (search, result, detail, action, confirmation) before any transition is drawn; one component changes size, colour,
  content and position across it. If nobody can say why beat four exists, it is not in the film.
- **Music-led films run on a beat grid.** Fix the BPM, the beat count and the beat of the drop; start the track a whole number
  of beats before the drop so it lands on the success moment. Give every event a beat. Cuts and hits land on beats (within
  0.15 s), and the opening hit carries the hook. Count in beats, not seconds (130 BPM: a beat is 0.46 s; 32 beats is 14.8 s).
- **Facts are not choices.** The product's real screens, numbers, logo and copy come from the supplied assets. The film may
  invent camera, rhythm and layout, never a dashboard, a metric or a mark. A missing asset is a blocker: ask, or use a clearly
  neutral placeholder, never a convincing fake.
- **One story, three compositions.** 16:9, 9:16 and 1:1 share beats, states and copy and differ in layout, never a crop.
  9:16: fewer simultaneous elements, one idea per frame, a stronger vertical hierarchy, larger type, nothing important in the
  platform strips (top 13% and bottom 22% of the frame). 1:1: tighter type, shorter holds. Review every format on its own.
- **The last frame is a poster.** The final state works as a still: mark and call to action readable, one focal point,
  nothing mid-transition.

## Audio

- Every `<audio>` needs an `id`, or the mixer skips it and the render is silent. Confirm the
  audio stream with `ffprobe`.
- Never put `crossorigin` on `<audio>` or `<video>`.
- Land click SFX on the frame of the press, not after it. **Align by the clip's measured hit point, not its file start**:
  measure the offset to the moment the sound is heard as the event (the loudest sample of a whoosh, riser or impact; the first
  strong transient of a click or pop) and subtract it from the event time, so a whoosh peaks on the cut and an impact on the hit.
  A riser placed by its start lands late by its whole build.
- **Check that every cue is audible in the final mix**, not only placed. Two cues at different volumes can come out within 0.1 dB of each other
  after mastering: fix the source file, not the gain. An effect file that opens with silence makes a correctly placed cue start late: trim it or
  measure its hit point (above). Duck the music about 13 dB for half a beat before the one big hit (one gap, one hit), and fade out in the last
  quarter second.
- One effect per event, each its own voice: typing, send pop, each toss, drop impact, swoosh, click, success tone, page whoosh,
  mark sparkle. Close your eyes: if the sound alone has no shape, the sound design is unfinished.
- Master to about **-14 LUFS integrated, ≤ -2 dBTP**, measured on the final MP4 *after* AAC
  encode. The encode adds about 1 dB of peak; leave headroom in the limiter.
- Log every sound's source and licence. Generated audio (Lyria) is logged with its model, prompt
  file and cost.

## Review: judge frames, not intentions

A first render feels like progress and is where most defects hide. Before any export is called done:

1. **Contact sheet.** One frame at every major beat, plus a strip around each fastest transition, plus the **middle of every
   seam** at phone size with the safe zones drawn. A laptop shows every frame bigger than a viewer will see it.
2. **Critic pass.** Judge only the rendered frames, never the intent. Score hook (a real hook in the first two seconds),
   readability at phone size, continuity (every handoff carries an element), motion (weight classes, no idle wobble, no
   reversed camera) and sound sync (cuts and cues land together). Name the three largest defects, each with a timestamp, the
   evidence, and a local fix.
3. **Bounded repair.** Patch only those three, re-render only the affected frames, then judge again. Stop when the evidence says
   the film works, not when the render command exits 0. A defect found twice is a missing rule: write it into this file.
4. **Checklist.** Text readable at phone size; nothing crossing the safe area; real product assets, not invented ones; consistent
   type and colour; no awkward mid-transition frame; cuts and sound cues land together; a real hook in the first two seconds;
   the last frame works as a poster.
5. **Every format reviewed on its own**, not by cropping the wide one.
6. **A single-frame pop is a defect.** A frame that differs from both neighbours while they resemble each other (a z-index
   flash, a one-frame state flip, a layer blinking, a white flash at a seam) is found by diffing consecutive frames, not by eye.
7. **Maker and checker are separate.** The pass that built the film does not decide it is good; a separate pass reads the frames. A repair loop has a
   machine-checkable stop rule (the gates read clean), a round cap, and an abort when a round fixes nothing. Taste is not delegated: a person approves
   the storyboard or the still frames before the full render. Write a gate's failure message so it contains the fix.
8. **Read swaps at 5 frames per second.** For each 5-second part, `ffmpeg -ss S -t 5 -i film.mp4 -vf "fps=5,scale=400:-1,tile=5x5" sheet.png`, and read
   every frame of every word, card and scene swap for overlap, pre-shown elements and text on busy ground.

