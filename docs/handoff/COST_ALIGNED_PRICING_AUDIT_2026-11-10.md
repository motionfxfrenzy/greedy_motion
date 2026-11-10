# Cost-Aligned Pricing Audit, Dated Cost Worksheet & Staging Verification (`v2_step_tier`)

**Date:** 2026-11-10  
**Worktree:** `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-cost-pricing`  
**Branch:** `codex/cost-aligned-pricing` (based on `origin/staging` `464ffa4`)  
**Scope:** Staging only (`BILLING_POLICY_VERSION=v2_step_tier`). **No production promotion.**

---

## 1. Investigation of Staging Project `c830971a-a83b-44af-832a-b98c735937dd`

### 1.1 Stored & Effective Policy vs. Screenshot Display (`25.8 tokens` at `66s`)
We inspected `app.projects`, `app.generation_quotes`, `app.generation_reservations`, `app.token_ledger`, `app.render_jobs`, and the Railway staging container logs (`deployment b69a300a-e7a5-4365-9192-52790e9e06d4` and `50c9ac88-76b2-4dd1-b1ee-cf9655346d4c`) for project `c830971a-a83b-44af-832a-b98c735937dd`:

1. **Persisted Project State (`app.projects`)**:
   - `created_at`: `2026-11-10T02:25:10.771Z`
   - `data.billingPolicyVersion`: **`"v2_step_tier"`** (effective policy is also `"v2_step_tier"`)
   - `data.animationTier`: **`"standard"`** (`gemini-3.8-flash`)
   - Engine / Look: `brief.look = undefined` (defaults to `"clean"`), `styleFamily = "clean-data"`, `styleExample = "animated-map-route"`, 9 beats, `9:16` portrait, measured duration `66.333s` (`ceil = 67s`, `1990` frames). This is a **HyperFrames `frame-film` (SVG reference frames + JSON `frame-motion`)** project, not a code-drawn `illus-*` plate project.
2. **Actual Server Quotes & Ledger Charges (`app.generation_reservations` & `app.token_ledger`)**:
   - `2026-11-10T02:25:14.179Z` (`ledger #503`, `script:ac0770bd...`): **`-700` millitokens (`0.70 tokens`)** — initial 8-beat script (`gemini-4-argon`).
   - `2026-11-10T02:26:30.731Z` (`ledger #513`, `script:835dcb05...`): **`-700` millitokens (`0.70 tokens`)** — regenerated 9-beat script (`gemini-4-argon`).
   - `2026-11-10T02:32:15.628Z` (`ledger #517`, `storyboard:91ab68cf...`): **`-1000` millitokens (`1.00 token`)** — `POST /plan` LLM director (`gemini-3.8-flash`).
   - `2026-11-10T02:32:16.416Z` (`ledger #518`, `frames:e38f9661...`): **`-2700` millitokens (`2.70 tokens`)** — 9 uncached SVG frame sketches (`9 × 0.3t`).
   - `2026-11-10T02:32:56.785Z` (`ledger #525`, `voice:5a1300d3...`): **`-2800` millitokens (`2.80 tokens`)** — 9 voice lines (`0.9t`) + `71.1s` `lyria-3-pro-preview` music song (`1.9t`).
   - `2026-11-10T02:33:38.807Z` (`ledger #542`, `animation:fc278637...`): **`-1800` millitokens (`1.80 tokens`)** — 9 `frame-motion` scene calls (`9 × 0.2t`).
   - `2026-11-10T03:46:19.342Z` (`ledger #548`, `render_export:7a9cb8a3...`): **`-2610` millitokens (`2.61 tokens`)** — final MP4 export for `ceil(66.333) = 67s` (`0.6 + 0.03 × 67 = 2.61t`, with `alreadyPaidMilli = 9700`).
   - **Total actually debited in `app.token_ledger`**: **`12,310` millitokens (`12.31 tokens`)** across two scripts (`11.61 tokens` with one script at `67s`; `11.58 tokens` at `66s`).
3. **Root Cause of the `25.8 tokens` UI Button Label**:
   - Although the server quoted `2.61 tokens` (`2610` millitokens) on `GET /v1/projects/c830971a-a83b-44af-832a-b98c735937dd/render/quote` and `POST .../billing/quote` and debited `2.61 tokens` at Render, `BrowserAnimationStep` (`frontend/components/browser-animation-step.tsx` line 707) computed its `cost` prop locally using the legacy `v1_render_only` formula:
     `tokensFromMilli(renderCostMillitokens(Math.max(5, Math.round(duration))))` = `6 + 0.3 × Math.round(66.333)` = `6 + 0.3 × 66` = **`25.8 tokens`**, and `studio.tsx` only fetched `getRenderQuote(project.id)` when `isPlateStyle` was true.
