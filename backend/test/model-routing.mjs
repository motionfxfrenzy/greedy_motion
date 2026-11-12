import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { STEPS, NOT_ROUTED } = await import("../src/models/steps.ts");
const { routeFor, allRoutes, validateRoutes, routeWarnings } = await import("../src/models/routes.ts");
const { PRICES, MAX_OUTPUT, usdFor, registerPrice, maxOutputFor } = await import("../src/models/prices.ts");
const { callModel, streamModel, ladder, supportsPromptCacheGate, geminiThinkingLevel } = await import("../src/models/providers.ts");

function sseResponse(lines, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of lines) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream; charset=utf-8" }
  });
}

// ============================================================================
// 1. Defaults equal today's for every step with a clean env + legacy env chains
// ============================================================================
{
  const clean = {};
  const FLASH = ["gemini", "gemini-3.8-flash"];
  const HAIKU = ["anthropic", "claude-haiku-5-5"];
  // Standard (the default tier, also used by steps that run before a tier is chosen): Gemini Flash or Haiku 5.5 only.
  const expectedDefaults = {
    script: [...FLASH, undefined, 16000],
    scriptWrite: [...FLASH, undefined, 16000],
    sceneInsert: [...FLASH, undefined, 900],
    director: [...FLASH, undefined, 16000],
    frameSketch: [...FLASH, undefined, 6000],
    motion: [...FLASH, undefined, 3000],
    screenshot: [...FLASH, undefined, 1200],
    voiceAlign: [...FLASH, undefined, 8192],
    sceneWriter: [...FLASH, undefined, 24000],
    sceneRepair: [...FLASH, undefined, 24000],
    formatFill: [...HAIKU, undefined, 2000],
    proAssistant: [...HAIKU, undefined, 6500],
    skillRouting: [...HAIKU, undefined, 128],
    rewriteBeat: [...FLASH, undefined, 600],
    elementEdits: [...HAIKU, undefined, 450],
    planner: [...HAIKU, undefined, 1024],
    siteRead: [...FLASH, undefined, 8192]
  };

  assert.deepEqual(Object.keys(STEPS), Object.keys(expectedDefaults));
  for (const [stepId, [provider, model, , maxTokens]] of Object.entries(expectedDefaults)) {
    const r = routeFor(stepId, clean);
    assert.equal(r.step, stepId);
    assert.equal(r.provider, provider, `${stepId} default provider`);
    assert.equal(r.model, model, `${stepId} default model`);
    assert.equal(r.maxTokens, maxTokens, `${stepId} default maxTokens`);
  }

  const all = allRoutes(clean);
  assert.equal(Object.keys(all).length, 17);
  assert.equal([...all].length, 17);
  assert.equal(NOT_ROUTED.length, 4);

  // Tier-blind legacy vars no longer steer anyProvider steps (they would break the Standard/Premium split).
  const legacy = { MODEL_DEFAULT: "claude-sonnet-4-6", ANTHROPIC_MODEL: "claude-sonnet-4-6", PLATE_MODEL: "claude-opus-5-5", SCRIPT_MODEL: "claude-opus-5-5", FRAME_MODEL: "claude-opus-5-5" };
  for (const id of Object.keys(STEPS)) {
    const r = routeFor(id, legacy);
    assert.equal(`${r.provider}:${r.model}`, `${expectedDefaults[id][0]}:${expectedDefaults[id][1]}`, `${id} ignores legacy vars`);
  }
  // Gemini-only steps still honour their own var.
  assert.equal(routeFor("voiceAlign", { VOICE_ALIGN_MODEL: "gemini-3.8-flash" }).model, "gemini-3.8-flash");
  assert.equal(routeFor("siteRead", { SITE_READ_MODEL: "gemini-3.8-flash" }).model, "gemini-3.8-flash");
}

