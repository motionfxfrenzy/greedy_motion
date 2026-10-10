#!/usr/bin/env bash
# Deploy the real render worker (R2 storage, Supabase queue) to ECS Fargate.
#   ./deploy-worker.sh secrets   create/update the worker's Secrets Manager entries (needs the provisioner policy attached)
#   ./deploy-worker.sh up        build + push the image, register the real task definition, roll the service to 1 task
#   ./deploy-worker.sh ondemand  build + push + register, then scale the always-on service to 0: the backend
#                                (WORKER_LAUNCH=ecs) starts tasks per render and they exit when idle
#   ./deploy-worker.sh logs|stop
# Reads infra/aws/.env (AWS deployer keys) and the repo-root .env.credentials (gitignored).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; . ../../.env.credentials; set +a
export AWS_PAGER=""
PROJECT=greedymotion ENV=staging REGION=ap-southeast-1
N="$PROJECT-$ENV"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REG="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
OUT="out/$ENV"; mkdir -p "$OUT"
secret() { # name value
  if aws secretsmanager describe-secret --region "$REGION" --secret-id "$1" >/dev/null 2>&1; then aws secretsmanager put-secret-value --region "$REGION" --secret-id "$1" --secret-string "$2" >/dev/null
  else aws secretsmanager create-secret --region "$REGION" --name "$1" --secret-string "$2" >/dev/null; fi; echo "  $1"
}
case "${1:-up}" in
  secrets)
    secret "$PROJECT/$ENV/worker/database-url" "$SUPABASE_STAGING_DATABASE_URL"
    secret "$PROJECT/$ENV/worker/r2-access-key-id" "$R2_STAGING_ACCESS_KEY_ID"
    secret "$PROJECT/$ENV/worker/r2-secret-access-key" "$R2_STAGING_SECRET_ACCESS_KEY" ;;
  logs) aws logs filter-log-events --region "$REGION" --log-group-name "/ecs/$N-worker" --limit 60 --query 'events[].message' --output text | tr '\t' '\n' | tail -40 ;;
  stop) aws ecs update-service --region "$REGION" --cluster "$N" --service worker --desired-count 0 --query 'service.[serviceName,desiredCount]' --output text ;;
  up|ondemand)
    MODE="$1"
    TAG="$(git rev-parse --short HEAD)-$(date +%H%M%S)"; IMAGE="$REG/$N-worker:$TAG"
    aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REG" >/dev/null
    trap 'docker logout "$REG" >/dev/null 2>&1 || true' EXIT
    docker build --platform linux/arm64 -f ../../worker/Dockerfile -t "$IMAGE" ../.. 2>&1 | tail -3
    docker push "$IMAGE" 2>&1 | tail -1
    sed -e "s#@ACCOUNT@#$ACCOUNT#g" -e "s#@REGION@#$REGION#g" -e "s#@PROJECT@#$PROJECT#g" -e "s#@ENV@#$ENV#g" -e "s#@IMAGE_TAG@#$TAG#g" -e "s#@R2_ENDPOINT@#$R2_ENDPOINT#g" policies/worker-taskdef.json > "$OUT/taskdef.json"
    TD="$(aws ecs register-task-definition --region "$REGION" --cli-input-json "file://$OUT/taskdef.json" --query taskDefinition.taskDefinitionArn --output text)"; echo "$TD"
    if [ "$MODE" = ondemand ]; then
      # Nothing stays running: the backend's RunTask uses the family's latest revision, registered above.
      aws ecs update-service --region "$REGION" --cluster "$N" --service worker --desired-count 0 --query 'service.[serviceName,desiredCount]' --output text 2>/dev/null || echo "  (no always-on service to scale down)"
      aws ecs put-cluster-capacity-providers --region "$REGION" --cluster "$N" --capacity-providers FARGATE FARGATE_SPOT --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 --query 'cluster.capacityProviders' --output text \
        || echo "  could not enable FARGATE_SPOT (one-time; needs the provisioner policy). Until then set ECS_USE_SPOT=0 on the backend."
      exit 0
    fi
    aws ecs update-service --region "$REGION" --cluster "$N" --service worker --task-definition "$TD" --desired-count 1 --force-new-deployment --query service.[serviceName,desiredCount] --output text
    for i in $(seq 1 30); do
      T="$(aws ecs list-tasks --region "$REGION" --cluster "$N" --service-name worker --query 'taskArns[0]' --output text)"
      [ "$T" = None ] || { S="$(aws ecs describe-tasks --region "$REGION" --cluster "$N" --tasks "$T" --query 'tasks[0].[taskDefinitionArn,lastStatus]' --output text)"; echo "  $S"; case "$S" in "$TD"*RUNNING) break;; esac; }
      sleep 10
    done; sleep 20; "$0" logs ;;
  *) echo "usage: $0 secrets|up|ondemand|logs|stop" >&2; exit 2 ;;
esac
