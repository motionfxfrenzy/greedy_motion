#!/bin/sh
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
L=/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/d53433c7-7040-4d6c-a8cf-32c530e254ab/scratchpad/verify-p5
mkdir -p $L; : > $L/status.txt
LIVE="-f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e"
CLIP="-f compose.yaml --profile plates-e2e"
docker compose $LIVE up -d --build plate-api plate-worker > $L/up1.log 2>&1; echo "up-live exit $?" >> $L/status.txt
sleep 10
node tools/phase2/e2e/live-e2e.mjs > $L/live-e2e.log 2>&1; echo "live-e2e exit $?" >> $L/status.txt
node tools/phase2/job-control/chaos.mjs > $L/chaos.log 2>&1; echo "chaos exit $?" >> $L/status.txt
docker compose $LIVE down plate-worker plate-api llm-stub objectstore > $L/down1.log 2>&1
docker compose $CLIP up -d plate-api plate-worker > $L/up2.log 2>&1; echo "up-clip exit $?" >> $L/status.txt
sleep 10
node scripts/plates-e2e/run.mjs failures cache > $L/clip.log 2>&1; echo "clip-mode failures+cache exit $?" >> $L/status.txt
docker compose $CLIP down plate-worker plate-api llm-stub objectstore > $L/down2.log 2>&1
echo FINISHED >> $L/status.txt
