// Plans, prices and what a token buys. One source for the backend (what it enforces and grants) and the site (what it
// shows). LOCKED 2026-10-28: the numbers below are pinned by backend/test/pricing-lock.mjs, and the facts behind them (measured
// model, voice and render cost of a real film, and the margin each plan keeps) are in docs/PRICING.md. Change a number only
// together with that test and that document.
//
// A token is worth $0.10 at list price ($1 = 10 tokens). A film costs a start fee of 6 tokens (it covers the storyboard, its
// frames, the voice and motion, and the first revisions) plus 0.3 token for every finished second: a 30-second film is 15
// tokens, a minute is 24. The ledger counts millitokens so a second is a whole number.

export const TOKEN_USD = 0.1;
export const MILLITOKENS_PER_TOKEN = 1000;
/** Millitokens a film costs before its first second: the storyboard, frames, voice and motion are the larger part of what a film costs us. */
export const START_FEE_MILLITOKENS = 6000;
/** Millitokens each finished second of video costs. */
export const MILLITOKENS_PER_SECOND = 300;
/**
 * Films a person may work on in a period (docs/PRICING.md): the storyboard, voice, motion and fixes of one project count once.
 * Free is a lifetime allowance for the account; paid plans reset each calendar month (UTC). A preview costs about $0.79 in
 * model calls (a rendered film's own preview is paid for by its tokens), so each allowance is about twice the films the plan's
 * tokens can render: room to start a film and change your mind, while a plan used to the limit on previews alone still pays. `PREVIEW_CALL_CAP` is a safety limit on calls inside one
 * project in one period.
 */
export const PREVIEW_ALLOWANCE = { free: 3, starter: 15, pro: 45, business: 100 } as const;
export const PREVIEW_CALL_CAP = 150;
/**
 * Changes to a film after it was first made that the start fee covers: recreating the preview from an edited script and
 * applying a comment in the Preview (a comment that changes nothing is not counted). Each further one takes REVISION_TOKENS.
 * Priced from measured cost: a recreate is about $0.14 and an applied fix about $0.09; two tokens is $0.17 to $0.20.
 */
export const FREE_REVISIONS = 3;
export const REVISION_TOKENS = 2;
/**
 * Painted (GPU) films: the painted-shorts engine makes the whole film in one job (director, objects, voice, music, painting on a GPU
 * worker), so there is no free preview and the price has to cover all of it. 6 tokens to start plus 0.7 a second, about double a normal
 * film (docs/PRICING.md, "Painted (GPU) films"). Not used by the app until the engine is merged onto this price list.
 */
export const PAINTED_MILLITOKENS_PER_SECOND = 700;
export const paintedCostMillitokens = (seconds: number) => START_FEE_MILLITOKENS + Math.max(1, Math.ceil(seconds)) * PAINTED_MILLITOKENS_PER_SECOND;

/** What generated image or footage (material styles, 3D shots) is sold for, as a multiple of our provider cost: 67% gross, about 56-61% after the payment fee at plan token rates, with room for generations that fail or are redone. */
export const MATERIAL_MARKUP = 3;

