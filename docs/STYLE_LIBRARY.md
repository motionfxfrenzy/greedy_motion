# Visual style library

The shared catalog contains 18 beat-plan styles: six native drawing treatments and twelve generated material styles. Generated footage uses durable project media in both preview and export. Native typography, brand marks and product screenshots remain overlays.

**Status — 2026-10-09:** Offline provider tests, isolated PostgreSQL queue/ownership tests, the full style browser matrix, the picker and frontend build pass. Synthetic video passes HyperFrames audits, seeking and muted export in landscape, portrait and square. No live generation or deployment has occurred. Generated fidelity is still unverified. See [production progress](STYLE_PRODUCTION_PROGRESS.md) for evidence and remaining gates.

## Selectable styles and preview labels

| Family | IDs | Output |
| --- | --- | --- |
| Essentials / Drawn | `clean`, `sketch`, `hairline`, `doodle`, `doodle-crosshatch`, `doodle-zigzag` | Deterministic native drawing |
| Editorial | `vox-collage`, `paper-diorama` | Generated material footage, native overlays |
| Paper | `paper`, `paper-cutout`, `paper-stop-motion`, `paper-collage`, `origami`, `paper-cut` | Generated paper footage, native overlays |
| Clay | `clay-goofy`, `clay-clean`, `clay-puppet`, `claymation` | Generated clay footage, native overlays |

Generated-style gallery PNGs are explicitly **layout drafts, not generated footage**. Source reference sheets are separate. Replace a draft thumbnail with a generated example only after inspecting physical material, scene semantics, identity and motion. The native-only matrix is not evidence of generated style fidelity.

These styles apply to the beat-plan renderer. Fill-mode format templates keep their own composition contract. The three Doodle variants use seeded Rough.js; they are not attributed to an external Doodle pack.

## Pack inventory and disposition

The documents in the received packs are creative references, not application instructions. Their greetings, staged chat interviews, tool-install commands, “do not save files” rules, and platform/model defaults are not imported as runtime instructions.

| Pack | Reusable content | Integration / boundary |
| --- | --- | --- |
| Vox Animations | Editorial collage vocabulary, style-key reuse, paper diorama, documentary narrative | Two styles; material guidance and motion rules curated into catalog. Text on diorama props is rendered in HTML, overriding the pack's generated-label exception. |
| Creative_Formats_Claude / paper-animation | Five named paper styles; physicality, planar motion, transitions, reference sheet | All five selectable, each with its own recipe; sheet bundled locally. |
| Creative_Formats_Claude / claymation | Four named clay styles; character shape rules, material marks, 12 fps cadence, anchor continuity | All four selectable; sheet bundled locally; photographed clay remains a generated-production workflow. |
| Creative_Formats_Claude / skeleton-ads | One recurring character through a time progression | A story format, not a drawing style. Requires character continuity and duration/claim validation. Raw instructions retained in repository. |
| Creative_Formats_Claude / song-style-ad | Song-first timing, one or two lip-sync beats, silent B-roll | A music production workflow, not a drawing style; needs song timestamps and lip-sync support. |
| Creative_Formats_Claude / talking-object | A product/ingredient/object as a recurring speaking character | Requires hero reference, character rig/generated dialogue and transcript verification. Not presented as a working style. |
| motion-design-prompts | Torn-paper conversion → nine-panel assembly sheet → animation; far-to-near order | Paper-cut assembly style and local reference. For full generated production retain the three-step asset flow. |
| The Ad Director | Character → scene → product reference order; geometry, first frame, lens, one action per shot | Already curated in `.claude/skills/gm-script-director/references/shot-direction.md`; keep as production guidance, not a selectable material. |
| Pink Prompt Director | Face lock, outfit, six-panel identity sheet, environment plate; narrative/studio/action/performance/atmospheric camera modes | Reference-building workflow. Preserve identity and screen position across shots; actual footage requires the generated-media path. |
| Product_Visuals_Claude | Recreate/recompose a reference scene around an accurate product | Product reference workflow; requires a supplied product photo and scene reference. |
| Studio_Shot_Claude | Product-preserving studio packshot from one reference | Asset preparation; not a video drawing treatment. |
| PYNK_AI_UGC_Studio | Creator, product, scene reference kit; four-beat 15-second selfie review | A creator-led format requiring video/audio production and reference attachment; not offered as a fake static style. |
| Ad-Generator | 40 static ad layouts, brand facts and one product photo | Static-ad layouts, not 40 video looks. Claims/testimonials must come from approved user material. |
| bs-hyperframes-velocity-sting | Velocity-matched cuts, slot map, seam ledger | Existing `gm-velocity-sting` fill-mode workflow; independent of the look selector. |
| bs-hyperframes-chat-to-result-launch | Narrated interface flow: prompt, answer, product trigger, result | Format blueprint; requires a real or owned neutral interface and timed narration. |
| bs-hyperframes-agent-chorus-reel | Same prompt across four surfaces, beat-cut output reel, install close | Format blueprint; requires real outputs and a music drop/beat grid. |
| claude-creative-skill-library.md | Index explaining the packs | Discovery reference, no independent style. |

