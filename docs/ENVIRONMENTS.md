# Environments

Date: 2026-10-02. Status: defined; only `local` exists. No Railway, Supabase, Cloudflare, or Vercel resources have been created.

There are exactly three environments. Each has its own resources and credentials; nothing is shared between them.

| | local | staging | production |
| --- | --- | --- | --- |
| Purpose | Development on one machine | Integration, QA, benchmarks, Vercel previews | Real customers |
| `APP_ENV` | `local` | `staging` | `production` |
| Frontend | `next dev` on `localhost:3000` | Vercel `staging` branch deployment at `app.staging.<domain>`; PR previews also use staging values | Vercel Production (`production` branch), `app.<domain>` |
| API | `backend` process on `localhost:4000` | Railway project `videosaas`, environment `staging`, service `backend`, `api.staging.<domain>` | Railway project `videosaas`, environment `production`, service `backend`, `api.<domain>` |
| Renderer | Docker Compose service `worker` (same image as hosted) | Railway `staging` / `worker` | Railway `production` / `worker` |
| Postgres | Docker Compose `postgres` (same major as Supabase) | Supabase project `videosaas-staging` | Supabase project `videosaas-production` |
| Auth | None in M3 (seeded workspace); Supabase CLI local stack from M4 | Supabase Auth in `videosaas-staging` | Supabase Auth in `videosaas-production` |
| Media | Filesystem adapter under `var/storage` | R2 `videosaas-staging-uploads`, `videosaas-staging-outputs` | R2 `videosaas-production-uploads`, `videosaas-production-outputs` |
| Model API | Developer key with a low spend limit | Separate key, staging spend limit | Separate key, production spend limit |
| Payments (M5) | Stripe test mode | Stripe test mode | Stripe live mode |
| Sentry | Disabled or `local` | Environment `staging` | Environment `production` |
| Data | Fixtures only | Fixtures and internal test accounts only | Customer data |
| Deploys from | Working tree | Git branch `staging`, automatically on push | Git branch `production`, automatically on push (promotion only) |

## Why three, and why separate vendor projects

- **Staging must behave like production.** Bugs in this system live at the vendor seams: JWT verification, Supabase pooler behaviour, R2 presigning and CORS, Railway draining. Only a hosted environment on the same vendors exercises them.
- **Separate Supabase projects, not one project with two schemas.** Auth users, API keys, backups, and connection limits are per project. Sharing a project would let a staging bug touch production users.
- **Separate R2 buckets and tokens.** A token scoped to staging buckets cannot read customer media.
- **One Railway project with two environments.** Railway environments are isolated (own services, variables, networking), and keeping them in one project makes it easy to compare configuration.
- **No Railway PR environments.** Each would need its own database and buckets to be safe. Vercel previews share the `staging` backend instead.

## Isolation rules

1. Never copy production data into staging or local. Customer screenshots are private; reproduce bugs with fixtures or with the customer's explicit permission.
2. Every credential is per environment. A leaked staging key must never work against production.
3. Each service validates its configuration at startup with a Zod schema and refuses to start if:
   - `APP_ENV` is missing or not one of `local`, `staging`, `production`;
   - R2 bucket names do not end in `-<APP_ENV>-uploads` / `-<APP_ENV>-outputs`;
   - `SUPABASE_URL` does not match `EXPECTED_SUPABASE_PROJECT_REF`;
   - in `production`, any `CORS_ORIGINS` entry is not HTTPS or matches a preview pattern.
4. Vercel Preview deployments (PRs and the `staging` branch) get only staging values. Production values are set only on Vercel's Production environment, which deploys from `production`.
5. Production variables are edited by the owner only; changes are noted in the progress log.

## Branches and promotion flow

| Branch | Role | Deploys to |
| --- | --- | --- |
| feature branches | Individual changes | Nothing hosted; PRs get a Vercel preview that uses staging values |
| `main` | Integration branch: all reviewed code lands here first | Nothing; CI only |
| `staging` | Release candidate under QA | staging (Railway `staging`, Supabase `videosaas-staging`, R2 `videosaas-staging-*`, `app.staging.<domain>`) |
| `production` | What customers run | production (Railway `production`, Supabase `videosaas-production`, R2 `videosaas-production-*`, `app.<domain>`) |

