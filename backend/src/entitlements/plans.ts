// The vocabulary of entitlements: plans, what each unlocks, and the shapes shared by the resolver, the store, the API
// and the scripts. Plans, statuses and sources are validated here in code, so adding a plan is not a migration.

export const PLAN_IDS = ["pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** What each plan unlocks. Billing decides who has a plan; this decides what the plan is worth. */
export const PLAN_FEATURES: Record<PlanId, { proEditor: boolean }> = {
  pro: { proEditor: true }
};

export const STATUSES = ["active", "trialing", "past_due", "canceled", "revoked"] as const;
export type EntitlementStatus = (typeof STATUSES)[number];
/** Statuses that can grant access while inside their window. `canceled` and `revoked` never do. */
export const LIVE_STATUSES: readonly EntitlementStatus[] = ["active", "trialing", "past_due"];

export const SOURCES = ["manual", "stripe"] as const;
export type EntitlementSource = (typeof SOURCES)[number];

export const isPlanId = (value: unknown): value is PlanId => PLAN_IDS.includes(value as PlanId);
export const isStatus = (value: unknown): value is EntitlementStatus => STATUSES.includes(value as EntitlementStatus);
export const isSource = (value: unknown): value is EntitlementSource => SOURCES.includes(value as EntitlementSource);

/** One row of app.entitlements. */
export type EntitlementRow = {
  id: string;
  userId: string;
  plan: string;
  status: string;
  source: string;
  sourceRef: string;
  validFrom: Date;
  expiresAt: Date | null;
  cancelAtPeriodEnd: boolean;
  sourceUpdatedAt: Date | null;
  grantedBy: string;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

/** `edit`: full use. `view`: had a plan that has ended, so existing work opens read-only. `none`: never had one. */
export type ProEditorAccess = "edit" | "view" | "none";
/** Why a lapsed plan is view-only; the UI words the notice from it. */
export type ViewReason = "expired" | "canceled" | "revoked" | "payment_failed";

/** What the API tells the client about the caller's plan. Never carries ids, notes or who granted it. */
export type Entitlements = {
  plan: "free" | "pro";
  features: { proEditor: ProEditorAccess };
  /** When edit access ends (edit), or ended (view). Null: no end date, or no plan. */
  validUntil: string | null;
  source: EntitlementSource | "local" | null;
  reason: ViewReason | null;
  /** Edit access ends at validUntil and will not renew. */
  cancelAtPeriodEnd: boolean;
  asOf: string;
};
