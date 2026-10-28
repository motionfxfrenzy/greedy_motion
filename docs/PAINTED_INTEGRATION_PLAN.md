# Painted-shorts engine into GreedyMotion: hosting, director, and everything else

Written 2026-10-28 from reading the repository (worktree `VideoSaaS-pgboss-main`, branch `feat/intelligent-director`, at cbe99fc plus the World Intelligence commit da2deb6). Nothing here is built into the product yet; the engine lives only in `worker/templates/painted/` and `worker/Dockerfile.painted`.

## 1. Hosting: Fargate for doodle, something else for GPU oil

| Engine | Needs | Where it can run | Measured |
|---|---|---|---|
| **Doodle** (marker, flat, pencil, ...) | Canvas 2D only; the GPU brush filter never runs | **Fargate (CPU)**, same as today's workers | 78 s film at 720p: 273 s paint in software on an M1 Pro vs 16 s on its GPU; frames look identical (PSNR 40 dB). Fargate vCPU speed not measured yet. |
| **Oil / pastel / watercolour** (painted looks) | WebGL2 brush pass, per frame | **Not Fargate**: Fargate has no GPU. Options: ECS on EC2 GPU instances (g4dn, Spot) behind an auto-scaling group that scales to zero, or AWS Batch with GPU Spot | CPU software render: oil about 10 s per drawing (about 2 h per film); gouache 0.15 s per drawing (about 2 min). Metal GPU: 20-40 s per 60 s film. The Linux GPU path (`PAINTED_ANGLE=vulkan` in `Dockerfile.painted`) has **never been run**. |

Recommendation: ship doodle first (no new infrastructure type), and run a one-day GPU spike on a g4dn instance before promising oil. If the spike fails, oil stays out of the product (or runs as gouache on CPU only).

How it fits what exists: today `backend/src/jobs/worker-launcher.ts` starts Fargate tasks for the `render-video` queue (Spot first, on-demand fallback, idle exit after 600 s), and the render manifest declares `workerClass: "browser"` (`backend/src/plan/render-manifest.ts`, `worker/src/render-preflight.mjs` rejects anything else). Painted films need their own **worker class and queue** (`render-painted`, class `painted-cpu` on Fargate, later `painted-gpu` on EC2), their own task definition and image (`Dockerfile.painted`, currently stale and not built since the river/sprout/jar work), and a launcher entry that picks the capacity provider per class. The DB queue stays the only hand-off, so no networking changes.

## 2. Where the director goes

Two directors exist and they are different things:

- **Product director** (`backend/src/plan/director.ts`, Claude Opus 5.5): marketing/explainer films, outputs a `BeatPlan` (voiceover, on-screen text, visual per beat). Keep it for those formats.
- **Painted director** (`brief.mjs` + `vocab.mjs` + `supervise.mjs` + `lint.mjs` + `scene-graph.mjs`): story films, outputs a SPEC (lines, shots, people, props, framing). Either Claude or Gemini (`--engine`).

The painted director is plain Node/ESM with no browser, so it can run **in the backend job** (stage `directing`, like the existing `render-plan` queue with its refund-on-failure behaviour) and write the spec to the project. The worker then does only what needs a browser or heavy compute: object drawing with the sheet review (`check.mjs` paints with Chrome), voice, music, paint, encode, upload. Brain choice (Gemini vs Claude) becomes a setting; run 2 showed Gemini about 2x cheaper and faster, Claude richer.

The in-browser player (`index.html` + `runtime/player.js`, with the new "continuous scene" checkbox) draws frames live on the client at about 30 ms per frame for doodle, so **Preview needs no server render**: serve spec + audio + the player. That is the cheap part of the product experience; only the final MP4 needs a worker.

## 3. Everything else that has to be decided or built

