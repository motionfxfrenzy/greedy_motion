# OpenCode implementation handoff: bounded draft playback and full-quality stills

> Scope update: section 13 below is authoritative for all-style Draft support and shape preservation. It supersedes earlier recommendations to defer draft support for currently fast native kits. Read it before continuing implementation.

Prepared 2026-11-06. Status: implementation plan, not an implementation or deployment report.

## 1. Assignment and final product decisions

Integrate the measured draft geometry technique into the application's actual plate preview. Build and test locally in an isolated worktree, produce a reviewable patch and evidence, and stop before deployment. Do not merely update the benchmark comparison page.

The owner's latest decisions supersede conflicting experimental briefs and older playback plans:

1. Browser playback defaults to **Draft**, with a small bounded buffer of upcoming draft frames.
2. When intentionally paused, display **one full-quality still at the same frame**, after a 250 ms debounce. Keep the existing picture visible while preparing it.
3. Scrubbing uses draft while moving, then upgrades the settled paused frame. Scrubbing during playback resumes according to existing transport behavior, without a transient full-quality upgrade.
4. The user can explicitly select **Full** playback. Buffer locally if full rendering cannot keep up. Never silently change the user's Full selection back to Draft.
5. **Do not request AWS rendering because Draft or Full playback is slow, because Full was selected, or because a pause still is taking time.** AWS final export remains full quality.
6. Preserve existing unsupported-browser, verification-failure, and worker-crash handling unless a change is required and documented. This assignment does not authorize removing those established recovery paths or broadening them to ordinary slowness. Distinguish normal buffering from a true hung/crashed worker.
7. Memory must remain bounded. Release obsolete images, jobs, workers and engine caches. At film end keep the displayed final picture, release playback buffers, and stop producing frames. On preview closure release everything owned by that preview.
8. Redrawing evicted frames on replay is acceptable. The new Draft path does not promise the older 'draw once forever while stored' behavior. Do not silently remove the legacy Full store or unrelated persistent data.

Do not introduce automatic AWS performance fallback, continuous full-quality background rendering, global scene-object deletion to meet a budget, or a renderer framework migration.

## 2. Project context and safe starting point

The application has a Next.js/React frontend, a backend that manages plate authoring/bundles and render jobs, a vendored anidoodle-based `packages/plate-engine`, and an AWS worker for final rendering. Other preview/rendering paths, including HyperFrames, coexist with plates and must continue to work.

Known inspected integration checkout:

- `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-integrate`, clean when inspected, HEAD `453f10c`.
- Its plate engine package is `0.6.5`. Node requirement is `>=24`.
- Treat these as inspected local facts, not proof of the latest remote deployment. Verify the actual intended integration base and record its SHA before coding. Do not fetch/deploy or switch shared checkouts just to match an old statement.
- `/Users/osamaehsaan/Code/Market_apps/VideoSaaS` has substantial unrelated uncommitted work. Do not reset, stash, overwrite, or incorporate it.

Create a fresh worktree/branch under `codex/` from the verified integration base. Read applicable `AGENTS.md`, package scripts, and current implementation first. Do not edit experiment worktrees or interrupt their sessions. If git/worktree operations need environment approval, use the normal approval mechanism; do not bypass it.

Read these historical project documents in the integration checkout, but apply section 1 of this brief where policies conflict:

- `docs/HANDOFF_2026-11-05_PLAYBACK.md` (contains dated and superseded status updates).
- `docs/LIVE_PLAYBACK_PLAN.md`.
- Relevant live-scene, re-bundling, worker-sandbox, and audio documentation referenced there.

### Existing source map

Paths below are relative to the implementation worktree. Confirm symbols before editing; line numbers are intentionally omitted.

| Area | Existing location | Required responsibility |
| --- | --- | --- |
| Geometry generation | `packages/plate-engine/src/canvas-core/core.ts` | Draft-only pre-allocation simplification around `Gfx.pen`/ribbons; full default unchanged |
| Hatching | `packages/plate-engine/src/canvas-core/gallery.ts` | Draft hatch sampling; preserve generic `keep` callback semantics |
| Engine host | `packages/plate-engine/src/hosts/page.ts` | `FILM.seek`, quality context, separate scene caches, capability reporting |
| Worker containment | `frontend/lib/live/worker-host.ts` | Quality-aware frame requests, response ownership, lifecycle/watchdog behavior |
| Preview scheduling | `frontend/lib/live/plate-player.ts` | `PlatePlayer`, film coordination, render queue, buffer, mode transitions, still upgrades |
| RAM cache | `frontend/lib/live/frame-cache.ts` | Byte accounting, quality-aware keys, eviction/close, shared film budget |
| Persistent store | `frontend/lib/live/frame-store.ts` | Existing WebP storage/quality jobs; prevent draft/full mixing and serial critical-path work |
| Timing/audio | `frontend/lib/live/clock.ts` and existing audio timeline modules | Preserve one film clock and synchronized buffering |
| Support/budgets | `frontend/lib/live/support.ts` | Existing feature detection, preview sizing, memory budget resolution |
| App integration | `frontend/components/plate-live-stage.tsx`, `frontend/lib/live/live-stage-logic.ts` | Player construction/update/teardown and existing fallback routing |
| Preview controls | `frontend/components/animation-workspace/OptionsBar.tsx`, `types.ts`, and actual owning component | Add render mode without confusing WebP compression quality |
| Export | `worker/src/plates.mjs`, `packages/plate-engine/lib/capture.mjs` and actual callers | Full-quality default and explicit full-quality capture where supported |

