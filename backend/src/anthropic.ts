import { config } from "./config.ts";

export type AnthropicResponse = {
  content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};
type Options = {
  request?: typeof fetch;
  timeoutMs?: number;
  errorPrefix: string;
  includeErrorDetail?: boolean;
  stopErrors?: Partial<Record<string, string>>;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Cancels the request (and its retries) from outside, e.g. when the user cancels script generation. */
  signal?: AbortSignal;
};
export const responseText = (payload: AnthropicResponse) => payload.content?.filter(b => b.type === "text").map(b => b.text ?? "").join("") ?? "";

export type StreamProgress = { chars: number; lines: number; tokens: number };
export type StreamOptions = Options & { onProgress?: (p: StreamProgress) => void; onStart?: () => void };

const isRetryableStreamError = (err: unknown, signal: AbortSignal): boolean => {
  if (signal.aborted) return false;
  if (!err || typeof err !== "object") return false;
  if ((err as { retryableStreamDrop?: boolean }).retryableStreamDrop) return true;
  const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code ?? "";
  if (/^(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/i.test(code)) return true;
  const msg = `${(err as Error).message ?? ""} ${((err as { cause?: Error }).cause?.message) ?? ""}`;
  return /\b(EPIPE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_|fetch failed|socket hang up|terminated|premature close|unexpected end of file|stream dropped)\b/i.test(msg);
};

/** HTTP retries are separate from callers' content-validation repairs. Never log prompts or credentials. */
export async function anthropicMessage(body: Record<string, unknown>, options: Options): Promise<AnthropicResponse> {
  const request = options.request ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const model = body.model ?? config.anthropicModel;
  // One deadline for the whole operation, including retries.
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await request(`${config.anthropicBaseUrl}/v1/messages`, {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ ...body, model }), signal
      });
    } catch (error) {
      if (attempt < 2 && isRetryableStreamError(error, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
        await sleep(Math.max(0, Math.min(10_000, Number.isFinite(delay) ? delay : 500 * 2 ** attempt)));
        continue;
      }
      throw new Error(`${options.errorPrefix} (${response.status})${options.includeErrorDetail && detail.error?.message ? `: ${detail.error.message}` : "."}`);
    }
    const payload = await response.json() as AnthropicResponse;
    const u = payload.usage;
    (options.log ?? console.info)(JSON.stringify({ event: "anthropic_usage", model, input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cache_read: u?.cache_read_input_tokens ?? 0, cache_creation: u?.cache_creation_input_tokens ?? 0 }));
    const stopError = options.stopErrors?.[payload.stop_reason ?? ""];
    if (stopError) throw new Error(stopError);
    return payload;
  }
  throw new Error(`${options.errorPrefix}.`);
}

