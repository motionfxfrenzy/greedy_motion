// Step 5: Concurrent edit & fencing test (`plate-rebundle-fence.mjs`):
// Verifies that if a variant changes while rebundleVariant is mid-flight (between snapshot/bundling/verification
// and commitRebundleRevision), the fenced commit affects 0 rows and returns `status: "fenced"` without clobbering:
//   1. Concurrent `reviseScene` (user comment revision bumping `gen` and `rev` and moving state to `queued`).
//   2. Concurrent `reconcileVariants` (storyboard edit bumping `gen`).
//   3. Concurrent repair (`sendBackForRepair` bumping `rev` at the same `gen`).
//   4. Concurrent `bundle_digest` change at the same `(gen, rev)`.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-fence.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { bundleScene } from "@videosaas/plate-engine";
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
  'export const film: Film = { meta: { title: "fence", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };'
].join("\n");

try {
  config.plates.live = true;
  config.plates.liveForceOff = false;

  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    projectId,
    "00000000-0000-4000-8000-000000000000",
    "Fence Test",
    "Draft",
    {
      id: projectId,
      ownerId: "00000000-0000-4000-8000-000000000000",
      name: "Fence Test",
      state: "Draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
      screenshots: [],
      comments: [],
      brief: {
        text: "Fence test",
        look: "illus-fox",
        aspect: "16:9",
        aspects: ["16:9"],
        scriptBeats: [0, 1, 2, 3].map((i) => ({
          id: `b${i}`,
          keyword: `K${i}`,
          visual: `V${i}`,
          onScreen: `S${i}`,
          line: `L${i}`
        }))
      }
    }
  ]);

  const makeDesired = (sigOf = (i) => `v3:fence-${i}`) =>
    [0, 1, 2, 3].map((index) => ({
      index,
      aspect: "16:9",
      signature: sigOf(index),
      frames: 60,
      width: 1920,
      height: 1080,
      keyword: `K${index}`
    }));

  await store.reconcileVariants(projectId, makeDesired(), { scenes: 4 });
  const vars = await store.listVariants(projectId);
  const compiled = await bundleScene({ look: "illus-fox", code: sceneCode, frames: 60, aspect: "16:9" });

  for (const v of vars) {
    const prefix = store.prefixOf(v);
    const oldHtml = compiled.html + `<!-- old-${v.scene_index} -->`;
    const oldManifest = {
      ...compiled.manifest,
      engineVersion: "0.6.4",
      engineDigest: "064000000000000000000640",
      bundleSha: engineBundleSha(oldHtml)
    };
    await putObject("uploads", `${prefix}source.ts`, sceneCode, "text/plain");
    await putObject("uploads", `${prefix}bundle.html`, oldHtml, "text/html");
    await putObject("uploads", `${prefix}manifest.json`, JSON.stringify(oldManifest), "application/json");
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.commitBundle(v, owner, {
      sourceKey: `${prefix}source.ts`,
      bundleKey: `${prefix}bundle.html`,
      manifest: oldManifest,
      timings: {}
    });
    const bundled = await store.getVariant(v.id);
    if (v.scene_index !== 2) {
      await store.submitCheckReport(bundled.id, {
        gen: bundled.gen,
        bundleDigest: bundled.bundle_digest,
        host: "worker",
        results: { ok: true }
      });
    }
  }

  const [v0, v1, v2, v3] = await store.listVariants(projectId);

  // --- 1. Concurrent reviseScene (bumps gen and rev, sets state='queued') while rebundleVariant is mid-flight
  const out0 = await rebundleVariant(v0.id, {
    verifier: async () => {
      // Simulate user revising scene 0 while Chromium verification is running
      const revCount = await store.reviseScene(projectId, 0, "- at 0.5 s: brighter stars");
      assert.equal(revCount, 1);
      return { ok: true };
    }
  });
  assert.equal(out0.status, "fenced", "concurrent reviseScene fences out rebundle commit");
  const v0After = await store.getVariant(v0.id);
  assert.equal(v0After.gen, 2, "user's gen bump is preserved");
  assert.equal(v0After.rev, 1, "user's rev bump is preserved");
  assert.equal(v0After.state, "queued", "user's queued state is not clobbered by rebundle");
  assert.equal(v0After.bundle_key, null);
  assert.equal((await store.listRevisions(v0.id)).length, 1, "no engine-rebundle revision row inserted when fenced");

  // --- 2. Concurrent reconcileVariants (storyboard change bumps gen) while rebundleVariant is mid-flight
  const out1 = await rebundleVariant(v1.id, {
    verifier: async () => {
      await store.reconcileVariants(
        projectId,
        makeDesired((i) => (i === 1 ? "v3:fence-1-edited" : `v3:fence-${i}`)),
        { scenes: 4 }
      );
      return { ok: true };
    }
  });
  assert.equal(out1.status, "fenced", "concurrent storyboard gen bump fences out rebundle commit");
  const v1After = await store.getVariant(v1.id);
  assert.equal(v1After.gen, 2);
  assert.equal(v1After.rev, 0);
  assert.equal(v1After.state, "queued");
  assert.equal((await store.listRevisions(v1.id)).length, 1);

  // --- 3. Concurrent sendBackForRepair (bumps rev at same gen) while rebundleVariant is mid-flight
  const out2 = await rebundleVariant(v2.id, {
    verifier: async () => {
      const repairRes = await store.sendBackForRepair(v2, "ReferenceError: mid-flight repair");
      assert.equal(repairRes.applied, true);
      return { ok: true };
    }
  });
  assert.equal(out2.status, "fenced", "concurrent repair rev bump at same gen fences out rebundle commit");
  const v2After = await store.getVariant(v2.id);
  assert.equal(v2After.gen, 1);
  assert.equal(v2After.rev, 1);
  assert.equal(v2After.state, "queued");
  assert.equal(v2After.stage, "repairing");
  assert.equal((await store.listRevisions(v2.id)).length, 1);

  // --- 4. Concurrent bundle_digest change at same (gen, rev) fences out commitRebundleRevision directly
  const out3 = await rebundleVariant(v3.id, {
    verifier: async () => {
      await pool.query("update app.plate_variants set bundle_digest = $2 where id = $1", [
        v3.id,
        "f".repeat(64)
      ]);
      return { ok: true };
    }
  });
  assert.equal(out3.status, "fenced", "concurrent bundle_digest change fences out rebundle commit");
  const v3After = await store.getVariant(v3.id);
  assert.equal(v3After.rev, 0);
  assert.equal(v3After.bundle_digest, "f".repeat(64), "concurrent bundle_digest was not overwritten");
  assert.equal((await store.listRevisions(v3.id)).length, 1);

  console.log("plate rebundle fence: ok");
} finally {
  config.plates.live = false;
  const vIds = (await pool.query("select id::text as id from app.plate_variants where project_id = $1", [projectId])).rows.map((r) => r.id);
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [vIds]);
  await pool.query("delete from app.plate_variants where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_state where project_id = $1", [projectId]);
  await pool.query("delete from app.projects where id = $1", [projectId]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolve) => server.close(resolve));
}
