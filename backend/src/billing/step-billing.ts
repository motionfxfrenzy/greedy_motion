import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ANIMATION_TIER_SPECS,
  DEFAULT_ANIMATION_TIER,
  PREMIUM_LOCKED_COPY,
  canUseAnimationTier,
  effectiveBriefDurationSeconds,
  estimateWholeFilmQuoteV2,
  frameMotionCostMillitokensV2,
  isAnimationTier,
  isPaidTier,
  materialCostMillitokens,
  materialCostMillitokensV2,
  parseScriptBeats,
  parseScriptBrief,
  plateAnimationCostMillitokensV2,
  renderCostMillitokens,
  renderExportCostMillitokensV2,
  scriptFrameKey,
  stepTariffsAt,
  tokensFromMilli,
  voiceText,
  type AnimationTier,
  type BillingPolicyVersion,
  type PlanTier,
  type ScriptBeat,
  type ScriptBrief,
  type VideoProject,
  type WholeFilmEstimateV2
} from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { pool, query, withTransaction } from "../db/database.ts";
import type { Route } from "../models/routes.ts";
import { filmFrames } from "../plan/frame-film.ts";
import { filmScenes, motionSignature } from "../plan/frame-motion.ts";
import { projectTiming } from "../plan/preview.ts";
import { planReadiness } from "../plan/readiness.ts";
import { materialOwedUsd, visualStatus } from "../plan/visual-state.ts";
import { speakerSettings, takeKey, voiceSettings } from "../plan/voice.ts";
import { desiredVariants, isPlateLook, wantedAspects } from "../plates/inputs.ts";
import { isAspect, primaryAspect, type Aspect, type PlateComment } from "../plates/model.ts";
import { decideRevisionApply, listVariants, matchVariantsToDesired, readProjectState } from "../plates/store.ts";
import { getProject, updateProject } from "../projects/store.ts";
import { InsufficientTokens, refundPartialSpend, refundSpend, spendTokens, tokenSummary } from "../tokens/store.ts";
import { tierFor } from "./service.ts";

export type BillableStage =
  | "script_write"
  | "script_edit"
  | "scene_insert"
  | "beat_rewrite"
  | "storyboard_plan"
  | "frame_sketch"
  | "voice_music"
  | "animation"
  | "plate_draw"
  | "plate_fix"
  | "plate_aspect"
  | "render_export"
  | "material"
  | "element_edit"
  | "pro_assist";

export type AnimationRouteSnapshot = {
  tier: AnimationTier;
  writer: Route;
  repair: Route;
  motion: Route;
};

export class PremiumRequiresSubscriptionError extends Error {
  readonly code = "premium_requires_subscription" as const;
  readonly statusCode = 402;
  readonly tier: PlanTier;
  constructor(tier: PlanTier = "free") {
    super(PREMIUM_LOCKED_COPY);
    this.name = "PremiumRequiresSubscriptionError";
    this.tier = tier;
  }
}

export class QuoteStaleError extends Error {
  readonly code: "quote_stale" | "quote_expired" | "invalid_quote";
  readonly statusCode: number;
  readonly freshQuote?: StepQuoteView;
  constructor(
    code: "quote_stale" | "quote_expired" | "invalid_quote",
    message: string,
    freshQuote?: StepQuoteView
  ) {
    super(message);
    this.name = "QuoteStaleError";
    this.code = code;
    this.statusCode = code === "invalid_quote" ? 400 : 409;
    this.freshQuote = freshQuote;
  }
}

const sha256Short = (...parts: unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);

/** Active deployment billing policy version (`v1_render_only` default in production; `v2_step_tier` when enabled). */
export function activeBillingPolicyEnv(env: NodeJS.ProcessEnv = process.env): BillingPolicyVersion {
  return env.BILLING_POLICY_VERSION === "v2_step_tier" ? "v2_step_tier" : "v1_render_only";
}

/**
 * Resolves the billing policy version governing `project`:
 * - Explicit `project.billingPolicyVersion` always wins (preserving grandfathered `v1_render_only` or locked `v2_step_tier`).
 * - Legacy projects created before `v2_step_tier` that already have a storyboard, script, audio, motion, or render job
 *   are grandfathered on `v1_render_only` so existing paid promises are preserved and never double-charged.
 * - Fresh projects follow `activeBillingPolicyEnv()`.
 */
export type LegacyCheckProject = Pick<
  VideoProject,
  "billingPolicyVersion" | "beatPlan" | "script" | "planAudio" | "filmMotion" | "renderJobId"
> &
  Partial<Pick<VideoProject, "brief" | "scriptFrames">>;

export function effectiveBillingPolicyVersion(
  project?: LegacyCheckProject | null,
  env: NodeJS.ProcessEnv = process.env
): BillingPolicyVersion {
  if (project?.billingPolicyVersion === "v2_step_tier") return "v2_step_tier";
  if (project?.billingPolicyVersion === "v1_render_only") return "v1_render_only";
  if (activeBillingPolicyEnv(env) !== "v2_step_tier") return "v1_render_only";
  const hasLegacyProgress = Boolean(
    project &&
      (project.beatPlan ||
        project.script ||
        project.planAudio ||
        (project.filmMotion && project.filmMotion.length > 0) ||
        (project.brief?.scriptBeats && project.brief.scriptBeats.length > 0) ||
        (project.scriptFrames && project.scriptFrames.length > 0) ||
        project.renderJobId)
  );
  return hasLegacyProgress ? "v1_render_only" : "v2_step_tier";
}

/**
 * Whether per-step token charging is active for `project`:
 * - Only active when `effectiveBillingPolicyVersion(project)` is `"v2_step_tier"`.
 * - Can be explicitly overridden in local dev via `STEP_BILLING=on|off`; when `BILLING_POLICY_VERSION=v2_step_tier`,
 *   defaults to `on` unless `STEP_BILLING=off`.
 */
export function stepBillingOnForProject(
  project?: LegacyCheckProject | null,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (effectiveBillingPolicyVersion(project, env) !== "v2_step_tier") return false;
  if (env.STEP_BILLING === "off") return false;
  if (env.STEP_BILLING === "on") return true;
  return config.appEnv !== "local" || env.BILLING_POLICY_VERSION === "v2_step_tier";
}

/** Resolves the animation quality tier selected on the project/brief, defaulting to `"standard"`. */
export function resolveProjectAnimationTier(
  project?: Pick<VideoProject, "animationTier" | "brief"> | null,
  briefOverride?: Partial<Pick<ScriptBrief, "animationTier">> | null,
  explicitTier?: unknown
): AnimationTier {
  if (isAnimationTier(explicitTier)) return explicitTier;
  if (isAnimationTier(briefOverride?.animationTier)) return briefOverride.animationTier;
  if (isAnimationTier(project?.brief?.animationTier)) return project.brief.animationTier;
  if (isAnimationTier(project?.animationTier)) return project.animationTier;
  return DEFAULT_ANIMATION_TIER;
}

/**
 * Builds an immutable model route snapshot for the given animation tier (`standard` = `gemini-3.8-flash`,
 * `premium` = `claude-opus-5-5`). Never mutates `process.env`, so concurrent requests are isolated.
 */
export function authorRouteForTier(tier: AnimationTier): AnimationRouteSnapshot {
  const spec = ANIMATION_TIER_SPECS[tier] ?? ANIMATION_TIER_SPECS.standard;
  return {
    tier: spec.id,
    writer: {
      step: "sceneWriter",
      provider: spec.provider,
      model: spec.model,
      maxTokens: 24000,
      explicit: true
    },
    repair: {
      step: "sceneRepair",
      provider: spec.provider,
      model: spec.model,
      maxTokens: 24000,
      explicit: true
    },
    motion: {
      step: "motion",
      provider: spec.provider,
      model: spec.model,
      effort: "low",
      maxTokens: 3000,
      explicit: true
    }
  };
}

/**
 * Enforces the Free-vs-Paid animation tier entitlement rule:
 * - Free accounts (`planTier === "free"`) must always use `standard` (`gemini-3.8-flash`).
 * - `premium` (`claude-opus-5-5`) requires an active paid subscription (`starter`, `pro`, `business`),
 *   not merely possession of free or top-up tokens.
 */
export async function assertAnimationTierEntitled(
  userId: string,
  animationTier: AnimationTier,
  now = new Date()
): Promise<{ planTier: PlanTier; animationTier: AnimationTier; routeSnapshot: AnimationRouteSnapshot }> {
  const planTier = await tierFor(userId, now);
  if (!canUseAnimationTier(planTier, animationTier)) {
    throw new PremiumRequiresSubscriptionError(planTier);
  }
  return {
    planTier,
    animationTier,
    routeSnapshot: authorRouteForTier(animationTier)
  };
}

export type StepQuoteBreakdown = {
  stage: BillableStage;
  pricingVersion: BillingPolicyVersion;
  animationTier: AnimationTier;
  model: string;
  unitsTotal: number;
  reusedUnits: number;
  setupMilli: number;
  perUnitMilli: number;
  parts?: Record<string, number>;
  note?: string;
};

