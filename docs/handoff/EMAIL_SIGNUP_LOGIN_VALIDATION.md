# Email Signup & Login Validation Handoff

## Summary
Implemented shared email local-part validation on signup and login across the frontend auth entry points, Next.js session/callback boundaries, and backend trust boundaries:
- Trims surrounding whitespace before validation; rejects internal whitespace and preserves ordinary `local@domain.tld` syntax validation.
- Rejects any `+` in the parsed local part (before `@`).
- Allows at most **2 dots** (`0`, `1`, or `2`) in the parsed local part; rejects **3 or more dots** (`3+`).
- Excludes domain dots (after `@`) from the local-part dot count.
- Does **not** strip dots or rewrite/normalize email identities.
- Rejects existing accounts whose email addresses contain `+` or `3+` local-part dots at login, session refresh, OAuth callback, and backend JWT verification (`403 invalid_email`).
- Avoids echoing rejected user email addresses into logs.

## Branch & Worktree
- **Worktree**: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-email-validation`
- **Branch**: `codex/email-signup-login-validation` (branched cleanly from `staging` at `7fabc68`)
- **Other active session preserved**: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-voice` (`voice-language`) was left untouched with all its uncommitted files intact.

## Changed Paths
- `packages/contracts/src/email.ts` — Shared `validateEmailAddress`, `emailProblem`, `isAllowedEmail`, `MAX_EMAIL_LOCAL_DOTS`, and user-facing validation messages.
- `packages/contracts/src/index.ts` — Re-exports `./email.ts`.
- `packages/contracts/package.json` — Exports `./email`.
- `frontend/components/auth-page.tsx` — Validates email on signup, password sign-in, forgot-password request, and OTP verification using `validateEmailAddress`; passes trimmed email to Supabase Auth and displays specific validation feedback (`+` vs `>2 dots` vs syntax); handles `?error=invalid_email`.
- `frontend/app/auth/callback/route.ts` — Validates `data.user.email` after `exchangeCodeForSession(code)` (covers Google OAuth and email confirmation/recovery links); signs out and redirects to `/auth?error=invalid_email` if disallowed.
- `frontend/utils/supabase/middleware.ts` & `frontend/proxy.ts` — Validates `claims.email` on session refresh; signs out disallowed sessions and redirects guarded routes to `/auth?error=invalid_email&next=...`.
- `frontend/app/auth/reset/page.tsx` — Validates active recovery session email before allowing password update.
- `frontend/components/profile-page.tsx` — Validates `account.email` before sending a password reset link.
- `frontend/components/site-nav.tsx`, `frontend/components/landing-page.tsx`, `frontend/app/plans/page.tsx` — Treats sessions with disallowed emails as not signed in.
- `frontend/lib/api.ts`, `frontend/lib/pro-api.ts` — Signs out and redirects to `/auth?error=invalid_email` if the backend returns `403 { error: { code: "invalid_email" } }`.
- `backend/src/auth.ts` — Enforces `validateEmailAddress(payload.email)` in `registerAuth` after JWT signature verification; returns `403 { error: { code: "invalid_email", message } }` without logging the email address.
- `backend/src/mail/hook.ts` — Enforces `validateEmailAddress(payload.user.email)` in `emailFromHook` (`/v1/auth/email-hook`), refusing to send auth emails (`400`) for disallowed addresses.
- `backend/src/mail/welcome.ts` — Skips claiming or sending welcome emails (`status: "no_email"`) if `user.email` fails validation.
- `backend/package.json` — Adds `test:email-validation` script.
- `backend/test/email-validation.mjs` & `backend/test/mail.mjs` — Backend unit & Fastify `registerAuth` / `emailFromHook` / `sendWelcome` regression tests (including log-redaction check).
- `frontend/test/email-validation.mjs` — Frontend validation and cross-boundary consistency regression tests.

## Hosted-Provider Enforcement Gaps & Unsupported Flows
1. **Direct calls to hosted Supabase Auth REST API (`/auth/v1/signup`, `/auth/v1/token`, `/auth/v1/otp`)**:
   - Because the frontend uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, a user bypassing the web UI could call Supabase Auth's hosted `/auth/v1/signup` directly.
   - **What happens today**:
     - If Supabase's Send Email Hook (`/v1/auth/email-hook`) is enabled, our backend rejects the email hook with `400`, so no confirmation/recovery/magic-link email is sent.
     - Even if a token is obtained (e.g., an existing account via `/auth/v1/token?grant_type=password` or Google OAuth with a disallowed address), `frontend/app/auth/callback/route.ts`, `frontend/utils/supabase/middleware.ts`, and `backend/src/auth.ts` (`403 invalid_email`) reject the session and block all `/v1/*` API access and guarded app routes.
   - **Optional hosted hardening**: To prevent `auth.users` row creation at the Supabase GoTrue layer for direct API callers (or Google OAuth first-time signups with disallowed emails), configure a Supabase **Before User Created** Auth Hook (`[auth.hook.before_user_created]`) in the Supabase Dashboard (Staging `ltaxhznuixoslbbcjkts`, Production `bwwquxhexwyodsavsjar`) with a Postgres function checking the same local-part rule.
2. **Provider-specific alias rules**:
   - As noted in the task brief, this rule blocks `+` tags and `3+` local-part dots, which also blocks existing accounts with such addresses, and intentionally does **not** strip dots or implement provider-specific alias canonicalization (e.g., `first.last@gmail.com` vs `firstlast@gmail.com` or `googlemail.com`).

## Verification Run
- `npm run typecheck` (all workspaces: `@videosaas/frontend`, `@videosaas/backend`, `@videosaas/contracts`) — **PASS**
- `node backend/test/email-validation.mjs` — **PASS**
- `node backend/test/mail.mjs` — **PASS**
- `node --test frontend/test/email-validation.mjs` — **PASS**

## Recommended Integration Steps (After Stuck-Scene Session Completes)
1. Inspect the commit on `codex/email-signup-login-validation`:
   ```sh
   git log -n 1 --stat codex/email-signup-login-validation
   ```
2. Merge or cherry-pick `codex/email-signup-login-validation` into the target integration branch (`main` / `staging`) once the other Argon session finishes its stuck-scene work:
   ```sh
   git merge --no-ff codex/email-signup-login-validation
   ```
3. Run `npm run typecheck && npm run test:email-validation -w @videosaas/backend && npm run test:mail -w @videosaas/backend && node --test frontend/test/email-validation.mjs` before pushing to `staging`.
4. Clean up the temporary worktree once merged:
   ```sh
   git worktree remove /Users/osamaehsaan/Code/Market_apps/VideoSaaS-email-validation
   ```
