# Pricing Strategy Recommendation — Greedy Motion — 2026-10-28

Built with the `pricing-strategy` skill from the cost of the Binary Search template and four other templates. Everything marked *(assumed, confirm)* is an assumption, listed at the end. **A real run was recorded on 2026-10-28 (next section) and replaces the Claude estimates below; the template table further down is the earlier estimate and is kept for comparison.**

## 1. What a film costs us

## Measured run: Binary Search template, end to end (recorded 2026-10-28)

Run through the real site (Templates, Binary Search, Generate storyboard, voiceover, Preview, comments, final render) on a local backend that wrote the token usage of every model call to a file (a read-only `fetch` wrapper, no app code changed). Film: 9 beats, 66.5 s. Local `.env` uses `claude-opus-5-5` ($4 in / $20 out / $0.20 cache read / $5 cache write per million); production uses `claude-sonnet-4-6` per the 2026-10-27 QA ($3 / $15 / $0.30 / $3.75). Token counts below come from the Opus run; the Sonnet figure applies Sonnet prices to those same counts, so it is a price conversion, not a Sonnet run. Gemini 2.5 Flash priced at $0.30 in / $2.50 out per million (from memory, not checked against the current price page).

| Step | Model calls | Claude tokens (in / cache write / cache read / out) | Cost on Opus 5.5 | Cost on Sonnet 4.6 |
|---|---|---|---|---|
| Script and frame sketches | 9 | 1.5k / 17.0k / 21.3k / 15.3k | $0.401 | $0.304 |
| Director (plan, then repair) | 2 | 7.7k / 14.9k / 14.9k / 8.3k | $0.274 | $0.208 |
| Voiceover (Gemini TTS) | 12 | n/a (2,173 audio output tokens) | about $0.035 (app's own rate card: $0.0004 per second) | same |
| Motion direction | 12 | 59.9k / 0 / 0 / 4.0k | $0.319 | $0.239 |
| **Making the film (preview ready)** | **35** | | **$1.03** | **$0.79** |
| Final render | worker, no model call | scenes already drawn in the background | about $0.006 of worker time at the Fargate rate in `docs/PRICING.md` (see caveat) | same |
| **Total, no revisions** | | | **about $1.05** | **about $0.81** |

What revisions cost (same project):

| Change | Calls | Cost on Opus 5.5 | Cost on Sonnet 4.6 |
|---|---|---|---|
| Preview comment the intent reader answered with a question (the case you flagged): intent only, nothing applied | 1 Gemini | $0.003 | $0.003 |
| Comment applied to the wrong scene, fixer found nothing to change | 1 Gemini + 1 Claude | $0.014 | $0.011 |
| Comment applied (intent, frame fix, motion re-direction) | 1 Gemini + 2 Claude | $0.12 | $0.09 |
| One-line voiceover edit, then Create preview again (director, all 12 voice takes and all 12 motion calls ran again) | 25 | about $0.50 | about $0.39 |

Findings from the run:
- **Claude per film measured $0.79 (Sonnet) to $1.03 (Opus) against the estimate of $0.91 for 9 beats**, so the estimate was close; `docs/PRICING.md`'s $0.06 for script and storyboard was about 13× too low.
- **Film length:** requested 45 s, finished 66.5 s. Charged by finished length: 16.75 tokens (7.5 free plus 9.25 pack in the ledger).
- **Revenue against cost at today's rate (0.25 token per second):** 16.75 tokens is $1.67 at list, $1.59 at the Starter rate, $1.39 at the Business rate. Against $0.81 of cost that is about 49% margin before the payment fee with no revisions. With one recreate and three applied fixes ($0.39 + $0.27) cost reaches about $1.47 and **the margin on Starter falls to about 8%, and Business goes negative.**
- **A one-line edit re-runs the whole voice and motion pipeline.** Voice takes and motion are not reused per scene after the plan is rebuilt, so a one-word change costs about half the original film. That is the single biggest saving available in the code.
- **A hook of six words blocks the final render.** The generated script's first line ("One number in a million. How?") failed the render check ("keep it to 5"); I shortened it by hand. Worth fixing in the director so customers do not meet it.
- **Caveats:** the render ran in local Docker (4 min 10 s end to end, 248 s of worker time; scene drawing ran about 475 clip-seconds across 3 parallel slots), not on Fargate, so the worker cost is the documented rate applied to measured seconds, not a bill. Cost of storyboard text edits that do not rebuild the plan was not measured. One film, one template: the other templates remain estimates.

### Infrastructure and rendering cost (AWS, Railway and the rest)

**Actual AWS bill, 1–28 October 2026** (Cost Explorer, read with the `Admin_user` key, read-only queries):

| Service | Gross usage | Note |
|---|---|---|
| Amazon ECS (Fargate worker) | **$10.26** | 207 on-demand ARM vCPU-hours (about 103 task-hours) plus 3.5 Spot vCPU-hours; at the published rate that is $10.2, so the rate in the table below is confirmed by the bill |
| AWS Secrets Manager | $1.52 | fixed, per secret per month |
| Public IPv4 addresses | $0.53 | |
| RDS (one `db.r7g.large`, about 1 hour) | $0.09 | check nothing was left running |
| ECR image storage | $0.08 | |
| **Total gross** | **$12.48** | **Credits of -$12.48 cover all of it: net $0.00 so far** |

The Fargate hours include every test, QA run and 600 s idle wait, so they cannot be divided by a film count from the bill alone (the number of production films this month was not read). Credits make October free; the table below is what the same usage costs once credits run out. The other fixed services (Railway, Supabase, Vercel) are not on this AWS account and are still unverified.

The production worker task is 2 vCPU / 4 GB ARM64 (task definition revision 3); the Fargate rates below are AWS's public price list for ap-southeast-1. The film times are measured; the per-film totals are arithmetic.

Measured: the Binary Search final render took 4 min 10 s from click to ready and 248 s of worker time in local Docker; the 2026-10-27 production run took 3 min 31 s on a cold on-demand Fargate task (51 s start, 16 s prepare, 123 s frames, 12 s encode). The production task is 2 vCPU / 4 GB, ARM, Singapore, idle exit 600 s.

| Item | Rate used | Per film |
|---|---|---|
| Fargate worker, ARM 2 vCPU / 4 GB: $0.04045 per vCPU-hour + $0.00442 per GB-hour (AWS public price list, ap-southeast-1) = $0.0986 per hour | $0.0000274 per second | **$0.022–$0.025** on-demand when the task starts for one film (51 s start + about 160–250 s of work + 600 s idle wait, about 810–900 s billed); **about $0.007–$0.008** on Spot (discount "up to 70%"); **about $0.007** when films arrive inside each other's idle window and share it |
| Public IPv4 for the task, logs | about $0.005 per hour of task time | under $0.002 |
| Cloudflare R2 storage for the 13.5 MB output | $0.015 per GB-month, no egress fee | about $0.0002 per film per month kept |
| Preview scene drawing | runs on the same worker | included in the figures above |

So **infrastructure per film is about $0.01–$0.025, against $0.79 for the models: roughly 1–3% of the per-film cost.** Pricing should follow the model calls, not the render.

Fixed monthly cost does not scale with films. `docs/PRICING.md` assumes about $90 a month (Railway backend, Supabase Pro at $25, Vercel, storage, domain and mail); that figure is also unverified. Spread over films: about $0.90 a film at 100 films a month, $0.09 at 1,000. Break-even on it at the Starter rate with the measured $0.81 cost per film and no revisions is about 6–7 films a month per subscriber-equivalent of margin, so roughly 12 Starter subscribers using 8 films each cover $90.

What would move these numbers: a warm idle window of 120 s instead of 600 s cuts the isolated-render case from about $0.024 to about $0.010 (arithmetic from the published rate, not measured); a Fargate task slower than local Docker raises worker seconds in proportion; heavy 3D or material templates draw more frames per second of film. None of these was measured.

With the measured Sonnet cost, the proposed burn (6 tokens to start plus 0.3 per second, 25.9 tokens for this film) gives about 64% margin on Starter with no revisions and about 41% with one recreate and three applied fixes, against 49% and 8% at today's rate. That supports the start fee and the new burn; it does not by itself support the larger changes to Free and material styles, which rest on provider list prices and still need their own measured runs.


Sources: `docs/PRICING.md` (current plans and its cost table), `docs/qa/2026-10-27-binary-search-e2e.md` (a real Binary Search run), local project rows (`planAudio.cost_usd`), `docs/MOTION_PIPELINE.md` and `docs/STYLE_PRODUCTION_PROGRESS.md` (Veo, Nano Banana, Lyria prices), and the director/frame code (what calls Claude, how often).

### Measured
- **Voiceover (Gemini TTS):** $0.018–$0.109 per film across 11 local Binary Search and similar projects; typical $0.02–$0.03 for a 55–64 s film.
- **Binary Search run (production QA):** 1,215 frames at ~9.5 frames/s, about 123 s of rendering on a 2 vCPU worker; submit to review 3 min 31 s; two director calls (~47 s and ~30 s). Requested 45 s, but the local runs finished at **54–64 s**. A film is charged by its real length.
- **Render compute:** about $0.02 per film including the idle time a warm Fargate worker keeps billing.

### Estimated (not measured)
Claude Sonnet 4.6 at $3/M input, $15/M output, cached system prompt of about 9k tokens (`backend/skills/director`, 28 KB):

| Claude work per film | Per call | Calls | Cost |
|---|---|---|---|
| Director (plan, then repair call) | $0.13 for both | 2 | $0.13 |
| Frame sketch (SVG, up to 6,000 output tokens) | about $0.047 | one per beat | $0.047 × beats |
| Motion direction | about $0.021 | one per beat | $0.021 × beats |
| Frame rewrites (assumed three) | about $0.057 | 3 | $0.17 |

So Claude is **about $0.30 fixed plus $0.068 per beat**, roughly $0.91 for a nine-beat film. `docs/PRICING.md` carries $0.06 for this, which looks too low by 5–10×. That is the largest open question in the whole plan.

### Per template (variable cost, with 15% for retries)

| Template | Type | Length | Beats | Claude | Voice | Music | Render | Generated | **Cost** | Revenue at 0.25 token/s | Margin before fee |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Binary Search | clean, voiceover | 60 s | 9 | $0.91 | $0.02 | | $0.02 | | **$1.10** | $1.50 | $0.40 |
| Binary Search as requested | clean, voiceover | 45 s | 7 | $0.78 | $0.02 | | $0.02 | | **$0.94** | $1.12 | $0.18 |
| API Request Flow | clean, voice and music | 45 s | 7 | $0.78 | $0.02 | $0.08 | $0.02 | | **$1.03** | $1.12 | $0.09 |
| Aurora Terrain | three.js 3D, music | 20 s | 3 | $0.51 | | $0.08 | $0.02 | | **$0.70** | $0.50 | **−$0.20** |
| Kinetic Quote Stack | kinetic type, music | 15 s | 3 | $0.51 | | $0.08 | $0.02 | | **$0.70** | $0.38 | **−$0.32** |
| Clay Clean | generated material, voice | 40 s | 6 | $0.71 | $0.02 | | $0.02 | $4.00 (6 Veo-fast shots at $0.667) | **$5.46** | $1.00 | **−$4.46** |
| Clay Clean at the doc's $1.40 a shot | | 40 s | 6 | | | | | $8.40 | **$10.52** | $1.00 | **−$9.52** |

Three things follow:
1. **Cost is mostly per film and per beat, not per second.** Short films lose money: 15–20 s templates cost $0.70 and sell for $0.38–$0.50.
2. **Material styles (clay, paper, origami, any generated footage) lose $4–$10 per film.** `docs/PRICING.md` confirms they are not metered today; `materialCostMillitokens` (4× provider cost) exists but is not applied.
3. **Planning is free and unlimited.** Writing a storyboard (director plus sketches) costs about $0.50–$0.60 and is not charged. A free account can generate plans without limit.

## Current State
Four plans (Free, Starter $19/200 tokens, Pro $49/550, Business $149/1,800), a $10 pack of 100 tokens, $1 = 10 tokens, one second of finished video = 0.25 token (`packages/contracts/src/pricing.ts`). Free is 7.5 tokens once. Pro and format renders became token-charged today; material generation and storyboard writing are not charged. Lemon Squeezy checkout is still off until its variants are configured, so there are most likely no paying subscribers yet *(assumed, confirm)*.

## Problem to Solve
Under the estimate above the current price is roughly break-even at list rate and negative on Business, short films and every generated-material style, and Free costs about $0.70–$1.20 per signup (not $0.20). The price has to follow what drives cost: the film's start, its beats, and generated material.

## Recommended Pricing Model
**Hybrid: tiered subscription with a monthly token allowance, and a usage-based token burn per film.** The decision tree in `references/model-selection.md` points the same way: value scales with usage the customer can predict (a film), and one tier is fenced by a real need (Pro editor). Keep the token as the unit ($1 = 10 tokens) so the ledger, checkout and site do not change.

## Value Metric
**The finished film**, sized by its length: tokens = start fee + seconds. Customers think in films and minutes; cost follows the film's start, beats (which track seconds) and generated shots. The start fee carries the fixed Claude cost, so a 15 s film is no longer a loss.

Proposed burn (replaces 0.25 token/s):

| Film | Burn |
|---|---|
| Start fee (storyboard, first draft and up to three rewrites included) | **6 tokens** |
| Each finished second | **0.3 token** |
| Examples | 15 s = 10.5 · 30 s = 15 · 45 s = 19.5 · 60 s = 24 tokens |
| Extra storyboard regeneration beyond three per film | 2 tokens |
| Generated material (clay, paper, footage, 3D shots) | provider cost × 4, shown before generating: a 6 s Veo-fast shot ($0.667) ≈ 27 tokens |

Margin check, pessimistic cost, Lemon Squeezy at 7% + $0.50 per subscription order: about 47% at 60 s, 40% at 30 s and 32% at 15 s on Starter; at 60 s, 44% on Pro and 40% on Business. If measured Claude cost is half the estimate, margins rise to about 65–75%. (Computed from the table above, not from measured data.)

## Proposed Tiers

| Tier | Target | Price | Key features | Lock-in |
|---|---|---|---|---|
| **Free** | Individual trying one real product | $0 | **11 tokens once** (one watermarked 15 s film), 2 storyboards, preview in the app, brand kit | Their brand kit and storyboards are saved; the watermark nudges upgrade |
| **Starter** | Founder shipping product videos | **$19/mo** · $190/yr | 200 tokens/mo (about 8 one-minute or 13 half-minute films), no watermark, 40 storyboards/mo | Brand kits and project history |
| **Pro** | Teams who edit every frame | **$49/mo** · $490/yr | 550 tokens/mo (about 22 one-minute films), Pro editor, 120 storyboards/mo, material styles | Pro editor projects (layers, keyframes) |
| **Business** | Agencies and product marketing | **$149/mo** · $1,490/yr | 1,800 tokens/mo (about 75 one-minute films), 400 storyboards/mo, material styles, priority render queue | Volume, shared brand work |
| **Studio** | 5+ seats, SSO, SLA | **from $499/mo, annual** *(assumed, confirm)* | Seats, admin, invoicing, higher render limits | Security, contracts |
| **Token pack** | Anyone | **$12 / 100 tokens** (was $10) | Never expire | None |

Price jumps are 2.6× then 3×, within the 3–5× guide; the middle tier is better value per token than Starter (not worse). Packs move to $0.12 a token so a regular buyer sees that Starter ($0.095) and Pro ($0.089) are cheaper, which creates the upgrade pull. Annual is two months free (about 17%).

## Free-to-Paid Upgrade Trigger
The first time a free account tries to **export a second film or one longer than 15 s**, or opens a material style or the Pro editor. The Render button shows the film's cost, the balance, and "Add tokens" or "Choose a plan" (already built). A second trigger: the watermark on the one free film they share.

## Freemium Decision
The skill's test fails on the first line: marginal cost per free user is **not near zero** ($0.70–$1.20 with two storyboards and one 15 s film). Keep Free, but only as a bounded trial: lifetime allowance, two storyboards, no material styles, email verified, and one account per phone or card fingerprint *(assumed, confirm)*. Break-even check: at 3% free-to-paid *(assumed, confirm)*, a Starter customer at 45% margin staying four months returns about $34 per paying customer, or about $1.00 per signup, against $0.70–$1.20 cost. That is close to break-even, so Free must not grow in size or screening gets looser.

## Competitive Position
**Value-to-parity, not premium.** Competitor numbers are from memory and **not verified** *(assumed, confirm)*:

Competitor prices were later read from each company's pricing page on 2026-10-28; see "Market fit" in `docs/PRICING.md` for the verified table and sources (this document's earlier figures were from memory and are superseded).

