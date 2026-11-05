#!/bin/sh
# usage: argon-watch.sh <report path relative to the worktree> <label>
# Polls every 5 minutes. Emits ONE line and exits when: the report exists and no opencode run is alive (done),
# opencode is gone without a report (stopped), or nothing in the repo changed for 45 minutes while it runs (stalled).
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes || exit 1
REPORT="$1"; LABEL="$2"; STALL_WARNED=0
while true; do
  if pgrep -f "opencode run" >/dev/null 2>&1; then
    if [ "$STALL_WARNED" = 0 ] && [ -z "$(find frontend backend worker packages tools docs -type f -mmin -45 -not -path '*/node_modules/*' -not -path '*/.next/*' 2>/dev/null | head -1)" ]; then
      echo "ARGON STALLED? $LABEL: opencode is running but no file changed for 45 minutes"; STALL_WARNED=1
    fi
  else
    if [ -f "$REPORT" ]; then echo "ARGON DONE $LABEL: report $REPORT exists and opencode has exited"; else echo "ARGON STOPPED $LABEL: opencode has exited and there is no report at $REPORT"; fi
    exit 0
  fi
  sleep 300
done
