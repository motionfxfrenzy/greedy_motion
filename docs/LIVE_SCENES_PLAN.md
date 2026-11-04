# Live scenes: one workflow for both engines

Status: plan, 2026-11-04. Branch `codex/live-scenes`. Nothing here is deployed.

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

1. Worker receives `{ project, signatures }`, downloads the same bundles, **verifies each again**, draws missing scenes on CPU (software GL, no GPU), reuses clips cached by signature, encodes, adds audio/subtitles, uploads the MP4.
2. A failed verification at this point runs the bounded repair loop before any frame is drawn; if it still fails the job fails **without charge** (§9).
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
6. **Animation step chrome:** top options bar (`Audio`, `Subtitle`, key phrases, style, size, colours, position, status chip), stage with ratio picker, minimal control row, scene tabs, right-hand `Comments` panel, `Apply comments` (a `ProgressButton`).

## 5. Player contract

```ts
interface ScenePlayer {
  readonly meta: { width: number; height: number; fps: number; frames: number; sceneSpans: { start: number; end: number }[] };
  mount(el: HTMLElement): Promise<void>;          // resolves when the first frame can be drawn
  showFrame(frame: number): void;                 // draw (or blit from cache) now; never throws
  ready(frame: number): boolean;                  // is this frame available without drawing?
  buffered(): { from: number; to: number }[];     // for the buffer bar
  on(event: "error" | "buffering" | "ready", cb): () => void;
  destroy(): void;                                // free memory, stop timers, remove iframes
}
```

* **HyperFrames adapter** (the player inside the plates shell): wraps `<hyperframes-player>` (seek by seconds). DOM animation is drawn natively by the browser, so no frame cache; `ready()` is always true.
* **Plate adapter:** one sandboxed iframe per scene (bundle from a signed URL via `srcdoc`/blob), `window.FILM` (`ready`, `mount`, `warm`, `seek`, `meta`) behind a message channel; draws into the frame cache.
* **Clock:** `PlaybackClock` (audio element = master). Player asks `clock.now()` → frame index. If `ready(frame)` is false the player **holds the last frame**, never stalls audio, and shows the buffer indicator.

## 6. Frame cache (plates)

* **Key:** `signature | frame | size` (signature = hash of code + style + engine version, existing `plate_variants.signature`). A frame is a pure function of the key, so a hit is always valid.
* **Entry:** `ImageBitmap` at preview size (default 854×480; 9:16 → 480×854; 1:1 → 640×640). ~1.6 MB each.
* **Budget:** `LIVE_CACHE_MB` (default 160, halved on devices with `deviceMemory <= 4`). LRU **by scene**: the active scene and the next one are pinned; evict the farthest scene first, then frames farthest from the playhead.
* **Draw-ahead scheduler:** time-sliced (≤ 8 ms per slice via `requestIdleCallback`/MessageChannel); order: playhead → playhead + lookahead (2 s) → rest of the active scene → first 15 frames of the next scene → remaining scenes. Re-prioritises on seek. Pauses when the tab is hidden.
* **Draw cost model:** keeps a moving average of ms/frame per scene. If it exceeds the frame budget (33 ms) the player lowers cache resolution one step (854→640→480) before giving up.
* **Real-time fallback:** if the median draw cost stays above 2 × budget after downscaling, show "This device is slow for live preview" with `Draw a preview video instead` (queues the existing worker clip path for that scene; cached by signature).
* **Persistence (phase 2):** optional IndexedDB store of encoded frames (WebP) per signature, 100 MB cap, cleared on version change.
* **Observability:** `live_preview_stats` event (cache hit rate, dropped frames, ms/frame p50/p95, device class) sent once per session.

## 7. Authoring, checks and states

Today: `queued → authoring → bundled → (worker) rendering → drawn | failed`; `bundled` enqueues `plate-render`.

New (flag `PLATE_LIVE_PREVIEW`): `queued → authoring → bundled → checked` where **`checked`** means the browser check passed and the scene is playable. `plate-render` is **not** enqueued at `bundled`; it is enqueued at step 4 (or by background prefetch). `drawn` keeps its meaning: a CPU-drawn clip exists in R2.

Browser check (runs in the sandboxed iframe, reports to `POST /v1/projects/:id/plates/:variantId/check`):

* no page errors; `FILM.meta` matches the plan (size, fps, frames);
* frames 0, mid, last drawn twice give identical pixels (determinism) - same rule as the worker;
* no blocked network attempts, no navigation, runtime under a watchdog (§10).

Result handling: `ok` → state `checked`; `code` failure → existing repair loop (bounded by `PLATE_MAX_AUTHOR_CALLS`); `env` failure (device cannot draw) → not the model's fault, no repair, offer worker fallback. The report is **advisory**: the worker verifies again at step 4, so a lying client cannot get an invalid scene rendered.

## 8. Comment → code patch

