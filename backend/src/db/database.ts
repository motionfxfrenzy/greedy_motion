// Postgres access for the backend: one shared pool plus a tiny forward-only migration runner.
// pg-boss manages its own schema ("pgboss"); application tables live in schema "app".
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.ts";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.databasePoolSize });
pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "postgres_pool_error", message: error.message })));

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
// Any constant shared by every backend replica; serializes concurrent startups.
const MIGRATION_LOCK = 482_113;

/** Applies `migrations/NNN_name.sql` files in order, each once, inside a transaction. */
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query("create schema if not exists app");
    await client.query("create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    const applied = new Set((await client.query<{ name: string }>("select name from app.schema_migrations")).rows.map((row) => row.name));
    const files = (await readdir(migrationsDir)).filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into app.schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(JSON.stringify({ level: "info", event: "migration_applied", name: file }));
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function databaseReady() {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
