# Generation Quality Tiers & Per-Step Credit Pricing (`v2_step_tier`)

**Date:** 2026-11-09  
**Worktree:** `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-tier-billing`  
**Branch:** `codex/generation-tier-billing` (based on `staging` `64570b6`)  
**Production Billing Status:** **INACTIVE** (`BILLING_POLICY_VERSION` defaults to `"v1_render_only"`; existing projects are grandfathered on `"v1_render_only"`).  
**Test & Benchmark Execution Status:** **NOT EXECUTED** in this pass per explicit user instruction (*"Do not run any new tests, model benchmarks, renders, or provider calls now; use only previous documented data"*). Staging deployment is left pending until the recorded test suite is executed.

---

## 1. Executive Summary & Architectural Decisions Applied

1. **Free-vs-Paid Animation Tier Entitlement (`standard` vs `premium`)**
   - **Standard (`gemini-3.8-flash`)**: Default animation authoring tier across the product. Available to **all** plans including Free.
   - **Premium (`claude-opus-5-5` with prompt-cache gate)**: Available **only** to accounts with an active eligible paid subscription (`starter`, `pro`, `business`). Possession of free-allowance tokens or a one-time top-up pack on a Free account does **not** unlock Premium animation.
   - **UI & API Enforcement**:
     - Free users see the `Standard` / `Premium 🔒` selector with the locked copy: **`"Upgrade to access Premium animation."`** (does not claim guaranteed better results and does not ask already signed-in users to sign up again).
     - Any tampered API request (`POST /v1/projects/:id/script/animate`, `POST /v1/projects/:id/plates/draw`, `POST /v1/projects/:id/plates/fix`, `POST /v1/projects/:id/plates/draw-aspect`, `PATCH /v1/projects/:id/plan`) requesting `animationTier: "premium"` without an active paid subscription is rejected with **`402 { error: { code: "premium_requires_subscription", message: "Upgrade to access Premium animation." } }`** before any provider call or token reservation.
   - **Scope**: Tier selection routes only animation code authoring and repair (`sceneWriter`, `sceneRepair`, `motion`). Script writing (`gemini-4-argon`), storyboard beat planning (`gemini-3.8-flash`), TTS (`gemini-3.8-flash-tts`), and music (`lyria-3-*`) keep their existing routing.
   - **Concurrency & In-Flight Isolation**: `process.env` is **never** mutated per request. Instead, `authorRouteForTier(tier)` creates an immutable `routeSnapshot` (`{ tier, writer, repair, motion }`) stored in `app.generation_reservations.route_snapshot` and `app.plate_variants.timings.routeSnapshot`, and recorded on `app.plate_revisions.author` (`"standard:gemini-3.8-flash"` or `"premium:claude-opus-5-5"`).

2. **Exact Token Economics & 30% Contribution Margin Floor**
   - All token prices and fee allocations are computed from **exact unrounded plan arithmetic** in `packages/contracts/src/pricing.ts` (`grossTokenPriceUsd`, `allocatedOrderFeePerTokenUsd`, `netTokenRevenueUsd`, `costBudgetPerTokenUsd`, `contributionMarginForCost`), never from the 3-decimal display helper `tokenPriceUsd()`.
   - Modeled payment processor fee: **`7% + $0.50` per order** (Lemon Squeezy merchant-of-record model in `docs/PRICING.md`; unverified against live processor invoices).
   - Cheapest effective paid token price floor (**Studio Annual**, `business` / `year`):
     - Order price: `$990.00` for `14,400` tokens (`1,200/mo × 12`).
     - Exact gross revenue per token: $p = \frac{\$990}{14,400} = \$0.06875$.
     - Exact allocated processor fee per token: $f = \frac{0.07 \times \$990 + \$0.50}{14,400} = \frac{\$69.80}{14,400} \approx \$0.00484722$.
     - Net revenue per token after processor fee: $p - f = \frac{\$920.20}{14,400} \approx \$0.06390278$.
     - **Maximum variable fulfillment cost budget per token at a 30% contribution margin floor**:
       $$b = (1 - 0.30) \times p - f = \$0.048125 - \$0.00484722 = \$0.04327778\text{ / token}$$
       $$\frac{1}{b} \approx 23.10655\text{ tokens per }\$1.00\text{ of variable cost}$$

