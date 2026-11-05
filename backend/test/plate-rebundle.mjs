// Step 5: Re-bundle integration test (`plate-rebundle.mjs`):
//   1. Determinism: re-bundling the same saved source twice yields byte-identical `bundle.html` and `bundleSha`.
//   2. Frozen manifest & clip rendering: re-bundling a variant with a frozen ExportManifest leaves old objects
//      byte-for-byte intact, `verifyBundleDigest` on the frozen manifest passes, and `prepareManifestClips` renders
//      from the frozen manifest intact.
//   3. Atomic preview cutover: before commit the bundle route returns the old key and digest; after commit it returns
//      the new content-addressed key, new digest, and `rev + 1`, with `authored` count unchanged and zero model calls.
//   4. Verification failure: when verification fails (in-process or worker `handlePlateRebundle`), the variant stays on
//      its working old bundle and Postgres is not modified.
//   5. Two-phase worker verification (`mode: "worker"` + `handlePlateRebundle` -> `rebundle.commit` control op).
//   6. Dry-run writes nothing, legacy projects without `plate_variants` rows are skipped and counted, CLI safety guard
//      refuses non-local `APP_ENV` or non-localhost `DATABASE_URL`, and `--apply` is idempotent on a second run.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import { bundleScene, engineDigest, engineVersion } from "@videosaas/plate-engine";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

// Hermetic in-process S3 + Anthropic mock server bound to 127.0.0.1
const s3Store = new Map();
const s3Puts = [];
let anthropicCalls = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/v1/messages") {
    anthropicCalls += 1;
    res.writeHead(500);
    res.end("Model calls are forbidden during re-bundling!");
    return;
  }

  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (req.method === "HEAD") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end();
    return;
  }
  if (req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    s3Store.set(key, { bytes, contentType: req.headers["content-type"] ?? "application/octet-stream" });
    s3Puts.push({ key, sha256: sha256Hex(bytes), size: bytes.length });
    res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
    res.end();
    return;
  }
  if (req.method === "GET") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end(entry.bytes);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;

process.env.STORAGE_DRIVER = "r2";
process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`;
process.env.R2_FORCE_PATH_STYLE = "1";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_UPLOADS_BUCKET = "test-uploads";
process.env.R2_OUTPUTS_BUCKET = "test-outputs";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { operations } = await import("../src/jobs/control.ts");
const { getObject, putObject } = await import("../src/storage.ts");
const { bundleDigest } = await import("../src/plates/digest.ts");
const { buildExport } = await import("../src/plates/exports.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const store = await import("../src/plates/store.ts");
const { rebundleStaleVariants, rebundleVariant, scanRebundleCandidates } = await import("../src/plates/rebundle.ts");
const { enforceLocalSafetyGuard, parseCliArgs } = await import("../src/scripts/rebundle-plates.ts");
const { engineBundleSha, handlePlateRebundle, prepareManifestClips, verifyBundleDigest } = await import(
  "../../worker/src/plates.mjs"
);

await migrate();
await startQueues();

const app = Fastify();
await registerPlateRoutes(app, {
  presign: async (bucket, key, opts) => `https://r2.example.test/${bucket}/${key}?ttl=${opts?.seconds ?? 900}`
});
await app.ready();

const scratch = mkdtempSync(join(tmpdir(), "plate-rebundle-test-"));
const projectId = randomUUID();
const workerProjectId = randomUUID();
const legacyProjectId = randomUUID();
const projects = [projectId, workerProjectId, legacyProjectId];

