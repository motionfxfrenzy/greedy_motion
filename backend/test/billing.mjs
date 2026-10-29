// Lemon Squeezy billing against a real Postgres, without the network: the signature check, a subscription becoming a
// plan and (for Pro) editor access, a paid invoice becoming tokens once, redelivery and out-of-order events, a top-up
// order, cancellation, and the watermark. The webhook handler is called directly with the bodies Lemon Squeezy sends.
//   DATABASE_URL=postgres://… node test/billing.mjs   (cleans up its own rows)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "s3cret";
process.env.LEMONSQUEEZY_VARIANT_STARTER = "101";
process.env.LEMONSQUEEZY_VARIANT_PRO = "102";
process.env.LEMONSQUEEZY_VARIANT_BUSINESS = "103";
process.env.LEMONSQUEEZY_VARIANT_STARTER_ANNUAL = "201";
process.env.LEMONSQUEEZY_VARIANT_PRO_ANNUAL = "202";
process.env.LEMONSQUEEZY_VARIANT_BUSINESS_ANNUAL = "203";
process.env.LEMONSQUEEZY_VARIANT_TOPUP = "104";
const { migrate, pool } = await import("../src/db/database.ts");
const { addUtcMonths, applyWebhook, grantDueAnnualTokens, RetryLater, subscriptionFor, tierFor } = await import("../src/billing/service.ts");
const { validSignature, snapshotFromSubscription } = await import("../src/billing/lemonsqueezy.ts");
const { spendTokens, tokenSummary } = await import("../src/tokens/store.ts");
const { entitlementsFor } = await import("../src/entitlements/resolve.ts");
const { withWatermark } = await import("../src/plan/render-project.ts");
const { default: Fastify } = await import("fastify");
const { registerBillingRoutes } = await import("../src/billing/routes.ts");
const { isOpen } = await import("../src/auth.ts");
await migrate();

const U = "00000000-0000-4000-8000-0000000b0001", V = "00000000-0000-4000-8000-0000000b0002", W = "00000000-0000-4000-8000-0000000b0003";
const clean = async () => {
  for (const t of ["token_ledger", "subscriptions", "entitlements", "entitlement_events"]) await pool.query(`delete from app.${t} where user_id = any($1)`, [[U, V, W]]);
  await pool.query("delete from app.billing_events where name like 'test%' or payload::text like '%0000000b000%'");
};
await clean();

const day = 86_400_000, now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let tick = 0;
const sub = (name, user, over = {}) => ({
  meta: { event_name: name, custom_data: { user_id: user } },
  data: { id: "9001", type: "subscriptions", attributes: { variant_id: 102, status: "active", renews_at: iso(now + 30 * day), ends_at: null, cancelled: false, urls: { customer_portal: "https://portal.example/p", update_payment_method: "https://portal.example/u" }, updated_at: iso(now + (tick += 1000)), created_at: iso(now), ...over } }
});
const invoice = (id, reason, user, over = {}) => ({
  meta: { event_name: "subscription_payment_success", custom_data: { user_id: user } },
  data: { id, type: "subscription-invoices", attributes: { subscription_id: 9001, billing_reason: reason, status: "paid", created_at: iso(now), updated_at: iso(now + (tick += 1000)), ...over } }
});

