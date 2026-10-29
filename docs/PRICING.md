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
days under the approved refund policy. Generated material (material styles such as clay and paper, image and footage scenes, 3D shots) is sold at **3 x our provider
cost**: $1 of generation = 30 tokens. It is paid-plan only (below).

## Plans

| Plan | Price | Annual | Tokens a month | 60 s films | 30 s films | Per token | Watermark | Pro editor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free | $0 | | 33, once, for the account | 0 (one film up to 90 s) | 1 (or 2 at 30 s) | | yes | no |
| Starter | $19 | $190 (2 months free) | 200 | 8 | 13 | $0.095 | no | no |
| Pro | $49 | $490 | 550 | 22 | 36 | $0.089 | no | yes |
| Studio | $99 | $990 | 1,200 | 50 | 80 | $0.083 | no | yes |
| Token pack | $12 once | | 100 | 4 | 6 | $0.12 | per plan | per plan |

**Every plan is for one person.** An account has one token balance and one brand library, and nothing is shared. The plans differ by
how many films that person makes: Starter about 8 one-minute films a month (a founder or creator shipping product videos), Pro about 22
(a creator who also edits every frame in the Pro editor), Studio about 50, nearly two a day (a creator posting films every
week; there is no client or team access, so the work is theirs to deliver). The top plan was a $149 "Business" plan with 1,800
tokens (75 films a month) until 2026-10-28; that is more films than one person makes and $50 to $60 above the dearest
single-person plans in the market (Synthesia Pro $89, Runway Max $95), so it became Studio at $99 for 1,200 tokens, which keeps
the same price per token and the same margins. Internally the tier id is still `business` (database rows, the Lemon Squeezy variable);
only the name shown to people changed.

A pack costs $0.12 a token, more than every plan, so a regular buyer sees why to subscribe. Price steps are 2.6x (Starter to
Pro) and 2x (Pro to Studio). Annual billing is a Lemon Squeezy variant set up at launch (see setup below); it is not in code.

## How a video's tokens are worked out

Everything a video can cost, in the order a person meets it. **The price of the final render is worked out once, on the server
(`GET /v1/projects/:id/render/quote`, `backend/src/render/quote.ts`), with the function the render charges with, and the page shows
that figure**: what is on the button is what is taken. Before 2026-10-28 the page worked it out itself from a duration it had kept,
and after a script edit changed the voiceover the button could say 25.8 tokens while the render took 26.1.

| Step | What it costs the person | Our cost | When it is taken |
| --- | --- | --- | --- |
| Storyboard, preview, voice, motion | free, up to the plan's films (Free 3, Starter 15, Pro 45, Studio 100) | about $0.79 a film | never; counted per film |
| Changes after the first version | 3 included per film, then **2 tokens** each | $0.09 to $0.14 | when asked; given back on failure or no change |
| Generated scenes (clay, paper, footage, 3D) | **3 x provider cost**: 26.1 tokens a scene, paid plans only | $0.87 a scene | when generation is queued; resumed runs pay only what is not yet paid |
| **Final render** | **6 tokens + 0.3 per finished second**, each started second counts | about $0.02 render plus the film's making | at Render, before anything is built; returned if the film cannot start |
| Watermark, resolution, motion blur, Pro editor | no token cost (watermark is Free only; the Pro editor is a plan feature; blur is several times the render time, about $0.02 to $0.1 of worker time, not charged) | | |

Worked example, the measured Binary Search film: the voiceover runs 66.5 s, so the render is charged for 67 s: 6 + 67 x 0.3 = **26.1
tokens**, $2.61 at list, $2.24 at the Starter rate. A 30 s film is 15 tokens, a 90 s film 33. The same film in a generated style adds
26.1 tokens a scene (a six-scene film, 158.7 with the style key) when its scenes are generated, and one more 2-token change after three.

**What a token costs us, by kind of use** (measured and list-price cost divided by the tokens charged), against what we receive per
token ($0.083 to $0.095 on a plan, $0.12 on a pack):

| Use | Tokens | Our cost | Our cost per token |
| --- | --- | --- | --- |
| A 15 s film | 10.5 | $0.36 | $0.034 |
| A 30 s film | 15 | $0.50 | $0.033 |
| A 60 s film | 24 | $0.77 | $0.032 |
| A 90 s film | 33 | $1.04 | $0.031 |
| A generated scene | 26.1 | $0.87 | $0.033 |
| A paid change (recreate / applied fix) | 2 | $0.14 / $0.09 | $0.070 / $0.045 |

