# Handoff: Trending templates (2026-11-16)

Give this whole file to the next session. It is the full state of the work and the plan to finish it.

## 1. What the owner asked for, in their words, summarised
- **Three templates in a new "Trending" gallery section:**
  - **Cartoon history** (`history-reel`): "mixed". Painted set images from the image model, with code-drawn puppets, props and camera on top.
  - **Illustrated facts** (`picture-film`): "full images". Generated stills cut on the voice's words.
  - **Dark Fable** (`dark-fable`): "full code". Already live in staging and production.
- **Cartoon history must work like our standard plates pipeline:** the user previews first (scenes drawn live in the browser) and comments on a scene to change it. Only that scene changes; the MP4 is made only at export.
- **Depth:** depth parallax on the painted sets, with the depth map made on the **ECS render worker**. The owner also asked for **depth of field** (lens blur by depth) "so we have a good film".
- **Costs and prices:** costs included and token prices per second correct for these templates.
- **Release order:** push to **staging**, test the whole flow on staging, then **production after the owner approves**.

## 2. Where everything is
| What | Where |
|---|---|
| Product work (branch `trending-templates`, cut from origin/staging = origin/production = a9f1ea86) | worktree `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-trending` |
| Plan written at the start (design and prices) | `docs/TRENDING_TEMPLATES_PLAN.md` in that worktree |
| History style experiment (the source of truth for the look) | `/Users/osamaehsaan/Code/Market_apps/VideoSaaS/experiments/history-reels/` (ANALYSIS.md, template/README.md, template/reference/POSE_RULES.md, template/kit/*.js, template/films/niagara/film.js and render/final.mp4) |
| Picture-film experiment | `/Users/osamaehsaan/Code/Market_apps/VideoSaaS/experiments/tarantula-reference/` (ANALYSIS.md, test/*) |
| The three.js "real 3D" route, parked by the owner | `experiments/history-reels/REPO_REVIEW.md` (MIT repo mromidev/claude-animated-shorts) |
| Memory notes | `history-reels-style`, `dark-fable-template`, `worker-scale-to-zero`, `deploy-lineage` |

The `experiments/` folder is git-ignored and lives in the main checkout (`/Users/osamaehsaan/Code/Market_apps/VideoSaaS`), not in the worktree.

## 3. Done and committed (commit f2b3826a on `trending-templates`)
- **Trending tab:**
  - `packages/contracts/src/gallery-use-cases.ts`: `{ id: "trending", label: "Trending" }` is first in `galleryUseCases`, plus `trendingGalleryIds = ["history-reel", "picture-film", "dark-fable"]`.
  - `packages/contracts/src/gallery.ts` `queryGallery`: `counts.trending`, and `useCase === "trending"` returns that curated list in order. The templates also keep their own tab (Explainers).
- **Gallery entries** in the curated array of `gallery.ts`:
  - `history-reel` "Cartoon history": 9:16, 45 s, pace fast, audio both, captions full, voice Puck.
  - `picture-film` "Illustrated facts": 9:16, 60 s, pace fast, audio voiceover. Captions are "none"; this change is NOT yet committed.
  - Both are added to `codeDrawnTemplates`, so they show when plates are on, and `useCaseOf` maps them to "explain".
  - Card media in `frontend/public/templates/`: `history-reel.{jpg,mp4,-5s.mp4}` (the Niagara film, blurred-pillarbox 1280x720 like dark-fable) and `picture-film.{jpg,mp4,-5s.mp4}` (the chewing-gum test film).
- **Per-template render prices** in `packages/contracts/src/pricing.ts`:
  - `TEMPLATE_RENDER_RATES`, `renderRateFor(template)`, and `renderCostMillitokens(seconds, template?)`.
  - **history-reel: 13 tokens + 0.45/s. picture-film: 11 + 0.75/s.** Dark Fable keeps 6 + 0.3/s.
  - These are the 30% margin floor from measured costs (history ≈ $0.55 + $0.018/s; picture ≈ $0.45 + $0.03/s, and the pack agent re-estimated picture at ≈ $0.42 + $0.027/s).
  - Wired into:
    - `backend/src/render/quote.ts` (`options.template`, and `parts` shows the template rate);
    - `backend/src/server.ts` render spend (v1);
    - `backend/src/billing/step-billing.ts` v1 path;
    - `backend/src/tokens/plan.ts` re-exports;
    - frontend `beat-storyboard.tsx` `RenderCost` and `browser-animation-step.tsx` fallback.
  - `backend/test/pricing-lock.mjs` locks them and checks a ≥30% margin at 20/45/60/90 s. It passes.
- **The owner said "include the cost and everything":** prices are set, but they are the owner's business decision. Show them the table in the final report before production.

## 4. Built by agents, NOT yet committed (in the worktree; check `git status`)
### 4a. Engine: per-scene image assets + depth on ECS (agent was STILL RUNNING at handoff)
- **Brief given:**
  - `TemplatePack` gains `assets?(input): AssetSpec[]` with `AssetSpec = { name, prompt, refs?, aspect, size?, depth?, noText? }`, plus `sceneCode?(input): string` (no model call) and `sceneAssets?(beatIndex, beats): string[]`.
  - A backend step generates assets with Gemini image (`gemini-3.1-flash-image`, as `plan/visuals.ts`), in order so refs resolve, cached by a hash of prompt+refs and stored like project media. `noText` gets one word check and at most one redraw. Under v2 billing they are charged as material.
  - **Depth:** Depth Anything V2 Small as ONNX through onnxruntime-node, baked into the worker Docker image, running as a new ECS worker job queued after the set image is stored, with a local/dev path. The Apache-2.0 licence of the Small checkpoint must be confirmed on its model card.
  - Scenes read pictures with `env.image(name)`. Sets are named `set-<place>` / `depth-<place>`. The preview (`frontend/lib/live/worker-host.ts`) and the export (`worker/src/plates.mjs` / plate-engine capture) both inject them.
  - **Owner rule sent mid-run:**
    - The preview must never wait for depth: scenes play flat until the depth map lands, then pick it up without re-authoring.
    - Regenerating one image refreshes only that asset.
- **Its files:** backend/src/plates/*, template-packs.ts (types and the asset step), storage/jobs, frontend/lib/live/*, packages/plate-engine/*, worker/*.
- **NEXT SESSION:** if this agent is gone, read `git status` / `git diff` in the worktree to see how far it got, then finish or redo whichever part is missing. Check:
  1. The asset step runs and stores files.
  2. The preview preloads pictures.
  3. The export injects them.
  4. The depth job is queued, picked up by ECS and stored.
  5. The flat fallback works.
  6. Caching works.
  7. The `sceneCode` path skips the model.

### 4b. Cartoon history pack: DONE by its agent (tests pass, tsc clean)
- **Files:**
  - `backend/src/plan/packs/history-reel/kit.txt`: global `K`. It holds the maths, the rig (two-bone IK, VIEWS side/three/front, shoe pivot, drawPiggyback), faces, the pose library (+ run, point, armsUp, swing) and props.
  - `K.set(ctx, env, cam, place)` draws WebGL depth parallax with motion blur, a 2D fallback, and a flat zoom without depth. The kit also has `K.camera(frame, keys)`, `K.puppet`, `K.actors`, `K.fade`.
  - `index.ts` exports `historyReel` (script voice, assets, sceneAssets, voice Puck tighten, captions, pacing, sceneSounds, music, sceneDirection, scenes()).
  - Pictures: `pose-sheet.png`, `kit-shot.png`, `example-film.png`.
  - Tests: `backend/test/history-reel-pack.mjs` and `backend/test/history-reel-render.mjs` (`GEN_REFS=1` remakes the pictures).
  - Registered in `template-packs.ts`.
- **Measured:** WebGL ~230 ms a frame in headless Chrome. **Software GL (the GPU-less ECS worker) ~400 ms a frame**, so a 60 s export takes about 12 min.
- **Its open issues (still to fix):**
  1. The script parser drops a `PLACES` line and clips OBJECTS at 400 characters, so places currently ride in `EXAMPLE: PLACES: …` and each VISUAL starts with `[place]`. Add a proper PLACES/CAST plan field in `script-stream.ts`.
  2. `wireSceneAssets` scans the inlined kit for `env.image`, so the kit reads pictures through a destructured `const { image } = env`. Make the check ignore kit code instead.
  3. **The shared pack prompt is Dark-Fable-specific:** `packContractFor` says "K.backdrop… K.vignette… no images", and the sounds rule lists Dark Fable's sound kinds. Make both per-pack (fields on TemplatePack).
  4. Music is one fixed string (a generic banjo, pizzicato and piano score). Era matching needs a per-film music prompt from the script's year and place.
  5. Captions are 2 words per cue (the engine doesn't group). The owner's reference shows 1-2; leave it unless the owner says otherwise.
  6. Add the new tests to `backend/package.json` scripts.
- **NOT done yet: depth of field (owner asked).** Add it to `K.set` in kit.txt:
  - New camera key `dof` (blur strength in px at 1080 wide) and `focus` (depth to keep sharp; default `cam.dRef`).
  - In the fragment shader `FS` (kit.txt ~line 543), after finding `X` and `d`, take a ~12-tap disc sample of `img` around `X`. Radius = `dof * clamp(abs(d - focus) * 2.5, 0, 1)` converted to plate px (÷ k).
  - The 2D fallback can skip DOF.
  - Use DOF on close and medium shots (cInf 10-16 px at 1080, from the MIT repo's measured reference: about a third of screen time, focus on the eyes of the subject, wides sharp). Say so in `sceneDirection`.
  - Check software-GL cost; keep the tap count low, since export is already ~400 ms a frame.
  - Re-run `history-reel-render.mjs` and look at the frames.

### 4c. Illustrated facts pack: DONE by its agent (tests pass, tsc clean)
- **Files** in `backend/src/plan/packs/picture-film/`:
  - `index.ts` (`pictureFilm`);
  - `plan.ts`: pure functions. The number of stills per line is one per ~6 words, 1-4 a beat, with splits at commas. It also has `planFromScript`, `shotListRequest`/`parseShotList` (the optional cheap model call) and `assetSpecs` (order: style anchor, set anchors, character sheets, stills; refs to anchors; "pop" stills ref the previous still);
  - `scene.ts`: deterministic scene code: cover-fit stills, a hard cut 2 frames before each still's first word, a 1.5% push-in, no sounds;
  - `style.ts`.
- **Tests:** `backend/test/picture-film-pack.mjs` and `picture-film-render.mjs`. Cuts were verified at the exact frames.
- **Cost per 60 s:** 2 text calls, about 47 image calls (with redraws), about 20 word checks, the voice. About $2.05.
- **Its open issues (still to fix):**
  1. The engine must run the shot-list call (`shotListRequest`/`parseShotList`) after the script and pass the plan into `assets()`. Without it, looks come only from the script's OBJECTS line.
  2. Labelled stills have `noText: false`, and its `allowedText` field isn't read by the engine. Make the word check accept `allowedText` (only those words may appear).
  3. Captions: the gallery entry is now "none" (uncommitted change in gallery.ts). Check the plates captions path honours "none".
  4. Make sure the storyboard step doesn't spend model calls on per-beat sketches for this template, or skip them.
  5. 1:1 films use 9:16 stills.
  6. There is no research step; the facts rely on the script model.
  7. Add the tests to package.json.

## 5. The rest of the work, in order
1. **Finish and integrate the engine piece (4a).** Fix the integration issues in 4b and 4c. Add DOF (4b). Check the comment-to-fix flow works for all three templates:
   - Preview → comment on a scene → only that scene is rewritten. For history-reel, the set images and depth stay cached.
   - For picture-film, a comment on a still regenerates only that still (the asset), since its scene code is deterministic. Wire that: a comment on a picture-film scene should redraw the named still, or re-time it, not call the scene model.
2. **Run everything locally:**
   - `npx tsc --noEmit -p backend`, `-p frontend`, `-p packages/contracts`;
   - `node backend/test/{pricing-lock,dark-fable-pack,history-reel-pack,history-reel-render,picture-film-pack,picture-film-render}.mjs`;
   - the existing plates tests.
   - **9 frontend tests already fail on clean staging** (known, not ours); compare against staging before calling anything new.
   - Then do a local end-to-end run of one film per template through the real pipeline: local backend + frontend + worker via compose (see memory `local-dev-state-2026-11-04`) with real model calls (about $2-3 each).
3. **Commit** on `trending-templates`, ending each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
4. **Staging deploy (owner rule: only through GitHub pushes):**
   - Merge `trending-templates` into `staging` (fast-forward if possible) and push `origin staging`. Railway (backend) waits for CI; Vercel (frontend) deploys on push.
   - Check `mcp__railway__environment-status` (staging), and `https://backend-staging-aec6.up.railway.app/healthz` and `/readyz`.
   - Check the depth model's licence before shipping it.
5. **Staging worker (ECS):** the worker is NOT deployed by a push. From a clean worktree at the pushed staging commit:
   ```bash
   cd <clean worktree>/infra/aws
   WORKER_CONTROL_URL_STAGING=https://backend-staging-aec6.up.railway.app ENV=staging ./deploy-worker.sh ondemand
   ```
   - Symlink `infra/aws/.env`, `infra/aws/.env.production` and the repo-root `.env.credentials` from the main checkout. Use the script copy in the commit; it knows production is us-east-1.
   - Last live versions: staging `greedymotion-staging-worker:26`, production `:6`, both built from a9f1ea86.
   - "PutClusterCapacityProviders denied" at the end is expected and harmless.
   - The production deployer key now has ECR rights on the us-east-1 repo (inline policy `ecr-pull-layers`, added by the owner).
6. **Test on staging,** signed in, through the real UI:
   - Open Templates → Trending (3 cards, card videos play). For each template:
     1. "Use this".
     2. Script.
     3. Storyboard.
     4. Preview: scenes play live, and the history sets appear (flat first, then depth).
     5. Comment on one scene: only it changes.
     6. Export the MP4 on ECS.
     7. Check the MP4: captions, voice, sounds, depth and DOF for history, cuts for picture-film.
     8. Check the token charge equals the template rate (e.g. 45 s history = 13 + 0.45×45 = 33.25 tokens) and the quote shows it.
   - Record times and real costs from the cost log, and compare them with the plan.
7. **Report to the owner:**
   - what works, with the films;
   - real costs against the prices;
   - export times (~12 min for 60 s of history on software GL);
   - open issues.
   - Ask for the go-ahead.
8. **Production (only after the owner says yes):**
   - Fast-forward `production` to the same staging commit and push. If production has diverged, merge; never force-push (blocked before).
   - Check Railway production health.
   - Redeploy the production worker: `ENV=production ./deploy-worker.sh ondemand` from a clean worktree at that commit.
   - Run one smoke test.

## 6. Owner rules to keep
- **Ask the owner** for product, pricing and production decisions. Confirm destructive actions. Never force-push.
- **Never print or write API keys.** Gemini keys are read from `backend/.env` inside processes only.
- **Deploy only through GitHub pushes** (Railway and Vercel); the worker only through `deploy-worker.sh`.
- **Keep experiment results** in git-ignored `experiments/`.
- **The puppet rules in POSE_RULES.md** are owner-approved: the far arm is behind the body side-on, legs end inside shoes the width of the leg, the shoe pivots with the shin, and the piggyback rider's leg wraps round the front with the carrier gripping it.
- **Our own cast only** (never the reference channel's round-white-head look). The reference character in `reference/pose-sheet.jpg` is for checking, never a cast member.
- The **"engine draws no text"** rule applies (captions come from the script).

## 7. Known numbers
| | Cartoon history | Illustrated facts | Dark Fable |
|---|---|---|---|
| Price | 13 + 0.45/s | 11 + 0.75/s | 6 + 0.3/s |
| Cost per 60 s (estimate) | ~$1.65 | ~$2.05-2.25 | ~$0.80 |
| API calls per film | script, ~3 sets (2K), ~25 scene authorings/min, voice, music | script, shot list, ~47 images, ~20 checks, voice | script, ~27 scenes, voice, music |
| Export on ECS (software GL) | ~400 ms a frame (~12 min for 60 s) | fast (plain images) | as today |
