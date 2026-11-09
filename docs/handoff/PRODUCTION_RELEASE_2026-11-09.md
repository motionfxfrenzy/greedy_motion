# Production Release Report (2026-11-09)

## 1. Executive Summary & Deployment Status

- **Status**: **LIVE IN PRODUCTION (`64570b64c338375b06d3ca1c8c8c4cb4612036e5`)** — Fast-forwarded `origin/production` from `3d45b42fd2949a9b410dd452ee736ba61dc4557a` to `64570b64c338375b06d3ca1c8c8c4cb4612036e5` (`64570b6`), matching `origin/staging`.
- **Included Feature Set (`3d45b42..64570b6`)**:
  1. Per-step model routing & all-Gemini render planner (`gemini-4-argon` for `script`/`scriptWrite`/`sceneInsert`/`rewriteBeat`/`elementEdits`; `gemini-3.8-flash` for `director`/`sceneWriter`/`sceneRepair`/`frameSketch`/`motion`/`screenshot`/`formatFill`/`proAssistant`/`skillRouting`/`planner`; `gemini-2.5-flash` for `voiceAlign`/`siteRead`).
  2. Two-pane `FilmBrief`, branded dropdowns, `VoicePickerModal` with character voice assignment, and Hindi narration (`Devanagari` / `Roman`) with English on-screen captions (`b031cf8`, `7fabc68`).
  3. Live browser plate preview (`PLATE_LIVE_PREVIEW=on` + `NEXT_PUBLIC_PLATE_LIVE=1`), R2 uploads CORS, worker resilience, and job-control polling (`7fabc68`).
  4. Stuck-scene `Checking` recovery (`submitCheckReport` decisive override after transient `kind: "env"`, `drawn` variant check acceptance, `reconcilePlates` watchdog-timeout check-grace fallback, honest `>=90s` overdue checking ETA, storyboard sketch playback while processing, and 33ms RAF fallback timer) (`1cffafe`, `6d60bf5`).
  5. Shared email local-part validation (`+` rejected, `<=2` dots before `@`, domain dots excluded, no dot stripping) across frontend UI, Next.js SSR/callback/session middleware, Fastify auth/mail boundaries, and the Supabase Auth **Before User Created** Postgres hook (`app.before_user_created_hook`) (`31a8dc7`, `0a57a2c`, `c99a954`, `9d555af`).
  6. Vertical page scrolling in the stacked animation workspace at `<=860px` viewports (`64570b6`).

---

## 2. Pre-Mutation Production Rollback Baseline

Captured prior to any production mutation:
- **Git Branch (`origin/production`)**: `3d45b42fd2949a9b410dd452ee736ba61dc4557a` (`3d45b42`, `2026-11-07`).
- **Railway Production (`Greedy Motion Backend / production`)**:
  - Project ID: `5298f20e-3531-44a5-a32e-7b99b0cb5b09`
  - Environment ID: `2f57bf5f-a2db-4b65-98bc-c8d12d120149`
  - Service ID: `df6c5746-6c6e-4275-897d-75bb0cd6370b`
  - Prior Deployment ID: `2f0552f4-d237-437a-8f5b-23dbddb6e642` (`SUCCESS`, `2026-11-07 14:58:41 +08:00`)
  - Prior Routing/Worker Config: `PLATE_MODEL=claude-opus-5-5` (preserved in place), `ECS_WORKER_TASK_DEFINITION=greedymotion-production-worker:1`, no `MODEL_*` / `EFFORT_*` / `PLATE_LIVE_PREVIEW` / `WORKER_CONTROL_TOKEN`.
- **Vercel Production (`greddy-motion/greedy-motion`)**:
  - Project ID: `prj_ujsBrhqMWMk0XfBQXaJrEXbqOh2i` (`team_Txy1ApULK6qXTACz76p5idXT`)
  - Prior Deployment ID: `dpl_HTwrHovqNXYacw9qjdLA7211voiP` (`https://greedy-motion-qpo3rbmus-greddy-motion.vercel.app`, `READY`, `2026-11-07 14:58:43 +08:00`)
  - Prior Env: no `NEXT_PUBLIC_PLATE_LIVE`.
- **AWS ECS Production Worker (`us-east-1`, Account `369904858685`)**:
  - Cluster: `greedymotion-production`
  - Prior Task Definition: `arn:aws:ecs:us-east-1:369904858685:task-definition/greedymotion-production-worker:1` (`369904858685.dkr.ecr.us-east-1.amazonaws.com/greedymotion-production-worker:897283d-121018`, active and preserved).
- **Supabase Production (`pylqstxqvucrrzpcjkem`, `greedymotion-production`, `us-east-1`)**:
  - Prior `app.schema_migrations` latest: `030_plate_revision_manifest.sql` (`2026-11-07T06:41:57.789Z`).
  - Prior `auth.hook.before_user_created`: `enabled = false`, `uri = null`.

---

## 3. Deployed Production Targets (`64570b64c338375b06d3ca1c8c8c4cb4612036e5`)

