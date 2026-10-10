// Entitlements against a real Postgres and a real backend: grant and revoke through the script, what each state may do
// through the API (and that a refused mutation moves nothing), URL-spelling bypass attempts, isolation between users,
// fail-closed behaviour, and the contract a billing webhook will rely on (stale events, replays, transactions).
// Starts a throwaway backend (AUTH_MODE=supabase, temp data dirs) that trusts a locally generated signing key.
//
//   DATABASE_URL=postgres://… node test/entitlements.mjs      (creates and removes its own rows; never queues a render)
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
process.env.PLANNER ??= "deterministic";
const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
const issuerPort = 4892, apiPort = 4893;
const issuerBase = `http://127.0.0.1:${issuerPort}`;
const jwks = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); }).listen(issuerPort, "127.0.0.1");
const sign = (sub) => new SignJWT({ email: `${sub}@example.test` }).setProtectedHeader({ alg: "ES256", kid: "test-key" })
  .setIssuer(`${issuerBase}/auth/v1`).setAudience("authenticated").setSubject(sub).setIssuedAt().setExpirationTime("10m").sign(privateKey);

const ALICE = "00000000-0000-4000-8000-0000000e0001", BOB = "00000000-0000-4000-8000-0000000e0002", CAROL = "00000000-0000-4000-8000-0000000e0003", DAVE = "00000000-0000-4000-8000-0000000e0004";
const USERS = [ALICE, BOB, CAROL, DAVE];
const data = await mkdtemp(join(tmpdir(), "entitlements-"));
const baseEnv = { ...process.env, APP_ENV: "local", AUTH_MODE: "supabase", SUPABASE_URL: issuerBase, SUPABASE_JWKS_URL: `${issuerBase}/jwks`, EXPECTED_SUPABASE_PROJECT_REF: "", LEGACY_OWNER_ID: "", MEDIA_URL_SECRET: "entitlements-test-media-url-secret-0123456789", STORAGE_DRIVER: "filesystem", AUDIO_DIR: join(data, "audio"), PROJECTS_DIR: join(data, "projects"), BRANDS_DIR: join(data, "brands"), RENDER_OUTPUT_DIR: join(data, "renders"), LOG_LEVEL: "fatal", ENTITLEMENT_CACHE_SECONDS: "1" };
delete baseEnv.PRO_USER_IDS;
const server = spawn("node", ["src/server.ts"], { cwd: backendDir, env: { ...baseEnv, PORT: String(apiPort), HOST: "127.0.0.1" }, stdio: ["ignore", "inherit", "inherit"] });
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const cleanup = async () => {
  await db.query("delete from app.entitlement_events where user_id = any($1)", [USERS]);
  await db.query("delete from app.entitlements where user_id = any($1)", [USERS]);
  await db.query("delete from app.projects where owner_id = any($1)", [USERS]);
};
let renamed = false;
const stop = async () => {
  server.kill("SIGTERM"); jwks.close();
  if (renamed) await db.query("alter table app.entitlements_hidden rename to entitlements").catch(() => undefined);
  await cleanup().catch(() => undefined); await db.end(); await rm(data, { recursive: true, force: true });
};
process.on("exit", () => server.kill());

const api = `http://127.0.0.1:${apiPort}`;
for (let i = 0; ; i++) {
  if (await fetch(`${api}/healthz`).then((r) => r.ok, () => false)) break;
  if (i > 80) { await stop(); throw new Error("backend did not start"); }
  await new Promise((r) => setTimeout(r, 500));
}

