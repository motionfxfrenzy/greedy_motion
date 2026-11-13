// The in-app billing modal: what Lemon Squeezy knows about the signed-in user's own subscription (card, invoices, dates),
// and cancel / resume. The subscription id always comes from our own row for the caller, never from the request, so a user
// can only ever read or change their own. Card data is never collected here: "update payment method" is Lemon Squeezy's URL.
import { query } from "../db/database.ts";
import { PLANS, isPaidTier, type BillingInterval, type PlanTier } from "../tokens/plan.ts";
import { tokenSummary } from "../tokens/store.ts";
import { CheckoutError, cancelSubscriptionAtPeriodEnd, changeSubscriptionVariant, getSubscription, getVariant, listInvoices, resumeSubscriptionRemote, variantIdFor, type ApiResource } from "./lemonsqueezy.ts";
import { applyWebhook, effectiveTier, servingSubscription, subscriptionFor, type SubscriptionView } from "./service.ts";
import type { PaidTier } from "../tokens/plan.ts";

export class NotSubscribed extends Error {}
/** The request is understood but cannot be done (an unknown plan, a cancelled plan). Its message is safe to show. */
export class ChangeRefused extends Error {}

export type Invoice = { id: string; date: string | null; amount: string; status: string; refunded: boolean; discounted: boolean; url: string | null };
export type BillingOverview = {
  /** False when Lemon Squeezy would not list the invoices; the rest of the overview is still shown. */
  invoicesAvailable?: boolean;
  subscription: null | {
    /** "manual": a plan set up by our team, with no subscription at Lemon Squeezy. `providerMissing`: we hold a Lemon Squeezy id it does not know. Either way the details come from our own records. */
    source: "lemonsqueezy" | "manual"; providerMissing: boolean;
    /** A downgrade in waiting: `tier` stays the higher plan until `at`. */
    pendingChange: { tier: PlanTier; planName: string; at: string | null } | null;
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
  return { id: text(row.id), date: iso(a.created_at), amount, status: text(a.status), refunded: a.refunded === true, discounted: typeof a.discount_total === "number" && a.discount_total > 0, url: typeof urls.invoice_url === "string" && urls.invoice_url.startsWith("https://") ? urls.invoice_url : null };
}

function urlOf(a: Record<string, unknown>, key: string): string | null {
  const urls = (a.urls ?? {}) as Record<string, unknown>;
  return typeof urls[key] === "string" && String(urls[key]).startsWith("https://") ? String(urls[key]) : null;
}

/** Plans given by hand (scripts/plan.ts) carry a `manual:<user>` reference: there is no Lemon Squeezy subscription behind them. */
const isManual = (row: { provider?: string; provider_ref: string }) => (row.provider !== undefined && row.provider !== "lemonsqueezy") || !/^[0-9]+$/.test(row.provider_ref);
const notFound = (error: unknown) => error instanceof CheckoutError && error.status === 404;
const MANUAL_REFUSAL = "This plan was set up by our team, so it can't be changed here. Contact support to change or cancel it.";
const MISSING_REFUSAL = "We couldn't find this subscription at our payment provider. Contact support and we'll sort it out.";
/** A Lemon Squeezy 404 on a write means the subscription is not there; say so plainly instead of "unavailable". */
const refuseMissing = (error: unknown): never => { throw notFound(error) ? new ChangeRefused(MISSING_REFUSAL) : error; };

export async function billingOverview(userId: string, fetcher: typeof fetch = fetch, now = new Date(), log: (details: Record<string, unknown>) => void = () => undefined): Promise<BillingOverview> {
  const row = await servingSubscription(userId, now);
  if (!row) return { subscription: null, invoices: [], tokens: null };
  const manual = isManual(row);
  // One missing or failing piece must not blank the modal: what we hold ourselves (plan, status, dates, tokens) always shows.
  const piece = async <T>(resource: string, load: () => Promise<T>, hard: boolean): Promise<T | null> => {
    try { return await load(); } catch (error) {
      if (notFound(error) || !hard) { log({ resource, subscription: row.provider_ref, status: error instanceof CheckoutError ? error.status : undefined, message: error instanceof Error ? error.message : String(error) }); return null; }
      throw error;
    }
  };
  const [remote, invoices, tokens, view] = await Promise.all([
    manual ? null : piece("subscription", () => getSubscription(row.provider_ref, fetcher), true),
    manual ? [] : piece("invoices", () => listInvoices(row.provider_ref, fetcher), false),
    tokenSummary(userId), subscriptionFor(userId, now)
  ]);
  const a = remote?.attributes ?? {};
  const brand = text(a.card_brand), last4 = text(a.card_last_four);
  const cancelled = remote ? a.cancelled === true || text(a.status) === "cancelled" : row.cancel_at_period_end || row.status === "cancelled";
  return {
    invoicesAvailable: manual || invoices !== null,
    subscription: {
      source: manual ? "manual" : "lemonsqueezy", providerMissing: !manual && remote === null,
      tier: effectiveTier(row, now), planName: PLANS[effectiveTier(row, now)].name, interval: row.billing_interval ?? "month",
      pendingChange: effectiveTier(row, now) !== row.tier ? { tier: row.tier as PlanTier, planName: PLANS[row.tier as PlanTier].name, at: row.entitled_until?.toISOString() ?? null } : null,
      status: text(a.status) || row.status, cancelAtPeriodEnd: cancelled,
      renewsAt: cancelled ? null : remote ? iso(a.renews_at) : (row.renews_at?.toISOString() ?? null), endsAt: remote ? iso(a.ends_at) : (row.ends_at?.toISOString() ?? null),
      paymentMethod: brand && last4 ? { brand, last4 } : null,
      updatePaymentUrl: remote ? (urlOf(a, "update_payment_method") ?? row.update_payment_url) : null
    },
    invoices: (invoices ?? []).slice(0, 6).map(invoiceOf),
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
  if (isManual(row)) throw new ChangeRefused(MANUAL_REFUSAL);
  let remote: ApiResource;
  try {
    remote = await cancelSubscriptionAtPeriodEnd(row.provider_ref, fetcher);
  } catch (error) {
    if (notFound(error)) throw new ChangeRefused(MISSING_REFUSAL);
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
  if (isManual(row)) throw new ChangeRefused(MANUAL_REFUSAL);
  const remote = await resumeSubscriptionRemote(row.provider_ref, fetcher).catch(refuseMissing);
  await adopt(userId, "subscription_resumed", remote, now);
  return subscriptionFor(userId, now);
}

const RANK: Record<PaidTier, number> = { starter: 1, pro: 2, business: 3 };

/**
 * Moves the caller's plan to `product` at the same billing interval.
 * - Upgrade (above the plan in force): applied now, the prorated difference invoiced now.
 * - Downgrade: Lemon Squeezy moves the subscription now but with proration off, so nothing is charged or credited and the
 *   lower price starts at the next renewal. Our side keeps the higher plan's features until the paid period ends (the
 *   plan in force is read lazily from `entitled_tier` / `entitled_until`, so no job runs at the boundary).
 * - Undo: asking for the plan still in force while a downgrade is waiting moves Lemon Squeezy back, again with proration
 *   off (that period is already paid), and clears the wait.
 * Tokens already granted this period stay; an upgrade adds the difference (once, see grantUpgradeDifference); the
 * renewal grants the plan then in force. Idempotent: asking for the plan you are already on changes nothing.
 */
export async function changePlan(userId: string, product: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<SubscriptionView> {
  const row = await servingSubscription(userId, now);
  if (!row) throw new NotSubscribed("No active plan to change.");
  if (!isPaidTier(product)) throw new ChangeRefused("Choose one of the paid plans.");
  if (isManual(row)) throw new ChangeRefused(MANUAL_REFUSAL);
  if (row.tier === product) return subscriptionFor(userId, now);
  if (alreadyCancelled(row)) throw new ChangeRefused("Resume your subscription before changing plans.");
  const variantId = variantIdFor(product, row.billing_interval ?? "month");
  if (!variantId) throw new ChangeRefused("That plan is not available at your billing interval.");
  const inForce = effectiveTier(row, now) as PaidTier;
  const undo = product === inForce && inForce !== row.tier;
  const upgrade = !undo && RANK[product] > RANK[inForce];
  const productId = text((await getVariant(variantId, fetcher).catch(refuseMissing)).attributes?.product_id);
  if (!productId) throw new ChangeRefused("That plan is not available right now.");
  const remote = await changeSubscriptionVariant(row.provider_ref, { variantId, productId, invoiceImmediately: upgrade, disableProrations: !upgrade }, fetcher).catch(refuseMissing);
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
  if (isManual({ provider_ref: ref })) throw new NotSubscribed("Invoice not found.");
  const found = (await listInvoices(ref, fetcher).catch((error) => (notFound(error) ? [] : Promise.reject(error)))).find((invoice) => text(invoice.id) === invoiceId);
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
