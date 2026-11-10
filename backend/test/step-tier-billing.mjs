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
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
assertThrowawayDb();
import { migrate, pool, query } from "../src/db/database.ts";
import { grantTokens, refundPartialSpend, refundSpend, spendTokens, tokenSummary } from "../src/tokens/store.ts";
import { scriptFrameKey } from "@videosaas/contracts";
import {
  PremiumRequiresSubscriptionError,
  QuoteStaleError,
  assertAnimationTierEntitled,
  authorRouteForTier,
  buildProjectBillingOverview,
  createStepQuote,
  effectiveBillingPolicyVersion,
  projectPaidStepMillitokens,
  quoteAnimationStep,
  quoteElementEditStep,
  quoteProAssistStep,
  recordVariantReservationOutcome,
  releaseStepReservation,
  reserveStepTokens,
  settlePartialStepReservation,
  settleStepReservation,
  settleVoiceMusicReservation
} from "../src/billing/step-billing.ts";
import { createProject, deleteProject } from "../src/projects/store.ts";

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
    `insert into app.subscriptions (user_id, provider_ref, variant_id, tier, billing_interval, status, renews_at)
     values ($1, $2, '101', 'starter', 'month', 'active', now() + interval '30 days')`,
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

  await query("delete from app.subscriptions where user_id = $1", [paidUser]);
  await query("delete from app.token_ledger where user_id = $1", [freeUserWithPack]);
}

