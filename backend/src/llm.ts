// One JSON-in, JSON-out call to either model family, so the director, the screenshot reader and the director A/B test share a path.
//   Claude:  the Messages API, structured output through output_config (anthropic.ts retries and bounds it).
//   Gemini:  generateContent with responseJsonSchema.
import { anthropicMessage } from "./anthropic.ts";
import { config } from "./config.ts";

export type LlmProvider = "anthropic" | "gemini";
export type LlmImage = { mime: string; base64: string };
export type LlmRequest = {
  provider: LlmProvider;
  model: string;
  system: string;
  user: string;
  /** Earlier turns (a repair round): sent before `user`. */
  history?: { role: "user" | "assistant"; content: string }[];
  images?: LlmImage[];
  /** JSON schema the answer must follow. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Claude only: messages for stop reasons ("refusal", "max_tokens") that should fail with a plain sentence. */
  stopErrors?: Record<string, string>;
};
export type LlmResult = { text: string; inputTokens: number; outputTokens: number; ms: number };

export async function llmJson(request: LlmRequest): Promise<LlmResult> {
  const started = Date.now();
  const done = (text: string, inputTokens: number, outputTokens: number): LlmResult => ({ text, inputTokens, outputTokens, ms: Date.now() - started });
  if (request.provider === "gemini") {
    if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not set.");
    const parts = [{ text: request.user }, ...(request.images ?? []).map((image) => ({ inlineData: { mimeType: image.mime, data: image.base64 } }))];
    const deadline = AbortSignal.timeout(request.timeoutMs ?? 180_000);
    const signal = request.signal ? AbortSignal.any([deadline, request.signal]) : deadline;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey }, signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [...(request.history ?? []).map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] })), { role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: request.schema, maxOutputTokens: request.maxTokens ?? 16000, temperature: 0.7 }
      })
    });
    const payload = await response.json().catch(() => ({})) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; error?: { message?: string } };
    if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${payload.error?.message ?? "no detail"}`);
    const candidate = payload.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text) throw new Error(`Gemini returned no text (finish reason: ${candidate?.finishReason ?? "unknown"}).`);
    return done(text, payload.usageMetadata?.promptTokenCount ?? 0, (payload.usageMetadata?.candidatesTokenCount ?? 0) + (payload.usageMetadata?.thoughtsTokenCount ?? 0));
  }
  const content: unknown = request.images?.length ? [
    ...(request.images ?? []).map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } })),
    { type: "text", text: request.user }
  ] : request.user;
  const payload = await anthropicMessage({
    model: request.model, max_tokens: request.maxTokens ?? 16000,
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    messages: [...(request.history ?? []), { role: "user", content }],
    output_config: { format: { type: "json_schema", schema: request.schema } }
  }, { ...(request.signal ? { signal: request.signal } : {}), timeoutMs: request.timeoutMs ?? 180_000, errorPrefix: "Claude request failed", includeErrorDetail: true, ...(request.stopErrors ? { stopErrors: request.stopErrors } : {}) });
  const text = payload.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("") ?? "";
  if (!text) throw new Error("Claude returned no text.");
  const usage = (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return done(text, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0);
}