export type StepQuoteView = {
  quoteId: string;
  projectId: string;
  stage: BillableStage;
  pricingVersion: BillingPolicyVersion;
  animationTier: AnimationTier;
  tokens: number;
  milli: number;
  unitsTotal: number;
  reusedUnits: number;
  workFingerprint: string;
  revisionDigest: string;
  breakdown: StepQuoteBreakdown;
  expiresAt: string;
};

export const QUOTE_TTL_MS = 15 * 60 * 1000;

export async function createStepQuote(input: {
  userId: string;
  projectId: string;
  stage: BillableStage;
  pricingVersion: BillingPolicyVersion;
  animationTier: AnimationTier;
  revisionDigest?: string;
  workFingerprint: string;
  milli: number;
  unitsTotal?: number;
  reusedUnits?: number;
  breakdown: StepQuoteBreakdown;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);
  const milli = Math.max(0, Math.round(input.milli));
  const unitsTotal = Math.max(1, Math.floor(input.unitsTotal ?? input.breakdown.unitsTotal ?? 1));
  const reusedUnits = Math.max(0, Math.floor(input.reusedUnits ?? input.breakdown.reusedUnits ?? 0));
  const revisionDigest = input.revisionDigest ?? "";
  let quoteId: string = randomUUID();

  if (input.persist !== false) {
    const res = await query<{ id: string }>(
      `insert into app.generation_quotes
         (id, user_id, project_id, stage, pricing_version, animation_tier, revision_digest, work_fingerprint, milli, breakdown, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       returning id`,
      [
        quoteId,
        input.userId,
        input.projectId,
        input.stage,
        input.pricingVersion,
        input.animationTier,
        revisionDigest,
        input.workFingerprint,
        milli,
        JSON.stringify(input.breakdown),
        expiresAt
      ]
    );
    quoteId = res.rows[0]?.id ?? quoteId;
  }

  return {
    quoteId,
    projectId: input.projectId,
    stage: input.stage,
    pricingVersion: input.pricingVersion,
    animationTier: input.animationTier,
    tokens: tokensFromMilli(milli),
    milli,
    unitsTotal,
    reusedUnits,
    workFingerprint: input.workFingerprint,
    revisionDigest,
    breakdown: input.breakdown,
    expiresAt: expiresAt.toISOString()
  };
}

/**
 * Verifies a client-supplied `quoteId` against the server's freshly computed `expected` quote.
 * Rejects tampered, wrong-owner, wrong-project, expired, or stale quotes before any model call or spend.
 */
export async function verifyStepQuote(
  quoteId: string | undefined | null,
  userId: string,
  expected: StepQuoteView,
  now = new Date()
): Promise<StepQuoteView> {
  if (!quoteId) return expected;
  const trimmed = String(quoteId).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new QuoteStaleError("invalid_quote", "The quote id is invalid.", expected);
  }
  const { rows } = await query<{
    id: string;
    user_id: string;
    project_id: string;
    stage: string;
    pricing_version: string;
    animation_tier: string;
    work_fingerprint: string;
    milli: number;
    expires_at: Date;
  }>("select * from app.generation_quotes where id = $1", [trimmed]);
  const row = rows[0];
  if (!row || row.user_id !== userId || row.project_id !== expected.projectId || row.stage !== expected.stage) {
    throw new QuoteStaleError("invalid_quote", "This quote does not belong to this project or stage.", expected);
  }
  if (row.expires_at.getTime() <= now.getTime()) {
    throw new QuoteStaleError(
      "quote_expired",
      "This price quote expired. Review the updated quote and try again.",
      expected
    );
  }
  if (
    row.pricing_version !== expected.pricingVersion ||
    row.animation_tier !== expected.animationTier ||
    row.work_fingerprint !== expected.workFingerprint ||
    row.milli !== expected.milli
  ) {
    throw new QuoteStaleError(
      "quote_stale",
      "The project or animation tier changed since this quote was calculated. Review the updated quote and try again.",
      expected
    );
  }
  return { ...expected, quoteId: row.id };
}

export type StepReservation = {
  id: string;
  userId: string;
  projectId: string;
  stage: BillableStage;
  pricingVersion: BillingPolicyVersion;
  animationTier: AnimationTier;
  routeSnapshot: AnimationRouteSnapshot;
  workFingerprint: string;
  reservedMilli: number;
  unitsTotal: number;
  spendEvent: string | null;
  reusedExisting: boolean;
};

export const RESERVATION_TTL_MS = 25 * 60 * 1000;

/**
 * Atomically reserves `quote.milli` millitokens for `stage` before any paid model/audio/worker execution starts.
 * - If `quote.milli === 0` (or `v1_render_only` non-render step, or all units cached/reused), creates a 0-cost record.
 * - If an active/settled reservation with the same `(user_id, project_id, stage, work_fingerprint)` already exists,
 *   returns it with `reusedExisting: true` so retries/idempotent calls never double-charge.
 * - Ensures `project.billingPolicyVersion = "v2_step_tier"` is stamped on the project once billed under `v2_step_tier`.
 */
export async function reserveStepTokens(input: {
  userId: string;
  projectId: string;
  quote: StepQuoteView;
  quoteIdFromClient?: string | null;
  routeSnapshot?: AnimationRouteSnapshot;
  ledgerReason?: string;
  now?: Date;
}): Promise<StepReservation> {
  const now = input.now ?? new Date();
  const verifiedQuote = await verifyStepQuote(input.quoteIdFromClient, input.userId, input.quote, now);
  const routeSnapshot = input.routeSnapshot ?? authorRouteForTier(verifiedQuote.animationTier);
  const unitsTotal = Math.max(1, verifiedQuote.unitsTotal);
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);

  if (verifiedQuote.milli <= 0) {
    return {
      id: randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      stage: verifiedQuote.stage,
      pricingVersion: verifiedQuote.pricingVersion,
      animationTier: verifiedQuote.animationTier,
      routeSnapshot,
      workFingerprint: verifiedQuote.workFingerprint,
      reservedMilli: 0,
      unitsTotal,
      spendEvent: null,
      reusedExisting: false
    };
  }

  // Check if an identical workFingerprint reservation is already active or settled for this project & stage
  if (verifiedQuote.workFingerprint) {
    const existing = await query<{
      id: string;
      reserved_milli: number;
      units_total: number;
      spend_event: string | null;
      route_snapshot: AnimationRouteSnapshot;
      animation_tier: AnimationTier;
      pricing_version: BillingPolicyVersion;
    }>(
      `select id, reserved_milli, units_total, spend_event, route_snapshot, animation_tier, pricing_version
         from app.generation_reservations
        where user_id = $1 and project_id = $2 and stage = $3 and work_fingerprint = $4
          and status in ('reserved', 'settled', 'partial_refunded')
        limit 1`,
      [input.userId, input.projectId, verifiedQuote.stage, verifiedQuote.workFingerprint]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return {
        id: row.id,
        userId: input.userId,
        projectId: input.projectId,
        stage: verifiedQuote.stage,
        pricingVersion: row.pricing_version,
        animationTier: row.animation_tier,
        routeSnapshot: row.route_snapshot?.writer ? row.route_snapshot : routeSnapshot,
        workFingerprint: verifiedQuote.workFingerprint,
        reservedMilli: row.reserved_milli,
        unitsTotal: row.units_total,
        spendEvent: row.spend_event,
        reusedExisting: true
      };
    }
  }

  const reservationId = randomUUID();
  const reason = input.ledgerReason ?? verifiedQuote.stage;
  const spend = await spendTokens(
    input.userId,
    verifiedQuote.milli,
    reason,
    reservationId,
    input.projectId,
    now
  );

  try {
    const inserted = await query<{ id: string }>(
      `insert into app.generation_reservations
         (id, quote_id, user_id, project_id, stage, pricing_version, animation_tier, route_snapshot,
          work_fingerprint, reserved_milli, settled_milli, refunded_milli, units_total, units_delivered,
          status, spend_event, breakdown, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 0, 0, $11, 0, 'reserved', $12, $13::jsonb, $14)
       on conflict (user_id, project_id, stage, work_fingerprint)
         where status in ('reserved', 'settled', 'partial_refunded') and work_fingerprint <> ''
       do nothing
       returning id`,
      [
        reservationId,
        verifiedQuote.quoteId,
        input.userId,
        input.projectId,
        verifiedQuote.stage,
        verifiedQuote.pricingVersion,
        verifiedQuote.animationTier,
        JSON.stringify(routeSnapshot),
        verifiedQuote.workFingerprint,
        verifiedQuote.milli,
        unitsTotal,
        spend.charged ? spend.event : null,
        JSON.stringify(verifiedQuote.breakdown),
        expiresAt
      ]
    );

    if (inserted.rowCount === 0) {
      // A concurrent request won the unique work_fingerprint race; refund our duplicate spend immediately
      if (spend.charged && spend.event) {
        await refundSpend(input.userId, spend.event);
      }
      const winner = await query<{
        id: string;
        reserved_milli: number;
        units_total: number;
        spend_event: string | null;
      }>(
        `select id, reserved_milli, units_total, spend_event
           from app.generation_reservations
          where user_id = $1 and project_id = $2 and stage = $3 and work_fingerprint = $4
            and status in ('reserved', 'settled', 'partial_refunded')
          limit 1`,
        [input.userId, input.projectId, verifiedQuote.stage, verifiedQuote.workFingerprint]
      );
      const win = winner.rows[0];
      return {
        id: win?.id ?? reservationId,
        userId: input.userId,
        projectId: input.projectId,
        stage: verifiedQuote.stage,
        pricingVersion: verifiedQuote.pricingVersion,
        animationTier: verifiedQuote.animationTier,
        routeSnapshot,
        workFingerprint: verifiedQuote.workFingerprint,
        reservedMilli: win?.reserved_milli ?? verifiedQuote.milli,
        unitsTotal: win?.units_total ?? unitsTotal,
        spendEvent: win?.spend_event ?? null,
        reusedExisting: true
      };
    }

    // Stamp billingPolicyVersion on the project if it was not yet stamped
    if (verifiedQuote.pricingVersion === "v2_step_tier") {
      await updateProject(input.projectId, {
        billingPolicyVersion: "v2_step_tier",
        animationTier: verifiedQuote.animationTier
      }).catch(() => undefined);
    }

    return {
      id: reservationId,
      userId: input.userId,
      projectId: input.projectId,
      stage: verifiedQuote.stage,
      pricingVersion: verifiedQuote.pricingVersion,
      animationTier: verifiedQuote.animationTier,
      routeSnapshot,
      workFingerprint: verifiedQuote.workFingerprint,
      reservedMilli: verifiedQuote.milli,
      unitsTotal,
      spendEvent: spend.charged ? spend.event : null,
      reusedExisting: false
    };
  } catch (error) {
    if (spend.charged && spend.event) {
      await refundSpend(input.userId, spend.event).catch(() => undefined);
    }
    throw error;
  }
}

