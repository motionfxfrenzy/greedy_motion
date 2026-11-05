import type { CheckOutcome } from "./api.ts";
import { parseGenFromBundleUrl } from "./api.ts";
import { isPlateLiveEnabled } from "./flag.ts";
import type { AspectRatio } from "./plate-player.ts";
import { environmentStatus, supportsWorkerHost, type EnvironmentProbeInput } from "./support.ts";
import type { PlayerDecision } from "./types.ts";

/**
 * Pure per-scene mode, check-once, clip-request, and workspace status mapping logic
 * for live plate scenes in `PlatePreview` (Phase 3c).
 */

export type LivePlateVariantState =
  | "queued"
  | "authoring"
  | "bundled"
  | "checked"
  | "rendering"
  | "drawn"
  | "failed";

export type LivePlateVariantView = {
  state: LivePlateVariantState;
  sig: string;
  v: string | null;
  stage?: string;
  error?: string;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  gen?: number;
};

export type LivePlateScene = {
  index: number;
  keyword: string;
  state: LivePlateVariantState;
  seconds: number;
  frames?: number;
  sig: string;
  rev?: number;
  gen?: number;
  error?: string;
  attempts?: number;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  variants?: Partial<Record<AspectRatio, LivePlateVariantView>>;
};

export type LivePlateStatus = {
  available: boolean;
  look: string | null;
  mode?: "live" | "clip";
  scenes: LivePlateScene[];
  comments: { id: string; at: number; scene: number; sceneAt: number; body: string }[];
  subtitles?: Record<string, unknown>;
  running: boolean;
  drawnAspects?: AspectRatio[];
  drawingAspects?: AspectRatio[];
};

export type ResolvedSceneVariant = {
  index: number;
  keyword: string;
  aspect: AspectRatio;
  state: LivePlateVariantState;
  sig: string;
  rev: number;
  gen: number;
  frames: number;
  seconds: number;
  variantId?: string;
  bundleDigest?: string | null;
  hasBundle: boolean;
  hasClip: boolean;
  clipVersion: string | null;
  stage?: string;
  error?: string;
};

/**
 * Resolves the variant fields for a scene in the currently viewed aspect ratio.
 */
export function resolveSceneVariant(
  scene: LivePlateScene,
  aspect: AspectRatio,
  primaryAspect: AspectRatio = "16:9"
): ResolvedSceneVariant {
  const view = scene.variants?.[aspect];
  const isPrimary = aspect === primaryAspect;
  const state: LivePlateVariantState = view?.state ?? (isPrimary ? scene.state : "queued");
  const variantId = view?.variantId ?? (isPrimary ? scene.variantId : undefined);
  const bundleDigest = view?.bundleDigest ?? (isPrimary ? scene.bundleDigest : null) ?? null;
  const clipVersion = view ? view.v : state === "drawn" && isPrimary ? "v1" : null;
  const rev = scene.rev ?? 0;
  const gen = view?.gen ?? scene.gen ?? rev + 1;
  const seconds = scene.seconds > 0 ? scene.seconds : 4;
  const frames = scene.frames && scene.frames > 0 ? scene.frames : Math.max(1, Math.round(seconds * 30));
  const hasBundle =
    Boolean(variantId) &&
    (state === "bundled" || state === "checked" || (state === "drawn" && Boolean(bundleDigest)));
  const hasClip = state === "drawn" || Boolean(clipVersion);

  return {
    index: scene.index,
    keyword: scene.keyword,
    aspect,
    state,
    sig: view?.sig ?? scene.sig,
    rev,
    gen: Math.max(1, gen),
    frames,
    seconds,
    variantId,
    bundleDigest,
    hasBundle,
    hasClip,
    clipVersion,
    stage: view?.stage,
    error: view?.error ?? (state === "failed" ? scene.error : undefined)
  };
}

/**
 * Enforces the check-once rule per `(variantId, gen, bundleDigest)` tuple.
 * A completed check (whether `ok`, `code`, or `env`) is never repeated for the same tuple;
 * a new revision (`gen + 1` or new `bundleDigest`) produces a distinct key and is checked once.
 */
export class CheckOnceTracker {
  private readonly inFlight = new Set<string>();
  private readonly completed = new Map<string, CheckOutcome>();

  static keyFor(variantId: string, gen: number, bundleDigest: string): string {
    return `${variantId}:${gen}:${bundleDigest}`;
  }

  hasInFlight(variantId: string, gen: number, bundleDigest: string): boolean {
    return this.inFlight.has(CheckOnceTracker.keyFor(variantId, gen, bundleDigest));
  }

