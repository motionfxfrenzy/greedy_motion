// Entitlement rules that need no database: what rows are worth at an exact instant, how a subscription maps onto a row
// (cancel at period end, payment failure grace), the per-replica cache, the fail-closed resolver, the CLI's parsing, and
// structural guarantees about where Pro state may be changed.
//
//   node test/entitlements-eval.mjs
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
const { evaluate, localEntitlements } = await import("../src/entitlements/evaluate.ts");
const { rowFromSubscription, LIFECYCLE_POLICY } = await import("../src/entitlements/lifecycle.ts");
const { EntitlementCache } = await import("../src/entitlements/cache.ts");
const { createResolver, EntitlementsUnavailable } = await import("../src/entitlements/resolve.ts");
const { parseExpiry, resolveUser, maskEmail, parseArgs, CliError } = await import("../src/entitlements/cli.ts");
const { requireProEdit, NotEntitled } = await import("../src/entitlements/access.ts");
const { requireDeclarations } = await import("../src/pro/routes.ts");
const { default: Fastify } = await import("fastify");

let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok - ${name}`); };

const T = (iso) => new Date(iso);
const NOW = T("2026-11-01T12:00:00.000Z");
const DAY = 86_400_000;
let seq = 0;
const row = (over = {}) => ({
  id: `row-${++seq}`, userId: "u", plan: "pro", status: "active", source: "manual", sourceRef: "", validFrom: T("2026-01-01T00:00:00Z"), expiresAt: null,
  cancelAtPeriodEnd: false, sourceUpdatedAt: null, grantedBy: "cli:test", note: null, meta: {}, createdAt: T("2026-01-01T00:00:00Z"), updatedAt: T("2026-01-01T00:00:00Z"), ...over
});
const access = (rows, now = NOW) => evaluate(rows, now).features.proEditor;

// ---------- evaluate ----------

await check("no rows: free plan, no Pro editor", () => {
  const e = evaluate([], NOW);
  assert.deepEqual([e.plan, e.features.proEditor, e.validUntil, e.source, e.reason], ["free", "none", null, null, null]);
});

await check("an active grant with no end date edits; one that ends later edits and reports when", () => {
  assert.equal(access([row()]), "edit");
  const e = evaluate([row({ expiresAt: T("2026-12-31T00:00:00Z") })], NOW);
  assert.equal(e.features.proEditor, "edit");
  assert.equal(e.plan, "pro");
  assert.equal(e.validUntil, "2026-12-31T00:00:00.000Z");
  assert.equal(e.source, "manual");
});

await check("expires_at is exclusive: edit one millisecond before, view-only at the instant", () => {
  const end = T("2026-11-05T00:00:00.000Z");
  const rows = [row({ expiresAt: end })];
  assert.equal(access(rows, new Date(end.getTime() - 1)), "edit");
  const at = evaluate(rows, end);
  assert.equal(at.features.proEditor, "view");
  assert.equal(at.reason, "expired");
  assert.equal(at.plan, "free");
});

await check("valid_from is inclusive; a future grant with no history is not a plan yet", () => {
  const start = T("2026-12-01T00:00:00Z");
  assert.equal(access([row({ validFrom: start })], new Date(start.getTime() - 1)), "none");
  assert.equal(access([row({ validFrom: start })], start), "edit");
});

await check("canceled and revoked end access at once, even with an end date still ahead", () => {
  const future = T("2027-01-01T00:00:00Z");
  const canceled = evaluate([row({ status: "canceled", expiresAt: future, updatedAt: T("2026-10-30T00:00:00Z") })], NOW);
  assert.equal(canceled.features.proEditor, "view");
  assert.equal(canceled.reason, "canceled");
  assert.equal(canceled.validUntil, "2026-10-30T00:00:00.000Z", "reports when it ended, not the future date");
  const revoked = evaluate([row({ status: "revoked", expiresAt: T("2026-10-31T00:00:00Z") })], NOW);
  assert.deepEqual([revoked.features.proEditor, revoked.reason], ["view", "revoked"]);
});

await check("a past-due subscription edits through its grace period and is view-only after it", () => {
  const graceEnd = T("2026-11-02T00:00:00Z");
  const rows = [row({ status: "past_due", source: "stripe", sourceRef: "sub_1", expiresAt: graceEnd })];
  assert.equal(access(rows, new Date(graceEnd.getTime() - 1)), "edit");
  const after = evaluate(rows, graceEnd);
  assert.deepEqual([after.features.proEditor, after.reason], ["view", "payment_failed"]);
});

await check("trialing counts like active inside its window", () => {
  assert.equal(access([row({ status: "trialing", expiresAt: T("2026-11-10T00:00:00Z") })]), "edit");
});

await check("several sources: the best one wins; a canceled subscription does not hide an active manual grant", () => {
  const manual = row({ expiresAt: T("2026-12-01T00:00:00Z") });
  const dead = row({ source: "stripe", sourceRef: "sub_1", status: "canceled", expiresAt: NOW });
  assert.equal(access([dead, manual]), "edit");
  const later = row({ source: "stripe", sourceRef: "sub_2", expiresAt: T("2027-06-01T00:00:00Z") });
  assert.equal(evaluate([manual, later], NOW).validUntil, "2027-06-01T00:00:00.000Z");
  const open = row({ sourceRef: "x" });
  assert.equal(evaluate([later, open], NOW).validUntil, null, "no end date beats any end date");
});

await check("the reason comes from whichever plan ended last", () => {
  const older = row({ status: "canceled", expiresAt: T("2026-06-01T00:00:00Z") });
  const newer = row({ source: "stripe", sourceRef: "s", status: "past_due", expiresAt: T("2026-10-20T00:00:00Z") });
  assert.equal(evaluate([older, newer], NOW).reason, "payment_failed");
});

await check("an unknown plan id grants nothing and counts as no history", () => {
  assert.equal(access([row({ plan: "enterprise" })]), "none");
  assert.equal(access([row({ plan: "enterprise" }), row({ status: "canceled", expiresAt: T("2026-01-02T00:00:00Z") })]), "view");
});

await check("local development (auth off) is always full access", () => {
  assert.deepEqual([localEntitlements(NOW).plan, localEntitlements(NOW).features.proEditor, localEntitlements(NOW).source], ["pro", "edit", "local"]);
});

// ---------- lifecycle: how a subscription becomes a row ----------

const periodEnd = T("2026-12-01T00:00:00Z");
const snap = (over = {}) => ({ status: "active", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, ...over });
const asRow = (fields, over = {}) => row({ source: "stripe", sourceRef: "sub_1", ...fields, ...over });

await check("renewing subscription: period end plus the renewal slack, so a late webhook does not cut a paying user off", () => {
  const f = rowFromSubscription(snap(), null, NOW);
  assert.equal(f.status, "active");
  assert.equal(f.expiresAt.getTime(), periodEnd.getTime() + LIFECYCLE_POLICY.renewalSlackMs);
});

await check("cancellation scheduled for period end: edit until the paid period ends, no slack, view-only from then", () => {
  const f = rowFromSubscription(snap({ cancelAtPeriodEnd: true }), null, NOW);
  assert.equal(f.status, "active");
  assert.equal(f.expiresAt.getTime(), periodEnd.getTime(), "exactly the paid period");
  assert.equal(f.cancelAtPeriodEnd, true);
  const rows = [asRow(f)];
  assert.equal(access(rows, new Date(periodEnd.getTime() - 1000)), "edit");
  assert.equal(access(rows, periodEnd), "view");
  assert.equal(evaluate(rows, new Date(periodEnd.getTime() - 1000)).cancelAtPeriodEnd, true);
});

await check("un-scheduling the cancellation restores the renewal slack", () => {
  const f = rowFromSubscription(snap({ cancelAtPeriodEnd: false }), { status: "active", meta: {} }, NOW);
  assert.equal(f.expiresAt.getTime(), periodEnd.getTime() + LIFECYCLE_POLICY.renewalSlackMs);
  assert.equal(f.cancelAtPeriodEnd, false);
});

await check("payment failure: edit through the grace period only, then view-only", () => {
  const failedAt = T("2026-11-01T00:00:00Z");
  const f = rowFromSubscription(snap({ status: "past_due", failedAt, invoiceId: "in_1" }), { status: "active", meta: {} }, NOW);
  assert.equal(f.status, "past_due");
  const graceEnd = failedAt.getTime() + LIFECYCLE_POLICY.graceMs;
  assert.equal(f.expiresAt.getTime(), graceEnd);
  const rows = [asRow(f)];
  assert.equal(access(rows, new Date(graceEnd - 1)), "edit");
  assert.equal(access(rows, new Date(graceEnd)), "view");
});

await check("retries and repeated failure events for the same invoice never extend the grace", () => {
  const first = rowFromSubscription(snap({ status: "past_due", failedAt: T("2026-11-01T00:00:00Z"), invoiceId: "in_1" }), { status: "active", meta: {} }, T("2026-11-01T00:00:05Z"));
  const stored = { status: "past_due", meta: first.meta };
  for (const later of ["2026-11-02T00:00:00Z", "2026-11-03T06:00:00Z"]) {
    const again = rowFromSubscription(snap({ status: "past_due", failedAt: T(later), invoiceId: "in_1" }), stored, T(later));
    assert.equal(again.expiresAt.getTime(), first.expiresAt.getTime(), `failure at ${later} did not move the end`);
  }
  const noTimestamp = rowFromSubscription(snap({ status: "past_due", invoiceId: "in_1" }), stored, T("2026-11-03T00:00:00Z"));
  assert.equal(noTimestamp.expiresAt.getTime(), first.expiresAt.getTime());
  const next = rowFromSubscription(snap({ status: "past_due", failedAt: T("2026-12-01T00:00:00Z"), invoiceId: "in_2" }), stored, T("2026-12-01T00:00:00Z"));
  assert.ok(next.expiresAt.getTime() > first.expiresAt.getTime(), "a different invoice starts its own grace");
});

await check("recovery after a failed payment is full access again", () => {
  const f = rowFromSubscription(snap(), { status: "past_due", meta: { firstFailureAt: "2026-11-01T00:00:00.000Z", graceInvoiceId: "in_1" } }, NOW);
  assert.equal(f.status, "active");
  assert.equal(access([asRow(f)]), "edit");
});

await check("deleted, unpaid and refunded subscriptions are view-only at once, even if the old period end is ahead", () => {
  for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
    const f = rowFromSubscription(snap({ status }), { status: "active", meta: {} }, NOW);
    assert.equal(f.status, "canceled");
    assert.equal(f.expiresAt.getTime(), NOW.getTime());
    assert.equal(access([asRow(f, { updatedAt: NOW })], NOW), "view");
  }
  const ended = T("2026-10-20T00:00:00Z");
  assert.equal(rowFromSubscription(snap({ status: "canceled", endedAt: ended }), null, NOW).expiresAt.getTime(), ended.getTime());
});

await check("a trial edits until the trial ends", () => {
  const trialEnd = T("2026-11-08T00:00:00Z");
  const f = rowFromSubscription(snap({ status: "trialing", trialEnd }), null, NOW);
  assert.equal(f.expiresAt.getTime(), trialEnd.getTime());
  assert.equal(access([asRow(f)]), "edit");
  assert.equal(access([asRow(f)], trialEnd), "view");
});

// ---------- cache and resolver ----------

await check("cache: hit inside the TTL, miss after it, delete forgets", () => {
  const cache = new EntitlementCache();
  cache.set("u", [row()], 1000);
  assert.ok(cache.get("u", 1999, 1000));
  assert.equal(cache.get("u", 2000, 1000), undefined);
  cache.set("u", [row()], 5000);
  cache.delete("u");
  assert.equal(cache.get("u", 5001, 1000), undefined);
});

function resolver({ rows = [row()], fail = false, ttlMs = 30_000, local = false } = {}) {
  let calls = 0;
  let clock = NOW.getTime();
  const r = createResolver({ load: async () => { calls++; if (fail) throw new Error("db down"); return rows; }, cache: new EntitlementCache(), ttlMs, local, now: () => clock });
  return { ...r, calls: () => calls, advance: (ms) => { clock += ms; } };
}

await check("resolver: caches within the TTL, reloads after, `fresh` always reloads, TTL 0 disables the cache", async () => {
  const r = resolver();
  await r.entitlementsFor("u"); await r.entitlementsFor("u");
  assert.equal(r.calls(), 1);
  await r.entitlementsFor("u", { fresh: true });
  assert.equal(r.calls(), 2);
  r.advance(31_000);
  await r.entitlementsFor("u");
  assert.equal(r.calls(), 3);
  const off = resolver({ ttlMs: 0 });
  await off.entitlementsFor("u"); await off.entitlementsFor("u");
  assert.equal(off.calls(), 2);
});

await check("resolver: negative answers are cached too, and a plan ending is noticed at its exact end even inside the TTL", async () => {
  const r = resolver({ rows: [] });
  assert.equal((await r.entitlementsFor("u")).features.proEditor, "none");
  await r.entitlementsFor("u");
  assert.equal(r.calls(), 1);
  const ending = resolver({ rows: [row({ expiresAt: new Date(NOW.getTime() + 10_000) })] });
  assert.equal((await ending.entitlementsFor("u")).features.proEditor, "edit");
  ending.advance(10_000);
  assert.equal((await ending.entitlementsFor("u")).features.proEditor, "view");
  assert.equal(ending.calls(), 1, "no reload was needed");
});

await check("resolver fails closed: a database error rejects, nothing is granted, nothing is cached", async () => {
  const r = resolver({ fail: true });
  await assert.rejects(r.entitlementsFor("u"), EntitlementsUnavailable);
  await assert.rejects(r.entitlementsFor("u"), EntitlementsUnavailable);
  assert.equal(r.calls(), 2);
});

await check("resolver: local mode never touches the database", async () => {
  const r = resolver({ local: true, fail: true });
  assert.equal((await r.entitlementsFor("anyone")).features.proEditor, "edit");
  assert.equal(r.calls(), 0);
});

// ---------- the capability ----------

await check("requireProEdit: only a request the gate resolved to full access mints the capability", () => {
  assert.equal(requireProEdit({ proAccess: "edit", proUserId: "u" }).userId, "u");
  for (const request of [{}, { proAccess: "view", proUserId: "u" }, { proAccess: "none", proUserId: "u" }, { proAccess: "edit" }])
    assert.throws(() => requireProEdit(request), NotEntitled);
});

await check("a Pro route that does not declare its access level fails the boot", async () => {
  const bad = Fastify();
  requireDeclarations(bad);
  assert.throws(() => bad.get("/v1/projects/:id/pro/new", async () => ({})), /must declare config\.proAccess/);
  const good = Fastify();
  requireDeclarations(good);
  assert.doesNotThrow(() => good.get("/x", { config: { proAccess: "view" } }, async () => ({})));
  assert.throws(() => good.post("/y", { config: { proAccess: "write" } }, async () => ({})), /must declare/);
});

await check("Pro state is changed only inside backend/src/pro and the project store (static check)", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(ts|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(join(root, "src"));
  await walk(join(root, "scripts"));
  const allowed = new Set(["src/pro/routes.ts", "src/pro/capability-types.ts", "src/projects/store.ts"]);
  const offenders = [];
  for (const file of files) {
    const rel = relative(root, file);
    if (allowed.has(rel)) continue;
    const text = await readFile(file, "utf8");
    if (/\bupdateProjectPro\b|\bproDir\b|\bwriteProFiles\b|\benqueueProRender\b|\bopenPro\b/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "only the Pro module may change Pro state");
  const producers = [];
  for (const file of files) {
    if (relative(root, file) === "src/pro/routes.ts") continue;
    if (/kind:\s*["']pro["']/.test(await readFile(file, "utf8"))) producers.push(relative(root, file));
  }
  assert.deepEqual(producers, [], "only POST /pro/render may create a job whose input kind is pro");
});

// ---------- CLI helpers ----------

await check("--until: a bare date ends that day in UTC (next midnight, exclusive); timestamps and --days work; junk and the past are refused", () => {
  assert.equal(parseExpiry({ until: "2026-12-31" }, NOW).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(parseExpiry({ until: "2026-12-31T18:00:00Z" }, NOW).toISOString(), "2026-12-31T18:00:00.000Z");
  assert.equal(parseExpiry({ days: "30" }, NOW).getTime(), NOW.getTime() + 30 * DAY);
  assert.equal(parseExpiry({}, NOW), null);
  for (const bad of [{ until: "next week" }, { until: "2026-02-30" }, { until: "2026-13-01" }, { until: "2026-12-31T18:00:00" }, { days: "0" }, { days: "-3" }, { days: "abc" }, { until: "2026-01-01" }, { until: "2026-12-31", days: "3" }])
    assert.throws(() => parseExpiry(bad, NOW), CliError, JSON.stringify(bad));
});

await check("user lookup: uuid and email resolve through auth.users; unknown, ambiguous and email-without-auth are refused", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const db = (users, present = true) => async (sql, params) => {
    if (sql.includes("to_regclass")) return { rows: [{ present }] };
    if (sql.includes("where id =")) return { rows: users.filter((u) => u.id === params[0]) };
    if (sql.includes("lower(email)")) return { rows: users.filter((u) => u.email.toLowerCase() === String(params[0]).toLowerCase()) };
    throw new Error(`unexpected ${sql}`);
  };
  assert.deepEqual(await resolveUser("Tester@Example.com", db([{ id, email: "tester@example.com" }])), { id, email: "tester@example.com" });
  assert.deepEqual(await resolveUser(id, db([{ id, email: "t@example.com" }])), { id, email: "t@example.com" });
  await assert.rejects(resolveUser("nobody@example.com", db([])), /must sign in once/);
  await assert.rejects(resolveUser("dup@example.com", db([{ id, email: "dup@example.com" }, { id: "x", email: "dup@example.com" }])), /More than one/);
  await assert.rejects(resolveUser(id, db([])), /No user with id/);
  await assert.rejects(resolveUser("someone@example.com", db([], false)), /pass the user's uuid/);
  assert.deepEqual(await resolveUser(id, db([], false)), { id, email: null });
  await assert.rejects(resolveUser("not-a-user", db([])), /neither an email nor a user id/);
  assert.equal(maskEmail("tester@example.com"), "te***@example.com");
});

await check("argument parsing: positionals, value flags, boolean flags, a missing value", () => {
  assert.deepEqual(parseArgs(["a@b.c", "--until", "2026-12-31", "--yes"], ["until"]), { positional: ["a@b.c"], options: { until: "2026-12-31", yes: true } });
  assert.throws(() => parseArgs(["--until"], ["until"]), CliError);
  assert.throws(() => parseArgs(["--until", "--yes"], ["until"]), CliError);
});

console.log(`\n${passed} passed`);
