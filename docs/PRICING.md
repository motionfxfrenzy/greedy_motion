# Pricing, tokens and billing

**Locked 2026-10-28.** The numbers live in one file, `packages/contracts/src/pricing.ts`; the backend enforces them and the site
shows them from it. `backend/test/pricing-lock.mjs` pins every number below and fails if a plan stops keeping its margin, so a price
changes only together with this document and that test. Merchant of record: Lemon Squeezy. Replaces the 2026-10-14 price list
(0.25 token per second, $10 pack, 7.5 free tokens), which kept 49% on a film with no edits and about 8% once a customer made the
revisions people actually make (section "Why the old price was replaced").

## The unit

**$1 = 10 tokens** at list price; a token is $0.10. **A film costs 6 tokens to start plus 0.3 token per finished second.**
The start fee covers the storyboard, its frames, the voice and the motion, which are the larger part of what a film costs us, and
the first revisions. Each started second counts whole.

| Film | Tokens | At list price |
| --- | --- | --- |
| 15 s | 10.5 | $1.05 |
| 30 s | 15 | $1.50 |
| 60 s | 24 | $2.40 |
| 90 s | 33 | $3.30 |

Plan tokens reset every month: each paid invoice first writes off what is left of the previous month's plan tokens, then grants the
plan's full allowance. When a subscription ends its remaining plan tokens end with it. Free and token-pack tokens never expire. A
render spends plan tokens first (they expire soonest), then the free allowance, then packs. Unused prepaid packs refund within 30
days under the approved refund policy. Generated material (material styles, image and footage scenes, 3D shots) is sold at **4 x
our provider cost** ($1 of generation = 40 tokens).

## Plans

| Plan | Price | Annual | Tokens a month | 60 s films | 30 s films | Per token | Watermark | Pro editor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free | $0 | | 11, once, for the account | 0 (one film up to 16 s) | 0 | | yes | no |
| Starter | $19 | $190 (2 months free) | 200 | 8 | 13 | $0.095 | no | no |
| Pro | $49 | $490 | 550 | 22 | 36 | $0.089 | no | yes |
| Business | $149 | $1,490 | 1,800 | 75 | 120 | $0.083 | no | yes |
| Token pack | $12 once | | 100 | 4 | 6 | $0.12 | per plan | per plan |

A pack costs $0.12 a token, more than every plan, so a regular buyer sees why to subscribe. Price steps are 2.6x (Starter to
Pro) and 3x (Pro to Business). Annual billing is a Lemon Squeezy variant set up at launch (see setup below); it is not in code.

## What a film costs us (measured)

One real run through the site on 2026-10-28: the Binary Search template, 9 beats, 66.5 s finished (45 s was asked for). Every model
call's token usage was recorded by a read-only wrapper around `fetch` on a local backend; no app code changed. Local `.env` ran
`claude-opus-5-5`; production runs `claude-sonnet-4-6` (2026-10-27 QA). The table prices the recorded token counts at Sonnet 4.6
rates ($3 in, $15 out, $0.30 cache read, $3.75 cache write per million), so it is a price conversion of an Opus run, not a Sonnet
run. Opus 5.5 ($4, $20, $0.20, $5) costs about 30% more.