  hasCompleted(variantId: string, gen: number, bundleDigest: string): boolean {
    return this.completed.has(CheckOnceTracker.keyFor(variantId, gen, bundleDigest));
  }

  getOutcome(variantId: string, gen: number, bundleDigest: string): CheckOutcome | undefined {
    return this.completed.get(CheckOnceTracker.keyFor(variantId, gen, bundleDigest));
  }

  shouldCheck(
    variantId: string | undefined,
    gen: number,
    bundleDigest: string | null | undefined,
    state: LivePlateVariantState = "bundled"
  ): boolean {
    if (state !== "bundled") return false;
    if (!variantId || !bundleDigest || !(gen >= 1)) return false;
    const key = CheckOnceTracker.keyFor(variantId, gen, bundleDigest);
    return !this.inFlight.has(key) && !this.completed.has(key);
  }

  begin(variantId: string, gen: number, bundleDigest: string): boolean {
    if (!variantId || !bundleDigest || !(gen >= 1)) return false;
    const key = CheckOnceTracker.keyFor(variantId, gen, bundleDigest);
    if (this.inFlight.has(key) || this.completed.has(key)) {
      return false;
    }
    this.inFlight.add(key);
    return true;
  }

  complete(variantId: string, gen: number, bundleDigest: string, outcome: CheckOutcome): void {
    const key = CheckOnceTracker.keyFor(variantId, gen, bundleDigest);
    this.inFlight.delete(key);
    this.completed.set(key, outcome);
  }

  failTransient(variantId: string, gen: number, bundleDigest: string): void {
    const key = CheckOnceTracker.keyFor(variantId, gen, bundleDigest);
    this.inFlight.delete(key);
  }

  clear(): void {
    this.inFlight.clear();
    this.completed.clear();
  }
}

export type ClipRequestState = "rendering" | "clip_cap";

/**
 * Deduplicates `requestClip` calls per `(variantId, bundleDigest)` and stores whether the clip
 * request was accepted (`202 rendering`) or hit the per-project cap (`429 clip_cap`).
 */
export class ClipRequestTracker {
  private readonly inFlight = new Set<string>();
  private readonly states = new Map<string, ClipRequestState>();

  static keyFor(variantId: string, bundleDigest?: string | null): string {
    return `${variantId}:${bundleDigest ?? "default"}`;
  }

  getState(variantId: string | undefined, bundleDigest?: string | null): ClipRequestState | null {
    if (!variantId) return null;
    return this.states.get(ClipRequestTracker.keyFor(variantId, bundleDigest)) ?? null;
  }

  shouldRequest(variantId: string | undefined, bundleDigest: string | null | undefined, hasClip: boolean): boolean {
    if (hasClip || !variantId) return false;
    const key = ClipRequestTracker.keyFor(variantId, bundleDigest);
    return !this.inFlight.has(key) && !this.states.has(key);
  }

  begin(variantId: string, bundleDigest?: string | null): boolean {
    if (!variantId) return false;
    const key = ClipRequestTracker.keyFor(variantId, bundleDigest);
    if (this.inFlight.has(key) || this.states.has(key)) return false;
    this.inFlight.add(key);
    return true;
  }

  complete(variantId: string, bundleDigest: string | null | undefined, state: ClipRequestState): void {
    const key = ClipRequestTracker.keyFor(variantId, bundleDigest);
    this.inFlight.delete(key);
    this.states.set(key, state);
  }

  failTransient(variantId: string, bundleDigest?: string | null): void {
    const key = ClipRequestTracker.keyFor(variantId, bundleDigest);
    this.inFlight.delete(key);
  }

  clear(): void {
    this.inFlight.clear();
    this.states.clear();
  }
}

export type SceneModeInput = {
  flagEnabled?: boolean;
  projectMode?: "live" | "clip" | null;
  variant: ResolvedSceneVariant;
  environment?: string | EnvironmentProbeInput;
  bundleLoaded?: boolean;
  playerReady?: boolean;
  playerDecision?: PlayerDecision | null;
  checkOutcome?: CheckOutcome | null;
  forcedClipReason?: string | null;
  clipRequestStatus?: ClipRequestState | null;
  isBuffering?: boolean;
  hasPendingComment?: boolean;
};

