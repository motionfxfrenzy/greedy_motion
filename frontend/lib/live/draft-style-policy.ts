/**
 * Per-style Draft quality policy (single authoritative table, look normalizer,
 * explicit force override `NEXT_PUBLIC_DRAFT_TARGET_FORCE`, and kill switch `NEXT_PUBLIC_DRAFT_STYLE_POLICY`).
 */

import {
  validateDraftTargetVerticesPerFrame
} from "../../../packages/plate-engine/src/canvas-core/core.ts";

export type ListedDraftStyleId =
  | "stipple"
  | "halftone"
  | "charcoalErasure"
  | "mellan"
  | "blueprint"
  | "pocketWatch"
  | "balloon"
  | "paintedOil"
  | "embroidery";

export type ListedDraftLookId =
  | "illus-stipple"
  | "illus-halftone"
  | "illus-charcoal-erasure"
  | "illus-mellan"
  | "illus-blueprint"
  | "illus-pocket-watch"
  | "illus-balloon"
  | "illus-painted-oil"
  | "illus-embroidery";

export type DraftStylePolicyEntry = {
  readonly styleId: ListedDraftStyleId;
  readonly lookId: ListedDraftLookId;
  readonly draftTargetVerticesPerFrame: number;
  readonly mellanTurnDensity?: number;
};

/**
 * Fixed exact alias map from the 9 listed camelCase style IDs to their canonical `illus-*` look IDs (C3).
 * No fuzzy matching or prefix guessing is performed.
 */
export const DRAFT_STYLE_ID_TO_LOOK_ID: Readonly<Record<ListedDraftStyleId, ListedDraftLookId>> =
  Object.freeze({
    stipple: "illus-stipple",
    halftone: "illus-halftone",
    charcoalErasure: "illus-charcoal-erasure",
    mellan: "illus-mellan",
    blueprint: "illus-blueprint",
    pocketWatch: "illus-pocket-watch",
    balloon: "illus-balloon",
    paintedOil: "illus-painted-oil",
    embroidery: "illus-embroidery"
  });

/**
 * Owner-approved per-style Draft quality policy table (exact; do not change).
 * Unlisted styles (the remaining 22 of 31) resolve to the global target (`NEXT_PUBLIC_DRAFT_TARGET_VERTICES`, fallback 75000).
 */
export const DRAFT_STYLE_POLICY_TABLE: Readonly<Record<ListedDraftLookId, Readonly<DraftStylePolicyEntry>>> =
  Object.freeze({
    "illus-stipple": Object.freeze({
      styleId: "stipple",
      lookId: "illus-stipple",
      draftTargetVerticesPerFrame: 75_000
    }),
    "illus-halftone": Object.freeze({
      styleId: "halftone",
      lookId: "illus-halftone",
      draftTargetVerticesPerFrame: 75_000
    }),
    "illus-charcoal-erasure": Object.freeze({
      styleId: "charcoalErasure",
      lookId: "illus-charcoal-erasure",
      draftTargetVerticesPerFrame: 6_000
    }),
    "illus-mellan": Object.freeze({
      styleId: "mellan",
      lookId: "illus-mellan",
      draftTargetVerticesPerFrame: 4_000,
      mellanTurnDensity: 0.75
    }),
    "illus-blueprint": Object.freeze({
      styleId: "blueprint",
      lookId: "illus-blueprint",
      draftTargetVerticesPerFrame: 6_000
    }),
    "illus-pocket-watch": Object.freeze({
      styleId: "pocketWatch",
      lookId: "illus-pocket-watch",
      draftTargetVerticesPerFrame: 6_000
    }),
    "illus-balloon": Object.freeze({
      styleId: "balloon",
      lookId: "illus-balloon",
      draftTargetVerticesPerFrame: 75_000
    }),
    "illus-painted-oil": Object.freeze({
      styleId: "paintedOil",
      lookId: "illus-painted-oil",
      draftTargetVerticesPerFrame: 6_000
    }),
    "illus-embroidery": Object.freeze({
      styleId: "embroidery",
      lookId: "illus-embroidery",
      draftTargetVerticesPerFrame: 6_000
    })
  });

/**
 * Normalizes a look or style identifier strictly against the 9 exact look IDs in `DRAFT_STYLE_POLICY_TABLE`
 * and the fixed 9-entry camelCase alias map `DRAFT_STYLE_ID_TO_LOOK_ID` (C3: no fuzzy matching).
 * Returns the canonical `ListedDraftLookId` or `null` if unlisted/unknown.
 */
export function normalizeListedDraftLook(lookOrStyle: unknown): ListedDraftLookId | null {
  if (typeof lookOrStyle !== "string" || lookOrStyle.length === 0) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(DRAFT_STYLE_POLICY_TABLE, lookOrStyle)) {
    return lookOrStyle as ListedDraftLookId;
  }
  if (Object.prototype.hasOwnProperty.call(DRAFT_STYLE_ID_TO_LOOK_ID, lookOrStyle)) {
    return DRAFT_STYLE_ID_TO_LOOK_ID[lookOrStyle as ListedDraftStyleId];
  }
  return null;
}

