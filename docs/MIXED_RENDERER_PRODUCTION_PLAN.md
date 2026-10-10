# Mixed scene renderer production plan

Started 2026-10-10. Requested: comprehensive plan, implement and optimize the engine, build necessary images, prepare for main and staging. No push, paid generation or deployment is part of the local validation phase. Preserve the existing working tree (212 changed/untracked entries at start); the starting tracked diff is saved outside the repository.

## Architecture and scope

One HyperFrames composition owns the film clock, media, text, audio and transitions. HTML/SVG, Canvas and seeded drawing libraries are scene/layer implementations inside that composition, not competing project engines. Existing EffectCraft project selection is unchanged. A browser worker supports UI, procedural graphics, doodle, Hairline and imported clips. Native/GPU tools are not advertised as available merely because a compiler exists.

Implement now:
1. Versioned scene routing contract with explicit reason, editability, frame boundaries and capability requirements. Preserve old beat plans. Optional per-beat native treatments and procedural graphics let one film mix looks; generated material remains governed by its existing readiness checks.
2. One planner path for live preview and final render. Native text stays in DOM. Canvas handles bounded procedural geometry, with seeded precomputed data, no autonomous frame loop, no offscreen-scene work and no per-frame DOM reconstruction.
3. Scope native treatments per scene so a doodle/hairline scene cannot restyle the following UI. Keep the existing seam and audio clock. Persist a render manifest and reject missing required screenshots/media or unsupported capabilities before export, rather than silently substituting graphics.
4. Worker preflight for versioned prepared-project manifests. Backwards compatibility for legacy projects without manifests. Share render-policy logic with tests; bound worker process concurrency and fail on unready render assets. Do not claim low-resolution capture until the pinned CLI supports it safely; current downscale remains explicit.
5. A standard browser runtime image with pinned npm lockfile, fonts and offline libraries. Separate dependency and runtime stages; narrow build context. No Rust compiler in every production worker. Native fframes support is gated on a successful Linux build, runtime-data interface, deterministic output, cost benchmark and actual need. Document an isolated specialist image path rather than shipping a nonfunctional image.
6. Offline contract/negative tests, deterministic browser seeks, boundary sampling and exports for wide/portrait/square. Build and smoke-test the actual Linux image. Record measured timings and remaining gaps. Run workspace typecheck and style-build regression checks.
7. Main/staging handoff: scoped file inventory and verification report; do not stage the unrelated work. Build once and deploy the validated image digest after approval. Staging smoke before production promotion. Roll back via previous image/task definition.

## Acceptance gates

- A single film contains Canvas geometry, real UI screenshot, doodle and Hairline scenes with live text and shared transitions.
- Automatic default routing is explainable, stable and consistent between preview/export; explicit unsupported requests fail.
- Out-of-order seek snapshots reproduce; exact scene boundaries have no blank frame; screenshots/media are required for final film.
- Output aspect, fps and duration match the manifest; actual container render decodes successfully.
- Canvas updates skip inactive and unchanged poses, use bounded resolution/geometry, and preserve seeking at subframes.
- No new paid providers, DB migrations, cloud credentials or runtime package downloads.

## Operational decisions

Start with one browser image; no extra image for Canvas, doodle or Hairline. A future native renderer produces immutable media consumed by the same browser compositor and uses a separately budgeted queue. Compile Rust in a builder image and ship only binaries/runtime libraries; avoid customer-triggered compilation in the browser worker. GPU drivers/platform support must be tested separately. Current fframes evidence is Mac-only; Linux production support is not claimed.

Do not confuse a valid render with visual quality. Browser/codec tests cover correctness; matched scene and transition captures cover appearance. Full creative quality, arbitrary reference recreation and production Pro element editing are separate workstreams.

## Progress

- [x] Inspected current planner, beat engine, worker, Dockerfile and previous mixed-engine experiments.
- [x] Confirmed local Docker engine is available (29.7.2); standard worker images cached.
- [x] Routing contract and planner integration.
- [x] Canvas/native scene runtime and seam verification.
- [x] Worker preflight and image build.
- [x] Automated tests, container exports and measurements.
- [x] Deployment handoff and exact remaining limitations.

HyperFrames local CLI is 0.8.111; its `usage` command is unavailable, so usage is unknown. This is infrastructure work using the pinned runtime, not a CLI upgrade exercise.

## Implementation report — October 10

Delivered locally:

