# AWS: render worker on ECS Fargate

**Creating the IAM user in the console by hand? Go straight to [MANUAL_SETUP.md](MANUAL_SETUP.md)** (policy files generated offline with `render-policies.py`; no CLI needed). The rest of this page is the reasoning and the optional `bootstrap.sh` automation.

Status: ready to run, nothing created yet. The scripts here are meant to be run **by you** with your own admin credentials (`aws sso login` or an admin IAM user). Never paste access keys into chat, issues, or committed files.

## Decision: where does each service run?

| Service | Recommendation | Why |
|---|---|---|
| **worker** | **AWS ECS Fargate** (your call) | Chromium + FFmpeg renders are CPU/RAM hungry and bursty. Fargate gives per-task sizing, scale-out by queue depth, and no servers to patch. |
| **backend** | **Railway** (keep the existing plan) | See below. |
| frontend | Vercel (unchanged) | |
| Postgres + auth | Supabase (unchanged) | The backend and the worker only talk through Postgres (pg-boss); there is no HTTP between them, so they can live in different clouds. |
| media | R2 (planned) or S3 | See "Media" below. |

### Backend on Railway or AWS?

**Railway, for now.** The backend is a small stateless Node API that does I/O (Postgres, Claude/Gemini calls, presigned URLs). It is not where the cost or the risk is, so the cheapest thing is the one that costs you the least attention:

- Already planned and documented (`docs/ENVIRONMENTS.md`, `.railway/railway.ts`): branch-per-environment auto-deploys, pre-deploy migrations, draining on redeploy, variables per environment. Nothing to build.
- On AWS the same API needs an ALB (~$16+/month per environment), TLS certificates, a VPC, target groups, a deploy pipeline and autoscaling rules. That is real ongoing work for a service with no special requirements, and a NAT gateway (~$32/month per AZ) if you put it in private subnets.
- A split is cheap: backend ↔ worker traffic is database rows and queue messages. Put the Supabase project and the AWS worker in the **same region** so worker DB round-trips stay fast; backend latency to Supabase is not critical.
- Moving the backend to AWS later is easy because it is a container with environment variables. Do it only when you hit one of these triggers: a compliance or data-residency rule that needs one provider; private-network access to AWS-only resources (RDS, internal services); a company-wide AWS contract or credits; or Railway cost/limits becoming a problem at scale. Then use ECS Fargate (or App Runner for the simplest option) with the same IAM pattern as below.

**Costs to keep in mind for the split:** AWS charges for data leaving AWS (about $0.09/GB). Rendered MP4s leaving the worker for R2 are small (20-50 MB), so 1,000 films a month is a few dollars; do not worry until volume is large. If you serve finished videos to users from S3 instead of R2 you pay S3/CloudFront egress, which R2 does not charge.

### Media: R2 or S3?

If the worker is on AWS, S3 in the worker's region is free for the worker to read and write and needs no extra credentials (the task role). R2 keeps zero egress fees when users download videos and is already in the plan. Either works with the same S3-compatible code (MEDIA-02). Use `--with-s3` in the bootstrap script if you choose S3; skip it if media stays on R2 (then the AWS identities below only need ECR/ECS, and the R2 token goes into Secrets Manager).

## Prerequisites that block a hosted worker (not IAM, but you will hit them)

