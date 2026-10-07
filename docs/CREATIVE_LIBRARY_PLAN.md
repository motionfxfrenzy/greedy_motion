# Creative library plan: reference packs and animation libraries

Date: 2026-10-07, updated 2026-10-08. Status: phases 0 and 1 built, the Sketch look (phase 4, first look) built, phase 2
1 of 3 formats built; phases 3 and 5 not started. Owner confirmed on 2026-10-07 that every pack is free to use in the product, and accepted the recommendations
in section 8 (move the packs; formats in the order velocity sting → chat to result → everywhere reel; Anime.js only where
it beats GSAP; Sketch first).

## Implementation status (2026-10-07)

| Phase | State | What exists | Evidence |
| --- | --- | --- | --- |
| 0. Housekeeping | Done | Packs moved to `third_party/creative-packs/` with `PROVENANCE.md`; the three `bs-hyperframes-*` skills also copied to `.claude/skills/` so agents can use them now | `templates/` no longer exists |
| 1. Library spikes | Done | `validation/creative-libraries/{anime-motion-path,rough-sketch,p5-brush}`; libraries pinned in `backend/package.json`; `scripts/creative-vendor.mjs`; notices in `third_party/creative-libraries-NOTICE.md` | `npm run check:creative`: each spike renders identical frames twice and different frames under two brands; frames inspected by eye; a real MP4 render of the Rough.js spike draws its ink |
| 4. Looks: Sketch | Done | `look` in the brief (`packages/contracts/src/looks.ts`, "Drawing style" in Script & Style, saved without replanning via `PATCH /plan { look }`); Rough.js inlined in the engine page; hand-drawn underline on the accent word and a ring around the clicked target, in brand tokens | Engine fixtures `engine-clean` / `engine-sketch` in `check:creative`; a real project rendered in both looks |
| Brand consistency | Done | Brand files rebuilt from the kit row (`restoreBrandFiles`); brand-token lint; brand-binding check; readiness warning for a website project without a kit | `test:brand-files`, `check:brand-tokens`, `check:creative`; see [Brand kits → Keeping the brand consistent](BRAND_AND_AUDIO.md) |
| 2. HyperFrames formats | 1 of 3 done | `gm-velocity-sting` library-ready: fill-mode template (every string a variable, every colour/font a theme token, no pasted measurements), `scripts/build-format.mjs` (template + slot values + brand kit), `scripts/verify-seams.mjs` (seam ledger checked by seeking the timeline); in `check:creative`. Not yet wired into the app's render path. Next: chat-to-result, everywhere reel | Builds #1 Greedy Motion and #2 Ledgerly (sample): check 0 findings, 6/6 seams, pacing pass after 2 fixes, −14.2 LUFS; see the skill's CHANGELOG and COST |
| 3. Shot direction | Not started | — | Needs paid Nano Banana / Veo runs (Motion pipeline T2, T4, T6) |
| 5. Ad formats | Not started | — | Product decision per format |

Findings from phase 1:

- Local `<script src="vendor/…">` libraries do render with HyperFrames 0.8.111 (checked with a real MP4); the engine
  still inlines Rough.js, like the engine itself, so the preview, the render folder and the worker need no extra files.
- p5.js is **LGPL-2.1** (Anime.js, Rough.js and p5.brush are MIT): ship it unmodified as a separate file, never bundled.
- p5.brush flushes strokes at the end of p5's draw cycle: draw through `p.redraw()` from the timeline, not by calling
  brush functions directly, or the last stroke is lost (seen and fixed in the spike).
- p5.brush marks are textured and translucent, so brand colours come out lighter: fine for illustration, not for
  brand-exact marks (use Rough.js or plain SVG there).
- The Sketch ring must stay readable on light and dark screenshots: it is drawn in the loud brand accent
  (`--bp-accent-on-brand`) over a halo in the card colour, from one seed so the two always align.
- Snapshots use the software GPU (`--no-browser-gpu`) so frame hashes do not depend on the machine.