1. **Product surface.** A new "Story film" flow (script in, style picker with the doodle looks, the checkbox for continuous scene vs draw each transition as `spec.drawIn`). The current style picker/storyboard/prompt composer belong to the HyperFrames flows; nothing in `backend/src` or `frontend/` mentions the painted engine.
2. **Job contract.** New queue `render-painted` in `backend/src/jobs/queues.ts` (and `worker/src/jobs.mjs`), manifest `workerClass`, progress events through the existing pg_notify/SSE path (stages: directing, objects, voice, music, painting, encoding), refunds on failure, retry and heartbeat settings like `render-video`.
3. **Storage.** Worker output and inputs go through the R2 adapter (`worker/src/storage.mjs`); the engine writes local files today. The shared recipe cache (`var/painted-cache/recipes`) must move to R2 or a Postgres table so a drawn object is reused across films and workers; frames cache is scratch and already deleted after each render.
4. **Secrets and providers.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (director, oracle, vision review, TTS, Lyria) in Secrets Manager for the painted task definition. Cost per film is dominated by language calls, not compute: run 2 estimate about $0.73 (Gemini brain) to $1.59 (Claude brain), mostly the artist model's thinking tokens; Fargate compute for a 5-minute CPU render is cents. Lyria sometimes refuses prompts (the cli already has a retry ladder). Needs a token-ledger price per film and an LLM budget guard.
5. **World Intelligence (da2deb6).** `world-db.mjs` stores learned objects, camera exemplars and edit telemetry in JSON files; `backend/src/db/migrations/010_world_intelligence.sql` adds four tables. **Migration number clash**: this branch has no 008/009 and `main` already has `008_render_job_events`, `009_scene_clips`, `010_preview_usage`. Rebase onto main and renumber to 011 before any deploy. The engine must read/write the tables through the backend (not JSON files on a disposable worker); user preferences stay per user and never feed the global engine.
6. **Pro Editor and captions.** The engine burns captions into the picture and outputs a flat MP4, so the Pro Editor (layers, EffectCraft) cannot edit it; treat it as a finished video, or export spec + audio for a later layered path.
7. **Robustness.** Done this session: tolerant scene graph, per-shot fallback, near-miss recipe repair, two-round sheet review. Still needed before users: a smoke suite on a dozen scripts per release, timeouts per stage, and a content-safety pass on user scripts before they reach the director and music model.
8. **Branches and deploys.** The painted work sits on `feat/intelligent-director` (not pushed). Production pushes and secrets are the user's to do. Build and deploy the worker image together with the backend (`ENV=... ./deploy-worker.sh` from a clean worktree).

## 4. Suggested order

1. Rebase on main, renumber the migration, rebuild `Dockerfile.painted`, and time a doodle film on a 4-vCPU and an 8-vCPU Fargate task (the number that decides the CPU plan).
2. Backend: `render-painted` queue, `painted-cpu` launcher, directing stage with the painted director, spec in the project, token price, SSE stages.
3. Frontend: Story-film flow with the style choice and the continuous-scene checkbox, embedded live player for Preview, final render button.
4. GPU spike on one g4dn instance (Chrome + Vulkan in the container); only then decide on oil.
5. Move recipe cache and World Intelligence tables to Postgres/R2.

## 5. Decisions made (2026-10-28)

- **First release is doodle only, with all 15 looks** (marker, flat, pencil, crayon, broken colour, woodcut, chalk, ballpoint, charcoal, cyanotype, sumi-e, pixel, risograph, scratchboard, engraving). The oil painting look stays in the engine with the same spec, flow and controls and is switched on when the GPU path is ready.
- **The brain is an environment variable, default Gemini.** The engine reads `PAINTED_ENGINE` (`gemini` default since this commit, `claude` to switch); the backend should expose one config value that sets it for the worker task. Voice and music stay Gemini TTS and Lyria either way.
- **Painted films are finished videos for now.** The Pro Editor is unreleased; the only editing is the comment editor: a comment on a scene becomes a `--fix "<line>: <what to change>"` (rewrites that one scene, only it is repainted) and feeds the World Intelligence edit classifier (colour taste stays per user).
- **GPU hosting:** feasibility below; no GPU work is committed to.