* **Stable elements:** scene code declares named elements (`light`, `boat`, `moon`) via helper `el("light", ...)`; the bundle manifest lists `{ id, kind, activeFrames }`. Authoring prompt requires ids; the checker rejects scenes without them.
* **Edit request:** `{ sceneIndex, atFrame, text }` → the model gets: current source, element list active at `atFrame`, the comment, and the rule "return a patch, change only what the comment asks, keep every other id and value".
* **Patch format:** list of `{ id, find, replace }` blocks anchored on element ids (not line numbers). Server applies, then validates:
  1. every `find` matches exactly once; 2. touched ids ⊆ allowed ids (comment's element + explicit extras the model names); 3. diff size ≤ `PLATE_PATCH_MAX_LINES` (default 80) else it is a rewrite → rejected and retried once with "smaller change"; 4. compiles; 5. browser check passes.
* **Continuity ("the same light from before, whole light green"):** the model is told the element ids and their previous values; the validator checks that frames outside the element's `activeFrames` render identically (hash in the browser check) - catches accidental changes elsewhere.
* **Cost:** one model call per apply (counts against `PREVIEW_ALLOWANCE`/`preview_call_cap`); several comments on one scene in one apply = one call. No worker call.
* **Undo:** every apply creates a new generation `gen+1`; previous source/bundle kept until final render (user can revert one step). Fencing as today.
* **HyperFrames:** same API shape; its composition HTML already has element ids, so the same patch format applies to the composition file.

## 9. Final render (step 4)

* Worker Chromium is launched with software GL flags (`--use-gl=angle --use-angle=swiftshader`, `--disable-gpu`); a startup self-check records the renderer string and **refuses to render** if a GPU path is detected.
* Draw only scenes without a cached clip for their current signature; verify first (§7); repair bounded; then encode + audio + subtitles.
* **Billing:** price shown at click; tokens are held when the job is accepted and **settled on success**. A job that fails for any reason except the user's own cancellation is released in full. Idempotency key per click prevents double holds.
* Parallelism: scenes are independent jobs on `plate-render`; capped per project (`PLATE_PROJECT_CAP`) and by the DB connection budget (see `JOB_CONTROL.md`).

## 10. Security and safety of running model code in the user's browser

* Sandboxed iframe: `sandbox="allow-scripts"` (no same-origin), `srcdoc` from a fetched blob, CSP `default-src 'none'; script-src 'unsafe-inline'; img-src data: blob:`. No top navigation, no popups, no storage, no network.
* Talk only via `postMessage` with a per-iframe nonce; the parent validates message shapes and sizes.
* Watchdog: a draw that takes > 2 s, or a frame that never returns, marks the scene `stalled`, destroys the iframe, and offers the worker fallback. Memory guard: destroy scenes not within ±1 of the playhead after 60 s.
* The scene never sees user data; bundles are served from R2 via short-lived signed URLs after the ownership check.

## 11. API and data changes

* `GET /v1/projects/:id/plates/:variantId/bundle` → `{ url, expiresAt, manifest }` (signed R2 URL; ownership-checked).
* `POST /v1/projects/:id/plates/:variantId/check` → body = browser check report; 204.
* `POST /v1/projects/:id/plates/edit` → `{ scene, atFrame, text }[]` → 202 + new generations.
* `POST /v1/projects/:id/plates/render` → starts step 4 (idempotency key).
* Migration `018_plate_live.sql`: `plate_variants.checked_at`, `check_report jsonb`, `check_env text`; state check constraint gains `checked`; manifest elements stored in `manifest`.
* Flag `PLATE_LIVE_PREVIEW=on|off` (default off); off = today's behaviour, so rollout and rollback are a variable change.

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

**Authoring and edits**
16. Scene code compiles but throws at frame N: check catches only sampled frames - runtime error mid-playback marks the scene `failed-live`, shows the last good frame, and offers `Fix this scene` (repair loop).
17. Patch does not apply (find missing/ambiguous): retry once with the current source; then show "Could not apply that change" and keep the old scene.
18. Patch touches unrelated elements or exceeds the size cap: rejected (§8).
19. Model returns identical code: tell the user "nothing changed" and refund the allowance unit.
20. Two comments contradict (e.g. "red" and "green"): the later wins; both shown in the reply.
21. Comment on a frame with no element: model told "no element active"; asks for scene-level change or applies to the background layer; never silently ignores.
22. Edit while another edit is applying (same scene): second queued; generation fencing; the UI disables `Apply` for that scene only.
23. Two tabs editing the same project: last writer wins by generation; the other tab sees "Updated elsewhere" and reloads the scene.
24. Voiceover timing changes scene length: signature changes, scene is re-authored/retimed; cached frames dropped for that scene only.
25. Preview allowance exhausted mid-apply: existing `preview_limit` dialog; scene unchanged.
26. User edits the storyboard text after animation exists: affected scenes become stale; step 3 shows them as "needs update".

**Final render**
27. Worker unavailable / cold start: job shows "Starting render worker"; retries; no charge until accepted.
28. Verification fails at the worker though the browser passed: repair loop; if exhausted, fail with no charge and tell the user which scene.
29. Worker killed mid-render (Spot): attempt fenced, retried; clips already drawn are kept by signature.
30. User clicks `Final render` twice: idempotency key → one job.
31. User leaves the page mid-render: job continues; Projects shows progress; email when ready (existing).
32. Insufficient tokens: existing token modal before the job is created.
33. Different CPU architecture produces a different frame than the preview: documented; the worker is the source of truth; step 3 never promises byte equality.
34. Clip cache hit with stale engine version: signature includes engine digest, so no hit.

**Security**
35. Scene code tries `fetch`, `XMLHttpRequest`, `WebSocket`, `window.top`, `localStorage`, `eval` of remote code: blocked by sandbox/CSP; attempt is logged as `blocked` and fails the check.
36. Scene allocates memory in a loop / infinite loop: watchdog destroys the iframe; the page stays responsive (iframe is a separate frame; if the tab freezes, see §10 memory guard and fall back to worker).
37. Bundle URL leak: short TTL, ownership-checked, `Cache-Control: private`.
38. Forged check report: advisory only; worker re-verifies.

## 13. Test plan

**Unit (node --test, `frontend/test/`)**
* `live-cache.mjs`: key function, LRU by scene, pinning, budget enforcement, eviction order, hit/miss counters, resolution downgrade.
* `live-scheduler.mjs`: priority order, re-prioritisation on seek, time-slice budget (fake clock), pause/resume, cancellation.
* `live-clock.mjs`: audio-master mapping, clamp, hold-last-frame, drift correction, hidden-tab pause.
* `live-patch.mjs` (backend): apply/validate patches: ambiguous/missing find, size cap, id allow-list, unchanged code.
* `plate-contract.mjs`: both adapters satisfy `ScenePlayer` (fake FILM and fake hyperframes-player).

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
| 1 | `ScenePlayer` contract, `FrameCache`, `FrameScheduler`, `PlaybackClock` + unit tests | all unit tests green; fake-FILM benchmark shows scheduler meets budget |
| 2 | Plate live adapter (sandboxed iframe), bundle/check routes, state `checked`, flag | plates play live on staging with the flag on; sandbox tests green |
| 3 | Shared `AnimationWorkspace` + `AnimationPrep` extracted from `PlatePreview`; HyperFrames moves onto it | screenshot diff shows identical shell; old HyperFrames `ce-*` layout removed |
| 4 | Comment → patch editing with element ids | patch tests green; real scene "make the light green" changes only that element |
| 5 | Step 4: worker draws on demand, GPU-off self-check, billing hold/settle | e2e green; failed render releases tokens |
| 6 | Background clip prefetch, IndexedDB cache, worker fallback for slow devices | final render of a cached film ≤ 15 s |

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
8. **Scene code and RTL/complex scripts:** the plate authoring prompt gets a rule that text inside scenes must use the shared text helper (`text(ctx, str, {lang, dir})`) so direction, font fallback and line breaking are consistent; the browser check fails scenes that draw text with missing glyphs (tofu detection via `document.fonts.check` and canvas measurement).

**Edge cases (languages)**
* Mixed-language lines (Hinglish): language per line is kept; TTS receives the line with its dominant language; captions break at language switches only when needed.
* Digits and punctuation per locale (Arabic-Indic digits, Devanagari danda): normalised for TTS, kept as written for captions unless the user asks.
* Very long words / no spaces (Thai, CJK): caption line breaking uses `Intl.Segmenter`; fallback to character breaks.
* RTL text with LTR product names: bidi isolation so names do not reorder punctuation.
* Missing font in the worker or the browser: the check lists the missing codepoints; the preview shows a notice and the worker image is rebuilt with the fonts before step 4 (never render with tofu).
* Language set after the script was written, or changed later: scenes that depend on language are marked "needs update"; cached frames for them are dropped by signature (language is part of the signature).
* Speech model returns another language than requested (the Urdu → Hindi case): detected by the alignment step and shown to the user, who can pick a supported voice or continue.
* Script too short or too long in a language where speaking is slower/faster: duration estimates use per-language speaking rates; final timing follows audio.

**Tests (languages)**
* `backend/test/voice-language.mjs` (the other session's) stays the home for voice/timing; extend with `hi`, `ur`, `ar`, `es` fixtures.
* Normalisation unit tests: Roman Hindi → Devanagari, Roman Urdu, Arabizi, mixed lines, numbers (stub model with golden pairs; a live-model check run manually and recorded).
* Caption rendering golden images per script (Latin, Devanagari, Arabic, Nastaliq) in all three renderers, checked for glyph coverage and direction; tofu detector unit test.
* Browser check: scene with missing glyphs is rejected; RTL scene passes.
* E2E: one short film per language family (en, hi-Devanagari, hi-Roman, ur, ar, es) through step 3 and step 4, asserting audio language, caption script, frame counts follow audio.

**Phases:** language table and `inputScript` (P1 of this section, with phase 1 of §14); normalisation step and editable script (with phase 2); text helper, font stacks and tofu check (with phase 2/3); per-language e2e (with phase 5). Coordination: the voice and director parts stay with the other session; this plan owns the studio shell, the check and the render side.
