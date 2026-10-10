# Starter templates

> Current implementation and live infrastructure: [Application, infrastructure and storage guide](SYSTEM_GUIDE.md). This document also contains historical plans; consult the guide and [release status](MVP_RELEASE_STATUS.md) for the October 8, 2026 production topology.

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

## Template gallery (starting points)

Date: 2026-10-10. The Templates page, the Projects empty state and the landing page's "Start creating" section show one
catalog of starting points. For a person they are all the same thing: a finished example to build on. Choosing one fills
in the script prompt, the structure skill, the look and theme, and the starting length, aspect and sound. Length and
aspect are only starting values: they change with the script on Script & style, so the cards do not state them.

| Part | Where it lives |
| --- | --- |
| Catalog (names, prompts, looks, grouping by use case) | Git: `packages/contracts/src/gallery.ts`, `gallery-opus.json`, `style-library/catalog.json`. Reviewed and versioned with the code that reads it. No database table: nothing here is per user. |
| Preview clips (5 s, muted, looping) and posters | R2, `gallery/<id>.<sha256 prefix>.mp4\|webp` in the media bucket. Content-addressed, so cached for a year (`immutable`). Posters are WebP. |
| Serving | `GET /v1/gallery/:name` (open route, `backend/src/gallery.ts`) streams from the private bucket with Range support. Locally it reads `var/gallery`. |
| Illustration reference frames, theme stills, the four starter stills | Git (small; the style library build freezes them): `third_party/anidoodle/references`, `frontend/public/themes`, `frontend/public/templates`. |

**Browsing.** Groups are by use: SaaS & product, Explainers & learning, Brand & social, Story & film, Hand-drawn & minimal,
Colour themes (`galleryUseCases` and `useCaseOf`). Every style in the style library, every colour theme and every remade
prompt is also a template, so there is one grid and one search.

**Previews are real.** `node scripts/build-gallery-previews.mjs` renders each 5-second clip on this machine with the
beat-plan engine, the template's look and theme and a short authored plan (`scripts/gallery-plans.mjs`,
`scripts/gallery-opus/plans.json`). No cloud, no model keys. Generated looks (paper, clay, collage, illustration) cannot
be drawn natively: their card shows a layout draft or a reference frame and says so.

**Publishing.** `node scripts/publish-gallery.mjs` hashes and posterises the files, uploads them (skipping any already
present) when `R2_ENDPOINT`, `R2_MEDIA_BUCKET` and the access keys are set, otherwise copies them to `var/gallery`, and
writes `packages/contracts/src/gallery-previews.json`. Commit that manifest with the catalog.

**Remade prompts.** The 65 `opus-*` templates are our own rewrites of public prompts from the awesome-opus collection
(MIT), each credited to its author with a link. We rebuilt the idea; no creator media is copied or hotlinked. The pool was
350 motion and explainer prompts; games, 3D and physics demos, music-only and vague prompts do not fit a product video and
were left out. `scripts/merge-gallery-opus.mjs` validates the rows.

**Illustration styles.** The 31 anidoodle styles (Apache-2.0, `third_party/anidoodle`) are generated looks in the style
library, each with its rendered frame as the style reference. They use the existing generated-footage path (confirmed
budget, shared style key). Generated fidelity is not yet verified, as for the paper and clay looks.

### Adding a template or a style

Everything below is run from the repository root. Previews render locally (free). Only the final publish step touches R2.

