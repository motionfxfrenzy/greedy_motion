// Revisions: the first 3 changes to a film are included, each further one takes 2 tokens, and a revision that fails or changes
// nothing is given back. Run: node --env-file=.env test/revision-meter.mjs   (needs DATABASE_URL)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.APP_ENV ??= "local";
const { migrate, pool } = await import("../src/db/database.ts");
const { takeRevision, undoRevision, revisionInfo } = await import("../src/plan/revision-meter.ts");
const { grantTokens, spendTokens, tokenSummary, InsufficientTokens } = await import("../src/tokens/store.ts");
await migrate();
const user = randomUUID(), film = randomUUID(), other = randomUUID();
const balance = async () => (await tokenSummary(user)).remaining;
try {
  await grantTokens(user, 5, "test", "cli:test", `order:${user}`, "pack");
  const start = await balance();           // 11 free + 5 pack
  // The first three are included.
  for (let i = 0; i < 3; i++) { const t = await takeRevision(user, film, "starter"); assert.equal(t.event, null); }
  assert.equal(await balance(), start, "three revisions cost nothing");
  assert.deepEqual(await revisionInfo(user, film, "starter"), { used: 3, free: 3, tokens: 2 });
  // The fourth takes 2 tokens, and gives them back if it did not happen.
  const fourth = await takeRevision(user, film, "starter");
  assert.ok(fourth.event);
  assert.equal(await balance(), start - 2);
  await undoRevision(fourth);
  assert.equal(await balance(), start, "tokens returned");
  assert.equal((await revisionInfo(user, film, "starter")).used, 3, "and the count with them");
  // Another film has its own three.
  assert.equal((await takeRevision(user, other, "starter")).event, null);
  // Not enough tokens: refused, and nothing stays counted.
  await takeRevision(user, film, "starter"); await takeRevision(user, film, "starter");   // 4th and 5th, 4 tokens
  assert.equal((await tokenSummary(user)).remaining, start - 4);
  const left = Math.round((await balance()) * 1000);
  await spendTokens(user, left - 1000, "test", `drain:${user}`);
  assert.equal(Math.round((await balance()) * 1000) / 1000, 1, "one token left");
  const before = (await revisionInfo(user, film, "starter")).used;
  await assert.rejects(() => takeRevision(user, film, "starter"), InsufficientTokens);
  assert.equal((await revisionInfo(user, film, "starter")).used, before, "a refused revision is not counted");
  // Five at once with 3 free places left on a new film: all counted exactly, none lost to a race.
  const racing = randomUUID();
  await Promise.all(Array.from({ length: 3 }, () => takeRevision(user, racing, "starter")));
  assert.equal((await revisionInfo(user, racing, "starter")).used, 3);
  console.log("revision meter: ok");
} finally {
  await pool.query("delete from app.preview_usage where user_id = $1", [user]);
  await pool.query("delete from app.token_ledger where user_id = $1", [user]);
  await pool.end();
}