export type SceneModeResolution = {
  mode: "live" | "clip";
  reason: string;
  eligibleForLive: boolean;
  needsBundleFetch: boolean;
  needsCheck: boolean;
  needsClipRequest: boolean;
  /** Whether the scene counts as ready in the toolbar status chip ("n/5 ready") and Render button. */
  isReady: boolean;
  /** Whether the scene can be played/shown right now on stage. */
  isPlayable: boolean;
  /** State string passed to `WorkspaceSceneTab.state`. */
  tabState: string;
  /** Tooltip label passed to `WorkspaceSceneTab.stateLabel`. */
  tabLabel: string;
  /** CSS class override passed to `WorkspaceSceneTab.stateClassName`. */
  tabClassName: string;
  /** In-stage `.aw-wait` overlay config when this scene is the currently selected scene. */
  stageWait: { failed: boolean; title: string; detail?: string } | null;
  /** The scene is drawing frames ahead before it can play (phase 3f); it stays playable so the film can move into it and wait. */
  isPreparing?: boolean;
  /** Fraction (0..1) of the frames needed ahead that are drawn, while `isPreparing`. */
  preparingProgress?: number;
};

const CLIP_LABELS: Record<LivePlateVariantState, string> = {
  queued: "Waiting",
  authoring: "Writing the scene",
  bundled: "Checking",
  checked: "Ready",
  rendering: "Drawing",
  drawn: "Drawn",
  failed: "Failed"
};

/**
 * Decides per-scene `mode` (`"live"` vs `"clip"`), `reason`, check/clip-request triggers,
 * readiness, tab visual state, and stage overlay for a scene in the viewed aspect.
 */