At $19–$49 a month, Greedy Motion sits at parity with them. It is not an avatar tool, and its edge is on-brand explainer and product films from a script. Do not price below parity: unit economics above show there is no room for value pricing, particularly on Free and short films.

## Pricing Change Rollout

**Step-by-step**
1. **Measure Claude cost (before any change).** Store `input`, `output`, `cache_read`, `cache_creation` tokens from `anthropic_usage` against each project (today they are only logged; Railway production logs returned no matching lines when I looked). Render 3 real films (Binary Search 45 s, API Request Flow, one short) and compute actual cost per film. Replace the estimates here.
2. **Decide the numbers.** If measured Claude cost is within ±30% of the estimate, adopt the burn above. If it is half or less, keep 0.25 token/s but still add the 3-token start fee and the material meter; if it is above, raise the start fee.
3. **Close the cost leaks first (no price change needed):** meter generated material at 4× and make it paid-only; limit storyboards per plan; cap free accounts (one per verified email and phone).
4. **Change `packages/contracts/src/pricing.ts`:** `START_FEE_MILLITOKENS`, `MILLITOKENS_PER_SECOND` 250 → 300, Free 11 tokens, pack $12; update `renderCostMillitokens` and its tests; update the cost line on the storyboard and the 402 message.
5. **Lemon Squeezy:** the checkout is not on yet, so create the products at the final prices, plus annual variants, and set the variant environment variables. No existing subscription needs migrating *(assumed, confirm)*.
6. **Update the site and `docs/PRICING.md`:** plans page, cost-before-Render line, refund policy wording for the new pack price.
7. **Staging in test mode:** buy each plan, render a 15 s, 45 s and 60 s film, check ledger rows, refunds on failure and the 402 path.
8. **Launch with a price-lock promise:** early subscribers keep their plan price for 12 months.
9. **Review at 30 and 90 days** with real conversion and cost data; adjust the start fee and the Free allowance first (cheapest levers).