/** Settles a reservation in full (at most once). */
export async function settleStepReservation(reservationId: string | null | undefined): Promise<boolean> {
  if (!reservationId) return false;
  const res = await query(
    `update app.generation_reservations
        set status = 'settled',
            settled_milli = reserved_milli - refunded_milli,
            units_delivered = units_total,
            updated_at = now()
      where id = $1 and status = 'reserved'`,
    [reservationId]
  );
  return res.rowCount === 1;
}

/** Releases a reservation and refunds its entire remaining spend (at most once). */
export async function releaseStepReservation(reservationId: string | null | undefined): Promise<boolean> {
  if (!reservationId) return false;
  const { rows } = await query<{
    id: string;
    user_id: string;
    reserved_milli: number;
    settled_milli: number;
    refunded_milli: number;
    status: string;
    spend_event: string | null;
  }>("select id, user_id, reserved_milli, settled_milli, refunded_milli, status, spend_event from app.generation_reservations where id = $1", [
    reservationId
  ]);
  const row = rows[0];
  if (!row || row.status === "refunded" || row.status === "settled") return false;
  if (row.spend_event && row.reserved_milli > 0) {
    await refundSpend(row.user_id, row.spend_event);
  }
  const updated = await query(
    `update app.generation_reservations
        set status = 'refunded',
            settled_milli = 0,
            refunded_milli = reserved_milli,
            updated_at = now()
      where id = $1 and status in ('reserved', 'partial_refunded')`,
    [reservationId]
  );
  return updated.rowCount === 1;
}

/**
 * Settles `deliveredUnits` of `units_total` and refunds the undelivered portion back to the user's ledger.
 * For an animation batch with `setupMilli` + `perUnitMilli * unitsTotal`:
 *  - If `deliveredUnits === 0`, refunds the entire reservation (including any batch setup fee).
 *  - If `0 < deliveredUnits < unitsTotal`, refunds `(unitsTotal - deliveredUnits) * perUnitMilli` (or proportional share).
 *  - If `deliveredUnits >= unitsTotal`, settles the entire reservation with 0 refund.
 */
export async function settlePartialStepReservation(
  reservationId: string | null | undefined,
  deliveredUnits: number,
  partKey = "final"
): Promise<{ settledMilli: number; refundedMilli: number }> {
  if (!reservationId) return { settledMilli: 0, refundedMilli: 0 };
  const clampedDelivered = Math.max(0, Math.floor(deliveredUnits));
  if (clampedDelivered === 0) {
    await releaseStepReservation(reservationId);
    const { rows } = await query<{ refunded_milli: number }>(
      "select refunded_milli from app.generation_reservations where id = $1",
      [reservationId]
    );
    return { settledMilli: 0, refundedMilli: rows[0]?.refunded_milli ?? 0 };
  }

  return withTransaction(async () => {
    const { rows } = await query<{
      id: string;
      user_id: string;
      reserved_milli: number;
      settled_milli: number;
      refunded_milli: number;
      units_total: number;
      status: string;
      spend_event: string | null;
      breakdown: StepQuoteBreakdown | null;
    }>("select * from app.generation_reservations where id = $1 for update", [reservationId]);
    const row = rows[0];
    if (!row || row.status === "settled" || row.status === "refunded") {
      return { settledMilli: row?.settled_milli ?? 0, refundedMilli: row?.refunded_milli ?? 0 };
    }
    if (clampedDelivered >= row.units_total) {
      const settled = row.reserved_milli - row.refunded_milli;
      await query(
        `update app.generation_reservations
            set status = case when refunded_milli > 0 then 'partial_refunded' else 'settled' end,
                settled_milli = $2,
                units_delivered = $3,
                updated_at = now()
          where id = $1`,
        [row.id, settled, row.units_total]
      );
      return { settledMilli: settled, refundedMilli: row.refunded_milli };
    }

    const failedUnits = Math.max(0, row.units_total - clampedDelivered);
    const perUnit =
      typeof row.breakdown?.perUnitMilli === "number" && row.breakdown.perUnitMilli > 0
        ? row.breakdown.perUnitMilli
        : Math.floor(row.reserved_milli / Math.max(1, row.units_total));
    const desiredTotalRefund = Math.min(row.reserved_milli, failedUnits * perUnit);
    const additionalRefund = Math.max(0, desiredTotalRefund - row.refunded_milli);

    if (additionalRefund > 0 && row.spend_event) {
      await refundPartialSpend(row.user_id, row.spend_event, additionalRefund, partKey);
    }

    const totalRefunded = row.refunded_milli + additionalRefund;
    const settledMilli = Math.max(0, row.reserved_milli - totalRefunded);
    await query(
      `update app.generation_reservations
          set status = case when $3 >= reserved_milli then 'refunded' when $3 > 0 then 'partial_refunded' else 'settled' end,
              settled_milli = $2,
              refunded_milli = $3,
              units_delivered = $4,
              updated_at = now()
        where id = $1`,
      [row.id, settledMilli, totalRefunded, clampedDelivered]
    );
    return { settledMilli, refundedMilli: totalRefunded };
  });
}

/**
 * Settles a `voice_music` reservation with separate accounting for delivered voice lines (`perUnitMilli`)
 * and the music bed (`setupMilli` / `parts.musicMilli`), so a failed music track refunds its full 1.0/1.9 token fee
 * and failed voice lines refund 0.1 token each.
 */
export async function settleVoiceMusicReservation(
  reservationId: string | null | undefined,
  voiceDelivered: number,
  musicDelivered: boolean,
  partKey = "voice-music-final"
): Promise<{ settledMilli: number; refundedMilli: number }> {
  if (!reservationId) return { settledMilli: 0, refundedMilli: 0 };
  const clampedVoice = Math.max(0, Math.floor(voiceDelivered));
  if (clampedVoice === 0 && !musicDelivered) {
    await releaseStepReservation(reservationId);
    const { rows } = await query<{ refunded_milli: number }>(
      "select refunded_milli from app.generation_reservations where id = $1",
      [reservationId]
    );
    return { settledMilli: 0, refundedMilli: rows[0]?.refunded_milli ?? 0 };
  }

  return withTransaction(async () => {
    const { rows } = await query<{
      id: string;
      user_id: string;
      reserved_milli: number;
      settled_milli: number;
      refunded_milli: number;
      units_total: number;
      status: string;
      spend_event: string | null;
      breakdown: StepQuoteBreakdown | null;
    }>("select * from app.generation_reservations where id = $1 for update", [reservationId]);
    const row = rows[0];
    if (!row || row.status === "settled" || row.status === "refunded") {
      return { settledMilli: row?.settled_milli ?? 0, refundedMilli: row?.refunded_milli ?? 0 };
    }
    const perVoice = typeof row.breakdown?.perUnitMilli === "number" ? row.breakdown.perUnitMilli : 100;
    const maxVoiceMilli = typeof row.breakdown?.parts?.voiceMilli === "number" ? row.breakdown.parts.voiceMilli : row.reserved_milli;
    const musicMilli = typeof row.breakdown?.parts?.musicMilli === "number" ? row.breakdown.parts.musicMilli : (row.breakdown?.setupMilli ?? 0);
    const deliveredMilli = Math.min(
      row.reserved_milli,
      Math.min(maxVoiceMilli, clampedVoice * perVoice) + (musicDelivered ? musicMilli : 0)
    );
    const desiredTotalRefund = Math.max(0, row.reserved_milli - deliveredMilli);
    const additionalRefund = Math.max(0, desiredTotalRefund - row.refunded_milli);

    if (additionalRefund > 0 && row.spend_event) {
      await refundPartialSpend(row.user_id, row.spend_event, additionalRefund, partKey);
    }

    const totalRefunded = row.refunded_milli + additionalRefund;
    const settledMilli = Math.max(0, row.reserved_milli - totalRefunded);
    const unitsDelivered = Math.min(row.units_total, clampedVoice + (musicDelivered && musicMilli > 0 ? 1 : 0));
    await query(
      `update app.generation_reservations
          set status = case when $3 >= reserved_milli then 'refunded' when $3 > 0 then 'partial_refunded' else 'settled' end,
              settled_milli = $2,
              refunded_milli = $3,
              units_delivered = $4,
              updated_at = now()
        where id = $1`,
      [row.id, settledMilli, totalRefunded, unitsDelivered]
    );
    return { settledMilli, refundedMilli: totalRefunded };
  });
}

