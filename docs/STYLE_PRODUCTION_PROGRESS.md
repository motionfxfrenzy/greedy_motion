# Material style production — implementation progress

Updated: 2026-10-09. Implementation resumed under the user's explicit request to complete the production work; the earlier document-only restriction was superseded. Changes remain local and uncommitted. **No paid generation and no deployment have occurred.** Local correctness and synthetic playback checks now pass; actual generated fidelity is still unverified.

## Objective and scope

Make the material styles from `third_party/creative-packs` reproduce their curated construction and motion, especially Vox/editorial, paper and clay. Keep product screenshots, typography and branding native, use the same saved clips in preview/export, and retain complete recipes, references and an extension workflow. Pack documents are creative references, never instructions overriding the user.

The catalog contains 18 styles: twelve generated material styles and six native drawing styles. Other received packs describe story formats, speaking characters, song/lip-sync workflows or static ads; their disposition is documented in [STYLE_LIBRARY.md](STYLE_LIBRARY.md). They are not silently represented as additional working material styles.

## Implemented and reviewed

- Versioned catalog, style picker and frozen recipe/reference bundles. Generated-style thumbnails explicitly say **layout draft — not generated footage**; none is presented as a validated generated example.
- Shared style key, per-scene keyframes, Google image generation and Veo image-to-video operations. Locked material instructions now appear in both keyframe and video prompts. Default new-run image model is `gemini-3.1-flash-image`; video remains `veo-3.1-fast-generate-preview`, eight seconds at 720p. Existing runs retain their pinned model names.
- Paper-cut assembly has an additional saved nine-panel planning sheet. A single opening panel is cropped for the first frame; the completed keyframe is passed as the final-frame constraint. The video prompt forbids visible grids. Its recipe version was bumped. This is implemented and offline-tested, not yet visually validated against provider output.
- Durable content-addressed assets through the existing filesystem/R2 adapter. MP4s must pass header-duration validation and a full FFmpeg decode before becoming ready. Backend Dockerfile includes FFmpeg.
- Generation enqueue and project state commit in the existing row transaction. Provider calls stay outside that transaction.
- A persisted consumer token and five-minute expiry fence duplicate and expired workers. Checkpoints renew ownership; queue abort signals stop work at checkpoint boundaries. Accepted in-flight results are checkpointed before stopping on a changed storyboard or queue cancellation.
- Two queue retries with a 310-second delay, 30-second heartbeat and one-hour expiry. Dead letters cannot fail a ready run or a currently leased consumer.
- Pending submission markers prevent automatic duplicate paid requests. Local references are prepared before marking a style-key submission pending. Saved video operations resume polling. Terminal video errors remain distinguishable and require operator reconciliation.
- Stale runs retain history, operation IDs, assets and reservations. The UI and enqueue calculation use cumulative project reservations, including earlier/reconciled attempts. No automatic refund is inferred from a provider error.
- Fingerprints track recipe reproduction fields, aspect, subject, theme/brand, live brand colors/mode and scene-generation inputs. Overlay-only copy and screenshot replacements no longer invalidate footage. A second palette check protects preview/export against a brand change after loading the project snapshot.
- Shared static video markup and source-rate calculation for preview/export. Longer scenes slow the source; square uses a centered crop. Generated audio is muted. Native text backgrounds improve readability.
- Export refuses incomplete or stale material scenes. Preview/media serving and export staging verify hashes. Missing/corrupt footage fails explicitly instead of becoming a graphic final film.
- Generation controls handle zero required scenes and refresh a ready preview on initial polling by run ID. Reservation wording distinguishes application estimates from provider billing.
- Operator reconciliation CLI: dry-run by default; explicit apply; run/shot and active-worker checks; evidence and prior-stage audit record; no automatic enqueue or reservation refund. Attach a known operation, release a proven unsubmitted request, or replace a terminal video operation. See [recovery instructions](STYLE_LIBRARY.md#retry-and-operator-recovery).
- Rough.js remains pinned to 4.6.6, with five unseeded calls guarded and seeded behavior unchanged. Generated HTML now retains the full MIT notice. Deterministic checks have not been suppressed.
- Environment examples, deployment requirements, model/reservation explanations and future-style workflow rewritten. A paid validation runner is prepared but has not been invoked with `--live`.

## Verification completed in this implementation pass

Earlier graphic-only results were not treated as evidence for the new pipeline. The following checks were actually run after the relevant changes:

| Check | Result and limits |
| --- | --- |
| `npm run typecheck` | Passed across frontend, backend and contracts |
| `npm run styles:build` / `npm run styles:check` | Passed; 18 recipes, three source sheets, engine/fixtures, contracts and reference hashes |
| `npm run test:visuals -w backend` | **30 passing offline tests**, plus Rough.js seed/notice guard. All twelve recipes; native exclusion; saved-operation resume; concurrent/expired workers; ambiguous image/video/assembly outcomes; stale plans; budgets; corrupt/missing files; terminal filtering; operator recovery; paper-cut endpoints; actual preview/export builders and live-palette race guard |
| `npm run test:visuals-db -w backend` | Passed against a disposable PostgreSQL 17 container: enqueue rollback, five concurrent enqueues producing one job, real row-lock consumer fencing, recovery CLI dry-run/apply, live brand invalidation, queue configuration, fetch and completion |
| `npm run test:ownership -w backend` | **12 passing integration groups**, including foreign-user visual GET/POST rejection, signed material media access, bounded/open-ended/suffix ranges, 416, unknown file and corruption rejection |
| `npm run test:media -w backend` | Four filesystem/media-signing checks passed; not a live R2 test |
| `npm run styles:verify` | All 18 native/layout styles passed four scenes × three aspects (216 primary captures), repeated/backward seeks, motion and brand binding |
| `npm run styles:ui` | All 18 selections, filters, decoded images and mobile overflow passed with the real React picker; rerun after final label change |
| `npm run styles:media` | Passed general HyperFrames audits, forward/reverse pixel comparisons and muted MP4 export in 16:9, 9:16 and 1:1; eight-second synthetic source slowed into a ten-second scene; twelve-second exports checked with ffprobe |
| Actual HyperFrames player | Passed playback and source-time seeks at first/last/intermediate frames, scene boundaries and reverse seeks in all three aspects. Uses production-equivalent byte-range serving. Integrated into `styles:media` |
| HyperFrames general audits | All 18 staged style fixtures passed; this sweep used each square fixture. The three synthetic material aspect fixtures separately passed lint, runtime, layout and contrast audits with browser samples actually executed |
| `npm run check:brand-tokens` | Passed, zero accepted legacy literals |
| `npm run build:frontend` | Production build passed; rerun after final picker-label change |
| Backend Docker image | Built locally; FFmpeg and frozen recipe/reference/template assets present. All 30 offline tests also passed inside the final production container |
| Provider model metadata | Read-only GET succeeded with configured credentials for both default model IDs. This proves metadata access, **not successful generation or billing/fidelity validation** |
| `git diff --check` | Passed |

The actual-player test initially failed because its test HTTP server did not serve ranges. Correcting that harness to reproduce the existing production route made the source-time assertions pass; no application playback workaround was added.

The final backend-container rerun passed all 30 tests, including actual builder integration and the live-palette race guard. A newer HyperFrames version was advertised, but the app's coordinated CLI/player/parser packages remain pinned to 0.8.111. The attempted latest-version probe failed on registry DNS; no dependency upgrade was made or claimed.

### Evidence

Durable text/JSON reports: [validation/ui/material-production](../validation/ui/material-production/README.md).

Raw local artifacts (temporary directories; rerun the scripts if removed):

- Final synthetic clips, audits, forward/reverse frames, MP4s and player results: `/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/material-playback-sc48IB`.
- Eighteen-style captures and per-style audits: `/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/style-matrix-m7tr3T`.
- Final picker captures: `/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/style-picker-69KR3X`.
- Backend build/container logs: `/tmp/material-backend-image-final.log`, `/tmp/material-container-tests-final.log`.

Exported landscape and portrait frames were visually inspected: synthetic footage is visible behind readable native text. Color-bar test clips are not material-style examples and must never be used as gallery previews.

## Budget and live validation approval

No generation spend has been approved. The original unanswered US$25 request remains unapproved. A new explicit request for up to **US$50** was sent during this continuation; there has been no explicit approval. The user's subsequent “continue” was not treated as authorization to spend.

The prepared batch is two related shots per generated style, starting with representative Vox, paper and clay review. With the new paper-cut planning sheets its application reservation is **$47.90** (the earlier approval question quoted $47.40 before those two extra images were added). The requested upper limit remains $50. Reservations are $0.25/image and $1.60/video submission, not a metered total or provider-enforced cap.

Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing), checked 2026-10-09, lists Gemini 3.1 Flash Image 1K output at $0.067 plus other tokens, and Veo 3.1 Fast 720p at $0.10/second. Model overrides require a fresh cost review. Default model metadata was accessible, but no generation call was made.

