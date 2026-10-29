// What a Lemon Squeezy webhook does here, and what the site asks about a user's subscription. Every delivery is stored
// once (billing_events) in the same transaction as its effects, so a redelivery changes nothing and a failure leaves
// nothing half-applied.
import { query, withTransaction } from "../db/database.ts";
import { rowFromSubscription } from "../entitlements/lifecycle.ts";
import { listEntitlements, upsertEntitlement } from "../entitlements/store.ts";
import { addUtcMonths, expirePlanTokens, grantDueAnnualTokens, grantTokens } from "../tokens/store.ts";
import { ANNUAL_MONTHS_GRANTED, PLANS, TOP_UP, isPaidTier, type BillingInterval, type PaidTier, type PlanTier } from "../tokens/plan.ts";
import { snapshotFromSubscription, variantOf, type WebhookBody } from "./lemonsqueezy.ts";

export { addUtcMonths, grantDueAnnualTokens };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SubscriptionView = {
  tier: PlanTier;
  interval: BillingInterval | null;
  status: string | null;
  renewsAt: string | null;
  /** When the current month's plan tokens next reset (monthly: renewsAt; annual: the next monthly anniversary). */
  tokensResetAt: string | null;
  endsAt: string | null;
  cancelAtPeriodEnd: boolean;
  portalUrl: string | null;
  updatePaymentUrl: string | null;
};

type SubRow = {
  user_id: string; provider_ref: string; variant_id: string; tier: string; billing_interval: BillingInterval; status: string; renews_at: Date | null; ends_at: Date | null;
  cancel_at_period_end: boolean; customer_portal_url: string | null; update_payment_url: string | null; provider_updated_at: Date | null;
  cycle_anchor_at: Date | null; cycle_months_granted: number; created_at: Date;
};

/** A subscription that still serves the user: paid through its end, not expired. */
const serving = (row: SubRow, now: Date) => {
  if (row.status === "expired" || row.status === "paused" || row.status === "unpaid") return false;
  if (row.status === "cancelled") return row.ends_at !== null && row.ends_at.getTime() > now.getTime();
  return true;
};

function nextTokenReset(row: SubRow): string | null {
  const cancelled = row.cancel_at_period_end || row.status === "cancelled";
  if (row.billing_interval === "year" && row.cycle_anchor_at && row.cycle_months_granted >= 1 && row.cycle_months_granted < ANNUAL_MONTHS_GRANTED) {
    const next = addUtcMonths(row.cycle_anchor_at, row.cycle_months_granted);
    const periodEnd = row.ends_at ?? row.renews_at;
    if (!periodEnd || next.getTime() < periodEnd.getTime()) return next.toISOString();
    return cancelled ? null : (row.renews_at?.toISOString() ?? null);
  }
  return cancelled ? null : (row.renews_at?.toISOString() ?? null);
}

export async function subscriptionFor(userId: string, now = new Date()): Promise<SubscriptionView> {
  await grantDueAnnualTokens(now, userId);
  const { rows } = await query<SubRow>("select * from app.subscriptions where user_id = $1 order by updated_at desc", [userId]);
  const row = rows.find((r) => isPaidTier(r.tier) && serving(r, now));
  if (!row) return { tier: "free", interval: null, status: null, renewsAt: null, tokensResetAt: null, endsAt: null, cancelAtPeriodEnd: false, portalUrl: rows[0]?.customer_portal_url ?? null, updatePaymentUrl: null };
  return {
    tier: row.tier as PlanTier,
    interval: row.billing_interval ?? "month",
    status: row.status,
    renewsAt: row.renews_at?.toISOString() ?? null,
    tokensResetAt: nextTokenReset(row),
    endsAt: row.ends_at?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end || row.status === "cancelled",
    portalUrl: row.customer_portal_url,
    updatePaymentUrl: row.update_payment_url
  };
}

/** The tier that decides watermark and monthly tokens right now. */
export async function tierFor(userId: string, now = new Date()): Promise<PlanTier> {
  return (await subscriptionFor(userId, now)).tier;
}

/** The delivery cannot be applied yet (an invoice before its subscription); the provider will send it again. */
export class RetryLater extends Error {}
/** The delivery is valid but not ours to act on (an unknown product). Acknowledged, recorded, nothing applied. */
export type Outcome = "applied" | "duplicate" | "ignored";

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

