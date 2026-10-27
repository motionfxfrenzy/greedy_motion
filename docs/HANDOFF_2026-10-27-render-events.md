# Render events: pushed job updates, prep in the job, lean database use

Date: 2026-10-27. Not committed and not deployed. This builds on the create-flow work described in
`docs/qa/2026-10-27-greedymotion-qa-report.md`.

**Status**
- Step 1 is done and tested, including the edge cases and the database-cost work below.
- Step 2 (voiceover and storyboard build inside the job) is planned at the end of this document.

## 1. What is built

### Pushed job updates instead of polling
- **Trigger:** `backend/src/db/migrations/008_render_job_events.sql`.
  - An `after insert or update` trigger on `app.render_jobs` calls `pg_notify('render_jobs', …)` whichever service wrote the row (backend, worker, retries, dead letters).
  - It fires only when something a person would see changed: state, stage, progress, frames_done, attempt or error.
  - The payload is about 200 bytes and holds no private fields: `{id, state, stage, progress, framesDone, framesTotal, attempt, was, reload}`.
  - `reload` is true when the state, stage or error changed, or the row is new.
  - `was` is the previous stage.
- **Hub:** `backend/src/render/events.ts`, the only module that knows where events come from.
  - It holds one `LISTEN` connection per backend replica (`application_name = render-events`, TCP keepalive on). It reconnects with backoff from 1 s up to 30 s.
  - **Progress ticks** are applied straight from the notification: no read.
  - **State, stage or error changes** reload the job once, in one query, for every watcher on that replica. Loads that overlap are combined.
  - **Jobs nobody watches** cost nothing. `observe()` lets server code react to any job's change in memory.
  - When a job leaves `waiting`, watched jobs behind it get their new queue position.
- **Heartbeat** (only while a job is watched):
  - The replica pings itself through the ordinary pool and counts as live only while the ping comes back on its LISTEN connection. Pings go every 15 s and wait 5 s for an answer.
  - This catches a pooler that accepts LISTEN but delivers nothing, and a connection that died without an error.
  - With nobody watching, no pings are sent. The first watcher after an idle spell checks the connection again before trusting it.
- **Fallback:** while pushes are off, one timer per replica reloads each watched job every 3 s. The cost doesn't grow with the number of open pages.
- **Endpoint:** `GET /v1/renders/:id/events` in `backend/src/server.ts`.
  - It sends server-sent events: the job view at once, then a new view after every change, and it closes after `ready` or `failed`.
  - It sends a `: ping` comment every 20 s, which touches no database.
  - Ownership uses the `jobPath` check in `access.ts`. Auth is a Bearer token.
  - Open streams are ended in `preClose`, so shutdown doesn't wait for them.
- **Client:** `watchRenderJob` in `frontend/lib/api.ts` reads the stream with fetch, because EventSource can't send the auth header.
  - If the stream drops, `studio.tsx` polls `GET /v1/render-jobs/:id` every 15 s and reconnects with backoff from 3 s up to 60 s.
  - At Render, the page sets the project's "Rendering draft" state itself instead of reading the project back.
  - The project is read **once, when the render ends**, and again after 1.5 s, 3 s and 4.5 s only while the server still says "Rendering draft". (`render-finished` marks the project a moment after the job.)

### Storyboard prep moved into the job
- `POST /v1/projects/:id/render` now does only these, then returns 202 at once:
  1. Checks readiness (409 if not ready).
  2. Takes the tokens.
  3. Sets `renderJobId`.
  4. Queues the job on `render-plan` with `prep = { kind: 'beat-plan', watermark, motionBlur, ownerId, spendEvent }` (a new column).
- The planning consumer (`RenderService.prepareFilm`):
  1. Sets stage `directing`.
  2. Runs `prepareBeatPlanRender`: motion, build, upload.
  3. Calls `queueRender`.
- Failures:
  - A transient failure retries once (5 s later). Then the dead letter fails the job and **returns the tokens**.
  - A storyboard that stopped passing its checks, or a deleted project, fails at once with a refund.
  - A film that reached the renderer keeps its charge, as before.

### Lean database use (the whole render path, not only events)
Measured on the local stack (one backend, one worker, nobody using it). Database transactions per minute:

| Change | Idle tx/min |
|---|---|
| Before | **491** (about 700,000 a day per environment) |
| pg-boss wakes on NOTIFY instead of every 2 s per consumer (backend) | 208 |
| Same for the worker (`render-video`) | 147 |
| No pg-boss cron scheduler (nothing uses it), no supervision on the worker | 122 |
| pg-boss flow pass every 5 min instead of every 5 s (nothing uses flows) | **73** |

That is 85% less idle traffic, about 105,000 transactions a day.

What changed:
- **pg-boss** (`backend/src/jobs/queues.ts`, `worker/src/worker.mjs`):
  - `useListenNotify: true`, and every queue is `notify: true`. A new job wakes its consumer in 10–40 ms; polling is a 30 s backstop.
  - `schedule: false` on both services, and `flowIntervalSeconds: 300` on the backend.
  - The worker runs `supervise: false`, because the backend supervises every queue.
- **Retries and dead letters** don't trigger a NOTIFY in pg-boss, so the code that causes one wakes the right consumer itself (`RenderService.wake`):
  - The planning consumer wakes when its retry comes due, and the dead-letter consumer right after a failure.
  - A worker failure (stage `retrying`, heard through the hub) wakes the backend's `render-video-dead` consumer.
  - Result: a retry runs on its 5 s delay, not at the 30 s backstop, and a dead letter is handled within about 1 s.
- **Ownership checks** (`backend/src/access.ts`) run on every project, brand and job request.
  - They used to load the **whole project row** (storyboard, frames, motion: often hundreds of KB) just to compare owners.
  - Now they read only `owner_id`: `projectOwnerById`, `brandOwnerById`, `renderJobRepository.owners`.
  - This cuts egress on every project request in the app, not only renders.
- **Legacy job lookups** used to load every project of every user to find the one pointing at an old job. They now read one row with `projectByRenderJob`, without the frames.
- **`renderJobRepository.find`** reads only the columns the page sees. The queue position is counted in the same statement, so it's one query instead of two, with no `request`, `render_input` or `planned_revision`.
- **The page** reads the project once per render instead of on every state change. Before this work it read it every 1.5 s.

## 2. Edge cases, tested

| Case | How it was tested | Result |
|---|---|---|
| Refund after a failed prep | `npm run test:render-prep -w backend` (real Postgres, real queues, about 9 s) | Deleted project: refunded at once. Storyboard no longer ready: `not_ready` and refunded. Unexpected error: one retry 5 s later, then the dead letter fails it with "Your tokens were returned" and refunds. A second dead-letter delivery refunds nothing. A film that reached the renderer keeps its charge. |
| LISTEN delivers nothing (a pooler in transaction mode) | `test/events-faults`: a proxy that drops every NotificationResponse on replica B's LISTEN connection | Heartbeat missed after at most 15 s + 5 s, `render_events_silent` logged, connection replaced with backoff, updates arrive through the 3 s fallback (measured 0.3–3.0 s). |
| LISTEN refused | Same proxy, refusing connections | `render_events_listen_failed`, updates through the fallback (1.5 s), retries with backoff. |
| Recovery | Proxy back to pass | Live pushes again within 3–5 s (`render_events_listening`), watched jobs reloaded once. |
| Connection killed (database restart, network blip) | `pg_terminate_backend` on every `render-events` connection | About 1 s gap, then live again. |
| Several backend servers | Two extra replicas (4001, 4002) beside the main one, three consumers on every queue | Every change reached streams on both replicas (12–27 ms). The refund test passed with three backends competing for its jobs. `ready` closed streams on both. |
| Queue position of the job behind | A second job waiting behind the first | Pushed 1 → 0 when the first left the queue. |
| Progress-tick cost | 20 progress writes while two replicas watched | Both delivered all 21 views with the right values; no reads beyond the 20 writes. |
| Ownership | `/events` for another user's job, an unknown job, no token | 404, 404, 401. |

Bug found and fixed while testing: the job behind another never got its new queue position, because the hub only learned a job's stage after its first change. The view sent on connect now seeds it.