- **GitHub Actions on `production` (`64570b6`)**:
  - `ci` run `42598046829`: `completed / success` (1m4s).
  - `supabase-migrate` run `42598046807`: `completed / success` (8s).
- **Railway Production Backend**:
  - Deployment ID: **`8b126a59-1283-44c8-8e50-91a359e05441`** (`SUCCESS`, commit `64570b64c338375b06d3ca1c8c8c4cb4612036e5`).
  - Public URL: `https://backend-production-1e413.up.railway.app` (`/healthz` -> `200`, `/readyz` -> `200`).
  - Startup Migration Applied: `031_before_user_created_hook.sql` at `2026-11-09T10:05:56.541Z`.
  - Verified Boot `modelRoutes`:
    ```json
    {
      "director": "gemini:gemini-3.8-flash",
      "elementEdits": "gemini:gemini-4-argon",
      "formatFill": "gemini:gemini-3.8-flash",
      "frameSketch": "gemini:gemini-3.8-flash",
      "motion": "gemini:gemini-3.8-flash",
      "planner": "gemini:gemini-3.8-flash",
      "proAssistant": "gemini:gemini-3.8-flash",
      "rewriteBeat": "gemini:gemini-4-argon",
      "sceneInsert": "gemini:gemini-4-argon",
      "sceneRepair": "gemini:gemini-3.8-flash",
      "sceneWriter": "gemini:gemini-3.8-flash",
      "screenshot": "gemini:gemini-3.8-flash",
      "script": "gemini:gemini-4-argon",
      "scriptWrite": "gemini:gemini-4-argon",
      "siteRead": "gemini:gemini-2.5-flash",
      "skillRouting": "gemini:gemini-3.8-flash",
      "voiceAlign": "gemini:gemini-2.5-flash"
    }
    ```
- **Vercel Production Frontend (`greddy-motion/greedy-motion`)**:
  - Deployment ID: **`dpl_8876aYyp8wWQYuW27TteiALQka8v`** (`https://greedy-motion-b49jmnyoo-greddy-motion.vercel.app`, `READY`, commit `64570b64c338375b06d3ca1c8c8c4cb4612036e5`, built with `NEXT_PUBLIC_PLATE_LIVE=1`).
  - Aliases: `https://app.greedymotion.com`, `https://www.greedymotion.com`, `https://greedymotion.com`, `https://greedy-motion.vercel.app`.
- **AWS ECS Production Render Worker (`us-east-1`, Account `369904858685`)**:
  - ECR Image: `369904858685.dkr.ecr.us-east-1.amazonaws.com/greedymotion-production-worker:64570b6-180129`
  - Immutable Image Digest: **`sha256:5096e88ce9c3e1e0dbd2c884790cdf8f404443361121fb3c9d990206260f367d`**
  - Task Definition ARN: **`arn:aws:ecs:us-east-1:369904858685:task-definition/greedymotion-production-worker:2`** (8 vCPU / 16 GB ARM64, `RENDER_CONCURRENCY=1`, `PLATE_CONCURRENCY=1`, `WORKER_CONTROL_URL=https://backend-production-1e413.up.railway.app`).
  - Secrets Manager (`ap-southeast-1`, referenced by ARN in `greedymotion-production-worker:2`): `arn:aws:secretsmanager:ap-southeast-1:369904858685:secret:greedymotion/production/worker/control-token-pg5bdJ` (matched to `WORKER_CONTROL_TOKEN` on Railway `production`).
  - R2 Uploads Bucket CORS (`greedymotion-production-uploads`): Configured `GET, HEAD` for `https://app.greedymotion.com`, `https://www.greedymotion.com`, `https://greedymotion.com`, `https://greedy-motion.vercel.app`.
- **Supabase Production Auth Hook (`pylqstxqvucrrzpcjkem`)**:
  - `auth.hook.before_user_created.enabled = true`
  - `auth.hook.before_user_created.uri = "pg-functions://postgres/app/before_user_created_hook"`
  - Pushed via minimal 2-property `supabase config push --project-ref pylqstxqvucrrzpcjkem`; `supabase config diff` verified all 17 existing production Auth/DB/Pooler settings (`site_url`, `additional_redirect_urls`, `enable_confirmations`, Google OAuth, `hook.send_email`, MFA, password policy, pooler) remain untouched.

---

## 4. Production Verification Matrix

