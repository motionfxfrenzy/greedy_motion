// How a billing provider's subscription maps onto an entitlement row. Provider-neutral and pure: the billing code
// converts its own objects (a Stripe subscription and invoice) into a SubscriptionSnapshot and gets the row fields back.
// The resolver never sees any of this; it reads the row.
//
// One rule: `expires_at` is the instant edit access ends. Before it the user edits; from it on the editor is view-only.
//   - Active and renewing: current period end + a small slack, so a late renewal webhook does not cut off a paying user.
//   - Cancellation scheduled for the period end: the period end exactly, no slack. The user keeps what they paid for.
//   - Payment failed: the first failure + the grace period, and later retries of the same invoice never extend it.
//   - Deleted, unpaid, refunded: ends now (`canceled`).
import type { EntitlementStatus } from "./plans.ts";

const DAY = 86_400_000;
export type LifecyclePolicy = { renewalSlackMs: number; graceMs: number };
export const LIFECYCLE_POLICY: LifecyclePolicy = { renewalSlackMs: 2 * DAY, graceMs: 3 * DAY };

export type SubscriptionSnapshot = {
  status: "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete_expired";
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date | null;
  /** When a deleted subscription actually ended. */
  endedAt?: Date | null;
  /** When the payment that is now overdue first failed, and which invoice it was. */
  failedAt?: Date | null;
  invoiceId?: string | null;
};

/** The columns a snapshot determines, plus the `meta` keys to merge into the row's existing meta. */
export type RowFields = { status: EntitlementStatus; expiresAt: Date; cancelAtPeriodEnd: boolean; meta: Record<string, unknown> };
/** What the row already holds, so repeated failure events cannot extend the grace period. */
export type ExistingRow = { status: string; meta: Record<string, unknown> } | null;

export function rowFromSubscription(snapshot: SubscriptionSnapshot, existing: ExistingRow, now: Date, policy: LifecyclePolicy = LIFECYCLE_POLICY): RowFields {
  const cleared = { firstFailureAt: null, graceInvoiceId: null };
  switch (snapshot.status) {
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return { status: "canceled", expiresAt: snapshot.endedAt ?? now, cancelAtPeriodEnd: false, meta: cleared };
    case "trialing":
      return { status: "trialing", expiresAt: snapshot.trialEnd ?? snapshot.currentPeriodEnd, cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd, meta: cleared };
    case "past_due": {
      const invoice = snapshot.invoiceId ?? null;
      const stored = existing?.status === "past_due" && typeof existing.meta.firstFailureAt === "string" && (existing.meta.graceInvoiceId ?? null) === invoice ? new Date(existing.meta.firstFailureAt) : null;
      const first = stored && !Number.isNaN(stored.getTime()) ? stored : (snapshot.failedAt ?? now);
      return { status: "past_due", expiresAt: new Date(first.getTime() + policy.graceMs), cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd, meta: { firstFailureAt: first.toISOString(), graceInvoiceId: invoice } };
    }
    case "active":
      return {
        status: "active",
        expiresAt: snapshot.cancelAtPeriodEnd ? snapshot.currentPeriodEnd : new Date(snapshot.currentPeriodEnd.getTime() + policy.renewalSlackMs),
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        meta: cleared
      };
  }
}