| You want to add | Do this |
| --- | --- |
| **A template** (a ready example with its own prompt) | 1. Add an entry to `curated` in `packages/contracts/src/gallery.ts`: `id`, `name`, `group`, `summary`, `bestFor`, `prompt` (an example brief, 600 characters at most, no invented numbers), `look`, `theme`, and the starting `durationSeconds`, `aspect`, `motionProfile`, `pace`, `audio`. Set `skill: "gm-feature-explainer"` or similar only when it needs a structure skill. 2. Add a 5-second plan under its `id` in `scripts/gallery-plans.mjs` (three or four beats; copy an existing one). 3. Render and publish (below). `group` decides where it appears (`useCaseOf`): Launch, Feature, Product, Proof, Release → SaaS; Explainer, How-to, Data → Explainers; Showreel, Typography, Social → Brand; Story, Paper, Clay, Illustration → Story & film. |
| **A template from a public prompt** | Add a row to a `scripts/gallery-opus/output-N.json` file (same keys as the existing rows, including `plan`), then `node --experimental-strip-types scripts/merge-gallery-opus.mjs`. It validates every row, lists the ones it drops and why, and writes `gallery-opus.json` and `plans.json`. Credit the author in `source`. Rewrite the idea in your own words; do not copy their text or media. |
| **A style (look)** | Add an entry to `packages/contracts/src/style-library/catalog.json` (see `docs/STYLE_LIBRARY.md`) and, for a generated look, a reference image under `third_party/<pack>/references/` listed in `scripts/build-style-library.mjs`. Run `npm run styles:build`. The style becomes a template (`style-<id>`) on its own, with a preview if it is native. A native look also needs its drawing treatment in `worker/templates/beat-plan/engine.js`. |
| **A colour theme** | Add it to `packages/contracts/src/themes.ts`, run `npm run themes:build` and `npm run previews`. It becomes a template (`theme-<id>`) automatically. |
| **A new illustration style** | Add its still to `third_party/anidoodle/references/illus-<name>.jpg` and its entry to `styles.gen.json`, then follow "A style" above. |

**Fix a card whose preview does not match its reference**

Give a Claude session the reference (4-8 frames, or an mp4 it can cut frames from; subagents cannot always open a web
page) and this prompt, with the three bracketed parts filled in. It rebuilds the card as a hand-built 5-second scene in
`scripts/gallery-scenes/<id>/` and checks it against the reference frame by frame.

```text
Rebuild the 5-second preview for the gallery card "[CARD NAME]" (template id: [ID]).

REFERENCE
[Attach 4-8 frames, or a path to a screen recording / mp4 of the reference.]
If it is a video file, extract frames with ffmpeg (every ~2 s, plus one at each scene change) and read them. Study:
1. The scene structure and order (what appears first, what comes next, how it ends).
2. The layout of each scene (where the type sits, how big it is, what fills the frame).
3. The palette, the fonts, and the material (flat vector, hand-drawn, print, 3D, UI mock).
4. How things MOVE: what draws on, slides, morphs, counts up, cuts or wipes, and the pace.
Use the reference only as a guide to look and motion. Do not copy its text, brand, logo, characters or media.
Invent your own fictional brand and copy.

WHAT THE CARD IS FOR
Name: [CARD NAME]   Look: [clean | sketch | doodle | hairline]   Theme: [theme id]
Prompt it should preview: [paste the template's prompt]

TASK
Hand-build a 5-second, 1280x720 HyperFrames scene in scripts/gallery-scenes/[ID]/:
- index.html, following scripts/gallery-scenes/README.md: one paused GSAP timeline on window.__timelines["main"],
  data-duration="5", seeded random only, no Date.now, no requestAnimationFrame, no CSS keyframes, no network.
- row.json containing exactly {"poster": <best second>, "previewOnly": true}.
Render: node --experimental-strip-types scripts/build-gallery-scenes.mjs [ID]

COMPRESS THE REFERENCE'S ARC INTO 5 SECONDS
Keep its scene order and visual language, cut to the essential moments: about 3-4 beats of 1-1.5 s. The first 0.4 s
must already show something; the last 0.5 s holds the finished frame. Nothing is a still picture with a fade: things
must draw, assemble, move, morph or cut. Big type, few words, readable at 480 px wide.

LOOK RULES
- clean: polished vector and type motion.
- sketch: every element hand-drawn with seeded wobble and jitter, strokeDashoffset draw-on, cream paper, notebook serif.
- doodle: rounded Fredoka marker strokes, bouncy, warm paper.
- hairline: fine thin lines, lots of white space, high-contrast serif, one accent colour.
A drawn look stays drawn on every beat, including the text.

VERIFY (required)
Render, extract frames at 0.4, 1.4, 2.6, 3.8 and 4.7 s, and look at each. Put the reference frames next to them and
compare: same structure, layout, palette, type and kind of motion? Fix every difference and render again. Stop only
when someone who knows the reference would call it the same kind of video.
Touch only scripts/gallery-scenes/[ID]/ and var/gallery-src/[ID].*.
Report what matches the reference and what does not.
```

