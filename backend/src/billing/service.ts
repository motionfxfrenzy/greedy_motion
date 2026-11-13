// What a Lemon Squeezy webhook does here, and what the site asks about a user's subscription. Every delivery is stored
// once (billing_events) in the same transaction as its effects, so a redelivery changes nothing and a failure leaves
// nothing half-applied.
import { query, withTransaction } from "../db/database.ts";
import { rowFromSubscription } from "../entitlements/lifecycle.ts";
import { listEntitlements, upsertEntitlement } from "../entitlements/store.ts";
import { addUtcMonths, expirePlanTokens, grantDueAnnualTokens, grantTokens, tokenSummary } from "../tokens/store.ts";
import { ANNUAL_MONTHS_GRANTED, PLANS, TOP_UP, isPaidTier, type BillingInterval, type PaidTier, type PlanTier } from "../tokens/plan.ts";
import { latestPaidInvoice, listSubscriptionsByEmail, snapshotFromSubscription, variantOf, type WebhookBody } from "./lemonsqueezy.ts";

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
  /** A downgrade in waiting: the plan the subscription moves to, and when. Until then `tier` stays the higher plan. */
  pendingTier?: PlanTier | null;
  changesAt?: string | null;
};

export type SubRow = {
  entitled_tier?: string | null; entitled_until?: Date | null;
  user_id: string; provider?: string; provider_ref: string; variant_id: string; tier: string; billing_interval: BillingInterval; status: string; renews_at: Date | null; ends_at: Date | null;
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

/** The subscription row that serves this user now, if any. */
export async function servingSubscription(userId: string, now = new Date()): Promise<SubRow | undefined> {
  const { rows } = await query<SubRow>("select * from app.subscriptions where user_id = $1 order by updated_at desc", [userId]);
  return rows.find((r) => isPaidTier(r.tier) && serving(r, now));
}

const RANK_OF = (tier: string): number => (tier === "starter" ? 1 : tier === "pro" ? 2 : tier === "business" ? 3 : 0);

/** The plan whose features apply now: the higher of the current plan and an earlier one kept until its period ends. Read lazily, no job needed. */
export function effectiveTier(row: SubRow, now: Date): PlanTier {
  const kept = row.entitled_tier && row.entitled_until && row.entitled_until.getTime() > now.getTime() && RANK_OF(row.entitled_tier) > RANK_OF(row.tier) ? row.entitled_tier : null;
  return (kept ?? row.tier) as PlanTier;
}

export async function subscriptionFor(userId: string, now = new Date()): Promise<SubscriptionView> {
  await grantDueAnnualTokens(now, userId);
  const { rows } = await query<SubRow>("select * from app.subscriptions where user_id = $1 order by updated_at desc", [userId]);
  const row = rows.find((r) => isPaidTier(r.tier) && serving(r, now));
  if (!row) return { tier: "free", interval: null, status: null, renewsAt: null, tokensResetAt: null, endsAt: null, cancelAtPeriodEnd: false, portalUrl: rows[0]?.customer_portal_url ?? null, updatePaymentUrl: null };
  const effective = effectiveTier(row, now);
  return {
    tier: effective,
    pendingTier: effective !== row.tier ? (row.tier as PlanTier) : null,
    changesAt: effective !== row.tier ? (row.entitled_until?.toISOString() ?? null) : null,
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

/**
 * `source` keeps a pulled event (the checkout-return sync) from sharing a dedupe key with the same event delivered by
 * webhook. Without it, a webhook that was recorded but could not act (an invoice that raced its subscription) would make
 * the sync's identical invoice a "duplicate" and nothing would ever credit the tokens. Grants stay idempotent on the
 * ledger key (invoice:<id>), so the two paths still never credit twice.
 */
export async function applyWebhook(body: WebhookBody, now = new Date(), source: "webhook" | "sync" = "webhook"): Promise<Outcome> {
  const name = body.meta?.event_name ?? "";
  const data = body.data;
  const attributes = data?.attributes ?? {};
  const object = text(data?.id);
  if (!name || !object) return "ignored";
  const customUser = body.meta?.custom_data?.user_id;
  const key = `${source === "sync" ? "sync:" : ""}${name}:${object}:${text(attributes.updated_at) || text(attributes.created_at)}`;

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

  const previousRow = (await query<{ tier: string; entitled_tier: string | null; entitled_until: Date | null }>("select tier, entitled_tier, entitled_until from app.subscriptions where provider = 'lemonsqueezy' and provider_ref = $1", [ref])).rows[0] ?? null;
  const previous = previousRow?.tier ?? null;
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

  // A downgrade keeps the higher plan's features until the paid period ends (nothing runs at the boundary: the plan in
  // force is read lazily, see effectiveTier). Moving back up to that plan, or past it, ends the wait.
  let kept: PaidTier | null = null;
  if (previousRow && isPaidTier(previousRow.tier)) {
    const waiting = previousRow.entitled_tier && isPaidTier(previousRow.entitled_tier) && previousRow.entitled_until && previousRow.entitled_until.getTime() > now.getTime() ? (previousRow.entitled_tier as PaidTier) : null;
    kept = waiting;
    if (text(a.status) === "active" && TIER_RANK[variant.tier] < TIER_RANK[previousRow.tier as PaidTier]) kept = waiting && TIER_RANK[waiting] > TIER_RANK[previousRow.tier as PaidTier] ? waiting : (previousRow.tier as PaidTier);
    if (kept && TIER_RANK[variant.tier] >= TIER_RANK[kept]) kept = null;
    const until = kept ? (kept === waiting ? previousRow.entitled_until : (date(a.renews_at) ?? date(a.ends_at))) : null;
    if (!until) kept = null;
    await query("update app.subscriptions set entitled_tier = $1, entitled_until = $2 where provider = 'lemonsqueezy' and provider_ref = $3", [kept, kept ? until : null, ref]);
  }
  const entitlementTier: PaidTier = kept && TIER_RANK[kept] > TIER_RANK[variant.tier] ? kept : variant.tier;

  // Pro-editor access follows the subscription. A tier without the editor (Starter) ends any editor row this subscription had.
  const snapshot = snapshotFromSubscription(a, now);
  if (!snapshot) return "applied";
  // Paid and active: the plan's tokens are granted now, not when the first invoice event arrives (Lemon Squeezy can send
  // that a couple of minutes later). A trial, past_due or unpaid subscription is not paid and grants nothing here.
  if (text(a.status) === "active") await grantInitialPlan(userId, ref, variant.tier, variant.interval, date(a.created_at), now);
  // Moving up a plan mid-period: the tokens the bigger plan has beyond what was already granted this period, once.
  if (text(a.status) === "active" && previous && isPaidTier(previous) && TIER_RANK[variant.tier] > TIER_RANK[previous as PaidTier]) await grantUpgradeDifference(userId, ref, variant.tier, date(a.renews_at) ?? date(a.ends_at) ?? now);
  // The subscription has ended: the rest of its monthly tokens ends with it. (Packs and the free allowance stay.)
  if (snapshot.status === "canceled") await expirePlanTokens(userId, `expiry:end:${ref}`, "Plan ended");
  const existing = (await listEntitlements(userId)).find((row) => row.source === "lemonsqueezy" && row.sourceRef === ref) ?? null;
  const fields = PLANS[entitlementTier].proEditor
    ? rowFromSubscription(snapshot, existing ? { status: existing.status, meta: existing.meta } : null, now)
    : { status: "canceled" as const, expiresAt: now, cancelAtPeriodEnd: false, meta: {} };
  if (!existing && fields.status === "canceled") return "applied"; // nothing to end
  await upsertEntitlement(
    { userId, plan: "pro", status: fields.status, source: "lemonsqueezy", sourceRef: ref, expiresAt: fields.expiresAt, cancelAtPeriodEnd: fields.cancelAtPeriodEnd, sourceUpdatedAt: providerUpdated, meta: { ...fields.meta, tier: entitlementTier } },
    { actor: "lemonsqueezy", action: event, eventId: ref }
  );
  return "applied";
}

const TIER_RANK: Record<PaidTier, number> = { starter: 1, pro: 2, business: 3 };

/**
 * An upgrade mid-period credits the new plan's allowance minus what this period already granted, once per
 * (subscription, plan, period): Lemon Squeezy's update webhook and the in-app change both land here with the same key.
 */
async function grantUpgradeDifference(userId: string, ref: string, tier: PaidTier, periodEnd: Date): Promise<boolean> {
  await lockPlan(ref);
  const key = `plan-upgrade:${ref}:${tier}:${periodEnd.toISOString().slice(0, 10)}`;
  if ((await query("select 1 from app.token_ledger where user_id = $1 and ref = $2", [userId, key])).rows[0]) return false;
  const summary = await tokenSummary(userId);
  const difference = PLANS[tier].tokens - (summary.plan?.granted ?? 0);
  if (difference <= 0) return false;
  return grantTokens(userId, difference, `${PLANS[tier].name} plan upgrade`, "lemonsqueezy", key, "plan");
}

const lockPlan = (ref: string) => query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plan:${ref}`]);

/**
 * The first month's plan tokens, granted once per subscription at the first signal that it is paid and active: its
 * subscription event, or the checkout-return sync. Idempotent on the ledger key plan-initial:<subscription>. The first
 * invoice (billing_reason initial) that follows finds that key and grants nothing; renewals still grant per invoice.
 * A subscription that already has a plan grant since it was created (every subscription made before this existed does,
 * under invoice:<id>) is left alone, so an update event never grants a second time. Webhook and sync both hold the
 * same per-subscription lock, so two deliveries at once cannot both pass the checks.
 */
async function grantInitialPlan(userId: string, ref: string, tier: PaidTier, interval: BillingInterval, createdAt: Date | null, now: Date): Promise<boolean> {
  await lockPlan(ref);
  if ((await query("select 1 from app.token_ledger where user_id = $1 and ref = $2", [userId, `plan-initial:${ref}`])).rows[0]) return false;
  const since = new Date((createdAt ?? now).getTime() - 10 * 60_000);
  if ((await query("select 1 from app.token_ledger where user_id = $1 and pool = 'plan' and kind = 'grant' and created_at >= $2", [userId, since])).rows[0]) return false;
  await expirePlanTokens(userId, `expiry:initial:${ref}`);
  await grantTokens(userId, PLANS[tier].tokens, `${PLANS[tier].name} plan tokens`, "lemonsqueezy", `plan-initial:${ref}`, "plan");
  if (interval === "year") {
    await query("update app.subscriptions set cycle_anchor_at = $1, cycle_months_granted = 1, updated_at = now() where provider = 'lemonsqueezy' and provider_ref = $2", [createdAt ?? now, ref]);
  }
  return true;
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
    // The subscription event has not arrived yet (Lemon Squeezy sends it and the first invoice within milliseconds, so
    // they race). Never record this as handled: answer "retry" so the provider redelivers once the subscription exists.
    // This used to answer "ignored" whenever the invoice carried no custom data, which recorded the event and lost the grant.
    throw new RetryLater("Invoice arrived before its subscription.");
  }
  if (!isPaidTier(sub.tier)) return "ignored";
  await lockPlan(subscriptionRef);
  // The first invoice of a subscription whose first month was already granted when it became active adds nothing.
  if (reason === "initial" && (await query("select 1 from app.token_ledger where user_id = $1 and ref = $2", [sub.user_id, `plan-initial:${subscriptionRef}`])).rows[0]) return "ignored";
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

export type SyncResult = { synced: boolean; applied: Outcome[] };

/**
 * Pulls the buyer's purchase from Lemon Squeezy without waiting for the webhook. It feeds the API's own subscription and
 * latest paid invoice through applyWebhook as webhook-shaped events, so the grant is the same code, the same event
 * dedupe and the same ledger key (invoice:<id>) as the real delivery: whichever arrives second changes nothing.
 * Ownership: the subscription's email must be the signed-in user's, and a subscription already stored for someone else is skipped.
 */
export async function syncPurchase(userId: string, email: string | undefined, fetcher: typeof fetch = fetch, now = new Date()): Promise<SyncResult> {
  if (!email) return { synced: false, applied: [] };
  const applied: Outcome[] = [];
  for (const resource of await listSubscriptionsByEmail(email, fetcher)) {
    const ref = text(resource.id);
    const attributes = resource.attributes ?? {};
    if (!ref || text(attributes.user_email).toLowerCase() !== email.toLowerCase()) continue;
    if (variantOf(text(attributes.variant_id))?.kind !== "subscription") continue;
    const owner = await query<{ user_id: string }>("select user_id from app.subscriptions where provider = 'lemonsqueezy' and provider_ref = $1", [ref]);
    if (owner.rows[0] && owner.rows[0].user_id.toLowerCase() !== userId.toLowerCase()) continue;
    const meta = { event_name: "subscription_updated", custom_data: { user_id: userId } };
    applied.push(await applyWebhook({ meta, data: { id: ref, type: "subscriptions", attributes } }, now, "sync"));
    const invoice = await latestPaidInvoice(ref, fetcher);
    if (invoice?.id) applied.push(await applyWebhook({ meta: { ...meta, event_name: "subscription_payment_success" }, data: { id: text(invoice.id), type: "subscription-invoices", attributes: invoice.attributes } }, now, "sync"));
  }
  const view = await subscriptionFor(userId, now);
  return { synced: view.tier !== "free", applied };
}
