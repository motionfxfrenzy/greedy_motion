# EffectCraft and motion-gallery handoff

Updated: **2026-10-09**. Workspace: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS`.

This is the entry point for the local EffectCraft launcher, original text-animation studies, MotionPromptGallery research, two rebuilt motion templates, verification evidence, and product-integration work. These deliverables are local and uncommitted. No deployment or paid generation occurred.

## Delivery status

| Deliverable | Current state |
| --- | --- |
| EffectCraft desktop checkout and launcher | Existing clean checkout reused; desktop launcher tested |
| Original text-animation set | Three native editable animations and a 15-second reel |
| Gallery research | 178 indexed entries; all 172 advertised posters downloaded; six entries have no poster |
| Selected gallery reference videos | Two complete public previews downloaded for local study |
| Graphic Showreel template | Twelve original procedural scene segments; rendered with original synthesized music |
| Product Story template | Eight original procedural scene segments; rendered with original synthesized music |
| Local browser library | Search, scene navigation, timeline, audio playback, brand/accent editing and configuration download |
| EffectCraft gallery project | Two compositions containing 20 named video scene clips; graphic internals are flattened |
| Standalone HyperFrames projects | Packaged locally; general audits pass, with one documented full-bleed warning |
| Product integration | Detailed plan prepared; no production catalog, routes or deployment changed |

**Scope:** 178 gallery entries were inventoried, not turned into 178 working templates. The two explicitly selected designs were studied and rebuilt. “All graphics” means the major graphic treatments in those two selected references are mapped to delivered counterparts; it does not mean original source layers were recovered or that the recreations are pixel-identical.

## Start here

All shell examples below run from the workspace root unless a different directory is stated.

```sh
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS

# EffectCraft desktop app
./scripts/launch-effectcraft.command

# Gallery browser library
./Effectcraft_templates/Motion_gallery/Launch_Library.command
# Open http://127.0.0.1:8027

# Both gallery films, arranged into named scene clips in EffectCraft
./Effectcraft_templates/Motion_gallery/Open_EffectCraft.command

# Three native text animations in EffectCraft
./Effectcraft_templates/Text_animation/Originals/Open_Animations.command
```

The `.command` launchers can also be double-clicked in Finder. The library launcher prints its URL and keeps its Terminal process running; Control-C stops it. It does not automatically open a browser. A browser was opened separately during delivery. Running processes from the authoring session are not persistent infrastructure: restart them when necessary.

## Documentation map

| Document | Purpose |
| --- | --- |
| [Template workspace index](../Effectcraft_templates/README.md) | Quick entry points for both template collections |
| [Gallery README](../Effectcraft_templates/Motion_gallery/README.md) | Editing, packaging and verification commands |
| [Graphics inventory](../Effectcraft_templates/Motion_gallery/GRAPHICS_INVENTORY.md) | Every selected-reference motif, scene timing and fidelity boundary |
| [Product integration plan](../Effectcraft_templates/Motion_gallery/PRODUCT_INTEGRATION_PLAN.md) | Exact repository reuse points, phases, input mapping and release gates |
| [Text-animation README](../Effectcraft_templates/Text_animation/Originals/README.md) | Native animator/transform controls and regeneration |
| [Asset attribution](../Effectcraft_templates/Motion_gallery/assets/ATTRIBUTION.md) | Fonts, GSAP, synthesized sound and artwork provenance |
| [Existing showreel architecture](SHOWREEL_MODULES.md) | Existing modular scene/planner system to reuse |
| [EffectCraft asset workflow](EFFECTCRAFT_ASSET_WORKFLOW.md) | Separate proposed proxy, screenshot, visual-review and export architecture |
| [Material-style progress](STYLE_PRODUCTION_PROGRESS.md) | Separate paper/clay/editorial generation project; its approval and fidelity status are unchanged |

## 1. EffectCraft setup

The requested repository was already present at `experiments/effectcraft`, with remote `https://github.com/storytold/effectcraft`. It was not overwritten, re-cloned or updated. Inspected commit: `a6e6e2938c3f71062ea7653962186e726ab80237`; desktop executable reports **0.3.1**. A remote HEAD check returned a newer revision, but no pull was performed.

