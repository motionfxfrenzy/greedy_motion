# Stack decisions

Date: 2026-10-02. Status: accepted for M3–M5 planning. Nothing is provisioned yet.

This file records which hosted services and core libraries the product uses, why, what was rejected, and what would make us change course. [Architecture](ARCHITECTURE.md) describes how the pieces fit together; this file explains the choices.

## Summary

| Concern | Decision | One-line reason |
| --- | --- | --- |
| Frontend hosting | **Vercel** | Most mature, first-party Next.js platform |
| API and render workers | **Railway** (two services: `backend`, `worker`) | Long-running containers for Chrome/FFmpeg, simple replicas, per-minute billing |
| Authentication | **Supabase Auth** | Managed login and sessions; the app keeps authorization in its own tables |
| Database | **Supabase Postgres**, schema managed by **Drizzle** migrations | Managed backups; one Postgres from local development to production |
| Job queue | **pg-boss** on the same Postgres | Durable queue with no extra service; can share transactions with app data |
| Object storage | **Cloudflare R2** | S3-compatible with free egress, which matters for video downloads |
| API framework | **Fastify** with Zod type provider | Mature, fast, well-typed Node HTTP server |
| Runtime and repo | **Node 24 LTS**, **npm workspaces** | Supported LTS for CI/containers; no extra package-manager install |
| AI planner | **Anthropic API** behind the planner adapter | Structured tool output maps directly to the storyboard schema |
| Observability | **Sentry** + **pino** JSON logs | Low setup cost, covers web, API, and worker |
| Payments (M5) | **Stripe** | Standard checkout and webhook model; fits the idempotency design |

Target deployment:

```text
app.<domain>   → Vercel             Next.js UI only (no database, storage, or model credentials)
api.<domain>   → Railway  api       Fastify API, auth verification, presigning, planner jobs
(internal)     → Railway  renderer  HyperFrames + Chrome + FFmpeg render jobs
               → Supabase           Auth + Postgres (app schema + pg-boss schema)
               → Cloudflare R2      uploads and rendered outputs
```

## Decision principles

1. **Rendering drives infrastructure.** A 20-second 1080p render needs Chrome, FFmpeg, gigabytes of RAM, and minutes of CPU. The platform must run long-lived containers; serverless functions are ruled out for rendering.
2. **Prefer mature, managed pieces over operating our own.** The team is one engineer. Managed auth, backups, and TLS are cheaper than building them.
3. **One database technology everywhere.** The original plan used SQLite locally and Postgres hosted, which meant writing leases, fencing, migrations, and queue code twice. Postgres from M3 onward removes that.
4. **Vendor boundaries match code boundaries.** Storage, auth verification, and the planner sit behind adapters, so replacing a vendor is a contained change.
5. **Few vendors, but not at the cost of fit.** Four vendors (Vercel, Railway, Supabase, Cloudflare) is acceptable because each has a distinct job, and none of them runs our core render logic in a proprietary format.

## D1 — Frontend on Vercel

**Decision.** Deploy `frontend` (Next.js 16 App Router) to Vercel. It serves pages, handles Supabase login, and calls the Railway API from the browser. It holds no database, storage, or model credentials.

**Why.**
- Vercel maintains Next.js, so new Next.js releases and features are supported there first and behave the same as in local development.
- Preview deployments per pull request, instant rollback, and edge caching come without configuration.
- Because the API lives on Railway, Vercel's serverless limits (execution time, connection pooling, native modules) do not affect us: the frontend makes no database connections and runs no heavy work.

**Alternatives considered.**
- *Cloudflare Workers via OpenNext:* cheaper at large scale and close to R2, but Next.js runs through a community adapter. Support for new Next.js versions can lag, some Node APIs and native modules behave differently, and Postgres access needs Hyperdrive. Less mature for this framework.
- *Railway for the frontend too:* fewest vendors and a plain Node server, but no per-PR frontend previews or global CDN. A good fallback if Vercel costs or limits become a problem.

