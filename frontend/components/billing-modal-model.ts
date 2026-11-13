// What the billing modal says, as plain functions so the wording and the states are testable without a browser.
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
  | { kind: "error"; message: string; portalUrl: string | null }
  | { kind: "none" }
  | { kind: "ready"; overview: BillingOverview & { subscription: Sub }; confirming: boolean; busy: "cancel" | "resume" | null; notice: string | null };

export const modalStateFor = (result: BillingOverview): ModalState =>
  result.subscription ? { kind: "ready", overview: result as BillingOverview & { subscription: Sub }, confirming: false, busy: null, notice: null } : { kind: "none" };
