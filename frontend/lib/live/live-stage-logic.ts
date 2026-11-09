import type { CheckOutcome } from "./api.ts";
import { isWatchdogTimeoutError, parseGenFromBundleUrl } from "./api.ts";
import type { PlaybackRenderMode, StillUpgradeState } from "./draft-profile.ts";
import { isPlateLiveEnabled } from "./flag.ts";
import type { AspectRatio } from "./plate-player.ts";
import { environmentStatus, supportsWorkerHost, type EnvironmentProbeInput } from "./support.ts";
import type { PlaybackState, PlayerDecision } from "./types.ts";

export const CLIP_AFTER_UNPLAYABLE_MS = 180_000;

export function canTriggerClipRequestForReason(
  reason: string | undefined | null,
  checkError?: string | null
): boolean {
  if (!reason) return false;
  if (isWatchdogTimeoutError(reason) || isWatchdogTimeoutError(checkError)) {
    return false;
  }
  if (
    reason === "code-permanent" ||
    reason === "check-code-failed" ||
    reason === "unverified-environment" ||
    reason === "unsupported-environment" ||
    reason === "device-env" ||
    reason === "check-env" ||
    reason === "unplayable-timeout" ||
    reason === "jitter" ||
    reason === "sustained-jitter"
  ) {
    return true;
  }
  return false;
}

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

export type LivePlatePlayback = "clip";

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
  rev?: number;
  frames?: number | null;
  framesDone?: number | null;
  playback?: "clip";
  drawMsPerFrame?: number;
  stale?: boolean;
  needsReconcile?: boolean;
};

export type LivePlateScene = {
  index: number;
  keyword: string;
  look?: string | null;
  state: LivePlateVariantState;
  seconds: number;
  frames?: number;
  framesDone?: number | null;
  sig: string;
  v?: string | null;
  rev?: number;
  gen?: number;
  stage?: string;
  error?: string;
  attempts?: number;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  playback?: "clip";
  drawMsPerFrame?: number;
  stale?: boolean;
  needsReconcile?: boolean;
  variants?: Partial<Record<AspectRatio, LivePlateVariantView>>;
};

export type LivePlateStatus = {
  available: boolean;
  look: string | null;
  mode?: "live" | "clip";
  revision?: string;
  stale?: boolean;
  needsReconcile?: boolean;
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
  look?: string | null;
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
  playbackClip: boolean;
  playbackReason?: string;
  drawMsPerFrame?: number;
  stage?: string;
  error?: string;
  stale?: boolean;
};

