// Step 5: Legacy-shape & mixed-shape compatibility test (`plate-legacy-keys.mjs`):
// Verifies that:
//   1. A variant still on an old-shape `.../g<gen>/bundle.html` (and `source.ts`, `manifest.json`) key:
//      - is served by `GET /v1/projects/:id/plates/:variantId/bundle`
//      - passes `plateKeyOk` and `verifyBundleDigest` in the worker
//      - freezes cleanly in `buildExport` and renders via `prepareManifestClips` in the worker
//      - is protected from deletion by `sweepGarbage`
//   2. A project mid-way (one scene still on old-shape `.../g<gen>/bundle.html`, another scene re-bundled
//      with old revision rows at `.../g<gen>/bundle.html` plus a current revision row at
//      `.../g<gen>/bundles/<bundleSha>/bundle.html`) behaves identically across the bundle route,
//      `buildExport`, `verifyBundleDigest`, `prepareManifestClips`, and `sweepGarbage`.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-legacy-keys.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { bundleScene, engineDigest } from "@videosaas/plate-engine";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const s3Store = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (req.method === "HEAD") {
    const entry = s3Store.get(key);
    if (!entry) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end();
    return;
  }
  if (req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    s3Store.set(key, { bytes, contentType: req.headers["content-type"] ?? "application/octet-stream" });
    res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
    res.end();
    return;
  }
  if (req.method === "GET") {
    const entry = s3Store.get(key);
    if (!entry) { res.writeHead(404); res.end(); return; }
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

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { operations } = await import("../src/jobs/control.ts");
const { getObject, putObject } = await import("../src/storage.ts");
const { buildExport } = await import("../src/plates/exports.ts");
const { sweepGarbage } = await import("../src/plates/reconcile.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const store = await import("../src/plates/store.ts");
const { rebundleVariant } = await import("../src/plates/rebundle.ts");
const { engineBundleSha, prepareManifestClips, verifyBundleDigest } = await import("../../worker/src/plates.mjs");
const { plateKeyOk } = await import("../../worker/src/storage.mjs");

await migrate();
await startQueues();

const app = Fastify();
await registerPlateRoutes(app, {
  presign: async (bucket, key, opts) => `https://r2.example.test/${bucket}/${key}?ttl=${opts?.seconds ?? 900}`
});
await app.ready();

const scratch = mkdtempSync(join(tmpdir(), "plate-legacy-keys-test-"));
const projectId = randomUUID();

const sceneCode = [
  'import { Ctx, Env } from "./core";',
  'import { Film } from "./film";',
  "const W = 1920, H = 1080, durationFrames = 60;",
  "const draw = (ctx: Ctx, frame: number, env: Env): void => {",
  "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
  '  ctx.fillStyle = "#fff8ee";',
  "  ctx.fillRect(0, 0, W, H);",
  "};",
  'export const film: Film = { meta: { title: "legacy-keys", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };'
].join("\n");

function makeProjectRecord(id) {
  const beats = [0, 1].map((i) => ({
    id: `b${i}`,
    keyword: `K${i}`,
    visual: `V${i}`,
    onScreen: `S${i}`,
    line: `L${i}`
  }));
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Legacy Keys Test",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      text: "Legacy keys test",
      look: "illus-fox",
      aspect: "16:9",
      aspects: ["16:9"],
      captions: "none",
      scriptBeats: beats
    },
    beatPlan: {
      target_duration_s: 4,
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

  const projectRecord = makeProjectRecord(projectId);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    projectId,
    projectRecord.ownerId,
    projectRecord.name,
    projectRecord.state,
    projectRecord
  ]);

  await store.reconcileVariants(
    projectId,
    [0, 1].map((index) => ({
      index,
      aspect: "16:9",
      signature: `v3:leg-${index}`,
      frames: 60,
      width: 1920,
      height: 1080,
      keyword: `K${index}`
    })),
    { scenes: 2 }
  );
  const [v0, v1] = await store.listVariants(projectId);
  const compiled = await bundleScene({ look: "illus-fox", code: sceneCode, frames: 60, aspect: "16:9" });

  // =========================================================================
  // 1. Both variants on old-shape `.../g1/bundle.html` and `.../g1/source.ts`
  // =========================================================================
  for (const v of [v0, v1]) {
    const prefix = store.prefixOf(v);
    const oldSourceKey = `${prefix}source.ts`;
    const oldBundleKey = `${prefix}bundle.html`;
    const oldManifestKey = `${prefix}manifest.json`;

    assert.equal(plateKeyOk(oldSourceKey, projectId), true, "plateKeyOk accepts old-shape source.ts");
    assert.equal(plateKeyOk(oldBundleKey, projectId), true, "plateKeyOk accepts old-shape bundle.html");
    assert.equal(plateKeyOk(oldManifestKey, projectId), true, "plateKeyOk accepts old-shape manifest.json");

    // Store with old engineDigest on v1 so we can re-bundle v1 in part 2 while keeping v0 on current engineDigest
    const html = compiled.html + `<!-- scene-${v.scene_index} -->`;
    const manifest = {
      ...compiled.manifest,
      engineDigest: v.scene_index === 1 ? "064000000000000000000640" : engineDigest(),
      bundleSha: engineBundleSha(html)
    };
    await putObject("uploads", oldSourceKey, sceneCode, "text/plain");
    await putObject("uploads", oldBundleKey, html, "text/html");
    await putObject("uploads", oldManifestKey, JSON.stringify(manifest), "application/json");

    const ow = store.newOwner();
    await store.claimAuthor(v.id, v.gen, ow, 60, 10);
    await store.commitBundle(v, ow, {
      sourceKey: oldSourceKey,
      bundleKey: oldBundleKey,
      manifest,
      timings: {}
    });
  }

  // Verify bundle route serves old-shape keys for both v0 and v1
  for (const v of [v0, v1]) {
    const current = await store.getVariant(v.id);
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/plates/${v.id}/bundle`
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.url.includes(`plates/${projectId}/16x9/${v.scene_index}/g1/bundle.html`));
    assert.equal(body.bundleDigest, current.bundle_digest);
  }

  // Freeze an export manifest while both are on old-shape keys
  const frozenOldOnly = await buildExport(projectRecord, "16:9", false);
  assert.equal(frozenOldOnly.manifest.scenes[0].bundleKey, `plates/${projectId}/16x9/0/g1/bundle.html`);
  assert.equal(frozenOldOnly.manifest.scenes[1].bundleKey, `plates/${projectId}/16x9/1/g1/bundle.html`);

  // Verify worker verifyBundleDigest & prepareManifestClips on old-shape manifest
  // Note: buildExport uses the first scene's engineDigest as manifest.engineDigest, so let's make both use the same engineDigest for the pure old-shape test first, or test scene 0:
  const rawHtml0 = (await getObject("uploads", frozenOldOnly.manifest.scenes[0].bundleKey)).toString("utf8");
  assert.equal(verifyBundleDigest(rawHtml0, frozenOldOnly.manifest.scenes[0], frozenOldOnly.manifest).ok, true);

  // =========================================================================
  // 2. Mid-way state: v0 stays on old-shape `.../g1/bundle.html` (current engineDigest),
  //    while v1 is re-bundled from old-shape `.../g1/source.ts` to new-shape `.../g1/bundles/<sha>/bundle.html`!
  // =========================================================================
  const reb1 = await rebundleVariant(v1.id, { verifier: async () => ({ ok: true }) });
  assert.equal(reb1.status, "committed");

  const v0Mid = await store.getVariant(v0.id);
  const v1Mid = await store.getVariant(v1.id);
  assert.equal(v0Mid.bundle_key, `plates/${projectId}/16x9/0/g1/bundle.html`, "v0 still has old-shape bundle_key");
  assert.match(
    v1Mid.bundle_key,
    new RegExp(`^plates/${projectId}/16x9/1/g1/bundles/[0-9a-f]{24}/bundle\\.html$`),
    "v1 now has content-addressed new-shape bundle_key"
  );
  assert.equal(plateKeyOk(v1Mid.bundle_key, projectId), true, "plateKeyOk accepts new-shape bundle_key");

  // Bundle route serves both v0 (old-shape) and v1 (new-shape)
  const route0Mid = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${v0.id}/bundle` })).json();
  const route1Mid = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${v1.id}/bundle` })).json();
  assert.ok(route0Mid.url.includes(v0Mid.bundle_key));
  assert.ok(route1Mid.url.includes(v1Mid.bundle_key));

  // Freeze an ExportManifest on the mixed project (v0 old-shape, v1 new-shape)
  const frozenMixed = await buildExport(projectRecord, "16:9", false);
  assert.equal(frozenMixed.manifest.scenes[0].bundleKey, v0Mid.bundle_key);
  assert.equal(frozenMixed.manifest.scenes[1].bundleKey, v1Mid.bundle_key);

  for (const s of frozenMixed.manifest.scenes) {
    const html = (await getObject("uploads", s.bundleKey)).toString("utf8");
    const check = verifyBundleDigest(html, s, frozenMixed.manifest);
    assert.equal(check.ok, true, `mixed manifest scene ${s.index} (${s.bundleKey}) passes verifyBundleDigest`);
  }

  // Render the mixed ExportManifest via prepareManifestClips
  const mixedClipDir = join(scratch, "mixed-clips");
  const preparedMixed = await prepareManifestClips(
    {
      op: async (name, args) => {
        if (name === "clip.lookup") return { clips: [] };
        if (name === "clip.record") return { ok: true, duplicate: false };
        return operations[name](args);
      }
    },
    frozenMixed.manifest,
    {
      fence: { jobId: randomUUID(), attempt: 1 },
      scratch: mixedClipDir,
      probeRenderer: async () => "Google SwiftShader",
      storageImpl: {
        downloadPlateInput: async (key, dest) => {
          const bytes = await getObject("uploads", key);
          assert.ok(bytes, `found ${key}`);
          writeFileSync(dest, bytes);
        },
        downloadPlateOutput: async () => {},
        uploadPlateOutput: async () => {},
        deleteOutputs: async () => {}
      },
      engineImpl: {
        verifyScene: async (pagePath) => {
          const html = readFileSync(pagePath, "utf8");
          assert.ok(html.includes("window.FILM"));
          return { blocked: [], midPng: Buffer.from("PNG") };
        },
        renderScene: async (_pagePath, outFile) => writeFileSync(outFile, "MP4_MIXED"),
        probeVideo: async () => ({ frames: 60, width: 1920, height: 1080, fps: 30 }),
        classifyFailure: () => "infra"
      }
    }
  );
  assert.equal(preparedMixed.clipFiles.length, 2, "prepareManifestClips rendered both old-shape and new-shape scenes");

  // GC protection: put both g1 prefixes in app.plate_garbage and verify sweepGarbage skips both!
  const p0 = store.prefixOf(v0Mid);
  const p1 = store.prefixOf(v1Mid);
  await pool.query(
    `insert into app.plate_garbage (prefix, project_id, next_sweep_at)
     values ($1, $3, now() - interval '5 minutes'), ($2, $3, now() - interval '5 minutes')`,
    [p0, p1, projectId]
  );
  const removed = [];
  const swept = await sweepGarbage(20, async (bucket, prefix) => {
    removed.push(`${bucket}:${prefix}`);
  });
  assert.equal(swept.includes(p0), false, "old-shape prefix is protected by sweepGarbage");
  assert.equal(swept.includes(p1), false, "mixed old+new revision prefix is protected by sweepGarbage");
  assert.equal(removed.length, 0);

  console.log("plate legacy keys: ok");
} finally {
  config.plates.live = false;
  rmSync(scratch, { recursive: true, force: true });
  await app.close();
  const vIds = (await pool.query("select id::text as id from app.plate_variants where project_id = $1", [projectId])).rows.map((r) => r.id);
  const eIds = (await pool.query("select id::text as id from app.plate_exports where project_id = $1", [projectId])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and (data->>'variantId' = any($1) or data->>'exportId' = any($2))", [vIds, eIds]);
  await pool.query("delete from app.plate_exports where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_variants where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_state where project_id = $1", [projectId]);
  await pool.query("delete from app.projects where id = $1", [projectId]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolveClose) => server.close(resolveClose));
}
