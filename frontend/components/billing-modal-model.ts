// What the billing modal says, as plain functions so the wording and the states are testable without a browser.
import { PLANS, annualMonthlyUsd, type PaidTier } from "@videosaas/contracts";
import type { BillingInvoice, BillingOverview } from "../lib/api";

type Sub = NonNullable<BillingOverview["subscription"]>;
export type Tone = "ok" | "warn" | "bad";

export const formatDate = (iso: string | null, locale?: string) => (iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }) : "");

export type SubscriptionView = {
  statusLabel: string; tone: Tone; dateLine: string; canCancel: boolean; canResume: boolean;
  /** past_due: updating the payment method is the main action. */
  prominentUpdate: boolean; showUpdate: boolean;
};

export function describeSubscription(sub: Sub, locale?: string): SubscriptionView {
  const end = formatDate(sub.endsAt ?? sub.renewsAt, locale);
  const showUpdate = Boolean(sub.updatePaymentUrl);
  if (sub.cancelAtPeriodEnd) return { statusLabel: "Cancelled", tone: "warn", dateLine: end ? `Ends on ${end}` : "Ends at the end of the period", canCancel: false, canResume: true, prominentUpdate: false, showUpdate };
  switch (sub.status) {
    case "past_due": return { statusLabel: "Payment failed", tone: "bad", dateLine: "Update your payment method to keep your plan.", canCancel: true, canResume: false, prominentUpdate: showUpdate, showUpdate };
    case "on_trial": return { statusLabel: "Trial", tone: "ok", dateLine: end ? `Trial ends ${end}` : "On trial", canCancel: true, canResume: false, prominentUpdate: false, showUpdate };
    case "unpaid":
    case "paused": return { statusLabel: sub.status === "paused" ? "Paused" : "Unpaid", tone: "bad", dateLine: "Update your payment method to restore your plan.", canCancel: false, canResume: false, prominentUpdate: showUpdate, showUpdate };
    default: return { statusLabel: "Active", tone: "ok", dateLine: end ? `Renews ${end}` : "Active", canCancel: true, canResume: false, prominentUpdate: false, showUpdate };
  }
}

/** The confirm step before cancelling. Plain facts: no pressure. */
export const cancelConfirmText = (sub: Sub, locale?: string) => {
  const end = formatDate(sub.endsAt ?? sub.renewsAt, locale) || "the end of this period";
  return `Your plan stays active until ${end}. You keep your remaining plan tokens until then. After that you won't be charged.`;
};

export const cardLine = (sub: Sub) => (sub.paymentMethod ? `${sub.paymentMethod.brand.charAt(0).toUpperCase()}${sub.paymentMethod.brand.slice(1)} ending ${sub.paymentMethod.last4}` : "No card on file shown");

export const invoiceRows = (invoices: BillingInvoice[], locale?: string) =>
  invoices.map((i) => ({ id: i.id, date: formatDate(i.date, locale), amount: i.amount, status: i.refunded ? "Refunded" : i.status === "paid" ? "Paid" : i.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), url: i.url }));

export const tokenLine = (tokens: NonNullable<BillingOverview["tokens"]>) =>
  `${tokens.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} plan tokens used, ${tokens.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} left. Plan tokens don't roll over to the next period.`;

export type ModalState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "none" }
  | { kind: "ready"; overview: BillingOverview & { subscription: Sub }; confirming: boolean; changing: PaidTier | null; busy: "cancel" | "resume" | "change" | "update" | null; notice: string | null };

export const modalStateFor = (result: BillingOverview): ModalState =>
  result.subscription ? { kind: "ready", overview: result as BillingOverview & { subscription: Sub }, confirming: false, changing: null, busy: null, notice: null } : { kind: "none" };

export type PlanChoice = { tier: PaidTier; name: string; priceText: string; kind: "current" | "upgrade" | "downgrade" };
const ORDER: PaidTier[] = ["starter", "pro", "business"];
const priceText = (tier: PaidTier, interval: "month" | "year") => (interval === "year" ? `$${PLANS[tier].annualPriceUsd} a year ($${annualMonthlyUsd(tier).toFixed(2)} a month)` : `$${PLANS[tier].priceUsd} a month`);

/** The paid plans at the buyer's own billing interval, each marked as the current one, an upgrade or a downgrade. */
export const planChoices = (current: PaidTier, interval: "month" | "year"): PlanChoice[] =>
  ORDER.map((tier) => ({ tier, name: PLANS[tier].name, priceText: priceText(tier, interval), kind: tier === current ? "current" : ORDER.indexOf(tier) > ORDER.indexOf(current) ? "upgrade" : "downgrade" }));

/** The confirm step before a plan change: the price difference and exactly what happens to charges and tokens. */
export function changeConfirm(current: PaidTier, target: PaidTier, interval: "month" | "year", renewsAt: string | null, locale?: string, tokens?: { remaining: number; resetsAt: string | null } | null) {
  const upgrade = ORDER.indexOf(target) > ORDER.indexOf(current);
  const renews = formatDate(renewsAt, locale) || "your next renewal";
  const diff = interval === "year" ? PLANS[target].annualPriceUsd - PLANS[current].annualPriceUsd : PLANS[target].priceUsd - PLANS[current].priceUsd;
  const money = `$${Math.abs(diff)} a ${interval === "year" ? "year" : "month"}`;
  const extra = PLANS[target].tokens - PLANS[current].tokens;
  const lost = PLANS[current].proEditor && !PLANS[target].proEditor ? "You lose the Pro editor immediately" : `You lose the features ${PLANS[current].name} has that ${PLANS[target].name} does not, immediately`;
  return upgrade
    ? { title: `Upgrade to ${PLANS[target].name}?`, confirmLabel: `Upgrade to ${PLANS[target].name}`, lines: [
        `${PLANS[target].name} costs ${priceText(target, interval)}, which is ${money} more than ${PLANS[current].name}.`,
        "The change applies now and you are charged the prorated difference for the rest of this period today.",
        `You get ${extra.toLocaleString()} more plan tokens now. From ${renews} the full ${PLANS[target].name} price renews.`] }
    : { title: `Downgrade to ${PLANS[target].name}?`, confirmLabel: `Downgrade to ${PLANS[target].name}`, lines: [
        `${PLANS[target].name} costs ${priceText(target, interval)}, which is ${money} less than ${PLANS[current].name}.`,
        `This takes effect now. ${lost}, and there's no refund for the rest of this period. Nothing is charged today; the lower price starts at your next renewal on ${renews}.`,
        tokens
          ? `You keep your remaining ${tokens.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} plan tokens until ${formatDate(tokens.resetsAt ?? renewsAt, locale) || "your next renewal"}. From ${renews} you'll get ${PLANS[target].tokens.toLocaleString()} tokens a month.`
          : `You keep this period's plan tokens until your next renewal. From ${renews} you'll get ${PLANS[target].tokens.toLocaleString()} tokens a month.`] };
}

/**
 * Why the modal can only show what we hold ourselves: a plan set up by our team has no subscription at the payment
 * provider, and a subscription the provider does not know cannot be read or changed. Null when everything works.
 */
export function limitedNotice(sub: Sub): string | null {
  if (sub.source === "manual") return "This plan was set up by our team, so it can't be changed here. Contact support to change or cancel it.";
  if (sub.providerMissing) return "We couldn't find this subscription at our payment provider. Your plan, dates and tokens below are what we have on record. Contact support and we'll sort it out.";
  return null;
}
