# Benchmark frame analysis: the two target videos, five frames per second

Written 2026-10-09. This is the detailed companion to [BENCHMARKS.md](BENCHMARKS.md) (which holds the summary, metrics and gates).
Method: each video was played in the browser and every **0.2 s** (5 frames per second, 75 frames per video) was captured and read
in 5-second parts: first 0-5 s, then 5-10 s, then 10-15 s. For each part we note what is on screen at each step, how it moves,
and which of our modules (see `worker/templates/showreel/`) must be able to produce it. Third-party product UI and copy are studied, never copied.

Source posts: **A** = Ann Nguyen https://x.com/ann_nnng/status/2103723183899852885 (1920x1080 as served, 15.06 s),
**B** = Tony Dinh https://x.com/tdinh_me/status/2103705600542601511 (video quoted on A's page, 640x360 as served, 15.06 s). Both sell the
same product, so both end on the same lockup; everything else differs, which is why they are a good pair.

Reading the tables: times are the frame's time in seconds. "→" means the state keeps changing over the next frames.
At 120 BPM a beat is 0.5 s; both films cut on or very near beats (A's HUD even prints "120 BPM").

---

## Benchmark A: light, systematic, text-as-UI

Persistent system on every scene: pale lavender-white ground (≈#eef1f6) with a very faint blue glow low in the frame, a dotted grid (and, in the first
scene, hairline guides), **four tiny mono HUD labels in the corners** (top-left "MOTION", top-right scene tag "01 · MODELS" → "02 · …" → "04 · TEAMS" → "05 · BRAND",
bottom-left a running timecode "00:00:12 ● 120 BPM", bottom-right "1920×1080 · 60FPS"). The HUD text changes per scene, which is itself motion.

### Part 1: 0.0-5.0 s. Hook, then the product's own action

| t | On screen | Motion |
|---|---|---|
| 0.0 | Empty light ground, HUD only | Hold of a single frame; the first word arrives immediately |
| 0.2 | "Chat" half revealed, baseline tilted, bottom clipped | Words rise out of a **mask line**, with a slight skew/rotation that settles (kinetic type, not a fade) |
| 0.4 | "Chat with" fully up, "with" still sitting a few px low | Second word lands 0.2 s after the first: stagger of one frame-step per word |
| 0.6 | Green pill appears at the right of "Chat with", text inside blurred ("GPT" cut by the pill's edge) | Pill grows from nothing; its label is masked by the pill and blurs in |
| 0.8 | Pill reads **GPT-5** (green), **blue selection box with corner handles and a small blue size tag** under it ("165 × 105"-style) | The pill is "selected" like in a design tool: the handles and the size tag are part of the animation |
| 1.0 | Pill is **Claude** (terracotta). Handles resized to the new pill | Word swap #2: pill width animates to fit, colour changes with the word |
| 1.2 | Claude → Gemini mid-swap: two labels overlap, vertically blurred, pill colour is a mix | Swap is a vertical slide with blur on both words, colour cross-fades |
| 1.4 | **Gemini** (blue-purple gradient pill) | Gradient is a second visual language, only for this word |
| 1.6 | Gemini → Mistral mid-swap (indigo pill, blurred stack) | Same swap, 0.2 s later |
| 1.8 | **Mistral** (red-orange pill, label still sliding) | |
| 2.0 | **Qwen** (violet pill) | The cycle is **one word every 0.2-0.4 s**: five words in 1.4 s, fast but each is readable for ~2 frames |
| 2.2 | Final pill **every model.** (solid blue, white text), size tag "205 × 106" | The cycle resolves on the product's promise: the last word holds longest |
| 2.4-2.6 | Same, whole line drifts left and very slightly down | A slow push (≈2%) so the hold is never frozen |
| 2.8 | Exit: "with" and the pill split, the pill gets a horizontal motion blur and rotates, "with" sits low | **Exit by whip**: elements leave with blur, the next scene is already starting |
| 3.0 | New scene: a **white composer bar** (rounded, soft shadow, blue circular send button) centred at lower third, nothing else | Scene starts with one element on an empty ground; HUD tag changes |
| 3.2 | Three **model chips** above the bar (GPT-5 with a green dot, a hint chip), placeholder "Press "/" to focus input", icon row below | Chips pop in with a small overshoot; placeholder is real UI copy |
| 3.4 | Typing: "Pla" with a **caret**, chips GPT-5 / Claude / Gemini now all there | Typing at ≈12 chars/s; chips arrive in order |
| 3.6 | "Plan our p" | |
| 3.8 | "Plan our product" caret blinking | |
| 4.0 | "Plan our product launch", send button **pressed** (ring around it) | The press is shown: a ring pulse on the button |
| 4.2 | Bar is empty again; the sent text is a **smeared gray streak** flying up | The message leaves as a motion-blurred streak (a "send" whoosh drawn, not faded) |
| 4.4 | Message lands top-right as a **blue pill** "Plan our product launch"; three **answer cards** (GPT-5, Claude, Gemini) fly in from different depths, tilted, the composer drops to the bottom | Cards enter with different offsets and rotations (a staggered 3D settle), all landing within ~0.3 s |
| 4.6 | Headline "Ask them" appears at top-left (the last word still arriving), cards straight, small timers "0.2s / 0.3s / 0.1s" in the card headers; typing has started in each card | Headline built word by word, cards **type in parallel** with different speeds |
| 4.8 | "Ask them all at once." full, with the period in black; cards 60% typed; answers differ in length | Different-length answers feel like live work |
| 5.0 | Same, cards nearly full, blinking black dots as carets | |

What to take from Part 1: the opening is **a text-edit performed on screen** (selection handles, a pill that resizes, a rapid word cycle that lands on the claim),
then the **product's own action** (type, send, three answers) with a pressed-button ring and a blurred message streak. First 3 s contain only two compositions, each with one idea.
Our modules: `hook-kinetic` (+ pill word cycle, new), `hook-type` (+ send ring, streak, new), `trio-cards` / `chat-demo`.

### Part 2: 5.0-10.0 s. Scale reveal, then the hub, then the proof

| t | On screen | Motion |
|---|---|---|
| 5.2-5.4 | Cards keep typing; answers are 4-5 lines; headline and pill unchanged | A calm 0.6 s so the viewer reads the answers (the first quiet stretch) |
| 5.6 | Cards blur slightly and shift up-left | Start of the **camera pull-back**: whole scene scales down and blurs |
| 5.8 | Scene is a small card in the middle, other cards (pink dot, green dot) rushing in at the edges | Zoom out (≈ ×0.4 within 0.2 s) with motion blur; this is the 0.05 motion peak |
| 6.0 | **Wall of 3x4 department cards** (Marketing, Engineering, Sales, Support, Design, Operations, Product, Data, Leadership, Research, Finance...), each a mini UI with a colour dot, a title bar and coloured lines; the original card sits among them | The reveal of scale: one idea became many. Same component, different content and colour |
| 6.2 | A line "Now for your" arrives at the wall's centre, bottom half masked | Text rises from a mask over the wall; wall slightly blurred behind it |
| 6.4 | "Now for your whole **team**" ("team" in blue) | |
| 6.6-7.0 | "Now for your whole **team.**" hold; the wall slowly drifts | Hold with drift (0.6 s) so the line is read |
| 7.0 | Same; cards start separating | |
| 7.2 | Cards **fly apart in 3D**: each rotates and moves outward, text is gone, perspective strong | Explode: the wall becomes a field in 0.2 s |
| 7.4 | Everything blurred to white-gray smears | **Peak blur frame**: the transition is the blur itself, no cut |
| 7.6 | New scene: wordmark **"TypingMind Teams"** (Teams in blue) centred with a tiny URL under it; ≈14 **satellite cards** arranged on a ring: small icon tiles (colour squares), a dark tile "Self-host or cloud", a burgundy stat tile "5,000+", white feature tiles | Orbit hub: tiles arrive from the blur already in place on the ring, rotating slowly |
| 7.8 | The ring has rotated a few degrees; the tiles that were on the right have moved up | The ring rotates ~8°/0.2 s; tiles keep their upright orientation |
| 8.0-8.6 | Ring keeps rotating; front tiles (stat, dark card) are larger than back tiles; a card passes in front of the wordmark | **Depth by size** (front tiles 1.5x of back ones) and overlap, with the wordmark in the middle never occluded |
| 8.8 | Front tile reads "Custom branding" with a small orange logo; another reads "SOC 2" | The tiles are specific features, readable for 0.2-0.4 s each |
| 9.0 | Wordmark fades to ~35% and blurs; the "Custom branding" tile is the largest and sits at the centre | The hub **hands off** to the feature it is about to show |
| 9.2 | The tile has grown into a card with an "Acme AI" brand, rest blurred | A tile **grows into the next scene** (shared-element transition) |
| 9.4 | Light **browser window** (traffic lights, URL bar, sidebar with lines, big centred logo "Acme AI" orange with a tagline, composer bar at the bottom); left text "Your brand." sliding up from a mask | Scene 5 starts with the app window already full-size |
| 9.6 | "Your brand." (brand in orange) | The accent colour on the key word **matches the window's brand colour** |
| 9.8-10.0 | Same hold, window drifting slowly | |
| 10.0 | Second line begins "Your" | |

Part 2 findings: one **pull-back reveal** (wall), one **orbit hub** (the product as centre, features as satellites rotating with depth), one **shared-element hand-off** (tile → window). All transitions are blur-based, none is a cut. HUD tag changes with each scene ("01 · MODELS", "02 · TEAMS", "04 · BRAND").
Our modules: `wall-zoom` (needs a pull-back with blur; real wall of 12 cards), `hub-orbit` (ring rotation + depth scale + hand-off), `reskin-proof` (new).

### Part 3: 10.0-15.0 s. Proof, burst, resolve

| t | On screen | Motion |
|---|---|---|
| 10.2 | The window **re-skins**: "NovaChat" in violet (sidebar button, logo, accent line colour all violet); text "Your brand. **Your domain.**" ("domain" in violet) | Re-skin morph in 0.2 s: colour of every accented element switches together |
| 10.4 | Same; third line "Your" is starting (masked) | |
| 10.6 | Re-skinned again: **Orbit Assist** in green; third line "Your **data.**" rising from the mask; a faint green radial glow behind the window | Second re-skin; accent word colours follow the brand colour of the moment |
| 10.8-11.0 | Hold: three lines "Your brand. Your domain. Your data." each word in the current accent | A 0.4 s read hold |
| 11.2 | Re-skinned to **KiteWorks** (pink/magenta); lines recolour pink | Third re-skin: four brands in 1.8 s, one every 0.4-0.6 s |
| 11.4 | KiteWorks hold | |
| 11.6 | Resolves to the **real brand**: TypingMind (blue, app icon in the window), lines recolour to blue; the window slightly lifts | Land on the product's real brand: the proof's punchline |
| 11.8 | Window zooms in (blur 15%), the text is gone, the window fills 60% of the frame | Push-in toward the window |
| 12.0 | **Shard burst begins**: a rounded rectangle (the window) is replaced by a dark gradient interior full of **flying triangles** (white, cream, orange, red, brick, gray) with motion blur, still inside a rounded light frame | The one hard hit (0.34 motion). The frame is shaped like the window it came from |
| 12.2 | The rounded frame has gone; full-frame **dark gradient** (maroon top, navy bottom) with large triangles streaking, grain | The light film **cuts to dark** here, on the burst |
| 12.4 | Fewer, bigger shards spread to the corners | Shards decelerate (ease out) |
| 12.6 | Shards swirl back toward the centre in a ring, motion blurred, **the ring contracts** | Reverse: contract (ease in) |
| 12.8 | A **low-poly brain** made of triangles assembles at the centre, with a faint circular ring and tiny drifting dust triangles | Shards snap into the mark. The logo is built from the same shards used for the burst: one visual idea for burst + mark |
| 13.0 | Brain, ring pulsing out from it | Ring is a single shockwave |
| 13.2 | Brain, lifted slightly | |
| 13.4 | Brain shrinks to ~65% and moves left | Mark makes room for the wordmark |
| 13.6 | "**Typi**" typed to the right of the mark, caret visible | **Wordmark is typed**, one letter per ≈0.05 s, same typing language as Part 1 |
| 13.8 | "Typing**Min**" with the blue accent on "Min", caret | The accent colour appears as the letters land |
| 14.0-14.2 | "TypingMind" complete; tagline "The best frontend for LLMs" and **two URL pills** appear below (a dot, the domain, a tiny label) | Tagline and pills fade up with a 0.2 s stagger |
| 14.4-15.0 | Hold; one pixel of drift; a few dust triangles continue to float | Calm last second (motion ≈0.008): the viewer reads the URL |

Part 3 findings: A earns its ending with a **proof sequence** (re-skin x4, four brand colours in under 2 s), then **one burst**, then a **built-from-shards mark**, then a typed wordmark and URL pills. The end card is **dark** while the rest of the film is light, which is the "light film resolves into a dark end card".
Our modules: `reskin-proof` (new), `end-burst` (shards in brand colours that build the mark), `end-cta` / `end-calm` with typed wordmark and URL pill(s).

### A at a glance

| Scene | Start | Length | Beats at 120 BPM | Hero element | Exit |
|---|---|---|---|---|---|
| 1 Chat-with word cycle | 0.0 | 2.8 | 5.6 | pill with selection handles | whip + blur |
| 2 Composer, send, three answers | 3.0 | 2.8 | 5.6 | typed bar → three cards | zoom out + blur |
| 3 Wall of teams + line | 5.8 | 1.6 | 3.2 | 12-card wall | explode to blur |
| 4 Hub (orbit) | 7.6 | 1.8 | 3.6 | ring of 14 tiles around the wordmark | tile grows into window |
| 5 Re-skin proof | 9.4 | 2.4 | 4.8 | one window, four brands | push-in |
| 6 Burst + mark + end | 11.8 | 3.2 | 6.4 | triangles → mark → typed wordmark | none |

Six scenes in 15 s, average 2.5 s, shortest 1.6 s. Every transition is a blur/zoom/explode, never a bare cut.

---

## Benchmark B: dark, cinematic, perspective, rapid-fire features

Persistent system: deep navy ground (#0a132d → #12203a) with a **vignette** (edges darker), a faint **star-field** of tiny dots, and a soft blue glow that
gets brighter in feature scenes (the ground steps from near-black navy to a saturated royal blue around 5.8 s and back, see below). One accent colour (periwinkle #5b7bf5 for the accent half-line),
white type, a **small all-caps mono kicker** above or beside most headlines (e.g. "MULTI-MODEL CHAT", "SELF-HOSTED · PRIVATE · YOUR DATA"). UI panels are dark-mode app screens drawn in perspective.

### Part 1: 0.0-5.0 s. Typed prompt, app lift-off, three answers

| t | On screen | Motion |
|---|---|---|
| 0.0 | Dark navy with strong vignette; a **composer bar** (placeholder "Type "/" to create an AI agent") tilted in 3D, filling the upper-mid frame | Opens on the product's input, tilted and moving |
| 0.2 | Bar now flat, a blue **Send** button appears at the right; text "done|" with caret (typing began) | Camera has levelled the bar in 0.2 s; typing starts at once |
| 0.4 | "Write a tag|" | Typing speed ≈10 chars/s |
| 0.6 | "Write a launch ti|" | |
| 0.8 | "Write a launch tagl|" | |
| 1.0 | "Write a launch tagline for|" | |
| 1.2 | "Write a launch tagline for Ty|"; the bar has grown to full-width as the camera pushes in | Slow push-in during the typing (≈1.05x per second) |
| 1.4 | "Write a launch tagline for Typi|" | |
| 1.8 | Full line "Write a launch tagline for TypingMind"; bar at its largest; the scene starts to **dim and fade** into a dark panel | The typing completes exactly at the push-in's end: **0.4 s hold** on the finished line |
| 2.0 | The bar falls back to a small panel at the bottom; a dark app window forms behind it; an **OpenAI-like mark** appears top-left | Camera pulls back from the bar to reveal the full app window |
| 2.2 | App window (sidebar, big "TypingMind" mark and tagline in the middle, the bar at its bottom); another provider mark (burst) on the right | The brand lockup appears **inside** the product UI, not as a title card |
| 2.4 | Window tilts (perspective) as the camera orbits; four **provider marks** drift around it (left: OpenAI, blue star, right: a sunburst, an "x1") | Marks arrive from the frame edge, one every 0.2 s |
| 2.6-3.0 | More marks appear (whale, Meta, Mistral "M"...) arranged around the window; window keeps rotating (a slow yaw) | Satellite marks = "all models" shown, not said |
| 3.2 | Window 20% bigger; the marks have moved to the corners | |
| 3.4 | Meta infinity mark flies in from the top; the window shrinks | |
| 3.6 | Window slides left and blurs; marks cluster at the left | Start of the whip into the next scene |
| 3.8 | **Three chat panes** side by side (dark UI, text lines, one with a table); each pane has a coloured model icon | The camera has moved right: the screen is now three dense panes, **typed text still arriving** |
| 4.0-4.2 | Panes full of text; one pane shows a small table with two columns; the panes sit lower in the frame | Real-looking density: this is where the "real product" feeling comes from |
| 4.4 | Bottom-left: kicker "MULTI-MODEL CHAT" (tiny mono, letter-spaced) and big white **"One prompt."** | The headline pops with a slight rise; the panes dim by ~35% behind it |
| 4.6 | "One prompt." hold | |
| 4.8 | Second line appears: "**Every model.**" in periwinkle | The accent half-line comes 0.4 s after the white line |
| 5.0 | Both lines hold; panes continue to type | |

Part 1 findings: the opening is a **typed prompt in a tilted composer** (no logo, no title), a **camera that pulls back through the product** and shows the brand inside the UI,
and a **headline with a kicker and an accent half-line** placed over dimmed real UI. 
Our modules: `hook-type` (tilted camera, push-in during typing, pull-back reveal), `trio-cards` with typed text, `lines-stack` with kicker + accent half-line.

### Part 2: 5.0-10.0 s. The rapid-fire feature strip

| t | On screen | Motion |
|---|---|---|
| 5.2-5.6 | "One prompt. **Every model.**" hold over the three panes | 0.6 s read |
| 5.8 | **Background steps to saturated blue**; headline left "All your AI models." (white, bold) with a small kicker above; at the right a **tilted model-picker dropdown** (search, sections, ~10 rows with coloured icons, price tags) | A **hard scene change** with a bright flash of the ground colour; the previous scene exits in <0.1 s. HUD-style kicker "ONE START · CLAUDE · GEMINI · GROK · MORE" |
| 6.0 | Second line "**In one place.**" (blue) appears under it; picker's highlighted row moves | |
| 6.2 | Picker scrolls: a new row is highlighted | The picker is **alive**: a highlighted row travels down the list |
| 6.4 | Picker tilts a few degrees more; the same headline | Slow perspective yaw of the card (the "tilt"): 2-3° per 0.4 s |
| 6.6 | **Whip:** the picker is blurred and flying off to the right; at the left "Your API keys." arrives, bottom still masked, and a dark **input panel** slides in from the right edge | Whip-pan: exiting card smears right, the next card enters from the same side, so it reads as one continuous move |
| 6.8 | "Your API keys." (white, hold); kicker "SELF-HOSTED · PRIVATE · YOUR DATA"; the panel has two key rows | **0.4 s per scene begins here**: the next five scenes are ~0.6-0.8 s each |
| 7.0 | "Your API keys. **Your data.**" (blue second half); panel shows key rows with fields | The accent half-line rides in 0.2 s after the first |
| 7.2-7.4 | Hold with the panel getting a third and fourth key row | The card **adds rows** while the headline holds: motion inside the card keeps the hold alive |
| 7.6 | Cut-in (hard cut): blue headline "**AI Agents**" with kicker "BUILD CHAT & AGENTS"; at the right a tilted **grid of agent cards** | New scene on the beat (7.5 s); headline is one blue phrase, no white half |
| 7.8 | Hold, the grid has drifted ~20 px | |
| 8.0 | Headline "**Plugins**" rising from a mask (kicker "100+ PLUGINS · OR BUILD YOUR OWN"), grid of plugin cards | Scene boundary at 8.0 (beat 16): a **masked rise** on the headline only; the card grid swaps content |
| 8.2-8.4 | "Plugins" hold; grid drifts | |
| 8.6 | "**Code**" (kicker "CLEAN, FORMATTED ANSWERS"); a **code panel** with highlighted lines tilted in | Another beat boundary; the card changes to code UI |
| 8.8 | Hold | |
| 9.0 | "**Commands**" (kicker "EVERYTHING, ONE KEYSTROKE AWAY"); a **command palette** card (search, list with icons) | Beat boundary; same layout again |
| 9.2 | Hold; the palette highlights a row | |
| 9.4 | **Camera dive**: the layout is gone; a **steep-perspective field of dozens of app windows** (dark and a bright white one) fills the frame; headline "The AI client" (white, top-left of centre) rising from a mask | Ground: from the saturated blue to near-black; the dive comes with a quick blur-in (a 0.2 s zoom-through) |
| 9.6 | "The AI client" hold; field drifts toward the camera | Field is a **3D plane of ~30 windows** with the camera gliding along it (slow, 6 px/frame) |
| 9.8 | Hold | |
| 10.0 | "The AI client **you actually own.**" second line appears (periwinkle) | Same accent-half-line timing again (0.4 s after line 1) |

Part 2 findings, the key lessons from B: (1) the **rapid-fire strip**: five feature scenes in 3.4 s (AI models / API keys + data / AI Agents / Plugins / Code / Commands), every one the same layout (kicker + headline left, one tilted UI card right) with a different card; this is the "fast and understandable" pacing the user wants. One feature per 0.5-0.8 s, always in a headline of 1-3 words;
(2) card **internal motion** (a highlighted row, rows being added) so no hold is static; (3) a **kicker/headline/accent half-line** system that repeats on every scene; (4) the ground brightness is used as a rhythm tool (saturated blue for features, near-black for the dive and the calm lines).
Our modules: `rapid-fire` (NEW: 4-6 mini-scenes of the same layout, different card, 0.5-0.8 s each, with whip or hard cut on the beat), `field-3d` (windows in steep perspective with camera glide).

### Part 3: 10.0-15.0 s. Field, the calm line, end card

| t | On screen | Motion |
|---|---|---|
| 10.2-10.8 | "The AI client **you actually own.**" hold over the field; one window brightens (white) then dims | 1 s read with the field gliding (the longest hold of the film) |
| 11.0 | Same | |
| 11.2 | Field blurs heavily; headline is gone; screen is mostly dark with a white window glow | Blur-out: a "zoom into the field and fall through it" |
| 11.4 | **Empty navy** with star dots and vignette; "No subscription." in white, centred | A **text-only breath**: the one scene with no UI at all. Appears in a single frame (hard) |
| 11.6 | Hold | |
| 11.8 | "No subscription." moves up; "Pay once." appears under it | The second line **pushes the first up** (a stack with re-centering) rather than being placed below |
| 12.0 | "No subscription." dims to 55% gray; "Pay once." white | Previous line dims when the next one lands: a focus ladder |
| 12.2 | Third line "**Use forever.**" (large, periwinkle) rises in; first two lines dimmed gray; a **review badge** appears at the bottom (laurel icon, 4.8 stars) | The third line is 25% larger than the others: scale climbs line by line |
| 12.4 | Badges: **two** award laurels with star ratings | Social proof arrives under the climax |
| 12.6 | **Three** laurels in a row with stars; a small line "Trusted by 20,641+ happy customers" | A specific number, not "thousands" |
| 12.8 | Same, brighter | |
| 13.0 | **Pure black frame** (one 0.2 s dip) | A **dip to black** before the end card, on the beat (13.0 = beat 26) |
| 13.2 | **Ripple rings** expanding from the centre over the navy; the app **icon** (rounded square with the brain mark) pops in at the centre | Shockwave rings + a mark pop with overshoot: the "logo sting" |
| 13.4 | Rings are faint; the icon is small and has moved slightly | |
| 13.6 | Icon left, wordmark "Typing" **typed** with the letters arriving with a tiny blur, caret; the rest as "TypingMir" at 13.6 (a letter mid-draw) | Typed wordmark, same as A |
| 13.8 | "TypingMind" with "Mind" in periwinkle; tagline "The best frontend for LLMs" small and gray under it | |
| 14.2 | Same plus a **URL pill** under the tagline (one pill, "typingmind.com") | Pill fades up 0.2 s after the tagline |
| 14.4-15.0 | Hold; the pill softly pulses | Calm last 0.8 s |

Part 3 findings: **breath → climb → dip → sting**. After the busiest, brightest scene (the field) the film drops to a single quiet text scene,
builds three lines whose size and colour climb (white → gray → big accent), adds social proof, **dips to black for one beat**, and ends with a logo sting (rings + icon pop) and a typed wordmark.
Our modules: `lines-stack` variant `climb` (NEW: each new line dims the previous ones and is larger), `proof-bar` (NEW: laurel/rating badges with one real number), `end-sting` (NEW: black dip, rings, icon pop, typed wordmark).

### B at a glance

| Scene | Start | Length | Beats at 120 BPM | Hero element | Exit |
|---|---|---|---|---|---|
| 1 Typed prompt, tilted composer | 0.0 | 1.9 | 3.8 | the bar, push-in during typing | pull-back reveal |
| 2 App lift-off with provider marks | 1.9 | 1.9 | 3.8 | window, marks flying in | whip to the right |
| 3 Three panes + "One prompt. Every model." | 3.8 | 2.0 | 4.0 | three dense chat panes | hard change to bright blue |
| 4 "All your AI models." + picker | 5.8 | 0.8 | 1.6 | tilted picker | whip right |
| 5 "Your API keys. Your data." | 6.6 | 1.0 | 2.0 | key panel | hard cut |
| 6 "AI Agents" | 7.6 | 0.4 | 0.8 | agent grid | cut |
| 7 "Plugins" | 8.0 | 0.6 | 1.2 | plugin grid | cut |
| 8 "Code" | 8.6 | 0.4 | 0.8 | code panel | cut |
| 9 "Commands" | 9.0 | 0.4 | 0.8 | command palette | dive |
| 10 Field + "The AI client you actually own." | 9.4 | 1.8 | 3.6 | 30-window field | blur out |
| 11 "No subscription. Pay once. Use forever." + proof | 11.4 | 1.6 | 3.2 | text only + laurels | dip to black |
| 12 Logo sting + wordmark + URL | 13.0 | 2.0 | 4.0 | rings, icon, typed wordmark | none |

Twelve scenes in 15 s, average 1.25 s, with five of them under 1 s. This is faster than A but never confusing: every fast scene reuses **one layout**, so the eye does not have to re-learn the frame.

---

## What the two films prove (decisions for our modules)

1. **Two valid speeds.** A: six scenes, 1.6-3 s each, blur transitions, light ground. B: twelve scenes, five of them under 1 s, hard cuts/whips on the beat, dark ground. Our personalities map to these: *explainer/calm* → A-like rhythm; *bold/premium* → B-like rhythm.
2. **A scene is never idle.** Even a hold of 0.6 s contains motion inside it: a highlighted row travelling, rows added, a slow yaw, a drifting field, a caret, a word cycle.
3. **Text hierarchy is a system.** Kicker (tiny mono caps) + headline (white) + accent half-line (brand colour 0.2-0.4 s later). It repeats on every text scene in B; in A the accent word takes the brand colour of the window on screen.
4. **Proof by showing.** A re-skins one window four times in under two seconds; B puts a real number on a laurel bar. Neither says "customisable" or "trusted" without showing it.
5. **One climax, built from the logo's own material** (A: the burst's shards become the mark), preceded by a breath (B: text-only scene) and followed by a typed wordmark and URL pill(s).
6. **Transitions carry blur** (A: 5.8, 7.4, 11.8, 12.2) or are on-beat hard cuts with a bright/dark flip of the ground (B: 5.8, 7.6, 11.4, black dip at 13.0).
7. **Beat grid.** Boundaries sit within one frame-step of a half-second: A at ≈3.0, 5.8, 7.6, 9.4, 11.8; B at ≈1.9, 3.8, 5.8, 6.6, 7.6, 8.0, 8.6, 9.0, 9.4, 11.4, 13.0 (multiples of 0.2 s; most are on beats).

## New modules these frames require (gap list)

| Module | From | What it must do | Status |
|---|---|---|---|
| `rapid-fire` | B 6.6-9.4 | 4-6 mini-scenes with one layout (kicker + headline left, a tilted UI card right, different card each), 0.4-0.8 s each, accent half-line, whip or cut on the beat, internal card motion | to build |
| `pill-cycle` (hook variant) | A 0.0-2.8 | "Chat with [word]" with a selection box + size tag, a word cycle every 0.2-0.4 s with vertical blur and colour change, resolving on the claim | to build |
| `send-streak` (hook-type variant) | A 4.0-4.4 | pressed send button ring, the message leaves as a blurred streak and lands as a pill, answers arrive | to build |
| `reskin-proof` | A 9.4-11.8 | one app window re-skinned 3-4 times (name, mark, accent) in <2 s, headline accent follows the brand colour, lands on the real brand | to build |
| `lines-stack` `climb` variant | B 11.4-12.8 | lines dim previous ones, each larger than the last, last in accent | to build |
| `proof-bar` | B 12.2-12.8 | 1-3 laurel/rating badges + one specific number line | to build |
| `end-sting` | B 13.0-14.2 | dip to black on the beat, shockwave rings, mark pop, typed wordmark, URL pill | to build |
| `end-burst` shards→mark | A 12.0-13.6 | shards in brand colours converge into the mark, then typed wordmark + two pills | exists (burst), extend |
| `field-3d` | B 9.4-11.2 | dozens of windows in steep perspective, slow camera glide along the plane, one window brightening | exists, extend |
| `hub-orbit` | A 7.6-9.2 | ring rotation, depth by size, hand-off of one tile into the next scene | exists, extend |
| `wall-zoom` | A 5.6-7.2 | pull-back with blur to a 12-card wall, then explode to blur | exists, extend |
| Persistent HUD | A all | four corner micro-labels with scene tag and live timecode/BPM | exists (hud) |
| Ground flip | B 5.8, 9.4, 11.4 | scene-level change of ground brightness (navy → saturated brand colour → near-black) on a cut | to build (engine feature) |

## How to use this document when making a film

- Choose the speed first (A-like or B-like), then pick modules; check the draft against the **at a glance** tables: scene count, scene lengths, boundary times on the beat grid.
- A film is **at the bar** when it has: a first-second action that is the product's own (typing, a word cycle), at least one scale reveal, one hub or field, one proof-by-showing scene, one breath, one climax with a mark built from its material, a typed wordmark and a URL pill, a continuous motion in every hold, and `scripts/benchmark-metrics.mjs` inside the envelope in BENCHMARKS.md.
- Frame captures of both videos were taken at 0.2 s steps for this analysis and are not stored in the repo (third-party content); re-run the capture with `scripts/capture-benchmark-frames.js` (browser console on the tweet page) if a frame needs to be re-read.
