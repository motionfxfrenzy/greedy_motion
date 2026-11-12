// Tier model policy: Standard = Gemini Flash / Haiku 5.5 only; Premium = Opus 5.5 only (Gemini-only audio/URL helpers aside).
// Offline. Run: node test/model-tier-policy.mjs
import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { STEPS } = await import("../src/models/steps.ts");
const { routeFor, routeWarnings } = await import("../src/models/routes.ts");
const { ALLOWED_MODELS, TIER_MODELS, GEMINI_ONLY_STEPS, MODEL_TIERS, isAllowedModel } = await import("../src/models/tiers.ts");
const { callModel, anthropicRequestShape } = await import("../src/models/providers.ts");
const { authorRouteForTier } = await import("../src/billing/step-billing.ts");

const stepIds = Object.keys(STEPS);

// 1. The table covers every step, with only allowed models, in both tiers.
for (const tier of MODEL_TIERS) {
  assert.deepEqual(Object.keys(TIER_MODELS[tier]).sort(), [...stepIds].sort(), `${tier} map covers every step`);
  for (const id of stepIds) assert.ok(ALLOWED_MODELS[tier].includes(TIER_MODELS[tier][id]), `${tier}.${id} -> ${TIER_MODELS[tier][id]} is allowed`);
}
for (const id of stepIds) {
  if (!GEMINI_ONLY_STEPS.includes(id)) assert.equal(TIER_MODELS.premium[id], "anthropic:claude-opus-5-5", `premium.${id} is Opus 5.5`);
}

// 2. Resolved routes stay inside the policy for a clean env AND for today's staging/production env (legacy vars set).
const envs = {
  clean: {},
  staging: { MODEL_DEFAULT: "gemini:gemini-3.8-flash", MODEL_MOTION: "gemini:gemini-3.8-flash", ANTHROPIC_MODEL: "claude-opus-5-5" },
  production: { MODEL_DEFAULT: "gemini:gemini-3.8-flash", MODEL_MOTION: "gemini:gemini-3.8-flash", ANTHROPIC_MODEL: "claude-opus-5-5", PLATE_MODEL: "claude-opus-5-5" },
  hostile: { MODEL_DEFAULT: "claude-sonnet-4-6", ANTHROPIC_MODEL: "claude-sonnet-4-6", PLATE_MODEL: "claude-sonnet-4-6", SCRIPT_MODEL: "claude-sonnet-4-6", FRAME_MODEL: "claude-sonnet-4-6", SCREENSHOT_MODEL: "claude-sonnet-4-6", ANTHROPIC_ROUTING_MODEL: "claude-haiku-4-5-20251001", DIRECTOR_MODEL: "claude-sonnet-4-6" }
};
for (const [name, env] of Object.entries(envs)) {
  // Production's MODEL_MOTION=flash is a tier-blind override and would pin Premium motion to Flash: that is what the warning is for.
  const pinned = new Set(Object.keys(env).filter((k) => k.startsWith("MODEL_") && k !== "MODEL_DEFAULT"));
  for (const tier of MODEL_TIERS) {
    for (const id of stepIds) {
      const r = routeFor(id, env, tier);
      if (pinned.has(`MODEL_${STEPS[id].env}`)) continue;
      assert.ok(isAllowedModel(tier, r.provider, r.model, id), `${name}/${tier}/${id} -> ${r.provider}:${r.model}`);
      assert.ok(!/sonnet|4-6|4-5-2025/.test(r.model), `${name}/${tier}/${id} never falls back to ${r.model}`);
    }
  }
  assert.equal(routeFor("sceneWriter", env, "premium").model, "claude-opus-5-5");
  assert.equal(routeFor("sceneWriter", env, "standard").model, "gemini-3.8-flash");
  assert.equal(routeFor("script", env).model, "gemini-3.8-flash", "no tier given = Standard");
}
assert.ok(routeWarnings(envs.production).some((w) => /PLATE_MODEL is set but ignored/.test(w)));
assert.ok(routeWarnings(envs.production).some((w) => /"motion" on premium resolves to gemini:gemini-3.8-flash/.test(w)), "MODEL_MOTION=flash on prod would pin Premium motion to Flash");

