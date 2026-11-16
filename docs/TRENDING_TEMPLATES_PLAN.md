# Trending templates: plan (2026-11-16)

Owner request: pack three templates (Dark Fable, the history puppet reel, the picture film) and put them in a new **Trending** gallery section. Run on staging (ECS for the heavy step), with correct costs and token prices per second. Test the whole flow on staging, then promote to production.

Branch `trending-templates` in `../VideoSaaS-trending`, cut from `origin/staging` at a9f1ea86, which is the same commit as production.

## Design: everything runs on the plates engine
Plates already gives us script → storyboard → voice → scene modules drawn in the browser preview → MP4 on the ECS worker, with captions, foley (`sceneSounds`), music and billing. The three templates differ only in what a scene draws:

| Template | id | Scene content | New engine need |
|---|---|---|---|
| Dark Fable (live) | `dark-fable` | code-drawn kit (as today) | none |
| History puppet reel | `history-reel` | a generated **set image + depth map** per place, with code-drawn puppets, props and camera on top | per-scene image assets, and depth |
| Picture film | `picture-film` | 2-4 generated **stills** per beat, hard cuts on the word times; the scene code is generated deterministically (no model call) | per-scene image assets, and a scene with no authoring call |

### Shared piece: per-scene generated image assets
- The scene contract today forbids images (`plates/prompt.ts:129,165`), but the engine supports them (`Env.image(name)`, `canvas-core/core.ts:600`, `hosts/page.ts:291`, `worker-host.ts` preload of `data:` URLs).
- Add a pack-level `assets` step:
  - generate images with Gemini `gemini-3.1-flash-image` (as `plan/visuals.ts` does) and store them on R2 like other project media;
  - give a scene module `assets.images` names that resolve to those files;
  - the preview worker and the export page both preload them as `data:` URLs;
  - only packs that declare `assets` may use images.
- **Depth (history-reel only):** Depth Anything V2 Small, as ONNX through `onnxruntime-node`, runs on the ECS render worker. One run per set image takes about 1-3 s on CPU.
  - The job is queued as soon as the sets exist and writes `depth-<set>.png` next to the set.
  - If depth fails, the scene uses a flat zoom (parallax 0), so a film never breaks.
  - The licence of the Small checkpoint must be confirmed as Apache-2.0 before shipping.

### History-reel pack (from `experiments/history-reels/template`)
- **Kit (`packs/history-reel/kit.txt`):**
  - the core maths, puppet rig (two-bone IK, VIEWS), pose library, props, and the set renderer;
  - the set renderer is WebGL on an OffscreenCanvas inside the scene (with a 2D fallback), drawn into the scene's 2D context;
  - camera keys `{x, y, z, px, py, roll, par}` with the creeping push.
- **Rules:** `reference/POSE_RULES.md`, which must be followed.
- **Script voice:** the formula from `experiments/history-reels/ANALYSIS.md`:
  - a strange act in line 1, a bystander's doubt, a deadline, escalation;
  - "You see," then the mechanism, then a one-line ironic payoff;
  - about 225 wpm.
- **Places:** the script plan lists 1-3 PLACES (empty sets), and each beat names its place.
- **Voice:** Puck, fast, pauses trimmed hard (0.12 s).
- **Music:** era-matched, with drops on reveals.
- **Captions:** 1-2 words, white with a black outline, at 70% height.
- **Sounds:** `sceneSounds` on.

### Picture-film pack (from `experiments/tarantula-reference/test`)
- **Script voice** from `ANALYSIS.md` there.
- **Shot list:** one still about every 2 s.
- **Images:** character and set anchor sheets first (about 7), then the shots with those anchors as references.
- **Word check:** stray words are redrawn, at most one round per picture.
- **Scene module:** generated from the shot list, so it costs no model call.
- **Picture rule:** no music, as in the reference.

## Prices (30% margin floor at our cheapest token: $1 of cost = 23.1 tokens, `pricing.ts` `costBudgetPerTokenUsd`)
Measured costs:

| Template | Fixed per film | Per second of film | 60 s film cost | Charge (start + per second) | 60 s charge |
|---|---|---|---|---|---|
| Dark Fable | ~$0.15 | ~$0.011 | ~$0.80 | unchanged: 6 + 0.3/s | 24 tokens |
| History reel | ~$0.55 (script, 3 sets, music) | ~$0.018 (about 25 code scenes a minute + redraws) | ~$1.65 | **13 + 0.45/s** | 40 tokens |
| Picture film | ~$0.45 (script, shot list, 7 anchors) | ~$0.030 (0.5 stills a second, 25% redraws, word check) | ~$2.25 | **11 + 0.75/s** | 56 tokens |

- These go in `packages/contracts/src/pricing.ts` as per-template render rates (`renderCostMillitokens(seconds, template)`), used by the quote, the render spend and the site's price text.
- `backend/test/pricing-lock.mjs` and `docs/PRICING.md` are updated with them.

## Gallery
- **A new Trending tab:** first in `galleryUseCases`, as a curated id list (not a use case moved out of its tab): `["history-reel", "picture-film", "dark-fable"]`.
- **Each card has a poster, a 5 s loop and a full film:**
  - history reel: the Niagara film;
  - picture film: the gum test film;
  - Dark Fable: as today.

## Order of work
1. Trending tab + gallery entries (contracts/frontend), and per-template pricing (contracts + backend quote/spend + tests).
2. Per-scene image assets (backend storage, scene contract, preview preload, export preload) and the depth job on the ECS worker.
3. History-reel pack: kit port, direction, script voice, places step, authoring wiring, tests.
4. Picture-film pack: shot list, images, word check, deterministic scene, tests.
5. Deploy to staging: push `staging` (Railway + Vercel), `ENV=staging ./deploy-worker.sh ondemand` (worker), then run a full flow per template on staging and check the MP4 export.
6. Report, then promote to production when the owner approves.
