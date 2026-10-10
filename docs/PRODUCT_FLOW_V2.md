# Product flow v2: Script & Style → Storyboard → Motion → Render → Review

Status: **in progress** (2026-10-05). Replaces the Goal step and reorders the creation flow around the
script director (`/gm-script-director`) and the skill library.

What else is held for v2 (engine and feature items): [docs/v2/PLAN.md](v2/PLAN.md).

| Part | Owner | Status |
|---|---|---|
| Contracts: `ScriptBrief`, `BeatPlan`, budgets, `beatPlanProblems` (`packages/contracts/src/beat-plan.ts`) | pipeline session | ✅ done |
| Director: `POST /v1/projects/:id/plan` (Claude structured output, one repair round, own-words guard, invented-number/claim check, deterministic fallback) | pipeline session | ✅ done, tested live |
| Storyboard edits: `PATCH /v1/projects/:id/plan` (budgets enforced, 422 with problems) | pipeline session | ✅ done, tested live |
| Live composition source: `GET /v1/projects/:id/composition` (+ `beatTimes`) | pipeline session | ✅ `engine: "beat-plan"` |
| Director prompt compiled from the skill files (`npm run director:prompt`) | pipeline session | ✅ done |
| Script & Style screen, live storyboard (player 0.8.111); Goal and Brand steps removed | Design review session | ✅ done |
| Beat-plan composition engine, any duration and aspect (`worker/templates/beat-plan`, preview `GET /v1/preview/plans/:id`, `backend/src/plan/timing.ts`) | pipeline session | ✅ done: 3 test plans pass check, pacing and duration (`experiments/beat-engine/NOTES.md`) |
| Audio: `POST /v1/projects/:id/plan/audio` (Gemini TTS per line, cached; Whisper word times drive the clock; Lyria 3 bed ducked under words; Pixabay SFX on cuts, clicks and success), `backend/src/plan/{audio,voice,music,sound,pcm}.ts` | pipeline session | ✅ done: test render every take within 4 ms, -15.2 LUFS (`experiments/plan-audio/`) |
| Render project builder (`backend/src/plan/render-project.ts`): the storyboard page + all assets for a CLI or worker render | pipeline session | ✅ done; the worker hookup comes next |
| Storyboard sound toggle (player is `muted`), call `/plan/audio` after plan and edits | Design review session | ⏳ requested |
| Product URL: `POST /v1/projects/:id/site` reads the site (facts for the director as fenced untrusted data, labelled section screenshots, HTML/CSS snapshots, brand suggestion); `brief.productUrl`; `backend/src/site/` | pipeline session | ✅ done: linear.app in 29 s; private addresses refused; plan routed 4 ui beats to site sections |
| URL field on the Script card, brand autofill, site shots in the Screenshots panel | Design review session | ⏳ requested |
| Site read as a worker queue job (the backend image has no browser: `html-only` there) | Design review (queue) | ⏳ later |
| Generated 3D or footage clips in the engine | pipeline session | ⏳ later |
| Motion-direction queue stage (`directing`, `assembling`) | Design review (queue) + pipeline (work function) | ⏳ later |
| Variable duration in render-plan; `"square"` format | coordinated | ⏳ later |

```
1 Script & Style ──► 2 Storyboard ──► [Submit] ──► 3 Motion direction ──► 4 Render ──► 5 Review ──► (Studio)
   brief or script      live frames,       (approval)    skills in parallel      worker queue     comments, AI edits,
   + all choices        real-time edits                  per beat                                  re-render
```

## 1. Script & Style (the new first screen)

Everything the film needs is chosen here, on one screen. There is no separate Goal step; the goal
is inferred from the brief (or picked from an optional dropdown).

