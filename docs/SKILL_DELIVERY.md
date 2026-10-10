# Skill delivery

Updated 2026-10-09. These changes are local and have not been deployed. The October 8 image evidence below describes the older implementation, not this revision.

## One runtime artifact

`npm run skills:build` builds **backend/skills/**. `npm run skills:check` reproduces it in a temporary directory and rejects any difference. One format-2 manifest hashes all relative paths and bytes using `backend/src/formats/digest.ts`. `backend/src/skills/loader.ts` verifies the entire file set, refuses symlinks and missing/extra/changed files, and caches the verified bundle per process. The Docker build also verifies it. No runtime dependency on `.claude`, GitHub, or a developer computer remains.

| Section | Source | Runtime consumer |
| --- | --- | --- |
| `director/` | Five selected gm-* references; `director:skip` markers removed | Script director |
| `formats/` | `.claude/skills/BUNDLE.json`, templates, slots, fill guidance, sample values, pinned browser libraries | Fixed-format fill and render APIs |
| `author/` | `cloud-author/stages/`, `cloud-author/stages.json`, reviewed `third_party/cloud-author-skills/`, plus the house craft below | Pro Editor source-edit proposals |

`SKILLS_BUNDLE_DIR` defaults to `backend/skills`. The former `CLOUD_AUTHOR_SKILLS_DIR` is removed. The old generated TypeScript and separate author/format bundles are retired. Old build script paths delegate to the unified builder; use the two commands above.

Format job request/render metadata and Pro proposals carry the **same complete bundle hash**. A format also retains its individual content hash and version. A director or stage instruction change therefore changes the bundle identity even if a template is unchanged.

## One craft standard for every generation

The rules that make a film good are written once and reach every reader from the same files:

| Rule file | Local builds | Script director | Hosted Pro author |
| --- | --- | --- | --- |
| `.claude/skills/gm-skill-authoring/references/shared-craft.md` (determinism, camera/springs/weight, handoffs, planning, audio, review) | linked by every gm-* skill | not embedded (authoring rules) | `author/stages/shared-craft.md`, in **every** stage |
| `.../references/watchability.md` | authoring checklist | `director/WATCHABILITY.md` (authoring-only lines fenced `director:skip`) | `author/stages/watchability.md` (every stage but `threejs`) |
| `.../references/script-for-motion.md` (beats with reasons, voiced-line rules, beat grid, formats, poster frame) | script rules | `director/SCRIPT_FOR_MOTION.md` | not needed for source edits |
| `.claude/skills/gm-motion-recipes/rules/*.md` (camera-rig, spring-settle, flood-handoff, line-boil, glow-flyline, scroll-brake) | verified examples | not embedded | `author/stages/recipes/*.md`; `camera-rig` and `spring-settle` always for animation, the others when the task asks for them |

`scripts/build-skill-bundle.mjs` produces the hosted copies, removing local-only text: a block between the cloud:skip marker pair, a line tagged cloud:skip-line, the rest of a line after cloud:skip-from, and a recipe's "Verified" section (our evidence, not an instruction). A style skill adds only what is specific to its style; a rule that is true of every film belongs in `shared-craft.md`, so the hosted author gets it too. `npm run test:cloud-skills -w backend` fails if the craft is missing from any stage's prompt or if local-only text leaks.

Deterministic checks that need no model: `voiceText` (`packages/contracts/src/beat-plan.ts`) turns a colon in a voiced line into a comma before any take is voiced, and `craftWarnings` (`backend/src/pro/seek-warnings.ts`) returns nonblocking warnings on every Pro proposal for clock/random use, CSS transitions, infinite repeats, overshooting easing on opacity, blur-ins, layers without z-index and a missing identity baseline. Release-time gates for a rendered film: `pop_gate.mjs` (single-frame pops, hard cuts), `seam_sheet.mjs` (mid-seam frames at phone size with safe zones), and optionally `scripts/subframe-render.mjs` (motion blur from 8 sub-frames, about 5x capture time).

## Motion blur: a choice at final submission

Previews are always fast: the storyboard player and the editor's 540p / 720p renders never use sub-frame rendering. At final submission the person can tick **Add motion blur** (storyboard Submit, the editor's Render popover, or `motionBlur: true` on the API). It is off by default and applies only to that final render:

- `POST /v1/projects/:id/render` (storyboard films), `POST /v1/projects/:id/pro/render` with `quality: "final"`, and `POST /v1/formats/:skill/render` accept `motionBlur` (a strict boolean). A preview quality with `motionBlur` is a 400; so is a film longer than 20 seconds (`motion_blur_too_long`), or the option on a legacy template project. The limits and the checkbox wording live in `packages/contracts/src/motion-blur.ts`, shared by the backend, the storyboard and the editor.
- The flag rides in the job's `render_input`. The worker (`worker/src/motion-blur.mjs`) captures at 30 fps x 8 sub-frames (240 fps, the CLI's ceiling; `MOTION_BLUR_SUBFRAMES` lowers it) and blends each group with ffmpeg `tmix`, copying the audio untouched. It ignores the flag for previews and for a film over the cap.
- Cost: measured on the 12 s velocity sting, 22.5 s normal against 112.7 s with blur (5.0x), identical frame count and audio length, pop gate clean. The queue expiry for such a job is stretched by the same factor (`expireInSeconds` x 5), so a slower worker does not lose the claim.
- A film with fast moves that the pop gate lists under `fast` is the case it helps; a calm film looks the same, so the checkbox says so and stays off.

## Stage selection and proposals

`POST /v1/projects/:id/pro/assist` accepts optional `stage`: `design`, `animation`, `threejs`, `logo`, `interaction`, `skill-authoring`, or `audit`. An explicit editor selection bypasses classification. Otherwise a small Claude structured-output call classifies the task's intent, with animation as the invalid/unclear-output default. The classifier defaults to Haiku (`ANTHROPIC_ROUTING_MODEL` overrides it). Clip IDs never enter routing or keyword sub-selection. HTTP failures remain errors; they are not silently hidden as routing defaults.

`author/stages.json` defines each stage's ordered source paths and optional task-only keyword selections. Adding bold styling is design; a 3D tilt feel or depicted toggle animation is animation. Actual WebGL implementation and actual user-input state machines have separate stages. Offline tests verify transport and mapping; classifier quality on live requests remains unverified.

Claude returns exact source replacements. Apply and HyperFrames lint errors are sent back verbatim against the original source for up to two repairs (three attempts total). Proposals return `attempts`, stage, selected paths, bundle hash, and nonblocking `warnings`; the user still reviews and applies the diff through the existing revision flow.

The backend image lacks Chromium and the release gate harness, so proposal seek checking is **static only**. Bare GSAP `set` calls are flagged; every proposal explicitly warns that forward/reverse frame equivalence was not verified. This heuristic can flag safe initialization and miss other unsafe patterns. Full visual seek checks run at release time.

## Shared Claude transport

`backend/src/anthropic.ts` owns headers, configured model, a deadline covering retries, up to two HTTP retries on 429/529/5xx with bounded backoff, caller-specific stop errors, and a usage-only log with input/output/cache-read/cache-creation tokens. Format fill, director, template planner, stage classifier and Pro author all use it. Their content-validation loops and user-facing errors remain separate. Injected `request` functions keep tests offline.

## Adding or updating a skill

1. Review the upstream license and exact commit. Preserve notices and provenance in `third_party/cloud-author-skills/SOURCES.json`. Do not fetch mutable branches at runtime. Unlicensed Delphi material is provenance-only.
2. Add author references and application adapters under `cloud-author/`; update `stages.json` with ordered paths and optional task-only selectors. References are data: HyperFrames application rules override upstream install commands and incompatible Remotion runtime advice.
3. For a hosted format, provide slots with budgets and fact rules, fill guidance, sample values and a self-contained frozen template. List it in `.claude/skills/BUNDLE.json`; bump its version and CHANGELOG. New binary Rive/Lottie assets and unrestricted hosted skill authoring still need dedicated production jobs.
4. Run `npm run skills:build`, then `npm run skills:check`, `npm run test:cloud-skills -w backend`, `npm run test:formats -w backend`, and `npm run typecheck`.
5. Run `node scripts/build-skill-bundle.mjs --gates` with the pinned HyperFrames browser installed. It builds samples with the production format builder and checks render contract, seeks and text floors. Only named entries in BUNDLE.json may be known gaps.
6. Commit sources and generated bundle together. Deployment is a separate action. Roll back by restoring the previous backend image; existing jobs retain their originating hash.

The worker renders the already-prepared folder. Product facts are supplied by the caller; Claude fills only allowed slots with one content repair. Schema failures report the precise slot. Format routes remain `GET /v1/formats` and `POST /v1/formats/:skill/render`.

## Test evidence (2026-10-08)

Real images built from the Dockerfiles (`videosaas-backend:skilltest`, `videosaas-worker:skilltest`), run as containers against an isolated Postgres database and render volume. The backend image contains no `.claude/` folder.

| Check | Result |
|---|---|
| Backend startup | "skill bundle verified": `gm-velocity-sting@1.1.1`, bundle `5f5c8233303f`, read from inside the image |
| Missing fact (`d_to` omitted) | `422 slots_invalid`, slot `d_to`: "Needs a real value from you: it is a fact about the product." |
| Over-budget value (39-character title) | `422 slots_invalid`, slot `b_title`: "39 characters; the limit is 16." |
| Unknown format / facts without a brief | `404 not_found` / `400 brief_required` |
| Real render: facts supplied, 12 slots written by Claude, brand kit "Ledgerly" (invented sample) | `202` in 11.8 s (fill + build + enqueue); worker rendered 358/358 frames; `ready`; `GET /v1/renders/:id` returned `video/mp4`, 1,767,315 bytes |
| Output | 1080×1080, 30 fps, 11.933 s, H.264 + AAC, peak −2.3 dBFS. Brand theme, supplied facts and model-written copy all present in the frames. Saved: `experiments/skill-delivery-test/ledgerly-hosted-sting.mp4` |
| Unit tests | `npm run test:formats -w backend`: 7 checks (bundle verification and tamper rejection, slot rules, builder output) |

**Not tested here:** the R2 hand-off (the route calls the same `uploadDirectory` and `projectPrefix` contract as the approved-storyboard path, which was verified in the October 8 release, but this run used the shared-disk driver); any staging or production deployment; a UI.


## Six-step hardening verification — 2026-10-09

Steps 1–5 are implemented and separately committed. The four requested commands pass in the shared working tree: skills freshness, offline cloud author tests, format tests and workspace typecheck. A local `videosaas-backend:unified-skills-check` Docker build verified the unified bundle without a `.claude` directory. No model calls or deployments were made. Live classifier accuracy, deployed behavior and a clean-checkout build were not verified; this workspace contains pre-existing and concurrently changing work.

Step 6 is **partially complete**, not release-ready seek proof. CI now invokes `node scripts/build-skill-bundle.mjs --gates`; the seek script's `--frames` option checks every 30 fps frame. Sting 1.1.2 replaces every timeline `set` flip with explicit from/to states. A preserved 1.1.1 sample and the new engine produced identical forward screenshots at all 358 frames. However, the same comparison recorded 221 reverse and 232 shuffled mismatches. A separate Linux Chromium run also reproduced seek failures. The seek-safety known gap is deliberately retained because its removal requires a passing proof. Text-size remains a separate existing known gap.

The retained [frame report](../validation/skill-delivery/sting-1.1.2-frame-proof.json) records every original/new forward hash and mismatch. Reproduce comparisons with `node scripts/verify-sting-seeks.mjs BEFORE_PROJECT AFTER_PROJECT REPORT.json`, then run `seek_safety.mjs --project AFTER_PROJECT --frames` for fresh-page checks too. Temporary experiments with layer hints, eager tween initialization, transform rendering and font painting did not establish full equivalence and were reverted. Investigate browser paint state alongside timeline state; matching inline/computed styles at sampled failures is evidence, not proof of the remaining cause. Never suppress pixel differences or delete the known-gap entry to manufacture a pass.

The release gate also requires at least two distinct rendered frames (`--require-motion`), so a frozen/blank animation cannot pass by producing identical screenshots. This guard was tested against a deliberately frozen experiment. The complete local release command passed only via the retained seek-safety and text-size exceptions; HyperFrames check passed, seek safety failed, and text-size found 23 undersized runs. This is not an unconditional gate pass.