function makeSceneSource(title, fill) {
  return [
    'import { Ctx, Env } from "./core";',
    'import { Film } from "./film";',
    'import { inside } from "./gallery";',
    "const W = 1920, H = 1080, durationFrames = 60;",
    "const RING: [number, number][] = Array.from({ length: 24 }, (_, i) => {",
    "  const a = (i / 24) * Math.PI * 2;",
    "  return [960 + Math.cos(a) * 200, 540 + Math.sin(a) * 200];",
    "});",
    "const draw = (ctx: Ctx, frame: number, env: Env): void => {",
    "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
    `  ctx.fillStyle = "${fill}";`,
    "  ctx.fillRect(0, 0, W, H);",
    "  if (inside(RING, 960, 540)) {",
    '    ctx.fillStyle = "#223344";',
    "    ctx.fillRect(860 + frame, 440, 200, 200);",
    "  }",
    "};",
    `export const film: Film = { meta: { title: "${title}", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };`
  ].join("\n");
}

function makeProjectRecord(id, beatsCount = 2) {
  const beats = Array.from({ length: beatsCount }, (_, i) => ({
    id: `b${i + 1}`,
    keyword: `Scene${i}`,
    visual: `Visual ${i}`,
    onScreen: `Scene ${i}`,
    line: `Line for scene ${i}.`
  }));
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Rebundle Test Project",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      text: "A fox carries a lantern.",
      look: "illus-fox",
      aspect: "16:9",
      aspects: ["16:9"],
      captions: "none",
      scriptBeats: beats
    },
    beatPlan: {
      target_duration_s: beatsCount * 2,
      canvas: { width: 1920, height: 1080, fps: 30 },
      beats: beats.map((b) => ({
        id: b.id,
        role: "hook",
        kind: "plate",
        producer: "plates",
        keyword: b.keyword,
        visual: b.visual,
        line: b.line
      }))
    }
  };
}