export async function applyWebhook(body: WebhookBody, now = new Date()): Promise<Outcome> {
  const name = body.meta?.event_name ?? "";
  const data = body.data;
  const attributes = data?.attributes ?? {};
  const object = text(data?.id);
  if (!name || !object) return "ignored";
  const customUser = body.meta?.custom_data?.user_id;
  const key = `${name}:${object}:${text(attributes.updated_at) || text(attributes.created_at)}`;

  return withTransaction(async () => {
    const stored = await query("insert into app.billing_events (event_key, name, user_id, payload) values ($1, $2, $3, $4) on conflict (event_key) do nothing", [key, name, typeof customUser === "string" && UUID.test(customUser) ? customUser : null, JSON.stringify(body)]);
    if (stored.rowCount === 0) return "duplicate" as const;

    if (name.startsWith("subscription_") && data?.type === "subscriptions" && !name.startsWith("subscription_payment_")) return applySubscription(name, object, attributes, customUser, now);
    if (name === "subscription_payment_success" && data?.type === "subscription-invoices") return applyInvoice(object, attributes, customUser, now);
    if (name === "order_created" && data?.type === "orders") return applyOrder(object, attributes, customUser);
    if (name === "order_refunded" && data?.type === "orders") return applyOrderRefund(object, attributes, customUser);
    return "ignored" as const;
  });
}

async function userOf(custom: unknown, subscriptionRef: string): Promise<string | null> {
  if (typeof custom === "string" && UUID.test(custom)) return custom.toLowerCase();
  if (!subscriptionRef) return null;
  const { rows } = await query<{ user_id: string }>("select user_id from app.subscriptions where provider = 'lemonsqueezy' and provider_ref = $1", [subscriptionRef]);
  return rows[0]?.user_id ?? null;
}

async function applySubscription(event: string, ref: string, a: Record<string, unknown>, custom: unknown, now: Date): Promise<Outcome> {
  const userId = await userOf(custom, ref);
  if (!userId) return "ignored";
  const variant = variantOf(text(a.variant_id) as string);
  if (variant?.kind !== "subscription") return "ignored";
  const urls = (a.urls ?? {}) as { customer_portal?: unknown; update_payment_method?: unknown };
  const updatedAt = Date.parse(text(a.updated_at));
  const providerUpdated = Number.isNaN(updatedAt) ? null : new Date(updatedAt);
  const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

  const newer = await query(
    `insert into app.subscriptions (user_id, provider_ref, variant_id, tier, billing_interval, status, renews_at, ends_at, cancel_at_period_end, customer_portal_url, update_payment_url, provider_updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (provider, provider_ref) do update set variant_id = excluded.variant_id, tier = excluded.tier, billing_interval = excluded.billing_interval,
       cycle_anchor_at = case when excluded.billing_interval = 'month' then null else app.subscriptions.cycle_anchor_at end,
       cycle_months_granted = case when excluded.billing_interval = 'month' then 0 else app.subscriptions.cycle_months_granted end,
       status = excluded.status, renews_at = excluded.renews_at, ends_at = excluded.ends_at,
       cancel_at_period_end = excluded.cancel_at_period_end, customer_portal_url = excluded.customer_portal_url, update_payment_url = excluded.update_payment_url, provider_updated_at = excluded.provider_updated_at, updated_at = now()
     where app.subscriptions.provider_updated_at is null or excluded.provider_updated_at is null or excluded.provider_updated_at >= app.subscriptions.provider_updated_at`,
    [userId, ref, text(a.variant_id), variant.tier, variant.interval, text(a.status), date(a.renews_at), date(a.ends_at), a.cancelled === true, typeof urls.customer_portal === "string" ? urls.customer_portal : null, typeof urls.update_payment_method === "string" ? urls.update_payment_method : null, providerUpdated]
  );
  if (newer.rowCount === 0) return "ignored"; // an older event than the row already holds

  // Pro-editor access follows the subscription. A tier without the editor (Starter) ends any editor row this subscription had.
  const snapshot = snapshotFromSubscription(a, now);
  if (!snapshot) return "applied";
  // The subscription has ended: the rest of its monthly tokens ends with it. (Packs and the free allowance stay.)
  if (snapshot.status === "canceled") await expirePlanTokens(userId, `expiry:end:${ref}`, "Plan ended");
  const existing = (await listEntitlements(userId)).find((row) => row.source === "lemonsqueezy" && row.sourceRef === ref) ?? null;
  const fields = PLANS[variant.tier].proEditor
    ? rowFromSubscription(snapshot, existing ? { status: existing.status, meta: existing.meta } : null, now)
    : { status: "canceled" as const, expiresAt: now, cancelAtPeriodEnd: false, meta: {} };
  if (!existing && fields.status === "canceled") return "applied"; // nothing to end
  await upsertEntitlement(
    { userId, plan: "pro", status: fields.status, source: "lemonsqueezy", sourceRef: ref, expiresAt: fields.expiresAt, cancelAtPeriodEnd: fields.cancelAtPeriodEnd, sourceUpdatedAt: providerUpdated, meta: { ...fields.meta, tier: variant.tier } },
    { actor: "lemonsqueezy", action: event, eventId: ref }
  );
  return "applied";
}

