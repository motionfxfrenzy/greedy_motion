# MVP production release — October 8, 2026

Status: rollout paused pending production-scoped AWS access. Public MVP navigation has not been enabled and no new production Git push has been made.

## Verified and configured

- Remote staging `587d185` is already contained in production `6523818`; their frontend trees match. Both currently use coming-soon navigation. A merge alone will not enable the MVP.
- Production Railway project `lively-presence` (`5298f20e-3531-44a5-a32e-7b99b0cb5b09`), environment `production`, backend service `df6c5746-6c6e-4275-897d-75bb0cd6370b`.
- Added HTTPS API domain: `https://backend-production-1e413.up.railway.app`.
- HTTP checks: `/healthz` 200, `/readyz` 200 with database ready, unauthenticated `/v1/projects` 401, browser CORS preflight 204 for `https://www.greedymotion.com`.
- Set production Vercel project's Production-scoped `NEXT_PUBLIC_API_URL` to that API domain as Config. The pre-existing Preview value remains unchanged. A new frontend build is required for the new Production value to take effect.
- Supabase production `bwwquxhexwyodsavsjar` is ACTIVE_HEALTHY. App projects, brand kits and render jobs have RLS enabled. This is a schema check, not a complete tenant-isolation test.
- Corrected Supabase production Site URL from localhost to `https://www.greedymotion.com`; added explicit callback URLs for www/apex origins, Studio and password reset. Read-back showed no remaining differences for those settings. SMTP, Google provider, MFA, password and other remote settings were preserved.
- Requested Railway production deployment healthcheck `/readyz` to gate traffic on database readiness.
- Existing AWS staging worker is running, desired count 1, task definition `greedymotion-staging-worker:2`, region `ap-southeast-1`.

## Blocker and remaining acceptance checks

The credentials in `infra/aws/.env` identify `greedymotion-staging-worker-deployer`. AWS denied `ecs:DescribeServices` on `greedymotion-production/worker`. Do not widen this staging identity or point production at staging's database/worker. Obtain an explicitly authorized production-scoped AWS profile or credential source. Do not put secrets in this document or Git.

Before promoting the MVP:

1. Verify or deploy production ECS worker with production database and storage credentials; verify healthy task and completed test render.
2. Test real staging sign-in, project creation, planning, upload, render and download; then equivalent production smoke checks with an authorized test account. Do not claim auth email delivery or Google consent-screen readiness without testing them.
3. Verify model availability, R2 read/write, tenant isolation and error handling. Check the worker's committed code matches backend render inputs.
4. Restore sign-in/create-account/Studio navigation and update coming-soon policy wording accurately; keep unimplemented checkout/pricing disabled.
5. Protect `/app` as well as `/studio`; check both signed-out paths.
6. Commit only release-owned changes, promote main → staging, test the deployed staging commit, merge → production, rebuild and verify production assets reference its own API/Supabase project.

The main working tree contains unrelated active backend, editor, contract and template changes. They have not been committed or deployed by this release task.
