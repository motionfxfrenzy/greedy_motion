#!/usr/bin/env bash
# One-time AWS setup for the VideoSaaS render worker (ECS Fargate): registry, logs, cluster, roles, optional S3, and the CI identity.
# Run it YOURSELF with your own admin credentials (e.g. `aws sso login`); nothing here is meant to be run by an agent or in CI.
#
#   ./bootstrap.sh --env staging --region eu-central-1 --mode oidc --github-repo OWNER/REPO            # dry run: prints every command
#   ./bootstrap.sh --env staging --region eu-central-1 --mode oidc --github-repo OWNER/REPO --apply    # does it
#   ./bootstrap.sh --env staging --region eu-central-1 --mode user --apply                              # IAM user + access key instead of OIDC
#
# Flags: --env staging|production   --region R   --mode oidc|user   --github-repo OWNER/REPO (oidc)   --with-s3 (create the two buckets
#        and let the worker role use them; skip it if media stays on Cloudflare R2)   --project NAME (default greedymotion)
#        --account-id ID (dry run only: skip the STS lookup)   --apply (default is a dry run)   --yes (skip the account confirmation)
set -euo pipefail

PROJECT=greedymotion ENV="" REGION="" MODE="" GITHUB_REPO="" WITH_S3=0 APPLY=0 YES=0 ACCOUNT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV="$2"; shift 2;; --region) REGION="$2"; shift 2;; --mode) MODE="$2"; shift 2;;
    --github-repo) GITHUB_REPO="$2"; shift 2;; --project) PROJECT="$2"; shift 2;; --account-id) ACCOUNT="$2"; shift 2;;
    --with-s3) WITH_S3=1; shift;; --apply) APPLY=1; shift;; --yes) YES=1; shift;;
    -h|--help) sed -n 2,12p "$0"; exit 0;; *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done
[[ "$ENV" =~ ^(staging|production)$ ]] || { echo "--env must be staging or production" >&2; exit 2; }
[ -n "$REGION" ] || { echo "--region is required" >&2; exit 2; }
[[ "$MODE" =~ ^(oidc|user)$ ]] || { echo "--mode must be oidc or user" >&2; exit 2; }
[ "$MODE" = user ] || [ -n "$GITHUB_REPO" ] || { echo "--github-repo OWNER/REPO is required for --mode oidc" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$APPLY" = 1 ]; then
  command -v aws >/dev/null || { echo "aws CLI not found (https://docs.aws.amazon.com/cli/)" >&2; exit 1; }
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  CALLER="$(aws sts get-caller-identity --query Arn --output text)"
  echo "AWS account ${ACCOUNT} as ${CALLER}"
  case "$CALLER" in *:root) echo "Refusing to run as the account root user. Use an admin IAM/SSO identity." >&2; exit 1;; esac
  if [ "$YES" != 1 ]; then read -r -p "Create the ${ENV} worker stack in account ${ACCOUNT}, region ${REGION}? Type the account id to continue: " a; [ "$a" = "$ACCOUNT" ] || { echo aborted; exit 1; }; fi
else
  ACCOUNT="${ACCOUNT:-111122223333}"
  echo "DRY RUN (account ${ACCOUNT}). Nothing is created. Add --apply to run these commands."
fi

N="${PROJECT}-${ENV}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
render() { sed -e "s/@ACCOUNT@/${ACCOUNT}/g" -e "s/@REGION@/${REGION}/g" -e "s/@PROJECT@/${PROJECT}/g" -e "s/@ENV@/${ENV}/g" -e "s#@GITHUB_REPO@#${GITHUB_REPO}#g" -e "s/@IMAGE_TAG@/latest/g" "$HERE/policies/$1" > "$TMP/$1"; echo "$TMP/$1"; }
run() { echo "+ $*"; if [ "$APPLY" = 1 ]; then "$@"; fi; }
tolerate() { echo "+ $*"; if [ "$APPLY" = 1 ]; then "$@" || echo "  (already exists or not needed, continuing)"; fi; }