Current pitfalls identified in the inspected code:

- `saveAndDecodeForWindow` can serialize drawing, WebP encoding, storage, read and decoding before display. Draft's fast path must bypass that sequence.
- The existing Preview quality control means stored WebP Low/Standard/High (0.2/0.4/0.6), not geometric Draft/Full.
- Existing cache keys do not encode the proposed draft profile. Add that identity deliberately; do not relabel old full keys as draft.
- `FrameCache` already has byte accounting, `release`, `drop`, `clear`, and bitmap closing. Reuse and strengthen it rather than adding an unrelated cache system.
- Current eviction permits a newly inserted single frame larger than the budget. Define and test oversized-frame admission instead of claiming the existing behavior is a strict bound.
- `WorkerHost` executes model code in a Worker inside an opaque-origin sandboxed iframe with a restrictive CSP. Preserve this boundary. Its lifecycle includes scene-boundary/age recycling and a watchdog; do not weaken those protections to hide slowness.
- Background pumping and WebP quality jobs already exist. They must not compete with the new Draft path or restart after cleanup.

## 3. Evidence and reference artifacts

Use these as read-only source material, not a patch to copy wholesale:

- Baseline: `/private/tmp/gm-live-preview-benchmark`, benchmark commit `5f16d7d`; results `/private/tmp/gm-live-preview-results`.
- Geometry experiment: `/private/tmp/gm-draft-geometry-readiness`; report `docs/benchmark/geometry-production-decision.md`; prototype `tools/benchmark/draft-geometry-player.ts`; results `/private/tmp/gm-draft-geometry-results`.
- Earlier hatch experiment: `/private/tmp/gm-draft-preview-experiment`; results `/private/tmp/gm-draft-preview-results`.
- Authentic style investigation: `/private/tmp/gm-native-style-fps`; results `/private/tmp/gm-native-style-fps-results`. Verify completion and provenance before using results; this handoff does not assert completion.
- Exact private six-scene fixtures: `/private/tmp/gm-live-preview-results/private-fixtures/scene0..5.html|json`. Do not commit/upload private fixtures or credentials.
- Target project: `e9ce7b08-759d-4604-a277-a2b9ec8763fc`, 1,050 frames, 35 seconds at 30 fps. Staging URL: `https://staging.greedymotion.com/studio?p=e9ce7b08-759d-4604-a277-a2b9ec8763fc&step=2`.

Snapshot only needed experiment sources into an implementation-owned reference location, recording source SHA if committed, file hashes, timestamp and dirty status. Other sessions may still be editing them. Avoid reading half-written files or committing private output. Preserve raw reports unchanged.

### What was actually demonstrated

On the measured local M1 Pro/Chromium setup, the geometry experiment reported:

- Existing pipeline: 87.869 s median for the 35 s film, 4.411 s startup, six buffering pauses.
- C1 draft: 35.965 s, 0.963 s startup, zero mid-scene pauses across three runs.
- C2 draft: 35.850 s, 0.849 s startup, zero mid-scene pauses across three runs.
- Slow scene index 3: full 86.85 ms median / 108.2 ms p95; C2 11.60 ms / 13.9 ms.
- C2 six-scene warm p95 ready-frame costs were under 25 ms in that sample.

The slow scene's dominant work was `Gfx.pen` ribbon construction/rasterization, approximately 632,712 vertices/frame, not warm `hatchRuns` execution. Hatch factor alone did not solve it. WebP processing added substantial critical-path work separately.

Candidate profile parameters reported: 75k target geometry budget, per-stroke 48-vertex cap, `samplePer=2`, `densifyStep=6`, `outlineTolerance=0.8`, retrace skip, hatch step factor 3 with collinear subdivision. C1 hatch gap factor 1; C2 1.25. These are experimental starting values, not universal production guarantees. Verify exact units/implementation from the source. The 75k value is a target, not a proven hard maximum: per-object minimums and changing scene complexity can exceed it.

C1 preserves hatch coverage better; begin visual comparison with it. Use C2 only if visual review accepts the detail reduction. Performance is not the only acceptance gate.

Limits: results do not certify Windows, Safari, mobile, all generated styles, or AWS parity. Raw replay took roughly 38 s; bounded memory means redraw. Optional draft persistence was incomplete (some frames redrawn). Generic analytical hatch clipping failed prior identity checks and is outside this implementation. Do not use the flat crayon-to-brick regex reskin as evidence for authentic toyBrick performance.

## 4. Proposed user experience and state model

Keep user intent separate from transient rendering state:

- `renderMode`: Draft or Full, default Draft.
- Transport: paused, playing, buffering, ended, error, disposed.
- Still upgrade: idle, pending, ready, failed; it does not change the user's render mode.
- Internal frame identity: bundle/revision, actual dimensions, frame index, full/draft profile and profile version.

Use the project's naming conventions; these are concepts, not mandatory API spellings.

| Event | Required behavior |
| --- | --- |
| Open preview | Render initial draft picture promptly; settle to one full still when paused; no full-film background generation |
| Play in Draft | Invalidate still-upgrade request, prepare a bounded draft runway, then start/resume existing film clock |
| Intentional Pause | Freeze at exact playhead, stop lookahead, debounce 250 ms, request one full frame |
| Buffer underrun | Hold last picture and pause picture/audio time together; fill bounded buffer; do not mistake buffering for an intentional pause upgrade |
| Scrub | Coalesce seeks; latest draft target wins; upgrade only once transport has settled paused |
| Select Full | Keep playhead/audio state; invalidate incompatible queued work; fill full-quality buffer locally; show buffering if needed |
| Select Draft | Same position, return to draft buffer; no outstanding full result may overwrite it |
| Film end | Optionally complete one final full still, then release buffers and rendering workers; do not restart lookahead |
| Revision/aspect change | Reject old results, release invalid entries and worker state, initialize correct new identity |
| Close/navigation/unmount | Idempotent full teardown, including pending callbacks and audio resources owned by preview |

