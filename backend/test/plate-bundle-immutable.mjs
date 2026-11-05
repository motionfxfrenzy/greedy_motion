// Step 2: Immutability regression test for authored and repaired plate bundles.
// Verifies that when a scene is authored, frozen into an ExportManifest via buildExport, and then
// sent through a repair re-author (handleAuthor), the frozen manifest's bundleKey object in storage
// remains byte-for-byte unchanged, verifyBundleDigest still passes on it, and a new revision row
// (with bundle_manifest) is inserted without overwriting earlier revision rows or storage objects.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/plate-bundle-immutable.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_rebundle|plates_unit|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (plates_rebundle, plates_unit, or test).");
}

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

// Hermetic in-process S3 + Anthropic mock server bound to 127.0.0.1
const s3Store = new Map();
const s3PutHistory = new Map();
const modelReplies = [];
let modelCalls = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/v1/messages") {
    modelCalls += 1;
    for await (const _ of req) { /* drain */ }
    const text = modelReplies.shift() ?? modelReplies[0] ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 100 }
      })
    );
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
    const hist = s3PutHistory.get(key) ?? [];
    hist.push(sha256Hex(bytes));
    s3PutHistory.set(key, hist);
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
const { getObject } = await import("../src/storage.ts");
const { handleAuthor } = await import("../src/plates/author.ts");
const { buildExport } = await import("../src/plates/exports.ts");
const store = await import("../src/plates/store.ts");
const { verifyBundleDigest } = await import("../../worker/src/plates.mjs");

await migrate();
await startQueues();

const projectId = randomUUID();
const project2Id = randomUUID();
const projects = [projectId, project2Id];

function makeSceneCode(colorHex, label) {
  return [
    "```ts",
    'import { Ctx, Env } from "./core";',
    'import { Film } from "./film";',
    "const W = 1920, H = 1080, durationFrames = 60;",
    "const draw = (ctx: Ctx, frame: number, env: Env): void => {",
    "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
    `  ctx.fillStyle = "${colorHex}";`,
    "  ctx.fillRect(0, 0, W, H);",
    `  ctx.fillStyle = "#112233";`,
    `  ctx.fillRect(100 + frame * 2, 100, 200, 120); // ${label}`,
    "};",
    `export const film: Film = { meta: { title: "${label}", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };`,
    "```"
  ].join("\n");
}

function makeProjectRow(id) {
  const beats = [
    {
      id: "b1",
      keyword: "Fox",
      visual: "A fox with a warm lantern.",
      onScreen: "Fox",
      line: "A fox carries a warm lantern."
    }
  ];
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Immutable Bundle Test",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      text: "A fox carries a warm lantern.",
      look: "illus-fox",
      aspect: "16:9",
      aspects: ["16:9"],
      captions: "none",
      scriptBeats: beats
    },
    beatPlan: {
      target_duration_s: 2,
      canvas: { width: 1920, height: 1080, fps: 30 },
      beats: [
        {
          id: "b1",
          role: "hook",
          kind: "plate",
          producer: "plates",
          keyword: "Fox",
          visual: "A fox with a warm lantern.",
          line: "A fox carries a warm lantern."
        }
      ]
    }
  };
}

