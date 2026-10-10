# Brand kits, music, and voiceover

Date: 2026-10-03. Status: implemented and verified locally (frontend → backend → worker). Storage is the local filesystem; hosted storage moves to R2 with MEDIA-02.

## 1. Brand kits

A brand kit holds a name, website, short description, logo, colors (primary, optional accent, background, text, light/dark look), and heading and body fonts. When a kit is selected, videos use its logo, name, website, colors, and fonts; the gallery theme is switched off.

### Three ways in, one review form

| Path | What happens |
| --- | --- |
| **From website** | `POST /v1/brands/extract {url}` reads the page and up to five stylesheets and suggests name, description, colors, fonts, and logo. Nothing is saved until the user reviews and confirms. |
| **Upload** | `PUT /v1/brands/assets/logo` or `/font` with the file bytes. |
| **Manual** | Color pickers or hex; fonts from the 20 built-in families, any Google font by name, or an uploaded file. |

The dialog shows a live preview built with the same `deriveBrandTheme` code the renderer uses, plus every adjustment it made.

### Website extraction

| Signal | Source |
| --- | --- |
| Name | `og:site_name`, `application-name`, then `<title>` |
| Colors | `theme-color` meta, CSS custom properties named like primary/brand/accent, frequency of saturated colors; greys and pale tints are down-weighted |
| Fonts | Google Fonts links and `@import`, `font-family` usage (heading vs body selectors); self-hosted `@font-face` fonts are reported but **never downloaded** (licensing) |
| Logo | 1) image or inline SVG inside the header link to the home page, 2) header image or SVG naming the brand or "logo", 3) app icon, 4) any image named after the brand. Customer-logo walls are why the home link wins. Inline SVGs colored only by page CSS are skipped. |

