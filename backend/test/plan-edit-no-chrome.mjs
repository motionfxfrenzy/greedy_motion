// Backend test proving:
// 1. The server edit path (`routes.ts` + `element-edits.ts`) never imports or launches Chrome (`playwright-core` resolution blocked via module hook)
// 2. `POST /v1/projects/:id/plan/edit/propose` and `POST /v1/projects/:id/plan/edit/commit` work with pure JSON snapshots
// 3. Strict snapshot validation (invalid data-el ids, non-finite boxes, >64 elements/snapshot, >24 snapshots/comment)
// 4. Stale `planVersion` refused with HTTP 409
// 5. Rules-first + model-translator chain (`COMMENT_TO_PATCH_SYSTEM_PROMPT`, `anthropicMessage` timeout & usage logging, `validateEditPatch` guard) across 10 recorded comment cases with zero real model API calls.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

// Block `playwright-core` and `playwright` resolution before importing any backend modules
if (typeof Module.registerHooks === "function") {
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "playwright-core" || specifier === "playwright" || specifier.includes("playwright-core")) {
        throw new Error(`FORBIDDEN_PLAYWRIGHT_IMPORT: server path attempted to import "${specifier}"`);
      }
      return nextResolve(specifier, context);
    }
  });
}

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(HERE, "..");

// Verify source files contain no playwright-core or getSharedBrowser references
const elementEditsSrc = readFileSync(join(BACKEND_DIR, "src/plan/element-edits.ts"), "utf8");
const routesSrc = readFileSync(join(BACKEND_DIR, "src/plan/routes.ts"), "utf8");
assert.ok(!elementEditsSrc.includes("playwright-core"), "element-edits.ts must not reference playwright-core");
assert.ok(!elementEditsSrc.includes("getSharedBrowser"), "element-edits.ts must not contain getSharedBrowser");
assert.ok(!elementEditsSrc.includes("sampleCompositionElements"), "element-edits.ts must not contain sampleCompositionElements");
assert.ok(!routesSrc.includes("sampleCompositionElements"), "routes.ts must not reference sampleCompositionElements");

const { migrate, pool } = await import("../src/db/database.ts");
const { createProject, getProject } = await import("../src/projects/store.ts");
const { registerPlanRoutes } = await import("../src/plan/routes.ts");
const {
  proposeHyperFramesCommentEdits,
  translateCommentWithRulesThenModel
} = await import("../src/plan/element-edits.ts");
const { resolveBeatWindowTimes } = await import("@videosaas/contracts");

await migrate();

const app = Fastify();
await registerPlanRoutes(app);
await app.ready();

const createdProjects = [];

function makeSeed(screenshotId) {
  const beats = [
    {
      id: "b1",
      role: "hook",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Every product update deserves a clear story that customers watch.",
      verb: null,
      keyword: "Your story, moving.",
      on_screen: "Every beat of the plan, on screen",
      success: false,
      energy: "high",
      motion: { camera: "steady", entry: { axis: "x", dir: -1 }, exit: { axis: "y", dir: -1 }, text_effect: "waterfall" },
      sfx: "impact-bass-1",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b2",
      role: "success",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Start from a short brief and get a timed storyboard.",
      verb: null,
      keyword: "Ready to share.",
      on_screen: "One prompt builds the plan",
      success: true,
      energy: "high",
      motion: { camera: "steady", entry: { axis: "y", dir: -1 }, exit: { axis: "x", dir: -1 }, text_effect: "waterfall" },
      sfx: "pop",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b3",
      role: "feature",
      kind: "ui",
      producer: "hyperframes",
      line: "Click the publish button to launch the release.",
      verb: "click",
      keyword: "One click ships.",
      on_screen: "Live inside the dashboard",
      success: false,
      energy: "medium",
      ui: { screen: screenshotId, action: "click", target: "publish button" },
      motion: { camera: "steady", entry: { axis: "x", dir: -1 }, exit: { axis: "x", dir: -1 }, text_effect: "waterfall" },
      sfx: "click",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b4",
      role: "cta",
      kind: "title",
      producer: "hyperframes",
      line: "Approve the animation and render the finished film.",
      verb: null,
      keyword: "Make it move.",
      on_screen: "Get started",
      success: false,
      energy: "medium",
      motion: { camera: "steady", entry: { axis: "x", dir: -1 }, exit: { axis: "z", dir: 1 }, text_effect: "waterfall" },
      sfx: "chime",
      scene: null,
      transition_out: { type: "end", carrier: null }
    }
  ];

  const brief = {
    scriptMode: "own",
    text: beats.map((b) => b.line).join(" "),
    durationSeconds: 12,
    aspect: "16:9",
    motionProfile: "smooth",
    pace: "calm",
    audio: { mode: "none", voice: "Kore" },
    captions: "key-phrases",
    template: null,
    theme: "neutral",
    videoType: "promo",
    productName: "Relay",
    screenshotIds: [screenshotId]
  };

  const beatPlan = {
    version: "1.0",
    mode: "own-script",
    template: null,
    format: "social",
    canvas: "16:9",
    target_duration_s: 12,
    clock: "beats",
    brand: { name: "Relay", motion_profile: "smooth", style_frame: null },
    characters: [],
    beats,
    audio: { voice: null, music: null, captions: "key-phrases" },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: [],
    estimate: { generated_shots: 0, api_usd: 0.05, render_s: 12 }
  };

  return { brief, beatPlan };
}

