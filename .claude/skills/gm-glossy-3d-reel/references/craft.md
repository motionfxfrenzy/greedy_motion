# Craft: the glossy studio

Shared determinism, audio and render rules: `.claude/skills/gm-skill-authoring/references/shared-craft.md`.

## The world

- **One Three.js scene and one camera rig for the whole film.** Shots are camera keyframes in the
  same world, which is what makes rule two achievable.
- **Ground and fog:** the `canvas` token at the horizon, fading to the `surface` token. Never pure
  white (`#fff`), or the specular highlights have nowhere to go.
- **Light:** a large soft key from top-left, a big diffuse fill, and a faint rim. No hard shadows;
  soft contact shadows only.
- **Materials:**

| Material | Use | Notes |
|---|---|---|
| Glossy white | Most props, keycaps, cards | roughness 0.25–0.35, clearcoat |
| Satin accent | 1–2 objects per shot | Check the rendered hex against the token |
| Mark colours | The mark only | Taken from the logo file, which may differ from the token |
| Soft grey | Secondary props | Keeps the accent rare |

- **Depth of field and motion blur:** accumulate 8–16 sub-frames per frame for real blur. This
  costs render time on CPU, so measure it (shared-craft → rendering).

## Type over 3D

- **Words that only sit in 3D space** (orbit ring, keycaps) use extruded geometry built from the
  bundled font, measured after load.
- **Words the viewer must read** (headline, pills, labels, closing line) are HTML over the canvas:
  crisp, brand fonts, editable in fill mode.
- **Never** let a word be the only thing in frame while it is blurred by depth of field.

## Rule one: accent audit

Sample one frame per beat. For each, count the objects whose rendered colour is within ΔE 10 of
the accent. Pass if the count is ≤ 2 in every frame (the mark's own wedge counts as one).
Paste the table into the handoff.

## Rule two: camera seams

Ledger row shape (same as the velocity-sting ledger):

```json
{ "id": "verb → ring", "cut": 4.999, "technique": "match-cut: accent key becomes the mark's wedge",
  "exit": { "selector": "#key-last", "axis": "z", "dir": 1 },
  "entry": { "selector": "#mark-wedge", "axis": "z", "dir": 1 } }
```

To verify a seam, take the frames at f−2, f−1, f and f+1:

1. Both sides are moving on the named axis and sign.
2. No frame has 90% or more of its pixels within ΔE 5 of the ground colour (the "empty whip"
   defect).

## Hybrid (optional): video-model plates

Use these only when the brief needs richer materials than the Three.js studio gives.

- Generate **text-free, logo-free** plates (Veo 3.1 fast, 8s, first/last-frame from a Nano Banana
  keyframe). The measured cost is about $0.96 per 8s plate at 1080p, and about 70% of it is
  trimmed.
- Place each plate as a `<video>` layer **under** the HTML type, with an `id` and no 3D CSS
  ancestor.
- The camera direction in the plate prompt must match the ledger row's axis and sign.
- Log the model, prompt file and cost in `COST.md`. The skill must still pass without plates.
