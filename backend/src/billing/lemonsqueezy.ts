// Lemon Squeezy: signature check, checkout creation, and turning its subscription statuses into the provider-neutral
// snapshot the entitlement layer already understands.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import type { SubscriptionSnapshot } from "../entitlements/lifecycle.ts";
import { isPaidTier, TOP_UP, type BillingInterval, type PaidTier } from "../tokens/plan.ts";

const API = "https://api.lemonsqueezy.com/v1";

/** True when `signature` (hex) is HMAC-SHA256 of the raw body under the webhook secret. Constant-time. */
export function validSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export type Variant = { kind: "subscription"; tier: PaidTier; interval: BillingInterval } | { kind: "topup"; tokens: number };

/** Which product a variant id is. Null for a variant this deployment does not sell. */
export function variantOf(variantId: string | number | null | undefined): Variant | null {
  const id = String(variantId ?? "");
  if (!id) return null;
  for (const tier of ["starter", "pro", "business"] as const) {
    if (config.billing.variants[tier] === id) return { kind: "subscription", tier, interval: "month" };
    const annualKey = `${tier}Annual` as const;
    if (config.billing.variants[annualKey] === id) return { kind: "subscription", tier, interval: "year" };
  }
  if (config.billing.variants.topup === id) return { kind: "topup", tokens: TOP_UP.tokens };
  return null;
}

export function variantIdFor(product: PaidTier | "topup", interval: BillingInterval = "month"): string {
  if (product === "topup") return config.billing.variants.topup;
  if (interval === "year") return config.billing.variants[`${product}Annual` as const];
  return config.billing.variants[product];
}

export const checkoutConfigured = (interval: BillingInterval = "month"): boolean => {
  const monthlyReady = Boolean(config.billing.apiKey && config.billing.storeId && config.billing.variants.starter && config.billing.variants.pro && config.billing.variants.business && config.billing.variants.topup);
  if (interval === "month") return monthlyReady;
  return Boolean(monthlyReady && config.billing.variants.starterAnnual && config.billing.variants.proAnnual && config.billing.variants.businessAnnual);
};

export const annualCheckoutConfigured = () => checkoutConfigured("year");

export class CheckoutError extends Error {}

/** Where the buyer lands afterwards: the profile tokens section, flagged so the page syncs the purchase at once instead of waiting for the webhook. */
export function returnUrlFor(item: "plan" | "pack", base: string = config.billing.returnUrl): string {
  const url = new URL(base);
  url.searchParams.set("checkout", "success");
  url.searchParams.set("item", item);
  url.hash = "tokens";
  return url.toString();
}

/** A hosted checkout for one variant. The buyer's user id rides in custom data and comes back on every webhook. */
export async function createCheckout(input: { userId: string; email?: string; variantId: string; item?: "plan" | "pack" }, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`${API}/checkouts`, {
    method: "POST",
    headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${config.billing.apiKey}` },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: { ...(input.email ? { email: input.email } : {}), custom: { user_id: input.userId } },
          product_options: { redirect_url: returnUrlFor(input.item ?? "plan") },
          test_mode: config.billing.testMode
        },
        relationships: {
          store: { data: { type: "stores", id: config.billing.storeId } },
          variant: { data: { type: "variants", id: input.variantId } }
        }
      }
    })
  });
  if (!response.ok) throw new CheckoutError(`Lemon Squeezy refused the checkout (${response.status}).`);
  const body = await response.json() as { data?: { attributes?: { url?: unknown } } };
  const url = body.data?.attributes?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new CheckoutError("Lemon Squeezy returned no checkout link.");
  return url;
}

export type ApiResource = { id?: string; type?: string; attributes?: Record<string, unknown> };

async function apiGet(path: string, fetcher: typeof fetch): Promise<ApiResource[]> {
  const response = await fetcher(`${API}${path}`, { headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${config.billing.apiKey}` } });
  if (!response.ok) throw new CheckoutError(`Lemon Squeezy lookup failed (${response.status}).`);
  const body = await response.json() as { data?: ApiResource[] };
  return Array.isArray(body.data) ? body.data : [];
}

/** The subscriptions Lemon Squeezy holds for a buyer's email in this store, newest first. */
export const listSubscriptionsByEmail = (email: string, fetcher: typeof fetch = fetch) =>
  apiGet(`/subscriptions?filter[store_id]=${encodeURIComponent(config.billing.storeId)}&filter[user_email]=${encodeURIComponent(email)}&page[size]=10`, fetcher)
    .then((rows) => rows.sort((a, b) => Date.parse(String(b.attributes?.created_at ?? "")) - Date.parse(String(a.attributes?.created_at ?? ""))));

/** The newest paid invoice of one subscription. */
export const latestPaidInvoice = (subscriptionId: string, fetcher: typeof fetch = fetch) =>
  apiGet(`/subscription-invoices?filter[subscription_id]=${encodeURIComponent(subscriptionId)}&filter[status]=paid&page[size]=5`, fetcher)
    .then((rows) => rows.sort((a, b) => Date.parse(String(b.attributes?.created_at ?? "")) - Date.parse(String(a.attributes?.created_at ?? "")))[0] ?? null);

/** The webhook body, as much of it as we read. */
export type WebhookBody = {
  meta?: { event_name?: string; custom_data?: { user_id?: unknown } };
  data?: { id?: string; type?: string; attributes?: Record<string, unknown> };
};

const date = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null);

/**
 * Lemon Squeezy statuses: on_trial, active, paused, past_due, unpaid, cancelled, expired. `cancelled` means the buyer
 * cancelled but is paid through `ends_at`, so it is still an active subscription that will not renew.
 */
export function snapshotFromSubscription(attributes: Record<string, unknown>, now: Date): SubscriptionSnapshot | null {
  const status = String(attributes.status ?? "");
  const renewsAt = date(attributes.renews_at);
  const endsAt = date(attributes.ends_at);
  const periodEnd = endsAt ?? renewsAt;
  switch (status) {
    case "active": return periodEnd ? { status: "active", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false } : null;
    case "on_trial": return periodEnd ? { status: "trialing", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, trialEnd: date(attributes.trial_ends_at) ?? periodEnd } : null;
    case "cancelled": return endsAt && endsAt.getTime() > now.getTime() ? { status: "active", currentPeriodEnd: endsAt, cancelAtPeriodEnd: true } : { status: "canceled", currentPeriodEnd: endsAt ?? now, cancelAtPeriodEnd: false, endedAt: endsAt ?? now };
    case "past_due": return { status: "past_due", currentPeriodEnd: periodEnd ?? now, cancelAtPeriodEnd: false, failedAt: null };
    case "paused":
    case "unpaid":
    case "expired": return { status: "canceled", currentPeriodEnd: endsAt ?? now, cancelAtPeriodEnd: false, endedAt: endsAt && endsAt.getTime() < now.getTime() ? endsAt : now };
    default: return null;
  }
}

export { isPaidTier };
