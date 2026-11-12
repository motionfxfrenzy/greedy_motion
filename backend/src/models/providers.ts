import { anthropicMessage, anthropicStream, responseText, type AnthropicResponse } from "../anthropic.ts";
import { maxOutputFor, usdFor } from "./prices.ts";
import { getRouteMeta, routeFor, type Effort, type Provider, type Route, type StepId } from "./routes.ts";
import { STEPS } from "./steps.ts";

export type ModelPart =
  | { type: "text"; text: string; cache?: boolean }
  | { type: "image"; mime: string; base64: string };

export type ModelMessage = {
  role: "user" | "assistant";
  content: string | ModelPart[];
};

/** Note: input EXCLUDES cached tokens (cacheRead / cacheWrite are separate). */
export type ModelUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type StopReason = "end" | "max_tokens" | "refusal" | "other";

export type ModelCall = {
  step: StepId;
  system: string | { text: string; cache?: boolean }[];
  messages: ModelMessage[];
  /** JSON mode schema. */
  schema?: Record<string, unknown>;
  /** Call-site values; route's explicit ones win. */
  maxTokens?: number;
  effort?: Effort;
  /** Default routeFor(step); a retry ladder passes a modified copy. */
  route?: Route;
  stream?: boolean;
  onProgress?: (p: { chars: number; lines: number; tokens: number }) => void;
  onStart?: () => void;
  onText?: (chunk: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  errorPrefix?: string;
  includeErrorDetail?: boolean;
  stopErrors?: Partial<Record<StopReason | "max_tokens" | "refusal", string>>;
  request?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

export type ModelResult = {
  text: string;
  stopReason: StopReason;
  usage: ModelUsage;
  provider: Provider;
  model: string;
  usd: number | null;
  ms: number;
  route: Route;
};

/** Maps unified Effort to Gemini's thinkingConfig.thinkingLevel. */
export function geminiThinkingLevel(effort: Effort): "low" | "medium" | "high" {
  if (effort === "low") return "low";
  if (effort === "medium") return "medium";
  return "high";
}

/** True only for Anthropic (Gemini's implicit cache did not hit reliably in tests, so the gate is skipped). */
export function supportsPromptCacheGate(provider: Provider): boolean {
  return provider === "anthropic";
}

/**
 * Scene writer cut-off retry ladder:
 * - tier 0: { maxTokens: min(route.maxTokens, maxOutputFor) }
 * - tier 1: { maxTokens: maxOutputFor(...) } (skipped if equal to tier 0)
 * - tier 2: same max + effort: "high"
 */
export function ladder(route: Route): Route[] {
  const cap = maxOutputFor(route.provider, route.model);
  const tier0Max = Math.min(route.maxTokens, cap);
  const tier0: Route = { ...route, maxTokens: tier0Max };
  ROUTE_META.set(tier0, {
    explicitEffort: Boolean(getRouteMeta(route)?.explicitEffort),
    explicitMaxTokens: true
  });

  const tiers: Route[] = [tier0];
  if (cap !== tier0Max) {
    const tier1: Route = { ...route, maxTokens: cap };
    ROUTE_META.set(tier1, {
      explicitEffort: Boolean(getRouteMeta(route)?.explicitEffort),
      explicitMaxTokens: true
    });
    tiers.push(tier1);
  }

  const tier2: Route = { ...route, maxTokens: cap, effort: "high" };
  ROUTE_META.set(tier2, { explicitEffort: true, explicitMaxTokens: true });
  tiers.push(tier2);
  return tiers;
}

const ROUTE_META = {
  set(route: Route, meta: { explicitEffort: boolean; explicitMaxTokens: boolean }) {
    LOCAL_ROUTE_META.set(route, meta);
  },
  get(route: Route) {
    return LOCAL_ROUTE_META.get(route) ?? getRouteMeta(route);
  }
};
const LOCAL_ROUTE_META = new WeakMap<Route, { explicitEffort: boolean; explicitMaxTokens: boolean }>();

function resolveCallParameters(call: ModelCall, route: Route): {
  maxTokens: number;
  effort: Effort | undefined;
  effortIsExplicit: boolean;
} {
  const stepDef = STEPS[call.step];
  const meta = ROUTE_META.get(route);
  const routeMaxExplicit =
    meta?.explicitMaxTokens ?? (Boolean(call.route) && route.maxTokens !== stepDef.maxTokens);
  const routeEffortExplicit =
    meta?.explicitEffort ??
    (Boolean(call.route) && route.effort !== undefined && (route.effort !== stepDef.effort || route.explicit));

  const rawMax = routeMaxExplicit ? route.maxTokens : (call.maxTokens ?? route.maxTokens);
  const maxTokens = Math.min(rawMax, maxOutputFor(route.provider, route.model, call.stream !== false && Boolean(call.stream)));

  const effort = routeEffortExplicit ? route.effort : (call.effort ?? route.effort);
  const effortIsExplicit = routeEffortExplicit || (call.effort !== undefined && route.explicit);

  return { maxTokens, effort, effortIsExplicit };
}

const isRetryableError = (err: unknown, signal: AbortSignal): boolean => {
  if (signal.aborted) return false;
  if (!err || typeof err !== "object") return false;
  if ((err as { retryableStreamDrop?: boolean }).retryableStreamDrop) return true;
  const code =
    (err as { code?: string; cause?: { code?: string } }).code ??
    (err as { cause?: { code?: string } }).cause?.code ??
    "";
  if (/^(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/i.test(code)) return true;
  const msg = `${(err as Error).message ?? ""} ${(err as { cause?: Error }).cause?.message ?? ""}`;
  return /\b(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_|fetch failed|socket hang up|terminated|premature close|unexpected end of file|stream dropped)\b/i.test(
    msg
  );
};

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : retryAfter
      ? Date.parse(retryAfter) - Date.now()
      : NaN;
  return Math.max(0, Math.min(10_000, Number.isFinite(delay) ? delay : 500 * 2 ** attempt));
}

function scrubSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[REDACTED]");
}

function mapAnthropicStop(reason: string | undefined): StopReason {
  if (reason === "end_turn" || reason === "stop_sequence") return "end";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "refusal") return "refusal";
  return reason ? "other" : "end";
}

