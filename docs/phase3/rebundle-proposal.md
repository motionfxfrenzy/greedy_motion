# Re-bundle Proposal: Upgrading Existing Plate Scenes to a New Engine Without Model Calls (Review 6.7)

> **Status:** Design proposal only (Step `(e)` of `TASK-engine-inside-v2.md`). No backend or worker code was modified in this task.

---

## 1. Problem Statement

Every compiled plate bundle (`bundle.html`) is a self-contained IIFE produced by `bundleScene()` (`packages/plate-engine/lib/engine.mjs:125-167`) that embeds the scene's TypeScript source together with the vendored engine runtime (`core.ts`, `film.ts`, `gallery.ts`, `<style>.ts`, `hosts/page.ts`).

Consequently, scenes authored before engine `0.6.5` embed the un-indexed `inside()` implementation inside their stored `bundle.html`. Because the backend persists each scene's authored TypeScript source in object storage at authoring time, we can produce a new `bundle.html` embedding engine `0.6.5` (`insideRing`) directly from the saved source **with zero LLM calls**.

---

## 2. Where Scene Source and Bundles Are Stored Today

1. **Object storage key prefix (`backend/src/plates/store.ts:43`):**
   ```ts
   export const prefixOf = (v: Pick<VariantRow, "project_id" | "aspect" | "scene_index" | "gen">) =>
     `plates/${v.project_id}/${aspectSlug(v.aspect)}/${v.scene_index}/g${v.gen}/`;
   ```
2. **Objects written during authoring (`backend/src/plates/author.ts:113-120`):**
   When `handleAuthor` succeeds in `bundleScene({ look, code, frames: row.frames, aspect: row.aspect })`, it uploads three objects to the `"uploads"` bucket before calling `commitBundle`:
   - **Scene TypeScript source:** `${prefix}source.ts` (`plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/source.ts`, content-type `text/plain`)
   - **Compiled HTML bundle:** `${prefix}bundle.html` (`plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/bundle.html`, content-type `text/html`)
   - **Bundle manifest JSON:** `${prefix}manifest.json` (`plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/manifest.json`, content-type `application/json`), containing `{ schema: 1, kind: "anidoodle", engineVersion, engineDigest, styleDigest, width, height, fps, frames, aspect, sourceSha, bundleSha, imports }` (`packages/plate-engine/lib/engine.mjs:162-165`).
3. **Database pointers (`backend/src/db/migrations/018_plate_pipeline.sql:23-61`, `019_plate_live.sql:25-78`, `backend/src/plates/store.ts:19-41, 295-354`):**
   - `app.plate_variants` stores the active generation/revision state on each `(project_id, scene_index, aspect)` row:
     - `source_key` (`text`): e.g. `plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/source.ts`
     - `bundle_key` (`text`): e.g. `plates/<projectId>/<aspectSlug>/<sceneIndex>/g<gen>/bundle.html`
     - `bundle_manifest` (`jsonb`): the manifest returned by `bundleScene`, including `sourceSha` (`sha256(code + "\0").slice(0, 24)`), `bundleSha` (`sha256(html + "\0").slice(0, 24)`), `engineVersion`, `engineDigest`, and `styleDigest`
     - `bundle_digest` (`text`): 64-hex SHA-256 computed by `bundleDigest()`
     - `gen` (`integer`) and `rev` (`integer`)
   - `app.plate_revisions` (`019_plate_live.sql:65-78`, written in `commitBundle` at `backend/src/plates/store.ts:327-339`) stores per-revision history keyed by `UNIQUE (variant_id, rev)`:
     - `(variant_id, rev, bundle_digest, source_key, bundle_key, params, params_digest, author, created_at)`
4. **Transient draft fallback (`backend/src/db/migrations/018_plate_pipeline.sql:46`, `backend/src/plates/store.ts:698-700`):**
   - `app.plate_variants.draft_source` only holds source text transiently when storage/DB commit failed after an LLM call; committed variants always have `draft_source = null` and `source_key != null`.

---

## 3. What New `engineDigest` and `bundleDigest` Mean and What They Invalidate