3. **Prompt-Cached Opus Arithmetic & Cold-Start Protection**
   - In `backend/src/plates/prompt.ts` and `backend/src/plates/author.ts`, plate scene authoring puts the ~`71,993`-token shared style/kit/story-world prefix in the first user block with `cache_control: { type: "ephemeral" }`, and gates parallel scene fanout through `plateCacheGate` (`backend/src/plates/cache-gate.ts`) so Scene 1 warms the Anthropic cache before follower scenes start.
   - **Cold-write vs. warm-read delta**:
     - On `claude-opus-5-5`, writing `71,993` shared prefix tokens into cache costs $\$5.00/\text{1M}$, whereas reading them on warm scenes costs $\$0.20/\text{1M}$.
     - The one-time cold-write premium per batch is:
       $$71,993 \times \frac{\$5.00 - \$0.20}{1,000,000} = 71,993 \times \frac{\$4.80}{1,000,000} = \$0.3455664$$
     - Earlier analysis noted a 6.0-token batch setup fee, which supports only $6 \times \$0.04327778 = \$0.2597$ of variable cost at the Studio Annual floor and would underfund a cold 1-scene job by $\$0.0859$.
     - **Corrected tariff**: `plateAnimationBatchSetupMillitokens.premium = 8000` (**`8.0 tokens`** = $\$0.34622$ cost budget at Studio Annual, covering the $\$0.34557$ cold-write delta with $\ge 30.1\%$ margin) plus `plateAnimationSceneMillitokens.premium = 9700` (**`9.7 tokens/scene`** = $\$0.41980$ cost budget, covering the $\$0.41914$ warm scene write + expected repair + worker check/clip allowance).
     - Consequently, even a **1-scene cold Premium job** charges `8.0 + 9.7 = 17.7 tokens` ($\$0.7660$ cost budget vs. $\$0.7647$ cold 1-scene cost), maintaining **30.1% contribution margin** on Studio Annual and **49.5%** on Starter Monthly without surprise surcharges if a user's prompt cache expired between sessions.

---

## 2. Token Economics Across All Plans & Packs

| Plan / Product | Order Price | Tokens Granted per Order | Exact Gross / Token ($p$) | Allocated Fee / Token ($f$) | Net / Token ($p - f$) | Max Variable Cost / Token at 30% Margin ($b = 0.7p - f$) | Tokens Needed per $1.00 Variable Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Studio Annual** (`business`, `year`) — **Floor** | $990.00 | 14,400 (1,200 × 12) | $0.068750 | $0.004847 | $0.063903 | **$0.043278** | **23.11 tokens/$1** |
| **Pro Annual** (`pro`, `year`) | $490.00 | 6,600 (550 × 12) | $0.074242 | $0.005273 | $0.068970 | $0.046697 | 21.41 tokens/$1 |
| **Studio Monthly** (`business`, `month`) | $99.00 | 1,200 | $0.082500 | $0.006192 | $0.076308 | $0.051558 | 19.40 tokens/$1 |
| **Starter Annual** (`starter`, `year`) | $190.00 | 2,400 (200 × 12) | $0.079167 | $0.005750 | $0.073417 | $0.049667 | 20.13 tokens/$1 |
| **Pro Monthly** (`pro`, `month`) | $49.00 | 550 | $0.089091 | $0.007145 | $0.081945 | $0.055218 | 18.11 tokens/$1 |
| **Starter Monthly** (`starter`, `month`) | $19.00 | 200 | $0.095000 | $0.009150 | $0.085850 | $0.057350 | 17.44 tokens/$1 |
| **Top-Up Pack** (`topup`) | $12.00 | 100 | $0.120000 | $0.013400 | $0.106600 | $0.070600 | 14.16 tokens/$1 |