4. **Fixes Applied**:
   - `frontend/components/browser-animation-step.tsx` and `frontend/components/studio.tsx`: `getRenderQuote(project.id)` now runs for all storyboard projects (both `frame-film` and `illus-*` plates), passes the server-quoted `cost` into `BrowserAnimationStep`, and uses `renderExportCostMillitokensV2(Math.max(1, Math.ceil(duration)))` as the pre-response fallback when `project.billingPolicyVersion === "v2_step_tier"`.
   - `frontend/components/script-canvas.tsx` (`RenderAction`) and `frontend/components/beat-storyboard.tsx` (`RenderCost`): Updated to respect `v2_step_tier` export pricing (`renderExportCostMillitokensV2`) and server quotes.
   - `backend/src/billing/step-billing.ts` (`quoteAnimationStep`): Fixed a transient window where `quoteAnimationStep` returned `0` for `animationTotalMilli` if all `scriptFrames` had finished sketching (`uncachedIndices.length === 0`) while `POST /plan` (`beatPlan`) was still in flight.
   - `backend/src/tokens/store.ts` (`refundSpend`): Synchronizes `app.generation_reservations` (`status = 'refunded', settled_milli = 0, refunded_milli = reserved_milli`) whenever `refundSpend` is called directly (e.g., when a queued render job later fails in `render/service.ts`), preventing ledger/reservation drift.
   - `backend/src/plan/element-edits.ts`, `backend/src/plan/routes.ts`, and `backend/src/pro/routes.ts`: Wired `quoteElementEditStep` (`0.3t` per model-translated comment; `0t` for rule-based edits) and `quoteProAssistStep` (`0.5t`) under `v2_step_tier`.

### 1.2 Treatment of Legacy Projects (`v1_render_only`) vs. `v2_step_tier`
- **No Blind Migration or Double-Charging**: `effectiveBillingPolicyVersion(project)` (`backend/src/billing/step-billing.ts`) preserves explicit `project.billingPolicyVersion` and grandfathers any pre-existing project with `billingPolicyVersion === undefined` that already has a `beatPlan`, `script`, `planAudio`, `filmMotion`, `brief.scriptBeats`, `scriptFrames`, or `renderJobId` onto `"v1_render_only"`.
- **Fresh Projects**: Any new project created when `BILLING_POLICY_VERSION=v2_step_tier` is active is stamped with `billingPolicyVersion: "v2_step_tier"` and billed per step.
- **If an Existing Project Is Explicitly Opted Into `v2_step_tier`**: All existing artifacts (`scriptFrames` by `scriptFrameKey`, `planAudio.voice.lines` by `takeKey`, `planAudio.music`, `filmMotion` by `motionSignature`, and `plate_variants` by content signature) are recognized as cached (`reusedUnits`), costing `0 tokens`, and `projectPaidStepMillitokens` credits all prior settled/reserved step charges.

---

## 2. Exact Per-Plan Token Economics & Uniform-Tariff Margin Mapping

### 2.1 Contribution Margin Definition & Cheapest-Token Floor
- **Contribution Margin Formula**:
  $$\text{Margin } m = \frac{\text{Gross Revenue} - \text{Payment Processor Fee} - \text{Variable Fulfillment Cost}}{\text{Gross Revenue}} = 1 - \frac{f}{p} - \frac{c}{T \cdot p}$$
- **Payment Processor Fee (Modeled)**: `7% + $0.50` per order (Lemon Squeezy merchant-of-record model in `docs/PRICING.md`; **modeled**, not verified against live processor invoices).
- **Cheapest Effective Paid Token Floor (Studio Annual, `business` / `year`)**:
  - Order price: $P = \$990.00$ (`ANNUAL_MONTHS_CHARGED = 10` × `$99`).
  - Tokens granted per annual order: $N = 14,400$ (`ANNUAL_MONTHS_GRANTED = 12` × `1,200`).
  - Exact gross revenue per token: $p = \frac{990}{14,400} = \$0.0687500000$.
  - Exact allocated processor fee per token: $f = \frac{0.07 \times 990 + 0.50}{14,400} = \frac{69.80}{14,400} \approx \$0.0048472222$.
  - Exact net revenue per token after fee: $p - f = \frac{920.20}{14,400} \approx \$0.0639027778$.
  - **Maximum variable fulfillment cost budget per token at a 30.0% contribution margin floor**:
    $$b_{30\%} = 0.70 \times p - f = 0.048125 - \frac{69.80}{14,400} = \frac{623.20}{14,400} \approx \$0.0432777778\text{ / token}$$
    $$\frac{1}{b_{30\%}} = \frac{14,400}{623.20} \approx 23.1065468549\text{ tokens per }\$1.00\text{ of variable cost}$$

### 2.2 Per-Plan Gross, Fee, Net, Cost Budget & Realized Margin Under a Uniform Tariff

