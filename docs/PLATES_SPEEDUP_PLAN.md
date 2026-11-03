# Plate scenes: speed-up plan, opinions and open items

Written 2026-11-04 after the worker pipeline was built and verified locally. Nothing here is implemented yet. Numbers are from
a laptop (Docker Desktop, software rendering) unless marked otherwise; staging must be measured before anything is tuned.

## Where the time goes (one scene, real model)

| Stage | Measured | Notes |
| --- | --- | --- |
| Authoring (model call) | 56–79 s | 18 k cached input tokens, ≈8 k output; the dominant stage |
| Bundle | 0.1–0.3 s | negligible |
| Browser verification | 6–14 s | draws 3 frames twice, plus a second page |
| Frame drawing + encode | 25–100 s | ≈ 2–6 fps per scene on 1–2 pages; scales with frames |
| Upload | 0.1–0.2 s | negligible |
| Worker cold start (ECS) | unmeasured (expect 30–60 s) | image pull + Chromium start |
| Queue wait | < 3 s with a warm worker | |

A first draw of 3 scenes × 3 ratios took 8 minutes locally. The primary preview was ready after ≈ 3.5 minutes.

## Plan, in order of value for effort

1. **Start the worker when Draw is pressed (small).** Count `queued` and `authoring` variants as launcher demand and kick the
   launcher from the draw route. The cold start then overlaps with the model call instead of following it. No new endpoint, no
   frontend change. Expected saving: most of one cold start (30–60 s) on every first draw.
2. **More parallel tasks (settings only).** Raise `ECS_WORKER_MAX_TASKS` and `PLATE_PROJECT_CAP` once staging is measured. Nine
   independent variants then take roughly ⌈9 / tasks⌉ scene-times. Keep `PLATE_CONCURRENCY=1` on 2 vCPU tasks: two Chromiums on
   two cores do not go faster. Consider 4 vCPU tasks with concurrency 2 if cost per scene-second is better.
3. **Prewarm hint at an intent signal (small, gated).** One call when the storyboard is confirmed / the person continues to the
   animation step, asking for a single task. Gate: plate flag on, plate style, rate limit per user and project, `ECS_WORKER_MAX_TASKS`.
   Not at script writing: people idle there for minutes and the worker exits after `IDLE_EXIT_SECONDS=600`. Only worth building
   if measured cold start is long enough that item 1 does not hide it.
4. **Verify in parallel with authoring of the next scene (small).** Already true across scenes; make sure the primary ratio is
   authored before the other ratios so the first preview appears early (it is today).
5. **Cheaper verification (small).** Draw each check frame twice on one page and once on a second: drop the second-page pass for
   scenes whose module imports nothing stateful, or verify only first and middle frames. Saves 3–6 s per scene; a small win that
   costs some of the determinism guarantee, so only if profiling shows it matters.
6. **Split one long scene across workers (large).** Frames are a pure function of the frame number, so a scene can be cut into
   ranges drawn on different tasks and joined without re-encoding (each range starts on a keyframe, as the old scene join did).
   This is the only way to make a single long scene faster, but it needs range jobs, a joiner, fencing per range and a retry story.
   Do it only if real scenes are long (> 8 s) and users wait on them.
7. **Hardware.** Fargate has no GPU; software Chromium is what we have. A GPU worker (the painted engine's capacity provider) would
   speed canvas drawing but adds cost and cold start; not recommended for this workload without measurements.
8. **Authoring.** A smaller/faster model for repair calls only, shorter plate prompts (the plate and kit are ≈ 18 k tokens, cached),
   and a hard output cap are the levers. Quality risk is real: measure before changing the model.

## Opinions and criticisms

* **The model call is the largest fixed cost, and it is serial per scene.** Parallelism across scenes already helps; nothing in the
  worker will fix a 60–80 s authoring step. Be honest in the UI: show authoring progress, not just "drawing".
* **Software rendering is slow and noisy.** 2–6 fps per scene means a 10 s scene takes 1–2 minutes. This is fine for a preview but
  tight for "final render" expectations. Measure on Fargate before promising times.
* **One film = up to 9 variants.** Three ratios is 3× the model cost and 3× the render time. Selecting ratios up front (done) and
  drawing the primary first (done) is the right shape; consider making extra ratios opt-in per click rather than per selection.
* **Cache invalidation by design excludes other scenes' pictures.** Cheap and predictable, but a person who changes the main
  character in scene 1 will not see scenes 2–5 follow. Consider a "restyle the cast" action that bumps a shared cast version.
* **Free-plan watermark now applies to plate films.** Correct per the plan table, but it is a visible behaviour change; confirm
  with product before production.
* **Subtitle fonts differ** between the old API image (no fonts) and the worker image (Liberation/DejaVu). Check on staging.
* **The e2e stack is slow and shares a laptop CPU**, so durability tests have long waits. They are acceptance tests, not CI. A
  fast CI subset exists: `plate-model`, `plate-store` (needs Postgres), `engine.test`, `plates-assemble` (in the worker image).
* **The vendored engine is a copy.** Upstream improvements do not arrive by themselves. `PROVENANCE.md` lists what was taken;
  re-vendoring needs a parity run (`golden-from-legacy.mjs`, `bench.mjs`).
* **Only three of the 31 styles were drawn end to end.** Draw one scene of every style on staging before launch.

## What is on the plate

* Staging: deploy the integrated branch, enable `PLATE_PIPELINE=worker`, real R2/ECS end-to-end, scale-from-zero, interrupted-job
  recovery, then record timings (cold start, queue, authoring, verify, render, export) and model-call counts.
* Production: promotion only after staging sign-off (plan in `PLATES_PIPELINE.md`).
* Not built yet: artifact deletion when a project is deleted, an R2 lifecycle rule for `plates/*`, per-user authoring quotas,
  the prewarm hint, launcher demand for `queued`/`authoring`, split-scene rendering, all-styles smoke run.
* Housekeeping: ECS task-definition revision 14 (built from an unintegrated branch) must not stay the latest active revision of the
  staging family; the integrated image replaces it.
