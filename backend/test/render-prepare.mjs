// DB-free unit tests for RenderService.prepareFilm on plate projects:
// - pending comments apply once via fixPlates before waitForAuthoring (and log render_applied_comments);
// - answered / empty comments do not call fixPlates;
// - all chosen ratios (brief + subtitles) are awaited under a shared 10-minute budget and exported;
// - companion ratio failure is recorded per ratio without failing the job or refunding tokens;
// - primary ratio failure still fails the job and refunds tokens once.
//
//   node test/render-prepare.mjs
import assert from "node:assert/strict";

process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";

const { RenderService, PLATE_AUTHOR_TIMEOUT_MS } = await import("../src/render/service.ts");
const { NotDrawn } = await import("../src/plates/exports.ts");

let passed = 0;
const check = async (name, run) => {
  await run();
  passed++;
  console.log(`ok - ${name}`);
};

function makeHarness(options = {}) {
  const jobId = options.jobId ?? "job-1";
  const projectId = options.projectId ?? "proj-1";
  const ownerId = options.ownerId ?? "user-1";
  const spendEvent = options.spendEvent ?? "spend-1";
  let clock = options.now ?? 1_000_000;

  const project = {
    id: projectId,
    name: "Plate Launch Film",
    renderJobId: jobId,
    state: "Draft",
    request: { prompt: "Launch film", format: "landscape", style: "kinetic" },
    brief: {
      look: "illus-paper",
      aspect: options.primaryAspect ?? "16:9",
      aspects: options.briefAspects ?? ["16:9"],
      scriptBeats: [
        { keyword: "hook", line: "First line", onScreen: "Hook", visual: "A lantern" },
        { keyword: "cta", line: "Second line", onScreen: "CTA", visual: "A boat" }
      ]
    },
    beatPlan: {
      target_duration_s: 10,
      canvas: "1920x1080",
      audio: {},
      beats: [
        { id: "b1", role: "hook", keyword: "hook", line: "First line" },
        { id: "b2", role: "cta", keyword: "cta", line: "Second line" }
      ]
    },
    comments: [],
    screenshots: []
  };

  const prep = {
    kind: "beat-plan",
    watermark: false,
    motionBlur: false,
    ownerId,
    spendEvent
  };

  const jobRow = {
    id: jobId,
    project_id: projectId,
    owner_id: ownerId,
    state: "planning",
    stage: "planning",
    progress: 15,
    attempt: 0,
    frames_done: null,
    frames_total: null,
    request: project.request,
    planned_revision: null,
    revision: { id: "rev-1", title: project.name, scenes: [] },
    output: null,
    error: null,
    created_at: new Date(clock),
    updated_at: new Date(clock),
    render_queued_at: null,
    prep
  };

  const calls = [];
  const logs = [];
  const refunds = [];
  const queuedRenders = [];
  const failedJobs = [];
  const updatedProjects = [];

  const deps = {
    now: () => clock,
    authorTimeoutMs: options.authorTimeoutMs ?? PLATE_AUTHOR_TIMEOUT_MS,
    log: (entry) => {
      logs.push(entry);
    },
    getProject: async (id) => (id === projectId ? project : null),
    updateProject: async (id, patch) => {
      updatedProjects.push({ id, patch });
      Object.assign(project, patch);
      return project;
    },
    isPlateLook: () => true,
    startPlates: async (id) => {
      calls.push({ fn: "startPlates", projectId: id });
      return {};
    },
    readProjectState: async (id) => {
      calls.push({ fn: "readProjectState", projectId: id });
      return {
        comments: options.comments ?? [],
        subtitles: options.subtitles ?? null,
        liveMode: "live",
        drawAspects: []
      };
    },
    fixPlates: async (id) => {
      calls.push({ fn: "fixPlates", projectId: id });
      if (options.onFixPlates) return await options.onFixPlates(id);
      return {};
    },
    waitForAuthoring: async (id, aspect, waitOpts) => {
      calls.push({ fn: "waitForAuthoring", projectId: id, aspect, timeoutMs: waitOpts?.timeoutMs, expectedScenes: waitOpts?.expectedScenes });
      if (options.advanceMsByAspect?.[aspect]) {
        clock += options.advanceMsByAspect[aspect];
      }
      if (options.onWaitForAuthoring) {
        return await options.onWaitForAuthoring(id, aspect, waitOpts);
      }
      await waitOpts?.onProgress?.({ done: 2, total: 2 });
      return [];
    },
    buildExport: async (proj, aspect, watermark) => {
      calls.push({ fn: "buildExport", projectId: proj.id, aspect, watermark });
      if (options.onBuildExport) {
        return await options.onBuildExport(proj, aspect, watermark);
      }
      return {
        manifest: {},
        manifestKey: `plates/${proj.id}/manifests/${aspect}/manifest.json`,
        manifestDigest: `digest-${aspect}`,
        signature: `sig-${aspect}`,
        durationSeconds: 8
      };
    },
    requestExport: async (proj, aspect, watermark) => {
      calls.push({ fn: "requestExport", projectId: proj.id, aspect, watermark });
      if (options.onRequestExport) {
        return await options.onRequestExport(proj, aspect, watermark);
      }
      return {
        id: `exp-${aspect}`,
        project_id: proj.id,
        aspect,
        signature: `sig-${aspect}`,
        state: "queued",
        stage: null,
        progress: 0,
        manifest_key: `plates/${proj.id}/manifests/${aspect}/manifest.json`,
        output_key: null,
        duration_seconds: "8",
        error: null,
        updated_at: new Date(clock),
        enqueued_at: new Date(clock)
      };
    },
    refundSpend: async (u, ev) => {
      calls.push({ fn: "refundSpend", ownerId: u, spendEvent: ev });
      refunds.push({ ownerId: u, spendEvent: ev });
    },
    repository: {
      updatePlanning: async (id, patch) => {
        jobRow.stage = patch.stage;
        jobRow.progress = patch.progress;
      },
      queueRender: async (id, revision, renderInput) => {
        calls.push({ fn: "queueRender", id, aspect: renderInput.aspect });
        jobRow.state = "rendering";
        jobRow.stage = "waiting";
        jobRow.progress = 45;
        jobRow.revision = revision;
        queuedRenders.push({ id, revision, renderInput });
        return true;
      },
      failIfUnfinished: async (id, failure, keepRecorded) => {
        calls.push({ fn: "failIfUnfinished", id, failure, keepRecorded });
        jobRow.state = "failed";
        jobRow.stage = "failed";
        jobRow.progress = 100;
        jobRow.error = failure;
        failedJobs.push({ id, failure, keepRecorded });
        return jobRow;
      },
      row: async (id) => (id === jobId ? jobRow : null)
    }
  };

  const service = new RenderService(deps);
  return {
    service,
    run: () => service.prepareFilm(jobId, jobRow, prep),
    calls,
    logs,
    refunds,
    queuedRenders,
    failedJobs,
    updatedProjects,
    jobRow
  };
}

