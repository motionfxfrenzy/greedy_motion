# Hairline drawing style

Implemented locally: 2026-10-08. Deployment is separate.

Users choose **Hairline** under **Drawing style** in the Script & Style step.
Selecting it reveals the existing silent ten-second example, with playback
controls and metadata-only preload. The example demonstrates the style; each
generated video uses the user's own copy, screenshots and brand tokens.

The shared look catalog accepts `look: "hairline"`. The existing brief save and
validation path preserves that value. Both `backend/src/plan/preview.ts` and
`backend/src/plan/render-project.ts` pass it into the same beat-plan engine.
No additional model call is required to select this drawing treatment.

Kinetic beats show Hairline's original four isometric plates separating and
reassembling within the beat duration. Screenshot beats retain the screenshot
with thin frames separating behind it and returning before the cut. Titles use
outline decoration and an outlined CTA. All drawing colors and fonts follow
the selected brand/theme. Clean and Sketch remain catalog options.

This is a drawing treatment for the beat-plan flow. It does not reconstruct
arbitrary screenshots as editable 3D layers or add Hairline to unrelated
standalone format templates. Motion profile and drawing style are independent.

## Files and provenance

- Catalog: `packages/contracts/src/looks.ts`.
- Selector and sample: `frontend/components/script-style.tsx`,
  `frontend/public/previews/looks/hairline.mp4`.
- Rendering: `worker/templates/beat-plan/engine.js`, built into `index.html`.
- Frozen geometry and MIT notice: `worker/templates/beat-plan/assets/`.
- Shared engine fixture: `validation/creative-libraries/engine-hairline/`.

The frozen geometry is derived from Lucas Marques's
[Hairline](https://github.com/lucasmarkes/hairline), commit
`a2217852fed6d1a4f20bc7d43d4fad1a3de117b8`, through the existing experiment's
projection adapter. Production builds need no files from `experiments/`.
The complete MIT notice is included in generated composition HTML and beside
the public example video.

## Build and verify

```sh
node worker/templates/beat-plan/build.mjs
node scripts/build-engine-fixtures.mjs
npm run typecheck
node scripts/check-brand-tokens.mjs
node worker/templates/beat-plan/build.mjs --check
node scripts/build-engine-fixtures.mjs --check
node scripts/check-creative.mjs engine-hairline
node scripts/verify-hairline.mjs
```

The creative gate compares repeated captures and two brand themes. The Hairline
verification checks brief parsing and render-variable propagation, then captures
hook, screenshot, success and CTA scenes in landscape, portrait and square.
Snapshots are written to the printed temporary directory for visual inspection.
These checks do not exercise a deployed authenticated project-save or AWS job.

Verification on 2026-10-08: workspace type checks, brand-token lint, generated-file
checks and 12 aspect/scene snapshots passed. The general `hyperframes check`
stops at the existing inlined Rough.js library's `Math.random()` static finding;
it therefore does not run its layout/contrast audits. Repeated snapshot and
brand-switch checks are run separately by the creative gate. Do not describe
the general check as passing or the unexecuted audits as clean.

The product HyperFrames version is unchanged. The source example was made with
0.8.141; the application's existing CLI is used to verify the integrated engine.
