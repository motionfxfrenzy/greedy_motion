#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
export DATABASE_URL="${DATABASE_URL:-postgres://videosaas:videosaas@localhost:55432/plates_followups_test}"
export PLANNER="${PLANNER:-deterministic}"
export TIMING_LOCK_HELD=1

STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/pollution-canary.XXXXXX")"
cleanup() {
  node --experimental-strip-types test/support/pollution-canary.mjs clean "$STATE_FILE" >/dev/null 2>&1 || true
  rm -f "$STATE_FILE"
}
trap cleanup EXIT

node --experimental-strip-types test/support/pollution-canary.mjs plant "$STATE_FILE"

for pass in 1 2; do
  echo "=== PASS $pass ==="
  for f in test/*.mjs; do
    DATABASE_URL="$DATABASE_URL" PLANNER="$PLANNER" node --experimental-strip-types "$f" >/dev/null 2>&1 || echo "FAIL $f"
  done
  node --experimental-strip-types test/support/pollution-canary.mjs check "$STATE_FILE"
done
