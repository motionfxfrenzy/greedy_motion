// The billing modal's backend against a real Postgres and a fake, stateful Lemon Squeezy API: overview (plan, card,
// invoices, tokens), cancel at period end, resume, idempotency, ownership, and failures.
//   DATABASE_URL=postgres://… node test/billing-manage.mjs   (cleans up its own rows)
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
process.env.LEMONSQUEEZY_API_KEY = "k"; process.env.LEMONSQUEEZY_STORE_ID = "1";
process.env.LEMONSQUEEZY_VARIANT_STARTER = "101"; process.env.LEMONSQUEEZY_VARIANT_PRO = "102"; process.env.LEMONSQUEEZY_VARIANT_BUSINESS = "103"; process.env.LEMONSQUEEZY_VARIANT_TOPUP = "104";
const { migrate, pool } = await import("../src/db/database.ts");
const { applyWebhook, subscriptionFor } = await import("../src/billing/service.ts");
const { billingOverview, cancelPlan, resumePlan, NotSubscribed } = await import("../src/billing/manage.ts");
const { registerBillingRoutes } = await import("../src/billing/routes.ts");
const { default: Fastify } = await import("fastify");
await migrate();

const U = "00000000-0000-4000-8000-0000000d0001", V = "00000000-0000-4000-8000-0000000d0002";
const clean = async () => {
  for (const t of ["token_ledger", "subscriptions", "entitlements", "entitlement_events"]) await pool.query(`delete from app.${t} where user_id = any($1)`, [[U, V]]);
  await pool.query("delete from app.billing_events where payload::text like '%0000000d000%' or event_key like '%:7701:%' or event_key like 'cancel-reason:7701:%'");
};
await clean();

const day = 86_400_000, now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const remote = { status: "active", cancelled: false, ends_at: null, renews_at: iso(now + 30 * day), updated_at: iso(now), clock: 0 };
const calls = [];
let failing = false, refuseDelete = false;
const attrs = () => ({
  variant_id: 101, status: remote.status, cancelled: remote.cancelled, ends_at: remote.ends_at, renews_at: remote.renews_at, created_at: iso(now), updated_at: iso(now + (remote.clock += 1000)),
  card_brand: "visa", card_last_four: "4242", user_email: "buyer@example.com",
  urls: { update_payment_method: "https://pay.example/update", customer_portal: "https://portal.example/p" }
});
const fakeApi = async (url, init = {}) => {
  const method = init.method ?? "GET", path = String(url).replace("https://api.lemonsqueezy.com/v1", "");
  calls.push(`${method} ${path.split("?")[0]}`);
  if (failing) return new Response("{}", { status: 500 });
  const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status });
  if (path.startsWith("/subscription-invoices")) return json([
    { id: "8002", type: "subscription-invoices", attributes: { status: "paid", total_formatted: "$19.00", refunded: false, created_at: iso(now - 1000), urls: { invoice_url: "https://receipts.example/8002" } } },
    { id: "8001", type: "subscription-invoices", attributes: { status: "paid", total_formatted: "$19.00", refunded: false, created_at: iso(now - 31 * day), urls: { invoice_url: "https://receipts.example/8001" } } }
  ]);
  if (path === "/subscriptions/7701" && method === "DELETE") {
    if (refuseDelete) return new Response("{}", { status: 422 });
    remote.status = "cancelled"; remote.cancelled = true; remote.ends_at = remote.renews_at;
    return json({ id: "7701", type: "subscriptions", attributes: attrs() });
  }
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
  assert.equal(overview.subscription.portalUrl, "https://portal.example/p");
  assert.deepEqual(overview.invoices.map((i) => [i.id, i.amount, i.status, i.url]), [["8002", "$19.00", "paid", "https://receipts.example/8002"], ["8001", "$19.00", "paid", "https://receipts.example/8001"]]);
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
    assert.equal(down.json().error.portalUrl, "https://portal.example/p", "an error always carries the portal link");
    failing = false;
    assert.equal((await app.inject({ method: "GET", url: "/v1/billing/overview" })).json().subscription.planName, "Starter");
    caller = V;
    assert.equal((await app.inject({ method: "GET", url: "/v1/billing/overview" })).json().subscription, null);
    assert.equal((await app.inject({ method: "POST", url: "/v1/billing/cancel", headers: { "content-type": "application/json" }, payload: '{"subscription":"7701"}' })).statusCode, 404, "another user cannot cancel it by naming it");
    caller = U;
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