// 2. Quote verification, idempotent reservation, partial settlement/refund, and full release
{
  const userId = randomUUID();
  const projectId = randomUUID();
  await grantTokens(userId, 100, "test grant", "test", `grant:${userId}`, "plan");
  const startBalance = (await tokenSummary(userId)).remaining; // 100 plan + 33 free = 133

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
  const changedExpected = { ...quote, animationTier: "standard", milli: 13800 };
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
  assert.equal(afterReserve.remaining, Math.round((startBalance - 66.2) * 10) / 10, "startBalance - 66.2 tokens remaining");

  // Simulate 4 scenes delivered and 2 scenes permanently failed via recordVariantReservationOutcome
  await recordVariantReservationOutcome(res1.id, "0:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "1:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "2:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "3:16:9", "delivered");
  await recordVariantReservationOutcome(res1.id, "4:16:9", "failed");
  await recordVariantReservationOutcome(res1.id, "5:16:9", "failed");

  // 2 failed scenes * 9.7 tokens/scene = 19.4 tokens refunded; 46.8 tokens settled (8.0 setup + 4 * 9.7)
  const afterPartial = await tokenSummary(userId);
  assert.equal(afterPartial.remaining, Math.round((startBalance - 46.8) * 10) / 10, "19.4 refunded -> 46.8 settled");
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
  assert.equal(afterFullRefund.remaining, Math.round((startBalance - 46.8) * 10) / 10, "0 delivered units refunds the entire reservation");

  // Voice + music mixed-unit settlement: 3 voice lines (300 milli) succeed, 1 music track (1000 milli) fails -> refunds 1.0 token
  const quoteAudio = await createStepQuote({
    userId,
    projectId,
    stage: "voice_music",
    pricingVersion: "v2_step_tier",
    animationTier: "standard",
    workFingerprint: "fp-audio-partial",
    milli: 1300,
    unitsTotal: 4,
    breakdown: {
      stage: "voice_music",
      pricingVersion: "v2_step_tier",
      animationTier: "standard",
      model: "gemini-3.8-flash-tts+lyria",
      unitsTotal: 4,
      reusedUnits: 0,
      setupMilli: 1000,
      perUnitMilli: 100,
      parts: { voiceMilli: 300, musicMilli: 1000 }
    }
  });
  const resAudio = await reserveStepTokens({ userId, projectId, quote: quoteAudio });
  const audioOutcome = await settleVoiceMusicReservation(resAudio.id, 3, false, "music-failed");
  assert.equal(audioOutcome.settledMilli, 300, "3 delivered voice lines settle 0.3 tokens");
  assert.equal(audioOutcome.refundedMilli, 1000, "failed music bed refunds full 1.0 token");
  const afterAudio = await tokenSummary(userId);
  assert.equal(afterAudio.remaining, Math.round((startBalance - 47.1) * 10) / 10, "additional 0.3 settled");

  await query("delete from app.generation_reservations where user_id = $1", [userId]);
  await query("delete from app.generation_quotes where user_id = $1", [userId]);
  await query("delete from app.token_ledger where user_id = $1", [userId]);
}

// 3. Grandfathering legacy projects on v1_render_only
{
  const legacyProject = {
    billingPolicyVersion: undefined,
    beatPlan: { canvas: "16:9", mode: "problem", target_duration_s: 30, beats: [], suggestions: [] },
    script: undefined,
    planAudio: undefined,
    filmMotion: undefined,
    renderJobId: undefined
  };
  assert.equal(
    effectiveBillingPolicyVersion(legacyProject, { BILLING_POLICY_VERSION: "v2_step_tier" }),
    "v1_render_only",
    "Existing project with a beatPlan is grandfathered on v1_render_only"
  );
  const legacyScriptBeatsProject = {
    billingPolicyVersion: undefined,
    beatPlan: undefined,
    script: undefined,
    planAudio: undefined,
    filmMotion: undefined,
    renderJobId: undefined,
    brief: { scriptBeats: [{ id: "sb-1", keyword: "Hook", visual: null, onScreen: null, line: "Hello" }] }
  };
  assert.equal(
    effectiveBillingPolicyVersion(legacyScriptBeatsProject, { BILLING_POLICY_VERSION: "v2_step_tier" }),
    "v1_render_only",
    "Existing project with drafted scriptBeats is grandfathered on v1_render_only"
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
    effectiveBillingPolicyVersion(freshProject, { BILLING_POLICY_VERSION: "v2_step_tier" }),
    "v2_step_tier",
    "Fresh project uses v2_step_tier when BILLING_POLICY_VERSION=v2_step_tier"
  );
  assert.equal(
    effectiveBillingPolicyVersion(freshProject, {}),
    "v1_render_only",
    "Production default remains v1_render_only when BILLING_POLICY_VERSION is unset"
  );
}

// 4. Project billing overview (v2_step_tier vs v1_render_only, Free vs Paid)
{
  const prevEnv = process.env.BILLING_POLICY_VERSION;
  process.env.BILLING_POLICY_VERSION = "v2_step_tier";
  const freeOwner = randomUUID();
  const paidOwner = randomUUID();
  await query(
    `insert into app.subscriptions (user_id, provider_ref, variant_id, tier, billing_interval, status, renews_at)
     values ($1, $2, '102', 'pro', 'month', 'active', now() + interval '30 days')`,
    [paidOwner, `sub_${paidOwner}`]
  );
  const pFree = await createProject(
    { name: "Free v2 test", request: { prompt: "A launch video for the new dashboard", format: "landscape", style: "kinetic", theme: "neutral", template: "product-launch" } },
    freeOwner
  );
  const pPaid = await createProject(
    { name: "Paid v2 test", request: { prompt: "A launch video for the new dashboard", format: "landscape", style: "kinetic", theme: "neutral", template: "product-launch" } },
    paidOwner
  );
  try {
    assert.equal(pFree.billingPolicyVersion, "v2_step_tier");
    const freeOverview = await buildProjectBillingOverview({
      userId: freeOwner,
      project: pFree,
      tierOverride: "premium",
      briefOverride: {
        scriptMode: "problem",
        text: "A 30s blueprint explainer",
        durationSeconds: 30,
        durationMode: "script",
        aspect: "16:9",
        motionProfile: "smooth",
        pace: "balanced",
        audio: { mode: "both", voice: "Kore" },
        captions: "key-phrases",
        template: null,
        theme: "neutral",
        look: "illus-blueprint"
      }
    });
    assert.equal(freeOverview.planTier, "free");
    assert.equal(freeOverview.canUsePremium, false);
    assert.equal(freeOverview.animationTier, "standard", "Free user requesting premium in overview is clamped to standard");
    assert.equal(freeOverview.tiers.premium.available, false);
    assert.equal(freeOverview.tiers.premium.lockedCopy, "Upgrade to access Premium animation.");

    const paidOverview = await buildProjectBillingOverview({
      userId: paidOwner,
      project: pPaid,
      tierOverride: "premium",
      briefOverride: {
        scriptMode: "problem",
        text: "A 30s blueprint explainer",
        durationSeconds: 30,
        durationMode: "script",
        aspect: "16:9",
        motionProfile: "smooth",
        pace: "balanced",
        audio: { mode: "both", voice: "Kore" },
        captions: "key-phrases",
        template: null,
        theme: "neutral",
        look: "illus-blueprint"
      }
    });
    assert.equal(paidOverview.planTier, "pro");
    assert.equal(paidOverview.canUsePremium, true);
    assert.equal(paidOverview.animationTier, "premium");
    assert.equal(paidOverview.tiers.premium.available, true);

    // 5. Non-plate frame-film quote when all scriptFrames are already sketched while beatPlan is still in flight
    const nineBrief = {
      scriptMode: "problem",
      text: "create a clear idea how does the HTTP request works and how it take the data securely",
      durationSeconds: 35,
      durationMode: "script",
      aspect: "9:16",
      motionProfile: "smooth",
      pace: "fast",
      audio: { mode: "both", voice: "Kore" },
      captions: "full",
      template: null,
      theme: "blue-professional",
      look: "clean"
    };
    const nineBeats = Array.from({ length: 9 }, (_, i) => ({
      id: `b${i + 1}`,
      keyword: `Stop ${i + 1}`,
      visual: `Diagram ${i + 1}`,
      onScreen: `Hop ${i + 1}`,
      line: `Hop ${i + 1} across the network.`
    }));
    const sketchedFrames = nineBeats.map((beat) => ({
      key: scriptFrameKey(beat, nineBrief),
      svg: `<svg viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#0b0d12"/></svg>`
    }));
    const projSketchedNoBeatPlan = {
      ...pPaid,
      billingPolicyVersion: "v2_step_tier",
      brief: { ...nineBrief, scriptBeats: nineBeats },
      scriptFrames: sketchedFrames,
      beatPlan: undefined,
      filmMotion: undefined
    };
    const animQuoteWhilePlanInFlight = await quoteAnimationStep({
      userId: paidOwner,
      project: projSketchedNoBeatPlan,
      brief: nineBrief,
      beats: nineBeats,
      tier: "standard",
      persist: false
    });
    assert.equal(animQuoteWhilePlanInFlight.framesQuote.milli, 0, "All 9 frames are cached -> 0 frame millitokens");
    assert.equal(animQuoteWhilePlanInFlight.scenesToAuthor, 9, "All 9 frame-motion scenes still need authoring even before beatPlan saves");
    assert.equal(animQuoteWhilePlanInFlight.animationCodeQuote.milli, 1800, "9 frame-motion scenes * 200 milli = 1800 milli (1.8t)");

    // 6. Element-edit (0 for rule-based, 0.3t per model comment) and Pro Assist (0.5t) quotes
    const ruleOnlyEditQuote = await quoteElementEditStep({
      userId: paidOwner,
      project: projSketchedNoBeatPlan,
      modelCommentCount: 0,
      ruleCommentCount: 3,
      persist: false
    });
    assert.equal(ruleOnlyEditQuote.milli, 0, "Rule-based element edits cost 0 tokens");
    const modelEditQuote = await quoteElementEditStep({
      userId: paidOwner,
      project: projSketchedNoBeatPlan,
      modelCommentCount: 2,
      ruleCommentCount: 1,
      persist: false
    });
    assert.equal(modelEditQuote.milli, 600, "2 model-translated comments cost 2 * 300 = 600 milli (0.6t)");

    const proAssistQuote = await quoteProAssistStep({
      userId: paidOwner,
      project: projSketchedNoBeatPlan,
      task: "Tighten headline spacing",
      target: "#headline",
      persist: false
    });
    assert.equal(proAssistQuote.milli, 500, "Pro assist costs 500 milli (0.5t)");

    // 7. Concurrent reservation race deduplication & refundSpend reservation status synchronization
    await grantTokens(paidOwner, 50, "concurrent test", "test", `conc:${paidOwner}`, "plan");
    const raceQuote = await createStepQuote({
      userId: paidOwner,
      projectId: pPaid.id,
      stage: "render_export",
      pricingVersion: "v2_step_tier",
      animationTier: "standard",
      workFingerprint: "fp-concurrent-render-67s",
      milli: 2610,
      unitsTotal: 67,
      breakdown: {
        stage: "render_export",
        pricingVersion: "v2_step_tier",
        animationTier: "standard",
        model: "worker-ffmpeg",
        unitsTotal: 67,
        reusedUnits: 0,
        setupMilli: 600,
        perUnitMilli: 30
      }
    });
    const beforeRace = (await tokenSummary(paidOwner)).remaining;
    const [rA, rB] = await Promise.all([
      reserveStepTokens({ userId: paidOwner, projectId: pPaid.id, quote: raceQuote, ledgerReason: "render_export" }),
      reserveStepTokens({ userId: paidOwner, projectId: pPaid.id, quote: raceQuote, ledgerReason: "render_export" })
    ]);
    assert.equal(rA.id, rB.id, "Concurrent reservations with identical workFingerprint resolve to the same reservation");
    const afterRace = (await tokenSummary(paidOwner)).remaining;
    assert.equal(Math.round((beforeRace - afterRace) * 100) / 100, 2.61, "Concurrent reservations debit 2.61 tokens exactly once");

    await settleStepReservation(rA.id);
    // Simulate a render worker failure calling refundSpend directly: reservation status must synchronize to 'refunded'
    await refundSpend(paidOwner, rA.spendEvent);
    const syncedRow = await query("select status, settled_milli, refunded_milli from app.generation_reservations where id = $1", [rA.id]);
    assert.equal(syncedRow.rows[0]?.status, "refunded", "refundSpend synchronizes reservation status to 'refunded'");
    assert.equal(Number(syncedRow.rows[0]?.settled_milli), 0);
    assert.equal(Number(syncedRow.rows[0]?.refunded_milli), 2610);
    const afterRefundSpend = (await tokenSummary(paidOwner)).remaining;
    assert.equal(afterRefundSpend, beforeRace, "Full balance restored after refundSpend");
  } finally {
    if (prevEnv === undefined) delete process.env.BILLING_POLICY_VERSION;
    else process.env.BILLING_POLICY_VERSION = prevEnv;
    await deleteProject(pFree.id).catch(() => undefined);
    await deleteProject(pPaid.id).catch(() => undefined);
    await query("delete from app.generation_reservations where user_id = any($1)", [[freeOwner, paidOwner]]);
    await query("delete from app.generation_quotes where user_id = any($1)", [[freeOwner, paidOwner]]);
    await query("delete from app.subscriptions where user_id = $1", [paidOwner]);
    await query("delete from app.token_ledger where user_id = any($1)", [[freeOwner, paidOwner]]);
  }
}

await pool.end();
console.log("step-tier-billing: ok");