This plan covers how the 14 packs (unpacked from `templates/`, now in `third_party/creative-packs/`) and three outside libraries (Anime.js, Rough.js and the
p5.js stack from ClaudeAnimationBase) become part of Greedy Motion. It builds on what already works rather than adding
a second system:

- the director and beat plan ([Product flow v2](PRODUCT_FLOW_V2.md)), which already route every beat to a producer
  (`.claude/skills/gm-script-director/references/routing.md`);
- the motion direction ([Motion pipeline](MOTION_PIPELINE.md)): 2D HyperFrames by default; generated 3D and people
  only as Nano Banana Pro keyframes animated by Veo 3.1, placed under HyperFrames text;
- skills compiled into the backend at build time (`npm run director:prompt`), see
  [Templates → Skills and reference packs sent to Claude](TEMPLATES.md#skills-and-reference-packs-sent-to-claude).

## 1. Rules every item in this plan follows

1. **HyperFrames owns the film.** All text, logos, timing, transitions, captions and the audio mix are HTML in
   HyperFrames. Generated images and video never contain text or logos.
2. **Every frame is deterministic.** A composition seeks to any time and draws the same pixels: no unseeded randomness,
   no `requestAnimationFrame` clocks, finite loops. Libraries that use randomness must take a seed.
3. **No network at render time.** Libraries are vendored into the render folder (like `vendor/gsap.min.js` today), at a
   pinned version, never loaded from a CDN.
4. **Claude runs in the backend, never in the worker.** Skills compile into the backend image; the worker receives only
   a finished, checked composition folder.
5. **Send Claude only what the step needs.** One prompt bundle per producer (director, shot writer, HyperFrames
   builder), not every pack in every call. Static skill text uses prompt caching.
6. **Every generated beat has a fallback** that renders without the generator (2D HyperFrames), and a cost gate before
   any paid generation runs.
7. **Pacing and watchability gates apply to every format**: no dead space (`pacing_gate.py`), the watchability rules,
   the seam ledger where a format has one.

## 2. Inventory: what each pack is and what we do with it

### A. HyperFrames film structures → new formats (highest value, closest to our stack)

These already build HTML/CSS/SVG/GSAP compositions rendered by HyperFrames, with blueprints and checklists.

| Pack | What it builds | Plan |
| --- | --- | --- |
| `bs-hyperframes-velocity-sting` | Short product sting; seven velocity-matched cuts read as one camera move; seam ledger, slot map, rebrand checklist | Convert to gm skill **`gm-velocity-sting`**; its seam ledger matches our `/cut-the-curve` and `/seam-craft` rules. Format: 10–15 s, 9:16 and 16:9. |
| `bs-hyperframes-chat-to-result-launch` | Narrated launch film inside a dark app interface: prompt typed, answer streams, product triggered, count-up result | Convert to **`gm-chat-to-result`**. Fits AI and dev-tool products. Its interface system becomes a `ui` beat style; durations from word-level timestamps (we already have transcription). |
| `bs-hyperframes-agent-chorus-reel` | Four surfaces type the same prompt, beat-cut reel of outputs, ends on the install command | Convert to **`gm-everywhere-reel`**. Needs a music track with a real drop (Lyria or owned library) and the beat grid from `/hyperframes-audio`. |

How: run each through `/gm-skill-authoring` (SKILL.md, blueprint, craft system, slot schema, gating checklist), test-build
on one real product, freeze a fill-mode template, add it to the template/format catalog with its slot schema, and add a
director route so the director can choose it. Their retarget/rebrand checklists become the format's acceptance checks.

### B. Shot directors → better prompts for generated beats

These write prompts for image and video generators; they never generate. Our generated path runs Nano Banana Pro
(images) and Veo 3.1 (video); prompts written for Seedance, Kling or GPT Image must be adapted to those two models.

| Pack | Skill(s) | What it gives us | Where it plugs in |
| --- | --- | --- | --- |
| The Ad Director | `ad-assets`, `ad-director` | Locked asset order (character → scene → product), timecoded beat sheet, a 17-slot shot prompt spine (style prefix, CRITICAL blocks, geometry map, first frame, lens FOV, camera) | The **shot writer** for `3d` organic and `footage` beats: adopt the slot spine and asset order; drop the beat-sheet part (our director owns timing). |
| Pink Prompt Director | `image-prompter`, `video-prompter` | Character-first reference assets: face lock on a neutral backdrop, outfits, character sheets; cinematography modes (narrative, studio, action, performance, atmospheric), frame map, subject lock | Character consistency for `footage` beats (Veo T4 continuity); merge with `third_party/visual-skills/image/references/characters.md`. |
| Product Visuals | `product-visuals` | Place the user's real product into a reference scene (recreate or recompose) | New beat kind **`product-shot`**: the customer's product photo as the Nano Banana reference, animated by Veo or used as a still with HyperFrames motion. |
| Studio Shot | `studio-shot` | Product photo → clean studio packshot prompt | Pre-processing step for customer product photos before `product-shot` and brand kits. |
| PYNK AI UGC Studio | `ugc` | 15 s selfie-review UGC ad: model sheets, product and scene, shot prompts | Later format **UGC ad** (section E). Its model-sheet steps feed the `footage` producer now. |
| Ad Generator | `ad-generator` (+ 40 templates) | Static ad image prompts from 40 templates; brand setup from a website | New output type later: **static ads and video thumbnails** from the same brief and brand kit. |

How: curate (not copy whole packs) into `third_party/visual-skills`-style references, one per producer, for example
`shot-direction.md` (slot spine + asset order), `characters.md` (face lock, sheets), `product-shot.md`. Each reference is
rewritten for Nano Banana Pro and Veo 3.1 syntax, keeps the "no text, no logos in pixels" rule, and is compiled into the
backend prompt bundle for the shot writer only.

### C. Looks → style packs for generated beats

| Pack | Skill | Look |
| --- | --- | --- |
| Creative Formats | `paper-animation` (5 sub-styles, reference sheet) | Papercraft, cutout, stop-motion paper, collage, origami |
| Creative Formats | `claymation` (4 sub-styles, reference sheet) | Goofy clay, clean clay, puppet, studio plasticine |
| motion-design-prompts | `motion-design`, 3-step prompts, `paper-cut-style.jpg` | Paper-cut world that builds itself |
| Vox Animations | `vox-animation` (+ diorama doc, prompts) | Vox-style mixed-media collage; cinematic paper diorama |

A **look** is a named style: a locked prompt prefix for images, motion rules for video, reference images, and the
HyperFrames side (type, colour treatment, transitions, grain) that makes the 2D beats match. Users pick a look like they
pick a theme today. Looks sit in a catalog (`packages/contracts`, like themes), and the director passes the look to
every generated beat so a film stays consistent.

Vox's flow (fact-led script, N × 10 s scenes, one clip per scene, voice per scene, ffmpeg assembly) maps onto our beat
plan; HyperFrames replaces `assemble.sh` and adds the text, captions and sound mix. A **"Vox explainer"** format
(60 s, 6 beats) is a good first long-form format for looks.

Reference images (`*-styles.webp`, `paper-cut-style.jpg`, about 1.3 MB) are inputs to Nano Banana. They stay in Git
next to the skill while small; if looks grow, move them to a shared read-only R2 prefix with content-addressed names
pinned by the catalog.

### D. Hand-drawn and SVG motion → new 2D beat styles (libraries)

See section 3.

### E. Ad formats → later product lines (decide after A–C)

| Pack | Format | Needs before we can offer it |
| --- | --- | --- |
| `skeleton-ads` | "What happens if you ___? Day 1 → Day 365" narrated progression with one locked 3D cartoon character | Character continuity across many Veo shots (T4), long-form cost gate |
| `song-style-ad` | Micro music video: original song, Pixar-style visuals, one or two lip-sync beats | Lyrics → Lyria song with vocals, lip-sync shots (Veo with dialogue), rights check on generated music |
| `talking-object` | Animated character (product, ingredient, mascot) talks to camera | Veo dialogue shots or a 2D rig (section 3, p5 option) |
| `ugc` | 15 s selfie-review UGC ad | Realistic people: policy decision on synthetic people in ads, disclosure, consent rules |

These are full products with their own risks (cost per video, likeness and disclosure rules). Keep the packs as
references and decide one at a time after the core formats ship.

## 3. Libraries

| Library | Licence | What it adds | HyperFrames integration | Use it for |
| --- | --- | --- | --- | --- |
| [Anime.js v4](https://animejs.com/documentation/svg/createmotionpath) | MIT | `svg.createMotionPath(path)` returns `translateX/translateY/rotate` tweens that follow an SVG path; `svg.createDrawable` (line draw-on); `svg.morphTo` (shape morph); `utils.createSeededRandom` | Built-in `animejs` adapter: create with `autoplay: false`, register on `window.__hfAnime`; HyperFrames seeks with `instance.seek(ms)`. v4 API only (`ease`, not `easing`; `anime` is a namespace). Skill: `.claude/skills/hyperframes-animation/adapters/animejs.md` | Objects travelling along routes (cursor flights, a product moving through a flow diagram, map routes, connectors drawing between UI parts), icon morphs |
| [Rough.js](https://github.com/rough-stuff/rough) | MIT, < 9 kB | Hand-drawn shapes on SVG or canvas: line, rectangle, ellipse, circle, polygon, arc, path; hachure / cross-hatch / zigzag fills; `roughness`, `bowing` | Generate SVG once at composition init with a fixed **`seed`** (same shape every frame), then animate the strokes with GSAP or `createDrawable` (stroke-dashoffset draw-on). Optional "boil" (hand-drawn jitter): switch between 3–4 pre-seeded variants on a fixed 8–12 fps step, never re-randomise per frame | A **Sketch** beat style: circles, arrows, underlines and highlights drawn over real screenshots in `ui` beats; whiteboard explainer look; hand-drawn charts |
| [ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) (p5.js + p5.brush) | MIT | Hand-painted cartoon character animation: a character module with emotions, views and accessories, a scene timeline, headless Chrome render, contact sheets and frame strips for self-checking | No adapter: draw the p5 canvas in `noLoop()` mode and redraw on seek (listen for HyperFrames' `hf-seek` event, or drive `redraw(t)` from a GSAP proxy tween's `onUpdate`). All randomness through seeded generators (`randomSeed`, and the brush library's seed if it has one; verify) | Phase 2 option: a **2D mascot/character** for talking-object and character beats without Veo, and the `footage` fallback ("a ui beat with a mascot"). Also adopt its **contact-sheet self-check** idea for our own build agent |

GSAP stays the default runtime. GSAP's own MotionPath, DrawSVG and MorphSVG plugins cover part of what Anime.js does; the
spike (Phase 1) decides per effect, and we add Anime.js only where it is clearly better or simpler, so a composition
does not carry two runtimes without reason.

Vendoring: add each library to the workspace with an exact version, copy its built file into the render folder's
`vendor/` (as `gsap.min.js` is copied today) from `plan/render-project.ts` and the preview service, record version and
licence in a NOTICE file, and add it to the worker image's self-test.

## 4. Where everything lives

```text
third_party/creative-packs/<pack>/        raw packs as received, with PROVENANCE.md (reference only; never read at runtime)

.claude/skills/gm-<format>/               curated HyperFrames formats (section A), authored via /gm-skill-authoring
third_party/visual-skills/…/references/   curated shot-direction and look references (sections B, C), rewritten for Nano Banana Pro + Veo 3.1
packages/contracts/src/{looks,formats}.ts catalogs the frontend, director and validators share (like themes.ts, templates.ts)
backend/src/plan/prompts/*.generated.ts   one compiled prompt bundle per producer (director, shot writer, HyperFrames builder)
worker/templates/beat-plan/vendor/        pinned library builds (gsap, anime, rough, p5) copied into each render folder
```

Render templates live only in `worker/templates/`; the packs moved out of the old `templates/` folder so the two are not confused (done 2026-10-07).

Prompt bundles (extending `scripts/build-director-prompt.mjs`):

| Bundle | Sent to | Contains |
| --- | --- | --- |
| Director | planning call | current four gm references + a short catalog of formats and looks (names, when to use, slot schema), not the full packs |
| Shot writer | one call per generated beat | shot-direction spine, the chosen look's prompt block, character/product rules, Nano Banana / Veo syntax |
| HyperFrames builder | when Claude writes or edits composition code | the format's gm skill, `/motion-doctrine`, `/cut-the-curve`, the library adapter notes it uses |

## 5. Phases

| Phase | Work | Done when |
| --- | --- | --- |
| **0. Housekeeping** (½ day) | Move packs to `third_party/creative-packs/` with `PROVENANCE.md`; delete `.DS_Store` and zips; list overlaps with `third_party/visual-skills` | Repo has one home for raw packs, nothing in `templates/` is mistaken for render templates |
| **1. Library spikes** (1 day each) | Three test compositions: (a) Anime.js motion path + drawable line in a `ui` beat; (b) Rough.js seeded annotations drawing over a screenshot, with and without boil; (c) p5 + p5.brush character drawn on seek | Each renders through the worker; **rendering twice gives identical frame hashes**; `hyperframes check` passes; render time and frame cost recorded; GSAP-plugin comparison written down for (a) |
| **2. HyperFrames formats** (section A) | `gm-velocity-sting` first, then `gm-chat-to-result`, then `gm-everywhere-reel`; catalog entries; director routes | Each format test-built on one real product, passes pacing, watchability and seam-ledger gates, frozen as a fill-mode template |
| **3. Shot direction** (section B) | Curated shot-writer bundle; `product-shot` beat kind using the customer's product photo; character references | On 10 fixed briefs, generated beats need fewer rerolls than today's prompts (count rerolls and cost); the Motion pipeline tests T2, T4 and T6 pass |
| **4. Looks** (section C) | Paper, clay, Vox collage, paper-cut, Sketch (Rough.js) as catalog looks; HyperFrames-side styling for each; a 60 s "Vox explainer" format | A film in each look keeps one consistent style across generated and 2D beats on 3 briefs |
| **5. Ad formats** (section E) | One at a time, after a product decision for each | Per-format decision recorded with cost per video and policy notes |

Phases 1 and 2 need no paid generation and can start now. Phase 3 depends on the 3D path tests; Phase 4 on Phase 3.

## 6. Quality and cost gates

- **Fixed brief set**: 10 product briefs used before and after every prompt or skill change; compare outputs side by side.
- **Determinism**: two renders of the same plan produce identical frames (hash check in CI for library compositions).
- **Token budget**: record input tokens per bundle; cache static skill text; a bundle that grows beyond its budget must be
  trimmed, not just added to.
- **Generation cost**: estimated cost shown before any paid shot; a per-video cap; the fallback renders when the cap or a
  generator fails.
- **Pixels never carry text or logos**: checked on keyframes before Veo runs (the Motion pipeline T3 rule).

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Packs written for other models (Seedance, Kling, GPT Image) produce weak Nano Banana / Veo prompts | Rewrite per model in Phase 3; judge on the fixed brief set, not by eye on one example |
| Too much prompt text in every call (cost, diluted instructions) | Per-producer bundles, prompt caching, token budgets |
| Library randomness or clocks break seek-exact rendering | Seeds everywhere, no rAF; identical-frame-hash check |
| p5 canvas drawing is slow per frame at 1080p | Measure in Phase 1; keep p5 to short beats or pre-render character cycles |
| Two animation runtimes in one film increase weight and bugs | Anime.js only where the spike shows a clear win over GSAP plugins |
| Synthetic people and voices in ads (UGC, talking characters) | Product and policy decision before Phase 5; disclosure and consent rules |

## 8. Decisions needed from the owner

1. Approve moving the raw packs from `templates/` to `third_party/creative-packs/`.
2. Order of the three HyperFrames formats (recommended: velocity sting → chat to result → everywhere reel).
3. Whether Anime.js is added only where it beats GSAP's plugins (recommended), or adopted as a second standard runtime.
4. Which looks ship first (recommended: Sketch with Rough.js, because it needs no paid generation; then paper and Vox
   collage).
5. Whether the ad formats in section E are on the roadmap at all, and in what order.
