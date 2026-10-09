// Postgres access for the backend: one shared pool plus a tiny forward-only migration runner.
// pg-boss manages its own schema ("pgboss"); application tables live in schema "app".
import { AsyncLocalStorage } from "node:async_hooks";
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

// ---------- Transactions ----------

type Transaction = { client: pg.PoolClient; afterCommit: Array<() => void> };
const transaction = new AsyncLocalStorage<Transaction>();

/** Runs a query on the current transaction (`withTransaction` / `withRowLock`) if there is one, otherwise on the pool. */
export function query<R extends pg.QueryResultRow>(text: string, params?: unknown[]) {
  return (transaction.getStore()?.client ?? pool).query<R>(text, params);
}

/** Runs `callback` once the current transaction has committed (never if it rolls back); at once outside a transaction. */
export function afterCommit(callback: () => void) {
  const current = transaction.getStore();
  if (current) current.afterCommit.push(callback);
  else callback();
}

async function runInTransaction<T>(operation: () => Promise<T>, prepare?: (client: pg.PoolClient) => Promise<void>): Promise<T> {
  const client = await pool.connect();
  const current: Transaction = { client, afterCommit: [] };
  try {
    await client.query("begin");
    await prepare?.(client);
    const result = await transaction.run(current, operation);
    await client.query("commit");
    for (const callback of current.afterCommit) {
      try { callback(); } catch (error) { console.error(JSON.stringify({ level: "error", event: "after_commit_failed", message: error instanceof Error ? error.message : String(error) })); }
    }
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `operation` in one transaction: `query()` calls inside it share the connection and commit or roll back together.
 * Called inside an existing transaction it joins that one, so helpers can be composed (a webhook handler wraps its
 * dedupe row and the entitlement change in one).
 */
export function withTransaction<T>(operation: () => Promise<T>): Promise<T> {
  return transaction.getStore() ? operation() : runInTransaction(operation);
}

/**
 * Runs `operation` in a transaction that holds `select … for update` on one row, so concurrent writers to the
 * same record (API requests, render consumers, other replicas) apply in turn and none loses another's fields.
 * Queries made through `query()` inside `operation` join the transaction.
 */
export function withRowLock<T>(table: "app.projects", id: string, operation: () => Promise<T>): Promise<T> {
  return runInTransaction(operation, async (client) => { await client.query(`select 1 from ${table} where id = $1 for update`, [id]); });
}
