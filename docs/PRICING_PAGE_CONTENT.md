# Pricing page content

All the words for `/pricing`, in page order, with the numbers from the locked price list (`packages/contracts/src/pricing.ts`, `docs/PRICING.md`).
Written 2026-10-29. Items marked **[not built]** need work before they can go live.

---

## 1. Page title and description

- **Title:** Pricing — Greedy Motion
- **Description:** Start free with a 30-second film. Paid plans from $19 a month, priced in tokens.

## 2. Hero

- **Kicker:** Pricing
- **Headline:** Your first film is free.
- **Lead:** Make a real product film with no card. When you want more, pick a plan or top up: a film takes a few tokens to start and a few more for every second you make, and you see the price before you render.
- **Buttons:** Start free · See plans
- **Signed-in line (shown instead of the lead when logged in):** You're on the {Plan} plan · {n} tokens left · resets {date}

## 3. Plan finder ("Which plan?")

- **Title:** Which plan fits?
- **Prompt:** Tell us what you make and we'll pick the plan.
- **Control 1:** Films a month (slider 1 to 120, default 8)
- **Control 2:** Each film (15 sec · 30 sec · 60 sec)
- **Result:** About {n} minutes of video a month → **{Plan}** (+ {n} token packs when more than Studio gives) → ${price} / month
- **Button:** Choose {Plan}

## 4. Plan cards

Order: Free, Starter, **Pro (flag "Most chosen")**, Studio. Every plan is for one person: one account, one token balance, one brand library.

### Free
- **Price:** $0 — to start
- **Line:** Try it on a real product. No card.
- **Gets:** 1 film of 30 seconds in total (15 tokens, once)
- **Includes:**
  - One short film, up to 30 seconds
  - Storyboard, voice and motion included
  - 3 films to try before you decide
  - Watermark on every film
  - Guided flow, storyboard and brand kit
- **Button:** Start free

### Starter — $19 / month
- **Line:** For a founder or creator shipping product videos.
- **Gets:** 13 films of 30 seconds each month (200 tokens a month) — about 8 one-minute films
- **Includes:**
  - No watermark
  - 15 films a month to try (storyboard, voice, motion)
  - 3 changes per film included
  - Guided flow, storyboard and brand kits
  - Custom visual styles & 3D motion plates (clay, paper, studio), per scene
- **Button:** Choose Starter

### Pro — $49 / month  *(Most chosen)*
- **Line:** For creators shipping product videos regularly.
- **Gets:** 36 films of 30 seconds each month (550 tokens a month) — about 22 one-minute films
- **Includes:**
  - No watermark
  - 45 films a month to try (storyboard, voice, motion)
  - 3 changes per film included
  - Guided flow, storyboard and brand kits
  - Custom visual styles & 3D motion plates (clay, paper, studio), per scene
- **Button:** Choose Pro

### Studio — $99 / month
- **Line:** For creators who make films every week.
- **Gets:** 80 films of 30 seconds each month (1,200 tokens a month) — about 50 one-minute films
- **Includes:**
  - No watermark
  - 100 films a month to try (storyboard, voice, motion)
  - 3 changes per film included
  - Guided flow, storyboard and brand kits
  - Custom visual styles & 3D motion plates (clay, paper, studio), per scene
- **Button:** Choose Studio

### Signed-in button states
Your plan · manage · Change in billing · Free to start · Opening…

### Annual billing
- **Toggle:** Monthly · Annual — 2 months free · Save 17%
- **Card price when Annual is on:** Starter $190 a year ($15.83 a month) · Pro $490 a year ($40.83) · Studio $990 a year ($82.50)
- **Line under the toggle:** Annual plans give the same tokens every month. You pay for 10 months and get 12.

## 5. What a film costs in tokens

- **Title:** What a film costs in tokens
- **Lead:** A film takes 6 tokens to start plus 0.3 for each second of finished video. The price is shown before you render and is exactly what is taken. At list price a token is $0.10; on a plan it costs less.

| What | Tokens | At list price |
| --- | --- | --- |
| A 15-second film | 10.5 | $1.05 |
| A 30-second film | 15 | $1.50 |
| A 60-second film | 24 | $2.40 |
| A 90-second film | 33 | $3.30 |
| Trying a film (storyboard, voice, motion, preview) | 0 | up to 3 on Free, 15 to 100 a month on plans |
| Changes after the first version | 3 included, then 2 each | $0.20 each |
| A generated scene (clay, paper, footage), paid plans | 26.1 | $2.61 |