### 3.1 Digest Definitions
- **`engineDigest`** (`packages/plate-engine/lib/engine.mjs:33-38`):
  First 24 hex characters of `sha256(packageJson.version, "\0", relPath_0, "\0", bytes_0, "\0", ...)`, walking every file under `packages/plate-engine/src/`. Changing `core.ts`, `film.ts`, the 9 style/kit files, and bumping `packages/plate-engine/package.json` `version` from `0.6.4` to `0.6.5` produces a new `engineDigest` (`4b817fc4988078cebb0e4391`).
- **`bundleSha`** (`packages/plate-engine/lib/engine.mjs:164`, `worker/src/plates.mjs:102-105`):
  First 24 hex characters of `sha256(html + "\0")`. Because the bundled IIFE in `html` now contains `insideRing` and `ringNewFrame`, `bundleSha` changes even though `sourceSha` (`sha256(code + "\0").slice(0, 24)`) is unchanged.
- **`bundleDigest`** (`backend/src/plates/digest.ts:58-69`, `worker/src/plates.mjs:89-100`):
  ```ts
  sha256([resolvedBundleSha, paramsDigest(input.params), resolvedFontSetDigest, resolvedEngineDigest].join("|"))
  ```
  Both `resolvedBundleSha` and `resolvedEngineDigest` change when a scene is re-bundled with engine `0.6.5`, producing a new 64-character `bundleDigest`.

### 3.2 What a New `engineDigest` / `bundleDigest` Invalidates
1. **Content-addressed clip cache (`app.plate_clips`):**
   - Defined in `backend/src/db/migrations/021_plate_clips.sql:4-19` with `PRIMARY KEY (bundle_digest, engine_digest, font_set_digest, size)`.
   - Looked up during final renders and companion exports in `worker/src/plates.mjs:743-779` (`control.op("clip.lookup", ...)` -> `backend/src/jobs/control.ts:316-338`) and during preview clip fallback in `backend/src/plates/routes.ts:178-180, 193-195` (`getCachedClip` in `backend/src/plates/store.ts:670-677`).
   - Object storage keys for cached clips also embed `bundleDigest` and `engineDigest` (`worker/src/plates.mjs:219-225`):
     ```js
     `plates/${projectId}/clips/${String(bDigest).slice(0, 32)}-${String(eDigest).slice(0, 12)}-${String(fsDigest).slice(0, 12)}-${width}x${height}.mp4`
     ```
   - **Impact:** A new `(bundle_digest, engine_digest)` is a cache miss in `app.plate_clips` unless either (a) the worker draws the new bundle on the next export/render, or (b) for an output-identical engine upgrade (`0.6.4 -> 0.6.5`), the re-bundler optionally copies existing `app.plate_clips` rows (`clip_key`, `still_key`, `clip_meta`) to the new `(bundle_digest, engine_digest, font_set_digest, size)` key and keeps `app.plate_variants.clip_key` / `still_key` intact so already-rendered MP4 previews remain immediately playable.
2. **Live browser check reports (`app.plate_check_reports`):**
   - Defined in `backend/src/db/migrations/019_plate_live.sql:80-88` with `PRIMARY KEY (variant_id, gen, bundle_digest, host)`.
   - `submitCheckReport` (`backend/src/plates/store.ts:453-551`) fences incoming check reports against `row.bundle_digest === input.bundleDigest`.
   - **Impact:** An in-flight check report for the old `bundle_digest` is cleanly dropped (`204`, `reason: "digest"`).
3. **Export signature (`backend/src/plates/exports.ts:268-282`):**
   - `buildExport` includes each scene's `${s.bundleDigest}:${s.paramsDigest}` and `audio.engineDigest` in `exportSignature(...)`.
   - **Impact:** Requesting a new companion export (`POST /v1/projects/:id/plates/export`) after re-bundling computes a new `signature` and creates a new `app.plate_exports` row and frozen manifest rather than serving an old export row, while any already-running export continues using its own frozen manifest (`manifest_key`).

---

