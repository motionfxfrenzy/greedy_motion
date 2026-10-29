import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { getProject } from "../projects/store.ts";
import { planReadiness, type Readiness } from "../plan/readiness.ts";
import { visualStatus } from "../plan/visual-state.ts";
import { MILLITOKENS_PER_SECOND, START_FEE_MILLITOKENS, renderCostMillitokens, tokensFromMilli } from "../tokens/plan.ts";
import { tokenSummary } from "../tokens/store.ts";

/**
 * What the final render of a film costs, worked out once on the server from the saved storyboard and shown by the page as it is:
 * the same duration (the voiceover's measured length) and the same function (renderCostMillitokens) the render charges with, so the
 * price on the button is the price taken. Generated scenes are paid when they are generated and shown here as already known.
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
};

export function quoteFrom(readiness: Pick<Readiness, "ok" | "durationSeconds">, material: { required: boolean; owedTokens: number }, balance: number): RenderQuote {
  const seconds = readiness.durationSeconds === null ? null : Math.max(1, Math.ceil(readiness.durationSeconds));
  const tokens = seconds === null ? null : tokensFromMilli(renderCostMillitokens(seconds));
  return {
    seconds, tokens,
    parts: { start: START_FEE_MILLITOKENS / 1000, perSecond: MILLITOKENS_PER_SECOND / 1000, seconds },
    ready: readiness.ok, material, balance, enough: tokens !== null && balance >= tokens
  };
}

export function registerRenderQuote(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/projects/:id/render/quote", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    const visuals = visualStatus(project);
    const balance = (await tokenSummary(callerId(request))).remaining;
    return quoteFrom(planReadiness(project), { required: visuals.required, owedTokens: visuals.priceTokens }, balance);
  });
}
