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
};
export const responseText = (payload: AnthropicResponse) => payload.content?.filter(b => b.type === "text").map(b => b.text ?? "").join("") ?? "";

/** HTTP retries are separate from callers' content-validation repairs. Never log prompts or credentials. */
export async function anthropicMessage(body: Record<string, unknown>, options: Options): Promise<AnthropicResponse> {
  const request = options.request ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const model = body.model ?? config.anthropicModel;
  // One deadline for the whole operation, including retries.
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const response = await request("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ ...body, model }), signal
    });
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