// ============================================================================
// 2. Parsing, parent inheritance, precedence, effort/maxTokens, bare inference
// ============================================================================
{
  // Explicit MODEL_SCENE_WRITER=gemini:gemini-3.8-flash
  const sw = routeFor("sceneWriter", { MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash" });
  assert.equal(sw.provider, "gemini");
  assert.equal(sw.model, "gemini-3.8-flash");
  assert.equal(sw.explicit, true);

  // Parent inheritance: sceneRepair follows sceneWriter; own env wins
  const srInherited = routeFor("sceneRepair", { MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash" });
  assert.equal(srInherited.provider, "gemini");
  assert.equal(srInherited.model, "gemini-3.8-flash");
  assert.equal(srInherited.explicit, true);

  const srOwn = routeFor("sceneRepair", {
    MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash",
    MODEL_SCENE_REPAIR: "anthropic:claude-opus-5-5"
  });
  assert.equal(srOwn.provider, "anthropic");
  assert.equal(srOwn.model, "claude-opus-5-5");

  // Parent inheritance for script -> scriptWrite & sceneInsert
  const swScript = routeFor("scriptWrite", { MODEL_SCRIPT: "gemini:gemini-4-argon" });
  assert.equal(swScript.provider, "gemini");
  assert.equal(swScript.model, "gemini-4-argon");
  // Step-default effort "low" is dropped when provider changed from anthropic to gemini without explicit EFFORT_*
  assert.equal(swScript.effort, undefined);

  // Per-tier env overrides: MODEL_<ENV>_<TIER> beats MODEL_<ENV> beats the tier table.
  assert.equal(routeFor("sceneWriter", { MODEL_SCENE_WRITER_PREMIUM: "claude-opus-5-5" }, "premium").model, "claude-opus-5-5");
  assert.equal(routeFor("sceneWriter", { MODEL_SCENE_WRITER_PREMIUM: "claude-haiku-5-5" }).model, "gemini-3.8-flash");
  assert.equal(routeFor("sceneWriter", { MODEL_SCENE_WRITER: "claude-haiku-5-5", MODEL_SCENE_WRITER_STANDARD: "gemini-3.8-flash" }).model, "gemini-3.8-flash");
  assert.equal(routeFor("sceneRepair", { MODEL_SCENE_WRITER_PREMIUM: "claude-haiku-5-5" }, "premium").model, "claude-haiku-5-5");

  // EFFORT and MAX_TOKENS parsing & inheritance
  const effRoute = routeFor("sceneRepair", {
    MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash",
    EFFORT_SCENE_WRITER: "high",
    MAX_TOKENS_SCENE_WRITER: "32000"
  });
  assert.equal(effRoute.effort, "high");
  assert.equal(effRoute.maxTokens, 32000);

  const effOwnWins = routeFor("sceneRepair", {
    EFFORT_SCENE_WRITER: "high",
    EFFORT_SCENE_REPAIR: "low",
    MAX_TOKENS_SCENE_WRITER: "32000",
    MAX_TOKENS_SCENE_REPAIR: "12000"
  });
  assert.equal(effOwnWins.effort, "low");
  assert.equal(effOwnWins.maxTokens, 12000);

  // Bare claude-* / gemini-* inference & openai alias
  assert.deepEqual(
    { p: routeFor("script", { MODEL_SCRIPT: "claude-opus-5-5" }).provider, m: routeFor("script", { MODEL_SCRIPT: "claude-opus-5-5" }).model },
    { p: "anthropic", m: "claude-opus-5-5" }
  );
  assert.deepEqual(
    { p: routeFor("script", { MODEL_SCRIPT: "gemini-3.8-flash" }).provider, m: routeFor("script", { MODEL_SCRIPT: "gemini-3.8-flash" }).model },
    { p: "gemini", m: "gemini-3.8-flash" }
  );
  const oai = routeFor("script", {
    MODEL_SCRIPT: "openai:gpt-4.1-mini",
    BASE_URL_SCRIPT: "https://api.example.com/v1/"
  });
  assert.equal(oai.provider, "openai-compatible");
  assert.equal(oai.model, "gpt-4.1-mini");
  assert.equal(oai.baseUrl, "https://api.example.com/v1");
}

// ============================================================================
// 3. Validation & warnings
// ============================================================================
{
  // Valid default configuration when both Anthropic and Gemini keys are present
  validateRoutes({ ANTHROPIC_API_KEY: "sk-ant-test", GEMINI_API_KEY: "gem-test" });

  // Standard uses Haiku 5.5 for five small structured steps, so the Anthropic key is needed unless they are routed to Gemini.
  assert.throws(
    () => validateRoutes({ GEMINI_API_KEY: "gem-test" }),
    /Missing ANTHROPIC_API_KEY for anthropic routes \(formatFill, proAssistant, skillRouting, elementEdits, planner\)/
  );
  validateRoutes({
    MODEL_FORMAT_FILL_STANDARD: "gemini:gemini-3.8-flash",
    MODEL_PRO_ASSISTANT: "gemini:gemini-3.8-flash",
    MODEL_SKILL_ROUTING: "gemini:gemini-3.8-flash",
    MODEL_ELEMENT_EDITS: "gemini:gemini-3.8-flash",
    MODEL_PLANNER_FILL: "gemini:gemini-3.8-flash",
    GEMINI_API_KEY: "gem-test"
  });

  // Collects ALL problems in one Error message
  let combinedErr = null;
  try {
    validateRoutes({
      MODEL_SCRIPT: "mistral:mistral-large",
      MODEL_DIRECTOR: "claude-only-no-model:",
      MODEL_MOTION: "llama-3.3-70b",
      EFFORT_FRAME_SKETCH: "turbo",
      MAX_TOKENS_SCREENSHOT: "-50",
      MODEL_VOICE_ALIGN: "anthropic:claude-sonnet-5-5",
      MODEL_SITE_READ: "anthropic:claude-sonnet-5-5",
      MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash",
      MODEL_FORMAT_FILL: "openai-compatible:qwen-coder"
      // Missing ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_COMPATIBLE_API_KEY, and BASE_URL_FORMAT_FILL
    });
  } catch (err) {
    combinedErr = err;
  }
  assert.ok(combinedErr instanceof Error, "validateRoutes should throw");
  const msg = combinedErr.message;
  assert.match(msg, /MODEL_SCRIPT: unknown provider "mistral"/);
  assert.match(msg, /MODEL_DIRECTOR: unknown provider "claude-only-no-model"/);
  assert.match(msg, /MODEL_MOTION: cannot infer provider for bare model "llama-3\.3-70b"/);
  assert.match(msg, /EFFORT_FRAME_SKETCH: invalid effort "turbo"/);
  assert.match(msg, /MAX_TOKENS_SCREENSHOT: must be a positive integer/);
  assert.match(msg, /Step "voiceAlign" \(MODEL_VOICE_ALIGN\) requires provider "gemini", got "anthropic"/);
  assert.match(msg, /Step "siteRead" \(MODEL_SITE_READ\) requires provider "gemini", got "anthropic"/);
  assert.match(msg, /Step "formatFill" uses provider "openai-compatible" but neither BASE_URL_FORMAT_FILL nor OPENAI_COMPATIBLE_BASE_URL is set/);
  assert.match(msg, /Missing ANTHROPIC_API_KEY/);
  assert.match(msg, /Missing GEMINI_API_KEY/);
  assert.match(msg, /Missing OPENAI_COMPATIBLE_API_KEY/);

  // Model-less value check
  assert.throws(
    () => validateRoutes({ MODEL_SCRIPT: "anthropic:", ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }),
    /MODEL_SCRIPT: missing model id/
  );

  // Warnings for typo MODEL_<X>, ignoring MODEL_DEFAULT and MODEL_PRICE_*
  const warnings = routeWarnings({
    MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash",
    MODEL_SCENE_WRITER_PREMIUM: "claude-opus-5-5",
    MODEL_PRICE_GPT_4O: "2.5,10,1.25",
    MODEL_SCEEN_WRITER: "gemini:gemini-3.8-flash"
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MODEL_SCEEN_WRITER/);
  // Legacy tier-blind vars are flagged as ignored; an override outside a tier's policy is flagged.
  const legacyWarn = routeWarnings({ PLATE_MODEL: "claude-opus-5-5", MODEL_SCENE_WRITER_STANDARD: "claude-sonnet-4-6" });
  assert.ok(legacyWarn.some((w) => /PLATE_MODEL is set but ignored/.test(w)));
  assert.ok(legacyWarn.some((w) => /sceneWriter" on standard resolves to anthropic:claude-sonnet-4-6/.test(w)));
}

// Section 4 exercises the adapters on Claude/Gemini routes, so pin those steps by env (the tier table would pick Flash).
Object.assign(process.env, {
  MODEL_FRAME_SKETCH: "claude-sonnet-4-6",
  MODEL_SCENE_WRITER: "claude-sonnet-4-6",
  MODEL_SCRIPT: "claude-sonnet-5-5",
  MODEL_SCRIPT_WRITE: "claude-sonnet-4-6",
  MODEL_DIRECTOR: "claude-opus-5-5"
});

// ============================================================================
// 4. Adapters with mocked HTTP (Anthropic, Gemini, OpenAI-compatible)
// ============================================================================
{
  // 4a. Anthropic non-stream: cache_control on system & parts, output_config merge (effort + schema), image block
  let capturedUrl = "";
  let capturedBody = null;
  const logs = [];
  const antRes = await callModel({
    step: "frameSketch",
    system: [
      { text: "Cached system instructions", cache: true },
      { text: "Uncached addendum" }
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", mime: "image/jpeg", base64: "QUJD" },
          { type: "text", text: "Cached prompt part", cache: true },
          { type: "text", text: "Question?" }
        ]
      }
    ],
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    log: (line) => logs.push(JSON.parse(line)),
    request: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init.body));
      return Response.json({
        content: [{ type: "text", text: '{"ok":true}' }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 50
        }
      });
    }
  });

  assert.match(capturedUrl, /\/v1\/messages$/);
  assert.equal(capturedBody.model, "claude-sonnet-4-6");
  assert.equal(capturedBody.max_tokens, 6000);
  assert.deepEqual(capturedBody.system, [
    { type: "text", text: "Cached system instructions", cache_control: { type: "ephemeral" } },
    { type: "text", text: "Uncached addendum" }
  ]);
  assert.deepEqual(capturedBody.messages, [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
        { type: "text", text: "Cached prompt part", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Question?" }
      ]
    }
  ]);
  assert.deepEqual(capturedBody.output_config, {
    effort: "low",
    format: {
      type: "json_schema",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
    }
  });
  assert.equal(antRes.text, '{"ok":true}');
  assert.equal(antRes.stopReason, "end");
  assert.deepEqual(antRes.usage, { input: 100, output: 20, cacheRead: 500, cacheWrite: 50 });
  // Both anthropic_usage (from anthropic.ts) and model_usage (from providers.ts) were logged
  assert.equal(logs.length, 2);
  assert.equal(logs[0].event, "anthropic_usage");
  assert.equal(logs[1].event, "model_usage");

  // 4b. Anthropic SSE stream + streamModel generator
  const streamedChunks = [];
  const progressEvents = [];
  let startedCalls = 0;
  for await (const chunk of streamModel({
    step: "scriptWrite",
    system: "Write beats",
    messages: [{ role: "user", content: "Go" }],
    onStart: () => { startedCalls++; },
    onProgress: (p) => progressEvents.push(p),
    log: () => {},
    request: async () =>
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1,"cache_read_input_tokens":10,"cache_creation_input_tokens":0}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"BEAT: One\\n"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"VOICE: Hello world."}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      ])
  })) {
    streamedChunks.push(chunk);
  }
  assert.deepEqual(streamedChunks, ["BEAT: One\n", "VOICE: Hello world."]);
  assert.equal(startedCalls, 1);
  assert.ok(progressEvents.length >= 2);

  // 4c. Gemini request body (systemInstruction, thinkingLevel, schema, images, maxOutputTokens cap) + usage mapping
  let gemUrl = "";
  let gemBody = null;
  let gemHeaders = null;
  process.env.GEMINI_API_KEY = "test-gemini-key-secret";
  const gemRoute = routeFor("sceneWriter", {
    MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash",
    EFFORT_SCENE_WRITER: "xhigh",
    MAX_TOKENS_SCENE_WRITER: "100000" // exceeds 65536 cap
  });
  const gemRes = await callModel({
    step: "sceneWriter",
    route: gemRoute,
    system: [{ text: "Part A", cache: true }, { text: "Part B" }],
    messages: [
      { role: "user", content: "First turn" },
      { role: "assistant", content: "Model reply" },
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image", mime: "image/png", base64: "iVBORw==" }
        ]
      }
    ],
    schema: { type: "object", properties: { scene: { type: "string" } } },
    log: () => {},
    request: async (url, init) => {
      gemUrl = String(url);
      gemHeaders = init.headers;
      gemBody = JSON.parse(String(init.body));
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "thinking...", thought: true },
                { text: '{"scene":"drawn"}' }
              ]
            },
            finishReason: "STOP"
          }
        ],
        usageMetadata: {
          promptTokenCount: 1000,
          cachedContentTokenCount: 400,
          candidatesTokenCount: 150,
          thoughtsTokenCount: 50
        }
      });
    }
  });

  assert.equal(
    gemUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
  );
  assert.equal(gemHeaders["x-goog-api-key"], "test-gemini-key-secret");
  assert.deepEqual(gemBody.systemInstruction, { parts: [{ text: "Part A\n\nPart B" }] });
  assert.deepEqual(gemBody.contents, [
    { role: "user", parts: [{ text: "First turn" }] },
    { role: "model", parts: [{ text: "Model reply" }] },
    {
      role: "user",
      parts: [
        { text: "Look at this" },
        { inlineData: { mimeType: "image/png", data: "iVBORw==" } }
      ]
    }
  ]);
  assert.deepEqual(gemBody.generationConfig, {
    maxOutputTokens: 65536,
    responseMimeType: "application/json",
    responseJsonSchema: { type: "object", properties: { scene: { type: "string" } } },
    thinkingConfig: { thinkingLevel: "high" }
  });
  assert.equal(geminiThinkingLevel("low"), "low");
  assert.equal(geminiThinkingLevel("medium"), "medium");
  assert.equal(geminiThinkingLevel("high"), "high");
  assert.equal(geminiThinkingLevel("xhigh"), "high");
  assert.equal(geminiThinkingLevel("max"), "high");
  assert.equal(gemRes.text, '{"scene":"drawn"}');
  assert.equal(gemRes.stopReason, "end");
  // input = 1000 - 400 = 600, output = 150 + 50 = 200, cacheRead = 400, cacheWrite = 0
  assert.deepEqual(gemRes.usage, { input: 600, output: 200, cacheRead: 400, cacheWrite: 0 });

  // 4d. Gemini MAX_TOKENS with empty parts (thinking ate whole budget) -> returns stopReason: "max_tokens"
  const gemMaxRes = await callModel({
    step: "sceneWriter",
    route: routeFor("sceneWriter", { MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash" }),
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    log: () => {},
    request: async () =>
      Response.json({
        candidates: [{ content: {}, finishReason: "MAX_TOKENS" }],
        usageMetadata: { promptTokenCount: 100, thoughtsTokenCount: 24000 }
      })
  });
  assert.equal(gemMaxRes.text, "");
  assert.equal(gemMaxRes.stopReason, "max_tokens");
  assert.equal(gemMaxRes.usage.output, 24000);

  // 4e. Gemini safety block -> refusal (both finishReason SAFETY and promptFeedback.blockReason)
  for (const payload of [
    { candidates: [{ finishReason: "PROHIBITED_CONTENT" }], usageMetadata: { promptTokenCount: 10 } },
    { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 10 } }
  ]) {
    const refRes = await callModel({
      step: "script",
      route: routeFor("script", { MODEL_SCRIPT: "gemini:gemini-3.8-flash" }),
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      log: () => {},
      request: async () => Response.json(payload)
    });
    assert.equal(refRes.stopReason, "refusal");
  }

  // 4f. Gemini SSE stream
  const gemStreamChunks = [];
  const gemStreamRes = await callModel({
    step: "sceneWriter",
    route: routeFor("sceneWriter", { MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash" }),
    stream: true,
    system: "sys",
    messages: [{ role: "user", content: "stream me" }],
    onText: (c) => gemStreamChunks.push(c),
    log: () => {},
    request: async (url) => {
      assert.match(String(url), /:streamGenerateContent\?alt=sse$/);
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}],"usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":2}}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Gemini!"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":50,"cachedContentTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":3}}\n\n'
      ]);
    }
  });
  assert.deepEqual(gemStreamChunks, ["Hello ", "Gemini!"]);
  assert.equal(gemStreamRes.text, "Hello Gemini!");
  assert.equal(gemStreamRes.stopReason, "end");
  assert.deepEqual(gemStreamRes.usage, { input: 40, output: 8, cacheRead: 10, cacheWrite: 0 });

  // 4g. OpenAI-compatible body + usage + explicit reasoning_effort rule
  process.env.OPENAI_COMPATIBLE_API_KEY = "oai-secret-key";
  let oaiBody = null;
  let oaiHeaders = null;
  const oaiRouteImplicitEffort = routeFor("frameSketch", {
    MODEL_FRAME_SKETCH: "openai-compatible:deepseek-chat",
    BASE_URL_FRAME_SKETCH: "https://openrouter.example/v1"
  });
  // frameSketch's default effort ("low") was dropped because provider !== anthropic
  assert.equal(oaiRouteImplicitEffort.effort, undefined);

  const oaiRes1 = await callModel({
    step: "frameSketch",
    route: oaiRouteImplicitEffort,
    system: "Draw SVG",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Reference" },
          { type: "image", mime: "image/webp", base64: "UklGRg==" }
        ]
      }
    ],
    schema: { type: "object", properties: { svg: { type: "string" } } },
    log: () => {},
    request: async (_url, init) => {
      oaiHeaders = init.headers;
      oaiBody = JSON.parse(String(init.body));
      return Response.json({
        choices: [{ message: { content: '{"svg":"<svg/>"}' }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 40,
          prompt_tokens_details: { cached_tokens: 80 }
        }
      });
    }
  });
  assert.equal(oaiHeaders.authorization, "Bearer oai-secret-key");
  assert.equal(oaiBody.reasoning_effort, undefined, "reasoning_effort omitted when not explicit");
  assert.deepEqual(oaiBody.response_format, { type: "json_object" });
  assert.match(oaiBody.messages[0].content, /Respond with JSON matching this schema:/);
  assert.deepEqual(oaiBody.messages[1].content, [
    { type: "text", text: "Reference" },
    { type: "image_url", image_url: { url: "data:image/webp;base64,UklGRg==" } }
  ]);
  assert.deepEqual(oaiRes1.usage, { input: 120, output: 40, cacheRead: 80, cacheWrite: 0 });
  assert.equal(oaiRes1.stopReason, "end");

  // With explicit EFFORT_FRAME_SKETCH, reasoning_effort IS sent, and length -> max_tokens, content_filter -> refusal
  const oaiRouteExplicitEffort = routeFor("frameSketch", {
    MODEL_FRAME_SKETCH: "openai:o3-mini",
    BASE_URL_FRAME_SKETCH: "https://openrouter.example/v1",
    EFFORT_FRAME_SKETCH: "medium"
  });
  const oaiRes2 = await callModel({
    step: "frameSketch",
    route: oaiRouteExplicitEffort,
    system: "Draw",
    messages: [{ role: "user", content: "go" }],
    log: () => {},
    request: async (_url, init) => {
      oaiBody = JSON.parse(String(init.body));
      return Response.json({
        choices: [{ message: { content: "cut" }, finish_reason: "length" }],
        usage: { prompt_tokens: 50, completion_tokens: 100, prompt_cache_hit_tokens: 20 }
      });
    }
  });
  assert.equal(oaiBody.reasoning_effort, "medium");
  assert.equal(oaiRes2.stopReason, "max_tokens");
  assert.deepEqual(oaiRes2.usage, { input: 30, output: 100, cacheRead: 20, cacheWrite: 0 });

  // 4h. Retry on 429 and 503 + Retry-After + never leak API key in error message
  let gemAttempts = 0;
  const gemDelays = [];
  const retryRes = await callModel({
    step: "script",
    route: routeFor("script", { MODEL_SCRIPT: "gemini:gemini-3.8-flash" }),
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    sleep: async (ms) => gemDelays.push(ms),
    log: () => {},
    request: async () => {
      gemAttempts++;
      if (gemAttempts === 1) {
        return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
      }
      if (gemAttempts === 2) {
        return new Response("{}", { status: 503 });
      }
      return Response.json({
        candidates: [{ content: { parts: [{ text: "recovered" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 }
      });
    }
  });
  assert.equal(retryRes.text, "recovered");
  assert.equal(gemAttempts, 3);
  assert.deepEqual(gemDelays, [1000, 1000]);

  // Error detail scrubs API key
  await assert.rejects(
    () =>
      callModel({
        step: "script",
        route: routeFor("script", { MODEL_SCRIPT: "gemini:gemini-3.8-flash" }),
        system: "sys",
        messages: [{ role: "user", content: "secret-user-prompt" }],
        errorPrefix: "Script call failed",
        includeErrorDetail: true,
        sleep: async () => {},
        log: () => {},
        request: async () =>
          Response.json(
            { error: { message: "Bad key test-gemini-key-secret rejected" } },
            { status: 400 }
          )
      }),
    (err) => {
      assert.match(err.message, /Script call failed \(400\): Bad key \[REDACTED\] rejected/);
      assert.ok(!err.message.includes("test-gemini-key-secret"));
      assert.ok(!err.message.includes("secret-user-prompt"));
      return true;
    }
  );

  // 4i. stopErrors across providers
  for (const [provider, route, mockResp, expectedMsg] of [
    [
      "anthropic",
      routeFor("script", { MODEL_SCRIPT: "claude-sonnet-5-5" }),
      () => Response.json({ content: [], stop_reason: "refusal", usage: {} }),
      "Custom refusal message"
    ],
    [
      "gemini",
      routeFor("script", { MODEL_SCRIPT: "gemini:gemini-3.8-flash" }),
      () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }], usageMetadata: {} }),
      "Custom max_tokens message"
    ],
    [
      "openai-compatible",
      routeFor("script", { MODEL_SCRIPT: "openai:gpt-4.1", BASE_URL_SCRIPT: "https://example.com/v1" }),
      () => Response.json({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }),
      "Custom refusal message"
    ]
  ]) {
    await assert.rejects(
      () =>
        callModel({
          step: "script",
          route,
          system: "sys",
          messages: [{ role: "user", content: "hi" }],
          stopErrors: {
            refusal: "Custom refusal message",
            max_tokens: "Custom max_tokens message"
          },
          log: () => {},
          request: async () => mockResp()
        }),
      new RegExp(expectedMsg),
      `stopErrors for ${provider}`
    );
  }
}

