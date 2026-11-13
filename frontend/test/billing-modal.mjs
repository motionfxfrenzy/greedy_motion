import assert from "node:assert/strict";
import test from "node:test";
import { cancelConfirmText, cardLine, describeSubscription, invoiceRows, modalStateFor, tokenLine } from "../components/billing-modal-model.ts";

const sub = (over = {}) => ({ tier: "starter", planName: "Starter", interval: "month", status: "active", cancelAtPeriodEnd: false, renewsAt: "2026-12-12T00:00:00Z", endsAt: null, paymentMethod: { brand: "visa", last4: "4242" }, updatePaymentUrl: "https://pay.example/u", portalUrl: "https://portal.example/p", ...over });

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
