// Phase 5 billing & idempotency test against real Postgres + Fastify routes + job control:
//   - charged once per accepted click
//   - Idempotency-Key header on POST /v1/projects/:id/render (sequential & concurrent): same job, one charge
//   - requests without an Idempotency-Key keep working as today
//   - refunded exactly once on every failure that is not user cancellation:
//       (a) scene verification failure (scene_needs_fix via render.finish)
//       (b) authoring exhausted before drawing (prepareFilm -> failForGood)
//       (c) retries exhausted after queueing to worker (videoDead -> failForGood with render_queued_at != null)
//       (d) worker permanent error (render_invalid via render.finish)
//   - never refunded twice on duplicate finish / dead-letter / syncProject
//   - user cancellation (code='cancelled') is not refunded
//   - settled (kept) on success (state='ready')
//   - companion exports stay free of tokens
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plate-render-billing.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import Fastify from "fastify";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.PLATE_PIPELINE = "worker";
if (!/plates_unit|plates_rebundle|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

// Hermetic local S3 server for manifest uploads
const s3Store = new Map();
const s3Server = createServer(async (req, res) => {
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
const { callerId, registerAuth } = await import("../src/auth.ts");
const { tierFor } = await import("../src/billing/service.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { operations } = await import("../src/jobs/control.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { NotReady, planReadiness } = await import("../src/plan/readiness.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const store = await import("../src/plates/store.ts");
const { getProject, updateProject } = await import("../src/projects/store.ts");
const { registerRenderQuote } = await import("../src/render/quote.ts");
const { renderJobRepository } = await import("../src/render/repository.ts");
const { renderService } = await import("../src/render/service.ts");
const { PLANS, renderCostMillitokens } = await import("../src/tokens/plan.ts");
const { grantTokens, InsufficientTokens, refundSpend, spendTokens, tokenSummary } = await import("../src/tokens/store.ts");

await migrate();
await startQueues();

const USER = "00000000-0000-4000-8000-0000000b5501";
const createdProjects = [];

function buildPlateProjectData(id, { ready = true } = {}) {
  const scriptBeats = [0, 1, 2].map((i) => ({
    id: `b${i + 1}`,
    keyword: `Beat ${i + 1}`,
    visual: `Visual for beat ${i + 1}`,
    onScreen: `Beat ${i + 1}`,
    line: `Spoken line for beat ${i + 1} with several words.`
  }));
  const beats = scriptBeats.map((b, i) => ({
    id: b.id,
    role: i === 0 ? "setup" : i === 1 ? "turn" : "resolution",
    kind: "kinetic",
    producer: "hyperframes",
    line: b.line,
    verb: null,
    keyword: b.keyword,
    on_screen: b.onScreen,
    visual: b.visual,
    success: i === 2,
    energy: "calm",
    motion: {
      camera: "slow push",
      entry: { axis: "x", dir: -1 },
      exit: { axis: "x", dir: -1 },
      text_effect: "waterfall"
    },
    sfx: "pop",
    scene: null,
    transition_out: { type: i === 2 ? "end" : "j-cut", carrier: null }
  }));
  return {
    id,
    ownerId: USER,
    name: "Billing Test Film",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      scriptMode: "own",
      text: scriptBeats.map((b) => b.line).join(" "),
      look: "illus-fox",
      aspect: "16:9",
      aspects: ["16:9"],
      motionProfile: "smooth",
      pace: "calm",
      captions: "full",
      audio: { mode: "none" },
      durationSeconds: 12,
      template: null,
      theme: "neutral",
      videoType: "story",
      productName: "Fox",
      scriptBeats
    },
    ...(ready
      ? {
          beatPlan: {
            version: "1.0",
            mode: "own-script",
            template: null,
            format: "social",
            canvas: "16:9",
            target_duration_s: 12,
            clock: "voiceover",
            brand: { name: "Fox", motion_profile: "smooth", style_frame: null },
            characters: [],
            beats,
            audio: {
              voice: null,
              music: null,
              captions: "full"
            },
            approvals: ["script", "storyboard", "motion-preview"],
            suggestions: [],
            estimate: { generated_shots: 0, api_usd: 0.05, render_s: 12 }
          }
        }
      : {})
  };
}

async function seedTestProject(opts = {}) {
  const id = randomUUID();
  createdProjects.push(id);
  const data = buildPlateProjectData(id, opts);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    id,
    USER,
    data.name,
    data.state,
    data
  ]);
  return { id, data };
}

async function ledgerCounts(userId, jobId) {
  const refPrefix = `render:${jobId}|%`;
  const refundPrefix = `refund:render:${jobId}|%`;
  const spends = await pool.query(
    "select coalesce(sum(-amount), 0)::int as milli, count(distinct split_part(ref, '|', 1))::int as events, count(*)::int as rows from app.token_ledger where user_id = $1 and kind = 'spend' and ref like $2",
    [userId, refPrefix]
  );
  const refunds = await pool.query(
    "select coalesce(sum(amount), 0)::int as milli, count(distinct split_part(ref, '|', 1))::int as events, count(*)::int as rows from app.token_ledger where user_id = $1 and kind = 'refund' and ref like $2",
    [userId, refundPrefix]
  );
  return {
    spendEvents: spends.rows[0].events,
    spendRows: spends.rows[0].rows,
    spendMilli: spends.rows[0].milli,
    refundEvents: refunds.rows[0].events,
    refundRows: refunds.rows[0].rows,
    refundMilli: refunds.rows[0].milli,
    netChargedMilli: spends.rows[0].milli - refunds.rows[0].milli
  };
}

// Fastify app with the exact same POST /v1/projects/:id/render route handler as server.ts + registerRenderQuote(app)
const app = Fastify();
registerAuth(app);
registerRenderQuote(app);
await registerPlateRoutes(app);

app.post("/v1/projects/:id/render", async (request, reply) => {
  const project = await getProject(request.params.id);
  if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
  const readiness = planReadiness(project);
  if (!readiness.ok) return reply.code(409).send({ error: { code: "not_ready", message: new NotReady(readiness).message }, readiness });
  const jobId = randomUUID();
  const owner = USER;
  const seconds = readiness.durationSeconds;
  let spend = { charged: false, event: null };
  if (seconds !== null) {
    try {
      spend = await spendTokens(owner, renderCostMillitokens(seconds), "render", jobId, project.id);
    } catch (error) {
      if (error instanceof InsufficientTokens) {
        return reply.code(402).send({ error: { code: "insufficient_tokens", message: error.message } });
      }
      throw error;
    }
  }
  const watermark = PLANS[await tierFor(owner)].watermark;
  try {
    await updateProject(project.id, { state: "Rendering draft", renderJobId: jobId });
    return reply
      .code(202)
      .send(await renderService.createBeatPlanRender(project, jobId, { watermark, motionBlur: false, ownerId: owner, spendEvent: spend.charged ? spend.event : null }, seconds ?? 0));
  } catch (error) {
    if (spend.charged && spend.event) await refundSpend(owner, spend.event).catch(() => undefined);
    throw error;
  }
});

try {
  config.plates.live = true;
  await pool.query("delete from app.token_ledger where user_id = $1", [USER]);
  await grantTokens(USER, 500, "test pack", "system", "billing-test-grant", "pack");

  // --- 1. Pre-spend readiness refusal (409 not_ready): zero charge
  const notReadyProj = await seedTestProject({ ready: false });
  const bal0 = (await tokenSummary(USER)).remaining;
  const notReadyRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${notReadyProj.id}/render`,
    payload: {}
  });
  assert.equal(notReadyRes.statusCode, 409);
  assert.equal((await tokenSummary(USER)).remaining, bal0, "409 refusal before spend charges 0 tokens");

  // --- 2. Idempotency-Key header: repeated clicks (concurrent and sequential) return the same job and charge once
  const idemProj = await seedTestProject({ ready: true });
  const balBeforeIdem = (await tokenSummary(USER)).remaining;
  const idemKey = `idem-click-${randomUUID()}`;

  const [resA, resB] = await Promise.all([
    app.inject({
      method: "POST",
      url: `/v1/projects/${idemProj.id}/render`,
      headers: { "idempotency-key": idemKey },
      payload: {}
    }),
    app.inject({
      method: "POST",
      url: `/v1/projects/${idemProj.id}/render`,
      headers: { "Idempotency-Key": idemKey },
      payload: {}
    })
  ]);
  const resC = await app.inject({
    method: "POST",
    url: `/v1/projects/${idemProj.id}/render`,
    headers: { "Idempotency-Key": idemKey },
    payload: {}
  });

  assert.equal(resA.statusCode, 202);
  assert.equal(resB.statusCode, 202);
  assert.equal(resC.statusCode, 202);
  const jobA = resA.json();
  const jobB = resB.json();
  const jobC = resC.json();
  assert.equal(jobA.id, jobB.id, "concurrent requests with same Idempotency-Key return the same job id");
  assert.equal(jobA.id, jobC.id, "sequential request with same Idempotency-Key returns the same job id");

  const idemJobRows = await pool.query(
    "select count(*)::int as n from app.render_jobs where project_id = $1 and idempotency_key = $2",
    [idemProj.id, idemKey]
  );
  assert.equal(idemJobRows.rows[0].n, 1, "only 1 render_jobs row created for Idempotency-Key");

  const idemProjectSpends = await pool.query(
    "select count(distinct split_part(ref, '|', 1))::int as n from app.token_ledger where user_id = $1 and kind = 'spend' and project_id = $2",
    [USER, idemProj.id]
  );
  assert.equal(idemProjectSpends.rows[0].n, 1, "charged only once across all 3 requests with same Idempotency-Key");

  // Requests without an Idempotency-Key create a distinct job as today
  const noKey1 = (await app.inject({ method: "POST", url: `/v1/projects/${idemProj.id}/render`, payload: {} })).json();
  const noKey2 = (await app.inject({ method: "POST", url: `/v1/projects/${idemProj.id}/render`, payload: {} })).json();
  assert.notEqual(noKey1.id, noKey2.id, "requests without Idempotency-Key create separate jobs as today");

  // --- 3. Success settles (keeps) the charge with 0 refunds
  await renderJobRepository.beginPlanning(jobA.id);
  await renderJobRepository.queueRender(jobA.id, jobA.revision, { kind: "plate-film", id: jobA.id, projectId: idemProj.id });
  await operations["render.claim"]({ jobId: jobA.id, attempt: 1 });
  const finOk = await operations["render.finish"]({
    jobId: jobA.id,
    attempt: 1,
    outcome: { output: { url: `/v1/renders/${jobA.id}`, format: "mp4", durationSeconds: 9, key: `renders/${jobA.id}/a1.mp4` } }
  });
  assert.equal(finOk.committed, true);
  await renderService["syncProject"](jobA.id);
  const ledgerSuccess = await ledgerCounts(USER, jobA.id);
  assert.ok(ledgerSuccess.spendMilli > 0, "success job has positive spend");
  assert.equal(ledgerSuccess.refundRows, 0, "success job has 0 refund rows (settled)");
  assert.equal(ledgerSuccess.netChargedMilli, ledgerSuccess.spendMilli);

  // --- 4a. Scene verification failure (scene_needs_fix via render.finish): refunded once, never twice
  const verifyFailJob = (await app.inject({ method: "POST", url: `/v1/projects/${idemProj.id}/render`, payload: {} })).json();
  await renderJobRepository.beginPlanning(verifyFailJob.id);
  await renderJobRepository.queueRender(verifyFailJob.id, verifyFailJob.revision, { kind: "plate-film", id: verifyFailJob.id, projectId: idemProj.id });
  await operations["render.claim"]({ jobId: verifyFailJob.id, attempt: 1 });
  const finNeedsFix1 = await operations["render.finish"]({
    jobId: verifyFailJob.id,
    attempt: 1,
    outcome: { error: { code: "scene_needs_fix", message: "Scene 1 needs a fix before rendering: DETERMINISM FAILURE" } }
  });
  // Duplicate render.finish and syncProject must not refund a second time
  const finNeedsFix2 = await operations["render.finish"]({
    jobId: verifyFailJob.id,
    attempt: 1,
    outcome: { error: { code: "scene_needs_fix", message: "Scene 1 needs a fix before rendering: DETERMINISM FAILURE" } }
  });
  await renderService["syncProject"](verifyFailJob.id);
  assert.equal(finNeedsFix1.committed, true);
  assert.equal(finNeedsFix2.duplicate, true);
  const ledgerNeedsFix = await ledgerCounts(USER, verifyFailJob.id);
  assert.equal(ledgerNeedsFix.spendEvents, 1);
  assert.equal(ledgerNeedsFix.refundEvents, 1, "scene_needs_fix refunded exactly once");
  assert.equal(ledgerNeedsFix.refundRows, ledgerNeedsFix.spendRows);
  assert.equal(ledgerNeedsFix.netChargedMilli, 0, "net charge for scene_needs_fix is 0");

  // --- 4b. Authoring exhausted during planning (before drawing): refunded once, never twice
  const authExhaustProj = await seedTestProject({ ready: true });
  const authExhaustJob = (await app.inject({ method: "POST", url: `/v1/projects/${authExhaustProj.id}/render`, payload: {} })).json();
  // While prepareFilm waits in waitForAuthoring, simulate plate-author exhausting its repair budget on scene 1
  setTimeout(async () => {
    for (let i = 0; i < 20; i++) {
      const aeVars = await store.listVariants(authExhaustProj.id);
      if (aeVars.length >= 2) {
        await store.failVariant(aeVars[1].id, aeVars[1].gen, null, {
          code: "author_exhausted",
          message: "This scene could not be drawn after 3 attempts. Press Draw to try again."
        });
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }, 50);
  // Run the planning step for authExhaustJob
  const plannedRow = await renderJobRepository.beginPlanning(authExhaustJob.id);
  await renderService["prepareFilm"](authExhaustJob.id, plannedRow, plannedRow.prep);
  // Calling failForGood a second time must not refund twice
  await renderService["failForGood"](authExhaustJob.id, { code: "author_exhausted", message: "retry" }, true);

  const aeAfter = await renderJobRepository.row(authExhaustJob.id);
  assert.equal(aeAfter.state, "failed");
  assert.equal(aeAfter.render_queued_at, null, "never queued to render worker");
  assert.match(aeAfter.error.message, /Scene 2 \(Beat 2\)/, "error names the failed scene");
  const ledgerAuthExhaust = await ledgerCounts(USER, authExhaustJob.id);
  assert.equal(ledgerAuthExhaust.spendEvents, 1);
  assert.equal(ledgerAuthExhaust.refundEvents, 1, "authoring failure refunded once");
  assert.equal(ledgerAuthExhaust.netChargedMilli, 0, "net charge when authoring fails before drawing is 0");

  // --- 4c. Retries exhausted in worker (videoDead -> failForGood when render_queued_at != null): refunded once
  const retriesExhaustJob = (await app.inject({ method: "POST", url: `/v1/projects/${idemProj.id}/render`, payload: {} })).json();
  await renderJobRepository.beginPlanning(retriesExhaustJob.id);
  await renderJobRepository.queueRender(retriesExhaustJob.id, retriesExhaustJob.revision, { kind: "plate-film", id: retriesExhaustJob.id, projectId: idemProj.id });
  await operations["render.claim"]({ jobId: retriesExhaustJob.id, attempt: 1 });
  await renderService["failForGood"](
    retriesExhaustJob.id,
    { code: "render_failed", message: "We could not render this video after 3 attempts." },
    false
  );
  await renderService["failForGood"](
    retriesExhaustJob.id,
    { code: "render_failed", message: "We could not render this video after 3 attempts." },
    false
  );
  const ledgerRetriesExhaust = await ledgerCounts(USER, retriesExhaustJob.id);
  assert.equal(ledgerRetriesExhaust.spendEvents, 1);
  assert.equal(ledgerRetriesExhaust.refundEvents, 1, "retries-exhausted job refunded once even though render_queued_at != null");
  assert.equal(ledgerRetriesExhaust.netChargedMilli, 0);

  // --- 4d. Worker permanent error (render_invalid via render.finish): refunded once
  const workerErrJob = (await app.inject({ method: "POST", url: `/v1/projects/${idemProj.id}/render`, payload: {} })).json();
  await renderJobRepository.beginPlanning(workerErrJob.id);
  await renderJobRepository.queueRender(workerErrJob.id, workerErrJob.revision, { kind: "plate-film", id: workerErrJob.id, projectId: idemProj.id });
  await operations["render.claim"]({ jobId: workerErrJob.id, attempt: 1 });
  await operations["render.finish"]({
    jobId: workerErrJob.id,
    attempt: 1,
    outcome: { error: { code: "render_invalid", message: "The export manifest is invalid." } }
  });
  await renderService["syncProject"](workerErrJob.id);
  const ledgerWorkerErr = await ledgerCounts(USER, workerErrJob.id);
  assert.equal(ledgerWorkerErr.spendEvents, 1);
  assert.equal(ledgerWorkerErr.refundEvents, 1, "worker error refunded once");
  assert.equal(ledgerWorkerErr.netChargedMilli, 0);

  // --- 4e. User cancellation (code='cancelled'): NOT refunded
  const cancelJob = (await app.inject({ method: "POST", url: `/v1/projects/${idemProj.id}/render`, payload: {} })).json();
  await renderJobRepository.beginPlanning(cancelJob.id);
  await renderJobRepository.queueRender(cancelJob.id, cancelJob.revision, { kind: "plate-film", id: cancelJob.id, projectId: idemProj.id });
  await operations["render.claim"]({ jobId: cancelJob.id, attempt: 1 });
  await operations["render.finish"]({
    jobId: cancelJob.id,
    attempt: 1,
    outcome: { error: { code: "cancelled", message: "Cancelled by user." } }
  });
  await renderService["syncProject"](cancelJob.id);
  const ledgerCancel = await ledgerCounts(USER, cancelJob.id);
  assert.equal(ledgerCancel.spendEvents, 1);
  assert.equal(ledgerCancel.refundEvents, 0, "user cancellation does not refund tokens");
  assert.equal(ledgerCancel.netChargedMilli, ledgerCancel.spendMilli);

  // --- 5. Companion export stays free of tokens
  const expProj = await seedTestProject({ ready: true });
  await store.reconcileVariants(
    expProj.id,
    [0, 1, 2].map((index) => ({
      index,
      aspect: "16:9",
      signature: `v3:exp-${index}`,
      frames: 90,
      width: 1920,
      height: 1080,
      keyword: `Beat ${index + 1}`
    })),
    { scenes: 3 }
  );
  for (const v of await store.listVariants(expProj.id)) {
    const ow = store.newOwner();
    await store.claimAuthor(v.id, v.gen, ow, 60, 10);
    await store.commitBundle(v, ow, {
      sourceKey: `plates/${expProj.id}/16x9/${v.scene_index}/g1/source.ts`,
      bundleKey: `plates/${expProj.id}/16x9/${v.scene_index}/g1/bundle.html`,
      manifest: { bundleSha: `expsha00000000000000000${v.scene_index}`, engineDigest: "eng-exp", frames: 90 },
      timings: {}
    });
  }
  const balBeforeExport = (await tokenSummary(USER)).remaining;
  const expRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${expProj.id}/plates/export`,
    payload: { aspect: "16:9" }
  });
  assert.equal(expRes.statusCode, 202);
  assert.equal((await tokenSummary(USER)).remaining, balBeforeExport, "companion export costs 0 tokens");

  console.log("plate render billing: ok");
} finally {
  config.plates.live = false;
  await app.close();
  await pool.query("delete from app.token_ledger where user_id = $1", [USER]);
  await pool.query("delete from app.render_jobs where project_id = any($1)", [createdProjects]);
  await pool.query("delete from app.plate_exports where project_id = any($1)", [createdProjects]);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [createdProjects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [createdProjects]);
  await pool.query("delete from app.plate_state where project_id = any($1)", [createdProjects]);
  await pool.query("delete from app.projects where id = any($1)", [createdProjects]);
  await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export', 'render-plan', 'render-video', 'render-finished')");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
  await new Promise((resolve) => s3Server.close(resolve));
}
