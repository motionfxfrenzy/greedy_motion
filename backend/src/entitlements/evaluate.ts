// The one place that decides what a user's entitlement rows are worth. Pure: no clock, no database, so the rules are
// unit-tested at exact instants. `expires_at` is the instant edit access ends: before it the user edits, from it on the
// editor is view-only. `canceled` and `revoked` end access at once whatever expires_at says.
import { isPlanId, isSource, LIVE_STATUSES, PLAN_FEATURES, type EntitlementRow, type Entitlements, type ViewReason } from "./plans.ts";

const none = (now: Date): Entitlements => ({ plan: "free", features: { proEditor: "none" }, validUntil: null, source: null, reason: null, cancelAtPeriodEnd: false, asOf: now.toISOString() });

/** Access when auth is off (local development): always full. */
export const localEntitlements = (now: Date): Entitlements => ({ plan: "pro", features: { proEditor: "edit" }, validUntil: null, source: "local", reason: null, cancelAtPeriodEnd: false, asOf: now.toISOString() });

const sourceOf = (row: EntitlementRow) => (isSource(row.source) ? row.source : null);

/** True while a row grants edit access at `now`. */
export function grantsAccess(row: EntitlementRow, now: Date): boolean {
  if (!isPlanId(row.plan) || !PLAN_FEATURES[row.plan].proEditor) return false;
  if (!LIVE_STATUSES.includes(row.status as never)) return false;
  if (row.validFrom.getTime() > now.getTime()) return false;
  return row.expiresAt === null || row.expiresAt.getTime() > now.getTime();
}

/** When a row that does not grant access stopped granting it, and why. Null if it never started yet. */
function endOf(row: EntitlementRow, now: Date): { at: Date; reason: ViewReason } | null {
  if (row.validFrom.getTime() > now.getTime()) return null;
  if (row.status === "revoked" || row.status === "canceled") {
    // Ended when expires_at says so, or when the row was changed if expires_at is missing or still ahead.
    const at = row.expiresAt && row.expiresAt.getTime() <= now.getTime() ? row.expiresAt : row.updatedAt;
    return { at, reason: row.status };
  }
  const at = row.expiresAt ?? row.updatedAt;
  return { at, reason: row.status === "past_due" ? "payment_failed" : "expired" };
}

export function evaluate(rows: readonly EntitlementRow[], now: Date): Entitlements {
  const known = rows.filter((row) => isPlanId(row.plan) && PLAN_FEATURES[row.plan].proEditor);

  // Edit: the live row that lasts longest (no end date beats any end date).
  let best: EntitlementRow | undefined;
  for (const row of known) {
    if (!grantsAccess(row, now)) continue;
    if (!best) best = row;
    else if (best.expiresAt !== null && (row.expiresAt === null || row.expiresAt.getTime() > best.expiresAt.getTime())) best = row;
  }
  if (best) {
    return { plan: "pro", features: { proEditor: "edit" }, validUntil: best.expiresAt?.toISOString() ?? null, source: sourceOf(best), reason: null, cancelAtPeriodEnd: best.cancelAtPeriodEnd, asOf: now.toISOString() };
  }

  // View: a plan existed and has ended. The most recent ending decides the wording.
  let last: { at: Date; reason: ViewReason; row: EntitlementRow } | undefined;
  for (const row of known) {
    const ended = endOf(row, now);
    if (ended && (!last || ended.at.getTime() > last.at.getTime())) last = { ...ended, row };
  }
  if (last) {
    return { plan: "free", features: { proEditor: "view" }, validUntil: last.at.toISOString(), source: sourceOf(last.row), reason: last.reason, cancelAtPeriodEnd: false, asOf: now.toISOString() };
  }
  return none(now);
}
