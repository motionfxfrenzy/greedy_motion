# Plate Film Real-Length Billing & Storyboard Length Report

**Date:** 2026-11-06  
**Worktree:** `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-billing`  
**Branch:** `codex/billing-real-length` (base commit `8f435ad`)

---

## 1. Summary & Exact Diff (`git diff --stat`)

For plate looks (`brief.look` starting `illus-`), the render quote (`GET /v1/projects/:id/render/quote`), the render charge (`POST /v1/projects/:id/render`), `planReadiness(project).durationSeconds`, and the storyboard composition route (`GET /v1/projects/:id/composition`) now all use the real rendered plate timeline length from `plateFilmSeconds(project)` (`buildTimeline(frames, voice).totalFrames / FPS`). HyperFrames and every other look continue to use the planner clock (`planTiming`), unchanged.

### Files Changed and Created

| File | Status | Lines (`+/-`) | Description |
| --- | --- | --- | --- |
| `backend/src/plates/inputs.ts` | Modified | `+10 / -1` | Imported `buildTimeline` from `./model.ts` and added `plateFilmSeconds(project: VideoProject): number \| null` beside `sceneFrames`. |
| `backend/src/plan/readiness.ts` | Modified | `+3 / -1` | Imported `plateFilmSeconds`; set `durationSeconds = (isPlate ? plateFilmSeconds(project) : null) ?? timing.total` while keeping `blocking`, `warnings`, and the target-length check (`offTarget`) unchanged. |
| `backend/src/plan/routes.ts` | Modified | `+4 / -3` | In `GET /v1/projects/:id/composition`, computed `readiness = planReadiness(project)` once and set `durationSeconds: readiness.durationSeconds ?? timing.total` (`beatTimes` and all other fields untouched). |
| `docs/PRICING.md` | Modified | `+1 / -1` | Added one sentence in *"How a video's tokens are worked out"* stating that plate looks (`illus-*`) are priced from their rendered scene lengths via `plateFilmSeconds`. |
| `backend/test/plate-film-length.mjs` | Created | `+620` | Unit + DB + HTTP route test suite covering cases (a)–(e), idempotency and failure refunds at the new price, and Additional Requirements 1–3. |
| `docs/billing/real-length-report.md` | Created | — | This report. |

```text
 backend/src/plan/readiness.ts |  4 +++-
 backend/src/plan/routes.ts    |  7 ++++---
 backend/src/plates/inputs.ts  | 11 ++++++++++-
 docs/PRICING.md               |  2 +-
 4 files changed, 18 insertions(+), 6 deletions(-)
```

Untouched (verified by `git diff --stat`): `backend/src/plates/model.ts` (`secondsFor`, `framesForSeconds`, `buildTimeline`), `backend/src/plates/exports.ts`, `backend/src/plan/timing.ts` (`planTiming`, `TIMING_RULES`), `backend/src/tokens/*`, `backend/src/render/*`, `backend/src/server.ts`, `packages/contracts/*`, `frontend/*`, `worker/*`, and all `package.json` files.

---

## 2. Before / After Numbers

| Case | Planner Clock (`timing.total`) | Before: `readiness.durationSeconds` / `quote.seconds` / `quote.tokens` (millitokens) | After: `plateFilmSeconds` / `readiness.durationSeconds` / `quote.seconds` / `quote.tokens` (millitokens) | `buildExport` (`manifest.totalFrames / FPS`) |
| --- | --- | --- | --- | --- |
| **(a) 6-beat `illus-blueprint`, no audio** (each scene hits 3.0 s / 90-frame floor; `target_duration_s = 12`) | `12.0 s` | `12 s` / `12 s` / **`9.6 tokens`** (`9,600`) | `18.0 s` / `18.0 s` / `18 s` / **`11.4 tokens`** (`11,400`) | `540 / 30 = 18.0 s` (`durationSeconds: 18`) |
| **(b) 6-beat `illus-blueprint`, with voiceover** (scene 0 take `4.4 s` → `secondsFor = 5.0 s = 150 frames`; scenes 1–5 takes `2.0 s` → `3.0 s = 90 frames` each) | `14.533 s` | `14.533 s` / `15 s` / **`10.5 tokens`** (`10,500`) | `20.0 s` / `20.0 s` / `20 s` / **`12.0 tokens`** (`12,000`) | `600 / 30 = 20.0 s` (`durationSeconds: 20`) |
| **(h) 6-beat `illus-blueprint`, fractional voiceover** (scene 0 take `3.1 s` → `secondsFor = 3.5 s = 105 frames`; scenes 1–5 takes `2.0 s` → `3.0 s = 90 frames` each) | `13.233 s` | `13.233 s` / `14 s` / **`10.2 tokens`** (`10,200`) | `18.5 s` / `18.5 s` / `19 s` / **`11.7 tokens`** (`11,700`) | `555 / 30 = 18.5 s` (`ceil = 19 s`) |
| **(c) 6-beat non-plate (`look: "clean"` or no `look`)** (`target_duration_s = 12`, no audio) | `12.0 s` | `12.0 s` / `12 s` / **`9.6 tokens`** (`9,600`) | *(n/a)* / `12.0 s` / `12 s` / **`9.6 tokens`** (`9,600`) — **unchanged** | *(HyperFrames render)* |