export function isPlaybackClipMode(playback?: unknown): boolean {
  if (!playback) return false;
  if (playback === "clip") return true;
  if (typeof playback === "object" && (playback as { mode?: unknown }).mode === "clip") return true;
  return false;
}

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
  const stale = Boolean(
    view?.stale ??
      (isPrimary ? scene.stale : false) ??
      (view?.stage === "stale" || (isPrimary && scene.stage === "stale"))
  );
  const state: LivePlateVariantState = stale ? "queued" : (view?.state ?? (isPrimary ? scene.state : "queued"));
  const variantId = stale ? undefined : (view?.variantId ?? (isPrimary ? scene.variantId : undefined));
  const bundleDigest = stale ? null : (view?.bundleDigest ?? (isPrimary ? scene.bundleDigest : null) ?? null);
  const rawClipV = view && view.v !== undefined ? view.v : scene.v;
  const clipVersion = stale
    ? null
    : rawClipV !== undefined
      ? rawClipV
      : state === "drawn" && isPrimary
        ? "v1"
        : null;
  const rev = scene.rev ?? 0;
  const gen = view?.gen ?? scene.gen ?? rev + 1;
  const seconds = scene.seconds > 0 ? scene.seconds : 4;
  const frames = scene.frames && scene.frames > 0 ? scene.frames : Math.max(1, Math.round(seconds * 30));
  const rawPlayback = stale ? undefined : ((view?.playback ?? (isPrimary ? scene.playback : undefined)) as unknown);
  const rawPlaybackObj =
    typeof rawPlayback === "object" && rawPlayback !== null
      ? (rawPlayback as { mode?: unknown; reason?: unknown; drawMs?: unknown; medianMs?: unknown })
      : null;
  const hasBundle =
    !stale &&
    !isPlaybackClipMode(rawPlayback) &&
    state !== "rendering" &&
    Boolean(variantId) &&
    (state === "bundled" || state === "checked" || (state === "drawn" && Boolean(bundleDigest)));
  const playbackClip =
    !stale &&
    (isPlaybackClipMode(rawPlayback) ||
      state === "rendering" ||
      (state === "drawn" && !hasBundle));
  const playbackReason =
    rawPlaybackObj && typeof rawPlaybackObj.reason === "string"
      ? rawPlaybackObj.reason
      : isPlaybackClipMode(rawPlayback)
        ? "slow-draw"
        : state === "rendering"
          ? "variant-rendering"
          : state === "drawn" && !hasBundle
            ? "drawn"
            : undefined;
  const legacyDrawMs =
    rawPlaybackObj && typeof (rawPlaybackObj.drawMs ?? rawPlaybackObj.medianMs) === "number"
      ? ((rawPlaybackObj.drawMs ?? rawPlaybackObj.medianMs) as number)
      : undefined;
  const drawMsPerFrame =
    view?.drawMsPerFrame ??
    legacyDrawMs ??
    (isPrimary ? scene.drawMsPerFrame : undefined);
  const hasClip =
    !stale &&
    (Boolean(clipVersion) || (state === "drawn" && (rawClipV !== null || !isPlaybackClipMode(rawPlayback))));

  return {
    index: scene.index,
    keyword: scene.keyword,
    ...(scene.look !== undefined ? { look: scene.look } : {}),
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
    playbackClip,
    ...(playbackReason !== undefined ? { playbackReason } : {}),
    ...(typeof drawMsPerFrame === "number" && Number.isFinite(drawMsPerFrame) ? { drawMsPerFrame } : {}),
    stage: stale ? "stale" : view?.stage,
    error: view?.error ?? (state === "failed" ? scene.error : undefined),
    ...(stale ? { stale: true } : {})
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
    if (state !== "bundled" && state !== "drawn") return false;
    if (!variantId || !bundleDigest || !(gen >= 1)) return false;
    const key = CheckOnceTracker.keyFor(variantId, gen, bundleDigest);
    return !this.inFlight.has(key) && !this.completed.has(key);
  }

  shouldReportPlayback(
    variantId: string | undefined,
    gen: number,
    bundleDigest: string | null | undefined,
    state: LivePlateVariantState = "checked",
    playback?: unknown
  ): boolean {
    if (state !== "checked") return false;
    if (isPlaybackClipMode(playback)) return false;
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
  qualityJobText?: string | null;
  storeDisabledReason?: string | null;
  renderMode?: PlaybackRenderMode;
  stillUpgradeState?: StillUpgradeState;
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
  /** Explicit 3g player state (`drawing`, `ready`, `playing`, `buffering`, `clip`). */
  playerState?: PlaybackState;
  /** Whether the scene is currently buffering mid-playback. */
  isBuffering?: boolean;
  /** Status text for `StatusLine` when this scene is drawing or buffering (e.g. `"Drawing scene 2… 40 %"`, `"Buffering…"`). */
  statusText?: string;
  /** The scene is drawing frames ahead before it can play (phase 3f/3g); it stays playable so the film can move into it and wait. */
  isPreparing?: boolean;
  /** Fraction (0..1) of the frames needed ahead that are drawn, while `isPreparing`. */
  preparingProgress?: number;
  /** Active playback render mode (`"draft"` or `"full"`). */
  renderMode?: PlaybackRenderMode;
  /** Pause full-quality still upgrade state (`"idle" | "pending-still" | "drawing-still" | "showing-still"`). */
  stillUpgradeState?: StillUpgradeState;
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

  if (v.stale || v.stage === "stale") {
    return {
      mode: "clip",
      reason: "variant-stale",
      eligibleForLive: false,
      needsBundleFetch: false,
      needsCheck: false,
      needsClipRequest: false,
      isReady: false,
      isPlayable: false,
      tabState: "stale",
      tabLabel: "Needs update",
      tabClassName: "needs-update",
      stageWait: {
        failed: false,
        title: "Storyboard updated · scene needs redraw",
        detail: "Update the animation to draw the changed scenes. Unchanged scenes are kept."
      }
    };
  }

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
    const isSlowClip = v.playbackReason === "slow-draw" || v.playbackReason === "slow";
    const sceneNumber = Math.max(1, Math.floor(v.index) + 1);
    return {
      mode: "clip",
      reason: isSlowClip ? "slow-draw" : "variant-rendering",
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
        title: isQueuedCap
          ? "Preview video is queued…"
          : isSlowClip
            ? `Scene ${sceneNumber} is being prepared as a video for smooth playback`
            : "Drawing…"
      }
    };
  }

  // Drawn variant without a live bundle, or scene marked with playback="clip" on server -> plays from the worker clip.
  if ((v.state === "drawn" && !v.hasBundle) || v.playbackClip) {
    if (v.hasClip) {
      const isServerPlaybackClip = v.playbackReason === "slow-draw" || v.playbackReason === "slow";
      if (!v.hasBundle || isServerPlaybackClip) {
        const hasComment = Boolean(input.hasPendingComment);
        return {
          mode: "clip",
          reason: isServerPlaybackClip ? "slow-draw" : "clip-only",
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
    } else if (v.playbackReason === "slow-draw" || v.playbackReason === "slow") {
      const isQueuedCap = input.clipRequestStatus === "clip_cap";
      const sceneNumber = Math.max(1, Math.floor(v.index) + 1);
      return {
        mode: "clip",
        reason: "slow-draw",
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
          title: isQueuedCap
            ? "Preview video is queued…"
            : `Scene ${sceneNumber} is being prepared as a video for smooth playback`
        }
      };
    }
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
    const isSlowClip = reason === "slow-draw" || reason === "slow" || v.playbackReason === "slow-draw" || v.playbackReason === "slow";
    const sceneNumber = Math.max(1, Math.floor(v.index) + 1);
    const checkErr = input.checkOutcome && !input.checkOutcome.ok ? input.checkOutcome.error : null;
    return {
      mode: "clip",
      reason,
      eligibleForLive: isSlowClip ? false : eligibleForLive,
      needsBundleFetch: false,
      needsCheck: false,
      // Only request a clip from the client for a real trigger (permanent code failure, non-watchdog device/env failure,
      // 3-minute unplayable timeout, or sustained jitter).
      needsClipRequest:
        !isSlowClip &&
        Boolean(v.variantId) &&
        !input.clipRequestStatus &&
        canTriggerClipRequestForReason(reason, checkErr),
      isReady: false,
      isPlayable: false,
      tabState: isQueuedCap ? "updating" : "rendering",
      tabLabel: isQueuedCap ? "Preview video is queued" : "Drawing",
      tabClassName: isQueuedCap ? "updating" : "rendering",
      stageWait: {
        failed: false,
        title: isQueuedCap
          ? "Preview video is queued…"
          : isSlowClip
            ? `Scene ${sceneNumber} is being prepared as a video for smooth playback`
            : "Drawing…"
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
    if (input.checkOutcome.kind === "code") {
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
    // kind === "inconclusive": do not demote to clip; continue to live check path so it re-checks when visible.
  }

  // 3d. Player decision (buffering gate exceeded, worker unhealthy, etc. — ignore placeholder pending-live / no-bundle / clip-only).
  if (
    input.playerDecision &&
    input.playerDecision.mode === "clip" &&
    input.playerDecision.reason !== "pending-live" &&
    input.playerDecision.reason !== "no-bundle" &&
    input.playerDecision.reason !== "clip-only"
  ) {
    return buildClipFallback(input.playerDecision.reason);
  }

  // 3e. Live path!
  const hasBrowserVerdictOk = v.state === "checked" || input.checkOutcome?.ok === true;
  const needsBundleFetch = !input.bundleLoaded && Boolean(v.variantId);
  const needsCheck =
    (v.state === "bundled" || (v.state === "drawn" && v.hasBundle && !v.playbackClip)) &&
    !hasBrowserVerdictOk;
  const isReady = hasBrowserVerdictOk || v.hasClip;
  const isPlayable = hasBrowserVerdictOk && Boolean(input.bundleLoaded) && Boolean(input.playerReady ?? true);

  if (!hasBrowserVerdictOk || !input.bundleLoaded) {
    const hasComment = Boolean(input.hasPendingComment);
    return {
      mode: "live",
      reason: needsCheck ? "checking" : "loading-bundle",
      eligibleForLive: true,
      needsBundleFetch,
      needsCheck,
      needsClipRequest: false,
      isReady,
      isPlayable: false,
      tabState: isReady ? (v.hasClip && !hasBrowserVerdictOk ? "drawn" : "checked") : "bundled",
      tabLabel: isReady ? (hasComment ? "Needs update" : "Ready") : "Checking",
      tabClassName: isReady ? (hasComment ? "needs-update" : "ready") : "updating",
      stageWait: v.hasClip ? null : { failed: false, title: "Checking…" }
    };
  }

  const hasComment = Boolean(input.hasPendingComment);
  const buffering = Boolean(input.isBuffering || input.playerDecision?.state === "buffering");

  // 3f/3g. Initial drawing buffer: the player is drawing frames ahead before this scene can play (progress 0..1), then it plays.
  const progress = input.playerDecision?.mode === "live" ? input.playerDecision.progress : undefined;
  if (typeof progress === "number") {
    const pct = Math.max(0, Math.min(100, Math.floor(progress * 100)));
    const drawText = `Drawing scene ${v.index + 1}… ${pct} %`;
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
      stageWait: { failed: false, title: drawText },
      playerState: "drawing",
      statusText: drawText,
      isPreparing: true,
      preparingProgress: progress
    };
  }

  const renderMode = input.renderMode ?? input.playerDecision?.renderMode;
  const stillUpgradeState = input.stillUpgradeState ?? input.playerDecision?.stillUpgradeState;

  const statusText = buffering
    ? "Buffering…"
    : stillUpgradeState === "drawing-still"
      ? "Refining paused frame…"
      : input.qualityJobText
        ? input.qualityJobText
        : input.storeDisabledReason && renderMode !== "draft"
          ? input.storeDisabledReason
          : undefined;

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
    stageWait: buffering ? { failed: false, title: "Buffering…" } : null,
    playerState: buffering ? "buffering" : (input.playerDecision?.state ?? "ready"),
    isBuffering: buffering,
    ...(renderMode ? { renderMode } : {}),
    ...(stillUpgradeState ? { stillUpgradeState } : {}),
    ...(statusText ? { statusText } : {})
  };
}

/**
 * Computes distance ahead of the playhead for a scene index in a multi-scene film:
 * scenes at or ahead of `playheadSceneIndex` have distance `sceneIndex - playheadSceneIndex` (`0, 1, ...`);
 * scenes behind the playhead follow after all ahead scenes, ordered by their `sceneIndex`.
 */
export function distanceAheadOfPlayhead(
  sceneIndex: number,
  playheadSceneIndex: number,
  totalScenes: number
): number {
  const n = Math.max(1, totalScenes);
  const cur = Math.max(0, Math.min(n - 1, playheadSceneIndex));
  return sceneIndex >= cur ? sceneIndex - cur : n - cur + sceneIndex;
}

/**
 * Orders queued scene checks by distance ahead of the playhead first, then by scene index.
 */
export function orderPendingChecks<T extends { sceneIndex: number }>(
  items: Iterable<T>,
  playheadSceneIndex: number,
  totalScenes: number
): T[] {
  return [...items].sort((a, b) => {
    const dA = distanceAheadOfPlayhead(a.sceneIndex, playheadSceneIndex, totalScenes);
    const dB = distanceAheadOfPlayhead(b.sceneIndex, playheadSceneIndex, totalScenes);
    if (dA !== dB) return dA - dB;
    return a.sceneIndex - b.sceneIndex;
  });
}

export { parseGenFromBundleUrl };