echo; echo "== registry, logs, cluster"
tolerate aws ecr create-repository --region "$REGION" --repository-name "${N}-worker" --image-scanning-configuration scanOnPush=true --image-tag-mutability MUTABLE
run aws ecr put-lifecycle-policy --region "$REGION" --repository-name "${N}-worker" --lifecycle-policy-text "file://$(render ecr-lifecycle.json)"
tolerate aws logs create-log-group --region "$REGION" --log-group-name "/ecs/${N}-worker"
run aws logs put-retention-policy --region "$REGION" --log-group-name "/ecs/${N}-worker" --retention-in-days 30
tolerate aws ecs create-cluster --region "$REGION" --cluster-name "${N}"

if [ "$WITH_S3" = 1 ]; then
  echo; echo "== buckets (private, encrypted, uploads expire from incoming/ after 1 day)"
  for kind in uploads outputs; do
    B="${N}-${kind}"
    if [ "$REGION" = us-east-1 ]; then tolerate aws s3api create-bucket --bucket "$B" --region "$REGION"
    else tolerate aws s3api create-bucket --bucket "$B" --region "$REGION" --create-bucket-configuration "LocationConstraint=${REGION}"; fi
    run aws s3api put-public-access-block --bucket "$B" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    run aws s3api put-bucket-encryption --bucket "$B" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  done
  run aws s3api put-bucket-lifecycle-configuration --bucket "${N}-uploads" --lifecycle-configuration '{"Rules":[{"ID":"expire-incoming","Status":"Enabled","Filter":{"Prefix":"incoming/"},"Expiration":{"Days":1},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
fi

echo; echo "== runtime roles (the worker never uses access keys; it assumes these)"
tolerate aws iam create-role --role-name "${N}-worker-exec" --assume-role-policy-document "file://$(render ecs-trust.json)"
run aws iam attach-role-policy --role-name "${N}-worker-exec" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
run aws iam put-role-policy --role-name "${N}-worker-exec" --policy-name inject-worker-secrets --policy-document "file://$(render execution-secrets.json)"
tolerate aws iam create-role --role-name "${N}-worker-task" --assume-role-policy-document "file://$(render ecs-trust.json)"
if [ "$WITH_S3" = 1 ]; then run aws iam put-role-policy --role-name "${N}-worker-task" --policy-name worker-s3 --policy-document "file://$(render worker-task.json)"; fi

echo; echo "== CI identity that may push the worker image and roll the service (nothing else)"
if [ "$MODE" = oidc ]; then
  tolerate aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
  tolerate aws iam create-role --role-name "${N}-deployer" --assume-role-policy-document "file://$(render github-oidc-trust.json)" --max-session-duration 3600
  run aws iam put-role-policy --role-name "${N}-deployer" --policy-name deploy-worker --policy-document "file://$(render deployer.json)"
  echo "  -> GitHub Actions assumes arn:aws:iam::${ACCOUNT}:role/${N}-deployer (only from ${GITHUB_REPO} branch ${ENV}); no keys are stored anywhere."
else
  tolerate aws iam create-user --user-name "${N}-deployer"
  run aws iam put-user-policy --user-name "${N}-deployer" --policy-name deploy-worker --policy-document "file://$(render deployer.json)"
  KEYFILE="${HERE}/.${N}-deployer-access-key.json"
  echo "+ aws iam create-access-key --user-name ${N}-deployer  > ${KEYFILE} (mode 600; never printed here)"
  if [ "$APPLY" = 1 ]; then
    ( umask 077; aws iam create-access-key --user-name "${N}-deployer" > "$KEYFILE" )
    echo "  -> Access key saved to ${KEYFILE}. Put AccessKeyId/SecretAccessKey into the GitHub ${ENV} environment secrets, then DELETE this file."
    echo "     Rotate the key every 90 days; this user has no console access and can only deploy the ${N} worker."
  fi
fi

echo; echo "== next (manual, needs your VPC choices; see infra/aws/README.md)"
echo "  1. Put the Postgres URL in Secrets Manager: ${PROJECT}/${ENV}/worker/database-url   (the worker DB role from DB-03, not the backend's)"
echo "  2. Register the task definition (policies/worker-taskdef.json) and create the ECS service '${N}'/worker in public subnets with a public IP (no NAT)"
echo "  3. Build + push worker/Dockerfile to ${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${N}-worker and run the deploy workflow"
[ "$APPLY" = 1 ] || echo "(dry run: nothing was created)"