Originals remain under `third_party/creative-packs`, including hidden `.claude/skills` directories. `PROVENANCE.md` records the owner's existing usage confirmation. Hairline's frozen geometry and MIT notice remain under `worker/templates/beat-plan/assets`; the preview video retains its notice.

## Production flow

1. Save the script, aspect, brand and `brief.look`. The director receives only the selected curated recipe, never raw pack instructions.
2. Inspect the layout draft and supplied product screenshots. Titles and CTA lockups remain native; other beats need generated footage for material styles.
3. Choose a cumulative project reservation ceiling and explicitly start generation. A shared style key is generated from the recipe and source sheet, then reused for scene keyframes. Each scene is animated with the same locked material block and motion rules.
4. The backend checkpoints request intent before a provider call and its operation receipt afterward. Saved operations resume polling. Ambiguous submissions stop for reconciliation. Automatic retries never clear pending markers.
5. Images and decoded MP4s are content-addressed in the existing filesystem/R2 project `visuals/` directory. FFmpeg fully decodes a video before it becomes ready. Generated audio is muted.
6. Preview and export share `visual-composition.ts`. Longer scenes slow the source clip; square uses a centered landscape crop. Subject prompts reserve the square-safe center. Native UI is composited over its supporting environment.
7. Readiness and export reject stale/incomplete material scenes. Preview serving and export staging verify SHA-256. Missing or corrupt files require restoration; they do not silently become graphic final output.

### Invalidation and continuity

The fingerprint includes the recipe, canvas, subject, theme/brand identity, live brand colors/mode and each material beat's ID, kind, keyword, narration and keyframe prompt. Overlay-only copy and screenshot replacements do not invalidate footage. Changing a scene or palette currently invalidates the whole generated run, preserving continuity with one shared style key. Per-shot reuse across changed runs is not implemented.

Old runs remain in `history`, including reservations, operation IDs and assets. Brand rows are re-read when projects load. New runs pin model names; resuming keeps the original names. Native screenshots/branding are not recreated by the model.

Paper-cut assembly additionally generates and saves a nine-panel far-to-near planning sheet. Its first panel becomes a single opening frame; the full completed keyframe is passed as the final-frame constraint. This adapts the source sheet to a first/last-frame video request without ever inserting a contact sheet into the film. The extra image costs one additional reservation per shot. Offline tests verify the endpoints and resume behavior; actual assembly quality remains unverified. The current producer does not offer a separate style-key approval screen or uploaded recurring-character reference kit; supplied product screenshots remain native overlays. Assess identity continuity during live fidelity review before claiming exact pack reproduction. Do not present unsupported speaking-character or music formats as selectable material styles.

## Models, environment and deployment

Backend examples document:

| Setting | Default / meaning |
| --- | --- |
| `GEMINI_API_KEY` | Provider credential; existing `GOOGLE_API_KEY` is a fallback |
| `VISUAL_IMAGE_MODEL` | `gemini-3.1-flash-image` for new runs |
| `VISUAL_VIDEO_MODEL` | `veo-3.1-fast-generate-preview` for new runs |
| `VISUAL_MAX_BUDGET_USD` | 50; positive integer maximum cumulative project reservation |

