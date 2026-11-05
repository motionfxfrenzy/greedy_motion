// Step 5: Rollback test (`plate-rebundle-rollback.mjs`):
// Verifies that `rollbackRebundleRevision` and `rollbackRebundleTarget` (and `--rollback` on the CLI):
//   1. Restores `rev`, `bundle_key`, `bundle_digest`, `bundle_manifest`, and `source_key` in one transaction per variant.
//   2. Also works when rolling back to a pre-030 revision row whose `bundle_manifest` column is null (by reading
//      `${oldBundlePrefix}manifest.json` from storage).
//   3. Refuses to roll back a variant whose active revision is NOT `author = 'engine-rebundle'`.
//   4. Leaves the `newBundleKey` object in storage intact so any export manifest frozen while `newRev` was active
//      continues to verify and render without error.
//   5. Supports `--rollback <variantId>` and `--rollback all-engine-rebundle` via the CLI.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-rollback.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import Fastify from "fastify";
import { bundleScene, engineDigest } from "@videosaas/plate-engine";

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
const { getObject, putObject } = await import("../src/storage.ts");
const { buildExport } = await import("../src/plates/exports.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const store = await import("../src/plates/store.ts");
const { rebundleStaleVariants, rollbackRebundleTarget } = await import("../src/plates/rebundle.ts");
const { engineBundleSha, verifyBundleDigest } = await import("../../worker/src/plates.mjs");

await migrate();
await startQueues();

const app = Fastify();
await registerPlateRoutes(app, {
  presign: async (bucket, key, opts) => `https://r2.example.test/${bucket}/${key}?ttl=${opts?.seconds ?? 900}`
});
await app.ready();

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
  'export const film: Film = { meta: { title: "rollback", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };'
].join("\n");

