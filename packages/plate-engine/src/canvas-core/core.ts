// PORTABLE ART CORE, phase 0. Plain TypeScript: no React, no Remotion, no DOM, no SVG,
// and no ctx.filter of any kind. Everything a host must supply is in `Env`.
//
// Contract: draw(ctx, frame, env) is a pure function of (frame, env). Randomness only
// from rng(seed). Texture = seeded, tileable noise composited per layer. Edge wobble
// and wet-edge displacement are baked into GEOMETRY, never applied as a filter.

export type P = [number, number];
export type Ctx = CanvasRenderingContext2D;
export type Layer = { canvas: CanvasImageSource & { width: number; height: number }; ctx: Ctx };
export type RenderQualityMode = "full" | "draft";
export type PenRetraceMode = "full" | "simplified" | "skip";
export type BudgetPolicyMode = "off" | "scene-calibrated" | "adaptive-hysteresis";
export type EffectiveOptimizationKind =
  | "full"
  | "pen+hatch"
  | "pen-only"
  | "hatch-only"
  | "native-kit-material"
  | "pen+hatch+kit"
  | "native-full-passthrough";

/**
 * Single authoritative default for the tunable draft geometry target (vertices per frame).
 * Edit this constant (or `DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME` in `frontend/lib/live/draft-profile.ts`,
 * or call `setDraftTargetVerticesPerFrame(value)`) to test 6,000, 60,000, 75,000 or any valid budget.
 */
export const DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME = 75_000;
export const MIN_DRAFT_TARGET_VERTICES_PER_FRAME = 500;
export const MAX_DRAFT_TARGET_VERTICES_PER_FRAME = 2_000_000;
export const DRAFT_PROFILE_VERSION = "v1";

export function validateDraftTargetVerticesPerFrame(value: unknown): number {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || !Number.isInteger(num)) {
    throw new RangeError(
      `Invalid draftTargetVerticesPerFrame: expected a finite integer in [${MIN_DRAFT_TARGET_VERTICES_PER_FRAME}, ${MAX_DRAFT_TARGET_VERTICES_PER_FRAME}], got ${String(value)}`
    );
  }
  if (num < MIN_DRAFT_TARGET_VERTICES_PER_FRAME || num > MAX_DRAFT_TARGET_VERTICES_PER_FRAME) {
    throw new RangeError(
      `Invalid draftTargetVerticesPerFrame: ${num} is outside [${MIN_DRAFT_TARGET_VERTICES_PER_FRAME}, ${MAX_DRAFT_TARGET_VERTICES_PER_FRAME}]`
    );
  }
  return num;
}

/**
 * Resolves `NEXT_PUBLIC_DRAFT_TARGET_VERTICES` from an environment string or value.
 * Unset, empty, non-numeric, non-finite, fractional, or out-of-range values safely fall back to
 * `DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME` (75,000); valid integers in `[500, 2_000_000]` (e.g. 6000, 60000, 75000) are honored.
 */
export function resolveDraftTargetVerticesFromEnv(rawValue?: unknown): number {
  if (rawValue === undefined || rawValue === null) {
    return DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME;
  }
  if (typeof rawValue === "string" && rawValue.trim() === "") {
    return DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME;
  }
  try {
    return validateDraftTargetVerticesPerFrame(rawValue);
  } catch {
    return DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME;
  }
}

/**
 * Derives deterministic material/surface detail scale (0.25 .. 1.0) from `draftTargetVerticesPerFrame`
 * so native kits (woodcut, paintedOil, embroidery, charcoalErasure, toyBrick, folkTale, etc.) scale
 * their interior surface detail smoothly when the single target parameter is tuned (e.g. 6k, 60k, 75k).
 * Documented as a quality heuristic for non-vertex work; never deletes or alters protected shapes.
 */
export function deriveDraftDetailScale(targetVertices: number): number {
  if (!(targetVertices > 0)) return 1;
  const ratio = Math.min(1, Math.max(0.02, targetVertices / DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME));
  return Math.round(Math.max(0.22, Math.min(0.85, 0.25 + 0.5 * Math.sqrt(ratio))) * 1000) / 1000;
}

export type RenderQualitySpec = {
  mode: RenderQualityMode;
  profileVersion: string;
  /** Single authoritative tunable geometry budget for draft mode (e.g. 6000, 60000, 75000). 0 in full mode. */
  draftTargetVerticesPerFrame: number;
  /** Legacy/alias field equal to `draftTargetVerticesPerFrame` (kept in sync so all callers see the same budget). */
  targetFramePenVertices: number;
  /** Legacy combined hatch factor (if > 1 and hatchGapFactor/hatchStepFactor are not explicitly set). */
  hatchFactor: number;
  /** Spacing multiplier between parallel hatch scanlines (1 = normal gap, preserves full stroke coverage without stripes). */
  hatchGapFactor: number;
  /** Along-stroke step multiplier when probing keep(x, y) inside hatchRuns (1 = normal step; >1 probes fewer points). */
  hatchStepFactor: number;
  /** When hatchStepFactor > 1, whether to linearly subdivide kept segments back to normal step spacing so downstream filter/RNG sees normal point density. */
  hatchSubdivide: boolean;
  /** Gfx.pen Lever 1a: Catmull-Rom spline samples per control segment (full = 10). */
  penSamplePer: number;
  /** Gfx.pen Lever 1b: Ribbon densify step in logical px (full = 1.5; 0 = disable densify). */
  penDensifyStep: number;
  /** Gfx.pen Lever 2: Centerline chord-deviation simplification tolerance in logical px before ribbon expansion (full = 0). */
  penOutlineTolerance: number;
  /** Gfx.pen Lever 3: Secondary retrace handling ("full" | "simplified" | "skip"). */
  penRetraceMode: PenRetraceMode;
  /** Per-stroke cap on final Gfx.pen ribbon vertices (primary + retrace; 0 = uncapped; default draft = 48). */
  maxStrokeVertices: number;
  /** Normal minimum centerline points per stroke before safe floor degradation (0 = auto: 8 closed / 4 open). */
  minStrokeCenterPts: number;
  /** Budget allocation policy ("off" | "scene-calibrated" | "adaptive-hysteresis"). */
  budgetPolicy: BudgetPolicyMode;
  /** Surface/texture pixel sampling step factor for procedural paper/weave/grain tiles in draft mode (full = 1, draft = 2). */
  surfaceSampleFactor: number;
  /** Deterministic interior material detail density scale (0.3..1.0) derived from `draftTargetVerticesPerFrame` (full = 1). */
  materialDetailScale: number;
  /** Optional experimental spiral turn-density factor (0 < d <= 1) for Mellan turn-pitch vs arcStep comparison. */
  mellanTurnDensity?: number;
  /** Isolated experiment flag: only true when testing removal of the 1x1 getImageData flush in hosts/page.ts. Default false. */
  skipReadbackFlush: boolean;
};

export type ScenePenCalibration = {
  qualityKey: string;
  representativeFrames: number[];
  peakPenCalls: number;
  peakFullVertices: number;
  peakBaseDraftVertices: number;
  peakArcLen: number;
  draftTargetVerticesPerFrame: number;
  targetFramePenVertices: number;
  effectiveScaleRatio: number;
  baseDraftScaleRatio: number;
  effectiveMinCenterPtsClosed: number;
  effectiveMinCenterPtsOpen: number;
  effectiveRetraceMode: PenRetraceMode;
  floorDegraded: boolean;
  budgetExceededByFloor: boolean;
  calibrationMs: number;
  /** For adaptive-hysteresis mode: current dynamic multiplier and cooldown counter. */
  adaptiveScale: number;
  adaptiveCooldownFrames: number;
  adaptiveSwitches: number;
};

export type FrameGeometryStats = {
  frame: number;
  qualityMode: RenderQualityMode;
  qualityKey: string;
  profileVersion: string;
  jsRenderFrameMs: number;
  getImageDataFlushMs: number;
  totalSeekMs: number;
  penCalls: number;
  penPrimaryRibbons: number;
  penRetraceRibbons: number;
  penTotalRibbons: number;
  penInputVertices: number;
  penCenterlinePts: number;
  penPrimaryVertices: number;
  penRetraceVertices: number;
  penRibbonVertices: number;
  baseDraftPenVertices: number;
  otherPolygonCount: number;
  otherPathVertices: number;
  protectedPolygons: number;
  protectedVertices: number;
  detailPolygons: number;
  detailVertices: number;
  kitMaterialOpsReduced: number;
  hatchRunsCalls: number;
  hatchGridPointsTested: number;
  hatchRunsReturned: number;
  totalPolygonsDrawn: number;
  totalSceneVertices: number;
  draftTargetVerticesPerFrame: number;
  targetFramePenVertices: number;
  calibratedPeakFullVertices: number;
  calibratedPeakBaseDraftVertices: number;
  effectiveScaleRatio: number;
  baseDraftScaleRatio: number;
  floorDegraded: boolean;
  budgetExceededByFloor: boolean;
  adaptiveSwitches: number;
  draftPrimitivesUsed: boolean;
  effectiveOptimization: EffectiveOptimizationKind;
};

export const DEFAULT_RENDER_QUALITY: Readonly<RenderQualitySpec> = Object.freeze({
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
 * Default production draft geometry profile (C1: zero bare-paper striping `hatchGapFactor = 1.0`,
 * `hatchStepFactor = 3.0`, `hatchSubdivide = true`, `penSamplePer = 2`, `penDensifyStep = 6`,
 * `penOutlineTolerance = 0.8`, `penRetraceMode = "skip"`, `maxStrokeVertices = 48`,
 * `draftTargetVerticesPerFrame = DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME`).
 */
export function buildDefaultDraftQualitySpec(
  targetVertices: number = DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME,
  variant: "C1" | "C2" = "C1"
): Readonly<RenderQualitySpec> {
  const validTarget = validateDraftTargetVerticesPerFrame(targetVertices);
  const gapFactor = variant === "C2" ? 1.25 : 1.0;
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
    skipReadbackFlush: false
  });
}

let activeRenderQuality: Readonly<RenderQualitySpec> = DEFAULT_RENDER_QUALITY;
let activeCalibrating = false;