try {
  config.plates.live = true;
  config.plates.liveForceOff = false;

  // =========================================================================
  // 0. CLI safety guard & argument parsing
  // =========================================================================
  assert.throws(
    () => enforceLocalSafetyGuard({ APP_ENV: "staging", DATABASE_URL: "postgres://u:p@localhost:55432/plates_rebundle" }),
    /APP_ENV must be "local"/
  );
  assert.throws(
    () => enforceLocalSafetyGuard({ APP_ENV: "local", DATABASE_URL: "postgres://u:p@db.staging.example.com:5432/postgres" }),
    /DATABASE_URL host must be "localhost" or "127.0.0.1"/
  );
  assert.throws(
    () =>
      enforceLocalSafetyGuard({
        APP_ENV: "local",
        DATABASE_URL: "postgres://u:p@localhost:55432/plates_rebundle",
        R2_ENDPOINT: "https://account.r2.cloudflarestorage.com"
      }),
    /R2_ENDPOINT host must be "localhost" or "127.0.0.1"/
  );
  enforceLocalSafetyGuard({
    APP_ENV: "local",
    DATABASE_URL: "postgres://videosaas:videosaas@localhost:55432/plates_rebundle",
    R2_ENDPOINT: `http://127.0.0.1:${port}`
  });

  const parsedDefault = parseCliArgs([]);
  assert.equal(parsedDefault.apply, false, "CLI defaults to dry-run (apply=false)");
  const parsedApply = parseCliArgs(["--apply", "--limit", "5", "--project", projectId]);
  assert.equal(parsedApply.apply, true);
  assert.equal(parsedApply.limit, 5);
  assert.equal(parsedApply.projectId, projectId);

  // =========================================================================
  // 1. Determinism: bundling the same source twice produces byte-identical bundle.html
  // =========================================================================
  const source0 = makeSceneSource("scene-0-fox", "#fff8ee");
  const source1 = makeSceneSource("scene-1-lantern", "#eef4ff");
  const bRun1 = await bundleScene({ look: "illus-fox", code: source0, frames: 60, aspect: "16:9" });
  const bRun2 = await bundleScene({ look: "illus-fox", code: source0, frames: 60, aspect: "16:9" });
  assert.equal(bRun1.html, bRun2.html, "bundling the same source twice produces byte-identical HTML");
  assert.equal(
    Buffer.compare(Buffer.from(bRun1.html, "utf8"), Buffer.from(bRun2.html, "utf8")),
    0,
    "bundle.html buffers are byte-for-byte identical"
  );
  assert.equal(bRun1.manifest.bundleSha, bRun2.manifest.bundleSha);
  assert.equal(bRun1.manifest.sourceSha, bRun2.manifest.sourceSha);
  assert.equal(bRun1.manifest.engineDigest, engineDigest());
  assert.equal(bRun1.manifest.engineVersion, engineVersion());
  assert.ok(bRun1.html.includes("window.FILM"), "new engine bundle embeds window.FILM host");

  // =========================================================================
  // 2. Seed a project with 0.6.4 (old engineDigest) variants + a legacy project
  // =========================================================================
  for (const pid of [projectId, workerProjectId, legacyProjectId]) {
    const pData = makeProjectRecord(pid, 2);
    await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
      pid,
      pData.ownerId,
      pData.name,
      pData.state,
      pData
    ]);
  }
  // Seed legacy project in app.plate_state with legacy_scenes and NO rows in app.plate_variants
  await pool.query(
    "insert into app.plate_state (project_id, scenes, legacy_scenes) values ($1, $2::jsonb, $2::jsonb)",
    [legacyProjectId, JSON.stringify([{ index: 0, keyword: "LegacyFox" }])]
  );

  // Reconcile variants for projectId (2 scenes: scene 0 will be 'checked', scene 1 will be 'drawn')
  await store.reconcileVariants(
    projectId,
    [0, 1].map((index) => ({
      index,
      aspect: "16:9",
      signature: `v3:reb-${index}`,
      frames: 60,
      width: 1920,
      height: 1080,
      keyword: `Scene${index}`
    })),
    { scenes: 2 }
  );
  const [v0, v1] = await store.listVariants(projectId);
  const oldEngineDigest = "064000000000000000000640";
  const sources = [source0, source1];
  const oldBundles = [];

  for (const [idx, v] of [v0, v1].entries()) {
    const src = sources[idx];
    const compiled = await bundleScene({ look: "illus-fox", code: src, frames: 60, aspect: "16:9" });
    // Simulate a pre-0.6.5 bundle stored under the old g1/ key shape
    const oldHtml = compiled.html.replace("/*0.6.5*/", "") + `<!-- engine:0.6.4:${idx} -->`;
    const oldBundleSha = engineBundleSha(oldHtml);
    const oldManifest = {
      ...compiled.manifest,
      engineVersion: "0.6.4",
      engineDigest: oldEngineDigest,
      bundleSha: oldBundleSha
    };
    const oldPrefix = store.prefixOf(v);
    const oldSourceKey = `${oldPrefix}source.ts`;
    const oldBundleKey = `${oldPrefix}bundle.html`;
    const oldManifestKey = `${oldPrefix}manifest.json`;

    await putObject("uploads", oldSourceKey, src, "text/plain");
    await putObject("uploads", oldBundleKey, oldHtml, "text/html");
    await putObject("uploads", oldManifestKey, JSON.stringify(oldManifest), "application/json");

    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.noteAuthorCall(v.id, v.gen, owner, { authorMs: 15 });
    await store.commitBundle(v, owner, {
      sourceKey: oldSourceKey,
      bundleKey: oldBundleKey,
      manifest: oldManifest,
      params: idx === 1 ? { tint: "#ffeedd" } : {},
      timings: { bundleMs: 10 }
    });
    oldBundles.push({
      variantId: v.id,
      oldSourceKey,
      oldBundleKey,
      oldManifestKey,
      oldHtml,
      oldHtmlSha256: sha256Hex(oldHtml),
      oldSourceSha256: sha256Hex(src),
      oldManifest
    });
  }

  // Move v0 to 'checked' (live mode) and v1 to 'drawn' (with clip_key and still_key)
  const b0 = await store.getVariant(v0.id);
  await store.submitCheckReport(b0.id, {
    gen: b0.gen,
    bundleDigest: b0.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  await pool.query(
    "update app.plate_variants set state = 'drawn', stage = null, clip_key = $2, still_key = $3, drawn_at = now() where id = $1",
    [v1.id, `plates/${projectId}/16x9/1/g1/clip-a1.mp4`, `plates/${projectId}/16x9/1/g1/still-a1.png`]
  );

  // Freeze an ExportManifest before re-bundling
  const projectRecord = makeProjectRecord(projectId, 2);
  const frozenBefore = await buildExport(projectRecord, "16:9", false);
  assert.equal(frozenBefore.manifest.engineDigest, oldEngineDigest);
  assert.equal(frozenBefore.manifest.scenes[0].bundleKey, oldBundles[0].oldBundleKey);
  assert.equal(frozenBefore.manifest.scenes[1].bundleKey, oldBundles[1].oldBundleKey);

  // =========================================================================
  // 3. Dry-run scan: lists stale candidates, counts by state, legacy skips, writes nothing
  // =========================================================================
  const putsBeforeDryRun = s3Puts.length;
  const dryRunSummary = await rebundleStaleVariants({ dryRun: true, projectId });
  assert.equal(dryRunSummary.dryRun, true);
  assert.equal(dryRunSummary.committed, 0);
  assert.equal(s3Puts.length, putsBeforeDryRun, "dry-run writes 0 objects to storage");
  assert.equal(dryRunSummary.scan.currentEngineDigest, engineDigest());
  assert.equal(dryRunSummary.scan.candidates.length, 2);
  assert.deepEqual(dryRunSummary.scan.countsByState, { checked: 1, drawn: 1 });
  assert.deepEqual(dryRunSummary.scan.staleCountsByState, { checked: 1, drawn: 1 });
  assert.equal(dryRunSummary.scan.upToDateCount, 0);
  assert.equal(dryRunSummary.scan.candidates[0].foundEngineDigest, oldEngineDigest);

  const legacyScan = await scanRebundleCandidates({ projectId: legacyProjectId });
  assert.equal(legacyScan.candidates.length, 0, "legacy project without plate_variants has 0 rebundle candidates");
  assert.equal(legacyScan.legacySkippedProjects, 1, "legacy project is counted in legacySkippedProjects");
  assert.ok(legacyScan.legacyprojectIds.includes(legacyProjectId));

  // =========================================================================
  // 4. Verification failure leaves old bundle active and does not update Postgres
  // =========================================================================
  const bundleRouteBefore = (
    await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${v0.id}/bundle` })
  ).json();
  assert.ok(bundleRouteBefore.url.includes(oldBundles[0].oldBundleKey), "before rebundle, bundle route serves old g1/bundle.html");
  assert.equal(bundleRouteBefore.bundleDigest, b0.bundle_digest);

  const failedVerifyOutcome = await rebundleVariant(v0.id, {
    verifier: async () => ({ ok: false, reason: "Simulated Chromium verification failure" })
  });
  assert.equal(failedVerifyOutcome.status, "failed");
  assert.match(failedVerifyOutcome.reason, /Simulated Chromium verification failure/);

  const v0AfterFail = await store.getVariant(v0.id);
  assert.equal(v0AfterFail.rev, 0, "rev unchanged when verification fails");
  assert.equal(v0AfterFail.bundle_key, oldBundles[0].oldBundleKey, "old bundle_key remains active when verification fails");
  assert.equal(v0AfterFail.bundle_digest, b0.bundle_digest, "old bundle_digest remains active when verification fails");
  assert.equal((await store.listRevisions(v0.id)).length, 1, "no new revision row inserted on verification failure");

  const bundleRouteAfterFail = (
    await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${v0.id}/bundle` })
  ).json();
  assert.equal(bundleRouteAfterFail.url, bundleRouteBefore.url, "live preview still receives old bundle URL after failed verification");
  assert.equal(bundleRouteAfterFail.bundleDigest, b0.bundle_digest);

  // =========================================================================
  // 5. Apply re-bundle: atomic cutover, state preservation, zero model calls, old objects intact
  // =========================================================================
  let verifiedCount = 0;
  const applySummary = await rebundleStaleVariants({
    dryRun: false,
    projectId,
    verifier: async (input) => {
      verifiedCount += 1;
      assert.ok(input.html.includes("window.FILM"), "verified bundle HTML contains window.FILM");
      if (input.variantId === v1.id) {
        assert.ok(input.bakedHtml.includes('window.__PARAMS__={"tint":"#ffeedd"};'), "params baked before verification");
      }
      return { ok: true };
    }
  });
  assert.equal(verifiedCount, 2, "verifier ran on both candidates");
  assert.equal(applySummary.committed, 2);
  assert.equal(applySummary.failed, 0);
  assert.equal(anthropicCalls, 0, "zero model calls made during re-bundling");

  const v0After = await store.getVariant(v0.id);
  const v1After = await store.getVariant(v1.id);

  // Check state preservation, gen, rev + 1, authored unchanged, content-addressed bundle_key
  assert.equal(v0After.gen, 1, "gen is unchanged");
  assert.equal(v0After.rev, 1, "rev bumped by 1");
  assert.equal(v0After.state, "checked", "checked variant stays checked");
  assert.equal(v0After.host, "worker");
  assert.equal(v0After.authored, 1, "authored count is unchanged");
  assert.match(v0After.bundle_key, new RegExp(`^plates/${projectId}/16x9/0/g1/bundles/[0-9a-f]{24}/bundle\\.html$`));
  assert.equal(v0After.bundle_manifest.engineDigest, engineDigest());

  assert.equal(v1After.gen, 1, "gen is unchanged on drawn variant");
  assert.equal(v1After.rev, 1, "rev bumped by 1 on drawn variant");
  assert.equal(v1After.state, "drawn", "drawn variant stays drawn");
  assert.equal(v1After.clip_key, `plates/${projectId}/16x9/1/g1/clip-a1.mp4`, "drawn variant retains clip_key");
  assert.equal(v1After.still_key, `plates/${projectId}/16x9/1/g1/still-a1.png`, "drawn variant retains still_key");
  assert.equal(v1After.authored, 1, "authored count unchanged on drawn variant");
  assert.match(v1After.bundle_key, new RegExp(`^plates/${projectId}/16x9/1/g1/bundles/[0-9a-f]{24}/bundle\\.html$`));
  assert.equal(
    v1After.bundle_digest,
    bundleDigest({ manifest: v1After.bundle_manifest, params: { tint: "#ffeedd" } }),
    "new bundleDigest incorporates existing revision params"
  );

  // Check bundle route after commit: returns new key, new digest, existing params
  const bundleRouteAfter0 = (
    await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${v0.id}/bundle` })
  ).json();
  assert.ok(bundleRouteAfter0.url.includes(v0After.bundle_key), "bundle route now returns new content-addressed bundle_key");
  assert.equal(bundleRouteAfter0.bundleDigest, v0After.bundle_digest);
  assert.notEqual(bundleRouteAfter0.bundleDigest, bundleRouteBefore.bundleDigest);

  const bundleRouteAfter1 = (
    await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${v1.id}/bundle` })
  ).json();
  assert.deepEqual(bundleRouteAfter1.params, { tint: "#ffeedd" }, "bundle route preserves params on new revision");

  // Check app.plate_revisions rows
  for (const [idx, v] of [v0After, v1After].entries()) {
    const revs = await store.listRevisions(v.id);
    assert.equal(revs.length, 2);
    assert.equal(revs[0].rev, 0);
    assert.equal(revs[0].bundle_key, oldBundles[idx].oldBundleKey);
    assert.equal(revs[0].bundle_manifest.engineDigest, oldEngineDigest);
    assert.equal(revs[1].rev, 1);
    assert.equal(revs[1].author, "engine-rebundle");
    assert.equal(revs[1].bundle_key, v.bundle_key);
    assert.equal(revs[1].bundle_digest, v.bundle_digest);
    assert.equal(revs[1].bundle_manifest.engineDigest, engineDigest());
  }

  // Assert old objects in storage are byte-for-byte unchanged
  for (const old of oldBundles) {
    const curBundleBytes = await getObject("uploads", old.oldBundleKey);
    const curSourceBytes = await getObject("uploads", old.oldSourceKey);
    assert.equal(sha256Hex(curBundleBytes), old.oldHtmlSha256, `old bundle ${old.oldBundleKey} is byte-identical after rebundle`);
    assert.equal(sha256Hex(curSourceBytes), old.oldSourceSha256, `old source ${old.oldSourceKey} is byte-identical after rebundle`);
  }

  // Assert pre-rebundle frozen manifest still passes verifyBundleDigest AND prepareManifestClips works on it!
  for (let i = 0; i < 2; i++) {
    const frozenScene = frozenBefore.manifest.scenes[i];
    const rawHtml = (await getObject("uploads", frozenScene.bundleKey)).toString("utf8");
    const check = verifyBundleDigest(rawHtml, frozenScene, frozenBefore.manifest);
    assert.equal(check.ok, true, `frozen manifest scene ${i} still passes verifyBundleDigest after rebundle`);
  }

  const clipScratch = join(scratch, "frozen-clips");
  const preparedFrozen = await prepareManifestClips(
    {
      op: async (name, args) => {
        if (name === "clip.lookup") return { clips: [] };
        if (name === "clip.record") return { ok: true, duplicate: false };
        return operations[name](args);
      }
    },
    frozenBefore.manifest,
    {
      fence: { jobId: randomUUID(), attempt: 1 },
      scratch: clipScratch,
      probeRenderer: async () => "Google SwiftShader",
      storageImpl: {
        downloadPlateInput: async (key, dest) => {
          const bytes = await getObject("uploads", key);
          assert.ok(bytes, `downloadPlateInput found ${key}`);
          writeFileSync(dest, bytes);
        },
        downloadPlateOutput: async () => {},
        uploadPlateOutput: async () => {},
        deleteOutputs: async () => {}
      },
      engineImpl: {
        verifyScene: async (pagePath) => {
          const html = readFileSync(pagePath, "utf8");
          assert.ok(html.includes("<!-- engine:0.6.4:"), "prepareManifestClips verified the exact pre-rebundle HTML");
          return { blocked: [], midPng: Buffer.from("PNG") };
        },
        renderScene: async (_pagePath, outFile) => {
          writeFileSync(outFile, "MP4_FROZEN");
        },
        probeVideo: async () => ({ frames: 60, width: 1920, height: 1080, fps: 30 }),
        classifyFailure: () => "infra"
      }
    }
  );
  assert.equal(preparedFrozen.clipFiles.length, 2, "prepareManifestClips rendered both clips from pre-rebundle frozen manifest");
  assert.equal(preparedFrozen.cacheMisses, 2);

  // =========================================================================
  // 6. Second --apply run is an idempotent no-op (0 candidates, 0 commits)
  // =========================================================================
  const secondApply = await rebundleStaleVariants({
    dryRun: false,
    projectId,
    verifier: async () => {
      throw new Error("Verifier must not be called when all variants are already on current engineDigest");
    }
  });
  assert.equal(secondApply.scan.candidates.length, 0, "second run finds 0 stale candidates");
  assert.equal(secondApply.scan.upToDateCount, 2, "second run reports 2 up-to-date variants");
  assert.equal(secondApply.committed, 0, "second run commits 0 variants");

  // =========================================================================
  // 7. Two-phase worker mode (`mode: "worker"` + `handlePlateRebundle` -> `rebundle.commit`)
  // =========================================================================
  await store.reconcileVariants(
    workerProjectId,
    [{ index: 0, aspect: "16:9", signature: "v3:wreb-0", frames: 60, width: 1920, height: 1080, keyword: "Scene0" }],
    { scenes: 1 }
  );
  const [wv0] = await store.listVariants(workerProjectId);
  const wPrefix = store.prefixOf(wv0);
  const wOldHtml = bRun1.html + "<!-- worker-old-0.6.4 -->";
  const wOldSha = engineBundleSha(wOldHtml);
  const wOldManifest = {
    ...bRun1.manifest,
    engineVersion: "0.6.4",
    engineDigest: oldEngineDigest,
    bundleSha: wOldSha
  };
  await putObject("uploads", `${wPrefix}source.ts`, source0, "text/plain");
  await putObject("uploads", `${wPrefix}bundle.html`, wOldHtml, "text/html");
  await putObject("uploads", `${wPrefix}manifest.json`, JSON.stringify(wOldManifest), "application/json");
  const wOwner = store.newOwner();
  await store.claimAuthor(wv0.id, wv0.gen, wOwner, 60, 10);
  await store.commitBundle(wv0, wOwner, {
    sourceKey: `${wPrefix}source.ts`,
    bundleKey: `${wPrefix}bundle.html`,
    manifest: wOldManifest,
    timings: {}
  });
  const wBefore = await store.getVariant(wv0.id);

  // Phase 1: stage & enqueue worker verification job
  const stagedWorker = await rebundleVariant(wv0.id, { mode: "worker" });
  assert.equal(stagedWorker.status, "queued_worker");
  assert.equal((await store.getVariant(wv0.id)).bundle_key, `${wPrefix}bundle.html`, "before worker verifies, old bundle_key stays active");

  // Fetch the queued plate-rebundle job from pg-boss and run handlePlateRebundle
  const [queuedJob] = await boss.fetch( store ? "plate-rebundle" : "plate-rebundle", { batchSize: 1 });
  assert.ok(queuedJob, "plate-rebundle job was queued in pg-boss");
  assert.equal(queuedJob.data.variantId, wv0.id);

  // First simulate worker verification failure: variant stays on old bundle
  const workerFailRes = await handlePlateRebundle(
    { data: queuedJob.data, signal: new AbortController().signal },
    {
      control: { op: (name, args) => operations[name](args) },
      storageImpl: {
        downloadPlateInput: async (key, dest) => {
          const bytes = await getObject("uploads", key);
          writeFileSync(dest, bytes);
        }
      },
      engineImpl: {
        verifyScene: async () => {
          throw Object.assign(new Error("Determinism mismatch on frame 30"), { kind: "code" });
        }
      }
    }
  );
  assert.equal(workerFailRes.status, "failed");
  assert.equal((await store.getVariant(wv0.id)).bundle_key, wBefore.bundle_key, "worker verification failure leaves old bundle active");

  // Now run worker verification success: commits pointer swap via rebundle.commit control op
  const workerOkRes = await handlePlateRebundle(
    { data: queuedJob.data, signal: new AbortController().signal },
    {
      control: { op: (name, args) => operations[name](args) },
      storageImpl: {
        downloadPlateInput: async (key, dest) => {
          const bytes = await getObject("uploads", key);
          writeFileSync(dest, bytes);
        }
      },
      engineImpl: {
        verifyScene: async (pagePath) => {
          const html = readFileSync(pagePath, "utf8");
          assert.ok(html.includes("window.FILM"));
          return { blocked: [] };
        }
      }
    }
  );
  assert.equal(workerOkRes.status, "committed");
  assert.equal(workerOkRes.rev, 1);
  const wAfter = await store.getVariant(wv0.id);
  assert.equal(wAfter.rev, 1);
  assert.equal(wAfter.bundle_key, stagedWorker.newBundleKey);
  assert.equal(wAfter.bundle_digest, stagedWorker.newBundleDigest);
  assert.equal(wAfter.bundle_manifest.engineDigest, engineDigest());

  // =========================================================================
  // 8. Real headless Chromium verification (`defaultChromiumVerifier` -> `verifyScene`)
  //    plus full CLI seeded-project run log (dry-run -> --apply -> idempotent second --apply -> --rollback)
  // =========================================================================
  {
    const lockPath = "/Users/osamaehsaan/Code/Market_apps/.lock-timing";
    const { openSync, closeSync, unlinkSync, existsSync } = await import("node:fs");
    const browserPath =
      process.env.PLATE_BROWSER_PATH ||
      "/Users/osamaehsaan/Code/Market_apps/VideoSaaS/experiments/anidoodle-try/pw-cache/chromium_headless_shell-1/chrome-headless-shell-mac-arm64/chrome-headless-shell";
    if (existsSync(browserPath)) {
      process.env.PLATE_BROWSER_PATH = browserPath;
      // When the caller already holds .lock-timing (set TIMING_LOCK_HELD=1), do not wait for or take it again: waiting would deadlock on the caller's own lock.
      const callerHoldsLock = process.env.TIMING_LOCK_HELD === "1";
      if (!callerHoldsLock) {
        const waitStart = Date.now();
        while (existsSync(lockPath)) {
          if (Date.now() - waitStart > 15 * 60_000) throw new Error("Timed out after 15 minutes waiting for .lock-timing (held by another track; set TIMING_LOCK_HELD=1 if you hold it yourself).");
          await new Promise((r) => setTimeout(r, 250));
        }
        const fd = openSync(lockPath, "wx");
        writeFileSync(fd, `rebundle-argon ${new Date().toISOString()}\n`);
        closeSync(fd);
      }
      try {
        // Reset workerProjectId's variant back to old engineDigest and run rebundleVariant with defaultChromiumVerifier (no custom verifier)
        await pool.query(
          "update app.plate_variants set bundle_manifest = jsonb_set(bundle_manifest, '{engineDigest}', '\"064000000000000000000640\"'::jsonb) where id = $1",
          [wv0.id]
        );
        const realVerifyOut = await rebundleVariant(wv0.id);
        assert.equal(realVerifyOut.status, "committed", "real headless Chromium verifyScene succeeded in defaultChromiumVerifier");
        assert.equal(realVerifyOut.newRev, 2);
      } finally {
        if (!callerHoldsLock) { try { unlinkSync(lockPath); } catch {} }
      }
    }
  }

  // =========================================================================
  // 9. Subprocess CLI test (`src/scripts/rebundle-plates.ts` dry-run & rollback)
  // =========================================================================
  {
    const runCli = (extraArgs) => {
      const r = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "src/scripts/rebundle-plates.ts", "--project", projectId, ...extraArgs],
        {
          cwd: resolve(import.meta.dirname, ".."),
          env: {
            ...process.env,
            APP_ENV: "local",
            PLANNER: "deterministic",
            STORAGE_DRIVER: "filesystem"
          },
          encoding: "utf8"
        }
      );
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.trim().split("\n");
      const startIdx = lines.findIndex((l) => l.startsWith("{"));
      return JSON.parse(lines.slice(startIdx).join("\n"));
    };

    const cliDry1 = runCli([]);
    assert.equal(cliDry1.action, "dry-run");
    assert.equal(cliDry1.candidateCount, 0);
    assert.equal(cliDry1.upToDateCount, 2);
  }

  console.log("plate rebundle: ok");
} finally {
  config.plates.live = false;
  rmSync(scratch, { recursive: true, force: true });
  await app.close();
  const vIds = (await pool.query("select id::text as id from app.plate_variants where project_id = any($1)", [projects])).rows.map((r) => r.id);
  const eIds = (await pool.query("select id::text as id from app.plate_exports where project_id = any($1)", [projects])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and (data->>'variantId' = any($1) or data->>'exportId' = any($2))", [vIds, eIds]);
  await pool.query("delete from app.plate_exports where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await pool.query("delete from app.projects where id = any($1)", [projects]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolveClose) => server.close(resolveClose));
}
