// Return-from-checkout sync against a real Postgres, with a fake Lemon Squeezy API. A webhook and a sync for the same
// purchase (in either order, and repeated, and concurrently) credit the plan tokens exactly once; another user's
// subscription is never taken.   DATABASE_URL=postgres://… node test/billing-sync.mjs   (cleans up its own rows)
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
process.env.LEMONSQUEEZY_API_KEY = "k"; process.env.LEMONSQUEEZY_STORE_ID = "1";
process.env.LEMONSQUEEZY_VARIANT_STARTER = "101"; process.env.LEMONSQUEEZY_VARIANT_PRO = "102"; process.env.LEMONSQUEEZY_VARIANT_BUSINESS = "103"; process.env.LEMONSQUEEZY_VARIANT_TOPUP = "104";
const { migrate, pool } = await import("../src/db/database.ts");
const { applyWebhook, syncPurchase, subscriptionFor } = await import("../src/billing/service.ts");
const { returnUrlFor } = await import("../src/billing/lemonsqueezy.ts");
await migrate();

const U = "00000000-0000-4000-8000-0000000c0001", V = "00000000-0000-4000-8000-0000000c0002";
const clean = async () => {
  for (const t of ["token_ledger", "subscriptions", "entitlements", "entitlement_events"]) await pool.query(`delete from app.${t} where user_id = any($1)`, [[U, V]]);
  await pool.query("delete from app.billing_events where payload::text like '%0000000c000%'");
};
const planGrants = async (user) => Number((await pool.query("select count(*) from app.token_ledger where user_id = $1 and ref like 'invoice:%'", [user])).rows[0].count);
await clean();

const day = 86_400_000, now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const subAttrs = { variant_id: 101, status: "active", user_email: "buyer@example.com", renews_at: iso(now + 30 * day), ends_at: null, cancelled: false, urls: {}, created_at: iso(now), updated_at: iso(now) };
const invAttrs = { subscription_id: 7001, billing_reason: "initial", status: "paid", created_at: iso(now), updated_at: iso(now) };
const calls = [];
const fakeApi = (async (url) => {
  calls.push(String(url));
  const data = String(url).includes("/subscription-invoices") ? [{ id: "8001", type: "subscription-invoices", attributes: invAttrs }] : [{ id: "7001", type: "subscriptions", attributes: subAttrs }];
  return new Response(JSON.stringify({ data }), { status: 200 });
});
const webhooks = () => [
  { meta: { event_name: "subscription_created", custom_data: { user_id: U } }, data: { id: "7001", type: "subscriptions", attributes: subAttrs } },
  { meta: { event_name: "subscription_payment_success", custom_data: { user_id: U } }, data: { id: "8001", type: "subscription-invoices", attributes: invAttrs } }
];

try {
  // Return URL lands on the tokens section and carries the flag.
  const url = new URL(returnUrlFor("plan", "https://app.example/profile"));
  assert.equal(url.pathname + url.search + url.hash, "/profile?checkout=success&item=plan#tokens");

  // 1. Sync first (webhook not here yet): plan and tokens are granted at once.
  const first = await syncPurchase(U, "buyer@example.com", fakeApi);
  assert.equal(first.synced, true);
  assert.equal((await subscriptionFor(U)).tier, "starter");
  assert.equal(await planGrants(U), 1);
  // 2. The real webhooks arrive afterwards: nothing is credited again.
  for (const body of webhooks()) await applyWebhook(body);
  assert.equal(await planGrants(U), 1, "webhook after sync does not double-credit");
  // 3. Repeated and concurrent syncs: still once.
  await Promise.all([syncPurchase(U, "buyer@example.com", fakeApi), syncPurchase(U, "buyer@example.com", fakeApi), syncPurchase(U, "buyer@example.com", fakeApi)]);
  assert.equal(await planGrants(U), 1, "repeat/concurrent syncs do not double-credit");
  const balance = Number((await pool.query("select coalesce(sum(amount),0) s from app.token_ledger where user_id = $1", [U])).rows[0].s);
  assert.equal(balance, 200_000, "exactly the Starter allowance (200 tokens)");

  // 4. Webhook first, then sync, for a second user: same result.
  await clean();
  for (const body of webhooks()) await applyWebhook(body);
  assert.equal(await planGrants(U), 1);
  await syncPurchase(U, "buyer@example.com", fakeApi);
  assert.equal(await planGrants(U), 1, "sync after webhook does not double-credit");

  // 5. Someone else's subscription (already stored for U) is not taken by V, even with a matching email.
  const stolen = await syncPurchase(V, "buyer@example.com", fakeApi);
  assert.equal(stolen.synced, false);
  assert.equal(await planGrants(V), 0);
  assert.equal((await subscriptionFor(V)).tier, "free");
  // 6. Email mismatch and no email do nothing.
  assert.equal((await syncPurchase(V, "other@example.com", fakeApi)).synced, false);
  assert.equal((await syncPurchase(V, undefined, fakeApi)).synced, false);
  // 7. Nothing paid yet: free, and no grant.
  const empty = await syncPurchase(V, "none@example.com", async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  assert.equal(empty.synced, false);
  console.log("billing-sync ok");
} finally {
  await clean();
  await pool.end();
}