export function decideSceneMode(input: SceneModeInput): SceneModeResolution {
  const flagOn = isPlateLiveEnabled(input.flagEnabled);
  const v = input.variant;

  // 1. Flag off or project not in live mode -> standard clip behavior.
  if (!flagOn || input.projectMode !== "live") {
    const isDrawn = v.state === "drawn";
    const isFailed = v.state === "failed";
    const label = CLIP_LABELS[v.state] ?? "Waiting";
    return {
      mode: "clip",
      reason: !flagOn ? "flag-off" : "project-clip-mode",
      eligibleForLive: false,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: isDrawn,
      isPlayable: isDrawn,
      tabState: v.state,
      tabLabel: label,
      tabClassName: v.state,
      stageWait: isDrawn
        ? null
        : isFailed
          ? { failed: true, title: "This scene didn't draw", detail: v.error }
          : { failed: false, title: `${label}…` }
    };
  }

  // 2. Live project, but variant is still queued / authoring or failed or rendering without a live bundle.
  if (v.state === "queued" || v.state === "authoring") {
    const label = CLIP_LABELS[v.state];
    return {
      mode: "clip",
      reason: `variant-${v.state}`,
      eligibleForLive: false,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: false,
      isPlayable: false,
      tabState: v.state,
      tabLabel: label,
      tabClassName: v.state,
      stageWait: { failed: false, title: `${label}…` }
    };
  }

  if (v.state === "failed") {
    return {
      mode: "clip",
      reason: "variant-failed",
      eligibleForLive: false,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: false,
      isPlayable: false,
      tabState: "failed",
      tabLabel: "Failed",
      tabClassName: "failed",
      stageWait: { failed: true, title: "This scene didn't draw", detail: v.error }
    };
  }

  if (v.state === "rendering" && !v.hasBundle) {
    const isQueuedCap = input.clipRequestStatus === "clip_cap";
    return {
      mode: "clip",
      reason: "variant-rendering",
      eligibleForLive: false,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: false,
      isPlayable: false,
      tabState: isQueuedCap ? "updating" : "rendering",
      tabLabel: isQueuedCap ? "Preview video is queued" : "Drawing",
      tabClassName: isQueuedCap ? "updating" : "rendering",
      stageWait: {
        failed: false,
        title: isQueuedCap ? "Preview video is queued…" : "Drawing…"
      }
    };
  }

  // Drawn variant with no bundle metadata -> pure clip scene.
  if (v.state === "drawn" && !v.hasBundle) {
    const hasComment = Boolean(input.hasPendingComment);
    return {
      mode: "clip",
      reason: "clip-only",
      eligibleForLive: false,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: true,
      isPlayable: true,
      tabState: "drawn",
      tabLabel: hasComment ? "Needs update" : "Drawn",
      tabClassName: hasComment ? "needs-update" : "drawn",
      stageWait: null
    };
  }

  // 3. Variant is live-eligible (`bundled`, `checked`, or `drawn` with a bundle).
  const eligibleForLive = v.hasBundle;
  const envSupported =
    input.environment !== undefined ? supportsWorkerHost(input.environment) : supportsWorkerHost();
  const envState =
    input.environment !== undefined ? environmentStatus(input.environment) : environmentStatus();

  const buildClipFallback = (reason: string): SceneModeResolution => {
    if (v.hasClip) {
      const hasComment = Boolean(input.hasPendingComment);
      return {
        mode: "clip",
        reason,
        eligibleForLive,
        needsBundleFetch: false,
        needsCheck: false,
        needsClipRequest: false,
        isReady: true,
        isPlayable: true,
        tabState: "drawn",
        tabLabel: hasComment ? "Needs update" : "Drawn",
        tabClassName: hasComment ? "needs-update" : "drawn",
        stageWait: null
      };
    }

    const isQueuedCap = input.clipRequestStatus === "clip_cap";
    return {
      mode: "clip",
      reason,
      eligibleForLive,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: Boolean(v.variantId) && !input.clipRequestStatus,
      isReady: false,
      isPlayable: false,
      tabState: isQueuedCap ? "updating" : "rendering",
      tabLabel: isQueuedCap ? "Preview video is queued" : "Drawing",
      tabClassName: isQueuedCap ? "updating" : "rendering",
      stageWait: {
        failed: false,
        title: isQueuedCap ? "Preview video is queued…" : "Drawing…"
      }
    };
  };

  // 3a. Environment is unverified or unsupported -> fall back to clip immediately without spawning a Worker.
  if (!envSupported) {
    return buildClipFallback(envState === "unverified" ? "unverified-environment" : "unsupported-environment");
  }

  // 3b. Explicit forced clip reason (e.g. previous fallback on this variant+digest).
  if (input.forcedClipReason) {
    return buildClipFallback(input.forcedClipReason);
  }

  // 3c. Check outcome handling.
  if (input.checkOutcome && !input.checkOutcome.ok) {
    if (input.checkOutcome.kind === "env") {
      return buildClipFallback("check-env");
    }
    // kind === "code": reported to backend -> bounded repair loop runs, tab shows "updating".
    return {
      mode: "live",
      reason: "check-code-repair",
      eligibleForLive: true,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: false,
      isPlayable: false,
      tabState: "updating",
      tabLabel: "Updating",
      tabClassName: "updating",
      stageWait: { failed: false, title: "Updating…" }
    };
  }

  // 3d. Player decision (buffering gate exceeded, worker unhealthy, etc. — ignore placeholder pending-live / no-bundle).
  if (
    input.playerDecision &&
    input.playerDecision.mode === "clip" &&
    input.playerDecision.reason !== "pending-live" &&
    input.playerDecision.reason !== "no-bundle"
  ) {
    return buildClipFallback(input.playerDecision.reason);
  }

  // 3e. Live path!
  const checkPassed = v.state === "checked" || v.state === "drawn" || input.checkOutcome?.ok === true;
  const needsBundleFetch = !input.bundleLoaded && Boolean(v.variantId);
  const needsCheck = v.state === "bundled" && !input.checkOutcome;
  const isReady = checkPassed;
  const isPlayable = checkPassed && Boolean(input.bundleLoaded) && Boolean(input.playerReady ?? true);

  if (!isReady || !input.bundleLoaded) {
    return {
      mode: "live",
      reason: needsCheck ? "checking" : "loading-bundle",
      eligibleForLive: true,
      needsBundleFetch,
      needsCheck,
      needsClipRequest: false,
      isReady,
      isPlayable: false,
      tabState: isReady ? "checked" : "bundled",
      tabLabel: isReady ? "Ready" : "Checking",
      tabClassName: isReady ? "ready" : "updating",
      stageWait: { failed: false, title: "Checking…" }
    };
  }

  const hasComment = Boolean(input.hasPendingComment);
  const buffering = Boolean(input.isBuffering);

  // 3f. Pre-draw: the player is drawing frames ahead before this scene can play (progress 0..1), then it plays.
  const progress = input.playerDecision?.mode === "live" ? input.playerDecision.progress : undefined;
  if (typeof progress === "number") {
    const pct = Math.max(0, Math.min(100, Math.floor(progress * 100)));
    return {
      mode: "live",
      reason: input.playerDecision?.reason ?? "predraw",
      eligibleForLive: true,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: true,
      isPlayable,
      tabState: "updating",
      tabLabel: "Preparing",
      tabClassName: "updating",
      stageWait: { failed: false, title: `Preparing this scene… ${pct}%` },
      isPreparing: true,
      preparingProgress: progress
    };
  }

  return {
    mode: "live",
    reason: input.playerDecision?.reason ?? "ok",
    eligibleForLive: true,
    needsBundleFetch: false,
    needsCheck: false,
    needsClipRequest: false,
    isReady: true,
    isPlayable,
    tabState: "checked",
    tabLabel: hasComment ? "Needs update" : "Ready",
    tabClassName: hasComment ? "needs-update" : "ready",
    stageWait: buffering ? { failed: false, title: "Buffering…" } : null
  };
}

export { parseGenFromBundleUrl };
