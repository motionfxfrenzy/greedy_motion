// Grants, revokes and inspects entitlements (the Pro editor today) without a deploy. It writes through the same store
// the backend uses, and every change is recorded in app.entitlement_events.
//
//   node --env-file=.env scripts/entitlements.ts grant  <email|uuid> [--plan pro] [--until 2026-12-31 | --days 30] [--note "..."] [--by name] [--yes]
//   node --env-file=.env scripts/entitlements.ts revoke <email|uuid> [--by name] [--yes]
//   node --env-file=.env scripts/entitlements.ts show   <email|uuid>
//   node --env-file=.env scripts/entitlements.ts list   [--active]
//
// On staging and production run it inside the deployed backend, so no database URL ever sits on a laptop:
//   railway ssh --project <id> --environment staging --service backend -- node /app/backend/scripts/entitlements.ts grant someone@example.com --by osama --yes
// Outside APP_ENV=local a change is a dry run (nothing is written) unless --yes is given, and --by names who is doing it.
// The script does not run migrations: the backend applies them when it starts.
import { config } from "../src/config.ts";
import { pool } from "../src/db/database.ts";
import { evaluate, grantsAccess } from "../src/entitlements/evaluate.ts";
import { CliError, maskEmail, parseArgs, parseExpiry, resolveUser } from "../src/entitlements/cli.ts";
import { isPlanId, PLAN_IDS } from "../src/entitlements/plans.ts";
import { listEntitlements, revokeEntitlements, upsertEntitlement } from "../src/entitlements/store.ts";

const VALUE_FLAGS = ["plan", "until", "days", "note", "by"] as const;
const line = (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", event, ...fields }));
const iso = (date: Date | null) => date?.toISOString() ?? null;

function target() {
  const database = (() => { try { return new URL(config.databaseUrl).hostname; } catch { return "unknown"; } })();
  const supabase = config.auth.mode === "supabase" ? new URL(config.auth.supabaseUrl).hostname.split(".")[0] : null;
  return { environment: config.appEnv, database, supabaseProject: supabase };
}

async function requireTable() {
  const present = (await pool.query("select to_regclass('app.entitlements') is not null as present")).rows[0]?.present;
  if (!present) throw new CliError("app.entitlements does not exist here. Deploy the backend first: it applies migration 004 when it starts.");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options } = parseArgs(rest, VALUE_FLAGS);
  const text = (name: string) => (typeof options[name] === "string" ? (options[name] as string) : undefined);
  const now = new Date();
  const where = target();
  const local = config.appEnv === "local";
  const operator = text("by") ?? (local ? (process.env.USER ?? "local") : undefined);
  console.log(`Target: ${where.environment} · database ${where.database}${where.supabaseProject ? ` · Supabase ${where.supabaseProject}` : ""}`);
  await requireTable();

  if (command === "list") {
    const { rows } = await pool.query("select user_id, plan, status, source, source_ref, valid_from, expires_at from app.entitlements order by updated_at desc limit 200");
    const shown = options.active ? rows.filter((row) => row.status === "active" || row.status === "trialing" || row.status === "past_due") : rows;
    if (shown.length === 0) console.log(options.active ? "No active entitlements." : "No entitlements.");
    for (const row of shown) console.log(`${row.user_id}  ${row.plan}  ${row.status}  ${row.source}${row.source_ref ? `:${row.source_ref}` : ""}  until ${row.expires_at ? new Date(row.expires_at).toISOString() : "no end date"}`);
    return;
  }

  if (command !== "grant" && command !== "revoke" && command !== "show") throw new CliError("Usage: entitlements.ts <grant|revoke|show|list> <email|uuid> [options]");
  if (positional.length !== 1) throw new CliError(`${command} needs exactly one user (email or uuid).`);
  const user = await resolveUser(positional[0], (sql, params) => pool.query(sql, params));
  console.log(`User: ${user.id}${user.email ? ` (${maskEmail(user.email)})` : ""}`);

  const before = await listEntitlements(user.id);
  const effective = (rows: typeof before) => evaluate(rows, new Date());
  const summary = (rows: typeof before) => { const e = effective(rows); return { proEditor: e.features.proEditor, validUntil: e.validUntil, reason: e.reason }; };

  if (command === "show") {
    for (const row of before) console.log(`  ${row.source}${row.sourceRef ? `:${row.sourceRef}` : ""}  ${row.plan}  ${row.status}  from ${iso(row.validFrom)}  until ${iso(row.expiresAt) ?? "no end date"}${row.cancelAtPeriodEnd ? "  (will not renew)" : ""}  by ${row.grantedBy}${row.note ? `  "${row.note}"` : ""}`);
    if (before.length === 0) console.log("  No entitlement rows.");
    console.log("Effective:", JSON.stringify(summary(before)));
    return;
  }

  if (!local && !operator) throw new CliError("--by <name> is required outside local development, so the audit log says who did this.");
  const dryRun = !local && !options.yes;
  const who = { actor: `cli:${operator}` };

  if (command === "grant") {
    const plan = text("plan") ?? "pro";
    if (!isPlanId(plan)) throw new CliError(`Unknown plan "${plan}". Known plans: ${PLAN_IDS.join(", ")}.`);
    const expiresAt = parseExpiry({ until: text("until"), days: text("days") }, now);
    console.log(`Grant ${plan} until ${iso(expiresAt) ?? "no end date"}. Now: ${JSON.stringify(summary(before))}`);
    if (dryRun) return console.log("DRY RUN: nothing was written. Repeat with --yes to apply.");
    const { result, row } = await upsertEntitlement({ userId: user.id, plan, status: "active", source: "manual", expiresAt, ...(text("note") !== undefined ? { note: text("note") } : {}) }, who);
    const after = await listEntitlements(user.id);
    line("entitlement_grant", { result, operator, userId: user.id, email: maskEmail(user.email), environment: where.environment, plan, expiresAt: iso(row?.expiresAt ?? null), before: summary(before), after: summary(after) });
    console.log(`Done (${result}). Now: ${JSON.stringify(summary(after))}. Running replicas see it within ${config.entitlementCacheSeconds}s; the Studio's own check is immediate.`);
    return;
  }

  // revoke
  const active = before.filter((row) => row.source === "manual" && (row.status !== "revoked" || (row.expiresAt && row.expiresAt > now)));
  console.log(`Revoke ${active.length} manual grant(s). Now: ${JSON.stringify(summary(before))}`);
  if (dryRun) return console.log("DRY RUN: nothing was written. Repeat with --yes to apply.");
  const changed = await revokeEntitlements(user.id, who);
  const after = await listEntitlements(user.id);
  const jobs = (await pool.query(
    "select count(*)::int as n from app.render_jobs j join app.projects p on p.id = j.project_id where p.owner_id = $1 and j.state in ('queued', 'planning', 'rendering') and j.render_input->>'kind' = 'pro'",
    [user.id]
  )).rows[0]?.n ?? 0;
  line("entitlement_revoke", { operator, userId: user.id, email: maskEmail(user.email), environment: where.environment, revoked: changed.length, before: summary(before), after: summary(after), proRendersInFlight: jobs });
  console.log(`Done. Now: ${JSON.stringify(summary(after))}. Their files are untouched and open read-only.`);
  if (after.some((row) => row.source !== "manual" && grantsAccess(row, new Date()))) console.log("Note: another source (a subscription) still grants edit access; revoking the manual grant did not remove it.");
  if (jobs > 0) console.log(`Note: ${jobs} Pro render(s) for this user were accepted earlier and are still running; they will finish.`);
}

main()
  .catch((error) => {
    if (error instanceof CliError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
