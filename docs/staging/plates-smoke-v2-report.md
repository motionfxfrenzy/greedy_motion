# Plates Smoke v2 Report: Real Local Stack & Review Hardening

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-smoke` (branch `codex/staging-smoke`).

## 1. What Changed (Files & Line Counts)

| File | Lines | Changes in v2 |
| --- | --- | --- |
| `tools/staging/plates-smoke.mjs` | 719 | Closed all review gaps (`a`–`h` and `2.f.1`–`2.f.8`), added live-stack comment artifact verification when `llm-stub` returns identical code across revisions, added `platePollMs` (1500 ms live / 3000 ms clip), removed unused `OPEN`, added `Skip` handling for `--continue` and missing `SMOKE_PROJECT`, hardened `render` idempotency while job is running, hardened `download` (asserts 302, writes `film.mp4` only after `>100 kB` and `ftyp` checks pass, deletes on `ffprobe` failure), and added `SMOKE_MAX_TOKENS` + stop-at-first-failure + worker-failure/refused-render balance restoration checks to `refund`. |
| `tools/staging/mock-api.mjs` | 331 | Matched real backend shapes (`plates/service.ts` `fixPlates` live-mode `busyStates`, `plates/routes.ts` generation bundle URL path `/g<rev+1>/bundle.html`, `render/quote.ts` unready quote shape) and added failure switches (`double-spend-running`, `small-mp4`, `bundle-ctype`, `download-200`, `no-refund`, `fix-stub-same`) plus request-body recording for `POST /v1/projects` and `PUT /v1/projects/:id`. |
| `tools/staging/plates-smoke.test.mjs` | 414 | Expanded mock test suite from 25 to 33 tests (100% green), covering every review gap (`a` through `h` and `2.f.1`–`2.f.8`). |
| `tools/staging/README.md` | 51 | New concise runbook documenting exit codes (`0`, `1`, `2`, `3`), final lines (`SMOKE PASS`, `SMOKE FAIL`, `SMOKE ABORT`), token & `?t=` media-token hygiene, `report.warnings` conditions, and exact commands for mock, local `plates-e2e`, and staging. |
| `tools/staging/.gitignore` | 1 | Ignores `out/` (`tools/staging/out/`) so run artifacts and logs never pollute `git status`. |
| `docs/staging/plates-smoke-v2-report.md` | — | This v2 report (also written to `docs/staging/plates-smoke-report.md`). |

## 2. Review Gaps Closed (`a` to `h` and `2.f`)

- **Gap a (Final lines & exit codes):** Confirmed and tested `SMOKE PASS <path>` -> `0`, `SMOKE FAIL <step> <path>` -> `1`, `SMOKE ABORT <step> <path>` -> `3` (and CLI config errors -> `2`). Documented in `tools/staging/README.md`.
- **Gap b (`Idempotency-Key` double render, including while running):** `steps.render` sends 4 requests upfront (sequential + concurrent) with the same `Idempotency-Key`, then sends a 5th request with the same key once polling observes the job in `planning`/`rendering` (`checkedWhileRunning: true`), asserting a single job ID and a single token spend (`spent === quote.tokens`, `spendEntries === 1`).
- **Gap c & 2.f.3 (Download 302, cross-origin auth hygiene, `ftyp` & size before write, missing `ffprobe`):** `steps.download` asserts a `302` redirect (recording any other `3xx` or direct `200` in `report.warnings`), strips `Authorization` when following presigned object-store URLs (`fetchBinary` uses `auth: false` and `request()` restricts `Authorization` to `sameOrigin`), verifies `bytes.length >= 100 * 1024` and `ftyp` at bytes `4..8` **before** writing `film.mp4` (and deletes `film.mp4` if `ffprobe` validation fails), and records a warning while continuing when `ffprobe` is unavailable (`SMOKE_FFPROBE=off` or exit `127`).
- **Gap d (Token hygiene):** Verified in mock tests and grepped across all saved local-stack logs and `report.json` files (`tools/staging/out/run1*`, `run2*`, `run0*`). Neither `SMOKE_TOKEN` (`sentinel-token-DO-NOT-LEAK-7f3a9c1e5b`) nor the `?t=` media token appears in stdout, stderr, `report.json`, or any non-media URL.
- **Gap e (`SMOKE_STEPS` subset & `--continue`):** Running a subset without `create` and without `SMOKE_PROJECT` fails clearly (`SMOKE_PROJECT is required when SMOKE_STEPS omits create`). When `--continue` is passed after an earlier step fails, later steps whose prerequisites (`need(...)`) are missing throw `Skip` and are recorded as `"status": "skipped"` in `report.steps`, never `"ok"`.
- **Gap f (`2.f.1`–`2.f.8`):**
  1. `steps.comment` reuses `READY(first, st.mode)` so in live mode (`PLATE_LIVE_PREVIEW=on`), where scenes stop at `bundled`, it proceeds immediately instead of timing out after 10 minutes.
  2. `steps.refund` runs inside the main step loop (respecting stop-at-first-failure) and checks `GET /render/quote` against `SMOKE_MAX_TOKENS` before triggering a render.
  3. `steps.download` warns on non-`302` (`200` or other `3xx`) and only leaves `film.mp4` on disk when all checks pass.
  4. `steps["preview-assets"]` records non-HTML bundle `Content-Type` in `report.warnings`.
  5. `?t=<mediaToken>` is used for clip and output routes (matching `frontend/lib/api.ts` `withMediaToken`), redacted in all logs/reports, and documented in `tools/staging/README.md`.
  6. Unused `OPEN` set removed; `--help` now lists `SMOKE_DURATION`, `SMOKE_AUDIO`, `SMOKE_POLL_MS`, and all `SMOKE_*_TIMEOUT_MS` variables.
  7. `steps.script` beat-count mismatch is recorded in `report.warnings` and documented in `tools/staging/README.md`.
  8. Checked against `frontend/components/studio.tsx` (`requestFromBrief` lines 79–90, `ensureProject` lines 698–712, `writeScript` lines 717–722) and `frontend/components/plate-preview.tsx` (poll interval line 244): fixed `steps.create` project `name` to use the first sentence of the prompt (`(TOPIC.trim().split(/[.!?\n]/)[0]?.slice(0, 80) || "Untitled video").trim()`) and initial `request.audio` to `{ music: false, voiceover: false, voice: "Kore" }` (matching `defaultBrief` at project creation before `writeScript`), and updated plate polling (`platePollMs`) to poll every `1500 ms` in live mode and `3000 ms` in clip mode.
- **Gap g (Warnings in `report.json`):** Every warning condition emitted via `warn(...)` is pushed into `report.warnings`.
- **Gap h (`refund` balance restoration):** `steps.refund` records `balanceBefore`, `balanceAfter`, `balanceChange`, and `restored`, asserting `near(start.remaining, end.remaining)` both when the backend refuses an unready project (`400`) and when a queued render fails on the worker (`202` -> `failed`).

## 3. Real Local Stack Runs (`plates-e2e` with `compose.live.yaml`)

Stack mode used for final passes: **live mode** (`compose.yaml` + `tools/phase2/e2e/compose.live.yaml`, `PLATE_LIVE_PREVIEW=on`), started and torn down with the targeted commands while holding both `/Users/osamaehsaan/Code/Market_apps/.lock-plates-e2e` and `/Users/osamaehsaan/Code/Market_apps/.lock-timing`.

### Per-Run Results & Step Timings

| Step / Metric | Run 1 (`out/run1`) | Run 2 + Refund (`out/run2`) |
| --- | --- | --- |
| Seeded `SMOKE_PROJECT` | `1a541572-0079-443c-bf97-76f10d301c8e` | `bb89fc56-b345-40d3-84f0-64a193f9eb2f` |
| Render `jobId` | `ed385be2-14a3-4f75-941b-ce6aa2625f53` | `6083fc5f-4c3b-4eba-b9fc-ab8b961a6a7f` |
| `health` | `ok` (56 ms) | `ok` (129 ms) |
| `animate` | `ok` (1,962 ms; 3 scenes `bundled` in 1,519 ms) | `ok` (6,210 ms; 3 scenes `bundled` in 5,065 ms) |
| `preview-assets` | `ok` (65,788 ms; 3 HTML bundles ~42 kB each, scene 1 clip drawn & downloaded: 1,040,495 bytes) | `ok` (64,178 ms; 3 HTML bundles ~42 kB each, scene 1 clip drawn & downloaded: 1,040,495 bytes) |
| `comment` | `ok` (1,693 ms; scene 1 `rev` `0 -> 1`, new bundle `/g2/bundle.html`, scenes 2–3 unchanged) | `ok` (1,765 ms; scene 1 `rev` `0 -> 1`, new bundle `/g2/bundle.html`, scenes 2–3 unchanged) |
| `quote` | `ok` (65 ms; 14.1 tokens for 27 s) | `ok` (17 ms; 14.1 tokens for 27 s) |
| `render` | `ok` (91,804 ms; 5 requests w/ 1 `Idempotency-Key` incl. while `planning` -> 1 job, spent 14.1 once) | `ok` (39,360 ms; 5 requests w/ 1 `Idempotency-Key` incl. while `planning` -> 1 job, spent 14.1 once) |
| `download` | `ok` (1,541 ms; 302 redirect -> `film.mp4` 1,760,386 bytes, `ftyp` verified, `ffprobe`: H.264 1920x1080, 14.00 s, 420 frames) | `ok` (891 ms; 302 redirect -> `film.mp4` 1,760,386 bytes, `ftyp` verified, `ffprobe`: H.264 1920x1080, 14.00 s, 420 frames) |
| `refund` | `skipped` (not requested) | `ok` (37 ms; refused 400 on empty project, balance `2954.7 -> 2954.7`, `restored: true`) |
| `report` | `ok` (1 ms) | `ok` (2 ms) |
| Balances (`start` -> `end`) | `2982.9` -> `2968.8` (delta `-14.1`) | `2968.8` -> `2954.7` (delta `-14.1`, refund `2954.7 -> 2954.7`) |
| Final Output | `SMOKE PASS .../tools/staging/out/run1/report.json` | `SMOKE PASS .../tools/staging/out/run2/report.json` |

### Every Failure Encountered & Classification

1. **Initial `comment` step failure on local stack (`scene 1: revision 0 -> 1 but bundleDigest did not change`):**
   - **Classification:** **Script/stub interaction bug (fixed in script & mock).**
   - **Evidence:** On the local `plates-e2e` stack, `scripts/plates-e2e/llm-stub.mjs` returns the static `blueprint-0.ts` fixture for every authoring call, including comment revisions (`revise: true`). Because `bundleDigest` is content-addressed (`sha256` of bundle manifest/code), identical stub code produces the same `bundleDigest` even though the worker authored a new revision (`rev: 0 -> 1`) and uploaded a new generation bundle (`.../16x9/0/g1/bundle.html` -> `.../16x9/0/g2/bundle.html`).
   - **Fix:** `steps.comment` now compares both `bundleDigest` and the bundle artifact path from `GET /v1/projects/:id/plates/:variantId/bundle`. If neither changes, the step fails (`fix-same`); if a new generation bundle artifact is written with the same `bundleDigest` (stub returning identical code), it records `artifactChanged: true` and logs a warning in `report.warnings`.
2. **Concurrent run balance collision (`tools/staging/out/run0-concurrent`):**
   - **Classification:** **Test-runner overlap (not an app bug).**
   - **Evidence:** When an earlier background lock-wait process woke up while `run1` was in flight, two smoke instances ran concurrently against the same `LOCAL_USER_ID` (`00000000-0000-4000-8000-000000000000`), so the overlapping run saw `start.remaining - end.remaining = 28.2` (`2 * 14.1`) instead of `14.1`. Running sequentially (`run1` followed by `run2`) passed with exact `14.1` single-spend deltas on both runs.
3. **Real app bugs found:** **None.** Every tested route on `plate-api` and `plate-worker` (`healthz`, `/v1/me/tokens`, `/v1/media-token`, `/v1/projects/:id`, `script/animate`, `plates`, `plates/draw`, `plates/:variantId/bundle`, `plates/:variantId/clip-request`, `plates/:index/clip`, `plates/comments`, `plates/fix`, `render/quote`, idempotent `POST /render`, `/v1/render-jobs/:id`, `/v1/renders/:id`) succeeded and produced valid H.264 MP4 clips and final films.
   - *Note on live mode without a browser:* In `PLATE_LIVE_PREVIEW=on` without a browser calling `POST /plates/:variantId/check`, scenes remain in `state: "bundled"`. After `POST /plates/fix`, `backend/src/plates/service.ts` (`answered()` at line 69) only clears a comment once `isPlayable(row, mode)` is true (`checked` in live mode or `drawn` in clip mode). Thus, without a browser `/check`, the comment stays listed in `status.comments` after the redraw (`rev` `0 -> 1`), which the smoke script records as a warning (`"the comment is still listed after the redraw"`).

## 4. Real-Stack-Verified vs Mock-Only Steps

- **Verified on the real local `plates-e2e` Docker stack (`plate-api`, `plate-worker`, Postgres `plates_e2e`, Adobe S3Mock, `llm-stub`):**
  - `health`, `animate`, `preview-assets` (both live HTML bundle download and `clip-request` -> rendered MP4 clip download), `comment` (`POST /plates/comments` + `POST /plates/fix` + revision redraw), `quote`, `render` (including 5x `Idempotency-Key` deduplication before and during active rendering, plus full worker render to MP4), `download` (`302` redirect with `?t=` media token, `ftyp` + `>100 kB` + `ffprobe` stream verification), `refund` (refused render balance preservation), and `report`.
- **Mock-only (cannot run against `llm-stub`, which only answers plate-authoring prompts and has no `GEMINI_API_KEY` for TTS/music):**
  - `create`, `script` (`POST /v1/projects/:id/script/stream`), `plan` (`POST /v1/projects/:id/plan`, `POST /v1/projects/:id/script/voice`, `GET /v1/projects/:id/composition`), and worker-failure refund (`fail: "render"` in `mock-api.mjs`).

## 5. Exact Staging Command (Token from Env Var, Never Inline)

```bash
export SMOKE_TOKEN="$(cat /path/to/staging-token-file)"
SMOKE_API=https://backend-staging-aec6.up.railway.app \
  SMOKE_AUDIO=voiceover \
  SMOKE_MAX_TOKENS=20 \
  node tools/staging/plates-smoke.mjs
