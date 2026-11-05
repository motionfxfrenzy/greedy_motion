# Plates Smoke Script (`tools/staging/plates-smoke.mjs`)

Drives the public HTTPS API through the plates film flow (`health` -> `create` -> `script` -> `plan` -> `animate` -> `preview-assets` -> `comment` -> `quote` -> `render` -> `download` -> `report`), plus optional `refund` (`SMOKE_STEPS=...,refund`). Plain Node 20+ ESM, built-in `fetch` only, no database or object-store client.

## Exit codes and final output line

- `SMOKE PASS <report.json path>` — exit code `0` (all requested steps passed).
- `SMOKE FAIL <step> <report.json path>` — exit code `1` (stopped at `<step>`, or first failed step when `--continue` is passed).
- `SMOKE ABORT <step> <report.json path>` — exit code `3` (quote exceeded `SMOKE_MAX_TOKENS`; nothing was spent).
- Exit code `2` — invalid configuration or CLI arguments before steps start.

## Token & media-token hygiene

- `SMOKE_TOKEN` is read from the environment only, sent as `Authorization: Bearer ...` only to `SMOKE_API`'s own origin (never to cross-origin presigned object-store URLs), never put in a URL, and redacted (`[redacted]`) from stdout, stderr, and `report.json`.
- Media routes (`GET /v1/projects/:id/plates/:index/clip` and `GET /v1/renders/:id`) carry the short-lived media token from `GET /v1/media-token` in `?t=<mediaToken>`, matching `frontend/lib/api.ts` (`withMediaToken`). The `?t=` query value is also redacted (`?t=[redacted]`) in all logs and `report.json`.

## Documented warnings (`report.warnings`)

Any step that passes while a non-fatal check triggers records the condition in `report.json` under `warnings`:
- `script`: beat count returned by the writer differs from `SMOKE_BEATS`.
- `plan`: storyboard beat count differs from script beat count.
- `animate`: live mode (`PLATE_LIVE_PREVIEW=on`) leaves scenes in `bundled` without a browser check; or a scene omits `bundleDigest`.
- `preview-assets`: bundle `Content-Type` is not `text/html` (while body is still a valid single HTML document); bundle has an external `<script src>`; clip route answered a status other than `302`.
- `comment`: comment still listed after redraw (e.g. in live mode before a browser `/check` marks the new revision playable), a model stub wrote a new generation bundle with the same `bundleDigest`, or no `bundleDigest` exposed.
- `download`: output route answered `200` or a non-`302` `3xx` instead of `302`; `ffprobe` is missing on `PATH` (or `SMOKE_FFPROBE=off`); duration differs from job metadata by > 2 s.

## Commands

### 1. Mock test suite (no Docker, no DB)

```bash
node --check tools/staging/plates-smoke.mjs tools/staging/mock-api.mjs tools/staging/plates-smoke.test.mjs
node --test tools/staging/plates-smoke.test.mjs
```

### 2. Local `plates-e2e` stack (`AUTH_MODE=none`, seeded project)

```bash
SMOKE_API=http://localhost:4100 SMOKE_PROJECT=<seeded-project-id> SMOKE_AUDIO=none SMOKE_KEEP=1 \
  SMOKE_STEPS=health,animate,preview-assets,comment,quote,render,download,report \
  node tools/staging/plates-smoke.mjs
```

### 3. Staging (real model + real R2; token from env var, never inline)

```bash
export SMOKE_TOKEN="$(cat /path/to/token-file)"
SMOKE_API=https://backend-staging-aec6.up.railway.app \
  SMOKE_AUDIO=voiceover SMOKE_MAX_TOKENS=20 \
  node tools/staging/plates-smoke.mjs
```

## Billing check (added 2026-11-05)
The `download` step fails (`SMOKE FAIL download`) when the quoted seconds are not the finished film's length rounded up (`quote.seconds == ceil(ffprobe duration)`, 0.05 s allowed for container padding). Skipped when ffprobe is missing. It caught the staging undercharge (quote 12 s, film 18 s); it will fail on any build where plate films are still quoted from the planner clock.
