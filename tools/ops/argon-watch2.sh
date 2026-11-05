#!/bin/sh
# usage: argon-watch2.sh <report path relative to the worktree> <label>
# Like argon-watch.sh, but "running" means the OpenCode background service reports an active session (closing a CLI tab does not stop a session).
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes || exit 1
REPORT="$1"; LABEL="$2"; STALL_WARNED=0
running() { opencode api session.active 2>/dev/null | grep -q '"type":"running"'; }
while true; do
  if running; then
    if [ "$STALL_WARNED" = 0 ] && [ -z "$(find frontend backend worker packages tools docs -type f -mmin -45 -not -path '*/node_modules/*' -not -path '*/.next/*' 2>/dev/null | head -1)" ]; then
      echo "ARGON STALLED? $LABEL: a session is running but no file changed for 45 minutes"; STALL_WARNED=1
    fi
  else
    sleep 20
    if running; then :; else
      if [ -f "$REPORT" ]; then echo "ARGON DONE $LABEL: report $REPORT exists and no OpenCode session is running"; else echo "ARGON STOPPED $LABEL: no OpenCode session is running and there is no report at $REPORT"; fi
      exit 0
    fi
  fi
  sleep 300
done
