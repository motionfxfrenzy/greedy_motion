# Deployment map

Date: 2026-10-02. Each top-level folder is one deployable unit with its own env files. Nothing is provisioned yet; see [Environments](ENVIRONMENTS.md) for staging/production resources and branches.

```text
frontend/            → Vercel                  Next.js UI, no secrets
backend/             → Railway service backend Fastify API, planner, job state
worker/              → Railway service worker  HyperFrames + Chromium + FFmpeg renders
packages/contracts/  → (library)               Shared request/job types for frontend and backend
.railway/railway.ts  → Railway IaC             Declares backend + worker per environment
compose.yaml         → local only              worker (+ postgres) in Docker
```

| Folder | Platform | Build settings | Env files |
| --- | --- | --- | --- |
| `frontend/` | Vercel project, **Root Directory `frontend`**. Vercel installs the npm workspace from the repository root. | Framework: Next.js; build `npm run build`. Production Branch `production`; branch `staging` gets `app.staging.<domain>`. | `.env.example` → local `.env.local`; `.env.staging.example` → Vercel Preview; `.env.production.example` → Vercel Production |
| `backend/` | Railway service `backend` | Root directory: repository root. `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`. Watch paths `/backend/**`, `/packages/**`. Healthcheck `/healthz`. Public domain `api.staging.<domain>` / `api.<domain>`. | `.env.example` → local `.env`; `.env.staging.example` / `.env.production.example` → Railway variables |
| `worker/` | Railway service `worker` | Root directory: repository root. `RAILWAY_DOCKERFILE_PATH=worker/Dockerfile`. Watch paths `/worker/**`. Healthcheck `/healthz`. **No public domain** and no inbound traffic: it pulls render jobs from the pg-boss queue in Postgres. Scale with replicas. | `.env.example` → local `.env` (Compose); `.env.staging.example` / `.env.production.example` → Railway variables |

Why the repository root is the Railway root directory: the backend image needs `packages/contracts`, and future shared packages (`db`, `jobs`, `storage`). Watch paths keep a frontend-only change from rebuilding the backend or worker.

Why `.railway/railway.ts`: Railway's `railway.json` / `railway.toml` (Config as Code) is deprecated; new services cannot opt into it, and existing files stop being read on 2026-12-01. Infrastructure as Code is its replacement.

## Env file rules

- Every folder has `.env.example` (local), `.env.staging.example`, and `.env.production.example`. Only the `*.example` files are committed.
- Real local values: `frontend/.env.local`, `backend/.env`, `worker/.env` (all gitignored and excluded from Docker builds by `.dockerignore`).
- Real staging/production values exist only in Vercel and Railway variables.
- Secrets never go in `frontend/`: every frontend variable is `NEXT_PUBLIC_*` and ends up in the browser.
- The worker never receives the model key, auth secrets, or user tokens.

## Local run

```sh
npm install
docker compose up -d --build worker   # starts postgres too
npm run dev:backend
npm run dev:frontend
```

Open http://localhost:3000. The frontend calls the backend on `localhost:4000`. The backend stores render jobs in Postgres (`127.0.0.1:55432`) and queues them with pg-boss; worker containers pull from the queue (no HTTP between backend and worker). MP4s are written to `var/renders/` (shared by the worker volume and the backend). More render capacity: `docker compose up -d --scale worker=3`. Without an Anthropic key, start the backend with `PLANNER=deterministic` (it refuses to start otherwise). See [Render queue](RENDER_QUEUE.md).

Offline worker proof (no network at all):

```sh
docker compose run --rm worker-selftest
```

## Known gap before hosted rendering works

Locally, worker and backend share `var/renders`. On Railway they are separate containers with separate disks, so the backend cannot serve the worker's MP4. Hosted rendering needs the worker to upload outputs to R2 and the backend to return presigned URLs (MEDIA-02), (the HTTP call between them was already replaced by the pg-boss queue in JOB-01, 2026-10-04). Brand kits (`var/brands`) and generated audio (`var/audio`) have the same shared-disk dependency (BRAND-02). Both services also need `DATABASE_URL` (Supabase session pooler). Until then, only the frontend and backend health endpoints are meaningful on staging.
