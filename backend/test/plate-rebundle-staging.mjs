// Step 2: Staging opt-in guard, production forbid-list, roll-out dry-run counts,
// cursor batching (--limit / --after), --max-in-flight, read-only --status, and --rollback-last tests.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle_test_staging PLANNER=deterministic node --experimental-strip-types test/plate-rebundle-staging.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { bundleScene, engineDigest } from "@videosaas/plate-engine";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_rebundle/.test(process.env.DATABASE_URL ?? "") || !/test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database whose name contains both plates_rebundle and test.");
}

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

// Hermetic in-process S3 mock server bound to 127.0.0.1
const s3Store = new Map();
const server = createServer(async (req, res) => {
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
    res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
    res.end();
    return;
  }
  if (req.method === "GET") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end(entry.bytes);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolveListen) => server.listen(0, "0.0.0.0", resolveListen));
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
const store = await import("../src/plates/store.ts");
const rebundleMod = await import("../src/plates/rebundle.ts");
const cliMod = await import("../src/scripts/rebundle-plates.ts");
const { engineBundleSha, handlePlateRebundle } = await import("../../worker/src/plates.mjs");

await migrate();
await startQueues();

const projectId = randomUUID();
const workerProjectId = randomUUID();
const legacyProjectId = randomUUID();
const projects = [projectId, workerProjectId, legacyProjectId];

const sceneCode = [
  'import { Ctx, Env } from "./core";',
  'import { Film } from "./film";',
  "const W = 1920, H = 1080, durationFrames = 60;",
  "const draw = (ctx: Ctx, frame: number, env: Env): void => {",
  "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
  '  ctx.fillStyle = "#fff8ee";',
  "  ctx.fillRect(0, 0, W, H);",
  "};",
  'export const film: Film = { meta: { title: "staging-test", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };'
].join("\n");

