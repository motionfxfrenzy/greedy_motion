# Environments

> Current implementation and live infrastructure: [Application, infrastructure and storage guide](SYSTEM_GUIDE.md). This document also contains historical plans; consult the guide and [release status](MVP_RELEASE_STATUS.md) for the October 8, 2026 production topology.

Date: 2026-10-02, updated 2026-10-07. Status: all three environments exist. Staging runs the full app; production runs the
backend and serves the "Coming soon" site. Live resources are listed below; the tables after them are the original design
(names such as `videosaas-staging` and `app.staging.<domain>` became the names in "Live resources").

## Live resources (2026-10-07)

| | local | staging | production |
| --- | --- | --- | --- |
| Git branch | working tree (`main`) | `staging` | `production` |
| Frontend | `next dev`, `localhost:3000` | Vercel project `greedy-motion-staging` (team `greddy-motion`), Production Branch `staging`, <https://greedy-motion-staging.vercel.app> | Vercel project `greedy-motion`, Production Branch `production`, <https://www.greedymotion.com> (also `greedymotion.com`) |
| Frontend build rule | — | Ignored Build Step: builds only branch `staging` | Ignored Build Step: builds only branch `production` |
| What the site shows | Full app | Full app (landing → sign-in → studio) | "Coming soon" (the page exists only on `production`) |
| Backend | `npm run dev:backend`, `localhost:4000` | Railway project `lively-presence`, environment `staging`, service `backend`, <https://backend-staging-aec6.up.railway.app>, volume `/data` | Same project, environment `production`, service `backend`, **no public domain yet**, volume `/data` |
| Postgres | Docker `videosaas-local-postgres-1` (Postgres 17), `127.0.0.1:55432` | Supabase `ltaxhznuixoslbbcjkts` (greedymotion-staging), session pooler `aws-0-ap-southeast-1.pooler.supabase.com:5432` | Supabase `bwwquxhexwyodsavsjar` (greedymotion-production), same pooler host |
| Auth | Supabase **staging** project (the local frontend signs in against staging) | Supabase staging | Supabase production |
| Auth emails | Resend SMTP via Supabase staging | Resend SMTP | Resend SMTP (to confirm) |
| Render outputs | `var/renders` (filesystem) | R2 (`STORAGE_DRIVER=r2`) | R2 (`STORAGE_DRIVER=r2`) |
| Other media | `var/` folders | Railway volume `/data` | Railway volume `/data` |
| Render worker | Docker Compose `worker` | AWS ECS Fargate scripts in `infra/aws/` (deployment state not recorded here) | same |

Branch flow in practice: work lands on `main` (no deploy); `main` is merged into `staging` (deploys staging) and into
`production` (deploys production, keeping the coming-soon page). Pushes to other branches are skipped by both Vercel
projects. The Supabase migrate workflow (`.github/workflows/supabase-migrate.yml`) runs on `staging`/`production` pushes
that touch `supabase/**` and skips until its GitHub secrets are set; app tables are migrated by the backend at startup.

Hosted variables set on 2026-10-07 (values live only in Railway/Vercel):

| Where | Variables |
| --- | --- |
| Railway `backend` (both environments) | `AUTH_MODE=supabase`, `SUPABASE_URL`, `EXPECTED_SUPABASE_PROJECT_REF`; staging also `CORS_ORIGINS=https://greedy-motion-staging.vercel.app,http://localhost:3000`. Production `CORS_ORIGINS` is the two `greedymotion.com` origins. |
| Vercel (both projects) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL` |

Auth, ownership and the data model: [Authentication, ownership and data](AUTH_AND_DATA.md).


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

State on 2026-10-07 (S = staging, P = production).

- [x] Supabase projects created (S, P); app migrations 001–003 applied; RLS on `app.projects`, `app.brand_kits`, `app.render_jobs` (S, P).
- [x] Supabase Auth: Google provider and Resend SMTP (S). Redirect URLs (S).
- [ ] Supabase Auth for P: confirm redirect URLs, Google client, SMTP; enable leaked-password protection (S, P).
- [x] Railway `backend` service with `/data` volume, branch auto-deploy, auth variables (S, P); public domain (S).
- [ ] Railway production public domain for the API (needed before production leaves "Coming soon").
- [ ] Render worker hosted (AWS ECS scripts in `infra/aws/`); DB-03 worker role.
- [x] R2 for render outputs (`STORAGE_DRIVER=r2`, S and P).
- [x] R2 for screenshots, logos, fonts, audio and snapshots (S): `greedymotion-staging-media`, `R2_MEDIA_BUCKET`, staging key scoped to it (2026-10-08). P: create `greedymotion-production-media`, scope backend credentials, set explicit media/endpoint/signing variables and verify new media recovery. Backfill intentionally skipped (no retained user media, 2026-10-09); see [production setup](MEDIA_R2_ROLLOUT.md).
- [x] Lifecycle: `media/brands/_staging/` expires after 1 day (S, rule `expire-pending-brand-uploads`; P to do).
- [ ] Lifecycle on `jobs/` in the uploads buckets; bucket CORS.
- [x] Vercel projects with Supabase/API variables and branch-only builds (S, P).
- [x] GitHub branches `main`, `staging`, `production`.
- [ ] GitHub branch protection rules; CI required checks.
- [ ] Sentry environments; Stripe mode (M5).
- [x] Startup configuration check (`APP_ENV`, `AUTH_MODE`, project-ref match, production CORS) passes on S and P.