## 4. Immutability Rule: Never Overwrite a Bundle Referenced by a Frozen Manifest

When a user starts a companion export (`requestExport` in `backend/src/plates/exports.ts:333-360`) or a billed final render (`render-video` with `kind: "plate-film"`), `buildExport` (`backend/src/plates/exports.ts:177-324`) writes an immutable Schema 2 `ExportManifest` under `plates/${project.id}/manifests/${manifestDigest}/manifest.json`. Each scene entry (`FrozenSceneEntry`, lines `30-46`) pins:
```ts
{
  variantId: row.id,
  gen: row.gen,
  rev: row.rev,
  bundleDigest: bDigest,
  bundleKey: bKey,      // e.g. plates/<projectId>/<aspect>/<sceneIndex>/g<gen>/bundle.html
  bundleSha,
  paramsDigest: pDigest,
  params
}
```
When the worker executes `prepareManifestClips` (`worker/src/plates.mjs:672-740`), it downloads `scene.bundleKey` and calls `verifyBundleDigest(rawHtml, scene, manifest)` (`worker/src/plates.mjs:110-151`), which recomputes the SHA-256 of `rawHtml` and verifies both `scene.bundleSha` and `scene.bundleDigest`.

**Why overwriting `${prefix}bundle.html` in place is forbidden:**
If a re-bundle overwrote `plates/<projectId>/<aspect>/<sceneIndex>/g<gen>/bundle.html` in place:
1. `rawHtml` at `scene.bundleKey` would now have the new `bundleSha`, which does not match `scene.bundleSha` or `scene.bundleDigest` in any existing frozen `ExportManifest`.
2. `verifyBundleDigest` in the worker would fail and throw `SceneNeedsFixError` (`code: "scene_needs_fix"`, non-retriable, triggering a job failure/refund and `plate.sendBackForRepair`!).

**The Rule:**
1. Re-bundling **never** writes to `${prefixOf(row)}bundle.html` or `${prefixOf(row)}manifest.json`, and **never** mutates an existing row in `app.plate_revisions`.
2. Instead, re-bundling writes the new bundle and manifest to a **new content-addressed key** under the variant's prefix (which satisfies `plateKeyOk(key, projectId)` in `worker/src/storage.mjs` because it starts with `plates/${projectId}/` and contains no `..`):
   - `newBundleKey = "${prefixOf(row)}bundles/${bundle.manifest.bundleSha}/bundle.html"`
   - `newManifestKey = "${prefixOf(row)}bundles/${bundle.manifest.bundleSha}/manifest.json"`
3. Re-bundling increments `rev` (`newRev = row.rev + 1`, keeping `gen` unchanged because the storyboard signature did not change) and inserts a **new** row into `app.plate_revisions` for `(variant_id, newRev)` pointing to `newBundleKey` and `newBundleDigest`.
4. Because `sweepGarbage` (`backend/src/plates/reconcile.ts:174-190`) explicitly excludes any prefix where `app.plate_revisions.bundle_key` or `source_key` starts with `g.prefix`, keeping the old `app.plate_revisions` rows guarantees that old bundle objects remain protected for frozen manifests.

---

## 5. Safe Cutover: Previews Switch Only After the New Bundle Exists and Is Verified

To prevent live browser previews (`GET /v1/projects/:id/plates/:variantId/bundle`, `backend/src/plates/routes.ts:80-97`) from seeing a missing object or an unverified bundle, re-bundling must follow a strict **stage -> verify -> atomic pointer swap** sequence with no database transaction held open during bundling, storage I/O, or browser verification:

1. **Snapshot candidate variant (read-only query):**
   Select variants in `state IN ('checked', 'drawn', 'bundled')` where `source_key IS NOT NULL` and `bundle_manifest->>'engineDigest' IS DISTINCT FROM $currentEngineDigest`. Record `(id, project_id, scene_index, aspect, gen, rev, state, frames, source_key, bundle_key, bundle_digest, bundle_manifest)`.