/**
 * Called by `plate-author` when one scene variant (`variantId`) in an animation reservation finishes or permanently fails.
 * Tracks per-variant completion in `breakdown.completedVariants` / `breakdown.failedVariants`, and once all units in the
 * reservation have reported, settles delivered scenes and refunds any permanently failed scenes (including the batch setup
 * fee if every scene in the batch failed).
 */
export async function recordVariantReservationOutcome(
  reservationId: string | null | undefined,
  variantKey: string,
  outcome: "delivered" | "failed"
): Promise<void> {
  if (!reservationId || !variantKey) return;
  const decision = await withTransaction(async () => {
    const { rows } = await query<{
      id: string;
      user_id: string;
      reserved_milli: number;
      refunded_milli: number;
      units_total: number;
      status: string;
      spend_event: string | null;
      breakdown: Record<string, unknown> | null;
    }>("select * from app.generation_reservations where id = $1 for update", [reservationId]);
    const row = rows[0];
    if (!row || (row.status !== "reserved" && row.status !== "partial_refunded")) return null;

    const bd = { ...(row.breakdown ?? {}) };
    const deliveredSet = new Set<string>(Array.isArray(bd.deliveredVariants) ? (bd.deliveredVariants as string[]) : []);
    const failedSet = new Set<string>(Array.isArray(bd.failedVariants) ? (bd.failedVariants as string[]) : []);

    if (outcome === "delivered") {
      failedSet.delete(variantKey);
      deliveredSet.add(variantKey);
    } else if (!deliveredSet.has(variantKey)) {
      failedSet.add(variantKey);
    }

    bd.deliveredVariants = [...deliveredSet];
    bd.failedVariants = [...failedSet];

    await query(
      "update app.generation_reservations set breakdown = $2::jsonb, units_delivered = $3, updated_at = now() where id = $1",
      [row.id, JSON.stringify(bd), deliveredSet.size]
    );

    const totalAccounted = deliveredSet.size + failedSet.size;
    if (totalAccounted >= row.units_total) {
      return { delivered: deliveredSet.size, failed: failedSet.size };
    }
    return null;
  });

  if (decision) {
    await settlePartialStepReservation(reservationId, decision.delivered, `variants-${decision.delivered}-${decision.failed}`);
  }
}

/**
 * Total tokens already paid (or actively reserved) across pre-render steps for `projectId` under `v2_step_tier`.
 */
export async function projectPaidStepMillitokens(projectId: string, userId?: string): Promise<number> {
  const { rows } = await query<{ milli: string }>(
    `select coalesce(sum(
       case
         when status = 'reserved' then reserved_milli - refunded_milli
         else settled_milli
       end
     ), 0) as milli
       from app.generation_reservations
      where project_id = $1
        and ($2::uuid is null or user_id = $2::uuid)
        and stage <> 'render_export'
        and status in ('reserved', 'settled', 'partial_refunded')`,
    [projectId, userId ?? null]
  );
  return Math.max(0, Number(rows[0]?.milli ?? 0));
}

/**
 * Reconciles any expired `status = 'reserved'` rows (e.g. after a backend crash or timeout):
 * - For `plate_draw` / `animation` / `plate_fix` / `plate_aspect`, counts how many variants carrying `timings.reservationId`
 *   actually reached `bundled` / `checked` / `rendering` / `drawn` and settles only those, refunding the rest.
 * - For synchronous/SSE stages whose reservation expired without settling, releases/refunds them.
 */
export async function reconcileExpiredStepReservations(projectId?: string, now = new Date()): Promise<number> {
  const { rows } = await query<{
    id: string;
    project_id: string;
    stage: BillableStage;
    units_total: number;
    units_delivered: number;
  }>(
    `select id, project_id, stage, units_total, units_delivered
       from app.generation_reservations
      where status = 'reserved'
        and expires_at <= $1
        and ($2::uuid is null or project_id = $2::uuid)
      limit 50`,
    [now, projectId ?? null]
  );
  let reconciled = 0;
  for (const row of rows) {
    if (
      row.stage === "animation" ||
      row.stage === "plate_draw" ||
      row.stage === "plate_fix" ||
      row.stage === "plate_aspect"
    ) {
      const vRes = await pool.query<{ delivered: string }>(
        `select count(*)::int as delivered
           from app.plate_variants
          where project_id = $1
            and timings->>'reservationId' = $2
            and (bundle_key is not null or state in ('bundled', 'checked', 'rendering', 'drawn'))`,
        [row.project_id, row.id]
      );
      const delivered = Math.max(row.units_delivered, Number(vRes.rows[0]?.delivered ?? 0));
      await settlePartialStepReservation(row.id, delivered, "expired-reconcile");
    } else {
      await settlePartialStepReservation(row.id, row.units_delivered, "expired-reconcile");
    }
    reconciled += 1;
  }
  return reconciled;
}

// ---------------------------------------------------------------------------
// Stage Quote Calculators (Identical Arithmetic for UI Buttons & Ledger)
// ---------------------------------------------------------------------------

export async function quoteScriptStep(input: {
  userId: string;
  project: VideoProject;
  brief: ScriptBrief;
  onlyIndices?: number[];
  isSingleSceneInsert?: boolean;
  isSingleBeatRewrite?: boolean;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.brief);
  const sched = stepTariffsAt(now);
  const isScoped =
    Boolean(input.isSingleSceneInsert) ||
    Boolean(input.isSingleBeatRewrite) ||
    Boolean(input.onlyIndices && input.onlyIndices.length === 1);
  const stage: BillableStage = input.isSingleSceneInsert
    ? "scene_insert"
    : input.isSingleBeatRewrite
      ? "beat_rewrite"
      : input.onlyIndices && input.onlyIndices.length > 0
        ? "script_edit"
        : "script_write";

  const deterministic = config.planner === "deterministic";
  const rawMilli =
    pricingVersion !== "v2_step_tier" || deterministic
      ? 0
      : isScoped
        ? sched.scriptEditBeatMillitokens
        : input.onlyIndices && input.onlyIndices.length > 1
          ? Math.min(sched.scriptWriteMillitokens, input.onlyIndices.length * sched.scriptEditBeatMillitokens)
          : sched.scriptWriteMillitokens;

  const unitsTotal = input.onlyIndices?.length ? input.onlyIndices.length : 1;
  const workFingerprint = sha256Short(
    stage,
    pricingVersion,
    input.brief.text,
    input.brief.durationSeconds,
    input.brief.durationMode ?? "script",
    input.onlyIndices ?? [],
    now.toISOString().slice(0, 16)
  );

  return createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage,
    pricingVersion,
    animationTier,
    workFingerprint,
    milli: rawMilli,
    unitsTotal,
    reusedUnits: 0,
    breakdown: {
      stage,
      pricingVersion,
      animationTier,
      model: "gemini-4-argon",
      unitsTotal,
      reusedUnits: 0,
      setupMilli: 0,
      perUnitMilli: unitsTotal > 0 ? Math.round(rawMilli / unitsTotal) : rawMilli
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });
}

export async function quoteStoryboardPlanStep(input: {
  userId: string;
  project: VideoProject;
  brief: ScriptBrief;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.brief);
  const sched = stepTariffsAt(now);
  const deterministic = config.planner === "deterministic";
  const milli = pricingVersion === "v2_step_tier" && !deterministic ? sched.storyboardDirectorMillitokens : 0;
  const workFingerprint = sha256Short(
    "storyboard_plan",
    pricingVersion,
    input.brief.text,
    input.brief.look ?? "clean",
    input.brief.scriptBeats ?? []
  );
  return createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "storyboard_plan",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli,
    unitsTotal: 1,
    reusedUnits: deterministic ? 1 : 0,
    breakdown: {
      stage: "storyboard_plan",
      pricingVersion,
      animationTier,
      model: deterministic ? "deterministic" : "gemini-3.8-flash",
      unitsTotal: 1,
      reusedUnits: deterministic ? 1 : 0,
      setupMilli: 0,
      perUnitMilli: milli
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });
}

