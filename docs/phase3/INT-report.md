# Integration Report — Job Control (`codex/job-control`) + Live Plate Scenes (`codex/live-scenes`)

## 1. Files Created and Changed

### Created
- `tools/phase2/job-control/chaos.mjs` — End-to-end chaos test suite on the local compose stack (6 scenarios, 28 explicit assertions, measured timings, and worker zero-DB-connection verification).
- `tools/phase2/job-control/load.mjs` — Load and limits test simulating `W = 10, 25, 50, 100` workers via `worker/src/control.mjs` alongside `U = 20, 100, 200` req/s of `GET /v1/projects/:id/plates` against `plate-api`.
- `docs/phase3/INT-report.md` — This integration, chaos, and load-test report.

### Changed
- `backend/src/jobs/control.ts` — Allowed `plate.claim` to claim `'checked'` variants as well as `'bundled'`, re-dispatched when a poll arrives mid-fetch, updated `demand.idle` to honour `live_mode` / `draw_aspects` / `stage = 'queued for rendering'`, and added `monitorEventLoopDelay` + pool diagnostics to `demand.idle`.
- `worker/src/plates.mjs` — Updated `handlePlateRender` cap-backoff check (`plate.sendLater`) to re-queue `'checked'` variants as well as `'bundled'` when at the per-project rendering cap.
- `backend/src/plates/reconcile.ts` — Added `or v.stage = 'queued for rendering'` to `reconcilePlates()`'s lost-message query so live variants queued via `/clip-request` outside `draw_aspects` also recover lost `plate-render` messages.
- `backend/src/plates/store.ts` — Updated `commitBundle()` to re-queue `plate-render` when a live variant was sent back for code repair by a worker (`row.render_attempt > 0`) and to clear prior failed `app.plate_check_reports` rows / refresh `bundle_digest` on repaired bundles (`row.repairs > 0`).
- `backend/test/job-control.mjs` — Added seam regression tests (a)–(e) covering `checked` / `queued for rendering` / `requestDraws` claims, `scenes.states` & `demand.idle`, worker & browser code-repair re-bundling, reconciler re-enqueue to `control.poll`, `PLATE_LIVE_FORCE_OFF` rollback through `control.poll`, and `render_attempt` fencing across a lost worker.
- `compose.yaml` — Added `extra_hosts: ["postgres:127.0.0.1"]` on `plate-worker` so even direct TCP connection attempts to `postgres:5432` from inside `plate-worker` fail with `ECONNREFUSED`.
- `docs/JOB_CONTROL.md` — Added merged-branch e2e results, chaos test table, load test table and degradation analysis, and recommended staging/production connection and `ECS_WORKER_MAX_TASKS` budgets.

---

## 2. Exact Commands Run

```bash
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes

# Step 0: Baseline checks on the merged tree (commit 1f5ffdf / 5c53fdf)
docker ps
cd backend && npm run typecheck
cd ../frontend && npm run typecheck && npm test
cd ../backend
for f in test/*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/job-control.mjs

# Step 1.1: Rebuild images and verify plate-worker has no database access
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker
docker exec videosaas-local-plate-worker-1 node -e '
const net = require("node:net"), fs = require("node:fs");
const checkTcp = (host, port) => new Promise((r) => { const s = net.connect(port, host, () => { s.destroy(); r("CONNECTED"); }); s.on("error", (e) => r(e.code || e.message)); });
(async () => {
  const dbUrl = new URL(process.env.DATABASE_URL);
  const t4 = fs.readFileSync("/proc/1/net/tcp", "utf8").trim().split("\n").slice(1);
  const t6 = fs.readFileSync("/proc/1/net/tcp6", "utf8").trim().split("\n").slice(1);
  let pgInstalled = true; try { require("pg"); } catch { pgInstalled = false; }
  console.log(JSON.stringify({
    DATABASE_URL: process.env.DATABASE_URL,
    WORKER_CONTROL_URL: process.env.WORKER_CONTROL_URL,
    tcpPostgres5432: await checkTcp("postgres", 5432),
    tcpDatabaseUrl: await checkTcp(dbUrl.hostname, Number(dbUrl.port)),
    pgInstalled,
    openSocketsToPort5432: [...t4, ...t6].filter((l) => l.includes(":1538 ")).length
  }, null, 2));
})();'

# Step 1.2: Run existing e2e suites on the merged code
# (a) Clip-mode acceptance suite (compose.yaml)
docker compose -f compose.yaml --profile plates-e2e up -d --build plate-api plate-worker
node scripts/plates-e2e/run.mjs happy durability cache
node scripts/plates-e2e/run.mjs failures

# (b) Live-scenes acceptance suite (A to K) and UI acceptance suite (15 assertions)
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e up -d --build plate-api plate-worker
node tools/phase2/e2e/live-e2e.mjs
node tools/phase2/e2e/live-ui-e2e.mjs

# Step 2: Run local chaos suite (Scenarios 1 to 6)
node tools/phase2/job-control/chaos.mjs

# Step 3: Run load test and limits (W = 10, 25, 50, 100 x U = 20, 100, 200 req/s)
node tools/phase2/job-control/load.mjs

# Targeted teardown (leaving videosaas-local-postgres-1 and videosaas-local-worker-1 untouched)
docker compose -f compose.yaml -f tools/phase2/e2e/compose.live.yaml --profile plates-e2e down plate-worker plate-api llm-stub objectstore
docker ps

# Final verification of typecheck + unit/integration suites
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend && npm run typecheck
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/frontend && npm run typecheck && npm test
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend
for f in test/*.mjs; do
  DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types "$f"
done
```

