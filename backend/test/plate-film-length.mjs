// Plate film real-length billing & readiness test (TASK-billing-real-length.md):
//   (a) 6-beat illus-blueprint plate project without audio: quote seconds, POST /render charged seconds,
//       sum(buildTimeline(...).frames) / FPS, and buildExport manifest length all equal 18 s (11.4 tokens, not 12 s / 9.6 tokens)
//   (b) with a voice take longer than a scene's 3 s floor: quote, charge, buildTimeline, and buildExport all match the longer film
//   (c) non-plate (HyperFrames/ordinary) storyboard: planReadiness(project).durationSeconds is unchanged and equals planTiming.total (12 s)
//   (d) plateFilmSeconds returns null when there are no scriptBeats and does not throw when planAudio is absent
//   (e) GET /v1/projects/:id/composition returns durationSeconds equal to the quote's source (plateFilmSeconds) for plate projects
//   (f) DB billing: Idempotency-Key yields 1 job and 1 spend at the new 18 s price (11,400 millitokens); worker/authoring failure refunds 11,400 once
//   (g) Additional requirement 1 (consumers & limits): motionBlurProblem 20 s limit (18 s accepted vs 21 s refused), Free-tier 33-token (90 s) balance limit (90 s accepted vs 93 s refused), and target-length warning preserved on timing.total
//   (h) Additional requirement 2 (rounding): 18.00 s (540/30 -> 18 s), 18.033... s (541/30 -> 19 s), fractional voice take (18.5 s -> 19 s), and quoteFrom vs server.ts renderCostMillitokens parity
//   (i) Additional requirement 3 (scriptBeats vs beatPlan.beats): mismatched counts (6 scriptBeats vs 4 beatPlan.beats) -> plateFilmSeconds, desiredVariants, and buildExport all use scriptBeats (18 s)
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_billing_test PLANNER=deterministic node --experimental-strip-types test/plate-film-length.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import Fastify from "fastify";
import { motionBlurProblem, parseMotionBlur } from "@videosaas/contracts";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.PLATE_PIPELINE = "worker";
if (!/plates_unit|plates_rebundle|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

// Hermetic local S3 server for manifest & audio uploads
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
const { registerAuth } = await import("../src/auth.ts");
const { tierFor } = await import("../src/billing/service.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { operations } = await import("../src/jobs/control.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { planAudioDir } = await import("../src/plan/audio.ts");
const { projectTiming } = await import("../src/plan/preview.ts");
const { NotReady, planReadiness } = await import("../src/plan/readiness.ts");
const { registerPlanRoutes } = await import("../src/plan/routes.ts");
const { planTiming } = await import("../src/plan/timing.ts");
const { buildExport } = await import("../src/plates/exports.ts");
const platesInputs = await import("../src/plates/inputs.ts");
const { FPS, buildTimeline, secondsFor, takeFor } = await import("../src/plates/model.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const store = await import("../src/plates/store.ts");
const { getProject, updateProject } = await import("../src/projects/store.ts");
const { quoteFrom, registerRenderQuote } = await import("../src/render/quote.ts");
const { renderJobRepository } = await import("../src/render/repository.ts");
const { renderService } = await import("../src/render/service.ts");
const { PLANS, renderCostMillitokens, tokensFromMilli } = await import("../src/tokens/plan.ts");
const { grantTokens, InsufficientTokens, refundSpend, spendTokens, tokenSummary } = await import("../src/tokens/store.ts");

await migrate();
await startQueues();

const USER = "00000000-0000-4000-8000-000000000000";
const createdProjects = [];
const audioDirs = [];

function makeScriptBeat(i) {
  // 6 words in line -> wordsOf(line)/2.6 + 0.8 = 3.107 -> rounds to 3.0 s floor (90 frames); 8 words in onScreen/visual
  return {
    id: `b${i + 1}`,
    keyword: `Lighthouse step ${i + 1}`,
    visual: `Detailed blueprint diagram of lighthouse mechanism at step ${i + 1}`,
    onScreen: `Why the lighthouse beam sweeps around step ${i + 1}`,
    line: `Evening keeper lights harbour lamp ${i + 1}.`
  };
}

function makePlanBeat(b, i, total, voiced = false) {
  const role = i === 0 ? "hook" : i === total - 1 ? "cta" : i === total - 2 ? "resolution" : "step";
  return {
    id: b.id ?? `b${i + 1}`,
    role,
    kind: role === "cta" ? "title" : "kinetic",
    producer: "hyperframes",
    line: voiced ? b.line : null,
    verb: null,
    keyword: b.keyword,
    on_screen: b.onScreen,
    visual: b.visual,
    success: i === total - 2,
    energy: "calm",
    motion: {
      camera: "slow push",
      entry: { axis: "x", dir: -1 },
      exit: { axis: "x", dir: -1 },
      text_effect: "waterfall"
    },
    sfx: "pop",
    scene: null,
    transition_out: { type: i === total - 1 ? "end" : "j-cut", carrier: null }
  };
}

function buildProjectData(id, {
  look = "illus-blueprint",
  scriptBeatCount = 6,
  planBeatCount = scriptBeatCount,
  targetDuration = 12,
  voiced = false,
  planAudio = undefined,
  includeScriptBeats = true
} = {}) {
  const scriptBeats = Array.from({ length: scriptBeatCount }, (_, i) => makeScriptBeat(i));
  const planSource = Array.from({ length: planBeatCount }, (_, i) => scriptBeats[i] ?? makeScriptBeat(i));
  const beats = planSource.map((b, i) => makePlanBeat(b, i, planBeatCount, voiced));
  return {
    id,
    ownerId: USER,
    name: "Plate Real Length Test",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "lighthouse blueprint", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      scriptMode: "own",
      text: scriptBeats.map((b) => b.line).join(" "),
      ...(look ? { look } : {}),
      aspect: "16:9",
      aspects: ["16:9"],
      motionProfile: "smooth",
      pace: "balanced",
      captions: "full",
      audio: { mode: voiced ? "voiceover" : "none" },
      durationSeconds: targetDuration,
      template: null,
      theme: "neutral",
      videoType: "explainer",
      productName: "HarbourLight",
      ...(includeScriptBeats ? { scriptBeats } : {})
    },
    beatPlan: {
      version: "1.0",
      mode: "own-script",
      template: null,
      format: "explainer",
      canvas: "16:9",
      target_duration_s: targetDuration,
      clock: voiced ? "voiceover" : "beats",
      brand: { name: "HarbourLight", motion_profile: "smooth", style_frame: null },
      characters: [],
      beats,
      audio: {
        voice: voiced ? { engine: "gemini-tts", voice: "Kore", speed: 1, direction: "clear" } : null,
        music: null,
        captions: "full"
      },
      approvals: ["script", "storyboard", "motion-preview"],
      suggestions: [],
      estimate: { generated_shots: 0, api_usd: 0.05, render_s: targetDuration }
    },
    ...(planAudio !== undefined ? { planAudio } : {})
  };
}

async function seedProject(opts = {}) {
  const id = randomUUID();
  createdProjects.push(id);
  const data = buildProjectData(id, opts);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    id,
    USER,
    data.name,
    data.state,
    data
  ]);
  return { id, data };
}

