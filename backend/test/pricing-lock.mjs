// Pricing lock (2026-10-28). Pins the prices, allowances and film burn, and checks the margin each plan keeps against the
// measured cost of a film (docs/PRICING.md, "What a film costs us"). Changing a number here means changing the document too.
// Run: node backend/test/pricing-lock.mjs   (no database)
import assert from "node:assert/strict";
const { PLANS, TOP_UP, START_FEE_MILLITOKENS, MILLITOKENS_PER_SECOND, TOKEN_USD, MATERIAL_MARKUP, renderCostMillitokens, filmsFromTokens, materialCostMillitokens } = await import("@videosaas/contracts");

// ---- the locked numbers ----
assert.equal(TOKEN_USD, 0.1);
assert.equal(START_FEE_MILLITOKENS, 6000, "a film costs 6 tokens to start");
assert.equal(MILLITOKENS_PER_SECOND, 300, "and 0.3 token per finished second");
assert.equal(MATERIAL_MARKUP, 4);
assert.deepEqual(Object.fromEntries(Object.entries(PLANS).map(([tier, plan]) => [tier, [plan.priceUsd, plan.tokens, plan.watermark, plan.proEditor]])), {
  free: [0, 11, true, false],
  starter: [19, 200, false, false],
  pro: [49, 550, false, true],
  business: [149, 1800, false, true]
});
assert.deepEqual({ ...TOP_UP }, { priceUsd: 12, tokens: 100 });
assert.equal(renderCostMillitokens(15), 10500);
assert.equal(renderCostMillitokens(30), 15000);
assert.equal(renderCostMillitokens(60), 24000);
assert.equal(renderCostMillitokens(0.2), 6300, "a started second counts whole");
assert.equal(filmsFromTokens(PLANS.free.tokens, 16), 1, "Free makes one film of up to 16 s");
assert.equal(filmsFromTokens(PLANS.free.tokens, 17), 0);
assert.equal(materialCostMillitokens(0.667), Math.ceil((0.667 * 4 / 0.1) * 1000), "generated material is sold at 4x provider cost");

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
// Not greedy: no plan keeps more than about two thirds, and a pack costs more per token than any plan.
for (const tier of ["starter", "pro", "business"]) assert.ok(1 - cost(60, false) / ((renderCostMillitokens(60) / 1000) * netPerToken(PLANS[tier])) <= 0.67);
assert.ok(TOP_UP.priceUsd / TOP_UP.tokens > PLANS.starter.priceUsd / PLANS.starter.tokens, "packs are dearer per token than the cheapest-to-leave plan");
// Free costs us less than a dollar: one film of at most 16 s.
assert.ok(cost(16, false) < 0.5, "a free signup that makes its one film costs us under 50 cents");
console.log("pricing lock: ok");