Then publish with the commands below (`merge-gallery-scenes.mjs` is not needed for a `previewOnly` scene).

**Render and publish a preview**

```sh
# render (local, free): all, or only the ids you name
node --experimental-strip-types scripts/build-gallery-previews.mjs [id ...]
# publish: R2 when credentials are in the environment, else var/gallery for local dev
set -a; . ./.env.credentials; set +a
R2_ACCESS_KEY_ID=$R2_ADMIN_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY=$R2_ADMIN_SECRET_ACCESS_KEY \
GALLERY_BUCKETS=greedymotion-staging-media,greedymotion-production-media \
node --experimental-strip-types scripts/publish-gallery.mjs
```

Then commit `packages/contracts/src/gallery-previews.json` with the catalog change. The publisher is idempotent: files already
in a bucket are skipped, and each file's name contains its content hash, so a re-render never overwrites what a deployed
release is showing. Old files can be deleted from `gallery/` once no deployed release references them.

**Checks before you commit.** `npx tsc --noEmit -p packages/contracts`, `npx tsc --noEmit -p frontend`,
`npx tsc --noEmit -p backend`, and `node --experimental-strip-types scripts/build-style-library.mjs --check` if you
touched the style library. Open the Templates page and look at the new card: the preview should show your idea, not generic
filler, and the group should put it where a person would look for it.

**What is deliberately not on the card.** Length, aspect ratio, sound and render time. They come from the person's script
and are changed on Script & style; the template only supplies starting values (`galleryBrief`).

### Gallery API and delivery (paging runs on the backend)

The browser never holds the catalog. The Templates page, the Projects empty-state row and the landing page ask the backend:

| Route (open, cacheable) | Returns |
| --- | --- |
| `GET /v1/gallery/templates?use_case=&q=&cursor=&limit=` | One page of cards (`id`, `name`, `group`, `summary`, `preview`, `source`, `generated`, `useCase`), `total`, `nextCursor`, and `counts` per use case for the current search. `limit` is 1–48 (default 24); `cursor` is the offset. `featured=1` returns the landing page's four. |
| `GET /v1/gallery/templates/:id` | The starting values for the chosen template: example prompt, skill, look, theme, duration, aspect, motion, pace, audio, captions. Fetched only when someone picks it. |
| `GET /v1/gallery/:name` | A preview clip or poster, streamed from R2 with Range support and `Cache-Control: public, max-age=31536000, immutable`. |

Filtering, search and counts are `queryGallery` in `packages/contracts/src/gallery.ts`; the route is `backend/src/gallery.ts`. The
frontend imports only types plus the small `@videosaas/contracts/gallery-use-cases` module, so the catalog is not in its bundle.

**Sizes.** Previews are delivered at 480 px wide, 24 fps, no audio (H.264, `-tune animation`, CRF 30): about 39 KB per
clip (71 KB at most), posters WebP at about 10 KB. All 115 previews are 4.7 MB in total. Cards load posters lazily; a clip
loads on hover (or while visible on touch screens), never on page load (`preload="none"`).

**Where it lives.** R2 `gallery/` in `greedymotion-staging-media` and `greedymotion-production-media` (published 2026-10-10 with
the admin credential in `.env.credentials`; the buckets stay private and the backend streams). No Cloudflare zone is on the account, so
there is no CDN hostname; if one is added later, the files can be served from it unchanged because their names are
content-addressed. A deployed backend needs `STORAGE_DRIVER=r2` and the media bucket variables it already has; no new variable.

**Projects empty state.** One row of up to ten cards that scrolls sideways and fades out on the right, with a brand-gradient
"Explore more →" button (scrolls; at the end it opens the full Templates page) and a left arrow after scrolling. "Browse all
templates" stays in the header.