async function seedBundledVariants(project, aspect = "16:9") {
  const desired = await platesInputs.desiredVariants(project, [aspect]);
  await store.reconcileVariants(project.id, desired, { scenes: desired.length });
  for (const v of await store.listVariants(project.id)) {
    if (v.aspect !== aspect) continue;
    const ow = store.newOwner();
    await store.claimAuthor(v.id, v.gen, ow, 60, 10);
    await store.commitBundle(v, ow, {
      sourceKey: `plates/${project.id}/16x9/${v.scene_index}/g1/source.ts`,
      bundleKey: `plates/${project.id}/16x9/${v.scene_index}/g1/bundle.html`,
      manifest: {
        bundleSha: `bsha0000000000000000000${v.scene_index}`,
        engineDigest: "eng-real-length-test",
        frames: v.frames
      },
      timings: {}
    });
  }
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

// Fastify app with registerRenderQuote, registerPlanRoutes, registerPlateRoutes, and the exact POST /v1/projects/:id/render logic from server.ts
const app = Fastify();
registerAuth(app);
registerRenderQuote(app);
await registerPlanRoutes(app);
await registerPlateRoutes(app);

app.post("/v1/projects/:id/render", async (request, reply) => {
  const project = await getProject(request.params.id);
  if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
  const blur = parseMotionBlur(request.body?.motionBlur);
  if (!blur.ok) return reply.code(400).send({ error: { code: "invalid_request", message: blur.message } });
  if (blur.on && !project.beatPlan) return reply.code(400).send({ error: { code: "motion_blur_unavailable", message: "Motion blur is available for storyboard films only." } });
  if (project.beatPlan) {
    if (blur.on && !platesInputs.isPlateLook(project.brief?.look)) {
      const seconds = planReadiness(project).durationSeconds;
      const tooLong = seconds === null ? null : motionBlurProblem(seconds);
      if (tooLong) return reply.code(400).send({ error: { code: "motion_blur_too_long", message: tooLong } });
    }
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
          return reply.code(402).send({ error: { code: "insufficient_tokens", message: error.message, needed: error.needed, remaining: error.remaining } });
        }
        throw error;
      }
    }
    const watermark = PLANS[await tierFor(owner)].watermark;
    try {
      await updateProject(project.id, { state: "Rendering draft", renderJobId: jobId });
      return reply
        .code(202)
        .send(await renderService.createBeatPlanRender(project, jobId, { watermark, motionBlur: blur.on, ownerId: owner, spendEvent: spend.charged ? spend.event : null }, seconds ?? 0));
    } catch (error) {
      if (spend.charged && spend.event) await refundSpend(owner, spend.event).catch(() => undefined);
      throw error;
    }
  }
  return reply.code(400).send({ error: { code: "no_plan", message: "No plan." } });
});

