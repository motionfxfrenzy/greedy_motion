# Starter templates

Date: 2026-10-03. Status: four templates implemented and verified locally. Templates give users a quick start: pick a structure, describe the product, and Claude writes the copy for every scene.

## User flow

1. **Template** (first field in the brief form): opens a gallery with a preview frame, "best for", description, a five-scene strip, and scene timings. Choosing one fills in its example brief and its suggested theme.
2. **Describe your product**: free text; "Use the example" restores the template's example brief.
3. **Theme**: any of the 16 themes, independent of the template.
4. Before rendering, the preview shows a real frame of the template and the storyboard lists its scenes with default copy.
5. **Make local preview**: Claude fills the template's fields, the worker renders the 10-second MP4.

## Catalog

| Template | Best for | Scenes | Default theme |
| --- | --- | --- | --- |
| Product launch | Announcing a product or relaunch | Hook (2s) · Product reveal (2s) · Three features (2s) · Benefit (2s) · CTA (2s) | Neutral |
| Feature spotlight | One feature with a real screenshot | Headline (2s) · Screenshot push-in (2s) · Callout (2s) · Benefit (2s) · CTA (2s) | Blue Professional |
| Stat highlight | One proof point or metric | Setup (2s) · Count-up (3s) · Why it matters (2s) · Source (1s) · CTA (2s) | Bold |
| What's new | Release notes and changelogs | Version (2s) · Title (2s) · Three updates (2.5s) · Closing line (1.5s) · CTA (2s) | Code Editorial |

All templates are 1920×1080, 30 fps, 10 seconds, and use only theme tokens, so every template works with every theme.

## Motion-background template family (planned)

Add a premium visual family alongside the functional starter templates. These templates take their color palette from the selected brand kit or Relay theme and use controlled motion treatments rather than asking users to design gradients themselves.

| Style | Visual language | Best use |
| --- | --- | --- |
| Soft gradient | Animated mesh gradients, soft bloom, restrained grain, typography-led composition | Calm launches and brand stories |
| Glass and depth | Translucent cards, blurred surfaces, floating screenshots, slow parallax | Premium feature announcements |
| Bold kinetic | Saturated gradient fields, fast type, masks, high-energy scene changes | Social launch clips and announcements |
| Editorial texture | Warm gradients, paper grain, halftone or print texture, spacious type | Founder updates and narrative explainers |
| 3D showcase | Layered 2.5D UI planes, simulated camera moves, optional Three.js or pre-rendered 3D assets | Flagship campaigns and hero videos |

Simple users choose a style, mood, and depth level. The template owns technical settings such as gradient stops, blur amount, camera movement, particles, and transition timing. The Studio tier may expose those settings to professionals after the composition passes layout and contrast checks.

## How a template is built

Each template is a real HyperFrames composition in `worker/templates/<id>/index.html`:

- **Variables** are declared on `<html data-composition-variables='[...]'>` with type, label, description, `maxLength`/`min`/`max`, and a default. Text binds with `data-var-text="id"`, media with `data-var-src="id"`. Logic that needs values (the stat count-up) reads `window.__hyperframes.getVariables()` once.
- **Theme** comes from CSS custom properties (`--bg`, `--fg`, `--brand`, `--font-display`, …) injected by the worker; templates never hard-code colors or fonts. Variable ids must not collide with theme token names.
- **Timing**: five scene clips with `data-start`/`data-duration`; one paused GSAP timeline registered at `window.__timelines["main"]`.
- **Text fit**: `max-width` and wrapping for copy; `__hyperframes.fitTextFontSize` for the stat number so even `$100,000,000+` stays on one line.

Because templates use HyperFrames' own variables, the same files work with `render --variables`, the embedded player, Studio, and the SDK ([Editing](EDITING.md)).

## Where the AI may write

`packages/contracts/src/templates.ts` mirrors each template's variables and adds an `aiFill` policy:

| Policy | Meaning | Examples |
| --- | --- | --- |
| `write` | Claude drafts copy from the brief | hook, tagline, features, headline, CTA |
| `extract` | Claude may only copy a value the brief states; otherwise the default stays for the user to replace | statistics, units, sources, URLs |
| `never` | Not sent to the model; the user supplies it | screenshot |

`clearWhenSet` ties defaults together: when Claude extracts `$48,000`, the template's default `%` suffix is cleared instead of producing `$48,000%`.

The planner sends Claude a tool schema generated from the catalog. The backend re-validates the result; if any field breaks a limit, Claude gets one repair attempt listing every problem (this was needed in testing: a 73-character line for a 72-character slot).

## Render path

Backend → worker: `{ id, template, theme, variables }`. The worker validates ids against its folders, copies the template, injects bundled fonts and the theme, writes the values to a file, and runs `hyperframes render --variables-file … --strict-variables`, so HyperFrames itself rejects undeclared keys and wrong types.

Image values from callers are ignored until verified uploads exist (MEDIA-01); the Feature spotlight template uses its bundled placeholder screenshot.

## Quality gates

| Command | What it checks |
| --- | --- |
| `npm run templates:verify` | Catalog and HTML variable declarations match (ids, types, defaults, limits), every scene references real variables, every variable is used |
| `npm run previews` | Renders gallery stills with the real renderer and runs `hyperframes check` (lint, runtime, layout, WCAG contrast) for every template × theme (4 × 16 = 64); exits non-zero on any failure |

## Add a template

1. Create `worker/templates/<id>/index.html` (copy an existing one). Use theme tokens only; declare every variable with a default and limits.
2. Add the matching entry to `packages/contracts/src/templates.ts`: scenes, variables with `aiFill`, default theme, preview moment, example brief.
3. `npm run templates:verify`.
4. `docker compose build worker && npm run previews <id>` and fix any failed theme.
5. Render once from the UI with the example brief and review the MP4.

## Known limits and follow-ups

- Scenes live in one HTML file. HyperFrames recommends one sub-composition per scene for a cleaner Studio timeline (lint warns); worth doing before the Pro/Studio tier.
- The Feature spotlight callout has a fixed position; it should become `x`/`y` variables when screenshots are user-supplied.
- Landscape only; portrait layouts are VAL-02.
- No audio yet; voiceover and music follow the media pipeline.
- Bundled fonts are Latin subsets. Icons in templates are inline SVG, never text glyphs (a `✓` rendered as an empty box and `hyperframes check` did not flag it). The worker image includes DejaVu as a system fallback so unusual characters in generated copy degrade to a plain font instead of boxes; non-Latin scripts need their own font subsets.