Because plans have different effective token prices ($p$ ranges from $\$0.06875$ on Studio Annual to $\$0.09500$ on Starter Monthly and $\$0.12000$ on Top-Up), **a single uniform token tariff $T$ cannot produce an identical percentage margin on every plan**. When tariffs are anchored at the **30.0% contribution margin floor on Studio Annual** ($c / T = \$0.04327778/\text{token}$), the exact per-plan economics are:

| Plan / Product | Billing Interval | Order Price ($P$) | Tokens per Order ($N$) | Exact Gross / Token ($p = P/N$) | Modeled Order Fee ($F = 0.07P + 0.50$) | Allocated Fee / Token ($f = F/N$) | Net Revenue / Token ($p - f$) | Max Cost / Token at 30% Plan Margin ($0.7p - f$) | Realized Margin When Priced at Studio Annual 30% Floor ($c/T = \$0.043278$) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Studio Annual** (`business`, `year`) — **Floor** | Annual (10x mo) | $990.00 | 14,400 | **$0.06875000** | $69.80 | $0.00484722 | $0.06390278 | **$0.04327778** (`23.107 t/$1`) | **30.00%** |
| **Pro Annual** (`pro`, `year`) | Annual (10x mo) | $490.00 | 6,600 | **$0.07424242** | $34.80 | $0.00527273 | $0.06896970 | $0.04669697 (`21.415 t/$1`) | **34.61%** |
| **Starter Annual** (`starter`, `year`) | Annual (10x mo) | $190.00 | 2,400 | **$0.07916667** | $13.80 | $0.00575000 | $0.07341667 | $0.04966667 (`20.134 t/$1`) | **38.07%** |
| **Studio Monthly** (`business`, `month`) | Monthly | $99.00 | 1,200 | **$0.08250000** | $7.43 | $0.00619167 | $0.07630833 | $0.05155833 (`19.396 t/$1`) | **40.04%** |
| **Pro Monthly** (`pro`, `month`) | Monthly | $49.00 | 550 | **$0.08909091** | $3.93 | $0.00714545 | $0.08194545 | $0.05521818 (`18.110 t/$1`) | **43.40%** |
| **Starter Monthly** (`starter`, `month`) | Monthly | $19.00 | 200 | **$0.09500000** | $1.83 | $0.00915000 | $0.08585000 | $0.05735000 (`17.437 t/$1`) | **44.81%** |
| **Top-Up Pack** (`topup`) | One-time | $12.00 | 100 | **$0.12000000** | $1.34 | $0.01340000 | $0.10660000 | $0.07060000 (`14.164 t/$1`) | **52.77%** |

### 2.3 Options If a Strict `30%–40%` Margin Band Across Every Plan Is Required
1. **Option A (Implemented on Staging — 30% Floor on Cheapest Plan, Studio Annual)**:
   - Prices tariffs at $b = \$0.043278/\text{token}$ (`23.11 tokens/$1` cost).
   - **Result**: Studio Annual (`30.0%`), Pro Annual (`34.6%`), Starter Annual (`38.1%`), and Studio Monthly (`40.0%`) all sit in **`30.0%–40.0%`**, while Pro Monthly (`43.4%`) and Starter Monthly (`44.8%`) sit `3.4–4.8` points above `40%` due to the 16.7% annual discount and volume tier discount. No plan ever drops below `30%`.
2. **Option B (Anchor 30% Floor on Studio Monthly `$0.0825/token`, $b = \$0.051558/\text{token}$, `19.40 tokens/$1` — ~16% Lower Token Tariffs)**:
   - **Result**: Monthly plans all sit inside **`30.0%–36.1%`** (`30.0%` Studio Monthly, `34.1%` Pro Monthly, `36.1%` Starter Monthly), but annual plans drop below 30% (`18.0%` Studio Annual, `23.5%` Pro Annual, `27.6%` Starter Annual) unless the annual discount is reduced from 2 months free (`16.7%`) to ~1 month free (`8.3%`).
3. **Option C (Keep Uniform Tariffs & Narrow Plan Token Price Spread — Requires Owner Approval Before Touching Catalog)**:
   - Keeping uniform tariffs while holding every subscription plan (Monthly and Annual) strictly inside `[30%, 40%]` requires the ratio $p_{\max} / p_{\min}$ across subscription tiers to be $\le 1.18$ (currently $\$0.09500 / \$0.06875 = 1.382$).

---

## 3. Dated Cost Worksheet (2026-11-10): Measured vs. Modeled Sources

### 3.1 Provenance & Classification Key
- **Measured — Staging Railway `model_usage` / DB Logs (MS)**: Directly extracted from Railway staging container logs and Postgres rows on 2026-11-10 for:
  - **Project `c830971a-a83b-44af-832a-b98c735937dd`** (9 beats, `66.333s` HyperFrames `frame-film`, `look: "clean"`, `styleExample: "animated-map-route"`).
  - **Project `62006124-426c-4197-ba2a-47eb81f186a4`** (6 beats + 1 inserted scene = 7 beats, `47.4s` HyperFrames `frame-film`, `look: "sketch"`).
