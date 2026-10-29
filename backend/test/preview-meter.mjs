// Preview allowance (plan/preview-meter.ts): Free gets 3 films for the account, paid plans a number per calendar month; work on
// a film already counted is not counted again; one film has a call cap; concurrent requests cannot take the last place.
// Run: node --env-file=.env test/preview-meter.mjs   (needs DATABASE_URL)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.APP_ENV ??= "local";
const { migrate, pool } = await import("../src/db/database.ts");
const { admitPreview, previewsUsed, previewPeriod } = await import("../src/plan/preview-meter.ts");
const { PREVIEW_ALLOWANCE, PREVIEW_CALL_CAP } = await import("@videosaas/contracts");
await migrate();

const users = [];
const user = () => { const id = randomUUID(); users.push(id); return id; };
try {
  // Free: 3 films ever, the fourth is refused with the way forward.
  const free = user();
  const films = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const film of films.slice(0, 3)) assert.equal(await admitPreview(free, film, "free"), null);
  const refused = await admitPreview(free, films[3], "free");
  assert.equal(refused?.error.code, "preview_limit");
  assert.match(refused.error.message, /3 free previews.*Choose a plan/);
  assert.equal(await previewsUsed(free, "free"), 3, "a refused film is not counted");
  assert.equal(await admitPreview(free, films[0], "free"), null, "more work on a counted film is allowed");
  assert.equal(await admitPreview(free, films[0], "free", new Date("2027-03-01")), null, "Free is for the account, not the month");
  assert.equal((await admitPreview(free, films[3], "free", new Date("2027-03-01")))?.error.code, "preview_limit", "and it does not come back next month");

  // A paid plan counts per calendar month and resets on the 1st.
  const paid = user();
  const october = new Date("2026-10-15T12:00:00Z"), november = new Date("2026-11-01T00:00:01Z");
  assert.equal(previewPeriod("starter", october), "2026-10");
  for (let i = 0; i < PREVIEW_ALLOWANCE.starter; i++) assert.equal(await admitPreview(paid, randomUUID(), "starter", october), null);
  const full = await admitPreview(paid, randomUUID(), "starter", october);
  assert.equal(full?.error.code, "preview_limit");
  assert.match(full.error.message, /15 films this month.*Starter.*resets on the 1st; Pro allows 45/);
  assert.equal(await admitPreview(paid, randomUUID(), "starter", november), null, "a new month starts again");
  assert.equal(await admitPreview(paid, randomUUID(), "pro", october), null, "moving up to Pro in the same month raises the allowance");

  // The call cap inside one film.
  const capped = user(), film = randomUUID();
  assert.equal(await admitPreview(capped, film, "pro"), null);
  await pool.query("update app.preview_usage set calls = $3 where user_id = $1 and project_id = $2", [capped, film, PREVIEW_CALL_CAP - 1]);
  assert.equal(await admitPreview(capped, film, "pro"), null);
  assert.equal((await admitPreview(capped, film, "pro"))?.error.code, "preview_call_cap");

  // Five requests at once for a Free account with 2 places left: exactly 2 get in.
  const racer = user();
  await admitPreview(racer, randomUUID(), "free");
  const results = await Promise.all(Array.from({ length: 5 }, () => admitPreview(racer, randomUUID(), "free")));
  assert.equal(results.filter((r) => r === null).length, 2, "the last places cannot be taken twice");
  assert.equal(await previewsUsed(racer, "free"), 3);

  // People do not share an allowance.
  assert.equal(await admitPreview(user(), randomUUID(), "free"), null);
  console.log("preview meter: ok");
} finally {
  await pool.query("delete from app.preview_usage where user_id = any($1)", [users]);
  await pool.end();
}
