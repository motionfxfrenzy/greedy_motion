/**
 * Per-step model routing from environment variables.
 *
 * Env format:
 * - `MODEL_<ENV>=provider:model`, e.g. `MODEL_SCENE_WRITER=gemini:gemini-3.8-flash`,
 *   `MODEL_SCRIPT=anthropic:claude-opus-5-5`.
 *   A bare model with no provider prefix is inferred when it begins with `claude-` (anthropic)
 *   or `gemini-` (gemini); any other bare value is an error.
 *   Accepted provider prefixes: `anthropic`, `gemini`, `openai-compatible` (alias `openai`).
 * - `EFFORT_<ENV>` (`low` | `medium` | `high` | `xhigh` | `max`)
 * - `MAX_TOKENS_<ENV>` (positive integer)
 * - `BASE_URL_<ENV>` (`openai-compatible` only; required unless `OPENAI_COMPATIBLE_BASE_URL` is set)
 * - `MODEL_DEFAULT=provider:model` applies to every step with `anyProvider: true` that has no
 *   higher-precedence setting.
 *
 * Precedence for provider + model (highest first):
 *   1. `MODEL_<ENV>_<TIER>` (`_STANDARD` / `_PREMIUM`), then `MODEL_<ENV>`
 *   2. parent's `MODEL_<PARENT_ENV>_<TIER>`, then `MODEL_<PARENT_ENV>`
 *   3. the per-tier table in `tiers.ts` (Standard: Gemini Flash / Haiku 5.5; Premium: Opus 5.5)
 * `MODEL_DEFAULT`, `ANTHROPIC_MODEL` and the old per-step vars (`SCRIPT_MODEL`, `PLATE_MODEL`, ...) are tier-blind and no
 * longer consulted for `anyProvider` steps; Gemini-only steps still honour `VOICE_ALIGN_MODEL` / `SITE_READ_MODEL`.
 * `tier` defaults to `"standard"`, which is also what steps that run before a tier is chosen use.
 *
 * Precedence for `EFFORT` and `MAX_TOKENS`:
 *   own env (`EFFORT_<ENV>` / `MAX_TOKENS_<ENV>`) > parent env > step default.
 *   If the resolved provider differs from the step's default provider, the step-default effort
 *   is dropped unless effort was explicitly set via `EFFORT_<ENV>` or `EFFORT_<PARENT_ENV>`.
 */
import { STEPS, type Effort, type Provider, type StepDef, type StepId } from "./steps.ts";
import { IGNORED_LEGACY_VARS, TIER_MODELS, isAllowedModel, type ModelTier } from "./tiers.ts";

export type { Effort, Provider, StepId };

export type Route = {
  step: StepId;
  provider: Provider;
  model: string;
  effort?: Effort;
  maxTokens: number;
  baseUrl?: string;
  /** True when the route came from an env var rather than the hardcoded default. */
  explicit: boolean;
};

const VALID_EFFORTS = new Set<Effort>(["low", "medium", "high", "xhigh", "max"]);
const KNOWN_STEP_ENVS = new Set<string>(Object.values(STEPS).map((s) => s.env));

/** Internal metadata tracked per resolved route so providers.ts can distinguish explicit env effort/maxTokens from step defaults. */
const ROUTE_META = new WeakMap<Route, { explicitEffort: boolean; explicitMaxTokens: boolean }>();

export function getRouteMeta(route: Route): { explicitEffort: boolean; explicitMaxTokens: boolean } | undefined {
  return ROUTE_META.get(route);
}