// 3. Env overrides: per-tier beats tier-blind beats the table.
assert.equal(routeFor("planner", { MODEL_PLANNER_FILL_STANDARD: "gemini:gemini-3.8-flash" }).model, "gemini-3.8-flash");
assert.equal(routeFor("planner", { MODEL_PLANNER_FILL_PREMIUM: "anthropic:claude-haiku-5-5" }, "premium").model, "claude-haiku-5-5");
assert.equal(routeFor("planner", { MODEL_PLANNER_FILL: "gemini:gemini-3.8-flash", MODEL_PLANNER_FILL_STANDARD: "claude-haiku-5-5" }).model, "claude-haiku-5-5");

// 4. The frozen per-request snapshot (writer, repair, motion) follows the tier.
const hostile = envs.hostile;
Object.assign(process.env, hostile);
const std = authorRouteForTier("standard");
const prem = authorRouteForTier("premium");
for (const key of ["writer", "repair", "motion"]) {
  assert.equal(`${std[key].provider}:${std[key].model}`, "gemini:gemini-3.8-flash", `standard.${key}`);
  assert.equal(`${prem[key].provider}:${prem[key].model}`, "anthropic:claude-opus-5-5", `premium.${key}`);
}
assert.equal(prem.motion.effort, "low");
for (const k of Object.keys(hostile)) delete process.env[k];

// 5. Request shape for the 5.5 models.
assert.deepEqual(anthropicRequestShape("claude-opus-5-5", 450, "low"), { maxTokens: 4096 }, "Opus: no thinking field, headroom for always-on thinking");
assert.deepEqual(anthropicRequestShape("claude-opus-5-5", 24000, undefined), { maxTokens: 24000 });
assert.deepEqual(anthropicRequestShape("claude-haiku-5-5", 128, undefined), { maxTokens: 128, thinking: { type: "disabled" } });
assert.deepEqual(anthropicRequestShape("claude-haiku-5-5", 1024, "high"), { maxTokens: 1024, thinking: { type: "disabled" } });
assert.deepEqual(anthropicRequestShape("claude-haiku-5-5", 1024, "xhigh"), { maxTokens: 4096 }, "disabled is rejected above effort high");
assert.deepEqual(anthropicRequestShape("claude-haiku-5-5", 16000, "low"), { maxTokens: 16000 });

async function body(model, maxTokens, effort, extra = {}) {
  let sent;
  await callModel({
    step: "planner", route: { step: "planner", provider: "anthropic", model, maxTokens, ...(effort ? { effort } : {}), explicit: true },
    system: "s", messages: [{ role: "user", content: "hi" }], log: () => {}, ...extra,
    request: async (_url, init) => { sent = JSON.parse(init.body); return Response.json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }); }
  });
  return sent;
}
for (const model of ["claude-opus-5-5", "claude-haiku-5-5"]) {
  const sent = await body(model, 600, "low");
  for (const banned of ["temperature", "top_p", "top_k", "tool_choice"]) assert.ok(!(banned in sent), `${model} never sends ${banned}`);
  assert.ok(!JSON.stringify(sent).includes("budget_tokens"), `${model} never sends budget_tokens`);
  assert.equal(sent.thinking === undefined || sent.thinking.type === "disabled", true);
}
assert.equal((await body("claude-opus-5-5", 600, "low")).thinking, undefined, "Opus 5.5 is never sent thinking");
assert.deepEqual((await body("claude-haiku-5-5", 600, "low")).thinking, { type: "disabled" });
// No assistant prefill on the 5.5 models.
await assert.rejects(() => callModel({ step: "planner", route: { step: "planner", provider: "anthropic", model: "claude-opus-5-5", maxTokens: 600, explicit: true }, system: "s", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "{" }], log: () => {}, request: async () => Response.json({}) }), /prefill/);

console.log("model tier policy: every step resolves inside the Standard / Premium model sets; 5.5 request shape verified offline");
