// Pricing lock (2026-10-28). Pins the prices, allowances and film burn, and checks the margin each plan keeps against the
// measured cost of a film (docs/PRICING.md, "What a film costs us"). Changing a number here means changing the document too.
// Run: node backend/test/pricing-lock.mjs   (no database)
import assert from "node:assert/strict";
const {
  FREE_REVISIONS,
  REVISION_TOKENS,
  PREVIEW_ALLOWANCE,
  PREVIEW_CALL_CAP,
  PLANS,
  TOP_UP,
  START_FEE_MILLITOKENS,
  MILLITOKENS_PER_SECOND,
  TOKEN_USD,
  MATERIAL_MARKUP,
  ANNUAL_MONTHS_CHARGED,
  ANNUAL_MONTHS_GRANTED,
  ANIMATION_TIERS,
  BILLING_POLICY_VERSIONS,
  PREMIUM_LOCKED_COPY,
  TARGET_CONTRIBUTION_MARGIN,
  STEP_TARIFFS_V2_2026,
  STEP_TARIFFS_V2_2027,
  canUseAnimationTier,
  grossTokenPriceUsd,
  allocatedOrderFeePerTokenUsd,
  netTokenRevenueUsd,
  costBudgetPerTokenUsd,
  contributionMarginForCost,
  millitokensForVariableCost,
  plateAnimationCostMillitokensV2,
  frameMotionCostMillitokensV2,
  renderExportCostMillitokensV2,
  materialCostMillitokensV2,
  estimateWholeFilmQuoteV2,
  annualMonthlyUsd,
  annualSavingsUsd,
  annualSavingsPercent,
  tokenPriceUsd,
  renderCostMillitokens,
  filmsFromTokens,
  materialCostMillitokens
} = await import("@videosaas/contracts");

// ---- the locked numbers ----
assert.equal(TOKEN_USD, 0.1);
assert.equal(START_FEE_MILLITOKENS, 6000, "a film costs 6 tokens to start");
assert.equal(MILLITOKENS_PER_SECOND, 300, "and 0.3 token per finished second");
assert.equal(MATERIAL_MARKUP, 3, "generated material is sold at 3x the provider cost");
assert.equal(ANNUAL_MONTHS_CHARGED, 10, "annual billing pays for 10 months");
assert.equal(ANNUAL_MONTHS_GRANTED, 12, "and grants 12 monthly token allowances");
assert.deepEqual(Object.fromEntries(Object.entries(PLANS).map(([tier, plan]) => [tier, [plan.priceUsd, plan.annualPriceUsd, plan.tokens, plan.watermark, plan.proEditor]])), {
  free: [0, 0, 33, true, false],
  starter: [19, 190, 200, false, false],
  pro: [49, 490, 550, false, true],
  business: [99, 990, 1200, false, true]
});
assert.deepEqual({
  starter: { monthly: annualMonthlyUsd("starter"), save: annualSavingsUsd("starter"), pct: annualSavingsPercent("starter"), tokenMonth: tokenPriceUsd("starter", "month"), tokenYear: tokenPriceUsd("starter", "year") },
  pro: { monthly: annualMonthlyUsd("pro"), save: annualSavingsUsd("pro"), pct: annualSavingsPercent("pro"), tokenMonth: tokenPriceUsd("pro", "month"), tokenYear: tokenPriceUsd("pro", "year") },
  business: { monthly: annualMonthlyUsd("business"), save: annualSavingsUsd("business"), pct: annualSavingsPercent("business"), tokenMonth: tokenPriceUsd("business", "month"), tokenYear: tokenPriceUsd("business", "year") }
}, {
  starter: { monthly: 15.83, save: 38, pct: 17, tokenMonth: 0.095, tokenYear: 0.079 },
  pro: { monthly: 40.83, save: 98, pct: 17, tokenMonth: 0.089, tokenYear: 0.074 },
  business: { monthly: 82.5, save: 198, pct: 17, tokenMonth: 0.083, tokenYear: 0.069 }
});
for (const tier of ["free", "starter", "pro", "business"]) {
  assert.ok(!PLANS[tier].features.some((f) => /pro editor/i.test(f)), `${tier} card features must not advertise Pro editor while it is coming soon`);
}
assert.deepEqual(Object.fromEntries(Object.entries(PLANS).map(([tier, plan]) => [tier, plan.name])), { free: "Free", starter: "Starter", pro: "Pro", business: "Studio" }, "the internal id of the top plan stays business; it is shown as Studio");
assert.deepEqual({ ...TOP_UP }, { priceUsd: 12, tokens: 100 });
assert.equal(renderCostMillitokens(15), 10500);
assert.equal(renderCostMillitokens(30), 15000);
assert.equal(renderCostMillitokens(60), 24000);
assert.equal(renderCostMillitokens(0.2), 6300, "a started second counts whole");
assert.equal(filmsFromTokens(PLANS.free.tokens, 90), 1, "Free makes one film of up to 90 s");
assert.equal(filmsFromTokens(PLANS.free.tokens, 91), 0);
assert.equal(materialCostMillitokens(1), 30000, "$1 of generation costs 30 tokens");
assert.equal(materialCostMillitokens(0.94), 28200, "one generated scene ($0.07 style key + $0.07 keyframe + $0.80 clip) is 28.2 tokens");
// Margin on generated material: 3x the provider cost, after the payment fee at each plan's token rate.
for (const tier of ["starter", "pro", "business"]) { const perToken = (PLANS[tier].priceUsd * 0.93 - 0.5) / PLANS[tier].tokens; const margin = 1 - 1 / (3 * (1 / 0.1) * perToken); assert.ok(margin >= 0.5, `${tier} keeps ${(margin * 100).toFixed(0)}% on generated material; the floor is 50%`); }