async function seedProject() {
  const created = await createProject({
    name: `no-chrome-edit-test-${randomUUID().slice(0, 8)}`,
    request: {
      prompt: "No-Chrome two-step edit protocol test",
      format: "landscape",
      style: "clean",
      theme: "neutral",
      template: "product-launch",
      audio: { music: false, voiceover: false, voice: "Kore" }
    }
  });
  createdProjects.push(created.id);
  const shotId = randomUUID();
  const seed = makeSeed(shotId);
  await pool.query("update app.projects set data = data || $2::jsonb where id = $1", [
    created.id,
    JSON.stringify({
      ...seed,
      screenshots: [{ id: shotId, name: "dash.png", purpose: "Dashboard", width: 1600, height: 1000, createdAt: new Date().toISOString() }]
    })
  ]);
  return await getProject(created.id);
}

const b2Snapshots = [
  {
    time: 7.23,
    elements: [
      { id: "b2:w:0", role: "word", text: "Ready", box: [240, 389, 460, 180], beat: "b2", opacity: 1 },
      { id: "b2:w:1", role: "word", text: "to", box: [730, 389, 180, 180], beat: "b2", opacity: 1 },
      { id: "b2:w:2", role: "accent-word", text: "share.", box: [359, 585, 562, 198], beat: "b2", opacity: 1 },
      { id: "b2:sub:0", role: "subtitle", text: "One prompt builds the plan", box: [240, 810, 620, 56], beat: "b2", opacity: 1 }
    ]
  }
];

const b1Elements = [
  { id: "b1:w:0", role: "word", text: "Your", box: [240, 300, 360, 170], beat: "b1", opacity: 1 },
  { id: "b1:w:1", role: "word", text: "story,", box: [620, 300, 420, 170], beat: "b1", opacity: 1 },
  { id: "b1:w:2", role: "accent-word", text: "moving.", box: [240, 480, 650, 180], beat: "b1", opacity: 1 },
  { id: "b1:sub:0", role: "subtitle", text: "Every beat of the plan, on screen", box: [240, 720, 880, 56], beat: "b1", opacity: 1 }
];

const b4Elements = [
  { id: "b4:name:0", role: "name", text: "Relay", box: [720, 300, 480, 160], beat: "b4", opacity: 1 },
  { id: "b4:w:0", role: "word", text: "Make", box: [640, 500, 220, 110], beat: "b4", opacity: 1 },
  { id: "b4:w:1", role: "word", text: "it", box: [880, 500, 100, 110], beat: "b4", opacity: 1 },
  { id: "b4:w:2", role: "accent-word", text: "move.", box: [1000, 500, 260, 110], beat: "b4", opacity: 1 },
  { id: "b4:pill:0", role: "pill", text: "Get started", box: [773, 687, 374, 110], beat: "b4", opacity: 1 }
];