export const normalizeRenderQuality = (
  spec?: Partial<RenderQualitySpec> | RenderQualityMode | number | null
): Readonly<RenderQualitySpec> => {
  if (!spec || spec === "full" || spec === 1) return DEFAULT_RENDER_QUALITY;
  if (typeof spec === "number") {
    if (!Number.isFinite(spec) || spec <= 1) return DEFAULT_RENDER_QUALITY;
    return Object.freeze({
      ...DEFAULT_RENDER_QUALITY,
      mode: "draft",
      hatchFactor: spec,
      hatchGapFactor: spec,
      hatchStepFactor: spec
    });
  }
  if (spec === "draft") {
    return buildDefaultDraftQualitySpec(DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME, "C1");
  }
  if (typeof spec !== "object") {
    return DEFAULT_RENDER_QUALITY;
  }
  const mode: RenderQualityMode = spec.mode === "draft" ? "draft" : "full";
  if (mode === "full") {
    if (spec.skipReadbackFlush) {
      return Object.freeze({ ...DEFAULT_RENDER_QUALITY, skipReadbackFlush: true });
    }
    return DEFAULT_RENDER_QUALITY;
  }

  // Resolve single authoritative target budget (`draftTargetVerticesPerFrame` takes precedence over alias `targetFramePenVertices`).
  let resolvedTarget = 0;
  const rawTarget =
    spec.draftTargetVerticesPerFrame !== undefined
      ? spec.draftTargetVerticesPerFrame
      : spec.targetFramePenVertices;
  if (rawTarget !== undefined) {
    if (typeof rawTarget === "number" && Number.isFinite(rawTarget) && rawTarget > 0) {
      resolvedTarget = Math.max(
        MIN_DRAFT_TARGET_VERTICES_PER_FRAME,
        Math.min(MAX_DRAFT_TARGET_VERTICES_PER_FRAME, Math.floor(rawTarget))
      );
    } else {
      resolvedTarget = 0;
    }
  } else if (
    spec.hatchFactor === undefined &&
    spec.hatchGapFactor === undefined &&
    spec.hatchStepFactor === undefined &&
    spec.penSamplePer === undefined &&
    spec.penDensifyStep === undefined &&
    spec.penOutlineTolerance === undefined &&
    spec.penRetraceMode === undefined &&
    spec.maxStrokeVertices === undefined &&
    spec.mellanTurnDensity === undefined
  ) {
    // Plain `{ mode: "draft" }` -> use authoritative default draft profile
    return buildDefaultDraftQualitySpec(DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME, "C1");
  }

  const parsedTurnDensity =
    typeof spec.mellanTurnDensity === "number" && Number.isFinite(spec.mellanTurnDensity) && spec.mellanTurnDensity > 0 && spec.mellanTurnDensity <= 1
      ? Math.round(spec.mellanTurnDensity * 1000) / 1000
      : undefined;

  const hasExplicitDefaultProfile = spec.draftTargetVerticesPerFrame !== undefined &&
    spec.penSamplePer === undefined &&
    spec.penDensifyStep === undefined &&
    spec.penOutlineTolerance === undefined &&
    spec.penRetraceMode === undefined &&
    spec.hatchGapFactor === undefined &&
    spec.hatchStepFactor === undefined &&
    spec.hatchFactor === undefined;

  if (hasExplicitDefaultProfile && resolvedTarget > 0) {
    const baseSpec = buildDefaultDraftQualitySpec(resolvedTarget, "C1");
    if (parsedTurnDensity !== undefined) {
      return Object.freeze({ ...baseSpec, mellanTurnDensity: parsedTurnDensity });
    }
    return baseSpec;
  }

  const rawHatch =
    typeof spec.hatchFactor === "number" && Number.isFinite(spec.hatchFactor) && spec.hatchFactor >= 1
      ? spec.hatchFactor
      : 1;
  const hatchGapFactor =
    typeof spec.hatchGapFactor === "number" && Number.isFinite(spec.hatchGapFactor) && spec.hatchGapFactor >= 1
      ? spec.hatchGapFactor
      : rawHatch;
  const hatchStepFactor =
    typeof spec.hatchStepFactor === "number" && Number.isFinite(spec.hatchStepFactor) && spec.hatchStepFactor >= 1
      ? spec.hatchStepFactor
      : rawHatch;
  const hatchSubdivide = Boolean(spec.hatchSubdivide);
  const penSamplePer =
    typeof spec.penSamplePer === "number" && Number.isFinite(spec.penSamplePer) && spec.penSamplePer >= 1
      ? Math.min(10, Math.max(1, Math.round(spec.penSamplePer)))
      : 10;
  const penDensifyStep =
    typeof spec.penDensifyStep === "number" && Number.isFinite(spec.penDensifyStep) && spec.penDensifyStep >= 0
      ? spec.penDensifyStep
      : 1.5;
  const penOutlineTolerance =
    typeof spec.penOutlineTolerance === "number" && Number.isFinite(spec.penOutlineTolerance) && spec.penOutlineTolerance >= 0
      ? spec.penOutlineTolerance
      : 0;
  const penRetraceMode: PenRetraceMode =
    spec.penRetraceMode === "skip" || spec.penRetraceMode === "simplified" || spec.penRetraceMode === "full"
      ? spec.penRetraceMode
      : "full";
  const maxStrokeVertices =
    typeof spec.maxStrokeVertices === "number" && Number.isFinite(spec.maxStrokeVertices) && spec.maxStrokeVertices > 0
      ? Math.floor(spec.maxStrokeVertices)
      : 0;
  const minStrokeCenterPts =
    typeof spec.minStrokeCenterPts === "number" && Number.isFinite(spec.minStrokeCenterPts) && spec.minStrokeCenterPts >= 2
      ? Math.floor(spec.minStrokeCenterPts)
      : 0;
  const budgetPolicy: BudgetPolicyMode =
    spec.budgetPolicy === "scene-calibrated" || spec.budgetPolicy === "adaptive-hysteresis" || spec.budgetPolicy === "off"
      ? spec.budgetPolicy
      : resolvedTarget > 0
        ? "scene-calibrated"
        : "off";
  const skipReadbackFlush = Boolean(spec.skipReadbackFlush);
  const profileVersion =
    typeof spec.profileVersion === "string" && spec.profileVersion.trim()
      ? spec.profileVersion.trim()
      : DRAFT_PROFILE_VERSION;
  const surfaceSampleFactor =
    typeof spec.surfaceSampleFactor === "number" && Number.isFinite(spec.surfaceSampleFactor) && spec.surfaceSampleFactor >= 1
      ? Math.min(4, Math.max(1, Math.round(spec.surfaceSampleFactor)))
      : 2;
  const materialDetailScale =
    typeof spec.materialDetailScale === "number" && Number.isFinite(spec.materialDetailScale) && spec.materialDetailScale > 0
      ? Math.min(1, Math.max(0.25, spec.materialDetailScale))
      : deriveDraftDetailScale(resolvedTarget > 0 ? resolvedTarget : DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME);
  const mellanTurnDensity =
    typeof spec.mellanTurnDensity === "number" && Number.isFinite(spec.mellanTurnDensity) && spec.mellanTurnDensity > 0 && spec.mellanTurnDensity <= 1
      ? Math.round(spec.mellanTurnDensity * 1000) / 1000
      : undefined;

  const isNoOpDraft =
    hatchGapFactor <= 1 &&
    hatchStepFactor <= 1 &&
    penSamplePer >= 10 &&
    Math.abs(penDensifyStep - 1.5) < 1e-6 &&
    penOutlineTolerance <= 0 &&
    penRetraceMode === "full" &&
    resolvedTarget <= 0 &&
    maxStrokeVertices <= 0 &&
    surfaceSampleFactor <= 1 &&
    materialDetailScale >= 1 &&
    mellanTurnDensity === undefined &&
    !skipReadbackFlush;
  if (isNoOpDraft) return DEFAULT_RENDER_QUALITY;

  return Object.freeze({
    mode: "draft",
    profileVersion,
    draftTargetVerticesPerFrame: resolvedTarget,
    targetFramePenVertices: resolvedTarget,
    hatchFactor: hatchGapFactor === hatchStepFactor ? hatchGapFactor : rawHatch,
    hatchGapFactor,
    hatchStepFactor,
    hatchSubdivide,
    penSamplePer,
    penDensifyStep,
    penOutlineTolerance,
    penRetraceMode,
    maxStrokeVertices,
    minStrokeCenterPts,
    budgetPolicy,
    surfaceSampleFactor,
    materialDetailScale,
    ...(mellanTurnDensity !== undefined ? { mellanTurnDensity } : {}),
    skipReadbackFlush
  });
};

export const renderQualityKey = (
  spec?: Partial<RenderQualitySpec> | RenderQualityMode | number | null
): string => {
  const q = normalizeRenderQuality(spec);
  if (q.mode === "full") {
    return q.skipReadbackFlush ? "full:1:noflush" : "full:1";
  }
  const isPureHatchOnly =
    q.hatchGapFactor === q.hatchStepFactor &&
    !q.hatchSubdivide &&
    q.penSamplePer === 10 &&
    Math.abs(q.penDensifyStep - 1.5) < 1e-6 &&
    q.penOutlineTolerance === 0 &&
    q.penRetraceMode === "full" &&
    q.draftTargetVerticesPerFrame === 0 &&
    q.maxStrokeVertices === 0 &&
    !q.skipReadbackFlush;
  if (isPureHatchOnly) {
    return `draft:${q.hatchGapFactor}`;
  }
  return [
    "draft",
    q.profileVersion,
    `hg${q.hatchGapFactor}`,
    `hs${q.hatchStepFactor}`,
    `sub${q.hatchSubdivide ? 1 : 0}`,
    `sp${q.penSamplePer}`,
    `ds${q.penDensifyStep}`,
    `tol${q.penOutlineTolerance}`,
    `rt-${q.penRetraceMode}`,
    `tb${q.draftTargetVerticesPerFrame}`,
    `ms${q.maxStrokeVertices}`,
    `mc${q.minStrokeCenterPts}`,
    `bp-${q.budgetPolicy}`,
    ...(q.mellanTurnDensity !== undefined ? [`mtd${q.mellanTurnDensity}`] : []),
    ...(q.skipReadbackFlush ? ["noflush"] : [])
  ].join(":");
};

const createEmptyFrameStats = (frame = 0, q: Readonly<RenderQualitySpec> = DEFAULT_RENDER_QUALITY): FrameGeometryStats => ({
  frame,
  qualityMode: q.mode,
  qualityKey: renderQualityKey(q),
  profileVersion: q.profileVersion,
  jsRenderFrameMs: 0,
  getImageDataFlushMs: 0,
  totalSeekMs: 0,
  penCalls: 0,
  penPrimaryRibbons: 0,
  penRetraceRibbons: 0,
  penTotalRibbons: 0,
  penInputVertices: 0,
  penCenterlinePts: 0,
  penPrimaryVertices: 0,
  penRetraceVertices: 0,
  penRibbonVertices: 0,
  baseDraftPenVertices: 0,
  otherPolygonCount: 0,
  otherPathVertices: 0,
  protectedPolygons: 0,
  protectedVertices: 0,
  detailPolygons: 0,
  detailVertices: 0,
  kitMaterialOpsReduced: 0,
  hatchRunsCalls: 0,
  hatchGridPointsTested: 0,
  hatchRunsReturned: 0,
  totalPolygonsDrawn: 0,
  totalSceneVertices: 0,
  draftTargetVerticesPerFrame: q.draftTargetVerticesPerFrame,
  targetFramePenVertices: q.targetFramePenVertices,
  calibratedPeakFullVertices: 0,
  calibratedPeakBaseDraftVertices: 0,
  effectiveScaleRatio: 1,
  baseDraftScaleRatio: 1,
  floorDegraded: false,
  budgetExceededByFloor: false,
  adaptiveSwitches: 0,
  draftPrimitivesUsed: false,
  effectiveOptimization: q.mode === "full" ? "full" : "native-full-passthrough"
});

