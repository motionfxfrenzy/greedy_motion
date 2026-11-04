# Live scenes: one workflow for both engines

Status: plan, 2026-11-04. Branch `codex/live-scenes`. Nothing here is deployed.

## 0. Review round 1 (2026-11-04): what changed and why

An external review checked this plan against the code. All seven points held; the plan below is revised accordingly.

| # | Finding | Verified in code | Change |
| --- | --- | --- | --- |
| 1 | The "signature" is not a hash of the authored code | `backend/src/plates/store.ts` `reviseScene` comment: "The signature stays (the inputs did not change); `rev` and `gen` rise". `variantSignature` hashes look, digests, film, beat text, frames, aspect, never the code | Cache and clip identity use a **bundle digest**: the manifest's existing `bundleSha` (sha256 of the bundle HTML) plus a font-set digest and size (§6, §9) |
| 2 | An iframe is not a separate thread; a parent timeout cannot rescue a blocked main thread | `packages/plate-engine/src/hosts/page.ts` runs on the page main thread (DOM `<canvas>`, `Image`, `AudioContext`) | Primary path is a **terminable Worker with `OffscreenCanvas`**; there is no iframe host; no Worker host support → worker-drawn clip (§10, new phase 0) |
| 3 | Repair at export breaks "render what I previewed" | §9 allowed code repair during export | **Frozen export manifest** with exact bundle digests; the worker may only verify; a repair creates a new revision returned to the preview, never a silent render (§9) |
| 4 | The cache cannot deliver the stated guarantees | 160 MB / 1.64 MB ≈ 97 frames ≈ 3.2 s at 30 fps; two pinned scenes exceed it | **Rolling frame window**, buffering gate before play, worker fallback in the **first** release (§6) |
| 5 | The patch check proves nothing for an element that exists the whole scene | §8 compared frames outside the element's active range | **Structured element parameters** instead of free code edits; continuity checks are best-effort and labelled so (§8) |
| 6 | Rollback and migration were not real | `018_plate_pipeline.sql` exists; `reviseScene` sweeps superseded objects after 24 h | Migration **019**; explicit state transitions for rollback; a **revisions table** for undo; fenced, deduplicated check reports (§11) |
| 7 | `document.fonts.check()` does not prove glyph coverage; CSP blocks fonts | MDN: `check()` is about font loading state, not coverage | Glyph coverage from font tables + render fixtures; explicit `font-src` policy; **original / display / spoken** text kept separate (§16) |

The first milestone is now a **feasibility spike on real scenes** (phase 0, §14), not more infrastructure.

## 1. Goal

Both engines follow one workflow and one UI. They differ only in what draws a frame.

| Engine | Good at | Draws a frame with |
| --- | --- | --- |
| HyperFrames | motion graphics, product UI, data | HTML/CSS + GSAP timeline (browser compositor) |
| Plates | stylised stories (`illus-*` looks) | model-written canvas code (`window.FILM`) |

```
1 Script  ->  2 Storyboard  ->  3 Animation (live, in the browser)  ->  4 Final render (CPU worker)
                                      ^   comment at a time -> patch the code -> live again (no render)
```

Principles:

1. **Everything written as code is drawn in the browser and shown to the user.** No MP4 until step 4.
2. **Same code goes to the worker.** The worker draws the exact bundle the user watched, on CPU only.
3. **A change edits code, it does not re-render.** A comment at 0:07 ("make the light green") patches that one element.
4. **The user never waits on a slow frame.** A frame cache and draw-ahead scheduler hide draw time; audio is the clock.
5. **One UI.** The **production plates Animation UI is the reference** (the user prefers it; the HyperFrames layout is retired). HyperFrames adopts the plates shell.

## 2. Today (what exists)

* **Plates step 3 (`PlatePreview`, `plate-preview.tsx`, 1.2 k lines, `plate-preview.css`) is the UI reference.** Top bar: `Audio` and `Subtitle` toggles, key-phrases mode, style, size, colours, position, a `n/5 drawn` status, and `Render · N tokens`. Below: a large stage, a control row (play, clock, current scene, volume, full screen), scene tabs `01 … 05`, and a right-hand `Comments` panel (`At 0:03` and `Scene 1` chips, textarea, `Add`, hint) with a `Redraw with comments` button. It plays **worker-drawn MP4 clips**; every comment rewrites the scene and the worker redraws it.
* HyperFrames step 3 (`BrowserAnimationStep` in `studio.tsx`) is already live in the browser (`<hyperframes-player>`), but its layout (`Animation` header, `ce-player`, `ce-timeline`, `ce-aside`) is the one the user dislikes; it is replaced by the plates shell.
* Worker: after authoring, `plate-render` verifies in Chromium and draws every frame to an MP4 (40-56 s per scene on Fargate; ~3-4 fps incl. PNG encode). The final render joins the clips.
* Measured spike (2026-11-04, Apple Silicon Chromium, 1080p): the same bundles draw live at 39.5 / 29.3 / 19.6 fps (balloon / blueprint / fox). Live and worker frames look the same but are not byte-identical.

## 3. Target workflow

### Step 3 (both engines)

