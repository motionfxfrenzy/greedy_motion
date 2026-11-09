// One JSON-in, JSON-out call for the steps that answer with a schema (script draft, director, screenshot reader, the director A/B test).
// It is a thin wrapper over the routed provider layer (src/models/): the step names the route (MODEL_<STEP>, see docs/MODEL_ROUTING.md);
// `provider` + `model` override it for one call (the A/B test sets them per run).
import { callModel, type ModelPart } from "./models/providers.ts";
import { routeFor, type Provider, type StepId } from "./models/routes.ts";

export type LlmProvider = "anthropic" | "gemini";
export type LlmImage = { mime: string; base64: string };
export type LlmRequest = {
  /** The routed step; its provider and model come from the routing table unless `provider` and `model` are both given. */
  step?: StepId;
  provider?: Provider;
  model?: string;
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
  /** Messages for stop reasons ("refusal", "max_tokens") that should fail with a plain sentence. */
  stopErrors?: Record<string, string>;
};
export type LlmResult = { text: string; inputTokens: number; outputTokens: number; ms: number; provider: Provider; model: string; usd: number | null };

export async function llmJson(request: LlmRequest): Promise<LlmResult> {
  const step: StepId = request.step ?? "script";
  const base = routeFor(step);
  const route = request.provider && request.model ? { ...base, provider: request.provider, model: request.model, explicit: true } : base;
  const user: string | ModelPart[] = request.images?.length
    ? [...request.images.map((image): ModelPart => ({ type: "image", mime: image.mime, base64: image.base64 })), { type: "text", text: request.user }]
    : request.user;
  const result = await callModel({
    step, route, system: [{ text: request.system, cache: true }],
    messages: [...(request.history ?? []), { role: "user", content: user }],
    schema: request.schema,
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    timeoutMs: request.timeoutMs ?? 180_000,
    errorPrefix: route.provider === "gemini" ? "Gemini request failed" : "Claude request failed", includeErrorDetail: true,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.stopErrors ? { stopErrors: request.stopErrors } : {})
  });
  if (!result.text) throw new Error(`${route.provider === "gemini" ? "Gemini" : "Claude"} returned no text.`);
  return { text: result.text, inputTokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite, outputTokens: result.usage.output, ms: result.ms, provider: result.provider, model: result.model, usd: result.usd };
}
