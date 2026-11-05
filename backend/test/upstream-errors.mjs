// Integration test for Part A: generic upstream errors, X-Request-Id propagation, server-side logging of
// provider/transport details, and preservation of domain/validation error messages.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import cors from "@fastify/cors";
import Fastify from "fastify";
import pino from "pino";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV = "local";
process.env.PLANNER = "anthropic";
process.env.ANTHROPIC_API_KEY = "offline-test-key";
process.env.GEMINI_API_KEY = "offline-test-gemini-key";
process.env.CREEM_API_KEY = "";
process.env.PREVIEW_LIMITS = "off";
assertThrowawayDb();

const CANARY_URL = "https://api.internal.example/v1?key=SECRET123";
const CANARY_MESSAGE = `Upstream provider failure at ${CANARY_URL}`;

const { config } = await import("../src/config.ts");
config.planner = "anthropic";
config.anthropicApiKey = "offline-test-key";
config.geminiApiKey = "offline-test-gemini-key";

const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { genReqId, registerRequestId, upstreamError } = await import("../src/http-errors.ts");
const { createProject, getProject, ProjectInvalid, updateProject, updateProjectPlan, updateProjectVisuals } = await import("../src/projects/store.ts");
const { registerPlanRoutes } = await import("../src/plan/routes.ts");
const { registerFormatRoutes } = await import("../src/formats/routes.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const { computePlanVersion, setDefaultModelTranslatorOptions } = await import("../src/plan/element-edits.ts");
const { visualFingerprint } = await import("../src/plan/visual-state.ts");
const { scriptFrameKey } = await import("@videosaas/contracts");

await migrate();
await startQueues();

// Capture pino JSON log lines in memory
const logLines = [];
const logStream = new Writable({
  write(chunk, _encoding, callback) {
    const text = chunk.toString("utf8").trim();
    if (text) {
      for (const line of text.split("\n")) {
        try {
          logLines.push(JSON.parse(line));
        } catch {
          logLines.push({ raw: line });
        }
      }
    }
    callback();
  }
});

const app = Fastify({
  loggerInstance: pino({ level: "info" }, logStream),
  genReqId
});
registerRequestId(app);
await app.register(cors, {
  origin: true,
  exposedHeaders: ["X-Request-Id"]
});
await registerPlanRoutes(app);
await registerFormatRoutes(app);
await registerPlateRoutes(app);

// Also mount the server.ts projectError / brandError handlers on dedicated test routes matching server.ts
app.post("/v1/projects/:id/script", async (request, reply) => {
  try {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    throw new Error(CANARY_MESSAGE);
  } catch (error) {
    if (error instanceof ProjectInvalid) return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
    return reply.code(422).send(upstreamError(request, error, "project_failed", "Could not update this project."));
  }
});
app.post("/v1/brands/extract", async (request, reply) => {
  try {
    throw new Error(CANARY_MESSAGE);
  } catch (error) {
    return reply.code(422).send(upstreamError(request, error, "brand_failed", "Could not process the brand."));
  }
});

await app.ready();

const TEST_OWNER = randomUUID();
const createdProjects = [];

const b1Elements = [
  { id: "b1:kicker:0", role: "kicker", text: "HOOK", box: [145, 220, 140, 32], beat: "b1", opacity: 1 },
  { id: "b1:w:0", role: "word", text: "Your", box: [145, 290, 320, 180], beat: "b1", opacity: 1 },
  { id: "b1:w:1", role: "word", text: "story,", box: [485, 290, 410, 180], beat: "b1", opacity: 1 },
  { id: "b1:w:2", role: "accent-word", text: "moving.", box: [162, 480, 711, 193], beat: "b1", opacity: 1 },
  { id: "b1:sub:0", role: "subtitle", text: "Every beat of the plan, on screen", box: [145, 738, 1076, 63], beat: "b1", opacity: 1 }
];
const b2Elements = [
  { id: "b2:kicker:0", role: "kicker", text: "SUCCESS", box: [240, 220, 180, 32], beat: "b2", opacity: 1 },
  { id: "b2:w:0", role: "word", text: "Ready", box: [240, 389, 460, 180], beat: "b2", opacity: 1 },
  { id: "b2:w:1", role: "word", text: "to", box: [720, 389, 180, 180], beat: "b2", opacity: 1 },
  { id: "b2:w:2", role: "accent-word", text: "share.", box: [359, 585, 562, 198], beat: "b2", opacity: 1 },
  { id: "b2:sub:0", role: "subtitle", text: "One prompt builds the plan", box: [310, 810, 820, 58], beat: "b2", opacity: 1 }
];
const b2Snapshots = [{ time: 7.23, elements: b2Elements }];

const validBrief = {
  scriptMode: "own",
  text: "Your story, moving. Ready to share. Every beat ships. Start now.",
  aspect: "16:9",
  motionProfile: "smooth",
  pace: "balanced",
  captions: "key-phrases",
  audio: { mode: "both", voice: "Kore", musicMood: "warm modern instrumental" },
  durationSeconds: 30,
  theme: "neutral",
  productName: "VideoSaaS",
  scriptBeats: [
    { keyword: "Your story, moving.", onScreen: "Every beat of the plan, on screen", line: "First you describe what you are building and who it is for.", visual: "Opening card" },
    { keyword: "Ready to share.", onScreen: "One prompt builds the plan", line: "Then the storyboard arranges every beat on a single timeline.", visual: "Timeline card" },
    { keyword: "Every beat ships.", onScreen: "Preview in the browser", line: "You can tweak any word or colour right in the live preview.", visual: "Preview card" },
    { keyword: "Start now.", onScreen: "videosaas.example.com", line: "Export your launch video in seconds.", visual: "Closing card" }
  ]
};

async function seedProject(look = "clean") {
  const created = await createProject(
    {
      name: "Upstream Error Test",
      request: {
        prompt: "A launch video for testing upstream errors",
        template: "product-launch",
        style: "kinetic",
        theme: "neutral",
        format: "landscape"
      }
    },
    TEST_OWNER
  );
  createdProjects.push(created.id);
  const brief = { ...validBrief, ...(look !== "clean" ? { look } : {}) };
  const plan = {
    version: "1.0",
    mode: "own-script",
    template: null,
    format: "launch-30",
    canvas: "16:9",
    target_duration_s: 20,
    clock: "voiceover",
    brand: { name: "VideoSaaS", motion_profile: "smooth", style_frame: null },
    characters: [],
    beats: brief.scriptBeats.map((b, i) => ({
      id: `b${i + 1}`,
      role: i === 0 ? "hook" : i === 3 ? "cta" : "step",
      kind: i === 3 ? "title" : "kinetic",
      producer: "hyperframes",
      line: b.line,
      verb: null,
      keyword: b.keyword,
      on_screen: b.onScreen,
      success: i === 1,
      energy: "high",
      motion: { camera: "steady", entry: { axis: "x", dir: -1 }, exit: { axis: "x", dir: -1 }, text_effect: "waterfall" },
      sfx: null,
      scene: null,
      transition_out: { type: i === 3 ? "end" : "j-cut" }
    })),
    audio: {
      voice: { engine: "gemini-tts", voice: "Kore", speed: 1, direction: "clear" },
      music: { source: "lyria", prompt: "warm modern instrumental" },
      captions: "phrases"
    },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: [],
    estimate: { generated_shots: 0, api_usd: 0.25 }
  };
  const updated = await updateProjectPlan(created.id, () => ({
    brief,
    beatPlan: plan,
    script: {
      source: "generated",
      lines: plan.beats.map((b) => ({ label: "Step", onScreen: b.on_screen ?? b.keyword, voiceover: b.line ?? "" })),
      confirmed: true,
      updatedAt: new Date().toISOString()
    },
    state: "Draft storyboard"
  }));
  return updated;
}

function assertNoCanaryInText(rawText, label) {
  assert.ok(!rawText.includes("internal.example"), `${label}: response must not leak internal.example`);
  assert.ok(!rawText.includes("SECRET123"), `${label}: response must not leak SECRET123`);
}

function assertLoggedCanaryWithRequestId(startIndex, requestId, label) {
  const recent = logLines.slice(startIndex);
  const matching = recent.filter((entry) => {
    const serialized = JSON.stringify(entry);
    return entry.requestId === requestId && serialized.includes("internal.example") && serialized.includes("SECRET123");
  });
  assert.ok(
    matching.length >= 1,
    `${label}: server log must contain canary detail AND requestId=${requestId} (saw ${JSON.stringify(recent)})`
  );
}

function assertJsonUpstreamError(res, { expectedStatus, expectedCode, expectedMessage, expectedRequestId, logStart, label }) {
  assert.equal(res.statusCode, expectedStatus, `${label}: status code`);
  assertNoCanaryInText(res.body, label);
  const body = res.json();
  assert.equal(body.error?.code, expectedCode, `${label}: error.code`);
  assert.equal(body.error?.message, expectedMessage, `${label}: error.message`);
  const reqId = body.error?.requestId;
  assert.match(reqId ?? "", /^[A-Za-z0-9-]{8,64}$/, `${label}: error.requestId format`);
  if (expectedRequestId) {
    assert.equal(reqId, expectedRequestId, `${label}: error.requestId matches expected`);
  }
  assert.equal(res.headers["x-request-id"], reqId, `${label}: X-Request-Id header equals error.requestId`);
  assertLoggedCanaryWithRequestId(logStart, reqId, label);
  return reqId;
}

const origFetch = globalThis.fetch;
const origQuery = pool.query.bind(pool);

try {
  // Stub global fetch so all provider HTTP calls fail with the canary and never touch the network
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: CANARY_MESSAGE } }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });

  const proj = await seedProject();

  // =========================================================================
  // 1. Safe vs unsafe X-Request-Id header handling + CORS exposedHeaders
  // =========================================================================
  {
    setDefaultModelTranslatorOptions({
      sleep: async () => {},
      request: async () =>
        new Response(JSON.stringify({ error: { message: CANARY_MESSAGE } }), {
          status: 502,
          headers: { "content-type": "application/json" }
        }),
      log: () => {}
    });

    // 1a. Safe X-Request-Id is honoured
    const safeClientReqId = "client-req-12345678";
    const logStartSafe = logLines.length;
    const resSafe = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-request-id": safeClientReqId, origin: "http://localhost:3000" },
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
      }
    });
    assertJsonUpstreamError(resSafe, {
      expectedStatus: 502,
      expectedCode: "propose_failed",
      expectedMessage: "Could not translate the comment. Try again.",
      expectedRequestId: safeClientReqId,
      logStart: logStartSafe,
      label: "POST /plan/edit/propose (safe X-Request-Id)"
    });
    assert.match(
      String(resSafe.headers["access-control-expose-headers"] ?? ""),
      /X-Request-Id/i,
      "CORS exposedHeaders includes X-Request-Id"
    );

    // 1b. Unsafe X-Request-Id (spaces) is replaced
    const unsafeSpaces = "bad request id with spaces";
    const logStartSpaces = logLines.length;
    const resSpaces = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-request-id": unsafeSpaces },
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
      }
    });
    const replacedId1 = assertJsonUpstreamError(resSpaces, {
      expectedStatus: 502,
      expectedCode: "propose_failed",
      expectedMessage: "Could not translate the comment. Try again.",
      logStart: logStartSpaces,
      label: "POST /plan/edit/propose (unsafe spaces X-Request-Id)"
    });
    assert.notEqual(replacedId1, unsafeSpaces);

    // 1c. Unsafe X-Request-Id (200 chars) is replaced
    const unsafeLong = "a".repeat(200);
    const logStartLong = logLines.length;
    const resLong = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-request-id": unsafeLong },
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
      }
    });
    const replacedId2 = assertJsonUpstreamError(resLong, {
      expectedStatus: 502,
      expectedCode: "propose_failed",
      expectedMessage: "Could not translate the comment. Try again.",
      logStart: logStartLong,
      label: "POST /plan/edit/propose (unsafe 200-char X-Request-Id)"
    });
    assert.notEqual(replacedId2, unsafeLong);

    // 1d. Timeout on propose -> 503 with generic message
    setDefaultModelTranslatorOptions({
      sleep: async () => {},
      request: async () => {
        const err = new Error(`Timed out calling ${CANARY_URL}`);
        err.name = "TimeoutError";
        throw err;
      },
      log: () => {}
    });
    const logStartTimeout = logLines.length;
    const resTimeout = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
      }
    });
    assertJsonUpstreamError(resTimeout, {
      expectedStatus: 503,
      expectedCode: "propose_failed",
      expectedMessage: "Could not translate the comment. Try again.",
      logStart: logStartTimeout,
      label: "POST /plan/edit/propose (timeout 503)"
    });
    setDefaultModelTranslatorOptions(null);
  }

  // =========================================================================
  // 2. POST /v1/projects/:id/plan/beats/:beatId/rewrite
  // =========================================================================
  {
    const logStart = logLines.length;
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/beats/b1/rewrite`,
      payload: { instruction: "Make it punchier" }
    });
    assertJsonUpstreamError(res, {
      expectedStatus: 502,
      expectedCode: "rewrite_failed",
      expectedMessage: "Could not rewrite the frame.",
      logStart,
      label: "POST /plan/beats/:beatId/rewrite"
    });
  }

  // =========================================================================
  // 3. POST /v1/projects/:id/plan/audio
  // =========================================================================
  {
    const logStart = logLines.length;
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/audio`,
      payload: { parts: ["voice"] }
    });
    assertJsonUpstreamError(res, {
      expectedStatus: 502,
      expectedCode: "audio_failed",
      expectedMessage: "The voiceover failed.",
      logStart,
      label: "POST /plan/audio"
    });
  }

  // =========================================================================
  // 4. POST /v1/projects/:id/script-draft & /script-draft/revise
  // =========================================================================
  {
    const logStart = logLines.length;
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/script-draft`,
      payload: validBrief
    });
    assertJsonUpstreamError(res, {
      expectedStatus: 502,
      expectedCode: "script_failed",
      expectedMessage: "The script could not be written. Try again.",
      logStart,
      label: "POST /script-draft"
    });

    const logStartRev = logLines.length;
    const resRev = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/script-draft/revise`,
      payload: { instruction: "Make it shorter", brief: validBrief }
    });
    assertJsonUpstreamError(resRev, {
      expectedStatus: 502,
      expectedCode: "script_failed",
      expectedMessage: "The change could not be made. Try again.",
      logStart: logStartRev,
      label: "POST /script-draft/revise"
    });
  }

  // =========================================================================
  // 5. GET & POST /v1/projects/:id/visuals
  // =========================================================================
  {
    const clayProj = await seedProject("claymation");
    const fp = visualFingerprint(clayProj);
    await updateProjectVisuals(clayProj.id, () => ({
      runId: randomUUID(),
      fingerprint: fp,
      look: "claymation",
      recipeVersion: 1,
      status: "failed",
      budgetUsd: 25,
      reservedUsd: 0.25,
      imageModel: "img",
      videoModel: "vid",
      shots: {},
      error: CANARY_MESSAGE,
      updatedAt: new Date().toISOString()
    }));

    const logStartGet1 = logLines.length;
    const resGet1 = await app.inject({
      method: "GET",
      url: `/v1/projects/${clayProj.id}/visuals`
    });
    assert.equal(resGet1.statusCode, 200);
    assertNoCanaryInText(resGet1.body, "GET /visuals (stored planVisuals.error)");
    const bodyGet1 = resGet1.json();
    assert.equal(bodyGet1.status, "failed");
    assert.equal(bodyGet1.error, "Material generation failed.");
    assert.equal(resGet1.headers["x-request-id"], bodyGet1.requestId);
    assertLoggedCanaryWithRequestId(logStartGet1, bodyGet1.requestId, "GET /visuals (stored planVisuals.error)");

    // Also test POST /v1/projects/:id/visuals when queue/DB fails with canary
    const clayProj2 = await seedProject("claymation");
    const origBossSend = boss.send.bind(boss);
    boss.send = async () => {
      throw new Error(CANARY_MESSAGE);
    };
    try {
      const logStartPost = logLines.length;
      const resPost = await app.inject({
        method: "POST",
        url: `/v1/projects/${clayProj2.id}/visuals`,
        payload: { budgetUsd: 25 }
      });
      assertJsonUpstreamError(resPost, {
        expectedStatus: 409,
        expectedCode: "visual_generation",
        expectedMessage: "Generation unavailable.",
        logStart: logStartPost,
        label: "POST /visuals"
      });
    } finally {
      boss.send = origBossSend;
    }
  }

  // =========================================================================
  // 6. SSE routes in plan/routes.ts: script/stream, script/frames, script/voice, script/animate
  // =========================================================================
  {
    const parseSseEvents = (raw) =>
      raw
        .split("\n\n")
        .map((block) => block.trim())
        .filter((block) => block.startsWith("data:"))
        .map((block) => JSON.parse(block.slice(5).trim()));

    // 6a. POST /v1/projects/:id/script/stream
    const logStartStream = logLines.length;
    const resStream = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/script/stream`,
      headers: { "x-request-id": "sse-stream-12345" },
      payload: { brief: validBrief }
    });
    assert.equal(resStream.statusCode, 200);
    assertNoCanaryInText(resStream.body, "SSE /script/stream");
    const streamEvents = parseSseEvents(resStream.body);
    const streamErr = streamEvents.find((e) => e.error);
    assert.ok(streamErr, "SSE /script/stream emitted error event");
    assert.equal(streamErr.error, "Could not write the script.");
    assert.equal(streamErr.requestId, "sse-stream-12345");
    assert.equal(resStream.headers["x-request-id"], "sse-stream-12345");
    assertLoggedCanaryWithRequestId(logStartStream, "sse-stream-12345", "SSE /script/stream");

    // 6b. POST /v1/projects/:id/script/frames
    const logStartFrames = logLines.length;
    const resFrames = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/script/frames`,
      headers: { "x-request-id": "sse-frames-12345" },
      payload: { brief: validBrief, beats: validBrief.scriptBeats, indices: [0] }
    });
    assert.equal(resFrames.statusCode, 200);
    assertNoCanaryInText(resFrames.body, "SSE /script/frames");
    const frameEvents = parseSseEvents(resFrames.body);
    const frameErr = frameEvents.find((e) => e.error);
    assert.ok(frameErr, "SSE /script/frames emitted frame error event");
    assert.equal(frameErr.index, 0);
    assert.equal(frameErr.error, "Could not draw this frame.");
    assert.equal(frameErr.requestId, "sse-frames-12345");
    assert.equal(resFrames.headers["x-request-id"], "sse-frames-12345");
    assertLoggedCanaryWithRequestId(logStartFrames, "sse-frames-12345", "SSE /script/frames");

    // 6c. POST /v1/projects/:id/script/voice (both take-error and music-error)
    const logStartVoice = logLines.length;
    const resVoice = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/script/voice`,
      headers: { "x-request-id": "sse-voice-123456" },
      payload: { brief: validBrief, beats: [validBrief.scriptBeats[0]], force: true, includeMusic: true }
    });
    assert.equal(resVoice.statusCode, 200);
    assertNoCanaryInText(resVoice.body, "SSE /script/voice");
    const voiceEvents = parseSseEvents(resVoice.body);
    const takeErr = voiceEvents.find((e) => e.type === "take-error");
    const musicErr = voiceEvents.find((e) => e.type === "music-error");
    assert.ok(takeErr, "SSE /script/voice emitted take-error");
    assert.equal(takeErr.error, "Could not record voiceover for this scene.");
    assert.equal(takeErr.requestId, "sse-voice-123456");
    assert.ok(musicErr, "SSE /script/voice emitted music-error");
    assert.equal(musicErr.error, "Could not generate background music.");
    assert.equal(musicErr.requestId, "sse-voice-123456");
    assert.equal(resVoice.headers["x-request-id"], "sse-voice-123456");
    assertLoggedCanaryWithRequestId(logStartVoice, "sse-voice-123456", "SSE /script/voice");

    // 6d. POST /v1/projects/:id/script/animate
    const animProj = await seedProject();
    let getProjectCalls = 0;
    pool.query = async function (text, values) {
      const sql = typeof text === "string" ? text : text?.text ?? "";
      if (/select data from app\.projects/i.test(sql)) {
        getProjectCalls += 1;
        if (getProjectCalls >= 2) {
          throw new Error(CANARY_MESSAGE);
        }
      }
      return origQuery(text, values);
    };
    try {
      const logStartAnim = logLines.length;
      const resAnim = await app.inject({
        method: "POST",
        url: `/v1/projects/${animProj.id}/script/animate`,
        headers: { "x-request-id": "sse-anim-1234567" },
        payload: { brief: { ...validBrief, audio: { mode: "none" } }, beats: validBrief.scriptBeats }
      });
      assert.equal(resAnim.statusCode, 200);
      assertNoCanaryInText(resAnim.body, "SSE /script/animate");
      const animEvents = parseSseEvents(resAnim.body);
      const animErr = animEvents.find((e) => e.type === "error");
      assert.ok(animErr, "SSE /script/animate emitted error event");
      assert.equal(animErr.error, "Could not prepare the browser animation.");
      assert.equal(animErr.requestId, "sse-anim-1234567");
      assert.equal(resAnim.headers["x-request-id"], "sse-anim-1234567");
      assertLoggedCanaryWithRequestId(logStartAnim, "sse-anim-1234567", "SSE /script/animate");
    } finally {
      pool.query = origQuery;
    }
  }

  // =========================================================================
  // 7. POST /v1/formats/:skill/render (formats/routes.ts)
  // =========================================================================
  {
    const logStart = logLines.length;
    const res = await app.inject({
      method: "POST",
      url: "/v1/formats/gm-velocity-sting/render",
      payload: {
        brief: "A fast billing and invoicing SaaS for freelancers.",
        values: { d_to: 2416 }
      }
    });
    assertJsonUpstreamError(res, {
      expectedStatus: 502,
      expectedCode: "fill_failed",
      expectedMessage: "The slots could not be written.",
      logStart,
      label: "POST /v1/formats/:skill/render"
    });
  }

  // =========================================================================
  // 8. Plate routes (plates/routes.ts: draw, comments, fix, draw-aspect, export)
  // =========================================================================
  {
    config.plates.enabled = true;
    const plateProj = await seedProject("illus-fox");
    const plateCases = [
      { method: "POST", url: `/v1/projects/${plateProj.id}/plates/draw`, payload: {}, status: 409, msg: "Could not draw the scenes." },
      { method: "POST", url: `/v1/projects/${plateProj.id}/plates/comments`, payload: { at: 1.5, body: "warmer light" }, status: 400, msg: "Could not add the comment." },
      { method: "POST", url: `/v1/projects/${plateProj.id}/plates/fix`, payload: {}, status: 409, msg: "Could not redraw the scenes." },
      { method: "POST", url: `/v1/projects/${plateProj.id}/plates/draw-aspect`, payload: { aspect: "9:16" }, status: 409, msg: "Could not draw this dimension." },
      { method: "POST", url: `/v1/projects/${plateProj.id}/plates/export`, payload: { aspect: "16:9" }, status: 409, msg: "Could not start the export." }
    ];
    for (const c of plateCases) {
      pool.query = async function (text, values) {
        const sql = typeof text === "string" ? text : text?.text ?? "";
        if (/plate_state|plate_variants|plate_exports/i.test(sql)) {
          throw new Error(CANARY_MESSAGE);
        }
        return origQuery(text, values);
      };
      try {
        const logStart = logLines.length;
        const res = await app.inject({
          method: c.method,
          url: c.url,
          payload: c.payload
        });
        assertJsonUpstreamError(res, {
          expectedStatus: c.status,
          expectedCode: "plates",
          expectedMessage: c.msg,
          logStart,
          label: `${c.method} ${c.url}`
        });
      } finally {
        pool.query = origQuery;
      }
    }
  }

  // =========================================================================
  // 9. POST /v1/projects/:id/site (site/routes.ts) & server.ts projectError / brandError
  // =========================================================================
  {
    pool.query = async function (text, values) {
      const sql = typeof text === "string" ? text : text?.text ?? "";
      if (/update app\.projects/i.test(sql)) {
        throw new Error(CANARY_MESSAGE);
      }
      return origQuery(text, values);
    };
    try {
      const logStartSite = logLines.length;
      const resSite = await app.inject({
        method: "POST",
        url: `/v1/projects/${proj.id}/site`,
        payload: { url: "https://127.0.0.1:1" }
      });
      // Note: safeFetch refuses 127.0.0.1 with FetchRefused (400 domain error); test both domain error and 502 site_failed!
      assert.equal(resSite.statusCode, 400);
      assert.equal(resSite.json().error.code, "site_unreadable");
    } finally {
      pool.query = origQuery;
    }

    const logStartProjErr = logLines.length;
    const resProjErr = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/script`
    });
    assertJsonUpstreamError(resProjErr, {
      expectedStatus: 422,
      expectedCode: "project_failed",
      expectedMessage: "Could not update this project.",
      logStart: logStartProjErr,
      label: "server.ts projectError"
    });

    const logStartBrandErr = logLines.length;
    const resBrandErr = await app.inject({
      method: "POST",
      url: "/v1/brands/extract",
      payload: { url: "https://example.com" }
    });
    assertJsonUpstreamError(resBrandErr, {
      expectedStatus: 422,
      expectedCode: "brand_failed",
      expectedMessage: "Could not process the brand.",
      logStart: logStartBrandErr,
      label: "server.ts brandError"
    });
  }

  // =========================================================================
  // 10. Domain / validation errors keep their specific messages
  // =========================================================================
  {
    const freshProj = await getProject(proj.id);
    const planVersion = computePlanVersion(freshProj);
    // EditRefusedError on commit (overlap between b2:w:2 and b2:w:0)
    const overlapAfter = [
      {
        time: 7.23,
        elements: b2Elements.map((el) =>
          el.id === "b2:w:2" ? { ...el, box: [240, 389, 460, 180] } : el
        )
      }
    ];
    const resCommitRefused = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/commit`,
      payload: {
        planVersion,
        items: [
          {
            id: "c-overlap",
            patch: { scope: "scene", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { dx: -200, dy: -200 } },
            before: b2Snapshots,
            after: overlapAfter
          }
        ]
      }
    });
    assert.equal(resCommitRefused.statusCode, 422);
    assert.equal(resCommitRefused.json().error.code, "edit_refused");
    assert.match(resCommitRefused.json().error.message, /overlap with another element on screen \(b2:w:0\)/i);

    // InvalidSnapshotsError on propose
    const resBadSnap = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: "make it pink" }],
        measured: { canvas: { width: 0, height: 1080 }, snapshots: {} }
      }
    });
    assert.equal(resBadSnap.statusCode, 400);
    assert.equal(resBadSnap.json().error.code, "invalid_snapshots");
    assert.match(resBadSnap.json().error.message, /canvas/i);
  }

  console.log("upstream-errors: ok");
} finally {
  globalThis.fetch = origFetch;
  pool.query = origQuery;
  setDefaultModelTranslatorOptions(null);
  await app.close();
  if (createdProjects.length > 0) {
    await pool.query("delete from app.projects where id = any($1) or owner_id = $2", [createdProjects, TEST_OWNER]);
  }
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