1. Enter step 3: the shared `AnimationPrep` screen shows progress while code is authored and checked.
2. Authoring finishes per scene: the scene is **ready to play** as soon as its code compiles and the browser check passes. No worker involved.
3. The shared `AnimationWorkspace` plays the film: audio is the master clock; the engine adapter draws frames.
4. Comment at time T: the shared composer sends `{ scene, atSeconds, text }`. The engine patches that scene's code; only that scene reloads.
5. `Final render · N tokens` starts step 4.

### Step 4

1. Worker receives the frozen export manifest (§9), downloads exactly those bundles, **verifies each again**, draws missing scenes on CPU (software GL, no GPU), reuses clips cached by `bundleDigest` (+ font set), encodes, adds audio/subtitles, uploads the MP4.
2. A failed verification at this point **never repairs and never draws**: the job stops before any frame, nothing is charged, and the scene returns to step 3 as `needs fix` with a repair revision the user previews and approves (§9).
3. Optional (phase 4): when the user is idle in step 3, the backend schedules background clip drawing for finished scenes so step 4 is often just a join.

## 4. UI consistency

One shell, two adapters. The shell is **extracted from `PlatePreview`** (not from the HyperFrames step) as `AnimationWorkspace`:

| Piece (plates layout) | Shared | Engine-specific slot |
| --- | --- | --- |
| Top bar: `Audio`, `Subtitle`, key-phrases mode, style, size, colours, position | yes | HyperFrames shows only the options its compositions honour (audio, subtitle on/off, key phrases); extra controls are hidden, not disabled |
| Status chip (`n/5 ready`) and `Render · N tokens` button with token modal | yes | none |
| Stage with aspect picker (16:9 / 9:16 / 1:1) | yes | `renderStage()` returns the engine's surface |
| Control row: play, clock, current scene, volume, full screen | yes | none |
| Scene tabs `01 … 05` (state per tab: ready / updating / needs update) | yes | scene spans from the adapter |
| Comments panel: `At 0:03` + `Scene 2` chips, textarea, `Add`, list, `Apply comments` | yes | HyperFrames' composition patch vs plates' scene patch behind the same API |
| Prep screen (progress, per-scene ✓/⋯, error + retry) | yes (`AnimationPrep`) | stage names |

Rules: the same copy, empty and error states, keyboard shortcuts and responsive layout (stage + side panel stack under 900 px), dark and light tokens, for both engines. `BrowserAnimationStep`'s `ce-*` classes and `plate-preview.css` are replaced by one stylesheet for the shell. The plates controls the user likes (minimal icons, hover-only volume slider) are kept as they are.

### Patterns to keep (from the production storyboard and animation steps the user likes)

Verified in the production app on 2026-11-04 (`script-canvas.tsx` for the storyboard, `plate-preview.tsx` for the animation step). These become named, reusable pieces, not copies:

1. **Button becomes a bar.** A long action (`Build voiceover and music`, `Rebuild voiceover and music`) turns into a disabled `role="progressbar"` button with the percentage inside (`aria-valuenow`, tabular numbers), same width, no layout jump; when done it returns to the action. `ProgressButton` component. Used for: preparing live scenes, applying comments, final render, background clip drawing.
2. **Live status line under the title.** `● Recording voiceover and music in parallel · 5/5 scenes ready · 78%` with the pulsing `sc-live` dot, `aria-live="polite"`; at rest it reads `5 beats · 46 spoken words · about 24s · 5/5 voiced`. `StatusLine` component; step 3 reads `● Preparing live scenes · 3/5 ready · 60%`, at rest `5 scenes · 24s · all playable`.
3. **Per-scene rows with their own controls.** Beat title, `Reimagine`, visual / on-screen / voiceover lines, an inline audio player with `Retry voice`, and the reference frame on the right. Scene tabs `01…05` in the animation step carry the same per-scene state (ready / updating / needs update).
4. **Floating command bar** (`Ask for a change, or click a scene to refer to it` with quick chips such as `Make it punchier`, `Shorter`, `More playful`) stays on the storyboard; in step 3 the timed comment composer is its sibling and uses the same chip row for comment examples.
5. **One primary action per step** (`Create animation →`, then `Render · N tokens`), top right, with the token modal; disabled with a reason, never hidden.
6. **Reference first, real frame later (keep exactly).** The storyboard shows a **reference frame** per scene: a cheap model-drawn sketch that only represents the idea (`frames_sketched`, instant, no scene code). The animation step builds the **actual drawn frame** from the scene code. Live scenes keep this two-tier shape: while a scene is not playable yet, its reference frame fills the stage (and the scene tab); when the first live frame is drawn it cross-fades in (150 ms); if the live scene later fails or stalls, the stage falls back to the last good frame or the reference with a notice. The reference frame is never presented as the final look, and storyboard edits (`Reimagine`) change only the reference until the user continues.
7. **Animation step chrome:** top options bar (`Audio`, `Subtitle`, key phrases, style, size, colours, position, status chip), stage with ratio picker, minimal control row, scene tabs, right-hand `Comments` panel, `Apply comments` (a `ProgressButton`).

## 5. Player contract

```ts
interface ScenePlayer {
  readonly meta: { width: number; height: number; fps: number; frames: number; sceneSpans: { start: number; end: number }[] };
  mount(el: HTMLElement): Promise<void>;          // resolves when the first frame can be drawn
  showFrame(frame: number): void;                 // draw (or blit from cache) now; never throws
  ready(frame: number): boolean;                  // is this frame available without drawing?
  buffered(): { from: number; to: number }[];     // for the buffer bar
  on(event: "error" | "buffering" | "ready", cb): () => void;
  destroy(): void;                                // free memory, stop timers, terminate Workers
}
```

