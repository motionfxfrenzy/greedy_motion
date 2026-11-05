# Task v2 for the coding agent: run the plates smoke script against the real local stack and harden it

You work for a manager (Claude) who re-runs your key checks and reads your diff. Read this whole file first and do what it says, in order. If a rule blocks you, stop that part and say so in the report; never work around a rule.

## Goal
`tools/staging/plates-smoke.mjs` (committed as a WIP, written earlier, tested only against `tools/staging/mock-api.mjs`, 25/25) has never touched a real backend. Run it against the local plates-e2e Docker stack (real backend, real worker, model stub, S3Mock), fix every failure that is a bug **in the script or the mock**, add the review gaps below, re-run until it passes or until the only failures left are real app bugs, and report. **Do not fix app code**; write real app bugs in the report with evidence (request, response, log line).

## Read first
1. `tools/staging/TASK-plates-smoke.md` (the original brief: step list, config, rules) and `docs/staging/plates-smoke-report.md` (what exists, section 5 "awkward from outside", section 7 commands).
2. `tools/staging/plates-smoke.mjs`, `tools/staging/mock-api.mjs`, `tools/staging/plates-smoke.test.mjs`.
3. `scripts/plates-e2e/lib.mjs` (`seedProject`, line ~38), `scripts/plates-e2e/run.mjs` (happy path, lines ~10-53), `scripts/plates-e2e/llm-stub.mjs`, `compose.yaml` (plates-e2e services, lines ~68-139), `tools/phase2/e2e/compose.live.yaml`.
4. Real routes to compare shapes with: `backend/src/server.ts`, `backend/src/plates/routes.ts`, `backend/src/plates/service.ts`, `backend/src/plan/routes.ts`, `backend/src/render/quote.ts`, `frontend/lib/api.ts`.

## Architecture rules
- Script stays plain Node 20+ ESM, built-in `fetch`, no new dependencies, no `pg`, no S3 client, no DB access **in the script**. Keep the existing step functions, `redact()`, output format (`step <name> ok <ms>`, final `SMOKE PASS|FAIL|ABORT ...`). Imitate the existing style.
- The **only** place a database is allowed is the seeding helper that already exists (`scripts/plates-e2e/lib.mjs seedProject`), called by you from a shell one-liner to create a project for `SMOKE_PROJECT`; do not change that file.
- Local stack mode (`AUTH_MODE=none`): the model stub answers only plate-authoring code, so the `create`/`script`/`plan` steps cannot pass there; use a seeded project (`SMOKE_PROJECT`) and `SMOKE_STEPS=health,animate,preview-assets,comment,quote,render,download,report`. Record exactly which steps ran on the real stack and which are only mock-covered.
- When you change a response shape the script expects, make the mock match the **real** backend (cite the source file/function in a comment) and keep the mock tests green.
- No changes to shared contracts or public APIs.

## Files allowed to change
`tools/staging/plates-smoke.mjs`, `tools/staging/mock-api.mjs`, `tools/staging/plates-smoke.test.mjs`, `tools/staging/fixtures/*`, `tools/staging/README.md` (new, short: how to run), `docs/staging/plates-smoke-report.md` (replace with the v2 report), and the new report `docs/staging/plates-smoke-v2-report.md`. Add `tools/staging/out/` to a new `tools/staging/.gitignore`.

## Files forbidden
Everything else: backend, frontend, packages, worker, `scripts/`, `compose*.yaml`, `tools/phase*`, any `package.json`, any `.env*` or secret file. Other worktrees (`../VideoSaaS-predraw`, `../VideoSaaS-engine`, `../VideoSaaS-live-scenes`) are off limits, read or write.

## Steps in order
1. Read the files above. Run `node --test tools/staging/plates-smoke.test.mjs` once to confirm 25/25 before changing anything.
2. **Review gaps to close in the script (with mock tests for each):**
   a. Final line and exit codes: confirm `SMOKE PASS <path>` exits 0, `SMOKE FAIL <step> <path>` exits 1, `SMOKE ABORT` exits 3; document in README.
   b. `Idempotency-Key` double render: assert same job id, **one** spend (balance drop equals the quote exactly once), also when the second request is sent after the first job is already running.
   c. Download: must follow a 302, never send the bearer token to the redirect target's origin (if different), check `ftyp` at offset 4 and size > 100 kB; with a missing `ffprobe` say so and continue.
   d. Token hygiene: sentinel token never in stdout, stderr, report, or any URL (existing test; extend it to the local-stack runs by grepping your saved logs).
   e. `SMOKE_STEPS` subset runs fail clearly if a required `SMOKE_PROJECT` is missing; `--continue` marks later steps `skipped`, not `ok`.
   f. Review findings of the manager's read-through (line numbers of the committed script): (1) `comment` (~l.415-456) waits for scene 1 `drawn`/`checked`, but in live mode scenes stay `bundled` and it would time out after 10 min: reuse the live-mode rule from `animate`. (2) `refund` (~l.558-571) sends a real render with no quote and no `SMOKE_MAX_TOKENS` guard: add the guard, and make it respect stop-at-first-failure (~l.605-609 runs it even after a failure). (3) `download` (~l.519-555) accepts any 3xx and a direct 200: assert 302 as the original brief says (record anything else as a warning with the actual status), and write the file only after the size and `ftyp` checks pass (or delete it on failure). (4) `preview-assets` content-type is a warning only (~l.373): keep as warning but list it in `warnings`. (5) The media token goes in `?t=` like `frontend/lib/api.ts`; keep, redacted, but note it in the README. (6) Remove the unused `OPEN` (~l.170); make the `--help` text list `SMOKE_DURATION`, `SMOKE_AUDIO` and the timeout variables. (7) `script` beat-count mismatch is only a warning: make it a documented warning in `warnings`. (8) Verify, against `frontend/components/studio.tsx` and `plate-preview.tsx`, the request bodies of `create`/`PUT` and the plates poll interval; fix the script where it differs and list what you checked.
   g. Any step the script marks `ok` while its asserted condition was only a warning must be listed in `report.json` under `warnings`.
   h. Refund option: record the balance before and after and assert the refund restores it exactly (mock test with the `render` failure switch).
