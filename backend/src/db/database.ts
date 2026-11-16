// Postgres access for the backend: one shared pool plus a tiny forward-only migration runner.
// pg-boss manages its own schema ("pgboss"); application tables live in schema "app".
import { AsyncLocalStorage } from "node:async_hooks";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.ts";

/** A request must never wait forever for a connection: acquiring one times out and the error names who asked (see instrumentPool). */
export const POOL_ACQUIRE_TIMEOUT_MS = Number.parseInt(process.env.DATABASE_ACQUIRE_TIMEOUT_MS ?? "10000", 10) || 10_000;
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.databasePoolSize, connectionTimeoutMillis: POOL_ACQUIRE_TIMEOUT_MS });
pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "postgres_pool_error", message: error.message })));

// ---------- Diagnostics: who holds the pool, and who waits on a lock while holding a connection ----------
const dbLog = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));
/** The first stack frame outside this file, so a log line says which function asked for the connection. */
const callerOf = (): string => (new Error().stack ?? "").split("\n").slice(2).map((l) => l.trim()).find((l) => !l.includes("db/database.ts") && !l.includes("node:internal")) ?? "unknown";
type Held = { caller: string; since: number; locks: string[] };
const held = new Set<Held>();
export function poolStats() {
  return {
    total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: config.databasePoolSize,
    holders: [...held].map((h) => ({ caller: h.caller, heldMs: Date.now() - h.since, locks: h.locks })).sort((a, b) => b.heldMs - a.heldMs).slice(0, 12)
  };
}
const LOCK_SQL = /pg_advisory(?:_xact)?_lock/;
function instrumentClient(client: pg.PoolClient, caller: string): void {
  const entry: Held = { caller, since: Date.now(), locks: [] };
  held.add(entry);
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | undefined)?.text ?? "";
    if (!LOCK_SQL.test(text)) return query(...args);
    const key = String(Array.isArray(args[1]) ? args[1][0] : text.slice(0, 60));
    const started = Date.now();
    entry.locks.push(key + " (waiting)");
    const result = query(...args) as Promise<unknown>;
    return result.finally(() => {
      const waited = Date.now() - started;
      entry.locks[entry.locks.length - 1] = key;
      if (waited > 200) dbLog("warn", "db_lock_wait", { key, waitedMs: waited, caller, heldByOthers: [...held].filter((h) => h !== entry && h.locks.includes(key)).slice(0, 4).map((h) => ({ caller: h.caller, heldMs: Date.now() - h.since })) });
    });
  };
  const release = client.release.bind(client);
  client.release = (err?: Error | boolean) => {
    held.delete(entry);
    const heldMs = Date.now() - entry.since;
    if (entry.locks.length && heldMs > 500) dbLog("warn", "db_lock_held", { locks: entry.locks, heldMs, caller });
    return release(err);
  };
}
const rawConnect = pool.connect.bind(pool) as (cb?: unknown) => unknown;
(pool as unknown as { connect: (cb?: unknown) => unknown }).connect = (cb?: unknown) => {
  const caller = callerOf();
  const requested = Date.now();
  const noteTimeout = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout exceeded when trying to connect/i.test(message)) dbLog("error", "db_acquire_timeout", { caller, waitedMs: Date.now() - requested, ...poolStats() });
  };
  if (typeof cb === "function") {
    return rawConnect((err: Error | undefined, client: pg.PoolClient | undefined, done: () => void) => {
      if (err) noteTimeout(err); else if (client) instrumentClient(client, caller);
      (cb as (e: Error | undefined, c: pg.PoolClient | undefined, d: () => void) => void)(err, client, done);
    });
  }
  return (rawConnect() as Promise<pg.PoolClient>).then((client) => { instrumentClient(client, caller); return client; }, (error) => { noteTimeout(error); throw error; });
};
setInterval(() => { dbLog("info", "pool_stats", poolStats()); }, 10_000).unref();

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

// The readiness probe uses its own single connection, so it never queues behind work in the pool (the pool being starved is exactly
// what it must report, with the pool's numbers, not hang on).
let probe: pg.Client | null = null;
async function probeClient(): Promise<pg.Client> {
  if (probe) return probe;
  const client = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 4000 });
  client.on("error", () => { if (probe === client) probe = null; });
  await client.connect();
  probe = client;
  return client;
}
export async function databaseReady(): Promise<{ ok: boolean; pool: ReturnType<typeof poolStats> }> {
  try {
    await (await probeClient()).query("select 1");
    const stats = poolStats();
    return { ok: true, pool: stats };
  } catch (error) {
    const old = probe; probe = null; void old?.end().catch(() => undefined);
    const stats = poolStats();
    dbLog("error", "readyz_timeout", { message: error instanceof Error ? error.message : String(error), ...stats });
    return { ok: false, pool: stats };
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
