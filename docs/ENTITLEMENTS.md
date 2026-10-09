# Entitlements

Documented: October 9, 2026. Status: built on branch `entitlements`, **not deployed**. Replaces the `PRO_USER_IDS` allowlist and the `NEXT_PUBLIC_PRO_EDITOR` flag. Billing is not built; this is the layer a purchase will write to ([BILL-03](BACKLOG.md)).

An entitlement says **what a user may use** (the Pro editor today). It does not say how much; usage and credits ([BILL-02](BACKLOG.md)) are a separate concern with their own tables.

## Model

Per user (`user_id` is the Supabase user id, like `owner_id` everywhere else). Workspaces do not exist; when they do, `entitlementsFor(userId)` (`backend/src/entitlements/resolve.ts`) is the single function that changes: it will also read the user's workspaces' rows, and an additive `workspace_id` column is added. Nothing else reads the table.

`app.entitlements` (migration `004_entitlements.sql`): one row per source of access, unique on `(user_id, source, source_ref)`.

| Column | Meaning |
| --- | --- |
| `plan` | `pro`. Validated in code (`plans.ts`), so a new plan is not a migration. `PLAN_FEATURES` says what a plan unlocks |
| `status` | `active`, `trialing`, `past_due` can grant access; `canceled`, `revoked` never do |
| `source`, `source_ref` | `manual` + `''` for a grant by an operator; a billing provider + its subscription id later |
| `valid_from`, `expires_at` | Inclusive start, **exclusive** end. `expires_at` is the instant edit access ends, whatever the cause. Null: no end |
| `cancel_at_period_end` | Display only ("ends on …") |
| `source_updated_at` | The provider's event time; an older event never overwrites a newer one |
| `granted_by`, `note`, `meta` | Who/why; provider facts. The resolver reads none of them |

`app.entitlement_events` is an append-only audit (actor, action, before, after, provider event id). Rows are never deleted by the application. RLS: a user can read only their own entitlement row through the Data API and write nothing; the audit table is unreadable there. The render worker's database role (DB-03) must get no access to either table.

## What a user may do

`evaluate()` (`evaluate.ts`, pure) turns a user's rows and the current time into one of:

| Pro editor | When | Pro routes |
| --- | --- | --- |
| `edit` | a live row is inside `valid_from <= now < expires_at` | everything |
| `view` | the user had a plan and it ended (expired, canceled, revoked, payment failed past grace) | read-only: `GET /pro`, `GET /pro/file`, `POST /pro/lint`, the preview frame. Open, save and render are refused with **403 `read_only`** |
| `none` | never had a plan | all refused with **403 `not_pro`** |

View-only never deletes anything: the Pro folder, its history and past renders stay, and finished renders stay downloadable. With `AUTH_MODE=none` everything is `edit`. Several rows: the best wins.

## Lifecycle rules (what billing will write)

`lifecycle.ts` (`rowFromSubscription`, provider-neutral and tested) maps a subscription snapshot to a row:

| Situation | Row | Edit access |
| --- | --- | --- |
| Active, will renew | `active`, `expires_at = period end + 2 days` (only so a late renewal webhook does not cut off a paying user) | yes |
| **Cancellation scheduled for period end** | `active`, `expires_at = period end` exactly, `cancel_at_period_end` | until the paid period ends, then view-only |
| **Payment failed** | `past_due`, `expires_at = first failure + 3 days`. Retries and later failure events for the same invoice never extend it | through the grace period only, then view-only |
| Deleted, unpaid, refunded | `canceled`, `expires_at = now` | no, view-only at once |
| Trial | `trialing`, `expires_at = trial end` | until the trial ends |
| Manual grant | `active`, `expires_at = --until` | until then |

## Enforcement

The backend enforces; hiding buttons is not a boundary.

- **One gate, by construction.** Every Pro route is registered inside one encapsulated Fastify plugin (`backend/src/pro/routes.ts`), whose `onRequest` hook resolves the entitlement. It does not match URLs (the earlier regex over `request.url` could be sidestepped with `/%70ro/`; the hook now follows the routes, not their spelling). Each route declares `config.proAccess` (`view` or `edit`); a route without one throws at boot, and an unlisted route is treated as `edit`.
- **Capability type.** `openPro`, `writeProFiles` and `enqueueProRender` require a `ProEditAccess` that only `requireProEdit(request)` can mint. `src/pro/capability-types.ts` is a compile-time test of that. Even if the gate were wrong, a mutation without edit access is refused again inside the handler.
- **Audit of mutation paths:** only `POST /pro/open`, `PUT /pro/files` and `POST /pro/render` (any quality) change Pro state or create a `kind:"pro"` render job. Studio routes cannot: `PUT /projects/:id` whitelists its fields, and job inputs are built server-side. The worker's HTTP server serves only `/healthz` and `/readyz`; renders arrive from the queue. A static test checks nothing outside `backend/src/pro/` touches Pro state or creates a `pro` job.
- **In-flight jobs.** Access is decided when a Pro render is accepted. A job already queued or running when a plan ends finishes (no cancellation until JOB-03; bounded by `RENDER_TIMEOUT_SECONDS` × retries). `revoke` prints how many are in flight.
- **Fail closed.** If the database cannot be read, Pro routes answer **503 `entitlements_unavailable`**: nothing is allowed, and the user is not told they have no plan.
- **Cache.** Each replica remembers a user's rows for `ENTITLEMENT_CACHE_SECONDS` (default 30; 0 disables). A grant or revoke is seen by running replicas within that long; an end date is honoured on time regardless. `GET /v1/me/entitlements` always reads the database.

## API

`GET /v1/me/entitlements` (signed in; no user parameter): `{ plan: "free"|"pro", features: { proEditor: "edit"|"view"|"none" }, validUntil, source, reason, cancelAtPeriodEnd, asOf }`. `GET /v1/projects/:id/pro` also returns `access: "edit"|"view"`.

