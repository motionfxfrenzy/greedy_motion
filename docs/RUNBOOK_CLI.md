# CLI access runbook

How to authenticate each vendor CLI and switch safely between **staging** and **production** from a terminal. Environments are defined in [Environments](ENVIRONMENTS.md).

Observed on this machine (2026-10-02): Railway CLI 5.57.7 and GitHub CLI 2.100.0 installed and logged in as Ramo Labs (`ramolabs62`). Vercel, Supabase, Wrangler, and Stripe CLIs not installed.

## Two kinds of credentials

| Kind | Examples | Where it lives |
| --- | --- | --- |
| **Operator (CLI) credentials**: manage projects, buckets, variables, deploys | Railway tokens, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN` | Your machine only: `~/.config/videosaas/<env>.sh` or a password manager. Never in this repo, Railway, or Vercel. |
| **App runtime credentials**: used by running services | `DATABASE_URL`, R2 access keys for `backend`/`worker`, `ANTHROPIC_API_KEY` | Railway and Vercel variables per environment; names in `env/*.env.example`. |

Operator tokens can delete infrastructure; treat them as more sensitive than runtime keys.

## Option A — one account per vendor (recommended)

Log in once per tool and choose the environment in each command.

| Tool | Install | Log in once | Choose environment per command |
| --- | --- | --- | --- |
| Railway | installed | `railway login` | `railway link` once in the repo, then `-e staging` / `-e production` and `-s api` / `-s renderer` on `variables`, `up`, `logs`, `run` |
| Vercel | `npm i -g vercel` (or `npx vercel`) | `vercel login` | One project; `vercel env ls preview` / `vercel env ls production`; `vercel env pull --environment=preview` |
| Supabase | `brew install supabase/tap/supabase` | `supabase login` | `supabase link --project-ref <ref>` (per directory) or `--project-ref` on commands that accept it |
| Cloudflare | `npx wrangler` (add as a dev dependency in CORE-01) | `npx wrangler login` | Bucket names carry the environment: `videosaas-staging-*`, `videosaas-production-*` |
| GitHub | installed | `gh auth login` | Branches: `staging`, `production` |
| Stripe (M5) | `brew install stripe/stripe-cli/stripe` | `stripe login` | Test mode for staging; live keys only for production commands |

Browser logins are convenient but are always "whatever you last linked". Before any write command, check where you are:

```bash
railway status
```

```bash
supabase projects list
```

## Option B — per-environment token files (safer, also works with separate accounts)

Each environment gets its own scoped tokens. Loading one file points every CLI at that environment, and a production token never sits in a staging terminal.

### 1. Create scoped tokens (in each vendor dashboard)

| Vendor | Token | Scope |
| --- | --- | --- |
| Railway | Project token (`RAILWAY_TOKEN`) | Project `videosaas`, one environment (`staging` or `production`) |
| Vercel | Account token (`VERCEL_TOKEN`) | Team that owns the project; plus `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` |
| Supabase | Personal access token (`SUPABASE_ACCESS_TOKEN`) | Account; plus the project ref and DB password for that environment |
| Cloudflare | API token (`CLOUDFLARE_API_TOKEN`) | Account resources: R2 edit; plus `CLOUDFLARE_ACCOUNT_ID` |
| Stripe (M5) | Restricted key (`STRIPE_API_KEY`) | Test mode for staging, live for production |
| Sentry | Auth token (`SENTRY_AUTH_TOKEN`) | Release and source-map upload only (CI) |

Railway project tokens are the strongest guard: a staging project token cannot touch production. If a vendor only offers account-wide tokens, separate accounts or careful prompts are the remaining safeguards.

### 2. Store one file per environment, outside the repo

```sh
# ~/.config/videosaas/staging.sh   (chmod 600)
export RAILWAY_TOKEN=<railway project token: videosaas / staging>
export VERCEL_TOKEN=<vercel token>
export VERCEL_ORG_ID=<vercel team id>
export VERCEL_PROJECT_ID=<vercel project id>
export SUPABASE_ACCESS_TOKEN=<supabase access token>
export SUPABASE_PROJECT_REF=<videosaas-staging project ref>
export SUPABASE_DB_PASSWORD=<videosaas-staging database password>
export CLOUDFLARE_API_TOKEN=<cloudflare token>
export CLOUDFLARE_ACCOUNT_ID=<cloudflare account id>
export STRIPE_API_KEY=<stripe test-mode restricted key>
```

`~/.config/videosaas/production.sh` has the same names with production values. A password manager works too (for example 1Password: `op run --env-file=... -- <command>`).

### 3. Load an environment per terminal

```bash
source scripts/videosaas-env.sh staging
```

The [helper](../scripts/videosaas-env.sh) clears tokens from any previously loaded environment, loads the file, sets `VIDEOSAAS_ENV`, and prefixes the prompt with `[staging]` or `[PRODUCTION]`. Production requires typing `production` to confirm. Use a separate terminal tab per environment.

To clear everything:

```bash
source scripts/videosaas-env.sh off
```

## Common commands

Railway (with a linked directory or a project token loaded):

```bash
railway variables -e staging -s api
```

```bash
railway logs -e staging -s renderer
```

Supabase (environment from `SUPABASE_PROJECT_REF`):

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

Cloudflare R2:

```bash
npx wrangler r2 bucket list
```

```bash
npx wrangler r2 bucket create videosaas-staging-uploads
```

CORS and lifecycle rules use `wrangler r2 bucket cors …` and `wrangler r2 bucket lifecycle …`; check `npx wrangler r2 bucket --help` for the installed version's flags.

Vercel:

```bash
vercel env ls preview
```

Database migrations do not use the Supabase CLI: Drizzle runs with the environment's session-pooler `DATABASE_URL`, normally through the Railway `backend` pre-deploy command, not from a laptop.

## Production safety rules

1. Production commands run only from a terminal showing `[PRODUCTION]`.
2. Read before writing: `railway status`, `vercel env ls production`, `npx wrangler r2 bucket list` before any change.
3. Deploys reach production only through the `production` branch, never `railway up` or `vercel --prod` from a laptop.
4. Rotate a token immediately if it was pasted anywhere outside its file or password manager, and note the rotation in [Progress](PROGRESS.md).
5. App runtime keys (R2 `backend`/`worker` tokens, `DATABASE_URL`) are created in vendor dashboards and pasted only into Railway/Vercel variables, never into these operator files.