let currentFrameStats: FrameGeometryStats = createEmptyFrameStats();

function refreshOptimizationSummary(st: FrameGeometryStats): void {
  if (st.qualityMode === "full") {
    st.draftPrimitivesUsed = false;
    st.effectiveOptimization = "full";
    return;
  }
  const hasPen = st.penCalls > 0;
  const hasHatch = st.hatchRunsCalls > 0;
  const hasKitMaterial = st.kitMaterialOpsReduced > 0;
  st.draftPrimitivesUsed = hasPen || hasHatch || hasKitMaterial;
  st.effectiveOptimization =
    (hasPen || hasHatch) && hasKitMaterial
      ? "pen+hatch+kit"
      : hasPen && hasHatch
        ? "pen+hatch"
        : hasPen
          ? "pen-only"
          : hasHatch
            ? "hatch-only"
            : hasKitMaterial
              ? "native-kit-material"
              : "native-full-passthrough";
}

export const beginFrameGeometryStats = (frame: number, q: Readonly<RenderQualitySpec> = activeRenderQuality): FrameGeometryStats => {
  currentFrameStats = createEmptyFrameStats(frame, q);
  return currentFrameStats;
};

export const getFrameGeometryStats = (): FrameGeometryStats => currentFrameStats;

export const recordHatchStats = (callsDelta: number, gridPtsDelta: number, runsDelta: number): void => {
  currentFrameStats.hatchRunsCalls += callsDelta;
  currentFrameStats.hatchGridPointsTested += gridPtsDelta;
  currentFrameStats.hatchRunsReturned += runsDelta;
  refreshOptimizationSummary(currentFrameStats);
};

export const recordOtherPathStats = (polygonsDelta: number, verticesDelta: number, isDetail = false): void => {
  if (activeCalibrating) return;
  currentFrameStats.otherPolygonCount += polygonsDelta;
  currentFrameStats.otherPathVertices += verticesDelta;
  if (isDetail) {
    currentFrameStats.detailPolygons += polygonsDelta;
    currentFrameStats.detailVertices += verticesDelta;
  } else {
    currentFrameStats.protectedPolygons += polygonsDelta;
    currentFrameStats.protectedVertices += verticesDelta;
  }
  currentFrameStats.totalPolygonsDrawn = currentFrameStats.penTotalRibbons + currentFrameStats.otherPolygonCount;
  currentFrameStats.totalSceneVertices = currentFrameStats.penRibbonVertices + currentFrameStats.otherPathVertices;
};

export const recordKitMaterialReduction = (opsReducedDelta = 1, detailPolygonsDelta = 0, detailVerticesDelta = 0): void => {
  if (activeCalibrating) return;
  currentFrameStats.kitMaterialOpsReduced += opsReducedDelta;
  if (detailPolygonsDelta > 0 || detailVerticesDelta > 0) {
    recordOtherPathStats(detailPolygonsDelta, detailVerticesDelta, true);
  }
  refreshOptimizationSummary(currentFrameStats);
};

export const isCalibratingPen = (): boolean => activeCalibrating;

export const withPenCalibrationPass = <T>(fn: () => T): T => {
  const prev = activeCalibrating;
  activeCalibrating = true;
  try {
    return fn();
  } finally {
    activeCalibrating = prev;
  }
};

export const getRenderQuality = (): Readonly<RenderQualitySpec> => activeRenderQuality;

export const withRenderQuality = <T>(
  spec: Partial<RenderQualitySpec> | RenderQualityMode | number | null | undefined,
  fn: (q: Readonly<RenderQualitySpec>) => T
): T => {
  const prev = activeRenderQuality;
  const next = normalizeRenderQuality(spec);
  activeRenderQuality = next;
  (globalThis as { __ANIDOODLE_QUALITY__?: Readonly<RenderQualitySpec> }).__ANIDOODLE_QUALITY__ = next;
  try {
    return fn(next);
  } finally {
    activeRenderQuality = prev;
    (globalThis as { __ANIDOODLE_QUALITY__?: Readonly<RenderQualitySpec> }).__ANIDOODLE_QUALITY__ = prev;
  }
};

export type Env = {
  W: number; H: number; scale: number; // logical size, device pixels per logical pixel
  canvas(w: number, h: number): Layer; // the ONLY way the core obtains an offscreen surface
  image?(name: string): CanvasImageSource | undefined; // assets are decoded by the ADAPTER before frame 0
  cache: Map<string, unknown>;
  quality?: Readonly<RenderQualitySpec>;
  penCalibration?: ScenePenCalibration;
  // OPTIONAL, host-provided: a store of finished plate frames that outlives the page (the adapters
  // keep it on disk, keyed by a hash of the plate's source, so it can never hand back stale art).
  // get() returns the exact pixels renderFrame would draw for (film, frame) at w x h, or nothing;
  // put() offers a freshly drawn one. A core that never calls it draws exactly the same frames.
  bake?: { get(film: object, frame: number, w: number, h: number): CanvasImageSource | undefined; put(film: object, frame: number, layer: Layer): void };
  // set by the host on the film's own env (never on a plate's): what is drawn with it lands in the
  // frame, so the frame probe (framecheck.mjs) may hold its text and content boxes to the frame's edges
  root?: boolean;
};

// ---------------------------------------------------------------- the frame probe
export type ProbeRec = { kind: "text" | "box"; label: string; x0: number; y0: number; x1: number; y1: number };
export type AspectAdapt = { w0: number; h0: number; wt: number; ht: number; s: number; tx: number; ty: number; padX: number; padY: number };
export const getAdapt = (): AspectAdapt | undefined => (globalThis as { __ANIDOODLE_ADAPT__?: AspectAdapt }).__ANIDOODLE_ADAPT__;
const adaptCache = new WeakMap<object, readonly [number, number][]>();
export const adaptPts = <T extends readonly [number, number][]>(pts: T): T => {
  const ad = getAdapt();
  if (!ad || !pts || pts.length < 3) return pts;
  const hit = adaptCache.get(pts);
  if (hit) return hit as T;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const wide = (x1 - x0) >= ad.w0 * 0.68, tall = (y1 - y0) >= ad.h0 * 0.68;
  if (!wide && !tall) {
    adaptCache.set(pts, pts);
    return pts;
  }
  const touchTop = wide && y0 <= 45, touchBot = wide && y1 >= ad.h0 - 55;
  const touchLeft = (wide || tall) && x0 <= 45, touchRight = (wide || tall) && x1 >= ad.w0 - 45;
  if (!touchTop && !touchBot && !touchLeft && !touchRight) {
    adaptCache.set(pts, pts);
    return pts;
  }
  const expanded = pts.map(([x, y]) => [
    touchLeft && x <= 45 ? x - ad.padX : touchRight && x >= ad.w0 - 45 ? x + ad.padX : x,
    touchTop && y <= 45 ? y - ad.padY : touchBot && y >= ad.h0 - 55 ? y + ad.padY : y
  ]) as unknown as T;
  adaptCache.set(pts, expanded);
  adaptCache.set(expanded, expanded);
  return expanded;
};

