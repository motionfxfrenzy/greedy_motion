// The billing modal's backend against a real Postgres and a fake, stateful Lemon Squeezy API: overview (plan, card,
// invoices, tokens), cancel at period end, resume, idempotency, ownership, and failures.
//   DATABASE_URL=postgres://… node test/billing-manage.mjs   (cleans up its own rows)
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
process.env.LEMONSQUEEZY_API_KEY = "k"; process.env.LEMONSQUEEZY_STORE_ID = "1";
process.env.LEMONSQUEEZY_VARIANT_STARTER = "101"; process.env.LEMONSQUEEZY_VARIANT_PRO = "102"; process.env.LEMONSQUEEZY_VARIANT_BUSINESS = "103"; process.env.LEMONSQUEEZY_VARIANT_TOPUP = "104";
const { migrate, pool } = await import("../src/db/database.ts");
const { applyWebhook, subscriptionFor } = await import("../src/billing/service.ts");
const { spendTokens, tokenSummary } = await import("../src/tokens/store.ts");
const { PLANS } = await import("../src/tokens/plan.ts");
const { listEntitlements } = await import("../src/entitlements/store.ts");
const { billingOverview, cancelPlan, changePlan, ChangeRefused, invoiceDocument, resumePlan, NotSubscribed } = await import("../src/billing/manage.ts");
const { registerBillingRoutes } = await import("../src/billing/routes.ts");
const { default: Fastify } = await import("fastify");
await migrate();

const U = "00000000-0000-4000-8000-0000000d0001", V = "00000000-0000-4000-8000-0000000d0002", M = "00000000-0000-4000-8000-0000000d0003";
const clean = async () => {
  for (const t of ["token_ledger", "subscriptions", "entitlements", "entitlement_events"]) await pool.query(`delete from app.${t} where user_id = any($1)`, [[U, V, M]]);
  await pool.query("delete from app.billing_events where payload::text like '%0000000d000%' or event_key like '%:7701:%' or event_key like 'cancel-reason:7701:%'");
};
await clean();

const day = 86_400_000, now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const remote = { variantId: 101, status: "active", cancelled: false, ends_at: null, renews_at: iso(now + 30 * day), updated_at: iso(now), clock: 0 };
const calls = [], changes = [];
let failing = false, refuseDelete = false;
const missing = new Set();
const attrs = () => ({
  variant_id: remote.variantId, status: remote.status, cancelled: remote.cancelled, ends_at: remote.ends_at, renews_at: remote.renews_at, created_at: iso(now), updated_at: iso(now + (remote.clock += 1000)),
  card_brand: "visa", card_last_four: "4242", user_email: "buyer@example.com",
  urls: { update_payment_method: "https://pay.example/update", customer_portal: "https://portal.example/p" }
});
const fakeApi = async (url, init = {}) => {
  const method = init.method ?? "GET", path = String(url).replace("https://api.lemonsqueezy.com/v1", "");
  calls.push(`${method} ${path.split("?")[0]}`);
  if (failing) return new Response("{}", { status: 500 });
  const gone = (kind) => missing.has(kind) && new Response("{}", { status: 404 });
  if (path.startsWith("/subscription-invoices") && gone("invoices")) return gone("invoices");
  if (path.startsWith("/variants/") && gone("variant")) return gone("variant");
  if (path === "/subscriptions/7701" && gone("subscription")) return gone("subscription");
  const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status });
  if (path.startsWith("/subscription-invoices")) return json([
    { id: "8002", type: "subscription-invoices", attributes: { status: "paid", total_formatted: "$19.00", refunded: false, created_at: iso(now - 1000), urls: { invoice_url: "https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/8002" } } },
    { id: "8001", type: "subscription-invoices", attributes: { status: "paid", total_formatted: "$19.00", discount_total: 1900, refunded: false, created_at: iso(now - 31 * day), urls: { invoice_url: "https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/8001" } } }
  ]);
  if (path === "/subscriptions/7701" && method === "DELETE") {
    if (refuseDelete) return new Response("{}", { status: 422 });
    remote.status = "cancelled"; remote.cancelled = true; remote.ends_at = remote.renews_at;
    return json({ id: "7701", type: "subscriptions", attributes: attrs() });
  }
  if (path.startsWith("/variants/")) return json({ id: path.split("/")[2], type: "variants", attributes: { product_id: 9 } });
  if (path === "/subscriptions/7701" && method === "PATCH" && "variant_id" in JSON.parse(init.body).data.attributes) {
    changes.push(JSON.parse(init.body).data.attributes);
    remote.variantId = JSON.parse(init.body).data.attributes.variant_id;
    return json({ id: "7701", type: "subscriptions", attributes: attrs() });
  }
  if (url === "https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/8002") return new Response(Buffer.from("%PDF-1.4 fake"), { status: 200, headers: { "content-type": "application/pdf" } });
  if (path === "/subscriptions/7701" && method === "PATCH") {
    assert.equal(JSON.parse(init.body).data.attributes.cancelled, false);
    remote.status = "active"; remote.cancelled = false; remote.ends_at = null;
    return json({ id: "7701", type: "subscriptions", attributes: attrs() });
  }
  if (path === "/subscriptions/7701") return json({ id: "7701", type: "subscriptions", attributes: attrs() });
  return new Response("{}", { status: 404 });
};
const hits = (re) => calls.filter((c) => re.test(c)).length;