function mapGeminiStop(finishReason: string | undefined, blockReason: string | undefined, text?: string): StopReason {
  if (blockReason) return "refusal";
  // Thinking tokens count against the output limit: an empty answer with a normal stop means the thinking used the whole budget (a cut-off).
  if ((!finishReason || finishReason === "STOP") && text !== undefined && text.length === 0) return "max_tokens";
  if (!finishReason || finishReason === "STOP") return "end";
  if (finishReason === "MAX_TOKENS") return "max_tokens";
  if (
    finishReason === "SAFETY" ||
    finishReason === "PROHIBITED_CONTENT" ||
    finishReason === "BLOCKLIST" ||
    finishReason === "SPII" ||
    finishReason === "RECITATION" ||
    finishReason === "IMAGE_SAFETY"
  ) {
    return "refusal";
  }
  return "other";
}

function mapOpenAiStop(finishReason: string | undefined | null): StopReason {
  if (!finishReason || finishReason === "stop") return "end";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "refusal";
  return "other";
}

function wrapFetchForAnthropicOnText(
  baseRequest: typeof fetch,
  onText: (chunk: string) => void
): { request: typeof fetch; didEmit: () => boolean } {
  let emitted = false;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await baseRequest(input, init);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !response.body || !contentType.startsWith("text/event-stream")) {
      return response;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffered = "";
    let eventType = "";

    const inspectLine = (rawLine: string) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        eventType = "";
        return;
      }
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
        return;
      }
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        const type = ev.type ?? eventType;
        if (
          type === "content_block_delta" &&
          (ev.delta?.type === "text_delta" || ev.delta?.type === undefined) &&
          typeof ev.delta?.text === "string" &&
          ev.delta.text.length > 0
        ) {
          emitted = true;
          onText(ev.delta.text);
        }
      } catch {
        // Ignore malformed JSON here; anthropicStream will handle it.
      }
    };

    const passthrough = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            buffered += decoder.decode();
            if (buffered.length > 0) {
              for (const l of buffered.split("\n")) inspectLine(l);
              buffered = "";
            }
            controller.close();
            return;
          }
          buffered += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffered.indexOf("\n")) >= 0) {
            const line = buffered.slice(0, nl);
            buffered = buffered.slice(nl + 1);
            inspectLine(line);
          }
          controller.enqueue(value);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });

    return new Response(passthrough, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  };
  return { request: wrapped, didEmit: () => emitted };
}