- **Measured — Repo Benchmark / AWS Bill (MB)**:
  - **6-Scene Plate Benchmark (`docs/MODEL_BENCHMARK_2026-11-08.md`, *Sign Craft*, 6 scenes, `16:9`)**: `71,993` shared prefix tokens, `~230` scene prompt tokens, `8,091` avg output tokens/scene, `5/6` first-try pass, `1/6` single repair pass.
  - **October 2026 AWS Fargate Bill (`docs/PRICING.md`)**: `$0.04045/vCPU-hr` and `$0.00442/GB-hr` in `ap-southeast-1` (`$0.0986/hr` = `$0.0000274/s` on 2 vCPU / 4 GB ARM64 production task; `$0.3944/hr` = `$0.0001096/s` on 8 vCPU / 16 GB staging task; ~70% lower on Fargate Spot).
- **Theoretical Cache-Adjusted (TC)**: Exact token counts from the 6-scene plate benchmark priced with Anthropic's ephemeral prompt-cache write (`$5.00/1M` on Scene 1) and cache read (`$0.20/1M` on follower scenes and repairs) gated by `plateCacheGate`.
- **Modeled / Rate-Card Estimate (E)**: Calculated from official provider rate cards (`backend/src/models/prices.ts`, `backend/src/plan/voice.ts`, `backend/src/plan/music.ts`, Cloudflare R2 public pricing) where a separate invoice line item is not isolated.

### 3.2 Complete Step-by-Step Cost & Tariff Worksheet