// ============================================================================
// 5. Cost: usdFor for known models, unknown model -> null, registerPrice, env
// ============================================================================
{
  const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
  assert.equal(usdFor("claude-opus-5-5", usage), 29.2);
  assert.equal(usdFor("claude-sonnet-5-5", usage), 14.7);
  assert.equal(usdFor("claude-haiku-5-5", usage), 0.735);
  assert.equal(usdFor("claude-sonnet-4-6", usage), 22.05);
  assert.equal(usdFor("claude-haiku-4-5-20251001", usage), 7.35);
  assert.equal(usdFor("gemini-3.8-flash", usage), 4.575);
  assert.equal(usdFor("gemini-4-argon", usage), 12.1);
  assert.equal(usdFor("gemini-2.5-flash", usage), 2.83);
  assert.equal(usdFor("gemini-3.1-pro-preview", usage), 14.2);

  // Unknown model returns null
  assert.equal(usdFor("unknown-custom-model-v1", usage), null);

  // Env price override MODEL_PRICE_<SANITISED_MODEL>=in,out,cachedIn
  assert.equal(
    usdFor("deepseek/deepseek-chat", { input: 500_000, output: 200_000, cacheRead: 100_000, cacheWrite: 0 }, {
      MODEL_PRICE_DEEPSEEK_DEEPSEEK_CHAT: "0.5,2.0,0.05"
    }),
    0.5 * 0.5 + 0.2 * 2.0 + 0.1 * 0.05
  );

  // registerPrice
  registerPrice("custom-registered-model", { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0 });
  assert.equal(usdFor("custom-registered-model", { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 }), 2);

  // maxOutputFor
  assert.equal(maxOutputFor("anthropic", "claude-sonnet-4-6"), 128000);
  assert.equal(maxOutputFor("gemini", "gemini-3.8-flash"), 65536);
  assert.equal(maxOutputFor("openai-compatible", "any-compat-model"), 32000);
  assert.ok(MAX_OUTPUT["claude-opus-5-5"] === 128000);
  assert.ok(PRICES["gemini-3.8-flash"].in === 0.75);
}

