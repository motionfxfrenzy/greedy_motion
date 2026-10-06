# HyperFrames feature inventory

Date: 2026-10-03. Source: HyperFrames v0.8.111 repository docs, CLI help, packages, and registry (npm latest is 0.8.112). License: Apache-2.0. See [Editing and AI revisions](EDITING.md) for how the product uses these, and [Stack decisions](STACK_DECISIONS.md) for alternatives.

Legend for **Account**: — = free and local; ★ = needs a third-party account (HeyGen, ElevenLabs, or Gemini). Every ★ media feature has a free local fallback except avatars, HeyGen cloud, and hosted MCP.
Legend for **VideoSaaS**: ✅ in use · 🔜 planned · 💡 candidate · — not planned.

## 1. Creation workflows (agent skills)

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| Product launch / promo from URL, script, or brief; site tours (sweet spot 30–90 s, up to ~3 min) | — (website capture descriptions ★ optional) | 🔜 core use case |
| Faceless explainers from text (typography, diagrams, data-viz) | — | 💡 |
| PR-to-video (changelog, feature reveal, fix walkthrough) | — | 💡 "What's new" videos |
| Motion graphics: kinetic type, stat count-ups, charts, logo stings, lower thirds, social overlays, maps, tweet/headline cards, UI animation; MP4 or transparent overlay | — | ✅ starter templates |
| Music-to-video (beat-synced cuts) | — | 💡 |
| Captions and talking-head recuts | — | 💡 |
| Slideshows with reveals, notes, branches, hotspots, presenter mode | — | — |
| General video / co-direction | — | — |
| Figma, Claude Design, Open Design import | — | 💡 brand import |
| Remotion → HyperFrames port | — | — |
| Avatar presenter clips | ★ HeyGen | — |

## 2. Animation and motion

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| Runtimes: GSAP (default), Lottie, Three.js, Anime.js, CSS keyframes, WAAPI, TypeGPU | — (GSAP has its own license, see EDITING.md §2) | ✅ GSAP in templates |
| Keyframes, motion paths, masks, SVG morph/draw, text trails, 3D depth, camera moves, Ken Burns, punch-ins, whip/match cuts | — | 🔜 |
| 24 named text-animation effects | — | 🔜 |
| WebGL shader transitions and CSS transitions | — | 🔜 between scenes |
| Elastic holds, speed ramps | — | 💡 |
| `data-vfx-chain` (warps, displacement, noise); HTML-in-canvas textures | — | 💡 |
| Deterministic rendering (same input → same frames) | — | ✅ |

## 3. Registry catalog (~390 items via `hyperframes add`)

| Area | Examples | VideoSaaS |
| --- | --- | --- |
| Scenes and demos | App showcase, product demo, device mockups (iPhone, liquid glass), notification/chat reveals, social posts, logo outros | 🔜 template scenes |
| Text | 20+ caption styles, kinetic typography, lower thirds | 🔜 |
| Code | Typing, diff, highlight, scroll, terminal themes | 💡 |
| Data | Bar chart race, line graphs, count-ups, maps (US/world, flows, bubbles, hex) | 💡 |
| Effects | Glitch, light leak, grain, halftone, portals, shatter, cinematic zoom, camera rigs | 💡 |
| Design | 3 theme packs, 13 frame presets, 9 palette families, 8 example projects | ✅ 16 themes |

## 4. Color and picture

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| Color grading: presets + strength, exposure, contrast, tonal ranges, warmth, tint, vibrance, saturation, color wheels, RGB and hue curves, up to 4 HSL selections, grain, vignette, `.cube` LUTs, scopes, grade comparison, animated and spatially isolated grades | — | 🔜 theme-default grade for screenshots; AI edit op |
| Media effects: blur, pixelate, bloom; tape, film, scanlines, CRT, glitch; halftone, two-ink, dither; ASCII (8 styles), engraving, crosshatch, paint | — | 💡 style presets |
| Background removal | — | 💡 |
| 4K authoring/supersampling; HDR (BT.2020 PQ/HLG) preserved in 10-bit H.265 | — | 💡 paid tier |

Limits: grading applies to media elements (images/video) only, not HTML text; it qualifies by color, not position (no masks or tracking); true HDR grading is not supported yet.

## 4a. Modern motion-design direction

Relay should offer a controlled **Motion backgrounds** system for contemporary product videos: animated mesh gradients, soft bloom, translucent glass cards, subtle grain or halftone texture, floating product screenshots, and layered parallax. These are template capabilities, not free-form controls for beginner users.