export async function quoteFrameSketchStep(input: {
  userId: string;
  project: VideoProject;
  brief: ScriptBrief;
  beats: ScriptBeat[];
  wantedIndices?: number[];
  force?: boolean;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView & { uncachedIndices: number[] }> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.brief);
  const sched = stepTariffsAt(now);
  const wanted = input.wantedIndices ?? input.beats.map((_, i) => i);
  const savedKeys = new Set((input.project.scriptFrames ?? []).map((f) => f.key));
  const uncachedIndices = input.force
    ? wanted
    : wanted.filter((idx) => input.beats[idx] && !savedKeys.has(scriptFrameKey(input.beats[idx]!, input.brief)));
  const reusedUnits = Math.max(0, wanted.length - uncachedIndices.length);
  const milli =
    pricingVersion === "v2_step_tier" ? uncachedIndices.length * sched.frameSketchPerBeatMillitokens : 0;
  const workFingerprint = sha256Short(
    "frame_sketch",
    pricingVersion,
    uncachedIndices.map((idx) => scriptFrameKey(input.beats[idx]!, input.brief))
  );
  const quote = await createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "frame_sketch",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli,
    unitsTotal: Math.max(1, uncachedIndices.length),
    reusedUnits,
    breakdown: {
      stage: "frame_sketch",
      pricingVersion,
      animationTier,
      model: "gemini-3.8-flash",
      unitsTotal: uncachedIndices.length,
      reusedUnits,
      setupMilli: 0,
      perUnitMilli: sched.frameSketchPerBeatMillitokens
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });
  return { ...quote, uncachedIndices };
}

export async function quoteVoiceMusicStep(input: {
  userId: string;
  project: VideoProject;
  brief: ScriptBrief;
  beats: ScriptBeat[];
  wantedIndices?: number[];
  force?: boolean;
  includeMusic?: boolean;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView & { uncachedVoiceIndices: number[]; needsMusic: boolean }> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.brief);
  const sched = stepTariffsAt(now);

  const voiced = input.brief.audio.mode === "voiceover" || input.brief.audio.mode === "both";
  const musicOn = input.brief.audio.mode === "music" || input.brief.audio.mode === "both";
  const settings = voiceSettings({ ...input.project, brief: input.brief });
  const existingVoiceMatches = !input.force && input.project.planAudio?.voice?.voice === settings.voice;
  const existingByText = new Map(
    existingVoiceMatches ? (input.project.planAudio?.voice?.lines ?? []).map((l) => [l.text, l]) : []
  );
  const speakerAt = (index: number) =>
    (input.beats[index] as { speaker?: string | null } | undefined)?.speaker ??
    input.brief.scriptBeats?.[index]?.speaker ??
    input.project.brief?.scriptBeats?.[index]?.speaker;
  const lineSettings = (index: number) => speakerSettings(settings, speakerAt(index));

  const candidateIndices = input.wantedIndices ?? input.beats.map((_, i) => i);
  const voicedCandidates = voiced ? candidateIndices.filter((i) => Boolean(voiceText(input.beats[i]?.line))) : [];
  const uncachedVoiceIndices = voicedCandidates.filter((i) => {
    if (input.force) return true;
    const cleaned = voiceText(input.beats[i]?.line);
    const cached = existingByText.get(cleaned);
    const reusable =
      cached && (settings.cast !== "characters" || cached.file === `vo/${takeKey(lineSettings(i), cleaned)}.wav`);
    return !reusable;
  });

  const needsMusic =
    input.includeMusic !== false &&
    !input.wantedIndices &&
    musicOn &&
    (Boolean(input.force) || !input.project.planAudio?.music);

  const targetSeconds = effectiveBriefDurationSeconds(input.brief, input.beats);
  const voiceMilli = uncachedVoiceIndices.length * sched.voicePerLineMillitokens;
  const musicMilli = needsMusic
    ? targetSeconds <= 28
      ? sched.musicClipMillitokens
      : sched.musicSongMillitokens
    : 0;
  const rawMilli = pricingVersion === "v2_step_tier" && config.geminiApiKey ? voiceMilli + musicMilli : 0;
  const unitsTotal = Math.max(1, uncachedVoiceIndices.length + (needsMusic ? 1 : 0));
  const reusedUnits = Math.max(0, voicedCandidates.length - uncachedVoiceIndices.length + (musicOn && !needsMusic ? 1 : 0));

  const workFingerprint = sha256Short(
    "voice_music",
    pricingVersion,
    uncachedVoiceIndices.map((i) => `${i}:${takeKey(lineSettings(i), voiceText(input.beats[i]?.line))}`),
    needsMusic ? `music:${targetSeconds <= 28 ? "clip" : "song"}:${input.brief.audio.musicMood ?? ""}` : "no-music"
  );

  const quote = await createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "voice_music",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli: rawMilli,
    unitsTotal,
    reusedUnits,
    breakdown: {
      stage: "voice_music",
      pricingVersion,
      animationTier,
      model: "gemini-3.8-flash-tts+lyria",
      unitsTotal: uncachedVoiceIndices.length + (needsMusic ? 1 : 0),
      reusedUnits,
      setupMilli: musicMilli,
      perUnitMilli: sched.voicePerLineMillitokens,
      parts: {
        voiceMilli,
        musicMilli
      }
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });

  return { ...quote, uncachedVoiceIndices, needsMusic };
}

/**
 * Computes which plate variants (`index:aspect`) will actually require new `plate-author` LLM calls
 * when `startPlates` / `drawAspectPlates` runs. Variants that match in-place, transfer from a shifted donor,
 * or retry from an already-saved bundle (`row.bundle_key`) require 0 new model calls and cost 0 tokens.
 */
export async function computeUnauthoredPlateVariants(
  project: VideoProject,
  brief: ScriptBrief,
  beats: ScriptBeat[],
  extraAspects: Aspect[] = [],
  options: { forceAll?: boolean } = {}
): Promise<{
  toAuthor: { index: number; aspect: Aspect; signature: string }[];
  reusedCount: number;
  totalDesired: number;
}> {
  const projectWithBrief: VideoProject = {
    ...project,
    brief: { ...brief, scriptBeats: beats }
  };
  if (!isPlateLook(brief.look) || beats.length === 0) {
    return { toAuthor: [], reusedCount: 0, totalDesired: 0 };
  }
  const [storedState, existingVariants] = await Promise.all([
    readProjectState(project.id),
    listVariants(project.id)
  ]);
  const aspects = [
    ...new Set([
      ...wantedAspects(projectWithBrief, [
        ...(brief.aspects ?? []),
        ...(storedState.subtitles?.aspects ?? []),
        ...extraAspects
      ])
    ])
  ];
  const desired = await desiredVariants(projectWithBrief, aspects, existingVariants);
  // Recreate: the stored variants are about to be discarded, so nothing matches and every scene is authored again.
  const { matched } = options.forceAll
    ? { matched: new Map<string, never>() }
    : matchVariantsToDesired(existingVariants, desired);

  const toAuthor: { index: number; aspect: Aspect; signature: string }[] = [];
  let reusedCount = 0;

  for (const d of desired) {
    const key = `${d.index}:${d.aspect}`;
    const match = matched.get(key);
    if (!match) {
      toAuthor.push({ index: d.index, aspect: d.aspect, signature: d.signature });
      continue;
    }
    if (match.row.state === "failed" && !match.row.bundle_key) {
      toAuthor.push({ index: d.index, aspect: d.aspect, signature: d.signature });
      continue;
    }
    reusedCount += 1;
  }

  return { toAuthor, reusedCount, totalDesired: desired.length };
}

/**
 * Quotes the Step 3 `script/animate` request (including any missing frames, missing voice/music, and unauthored
 * plate scenes or uncached SVG `frame-motion` scenes) for a specific `animationTier`.
 */
export async function quoteAnimationStep(input: {
  userId: string;
  project: VideoProject;
  brief: ScriptBrief;
  beats: ScriptBeat[];
  tier?: AnimationTier;
  persist?: boolean;
  now?: Date;
  /** Quote as if no scene code existed: every scene is authored again (the Recreate animation path). */
  recreate?: boolean;
  /** Distinguishes one Recreate from the last: without it a repeat with identical scenes would match the earlier settled reservation and charge nothing. */
  recreateId?: string;
}): Promise<
  StepQuoteView & {
    framesQuote: StepQuoteView & { uncachedIndices: number[] };
    audioQuote: StepQuoteView & { uncachedVoiceIndices: number[]; needsMusic: boolean };
    animationCodeQuote: StepQuoteView;
    scenesToAuthor: number;
    scenesReused: number;
    isPlate: boolean;
    isFrameMotion: boolean;
  }
> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = input.tier ?? resolveProjectAnimationTier(input.project, input.brief);
  const sched = stepTariffsAt(now);
  const spec = ANIMATION_TIER_SPECS[animationTier];

  const [framesQuote, audioQuote] = await Promise.all([
    quoteFrameSketchStep({
      userId: input.userId,
      project: input.project,
      brief: input.brief,
      beats: input.beats,
      persist: false,
      now
    }),
    quoteVoiceMusicStep({
      userId: input.userId,
      project: input.project,
      brief: input.brief,
      beats: input.beats,
      persist: false,
      now
    })
  ]);

  const isPlate = isPlateLook(input.brief.look);
  let scenesToAuthor = 0;
  let scenesReused = 0;
  let isFrameMotion = false;
  let animCodeMilli = 0;
  let setupMilli = 0;
  let perSceneMilli = 0;
  let animSigParts: string[] = [];

  if (isPlate) {
    const platePlan = await computeUnauthoredPlateVariants(input.project, input.brief, input.beats, [], { forceAll: Boolean(input.recreate) });
    scenesToAuthor = platePlan.toAuthor.length;
    scenesReused = platePlan.reusedCount;
    if (pricingVersion === "v2_step_tier" && scenesToAuthor > 0) {
      setupMilli = sched.plateAnimationBatchSetupMillitokens[animationTier];
      perSceneMilli = sched.plateAnimationSceneMillitokens[animationTier];
      animCodeMilli = plateAnimationCostMillitokensV2(scenesToAuthor, animationTier, now);
    }
    animSigParts = platePlan.toAuthor.map((v) => `${v.index}:${v.aspect}:${v.signature}`);
  } else {
    // Non-plate: check if SVG frame-motion will run or if it's a template-only film
    const projectWithBeats: VideoProject = {
      ...input.project,
      ...(input.recreate ? { filmMotion: [] } : {}),
      brief: { ...input.brief, scriptBeats: input.beats }
    };
    const timing = projectTiming(projectWithBeats);
    const frames = timing ? filmFrames(projectWithBeats, timing) : null;
    if (timing && frames) {
      isFrameMotion = true;
      const scenes = filmScenes(projectWithBeats, timing, frames);
      const cached = new Map((projectWithBeats.filmMotion ?? []).map((e) => [e.signature, e]));
      const uncachedVoiceSet = new Set(audioQuote.uncachedVoiceIndices);
      const uncached = scenes.filter((s) => !cached.has(motionSignature(s)) || uncachedVoiceSet.has(s.index));
      scenesToAuthor = uncached.length;
      scenesReused = scenes.length - uncached.length;
      if (pricingVersion === "v2_step_tier" && scenesToAuthor > 0) {
        perSceneMilli = sched.frameMotionSceneMillitokens[animationTier];
        animCodeMilli = frameMotionCostMillitokensV2(scenesToAuthor, animationTier, now);
      }
      animSigParts = uncached.map((s) => `${s.index}:${motionSignature(s)}:${uncachedVoiceSet.has(s.index) ? "vo-new" : "vo-cached"}`);
    } else if (
      input.beats.length > 0 &&
      (framesQuote.uncachedIndices.length > 0 || (input.project.scriptFrames?.length ?? 0) > 0)
    ) {
      // Frames are being sketched (or are already sketched while beatPlan is still in flight) and will be animated via frame-motion
      isFrameMotion = true;
      const canReuseMotion =
        framesQuote.uncachedIndices.length === 0 && audioQuote.uncachedVoiceIndices.length === 0;
      const reusedMotion = canReuseMotion
        ? Math.min(input.beats.length, projectWithBeats.filmMotion?.length ?? 0)
        : 0;
      scenesToAuthor = Math.max(0, input.beats.length - reusedMotion);
      scenesReused = reusedMotion;
      if (pricingVersion === "v2_step_tier" && scenesToAuthor > 0) {
        perSceneMilli = sched.frameMotionSceneMillitokens[animationTier];
        animCodeMilli = frameMotionCostMillitokensV2(scenesToAuthor, animationTier, now);
      }
      animSigParts = input.beats.slice(reusedMotion).map((b, i) => `${reusedMotion + i}:${b.keyword}`);
    }
  }

  if (input.recreate) animSigParts = [...animSigParts, `recreate:${input.recreateId ?? "preview"}`];

  const totalMilli =
    pricingVersion === "v2_step_tier" ? framesQuote.milli + audioQuote.milli + animCodeMilli : 0;
  const unitsTotal = Math.max(
    1,
    scenesToAuthor + framesQuote.uncachedIndices.length + audioQuote.uncachedVoiceIndices.length + (audioQuote.needsMusic ? 1 : 0)
  );
  const workFingerprint = sha256Short(
    "animation",
    pricingVersion,
    animationTier,
    framesQuote.workFingerprint,
    audioQuote.workFingerprint,
    animSigParts
  );

  const animationCodeStage: BillableStage = isPlate ? "plate_draw" : "animation";
  const animationCodeQuote = await createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: animationCodeStage,
    pricingVersion,
    animationTier,
    workFingerprint: sha256Short(animationCodeStage, pricingVersion, animationTier, animSigParts),
    milli: pricingVersion === "v2_step_tier" ? animCodeMilli : 0,
    unitsTotal: Math.max(1, scenesToAuthor),
    reusedUnits: scenesReused,
    breakdown: {
      stage: animationCodeStage,
      pricingVersion,
      animationTier,
      model: spec.model,
      unitsTotal: scenesToAuthor,
      reusedUnits: scenesReused,
      setupMilli,
      perUnitMilli: perSceneMilli
    },
    persist: false,
    now
  });

  const quote = await createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "animation",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli: totalMilli,
    unitsTotal,
    reusedUnits: scenesReused + framesQuote.reusedUnits + audioQuote.reusedUnits,
    breakdown: {
      stage: "animation",
      pricingVersion,
      animationTier,
      model: spec.model,
      unitsTotal: scenesToAuthor,
      reusedUnits: scenesReused,
      setupMilli,
      perUnitMilli: perSceneMilli,
      parts: {
        framesMilli: framesQuote.milli,
        audioMilli: audioQuote.milli,
        animationSetupMilli: setupMilli,
        animationScenesMilli: Math.max(0, animCodeMilli - setupMilli),
        animationTotalMilli: animCodeMilli
      }
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });

  return {
    ...quote,
    framesQuote,
    audioQuote,
    animationCodeQuote,
    scenesToAuthor,
    scenesReused,
    isPlate,
    isFrameMotion
  };
}

