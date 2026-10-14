// Grants tokens and shows a user's balance. Writes through the same store the backend uses.
//
//   node --env-file=.env scripts/tokens.ts grant <email|uuid> <amount> [--note "..."] [--by name] [--yes]
//   node --env-file=.env scripts/tokens.ts show  <email|uuid>
//
// On staging and production run it inside the deployed backend (see scripts/entitlements.ts). Outside APP_ENV=local a
// grant is a dry run unless --yes is given, and --by names who is doing it. The backend applies migration 005 on start.
import { config } from "../src/config.ts";
import { pool } from "../src/db/database.ts";
import { CliError, maskEmail, parseArgs, resolveUser } from "../src/entitlements/cli.ts";
import { grantTokens, tokenSummary } from "../src/tokens/store.ts";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options } = parseArgs(rest, ["note", "by"]);
  const text = (name: string) => (typeof options[name] === "string" ? (options[name] as string) : undefined);
  const local = config.appEnv === "local";
  console.log(`Target: ${config.appEnv}`);
  const present = (await pool.query("select to_regclass('app.token_ledger') is not null as present")).rows[0]?.present;
  if (!present) throw new CliError("app.token_ledger does not exist here. Deploy the backend first: it applies migration 005 when it starts.");
  if (command !== "grant" && command !== "show") throw new CliError("Usage: tokens.ts <grant|show> <email|uuid> [amount] [options]");
  if (positional.length !== (command === "grant" ? 2 : 1)) throw new CliError(command === "grant" ? "grant needs a user and an amount." : "show needs exactly one user.");
  const user = await resolveUser(positional[0], (sql, params) => pool.query(sql, params));
  console.log(`User: ${user.id}${user.email ? ` (${maskEmail(user.email)})` : ""}`);

  if (command === "grant") {
    const amount = Number(positional[1]);
    if (!Number.isInteger(amount) || amount <= 0) throw new CliError(`The amount must be a whole number above zero; got "${positional[1]}".`);
    const operator = text("by") ?? (local ? (process.env.USER ?? "local") : undefined);
    if (!local && !operator) throw new CliError("--by <name> is required outside local development, so the ledger says who did this.");
    if (!local && !options.yes) { console.log(`Dry run: would grant ${amount} tokens. Add --yes to write.`); return; }
    await grantTokens(user.id, amount, text("note") ?? "grant", `cli:${operator}`, undefined, "pack");
    console.log(`Granted ${amount} tokens.`);
  }
  const summary = await tokenSummary(user.id, 10);
  console.log(`Remaining ${summary.remaining} · plan ${summary.plan ? `${summary.plan.remaining} of ${summary.plan.granted} (since ${summary.plan.since})` : "none"} · free ${summary.free.remaining}/${summary.free.granted} · packs ${summary.packs.remaining}`);
  for (const entry of summary.recent) console.log(`  ${entry.createdAt}  ${entry.amount > 0 ? "+" : ""}${entry.amount}  ${entry.kind}  ${entry.pool}  ${entry.reason}`);
}

main().catch((error) => { console.error(error instanceof CliError ? error.message : error); process.exitCode = 1; }).finally(() => pool.end());
