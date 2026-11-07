/**
 * Authoritative Draft Preview playback profile, per-style policy integration, and tunable geometry budget (`draftTargetVerticesPerFrame`).
 *
 * Changing `DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME` here (or calling `setDraftTargetVerticesPerFrame(value)` at
 * runtime / in tests) updates the default draft geometry budget for unlisted styles everywhere in the frontend player,
 * worker host, cache keys, and scene calibration, while listed styles follow `DRAFT_STYLE_POLICY_TABLE` unless
 * overridden by `NEXT_PUBLIC_DRAFT_TARGET_FORCE` / `setDraftTargetForceOverride` or disabled via `NEXT_PUBLIC_DRAFT_STYLE_POLICY=off`.
 */

import {
  DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME,
  DRAFT_PROFILE_VERSION,
  MAX_DRAFT_TARGET_VERTICES_PER_FRAME,
  MIN_DRAFT_TARGET_VERTICES_PER_FRAME,
  deriveDraftDetailScale,
  resolveDraftTargetVerticesFromEnv,
  validateDraftTargetVerticesPerFrame,
  type BudgetPolicyMode,
  type PenRetraceMode
} from "../../../packages/plate-engine/src/canvas-core/core.ts";
import {
  DRAFT_STYLE_ID_TO_LOOK_ID,
  DRAFT_STYLE_POLICY_TABLE,
  getDraftTargetForceOverride,
  isDraftStylePolicyEnabled,
  normalizeListedDraftLook,
  onDraftStylePolicyChange,
  readEnvDraftStylePolicyRaw,
  readEnvDraftTargetForceRaw,
  resetDraftStylePolicy,
  resetDraftTargetForceOverride,
  resolveDraftStylePolicyEnabledFromEnv,
  resolveDraftStylePolicyEntry,
  resolveDraftTargetForceFromEnv,
  setDraftStylePolicyEnabled,
  setDraftTargetForceOverride,
  validateDraftStylePolicyEntry,
  validateDraftStylePolicyTable,
  type DraftStylePolicyEntry,
  type ListedDraftLookId,
  type ListedDraftStyleId
} from "./draft-style-policy.ts";

export {
  DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME,
  DRAFT_PROFILE_VERSION,
  DRAFT_STYLE_ID_TO_LOOK_ID,
  DRAFT_STYLE_POLICY_TABLE,
  MAX_DRAFT_TARGET_VERTICES_PER_FRAME,
  MIN_DRAFT_TARGET_VERTICES_PER_FRAME,
  deriveDraftDetailScale,
  getDraftTargetForceOverride,
  isDraftStylePolicyEnabled,
  normalizeListedDraftLook,
  onDraftStylePolicyChange,
  readEnvDraftStylePolicyRaw,
  readEnvDraftTargetForceRaw,
  resetDraftStylePolicy,
  resetDraftTargetForceOverride,
  resolveDraftStylePolicyEnabledFromEnv,
  resolveDraftStylePolicyEntry,
  resolveDraftTargetForceFromEnv,
  resolveDraftTargetVerticesFromEnv,
  setDraftStylePolicyEnabled,
  setDraftTargetForceOverride,
  validateDraftStylePolicyEntry,
  validateDraftStylePolicyTable,
  validateDraftTargetVerticesPerFrame,
  type BudgetPolicyMode,
  type DraftStylePolicyEntry,
  type ListedDraftLookId,
  type ListedDraftStyleId,
  type PenRetraceMode
};

export type PlaybackRenderMode = "draft" | "full";

export const DEFAULT_PLAYBACK_RENDER_MODE: PlaybackRenderMode = "draft";
export const PLAYBACK_RENDER_MODE_STORAGE_KEY = "gm-plate-playback-render-mode";

/** Bounded Draft RAM runway constants (§3.1 & §5.3 of TASK-draft-preview-integration.md). */
export const DRAFT_NOMINAL_RUNWAY_FRAMES = 15;
export const DRAFT_MAX_RUNWAY_FRAMES = 30;
export const DRAFT_BEHIND_FRAMES = 2;
export const DRAFT_NEXT_SCENE_HEAD_FRAMES = 6;
export const DRAFT_SHARED_CACHE_BUDGET_MB = 32;
export const DRAFT_SHARED_CACHE_BUDGET_BYTES = DRAFT_SHARED_CACHE_BUDGET_MB * 1024 * 1024;