| Check | Target | Status | Evidence |
|---|---|---|---|
| **Backend Health & Readiness** | `https://backend-production-1e413.up.railway.app` | **PASS** | `GET /healthz` -> `200 {"status":"ok","service":"backend"}`; `GET /readyz` -> `200 {"ready":true,"database":true}`. |
| **Public Voice Previews** | `https://backend-production-1e413.up.railway.app` | **PASS** | `GET /v1/voices/Kore/preview` -> `200 audio/wav` (`301,798 bytes`); `GET /v1/voices/Puck/preview` -> `200 audio/wav` (`230,758 bytes`). |
| **Frontend Public Pages & CSS Bundle** | `https://www.greedymotion.com` / `https://app.greedymotion.com` | **PASS** | `/` -> `200`, `/pricing` -> `200`, `/auth` -> `200`. Production stylesheet verified in browser (`tab_d7d9f07b-352c-4a83-9566-f2105318e6ed`) to include `.relay-shell--animation` and `@media (max-width:860px)` `overflow-y:visible!important` rules. |
| **Database Migration & Hook Privileges** | Production DB (`pylqstxqvucrrzpcjkem`) | **PASS** | `031_before_user_created_hook.sql` recorded in `app.schema_migrations`; `has_function_privilege`: `supabase_auth_admin = true`, `anon = false`, `authenticated = false`; `supabase db advisors --linked --project-ref pylqstxqvucrrzpcjkem` reported 0 issues on `app.before_user_created_hook`. |
| **Live Provider-Side `Before User Created` Hook (`POST /auth/v1/signup`)** | `https://pylqstxqvucrrzpcjkem.supabase.co/auth/v1/signup` | **PASS** | `verify+plus@example.invalid` -> `400 {"code":400,"error_code":"unknown","msg":"Email addresses with '+' before '@' are not supported."}`; `a.b.c.d.verify@example.invalid` -> `400 {"code":400,"error_code":"unknown","msg":"Email addresses with more than 2 dots before '@' are not supported."}`; `select count(*) from auth.users where email like '%@example.invalid'` -> **`0` rows created**. Valid hook checks for `0`, `1`, and `2` local dots (`nodots@example.com`, `one.dot@example.com`, `two.dots.ok@example.co.uk`) all returned `{}`. |
| **Live Production Auth UI Validation (`/auth`)** | `https://app.greedymotion.com/auth` (`tab_d7d9f07b-352c-4a83-9566-f2105318e6ed`) | **PASS** | Sign-in and Sign-up forms both reject `user+tag@example.invalid` (`"Email addresses with '+' before '@' are not supported."`) and `a.b.c.d@example.invalid` (`"Email addresses with more than 2 dots before '@' are not supported."`). |
| **Live Production ECS Worker `:2` Boot & Job-Control Poll** | ECS `greedymotion-production` (`us-east-1`) + Railway `production` | **PASS** | Launched verification task `arn:aws:ecs:us-east-1:369904858685:task/greedymotion-production/5f71206e0f6a47b8974a8ea3c96aa47d` (`greedymotion-production-worker:2`): reached `RUNNING`, logged `worker_ready` (`port: 8080`) and `worker_consuming` (`queue: "render-video", concurrency: 1, plateConcurrency: 1, workerId: "3588a88f-3c02-4440-b5d9-dad513069a82"`) in `/ecs/greedymotion-production-worker`, and connected to `POST https://backend-production-1e413.up.railway.app/internal/worker/poll` (`reqId: c98e6b48-46b9-46cd-aafa-c663a404bb7d`), then shut down cleanly on `SIGTERM`. |
| **Narrow Viewport (`<=860px`) Stacked Scrolling & Full Studio/Render E2E at `64570b6`** | `tab_f67f761a-d5f1-4a95-800e-a699b1384fbb` (`64570b6`) + `workspace-bar-layout-fixture.mjs` | **PASS** | Verified at `783x730` (`<=860px`) in the live browser tab (`mainClass: "relay-shell relay-shell--animation"`, `computedOverflowY: "visible"`, `scrollHeight: 1107 > clientHeight: 730`, `scrollTopAfter: 377`, `applyVisibleAtBottom: true`) and across `861x775`, `860x775`, `855x775`, `390x844`, `855x500` in `workspace-bar-layout-fixture.mjs`. |
| **Authenticated Production `/studio` Smoke** | `https://app.greedymotion.com/auth` (`tab_d7d9f07b-352c-4a83-9566-f2105318e6ed`) | **Awaiting Direct User Sign-In** | Per credential-boundary rules (no credentials retrieved from files/chats or exported across origins, and production `enable_confirmations = true` is preserved), browser tab `tab_d7d9f07b-352c-4a83-9566-f2105318e6ed` is open on `https://app.greedymotion.com/auth` for direct user sign-in if an interactive production project creation is desired. |

---

## 5. Safe Production Rollback Instructions

1. **Model Routing Rollback**:
   - Unset `MODEL_*` and `EFFORT_*` variables on Railway `production` (`environmentId=2f57bf5f-a2db-4b65-98bc-c8d12d120149`). `PLATE_MODEL=claude-opus-5-5` and `ANTHROPIC_API_KEY` remain in place.
2. **Supabase `Before User Created` Hook Rollback**:
   - Set `[auth.hook.before_user_created] enabled = false` via `supabase config push --project-ref pylqstxqvucrrzpcjkem`. (The `app.before_user_created_hook` function in schema `app` is harmless when the hook is disabled.)
3. **Code & Worker Rollback (No Force-Push)**:
   - Set `ECS_WORKER_TASK_DEFINITION=greedymotion-production-worker:1` and `PLATE_LIVE_PREVIEW=off` on Railway `production`, and redeploy prior Railway deployment `2f0552f4-d237-437a-8f5b-23dbddb6e642` and Vercel deployment `dpl_HTwrHovqNXYacw9qjdLA7211voiP` (or push a forward revert commit on `production`).