---

## 3. Test-First Output & Full Test Commands

### 3.1 Step 2 — Failing Output of `backend/test/plate-film-length.mjs` Before Code Changes

Command run against fresh database `plates_unit_billing_test`:

```bash
DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-film-length.mjs
```

Output before implementing the change:

```text
AssertionError [ERR_ASSERTION]: planReadiness.durationSeconds equals 18 s (not planner 12 s)

12 !== 18

    at file:///Users/osamaehsaan/Code/Market_apps/VideoSaaS-billing/backend/test/plate-film-length.mjs:328:10
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 12,
  expected: 18,
  operator: 'strictEqual',
  diff: 'simple'
}
Exited with code 1
```

### 3.2 Step 1 & Step 5 — Baseline vs Post-Change Test Results

*(Note: before running the first test in this fresh worktree, `npm ci --offline --ignore-scripts` was run once to populate local `node_modules` from the local npm cache with zero network traffic and zero tracked file changes. `plates_unit_billing_test` was created before the tests and dropped with `dropdb` immediately after.)*

| Command (from `backend/`) | Baseline (`8f435ad`) | After Change | Output / Notes |
| --- | --- | --- | --- |
| `node --check src/plates/inputs.ts` | PASS (`0`) | PASS (`0`) | Clean syntax check. |
| `npm run typecheck` | PASS (`0`) | PASS (`0`) | `tsc --noEmit -p .` |
| `node test/render-quote.mjs` | PASS (`0`) | PASS (`0`) | `render quote: ok` |
| `node test/plate-model.mjs` | PASS (`0`) | PASS (`0`) | `plate model: ok` |
| `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-film-length.mjs` | FAIL (`12 !== 18`) | **PASS (`0`)** | `plate film length: ok` |
| `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-render-billing.mjs` | PASS (`0`) | PASS (`0`) | `plate render billing: ok` |
| `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-export-manifest.mjs` | PASS (`0`) | PASS (`0`) | `plate export manifest: ok` |
| `DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/render-prep.mjs` | FAIL (pre-existing) | FAIL (identical) | Fails identically on untouched `8f435ad` at line 77 (`AssertionError: 'A plan needs at least one beat.' did not match /at least three beats/`); also listed as pre-existing in `docs/phase5/5-report.md` §4.1. |

---

## 4. Additional Requirement 1 — Every Consumer of `durationSeconds`, `projectTiming(`, and `planReadiness(`

### 4.1 Complete Consumer Audit Across `backend/src/` and `frontend/`

#### A. Consumers of `planReadiness(` and `Readiness.durationSeconds`