| Step / Stage (`BillableStage`) | Active Model / Worker Resource | Data Status & Measured Evidence | Measured / Modeled Variable Cost (USD, Nov 2026) | Post-Dec 1 2026 / 2027-01-01 Cost (USD) | 2026 Tariff (`STEP_TARIFFS_V2_2026`) | 2027 Tariff (`STEP_TARIFFS_V2_2027`) | Cost Budget at Studio Annual Floor ($0.043278/t) | Studio Annual Margin (2026 / Dec 2026) | Starter Monthly Margin (2026 / Dec 2026) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **1a. Script write / full rewrite** (`script_write`, `script_edit`) | `gemini-4-argon` (`$2/$10` Nov; `$4/$20` from 2026-12-01) | **MS**: `c830971a` #1: `2,654` in / `782` out = `$0.013128`; #2: `2,065` in / `916` out / `1,425` cache = `$0.013433`; `62006124`: `2,864` in / `551` out = `$0.011238` | **$0.0112–$0.0134** (avg `$0.0126`) | **$0.0225–$0.0269** (Dec 1 `$4/$20`; design cap `$0.0288`) | **0.70 t** (`700` milli) | **0.70 t** (`700` milli) | $0.03029 | 61.9% (Nov) / **33.4%** (Dec) | 71.1% (Nov) / **47.6%** (Dec) |
| **1b. Single-scene insert / beat rewrite** (`scene_insert`, `beat_rewrite`) | `gemini-4-argon` (`$2/$10` Nov; `$4/$20` from 2026-12-01) | **MS**: `62006124` `sceneInsert`: `3,580` in / `92` out = `$0.008080` (`$0.01616` at Dec 1 rate; typical 1-beat rewrite `~1.8k` in / `~250` out = `$0.0122` Dec 1) | **$0.0061–$0.0081** | **$0.0122–$0.0162** (Dec 1 `$4/$20`) | **0.30 t** (`300` milli) | **0.30 t** (`300` milli) | $0.01298 | 53.3% (Nov) / **30.0%–6.6%** *(see sensitivity)* | 64.9% (Nov) / **45.0%–26.9%** |
| **2a. Storyboard beat-plan director** (`storyboard_plan`) | `gemini-3.8-flash` (`$0.75/$3.75` 2026; `$1.50/$7.50` 2027); `0` when deterministic | **MS**: `c830971a`: `10,837` in / `9,319` out = `$0.043074`; `62006124`: `10,671` in / `11,816` out = `$0.052313` | **$0.0431–$0.0523** (`$0.0000` when deterministic) | **$0.0861–$0.1046** (2027-01-01) | **1.00 t** (`1000` milli; `0` if deterministic) | **2.00 t** (`2000` milli) | $0.04328 | **30.3%** (`c830971a`) / 15.4% (`62006124`) | **45.2%** (`c830971a`) / 33.8% (`62006124`) |
| **2b. Reference SVG frame sketch** (`frame_sketch`) | `gemini-3.8-flash` (per uncached frame) | **MS**: `c830971a` (9 styled frames): avg `4,383` in / `2,648` out = `$0.013217/frame` (`$0.11895` total for 9; user noted `~$0.115`); `62006124` (7 frames): avg `3,095` in / `1,793` out = `$0.009037/frame` | **$0.0090–$0.0132 / frame** (overall 16-frame mean `$0.0114`) | **$0.0181–$0.0264 / frame** (2027-01-01) | **0.30 t / frame** (`300` milli) | **0.60 t / frame** (`600` milli) | $0.01298 / frame | **38.6%** (16-frame mean) / 28.7% (`c830971a`) / 51.3% (`62006124`) | **51.5%** (mean) / 43.9% (`c830971a`) / 61.3% (`62006124`) |
| **2c / 3a. Voiceover synthesis** (`voice_music` per line) | `gemini-3.8-flash-tts` (`$0.0004/s` rate card) + `voiceAlign` | **MS**: `c830971a` (9 lines, `61.26s`, avg `6.81s/line`): `$0.0269` total = `$0.00299/line`; `62006124` (7 lines, `43.63s`, avg `6.23s/line`): `$0.0185` total = `$0.00264/line`; with alignment `~$0.0030–$0.0043/line` | **$0.0026–$0.0043 / line** | **$0.0026–$0.0043 / line** | **0.10 t / line** (`100` milli) | **0.10 t / line** (`100` milli) | $0.00433 / line | **30.1%–53.1%** (`51.6%` on `c830971a`) | **45.1%–62.6%** |
| **2d / 3b. Music bed ($\le 28\text{s}$ clip)** (`voice_music`) | `lyria-3-clip-preview` | **E / MB**: Rate card `$0.0400 / clip` | **$0.0400 / track** | **$0.0400 / track** | **1.00 t** (`1000` milli) | **1.00 t** (`1000` milli) | $0.04328 | **34.7%** | **48.6%** |
| **2d / 3b. Music bed ($> 28\text{s}$ song)** (`voice_music`) | `lyria-3-pro-preview` | **MS / MB**: Rate card `$0.0800 / song` (used on both `c830971a` `71.1s` and `62006124` `63.3s`) | **$0.0800 / track** | **$0.0800 / track** | **1.90 t** (`1900` milli) | **1.90 t** (`1900` milli) | $0.08223 | **32.0%** | **46.5%** |
| **3c. Non-plate SVG `frame-motion` — Standard** (`animation`) | `gemini-3.8-flash` (`motion` step, per uncached scene) | **MS**: `c830971a` (9 scenes): `56,226` in / `2,970` out = `$0.053307` (`$0.005923/scene`); `62006124` (7 scenes): `30,273` in / `2,428` out = `$0.032099` (`$0.004586/scene`) | **$0.0046–$0.0059 / scene** | **$0.0092–$0.0118 / scene** (2027-01-01) | **0.20 t / scene** (`200` milli) | **0.30 t / scene** (`300` milli) | $0.00866 / scene | **46.1%–52.2%** (2026) / **33.1%–43.0%** (2027) | **57.3%–62.0%** (2026) |
| **3d. Non-plate SVG `frame-motion` — Premium** (`animation`) | `claude-opus-5-5` (`$4/$20` per 1M, per uncached scene) | **E / MB**: Using measured `c830971a` token counts (`6,247` in / `330` out) at Opus `$4/$20` = `$0.03159/scene` (`$0.0345` with retry allowance) | **$0.0316–$0.0345 / scene** | **$0.0316–$0.0345 / scene** | **0.80 t / scene** (`800` milli) | **0.80 t / scene** (`800` milli) | $0.03462 / scene | **30.1%–36.2%** | **45.1%–49.8%** |
| **3e. Code-drawn Plate Animation — Standard** (`plate_draw`, `plate_fix`, `plate_aspect`) | `gemini-3.8-flash` (`sceneWriter` + `sceneRepair` + bundle/check/clip fallback) | **MB**: 2026-11-08 6-scene *Sign Craft* benchmark: `$0.583` LLM (`5/6` 1st try, `1/6` 1 repair) + `$0.011` worker check/clip allowance = `$0.594 / 6` = `$0.0990 / scene` | **$0.0990 / scene** (`$0.085` 0-repair to `$0.115` 2-repair) | **$0.1945 / scene** (2027-01-01) | **2.30 t / scene** (`2300` milli, `0` setup) | **4.50 t / scene** (`4500` milli) | $0.09954 / scene | **30.4%** (baseline `1/6` repair) | **45.3%** |
| **3f. Code-drawn Plate Animation — Premium** (`plate_draw`, `plate_fix`, `plate_aspect`) | `claude-opus-5-5` with `plateCacheGate` + `sceneRepair` + bundle/check/clip fallback | **TC**: `71,993` shared prefix cold-write delta = `$0.34557` batch setup; per-scene warm write (`$0.1773`) + `1/6` expected repair (`$0.2286`) + worker clip check (`$0.0132`) = `$0.41914 / scene` | **`$0.3456` batch + `$0.4191 / scene`** | **`$0.3456` batch + `$0.4191 / scene`** | **8.00 t setup + 9.70 t / scene** (`8000` + `9700` milli) | **8.00 t setup + 9.70 t / scene** | `$0.34622` setup + `$0.41980 / scene` | **30.1%** (1 scene) / **30.1%** (6 scenes) | **45.1%** |
| **3g. Generated Material (`visuals`)** | Gemini 3.1 Flash Image + Veo 3.1 Fast | **MB**: `$0.07` style key + `$0.87 / scene` provider list price | **$1.00** provider list unit | **$1.00** provider list unit | **24.3 t per $1.00** (`materialMarkupV2 = 2.43`) | **24.3 t per $1.00** | $1.05165 per $1.00 | **33.4%** | **47.6%** |
| **4. Final MP4 Render Export + Storage/CDN** (`render_export`) | ECS Fargate worker + R2 storage + CDN egress | **MS / MB**: `c830971a` job `44025d40`: `149.8s` active Fargate work (`03:47:22Z`–`03:49:52Z`). On 2 vCPU/4 GB ARM64 (`$0.0000274/s` On-Demand, `~$0.0000082/s` Spot) + cold start/idle tail + R2 PUT/storage: `$0.025 + $0.0012/s` (`$0.061` for 30s, `$0.105` for 67s) | **`$0.025 + $0.0012 / s`** (`$0.061` at 30s; `$0.105` at 67s) | **`$0.025 + $0.0012 / s`** | **0.60 t start + 0.03 t / s** (`600 + 30 × ceil(s)` milli) | **0.60 t start + 0.03 t / s** | `$0.02597 + $0.001298 / s` (`$0.11296` at 67s) | **30.7%** (30s) / **34.5%** (67s) | **45.5%** (30s) / **48.4%** (67s) |
| **5a. Comment-to-Patch Model Edit** (`element_edit`) | `gemini-4-argon` (`elementEdits`, per model-translated comment; rule-based = `0`) | **E**: `~2.5k` in / `~150` out (`$0.0065` Nov; `$0.0130` Dec 1) | **$0.0065** (Nov) | **$0.0130** (Dec 1) | **0.30 t / model comment** (`300` milli; `0` for rules) | **0.30 t** | $0.01298 | 64.9% (Nov) / **30.0%** (Dec) | 73.4% (Nov) / **45.0%** (Dec) |
| **5b. Pro Editor AI Source Proposal** (`pro_assist`) | `gemini-3.8-flash` (`skillRouting` + `proAssistant`) | **E**: `~12k` in / `~3k` out (`$0.0203` 2026) | **$0.0203** | **$0.0405** (2027) | **0.50 t** (`500` milli) | **0.50 t** | $0.02164 | **34.3%** (2026) | **48.3%** (2026) |