const call = async (token, method, path, body) => {
  const response = await fetch(api + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(1200); // the server's entitlement cache lives 1 s here
const script = (args, env = {}) => new Promise((resolve) => {
  const child = spawn("node", ["scripts/entitlements.ts", ...args], { cwd: backendDir, env: { ...baseEnv, ...env } });
  let out = "";
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => resolve({ code, out }));
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
await cleanup();
const [alice, bob, carol] = [await sign(ALICE), await sign(BOB), await sign(CAROL)];
const request = { prompt: "A launch video for the new dashboard", format: "landscape", style: "kinetic", theme: "neutral", template: "product-launch" };
const makeProject = async (token) => (await call(token, "POST", "/v1/projects", { name: "Entitlement test", request })).body;
const treeHash = async (dir) => {
  const hash = createHash("sha256");
  const walk = async (d) => {
    for (const entry of (await readdir(d, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full); else hash.update(full.slice(dir.length)).update(await readFile(full));
    }
  };
  await walk(dir);
  return hash.digest("hex");
};
const queueCount = async () => (await db.query("select count(*)::int as n from pgboss.job where name = 'render-video'").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
const state = async (projectId) => ({
  tree: await treeHash(join(data, "projects", projectId, "pro")),
  manifest: JSON.stringify((await db.query("select data->'pro' as pro from app.projects where id = $1", [projectId])).rows[0].pro),
  jobs: (await db.query("select count(*)::int as n from app.render_jobs")).rows[0].n,
  queue: await queueCount()
});

let aliceProject, bobProject;

test("the migration created the tables with their constraints", async () => {
  const tables = (await db.query("select table_name from information_schema.tables where table_schema = 'app' and table_name in ('entitlements', 'entitlement_events')")).rows.map((r) => r.table_name).sort();
  assert.deepEqual(tables, ["entitlement_events", "entitlements"]);
  await assert.rejects(db.query("insert into app.entitlements (user_id, plan, status, source, granted_by) values ($1, 'pro', 'bogus', 'manual', 'x')", [DAVE]), /check/);
  await db.query("insert into app.entitlements (user_id, plan, status, source, granted_by) values ($1, 'pro', 'active', 'manual', 'x')", [DAVE]);
  await assert.rejects(db.query("insert into app.entitlements (user_id, plan, status, source, granted_by) values ($1, 'pro', 'active', 'manual', 'y')", [DAVE]), /unique/);
  await db.query("delete from app.entitlements where user_id = $1", [DAVE]);
});

test("no token is rejected", async () => assert.equal((await call(null, "GET", "/v1/me/entitlements")).status, 401));

test("a user with no plan: free, no Pro editor, and every Pro route refuses (including HEAD)", async () => {
  const me = await call(alice, "GET", "/v1/me/entitlements");
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.plan, me.body.features.proEditor, me.body.validUntil, me.body.source, me.body.reason], ["free", "none", null, null, null]);
  aliceProject = await makeProject(alice);
  const base = `/v1/projects/${aliceProject.id}/pro`;
  for (const [method, path, body] of [["GET", base], ["GET", `${base}/file`], ["POST", `${base}/lint`, {}], ["POST", `${base}/open`, { source: "blank" }], ["PUT", `${base}/files`, { baseRev: 1, files: [] }], ["POST", `${base}/render`, { quality: "final" }], ["HEAD", base]]) {
    const response = await fetch(api + path, { method, headers: { Authorization: `Bearer ${alice}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 403, `${method} ${path}`);
    if (method !== "HEAD") assert.equal((await response.json()).error.code, "not_pro");
  }
});

test("the script grants a plan; the API sees it, and Pro editing works", async () => {
  const { code, out } = await script(["grant", ALICE, "--note", "tester"]);
  assert.equal(code, 0, out);
  assert.match(out, /Done \(applied\)/);
  await settle();
  const me = (await call(alice, "GET", "/v1/me/entitlements")).body;
  assert.deepEqual([me.plan, me.features.proEditor, me.source, me.validUntil], ["pro", "edit", "manual", null]);
  const open = await call(alice, "POST", `/v1/projects/${aliceProject.id}/pro/open`, { source: "blank" });
  assert.equal(open.status, 201, JSON.stringify(open.body));
  const pro = await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro`);
  assert.equal(pro.body.access, "edit");
  const file = await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro/file`);
  assert.equal(file.status, 200);
  const saved = await call(alice, "PUT", `/v1/projects/${aliceProject.id}/pro/files`, { baseRev: 1, files: [{ path: "index.html", content: file.body.content.replace("</body>", "<!-- edited --></body>") }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await call(alice, "POST", `/v1/projects/${aliceProject.id}/pro/lint`, {})).status, 200);
  assert.equal((await call(alice, "POST", `/v1/projects/${aliceProject.id}/pro/render`, { quality: "nonsense" })).status, 400, "an edit user gets past the gate (and is refused for the bad quality, not the plan)");
  const events = (await db.query("select actor, action, event_id from app.entitlement_events where user_id = $1 order by id", [ALICE])).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "grant");
  assert.match(events[0].actor, /^cli:/);
});

test("granting again with another end date extends, it does not duplicate", async () => {
  const { code, out } = await script(["grant", ALICE, "--until", "2099-12-31"]);
  assert.equal(code, 0, out);
  assert.equal((await db.query("select count(*)::int as n from app.entitlements where user_id = $1", [ALICE])).rows[0].n, 1);
  const actions = (await db.query("select action from app.entitlement_events where user_id = $1 order by id", [ALICE])).rows.map((r) => r.action);
  assert.deepEqual(actions, ["grant", "extend"]);
  const me = (await call(alice, "GET", "/v1/me/entitlements")).body;
  assert.equal(me.validUntil, "2100-01-01T00:00:00.000Z");
  assert.equal(me.features.proEditor, "edit");
});

// The mutations a lapsed or never-pro user must not be able to make, in every spelling the router accepts.
const mutations = (projectId) => {
  const base = `/v1/projects/${projectId}/pro`;
  const encoded = `/v1/projects/${projectId}/%70ro`;
  return [
    ["POST", `${base}/open`, { source: "blank" }], ["POST", `${base}/open`, { source: "beat-plan" }],
    ["PUT", `${base}/files`, { baseRev: 2, files: [{ path: "index.html", content: "<p>x</p>" }] }],
    ["POST", `${base}/render`, { quality: "draft540" }], ["POST", `${base}/render`, { quality: "preview720" }], ["POST", `${base}/render`, { quality: "final" }], ["POST", `${base}/render`, {}],
    ["POST", `${encoded}/open`, { source: "blank" }], ["PUT", `${encoded}/files`, { baseRev: 2, files: [{ path: "index.html", content: "<p>x</p>" }] }], ["POST", `${encoded}/render`, { quality: "final" }],
    ["POST", `${base}/%6fpen`, { source: "blank" }], ["PUT", `${base}/%66iles`, { baseRev: 2, files: [] }], ["POST", `${base}/rend%65r`, { quality: "final" }],
    ["POST", `${base}/open/`, {}], ["POST", `${base}//open`, {}], ["POST", `${base}/OPEN`, {}], ["POST", `${base}/open;x=1`, {}], ["POST", `${base}/unknown-new-route`, {}], ["DELETE", base, undefined], ["PATCH", base, {}]
  ];
};
async function assertRefused(token, projectId, expectedCode, label) {
  for (const [method, path, body] of mutations(projectId)) {
    const response = await call(token, method, path, body);
    assert.ok(response.status >= 400, `${label}: ${method} ${path} was ${response.status}`);
    if (response.status === 403) assert.equal(response.body.error.code, expectedCode, `${label}: ${method} ${path}`);
    else assert.ok([404, 405].includes(response.status), `${label}: ${method} ${path} answered ${response.status}`);
  }
}

test("revoke: view-only. Reads still work and the files are byte-identical; every mutation is refused and moves nothing", async () => {
  const before = await state(aliceProject.id);
  const manifestBefore = (await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro`)).body.pro;
  const fileBefore = (await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro/file`)).body.content;
  const { code, out } = await script(["revoke", ALICE]);
  assert.equal(code, 0, out);
  assert.match(out, /files are untouched/);
  await settle();
  const me = (await call(alice, "GET", "/v1/me/entitlements")).body;
  assert.deepEqual([me.plan, me.features.proEditor, me.reason], ["free", "view", "revoked"]);
  const pro = await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro`);
  assert.equal(pro.status, 200);
  assert.equal(pro.body.access, "view");
  assert.deepEqual(pro.body.pro, manifestBefore);
  assert.equal((await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro/file`)).body.content, fileBefore);
  assert.equal((await call(alice, "POST", `/v1/projects/${aliceProject.id}/pro/lint`, {})).status, 200);
  await assertRefused(alice, aliceProject.id, "read_only", "view");
  assert.deepEqual(await state(aliceProject.id), before, "a refused mutation changed files, manifest, jobs or the queue");
  const events = (await db.query("select action from app.entitlement_events where user_id = $1 order by id", [ALICE])).rows.map((r) => r.action);
  assert.deepEqual(events, ["grant", "extend", "revoke"]);
});

test("the Studio flow cannot write Pro state: PUT /projects/:id ignores `pro` and the render pointer cannot be pointed at a Pro job", async () => {
  const before = await state(aliceProject.id);
  const put = await call(alice, "PUT", `/v1/projects/${aliceProject.id}`, { name: "Renamed", pro: { rev: 99, files: {}, entry: "evil.html" } });
  assert.equal(put.status, 200);
  assert.equal(put.body.pro?.rev, before.manifest ? JSON.parse(before.manifest).rev : undefined);
  assert.deepEqual(await state(aliceProject.id), before);
});

test("a user who never had a plan is refused on every route and spelling with not_pro, on their own project and on someone else's", async () => {
  bobProject = await makeProject(bob);
  const before = { alice: await state(aliceProject.id) };
  await assertRefused(bob, bobProject.id, "not_pro", "none/own");
  await assertRefused(bob, aliceProject.id, "not_pro", "none/other");
  assert.deepEqual({ alice: await state(aliceProject.id) }, before);
  assert.equal((await db.query("select data->'pro' as pro from app.projects where id = $1", [bobProject.id])).rows[0].pro, null);
});

test("a plan with a past end date is view-only (expired); a future one edits", async () => {
  await db.query("update app.entitlements set status = 'active', expires_at = now() - interval '1 hour' where user_id = $1", [ALICE]);
  await settle();
  let me = (await call(alice, "GET", "/v1/me/entitlements")).body;
  assert.deepEqual([me.features.proEditor, me.reason], ["view", "expired"]);
  assert.equal((await call(alice, "PUT", `/v1/projects/${aliceProject.id}/pro/files`, { baseRev: 2, files: [] })).body.error.code, "read_only");
  await db.query("update app.entitlements set expires_at = now() + interval '1 day' where user_id = $1", [ALICE]);
  await settle();
  me = (await call(alice, "GET", "/v1/me/entitlements")).body;
  assert.equal(me.features.proEditor, "edit");
  assert.equal((await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro`)).body.access, "edit");
});

test("a scheduled cancellation keeps editing until the period ends; the end then arrives by itself", async () => {
  await db.query("update app.entitlements set cancel_at_period_end = true, expires_at = now() + interval '2 seconds' where user_id = $1", [ALICE]);
  const me = (await call(alice, "GET", "/v1/me/entitlements")).body;
  assert.deepEqual([me.features.proEditor, me.cancelAtPeriodEnd], ["edit", true]);
  assert.equal((await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro`)).body.access, "edit");
  await sleep(2500);
  assert.equal((await call(alice, "GET", `/v1/projects/${aliceProject.id}/pro`)).body.access, "view", "the rows are cached but the end date is still honoured on time");
  assert.equal((await call(alice, "PUT", `/v1/projects/${aliceProject.id}/pro/files`, { baseRev: 2, files: [] })).body.error.code, "read_only");
});

test("isolation: one user's plan is not another's, and there is no way to ask about someone else", async () => {
  await script(["grant", CAROL]);
  await settle();
  assert.equal((await call(carol, "GET", "/v1/me/entitlements")).body.features.proEditor, "edit");
  assert.equal((await call(bob, "GET", `/v1/me/entitlements?userId=${CAROL}`)).body.features.proEditor, "none");
  assert.equal((await call(bob, "GET", "/v1/me/entitlements")).body.features.proEditor, "none");
  const carolProject = await makeProject(carol);
  assert.equal((await call(carol, "POST", `/v1/projects/${carolProject.id}/pro/open`, { source: "blank" })).status, 201);
  assert.equal((await call(carol, "POST", `/v1/projects/${bobProject.id}/pro/open`, { source: "blank" })).status, 404, "a plan does not open someone else's project");
  assert.equal((await db.query("select data->'pro' as pro from app.projects where id = $1", [bobProject.id])).rows[0].pro, null);
});

test("script safety outside local development: a dry run by default, --by required, --yes writes", async () => {
  const staging = { APP_ENV: "staging" };
  let result = await script(["grant", DAVE], staging);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /--by/);
  result = await script(["grant", DAVE, "--by", "osama"], staging);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /DRY RUN/);
  assert.equal((await db.query("select count(*)::int as n from app.entitlements where user_id = $1", [DAVE])).rows[0].n, 0);
  result = await script(["grant", DAVE, "--by", "osama", "--yes", "--days", "5"], staging);
  assert.equal(result.code, 0, result.out);
  const row = (await db.query("select granted_by, expires_at from app.entitlements where user_id = $1", [DAVE])).rows[0];
  assert.equal(row.granted_by, "cli:osama");
  assert.ok(row.expires_at > new Date());
  result = await script(["revoke", DAVE, "--by", "osama"], staging);
  assert.match(result.out, /DRY RUN/);
  assert.equal((await db.query("select status from app.entitlements where user_id = $1", [DAVE])).rows[0].status, "active");
  result = await script(["revoke", DAVE, "--by", "osama", "--yes"], staging);
  assert.equal((await db.query("select status from app.entitlements where user_id = $1", [DAVE])).rows[0].status, "revoked");
  result = await script(["grant", "someone@example.com", "--by", "osama", "--yes"], staging);
  assert.equal(result.code, 1);
  assert.match(result.out, /no auth\.users|must sign in once|pass the user's uuid/);
  result = await script(["grant", DAVE, "--until", "2001-01-01"]);
  assert.equal(result.code, 1);
  assert.match(result.out, /in the past/);
  await db.query("delete from app.entitlements where user_id = $1", [DAVE]);
});

