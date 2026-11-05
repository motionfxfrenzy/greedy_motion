// Phase 5 backend integration test: frozen export manifest (schema 2), content-addressed immutability,
// waitForAuthoring (bounded wait & failure naming the scene), clip cache control operations (clip.lookup &
// clip.record fenced by attempt & idempotent), plate.drawn caching, and plate.sendBackForRepair repair revisions.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-export-manifest.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_unit|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

// Start a hermetic in-process S3 server bound to 127.0.0.1 so storage.ts putObject/getObject/objectSize work offline
const s3Store = new Map();
const s3PutCounts = new Map();
const s3Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
    s3PutCounts.set(key, (s3PutCounts.get(key) ?? 0) + 1);
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
await new Promise((resolve) => s3Server.listen(0, "127.0.0.1", resolve));
const s3Port = s3Server.address().port;
process.env.STORAGE_DRIVER = "r2";
process.env.R2_ENDPOINT = `http://127.0.0.1:${s3Port}`;
process.env.R2_FORCE_PATH_STYLE = "1";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_UPLOADS_BUCKET = "test-uploads";
process.env.R2_OUTPUTS_BUCKET = "test-outputs";

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { operations } = await import("../src/jobs/control.ts");
const { planAudioDir } = await import("../src/plan/audio.ts");
const { getObject } = await import("../src/storage.ts");
const { bundleDigest, canonicalJson, fontSetDigest, paramsDigest } = await import("../src/plates/digest.ts");
const { buildExport, NotDrawn, requestExport, waitForAuthoring } = await import("../src/plates/exports.ts");
const store = await import("../src/plates/store.ts");

await migrate();
await startQueues();

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

const projectId = randomUUID();
const authWaitProjectId = randomUUID();
const authFailProjectId = randomUUID();
const clipFenceProjectId = randomUUID();
const projects = [projectId, authWaitProjectId, authFailProjectId, clipFenceProjectId];

function makeProject(id, beatsCount = 2) {
  const beats = Array.from({ length: beatsCount }, (_, i) => ({
    id: `b${i + 1}`,
    keyword: i === 0 ? "Fox" : "Lantern",
    visual: `Scene ${i + 1} visual`,
    onScreen: `Scene ${i + 1}`,
    line: `Narration line for scene ${i + 1}.`
  }));
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Manifest Test Film",
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
      aspects: ["16:9", "9:16"],
      captions: "full",
      scriptBeats: beats
    },
    beatPlan: {
      target_duration_s: beatsCount * 3,
      canvas: { width: 1920, height: 1080, fps: 30 },
      beats: beats.map((b, i) => ({
        id: b.id,
        role: i === 0 ? "hook" : "cta",
        kind: "plate",
        producer: "plates",
        keyword: b.keyword,
        visual: b.visual,
        line: b.line
      }))
    },
    planAudio: {
      voice: {
        voiceId: "v1",
        lines: beats.map((b, i) => ({
          beat: b.id,
          text: b.line,
          seconds: 2.5,
          file: `voice-${i}.wav`
        }))
      },
      music: {
        file: "music.mp3",
        seconds: 6.0
      }
    }
  };
}