- **Token pack:** Need more? 100 tokens for $12, once. They never expire.

## 6. Compare plans

| | Free | Starter | Pro | Studio |
| --- | --- | --- | --- | --- |
| Monthly | Free | $19 | $49 | $99 |
| Annual (paid once) | — | $190 | $490 | $990 |
| Annual per month | — | $15.83 | $40.83 | $82.50 |
| You save a year | — | $38 (17%) | $98 (17%) | $198 (17%) |
| Per token, monthly | — | $0.095 | $0.089 | $0.083 |
| Per token, annual | — | $0.079 | $0.074 | $0.069 |
| Tokens | 15, once | 200 each month | 550 each month | 1,200 each month |
| Films of 30 seconds | 1 in total | 13 a month | 36 a month | 80 a month |
| Films of 60 seconds | — | 8 a month | 22 a month | 50 a month |
| Films to try (storyboard, voice, motion) | 3 in total | 15 a month | 45 a month | 100 a month |
| Changes after the first version | 3 included per film, then 2 tokens each | same | same | same |
| Custom visual style plates (clay, paper, studio) | — | 26.1 tokens a scene | 26.1 tokens a scene | 26.1 tokens a scene |
| Watermark | Yes | None | None | None |
| Storyboard, rewrites and brand kits | Included | Included | Included | Included |
| Seats | 1 | 1 | 1 | 1 |

## 7. Questions

1. **What is a token?** Tokens are what you spend to make films. A film takes 6 tokens to start plus 0.3 for every second of finished video, so a 30-second film is 15 tokens. The price is shown before you render and is the price taken. Trying a film costs nothing: your plan includes 15 to 100 films to try a month (Free: 3), with the storyboard, voice and motion, and tokens are taken only when you render.
2. **What do I get for free?** One finished film of up to 30 seconds for your account, with its storyboard, voice and motion, and 3 films to try. Free films carry a Greedy Motion watermark. There is no card and no trial that turns into a charge.
3. **What if I change my mind after the first version?** The first 3 changes to a film are included: rebuilding it after an edit, or applying comments in the preview. Each one after that takes 2 tokens, and a change that does not happen is never charged.
4. **What do generated scenes cost?** Styles whose scenes are made by an image and video model (clay, paper, footage) are for paid plans and cost 26.1 tokens a scene, shown before you generate them. They are paid when they are generated, on top of the film.
5. **Do tokens expire?** Your plan's tokens renew every month. Each renewal starts you again with the full amount, and what you did not use last month does not carry over. Token packs and your free allowance never expire, and a render uses your plan tokens first.
6. **What happens when I run out?** Render tells you how many tokens the film needs and how many you have. Nothing is charged automatically: add a 100-token pack for $12 or move to a bigger plan.
7. **Is it for teams?** Each account is for one person: one token balance, one brand library, no seats. Plans differ by how many films you make a month.
8. **Can I cancel or change my plan?** Yes, any time from billing. A cancelled plan keeps working until the end of the period you paid for, and the tokens you already have stay yours.
9. **Can I get a refund?** Unused prepaid tokens can be refunded within 30 days, under the refund policy. A film that has been delivered is normally not refundable for a change of mind. If a film cannot be started, its tokens are returned automatically.
10. **What about taxes and payment?** Prices are in US dollars and taxes are added at checkout. Payments are handled by Lemon Squeezy, which is the merchant of record.

## 8. Closing

- **Headline:** Ready to see your product in motion?
- **Buttons:** Start free · Choose a plan
- **Fine print:** Prices are in US dollars. Taxes are added at checkout. Unused prepaid tokens can be refunded within 30 days under the refund policy.

## 9. Notes for whoever builds or edits the page

- Every number above is computed from `packages/contracts/src/pricing.ts` on the live page; if a number here and the page disagree, the page is right and this file is stale.
- Do not promise teams, seats, 4K export or presenter avatars: none exist.
- Painted (GPU) looks are not on the page: oil is locked until a GPU worker exists. Their price when they ship is 6 + 0.7 tokens a second (`docs/PRICING.md`).
- Open policy question: a film that reaches the renderer and then fails there keeps its charge today (only films that cannot start are returned). The refund answer above says only what is true now.