await check("comments pending -> fixPlates called once before waiting, logs render_applied_comments", async () => {
  const h = makeHarness({
    comments: [
      { id: "c1", at: 1.2, scene: 1, sceneAt: 1.2, body: "Make the boat larger" },
      { id: "c2", at: 0.4, scene: 0, sceneAt: 0.4, body: "Warm up the lantern" },
      { id: "c3", at: 0.8, scene: 1, sceneAt: 0.8, body: "Already in flight", fixing: 2 }
    ]
  });
  await h.run();

  const fnOrder = h.calls.map((c) => c.fn);
  const fixIdx = fnOrder.indexOf("fixPlates");
  const waitIdx = fnOrder.indexOf("waitForAuthoring");
  assert.equal( fnOrder.filter((f) => f === "fixPlates").length, 1, "fixPlates called once" );
  assert.ok(fixIdx > fnOrder.indexOf("readProjectState") && fixIdx < waitIdx, "fixPlates runs before waitForAuthoring");

  const appliedLogs = h.logs.filter((l) => l.event === "render_applied_comments");
  assert.equal(appliedLogs.length, 1);
  assert.deepEqual(appliedLogs[0], {
    level: "info",
    event: "render_applied_comments",
    projectId: "proj-1",
    scenes: [0, 1]
  });
  assert.equal(h.queuedRenders.length, 1);
  assert.equal(h.failedJobs.length, 0);
});

await check("none pending -> fixPlates not called (empty comments or all already fixing)", async () => {
  const empty = makeHarness({ comments: [] });
  await empty.run();
  assert.equal(empty.calls.filter((c) => c.fn === "fixPlates").length, 0, "no fixPlates when comments empty");
  assert.equal(empty.logs.filter((l) => l.event === "render_applied_comments").length, 0);

  const alreadyFixing = makeHarness({
    comments: [{ id: "c1", at: 1.0, scene: 0, sceneAt: 1.0, body: "Already fixing", fixing: 1 }]
  });
  await alreadyFixing.run();
  assert.equal(alreadyFixing.calls.filter((c) => c.fn === "fixPlates").length, 0, "no fixPlates when all comments have fixing set");
  assert.equal(alreadyFixing.logs.filter((l) => l.event === "render_applied_comments").length, 0);
});