Controls: use `Playback quality: Draft / Full`, or equivalent clear wording. Draft tooltip: faster preview with reduced detail; export stays full quality. Full tooltip: may buffer on this device. Paused status may say `Full-quality still` only after the actual full frame arrives. Full quality here means full scene detail at preview dimensions, not a claim of 1920x1080 pixels on a 640x360 canvas.

Do not map Draft/Full to the WebP numeric quality setting. For the new raw Draft path, hide/disable the irrelevant stored-quality control or label it separately where relevant. Preserve legacy preference values and avoid triggering old `QualityJob` on a render-mode change. Scope the new control to plates; preserve HyperFrames options and 400 px responsive layout, keyboard access, focus and screen-reader labels.

## 5. Engine and worker contract

1. Add a backward-compatible quality option to the render request/host seek path. An omitted option always means full quality. Expose capability/profile version so the client knows whether an older immutable bundle supports draft.
2. Apply geometry simplification before costly allocations. Preserve all scene objects, text meaning, primary geometry, alpha/layer ordering and deterministic seeded behavior. Never stop drawing after a global counter is exhausted.
3. Separate `env.cache` for full and draft profiles. Audit other caches (bakes, paths, global module caches) for quality dependence. Two Maps alone are not proof that every cache is safe.
4. Scope any global draft context with `try/finally`, restoring it even after exceptions. Only one draw executes at a time within a worker; profile state may not leak between requests.
5. Use a stable profile per scene/session initially. Do not change geometry density frame by frame based on instantaneous timing. Document target overshoot and unsupported helpers honestly.
6. Carry request generation, frame identity and mode through replies. Drop and close stale successful replies. Reject obsolete promises cleanly.
7. A generation token cancels delivery, not synchronous CPU work already running. A full pause draw may still block its worker after Resume. Measure this; prioritize playback as soon as it completes, or recycle that worker under an explicit tested policy. Do not claim cancellation preempts rendering.
8. Preserve sandbox/CSP, asset loading, determinism checks, error paths and watchdog. Do not run scene code on the main thread. A costly legitimate Full frame is not automatically evidence of a crash: characterize it against current watchdog behavior and report any conflict requiring a policy change.
9. Keep capture/export defaults full and add explicit full requests where supported. Draft state, cache contents or browser preferences must never affect export. No change to authored scene source is required.

Older bundles must remain playable: if draft capability is absent, show a truthful legacy/full buffering state; do not claim draft acceleration. Document rebundling required to obtain the new engine. Never overwrite content-addressed objects or frozen export references.

## 6. Scheduler, buffering and ownership

Integrate with the current film player and exclusive draw queue. Do not install the benchmark prototype as a parallel production player.

Scheduling order:

1. Latest user seek / active frame needed for presentation.
2. Active playback runway.
3. Small next-scene head buffer when affordable and near the boundary.
4. One full paused still, only while intentionally paused.

No full-quality background film pass. No uncontrolled worker per mounted scene. Prefer one active rendering worker, with tightly bounded sequential next-scene preparation if the current design needs it. Inspect hidden/mounted canvases to ensure they do not each draw independently.

Draft fast path: worker bitmap -> validated RAM cache -> canvas. Do not require WebP encode, IndexedDB save/read, or decode before presenting. Default new Draft mode to RAM-only for this release. Optional persistent draft storage is deferred; its added complexity and incomplete benchmark replay are not needed to deliver this feature.

For Full mode, reuse safe existing full records when appropriate, but distinguish lossy stored preview frames from an exact freshly drawn still. A pause upgrade must render full from code unless an exact matching full bitmap already exists. Ensure legacy background compression does not compete with playback; measure and bound any retained Full storage path. Do not purge existing IndexedDB data merely because a playback run ended.

Initial tuning proposal, subject to measurement:

- 15 frames (0.5 s at 30 fps) nominal lookahead; grow toward 30 only within the shared byte budget.
- Small backward window (e.g. 2–3 frames), plus displayed frame and tightly bounded in-flight results.
- One outstanding draw per active worker; coalesce pending seeks rather than enqueueing every pointer event.
- Calculate startup/rebuffer threshold from measured end-to-end frame-ready rate, available contiguous frames and memory capacity. Do not wait for a threshold larger than cache capacity or remaining scene length.
- Use hysteresis between low-water and resume levels to avoid immediate buffer oscillation. Freeze the same film clock while buffering.
- A renderer slower than 30 fps indefinitely cannot be made stall-free by a finite small buffer. Permit repeated buffering in Full or unusually heavy Draft scenes; never promise otherwise, silently drop required frames, or enqueue AWS.

Record ready-frame cost including geometry, raster/readback, transfer and presentation preparation. Do not remove the existing raster flush solely to improve reported timing. Separate genuine render speed from presented unique frames and total timeline wall time.

## 7. Memory budget and cleanup specification

Use one budget for the entire mounted film preview, not a separate budget per scene. Build on `resolveCacheBudgetBytes`; inspect its existing bounds first. Add an explicit conservative total for retained frame buffers (initial target up to 32 MiB if compatible with existing lower limits), with reservations for current display, one full upgrade and in-flight work. Report it as estimated owned image bytes, not total browser/GPU memory.

