// The render quote (render/quote.ts): the price shown is the price charged. Pure: the same function and the same rounding.
// Run: node test/render-quote.mjs   (no database)
import assert from "node:assert/strict";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
const { quoteFrom } = await import("../src/render/quote.ts");
const { renderCostMillitokens, tokensFromMilli } = await import("@videosaas/contracts");
const none = { required: false, owedTokens: 0 };

// A film of 65.833 s is charged for 66 s: 6 tokens to start + 66 x 0.3 = 25.8.
let q = quoteFrom({ ok: true, durationSeconds: 65.833 }, none, 100);
assert.equal(q.seconds, 66);
assert.equal(q.tokens, 25.8);
assert.deepEqual(q.parts, { start: 6, perSecond: 0.3, seconds: 66 });
assert.equal(q.enough, true);
// The quote is exactly what the render takes, for every length (the render charges renderCostMillitokens of the same seconds).
for (const seconds of [0.2, 1, 14.99, 15, 29.5, 65.833, 66.5, 90, 119.1]) {
  const charged = tokensFromMilli(renderCostMillitokens(seconds));
  assert.equal(quoteFrom({ ok: true, durationSeconds: seconds }, none, 0).tokens, charged, `${seconds} s`);
}
// Not enough tokens, a storyboard that is not ready, and no storyboard yet.
assert.equal(quoteFrom({ ok: true, durationSeconds: 30 }, none, 14.9).enough, false);
assert.equal(quoteFrom({ ok: true, durationSeconds: 30 }, none, 15).enough, true, "15 tokens pay for exactly 15");
assert.equal(quoteFrom({ ok: false, durationSeconds: 30 }, none, 99).ready, false);
q = quoteFrom({ ok: false, durationSeconds: null }, none, 99);
assert.deepEqual([q.seconds, q.tokens, q.enough], [null, null, false]);
// Generated scenes are shown beside it, not added to it: they are paid when they are generated.
q = quoteFrom({ ok: true, durationSeconds: 40 }, { required: true, owedTokens: 28.2 }, 100);
assert.deepEqual(q.material, { required: true, owedTokens: 28.2 });
assert.equal(q.tokens, 18);
console.log("render quote: ok");