---

## 4. Whole-Film Cost, Tariff & Per-Plan Margin Comparison (9-Scene 66s Film vs. 6-Scene 30s Film)

### 4.1 9-Scene, 66-Second Whole-Film Matrix (Fresh 1-Script Run, Director + 9 Sketches + 9 Voice + Music Song + Export)

This table verifies the exact 9-scene 66-second tariffs across both engines (`frame-film` vs. `illus-*` plates) and both quality tiers (`standard` vs. `premium`), alongside measured/modeled costs and per-plan contribution margins:

| Metric / Component | HyperFrames `frame-film` Standard (`gemini-3.8-flash`) | HyperFrames `frame-film` Premium (`claude-opus-5-5` motion) | Code-Drawn Plates (`illus-*`) Standard (`gemini-3.8-flash`) | Code-Drawn Plates (`illus-*`) Premium (`claude-opus-5-5` cached) |
| --- | ---: | ---: | ---: | ---: |
| **Step 1: Script (`gemini-4-argon`, 1 call)** | 0.70 t ($0.0131 Nov / $0.0263 Dec) | 0.70 t ($0.0131 Nov / $0.0263 Dec) | 0.70 t ($0.0131 Nov / $0.0263 Dec) | 0.70 t ($0.0131 Nov / $0.0263 Dec) |
| **Step 2a: Storyboard Director (`gemini-3.8-flash`)** | 1.00 t ($0.0431) | 1.00 t ($0.0431) | 1.00 t ($0.0431) | 1.00 t ($0.0431) |
| **Step 2b: 9 Reference Frame Sketches (`gemini-3.8-flash`)** | 2.70 t ($0.1190 MS / $0.1150 user) | 2.70 t ($0.1190) | 2.70 t ($0.1190) | 2.70 t ($0.1190) |
| **Step 2c/d: 9 Voice Lines + 1 Music Song (`>28s`)** | 2.80 t ($0.1069 MS) | 2.80 t ($0.1069) | 2.80 t ($0.1069) | 2.80 t ($0.1069) |
| **Step 3: Animation Batch Setup** | 0.00 t ($0.0000) | 0.00 t ($0.0000) | 0.00 t ($0.0000) | **8.00 t** ($0.3456 TC) |
| **Step 3: 9 Animated Scenes** | **1.80 t** ($0.0533 MS) | **7.20 t** ($0.2843 E) | **20.70 t** ($0.8910 MB) | **87.30 t** ($3.7723 TC) |
| **AI Subtotal (1 Script, Excl. Export)** | **9.00 t** (`$0.3354` MS / `$0.3313` user; `$0.3485` Dec) | **14.40 t** (`$0.5664` Nov / `$0.5795` Dec) | **27.90 t** (`$1.1731` Nov / `$1.1862` Dec) | **102.50 t** (`$4.4000` Nov / `$4.4131` Dec) |
| **Step 4: Final MP4 Export (`66s` = `0.6 + 0.03 × 66`)** | **2.58 t** ($0.025–$0.104) | **2.58 t** ($0.025–$0.104) | **2.58 t** ($0.025–$0.104) | **2.58 t** ($0.025–$0.104) |
| **Total Tokens Charged (66s, 1 Script)** | **11.58 tokens** (`11,580` milli) | **16.98 tokens** (`16,980` milli) | **30.48 tokens** (`30,480` milli) | **105.08 tokens** (`105,080` milli) |
| *(Note: At `66.333s -> ceil 67s` as on `c830971a`)* | *11.61 t (1 script) / 12.31 t (2 scripts)* | *17.01 t* | *30.51 t* | *105.11 t* |
| **Total Variable Fulfillment Cost (Dec 2026 Conservative)** | **$0.4527** (`$0.3485` AI + `$0.1042` export) | **$0.6837** (`$0.5795` AI + `$0.1042` export) | **$1.2904** (`$1.1862` AI + `$0.1042` export) | **$4.5173** (`$4.4131` AI + `$0.1042` export) |
| **Studio Annual (`$0.06875/t` gross, `$0.06390/t` net) Margin** | **36.1%** (Dec) / **41.8%** (Nov Spot) | **34.6%** (Dec) | **31.4%** (Dec) | **30.4%** (Dec) |
| **Pro Annual (`$0.07424/t` gross, `$0.06897/t` net) Margin** | **40.3%** (Dec) | **38.9%** (Dec) | **35.9%** (Dec) | **35.0%** (Dec) |
| **Starter Annual (`$0.07917/t` gross, `$0.07342/t` net) Margin** | **43.5%** (Dec) | **42.1%** (Dec) | **39.3%** (Dec) | **38.4%** (Dec) |
| **Studio Monthly (`$0.08250/t` gross, `$0.07631/t` net) Margin** | **45.2%** (Dec) | **44.0%** (Dec) | **41.2%** (Dec) | **40.4%** (Dec) |
| **Pro Monthly (`$0.08909/t` gross, `$0.08195/t` net) Margin** | **48.3%** (Dec) | **47.1%** (Dec) | **44.5%** (Dec) | **43.7%** (Dec) |
| **Starter Monthly (`$0.09500/t` gross, `$0.08585/t` net) Margin** | **49.6%** (Dec) | **48.4%** (Dec) | **45.9%** (Dec) | **45.1%** (Dec) |
| **Top-Up Pack (`$0.12000/t` gross, `$0.10660/t` net) Margin** | **56.9%** (Dec) | **55.9%** (Dec) | **53.7%** (Dec) | **53.0%** (Dec) |