| Control | Options | Feeds |
|---|---|---|
| **Script** | *Describe the problem* (we write it) · *Paste my script* (kept verbatim; we only suggest edits) | script director mode B / A |
| **Duration** | 15s · 30s · 45s · 60s · 90s (custom 10–120s) | beat count and structure (script-for-motion → Structure) |
| **Aspect ratio** | 16:9 · 9:16 · 1:1 | canvas; layouts are re-laid, not scaled |
| **Theme** | Pick from the gallery · use a saved brand kit · **paste a website URL** (extracts name, colours, fonts and logo via the existing `POST /v1/brands/extract`, reviewed before saving) · paste colours and upload a logo | brand tokens |
| **Motion style** | Snappy · Smooth · Springy (the brand motion profile), plus an optional template (Feature explainer, Velocity sting, …) | eases, durations, camera, copy tone |
| **Audio** | Voiceover · Music · Both · None; voice choice; music mood | VO / Lyria / library |
| **Pace** | Calm · Balanced · Fast | words per minute, gaps, shot length, cut rate (within the pacing gates) |
| **Captions** | Key phrases · Full captions · Off | captions overlay |
| **Screenshots** | Upload 1–N real product screens (drag to order, label purpose) | `ui` beats |

The **Generate** button runs the script director and returns `SCRIPT.md` (editable inline, with
accept/reject suggestions for pasted scripts) plus the beat plan. Duration and aspect ratio can be
changed here later; doing so re-plans the beats.

### Next release: style grammar and prompt references

The implementation library is **HyperFrames** for the editable composition, live storyboard and
final render path. The product currently pins HyperFrames `0.8.111` (`hyperframes`,
`@hyperframes/player`, `@hyperframes/lint`, `@hyperframes/parsers`); 3D or generated footage is a
beat producer (`threejs`, `nanobanana+veo`, `veo-footage`) that hands finished material back into
the HyperFrames assembly. Build style recipes as HyperFrames primitives first: timed text, DOM/SVG
layers, CSS variables, GSAP-compatible timelines, camera transforms, player variables and runtime
checks.

Research source: Lemomo's OPUSCAR 98 catalog
(`https://lemomo-ai.github.io/lemo-opuscar/opuscar98/styles.json`) and repo
(`https://github.com/lemomo-ai/lemo-opuscar`). Treat this as a reference pack, not a runtime
dependency. The source catalog has 98 styles: 77 2D, 4 2.5D and 17 3D. Each entry exposes
`style_en`, `style_zh`, `render`, `dim`, `blend_*`, `desc_*`, `prompt_en`, `prompt_zh`, `shots`,
`direction_*` and `refs`.

Local reference clone: `third_party/lemo-opuscar` (Git commit `a75e2b3`, cloned 2026-10-10). This
copy includes the style prompt files, demo source, posters, style frames, the local OPUSCAR 98 JSON
at `third_party/lemo-opuscar/styleboard/opuscar98_styles.json`, plus the GitHub Releases `web`
preview MP4s cached into the paths expected by the gallery. Serve it from the clone root:

```sh
cd third_party/lemo-opuscar
python3 -m http.server 8127 --bind 127.0.0.1
```

Preview URLs while the server is running:

- Gallery: `http://127.0.0.1:8127/styleboard/`
- OPUSCAR 98 page: `http://127.0.0.1:8127/styleboard/opuscar98/`
- Hologram HUD video: `http://127.0.0.1:8127/styles/hologram-hud/hologram-hud.mp4`
- Glass product video: `http://127.0.0.1:8127/styles/glass-product/glass-product.mp4`

Prompt reference handling:

- Keep source URLs, style names, render mode, tone, shot grammar and direction field names as
  provenance.
- During recipe authoring, look up the source JSON fields `prompt_en` / `prompt_zh`, `shots` and
  `direction_*`, then paraphrase them into original Greedy Motion recipes. Do not vendor long source
  prompt bodies verbatim into runtime prompts or docs.
- Product recipes must explain how to reproduce the look in HyperFrames: layout layers, material
  treatment, motion timing, camera moves, text behavior, acceptance checks and fallback behavior.