const isClaude5 = (model: string) => /^claude-(opus|haiku)-5/.test(model);
const MIN_THINKING_HEADROOM = 4096;

/**
 * Request-shape rules for Claude Opus 5.5 / Haiku 5.5 (see the Claude API docs):
 * - Never send `budget_tokens`, `temperature`/`top_p`/`top_k`, a forced `tool_choice` (any/tool) or an assistant prefill: all return 400.
 * - Opus 5.5 always thinks (adaptive; `thinking: disabled` is a 400), so thinking is omitted and depth is set with `output_config.effort`.
 * - Haiku 5.5 thinks adaptively by default. `disabled` is only accepted at effort <= high, so tiny structured calls
 *   (<= 2000 output tokens) turn it off; larger calls keep the default.
 * - Thinking tokens count toward `max_tokens`, so the cap is raised to a floor of 4096 whenever thinking can run.
 */
export function anthropicRequestShape(model: string, maxTokens: number, effort: Effort | undefined): { maxTokens: number; thinking?: { type: "disabled" } } {
  if (!isClaude5(model)) return { maxTokens };
  if (model.startsWith("claude-haiku-5") && maxTokens <= 2000 && effort !== "xhigh" && effort !== "max") {
    return { maxTokens, thinking: { type: "disabled" } };
  }
  return { maxTokens: Math.max(maxTokens, MIN_THINKING_HEADROOM) };
}

async function callAnthropic(
  call: ModelCall,
  route: Route,
  maxTokens: number,
  effort: Effort | undefined
): Promise<{ text: string; stopReason: StopReason; usage: ModelUsage }> {
  const system =
    typeof call.system === "string"
      ? call.system
      : call.system.map((b) => ({
          type: "text",
          text: b.text,
          ...(b.cache ? { cache_control: { type: "ephemeral" } } : {})
        }));

  const messages = call.messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }
    return {
      role: msg.role,
      content: msg.content.map((part) => {
        if (part.type === "text") {
          return {
            type: "text",
            text: part.text,
            ...(part.cache ? { cache_control: { type: "ephemeral" } } : {})
          };
        }
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: part.mime,
            data: part.base64
          }
        };
      })
    };
  });

  const outputConfig: Record<string, unknown> = {};
  if (effort) outputConfig.effort = effort;
  if (call.schema) outputConfig.format = { type: "json_schema", schema: call.schema };

  if (messages[messages.length - 1]?.role === "assistant" && isClaude5(route.model)) {
    throw new Error(`${route.model} does not support assistant prefill; end the conversation with a user message.`);
  }
  const shape = anthropicRequestShape(route.model, maxTokens, effort);
  const body: Record<string, unknown> = {
    model: route.model,
    max_tokens: shape.maxTokens,
    ...(shape.thinking ? { thinking: shape.thinking } : {}),
    system,
    messages,
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {})
  };

  const baseRequest = call.request ?? fetch;
  const errorPrefix = call.errorPrefix ?? "Claude request failed";
  let payload: AnthropicResponse;

  if (call.stream) {
    const wrapped = call.onText ? wrapFetchForAnthropicOnText(baseRequest, call.onText) : null;
    payload = await anthropicStream(body, {
      request: wrapped ? wrapped.request : baseRequest,
      ...(call.timeoutMs !== undefined ? { timeoutMs: call.timeoutMs } : {}),
      errorPrefix,
      ...(call.includeErrorDetail !== undefined ? { includeErrorDetail: call.includeErrorDetail } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
      ...(call.sleep ? { sleep: call.sleep } : {}),
      ...(call.log ? { log: call.log } : {}),
      ...(call.onProgress ? { onProgress: call.onProgress } : {}),
      ...(call.onStart ? { onStart: call.onStart } : {})
    });
    const text = responseText(payload);
    if (call.onText && wrapped && !wrapped.didEmit() && text.length > 0) {
      call.onText(text);
    }
  } else {
    payload = await anthropicMessage(body, {
      request: baseRequest,
      ...(call.timeoutMs !== undefined ? { timeoutMs: call.timeoutMs } : {}),
      errorPrefix,
      ...(call.includeErrorDetail !== undefined ? { includeErrorDetail: call.includeErrorDetail } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
      ...(call.sleep ? { sleep: call.sleep } : {}),
      ...(call.log ? { log: call.log } : {})
    });
    const text = responseText(payload);
    if (call.onText && text.length > 0) {
      call.onText(text);
    }
  }

  const text = responseText(payload);
  const stopReason = mapAnthropicStop(payload.stop_reason);
  const u = payload.usage;
  const usage: ModelUsage = {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0
  };
  return { text, stopReason, usage };
}

type GeminiPayload = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { message?: string };
};