---

## 3. Reconciled Step-by-Step Tariff Table (`v2_step_tier`)

Every row below distinguishes **Data Status**:
- **Measured (M)**: Directly recorded from real model/worker runs in repo documentation (`docs/PRICING.md` 2026-10-28 Binary Search 9-beat run, or `docs/MODEL_BENCHMARK_2026-11-08.md` 6-scene *Sign Craft* plate authoring benchmark).
- **Theoretical Cache-Adjusted (TC)**: Exact token counts from the 2026-11-08 6-scene plate benchmark (`71,993` shared prefix tokens, `~230` dynamic input tokens/scene, `8,091` avg output tokens/scene, `5/6` scenes passing first try, `1/6` scene taking 1 repair round), priced with Anthropic's ephemeral prompt-cache write (`$5.00/1M` on Scene 1) and read (`$0.20/1M` on follower scenes and repairs).
- **Rate-Card / Modeled Estimate (E)**: Priced from official provider rate cards in `backend/src/models/providers.ts`, `backend/src/plan/voice.ts`, `backend/src/plan/music.ts`, and `backend/src/plan/visual-state.ts` where an isolated per-step benchmark run was not separately captured.

| Step / Action | Active Model / Engine | Data Status | Variable Cost Basis (USD) | 2026 Tariff (`STEP_TARIFFS_V2_2026`) | Scheduled 2027-01-01 Tariff (`STEP_TARIFFS_V2_2027`) | Studio Annual Margin | Starter Monthly Margin | When Charged / Reuse Rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1a. Script generation / full rewrite** | `gemini-4-argon` (`$4/$20` post-Dec 1 2026 rate) | **E** (~3.2k in, ~800 out) | $0.0288 | **0.7 tokens** (`700` milli) | **0.7 tokens** | 32.5% | 46.9% | On `script/stream` or `script-draft`; manual text edits = **0 tokens** |
| **1b. Single-beat rewrite / scene insert** | `gemini-4-argon` | **E** (~1.8k in, ~300 out) | $0.0130 | **0.3 tokens** (`300` milli) | **0.3 tokens** | 30.0% | 45.0% | On `scenes/insert`, `beats/:id/rewrite`, or 1-beat `script/stream`; scene remove/restore/reorder = **0 tokens** |
| **2a. Storyboard beat-plan director** | `gemini-3.8-flash` (or deterministic) | **E** (Flash conversion of 2-call director) | $0.0430 (2026) / $0.0860 (2027) | **1.0 token** (`1000` milli; **0** when deterministic) | **2.0 tokens** (`2000` milli) | 30.3% | 45.2% | Only when `POST /plan` LLM director runs; `buildPlanFromScriptBeats` = **0 tokens** |
| **2b. Reference frame sketch** | `gemini-3.8-flash` | **E** (~3.5k in, ~2.8k out per frame) | $0.0131 / frame (2026) / $0.0262 (2027) | **0.3 tokens / uncached frame** (`300` milli) | **0.6 tokens / uncached frame** (`600` milli) | 30.0% | 45.0% | Only for frames not in `project.scriptFrames` (`scriptFrameKey`); cached frames = **0 tokens** |
| **2c / 3a. Voiceover synthesis** | `gemini-3.8-flash-tts` + `voiceAlign` | **M** (`$0.0004/s` TTS + align) | $0.0043 / line (~5s avg) | **0.1 tokens / uncached line** (`100` milli) | **0.1 tokens / uncached line** | 30.1% | 45.1% | Only for uncached/changed lines (`takeKey`); unchanged lines = **0 tokens** |
| **2d / 3b. Music bed ($\le 28\text{s}$ clip)** | `lyria-3-clip-preview` | **M** (`$0.04/clip` rate card) | $0.0400 / track | **1.0 token** (`1000` milli) | **1.0 token** | 34.7% | 48.6% | Once per uncached music bed; reused when unchanged = **0 tokens** |
| **2d / 3b. Music bed ($> 28\text{s}$ song)** | `lyria-3-pro-preview` | **M** (`$0.08/song` rate card) | $0.0800 / track | **1.9 tokens** (`1900` milli) | **1.9 tokens** | 32.0% | 46.5% | Once per uncached music bed; reused when unchanged = **0 tokens** |
| **3c. Plate animation — Standard** | `gemini-3.8-flash` (`sceneWriter` + `sceneRepair` + worker check) | **M** (`$0.594 / 6` scenes = `$0.0990/scene` in 2026; `$0.1945/scene` in 2027) | $0.0990 / scene (2026) / $0.1945 (2027) | **2.3 tokens / unauthored scene** (`2300` milli, `0` setup) | **4.5 tokens / unauthored scene** (`4500` milli) | 30.4% | 45.3% | Only for variants requiring `plate-author`; unchanged/transferred/bundle-retried scenes = **0 tokens** |
| **3d. Plate animation — Premium** | `claude-opus-5-5` (with `plateCacheGate` + `sceneRepair` + worker check) | **TC** (`$0.3456` cold prefix delta + `$0.4191/scene` warm write + repair + worker) | `$0.3456` batch + `$0.4191 / scene` | **8.0 tokens batch setup + 9.7 tokens / unauthored scene** (`8000` + `9700` milli) | **8.0 tokens batch setup + 9.7 tokens / scene** | 30.1% (1 scene) / 30.1% (6 scenes) | 45.1% | Paid plans only (`402 premium_requires_subscription` on Free); unchanged scenes = **0 tokens** |
| **3e. Non-plate SVG `frame-motion`** | `gemini-3.8-flash` (Standard) / `claude-opus-5-5` (Premium) | **M/E** (`$0.239 / 9` beats at Sonnet; converted to Flash / Opus) | $0.0080 / scene (Std) / $0.0345 (Prem) | **0.2 tokens / scene** (Std) / **0.8 tokens / scene** (Prem); **0** for template-only | **0.3 tokens / scene** (Std) / **0.8 tokens / scene** (Prem) | 31.5% (Std) / 30.1% (Prem) | 46.1% / 45.1% | Only for uncached `motionSignature(scene)`; template-only films (`0` LLM motion calls) = **0 tokens** |
| **3f. Generated material (`visuals`)** | Gemini Flash Image + Veo 3.1 Fast | **M** (`$0.07` style key + `$0.87/scene` list price) | $1.00 provider list cost | **24.3 tokens per $1.00** (`materialMarkupV2 = 2.43`, i.e. **21.2 tokens / $0.87 scene**) | **24.3 tokens per $1.00** | 33.4% | 47.6% | Paid plans only; replaces old `3.0x` (`30 tokens/$1`) under `v2_step_tier` |
| **4. Final MP4 render export** | Fargate worker (2 vCPU / 4 GB ARM64) | **M** (`$0.022–$0.025` per cold 67s job in Oct AWS bill) | `$0.025 + $0.0012/s` | **0.6 tokens start + 0.03 tokens / second** (`1.5 tokens` for 30s, `2.4 tokens` for 60s) | **0.6 tokens start + 0.03 tokens / second** | 30.7% (30s) / 31.1% (60s) | 45.5% (30s) | At `POST /render`; downloading/replaying completed renders = **0 tokens** |