So a token costs us about **3 cents** on films and generated scenes (4 to 7 cents on a paid change) and sells for 8 to 12 cents:
the price is the same multiple whichever way the tokens are spent, which is why a longer film, a generated one or a revised one is
paid for in proportion to what it costs.

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
revisions". Revenue per token: Starter $0.086, Pro $0.082, Studio $0.076.

| Film | Tokens | Our cost | with revisions | Starter | Pro | Studio |
| --- | --- | --- | --- | --- | --- | --- |
| 15 s | 10.5 | $0.36 | $0.69 | 60% / 24% | 58% / 20% | 54% / 15% |
| 30 s | 15 | $0.50 | $0.82 | 61% / 36% | 59% / 33% | 56% / 28% |
| 60 s | 24 | $0.77 | $1.09 | 63% / 47% | 61% / 45% | 58% / 40% |
| 90 s | 33 | $1.04 | $1.36 | 63% / 52% | 62% / 50% | 59% / 46% |

The rule behind the numbers: **good, not greedy.** Every plan keeps at least 50% on a film with no revisions (about 60% typical),
and at least 35% on films of 45 s or more with typical revisions; nothing ever loses money. No plan keeps more than about two thirds.
The shortest films with many revisions are the thin spot (15 to 36% at 15 to 30 s with revisions): the start fee is the same for
every film, and raising it would punish the customers who make short ones. A plan used to the last token on 60 s films keeps
63% (Starter), 61% (Pro), 58% (Studio) with no revisions and 47%, 45%, 40% with revisions.