/** Intentional pause full-quality still upgrade debounce (§3.2 & §5.4). */
export const PAUSE_STILL_DEBOUNCE_MS = 250;

export type StillUpgradeState = "idle" | "pending-still" | "drawing-still" | "showing-still";

export type DraftQualitySpec = {
  mode: PlaybackRenderMode;
  profileVersion: string;
  draftTargetVerticesPerFrame: number;
  targetFramePenVertices: number;
  hatchFactor: number;
  hatchGapFactor: number;
  hatchStepFactor: number;
  hatchSubdivide: boolean;
  penSamplePer: number;
  penDensifyStep: number;
  penOutlineTolerance: number;
  penRetraceMode: PenRetraceMode;
  maxStrokeVertices: number;
  minStrokeCenterPts: number;
  budgetPolicy: BudgetPolicyMode;
  surfaceSampleFactor: number;
  materialDetailScale: number;
  mellanTurnDensity?: number;
  skipReadbackFlush: boolean;
};

/**
 * Statically analyzable Next.js access to `process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES`
 * (no optional chaining `process.env?.` or dynamic key indexing) so Next.js/webpack DefinePlugin
 * inlines the configured build-time value into client bundles.
 */
export function readEnvDraftTargetVerticesRaw(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES;
  } catch {
    return undefined;
  }
}

let activeDraftTargetVerticesPerFrame: number = resolveDraftTargetVerticesFromEnv(
  readEnvDraftTargetVerticesRaw()
);

const targetVerticesListeners = new Set<(targetVertices: number) => void>();

/** Returns the active global draft geometry budget (`draftTargetVerticesPerFrame`) used by unlisted styles. */
export function getDraftTargetVerticesPerFrame(): number {
  return activeDraftTargetVerticesPerFrame;
}

/**
 * Updates the active global draft geometry budget (`draftTargetVerticesPerFrame`) after validating range/integer constraints,
 * and notifies active `PlatePlayer` / `FilmPlayer` instances so unlisted scenes update their qualitySpec, Worker calibration,
 * and FrameCache keys immediately (C4: listed styles remain governed by `DRAFT_STYLE_POLICY_TABLE` unless forced or kill-switched).
 */
export function setDraftTargetVerticesPerFrame(value: unknown): number {
  const validated = validateDraftTargetVerticesPerFrame(value);
  if (validated !== activeDraftTargetVerticesPerFrame) {
    activeDraftTargetVerticesPerFrame = validated;
    for (const cb of [...targetVerticesListeners]) {
      try {
        cb(validated);
      } catch {}
    }
  }
  return validated;
}

/**
 * Resets the active global draft geometry budget back to the environment-configured `NEXT_PUBLIC_DRAFT_TARGET_VERTICES`
 * (or `DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME` = 75,000 when unset/invalid).
 */
export function resetDraftTargetVerticesPerFrame(rawEnvOverride?: unknown): number {
  const resolved = resolveDraftTargetVerticesFromEnv(
    rawEnvOverride !== undefined ? rawEnvOverride : readEnvDraftTargetVerticesRaw()
  );
  return setDraftTargetVerticesPerFrame(resolved);
}

/** Subscribes to changes made via `setDraftTargetVerticesPerFrame(value)`. */
export function onDraftTargetVerticesChange(cb: (targetVertices: number) => void): () => void {
  targetVerticesListeners.add(cb);
  return () => {
    targetVerticesListeners.delete(cb);
  };
}

export const FULL_QUALITY_SPEC: Readonly<DraftQualitySpec> = Object.freeze({
  mode: "full",
  profileVersion: DRAFT_PROFILE_VERSION,
  draftTargetVerticesPerFrame: 0,
  targetFramePenVertices: 0,
  hatchFactor: 1,
  hatchGapFactor: 1,
  hatchStepFactor: 1,
  hatchSubdivide: false,
  penSamplePer: 10,
  penDensifyStep: 1.5,
  penOutlineTolerance: 0,
  penRetraceMode: "full",
  maxStrokeVertices: 0,
  minStrokeCenterPts: 0,
  budgetPolicy: "off",
  surfaceSampleFactor: 1,
  materialDetailScale: 1,
  skipReadbackFlush: false
});