Launcher: [scripts/launch-effectcraft.command](../scripts/launch-effectcraft.command).

- Resolves the checkout relative to the script, so the launcher can be called from another directory.
- Runs `experiments/effectcraft/target/release/effectcraft` when it exists.
- Builds with `cargo build --locked --release -p effectcraft` when the binary is absent or `--rebuild` is supplied.
- Adds common Homebrew/Rust paths for Finder launches. Building requires Rust 1.95 or newer and may download dependencies.
- Forwards EffectCraft arguments such as `--empty`, `--demo`, `--version`, a project filename, or an explicitly requested local control port.
- Keeps the caller's working directory, allowing relative project paths. Absolute project paths are simplest from Finder.
- Does not pull upstream changes or enable the control channel by default.

A first launch inside the restricted execution sandbox produced macOS desktop-service errors. It was restarted outside that sandbox; the initial process was terminated, and the restarted desktop instance stayed running without reported errors. This is an agent execution-environment issue, not a requirement to change macOS security settings when launching normally.

## 2. Native text-animation studies

Input: [Text_animation.ecproj](../Effectcraft_templates/Text_animation/Text_animation.ecproj). The supplied file was left unchanged.

The reference contains demo compositions and two custom studies. Their range-selector Offset moves from −100 to +100 over roughly 0.60 seconds. One combines opacity with approximately 100 pixels of upward character travel; the other combines opacity and a cyan fill-color animator.

Output folder: [Text_animation/Originals](../Effectcraft_templates/Text_animation/Originals/README.md).

| Composition | Length | Native editing model |
| --- | --- | --- |
| `01 - Staggered Rise` | 5 seconds | Two editable text lines; per-character range-selector reveal and layer exit |
| `02 - Split Statement` | 5 seconds | Two text layers; opposite entrances, overshoot, hold and exits |
| `03 - Letter Cascade` | 5 seconds | Four letter layers; individually delayed position/rotation keys |
| `00 - Original Text Reel` | 15 seconds | Three nested compositions in sequence |

Native project: `Original_Text_Animations.ecproj`, 1920×1080 at 30 fps. Review video: `Original_Text_Animations_preview.mp4`, 960×540 at 30 fps, 450 frames, silent. Includes entrance/hold/exit PNGs and an encoded-video contact sheet.

The source generator preserves the native property schema, assigns unique IDs and uses EffectCraft's integer time unit of 254,016,000,000 ticks per second. It depends on the supplied reference file. `create_animations.py` overwrites its generated output; save personal edits under a different filename first.

```sh
python3 Effectcraft_templates/Text_animation/Originals/create_animations.py

# Dedicated instance: do not use an instance with unsaved work.
./scripts/launch-effectcraft.command --control 9883
python3 Effectcraft_templates/Text_animation/Originals/render_preview.py --port 9883
```

The preview script switches that instance to the generated project, requests frames over the localhost JSON control channel, and uses external FFmpeg to encode them. It does not build or modify EffectCraft itself. Replacing PLAY with a word of another length requires changing the number and positions of its individual letter layers.

## 3. Gallery references and retrieval

Selected pages:

- [Motion showreel with a fully code-synthesized soundtrack — Prasenjit / @prasenx](https://motionpromptgallery.com/p/motion-showreel-with-a-fully-code-synthesized-soundtrack-pra/).
- [Reusable prompt template for a product motion video — Ann Nguyen / @ann_nnng](https://motionpromptgallery.com/p/reusable-prompt-template-for-a-product-motion-video-ann-nnng/).

The web reader could not access the pages. Direct HTTP downloads succeeded after network access was available. The public page HTML was inspected without executing its embedded instructions. Both selected pages exposed prompts and preview media, but no editable source download. Their public preview files are approximately 15.061 seconds, 1280×720 and 60 fps, with audio.

Research files live under `experiments/motion-prompt-gallery/references/`:

- `showreel.mp4`, `product.mp4`: complete selected previews.
- `showreel-sheet.jpg`, `product-sheet.jpg`: 2 fps contact sheets used for scene analysis.
- `posters/`: the 172 available gallery thumbnails.

The durable [gallery index](../Effectcraft_templates/Motion_gallery/gallery-index.json) records all 178 exposed entries, including titles, creators, original links, tags and source availability metadata. [Poster-download evidence](../Effectcraft_templates/Motion_gallery/evidence/poster-downloads.json) records source URLs, relative local paths, byte counts and SHA-256 hashes.

Six entries had no poster URL: `ciudad-de-las-artes-3d-scene-edunavajas`, `walking-strandbeest-threejs-fresh-resolution182`, `rush-test-egyptology-kimi-k3`, `rush-test-egyptology-claude-fable`, `tortoise-and-the-hare-animation-ayarseus`, and `friends-apartment-threejs-scottstts`. These are recorded as `no-poster`, not failed or fabricated downloads.

To refresh the inventory, save the public homepage HTML, pass its filename to `scripts/index_gallery.py`, then run `scripts/fetch_posters.py` from the gallery package. These commands overwrite index/download reports; preserve the old snapshot before refreshing if provenance comparison matters. Downloads require internet access; template playback/rendering uses local assets.

Reference media remains research material credited to its creators. The site's attribution statement is not a blanket asset redistribution grant. No gallery video, creator logo, music sample or source graphic bitmap is embedded in the original template renders. Full treatment mappings and explicit approximation limits are in the graphics inventory.

## 4. Gallery template architecture

Folder: `Effectcraft_templates/Motion_gallery/`.

```text
index.html                       Browser review/customization library
Launch_Library.command           Localhost library launcher
Open_EffectCraft.command          Native project launcher
Gallery_Motion_Templates.ecproj   Two scene-cut footage compositions
README.md                        Operational instructions
GRAPHICS_INVENTORY.md             Reference-to-deliverable mapping
PRODUCT_INTEGRATION_PLAN.md       Production reuse and release plan
gallery-index.json               178-entry research inventory
templates/
  config.js                      Copy, brand, colors, cards, screenshot input
  engine.js                      Deterministic Canvas graphics and animation
  showreel.html / product.html    Live template entry points
assets/                          Local fonts, GSAP, original scores, notices
projects/showreel/                Packaged standalone HyperFrames project
projects/product/                Packaged standalone HyperFrames project
renders/                         Two 1080p/60fps H.264/AAC outputs
scripts/                         Indexing, synthesis, rendering, tests, packaging
evidence/                        JSON results, screenshots, graphic PNGs, hashes
```

Both template compositions register one paused GSAP timeline. Rendering seeks to an explicit time; procedural variation is deterministic and uses no wall clock or unseeded randomness. The browser-library player uses the audio element as its playback clock, outside the renderable template. Each prototype currently draws its visual content into one Canvas surface.

Graphic Showreel has 12 segments: easing graph, sliced type, iridescent form, geometric tiles, particle text, ring tunnel, texture-filled type, voxel wave, repeating type wall, beat cards, reprise and closing mark. Product Story has eight: cycling badge, composer, workflow cards, team wall, orbiting feature cards, brand swaps, shard assembly and closing mark.

The iridescent form is a Canvas gradient interpretation and the voxel landscape is drawn geometry; neither claims to reproduce the reference's original shader or 3D source. The default product interface is illustrative sample content. Product proof must use actual approved customer assets in a production adapter.

### Customization and saved configurations

The library can change brand name and accent color, seek to scenes, play audio, and download a replacement `config.js`. Changes are in browser memory until downloaded. Switching/reloading the template restores its file-based configuration; it does not save to the project or a backend automatically. Save changes before switching if you want to retain them.

Edit `templates/config.js` for the full configuration: headline, badges, prompt, three feature titles and descriptions, team headline, eight orbit labels, brand, CTA, domain, palette and optional screenshot. Keep the prototype's expected array sizes. Production schema validation and malformed-input handling are not implemented here.

The optional screenshot path is relative to the HTML page. Custom screenshot path rewriting across packaged directories has not been validated; check paths in both the live template and the standalone package. No customer screenshot was used in the delivered example. Long text is fitted to a width, but minimum font sizes, line wrapping and multilingual policies remain production work.

### Audio

`scripts/synthesize.py` generates two original, deterministic, 15-second mono WAVs at 48 kHz, 120 BPM. It uses oscillators and seeded noise for percussion, bass and melodic notes. There are no samples, stock tracks or VST instruments. The measured pre-AAC peak is approximately −1.62 dBFS. AAC export is 192 kbit/s. This peak check is not a loudness-normalization or listening-quality certification.

### Packaging and EffectCraft boundaries

`package_projects.py` copies local assets and generates standalone HTML with the configuration and engine inlined. The timeline ID is made literal for HyperFrames' static checker. Edit the source files under `templates/` and repackage; editing copied `config.js`/`engine.js` in `projects/` alone does not change the inlined runtime.

`package_effectcraft.py` builds two native compositions with 20 named, trimmed layers referencing the two rendered movies. Those layers can be cut, rearranged or replaced. Their text, geometry and shading are baked pixels, not individually editable EffectCraft objects. This differs from the earlier three native text-animation studies.

The EffectCraft gallery project records absolute media paths. Regenerate it after moving the checkout or relink its footage. The packager also depends on the original text project's native layer schema.

## 5. Rebuild and verification commands

```sh
# Rebuild original scores and both 900-frame exports.
python3 Effectcraft_templates/Motion_gallery/scripts/synthesize.py
node Effectcraft_templates/Motion_gallery/scripts/verify-render.mjs --render

# Rebuild both standalone projects and the EffectCraft assembly.
python3 Effectcraft_templates/Motion_gallery/scripts/package_projects.py
python3 Effectcraft_templates/Motion_gallery/scripts/package_effectcraft.py

# Browser scene/seek checks without encoding.
node Effectcraft_templates/Motion_gallery/scripts/verify-render.mjs

# Requires the library server running on port 8027.
node Effectcraft_templates/Motion_gallery/scripts/verify-library.mjs

# Packaged-project audits; installed workspace CLI is 0.8.111.
npx --no-install hyperframes check Effectcraft_templates/Motion_gallery/projects/showreel --json
npx --no-install hyperframes check Effectcraft_templates/Motion_gallery/projects/product --json
```

Prerequisites: workspace Node dependencies including `puppeteer-core`, the installed HyperFrames browser, Python 3 and FFmpeg/ffprobe. Rebuilding EffectCraft additionally needs Rust 1.95+. Render and audit processes need permission to start a localhost server/browser in restricted agent environments.

The custom exporter captures Canvas frames at exact 1/60-second intervals and feeds them into FFmpeg with the synthesized WAV. The delivered videos were exported through this script, not through a completed production queue or a native EffectCraft export. Generated outputs are overwritten. JSON verification reports describe the latest execution; running without `--render` replaces that report with `export: not run` even if older MP4s remain on disk.

## 6. Verification ledger and limits

| Check | Observed result | Evidence / limit |
| --- | --- | --- |
| Launcher | Shell syntax and 0.3.1 version passed; desktop process launched | Launcher source and observed desktop startup |
| Native text project | Opened; 450 review frames rendered | Text-animation README, preview MP4 and frame PNGs |
| Native text seeking | Nine out-of-order samples matched initial PNGs byte-for-byte | Recorded authoring result; no standalone JSON test report was saved for this check |
| Native text export | 15s, 960×540, 30fps; full decode passed | Review MP4; silent |
| Gallery scene checks | 12 + 8 scenes; reverse midpoint hashes matched; start/end samples differ; no browser errors | [verification.json](../Effectcraft_templates/Motion_gallery/evidence/verification.json) |
| Gallery exports | Two 15s, 1920×1080, 60fps films; 900 frames each; H.264/AAC; full decode passed | [exports.json](../Effectcraft_templates/Motion_gallery/evidence/exports.json) |
| Audio | Two deterministic 48kHz, 120BPM scores; −1.62dBFS pre-encode peak | [audio.json](../Effectcraft_templates/Motion_gallery/evidence/audio.json) |
| HyperFrames product audit | General audit passed with no reported warnings | [product audit](../Effectcraft_templates/Motion_gallery/evidence/product-hyperframes-audit.json) |
| HyperFrames showreel audit | General audit passed; one `canvas_content_at_edge` warning at 5.833s | [showreel audit](../Effectcraft_templates/Motion_gallery/evidence/showreel-hyperframes-audit.json); ring tunnel is intentionally full-bleed; not a strict warning-free result |
| EffectCraft gallery decode | Opened project; sampled showreel at 7.5s/3.5s and product at 5s | [effectcraft.json](../Effectcraft_templates/Motion_gallery/evidence/effectcraft.json) and PNGs; not exhaustive native export/audio testing |
| Local library | Template switching, brand edit, search, audio playback, mobile overflow and all local poster routes passed | [library report](../Effectcraft_templates/Motion_gallery/evidence/library-verification.json) |
| Artifact identity | 47 packaged/source/asset/output files recorded | [artifact-hashes.json](../Effectcraft_templates/Motion_gallery/evidence/artifact-hashes.json); regenerate after changes |
| Visual review | All 20 scene midpoints viewed in contact sheets; selected full-resolution frames inspected | Contact sheets and `evidence/graphics/`; not a frame-by-frame artistic review of all 1,800 output frames |

The initial HyperFrames checks rejected an external/dynamic timeline registration. Inlining the engine and registering the literal composition ID fixed those checks without disabling lint rules. The installed CLI did not support the skill's `usage` command, so HyperFrames usage allowance was unknown; no allowance or paid-generation claim was inferred.

Canvas content is not semantically equivalent to DOM text for automated contrast/layout checks. The browser library's mobile test verifies its interface at a narrow viewport, not a portrait composition. Current films support **16:9 only**. Production HyperFrames-player/export parity, real user media, customer font/logo cases, queue integration, arbitrary inputs and square/portrait outputs remain unverified or unimplemented.

## 7. Product adoption and next work

Follow the [integration plan](../Effectcraft_templates/Motion_gallery/PRODUCT_INTEGRATION_PLAN.md). Recommended first surface: two fill-mode motion formats, not additions to the material-style picker.

1. Reuse existing showreel modules where they match: `pill-cycle`, `hook-type`, `chat-demo`, `trio-cards`, `wall-zoom`, `hub-orbit`, `reskin-proof`, `end-burst` and `end-sting`.
2. Promote the new abstract graphics as isolated, time-driven scene modules, with declared inputs, seed, duration limits and aspect support.
3. Bind approved copy/brand/media through the existing format bundle, slots and `buildFormatProject()` mechanisms. Fingerprint configuration, template version, fonts, media and score for preview/export invalidation.
4. Expose native DOM/SVG text, logo and screenshot controls in Pro; retain Canvas for complex backgrounds. Name scenes on the timeline.
5. Implement actual 1:1 and 9:16 layouts; reject unsupported aspect requests until they exist.
6. Verify actual player/export/audio parity, signed ownership-aware media access, malformed inputs and worker performance. Build a concrete release candidate before deployment review.

Suggested future IDs are `gm-graphic-showreel` and `gm-product-story`; these are proposals, not registered production entries. Production screenshot requirements must also reconcile with the separate EffectCraft asset-workflow plan. That plan's proposed 5MB upload rule, proxy work and AWS integration were not implemented by this template task.

Material-style work remains separate: its existing offline/synthetic checks do not prove live generated fidelity, and no paid generation approval has been granted by these template requests.

## 8. Operational notes and troubleshooting

- **Port 8027 occupied:** use the existing library process, stop the process you started, or launch with `PORT=8028 node Effectcraft_templates/Motion_gallery/scripts/server.mjs`. The current library test targets 8027 explicitly.
- **No thumbnails after copying only the template folder:** the server maps `/reference-posters/` to `experiments/motion-prompt-gallery/references/posters`. Preserve that folder structure or rerun the poster downloader. Standalone film packages do not need gallery posters.
- **Missing EffectCraft media:** rerun `package_effectcraft.py` in the new location; it writes absolute paths. Do not assume copying the project file alone copies its movies.
- **Edits do not appear in packaged films:** change `templates/config.js`/`engine.js`, rerender, then repackage. The standalone HTML contains an inlined snapshot.
- **Control-channel validation:** dedicated instances used ports 9883 (text studies) and 9884 (gallery verification). The JSON protocol is local TCP; ordinary launchers do not require it. Never redirect automation into an instance containing unsaved user work.
- **Screenshot is blank or fails decoding:** check the local path relative to that specific HTML file, and validate both preview/package paths. Arbitrary URL ingestion is not a supported production feature.
- **Missing browser:** provision the browser using the repository's HyperFrames tooling, then rerun the checks; the scripts query `hyperframes browser path`.
- **Audit warning for the ring tunnel:** evaluate the intentional edge-reaching artwork visually. Do not report the result as a warning-free strict audit.
- **Cleanup:** stop only the local servers/instances you launched. Keep reference files if you want the research gallery to remain browsable. Do not delete unrelated experiments or reset the existing dirty working tree.

All changes in the launcher/template work are additive local artifacts. No commit, push, paid generation or deployment was performed.

## 2026-10-09 continuation: prompt research and third study

The user clarified that “bad request” means prompts giving poor creative results, not HTTP 400. [MOTION_PROMPT_GUIDE.md](MOTION_PROMPT_GUIDE.md) now documents what makes the selected films effective, compares five published prompts, explains the limits of that evidence, gives a copyable brief/motion-score/production-contract method, and maps weak instructions to actionable fixes. It includes a completed example and the future product integration path.

The new preferred reference is the [TanStack AI launch film](https://motionpromptgallery.com/p/create-and-render-a-15-second-motion-graphics-video-introduc/). Its local gallery preview is 30.101 seconds at 1280×720/30 fps despite a published 15-second/1080p brief. This discrepancy is recorded without assuming its cause or equating a gallery preview with the creator's original master.

A third **separate study**, [Signal](../Effectcraft_templates/Motion_gallery/projects/signal-study/README.md), recreates its signal/routing/formats/parallelism/recovery/reveal narrative with original SVG geometry and fictional branding. Unlike the first two Canvas templates, it uses SVG/DOM and GSAP and was **rendered through the HyperFrames CLI**. It reuses our original product-score audio. It is a mechanism study, not a pixel-identical remake, an official TanStack ad, a new EffectCraft template, or a production Pro integration.

- Viewer: http://127.0.0.1:8027/signal-study.html
- Studio: http://localhost:8031/#project/signal-study while that preview is running.
- Render: `Effectcraft_templates/Motion_gallery/renders/signal-study.mp4`.
- Source: `Effectcraft_templates/Motion_gallery/projects/signal-study/index.html`.
- HyperFrames audit: no findings, 47/47 sampled contrast checks. Its built-in motion assertions were disabled; independent tests cover six animated beats, reverse seeking and checkpoint recovery.
- Export: H.264/AAC, 1920×1080, 30 fps, 450 video frames, exactly 15 seconds; full FFmpeg decode passed.
- All seven source snapshots reproduce byte-for-byte when sought in reverse; 50% progress is retained during the pause and then resumes to 100%; no source runtime errors.
- Render used screenshot capture with hardware GPU, workspace CLI 0.8.111. Latest upgrade probe said no project package.json to upgrade. No workspace dependency upgrade. `usage` command unavailable, so usage is unknown.

The broader gallery archive completed 178 page downloads and 122 preview videos, with six samples per video and 16 contact sheets. The contact sheets were inspected; detailed persisted observations currently cover entries 0–95. Finishing those notes, reviewing the remaining poster/page-only concepts and producing all 178 per-entry recreation recipes remains outstanding. Do not infer complete shot/audio analysis or 178 implemented templates from the archive count. No paid generation, deployment or unrelated production change was performed.

Final Signal verification: the encoded MP4 plays in Chrome; three nonchronological seeks decode distinct frames. Live SVG playback advances from the audio clock, the viewer has no horizontal overflow at 390px, and both browser contexts report no runtime errors. Decoded audio peak is −1.6 dBFS (mean −18.0 dBFS). `signal-verification.json`, `signal-export.json`, `signal-delivery.json` and `signal-hyperframes-audit.json` record the results separately. The local viewer returned HTTP 200; guide/study local Markdown links were checked. Portrait composition/export and native Pro editability remain unverified and unimplemented.

## 2026-10-10: recovered benchmark evidence and quality correction

The earlier experiments were located in `experiments/motion-tips-test/RESULTS.md`, its actual prompts in `run.ts`, and `experiments/claude-motion-tips.md`. The X comparisons are in `docs/BENCHMARK_FRAME_ANALYSIS.md` and `docs/BENCHMARKS.md`. Their findings and methodological limits now appear in the dated section of `MOTION_PROMPT_GUIDE.md`, alongside the new Hamza article and Motion-library review.

The guide now explicitly distinguishes technical verification from creative quality and records shortcomings of Signal: repeated framing, simple symbolic graphics, mostly opacity-based group transitions, similar easing, reused music, and insufficient reference-matched creative iteration. The brief does not need every scene from the user; the agent must produce the missing shot plan. The historical A/B changed tools and generation budget as well as prompt structure, so it does not prove XML causes better films. The older benchmark summary's scene-count/cut generalizations conflict with the more detailed shot tables; the guide records the correction. No production code, video, dependency or provider generation was changed in this research pass.

## 2026-10-10: Demo Flow reconstruction completed

[Demo Flow viewer](http://127.0.0.1:8027/demo-flow.html) and [project handoff](../Effectcraft_templates/Motion_gallery/projects/demo-flow/README.md) deliver the requested jhylee95 reference study. The actual [builder prompt](../Effectcraft_templates/Motion_gallery/projects/demo-flow/PROMPT.md) specifies frame ranges, poses, transition continuity, cursor actions, camera movements and audio accents for 18 beats. Three chapter builders used that packet and reference sheets. Original SVG/JavaScript/GSAP artwork and a new synthesized score were rendered by HyperFrames into a 24-second 1080p30 MP4.

Final audit: zero errors/warnings; 125 contrast checks; 20 informational UI overlaps; built-in motion assertions disabled. Independent verification: 22 byte-identical reverse-seek snapshots, 15 transition captures, full MP4 decode, actual Chrome playback and six out-of-order seeks, live source playback, and no mobile viewer overflow/runtime errors. Encoded audio peak −3.0 dBFS. Reports and paired reference/output sheet are in the project's evidence directory. The first export test used too-strict per-channel palette tolerance; compressed cobalt differed by 10 levels. The documented 16-level tolerance passes and still separates the three scene palettes; it is not a fidelity metric.

Visual review confirms the reference's sequence and interactions, but hero type is smaller, UI geometry/camera framing differ, punctuation/font shapes differ and audio is newly composed. The reference is 23.85 seconds versus our 24.00. These are documented limits, not an exact-remake claim. Source editing is available; native Pro slot editing, portrait composition and deployment are not implemented. No paid generation was invoked. The broader 178-entry recipe backlog remains outstanding.


## 2026-10-10 — response to mixed-scene creative rejection

User feedback: “Too basic; unlike the references.” Created **Orbit / Make it click**, a 16-second original, manually directed product study. Watch locally at http://127.0.0.1:8027/orbit-click.html; source and complete verification: `Effectcraft_templates/Motion_gallery/projects/orbit-click/README.md`. The frame-level packet is `STORYBOARD.md`; editable source is `source.html.in` plus `motion.js`.

HyperFrames orchestrates HTML UI/type, SVG chart/cursor/ink, and a Canvas aperture. Original synthesized score; no paid generation. Final MP4 decode, browser playback/seeks and source reverse seeks passed. This is landscape only, not native Pro-bound, not an automatic engine output, and not yet accepted by the user as matching the references. Existing correctness fixtures remain intact. Creative engine integration gaps are recorded in `docs/MIXED_RENDERER_PRODUCTION_PLAN.md`. Nothing pushed or deployed.