assert.deepEqual({ ...PREVIEW_ALLOWANCE }, { free: 3, starter: 15, pro: 45, business: 100 }, "films a person may work on per period");
assert.equal(PREVIEW_CALL_CAP, 150);
assert.equal(FREE_REVISIONS, 3, "the start fee covers three changes to a film");
assert.equal(REVISION_TOKENS, 2, "each further change takes two tokens");

// ---- the margin each plan keeps, from measured cost ----
// Cost of one film (USD), measured 2026-10-28 on the Binary Search template (66.5 s, 9 beats), Claude at Sonnet 4.6 prices:
// fixed = director $0.208 + worker start/idle about $0.02; per second = (script+frames $0.304 + motion $0.239) / 9 beats / 7.4 s per beat
// + voice + render; x1.0 (retries are in the revision allowance). Revisions = one recreate $0.14 + two applied fixes $0.18.
const FIXED = 0.23, PER_SECOND = 0.009, REVISIONS = 0.32;
const cost = (seconds, revised) => FIXED + PER_SECOND * seconds + (revised ? REVISIONS : 0);
// Net revenue per token on a plan: the price after Lemon Squeezy's 7% + $0.50 per order, over the tokens granted.
const netPerToken = (plan) => (plan.priceUsd * 0.93 - 0.5) / plan.tokens;
for (const tier of ["starter", "pro", "business"]) {
  for (const seconds of [15, 30, 45, 60, 90]) {
    const revenue = (renderCostMillitokens(seconds) / 1000) * netPerToken(PLANS[tier]);
    const clean = 1 - cost(seconds, false) / revenue;
    const revised = 1 - cost(seconds, true) / revenue;
    assert.ok(clean >= 0.5, `${tier} ${seconds} s keeps ${(clean * 100).toFixed(0)}% with no revisions; the floor is 50%`);
    if (seconds >= 45) assert.ok(revised >= 0.35, `${tier} ${seconds} s keeps ${(revised * 100).toFixed(0)}% with typical revisions; the floor is 35%`);
    assert.ok(revised > 0, `${tier} ${seconds} s must never lose money, revisions included`);
  }
}
// Annual billing (2 months free: ten monthly prices, one payment fee a year) keeps the plan's monthly token grant, so it earns less per token.
for (const tier of ["starter", "pro", "business"]) {
  const perToken = ((PLANS[tier].priceUsd * 10 * 0.93 - 0.5) / 12) / PLANS[tier].tokens;
  for (const seconds of [30, 45, 60, 90]) {
    const revenue = (renderCostMillitokens(seconds) / 1000) * perToken;
    assert.ok(1 - cost(seconds, false) / revenue >= 0.45, `${tier} annual ${seconds} s keeps ${((1 - cost(seconds, false) / revenue) * 100).toFixed(0)}% with no revisions; the floor is 45%`);
    if (seconds >= 60) assert.ok(1 - cost(seconds, true) / revenue >= 0.28, `${tier} annual ${seconds} s keeps ${((1 - cost(seconds, true) / revenue) * 100).toFixed(0)}% with revisions; the floor is 28%`);
  }
}
// Not greedy: no plan keeps more than about two thirds, and a pack costs more per token than any plan.
for (const tier of ["starter", "pro", "business"]) assert.ok(1 - cost(60, false) / ((renderCostMillitokens(60) / 1000) * netPerToken(PLANS[tier])) <= 0.67);
assert.ok(TOP_UP.priceUsd / TOP_UP.tokens > PLANS.starter.priceUsd / PLANS.starter.tokens, "packs are dearer per token than the cheapest-to-leave plan");
// Free costs us about a dollar: one film of at most 90 s.
assert.ok(cost(90, false) <= 1.1, "a free signup that makes its one film costs us about a dollar");
// Previews are not paid by tokens until a film is rendered, so the allowances are sized to the worst case: a person who uses every
// preview and also renders every film their tokens allow (60 s films, $0.02 of render each) must still cost us less than the plan
// brings in after the payment fee. A preview is $0.79 (measured). Free: the most a signup can cost before it pays anything.
const PREVIEW_COST = 0.79, RENDER_ONLY = 0.02;
for (const tier of ["starter", "pro", "business"]) {
  const worst = PREVIEW_ALLOWANCE[tier] * PREVIEW_COST + Math.floor(PLANS[tier].tokens / 24) * RENDER_ONLY;
  const net = PLANS[tier].priceUsd * 0.93 - 0.5;
  assert.ok(worst < net, `${tier}: ${PREVIEW_ALLOWANCE[tier]} previews and every film rendered cost $${worst.toFixed(2)}, more than the $${net.toFixed(2)} the plan brings in`);
}
assert.ok(PREVIEW_ALLOWANCE.free * PREVIEW_COST < 3, "a Free signup that only previews costs us under $3");
// A paid revision must cover what it costs us (measured 2026-10-28: a recreate $0.14, an applied fix $0.09) on every plan.
for (const tier of ["starter", "pro", "business"]) assert.ok(REVISION_TOKENS * ((PLANS[tier].priceUsd * 0.93 - 0.5) / PLANS[tier].tokens) > 0.14, `${tier}: ${REVISION_TOKENS} tokens must pay for a $0.14 recreate`);