/**
 * Builds the Finalist C1 (or C2) draft quality spec for the given `targetVertices` (defaults to `getDraftTargetVerticesPerFrame()`).
 */
export function buildDraftQualitySpec(
  targetVertices: number = getDraftTargetVerticesPerFrame(),
  variant: "C1" | "C2" = "C1",
  extra?: { mellanTurnDensity?: number }
): Readonly<DraftQualitySpec> {
  const validTarget = validateDraftTargetVerticesPerFrame(targetVertices);
  const gapFactor = variant === "C2" ? 1.25 : 1.0;
  const mtd =
    typeof extra?.mellanTurnDensity === "number" &&
    Number.isFinite(extra.mellanTurnDensity) &&
    extra.mellanTurnDensity > 0 &&
    extra.mellanTurnDensity <= 1
      ? Math.round(extra.mellanTurnDensity * 1000) / 1000
      : undefined;
  return Object.freeze({
    mode: "draft",
    profileVersion: DRAFT_PROFILE_VERSION,
    draftTargetVerticesPerFrame: validTarget,
    targetFramePenVertices: validTarget,
    hatchFactor: gapFactor,
    hatchGapFactor: gapFactor,
    hatchStepFactor: 3.0,
    hatchSubdivide: true,
    penSamplePer: 2,
    penDensifyStep: 6,
    penOutlineTolerance: 0.8,
    penRetraceMode: "skip",
    maxStrokeVertices: 48,
    minStrokeCenterPts: 0,
    budgetPolicy: "scene-calibrated",
    surfaceSampleFactor: 2,
    materialDetailScale: deriveDraftDetailScale(validTarget),
    ...(mtd !== undefined ? { mellanTurnDensity: mtd } : {}),
    skipReadbackFlush: false
  });
}

export type ResolveDraftQualitySpecOptions = {
  look?: unknown;
  explicitTargetVertices?: number | null;
  customTable?: Record<string, unknown> | null;
  variant?: "C1" | "C2";
};

/**
 * Resolves the Draft quality spec for a scene according to the approved precedence order:
 * 1. Global force override (`NEXT_PUBLIC_DRAFT_TARGET_FORCE` / `setDraftTargetForceOverride`) — forces one target for all styles (no `mellanTurnDensity`).
 * 2. Per-player explicit `explicitTargetVertices` (`PlatePlayer` / `createFilmPlayer` option or `setDraftTargetVertices`) — forces that target for this player only (C5).
 * 3. Per-style policy table (`DRAFT_STYLE_POLICY_TABLE`) when `isDraftStylePolicyEnabled()` is `true` and `look` is one of the 9 listed styles (attaching `mellanTurnDensity` strictly for `mellan`).
 * 4. Global target fallback (`getDraftTargetVerticesPerFrame()` / `NEXT_PUBLIC_DRAFT_TARGET_VERTICES` / `75000`) for the 22 unlisted styles, missing/unknown look, or when kill switch is `off`.
 */
export function resolveDraftQualitySpecForStyle(
  options?: ResolveDraftQualitySpecOptions
): Readonly<DraftQualitySpec> {
  const variant = options?.variant ?? "C1";
  const forcedTarget = getDraftTargetForceOverride();
  if (forcedTarget !== null) {
    return buildDraftQualitySpec(forcedTarget, variant);
  }
  if (options?.explicitTargetVertices !== undefined && options.explicitTargetVertices !== null) {
    return buildDraftQualitySpec(options.explicitTargetVertices, variant);
  }
  if (isDraftStylePolicyEnabled()) {
    const entry = resolveDraftStylePolicyEntry(options?.look, options?.customTable);
    if (entry) {
      return buildDraftQualitySpec(entry.draftTargetVerticesPerFrame, variant, {
        ...(entry.styleId === "mellan" && entry.mellanTurnDensity !== undefined
          ? { mellanTurnDensity: entry.mellanTurnDensity }
          : {})
      });
    }
  }
  return buildDraftQualitySpec(getDraftTargetVerticesPerFrame(), variant);
}

