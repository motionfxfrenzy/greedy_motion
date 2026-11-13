import assert from "node:assert/strict";
import test from "node:test";
import { cancelConfirmText, cardLine, changeConfirm, describeSubscription, invoiceRows, limitedNotice, modalStateFor, planChoices, tokenLine } from "../components/billing-modal-model.ts";
import { embedUrl } from "../lib/lemon.ts";

const sub = (over = {}) => ({ source: "lemonsqueezy", providerMissing: false, tier: "starter", planName: "Starter", interval: "month", status: "active", cancelAtPeriodEnd: false, renewsAt: "2026-12-12T00:00:00Z", endsAt: null, paymentMethod: { brand: "visa", last4: "4242" }, updatePaymentUrl: "https://pay.example/u", ...over });

test("active: renews on a date, can be cancelled, update is secondary", () => {
  const view = describeSubscription(sub(), "en-US");
  assert.equal(view.statusLabel, "Active");
  assert.equal(view.dateLine, "Renews December 12, 2026");
  assert.deepEqual([view.canCancel, view.canResume, view.prominentUpdate, view.showUpdate], [true, false, false, true]);
});

test("cancelled: says when it ends, offers resume, hides cancel", () => {
  const view = describeSubscription(sub({ cancelAtPeriodEnd: true, renewsAt: null, endsAt: "2026-12-12T00:00:00Z" }), "en-US");
  assert.equal(view.statusLabel, "Cancelled");
  assert.equal(view.dateLine, "Ends on December 12, 2026");
  assert.deepEqual([view.canCancel, view.canResume], [false, true]);
});

test("past_due: the payment update is the prominent action", () => {
  const view = describeSubscription(sub({ status: "past_due" }));
  assert.equal(view.tone, "bad");
  assert.equal(view.prominentUpdate, true);
  assert.equal(view.canCancel, true);
  assert.equal(describeSubscription(sub({ status: "past_due", updatePaymentUrl: null })).prominentUpdate, false);
});

test("on_trial and unpaid", () => {
  assert.match(describeSubscription(sub({ status: "on_trial" }), "en-US").dateLine, /^Trial ends December 12, 2026$/);
  const unpaid = describeSubscription(sub({ status: "unpaid" }));
  assert.deepEqual([unpaid.canCancel, unpaid.prominentUpdate], [false, true]);
});

test("the confirm step is plain, with the period end and no pressure", () => {
  const text = cancelConfirmText(sub(), "en-US");
  assert.equal(text, "Your plan stays active until December 12, 2026. You keep your remaining plan tokens until then. After that you won't be charged.");
});

test("card, invoices and tokens read cleanly", () => {
  assert.equal(cardLine(sub()), "Visa ending 4242");
  assert.equal(cardLine(sub({ paymentMethod: null })), "No card on file shown");
  const rows = invoiceRows([{ id: "1", date: "2026-11-12T00:00:00Z", amount: "$19.00", status: "paid", refunded: false, url: "https://r.example/1" }, { id: "2", date: null, amount: "$19.00", status: "paid", refunded: true, url: null }], "en-US");
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.status, r.url]), [["November 12, 2026", "$19.00", "Paid", "https://r.example/1"], ["", "$19.00", "Refunded", null]]);
  assert.match(tokenLine({ granted: 200, used: 12.5, remaining: 187.5, resetsAt: null }), /12\.5 plan tokens used, 187\.5 left\. Plan tokens don't roll over/);
});

test("no subscription shows the plans prompt; a subscription shows the details", () => {
  assert.deepEqual(modalStateFor({ subscription: null, invoices: [], tokens: null }), { kind: "none" });
  const ready = modalStateFor({ subscription: sub(), invoices: [], tokens: null });
  assert.equal(ready.kind, "ready");
  assert.deepEqual([ready.confirming, ready.busy], [false, null]);
});

test("plan choices mark the current plan and the direction of each other plan", () => {
  assert.deepEqual(planChoices("pro", "month").map((c) => [c.tier, c.kind]), [["starter", "downgrade"], ["pro", "current"], ["business", "upgrade"]]);
  assert.equal(planChoices("starter", "month")[1].priceText, "$49 a month");
  assert.match(planChoices("starter", "year")[0].priceText, /a year \(\$[\d.]+ a month\)$/);
});

test("an upgrade says what is charged now and how many tokens it adds", () => {
  const confirm = changeConfirm("starter", "pro", "month", "2026-12-12T00:00:00Z", "en-US");
  assert.equal(confirm.confirmLabel, "Upgrade to Pro");
  assert.equal(confirm.lines[0], "Pro costs $49 a month, which is $30 a month more than Starter.");
  assert.match(confirm.lines[1], /charged the prorated difference/);
  assert.match(confirm.lines[2], /You get 350 more plan tokens now\. From December 12, 2026/);
});

test("a downgrade says nothing is charged or refunded and that this period's tokens stay", () => {
  const confirm = changeConfirm("pro", "starter", "month", "2026-12-12T00:00:00Z", "en-US", { remaining: 412.5, resetsAt: "2026-12-12T00:00:00Z" });
  assert.equal(confirm.confirmLabel, "Downgrade to Starter");
  assert.match(confirm.lines[0], /\$30 a month less than Pro/);
  assert.match(confirm.lines[1], /^This takes effect now\. You lose the Pro editor immediately, and there's no refund for the rest of this period\. Nothing is charged today; the lower price starts at your next renewal on December 12, 2026\.$/);
  assert.match(confirm.lines[2], /^You keep your remaining 412\.5 plan tokens until December 12, 2026\. From December 12, 2026 you'll get 200 tokens a month\.$/);
});

test("overlay links carry embed=1 and keep their signature", () => {
  assert.equal(embedUrl("https://store.lemonsqueezy.com/checkout/custom/abc?signature=s1"), "https://store.lemonsqueezy.com/checkout/custom/abc?signature=s1&embed=1");
  assert.equal(embedUrl("https://x.lemonsqueezy.com/u?embed=1"), "https://x.lemonsqueezy.com/u?embed=1");
});

test("a manual plan or a subscription the provider does not know is explained, with a way to ask for help", () => {
  assert.equal(limitedNotice(sub()), null);
  assert.match(limitedNotice(sub({ source: "manual" })), /^This plan was set up by our team, so it can't be changed here\. Contact support/);
  assert.match(limitedNotice(sub({ providerMissing: true })), /^We couldn't find this subscription at our payment provider\./);
});
