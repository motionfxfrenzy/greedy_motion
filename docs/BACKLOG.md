# Ordered implementation backlog

All tasks are pending unless explicitly marked complete. Estimates are rough engineer-days and overlap with the milestone estimates; do not add them to those estimates.

Hosted stack (decided 2026-10-02, see [Stack decisions](STACK_DECISIONS.md)): Vercel for the frontend; Railway for the `backend` and `worker` services; Supabase for Auth and Postgres; Cloudflare R2 for media; pg-boss for jobs; Fastify, Drizzle, Zod, Node 24 LTS, npm workspaces.

## M0 — Baseline

- [x] DOC-01: Document execution gates, frontend/backend architecture, validation protocol, and backlog.
- [x] ENV-01: Inspect local runtime, encoder, browser, and repository state.
- [x] ENV-02: Pin HyperFrames locally and verify required render dependencies. Versions and environment findings recorded; initial doctor sandbox limitation documented.
- [x] VAL-01: Render a six-second animation and retain video, metadata, sampled frames, and run notes. Export and sampled-frame checks passed; continuous playback review remains before the full technical gate.
- [x] ENV-03: Define local, staging, and production environments with isolation rules, promotion flow, per-folder env templates, and a local Compose stack (Postgres 17 + renderer).
- [x] DOC-02: Select the hosted stack and record reasoning, alternatives, and items to verify.
- [x] CONT-01: Renderer container spike. Build and run `worker/Dockerfile` locally with Docker networking disabled; retain JSON self-test evidence. This proves a Linux runtime foundation only; it does not complete M4 RENDER-03.

## M1 — Local workflow (depends on M0)

- [ ] CORE-01: Repository foundation. Done 2026-10-02: npm workspaces (`frontend`, `backend`, `packages/*`; pnpm unavailable because Node 26 ships without corepack), Node 24 pin (`.nvmrc`, `engines`), root lockfile, per-folder env templates, prototype split into `frontend/`, `backend/`, `worker/` with Next.js API routes removed. Remaining: initialize Git, create the GitHub repo with `main`/`staging`/`production` branches and protection rules, and confirm `npm ci && npm run typecheck` from a clean clone.
- [ ] CORE-02: Define brief/storyboard/asset/job/error schemas in `packages/contracts`. Done when invalid timing (including totals other than 600 frames), crop, missing asset, and unknown template fail before rendering.
- [ ] CORE-03: Add lint and CI basics: ESLint, an import-boundary rule that blocks `frontend` from server packages, GitHub Actions running typecheck, lint, and unit tests.
- [ ] DATA-01: Add non-sensitive fixtures with asset provenance and approved copy.
- [ ] DESIGN-01: Produce one reviewed five-scene design, including explicit typography, safe zones, crop rules, and timing.
- [ ] RENDER-01: Implement `packages/compiler` and `packages/render-engine`. Done when a brief fixture produces a checked MP4, frames, and report.
- [ ] RENDER-02: Add draft/final settings and local asset/font staging. Done when a render succeeds with network access blocked for Chrome (the compiler currently fetches Inter) and fonts come from the bundled set.
- [ ] EDIT-01: Add immutable revisions and targeted scene patching. Done when unchanged scenes keep their input definitions and expected visuals.
- [ ] AI-01: Add the Anthropic planner adapter with tool-use output and one bounded schema repair. Done when invalid model output cannot reach compiler execution; record model, prompt version, and token usage.
- [ ] CLI-01: Expose prepare/plan/render/revise/inspect commands with useful exit codes and errors.

## M2 — Validation (depends on M1)

- [ ] VAL-02: Add portrait scene layouts; review at phone size.
- [ ] VAL-03: Run the fixture matrix, repeatability checks, and twenty-job benchmark.
- [ ] VAL-04: Measure operator time, model spend, render resources (peak RAM, CPU-seconds), failed attempts, and accepted-video cost.
- [ ] VAL-05: Deliver five customer trials and collect publishability/payment evidence. Record the cohort's location to confirm the hosting region.
- [ ] DEC-01: Record proceed/narrow/pause decision against Gates A–C. This blocks hosted-product expansion.

## Editing (spec: [Editing and AI revisions](EDITING.md))

