// Pure helpers for scripts/entitlements.ts, kept free of side effects so they are unit-tested.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export class CliError extends Error {}

/**
 * `--until`: an ISO timestamp, or a bare date meaning the end of that day in UTC (stored as the next midnight, because
 * expires_at is exclusive). `--days N`: N days from now. Grants in the past are refused.
 */
export function parseExpiry(options: { until?: string; days?: string }, now: Date): Date | null {
  if (options.until !== undefined && options.days !== undefined) throw new CliError("Use --until or --days, not both.");
  let at: Date | null = null;
  if (options.days !== undefined) {
    const days = Number(options.days);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new CliError(`--days must be a number between 0 and 3650; got "${options.days}".`);
    at = new Date(now.getTime() + days * 86_400_000);
  } else if (options.until !== undefined) {
    const value = options.until.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const day = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) throw new CliError(`--until "${value}" is not a real date.`);
      at = new Date(day.getTime() + 86_400_000);
    } else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      at = new Date(value);
      if (Number.isNaN(at.getTime())) throw new CliError(`--until "${value}" is not a real timestamp.`);
    } else {
      throw new CliError(`--until must be a date (2026-12-31) or an ISO timestamp with a zone (2026-12-31T18:00:00Z); got "${options.until}".`);
    }
  }
  if (at && at.getTime() <= now.getTime()) throw new CliError("That end date is already in the past.");
  return at;
}

export type Run = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export type ResolvedUser = { id: string; email: string | null };

/**
 * An email or a uuid to a user. Emails resolve through Supabase's auth.users (exactly one match); where there is no auth
 * schema (local Postgres) only a uuid is accepted. A user the auth system does not know is refused, so a typo cannot
 * create an entitlement for nobody.
 */
export async function resolveUser(arg: string, run: Run): Promise<ResolvedUser> {
  const value = arg.trim();
  const present = Boolean((await run("select to_regclass('auth.users') is not null as present")).rows[0]?.present);
  if (isUuid(value)) {
    if (!present) return { id: value.toLowerCase(), email: null };
    const found = (await run("select id, email from auth.users where id = $1", [value])).rows;
    if (!found[0]) throw new CliError(`No user with id ${value} in this environment's auth system.`);
    return { id: String(found[0].id), email: found[0].email ? String(found[0].email) : null };
  }
  if (!value.includes("@")) throw new CliError(`"${arg}" is neither an email nor a user id (uuid).`);
  if (!present) throw new CliError("This database has no auth.users table (local Postgres), so pass the user's uuid instead of an email.");
  const found = (await run("select id, email from auth.users where lower(email) = lower($1)", [value])).rows;
  if (found.length === 0) throw new CliError(`No user with email ${maskEmail(value)} here. They must sign in once before they can be granted a plan.`);
  if (found.length > 1) throw new CliError(`More than one user matches ${maskEmail(value)}; use the user id.`);
  return { id: String(found[0].id), email: String(found[0].email) };
}

/** `ab***@example.com`: enough to recognise, not enough to harvest. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain ?? ""}`;
}

/** Splits `grant <user> --until x --yes` into positionals and options. Flags without a value are booleans. */
export function parseArgs(argv: string[], valueFlags: readonly string[]): { positional: string[]; options: Record<string, string | true> } {
  const positional: string[] = [];
  const options: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const name = arg.slice(2);
    if (valueFlags.includes(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new CliError(`--${name} needs a value.`);
      options[name] = next;
      i++;
    } else {
      options[name] = true;
    }
  }
  return { positional, options };
}
