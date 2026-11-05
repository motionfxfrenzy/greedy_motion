// Scale-to-zero worker wake-up for staged `plate-rebundle` jobs:
//   1. Wake from zero: 1 staged runnable `plate-rebundle` job in `pgboss.job` -> `kickWorkers()` issues 1 `RunTaskCommand`.
//   2. Already running: with `running = 1` for that 1 job -> no second task starts.
//   3. Demand drops to zero: once the job is `completed`, `failed`, or `cancelled` -> `kickWorkers()` makes 0 ECS calls.
//   4. Delayed job: `created` and `retry` jobs with `start_after` 10 minutes in the future give 0 demand; moving `start_after`
//      into the past makes them runnable (counts 1, starts 1 task).
//   5. Lost kick: enqueuing without calling `kickPlateWorkers()` (ping time old) still launches a task on the periodic `kickWorkers()` check.
//   6. Cap: many staged jobs never start more than `maxTasks` tasks.
//   7. Plates disabled: `config.plates.enabled = false` keeps demand at 0.
//   8. Kick after the send: `rebundleVariant(..., { mode: "worker" })` kicks the launcher and triggers 1 `RunTaskCommand`.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic node --experimental-strip-types test/worker-launcher-rebundle.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { bundleScene } from "@videosaas/plate-engine";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

Object.assign(process.env, {
  ALLOW_CLOUD_IN_LOCAL: "1",
  STORAGE_DRIVER: "r2",
  R2_ENDPOINT: "http://127.0.0.1:9",
  R2_FORCE_PATH_STYLE: "1",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_UPLOADS_BUCKET: "test-uploads",
  R2_OUTPUTS_BUCKET: "test-outputs",
  PLATE_PIPELINE: "worker",
  PLATE_CONCURRENCY: "1",
  WORKER_LAUNCH: "ecs",
  ECS_REGION: "ap-southeast-1",
  ECS_CLUSTER: "greedymotion-staging",
  ECS_WORKER_TASK_DEFINITION: "greedymotion-staging-worker",
  ECS_SUBNETS: "subnet-a, subnet-b",
  ECS_SECURITY_GROUPS: "sg-1",
  ECS_WORKER_CONCURRENCY: "2",
  ECS_WORKER_MAX_TASKS: "3",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test"
});

const { ECSClient } = await import("@aws-sdk/client-ecs");
const calls = [];
let running = 0;
let spotCapacity = Infinity;
ECSClient.prototype.send = async function (command) {
  const name = command.constructor.name;
  calls.push({ name, input: command.input });
  if (name === "ListTasksCommand") {
    return { taskArns: Array.from({ length: running }, (_, i) => `arn:task/${i}`) };
  }
  if (name === "RunTaskCommand") {
    const spot = Boolean(command.input.capacityProviderStrategy);
    const started = spot ? Math.min(command.input.count, spotCapacity) : command.input.count;
    return {
      tasks: Array.from({ length: started }, (_, i) => ({ taskArn: `arn:new/${i}` })),
      failures: started < command.input.count ? [{ reason: "Capacity is unavailable" }] : []
    };
  }
  throw new Error(`unexpected ${name}`);
};

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { QUEUES, boss, quietBoss, startQueues } = await import("../src/jobs/queues.ts");
const { kickWorkers } = await import("../src/jobs/worker-launcher.ts");
const { bundleDigest } = await import("../src/plates/digest.ts");
const { rebundleVariant } = await import("../src/plates/rebundle.ts");

const PGBOSS_SCHEMA = quietBoss.schema ?? "pgboss";

await migrate();
await startQueues();

let stats = { queuedCount: 0, activeCount: 0 };
boss.getQueueStats = async () => [stats];

const runs = () => calls.filter((call) => call.name === "RunTaskCommand");
const lists = () => calls.filter((call) => call.name === "ListTasksCommand");