* **HyperFrames adapter** (the player inside the plates shell): wraps `<hyperframes-player>` (seek by seconds). DOM animation is drawn natively by the browser, so no frame cache; `ready()` is always true.
* **Plate adapter:** one terminable Worker per playing scene (bundle from a signed URL, `OffscreenCanvas`), `window.FILM`-equivalent API (`ready`, `mount`, `warm`, `seek`, `meta`) behind a message channel; draws into the frame cache. Where the Worker host is unsupported the scene plays its worker-drawn clip (§10); there is no iframe host.
* **Clock:** `PlaybackClock` (audio element = master). Player asks `clock.now()` → frame index. If `ready(frame)` is false the player **holds the last frame**, never stalls audio, and shows the buffer indicator.

## 6. Frame cache (plates)

* **Identity (fixes review #1):** the existing `variantSignature` hashes *inputs* (look, digests, film, beat text, frames, aspect) and deliberately **stays the same after a comment** (`reviseScene`), so it must never key frames or clips. A new immutable **`bundleDigest`** is used everywhere a frame or clip is cached or compared: `sha256(bundle.html)` (the manifest already stores it as `bundleSha`) combined with **`paramsDigest`** (sha256 of the canonical, key-sorted JSON of the scene's current params, which live in `plate_revisions` and not in the HTML), `fontSetDigest` (hash of the font files available to the renderer) and `engineDigest`. A params-only comment therefore changes `bundleDigest`. The previewed Worker host and the CPU export receive the **same** code, params, assets and fonts (phase 0 proves it). Any change to code, embedded assets, fonts or engine changes the digest; an unchanged digest means identical drawing input.
* **Key:** `bundleDigest | frame | previewSize`. A frame is a pure function of the key *for one renderer environment*; entries are never shared across devices.
* **Entry:** `ImageBitmap` at preview size (default 854×480 ≈ 1.6 MB; 9:16 → 480×854; 1:1 → 640×640). Every bitmap is `close()`d on eviction, drop, replace and `destroy()`.
* **Rolling window derived from the byte budget (not from seconds):** `windowFrames = floor(budgetBytes / bytesPerFrame)`; at 160 MB and 1.64 MB that is **97 frames (~3.2 s at 30 fps)**. The window is split 20 % behind the playhead, 15 % (capped at 15 frames) head of the next scene, and the remainder ahead: about 19 / 14 / 64 frames, i.e. **~2.1 s of lead** at the default budget. Budget (`LIVE_CACHE_MB`): 160 default, 80 on `deviceMemory <= 4`, 60 on iOS; a larger preview size shrinks the window, never the budget. Whole-scene pinning is removed; pins only decide eviction order. A test asserts `resident bytes <= budget` for every window split.
* **Buffering gate:** playback starts when `bufferedAhead >= lead`, where `lead = clipSeconds * max(0, 1 - produceFps / consumeFps)` (+ 0.5 s margin) measured from the draw-cost average, and the gate uses the **actual ahead capacity** from the byte budget above. If `lead` exceeds that ahead capacity (the device draws slower than real time by too much, e.g. 20 fps scenes on a 30 fps film), live playback is **not offered**: the scene uses the worker-drawn clip (§6, fallback) from the first release.
* **Draw-ahead scheduler:** runs **inside the same Worker as the scene** (§10), so a slow draw never blocks the page and the 8 ms slice problem disappears: the scheduler budgets between frames, the Worker thread absorbs the 50 ms draw. On the main-thread fallback host, slices are `requestIdleCallback` based and a single draw longer than the slice is accepted (documented limit; see watchdog §10).
* **Order:** playhead → 4 s ahead → first 15 frames of the next scene → remaining window behind the playhead. Re-prioritises on seek.
* **Real-time fallback (first release):** `Draw a preview video for this scene` queues the existing worker clip path (`plate-render`), cached by `bundleDigest`. It is a normal, supported path, not an afterthought.
* **Persistence (later):** optional IndexedDB store of encoded frames per `bundleDigest`, 100 MB cap.
* **Observability:** `live_preview_stats` (cache hit rate, dropped frames, ms/frame p50/p95, device class, host type) once per session.

## 7. Authoring, checks and states

Today: `queued → authoring → bundled → (worker) rendering → drawn | failed`; `bundled` enqueues `plate-render`.

New (flag `PLATE_LIVE_PREVIEW`): `queued → authoring → bundled → checked` where **`checked`** means the browser check passed and the scene is playable. `plate-render` is **not** enqueued at `bundled`; it is enqueued at step 4 (or by background prefetch). `drawn` keeps its meaning: a CPU-drawn clip exists in R2.

Browser check (runs in the Worker host, reports to `POST /v1/projects/:id/plates/:variantId/check`):

* no page errors; `FILM.meta` matches the plan (size, fps, frames);
* frames 0, mid, last drawn twice give identical pixels (determinism) - same rule as the worker;
* no blocked network attempts, no navigation, runtime under a watchdog (§10).

Result handling: `ok` → state `checked`; `code` failure → existing repair loop (bounded by `PLATE_MAX_AUTHOR_CALLS`); `env` failure (device cannot draw) → not the model's fault, no repair, offer worker fallback. The report is **advisory**: the worker verifies again at step 4, so a lying client cannot get an invalid scene rendered.

## 8. Comment → change

Review #5: free-form code patches cannot be *proven* local. The edit path therefore changes **structured parameters first**, code only when parameters cannot express the request.

* **Scene = code + parameters.** Authoring emits scene code that reads every tunable value from a `params` object (`params.light.color`, `params.boat.x`, `params.moon.size`), declared with a schema (type, range, element id, `activeFrames`). The bundle manifest lists `{ id, kind, params schema, activeFrames }`. The code is fixed by authoring; most comments only change values.
* **Edit request:** `{ sceneIndex, atFrame, text }` → the model gets the params schema + current values, the elements active at `atFrame`, and the comment. It returns a **params patch** (`{ "light.color": "#3fbf5a" }`), validated against the schema (type, range, element exists). The allow-list is the schema: there are no "extras".
* **Code change fallback:** when a request needs something the parameters cannot express ("add a second boat"), the model returns a code patch (`{ find, replace }` blocks, ≤ `PLATE_PATCH_MAX_LINES` = 80, must compile, must pass the browser check). This is labelled to the user ("changes the drawing, not just a value") and keeps its previous revision for undo.
* **Continuity checks are best-effort:** after a params patch we compare frames of **other elements** by drawing them in isolation (element layers are drawn separately when the manifest provides them) and flag differences; for code patches, a frame-hash comparison outside the element's `activeFrames` runs only when such frames exist, and the UI says "no unrelated changes detected" (never "guaranteed").
* **"The same light as before":** element ids are stable across revisions (the schema is carried forward); a revision that renames or drops an id is rejected unless the user asked.
* **Cost:** one model call per apply (allowance/`preview_call_cap`); several comments on one scene in one apply = one call. No worker call.
* **Undo:** every apply writes a row in `plate_revisions` (variant id, rev, `bundleDigest`, source key, bundle key, params, author = comment id, created at) that is retained for the life of the project; the objects it points to are exempt from the 24 h garbage sweep until the project is deleted or the revision is pruned (keep last 20 per scene). Undo creates a new revision that points to the old objects (history is append-only).
* **HyperFrames:** same API shape; compositions already carry element ids, so the params-first rule applies to their `data-*`/CSS variables and the code fallback to the composition file.

## 9. Final render (step 4)

Review #3: the render must produce what the user previewed.

* **Frozen export manifest:** clicking `Render` creates an immutable manifest `{ projectId, revisions: [{ scene, aspect, bundleDigest, bundleKey, paramsDigest, params }], timing (frames per scene), audio (voice + music object keys + digests), subtitle settings, aspect, fps, engineDigest, fontSetDigest }`, stored in R2 and referenced by the job. The worker renders **only** that manifest.
* **No silent repair:** the worker verifies each bundle (§7). If a scene fails verification, the job **stops before drawing**, nothing is charged, and the scene is marked `needs fix` with a new repair revision produced by the bounded repair loop **and returned to step 3 for preview**. The user re-approves and clicks Render again with a new manifest.
* Worker Chromium is launched with software GL flags (`--use-gl=angle --use-angle=swiftshader`, `--disable-gpu`); a startup self-check records the renderer string and **refuses to render** if a GPU path is detected.
* Draw only scenes without a clip for their `bundleDigest` (+ font set); then encode + audio + subtitles.
* **Billing:** price shown at click; tokens are **held** when the job is accepted and **settled on success**; any failure other than user cancellation releases the hold. Idempotency key per click.
* Parallelism: scenes are independent jobs on `plate-render`; capped per project (`PLATE_PROJECT_CAP`) and by the DB connection budget (`JOB_CONTROL.md`).

## 10. Execution and safety of running model code in the user's browser

Review #2: an iframe shares the page's thread unless the browser happens to isolate it, so it cannot be the primary safety mechanism.

* **Primary: a terminable Worker host.** A new `worker` host for the plate engine (`packages/plate-engine/src/hosts/worker.ts`) runs the scene core in a dedicated **Web Worker** with `OffscreenCanvas` (the core already draws on `Layer` surfaces that are `OffscreenCanvas` when available and "cannot tell the difference"). Images load with `createImageBitmap`, fonts with `FontFace` in the worker. The page receives `ImageBitmap`s by transfer. The watchdog is `worker.terminate()`: a draw that takes > 2 s, a missing heartbeat for 3 s, or a memory-guard breach terminates and recreates the worker without touching the page.
* **No iframe host.** Where Worker + `OffscreenCanvas` 2D are unsupported, or the device is untested, the scene uses the **worker-drawn clip** directly. A sampled check cannot prove later frames will not hang a non-terminable host, so no host that cannot be terminated ever runs model code on the page thread.
* **Containment is verified, not assumed (phase 0):** a Worker has no DOM but still has `fetch`, `importScripts`, IndexedDB, `BroadcastChannel`. Mitigation to be proven in the spike: the Worker is created from a blob with its own CSP (`connect-src 'none'`) and the bundle is stripped of those globals before the scene runs (`self.fetch = undefined` etc. is defence in depth, not the boundary); memory is **not** observable per Worker, so the guard is a frame/bitmap byte count kept by the host plus a draw-time and heartbeat watchdog, and a tab-level `performance.measureUserAgentSpecificMemory` where available.
* **Prototype first (phase 0):** run real scenes in the Worker host on Chrome, Safari (macOS + iOS), Firefox and a low-end Android; record draw ms/frame, memory, whether `OffscreenCanvas` 2D filters/`shadowBlur`/`globalCompositeOperation` render the same as the DOM canvas, and whether `terminate()` recovers an infinite loop within the watchdog budget.
* **CSP and fonts:** bundles run with `default-src 'none'; script-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:`. Fonts the scene needs are **embedded as data URLs by the bundler** (size budget 300 KB per bundle, subset per script) or provided by the host via `FontFace` objects loaded from signed same-project URLs through the parent (not by the scene). Scenes cannot load fonts by URL.
* **Messages:** `postMessage` with a per-host nonce; the parent validates shapes and sizes; bitmaps are transferred, never shared memory.
* **Memory guard:** destroy scenes not within ±1 of the playhead after 60 s; a Worker allocating beyond its quota is terminated.
* The scene never sees user data; bundles come from R2 through short-lived signed URLs after the ownership check.

## 11. API, data and rollout

* `GET /v1/projects/:id/plates/:variantId/bundle` → `{ url, expiresAt, manifest }`.
* `POST /v1/projects/:id/plates/:variantId/check` → body `{ gen, bundleDigest, host, device, results }`; **fenced** by `(variant, gen, bundleDigest)`: a report for an older generation or a different digest is dropped (204, logged); duplicates are idempotent (unique on `(variant_id, gen, bundle_digest, host)`); a client report can only move `bundled → checked`, never to `drawn`.
* `POST /v1/projects/:id/plates/edit` → `{ scene, atFrame, text }[]` → 202; returns the new `rev`/`gen` per scene.
* `POST /v1/projects/:id/plates/revisions/:variantId/undo` → new revision pointing at an earlier one.
* `POST /v1/projects/:id/plates/render` → freezes the export manifest and starts step 4 (idempotency key).
* **Migration `019_plate_live.sql`** (018 is `018_plate_pipeline.sql`): `plate_variants.checked_at`, `check_report jsonb`, `bundle_digest text`, `host text`; state constraint gains `checked`; new `plate_revisions` table; `plate_garbage` skips objects referenced by a revision.
* **State transitions with the flag:** `PLATE_LIVE_PREVIEW=on`: `bundled → checked` by a fenced report, no `plate-render` enqueued. `=off`: `bundled → rendering → drawn` as today.
* **Flag precedence:** `PLATE_LIVE_PREVIEW` decides the mode only for a project's **first entry to step 3**; the result is stored as `live_mode` and **survives flag changes**. Normal rollout (flag on→off) therefore affects new projects only; existing live projects keep playing live. Reconciling existing projects needs an **explicit rollback override** `PLATE_LIVE_FORCE_OFF=1` (operator action, logged).
* **Rollback (override on):** the reconciler (`plates/reconcile.ts`) sets `live_mode=clip`, treats `checked` like `bundled` and enqueues `plate-render` for every `checked` variant of projects in step >= 3 (rate-limited, project cap respected). In-flight edits finish normally; a `checked` report arriving afterwards is accepted but changes nothing. Existing clips (`drawn`) are untouched. Users mid-session see the clip player after a reload.

## 11b. Authoring stream (plan only, not built)

Goal: the user always sees progress, never a raw failure, and Railway load does not grow.

* **Only validated content reaches the user.** Raw model tokens are never forwarded: they can be partial, invalid or unsafe. The stream carries (1) **stage events** (`queued`, `sketching`, `checking`, `refining`, `ready`) and (2) after the bundle passes server validation (schema, esbuild compile, static rules), the **validated source as a typed replay** followed by `ready`.
* **Failures are absorbed.** A failed validation or a repair attempt is reported as `refining` with no error text. The user sees an error only when the bounded repair budget is exhausted, and then as a retry offer, never a stack trace.
* **Transport:** the existing push channel (SSE, as for render events); the authoring job publishes events, the API relays them. Cost: one idle connection per active author, no extra model or DB work. This does **not** reduce Railway load; moving authoring to a queue consumer (ECS/Lambda) is the load lever, decided by measurement.
* **Later option, separate decision:** layered authoring (sky, ground, objects) so each validated layer can draw as it arrives.
* **Tests:** no unvalidated byte is ever emitted; a failed attempt emits only `refining`; reconnect resumes from the last event id; an exhausted budget emits one user-facing retry state.

## 12. Edge cases

**Device and browser**
1. Safari/iOS: OffscreenCanvas/ImageBitmap limits, memory kills tab → lower budget on iOS, test on real Safari.
2. Low memory (`deviceMemory <= 4`) → smaller cache and 640 px frames.
3. Hidden tab: `requestAnimationFrame` stops; pause playback and scheduler; resume cleanly, audio never runs ahead.
4. Resize / fullscreen / device pixel ratio change: re-blit from cache, no redraw; cache is size-independent of the display.
5. Autoplay policy: first play needs a gesture; show the play hint, never throw.
6. Reduced-motion preference: start paused.
7. Very slow device: fallback to worker preview clip per scene (§6).
8. Browser without `ImageBitmap`/`requestIdleCallback`: polyfill with `setTimeout` and canvas copies.

**Playback**
9. Scrub into an uncached region: show nearest cached frame, draw target first, then fill.
10. Rapid scrubbing: cancel stale draw requests; only the latest target is drawn.
11. Seek exactly on a scene boundary: both scenes mounted; no flash of the previous scene.
12. Audio shorter/longer than the plan: clock follows audio; frame index clamps to the last frame.
13. Voiceover not ready yet: play silently with a "voice is being recorded" badge; start audio when it arrives at the right offset.
14. Loop/replay: cache retained; no re-mount.
15. Aspect change (three ratios): only the viewed ratio's bundles are loaded; switching unloads the others.

**Reference to live handoff**
15a. Live scene ready before its reference frame loads: show the live frame only; never flash the reference after it.
15b. Reference exists but the scene code failed authoring: the tab shows the reference with "Scene could not be built" and `Fix this scene`; nothing blank.
15c. User changes the reference (`Reimagine`) after scenes were built: scenes are marked "needs update" (reference and scene differ) instead of silently rebuilding.

**Authoring and edits**
16. Scene code compiles but throws at frame N: check catches only sampled frames - runtime error mid-playback marks the scene `failed-live`, shows the last good frame, and offers `Fix this scene` (repair loop).
17. Patch does not apply (find missing/ambiguous): retry once with the current source; then show "Could not apply that change" and keep the old scene.
18. Patch touches unrelated elements or exceeds the size cap: rejected (§8).
19. Model returns identical code: tell the user "nothing changed" and refund the allowance unit.
20. Two comments contradict (e.g. "red" and "green"): the later wins; both shown in the reply.
21. Comment on a frame with no element: model told "no element active"; asks for scene-level change or applies to the background layer; never silently ignores.
22. Edit while another edit is applying (same scene): second queued; generation fencing; the UI disables `Apply` for that scene only.
23. Two tabs editing the same project: last writer wins by generation; the other tab sees "Updated elsewhere" and reloads the scene.
24. Voiceover timing changes scene length: the input signature changes, the scene is re-authored/retimed and gets a new `bundleDigest`; cached frames of the old digest are dropped for that scene only.
25. Preview allowance exhausted mid-apply: existing `preview_limit` dialog; scene unchanged.
26. User edits the storyboard text after animation exists: affected scenes become stale; step 3 shows them as "needs update".

**Final render**
27. Worker unavailable / cold start: job shows "Starting render worker"; retries; no charge until accepted.
28. Verification fails at the worker though the browser passed: repair loop; if exhausted, fail with no charge and tell the user which scene.
29. Worker killed mid-render (Spot): attempt fenced, retried; clips already drawn are kept by `bundleDigest`.
30. User clicks `Final render` twice: idempotency key → one job.
31. User leaves the page mid-render: job continues; Projects shows progress; email when ready (existing).
32. Insufficient tokens: existing token modal before the job is created.
33. Different CPU architecture produces a different frame than the preview: documented; the worker is the source of truth; step 3 never promises byte equality.
34. Clip cache hit with stale engine version: `bundleDigest` is keyed with `engineDigest` and `fontSetDigest`, so no hit.

**Security**
35. Scene code tries `fetch`, `XMLHttpRequest`, `WebSocket`, `window.top`, `localStorage`, `eval` of remote code: blocked by sandbox/CSP; attempt is logged as `blocked` and fails the check.
36. Scene allocates memory in a loop / infinite loop: the watchdog `terminate()`s the Worker and recreates it; the page stays responsive; after two terminations the scene switches to its worker-drawn clip.
37. Bundle URL leak: short TTL, ownership-checked, `Cache-Control: private`.
38. Forged check report: advisory only; worker re-verifies.

## 13. Test plan

**Unit (node --test, `frontend/test/`)**
* `live-cache.mjs`: key function, LRU by scene, pinning, budget enforcement, eviction order, hit/miss counters, resolution downgrade.
* `live-scheduler.mjs`: priority order, re-prioritisation on seek, time-slice budget (fake clock), pause/resume, cancellation.
* `live-clock.mjs`: audio-master mapping, clamp, hold-last-frame, drift correction, hidden-tab pause.
* `live-patch.mjs` (backend): apply/validate patches: ambiguous/missing find, size cap, id allow-list, unchanged code.
* `plate-contract.mjs`: both adapters satisfy `ScenePlayer` (fake FILM and fake hyperframes-player).

**Review-driven tests (new)**
* `bundle-digest.mjs`: a comment (params or code) changes `bundleDigest` while `variantSignature` stays; a font-set change changes the digest; identical inputs give identical digests; frame/clip caches never hit across digests.
* `live-worker-host` (browser): terminate-on-hang recovers within the watchdog; page stays responsive during a 2 s blocking draw; memory stays flat across 20 loops; OffscreenCanvas frames match DOM-canvas frames within a measured tolerance per look.
* `export-manifest.mjs`: manifest freezes digests; a bundle changed after the click is not rendered; verification failure produces a returned revision and **no** render and **no** charge.
* `plate-checks-fencing.mjs`: stale `gen`, wrong digest, duplicate and forged reports; a report cannot set `drawn`.
* `plate-rollback.mjs`: flag off with `checked` variants queues `plate-render`; in-flight edits finish; per-project `live_mode` is stable.
* `plate-revisions.mjs`: undo restores objects after the 24 h sweep; revisions survive garbage collection; prune keeps the last 20.
* `plate-params.mjs`: schema validation rejects out-of-range/unknown ids; a params patch changes only the named element's isolated layer.

**Integration (backend, real Postgres, `backend/test/`)**
* `plate-live.mjs`: state machine `bundled → checked`, no `plate-render` enqueued with the flag on, enqueued with it off; check report fencing by `gen`; forged/late reports; edit creates `gen+1`; undo.
* `plate-edit.mjs`: patch pipeline with a stub model: success, retry on bad patch, reject rewrite, allowance accounting.
* `plate-render-billing.mjs`: hold/settle/release, idempotency, failure paths.

**Browser (Playwright against the built frontend + a local backend stub)**
* live playback: frames drawn vs clock, dropped-frame ratio, cache hit rate after a loop;
* scrub storms; resize/fullscreen; hidden-tab pause; autoplay gesture;
* sandbox: scene trying fetch/top/localStorage/infinite loop → blocked, page responsive;
* slow-device simulation (CPU throttling 6×) → downscale then fallback offer;
* UI consistency: screenshot diff of the shared shell for both engines (same layout, same controls), light and dark, 1440/1024/400 px.

**End to end (compose `plates-e2e` + `llm-stub`)**
* author → check → play → comment → patch → play → final render on CPU → `ffprobe` (size, fps, frames, audio) and "no GPU renderer string";
* worker killed mid-render; duplicate clicks; failure after hold (release);
* parity report: live frames vs worker frames (mean absolute error per scene) logged, budgets set from the baseline.

**Performance budgets (enforced in CI where possible)**
* time to first frame ≤ 1.5 s after bundle ready; steady state ≥ 24 fps for the reference scenes on a mid laptop profile; cache memory ≤ budget; patch apply+check ≤ 15 s p95 (model time excluded).

## 14. Phases

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| **0 (first milestone)** | **Real-scene feasibility spike**: (a) Worker + `OffscreenCanvas` host for 5+ real production scenes across looks; (b) terminate-on-hang proven; (c) memory bounded over a 3-minute loop and 20 scrubs; (d) slow-device behaviour (6× CPU throttle, iOS Safari, low-end Android) with the buffering gate and worker-clip fallback; (e) export of an **immutable previewed bundle** (digest equals what the worker renders); (f) live-vs-worker difference report; (g) **containment**: show what network/storage access a Worker scene has and how it is restricted, and what memory can actually be accounted for; (h) **identity through both hosts**: Worker preview and CPU export run the same code, params, assets and fonts (digests equal, pixel diff reported); output is measurements plus a **browser support / fallback matrix** where untested browsers stay explicitly `unverified` | written results with numbers; decision recorded: Worker host viable on which browsers; fallback matrix; go/no-go for phase 2 |
| 1 | `ScenePlayer` contract, `FrameCache`, `FrameScheduler`, `PlaybackClock` + unit tests (done) | all unit tests green; revised to key on `bundleDigest` and a rolling window after phase 0 |
| 2 | **Gated on phase 0 results.** Plate live adapter (Worker host; unsupported devices use the clip), bundle/check routes, state `checked`, flag, migration 019 | plates play live on staging with the flag on; sandbox tests green |
| 3 | Shared `AnimationWorkspace` + `AnimationPrep` extracted from `PlatePreview`; HyperFrames moves onto it | screenshot diff shows identical shell; old HyperFrames `ce-*` layout removed |
| 4 | Comment → patch editing with element ids | patch tests green; real scene "make the light green" changes only that element |
| 5 | Step 4: worker draws on demand, GPU-off self-check, billing hold/settle | e2e green; failed render releases tokens |
| 6 | Background clip prefetch, IndexedDB cache (the slow-device worker fallback ships in the first release, phase 2) | final render of a cached film ≤ 15 s |

Rollout: each phase behind `PLATE_LIVE_PREVIEW` on staging first; production only after the staging e2e and a manual pass on Safari/iOS and a low-end Android.

## 15. Decisions taken (change if you disagree)

* The browser check is advisory; the worker is authoritative.
* Final render draws on demand; background prefetch is phase 6, not v1.
* The shared UI is the **plates layout** (the user's preference); HyperFrames adopts it and hides controls its compositions do not support.
* HyperFrames keeps its native player; it gets the shared shell and the comment→patch API, not the frame cache.

## 16. Languages (text, script, voice, captions)

Goal: a user can write or paste a script in **any language the LLM and the speech model support**, in the script they naturally type: native script, **romanised** (Roman Hindi / Roman Urdu / Hinglish), or mixed. Hindi and Urdu speech is the same language written in two scripts (Devanagari vs Nastaliq); users write all three forms. The pipeline must understand the input and produce a script, voice, captions and on-screen text in the chosen language.

**Already being built by the "Audio and video generation prompts" session (do not duplicate; integrate):** `audio.language` on the brief (`voiceLanguages` in `contracts/src/audio.ts`, currently `en` and `hi`), a `languageRule` in `plan/director.ts` (the user's own script is kept verbatim), `voice.ts` timing from measured audio (`secondsFor` = voice length + 0.3 s, `followAudio`), Gemini alignment for non-English, `fonts-noto-core` in the worker image. Known open items from that work: Urdu script is spoken as Hindi by the speech model, Devanagari/RTL captions (fonts and right-to-left layout), key phrases coming out romanised.

**Plan additions**

1. **Language model of the brief:** `brief.audio.language` (spoken language, BCP-47 such as `hi`, `ur`, `ar`, `es`) and `brief.inputScript` (`native` | `roman` | `mixed`, auto-detected from the text, editable). The language list is generated from one table that records, per language: LLM support level, TTS voice availability, script(s), direction (`ltr`/`rtl`), required fonts, whether the TTS handles each script directly. Only languages that pass **both** the LLM and the speech model are offered; others are shown disabled with the reason.
2. **Input understanding:** the script writer and the director receive `inputScript` and `language`. Romanised input is **transliterated or translated into the target script for display text and into speakable text for the voice** by an explicit step (model call with a fixed prompt and examples: Roman Hindi → Devanagari, Roman Urdu → Nastaliq/Hindustani speech, Arabizi → Arabic), never guessed per downstream stage. The user sees and can edit the normalised script before the storyboard is built.
3. **Own words stay verbatim:** if the user pasted a finished script, it is used as written (existing rule); the helper only normalises script/transliteration when asked.
4. **Voice:** per-language voice list; Urdu falls back to the closest supported voice with a visible note until the speech model supports it; speech timing always follows measured audio (frames derive from audio length).
5. **Captions and on-screen text:** font stacks per script (Noto Sans Devanagari/Arabic/Nastaliq Urdu/CJK as required), shaping and RTL handled in **three** renderers that must agree: the live scene canvas (`fillText` with `direction`), the worker's subtitle PNG renderer (`renderSubtitlePng`, SVG text), and HyperFrames compositions (CSS `direction`, `lang` attributes). The studio's own interface stays English for now (interface localisation is a separate, later item).
6. **Comments in any language:** the comment→patch model call takes the comment as written, replies and edits in the film's language, and never translates unless asked.
7. **Keywords and key phrases:** generated in the film language by default; a per-film switch keeps key phrases in English for brand-style films (the open item above).
9. **Three text forms, never mixed (review #7):** `originalText` (what the user typed, verbatim, in whatever script), `displayText` (what appears on screen / captions, in the film's script, may be a transliteration), `spokenText` (what the voice reads, normalised for speech). Normalisation produces display/spoken from the original and never overwrites it; "own words stay verbatim" applies to `originalText` and to `displayText` when the user did not ask for transliteration. Each form has its own edit surface and its own signature input.
8. **Scene code and RTL/complex scripts:** the plate authoring prompt gets a rule that text inside scenes must use the shared text helper (`text(ctx, str, {lang, dir})`) so direction, font fallback and line breaking are consistent; glyph coverage is checked from the **font tables** (cmap coverage of the exact fonts in the font set, computed in the bundler/worker and reported in the manifest) plus **render fixtures** per script that compare drawn text against expected non-tofu pixels. `document.fonts.check()` is **not** used for this: it reports loading state, not coverage.

**Edge cases (languages)**
* Mixed-language lines (Hinglish): language per line is kept; TTS receives the line with its dominant language; captions break at language switches only when needed.
* Digits and punctuation per locale (Arabic-Indic digits, Devanagari danda): normalised for TTS, kept as written for captions unless the user asks.
* Very long words / no spaces (Thai, CJK): caption line breaking uses `Intl.Segmenter`; fallback to character breaks.
* RTL text with LTR product names: bidi isolation so names do not reorder punctuation.
* Missing font in the worker or the browser: the check lists the missing codepoints; the preview shows a notice and the worker image is rebuilt with the fonts before step 4 (never render with tofu).
* Language set after the script was written, or changed later: scenes that depend on language are marked "needs update"; cached frames for them are dropped when their `bundleDigest` changes (language is part of the signature).
* Speech model returns another language than requested (the Urdu → Hindi case): detected by the alignment step and shown to the user, who can pick a supported voice or continue.
* Script too short or too long in a language where speaking is slower/faster: duration estimates use per-language speaking rates; final timing follows audio.

**Tests (languages)**
* `backend/test/voice-language.mjs` (the other session's) stays the home for voice/timing; extend with `hi`, `ur`, `ar`, `es` fixtures.
* Normalisation unit tests: Roman Hindi → Devanagari, Roman Urdu, Arabizi, mixed lines, numbers (stub model with golden pairs; a live-model check run manually and recorded).
* Caption rendering golden images per script (Latin, Devanagari, Arabic, Nastaliq) in all three renderers, checked for glyph coverage and direction; tofu detector unit test.
* Browser check: scene with missing glyphs (by cmap coverage and by render fixture) is rejected; RTL scene passes; CSP `font-src` blocks a scene that tries to load a font by URL.
* Acceptance scope for languages is **separate** from live preview: it ships per language behind its own flag with its own fixtures (§16 tests); live preview does not wait for it and it does not block live preview.
* E2E: one short film per language family (en, hi-Devanagari, hi-Roman, ur, ar, es) through step 3 and step 4, asserting audio language, caption script, frame counts follow audio.

**Phases:** language table and `inputScript` (P1 of this section, with phase 1 of §14); normalisation step and editable script (with phase 2); text helper, font stacks and tofu check (with phase 2/3); per-language e2e (with phase 5). Coordination: the voice and director parts stay with the other session; this plan owns the studio shell, the check and the render side.