---

## 5. Sensitivity Bands, Infrastructure Attribution & Unverified Gaps

### 5.1 Cold Cache vs. Warm Cache & Repair Rate Sensitivity (Plates Engine)
1. **Premium (`claude-opus-5-5`) Prompt Cache Sensitivity (6-Scene Plate Batch)**:
   - **Baseline (`plateCacheGate` active, Scene 1 cold write `71,993` tokens at `$5/1M`, Scenes 2–6 warm read at `$0.20/1M`, `1/6` repair)**:
     - Scene authoring + repair + check cost = `$0.3456 + 6 × $0.4191 = $2.8604`.
     - Charged for plate step: `8.0 + 6 × 9.7 = 66.20 tokens` (`$4.5513` Studio Annual gross, `$0.3209` fee, `$4.2304` net $\rightarrow$ **30.1% Studio Annual margin**).
   - **Best Case (`0/6` repairs, warm cache hits on Scenes 2–6)**:
     - Cost drops by `$1.3716` to `$1.4888` $\rightarrow$ **60.2% Studio Annual margin**.
   - **Adverse Repair Case (`2/6` repairs = 2 scenes each taking 1 repair round)**:
     - Cost increases by `+$1.3716` to `$4.2320` vs. `$4.2304` Studio Annual net revenue $\rightarrow$ **0.0% Studio Annual margin (breakeven, never negative on Pro/Starter/Monthly)**; on Starter Monthly (`$6.289` gross, `$5.683` net), margin remains **23.1%**.
   - **Complete Cache-Miss Pathological Case (all 6 scenes pay `$5/1M` cold write because `plateCacheGate` was bypassed or every scene waited >5 min)**:
     - Adds `5 × $0.3456 = +$1.7278` cold-write penalty. Because `plateCacheGate` (`backend/src/plates/cache-gate.ts`) holds follower scenes until Scene 1's stream opens, within-batch cache misses do not occur in normal operation.