| Step | Calls | Cost (Sonnet 4.6 prices) |
| --- | --- | --- |
| Script and frame sketches | 9 | $0.304 |
| Director (plan, then repair) | 2 | $0.208 |
| Voiceover (Gemini TTS) | 12 | about $0.035 (the app's rate card, $0.0004 per second) |
| Motion direction | 12 | $0.239 |
| **A film, preview ready** | **35** | **$0.79** |
| Final render | worker only | about $0.02 on-demand, see below |
| **Total** | | **about $0.81** |

Revisions, same project: a preview comment answered with a question $0.003; a comment applied to the wrong scene $0.011; a comment
applied $0.09; a one-line script edit recreated $0.39 before the fix on 2026-10-28 and **$0.14 after it** (3 calls instead of 25:
the director's voice direction is now kept between rebuilds, so unchanged voice takes and scene motion are reused).

**Infrastructure.** The production worker is 2 vCPU / 4 GB ARM64 on Fargate, Singapore, idle exit 600 s. AWS's public price list for
that region is $0.04045 per vCPU-hour and $0.00442 per GB-hour, $0.0986 an hour, $0.0000274 a second. A task started for one film is
billed about 810 to 900 s (51 s start, 160 to 250 s of work, 600 s idle wait): $0.022 to $0.025 on-demand, about $0.007 on Spot or
when films share the idle window. **The October bill confirms the rate:** AWS charged $12.48 for 1 to 28 October (ECS $10.26 for
about 103 task-hours, Secrets Manager $1.52, public IPv4 $0.53, RDS $0.09, ECR $0.08) and credits of $12.48 covered all of it, net
$0. Fixed services outside AWS (Railway backend, Supabase, Vercel, domain) are not on that account and are assumed at about $90 a
month in total, unverified. The render ran locally for 4 min 10 s; the production run on 2026-10-27 took 3 min 31 s on a cold task.

**Cost model used by the lock test:** per film, $0.23 fixed (director plus worker start) plus $0.009 per finished second; typical
revisions (one recreate and two applied fixes) add $0.32, an assumption about customer behaviour, not a measurement. Per-second
figure: (script and frames $0.304 + motion $0.239) / 9 beats / 7.4 s per beat, plus voice and render.

## Margins

Margin is after the Lemon Squeezy fee (7% + $0.50 per order, modelled), before fixed cost. Each cell is "no revisions / typical
revisions". Revenue per token: Starter $0.086, Pro $0.082, Business $0.077.

| Film | Tokens | Our cost | with revisions | Starter | Pro | Business |
| --- | --- | --- | --- | --- | --- | --- |
| 15 s | 10.5 | $0.36 | $0.69 | 60% / 24% | 58% / 20% | 55% / 15% |
| 30 s | 15 | $0.50 | $0.82 | 61% / 36% | 59% / 33% | 57% / 29% |
| 60 s | 24 | $0.77 | $1.09 | 63% / 47% | 61% / 45% | 58% / 41% |
| 90 s | 33 | $1.04 | $1.36 | 63% / 52% | 62% / 50% | 59% / 46% |

The rule behind the numbers: **good, not greedy.** Every plan keeps at least 50% on a film with no revisions (about 60% typical),
and at least 35% on films of 45 s or more with typical revisions; nothing ever loses money. No plan keeps more than about two thirds.
The shortest films with many revisions are the thin spot (15 to 36% at 15 to 30 s with revisions): the start fee is the same for
every film, and raising it would punish the customers who make short ones. A plan used to the last token on 60 s films keeps
63% (Starter), 61% (Pro), 58% (Business) with no revisions and 47%, 45%, 41% with revisions.

Break-even on about $90 of fixed monthly cost (unverified): about 8 Starter subscribers using their full plan, or 3 Pro, or 1
Business, at the no-revision margin (a subscriber's net revenue minus cost: $10.75, $27.42 and $80.31 a month); about a third more
with typical revisions.

## Free, exactly

**11 tokens once per account**: one watermarked film of up to 16 seconds, with its storyboard, voice and motion. It costs us about
$0.37 if the person finishes it (measured cost model). Every Free film carries a "Made with Greedy Motion" watermark for its whole
length. When the tokens are used, Render says what is needed and offers a plan or a pack.

## Why the old price was replaced

Measured on the same film at 0.25 token per second: 16.75 tokens ($1.59 at the Starter rate) against $0.81 of cost is 49% before
the payment fee with no edits; with one recreate and three applied fixes (the old $0.39 recreate) cost reached about $1.47 and the
Starter margin about 8%, with Business negative. `docs/PRICING.md` before this revision carried $0.06 for the script and
storyboard; the measured figure is $0.51 (script, frames, director), about 8 times higher. A 66.5 s film now costs 25.95 tokens
(about $2.60 at list, $2.23 at the Starter rate), +55% for the customer, for 63% instead of 49%.

## What is enforced today

- A storyboard film takes its tokens at **Render final video**, before anything is built or queued, under a per-user lock (two
  renders cannot spend the last tokens), and returns them if the film cannot start. A refused render answers 402
  `insufficient_tokens`. **Creating a preview is free.**
- Pro final renders and format renders take tokens the same way (2026-10-28); Pro previews stay free.
- Everyone may have 3 films queued or running at once (`RENDER_MAX_ACTIVE_PER_USER`); the next request gets 429 before any charge
  or model call.
- A render is bound to the storyboard it was charged for: if the storyboard changes before the renderer is queued, the job stops
  and returns the tokens (`revision_changed`).
- Free films are built with the watermark; paid plans without.
- Pro and Business grant Pro-editor access through the entitlement layer; Starter does not.

**Not enforced yet, and the margins above assume it will be:**
- **Preview creation is not metered.** Each preview costs about $0.79 (66 s) in model calls whatever the plan, and a Free account can
  make as many as it likes. The planned allowance is Free 3, Starter 60, Pro 200, Business 600 previews a month; until it ships a
  determined user can cost more than the start fee brings in. This is the largest open exposure.
- **Revisions are not capped.** The 6-token start fee is priced for about one recreate and two applied fixes; more are free today.
- **Generated material is not metered** (material styles, footage, 3D shots cost $0.667 to $1.40 a shot against nothing charged); it
  should be paid-plan only and charged at 4 x provider cost (`materialCostMillitokens`) before it is offered to Free.
- No check against one person opening many Free accounts.
- Other templates are not measured; only Binary Search was run. Voice (Gemini TTS) cost uses the app's own rate card.

## Reviewing the price

Re-measure and re-open this document when any of these changes: the production Claude model or its price; the director, sketch or
motion prompts (output tokens per film); the voice engine; Fargate size or region; the Lemon Squeezy fee; or the measured cost per
accepted film differs from $0.81 (66 s) by more than 20%. The first review is due after 30 days of real renders, when cost per
accepted film, previews per film and revisions per film can be read from usage instead of assumed.

## Lemon Squeezy setup

In the Lemon Squeezy dashboard, create one store and four products, all USD, then set the environment (backend service):

| Product | Type | Price | Variable |
| --- | --- | --- | --- |
| Starter | subscription, monthly | $19 | `LEMONSQUEEZY_VARIANT_STARTER` |
| Pro | subscription, monthly | $49 | `LEMONSQUEEZY_VARIANT_PRO` |
| Business | subscription, monthly | $149 | `LEMONSQUEEZY_VARIANT_BUSINESS` |
| Token pack | one-time | **$12** | `LEMONSQUEEZY_VARIANT_TOPUP` |

Also: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, optionally `LEMONSQUEEZY_TEST_MODE=true`
and `BILLING_RETURN_URL`. Add a webhook pointing at `https://<backend>/v1/billing/webhook` with that secret and these events:
`subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_resumed`, `subscription_expired`,
`subscription_paused`, `subscription_unpaused`, `subscription_payment_success`, `subscription_payment_failed`,
`subscription_payment_recovered`, `order_created`, `order_refunded`. Run staging in test mode first. Checkout stays off
(`501 billing_unavailable`) until the key, store and all four variants are set.

Webhook behaviour: every delivery is stored once; an invoice that arrives before its subscription is answered 409 so
Lemon Squeezy redelivers; an older event cannot overwrite a newer one; a first or renewal invoice expires last month's unused plan tokens and grants the plan's full allowance
once (a redelivered invoice changes nothing), a plan-change invoice grants nothing; a cancelled plan keeps Pro-editor access to the paid end date; an expired plan
returns to Free with the editor view-only, its remaining monthly tokens ended and the free allowance and packs kept; a refunded token pack takes its 100 tokens back.
A refunded subscription invoice is stored but needs a manual decision about its tokens.