---

## 4. Reconciled Whole-Film Cost & Token Tables (6-Scene 30s Plate Film)

> **Important Distinction on Measured vs. Estimated Totals:**  
> We do **not** have a single end-to-end measured 30-second 6-scene full-film run across every step at once. Instead, the table below combines:
> - **Measured 6-scene plate authoring** from `docs/MODEL_BENCHMARK_2026-11-08.md` (*Sign Craft*, 6 scenes, 16:9),
> - **Theoretical cache-adjusted Opus plate authoring** using the exact prompt/output token counts from that benchmark (`71,993` shared prefix tokens cached via `plateCacheGate`, `5/6` first-try pass, `1/6` single repair), and
> - **Rate-card / duration-normalized estimates** from `docs/PRICING.md` (2026-10-28 Binary Search 9-beat 66.5s run) for script, reference frames, TTS voiceover, Lyria 30s music clip, and Fargate MP4 export.

### 4A. 30-Second, 6-Scene Code-Drawn Plate Film (`illus-*`, Voiced + Music)

| Step Component | Standard (`gemini-3.8-flash`) Variable Cost | Standard Tokens (2026) | Standard Tokens (2027-01-01) | Premium (`claude-opus-5-5` Cached) Variable Cost | Premium Tokens (2026 & 2027) | Data Status |
| --- | --- | --- | --- | --- | --- | --- |
| **Step 1: Script (`gemini-4-argon`)** | $0.0288 | 0.7 | 0.7 | $0.0288 | 0.7 | Rate-card estimate (E) |
| **Step 2: 6 Reference Frames (`gemini-3.8-flash`)** | $0.0786 (2026) / $0.1572 (2027) | 1.8 | 3.6 | $0.0786 (2026) / $0.1572 (2027) | 1.8 (2026) / 3.6 (2027) | Rate-card estimate (E) |
| **Step 2/3: 6 Voice Lines + 1 Music Clip ($\le 28\text{s}$)** | $0.0658 | 1.6 | 1.6 | $0.0658 | 1.6 | Rate-card + measured TTS/Lyria (M/E) |
| **Step 3: Plate Batch Setup (Cold Cache Delta)** | $0.0000 | 0.0 | 0.0 | $0.3456 | 8.0 | Theoretical cache-adjusted from measured prompt (TC) |
| **Step 3: 6 Plate Scenes (`sceneWriter` + `sceneRepair` + check)** | $0.5940 (2026) / $1.1670 (2027) | 13.8 | 27.0 | $2.5148 | 58.2 | Measured (Std 2026) / Cache-adjusted (Prem) |
| **Step 4: Final MP4 Render Export (30s)** | $0.0610 | 1.5 | 1.5 | $0.0610 | 1.5 | Measured Fargate rate card (M) |
| **Subtotal (Direct Storyboard Flow, No Separate LLM Director)** | **$0.8282** (2026) | **19.4 tokens** | **34.4 tokens** | **$3.0946** (2026) | **71.8 tokens** (2026) | Combined (M + TC + E) |
| **Optional Step 2a: Separate LLM Beat-Plan Director (`POST /plan`)** | $0.0430 (2026) / $0.0860 (2027) | +1.0 | +2.0 | $0.0430 | +1.0 | Rate-card estimate (E) |
| **Optional Music Upgrade ($> 28\text{s}$ Song instead of Clip)** | +$0.0400 | +0.9 | +0.9 | +$0.0400 | +0.9 | Rate-card (M) |
| **Full-featured 30s 6-Scene Plate Film (incl. Director + Song)** | **$0.9112** (2026) | **21.3 tokens** | **37.3 tokens** | **$3.1776** (2026) | **73.7 tokens** (2026) | Combined (M + TC + E) |

