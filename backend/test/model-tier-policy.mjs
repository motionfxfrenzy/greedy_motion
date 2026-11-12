// Tier model policy: Standard = Gemini Flash / Haiku 5.5 only; Premium = Opus 5.5 only (Gemini-only audio/URL helpers aside).
// Offline. Run: node test/model-tier-policy.mjs
import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { STEPS } = await import("../src/models/steps.ts");
const { routeFor, routeWarnings, ignoredOverrides } = await import("../src/models/routes.ts");
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
  // The exact model-selection env found on staging / production on 2026-11-12 (argon values are the staging/prod differences).
  railwayStaging: { ANTHROPIC_MODEL: "claude-opus-5-5", MODEL_DEFAULT: "gemini:gemini-3.8-flash", MODEL_DIRECTOR: "gemini:gemini-3.8-flash", MODEL_ELEMENT_EDITS: "gemini:gemini-4-argon", MODEL_FORMAT_FILL: "gemini:gemini-3.8-flash", MODEL_FRAME_SKETCH: "gemini:gemini-3.8-flash", MODEL_MOTION: "gemini:gemini-3.8-flash", MODEL_PLANNER_FILL: "gemini:gemini-3.8-flash", MODEL_PRO_ASSISTANT: "gemini:gemini-3.8-flash", MODEL_REWRITE_BEAT: "gemini:gemini-4-argon", MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash", MODEL_SCREENSHOT: "gemini:gemini-3.8-flash", MODEL_SCRIPT: "gemini:gemini-4-argon", MODEL_SKILL_ROUTING: "gemini:gemini-3.8-flash" },
  railwayProduction: { ANTHROPIC_MODEL: "claude-opus-5-5", PLATE_MODEL: "claude-opus-5-5", MODEL_DEFAULT: "gemini:gemini-3.8-flash", MODEL_DIRECTOR: "gemini:gemini-3.8-flash", MODEL_ELEMENT_EDITS: "gemini:gemini-4-argon", MODEL_FORMAT_FILL: "gemini:gemini-3.8-flash", MODEL_FRAME_SKETCH: "gemini:gemini-3.8-flash", MODEL_MOTION: "gemini:gemini-3.8-flash", MODEL_PLANNER_FILL: "gemini:gemini-3.8-flash", MODEL_PRO_ASSISTANT: "gemini:gemini-3.8-flash", MODEL_REWRITE_BEAT: "gemini:gemini-4-argon", MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash", MODEL_SCREENSHOT: "gemini:gemini-3.8-flash", MODEL_SCRIPT: "gemini:gemini-3.8-flash", MODEL_SKILL_ROUTING: "gemini:gemini-3.8-flash" },
  hostile: { MODEL_DEFAULT: "claude-sonnet-4-6", ANTHROPIC_MODEL: "claude-sonnet-4-6", PLATE_MODEL: "claude-sonnet-4-6", SCRIPT_MODEL: "claude-sonnet-4-6", FRAME_MODEL: "claude-sonnet-4-6", SCREENSHOT_MODEL: "claude-sonnet-4-6", ANTHROPIC_ROUTING_MODEL: "claude-haiku-4-5-20251001", DIRECTOR_MODEL: "claude-sonnet-4-6" }
};
for (const [name, env] of Object.entries(envs)) {
  const pinned = new Set();
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
assert.ok(routeWarnings(envs.production).some((w) => /MODEL_MOTION applies to Standard only/.test(w)));

// 3. Env overrides: per-tier beats tier-blind beats the table.
assert.equal(routeFor("planner", { MODEL_PLANNER_FILL_STANDARD: "gemini:gemini-3.8-flash" }).model, "gemini-3.8-flash");
assert.equal(routeFor("planner", { MODEL_PLANNER_FILL_PREMIUM: "anthropic:claude-opus-5-5" }, "premium").model, "claude-opus-5-5");
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

// 6. No Sonnet anywhere: no step, tier, fallback or default resolves to it, and no tracked source file names it.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
{
  for (const tier of MODEL_TIERS) {
    for (const id of stepIds) {
      for (const env of [{}, ...Object.values(envs)]) {
        const r = routeFor(id, env, tier);
        assert.ok(!/sonnet/i.test(r.model), `${tier}/${id} resolved to ${r.model}`);
      }
      assert.ok(!/sonnet/i.test(STEPS[id].legacy({}).model), `${id} code default is Sonnet`);
    }
  }
  const { config } = await import("../src/config.ts");
  assert.ok(!/sonnet/i.test(config.anthropicModel) && !/sonnet/i.test(config.plateModel));
  const { PRICES } = await import("../src/models/prices.ts");
  assert.ok(!Object.keys(PRICES).some((k) => /sonnet/i.test(k)), "price table has no Sonnet");

  // Whole-repo grep over tracked files; dated records, agent notes and env-override parsing fixtures are excluded.
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const skip = /^(docs\/(qa|phase3|handoff)\/|docs\/(HANDOFF|LIVE_PLAYBACK|DIRECTOR_AB|PRICING|STACK_DECISIONS)|scripts\/director-ab\/results\/|tools\/|\.claude\/|backend\/test\/(model-tier-policy|pricing-lock)\.mjs$|package-lock\.json$)/;
  const { readFileSync } = await import("node:fs");
  const hits = [];
  for (const f of files) {
    if (skip.test(f) || /\.(png|jpe?g|webp|gif|mp4|woff2?|ttf|pdf|ico|zip|bin|mov|mp3|wav)$/i.test(f)) continue;
    let text; try { text = readFileSync(`${root}/${f}`, "utf8"); } catch { continue; }
    if (/sonnet/i.test(text)) hits.push(f);
  }
  assert.deepEqual(hits, [], `Sonnet referenced in: ${hits.join(", ")}`);
}
// 7. Railway env fixtures: plain MODEL_<STEP> is Standard-only and must be allowed; Premium stays Opus; argon is ignored with a warning.
for (const env of [envs.railwayStaging, envs.railwayProduction]) {
  for (const id of stepIds) {
    const std = routeFor(id, env, "standard"), prem = routeFor(id, env, "premium");
    assert.ok(isAllowedModel("standard", std.provider, std.model, id), `std ${id} ${std.model}`);
    assert.ok(isAllowedModel("premium", prem.provider, prem.model, id), `prem ${id} ${prem.model}`);
    if (!GEMINI_ONLY_STEPS.includes(id)) assert.equal(prem.model, "claude-opus-5-5", `premium ${id}`);
  }
  assert.equal(routeFor("elementEdits", env, "standard").model, "claude-haiku-5-5", "argon override ignored -> table (Haiku)");
  assert.equal(routeFor("rewriteBeat", env, "standard").model, "gemini-3.8-flash");
  assert.equal(routeFor("motion", env, "premium").model, "claude-opus-5-5");
  const w = routeWarnings(env);
  assert.ok(w.some((x) => /MODEL_ELEMENT_EDITS=gemini:gemini-4-argon is ignored on standard/.test(x)));
  assert.ok(w.some((x) => /MODEL_REWRITE_BEAT=gemini:gemini-4-argon is ignored on standard/.test(x)));
}
assert.equal(routeFor("script", envs.railwayStaging, "standard").model, "gemini-3.8-flash", "staging argon MODEL_SCRIPT ignored");
// Premium override must itself be an allowed Premium model.
assert.equal(routeFor("motion", { MODEL_MOTION_PREMIUM: "gemini:gemini-3.8-flash" }, "premium").model, "claude-opus-5-5");
assert.equal(routeFor("planner", { MODEL_PLANNER_FILL_STANDARD: "claude-opus-5-5" }, "standard").model, "claude-haiku-5-5");

// 8. Startup "model override ignored" list for the exact staging / production env.
{
  const fmt = (list) => list.map((o) => `${o.name}=${o.value} [${o.tier}] ${o.reason}`);
  const common = [
    "ANTHROPIC_MODEL=claude-opus-5-5 [all] legacy var, ignored (models are chosen per tier)",
    "MODEL_DEFAULT=gemini:gemini-3.8-flash [all] legacy var, ignored (models are chosen per tier)"
  ];
  const st = fmt(ignoredOverrides(envs.railwayStaging));
  const pr = fmt(ignoredOverrides(envs.railwayProduction));
  for (const l of common) { assert.ok(st.includes(l), l); assert.ok(pr.includes(l), l); }
  assert.ok(pr.includes("PLATE_MODEL=claude-opus-5-5 [all] legacy var, ignored (models are chosen per tier)"));
  assert.ok(!st.some((l) => l.startsWith("PLATE_MODEL")));
  for (const name of ["ELEMENT_EDITS", "REWRITE_BEAT"]) {
    const l = `MODEL_${name}=gemini:gemini-4-argon [standard] not in the Standard allowed set`;
    assert.ok(st.includes(l) && pr.includes(l), l);
  }
  assert.ok(st.includes("MODEL_SCRIPT=gemini:gemini-4-argon [standard] not in the Standard allowed set"));
  assert.ok(!pr.some((l) => l.startsWith("MODEL_SCRIPT=") && l.includes("[standard]")));
  // Every set plain MODEL_<STEP> is reported as Standard-only for Premium: 12 on staging, 12 on production.
  assert.equal(st.filter((l) => l.includes("[premium] plain MODEL_<STEP>")).length, 12);
  assert.equal(pr.filter((l) => l.includes("[premium] plain MODEL_<STEP>")).length, 12);
  assert.deepEqual(ignoredOverrides({ MODEL_SCRIPT_STANDARD: "gemini:gemini-3.8-flash" }), []);
  // No values other than model ids are ever reported.
  assert.deepEqual(ignoredOverrides({ ANTHROPIC_API_KEY: "sk-secret", DATABASE_URL: "postgres://x" }), []);
}

console.log("model tier policy: no Sonnet in defaults, price table, or tracked files");
