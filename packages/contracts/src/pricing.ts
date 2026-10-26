// Plans, prices and what a token buys. One source for the backend (what it enforces and grants) and the site (what it
// shows). The numbers and the cost behind them are explained in docs/PRICING.md.
//
// A token is worth $0.10 at list price ($1 = 10 tokens). One second of finished video costs a quarter of a token, so a
// token is four seconds and a 30-second film is 7.5 tokens. The ledger counts millitokens so a second is a whole number.

export const TOKEN_USD = 0.1;
export const MILLITOKENS_PER_TOKEN = 1000;
export const SECONDS_PER_TOKEN = 4;
/** Millitokens one second of finished video costs. */
export const MILLITOKENS_PER_SECOND = MILLITOKENS_PER_TOKEN / SECONDS_PER_TOKEN;
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
    tier: "free", name: "Free", priceUsd: 0, tokens: 7.5, watermark: true, proEditor: false,
    blurb: "Try it on a real product. No card.",
    features: ["One film or several, 30 seconds in total", "Watermark on every film", "Guided flow, storyboard and brand kit"]
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

/** A one-time pack. Priced at the list rate: $1 = 10 tokens. */
export const TOP_UP = { priceUsd: 10, tokens: 100 } as const;

/** What a finished film of this length costs, in millitokens (each started second counts). */
export const renderCostMillitokens = (seconds: number) => Math.max(1, Math.ceil(seconds)) * MILLITOKENS_PER_SECOND;
/** What generated material costs us `usd` in provider fees, in millitokens charged. */
export const materialCostMillitokens = (usd: number) => Math.ceil((usd * MATERIAL_MARKUP / TOKEN_USD) * MILLITOKENS_PER_TOKEN);
export const tokensFromMilli = (milli: number) => Math.round(milli) / MILLITOKENS_PER_TOKEN;
export const secondsFromTokens = (tokens: number) => tokens * SECONDS_PER_TOKEN;
