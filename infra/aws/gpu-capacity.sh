#!/usr/bin/env bash
# GPU capacity for painted (oil) films: an ECS capacity provider over an Auto Scaling group of g4dn.xlarge (NVIDIA T4) that scales
# from zero, so nothing runs (or bills) while nobody paints. Idempotent. Needs admin keys in the environment.
#   ENV=staging ./gpu-capacity.sh            (default region ap-southeast-1)
#   ENV=production REGION=us-east-1 ./gpu-capacity.sh
# The EC2 vCPU quota for "Running On-Demand G and VT instances" must be at least 4 in the region (new accounts start at 0).
set -euo pipefail
ENV="${ENV:-staging}"; REGION="${REGION:-ap-southeast-1}"; export AWS_PAGER="" AWS_DEFAULT_REGION="$REGION"
N="greedymotion-$ENV"; TYPE="${GPU_INSTANCE_TYPE:-g4dn.xlarge}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$N-worker" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)"
# Subnets in zones that offer the instance type.
ZONES="$(aws ec2 describe-instance-type-offerings --location-type availability-zone --filters Name=instance-type,Values="$TYPE" --query 'InstanceTypeOfferings[].Location' --output text | tr '\t' ',')"
SUBNETS="$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true --query "Subnets[?contains('$ZONES', AvailabilityZone)].SubnetId" --output text | tr '\t' ',')"
echo "vpc=$VPC sg=$SG subnets=$SUBNETS"

# 1. Instance role: lets the ECS agent on the instance join the cluster and pull the image.
ROLE="$N-gpu-instance"
aws iam get-role --role-name "$ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role
aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1 || { aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null; aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"; sleep 10; }

# 2. Launch template: the ECS GPU-optimised AMI (NVIDIA driver and container runtime included), joined to the cluster.
AMI="$(aws ssm get-parameter --name /aws/service/ecs/optimized-ami/amazon-linux-2023/gpu/recommended/image_id --query Parameter.Value --output text)"
USERDATA="$(printf '#!/bin/bash\ncat >> /etc/ecs/ecs.config <<EOF\nECS_CLUSTER=%s\nECS_ENABLE_GPU_SUPPORT=true\nEOF\n' "$N" | base64 | tr -d '\n')"
LT_DATA="{\"ImageId\":\"$AMI\",\"InstanceType\":\"$TYPE\",\"IamInstanceProfile\":{\"Name\":\"$ROLE\"},\"UserData\":\"$USERDATA\",\"NetworkInterfaces\":[{\"DeviceIndex\":0,\"AssociatePublicIpAddress\":true,\"Groups\":[\"$SG\"]}],\"BlockDeviceMappings\":[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":60,\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}],\"MetadataOptions\":{\"HttpTokens\":\"required\",\"HttpPutResponseHopLimit\":2}}"
if aws ec2 describe-launch-templates --launch-template-names "$N-gpu" >/dev/null 2>&1; then
  aws ec2 create-launch-template-version --launch-template-name "$N-gpu" --launch-template-data "$LT_DATA" --query 'LaunchTemplateVersion.VersionNumber' --output text
  aws ec2 modify-launch-template --launch-template-name "$N-gpu" --default-version '$Latest' >/dev/null
else
  aws ec2 create-launch-template --launch-template-name "$N-gpu" --launch-template-data "$LT_DATA" --query 'LaunchTemplate.LaunchTemplateId' --output text
fi

# 3. Auto Scaling group, min 0 max 1: ECS managed scaling raises it when a GPU task is waiting and lowers it when the instance is idle.
if ! aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$N-gpu" --query 'AutoScalingGroups[0].AutoScalingGroupName' --output text | grep -q "$N-gpu"; then
  aws autoscaling create-auto-scaling-group --auto-scaling-group-name "$N-gpu" --launch-template "LaunchTemplateName=$N-gpu,Version=\$Default" --min-size 0 --max-size "${GPU_MAX:-1}" --desired-capacity 0 --vpc-zone-identifier "$SUBNETS" --new-instances-protected-from-scale-in
fi
ASG_ARN="$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$N-gpu" --query 'AutoScalingGroups[0].AutoScalingGroupARN' --output text)"

# 4. Capacity provider with managed scaling and termination protection, attached to the cluster beside Fargate.
aws ecs describe-capacity-providers --capacity-providers "$N-gpu" --query 'capacityProviders[0].name' --output text 2>/dev/null | grep -q "$N-gpu" || \
  aws ecs create-capacity-provider --name "$N-gpu" --auto-scaling-group-provider "autoScalingGroupArn=$ASG_ARN,managedScaling={status=ENABLED,targetCapacity=100,minimumScalingStepSize=1,maximumScalingStepSize=1},managedTerminationProtection=ENABLED" --query 'capacityProvider.name' --output text
aws ecs put-cluster-capacity-providers --cluster "$N" --capacity-providers FARGATE FARGATE_SPOT "$N-gpu" --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 --query 'cluster.capacityProviders' --output text
echo "gpu capacity ready: capacity provider $N-gpu (instance type $TYPE, max ${GPU_MAX:-1})"