function makeProjectRecord(id, beatsCount = 4) {
  const beats = Array.from({ length: beatsCount }, (_, i) => ({
    id: `b${i + 1}`,
    keyword: `Scene${i}`,
    visual: `Visual ${i}`,
    onScreen: `Scene ${i}`,
    line: `Line ${i}.`
  }));
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Staging Rebundle Test",
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

  const {
    enforceLocalSafetyGuard,
    enforceStagingOptIn,
    parseCliArgs
  } = cliMod;

  assert.equal(typeof enforceStagingOptIn, "function", "enforceStagingOptIn must be exported from rebundle-plates.ts");

  // =========================================================================
  // 1. Local safety guard remains byte-for-byte unchanged
  // =========================================================================
  assert.throws(
    () => enforceLocalSafetyGuard({ APP_ENV: "staging", DATABASE_URL: "postgres://u:p@localhost:55432/db" }),
    /Refusing to run rebundle-plates: APP_ENV must be "local" \(got "staging"\)\./
  );
  assert.throws(
    () => enforceLocalSafetyGuard({ APP_ENV: "local", DATABASE_URL: "postgres://u:p@db.staging.example.com:5432/db" }),
    /Refusing to run rebundle-plates: DATABASE_URL host must be "localhost" or "127\.0\.0\.1" \(got "db\.staging\.example\.com"\)\./
  );
  enforceLocalSafetyGuard({
    APP_ENV: "local",
    DATABASE_URL: "postgres://u:p@127.0.0.1:55432/db",
    R2_ENDPOINT: `http://127.0.0.1:${port}`
  });

  // =========================================================================
  // 2. Staging opt-in guard & production forbid-list
  // =========================================================================
  const validStagingEnv = {
    APP_ENV: "staging",
    DATABASE_URL: "postgres://postgres.ltaxhznuixoslbbcjkts:Sup3rS3cretPass!@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    R2_UPLOADS_BUCKET: "greedymotion-staging-uploads",
    R2_OUTPUTS_BUCKET: "greedymotion-staging-outputs",
    REBUNDLE_STAGING_OPT_IN: "I-understand-this-is-staging",
    REBUNDLE_EXPECT_DB_HOST: "aws-0-ap-southeast-1.pooler.supabase.com",
    REBUNDLE_EXPECT_R2_BUCKET: "greedymotion-staging-uploads",
    REBUNDLE_FORBID_DB_HOST: "db.bwwquxhexwyodsavsjar.supabase.co",
    REBUNDLE_FORBID_R2_BUCKET: "greedymotion-production-uploads"
  };

  // Full opt-in with worker mode succeeds
  enforceStagingOptIn(validStagingEnv, { mode: "worker" });

  // Refuses production, empty, and unknown APP_ENV values
  for (const badEnv of ["production", "", undefined, "unknown", "prod", "local"]) {
    assert.throws(
      () => enforceStagingOptIn({ ...validStagingEnv, APP_ENV: badEnv }, { mode: "worker" }),
      /APP_ENV must be "staging"/,
      `enforceStagingOptIn must refuse APP_ENV=${JSON.stringify(badEnv)}`
    );
  }

  // Refuses missing or wrong REBUNDLE_STAGING_OPT_IN
  for (const badOptIn of ["", undefined, "true", "1", "yes", "i-understand-this-is-staging"]) {
    assert.throws(
      () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_STAGING_OPT_IN: badOptIn }, { mode: "worker" }),
      /REBUNDLE_STAGING_OPT_IN/,
      `enforceStagingOptIn must refuse REBUNDLE_STAGING_OPT_IN=${JSON.stringify(badOptIn)}`
    );
  }

  // Refuses missing or mismatching REBUNDLE_EXPECT_DB_HOST
  assert.throws(
    () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_EXPECT_DB_HOST: "" }, { mode: "worker" }),
    /REBUNDLE_EXPECT_DB_HOST/
  );
  assert.throws(
    () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_EXPECT_DB_HOST: "wrong-host.supabase.co" }, { mode: "worker" }),
    /REBUNDLE_EXPECT_DB_HOST/
  );

  // Refuses missing or mismatching REBUNDLE_EXPECT_R2_BUCKET
  assert.throws(
    () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_EXPECT_R2_BUCKET: "" }, { mode: "worker" }),
    /REBUNDLE_EXPECT_R2_BUCKET/
  );
  assert.throws(
    () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_EXPECT_R2_BUCKET: "other-staging-bucket" }, { mode: "worker" }),
    /REBUNDLE_EXPECT_R2_BUCKET/
  );

  // Refuses in-process mode on staging
  assert.throws(
    () => enforceStagingOptIn(validStagingEnv, { mode: "in-process" }),
    /--mode worker/
  );

  // Refuses missing REBUNDLE_FORBID_DB_HOST or REBUNDLE_FORBID_R2_BUCKET on write paths
  assert.throws(
    () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_FORBID_DB_HOST: "" }, { mode: "worker" }),
    /REBUNDLE_FORBID_DB_HOST/
  );
  assert.throws(
    () => enforceStagingOptIn({ ...validStagingEnv, REBUNDLE_FORBID_R2_BUCKET: "" }, { mode: "worker" }),
    /REBUNDLE_FORBID_R2_BUCKET/
  );

  // Refuses when DB host equals REBUNDLE_FORBID_DB_HOST even when REBUNDLE_EXPECT_DB_HOST matches
  assert.throws(
    () =>
      enforceStagingOptIn(
        {
          ...validStagingEnv,
          DATABASE_URL: "postgres://u:p@custom-db-host.example.com:5432/postgres",
          REBUNDLE_EXPECT_DB_HOST: "custom-db-host.example.com",
          REBUNDLE_FORBID_DB_HOST: "custom-db-host.example.com"
        },
        { mode: "worker" }
      ),
    /forbidden|REBUNDLE_FORBID_DB_HOST/i
  );

  // Refuses when R2 bucket equals REBUNDLE_FORBID_R2_BUCKET even when REBUNDLE_EXPECT_R2_BUCKET matches
  assert.throws(
    () =>
      enforceStagingOptIn(
        {
          ...validStagingEnv,
          R2_UPLOADS_BUCKET: "custom-bucket-uploads",
          REBUNDLE_EXPECT_R2_BUCKET: "custom-bucket-uploads",
          REBUNDLE_FORBID_R2_BUCKET: "custom-bucket-uploads"
        },
        { mode: "worker" }
      ),
    /forbidden|REBUNDLE_FORBID_R2_BUCKET/i
  );

  // Refuses production-looking host or bucket from checked-in forbid list even when all opt-in vars otherwise match
  assert.throws(
    () =>
      enforceStagingOptIn(
        {
          ...validStagingEnv,
          DATABASE_URL: "postgres://u:p@db.bwwquxhexwyodsavsjar.supabase.co:5432/postgres",
          REBUNDLE_EXPECT_DB_HOST: "db.bwwquxhexwyodsavsjar.supabase.co",
          REBUNDLE_FORBID_DB_HOST: "other.example.com"
        },
        { mode: "worker" }
      ),
    /forbidden|production/i
  );
  assert.throws(
    () =>
      enforceStagingOptIn(
        {
          ...validStagingEnv,
          R2_UPLOADS_BUCKET: "greedymotion-production-uploads",
          REBUNDLE_EXPECT_R2_BUCKET: "greedymotion-production-uploads",
          REBUNDLE_FORBID_R2_BUCKET: "other-bucket"
        },
        { mode: "worker" }
      ),
    /forbidden|production/i
  );

  // =========================================================================
  // 3. CLI arg parsing for new flags (--sample, --after, --max-in-flight, --status, --rollback-last)
  // =========================================================================
  const parsedBatch = parseCliArgs([
    "--apply",
    "--mode",
    "worker",
    "--limit",
    "10",
    "--after",
    "11111111-2222-4333-8444-555555555555",
    "--max-in-flight",
    "3",
    "--sample",
    "7"
  ]);
  assert.equal(parsedBatch.apply, true);
  assert.equal(parsedBatch.mode, "worker");
  assert.equal(parsedBatch.limit, 10);
  assert.equal(parsedBatch.after, "11111111-2222-4333-8444-555555555555");
  assert.equal(parsedBatch.maxInFlight, 3);
  assert.equal(parsedBatch.sample, 7);

  const parsedDefaults = parseCliArgs([]);
  assert.equal(parsedDefaults.sample, 5, "--sample defaults to 5");
  assert.equal(parsedDefaults.maxInFlight, 5, "--max-in-flight defaults to 5");

  const parsedStatus = parseCliArgs(["--status", "45"]);
  assert.equal(parsedStatus.status, true);
  assert.equal(parsedStatus.statusMinutes, 45);

  const parsedRbLast = parseCliArgs(["--rollback-last", "3", "--mode", "worker"]);
  assert.equal(parsedRbLast.rollbackLast, 3);
  assert.equal(parsedRbLast.mode, "worker");

  // =========================================================================
  // 4. --rollback and --rollback-last CLI guard checks on staging and production
  // =========================================================================
  const runCliRaw = (cliArgs, envOverrides = {}) =>
    spawnSync(process.execPath, ["--experimental-strip-types", "src/scripts/rebundle-plates.ts", ...cliArgs], {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        ...envOverrides
      },
      encoding: "utf8"
    });

  for (const writeFlag of [
    ["--rollback", "all-engine-rebundle"],
    ["--rollback-last", "2"]
  ]) {
    // Refused without full staging opt-in
    const noOptIn = runCliRaw([...writeFlag, "--mode", "worker"], {
      ...validStagingEnv,
      REBUNDLE_STAGING_OPT_IN: ""
    });
    assert.notEqual(noOptIn.status, 0, `${writeFlag[0]} must fail without REBUNDLE_STAGING_OPT_IN`);
    assert.match(noOptIn.stderr, /REBUNDLE_STAGING_OPT_IN/);

    // Refused without --mode worker
    const noWorkerMode = runCliRaw(writeFlag, validStagingEnv);
    assert.notEqual(noWorkerMode.status, 0, `${writeFlag[0]} must fail in-process on staging`);
    assert.match(noWorkerMode.stderr, /--mode worker/);

    // Refused for forbidden DB host
    const forbidHost = runCliRaw([...writeFlag, "--mode", "worker"], {
      ...validStagingEnv,
      REBUNDLE_FORBID_DB_HOST: validStagingEnv.REBUNDLE_EXPECT_DB_HOST
    });
    assert.notEqual(forbidHost.status, 0, `${writeFlag[0]} must fail when DB host is forbidden`);
    assert.match(forbidHost.stderr, /forbidden|REBUNDLE_FORBID_DB_HOST/i);

    // Refused for forbidden R2 bucket
    const forbidBucket = runCliRaw([...writeFlag, "--mode", "worker"], {
      ...validStagingEnv,
      REBUNDLE_FORBID_R2_BUCKET: validStagingEnv.REBUNDLE_EXPECT_R2_BUCKET
    });
    assert.notEqual(forbidBucket.status, 0, `${writeFlag[0]} must fail when R2 bucket is forbidden`);
    assert.match(forbidBucket.stderr, /forbidden|REBUNDLE_FORBID_R2_BUCKET/i);

    // Refused when APP_ENV=production
    const prodRun = runCliRaw([...writeFlag, "--mode", "worker"], {
      ...validStagingEnv,
      APP_ENV: "production"
    });
    assert.notEqual(prodRun.status, 0, `${writeFlag[0]} must fail when APP_ENV=production`);
  }

  // =========================================================================
  // 5. Seed projects and variants for dry-run, batching, max-in-flight, status, rollback-last
  // =========================================================================
  await pool.query("delete from pgboss.job where name = 'plate-rebundle'");

  for (const [pid, count] of [
    [projectId, 4],
    [workerProjectId, 4],
    [legacyProjectId, 2]
  ]) {
    const pData = makeProjectRecord(pid, count);
    await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
      pid,
      pData.ownerId,
      pData.name,
      pData.state,
      pData
    ]);
  }
  await pool.query(
    "insert into app.plate_state (project_id, scenes, legacy_scenes) values ($1, $2::jsonb, $2::jsonb)",
    [legacyProjectId, JSON.stringify([{ index: 0, keyword: "Legacy0" }])]
  );

  const compiled = await bundleScene({ look: "illus-fox", code: sceneCode, frames: 60, aspect: "16:9" });
  const oldEngineDigestA = "06400000000000000000064a";
  const oldEngineDigestB = "06400000000000000000064b";

  async function seedProjectVariants(pid, digests, bundleSizes) {
    await store.reconcileVariants(
      pid,
      digests.map((_, index) => ({
        index,
        aspect: "16:9",
        signature: `v3:st-${pid.slice(0, 6)}-${index}`,
        frames: 60,
        width: 1920,
        height: 1080,
        keyword: `Scene${index}`
      })),
      { scenes: digests.length }
    );
    const vars = await store.listVariants(pid);
    for (const [idx, v] of vars.entries()) {
      const prefix = store.prefixOf(v);
      const oldHtml = compiled.html + `<!-- old-${pid}-${idx} -->`;
      const oldManifest = {
        ...compiled.manifest,
        engineVersion: "0.6.4",
        engineDigest: digests[idx],
        bundleSha: engineBundleSha(oldHtml),
        bundleBytes: bundleSizes[idx]
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
      const b = await store.getVariant(v.id);
      if (idx % 2 === 0) {
        await store.submitCheckReport(b.id, {
          gen: b.gen,
          bundleDigest: b.bundle_digest,
          host: "worker",
          results: { ok: true }
        });
      } else {
        await pool.query(
          "update app.plate_variants set state = 'drawn', stage = null, clip_key = $2, still_key = $3, drawn_at = now() where id = $1",
          [v.id, `${prefix}clip-a1.mp4`, `${prefix}still-a1.png`]
        );
      }
    }
    return store.listVariants(pid);
  }

  const pVars = await seedProjectVariants(
    projectId,
    [oldEngineDigestA, oldEngineDigestA, oldEngineDigestB, oldEngineDigestB],
    [10_000, 12_500, 15_000, 20_000]
  );
  const wVars = await seedProjectVariants(
    workerProjectId,
    [oldEngineDigestA, oldEngineDigestA, oldEngineDigestB, oldEngineDigestB],
    [8_000, 8_000, 8_000, 8_000]
  );

  // Create an in-flight export row on projectId so frozenManifestVariantCount / exportInFlightVariantCount are exercised
  const builtExport = await buildExport(makeProjectRecord(projectId, 4), "16:9", false);
  await pool.query(
    `insert into app.plate_exports (project_id, aspect, signature, state, manifest_key, duration_seconds)
     values ($1, '16:9', $2, 'assembling', $3, $4)`,
    [projectId, builtExport.signature, builtExport.manifestKey, builtExport.durationSeconds]
  );

  // =========================================================================
  // 6. Dry-run roll-out output & secret redaction test
  // =========================================================================
  const fakePassword = "superSecretDbPass_998877_DO_NOT_PRINT";
  const fakeAccessKey = "AKIA_FAKE_SECRET_KEY_112233";
  const fakeSecretKey = "r2_super_secret_token_445566";

  // Verify failed guard with fake URL prints neither password nor key
  const failedDrySecretCheck = runCliRaw(["--dry-run"], {
    APP_ENV: "local",
    DATABASE_URL: `postgres://admin:${fakePassword}@remote-db.example.com:5432/plates_rebundle_test`,
    R2_ENDPOINT: `https://user:${fakeSecretKey}@r2.example.com`,
    R2_ACCESS_KEY_ID: fakeAccessKey,
    R2_SECRET_ACCESS_KEY: fakeSecretKey
  });
  assert.notEqual(failedDrySecretCheck.status, 0);
  const combinedErrOut = `${failedDrySecretCheck.stdout}\n${failedDrySecretCheck.stderr}`;
  assert.ok(!combinedErrOut.includes(fakePassword), "error output must never contain DB password");
  assert.ok(!combinedErrOut.includes(fakeAccessKey), "error output must never contain R2 access key");
  assert.ok(!combinedErrOut.includes(fakeSecretKey), "error output must never contain R2 secret key");

  // Run dry-run CLI on projectId with --sample 2
  const dryCliRes = runCliRaw(["--dry-run", "--project", projectId, "--sample", "2"], {
    APP_ENV: "local",
    PLANNER: "deterministic",
    R2_ACCESS_KEY_ID: fakeAccessKey,
    R2_SECRET_ACCESS_KEY: fakeSecretKey
  });
  assert.equal(dryCliRes.status, 0, dryCliRes.stderr);
  const combinedDryOut = `${dryCliRes.stdout}\n${dryCliRes.stderr}`;
  assert.ok(!combinedDryOut.includes(fakeAccessKey), "dry-run output must not contain R2_ACCESS_KEY_ID");
  assert.ok(!combinedDryOut.includes(fakeSecretKey), "dry-run output must not contain R2_SECRET_ACCESS_KEY");
  assert.ok(!combinedDryOut.includes("videosaas:videosaas"), "dry-run output must not print raw DATABASE_URL credentials");

  const dryJsonLines = dryCliRes.stdout.trim().split("\n");
  const dryJson = JSON.parse(dryJsonLines.slice(dryJsonLines.findIndex((l) => l.startsWith("{"))).join("\n"));

  assert.equal(dryJson.action, "dry-run");
  assert.equal(dryJson.environment.dbHost, new URL(process.env.DATABASE_URL).hostname);
  assert.deepEqual(dryJson.countsByState, { checked: 2, drawn: 2 });
  assert.deepEqual(dryJson.staleCountsByState, { checked: 2, drawn: 2 });
  assert.deepEqual(dryJson.countsByEngineDigest, {
    [oldEngineDigestA]: 2,
    [oldEngineDigestB]: 2
  });
  assert.equal(dryJson.currentEngineDigest, engineDigest());
  assert.equal(dryJson.totalBytesToStage, 10_000 + 12_500 + 15_000 + 20_000);
  assert.equal(dryJson.frozenManifestVariantCount, 4);
  assert.equal(dryJson.exportInFlightVariantCount, 4);
  assert.deepEqual(dryJson.sampleCandidateIds, [pVars[0].id, pVars[1].id]);

  // =========================================================================
  // 7. Cursor batching (--limit / --after) resumes deterministically
  // =========================================================================
  const batch1 = await rebundleMod.rebundleStaleVariants({
    dryRun: false,
    projectId,
    limit: 2,
    verifier: async () => ({ ok: true })
  });
  assert.equal(batch1.committed, 2);
  assert.deepEqual(
    batch1.outcomes.map((o) => o.variantId),
    [pVars[0].id, pVars[1].id]
  );
  assert.equal(batch1.nextCursor, pVars[1].id);

  // Batch 2 using after: batch1.nextCursor
  const batch2 = await rebundleMod.rebundleStaleVariants({
    dryRun: false,
    projectId,
    limit: 2,
    after: batch1.nextCursor,
    verifier: async () => ({ ok: true })
  });
  assert.equal(batch2.committed, 2);
  assert.deepEqual(
    batch2.outcomes.map((o) => o.variantId),
    [pVars[2].id, pVars[3].id]
  );
  assert.equal(batch2.nextCursor, pVars[3].id);

  // Batch 3 after last variant finds 0 candidates
  const batch3 = await rebundleMod.rebundleStaleVariants({
    dryRun: false,
    projectId,
    limit: 2,
    after: batch2.nextCursor,
    verifier: async () => ({ ok: true })
  });
  assert.equal(batch3.scan.candidates.length, 0);
  assert.equal(batch3.committed, 0);

  // =========================================================================
  // 8. --max-in-flight stops enqueuing when N jobs are queued or active in pgboss.job
  // =========================================================================
  const wBatch1 = await rebundleMod.rebundleStaleVariants({
    dryRun: false,
    projectId: workerProjectId,
    mode: "worker",
    maxInFlight: 2
  });
  assert.equal(wBatch1.queuedWorker, 2, "must enqueue at most maxInFlight (2) worker jobs");
  assert.equal(wBatch1.stoppedByMaxInFlight, true, "must report stoppedByMaxInFlight=true when capped");
  assert.equal(wBatch1.nextCursor, wVars[1].id);

  // Calling again while 2 jobs are still queued in pgboss.job must enqueue 0 additional jobs
  const wBatchBlocked = await rebundleMod.rebundleStaleVariants({
    dryRun: false,
    projectId: workerProjectId,
    mode: "worker",
    after: wBatch1.nextCursor,
    maxInFlight: 2
  });
  assert.equal(wBatchBlocked.queuedWorker, 0, "must enqueue 0 jobs while 2 jobs are still in flight");
  assert.equal(wBatchBlocked.stoppedByMaxInFlight, true);

  // =========================================================================
  // 9. --status is strictly read-only (row counts unchanged) and reports job state, revision, activeBundleIsNew
  // =========================================================================
  const countSnapshot = async () => {
    const r = await pool.query(`
      select
        (select count(*)::int from app.plate_variants) as variants,
        (select count(*)::int from app.plate_revisions) as revisions,
        (select count(*)::int from app.plate_exports) as exports,
        (select count(*)::int from app.plate_garbage) as garbage,
        (select count(*)::int from pgboss.job where name = 'plate-rebundle') as jobs,
        (select max(updated_at)::text from app.plate_variants) as max_updated
    `);
    return r.rows[0];
  };

  const beforeStatusCounts = await countSnapshot();
  const statusReport = await rebundleMod.getRebundleStatus({ minutes: 60 });
  const afterStatusCounts = await countSnapshot();
  assert.deepEqual(afterStatusCounts, beforeStatusCounts, "getRebundleStatus must not modify any rows");

  // Also test --status via CLI subprocess
  const cliStatusRes = runCliRaw(["--status", "60"]);
  assert.equal(cliStatusRes.status, 0, cliStatusRes.stderr);
  const afterCliStatusCounts = await countSnapshot();
  assert.deepEqual(afterCliStatusCounts, beforeStatusCounts, "CLI --status must not modify any rows");

  // Verify status contents for committed projectId variants vs queued workerProjectId variants
  const statusById = new Map(statusReport.variants.map((v) => [v.variantId, v]));
  const stCommitted0 = statusById.get(pVars[0].id);
  assert.ok(stCommitted0, "committed variant appears in status report");
  assert.equal(stCommitted0.revision?.author, "engine-rebundle");
  assert.equal(stCommitted0.activeBundleIsNew, true);

  const stQueued0 = statusById.get(wVars[0].id);
  assert.ok(stQueued0, "staged worker variant appears in status report");
  assert.equal(stQueued0.jobState, "created");
  assert.equal(stQueued0.revision, null);
  assert.equal(stQueued0.activeBundleIsNew, false);

  // Drain the 2 queued worker jobs via handlePlateRebundle and complete them in pgboss
  const fetchedJobs = await boss.fetch("plate-rebundle", { batchSize: 2 });
  assert.equal(fetchedJobs.length, 2);
  for (const job of fetchedJobs) {
    const res = await handlePlateRebundle(
      { data: job.data, signal: new AbortController().signal },
      {
        control: { op: (name, args) => operations[name](args) },
        storageImpl: {
          downloadPlateInput: async (key, dest) => {
            const bytes = await getObject("uploads", key);
            writeFileSync(dest, bytes);
          }
        },
        engineImpl: {
          verifyScene: async () => ({ blocked: [] })
        }
      }
    );
    assert.equal(res.status, "committed");
    await boss.complete("plate-rebundle", job.id);
  }

  // Now in-flight count is 0, so the next worker batch after wVars[1].id can enqueue the remaining 2 variants
  const wBatch2 = await rebundleMod.rebundleStaleVariants({
    dryRun: false,
    projectId: workerProjectId,
    mode: "worker",
    after: wBatch1.nextCursor,
    maxInFlight: 2
  });
  assert.equal(wBatch2.queuedWorker, 2);
  assert.deepEqual(
    wBatch2.outcomes.map((o) => o.variantId),
    [wVars[2].id, wVars[3].id]
  );

  // =========================================================================
  // 10. --rollback-last <n> undoes only the n most recent engine-rebundle commits
  // =========================================================================
  // Ensure distinct created_at timestamps on the 4 engine-rebundle revisions of projectId
  for (let i = 0; i < 4; i++) {
    await pool.query(
      "update app.plate_revisions set created_at = now() - make_interval(secs => $2) where variant_id = $1 and rev = 1",
      [pVars[i].id, (4 - i) * 10]
    );
  }
  // pVars[3] and pVars[2] are the 2 most recent engine-rebundle commits on projectId
  const rbLastRes = await rebundleMod.rollbackLastRebundleCommits(2, { projectId });
  assert.equal(rbLastRes.rolledBack, 2);
  assert.deepEqual(
    rbLastRes.outcomes.map((o) => o.variantId),
    [pVars[3].id, pVars[2].id]
  );

  assert.equal((await store.getVariant(pVars[0].id)).rev, 1, "older commit pVars[0] stays at rev 1");
  assert.equal((await store.getVariant(pVars[1].id)).rev, 1, "older commit pVars[1] stays at rev 1");
  assert.equal((await store.getVariant(pVars[2].id)).rev, 0, "recent commit pVars[2] rolled back to rev 0");
  assert.equal((await store.getVariant(pVars[3].id)).rev, 0, "recent commit pVars[3] rolled back to rev 0");

  // Also test --rollback-last 1 via CLI subprocess (rolls back pVars[1])
  const cliRbLast1 = runCliRaw(["--rollback-last", "1", "--project", projectId]);
  assert.equal(cliRbLast1.status, 0, cliRbLast1.stderr);
  assert.equal((await store.getVariant(pVars[1].id)).rev, 0, "CLI --rollback-last 1 rolled back pVars[1]");
  assert.equal((await store.getVariant(pVars[0].id)).rev, 1, "pVars[0] remains at rev 1");

  // =========================================================================
  // 11. End-to-end CLI subprocess in APP_ENV=staging mode (dry-run, status, apply, rollback-last)
  // =========================================================================
  {
    const dbUrlObj = new URL(process.env.DATABASE_URL);
    dbUrlObj.hostname = "0.0.0.0";
    const stagingSubprocessEnv = {
      APP_ENV: "staging",
      DATABASE_URL: dbUrlObj.toString(),
      STORAGE_DRIVER: "r2",
      R2_ENDPOINT: `http://0.0.0.0:${port}`,
      R2_FORCE_PATH_STYLE: "1",
      R2_ACCESS_KEY_ID: fakeAccessKey,
      R2_SECRET_ACCESS_KEY: fakeSecretKey,
      R2_UPLOADS_BUCKET: "test-uploads",
      R2_OUTPUTS_BUCKET: "test-outputs",
      PLANNER: "anthropic",
      ANTHROPIC_API_KEY: "test-anthropic-key-unused",
      AUTH_MODE: "supabase",
      SUPABASE_URL: "https://ltaxhznuixoslbbcjkts.supabase.co",
      MEDIA_URL_SECRET: "staging-test-media-url-secret-at-least-32-chars"
    };

    const runCliAsync = (cliArgs, envOverrides = {}) =>
      new Promise((resolveProc, rejectProc) => {
        const child = spawn(process.execPath, ["--experimental-strip-types", "src/scripts/rebundle-plates.ts", ...cliArgs], {
          cwd: resolve(import.meta.dirname, ".."),
          env: {
            ...process.env,
            ...envOverrides
          }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString("utf8");
        });
        child.on("error", rejectProc);
        child.on("close", (code) => resolveProc({ status: code, stdout, stderr }));
      });

    // Read-only dry-run on staging succeeds without opt-in vars and prints no secrets
    const stDry = await runCliAsync(["--dry-run", "--project", projectId], stagingSubprocessEnv);
    assert.equal(stDry.status, 0, stDry.stderr);
    assert.ok(!stDry.stdout.includes(fakeAccessKey) && !stDry.stdout.includes(fakeSecretKey));
    const stDryJson = JSON.parse(
      stDry.stdout
        .trim()
        .split("\n")
        .slice(
          stDry.stdout
            .trim()
            .split("\n")
            .findIndex((l) => l.startsWith("{"))
        )
        .join("\n")
    );
    assert.equal(stDryJson.environment.appEnv, "staging");
    assert.equal(stDryJson.environment.dbHost, "0.0.0.0");
    assert.equal(stDryJson.environment.r2Bucket, "test-uploads");
    assert.equal(stDryJson.candidateCount, 3, "pVars[1], pVars[2], pVars[3] are stale after rollback");

    // Full staging opt-in --apply --limit 1 --mode worker
    await pool.query("delete from pgboss.job where name = 'plate-rebundle'");
    const stApply = await runCliAsync(["--apply", "--limit", "1", "--project", projectId, "--mode", "worker"], {
      ...stagingSubprocessEnv,
      REBUNDLE_STAGING_OPT_IN: "I-understand-this-is-staging",
      REBUNDLE_EXPECT_DB_HOST: "0.0.0.0",
      REBUNDLE_EXPECT_R2_BUCKET: "test-uploads",
      REBUNDLE_FORBID_DB_HOST: "db.bwwquxhexwyodsavsjar.supabase.co",
      REBUNDLE_FORBID_R2_BUCKET: "greedymotion-production-uploads"
    });
    assert.equal(stApply.status, 0, stApply.stderr);
    const stApplyJson = JSON.parse(
      stApply.stdout
        .trim()
        .split("\n")
        .slice(
          stApply.stdout
            .trim()
            .split("\n")
            .findIndex((l) => l.startsWith("{"))
        )
        .join("\n")
    );
    assert.equal(stApplyJson.action, "apply");
    assert.equal(stApplyJson.queuedWorker, 1);

    // Full staging opt-in --rollback-last 1 --mode worker (rolls back pVars[0])
    const stRbLast = await runCliAsync(["--rollback-last", "1", "--project", projectId, "--mode", "worker"], {
      ...stagingSubprocessEnv,
      REBUNDLE_STAGING_OPT_IN: "I-understand-this-is-staging",
      REBUNDLE_EXPECT_DB_HOST: "0.0.0.0",
      REBUNDLE_EXPECT_R2_BUCKET: "test-uploads",
      REBUNDLE_FORBID_DB_HOST: "db.bwwquxhexwyodsavsjar.supabase.co",
      REBUNDLE_FORBID_R2_BUCKET: "greedymotion-production-uploads"
    });
    assert.equal(stRbLast.status, 0, stRbLast.stderr);
    assert.equal((await store.getVariant(pVars[0].id)).rev, 0, "staging --rollback-last 1 rolled back pVars[0]");
  }

  console.log("plate rebundle staging: ok");
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
  await new Promise((resolveClose) => server.close(resolveClose));
}