| Location (`file:line`) | What It Reads / Does | Behaviour Changes for Plate Films? | Verdict & Details |
| --- | --- | --- | --- |
| `backend/src/plan/readiness.ts:32-77` | `planReadiness(project)`: computes `blocking`, `warnings` (incl. `offTarget` at l.72-75), and returns `durationSeconds = (isPlate ? plateFilmSeconds(project) : null) ?? timing.total` (l.76-77). | **YES** (for `durationSeconds` only; **NO** for `blocking`/`warnings`) | `durationSeconds` is now `plateFilmSeconds(project)` (e.g. `18 s` instead of `12 s`). `offTarget` warning at l.72-75 still compares `timing.total` with `plan.target_duration_s`. |
| `backend/src/plan/readiness.ts:94` | `prepareBeatPlanRender(project, jobId)`: checks `readiness.ok` (HyperFrames path only; plate films branch earlier at `render/service.ts:83`). | **NO** | Only reads `readiness.ok` and only runs for non-plate films. |
| `backend/src/render/quote.ts:28-36, 81` | `GET /v1/projects/:id/render/quote` → `quoteFrom(planReadiness(project), material, balance)`: computes `seconds = Math.max(1, Math.ceil(readiness.durationSeconds))`, `tokens = tokensFromMilli(renderCostMillitokens(seconds))`, and `enough = balance >= tokens`. | **YES** *(intended)* | Plate film quote `seconds`, `tokens`, and `enough` now reflect `plateFilmSeconds(project)`. Tested in `plate-film-length.mjs` §(a), (b), (g), (h). |
| `backend/src/server.ts:274-277` | `POST /v1/projects/:id/render` when `blur.on` (`motionBlur: true`): `const seconds = planReadiness(project).durationSeconds; const tooLong = seconds === null ? null : motionBlurProblem(seconds);` (`maxSeconds = 20`). | **YES — LIMIT CHANGE (see §4.2 below)** | Previously compared planner `timing.total <= 20`; now compares `plateFilmSeconds(project) <= 20`. Tested on both sides (`18 s` accepted vs `21 s` refused) in `plate-film-length.mjs` §(g).1. |
| `backend/src/server.ts:279-294` | `POST /v1/projects/:id/render`: checks `readiness.ok`, then spends `renderCostMillitokens(readiness.durationSeconds)` via `spendTokens(...)` (refusing with `402 insufficient_tokens` if `balance < needed`). | **YES** *(intended; see §4.2 on 33-token Free tier)* | Charges the real plate length and checks balance against that charge. Tested on both sides of the 33-token (90 s) Free-tier balance in `plate-film-length.mjs` §(f) and §(g).2. |
| `backend/src/server.ts:300` | `renderService.createBeatPlanRender(project, jobId, ..., seconds ?? 0)`: passes `seconds` into `beatPlanRevision(project, durationSeconds)`. | **NO** (unless `timing` is null, which cannot happen when `project.beatPlan` is non-null) | In `render/service.ts:27-38`, `beatPlanRevision` uses `times[beat.id]!.end - times[beat.id]!.start` from `projectTiming(project)` for every beat and only falls back to `durationSeconds / plan.beats.length` if `times[beat.id]` is missing. Later at `render/service.ts:111`, `prepareFilm` overwrites `revision` with `built.durationSeconds` anyway. |
| `backend/src/plan/routes.ts:985, 991, 1002` | `GET /v1/projects/:id/composition`: returns `durationSeconds: readiness.durationSeconds ?? timing.total` and `readiness`. | **YES** *(intended)* | Returns `plateFilmSeconds(project)` as both `composition.durationSeconds` and `composition.readiness.durationSeconds`. Tested in `plate-film-length.mjs` §(e). |
| `frontend/components/beat-storyboard.tsx:184-190, 321, 334, 339, 351, 393-397` | Reads `composition.durationSeconds` into `lengthSeconds` (l.321) and `composition.readiness` (l.188). Uses `lengthSeconds` for header `clock(lengthSeconds)` (l.339), `motionBlurProblem(lengthSeconds)` (l.394), and `<RenderCost seconds={lengthSeconds} />` (l.397). | **YES** *(intended for header & `<RenderCost>`; limit change for `motionBlurProblem` at l.394)* | Storyboard header clock and `<RenderCost>` now show the real plate length and token price; `motionBlurProblem(lengthSeconds)` disables the motion-blur checkbox when `plateFilmSeconds > 20`. |
| `frontend/components/studio.tsx:723-729, 979` | Calls `getRenderQuote(project.id)` when `isPlateStyle` and passes `quote.tokens` as `cost` to `<PlatePreview>`. | **YES** *(intended)* | Render button in `PlatePreview` now displays the token price for the real plate film length. |
| `frontend/components/browser-animation-step.tsx:376` | Reads `comp.durationSeconds` from `getComposition(project.id)` as fallback timeline duration in non-plate browser animation step. | **NO** | Only mounted when `!(isPlateStyle && !animating && project.beatPlan)` (`studio.tsx:981`). |

