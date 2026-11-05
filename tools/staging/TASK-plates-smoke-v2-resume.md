# Resume brief: plates smoke v2, steps 3 to 9

Read `tools/staging/TASK-plates-smoke-v2.md` in full first; every rule there still applies. The previous Argon session died (ECONNRESET) while waiting for `.lock-timing`. State on disk: step 2 (script/mock/test work, README, .gitignore) is DONE and the mock suite shows 33/33. Do NOT redo step 2 except to fix things you find during the real runs.

Lock state: `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` already exists and contains a `smoke ...` line: it is OURS (created by the dead session of this track), so keep using it and do not recreate it. `/Users/osamaehsaan/Code/Market_apps/.lock-timing` is held by `engine`: never touch it. Wait for it with ONE background-safe loop that survives long waits, e.g. `until [ ! -e /Users/osamaehsaan/Code/Market_apps/.lock-timing ]; do sleep 60; done` run with a tool timeout of at most 10 minutes per call, repeated up to 90 minutes in total, then take it atomically (`set -o noclobber; echo "smoke $(date -u +%FT%TZ)" > ...`). If you cannot get it in 90 minutes, release `.lock-plates-e2e` (ours) and write the report saying the real-stack run did not happen. Do not run any command with a very long single wait.

Then do steps 4 to 9 of the v2 brief exactly (start stack targeted, seed, run, second seeded run, optional refund per the rule, targeted teardown, release both locks, re-run `node --check` and the mock suite, write `docs/staging/plates-smoke-v2-report.md`). If any command fails with a transport error, retry it; if the stack is already up from before, check `docker ps` and reuse or tear down with the targeted command only.

Report path and final line unchanged: end your final message with exactly `DONE docs/staging/plates-smoke-v2-report.md`.