function extractGeminiUsage(meta: GeminiPayload["usageMetadata"]): ModelUsage {
  const prompt = meta?.promptTokenCount ?? 0;
  const cached = meta?.cachedContentTokenCount ?? 0;
  const candidates = meta?.candidatesTokenCount ?? 0;
  const thoughts = meta?.thoughtsTokenCount ?? 0;
  return {
    input: Math.max(0, prompt - cached),
    output: candidates + thoughts,
    cacheRead: cached,
    cacheWrite: 0
  };
}

async function callGemini(
  call: ModelCall,
  route: Route,
  maxTokens: number,
  effort: Effort | undefined
): Promise<{ text: string; stopReason: StopReason; usage: ModelUsage }> {
  const request = call.request ?? fetch;
  const sleep = call.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const errorPrefix = call.errorPrefix ?? "Gemini request failed";

  const systemText =
    typeof call.system === "string" ? call.system : call.system.map((b) => b.text).join("\n\n");

  const contents = call.messages.map((msg) => {
    const role = msg.role === "assistant" ? "model" : "user";
    if (typeof msg.content === "string") {
      return { role, parts: [{ text: msg.content }] };
    }
    return {
      role,
      parts: msg.content.map((part) => {
        if (part.type === "text") return { text: part.text };
        return { inlineData: { mimeType: part.mime, data: part.base64 } };
      })
    };
  });

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: maxTokens
  };
  if (call.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = call.schema;
  }
  if (effort) {
    generationConfig.thinkingConfig = { thinkingLevel: geminiThinkingLevel(effort) };
  }

  const bodyObj: Record<string, unknown> = {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    generationConfig
  };

  const action = call.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:${action}`;

  const deadline = AbortSignal.timeout(call.timeoutMs ?? 60_000);
  const signal = call.signal ? AbortSignal.any([deadline, call.signal]) : deadline;

  let didCallOnStart = false;
  const notifyStart = () => {
    if (didCallOnStart) return;
    didCallOnStart = true;
    try {
      call.onStart?.();
    } catch {
      /* ignore */
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(bodyObj),
        signal
      });
    } catch (err) {
      if (attempt < 2 && isRetryableError(err, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw err;
    }

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      const msg = detail.error?.message ? scrubSecret(detail.error.message, apiKey) : "";
      throw new Error(
        `${errorPrefix} (${response.status})${call.includeErrorDetail && msg ? `: ${msg}` : "."}`
      );
    }

    if (!call.stream) {
      const payload = (await response.json()) as GeminiPayload;
      const candidate = payload.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      const stopReason = mapGeminiStop(candidate?.finishReason, payload.promptFeedback?.blockReason, text);
      const usage = extractGeminiUsage(payload.usageMetadata);
      if (call.onText && text.length > 0) call.onText(text);
      return { text, stopReason, usage };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/event-stream")) {
      const payload = (await response.json()) as GeminiPayload;
      notifyStart();
      const candidate = payload.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      if (call.onText && text.length > 0) call.onText(text);
      const usage = extractGeminiUsage(payload.usageMetadata);
      let lines = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
      call.onProgress?.({ chars: text.length, lines, tokens: usage.output || Math.round(text.length / 3.5) });
      const stopReason = mapGeminiStop(candidate?.finishReason, payload.promptFeedback?.blockReason, text);
      return { text, stopReason, usage };
    }

    if (!response.body) throw new Error(`${errorPrefix}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffered = "";
    let text = "";
    let lines = 0;
    let finishReason: string | undefined;
    let blockReason: string | undefined;
    let lastUsageMeta: GeminiPayload["usageMetadata"];

    const handleLine = (rawLine: string) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      const chunk = JSON.parse(data) as GeminiPayload;
      notifyStart();
      if (chunk.usageMetadata) lastUsageMeta = chunk.usageMetadata;
      if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finishReason = cand.finishReason;
      const parts = cand?.content?.parts ?? [];
      for (const part of parts) {
        if (!part.thought && typeof part.text === "string" && part.text.length > 0) {
          text += part.text;
          for (let i = 0; i < part.text.length; i++) {
            if (part.text.charCodeAt(i) === 10) lines++;
          }
          call.onText?.(part.text);
          const knownOut =
            lastUsageMeta?.candidatesTokenCount !== undefined
              ? (lastUsageMeta.candidatesTokenCount ?? 0) + (lastUsageMeta.thoughtsTokenCount ?? 0)
              : Math.round(text.length / 3.5);
          call.onProgress?.({ chars: text.length, lines, tokens: knownOut });
        }
      }
    };

    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) {
          buffered += decoder.decode();
          break;
        }
        buffered += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
          handleLine(line);
        }
      }
      if (buffered.length > 0) {
        for (const line of buffered.split("\n")) handleLine(line);
      }
    } catch (streamError) {
      await reader.cancel().catch(() => undefined);
      if (attempt < 2 && isRetryableError(streamError, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw streamError;
    }

    const stopReason = mapGeminiStop(finishReason, blockReason, text);
    const usage = extractGeminiUsage(lastUsageMeta);
    return { text, stopReason, usage };
  }

  throw new Error(`${errorPrefix}.`);
}