- **Grandfathering:** Yes, for anyone who subscribes before the change goes live (12-month price lock). If no one has subscribed yet *(assumed, confirm)*, there is nothing to migrate. Existing free accounts with 7.5 tokens keep what they hold.
- **Communication plan:** if existing paying users exist, email 30 days before, show the new film cost in the app a week before, and publish the formula (6 tokens + 0.3 per second) on the pricing page. Do not change anything silently.
- **Rollback plan:** keep the old constants behind a config flag for 60 days. Revert the burn if conversion falls by more than a third against the prior 30 days, or the refund rate passes 10%, or support tickets citing price double.

## Risks
- **Claude cost is estimated, not measured** → Mitigation: step 1; do not publish prices until measured.
- **Higher burn feels like a price rise** (a 60 s film goes 15 → 24 tokens) → Mitigation: show cost before Render, publish the formula, include storyboard and three rewrites in the start fee, lock price for early subscribers.
- **Free abuse (many accounts, unlimited storyboards)** → Mitigation: storyboard caps, verified email and phone, one free film.
- **Material styles still lose money if Veo prices change** → Mitigation: price from the live provider cost estimate, show it before generating, require paid plan.
- **Retry and failure refunds eat margin** → Mitigation: the render path now refunds only films that never reached the renderer; track failed-render rate and fix before it passes 5%.
- **Competitor prices mis-stated** → Mitigation: verify the table before publishing any comparison.