/**
 * Validates one `DraftStylePolicyEntry`. Throws `RangeError` in unit tests on invalid target vertices,
 * unknown/mismatched styleId/lookId, invalid `mellanTurnDensity`, or `mellanTurnDensity` on any non-mellan style.
 */
export function validateDraftStylePolicyEntry(entry: unknown): Readonly<DraftStylePolicyEntry> {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new RangeError("DraftStylePolicyEntry must be a non-null object.");
  }
  const rec = entry as Record<string, unknown>;
  const rawStyleId = rec.styleId;
  const rawLookId = rec.lookId;
  if (
    typeof rawStyleId !== "string" ||
    !Object.prototype.hasOwnProperty.call(DRAFT_STYLE_ID_TO_LOOK_ID, rawStyleId)
  ) {
    throw new RangeError(`Invalid or unlisted styleId in policy entry: ${String(rawStyleId)}`);
  }
  const expectedLookId = DRAFT_STYLE_ID_TO_LOOK_ID[rawStyleId as ListedDraftStyleId];
  if (rawLookId !== expectedLookId) {
    throw new RangeError(
      `Mismatched lookId for styleId "${rawStyleId}": expected "${expectedLookId}", got "${String(rawLookId)}"`
    );
  }
  const validTarget = validateDraftTargetVerticesPerFrame(rec.draftTargetVerticesPerFrame);

  if (rec.mellanTurnDensity !== undefined) {
    if (rawStyleId !== "mellan" || rawLookId !== "illus-mellan") {
      throw new RangeError(
        `mellanTurnDensity is only permitted for mellan (illus-mellan), got "${rawStyleId}" ("${rawLookId}").`
      );
    }
    if (
      typeof rec.mellanTurnDensity !== "number" ||
      !Number.isFinite(rec.mellanTurnDensity) ||
      rec.mellanTurnDensity <= 0 ||
      rec.mellanTurnDensity > 1
    ) {
      throw new RangeError(
        `Invalid mellanTurnDensity=${String(rec.mellanTurnDensity)}: must be a finite number in (0, 1].`
      );
    }
    const roundedMtd = Math.round(rec.mellanTurnDensity * 1000) / 1000;
    return Object.freeze({
      styleId: rawStyleId as ListedDraftStyleId,
      lookId: rawLookId as ListedDraftLookId,
      draftTargetVerticesPerFrame: validTarget,
      mellanTurnDensity: roundedMtd
    });
  }

  return Object.freeze({
    styleId: rawStyleId as ListedDraftStyleId,
    lookId: rawLookId as ListedDraftLookId,
    draftTargetVerticesPerFrame: validTarget
  });
}

/**
 * Validates an entire policy table record (`Record<string, unknown>`). Throws `RangeError` if any entry is invalid
 * or if a table key does not match its entry's `lookId` or `styleId`.
 */
export function validateDraftStylePolicyTable(
  table: unknown
): Readonly<Record<string, Readonly<DraftStylePolicyEntry>>> {
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new RangeError("DraftStylePolicyTable must be a non-null object.");
  }
  const rec = table as Record<string, unknown>;
  const out: Record<string, Readonly<DraftStylePolicyEntry>> = {};
  for (const [key, rawEntry] of Object.entries(rec)) {
    const validated = validateDraftStylePolicyEntry(rawEntry);
    if (key !== validated.lookId && key !== validated.styleId) {
      throw new RangeError(
        `Table key "${key}" does not match entry lookId "${validated.lookId}" or styleId "${validated.styleId}".`
      );
    }
    out[validated.lookId] = validated;
  }
  return Object.freeze(out);
}

// Validate the built-in table at module load time so any accidental corruption fails immediately in tests.
validateDraftStylePolicyTable(DRAFT_STYLE_POLICY_TABLE);

/**
 * Resolves a table entry for `lookOrStyle` at runtime.
 * Never throws: if `lookOrStyle` is unlisted or if a custom table entry is invalid, returns `null` so the caller
 * falls back cleanly to the global target.
 */
export function resolveDraftStylePolicyEntry(
  lookOrStyle: unknown,
  customTable?: Record<string, unknown> | null
): Readonly<DraftStylePolicyEntry> | null {
  try {
    const canonicalLook = normalizeListedDraftLook(lookOrStyle);
    if (!canonicalLook) return null;
    if (!customTable) {
      return DRAFT_STYLE_POLICY_TABLE[canonicalLook] ?? null;
    }
    const rawCandidate =
      customTable[canonicalLook] ??
      (typeof lookOrStyle === "string" ? customTable[lookOrStyle] : undefined);
    if (rawCandidate === undefined) return null;
    return validateDraftStylePolicyEntry(rawCandidate);
  } catch {
    return null;
  }
}

/**
 * Statically analyzable Next.js access to `process.env.NEXT_PUBLIC_DRAFT_TARGET_FORCE`
 * (explicit opt-in force override that applies one vertex target across all styles; off by default).
 */