try {
  config.plates.live = true;
  await pool.query("delete from app.token_ledger where user_id = $1", [USER]);
  await grantTokens(USER, 500, "test pack", "system", "real-length-test-grant", "pack");

  // =========================================================================
  // (a) 6-beat illus-blueprint plate project without audio (3 s floor -> 18 s)
  // =========================================================================
  const projA = await seedProject({ look: "illus-blueprint", scriptBeatCount: 6, targetDuration: 12, voiced: false });
  for (const beat of projA.data.brief.scriptBeats) {
    assert.equal(secondsFor(beat), 3, "every 6-word beat hits the 3 s floor in secondsFor");
  }
  // Planner clock is 12 s (scaled toward target_duration_s: 12)
  assert.equal(projectTiming(projA.data).total, 12, "planner timing.total is 12 s");

  const sceneFrameListA = platesInputs.sceneFrames(projA.data).map((s) => s.frames);
  const voiceListA = projA.data.brief.scriptBeats.map((_, i) => takeFor(projA.data, i)?.seconds);
  const tlA = buildTimeline(sceneFrameListA, voiceListA);
  assert.equal(tlA.totalFrames, 540, "6 scenes * 90 frames = 540 frames");
  const expectedSecA = tlA.totalFrames / FPS;
  assert.equal(expectedSecA, 18);

  const readinessA = planReadiness(projA.data);
  assert.equal(readinessA.ok, true);
  assert.equal(readinessA.durationSeconds, 18, "planReadiness.durationSeconds equals 18 s (not planner 12 s)");

  const quoteA = quoteFrom(readinessA, { required: false, owedTokens: 0 }, 500);
  assert.equal(quoteA.seconds, 18, "quoteFrom.seconds is 18 s");
  assert.equal(quoteA.tokens, 11.4, "quoteFrom.tokens is 11.4 (6 + 18 * 0.3), not 9.6");

  const quoteRouteA = (await app.inject({ method: "GET", url: `/v1/projects/${projA.id}/render/quote` })).json();
  assert.equal(quoteRouteA.seconds, 18, "GET /render/quote returns 18 s");
  assert.equal(quoteRouteA.tokens, 11.4, "GET /render/quote returns 11.4 tokens");

  await seedBundledVariants(projA.data);
  const builtA = await buildExport(projA.data, "16:9", true);
  assert.equal(builtA.manifest.totalFrames / FPS, 18, "buildExport manifest.totalFrames / FPS is 18 s");
  assert.equal(builtA.durationSeconds, 18, "buildExport durationSeconds is 18 s");
  assert.equal(quoteA.seconds, builtA.durationSeconds, "quote seconds == buildExport durationSeconds == 18");
  assert.equal(readinessA.durationSeconds, builtA.manifest.totalFrames / FPS, "charged seconds == manifest.totalFrames / FPS == 18");

  // =========================================================================
  // (b) Plate project with a voice take longer than a scene's 3 s floor
  // =========================================================================
  // Scene 0 has a 4.4 s voice take -> secondsFor(beat, 4.4) = ceil((4.4 + 0.3) * 2) / 2 = 5.0 s (150 frames).
  // Scenes 1..5 have 2.0 s voice takes -> secondsFor(beat, 2.0) = max(3, ceil(2.3 * 2) / 2) = 3.0 s (90 frames each).
  // Total = 150 + 5 * 90 = 600 frames = 20.0 s (12.0 tokens).
  const projBId = randomUUID();
  const audioDirB = planAudioDir(projBId);
  audioDirs.push(audioDirB);
  await mkdir(audioDirB, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await writeFile(join(audioDirB, `vo-${i}.wav`), Buffer.from(`RIFF-voice-take-${i}`));
  }
  const linesB = Array.from({ length: 6 }, (_, i) => ({
    beat: `b${i + 1}`,
    text: `Evening keeper lights harbour lamp ${i + 1}.`,
    seconds: i === 0 ? 4.4 : 2.0,
    file: `vo-${i}.wav`
  }));
  const projBData = buildProjectData(projBId, {
    look: "illus-blueprint",
    scriptBeatCount: 6,
    targetDuration: 12,
    voiced: true,
    planAudio: { voice: { voiceId: "Kore", lines: linesB } }
  });
  createdProjects.push(projBId);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    projBId,
    USER,
    projBData.name,
    projBData.state,
    projBData
  ]);

  const sceneFrameListB = platesInputs.sceneFrames(projBData).map((s) => s.frames);
  const voiceListB = projBData.brief.scriptBeats.map((_, i) => takeFor(projBData, i)?.seconds);
  const tlB = buildTimeline(sceneFrameListB, voiceListB);
  assert.deepEqual(tlB.frames, [150, 90, 90, 90, 90, 90]);
  assert.equal(tlB.totalFrames, 600);
  assert.equal(tlB.totalFrames / FPS, 20);

  const readinessB = planReadiness(projBData);
  assert.equal(readinessB.ok, true);
  assert.equal(readinessB.durationSeconds, 20, "voiced plate readiness.durationSeconds is 20 s");

  const quoteB = quoteFrom(readinessB, { required: false, owedTokens: 0 }, 500);
  assert.equal(quoteB.seconds, 20);
  assert.equal(quoteB.tokens, 12, "6 + 20 * 0.3 = 12.0 tokens");

  await seedBundledVariants(projBData);
  const builtB = await buildExport(projBData, "16:9", true);
  assert.equal(builtB.manifest.totalFrames, 600);
  assert.equal(builtB.manifest.totalFrames / FPS, 20);
  assert.equal(builtB.durationSeconds, 20);
  assert.equal(quoteB.seconds, builtB.durationSeconds);

  // =========================================================================
  // (c) Non-plate (HyperFrames / ordinary) storyboard: unchanged literal timing
  // =========================================================================
  const nonPlateClean = await seedProject({ look: "clean", scriptBeatCount: 6, targetDuration: 12, voiced: false });
  const expectedCleanTiming = planTiming(nonPlateClean.data.beatPlan, nonPlateClean.data.brief);
  assert.equal(expectedCleanTiming.total, 12, "literal expected number from planTiming is 12 s");
  const readinessClean = planReadiness(nonPlateClean.data);
  assert.equal(readinessClean.durationSeconds, 12, "non-plate look='clean' keeps planTiming.total (12 s), not plate 18 s");
  const quoteClean = quoteFrom(readinessClean, { required: false, owedTokens: 0 }, 500);
  assert.equal(quoteClean.seconds, 12);
  assert.equal(quoteClean.tokens, 9.6);

  const nonPlateNoLook = await seedProject({ look: null, scriptBeatCount: 6, targetDuration: 12, voiced: false });
  assert.equal(planReadiness(nonPlateNoLook.data).durationSeconds, 12, "ordinary project without look keeps 12 s");

  // =========================================================================
  // (d) plateFilmSeconds unit checks: null when no scriptBeats; safe without planAudio
  // =========================================================================
  assert.equal(typeof platesInputs.plateFilmSeconds, "function", "plateFilmSeconds is exported from plates/inputs.ts");
  const noBeatsProj = buildProjectData(randomUUID(), { look: "illus-blueprint", includeScriptBeats: false });
  assert.equal(platesInputs.plateFilmSeconds(noBeatsProj), null, "returns null when brief.scriptBeats is missing");
  const emptyBeatsProj = buildProjectData(randomUUID(), { look: "illus-blueprint", scriptBeatCount: 0 });
  assert.equal(platesInputs.plateFilmSeconds(emptyBeatsProj), null, "returns null when brief.scriptBeats is []");
  // When scriptBeats is empty, planReadiness falls back to timing.total
  const emptyBeatsWithPlan = buildProjectData(randomUUID(), { look: "illus-blueprint", scriptBeatCount: 0, planBeatCount: 6, targetDuration: 12 });
  assert.equal(planReadiness(emptyBeatsWithPlan).durationSeconds, 12, "falls back to timing.total when plateFilmSeconds is null");
  // Does not throw when planAudio is undefined
  assert.equal(platesInputs.plateFilmSeconds(projA.data), 18, "returns 18 without planAudio");

  // =========================================================================
  // (e) Composition route GET /v1/projects/:id/composition
  // =========================================================================
  const compPlateRes = await app.inject({ method: "GET", url: `/v1/projects/${projA.id}/composition` });
  assert.equal(compPlateRes.statusCode, 200);
  const compPlate = compPlateRes.json();
  assert.equal(compPlate.durationSeconds, 18, "composition route durationSeconds is 18 s for 6-beat plate project");
  assert.equal(compPlate.readiness.durationSeconds, 18, "composition route readiness.durationSeconds is 18 s");
  assert.equal(compPlate.durationSeconds, quoteRouteA.seconds, "composition durationSeconds equals quote source");
  // beatTimes stays on the plan clock (last beat ends at 12 s)
  assert.equal(compPlate.beatTimes.b6.end, 12, "composition beatTimes is unchanged (planner clock)");

  const compCleanRes = await app.inject({ method: "GET", url: `/v1/projects/${nonPlateClean.id}/composition` });
  assert.equal(compCleanRes.statusCode, 200);
  const compClean = compCleanRes.json();
  assert.equal(compClean.durationSeconds, 12, "composition route durationSeconds is 12 s for non-plate project");

  // =========================================================================
  // (f) Database-backed billing assertions: Idempotency-Key & failure refund at new price
  // =========================================================================
  const balBeforeRender = (await tokenSummary(USER)).remaining;
  const idemKey = `idem-real-len-${randomUUID()}`;
  const [res1, res2] = await Promise.all([
    app.inject({ method: "POST", url: `/v1/projects/${projA.id}/render`, headers: { "Idempotency-Key": idemKey }, payload: {} }),
    app.inject({ method: "POST", url: `/v1/projects/${projA.id}/render`, headers: { "idempotency-key": idemKey }, payload: {} })
  ]);
  const res3 = await app.inject({ method: "POST", url: `/v1/projects/${projA.id}/render`, headers: { "Idempotency-Key": idemKey }, payload: {} });
  assert.equal(res1.statusCode, 202);
  assert.equal(res2.statusCode, 202);
  assert.equal(res3.statusCode, 202);
  const job1 = res1.json();
  assert.equal(job1.id, res2.json().id, "concurrent Idempotency-Key returns same job");
  assert.equal(job1.id, res3.json().id, "sequential Idempotency-Key returns same job");

  const ledger1 = await ledgerCounts(USER, job1.id);
  assert.equal(ledger1.spendEvents, 1, "one spend event for Idempotency-Key");
  assert.equal(ledger1.spendMilli, 11_400, "charged 11,400 millitokens (11.4 tokens for 18 s, not 9,600 for 12 s)");
  assert.equal(Math.round((balBeforeRender - (await tokenSummary(USER)).remaining) * 1000), 11_400);

  // Failure refunds the exact 11,400 millitokens once (never twice)
  await renderJobRepository.beginPlanning(job1.id);
  await renderJobRepository.queueRender(job1.id, job1.revision, { kind: "plate-film", id: job1.id, projectId: projA.id });
  await operations["render.claim"]({ jobId: job1.id, attempt: 1 });
  const finFail1 = await operations["render.finish"]({
    jobId: job1.id,
    attempt: 1,
    outcome: { error: { code: "scene_needs_fix", message: "Scene 1 failed verification" } }
  });
  const finFail2 = await operations["render.finish"]({
    jobId: job1.id,
    attempt: 1,
    outcome: { error: { code: "scene_needs_fix", message: "Scene 1 failed verification" } }
  });
  await renderService["syncProject"](job1.id);
  assert.equal(finFail1.committed, true);
  assert.equal(finFail2.duplicate, true);

  const ledgerAfterFail = await ledgerCounts(USER, job1.id);
  assert.equal(ledgerAfterFail.spendEvents, 1);
  assert.equal(ledgerAfterFail.spendMilli, 11_400);
  assert.equal(ledgerAfterFail.refundEvents, 1, "refunded once");
  assert.equal(ledgerAfterFail.refundMilli, 11_400, "refunded exact 11,400 millitokens");
  assert.equal(ledgerAfterFail.netChargedMilli, 0);
  assert.equal((await tokenSummary(USER)).remaining, balBeforeRender, "balance fully restored after failure");

  // =========================================================================
  // (g) Additional requirement 1: consumers & limits on both sides
  // =========================================================================
  // 1. Motion blur limit (maxSeconds = 20):
  //    - Plate films skip the motion-blur length check (both 18 s and 21 s plate films -> 202)
  //    - HyperFrames/non-plate films > 20 s -> refused (400 motion_blur_too_long)
  const blurOkRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projA.id}/render`,
    payload: { motionBlur: true }
  });
  assert.equal(blurOkRes.statusCode, 202, "18 s plate film is accepted");

  const proj7 = await seedProject({ look: "illus-blueprint", scriptBeatCount: 7, targetDuration: 15, voiced: false });
  assert.equal(projectTiming(proj7.data).total, 14.933, "planner timing for 7-beat film is 14.933 s (<= 20 s)");
  assert.ok(projectTiming(proj7.data).total <= 20);
  assert.equal(planReadiness(proj7.data).durationSeconds, 21, "plateFilmSeconds for 7-beat film is 21 s (> 20 s)");
  const blurPlate21Res = await app.inject({
    method: "POST",
    url: `/v1/projects/${proj7.id}/render`,
    payload: { motionBlur: true }
  });
  assert.equal(blurPlate21Res.statusCode, 202, "21 s plate film skips motion-blur length check and is accepted (202)");

  const proj7Hf = await seedProject({ look: "clean", scriptBeatCount: 7, targetDuration: 21, voiced: false });
  const blurRefusedRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${proj7Hf.id}/render`,
    payload: { motionBlur: true }
  });
  assert.equal(blurRefusedRes.statusCode, 400, "21 s non-plate film is > 20 s motion-blur limit and refused");
  assert.equal(blurRefusedRes.json().error.code, "motion_blur_too_long");

  // 2. Free-tier 33-token (90 s) balance limit:
  //    Set balance to exactly 33 tokens (PLANS.free.tokens = 33, which pays for up to 90 s: 6 + 90 * 0.3 = 33.0 tokens).
  //    - 30 scenes = 90 s = 33.0 tokens -> enough: true, POST /render accepted (202)
  //    - 31 scenes = 93 s = 33.9 tokens (even with target_duration_s: 80) -> enough: false, POST /render refused (402 insufficient_tokens)
  await pool.query("delete from app.token_ledger where user_id = $1", [USER]);
  // tokenSummary automatically grants the 33-token free allowance when user has no ledger rows
  const freeSummary = await tokenSummary(USER);
  assert.equal(freeSummary.remaining, 33, "free tier grants 33 tokens (one 90 s film)");

  const proj30 = await seedProject({ look: "illus-blueprint", scriptBeatCount: 30, targetDuration: 80, voiced: false });
  assert.equal(planReadiness(proj30.data).durationSeconds, 90);
  const quote30 = (await app.inject({ method: "GET", url: `/v1/projects/${proj30.id}/render/quote` })).json();
  assert.equal(quote30.seconds, 90);
  assert.equal(quote30.tokens, 33);
  assert.equal(quote30.enough, true, "90 s plate film (33 tokens) fits in 33-token free allowance");

  const proj31 = await seedProject({ look: "illus-blueprint", scriptBeatCount: 31, targetDuration: 80, voiced: false });
  assert.equal(planReadiness(proj31.data).durationSeconds, 93);
  const quote31 = (await app.inject({ method: "GET", url: `/v1/projects/${proj31.id}/render/quote` })).json();
  assert.equal(quote31.seconds, 93);
  assert.equal(quote31.tokens, 33.9);
  assert.equal(quote31.enough, false, "93 s plate film (33.9 tokens) exceeds 33-token free allowance");

  const res31 = await app.inject({ method: "POST", url: `/v1/projects/${proj31.id}/render`, payload: {} });
  assert.equal(res31.statusCode, 402, "93 s plate film refused with 402 on 33-token balance");
  assert.equal(res31.json().error.code, "insufficient_tokens");

  const res30 = await app.inject({ method: "POST", url: `/v1/projects/${proj30.id}/render`, payload: {} });
  assert.equal(res30.statusCode, 202, "90 s plate film accepted with 202 on 33-token balance");
  assert.equal((await tokenSummary(USER)).remaining, 0, "90 s plate film spends all 33 free tokens");

  // Restore generous balance for remaining tests
  await grantTokens(USER, 500, "test pack", "system", "real-length-test-grant-2", "pack");

  // 3. Target-length warning ("The film runs Ns; you chose Ms as a target") stays on timing.total (not plateFilmSeconds):
  //    For projA (target 12 s, timing.total 12 s, plateFilmSeconds 18 s), offTarget is false because |12 - 12| <= 3.05.
  assert.equal(
    readinessA.warnings.some((w) => /The film runs/.test(w.message)),
    false,
    "target-length warning uses timing.total (12 s vs 12 s target), not plateFilmSeconds (18 s)"
  );

  // =========================================================================
  // (h) Additional requirement 2: rounding (18.00 s, 18.03 s / 541 frames, fractional voice take)
  // =========================================================================
  // Exact 18.00 s (540 / 30):
  const q18 = quoteFrom({ ok: true, durationSeconds: 540 / FPS }, { required: false, owedTokens: 0 }, 100);
  assert.equal(q18.seconds, 18);
  assert.equal(q18.tokens, 11.4);
  assert.equal(renderCostMillitokens(540 / FPS), 11_400);
  assert.equal(tokensFromMilli(renderCostMillitokens(540 / FPS)), q18.tokens);

  // 541 / 30 = 18.0333... s and literal 18.03 s -> both round up to 19 s (11.7 tokens / 11,700 millitokens):
  for (const dur of [541 / FPS, 18.03]) {
    const q = quoteFrom({ ok: true, durationSeconds: dur }, { required: false, owedTokens: 0 }, 100);
    assert.equal(q.seconds, 19, `quoteFrom rounds ${dur} up to 19 s`);
    assert.equal(q.tokens, 11.7, `quoteFrom charges 11.7 tokens for ${dur}`);
    assert.equal(renderCostMillitokens(dur), 11_700, `server.ts renderCostMillitokens(${dur}) charges 11,700 millitokens (19 s)`);
    assert.equal(tokensFromMilli(renderCostMillitokens(dur)), q.tokens, "server.ts charge and quoteFrom match");
  }

  // Fractional plateFilmSeconds with a voice take:
  // Scene 0 has a 3.1 s take -> secondsFor(beat, 3.1) = ceil((3.1 + 0.3) * 2) / 2 = 3.5 s (105 frames).
  // Scenes 1..5 have no take -> 3.0 s (90 frames each).
  // Total = 105 + 450 = 555 frames -> 555 / 30 = 18.5 s -> ceil(18.5) = 19 s (11.7 tokens).
  const projFracId = randomUUID();
  const audioDirFrac = planAudioDir(projFracId);
  audioDirs.push(audioDirFrac);
  await mkdir(audioDirFrac, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await writeFile(join(audioDirFrac, `vo-f-${i}.wav`), Buffer.from(`RIFF-voice-frac-${i}`));
  }
  const projFracData = buildProjectData(projFracId, {
    look: "illus-blueprint",
    scriptBeatCount: 6,
    targetDuration: 12,
    voiced: true,
    planAudio: {
      voice: {
        voiceId: "Kore",
        lines: Array.from({ length: 6 }, (_, i) => ({
          beat: `b${i + 1}`,
          text: `Evening keeper lights harbour lamp ${i + 1}.`,
          seconds: i === 0 ? 3.1 : 2.0,
          file: `vo-f-${i}.wav`
        }))
      }
    }
  });
  createdProjects.push(projFracId);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    projFracId,
    USER,
    projFracData.name,
    projFracData.state,
    projFracData
  ]);
  assert.equal(platesInputs.plateFilmSeconds(projFracData), 18.5, "plateFilmSeconds returns exact 555/30 = 18.5 s");
  const readinessFrac = planReadiness(projFracData);
  assert.equal(readinessFrac.durationSeconds, 18.5);
  const quoteFrac = quoteFrom(readinessFrac, { required: false, owedTokens: 0 }, 500);
  assert.equal(quoteFrac.seconds, 19, "18.5 s rounds up to 19 s in quote");
  assert.equal(quoteFrac.tokens, 11.7, "19 s costs 11.7 tokens");

  await seedBundledVariants(projFracData);
  const builtFrac = await buildExport(projFracData, "16:9", true);
  assert.equal(builtFrac.manifest.totalFrames, 555);
  assert.equal(quoteFrac.seconds, Math.ceil(builtFrac.manifest.totalFrames / FPS), "quote.seconds == ceil(mp4 duration)");

  const fracRenderRes = await app.inject({ method: "POST", url: `/v1/projects/${projFracId}/render`, payload: {} });
  assert.equal(fracRenderRes.statusCode, 202);
  const fracLedger = await ledgerCounts(USER, fracRenderRes.json().id);
  assert.equal(fracLedger.spendMilli, 11_700, "POST /render charges 11,700 millitokens (19 s) for 18.5 s film");

  // =========================================================================
  // (i) Additional requirement 3: scriptBeats vs beatPlan.beats count mismatch
  // =========================================================================
  // 6 scriptBeats (18 s) vs 4 beatPlan.beats (target 12 s):
  // desiredVariants, buildExport, and plateFilmSeconds all read brief.scriptBeats (6 scenes = 18 s).
  const projMismatch = await seedProject({
    look: "illus-blueprint",
    scriptBeatCount: 6,
    planBeatCount: 4,
    targetDuration: 12,
    voiced: false
  });
  assert.equal(projMismatch.data.brief.scriptBeats.length, 6);
  assert.equal(projMismatch.data.beatPlan.beats.length, 4);

  const desiredMismatch = await platesInputs.desiredVariants(projMismatch.data, ["16:9"]);
  assert.equal(desiredMismatch.length, 6, "desiredVariants renders brief.scriptBeats (6 scenes, not 4 plan beats)");

  await seedBundledVariants(projMismatch.data);
  const builtMismatch = await buildExport(projMismatch.data, "16:9", true);
  assert.equal(builtMismatch.manifest.scenes.length, 6, "buildExport renders brief.scriptBeats (6 scenes)");
  assert.equal(builtMismatch.manifest.totalFrames / FPS, 18, "buildExport totalFrames / FPS is 18 s");
  assert.equal(platesInputs.plateFilmSeconds(projMismatch.data), 18, "plateFilmSeconds matches buildExport (18 s)");
  assert.equal(planReadiness(projMismatch.data).durationSeconds, 18, "planReadiness matches buildExport (18 s)");

  console.log("plate film length: ok");
} finally {
  config.plates.live = false;
  await app.close();
  for (const d of audioDirs) {
    await rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
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