// ============================================================================
// 6. ladder() per provider & supportsPromptCacheGate()
// ============================================================================
{
  const antLadder = ladder(routeFor("sceneWriter", {}, "premium"));
  assert.equal(antLadder.length, 3);
  assert.equal(antLadder[0].maxTokens, 24000);
  assert.equal(antLadder[0].effort, undefined);
  assert.equal(antLadder[1].maxTokens, 128000);
  assert.equal(antLadder[1].effort, undefined);
  assert.equal(antLadder[2].maxTokens, 128000);
  assert.equal(antLadder[2].effort, "high");

  const gemLadder = ladder(routeFor("sceneWriter", { MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash" }));
  assert.equal(gemLadder.length, 3);
  assert.equal(gemLadder[0].maxTokens, 24000);
  assert.equal(gemLadder[1].maxTokens, 65536);
  assert.equal(gemLadder[2].maxTokens, 65536);
  assert.equal(gemLadder[2].effort, "high");

  const oaiLadder = ladder(
    routeFor("sceneWriter", {
      MODEL_SCENE_WRITER: "openai:gpt-4.1",
      BASE_URL_SCENE_WRITER: "https://example.com/v1"
    })
  );
  assert.equal(oaiLadder.length, 3);
  assert.equal(oaiLadder[0].maxTokens, 24000);
  assert.equal(oaiLadder[1].maxTokens, 32000);
  assert.equal(oaiLadder[2].maxTokens, 32000);
  assert.equal(oaiLadder[2].effort, "high");

  // When tier 0 maxTokens equals maxOutputFor, tier 1 is skipped
  const cappedGemLadder = ladder(
    routeFor("sceneWriter", {
      MODEL_SCENE_WRITER: "gemini:gemini-3.8-flash",
      MAX_TOKENS_SCENE_WRITER: "65536"
    })
  );
  assert.equal(cappedGemLadder.length, 2);
  assert.equal(cappedGemLadder[0].maxTokens, 65536);
  assert.equal(cappedGemLadder[0].effort, undefined);
  assert.equal(cappedGemLadder[1].maxTokens, 65536);
  assert.equal(cappedGemLadder[1].effort, "high");

  assert.equal(supportsPromptCacheGate("anthropic"), true);
  assert.equal(supportsPromptCacheGate("gemini"), false);
  assert.equal(supportsPromptCacheGate("openai-compatible"), false);
}

// ============================================================================
// 7. Log line shape
// ============================================================================
{
  const lines = [];
  await callModel({
    step: "director",
    route: routeFor("director", { MODEL_DIRECTOR: "gemini:gemini-3.8-flash" }),
    system: "sys",
    messages: [{ role: "user", content: "go" }],
    log: (l) => lines.push(JSON.parse(l)),
    request: async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 1200,
          cachedContentTokenCount: 200,
          candidatesTokenCount: 300,
          thoughtsTokenCount: 100
        }
      })
  });
  assert.equal(lines.length, 1);
  const log = lines[0];
  assert.deepEqual(Object.keys(log), [
    "event",
    "step",
    "provider",
    "model",
    "input",
    "output",
    "cache_read",
    "cache_write",
    "usd",
    "ms",
    "stop"
  ]);
  assert.equal(log.event, "model_usage");
  assert.equal(log.step, "director");
  assert.equal(log.provider, "gemini");
  assert.equal(log.model, "gemini-3.8-flash");
  assert.equal(log.input, 1000);
  assert.equal(log.output, 400);
  assert.equal(log.cache_read, 200);
  assert.equal(log.cache_write, 0);
  assert.equal(log.usd, usdFor("gemini-3.8-flash", { input: 1000, output: 400, cacheRead: 200, cacheWrite: 0 }));
  assert.equal(typeof log.ms, "number");
  assert.ok(log.ms >= 0);
  assert.equal(log.stop, "end");

  // Unknown model logs usd: null
  const unknownLines = [];
  await callModel({
    step: "director",
    route: routeFor("director", {
      MODEL_DIRECTOR: "openai:unpriced-local-model",
      BASE_URL_DIRECTOR: "https://example.com/v1"
    }),
    system: "sys",
    messages: [{ role: "user", content: "go" }],
    log: (l) => unknownLines.push(JSON.parse(l)),
    request: async () =>
      Response.json({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
  });
  assert.equal(unknownLines.length, 1);
  assert.equal(unknownLines[0].usd, null);
}

console.log("model-routing: defaults, parsing, validation, adapters, streaming, retries, prices, ladder, and logs verified offline");

// ---- dated price changes, Argon limits, thinking-only answers (2026-11-09 research) ----
{
  const { priceAt } = await import("../src/models/prices.ts");
  assert.equal(usdFor("gemini-4-argon", { input: 1_000_000 }, {}, new Date("2026-11-30T23:59:59Z")), 2);
  assert.equal(usdFor("gemini-4-argon", { input: 1_000_000 }, {}, new Date("2026-12-01T00:00:00Z")), 4);
  assert.equal(usdFor("gemini-4-argon", { output: 1_000_000, cacheRead: 1_000_000 }, {}, new Date("2027-03-01Z")), 20.2);
  assert.equal(usdFor("gemini-3.8-flash", { output: 1_000_000 }, {}, new Date("2026-12-31T12:00:00Z")), 3.75);
  assert.equal(usdFor("gemini-3.8-flash", { output: 1_000_000 }, {}, new Date("2027-01-01T00:00:00Z")), 7.5);
  assert.equal(priceAt("gemini-3.5-flash-lite").in, 0.3);
  assert.equal(maxOutputFor("gemini", "gemini-4-argon"), 65536);
  assert.equal(maxOutputFor("gemini", "gemini-4-argon", false), 32768);
  assert.equal(maxOutputFor("gemini", "gemini-3.8-flash", false), 65536);
  const empty = (finish) => Response.json({ candidates: [{ content: {}, finishReason: finish }], usageMetadata: { promptTokenCount: 5, thoughtsTokenCount: 100 } });
  const r = await callModel({ step: "sceneWriter", route: { ...routeFor("sceneWriter", { GEMINI_API_KEY: "k" }), provider: "gemini", model: "gemini-4-argon" }, system: "s", messages: [{ role: "user", content: "u" }], request: async () => empty("STOP"), log: () => {} });
  assert.equal(r.stopReason, "max_tokens", "an empty STOP answer (thinking used the budget) is a cut-off");
  assert.equal(r.text, "");
  await assert.rejects(() => callModel({ step: "sceneWriter", route: { ...routeFor("sceneWriter", {}), provider: "gemini", model: "gemini-4-argon" }, system: "s", messages: [{ role: "user", content: "u" }], request: async () => empty("STOP"), log: () => {}, stopErrors: { max_tokens: "CUT OFF: x" } }), /CUT OFF/);
  console.log("model-routing: dated prices, Argon limits, thinking-only cut-off verified");
}