Frontend (`lib/entitlements-store.ts`, `lib/entitlements.ts`): the state is loading, ready (with `stale`) or unavailable, never a bare "no plan". A failed lookup keeps the last answer or shows a "couldn't check your plan, Retry" menu entry, with automatic backoff and a refresh on focus or coming online. Only a real `none` answer hides the Studio menu entry.

## Operating it (no redeploy)

```
npm run grant:pro   -w backend -- <email|uuid> [--until 2026-12-31 | --days 30] [--note "…"] [--by name] [--yes]
npm run revoke:pro  -w backend -- <email|uuid> [--by name] [--yes]
npm run entitlements -w backend -- show <email|uuid>
npm run entitlements -w backend -- list [--active]
```

On staging and production run it **inside the deployed backend**, so no database URL sits on a laptop (needs an SSH key registered with `railway ssh keys add`):

```
railway ssh --project <id> --environment staging --service backend -- node /app/backend/scripts/entitlements.ts grant someone@example.com --by osama --yes
```

Outside `APP_ENV=local` a change is a **dry run** unless `--yes` is given, and `--by` is required. The script prints its target (environment, database host, Supabase project), resolves emails through `auth.users` (the person must have signed in once), never runs migrations (the backend does at start), and records every change in `entitlement_events`. A bare date in `--until` means the end of that day in UTC. Revoking ends manual grants only; a subscription would keep access.

### Copy-paste commands (Railway)

Replace `someone@example.com` with the account's email (it must have signed in once). The project id is `lively-presence`. For production use `--environment production` instead of `staging`, and only after the backend with migration 004 is deployed there. Leave out `--yes` to see what would happen without changing anything.

```bash
# Give someone the Pro editor (no end date)
railway ssh --project 5298f20e-3531-44a5-a32e-7b99b0cb5b09 --environment staging --service backend -- node /app/backend/scripts/entitlements.ts grant someone@example.com --by osama --yes

# Take it away (their projects open read-only; nothing is deleted)
railway ssh --project 5298f20e-3531-44a5-a32e-7b99b0cb5b09 --environment staging --service backend -- node /app/backend/scripts/entitlements.ts revoke someone@example.com --by osama --yes
```

Useful variations, same prefix: add `--days 30` or `--until 2026-12-31` (end of that day, UTC) to `grant` for a plan that ends by itself and `--note "tester"` to say why; run `show someone@example.com` to see their rows and what they get now; run `list --active` to see everyone with a plan. A grant is seen within about 30 seconds on a running backend (the Studio's own check is immediate). Replace the email with the user id (a uuid) if there is no email, e.g. on local Postgres.

## Billing contract (BILL-03)

Stripe code is not written. The webhook handler only converts a Stripe object to a `SubscriptionSnapshot`, calls `rowFromSubscription` and `upsertEntitlement`:

```ts
upsertEntitlement({ userId, plan: "pro", status, source: "stripe", sourceRef: subscriptionId, expiresAt, cancelAtPeriodEnd, sourceUpdatedAt: event.created, meta },
                  { actor: "stripe", eventId: event.id, action: event.type })   // → "applied" | "unchanged" | "stale"
```

- Verify the signature on the raw body. In **one `withTransaction`**: insert `webhook_events (provider, event_id)` `on conflict do nothing`; if nothing was inserted it is a replay, return 200; otherwise apply the change. If applying throws, the dedupe row rolls back too, so the provider's retry reprocesses it.
- An event older than the row's `source_updated_at` is ignored and logged as `stale_ignored`. Event time has one-second resolution, so on a tie or any doubt re-fetch the subscription from the provider and write that snapshot; a reconcile command is the safety net for missed webhooks.
- User mapping comes from our own checkout-session endpoint (`client_reference_id` = the user id from the token), stored in `billing_accounts (owner_id, provider, customer_id)`, never from an email in the payload. Both tables are specified in [Architecture](ARCHITECTURE.md) and created by the BILL-03 migration.
- Merchant of record: the pricing proposal names Lemon Squeezy and the backlog Stripe; `source` is provider-neutral, so either fits.

## Tests

`npm run test:entitlements-eval -w backend` (no database; rules at exact instants, lifecycle, cache, fail-closed resolver, CLI parsing, structural guarantees) and `npm run test:entitlements -w backend` (real Postgres and a real backend: grant/revoke through the script, the refusal matrix with URL-spelling variants and a check that nothing moved, expiry and scheduled cancellation, isolation, dry-run safety, 503 with the table unreachable, and the webhook contract: stale, replay, atomic, concurrent). Frontend: `entitlements-store.mjs`, `editor-readonly.mjs`. Both backend tests run in CI.

## Rollout

1. Merge the ownership fix for percent-encoded ids first (it shares the failure mode of the old Pro gate).
2. Staging: deploy backend (migration 004 applies at start), then frontend. `entitlements.ts list` is empty; `grant` the test user and check Studio's menu entry, open, save; `revoke` and confirm view-only; `grant --until` a near time and watch it lapse.
3. Production: same order. With zero grants the Pro editor is invisible and every Pro route answers 403. Confirm `PRO_USER_IDS` is unset on Railway (it is ignored now and logs a warning if present).
4. Deploy backend before frontend: the new frontend calls `/v1/me/entitlements`.

## Not done

Stripe checkout, webhooks, `billing_accounts` and `webhook_events` tables, usage ledger, workspaces, an "everyone" mode for open betas (a `grant --all-users` snapshot could be added), an admin page, cancelling queued Pro jobs on revoke, and a browser check of the authenticated Studio and editor flows (needs a signed-in session, not available against the remote Supabase projects).