At 640x360, one RGBA frame is 921,600 bytes (~0.879 MiB); 30 frames are ~26.37 MiB before overhead. At 1920x1080, one frame is ~7.91 MiB. Compute `width * height * 4` using actual preview dimensions; never assume frame count alone bounds memory. Do not render 1080p pause stills by default.

Before admission, reserve capacity for the incoming image. Evict expendable entries first. If one image cannot fit, choose a documented supported smaller preview size or report a bounded failure; do not grow the cache silently. Pinned scenes cannot defeat the byte limit. Include image copies, encoder queues if retained, canvas backing surfaces and decoded assets in the resource audit, while distinguishing estimates from measurable counters.

Define ownership explicitly:

- Each bitmap has one owner at a time: request result, cache, display transfer, or encoder copy. Document where ownership moves.
- `drawImage` and `transferFromImageBitmap` have different ownership semantics; audit the actual blit API before closing or reusing a bitmap.
- Close evicted, stale, rejected, superseded and unused bitmaps exactly once. Acquire queue capacity before creating any copy.
- Bound worker geometry caches as well as host images. A frame-budget cache does not bound `env.cache`, bakes, assets or arbitrary model allocations. Preserve worker recycling and release inactive workers.

Lifecycle expectations:

| Lifecycle | Cleanup |
| --- | --- |
| Frame consumed | Evict beyond backward window; retain only useful runway |
| Pause | Stop lookahead; trim to a very small useful draft runway if desired; budget full still separately; no continuing idle render loop |
| Resume | Release full still bitmap after replacement; cancel pending upgrade delivery |
| Scene boundary | Drop obsolete images, release old scene worker/engine state; retain only bounded next/current assets |
| Revision/profile/aspect change | Invalidate generation and quality keys; close old images; discard old worker caches |
| Hidden tab | Suspend production and transport using existing lifecycle policy; cancel pending upgrades; revalidate on visibility return |
| Film ended | Keep canvas final picture, release all cached/in-flight images after settling, terminate idle render worker; replay recreates state |
| Preview unmount/project switch | Cancel timers/RAF/jobs, dispose listeners/ports/iframe/workers, revoke owned Blob URLs, release surfaces/assets, close owned storage handles and audio resources |

Holding the picture on a regular canvas usually does not require retaining its source bitmap; verify actual display semantics. Cleanup must be safe if called twice or while startup/draw/decode is resolving. No late result may repopulate the cache after teardown. Do not call a global IndexedDB clear or delete other projects' data. Browser garbage collection and GPU release timing remain browser-controlled; demonstrate bounded ownership and absence of growth, not an instant RSS drop.

## 8. Implementation sequence and review checkpoints

### Phase A — baseline and design reconciliation

Record integration SHA, clean/dirty state, tool versions, current tests and actual player construction path. Audit old profile/store/autoPump/quality-job interactions. Snapshot experiment references. Produce a short design note listing changed APIs, cache identities, worker ownership and compatibility strategy before code changes. Do not import unrelated experimental changes.

### Phase B — engine quality support

Port only reviewed geometry-profile changes and host context/cache isolation. Add targeted invariance, exception and draft-profile tests. Validate full-quality identity before touching UI. Update engine version/manifest through repository tooling if required; no hand-edited generated digest guesses.

### Phase C — cache and worker protocol

Implement quality-aware identity and admission/reservations. Add ownership counters in test/dev instrumentation, stale-result disposal, request epochs and explicit release hooks. Maintain backward compatibility with old bundles and existing host call sites.

### Phase D — production player integration

Add Draft/Full render mode, raw draft fast path, bounded runway, clock-consistent buffering, coalesced seeks and pause upgrades. Disable conflicting background work for the new path. Implement end/unmount/revision/hidden-tab cleanup. Ensure React updates do not recreate the entire film unnecessarily.

### Phase E — actual controls and project flow

Wire the setting through owning component -> workspace controls -> live stage -> film player. Keep existing WebP preference distinct. Verify pause/play/scene selection/timeline scrubbing/aspect selection/comments or revision updates and final-export entry points in the real application. Preserve plate versus HyperFrames routing.

### Phase F — local verification and performance

Run the test matrix below, collect raw traces and screenshots, and compare actual app behavior with baseline. Fix issues before declaring readiness. An isolated demo passing is insufficient.

### Phase G — reviewable delivery, then staged rollout proposal

Deliver focused patches, report, commands, evidence and remaining limitations. Do not push, merge, deploy, request paid AWS renders, migrate databases or rebundle staging/production as part of this local assignment. Prepare exact deployment/rebundle/rollback steps for later authorization. Do not make a production-ready claim if visual approval or device evidence is missing.

## 9. Verification matrix and acceptance gates

Use repository test scripts and inspect prerequisites. Existing relevant tests include:

`frontend/test/live-cache.mjs`, `live-worker-host-unit.mjs`, `live-plate-player.mjs`, `live-scheduler.mjs`, `live-frame-store.mjs`, `live-clock.mjs`, `live-stage-logic.mjs`, `live-stage-leak.mjs`, `live-chrome-integration.mjs`, `live-predraw.mjs`, `live-predraw-chrome.mjs`; engine `test/engine.test.mjs` and `test/inside-identity.mjs` where present. Check current filenames before running.

Core commands from the inspected project:

```sh
npm run typecheck --workspaces --if-present
npm test -w @videosaas/frontend
npm test -w @videosaas/plate-engine
npm run manifest:check -w @videosaas/plate-engine
npm run build -w @videosaas/frontend
```

Run additional backend/export/sandbox checks appropriate to touched files. Record pre-existing failures separately with baseline evidence; do not assume historical failures still apply. Do not update goldens to hide full-output changes.

Required behavior tests:

- Default Draft; explicit Full preserved; compression setting stays independent.
- Draft/full/exception/draft/full sequences produce correct isolated caches and baseline full hashes.
- Pause followed rapidly by Resume/Seek/Full toggle/revision/unmount never paints a stale still.
- Buffering never triggers a full pause render. Debounce generates one latest-frame request, not a backlog.
- Repeated seeks, cross-scene seeks, backward replay, scene transitions, final frame, last partial buffer and loop behavior retain correct timestamps.
- Voice/music/SFX pause and resume together; active SFX on seek and repeated buffering do not drift or duplicate. Test hidden tab, device sleep/resume and autoplay restrictions.
- Draft and Full slowness issue zero new `clip-request` calls. Separately verify existing true unsupported/crash handling without triggering paid jobs (mock route appropriately).
- Full-pause frame is genuinely full detail at preview dimensions, not a draft bitmap or lossy frame relabeled Full.
- Old bundle without capability remains usable with truthful state; invalid options cannot corrupt quality state.
- Cache/in-flight byte limits, oversized frames, pinned entries, stale results, repeated destroy, worker initialization races, pending decode/store completion and encoder copies if applicable.
- Ten open/play/pause/seek/close cycles: resource counters return to baseline; after film end no queued rendering continues. Observe browser memory trends without asserting GC timing.
- IDB unavailable/quota errors and missing persistent records do not break RAM Draft playback or trigger AWS performance fallback.
- Sandbox network restrictions and existing renderer verification remain enforced.
- At 400 px and desktop widths in light/dark modes, controls stay reachable and don't regress other renderer layouts.

Full-output gates:

- Compare local full capture against matched baseline at preview and 1920x1080 export dimensions, including before/after draft and exception sequences.
- Cover all six target scenes with beginning/middle/end/peak-detail frames; built-in style smoke/identity coverage as available, with no silent skips.
- Use matched environment/warm-up and old-vs-old controls for GPU nondeterminism. Report unexplained differences as failures, not approved variance.
- Authentic generated styles require native geometry and visual review; built-in smoke tests alone do not validate arbitrary model scenes.

Performance gates and reporting:

- At least three alternating baseline/candidate full-film runs on the same machine, dimensions and fixture versions; one active preview and one measurement process.
- Acquire `/Users/osamaehsaan/Code/Market_apps/.lock-timing` atomically with an owned marker before timing. Never steal/remove another owner's lock. Release only your own. If unavailable, do independent work and report the timing block.
- Test cold first play, replay after end cleanup, mid-scene seek, Full mode, mode changes, pause still latency, 9:16, and long/dense scenes. Profile geometry-heavy, image-heavy, transparent and text scenes.
- Include real available browser/device tests. Explicitly label simulated slowdown; opaque worker behavior is not faithfully represented by main-thread CDP throttle alone. Missing Safari/mobile/Windows evidence limits the rollout claim.
- Same-machine initial target: Draft startup around <=1 s and no mid-scene pauses on the target film, with warm p95 frame-ready cost preferably <=25 ms for 30 fps headroom. These are targets, not guarantees; report all runs and deviations. Test final small buffer policy, not just the old 90-frame prototype.
- Report initialization, first picture, Play-to-first-advance, draw/raster/transfer/ready p50/p95/max, unique frame presentation count, missed frames, buffering count and duration, scene-boundary waiting, total wall time, pause upgrade latency including debounce, cache/in-flight peak bytes and resource counts after teardown.
- Distinguish presentation cadence from reciprocal median draw cost. Show duplicates/skips and audio drift. No 'zero stalls' claim if the clock pauses at boundaries but those pauses were excluded.
- Full mode may be slower; acceptance is correct buffered playback and synchronization, not 30 fps production throughput. Draft visual artifacts, disappearing shapes or changing story content fail even if fast.

## 10. Rollout and compatibility plan to prepare

Keep the new path behind a scoped plate-preview feature flag, preserving the legacy path for rollback. Prefer existing flag infrastructure; avoid adding a service solely for this. If implemented as a `NEXT_PUBLIC_*` build-time flag, explicitly document that rollback requires a frontend rebuild/deploy. Do not call it an instant runtime switch.

Record engine source/version/digest changes and which bundles need rebundling. Prepare an immutable revision workflow: new bundle first, verification, then preview reference switch; preserve frozen export manifests and old assets. A browser deployment alone cannot add engine behavior to old bundled scene code. Confirm worker compatibility without changing AWS output quality.

Proposed rollout after review: authorized staging integration -> visual review of C1/C2 and real app behavior -> limited supported browser cohort -> broader rollout after device evidence. Keep feature-flag rollback and old bundles available. No database migration or billing change is expected; explain any discovered need before expanding scope.

## 11. Required OpenCode deliverables

Write `docs/benchmark/draft-preview-integration-report.md` in the new worktree containing:

1. Exact base SHA, branch/worktree, source snapshot provenance and changed-file summary.
2. Final architecture and API/cache changes, chosen profile and reasons, lifecycle ownership table.
3. Every acceptance item marked pass/fail/not tested with evidence; no silent skips.
4. Commands, exit codes, logs, raw JSON traces, representative full/draft stills and motion comparisons, actual app screenshots.
5. Per-run before/after table and memory/resource results, including replay after cleanup and user-selected Full mode.
6. Confirmation that slowness does not call AWS, full export defaults remain intact, and sandbox/audio/revision behavior is preserved.
7. Known limitations, device coverage, unresolved visual decisions, and explicit recommendation: blocked / local-ready / staging-ready. Production readiness requires the later authorized validation, not just the benchmark.
8. Precise staging rollout/rebundle/rollback instructions, with operations requiring later authorization clearly separated from completed local work.

Store bulky local evidence under a new implementation-owned `/private/tmp` directory. Do not overwrite earlier results. Exclude private fixtures, secrets, session credentials and generated dependency trees from git. Do not auto-commit or deploy implementation; leave a reviewable diff unless the coordinator explicitly authorizes commits.

## 12. Dispatch text

Use a new OpenCode Gemini Argon session in the isolated implementation worktree. Do not resume a still-running experiment session or pass `--auto`. Read this entire brief before making changes.

Suggested task message:

> Implement the bounded Draft playback + full-quality paused still + explicit buffered Full mode described in OPENCODE-draft-preview-integration-plan.md. Treat its latest product decisions as authoritative over older experiments. Inspect the actual integration code, port only reviewed geometry changes, integrate the real application preview, preserve audio/sandbox/export behavior, and prove cache/worker cleanup and zero AWS performance fallback. Follow the phased implementation and acceptance matrix. Deliver a reviewable local diff, complete report, raw logs and performance/memory evidence. Do not push, deploy, run paid renders, overwrite other worktrees, or claim unsupported device coverage. If a prerequisite is blocked, complete independent work and report the precise remaining blocker.

This document prepares the assignment; it does not assert that a new OpenCode session has been started.

## 13. Authoritative scope expansion: all-style Step 3 Draft, unchanged shapes

The owner now explicitly requests Draft support for **each style**, not only crayon and ballpoint. Implement material/rendering-quality reductions in native kits while keeping the authored scene itself unchanged. Earlier recommendations to leave fast kits without draft support are superseded. Earlier suggestions to simplify primary geometry, reduce visible stud segments, remove bevels, or remove meaningful paint/stitch passes are NOT blanket permission: preserve shape and style construction as specified below. Keep the existing running session and worktree; complete the expanded assignment without resetting completed work.

### 13.1 Step mapping and strict product boundaries

User-facing Step 2 is **Storyboard**; user-facing Step 3 is **Animation preview**. In the inspected `frontend/components/studio.tsx`, these are zero-based `STORYBOARD = 1` and `RENDER = 2`, with `REVIEW = 3` for the final render view. Therefore URL `step=2` is the intended Animation preview, not the user's Step 2 storyboard. Verify this mapping in the working revision before wiring controls.

- Leave storyboard generation and its simple shapes unchanged. Do not apply the animation draft profile to its data, authoring prompts, thumbnails or existing controls.
- Animation preview must use the actual detailed native scene with Draft rendering quality. It must not substitute storyboard art, flat shapes, texture-swapped crayon scenes, proxy blocks or different authored modules.
- Paused full still, explicit Full playback, final export, bounded buffer, cleanup and no AWS performance fallback remain as previously specified.
- Do not modify model prompts to generate simpler scenes. The same authored scene source must drive Draft and Full.

### 13.2 What “no change in shapes” means

Preserve object count and identity; silhouettes; primary contours; holes/cutaways; object positions, scale and orientation; camera/projection; text content, placement and readability; structural seams; occlusion and layer order; palette and base coverage; animation trajectories, timing and duration. Preserve visible bricks/studs, stitch paths and paint coverage when those define the authored object. Do not remove late objects or particles to satisfy a budget. Do not change scene semantics or replace the native style.

Draft may reduce the sampling/precision of **surface detail**: grain, fine fibers, bristle microtexture, internal shading sampling, secondary ink roughness, and similar material treatment. It may reuse valid cached layers. Such reductions must not introduce holes, change the outline, alter apparent topology, erase meaningful lines, or cause temporal flicker. Preserve broad shading, alpha coverage and the material's recognizable appearance.

Full and Draft are not expected to have identical pixels, but their structural geometry must agree. Existing crayon ribbon simplification must be reviewed against this stronger requirement: guard endpoints, extrema, joins, narrow features and coverage; retain full geometry where simplification changes the outline. Do not accept a faster result merely because the difference is called “draft.”

### 13.3 Shared quality architecture and the single target variable

Add one shared, typed quality context consumed by all relevant native kits, with full as the default. It should distinguish protected structural geometry from quality-dependent detail. Keep one authoritative configurable `draftTargetVerticesPerFrame` entry point for geometry-bearing detail; owner examples remain 6,000 and 60,000. No scattered kit-specific copies of the same default.

Changing that variable alone must re-resolve the profile/calibration and invalidate affected Draft state. Other manually configured profile constants remain unchanged. A kit may derive detail density from this target deterministically, but it must not interpret a vertex target as permission to delete authored shapes. At low targets, keep mandatory shape geometry and report overshoot. A target is not a universal scene cap, and no setting can guarantee that arbitrary authored geometry fits 6k vertices.

For non-vertex work, define explicit internal profile fields such as texture sample density/resolution or shading sample count. Their units and mappings must be documented. Use fixed, tested per-kit mappings under the shared Draft mode; if deriving them from the target, document that this is a quality heuristic rather than vertex accounting. Keep the developer-facing target change a one-variable operation, without requiring manual edits in every kit.