- `packages/contracts/src/scene-rendering.ts`: closed renderer vocabulary and deterministic route resolver. `Beat.render` optionally specifies a native treatment and procedural graphic. Unknown values and incompatible requests fail validation. Material films cannot replace generated scenes with native overrides. UI/title/CTA text remains in DOM; clean high-energy kinetic graphics default to Canvas orbits. Explicit particles are supported. Lower-density graphics remain in DOM.
- The director's structured-output schema, normalization and system guidance preserve that direction through the persisted plan. Preview and export both call `engineVariables` and receive the same route. No provider request was needed to test this mapping.
- `worker/templates/beat-plan/canvas-layer.js`: geometry is created once, 96 seeded particles maximum, Canvas backing store bounded to the on-screen graphic's logical size, shared GSAP time, subframe evaluation, no RAF or offscreen work. Text is never painted into Canvas. Source UI styles are scoped to each beat; following scenes do not inherit doodle/Hairline treatment accidentally.
- `render-manifest.ts` writes versioned scene frame ranges, routes, transition directions, canvas and SHA-256 fingerprints for entry/variables/required scene assets. Missing screenshots, missing footage and timeline gaps fail export preparation. Readiness surfaces the relevant asset errors before submission.
- `render-preflight.mjs` validates capabilities, timeline continuity, dimensions, duration, safe paths, realpath containment and file integrity before a prepared film renders. New jobs require their manifest. Existing jobs without a version remain compatible; Pro projects use their editable-source path rather than a stale snapshot manifest. Unsupported native renderers are rejected. `/capabilities` describes the browser worker. HyperFrames receives `--no-best-effort` so unready media is not silently accepted.
- Multi-stage browser worker image and Dockerfile-specific build contexts for backend and worker. Production browser image excludes Rust/compiler tooling and unrelated experiments. Backend and worker images built for Linux ARM64, matching the existing ECS task definition. No extra image is needed for Canvas, doodle or Hairline.
- Offline contract tests and CI hooks; mixed scene fixtures, source and MP4 browser checks. Scene-style assets/fixtures regenerated because the shared engine source changed.

### Verification and measurements

Evidence directory: `validation/mixed-renderer/`. These are synthetic **silent correctness fixtures**, not polished reference recreations or generated material samples.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Frontend production build | Passed |
| Style contracts and generated asset freshness | Passed for the final 49-entry catalog; it expanded during this work |
| Existing 18-style browser matrix | Passed: 3 aspects, 4 scenes each, brand changes and reverse seeking |
| Mixed source browser checks | 5 scene types × 3 aspects; 17 seek poses per aspect, including 12 boundary-adjacent/exact poses; pixel nonblank and distinct-scene checks |
| Reverse seeks | 37/51 PNG comparisons exact; remaining comparisons within MAE 0.005/255 and 0.1% changed channels; actual measured worst MAE 0.0004281/255. Tiny transform-edge antialias variation, not byte-identical claims |
| Canvas inactivity | 100 timeline updates outside its scene cause zero extra draws; orbit animation also passes exact Canvas reverse seeks; no autonomous render loop |
| HyperFrames check | All 3 aspects pass with zero errors/warnings; built-in motion assertions disabled, independent source tests used |
| Container render, 2 CPU / 4 GB / network disabled | 15 seconds, 450 frames, 30 fps each; wide 50.3 s, portrait 53.7 s, square 40.3 s; screenshot capture/software GPU |
| Actual MP4 verification | All 3 full-decode clean; correct aspect/duration/fps; Chrome playback and 6 nonchronological seeks each; no browser errors |
| Container preflight | All 3 manifests accepted; offline unit tests reject stale/missing assets, unsupported renderer/version, invalid fingerprints, escapes, gaps and missing footage |
| Backend image smoke | Shared contract, director normalization and composition imports pass offline on Node 24.21.0 |
| Existing regression tests | Material offline tests, motion-blur policy, Pro files/editing tests and script rules pass; skill bundle is current |

The final MP4 contact sheet was visually reviewed against source captures. This establishes working composition/exports for these fixtures, not optimal design for arbitrary briefs. The Hairline example intentionally retains the existing thin plate geometry; it is not arbitrary line-art generation. Doodle uses existing seeded Rough.js SVG, not the separate anidoodle runtime.

The first source harness omitted the viewport height supplied by HyperFrames, so its early blank captures were invalid and discarded. Pixel checks were added. A separate harness accidentally awaited a paused GSAP thenable; that was corrected. Byte-only seam comparisons exposed tiny browser antialias differences; those are measured with a strict pixel-error bound. None of those early passes is used as final evidence. The MP4 harness now serves video and test page from the same origin so Canvas readback is valid.

### Limits and next optimizations

- Native fframes/Rust rendering remains unavailable: Linux runtime, GPU/CPU costs and runtime JSON authoring have not been validated. A compiler-only image would not complete this capability. Build a specialist image only after those gates pass.
- This iteration has two bounded procedural graphics (orbits and particles), not an arbitrary Canvas scene generator. It preserves the existing directional/wipe seam implementation; semantic object-morph transitions still require authored correspondence. A transition label alone does not create matching graphics.
- Preview still captures at composition size then downscales. The pinned CLI's resolution option supports integer upscaling, not safe arbitrary lower-resolution capture. No unsupported preview-speed claim is made.
- Cross-job artifact caching, GPU scheduling and a specialist render queue are future work. The manifest provides hashes but does not itself implement a cache. Existing job ownership/retry code is preserved; no new DB changes or live queue integration test in this pass.
- Canvas graphics are parameter-editable, while text remains DOM. Dedicated Pro inspector controls for the new per-scene fields are not implemented; the director and persisted plan can carry them, and source/JSON editing is available.
- No paid generation, production material-fidelity verification, staging queue run, image push, merge or deployment occurred. Only ARM64 images were built; x86_64 is not claimed.

