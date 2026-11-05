// Phase 4a v2 meter test: charge only when the model runs, once per batch of comments;
// rule-based edits and failed requests are free, and a film with only rule-based edits takes no slot.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "fastify";

process.env.APP_ENV = "local";
process.env.PLANNER = "deterministic";
process.env.CREEM_API_KEY = "";
process.env.PREVIEW_LIMITS = "on";

const { migrate, pool } = await import("../src/db/database.ts");
const { data: dbInfo } = await pool.query("select current_database() as db").then((r) => ({ data: r.rows[0]?.db ?? "" }));
if (!/plates_unit|test/i.test(dbInfo)) {
  throw new Error(`Refusing to run test against non-test database "${dbInfo}"`);
}

const { createProject, getProject } = await import("../src/projects/store.ts");
const { registerOwnership } = await import("../src/access.ts");
const { registerPreviewMeter, previewsUsed, previewPeriod } = await import("../src/plan/preview-meter.ts");
const { registerPlanRoutes } = await import("../src/plan/routes.ts");
const { computePlanVersion, setDefaultModelTranslatorOptions } = await import("../src/plan/element-edits.ts");
const { PREVIEW_ALLOWANCE, PREVIEW_CALL_CAP } = await import("@videosaas/contracts");

// Verify COUNTED in preview-meter.ts no longer contains plan/edit/propose and header comment states the rule
const meterSrc = readFileSync(new URL("../src/plan/preview-meter.ts", import.meta.url), "utf8");
assert.ok(
  !/plan\/edit\/propose/i.test(meterSrc),
  "preview-meter.ts must no longer contain plan/edit/propose in COUNTED"
);
assert.match(
  meterSrc,
  /propose is counted[\s\S]*only when the model runs,\s*once per batch/i,
  "preview-meter.ts header comment must state that propose is counted only when the model runs, once per batch"
);

await migrate();

const trackedUsers = [];
const trackedProjects = [];
function newUser() {
  const id = randomUUID();
  trackedUsers.push(id);
  return id;
}

const app = Fastify();
app.addHook("onRequest", async (request) => {
  const testUser = request.headers["x-test-user"];
  if (typeof testUser === "string" && testUser) {
    request.user = { id: testUser };
  }
});
registerOwnership(app);
registerPreviewMeter(app);
await registerPlanRoutes(app);
await app.ready();

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

const b1Snapshots = [{ time: 2.35, elements: b1Elements }];
const b2Snapshots = [{ time: 7.23, elements: b2Elements }];

function makeSeed() {
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
      transition_out: { type: "end", carrier: null }
    }
  ];

  const brief = {
    scriptMode: "problem",
    text: "A fast demo video showing our release workflow.",
    aspect: "16:9",
    durationSeconds: 10,
    look: "clean",
    motionProfile: "velocity",
    audio: { mode: "none" },
    captions: "key-phrases",
    productName: "Acme Flow"
  };

  const beatPlan = {
    version: "1.0",
    mode: "problem-only",
    template: null,
    format: "15s",
    canvas: "16:9",
    target_duration_s: 10,
    clock: "beats",
    brand: { name: "Acme Flow", motion_profile: "velocity", style_frame: null },
    characters: [],
    beats,
    audio: { voice: null, music: null, captions: "key-phrases" },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: [],
    estimate: { generated_shots: 0, api_usd: 0 }
  };

  return { brief, beatPlan };
}

async function seedProject(ownerId, withPlan = true) {
  const created = await createProject(
    {
      name: `meter-test-${randomUUID().slice(0, 8)}`,
      request: {
        prompt: "A fast demo video showing our release workflow.",
        format: "landscape",
        style: "clean",
        theme: "neutral",
        template: "product-launch",
        audio: { music: false, voiceover: false, voice: "Kore" }
      }
    },
    ownerId
  );
  trackedProjects.push(created.id);
  if (!withPlan) return created;
  const seed = makeSeed();
  await pool.query("update app.projects set data = data || $2::jsonb where id = $1", [
    created.id,
    JSON.stringify({
      ...seed,
      state: "Ready for review"
    })
  ]);
  return await getProject(created.id);
}

async function usageRow(userId, projectId) {
  const { rows } = await pool.query(
    "select calls, period from app.preview_usage where user_id = $1 and project_id = $2",
    [userId, projectId]
  );
  return rows[0] ?? null;
}