// ---------------------------------------------------------------- point in polygon (even-odd), indexed
type RingIndex = { n: number; fx: number; fy: number; mx: number; my: number; lx: number; ly: number; fast: boolean; x0: number; x1: number; y0: number; y1: number; h: number; B: number; off: Int32Array; ids: Int32Array; ep: number; xy: Float64Array };
const ringCache = new WeakMap<object, RingIndex>();
const RING_MIN = 16, RING_HUGE = 1e100;
let ringEpoch = 0;
export const ringNewFrame = () => { ringEpoch++; };
const ringSame = (p: readonly (readonly number[])[], c: RingIndex) => { const xy = c.xy; for (let i = 0; i < c.n; i++) { if (!Object.is(p[i][0], xy[2 * i]) || !Object.is(p[i][1], xy[2 * i + 1])) return false; } return true; };
const ringLoop = (pts: readonly (readonly number[])[], x: number, y: number) => { let k = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
const ringBuild = (p: readonly (readonly number[])[]): RingIndex => {
  const n = p.length, m = n >> 1, f = p[0], md = p[m], l = p[n - 1], xy = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { const q = p[i]; xy[2 * i] = q[0]; xy[2 * i + 1] = q[1]; }
  const idx: RingIndex = { n, fx: f[0], fy: f[1], mx: md[0], my: md[1], lx: l[0], ly: l[1], fast: false, x0: 0, x1: 0, y0: 0, y1: 0, h: 1, B: 1, off: new Int32Array(0), ids: new Int32Array(0), ep: ringEpoch, xy };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const qx = xy[2 * i], qy = xy[2 * i + 1];
    if (!(Math.abs(qx) < RING_HUGE) || !(Math.abs(qy) < RING_HUGE)) return idx;
    if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
  }
  const B = Math.max(1, Math.min(512, m)), h = (y1 - y0) / B || 1;
  const bucket = (v: number) => { let k = Math.floor((v - y0) / h); if (k < 0) k = 0; else if (k > B - 1) k = B - 1; return k; };
  const count = new Int32Array(B + 1);
  for (let pass = 0; pass < 2; pass++) {
    const fill = pass === 1, pos = fill ? count.slice() : null;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = p[i][1], by = p[j][1];
      if (ay === by) continue;
      const s = bucket(ay < by ? ay : by), e = bucket(ay < by ? by : ay);
      for (let k = s; k <= e; k++) { if (!fill) count[k + 1]++; else { idx.ids[pos![k]++] = i; } }
    }
    if (!fill) { for (let k = 0; k < B; k++) count[k + 1] += count[k]; idx.off = count; idx.ids = new Int32Array(count[B]); }
  }
  idx.x0 = x0; idx.x1 = x1; idx.y0 = y0; idx.y1 = y1; idx.h = h; idx.B = B; idx.fast = true;
  return idx;
};
export const insideRing = (p: readonly (readonly number[])[], x: number, y: number): boolean => {
  const n = p.length;
  if (n < RING_MIN) return ringLoop(p, x, y);
  let c = ringCache.get(p);
  if (c && c.ep !== ringEpoch) { if (c.n === n && ringSame(p, c)) c.ep = ringEpoch; else c = undefined; }
  if (!c || c.n !== n || !Object.is(p[0][0], c.fx) || !Object.is(p[0][1], c.fy) || !Object.is(p[n >> 1][0], c.mx) || !Object.is(p[n >> 1][1], c.my) || !Object.is(p[n - 1][0], c.lx) || !Object.is(p[n - 1][1], c.ly)) {
    c = ringBuild(p);
    ringCache.set(p, c);
  }
  if (!c.fast) return ringLoop(p, x, y);
  const mg = 1e-9 * (Math.abs(c.x0) + Math.abs(c.x1) + (c.x1 - c.x0)) + 1e-300;
  if (!(y >= c.y0 && y <= c.y1 && x >= c.x0 - mg && x <= c.x1 + mg)) return false;
  let kk = Math.floor((y - c.y0) / c.h);
  if (kk < 0) kk = 0; else if (kk > c.B - 1) kk = c.B - 1;
  let r = false;
  for (let q = c.off[kk], end = c.off[kk + 1]; q < end; q++) {
    const i = c.ids[q], j = i === 0 ? n - 1 : i - 1, a = p[i], b = p[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
};
export const probeRect = (ctx: Ctx, env: Env, x: number, y: number, w: number, h: number, label: string, kind: ProbeRec["kind"] = "box") => {
  const p = (globalThis as { __ANIDOODLE_PROBE__?: (r: ProbeRec) => void }).__ANIDOODLE_PROBE__;
  if (!p || !env.root || ctx.globalAlpha < 0.1) return;
  const m = ctx.getTransform(), pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
  p({ kind, label, x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) });
};

// ---------------------------------------------------------------- deterministic randomness
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const noiseCache = new Map<number, { perm: Uint16Array; gx: Float32Array; gy: Float32Array }>();
const table = (seed: number) => {
  let t = noiseCache.get(seed);
  if (!t) { const r = rng(seed * 7919 + 13), perm = new Uint16Array(512), gx = new Float32Array(256), gy = new Float32Array(256); const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); } t = { perm, gx, gy }; noiseCache.set(seed, t); }
  return t;
};
const noise2 = (seed: number, x: number, y: number, px = 0, py = 0): number => {
  const { perm, gx, gy } = table(seed);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const w = (v: number, p: number) => (p > 0 ? ((v % p) + p) % p : v) & 255;
  const g = (ix: number, iy: number, dx: number, dy: number) => { const h = perm[perm[w(ix, px)] + w(iy, py)]; return gx[h] * dx + gy[h] * dy; };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = g(x0, y0, fx, fy), b = g(x0 + 1, y0, fx - 1, fy), c = g(x0, y0 + 1, fx, fy - 1), d = g(x0 + 1, y0 + 1, fx - 1, fy - 1);
  return a + sx * (b - a) + sy * (c + sx * (d - c) - (a + sx * (b - a)));
};
export const fractal = (seed: number, x: number, y: number, fx: number, fy: number, oct: number, tile = 0): number => {
  if (activeCalibrating) return 0.5;
  let sum = 0, amp = 1, px = tile ? Math.max(1, Math.round(fx * tile)) : 0, py = tile ? Math.max(1, Math.round(fy * tile)) : 0;
  let kx = tile ? px / tile : fx, ky = tile ? py / tile : fy;
  for (let o = 0; o < oct; o++) { sum += noise2(seed + o * 101, x * kx, y * ky, px, py) * amp; amp *= 0.5; kx *= 2; ky *= 2; px *= 2; py *= 2; }
  return (sum + 1) / 2;
};
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- geometry (ported 1:1 from pencil.tsx)
export const jitter = (pts: P[], amt: number, seed: number): P[] => { if (amt <= 0) return pts; const r = rng(seed); return pts.map(([x, y]) => [x + (r() - 0.5) * 2 * amt, y + (r() - 0.5) * 2 * amt]); };
export const sample = (pts: P[], closed = false, per = 10): P[] => {
  if (pts.length < 2) return pts;
  const n = pts.length, at = (i: number): P => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]), out: P[] = [], segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) { const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]; for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t; out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); } }
  out.push(closed ? out[0] : pts[n - 1]);
  return out;
};
const densify = (s: P[], step: number): P[] => { const out: P[] = [s[0]]; for (let i = 1; i < s.length; i++) { const a = s[i - 1], b = s[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); } return out; };
const ribbon = (s0: P[], width: number, seed: number, taper: number, pressure: number, rough = 0): P[] => {
  const s = rough ? densify(s0, 1.5) : s0;
  const a = (seed % 17) * 0.37, b = (seed % 11) * 0.53, L: P[] = [], R: P[] = [], r = rng(seed * 31 + 7);
  for (let i = 0; i < s.length; i++) {
    const t = i / (s.length - 1), p = s[i], q = s[Math.min(s.length - 1, i + 1)], o = s[Math.max(0, i - 1)], dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy) || 1;
    const ends = Math.min(1, t / 0.14, (1 - t) / 0.2), tp = 1 - taper + taper * Math.pow(Math.max(0.04, ends), 0.7);
    const pr = Math.max(0.14, 1 - 0.26 * pressure + pressure * (0.3 * Math.sin(t * 5.5 + a) + 0.14 * Math.sin(t * 17 + b)));
    const w = (width * tp * pr) / 2, j1 = (r() - 0.5) * rough, j2 = (r() - 0.5) * rough;
    L.push([p[0] - (dy / len) * (w + j1), p[1] + (dx / len) * (w + j1)]); R.push([p[0] + (dy / len) * (w + j2), p[1] - (dx / len) * (w + j2)]);
  }
  return [...L, ...R.reverse()];
};

/**
 * Polyline decimation before spline/jitter allocation that strictly preserves:
 * 1. Endpoints (`0` and `n - 1`)
 * 2. Bounding-box extrema (`minX`, `maxX`, `minY`, `maxY`) so the stroke's silhouette bounds never shrink
 * 3. Sharp corner joins (`cos(angle) < 0.78`, i.e. turning angle > ~38 degrees) so polygon corners, arrows, and lettering stay crisp.
 */
const decimateControlPts = (pts: P[], targetPts: number): P[] => {
  const n = pts.length;
  if (n <= targetPts || targetPts < 2) return pts;
  const last = n - 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let iMinX = 0, iMaxX = 0, iMinY = 0, iMaxY = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    if (x < minX) { minX = x; iMinX = i; }
    if (x > maxX) { maxX = x; iMaxX = i; }
    if (y < minY) { minY = y; iMinY = i; }
    if (y > maxY) { maxY = y; iMaxY = i; }
  }
  const mustKeep = new Uint8Array(n);
  mustKeep[0] = 1;
  mustKeep[last] = 1;
  mustKeep[iMinX] = 1;
  mustKeep[iMaxX] = 1;
  mustKeep[iMinY] = 1;
  mustKeep[iMaxY] = 1;
  let keptCount = 0;
  for (let i = 0; i < n; i++) if (mustKeep[i]) keptCount++;

  // Also mark sharp corners if budget allows
  if (keptCount < targetPts) {
    for (let i = 1; i < last && keptCount < targetPts; i++) {
      if (mustKeep[i]) continue;
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu > 0.5 && lv > 0.5 && (ux * vx + uy * vy) / (lu * lv) < 0.78) {
        mustKeep[i] = 1;
        keptCount++;
      }
    }
  }

  // Fill remaining slots up to targetPts evenly across indices
  const span = targetPts - 1;
  for (let k = 1; k < span && keptCount < targetPts; k++) {
    const idx = Math.round((k * last) / span);
    if (!mustKeep[idx]) {
      mustKeep[idx] = 1;
      keptCount++;
    }
  }

  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    if (mustKeep[i]) out.push(pts[i]);
  }
  return out;
};

/** Single-pass chord-deviation polyline simplification before ribbon expansion, preserving endpoints and taper spacing. */
const simplifyCenterlineByTolerance = (pts: P[], tol: number, minPts: number): P[] => {
  const n = pts.length;
  if (tol <= 0 || n <= minPts || n <= 3) return pts;
  const maxSpan = Math.max(12, tol * 10);
  const out: P[] = [pts[0]];
  let ax = pts[0][0], ay = pts[0][1];
  for (let i = 1; i < n - 1; i++) {
    const px = pts[i][0], py = pts[i][1];
    const nx = pts[i + 1][0], ny = pts[i + 1][1];
    const vx = nx - ax, vy = ny - ay;
    const vLen2 = vx * vx + vy * vy;
    const dx = px - ax, dy = py - ay;
    const distFromAnchor = Math.hypot(dx, dy);
    let perp = 0;
    if (vLen2 > 1e-6) {
      perp = Math.abs(dx * vy - dy * vx) / Math.sqrt(vLen2);
    } else {
      perp = distFromAnchor;
    }
    const remainingIn = n - 1 - i;
    const neededForMin = minPts - 1 - out.length;
    if (perp >= tol || distFromAnchor >= maxSpan || remainingIn <= neededForMin) {
      out.push(pts[i]);
      ax = px;
      ay = py;
    }
  }
  out.push(pts[n - 1]);
  return out;
};

/** Bounded densify that never allocates more than maxCenterPts centerline points. */
const densifyBounded = (s: P[], step: number, maxCenterPts: number): P[] => {
  const n0 = s.length;
  if (n0 < 2 || step <= 0) return s;
  if (maxCenterPts > 0 && n0 >= maxCenterPts) {
    return n0 > maxCenterPts ? decimateControlPts(s, maxCenterPts) : s;
  }
  let totalLen = 0;
  for (let i = 1; i < n0; i++) {
    totalLen += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  }
  const extraAllowed = maxCenterPts > 0 ? Math.max(0, maxCenterPts - n0) : 1e9;
  const effStep = extraAllowed < 1e8 && extraAllowed > 0 ? Math.max(step, totalLen / extraAllowed) : step;
  if (extraAllowed <= 0) return s;
  const out: P[] = [s[0]];
  for (let i = 1; i < n0; i++) {
    const a = s[i - 1], b = s[i];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const remSegs = n0 - i;
    const room = maxCenterPts > 0 ? Math.max(1, maxCenterPts - out.length - remSegs + 1) : 1e9;
    const sub = Math.min(room, Math.max(1, Math.ceil(segLen / effStep)));
    for (let k = 1; k <= sub; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / sub, a[1] + ((b[1] - a[1]) * k) / sub]);
    }
  }
  return maxCenterPts > 0 && out.length > maxCenterPts ? decimateControlPts(out, maxCenterPts) : out;
};