Break-even on about $90 of fixed monthly cost (unverified): about 8 Starter subscribers using their full plan, or 3 Pro, or 2
Studio, at the no-revision margin (a subscriber's net revenue minus cost: $10.75, $27.42 and $53.07 a month); about a third more
with typical revisions.

## Free, exactly

**33 tokens once per account**: one watermarked film of up to 90 seconds, with its storyboard, voice and motion, and 3 films to try
(previews). It costs us about $0.50 if the person finishes the film (measured cost model), at most $2.37 more if all three previews are
used and never rendered. Every Free film carries a "Made with Greedy Motion" watermark for its whole length. When the tokens are
used, Render says what is needed and offers a plan or a pack. (It was 11 tokens, a 16-second film, until 2026-10-28; see "Market
fit": a 16-second film is too short to show what the product does.)

## Market fit

Prices read from each company's public pricing page on 2026-10-28 (links below); a page that did not load fully is marked.
"Per month on annual" is the plan's yearly price divided by 12 as the page states it.

| Product | What it makes | Entry | Mid | Top | Annual discount | Free |
| --- | --- | --- | --- | --- | --- | --- |
| **Greedy Motion** | explainer and product films from a script, in your brand | Starter $19 | Pro $49 | Studio $99 | 17% (2 months free) | one 90 s watermarked film + 3 previews, once |
| Synthesia | presenter-avatar videos | Starter $19 ($14 annual) | Pro $89 ($59) | Enterprise | 26% | free plan: 10 min, watermark |
| HeyGen | avatar videos | Creator $29 ($24) | Pro $49 | Business $149 + $20 a seat | 17% | 3 videos a month, 1 min each, watermark |
| InVideo | AI video from a prompt, credit based | Starter $20 a seat ($10 annual) | Plus $60 ($30) | Max $150 ($75) | 50% | not read |
| Runway | generated video clips, 12 credits a second | Standard $15 ($12) | Pro $35 ($28) | Max $95 ($76) | 20% | 125 credits once (about 10 s) |
| Descript | video and audio editing | Hobbyist $24 ($16) | Creator $35 ($24) | Business $65 ($50) | 33% | 60 media minutes, watermark |
| Canva | design with video | Pro $144 a year ($12) | Business $250 a year per person | | | free tier, limited AI video |

Sources: [Synthesia](https://www.synthesia.io/pricing), [HeyGen](https://www.heygen.com/pricing), [InVideo](https://invideo.io/pricing/),
[Runway](https://runway.com/pricing), [Descript](https://www.descript.com/pricing), [Canva](https://www.canva.com/pricing/). Veed's page
returned no prices. Canva's page showed yearly prices only. Descript's page showed two prices per plan without labels; the higher is
read as monthly. HeyGen's Pro and Business annual prices are not on the page.

**Where we sit.** The ladder is the market's for one person: $19 / $49 / $99 against Synthesia $19 / $89, HeyGen $29 / $49, Runway
$15 / $35 / $95, InVideo $20 / $60 / $150 a seat and Descript $24 / $35 / $65. The entry price matches Synthesia's and is below
HeyGen's and InVideo's, the middle plan equals HeyGen Pro, and the top sits just above Synthesia Pro and Runway Max, the dearest
single-person plans read. That is **parity**, deliberately: nothing in the cost data allows value pricing, and there is no reason to
price above tools that make a different thing. (HeyGen Business at $149 and InVideo Max at $150 are team-sized plans with seats; the
former $149 top plan here was priced against them, which was wrong for a product with no teams.)

**What a customer gets for the money.**
- *Standard films* (storyboard, voice, motion graphics, in the customer's brand): Starter makes about 8 one-minute films a month,
  $2.28 a finished minute ($1.90 on annual). Synthesia Starter gives about 22 minutes of avatar video for $19 (about $0.86 a minute,
  $0.64 on annual), so we cost roughly 2 to 3 times as much a minute; but a presenter reading a script is not a storyboarded
  explainer with diagrams and a brand kit, and the comparison is about price, not equivalence.
- *Generated clips* (clay, paper, footage): 26.1 tokens an 8 second scene is $2.50 at the Starter rate, about $19 a minute. Runway
  Standard is about $17 a minute (625 credits is 52 s), Runway Pro about $11 and Max about $7. We match Runway's entry plan and are
  dearer than its volume plans, for a clip that comes with the script, voice and brand around it.

**What was changed for the market.**
- **Free is a 30-second film, not 16 seconds** (15 tokens, not 11). HeyGen gives 3 one-minute videos a month, Synthesia 10 minutes,
  Descript 60 minutes: all more than we give, and all monthly. We cannot match them (3 films a month would cost us about $2.40 a
  signup a month, forever), so the lifetime film is made long enough to show the product: a 30-second explainer is the shortest film
  with a hook, a point and a close. It costs us about $0.13 more per signup.
- **Everything else stays**: prices, tokens, the annual discount (17%, below the 20 to 50% most competitors give; the lock test shows
  annual Studio already falls to 23 to 29% with revisions, so a deeper discount would take it under the floor), the $12 pack.
- **One person, by design (2026-10-28):** an account is one person, with one token balance, one brand library and no seats or
  shared workspace, so every competitor comparison above is one seat of theirs (HeyGen Creator, Synthesia Starter, InVideo Starter per
  seat). Seats, teams, 4K export and presenter avatars do not exist and the plans do not promise them. Per-seat pricing becomes a
  question only if a shared workspace is built.

**Risks the table shows.** InVideo's annual price is half its monthly, so a customer shopping on annual price sees us dearer than
InVideo and Descript. Synthesia's Starter minute is cheaper than ours. Runway Max undercuts our generated clips for a heavy user.
Mitigation: the product is sold on the finished film, not the minute; revisit after 30 days of real conversion data.

## Painted (GPU) films

The painted-shorts engine (worker `templates/painted`, branch `feat/painted-templates`) makes a narrated film in a painted look from a
script. Its 15 doodle looks are canvas 2D and run on ordinary CPU workers; its oil looks (oil, watercolour, pastel, gouache, ink) need a
GPU. On staging the oil looks are locked ("Coming soon") because no GPU worker exists yet. Figures below were reported by the session that
builds the engine on 2026-10-28 (M = measured, E = estimate); nothing GPU has run on AWS.

**What is known.**
- (M) Oil, 93 s film at 540x960: 1,116 drawings painted in 27 s on a Mac M1 Pro GPU, about 0.3 s of paint per finished second. On software
  GL oil is about 10 s a drawing, about 2 hours a film: unusable. (E) The T4 on the planned g4dn.xlarge is unmeasured.
- (E) Hosting: an ECS capacity provider over an Auto Scaling group of g4dn.xlarge (one T4, 4 vCPU, 16 GB), 0 to 1 instance, one film at a
  time. About $0.53 an hour on demand in us-east-1, about $0.74 in Singapore; per-second billing with a 60 s minimum; Spot not used. Built and
  idle on staging (`infra/aws/gpu-capacity.sh`). **Blocker:** the account's quota for G and VT on-demand instances is 0 vCPUs in both
  ap-southeast-1 and us-east-1; 8 were requested in each (pending), so nothing can run until AWS grants them.
- (E) The whole job runs on the GPU worker, not just the painting: director, objects, voice, music, paint. Gemini brain 285 s, Claude brain
  488 s (measured on a Mac), so 5 to 8 minutes of GPU instance per film, plus a few minutes to boot an instance and a 600 s idle tail.
- Model calls (E, from the engine's `docs/BRAIN_COMPARE_2026-10-28.md`, run 2): **$0.73 a film with the default Gemini brain** ($0.16 for
  the director and review calls plus about $0.57 for about 5 object-oracle calls at $0.11, measured on 3 samples) and **$1.59 with the Claude
  brain**. Voice (Gemini TTS, about $0.035) and music (Lyria, about $0.08) are **not** in those figures, so $0.115 is added below. No video
  or image generation. The recipe cache of drawn objects is not shared across films yet, so every film pays the oracle again. A shared cache
  (a Postgres table keyed by the object description) would remove the oracle calls for repeated objects, but its hit rate is unknown, it is
  not built and its owner has not been asked to build it: **it is not priced in** (native drawings such as a hat, fruit, bench or chair
  already cost no call).
- A change re-runs from the saved spec: voice and music are reused, one language call per comment, the whole film is repainted (the frame
  cache is not kept). So a change is a full repaint and little in model calls: about $0.05 (a language call plus 90 s of GPU).

**Estimated cost of a 60 s painted film** (voice and music added, GPU time for the whole job at $0.74 an hour):

| Case | Model calls incl. voice and music | GPU instance | Total | Against a normal 60 s film ($0.77) |
| --- | --- | --- | --- | --- |
| Low: default Gemini brain, warm shared GPU (8 min) | $0.85 | $0.10 | **$0.94** | 1.2 x |
| Mid: Claude brain, cold start on demand (4 min boot + 8 min + 10 min idle) | $1.71 | $0.27 | **$1.98** | 2.6 x |
| High: mid with 15% for retries and oracle timeouts | | | **$2.27** | 2.9 x |

A GPU instance left running for one customer would be about $540 a month, so it must scale to zero; the cost is the cold start tail, not
the painting. Model calls are most of the cost in every case.

**What to charge: 6 tokens to start plus 0.7 token a second** (`paintedCostMillitokens` in `packages/contracts/src/pricing.ts`), about
double a normal film: 30 s is 27 tokens, 60 s is 48 ($4.80 at list), 80 s is 62, 90 s is 69. A painted film is made whole in its render
job, with no free preview, so the price covers everything. Margin after the payment fee, with the cost split into $0.25 fixed plus a
per-second part (Starter / Pro / Studio):

| Film | Tokens | Low (default brain) | Mid | High |
| --- | --- | --- | --- | --- |
| 30 s | 27 | 74% / 73% / 71% | 52% / 50% / 46% | 46% / 43% / 39% |
| 60 s | 48 | 77% / 76% / 74% | 52% / 50% / 46% | 45% / 42% / 38% |
| 90 s | 69 | 78% / 77% / 75% | 52% / 50% / 46% | 45% / 42% / 38% |

The lock test requires at least 70% on the default brain and 45% on the Claude brain with a cold start, on every plan. Two prices that were
tried against the same costs do not hold: **0.25 token a second** (what the engine's staging code charges today, 20 tokens for 80 s) keeps
18 to 23% in the low case and loses 67 to 99% in the mid and high cases; **the normal price** (6 + 0.3 a second, 30 tokens for 80 s) keeps
about 48% in the low case and loses 8 to 29% in the mid and high cases.

**Changes to a painted film** follow the same rule as any film (three included, then 2 tokens each): a change costs about $0.05, so 2
tokens ($0.15 to $0.19) covers it and the engine's staging charge of 1 token a comment ($0.08 to $0.09) is thin only when comments are many.

**What the engine's staging code already does right:** it charges at job start and returns the tokens when the film fails (`backend/src/painted/routes.ts`,
`syncProject` in `render/service.ts`), is not behind the preview meter and does not count as a revision. Only its amounts (0.25 token a second, 1
token a comment) are wrong, and its branch (`feat/painted-templates`, on origin/staging) is based on staging, so it does not have this price list
yet; its owner will change the amounts and the changes rule when merging with main.

**Before oil is turned on:** the quota (pending), the one-day T4 spike (Vulkan and Chrome on an NVIDIA host is untested; check the renderer
string, `nvidia-smi` proves nothing; **starting a GPU needs the engine owner's go-ahead, not given yet**), measured T4 seconds per film, the
Free-plan watermark on painted films (not built), the engine's amounts replaced by `paintedCostMillitokens` and the revision rule, a
model-budget guard per film, and a film class in the render quote so the page shows this price.

**Doodle films** (the 15 CPU looks) make the same model calls and need no GPU, so the same 6 + 0.7 a second covers them with a smaller compute
line. Their render time on Fargate is **unmeasured**: the only figure is a Mac CPU, 100 s of film painted in 229 s at 360 px inside the arm64
worker container, about 2.3 s of paint per finished second. The staging task is 4 vCPU / 8 GB and the default width is 540 px, so about 2.5 times
that is expected (about 5.8 s of paint per finished second, 460 s for an 80 s film); at the published Singapore rate for that task ($0.197 an
hour, $0.0000547 a second) that is about $0.025 of paint, $0.06 with the job's other steps and the idle tail. One run on staging will replace
this estimate.

## Preview allowance

Making a film costs about $0.79 in model calls (storyboard, frames, director, voice, motion) before anything is rendered, and the
tokens are taken only at **Render final video**. So each plan may work on a number of films per period; all the work on one film
(storyboard, voice, motion, fixes, rewrites) counts once.

| Plan | Films you may work on | Period |
| --- | --- | --- |
| Free | 3 | for the account, ever |
| Starter | 15 | each calendar month (UTC) |
| Pro | 45 | each calendar month |
| Studio | 100 | each calendar month |

**How the numbers were chosen.** A rendered film's own preview is already paid for by its tokens (the $0.77 cost per film in the
margin table includes it), so the allowance only has to cover the previews that are never rendered: each is about twice the films
the plan's tokens can render (Starter renders about 8 one-minute films, Pro about 22, Studio about 50). In the worst case, a
person who uses every preview and also renders every film their tokens allow costs us $12.0 on Starter against $17.17 it brings in
after the payment fee, $36.0 on Pro against $45.07, $80.0 on Studio against $91.57: no plan loses money at full use of
everything, and the lock test checks it. (The first draft of these allowances, 60, 200 and 600, would have cost $47, $158 and $474
at full use and was dropped for that reason; Studio's 100 was 150 when the top plan was Business.) Free: three previews cost at most $2.37, plus $0.37 if the one free film is rendered.

- **What counts:** a call to the model-backed routes of a project: script stream, frames, plan, plan audio, film animate, film fix
  and beat rewrite. Opening a project or a preview, comments, the intent reader and the final render are not counted.
- **Refusal:** the next new film gets 402 `preview_limit` with a plain message and the plan that allows more; films already counted
  keep working. A per-film safety cap of 150 calls a period answers 402 `preview_call_cap`.
- **Concurrency:** counting runs under a per-person lock, so two requests cannot both take the last place.
- **Profile:** the profile page shows "N of M films" and how many are left.
- **Local development:** off when `APP_ENV=local` unless `PREVIEW_LIMITS=on`; `PREVIEW_LIMITS=off` turns it off anywhere.
- **Tests:** `backend/test/preview-meter.mjs` (limits, months, call cap, concurrency, isolation), an enforcement test through the
  real hooks in `backend/test/ownership.mjs`, and the allowances and worst-case bound in `backend/test/pricing-lock.mjs`.

## Revisions

The start fee (6 tokens) is priced for a film that is changed a little after it is first made: about one recreate and two applied
fixes, $0.32 of model calls on top of the $0.77 to make it (measured 2026-10-28: a recreate from an edited script $0.14, an applied
comment $0.09, a comment that changes nothing $0.01).

- **Three changes per film are included.** A change is rebuilding the storyboard of a film that already has one (the "Recreate
  preview" of an edited script) or applying comments in the Preview. The first storyboard of a film is its making, not a change.
- **Each further change takes 2 tokens** ($0.17 to $0.20 at the plan rates: it covers a $0.14 recreate on every plan, the lock test
  checks it, and keeps about half of an applied fix).
- **Counted per film, per period** (Free: ever; paid plans: each calendar month), in `app.preview_usage.revisions`, under the same
  per-person lock as the preview allowance.
- **Given back** if the request fails, if the comments changed nothing, or if the storyboard could not be built or was cancelled. A
  change that is refused for lack of tokens is not counted: 402 `insufficient_tokens` with the price.
- **The Preview shows** how many of the three are still included, and the price after that (`GET /v1/projects/:id/revisions`).
- **Local development:** off when `APP_ENV=local` unless `PREVIEW_LIMITS=on` (same switch as the preview allowance).
- **Tests:** `backend/test/revision-meter.mjs` (included, charged, returned, refused, concurrent), the 402 through the real server in
  `backend/test/ownership.mjs`, and the constants and the cost bound in `backend/test/pricing-lock.mjs`.

## Generated material

Scenes made by an image and video model (the clay, paper, origami and illustration styles, footage and 3D shots) cost real money per
scene whatever happens to the film afterwards, so they are charged on their own, in tokens, on top of the film's burn.

- **Provider cost per scene** (Google list prices, from `docs/STYLE_PRODUCTION_PROGRESS.md`, checked 2026-10-09 and not re-checked):
  an image about $0.067 (Gemini 3.1 Flash Image, 1K), an eight-second clip $0.80 (Veo 3.1 Fast 720p, $0.10 a second). A film pays one
  style-key image, then a keyframe and a clip per scene (and an assembly image per scene for paper-cut): **$0.07 + $0.87 per scene**
  ($0.94 for one scene, $5.29 for six).
- **Price: 3 x that**, so $0.87 a scene is 26.1 tokens and a six-scene film is 158.7 tokens (about $15.9 at list). The margin is 67%
  before fees and 56 to 61% after the payment fee at the plan token rates, which leaves room for generations that fail or are redone
  (not measured; no generation call was made in the 2026-10-28 run).
- **The application's own reservation is larger** ($0.25 per image, $1.60 per clip, "not metered billing") and stays a safety
  ceiling; the person is charged the list-price estimate, not the reservation.
- **Paid plans only.** A Free account gets 402 `material_requires_plan` before anything is generated; the storyboard preview stays
  free.
- **When it is charged.** At the moment a run is queued, for what is not yet paid for; the Generate button shows the token price
  first. If the run cannot be queued the tokens are returned. A run stopped half way and resumed on the same storyboard owes
  nothing more (the charge is kept in `planVisuals.paidUsd`); a changed storyboard is a new film and is paid for in full.
- **Not refunded:** a run that was queued and then fails keeps its charge, because the provider bills submitted requests.
- **Local development:** off when `APP_ENV=local` unless `MATERIAL_BILLING=on`.
- **Tests:** `backend/test/material-billing.mjs` (price, charge once, refund on failed queueing, no double charge on resume, new
  storyboard pays in full), the paid-plan gate through the real server in `backend/test/ownership.mjs`, and the markup and the
  margin floor in `backend/test/pricing-lock.mjs`.

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
- Pro and Studio grant Pro-editor access through the entitlement layer; Starter does not.
- **Generated material is paid-plan only and charged** (2026-10-28): see "Generated material" below.
- **Revisions are capped and charged** (2026-10-28): see "Revisions" below.
- **The render price is quoted by the server** (`GET /v1/projects/:id/render/quote`) and shown as quoted; `backend/test/render-quote.mjs` checks the quote equals what the render charges for every length.
- **Previews are metered** (2026-10-28, `backend/src/plan/preview-meter.ts`, table `app.preview_usage`): see the next section.

**Not enforced yet, and the margins above assume it will be:**
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
| Studio | subscription, monthly | $99 | `LEMONSQUEEZY_VARIANT_BUSINESS` (the tier id is still business) |
| Starter (annual) | subscription, yearly | $190 | `LEMONSQUEEZY_VARIANT_STARTER_ANNUAL` |
| Pro (annual) | subscription, yearly | $490 | `LEMONSQUEEZY_VARIANT_PRO_ANNUAL` |
| Studio (annual) | subscription, yearly | $990 | `LEMONSQUEEZY_VARIANT_BUSINESS_ANNUAL` |
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