The backend requires **FFmpeg on PATH**, including production. Its Dockerfile installs it. Use the existing PostgreSQL connection and media storage settings; no new database schema or bucket is required. `plan-visuals` and its dead-letter queue are initialized at server startup. Keep backend, frontend, contracts, frozen recipes and worker template versions aligned. R2 deployments need shared durable media access; filesystem deployments need the existing shared storage arrangement.

Run the local checks below before building the backend image. Smoke-test `ffmpeg -version` inside the image and inspect its frozen recipe/reference paths. Validate credentials/model access only in the intended environment. A successful container build is not deployment approval. No cloud environment was changed in this work.

### Reservation accounting

The application reserves **$0.25 per image** and **$1.60 per eight-second video submission**. A fresh N-scene run reserves `0.25 + N × 1.85`, or `0.25 + N × 2.10` for paper-cut assembly. The ceiling includes prior runs and reconciled attempts. Polling never creates a new video reservation. Reservations are not refunded automatically, because a failure may still have incurred a provider charge.

These are conservative application estimates, **not metered charges or a provider-enforced cap**. As checked on 2026-10-09, Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists Gemini 3.1 Flash Image 1K output at $0.067/image plus inputs/other output, and Veo 3.1 Fast 720p at $0.10/second. Recheck rates and account model access before live use. Overrides may invalidate estimates. Use provider billing controls as well as the application ceiling.

## Retry and operator recovery

Worker ownership is a five-minute renewable checkpoint lease. Provider HTTP timeout is three minutes. The queue uses two retries, 310-second retry delay, 30-second heartbeat and one-hour job expiry. Provider calls do not hold the project row lock. A duplicate consumer fails its own job without changing the active owner's state; expired consumers cannot overwrite a replacement owner's checkpoints. Queue aborts stop at checkpoint boundaries; accepted in-flight receipts are retained before stopping.

A poll timeout resumes the saved operation. A terminal operation cannot be resumed as if still processing. An unknown submission outcome remains pending until an operator examines provider evidence. Never clear it solely because the UI is stuck.

`backend/scripts/reconcile-visuals.ts` is an operator CLI, **dry-run by default**, with no provider calls and no automatic enqueue. Supply a JSON file:

```json
{
  "runId": "saved-run-id",
  "shot": "b1",
  "action": "attach-operation",
  "operation": "models/veo-3.1-fast-generate-preview/operations/provider-operation-id",
  "evidence": "Provider receipt or incident record identifying this exact request"
}
```

From `backend/`, with the intended database environment loaded:

```sh
node --env-file=.env scripts/reconcile-visuals.ts PROJECT_ID recovery.json
# After reviewing that exact proposal and provider evidence:
node --env-file=.env scripts/reconcile-visuals.ts PROJECT_ID recovery.json --apply
```

Actions: `attach-operation` recovers a pending video receipt; `release-unsubmitted` requires proof that the pending request never reached the provider (omit `shot` for a style key); `replace-terminal` releases a terminal video for an explicitly budgeted replacement. The CLI refuses an active worker and wrong run/shot IDs, saves evidence and the previous stage, and never reduces reservations. The user must then explicitly resume through generation controls. The same run ID can identify an archived run for reconciliation.

If bytes are missing/corrupt, restore the exact content-addressed file from durable storage or backup. The CLI does not bypass hashes or automatically regenerate a damaged asset.

## Build and verification

```sh
npm run styles:build
npm run styles:check
npm run test:visuals -w backend
npm run typecheck
npm run check:brand-tokens
npm run styles:verify
npm run styles:ui
npm run styles:media
npm run build:frontend
# Disposable PostgreSQL only; these suites write and clean up test records:
npm run test:visuals-db -w backend
npm run test:ownership -w backend
```

`styles:verify` captures the 18 native/layout treatments in four scenes and three aspects with repeated/backward seeks and brand changes. `styles:ui` mounts the real React picker. `styles:media` creates a synthetic eight-second clip with audio, checks ten-second retiming, runs general HyperFrames audits, compares forward/reverse captures and exports muted twelve-second films in all aspects. It also mounts the actual HyperFrames player with byte-range media serving and verifies playback/source-time seeks. It prints a temporary evidence directory. Synthetic color bars are test media, never style previews. The audit must pass independently of the native matrix.