```text
feature ──PR──▶ main            CI: typecheck, lint, unit, renderer image tests; Vercel PR preview → staging API
main ──merge──▶ staging         deploy staging: Railway api (pre-deploy migrations) → renderer; Vercel staging branch
QA passes on staging
staging ─PR───▶ production      deploy production: Railway api (pre-deploy migrations) → renderer; Vercel production
```

Rules:

- Code flows one way: `main` → `staging` → `production`. Never commit directly to `staging` or `production`; changes arrive only by merge from the branch before it.
- `production` only ever receives a commit that already ran on `staging`. Merge `staging` into `production` with a fast-forward (or a merge of the exact QA'd commit) so production runs the same code that was tested.
- Hotfix: branch from `production`, PR into `main`, then promote through `staging` as normal. If the issue is urgent, the same flow runs quickly; skipping staging is not allowed.
- Protect `main`, `staging`, and `production` on GitHub: PRs required, CI must pass, no force pushes; only the owner can merge into `production`.
- Railway: environment `staging` tracks branch `staging`; environment `production` tracks branch `production`. Vercel: Production Branch is `production`; branch `staging` is assigned the domain `app.staging.<domain>`.
- Migrations are backward compatible, so the old API version keeps working while the new one deploys.
- Rollback: redeploy the previous Railway deployment and use Vercel instant rollback; do not reverse migrations. Then fix forward through `main`.

## Configuration files

Each deployable folder has its own env files; there is no shared env folder. Full deploy settings per folder are in [Deployment map](DEPLOYMENT.md).

| Folder | Local values (gitignored) | Templates (committed) | Hosted values live in |
| --- | --- | --- | --- |
| `frontend/` | `.env.local` (loaded by Next.js) | `.env.example`, `.env.staging.example`, `.env.production.example` | Vercel Preview / Production |
| `backend/` | `.env` (loaded by `npm run dev:backend`) | `.env.example`, `.env.staging.example`, `.env.production.example` | Railway `staging` / `production`, service `backend` |
| `worker/` | `.env` (loaded by Docker Compose) | `.env.example`, `.env.staging.example`, `.env.production.example` | Railway `staging` / `production`, service `worker` |

Frontend variables are all `NEXT_PUBLIC_*` and end up in the browser, so they never hold secrets. The worker never receives the model key, auth secrets, or user tokens. Never write hosted secrets into files in this repository.

## Local stack

[`compose.yaml`](../compose.yaml) runs the local infrastructure; the frontend and backend run on the host:

```sh
docker compose up -d --build worker   # also starts postgres (the worker waits for it)
npm run dev:backend                    # needs DATABASE_URL in backend/.env; applies migrations and creates the queues
npm run dev:frontend
```

- `worker`: built from `worker/Dockerfile`; consumes the `render-video` queue from `postgres` and writes MP4s to `var/renders/` (shared with the backend). No host port; scale with `docker compose up -d --scale worker=N`. See [Render queue](RENDER_QUEUE.md).
- `worker-selftest`: same image with no network at all: `docker compose run --rm worker-selftest`.
- `postgres`: Postgres 17 on host port 55432; holds `app.render_jobs` and the pg-boss schema. Started by default (the worker depends on it). Match the major version of the Supabase projects once they exist.

## Setup checklist

Hosted resources are created in INFRA-01, after the M2 decision. For each of `staging` and `production`:

- [ ] Supabase project in the chosen region; Data API lockdown applied; auth redirect URLs set; backups confirmed.
- [ ] Railway environment with `backend` and `worker` services, pre-deploy migration command, restart policy, replica count, draining time, custom domain.
- [ ] R2 bucket pair, lifecycle rule on `incoming/`, CORS, separate `backend` and `worker` tokens.
- [ ] Vercel environment variables (Preview → staging, Production → production), Production Branch `production`, `app.staging.<domain>` on branch `staging`.
- [ ] GitHub branches `main`, `staging`, `production` with protection rules; Railway environments connected to `staging` and `production`.
- [ ] Model API key with spend limit; Sentry environment; Stripe mode (M5).
- [ ] Startup configuration check passes; QA-02 isolation tests pass.
