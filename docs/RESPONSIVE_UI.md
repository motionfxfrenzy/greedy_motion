# Responsive UI workflow

Implemented and checked locally on 2026-10-09.

## Causes and fixes

- Studio's reported `Failed to fetch` was caused by the local backend failing startup validation: `MEDIA_URL_SECRET` was missing. Configured a random secret in the ignored backend environment file and restarted the backend. Never commit its value. Production must supply its own stable secret through deployment configuration.
- Browser JSON API requests now use `/api/backend/*`, forwarded by Next to the configured backend. Authorization still reaches and is verified by the backend. Network/gateway errors have readable messages; GETs time out after 15 seconds. Writes are never automatically retried.
- The initial project request has explicit loading, failure/retry, and successfully empty states. A failed request no longer claims there are no projects. Project and brand request failures are handled independently, preserving loaded content.
- Auth middleware runs for protected pages and the auth entry page, avoiding session validation on public pages/assets. Redirects preserve refreshed cookies and prevent caching. JWT validation remains in place.
- Ambient decorations now sit behind the application content. Settings cards have opaque white surfaces and darker helper text. The page gradient remains visible outside cards.

## Interaction rules

| Interaction | Immediate response | Persistence and failure |
|---|---|---|
| Forgot password | Open the reset form locally; focus email | Only submitting the form contacts auth. Show sending state and confirm success only after the response. |
| Sign-in, OAuth, reset password | Disable repeated submissions; show pending feedback | Catch network errors and re-enable controls. Never simulate authentication success. |
| Project opening / editor entry | Show the saved project and editor immediately | Fetch render status afterward; ignore an older project's response after another project opens or a new draft starts. |
| Projects filters | Filter the current in-memory list immediately | No request required. |
| Brief/settings and Studio editing | Update local draft immediately | Existing Studio autosave/debounce retains edits on failure. |
| Review comment add/remove | Update comments immediately | Reconcile canonical server comments; restore previous comments and surface the error on rejection. Guard overlapping writes and stale background refreshes. |
| Approval, AI generation, rendering, upload | Immediate pending feedback | Success requires the server response; avoid optimistic irreversible/computational results. |
| Route to Studio | Show the route loading boundary | Protected route still validates the session. |

Use `frontend/lib/optimistic.ts` for reversible mutations. Patch only affected fields, keep pending state visible, guard duplicate writes, and prevent responses from replacing a different open project. Keep user drafts available on error. Do not use global unscoped user-data caches.

## Verification

- `npm run typecheck`: frontend, backend, and contracts passed.
- `node --test frontend/test/optimistic.mjs`: two passing tests covering immediate local feedback, canonical reconciliation, rollback, error propagation, and no write retries.
- `git diff --check`: passed.
- Browser: authenticated Studio loaded successfully without the fetch error; local Drafts filter became selected; Create opened immediately; settings cards visually verified with no peach/yellow overlay on text.
- Browser: tested Forgot password and Back to sign in on the separate 127.0.0.1 origin, preserving the user's localhost session. No reset email was sent and no password changed.
- Review mutation behavior was tested through the shared optimistic helper; there was no rendered project in this workspace for a live end-to-end comment/approval test.

These changes improve immediate feedback. Actual auth, AI, upload, and render durations still depend on the network and service; they are not promised to complete instantly. AWS performance/load testing remains a separate deployment check.
