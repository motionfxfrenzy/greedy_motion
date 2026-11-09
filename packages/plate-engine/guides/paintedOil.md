---
# Heavy (320 lines): 32 KB plate + kit combining 3D surface normals, four-value plane modelling, lost/found edge clips, and 20+ lean-to-fat bristle stages.
tier: heavy
lines: 320
example: plate-excerpt
---

# Oil on canvas

*Advisory guide: the notes below explain how `paintedOil` and `paintedOilKit` build this medium; the plate source is the authoritative recipe, and subject/staging notes are advisory.*

## Medium, mark by mark
Opaque oil paint laid with hog-bristle flats and filberts on a stretched plain-weave linen canvas primed lead-white (#efe8da) and multiplied with `weave(g, 0.55)` in the ground and `weave(g, 0.3)` at the finish.
Every mark is an `OStroke` drawn by `oilStroke`: a flat bristle stroke that lands square or feathered in, drags along a spline (`smooth`, `resample`), splits into individual bristle hairs as its paint load runs out, grooves its interior with `fractal` noise, and pushes up impasto ridges along both edges — catching a thin warm light (`lighten`) on the side facing `LIGHT` and a thin dark shadow (`darken`) on the side turned away.
The painting is built strictly from lean to fat in painter's order:
1. **Imprimatura:** a thin warm rub of sienna-umber (alpha < 1, impasto 0) scrubbed diagonally across the primed linen so the white ground breathes through.
2. **Umber underdrawing:** searching contour and placement strokes with a small round brush (width 2.6..3.6, alpha 0.78) in burnt umber, plus loose dry scrubs marking cast-shadow zones.
3. **Dark masses and background block-in:** a big flat brush (width 74..130) lays broad directional passes (`fill`) across the back wall, table front, and tabletop with the background clipped out of the focal silhouettes (inset by a few pixels so background paint tucks slightly under object edges), followed by the shadow sides of the focal forms.
4. **Mid-tones and reflected light:** broad scumbles for the window glow on the wall, the lit table plane, form half-tones, and crisp-to-soft cast shadows.
5. **Lit planes and wet-into-wet blending:** fatter paint (impasto 0.22..0.3) on the lit planes, followed by short cross-boundary drags carrying colour from one value plane into the next wet-into-wet.
6. **Reflections, speculars, and dark accents:** deliberate small-brush strokes for sky/gold reflections, rolled rims, thick impasto glints (impasto 1, load 1.4), stems, and tucked contact shadows.

## What is alive in the template
The template film is a long hand-paced sequence; a single scene should keep ONE of its signature motions (such as hog-bristle strokes dragging wet-into-wet across the focal form and settling with impasto ridges) rather than twenty separate painting stages.
- **Camera and staging:** the frame holds steady like an easel canvas while `timeline`, `fit`, and `runProcess` (from `sumiEKit`) pace the painting from bare linen to finished still life over the shot duration, holding the completed painting for the final ~30 frames so every brushstroke settles in view.
- **How marks settle and draw on:** strokes never fade in. `timeline` groups strokes into small batches and advances `oilStroke(g, s, p)` along each stroke's centreline (`p` from 0 to 1). While `p < 1`, the hog brush is actively dragging across the linen; when `p >= 1` and impasto > 0.25, `oilStroke` deposits the final curved ridge of paint where the bristle tips lift off.

## Depth layers and composition
Compose under one north window just out of frame on the upper left (`LIGHT`, 3D light vector) with a strict **brush-size and edge hierarchy**:
1. **Back wall and room depth:** huge flat strokes (width 96..130, step 80..96) in steep diagonal passes (`fractal`), darker away from the window and lifted by a mid-height scumble near the light.
2. **Table plane and front apron:** horizontal passes (width 52..96) graded from left light to right shadow, with elliptical cast shadows (`inside`) darkest where each object meets the wood and softening outward.
3. **Focal bodies of revolution and planes:** solid forms constructed around axes and cross-section ellipses (`profile`, `bounds`, `inside`), with strokes wrapping the 3D surface curvature via the path callback in `fill`. Model organic forms in four distinct value planes (core shadow, warm table bounce, half-tone, light) bridged by wet-into-wet drag strokes.
4. **Found and lost edges:** clip lit sides crisply to the object outline, but shift the clip polygon outward on the shadow side so dark form strokes drag across the dark background and lose the edge.

## Palette habits
A classical Chardin kitchen palette mixed via `mix`, `lighten`, and `darken`: lead-white priming (#efe8da), sienna-umber imprimatura (#9a6a44, #4a2c1a), warm dark wall umbers (#18130d to #74654c), ochre-walnut table tones (#2a1c10 to #d6aa72), deep red-brown to orange-gold copper (#100503 to #f8d488) with cool sky reflections (#c6cdca), and terre-verte to Naples-yellow fruit tones (#243019 to #f3e9b8) with a sienna blush (#b04428) and warm cream impasto glints (#fffdf6).

## Kit helpers (`paintedOilKit`, `sumiEKit`, `gallery`, and `core`)
- `oilStroke`: draws one `OStroke` flat bristle mark with per-hair paint depletion, wet-into-wet colour pickup, bristle grooves, and lit/shaded impasto ridges up to travel progress `p`.
- `fill`: populates a polygonal region (`Pass`) with jittered, sweep-sorted `OStroke` marks following either a direction angle or a 3D surface-wrapping path and a light-model colour function.
- `weave`: multiplies the cached procedural plain-weave linen canvas tile (with warp/weft crossings and slubs) over the main canvas.
- `lighten` / `darken` / `mix`: shifts a hex colour toward warm highlight (#fff3dc), deep umber shadow (#1b0f08), or interpolates between two hex colours (`t` in 0..1).
- `LIGHT`: the upper-left window light direction vector [-0.9, -0.44] used by `oilStroke` to orient lit and shaded impasto ridges.
- `profile` / `bounds` / `inside` / `smooth` / `resample` / `clamp`: builds smooth 1D radius profiles from knots, computes polygon bounding boxes and point-in-polygon tests, and resamples Catmull-Rom curves.
- `timeline` / `fit` / `runProcess` / `prog`: schedules timed drawing operations (`Op` in a `Proc`), binary-searches the pace factor so all strokes finish before the hold, and caches completed stages across frames.
- `Gfx` / `rng` / `fractal`: core drawing surface, seeded PRNG, and multi-octave Perlin noise for stroke-angle variation and surface grain.