try {
  // =========================================================================
  // Case 1: rule-only propose: no preview_usage row, no call counted, no film slot
  // =========================================================================
  {
    const owner = newUser();
    const proj = await seedProject(owner);
    let modelCalls = 0;
    setDefaultModelTranslatorOptions({
      request: async () => {
        modelCalls++;
        throw new Error("Model must not be called for rule-only propose");
      },
      log: () => {}
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [
          { id: "c-rule-1", at: 7.23, scene: "b2", body: 'Make "share." pink' },
          { id: "c-rule-2", at: 2.35, scene: "b1", body: 'Nudge "moving." right 20px' }
        ],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { "c-rule-1": b2Snapshots, "c-rule-2": b1Snapshots }
        }
      }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.candidates.length, 2);
    assert.equal(body.candidates[0].source, "deterministic");
    assert.equal(body.candidates[0].patch.set.color, "#ff3b6b");
    assert.equal(body.candidates[1].source, "deterministic");
    assert.equal(body.candidates[1].patch.set.dx, 20);
    assert.equal(modelCalls, 0, "Model stub must not be called on rule-only batch");

    const row = await usageRow(owner, proj.id);
    assert.equal(row, null, "Rule-only propose must create no preview_usage row");
    assert.equal(await previewsUsed(owner, "free"), 0, "Film with only rule-based edits must take no film slot");
  }

  // =========================================================================
  // Case 2: model propose with two comments needing the model:
  //         exactly one call counted for the batch, the film slot taken once
  // =========================================================================
  {
    const owner = newUser();
    const proj = await seedProject(owner);
    let modelCalls = 0;
    setDefaultModelTranslatorOptions({
      request: async (_url, init) => {
        modelCalls++;
        const reqBody = JSON.parse(init.body);
        const promptText = reqBody.messages[0].content;
        const isFirst = promptText.includes("make the headline pop");
        const patch = isFirst
          ? { scope: "scene", scene: "b1", atSeconds: 2.35, el: "b1:w:2", set: { scale: 1.25, color: "#ff3b6b" } }
          : { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:sub:0", set: { opacity: 0.65 } };
        return Response.json({
          content: [{ type: "text", text: JSON.stringify(patch) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 150, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
        });
      },
      log: () => {}
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [
          { id: "c-mod-1", at: 2.35, scene: "b1", body: "make the headline pop" },
          { id: "c-mod-2", at: 7.23, scene: "b2", body: "tone down the subtitle so it whispers" }
        ],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { "c-mod-1": b1Snapshots, "c-mod-2": b2Snapshots }
        }
      }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(modelCalls, 2, "Model translator runs for both model comments in the batch");
    assert.equal(body.candidates.length, 2);
    assert.equal(body.candidates[0].source, "model");
    assert.equal(body.candidates[0].patch.el, "b1:w:2");
    assert.equal(body.candidates[1].source, "model");
    assert.equal(body.candidates[1].patch.el, "b2:sub:0");

    const row = await usageRow(owner, proj.id);
    assert.ok(row, "Model batch must insert a preview_usage row");
    assert.equal(row.calls, 1, "Two model comments in one batch must count as exactly 1 call");
    assert.equal(await previewsUsed(owner, "free"), 1, "Film slot taken once");
  }

  // =========================================================================
  // Case 3: mixed batch (one rule comment, one model comment): one charge
  // =========================================================================
  {
    const owner = newUser();
    const proj = await seedProject(owner);
    let modelCalls = 0;
    setDefaultModelTranslatorOptions({
      request: async () => {
        modelCalls++;
        return Response.json({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                scope: "element",
                scene: "b1",
                atSeconds: 2.35,
                el: "b1:sub:0",
                set: { opacity: 0.7 }
              })
            }
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 140, output_tokens: 35, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
        });
      },
      log: () => {}
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [
          { id: "c-rule", at: 7.23, scene: "b2", body: 'Make "share." pink' },
          { id: "c-model", at: 2.35, scene: "b1", body: "tone down the subtitle so it whispers" }
        ],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { "c-rule": b2Snapshots, "c-model": b1Snapshots }
        }
      }
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(modelCalls, 1, "Model translator runs only for the non-rule comment");
    assert.equal(body.candidates[0].id, "c-rule");
    assert.equal(body.candidates[0].source, "deterministic");
    assert.equal(body.candidates[0].patch.set.color, "#ff3b6b");
    assert.equal(body.candidates[1].id, "c-model");
    assert.equal(body.candidates[1].source, "model");
    assert.equal(body.candidates[1].patch.set.opacity, 0.7);

    const row = await usageRow(owner, proj.id);
    assert.ok(row, "Mixed batch must create a preview_usage row");
    assert.equal(row.calls, 1, "Mixed batch must count as 1 call");
    assert.equal(await previewsUsed(owner, "free"), 1);
  }

  // =========================================================================
  // Case 4: failed validation (bad snapshots 400, unknown project 404, stale/no-plan 409): no charge
  // =========================================================================
  {
    const owner = newUser();
    const otherOwner = newUser();
    const proj = await seedProject(owner, true);
    const noPlanProj = await seedProject(owner, false);
    const otherProj = await seedProject(otherOwner, true);
    const unknownId = randomUUID();
    let modelCalls = 0;
    setDefaultModelTranslatorOptions({
      request: async () => {
        modelCalls++;
        throw new Error("Model must not be called on failed validation");
      },
      log: () => {}
    });

    // 4a. Bad snapshots (400) — even when first comment needs model and second has bad snapshots
    const badSnapRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [
          { id: "c-mod", at: 2.35, scene: "b1", body: "make the headline pop" },
          { id: "c-bad", at: 7.23, scene: "b2", body: "make the headline pop" }
        ],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: {
            "c-mod": b1Snapshots,
            "c-bad": [{ time: 7.23, elements: [{ id: "evil:id", role: "word", text: "x", box: [0, 0, 10, 10], beat: "b2", opacity: 1 }] }]
          }
        }
      }
    });
    assert.equal(badSnapRes.statusCode, 400);
    assert.equal(badSnapRes.json().error.code, "invalid_snapshots");

    // 4b. Unknown project (404) & unowned project (404)
    const unknownRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${unknownId}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [{ id: "c-mod", at: 2.35, scene: "b1", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { "c-mod": b1Snapshots } }
      }
    });
    assert.equal(unknownRes.statusCode, 404);

    const unownedRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${otherProj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [{ id: "c-mod", at: 2.35, scene: "b1", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { "c-mod": b1Snapshots } }
      }
    });
    assert.equal(unownedRes.statusCode, 404);

    // 4c. 409 no_plan on propose & 409 stale_plan_version on commit
    const noPlanRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${noPlanProj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [{ id: "c-mod", at: 2.35, scene: "b1", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { "c-mod": b1Snapshots } }
      }
    });
    assert.equal(noPlanRes.statusCode, 409);
    assert.equal(noPlanRes.json().error.code, "no_plan");

    const staleCommitRes = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/commit`,
      headers: { "x-test-user": owner },
      payload: {
        planVersion: "0000000000000000",
        items: [
          {
            id: "c1",
            patch: { scope: "element", scene: "b2", atSeconds: 7.23, el: "b2:w:2", set: { color: "#ff3b6b" } },
            before: b2Snapshots,
            after: b2Snapshots
          }
        ]
      }
    });
    assert.equal(staleCommitRes.statusCode, 409);
    assert.equal(staleCommitRes.json().error.code, "stale_plan_version");

    assert.equal(modelCalls, 0, "Model must never be called on failed validation");
    const { rows } = await pool.query(
      "select count(*)::int as n from app.preview_usage where user_id = any($1) or project_id = any($2)",
      [[owner, otherOwner], [proj.id, noPlanProj.id, otherProj.id, unknownId]]
    );
    assert.equal(rows[0].n, 0, "Failed validation requests (400, 404, 409) must create no preview_usage rows");
  }

  // =========================================================================
  // Case 5: at the cap (PREVIEW_CALL_CAP reached for the project, and, separately,
  //         the monthly film allowance reached with a new film):
  //         the rule-only part is returned, the model part gets the documented 402
  //         refusal body, the model stub is not called
  // =========================================================================
  {
    // 5a. PREVIEW_CALL_CAP reached for the project
    const capOwner = newUser();
    const capProj = await seedProject(capOwner);
    await pool.query(
      "insert into app.preview_usage (user_id, period, project_id, calls) values ($1, $2, $3, $4)",
      [capOwner, "lifetime", capProj.id, PREVIEW_CALL_CAP]
    );

    let modelCalls5a = 0;
    setDefaultModelTranslatorOptions({
      request: async () => {
        modelCalls5a++;
        throw new Error("Model stub must not be called when PREVIEW_CALL_CAP is reached");
      },
      log: () => {}
    });

    const res5a = await app.inject({
      method: "POST",
      url: `/v1/projects/${capProj.id}/plan/edit/propose`,
      headers: { "x-test-user": capOwner },
      payload: {
        comments: [
          { id: "c-rule", at: 7.23, scene: "b2", body: 'Make "share." pink' },
          { id: "c-model", at: 2.35, scene: "b1", body: "make the headline pop" }
        ],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { "c-rule": b2Snapshots, "c-model": b1Snapshots }
        }
      }
    });
    assert.equal(res5a.statusCode, 200, res5a.body);
    assert.equal(modelCalls5a, 0, "Model stub must not be called at PREVIEW_CALL_CAP");
    const body5a = res5a.json();
    assert.equal(body5a.planVersion, computePlanVersion(capProj));
    assert.equal(body5a.candidates.length, 2);
    // Rule-only part is returned normally
    assert.equal(body5a.candidates[0].id, "c-rule");
    assert.equal(body5a.candidates[0].source, "deterministic");
    assert.equal(body5a.candidates[0].patch.set.color, "#ff3b6b");
    assert.equal(body5a.candidates[0].refused, undefined);
    // Model part gets the documented 402 refusal body and message
    const expectedCapMessage =
      "This film has used a very large number of changes this period. Start a new film, or try again next month.";
    assert.equal(body5a.candidates[1].id, "c-model");
    assert.equal(body5a.candidates[1].patch, undefined);
    assert.equal(body5a.candidates[1].refused, expectedCapMessage);
    assert.deepEqual(body5a.candidates[1].error, {
      code: "preview_call_cap",
      message: expectedCapMessage,
      tier: "free",
      limit: PREVIEW_CALL_CAP
    });
    const rowAfter5a = await usageRow(capOwner, capProj.id);
    assert.equal(rowAfter5a.calls, PREVIEW_CALL_CAP, "Calls count must remain at PREVIEW_CALL_CAP");

    // 5b. Monthly film allowance reached with a new film (paid plan: Starter, 15 films/month)
    const monthlyOwner = newUser();
    await pool.query(
      `insert into app.subscriptions (user_id, provider_ref, variant_id, tier, billing_interval, status)
       values ($1, $2, 'v-starter', 'starter', 'month', 'active')`,
      [monthlyOwner, `sub-${monthlyOwner}`]
    );
    const currentMonth = previewPeriod("starter");
    for (let i = 0; i < PREVIEW_ALLOWANCE.starter; i++) {
      await pool.query(
        "insert into app.preview_usage (user_id, period, project_id, calls) values ($1, $2, $3, 1)",
        [monthlyOwner, currentMonth, randomUUID()]
      );
    }
    const newMonthlyFilm = await seedProject(monthlyOwner);

    let modelCalls5b = 0;
    setDefaultModelTranslatorOptions({
      request: async () => {
        modelCalls5b++;
        throw new Error("Model stub must not be called when monthly film allowance is reached");
      },
      log: () => {}
    });

    const res5b = await app.inject({
      method: "POST",
      url: `/v1/projects/${newMonthlyFilm.id}/plan/edit/propose`,
      headers: { "x-test-user": monthlyOwner },
      payload: {
        comments: [
          { id: "c-rule", at: 7.23, scene: "b2", body: 'Make "share." pink' },
          { id: "c-model", at: 2.35, scene: "b1", body: "make the headline pop" }
        ],
        measured: {
          canvas: { width: 1920, height: 1080 },
          snapshots: { "c-rule": b2Snapshots, "c-model": b1Snapshots }
        }
      }
    });
    assert.equal(res5b.statusCode, 200, res5b.body);
    assert.equal(modelCalls5b, 0, "Model stub must not be called when monthly film allowance is reached");
    const body5b = res5b.json();
    assert.equal(body5b.candidates.length, 2);
    // Rule-only part returned normally
    assert.equal(body5b.candidates[0].id, "c-rule");
    assert.equal(body5b.candidates[0].source, "deterministic");
    assert.equal(body5b.candidates[0].patch.set.color, "#ff3b6b");
    assert.equal(body5b.candidates[0].refused, undefined);
    // Model part gets the documented 402 refusal body for Starter monthly limit
    const expectedLimitMessage = `You have worked on ${PREVIEW_ALLOWANCE.starter} films this month on the Starter plan. It resets on the 1st; Pro allows ${PREVIEW_ALLOWANCE.pro} a month.`;
    assert.equal(body5b.candidates[1].id, "c-model");
    assert.equal(body5b.candidates[1].patch, undefined);
    assert.equal(body5b.candidates[1].refused, expectedLimitMessage);
    assert.deepEqual(body5b.candidates[1].error, {
      code: "preview_limit",
      message: expectedLimitMessage,
      tier: "starter",
      used: PREVIEW_ALLOWANCE.starter,
      limit: PREVIEW_ALLOWANCE.starter
    });
    assert.equal(await usageRow(monthlyOwner, newMonthlyFilm.id), null, "Refused new film must not take a slot");
    assert.equal(await previewsUsed(monthlyOwner, "starter"), PREVIEW_ALLOWANCE.starter);
  }

  // =========================================================================
  // Case 6: metering off (PREVIEW_LIMITS=off): never charged
  // =========================================================================
  {
    const prevLimits = process.env.PREVIEW_LIMITS;
    process.env.PREVIEW_LIMITS = "off";
    try {
      const owner = newUser();
      const proj = await seedProject(owner);
      let modelCalls = 0;
      setDefaultModelTranslatorOptions({
        request: async () => {
          modelCalls++;
          return Response.json({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  scope: "element",
                  scene: "b2",
                  atSeconds: 7.23,
                  el: "b2:w:2",
                  set: { color: "#22c55e" }
                })
              }
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
          });
        },
        log: () => {}
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/projects/${proj.id}/plan/edit/propose`,
        headers: { "x-test-user": owner },
        payload: {
          comments: [{ id: "c-mod", at: 7.23, scene: "b2", body: "make the headline pop" }],
          measured: { canvas: { width: 1920, height: 1080 }, snapshots: { "c-mod": b2Snapshots } }
        }
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(modelCalls, 1);
      assert.equal(await usageRow(owner, proj.id), null, "PREVIEW_LIMITS=off must never charge preview_usage");
    } finally {
      process.env.PREVIEW_LIMITS = prevLimits;
    }
  }

  // =========================================================================
  // Case 7: model failure after an admitted charge: the charge stays
  // =========================================================================
  {
    const owner = newUser();
    const proj = await seedProject(owner);
    let modelCalls = 0;
    setDefaultModelTranslatorOptions({
      sleep: async () => {},
      request: async () => {
        modelCalls++;
        return new Response(JSON.stringify({ error: { message: "Upstream model gateway failed" } }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        });
      },
      log: () => {}
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${proj.id}/plan/edit/propose`,
      headers: { "x-test-user": owner },
      payload: {
        comments: [{ id: "c-fail", at: 7.23, scene: "b2", body: "make the headline pop" }],
        measured: { canvas: { width: 1920, height: 1080 }, snapshots: { "c-fail": b2Snapshots } }
      }
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, "propose_failed");
    assert.ok(modelCalls >= 1, "Model was invoked after admission");

    const row = await usageRow(owner, proj.id);
    assert.ok(row, "Admitted charge must stay in preview_usage when model call fails");
    assert.equal(row.calls, 1, "Admitted charge count remains 1 (never refunded)");
  }

  console.log("plan-edit-meter: ok (all 7 cases passed)");
} finally {
  setDefaultModelTranslatorOptions(null);
  await app.close();
  if (trackedUsers.length > 0 || trackedProjects.length > 0) {
    await pool.query(
      "delete from app.preview_usage where user_id = any($1) or project_id = any($2)",
      [trackedUsers, trackedProjects]
    );
    await pool.query("delete from app.subscriptions where user_id = any($1)", [trackedUsers]);
    await pool.query(
      "delete from app.projects where owner_id = any($1) or id = any($2)",
      [trackedUsers, trackedProjects]
    );
  }
  await pool.end();
}
