# Email Signup & Login Validation — Review, Provider Enforcement & Staging Rollout

## 1. Summary & Rules Enforced
Implemented and deployed shared email local-part validation across the frontend UI, Next.js SSR/callback/session middleware, Fastify backend auth & mail boundaries, and the Supabase Auth **Before User Created** Postgres hook:
- **Whitespace & Syntax**: Trims surrounding whitespace (`input.trim()` / `regexp_replace(raw_email, E'^[\\s]+|[\\s]+$', '', 'g')`) before validation; rejects internal whitespace and preserves standard `local@domain.tld` syntax validation with a single `@`.
- **`+` Rejection**: Rejects any `+` in the parsed local part before `@` (`Email addresses with '+' before '@' are not supported.`).
- **Local-Part Dot Limit (`<= 2`)**: Allows `0`, `1`, or `2` dots (`.`) in the parsed local part before `@`; rejects `3` or more dots (`Email addresses with more than 2 dots before '@' are not supported.`).
- **Domain Dots Excluded**: Dots in the domain part (after `@`) are excluded from the local-part dot count.
- **No Alias Rewriting / No Dot Stripping**: Preserves exact email identity (after surrounding whitespace trim) without stripping dots or inventing provider-specific alias normalization.
- **Existing Accounts & Session Boundaries**: Existing accounts with `+` or `>2` local-part dots are rejected on sign-in, password reset, session refresh (`updateSession`), OAuth/email callback (`/auth/callback`), and backend JWT verification (`403 { error: { code: "invalid_email", message } }`), without deleting accounts or mutating stored identities/entitlements, and without echoing rejected email addresses into logs.

---

## 2. Target Isolation Verification (Staging vs. Production)
Before applying any database migration or Supabase Auth Hook configuration, target isolation between staging and production was verified across Railway, Supabase, and Vercel:

| Environment | Railway Environment ID | `SUPABASE_URL` / Project Ref | Database Pooler Host | Status |
|---|---|---|---|---|
| **Staging** | `07084322-b9de-41c1-8bd0-225ffa063faf` | `https://syijhbillbgsnozggibk.supabase.co` (`syijhbillbgsnozggibk`, `greedymotion-staging`) | `aws-0-ap-southeast-1.pooler.supabase.com` | **Updated & Verified** |
| **Production** | `2f57bf5f-a2db-4b65-98bc-c8d12d120149` | `https://pylqstxqvucrrzpcjkem.supabase.co` (`pylqstxqvucrrzpcjkem`, `greedymotion-production`) | `aws-0-us-east-1.pooler.supabase.com` | **Untouched (Out of Scope)** |

---

## 3. Account-Boundary Review & Provider-Side Hook Details

### 3.1 Provider-Side `Before User Created` Hook (`app.before_user_created_hook`)
- **Why needed**: Relying on the `Send Email` hook (`/v1/auth/email-hook`) alone does not prevent `auth.users` row creation because Supabase GoTrue inserts the user record before invoking `Send Email` (and first-time Google OAuth signups do not invoke `Send Email`).
- **Migration files**:
  - `backend/src/db/migrations/031_before_user_created_hook.sql` (applied automatically by the backend startup migration runner and recorded in `app.schema_migrations`).
  - `supabase/migrations/20261109074526_before_user_created_email_validation.sql` & `supabase/config.toml` (`[auth.hook.before_user_created]` with `uri = "pg-functions://postgres/app/before_user_created_hook"`).
- **Security & Privileges**:
  - Defined in non-exposed schema `app` (`app.before_user_created_hook(event jsonb)`), `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`.
  - `REVOKE ALL ON FUNCTION app.before_user_created_hook(jsonb) FROM public, anon, authenticated;`
  - `GRANT USAGE ON SCHEMA app TO supabase_auth_admin; GRANT EXECUTE ON FUNCTION app.before_user_created_hook(jsonb) TO supabase_auth_admin;`
  - Verified on staging via `supabase db advisors --linked --project-ref syijhbillbgsnozggibk` (zero security findings on `app.before_user_created_hook`).
- **Hook Activation on Staging (`syijhbillbgsnozggibk`)**:
  - Pushed solely `[auth.hook.before_user_created]` (`enabled = true`, `uri = "pg-functions://postgres/app/before_user_created_hook"`) to `syijhbillbgsnozggibk` via `supabase config push --project-ref syijhbillbgsnozggibk`, preserving all 14 existing remote Auth/DB/Pooler settings.

