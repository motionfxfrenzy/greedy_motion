import type { FastifyInstance, FastifyRequest } from "fastify";
import { callerId } from "../auth.ts";
import { getProject } from "../projects/store.ts";
import { planReadiness, type Readiness } from "../plan/readiness.ts";
import { visualStatus } from "../plan/visual-state.ts";
import {
  MILLITOKENS_PER_SECOND,
  START_FEE_MILLITOKENS,
  renderCostMillitokens,
  renderExportCostMillitokensV2,
  stepTariffsAt,
  tokensFromMilli,
  type AnimationTier,
  type BillingPolicyVersion
} from "../tokens/plan.ts";
import { quoteRenderExportStep } from "../billing/step-billing.ts";
import { tokenSummary } from "../tokens/store.ts";
import { clearProjectIdempotencyKey, renderJobRepository, setProjectIdempotencyKey } from "./repository.ts";

/**
 * What the final render of a film costs, worked out once on the server from the saved storyboard and shown by the page as it is:
 * the same duration (the voiceover's measured length) and the same function (renderCostMillitokens in v1_render_only, or
 * renderExportCostMillitokensV2 + remaining unpaid generation in v2_step_tier) the render charges with, so the price on the
 * button is the price taken. Generated scenes and already-paid step charges are shown beside it.
 */
export type RenderQuote = {
  /** The film's length in whole seconds as it will be charged (each started second counts), or null before the storyboard exists. */
  seconds: number | null;
  /** Tokens the render takes, or null before the storyboard exists. */
  tokens: number | null;
  parts: { start: number; perSecond: number; seconds: number | null };
  /** The storyboard passes every render check. When false the render is refused (409), whatever the price. */
  ready: boolean;
  material: { required: boolean; owedTokens: number };
  balance: number;
  enough: boolean;
  pricingVersion?: BillingPolicyVersion;
  animationTier?: AnimationTier;
  exportTokens?: number | null;
  remainingGenerationTokens?: number;
  alreadyPaidTokens?: number;
  quoteId?: string | null;
};

export function quoteFrom(
  readiness: Pick<Readiness, "ok" | "durationSeconds">,
  material: { required: boolean; owedTokens: number },
  balance: number,
  options?: {
    pricingVersion?: BillingPolicyVersion;
    animationTier?: AnimationTier;
    remainingGenerationMilli?: number;
    alreadyPaidMilli?: number;
    quoteId?: string | null;
    now?: Date;
  }
): RenderQuote {
  const seconds = readiness.durationSeconds === null ? null : Math.max(1, Math.ceil(readiness.durationSeconds));
  const pricingVersion = options?.pricingVersion ?? "v1_render_only";
  if (pricingVersion === "v2_step_tier") {
    const sched = stepTariffsAt(options?.now);
    const exportMilli = seconds === null ? null : renderExportCostMillitokensV2(seconds, options?.now);
    const remainingGenMilli = Math.max(0, options?.remainingGenerationMilli ?? 0);
    const alreadyPaidMilli = Math.max(0, options?.alreadyPaidMilli ?? 0);
    const totalMilli = exportMilli === null ? null : exportMilli + remainingGenMilli;
    const tokens = totalMilli === null ? null : tokensFromMilli(totalMilli);
    return {
      seconds,
      tokens,
      parts: {
        start: sched.renderExportStartMillitokens / 1000,
        perSecond: sched.renderExportPerSecondMillitokens / 1000,
        seconds
      },
      ready: readiness.ok,
      material,
      balance,
      enough: tokens !== null && balance >= tokens,
      pricingVersion: "v2_step_tier",
      ...(options?.animationTier ? { animationTier: options.animationTier } : {}),
      exportTokens: exportMilli === null ? null : tokensFromMilli(exportMilli),
      remainingGenerationTokens: tokensFromMilli(remainingGenMilli),
      alreadyPaidTokens: tokensFromMilli(alreadyPaidMilli),
      quoteId: options?.quoteId ?? null
    };
  }
  const tokens = seconds === null ? null : tokensFromMilli(renderCostMillitokens(seconds));
  return {
    seconds,
    tokens,
    parts: { start: START_FEE_MILLITOKENS / 1000, perSecond: MILLITOKENS_PER_SECOND / 1000, seconds },
    ready: readiness.ok,
    material,
    balance,
    enough: tokens !== null && balance >= tokens
  };
}

