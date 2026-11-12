// The migrated call sites follow the routing table: default env = the Anthropic request as before; MODEL_<STEP>=gemini:... = a Gemini request.
// Offline: globalThis.fetch is a recorder. Run: node --experimental-strip-types --env-file-if-exists=.env test/model-routing-sites.mjs
import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
for (const key of Object.keys(process.env)) if (/^(MODEL_|EFFORT_|MAX_TOKENS_|BASE_URL_)/.test(key) || ["SCRIPT_MODEL", "SCRIPT_PROVIDER", "FRAME_MODEL", "MOTION_MODEL", "DIRECTOR_MODEL", "DIRECTOR_PROVIDER", "PLATE_MODEL"].includes(key)) delete process.env[key];
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";

const calls = [];
const realFetch = globalThis.fetch;
const gemini = (text) => Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5, cachedContentTokenCount: 40 } });
const claude = (text) => Response.json({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
  return String(url).includes("generativelanguage") ? gemini('{"ok":true}') : claude('{"ok":true}');
};
const last = () => calls[calls.length - 1];
const quiet = console.info; console.info = () => {};

const { llmJson } = await import("../src/llm.ts");
const { sketchFrame } = await import("../src/plan/frame-sketch.ts");

const schema = { type: "object", properties: { ok: { type: "boolean" } } };
for (const [step, model] of [["script", "claude-sonnet-5-5"], ["director", "claude-opus-5-5"], ["screenshot", "claude-sonnet-5-5"]]) {
  process.env[`MODEL_${step.toUpperCase()}`] = `anthropic:${model}`;
  await llmJson({ step, system: "s", user: "u", schema, maxTokens: 1000 });
  assert.match(last().url, /api\.anthropic\.com\/v1\/messages$/, `${step} pinned to Anthropic`);
  assert.equal(last().body.model, model, `${step} default model`);
  assert.equal(last().headers["x-api-key"], "test-anthropic-key");
  process.env[`MODEL_${step.toUpperCase()}`] = "gemini:gemini-3.8-flash";
  const result = await llmJson({ step, system: "s", user: "u", schema, maxTokens: 1000 });
  assert.match(last().url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/, `${step} routed to Gemini`);
  assert.equal(last().headers["x-goog-api-key"], "test-gemini-key");
  assert.equal(result.provider, "gemini");
  assert.equal(result.inputTokens, 100, "input = prompt tokens incl. cached");
  assert.equal(result.outputTokens, 15, "output = candidates + thoughts");
  delete process.env[`MODEL_${step.toUpperCase()}`];
}
// An explicit provider + model (the director A/B test) overrides the route.
await llmJson({ step: "director", provider: "gemini", model: "gemini-3.1-pro-preview", system: "s", user: "u", schema });
assert.match(last().url, /gemini-3\.1-pro-preview/);
// With no override the Standard tier table applies (Gemini Flash); the tier-blind legacy vars are ignored.
await llmJson({ step: "director", system: "s", user: "u", schema });
assert.match(last().url, /gemini-3\.8-flash/);
process.env.DIRECTOR_PROVIDER = "gemini"; process.env.DIRECTOR_MODEL = "gemini-3.1-pro-preview"; process.env.MODEL_DEFAULT = "claude-opus-5-5";
await llmJson({ step: "director", system: "s", user: "u", schema });
assert.match(last().url, /gemini-3\.8-flash/);
delete process.env.DIRECTOR_PROVIDER; delete process.env.DIRECTOR_MODEL; delete process.env.MODEL_DEFAULT;

// Frame sketch: Anthropic request keeps the same fields as before; Gemini goes through the provider layer.
const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null }); return String(url).includes("generativelanguage") ? gemini(svgText) : claude(svgText); };
const frame = { beat: { id: "b1", keyword: "Hi", kind: "kinetic", on_screen: null, line: null, visual: "a box" }, index: 0, count: 1, aspect: "16:9", topic: "t", style: null, look: "clean" };
process.env.MODEL_FRAME_SKETCH = "anthropic:claude-sonnet-4-6";
await sketchFrame(frame, new AbortController().signal);
assert.match(last().url, /api\.anthropic\.com/);
assert.equal(last().body.model, "claude-sonnet-4-6"); assert.equal(last().body.max_tokens, 6000); assert.deepEqual(last().body.output_config, { effort: "low" });
process.env.MODEL_FRAME_SKETCH = "gemini:gemini-3.8-flash";
const svg = await sketchFrame(frame, new AbortController().signal);
assert.match(last().url, /gemini-3\.8-flash/); assert.ok(svg.startsWith("<svg"));
assert.equal(last().body.generationConfig.thinkingConfig.thinkingLevel, "low");
delete process.env.MODEL_FRAME_SKETCH;

