// Reads and writes app.token_ledger. A balance is always computed from the rows, never stored. Amounts are stored in
// millitokens (1 token = 1000) and returned to callers in tokens.
//
// Three pools: `plan` tokens come with a subscription and reset every month (what is left at renewal expires, then the
// full allowance is granted again); `free` is the one-time 30-second allowance; `pack` is bought packs and manual grants.
// Neither free nor pack expire. A render spends plan tokens first (they expire soonest), then free, then packs.
import { FREE_TOKENS_REF, PLANS, tokensFromMilli } from "./plan.ts";
import { query, withTransaction } from "../db/database.ts";

export type Pool = "plan" | "free" | "pack";
const SPEND_ORDER: Pool[] = ["plan", "free", "pack"];

export type TokenEntry = { id: number; amount: number; kind: string; reason: string; pool: Pool; projectId: string | null; createdAt: string };
export type PoolView = { granted: number; used: number; remaining: number };
export type TokenSummary = {
  /** Everything that can be spent now, in tokens. */
  remaining: number;
  /** This month's plan allowance: null when the user has no paid plan. `used` counts only since the last renewal, so it starts again at zero. */
  plan: (PoolView & { since: string }) | null;
  /** The one-time free allowance (30 seconds of video). */
  free: PoolView;
  /** Bought packs and manual grants; they do not expire. */
  packs: { remaining: number };
  recent: TokenEntry[];
};

/** Thrown when a render costs more than the balance. Carries the numbers the interface shows. */
export class InsufficientTokens extends Error {
  needed: number;
  remaining: number;
  constructor(neededMilli: number, remainingMilli: number) {
    super("Not enough tokens for this film.");
    this.needed = tokensFromMilli(neededMilli);
    this.remaining = tokensFromMilli(Math.max(remainingMilli, 0));
  }
}

const FREE_MILLI = Math.round(PLANS.free.tokens * 1000);

/** Gives every account its one-time free allowance (30 seconds of video). Idempotent: the reference is unique per user. */
export async function ensureFreeAllowance(userId: string): Promise<void> {
  await query(
    "insert into app.token_ledger (user_id, amount, kind, reason, ref, actor, pool) values ($1, $2, 'grant', 'Free allowance', $3, 'system', 'free') on conflict (user_id, ref) where ref is not null do nothing",
    [userId, FREE_MILLI, FREE_TOKENS_REF]
  );
}

/** What each pool holds, in millitokens. A pool a refund pushed below zero counts as empty. */
async function poolBalances(userId: string): Promise<Record<Pool, number>> {
  const { rows } = await query<{ pool: Pool; balance: string }>("select pool, coalesce(sum(amount), 0) as balance from app.token_ledger where user_id = $1 group by pool", [userId]);
  const out: Record<Pool, number> = { plan: 0, free: 0, pack: 0 };
  for (const row of rows) out[row.pool] = Math.max(0, Number(row.balance));
  return out;
}

/**
 * Takes `milli` millitokens for one event, or throws InsufficientTokens. The balance is checked and the spend written
 * under a per-user lock, so two renders started together cannot both spend the last tokens. `ref` names the event; the
 * same event twice is stored once and returns `{ charged: false }`. The returned `event` is what `refundSpend` takes.
 */
export async function spendTokens(userId: string, milli: number, reason: string, ref: string, projectId?: string): Promise<{ charged: boolean; event: string }> {
  await ensureFreeAllowance(userId);
  const event = `${reason}:${ref}`;
  return withTransaction(async () => {
    await query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`tokens:${userId}`]);
    const existing = await query("select 1 from app.token_ledger where user_id = $1 and ref like $2", [userId, `${event}|%`]);
    if (existing.rows[0]) return { charged: false, event };
    const have = await poolBalances(userId);
    const total = have.plan + have.free + have.pack;
    if (total < milli) throw new InsufficientTokens(milli, total);
    let left = milli;
    for (const pool of SPEND_ORDER) {
      const take = Math.min(left, have[pool]);
      if (take <= 0) continue;
      await query("insert into app.token_ledger (user_id, amount, kind, reason, project_id, ref, pool) values ($1, $2, 'spend', $3, $4, $5, $6)", [userId, -take, reason, projectId ?? null, `${event}|${pool}`, pool]);
      left -= take;
    }
    return { charged: true, event };
  });
}

