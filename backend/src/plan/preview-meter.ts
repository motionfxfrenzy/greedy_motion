import type { FastifyInstance } from "fastify";
import { callerId, isOpen } from "../auth.ts";
import { tierFor } from "../billing/service.ts";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { PLANS, PREVIEW_ALLOWANCE, PREVIEW_CALL_CAP, type PlanTier } from "../tokens/plan.ts";

/**
 * The preview allowance (docs/PRICING.md). A film's storyboard, voice, motion and fixes cost about $0.79 in model calls before
 * anything is rendered, so each plan may work on a number of films per period: Free once for the account ("lifetime"), paid plans
 * per calendar month (UTC). All the work on one project counts once; `calls` caps how much one project may use in a period.
 * Counted: the stages that call a model for a film. Reading, comments, the intent reader and the final render are not counted
 * (the render takes tokens).
 */
const COUNTED = /^\/v1\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:script\/stream|script\/frames|plan|plan\/audio|film\/animate|film\/fix|plan\/beats\/[^/]+\/rewrite)$/i;

export type PreviewRefusal = { error: { code: "preview_limit" | "preview_call_cap"; message: string; tier: PlanTier; used?: number; limit: number } };

export const previewPeriod = (tier: PlanTier, now = new Date()) => (tier === "free" ? "lifetime" : now.toISOString().slice(0, 7));

const nextTier = (tier: PlanTier): PlanTier | null => (tier === "free" ? "starter" : tier === "starter" ? "pro" : tier === "pro" ? "business" : null);

/** Counts this call for the project, or returns the refusal to send. Serialised per person so two requests cannot both take the last place. */
export async function admitPreview(userId: string, projectId: string, tier: PlanTier, now = new Date()): Promise<PreviewRefusal | null> {
  const period = previewPeriod(tier, now);
  const limit = PREVIEW_ALLOWANCE[tier];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`preview:${userId}`]);
    const known = await client.query<{ calls: number }>("select calls from app.preview_usage where user_id = $1 and period = $2 and project_id = $3", [userId, period, projectId]);
    if (known.rows[0]) {
      if (known.rows[0].calls >= PREVIEW_CALL_CAP) { await client.query("rollback"); return { error: { code: "preview_call_cap", message: "This film has used a very large number of changes this period. Start a new film, or try again next month.", tier, limit: PREVIEW_CALL_CAP } }; }
      await client.query("update app.preview_usage set calls = calls + 1, last_at = now() where user_id = $1 and period = $2 and project_id = $3", [userId, period, projectId]);
      await client.query("commit");
      return null;
    }
    const used = Number((await client.query<{ n: string }>("select count(*) as n from app.preview_usage where user_id = $1 and period = $2", [userId, period])).rows[0]?.n ?? 0);
    if (used >= limit) {
      await client.query("rollback");
      const up = nextTier(tier);
      const message = tier === "free"
        ? `You have made your ${limit} free previews. Choose a plan to make more films.`
        : `You have worked on ${limit} films this month on the ${PLANS[tier].name} plan. It resets on the 1st${up ? `; ${PLANS[up].name} allows ${PREVIEW_ALLOWANCE[up]} a month` : ""}.`;
      return { error: { code: "preview_limit", message, tier, used, limit } };
    }
    await client.query("insert into app.preview_usage (user_id, period, project_id) values ($1, $2, $3)", [userId, period, projectId]);
    await client.query("commit");
    return null;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** How many films the person has worked on this period, for the profile page and tests. */
export async function previewsUsed(userId: string, tier: PlanTier, now = new Date()): Promise<number> {
  const { rows } = await pool.query<{ n: string }>("select count(*) as n from app.preview_usage where user_id = $1 and period = $2", [userId, previewPeriod(tier, now)]);
  return Number(rows[0]?.n ?? 0);
}

/** On by default wherever real people use it; off for local development unless PREVIEW_LIMITS=on. */
const enabled = () => (process.env.PREVIEW_LIMITS ? process.env.PREVIEW_LIMITS === "on" : config.appEnv !== "local");

export function registerPreviewMeter(app: FastifyInstance) {
  /** What the profile shows: films worked on this period against the plan's allowance. */
  app.get("/v1/me/previews", async (request) => {
    const userId = callerId(request);
    const tier = await tierFor(userId);
    return { tier, period: previewPeriod(tier), used: await previewsUsed(userId, tier), limit: PREVIEW_ALLOWANCE[tier] };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST" || !enabled() || isOpen(request)) return;
    let path: string;
    try { path = decodeURIComponent(request.url.split("?")[0]); } catch { return; }
    const match = COUNTED.exec(path);
    if (!match) return;
    const userId = callerId(request);
    const refusal = await admitPreview(userId, match[1]!.toLowerCase(), await tierFor(userId));
    if (refusal) return reply.code(402).send(refusal);
  });
}