export function parseModelSpec(raw: string, envVarName: string): { provider: Provider; model: string } {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(":");
  if (colon >= 0) {
    const rawProvider = trimmed.slice(0, colon).trim().toLowerCase();
    const model = trimmed.slice(colon + 1).trim();
    let provider: Provider;
    if (rawProvider === "anthropic") provider = "anthropic";
    else if (rawProvider === "gemini") provider = "gemini";
    else if (rawProvider === "openai-compatible" || rawProvider === "openai") provider = "openai-compatible";
    else throw new Error(`${envVarName}: unknown provider "${rawProvider}" in "${raw}" (expected anthropic, gemini, or openai-compatible).`);
    if (!model) throw new Error(`${envVarName}: missing model id in "${raw}".`);
    return { provider, model };
  }
  if (trimmed === "anthropic" || trimmed === "gemini" || trimmed === "openai-compatible" || trimmed === "openai") {
    throw new Error(`${envVarName}: missing model id in "${raw}".`);
  }
  if (trimmed.startsWith("claude-")) return { provider: "anthropic", model: trimmed };
  if (trimmed.startsWith("gemini-")) return { provider: "gemini", model: trimmed };
  throw new Error(`${envVarName}: cannot infer provider for bare model "${trimmed}" (use provider:model, e.g. anthropic:${trimmed}).`);
}

function parseEffort(raw: string, envVarName: string): Effort {
  const val = raw.trim().toLowerCase() as Effort;
  if (!VALID_EFFORTS.has(val)) {
    throw new Error(`${envVarName}: invalid effort "${raw}" (expected low, medium, high, xhigh, or max).`);
  }
  return val;
}