---

## 3. Baseline Results (Step 0)

| Check / Suite | Baseline Result (Before Changes) | Post-Change Result | Notes |
| --- | --- | --- | --- |
| `backend` `npm run typecheck` | **PASS** (`0` errors) | **PASS** (`0` errors) | `tsc --noEmit -p .` |
| `frontend` `npm run typecheck` | **PASS** (`0` errors) | **PASS** (`0` errors) | `tsc --noEmit` |
| `frontend` `npm test` (`test/*.mjs`) | **PASS** (`168 / 168` tests, `0` failed, `24.7 s`) | **PASS** (`168 / 168` tests, `0` failed, `23.6 s`) | Includes headless Chrome integration & leak tests |
| `backend/test/job-control.mjs` | **PASS** (`job-control: ok`) | **PASS** (`job-control: ok`) | Expanded with live-scenes seam tests (a)–(e) |
| `backend/test/*.mjs` passing files | **`34 / 39` PASS** | **`34 / 39` PASS** | All `plate-*` (`plate-model`, `plate-store`, `plate-digest`, `plate-live`, `plate-live-render`, `plate-live-routes`, `plate-revisions`, `plate-rollback`) and `job-control` pass |
| `backend/test/*.mjs` known pre-existing failures | **`5 / 39` FAIL** | **`5 / 39` FAIL** | Known pre-existing failures listed in prompt: `billing.mjs`, `brand-files.mjs`, `render-prep.mjs`, `styles.mjs`, `visuals.mjs` |

---

## 4. Existing End-to-End Suites on the Merged Code & Proof of Zero Worker DB Access

### 4.1 Proof That Workers Have No Database Access
Inside `videosaas-local-plate-worker-1`, executing the TCP and `/proc/1/net/tcp{,6}` inspection script returned:
```json
{
  "DATABASE_URL": "postgres://nobody:nobody@127.0.0.1:1/none",
  "WORKER_CONTROL_URL": "http://plate-api:4000",
  "tcpPostgres5432": "ECONNREFUSED",
  "tcpDatabaseUrl": "ECONNREFUSED",
  "pgInstalled": false,
  "openSocketsToPort5432": 0
}
```
1. **No credentials:** `DATABASE_URL` is `postgres://nobody:nobody@127.0.0.1:1/none` (`ECONNREFUSED`).
2. **No driver:** Neither `pg` nor `pg-boss` is installed in `worker/node_modules` (`pgInstalled: false`).
3. **No network route to `postgres:5432`:** `extra_hosts: ["postgres:127.0.0.1"]` on `plate-worker` maps `postgres` to `127.0.0.1`, so a direct TCP check against `postgres:5432` from inside the worker container fails immediately with `ECONNREFUSED`.
4. **Zero open sockets to port `5432`:** `/proc/1/net/tcp` and `/proc/1/net/tcp6` of the worker's Node process (`PID 1`) have **`0`** entries targeting port `5432` (`:1538`), and `pg_stat_activity` on Postgres shows **`0`** connections from any worker container IP across all single-worker and 6-worker runs.

### 4.2 `scripts/plates-e2e/run.mjs happy durability cache failures` (Clip-mode E2E)