export async function quotePlateDrawStep(input: {
  userId: string;
  project: VideoProject;
  extraAspects?: Aspect[];
  stage?: "plate_draw" | "plate_aspect";
  tier?: AnimationTier;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView & { toAuthor: { index: number; aspect: Aspect; signature: string }[] }> {
  const now = input.now ?? new Date();
  const brief = input.project.brief;
  const beats = brief?.scriptBeats ?? [];
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = input.tier ?? resolveProjectAnimationTier(input.project, brief);
  const sched = stepTariffsAt(now);
  const spec = ANIMATION_TIER_SPECS[animationTier];
  const stage = input.stage ?? (input.extraAspects?.length ? "plate_aspect" : "plate_draw");

  if (!brief || !beats.length || !isPlateLook(brief.look)) {
    const emptyQuote = await createStepQuote({
      userId: input.userId,
      projectId: input.project.id,
      stage,
      pricingVersion,
      animationTier,
      workFingerprint: sha256Short(stage, "empty"),
      milli: 0,
      unitsTotal: 1,
      reusedUnits: 0,
      breakdown: {
        stage,
        pricingVersion,
        animationTier,
        model: spec.model,
        unitsTotal: 0,
        reusedUnits: 0,
        setupMilli: 0,
        perUnitMilli: sched.plateAnimationSceneMillitokens[animationTier]
      },
      persist: false,
      now
    });
    return { ...emptyQuote, toAuthor: [] };
  }

  const plan = await computeUnauthoredPlateVariants(input.project, brief, beats, input.extraAspects ?? []);
  const scenesToAuthor = plan.toAuthor.length;
  const milli =
    pricingVersion === "v2_step_tier" && scenesToAuthor > 0
      ? plateAnimationCostMillitokensV2(scenesToAuthor, animationTier, now)
      : 0;
  const setupMilli =
    pricingVersion === "v2_step_tier" && scenesToAuthor > 0
      ? sched.plateAnimationBatchSetupMillitokens[animationTier]
      : 0;
  const workFingerprint = sha256Short(
    stage,
    pricingVersion,
    animationTier,
    plan.toAuthor.map((v) => `${v.index}:${v.aspect}:${v.signature}`)
  );

  const quote = await createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage,
    pricingVersion,
    animationTier,
    workFingerprint,
    milli,
    unitsTotal: Math.max(1, scenesToAuthor),
    reusedUnits: plan.reusedCount,
    breakdown: {
      stage,
      pricingVersion,
      animationTier,
      model: spec.model,
      unitsTotal: scenesToAuthor,
      reusedUnits: plan.reusedCount,
      setupMilli,
      perUnitMilli: sched.plateAnimationSceneMillitokens[animationTier]
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });
  return { ...quote, toAuthor: plan.toAuthor };
}

export async function quotePlateFixStep(input: {
  userId: string;
  project: VideoProject;
  tier?: AnimationTier;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView & { newGenSceneCount: number; coalescedCount: number }> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = input.tier ?? resolveProjectAnimationTier(input.project, input.project.brief);
  const sched = stepTariffsAt(now);
  const spec = ANIMATION_TIER_SPECS[animationTier];

  const [stored, variants] = await Promise.all([
    readProjectState(input.project.id),
    listVariants(input.project.id)
  ]);
  const comments = (stored.comments as (PlateComment & { fixing?: number })[]).filter(
    (c) => c.fixing === undefined
  );
  const targets = [...new Set(comments.map((c) => c.scene))].filter((i) =>
    variants.some((v) => v.scene_index === i)
  );

  let newGenVariants = 0;
  let coalescedOrDeduped = 0;
  const fpParts: string[] = [];

  for (const sceneIdx of targets) {
    const notes = comments
      .filter((c) => c.scene === sceneIdx)
      .map((c) => `- at ${c.sceneAt.toFixed(1)} s: ${c.body}`)
      .join("\n");
    const sceneRows = variants.filter(
      (v) =>
        v.scene_index === sceneIdx &&
        ["drawn", "checked", "failed", "bundled", "queued", "authoring"].includes(v.state)
    );
    for (const row of sceneRows) {
      const dec = decideRevisionApply(row, notes, { now: now.getTime() });
      if (dec.action === "new_generation") {
        newGenVariants += 1;
        fpParts.push(`${row.id}:g${dec.gen}:r${dec.rev}:${dec.dedupeHash}`);
      } else {
        coalescedOrDeduped += 1;
      }
    }
  }

  const milli =
    pricingVersion === "v2_step_tier" && newGenVariants > 0
      ? plateAnimationCostMillitokensV2(newGenVariants, animationTier, now)
      : 0;
  const setupMilli =
    pricingVersion === "v2_step_tier" && newGenVariants > 0
      ? sched.plateAnimationBatchSetupMillitokens[animationTier]
      : 0;
  const workFingerprint = sha256Short("plate_fix", pricingVersion, animationTier, fpParts);

  const quote = await createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "plate_fix",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli,
    unitsTotal: Math.max(1, newGenVariants),
    reusedUnits: coalescedOrDeduped,
    breakdown: {
      stage: "plate_fix",
      pricingVersion,
      animationTier,
      model: spec.model,
      unitsTotal: newGenVariants,
      reusedUnits: coalescedOrDeduped,
      setupMilli,
      perUnitMilli: sched.plateAnimationSceneMillitokens[animationTier]
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });

  return { ...quote, newGenSceneCount: newGenVariants, coalescedCount: coalescedOrDeduped };
}

export async function quoteRenderExportStep(input: {
  userId: string;
  project: VideoProject;
  persist?: boolean;
  now?: Date;
}): Promise<{
  quote: StepQuoteView | null;
  seconds: number | null;
  exportMilli: number | null;
  remainingGenerationMilli: number;
  alreadyPaidMilli: number;
  totalRenderMilli: number | null;
  pricingVersion: BillingPolicyVersion;
  animationTier: AnimationTier;
}> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.project.brief);
  const readiness = planReadiness(input.project);
  const seconds = readiness.durationSeconds === null ? null : Math.max(1, Math.ceil(readiness.durationSeconds));

  if (pricingVersion !== "v2_step_tier") {
    const v1Milli = seconds === null ? null : renderCostMillitokens(seconds);
    return {
      quote: null,
      seconds,
      exportMilli: v1Milli,
      remainingGenerationMilli: 0,
      alreadyPaidMilli: 0,
      totalRenderMilli: v1Milli,
      pricingVersion: "v1_render_only",
      animationTier
    };
  }

  const alreadyPaidMilli = await projectPaidStepMillitokens(input.project.id, input.userId);
  const exportMilli = seconds === null ? null : renderExportCostMillitokensV2(seconds, now);

  // Check if any plate scenes or pending comments (or uncached non-plate frame-motion scenes) would still be authored at Render
  let remainingGenerationMilli = 0;
  if (input.project.brief && isPlateLook(input.project.brief.look) && (input.project.brief.scriptBeats?.length ?? 0) > 0) {
    const [drawQ, fixQ] = await Promise.all([
      quotePlateDrawStep({ userId: input.userId, project: input.project, tier: animationTier, persist: false, now }),
      quotePlateFixStep({ userId: input.userId, project: input.project, tier: animationTier, persist: false, now })
    ]);
    remainingGenerationMilli = drawQ.milli + fixQ.milli;
  } else {
    const timing = projectTiming(input.project);
    const frames = timing ? filmFrames(input.project, timing) : null;
    if (timing && frames) {
      const scenes = filmScenes(input.project, timing, frames);
      const cached = new Map((input.project.filmMotion ?? []).map((e) => [e.signature, e]));
      const uncached = scenes.filter((s) => !cached.has(motionSignature(s)));
      if (uncached.length > 0) {
        remainingGenerationMilli = frameMotionCostMillitokensV2(uncached.length, animationTier, now);
      }
    }
  }

  const totalRenderMilli = exportMilli === null ? null : exportMilli + remainingGenerationMilli;
  const sched = stepTariffsAt(now);
  const quote =
    totalRenderMilli === null
      ? null
      : await createStepQuote({
          userId: input.userId,
          projectId: input.project.id,
          stage: "render_export",
          pricingVersion,
          animationTier,
          workFingerprint: sha256Short("render_export", pricingVersion, animationTier, seconds, remainingGenerationMilli),
          milli: totalRenderMilli,
          unitsTotal: seconds ?? 1,
          reusedUnits: 0,
          breakdown: {
            stage: "render_export",
            pricingVersion,
            animationTier,
            model: "worker-ffmpeg",
            unitsTotal: seconds ?? 1,
            reusedUnits: 0,
            setupMilli: sched.renderExportStartMillitokens + remainingGenerationMilli,
            perUnitMilli: sched.renderExportPerSecondMillitokens,
            parts: {
              exportStartMilli: sched.renderExportStartMillitokens,
              exportPerSecondMilli: sched.renderExportPerSecondMillitokens,
              exportTotalMilli: exportMilli ?? 0,
              remainingGenerationMilli,
              alreadyPaidMilli
            }
          },
          ...(input.persist !== undefined ? { persist: input.persist } : {}),
          now
        });

  return {
    quote,
    seconds,
    exportMilli,
    remainingGenerationMilli,
    alreadyPaidMilli,
    totalRenderMilli,
    pricingVersion,
    animationTier
  };
}

export async function quoteElementEditStep(input: {
  userId: string;
  project: VideoProject;
  modelCommentCount: number;
  ruleCommentCount?: number;
  commentFingerprints?: string[];
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.project.brief);
  const sched = stepTariffsAt(now);
  const modelCount = Math.max(0, Math.floor(input.modelCommentCount));
  const ruleCount = Math.max(0, Math.floor(input.ruleCommentCount ?? 0));
  const milli =
    pricingVersion === "v2_step_tier" && modelCount > 0
      ? modelCount * sched.elementEditModelMillitokens
      : 0;
  const workFingerprint = sha256Short(
    "element_edit",
    pricingVersion,
    modelCount,
    input.commentFingerprints ?? [],
    now.toISOString().slice(0, 16)
  );
  return createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "element_edit",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli,
    unitsTotal: Math.max(1, modelCount),
    reusedUnits: ruleCount,
    breakdown: {
      stage: "element_edit",
      pricingVersion,
      animationTier,
      model: "gemini-4-argon",
      unitsTotal: modelCount,
      reusedUnits: ruleCount,
      setupMilli: 0,
      perUnitMilli: sched.elementEditModelMillitokens
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });
}

export async function quoteProAssistStep(input: {
  userId: string;
  project: VideoProject;
  task: string;
  target: string;
  stage?: string;
  persist?: boolean;
  now?: Date;
}): Promise<StepQuoteView> {
  const now = input.now ?? new Date();
  const pricingVersion = effectiveBillingPolicyVersion(input.project);
  const animationTier = resolveProjectAnimationTier(input.project, input.project.brief);
  const sched = stepTariffsAt(now);
  const milli = pricingVersion === "v2_step_tier" ? sched.proAssistMillitokens : 0;
  const workFingerprint = sha256Short(
    "pro_assist",
    pricingVersion,
    input.task,
    input.target,
    input.stage ?? "design",
    now.toISOString().slice(0, 16)
  );
  return createStepQuote({
    userId: input.userId,
    projectId: input.project.id,
    stage: "pro_assist",
    pricingVersion,
    animationTier,
    workFingerprint,
    milli,
    unitsTotal: 1,
    reusedUnits: 0,
    breakdown: {
      stage: "pro_assist",
      pricingVersion,
      animationTier,
      model: "gemini-3.8-flash",
      unitsTotal: 1,
      reusedUnits: 0,
      setupMilli: 0,
      perUnitMilli: sched.proAssistMillitokens
    },
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    now
  });
}