- [x] EDIT-02a: Four starter templates (Product launch, Feature spotlight, Stat highlight, What's new) as HyperFrames compositions with declared variables; catalog with AI fill policy; template gallery; `templates:verify`; 64/64 template × theme checks. See [Templates](TEMPLATES.md).
- [ ] EDIT-02b: Per-scene sub-compositions, motion-preset and scene-length limits in the manifest, callout position variables.
- [ ] EDIT-03: Embed `<hyperframes-player>` from an isolated preview origin; form edits update the preview instantly; MP4 renders only on export with `--variables`.
- [ ] EDIT-04: SDK-backed revisions: every edit through `@hyperframes/sdk`, undo/redo, patches stored with the revision.
- [ ] EDIT-05: Timeline comments: capture time, range, click point, and element `hf-id` via a preview-origin `postMessage` bridge; list, resolve, mark stale.
- [ ] EDIT-06: AI edits from comments: context builder, Claude tool-use operations, scope + tier + manifest validation, claim check, `hyperframes check`, before/after review. Done when the acceptance checks in EDITING.md §8 pass.
- [ ] EDIT-07: Internal Studio for the template team.
- [ ] EDIT-08: Pro tier (customer Studio, wider AI operations). Blocked on the GSAP licensing decision (EDITING.md §2).

## Brand and audio (spec: [Brand kits, music, and voiceover](BRAND_AND_AUDIO.md))

- [x] BRAND-01: Brand kits from website, uploads, or manual entry; SSRF-safe extraction; WCAG-enforced brand themes; logo slot with wordmark and tone handling; 8/8 brand × template checks.
- [x] AUDIO-01: Lyria background music and Gemini TTS voiceover via GEMINI_API_KEY; Claude writes narration and music direction; ducked mix in the worker.
- [ ] BRAND-02: Move brand kits and audio to R2 for hosted deploys; expire staged uploads; optional vision-based extraction. Render-queue impact (2026-10-04): the worker reads `/brands/<id>` and `/audio/<jobId>` from disks shared with the backend, so a worker on another machine cannot render branded or narrated videos. Put brand kits (theme.css, fonts, logo) and per-job audio in R2; the backend writes their keys into `render_jobs.render_input`; the worker downloads them into the attempt's scratch directory with a read-only, prefix-scoped token. Done when a worker with no `/brands` or `/audio` mount renders the Linear kit with music and voiceover. Blocks more than one hosted worker replica.
- [ ] AUDIO-02: Captions from the voiceover (transcription for word timings); per-scene narration timing.

## M3 — Local app (depends on stable M1, release gated by M2)

- [ ] DB-01: Create `packages/db` with Drizzle schema in schema `app`, generated SQL migrations, and repositories that require an `AuthContext`. Run against local Postgres matching Supabase's major version. Done when migrations apply from empty, and every repository query filters by workspace. **Status 2026-10-07: partly done differently** — `app.projects` and `app.brand_kits` (jsonb + `owner_id`, RLS) with the backend's own SQL migrations, no Drizzle, per user rather than per workspace; see [Authentication, ownership and data](AUTH_AND_DATA.md).
- [ ] API-01: Create `backend` with Fastify, Zod type provider, error format, request IDs, idempotency records, `If-Match` concurrency, and health/readiness endpoints. Seed one local workspace; bind to loopback.
- [x] JOB-01 (done 2026-10-04; see [Render queue](RENDER_QUEUE.md)): pg-boss v12 on local Postgres; `app.render_jobs` with attempt fencing, native heartbeats, bounded retries with backoff, dead-letter queues, graceful `SIGTERM`; the job row and its message are enqueued in one transaction (no outbox needed). Definition of done met: killing a worker mid-render retried cleanly as attempt 2 with no duplicate output. Split out: cancellation → JOB-03; least-privilege worker role → DB-03; R2 outputs → MEDIA-02. Deferred: `job_attempts` history table (only if billing/audit needs per-attempt rows) and moving queue names into `packages/jobs` once the worker joins the npm workspace.
- [ ] JOB-03: Render cancellation. `POST /v1/render-jobs/:id/cancel` (idempotent) moves the row to `cancel_requested`; a job still `queued`/`planning`/`waiting` is cancelled at once (pg-boss `cancel` on its message); a running worker sees the request on its next fenced progress write, aborts the attempt signal (which already kills the HyperFrames process group via `run(..., { signal })`), deletes the attempt's files, and commits `cancelled` + `render-finished`. Add `cancelled` to the job contract, a Cancel button on the Render step, and project state back to "Draft storyboard". Never delete a previous successful export. Done when cancelling in each of queued, planning, waiting, and rendering ends `cancelled` within 5 s with no output file, no usage charge, and the worker free for the next job.
- [ ] MEDIA-01: Create `packages/storage` with the filesystem adapter, emulated presigned URLs, and the upload intent → complete verification flow (sharp decode, dimensions, pixel limit, SHA-256).
- [ ] UI-01: Build the `frontend` shell, project list, creation form, API client, and accessible loading/error/empty states.
- [ ] UI-02: Build brand-kit and brief editors with saved versions.
- [ ] UI-03: Build storyboard scene cards, focal crop editing, duration/copy validation with the fixed-total rule, proposed-revision diff, and approval.
- [ ] UI-04: (job polling by real stage done 2026-10-04: queue position, live frame count, retry note, Try again on failure.) Implement draft playback, job polling by stage, revision history, final export, and download.
- [ ] QA-01: Verify the complete browser workflow, including reload during rendering and one failed-job recovery.

## M4 — Hosted private beta (depends on DEC-01 and M3)

- [ ] INFRA-01: Work through the "must verify" list in [Stack decisions](STACK_DECISIONS.md#must-verify-before-provisioning-infra-01). Choose the region. Create the staging and production resources listed in [Environments](ENVIRONMENTS.md#setup-checklist): Railway environments, Supabase projects `videosaas-staging` and `videosaas-production`, R2 bucket pairs, Vercel Preview/Production variables, GitHub branches `main` (integration), `staging`, and `production` with protection rules. Record account owners and billing alerts.
- [ ] DB-03: Least-privilege database roles. Today the worker connects as the same user as the backend. Create `videosaas_worker` with only: `USAGE` on schemas `app` and `pgboss`; the pg-boss table and function privileges a consumer needs (fetch, heartbeat, complete, fail, send to `render-finished`); `SELECT` on `app.render_jobs` and `UPDATE` limited to the progress/result columns (`attempt`, `stage`, `progress`, `frames_done`, `frames_total`, `output`, `error`, `state`, `render_started_at`, `finished_at`, `updated_at`). No access to projects, brand kits, users, `app.entitlements`, `app.entitlement_events` or future billing tables, and no DDL. The backend role owns migrations and queue creation (the worker already starts with `migrate: false`). Separate `DATABASE_URL` per service in Railway; consider row-level checks so the worker can only update rows in `rendering`. Done when a test with the worker role is refused on `select * from app.<any other table>`, on `insert`/`delete` in `app.render_jobs`, and on `create table`, while a full render still succeeds. Local first (Compose init script), then Supabase in DB-02.
- [ ] DB-02: Point migrations at Supabase through the session pooler; run them as the `backend` pre-deploy command. Lock down the Data API: `app` and `pgboss` schemas unexposed, privileges revoked from `anon`/`authenticated`, RLS deny-all on any `public` table. Set pool sizes against plan limits. **Status 2026-10-07:** migrations run against Supabase (session pooler) at backend startup on staging and production; RLS read-only policies instead of the privilege revokes.
- [x] AUTH-01: Integrate Supabase Auth in `frontend`; implement `packages/auth` JWT verification (JWKS, issuer, audience, expiry), first-login user and workspace creation, membership-based workspace selection, and the CORS allowlist including the team-scoped preview pattern. **Status 2026-10-07: done per user** (Google + email/password, JWKS verification, 404 ownership) and deployed to staging and production; first-login user/workspace rows not built.
- [ ] MEDIA-02: Implement the R2 adapter: private buckets, `incoming/` lifecycle rule, bucket CORS, separate `backend` and `worker` tokens, presigned uploads and downloads, completion verification, retention, and deletion. Render-queue impact (2026-10-04): today the worker writes `var/renders/<jobId>-a<attempt>.mp4` and the backend streams it from the same disk. Change the worker to upload to the attempt key `renders/<jobId>/a<attempt>.mp4`, verify size and checksum, then commit the key in its fenced `finish`; `GET /v1/renders/:id` returns a short-lived presigned URL; delete losing attempts' objects. Project screenshots move with it. Done when backend and worker share no volume and the review player streams from R2 with range requests. Blocks more than one hosted worker replica.
- [ ] MEDIA-03 (added 2026-10-07): **Status 2026-10-08: steps 1–2 done on staging** — `backend/src/media.ts` writes every media file to the R2 media bucket (`greedymotion-staging-media`, keys `media/<projects|brands|audio>/…`) and refetches missing files; `scripts/backfill-media.ts` copied the staging volume (7/7, MD5-verified); `test/media.mjs` in CI; disk-loss recovery proven on hosted staging. Media links done 2026-10-08: `?t=` media tokens with the ownership check (`media-links.ts`, ownership test). Remaining: production bucket, backend key scope, lifecycle, variables and fresh-media recovery checks; staging replica/cache-coherence gate before removing volumes or scaling. **2026-10-09: no retained user media; production backfill intentionally skipped.** See [production setup](MEDIA_R2_ROLLOUT.md). Original scope: move screenshots, brand logos/fonts/theme CSS, plan audio and site snapshots from the backend's `/data` volume to R2, keyed by owner and project; replace open-by-id media GETs with ownership-checked routes or short-lived signed URLs; copy existing volume files. Done when the backend reads no user media from local disk and runs with 2 replicas on staging. Templates stay in Git ([Templates → Where templates live](TEMPLATES.md#where-templates-live-decision-2026-10-07)).
- [ ] RENDER-03 (needs MEDIA-02 and BRAND-02 before `replicas` > 1; DB-03 before the worker gets a hosted `DATABASE_URL`): Build the renderer Docker image (non-root, pinned Chrome/FFmpeg/HyperFrames/fonts, network-blocked Chrome). Deploy to Railway staging; benchmark fixtures for time, peak RAM, CPU, and egress; set replica size, replica count, and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` from the results.
- [ ] JOB-02: Verify the job protocol on Railway: redeploy during a render, replica crash, duplicate delivery, and cancellation all behave as in JOB-01. Add usage quotas at job creation.
- [ ] OPS-01: Add Sentry to web, api, and renderer; pino logs with request/job correlation; readiness checks; alerts for stalled queue, crash loops, failed publication, and usage spikes.
- [ ] QA-02: Test two-tenant isolation on every route, anon-key Data API denial, CORS rejection of unknown origins, invalid/expired tokens, duplicate requests, queue redelivery, stale approvals, cancellation, and worker death. **Status 2026-10-07: partial** — `npm run test:ownership -w backend` covers two-user isolation, invalid tokens and concurrent writes; anon-key Data API and CORS tests still to add.
- [ ] OPS-02: Finish CI/CD: renderer image build and fixture tests, deploy order (migrations → api → renderer → web), rollback steps, Vercel previews wired to staging, Supabase backup plan, and a restore exercise into staging.
- [ ] OPS-04: Write runbooks: stuck jobs, failed render, exhausted disk, media deletion, worker rollback, database restore, credential rotation, vendor outage.
- [ ] BETA-01: Onboard a small customer cohort and collect repeated-use evidence before broad signup.

## M5 — Paid pilot (depends on M4 operational gate)

- [ ] BILL-00 (added 2026-10-09; see [Entitlements](ENTITLEMENTS.md)): Database-backed entitlements for the Pro editor, so access is granted, ended and read without a deploy and billing can write the same rows later. **Status: built on branch `entitlements`, not deployed** — `app.entitlements` + audit (migration 004), `entitlementsFor()` with a brief per-replica cache and fail-closed 503, a route-level gate on every Pro route with view-only mode after a plan ends (403 `read_only`; files are never deleted), `GET /v1/me/entitlements`, `npm run grant:pro` / `revoke:pro` run inside the deployed backend, frontend loading/unavailable/retry states, tests in CI (`test:entitlements-eval`, `test:entitlements`). `PRO_USER_IDS` and `NEXT_PUBLIC_PRO_EDITOR` are removed. Remaining: staging then production rollout, a browser check of the signed-in flows, cancelling queued Pro jobs on revoke (with JOB-03).
- [ ] BILL-01: Set pilot price and export/revision limits from measured costs (Railway, Supabase, Vercel, R2, model tokens, operator time) and customer feedback.
- [ ] BILL-02: Implement usage reservations, settlement/release, and a unique operation ledger.
- [ ] BILL-03: Integrate Stripe checkout and verified, replay-safe billing webhooks on the API; test before live collection. The entitlement side is already specified and tested ([Entitlements → Billing contract](ENTITLEMENTS.md#billing-contract-bill-03)): convert the provider object to a `SubscriptionSnapshot`, `rowFromSubscription`, `upsertEntitlement` inside one `withTransaction` with the `webhook_events` dedupe row; map the user through `billing_accounts` set at checkout; scheduled cancellation keeps edit access to the period end, payment failure only through the grace period, then view-only. Confirm the merchant of record (the pricing proposal names Lemon Squeezy).
- [ ] OPS-03: Publish customer-facing retention/support terms and implement support diagnostic lookup by request ID.
- [ ] VAL-06: Measure actual paid conversion, repeat use, margin, failure rate, and support minutes.

## Definition of done for each milestone

Working artifacts, relevant checks, documented known limits, and a recorded acceptance decision. A scaffold, successful API response, or a single good screenshot is insufficient evidence for a complete video workflow.