3. **Locks.** Do all script and mock work (step 2) BEFORE this step, to keep the Docker period short. Then take `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` first, then `/Users/osamaehsaan/Code/Market_apps/.lock-timing` (both contain `smoke <ISO time>`; create each atomically, e.g. `set -o noclobber; echo "smoke $(date -u +%FT%TZ)" > <file>`). If a lock exists, wait (check every 60 s, up to 90 min), then stop and report. Never delete a lock you did not create. The heavy Docker build and renders corrupt other tracks' timing tests, so hold BOTH locks from before `up` until after teardown, and release both at teardown, also on failure.
4. **Start the stack (targeted, never bare `down`).** From this worktree, live mode:
   `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker`
   Wait until `curl -s localhost:4100/healthz` answers. If live mode makes the plate scenes stop at `bundled` and the script cannot proceed, also try clip mode (without the live override, up with the same targeted services) and say which mode the final pass used. Never touch the containers `videosaas-local-postgres-1` or `videosaas-local-worker-1`.
5. Seed a project: `node -e 'import("./scripts/plates-e2e/lib.mjs").then(async m=>{const p=await m.seedProject({look:"illus-blueprint",beats:3,audio:false});console.log(p.id);process.exit(0)})'` (the harness uses the e2e Postgres on `localhost:55432`, database `plates_e2e`; if this needs credentials you do not have, stop and report).
6. Run: `SMOKE_API=http://localhost:4100 SMOKE_PROJECT=<id> SMOKE_AUDIO=none SMOKE_KEEP=1 SMOKE_STEPS=health,animate,preview-assets,comment,quote,render,download,report node tools/staging/plates-smoke.mjs 2>&1 | tee <scratch>/run1.log`. For each failure decide: script/mock bug (fix, re-run) or real app bug (record with evidence, continue with `--continue` where possible). Repeat until a clean pass or only app bugs remain. Keep every run log and each `report.json` under `tools/staging/out/`.
7. Run it a second time with a freshly seeded project to prove it is repeatable. Run `SMOKE_STEPS=...,refund` once only if the previous runs passed and the quote is at or below `SMOKE_MAX_TOKENS` (local stack: it is). Record the balance before and after and assert the refund restores it exactly (this is gap h).
8. Tear down (targeted only): `docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore`. Delete both locks (only ones you created).
9. Re-run `node --check` on all three files and the mock test suite; write the reports.

## Tests to add and exact commands
- Mock tests for each of gaps a to h in `tools/staging/plates-smoke.test.mjs`.
- `node --check tools/staging/plates-smoke.mjs tools/staging/mock-api.mjs tools/staging/plates-smoke.test.mjs`
- `node --test tools/staging/plates-smoke.test.mjs` (must stay green, count rises from 25).
- The real-stack runs of step 6 and 7 (logs kept).

## Measurable acceptance criteria
1. Mock suite green, >= 25 + one new test per gap (a to h).
2. At least one full run of the steps in step 6 on the real local stack ending `SMOKE PASS`, with `film.mp4` saved, `ftyp` verified, ffprobe facts in `report.json`; or, if impossible, each blocking real app bug listed with evidence.
3. A second clean run on a fresh seed.
4. Zero secrets/token strings in any log or report; no file outside the allowed list changed (`git status` shows only allowed paths); stack torn down with the targeted command; both locks removed; `docker ps` still shows `videosaas-local-postgres-1` and `videosaas-local-worker-1` untouched.
5. Report `docs/staging/plates-smoke-v2-report.md` with: what changed (files, lines), per-run results with step timings, every failure and its classification (script bug fixed / mock bug fixed / real app bug), which steps are real-stack-verified vs mock-only, the exact staging command (token from an env var, never inline), and the `notChecked` list.

## Forbidden actions
No `git commit`, `push`, `reset`, `stash`, `checkout`, branch change. No deploys. No secrets: do not read `.env*`, `infra/aws/.env*`, `*accessKeys*`, token files. No staging, production, Railway, Vercel, AWS, Cloudflare, Supabase or real-model access; network only to `localhost`. No other worktrees. No bare `docker compose down`, no `docker rm/stop` of containers you did not start, no `--auto`. No Docker or port 4100/55432-heavy work without holding `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e`. No Docker, build or render work unless you hold both `.lock-plates-e2e` and `.lock-timing` (step 3); do not run Chrome tests.

## Report path and final line
Report: `docs/staging/plates-smoke-v2-report.md`. End your final message with exactly: `DONE docs/staging/plates-smoke-v2-report.md`