try {
  // Signature: right secret passes, anything else fails.
  const raw = Buffer.from('{"a":1}');
  const good = createHmac("sha256", "s3cret").update(raw).digest("hex");
  assert.equal(validSignature(raw, good, "s3cret"), true);
  assert.equal(validSignature(raw, good, "other"), false);
  assert.equal(validSignature(raw, good.replace(/^./, "0"), "s3cret"), false);
  assert.equal(validSignature(raw, undefined, "s3cret"), false);
  assert.equal(validSignature(raw, good, ""), false, "no configured secret accepts nothing");

  // Over HTTP: the route takes the raw body, refuses a bad signature and accepts a good one; the auth gate leaves it open.
  const app = Fastify();
  await registerBillingRoutes(app);
  const body = JSON.stringify(sub("test_ping", U));
  const post = (signature) => app.inject({ method: "POST", url: "/v1/billing/webhook", headers: { "content-type": "application/json", ...(signature ? { "x-signature": signature } : {}) }, payload: body });
  assert.equal((await post()).statusCode, 401, "unsigned");
  assert.equal((await post("0".repeat(64))).statusCode, 401, "wrong signature");
  const ok = await post(createHmac("sha256", "s3cret").update(body).digest("hex"));
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().result, "ignored", "a signed event we do not act on is acknowledged");
  assert.equal(isOpen({ method: "POST", url: "/v1/billing/webhook", } ), true);
  assert.equal(isOpen({ method: "POST", url: "/v1/billing/checkout" }), false, "checkout needs a signed-in user");
  assert.equal((await app.inject({ method: "POST", url: "/v1/billing/checkout", headers: { "content-type": "application/json" }, payload: '{"product":"pro"}' })).statusCode, 501, "checkout is off until Lemon Squeezy is configured");
  await app.close();

  // Free until something is bought; no editor.
  assert.equal(await tierFor(U), "free");
  assert.equal((await entitlementsFor(U, { fresh: true })).features.proEditor, "none");

  // An invoice that beats its subscription asks to be sent again.
  await assert.rejects(() => applyWebhook(invoice("5001", "initial", U)), RetryLater);

  // Pro subscription: plan, editor access, then the invoice gives the tokens.
  assert.equal(await applyWebhook(sub("subscription_created", U)), "applied");
  assert.equal((await subscriptionFor(U)).tier, "pro");
  assert.equal((await entitlementsFor(U, { fresh: true })).features.proEditor, "edit");
  assert.equal(await applyWebhook(invoice("5001", "initial", U)), "applied");
  let t = await tokenSummary(U);
  assert.deepEqual([t.plan.granted, t.plan.used, t.plan.remaining, t.remaining], [550, 0, 550, 565], "the Pro plan's 550 tokens, plus the free allowance");
  const delivered = invoice("5001", "initial", U);
  assert.equal(await applyWebhook(delivered), "ignored", "a new delivery of the same invoice (new update time) changes nothing");
  assert.equal((await tokenSummary(U)).plan.granted, 550, "but the invoice grants its tokens once");
  const same = sub("subscription_updated", U); same.data.attributes.updated_at = iso(now + (tick += 1000));
  assert.equal(await applyWebhook(same), "applied");
  assert.equal(await applyWebhook(same), "duplicate", "an identical redelivery is recognised");

  // Part of the month is used (20%); the renewal starts the next month at 0% used with a full allowance, not 550 + 440.
  await spendTokens(U, 110_000, "render", "bill1");
  t = await tokenSummary(U);
  assert.deepEqual([t.plan.used, t.plan.remaining], [110, 440], "20% of 550 used");
  assert.equal(await applyWebhook(invoice("5002", "renewal", U)), "applied");
  t = await tokenSummary(U);
  assert.deepEqual([t.plan.granted, t.plan.used, t.plan.remaining], [550, 0, 550], "renewed: 0% used, full allowance, the unused 440 expired");
  assert.equal(t.remaining, 565);
  assert.equal(await applyWebhook(invoice("5003", "updated", U)), "ignored");
  assert.equal((await tokenSummary(U)).plan.remaining, 550, "a plan-change invoice grants nothing");

  // Cancelled: paid through the end date, editing continues until then, the plan will not renew.
  await applyWebhook(sub("subscription_cancelled", U, { status: "cancelled", cancelled: true, ends_at: iso(now + 10 * day), renews_at: null }));
  const cancelled = await subscriptionFor(U);
  assert.equal(cancelled.tier, "pro");
  assert.equal(cancelled.cancelAtPeriodEnd, true);
  const ent = await entitlementsFor(U, { fresh: true });
  assert.equal(ent.features.proEditor, "edit");
  assert.equal(ent.cancelAtPeriodEnd, true);

  // Expired: free again, the editor is view-only, the tokens stay.
  await applyWebhook(sub("subscription_expired", U, { status: "expired", cancelled: true, ends_at: iso(now - 1000), renews_at: null }));
  assert.equal(await tierFor(U), "free");
  assert.equal((await entitlementsFor(U, { fresh: true })).features.proEditor, "view");
  t = await tokenSummary(U);
  assert.deepEqual([t.plan.remaining, t.free.remaining, t.remaining], [0, 15, 15], "the plan's monthly tokens end with the plan; the free allowance stays");

  // An older event cannot undo a newer one.
  const stale = sub("subscription_updated", U, { status: "active", updated_at: iso(now - 5 * day) });
  assert.equal(await applyWebhook(stale), "ignored");
  assert.equal(await tierFor(U), "free");

  // Starter: a plan and tokens, but no editor. An unknown product is ignored.
  assert.equal(await applyWebhook({ ...sub("subscription_created", V), data: { ...sub("subscription_created", V).data, id: "9002", attributes: { ...sub("subscription_created", V).data.attributes, variant_id: 101 } } }), "applied");
  assert.equal(await tierFor(V), "starter");
  assert.equal((await entitlementsFor(V, { fresh: true })).features.proEditor, "none", "Starter has no Pro editor");
  const unknown = sub("subscription_created", V); unknown.data.id = "9003"; unknown.data.attributes.variant_id = 999;
  assert.equal(await applyWebhook(unknown), "ignored");

  // A token pack: 100 tokens per paid order, once; a refund takes them back.
  const order = (name, status) => ({ meta: { event_name: name, custom_data: { user_id: V } }, data: { id: "7001", type: "orders", attributes: { status, first_order_item: { variant_id: 104 }, created_at: iso(now), updated_at: iso(now + (tick += 1000)) } } });
  await applyWebhook(order("order_created", "paid"));
  assert.equal((await tokenSummary(V)).packs.remaining, 100);
  await applyWebhook(order("order_refunded", "refunded"));
  assert.equal((await tokenSummary(V)).packs.remaining, 0, "a refunded pack takes its tokens back");

  // Annual billing: one yearly payment grants month 1 at once, then grants a fresh monthly allowance on each month's date
  // through the 12-month year (expiring the previous month's unused plan tokens each time), and never grants a 13th month.
  const anchor = new Date(now);
  const yearEnd = addUtcMonths(anchor, 12);
  const annualSub = (name, over = {}) => ({
    meta: { event_name: name, custom_data: { user_id: W } },
    data: { id: "9010", type: "subscriptions", attributes: { variant_id: 202, status: "active", renews_at: yearEnd.toISOString(), ends_at: null, cancelled: false, urls: { customer_portal: "https://portal.example/p", update_payment_method: "https://portal.example/u" }, updated_at: iso(now + (tick += 1000)), created_at: anchor.toISOString(), ...over } }
  });
  const annualInvoice = (id, reason, atIso = anchor.toISOString()) => ({
    meta: { event_name: "subscription_payment_success", custom_data: { user_id: W } },
    data: { id, type: "subscription-invoices", attributes: { subscription_id: 9010, billing_reason: reason, status: "paid", created_at: atIso, updated_at: iso(now + (tick += 1000)) } }
  });
  assert.equal(await applyWebhook(annualSub("subscription_created"), anchor), "applied");
  assert.equal(await applyWebhook(annualInvoice("6001", "initial"), anchor), "applied");
  const wSub1 = await subscriptionFor(W, anchor);
  assert.equal(wSub1.tier, "pro");
  assert.equal(wSub1.interval, "year");
  assert.equal(wSub1.tokensResetAt, addUtcMonths(anchor, 1).toISOString(), "tokens reset next month, not next year");
  let wt = await tokenSummary(W, 20, anchor);
  assert.deepEqual([wt.plan.granted, wt.plan.used, wt.plan.remaining], [550, 0, 550], "month 1 granted by the annual invoice");

  // Spend 150 tokens in month 1; mid-month nothing new is granted.
  await spendTokens(W, 150_000, "render", "ann-m1", undefined, new Date(now + 10 * day));
  assert.equal(await grantDueAnnualTokens(new Date(now + 15 * day), W), 0);
  wt = await tokenSummary(W, 20, new Date(now + 15 * day));
  assert.deepEqual([wt.plan.used, wt.plan.remaining], [150, 400]);

  // Month 2 date arrives: unused 400 tokens expire and month 2's 550 tokens are granted.
  const m2 = addUtcMonths(anchor, 1);
  wt = await tokenSummary(W, 20, m2);
  assert.deepEqual([wt.plan.granted, wt.plan.used, wt.plan.remaining], [550, 0, 550], "month 2 starts fresh with 550 tokens");
  assert.equal(await grantDueAnnualTokens(m2, W), 0, "idempotent within the same month");
  assert.equal((await subscriptionFor(W, m2)).tokensResetAt, addUtcMonths(anchor, 2).toISOString());

  // Advance month by month through month 12 (m = 2 .. 11).
  for (let m = 2; m <= 11; m++) {
    const mDate = addUtcMonths(anchor, m);
    await spendTokens(W, 50_000, "render", `ann-m${m}`, undefined, new Date(mDate.getTime() - day));
    wt = await tokenSummary(W, 20, mDate);
    assert.deepEqual([wt.plan.granted, wt.plan.used, wt.plan.remaining], [550, 0, 550], `month ${m + 1} of 12 granted on its monthly date`);
  }

  // At the end of the 12th month, before a year-2 renewal invoice arrives, a 13th month is not granted.
  await spendTokens(W, 200_000, "render", "ann-m12-spend", undefined, new Date(yearEnd.getTime() - day));
  assert.equal(await grantDueAnnualTokens(yearEnd, W), 0, "no 13th month without a renewal invoice");
  wt = await tokenSummary(W, 20, yearEnd);
  assert.equal(wt.plan.remaining, 350);

  // Year 2 renewal invoice arrives: starts the new 12-month cycle and grants month 1 of year 2.
  const year2End = addUtcMonths(yearEnd, 12);
  await applyWebhook(annualSub("subscription_updated", { renews_at: year2End.toISOString() }), yearEnd);
  assert.equal(await applyWebhook(annualInvoice("6002", "renewal", yearEnd.toISOString()), yearEnd), "applied");
  wt = await tokenSummary(W, 20, yearEnd);
  assert.deepEqual([wt.plan.granted, wt.plan.used, wt.plan.remaining], [550, 0, 550], "year 2 month 1 granted on renewal");

  // Cancelled mid-year: keeps granting monthly tokens until ends_at, then expires remaining plan tokens at ends_at.
  const cancelEnd = addUtcMonths(yearEnd, 3);
  await applyWebhook(annualSub("subscription_cancelled", { status: "cancelled", cancelled: true, ends_at: cancelEnd.toISOString(), renews_at: null }), yearEnd);
  await spendTokens(W, 100_000, "render", "ann-y2-m1", undefined, new Date(yearEnd.getTime() + 5 * day));
  wt = await tokenSummary(W, 20, addUtcMonths(yearEnd, 1));
  assert.deepEqual([wt.plan.granted, wt.plan.used, wt.plan.remaining], [550, 0, 550], "still paid through ends_at, so month 2 of year 2 is granted");
  wt = await tokenSummary(W, 20, cancelEnd);
  assert.deepEqual([wt.plan.remaining, wt.free.remaining, wt.remaining], [0, 15, 15], "at ends_at the annual plan's remaining tokens expire");

  // Status mapping the entitlement layer depends on.
  const at = new Date();
  assert.equal(snapshotFromSubscription({ status: "past_due", renews_at: iso(now + day) }, at).status, "past_due");
  assert.equal(snapshotFromSubscription({ status: "paused" }, at).status, "canceled");
  assert.equal(snapshotFromSubscription({ status: "wat" }, at), null);

  // The Free plan's watermark lands inside the film, once, sized from the canvas.
  const film = '<div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920"><div id="captions" data-layout-allow-overlap></div></div>';
  const marked = withWatermark(film);
  assert.equal(marked.match(/id="gm-watermark"/g).length, 1);
  assert.ok(marked.includes("Made with Greedy Motion") && marked.includes("font:600 17px"), "17 px = 1.6% of a 1080 px canvas");
  console.log("billing: ok");
} finally {
  await clean();
  await pool.end();
}