export type ProjectBillingOverview = {
  projectId: string;
  pricingVersion: BillingPolicyVersion;
  planTier: PlanTier;
  animationTier: AnimationTier;
  canUsePremium: boolean;
  premiumLockedCopy: string;
  balance: number;
  alreadyPaidTokens: number;
  steps: {
    scriptWrite: StepQuoteView;
    scriptEditBeat: StepQuoteView;
    storyboardPlan: StepQuoteView;
    frameSketch: StepQuoteView & { uncachedIndices: number[] };
    voiceMusic: StepQuoteView & { uncachedVoiceIndices: number[]; needsMusic: boolean };
    animation: StepQuoteView & { scenesToAuthor: number; scenesReused: number };
    animationRecreate: StepQuoteView & { scenesToAuthor: number; scenesReused: number };
    renderExport: {
      seconds: number | null;
      tokens: number | null;
      exportTokens: number | null;
      remainingGenerationTokens: number;
      alreadyPaidTokens: number;
      quoteId: string | null;
    };
  };
  tiers: {
    standard: {
      spec: typeof ANIMATION_TIER_SPECS.standard;
      available: boolean;
      animationQuoteTokens: number;
      wholeFilmEstimate: WholeFilmEstimateV2;
    };
    premium: {
      spec: typeof ANIMATION_TIER_SPECS.premium;
      available: boolean;
      lockedCopy: string;
      animationQuoteTokens: number;
      wholeFilmEstimate: WholeFilmEstimateV2;
    };
  };
};

export async function buildProjectBillingOverview(input: {
  userId: string;
  project: VideoProject;
  briefOverride?: ScriptBrief;
  beatsOverride?: ScriptBeat[];
  tierOverride?: AnimationTier;
  now?: Date;
}): Promise<ProjectBillingOverview> {
  const now = input.now ?? new Date();
  await reconcileExpiredStepReservations(input.project.id, now).catch(() => undefined);

  const brief: ScriptBrief = input.briefOverride ??
    input.project.brief ?? {
      scriptMode: "problem",
      text: input.project.request.prompt || "Product explainer video",
      durationSeconds: 30,
      durationMode: "script",
      aspect: "16:9",
      motionProfile: "smooth",
      pace: "balanced",
      audio: { mode: "voiceover", voice: "Kore" },
      captions: "full",
      template: null,
      theme: "neutral"
    };
  const beats: ScriptBeat[] =
    input.beatsOverride ??
    brief.scriptBeats ??
    input.project.brief?.scriptBeats ??
    (input.project.beatPlan?.beats ?? []).map((b) => ({
      id: b.id,
      keyword: b.keyword,
      visual: null,
      onScreen: b.on_screen ?? null,
      line: b.line ?? null
    }));

  const [planTier, tokSum, alreadyPaidMilli] = await Promise.all([
    tierFor(input.userId, now),
    tokenSummary(input.userId, 5, now),
    projectPaidStepMillitokens(input.project.id, input.userId)
  ]);

  const canUsePremium = canUseAnimationTier(planTier, "premium");
  const requestedTier = input.tierOverride ?? resolveProjectAnimationTier(input.project, brief);
  const effectiveTier: AnimationTier = requestedTier === "premium" && !canUsePremium ? "standard" : requestedTier;
  const pricingVersion = effectiveBillingPolicyVersion(input.project);

  const [
    scriptWrite,
    scriptEditBeat,
    storyboardPlan,
    frameSketch,
    voiceMusic,
    animStandard,
    animPremium,
    animRecreate,
    renderExport
  ] = await Promise.all([
    quoteScriptStep({ userId: input.userId, project: input.project, brief, persist: true, now }),
    quoteScriptStep({
      userId: input.userId,
      project: input.project,
      brief,
      isSingleBeatRewrite: true,
      persist: false,
      now
    }),
    quoteStoryboardPlanStep({ userId: input.userId, project: input.project, brief, persist: true, now }),
    quoteFrameSketchStep({
      userId: input.userId,
      project: input.project,
      brief,
      beats,
      persist: true,
      now
    }),
    quoteVoiceMusicStep({
      userId: input.userId,
      project: input.project,
      brief,
      beats,
      persist: true,
      now
    }),
    quoteAnimationStep({
      userId: input.userId,
      project: input.project,
      brief,
      beats,
      tier: "standard",
      persist: effectiveTier === "standard",
      now
    }),
    quoteAnimationStep({
      userId: input.userId,
      project: input.project,
      brief,
      beats,
      tier: "premium",
      persist: effectiveTier === "premium",
      now
    }),
    quoteAnimationStep({
      userId: input.userId,
      project: input.project,
      brief,
      beats,
      tier: effectiveTier,
      persist: false,
      recreate: true,
      now
    }),
    quoteRenderExportStep({ userId: input.userId, project: input.project, persist: true, now })
  ]);

  const activeAnimQuote = effectiveTier === "premium" ? animPremium : animStandard;
  const estScenes = beats.length > 0 ? beats.length : Math.max(3, Math.round((brief.durationSeconds || 30) / 5));
  const estDuration = effectiveBriefDurationSeconds(brief, beats.length > 0 ? beats : undefined);
  const voicedCount =
    brief.audio.mode === "voiceover" || brief.audio.mode === "both"
      ? beats.length > 0
        ? beats.filter((b) => Boolean(voiceText(b.line))).length
        : estScenes
      : 0;
  const hasMusic = brief.audio.mode === "music" || brief.audio.mode === "both";
  const isPlate = isPlateLook(brief.look);
  const isFrameMotion = !isPlate;

  const stdWhole = estimateWholeFilmQuoteV2({
    scenes: estScenes,
    durationSeconds: estDuration,
    voicedScenes: voicedCount,
    music: hasMusic,
    isPlateStyle: isPlate,
    isFrameMotionStyle: isFrameMotion,
    tier: "standard",
    now
  });
  const premWhole = estimateWholeFilmQuoteV2({
    scenes: estScenes,
    durationSeconds: estDuration,
    voicedScenes: voicedCount,
    music: hasMusic,
    isPlateStyle: isPlate,
    isFrameMotionStyle: isFrameMotion,
    tier: "premium",
    now
  });

  return {
    projectId: input.project.id,
    pricingVersion,
    planTier,
    animationTier: effectiveTier,
    canUsePremium,
    premiumLockedCopy: PREMIUM_LOCKED_COPY,
    balance: tokSum.remaining,
    alreadyPaidTokens: tokensFromMilli(alreadyPaidMilli),
    steps: {
      scriptWrite,
      scriptEditBeat,
      storyboardPlan,
      frameSketch,
      voiceMusic,
      animation: activeAnimQuote,
      /** What Recreate animation costs: every scene authored again, whatever is cached. */
      animationRecreate: animRecreate,
      renderExport: {
        seconds: renderExport.seconds,
        tokens: renderExport.totalRenderMilli === null ? null : tokensFromMilli(renderExport.totalRenderMilli),
        exportTokens: renderExport.exportMilli === null ? null : tokensFromMilli(renderExport.exportMilli),
        remainingGenerationTokens: tokensFromMilli(renderExport.remainingGenerationMilli),
        alreadyPaidTokens: tokensFromMilli(renderExport.alreadyPaidMilli),
        quoteId: renderExport.quote?.quoteId ?? null
      }
    },
    tiers: {
      standard: {
        spec: ANIMATION_TIER_SPECS.standard,
        available: true,
        animationQuoteTokens: animStandard.tokens,
        wholeFilmEstimate: stdWhole
      },
      premium: {
        spec: ANIMATION_TIER_SPECS.premium,
        available: canUsePremium,
        lockedCopy: PREMIUM_LOCKED_COPY,
        animationQuoteTokens: animPremium.tokens,
        wholeFilmEstimate: premWhole
      }
    }
  };
}

export function registerStepBillingRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { tier?: string } }>(
    "/v1/projects/:id/billing/quote",
    async (request, reply) => {
      const project = await getProject(request.params.id);
      if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
      const userId = callerId(request);
      const tierParam = isAnimationTier(request.query.tier) ? request.query.tier : undefined;
      return reply
        .header("Cache-Control", "no-store")
        .send(await buildProjectBillingOverview({ userId, project, ...(tierParam ? { tierOverride: tierParam } : {}) }));
    }
  );

  app.post<{
    Params: { id: string };
    Body: { brief?: unknown; beats?: unknown; animationTier?: unknown };
  }>("/v1/projects/:id/billing/quote", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    const userId = callerId(request);
    const rawBrief =
      request.body?.brief && typeof request.body.brief === "object" && !Array.isArray(request.body.brief)
        ? {
            ...(request.body.brief as Record<string, unknown>),
            text:
              typeof (request.body.brief as { text?: unknown }).text === "string" &&
              (request.body.brief as { text: string }).text.trim().length >= 10
                ? (request.body.brief as { text: string }).text
                : project.request.prompt || "Product explainer video"
          }
        : request.body?.brief;
    const parsedBrief = rawBrief ? parseScriptBrief(rawBrief) : null;
    const briefOverride = parsedBrief && !("error" in parsedBrief) ? parsedBrief.brief : undefined;
    const beatsOverride = parseScriptBeats(request.body?.beats) ?? undefined;
    const tierOverride = isAnimationTier(request.body?.animationTier) ? request.body.animationTier : undefined;
    return reply.header("Cache-Control", "no-store").send(
      await buildProjectBillingOverview({
        userId,
        project,
        ...(briefOverride ? { briefOverride } : {}),
        ...(beatsOverride ? { beatsOverride } : {}),
        ...(tierOverride ? { tierOverride } : {})
      })
    );
  });
}
