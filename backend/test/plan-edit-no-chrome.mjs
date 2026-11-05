// Backend test proving:
// 1. The server edit path (`routes.ts` + `element-edits.ts`) never imports or launches Chrome (`playwright-core` resolution blocked via module hook)
// 2. `POST /v1/projects/:id/plan/edit/propose` and `POST /v1/projects/:id/plan/edit/commit` work with pure JSON snapshots
// 3. Strict snapshot validation (invalid data-el ids, non-finite boxes, >64 elements/snapshot, >24 snapshots/comment)
// 4. Stale `planVersion` refused with HTTP 409
// 5. Rules-first + model-translator chain (`COMMENT_TO_PATCH_SYSTEM_PROMPT`, `anthropicMessage` timeout & usage logging, `validateEditPatch` guard) across 10 recorded comment cases with zero real model API calls.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

process.env.APP_ENV = "local";
process.env.PLANNER = "deterministic";
process.env.CREEM_API_KEY = "";
if (!/plates_unit|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(BACKEND_DIR, "..");

// B4: Ensure worker/templates/beat-plan/index.html is in sync with engine.js (build.mjs --check exits 0)
execFileSync(process.execPath, [join(REPO_ROOT, "worker/templates/beat-plan/build.mjs"), "--check"], {
  cwd: REPO_ROOT,
  stdio: "pipe"
});

// Verify source files contain no playwright-core or getSharedBrowser references
const elementEditsSrc = readFileSync(join(BACKEND_DIR, "src/plan/element-edits.ts"), "utf8");
const routesSrc = readFileSync(join(BACKEND_DIR, "src/plan/routes.ts"), "utf8");
assert.ok(!elementEditsSrc.includes("playwright-core"), "element-edits.ts must not reference playwright-core");
assert.ok(!elementEditsSrc.includes("getSharedBrowser"), "element-edits.ts must not contain getSharedBrowser");
assert.ok(!elementEditsSrc.includes("sampleCompositionElements"), "element-edits.ts must not contain sampleCompositionElements");
assert.ok(!routesSrc.includes("sampleCompositionElements"), "routes.ts must not reference sampleCompositionElements");

const { migrate, pool } = await import("../src/db/database.ts");
const { LOCAL_USER_ID } = await import("../src/config.ts");
const { registerOwnership } = await import("../src/access.ts");
const { registerPreviewMeter } = await import("../src/plan/preview-meter.ts");
const { createProject, getProject, updateProject } = await import("../src/projects/store.ts");
const { registerPlanRoutes } = await import("../src/plan/routes.ts");
const {
  computePlanVersion,
  proposeHyperFramesCommentEdits,
  setDefaultModelTranslatorOptions,
  translateCommentWithRulesThenModel
} = await import("../src/plan/element-edits.ts");
const { resolveBeatWindowTimes } = await import("@videosaas/contracts");

await migrate();

const app = Fastify();
await registerPlanRoutes(app);
await app.ready();

const TEST_OWNER = randomUUID();
const OTHER_OWNER = randomUUID();
const createdProjects = [];
await pool.query("delete from app.projects where owner_id = any($1)", [[TEST_OWNER, OTHER_OWNER]]);

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

async function seedProject(owner = TEST_OWNER) {
  const created = await createProject(
    {
      name: `no-chrome-edit-test-${randomUUID().slice(0, 8)}`,
      request: {
        prompt: "No-Chrome two-step edit protocol test",
        format: "landscape",
        style: "clean",
        theme: "neutral",
        template: "product-launch",
        audio: { music: false, voiceover: false, voice: "Kore" }
      }
    },
    owner
  );
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

  // 5. B1: Lost-update race on commit and override delete (compare-and-set under row lock)
  {
    const raceProj = await seedProject();
    const v0 = computePlanVersion(raceProj);

    // 5a. Two concurrent commits on the same planVersion: exactly one succeeds (200), the other gets 409 stale_plan_version
    const [cRes1, cRes2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/projects/${raceProj.id}/plan/edit/commit`,
        payload: {
          planVersion: v0,
          items: [
            {
              id: "race-1",
              patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } },
              before: b2Snapshots,
              after: b2Snapshots
            }
          ]
        }
      }),
      app.inject({
        method: "POST",
        url: `/v1/projects/${raceProj.id}/plan/edit/commit`,
        payload: {
          planVersion: v0,
          items: [
            {
              id: "race-2",
              patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:0", set: { color: "#22c55e" } },
              before: b2Snapshots,
              after: b2Snapshots
            }
          ]
        }
      })
    ]);
    const codes = [cRes1.statusCode, cRes2.statusCode].sort((a, b) => a - b);
    assert.deepEqual(codes, [200, 409], `Expected one 200 and one 409, got ${codes.join(", ")}`);
    const loser = cRes1.statusCode === 409 ? cRes1.json() : cRes2.json();
    assert.equal(loser.error.code, "stale_plan_version");

    // 5b. A commit racing a PATCH /plan never loses either write silently:
    // Case A: Commit starts on current version and runs concurrently with PATCH /plan (captions="full")
    const raceProj2 = await seedProject();
    const vStart = computePlanVersion(raceProj2);
    const [commitVsPatchCommit, commitVsPatchPatch] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/projects/${raceProj2.id}/plan/edit/commit`,
        payload: {
          planVersion: vStart,
          items: [
            {
              id: "race-commit",
              patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#06b6d4" } },
              before: b2Snapshots,
              after: b2Snapshots
            }
          ]
        }
      }),
      app.inject({
        method: "PATCH",
        url: `/v1/projects/${raceProj2.id}/plan`,
        payload: { captions: "full" }
      })
    ]);
    assert.equal(commitVsPatchPatch.statusCode, 200, "PATCH /plan must succeed");
    const afterRace2 = await getProject(raceProj2.id);
    assert.equal(afterRace2.beatPlan.audio.captions, "full", "PATCH /plan captions update must never be lost");
    if (commitVsPatchCommit.statusCode === 200) {
      // Commit ran first, then PATCH /plan ran on top of Commit's state -> BOTH writes are preserved!
      assert.equal(
        afterRace2.beatPlan.overrides?.["b2:w:2"]?.color,
        "#06b6d4",
        "When commit succeeds alongside PATCH /plan, commit's override must also be preserved"
      );
    } else {
      // PATCH /plan ran first, so commit was cleanly rejected with 409 stale_plan_version
      assert.equal(commitVsPatchCommit.statusCode, 409);
      assert.equal(commitVsPatchCommit.json().error.code, "stale_plan_version");
    }

    // Also test the reverse order explicitly: PATCH /plan queued right before commit on the same version -> commit gets 409, PATCH is kept
    const raceProj3 = await seedProject();
    const vStart3 = computePlanVersion(raceProj3);
    const [patchFirst, commitSecond] = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/v1/projects/${raceProj3.id}/plan`,
        payload: { captions: "none" }
      }),
      app.inject({
        method: "POST",
        url: `/v1/projects/${raceProj3.id}/plan/edit/commit`,
        payload: {
          planVersion: vStart3,
          items: [
            {
              id: "race-commit-2",
              patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#f97316" } },
              before: b2Snapshots,
              after: b2Snapshots
            }
          ]
        }
      })
    ]);
    assert.equal(patchFirst.statusCode, 200);
    const afterRace3 = await getProject(raceProj3.id);
    assert.equal(afterRace3.beatPlan.audio.captions, "none");
    if (commitSecond.statusCode === 200) {
      assert.equal(afterRace3.beatPlan.overrides?.["b2:w:2"]?.color, "#f97316");
    } else {
      assert.equal(commitSecond.statusCode, 409);
    }

    // 5c. DELETE /plan/overrides/:el compare-and-set: stale planVersion rejected with 409
    const staleDelRes = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${raceProj.id}/plan/overrides/${encodeURIComponent("b2:w:2")}?planVersion=stale-v0`
    });
    assert.equal(staleDelRes.statusCode, 409);
    assert.equal(staleDelRes.json().error.code, "stale_plan_version");
  }

  // 6. B2: Error mapping (ProjectInvalid -> 400 on commit & delete; model transport errors -> 502/503 on propose; malformed :el -> 400)
  {
    const errProj = await seedProject();
    const errVersion = computePlanVersion(errProj);

    // Put project in "Rendering draft" state
    await updateProject(errProj.id, { state: "Rendering draft" });

    const commitWhileRendering = await app.inject({
      method: "POST",
      url: `/v1/projects/${errProj.id}/plan/edit/commit`,
      payload: {
        planVersion: errVersion,
        items: [
          {
            id: "c-render",
            patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } },
            before: b2Snapshots,
            after: b2Snapshots
          }
        ]
      }
    });
    assert.equal(commitWhileRendering.statusCode, 400, "ProjectInvalid on commit must return 400, not 500");
    assert.equal(commitWhileRendering.json().error.code, "invalid_project");

    const deleteWhileRendering = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${errProj.id}/plan/overrides/${encodeURIComponent("b2:w:2")}`
    });
    assert.equal(deleteWhileRendering.statusCode, 400, "ProjectInvalid on override delete must return 400, not 500");
    assert.equal(deleteWhileRendering.json().error.code, "invalid_project");

    // Restore state to "Draft storyboard"
    await updateProject(errProj.id, { state: "Draft storyboard" });

    // Malformed URI encoding or invalid element id on DELETE /plan/overrides/:el -> 400
    const badUriDelete = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${errProj.id}/plan/overrides/%25E0%25A4%25A`
    });
    assert.equal(badUriDelete.statusCode, 400, "Malformed URI in :el must return 400, not 500");

    const badCharsDelete = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${errProj.id}/plan/overrides/${encodeURIComponent("red}*{display:none")}`
    });
    assert.equal(badCharsDelete.statusCode, 400, "Invalid element id characters in :el must return 400");

    // Model transport errors in POST /plan/edit/propose -> 502 / 503 with user-readable message
    try {
      setDefaultModelTranslatorOptions({
        sleep: async () => {},
        request: async () =>
          new Response(JSON.stringify({ error: { message: "Upstream model gateway failed" } }), {
            status: 502,
            headers: { "content-type": "application/json" }
          }),
        log: () => {}
      });
      const res502 = await app.inject({
        method: "POST",
        url: `/v1/projects/${errProj.id}/plan/edit/propose`,
        payload: {
          comments: [{ id: "c-vague", at: 7.23, scene: "b2", body: "make the headline pop" }],
          measured: {
            canvas: { width: 1920, height: 1080 },
            snapshots: { "c-vague": b2Snapshots }
          }
        }
      });
      assert.equal(res502.statusCode, 502, "Model 502 transport error must return 502");
      assert.equal(res502.json().error.code, "propose_failed");
      assert.match(res502.json().error.message, /Comment patch translation failed|Upstream model gateway failed/i);

      setDefaultModelTranslatorOptions({
        timeoutMs: 10,
        sleep: async () => {},
        request: async (_url, init) => {
          return await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted due to timeout");
              err.name = "TimeoutError";
              reject(err);
            });
          });
        },
        log: () => {}
      });
      const resTimeout = await app.inject({
        method: "POST",
        url: `/v1/projects/${errProj.id}/plan/edit/propose`,
        payload: {
          comments: [{ id: "c-timeout", at: 7.23, scene: "b2", body: "make the headline pop" }],
          measured: {
            canvas: { width: 1920, height: 1080 },
            snapshots: { "c-timeout": b2Snapshots }
          }
        }
      });
      assert.equal(resTimeout.statusCode, 503, "Model timeout error must return 503");
      assert.equal(resTimeout.json().error.code, "propose_failed");
    } finally {
      setDefaultModelTranslatorOptions(null);
    }
  }

  // 7. B3a: No preview_usage row for an unknown or unowned project UUID; owned project is charged when model runs
  {
    const meteredApp = Fastify();
    meteredApp.addHook("onRequest", async (request) => {
      request.user = { id: TEST_OWNER };
    });
    registerOwnership(meteredApp);
    registerPreviewMeter(meteredApp);
    await registerPlanRoutes(meteredApp);
    await meteredApp.ready();

    const prevLimits = process.env.PREVIEW_LIMITS;
    process.env.PREVIEW_LIMITS = "on";
    const unknownProjectId = randomUUID();
    const otherOwnedProject = await seedProject(OTHER_OWNER);
    const callerOwnedProject = await seedProject(TEST_OWNER);

    try {
      await pool.query("delete from app.preview_usage where user_id = $1 or project_id = any($2)", [
        TEST_OWNER,
        [unknownProjectId, otherOwnedProject.id, callerOwnedProject.id]
      ]);

      // 7a. Unknown random UUID -> 404 and 0 preview_usage rows (both COUNTED route and propose)
      const unknownCountedRes = await meteredApp.inject({
        method: "POST",
        url: `/v1/projects/${unknownProjectId}/plan/beats/b1/rewrite`,
        payload: { instruction: "Make it punchier" }
      });
      assert.equal(unknownCountedRes.statusCode, 404);
      const unknownRes = await meteredApp.inject({
        method: "POST",
        url: `/v1/projects/${unknownProjectId}/plan/edit/propose`,
        payload: {
          comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
          measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
        }
      });
      assert.equal(unknownRes.statusCode, 404);
      const unknownUsage = await pool.query("select count(*)::int as n from app.preview_usage where project_id = $1", [
        unknownProjectId
      ]);
      assert.equal(unknownUsage.rows[0].n, 0, "Unknown project UUID must create no preview_usage row");

      // 7b. Unowned project UUID (belongs to OTHER_OWNER) -> 404 and 0 preview_usage rows (both COUNTED route and propose)
      const unownedCountedRes = await meteredApp.inject({
        method: "POST",
        url: `/v1/projects/${otherOwnedProject.id}/plan/beats/b1/rewrite`,
        payload: { instruction: "Make it punchier" }
      });
      assert.equal(unownedCountedRes.statusCode, 404);
      const unownedRes = await meteredApp.inject({
        method: "POST",
        url: `/v1/projects/${otherOwnedProject.id}/plan/edit/propose`,
        payload: {
          comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
          measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
        }
      });
      assert.equal(unownedRes.statusCode, 404);
      const unownedUsage = await pool.query("select count(*)::int as n from app.preview_usage where project_id = $1", [
        otherOwnedProject.id
      ]);
      assert.equal(unownedUsage.rows[0].n, 0, "Unowned project UUID must create no preview_usage row");

      // 7c. Real project owned by caller: rule-only propose is free; model-backed propose charges once
      const ruleOwnedRes = await meteredApp.inject({
        method: "POST",
        url: `/v1/projects/${callerOwnedProject.id}/plan/edit/propose`,
        payload: {
          comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
          measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
        }
      });
      assert.equal(ruleOwnedRes.statusCode, 200);
      const ruleUsage = await pool.query("select calls from app.preview_usage where project_id = $1 and user_id = $2", [
        callerOwnedProject.id,
        TEST_OWNER
      ]);
      assert.equal(ruleUsage.rows.length, 0, "Rule-only propose must not create a preview_usage row");

      setDefaultModelTranslatorOptions({
        request: async () =>
          Response.json({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  scope: "element",
                  scene: "b2",
                  atSeconds: 7.23,
                  el: "b2:w:2",
                  set: { color: "#3b82f6" }
                })
              }
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
          }),
        log: () => {}
      });
      const ownedRes = await meteredApp.inject({
        method: "POST",
        url: `/v1/projects/${callerOwnedProject.id}/plan/edit/propose`,
        payload: {
          comments: [{ id: "c1", at: 7.23, scene: "b2", body: "make the headline pop" }],
          measured: { canvas: { width: 1920, height: 1080 }, snapshots: { c1: b2Snapshots } }
        }
      });
      assert.equal(ownedRes.statusCode, 200);
      const ownedUsage = await pool.query("select calls from app.preview_usage where project_id = $1 and user_id = $2", [
        callerOwnedProject.id,
        TEST_OWNER
      ]);
      assert.equal(ownedUsage.rows.length, 1, "Real owned project must be charged in preview_usage when model runs");
      assert.equal(ownedUsage.rows[0].calls, 1);
    } finally {
      setDefaultModelTranslatorOptions(null);
      if (prevLimits === undefined) delete process.env.PREVIEW_LIMITS;
      else process.env.PREVIEW_LIMITS = prevLimits;
      await pool.query("delete from app.preview_usage where user_id = $1 or project_id = any($2)", [
        TEST_OWNER,
        [unknownProjectId, otherOwnedProject.id, callerOwnedProject.id]
      ]);
      await meteredApp.close();
    }
  }

  // 8. B5 server route checks: duplicate snapshot ids, unequal before/after lengths, explicit scope='scene' with el not downgraded
  {
    const b5Proj = await seedProject();
    const b5Version = computePlanVersion(b5Proj);

    // Duplicate element ids in a snapshot -> 400
    const dupRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${b5Proj.id}/plan/edit/propose`,
      payload: {
        comments: [{ id: "c1", at: 7.23, scene: "b2", body: 'Make "share." pink' }],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: {
            c1: [
              {
                time: 7.23,
                elements: [b2Snapshots[0].elements[0], b2Snapshots[0].elements[0]]
              }
            ]
          }
        }
      }
    });
    assert.equal(dupRes.statusCode, 400);
    assert.match(dupRes.json().error.message, /Duplicate element id/i);

    // Unequal before/after snapshot lengths on commit -> 400
    const unequalRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${b5Proj.id}/plan/edit/commit`,
      payload: {
        planVersion: b5Version,
        items: [
          {
            id: "c-unequal",
            patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } },
            before: [b2Snapshots[0], { ...b2Snapshots[0], time: 7.5 }],
            after: [b2Snapshots[0]]
          }
        ]
      }
    });
    assert.equal(unequalRes.statusCode, 400);
    assert.match(unequalRes.json().error.message, /unequal/i);

    // Explicit scope="scene" with el on commit is NOT downgraded to "element"
    const explicitSceneRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${b5Proj.id}/plan/edit/commit`,
      payload: {
        planVersion: b5Version,
        items: [
          {
            id: "c-scene-el",
            patch: { scope: "scene", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } },
            before: b2Snapshots,
            after: b2Snapshots
          }
        ]
      }
    });
    assert.equal(explicitSceneRes.statusCode, 200, explicitSceneRes.body);
    assert.equal(explicitSceneRes.json().results[0].scope, "scene", "Explicit scope='scene' with el must stay 'scene'");
  }

  console.log("plan-edit-no-chrome: ok");
} finally {
  await app.close();
  await pool.query("delete from app.projects where owner_id = any($1) or id = any($2)", [
    [TEST_OWNER, OTHER_OWNER],
    createdProjects
  ]);
  await pool.end();
}
