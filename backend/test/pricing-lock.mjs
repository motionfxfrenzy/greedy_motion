// Pricing lock (2026-10-28). Pins the prices, allowances and film burn, and checks the margin each plan keeps against the
// measured cost of a film (docs/PRICING.md, "What a film costs us"). Changing a number here means changing the document too.
// Run: node backend/test/pricing-lock.mjs   (no database)
import assert from "node:assert/strict";
const { paintedCostMillitokens, FREE_REVISIONS, REVISION_TOKENS, PREVIEW_ALLOWANCE, PREVIEW_CALL_CAP, PLANS, TOP_UP, START_FEE_MILLITOKENS, MILLITOKENS_PER_SECOND, TOKEN_USD, MATERIAL_MARKUP, ANNUAL_MONTHS_CHARGED, ANNUAL_MONTHS_GRANTED, annualMonthlyUsd, annualSavingsUsd, annualSavingsPercent, tokenPriceUsd, renderCostMillitokens, filmsFromTokens, materialCostMillitokens } = await import("@videosaas/contracts");

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
// Painted (GPU) films: 6 tokens + 0.7 a second. Cost cases per docs/PRICING.md (voice and music included, GPU time for the whole job):
// low = Gemini brain on a warm GPU $0.94 at 60 s, mid = Claude brain with a cold on-demand start $1.98, with a $0.25 fixed part.
assert.equal(paintedCostMillitokens(60), 48000, "a 60 s painted film is 48 tokens");
assert.equal(paintedCostMillitokens(80), 62000);
assert.equal(paintedCostMillitokens(30), 27000);
const painted = (seconds, at60) => 0.25 + ((at60 - 0.25) / 60) * seconds;
for (const tier of ["starter", "pro", "business"]) {
  for (const seconds of [30, 60, 90]) {
    const revenue = (paintedCostMillitokens(seconds) / 1000) * netPerToken(PLANS[tier]);
    assert.ok(1 - painted(seconds, 0.94) / revenue >= 0.7, `${tier} painted ${seconds} s keeps ${((1 - painted(seconds, 0.94) / revenue) * 100).toFixed(0)}% on the default (Gemini) brain; the floor is 70%`);
    assert.ok(1 - painted(seconds, 1.98) / revenue >= 0.45, `${tier} painted ${seconds} s keeps ${((1 - painted(seconds, 1.98) / revenue) * 100).toFixed(0)}% on the Claude brain with a cold start; the floor is 45%`);
  }
}
console.log("pricing lock: ok");