export function resolveQualitySpecForMode(
  mode: PlaybackRenderMode,
  targetVertices?: number,
  look?: unknown
): Readonly<DraftQualitySpec> {
  if (mode === "full") {
    return FULL_QUALITY_SPEC;
  }
  return resolveDraftQualitySpecForStyle({
    look,
    explicitTargetVertices: targetVertices
  });
}

/**
 * Canonical cache/profile key for a render quality spec.
 * Includes `mode`, `profileVersion`, `draftTargetVerticesPerFrame`, and optional `mellanTurnDensity`
 * so frames drawn at 4,000+mtd0.75, 6,000, 60,000, 75,000, and Full never collide in `FrameCache`.
 */
export function draftQualityProfileKey(
  specOrMode?: Partial<DraftQualitySpec> | PlaybackRenderMode | null
): string {
  if (!specOrMode || specOrMode === "full") {
    return "full:1";
  }
  if (specOrMode === "draft") {
    const q = resolveDraftQualitySpecForStyle();
    return draftQualityProfileKey(q);
  }
  if (specOrMode.mode === "full") {
    return specOrMode.skipReadbackFlush ? "full:1:noflush" : "full:1";
  }
  const target =
    typeof specOrMode.draftTargetVerticesPerFrame === "number" && specOrMode.draftTargetVerticesPerFrame > 0
      ? specOrMode.draftTargetVerticesPerFrame
      : typeof specOrMode.targetFramePenVertices === "number" && specOrMode.targetFramePenVertices > 0
        ? specOrMode.targetFramePenVertices
        : getDraftTargetVerticesPerFrame();
  const ver = specOrMode.profileVersion ?? DRAFT_PROFILE_VERSION;
  const hg = specOrMode.hatchGapFactor ?? 1;
  const hs = specOrMode.hatchStepFactor ?? 3;
  const sub = specOrMode.hatchSubdivide ?? true;
  const sp = specOrMode.penSamplePer ?? 2;
  const ds = specOrMode.penDensifyStep ?? 6;
  const tol = specOrMode.penOutlineTolerance ?? 0.8;
  const rt = specOrMode.penRetraceMode ?? "skip";
  const ms = specOrMode.maxStrokeVertices ?? 48;
  const mc = specOrMode.minStrokeCenterPts ?? 0;
  const bp = specOrMode.budgetPolicy ?? "scene-calibrated";
  return [
    "draft",
    ver,
    `hg${hg}`,
    `hs${hs}`,
    `sub${sub ? 1 : 0}`,
    `sp${sp}`,
    `ds${ds}`,
    `tol${tol}`,
    `rt-${rt}`,
    `tb${target}`,
    `ms${ms}`,
    `mc${mc}`,
    `bp-${bp}`,
    ...(typeof specOrMode.mellanTurnDensity === "number" ? [`mtd${specOrMode.mellanTurnDensity}`] : [])
  ].join(":");
}

export function normalizePlaybackRenderMode(value: unknown): PlaybackRenderMode {
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "full") return "full";
    if (clean === "draft") return "draft";
  }
  return DEFAULT_PLAYBACK_RENDER_MODE;
}

export function readStoredPlaybackRenderMode(
  storage?: { getItem(key: string): string | null } | null
): PlaybackRenderMode {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== "undefined" && typeof window.localStorage !== "undefined"
          ? window.localStorage
          : null;
    if (!target) return DEFAULT_PLAYBACK_RENDER_MODE;
    const raw = target.getItem(PLAYBACK_RENDER_MODE_STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYBACK_RENDER_MODE;
    return normalizePlaybackRenderMode(raw);
  } catch {
    return DEFAULT_PLAYBACK_RENDER_MODE;
  }
}

export function writeStoredPlaybackRenderMode(
  mode: PlaybackRenderMode,
  storage?: { setItem(key: string, value: string): void } | null
): PlaybackRenderMode {
  const normalized = normalizePlaybackRenderMode(mode);
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== "undefined" && typeof window.localStorage !== "undefined"
          ? window.localStorage
          : null;
    target?.setItem(PLAYBACK_RENDER_MODE_STORAGE_KEY, normalized);
  } catch {
    // ignore storage errors
  }
  return normalized;
}
