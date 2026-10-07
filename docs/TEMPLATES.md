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

## Where templates live (decision, 2026-10-07)

**Templates are code and stay in Git, not in R2.** A template is a HyperFrames composition
(`worker/templates/<id>/`) that must match its typed catalog entry (`packages/contracts/src/templates.ts`) and the
planner's AI-fill rules. All three ship together:

```text
Git commit ─▶ worker/templates/<id>/ + packages/contracts/src/templates.ts + themes + fonts
          ─▶ npm run templates:verify / npm run previews  (catalog ↔ HTML ↔ every theme)
          ─▶ baked into the backend image (Dockerfile copies worker/templates, themes, fonts) and the worker image
```

Why not R2:

- **One version everywhere.** The backend (live preview, render-folder builder) and the worker must use the same
  template as the catalog the planner validated against. In the image, they cannot drift; fetched from a bucket, a
  template could change under a running render or between preview and render.
- **Reviewed and tested.** Template changes go through a PR, `templates:verify` and the 64-render preview check, and roll
  back with the deploy. A bucket upload skips all of that.
- **Small.** `worker/templates`, `worker/themes` and `worker/fonts` total about 1.5 MB; there is no size reason to move
  them.
- **Templates are not user data.** R2 is for per-user, private, growing content: screenshots, logos, fonts users upload,
  generated audio, rendered video.

What does go to R2, when we get there:

| Case | Where | How |
| --- | --- | --- |
| Large media a template uses (stock video loops, pre-rendered 3D, Lottie packs, music beds) | R2, a shared read-only `templates/` prefix (or bucket) | Content-addressed keys (`templates/assets/<sha256>.<ext>`), immutable; the template's catalog entry lists the hashes, so Git still pins the exact version. The render-folder builder downloads them like other inputs. |
| User-saved templates or brand-specific variants | Postgres (`app.templates`: owner, base template id, version, variable values / overrides) | Only data and references to Git templates; never user-authored HTML or JS, which would be untrusted code in the renderer. |
| Template gallery stills | Git today (`npm run previews`); R2 or the Vercel CDN if they grow | Generated artifacts, regenerable from the templates. |

### Skills and reference packs sent to Claude

Skills and reference material that Claude reads at runtime are **prompt code**: they change what Claude writes as much
as a code change does. They follow the same rule as templates: Git, compiled into the image, never fetched at runtime.

How it works today: `npm run director:prompt` (`scripts/build-director-prompt.mjs`) compiles chosen skill files
(`.claude/skills/gm-skill-authoring/references/script-for-motion.md`, `watchability.md`,
`gm-script-director/references/routing.md`, `motion-direction.md`) into
`backend/src/plan/director-prompt.generated.ts` (about 18 KB), which the backend's director sends to Claude. The skill
and the prompt cannot drift, and every deploy pins the exact text.

Rules for adding more (for example the packs in `third_party/creative-packs/`; the full plan for them and for
Anime.js, Rough.js and p5.js is [Creative library plan](CREATIVE_LIBRARY_PLAN.md)):

1. **Curate, don't ship zips.** Unpack, keep only what improves the output, and store it as Markdown under
   `.claude/skills/<skill>/references/` (or a `prompts/` folder). Whole packs cost tokens on every call and dilute the
   instructions.
2. **Add the file to the build script** so it is compiled into the backend like the four above; rerun
   `npm run director:prompt` and commit the generated file.
3. **Check it moved quality** on a fixed set of briefs before and after (a prompt change is a behaviour change).
4. **Licence.** Only send material we may use in a hosted product. The packs in `third_party/creative-packs/` are confirmed free to use
   (owner, 2026-10-07). Ideas only, never copied code, from sources whose licence forbids hosted use.
5. **Cache it.** The skill text is a stable prefix, so mark it with Anthropic prompt caching; repeated plans then pay a
   fraction of the input cost for it.

**Which service calls Claude.** Claude is called by the backend (planner, director, revisions), never by the render
worker: the worker has no model key by design, because it runs Chromium on generated HTML. If Claude writes HyperFrames
code, do it in the backend (or a separate composer step), validate the result with `hyperframes check` and the
template/catalog rules, and send only the finished composition folder to the worker. The skills therefore live in the
backend image, not the worker image.

## Known limits and follow-ups

- Scenes live in one HTML file. HyperFrames recommends one sub-composition per scene for a cleaner Studio timeline (lint warns); worth doing before the Pro/Studio tier.
- The Feature spotlight callout has a fixed position; it should become `x`/`y` variables when screenshots are user-supplied.
- Landscape only; portrait layouts are VAL-02.
- No audio yet; voiceover and music follow the media pipeline.
- Bundled fonts are Latin subsets. Icons in templates are inline SVG, never text glyphs (a `✓` rendered as an empty box and `hyperframes check` did not flag it). The worker image includes DejaVu as a system fallback so unusual characters in generated copy degrade to a plain font instead of boxes; non-Latin scripts need their own font subsets.