2. **Standard (`gemini-3.8-flash`) Repair Sensitivity (6-Scene Plate Batch, 2026)**:
   - **0 repairs (`6/6` first-try pass)**: `~$0.492` (`$0.082/scene`) vs `13.8 tokens` (`$0.597` Studio Annual cost budget) $\rightarrow$ **42.3% Studio Annual margin**.
   - **Baseline (`1/6` repair, measured in *Sign Craft*)**: `$0.594` (`$0.099/scene`) $\rightarrow$ **30.4% Studio Annual margin**.
   - **High repair (`3/6` repairs)**: `~$0.798` (`$0.133/scene`) $\rightarrow$ **6.5% Studio Annual margin** (`26.9%` Starter Monthly margin).
3. **Single-Scene Insert / Beat Rewrite Sensitivity (`0.30 tokens` = `$0.01298` Studio Annual budget)**:
   - At Nov 2026 `gemini-4-argon` rates (`$2/$10`), measured `sceneInsert` on `62006124` (`3,580` in / `92` out) cost `$0.00808` (**53.3% Studio Annual margin**).
   - After Dec 1, 2026 (`$4/$20`), a `3,580` in / `92` out call costs `$0.01616` (`13.0%` Studio Annual margin at `0.30t`, or `30.8%` if `0.40t`). In the context of a whole film (`11.6–30.5t`), a single `0.30t` scene insert shifts whole-film margin by `< 0.3%`.

### 5.2 Infrastructure, Bundling, Storage & CDN Attribution
1. **Bundling (`esbuild`)**: Runs in-process on the Railway backend in `15–60 ms` of CPU time (`< $0.0001` per scene).
2. **Browser Live Check vs. Worker Check Fallback**:
   - When `PLATE_LIVE_PREVIEW=on` and the user's browser verifies the scene (`submitCheckReport` `ok: true`), worker clip rendering is skipped until final export (`$0.00` worker check cost).
   - When a scene falls back to worker clip rendering (`plate-render` on Fargate), it runs for `~15–35s` on an ECS task (`~$0.0004–$0.0010` on Spot, `~$0.0015–$0.0038` on On-Demand), covered inside the per-scene allowance (`$0.011–$0.013/scene`).
3. **Final MP4 Render Export (`render_export`)**:
   - Measured on `c830971a-a83b-44af-832a-b98c735937dd` (`job 44025d40-5f79-4e70-9a58-099cc74613df`): `149.8s` active Fargate work (`2.25×` real time for `66.3s` `9:16` video).
   - On Fargate Spot (`ECS_USE_SPOT=1` on staging), `150s` active + `600s` idle tail costs `~$0.007–$0.025`; on On-Demand cold start, `~$0.025–$0.065`. The tariff `0.6 + 0.03 × ceil(s)` (`2.61 tokens` = `$0.1130` Studio Annual cost budget for `67s`) covers both Spot and On-Demand cold starts at $\ge 30.7\%$ Studio Annual margin.
4. **Object Storage (Cloudflare R2) & Egress**:
   - R2 charges `$0.00` egress fees, `$0.015/GB-month` storage, and `$4.50/1M` Class A PUT operations. A finished film stores `~15–40 MB` across audio, bundles, and MP4 (`< $0.0006/month` storage + `< $0.0002` PUT operations).

### 5.3 Explicit Unverified Gaps (Not Claimed as Verified)
- **Processor Invoices**: The `7% + $0.50` Lemon Squeezy fee is a modeled contract formula; live payout invoices with FX/tax/chargeback adjustments have not been audited.
- **Multi-Film Prompt Cache Hit Rate in Production Traffic**: The `1/6` repair rate and `71,993` shared prefix token count come from the 6-scene *Sign Craft* benchmark; real customer prompts may have higher or lower repair rates.
- **Standalone HyperFrames CLI Benchmark Exclusion**: Standalone HyperFrames skill/CLI benchmarks (`docs/REMOTION_VS_HYPERFRAMES.md`) are a separate workflow from production `frame-film` and `plate-film` and are never mixed into these figures.