*Note on contribution margin:* Under these estimates, the 2026 full-featured 6-scene plate film charges **21.3 tokens** (Standard, supporting up to $\$0.9218$ variable cost at the Studio Annual 30% margin floor vs. $\$0.9112$ estimated cost $\rightarrow$ **30.8% margin on Studio Annual**, **45.6% on Starter Monthly**) and **73.7 tokens** (Premium Cached, supporting up to $\$3.1896$ variable cost at the Studio Annual floor vs. $\$3.1776$ estimated cost $\rightarrow$ **30.3% margin on Studio Annual**, **45.2% on Starter Monthly**). Because non-plate steps and cache hit rates include estimated components, these margins are **modeled targets**, not a guaranteed realized margin on every individual run.

### 4B. Reconciling Earlier `Starter: 3 Opus / 22 Gemini` and `Pro: 10 Opus` Figures

In the earlier model routing comparison (`docs/MODEL_BENCHMARK_2026-11-08.md`), rough figures of **"Starter: ~3 Opus videos or ~22 Gemini videos"** and **"Pro: ~10 Opus videos"** were discussed. Those numbers **cannot** be used as full-film allowances for the following documented reasons:

| Metric | Earlier Rough Figure (`3 Opus / 22 Gemini` on Starter) | Reconciled Full-Cost `v2_step_tier` Table (6-Scene 30s Plate Film) | Why the Earlier Figure Differed |
| --- | --- | --- | --- |
| **What costs were included?** | **Incomplete subtotal**: counted only raw 6-scene `sceneWriter` LLM calls (`$0.58` Flash / `$3.79` uncached Opus) | **Complete variable fulfillment cost**: Script (`$0.029`) + Director (`$0.043`) + 6 Frames (`$0.079`) + 6 Voice + Music (`$0.106`) + 6 Plate Scenes + Repairs + Worker Checks (`$0.594` Std / `$2.860` Prem cached) + Final MP4 Render (`$0.061`) | The earlier figure omitted script, storyboard frames, TTS, music, worker verification clips, final render, and revisions. |
| **Margin & payment fee treatment** | Divided raw model cost into gross/net subscription price with **0% contribution margin** (or a partial generation budget ceiling) | Enforces a **30% contribution margin floor after 7% + $0.50 processor fees** at the cheapest paid token price (`$0.04328` cost budget/token) | At a 30% margin floor on Studio Annual, $1.00 of variable cost requires **23.11 tokens**, not $1.00 / $0.095 = 10.5 tokens. |
| **Implied 30s 6-scene Plate Films per Plan Grant** | Starter (`200t`): 22 Gemini / 3 Opus<br>Pro (`550t`): 10 Opus | **Starter (`200t`)**: **9–10 Standard** plate films (`19.4–21.3t` each) or **2 Premium** plate films (`71.8–73.7t` each, + `52.6t` left)<br>**Pro (`550t`)**: **25–28 Standard** plate films or **7 Premium** plate films (`71.8–73.7t` each)<br>**Studio (`1,200t`)**: **56–61 Standard** plate films or **16 Premium** plate films | Different film engines also have vastly different costs: a **30s 6-scene non-plate HyperFrames film** costs only **6.7 tokens (Standard)** or **10.3 tokens (Premium)** (`29` Standard or `19` Premium films on Starter), whereas a **code-drawn plate film** writes ~48,000 lines/tokens of custom canvas code across 6 scenes. Hence, plans must advertise **token grants** rather than a single fixed video count across engines. |