*Note on running `scripts/plates-e2e/run.mjs`:* `scripts/plates-e2e/run.mjs` tests the clip-mode pipeline where `POST /v1/projects/:id/plates/draw` automatically queues `plate-render` without a browser (`compose.yaml`, where `PLATE_LIVE_PREVIEW` defaults to `off`; `scripts/plates-e2e/lib.mjs`'s `compose()` helper also invokes `docker compose --profile plates-e2e` without `compose.live.yaml`). Furthermore, at the end of `cache()`, step 5 triggers a shared-spec brief edit (`await draw(id); await sleep(2000)`) that leaves 6 background `plate-author` jobs running; if `failures` starts immediately in the same process before those 6 background authoring jobs finish, their LLM calls increment `llm-stub`'s global counter during `failures`. Running `failures` once `cache`'s background jobs settle passes cleanly.

| Scenario (`scripts/plates-e2e/run.mjs`) | Status | Measured Time | Key Details |
| --- | --- | --- | --- |
| `happy` | **PASS** | **`427.8 s`** (`371.1 s` draw + `56.7 s` exports) | Primary `16:9` ready in `155.7 s`; all 9 variants (`16:9`, `9:16`, `1:1` × 3 scenes) drawn in `371.1 s` (`9` model calls); companion exports ready in `8.3 s` (`16:9`), `25.4 s` (`9:16`), `23.0 s` (`1:1`), all `480` frames (`16.00 s`) with audio |
| `durability` | **PASS** | **`469.0 s`** | API restart during slow authoring (`2` model calls); `docker kill plate-worker` mid-render recovered at `render_attempt = 2, 2` with `0` extra model calls; 4× duplicate `plate-render` delivery drew once (`render_attempt = 1`); mid-render beat edit superseded `g1` and published `0/g2/clip-a1.mp4`; `--force-recreate` of `plate-api` + `plate-worker` preserved clips and exported `ready` |
| `cache` | **PASS** | **`224.0 s`** | 3 scenes authored with `3` model calls; unchanged redraw = `0` calls; subtitle/audio edit = `0` calls and reused clips; 1-scene edit redrew only scene 1 (`gen = [1, 2, 1]`, `+1` model call) in `51.8 s`; `draw-aspect` `1:1` made `+3` calls leaving `16:9` untouched; brief text change invalidated all variants |
| `failures` | **PASS** | **`167.0 s`** | `bad-import` repaired in `1` call + `1` repair (`render_attempt = 1`); `nondeterministic` caught by worker browser verification and repaired via `plate.sendBackForRepair` (`2` calls, `repairs = 1`); `http500`×3 outage survived with `repairs = 0, authored = 1` |

### 4.3 `tools/phase2/e2e/live-e2e.mjs` (Scenarios A to K, `PLATE_LIVE_PREVIEW=on`)

All **11 scenarios (A–K)** and **108 / 108 assertions** passed in **`452.0 s` (`7m 32s`)**.

| Scenario | Description | Status | Measured Times & Key Numbers |
| --- | --- | --- | --- |
| **A** | Happy path, live (`illus-fox`, `16:9`, 3 beats) | **PASS** | Draw → all 3 `bundled`: **`616 ms`**; draw → all 3 `checked` in browser: **`7,824 ms`**; browser `WorkerHost` draw rate: **`23.4 fps`** (`42.7 ms/frame`); pixel diff vs page-thread host (frames `0, 45, 89`): **`0` px**; `plate-render` jobs: **`0`** |
| **B** | Clip fallback & per-project clip cap (`4`) | **PASS** | Single `checked` variant (`165` frames) `requestClip` → `drawn` by control-driven worker: **`61,393 ms`** (`61.4 s`); 5 concurrent clip requests: first 4 → **`202`**, 5th → **`429 { code: "clip_cap" }`** |
| **C** | Fencing over HTTP (`POST .../check`) | **PASS** | Mismatched `gen` → **`204`**; wrong `bundleDigest` → **`204`**; `state = 'drawn'` → **`204`**; duplicate valid report → **`200 { state: "checked" }`** (`1` row in `plate_check_reports`); `host: "main"` → **`400`**; `clip` mode → **`409`** |
| **D** | Comment and revision (`POST .../comments`, `POST .../fix`) | **PASS** | `gen` `1 → 2`, `rev` `0 → 1`; stale `gen = 1` report → **`204`**; browser re-checked `gen = 2` → **`200 { state: "checked" }`**; `sweepGarbage()` kept `g1/` (referenced by `plate_revisions`) and deleted unreferenced `g99/` |
| **E** | Tamper (`bundle.html` modified in S3Mock) | **PASS** | `fetchBundle` rejected tampered HTML with SHA-256 mismatch; `0` iframes, `0` Workers spawned |
| **F** | Rollback (`PLATE_LIVE_FORCE_OFF=1`) | **PASS** | `live_mode` flipped `'live' → 'clip'`; 2 `checked` variants rendered by control-driven worker to `drawn` in **`69,947 ms`** (`69.9 s`); second `reconcilePlates()` pass enqueued **`0`** extra jobs (`3 → 3`) |
| **G** | Flag semantics (`PLATE_LIVE_PREVIEW` on → off) | **PASS** | Project created while flag `on` stayed `live` after restart with flag `off`; project created while flag `off` got `clip` mode and auto-rendered to `drawn` in **`28,136 ms`** (`28.1 s`) |
| **H** | Final render & export draw-on-demand expectation | **PASS** | `POST .../plates/export` returned **`202 { state: "drawing" }`**, persisted `draw_aspects = ["16:9"]`, and enqueued **`2`** `plate-render` jobs; `POST .../render` queued `plate-film` without duplicating `plate-render` jobs (`2` total) |
| **I** | Unsupported environment (Safari macOS UA override) | **PASS** | `environmentStatus()` = `"unverified"`, `supportsWorkerHost()` = `false`, `PlatePlayer` selected `mode: "clip"` (`reason: "unverified-environment"`), `0` iframes, `0` Workers |
| **J** | Final render of browser-checked live project | **PASS** | `POST .../render` → `ready` MP4 in **`141,826 ms`** (`141.8 s`); `3 / 3` scenes drawn (`3` `plate-render` jobs); repeated `POST .../render` enqueued **`0`** extra `plate-render` jobs (`3` total); MP4 verified via `ffprobe` (`1920×1080`, `aac` audio, **`480 / 480` frames**) |
| **K** | Final render with no browser + `9:16` companion export | **PASS** | Immediate `POST .../render` (before `bundled`, `0` rows ever `checked`) → `ready` MP4 in **`61,278 ms`** (`61.3 s`, `1920×1080`, `270 / 270` frames, `2` `plate-render` jobs); `9:16` companion export → `ready` in **`73,458 ms`** (`73.5 s`, `1080×1920`, `270 / 270` frames, `2` `plate-render` jobs) |

### 4.4 `tools/phase2/e2e/live-ui-e2e.mjs` (Real Next.js UI Acceptance, 15 Assertions)

All **15 / 15 assertions** passed in **`142.0 s` (`2m 22s`)**:
- Open page → all 3 `illus-balloon` scenes authored to `bundled` and checked by `PlateLiveStage` to `checked` (`clip_key = null`, `0` `plate-render` jobs): **`4,347 ms`** (`4.35 s`).
- Live canvas playback with voiceover + music master clock: **`9.99 s`** elapsed, **`293`** frames rendered (`293` distinct), **`29.3 fps`** achieved, **`0` late frames**, crossed scene boundaries cleanly to Scene 3.
- Timeline slider seek to Scene 3 and back to Scene 1 updated live canvas immediately.
- Comment on Scene 1 + `Redraw scene 1` (`POST .../fix`) advanced Scene 1 to `rev = 1, gen = 2` and re-checked to `checked` in **`2,485 ms`** (`2.49 s`, `checksRun: 3 → 4`).
- Forced-unverified browser page (`?env=unverified`) selected `S1:clip(unverified-environment)` (`0` Worker iframes), requested fallback clip, and played the worker-drawn MP4 clip in `<video class="on">` after **`41,095 ms`** (`41.1 s`).
- Clicking `Render` on `PlatePreview` produced a finished `1920×1080` MP4 with `aac` audio (`480` frames) in **`75,304 ms`** (`75.3 s`).

---

## 5. Bugs Found at the Seams Between `codex/job-control` and `codex/live-scenes`

| # | Seam / Failing Check | Root Cause | Fix | Covering Test |
| --- | --- | --- | --- | --- |
| **1** | **Seam (a):** `plate.claim` and cap backoff on a variant in `state = 'checked'` | `backend/src/jobs/control.ts` (`plate.claim`, line 152) was written before `019_plate_live.sql` and required `v.state = 'bundled'`, rejecting a variant in `state = 'checked'`. Similarly, `worker/src/plates.mjs` (line 74) only called `plate.sendLater` on cap contention when `now?.state === "bundled"`, dropping a `'checked'` variant. | Updated `plate.claim` in `backend/src/jobs/control.ts` to allow `v.state in ('bundled', 'checked')` and updated `worker/src/plates.mjs` line 74 to check `now?.state === "bundled" \|\| now?.state === "checked"`. | `backend/test/job-control.mjs` (`seam (a): variant in state 'checked' is claimable via plate.claim`) |
| **2** | **Seam (b):** `demand.idle` and worker-initiated code repair (`plate.sendBackForRepair`) in `live` mode | (1) `demand.idle` in `backend/src/jobs/control.ts` counted all `state in ('bundled', 'rendering')` rows, which in `live` mode kept scale-to-zero workers awake for unchecked `bundled` (`stage = 'checking'`) scenes while missing `'checked'` scenes in `draw_aspects`. (2) When a worker rendering a single fallback clip (`/clip-request`, where `draw_aspects` is empty) called `plate.sendBackForRepair`, `commitBundle` in `backend/src/plates/store.ts` checked `!isLive \|\| drawOnDemand` and did not re-queue `plate-render` even though `row.render_attempt > 0`. | (1) Updated `demand.idle` in `backend/src/jobs/control.ts` to match `reconcile.ts`'s open-work predicate (`live_mode <> 'live'`, `aspect = any(draw_aspects)`, or `stage = 'queued for rendering'`). (2) Updated `commitBundle` in `backend/src/plates/store.ts` to set `shouldRender = !isLive \|\| drawOnDemand \|\| row.render_attempt > 0`. | `backend/test/job-control.mjs` (`live variants waiting for browser check do not keep workers awake` & `worker-repaired variant re-enters rendering queue`) |
| **3** | **Seam (c):** Reconciler recovery of lost `plate-render` message for a live variant queued via `/clip-request` (`stage = 'queued for rendering'`) | In `backend/src/plates/reconcile.ts`, the `open` count query (line 136) checked `coalesce(s.live_mode, 'clip') <> 'live' or v.aspect = any(coalesce(s.draw_aspects, '{}'::text[])) or v.stage = 'queued for rendering'`, but the resend query (line 78) omitted `or v.stage = 'queued for rendering'`. If a `/clip-request` `plate-render` message was lost on a live project whose aspect was not in `draw_aspects`, `reconcilePlates()` reported `open = 1` forever without re-sending `plate-render`. | Added `or v.stage = 'queued for rendering'` to the resend query in `backend/src/plates/reconcile.ts` (line 78). | `backend/test/job-control.mjs` (`seam (c): control.poll receives reconciler's re-enqueued plate-render job`) |
| **4** | **Live UI E2E (`live-ui-e2e.mjs`):** Browser `runCheck` code repair on a live variant (`row.repairs > 0`) did not re-check after `commitBundle` when `llm-stub` returned identical code | When 3 `1920×1080` `WorkerHost` checks ran concurrently in Chrome and one triggered a `kind: "code"` repair (`sendBackForRepairWithClient`), `gen` stayed `1`, `app.plate_check_reports` kept the failed report row for `(variant_id, gen=1, bundle_digest)`, and `llm-stub` returned the identical fixture so `commitBundle` produced the same `bundle_digest`. `PlateLiveStage`'s `CheckOnceTracker` (keyed by `variantId:g<gen>:<bundleDigest>`) treated the repaired bundle as already checked, leaving the scene stuck in `bundled` (`stage = 'checking'`). | In `commitBundle` (`backend/src/plates/store.ts`), included `{ __repair: row.repairs }` in `bundleDigest` computation when `row.repairs > 0` and deleted prior `app.plate_check_reports` rows for `(updated.id, updated.gen)` when committing a repaired bundle. | `backend/test/job-control.mjs` (`repaired bundle gets a fresh bundle_digest` & `repaired bundle accepts subsequent passing check report`) and `tools/phase2/e2e/live-ui-e2e.mjs` |
| **5** | **Control dispatcher (`control.ts`):** Concurrent worker polls arriving while `dispatch()` was mid-`boss.fetch` waited for the 3 s backstop | In `backend/src/jobs/control.ts`, `if (dispatching) return;` dropped wakeups from `wait()` calls that arrived while an async `boss.fetch()` was in flight, forcing newly polling workers to wait up to `FETCH_BACKSTOP_MS` (3,000 ms) even when jobs were queued. | Added `dispatchPending` flag in `dispatch()` (`backend/src/jobs/control.ts`) so a wakeup arriving during `boss.fetch()` immediately runs another pass while `waiters.size > 0`. | `tools/phase2/job-control/chaos.mjs` (Scenario 5) & `tools/phase2/job-control/load.mjs` |

---

## 6. Chaos Test Results (`tools/phase2/job-control/chaos.mjs`)

All **6 scenarios** and **28 / 28 explicit assertions** passed on the local compose stack.

| Scenario | What Was Done | Explicit Assertions Verified | Measured Times | Status |
| --- | --- | --- | --- | --- |
| **1. Kill the worker mid-render** | Seeded 1-beat `illus-blueprint` project with audio; started billed `POST /v1/projects/:id/render`; waited until worker claimed `render-video` (`attempt = 1`) and `plate-render` was actively drawing frames (`stage = 'rendering', render_attempt = 1`); ran `docker kill plate-worker` and restarted `plate-worker`. | • Scene completed as `render_attempt = 2` (`clip-a2.mp4`)<br>• Billed render job completed as `attempt = 2` (`renders/<id>/a2.mp4`)<br>• `render-finished` queued once (`count = 1`)<br>• Token ledger has **1** `spend` entry (`-7200` millitokens, no double charge)<br>• Downloaded MP4 is valid `1920×1080`, `90` frames | • Time to mid-render kill: **`11.63 s`**<br>• Total recovery + completion time (incl. 30 s lease + pg-boss supervise + redraw + assembly): **`149.26 s`** | **PASS** |
| **2. Cut the control link** | Seeded 1-beat `illus-blueprint` project; triggered `POST .../clip-request`; waited for worker to claim lease (`render_attempt = 1`); ran `docker pause videosaas-local-plate-api-1` for 20 s, then `docker unpause`. | • Control link paused for `20,154 ms` (`< 30 s` lease)<br>• Worker retried control calls with bounded backoff and kept its lease<br>• Scene finished `drawn` at `render_attempt = 1` (nothing published twice)<br>• `pgboss.job` state = `'completed'`, `retry_count = 0` | • Pause duration: **`20.15 s`**<br>• Total scene render time (including 20.15 s pause): **`31.63 s`** | **PASS** |
| **3. Restart API during long poll & finish call** | (3a) Ran `docker compose restart plate-api` while `plate-worker` held an open `/internal/worker/poll`, then requested a clip draw without touching `plate-worker`.<br>(3b) Dropped first HTTP response of `render.finish` after backend commit, and restarted `plate-api` before retrying `render.finish`. | • Worker reconnected its broken long poll and claimed new job automatically<br>• Retried `render.finish` after lost response returned `{ committed: true, duplicate: true }`<br>• Post-restart `render.finish` also returned `{ committed: true, duplicate: true }`, preserved `renders/<id>/a1.mp4`, and queued `render-finished` once | • API container restart: **`5.51 s`**<br>• Worker poll reconnect + claim: **`1.05 s`**<br>• Lost-answer `render.finish` retry: **`473 ms`** | **PASS** |
| **4. Duplicate completion & stale attempt** | Tested `render.finish` (`app.render_jobs`) and `plate.drawn` (`app.plate_variants`) over HTTP: attempt 1 claimed then superseded by attempt 2; sent finish from stale attempt 1 (before and after commit) and twice from attempt 2. | • Stale attempt 1 rejected before commit (`{ committed: false }`, `{ ok: false }`) and after commit<br>• Attempt 2 committed on 1st call (`{ committed: true }`, `{ ok: true }`) and returned `duplicate: true` on 2nd call<br>• Only attempt 2's output (`a2-winner.mp4` / `winner-a2.mp4`) stored; `render-finished` count = `1` | • Full 6-assertion fencing sequence: **`119 ms`** | **PASS** |
| **5. Many waiting workers** | Scaled `plate-worker` to **6 containers**; queued 10 scenes across 2 projects (`5` `illus-fox` + `5` `illus-balloon`); sampled `pg_stat_activity` and `/proc/1/net/tcp{,6}` across all 6 containers every 2 s (`178` samples). | • All 6 worker containers running<br>• All 10 scenes completed to `drawn`, each **exactly once** (`render_attempt = 1` on all 10)<br>• 4 distinct worker containers drew clips (bounded by per-project cap of 2 concurrent renders × 2 projects = 4 active slots)<br>• **Worker Postgres connections = `0`** (`maxWorkerDbConns = 0`, `maxWorkerContainerSockets5432 = 0` across all 178 samples)<br>• API Postgres connections stayed ≤ **`13`** (within `10` pool + `4` pg-boss budget) | • Total time for 10 scenes: **`406.17 s`** (`~40.6 s/scene` effective)<br>• Samples collected: **`178`** | **PASS** |
| **6. HyperFrames render through job control** | Seeded 3-beat non-plate project (`look: "clean"`, kinetic HyperFrames beats, `12.333 s`); triggered `POST /v1/projects/:id/render`; `plate-worker` (with dead `DATABASE_URL` and `extra_hosts: ["postgres:127.0.0.1"]`) claimed via `render.claim`, reported `render.progress`, ran `hyperframes render`, uploaded MP4, and finished via `render.finish`. | • `POST /v1/projects/:id/render` returned `202`<br>• Real frame progress (`stage = 'frames'`, `progress > 50`) reported through job control<br>• Job reached `state = 'ready'`, `GET /v1/renders/:id` redirected (`302`) to valid `1920×1080` H.264 MP4 with **`370 / 370` frames** (`12.333 s × 30 fps`)<br>• Worker open sockets to port `5432` = **`0`** | • End-to-end HyperFrames render: **`52.68 s`** | **PASS** |

*Anything not tested in Step 2:* AWS ECS Spot `SIGTERM` drain notification via AWS metadata endpoint (tested locally via Docker `SIGTERM` / `SIGKILL` and `runLeased` shutdown signal; real ECS Spot interruption requires AWS).

---

## 7. Load Test Results and Point of Degradation (`tools/phase2/job-control/load.mjs`)

Each step ran for `10 s` against the local `plate-api` container (`DATABASE_POOL_SIZE = 10`, `pg-boss` `max = 4`) and `plates_e2e` Postgres container, with `W` concurrent workers using the real `worker/src/control.mjs` client (`2 s` lease hold per job: `poll` → `render.claim` → `1 s` sleep → `render.progress` → `1 s` sleep → `render.finish` → `complete`) while `U` req/s of `GET /v1/projects/:id/plates` hit `plate-api`.

| W (Workers) | U (Target RPS) | Achieved RPS | API DB Conns (`pg_stat_activity` / Pool / Waiting) | Worker DB Conns | Control Ops `p50 / p95` (ms) | Control `/poll` `p50 / p95` (ms) | Ordinary Read `p50 / p95` (ms) | API Event-Loop Lag `p50 / p95 / max` (ms) | Jobs/s Completed | 5xx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **10** | **20** | `19.4` | `11` (`4` / `0`) | **`0`** | `4.8 / 16.5` | `4.9 / 9.3` | `8.5 / 19.3` | `11.25 / 15.10 / 29.05` | `4.00` | `0` |
| **10** | **100** | `97.0` | `17` (`10` / `0`) | **`0`** | `4.0 / 9.6` | `4.9 / 10.6` | `8.5 / 15.1` | `10.86 / 14.85 / 15.64` | `4.00` | `0` |
| **10** | **200** | `193.6` | `17` (`10` / `6`) | **`0`** | `3.3 / 9.0` | `4.6 / 10.2` | `9.4 / 15.9` | `11.14 / 14.76 / 15.24` | `4.00` | `0` |
| **25** | **20** | `19.4` | `17` (`10` / `0`) | **`0`** | `4.1 / 30.9` | `5.1 / 10.7` | `7.6 / 17.7` | `11.48 / 15.11 / 19.43` | `10.00` | `0` |
| **25** | **100** | `96.9` | `17` (`10` / `0`) | **`0`** | `3.7 / 14.5` | `4.9 / 18.2` | `7.9 / 20.4` | `11.19 / 15.55 / 81.92` | `10.00` | `0` |
| **25** | **200** | `193.8` | `17` (`10` / `0`) | **`0`** | `3.9 / 28.7` | `5.0 / 10.2` | `9.0 / 24.2` | `11.01 / 17.12 / 102.56` | `10.00` | `0` |
| **50** | **20** | `19.4` | `17` (`10` / `0`) | **`0`** | `4.5 / 21.9` | `5.5 / 10.7` | `7.8 / 14.2` | `11.34 / 15.08 / 23.77` | `19.60` | `0` |
| **50** | **100** | `97.0` | `17` (`10` / `0`) | **`0`** | `4.7 / 27.9` | `4.9 / 17.6` | `7.7 / 15.9` | `11.12 / 14.83 / 17.30` | `20.00` | `0` |
| **50** | **200** | `194.0` | `17` (`10` / `3`) | **`0`** | `4.1 / 12.9` | `4.7 / 12.9` | `9.1 / 17.0` | `10.76 / 14.70 / 17.68` | `20.00` | `0` |
| **100** | **20** | `19.4` | `17` (`10` / `41`) | **`0`** | `5.5 / 110.8` | `13.0 / 44.3` | `6.9 / 29.4` | `11.07 / 15.49 / 71.89` | `38.40` | `0` |
| **100** | **100** | `95.5` | `17` (`10` / `42`) | **`0`** | `5.6 / 459.1` | `6.6 / 33.3` | `8.2 / 376.5` | `10.83 / 24.38 / 343.41` | `30.59` | `0` |
| **100** | **200** | `195.0` | `17` (`10` / `2`) | **`0`** | `4.9 / 21.9` | `12.4 / 38.4` | `9.1 / 27.1` | `11.03 / 14.79 / 41.94` | `38.30` | `0` |

### Point of Degradation Analysis
1. **Zero Degradation up to `W = 50` workers and `U = 200` req/s (`20.0 jobs/s` completed):**
   - Throughout `W = 10, 25, 50` and `U = 20, 100, 200` req/s, `jobs/s` scales linearly with `W` (`4.0 → 10.0 → 20.0 jobs/s`), control op `p95` stays `9.0–30.9 ms`, ordinary read (`GET /v1/projects/:id/plates`, which executes 3 Postgres queries per call) `p95` stays `14.2–24.2 ms`, API event-loop lag `p95` stays `14.7–17.1 ms`, and `5xx` count is **`0`**.
2. **Where Degradation Begins (`W = 100` workers with 2 s synthetic leases, `30.6–38.4 jobs/s`):**
   - At `W = 100` workers holding leases for only `2 s`, the workers generate `~38 jobs/s × 4 control calls/job = ~152 transactional DB writes/s` plus `~38 poll + complete calls/s`, alongside `U × 3` read queries/s (`300–600` read queries/s).
   - Because `DATABASE_POOL_SIZE` is `10`, synchronized waves of `render.finish` transactions (which acquire a client from `pool`, run `BEGIN`, update `app.render_jobs`, insert into `pgboss.job`, and `COMMIT`) cause `pool.waitingCount` to spike to **`41–42` waiting callers**, pushing control op `p95` to **`110.8–459.1 ms`** and ordinary read `p95` to **`376.5 ms`** (at `W = 100, U = 100`), while `p50` remains fast (`5.5–8.2 ms`) and **`0` 5xx errors** occur.
   - In addition, `boss.fetch(queue, { batchSize: Math.min(free, 5) })` fetches at most 5 jobs per query, so waking 100 simultaneous waiters requires 20 sequential `boss.fetch` queries (`controlPollP95Ms` rises from `~10–18 ms` to `33.3–44.3 ms`).
   - **Real-world translation:** Real video/plate jobs hold leases for **`30–90 s`** (not `2 s`). Thus `100` real concurrent worker slots generate only `~1.5–3 jobs/s` (`~6–12 control writes/s`), which sits well below the `W = 10` (`4.0 jobs/s`) load level where `p95` is `< 20 ms`.

---

## 8. Recommended Connection Budgets (Measured vs Extrapolated)

### Measured Numbers (Local macOS Laptop with Docker)
- **Worker Postgres connections (`W = 1..100`):** **`0`** (measured via `pg_stat_activity`, `/proc/1/net/tcp{,6}`, and absence of `pg` / `pg-boss` in worker image).
- **`pg-boss` connections in `plate-api` (`max: 4`, `useListenNotify: true`):** **`4`** pool clients + **`3`** `LISTEN` clients = **`7` clients** under active load.
- **API `pg.Pool` connections (`DATABASE_POOL_SIZE = 10` default):** **`4` clients** at `W = 10, U = 20 req/s`; **`10` clients** (full pool) at `U = 100–200 req/s` or `W ≥ 25`.
- **Total API Postgres connections in `pg_stat_activity`:** **`11`** at low load (`4 + 7`), **`17`** at peak load (`10 + 7`).

### Extrapolated Budgets for Staging and Production

| Budget Component | Staging (Supabase Session Pooler ≤ 15) | Production on Session Pooler (≤ 15 clients) | Production on Direct IPv6 / Dedicated Pooler (`max_connections = 60`) | Measured vs Extrapolated |
| --- | --- | --- | --- | --- |
| **API replicas** | `1` | `1` | `2` | Deployment topology |
| **`DATABASE_POOL_SIZE` (per API replica)** | **`5`** | **`5`** | **`12`** (`24` across 2 replicas) | Extrapolated to fit 15-client session pooler cap |
| **`pg-boss` pool `max` (per API replica)** | **`4`** | **`4`** | **`4`** (`8` across 2 replicas) | **Measured** (`queues.ts` `max: 4`) |
| **`pg-boss` `LISTEN` clients (per API replica)** | **`3`** | **`3`** | **`3`** (`6` across 2 replicas) | **Measured** (`3` `LISTEN` connections in `pg_stat_activity`) |
| **Active API connections** | **`12`** (`5 + 4 + 3`) | **`12`** (`5 + 4 + 3`) | **`38`** (`2 × 19`) | Sum of measured `pg-boss` + configured `DATABASE_POOL_SIZE` |
| **Worker connections (`ECS_WORKER_MAX_TASKS × 0`)** | **`0`** | **`0`** | **`0`** | **Measured** (`0` across `1..100` workers) |
| **Headroom / Reserve (migrations, deploy overlap, admin)** | **`3`** (20% of `15`) | **`3`** (20% of `15`) | **`22`** (37% of `60`) | Extrapolated safety margin |
| **Total vs Limit** | **`12 + 3 = 15 / 15`** | **`12 + 3 = 15 / 15`** | **`38 + 22 = 60 / 60`** | Fits within hard limits |
| **Recommended safe `ECS_WORKER_MAX_TASKS`** (`PLATE_CONCURRENCY = 2` per task) | **`8–12` tasks** (`16–24` concurrent renders) | **`20–25` tasks** (`40–50` concurrent renders) | **`40–50` tasks** (`80–100` concurrent renders) | Extrapolated from load test (`W = 50` slots had `0` degradation; with `DATABASE_POOL_SIZE = 5` on session pooler, `20–25` tasks = `40–50` slots keeps control `p95 < 35 ms`) |

**Key takeaway:** Previously, with `DATABASE_URL` in the worker, each ECS worker task consumed `~5` session pooler connections, capping `ECS_WORKER_MAX_TASKS` at **`1`**. With job control (`WORKER_CONTROL_URL`), worker tasks consume **`0`** database connections. Even on the 15-client Supabase session pooler (with `DATABASE_POOL_SIZE = 5`), the API can safely drive **`20–25` ECS worker tasks (`40–50` concurrent scenes)** without adding a single database connection. Note that with `DATABASE_POOL_SIZE = 10` (the current default in `backend/src/config.ts`), a single API replica can reach `10 + 7 = 17` connections under heavy load, which exceeds the 15-client Supabase session pooler cap by 2; setting `DATABASE_POOL_SIZE=5` in staging/production env when behind the 15-client session pooler guarantees `12 <= 15` with 3 connections of headroom.

---

## 9. Anything That Could Not Be Done, Contradictions, Risks, and Open Questions

1. **Contradiction in Step 1.2 (`scripts/plates-e2e/run.mjs` vs `compose.live.yaml`):**
   - Step 1.1 starts the stack with `-f compose.yaml -f tools/phase2/e2e/compose.live.yaml` (`PLATE_LIVE_PREVIEW=on`), and Step 1.2 says to run `node scripts/plates-e2e/run.mjs happy durability cache failures` and `live-e2e.mjs` and `live-ui-e2e.mjs`.
   - By design of `codex/live-scenes`, when `PLATE_LIVE_PREVIEW=on`, `POST /v1/projects/:id/plates/draw` sets `live_mode = 'live'` and leaves variants in `state = 'bundled', stage = 'checking'` waiting for a browser check report (`0` `plate-render` jobs), whereas `scripts/plates-e2e/run.mjs` is a headless clip-mode suite that calls `/plates/draw` and immediately waits for `allDrawn()` (and its `compose()` helper in `scripts/plates-e2e/lib.mjs` invokes `docker compose --profile plates-e2e` without `compose.live.yaml`).
   - We therefore ran `scripts/plates-e2e/run.mjs happy durability cache failures` with `compose.yaml` (`PLATE_LIVE_PREVIEW=off`, clip mode) and `live-e2e.mjs` + `live-ui-e2e.mjs` + `chaos.mjs` + `load.mjs` with `compose.yaml` + `compose.live.yaml` (`PLATE_LIVE_PREVIEW=on`, live mode). Both modes now pass 100%.
2. **Parallel `WorkerHost` GPU canvas budget in Chromium (`PlateLiveStage`):**
   - During the first run of `live-ui-e2e.mjs`, running 3 concurrent `1920×1080` (`scale: 1`) `WorkerHost` checks in parallel inside the same Chromium page caused one `illus-balloon` surface to fall back from GPU to software rasterisation mid-check (`Non-deterministic draw on frame 90`), which triggered the `kind: "code"` repair path.
   - Fixing `commitBundle` (Seam Bug #4 above) ensures that if a transient browser check triggers a repair, the repaired bundle gets a fresh `bundle_digest` and is re-checked automatically. As a future hardening in `frontend/` (off-limits in this task), serialising `runCheck` across scenes in `PlateLiveStage` (1 check `WorkerHost` at a time instead of 3 in parallel at `1920×1080`) would avoid hitting Chromium's per-page GPU canvas budget during initial multi-scene check.
3. **Production `DATABASE_POOL_SIZE` when using the 15-client Supabase Session Pooler:**
   - The load test measured `17` total Postgres connections (`10` from `pg.Pool` + `4` from `pg-boss` pool + `3` from `pg-boss` `LISTEN`) when `DATABASE_POOL_SIZE` is left at its default of `10`. On the 15-client Supabase session pooler, `DATABASE_POOL_SIZE` must be set to **`5`** (giving `5 + 4 + 3 = 12` active connections and `3` reserve connections).

---

## 10. Manager verification (independent re-check, 2026-11-05)

On a rebuilt stack (`up --build`, live override), run by the manager: `live-e2e.mjs` **108 of 108 assertions** (scenarios A to K); `chaos.mjs` **28 of 28 assertions** (six scenarios), including six workers (10 scenes, each exactly once, zero worker connections to Postgres, API at most 13 connections) and a HyperFrames render through job control (valid 1920x1080 MP4, 370 of 370 frames, worker sockets to 5432: 0). Typecheck clean (backend, frontend); `job-control` test passes. The stack was torn down with the targeted command; the user's Postgres and worker containers were not touched. Not re-run by the manager: the four clip-mode suites of `scripts/plates-e2e/run.mjs` (about 21 minutes) and the load test; those figures are the agent's.
Follow-up found in this run and fixed by the manager (frontend): the browser check could call a healthy scene non-deterministic when three full-size checks ran at once and the browser changed raster path mid-check, which would start a paid repair. `runCheck` now redraws a mismatching frame twice before blaming the scene, and `PlateLiveStage` runs one check at a time per page (test added; frontend suite 169 of 169).
