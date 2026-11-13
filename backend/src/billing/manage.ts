// The in-app billing modal: what Lemon Squeezy knows about the signed-in user's own subscription (card, invoices, dates),
// and cancel / resume. The subscription id always comes from our own row for the caller, never from the request, so a user
// can only ever read or change their own. Card data is never collected here: "update payment method" is Lemon Squeezy's URL.
import { query } from "../db/database.ts";
import { PLANS, isPaidTier, type BillingInterval, type PlanTier } from "../tokens/plan.ts";
import { tokenSummary } from "../tokens/store.ts";
import { cancelSubscriptionAtPeriodEnd, changeSubscriptionVariant, getSubscription, getVariant, listInvoices, resumeSubscriptionRemote, variantIdFor, type ApiResource } from "./lemonsqueezy.ts";
import { applyWebhook, servingSubscription, subscriptionFor, type SubscriptionView } from "./service.ts";
import type { PaidTier } from "../tokens/plan.ts";

export class NotSubscribed extends Error {}
/** The request is understood but cannot be done (an unknown plan, a cancelled plan). Its message is safe to show. */
export class ChangeRefused extends Error {}

export type Invoice = { id: string; date: string | null; amount: string; status: string; refunded: boolean; url: string | null };
export type BillingOverview = {
  subscription: null | {
    tier: PlanTier; planName: string; interval: BillingInterval; status: string; cancelAtPeriodEnd: boolean;
    renewsAt: string | null; endsAt: string | null;
    paymentMethod: { brand: string; last4: string } | null;
    updatePaymentUrl: string | null;
  };
  invoices: Invoice[];
  /** Plan tokens this period; null without a paid plan. They do not roll over. */
  tokens: { granted: number; used: number; remaining: number; resetsAt: string | null } | null;
};

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");
const iso = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

function invoiceOf(row: ApiResource): Invoice {
  const a = row.attributes ?? {};
  const urls = (a.urls ?? {}) as { invoice_url?: unknown };
  const total = typeof a.total === "number" ? a.total : null;
  const amount = text(a.total_formatted) || (total !== null ? `${(total / 100).toFixed(2)} ${text(a.currency)}`.trim() : "");
  return { id: text(row.id), date: iso(a.created_at), amount, status: text(a.status), refunded: a.refunded === true, url: typeof urls.invoice_url === "string" && urls.invoice_url.startsWith("https://") ? urls.invoice_url : null };
}

function urlOf(a: Record<string, unknown>, key: string): string | null {
  const urls = (a.urls ?? {}) as Record<string, unknown>;
  return typeof urls[key] === "string" && String(urls[key]).startsWith("https://") ? String(urls[key]) : null;
}