type OpenAiPayload = {
  choices?: {
    message?: { content?: string | null };
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number;
  };
  error?: { message?: string };
};

function extractOpenAiUsage(u: OpenAiPayload["usage"]): ModelUsage {
  const prompt = u?.prompt_tokens ?? 0;
  const completion = u?.completion_tokens ?? 0;
  const cached = u?.prompt_tokens_details?.cached_tokens ?? u?.prompt_cache_hit_tokens ?? 0;
  return {
    input: Math.max(0, prompt - cached),
    output: completion,
    cacheRead: cached,
    cacheWrite: 0
  };
}

async function callOpenAiCompatible(
  call: ModelCall,
  route: Route,
  maxTokens: number,
  effort: Effort | undefined,
  effortIsExplicit: boolean
): Promise<{ text: string; stopReason: StopReason; usage: ModelUsage }> {
  if (!route.baseUrl) {
    throw new Error(`Step "${call.step}" uses openai-compatible provider without a base URL.`);
  }
  const request = call.request ?? fetch;
  const sleep = call.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY || "";
  const errorPrefix = call.errorPrefix ?? "OpenAI-compatible request failed";

  const baseSystemText =
    typeof call.system === "string" ? call.system : call.system.map((b) => b.text).join("\n\n");
  const systemText = call.schema
    ? `${baseSystemText}\n\nRespond with JSON matching this schema:\n${JSON.stringify(call.schema)}`
    : baseSystemText;

  const messages: Record<string, unknown>[] = [];
  if (systemText) {
    messages.push({ role: "system", content: systemText });
  }
  for (const msg of call.messages) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
    } else {
      messages.push({
        role: msg.role,
        content: msg.content.map((part) => {
          if (part.type === "text") return { type: "text", text: part.text };
          return {
            type: "image_url",
            image_url: { url: `data:${part.mime};base64,${part.base64}` }
          };
        })
      });
    }
  }

  const bodyObj: Record<string, unknown> = {
    model: route.model,
    max_tokens: maxTokens,
    messages,
    ...(call.schema ? { response_format: { type: "json_object" } } : {}),
    ...(effortIsExplicit && effort ? { reasoning_effort: effort } : {}),
    ...(call.stream ? { stream: true, stream_options: { include_usage: true } } : {})
  };

  const url = `${route.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const deadline = AbortSignal.timeout(call.timeoutMs ?? 60_000);
  const signal = call.signal ? AbortSignal.any([deadline, call.signal]) : deadline;

  let didCallOnStart = false;
  const notifyStart = () => {
    if (didCallOnStart) return;
    didCallOnStart = true;
    try {
      call.onStart?.();
    } catch {
      /* ignore */
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(bodyObj),
        signal
      });
    } catch (err) {
      if (attempt < 2 && isRetryableError(err, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw err;
    }

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as OpenAiPayload;
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      const msg = detail.error?.message ? scrubSecret(detail.error.message, apiKey) : "";
      throw new Error(
        `${errorPrefix} (${response.status})${call.includeErrorDetail && msg ? `: ${msg}` : "."}`
      );
    }

    if (!call.stream) {
      const payload = (await response.json()) as OpenAiPayload;
      const choice = payload.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (call.onText && text.length > 0) call.onText(text);
      const stopReason = mapOpenAiStop(choice?.finish_reason);
      const usage = extractOpenAiUsage(payload.usage);
      return { text, stopReason, usage };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/event-stream")) {
      const payload = (await response.json()) as OpenAiPayload;
      notifyStart();
      const choice = payload.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (call.onText && text.length > 0) call.onText(text);
      const usage = extractOpenAiUsage(payload.usage);
      let lines = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
      call.onProgress?.({ chars: text.length, lines, tokens: usage.output || Math.round(text.length / 3.5) });
      const stopReason = mapOpenAiStop(choice?.finish_reason);
      return { text, stopReason, usage };
    }

    if (!response.body) throw new Error(`${errorPrefix}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffered = "";
    let text = "";
    let lines = 0;
    let finishReason: string | null | undefined;
    let lastUsage: OpenAiPayload["usage"];

    const handleLine = (rawLine: string) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return;
      const chunk = JSON.parse(data) as OpenAiPayload;
      notifyStart();
      if (chunk.usage) lastUsage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        text += delta;
        for (let i = 0; i < delta.length; i++) {
          if (delta.charCodeAt(i) === 10) lines++;
        }
        call.onText?.(delta);
        const tokens = lastUsage?.completion_tokens ?? Math.round(text.length / 3.5);
        call.onProgress?.({ chars: text.length, lines, tokens });
      }
    };

    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) {
          buffered += decoder.decode();
          break;
        }
        buffered += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
          handleLine(line);
        }
      }
      if (buffered.length > 0) {
        for (const line of buffered.split("\n")) handleLine(line);
      }
    } catch (streamError) {
      await reader.cancel().catch(() => undefined);
      if (attempt < 2 && isRetryableError(streamError, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw streamError;
    }

    const stopReason = mapOpenAiStop(finishReason);
    const usage = extractOpenAiUsage(lastUsage);
    return { text, stopReason, usage };
  }

  throw new Error(`${errorPrefix}.`);
}