- The first product-facing subset should include `Sci-fi Hologram HUD`, `Glass Product Render`,
  `Blueprint`, `Data Storytelling`, `Isometric Infographic`, `Dark Tech Keynote`,
  `Living Screencast`, `Pictogram Motion`, `Black-Gold Art Deco Revue Poster`,
  `Cyanotype Engineering Blueprint`, `Architectural Section Axonometric`,
  `EOD Technical Manual Line Art`, `Window Marker & Chalk, Gold Pattern` and
  `3D Particle Fireball, IMAX Grain`.

#### Prompt reference: Sci-fi Hologram HUD x Glass Product Render

Use this as the canonical product-showcase recipe for the next builder. It is based on the local
prototype at `validation/opuscar-hud-glass/index.html`, but the production version should be a
HyperFrames composition, not a standalone webpage.

Authoritative local references:

- Hologram prompt: `third_party/lemo-opuscar/styles/hologram-hud/STYLE.md`
- Hologram demo source: `third_party/lemo-opuscar/styles/hologram-hud/demo/`
- Hologram preview: `third_party/lemo-opuscar/styles/hologram-hud/hologram-hud.mp4`
- Glass prompt: `third_party/lemo-opuscar/styles/glass-product/STYLE.md`
- Glass demo source: `third_party/lemo-opuscar/styles/glass-product/demo/`
- Glass preview: `third_party/lemo-opuscar/styles/glass-product/glass-product.mp4`

| Field | Reference |
|---|---|
| Product goal | Make an abstract product feel inspectable: introduce it, orbit around it, then punch into a part and annotate the part with product facts. |
| Visual language | Dark technical stage, cyan HUD glow, warm gold accents, transparent glass product body, internal glow, measurement panels, reticle, scan ring, vertical scan beam and timeline readout. |
| HyperFrames producer | `hyperframes` for the full editable composition. Use `threejs` only when the glass object must be physically 3D; otherwise build the product as layered DOM/SVG/CSS shapes for fast edits and deterministic render. |
| Scene structure | 0.0-2.0s: text arrives as a HUD boot sequence. 2.0-4.5s: product rises/floats into center with scan ring and reticle lock. 4.5-7.5s: panels introduce material, product truth and motion grammar. 7.5-10.5s: camera pushes into one product part such as the lens, shell, edge or button. 10.5-12.0s: final lockup and CTA. |
| Motion grammar | Text types or slides in on grid ticks; product floats with tiny rotation; scan beam sweeps across the product; reticle pulses on lock; metric bars fill with staggered timing; camera push uses `scale` plus layer parallax, with product highlights moving slower than HUD panels. |
| Prompt ingredients | "transparent glass product render", "cyan holographic HUD", "dark inspection stage", "warm gold accent", "reticle lock", "scan beam", "measurement UI", "macro product detail", "annotated feature callout", "real product facts only". |
| Acceptance checks | The product is the first-viewport signal, the product remains readable on 16:9/9:16/1:1, no text overlaps the product detail, HUD labels bind to verified facts, and the zoom-in has at least one annotated part callout. |
| Fallback | If 3D generation is unavailable, render the product as a layered CSS/SVG glass object with highlights, inner glow and parallax; keep the HUD scan and annotation motion intact. |

#### Full OPUSCAR 98 inventory

Use these as style grammar references when expanding the style picker. The source prompt bodies stay
in the upstream JSON; this table records the usable product taxonomy.

<details>
<summary>98 reference styles</summary>

