// Checks that each candidate model answers a structured-output request. Needs ANTHROPIC_API_KEY and GEMINI_API_KEY in the environment.
process.env.APP_ENV ??= "local"; process.env.PLANNER ??= "anthropic";
const { llmJson } = await import("../../backend/src/llm.ts");
const schema = { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } };
for (const [provider, model] of [["anthropic", "claude-opus-5-5"], ["gemini", "gemini-4-argon"]]) {
  try {
    const r = await llmJson({ provider, model, system: "Answer briefly.", user: "Say OK in one word.", schema, maxTokens: 3000, timeoutMs: 60_000 });
    console.log(model, "ok", r.ms + "ms", r.inputTokens + "/" + r.outputTokens, JSON.stringify(r.text.slice(0, 60)));
  } catch (error) { console.log(model, "FAILED", String(error.message).slice(0, 160)); }
}