export function readEnvDraftTargetForceRaw(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_DRAFT_TARGET_FORCE;
  } catch {
    return undefined;
  }
}

/**
 * Parses `NEXT_PUBLIC_DRAFT_TARGET_FORCE`. Returns `null` when unset, empty, `"off"`, or invalid.
 */
export function resolveDraftTargetForceFromEnv(rawValue: unknown): number | null {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim().toLowerCase();
    if (!trimmed || trimmed === "off" || trimmed === "false" || trimmed === "none" || trimmed === "0") {
      return null;
    }
  }
  try {
    return validateDraftTargetVerticesPerFrame(rawValue);
  } catch {
    return null;
  }
}

/**
 * Statically analyzable Next.js access to `process.env.NEXT_PUBLIC_DRAFT_STYLE_POLICY`
 * (kill switch: `"off"` / `"0"` / `"false"` disables the per-style table and restores global target everywhere).
 */
export function readEnvDraftStylePolicyRaw(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_DRAFT_STYLE_POLICY;
  } catch {
    return undefined;
  }
}

/**
 * Parses `NEXT_PUBLIC_DRAFT_STYLE_POLICY`. Defaults to `true` (policy enabled); returns `false` when `"off"`, `"0"`, `"false"`, or `"disabled"`.
 */
export function resolveDraftStylePolicyEnabledFromEnv(rawValue: unknown): boolean {
  if (typeof rawValue === "boolean") return rawValue;
  if (typeof rawValue === "string") {
    const clean = rawValue.trim().toLowerCase();
    if (clean === "off" || clean === "0" || clean === "false" || clean === "disabled" || clean === "no") {
      return false;
    }
  }
  return true;
}

let activeDraftTargetForceOverride: number | null = resolveDraftTargetForceFromEnv(
  readEnvDraftTargetForceRaw()
);
let activeDraftStylePolicyEnabled: boolean = resolveDraftStylePolicyEnabledFromEnv(
  readEnvDraftStylePolicyRaw()
);

const stylePolicyListeners = new Set<() => void>();

function notifyStylePolicyListeners(): void {
  for (const cb of [...stylePolicyListeners]) {
    try {
      cb();
    } catch {}
  }
}

/** Subscribes to changes in the force override or per-style policy kill switch. */
export function onDraftStylePolicyChange(cb: () => void): () => void {
  stylePolicyListeners.add(cb);
  return () => {
    stylePolicyListeners.delete(cb);
  };
}

/** Returns the active explicit force target override (`number`), or `null` when off (default). */
export function getDraftTargetForceOverride(): number | null {
  return activeDraftTargetForceOverride;
}

/**
 * Sets or clears the explicit testing force override (`number` in `[500, 2_000_000]`, or `null` to clear).
 * When set to a number, forces that single target for all styles (listed and unlisted) with no `mellanTurnDensity`.
 */
export function setDraftTargetForceOverride(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    if (activeDraftTargetForceOverride !== null) {
      activeDraftTargetForceOverride = null;
      notifyStylePolicyListeners();
    }
    return null;
  }
  const validated = validateDraftTargetVerticesPerFrame(value);
  if (validated !== activeDraftTargetForceOverride) {
    activeDraftTargetForceOverride = validated;
    notifyStylePolicyListeners();
  }
  return validated;
}

/** Resets the force override back to `process.env.NEXT_PUBLIC_DRAFT_TARGET_FORCE` (default `null`). */
export function resetDraftTargetForceOverride(rawEnvOverride?: unknown): number | null {
  const resolved = resolveDraftTargetForceFromEnv(
    rawEnvOverride !== undefined ? rawEnvOverride : readEnvDraftTargetForceRaw()
  );
  if (resolved !== activeDraftTargetForceOverride) {
    activeDraftTargetForceOverride = resolved;
    notifyStylePolicyListeners();
  }
  return activeDraftTargetForceOverride;
}

/** Returns `true` when the per-style Draft quality policy table is active (default `true`). */
export function isDraftStylePolicyEnabled(): boolean {
  return activeDraftStylePolicyEnabled;
}

/** Enables or disables the per-style Draft quality policy table at runtime (kill switch). */
export function setDraftStylePolicyEnabled(enabled: boolean): boolean {
  const next = Boolean(enabled);
  if (next !== activeDraftStylePolicyEnabled) {
    activeDraftStylePolicyEnabled = next;
    notifyStylePolicyListeners();
  }
  return activeDraftStylePolicyEnabled;
}

/** Resets the per-style policy kill switch back to `process.env.NEXT_PUBLIC_DRAFT_STYLE_POLICY` (default `true`). */
export function resetDraftStylePolicy(rawEnvOverride?: unknown): boolean {
  const resolved = resolveDraftStylePolicyEnabledFromEnv(
    rawEnvOverride !== undefined ? rawEnvOverride : readEnvDraftStylePolicyRaw()
  );
  return setDraftStylePolicyEnabled(resolved);
}
