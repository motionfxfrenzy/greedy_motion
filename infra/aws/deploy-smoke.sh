#!/usr/bin/env bash
# Smoke test of the AWS worker infrastructure (no database needed).
#   ./deploy-smoke.sh up     create/refresh the stack, build + push the worker image, run the worker self-test on Fargate, show the logs
#   ./deploy-smoke.sh logs   show the latest worker logs
#   ./deploy-smoke.sh stop   scale the service to 0 (stops the Fargate bill; everything else stays)
# Uses the deployer user's keys from infra/aws/.env (gitignored). Needs: aws CLI, docker, python3.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
export AWS_PAGER=""
PROJECT=greedymotion ENV=staging REGION=ap-southeast-1
N="$PROJECT-$ENV"
say() { printf '\n== %s\n' "$*"; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REG="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

logs() { aws logs filter-log-events --region "$REGION" --log-group-name "/ecs/$N-worker" --limit 80 --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | tail -40 || true; }
stop() { aws ecs update-service --region "$REGION" --cluster "$N" --service worker --desired-count 0 --query 'service.[serviceName,desiredCount]' --output text; }
case "${1:-up}" in logs) logs; exit 0;; stop) stop; exit 0;; up) ;; *) echo "usage: $0 up|logs|stop" >&2; exit 2;; esac

python3 render-policies.py --account "$ACCOUNT" --region "$REGION" --env "$ENV" --project "$PROJECT" >/dev/null
OUT="out/$ENV"

say "registry"
aws ecr describe-repositories --region "$REGION" --repository-names "$N-worker" >/dev/null 2>&1 \
  || aws ecr create-repository --region "$REGION" --repository-name "$N-worker" --image-scanning-configuration scanOnPush=true --query repository.repositoryUri --output text
aws ecr put-lifecycle-policy --region "$REGION" --repository-name "$N-worker" --lifecycle-policy-text "file://policies/ecr-lifecycle.json" >/dev/null

say "log group, cluster"
[ -n "$(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "/ecs/$N-worker" --query 'logGroups[].logGroupName' --output text)" ] \
  || aws logs create-log-group --region "$REGION" --log-group-name "/ecs/$N-worker"
aws logs put-retention-policy --region "$REGION" --log-group-name "/ecs/$N-worker" --retention-in-days 30
[ -n "$(aws ecs describe-clusters --region "$REGION" --clusters "$N" --query "clusters[?status=='ACTIVE'].clusterName" --output text)" ] \
  || aws ecs create-cluster --region "$REGION" --cluster-name "$N" --query cluster.clusterArn --output text

say "roles"
NEW_ROLE=0
for r in exec task; do
  aws iam get-role --role-name "$N-worker-$r" >/dev/null 2>&1 || { aws iam create-role --role-name "$N-worker-$r" --assume-role-policy-document "file://$OUT/$N-ecs-trust.json" --query Role.Arn --output text; NEW_ROLE=1; }
done
aws iam attach-role-policy --role-name "$N-worker-exec" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name "$N-worker-exec" --policy-name inject-worker-secrets --policy-document "file://$OUT/$N-worker-exec-secrets.json"
[ "$NEW_ROLE" = 1 ] && { echo "waiting for IAM to propagate the new roles"; sleep 20; }

say "network (default VPC, public subnets, security group with no inbound rules)"
VPC="$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG="$(aws ec2 describe-security-groups --region "$REGION" --filters "Name=group-name,Values=$N-worker" "Name=vpc-id,Values=$VPC" --query 'SecurityGroups[0].GroupId' --output text)"
[ "$SG" != None ] || SG="$(aws ec2 create-security-group --region "$REGION" --group-name "$N-worker" --description "$N worker: outbound only" --vpc-id "$VPC" --query GroupId --output text)"
SUBNETS="$(aws ec2 describe-subnets --region "$REGION" --filters "Name=vpc-id,Values=$VPC" Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
echo "vpc $VPC  sg $SG  subnets $SUBNETS"

say "build the worker image (linux/arm64) and push it"
TAG="smoke-$(date +%Y%m%d%H%M%S)"; IMAGE="$REG/$N-worker:$TAG"
trap 'docker logout "$REG" >/dev/null 2>&1 || true' EXIT
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REG" >/dev/null
docker build --platform linux/arm64 -f ../../worker/Dockerfile -t "$IMAGE" ../.. 2>&1 | tail -5
docker push "$IMAGE" 2>&1 | tail -2

say "task definition + service"
sed -e "s#@ACCOUNT@#$ACCOUNT#g" -e "s#@REGION@#$REGION#g" -e "s#@PROJECT@#$PROJECT#g" -e "s#@ENV@#$ENV#g" -e "s#:@IMAGE_TAG@#:$TAG#g" policies/worker-taskdef-smoke.json > "$OUT/taskdef-smoke.json"
TD="$(aws ecs register-task-definition --region "$REGION" --cli-input-json "file://$OUT/taskdef-smoke.json" --query taskDefinition.taskDefinitionArn --output text)"
echo "$TD"
if [ "$(aws ecs describe-services --region "$REGION" --cluster "$N" --services worker --query "services[?status=='ACTIVE'].serviceName" --output text)" = worker ]; then
  aws ecs update-service --region "$REGION" --cluster "$N" --service worker --task-definition "$TD" --desired-count 1 --force-new-deployment --query service.serviceArn --output text
else
  aws ecs create-service --region "$REGION" --cluster "$N" --service-name worker --task-definition "$TD" --desired-count 1 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" --query service.serviceArn --output text
fi

say "waiting for the task (up to 6 min)"
for i in $(seq 1 36); do
  T="$(aws ecs list-tasks --region "$REGION" --cluster "$N" --service-name worker --query 'taskArns[0]' --output text)"
  if [ "$T" != None ]; then
    S="$(aws ecs describe-tasks --region "$REGION" --cluster "$N" --tasks "$T" --query 'tasks[0].[lastStatus,stoppedReason]' --output text)"; echo "  $S"
    case "$S" in RUNNING*) break;; STOPPED*) break;; esac
  else echo "  (no task yet)"; fi
  sleep 10
done
say "worker logs (the self-test result shows up after ~30-90 s)"
sleep 45; logs
echo; echo "Stop the Fargate bill with: ./deploy-smoke.sh stop   |  more logs: ./deploy-smoke.sh logs"
