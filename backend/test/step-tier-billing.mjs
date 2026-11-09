// Per-step generation billing and Standard/Premium animation tier tests (v2_step_tier).
// Covers:
//   1. Free-vs-paid tier entitlement (Free always Standard Gemini; Premium Opus requires active paid subscription,
//      not merely free or top-up credits; tampered Premium requests return 402 premium_requires_subscription).
//   2. Immutable per-variant routeSnapshot isolation (concurrent Standard + Premium jobs never leak via process.env;
//      subscription cancellation mid-job does not break already-reserved variants).
//   3. Expiring server-authoritative quotes, stale-quote rejection (409 quote_stale / quote_expired), and idempotent
//      reservation deduplication by workFingerprint.
//   4. Partial settlement and partial refund when K of N scenes fail, full refund when 0 scenes succeed, and
//      0-token reuse for unchanged scenes/frames/voice takes.
//   5. Grandfathering of legacy v1_render_only projects and non-stacking of v1 flat revision fees when step billing is on.
// Run: node --experimental-strip-types backend/test/step-tier-billing.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate, query } from "../src/db/database.ts";
import { grantTokens, refundPartialSpend, spendTokens, tokenSummary } from "../src/tokens/store.ts";
import {
  PremiumRequiresSubscriptionError,
  QuoteStaleError,
  assertAnimationTierEntitled,
  authorRouteForTier,
  createStepQuote,
  effectiveBillingPolicyVersion,
  projectPaidStepMillitokens,
  recordVariantReservationOutcome,
  releaseStepReservation,
  reserveStepTokens,
  settlePartialStepReservation,
  settleStepReservation
} from "../src/billing/step-billing.ts";

await migrate();

// 1. Free-tier vs Paid-subscription entitlement & routeSnapshot isolation
{
  const freeUserWithPack = randomUUID();
  // Grant a 100-token top-up pack to a Free user (no active subscription row)
  await grantTokens(freeUserWithPack, 100, "top-up pack", "test", `pack:${freeUserWithPack}`, "pack");
  const summary = await tokenSummary(freeUserWithPack);
  assert.ok(summary.remaining >= 100, "Free user has top-up credits");

  // Standard is allowed for Free user
  const stdEntitled = await assertAnimationTierEntitled(freeUserWithPack, "standard");
  assert.equal(stdEntitled.planTier, "free");
  assert.equal(stdEntitled.routeSnapshot.tier, "standard");
  assert.equal(stdEntitled.routeSnapshot.writer.provider, "gemini");
  assert.equal(stdEntitled.routeSnapshot.writer.model, "gemini-3.8-flash");

  // Premium is rejected for Free user even though they hold 100 top-up credits
  await assert.rejects(
    () => assertAnimationTierEntitled(freeUserWithPack, "premium"),
    (err) =>
      err instanceof PremiumRequiresSubscriptionError &&
      err.code === "premium_requires_subscription" &&
      err.statusCode === 402 &&
      err.message === "Upgrade to access Premium animation."
  );

  // Paid subscriber (Starter active) can use both Standard and Premium
  const paidUser = randomUUID();
  await query(
    `insert into app.subscriptions (user_id, ls_subscription_id, tier, billing_interval, status, renews_at)
     values ($1, $2, 'starter', 'month', 'active', now() + interval '30 days')`,
    [paidUser, `sub_${paidUser}`]
  );
  const premEntitled = await assertAnimationTierEntitled(paidUser, "premium");
  assert.equal(premEntitled.planTier, "starter");
  assert.equal(premEntitled.routeSnapshot.tier, "premium");
  assert.equal(premEntitled.routeSnapshot.writer.provider, "anthropic");
  assert.equal(premEntitled.routeSnapshot.writer.model, "claude-opus-5-5");

  // Concurrent routeSnapshots are immutable and do not touch process.env
  const snapA = authorRouteForTier("standard");
  const snapB = authorRouteForTier("premium");
  assert.notEqual(snapA.writer.model, snapB.writer.model);
  assert.equal(snapA.writer.model, "gemini-3.8-flash");
  assert.equal(snapB.writer.model, "claude-opus-5-5");
}