Cache identity must include the resolved profile/version and effective settings, dimensions, bundle/revision and frame. Cache keys for textures/bakes inside kits also need profile identity. Preserve full caches independently. Keep deterministic seeds and sample selection; reducing detail must not consume RNG differently in a way that shifts structural geometry or animation. Prefer separate detail RNG streams or stable indexed sampling where safe; Full's existing RNG sequence must remain identical.

Capability reporting should distinguish full, optimized draft, draft with no reducible work in this scene, and unsupported legacy bundle. An adapter covering only a few helpers is not proof that arbitrary scene code is globally budgeted. Every style must have an audited path and tests; styles with no safely reducible detail may retain full output under Draft, with explicit evidence and honest reporting. Do not invent degradation just to tick a coverage box. List unresolved styles as incomplete rather than claiming all-style completion.

### 13.4 Per-style implementation inventory

Generate a coverage matrix from the current engine manifest and application style catalog, including aliases and generated-scene kits. The inspected manifest has 31 entries below; reconcile missing/new entries rather than hardcoding this as permanent truth. Some styles share helpers, and some have no separate Kit module. Inspect the actual scene-to-helper call graph and optimize the right layer.

| Style / family | Candidate safe Draft work to investigate | Protected structure / caution |
| --- | --- | --- |
| `balloon`, `fox`, `lighthouse`, `ranunculus`, `storybook`, `wren` | Audit actual shared helpers; reduce only decorative ink/crayon/paper sampling when present | Do not assume every style uses the crayon call graph; keep all illustrated contours and objects |
| `toyBrick` | Cache static material detail; reduce interior surface/shading sample work; avoid invisible work with proven visibility tests | Keep Cam/Part projection, brick positions, visible stud outlines, bevel silhouettes, assembly and occlusion; do not lower polygon counts where silhouettes change |
| `woodcut` | Lower fine grain/goma sampling and cache paper/texture layers | Preserve carved keyblock outlines, color-region masks, registration and broad bokashi shading |
| `paintedOil`, `brokenColour` | Reduce internal bristle/impasto microdetail; cache static material layers at profile-specific quality | Preserve all paint region coverage, primary brush paths, modeled form and layering; do not create bare-paper gaps |
| `embroidery` | Reduce strand microtexture, thread highlight/shadow sampling; reuse linen layer | Preserve stitch centerlines/count where meaningful, stitch endpoints, thread envelopes, hoop and knots |
| `charcoalErasure` | Lower charcoal grain/dust samples inside existing marks; cache substrate | Preserve eraser masks, stroke envelopes, grayscale structure and compositing order; erasure is semantic |
| `colouredPencil` | Lower pencil-tooth/internal pigment detail | Keep primary line placement, colored coverage and contours |
| `pocketWatch`, `mellan` | Reduce internal hatch/ink detail within stable boundaries; reuse deterministic hatch data | Preserve outline, hatch coverage and tonal bands; prior factor2 results alone do not prove unchanged shapes |
| `moonPhases`, `blueprint` | Reduce chalk dust/paper detail or internal glow sampling where actually present | Preserve lettering, line diagrams, construction geometry and readable marks; reconcile UI aliases |
| `halftone`, `stipple` | Reduce sampling work or cache repeated dot masks without changing region boundaries | Dot distribution can define tone/form; protect tonal mass and avoid flicker or disappearing features |
| `scratchboard` | Simplify micro-scratches inside preserved marks | Keep etched primary contours and negative-space coverage |
| `sumiE` | Reduce interior paper/ink granulation samples | Preserve brush envelope, endpoints, bleeding coverage and meaningful negative space |
| `folkTale`, `koi` | Inspect native helper use; reduce material detail only | Preserve character/anatomy contours, ornamental motifs that define objects, motion and composition |
| `isometric`, `lowPoly` | Cache material/shading work or repeated static geometry where valid | Preserve vertices that define faces, camera/projection and face boundaries; do not coarsen authored shapes |
| `paperCraft`, `scrapbook` | Reduce interior paper/fiber sampling and cache materials | Preserve cutout masks, torn-edge silhouettes, folds, overlap order and image content |
| `rubberHose` | Reduce film-grain/ink-edge microdetail where safely separable | Preserve character outline, joint placement, limb shape and motion |
| `flatVector`, `midCentury` | Reuse paths/layers or reduce optional texture work if present | Basic vector geometry may already be minimal; no arbitrary simplification or object removal |
| `pixelArt` | Cache repeated tiles/sprites and avoid redundant preparation | Preserve logical pixel grid and palette exactly; do not lower logical resolution or blur pixel silhouettes |

These are investigation directions, not claims that those optimizations already exist or are safe in every kit. Determine native APIs from source and record exact changes per style. Do not add complexity to a cheap primitive without measurable benefit.

### 13.5 Order of implementation

1. Reconcile expanded scope with completed changes and record current status without resetting them.
2. Inventory all manifest/catalog styles and call graphs; identify structural versus material work and existing caches.
3. Implement shared profile plumbing and protected-geometry rules; update the existing crayon adapter first if it violates the new constraints.
4. Implement native adapters for the seven authored comparison styles, prioritizing toyBrick, woodcut, paintedOil and embroidery because their coverage was previously missing. Keep already-fast kits correct; do not target an arbitrary speedup.
5. Extend coverage to every remaining style using shared helpers where appropriate. Include styles without Kit modules. Mark already-minimal styles explicitly with evidence.
6. Integrate only into Step 3 animation playback; confirm Step 2 behavior and final render are unchanged.
7. Run per-style structure/visual tests, full-output identity, actual app playback and lifecycle checks before making an all-style claim.