To rerun the fault tests (from `backend/`, with the main backend running):
```
node test/events-faults/proxy.mjs 55433 55432 55434
node test/events-faults/replica.mjs 4001 55433
node test/events-faults/replica.mjs 4002
node test/events-faults/scenarios.mjs
```

## 3. Before deploying
- **LISTEN needs a session connection.**
  - Staging and production use Supabase's pooler on port 5432 (session mode, checked 2026-10-27), which supports it.
  - If `DATABASE_URL` ever moves to the transaction pooler (6543), set `LISTEN_DATABASE_URL` to the session or direct URL.
  - Without either, nothing breaks: pg-boss warns and polls every 2 s, and the hub uses its 3 s fallback.
- **Connections per backend replica:** pool (10) + pg-boss (4) + pg-boss listener (1) + render-events listener (1). The worker uses pg-boss (4) + its listener (1).
- **The migration runs on startup.** 008 is safe to re-apply (`if not exists`, `create or replace`, `drop trigger if exists`).
- **The worker image must be redeployed with the backend.** It expects the queues' `notify` flag, which the backend sets on startup.
- **Owner columns:** the lean ownership checks read the `owner_id` column, which `save()` always writes from `ownerId`. Every local row matches. To check staging and production first:
  ```sql
  select count(*) filter (where owner_id::text is distinct from data->>'ownerId') from app.projects;
  ```
  Run the same on `app.brand_kits`; both should return 0.

**Pre-existing failures, not caused by this work**
- `test:worker-launcher`: the environment guard rejects its `WORKER_LAUNCH=ecs` under `APP_ENV=local`.
- `test/styles.mjs`: the recipe hash, from the older uncommitted `engine.js` edits.

## 4. Do we need Redis?
No. Postgres already carries every job update. One LISTEN connection per replica can serve thousands of open streams, and progress ticks cost no reads.

Move to Redis pub/sub or Supabase Realtime only if one of these happens:
- Events start coming from outside Postgres.
- Commit volume gets high enough that NOTIFY's commit-time lock matters (thousands of writes per second; the worker writes at most once per second per job).
- You run so many replicas that the listener connections become a burden.

Only `render/events.ts` would change.

## 5. Step 2: next session

Goal: the page only clicks Render and listens. All prep happens in the job, and every stage, error included, arrives as an event.

1. **Voiceover and music in the job.**
   - Today `renderFromScript` (studio.tsx) runs `confirmScript` → `recordVoice` (`generatePlanAudio`) in the browser before `POST /render`.
   - Move that into `prepareFilm` as stage `audio` before `directing`. Reuse `backend/src/plan/audio.ts`; takes are cached by line text, so a retry costs nothing extra.
2. **The storyboard build in the job.**
   - Today `buildStoryboard` runs on the client before Render.
   - Let `POST /render` accept a project with `scriptBeats` but no beat plan, or a stale one, and build the plan in the job (stage `planning`) with the storyboard route's director call (backend/src/plan/routes.ts).
   - Readiness is then checked inside the job: not ready means the job fails with a refund.
   - **Decide first:** the cost is unknown until the plan exists. Either charge from the script's estimated length and settle after planning, or charge when the job enters `directing`.
3. **Simplify the client.**
   - Remove `prepping`, `prepStage`, `renderWhenReady` and the sound and scene prep steps from studio.tsx.
   - Build the checklist from job stages only: audio → planning → directing → waiting → preparing → frames → encoding.
4. **Push plan writing too, which is the next-largest remaining database cost.**
   - Script and plan writing still polls `GET /projects/:id` every 2 s while `planning.status === "running"`. That reads the full project row each time.
   - Use the same pattern: a trigger on `app.projects` that notifies when `data->'planning'` changes, a second channel on the same hub, and `GET /v1/projects/:id/events`.
5. **Remaining idle traffic (73 a minute):**
   - Mostly pg-boss backstop polls: 10 backend consumer loops plus the worker's, each every 30 s, plus pg-boss supervision every 60 s.
   - Further cuts would come from fewer loops: `localConcurrency` on `render-plan` starts 4 polling loops, and `render-finished` starts 2. A single loop with a larger `batchSize` would halve this.