| No. | Source | Style grammar | Render | Tone | Chapter |
| ---: | --- | --- | --- | --- | --- |
| 1 | 1927/28 Wings | Silent-era 3D Dogfight, Tinted Ortho B&W | 3D | 3D·B&W | Silents & Talkies (1927–1938) |
| 2 | 1928/29 The Broadway Melody | Black-Gold Art Deco Revue Poster | 2D | 2D | Silents & Talkies (1927–1938) |
| 3 | 1929/30 All Quiet on the Western Front | Kollwitz Anti-war Woodcut | 2D | 2D·B&W | Silents & Talkies (1927–1938) |
| 4 | 1930/31 Cimarron | 1889 Sepia Albumen Panorama | 2D | 2D·Sepia | Silents & Talkies (1927–1938) |
| 5 | 1931/32 Grand Hotel | MGM Silver B&W 3D Lobby | 3D | 3D·B&W | Silents & Talkies (1927–1938) |
| 6 | 1932/33 Cavalcade | Mucha Art Nouveau Panel | 2D | 2D | Silents & Talkies (1927–1938) |
| 7 | 1934 It Happened One Night | 1930s B&W Rubber-hose Cartoon | 2D | 2D·B&W | Silents & Talkies (1927–1938) |
| 8 | 1935 Mutiny on the Bounty | Admiralty Sea Chart Copperplate | 2D | 2D | Silents & Talkies (1927–1938) |
| 9 | 1936 The Great Ziegfeld | Silver B&W 3D Wedding-cake Stage | 3D | 3D·B&W | Silents & Talkies (1927–1938) |
| 10 | 1937 The Life of Emile Zola | Newsprint Letterpress and Line Engraving | 2D | 2D·B&W | Silents & Talkies (1927–1938) |
| 11 | 1938 You Can't Take It with You | WPA Silkscreen Poster | 2D | 2D | Silents & Talkies (1927–1938) |
| 12 | 1939 Gone with the Wind | Technicolor Impasto Oil | 2D | 2D | Colour & War (1939–1949) |
| 13 | 1940 Rebecca | Gothic Charcoal Drawing | 2D | 2D·B&W | Colour & War (1939–1949) |
| 14 | 1941 How Green Was My Valley | Welsh Valley Gouache | 2D | 2D | Colour & War (1939–1949) |
| 15 | 1942 Mrs. Miniver | Home Front Stone Lithograph | 2D | 2D | Colour & War (1939–1949) |
| 16 | 1943 Casablanca | Studio Glamour Black-and-White | 2D | 2D·B&W | Colour & War (1939–1949) |
| 17 | 1944 Going My Way | Backlit Gothic Stained Glass | 2D | 2D | Colour & War (1939–1949) |
| 18 | 1945 The Lost Weekend | Typewriter Character Art | 2D | 2D·B&W | Colour & War (1939–1949) |
| 19 | 1946 The Best Years of Our Lives | Picture-Magazine Halftone Spread | 2.5D | 2.5D·B&W | Colour & War (1939–1949) |
| 20 | 1947 Gentleman's Agreement | 1940s Graphite Magazine Illustration | 2D | 2D·B&W | Colour & War (1939–1949) |
| 21 | 1948 Hamlet | Deep-Focus Fog Castle, 3D B&W | 3D | 3D·B&W | Colour & War (1939–1949) |
| 22 | 1949 All the King's Men | Wood-Type Campaign Poster | 2D | 2D | Colour & War (1939–1949) |
| 23 | 1950 All About Eve | Hirschfeld One-Line Caricature | 2D | 2D·B&W | Widescreen (1950–1959) |
| 24 | 1951 An American in Paris | Dufy Watercolour Ballet | 2D | 2D | Widescreen (1950–1959) |
| 25 | 1952 The Greatest Show on Earth | Strobridge Circus Lithograph | 2D | 2D | Widescreen (1950–1959) |
| 26 | 1953 From Here to Eternity | High-Key Beach Black-and-White | 2D | 2D·B&W | Widescreen (1950–1959) |
| 27 | 1954 On the Waterfront | Ben Shahn Social Realism | 2D | 2D | Widescreen (1950–1959) |
| 28 | 1955 Marty | 1955 Kinescope on a Living-Room TV | 2D | 2D (B&W screen) | Widescreen (1950–1959) |
| 29 | 1956 Around the World in 80 Days | 1950s UPA Modernist Cartoon | 2D | 2D | Widescreen (1950–1959) |
| 30 | 1957 The Bridge on the River Kwai | Cyanotype Engineering Blueprint | 2D | 2D | Widescreen (1950–1959) |
| 31 | 1958 Gigi | Lautrec Belle Époque Lithograph | 2D | 2D | Widescreen (1950–1959) |
| 32 | 1959 Ben-Hur | 3D Circus Chariot Race, 65mm Epic | 3D | 3D | Widescreen (1950–1959) |
| 33 | 1960 The Apartment | Saul Bass Line Titles in Black & White | 2D | 2D·B&W | The Swinging Sixties (1960–1969) |
| 34 | 1961 West Side Story | Technicolor 3D Stage Set | 3D | 3D | The Swinging Sixties (1960–1969) |
| 35 | 1962 Lawrence of Arabia | Terpning Epic Poster Gouache | 2D | 2D | The Swinging Sixties (1960–1969) |
| 36 | 1963 Tom Jones | Hand-Coloured Georgian Satirical Print | 2D | 2D | The Swinging Sixties (1960–1969) |
| 37 | 1964 My Fair Lady | Bob Peak Fashion Illustration | 2D | 2D | The Swinging Sixties (1960–1969) |
| 38 | 1965 The Sound of Music | Storybook 3D Alpine Aerial | 3D | 3D | The Swinging Sixties (1960–1969) |
| 39 | 1966 A Man for All Seasons | Holbein Tudor Portrait in Oils | 2D | 2D | The Swinging Sixties (1960–1969) |
| 40 | 1967 In the Heat of the Night | Three-Ink Risograph Night | 2D | 2D | The Swinging Sixties (1960–1969) |
| 41 | 1968 Oliver! | Victorian Toy Theatre | 2.5D | 2.5D | The Swinging Sixties (1960–1969) |
| 42 | 1969 Midnight Cowboy | Warhol Photo-Silkscreen, Double Elvis | 2D | 2D | The Swinging Sixties (1960–1969) |
| 43 | 1970 Patton | WWII War-Bond Lithograph | 2D | 2D | New Hollywood (1970–1979) |
| 44 | 1971 The French Connection | 16mm Chase Under the El | 3D | 3D | New Hollywood (1970–1979) |
| 45 | 1972 The Godfather | Rembrandt Top-Light Oil Painting | 2D | 2D | New Hollywood (1970–1979) |
| 46 | 1973 The Sting | Saturday Evening Post Illustration | 2D | 2D | New Hollywood (1970–1979) |
| 47 | 1974 The Godfather Part II | Hand-Tinted Sepia Photograph | 2.5D | 2.5D | New Hollywood (1970–1979) |
| 48 | 1975 One Flew Over the Cuckoo's Nest | Hopper-Style American Realism | 2D | 2D | New Hollywood (1970–1979) |
| 49 | 1976 Rocky | Philadelphia Sunrise, 3D on 35mm | 3D | 3D | New Hollywood (1970–1979) |
| 50 | 1977 Annie Hall | New Yorker Cartoon, Ink and Wash | 2D | 2D | New Hollywood (1970–1979) |
| 51 | 1978 The Deer Hunter | Andrew Wyeth Egg Tempera | 2D | 2D | New Hollywood (1970–1979) |
| 52 | 1979 Kramer vs. Kramer | Child's Wax-Crayon Drawing | 2D | 2D | New Hollywood (1970–1979) |
| 53 | 1980 Ordinary People | Autumn Transparent Watercolour | 2D | 2D | The Blockbuster Era (1980–1989) |
| 54 | 1981 Chariots of Fire | 1924 Paris Olympics Stone Lithograph | 2D | 2D | The Blockbuster Era (1980–1989) |
| 55 | 1982 Gandhi | Rajasthani Hand Block Print | 2D | 2D | The Blockbuster Era (1980–1989) |
| 56 | 1983 Terms of Endearment | Family Album Polaroids | 2D | 2D | The Blockbuster Era (1980–1989) |
| 57 | 1984 Amadeus | Rococo Silhouettes in Gilt Candlelight | 2D | 2D | The Blockbuster Era (1980–1989) |
| 58 | 1985 Out of Africa | 3D Biplane over the Rift Valley | 3D | 3D | The Blockbuster Era (1980–1989) |
| 59 | 1986 Platoon | Combat Artist Field Sketch · Pen & Wash | 2D | 2D | The Blockbuster Era (1980–1989) |
| 60 | 1987 The Last Emperor | Gongbi Court Painting on Silk | 2D | 2D | The Blockbuster Era (1980–1989) |
| 61 | 1988 Rain Man | 80s Airbrush + Raymond's Count | 2D | 2D | The Blockbuster Era (1980–1989) |
| 62 | 1989 Driving Miss Daisy | Rockwell-style Oil Illustration | 2D | 2D | The Blockbuster Era (1980–1989) |
| 63 | 1990 Dances with Wolves | Field Journal · Pencil & Watercolour | 2D | 2D | End of the Century (1990–1999) |
| 64 | 1991 The Silence of the Lambs | Hand-coloured Natural-history Copperplate | 2D | 2D | End of the Century (1990–1999) |
| 65 | 1992 Unforgiven | Remington Western Oil · Sunset & Nocturne | 2D | 2D | End of the Century (1990–1999) |
| 66 | 1993 Schindler's List | Black-and-white Film, One Red Coat | 2D | 2D·B&W | End of the Century (1990–1999) |
| 67 | 1994 Forrest Gump | Sabuda Pop-up Book on a Real Desk | 2.5D | 2.5D | End of the Century (1990–1999) |
| 68 | 1995 Braveheart | Illuminated Manuscript with Gold Leaf | 2D | 2D | End of the Century (1990–1999) |
| 69 | 1996 The English Patient | Explorer's Scrapbook Watercolour | 2D | 2D | End of the Century (1990–1999) |
| 70 | 1997 Titanic | Blueprint Developing into 3D Sunset | 3D | 3D | End of the Century (1990–1999) |
| 71 | 1998 Shakespeare in Love | Hilliard Elizabethan Miniature | 2D | 2D | End of the Century (1990–1999) |
| 72 | 1999 American Beauty | Suburban Symmetry + DV Camcorder | 2D | 2D | End of the Century (1990–1999) |
| 73 | 2000 Gladiator | Roman Floor Mosaic | 2D | 2D | The New Millennium (2000–2009) |
| 74 | 2001 A Beautiful Mind | Window Marker & Chalk, Gold Pattern | 2D | 2D | The New Millennium (2000–2009) |
| 75 | 2002 Chicago | Fosse Stage in Red and Black | 2D | 2D | The New Millennium (2000–2009) |
| 76 | 2003 The Lord of the Rings: The Return of the King | Alan Lee Watercolour & Tolkien Map | 2D | 2D | The New Millennium (2000–2009) |
| 77 | 2004 Million Dollar Baby | 16-bit Arcade Fighting Game | 2D | 2D | The New Millennium (2000–2009) |
| 78 | 2005 Crash | LA Night Light Trails & Snow | 2D | 2D | The New Millennium (2000–2009) |
| 79 | 2006 The Departed | Street Stencil on Boston Brick | 2D | 2D | The New Millennium (2000–2009) |
| 80 | 2007 No Country for Old Men | 3D West Texas Dusk, Deakins Light | 3D | 3D | The New Millennium (2000–2009) |
| 81 | 2008 Slumdog Millionaire | Quiz-Show Studio & Mumbai Orange-Teal | 2D | 2D | The New Millennium (2000–2009) |
| 82 | 2009 The Hurt Locker | EOD Technical Manual Line Art | 2D | 2D | The New Millennium (2000–2009) |
| 83 | 2010 The King's Speech | Peeling Wall & Gold Broadcast Booth | 2D | 2D | The Indie Decade (2010–2019) |
| 84 | 2011 The Artist | Polished Silent-Film Black & White | 2D | 2D·B&W | The Indie Decade (2010–2019) |
| 85 | 2012 Argo | Jack Kirby 70s Comic Page | 2D | 2D | The Indie Decade (2010–2019) |
| 86 | 2013 12 Years a Slave | Cased Daguerreotype, Developing | 2D | 2D·B&W | The Indie Decade (2010–2019) |
| 87 | 2014 Birdman | 3D Backstage Long Take | 3D | 3D | The Indie Decade (2010–2019) |
| 88 | 2015 Spotlight | Microfiche Reader, Newsprint Halftone | 2D | 2D | The Indie Decade (2010–2019) |
| 89 | 2016 Moonlight | Moonlight-Blue Oil Portraiture | 2D | 2D | The Indie Decade (2010–2019) |
| 90 | 2017 The Shape of Water | 3D Underwater Teal Caustics | 3D | 3D | The Indie Decade (2010–2019) |
| 91 | 2018 Green Book | 1960s Linen Postcard | 2D | 2D | The Indie Decade (2010–2019) |
| 92 | 2019 Parasite | Architectural Section Axonometric | 2D | 2D | The Indie Decade (2010–2019) |
| 93 | 2020 Nomadland | Magic-Hour Soft Pastel | 2D | 2D | Here & Now (2020–2025) |
| 94 | 2021 CODA | Scrimshaw on a Whale Tooth | 2D | 2D | Here & Now (2020–2025) |
| 95 | 2022 Everything Everywhere All at Once | Ray-Marched Multiverse Jump-Cuts | 3D | 3D | Here & Now (2020–2025) |
| 96 | 2023 Oppenheimer | 3D Particle Fireball, IMAX Grain | 3D | 3D | Here & Now (2020–2025) |
| 97 | 2024 Anora | Snowy Neon Night | 2D | 2D | Here & Now (2020–2025) |
| 98 | 2025 One Battle After Another | 3D Dip-Road Chase, Long Lens | 3D | 3D | Here & Now (2020–2025) |