try {
  // A paid Starter plan, bought and credited the normal way.
  await applyWebhook({ meta: { event_name: "subscription_created", custom_data: { user_id: U } }, data: { id: "7701", type: "subscriptions", attributes: attrs() } });
  assert.equal((await subscriptionFor(U)).tier, "starter");

  // Overview: plan, card, invoices, tokens; nothing for someone with no plan.
  const overview = await billingOverview(U, fakeApi);
  assert.equal(overview.subscription.planName, "Starter");
  assert.equal(overview.subscription.status, "active");
  assert.deepEqual(overview.subscription.paymentMethod, { brand: "visa", last4: "4242" });
  assert.equal(overview.subscription.updatePaymentUrl, "https://pay.example/update");
  assert.equal("portalUrl" in overview.subscription, false, "no link to Lemon Squeezy's portal");
  assert.deepEqual(overview.invoices.map((i) => [i.id, i.amount, i.status, i.discounted, i.url]), [["8002", "$19.00", "paid", false, "https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/8002"], ["8001", "$19.00", "paid", true, "https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/8001"]]);
  assert.deepEqual([overview.tokens.granted, overview.tokens.used, overview.tokens.remaining], [200, 0, 200]);
  assert.deepEqual(await billingOverview(V, fakeApi), { subscription: null, invoices: [], tokens: null });

  // Ownership: V has no plan and cannot touch U's; the subscription id is never taken from the request.
  await assert.rejects(cancelPlan(V, undefined, fakeApi), NotSubscribed);
  await assert.rejects(resumePlan(V, fakeApi), NotSubscribed);
  assert.equal(hits(/DELETE|PATCH/), 0, "nothing was sent to Lemon Squeezy for the other user");

  // Cancel: through the API, once; the plan and its tokens stay until the period ends.
  const cancelled = await cancelPlan(U, "  too expensive right now  ", fakeApi);
  assert.equal(hits(/DELETE/), 1);
  assert.equal(cancelled.tier, "starter");
  assert.equal(cancelled.cancelAtPeriodEnd, true);
  assert.ok(cancelled.endsAt, "shows when it ends");
  const kept = await billingOverview(U, fakeApi);
  assert.equal(kept.subscription.cancelAtPeriodEnd, true);
  assert.equal(kept.tokens.remaining, 200, "the remaining plan tokens are kept until the end");
  assert.equal((await pool.query("select payload from app.billing_events where name = 'cancel_reason' and user_id = $1", [U])).rows[0].payload.reason, "too expensive right now");
  // Idempotent: again, and the webhook that follows, change nothing and send nothing.
  await cancelPlan(U, undefined, fakeApi);
  assert.equal(hits(/DELETE/), 1, "a second cancel does not call Lemon Squeezy again");
  await applyWebhook({ meta: { event_name: "subscription_cancelled", custom_data: { user_id: U } }, data: { id: "7701", type: "subscriptions", attributes: attrs() } });
  assert.equal((await subscriptionFor(U)).cancelAtPeriodEnd, true);
  assert.equal((await billingOverview(U, fakeApi)).tokens.remaining, 200);

  // Resume: once, back to renewing; a second resume is a no-op.
  const resumed = await resumePlan(U, fakeApi);
  assert.equal(hits(/PATCH/), 1);
  assert.equal(resumed.cancelAtPeriodEnd, false);
  assert.equal(resumed.tier, "starter");
  await resumePlan(U, fakeApi);
  assert.equal(hits(/PATCH/), 1);
  assert.equal(Number((await pool.query("select count(*) from app.token_ledger where user_id = $1 and pool = 'plan' and kind = 'grant'", [U])).rows[0].count), 1, "cancel and resume never grant tokens");

  // A cancel Lemon Squeezy refuses because it is already cancelled there is still a cancel.
  refuseDelete = true; remote.status = "cancelled"; remote.cancelled = true; remote.ends_at = remote.renews_at;
  assert.equal((await cancelPlan(U, undefined, fakeApi)).cancelAtPeriodEnd, true);
  refuseDelete = false;
  await resumePlan(U, fakeApi);

  // Plan changes. Upgrade: applied now with proration; the token difference is credited once, however often the events repeat.
  const planGrantsTotal = async () => Number((await pool.query("select coalesce(sum(amount),0) s from app.token_ledger where user_id = $1 and pool = 'plan'", [U])).rows[0].s);
  assert.equal(await planGrantsTotal(), 200_000);
  const up = await changePlan(U, "pro", fakeApi);
  assert.equal(up.tier, "pro");
  assert.deepEqual(changes[0], { variant_id: 102, product_id: 9, invoice_immediately: true, disable_prorations: false });
  assert.equal(await planGrantsTotal(), 550_000, "Pro's 550 minus the 200 already granted this period is added: 350");
  await applyWebhook({ meta: { event_name: "subscription_updated", custom_data: { user_id: U } }, data: { id: "7701", type: "subscriptions", attributes: attrs() } });
  await changePlan(U, "pro", fakeApi);
  assert.equal(changes.length, 1, "asking for the plan you are on does not call Lemon Squeezy");
  assert.equal(await planGrantsTotal(), 550_000, "the webhook and a repeat add nothing");
  // Downgrade: Lemon Squeezy moves it now with proration off (nothing charged or credited); we keep Pro until the paid
  // period ends, read lazily at the boundary, and no tokens change.
  const periodEnd = new Date(remote.renews_at).getTime();
  const down = await changePlan(U, "starter", fakeApi);
  assert.deepEqual(changes[1], { variant_id: 101, product_id: 9, invoice_immediately: false, disable_prorations: true }, "no proration charge now");
  assert.deepEqual([down.tier, down.pendingTier, down.changesAt], ["pro", "starter", new Date(periodEnd).toISOString()], "still Pro until the period end, then Starter");
  assert.equal(await planGrantsTotal(), 550_000, "a downgrade keeps this period's tokens and adds none");
  const editor = (await listEntitlements(U)).find((r) => r.sourceRef === "7701");
  assert.deepEqual([editor?.status === "canceled", editor?.meta.tier, editor?.expiresAt && new Date(editor.expiresAt).getTime() >= periodEnd], [false, "pro", true], "the Pro editor entitlement stays until the period ends (plus the usual renewal slack, cancelled sooner by the renewal webhook)");
  assert.equal((await subscriptionFor(U, new Date(periodEnd - day))).tier, "pro", "features are Pro before the boundary");
  const after = await subscriptionFor(U, new Date(periodEnd + day));
  assert.deepEqual([after.tier, after.pendingTier], ["starter", null], "and Starter after it, with nothing run at the boundary");
  const waiting = await billingOverview(U, fakeApi);
  assert.deepEqual([waiting.subscription.planName, waiting.subscription.pendingChange.planName, waiting.subscription.pendingChange.at], ["Pro", "Starter", new Date(periodEnd).toISOString()]);
  await changePlan(U, "starter", fakeApi);
  assert.equal(changes.length, 2, "asking again for the plan it moves to does not call Lemon Squeezy");
  // Undo: asking for the plan still in force moves Lemon Squeezy back, again with no proration, and clears the wait.
  const undone = await changePlan(U, "pro", fakeApi);
  assert.deepEqual(changes[2], { variant_id: 102, product_id: 9, invoice_immediately: false, disable_prorations: true }, "undoing charges nothing (that period is paid)");
  assert.deepEqual([undone.tier, undone.pendingTier], ["pro", null]);
  assert.equal(await planGrantsTotal(), 550_000, "undoing adds no tokens");
  await changePlan(U, "starter", fakeApi);
  // Refused: not a plan, no plan, a cancelled plan.
  await assert.rejects(changePlan(U, "gold", fakeApi), ChangeRefused);
  await assert.rejects(changePlan(V, "pro", fakeApi), NotSubscribed);
  await cancelPlan(U, undefined, fakeApi);
  await assert.rejects(changePlan(U, "pro", fakeApi), ChangeRefused);
  await resumePlan(U, fakeApi);

  // Downgrade never touches the tokens already granted: they stay usable until the normal reset, nothing extra is granted,
  // and the next renewal grants the lower plan's amount once. (Plan is Starter here with 550 granted this period.)
  await spendTokens(U, 50_000, "test render", "downgrade-spend-1");
  const beforeDown = await tokenSummary(U);
  assert.deepEqual([beforeDown.plan.granted, beforeDown.plan.used, beforeDown.plan.remaining], [550, 50, 500], "the meter counts the upgrade's top-up in the same month");
  await changePlan(U, "pro", fakeApi);
  await changePlan(U, "starter", fakeApi);
  const afterDown = await tokenSummary(U);
  assert.deepEqual([afterDown.plan.granted, afterDown.plan.used, afterDown.plan.remaining], [550, 50, 500], "a downgrade leaves the period's tokens exactly as they were");
  assert.equal(Number((await pool.query("select count(*) from app.token_ledger where user_id = $1 and kind = 'expiry'", [U])).rows[0].count), 0, "and expires nothing");
  const renewalAt = iso(now + 30 * day);
  const renewalInvoice = { meta: { event_name: "subscription_payment_success", custom_data: { user_id: U } }, data: { id: "8101", type: "subscription-invoices", attributes: { subscription_id: 7701, billing_reason: "renewal", status: "paid", created_at: renewalAt, updated_at: renewalAt } } };
  await applyWebhook(renewalInvoice);
  await applyWebhook(renewalInvoice);
  assert.equal((await tokenSummary(U)).plan.remaining, PLANS.starter.tokens, "the renewal grants the lower plan's amount, once");
  assert.equal(Number((await pool.query("select count(*) from app.token_ledger where user_id = $1 and ref = 'invoice:8101'", [U])).rows[0].count), 1);
  // Climbing two steps in one month credits the top plan's allowance in total, no more.
  await changePlan(U, "pro", fakeApi);
  await changePlan(U, "business", fakeApi);
  const top = await tokenSummary(U);
  assert.equal(top.plan.granted, PLANS.business.tokens, "Starter to Pro to Business in one month adds up to Business's allowance, not more");
  assert.equal(top.plan.remaining, PLANS.business.tokens);
  await changePlan(U, "starter", fakeApi);
  assert.equal((await tokenSummary(U)).plan.remaining, PLANS.business.tokens, "and dropping back keeps them");
  // Back to a plain Starter plan for the scenarios below.
  remote.variantId = 101;
  await pool.query("update app.subscriptions set tier = 'starter', variant_id = '101', entitled_tier = null, entitled_until = null where provider_ref = '7701'");

  // Invoices: the document is fetched by our server, only for the caller's own invoice, only from Lemon Squeezy.
  const pdf = await invoiceDocument(U, "8002", fakeApi);
  assert.equal(pdf.contentType, "application/pdf");
  assert.equal(pdf.filename, "invoice-8002.pdf");
  assert.equal(pdf.body.toString().startsWith("%PDF"), true);
  await assert.rejects(invoiceDocument(U, "9999", fakeApi), NotSubscribed, "an invoice that is not the caller's");
  await assert.rejects(invoiceDocument(V, "8002", fakeApi), NotSubscribed, "another user's");

  // A 404 from Lemon Squeezy on one piece never blanks the modal: our own records fill in, and the piece is marked.
  const logged = [];
  const log = (details) => logged.push(details);
  missing.add("invoices");
  const noInvoices = await billingOverview(U, fakeApi, new Date(), log);
  assert.equal(noInvoices.invoicesAvailable, false);
  assert.deepEqual(noInvoices.invoices, []);
  assert.equal(noInvoices.subscription.planName, "Starter");
  assert.deepEqual(noInvoices.subscription.paymentMethod, { brand: "visa", last4: "4242" }, "the card still shows");
  assert.equal(noInvoices.tokens.remaining > 0, true);
  assert.equal(logged.at(-1).resource, "invoices", "the failing resource is logged");
  missing.clear();
  missing.add("subscription");
  const noSub = await billingOverview(U, fakeApi, new Date(), log);
  assert.equal(noSub.subscription.providerMissing, true);
  assert.equal(noSub.subscription.source, "lemonsqueezy");
  assert.deepEqual([noSub.subscription.planName, noSub.subscription.status, noSub.subscription.paymentMethod, noSub.subscription.updatePaymentUrl], ["Starter", "active", null, null], "plan and status come from our own record");
  assert.ok(noSub.subscription.renewsAt, "and so does the renewal date");
  assert.equal(noSub.tokens.remaining > 0, true);
  assert.equal(logged.at(-1).resource, "subscription");
  await assert.rejects(cancelPlan(U, undefined, fakeApi), (e) => e instanceof ChangeRefused && /couldn't find this subscription/.test(e.message), "a cancel of a subscription the provider does not know says so");
  missing.clear();
  missing.add("variant");
  await assert.rejects(changePlan(U, "pro", fakeApi), (e) => e instanceof ChangeRefused && /couldn't find/.test(e.message));
  missing.clear();
  // A plan set up by hand (manual:<user>) has no Lemon Squeezy subscription: no calls are made, and changes are refused kindly.
  await pool.query("insert into app.subscriptions (user_id, provider, provider_ref, variant_id, tier, billing_interval, status, renews_at, cancel_at_period_end) values ($1, 'manual', $2, 'manual', 'pro', 'month', 'active', $3, false)", [M, `manual:${M}`, iso(now + 30 * day)]);
  const callsBefore = calls.length;
  const manual = await billingOverview(M, fakeApi, new Date(), log);
  assert.equal(calls.length, callsBefore, "no Lemon Squeezy call for a manual plan");
  assert.deepEqual([manual.subscription.source, manual.subscription.providerMissing, manual.subscription.planName, manual.invoicesAvailable], ["manual", false, "Pro", true]);
  for (const action of [() => cancelPlan(M, undefined, fakeApi), () => changePlan(M, "starter", fakeApi)]) await assert.rejects(action(), (e) => e instanceof ChangeRefused && /set up by our team/.test(e.message));
  await assert.rejects(invoiceDocument(M, "8002", fakeApi), NotSubscribed);
  assert.equal(calls.length, callsBefore, "and none for those either");

  // Failures: the API down leaves our state alone and surfaces an error that carries the portal link (over HTTP).
  failing = true;
  await assert.rejects(cancelPlan(U, undefined, fakeApi));
  assert.equal((await subscriptionFor(U)).cancelAtPeriodEnd, false, "a failed cancel changes nothing");
  const app = Fastify();
  let caller = U;
  app.addHook("onRequest", async (request) => { request.user = { id: caller }; });
  await registerBillingRoutes(app);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeApi;
  try {
    const down = await app.inject({ method: "GET", url: "/v1/billing/overview" });
    assert.equal(down.statusCode, 502);
    assert.equal("portalUrl" in down.json().error, false, "an error never sends the user to Lemon Squeezy");
    failing = false;
    assert.equal((await app.inject({ method: "GET", url: "/v1/billing/overview" })).json().subscription.planName, "Starter");
    caller = V;
    assert.equal((await app.inject({ method: "GET", url: "/v1/billing/overview" })).json().subscription, null);
    assert.equal((await app.inject({ method: "POST", url: "/v1/billing/cancel", headers: { "content-type": "application/json" }, payload: '{"subscription":"7701"}' })).statusCode, 404, "another user cannot cancel it by naming it");
    assert.equal((await app.inject({ method: "POST", url: "/v1/billing/change-plan", headers: { "content-type": "application/json" }, payload: '{"product":"pro"}' })).statusCode, 404, "no plan, no change");
    assert.equal((await app.inject({ method: "GET", url: "/v1/billing/invoices/8002/pdf" })).statusCode, 404, "no plan, no invoice");
    caller = U;
    const file = await app.inject({ method: "GET", url: "/v1/billing/invoices/8002/pdf" });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers["content-type"], "application/pdf");
    assert.match(file.headers["content-disposition"], /attachment; filename="invoice-8002\.pdf"/);
    assert.equal((await app.inject({ method: "GET", url: "/v1/billing/invoices/abc/pdf" })).statusCode, 404);
    const viaHttp = await app.inject({ method: "POST", url: "/v1/billing/cancel", headers: { "content-type": "application/json" }, payload: '{"reason":"testing"}' });
    assert.equal(viaHttp.statusCode, 200);
    assert.equal(viaHttp.json().subscription.cancelAtPeriodEnd, true);
    assert.equal((await app.inject({ method: "POST", url: "/v1/billing/resume" })).json().subscription.cancelAtPeriodEnd, false);
  } finally { globalThis.fetch = realFetch; await app.close(); }
  console.log("billing-manage ok");
} finally {
  await clean();
  await pool.end();
}