---

## 5. Prompt Caching Mechanics & Reusable Template / Series Cost-Reduction Opportunities

### 5A. Ephemeral Provider Prompt Caching (Implemented Now)
- **How it works**: In `backend/src/plates/prompt.ts`, the shared prefix (`shared` = style guide + kit module APIs + story-world brief + full cast list, `~71,993` tokens on *Sign Craft*) is placed in the first content block with `cache_control: { type: "ephemeral" }`, while scene-specific instructions (`~230` tokens) sit in the second block.
- **Model-scoped cache key**: `cacheKeyFor(shared, modelKey)` hashes both the shared text and `provider:model` so `plateCacheGate` (`backend/src/plates/cache-gate.ts`) coordinates warm-up per model tier.
- **Why fixed upfront quotes are safe**: Anthropic's ephemeral cache TTL is 5 minutes. Within a single `plates/draw` batch, Scene 1 warms the cache and Scenes 2..N start immediately after Scene 1's stream opens, achieving high within-batch cache hit rates. If a user returns >5 minutes later to revise 1 scene (`plates/fix`), the `8.0 token` batch setup fee is included in the `plate_fix` quote so a cold single-scene revision is still fully funded at a 30.1% Studio Annual margin without any post-hoc cache-miss surcharge.

### 5B. Durable Artifact & Template Reuse vs. Ephemeral Prompt Cache (Concrete Codebase Opportunities)
Unlike provider prompt caching (which only discounts input tokens for 5 minutes and still pays full output token prices of `$20/1M` on Opus), **durable artifact reuse** eliminates both input and output tokens (`100%` of scene LLM cost):

