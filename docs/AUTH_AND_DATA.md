# Authentication, ownership and data

Date: 2026-10-07. Status: implemented and deployed to staging and production. This page describes what is built; the
target design (workspaces, memberships, asset tables) is still [Architecture §5 and §9](ARCHITECTURE.md#5-authentication-and-authorization).

## What is built, in one picture

```text
browser ──Supabase Auth (Google or email+password)──▶ session cookie (sb-<ref>-auth-token)
browser ──Authorization: Bearer <access token>──▶ backend /v1/*
backend: verify JWT (JWKS) → request.user.id → ownership check → Postgres (app.projects, app.brand_kits, app.render_jobs)
Supabase Auth emails (confirm, reset) ──SMTP──▶ Resend (branded sender)
```

Supabase does all of auth: sign-up, sign-in, sessions, password reset, email confirmation and Google OAuth. Resend only
delivers Supabase's emails over SMTP so they come from our domain. There is no custom auth code and no auth table of
our own.

## Frontend

| Piece | File | Behaviour |
| --- | --- | --- |
| Sign-in page | `frontend/components/auth-page.tsx` | Continue with Google; email + password sign-up and sign-in; "Forgot password?" sends a reset email. Sign-up with an existing email shows "already exists". `?next=` returns the user to where they were (same-origin paths only). |
| OAuth / email-link landing | `frontend/app/auth/callback/route.ts` | Exchanges the PKCE `code` for a session, then redirects to `next` (default `/studio`); failure goes to `/auth?error=callback`. |
| Password reset | `frontend/app/auth/reset/page.tsx` | Sets the new password for the session the reset link created. |
| Session refresh and route guard | `frontend/proxy.ts`, `frontend/utils/supabase/middleware.ts` | Refreshes the session cookie on every request (validated with `getClaims`). Signed-out `/studio*` → `/auth?next=…`; signed-in `/auth` → `/studio`. |
| API calls | `frontend/lib/api.ts` (`apiFetch`) | Adds `Authorization: Bearer <access token>` to every backend call; a 401 sends the user to `/auth`. |
| Sign out | Studio top bar (`frontend/components/studio.tsx`) | `supabase.auth.signOut()` then `/auth`. |

Frontend variables (all public by design): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_API_URL`. If the Supabase pair is missing, `proxy.ts` throws on every request and the whole site returns 500
(this happened on staging on 2026-10-07): set them before deploying the auth code.

## Backend

| Piece | File | Behaviour |
| --- | --- | --- |
| Token check | `backend/src/auth.ts` | `onRequest` hook on `/v1/*`. Verifies the Supabase access token against the project JWKS (`jose`), issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`. Missing → 401 `unauthenticated`; bad/expired → 401 `invalid_token`. Sets `request.user = { id, email }`. |
| Open routes | `backend/src/auth.ts` (`openGets`) | GETs used by `<img>`, `<video>` and iframes, which cannot send a header: `/v1/preview/*`, `/v1/renders/:id`, `/v1/projects/:id/screenshots/:sid`, `/v1/brands/:id/logo`, `/v1/brands/assets/:id/preview`. Protected only by unguessable UUIDs (see open items). |
| Ownership | `backend/src/access.ts` | `preHandler` hook. Another user's project, brand kit or render job returns 404 (same as "does not exist", so ids cannot be probed). Requests that reference a brand kit (`brandId` or `request.brandId` in the body) are refused unless the caller owns it. |
| Owner on create | `server.ts`, stores | `ownerId` comes from the verified token (`callerId(request)`), never from the request body. |
| Config | `backend/src/config.ts` | `AUTH_MODE=none` (local only) or `supabase` (required when `APP_ENV` is staging or production). `SUPABASE_URL` must match `EXPECTED_SUPABASE_PROJECT_REF`, so staging cannot point at production by mistake. |

`AUTH_MODE=none` makes every request the fixed local user `00000000-0000-4000-8000-000000000000`.

## Data model (Postgres, schema `app`)

| Table | Holds | Key columns |
| --- | --- | --- |
| `app.projects` | One project: brief, script, beat plan, studio draft, comments, screenshot metadata (`data jsonb`, same shape as the API's `VideoProject`) | `id`, `owner_id uuid`, `name`, `state`, `created_at`, `updated_at`; index `(owner_id, updated_at desc)` |
| `app.brand_kits` | One brand kit's metadata (`data jsonb`, the API's `BrandKit`) | `id`, `owner_id uuid`, `name`, `created_at`; index `(owner_id, created_at desc)` |
| `app.render_jobs` | Render job state (existing) | `owner_id uuid` for jobs with no project; project jobs are owned through their project |
| `pgboss.*` | Job queue (pg-boss) | — |

Migrations (applied by the backend at startup, each once, under an advisory lock): `001_render_jobs.sql`,
`002_render_job_owner.sql`, `003_projects_and_brand_kits.sql`.

Writes to one project run in a transaction holding `select … for update` on its row (`withRowLock` in
`backend/src/db/database.ts`), so concurrent writers (API requests, render consumers, several replicas) cannot lose each
other's fields.

### Row-level security (second layer)

Enabled on `app.projects`, `app.brand_kits` and `app.render_jobs` in Supabase. Policies let the `authenticated` role
**read only its own rows** (`(select auth.uid()) = owner_id`); there are no write policies, so the Supabase Data API
cannot change anything. The backend connects as the table owner and is not subject to RLS; its own checks are the first
layer. The local Docker Postgres has no `auth` schema, so migration 003 skips the RLS block there.

### What is not in Postgres

Binary files stay on the backend's disk (`/data` volume on Railway, `var/` locally): screenshots, brand logos, fonts and
theme CSS, plan audio, site snapshots. Rendered MP4s go to R2 when `STORAGE_DRIVER=r2`. Moving the rest to R2 is the
next storage step (see open items).

## Records from before ownership

Projects and brand kits saved before 2026-10-07 have no owner. With `AUTH_MODE=supabase` they are hidden from everyone
unless `LEGACY_OWNER_ID` names the Supabase user that should see them; with `AUTH_MODE=none` the local user sees them.

`npm run import:file-records -w backend -- [--owner <uuid>] [--dry-run]` copies old `project.json` / `brand.json` files
into the tables. It is idempotent (existing rows are untouched). Done on 2026-10-07:

| Environment | Imported | Owner |
| --- | --- | --- |
| local | 8 projects, 5 brand kits | none (hidden) |
| staging | 1 project ("E2E staging probe") | Google account on staging (`1f19dcf6-…`) |
| production | nothing (no files) | — |

Run it inside a deployed service with `railway ssh -e <env> -s backend -- node scripts/import-file-records.ts …`
(needs an SSH key registered with `railway ssh keys add`).

## Tests

`npm run test:ownership -w backend` starts a throwaway backend that trusts a locally generated signing key, with temp
data dirs, and plays two users. It checks: 401 without a token; the owner comes from the token, not the body; each user
lists only their own projects; 404 on another user's project across eight routes; brand kits cannot be seen or
attached by another user; rows are in Postgres with their owner; unowned records stay hidden; parallel writes keep every
change. It needs `DATABASE_URL` (local Docker Postgres) and removes its rows afterwards. With the ownership hook
disabled, 2 of the 10 checks fail.

## Supabase Auth configuration (per project)

| Setting | Staging (`ltaxhznuixoslbbcjkts`) | Production (`bwwquxhexwyodsavsjar`) |
| --- | --- | --- |
| Google provider | Client "Greedy Motion Staging" (GCP project `greedy-motion`) | Client "Greedy Motion Production" |
| Google redirect URI | `https://ltaxhznuixoslbbcjkts.supabase.co/auth/v1/callback` | `https://bwwquxhexwyodsavsjar.supabase.co/auth/v1/callback` |
| Google JS origins | `http://localhost:3000`, `https://greedy-motion-staging.vercel.app` | `https://www.greedymotion.com`, `https://greedymotion.com` |
| Site URL / redirect URLs | `https://greedy-motion-staging.vercel.app`, `…/**`, `http://localhost:3000/**` | `https://www.greedymotion.com`, `…/**` (to confirm) |
| SMTP | Resend, sender on `greedymotion.com` | Resend (to confirm) |
| Leaked-password protection | Off (to enable) | Off (to enable) |

The Google app's consent screen is in Testing until published; only listed test users can sign in. Test accounts are
in [Test users](TEST_USERS.md).

## Open items

1. Turn on leaked-password protection in both Supabase projects (security advisor warning).
2. Media links are open by id (screenshots, logos, previews, rendered video). Fix with R2 + short-lived signed URLs
   (the storage step below).
3. Move screenshots, logos, fonts, theme CSS, plan audio and site snapshots to R2, keyed by owner and project; then the
   backend can run more than one replica and the Railway volume becomes optional.
4. Production backend has no public domain, so the production frontend cannot reach the API (fine while production
   shows "Coming soon").
5. Production auth settings marked "to confirm" above, and publishing the Google consent screen, before launch.
6. Workspaces/teams (Architecture §5) are not built: ownership is per user.