</details>

## 2. Storyboard (fast, live, editable)

- Each beat appears as a **frame card**, drawn **live in the browser** by `@hyperframes/player`
  from the composition and its variables. No server render is needed; a 10-frame board took ~5s
  even as server-side snapshots.
- **Real-time text edits:** typing in a frame's headline, keyword or label updates the frame
  instantly (a HyperFrames variable). Slot budgets are enforced as you type.
- **Quick preview:** a play button plays the draft with the real timing and the draft VO/music, in
  the browser player.
- 3D and footage beats show their **style frame / character sheet** (Nano Banana, approved here)
  and a 2D placeholder in the preview until generated.
- Per frame: swap screenshot, change the key phrase, reorder, remove or restore a beat, pick the
  fallback for a generated beat.
- **Submit** locks the script and storyboard and starts motion direction.

## 3. Motion direction (after submission; skills in parallel)

The server builds the finished composition from the beat plan. Each beat is independent once the
plan and the clock are fixed, so the work fans out:

| In parallel | Skill / tool |
|---|---|
| VO generation → transcript → clock | Kokoro or Gemini TTS, Whisper (`/media-use`) |
| Music bed and SFX | Lyria / library (`/media-use`, `/hyperframes-audio`) |
| Each 2D beat's motion: camera, entry/exit, text effects, cursor | `/motion-doctrine`, `/cut-the-curve`, `/oversized-cursor`, `/hyperframes-animation`, the template's `gm-*` skill |
| Each 3D beat | Three.js on the GPU queue, or Nano Banana → Veo (visual-skills) |
| Each footage beat | character sheet → keyframe → Veo with dialogue (visual-skills) |