### 3.2 Broader Account-Boundary Review Decisions
1. **Middleware & `/auth` Redirect Loop Prevention (`frontend/proxy.ts`, `frontend/utils/supabase/middleware.ts`)**:
   - In `updateSession`, if `claims.email` fails `validateEmailAddress`, `supabase.auth.signOut()` clears the session cookies on `response` and returns `{ signedIn: false, emailRejected: true }`.
   - On guarded routes (`/studio`, `/profile`, etc.), `proxy.ts` copies the cleared cookies onto the redirect response to `/auth?error=invalid_email&next=...`.
   - On `/auth`, `signedIn` is `false`, so it renders `/auth` with the error banner and cleared cookies — **no redirect loop**.
   - Additionally fixed `/auth?next=<path>` when `signedIn` is `true` so `proxy.ts` redirects to the validated `next` path rather than hardcoded `/studio`.
2. **OAuth Callback & Provider Hook Error Surfacing (`frontend/app/auth/callback/route.ts`, `frontend/components/auth-page.tsx`)**:
   - When `before_user_created` rejects a first-time Google OAuth signup, GoTrue redirects to `/auth/callback?error=server_error&error_description=...`. `callback/route.ts` forwards the `before '@'` error description to `/auth?error=invalid_email&error_description=...` so `AuthPage` displays the specific email rule message instead of a generic callback error.
   - If an existing OAuth account with a disallowed email exchanges a code at `/auth/callback`, `callback/route.ts` signs out before `sendWelcomeEmail` can fire and redirects to `/auth?error=invalid_email`.
3. **Client Session Lookups & Live Scene Requests (`frontend/components/account-menu.tsx`, `frontend/lib/live/api.ts`, `frontend/components/plate-live-stage.tsx`)**:
   - `account-menu.tsx` checks `validateEmailAddress` before publishing session user state and signs out disallowed sessions.
   - `withBackendAuth` in `frontend/lib/live/api.ts` (used by `PlateLiveStage`) triggers sign-out and redirect to `/auth?error=invalid_email` on `403 invalid_email`, matching `apiFetch` (`frontend/lib/api.ts`) and `proFetch` (`frontend/lib/pro-api.ts`).
4. **Transactional Email Guards (`backend/src/mail/hook.ts`, `backend/src/mail/welcome.ts`, `backend/src/mail/render-ready.ts`)**:
   - `emailFromHook` rejects disallowed addresses with `HookError(400, checked.message)`.
   - `sendWelcome` and `sendRenderReady` both validate the recipient address with `validateEmailAddress` and return `{ status: "no_email" }` without claiming database rows or calling Resend/Brevo if disallowed.
5. **Ownership, Billing Webhooks & Entitlements**:
   - Left untouched by email validation: ownership (`callerId` UUID), LemonSqueezy webhook processing (`backend/src/billing/service.ts` by `user_id`), and `app.entitlements` remain keyed by UUID and never mutate or delete user accounts.

---

## 4. Integration, Deployment SHAs & Verification Evidence

### 4.1 Coordination & Merge with Stuck-Scene Fix
- Waited for active session `ses_e4163e13bffeYP9abJo46fN3Xv` to finish deploying and verifying its stuck-scene commits (`1cffafe` and `6d60bf5`) on `staging` (`d5be733f-b834-45e6-b469-fb7a8dc63592`).
- Merged `origin/staging` (`6d60bf5`) cleanly into `codex/email-signup-login-validation` (`0a57a2c`) producing merge commit **`c99a95430d13c226899b107388d3e95da0876924`** (`c99a954`), preserving all stuck-scene changes in `backend/src/plates/*` and `frontend/components/plate-*`.
- Pushed `c99a954` to `origin/staging`. (No `worker/` files changed between `6d60bf5` and `c99a954`, so the AWS ECS worker task definition `greedymotion-staging-worker:20` required no rebuild.)