// ---- v2_step_tier per-step generation billing and Standard/Premium animation tiers (2026-11-09) ----
assert.deepEqual([...BILLING_POLICY_VERSIONS], ["v1_render_only", "v2_step_tier"]);
assert.deepEqual([...ANIMATION_TIERS], ["standard", "premium"]);
assert.equal(PREMIUM_LOCKED_COPY, "Upgrade to access Premium animation.");
assert.equal(TARGET_CONTRIBUTION_MARGIN, 0.3);

// Free-tier entitlement: Free always uses Standard (Gemini 3.8 Flash); Premium (Claude Opus 5.5) requires an active paid subscription
assert.equal(canUseAnimationTier("free", "standard"), true);
assert.equal(canUseAnimationTier("free", "premium"), false, "Free users cannot use Premium animation");
for (const paidTier of ["starter", "pro", "business"]) {
  assert.equal(canUseAnimationTier(paidTier, "standard"), true);
  assert.equal(canUseAnimationTier(paidTier, "premium"), true);
}

// Exact unrounded token economics across all monthly, annual, and topup plans after 7% + $0.50 fee
assert.equal(grossTokenPriceUsd("starter", "month"), 19 / 200);
assert.equal(grossTokenPriceUsd("starter", "year"), 190 / 2400);
assert.equal(grossTokenPriceUsd("pro", "month"), 49 / 550);
assert.equal(grossTokenPriceUsd("pro", "year"), 490 / 6600);
assert.equal(grossTokenPriceUsd("business", "month"), 99 / 1200);
assert.equal(grossTokenPriceUsd("business", "year"), 990 / 14400);
assert.equal(grossTokenPriceUsd("topup", "month"), 12 / 100);

assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("starter", "month") - 1.83 / 200) < 1e-12);
assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("starter", "year") - 13.8 / 2400) < 1e-12);
assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("pro", "month") - 3.93 / 550) < 1e-12);
assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("pro", "year") - 34.8 / 6600) < 1e-12);
assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("business", "month") - 7.43 / 1200) < 1e-12);
assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("business", "year") - 69.8 / 14400) < 1e-12);
assert.ok(Math.abs(allocatedOrderFeePerTokenUsd("topup", "month") - 1.34 / 100) < 1e-12);

assert.ok(Math.abs(netTokenRevenueUsd("business", "year") - 920.2 / 14400) < 1e-12);
assert.ok(Math.abs(costBudgetPerTokenUsd(0.3, "business", "year") - 623.2 / 14400) < 1e-12);
assert.ok(Math.abs(1 / costBudgetPerTokenUsd(0.3, "business", "year") - 14400 / 623.2) < 1e-9);
assert.equal(millitokensForVariableCost(0.0288), 700);

// Verify 2026 step tariff schedule and 30% contribution margin on every measured/modeled step at Studio Annual floor
assert.equal(STEP_TARIFFS_V2_2026.scriptWriteMillitokens, 700);
assert.equal(STEP_TARIFFS_V2_2026.scriptEditBeatMillitokens, 300);
assert.equal(STEP_TARIFFS_V2_2026.storyboardDirectorMillitokens, 1000);
assert.equal(STEP_TARIFFS_V2_2026.frameSketchPerBeatMillitokens, 300);
assert.equal(STEP_TARIFFS_V2_2026.voicePerLineMillitokens, 100);
assert.equal(STEP_TARIFFS_V2_2026.musicClipMillitokens, 1000);
assert.equal(STEP_TARIFFS_V2_2026.musicSongMillitokens, 1900);
assert.deepEqual(STEP_TARIFFS_V2_2026.plateAnimationBatchSetupMillitokens, { standard: 0, premium: 8000 });
assert.deepEqual(STEP_TARIFFS_V2_2026.plateAnimationSceneMillitokens, { standard: 2300, premium: 9700 });
assert.deepEqual(STEP_TARIFFS_V2_2026.frameMotionSceneMillitokens, { standard: 200, premium: 800 });
assert.equal(STEP_TARIFFS_V2_2026.materialMarkupV2, 2.43);
assert.equal(STEP_TARIFFS_V2_2026.renderExportStartMillitokens, 600);
assert.equal(STEP_TARIFFS_V2_2026.renderExportPerSecondMillitokens, 30);
assert.equal(STEP_TARIFFS_V2_2026.elementEditModelMillitokens, 300);
assert.equal(STEP_TARIFFS_V2_2026.proAssistMillitokens, 500);

// Cold 1-scene Premium Opus job must cover the $0.3455664 cold-write delta + $0.41914 warm scene cost = $0.7647 at >=30% margin
const oneScenePremiumTokens = plateAnimationCostMillitokensV2(1, "premium", new Date("2026-11-09T00:00:00Z")) / 1000;
assert.equal(oneScenePremiumTokens, 17.7, "1 cold Premium scene charges 8.0 setup + 9.7 scene = 17.7 tokens");
assert.ok(
  contributionMarginForCost(oneScenePremiumTokens, 0.3455664 + 0.41914, "business", "year") >= 0.3,
  "1 cold Premium scene maintains >=30% contribution margin on Studio Annual"
);

