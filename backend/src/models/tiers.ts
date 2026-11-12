/**
 * Model policy per animation-quality tier.
 *
 *   Standard: ONLY `gemini:gemini-3.8-flash` and `anthropic:claude-haiku-5-5`.
 *   Premium:  ONLY `anthropic:claude-opus-5-5` (plus the two Gemini-only helpers below, which cannot run on Claude).
 *
 * `routeFor(step, env, tier)` resolves the model from this table unless a `MODEL_<ENV>` override is set, so no step on
 * either tier can silently fall back to a code default such as `claude-sonnet-4-6`, to `ANTHROPIC_MODEL`, or to a
 * tier-blind `MODEL_DEFAULT`. Steps that run before a tier is chosen (script, storyboard, frames) resolve as Standard.
 *
 * Env overrides, highest first: `MODEL_<ENV>_<TIER>` (e.g. `MODEL_MOTION_PREMIUM`) > `MODEL_<ENV>` > parent step's
 * `MODEL_<PARENT>_<TIER>` / `MODEL_<PARENT>` > this table.
 */
import type { StepId } from "./steps.ts";

export type ModelTier = "standard" | "premium";
export const MODEL_TIERS: readonly ModelTier[] = ["standard", "premium"];

export const GEMINI_FLASH = "gemini:gemini-3.8-flash";
export const HAIKU = "anthropic:claude-haiku-5-5";
export const OPUS = "anthropic:claude-opus-5-5";

/** Models each tier may ever resolve to (provider:model). */
export const ALLOWED_MODELS: Record<ModelTier, readonly string[]> = {
  standard: [GEMINI_FLASH, HAIKU],
  // voiceAlign (audio in) and siteRead (url_context) only exist on Gemini, so Premium keeps Flash for those two.
  premium: [OPUS, GEMINI_FLASH]
};

/** Steps that only run on Gemini (audio input / url_context) and therefore keep Flash on Premium. */
export const GEMINI_ONLY_STEPS: readonly StepId[] = ["voiceAlign", "siteRead"];

export const TIER_MODELS: Record<ModelTier, Record<StepId, string>> = {
  standard: {
    script: GEMINI_FLASH,
    scriptWrite: GEMINI_FLASH,
    sceneInsert: GEMINI_FLASH,
    director: GEMINI_FLASH,
    frameSketch: GEMINI_FLASH,
    motion: GEMINI_FLASH,
    screenshot: GEMINI_FLASH,
    voiceAlign: GEMINI_FLASH,
    sceneWriter: GEMINI_FLASH,
    sceneRepair: GEMINI_FLASH,
    rewriteBeat: GEMINI_FLASH,
    siteRead: GEMINI_FLASH,
    // Claude-by-design or schema / tool-use steps where Claude quality matters but the calls are small: Haiku 5.5.
    formatFill: HAIKU,
    proAssistant: HAIKU,
    skillRouting: HAIKU,
    elementEdits: HAIKU,
    planner: HAIKU
  },
  premium: {
    script: OPUS,
    scriptWrite: OPUS,
    sceneInsert: OPUS,
    director: OPUS,
    frameSketch: OPUS,
    motion: OPUS,
    screenshot: OPUS,
    voiceAlign: GEMINI_FLASH,
    sceneWriter: OPUS,
    sceneRepair: OPUS,
    formatFill: OPUS,
    proAssistant: OPUS,
    skillRouting: OPUS,
    rewriteBeat: OPUS,
    elementEdits: OPUS,
    planner: OPUS,
    siteRead: GEMINI_FLASH
  }
};

export function isModelTier(value: unknown): value is ModelTier {
  return value === "standard" || value === "premium";
}

/** Per-step allowance: Premium is Opus-only except for the Gemini-only helpers. */
export function isAllowedModel(tier: ModelTier, provider: string, model: string, step?: StepId): boolean {
  const spec = `${provider}:${model}`;
  if (tier === "premium" && step && !GEMINI_ONLY_STEPS.includes(step)) return spec === OPUS;
  return ALLOWED_MODELS[tier].includes(spec);
}

/** Step-specific legacy env vars that are tier-blind and therefore no longer consulted by `routeFor`. */
export const IGNORED_LEGACY_VARS = [
  "MODEL_DEFAULT",
  "ANTHROPIC_MODEL",
  "SCRIPT_PROVIDER",
  "SCRIPT_MODEL",
  "DIRECTOR_PROVIDER",
  "DIRECTOR_MODEL",
  "FRAME_MODEL",
  "MOTION_MODEL",
  "SCREENSHOT_MODEL",
  "PLATE_MODEL",
  "ANTHROPIC_ROUTING_MODEL"
] as const;
