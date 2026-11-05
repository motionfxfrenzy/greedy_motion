// Step 5: Garbage collector protection test (`plate-rebundle-gc.mjs`):
// Verifies that `sweepGarbage` never removes any prefix referenced by any row in `app.plate_revisions`
// (whether the revision points to an old-shape `.../g1/bundle.html` key, a content-addressed
// `.../g1/bundles/<sha>/bundle.html` key, or a content-addressed `.../g1/sources/<sha>/source.ts` key),
// while unreferenced superseded prefixes are swept as expected.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-gc.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { bundleScene } from "@videosaas/plate-engine";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_rebundle|plates_unit|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (plates_rebundle, plates_unit, or test).");
}

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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
const { putObject } = await import("../src/storage.ts");
const { sweepGarbage } = await import("../src/plates/reconcile.ts");
const store = await import("../src/plates/store.ts");
const { rebundleVariant } = await import("../src/plates/rebundle.ts");
const { engineBundleSha } = await import("../../worker/src/plates.mjs");

await migrate();
await startQueues();

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
  'export const film: Film = { meta: { title: "gc", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };'
].join("\n");

try {
  config.plates.live = true;
  config.plates.liveForceOff = false;

  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    projectId,
    "00000000-0000-4000-8000-000000000000",
    "GC Test",
    "Draft",
    {
      id: projectId,
      ownerId: "00000000-0000-4000-8000-000000000000",
      name: "GC Test",
      state: "Draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
      screenshots: [],
      comments: [],
      brief: {
        text: "GC test",
        look: "illus-fox",
        aspect: "16:9",
        aspects: ["16:9"],
        scriptBeats: [0, 1, 2].map((i) => ({
          id: `b${i}`,
          keyword: `K${i}`,
          visual: `V${i}`,
          onScreen: `S${i}`,
          line: `L${i}`
        }))
      }
    }
  ]);

  const makeDesired = (sigOf = (i) => `v3:gc-${i}`) =>
    [0, 1, 2].map((index) => ({
      index,
      aspect: "16:9",
      signature: sigOf(index),
      frames: 60,
      width: 1920,
      height: 1080,
      keyword: `K${index}`
    }));

  await store.reconcileVariants(projectId, makeDesired(), { scenes: 3 });
  const [v0, v1, v2] = await store.listVariants(projectId);
  const compiled = await bundleScene({ look: "illus-fox", code: sceneCode, frames: 60, aspect: "16:9" });

  // v0: old-shape g1/bundle.html at rev=0, then re-bundled to g1/bundles/<sha>/bundle.html at rev=1
  const v0G1Prefix = store.prefixOf(v0);
  const oldHtml0 = compiled.html + "<!-- gc-old-0 -->";
  const oldManifest0 = {
    ...compiled.manifest,
    engineVersion: "0.6.4",
    engineDigest: "064000000000000000000640",
    bundleSha: engineBundleSha(oldHtml0)
  };
  await putObject("uploads", `${v0G1Prefix}source.ts`, sceneCode, "text/plain");
  await putObject("uploads", `${v0G1Prefix}bundle.html`, oldHtml0, "text/html");
  await putObject("uploads", `${v0G1Prefix}manifest.json`, JSON.stringify(oldManifest0), "application/json");
  const ow0 = store.newOwner();
  await store.claimAuthor(v0.id, v0.gen, ow0, 60, 10);
  await store.commitBundle(v0, ow0, {
    sourceKey: `${v0G1Prefix}source.ts`,
    bundleKey: `${v0G1Prefix}bundle.html`,
    manifest: oldManifest0,
    timings: {}
  });
  const reb0 = await rebundleVariant(v0.id, { verifier: async () => ({ ok: true }) });
  assert.equal(reb0.status, "committed");

  // v1: content-addressed g1/bundles/<sha>/bundle.html and g1/sources/<sha>/source.ts at rev=0
  const v1G1Prefix = store.prefixOf(v1);
  const v1SourceKey = store.sourceKeyFor(v1, compiled.manifest.sourceSha);
  const v1BundleKey = store.bundleKeyFor(v1, compiled.manifest.bundleSha);
  await putObject("uploads", v1SourceKey, sceneCode, "text/plain");
  await putObject("uploads", v1BundleKey, compiled.html, "text/html");
  const ow1 = store.newOwner();
  await store.claimAuthor(v1.id, v1.gen, ow1, 60, 10);
  await store.commitBundle(v1, ow1, {
    sourceKey: v1SourceKey,
    bundleKey: v1BundleKey,
    manifest: compiled.manifest,
    timings: {}
  });

  // v2: never bundled (no rows in app.plate_revisions)
  const v2G1Prefix = store.prefixOf(v2);

  // Supersede all 3 variants (puts v0G1Prefix, v1G1Prefix, v2G1Prefix into app.plate_garbage)
  await store.reconcileVariants(projectId, makeDesired((i) => `v3:gc-changed-${i}`), { scenes: 3 });
  await pool.query("update app.plate_garbage set next_sweep_at = now() - interval '5 minutes' where project_id = $1", [projectId]);

  const garbageBefore = (
    await pool.query("select prefix from app.plate_garbage where project_id = $1 order by prefix", [projectId])
  ).rows.map((r) => r.prefix);
  assert.deepEqual(garbageBefore.sort(), [v0G1Prefix, v1G1Prefix, v2G1Prefix].sort());

  // Run sweepGarbage pass 1 and pass 2
  const deletedCalls = [];
  const swept1 = await sweepGarbage(20, async (bucket, prefix) => {
    deletedCalls.push(`${bucket}:${prefix}`);
  });
  assert.deepEqual(swept1, [v2G1Prefix], "only unreferenced v2G1Prefix is swept; v0G1Prefix and v1G1Prefix are protected by plate_revisions");
  assert.equal(deletedCalls.some((c) => c.includes(v0G1Prefix)), false, "v0G1Prefix (mixed old + rebundle revisions) is never deleted");
  assert.equal(deletedCalls.some((c) => c.includes(v1G1Prefix)), false, "v1G1Prefix (content-addressed revision) is never deleted");

  await pool.query("update app.plate_garbage set next_sweep_at = now() - interval '5 minutes' where project_id = $1", [projectId]);
  const swept2 = await sweepGarbage(20, async (bucket, prefix) => {
    deletedCalls.push(`${bucket}:${prefix}`);
  });
  assert.deepEqual(swept2, [v2G1Prefix]);
  assert.equal(deletedCalls.some((c) => c.includes(v0G1Prefix)), false);
  assert.equal(deletedCalls.some((c) => c.includes(v1G1Prefix)), false);

  // Also test what happens if a sub-prefix like `${v0G1Prefix}bundles/` were ever placed in plate_garbage:
  const subPrefix = `${v0G1Prefix}bundles/`;
  await pool.query(
    "insert into app.plate_garbage (prefix, project_id, next_sweep_at) values ($1, $2, now() - interval '1 minute')",
    [subPrefix, projectId]
  );
  const sweptSub = await sweepGarbage(20, async (bucket, prefix) => {
    deletedCalls.push(`${bucket}:${prefix}`);
  });
  assert.equal(sweptSub.includes(subPrefix), false, "sub-prefix containing revision bundle_key is also protected by starts_with");

  console.log("plate rebundle gc: ok");
} finally {
  config.plates.live = false;
  await pool.query("delete from app.plate_variants where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_state where project_id = $1", [projectId]);
  await pool.query("delete from app.projects where id = $1", [projectId]);
  await pool.query("delete from pgboss.job where name like 'plate-%'");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolve) => server.close(resolve));
}