// Render planner (AnthropicPromptPlanner): Anthropic tool use by default; Gemini structured JSON when routed via MODEL_PLANNER_FILL or MODEL_DEFAULT.
{
  const { AnthropicPromptPlanner } = await import("../src/render/anthropic-planner.ts");
  const validLaunchSlots = {
    brandName: "Relay",
    hook: "Ship updates people actually watch.",
    tagline: "Turn every release into a story.",
    feature1: "Screenshots become scenes",
    feature2: "On-brand motion",
    feature3: "Edit any scene fast",
    benefit: "Ship the update and the video on the same day.",
    ctaText: "Start free today",
    url: "relay.video"
  };
  const renderReq = {
    prompt: "Launch video for Relay, a tool that turns SaaS product updates into short motion videos.",
    template: "product-launch",
    style: "kinetic",
    theme: "neutral",
    format: "landscape",
    audio: { voiceover: true, music: true }
  };

  // 1. Default route (Anthropic tool use) + missing tool call retry
  let antAttempt = 0;
  const antPlanner = new AnthropicPromptPlanner(async (url, init) => {
    antAttempt++;
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    if (antAttempt === 1) {
      return Response.json({ content: [{ type: "text", text: "Here is a plan..." }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 5 } });
    }
    return Response.json({
      content: [{ type: "tool_use", id: "tool_1", name: "fill_template", input: { ...validLaunchSlots, narration: "Ship updates people watch. Try Relay free today.", musicPrompt: "Upbeat modern synth instrumental" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 25, output_tokens: 40 }
    });
  });
  assert.deepEqual(antPlanner.info, { provider: "anthropic", model: "claude-haiku-5-5" });
  const antPlan = await antPlanner.plan(renderReq);
  assert.equal(antAttempt, 2);
  assert.match(last().url, /api\.anthropic\.com\/v1\/messages$/);
  assert.equal(last().body.tools[0].name, "fill_template");
  assert.equal(antPlan.template, "product-launch");
  assert.equal(antPlan.values.hook, validLaunchSlots.hook);
  assert.equal(antPlan.narration, "Ship updates people watch. Try Relay free today.");
  assert.equal(antPlan.musicPrompt, "Upbeat modern synth instrumental");

  // 2. Gemini route (structured JSON via MODEL_PLANNER_FILL or MODEL_DEFAULT)
  process.env.MODEL_PLANNER_FILL = "gemini:gemini-3.8-flash";
  let gemCalls = 0;
  const gemPlanner = new AnthropicPromptPlanner(async (url, init) => {
    gemCalls++;
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    return gemini(JSON.stringify({
      ...validLaunchSlots,
      narration: "Relay turns every release into a story.",
      musicPrompt: "Bright electronic pulse, light percussion",
      motionStyle: "editorial"
    }));
  });
  assert.deepEqual(gemPlanner.info, { provider: "gemini", model: "gemini-3.8-flash" });
  const gemPlan = await gemPlanner.plan(renderReq, undefined, {
    script: { source: "generated", confirmed: true, updatedAt: new Date().toISOString(), lines: [{ label: "Hook", onScreen: "Old hook" }] },
    comments: [{ id: "c1", body: "Make the treatment more story-led", timestampSeconds: 1.2, createdAt: new Date().toISOString() }]
  });
  assert.equal(gemCalls, 1);
  assert.match(last().url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(last().body.generationConfig.responseMimeType, "application/json");
  assert.ok(last().body.generationConfig.responseJsonSchema.properties.hook);
  assert.ok(last().body.generationConfig.responseJsonSchema.properties.narration);
  assert.ok(last().body.generationConfig.responseJsonSchema.properties.musicPrompt);
  assert.ok(last().body.generationConfig.responseJsonSchema.properties.motionStyle);
  assert.equal(gemPlan.values.hook, validLaunchSlots.hook);
  assert.equal(gemPlan.motionStyle, "editorial");

  // 3. Gemini malformed/truncated/empty first response -> bounded retry succeeds on attempt 2
  for (const firstResp of [
    () => gemini("{not valid json"),
    () => Response.json({ candidates: [{ content: { parts: [{ text: '{"brandName":"Relay"' }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 } }),
    () => Response.json({ candidates: [{ content: {}, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50, thoughtsTokenCount: 100 } })
  ]) {
    let tries = 0;
    const retryPlanner = new AnthropicPromptPlanner(async () => {
      tries++;
      if (tries === 1) return firstResp();
      return gemini(JSON.stringify({ ...validLaunchSlots, narration: "Short voiceover.", musicPrompt: "Warm synth" }));
    });
    const recovered = await retryPlanner.plan(renderReq);
    assert.equal(tries, 2, "malformed/truncated/empty response should retry once and recover");
    assert.equal(recovered.values.brandName, "Relay");
  }

  // 4. Gemini schema/length violation (e.g. over-length hook or missing required write field) -> repair round with exact problem feedback -> fails if attempt 2 still invalid
  let repairTries = 0;
  let secondTurnPrompt = "";
  const overLengthPlanner = new AnthropicPromptPlanner(async (_url, init) => {
    repairTries++;
    const body = JSON.parse(init.body);
    if (repairTries === 2) {
      secondTurnPrompt = body.contents[body.contents.length - 1].parts[0].text;
      return gemini(JSON.stringify({ ...validLaunchSlots, narration: "Fixed narration.", musicPrompt: "Fixed music" }));
    }
    return gemini(JSON.stringify({ ...validLaunchSlots, hook: "X".repeat(90), feature1: "", narration: "", musicPrompt: "Fixed music" }));
  });
  const repairedPlan = await overLengthPlanner.plan(renderReq);
  assert.equal(repairTries, 2);
  assert.match(secondTurnPrompt, /hook: 90 characters, limit is 64/);
  assert.match(secondTurnPrompt, /feature1: required field is missing or empty/);
  assert.match(secondTurnPrompt, /narration: 0 characters, must be 1–140/);
  assert.equal(repairedPlan.values.hook, validLaunchSlots.hook);

  // Persistent invalid output on attempt 2 throws clear error
  const alwaysInvalidPlanner = new AnthropicPromptPlanner(async () =>
    gemini(JSON.stringify({ ...validLaunchSlots, hook: "Y".repeat(100), narration: "Valid vo", musicPrompt: "Valid music" }))
  );
  await assert.rejects(() => alwaysInvalidPlanner.plan(renderReq), /Gemini's copy still breaks the template limits: hook: 100 characters, limit is 64/);

  // Persistent empty/truncated output on attempt 2 throws clear error
  const alwaysEmptyPlanner = new AnthropicPromptPlanner(async () =>
    Response.json({ candidates: [{ content: {}, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, thoughtsTokenCount: 50 } })
  );
  await assert.rejects(() => alwaysEmptyPlanner.plan(renderReq), /Gemini did not fill the template \(stop reason: max_tokens\)/);

  delete process.env.MODEL_PLANNER_FILL;
}

console.info = quiet; globalThis.fetch = realFetch;
console.log("model routing sites: llmJson (script, director, screenshot), MODEL_DEFAULT, old env aliases, frame sketch, render planner verified offline");
