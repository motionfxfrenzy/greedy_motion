# Frontend implementation plan

Status: planned for M3 (local) and M4 (Vercel). Replaces the earlier prompt-to-preview prototype contract, which did not match the product's screenshot-and-brief workflow. Contracts referenced here are defined in [Architecture](ARCHITECTURE.md); hosting reasons are in [Stack decisions D1](STACK_DECISIONS.md#d1--frontend-on-vercel).

## Goal

Let a signed-in user create a project, upload screenshots, pick a brand, write a brief, review and edit the storyboard, render a draft, request a scoped revision, approve, and download the final MP4, with every step surviving a page reload.

The frontend is a UI only. It talks to the Railway API through a typed client and to R2 only through presigned URLs. It has no database, storage, model, or service-role credentials, so a frontend bug or leaked bundle cannot expose them.

## Existing prototype

The repository root currently contains a Next.js spike (`app/`, `components/`, `lib/`) with a free-text prompt, three styles, an in-memory job store, a fabricated progress number, Next.js API routes, and the validation smoke MP4 as output. It was useful for checking that Next.js 16 runs locally, but it conflicts with the architecture:

| Prototype | Target |
| --- | --- |
| Free-text `prompt` | Screenshots, brief, approved claims, brand kit |
| Styles `clean`, `kinetic`, `editorial` | One style until it passes validation |
| `progress: number` | Stage names; real frame counts only when reported |
| Next.js API routes with in-memory jobs | Fastify API on Railway with Postgres and pg-boss |
| Revision embedded in the job | Immutable revisions; jobs reference a revision ID |
| Output URL to a gitignored smoke file | Presigned R2 URL from `GET /renders/:id/download` |

CORE-01 handles it: move reusable presentation pieces (layout, preview player, storyboard card styling) into `frontend`, and delete `app/api/*`, `lib/render/*`, and the prompt contract. Nothing from `lib/render` carries forward.

## Structure

```text
frontend/
  app/
    (public)/login, signup, reset-password
    (app)/layout.tsx              # auth guard, workspace provider, Query client
    (app)/projects/...            # routes from Architecture §7
    (app)/brands/[id]
    (app)/settings/usage
  components/                     # presentational components, no data fetching
  features/                       # route-level containers: queries, mutations, forms
  lib/supabase.ts                 # browser Supabase client
  lib/api.ts                      # api-client instance with token + request ID injection
```

- `packages/api-client` wraps `fetch` and parses every response with the Zod schemas from `packages/contracts`. A response that fails validation is treated as an error, not rendered.
- Lint forbids `frontend` from importing any server package (see [Architecture §4](ARCHITECTURE.md#4-repository-structure)).
- UI kit: Tailwind and shadcn/ui components, chosen for speed and accessible primitives (Radix).

## Data fetching and auth

- Server components render the layout shell and public pages only. Authenticated data is fetched client-side with TanStack Query. The app is behind login and needs no SEO, and a single auth path (browser token → API) is simpler to secure than also forwarding tokens from Vercel servers.
- The API client gets the current access token from `supabase.auth.getSession()` before each request and sends `Authorization: Bearer <token>`, `X-Request-Id`, and, when selected, `X-Workspace-Id`.
- On `401`, refresh the session once and retry; if that fails, redirect to login and keep unsaved form state in memory.
- Next.js middleware may redirect signed-out users away from `(app)` routes for UX, but the API remains the only security boundary.

## Key flows

### Uploads

1. Validate type (PNG/JPEG) and size in the browser for fast feedback.
2. `POST /assets/upload-intent` → presigned PUT URL.
3. `PUT` the file directly to R2 with progress from `XMLHttpRequest` upload events (real byte progress, not estimated).
4. `POST /assets/:id/complete` → `verified` (show thumbnail and dimensions) or `rejected` (show the reason; allow replace).
5. An interrupted upload leaves a `pending` asset that the user can retry or remove; the server expires it after 24 hours.

### Jobs

- Mutations that start work send an `Idempotency-Key` generated once per user action, so double-clicks and retries cannot create two jobs.
- Poll `GET /jobs/:id` every 2 seconds while visible, backing off to 10 seconds when hidden; stop at a terminal state. On reload, active jobs are rediscovered from the project's state.
- Show the stage name (`Rendering`, `Uploading`, …). Show a percentage only when the job includes real `framesRendered` / `totalFrames`.
- Cancel calls `POST /jobs/:id/cancel` and shows `Cancelling…` until the job reaches `cancelled`.

### Storyboard editing

- Edits are local until saved. Save sends the base revision ID in `If-Match`. On `409`, show what changed on the server and let the user reapply their edits on the latest revision.
- Duration edits move frames to or from an adjacent scene so the total stays 600 frames; the editor shows both values.
- AI change requests produce a `proposed` revision. Show a scene-by-scene diff; accept creates a draft revision, reject discards it.
- Saving any content change visibly clears the previous approval.

### Preview and download

- Request a presigned URL from `GET /renders/:id/download` and use it as the `<video>` source; muted and paused by default; seek to scene boundaries from the storyboard.
- If playback fails with an expired URL, request a new one once.
- The download button fetches a fresh URL on click and navigates to it.

## States and accessibility

Every data view has distinct loading, empty, error, and ready states. Errors show the API's `message` and `requestId` as a diagnostic ID, never raw logs or server paths. Include keyboard navigation, form labels, visible focus, `aria-live` announcements for job stage changes, and responsive layouts that work for viewing on mobile. Design for desktop creation first.

## Environments

| Vercel environment | API | Supabase |
| --- | --- | --- |
| Local (`next dev`) | `http://localhost:<api port>` | None in M3; dev project from M4 |
| Preview: PRs and the `staging` branch (`app.staging.<domain>`) | Railway `staging` | `videosaas-staging` |
| Production (`production` branch) | Railway `production` | `videosaas-production` |

Variables: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`. All are public by design; nothing secret is configured on Vercel.

## Acceptance checks

- Signed-out users cannot see app data; an expired session recovers or redirects without losing unsaved edits.
- Wrong-type and oversized uploads are rejected with clear messages; a rejected server-side check is shown even if browser checks passed.
- Double-submitting plan or render creates one job.
- Polling shows real stages; no fabricated percentages; reload during a render resumes status.
- Playback is enabled only when a render output exists; expired URLs refresh.
- A `409` on save is recoverable without losing the user's edits.
- The production bundle contains no database URL, R2 key, model key, or service-role key (checked in CI by scanning build output for known variable names).
- Errors show a diagnostic ID and no server paths.