#### B. Consumers of `projectTiming(` in `backend/src/`

| Location (`file:line`) | What It Reads / Does | Behaviour Changes? |
| --- | --- | --- |
| `backend/src/plan/preview.ts:37, 85` | Defines `projectTiming(project)` (`planTiming(project.beatPlan, ...)`) and uses it in `planPreviewHtml` for the HyperFrames preview iframe. | **NO** |
| `backend/src/plan/readiness.ts:55, 98` | Line 55 reads `timing.warnings` and `timing.total` (for `offTarget` and non-plate `durationSeconds`); line 98 runs inside `prepareBeatPlanRender` (non-plate only). | **NO** (`offTarget` still uses `timing.total`; `durationSeconds` uses `plateFilmSeconds` for plate looks). |
| `backend/src/plan/routes.ts:731` | Inside `POST /v1/projects/:id/film/animate` (SVG frame-film motion route, non-plate): times `filmFrames(project, timing)`. | **NO** |
| `backend/src/plan/routes.ts:937, 941` | `POST /v1/projects/:id/plan/audio`: returns `durationSeconds: timing?.total ?? (result.project.brief?.durationSeconds ?? 30)` and `beatTimes`. (See §7 Surprising Findings below.) | **NO** |
| `backend/src/plan/routes.ts:983` | `GET /v1/projects/:id/composition`: computes `beatTimes(timing)` for `beatTimes` while `durationSeconds` now uses `readiness.durationSeconds ?? timing.total`. | **NO** for `beatTimes`; **YES** for `durationSeconds` *(intended)*. |
| `backend/src/plan/render-project.ts:37, 115` | `buildPlanRenderProject` (HyperFrames render folder builder, non-plate). | **NO** |
| `backend/src/plan/element-edits.ts:59, 134` | HyperFrames comment edit proposal/commit timing (`proposeHyperFramesCommentEdits`). | **NO** |
| `backend/src/render/service.ts:29` | `beatPlanRevision`: computes per-scene `duration` on `job.revision.scenes` from `projectTiming(project)`. (See §7 Surprising Findings below.) | **NO** |

#### C. Other Occurrences of `durationSeconds` in `backend/src/` and `frontend/`