After explicit approval, the guarded runner is `backend/scripts/validate-material-samples.mjs`; instructions are in [STYLE_LIBRARY.md](STYLE_LIBRARY.md#live-fidelity-validation-explicit-spend-approval-required). Keep its manifest and content-addressed media for resume/accounting. Stop on uncertain submissions or exhausted budget. Failed creative review does not authorize more paid attempts.

## Outstanding work and limits

1. **Live fidelity gate:** generate and review representative Vox, paper and clay, then all twelve styles. Check construction/material on every object, scene semantics, shared identity, physical motion/cadence, source-recipe failures and crop safety. Review the paper-cut sheet/first/last-frame result specifically. No generated sample has yet passed this gate.
2. **Validated previews:** replace draft thumbnails only after a generated example passes review. Draft labels are now honest; generated example assets do not exist yet.
3. **Reference/approval UX:** there is no separate style-key approval screen or uploaded recurring-character reference kit. Current continuity comes from a shared generated style key; supplied product screenshots remain native overlays. If live review shows a recipe needs additional identity/end-frame stages, implement and test them before claiming exact reproduction.
4. **Operational limits:** worker expiry/cancellation are tested with controlled state and real row locks; no long-running process-kill/heartbeat soak or live R2 generation cycle was run. The queue's actual configured retry limits were inspected. Do not describe these tests as a production chaos test.
5. **Deployment:** image and local gates are prepared/validated, but the intended environment and rollout still need confirmation. No remote variables, services or production database were changed. No deployment approval was requested before these concrete local results were ready.

No item above should be marked complete solely from a recipe prompt, synthetic output, metadata GET or a successful build.

## File map

- Catalog/contracts: `packages/contracts/src/style-library/catalog.json`, `looks.ts`, `visuals.ts`.
- Portable production recipes and source references: `backend/style-library/`.
- Pipeline/provider/status: `backend/src/plan/visuals.ts`, `visual-provider.ts`, `visual-state.ts`.
- Recovery: `backend/src/plan/visual-recovery.ts`, `backend/scripts/reconcile-visuals.ts`.
- Paid validation runner (explicit opt-in only): `backend/scripts/validate-material-samples.mjs`.
- Preview/export: `backend/src/plan/visual-composition.ts`, `preview.ts`, `render-project.ts`, `readiness.ts`, `routes.ts`.
- Queue/project persistence: `backend/src/jobs/queues.ts`, `backend/src/projects/store.ts`.
- Controls/picker: `frontend/components/material-generation.tsx`, `style-picker.tsx`.
- Engine/seed adapter: `worker/templates/beat-plan/engine.js`, `build.mjs`.
- Tests: `backend/test/visuals.mjs`, `visuals-db.mjs`, `ownership.mjs`, `rough-seeds.mjs`.
- Browser/render tests: `scripts/verify-material-playback.mjs`, `verify-material-player.mjs`.
- Environment/build/extension instructions: backend `.env*.example`, `backend/Dockerfile`, `.github/workflows/ci.yml`, [STYLE_LIBRARY.md](STYLE_LIBRARY.md), [DEPLOYMENT.md](DEPLOYMENT.md).

Unrelated editor/auth/format/design changes were already present and have been preserved. Nothing was committed or deployed.