2. **Fetch and verify saved source:**
   - Download `code` from `"uploads"` at `row.source_key`.
   - If `row.bundle_manifest?.sourceSha` is present, verify `sha(code).slice(0, 24) === row.bundle_manifest.sourceSha`. (Also look up current `rev` params from `app.plate_revisions` for `(row.id, row.rev)`).
3. **Compile new bundle in memory (no LLM call):**
   - Call `bundleScene({ look, code, frames: row.frames, aspect: row.aspect })` (`packages/plate-engine/lib/engine.mjs:125`).
   - Compute `newBundleDigest = bundleDigest({ manifest: bundle.manifest, params: currentParams })`.
4. **Upload to content-addressed keys and verify storage existence:**
   - Upload `bundle.html` to `newBundleKey` and `JSON.stringify(bundle.manifest)` to `newManifestKey` in `"uploads"`.
   - Verify via `objectSize("uploads", newBundleKey) === Buffer.byteLength(bundle.html, "utf8")`.
5. **Verify the bundle before cutover:**
   - Run `verifyScene(localBundlePath, { frames: row.frames })` (`packages/plate-engine/lib/capture.mjs:98-121`) (or worker check report) to confirm that the new bundle starts cleanly in Chromium, has zero page errors, and passes the 2-page double-draw determinism check on `verifyFrames(row.frames)`.
   - If verification fails, log a warning, do **not** update Postgres, and leave the variant on its working old bundle.
6. **Atomic Postgres pointer switch (single short transaction):**
   - Lock the variant row `SELECT * FROM app.plate_variants WHERE id = $1 FOR UPDATE`.
   - Fence check: verify `row.gen === snapshot.gen && row.rev === snapshot.rev && row.bundle_digest === snapshot.bundle_digest && row.state IN ('checked', 'drawn', 'bundled')`. If the user edited comments (`reviseScene`), changed the storyboard (`reconcileVariants`), or a repair ran while we were bundling, abort the cutover cleanly.
   - Insert new revision `newRev = row.rev + 1` into `app.plate_revisions`:
     `(variant_id, rev, bundle_digest, source_key, bundle_key, params, params_digest, author)` with `author = 'engine-rebundle'`.
   - Update `app.plate_variants`:
     - Set `rev = newRev`, `bundle_key = newBundleKey`, `bundle_manifest = bundle.manifest`, `bundle_digest = newBundleDigest`, `updated_at = now()`.
     - **State preservation:** Because Step 5 already verified the bundle (and `0.6.5` is pixel-identical to `0.6.4`), a `'checked'` live variant stays `'checked'` (`checked_at = now()`, `host = 'worker'`) and a `'drawn'` variant stays `'drawn'` (retaining its `clip_key` / `still_key`), so live previews switch seamlessly on the next poll without flashing a loading state.

---

## 6. Rollback Plan

Because the old `bundle.html` object in `"uploads"` was never overwritten and its metadata remains in `app.plate_revisions` at `rev = oldRev`:

1. **Per-variant or global rollback query:**
   To roll back variants re-bundled by `'engine-rebundle'` to their previous revision (`rev - 1`):
   - Store `previous_bundle_manifest` inside `app.plate_variants.timings` or a new `bundle_manifest jsonb` column on `app.plate_revisions` (or read `${oldBundlePrefix}manifest.json` from `"uploads"`).
   - In a fenced transaction per variant:
     ```sql
     UPDATE app.plate_variants v
        SET rev = prev.rev,
            bundle_key = prev.bundle_key,
            bundle_digest = prev.bundle_digest,
            bundle_manifest = prev.bundle_manifest,
            updated_at = now()
       FROM app.plate_revisions cur
       JOIN app.plate_revisions prev
         ON prev.variant_id = cur.variant_id AND prev.rev = cur.rev - 1
      WHERE v.id = cur.variant_id
        AND v.rev = cur.rev
        AND cur.author = 'engine-rebundle';
     ```
2. **Zero side effects on in-flight jobs:**
   - Any export/render manifest frozen while `newRev` was active continues to find `newBundleKey` in `"uploads"` (and its `app.plate_revisions` row at `newRev` can either be kept or left until no active export references it).
   - Live previews immediately revert to serving `prev.bundle_key` and `prev.bundle_digest`.