try {
  config.plates.live = true;
  config.plates.liveForceOff = false;

  for (const pid of projects) {
    const pData = makeProjectRow(pid);
    await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
      pid,
      pData.ownerId,
      pData.name,
      pData.state,
      pData
    ]);
  }

  // --- 1. Author scene 0 via handleAuthor (mocked model)
  await store.reconcileVariants(
    projectId,
    [{ index: 0, aspect: "16:9", signature: "v3:imm-0", frames: 60, width: 1920, height: 1080, keyword: "Fox" }],
    { scenes: 1 }
  );
  const [v0] = await store.listVariants(projectId);
  modelReplies.push(makeSceneCode("#fff8ee", "initial-v0"));

  const fakeJob = (variantId, gen) => ({
    id: randomUUID(),
    name: "plate-author",
    data: { variantId, gen },
    retryCount: 0,
    signal: new AbortController().signal
  });

  await handleAuthor(fakeJob(v0.id, v0.gen));
  assert.equal(modelCalls, 1, "first handleAuthor called mocked model once");

  const afterAuthor1 = await store.getVariant(v0.id);
  assert.equal(afterAuthor1.state, "bundled");
  assert.equal(afterAuthor1.gen, 1);
  assert.equal(afterAuthor1.rev, 0);

  // Freeze an export manifest via buildExport before repair
  const projectData = makeProjectRow(projectId);
  const frozen = await buildExport(projectData, "16:9", false);
  const frozenScene0 = frozen.manifest.scenes[0];
  assert.ok(frozenScene0.bundleKey, "frozen manifest has bundleKey");

  const bytesBeforeRepair = await getObject("uploads", frozenScene0.bundleKey);
  assert.ok(bytesBeforeRepair, "frozen bundleKey exists in uploads bucket");
  const hashBeforeRepair = sha256Hex(bytesBeforeRepair);
  const sourceBeforeRepair = await getObject("uploads", afterAuthor1.source_key);
  const sourceHashBeforeRepair = sha256Hex(sourceBeforeRepair);

  const checkBefore = verifyBundleDigest(bytesBeforeRepair.toString("utf8"), frozenScene0, frozen.manifest);
  assert.equal(checkBefore.ok, true, "verifyBundleDigest passes before repair");

  // --- 2. Run repair via store.sendBackForRepair (live check report code failure) and re-author
  await store.submitCheckReport(afterAuthor1.id, {
    gen: afterAuthor1.gen,
    bundleDigest: afterAuthor1.bundle_digest,
    host: "worker",
    results: { ok: false, kind: "code", error: "ReferenceError: simulated repair trigger" }
  });

  const repairing1 = await store.getVariant(v0.id);
  assert.equal(repairing1.state, "queued");
  assert.equal(repairing1.stage, "repairing");
  assert.equal(repairing1.gen, 1, "repair keeps gen unchanged");
  assert.equal(repairing1.repairs, 1);

  modelReplies.push(makeSceneCode("#ffeecc", "repaired-v0-rev1"));
  await handleAuthor(fakeJob(v0.id, repairing1.gen));
  assert.equal(modelCalls, 2, "repair handleAuthor called mocked model once");

  const afterRepair1 = await store.getVariant(v0.id);
  assert.equal(afterRepair1.state, "bundled");
  assert.equal(afterRepair1.gen, 1);

  // Assert frozen manifest's bundleKey object is byte-for-byte unchanged and verifyBundleDigest still passes!
  const bytesAfterRepair = await getObject("uploads", frozenScene0.bundleKey);
  assert.ok(bytesAfterRepair, "frozen bundleKey object still exists after repair");
  assert.equal(sha256Hex(bytesAfterRepair), hashBeforeRepair, "frozen bundleKey object is byte-for-byte unchanged after repair");
  assert.equal(Buffer.compare(bytesAfterRepair, bytesBeforeRepair), 0);

  const checkAfter = verifyBundleDigest(bytesAfterRepair.toString("utf8"), frozenScene0, frozen.manifest);
  assert.equal(checkAfter.ok, true, `verifyBundleDigest still passes on frozen manifest after repair (${checkAfter.reason ?? "ok"})`);

  const sourceAfterRepair = await getObject("uploads", afterAuthor1.source_key);
  assert.equal(sha256Hex(sourceAfterRepair), sourceHashBeforeRepair, "original source_key object is byte-for-byte unchanged after repair");

  assert.equal(repairing1.rev, 1, "store.sendBackForRepair bumps rev by 1");
  assert.equal(afterRepair1.rev, 1);
  assert.notEqual(afterRepair1.bundle_key, frozenScene0.bundleKey, "repair wrote a new content-addressed bundle_key");
  assert.match(afterRepair1.bundle_key, /\/bundles\/[0-9a-f]{24}\/bundle\.html$/, "bundle_key is content-addressed");
  assert.match(afterRepair1.source_key, /\/sources\/[0-9a-f]{24}\/source\.ts$/, "source_key is content-addressed");

  // Check plate_revisions rows: both rev 0 and rev 1 exist and have bundle_manifest populated
  const revs1 = await store.listRevisions(v0.id);
  assert.equal(revs1.length, 2, "both rev 0 and rev 1 rows exist in app.plate_revisions");
  assert.equal(revs1[0].rev, 0);
  assert.equal(revs1[0].bundle_key, frozenScene0.bundleKey);
  assert.ok(revs1[0].bundle_manifest?.bundleSha, "rev 0 has bundle_manifest");
  assert.equal(revs1[1].rev, 1);
  assert.equal(revs1[1].bundle_key, afterRepair1.bundle_key);
  assert.ok(revs1[1].bundle_manifest?.bundleSha, "rev 1 has bundle_manifest");

  // --- 3. Also test worker control.ts plate.sendBackForRepair WITH renderAttempt (rendering repair path)
  await store.reconcileVariants(
    project2Id,
    [{ index: 0, aspect: "16:9", signature: "v3:imm-p2-0", frames: 60, width: 1920, height: 1080, keyword: "Fox" }],
    { scenes: 1 }
  );
  const [v2] = await store.listVariants(project2Id);
  modelReplies.push(makeSceneCode("#ddeeff", "p2-initial"));
  await handleAuthor(fakeJob(v2.id, v2.gen));

  const p2Data = makeProjectRow(project2Id);
  const frozen2 = await buildExport(p2Data, "16:9", false);
  const frozen2Scene0 = frozen2.manifest.scenes[0];
  const p2BytesBefore = await getObject("uploads", frozen2Scene0.bundleKey);

  // Claim for rendering (renderAttempt = 1) and trigger plate.sendBackForRepair with renderAttempt
  const claimed2 = await operations["plate.claim"]({ variantId: v2.id, gen: v2.gen });
  assert.equal(claimed2.row.render_attempt, 1);
  const repOp = await operations["plate.sendBackForRepair"]({
    id: v2.id,
    gen: v2.gen,
    renderAttempt: 1,
    authored: claimed2.row.authored,
    sourceKey: claimed2.row.source_key,
    detail: "Frame 0 failed to draw"
  });
  assert.equal(repOp.applied, true);

  const v2Repairing = await store.getVariant(v2.id);
  assert.equal(v2Repairing.gen, 1, "control.ts renderAttempt repair keeps gen");
  assert.equal(v2Repairing.rev, 1, "control.ts renderAttempt repair bumps rev by 1");
  assert.equal(v2Repairing.repairs, 1);

  modelReplies.push(makeSceneCode("#ccddee", "p2-repaired"));
  await handleAuthor(fakeJob(v2.id, v2Repairing.gen));

  const p2BytesAfter = await getObject("uploads", frozen2Scene0.bundleKey);
  assert.equal(Buffer.compare(p2BytesAfter, p2BytesBefore), 0, "frozen2 bundleKey bytes unchanged after renderAttempt repair");
  assert.equal(verifyBundleDigest(p2BytesAfter.toString("utf8"), frozen2Scene0, frozen2.manifest).ok, true);
  const revs2 = await store.listRevisions(v2.id);
  assert.equal(revs2.length, 2, "both rev 0 and rev 1 exist after renderAttempt repair");

  // --- 4. Same-bytes key reuse and different-bytes refusal (putContentAddressedObject)
  const { putContentAddressedObject } = await import("../src/plates/author.ts");
  const testCaKey = `plates/${projectId}/16x9/0/g1/bundles/ca0000000000000000000001/bundle.html`;
  const firstWrite = await putContentAddressedObject("uploads", testCaKey, "<!doctype html><title>v1</title>", "text/html");
  assert.equal(firstWrite.reused, false);
  const putsAfterFirst = (s3PutHistory.get(`test-uploads/${testCaKey}`) ?? []).length;
  assert.equal(putsAfterFirst, 1);

  const reuseWrite = await putContentAddressedObject("uploads", testCaKey, "<!doctype html><title>v1</title>", "text/html");
  assert.equal(reuseWrite.reused, true, "same bytes reuses existing key without re-uploading");
  assert.equal((s3PutHistory.get(`test-uploads/${testCaKey}`) ?? []).length, 1, "PUT count unchanged on same-bytes reuse");

  await assert.rejects(
    () => putContentAddressedObject("uploads", testCaKey, "<!doctype html><title>v2-different</title>", "text/html"),
    (err) => {
      assert.equal(err.code, "content_address_collision");
      assert.match(err.message, /Refusing to overwrite/);
      return true;
    },
    "different bytes under existing content-addressed key is refused"
  );
  const intactBytes = await getObject("uploads", testCaKey);
  assert.equal(intactBytes.toString("utf8"), "<!doctype html><title>v1</title>", "existing bytes untouched after collision refusal");

  console.log("plate bundle immutable: ok");
} finally {
  config.plates.live = false;
  await pool.query("delete from app.plate_exports where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await pool.query("delete from app.projects where id = any($1)", [projects]);
  await pool.query("delete from pgboss.job where name like 'plate-%'");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolve) => server.close(resolve));
}
