# HyperFrames: what it can do, what our engine does today, and what the shared step 3 UI should offer

Research note, 2026-11-05. Sources are named for every claim. "Documented" means HyperFrames itself supports it (skills and package docs in the repo). "Our engine" means the beat-plan template the product actually ships (`worker/templates/beat-plan/`). "Not verified" means I did not find evidence either way.

## 1. Captions

**Documented (HyperFrames).**
- A full caption model: every phrase is dropped, shown on a verbatim "rail" (lower-third subtitle, in front), or "embedded" as one large word composited behind the subject; embed is scarce (at most one per beat). Captions are an **overlay**, never a reserved band (`.claude/skills/captions-overlay/SKILL.md`).
- Caption authoring from a word-level transcript `[{id, text, start, end}]`: style detection from tone (font mood, palette, animation), per-word styling (brand names, numbers, emphasis words, call-to-action), word grouping (2 to 6 words by energy), positioning rules for landscape and portrait, text-overflow fitting (`window.__hyperframes.fitTextFontSize`), and a mandatory exit guarantee per caption group (`media-use/audio/references/captions/authoring.md`).
- **15 ready-made caption components** installable from the registry as sub-compositions: highlight (TikTok style), karaoke pill, cinematic editorial, glitch, kinetic slam, neon glow, neon accent, clip wipe, gradient fill, matrix decode, emoji pop, parallax layers, particle burst, lava texture, weight shift; plus a blend-difference auto-inverting text (`authoring.md`, `hyperframes-registry`).
- Karaoke highlight, marker effects (highlight sweep, circle, burst, scribble) and audio-reactive caption motion (`captions/motion.md`).
- Per-theme caption skins exist in the creative presets (`hyperframes-creative/frame-presets/*/caption-skin.html`).
- Timeline convention: all captions on one track marked `data-track-kind="captions"` (`hyperframes-studio/SKILL.md`).
- Fonts: only a built-in mapped set is embedded automatically; any other font needs an `@font-face` with a real `.woff2` shipped with the project, or the render silently falls back (`authoring.md` constraints). This matches the font-parity finding in the phase 0 report.

**Our engine today.** `plan.captions` has three values: `key-phrases` (default; the beat's on-screen keyword is the caption), `full` (the spoken line as a lower-third, chunked 4 to 7 words by canvas, timed to the voiceover transcript words when available), `none` (`packages/contracts/src/beat-plan.ts`, `worker/templates/beat-plan/engine.js` function `captions`). One fixed look (`.cap span`, brand colours from CSS variables), fixed size per canvas (`capFs` 40 to 46), fixed position (`capBottom`). It is chosen in the script and style step (`script-style.tsx`) and **step 3 has no caption controls at all**. It does not use the 15 components, karaoke, per-word styling, or embedded words.

**Conclusion.** HyperFrames can do far more than our engine currently exposes. The earlier statement that HyperFrames cannot style subtitles was wrong at the platform level; it is true only of the current beat-plan engine.

## 2. Layers, tracks, composition

**Documented.** Every clip has a track index and start/duration; one element kind per track; every scene a sub-composition; one caption track; track layering is the z-order (`hyperframes-core/references/tracks-and-clips.md`, `hyperframes-studio/SKILL.md`). Typed **variables** (`string`, `number`, `color`, `boolean`, `enum`) are declared on the composition, applied as `--id` CSS custom properties, bindable declaratively (`data-var-text`, `data-var-src`), and resolve identically in preview and render (`variables-and-media.md`). Variables are read at initialization and "don't change mid-render", so a change means rebuilding the composition HTML and reloading the player, which is cheap (no MP4).

**Our product.** `declareVariables(html, values)` already builds these for each project (`backend/src/plan/render-project.ts`). `GET /v1/preview/plans/:projectId` builds the composition HTML on every request (`planPreviewHtml`), and `BrowserAnimationStep` loads it into `<hyperframes-player srcdoc>`. So the HyperFrames step 3 already **draws the composition live in the browser**; there is no per-edit render today.

## 3. Audio

**Documented.** Audio elements with `data-track-index`, `data-volume`, `data-automation` volume lanes (fades, ducking), voiceover carve, per-track effects (EQ, compressor, reverb and more), submix buses (`<hf-audio-group>`) (`hyperframes-audio/SKILL.md`, `variables-and-media.md`, `creator-editing-recipes.md`).

**Our engine.** `soundTracks()` (`backend/src/plan/sound.ts`) emits one voice track per beat, a music bed with a computed duck lane (looped with a crossfade when shorter than the film), and SFX cues, as plain `<audio>` elements. The brief's `audio` mode is `voiceover | music | both | none`; SFX play in every mode except `none`. No effects chains or buses are used. No step 3 control exists; the player only has volume and mute.

## 4. The player

**Documented** (`node_modules/@hyperframes/player/README.md`, `.d.ts`): `play`, `pause`, `seek`, `currentTime`, `duration`, `muted`, `volume`, `playbackRate`, `range-start` / `range-end` (play one time range, useful for "play this scene"), `scenes` (list from the runtime), `setColorGrading(...)`, `setRuntimeData(channel, payload)` (structured data delivered to the composition runtime with applied/error events), `iframeElement`, `sandbox-origin="opaque"`, `audio-locked`.
**Not verified:** how a composition consumes a `setRuntimeData` channel (the runtime protocol advertises a `runtime-data` capability, but I found no composition-side API in the docs or types). The plan therefore does **not** depend on it: caption and audio changes go through a plan patch plus an HTML reload, which is documented and already how the step works.

## 5. Consequences for the shared step 3

The shared bar shows what the engine can honour; controls appear as the engine gains them, and nothing is shown disabled.

| Control | Plates | HyperFrames today | HyperFrames next |
| --- | --- | --- | --- |
| Audio: voice, music | yes | exists as the brief's audio mode, no step 3 UI | **3b**: toggles wired to the audio mode through a plan patch |
| Audio: SFX, transitions | yes | SFX play unless audio is `none`; no switch | 3d: a switch in the plan and `soundTracks()` |
| Subtitles: Off / Key phrases / Full | yes (plates have Off, Key phrases, Subtitles) | exists as `plan.captions`, no step 3 UI | **3b**: wired through a plan patch |
| Subtitle style (Pill, Cinema, Kinetic, Paper, Blueprint) | yes (`SubtitleStyle` in `frontend/lib/api.ts`) | one fixed look | **3d**: engine reads the same style names (CSS variables; Kinetic uses the transcript word times for karaoke) |
| Size, colour, background colour, opacity, position | yes | fixed | **3d**: composition variables the engine reads |
| Embedded caption words, registry caption components, marker effects | no | not used | later, separate decision (documented capability) |

## 6. Decisions

1. HyperFrames step 3 moves onto the plates shell (3b) with **audio toggles and the subtitle mode wired**, no hidden-by-assumption controls: style, size, colour, opacity and position are **planned, not dropped** (3d), because the documented variable system and our engine's existing caption code make them feasible.
2. All changes (audio, captions, later style) are plan patches followed by a composition reload. No MP4 and no new render path.
3. The subtitle schema is shared across engines (the plates `SubtitleStyle` values and settings); an engine ignores values it does not support yet.
4. Fonts: custom caption fonts must be embedded (documented constraint), which also closes the named-font parity item from phase 0 for HyperFrames captions.
5. Open (not verified, to check during 3d, not assumed): per-style legibility of the engine's captions over its scenes, and whether `fitTextFontSize`-style fitting is needed in the engine's caption chunks.