Then one **assembly** pass puts everything on the clock: transitions from the seam ledger
(J-cuts under speech, beat snapping), the ducked music, the captions. The gates run: `check`,
pacing (no hold > 0.6s), verb sync, loudness. A failing beat falls back to its 2D version
rather than blocking the film. The user sees stage progress (Writing voiceover · Directing
motion · Generating 3D shots 1/2 · Assembling · Checking).

## 4. Render

The existing `render-video` queue. 2D on CPU workers (~30s per 12s of video at 4 vCPU); 3D beats
arrive as finished clips, so they don't slow the render. The user can leave the page.

## 5. Review

The existing Comment Edit flow: timeline comments → AI revision → accept/reject → re-render.
**Open in Studio** hands the same composition to the pro editor. A pro design can be published
back as a template.

---

## Where the skills live in production

Skills are **instructions and code that ship with our software**, not user data, so they don't go
in S3 and aren't fetched from GitHub at runtime.

| What | Where | Why |
|---|---|---|
| Skill source (`.claude/skills/gm-*`, the vendored HyperFrames skills, `third_party/visual-skills`) | **GitHub (this repo)** | Reviewed, versioned, tested with the code that uses them |
| Skills used by **agents** (motion direction, author mode) | **Baked into the worker image at build time** (CI copies the pinned skills into the Docker image; the agent runs with the Claude Agent SDK, which loads skills from a folder) | Same version as the renderer; no network fetch; rollback with the image |
| Alternative for hosted agents | **Anthropic Skills API** (`client.skills.*`): CI uploads each skill version on deploy; requests reference it by ID | Anthropic runs the container; no skill files on our servers |
| Rules the **one-call planner** needs (script-for-motion, routing, schema) | **Compiled into the backend**: the system prompt and the beat-plan schema, generated from the skill files at build time | The planner is one API call, not an agent; a build step keeps the prompt and the skill in step |
| User assets (screenshots, brand kits, style frames, generated clips, VO, renders) | **R2 (S3-compatible)** | Per-project data |
| Scene and template library (frozen `template/` folders, reusable 3D clips) | **In the image** (templates) + **R2** (large media, per-brand reusable clips) | Templates version with code; heavy media doesn't bloat the image |

