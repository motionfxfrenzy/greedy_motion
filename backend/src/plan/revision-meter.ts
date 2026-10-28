import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { callerId, isOpen } from "../auth.ts";
import { tierFor } from "../billing/service.ts";
import { pool } from "../db/database.ts";
import { getProject } from "../projects/store.ts";
import { FREE_REVISIONS, REVISION_TOKENS, type PlanTier } from "../tokens/plan.ts";
import { InsufficientTokens, refundSpend, spendTokens } from "../tokens/store.ts";
import { meteringOn, previewPeriod } from "./preview-meter.ts";

/**
 * Revisions (docs/PRICING.md): the start fee of a film covers FREE_REVISIONS changes after it was first made; each further one
 * takes REVISION_TOKENS. A revision is rebuilding the storyboard of a film that already has one (the "Recreate preview" of an edited
 * script) or applying comments in the Preview. It is counted and charged when asked, and given back if the request fails, if a
 * comment changed nothing, or if the storyboard could not be built. Counted per person, period and project (app.preview_usage).
 */
export type RevisionToken = { userId: string; projectId: string; period: string; event: string | null; before: number };
export type RevisionInfo = { used: number; free: number; tokens: number };

const ROUTE = /^\/v1\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(plan|film\/fix)$/i;

/** Counts one revision and takes the tokens when it is beyond the free ones. Throws InsufficientTokens (nothing stays counted). */
export async function takeRevision(userId: string, projectId: string, tier: PlanTier, now = new Date()): Promise<RevisionToken> {
  const period = previewPeriod(tier, now);
  const client = await pool.connect();
  let before: number;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`preview:${userId}`]);
    await client.query("insert into app.preview_usage (user_id, period, project_id, calls, revisions) values ($1, $2, $3, 0, 0) on conflict do nothing", [userId, period, projectId]);
    const row = await client.query<{ revisions: number }>("update app.preview_usage set revisions = revisions + 1, last_at = now() where user_id = $1 and period = $2 and project_id = $3 returning revisions - 1 as revisions", [userId, period, projectId]);
    before = row.rows[0]!.revisions;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const token: RevisionToken = { userId, projectId, period, event: null, before };
  if (before >= FREE_REVISIONS) {
    try {
      const spend = await spendTokens(userId, REVISION_TOKENS * 1000, "revision", `${projectId}:${randomUUID()}`, projectId);
      token.event = spend.charged ? spend.event : null;
    } catch (error) {
      await undoRevision(token);
      throw error;
    }
  }
  return token;
}

/** Gives a revision back: the count, and the tokens if any were taken. Never throws. */
export async function undoRevision(token: RevisionToken) {
  await pool.query("update app.preview_usage set revisions = greatest(revisions - 1, 0) where user_id = $1 and period = $2 and project_id = $3", [token.userId, token.period, token.projectId]).catch(() => undefined);
  if (token.event) await refundSpend(token.userId, token.event).catch(() => undefined);
}

export async function revisionInfo(userId: string, projectId: string, tier: PlanTier, now = new Date()): Promise<RevisionInfo> {
  const { rows } = await pool.query<{ revisions: number }>("select revisions from app.preview_usage where user_id = $1 and period = $2 and project_id = $3", [userId, previewPeriod(tier, now), projectId]);
  return { used: rows[0]?.revisions ?? 0, free: FREE_REVISIONS, tokens: REVISION_TOKENS };
}

// A storyboard rebuild answers 202 and runs in the background; its revision stays pending until the build succeeds or fails.
const rebuilding = new Map<string, RevisionToken>();
/** The storyboard was built: the revision stands. */
export const settleRevision = (projectId: string) => { rebuilding.delete(projectId); };
/** The storyboard could not be built (or was cancelled): the revision is given back. */
export function failRevision(projectId: string) {
  const token = rebuilding.get(projectId);
  rebuilding.delete(projectId);
  return token ? undoRevision(token) : Promise.resolve();
}

const pending = new WeakMap<FastifyRequest, { token: RevisionToken; route: "plan" | "film/fix" }>();

export function registerRevisionMeter(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/projects/:id/revisions", async (request) => revisionInfo(callerId(request), request.params.id, await tierFor(callerId(request))));

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST" || !meteringOn() || isOpen(request)) return;
    let path: string;
    try { path = decodeURIComponent(request.url.split("?")[0]); } catch { return; }
    const match = ROUTE.exec(path);
    if (!match) return;
    const projectId = match[1]!.toLowerCase();
    const route = match[2]!.toLowerCase() as "plan" | "film/fix";
    // The first storyboard of a film is its making, covered by the start fee; only a rebuild is a revision.
    if (route === "plan" && !(await getProject(projectId))?.beatPlan) return;
    const userId = callerId(request);
    try {
      const token = await takeRevision(userId, projectId, await tierFor(userId));
      pending.set(request, { token, route });
    } catch (error) {
      if (error instanceof InsufficientTokens) {
        return reply.code(402).send({ error: { code: "insufficient_tokens", message: `This change takes ${REVISION_TOKENS} tokens (the first ${FREE_REVISIONS} changes to a film are included) and you have ${error.remaining}. Add tokens or choose a plan.`, needed: REVISION_TOKENS, remaining: error.remaining } });
      }
      throw error;
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const entry = pending.get(request);
    if (!entry) return payload;
    pending.delete(request);
    const { token, route } = entry;
    if (reply.statusCode >= 400) { await undoRevision(token); return payload; }
    if (route === "plan") { rebuilding.set(token.projectId, token); return payload; }
    // Comments applied in the Preview: counted only if something changed.
    try {
      const body = JSON.parse(typeof payload === "string" ? payload : String(payload)) as { changed?: unknown[] };
      if (!Array.isArray(body.changed) || body.changed.length === 0) { await undoRevision(token); return payload; }
      return JSON.stringify({ ...body, revision: { used: token.before + 1, free: FREE_REVISIONS, tokens: REVISION_TOKENS, charged: token.event !== null } });
    } catch {
      await undoRevision(token);
      return payload;
    }
  });
}
