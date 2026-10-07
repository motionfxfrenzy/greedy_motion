#!/usr/bin/env python3
"""Fill in your values and write the policy documents you paste into the AWS console. Offline: no AWS calls, no credentials.

  python3 render-policies.py --account 123456789012 --region eu-central-1 --env staging [--with-s3] [--github-repo OWNER/REPO]

Writes infra/aws/out/<env>/ : *.json (ready to paste), and prints each file's size against the 6,144-character managed-policy limit."""
import argparse, json, pathlib, re, sys

p = argparse.ArgumentParser()
p.add_argument("--account", required=True, help="12-digit AWS account id")
p.add_argument("--region", required=True)
p.add_argument("--env", required=True, choices=["staging", "production"])
p.add_argument("--project", default="greedymotion")
p.add_argument("--with-s3", action="store_true", help="also render the S3 policies (only if media lives on S3, not R2)")
p.add_argument("--github-repo", default="", help="OWNER/REPO, only for the optional OIDC trust policy")
a = p.parse_args()
if not re.fullmatch(r"\d{12}", a.account): sys.exit("--account must be 12 digits")
if not re.fullmatch(r"[a-z]{2}(-[a-z]+)+-\d", a.region): sys.exit("--region looks wrong (example: eu-central-1)")

here = pathlib.Path(__file__).parent
out = here / "out" / a.env
out.mkdir(parents=True, exist_ok=True)
sub = {"@ACCOUNT@": a.account, "@REGION@": a.region, "@PROJECT@": a.project, "@ENV@": a.env, "@GITHUB_REPO@": a.github_repo or "OWNER/REPO", "@IMAGE_TAG@": "latest"}
N = f"{a.project}-{a.env}"
# (template, output name, who it is attached to)
plan = [
    ("deployer.json", f"{N}-worker-deployer", "IAM USER (managed policy). Always."),
    ("provisioner.json", f"{N}-worker-provisioner", "IAM USER (managed policy). Only for the one-time setup; detach it afterwards."),
    ("execution-secrets.json", f"{N}-worker-exec-secrets", "ROLE {N}-worker-exec (inline policy). Not the user."),
    ("ecs-trust.json", f"{N}-ecs-trust", "ROLE trust policy for both worker roles. Not the user."),
    ("worker-taskdef.json", f"{N}-worker-taskdef", "ECS task definition JSON (Create new task definition > JSON). Not a policy."),
]
if a.with_s3:
    plan[2:2] = [("provisioner-s3.json", f"{N}-worker-provisioner-s3", "IAM USER (managed policy). Only for the one-time bucket setup; detach afterwards.")]
    plan.append(("worker-task.json", f"{N}-worker-task-s3", "ROLE {N}-worker-task (inline policy). Not the user."))
if a.github_repo:
    plan.append(("github-oidc-trust.json", f"{N}-github-oidc-trust", "Only if you later switch CI to OIDC. Not needed for the IAM user."))

print(f"\nRendered for account {a.account}, {a.region}, {a.env} -> {out}\n")
for tpl, name, use in plan:
    text = (here / "policies" / tpl).read_text()
    for k, v in sub.items(): text = text.replace(k, v)
    json.loads(text)  # must stay valid JSON
    path = out / f"{name}.json"
    path.write_text(text)
    size = len(re.sub(r"\s", "", text))
    flag = "" if size <= 6144 else "  <-- OVER the 6,144 managed-policy limit"
    print(f"  {path.name:52} {size:5} chars   {use.format(N=N)}{flag}")
print("\nNext: open MANUAL_SETUP.md and follow it top to bottom.")