## Main and staging handoff

Local tags: `videosaas-worker:mixed-renderer-local` and `videosaas-backend:mixed-renderer-local`. Final identities are recorded in `validation/mixed-renderer/image-inspect.jsonl`. These are local image IDs/manifests, not published registry digests.

1. Review scoped changes before staging. The starting tree already contained 212 modified/untracked entries, including production generation and editor work. Do not `git add .`, reset the tree or merge everything implicitly. This change depends on the existing local style catalog/generated-material integration; the release must include its reviewed prerequisites.
2. Run `npm run test:scene-rendering`, `npm run typecheck`, `npm run styles:check`, `npm run scenes:verify`, and `npm run build:frontend`. Rebuild assets first if the engine changes. The existing CI now includes the routing and source-browser tests. Container export verification remains an explicit release gate.
3. Build from repository root with `docker build -f worker/Dockerfile -t <worker-tag> .` and `docker build -f backend/Dockerfile -t <backend-tag> .`. Pin `NODE_IMAGE` to the validated base digest for repeatable worker rebuilds. npm packages use lockfiles; apt/base-tag updates can still change binaries, so promote the same tested image rather than rebuilding independently for each environment.
4. After approval, publish immutable release tags, record registry digests and deploy the compatible worker **before** the backend starts issuing required manifests. Keep `RENDER_CONCURRENCY=1`, one CLI worker, 2 CPU/4 GB for the first staging measurement. Do not change production defaults based on laptop timings.
5. In staging, submit a real owned project mixing all four native treatments. Check live preview, final output, cancellation/retry, edited screenshot invalidation and Pro editing/export. Confirm worker capabilities, job owner fencing and that deleted footage blocks submission. No paid scenes are necessary for that gate.
6. Promote only after staging passes. Roll back backend and worker together to the previous known pair; old workers do not enforce the new manifest contract. No schema rollback is necessary for this change. Existing paid-generation settings remain unchanged.

An image build and offline render are not a staging deployment. The dirty working tree and untested live queue path must be resolved in the release review before promotion.

### Concurrent catalog update

The final inventory detected a 49-entry catalog, expanded from the 18 entries present at the start. The modified scene-engine source and routing source hashes were unchanged. The final contract/freshness check passes all 49 entries, and images were refreshed to package that catalog. Browser style-regression coverage is still the 18-entry run recorded above; the extra 31 styles are not claimed as visually or materially validated by this task. Preserve their separate working-tree changes in release review.

Local review viewer: http://127.0.0.1:8034/ while the server is running. Restart with `python3 -m http.server 8034 --bind 127.0.0.1 --directory validation/mixed-renderer` from the repository root. The viewer and reports are generated local evidence, excluded from Git by the verification folder's ignore rules.

## Creative review follow-up — 2026-10-10

The user rejected the latest mixed-scene test videos: **“Too basic; unlike the references.”** The synthetic fixture outputs are not accepted creative examples. Their routing/playback/export evidence remains useful, but does not satisfy the desired visual result or constitute creative approval for main/staging.

An isolated replacement quality study was rendered and locally verified at `Effectcraft_templates/Motion_gallery/projects/orbit-click/`, with viewer `Effectcraft_templates/Motion_gallery/orbit-click.html`. It uses one persistent product browser, oversized type, action/response choreography, target-specific ink and an object-preserving transition into a share page. Its README and frame-level storyboard record implementation, evidence and limitations. This is manually art-directed and does not change production routing or claim automatic prompt-to-video quality.

Remaining engine work exposed by this review:

1. Plan the visual proof of each claim before choosing a renderer. “Canvas particles” and “doodle boxes” are capabilities, not scene concepts.
2. Carry persistent object IDs, entry/exit poses and camera targets across beats. A style key and transition direction alone do not specify visual continuity.
3. Give interaction scenes an explicit target, cursor arrival, press, state change and reading hold; validate the target/state relationship.
4. Route useful graphic content rather than defaulting high energy to orbits. Require a designed visual premise and content-specific geometry.
5. Benchmark actual output against the chosen reference at equivalent poses: typography occupancy, UI density, timing, framing and object continuity. Keep quality review separate from deterministic renderer tests.
6. Bind accepted source templates to editable product controls and author layouts for other aspect ratios. Those integrations remain outstanding for Orbit Click.

Do not treat the existing local images or technical test passes as creative sign-off.