/** Puts back what a spend took, from the pools it took it from, when the work it paid for could not start. Once per spend. */
export async function refundSpend(userId: string, event: string): Promise<void> {
  await query(
    `insert into app.token_ledger (user_id, amount, kind, reason, project_id, ref, pool)
     select user_id, -amount, 'refund', reason, project_id, 'refund:' || ref, pool from app.token_ledger where user_id = $1 and kind = 'spend' and ref like $2
     on conflict (user_id, ref) where ref is not null do nothing`,
    [userId, `${event}|%`]
  );
}

/** Adds tokens to a pool. `ref` makes the grant idempotent (an invoice or order id); omit it for a manual grant. */
export async function grantTokens(userId: string, tokens: number, note: string, actor: string, ref?: string, pool: Pool = "pack"): Promise<boolean> {
  const milli = Math.round(tokens * 1000);
  if (!Number.isInteger(milli) || milli <= 0) throw new Error("A grant is a number of tokens above zero.");
  const { rowCount } = await query(
    "insert into app.token_ledger (user_id, amount, kind, reason, ref, actor, pool) values ($1, $2, 'grant', $3, $4, $5, $6) on conflict (user_id, ref) where ref is not null do nothing",
    [userId, milli, note || "grant", ref ?? null, actor, pool]
  );
  return rowCount === 1;
}

/**
 * Ends the month's plan tokens: whatever is left of them is written off. Called at renewal just before the new
 * allowance is granted, and when a subscription ends. Idempotent per `ref`, and a no-op when nothing is left.
 */
export async function expirePlanTokens(userId: string, ref: string, reason = "Unused plan tokens expired"): Promise<number> {
  return withTransaction(async () => {
    await query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`tokens:${userId}`]);
    const left = (await poolBalances(userId)).plan;
    if (left <= 0) return 0;
    const { rowCount } = await query("insert into app.token_ledger (user_id, amount, kind, reason, ref, actor, pool) values ($1, $2, 'expiry', $3, $4, 'system', 'plan') on conflict (user_id, ref) where ref is not null do nothing", [userId, -left, reason, ref]);
    return rowCount === 1 ? tokensFromMilli(left) : 0;
  });
}

export async function tokenSummary(userId: string, recentLimit = 20): Promise<TokenSummary> {
  await ensureFreeAllowance(userId);
  const have = await poolBalances(userId);
  const free = await query<{ granted: string; used: string }>(
    "select coalesce(sum(amount) filter (where kind = 'grant'), 0) as granted, coalesce(-sum(amount) filter (where kind in ('spend', 'refund')), 0) as used from app.token_ledger where user_id = $1 and pool = 'free'",
    [userId]
  );
  // The plan meter covers the current month only: from the latest plan grant on. A new renewal moves that line forward, so usage starts at zero.
  const latest = await query<{ amount: number; created_at: Date; id: string }>("select id, amount, created_at from app.token_ledger where user_id = $1 and pool = 'plan' and kind = 'grant' order by created_at desc, id desc limit 1", [userId]);
  let plan: TokenSummary["plan"] = null;
  if (latest.rows[0]) {
    const since = latest.rows[0];
    const used = await query<{ used: string }>("select coalesce(-sum(amount), 0) as used from app.token_ledger where user_id = $1 and pool = 'plan' and kind in ('spend', 'refund') and id > $2", [userId, since.id]);
    const granted = Number(since.amount);
    const usedMilli = Math.min(granted, Number(used.rows[0]?.used ?? 0));
    plan = { granted: tokensFromMilli(granted), used: tokensFromMilli(usedMilli), remaining: tokensFromMilli(have.plan), since: since.created_at.toISOString() };
  }
  const { rows } = await query<{ id: string; amount: number; kind: string; reason: string; pool: Pool; project_id: string | null; created_at: Date }>(
    "select id, amount, kind, reason, pool, project_id, created_at from app.token_ledger where user_id = $1 order by created_at desc, id desc limit $2",
    [userId, recentLimit]
  );
  const freeGranted = Number(free.rows[0]?.granted ?? 0), freeUsed = Number(free.rows[0]?.used ?? 0);
  return {
    remaining: tokensFromMilli(have.plan + have.free + have.pack),
    plan,
    free: { granted: tokensFromMilli(freeGranted), used: tokensFromMilli(freeUsed), remaining: tokensFromMilli(have.free) },
    packs: { remaining: tokensFromMilli(have.pack) },
    recent: rows.map((r) => ({ id: Number(r.id), amount: tokensFromMilli(r.amount), kind: r.kind, reason: r.reason, pool: r.pool, projectId: r.project_id, createdAt: r.created_at.toISOString() }))
  };
}
