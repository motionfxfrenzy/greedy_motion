// Cross-user isolation test. Starts a throwaway backend (AUTH_MODE=supabase, temp data dirs) that trusts a
// locally generated signing key, then checks that user B cannot see or touch user A's data.
// Run: node --env-file=.env test/ownership.mjs   (needs DATABASE_URL; creates no render jobs)
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
const issuerPort = 4890, apiPort = 4891;
const issuerBase = `http://127.0.0.1:${issuerPort}`;
const jwks = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); }).listen(issuerPort, "127.0.0.1");
const sign = (sub, extra = {}) => new SignJWT({ email: `${sub}@example.test`, ...extra }).setProtectedHeader({ alg: "ES256", kid: "test-key" })
  .setIssuer(`${issuerBase}/auth/v1`).setAudience("authenticated").setSubject(sub).setIssuedAt().setExpirationTime("10m").sign(privateKey);

const data = await mkdtemp(join(tmpdir(), "ownership-"));
const server = spawn("node", ["src/server.ts"], {
  env: { ...process.env, PORT: String(apiPort), HOST: "127.0.0.1", APP_ENV: "local", AUTH_MODE: "supabase", SUPABASE_URL: issuerBase, SUPABASE_JWKS_URL: `${issuerBase}/jwks`, EXPECTED_SUPABASE_PROJECT_REF: "", LEGACY_OWNER_ID: "", PROJECTS_DIR: join(data, "projects"), BRANDS_DIR: join(data, "brands"), LOG_LEVEL: "error" },
  stdio: ["ignore", "inherit", "inherit"]
});
const ALICE = "00000000-0000-4000-8000-00000000000a", BOB = "00000000-0000-4000-8000-00000000000b";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const cleanup = () => Promise.all([db.query("delete from app.projects where owner_id = any($1)", [[ALICE, BOB]]), db.query("delete from app.brand_kits where owner_id = any($1)", [[ALICE, BOB]])]);
const stop = async () => { server.kill("SIGTERM"); jwks.close(); await cleanup().catch(() => undefined); await db.end(); await rm(data, { recursive: true, force: true }); };
process.on("exit", () => server.kill());

const api = `http://127.0.0.1:${apiPort}`;
for (let i = 0; ; i++) {
  if (await fetch(`${api}/healthz`).then((r) => r.ok, () => false)) break;
  if (i > 60) { await stop(); throw new Error("backend did not start"); }
  await new Promise((r) => setTimeout(r, 500));
}

const call = async (token, method, path, body) => {
  const response = await fetch(api + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

await cleanup();
const alice = await sign(ALICE);
const bob = await sign(BOB);
const request = { prompt: "A launch video for the new dashboard", format: "landscape", style: "kinetic", theme: "neutral", template: "product-launch" };
let project, brand;

test("no token is rejected", async () => assert.equal((await call(null, "GET", "/v1/projects")).status, 401));
test("alice creates a project it owns", async () => {
  const response = await call(alice, "POST", "/v1/projects", { name: "Alice project", request });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  project = response.body;
  assert.equal(project.ownerId, "00000000-0000-4000-8000-00000000000a");
});
test("a client cannot choose the owner", async () => {
  const response = await call(bob, "POST", "/v1/projects", { name: "Forged", ownerId: "00000000-0000-4000-8000-00000000000a", request });
  assert.equal(response.status, 201);
  assert.equal(response.body.ownerId, "00000000-0000-4000-8000-00000000000b");
});
test("alice sees her project, bob sees only his own", async () => {
  const mine = (await call(alice, "GET", "/v1/projects")).body.projects.map((p) => p.name);
  const his = (await call(bob, "GET", "/v1/projects")).body.projects.map((p) => p.name);
  assert.deepEqual(mine, ["Alice project"]);
  assert.deepEqual(his, ["Forged"]);
});
test("bob gets 404 on alice's project for read, write, delete-style routes", async () => {
  for (const [method, path, body] of [["GET", `/v1/projects/${project.id}`], ["PUT", `/v1/projects/${project.id}`, { name: "pwned" }], ["PUT", `/v1/projects/${project.id}/approve`], ["POST", `/v1/projects/${project.id}/script`], ["POST", `/v1/projects/${project.id}/render`], ["POST", `/v1/projects/${project.id}/comments`, { text: "x" }], ["GET", `/v1/projects/${project.id}/composition`], ["PATCH", `/v1/projects/${project.id}/studio`, { values: {} }]]) {
    assert.equal((await call(bob, method, path, body)).status, 404, `${method} ${path}`);
  }
  assert.equal((await call(alice, "GET", `/v1/projects/${project.id}`)).body.name, "Alice project");
});
test("alice creates a brand kit, bob cannot see or use it", async () => {
  const response = await call(alice, "POST", "/v1/brands", { name: "Alice brand", colors: { primary: "#635BFF" }, fonts: { heading: { source: "bundled", family: "Inter" }, body: { source: "bundled", family: "Inter" } } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  brand = response.body;
  assert.deepEqual((await call(bob, "GET", "/v1/brands")).body.brands, []);
  assert.equal((await call(bob, "GET", `/v1/brands/${brand.id}`)).status, 404);
  assert.equal((await call(alice, "GET", `/v1/brands/${brand.id}`)).status, 200);
  const stolen = await call(bob, "POST", "/v1/projects", { name: "Uses alice brand", request: { ...request, brandId: brand.id } });
  assert.equal(stolen.status, 404, "bob must not attach alice's brand kit");
});
test("projects and brand kits are rows in Postgres with their owner", async () => {
  const projectRow = (await db.query("select owner_id, name from app.projects where id = $1", [project.id])).rows[0];
  assert.deepEqual(projectRow, { owner_id: ALICE, name: "Alice project" });
  const brandRow = (await db.query("select owner_id from app.brand_kits where id = $1", [brand.id])).rows[0];
  assert.equal(brandRow.owner_id, ALICE);
});
test("unowned (imported) records are hidden from signed-in users", async () => {
  const unowned = (await db.query("select count(*)::int as n from app.projects where owner_id is null")).rows[0].n;
  const listed = (await call(alice, "GET", "/v1/projects")).body.projects.length;
  assert.equal(listed, 1, `alice should see only her own project (${unowned} unowned rows exist)`);
});
test("concurrent writes to one project keep every change (row lock)", async () => {
  const renames = Array.from({ length: 6 }, (_, i) => call(alice, "PUT", `/v1/projects/${project.id}`, { name: `Renamed ${i}` }));
  const approve = call(alice, "PUT", `/v1/projects/${project.id}/approve`);
  const results = await Promise.all([...renames, approve]);
  assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status).join(","));
  const final = (await call(alice, "GET", `/v1/projects/${project.id}`)).body;
  assert.equal(final.state, "Approved", "approval was lost to a concurrent rename");
  assert.match(final.name, /^Renamed \d$/, "a rename was lost to the concurrent approval");
});
test("render jobs: unknown id is 404 for everyone", async () => assert.equal((await call(bob, "GET", "/v1/render-jobs/00000000-0000-4000-8000-0000000000ff")).status, 404));

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok   ", name); } catch (error) { failed++; console.log("FAIL ", name, "\n     ", error.message); }
}
await stop();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