try {
  const project = await seedProject();

  // 1. Verify resolveBeatWindowTimes from @videosaas/contracts works identically
  const winInfo = resolveBeatWindowTimes(project, "b2", 7.23);
  assert.equal(winInfo.beat.id, "b2");
  assert.ok(winInfo.sampleTimes.length >= 2 && winInfo.sampleTimes.length <= 24);

  // 2. Verify strict snapshot validation on /plan/edit/propose
  {
    // 2a. Unknown element id prefix ("b99:w:0") -> 400
    const badIdRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: {
            c1: [
              {
                time: 7.23,
                elements: [{ id: "b99:w:0", role: "word", text: "share.", box: [300, 300, 200, 100] }]
              }
            ]
          }
        }
      }
    });
    assert.equal(badIdRes.statusCode, 400);
    assert.equal(badIdRes.json().error.code, "invalid_snapshots");

    // 2b. >64 elements in a snapshot -> 400
    const tooManyEls = Array.from({ length: 65 }, (_, idx) => ({
      id: `b2:w:${idx}`,
      role: "word",
      text: "word",
      box: [200, 200, 100, 50]
    }));
    const manyElsRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { c1: [{ time: 7.23, elements: tooManyEls }] }
        }
      }
    });
    assert.equal(manyElsRes.statusCode, 400);
    assert.match(manyElsRes.json().error.message, /at most 64/i);

    // 2c. >24 snapshots for a comment -> 400
    const tooManySnaps = Array.from({ length: 25 }, (_, idx) => ({
      time: 6 + idx * 0.05,
      elements: b2Snapshots[0].elements
    }));
    const manySnapsRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { c1: tooManySnaps }
        }
      }
    });
    assert.equal(manySnapsRes.statusCode, 400);
    assert.match(manySnapsRes.json().error.message, /at most 24/i);
  }

  // 3. Propose -> Commit with pure JSON snapshots (no Chrome!) + stale planVersion 409 check
  {
    const propRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c-pink", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { "c-pink": b2Snapshots }
        }
      }
    });
    assert.equal(propRes.statusCode, 200, propRes.body);
    const propBody = propRes.json();
    assert.ok(typeof propBody.planVersion === "string" && propBody.planVersion.length > 0);
    assert.equal(propBody.candidates.length, 1);
    assert.equal(propBody.candidates[0].patch.el, "b2:w:2");
    assert.equal(propBody.candidates[0].patch.set.color, "#ff3b6b");

    // Verify nothing was saved by propose
    const unchanged = await getProject(project.id);
    assert.equal(unchanged.beatPlan.overrides, undefined);

    // Verify stale planVersion is refused with 409
    const staleRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/commit`,
      payload: {
        planVersion: "stale-version-000",
        items: [
          {
            id: "c-pink",
            patch: propBody.candidates[0].patch,
            before: b2Snapshots,
            after: b2Snapshots
          }
        ]
      }
    });
    assert.equal(staleRes.statusCode, 409);
    assert.equal(staleRes.json().error.code, "stale_plan_version");

    // Commit with the valid planVersion
    const commitRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/commit`,
      payload: {
        planVersion: propBody.planVersion,
        items: [
          {
            id: "c-pink",
            patch: propBody.candidates[0].patch,
            before: b2Snapshots,
            after: b2Snapshots
          }
        ]
      }
    });
    assert.equal(commitRes.statusCode, 200, commitRes.body);
    const commitBody = commitRes.json();
    assert.equal(commitBody.results[0].scope, "element");
    assert.equal(commitBody.results[0].uiLabel, "changed colour");
    assert.equal(commitBody.results[0].el, "b2:w:2");
    assert.equal(commitBody.plan.overrides["b2:w:2"].color, "#ff3b6b");

    // Re-committing with the old planVersion now fails with 409 because the plan changed!
    const replayRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${project.id}/plan/edit/commit`,
      payload: {
        planVersion: propBody.planVersion,
        items: [
          {
            id: "c-pink",
            patch: propBody.candidates[0].patch,
            before: b2Snapshots,
            after: b2Snapshots
          }
        ]
      }
    });
    assert.equal(replayRes.statusCode, 409);
  }

  // 4. Test the 10 recorded comment cases for the rules-first + model translator chain
  const RECORDED_MODEL_CASES = [
    {
      name: "1. Deterministic rule match ('Make \"share.\" pink')",
      comment: 'Make "share." pink',
      scene: "b2",
      atSeconds: 7.23,
      beat: project.beatPlan.beats[1],
      activeElements: b2Snapshots[0].elements,
      modelResponse: null, // Model must NOT be called
      expectedSource: "deterministic",
      expectedFallback: false,
      expectedPatch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } }
    },
    {
      name: "2. Vague emphasis ('make the headline pop')",
      comment: "make the headline pop",
      scene: "b1",
      atSeconds: 2.35,
      beat: project.beatPlan.beats[0],
      activeElements: b1Elements,
      modelResponse: {
        scope: "scene",
        scene: "b1",
        atSeconds: 2.35,
        el: "b1:w:2",
        set: { scale: 1.25, color: "#ff3b6b" }
      },
      expectedSource: "model",
      expectedFallback: false,
      expectedPatch: { scope: "scene", scene: "b1", atSeconds: 2.35, el: "b1:w:2", set: { scale: 1.25, color: "#ff3b6b" } }
    },
    {
      name: "3. Vague mood / softness ('tone down the subtitle so it whispers')",
      comment: "tone down the subtitle so it whispers",
      scene: "b1",
      atSeconds: 2.35,
      beat: project.beatPlan.beats[0],
      activeElements: b1Elements,
      modelResponse: {
        scope: "element",
        scene: "b1",
        atSeconds: 2.35,
        el: "b1:sub:0",
        set: { opacity: 0.65 }
      },
      expectedSource: "model",
      expectedFallback: false,
      expectedPatch: { scope: "element", scene: "b1", atSeconds: 2.35, el: "b1:sub:0", set: { opacity: 0.65 } }
    },
    {
      name: "4. Colloquial copy tweak ('swap the last word for \"launch.\"')",
      comment: 'swap the last word for "launch."',
      scene: "b2",
      atSeconds: 7.23,
      beat: project.beatPlan.beats[1],
      activeElements: b2Snapshots[0].elements,
      modelResponse: {
        scope: "element",
        scene: "b2",
        atSeconds: 7.23,
        el: "b2:w:2",
        set: {},
        text: "launch."
      },
      expectedSource: "model",
      expectedFallback: false,
      expectedPatch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: {}, text: "launch." }
    },
    {
      name: "5. Non-English short phrase — French ('mets « share. » en bleu')",
      comment: "mets « share. » en bleu",
      scene: "b2",
      atSeconds: 7.23,
      beat: project.beatPlan.beats[1],
      activeElements: b2Snapshots[0].elements,
      modelResponse: {
        scope: "element",
        scene: "b2",
        atSeconds: 7.23,
        el: "b2:w:2",
        set: { color: "#3b82f6" }
      },
      expectedSource: "model",
      expectedFallback: false,
      expectedPatch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#3b82f6" } }
    },
    {
      name: "6. Non-English short phrase — Spanish ('más grande el botón')",
      comment: "más grande el botón",
      scene: "b4",
      atSeconds: 16.5,
      beat: project.beatPlan.beats[3],
      activeElements: b4Elements,
      modelResponse: {
        scope: "scene",
        scene: "b4",
        atSeconds: 16.5,
        el: "b4:pill:0",
        set: { scale: 1.3 }
      },
      expectedSource: "model",
      expectedFallback: false,
      expectedPatch: { scope: "scene", scene: "b4", atSeconds: 16.5, el: "b4:pill:0", set: { scale: 1.3 } }
    },
    {
      name: "7. Multi-element / whole-scene redesign ('rearrange both headlines and add a comparison row')",
      comment: "rearrange both headlines and add a comparison row",
      scene: "b1",
      atSeconds: 2.35,
      beat: project.beatPlan.beats[0],
      activeElements: b1Elements,
      modelResponse: {
        scope: "scene",
        scene: "b1",
        atSeconds: 2.35,
        set: {}
      },
      expectedSource: "fallback-scene",
      expectedFallback: true,
      expectedPatch: { scope: "scene", scene: "b1", atSeconds: 2.35, set: {} }
    },
    {
      name: "8. Multi-element invalid target id ('colour both b1:w:0 and b1:w:2', model returns el='b1:w:0,b1:w:2')",
      comment: "colour both b1:w:0 and b1:w:2",
      scene: "b1",
      atSeconds: 2.35,
      beat: project.beatPlan.beats[0],
      activeElements: b1Elements,
      modelResponse: {
        scope: "element",
        scene: "b1",
        atSeconds: 2.35,
        el: "b1:w:0,b1:w:2", // invalid el syntax -> rejected by validateEditPatch
        set: { color: "#ff3b6b" }
      },
      expectedSource: "fallback-scene",
      expectedFallback: true,
      expectedPatch: { scope: "scene", scene: "b1", atSeconds: 2.35, set: {} }
    },
    {
      name: "9. Impossible 3D/effect request ('spin the card 180 degrees in 3D with fire particles')",
      comment: "spin the card 180 degrees in 3D with fire particles",
      scene: "b3",
      atSeconds: 11.77,
      beat: project.beatPlan.beats[2],
      activeElements: b2Snapshots[0].elements,
      modelResponse: {
        refused: "3D rotation and particle effects are not supported; try adjusting colour, position, size, or wording."
      },
      expectedRefused: /3D rotation and particle effects are not supported/
    },
    {
      name: "10. Invalid model output / hallucinated element id (el='b99:w:9' not in activeElements)",
      comment: "give the ghost word a shimmer",
      scene: "b1",
      atSeconds: 2.35,
      beat: project.beatPlan.beats[0],
      activeElements: b1Elements,
      modelResponse: {
        scope: "element",
        scene: "b1",
        atSeconds: 2.35,
        el: "b99:w:9", // not in activeElements -> rejected, becomes scene rewrite, never a guess
        set: { color: "#22c55e" }
      },
      expectedSource: "fallback-scene",
      expectedFallback: true,
      expectedPatch: { scope: "scene", scene: "b1", atSeconds: 2.35, set: {} }
    }
  ];

  const recordedSummary = [];
  for (const tc of RECORDED_MODEL_CASES) {
    let modelCalls = 0;
    const usageLogs = [];
    const stubRequest = async (_url, init) => {
      modelCalls++;
      const reqBody = JSON.parse(init.body);
      assert.ok(reqBody.system.includes("EditPatch"), "system prompt is COMMENT_TO_PATCH_SYSTEM_PROMPT");
      assert.ok(init.signal, "timeout signal is passed to anthropicMessage");
      if (tc.modelResponse === null) {
        throw new Error(`Model should not have been called for deterministic case: ${tc.name}`);
      }
      return Response.json({
        content: [{ type: "text", text: JSON.stringify(tc.modelResponse) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 180, output_tokens: 42, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      });
    };

    if (tc.expectedRefused) {
      const prop = await proposeHyperFramesCommentEdits(
        project,
        {
          comments: [{ id: "c-refused", at: tc.atSeconds, scene: tc.scene, body: tc.comment }],
          measured: {
            canvas: { width: 1920, height: 1080 },
            snapshots: { "c-refused": [{ time: tc.atSeconds, elements: tc.activeElements }] }
          }
        },
        {
          modelOptions: {
            request: stubRequest,
            log: (line) => usageLogs.push(JSON.parse(line))
          }
        }
      );
      assert.equal(modelCalls, 1);
      assert.equal(usageLogs.length, 1);
      assert.equal(usageLogs[0].event, "anthropic_usage");
      assert.match(prop.candidates[0].refused ?? "", tc.expectedRefused);
      recordedSummary.push({
        name: tc.name,
        comment: tc.comment,
        modelCalls,
        outcome: `refused: ${prop.candidates[0].refused}`
      });
      continue;
    }

    const res = await translateCommentWithRulesThenModel(
      {
        comment: tc.comment,
        atSeconds: tc.atSeconds,
        scene: tc.scene,
        beat: tc.beat,
        activeElements: tc.activeElements,
        canvas: { width: 1920, height: 1080 }
      },
      {
        modelOptions: {
          request: stubRequest,
          log: (line) => usageLogs.push(JSON.parse(line))
        }
      }
    );

    if (tc.modelResponse === null) {
      assert.equal(modelCalls, 0, "deterministic comment must not call model");
    } else {
      assert.equal(modelCalls, 1, `expected 1 model call for ${tc.name}`);
      assert.equal(usageLogs.length, 1, `expected anthropic_usage log for ${tc.name}`);
      assert.equal(usageLogs[0].event, "anthropic_usage");
    }

    assert.equal(res.source, tc.expectedSource, `${tc.name}: source mismatch`);
    assert.equal(res.fallbackRewrite, tc.expectedFallback, `${tc.name}: fallbackRewrite mismatch`);
    assert.deepEqual(res.patch, tc.expectedPatch, `${tc.name}: patch mismatch`);
    recordedSummary.push({
      name: tc.name,
      comment: tc.comment,
      modelCalls,
      source: res.source,
      fallbackRewrite: res.fallbackRewrite,
      patch: res.patch
    });
  }

  console.log("RECORDED_MODEL_CASES_JSON:" + JSON.stringify(recordedSummary));
  console.log("plan-edit-no-chrome: ok");
} finally {
  await app.close();
  if (createdProjects.length > 0) {
    await pool.query("delete from app.projects where id = any($1)", [createdProjects]);
  }
  await pool.end();
}