---

## 7. Code Path Selection and Files That Would Change

### 7.1 Why NOT `sendBackForRepair` or `plate-author`
- `sendBackForRepair` (`backend/src/plates/store.ts:361-422`, `backend/src/jobs/control.ts:244-312`) transitions a variant to `state = 'queued', stage = 'repairing'`, increments `repairs`, and enqueues `plate-author`.
- `handleAuthor` (`backend/src/plates/author.ts:76-128`) calls `anthropicMessage` (costing LLM tokens and mutating the scene's art!), increments `authored` against `maxAuthorCalls`, and calls `commitBundle` (`store.ts:295-354`), which overwrites `${prefix}bundle.html` in place and resets `state` to `'bundled'`.
- Therefore, re-bundling **must not** use `sendBackForRepair` or `plate-author`.

### 7.2 Recommended Code Path: Dedicated `plate-rebundle` Job / Maintenance Service
Introduce a dedicated, non-LLM re-bundle module (`backend/src/plates/rebundle.ts`) driven either by a low-priority `pg-boss` queue (`QUEUES.plateRebundle = "plate-rebundle"`) or an admin/CLI script (`backend/src/scripts/rebundle-plates.ts`):

| File | Change |
| :--- | :--- |
| `backend/src/db/migrations/022_plate_revision_manifest.sql` *(new)* | `ALTER TABLE app.plate_revisions ADD COLUMN IF NOT EXISTS bundle_manifest jsonb;` so every revision row is self-contained for instant SQL rollback. |
| `backend/src/plates/store.ts` | Populate `bundle_manifest` on `app.plate_revisions` in `commitBundle` (line `327`); add `commitRebundleRevision()` (fenced by `id, gen, rev, bundle_digest`) and `rollbackRebundleRevision()`. |
| `backend/src/plates/rebundle.ts` *(new)* | Implement `rebundleVariant(variantId)` and `rebundleStaleVariants({ limit, dryRun })`: downloads `source_key`, verifies `sourceSha`, runs `bundleScene`, uploads to `${prefix}bundles/${bundleSha}/bundle.html`, verifies via `verifyScene` (or delegates verification to worker), and calls `commitRebundleRevision`. |
| `backend/src/jobs/queues.ts` | Add `plateRebundle: "plate-rebundle"` queue name if run asynchronously via `pg-boss`. |
| `worker/src/plates.mjs` & `worker/src/storage.mjs` | **No changes required.** `plateKeyOk` (`worker/src/storage.mjs`) already allows `plates/<projectId>/<aspect>/<sceneIndex>/g<gen>/bundles/<bundleSha>/bundle.html`, and `verifyBundleDigest` (`worker/src/plates.mjs:110-151`) already validates `bundleSha` and `bundleDigest` from the manifest. |

---

## 8. Test Plan

1. **Unit & Bundler Determinism Test:**
   - Given a saved `source.ts` and `params`, `bundleScene({ look, code, frames, aspect })` produces a bundle with the new `engineDigest` (`0.6.5`), identical `sourceSha`, new `bundleSha`, and new `bundleDigest`.
2. **Immutability & Frozen Manifest Regression Test:**
   - Freeze an `ExportManifest` (Schema 2) via `buildExport()` before re-bundling (pointing to `g1/bundle.html` and old `bundleDigest`).
   - Run `rebundleVariant()` on the project's variants.
   - Assert that `g1/bundle.html` in `"uploads"` is byte-for-byte unchanged, `verifyBundleDigest` on the frozen manifest still returns `{ ok: true }`, and `prepareManifestClips` / `renderPlateFilmJob` succeeds on the pre-rebundle frozen manifest.
3. **Preview Atomic Cutover Test:**
   - Before `commitRebundleRevision` commits (simulated storage failure or verification failure), `GET /v1/projects/:id/plates/:variantId/bundle` still returns the old `bundle_key` and `bundle_digest`.
   - After `commitRebundleRevision` commits, `GET /v1/projects/:id/plates/:variantId/bundle` returns the new content-addressed `bundle_key` (`.../bundles/<bundleSha>/bundle.html`), new `bundleDigest`, and `rev = oldRev + 1`, with zero `anthropicMessage` calls (`authored` count unchanged).
4. **Concurrent Edit / Fence Test:**
   - Simulate `reviseScene` (or `reconcileVariants` bumping `gen`) while `rebundleVariant` is mid-flight; assert `commitRebundleRevision` affects `0` rows and returns `false` without clobbering the user's new revision.
5. **Garbage Collector Safety Test (`sweepGarbage`):**
   - Insert `g1/` into `app.plate_garbage` with `next_sweep_at <= now()` while `app.plate_revisions` holds both `rev = 0` (`g1/bundle.html`) and `rev = 1` (`g1/bundles/<sha>/bundle.html`). Assert `sweepGarbage()` skips `g1/`.
6. **Rollback Test:**
   - Run `rollbackRebundleRevision(variantId)` after re-bundling; assert `app.plate_variants` returns to `rev = 0`, `bundle_key = g1/bundle.html`, and `bundle_digest = oldDigest`.

---

## 9. What Is Unknown / Open Decisions

1. **Pre-`018` legacy projects:** Migration `018_plate_pipeline.sql` (line `20`) preserved pre-pipeline scenes in `app.plate_state.legacy_scenes` without rows in `app.plate_variants`. Any such legacy project has no `source_key` in `app.plate_variants` and cannot be re-bundled without authoring; we do not know without querying production Postgres whether any active projects still rely on `legacy_scenes`.
2. **Where `verifyScene` runs during re-bundling:** `verifyScene` (`packages/plate-engine/lib/capture.mjs`) launches headless Chromium, which is installed in the worker image (`worker/src/plates.mjs`), whereas the backend process normally only runs `esbuild` (`bundleScene`) and leaves browser checks to the worker (`submitCheckReport` / `handlePlateRender`). If the backend container in staging/production does not ship Chromium, Step 5 verification must either run as a worker control/job step (`plate-rebundle` consumed by the worker) or rely on `bundleScene` + pixel-identity proof when upgrading `0.6.4 -> 0.6.5`.
3. **Clip cache (`app.plate_clips`) aliasing policy:** Because `0.6.5` is proven pixel-identical to `0.6.4`, we could either alias existing `app.plate_clips` rows to the new `(bundle_digest, engine_digest)` to avoid redrawing already-cached MP4 clips on export, or let the worker draw misses lazily at the new 3–5× faster speed. Which policy is preferred is a product/ops decision.

---

## 10. Existing in-place overwrite in today's repair paths (added by the manager; verified in code)

Today's repair paths already break the immutability rule this proposal depends on, so the re-bundle work must fix them first or alongside:

- `backend/src/jobs/control.ts:299` (`update app.plate_variants set ... rev = rev + 1 ... where id = $1 and gen = $2`) and `backend/src/plates/store.ts:390` (`repairs = repairs + 1 ... where id = $1 and gen = $2`) re-queue a scene for authoring **at the same `gen`**.
- The re-author then writes `bundle.html`, `source.ts` and `manifest.json` to `prefixOf(row)` (`backend/src/plates/author.ts:113-120`), i.e. the same `plates/<project>/<aspect>/<scene>/g<gen>/` keys, **overwriting the objects that earlier `app.plate_revisions` rows and any frozen `ExportManifest.bundleKey` already point at**. A frozen render for that revision would then fail `verifyBundleDigest` (`worker/src/plates.mjs:110-151`) with `scene_needs_fix`.
- Required: make `commitBundle` write under a content-addressed key (`<prefix>bundles/<bundleSha>/...`) for every authoring result, including repairs (or bump `gen` on repair), and never `put` over an existing key whose revision row exists. Test: author, freeze a manifest, repair, then verify the frozen manifest's bundle still verifies and the clip still renders.
- Scope note: this proposal does not implement that change; it is a prerequisite for any re-bundle job and should be part of the backend brief.
