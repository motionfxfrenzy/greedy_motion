// Token ledger against a real Postgres: the free allowance is 30 seconds, a render costs a quarter token per second, a
// repeated event is stored once, a refund puts tokens back, two renders cannot both spend the last tokens, users are
// isolated.   DATABASE_URL=postgres://… node test/tokens.mjs   (cleans up its own rows)
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
const { migrate, pool } = await import("../src/db/database.ts");
const { expirePlanTokens, grantTokens, InsufficientTokens, refundSpend, spendTokens, tokenSummary } = await import("../src/tokens/store.ts");
const { renderCostMillitokens, materialCostMillitokens, PLANS, secondsFromTokens } = await import("@videosaas/contracts");
await migrate();

const A = "00000000-0000-4000-8000-0000000f0001", B = "00000000-0000-4000-8000-0000000f0002";
const clean = () => pool.query("delete from app.token_ledger where user_id = any($1)", [[A, B]]);
await clean();
try {
  // The numbers the price list rests on.
  assert.equal(renderCostMillitokens(30), 7500, "30 s = 7.5 tokens");
  assert.equal(PLANS.free.tokens, 7.5);
  assert.equal(secondsFromTokens(PLANS.free.tokens), 30, "the free allowance is exactly 30 seconds");
  assert.equal(materialCostMillitokens(1), 40000, "$1 of generation costs 40 tokens");

  let s = await tokenSummary(A);
  assert.deepEqual([s.free.granted, s.free.used, s.remaining, s.plan], [7.5, 0, 7.5, null], "a new account gets the free allowance, once");
  s = await tokenSummary(A);
  assert.equal(s.free.granted, 7.5, "looking again does not grant again");

  // Many short films fit inside the 30 seconds; the next one does not.
  assert.equal((await spendTokens(A, renderCostMillitokens(10), "render", "job1")).charged, true);
  assert.equal((await spendTokens(A, renderCostMillitokens(10), "render", "job1")).charged, false, "the same event is stored once");
  await spendTokens(A, renderCostMillitokens(15), "render", "job2");
  s = await tokenSummary(A);
  assert.deepEqual([s.free.used, s.remaining], [6.25, 1.25]);
  await assert.rejects(() => spendTokens(A, renderCostMillitokens(6), "render", "job3"), InsufficientTokens, "6 s needs 1.5 tokens and 1.25 are left");
  assert.equal((await tokenSummary(A)).free.used, 6.25, "a refused spend moves nothing");
  await spendTokens(A, renderCostMillitokens(5), "render", "job4");
  assert.equal((await tokenSummary(A)).remaining, 0, "exactly 30 seconds were used");

  // A film that could not start gets its tokens back, once.
  await grantTokens(A, 10, "test pack", "cli:test", "order:t1", "pack");
  const job5 = await spendTokens(A, renderCostMillitokens(8), "render", "job5");
  const before = (await tokenSummary(A)).remaining;
  await refundSpend(A, job5.event); await refundSpend(A, job5.event);
  assert.equal((await tokenSummary(A)).remaining, before + 2, "refunded once, not twice");
  assert.equal(await grantTokens(A, 10, "test pack", "cli:test", "order:t1", "pack"), false, "a replayed order grants nothing");

  // Two renders started together cannot both spend what is left.
  await grantTokens(B, 1, "test", "cli:test");
  const results = await Promise.allSettled([spendTokens(B, 8000, "render", "r1"), spendTokens(B, 8000, "render", "r2")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "free allowance 7.5 + 1 = 8.5 tokens: one 8-token render fits, not two");

  assert.equal(8.5 - (await tokenSummary(B)).remaining, 8, "isolated from the other account");

  // Monthly plan tokens: a render spends them before free and pack tokens; the next month starts full and unused is gone.
  const C = "00000000-0000-4000-8000-0000000f0003";
  await pool.query("delete from app.token_ledger where user_id = $1", [C]);
  await grantTokens(C, 100, "Pro plan tokens", "lemonsqueezy", "invoice:m1", "plan");
  await grantTokens(C, 10, "pack", "lemonsqueezy", "order:m1", "pack");
  await spendTokens(C, 20000, "render", "m1a");
  let c = await tokenSummary(C);
  assert.deepEqual([c.plan.granted, c.plan.used, c.plan.remaining], [100, 20, 80], "20% of the month used");
  assert.equal(c.free.remaining, 7.5, "plan tokens are spent first: free is untouched");
  assert.equal(c.packs.remaining, 10);
  assert.equal(await expirePlanTokens(C, "expiry:inv2"), 80, "80 unused tokens expire at renewal");
  assert.equal(await expirePlanTokens(C, "expiry:inv2"), 0, "once");
  await grantTokens(C, 100, "Pro plan tokens", "lemonsqueezy", "invoice:m2", "plan");
  c = await tokenSummary(C);
  assert.deepEqual([c.plan.granted, c.plan.used, c.plan.remaining], [100, 0, 100], "the new month shows 0% used and a full allowance, not 180");
  assert.equal(c.remaining, 100 + 7.5 + 10);
  // A render bigger than the plan's tokens spills into free, then packs; a refund returns each part to its own pool.
  const big = await spendTokens(C, 110000, "render", "m2a");
  c = await tokenSummary(C);
  assert.deepEqual([c.plan.remaining, c.free.remaining, c.packs.remaining], [0, 0, 7.5], "100 plan + 7.5 free + 2.5 pack");
  await refundSpend(C, big.event);
  c = await tokenSummary(C);
  assert.deepEqual([c.plan.remaining, c.free.remaining, c.packs.remaining], [100, 7.5, 10], "refunded to the pools they came from");
  await pool.query("delete from app.token_ledger where user_id = $1", [C]);
  await assert.rejects(() => grantTokens(A, 0, "x", "cli:test"));
  console.log("tokens: ok");
} finally {
  await clean();
  await pool.end();
}
