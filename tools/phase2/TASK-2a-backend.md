# Task for the coding agent: phase 2a, backend for live plate scenes

You work for a manager (Claude) who reviews everything you produce. Read this whole file first. Do what it says, nothing more. If a rule blocks you, stop that part and say so in the report; never work around a rule.

## Background (read these first)

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes` (branch `codex/live-scenes`). Read in this order:

1. `docs/LIVE_SCENES_PLAN.md`: sections 0b, 3, 6 (identity part), 7, 8 (only the "Undo" and `plate_revisions` paragraph), 11, 11b, 13 (test plan), 14 (phases), 17, 20. Phase 2 here means the backend half only (2a). The browser half (2b) is a separate later task; do not touch `frontend/`.
2. The existing plate pipeline: `backend/src/plates/store.ts`, `author.ts`, `service.ts`, `routes.ts`, `reconcile.ts`, `model.ts`, `exports.ts`; `backend/src/db/migrations/018_plate_pipeline.sql`; `backend/src/config.ts` (the `plates` block and `plateModel`); `backend/src/jobs/queues.ts`; `backend/src/storage.ts` (`presignKey`); and the tests `backend/test/plate-store.mjs`, `backend/test/plate-model.mjs`.
3. The bundle format: `packages/plate-engine/lib/engine.mjs` (`bundleScene` returns `{ html, manifest }`; the manifest has `sourceSha`, `bundleSha` (a 24-character prefix of sha256 of the html), and, if present, `engineDigest`/`styleDigest`).

## What phase 2a delivers

Today: a plate variant (one scene in one aspect ratio) goes `queued` to `authoring` to `bundled`, and `bundled` immediately enqueues `plate-render` on the worker, which draws an MP4 clip (`drawn`). In the new "live" mode the browser draws the scene, so `plate-render` must NOT be enqueued at `bundled`; the variant becomes playable when the browser reports a passing check (`checked`). The clip path stays as the fallback and as the rollback.

### 1. Configuration (`backend/src/config.ts`, `backend/.env.example`)
- `PLATE_LIVE_PREVIEW`: `"on"` or `"off"`, default `"off"`; any other value throws at startup with a clear message, like `PLATE_PIPELINE` does. Live mode only makes sense when `PLATE_PIPELINE=worker`; if live is `on` and the pipeline is not `worker`, throw.
- `PLATE_LIVE_FORCE_OFF`: `"1"` to enable the explicit rollback override (anything else means off).
- Expose both on the existing `plates` config object. Document both in `.env.example`.

### 2. Migration `backend/src/db/migrations/019_plate_live.sql`
Idempotent (`if not exists`, guarded DO blocks), never destructive, with a comment block stating how to roll back by hand. It must:
- add to `app.plate_variants`: `checked_at timestamptz`, `check_report jsonb`, `bundle_digest text`, `host text`;
- extend the `state` check constraint to allow `'checked'`. The 018 constraint is unnamed, so look it up in `pg_constraint` inside a `DO` block and replace it;
- add to `app.plate_state`: `live_mode text check (live_mode in ('live','clip'))` (null until the project first enters step 3), and `live_mode_set_at timestamptz`;
- create `app.plate_revisions (id uuid pk default gen_random_uuid(), variant_id uuid not null, rev integer not null, bundle_digest text not null, source_key text, bundle_key text, params jsonb not null default '{}'::jsonb, params_digest text not null, author text, created_at timestamptz not null default now(), unique (variant_id, rev))` with an index on `variant_id`;
- create `app.plate_check_reports (variant_id uuid not null, gen integer not null, bundle_digest text not null, host text not null, report jsonb not null, created_at timestamptz not null default now(), primary key (variant_id, gen, bundle_digest, host))` for idempotent, deduplicated check reports;
- make the existing garbage sweep (`plate_garbage`, see `store.ts`) skip object keys referenced by any row of `plate_revisions`. Find where the sweep reads `plate_garbage` and change it there; add a test.

### 3. Identity (`backend/src/plates/digest.ts`, new)
Export pure functions with unit tests:
- `canonicalJson(value)`: key-sorted, stable JSON (arrays keep order).
- `paramsDigest(params)`: sha256 hex of `canonicalJson(params ?? {})`.
- `fontSetDigest()`: sha256 of the string `"fonts:none"` for now (a single place to change when fonts are embedded later).
- `bundleDigest({ bundleSha, params, engineDigest })`: sha256 of `[bundleSha, paramsDigest(params), fontSetDigest(), engineDigest ?? "engine:unknown"].join("|")`. Use the full bundle hash if the manifest has it; otherwise the manifest's `bundleSha` as given.
- Required properties (tested): same inputs give the same digest; params in any key order give the same digest; a changed param changes it; `variantSignature` is not an input and is untouched.
- When a variant becomes `bundled`, record its `bundle_digest` (in the same fenced update that sets `bundle_key`), and write revision 0 into `plate_revisions` (params `{}`) in the same transaction.

### 4. Mode decision and the state machine (`store.ts`, `service.ts`, `reconcile.ts`)
- Mode is decided **once per project, when the project first enters step 3** (that is `startPlates` in `service.ts`, the first call that creates variants): if `plate_state.live_mode` is null, set it to `'live'` when `config.plates.live` is on, else `'clip'`. It is **never changed by a later flag flip**. Use an atomic `update ... where live_mode is null`.
- When a variant reaches `bundled` and its project is `live`: set state `bundled`, do **not** enqueue `plate-render`. When the project is `clip` (or mode is null): behave exactly as today.
- `bundled` stays the state until a fenced check report arrives (section 5); then `checked`.
- A `checked` variant counts as playable in `plateStatus` (add fields: `mode`, and per scene `variantId`, `bundleDigest`, `live: boolean`), and must NOT be treated as "needs rendering" by the reconciler while the project is `live`.
- Editing a scene (`reviseScene`, which bumps `gen`/`rev` and resets to `queued`) must reset `checked` variants too: the old check report no longer applies (fenced by `gen`).
- **Rollback override:** when `config.plates.liveForceOff` is on, the reconciler (`reconcile.ts`) sets `live_mode='clip'` for every project that is `live`, treats `checked` like `bundled`, and enqueues `plate-render` for every `checked` or `bundled` variant of those projects, rate-limited (at most 20 enqueues per reconciler pass) and honouring the existing per-project cap. Idempotent: running it twice enqueues once per variant (use the existing transactional enqueue helpers and singleton keys).

### 5. HTTP routes (`backend/src/plates/routes.ts`)
Follow the style of the existing routes (uuid validation, 404 body `notFound`, errors as `{ error: { code, message } }`). Ownership is already enforced by the global access hook for every `/v1/projects/:id` route; also verify in the handler that the variant belongs to the project in the URL.
- `GET /v1/projects/:id/plates/:variantId/bundle` returns `{ url, expiresAt, bundleDigest, manifest, params }`. `url` is a presigned link to `bundle_key` (use `presignKey("outputs", key, { seconds: 900, contentType: "text/html" })` or whatever bucket class the existing bundle uploads use; check `author.ts`), `expiresAt` an ISO timestamp, `params` the current revision's params (`{}` today). 404 unless the variant is in `bundled`, `checked`, `rendering` or `drawn`. `Cache-Control: no-store`.
- `POST /v1/projects/:id/plates/:variantId/check` with body `{ gen: number, bundleDigest: string, host: string, device?: object, results: object }`.
  - Validate shapes and sizes (`host` one of `worker` only for now; `device` and `results` each at most 16 KB serialised); 400 on bad input.
  - **Fenced:** the report applies only if the variant's `gen` and `bundle_digest` equal the report's and the state is `bundled`. A report for another `gen` or digest, or for a variant in another state, is dropped with HTTP 204 and an info log line, changing nothing.
  - **Idempotent:** the same `(variant_id, gen, bundle_digest, host)` twice returns the same answer and writes one row in `plate_check_reports`.
  - `results.ok === true` moves the variant `bundled` to `checked` (set `checked_at`, `check_report`, `host`) and returns 200 `{ state: "checked" }`. `results.ok === false` with `results.kind === "code"` triggers the **existing bounded repair path** exactly as a worker verification failure does today (look at how the worker's failure is handled in the store and reuse that function; do not invent a second repair loop); `kind === "env"` (the device could not draw) changes nothing and returns 200 `{ state: "bundled", fallback: true }`.
  - A client report can never move a variant to `drawn`, and never works for a project in `clip` mode (409 `{ code: "not_live" }`).
- `POST /v1/projects/:id/plates/:variantId/clip-request` (the clip fallback: "draw a preview video for this scene"): for a `bundled` or `checked` variant enqueues `plate-render` once (idempotent), returns 202 `{ state: "rendering" }`; 404/409 otherwise. Cap the number of clip requests that may be queued or running per project at 4 (`PLATE_PROJECT_CLIP_CAP`, default 4, add to config); beyond that return 429 `{ code: "clip_cap" }`.
- Existing routes keep their behaviour in `clip` mode.

### 6. Tests (required; they are the acceptance criteria)
Put them in `backend/test/` as new files, in the style of `plate-store.mjs` (real Postgres and pg-boss; hermetic; clean up the rows and queue jobs they create; the DATABASE_URL guard that refuses non-throwaway databases):
- `plate-digest.mjs`: all digest properties in section 3, including "a params-only change changes `bundleDigest` while the variant signature is untouched" and "a font-set change changes the digest".
- `plate-live.mjs`: state machine. With live on: variant reaches `bundled`, zero `plate-render` messages; a valid check report moves it to `checked`; with live off: `bundled` enqueues exactly one `plate-render` as before. Fencing: stale `gen`, wrong digest, wrong state, forged host all dropped with no change; duplicate reports idempotent (one row); `kind: "code"` failure starts the existing repair path once; `kind: "env"` changes nothing; edit (`reviseScene`) after `checked` resets to `queued` with `gen + 1` and invalidates the old report; a client can never reach `drawn`. `live_mode` is decided once and a later flag flip does not change it (test by running the decision function with the config flipped).
- `plate-rollback.mjs`: with force-off on, a `live` project's `checked` and `bundled` variants each get one `plate-render` message, `live_mode` becomes `clip`, a second pass enqueues nothing more, the 20-per-pass limit holds, in-flight authoring is untouched, `drawn` variants are untouched.
- `plate-revisions.mjs`: revision 0 is written when a variant becomes `bundled`; objects referenced by a revision survive the garbage sweep, unreferenced superseded ones are still swept.
- `plate-live-routes.mjs`: the three routes through HTTP using Fastify's `app.inject`, registering `registerPlateRoutes` on a bare Fastify app (stub whatever the access hook provides if needed): bundle route returns a url and manifest and 404s in the wrong states and for a variant of another project; check route validation (400), fencing (204), idempotency; clip-request idempotency and the cap (429).
- The existing tests must still pass unchanged: `plate-store.mjs`, `plate-model.mjs`, and every other test in `backend/test/` that passed before. Run the full set before you start (record the baseline) and after.

How to run (local throwaway Postgres is already up on localhost:55432; database `plates_unit` exists; if it does not, create it with `docker exec videosaas-local-postgres-1 createdb -U videosaas plates_unit`):
```
cd /Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/backend
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-store.mjs
```
(the same pattern for each new test). Node here is v26; look at how `backend/package.json` runs its tests and keep the same convention. Add the new tests to the repo's test script if there is one.

## Rules (hard limits)
- Edit or create files ONLY in: `backend/src/plates/`, `backend/src/db/migrations/019_plate_live.sql`, `backend/src/config.ts`, `backend/.env.example`, `backend/src/jobs/queues.ts` (only if a new queue option is needed, and say why), `backend/test/`, `backend/package.json` (test script only), and `docs/phase2/`. Do NOT touch `frontend/`, `worker/`, `packages/`, other worktrees, or the main folder `/Users/osamaehsaan/Code/Market_apps/VideoSaaS`.
- No `git commit`, no `git push`, no deploys, no cloud, AWS, Railway or Supabase calls. Use only the local throwaway Postgres on localhost:55432. Never run anything against staging or production databases. Never read or print secrets or `.env` files.
- Do not weaken, skip or delete any existing test. Do not edit a test to make it pass; if an existing test fails because of your change, fix your change, and report it.
- Do not change the meaning of the existing states or routes for projects in `clip` mode.
- Do not add dependencies.
- Keep changes small and consistent with the surrounding code style (TypeScript with Node strip-types: no constructor parameter properties, no enums; explicit imports with `.ts` extensions).
- If anything in this brief contradicts the code you find, follow the code's reality for how things work, keep to this brief's intent, and write the contradiction in the report.

## Deliverable
Write `docs/phase2/2a-report.md` containing: (1) the list of files you created and changed with one line each; (2) the exact commands you ran and the pass/fail count per test file, before (baseline) and after; (3) every decision you made where the brief was silent, with the reason; (4) every deviation from the brief and why; (5) open questions and risks you noticed; (6) the exact request/response shapes of the three new routes as implemented. Then print `DONE` and the report path on a line by itself.
