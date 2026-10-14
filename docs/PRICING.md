# Pricing, tokens and billing

Set 2026-10-14. Replaces the historical $29/$59 proposal in `PRICING_AND_POLICY_PROPOSAL.md`. The numbers live in one file,
`packages/contracts/src/pricing.ts`; the backend enforces them and the site shows them from it. Merchant of record:
Lemon Squeezy.

## The unit

**$1 = 10 tokens** at list price, so a token is $0.10. **One second of finished video costs a quarter token** (a token is
4 seconds); a 30-second film is 7.5 tokens ($0.75), a minute is 15 tokens ($1.50). The ledger counts millitokens so a
second is a whole number. **Plan tokens reset every month.** Each paid invoice (the first and every renewal) first writes off whatever is left of
the previous month's plan tokens, then grants the plan's full allowance, so a customer who used 20% starts the next month
at 0% used with a full balance, and unused tokens do not carry over. When a subscription ends, its remaining plan tokens
end with it. **Free and token-pack tokens never expire.** A render spends plan tokens first (they expire soonest), then
the free allowance, then packs. Unused prepaid packs refund within 30 days under the approved refund policy. Only the
length of the finished film is charged; writing the storyboard and rewriting frames are included.

Generated material (material styles, image and footage scenes, later 3D shots) is sold at **4 × our provider cost**
($1 of generation = 40 tokens), because its cost is real money per call and varies by style.

## Plans

| Plan | Price | Tokens per month | Video per month | Watermark | Pro editor |
| --- | --- | --- | --- | --- | --- |
| Free | $0 | 7.5 once, for the account | 30 seconds in total, one film or several | yes | no |
| Starter | $19 | 200 | about 13 minutes | no | no |
| Pro | $49 | 550 | about 36 minutes | no | yes |
| Business | $149 | 1,800 | about 2 hours | no | yes |
| Token pack | $10 once | 100 | about 6.7 minutes | per plan | per plan |

Effective price per token: Starter $0.095, Pro $0.089, Business $0.083 (a discount on the $0.10 list rate that grows with
the plan). Paid plans renew monthly; each paid invoice grants the plan's tokens once. Free is a lifetime allowance (it does not expire and does not reset), not
monthly: it is what stops a free account costing money every month.

## What a second costs us

Measured or documented where a source exists, estimated where it does not (marked *est.*). A 30-second film:

| Item | Cost | Source |
| --- | --- | --- |
| Script and storyboard (Claude, plus about three frame rewrites) | $0.06 | `SKILL_LIBRARY.md`: fill mode $0.03–0.06 |
| Voiceover (Gemini TTS) | $0.01 *est.* | Gemini audio-output price, about 25 audio tokens a second |
| Music (Lyria, one song) | $0.08 | `MOTION_PIPELINE.md` |
| Render compute (Railway, 2 vCPU about 3.5× real time) | $0.02 | `STACK_DECISIONS.md` rates ($20 per vCPU-month, $10 per GB-month); computed $0.003, carried at $0.02 for headroom |
| Storage and egress (R2) | $0.002 *est.* | $0.015 per GB-month, free egress |
| Retries and revisions (15%) | $0.03 | assumption |
| **Total** | **$0.20 per 30 s, $0.0067 per second, $0.40 per minute** | |

Lemon Squeezy takes 5% + $0.50 per order, +0.5% on subscriptions, +1.5% for international buyers: modelled as **7% + $0.50**.
Fixed monthly infrastructure (Railway services, Supabase Pro, storage, domain and mail) is assumed at **about $90** and is not
in the per-second cost. These estimates must be replaced by measured cost per accepted video once real renders flow
(`STACK_DECISIONS.md` requires it); the margins below move with them.

## Margins

Selling at $1.50 a minute against $0.40 of cost. Margin is after variable cost and the Lemon Squeezy fee, before fixed cost:

| Plan | Revenue | Cost at full use | Fee | Margin at full use | Margin at 60% use |
| --- | --- | --- | --- | --- | --- |
| Starter | $19 | $5.33 | $1.83 | $11.84 (62%) | $13.97 (74%) |
| Pro | $49 | $14.67 | $3.93 | $30.40 (62%) | $36.27 (74%) |
| Business | $149 | $48.00 | $10.93 | $90.07 (60%) | $109.27 (73%) |
| Token pack | $10 | $2.67 | $1.20 | $6.13 (61%) | |
| Free | $0 | $0.20 once | | −$0.20 per account | |

Break-even on the $90 fixed estimate at 60% use: about 6.4 Starter, 2.5 Pro or 0.8 Business subscribers.
Free costs $0.20 per signup, so 100 signups cost $20; the abuse limit that keeps that true is below.

## Free, exactly

30 seconds of finished video per account, ever: one 30-second film, or several that add up to 30 seconds (a started second
counts whole). Every Free film carries a "Made with Greedy Motion" watermark in the lower right for its whole length. When
the 30 seconds are used, Render says what is needed and offers a plan or a pack. Not built yet: a limit on how many
storyboards a free account may write (each costs about $0.06), and a check against one person opening many accounts.
Both should land before Free is advertised.

## What is enforced today

- A render takes its tokens before anything is built or queued, under a per-user lock (two renders cannot spend the last
  tokens), and returns them if the film cannot start. A refused render answers 402 `insufficient_tokens`.
- Free films are built with the watermark; paid plans without.
- Pro and Business grant Pro-editor access through the existing entitlement layer; Starter does not.
- Not metered yet: the template (non-storyboard) render path, `POST /v1/render-jobs`, the Pro editor's own render, and
  material-scene generation (it reserves a dollar budget but charges no tokens). Material scenes should be limited to paid
  plans and charged at 4× before they are offered to Free.

## Lemon Squeezy setup

In the Lemon Squeezy dashboard, create one store and four products, all USD, then set the environment (backend service):

| Product | Type | Price | Variable |
| --- | --- | --- | --- |
| Starter | subscription, monthly | $19 | `LEMONSQUEEZY_VARIANT_STARTER` |
| Pro | subscription, monthly | $49 | `LEMONSQUEEZY_VARIANT_PRO` |
| Business | subscription, monthly | $149 | `LEMONSQUEEZY_VARIANT_BUSINESS` |
| Token pack | one-time | $10 | `LEMONSQUEEZY_VARIANT_TOPUP` |

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
