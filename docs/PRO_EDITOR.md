# Pro Editor

Documented: October 9, 2026. Status: built on `main`, **not deployed**. It implements the design handoff in `Design/design_handoff_pro_editor/` and is off for customers unless `NEXT_PUBLIC_PRO_EDITOR=1` (a menu entry in Studio) and the user is in `PRO_USER_IDS`.

## What it is

One editor shell with two modes, as in the handoff:

| Mode | Engine | State today |
| --- | --- | --- |
| **HTML clips** | HyperFrames | Live. Edits a real HyperFrames composition (tracks, clips, inline CSS, GSAP tweens), previews it in a frame, saves to the backend, renders through the existing queue. |
| **Layers** | EffectCraft | UI built (layers, keyframes, speed graph, effects, bridge, 3D gizmo) and working on `/editor/demo` against a DOM stand-in for the engine frame. **Not connected to EffectCraft.** No EffectCraft service exists outside `experiments/gm-editor`; mapping its layer JSON into the editor document is the next piece of work. |

Product routing follows the workflow: HyperFrames is the default engine, EffectCraft only for complex 3D, and simple users never see an engine. `packages/contracts/src/engine.ts` holds `resolveEngine` (a non-pro caller always resolves to HyperFrames) and `previewSize` (540p / 720p, aspect preserved, never upscaled). The engine pill and mode switch render only for pro users. Simple users keep the existing Studio and comment-to-edit flow.

## Routes

- `/editor/demo`: fixtures, no backend, public. Both modes, every interaction.
- `/editor/<projectId>`: a real project (needs a session; the proxy guards `/editor/<id>` only, so `frame.html` and `gsap.min.js` stay public).
- `/editor/frame.html`: the demo's preview frame shell (`app/editor/frame.html/route.ts`).

## Backend (`backend/src/pro/`)

A pro user opens a project: its render folder (or a blank composition) is snapshotted into an editable folder `projects/<id>/pro/`, mirrored to R2 by `media.ts`. The manifest (`VideoProject.pro`) holds the revision.

| Route | Behaviour |
| --- | --- |
| `GET /v1/projects/:id/pro` | Manifest or `null` |
| `POST …/pro/open` | Snapshot (`beat-plan` or `blank`). Idempotent. Opening forks: the storyboard is untouched and edits here do not flow back into it |
| `GET …/pro/file?path=` | One text file |
| `PUT …/pro/files` | `{baseRev, files[]}`, atomic. A stale `baseRev` is **409** with the current revision. Keeps the previous copy of each touched file under `pro/.history/<rev>/` (last 20) |
| `POST …/pro/lint` | The real `@hyperframes/lint` rules, in process |
| `POST …/pro/render` | `{quality: draft540 \| preview720 \| final}`. `final` is blocked by lint errors; only a final render becomes `renderJobId`. A preview never touches project state |
| `GET /v1/preview/projects/:id/pro/@<token>/<file>` | Serves the folder to the preview frame. `__frame.html` is the shell |

Limits: editable files are `.html/.css/.js/.json`, 2 MB each, 200 files, 50 MB per project, paths confined (no `..`, no absolute). Entitlement is `PRO_USER_IDS` (comma-separated, `*` for all; always on with `AUTH_MODE=none`). No billing exists.

## The preview frame (read this before changing it)

User HTML and JS run in an iframe on a **different origin from the app** (the backend's), sandboxed with `allow-scripts allow-same-origin`. This is safe only because the origins differ, and `ClipFrame` refuses to render a same-origin frame unless the content is trusted (the demo).

A null-origin sandbox (`allow-scripts` alone) was tried first and does not work: Chrome blocks every subresource request from such a frame to a local or private address, so GSAP never loaded and nothing animated (the static end state looked plausible, which hid it). The shell page and bridge are in `packages/contracts/src/frame.ts`, shared by the editor and the backend. The editor posts the composition's HTML to the frame (`load`); a new document loads in a hidden second frame and is swapped in once it has sought, so edits never flash. The backend answers frame requests with a CSP that allows only the folder's own files (`connect-src 'none'`), and the media token travels in the URL path because the page's relative URLs do not inherit `?t=`.

Verified in Chrome against a real backend: the frame's origin is the backend's, GSAP loads from `vendor/`, `parent.document` is blocked, `fetch` is blocked by CSP. Not verified: Safari and Firefox, and the deployed (https, separate domain) topology.

## Rendering and low-res previews

`worker/src/worker.mjs` renders `kind: "pro"` jobs like beat-plan jobs, except that `variables.json` is optional and previews use `--quality draft --fps 24`, then ffmpeg scales to the size the backend computed. A preview renders the full canvas and is scaled afterwards, so it saves encode and transfer cost, not capture time (hyperframes' own `--resolution` only goes up). **The worker image must be rebuilt and released for this to run in staging.**

## Frontend structure

- `lib/editor/*.ts`: pure logic, no React: `time`, `snap`, `anim` (bezier, `valueAt`), `geometry`, `history` (undo with branches), `actions` (one registry for buttons, keys and ⌘K), `checks`, `html-source` (HTML as the source of truth, string-splice edits, GSAP tweens through `@hyperframes/parsers`), `ops`, `store`, `remote` (autosave), `render-remote`.
- A drag is one history step and Esc restores the start state (`begin / update / commit / cancel`).
- `components/editor/*`: the shell, canvas, timeline, speed graph, inspector, overlays. `lib/pro-api.ts` is the API client (Studio's `api.ts` is untouched).
- Multi-select (`lib/editor/selection.ts`, one set of rules for layers, clips and keyframes): click replaces; ⌘/Ctrl-click adds or removes one; Shift-click selects the range from the last click in the order on screen (layers and clips; for keyframes and on the canvas it adds); drag on empty timeline space draws a rubber band (⌘/Shift keeps the current selection; touching keyframes selects keyframes, otherwise bars); ⌘A selects all layers or clips; a plain click on empty space clears the selection and seeks. Pressing inside a selection keeps it, so the group drags as one (it stops as a unit at the ends); a click without a drag narrows to that item. Delete, ⌘D, Split, Easy ease and arrow nudges act on the whole selection, and Delete on selected keyframes removes the keys, not their layers. The first id is the primary one the inspector shows.
- Tests: `npm test -w frontend` (74), `npm run test:pro -w backend` (7), both in CI.

## Not done

- Layers mode against EffectCraft (above), the bridge's real transparent render, and expressions (stored, not evaluated).
- The agent dock works with a rule-based stand-in (`AgentDock.tsx`) that proposes real, reversible edits; no model is called yet.
- Dark theme is complete; F6 region cycling and Tab-through-layers on the canvas are partial.
- The handoff's open questions about EffectCraft commands, latency and checks remain open. The HyperFrames lint answer is now known: findings carry `code`, `severity`, `message`, `line`, `elementId`, `fixHint`.
