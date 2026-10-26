// Puts a user on a paid plan by hand (a tester, a comp, a manual sale), without Lemon Squeezy. It writes what the webhook
// would: a subscription row (provider "manual"), Pro-editor access for Pro and Business, and the plan's monthly tokens
// (last month's unused plan tokens expire first). Run it again to renew or change the plan.
//
//   node --env-file=.env scripts/plan.ts grant <email|uuid> <starter|pro|business> [--days 30] [--by name] [--yes]
//   node --env-file=.env scripts/plan.ts end   <email|uuid> [--by name] [--yes]
//   node --env-file=.env scripts/plan.ts show  <email|uuid>
//
// On staging and production run it inside the deployed backend (see scripts/entitlements.ts). Outside APP_ENV=local a
// change is a dry run unless --yes is given, and --by names who is doing it.
import { subscriptionFor } from "../src/billing/service.ts";
import { config } from "../src/config.ts";
import { pool, withTransaction, query } from "../src/db/database.ts";
import { CliError, maskEmail, parseArgs, resolveUser } from "../src/entitlements/cli.ts";
import { revokeEntitlements, upsertEntitlement } from "../src/entitlements/store.ts";
import { expirePlanTokens, grantTokens, tokenSummary } from "../src/tokens/store.ts";
import { isPaidTier, PLANS } from "../src/tokens/plan.ts";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options } = parseArgs(rest, ["days", "by"]);
  const text = (name: string) => (typeof options[name] === "string" ? (options[name] as string) : undefined);
  const local = config.appEnv === "local";
  const operator = text("by") ?? (local ? (process.env.USER ?? "local") : undefined);
  console.log(`Target: ${config.appEnv}`);
  const present = (await pool.query("select to_regclass('app.subscriptions') is not null and to_regclass('app.token_ledger') is not null as present")).rows[0]?.present;
  if (!present) throw new CliError("The billing tables do not exist here. Deploy the backend first: it applies migrations 005 to 007 when it starts.");
  if (command !== "grant" && command !== "end" && command !== "show") throw new CliError("Usage: plan.ts <grant|end|show> <email|uuid> [tier] [options]");
  if (positional.length !== (command === "grant" ? 2 : 1)) throw new CliError(command === "grant" ? "grant needs a user and a tier (starter, pro or business)." : `${command} needs exactly one user.`);
  const user = await resolveUser(positional[0], (sql, params) => pool.query(sql, params));
  console.log(`User: ${user.id}${user.email ? ` (${maskEmail(user.email)})` : ""}`);
  const ref = `manual:${user.id}`;

  if (command !== "show") {
    if (!local && !operator) throw new CliError("--by <name> is required outside local development, so the audit log says who did this.");
    if (!local && !options.yes) { console.log(`Dry run: would ${command === "grant" ? `put the user on ${positional[1]}` : "end the user's manual plan"}. Add --yes to write.`); return; }
    const actor = `cli:${operator}`;
    const now = new Date();
    if (command === "grant") {
      const tier = positional[1];
      if (!isPaidTier(tier)) throw new CliError(`Tier must be starter, pro or business; got "${tier}".`);
      const days = Number(text("days") ?? 30);
      if (!Number.isFinite(days) || days <= 0 || days > 3650) throw new CliError("--days must be between 0 and 3650.");
      const renews = new Date(now.getTime() + days * 86_400_000);
      await withTransaction(async () => {
        await query(
          `insert into app.subscriptions (user_id, provider, provider_ref, variant_id, tier, status, renews_at, ends_at, cancel_at_period_end, provider_updated_at)
           values ($1, 'manual', $2, 'manual', $3, 'active', $4, null, false, $5)
           on conflict (provider, provider_ref) do update set tier = excluded.tier, status = 'active', renews_at = excluded.renews_at, ends_at = null, cancel_at_period_end = false, provider_updated_at = excluded.provider_updated_at, updated_at = now()`,
          [user.id, ref, tier, renews, now]
        );
        if (PLANS[tier].proEditor) {
          await upsertEntitlement({ userId: user.id, plan: "pro", status: "active", source: "manual", expiresAt: renews, note: `${tier} plan (manual)`, meta: { tier } }, { actor, action: "grant" });
        } else {
          await revokeEntitlements(user.id, { actor }, "manual");
        }
        // A new month: last month's unused plan tokens expire, then the plan's full allowance is granted (once per run).
        const stamp = now.toISOString();
        await expirePlanTokens(user.id, `expiry:manual:${stamp}`);
        await grantTokens(user.id, PLANS[tier].tokens, `${PLANS[tier].name} plan tokens`, actor, `manual:${stamp}`, "plan");
      });
      console.log(`Now on ${PLANS[tier].name} until ${renews.toISOString()} (Pro editor: ${PLANS[tier].proEditor ? "yes" : "no"}, ${PLANS[tier].tokens} plan tokens granted).`);
    } else {
      await withTransaction(async () => {
        await query("update app.subscriptions set status = 'expired', ends_at = now(), updated_at = now() where user_id = $1 and provider = 'manual'", [user.id]);
        await revokeEntitlements(user.id, { actor }, "manual");
        await expirePlanTokens(user.id, `expiry:manual-end:${now.toISOString()}`, "Plan ended");
      });
      console.log("Manual plan ended; the user is on Free again.");
    }
  }
  const sub = await subscriptionFor(user.id);
  const tokens = await tokenSummary(user.id, 5);
  console.log(`Plan: ${sub.tier}${sub.renewsAt ? ` · renews ${sub.renewsAt}` : ""} · tokens left ${tokens.remaining}${tokens.plan ? ` (plan ${tokens.plan.remaining}/${tokens.plan.granted})` : ""}`);
}

main().catch((error) => { console.error(error instanceof CliError ? error.message : error); process.exitCode = 1; }).finally(() => pool.end());