| Location (`file:line`) | What It Is | Behaviour Changes? |
| --- | --- | --- |
| `backend/src/plates/exports.ts:182, 322, 341` | `buildExport` returns `durationSeconds: Math.round((timeline.totalFrames / FPS) * 10) / 10` and `requestExport` stores it in `app.plate_exports.duration_seconds`; `render/service.ts:109` passes `built.durationSeconds` in `renderInput`. | **NO** (already computed from `buildTimeline`). |
| `backend/src/plan/preview-meter.ts:1-90` | Preview allowance meter (`PREVIEW_ALLOWANCE`, `PREVIEW_CALL_CAP`): counts distinct projects and model calls per period; never reads film duration. | **NO** |
| `backend/src/tokens/plan.ts` & `backend/src/billing/service.ts` | Re-exports pricing constants (`PLANS`, `renderCostMillitokens`, etc.) and handles Lemon Squeezy webhooks. | **NO** (function definitions unchanged; see §4.2 for the 33-token Free balance effect). |
| `backend/src/pro/routes.ts:88-344`, `backend/src/pro/blank.ts:6-32` | Pro editor composition `durationSeconds` and `motionBlurProblem(pro.durationSeconds)`. | **NO** |
| `backend/src/formats/build.ts:41`, `backend/src/formats/routes.ts:26, 102, 122` | Author-skill format renders. | **NO** |
| `backend/src/plan/script-draft.ts:44, 49`, `script-writer.ts:66, 68`, `director.ts:172-479`, `audio.ts:78` | Reads `brief.durationSeconds` (user's requested target duration). | **NO** |
| `backend/src/plan/visual-provider.ts:43`, `render/anthropic-planner.ts:30, 43`, `render/service.ts:265`, `render/repository.ts:66`, `server.ts:95` | Veo 8 s clip config, legacy template duration, and `job.output.durationSeconds`. | **NO** |
| `frontend/components/script-style.tsx:16, 76-78, 131-132` | Brief target duration selector (`brief.durationSeconds`, `5..120 s`). | **NO** |
| `frontend/components/studio.tsx:545, 548, 960, 1095` | Brief target duration in `ScriptCanvas` (l.545, 960) and `ProjectCard` badge length `project.filmSeconds ?? scriptSeconds(...) ?? target_duration_s` (l.1095; see §7). | **NO** |
| `frontend/components/plate-live-stage.tsx:570`, `frontend/lib/live/plate-player.ts:1686, 1779-1780`, `frontend/lib/live/film-audio.ts:260, 275` | Live stage per-scene audio/frame duration in `PlatePreview`. | **NO** (already used scene frames + voice durations). |
| `frontend/components/editor/EditorApp.tsx:89, 91`, `Overlays.tsx:83`, `studio-editor.tsx:256-490`, `preview-card.tsx:34, 41`, `template-picker.tsx:34, 62` | Pro editor and legacy template picker durations. | **NO** |

---

### 4.2 Escalation Note on Limits That Change Behaviour (Advisor Rule 1)

Per Requirement 1 (*"If any LIMIT changes (a film that was accepted before is now refused, or the reverse), do NOT quietly accept it: stop that item, describe it in the report with numbers, and keep the old behaviour behind the old number if that is possible without a design decision; the advisor takes it to the user"*):

1. **Motion-blur 20-second limit (`motionBlurProblem(seconds)` at `backend/src/server.ts:274-277` and `frontend/components/beat-storyboard.tsx:394`):**
   - **What changed:** `motionBlurProblem` refuses when `durationSeconds > 20` (`motionBlur.maxSeconds = 20` in `packages/contracts/src/motion-blur.ts:7`).
   - **Concrete numbers:** A 7-beat `illus-blueprint` film with 6-word lines and `target_duration_s = 15` has planner `timing.total = 14.933 s` (`<= 20 s`) and real plate length `plateFilmSeconds = 21.0 s` (`7 × 90 = 630` frames at `30` fps, `> 20 s`).
     - **Before:** `planReadiness(project).durationSeconds` was `14.933 s`, so `POST /v1/projects/:id/render` with `{ motionBlur: true }` was **accepted (`202`)**.
     - **After:** `planReadiness(project).durationSeconds` is `21 s`, so `POST /v1/projects/:id/render` with `{ motionBlur: true }` is **refused (`400 motion_blur_too_long`: `"Motion blur is available for films up to 20 seconds; this one is 21. Render without it."`)**. (A 6-beat `18 s` plate film remains `<= 20 s` and is still accepted with `202`.)
   - **Why the old behaviour cannot be kept behind the old number without touching a forbidden file:** `backend/src/server.ts` is read-only (forbidden by the brief), and calls `planReadiness(project).durationSeconds` for **both** `motionBlurProblem(seconds)` (line 274) and `spendTokens(owner, renderCostMillitokens(seconds), ...)` (lines 285–289). Likewise, `frontend/components/beat-storyboard.tsx` (forbidden) reads `composition.durationSeconds` for both `<RenderCost seconds={lengthSeconds} />` (line 397) and `motionBlurProblem(lengthSeconds)` (line 394). Furthermore, plate films (`kind: "plate-film"` in `backend/src/render/service.ts:100-110`) do not even forward `prep.motionBlur` to the plate worker, and `PlatePreview` (`frontend/components/plate-preview.tsx`) has no motion-blur toggle.
   - **Action for advisor:** Confirm whether `server.ts:274` should reject `{ motionBlur: true }` on plate films outright or check `plateFilmSeconds <= 20`. Both sides of the 20 s limit (`18 s` accepted vs `21 s` refused) are tested in `backend/test/plate-film-length.mjs` §(g).1.

2. **Free-tier 33-token (90-second film) balance limit (`PLANS.free.tokens = 33` in `packages/contracts/src/pricing.ts:65`):**
   - **How the 90 s limit is enforced:** Neither `tokens/plan.ts` nor `billing/` has a separate `maxSeconds` check; instead, a Free account receives a one-time grant of `33` tokens (`33,000` millitokens), which is the exact price of a `90 s` film (`6 + 90 × 0.3 = 33.0` tokens).
   - **Concrete numbers:** Consider a plate project with `target_duration_s = 80` (planner `timing.total = 80 s`, costing `30.0` tokens):
     - With **30 scenes** at the 3 s floor (`plateFilmSeconds = 90.0 s`, `33.0` tokens): fits within the `33`-token Free allowance (`quote.enough === true`, `POST /render` returns `202`).
     - With **31 scenes** at the 3 s floor (`plateFilmSeconds = 93.0 s`, `33.9` tokens): previously undercharged at `80 s` (`30.0 <= 33` tokens, accepted), now priced at its real `93 s` length (`33.9 > 33` tokens, so `quote.enough === false` and `POST /render` returns `402 insufficient_tokens`). This is a direct consequence of charging the real rendered film length. Tested on both sides (`90 s` vs `93 s`) in `backend/test/plate-film-length.mjs` §(g).2.

3. **"The film runs Ns; you chose Ms as a target" warning (`backend/src/plan/readiness.ts:71-75`):**
   - **Preserved behind the old number (`timing.total`):** Per Architecture Rule 5, `offTarget` still compares `timing.total` against `plan.target_duration_s` (`Math.abs(timing.total - target) > Math.max(target * TIMING_RULES.tolerance, 3) + 0.05`).
   - **What it does for plate films:** Because `timing.total` is the planner clock (which flexes silent/short beats toward `target_duration_s`), a 6-beat unvoiced plate film with `target_duration_s = 12` has `timing.total = 12 s` and `plateFilmSeconds = 18 s`, so `offTarget` is `false` and no warning is emitted even though the plate film runs `18 s`. It only warns on a plate film when the voiceover lines themselves force `timing.total` outside the target tolerance.

---

## 5. Additional Requirement 2 — Rounding Verification

- **Quote rounding (`backend/src/render/quote.ts:28-30`):**
  ```ts
  const seconds = readiness.durationSeconds === null ? null : Math.max(1, Math.ceil(readiness.durationSeconds));
  const tokens = seconds === null ? null : tokensFromMilli(renderCostMillitokens(seconds));
  ```
- **Render spend rounding (`backend/src/server.ts:289` → `packages/contracts/src/pricing.ts:131`):**
  `server.ts` passes `readiness.durationSeconds` (unrounded) to `renderCostMillitokens(seconds)`:
  ```ts
  export const renderCostMillitokens = (seconds: number) => START_FEE_MILLITOKENS + Math.max(1, Math.ceil(seconds)) * MILLITOKENS_PER_SECOND;
  ```
- **Do the quote and the charge always round the same way?**
  **Yes, identically for every positive number.** `quoteFrom` computes `qSeconds = Math.max(1, Math.ceil(durationSeconds))` and passes `qSeconds` (already an integer `>= 1`) into `renderCostMillitokens(qSeconds)`. `server.ts` passes `durationSeconds` directly into `renderCostMillitokens(durationSeconds)`, which applies the exact same `Math.max(1, Math.ceil(seconds))`. Since `Math.ceil(Math.ceil(x)) === Math.ceil(x)`, the quote and the charge can **never** differ.
- **Tested cases in `backend/test/plate-film-length.mjs` §(h):**
  - `540 / 30 = 18.00 s` → `quote.seconds = 18`, `quote.tokens = 11.4`, `renderCostMillitokens = 11,400`.
  - `541 / 30 = 18.0333... s` and `18.03 s` → `quote.seconds = 19`, `quote.tokens = 11.7`, `renderCostMillitokens = 11,700`.
  - Fractional voice-take case (`105 + 5 × 90 = 555` frames, `plateFilmSeconds = 555 / 30 = 18.5 s`) → `quote.seconds = 19`, `quote.tokens = 11.7`, `POST /render` spends `11,700` millitokens, and `quote.seconds === Math.ceil(built.manifest.totalFrames / FPS)`.
- **Note on `buildExport().durationSeconds` (`backend/src/plates/exports.ts:322`):**
  `buildExport` sets `manifest.totalFrames = timeline.totalFrames` (exact frames encoded into the MP4 by the worker), and returns `durationSeconds: Math.round((timeline.totalFrames / FPS) * 10) / 10` (rounded to 1 decimal place for `app.plate_exports.duration_seconds` and `renderInput.durationSeconds`). For `541` frames (`18.0333... s`), `manifest.totalFrames / FPS` and the MP4 duration are `18.0333... s` (`ceil = 19 s`), matching `plateFilmSeconds` (`541 / 30`) and `quote.seconds` (`19 s`), whereas `built.durationSeconds` rounds to `18.0`. Because `plateFilmSeconds` divides `totalFrames / FPS` without `Math.round(... * 10) / 10`, `quote.seconds == ceil(mp4 duration)` holds for every frame count.

---

## 6. Additional Requirement 3 — `brief.scriptBeats` vs `beatPlan.beats`

- **Which list is rendered by `desiredVariants` and `buildExport`?**
  - `sceneFrames(project)` (`backend/src/plates/inputs.ts:16-21`) iterates `project.brief?.scriptBeats ?? []`.
  - `desiredVariants(project, aspects)` (`backend/src/plates/inputs.ts:24-37`) iterates `project.brief?.scriptBeats ?? []` and uses `sceneFrames(project)`.
  - `buildExport(project, aspect, watermark)` (`backend/src/plates/exports.ts:184-204`) sets `const beats = project.brief?.scriptBeats ?? []`, maps `ordered = beats.map((_, i) => byIndex.get(i))`, maps `takes = beats.map((_, i) => takeFor(project, i))`, and computes `buildTimeline(ordered.map((v) => v!.frames), takes.map((t) => t?.seconds))`.
  - `render/service.ts:92` passes `expectedScenes: (project.brief?.scriptBeats ?? []).length` to `waitForAuthoring`.
- **Agreement with `plateFilmSeconds`:**
  `plateFilmSeconds` reads `project.brief?.scriptBeats ?? []`, `sceneFrames(project)`, and `takeFor(project, i)` in the exact same way as `desiredVariants` and `buildExport`.
- **Verified in `backend/test/plate-film-length.mjs` §(i):**
  For a project with `6` `brief.scriptBeats` (`18 s` / `540` frames) and `4` `beatPlan.beats` (`target_duration_s = 12`), `desiredVariants` produces `6` scenes, `buildExport` freezes a `6`-scene manifest with `totalFrames = 540` (`18 s`), and `plateFilmSeconds(project)` and `planReadiness(project).durationSeconds` both return `18`.

---

## 7. Surprising Findings & Open Questions

1. **Other places that read `projectTiming` or `scriptSeconds` for film length display:**
   - **`POST /v1/projects/:id/plan/audio` (`backend/src/plan/routes.ts:937-941`):** Returns `durationSeconds: timing?.total ?? (result.project.brief?.durationSeconds ?? 30)` in its immediate POST response. In `frontend/components/beat-storyboard.tsx:293-296`, `makeAudio()` ignores `result.durationSeconds` and immediately calls `await loadComposition()` (`GET /v1/projects/:id/composition`), which now returns `plateFilmSeconds(project)`. However, any direct API caller of `POST /v1/projects/:id/plan/audio` still sees `timing?.total` in that response because Architecture Rule 3 scoped the `routes.ts` edit strictly to the composition route.
   - **`beatPlanRevision` (`backend/src/render/service.ts:27-38`):** Builds `job.revision.scenes` from `project.beatPlan.beats` with per-scene `duration` taken from `projectTiming(project)` (`times[beat.id]!.end - times[beat.id]!.start`). For plate films, the Review screen uses `PlateFinal` (`frontend/components/studio.tsx:1003`) rather than `job.revision.scenes`, so this is not visible in the UI.
   - **`ProjectCard` badge on the Projects list (`frontend/components/studio.tsx:1095`):** Before a project has `project.filmSeconds` set, `ProjectCard` computes `scriptSeconds(project.brief.scriptBeats, project.brief.pace)` (`packages/contracts/src/beat-plan.ts:169`), which uses `paceWpm` rather than `secondsFor` (the 3 s plate floor).
2. **Motion-blur check on plate projects (`backend/src/server.ts:274-277`):**
   - As detailed in §4.2, `server.ts:274` checks `motionBlurProblem(planReadiness(project).durationSeconds)` when `motionBlur: true` is passed, even though plate renders (`kind: "plate-film"`) ignore `motionBlur`.
3. **Target-length warning on plate projects (`backend/src/plan/readiness.ts:71-75`):**
   - Kept on `timing.total` per Architecture Rule 5; if the owner later wants the storyboard to warn when the plate scenes' 3 s floor pushes a plate film past `target_duration_s`, `offTarget` in `readiness.ts` can compare `durationSeconds` instead of `timing.total`.