await check('fixPlates throwing "Add a comment first." is treated as nothing to do', async () => {
  const h = makeHarness({
    comments: [{ id: "c1", at: 1.0, scene: 0, sceneAt: 1.0, body: "Race cleared" }],
    onFixPlates: async () => {
      throw new Error("Add a comment first.");
    }
  });
  await h.run();
  assert.equal(h.calls.filter((c) => c.fn === "fixPlates").length, 1);
  assert.equal(h.queuedRenders.length, 1, "render still proceeds");
  assert.equal(h.failedJobs.length, 0);
});

await check("two ratios -> both awaited and exported under shared 10-minute wait budget", async () => {
  const h = makeHarness({
    primaryAspect: "16:9",
    briefAspects: ["16:9"],
    subtitles: { mode: "full", style: "pill", aspects: ["16:9", "9:16"] },
    advanceMsByAspect: { "16:9": 180_000 }
  });
  const result = await h.run();

  const waits = h.calls.filter((c) => c.fn === "waitForAuthoring");
  assert.deepEqual(
    waits.map((w) => w.aspect),
    ["16:9", "9:16"],
    "both primary and companion ratios are awaited"
  );
  assert.equal(waits[0].timeoutMs, PLATE_AUTHOR_TIMEOUT_MS, "primary starts with full 10-minute budget");
  assert.equal(waits[1].timeoutMs, PLATE_AUTHOR_TIMEOUT_MS - 180_000, "companion shares the remaining budget");

  const primaryExports = h.calls.filter((c) => c.fn === "buildExport");
  const companionExports = h.calls.filter((c) => c.fn === "requestExport");
  assert.deepEqual(primaryExports.map((e) => e.aspect), ["16:9"]);
  assert.deepEqual(companionExports.map((e) => e.aspect), ["9:16"]);
  assert.equal(h.queuedRenders.length, 1);
  assert.equal(result?.companions?.["9:16"]?.state, "queued");
});

await check("companion failure does not fail the job and does not refund", async () => {
  const h = makeHarness({
    primaryAspect: "16:9",
    briefAspects: ["16:9", "9:16", "1:1"],
    onWaitForAuthoring: async (_id, aspect) => {
      if (aspect === "9:16") {
        throw new NotDrawn("Scene 2 (cta) timed out while being authored.", "failed", {
          code: "author_timeout",
          sceneIndex: 1
        });
      }
      return [];
    }
  });
  const result = await h.run();

  assert.equal(h.queuedRenders.length, 1, "primary render is still queued");
  assert.equal(h.queuedRenders[0].renderInput.aspect, "16:9");
  assert.equal(h.failedJobs.length, 0, "job is not failed");
  assert.equal(h.refunds.length, 0, "tokens are not refunded");
  assert.deepEqual(result?.companions?.["9:16"], {
    state: "failed",
    code: "author_timeout",
    message: "Scene 2 (cta) timed out while being authored."
  });
  assert.equal(result?.companions?.["1:1"]?.state, "queued", "other companion ratios still export");
});

await check("primary failure still fails the job and refunds once", async () => {
  const h = makeHarness({
    primaryAspect: "16:9",
    briefAspects: ["16:9", "9:16"],
    onWaitForAuthoring: async (_id, aspect) => {
      if (aspect === "16:9") {
        throw new NotDrawn("Scene 1 (hook): could not be authored.", "failed", {
          code: "author_failed",
          sceneIndex: 0
        });
      }
      return [];
    }
  });
  await h.run();

  assert.equal(h.queuedRenders.length, 0, "render is not queued when primary fails");
  assert.equal(h.failedJobs.length, 1, "job is marked failed");
  assert.equal(h.failedJobs[0].failure.code, "author_failed");
  assert.match(h.failedJobs[0].failure.message, /Scene 1 \(hook\)/);
  assert.deepEqual(h.refunds, [{ ownerId: "user-1", spendEvent: "spend-1" }], "tokens are refunded once");
  assert.equal(h.updatedProjects.at(-1)?.patch.state, "Render needs attention");
});

console.log(`\n${passed} checks passed`);
