# Renderer container spike

Status (2026-10-04): the worker now consumes the pg-boss `render-video` queue and reports progress into Postgres; it no longer serves `POST /renders`. See [Render queue](RENDER_QUEUE.md). The rest of this page records the original container spike.

Original status: local validation artifact. This is an isolated Docker worker foundation for the planned Railway `worker` service. It is not connected to pg-boss, Postgres, R2, user uploads, or model output yet.

## Purpose

Prove that the pinned rendering runtime can run in a Linux container with Chromium, FFmpeg, HyperFrames, a local GSAP file, a bundled font, and a non-root process. It keeps that runtime distinct from the Next.js UI spike and gives Railway a single-purpose image to deploy later.

## Image contract

| Concern | Current container behavior | Production extension |
| --- | --- | --- |
| Runtime | Node 24 Bookworm | Same pinned major |
| Browser | Debian Chromium selected through `HYPERFRAMES_BROWSER_PATH` | Same, version recorded in image metadata |
| Encoding | Debian FFmpeg | Same, benchmarked on Railway |
| Animation | HyperFrames 0.8.111 and GSAP 3.14.2 | Same until a deliberate runtime upgrade passes fixtures |
| Fonts | Bundled Liberation Sans fixture font | Licensed product font set staged per job |
| User | `worker` UID 10001 | Same non-root user |
| Work files | Per-run directory under `/tmp` | Per-attempt directory, mounted/cleaned by job handler |
| HTTP | `/healthz`, `/readyz` (ready = consuming the queue and not draining) | Same |
| Jobs | pg-boss `render-video` consumer, `RENDER_CONCURRENCY` per replica, fenced writes to `app.render_jobs` (done) | Same, plus cancellation |
| Network | Container self-test must run with `--network none` | Chrome host-resolution restrictions plus staged local assets |

## Commands

From repository root, after Docker Desktop is running:

```sh
docker build -f worker/Dockerfile -t videosaas-renderer:local .
docker run --rm --network none videosaas-renderer:local node src/self-test.mjs
# The default command now needs DATABASE_URL (it consumes the render queue):
docker run --rm -p 8080:8080 -e PORT=8080 -e DATABASE_URL=postgres://… videosaas-renderer:local
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/readyz
```

The self-test writes only to a unique `/tmp/renderer-self-test-*` directory and removes it at exit. It logs a single JSON result and exits nonzero if a required tool, structural check, render, or MP4 metadata assertion fails.

## Railway staging deployment plan

Do not deploy this image until the local build/run checks pass and M3 has the job protocol. On staging, create a Railway service named `worker` using this Dockerfile with full repository context so future shared packages remain accessible. Configure:

- `PORT` for health server, if Railway health checks need it.
- `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` only after benchmark p95 plus upload time is measured.
- Database and R2 variables only when `packages/jobs` and `packages/storage` exist; never provide model, auth, or browser-session secrets.
- Fixed replica count and restart-on-failure.
- Docker image fixture tests in CI before any deployment.

The deployment command and service configuration are intentionally deferred: no Railway project or environment has been selected, and M4 is gated by local M1/M2 evidence. See [Architecture](ARCHITECTURE.md#12-job-lifecycle-and-worker-protocol) and [Progress](PROGRESS.md).