export async function billingOverview(userId: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<BillingOverview> {
  const row = await servingSubscription(userId, now);
  if (!row) return { subscription: null, invoices: [], tokens: null };
  const [remote, invoices, tokens, view] = await Promise.all([getSubscription(row.provider_ref, fetcher), listInvoices(row.provider_ref, fetcher), tokenSummary(userId), subscriptionFor(userId, now)]);
  const a = remote.attributes ?? {};
  const brand = text(a.card_brand), last4 = text(a.card_last_four);
  const cancelled = a.cancelled === true || text(a.status) === "cancelled";
  return {
    subscription: {
      tier: row.tier as PlanTier, planName: PLANS[row.tier as PlanTier].name, interval: row.billing_interval ?? "month",
      status: text(a.status) || row.status, cancelAtPeriodEnd: cancelled,
      renewsAt: cancelled ? null : iso(a.renews_at), endsAt: iso(a.ends_at),
      paymentMethod: brand && last4 ? { brand, last4 } : null,
      updatePaymentUrl: urlOf(a, "update_payment_method") ?? row.update_payment_url
    },
    invoices: invoices.slice(0, 6).map(invoiceOf),
    tokens: tokens.plan ? { granted: tokens.plan.granted, used: tokens.plan.used, remaining: tokens.plan.remaining, resetsAt: view.tokensResetAt } : null
  };
}

/** Our state follows Lemon Squeezy's answer straight away; the subscription_cancelled / _resumed webhook that follows changes nothing more. */
async function adopt(userId: string, event: string, remote: ApiResource, now: Date) {
  await applyWebhook({ meta: { event_name: event, custom_data: { user_id: userId } }, data: { id: text(remote.id), type: "subscriptions", attributes: remote.attributes } }, now, "sync");
}

const alreadyCancelled = (row: { cancel_at_period_end: boolean; status: string }) => row.cancel_at_period_end || row.status === "cancelled";

/** Cancels at period end. Idempotent: a second call, or a double click, changes nothing and reports the same state. */
export async function cancelPlan(userId: string, reason: string | undefined, fetcher: typeof fetch = fetch, now = new Date()): Promise<SubscriptionView> {
  const row = await servingSubscription(userId, now);
  if (!row) throw new NotSubscribed("No active plan to cancel.");
  if (alreadyCancelled(row)) return subscriptionFor(userId, now);
  let remote: ApiResource;
  try {
    remote = await cancelSubscriptionAtPeriodEnd(row.provider_ref, fetcher);
  } catch (error) {
    // A concurrent cancel can make Lemon Squeezy refuse the second; if it is cancelled there, that is the outcome we wanted.
    remote = await getSubscription(row.provider_ref, fetcher).catch(() => { throw error; });
    if (remote.attributes?.cancelled !== true) throw error;
  }
  await adopt(userId, "subscription_cancelled", remote, now);
  const note = (reason ?? "").trim().slice(0, 500);
  if (note) await query("insert into app.billing_events (event_key, name, user_id, payload) values ($1, 'cancel_reason', $2, $3) on conflict (event_key) do nothing", [`cancel-reason:${row.provider_ref}:${now.getTime()}`, userId, JSON.stringify({ reason: note })]);
  return subscriptionFor(userId, now);
}

/** Undoes a cancellation until the paid period ends. Idempotent: a plan that is not cancelled is returned as it is. */
export async function resumePlan(userId: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<SubscriptionView> {
  const row = await servingSubscription(userId, now);
  if (!row) throw new NotSubscribed("No plan to resume.");
  if (!alreadyCancelled(row)) return subscriptionFor(userId, now);
  const remote = await resumeSubscriptionRemote(row.provider_ref, fetcher);
  await adopt(userId, "subscription_resumed", remote, now);
  return subscriptionFor(userId, now);
}

const RANK: Record<PaidTier, number> = { starter: 1, pro: 2, business: 3 };

/**
 * Moves the caller's plan to `product` at the same billing interval. Upgrades are applied now and the prorated
 * difference is invoiced now. Lemon Squeezy cannot schedule a change for the period end, so a downgrade is also applied
 * now but with proration off: nothing is charged or credited, and the lower price starts at the next renewal. Tokens
 * already granted this period stay; an upgrade adds the difference (once, see grantUpgradeDifference).
 * Idempotent: asking for the plan you are already on changes nothing.
 */
export async function changePlan(userId: string, product: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<SubscriptionView> {
  const row = await servingSubscription(userId, now);
  if (!row) throw new NotSubscribed("No active plan to change.");
  if (!isPaidTier(product)) throw new ChangeRefused("Choose one of the paid plans.");
  if (row.tier === product) return subscriptionFor(userId, now);
  if (alreadyCancelled(row)) throw new ChangeRefused("Resume your subscription before changing plans.");
  const variantId = variantIdFor(product, row.billing_interval ?? "month");
  if (!variantId) throw new ChangeRefused("That plan is not available at your billing interval.");
  const upgrade = RANK[product] > RANK[row.tier as PaidTier];
  const productId = text((await getVariant(variantId, fetcher)).attributes?.product_id);
  if (!productId) throw new ChangeRefused("That plan is not available right now.");
  const remote = await changeSubscriptionVariant(row.provider_ref, { variantId, productId, invoiceImmediately: upgrade, disableProrations: !upgrade }, fetcher);
  await adopt(userId, "subscription_updated", remote, now);
  return subscriptionFor(userId, now);
}

const LEMON_HOST = /(^|\.)lemonsqueezy\.com$/;

/**
 * An invoice of the caller's own subscription, fetched server-side so the browser never visits Lemon Squeezy. The id must
 * be one Lemon Squeezy lists for the caller's subscription, and the document must be on a lemonsqueezy.com host.
 */
export async function invoiceDocument(userId: string, invoiceId: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const row = (await servingSubscription(userId, now)) ?? (await query<{ provider_ref: string }>("select provider_ref from app.subscriptions where user_id = $1 order by updated_at desc limit 1", [userId])).rows[0];
  if (!row) throw new NotSubscribed("No invoices.");
  const ref = "provider_ref" in row ? row.provider_ref : "";
  const found = (await listInvoices(ref, fetcher)).find((invoice) => text(invoice.id) === invoiceId);
  const url = found ? urlOf(found.attributes ?? {}, "invoice_url") : null;
  if (!url) throw new NotSubscribed("Invoice not found.");
  if (!LEMON_HOST.test(new URL(url).hostname)) throw new ChangeRefused("That invoice cannot be downloaded here.");
  const response = await fetcher(url, { headers: { Accept: "application/pdf,text/html" } });
  if (!response.ok) throw new Error(`Invoice fetch failed (${response.status}).`);
  const contentType = (response.headers.get("content-type") ?? "application/pdf").split(";")[0].trim();
  if (contentType !== "application/pdf" && contentType !== "text/html") throw new ChangeRefused("That invoice cannot be downloaded here.");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > 10_000_000) throw new ChangeRefused("That invoice is too large to download here.");
  return { body, contentType, filename: `invoice-${invoiceId}.${contentType === "application/pdf" ? "pdf" : "html"}` };
}

export { isPaidTier };
