// Token ledger against a real Postgres: the free allowance is 30 seconds, a render costs a quarter token per second, a
// repeated event is stored once, a refund puts tokens back, two renders cannot both spend the last tokens, users are
// isolated.   DATABASE_URL=postgres://… node test/tokens.mjs   (cleans up its own rows)
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
const { migrate, pool } = await import("../src/db/database.ts");
const { expirePlanTokens, grantTokens, InsufficientTokens, refundSpend, spendTokens, tokenSummary } = await import("../src/tokens/store.ts");
const { renderCostMillitokens, materialCostMillitokens, PLANS, filmsFromTokens } = await import("@videosaas/contracts");
await migrate();

const A = "00000000-0000-4000-8000-0000000f0001", B = "00000000-0000-4000-8000-0000000f0002";
const clean = () => pool.query("delete from app.token_ledger where user_id = any($1)", [[A, B]]);
await clean();
try {
  // The numbers the price list rests on.
  assert.equal(renderCostMillitokens(30), 15000, "30 s = 6 tokens to start + 9 = 15 tokens");
  assert.equal(PLANS.free.tokens, 33);
  assert.equal(filmsFromTokens(PLANS.free.tokens, 90), 1, "the free allowance is one film of up to 90 seconds");
  assert.equal(materialCostMillitokens(1), 30000, "$1 of generation costs 30 tokens");

  let s = await tokenSummary(A);
  assert.deepEqual([s.free.granted, s.free.used, s.remaining, s.plan], [33, 0, 33, null], "a new account gets the free allowance, once");
  s = await tokenSummary(A);
  assert.equal(s.free.granted, 33, "looking again does not grant again");

  // A 5 s film (6 + 1.5 tokens) fits inside the 33 free tokens; a 100 s film (36 tokens) does not fit in what is left.
  assert.equal((await spendTokens(A, renderCostMillitokens(5), "render", "job1")).charged, true);
  assert.equal((await spendTokens(A, renderCostMillitokens(5), "render", "job1")).charged, false, "the same event is stored once");
  s = await tokenSummary(A);
  assert.deepEqual([s.free.used, s.remaining], [7.5, 25.5]);
  await assert.rejects(() => spendTokens(A, renderCostMillitokens(100), "render", "job3"), InsufficientTokens, "100 s needs 36 tokens and 25.5 are left");
  assert.equal((await tokenSummary(A)).free.used, 7.5, "a refused spend moves nothing");
  await spendTokens(A, 25500, "render", "job4");
  assert.equal((await tokenSummary(A)).remaining, 0, "exactly the 33 free tokens were used");

  // A film that could not start gets its tokens back, once.
  await grantTokens(A, 10, "test pack", "cli:test", "order:t1", "pack");
  const job5 = await spendTokens(A, renderCostMillitokens(8), "render", "job5");
  const before = (await tokenSummary(A)).remaining;
  await refundSpend(A, job5.event); await refundSpend(A, job5.event);
  assert.equal((await tokenSummary(A)).remaining, before + 8.4, "refunded once, not twice");
  assert.equal(await grantTokens(A, 10, "test pack", "cli:test", "order:t1", "pack"), false, "a replayed order grants nothing");

  // Two renders started together cannot both spend what is left.
  await grantTokens(B, 1, "test", "cli:test");
  const results = await Promise.allSettled([spendTokens(B, 20000, "render", "r1"), spendTokens(B, 20000, "render", "r2")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "free allowance 33 + 1 = 34 tokens: one 20-token render fits, not two");

  assert.equal(34 - (await tokenSummary(B)).remaining, 20, "isolated from the other account");

  // Monthly plan tokens: a render spends them before free and pack tokens; the next month starts full and unused is gone.
  const C = "00000000-0000-4000-8000-0000000f0003";
  await pool.query("delete from app.token_ledger where user_id = $1", [C]);
  await grantTokens(C, 100, "Pro plan tokens", "lemonsqueezy", "invoice:m1", "plan");
  await grantTokens(C, 10, "pack", "lemonsqueezy", "order:m1", "pack");
  await spendTokens(C, 20000, "render", "m1a");
  let c = await tokenSummary(C);
  assert.deepEqual([c.plan.granted, c.plan.used, c.plan.remaining], [100, 20, 80], "20% of the month used");
  assert.equal(c.free.remaining, 33, "plan tokens are spent first: free is untouched");
  assert.equal(c.packs.remaining, 10);
  assert.equal(await expirePlanTokens(C, "expiry:inv2"), 80, "80 unused tokens expire at renewal");
  assert.equal(await expirePlanTokens(C, "expiry:inv2"), 0, "once");
  await grantTokens(C, 100, "Pro plan tokens", "lemonsqueezy", "invoice:m2", "plan");
  c = await tokenSummary(C);
  assert.deepEqual([c.plan.granted, c.plan.used, c.plan.remaining], [100, 0, 100], "the new month shows 0% used and a full allowance, not 180");
  assert.equal(c.remaining, 100 + 33 + 10);
  // A render bigger than the plan's tokens spills into free, then packs; a refund returns each part to its own pool.
  const big = await spendTokens(C, 110000, "render", "m2a");
  c = await tokenSummary(C);
  assert.deepEqual([c.plan.remaining, c.free.remaining, c.packs.remaining], [0, 23, 10], "100 plan + 10 of the 33 free tokens");
  await refundSpend(C, big.event);
  c = await tokenSummary(C);
  assert.deepEqual([c.plan.remaining, c.free.remaining, c.packs.remaining], [100, 33, 10], "refunded to the pools they came from");
  await pool.query("delete from app.token_ledger where user_id = $1", [C]);
  await assert.rejects(() => grantTokens(A, 0, "x", "cli:test"));
  console.log("tokens: ok");
} finally {
  await clean();
  await pool.end();
}