test("fail closed: with the entitlement table unreachable the Pro routes answer 503, never allow, and Studio routes keep working", async () => {
  await db.query("alter table app.entitlements rename to entitlements_hidden");
  renamed = true;
  try {
    await settle();
    for (const [token, path] of [[carol, `/v1/projects/${bobProject.id}/pro`], [alice, `/v1/projects/${aliceProject.id}/pro`], [carol, "/v1/me/entitlements"]]) {
      const response = await call(token, "GET", path);
      assert.equal(response.status, 503, path);
      assert.equal(response.body.error.code, "entitlements_unavailable");
    }
    assert.equal((await call(carol, "POST", `/v1/projects/${bobProject.id}/pro/open`, { source: "blank" })).status, 503);
    assert.equal((await call(alice, "GET", "/v1/projects")).status, 200, "the rest of the app is unaffected");
  } finally {
    await db.query("alter table app.entitlements_hidden rename to entitlements");
    renamed = false;
  }
  await settle();
  assert.equal((await call(carol, "GET", "/v1/me/entitlements")).status, 200);
});

// ---------- what a billing webhook will rely on ----------

test("webhook contract: newer events apply, older ones are ignored and logged, replays change nothing, writes are atomic", async () => {
  process.env.PLANNER = "deterministic";
  const { upsertEntitlement, listEntitlements } = await import("../src/entitlements/store.ts");
  const { withTransaction } = await import("../src/db/database.ts");
  await db.query("delete from app.entitlement_events where user_id = $1", [DAVE]);
  const base = { userId: DAVE, plan: "pro", status: "active", source: "stripe", sourceRef: "sub_test" };
  const at = (n) => new Date(Date.UTC(2026, 10, 1, 0, 0, n));
  const audit = (n) => ({ actor: "stripe", eventId: `evt_${n}`, action: "customer.subscription.updated" });
  const rowsOf = async () => (await listEntitlements(DAVE)).filter((r) => r.sourceRef === "sub_test");

  const first = await upsertEntitlement({ ...base, expiresAt: at(100), sourceUpdatedAt: at(10) }, audit(1));
  assert.equal(first.result, "applied");
  const replay = await upsertEntitlement({ ...base, expiresAt: at(100), sourceUpdatedAt: at(10) }, audit(1));
  assert.equal(replay.result, "unchanged");
  const newer = await upsertEntitlement({ ...base, status: "past_due", expiresAt: at(200), sourceUpdatedAt: at(20) }, audit(2));
  assert.equal(newer.result, "applied");
  const older = await upsertEntitlement({ ...base, status: "active", expiresAt: at(999), sourceUpdatedAt: at(15) }, audit(3));
  assert.equal(older.result, "stale");
  const [row] = await rowsOf();
  assert.deepEqual([row.status, row.expiresAt.getTime()], ["past_due", at(200).getTime()], "the older event did not overwrite the newer state");
  const log = (await db.query("select action, event_id from app.entitlement_events where user_id = $1 order by id", [DAVE])).rows;
  assert.deepEqual(log.map((r) => r.action), ["customer.subscription.updated", "customer.subscription.updated", "stale_ignored"]);
  assert.equal(log.filter((r) => r.event_id === "evt_1").length, 1, "the replay logged nothing");

  // One transaction around a dedupe row and the change: if the caller throws, the change is not kept.
  await assert.rejects(withTransaction(async () => {
    await upsertEntitlement({ ...base, status: "canceled", expiresAt: at(300), sourceUpdatedAt: at(30) }, audit(4));
    throw new Error("handler failed after applying");
  }), /handler failed/);
  assert.equal((await rowsOf())[0].status, "past_due");
  assert.equal((await db.query("select count(*)::int as n from app.entitlement_events where user_id = $1", [DAVE])).rows[0].n, 3, "the audit row rolled back with it");

  // Twenty deliveries of the same subscription at once, in scrambled order: the newest wins, the unique key holds.
  const order = Array.from({ length: 20 }, (_, i) => i + 40).sort(() => Math.random() - 0.5);
  const results = await Promise.all(order.map((n) => upsertEntitlement({ ...base, expiresAt: at(1000 + n), sourceUpdatedAt: at(n) }, audit(n))));
  assert.ok(results.every((r) => ["applied", "stale", "unchanged"].includes(r.result)));
  const final = await rowsOf();
  assert.equal(final.length, 1);
  assert.equal(final[0].sourceUpdatedAt.getTime(), at(59).getTime());
  assert.equal(final[0].expiresAt.getTime(), at(1059).getTime());
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok   ", name); } catch (error) { failed++; console.log("FAIL ", name, "\n     ", error.message); }
}
await stop();
const { pool } = await import("../src/db/database.ts");
await pool.end();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