## Metrics to Monitor Post-Change
- Conversion rate (free to paid), by cohort
- Churn rate by tier
- Average revenue per user (ARPU)
- Expansion revenue (pack to plan, Starter to Pro)
- **Counter-metrics:** cost per accepted film (not per render), gross margin per tier, free-signup cost vs. conversion value, storyboards per film (rewrite abuse), failed-render rate and refunds, support tickets mentioning price, share of films under 20 s (fixed-fee sensitivity)

## Assumptions to confirm
1. Claude cost for templates other than Binary Search is still estimated (director 2 calls ≈ $0.13; sketches ≈ $0.047/beat; motion ≈ $0.021/beat; three rewrites ≈ $0.17); Binary Search was measured (section above).
2. Beats ≈ one per 7 seconds (matches 8–10 beats on 54–64 s local films).
3. Veo 3.1 Fast at $0.10/s plus a $0.067 keyframe, about $0.667 per 6 s shot; the docs also cite $1.10–$1.50 per shot.
4. Music (Lyria) $0.08 per song; render about $0.02 per film.
5. Lemon Squeezy fee 7% + $0.50 per order.
6. No paying subscribers yet; Lemon Squeezy checkout is off.
7. 3% free-to-paid conversion and four-month average life for the break-even check.
8. Competitor prices (all approximate, from memory).
9. Studio tier at $499/mo.
10. The three-tier "other templates" chosen (API Request Flow, Aurora Terrain, Kinetic Quote Stack, Clay Clean) stand for the clean, 3D/music, short-form and material families; the other 120+ gallery items were not individually costed.