// Snapshot any leftover active plate_variants / plate_exports rows in a shared working DB so plateDemand() starts at 0,
// and restore them untouched in `finally`.
const savedVariants = (
  await pool.query("select id, state from app.plate_variants where state in ('bundled', 'rendering')")
).rows;
const savedExports = (
  await pool.query("select id, state from app.plate_exports where state in ('queued', 'assembling')")
).rows;

const projectId = randomUUID();
const variantId = randomUUID();
const trackedVariants = [variantId];
const newVariant = () => { const id = randomUUID(); trackedVariants.push(id); return id; };
const clearOwnRebundleJobs = () => pool.query(`delete from ${PGBOSS_SCHEMA}.job where name = $1 and data->>'variantId' = any($2)`, [QUEUES.plateRebundle, trackedVariants]);
const origDateNow = Date.now;

try {
  if (savedVariants.length > 0) {
    await pool.query("update app.plate_variants set state = 'drawn' where id = any($1)", [
      savedVariants.map((r) => r.id)
    ]);
  }
  if (savedExports.length > 0) {
    await pool.query("update app.plate_exports set state = 'ready' where id = any($1)", [
      savedExports.map((r) => r.id)
    ]);
  }
  await clearOwnRebundleJobs();

  const failures = [];
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
    } catch (err) {
      console.error(`  FAIL: ${name} -> ${err.message}`);
      failures.push({ name, err });
    }
  };

  // Baseline: empty queue and no plate work makes 0 ECS calls
  calls.length = 0;
  running = 0;
  await kickWorkers();
  assert.equal(calls.length, 0, "baseline empty queue must not call ECS");

  // 1. Wake from zero: 1 staged `plate-rebundle` job in state `created` -> 1 RunTaskCommand
  let wakeJobId;
  await check("1. Wake from zero", async () => {
    await clearOwnRebundleJobs();
    wakeJobId = await boss.send(QUEUES.plateRebundle, { variantId: newVariant(), gen: 1, rev: 0 });
    assert.ok(wakeJobId, "pg-boss created plate-rebundle job");
    const row = (await pool.query(`select state from ${PGBOSS_SCHEMA}.job where id = $1`, [wakeJobId])).rows[0];
    assert.equal(row?.state, "created");

    calls.length = 0;
    running = 0;
    await kickWorkers();
    assert.equal(lists().length, 1, "expected 1 ListTasksCommand");
    assert.equal(runs().length, 1, "expected 1 RunTaskCommand for 1 staged plate-rebundle job");
    assert.equal(runs()[0].input.count, 1, "expected RunTaskCommand count=1");
  });

  // 2. Already running: with 1 task already running for that 1 job, no second task starts
  await check("2. Already running", async () => {
    calls.length = 0;
    running = 1;
    await kickWorkers();
    assert.equal(lists().length, 1, "expected 1 ListTasksCommand when demand=1");
    assert.equal(runs().length, 0, "expected 0 RunTaskCommand when running=1 already covers demand=1");
  });

  // 3. Active job counts as demand, and demand drops to zero on completed / failed / cancelled
  await check("3. Demand drops to zero (active -> completed / failed / cancelled)", async () => {
    await pool.query(`update ${PGBOSS_SCHEMA}.job set state = 'active' where id = $1`, [wakeJobId]);
    calls.length = 0;
    running = 0;
    await kickWorkers();
    assert.equal(runs().length, 1, "active plate-rebundle job counts as demand and launches 1 task");

    for (const terminalState of ["completed", "failed", "cancelled"]) {
      await pool.query(`update ${PGBOSS_SCHEMA}.job set state = $2 where id = $1`, [wakeJobId, terminalState]);
      calls.length = 0;
      running = 0;
      await kickWorkers();
      assert.equal(
        calls.length,
        0,
        `expected 0 ECS calls (lastDemand=0) when job state is ${terminalState}, got ${calls.length}`
      );
    }
  });

  // 4. Delayed job: created and retry with start_after 10m in the future -> 0 demand; moved to past -> 1 demand
  await check("4. Delayed job (created and retry)", async () => {
    await clearOwnRebundleJobs();
    const delayedCreatedId = await boss.send(
      QUEUES.plateRebundle,
      { variantId: newVariant(), gen: 1, rev: 0 },
      { startAfter: 600 }
    );
    const delayedRetryId = await boss.send(
      QUEUES.plateRebundle,
      { variantId: newVariant(), gen: 1, rev: 0 },
      { startAfter: 600 }
    );
    await pool.query(`update ${PGBOSS_SCHEMA}.job set state = 'retry' where id = $1`, [delayedRetryId]);

    calls.length = 0;
    running = 0;
    await kickWorkers();
    assert.equal(calls.length, 0, "delayed created + retry jobs (start_after in future) must give 0 demand");

    // Move the created job's start_after into the past -> counts 1 and starts 1 task
    await pool.query(`update ${PGBOSS_SCHEMA}.job set start_after = now() - interval '1 minute' where id = $1`, [
      delayedCreatedId
    ]);
    calls.length = 0;
    running = 0;
    await kickWorkers();
    assert.equal(runs().length, 1, "due created job must start 1 task");
    assert.equal(runs()[0].input.count, 1, "only the 1 due job should be counted");

    // Complete the created job, then move the retry job's start_after into the past -> counts 1 and starts 1 task
    await pool.query(`update ${PGBOSS_SCHEMA}.job set state = 'completed' where id = $1`, [delayedCreatedId]);
    await pool.query(`update ${PGBOSS_SCHEMA}.job set start_after = now() - interval '1 minute' where id = $1`, [
      delayedRetryId
    ]);
    calls.length = 0;
    running = 0;
    await kickWorkers();
    assert.equal(runs().length, 1, "due retry job must start 1 task");
    assert.equal(runs()[0].input.count, 1, "due retry job counts 1");
  });

  // 5. Lost kick: enqueue without calling kickPlateWorkers(); periodic sweep check still starts a worker
  await check("5. Lost kick", async () => {
    await clearOwnRebundleJobs();
    await boss.send(QUEUES.plateRebundle, { variantId: newVariant(), gen: 1, rev: 0 });

    calls.length = 0;
    running = 0;
    // Call kickWorkers() with queuedJob=false and with platePingAt still at 0 (old)
    await kickWorkers();
    assert.equal(runs().length, 1, "lost kick is repaired by table count on periodic kickWorkers()");
    assert.equal(runs()[0].input.count, 1);
  });

  // 6. Cap: many staged jobs never start more than maxTasks tasks
  await check("6. Cap at maxTasks", async () => {
    await clearOwnRebundleJobs();
    for (let i = 0; i < 10; i++) {
      await boss.send(QUEUES.plateRebundle, { variantId: newVariant(), gen: 1, rev: i });
    }
    calls.length = 0;
    running = 0;
    await kickWorkers();
    assert.equal(runs().length, 1, "expected 1 RunTaskCommand for batch of staged jobs");
    assert.equal(runs()[0].input.count, 3, "wanted tasks must be capped at maxTasks (3)");
  });

  // 7. Plates disabled: config.plates.enabled = false keeps demand at 0
  await check("7. Plates disabled", async () => {
    config.plates.enabled = false;
    try {
      calls.length = 0;
      running = 0;
      await kickWorkers();
      assert.equal(calls.length, 0, "config.plates.enabled=false must keep plateDemand at 0");
    } finally {
      config.plates.enabled = true;
    }
  });

  // 8. Kick after the send: rebundleVariant in worker mode calls kickPlateWorkers() after boss.send
  await check("8. Kick after the send (rebundleVariant mode=worker)", async () => {
    await clearOwnRebundleJobs();

    const sceneCode = [
      'import { Ctx, Env } from "./core";',
      'import { Film } from "./film";',
      "const W = 1920, H = 1080, durationFrames = 60;",
      "const draw = (ctx: Ctx, _frame: number, env: Env): void => {",
      "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
      '  ctx.fillStyle = "#fff8ee";',
      "  ctx.fillRect(0, 0, W, H);",
      "};",
      'export const film: Film = { meta: { title: "wake-test", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };'
    ].join("\n");

    const compiled = await bundleScene({ look: "illus-fox", code: sceneCode, frames: 60, aspect: "16:9" });
    const oldManifest = {
      ...compiled.manifest,
      engineVersion: "0.6.4",
      engineDigest: "064000000000000000000640"
    };
    const oldDigest = bundleDigest({ manifest: oldManifest, params: {} });
    const sourceKey = `plates/${projectId}/16x9/0/g1/source.ts`;
    const oldBundleKey = `plates/${projectId}/16x9/0/g1/bundle.html`;

    const objects = new Map([[`uploads/${sourceKey}`, Buffer.from(sceneCode, "utf8")]]);
    const memoryStorage = {
      getObject: async (bucket, key) => objects.get(`${bucket}/${key}`) ?? null,
      putObject: async (bucket, key, body) => {
        objects.set(`${bucket}/${key}`, Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"));
      },
      objectSize: async (bucket, key) => objects.get(`${bucket}/${key}`)?.length ?? null
    };

    const projectRecord = {
      id: projectId,
      ownerId: "00000000-0000-4000-8000-000000000000",
      name: "Rebundle Wake Test",
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
        scriptBeats: [{ id: "b1", keyword: "Fox", visual: "Fox", onScreen: "Fox", line: "Fox." }]
      }
    };

    await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
      projectId,
      projectRecord.ownerId,
      projectRecord.name,
      projectRecord.state,
      projectRecord
    ]);
    await pool.query(
      `insert into app.plate_variants
        (id, project_id, scene_index, aspect, signature, gen, rev, state, frames, fps, width, height, source_key, bundle_key, bundle_manifest, bundle_digest, authored)
       values ($1, $2, 0, '16:9', 'v3:wake-0', 1, 0, 'checked', 60, 30, 1920, 1080, $3, $4, $5::jsonb, $6, 1)`,
      [variantId, projectId, sourceKey, oldBundleKey, JSON.stringify(oldManifest), oldDigest]
    );

    calls.length = 0;
    running = 0;
    const outcome = await rebundleVariant(variantId, { mode: "worker", storage: memoryStorage });
    assert.equal(outcome.status, "queued_worker");

    // Wait briefly for the async `void kickPlateWorkers()` inside rebundleVariant to finish
    const t0 = origDateNow();
    while (runs().length === 0 && origDateNow() - t0 < 300) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(runs().length, 1, "rebundleVariant(mode=worker) must kick the worker launcher and issue 1 RunTaskCommand");
    assert.equal(runs()[0].input.count, 1);

    // Once the job completes and the 120s kick ping window expires, demand drops back to 0
    await pool.query(`update ${PGBOSS_SCHEMA}.job set state = 'completed' where name = $1 and data->>'variantId' = any($2)`, [QUEUES.plateRebundle, trackedVariants]);
    const baseNow = origDateNow();
    Date.now = () => baseNow + 121_000;
    try {
      calls.length = 0;
      running = 0;
      await kickWorkers();
      assert.equal(calls.length, 0, "after completion and ping expiry, kickWorkers() makes 0 ECS calls");
    } finally {
      Date.now = origDateNow;
    }
  });

  if (failures.length > 0) {
    throw new Error(`${failures.length} test(s) failed: ${failures.map((f) => f.name).join(", ")}`);
  }

  console.log("worker launcher rebundle: ok");
} finally {
  Date.now = origDateNow;
  await clearOwnRebundleJobs().catch(() => undefined);
  await pool.query("delete from app.plate_variants where id = $1", [variantId]).catch(() => undefined);
  await pool.query("delete from app.projects where id = $1", [projectId]).catch(() => undefined);
  for (const row of savedVariants) {
    await pool.query("update app.plate_variants set state = $2 where id = $1", [row.id, row.state]).catch(() => undefined);
  }
  for (const row of savedExports) {
    await pool.query("update app.plate_exports set state = $2 where id = $1", [row.id, row.state]).catch(() => undefined);
  }
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