Tested on Stripe, Linear, Figma, Vercel, and Notion: correct logo on 4 of 5 (Notion returned a sibling product icon), correct primary color on 3 of 5 (Linear's brand color lives in JS-generated CSS; the review step catches it).

### Safety

- **SSRF-safe fetching** (`backend/src/brand/safe-fetch.ts`): http/https on ports 80/443 only, no URL credentials, private/loopback/link-local/CGNAT/metadata ranges refused, and the IP is checked inside the socket's DNS lookup so a hostname cannot rebind to an internal address. Redirects re-validated (max 3), size and time capped. Verified to refuse `localhost`, `127.0.0.1`, `169.254.169.254`, `file://`, URL credentials, and `localtest.me` (a public name resolving to 127.0.0.1).
- **Logos** are decoded and re-encoded to PNG with sharp (pixel limit 40 MP, size 5 MB). SVG is rasterized, so scripts in it never run. Blank or white-only logos are rejected.
- **Fonts** are accepted by binary signature only (WOFF2, WOFF, TTF, OTF; 3 MB). Uploaded fonts get an internal family name; the user's file name never reaches CSS.
- The worker receives brand kits read-only and only by validated id; renderer-owned variables (`logo`, `logoWordmark`) can never be set by callers.

### Brand → theme

`deriveBrandTheme` (`packages/contracts/src/brand.ts`) turns brand colors into the 18-token theme contract and enforces WCAG: body text ≥ 7:1, brand-colored text and the CTA pill ≥ 4.5:1 on background and surface, muted text ≥ 4.5:1. Colors are moved toward black or white only as far as needed, and every change is reported ("Primary #ffd60a was adjusted to #806b05 …"). The original color is kept as the decorative accent.

Verified: `hyperframes check` passes for all four templates with a light kit (Stripe) and a dark kit (Linear): 8/8, WCAG AA.

### Logos in videos

- Templates have a `logo` slot in the reveal and CTA scenes. Without a logo the element is removed.
- **Wordmark detection**: a logo wider than 2.2:1 already spells the name, so the name text next to it is hidden; square icons keep the name beside them.
- **Logo tone**: monochrome logos are classified dark or light. A dark logo on a dark theme (or light on light) is stored inverted for the renderer, and the user is told. Multicolor logos are never altered. The app UI always shows the original.

### Storage

```text
app.brand_kits       kit metadata and adjustments (Postgres, source of truth since 2026-10-07)
var/brands/<id>/      files derived from the kit (the Railway /data volume when hosted)
  logo-original.png   as uploaded (UI)
  logo.png            renderer copy, inverted when needed
  theme.css           derived 18-token theme
  fonts.css, fonts/   downloaded Google or uploaded font files
var/brands/_staging/  uploads and extracted logos awaiting save
```

### Keeping the brand consistent (2026-10-07)

The brand read from a customer's website must reach every video unchanged. What enforces that:

| Guarantee | How | Check |
| --- | --- | --- |
| The brand survives disk loss | The kit row in Postgres is the source of truth; `theme.css` and Google-font files are rebuilt from it on demand (`restoreBrandFiles`, called before every preview and render). Only an uploaded logo or font cannot be rebuilt; it is logged as `brand_files` with `missing`. | `npm run test:brand-files -w backend`: the theme rebuilt from every kit row is byte-identical to the saved one; deleted files come back |
| A brand never changes under a project | Kits are create-only (no update endpoint); a project points at one kit id | — |
| Every colour and typeface comes from the brand | Compositions use theme tokens only (`--bg`, `--brand`, `--accent`, `--font-display`, …); the engine picks contrast-safe inks from them (`--bp-*`) | `npm run check:brand-tokens`: fails on any hard-coded colour or font in the engine, templates or creative compositions |
| New looks and libraries follow the brand | A look changes how marks are drawn, never their colour or font | `npm run check:creative`: every composition is rendered under two brands and must differ; rendered twice under one brand and must be identical |
| Nobody ships a gallery theme by accident | Readiness warns when a project made from a website has no brand kit | Storyboard readiness warnings |

## 2. Music and voiceover

Both use `GEMINI_API_KEY` from `backend/.env` and are optional per video (Sound section of the brief form).

| | Model | How |
| --- | --- | --- |
| Background music | Google Lyria RealTime, `models/lyria-realtime-exp` (`@google/genai`, experimental) | 10 s of 48 kHz stereo PCM streamed and wrapped as WAV; tempo, density, and brightness follow the motion style |
| Voiceover | Gemini TTS, `gemini-3.8-flash-tts`, prebuilt voices Kore, Puck, Charon, Aoede, Fenrir, Leda | Same request shape as HyperFrames' media-use skill; delivery steered with a style annotation |

Claude writes both in the same planning call: a **narration** (≤ 140 characters, about 20 words, following the scene order) and a **music prompt** (mood, genre, instruments; no artist or brand names). Both are covered by the one repair attempt.

Timing: the voice starts at 0.3 s and must end by 9.7 s. A long take is re-read once with a brisker style; if it still runs long the job fails with a clear message instead of cutting speech.

Mix (worker, HyperFrames `<audio>` tracks with a `data-automation` volume lane):

- Music alone: fade in over 0.6 s, hold at 0.85, fade out over the last 0.8 s.
- With voiceover: music ducks to 0.28 while the voice plays, rises back, then fades out.

Measured on a rendered MP4: AAC 48 kHz stereo, ≈ −15 LUFS integrated, near-silent first 0.3 s, full under the voice, fading in the last 0.8 s. Lyria took about 13 s for 10 s of music; TTS about 5 s.

Files: `var/audio/<jobId>/music.wav` and `voiceover.wav`, mounted read-only in the worker at `/audio`.

## 3. Known limits and follow-ups

- Hosted deployment: brand kits and audio are on a shared local disk. On Railway the backend and worker do not share disks, so both move to R2 (MEDIA-02).
- Staged uploads have no expiry yet; add a cleanup job.
- Extraction is heuristic; JS-rendered sites may need manual colors. A Claude vision pass over a page screenshot could improve primary-color and logo picks.
- Lyria RealTime is an experimental Google API and may change; MusicGen (local) is the documented fallback in HyperFrames.
- No per-scene captions from the voiceover yet (Gemini TTS returns no word timings; transcription would add them).
- Uploaded fonts are parsed by Chromium inside the network-blocked, non-root worker; keep it isolated.