export const PLAN_TIERS = ["free", "starter", "pro", "business"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const isBillingInterval = (value: unknown): value is BillingInterval => BILLING_INTERVALS.includes(value as BillingInterval);

/** Annual billing is two months free: pay for 10 months once a year, get 12 monthly token grants. */
export const ANNUAL_MONTHS_CHARGED = 10;
export const ANNUAL_MONTHS_GRANTED = 12;

export type PlanSpec = {
  tier: PlanTier;
  name: string;
  /** Monthly price in USD; 0 for Free. */
  priceUsd: number;
  /** Annual price in USD (paid once a year; 10x monthly = 2 months free); 0 for Free. */
  annualPriceUsd: number;
  /** Tokens granted when the plan starts and on every monthly reset. Free: once, for the account, and it does not expire. */
  tokens: number;
  /** Watermark on every finished film. */
  watermark: boolean;
  /** Includes the Pro editor (layers, keyframes, timeline). */
  proEditor: boolean;
  /** One line for the price card. */
  blurb: string;
  features: string[];
};

export const PLANS: Record<PlanTier, PlanSpec> = {
  free: {
    tier: "free", name: "Free", priceUsd: 0, annualPriceUsd: 0, tokens: 15, watermark: true, proEditor: false,
    blurb: "Try it on a real product. No card.",
    features: [
      "One short film, up to 30 seconds",
      "Storyboard, voice and motion included",
      "3 films to try before you decide",
      "Watermark on every film",
      "Guided flow, storyboard and brand kit"
    ]
  },
  starter: {
    tier: "starter", name: "Starter", priceUsd: 19, annualPriceUsd: 190, tokens: 200, watermark: false, proEditor: false,
    blurb: "For a founder or creator shipping product videos.",
    features: [
      "No watermark",
      "15 films a month to try (storyboard, voice, motion)",
      "3 changes per film included",
      "Guided flow, storyboard and brand kits",
      "Generated scenes (clay, paper, footage), paid per scene"
    ]
  },
  pro: {
    tier: "pro", name: "Pro", priceUsd: 49, annualPriceUsd: 490, tokens: 550, watermark: false, proEditor: true,
    blurb: "For creators shipping product videos regularly.",
    features: [
      "No watermark",
      "45 films a month to try (storyboard, voice, motion)",
      "3 changes per film included",
      "Guided flow, storyboard and brand kits",
      "Generated scenes (clay, paper, footage), paid per scene"
    ]
  },
  business: {
    tier: "business", name: "Studio", priceUsd: 99, annualPriceUsd: 990, tokens: 1200, watermark: false, proEditor: true,
    blurb: "For creators who make films every week.",
    features: [
      "No watermark",
      "100 films a month to try (storyboard, voice, motion)",
      "3 changes per film included",
      "Guided flow, storyboard and brand kits",
      "Generated scenes (clay, paper, footage), paid per scene"
    ]
  }
};

export const PAID_TIERS = ["starter", "pro", "business"] as const;
export type PaidTier = (typeof PAID_TIERS)[number];
export const isPaidTier = (value: unknown): value is PaidTier => PAID_TIERS.includes(value as PaidTier);

/** Effective monthly price in USD on annual billing (e.g. $15.83, $40.83, $82.50). */
export const annualMonthlyUsd = (tier: PaidTier) => Math.round((PLANS[tier].annualPriceUsd / ANNUAL_MONTHS_GRANTED) * 100) / 100;
/** Dollars saved per year on annual billing vs 12 monthly payments (e.g. $38, $98, $198). */
export const annualSavingsUsd = (tier: PaidTier) => PLANS[tier].priceUsd * ANNUAL_MONTHS_GRANTED - PLANS[tier].annualPriceUsd;
/** Percentage saved on annual billing (17%). */
export const annualSavingsPercent = (tier: PaidTier) => Math.round((annualSavingsUsd(tier) / (PLANS[tier].priceUsd * ANNUAL_MONTHS_GRANTED)) * 100);
/** Price per token in USD, rounded to 3 decimal places ($0.095 / $0.089 / $0.083 monthly; $0.079 / $0.074 / $0.069 annual). */
export const tokenPriceUsd = (tier: PaidTier, interval: BillingInterval = "month") => {
  const monthlyPrice = interval === "year" ? PLANS[tier].annualPriceUsd / ANNUAL_MONTHS_GRANTED : PLANS[tier].priceUsd;
  return Math.round((monthlyPrice / PLANS[tier].tokens) * 1000) / 1000;
};

/** A one-time pack, $0.12 a token: dearer than every plan ($0.083 to $0.095), so regular buyers have a reason to subscribe. */
export const TOP_UP = { priceUsd: 12, tokens: 100 } as const;

/** What a finished film of this length costs, in millitokens: the start fee plus each started second. */
export const renderCostMillitokens = (seconds: number) => START_FEE_MILLITOKENS + Math.max(1, Math.ceil(seconds)) * MILLITOKENS_PER_SECOND;
/** What generated material costs us `usd` in provider fees, in millitokens charged. */
export const materialCostMillitokens = (usd: number) => Math.ceil((usd * MATERIAL_MARKUP / TOKEN_USD) * MILLITOKENS_PER_TOKEN);
export const tokensFromMilli = (milli: number) => Math.round(milli) / MILLITOKENS_PER_TOKEN;
/** Whole films of `seconds` a balance of tokens makes. */
export const filmsFromTokens = (tokens: number, seconds: number) => Math.floor((tokens * MILLITOKENS_PER_TOKEN) / renderCostMillitokens(seconds));
/** Seconds of finished video a balance makes when it is spent on one-minute films (a typical length; shorter films cost more per second because of the start fee). */
export const secondsFromTokens = (tokens: number) => filmsFromTokens(tokens, 60) * 60;