function makeProjectRecord(id) {
  const beats = [0, 1, 2].map((i) => ({
    id: `b${i}`,
    keyword: `K${i}`,
    visual: `V${i}`,
    onScreen: `S${i}`,
    line: `L${i}`
  }));
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Rollback Test",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      text: "Rollback test",
      look: "illus-fox",
      aspect: "16:9",
      aspects: ["16:9"],
      captions: "none",
      scriptBeats: beats
    },
    beatPlan: {
      target_duration_s: 6,
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
    [0, 1, 2].map((index) => ({
      index,
      aspect: "16:9",
      signature: `v3:rb-${index}`,
      frames: 60,
      width: 1920,
      height: 1080,
      keyword: `K${index}`
    })),
    { scenes: 3 }
  );
  const vars = await store.listVariants(projectId);
  const compiled = await bundleScene({ look: "illus-fox", code: sceneCode, frames: 60, aspect: "16:9" });
  const oldEngineDigest = "064000000000000000000640";
  const oldState = [];

  for (const v of vars) {
    const prefix = store.prefixOf(v);
    const oldHtml = compiled.html + `<!-- rb-old-${v.scene_index} -->`;
    const oldManifest = {
      ...compiled.manifest,
      engineVersion: "0.6.4",
      engineDigest: oldEngineDigest,
      bundleSha: engineBundleSha(oldHtml)
    };
    await putObject("uploads", `${prefix}source.ts`, sceneCode, "text/plain");
    await putObject("uploads", `${prefix}bundle.html`, oldHtml, "text/html");
    await putObject("uploads", `${prefix}manifest.json`, JSON.stringify(oldManifest), "application/json");
    const ow = store.newOwner();
    await store.claimAuthor(v.id, v.gen, ow, 60, 10);
    await store.commitBundle(v, ow, {
      sourceKey: `${prefix}source.ts`,
      bundleKey: `${prefix}bundle.html`,
      manifest: oldManifest,
      timings: {}
    });
    const afterCommit = await store.getVariant(v.id);
    oldState.push({
      id: afterCommit.id,
      rev: afterCommit.rev,
      bundle_key: afterCommit.bundle_key,
      bundle_digest: afterCommit.bundle_digest,
      bundle_manifest: afterCommit.bundle_manifest,
      source_key: afterCommit.source_key
    });
  }

  // Simulate pre-030 revision row on scene 1 (null out bundle_manifest in app.plate_revisions for rev 0)
  await pool.query("update app.plate_revisions set bundle_manifest = null where variant_id = $1 and rev = 0", [vars[1].id]);

  // Re-bundle scenes 0 and 1 (limit 2), leaving scene 2 on rev 0 (author = null)
  const applied = await rebundleStaleVariants({
    dryRun: false,
    projectId,
    limit: 2,
    verifier: async () => ({ ok: true })
  });
  assert.equal(applied.committed, 2);

  // Freeze an export manifest while scenes 0 and 1 are at rev = 1 (new engine)
  const frozenAtNewRev = await buildExport(projectRecord, "16:9", false);
  assert.equal(frozenAtNewRev.manifest.scenes[0].rev, 1);
  assert.equal(frozenAtNewRev.manifest.scenes[1].rev, 1);
  assert.equal(frozenAtNewRev.manifest.scenes[2].rev, 0);

  // --- 1. Rollback of scene 2 (never re-bundled, author=null) is refused with reason 'not_engine_rebundle'
  const rbRefused = await store.rollbackRebundleRevision(vars[2].id);
  assert.equal(rbRefused.rolledBack, false);
  assert.equal(rbRefused.reason, "not_engine_rebundle");

  // --- 2. Rollback of scene 0 via CLI (`--rollback <variantId>`) restores rev, bundle_key, bundle_digest, bundle_manifest
  const cliRb0 = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "src/scripts/rebundle-plates.ts", "--rollback", vars[0].id],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: { ...process.env, APP_ENV: "local", PLANNER: "deterministic" },
      encoding: "utf8"
    }
  );
  assert.equal(cliRb0.status, 0, cliRb0.stderr);
  const v0RolledBack = await store.getVariant(vars[0].id);
  assert.equal(v0RolledBack.rev, 0);
  assert.equal(v0RolledBack.bundle_key, oldState[0].bundle_key);
  assert.equal(v0RolledBack.bundle_digest, oldState[0].bundle_digest);
  assert.deepEqual(v0RolledBack.bundle_manifest, oldState[0].bundle_manifest);
  assert.equal(v0RolledBack.source_key, oldState[0].source_key);

  // Live preview route immediately serves oldState[0] again
  const route0 = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/plates/${vars[0].id}/bundle` })).json();
  assert.ok(route0.url.includes(oldState[0].bundle_key));
  assert.equal(route0.bundleDigest, oldState[0].bundle_digest);

  // --- 3. Global rollback (`--rollback all-engine-rebundle`) rolls back remaining scene 1 (including storage manifest fallback)
  const allRb = await rollbackRebundleTarget("all-engine-rebundle", { projectId });
  assert.equal(allRb.rolledBack, 1, "only scene 1 was still at engine-rebundle revision");
  assert.equal(allRb.outcomes[0].variantId, vars[1].id);

  const v1RolledBack = await store.getVariant(vars[1].id);
  assert.equal(v1RolledBack.rev, 0);
  assert.equal(v1RolledBack.bundle_key, oldState[1].bundle_key);
  assert.equal(v1RolledBack.bundle_digest, oldState[1].bundle_digest);
  assert.deepEqual(v1RolledBack.bundle_manifest, oldState[1].bundle_manifest, "storage manifest.json fallback restored bundle_manifest");

  // --- 4. Export manifest frozen while rev=1 was active still finds newBundleKey in storage and passes verifyBundleDigest
  for (const idx of [0, 1]) {
    const s = frozenAtNewRev.manifest.scenes[idx];
    const newHtmlBytes = await getObject("uploads", s.bundleKey);
    assert.ok(newHtmlBytes, `newBundleKey ${s.bundleKey} remains in storage after rollback`);
    // Note: in frozenAtNewRev, manifest.engineDigest was scenes[0]'s engineDigest (current engineDigest())
    assert.equal(frozenAtNewRev.manifest.engineDigest, engineDigest());
    const check = verifyBundleDigest(newHtmlBytes.toString("utf8"), s, frozenAtNewRev.manifest);
    assert.equal(check.ok, true, `frozen manifest created at rev=1 still verifies after rollback of scene ${idx}`);
  }

  console.log("plate rebundle rollback: ok");
} finally {
  config.plates.live = false;
  await app.close();
  await pool.query("delete from app.plate_exports where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_variants where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [projectId]);
  await pool.query("delete from app.plate_state where project_id = $1", [projectId]);
  await pool.query("delete from app.projects where id = $1", [projectId]);
  await pool.query("delete from pgboss.job where name like 'plate-%'");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolveClose) => server.close(resolveClose));
}
