// Reads and writes app.entitlements. Every write also appends to app.entitlement_events (who, what, when), in the same
// transaction. All queries go through `query()`, so a caller that wraps these in `withTransaction` (the future billing
// webhook: dedupe row + entitlement change) gets one atomic unit.
import { afterCommit, query, withTransaction } from "../db/database.ts";
import { entitlementCache } from "./cache.ts";
import { LIVE_STATUSES, type EntitlementRow, type EntitlementSource, type EntitlementStatus, type PlanId } from "./plans.ts";

type DbRow = {
  id: string; user_id: string; plan: string; status: string; source: string; source_ref: string; valid_from: Date; expires_at: Date | null;
  cancel_at_period_end: boolean; source_updated_at: Date | null; granted_by: string; note: string | null; meta: Record<string, unknown>; created_at: Date; updated_at: Date;
};

const toRow = (r: DbRow): EntitlementRow => ({
  id: r.id, userId: r.user_id, plan: r.plan, status: r.status, source: r.source, sourceRef: r.source_ref, validFrom: r.valid_from, expiresAt: r.expires_at,
  cancelAtPeriodEnd: r.cancel_at_period_end, sourceUpdatedAt: r.source_updated_at, grantedBy: r.granted_by, note: r.note, meta: r.meta ?? {}, createdAt: r.created_at, updatedAt: r.updated_at
});

/** What the audit table keeps of a row: everything that decides access, nothing secret. */
const snapshot = (row: EntitlementRow | null) => row && ({
  plan: row.plan, status: row.status, source: row.source, sourceRef: row.sourceRef, validFrom: row.validFrom.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd, sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null, note: row.note, meta: row.meta
});

export async function listEntitlements(userId: string): Promise<EntitlementRow[]> {
  const { rows } = await query<DbRow>("select * from app.entitlements where user_id = $1 order by created_at", [userId]);
  return rows.map(toRow);
}

export type EntitlementChange = {
  userId: string;
  plan: PlanId;
  status: EntitlementStatus;
  source: EntitlementSource;
  /** '' for a manual grant, the provider's subscription id otherwise. */
  sourceRef?: string;
  validFrom?: Date;
  /** Required and explicit: null means "never expires", so a re-grant without an end date cannot keep an old one by accident. */
  expiresAt: Date | null;
  cancelAtPeriodEnd?: boolean;
  /** The provider's event time. An older one than the row's is refused (`stale`). */
  sourceUpdatedAt?: Date | null;
  note?: string | null;
  meta?: Record<string, unknown>;
};
/** `actor` is `cli:<operator>` or the provider name; `action` overrides the derived grant/extend/update label (a provider uses its event type). */
export type Audit = { actor: string; action?: string; eventId?: string };
export type UpsertResult = { result: "applied" | "unchanged" | "stale"; row: EntitlementRow | null };