| Visual level | Typical treatment | Implementation | Product status |
| --- | --- | --- | --- |
| Modern 2D | Animated gradients, glow, kinetic type, masks, grain, soft blur | CSS gradients, pseudo-elements, masks, transforms, keyframes, SVG | 🔜 first motion-template set |
| Layered 2.5D | Glass panels, floating UI cards, parallax, depth, camera-like movement, particles | Layered HTML/SVG planes, CSS perspective, HyperFrames camera/depth tools, optional shader transitions | 🔜 premium templates |
| Full 3D | Reflective objects, physically convincing lighting, complex depth of field or physics | Three.js/WebGL composition, or pre-rendered Blender/C4D assets composited into the template | 💡 specialist templates |

Beginner-facing choices should stay semantic:

```text
Motion style: Clean product | Soft gradient | Glass and depth | Bold kinetic | Editorial texture | 3D showcase
Mood: Calm | Energetic | Premium
Depth: Flat | Layered | Immersive
```

The selected template derives the actual gradients, glow, surfaces, and transitions from the active brand kit's primary, accent, and neutral colors. It must preserve readable text contrast and expose no arbitrary shader, keyframe, or CSS controls in the beginner experience. Pros can refine the same composition in Studio.

## 5. Audio

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| Voiceover | ★ HeyGen / ElevenLabs, or local Kokoro (free) | 🔜 Kokoro first |
| Music | ★ HeyGen library / Gemini Lyria, or local MusicGen (free) | 💡 |
| Sound effects | ★ HeyGen library, or bundled library (free) | 💡 |
| Transcription to word timestamps → captions | — | 💡 |
| Mixing: fades, crossfades, gain, ducking, voiceover carve, loudness matching | — | 🔜 with voiceover |
| Effects: EQ, compressor, limiter, gate, saturation, delay, reverb, chorus, phaser, bitcrush; automation envelopes; audio groups | — | — |
| Beat detection | — | 💡 |

## 6. Editing surfaces

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| Studio (`hyperframes preview`): canvas, timeline (move/trim/split/align), keyframes, gesture recording, captions, audio rack and automation, assets/blocks, variables, source, history, render queue | — | 🔜 internal; Pro tier later |
| WebMCP: Studio exposes editing tools to an in-browser agent | — | 💡 |
| SDK (`@hyperframes/sdk`): headless edits by `hf-id`, undo/redo, patches, persistence adapters, override mode, iframe hit-testing, editing affordances | — | 🔜 revisions and AI edits |
| Variables: typed slots (`string`, `number`, `color`, `boolean`, `enum`, `font`, `image`), `--variables`, batch renders | — | ✅ starter templates |
| Player (`<hyperframes-player>`): live playback, seek, ranges, `setColorGrading()`, runtime data | — | 🔜 live preview |
| `hyperframes history`: list, undo, restore | — | — |

## 7. Quality gates

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| `check`: lint + runtime + layout (clipping/overlap) + WCAG contrast | — | ✅ theme and template gate |
| `snapshot`, `compare`, `grade-compare`, `keyframes`, `inspect`, `timeline`, `info` | — | ✅ previews (`snapshot`) |
| AI frame description (`snapshot --describe`) | ★ Gemini | — |

## 8. Rendering and deployment

| Feature | Account | VideoSaaS |
| --- | --- | --- |
| MP4, MOV, WebM, GIF, PNG; quality, fps, resolution; batch; render provenance; `benchmark` | — | ✅ MP4 |
| Local / Docker rendering | — | ✅ worker on Railway |
| AWS Lambda, Google Cloud Run distributed rendering | — (your cloud account) | 💡 at scale |
| HeyGen managed cloud rendering | ★ HeyGen | — |
| Hosted templates (Vercel, Cloudflare, Modal) | — (host account) | — |
| `publish` to a stable private URL | ★ HeyGen to keep ownership | — |
| Hosted MCP connector | ★ HeyGen | — |

## 9. Packages (all Apache-2.0)

`hyperframes` (CLI), `@hyperframes/core`, `parsers`, `lint`, `engine`, `producer` (render from Node), `player`, `sdk`, `studio`, `studio-server`, `shader-transitions`, `aws-lambda`, `gcp-cloud-run`.

## 10. Agent support

21 published skills: router (`/hyperframes`), domain skills (`core`, `animation`, `creative`, `cli`, `keyframes`, `registry`, `audio`, `studio`, `media-use`, `figma`), and workflows. Plugins for Claude Code, Codex, Cursor, Gemini CLI, Copilot. This project vendors 12 skills in `.claude/skills/` (see `HYPERFRAMES-SOURCE.md`).