function parseMaxTokens(raw: string, envVarName: string): number {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`${envVarName}: must be a positive integer, got "${raw}".`);
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${envVarName}: must be a positive integer, got "${raw}".`);
  }
  return n;
}

function hasStepLegacyEnv(stepDef: StepDef, env: NodeJS.ProcessEnv): boolean {
  for (const name of stepDef.legacyVars ?? []) {
    if (env[name]?.trim()) return true;
  }
  return false;
}

function defaultProviderOf(stepDef: StepDef): Provider {
  return stepDef.legacy({}).provider;
}

export function routeFor(step: StepId, env: NodeJS.ProcessEnv = process.env, tier: ModelTier = "standard"): Route {
  const stepDef = STEPS[step];
  if (!stepDef) throw new Error(`Unknown step "${String(step)}".`);
  const parentDef = stepDef.parent ? STEPS[stepDef.parent] : undefined;

  let provider: Provider;
  let model: string;
  let explicitModel = false;

  const TIER = tier.toUpperCase();
  const ownModelEnv = env[`MODEL_${stepDef.env}_${TIER}`]?.trim() || env[`MODEL_${stepDef.env}`]?.trim();
  const parentModelEnv = parentDef ? env[`MODEL_${parentDef.env}_${TIER}`]?.trim() || env[`MODEL_${parentDef.env}`]?.trim() : undefined;

  if (ownModelEnv) {
    ({ provider, model } = parseModelSpec(ownModelEnv, `MODEL_${stepDef.env}`));
    explicitModel = true;
  } else if (parentModelEnv && parentDef) {
    ({ provider, model } = parseModelSpec(parentModelEnv, `MODEL_${parentDef.env}`));
    explicitModel = true;
  } else if (!stepDef.anyProvider) {
    // Gemini-only helpers (voice alignment, URL reader): their own legacy var, else Flash.
    ({ provider, model } = stepDef.legacy(env));
  } else {
    // Tier policy (see tiers.ts). The tier-blind legacy vars (MODEL_DEFAULT, ANTHROPIC_MODEL, PLATE_MODEL, ...) are not consulted.
    ({ provider, model } = parseModelSpec(TIER_MODELS[tier][step], `TIER_MODELS.${tier}.${step}`));
    explicitModel = true;
  }

  // EFFORT resolution: own env > parent env > step default (only when provider matches step default provider).
  let effort: Effort | undefined;
  let explicitEffort = false;
  const ownEffortEnv = env[`EFFORT_${stepDef.env}`]?.trim();
  const parentEffortEnv = parentDef ? env[`EFFORT_${parentDef.env}`]?.trim() : undefined;
  if (ownEffortEnv) {
    effort = parseEffort(ownEffortEnv, `EFFORT_${stepDef.env}`);
    explicitEffort = true;
  } else if (parentEffortEnv && parentDef) {
    effort = parseEffort(parentEffortEnv, `EFFORT_${parentDef.env}`);
    explicitEffort = true;
  } else if (stepDef.effort && provider === defaultProviderOf(stepDef)) {
    effort = stepDef.effort;
  }

  // MAX_TOKENS resolution: own env > parent env > step default.
  let maxTokens = stepDef.maxTokens;
  let explicitMaxTokens = false;
  const ownMaxEnv = env[`MAX_TOKENS_${stepDef.env}`]?.trim();
  const parentMaxEnv = parentDef ? env[`MAX_TOKENS_${parentDef.env}`]?.trim() : undefined;
  if (ownMaxEnv) {
    maxTokens = parseMaxTokens(ownMaxEnv, `MAX_TOKENS_${stepDef.env}`);
    explicitMaxTokens = true;
  } else if (parentMaxEnv && parentDef) {
    maxTokens = parseMaxTokens(parentMaxEnv, `MAX_TOKENS_${parentDef.env}`);
    explicitMaxTokens = true;
  }

  // BASE_URL resolution (openai-compatible only).
  let baseUrl: string | undefined;
  if (provider === "openai-compatible") {
    const rawBase =
      env[`BASE_URL_${stepDef.env}`]?.trim() ||
      (parentDef ? env[`BASE_URL_${parentDef.env}`]?.trim() : "") ||
      env.OPENAI_COMPATIBLE_BASE_URL?.trim() ||
      "";
    if (rawBase) baseUrl = rawBase.replace(/\/+$/, "");
  }

  const route: Route = {
    step,
    provider,
    model,
    ...(effort !== undefined ? { effort } : {}),
    maxTokens,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    explicit: explicitModel || explicitEffort || explicitMaxTokens
  };
  ROUTE_META.set(route, { explicitEffort, explicitMaxTokens });
  return route;
}

export function allRoutes(env: NodeJS.ProcessEnv = process.env): Record<StepId, Route> & Iterable<Route> {
  const record = {} as Record<StepId, Route>;
  for (const id of Object.keys(STEPS) as StepId[]) {
    record[id] = routeFor(id, env);
  }
  Object.defineProperty(record, Symbol.iterator, {
    value: () => Object.values(record)[Symbol.iterator](),
    enumerable: false
  });
  return record as Record<StepId, Route> & Iterable<Route>;
}

export function routeWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    if (key.startsWith("MODEL_")) {
      if (key === "MODEL_DEFAULT" || key.startsWith("MODEL_PRICE_")) continue;
      const suffix = key.slice("MODEL_".length).replace(/_(STANDARD|PREMIUM)$/, "");
      if (!KNOWN_STEP_ENVS.has(suffix)) {
        warnings.push(`Unknown model routing env "${key}" (not a known step MODEL_<ENV>).`);
      }
    }
  }
  for (const name of IGNORED_LEGACY_VARS) {
    if (env[name]?.trim()) warnings.push(`${name} is set but ignored: models are chosen per tier (see models/tiers.ts); use MODEL_<STEP>_STANDARD / MODEL_<STEP>_PREMIUM to override.`);
  }
  for (const tier of ["standard", "premium"] as const) {
    for (const stepDef of Object.values(STEPS)) {
      try {
        const r = routeFor(stepDef.id, env, tier);
        if (!isAllowedModel(tier, r.provider, r.model, stepDef.id)) warnings.push(`Step "${stepDef.id}" on ${tier} resolves to ${r.provider}:${r.model}, outside the ${tier} model policy.`);
      } catch { /* syntax errors are reported by validateRoutes */ }
    }
  }
  return warnings;
}

export function validateRoutes(
  env: NodeJS.ProcessEnv = process.env,
  keys?: { anthropic?: string; gemini?: string; openaiCompatible?: string }
): void {
  const problems: string[] = [];

  // 1. Validate MODEL_DEFAULT if present.
  const defaultRaw = env.MODEL_DEFAULT?.trim();
  if (defaultRaw) {
    try {
      parseModelSpec(defaultRaw, "MODEL_DEFAULT");
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Validate per-step env vars and collect resolved routes.
  const resolved = new Map<StepId, Route>();
  for (const stepDef of Object.values(STEPS)) {
    const modelRaw = env[`MODEL_${stepDef.env}`]?.trim();
    if (modelRaw) {
      try {
        parseModelSpec(modelRaw, `MODEL_${stepDef.env}`);
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }
    const effortRaw = env[`EFFORT_${stepDef.env}`]?.trim();
    if (effortRaw) {
      try {
        parseEffort(effortRaw, `EFFORT_${stepDef.env}`);
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }
    const maxRaw = env[`MAX_TOKENS_${stepDef.env}`]?.trim();
    if (maxRaw) {
      try {
        parseMaxTokens(maxRaw, `MAX_TOKENS_${stepDef.env}`);
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }

    try {
      const route = routeFor(stepDef.id, env);
      resolved.set(stepDef.id, route);
      if (!stepDef.anyProvider) {
        const requiredProvider = defaultProviderOf(stepDef);
        if (route.provider !== requiredProvider) {
          problems.push(
            `Step "${stepDef.id}" (MODEL_${stepDef.env}) requires provider "${requiredProvider}", got "${route.provider}".`
          );
        }
      }
      if (route.provider === "openai-compatible" && !route.baseUrl) {
        problems.push(
          `Step "${stepDef.id}" uses provider "openai-compatible" but neither BASE_URL_${stepDef.env} nor OPENAI_COMPATIBLE_BASE_URL is set.`
        );
      }
    } catch {
      // Syntax errors on MODEL_*/EFFORT_*/MAX_TOKENS_* were already recorded above.
    }
  }

  // 3. Check API keys for each provider used by any resolved route
  //    (anyProvider:false steps are exempt when unrouted so optional helpers don't block single-key setups).
  const anthropicKey = (keys?.anthropic ?? env.ANTHROPIC_API_KEY ?? "").trim();
  const geminiKey = (keys?.gemini ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim();
  const openaiKey = (keys?.openaiCompatible ?? env.OPENAI_COMPATIBLE_API_KEY ?? "").trim();

  const stepsByProvider: Record<Provider, StepId[]> = {
    anthropic: [],
    gemini: [],
    "openai-compatible": []
  };
  for (const [stepId, route] of resolved.entries()) {
    if (!STEPS[stepId].anyProvider && !route.explicit) continue;
    stepsByProvider[route.provider].push(stepId);
  }

  if (stepsByProvider.anthropic.length > 0 && !anthropicKey) {
    problems.push(`Missing ANTHROPIC_API_KEY for anthropic routes (${stepsByProvider.anthropic.join(", ")}).`);
  }
  if (stepsByProvider.gemini.length > 0 && !geminiKey) {
    problems.push(`Missing GEMINI_API_KEY for gemini routes (${stepsByProvider.gemini.join(", ")}).`);
  }
  if (stepsByProvider["openai-compatible"].length > 0 && !openaiKey) {
    problems.push(
      `Missing OPENAI_COMPATIBLE_API_KEY for openai-compatible routes (${stepsByProvider["openai-compatible"].join(", ")}).`
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid model routing configuration:\n- ${problems.join("\n- ")}`);
  }
}

/** True when the key for this step's resolved provider is present (a step that cannot run is skipped, as a missing Anthropic key was before). */
export function routeHasKey(step: StepId, env: NodeJS.ProcessEnv = process.env): boolean {
  const { provider } = routeFor(step, env);
  if (provider === "anthropic") return Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (provider === "gemini") return Boolean((env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "").trim());
  return Boolean(env.OPENAI_COMPATIBLE_API_KEY?.trim());
}
