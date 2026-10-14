// Each APP_ENV may only run against its own kind of services (backend/src/config.ts). Local: Compose Postgres, disk, the Compose
// worker. Staging and production: hosted Postgres, R2. Spawns the config module with different settings and checks the outcome.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const base = { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: "x", MEDIA_URL_SECRET: "x".repeat(40) };
const r2 = { STORAGE_DRIVER: "r2", R2_ENDPOINT: "https://example.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_UPLOADS_BUCKET: "u", R2_OUTPUTS_BUCKET: "o", R2_MEDIA_BUCKET: "m" };
const supabase = { AUTH_MODE: "supabase", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" };
const localDb = "postgres://videosaas:videosaas@localhost:55432/videosaas";
const cloudDb = "postgres://postgres:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
function load(env) {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", "const { config } = await import('./backend/src/config.ts'); console.log(JSON.stringify(config.environmentSummary));"], { cwd: root, env: { ...base, ...env }, encoding: "utf8" });
  return { ok: run.status === 0, out: run.stdout.trim(), err: run.stderr };
}
const expectFail = (name, env, text) => { const result = load(env); assert.equal(result.ok, false, `${name}: should have been refused`); assert.match(result.err, text, `${name}: wrong message\n${result.err.slice(-300)}`); console.log("ok", name); };
const expectOk = (name, env, check) => { const result = load(env); assert.equal(result.ok, true, `${name}: should have started\n${result.err.slice(-400)}`); if (check) check(JSON.parse(result.out.split("\n").pop())); console.log("ok", name); };

expectOk("local on local services", { APP_ENV: "local", DATABASE_URL: localDb }, (s) => { assert.equal(s.database, "localhost"); assert.equal(s.storage, "filesystem"); assert.equal(s.auth, "none"); });
expectOk("local signing in through a hosted Supabase project is allowed but flagged", { APP_ENV: "local", DATABASE_URL: localDb, ...supabase }, (s) => assert.match(s.note ?? "", /supabase start/));
expectOk("local with the Supabase CLI stack has no warning", { APP_ENV: "local", DATABASE_URL: localDb, AUTH_MODE: "supabase", SUPABASE_URL: "http://127.0.0.1:54321" }, (s) => assert.equal(s.note, null));
expectFail("local refuses a hosted database", { APP_ENV: "local", DATABASE_URL: cloudDb }, /DATABASE_URL points at .*supabase\.com/);
expectFail("local refuses R2 storage", { APP_ENV: "local", DATABASE_URL: localDb, ...r2 }, /STORAGE_DRIVER=r2 is a cloud setting/);
expectFail("local refuses launching cloud workers", { APP_ENV: "local", DATABASE_URL: localDb, WORKER_LAUNCH: "ecs", ECS_REGION: "ap-southeast-1", ECS_CLUSTER: "c", ECS_WORKER_TASK_DEFINITION: "t", ECS_SUBNETS: "s", ECS_SECURITY_GROUPS: "g" }, /WORKER_LAUNCH=ecs starts paid cloud workers/);
expectOk("the explicit escape hatch lets local use a hosted database", { APP_ENV: "local", DATABASE_URL: cloudDb, ALLOW_CLOUD_IN_LOCAL: "1" });
expectFail("staging refuses a local database", { APP_ENV: "staging", DATABASE_URL: localDb, ...r2, ...supabase }, /DATABASE_URL points at a local host/);
expectFail("staging refuses disk storage", { APP_ENV: "staging", DATABASE_URL: cloudDb, ...supabase }, /STORAGE_DRIVER=r2 is required/);
expectOk("staging on hosted services", { APP_ENV: "staging", DATABASE_URL: cloudDb, ...r2, ...supabase }, (s) => { assert.equal(s.storage, "r2"); assert.match(s.auth, /supabase\.co$/); });
console.log("Environment profiles passed.");