**Consequences.**
- Cross-origin calls from `app.<domain>` to `api.<domain>` need a strict CORS allowlist (see [Architecture §5](ARCHITECTURE.md#5-authentication-and-authorization)).
- Vercel preview deployments must point at the **staging** API and Supabase project, never production.

**Revisit if.** Vercel bills become a meaningful share of cost per video, or a needed feature is blocked by Vercel limits.

## D2 — API and render workers on Railway

**Decision.** Run two Railway services in one project: `backend` (Fastify HTTP API plus the planner job consumer) and `worker` (Docker image with pinned Chrome, FFmpeg, HyperFrames, and bundled fonts). Use Railway environments for `staging` and `production`.

**Why.**
- Railway runs ordinary long-lived containers, which the renderer requires.
- Verified in Railway docs on 2026-10-02: on the Pro plan each replica can use up to 24 vCPU and 24 GB RAM; billing is per minute for actual use at $20 per vCPU-month and $10 per GB-month of RAM. Idle workers cost little, and capacity grows by adding replicas.
- Private networking between services, pre-deploy commands for database migrations, environments, and PR environments are built in.
- The renderer is a plain Docker image, so it can move to other compute (dedicated machines, spot instances, ECS/Batch) without code changes if render compute dominates cost.

**Why the planner runs in `backend`, not `worker`.** Planning is network-bound (model API calls) and needs the model API key. Rendering is CPU-bound and runs untrusted-shaped content in Chrome. Keeping the model key and auth configuration out of the renderer reduces what a compromised render process could reach. A separate `planner` service can be split out later if planning load grows.

**Railway behaviours the design must handle** (verified in docs):
- By default an old deployment gets **0 seconds** after `SIGTERM` before `SIGKILL`. The renderer must set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to cover a typical render plus upload, and must survive being killed anyway through leases and retries.
- Railway does not autoscale replicas based on our queue. Start with a fixed replica count and adjust manually or with a small scaling job using Railway's API.
- Outbound IPv6 is opt-in. This affects how we connect to Supabase (see D4).
- Traffic from Railway to external services, including uploads of rendered MP4s to R2, counts as Railway egress. Include it in cost per video.

**Alternatives considered.**
- *Vercel or other serverless functions for rendering:* rejected because of execution time, memory, disk, and binary limits.
- *Fly.io Machines:* strong for per-job VMs, but more operational setup. A candidate for the renderer only if Railway's per-replica model becomes expensive.
- *AWS ECS/Batch:* most control and potentially cheapest at scale, but too much setup for a beta.

**Revisit if.** Measured render compute makes Railway materially more expensive than dedicated or spot machines, or per-job isolation requirements exceed what a shared container provides.

## D3 — Authentication with Supabase Auth

**Decision.** Use Supabase Auth for sign-up, login, sessions, and password reset. The browser holds the session through `@supabase/ssr`/`supabase-js`. The Railway API verifies the access token on every request. Workspaces, memberships, and every access decision live in our own `app` schema tables.

**Why.**
- Login, email verification, OAuth providers, and session refresh are commodity work; building them is risk without product value.
- The same Supabase project also hosts the database, so per-environment configuration stays in one place.
- Verifying a standard JWT on the API keeps us independent of Supabase's client-side database features; we can swap auth providers by changing one verification module and the frontend login screens.

**Rules.**
- The frontend sends `Authorization: Bearer <access token>` to the API. No shared cookies between domains, which avoids CSRF handling.
- The API never trusts a workspace ID from the request without checking membership.
- The renderer never receives user tokens.

**Alternatives considered.** *Clerk:* faster for polished UI components and organizations, but a separate vendor from the database. *Better Auth / self-hosted:* no vendor lock-in, but we would own the security of sessions and password handling.

**Revisit if.** We need enterprise SSO, organization management, or auth features Supabase lacks.

## D4 — Supabase Postgres with Drizzle

**Decision.** Use Supabase Postgres as the only system database. Define the schema with Drizzle, generate SQL migrations, review them, commit them, and apply them with a Railway pre-deploy command on the `backend` service. Run plain Postgres locally from M3, matching Supabase's major version.

**Why.**
- Managed daily backups (Pro plan) and optional point-in-time recovery reduce operations work.
- A single Postgres implementation removes the SQLite-to-Postgres migration and the second job-queue implementation from the earlier plan.
- Drizzle produces plain SQL migrations that we can read and review, and typed queries without a heavy runtime.

**Connection rules.**
- `backend` and `worker` connect through Supabase's **session-mode pooler** (IPv4 compatible). pg-boss and migrations need session semantics; the transaction-mode pooler is not used.
- The direct connection is IPv6 by default; Railway outbound IPv6 is opt-in. Use the session pooler unless we enable IPv6 and measure a benefit.
- Keep pool sizes small (start: `backend` 10, `worker` 3 per replica) and check the total against the Supabase plan's connection limit.
- Put Railway and Supabase in the same region (see [Architecture §13](ARCHITECTURE.md#13-environments-regions-and-configuration)).

**Security rule.** Supabase automatically exposes certain schemas through its Data API to anyone with the publishable/anon key. Our tables live in an `app` schema that is not exposed, and the `anon` and `authenticated` roles get no privileges on `app` or the pg-boss schema. Any table that ever lands in `public` has RLS enabled with no policies. A test proves the anon key cannot read app data.

**Alternatives considered.** *Railway Postgres:* one fewer network hop and vendor, but we would own backups and restores. *Neon:* good serverless Postgres, but no bundled auth.

**Revisit if.** Cross-network latency between Railway and Supabase measurably hurts API or queue performance, or connection limits constrain worker count.

## D5 — pg-boss for jobs

**Decision.** Use pg-boss on the Supabase Postgres database for planning and render queues. Our own `jobs` and `job_attempts` tables remain the product-level source of truth for status, history, and billing.

**Why.**
- No Redis or additional queue service to run and pay for.
- Queue state lives next to app data, so we can enqueue in the same transaction that creates the job row, if the pinned pg-boss version supports sending through our transaction (verify). If it does, the outbox table becomes unnecessary; if not, keep the outbox.
- pg-boss handles delivery, expiration, retries with backoff, and scheduling (for reapers and retention jobs).

**Why keep our own job tables.** pg-boss archives and deletes its rows over time, and its states do not match our product states. The UI, support diagnostics, and usage ledger need permanent, tenant-scoped history and fencing tokens we control.

**Alternatives considered.** *BullMQ + Redis:* mature and fast, but another service and no transactional enqueue. *Managed workflow services (Inngest, Trigger.dev):* convenient, but rendering still needs our own container, and they add a vendor in the critical path.

**Revisit if.** Queue throughput or polling load on Postgres becomes measurable (unlikely below thousands of jobs per hour).

## D6 — Cloudflare R2 for media

**Decision.** Store uploaded assets and rendered outputs in private R2 buckets, one pair per environment. The API issues short-lived presigned URLs; the browser uploads and downloads directly.

**Why.**
- Video downloads and playback are the largest egress cost in this product. R2 does not charge for egress.
- It speaks the S3 API, so the AWS SDK and standard presigning work, and the storage adapter stays portable.

**Rules.**
- Assume a presigned PUT cannot enforce maximum file size (verify against current R2 docs). The API's upload-completion check (size, decoded type, dimensions, pixel limit, hash) is mandatory, and rejected objects are deleted.
- Uploads land under an `incoming/` prefix with a lifecycle rule that expires unverified objects; verified assets move to their permanent key.
- Bucket CORS allows `PUT` and `GET` only from our frontend origins.
- Separate API tokens: `backend` can read and write both buckets; `worker` can only read uploads and write outputs (verify R2 token scoping granularity).

**Alternatives considered.** *Railway buckets:* free egress and one fewer vendor; a reasonable fallback. *Supabase Storage:* convenient alongside auth, but egress is billed. *AWS S3:* egress fees make video delivery expensive.

**Revisit if.** R2 operation costs or missing features (for example upload policies) become a problem; Railway buckets are the first fallback.

## D7 — Fastify for the API

**Decision.** Build `backend` with Fastify and `fastify-type-provider-zod`, using the shared Zod schemas from `packages/contracts`.

**Why.** Fastify is mature, fast, has first-class TypeScript support, built-in request validation hooks, structured logging through pino, and well-maintained CORS, rate-limit, and graceful-shutdown plugins. The stated priority is a mature, stable stack.

**Alternatives considered.** *Hono:* lighter, with a typed RPC client, but younger. *Next.js route handlers on Vercel:* rejected because the API must hold database connections and long-lived queue clients.

## D8 — Node 24 LTS and npm workspaces

**Decision.** Pin Node 24 LTS (`.nvmrc`, `engines`, Docker base images) and use npm workspaces for `frontend`, `backend`, and `packages/*`. The `worker` keeps its own lockfile because its HyperFrames dependency tree is needed only inside its image. Changed from pnpm on 2026-10-02: pnpm was not installed and Node 26 no longer ships corepack, so npm avoids an extra toolchain step on every machine, Vercel, and Railway.

**Why.** Node 24 is the current LTS line suitable for CI and containers; local Node 26 is an observation, not a production choice. The frontend import boundary is enforced by a lint rule rather than by the package manager. Turborepo is added only if build times warrant it.

**Must verify.** HyperFrames 0.8.111 runs on Node 24. If not, pin the newest LTS it supports.

## D9 — Anthropic API for planning

**Decision.** Implement the planner adapter with the Anthropic SDK using tool use to return storyboard JSON that is then validated by Zod. Start with `claude-sonnet-5-5`; choose the production model by evaluating the fixture matrix for quality, latency, and cost.

**Why.** Tool-use output maps directly onto the storyboard schema, and the adapter boundary keeps the provider replaceable. Model output is still treated as untrusted data and never reaches the compiler without validation.

## D10 — Observability

**Decision.** Sentry for errors in web, API, and renderer; pino JSON logs to Railway's log stream; a request ID propagated from the browser through the API into job records and worker logs. Add OpenTelemetry tracing only when a concrete debugging need appears.

**Why.** It covers crash reporting and correlated logs with very little setup, which is what a beta needs.

## Cost model

Do not set prices from vendor list prices. Measure on staging:

`cost per accepted video = (Railway compute + Railway egress + Supabase + Vercel + R2 storage/operations + model tokens + operator time) / accepted videos`

Railway compute per render ≈ (vCPU used × render minutes × $20 / 43,200) + (GB RAM used × render minutes × $10 / 43,200), using Railway's per-minute rates verified on 2026-10-02. Record actual Railway metrics per job rather than estimating from limits. Report infrastructure cash cost and labor separately.

## Verified facts (2026-10-02, Railway docs)

- Pro plan replica limit: up to 24 vCPU and 24 GB RAM per replica; each replica gets the full limit.
- Resource pricing: $20 per vCPU-month and $10 per GB-month of RAM, billed per minute of use.
- Railway buckets: $0.015 per GB-month, free egress and API operations; uploads from a service to a bucket count as service egress.
- Old deployments receive `SIGTERM`, then `SIGKILL` after the draining time, which defaults to 0 seconds and is set by `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`.
- Pre-deploy commands run between build and deploy with access to the private network and service variables.
- Outbound IPv6 is an opt-in network setting.
- Environments and PR environments are supported.

## Must verify before provisioning (INFRA-01)

| Item | Why it matters |
| --- | --- |
| HyperFrames runs on Node 24 and inside a Linux Docker image | Determines the runtime pin and renderer image |
| pg-boss version supports Supabase session pooler and sending inside an app transaction | Decides whether the outbox table is needed |
| Supabase project uses asymmetric JWT signing keys and exposes a JWKS endpoint | Decides JWT verification method in the API |
| Supabase Data API exposed schemas and how to disable or restrict them | Prevents tenant data exposure through the anon key |
| Supabase plan connection limits and backup/PITR terms | Pool sizing and restore planning |
| R2 presigned PUT size enforcement, lifecycle rules, token scoping | Upload validation and least-privilege tokens |
| Current pricing for Vercel, Supabase, R2, and the model API | Cost model inputs |
| Region availability so all four vendors can be co-located | Latency and egress |
| Whether Railway offers any egress restriction for a service | Otherwise enforce network blocking inside the renderer |