**Current implementation (2026-10-09):** Pro Editor Claude proposals use a pinned, stage-routed bundle in the backend image; see [Skill delivery](SKILL_DELIVERY.md#hosted-claude-composition-author-added-2026-10-09). The worker-side Claude Agent SDK described in the table above is a future architecture, not the current runtime.

**Running several skills at once:** the motion-direction job is an orchestrator. It reads the beat
plan and starts one task per beat (plus audio), each with only the skills its beat's `kind`
needs (`gm-script-director/references/routing.md`), then assembles. With the Claude Agent SDK
these are sub-agents; with plain API calls they are parallel requests. Generation calls (Nano
Banana, Veo, Lyria, TTS) all run concurrently.

## What changes in the code (for planning)

| Area | Change |
|---|---|
| Frontend (`studio.tsx`, `prompt-composer.tsx`, `theme-picker.tsx`, `brand-kit.tsx`, `storyboard.tsx`) | Remove the Goal step; the new Script & Style screen; a live-player storyboard with inline variable editing |
| Contracts (`packages/contracts`) | Duration and aspect ratio as request fields (templates are fixed at 10s today); pace; audio mode; motion profile; the beat-plan type from `beat-plan.schema.json` |
| Backend planner | Outputs the beat plan (script director rules compiled in); the `tool_choice` fix for 5.5 models |
| Worker | A motion-direction job (fan-out per beat, assembly, gates) before `render-video`; a GPU queue for 3D |
| Templates | Variable-length compositions driven by the beat plan instead of fixed 10s templates |