## 6. GPU feasibility (oil painting on AWS)

Verdict: feasible, a one-to-two-week effort with real unknowns, not needed for the first release.

- Fargate cannot do it: it has no GPU support (still true in 2026, even after the 32 vCPU update).
- Closest to Fargate-style operation: **ECS Managed Instances** (AWS provisions the GPU instance, driver and patches in your account; an AWS pattern shows scale to zero with SQS plus Application Auto Scaling). Self-managed alternative: an ECS capacity provider on an EC2 Auto Scaling group (min size 0) with the GPU-optimised AMI and `ECS_ENABLE_GPU_SUPPORT=true`. AWS Batch with GPU Spot also works and scales to zero natively, but our jobs already flow through pg-boss, so ECS keeps one queue and one launcher.
- Cost looks small: a g4dn.xlarge (4 vCPU, 16 GiB, one T4) is about $0.53 per hour on-demand in us-east-1 and roughly $0.25 to $0.35 on Spot (sources disagree; Singapore about $0.74 on-demand). A film needs only about 1 minute of GPU painting (20-40 s measured on an M1 Pro; T4 speed is unmeasured), so about a cent or two of GPU per film plus boot time.
- The real costs are latency and risk, not money: a cold GPU instance takes minutes to boot (Fargate tasks take well under a minute), so the first oil film after idle is slow unless one instance is kept warm; Spot GPU capacity can be missing or interrupted (needs on-demand fallback like the current launcher does).
- The hard technical risk is headless Chrome WebGL on the NVIDIA card inside the container: it works only with the right pieces: Chrome flags (`--headless=new --use-angle=vulkan` or `gl-egl`, `--ignore-gpu-blocklist`), the NVIDIA graphics driver capability, the Vulkan/EGL manifest files, and a driver-matched GL package; Puppeteer can silently force SwiftShader (`ignoreDefaultArgs` for `--use-angle=swiftshader-webgl`); and a working `nvidia-smi` proves nothing. Always check the renderer string. Our `render.mjs` already prints the renderer and refuses software on Mac, which is the check to reuse on Linux.
- Spike (about one day): one g4dn.xlarge with the ECS GPU AMI, run `Dockerfile.painted` with `PAINTED_ANGLE=vulkan`, confirm the renderer is the T4, render one 60 s oil film, record seconds per drawing. Pass: under about 2 minutes per film. Then decide between Managed Instances and a self-managed ASG.
- Alternative outside AWS (not assessed in depth): a serverless GPU vendor with second-level cold starts; costs a second vendor, secrets and data transfer to R2.

## 7. Image and GPU gate status (2026-10-28, after commit ea61109)

- `worker/Dockerfile.painted` had a syntax error (`usermod -a -G video render node`); fixed to `video,render`. The image now builds (tested on the Mac: linux/arm64). **AWS needs `--platform linux/amd64`** (g4dn is x86); not built or run for amd64 yet.
- The new hardware-GPU gate blocked doodle on a CPU worker (the image sets `PAINTED_REQUIRE_GPU=1`). Fixed: a doodle film never requires the GPU and defaults to software GL on Linux. Verified in the container: doodle renders on the CPU with the image's default env; an oil film in the same CPU container is refused with the "requires a hardware GPU" error.
- So one image serves both task definitions: CPU task (Fargate, doodle only: no special env) and GPU task (ECS on EC2 GPU, oil and doodle: `PAINTED_ANGLE=vulkan`, `PAINTED_REQUIRE_GPU=1`, `--gpus all`).
- Still untested: `gpu-check.mjs` and the Vulkan path on a real NVIDIA host (the spike), the ECS EC2 capacity provider launch path, the backend `ECS_GPU` branch against real ECS.