// 9-scene 66s whole-film estimates across all 4 engine/tier combinations (no whole-token rounding)
const hfStd9 = estimateWholeFilmQuoteV2({
  scenes: 9,
  durationSeconds: 66,
  voicedScenes: 9,
  music: true,
  isPlateStyle: false,
  isFrameMotionStyle: true,
  tier: "standard",
  now: new Date("2026-11-10T00:00:00Z")
});
assert.equal(hfStd9.renderExportTokens, 2.58);
assert.equal(hfStd9.totalTokens, 11.58);
assert.equal(hfStd9.totalMillitokens, 11580);

const hfPrem9 = estimateWholeFilmQuoteV2({
  scenes: 9,
  durationSeconds: 66,
  voicedScenes: 9,
  music: true,
  isPlateStyle: false,
  isFrameMotionStyle: true,
  tier: "premium",
  now: new Date("2026-11-10T00:00:00Z")
});
assert.equal(hfPrem9.animationTotalTokens, 7.2);
assert.equal(hfPrem9.totalTokens, 16.98);
assert.equal(hfPrem9.totalMillitokens, 16980);

const plateStd9 = estimateWholeFilmQuoteV2({
  scenes: 9,
  durationSeconds: 66,
  voicedScenes: 9,
  music: true,
  isPlateStyle: true,
  tier: "standard",
  now: new Date("2026-11-10T00:00:00Z")
});
assert.equal(plateStd9.animationTotalTokens, 20.7);
assert.equal(plateStd9.totalTokens, 30.48);
assert.equal(plateStd9.totalMillitokens, 30480);

const platePrem9 = estimateWholeFilmQuoteV2({
  scenes: 9,
  durationSeconds: 66,
  voicedScenes: 9,
  music: true,
  isPlateStyle: true,
  tier: "premium",
  now: new Date("2026-11-10T00:00:00Z")
});
assert.equal(platePrem9.animationSetupTokens, 8);
assert.equal(platePrem9.animationSceneTokens, 87.3);
assert.equal(platePrem9.animationTotalTokens, 95.3);
assert.equal(platePrem9.totalTokens, 105.08);
assert.equal(platePrem9.totalMillitokens, 105080);

// 6-scene 30s plate film estimates (2026 schedule)
const std6 = estimateWholeFilmQuoteV2({
  scenes: 6,
  durationSeconds: 30,
  voicedScenes: 6,
  music: true,
  isPlateStyle: true,
  tier: "standard",
  now: new Date("2026-11-09T00:00:00Z")
});
assert.equal(std6.totalTokens, 21.3);

const prem6 = estimateWholeFilmQuoteV2({
  scenes: 6,
  durationSeconds: 30,
  voicedScenes: 6,
  music: true,
  isPlateStyle: true,
  tier: "premium",
  now: new Date("2026-11-09T00:00:00Z")
});
assert.equal(prem6.animationSetupTokens, 8);
assert.equal(prem6.animationSceneTokens, 58.2);
assert.equal(prem6.totalTokens, 73.7);

// 2027-01-01 scheduled Gemini 3.8 Flash rate doubling
assert.equal(STEP_TARIFFS_V2_2027.plateAnimationSceneMillitokens.standard, 4500);
assert.equal(plateAnimationCostMillitokensV2(6, "standard", new Date("2027-01-15T00:00:00Z")), 27000);
assert.equal(frameMotionCostMillitokensV2(6, "standard", new Date("2026-11-09T00:00:00Z")), 1200);
assert.equal(renderExportCostMillitokensV2(30, new Date("2026-11-09T00:00:00Z")), 1500);
assert.equal(materialCostMillitokensV2(1, new Date("2026-11-09T00:00:00Z")), 24300);

console.log("pricing lock: ok");