### Use cases, distinct styles and the two versions of a style (2026-10-10)

People browse by what the video is for (`galleryUseCases`, `useCaseOf`):

| Use case | What is in it |
| --- | --- |
| SaaS & product | Everything the beat-plan engine already did well: the starters, product explainers, remade prompts, the drawn styles (clean, sketch, doodle, hairline) and a **product version** of every handmade style. |
| Explainers & learning | Distinct teaching styles, each its own hand-built scene: maths in the dark-board tradition, tech diagrams, flat vector, whiteboard and stick figure, blackboard, kinetic type, screencast and code, data and maps. |
| Brand & social | Showreels, type-led clips, short social formats. |
| 3D & cinematic | Three.js scenes: product spin, keyboard exploded view, snow-globe city, data-centre fly-through, zoom into a chip, procedural planet, particle logo, isometric diorama, low-poly terrain. |
| Story & film | A **story version** of every handmade style we can animate from code (editorial collage and the 31 illustration styles). Paper, origami and clay are parked in `experiments/generated-art-styles` until they can be produced for real: the whole scene, full frame, with a caption. |
| Colour themes | Palette and type starting points. |

A person never sees which engine is underneath. The style versions, the scenes and the engine templates all end up as a brief
(prompt, look, length, sound) in the same Script & style form.

**Two versions of a style.** `scripts/build-gallery-styles.mjs` renders, for each generated look that has real art, a
`story-<look>` clip (the whole scene, alive: the art itself breathes, sways and warps like boiling hand-drawn lines, light drifts across it and specks float through it, with no caption over the picture) and a `saas-<look>` clip (the same art behind a
product screen, headline and button, the way the pipeline composes generated footage under native text and screenshots). Art
is `third_party/gallery-art` (two frames of our own editorial
explainer film) and `third_party/anidoodle/references` (illustration styles). A style with no safe art is left out of the gallery
(the paper diorama has none; the torn-paper reference shows real people and a trademark, so it is not used). The rows
are written to `packages/contracts/src/gallery-styles.json`.

**Alive, not animated.** The story clips move the supplied still: a seeded displacement warp, a sway from the feet, a camera push, light and specks, all pure functions of time (plain timeline tweens; transforms must not be set from an update callback, which breaks under parallel frame capture). It makes a still feel alive; it does not make a character walk. Real character motion needs an authored film (a few anidoodle styles have one) or generated video.

**Hand-built scenes.** `scripts/gallery-scenes/<id>/` holds one preview each (an `index.html` composition and a `row.json`);
`scripts/gallery-scenes/README.md` is the contract. Render with `scripts/build-gallery-scenes.mjs <id>`, collect with
`scripts/merge-gallery-scenes.mjs`, which validates each row, requires a rendered clip and writes `gallery-scenes.json`. To add a
scene: copy a similar folder, change the idea, give it a `row.json` (`group` decides its use case), render, merge, publish.

**Honest limit.** A scene preview shows the style we aim for. Making a video in that style from a person's own script depends on
the hosted author path writing a composition in that style; the brief preset (prompt, look, length, sound) is what the
form starts from. Check a generated film against its preview before promising a style to a customer.

## Reference code for hand-built previews

Every hand-built preview keeps its source: `scripts/gallery-scenes/<id>/index.html` (a self-contained HyperFrames
composition: GSAP timeline plus canvas/SVG/DOM, no network). `scripts/publish-gallery.mjs` uploads it next to the clip as
`gallery/<id>.<sha8>.html` and records it as `reference` in `gallery-previews.json`. The backend serves it as
`text/plain` (never as a page) at `/v1/gallery/<name>`, and `GET /v1/gallery/templates/:id` returns
`reference: { name, url }` with the brief. So when someone clicks "Use this", the reusable pieces of the look (the type wall,
the paper shards, the morphing card, the collage elements) are available to the author as working code to adapt, not
something to rewrite. Wiring that reference into the hosted author's prompt is the next step; today it is published and
returned with the brief, not yet read by the author.