export async function callModel(call: ModelCall): Promise<ModelResult> {
  const started = Date.now();
  const route = call.route ?? routeFor(call.step);
  const { maxTokens, effort, effortIsExplicit } = resolveCallParameters(call, route);

  let outcome: { text: string; stopReason: StopReason; usage: ModelUsage };
  if (route.provider === "anthropic") {
    outcome = await callAnthropic(call, route, maxTokens, effort);
  } else if (route.provider === "gemini") {
    outcome = await callGemini(call, route, maxTokens, effort);
  } else {
    outcome = await callOpenAiCompatible(call, route, maxTokens, effort, effortIsExplicit);
  }

  const ms = Date.now() - started;
  const usd = usdFor(route.model, outcome.usage);
  const logger = call.log ?? console.info;
  logger(
    JSON.stringify({
      event: "model_usage",
      step: call.step,
      provider: route.provider,
      model: route.model,
      input: outcome.usage.input,
      output: outcome.usage.output,
      cache_read: outcome.usage.cacheRead,
      cache_write: outcome.usage.cacheWrite,
      usd,
      ms,
      stop: outcome.stopReason
    })
  );

  const stopError = call.stopErrors?.[outcome.stopReason];
  if (stopError) {
    throw new Error(stopError);
  }

  return {
    text: outcome.text,
    stopReason: outcome.stopReason,
    usage: outcome.usage,
    provider: route.provider,
    model: route.model,
    usd,
    ms,
    route
  };
}

export async function* streamModel(call: ModelCall): AsyncGenerator<string> {
  const queue: string[] = [];
  let done = false;
  let error: unknown = null;
  let wake: (() => void) | null = null;

  const notify = () => {
    if (wake) {
      const fn = wake;
      wake = null;
      fn();
    }
  };

  const runPromise = callModel({
    ...call,
    stream: true,
    onText: (chunk) => {
      call.onText?.(chunk);
      queue.push(chunk);
      notify();
    }
  }).then(
    () => {
      done = true;
      notify();
    },
    (err) => {
      error = err;
      done = true;
      notify();
    }
  );

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) {
        if (error !== null) throw error;
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    await runPromise.catch(() => undefined);
  }
}
