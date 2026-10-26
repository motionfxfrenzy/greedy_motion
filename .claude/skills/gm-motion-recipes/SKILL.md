---
name: gm-motion-recipes
description: Greedy Motion's own library of atomic HyperFrames motion recipes that the vendored hyperframes-animation rules lack — line-boil (a living hold for ink and drawn styles), glow-flyline (data-flow arcs with a same-frame landing pulse on a dark ground), scroll-brake (a long list streaks past and brakes onto one entry), camera-rig (one log-space camera per scene), spring-settle (closed-form springs and the motion-weight classes), flood-handoff (a colour flood that carries the words from one object to the next). Each ships a verified example and a rule. Use when a scene needs one of these effects, or when adding a new recipe to this library.
metadata:
  internal: true
---

# gm-motion-recipes

Our recipes live here, not in `hyperframes-animation/rules/`, because that folder is vendored and is re-copied
on every HyperFrames upgrade. Same contract as those rules: one paused GSAP timeline on `window.__timelines`,
seek-safe in both directions, deterministic, transforms and paint-only properties, no CSS `transition`
(the contract is spelled out at the top of `hyperframes-animation/rules-index.md`).

| Recipe | Does | Rule | Example |
|---|---|---|---|
| `line-boil` | Re-traces outlines every 3 frames while nothing else moves: a living hold for ink and drawn styles | `rules/line-boil.md` | `examples/line-boil.html` |
| `glow-flyline` | A glowing arc is shot from one card to the next, then the landing pulses the card and surges the nearest orb on the same frame | `rules/glow-flyline.md` | `examples/glow-flyline.html` |
| `scroll-brake` | A long list streaks past as a blurred band and brakes onto today's entry; optional overshoot plus corner brackets that clamp on the brake frame | `rules/scroll-brake.md` | `examples/scroll-brake.html` |
| `camera-rig` | One camera per scene: a single transform on a world container from keys of `[time, zoom, x, y]`, zoom interpolated in log space | `rules/camera-rig.md` | `examples/camera-rig.html` |
| `spring-settle` | Closed-form damped-spring ease (stateless, seek-safe) and the weight classes that say which object gets which spring | `rules/spring-settle.md` | `examples/spring-settle.html` |
| `flood-handoff` | A colour floods out of a button in 0.35 s carrying its words, then folds into the next object and hands over on one frame | `rules/flood-handoff.md` | `examples/flood-handoff.html` |

## Use a recipe

1. Read its rule first (when it fits, when it does not, the parameters, the constraints that are specific to it).
2. Copy the mechanism from the example into the scene's sub-composition. The examples are single files for
   readability; in a film each scene is a sub-composition (`hyperframes-core`), which is why `check` prints one
   `nested_structure_needs_subcomposition` note on them.
3. Retune on the real content. The upstream parameters were tuned on placeholder assets.
4. Run the gates below on the finished scene, not only on the example.

## Verify (the same gates a film must pass)

```bash
node .claude/skills/gm-motion-recipes/scripts/verify_example.mjs line-boil          # one example, every gate
node .claude/skills/gm-motion-recipes/scripts/verify_example.mjs path/to/scene.html  # your own scene file
```

`verify_example.mjs` builds a throwaway project (pinned GSAP in `vendor/`) and runs `hyperframes check`,
`gm-skill-authoring/scripts/seek_safety.mjs` (the same frame whatever order the playhead arrives in) and
`gm-skill-authoring/scripts/text_size_gate.mjs` (legibility floors), then saves screenshots. Add the pacing gate
on a render: `python3 .claude/skills/gm-feature-explainer/template/tools/pacing_gate.py <render.mp4>`, the pop gate
(`node .claude/skills/gm-skill-authoring/scripts/pop_gate.mjs <render.mp4>`) and a look at the seam sheet
(`scripts/seam_sheet.mjs <render.mp4> --auto`).

Measured 2026-10-08 on a Mac (render times are 1080p, 30 fps, `hyperframes render` defaults):

| Example | Length | Render | `check` | Seek safety | Text floors | Pacing (held at 0.6 s / longest hold) |
|---|---|---|---|---|---|---|
| line-boil | 6.0 s | 8.5 s | 0 errors | pass | pass | 0.0% / 0.6 s (boil off: **89.5% / 5.37 s, fail**) |
| glow-flyline | 3.6 s | 5.6 s | 0 errors | pass | pass | 0.0% / 0.5 s |
| scroll-brake, mode A | 3.0 s | 7.5 s | 0 errors | pass | pass | 0.0% / 0.5 s |
| scroll-brake, mode B (`LOCK`) | 3.0 s | 6.3 s | 0 errors | pass | pass | 0.0% / 0.567 s |
| camera-rig | 4.4 s | ~9 s | 0 errors | pass | pass | 0.0% / 0 s; pop gate 0 pops |
| spring-settle | 2.45 s | ~6 s | 0 errors | pass | pass | 0.0% / 0 s; pop gate 0 pops |
| flood-handoff | 2.75 s | ~6 s | 0 errors | pass | pass | 0.0% / 0.4 s; pop gate 0 pops, 0 cuts |

## Adding a recipe

Write `rules/<name>.md` (frontmatter `name`, `description`, `metadata.tags`), put a runnable `examples/<name>.html`
beside it, and do not call it done until `verify_example.mjs` passes, the render passes the pacing gate, and you
have looked at frames at the moments that matter (not only the first and last). Record anything the browser or
GSAP did that you did not expect in the rule's constraints; two of the three recipes here found a real gotcha
that way. Credit any source in `ATTRIBUTION.md`.

Provenance and licences: `ATTRIBUTION.md`.