### 4.2 Deployed Staging Targets (`c99a95430d13c226899b107388d3e95da0876924`)
- **GitHub Actions CI**: Run `42590735145` on `staging` (`c99a954`) — `completed / success`.
- **Railway Staging Backend**:
  - Project: `5298f20e-3531-44a5-a32e-7b99b0cb5b09` (`lively-presence`)
  - Environment: `07084322-b9de-41c1-8bd0-225ffa063faf` (`staging`)
  - Service: `df6c5746-6c6e-4275-897d-75bb0cd6370b` (`backend`)
  - Deployment ID: **`1670dacc-4ec0-497d-9681-bd6c920c6c63`** (`SUCCESS`, commit `c99a95430d13c226899b107388d3e95da0876924`)
  - Startup migration `031_before_user_created_hook.sql` applied at `2026-11-09 09:08:22.560402+00`; `/healthz` -> `200`, `/readyz` -> `200`.
- **Vercel Staging Frontend (`greddy-motion/greedy-motion-staging`)**:
  - Deployment: `https://vercel.com/greddy-motion/greedy-motion-staging/E6mKJPauHkAznThtmwg42xkTSoU1` (`READY / success`, commit `c99a95430d13c226899b107388d3e95da0876924`)
  - Production Vercel (`greedy-motion`): Canceled by Ignored Build Step (untouched).

### 4.3 Local & Hosted Verification Matrix
| Check | Target | Result |
|---|---|---|
| `npm run typecheck` (all workspaces) | Local | **PASS** |
| `node backend/test/email-validation.mjs` (unit + Fastify JWT + `emailFromHook` + `sendRenderReady` + PG `app.before_user_created_hook`) | Local PG | **PASS** |
| `node backend/test/mail.mjs` | Local | **PASS** |
| `node backend/test/plate-progress.mjs` & `node backend/test/plate-check-fallback.mjs` (stuck-scene regression suite) | Local PG | **PASS (8/8 cases)** |
| `node --test frontend/test/email-validation.mjs frontend/test/live-backend-auth.mjs frontend/test/plate-progress-logic.mjs` | Local | **PASS (27/27 tests)** |
| **Hosted Provider Hook (`POST https://syijhbillbgsnozggibk.supabase.co/auth/v1/signup`)**: `verify+plus@example.invalid` & `a.b.c.d.verify@example.invalid` | Hosted Staging Supabase | **PASS** — HTTP `400` with exact messages; `select count(*) from auth.users where email like '%@example.invalid'` confirmed **`0` rows created**. |
| **Hosted Valid Login & API (`0`, `1`, and `2` local dots)**: `valid.two_<ts>@example.invalid` (1 dot) & `a.b.c_<ts>@example.invalid` (2 dots) | Hosted Staging Supabase + Railway + Vercel | **PASS** — Signed in via UI (`/auth?next=%2Fprofile` -> redirected to `/profile` with trimmed email) and `GET /v1/projects` returned `200 { projects: [] }`; temporary test users deleted and verified `0` remaining. |
| **Hosted Legacy Disallowed JWT Rejection (`403 invalid_email`)** | Hosted Staging Railway | **PASS** — Presenting a valid Supabase JWT for a legacy `+` or `3+` dot email to `GET https://backend-staging-aec6.up.railway.app/v1/projects` returned `403 { error: { code: "invalid_email", message: ... } }`. |
| **Hosted Staging UI Validation (`https://greedy-motion-staging.vercel.app/auth`)** | Hosted Staging Vercel (Playwright Chrome) | **PASS** — Verified signup, sign-in, forgot-password, and `/auth?error=invalid_email` alerts for `+` and `3+` local-part dots. |
| **Stuck-Scene Project Preservation (`d5be733f-b834-45e6-b469-fb7a8dc63592`)** | Hosted Staging DB | **PASS** — All 6 `app.plate_variants` rows (`16:9` and `9:16` across scenes 0, 1, 2) remain in `drawn` / `checked` state. |

---

## 5. Remaining Production Blockers (Out of Scope Until Authorized)
- **Production is untouched** (`origin/production` at `3d45b42`, Supabase project `pylqstxqvucrrzpcjkem`).
- When production promotion is authorized:
  1. Promote the verified `staging` commit to `production` (which will apply `031_before_user_created_hook.sql` on startup, or apply `supabase/migrations/20261109074526_before_user_created_email_validation.sql`).
  2. Enable `[auth.hook.before_user_created]` (`uri = "pg-functions://postgres/app/before_user_created_hook"`) on the production Supabase project (`pylqstxqvucrrzpcjkem`).