1. **Unchanged Scene / Frame / Audio Reuse (Implemented & Active Now — 0 Tokens)**
   - **Plate variants (`backend/src/plates/store.ts` `matchVariantsToDesired`)**: Keyed by content signature (`look`, `aspect`, `frames`, `keyword`, `visual`, `onScreen`, `line`, `styleNote`). Reordering scenes, inserting/removing a neighbor scene, or editing Scene 3 leaves Scenes 1, 2, 4, 5, 6 matched (`exact` or `transfer`), charging **0 tokens** for unchanged scenes.
   - **Reference frames (`project.scriptFrames`)**: Keyed by `scriptFrameKey(beat, brief)`. Unchanged beats cost **0 tokens**.
   - **Voiceover lines (`project.planAudio.voice.lines`)**: Keyed by `takeKey(speakerSettings, cleanedLine)`. Unchanged lines cost **0 tokens**.
   - **Bundle-backed retries (`row.state === "failed" && row.bundle_key`)**: Retrying a worker render failure when the JS bundle already compiled runs on the worker without calling `plate-author`, costing **0 tokens**.

2. **Existing Kit Modules & Reference Starters (`worker/templates/plates/kits/` & `gallery.ts`)**
   - The codebase already ships reusable kit modules (`stage.js`, ` typography.js`, `draw.js`, `springs.js`, `chart.js`, `cards.js`) and starter reference clips (`template.reference` in `backend/src/plates/prompt.ts`).
   - **Opportunity 1 — Parameterized Scene Archetypes (No-Code / Low-Token Scenes)**: Common recurring beats (title opener, stat counter card, quote callout, logo outro) can expose a `<script id="hf-variables">` or `params` schema (`app.plate_revisions.params`). When a beat matches a parameterized starter and only changes text/colours/numbers, the scene can bind `params` directly without a `24,000`-token `plate-author` call (`0 tokens` or a `0.3-token` parameter mapping call).
   - **Opportunity 2 — Diff / Patch Revisions on `plates/fix` (`reviseScene`)**: Currently, `reviseScene` passes `revise: { notes, code }` to `plate-author` and asks the model to emit the entire `200–350` line `scene.js` file again (`~8,091` output tokens = `$0.162` on Opus). Switching `plates/fix` to a structured search/replace diff patch for small comment edits (colour, label, position, timing) would cut output tokens by `75–85%` (`~1,200` output tokens vs `8,091`), allowing comment fixes on Premium Opus to drop from `17.7 tokens` (1 scene) to `~4–5 tokens`.
   - **Opportunity 3 — Project Series / Shared Character & Story-World Registry**: In `backend/src/plates/author.ts`, `storyWorld` is currently derived per project from Frame 1 (`describeStoryWorld`). Persisting a reusable `story_world_id` / character visual spec on the Brand Kit (`app.brands`) would let multi-episode series reuse the same character proportions, palette constants, and helper functions across projects without re-deriving them.

*(Per instructions, these new template/patch systems are documented as concrete follow-up opportunities and not speculatively added to this billing changeset.)*

---

## 6. Files Changed in Worktree (`codex/generation-tier-billing`)

