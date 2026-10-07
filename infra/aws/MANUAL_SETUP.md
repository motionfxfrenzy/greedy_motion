# Create the IAM user by hand (AWS console, no CLI)

You create the IAM user and the policies yourself in the console. Nothing here calls AWS or needs credentials, and nothing should ever be pasted into chat or committed: the access key goes straight into GitHub secrets.

## 0. Pick three values

| Value | Example | Notes |
|---|---|---|
| Account id | `123456789012` | top-right menu in the console; 12 digits |
| Region | `eu-central-1` | same region as your Supabase project, so worker database calls are fast |
| Environment | `staging` | do staging first; production gets its own user, repo, cluster and secrets (repeat everything with `--env production`) |

## 1. Generate the policy files (offline, on your machine)

```bash
cd infra/aws
python3 render-policies.py --account <ACCOUNT_ID> --region <REGION> --env staging            # media stays on R2
python3 render-policies.py --account <ACCOUNT_ID> --region <REGION> --env staging --with-s3  # media on S3 instead
```
This writes `infra/aws/out/staging/*.json` with your values filled in and prints the size of each (the console limit is 6,144 characters; ours are 0.2-3.1k). Open each file and read it before you paste it: they are short and plain.

## 2. What goes where (read this once)

| File in `out/staging/` | Attach / paste it | When |
|---|---|---|
| `…-worker-deployer.json` | **the IAM user** (as a customer managed policy) | always: it is the CI identity |
| `…-worker-provisioner.json` | **the IAM user** (managed policy) | only while creating the worker's resources (step 5), **then detach it** |
| `…-worker-provisioner-s3.json` | **the IAM user** (managed policy) | only with `--with-s3`, only for setup, then detach |
| `…-ecs-trust.json` | **trust policy of the two roles** | step 4 |
| `…-worker-exec-secrets.json` | **inline policy on the exec role** | step 4 |
| `…-worker-task-s3.json` | **inline policy on the task role** | only with `--with-s3` |
| `…-worker-taskdef.json` | ECS task definition (JSON) | step 5 |

The two *roles* are not the user. They are what the running worker uses (ECS hands out temporary credentials), so the worker never has access keys.

## 3. Create the policies and the user

1. **IAM → Policies → Create policy → JSON tab.** Paste `…-worker-deployer.json`, Next, name it exactly `greedymotion-staging-worker-deployer`, Create. Repeat for `…-worker-provisioner` (and `…-provisioner-s3` if used), using the same name as the file.
2. **IAM → Users → Create user.** Name `greedymotion-staging-worker-deployer`. Leave **"Provide user access to the AWS Management Console" unchecked** (it is a machine user).
3. Next → **Attach policies directly** → tick the policies you created (deployer + provisioner [+ s3]) → Create user. Do not attach `AdministratorAccess` or any AWS-managed policy.
4. Open the user → **Security credentials → Create access key → "Application running outside AWS"**. Copy the Access key id and Secret access key **directly into GitHub** (Settings → Environments → `staging` → secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`); do not keep a downloaded .csv. Add environment variables `AWS_REGION`, `ECR_REPOSITORY=greedymotion-staging-worker`, `ECS_CLUSTER=greedymotion-staging`, `ECS_SERVICE=worker`.

## 4. Create the two worker roles (once)

**IAM → Roles → Create role → Custom trust policy**, paste `…-ecs-trust.json`.

- Role `greedymotion-staging-worker-exec`: attach the AWS managed policy `AmazonECSTaskExecutionRolePolicy`; then Add permissions → Create inline policy → JSON → paste `…-worker-exec-secrets.json`.
- Role `greedymotion-staging-worker-task`: no managed policy. With S3 only: inline policy → paste `…-worker-task-s3.json`.

Names must match exactly; the user's policies are written against them. (You can do this step as your own admin in the console, or let the provisioner user do it; the provisioner policy only allows exactly these two role names.)

## 5. Create the rest (with the user's keys, or in the console as admin)

Names must match the table.

| Resource | Name | Notes |
|---|---|---|
| ECR repository | `greedymotion-staging-worker` | private, scan on push on |
| CloudWatch log group | `/ecs/greedymotion-staging-worker` | retention 30 days |
| ECS cluster | `greedymotion-staging` | Fargate |
| Secret | `greedymotion/staging/worker/database-url` | the Postgres URL for the worker's own database role (DB-03), Supabase session pooler |
| Security group | any name | in the VPC, **no inbound rules**, default outbound |
| S3 buckets (only `--with-s3`) | `greedymotion-staging-uploads`, `greedymotion-staging-outputs` | block all public access, default encryption on |
| Task definition | `greedymotion-staging-worker` | paste `…-worker-taskdef.json` (JSON tab); push an image first (below) or the service cannot start |
| ECS service | `worker` in cluster `greedymotion-staging` | Fargate, desired 1, subnets **public** with **auto-assign public IP on** (avoids a ~$32/month NAT gateway), the security group above |

First image push (once): ECR → your repository → **View push commands**, run them from the repo root with `-f worker/Dockerfile`; after that CI does it.

## 6. Lock it down

After step 5 works: **IAM → Users → the user → Permissions → detach `…-provisioner` (and `…-provisioner-s3`)**. The user is left with only `…-worker-deployer` (push the worker image, roll the `worker` service, read its logs). Re-attach the provisioner only when you need to change the infrastructure, then detach again.

## 7. Check it did what you intended

- With the user's keys: `aws ecr get-login-password --region <REGION>` works; `aws s3 ls` and `aws iam list-users` are denied.
- The ECS service shows 1 running task, logs appear in `/ecs/greedymotion-staging-worker`, the container health check is green.
- The worker cannot start jobs until MEDIA-02 (storage adapter) and DB-03 (worker database role) are done; see README.md.

## CI deploy step with these keys (sketch)

```yaml
environment: staging
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with: { aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}, aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}, aws-region: ${{ vars.AWS_REGION }} }
  - uses: aws-actions/amazon-ecr-login@v2
    id: ecr
  - run: |
      IMAGE=${{ steps.ecr.outputs.registry }}/${{ vars.ECR_REPOSITORY }}:${{ github.sha }}
      docker build -f worker/Dockerfile -t $IMAGE . && docker push $IMAGE
      aws ecs describe-task-definition --task-definition greedymotion-staging-worker --query taskDefinition > td.json
      # set containerDefinitions[0].image to $IMAGE, drop read-only fields, then:
      aws ecs register-task-definition --cli-input-json file://td-new.json
      aws ecs update-service --cluster ${{ vars.ECS_CLUSTER }} --service ${{ vars.ECS_SERVICE }} --task-definition greedymotion-staging-worker
```

## Security notes

- Rotate the access key every 90 days (create a second key, update GitHub, delete the old one).
- The provisioner policy can write inline policies onto the two worker roles, so keep it attached only during setup.
- Turn on CloudTrail and a billing alarm before the first deploy; never create keys for the root user.