const RENDER_ROUTE = /^\/v1\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/render$/i;
const idempotencyLocks = new Map<string, Promise<void>>();
const requestUnlocks = new WeakMap<FastifyRequest, () => void>();

function extractIdempotencyKey(request: FastifyRequest): string | null {
  const headerVal = request.headers["idempotency-key"] ?? request.headers["x-idempotency-key"];
  const rawHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (typeof rawHeader === "string" && rawHeader.trim()) {
    return rawHeader.trim().slice(0, 128);
  }
  const body = request.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const bodyKey = (body as Record<string, unknown>).idempotencyKey;
    if (typeof bodyKey === "string" && bodyKey.trim()) {
      return bodyKey.trim().slice(0, 128);
    }
  }
  return null;
}

async function acquireIdempotencyLock(lockKey: string): Promise<() => void> {
  while (idempotencyLocks.has(lockKey)) {
    await idempotencyLocks.get(lockKey);
  }
  let release!: () => void;
  const p = new Promise<void>((resolve) => {
    release = () => {
      if (idempotencyLocks.get(lockKey) === p) {
        idempotencyLocks.delete(lockKey);
      }
      resolve();
    };
  });
  idempotencyLocks.set(lockKey, p);
  return release;
}

export function registerRenderQuote(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/projects/:id/render/quote", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    const userId = callerId(request);
    const visuals = visualStatus(project);
    const balance = (await tokenSummary(userId)).remaining;
    const renderStep = await quoteRenderExportStep({ userId, project, persist: true });
    if (renderStep.pricingVersion === "v2_step_tier") {
      return quoteFrom(
        planReadiness(project),
        { required: visuals.required, owedTokens: visuals.priceTokens },
        balance,
        {
          pricingVersion: "v2_step_tier",
          animationTier: renderStep.animationTier,
          remainingGenerationMilli: renderStep.remainingGenerationMilli,
          alreadyPaidMilli: renderStep.alreadyPaidMilli,
          quoteId: renderStep.quote?.quoteId ?? null
        }
      );
    }
    return quoteFrom(planReadiness(project), { required: visuals.required, owedTokens: visuals.priceTokens }, balance);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    let path: string;
    try {
      path = decodeURIComponent(request.url.split("?")[0]!);
    } catch {
      return;
    }
    const match = RENDER_ROUTE.exec(path);
    if (!match) return;
    const key = extractIdempotencyKey(request);
    if (!key) return;
    const projectId = match[1]!.toLowerCase();
    const release = await acquireIdempotencyLock(projectId);
    try {
      const existing = await renderJobRepository.findByIdempotencyKey(projectId, key);
      if (existing) {
        release();
        return reply.code(202).send(existing);
      }
      setProjectIdempotencyKey(projectId, key);
      requestUnlocks.set(request, () => {
        clearProjectIdempotencyKey(projectId);
        release();
      });
    } catch (error) {
      clearProjectIdempotencyKey(projectId);
      release();
      throw error;
    }
  });

  const finishIdempotency = async (request: FastifyRequest) => {
    const unlock = requestUnlocks.get(request);
    if (unlock) {
      requestUnlocks.delete(request);
      unlock();
    }
  };
  app.addHook("onSend", async (request, _reply, payload) => {
    await finishIdempotency(request);
    return payload;
  });
  app.addHook("onResponse", async (request) => {
    await finishIdempotency(request);
  });
  app.addHook("onError", async (request) => {
    await finishIdempotency(request);
  });
}