```

To include the optional refund check on staging:

```bash
export SMOKE_TOKEN="$(cat /path/to/staging-token-file)"
SMOKE_API=https://backend-staging-aec6.up.railway.app \
  SMOKE_AUDIO=voiceover \
  SMOKE_MAX_TOKENS=20 \
  SMOKE_STEPS=health,create,script,plan,animate,preview-assets,comment,quote,render,download,refund,report \
  node tools/staging/plates-smoke.mjs
```

## 6. `notChecked` List (Recorded in `report.json`)

1. `"live canvas playback in a browser (no canvas code is run here)"` — the smoke script fetches and validates the single-file HTML bundles and fallback MP4 clip from outside, without executing canvas/worker code in headless Chrome.
2. `"refund after a user cancel or a worker failure: no public cancel route exists (user cancel is not refunded; failures are); check app.token_ledger in the DB"` — when `refund` tests an unready project refusal (`400`), worker-failure refunds on staging require inspecting `app.token_ledger` (worker-failure refund is covered by mock tests and by `steps.render` if a real render job ever enters `failed`).
3. `"zero plate-render jobs for drawn scenes and manifest schema 2 (checked by the manager in the DB/logs)"` — internal queue/manifest state not exposed on public `/v1/` responses.
4. `"R2 object contents and keys"` — internal bucket layout beyond the presigned URLs returned by the API.
5. `"worker DB access (none by design)"` — enforced by container network/env configuration (`DATABASE_URL=postgres://nobody:nobody@127.0.0.1:1/none` in `compose.yaml`).
