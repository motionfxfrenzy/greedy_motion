import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { InsufficientTokens, refundSpend, spendTokens } from "../tokens/store.ts";
import { renderCostMillitokens } from "../tokens/plan.ts";

/**
 * One limit on compute every export route shares (storyboard Render, Pro renders and previews, formats, the older
 * render-jobs route): a person may have only this many films queued or running at once. It is checked before tokens are
 * taken or anything is built, so a refused request costs nothing. It counts jobs a person owns directly and jobs of their
 * projects (storyboard and Pro jobs carry only the project). The check and the insert are not one transaction, so a burst of
 * simultaneous requests can overshoot by the burst size; it bounds spend, it is not a billing ledger.
 */
export async function activeRenders(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n from app.render_jobs j
      where j.state not in ('ready', 'failed')
        and (j.owner_id = $1 or j.project_id in (select id from app.projects where owner_id = $1))`,
    [userId]
  );
  return Number(rows[0]?.n ?? 0);
}

/** The refusal to send when the person is at the limit, or null when the render may start. */
export async function busyRefusal(userId: string): Promise<{ error: { code: "too_many_renders"; message: string; active: number; limit: number } } | null> {
  const limit = config.maxActiveRenders;
  const active = await activeRenders(userId);
  if (active < limit) return null;
  return { error: { code: "too_many_renders", message: `You already have ${active} films rendering (the limit is ${limit}). Wait for one to finish, then try again.`, active, limit } };
}

/** Takes the tokens for a film of `seconds` (the same per-second rate as a storyboard film); throws InsufficientTokens. */
export function chargeRender(owner: string, seconds: number, jobId: string, projectId?: string) {
  return spendTokens(owner, renderCostMillitokens(seconds), "render", jobId, projectId);
}

/** Puts a charge back when its film could not be queued; never throws (the failure is logged, the original error matters more). */
export async function returnCharge(owner: string, spend: { charged: boolean; event: string }) {
  if (spend.charged) await refundSpend(owner, spend.event).catch((error) => console.error(JSON.stringify({ level: "error", event: "render_refund_failed", message: error instanceof Error ? error.message : String(error) })));
}

/** The 402 body for a person without enough tokens. */
export const insufficientBody = (error: InsufficientTokens) => ({ error: { code: "insufficient_tokens", message: `This film needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`, needed: error.needed, remaining: error.remaining } });
