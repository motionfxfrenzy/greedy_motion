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
export const PREVIEW_ALLOWANCE = { free: 3, starter: 15, pro: 45, business: 150 } as const;
export const PREVIEW_CALL_CAP = 150;
/** What generated image or footage (material styles, 3D shots) is sold for, as a multiple of our provider cost. */
export const MATERIAL_MARKUP = 4;

export const PLAN_TIERS = ["free", "starter", "pro", "business"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export type PlanSpec = {
  tier: PlanTier;
  name: string;
  /** Monthly price in USD; 0 for Free. */
  priceUsd: number;
  /** Tokens granted when the plan starts and on every renewal. They reset each month: unused ones expire at renewal. Free: once, for the account, and it does not expire. */
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
    tier: "free", name: "Free", priceUsd: 0, tokens: 11, watermark: true, proEditor: false,
    blurb: "Try it on a real product. No card.",
    features: ["One short film, up to 16 seconds", "Watermark on every film", "Guided flow, storyboard and brand kit"]
  },
  starter: {
    tier: "starter", name: "Starter", priceUsd: 19, tokens: 200, watermark: false, proEditor: false,
    blurb: "For a founder shipping product videos.",
    features: ["No watermark", "Guided flow, storyboard and brand kits"]
  },
  pro: {
    tier: "pro", name: "Pro", priceUsd: 49, tokens: 550, watermark: false, proEditor: true,
    blurb: "For teams who edit every frame.",
    features: ["No watermark", "Pro editor: layers, keyframes and timeline", "Everything in Starter"]
  },
  business: {
    tier: "business", name: "Business", priceUsd: 149, tokens: 1800, watermark: false, proEditor: true,
    blurb: "For agencies and product marketing teams.",
    features: ["No watermark", "Pro editor", "Everything in Pro"]
  }
};

export const PAID_TIERS = ["starter", "pro", "business"] as const;
export type PaidTier = (typeof PAID_TIERS)[number];
export const isPaidTier = (value: unknown): value is PaidTier => PAID_TIERS.includes(value as PaidTier);

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