### 13.6 Additional acceptance tests and evidence

Create a per-style table with style ID, UI title, native module, optimized operations, protected geometry, target/profile support, cache dependencies, warm/cold cost, memory, visual result and remaining limitations. Include real authored seven-style scenes and all built-in styles. Do not use regex texture substitutions as substitutes for native tests.

For each changed kit:

- Test Full -> Draft -> Full, exceptions, profile changes, reverse-order seeks and different page instances. Full hashes must match the original matched baseline, not a newly updated golden.
- Compare structural draw commands/paths before material decoration where practical: primary transforms, vertex positions, contours, object count, bounds and protected path identities. This is stronger evidence than a global image similarity score.
- Render silhouette/coverage/occlusion masks at matched frames where instrumentable; use these to catch lost holes, altered contours, missing stitches/studs, text clipping and unintended transparency changes. Do not require material-noise pixels to match. Document any approximation tolerance precisely; primary authored shape coordinates should remain unchanged.
- Provide side-by-side full/draft contact sheets, detail crops and motion previews. Review beginning/middle/end and complexity peaks, especially thin lines, touching objects, small labels, transparent layers and erasure.
- Test target 6k, 60k and default, reporting protected geometry, reducible detail geometry, actual totals and overshoot. Verify no disappearing object, quality pumping or altered animation at 6k.
- Measure cold preparation as well as warm frames; a faster warm renderer must not hide excessive cold texture generation or cache growth.
- Repeat the actual app's bounded-buffer test across representative native scenes. Retain all existing audio, stale-frame, end cleanup, watchdog and no-AWS tests.
- Verify Step 2 storyboard screenshots/behavior remain unchanged and Step 3 uses the same authored scene source for Draft and Full. Verify final export remains full detail.

Visual approval remains with the owner. If a proposed reduction changes shapes or destroys the material's identity, reject it and retain full detail for that operation; document any resulting performance limitation. No universal zero-buffering promise on arbitrary computers.

### 13.7 Updated delivery requirements

The final report must now include all-style coverage, the Step 2/Step 3 wiring distinction, protected-geometry evidence, the exact single target setting, and before/after examples for every changed native kit. Report unsupported legacy bundles separately from newly implemented kit coverage. Preserve focused reviewable changes and no deployment/paid-render boundary. If all styles cannot be completed, state the incomplete inventory rather than presenting the original crayon-only milestone as completion of this expanded task.


## Owner clarification: one tunable geometry target (2026-11-06)

Make the draft target vertices per frame a single named configuration parameter, e.g. `draftTargetVerticesPerFrame`, with one authoritative default. The owner must be able to change only this value to test 6,000, 60,000, 75,000 or another valid budget without rewriting rendering logic or editing multiple files. Pass it through the preview/player/worker/engine profile and calibration rather than embedding 75k in multiple places. Keep other profile settings unchanged when this value changes; derive budget-dependent allocations from it. Provide one documented developer configuration entry point (no new end-user control required), validation for invalid values, and exact instructions for applying a change and whether reload/restart is needed. Include the effective target in draft cache/profile identity and diagnostics, invalidate/recalibrate affected draft state on change, and preserve Full/export behavior. Test at least 6k, 60k and the default for plumbing, cache separation and graceful low-budget behavior. This remains a target, not a promised strict cap: preserve every object and report unavoidable minimum-geometry overshoot rather than silently substituting a larger budget or dropping objects. Report actual generated vertices versus configured target and measured visual/performance consequences.


## Native-style evidence update (2026-11-06)

Read `/private/tmp/gm-native-style-fps/docs/benchmark/native-style-fps-report.md` and use its completed native fixtures in `/private/tmp/gm-native-style-fps-results` read-only. Six authentic styles were fast in full detail on the reported M1 Max with raw cap90; pocketWatch was heavier and benefited from experimental hatch draft. This does not prove all styles implement draft or meet the new small-buffer policy. toyBrick, woodcut, paintedOil and embroidery report draft not implemented: preserve native full detail when those draw paths are unaffected, expose effective optimization capability truthfully, and do not claim the configurable vertex target caps all Canvas geometry. Keep the requested default Draft mode and explicit Full mode; do not introduce automatic quality switching. Test these real native fixtures with the actual integrated player, new bounded buffer, cold start and worker recycling. Record cold init + first picture separately from warmed Play startup (paintedOil has substantial cold costs), and scene-preparation waits separately from mid-scene stalls. Treat native report device/environment as distinct from prior runs until verified. Stage 2 hatch factor results are not proof of the new target-budget implementation. Visual fidelity still requires owner approval. Do not rewrite native scene code merely to force it through Gfx.pen or relabel unchanged output as a measured draft speedup.


## Owner visual approval (2026-11-06)

Owner reviewed the current 640x360 Full versus Draft75k stills for balloon/crayon, paintedOil and embroidery and explicitly approved their Draft appearance. Retain this candidate appearance; do not restore detail solely to enforce mathematical shape identity in these approved examples. This updates the earlier absolute shape constraint to allow visually acceptable simplification. Preserve composition, object semantics, readable text and animation. Approval does not establish visual acceptance for unseen styles, 6k/60k profiles, motion artifacts or pending stipple/halftone comparisons. Complete real full-film playback/audio, memory lifecycle, original-baseline Full/export parity and remaining visual checks. No deployment authorization is implied.
