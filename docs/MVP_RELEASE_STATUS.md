# MVP production release — October 8, 2026

Status: live at https://www.greedymotion.com. Staging was merged into production and the public MVP entry points are enabled.

## Release and deployments

- Release change: `d141278` (sign-in, signup and Studio navigation; protect `/app` and `/studio`; MVP availability and AWS processing disclosures).
- Main integration: `d4fa781`. Concurrent creative-library and CI work on main was preserved; it was not included in this staging promotion.
- Tested staging: `6bdfad6`; production merge: `c71ef789fd5278d484f8454254f44d7b5f92c211`.
- Vercel production: `dpl_F8HMM1RAxxsASdnqAAo7K6z2jGer`, Ready, with www and apex production domains assigned.
- Railway production backend: `a0513050-c7c3-4c23-b504-1a458974e23a`, SUCCESS, running production commit `c71ef78`.
- API: https://backend-production-1e413.up.railway.app.
- AWS region: `ap-southeast-1`; cluster `greedymotion-production`; service `worker`; task definition `greedymotion-production-worker:1`. One RUNNING, HEALTHY task; deployment COMPLETED.
- Worker image: `369904858685.dkr.ecr.ap-southeast-1.amazonaws.com/greedymotion-production-worker:587d185`, digest `sha256:9a032f013f1274fd3c445fe7ef09539b7e053fa21d8c44a9e4567f0d57c93126`. Built from committed staging; worker code is unchanged in the promoted release.

## Infrastructure completed

- Created production ECR repository, ECS cluster/service, worker task/execution roles, CloudWatch log group (30-day retention), security group with no inbound rules, and production database/R2 Secrets Manager entries.
- Enabled ECS deployment circuit breaker with rollback.
- Fixed production Railway `/data` ownership to `node:node` (1000:1000). Before this fix, screenshot uploads failed with EACCES; afterward, upload and render passed.
- Verified production backend variables, production frontend API/Supabase bundle values, and production Supabase callback configuration. Credentials remain outside Git.
- Railway API read-back reports `/readyz` with a 120-second timeout. Deployment metadata still reports a null healthcheck path, so platform gating is not claimed as verified. Live `/readyz` and `/healthz` checks both pass.

## Verification completed

- Locked dependency install, TypeScript checks across workspaces, optimized Next.js production build, and diff whitespace checks.
- Public landing/auth/policy pages return 200; public MVP navigation appears on the deployed site.
- Signed-out `/app` and `/studio` redirect to authentication; both return 200 with a valid production session cookie.
- Deployed auth and Studio bundles reference production Supabase and API, without staging endpoints.
- API readiness/liveness return 200, unauthenticated project requests return 401, and production browser CORS preflight returns 204 with the correct origin.
- In both staging and production: temporary users signed in with passwords, created projects, uploaded screenshots, generated real AI plans, queued renders, and downloaded completed MP4s. Cross-user project reads, writes, listing and render requests were checked for isolation.
- Staging render `98a82cf8-6377-4681-8466-287ec00b8907`: 7,087,076 bytes. Production render `303bd83a-130c-4354-ae37-28f0033b9bad`: 7,183,362 bytes. ffprobe verified both as 1920×1080 H.264, 15.033 seconds.
- Removed all six temporary release test accounts and their project/render database records. Render samples remain in the private local release artifact directory; remote smoke media may remain for normal retention.

## Practical limits

- Render smoke tests used audio mode `none`; voice/music generation was not exercised.
- Test accounts were administratively confirmed; signup email delivery, password-reset delivery and Google consent/login were not exercised.
- Checkout remains disabled. The backend remains at one replica because non-output media uses its persistent volume.
- These checks verify the exercised flows at release time; they are not a load test or an uptime guarantee.

## Rollback references

Previous production Git commit: `65238189be586d222e075299a2ceb147e5639bef`. Previous Railway deployment: `08272df8-8859-4e17-a511-29eee2973f15`. Roll back frontend/backend deployments if required; do not reverse database migrations. No schema migrations were added by this release.