try {
  config.plates.live = true;
  config.plates.liveForceOff = false;

  // Stage fake voice and music files in the project's planAudioDir
  const audioDir = planAudioDir(projectId);
  await mkdir(audioDir, { recursive: true });
  const voice0Bytes = Buffer.from("RIFF-voice-scene-0-bytes");
  const voice1Bytes = Buffer.from("RIFF-voice-scene-1-bytes");
  const musicBytes = Buffer.from("ID3-music-bed-bytes");
  await writeFile(join(audioDir, "voice-0.wav"), voice0Bytes);
  await writeFile(join(audioDir, "voice-1.wav"), voice1Bytes);
  await writeFile(join(audioDir, "music.mp3"), musicBytes);

  const project = makeProject(projectId, 2);
  const desired = [0, 1].map((index) => ({
    index,
    aspect: "16:9",
    signature: `v3:mf-${index}`,
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: index === 0 ? "Fox" : "Lantern"
  }));
  await store.reconcileVariants(projectId, desired, { scenes: 2 });
  const vars = await store.listVariants(projectId);

  // Author and bundle both variants (live mode: state='bundled', clip_key=null, 0 plate-render jobs)
  for (const v of vars) {
    const owner = store.newOwner();
    await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    await store.commitBundle(v, owner, {
      sourceKey: `plates/${projectId}/16x9/${v.scene_index}/g1/source.ts`,
      bundleKey: `plates/${projectId}/16x9/${v.scene_index}/g1/bundle.html`,
      manifest: {
        bundleSha: `bsha0000000000000000000${v.scene_index}`,
        engineDigest: "eng-v5-test",
        frames: 90
      },
      timings: { bundleMs: 10 }
    });
  }
  await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export')");

  // --- 1. Freeze schema 2 manifest on live variants (even with clip_key = null!)
  const built1 = await buildExport(project, "16:9", true);
  const m1 = built1.manifest;
  assert.equal(m1.schema, 2, "manifest schema is 2");
  assert.equal(m1.projectId, projectId);
  assert.equal(m1.aspect, "16:9");
  assert.equal(m1.width, 1920);
  assert.equal(m1.height, 1080);
  assert.equal(m1.fps, 30);
  assert.equal(m1.totalFrames, 180);
  assert.equal(m1.watermark, true);
  assert.equal(m1.engineDigest, "eng-v5-test");
  assert.equal(m1.fontSetDigest, fontSetDigest());
  assert.equal(m1.signature, built1.signature);
  assert.deepEqual(m1.timing, { frames: [90, 90], starts: [0, 90], totalFrames: 180 });
  assert.equal(m1.scenes.length, 2);

  // Check frozen scene fields and audio digests
  const updatedVars = await store.listVariants(projectId);
  for (let i = 0; i < 2; i++) {
    const s = m1.scenes[i];
    const v = updatedVars[i];
    assert.equal(s.index, i);
    assert.equal(s.variantId, v.id);
    assert.equal(s.gen, 1);
    assert.equal(s.rev, 0);
    assert.equal(s.bundleKey, `plates/${projectId}/16x9/${i}/g1/bundle.html`);
    assert.equal(s.bundleSha, `bsha0000000000000000000${i}`);
    assert.deepEqual(s.params, {});
    assert.equal(s.paramsDigest, paramsDigest({}));
    assert.equal(s.bundleDigest, v.bundle_digest);
    assert.equal(
      s.bundleDigest,
      bundleDigest({
        bundleSha: s.bundleSha,
        params: s.params,
        engineDigest: m1.engineDigest,
        fontSetDigest: m1.fontSetDigest
      })
    );
    assert.equal(s.frames, 90);
    assert.equal(s.startFrame, i * 90);
    assert.ok(s.voice?.key.startsWith(`plates/${projectId}/audio/`));
    assert.equal(s.voice?.digest, sha256Hex(i === 0 ? voice0Bytes : voice1Bytes), `scene ${i} voice digest matches audio bytes`);
  }
  assert.ok(m1.music?.key.startsWith(`plates/${projectId}/audio/`));
  assert.equal(m1.music?.digest, sha256Hex(musicBytes), "music digest matches music bytes");

  // Content-addressed key equals sha256(canonicalJson(manifest))
  const expectedManifestHash = sha256Hex(canonicalJson(m1));
  assert.equal(built1.manifestDigest, expectedManifestHash);
  assert.equal(built1.manifestKey, `plates/${projectId}/manifests/${expectedManifestHash}/manifest.json`);

  const storedManifestBytes = await getObject("uploads", built1.manifestKey);
  assert.ok(storedManifestBytes, "manifest object stored in uploads bucket");
  assert.equal(sha256Hex(storedManifestBytes), expectedManifestHash, "stored manifest bytes match content-addressed hash");

  // Calling buildExport again with unchanged state returns the exact same content-addressed key and does not re-upload/mutate
  const putsBeforeRepeat = s3PutCounts.get(`test-uploads/${built1.manifestKey}`) ?? 0;
  assert.equal(putsBeforeRepeat, 1, "manifest uploaded once on first buildExport");
  const built1Repeat = await buildExport(project, "16:9", true);
  assert.equal(built1Repeat.manifestKey, built1.manifestKey);
  assert.equal(built1Repeat.signature, built1.signature);
  assert.equal(s3PutCounts.get(`test-uploads/${built1.manifestKey}`), 1, "already-stored manifest is never mutated or overwritten");

  // Revising scene 0 produces a NEW content-addressed manifest while leaving the first manifest immutable in storage
  await store.submitCheckReport(updatedVars[0].id, {
    gen: updatedVars[0].gen,
    bundleDigest: updatedVars[0].bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  await store.reviseScene(projectId, 0, "- at 1.0 s: warmer lantern");
  const v0Rev1 = await store.getVariant(updatedVars[0].id);
  const ownerRev1 = store.newOwner();
  await store.claimAuthor(v0Rev1.id, v0Rev1.gen, ownerRev1, 60, 10);
  await store.commitBundle(v0Rev1, ownerRev1, {
    sourceKey: `plates/${projectId}/16x9/0/g2/source.ts`,
    bundleKey: `plates/${projectId}/16x9/0/g2/bundle.html`,
    manifest: {
      bundleSha: "bsha_rev1_00000000000000",
      engineDigest: "eng-v5-test",
      frames: 90
    },
    params: { lantern: "#ffaa00" },
    timings: {}
  });

  const built2 = await buildExport(project, "16:9", true);
  assert.notEqual(built2.manifestKey, built1.manifestKey, "revised scene produces a new content-addressed manifest key");
  assert.notEqual(built2.signature, built1.signature, "revised scene produces a new film signature");
  assert.equal(built2.manifest.scenes[0].gen, 2);
  assert.equal(built2.manifest.scenes[0].rev, 1);
  assert.deepEqual(built2.manifest.scenes[0].params, { lantern: "#ffaa00" });
  assert.equal(built2.manifest.scenes[0].paramsDigest, paramsDigest({ lantern: "#ffaa00" }));

  // First manifest in storage is still byte-for-byte identical to when it was frozen
  const firstManifestStillIntact = await getObject("uploads", built1.manifestKey);
  assert.equal(sha256Hex(firstManifestStillIntact), expectedManifestHash, "first manifest is immutable after subsequent revision");

  // requestExport does NOT enqueue any plate-render jobs
  await pool.query("delete from pgboss.job where name in ('plate-render', 'plate-export')");
  const expRow = await requestExport(project, "16:9", true);
  assert.equal(expRow.manifest_key, built2.manifestKey);
  const plateRenderJobsCount = Number(
    (await pool.query("select count(*) as n from pgboss.job where name = 'plate-render'")).rows[0].n
  );
  assert.equal(plateRenderJobsCount, 0, "requestExport enqueues 0 plate-render jobs");

  // --- 2. waitForAuthoring: waits while authoring is in progress, and fails naming the scene when authoring fails
  await store.reconcileVariants(
    authWaitProjectId,
    [0, 1].map((index) => ({
      index,
      aspect: "16:9",
      signature: `v3:wait-${index}`,
      frames: 90,
      width: 1920,
      height: 1080,
      keyword: index === 0 ? "Opening" : "Closing"
    })),
    { scenes: 2 }
  );
  const waitVars = await store.listVariants(authWaitProjectId);
  const progressEvents = [];

  // Bundle scene 0 now and scene 1 after 120ms while waitForAuthoring is polling
  setTimeout(async () => {
    for (const v of waitVars) {
      const ow = store.newOwner();
      await store.claimAuthor(v.id, v.gen, ow, 60, 10);
      await store.commitBundle(v, ow, {
        sourceKey: `plates/${authWaitProjectId}/16x9/${v.scene_index}/g1/source.ts`,
        bundleKey: `plates/${authWaitProjectId}/16x9/${v.scene_index}/g1/bundle.html`,
        manifest: { bundleSha: `waitsha0000000000000000${v.scene_index}`, engineDigest: "eng-w" },
        timings: {}
      });
    }
  }, 80);

  const waitedRows = await waitForAuthoring(authWaitProjectId, "16:9", {
    pollMs: 40,
    timeoutMs: 5000,
    expectedScenes: 2,
    onProgress: (info) => progressEvents.push(info)
  });
  assert.equal(waitedRows.length, 2);
  assert.ok(waitedRows.every((r) => Boolean(r.bundle_key)), "waitForAuthoring resolves once all scenes have bundles");
  assert.ok(progressEvents.length >= 1, "waitForAuthoring emits progress events while waiting");

  // Authoring failure / exhausted repair budget throws NotDrawn naming the scene
  await store.reconcileVariants(
    authFailProjectId,
    [0, 1].map((index) => ({
      index,
      aspect: "16:9",
      signature: `v3:fail-${index}`,
      frames: 90,
      width: 1920,
      height: 1080,
      keyword: index === 0 ? "Harbour" : "Lighthouse"
    })),
    { scenes: 2 }
  );
  const failVars = await store.listVariants(authFailProjectId);
  await store.failVariant(failVars[1].id, failVars[1].gen, null, {
    code: "author_exhausted",
    message: "This scene could not be drawn after 3 attempts. Press Draw to try again."
  });

  await assert.rejects(
    () => waitForAuthoring(authFailProjectId, "16:9", { pollMs: 20, timeoutMs: 1000, expectedScenes: 2 }),
    (err) => {
      assert.ok(err instanceof NotDrawn);
      assert.equal(err.state, "failed");
      assert.equal(err.code, "author_exhausted");
      assert.equal(err.sceneIndex, 1);
      assert.match(err.message, /Scene 2 \(Lighthouse\)/, "error message names the failed scene");
      return true;
    }
  );

  // --- 3. Clip cache control operations (clip.lookup & clip.record): fenced by attempt & idempotent
  const renderJobId = randomUUID();
  await pool.query(
    `insert into app.render_jobs (id, project_id, state, stage, progress, attempt, request, revision, render_input)
     values ($1, $2, 'rendering', 'frames', 60, 2, '{}', '{}', '{}')`,
    [renderJobId, clipFenceProjectId]
  );

  const testDigest = sha256Hex("clip-cache-test-digest-1");
  const testEngine = "eng-v5-test";
  const testFont = fontSetDigest();

  // Stale attempt 1 is fenced out and cannot record a clip
  const staleRec = await operations["clip.record"]({
    jobId: renderJobId,
    attempt: 1,
    bundleDigest: testDigest,
    engineDigest: testEngine,
    fontSetDigest: testFont,
    size: "1920x1080",
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 90,
    clipKey: `plates/${clipFenceProjectId}/clips/stale-a1.mp4`,
    stillKey: null,
    clipMeta: { attempt: 1 }
  });
  assert.deepEqual(staleRec, { ok: false, fenced: true }, "stale attempt 1 is fenced out of clip.record");

  const missLookup = await operations["clip.lookup"]({
    bundleDigest: testDigest,
    engineDigest: testEngine,
    fontSetDigest: testFont,
    size: "1920x1080"
  });
  assert.equal(missLookup.clip, null, "no clip recorded by stale attempt");

  // Current attempt 2 records the clip
  const validRec1 = await operations["clip.record"]({
    jobId: renderJobId,
    attempt: 2,
    bundleDigest: testDigest,
    engineDigest: testEngine,
    fontSetDigest: testFont,
    size: "1920x1080",
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 90,
    clipKey: `plates/${clipFenceProjectId}/clips/valid-a2.mp4`,
    stillKey: `plates/${clipFenceProjectId}/clips/valid-a2.png`,
    clipMeta: { attempt: 2, renderer: "SwiftShader" }
  });
  assert.equal(validRec1.ok, true);
  assert.equal(validRec1.duplicate, false);
  assert.equal(validRec1.clip.clip_key, `plates/${clipFenceProjectId}/clips/valid-a2.mp4`);

  // Duplicate call from attempt 2 is idempotent and keeps the first clip_key
  const validRec2 = await operations["clip.record"]({
    jobId: renderJobId,
    attempt: 2,
    bundleDigest: testDigest,
    engineDigest: testEngine,
    fontSetDigest: testFont,
    size: "1920x1080",
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 90,
    clipKey: `plates/${clipFenceProjectId}/clips/other-a2.mp4`,
    stillKey: null,
    clipMeta: { attempt: 2 }
  });
  assert.equal(validRec2.ok, true);
  assert.equal(validRec2.duplicate, true);
  assert.equal(validRec2.clip.clip_key, `plates/${clipFenceProjectId}/clips/valid-a2.mp4`, "existing content-addressed clip_key is preserved");

  // Batch lookup finds the hit and skips different size/engine/font digests
  const batchLookup = await operations["clip.lookup"]({
    keys: [
      { bundleDigest: testDigest, engineDigest: testEngine, fontSetDigest: testFont, size: "1920x1080" },
      { bundleDigest: testDigest, engineDigest: testEngine, fontSetDigest: testFont, size: "1080x1920" },
      { bundleDigest: testDigest, engineDigest: "other-engine", fontSetDigest: testFont, size: "1920x1080" }
    ]
  });
  assert.equal(batchLookup.clips.length, 1);
  assert.equal(batchLookup.clips[0].clip_key, `plates/${clipFenceProjectId}/clips/valid-a2.mp4`);

  // --- 4. plate.drawn writes preview fallback clips to app.plate_clips as well
  const v1 = updatedVars[1];
  const claimV1 = await operations["plate.claim"]({ variantId: v1.id, gen: v1.gen });
  assert.equal(claimV1.row.state, "rendering");
  const drawnV1 = await operations["plate.drawn"]({
    id: v1.id,
    gen: v1.gen,
    renderAttempt: claimV1.row.render_attempt,
    clipKey: `plates/${projectId}/16x9/1/g1/clip-a1.mp4`,
    stillKey: `plates/${projectId}/16x9/1/g1/still-a1.png`,
    clipMeta: { frames: 90, width: 1920, height: 1080 },
    timings: {}
  });
  assert.equal(drawnV1.ok, true);

  const previewCachedLookup = await operations["clip.lookup"]({
    bundleDigest: v1.bundle_digest,
    engineDigest: "eng-v5-test",
    fontSetDigest: fontSetDigest(),
    size: "1920x1080"
  });
  assert.ok(previewCachedLookup.clip, "plate.drawn populates app.plate_clips for preview-rendered clips");
  assert.equal(previewCachedLookup.clip.clip_key, `plates/${projectId}/16x9/1/g1/clip-a1.mp4`);

  // --- 5. plate.sendBackForRepair from manifest verification (no renderAttempt) creates a repair revision
  const v0Latest = await store.getVariant(updatedVars[0].id);
  await store.submitCheckReport(v0Latest.id, {
    gen: v0Latest.gen,
    bundleDigest: v0Latest.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal((await store.getVariant(v0Latest.id)).state, "checked");
  const prevRev = v0Latest.rev;

  const repairFromManifest = await operations["plate.sendBackForRepair"]({
    id: v0Latest.id,
    gen: v0Latest.gen,
    detail: "DETERMINISM FAILURE: frame 0 differed across draws"
  });
  assert.equal(repairFromManifest.applied, true);
  assert.equal(repairFromManifest.exhausted, false);
  assert.equal(repairFromManifest.rev, prevRev + 1, "manifest verification failure bumps rev for repair revision");

  const v0Repairing = await store.getVariant(v0Latest.id);
  assert.equal(v0Repairing.state, "queued");
  assert.equal(v0Repairing.stage, "repairing");
  assert.equal(v0Repairing.rev, prevRev + 1);
  assert.equal(v0Repairing.repairs, 1);

  console.log("plate export manifest: ok");
} finally {
  config.plates.live = false;
  await rm(planAudioDir(projectId), { recursive: true, force: true }).catch(() => undefined);
  await pool.query("delete from app.plate_clips");
  await pool.query("delete from app.render_jobs where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_exports where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [projects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [projects]);
  await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export', 'render-plan', 'render-video', 'render-finished')");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolve) => s3Server.close(resolve));
}
