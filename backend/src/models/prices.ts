import type { Provider } from "./steps.ts";

export type ModelPrice = {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
};

export type UsageCounts = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/**
 * USD per 1M tokens.
 * Note: input in UsageCounts EXCLUDES cached tokens (cacheRead / cacheWrite are billed at their own rates).
 */
export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // cache write/read assumed
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-4-6": { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // paid tier through 2026-12-31, doubles 2027-01-01
  "gemini-3.8-flash": { in: 0.75, out: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  // through 2026-11-30, doubles 2026-12-01
  "gemini-4-argon": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 0 },
  // no price change listed
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  // verify against provider page
  "gemini-3.1-pro-preview": { in: 2, out: 12, cacheRead: 0.2, cacheWrite: 0 }
};

/** Maximum output tokens per model (falls back to provider default in maxOutputFor). */
export const MAX_OUTPUT: Record<string, number> = {
  "claude-opus-5-5": 128000,
  "claude-sonnet-5-5": 128000,
  "claude-haiku-5-5": 128000,
  "claude-sonnet-4-6": 128000,
  "claude-haiku-4-5-20251001": 128000,
  "gemini-3.8-flash": 65536,
  "gemini-4-argon": 65536,
  "gemini-3.5-flash-lite": 65536,
  "gemini-2.5-flash": 65536,
  "gemini-3.1-pro-preview": 65536
};

/** Output cap of a non-streamed response where it is lower than the streamed one (Argon: 32,768 vs 65,536). */
export const MAX_OUTPUT_NON_STREAMED: Record<string, number> = { "gemini-4-argon": 32768 };

/** Announced price changes: from this date (UTC, inclusive) the model costs the new price. The latest applicable one wins. */
export const PRICE_CHANGES: Record<string, { from: string; price: ModelPrice }[]> = {
  "gemini-4-argon": [{ from: "2026-12-01", price: { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 0 } }],
  "gemini-3.8-flash": [{ from: "2027-01-01", price: { in: 1.5, out: 7.5, cacheRead: 0.15, cacheWrite: 0 } }]
};

export function priceAt(model: string, now: Date = new Date()): ModelPrice | undefined {
  const base = PRICES[model];
  if (!base) return undefined;
  const day = now.toISOString().slice(0, 10);
  let current = base;
  for (const change of [...(PRICE_CHANGES[model] ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (day >= change.from) current = change.price;
  return current;
}

export function registerPrice(model: string, price: ModelPrice): void {
  PRICES[model] = { ...price };
}

export function sanitiseModelEnvName(model: string): string {
  return model.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function priceFromEnv(model: string, env: NodeJS.ProcessEnv = process.env): ModelPrice | null {
  const key = `MODEL_PRICE_${sanitiseModelEnvName(model)}`;
  const raw = env[key]?.trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length < 2 || parts.length > 4 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || parts[0]! < 0 || parts[1]! < 0) {
    return null;
  }
  const cacheRead = parts.length >= 3 && Number.isFinite(parts[2]) && parts[2]! >= 0 ? parts[2]! : 0;
  const cacheWrite = parts.length >= 4 && Number.isFinite(parts[3]) && parts[3]! >= 0 ? parts[3]! : 0;
  return { in: parts[0]!, out: parts[1]!, cacheRead, cacheWrite };
}

/**
 * Returns USD cost for the given model and token usage, or null when the model is unknown
 * (never guessed; logged as usd: null).
 */
export function usdFor(model: string, usage: UsageCounts, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): number | null {
  const price = priceAt(model, now) ?? priceFromEnv(model, env);
  if (!price) return null;
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const raw = (input * price.in + output * price.out + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) / 1_000_000;
  return Number(raw.toFixed(10));
}

export function maxOutputFor(provider: Provider, model?: string, stream = true): number {
  if (!stream && model && MAX_OUTPUT_NON_STREAMED[model] !== undefined) return MAX_OUTPUT_NON_STREAMED[model]!;
  if (model && MAX_OUTPUT[model] !== undefined) return MAX_OUTPUT[model]!;
  if (provider === "anthropic") return 128000;
  if (provider === "gemini") return 65536;
  return 32000;
}