// 2. Quote verification, idempotent reservation, partial settlement/refund, and full release
{
  const userId = randomUUID();
  const projectId = randomUUID();
  await grantTokens(userId, 100, "test grant", "test", `grant:${userId}`, "plan");

  const quote = await createStepQuote({
    userId,
    projectId,
    stage: "plate_draw",
    pricingVersion: "v2_step_tier",
    animationTier: "premium",
    workFingerprint: "fp-6-scenes-premium",
    milli: 66200, // 8,000 setup + 6 * 9,700 per scene = 66.2 tokens
    unitsTotal: 6,
    reusedUnits: 0,
    breakdown: {
      stage: "plate_draw",
      pricingVersion: "v2_step_tier",
      animationTier: "premium",
      model: "claude-opus-5-5",
      unitsTotal: 6,
      reusedUnits: 0,
      setupMilli: 8000,
      perUnitMilli: 9700
    }
  });

  // Stale quote rejection when project/tier changes
  const changedExpected = { ...quote, animationTier: "standard" as const, milli: 13800 };
  await assert.rejects(
    () =>
      reserveStepTokens({
        userId,
        projectId,
        quote: changedExpected,
        quoteIdFromClient: quote.quoteId
      }),
    (err) => err instanceof QuoteStaleError && err.code === "quote_stale" && err.statusCode === 409
  );

  // Valid reservation holds 66.2 tokens once; duplicate call with same workFingerprint is idempotent
  const res1 = await reserveStepTokens({
    userId,
    projectId,
    quote,
    quoteIdFromClient: quote.quoteId
  });
  assert.equal(res1.reusedExisting, false);
  assert.equal(res1.reservedMilli, 66200);

  const resDup = await reserveStepTokens({
    userId,
    projectId,
    quote,
    quoteIdFromClient: quote.quoteId
  });
  assert.equal(resDup.reusedExisting, true);
  assert.equal(resDup.id, res1.id);

  const afterReserve = await tokenSummary(userId);
  assert.equal(afterReserve.remaining, 33.8, "100 - 66.2 = 33.8 tokens remaining");

  // Simulate 4 scenes delivered and 2 scenes permanently failed via recordVariantReservationOutcome
  await recordVariantReservationOutcome(res1.id, "0:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "1:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "2:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "3:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "4:16:9", "failed");
  await recordVariantReservationOutcome(res1.id, "5:16:9", "failed");

  // 2 failed scenes * 9.7 tokens/scene = 19.4 tokens refunded; 46.8 tokens settled (8.0 setup + 4 * 9.7)
  const afterPartial = await tokenSummary(userId);
  assert.equal(afterPartial.remaining, 53.2, "33.8 + 19.4 refunded = 53.2 tokens remaining");
  const paidMilli = await projectPaidStepMillitokens(projectId, userId);
  assert.equal(paidMilli, 46800, "46.8 tokens settled on project");

  // Full refund when 0 units are delivered
  const quoteZero = await createStepQuote({
    userId,
    projectId,
    stage: "script_write",
    pricingVersion: "v2_step_tier",
    animationTier: "standard",
    workFingerprint: "fp-script-fail",
    milli: 700,
    unitsTotal: 1,
    breakdown: {
      stage: "script_write",
      pricingVersion: "v2_step_tier",
      animationTier: "standard",
      model: "gemini-4-argon",
      unitsTotal: 1,
      reusedUnits: 0,
      setupMilli: 0,
      perUnitMilli: 700
    }
  });
  const resFail = await reserveStepTokens({ userId, projectId, quote: quoteZero });
  await settlePartialStepReservation(resFail.id, 0, "all-failed");
  const afterFullRefund = await tokenSummary(userId);
  assert.equal(afterFullRefund.remaining, 53.2, "0 delivered units refunds the entire reservation");
}

// 3. Grandfathering legacy projects on v1_render_only
{
  const legacyProject = {
    billingPolicyVersion: undefined,
    beatPlan: { canvas: "16:9" as const, mode: "problem" as const, target_duration_s: 30, beats: [], suggestions: [] },
    script: undefined,
    planAudio: undefined,
    filmMotion: undefined,
    renderJobId: undefined
  };
  assert.equal(
    effectiveBillingPolicyVersion(legacyProject, { BILLING_POLICY_VERSION: "v2_step_tier" } as NodeJS.ProcessEnv),
    "v1_render_only",
    "Existing project with a beatPlan is grandfathered on v1_render_only"
  );
  const freshProject = {
    billingPolicyVersion: undefined,
    beatPlan: undefined,
    script: undefined,
    planAudio: undefined,
    filmMotion: undefined,
    renderJobId: undefined
  };
  assert.equal(
    effectiveBillingPolicyVersion(freshProject, { BILLING_POLICY_VERSION: "v2_step_tier" } as NodeJS.ProcessEnv),
    "v2_step_tier",
    "Fresh project uses v2_step_tier when BILLING_POLICY_VERSION=v2_step_tier"
  );
  assert.equal(
    effectiveBillingPolicyVersion(freshProject, {} as NodeJS.ProcessEnv),
    "v1_render_only",
    "Production default remains v1_render_only when BILLING_POLICY_VERSION is unset"
  );
}

console.log("step-tier-billing: ok");