async function audit(userId: string, entitlementId: string | null, who: Audit, action: string, before: EntitlementRow | null, after: EntitlementRow | null) {
  await query(
    "insert into app.entitlement_events (user_id, entitlement_id, actor, action, event_id, before, after) values ($1, $2, $3, $4, $5, $6, $7)",
    [userId, entitlementId, who.actor, action, who.eventId ?? null, JSON.stringify(snapshot(before)), JSON.stringify(snapshot(after))]
  );
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
const lockKey = (userId: string, source: string, sourceRef: string) => `entitlement:${userId}:${source}:${sourceRef}`;
const live = (row: EntitlementRow | null) => Boolean(row && LIVE_STATUSES.includes(row.status as EntitlementStatus));

/**
 * Creates or updates one entitlement (one per user and source reference). Serialised per key, so concurrent writers
 * (two webhook deliveries, a script and a webhook) apply in turn. Safe for a billing webhook to call repeatedly:
 *   - an event older than the row's `source_updated_at` changes nothing and is logged as `stale_ignored`;
 *   - the same change applied twice is `unchanged` and logs nothing;
 *   - called inside `withTransaction`, it commits or rolls back with the caller's other writes.
 */
export function upsertEntitlement(change: EntitlementChange, who: Audit): Promise<UpsertResult> {
  const sourceRef = change.sourceRef ?? "";
  return withTransaction(async () => {
    await query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey(change.userId, change.source, sourceRef)]);
    const found = await query<DbRow>("select * from app.entitlements where user_id = $1 and source = $2 and source_ref = $3", [change.userId, change.source, sourceRef]);
    const existing = found.rows[0] ? toRow(found.rows[0]) : null;

    if (existing?.sourceUpdatedAt && change.sourceUpdatedAt && existing.sourceUpdatedAt.getTime() > change.sourceUpdatedAt.getTime()) {
      await audit(change.userId, existing.id, who, "stale_ignored", existing, existing);
      return { result: "stale" as const, row: existing };
    }

    const next = {
      validFrom: change.validFrom ?? existing?.validFrom ?? new Date(),
      cancelAtPeriodEnd: change.cancelAtPeriodEnd ?? false,
      sourceUpdatedAt: change.sourceUpdatedAt ?? null,
      note: change.note !== undefined ? change.note : (existing?.note ?? null),
      meta: { ...(existing?.meta ?? {}), ...(change.meta ?? {}) }
    };
    if (existing && existing.plan === change.plan && existing.status === change.status && sameTime(existing.validFrom, next.validFrom) && sameTime(existing.expiresAt, change.expiresAt)
      && existing.cancelAtPeriodEnd === next.cancelAtPeriodEnd && sameTime(existing.sourceUpdatedAt, next.sourceUpdatedAt) && existing.note === next.note
      && JSON.stringify(existing.meta) === JSON.stringify(next.meta)) {
      return { result: "unchanged" as const, row: existing };
    }

    const grantedBy = who.eventId ? `${who.actor}:${who.eventId}` : who.actor;
    const saved = existing
      ? await query<DbRow>(
          `update app.entitlements set plan = $2, status = $3, valid_from = $4, expires_at = $5, cancel_at_period_end = $6, source_updated_at = $7, granted_by = $8, note = $9, meta = $10, updated_at = now()
           where id = $1 returning *`,
          [existing.id, change.plan, change.status, next.validFrom, change.expiresAt, next.cancelAtPeriodEnd, next.sourceUpdatedAt, grantedBy, next.note, JSON.stringify(next.meta)]
        )
      : await query<DbRow>(
          `insert into app.entitlements (user_id, plan, status, source, source_ref, valid_from, expires_at, cancel_at_period_end, source_updated_at, granted_by, note, meta)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
          [change.userId, change.plan, change.status, change.source, sourceRef, next.validFrom, change.expiresAt, next.cancelAtPeriodEnd, next.sourceUpdatedAt, grantedBy, next.note, JSON.stringify(next.meta)]
        );
    const row = toRow(saved.rows[0]);
    const action = who.action ?? (!existing ? "grant" : live(existing) && live(row) ? "extend" : "update");
    await audit(change.userId, row.id, who, action, existing, row);
    afterCommit(() => entitlementCache.delete(change.userId));
    return { result: "applied" as const, row };
  });
}

/**
 * Ends the user's manual grants now: status `revoked`, expires_at now. Rows stay (history), files are never touched, and
 * the user keeps view-only access to their Pro projects. Returns the rows it changed; another source (a subscription)
 * may still grant access, which the caller can check with `evaluate`.
 */
export function revokeEntitlements(userId: string, who: Audit, source: EntitlementSource = "manual"): Promise<EntitlementRow[]> {
  return withTransaction(async () => {
    const { rows } = await query<DbRow>("select * from app.entitlements where user_id = $1 and source = $2 and (status <> 'revoked' or expires_at is null or expires_at > now()) order by created_at for update", [userId, source]);
    const changed: EntitlementRow[] = [];
    for (const found of rows) {
      const before = toRow(found);
      const updated = await query<DbRow>("update app.entitlements set status = 'revoked', expires_at = now(), granted_by = $2, updated_at = now() where id = $1 returning *", [before.id, who.actor]);
      const after = toRow(updated.rows[0]);
      await audit(userId, after.id, who, who.action ?? "revoke", before, after);
      changed.push(after);
    }
    if (changed.length) afterCommit(() => entitlementCache.delete(userId));
    return changed;
  });
}

