#!/bin/sh
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
L=/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/d53433c7-7040-4d6c-a8cf-32c530e254ab/scratchpad/verify-int
mkdir -p $L
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker > $L/up.log 2>&1; echo "up exit $?" > $L/status.txt
sleep 10
node tools/phase2/e2e/live-e2e.mjs > $L/live-e2e.log 2>&1; echo "live-e2e exit $?" >> $L/status.txt
node tools/phase2/job-control/chaos.mjs > $L/chaos.log 2>&1; echo "chaos exit $?" >> $L/status.txt
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore > $L/down.log 2>&1; echo "down exit $?" >> $L/status.txt
echo FINISHED >> $L/status.txt
