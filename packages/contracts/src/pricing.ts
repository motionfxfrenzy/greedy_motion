// Plans, prices and what a token buys. One source for the backend (what it enforces and grants) and the site (what it
// shows). LOCKED 2026-10-28 (v1_render_only) and extended 2026-11-09 with versioned per-step generation billing and
// Standard/Premium animation tiers (v2_step_tier, inactive in production pending tariff review).
// The numbers below are pinned by backend/test/pricing-lock.mjs, and the facts behind them are in docs/PRICING.md and
// docs/handoff/GENERATION_QUALITY_STEP_PRICING.md. Change a number only together with that test and those documents.
//
// In v1_render_only (production default and grandfathered legacy projects):
//   A token is worth $0.10 at list price ($1 = 10 tokens). A film costs a start fee of 6 tokens (it covers the storyboard, its
//   frames, the voice and motion, and the first revisions) plus 0.3 token for every finished second: a 30-second film is 15
//   tokens, a minute is 24. The ledger counts millitokens so a second is a whole number.
//
// In v2_step_tier (staging / per-step generation billing):
//   Each explicit generation step (script, storyboard, reference frames, voice/music, animation scenes, final MP4 export)
//   is quoted and charged for the work actually incurred at a 30% contribution margin floor after modeled payment processor
//   fees (7% + $0.50 per order) at the cheapest effective paid token price (Studio Annual: $990 / 14,400 tokens = $0.06875
//   gross, $0.00484722 fee, $0.04327778 maximum variable cost budget per token, ~23.10655 tokens per $1.00 variable cost).
//   Two animation quality tiers are offered for animation code generation:
//     - Standard (default): gemini-3.8-flash (available on all plans including Free)
//     - Premium: claude-opus-5-5 with prompt-cache gate (available only with an active paid subscription)

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
    tier: "free", name: "Free", priceUsd: 0, annualPriceUsd: 0, tokens: 33, watermark: true, proEditor: false,
    blurb: "Try it on a real product. No card.",
    features: [
      "One short film, up to 90 seconds",
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
      "Custom visual styles & 3D motion plates (clay, paper, studio), per scene"
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
      "Custom visual styles & 3D motion plates (clay, paper, studio), per scene"
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
      "Custom visual styles & 3D motion plates (clay, paper, studio), per scene"
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

// ---------------------------------------------------------------------------
// Versioned Per-Step Generation Billing & Standard/Premium Animation Tiers
// ---------------------------------------------------------------------------

export const BILLING_POLICY_VERSIONS = ["v1_render_only", "v2_step_tier"] as const;
export type BillingPolicyVersion = (typeof BILLING_POLICY_VERSIONS)[number];
export const isBillingPolicyVersion = (value: unknown): value is BillingPolicyVersion =>
  BILLING_POLICY_VERSIONS.includes(value as BillingPolicyVersion);

export const ANIMATION_TIERS = ["standard", "premium"] as const;
export type AnimationTier = (typeof ANIMATION_TIERS)[number];
export const isAnimationTier = (value: unknown): value is AnimationTier =>
  ANIMATION_TIERS.includes(value as AnimationTier);

export const DEFAULT_ANIMATION_TIER: AnimationTier = "standard";
export const PREMIUM_LOCKED_COPY = "Upgrade to access Premium animation.";

export type AnimationTierSpec = {
  id: AnimationTier;
  label: string;
  provider: "gemini" | "anthropic";
  model: "gemini-3.8-flash" | "claude-opus-5-5";
  requiresPaidSubscription: boolean;
  summary: string;
  lockedCopy?: string;
};

export const ANIMATION_TIER_SPECS: Record<AnimationTier, AnimationTierSpec> = {
  standard: {
    id: "standard",
    label: "Standard",
    provider: "gemini",
    model: "gemini-3.8-flash",
    requiresPaidSubscription: false,
    summary: "Standard scene animation (default). Fast, cost-effective scene authoring."
  },
  premium: {
    id: "premium",
    label: "Premium",
    provider: "anthropic",
    model: "claude-opus-5-5",
    requiresPaidSubscription: true,
    summary: "Premium scene animation with prompt caching. Higher token rate per scene; available on paid plans.",
    lockedCopy: PREMIUM_LOCKED_COPY
  }
};

/**
 * Free accounts always use Standard (gemini-3.8-flash). Premium (claude-opus-5-5) is available only with an active
 * eligible paid subscription (starter, pro, business), not merely possession of free or top-up credits.
 */
export const canUseAnimationTier = (planTier: PlanTier, animationTier: AnimationTier): boolean =>
  animationTier === "standard" || isPaidTier(planTier);

/** Target contribution margin after payment processor fees and all variable fulfillment costs (30%). */
export const TARGET_CONTRIBUTION_MARGIN = 0.3;
/** Modeled merchant-of-record percentage fee per order (7%, unverified against live processor invoices). */
export const PAYMENT_FEE_RATE_MODEL = 0.07;
/** Modeled merchant-of-record fixed fee in USD per order ($0.50, unverified against live processor invoices). */
export const PAYMENT_FEE_FIXED_USD_MODEL = 0.5;

/**
 * Exact unrounded gross revenue per token in USD (never derived from rounded display `tokenPriceUsd`).
 * - Starter monthly: 19 / 200 = $0.095
 * - Starter annual: 190 / 2400 = $0.07916667
 * - Pro monthly: 49 / 550 = $0.08909091
 * - Pro annual: 490 / 6600 = $0.07424242
 * - Studio (`business`) monthly: 99 / 1200 = $0.0825
 * - Studio (`business`) annual: 990 / 14400 = $0.06875
 * - Top-up pack: 12 / 100 = $0.12
 */
export function grossTokenPriceUsd(product: PaidTier | "topup", interval: BillingInterval = "month"): number {
  if (product === "topup") return TOP_UP.priceUsd / TOP_UP.tokens;
  const plan = PLANS[product];
  if (interval === "year") {
    return plan.annualPriceUsd / (plan.tokens * ANNUAL_MONTHS_GRANTED);
  }
  return plan.priceUsd / plan.tokens;
}

/**
 * Exact allocated payment processor fee per granted token in USD for a single order.
 * For Studio Annual ($990 order, 14,400 tokens granted across 12 monthly resets):
 *   (0.07 * 990 + 0.50) / 14400 = 69.80 / 14400 = $0.0048472222...
 */
export function allocatedOrderFeePerTokenUsd(
  product: PaidTier | "topup",
  interval: BillingInterval = "month",
  feeRate = PAYMENT_FEE_RATE_MODEL,
  fixedFeeUsd = PAYMENT_FEE_FIXED_USD_MODEL
): number {
  if (product === "topup") {
    return (TOP_UP.priceUsd * feeRate + fixedFeeUsd) / TOP_UP.tokens;
  }
  const plan = PLANS[product];
  if (interval === "year") {
    return (plan.annualPriceUsd * feeRate + fixedFeeUsd) / (plan.tokens * ANNUAL_MONTHS_GRANTED);
  }
  return (plan.priceUsd * feeRate + fixedFeeUsd) / plan.tokens;
}

/** Exact net revenue per token after allocated payment processor fees: `p - f`. */
export function netTokenRevenueUsd(
  product: PaidTier | "topup",
  interval: BillingInterval = "month",
  feeRate = PAYMENT_FEE_RATE_MODEL,
  fixedFeeUsd = PAYMENT_FEE_FIXED_USD_MODEL
): number {
  return grossTokenPriceUsd(product, interval) - allocatedOrderFeePerTokenUsd(product, interval, feeRate, fixedFeeUsd);
}

/**
 * Maximum variable fulfillment cost in USD that 1 token can support while maintaining `targetMargin` (default 30%)
 * contribution margin after payment fees: `b = (1 - targetMargin) * p - f`.
 * At Studio Annual (`tier = "business", interval = "year"`, 30% margin):
 *   0.70 * 0.06875 - 69.80 / 14400 = $0.0432777778 / token (~23.10655 tokens per $1.00 variable cost).
 */
export function costBudgetPerTokenUsd(
  targetMargin = TARGET_CONTRIBUTION_MARGIN,
  product: PaidTier | "topup" = "business",
  interval: BillingInterval = "year",
  feeRate = PAYMENT_FEE_RATE_MODEL,
  fixedFeeUsd = PAYMENT_FEE_FIXED_USD_MODEL
): number {
  const p = grossTokenPriceUsd(product, interval);
  const f = allocatedOrderFeePerTokenUsd(product, interval, feeRate, fixedFeeUsd);
  return (1 - targetMargin) * p - f;
}

/**
 * Contribution margin `(gross - fee - variableCost) / gross` when `tokensCharged` tokens are redeemed for work
 * costing `variableCostUsd`.
 */
export function contributionMarginForCost(
  tokensCharged: number,
  variableCostUsd: number,
  product: PaidTier | "topup" = "business",
  interval: BillingInterval = "year",
  feeRate = PAYMENT_FEE_RATE_MODEL,
  fixedFeeUsd = PAYMENT_FEE_FIXED_USD_MODEL
): number {
  const p = grossTokenPriceUsd(product, interval);
  const f = allocatedOrderFeePerTokenUsd(product, interval, feeRate, fixedFeeUsd);
  const gross = tokensCharged * p;
  if (gross <= 0) return 0;
  const fee = tokensCharged * f;
  return (gross - fee - variableCostUsd) / gross;
}

/**
 * Converts a variable fulfillment cost in USD into millitokens at the 30%-margin Studio Annual floor,
 * rounded upward to `stepMilli` precision (default 100 millitokens = 0.1 token).
 */
export function millitokensForVariableCost(
  variableCostUsd: number,
  options?: {
    targetMargin?: number;
    product?: PaidTier | "topup";
    interval?: BillingInterval;
    feeRate?: number;
    fixedFeeUsd?: number;
    stepMilli?: number;
  }
): number {
  if (variableCostUsd <= 0) return 0;
  const budget = costBudgetPerTokenUsd(
    options?.targetMargin ?? TARGET_CONTRIBUTION_MARGIN,
    options?.product ?? "business",
    options?.interval ?? "year",
    options?.feeRate ?? PAYMENT_FEE_RATE_MODEL,
    options?.fixedFeeUsd ?? PAYMENT_FEE_FIXED_USD_MODEL
  );
  const stepMilli = options?.stepMilli ?? 100;
  const rawMilli = (variableCostUsd / budget) * MILLITOKENS_PER_TOKEN;
  return Math.ceil((rawMilli - 1e-9) / stepMilli) * stepMilli;
}

export type StepTariffSchedule = {
  /** Effective date (UTC YYYY-MM-DD) of this provider rate schedule. */
  effectiveFrom: string;
  /** Step 1: Full script generation or full script rewrite (`gemini-4-argon`, covers post-Dec 1 2026 $4/$20 rate). */
  scriptWriteMillitokens: number;
  /** Step 1b: Single-beat rewrite or single-scene insertion (`gemini-4-argon`). */
  scriptEditBeatMillitokens: number;
  /** Step 2a: Storyboard beat-plan director (`gemini-3.8-flash` when LLM director runs; 0 when deterministic). */
  storyboardDirectorMillitokens: number;
  /** Step 2b: Reference SVG frame sketch (`gemini-3.8-flash`), per uncached frame. */
  frameSketchPerBeatMillitokens: number;
  /** Step 2c/3a: Voiceover synthesis (`gemini-3.8-flash-tts` + `voiceAlign`), per uncached voiced line. */
  voicePerLineMillitokens: number;
  /** Step 2d/3b: Background music bed (`lyria-3-clip-preview`, <=28s), per uncached track. */
  musicClipMillitokens: number;
  /** Step 2d/3b: Background music bed (`lyria-3-pro-preview`, >28s), per uncached track. */
  musicSongMillitokens: number;
  /**
   * Step 3c: Cold-cache setup fee per animation authoring batch in millitokens.
   * For Premium (`claude-opus-5-5`), the first scene writes ~71,993 shared prefix tokens at $5.00/1M vs $0.20/1M
   * cache read on follower scenes: a $0.3455664 cold-write delta. Charging 8,000 millitokens (8.0 tokens = $0.3462
   * cost budget at the Studio Annual floor) once per batch guarantees even a 1-scene cold job is never underfunded.
   */
  plateAnimationBatchSetupMillitokens: Record<AnimationTier, number>;
  /**
   * Step 3c: Per-scene plate authoring + bounded repair + worker clip fallback in millitokens, per unauthored scene.
   * - Standard (`gemini-3.8-flash`): 2,300 millitokens (2.3 tokens/scene in 2026; 4.5 tokens/scene from 2027-01-01)
   * - Premium (`claude-opus-5-5`): 9,700 millitokens (9.7 tokens/scene warm write + repair + worker allowance)
   */
  plateAnimationSceneMillitokens: Record<AnimationTier, number>;
  /**
   * Step 3e: Non-plate SVG `frame-motion` direction in millitokens, per uncached scene (0 for template-only films).
   */
  frameMotionSceneMillitokens: Record<AnimationTier, number>;
  /** Step 3f: Generated material markup (tokens per $0.10 nominal unit; 2.43 = 24.3 tokens per $1 provider list cost). */
  materialMarkupV2: number;
  /** Step 4: Final MP4 render export start fee in millitokens (worker boot/mux overhead after steps are paid). */
  renderExportStartMillitokens: number;
  /** Step 4: Final MP4 render export per-second fee in millitokens (frame capture/encode/storage). */
  renderExportPerSecondMillitokens: number;
  /** Comment-to-patch model translation (`elementEdits`) per model-translated comment (rule-based edits = 0). */
  elementEditModelMillitokens: number;
  /** Pro Editor AI source edit proposal (`proAssistant` + `skillRouting`). */
  proAssistMillitokens: number;
};

/** 2026 tariff schedule (incorporating Dec 1, 2026 `gemini-4-argon` $4/$20 rate and 2026 `gemini-3.8-flash` $0.75/$3.75 rate). */
export const STEP_TARIFFS_V2_2026: StepTariffSchedule = {
  effectiveFrom: "2026-11-09",
  scriptWriteMillitokens: 700,
  scriptEditBeatMillitokens: 300,
  storyboardDirectorMillitokens: 1000,
  frameSketchPerBeatMillitokens: 300,
  voicePerLineMillitokens: 100,
  musicClipMillitokens: 1000,
  musicSongMillitokens: 1900,
  plateAnimationBatchSetupMillitokens: { standard: 0, premium: 8000 },
  plateAnimationSceneMillitokens: { standard: 2300, premium: 9700 },
  frameMotionSceneMillitokens: { standard: 200, premium: 800 },
  materialMarkupV2: 2.43,
  renderExportStartMillitokens: 600,
  renderExportPerSecondMillitokens: 30,
  elementEditModelMillitokens: 300,
  proAssistMillitokens: 500
};

/** Scheduled Jan 1, 2027 tariff schedule when `gemini-3.8-flash` doubles from $0.75/$3.75 to $1.50/$7.50 per 1M tokens. */
export const STEP_TARIFFS_V2_2027: StepTariffSchedule = {
  ...STEP_TARIFFS_V2_2026,
  effectiveFrom: "2027-01-01",
  storyboardDirectorMillitokens: 2000,
  frameSketchPerBeatMillitokens: 600,
  plateAnimationSceneMillitokens: { standard: 4500, premium: 9700 },
  frameMotionSceneMillitokens: { standard: 300, premium: 800 }
};

export const STEP_TARIFF_SCHEDULES_V2: readonly StepTariffSchedule[] = [
  STEP_TARIFFS_V2_2026,
  STEP_TARIFFS_V2_2027
];

export function stepTariffsAt(now: Date = new Date()): StepTariffSchedule {
  const day = now.toISOString().slice(0, 10);
  let active = STEP_TARIFFS_V2_2026;
  for (const sched of STEP_TARIFF_SCHEDULES_V2) {
    if (day >= sched.effectiveFrom) active = sched;
  }
  return active;
}

/** Millitokens for `scenesToAuthor` unauthored code-drawn plate scenes in `v2_step_tier`. 0 when `scenesToAuthor <= 0`. */
export function plateAnimationCostMillitokensV2(
  scenesToAuthor: number,
  tier: AnimationTier = "standard",
  now: Date = new Date()
): number {
  const count = Math.max(0, Math.floor(scenesToAuthor));
  if (count === 0) return 0;
  const sched = stepTariffsAt(now);
  return sched.plateAnimationBatchSetupMillitokens[tier] + count * sched.plateAnimationSceneMillitokens[tier];
}

/** Millitokens for `scenesToAnimate` uncached SVG `frame-motion` scenes in `v2_step_tier`. 0 for template-only or cached scenes. */
export function frameMotionCostMillitokensV2(
  scenesToAnimate: number,
  tier: AnimationTier = "standard",
  now: Date = new Date()
): number {
  const count = Math.max(0, Math.floor(scenesToAnimate));
  if (count === 0) return 0;
  const sched = stepTariffsAt(now);
  return count * sched.frameMotionSceneMillitokens[tier];
}

/** Millitokens for final MP4 render export in `v2_step_tier` (remaining worker export work only; earlier steps paid separately). */
export function renderExportCostMillitokensV2(seconds: number, now: Date = new Date()): number {
  const sched = stepTariffsAt(now);
  return sched.renderExportStartMillitokens + Math.max(1, Math.ceil(seconds)) * sched.renderExportPerSecondMillitokens;
}

/** Millitokens for generated material (`usd` provider list price) in `v2_step_tier` at the 30% contribution margin floor. */
export function materialCostMillitokensV2(usd: number, now: Date = new Date()): number {
  if (usd <= 0) return 0;
  const sched = stepTariffsAt(now);
  return Math.ceil((usd * sched.materialMarkupV2 / TOKEN_USD) * MILLITOKENS_PER_TOKEN);
}

export type WholeFilmEstimateV2 = {
  tier: AnimationTier;
  scenes: number;
  durationSeconds: number;
  scriptTokens: number;
  storyboardPlanTokens: number;
  frameSketchTokens: number;
  storyboardTotalTokens: number;
  voiceTokens: number;
  musicTokens: number;
  audioTotalTokens: number;
  animationSetupTokens: number;
  animationSceneTokens: number;
  animationTotalTokens: number;
  renderExportTokens: number;
  totalTokens: number;
  totalMillitokens: number;
};

/**
 * Computes the complete step-by-step token table for a film of `scenes` beats and `durationSeconds` length in `v2_step_tier`.
 */
export function estimateWholeFilmQuoteV2(input: {
  scenes: number;
  durationSeconds: number;
  voicedScenes?: number;
  music?: boolean;
  isPlateStyle: boolean;
  isFrameMotionStyle?: boolean;
  includeDirectorPlan?: boolean;
  includeFrameSketches?: boolean;
  tier?: AnimationTier;
  now?: Date;
}): WholeFilmEstimateV2 {
  const now = input.now ?? new Date();
  const sched = stepTariffsAt(now);
  const tier: AnimationTier = input.tier ?? "standard";
  const scenes = Math.max(1, Math.floor(input.scenes));
  const durationSeconds = Math.max(1, Math.ceil(input.durationSeconds));
  const voicedScenes = input.voicedScenes !== undefined ? Math.max(0, Math.floor(input.voicedScenes)) : scenes;
  const hasMusic = input.music ?? true;
  const includeDirector = input.includeDirectorPlan ?? true;
  const includeSketches = input.includeFrameSketches ?? true;

  const scriptMilli = sched.scriptWriteMillitokens;
  const planMilli = includeDirector ? sched.storyboardDirectorMillitokens : 0;
  const sketchMilli = includeSketches ? scenes * sched.frameSketchPerBeatMillitokens : 0;
  const voiceMilli = voicedScenes * sched.voicePerLineMillitokens;
  const musicMilli = hasMusic
    ? (durationSeconds <= 28 ? sched.musicClipMillitokens : sched.musicSongMillitokens)
    : 0;

  let animSetupMilli = 0;
  let animScenesMilli = 0;
  if (input.isPlateStyle) {
    animSetupMilli = sched.plateAnimationBatchSetupMillitokens[tier];
    animScenesMilli = scenes * sched.plateAnimationSceneMillitokens[tier];
  } else if (input.isFrameMotionStyle) {
    animScenesMilli = scenes * sched.frameMotionSceneMillitokens[tier];
  }

  const renderMilli = renderExportCostMillitokensV2(durationSeconds, now);
  const totalMilli =
    scriptMilli + planMilli + sketchMilli + voiceMilli + musicMilli + animSetupMilli + animScenesMilli + renderMilli;

  return {
    tier,
    scenes,
    durationSeconds,
    scriptTokens: tokensFromMilli(scriptMilli),
    storyboardPlanTokens: tokensFromMilli(planMilli),
    frameSketchTokens: tokensFromMilli(sketchMilli),
    storyboardTotalTokens: tokensFromMilli(planMilli + sketchMilli),
    voiceTokens: tokensFromMilli(voiceMilli),
    musicTokens: tokensFromMilli(musicMilli),
    audioTotalTokens: tokensFromMilli(voiceMilli + musicMilli),
    animationSetupTokens: tokensFromMilli(animSetupMilli),
    animationSceneTokens: tokensFromMilli(animScenesMilli),
    animationTotalTokens: tokensFromMilli(animSetupMilli + animScenesMilli),
    renderExportTokens: tokensFromMilli(renderMilli),
    totalTokens: tokensFromMilli(totalMilli),
    totalMillitokens: totalMilli
  };
}
