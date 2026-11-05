# Task for the coding agent: make the plate engine's point-in-shape test exact-and-fast (pixel-identical output)

You work for a manager (Claude) who reviews everything you produce and re-runs your key checks. Read this whole file first. Do what it says, in the order written. If a rule blocks you, stop that part and say so in the report; never work around a rule.

Worktree: `/Users/osamaehsaan/Code/Market_apps/VideoSaaS-engine` (branch `codex/engine-inside`, based on `23e1963`, what staging runs). Dependencies are installed. Other agents work in `../VideoSaaS-live-scenes` and other worktrees: never write there. Use absolute paths in every command.

## Why (manager measurements, 2026-11-05)
Code-drawn crayon scenes written by the model draw at 3.6 to 6.8 frames per second in the browser (148 to 279 ms per frame at 640x360); the same bundle costs the same on the main thread and in our Worker, and resolution does not change it. A CPU profile puts **83 to 90 % of each frame in the engine's `hatchRuns` (`packages/plate-engine/src/canvas-core/gallery.ts`)**, which calls the engine's `inside(pts, x, y)` (even-odd ray casting over every edge of a smoothed outline of hundreds of points) for every 3 to 5 px grid point of each fill, about 70 fills per frame. Caching whole fills does not help (only 3 to 18 % of calls repeat: the crayon boils and shapes move).

The manager patched the four staging bundles with an **exact** indexed `inside` (bounding-box reject, then only the edges whose height range contains `y`, from a per-outline index built once and kept in a `WeakMap` keyed by the outline array) and measured: 148 -> 28.5 ms, 268 -> 43.9 ms, 186 -> 39.9 ms, 34.6 -> 18.7 ms per frame at 640x360 (similar at 1920x1080), with **byte-identical frame hashes at both sizes**. The measurement script, with the exact patched function, is `/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/27148fa8-5b3f-43cb-8253-cd887b35dfeb/scratchpad/inside-diag.mjs` (read it; the `FAST` string is the reference implementation).

The owner's rules: **quality must not change at all** (identical pixels), and the model's drawing is never restricted. This is a pure engine speed fix.

## Read first
1. `packages/plate-engine/src/canvas-core/gallery.ts` (`inside`, `hatchRuns`, `bounds`, everything that calls `inside`), `core.ts` (`adaptPts` and its `WeakMap` identity cache: the engine already assumes outline arrays are not mutated after use), `balloon.ts` (the hand-written crayon reference, `scribble`).
2. Every other point-in-polygon implementation in `packages/plate-engine/src/` (search for the even-odd pattern `> y !==` / `k = !k` / `inside(`): kits may have their own copies.
3. `packages/plate-engine/lib/engine.mjs` (`bundleScene`, how `engineDigest` is computed), `lib/capture.mjs`, `test/engine.test.mjs`, `test/golden.json`, `test/golden-from-legacy.mjs`, `test/bench.mjs`, `test/fixtures*`, `PROVENANCE.md`, `NOTICE` (vendored Apache-2.0 code: record the change).
4. How scenes are re-bundled: `backend/src/plates/author.ts`, `store.ts`, `digest.ts` (`bundleDigest = sha256(bundleSha | paramsDigest | fontSetDigest | engineDigest)`), where the scene **source** is stored (look for `sourceSha`, source keys in object storage), and `worker/src/plates.mjs` (worker-side drawing for the final render).

## What to build
1. **Exact indexed `inside`** in `gallery.ts` (and the same treatment for every other engine copy of the even-odd test you found, or make them call the shared one):
   - Build once per outline array: bounding box, and edges bucketed by height (index pairs per bucket; skip horizontal edges, which can never toggle). Keep it in a module `WeakMap` keyed by the array object.
   - Query: return `false` outside the bounding box (exactly what the old loop returns there: no edge spans that height, or every crossing is to one side); otherwise test only the edges in the point's bucket with **the identical comparison and arithmetic** as the old loop.
   - **Mutation guard:** store the outline's length and its first, middle and last vertex values with the index; if they differ on lookup, rebuild. Document that in-place edits of other vertices are not detected and that the engine already assumes immutability (`adaptPts`).
   - Keep `adaptPts` behaviour exactly as today (call it first, index the adapted array).
2. **Do not change** `hatchRuns`' sampling, order, steps, random draws or output, nor any style's look. If you see another hot spot, report it with numbers; do not change it in this task.
3. **Proof of identical output** (acceptance):
   - `node packages/plate-engine/test/engine.test.mjs` passes, including the golden hashes, unchanged `golden.json`.
   - A new test `packages/plate-engine/test/inside-identity.mjs`: (a) randomized property test, at least 200,000 random points against at least 300 random outlines (convex, concave, self-touching, spiky, with duplicate and horizontal edges, points exactly on vertices and edges, NaN/Infinity coordinates): new `inside` == old `inside` for every point (keep a copy of the old function in the test); (b) a mutation test (outline changed in place, length or end vertices changed -> correct answer after the change).
   - A new script `tools/phase3/engine-identity.mjs`: for **every style reference scene** in `canvas-core/` that the engine can bundle (all `*.ts` style files that `bundleScene` accepts; list any it cannot), bundle with the old engine (from `git show 23e1963:...`, e.g. a temp copy) and the new one, draw frames 0, 1/4, 1/2, 3/4 and last at 640x360 and 1920x1080 in headless Chrome (`/Applications/Google Chrome.app`, `playwright-core`), and compare `FILM.hash()`: **all must be identical**. Also time median ms per frame old vs new for each. Write the table to the report.
   - Rebuild the four crayon staging fixtures? They are bundles, not source; instead run the manager's `inside-diag.mjs` logic against `frontend/test/fixtures/crayon-staging/` with the new engine's `inside` injected the same way, and report the numbers.
4. **Re-bundle path (investigate and report; build only if it lives in the engine package or `tools/`):** existing scenes embed the old engine in their bundle. Find whether the backend keeps each scene's source so a new bundle can be made **without a model call** (same source, new engine, new `engineDigest`, new `bundleDigest`), what code path would do it (repair? a re-bundle job?), and what it invalidates (clip cache keyed by digest+engine). Write a precise proposal in the report; do not change `backend/` or `worker/` in this task.
5. Update `packages/plate-engine/PROVENANCE.md` with the change (vendored code), and bump the engine `version` in `packages/plate-engine/package.json` only if `engineDigest` depends on it (say which).

## Rules (hard limits)
- Write only under `packages/plate-engine/`, `tools/phase3/`, `docs/phase3/engine-inside-report.md`. Nothing in `backend/`, `worker/`, `frontend/`, other packages. Exception: the `version` field in `packages/plate-engine/package.json` (no dependency changes, no lockfile changes).
- No Docker. No network except localhost servers you start on random free ports (never 3000, 4000, 4100, 8766, 55432, 58787, 59000). No staging/production/cloud/model calls. Do not read `.env*`, `.env.credentials`, `infra/aws/.env*`, `*accessKeys*` or token files.
- No commits, pushes, branch changes or deploys. No new dependencies.

## Deliverable
`docs/phase3/engine-inside-report.md`: what changed (files, lines), the identity proofs (property-test counts, golden test, per-style hash table at both sizes), speed table per style and for the four crayon fixtures, the re-bundle proposal, and anything you could not do. End your final message with exactly: `DONE docs/phase3/engine-inside-report.md`
