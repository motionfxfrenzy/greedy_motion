# Greedy Motion

**Greedy Motion** turns approved product copy, uploaded product screens, and
brand kits into editable, reviewable product videos. `VideoSaaS` is the
repository/workspace name; Greedy Motion is the product shown in the app.

The app is a real project workflow, not a static mock:

1. Create a project and confirm its script.
2. Upload the product screens the video should use.
3. Select a brand kit and review the storyboard.
4. Edit declared copy and approved screens in Studio.
5. Queue a HyperFrames render, leave timestamped review comments, and apply
   revisions before approval.

Studio persists its values and selected screenshot IDs through the backend.
Its preview uses the same HyperFrames composition and assets as the renderer,
so a saved Studio revision—not browser-only state—is what gets rendered.

## Stack

- **Frontend:** Next.js + React (`frontend/`)
- **Backend:** Fastify, PostgreSQL project/brand records, and pg-boss render jobs (`backend/`)
- **Renderer:** Docker worker using HyperFrames (`worker/`)
- **Preview/editor:** `@hyperframes/player`, with product-owned scene,
  timeline, review, and inspector UI
- **Editor state:** Zustand + Zundo for local undo/redo; the backend remains
  authoritative for saved revisions
- **Shared contracts:** TypeScript workspace package (`packages/contracts/`)

## Run locally

### Prerequisites

- Node.js 24 or newer
- Docker Desktop
- An Anthropic API key for AI script planning, or `PLANNER=deterministic` for a
  local deterministic planner

### Setup

```sh
npm install
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
cp worker/.env.example worker/.env
```

Set `ANTHROPIC_API_KEY` in `backend/.env`, or change `PLANNER=deterministic`
there when working without Claude. Add `GEMINI_API_KEY` only when using
background music or voiceover.

Start PostgreSQL and the render worker, then run the app services on the host:

```sh
docker compose up -d --build
npm run dev:backend
npm run dev:frontend
```

Open [http://localhost:3000](http://localhost:3000). The frontend runs on
port 3000; the API runs on port 4000; Postgres is exposed locally on port
55432. Check infrastructure with:

```sh
docker compose ps
```

Render jobs are queued in Postgres and consumed by the worker. To add local
render capacity:

```sh
docker compose up -d --scale worker=3
```

## Useful commands

```sh
# Type-check all workspaces
npm run typecheck

# Build the production frontend
npm run build:frontend

# Confirm template manifests match their HyperFrames declarations
npm run templates:verify

# Rebuild theme CSS and local preview assets
npm run themes:build
npm run previews

# Start only the worker stack (includes Postgres)
npm run dev:worker
```

## Repository layout

| Path | Purpose |
| --- | --- |
| [`frontend/`](frontend/) | Next.js product UI, review flow, and Studio editor |
| [`backend/`](backend/) | Fastify API, project persistence, preview routes, and render job orchestration |
| [`worker/`](worker/) | Isolated HyperFrames rendering worker |
| [`packages/contracts/`](packages/contracts/) | Shared project, template, brand, and render types |
| [`design_handoff/`](design_handoff/) | Product design reference supplied for implementation |
| [`docs/`](docs/) | Architecture, deployment, templates, and product decisions |
| [`var/`](var/) | Local runtime data: projects, renders, brands, and generated audio (ignored by Git) |

## How Studio works

Studio is deliberately template-first rather than a general-purpose video
editor. Users can edit the copy fields and approved uploaded screens declared
by a template, seek the real composition, see review comment pins, and undo or
redo local edits. Scene timing, layout, and motion remain template-owned in
v1. Every explicit change is validated and saved by the backend before it can
be rendered.

The accepted implementation decision, including why we build the product UI
instead of embedding a full open-source timeline editor, is in
[Studio editor decision](docs/STUDIO_EDITOR_DECISION.md).

## Documentation

- [Complete application, infrastructure and storage guide](docs/SYSTEM_GUIDE.md) — current system map, templates/presets, data locations, deployment flow and operating limits.
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment map](docs/DEPLOYMENT.md)
- [Environments and live resources](docs/ENVIRONMENTS.md)
- [Authentication, ownership and data](docs/AUTH_AND_DATA.md)
- [Progress log](docs/PROGRESS.md)
- [Render queue](docs/RENDER_QUEUE.md)
- [Starter templates](docs/TEMPLATES.md)
- [Creative library plan](docs/CREATIVE_LIBRARY_PLAN.md) — reference packs, Anime.js, Rough.js, p5.js
- [Brand kits, music, and voiceover](docs/BRAND_AND_AUDIO.md)
- [Studio editor decision](docs/STUDIO_EDITOR_DECISION.md)
- [Editing and AI revisions](docs/EDITING.md) — longer-term design exploration
- [Local validation](docs/LOCAL_VALIDATION.md)

## Environment notes

`frontend/.env.local`, `backend/.env`, and `worker/.env` are local-only and
ignored by Git. Do not place API keys in the frontend environment: only
`NEXT_PUBLIC_*` values belong there. The backend needs the database URL and
planner credentials; the worker intentionally receives neither model keys nor
user credentials.