/** A paid first or renewal invoice gives the plan's tokens, once per invoice. Plan changes and proration do not. */
async function applyInvoice(invoiceId: string, a: Record<string, unknown>, custom: unknown, now: Date): Promise<Outcome> {
  const reason = text(a.billing_reason);
  if (reason !== "initial" && reason !== "renewal") return "ignored";
  if (text(a.status) !== "paid") return "ignored";
  const subscriptionRef = text(a.subscription_id);
  const { rows } = await query<{ user_id: string; tier: string; billing_interval: BillingInterval; created_at: Date }>("select user_id, tier, billing_interval, created_at from app.subscriptions where provider = 'lemonsqueezy' and provider_ref = $1", [subscriptionRef]);
  const sub = rows[0];
  if (!sub) {
    // The subscription event has not arrived yet; the provider redelivers until it has.
    if (typeof custom === "string") throw new RetryLater("Invoice arrived before its subscription.");
    return "ignored";
  }
  if (!isPaidTier(sub.tier)) return "ignored";
  // A delivery of an invoice we already applied must not expire the month's tokens again.
  const done = await query("select 1 from app.token_ledger where user_id = $1 and ref = $2", [sub.user_id, `invoice:${invoiceId}`]);
  if (done.rows[0]) return "ignored";
  // A new month: what was left of last month's allowance expires, then the full allowance is granted. Usage starts again at zero.
  await expirePlanTokens(sub.user_id, `expiry:${invoiceId}`);
  await grantTokens(sub.user_id, PLANS[sub.tier as PaidTier].tokens, `${PLANS[sub.tier as PaidTier].name} plan tokens`, "lemonsqueezy", `invoice:${invoiceId}`, "plan");
  if (sub.billing_interval === "year") {
    const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
    const anchor = date(a.created_at) ?? date(a.updated_at) ?? sub.created_at ?? now;
    await query(
      "update app.subscriptions set cycle_anchor_at = $1, cycle_months_granted = 1, updated_at = now() where provider = 'lemonsqueezy' and provider_ref = $2",
      [anchor, subscriptionRef]
    );
  }
  return "applied";
}

async function applyOrder(orderId: string, a: Record<string, unknown>, custom: unknown): Promise<Outcome> {
  const item = (a.first_order_item ?? {}) as { variant_id?: unknown };
  const variant = variantOf(text(item.variant_id));
  if (variant?.kind !== "topup" || text(a.status) !== "paid") return "ignored";
  const userId = await userOf(custom, "");
  if (!userId) return "ignored";
  await grantTokens(userId, variant.tokens, `Token pack (${TOP_UP.tokens} tokens)`, "lemonsqueezy", `order:${orderId}`, "pack");
  return "applied";
}

async function applyOrderRefund(orderId: string, a: Record<string, unknown>, custom: unknown): Promise<Outcome> {
  const item = (a.first_order_item ?? {}) as { variant_id?: unknown };
  const variant = variantOf(text(item.variant_id));
  if (variant?.kind !== "topup") return "ignored";
  const userId = await userOf(custom, "");
  if (!userId) return "ignored";
  await query(
    "insert into app.token_ledger (user_id, amount, kind, reason, ref, actor, pool) values ($1, $2, 'adjust', 'Token pack refunded', $3, 'lemonsqueezy', 'pack') on conflict (user_id, ref) where ref is not null do nothing",
    [userId, -variant.tokens * 1000, `refund-order:${orderId}`]
  );
  return "applied";
}