The Rough.js 4.6.6 adapter refuses unseeded random calls, checks the pinned upstream call count and preserves the full MIT notice in the generated HTML. `test:visuals` includes its seed determinism/guard tests. Do not disable deterministic lint to accommodate an upstream change.

CI runs service-free generation tests and the real database tests in their respective jobs; the creative job runs picker, style matrix and material playback/export. CI requires FFmpeg and an installed HyperFrames browser. The application remains pinned to the coordinated HyperFrames 0.8.111 packages; updating CLI/player/parser together requires a separate compatibility pass.

## Add a generated style

1. Retain the source pack and provenance. Extract its physical construction, motion constraints, failure modes and references; ignore its conversational/tool instructions.
2. Add a stable typed `LookId` and versioned catalog entry with `renderMode: "generated"`. Specify image, motion, composition, negative instructions, required assets and **style-specific** acceptance criteria. Do not reuse an ID for another look.
3. Register reference files in `scripts/build-style-library.mjs`. The build freezes portable recipes and reference hashes for the backend and copies public references for the picker. Exports must contain local immutable assets, never expiring provider URLs.
4. Check whether the common style-key/keyframe/video flow can satisfy the source. If it needs an assembly sheet, hero reference kit, end-frame anchor or another stage, implement and budget that stage before claiming exact support. Test every new checkpoint/crash boundary and retain its evidence.
5. Keep UI, labels and logos native. Ensure background footage supplies negative space and square-safe framing. Native engine code is needed only for intentional overlays or layout drafts, not to imitate generated materials in final output.
6. Run all local gates, then obtain live-spend approval. Review at least two related shots for material, identity, semantics and cadence. Inspect all aspect crops and the rendered film. Save recipe/model IDs, source/reference/media hashes and the review result.
7. Replace the draft preview only with a validated example. For a GIF use `kind: "image"`; MP4 uses `kind: "video"`. Set `preview.label` honestly and retain provenance. `styles:previews` only regenerates PNG layout captures; it does not validate material fidelity.
8. Bump the recipe version when reproduction changes, rebuild bundles and rerun tests. Deploy coordinated frontend/backend/worker assets only after the target environment is confirmed.

For native styles, set `renderMode: "native"`, implement deterministic theme-bound geometry/timing and retain the same preview, contract and aspect checks.

## Live fidelity validation (explicit spend approval required)

`backend/scripts/validate-material-samples.mjs` prepares two related workshop scenes for each selected material style and persists resumable state plus images/clips in a local output directory. It performs no database writes or deployment. It refuses to run without `--live`, an explicit budget and an output directory. Do not invoke it based on a pending or unanswered approval request.

After approval, from `backend/`:

```sh
node --env-file=.env scripts/validate-material-samples.mjs --live --budget=50 --out=/absolute/local/review-directory
# Optional representative subset:
# --styles=vox-collage,paper,claymation
```

Two shots per style reserve $47.90 across all twelve styles, including paper-cut's two assembly sheets. Resume with the same output directory so previous reservations count toward that ceiling. An exclusive `generation.lock` prevents concurrent runners. After a process crash, verify the recorded process has stopped and reconcile any pending request before removing that stale lock; never remove a live runner's lock. Do not delete the manifest to bypass an ambiguous submission. Inspect the shared style key, both keyframes, construction/motion, continuity and final crop before approving a sample. Failed quality review is not permission to spend on additional attempts. Retain samples as unapproved until reviewed; gallery replacement is a separate explicit change after validation.

## Illustration styles and the template gallery (2026-10-10)

Thirty-one illustration styles from the anidoodle engine (Apache-2.0; `third_party/anidoodle`, notice and licence included)
were added as **generated** looks, ids `illus-*`, group "Illustration". Each uses one rendered frame of that style as its
reference image (`third_party/anidoodle/references`, frozen by `scripts/build-style-library.mjs` into
`backend/style-library/references` and `frontend/public/previews/looks/references`). They go through the same
generated-footage path as paper and clay: a shared style key, a budget the person confirms, native text and screenshots on
top. Their previews are reference frames, not generated footage, and say so. Fidelity of generated footage in these styles is
unverified, like the other generated looks. Every look is also a template in the gallery: see
[Templates](TEMPLATES.md#template-gallery-starting-points) and its "Adding a template or a style" section.