1. **MEDIA-02 (storage adapter).** Today the worker writes `var/renders/*.mp4` and reads `/brands`, `/audio`, `/projects` from folders shared with the backend. On AWS the worker has no shared disk, so it must read inputs from and write outputs to object storage. This is the real blocker; the IAM below does not fix it.
2. **DB-03.** Create the least-privilege `videosaas_worker` database role before giving the worker a hosted `DATABASE_URL` (it currently uses the backend's user).
3. **Networking.** Run the Fargate tasks in public subnets with a public IP (no NAT gateway, saving ~$32/month per AZ) and a security group with **no inbound rules**; the worker only makes outbound connections (Supabase session pooler, storage). The health check runs inside the container.

## IAM options

Three identities are involved; only the first one is a choice.

| | Identity | Used by | Notes |
|---|---|---|---|
| **1. CI deployer** (choose A, B or C) | pushes the worker image to ECR and rolls the ECS service | GitHub Actions | the "IAM user" you asked about |
| 2. Task role `greedymotion-<env>-worker-task` | the running worker's permissions (S3 only, if used) | the container | assumed by ECS; **no access keys exist** |
| 3. Execution role `greedymotion-<env>-worker-exec` | pulls the image, writes logs, injects `DATABASE_URL` from Secrets Manager at start | ECS agent | managed policy + one inline secrets statement |

### CI deployer: pick one

| | Option | Long-lived keys? | Effort | Verdict |
|---|---|---|---|---|
| **A** | **GitHub OIDC role** `greedymotion-<env>-deployer` (`--mode oidc`) | **No** (short-lived tokens per run) | low | **Recommended.** Nothing to leak or rotate. Trust is limited to your repo and the branch named after the environment (`staging` / `production`), matching the promotion flow. |
| **B** | **IAM user** `greedymotion-<env>-deployer` with an access key (`--mode user`) | Yes (rotate every 90 days) | low | What you asked for literally. Fine if you cannot use OIDC. No console access; same least-privilege policy. The key goes into GitHub *environment* secrets, then delete the local file. |
| **C** | A broad/admin user for everything | Yes | none | **Not recommended.** Acceptable only as a throw-away for the first manual setup (and only an IAM/SSO admin, never the root user); delete it afterwards. |

Least privilege in `policies/deployer.json`: push/pull on the single worker ECR repository, register task definitions, update only the `worker` service in only this environment's cluster, `iam:PassRole` for only the two worker roles (and only to `ecs-tasks.amazonaws.com`), read the worker's log group. It cannot touch S3, secrets, databases, other environments, or create/modify IAM.

Staging and production get separate identities, repositories, clusters and buckets (names end in `-staging-` / `-production-`), like `docs/ENVIRONMENTS.md` requires.

## Steps

```bash
cd infra/aws
# 1. dry run: prints every command, creates nothing
./bootstrap.sh --env staging --region eu-central-1 --mode oidc --github-repo OWNER/REPO [--with-s3]
# 2. same command plus --apply once you have read it (needs the aws CLI and admin credentials; refuses the root user and asks you to confirm the account id)
./bootstrap.sh --env staging --region eu-central-1 --mode oidc --github-repo OWNER/REPO --apply
```
It creates: ECR repo (scan on push, keep last 25 images), CloudWatch log group (30 days), ECS cluster, the two worker roles, optionally the two private encrypted S3 buckets, and the deployer (OIDC role or IAM user). Then, by hand (they depend on your VPC):

1. Secrets Manager: create `greedymotion/<env>/worker/database-url` with the worker role's Postgres URL (session pooler).
2. Register the task definition from `policies/worker-taskdef.json` (2 vCPU / 4 GB, `RENDER_CONCURRENCY=2`, `stopTimeout 30` to match `DRAIN_SECONDS`), then create the service `greedymotion-<env>/worker` (Fargate, public subnets, public IP, no inbound rules, desired count 1, rolling deploy with minimum healthy 100%).
3. GitHub: environment `staging`/`production` with the variable `AWS_ROLE_ARN` (OIDC) or the two key secrets (user). Deploy step, sketched:
```yaml
permissions: { id-token: write, contents: read }
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with: { role-to-assume: ${{ vars.AWS_ROLE_ARN }}, aws-region: eu-central-1 }
  - uses: aws-actions/amazon-ecr-login@v2
  - run: docker build -f worker/Dockerfile -t $REGISTRY/greedymotion-staging-worker:$GITHUB_SHA . && docker push $REGISTRY/greedymotion-staging-worker:$GITHUB_SHA
  - run: aws ecs describe-task-definition --task-definition greedymotion-staging-worker --query taskDefinition > td.json   # edit image to the new tag, register, then:
  - run: aws ecs update-service --cluster greedymotion-staging --service worker --task-definition greedymotion-staging-worker --force-new-deployment
```
4. Scale: start with 1 task, then add Application Auto Scaling on a custom metric for the pg-boss queue depth (a small scheduled job that publishes it), min 1, max set by the Supabase connection budget (each replica uses about 8 connections).

## Security checklist

- Run the bootstrap with your own SSO/admin identity; never as root; delete any temporary admin keys afterwards.
- The worker uses the task role, never access keys. Only the CI deployer (option B) has a key, in GitHub environment secrets, rotated every 90 days.
- Secrets live in Secrets Manager and are injected by ECS; nothing secret in the task definition or the image.
- Buckets are private with public access blocked and encryption on; the worker role has no delete permission (the backend owns retention).
- Turn on CloudTrail and a billing alarm before the first deploy.
- Review `policies/*.json` yourself before `--apply`; they are plain files with `@PLACEHOLDERS@` replaced at run time.

## Files

`bootstrap.sh` (dry run by default) · `policies/deployer.json` · `policies/worker-task.json` · `policies/execution-secrets.json` · `policies/ecs-trust.json` · `policies/github-oidc-trust.json` · `policies/ecr-lifecycle.json` · `policies/worker-taskdef.json`