/** Pre-allocated single-pass draft ribbon builder with bounded centerline count. */
const ribbonDraft = (
  s0: P[],
  width: number,
  seed: number,
  taper: number,
  pressure: number,
  rough: number,
  densifyStep: number,
  maxCenterPts: number
): { poly: P[]; centerPts: number } => {
  const s = rough > 0 && densifyStep > 0 ? densifyBounded(s0, densifyStep, maxCenterPts) : (maxCenterPts > 0 && s0.length > maxCenterPts ? decimateControlPts(s0, maxCenterPts) : s0);
  const n = s.length;
  if (n < 2) return { poly: s, centerPts: n };
  const a = (seed % 17) * 0.37, b = (seed % 11) * 0.53, r = rng(seed * 31 + 7);
  const out = new Array<P>(n * 2);
  const invN = 1 / (n - 1);
  for (let i = 0; i < n; i++) {
    const t = i * invN, p = s[i], q = s[i + 1 < n ? i + 1 : n - 1], o = s[i > 0 ? i - 1 : 0];
    const dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy) || 1;
    const ends = Math.min(1, t / 0.14, (1 - t) / 0.2), tp = 1 - taper + taper * Math.pow(Math.max(0.04, ends), 0.7);
    const pr = Math.max(0.14, 1 - 0.26 * pressure + pressure * (0.3 * Math.sin(t * 5.5 + a) + 0.14 * Math.sin(t * 17 + b)));
    const w = (width * tp * pr) / 2, j1 = (r() - 0.5) * rough, j2 = (r() - 0.5) * rough;
    const nx = -dy / len, ny = dx / len;
    out[i] = [p[0] + nx * (w + j1), p[1] + ny * (w + j1)];
    out[2 * n - 1 - i] = [p[0] - nx * (w + j2), p[1] - ny * (w + j2)];
  }
  return { poly: out, centerPts: n };
};

/** Fast O(ctrl.length) analytic estimator of full-quality Gfx.pen centerline & ribbon vertices before geometry construction. */
export const estimateFullPenStroke = (
  ctrl: P[],
  wobbleAmt: number,
  boilAmt: number,
  rough: number,
  progress: number,
  wantsRetrace: boolean
): { arcLen: number; fullMainCenterPts: number; fullRetraceCenterPts: number; fullRibbonVertices: number } => {
  const nCtrl = ctrl.length;
  if (nCtrl < 2 || progress <= 0) {
    return { arcLen: 0, fullMainCenterPts: 0, fullRetraceCenterPts: 0, fullRibbonVertices: 0 };
  }
  let arcLen = 0;
  let fullMainSub = 0;
  let fullRetSub = 0;
  const jitMain = 0.65 * (wobbleAmt + boilAmt);
  const jitRet = 0.65 * (wobbleAmt + boilAmt + 1.3 * wobbleAmt);
  for (let i = 1; i < nCtrl; i++) {
    const d = Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]);
    arcLen += d;
    if (rough > 0) {
      const subLenMain = Math.hypot(d / 10, jitMain);
      fullMainSub += 10 * Math.max(1, Math.ceil(subLenMain / 1.5));
      if (wantsRetrace) {
        const subLenRet = Math.hypot(d / 10, jitRet);
        fullRetSub += 10 * Math.max(1, Math.ceil(subLenRet / 1.5));
      }
    } else {
      fullMainSub += 10;
      if (wantsRetrace) fullRetSub += 10;
    }
  }
  const fullMainCenterPts = Math.max(2, Math.round(fullMainSub * progress) + 1);
  const fullRetraceCenterPts = wantsRetrace ? Math.max(2, Math.round(fullRetSub * progress) + 1) : 0;
  const fullRibbonVertices = 2 * (fullMainCenterPts + fullRetraceCenterPts);
  return { arcLen, fullMainCenterPts, fullRetraceCenterPts, fullRibbonVertices };
};

/** Computes the unbudgeted base-draft centerline target for a stroke given the profile's fixed density levers. */
const computeBaseDraftCenterPts = (
  estFullMainCenterPts: number,
  q: Readonly<RenderQualitySpec>,
  ribbonMult: number,
  minCenterFloor: number
): number => {
  let centerPts = estFullMainCenterPts;
  if (q.maxStrokeVertices > 0) {
    centerPts = Math.min(centerPts, Math.floor(q.maxStrokeVertices / ribbonMult));
  }
  if (q.penSamplePer < 10 || Math.abs(q.penDensifyStep - 1.5) > 1e-6) {
    const sampleRatio = q.penSamplePer / 10;
    const densifyRatio = q.penDensifyStep > 0 ? 1.5 / q.penDensifyStep : sampleRatio;
    const densityFactor = Math.min(sampleRatio, densifyRatio);
    const densityCenter = Math.max(2, Math.round((estFullMainCenterPts - 1) * densityFactor) + 1);
    centerPts = Math.min(centerPts, densityCenter);
  }
  return Math.max(Math.min(estFullMainCenterPts, minCenterFloor), centerPts);
};

export const oval = (cx: number, cy: number, rx: number, ry = rx, n = 10, a0 = -1.9): P[] => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as P; });
export const softBox = (cx: number, cy: number, w: number, h: number, e = 3.2, n = 16): P[] => Array.from({ length: n }, (_, i) => { const a = -2.2 + (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), k = 1 / (Math.abs(c) ** e + Math.abs(s) ** e) ** (1 / e); return [cx + (c * k * w) / 2, cy + (s * k * h) / 2] as P; });
export const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 6): P[] => Array.from({ length: n }, (_, i) => { const a = a0 + (i / (n - 1)) * (a1 - a0); return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as P; });
export const line = (a: P, b: P, bow = 0): P[] => { const nx = -(b[1] - a[1]), ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1; return [a, [(a[0] + b[0]) / 2 + (nx / l) * bow, (a[1] + b[1]) / 2 + (ny / l) * bow], b]; };
export const turn = (pts: P[], cx: number, cy: number, deg: number): P[] => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); };
export const poly = (corners: P[], per = 3): P[] => corners.flatMap((a, i) => { const b = corners[(i + 1) % corners.length]; return Array.from({ length: per }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per] as P); });
export const heart = (cx: number, cy: number, s: number): P[] => Array.from({ length: 14 }, (_, i) => { const t = (i / 14) * Math.PI * 2; return [cx + s * Math.sin(t) ** 3, cy - (s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 16] as P; });
export const tube = (centre: P[], r0: number, r1 = r0, cap = true): P[] => {
  const c = sample(centre, false, 5), L: P[] = [], R: P[] = [];
  c.forEach((p, i) => { const q = c[Math.min(c.length - 1, i + 1)], o = c[Math.max(0, i - 1)], dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy) || 1, r = r0 + ((r1 - r0) * i) / (c.length - 1); L.push([p[0] - (dy / len) * r, p[1] + (dx / len) * r]); R.push([p[0] + (dy / len) * r, p[1] - (dx / len) * r]); });
  const e = c[c.length - 1], e0 = c[c.length - 2], ex = e[0] - e0[0], ey = e[1] - e0[1], el = Math.hypot(ex, ey) || 1, tip: P[] = cap ? [[e[0] + (ex / el) * r1, e[1] + (ey / el) * r1]] : [], thin = (a: P[]) => a.filter((_, i) => i % 3 === 0 || i === a.length - 1);
  return [...thin(L), ...tip, ...thin(R).reverse()];
};
const bbox = (s: P[]) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; s.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; };
const scaled = (s: P[], k: number, dx = 0, dy = 0): P[] => { const b = bbox(s); return s.map(([x, y]) => [b.cx + (x - b.cx) * k + dx, b.cy + (y - b.cy) * k + dy]); };
export const displace = (pts: P[], amp: number, freq: number, oct: number, seed: number): P[] => pts.map(([x, y]) => [x + (fractal(seed, x, y, freq, freq, oct) - 0.5) * amp, y + (fractal(seed + 50, x, y, freq, freq, oct) - 0.5) * amp]);
export const halftone = (b: { x0: number; y0: number; x1: number; y1: number }, pitch: number, angleDeg: number, tone: (x: number, y: number) => number): [number, number, number][] => {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + pitch, out: [number, number, number][] = [];
  for (let u = -R; u <= R; u += pitch) for (let v = -R; v <= R; v += pitch) { const x = cx + u * c - v * sn, y = cy + u * sn + v * c; if (x < b.x0 - pitch || x > b.x1 + pitch || y < b.y0 - pitch || y > b.y1 + pitch) continue; const t = clamp(tone(x, y)); if (t < 0.03) continue; out.push([x, y, pitch * 0.72 * Math.sqrt(t)]); }
  return out;
};

// ---------------------------------------------------------------- texture tiles
const TILE = 512;
type TileSpec = { fx: number; fy?: number; oct: number; seed: number; k?: number; o?: number; gray?: boolean };
export const TILES: Record<string, TileSpec> = {
  pencilTooth: { fx: 1.3, oct: 1, seed: 8, k: -2.0, o: 2.05 },
  washGran: { fx: 0.09, oct: 2, seed: 11, k: -0.45, o: 1.2 },
  risoSpeck: { fx: 1.15, oct: 2, seed: 18, k: -3.0, o: 2.35 },
  risoMottle: { fx: 0.012, fy: 0.05, oct: 3, seed: 22, k: -0.9, o: 1.38 },
  paper: { fx: 0.75, oct: 3, seed: 21, gray: true },
  coldpress: { fx: 0.16, oct: 4, seed: 23, gray: true },
  draftTooth: { fx: 0.95, oct: 2, seed: 33, k: -1.7, o: 1.95 },
  blueMottle: { fx: 0.0065, oct: 4, seed: 37, gray: true },
};
const tile = (env: Env, kind: string): Layer => {
  const q = activeRenderQuality;
  const step = q.mode === "draft" ? Math.max(1, q.surfaceSampleFactor) : 1;
  const key = step > 1 ? `tile:${kind}:${env.scale}:s${step}` : `tile:${kind}:${env.scale}`;
  let L = env.cache.get(key) as Layer | undefined;
  if (L) {
    if (step > 1) recordKitMaterialReduction(1);
    return L;
  }
  const sp = TILES[kind], n = Math.round(TILE * env.scale); L = env.canvas(n, n);
  const img = L.ctx.createImageData(n, n), d = img.data;
  if (step <= 1) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const lx = x / env.scale, ly = y / env.scale, i = (y * n + x) * 4, v = fractal(sp.seed, lx, ly, sp.fx, sp.fy ?? sp.fx, sp.oct, TILE);
      if (sp.gray) { const lin = clamp((v + fractal(sp.seed + 7, lx, ly, sp.fx, sp.fy ?? sp.fx, sp.oct, TILE)) / 2), g = 255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055); d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255; }
      else { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255 * clamp(sp.k! * v + sp.o!); }
    }
  } else {
    for (let y = 0; y < n; y += step) for (let x = 0; x < n; x += step) {
      const lx = x / env.scale, ly = y / env.scale, v = fractal(sp.seed, lx, ly, sp.fx, sp.fy ?? sp.fx, sp.oct, TILE);
      let r0 = 0, a0 = 255;
      if (sp.gray) { const lin = clamp((v + fractal(sp.seed + 7, lx, ly, sp.fx, sp.fy ?? sp.fx, sp.oct, TILE)) / 2); r0 = 255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055); }
      else { a0 = 255 * clamp(sp.k! * v + sp.o!); }
      for (let dy = 0; dy < step && y + dy < n; dy++) for (let dx = 0; dx < step && x + dx < n; dx++) {
        const i = ((y + dy) * n + (x + dx)) * 4;
        d[i] = d[i + 1] = d[i + 2] = r0; d[i + 3] = a0;
      }
    }
    recordKitMaterialReduction(1);
  }
  L.ctx.putImageData(img, 0, 0); env.cache.set(key, L);
  return L;
};

