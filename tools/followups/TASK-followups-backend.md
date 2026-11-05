# Task for the coding agent: backend follow-ups (generic upstream errors, test isolation, one database guard)

You work for a manager (Claude) who re-runs your key checks and reads your diff. Read this whole file first and do what it says, in order. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-followups-be` (branch `codex/followups-backend`, started from the integration tip `20585df`). Work only in this worktree. Your throwaway database is `plates_followups_test` (already created and migrated): `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_followups_test`. Never use `plates_unit`, `plates_e2e` or `plates_rebundle` (other agents use them).

## Goal
1. **Generic upstream errors.** When a model or provider call fails (transport error, non-2xx from the provider, timeout, unparsable provider response), the client gets a generic message and a request id; the detail (provider text, URLs) is logged server-side under the same request id. The error code and HTTP status stay as they are today.
2. **Test isolation.** Tests that delete or count rows globally become scoped to their own rows, so the whole backend loop passes on a REUSED database and tests cannot delete each other's jobs.
3. **One database guard.** Replace the many copies of the throwaway-database check with one shared test helper.

## Read first
- `backend/src/server.ts` (Fastify creation near line 53, `projectError`, `brandError`), `backend/src/anthropic.ts` (`anthropicMessage`, `includeErrorDetail`; do not change its behaviour, tests assert it), `backend/src/llm.ts`
- The routes that echo `error.message` to clients: `backend/src/plan/routes.ts` (propose about line 1095; beat rewrite about 871; plan audio about 949; script draft about 824; visuals about 257 and 264; SSE `error` events about 326, 497, 534, 753), `backend/src/formats/routes.ts` (about 85), `backend/src/plates/routes.ts` (about 49, 55, 69, 76, 218), `backend/src/site/routes.ts` (about 117), `backend/src/server.ts` (about 73 and 506)
- Existing tests that assert error text: `backend/test/anthropic.mjs`, `backend/test/plan-edit-no-chrome.mjs` (about lines 835-859), `backend/test/plan-edit-meter.mjs` (about line 639)
- For test isolation: `backend/test/job-control.mjs`, `plate-live-render.mjs`, `plate-export-manifest.mjs`, `plate-render-billing.mjs`, `entitlements.mjs`, `billing.mjs`, `events-faults/scenarios.mjs`, and every file with `delete from pgboss.job where name like 'plate-%'` (grep `pgboss.job` in `backend/test`); `plate-live-render.mjs` line ~141 already scopes by `variantId`: copy that pattern
- For the guard: every `DATABASE_URL` check in `backend/test/*.mjs` (grep `DATABASE_URL`), the variants are listed in Part C

## Architecture rules
- Reuse the existing logger (`request.log` / `app.log` with `{ err }`), the existing error-code shapes and the statuses each route uses today; add no dependency; no change to success response shapes, pricing, migrations, `package.json` or lockfiles.
- Request id: Fastify already has `request.id`. Configure `genReqId` in `server.ts` to use the incoming `X-Request-Id` header only when it matches `^[A-Za-z0-9-]{8,64}$`, otherwise a `randomUUID()`; send it back in an `X-Request-Id` response header (a hook), add `X-Request-Id` to CORS `exposedHeaders`, and put it in error bodies as `error.requestId` (additive).
- One small helper for the generic error (for example `backend/src/http-errors.ts`): given `request`, the thrown error and a user message, it logs the full error with `request.log.error({ err, requestId })` and returns the response body `{ error: { code, message: <generic>, requestId } }`. Routes keep their own status and code. SSE `error` events get exactly the same generic message as the JSON responses, plus `requestId`.
- Classify, do not blanket-replace: a known domain/validation error (for example `EditRefusedError`, `InvalidSnapshotsError`, `FetchRefused`, `ProjectInvalid`, validation problems that tell the user what to fix) keeps its message. Only provider/transport failures become generic. When a route cannot tell, treat it as a provider failure (generic) and say so in the report. Do not change `anthropic.ts` message building; sanitise at the route boundary.
- Test helper style: flat `.mjs` files, dynamic `await import("../src/x.ts")` after env is set, `node:` built-ins, `randomUUID` ids, cleanup in `finally`. Copy `backend/test/plan-edit-no-chrome.mjs` and `plan-edit-meter.mjs`.

## Files allowed to change
`backend/src/` (the helper, `server.ts`, and the route files listed above), `backend/test/` (all files, plus new `backend/test/support/`), `docs/followups/`, `tools/followups/`.

## Files forbidden
`backend/src/anthropic.ts` and `llm.ts` message building, `backend/src/db/` migrations, billing/pricing code (`backend/src/tokens`, `billing`), `frontend/`, `worker/`, `packages/`, `infra/`, `.github/`, any `package.json` or lockfile, other worktrees.

## Part A: generic upstream errors (with request id)
1. Add `genReqId`, the `X-Request-Id` response header and the exposed header in `server.ts`.
2. Add the helper and apply it to every route in "Read first" whose catch block sends an exception's message to the client after a provider/transport failure (list each route in the report with: before, after, class provider/domain). SSE routes included. Routes that send intentionally user-facing static or domain messages stay unchanged.
3. Statuses and codes unchanged. The visuals GET that returns status `failed` with a message in a 200 body: keep status, make the message generic if it can carry provider or storage text.
4. Update the existing tests that asserted echoed provider text (`plan-edit-no-chrome.mjs`, `plan-edit-meter.mjs`; `anthropic.mjs` keeps asserting `anthropic.ts` itself, unchanged).
5. New test `backend/test/upstream-errors.mjs` (real Fastify via the project's server builder or per-route registration like the existing tests, stubbed provider, no real network): for each covered route, stub a provider failure whose message contains the canary `https://api.internal.example/v1?key=SECRET123`. Assert: status and code unchanged; response body (and SSE stream text) does not contain `internal.example` or `SECRET123`; body has `error.requestId`; `X-Request-Id` response header equals it; the captured server log contains the canary AND the same request id; a client-sent safe `X-Request-Id` is honoured and an unsafe one (spaces, 200 chars) is replaced.
6. A domain error (for example an edit refusal) still shows its message: one assertion.

## Part B: test isolation
1. Scope every global `delete from pgboss.job where name ...` and `where name like 'plate-%'` in `backend/test/*.mjs` to the test's own rows: `data->>'projectId'` / `'jobId'` / `'variantId'` in the test's random ids (see `plate-live-render.mjs` line ~141). `delete from app.plate_clips` (no WHERE) in `plate-export-manifest.mjs` becomes a delete of only the digests that test inserted (key by the test's own digests; if a test cannot know them, track them as it inserts).
2. Scope the whole-table counts that are asserted: `plate-export-manifest.mjs` (about line 295, `count(*) ... name='plate-render'` asserted 0) by `variantId`/`projectId`; `entitlements.mjs` (about lines 87, 91, 92, 194) by the test's own owner/project (`app.render_jobs` has `owner_id` and `project_id`).
3. `billing.mjs` cleanup (`name like 'test%'`) and the fixed-id fixtures in `billing.mjs`, `tokens.mjs`, `entitlements.mjs`, `render-prep.mjs`, `plate-render-billing.mjs`, `ownership.mjs`, `media.mjs`, `render-ready-email.mjs`, `events-faults/scenarios.mjs`: switch to per-run random ids where it is a small edit, otherwise leave and list in the report why. Do not rewrite tests wholesale. The tests that CI runs (`ownership`, `visuals-db`, `entitlements`, see `.github/workflows/ci.yml`) must keep working against a plain `videosaas` database.
4. Add `backend/test/support/pollution-canary.mjs` exporting `plantCanaries(pool)` and `checkCanaries(pool)`: it inserts a `pgboss.job` row (names `plate-render` and `render-video`, a random `projectId` in `data`) and one `app.plate_clips` row with a random digest, and later asserts all still exist. Write a small runner `backend/test/support/run-loop-twice.sh` (or `.mjs`) that: plants the canaries, runs the full loop (below) twice in a row on the same database, checks the canaries after each pass, and prints the failing files per pass.
5. Behaviour must not change: tests assert the same things as before, only scoped.

## Part C: one shared database guard
1. Create `backend/test/support/throwaway-db.mjs` exporting `assertThrowawayDb(url = process.env.DATABASE_URL)`: parse with `new URL`; require the hostname to be `localhost`, `127.0.0.1` or `[::1]`; require the database name (`pathname.slice(1)`) to contain `test` or start with `plates_`; throw a clear error otherwise (never print the password). It also exports `databaseName(url)`.
2. Unit test `backend/test/throwaway-db.mjs`: accepts `plates_unit`, `plates_rebundle`, `plates_rebundle_wake`, `plates_followups_test`, `my_test_db` on localhost, `127.0.0.1`, `[::1]`; refuses `videosaas`, `postgres`, `app`, a host like `db.prod.example.com` or `localhost.evil.com` or `127.0.0.1.evil.com` even with a good name, a missing URL, a URL with a userinfo trick such as `postgres://test@prod.example.com/videosaas`.
3. Replace the guard copies with the helper in all files that guard today. Variants to replace: (A) `/plates_unit|plates_rebundle|test/` in `plate-live.mjs`, `plate-live-render.mjs`, `plate-live-routes.mjs`, `plate-render-billing.mjs`, `plate-revisions.mjs`, `plate-rollback.mjs`, `plate-export-manifest.mjs`, `plate-store.mjs`, `job-control.mjs`; (B) `/plates_rebundle|plates_unit|test/` in `plate-bundle-immutable.mjs`, `plate-rebundle.mjs`, `plate-rebundle-fence.mjs`, `plate-rebundle-rollback.mjs`, `plate-rebundle-gc.mjs`, `plate-legacy-keys.mjs`; (C) `worker-launcher-rebundle.mjs`; (D) `plan-element-edits.mjs`, `plan-captions-audio-patch.mjs`, `plan-edit-no-chrome.mjs`; (E) `plan-edit-meter.mjs` (keep its live `select current_database()` check in addition, using the helper's name rule). Also add the guard to the tests that write to the database with no check at all and default to or accept any URL: `plate-digest.mjs` (it defaults `DATABASE_URL` to `plates_rebundle`: keep that default, now through the guard), `queue-notify.mjs`, `preview-meter.mjs`, `revision-meter.mjs`, `material-billing.mjs`.
4. **Do NOT apply the guard to the tests that CI runs against the database named `videosaas`** (`ownership.mjs`, `visuals-db.mjs`, `entitlements.mjs`; CI: `.github/workflows/ci.yml` runs them with `postgres://videosaas:videosaas@127.0.0.1:5432/videosaas`), nor to other tests that today only check the URL is present (`billing.mjs`, `tokens.mjs`, `render-ready-email.mjs`, `visuals-db.mjs`): the guard would break CI there. List them in the report as "left, because CI uses `videosaas`" so the owner can decide (a CI database rename).
5. Remove the old per-file regex checks; `backend/src/scripts/rebundle-plates.ts` `enforceLocalSafetyGuard` stays as it is.

## Steps in order
1. Record the baseline: from `backend/`, run the full loop once on `plates_followups_test` before any change and write the failing files in the report (expected: `billing`, `brand-files`, `render-prep`, `styles`, `visuals`; if the baseline differs, say so and use YOUR baseline as the reference).
2. Part C (smallest, mechanical) with its unit test; rerun the touched tests.
3. Part B with the canary runner.
4. Part A with its test.
5. Typecheck and the final proof runs.

## Tests to add and exact commands
Per file (from `backend/`): `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_followups_test PLANNER=deterministic node --experimental-strip-types test/<file>.mjs`.
Full loop (run from `backend/`; take the timing lock first, see Forbidden actions, because `plan-element-edits.mjs` drives Chrome):
```
for f in test/*.mjs; do DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_followups_test PLANNER=deterministic node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```
Also `cd backend && npm run typecheck`. New test files must be added to `backend/package.json` ONLY IF the existing convention requires it: do not edit `package.json`; mention in the report which new tests the manager should register.

## Measurable acceptance criteria
1. The full loop run twice in a row on the same database (no reset in between) shows exactly the same failing files both times, equal to your recorded baseline (expected: the 5 known), and the canary rows planted before pass 1 are intact after pass 2.
2. `upstream-errors.mjs` passes: for every covered route no canary text in the response, same status and code, `requestId` present, detail and id in the log; plus the safe/unsafe `X-Request-Id` cases.
3. `throwaway-db.mjs` unit test passes; `grep -rn "plates_unit|plates_rebundle" backend/test/*.mjs` shows no remaining inline guard regexes (messages and docs excepted); the CI-run tests are untouched.
4. `grep -rnE "delete from pgboss.job where name (in|like)" backend/test/` shows no remaining unscoped deletes (each has a `data->>` scope), and no `delete from app.plate_clips` without a WHERE.
5. Typecheck clean; the pre-existing tests you edited still assert what they asserted before (list them with a one-line reason per change).

## Forbidden actions
- No `git commit`, `push`, `reset`, `stash`, `checkout`, `rebase`, `merge`. The manager commits.
- No deploys, no Railway/Supabase/AWS/Cloudflare calls, no secrets, no real model API calls (stub providers), no other worktrees, no Docker stack, no `opencode run --auto`, no launching other agents. Never touch the Docker containers `videosaas-local-postgres-1` or `videosaas-local-worker-1`. Use only the database `plates_followups_test`.
- Locks: Docker stack not needed. The full loop includes a Chrome test, so before each full-loop run take `/Users/osamaehsaan/Code/Market_apps/.lock-timing` ATOMICALLY: `( set -C; echo "followups-be $(date -u +%FT%TZ)" > /Users/osamaehsaan/Code/Market_apps/.lock-timing )`; if that fails the lock is held, so sleep 60 and retry in the foreground (never leave a background waiter, never check-then-write); delete the file right after the run. Do not hold it while idle. Do not interrupt any OpenCode session that is not yours.

## Report
Write `docs/followups/backend-report.md`: Part A table (route, before, after, class, status/code kept), every test changed and why, Part B list of scoped statements (file:line before and after) and of fixed ids left with reasons, Part C list of files migrated and files deliberately left (CI), the baseline loop and the two proof loops with canary results, anything you could not do, tech debt noticed. End your final message with exactly one line:
`DONE docs/followups/backend-report.md`