- `packages/contracts/src/pricing.ts`: Added `BILLING_POLICY_VERSIONS`, `ANIMATION_TIERS`, `ANIMATION_TIER_SPECS`, `PREMIUM_LOCKED_COPY`, `canUseAnimationTier`, exact unrounded `grossTokenPriceUsd`, `allocatedOrderFeePerTokenUsd`, `netTokenRevenueUsd`, `costBudgetPerTokenUsd`, `contributionMarginForCost`, `STEP_TARIFFS_V2_2026` (`8.0` token Opus batch setup + `9.7` tokens/scene), `STEP_TARIFFS_V2_2027`, and `estimateWholeFilmQuoteV2`.
- `packages/contracts/src/beat-plan.ts` & `packages/contracts/src/index.ts`: Added `animationTier` on `ScriptBrief` and `animationTier` / `billingPolicyVersion` on `VideoProject`.
- `backend/src/tokens/plan.ts` & `backend/src/tokens/store.ts`: Exported v2 pricing helpers; added `refundPartialSpend` and partial-refund-aware `refundSpend`.
- `backend/src/db/migrations/032_step_generation_billing.sql` & `supabase/migrations/20261109123000_step_generation_billing.sql`: Added `app.generation_quotes` and `app.generation_reservations` with indexes and RLS policies.
- `backend/src/billing/step-billing.ts`: Implemented Free-vs-Paid tier entitlement check (`assertAnimationTierEntitled`), immutable `authorRouteForTier`, quote generation/verification, atomic reservation/settlement/partial-refund, expired-reservation reconciliation, and `/v1/projects/:id/billing/quote`.
- `backend/src/plates/prompt.ts`, `backend/src/plates/store.ts`, `backend/src/plates/author.ts`, `backend/src/plates/service.ts`, `backend/src/plates/routes.ts`: Wired per-variant `routeSnapshot` and `reservationId`, model-scoped prompt-cache keys, and per-variant reservation settlement/refund callbacks.
- `backend/src/plan/frame-motion.ts`, `backend/src/plan/routes.ts`, `backend/src/plan/preview-meter.ts`, `backend/src/plan/revision-meter.ts`, `backend/src/plan/visual-state.ts`, `backend/src/render/quote.ts`, `backend/src/server.ts`, `backend/src/config.ts`, `backend/src/projects/store.ts`: Wired step quotes, reservations, tier checks, and `v2_step_tier` render export billing while keeping `v1_render_only` as the default.
- `frontend/lib/api.ts`, `frontend/components/film-brief.tsx`, `frontend/components/script-style.tsx`, `frontend/components/script-canvas.tsx`, `frontend/components/studio.tsx`, `frontend/components/profile-page.tsx`: Added Standard/Premium animation quality selector, Free-plan locked Premium state (`"Upgrade to access Premium animation."`), step quotes, and ledger reason labels.
- `backend/test/pricing-lock.mjs` & `backend/test/step-tier-billing.mjs`: Added unit/integration assertions for `v2_step_tier` math, Free/Paid entitlement gating, quote staleness, partial refunds, and `v1_render_only` grandfathering.
- `docs/PRICING.md`: Documented the versioned `v2_step_tier` schedule alongside the locked `v1_render_only` production pricing.

---

## 7. Pending Verification & Staging Deployment Checklist (Not Run Yet)

Because test execution, model calls, and staging deployment were paused by user instruction, run the following checks before deploying `codex/generation-tier-billing` to staging:

1. **Contract & Pricing Lock Check (No DB / No Model Calls)**:
   - `node backend/test/pricing-lock.mjs`
2. **Database Migration & Step-Tier Billing Integration Test (Requires Local Postgres, No Model Calls)**:
   - `node --experimental-strip-types backend/test/step-tier-billing.mjs`
3. **Existing Billing & Ownership Regression Suite (Requires Local Postgres, No Model Calls)**:
   - `node --experimental-strip-types backend/test/tokens.mjs`
   - `node --experimental-strip-types backend/test/render-quote.mjs`
   - `node --experimental-strip-types backend/test/revision-meter.mjs`
   - `node --experimental-strip-types backend/test/preview-meter.mjs`
   - `node --experimental-strip-types backend/test/material-billing.mjs`
   - `node --experimental-strip-types backend/test/ownership.mjs`
4. **Typecheck & Frontend Build**:
   - `npm run build -w frontend`
5. **Staging Rollout (Keep Production Inactive)**:
   - Set `BILLING_POLICY_VERSION=v2_step_tier` **only on staging** once approved; keep `BILLING_POLICY_VERSION` unset (`v1_render_only`) on production.