// ---------------------------------------------------------------- the drawing surface
export type Medium = { nib: number; taper: number; pressure: number; retrace: boolean; wobble: number; rough: number };
export const PENCIL: Medium = { nib: 1.45, taper: 1, pressure: 1, retrace: true, wobble: 1, rough: 1.15 };
export const RISOLINE: Medium = { nib: 1.7, taper: 0.5, pressure: 0.5, retrace: false, wobble: 1.6, rough: 0.9 };
export const GRAPHITE = "#3d3437";
export const TINT = { white: "#fffaf3", blush: "#f2899c", rose: "#e9a3ad", butter: "#f3d577", sky: "#a9c8e6", denim: "#6f93c4", sage: "#a9cfa6", lilac: "#c7b3e0", peach: "#f5b98a", glow: "#ffe9a3" };
type PenOpts = { w?: number; color?: string; seed?: number; closed?: boolean; wobble?: number; boil?: number; taper?: number; opacity?: number; retrace?: boolean; progress?: number };

export type Rect = [number, number, number, number];
type Tracked = Layer & { dirty?: Rect | null };

export class Gfx {
  main: Ctx;
  env: Env;
  frame: number;
  medium: Medium;
  drawn: Rect | null = null;
  cur: Ctx; private pool: Tracked[] = []; private stack: [number, number, number, number][] = [[0, 0, 1, 0]]; private box: Rect | null = null;
  constructor(main: Ctx, env: Env, frame: number, medium: Medium) {
    this.main = main;
    this.env = env;
    this.frame = frame;
    this.medium = medium;
    const ad = getAdapt();
    if (ad) this.stack = [[ad.tx, ad.ty, ad.s, 0]];
    this.cur = main; this.base(main);
    const key = `pool:${Math.round(env.W * env.scale)}x${Math.round(env.H * env.scale)}`; let pool = env.cache.get(key) as Tracked[] | undefined; if (!pool) { pool = []; env.cache.set(key, pool); } this.pool = pool;
  }
  private get m() { return this.stack[this.stack.length - 1]; }
  private get DW() { return Math.round(this.env.W * this.env.scale); }
  private get DH() { return Math.round(this.env.H * this.env.scale); }
  private base(c: Ctx) { const [x, y, s, r] = this.m, k = this.env.scale; if (r === 0) { c.setTransform(k * s, 0, 0, k * s, k * x, k * y); return; } const co = Math.cos(r), si = Math.sin(r); c.setTransform(k * s * co, k * s * si, -k * s * si, k * s * co, k * x, k * y); }
  private dev(c: Ctx) { c.setTransform(1, 0, 0, 1, 0, 0); }
  private clip(r: Rect, pad = 0): Rect { return [Math.max(0, Math.floor(r[0] - pad)), Math.max(0, Math.floor(r[1] - pad)), Math.min(this.DW, Math.ceil(r[2] + pad)), Math.min(this.DH, Math.ceil(r[3] + pad))]; }
  private join(a: Rect | null, b: Rect): Rect { return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b; }
  private boxOf(pts: P[], pad: number): Rect { const [tx, ty, s, r] = this.m, k = this.env.scale; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } x0 -= pad; y0 -= pad; x1 += pad; y1 += pad; if (r === 0) return this.clip([k * (tx + x0 * s), k * (ty + y0 * s), k * (tx + x1 * s), k * (ty + y1 * s)]); const co = Math.cos(r), si = Math.sin(r), cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]; let a0 = 1e9, b0 = 1e9, a1 = -1e9, b1 = -1e9; for (const [x, y] of cs) { const ax = k * (tx + s * (co * x - si * y)), by = k * (ty + s * (si * x + co * y)); if (ax < a0) a0 = ax; if (by < b0) b0 = by; if (ax > a1) a1 = ax; if (by > b1) b1 = by; } return this.clip([a0, b0, a1, b1]); }
  mark(pts: P[], pad = 4) { this.box = this.join(this.box, this.boxOf(pts, pad)); }
  touch(x0: number, y0: number, x1: number, y1: number) { this.mark([[x0, y0], [x1, y1]], 0); }
  layer(): Tracked { let L = this.pool.pop(); if (!L) { L = this.env.canvas(this.DW, this.DH) as Tracked; L.dirty = null; } this.dev(L.ctx); L.ctx.globalCompositeOperation = "source-over"; L.ctx.globalAlpha = 1; if (L.dirty) { const d = L.dirty; L.ctx.clearRect(d[0], d[1], d[2] - d[0], d[3] - d[1]); L.dirty = null; } return L; }
  release(L: Tracked, dirty: Rect | null) { L.dirty = dirty ? this.join(L.dirty ?? null, dirty) : L.dirty; this.pool.push(L); }
  push(x: number, y: number, s: number, r = 0) { const [px, py, ps, pr] = this.m; if (pr === 0) { this.stack.push([px + x * ps, py + y * ps, ps * s, r]); this.base(this.cur); return; } const co = Math.cos(pr), si = Math.sin(pr); this.stack.push([px + ps * (co * x - si * y), py + ps * (si * x + co * y), ps * s, pr + r]); this.base(this.cur); }
  pop() { this.stack.pop(); this.base(this.cur); }

  path(c: Ctx, pts: P[]) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
  soften(L: Tracked, radius: number, r: Rect): Rect {
    const rp = this.clip(r, radius * this.env.scale * 3), steps = Math.max(1, Math.round(Math.log2(Math.max(2, radius * this.env.scale * 1.6)))), T = this.layer(), U = this.layer();
    let w = rp[2] - rp[0], h = rp[3] - rp[1]; if (w < 2 || h < 2) { this.release(T, null); this.release(U, null); return rp; }
    const sizes: [number, number][] = [[w, h]]; let src: Tracked = L, sx = rp[0], sy = rp[1], a = T, b = U;
    for (let i = 0; i < steps; i++) { const nw = Math.max(1, Math.ceil(w / 2)), nh = Math.max(1, Math.ceil(h / 2)); a.ctx.clearRect(0, 0, nw + 1, nh + 1); a.ctx.imageSmoothingEnabled = true; a.ctx.drawImage(src.canvas as CanvasImageSource, sx, sy, w, h, 0, 0, nw, nh); sizes.push([nw, nh]); src = a; sx = 0; sy = 0; w = nw; h = nh; [a, b] = [b, a]; }
    for (let i = steps - 1; i >= 1; i--) { const [dw, dh] = sizes[i]; a.ctx.clearRect(0, 0, dw + 1, dh + 1); a.ctx.drawImage(src.canvas as CanvasImageSource, 0, 0, w, h, 0, 0, dw, dh); src = a; w = dw; h = dh; [a, b] = [b, a]; }
    this.dev(L.ctx); L.ctx.clearRect(rp[0], rp[1], rp[2] - rp[0], rp[3] - rp[1]); L.ctx.imageSmoothingEnabled = true; L.ctx.drawImage(src.canvas as CanvasImageSource, 0, 0, w, h, rp[0], rp[1], rp[2] - rp[0], rp[3] - rp[1]);
    const used: Rect = [0, 0, sizes[1][0] + 1, sizes[1][1] + 1]; this.release(T, used); this.release(U, used);
    return rp;
  }
  tooth(L: Tracked, kind: string, r: Rect, texK = 1) { const c = L.ctx, t = tile(this.env, kind); c.save(); c.setTransform(texK, 0, 0, texK, 0, 0); c.globalCompositeOperation = "destination-in"; c.fillStyle = c.createPattern(t.canvas as CanvasImageSource, "repeat")!; c.beginPath(); c.rect(r[0] / texK, r[1] / texK, (r[2] - r[0]) / texK, (r[3] - r[1]) / texK); c.clip(); c.fillRect(r[0] / texK - 1, r[1] / texK - 1, (r[2] - r[0]) / texK + 2, (r[3] - r[1]) / texK + 2); c.restore(); }
  group(kind: "ink" | "paint" | "plain", fn: () => void, opts: { blend?: GlobalCompositeOperation; alpha?: number; off?: P; textures?: string[]; blur?: number } = {}) {
    if (activeCalibrating) { fn(); return; }
    const L = this.layer(), prev = this.cur, outer = this.box; this.cur = L.ctx; this.box = null; this.base(L.ctx); fn(); this.cur = prev; if (prev !== this.main) this.base(prev);
    let r: Rect = this.box ?? [0, 0, this.DW, this.DH]; this.box = outer; const k = this.m[2];
    if (kind === "paint") { r = this.soften(L, 0.9 * k, r); this.tooth(L, "washGran", r, k); }
    if (kind === "ink") this.tooth(L, "pencilTooth", r, k);
    if (opts.blur) r = this.soften(L, opts.blur, r);
    (opts.textures ?? []).forEach((t) => this.tooth(L, t, r));
    const m = this.main, w = r[2] - r[0], h = r[3] - r[1];
    if (w > 0 && h > 0) { const ox = Math.round((opts.off?.[0] ?? 0) * this.env.scale), oy = Math.round((opts.off?.[1] ?? 0) * this.env.scale); this.drawn = this.join(this.drawn, this.clip([r[0] + ox, r[1] + oy, r[2] + ox, r[3] + oy])); }
    if (w > 0 && h > 0) { m.save(); this.dev(m); m.globalCompositeOperation = opts.blend ?? "source-over"; m.globalAlpha = opts.alpha ?? 1; m.drawImage(L.canvas as CanvasImageSource, r[0], r[1], w, h, r[0] + Math.round((opts.off?.[0] ?? 0) * this.env.scale), r[1] + Math.round((opts.off?.[1] ?? 0) * this.env.scale), w, h); m.restore(); }
    this.release(L, r);
  }

  inkGroup(fn: () => void, o: { blur?: number; alpha?: number; textures?: string[] } = {}) {
    if (activeCalibrating) { fn(); return; }
    const L = this.layer(), prev = this.cur, outer = this.box; this.cur = L.ctx; this.box = null; this.base(L.ctx); fn(); this.cur = prev; if (prev !== this.main) this.base(prev);
    const r: Rect = this.box ?? [0, 0, this.DW, this.DH]; this.box = outer;
    const w = r[2] - r[0], h = r[3] - r[1]; if (w <= 0 || h <= 0) { this.release(L, r); return; }
    const H = this.layer(), pad = this.clip(r, (o.blur ?? 1.8) * this.env.scale * 3);
    this.dev(H.ctx); H.ctx.drawImage(L.canvas as CanvasImageSource, r[0], r[1], w, h, r[0], r[1], w, h);
    const rh = this.soften(H, o.blur ?? 1.8, r);
    (o.textures ?? ["draftTooth"]).forEach((t) => this.tooth(L, t, r));
    this.drawn = this.join(this.drawn, this.join(rh, r));
    const m = this.main; m.save(); this.dev(m); m.globalCompositeOperation = "source-over";
    m.globalAlpha = o.alpha ?? 0.28; m.drawImage(H.canvas as CanvasImageSource, rh[0], rh[1], rh[2] - rh[0], rh[3] - rh[1], rh[0], rh[1], rh[2] - rh[0], rh[3] - rh[1]);
    m.globalAlpha = 1; m.drawImage(L.canvas as CanvasImageSource, r[0], r[1], w, h, r[0], r[1], w, h); m.restore(); this.base(m);
    this.release(L, r); this.release(H, pad);
  }

  private upTo(s: P[], progress: number): P[] {
    if (progress >= 1) return s; const n = (s.length - 1) * progress, i = Math.floor(n), f = n - i;
    const head = s.slice(0, i + 1); if (f > 1e-9 && i + 1 < s.length) head.push([s[i][0] + (s[i + 1][0] - s[i][0]) * f, s[i][1] + (s[i + 1][1] - s[i][1]) * f]);
    return head.length > 1 ? head : s.slice(0, 2);
  }

  pen(pts: P[], o: PenOpts = {}) {
    const { w = 3.4, color = GRAPHITE, seed = 1, closed = false, wobble = 1.1, boil = 0.55, taper = 1, opacity = 0.96, retrace = true, progress = 1 } = o, M = this.medium, b = Math.floor(this.frame / 4), c = this.cur;
    if (progress <= 0 || pts.length < 2) return;
    const ctrl = closed ? [...pts, pts[0], pts[1]] : pts;
    const wantsRetrace = Boolean(retrace && M.retrace);
    const q = activeRenderQuality;

    if (activeCalibrating) {
      const est = estimateFullPenStroke(ctrl, wobble * M.wobble, boil, M.rough, progress, wantsRetrace);
      const isLoop = closed || (pts.length >= 6 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 4);
      const doRetrace = wantsRetrace && q.penRetraceMode !== "skip";
      const ribbonMult = !doRetrace ? 2 : q.penRetraceMode === "simplified" ? 3 : 4;
      const baseMinCenter = q.minStrokeCenterPts > 0 ? q.minStrokeCenterPts : isLoop ? 8 : Math.min(est.fullMainCenterPts, 4);
      const baseDraftCenter = computeBaseDraftCenterPts(est.fullMainCenterPts, q, ribbonMult, baseMinCenter);
      currentFrameStats.penCalls++;
      currentFrameStats.penPrimaryRibbons++;
      if (wantsRetrace) currentFrameStats.penRetraceRibbons++;
      currentFrameStats.penTotalRibbons = currentFrameStats.penPrimaryRibbons + currentFrameStats.penRetraceRibbons;
      currentFrameStats.penInputVertices += pts.length;
      currentFrameStats.penCenterlinePts += est.fullMainCenterPts + est.fullRetraceCenterPts;
      currentFrameStats.penPrimaryVertices += est.fullMainCenterPts * 2;
      currentFrameStats.penRetraceVertices += est.fullRetraceCenterPts * 2;
      currentFrameStats.penRibbonVertices += est.fullRibbonVertices;
      currentFrameStats.baseDraftPenVertices += baseDraftCenter * ribbonMult;
      refreshOptimizationSummary(currentFrameStats);
      return;
    }

    if (q.mode === "full") {
      // Unmodified full-quality path: byte-for-byte identical to baseline
      const basePts = jitter(ctrl, wobble * M.wobble, seed), W = w * M.nib;
      const main = ribbon(this.upTo(sample(jitter(basePts, boil, seed * 911 + b)), progress), W, seed, taper * M.taper, M.pressure, M.rough); this.mark(main, 2);
      c.fillStyle = color; c.globalAlpha = opacity; this.path(c, main); c.fill();
      let reVerts = 0;
      if (wantsRetrace) {
        const re = ribbon(this.upTo(sample(jitter(basePts, boil + 1.3 * M.wobble, seed * 577 + b)), progress), W * 0.5, seed + 5, 1, M.pressure, M.rough);
        reVerts = re.length;
        this.mark(re, 2); c.globalAlpha = opacity * 0.4; this.path(c, re); c.fill();
      }
      c.globalAlpha = 1;
      currentFrameStats.penCalls++;
      currentFrameStats.penPrimaryRibbons++;
      if (wantsRetrace) currentFrameStats.penRetraceRibbons++;
      currentFrameStats.penTotalRibbons = currentFrameStats.penPrimaryRibbons + currentFrameStats.penRetraceRibbons;
      currentFrameStats.penInputVertices += pts.length;
      currentFrameStats.penPrimaryVertices += main.length;
      currentFrameStats.penRetraceVertices += reVerts;
      currentFrameStats.penRibbonVertices += main.length + reVerts;
      currentFrameStats.penCenterlinePts += (main.length + reVerts) >> 1;
      currentFrameStats.totalPolygonsDrawn = currentFrameStats.penTotalRibbons + currentFrameStats.otherPolygonCount;
      currentFrameStats.totalSceneVertices = currentFrameStats.penRibbonVertices + currentFrameStats.otherPathVertices;
      refreshOptimizationSummary(currentFrameStats);
      return;
    }

    // Quality-aware draft Gfx.pen path: budgets BEFORE allocating spline/densify/ribbon geometry.
    const cal = this.env.penCalibration;
    const est = estimateFullPenStroke(ctrl, wobble * M.wobble, boil, M.rough, progress, wantsRetrace);
    const nCtrl = ctrl.length;
    const nSegs = Math.max(1, nCtrl - 1);
    const isLoop = closed || (pts.length >= 6 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 4);

    const effRetraceMode: PenRetraceMode = cal ? cal.effectiveRetraceMode : q.penRetraceMode;
    const doRetrace = wantsRetrace && effRetraceMode !== "skip";
    const ribbonMult = !doRetrace ? 2 : effRetraceMode === "simplified" ? 3 : 4;

    const minCenterFloor = cal
      ? (isLoop ? cal.effectiveMinCenterPtsClosed : Math.min(est.fullMainCenterPts, cal.effectiveMinCenterPtsOpen))
      : q.minStrokeCenterPts > 0
        ? q.minStrokeCenterPts
        : isLoop
          ? 8
          : Math.min(est.fullMainCenterPts, 4);

    const baseDraftCenterPts = computeBaseDraftCenterPts(est.fullMainCenterPts, q, ribbonMult, minCenterFloor);
    let maxMainCenterPts = baseDraftCenterPts;

    const targetB = q.draftTargetVerticesPerFrame;
    if (targetB > 0 && cal) {
      const dynRatio = cal.effectiveScaleRatio * (q.budgetPolicy === "adaptive-hysteresis" ? cal.adaptiveScale : 1);
      const strokeAllowedVerts = Math.round(est.fullRibbonVertices * dynRatio);
      const budgetMainCenter = Math.floor(strokeAllowedVerts / ribbonMult);
      maxMainCenterPts = Math.min(maxMainCenterPts, budgetMainCenter);

      // When the configured target budget is tighter than the base draft profile's total vertices (e.g. 6,000 on Scene 3),
      // scale the base-draft centerline allocation proportionally by `cal.baseDraftScaleRatio`.
      if (cal.baseDraftScaleRatio < 1) {
        const scaledBaseCenter = Math.floor(baseDraftCenterPts * cal.baseDraftScaleRatio);
        maxMainCenterPts = Math.min(maxMainCenterPts, scaledBaseCenter);
      }
    }

    const targetMainCenterPts = Math.max(Math.min(est.fullMainCenterPts, minCenterFloor), maxMainCenterPts);

    const isToleranceOnlyAblation =
      q.penOutlineTolerance > 0 &&
      q.penSamplePer === 10 &&
      Math.abs(q.penDensifyStep - 1.5) < 1e-6 &&
      targetB === 0 &&
      q.maxStrokeVertices === 0;

    const W = w * M.nib;
    let mainPoly: P[];
    let mainCenterCount: number;
    let basePtsForRetrace: P[];
    let perForRetrace: number;

    if (isToleranceOnlyAblation) {
      const basePts = jitter(ctrl, wobble * M.wobble, seed);
      basePtsForRetrace = basePts;
      perForRetrace = 10;
      const sRaw = this.upTo(sample(jitter(basePts, boil, seed * 911 + b), false, 10), progress);
      const sDense = M.rough > 0 ? densify(sRaw, 1.5) : sRaw;
      const sSimp = simplifyCenterlineByTolerance(sDense, q.penOutlineTolerance, minCenterFloor);
      const built = ribbonDraft(sSimp, W, seed, taper * M.taper, M.pressure, M.rough, 0, 0);
      mainPoly = built.poly;
      mainCenterCount = built.centerPts;
    } else {
      const perUse = Math.max(
        1,
        Math.min(
          q.penSamplePer,
          Math.floor((targetMainCenterPts - 1) / Math.max(1, Math.min(nSegs, isLoop ? 8 : 2)))
        )
      );
      const ctrlTarget = Math.max(
        isLoop ? Math.min(6, targetMainCenterPts) : 2,
        Math.min(nCtrl, Math.ceil((targetMainCenterPts - 1) / perUse) + 1)
      );
      const ctrlSub = ctrlTarget < nCtrl ? decimateControlPts(ctrl, ctrlTarget) : ctrl;
      const wobbleScale = ctrlTarget < nCtrl ? Math.min(1, Math.sqrt(ctrlTarget / nCtrl)) : 1;
      const basePts = jitter(ctrlSub, wobble * M.wobble * wobbleScale, seed);
      basePtsForRetrace = basePts;
      perForRetrace = perUse;
      let sMain = this.upTo(sample(jitter(basePts, boil * wobbleScale, seed * 911 + b), false, perUse), progress);
      if (q.penOutlineTolerance > 0) {
        sMain = simplifyCenterlineByTolerance(sMain, q.penOutlineTolerance, minCenterFloor);
      }
      const built = ribbonDraft(sMain, W, seed, taper * M.taper, M.pressure, M.rough, q.penDensifyStep, targetMainCenterPts);
      mainPoly = built.poly;
      mainCenterCount = built.centerPts;
    }

    this.mark(mainPoly, 2);
    c.fillStyle = color;
    c.globalAlpha = !doRetrace && wantsRetrace ? Math.min(1, opacity * 1.03) : opacity;
    this.path(c, mainPoly);
    c.fill();

    let reVerts = 0;
    let reCenterCount = 0;
    if (doRetrace) {
      if (effRetraceMode === "simplified") {
        const reTargetCenter = Math.max(Math.min(est.fullRetraceCenterPts, isLoop ? 6 : 3), Math.ceil(targetMainCenterPts * 0.5));
        const rePer = Math.max(1, Math.min(3, perForRetrace >> 1 || 1));
        const reCtrl = basePtsForRetrace.length > reTargetCenter ? decimateControlPts(basePtsForRetrace, reTargetCenter) : basePtsForRetrace;
        let sRe = this.upTo(sample(jitter(reCtrl, (boil + 1.3 * M.wobble) * 0.5, seed * 577 + b), false, rePer), progress);
        if (q.penOutlineTolerance > 0) {
          sRe = simplifyCenterlineByTolerance(sRe, q.penOutlineTolerance * 1.5, isLoop ? 6 : 3);
        }
        const reBuilt = ribbonDraft(sRe, W * 0.5, seed + 5, 1, M.pressure, M.rough, 0, reTargetCenter);
        reVerts = reBuilt.poly.length;
        reCenterCount = reBuilt.centerPts;
        this.mark(reBuilt.poly, 2);
        c.globalAlpha = opacity * 0.4;
        this.path(c, reBuilt.poly);
        c.fill();
      } else {
        let sRe = this.upTo(sample(jitter(basePtsForRetrace, boil + 1.3 * M.wobble, seed * 577 + b), false, perForRetrace), progress);
        if (isToleranceOnlyAblation && M.rough > 0) {
          sRe = densify(sRe, 1.5);
        }
        if (q.penOutlineTolerance > 0) {
          sRe = simplifyCenterlineByTolerance(sRe, q.penOutlineTolerance, minCenterFloor);
        }
        const reBuilt = ribbonDraft(
          sRe,
          W * 0.5,
          seed + 5,
          1,
          M.pressure,
          M.rough,
          isToleranceOnlyAblation ? 0 : q.penDensifyStep,
          isToleranceOnlyAblation ? 0 : targetMainCenterPts
        );
        reVerts = reBuilt.poly.length;
        reCenterCount = reBuilt.centerPts;
        this.mark(reBuilt.poly, 2);
        c.globalAlpha = opacity * 0.4;
        this.path(c, reBuilt.poly);
        c.fill();
      }
    }
    c.globalAlpha = 1;

    currentFrameStats.penCalls++;
    currentFrameStats.penPrimaryRibbons++;
    if (doRetrace) currentFrameStats.penRetraceRibbons++;
    currentFrameStats.penTotalRibbons = currentFrameStats.penPrimaryRibbons + currentFrameStats.penRetraceRibbons;
    currentFrameStats.penInputVertices += pts.length;
    currentFrameStats.penPrimaryVertices += mainPoly.length;
    currentFrameStats.penRetraceVertices += reVerts;
    currentFrameStats.penRibbonVertices += mainPoly.length + reVerts;
    currentFrameStats.penCenterlinePts += mainCenterCount + reCenterCount;
    currentFrameStats.baseDraftPenVertices += baseDraftCenterPts * ribbonMult;
    currentFrameStats.totalPolygonsDrawn = currentFrameStats.penTotalRibbons + currentFrameStats.otherPolygonCount;
    currentFrameStats.totalSceneVertices = currentFrameStats.penRibbonVertices + currentFrameStats.otherPathVertices;
    if (cal) {
      currentFrameStats.calibratedPeakFullVertices = cal.peakFullVertices;
      currentFrameStats.calibratedPeakBaseDraftVertices = cal.peakBaseDraftVertices;
      currentFrameStats.effectiveScaleRatio = cal.effectiveScaleRatio * (q.budgetPolicy === "adaptive-hysteresis" ? cal.adaptiveScale : 1);
      currentFrameStats.baseDraftScaleRatio = cal.baseDraftScaleRatio;
      currentFrameStats.floorDegraded = cal.floorDegraded;
      currentFrameStats.budgetExceededByFloor =
        cal.budgetExceededByFloor || (targetB > 0 && currentFrameStats.penRibbonVertices > targetB * 1.05);
      currentFrameStats.adaptiveSwitches = cal.adaptiveSwitches;
    }
    refreshOptimizationSummary(currentFrameStats);
  }

  hatch(x: number, y: number, w: number, o: { n?: number; len?: number; angle?: number; color?: string; seed?: number; pw?: number; opacity?: number } = {}) {
    const { n = 8, len = 16, angle = -1.05, color = GRAPHITE, seed = 1, pw = 1.9, opacity = 0.55 } = o, r = rng(seed);
    for (let i = 0; i < n; i++) { const px = x + (w * i) / Math.max(1, n - 1) + (r() - 0.5) * 3, l = len * (0.7 + r() * 0.6), a = angle + (r() - 0.5) * 0.18; this.pen([[px, y], [px + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5], [px + Math.cos(a) * l, y + Math.sin(a) * l]], { w: pw, color, seed: seed + i, wobble: 0.6, opacity, retrace: false }); }
  }
  fill(pts0: P[], color: string, alpha = 1) { if (activeCalibrating) return; const pts = adaptPts(pts0), c = this.cur; this.mark(pts, 2); c.globalAlpha = alpha; c.fillStyle = color; this.path(c, pts); c.fill(); c.globalAlpha = 1; recordOtherPathStats(1, pts.length); }
  wash(pts0: P[], color: string, o: { alpha?: number; seed?: number; dx?: number; dy?: number; shrink?: number; rim?: boolean } = {}) {
    if (activeCalibrating) return;
    const pts = adaptPts(pts0), { alpha = 0.62, seed = 1, dx = 3, dy = 2, shrink = 0.94, rim = true } = o, c = this.cur;
    const s = displace(scaled(sample(jitter(pts, 2.2, seed), true, 8), shrink, dx, dy), 13, 0.022, 3, 5); this.mark(s, 5);
    c.globalAlpha = alpha; c.fillStyle = color; this.path(c, s); c.fill();
    if (rim) { c.globalAlpha = alpha * 0.55; c.strokeStyle = color; c.lineWidth = 3.5; c.lineJoin = "round"; c.stroke(); }
    c.globalAlpha = 1;
    recordOtherPathStats(1, s.length);
  }
  form(pts: P[], color: string, shade: string, o: { seed?: number; light?: P; alpha?: number; hi?: number[] } = {}) {
    if (activeCalibrating) return;
    const { seed = 1, light = [-8, -9], alpha = 0.98, hi } = o, s = displace(sample(jitter(pts, 1.2, seed), true, 8), 13, 0.022, 3, 5), k = this.m[2];
    const r = this.boxOf(s, 3); this.box = this.join(this.box, r);
    const T = this.layer(); this.base(T.ctx); T.ctx.fillStyle = shade; this.path(T.ctx, s); T.ctx.fill();
    const U = this.layer(); this.base(U.ctx); U.ctx.fillStyle = color; U.ctx.translate(light[0], light[1]); this.path(U.ctx, s); U.ctx.fill(); const ru = this.soften(U, 5 * k, this.boxOf(s.map(([x, y]) => [x + light[0], y + light[1]] as P), 2));
    const w = r[2] - r[0], h = r[3] - r[1];
    T.ctx.save(); this.base(T.ctx); this.path(T.ctx, s); T.ctx.clip(); this.dev(T.ctx); T.ctx.drawImage(U.canvas as CanvasImageSource, r[0], r[1], w, h, r[0], r[1], w, h); this.base(T.ctx); T.ctx.translate(light[0] * 2.2, light[1] * 2.2); T.ctx.fillStyle = color; this.path(T.ctx, s); T.ctx.fill();
    if (hi) { const V = this.layer(); this.base(V.ctx); V.ctx.fillStyle = "#ffffff"; V.ctx.globalAlpha = 0.75; V.ctx.beginPath(); V.ctx.ellipse(hi[0], hi[1], hi[2], hi[3], ((hi[4] ?? -30) * Math.PI) / 180, 0, Math.PI * 2); V.ctx.fill(); const m = Math.max(hi[2], hi[3]); const rv = this.soften(V, 5 * k, this.boxOf([[hi[0] - m, hi[1] - m], [hi[0] + m, hi[1] + m]], 1)); this.dev(T.ctx); T.ctx.drawImage(V.canvas as CanvasImageSource, rv[0], rv[1], rv[2] - rv[0], rv[3] - rv[1], rv[0], rv[1], rv[2] - rv[0], rv[3] - rv[1]); this.release(V, rv); }
    T.ctx.restore();
    const c = this.cur; c.save(); this.dev(c); c.globalAlpha = alpha; c.drawImage(T.canvas as CanvasImageSource, r[0], r[1], w, h, r[0], r[1], w, h); c.restore(); this.base(c);
    this.release(T, r); this.release(U, ru);
    recordOtherPathStats(3, s.length * 3);
  }
  glow(cx: number, cy: number, r: number, color: string, opacity: number) { if (activeCalibrating) return; const c = this.cur, g = c.createRadialGradient(cx, cy, 0, cx, cy, r * 1.7), a = (v: number) => Math.round(255 * clamp(v * opacity)).toString(16).padStart(2, "0"); [[0, 1], [0.35, 0.9], [0.6, 0.55], [0.8, 0.2], [1, 0]].forEach(([t, v]) => g.addColorStop(t, color + a(v))); this.touch(cx - r * 1.8, cy - r * 1.8, cx + r * 1.8, cy + r * 1.8); c.fillStyle = g; c.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4); }
  paper(kind: string, opacity: number) { if (activeCalibrating) return; const m = this.main, t = tile(this.env, kind); m.save(); this.dev(m); m.globalCompositeOperation = "multiply"; m.globalAlpha = opacity; m.fillStyle = m.createPattern(t.canvas as CanvasImageSource, "repeat")!; m.fillRect(0, 0, this.DW, this.DH); m.restore(); this.base(m); }
  vignette(edge: string) { if (activeCalibrating) return; const m = this.main, W = this.env.W, H = this.env.H; m.save(); this.base(m); m.translate(W / 2, H * 0.46); m.scale(1, H / W); const g = m.createRadialGradient(0, 0, 0, 0, 0, W * 0.72); g.addColorStop(0, "rgba(255,250,240,0.08)"); g.addColorStop(0.45, "rgba(255,250,240,0)"); g.addColorStop(1, edge); m.fillStyle = g; m.fillRect(-W, -H, W * 2, H * 2); m.restore(); }
}