/** Streaming variant of `anthropicMessage` (`stream: true` SSE). Concatenates `text_delta`s in order and reports unthrottled progress. */
export async function anthropicStream(body: Record<string, unknown>, options: StreamOptions): Promise<AnthropicResponse> {
  const request = options.request ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const model = body.model ?? config.anthropicModel;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  let didCallOnStart = false;
  const notifyStart = () => {
    if (didCallOnStart) return;
    didCallOnStart = true;
    try { options.onStart?.(); } catch { /* ignore */ }
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await request(`${config.anthropicBaseUrl}/v1/messages`, {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ ...body, model, stream: true }), signal
      });
    } catch (error) {
      if (attempt < 2 && isRetryableStreamError(error, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
        await sleep(Math.max(0, Math.min(10_000, Number.isFinite(delay) ? delay : 500 * 2 ** attempt)));
        continue;
      }
      throw new Error(`${options.errorPrefix} (${response.status})${options.includeErrorDetail && detail.error?.message ? `: ${detail.error.message}` : "."}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/event-stream")) {
      const payload = await response.json() as AnthropicResponse;
      const fullText = responseText(payload);
      let lines = 0;
      for (let i = 0; i < fullText.length; i++) {
        if (fullText.charCodeAt(i) === 10) lines++;
      }
      const chars = fullText.length;
      const u = payload.usage;
      const tokens = typeof u?.output_tokens === "number" ? u.output_tokens : Math.round(chars / 3.5);
      options.onProgress?.({ chars, lines, tokens });
      (options.log ?? console.info)(JSON.stringify({ event: "anthropic_usage", model, input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cache_read: u?.cache_read_input_tokens ?? 0, cache_creation: u?.cache_creation_input_tokens ?? 0 }));
      const stopError = options.stopErrors?.[payload.stop_reason ?? ""];
      if (stopError) throw new Error(stopError);
      notifyStart();
      return payload;
    }
    if (!response.body) throw new Error(`${options.errorPrefix}.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffered = "";
    let eventType = "";
    let text = "";
    let lines = 0;
    let stop_reason: string | undefined;
    let sawMessageStop = false;
    let knownOutputTokens: number | undefined;
    const usage: NonNullable<AnthropicResponse["usage"]> = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    };

    const handleLine = (rawLine: string) => {
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
      const ev = JSON.parse(data) as {
        type?: string;
        message?: { stop_reason?: string | null; usage?: AnthropicResponse["usage"] };
        delta?: { type?: string; text?: string; stop_reason?: string | null };
        usage?: AnthropicResponse["usage"];
        stop_reason?: string | null;
        error?: { type?: string; message?: string };
      };
      const type = ev.type ?? eventType;
      if (type === "error") {
        const msg = ev.error?.message;
        const errType = ev.error?.type ?? "";
        const retryable = /^(overloaded_error|api_error|rate_limit_error|timeout_error)$/i.test(errType);
        throw Object.assign(new Error(`${options.errorPrefix}${msg ? `: ${msg}` : "."}`), { retryableStreamDrop: retryable });
      }
      if (type === "message_stop") {
        sawMessageStop = true;
        return;
      }
      if (type === "message_start") {
        notifyStart();
        const u = ev.message?.usage ?? ev.usage;
        if (u) {
          if (typeof u.input_tokens === "number") usage.input_tokens = u.input_tokens;
          if (typeof u.output_tokens === "number") usage.output_tokens = u.output_tokens;
          if (typeof u.cache_read_input_tokens === "number") usage.cache_read_input_tokens = u.cache_read_input_tokens;
          if (typeof u.cache_creation_input_tokens === "number") usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
        }
        if (typeof ev.message?.stop_reason === "string") stop_reason = ev.message.stop_reason;
        return;
      }
      if (type === "content_block_delta") {
        if (typeof ev.usage?.output_tokens === "number") {
          knownOutputTokens = ev.usage.output_tokens;
          usage.output_tokens = ev.usage.output_tokens;
        }
        if ((ev.delta?.type === "text_delta" || ev.delta?.type === undefined) && typeof ev.delta?.text === "string" && ev.delta.text.length > 0) {
          const chunk = ev.delta.text;
          text += chunk;
          for (let i = 0; i < chunk.length; i++) {
            if (chunk.charCodeAt(i) === 10) lines++;
          }
          const chars = text.length;
          const tokens = knownOutputTokens !== undefined ? knownOutputTokens : Math.round(chars / 3.5);
          options.onProgress?.({ chars, lines, tokens });
        }
        return;
      }
      if (type === "message_delta") {
        const sr = ev.delta?.stop_reason ?? ev.stop_reason;
        if (typeof sr === "string") stop_reason = sr;
        if (typeof ev.usage?.output_tokens === "number") {
          knownOutputTokens = ev.usage.output_tokens;
          usage.output_tokens = ev.usage.output_tokens;
        }
        if (typeof ev.usage?.input_tokens === "number") usage.input_tokens = ev.usage.input_tokens;
        if (typeof ev.usage?.cache_read_input_tokens === "number") usage.cache_read_input_tokens = ev.usage.cache_read_input_tokens;
        if (typeof ev.usage?.cache_creation_input_tokens === "number") usage.cache_creation_input_tokens = ev.usage.cache_creation_input_tokens;
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
      if (!sawMessageStop && (stop_reason === undefined || text.length === 0)) {
        throw Object.assign(
          new Error(
            text.length > 0
              ? `${options.errorPrefix}: stream dropped after partial output (${text.length} chars).`
              : `${options.errorPrefix}: stream ended without a message.`
          ),
          { retryableStreamDrop: true }
        );
      }
    } catch (streamError) {
      await reader.cancel().catch(() => undefined);
      if (attempt < 2 && isRetryableStreamError(streamError, signal)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw streamError;
    }

    const payload: AnthropicResponse = {
      content: [{ type: "text", text }],
      ...(stop_reason !== undefined ? { stop_reason } : {}),
      usage
    };
    (options.log ?? console.info)(JSON.stringify({ event: "anthropic_usage", model, input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cache_read: usage.cache_read_input_tokens ?? 0, cache_creation: usage.cache_creation_input_tokens ?? 0 }));
    const stopError = options.stopErrors?.[payload.stop_reason ?? ""];
    if (stopError) throw new Error(stopError);
    return payload;
  }
  throw new Error(`${options.errorPrefix}.`);
}
