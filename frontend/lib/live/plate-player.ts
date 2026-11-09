import {
  DEFAULT_CHECK_MAX_RETRIES,
  DEFAULT_CHECK_RETRY_BACKOFF_MS,
  DEFAULT_CHECK_WATCHDOG_MS,
  MAX_VISIBILITY_RECHECKS,
  isDocumentHidden,
  isInitTimeoutError,
  isWatchdogTimeoutError,
  reportCheck,
  runCheck,
  type BundleManifest,
  type CheckOutcome,
  type CheckReportPayload,
  type LiveApiOptions,
  type ReportCheckResult
} from "./api.ts";
import {
  CheckOnceTracker,
  orderPendingChecks,
  type LivePlateVariantState
} from "./live-stage-logic.ts";
import {
  FilmClock,
  PlaybackClock,
  chooseFrame,
  frameAt,
  sceneAt,
  type FilmAudioBinding,
  type SfxCue,
  type TimeSource
} from "./clock.ts";
import {
  DRAFT_BEHIND_FRAMES,
  DRAFT_MAX_RUNWAY_FRAMES,
  DRAFT_NEXT_SCENE_HEAD_FRAMES,
  DRAFT_NOMINAL_RUNWAY_FRAMES,
  FULL_QUALITY_SPEC,
  PAUSE_STILL_DEBOUNCE_MS,
  buildDraftQualitySpec,
  draftQualityProfileKey,
  evaluateSustainedJitter,
  getDraftTargetVerticesPerFrame,
  isSlowScene,
  normalizePlaybackRenderMode,
  onDraftStylePolicyChange,
  onDraftTargetVerticesChange,
  resolveDraftQualitySpecForStyle,
  resolveQualitySpecForMode,
  validateDraftTargetVerticesPerFrame,
  type DraftQualitySpec,
  type JitterEpisodeInput,
  type PlaybackRenderMode,
  type StillUpgradeState
} from "./draft-profile.ts";
import type { WebAudioFilmTimeline } from "./film-audio.ts";
import { isPlateDraftPreviewEnabled, isPlateLiveEnabled } from "./flag.ts";
import { FrameCache, computeRollingWindow, frameCacheKey, sceneCacheKey, type RollingWindowSplit } from "./frame-cache.ts";
import { FrameScheduler } from "./frame-scheduler.ts";
import {
  DEFAULT_PREVIEW_QUALITY,
  FrameStore,
  QualityJob,
  normalizePreviewQuality,
  storeFrameKey,
  type FrameStoreStatus,
  type PreviewQuality,
  type QualityJobProgress,
  type QualityJobSceneSpec
} from "./frame-store.ts";
import {
  DECODED_WINDOW_FRAMES,
  DRAW_TIME_SAFETY_MARGIN,
  PLAYBACK_WINDOW_FRAMES,
  PREDRAW_JUMP_FRAMES,
  PREVIEW_FRAME_STEP,
  RESUME_BUFFER_FRAMES,
  START_BUFFER_FRAMES,
  contiguousFrom,
  decidePredraw,
  indicesToEvict,
  predrawProgress,
  previewFrameCount,
  previewIndexForFrame,
  previewRate,
  resumeBufferFrames,
  sourceFrameForPreview,
  startBufferFrames,
  type PredrawDecision
} from "./predraw.ts";
import {
  environmentStatus,
  resolveCacheBudgetBytes,
  resolveDraftCacheBudgetBytes,
  supportsWorkerHost,
  type EnvironmentProbeInput
} from "./support.ts";
import type { PlaybackState, PlayerDecision, PlayerEvent, PlayerMeta, ScenePlayer, SceneSpan } from "./types.ts";
import { WorkerHost, getActiveBrowserTransportCount, type HostFrameResult, type ImageBitmapLike, type WorkerHostOptions, type WorkerTransportFactory } from "./worker-host.ts";

/**
 * Live plate scene player and multi-scene film sequencer (docs/LIVE_SCENES_PLAN.md §5, §6, §10, §20, §26;
 * docs/LIVE_PLAYBACK_PLAN.md changes B, C, D, E, F).
 *
 * Phase 3g:
 * - 30 fps (`PREVIEW_FRAME_STEP = 1`).
 * - Video-style buffering: states `drawing`, `ready`, `playing`, `buffering`, `clip`.
 *   Starts when `max(30, L)` frames are ready ahead; keeps ~90 frames (3 s) decoded in RAM within `resolveCacheBudgetBytes`;
 *   closes each frame's bitmap once shown; enters `buffering` if a due frame is missing and resumes at `min(30, framesLeft)`.
 * - Draw once: saves every drawn frame as lossy WebP in `FrameStore` (`gm-live-frames`); complete scenes replay without
 *   creating a drawing Worker at all; partly saved scenes draw only missing frames.
 * - Background quality job (`QualityJob`) and background draw-ahead for undrawn scenes.
 */

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type PreviewSizeSpec = {
  width: number;
  height: number;
  label: string;
  scale: number;
  bytesPerFrame: number;
};

/**
 * Preview resolution for each aspect ratio: 640x360 for 16:9, 360x640 for 9:16, 480x480 for 1:1.
 * The Worker is mounted at the matching scale so OffscreenCanvas dimensions equal the preview size.
 * (The final render on AWS is unchanged: 1920x1080.)
 */
export function previewSizeForAspect(
  aspect: AspectRatio | string = "16:9",
  fullWidth?: number,
  fullHeight?: number
): PreviewSizeSpec {
  if (aspect === "9:16") {
    const baseW = fullWidth && fullWidth > 0 ? fullWidth : 1080;
    const width = 360;
    const height = 640;
    const scale = baseW === 1080 ? 640 / 1920 : width / baseW;
    return { width, height, label: "360x640", scale, bytesPerFrame: width * height * 4 };
  }
  if (aspect === "1:1") {
    const baseW = fullWidth && fullWidth > 0 ? fullWidth : 1080;
    const width = 480;
    const height = 480;
    const scale = width / baseW;
    return { width, height, label: "480x480", scale, bytesPerFrame: width * height * 4 };
  }
  const baseW = fullWidth && fullWidth > 0 ? fullWidth : 1920;
  const width = 640;
  const height = 360;
  const scale = width / baseW;
  void fullHeight;
  return { width, height, label: "640x360", scale, bytesPerFrame: width * height * 4 };
}

export type GateEvaluation = {
  mode: "live" | "clip";
  reason: string;
  leadSeconds: number;
  aheadSeconds: number;
  produceFps: number;
  canStartPlayback: boolean;
};

/**
 * The phase 3c buffering gate (docs/LIVE_SCENES_PLAN.md §6, §20), kept for reference and its unit tests.
 */
export function evaluatePlaybackGate(input: {
  frames: number;
  fps: number;
  avgDrawMs: number;
  aheadFrames: number;
  bufferedAheadSeconds?: number;
  unhealthy?: boolean;
  supported?: boolean;
  envStatus?: "verified" | "unverified" | "unsupported";
}): GateEvaluation {
  const fps = input.fps > 0 ? input.fps : 30;
  const frames = Math.max(1, input.frames);
  const clipSeconds = frames / fps;
  const aheadSeconds = Math.max(0, input.aheadFrames) / fps;

  if (input.supported === false) {
    const reason = input.envStatus === "unverified" ? "unverified-environment" : "unsupported-environment";
    return { mode: "clip", reason, leadSeconds: 0, aheadSeconds, produceFps: 0, canStartPlayback: false };
  }

  if (input.unhealthy) {
    return { mode: "clip", reason: "worker-unhealthy", leadSeconds: 0, aheadSeconds, produceFps: 0, canStartPlayback: false };
  }

  if (!(input.avgDrawMs > 0)) {
    return {
      mode: "live",
      reason: "measuring",
      leadSeconds: 0.5,
      aheadSeconds,
      produceFps: fps,
      canStartPlayback: (input.bufferedAheadSeconds ?? 0) >= Math.min(0.5, clipSeconds)
    };
  }

  const produceFps = 1000 / input.avgDrawMs;
  const leadSeconds = clipSeconds * Math.max(0, 1 - produceFps / fps) + 0.5;

  if (leadSeconds > aheadSeconds) {
    return {
      mode: "clip",
      reason: `gate-exceeded: lead ${leadSeconds.toFixed(2)}s > ahead ${aheadSeconds.toFixed(2)}s`,
      leadSeconds,
      aheadSeconds,
      produceFps,
      canStartPlayback: false
    };
  }

  const requiredLead = Math.min(leadSeconds, clipSeconds);
  const canStartPlayback = (input.bufferedAheadSeconds ?? 0) + 1e-6 >= requiredLead;

  return {
    mode: "live",
    reason: "ok",
    leadSeconds,
    aheadSeconds,
    produceFps,
    canStartPlayback
  };
}

export type PlatePlayerOptions = {
  id?: string;
  bundleDigest: string;
  html: string;
  params?: Record<string, unknown>;
  aspect?: AspectRatio | string;
  fps?: number;
  frames?: number;
  fullWidth?: number;
  fullHeight?: number;
  hasNextScene?: boolean;
  budgetBytes?: number;
  cache?: FrameCache<ImageBitmapLike>;
  frameStore?: FrameStore | null;
  filmKey?: string;
  variantKey?: string;
  host?: WorkerHost;
  hostOptions?: Partial<WorkerHostOptions>;
  transportFactory?: WorkerTransportFactory;
  environment?: string | EnvironmentProbeInput;
  forceClipReason?: string;
  gateSampleFrames?: number;
  autoPump?: boolean;
  /** Source frames per preview frame (default `PREVIEW_FRAME_STEP` = 1). */
  frameStep?: number;
  /** Millisecond clock (default `performance.now`). */
  now?: () => number;
  /** Playback render mode (`"draft"` or `"full"`). Defaults to `"draft"` when live draft preview is enabled. */
  renderMode?: PlaybackRenderMode;
  /** Optional scene or project look/style identifier (e.g. `"illus-balloon"`, `"mellan"`) for per-style Draft quality policy. */
  look?: string | null;
  /** Explicit per-player draft target vertices per frame override (C5: forces this target for this player only). */
  draftTargetVerticesPerFrame?: number;
  /** Debounce delay in ms before upgrading an intentionally paused draft frame to a full-quality still (default 250 ms). */
  pauseStillDebounceMs?: number;
  /** Optional scene index within a film (for trace telemetry). */
  sceneIndex?: number;
  /** Optional trace context callback provided by `createFilmPlayer` or a standalone caller. */
  traceContext?: () => { clockSec: number; workersAlive: number };
  /** True when this scene's variant is `checked` with no `playback` marker and needs a one-time >= 8 alone-samples playback measurement report. */
  needsPlaybackMeasure?: boolean;
  /** Callback fired once when the player has collected >= 8 post-init alone draw-time samples or detected sustained playback jitter. */
  onPlaybackSamples?: (info: {
    medianMs: number;
    p90Ms: number;
    samples: number;
    aloneSamples: number[];
    reason?: "slow" | "jitter" | "playable-timeout";
  }) => void;
  /** Optional hook returning external concurrent draw count (`> 0` marks draws as contended). */
  activeDrawWork?: () => number;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Page-wide draw accounting (phase 3f follow-up + 3g). Several Workers drawing at once share the CPU, so a draw timed while
 * another one is in flight is *contended*. `work.count` is the number of draws in flight on this page; sampling and background
 * drawing for non-active scenes are serialised through `measureChain`.
 */
const work = { count: 0 };
let measureChain: Promise<void> = Promise.resolve();
let measuringExclusiveCount = 0;

/** Draws in flight on this page right now (all scenes). */
export function activeDrawWork(): number {
  return work.count;
}

export function runExclusiveMeasure<T>(fn: () => Promise<T>): Promise<T> {
  measuringExclusiveCount++;
  const run = measureChain.then(fn, fn);
  measureChain = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    measuringExclusiveCount = Math.max(0, measuringExclusiveCount - 1);
  });
}

/**
 * Single shared background check slot across the page so at most one `bundled` variant is checked at a time,
 * and during playback it yields to idle gaps so `peakWorkersDuringPlay <= 2`.
 */
let sharedCheckSlotChain: Promise<void> = Promise.resolve();

export function runInSharedCheckSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = sharedCheckSlotChain.then(fn, fn);
  sharedCheckSlotChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function waitForCheckIdleGap(options: {
  isCancelled?: () => boolean;
  isPlaying?: () => boolean;
  activeWorkers?: () => number;
  releaseIdle?: () => void;
  maxWorkersDuringPlay?: number;
} = {}): Promise<boolean> {
  const maxBeforeCheck = Math.max(1, (options.maxWorkersDuringPlay ?? 2) - 1);
  for (let i = 0; i < 400; i++) {
    if (options.isCancelled?.()) return false;
    options.releaseIdle?.();
    const workers = options.activeWorkers ? options.activeWorkers() : getActiveBrowserTransportCount();
    const playing = options.isPlaying?.() ?? false;
    if (work.count === 0 && (!playing || workers <= maxBeforeCheck) && workers <= maxBeforeCheck) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 4));
  }
  return !options.isCancelled?.();
}

/** Draw samples kept per player for the measured cost. */
const MAX_COST_SAMPLES = 9;

export const LIVE_TRACE_RING_CAP = 200;

export type LiveTraceCause = "boundary" | "mid-scene" | "seek" | "start";
export type LiveTraceWorkerState = "initialising" | "drawing" | "idle";

export type SlowSceneTraceEntry = {
  kind: "slow-scene";
  type: "slow-scene";
  sceneIndex: number;
  median: number;
  p90: number;
  n: number;
  decision: "clip" | "live";
  source?: "check" | "playback";
};

export type LiveTraceEntry = {
  /** Film clock position in seconds at the start of the buffering episode. */
  at: number;
  sceneIndex: number;
  localFrame: number;
  durationMs: number;
  cause: LiveTraceCause;
  readyAhead: number;
  neededFrames: number;
  workerState: LiveTraceWorkerState;
  drawMsPerFrame: number;
  cacheBytes: number;
  cacheBudget: number;
  /** Formatted `"<cacheBytes>/<cacheBudget>"` summary. */
  cacheBytesBudget: string;
  workersAlive: number;
};

type TraceGlobalScope = {
  window?: {
    __gmLiveTrace?: unknown;
    __gmLiveTraceLog?: (LiveTraceEntry | SlowSceneTraceEntry)[];
    localStorage?: { getItem?: (key: string) => string | null };
  };
  __gmLiveTrace?: unknown;
  __gmLiveTraceLog?: (LiveTraceEntry | SlowSceneTraceEntry)[];
  localStorage?: { getItem?: (key: string) => string | null };
};

export function isLiveTraceEnabled(): boolean {
  try {
    const g = globalThis as unknown as TraceGlobalScope;
    const win = g.window ?? g;
    if (win.__gmLiveTrace === true || win.__gmLiveTrace === 1 || win.__gmLiveTrace === "1") {
      return true;
    }
    if (g.__gmLiveTrace === true || g.__gmLiveTrace === 1 || g.__gmLiveTrace === "1") {
      return true;
    }
    const ls = win.localStorage ?? g.localStorage;
    if (ls && typeof ls.getItem === "function") {
      const v = ls.getItem("gmLiveTrace");
      if (v === "1" || v === "true") return true;
    }
  } catch {}
  return false;
}

export function getLiveTraceLog(): (LiveTraceEntry | SlowSceneTraceEntry)[] {
  try {
    const g = globalThis as unknown as TraceGlobalScope;
    const win = g.window ?? g;
    if (Array.isArray(win.__gmLiveTraceLog)) {
      return win.__gmLiveTraceLog;
    }
    if (Array.isArray(g.__gmLiveTraceLog)) {
      return g.__gmLiveTraceLog;
    }
  } catch {}
  return [];
}

export function clearLiveTraceLog(): void {
  try {
    const g = globalThis as unknown as TraceGlobalScope;
    if (g.window && Array.isArray(g.window.__gmLiveTraceLog)) {
      g.window.__gmLiveTraceLog.length = 0;
    }
    if (Array.isArray(g.__gmLiveTraceLog)) {
      g.__gmLiveTraceLog.length = 0;
    }
  } catch {}
}

function appendLiveTraceEntry<T extends LiveTraceEntry | SlowSceneTraceEntry>(entry: T): T {
  const copy: T = { ...entry };
  try {
    const g = globalThis as unknown as TraceGlobalScope;
    const win = g.window ?? g;
    let ring = win.__gmLiveTraceLog;
    if (!Array.isArray(ring)) {
      ring = [];
      win.__gmLiveTraceLog = ring;
    }
    if (g.window && g.__gmLiveTraceLog !== ring) {
      g.__gmLiveTraceLog = ring;
    }
    ring.push(copy);
    while (ring.length > LIVE_TRACE_RING_CAP) {
      ring.shift();
    }
  } catch {}
  return copy;
}

export function recordSlowSceneTrace(entry: {
  sceneIndex: number;
  median: number;
  p90: number;
  n: number;
  decision: "clip" | "live";
  source?: "check" | "playback";
}): SlowSceneTraceEntry | null {
  if (!isLiveTraceEnabled()) return null;
  return appendLiveTraceEntry({
    kind: "slow-scene",
    type: "slow-scene",
    sceneIndex: entry.sceneIndex,
    median: entry.median,
    p90: entry.p90,
    n: entry.n,
    decision: entry.decision,
    ...(entry.source ? { source: entry.source } : {})
  });
}

export class PlatePlayer implements ScenePlayer {
  readonly meta: PlayerMeta;
  readonly bundleDigest: string;
  readonly previewSize: PreviewSizeSpec;
  private currentCacheKey: string;
  readonly cache: FrameCache<ImageBitmapLike>;
  readonly windowSplit: RollingWindowSplit;
  readonly frameStep: number;
  readonly previewFrames: number;
  readonly previewFps: number;
  readonly store: FrameStore | null;
  readonly filmKey: string;
  readonly variantKey: string;

  private readonly sceneId: string;
  private readonly sceneIdx: number;
  private readonly traceContext?: () => { clockSec: number; workersAlive: number };
  private openTraceEpisode: { entry: LiveTraceEntry; t0: number } | null = null;
  private openJitterEpisode: { cause: LiveTraceCause; t0: number; playing: boolean; documentHidden: boolean } | null = null;
  private readonly jitterEpisodes: JitterEpisodeInput[] = [];
  private jitterReported = false;
  private readonly html: string;
  private readonly params: Record<string, unknown>;
  private host: WorkerHost | null;
  private readonly ownsHost: boolean;
  private readonly ownsCache: boolean;
  private readonly hostOptions?: Partial<WorkerHostOptions>;
  private readonly transportFactory?: WorkerTransportFactory;
  private readonly scheduler: FrameScheduler<ImageBitmapLike>;
  private readonly gateSampleFrames: number;
  private readonly autoPump: boolean;
  private readonly envSupported: boolean;
  private readonly envState: "verified" | "unverified" | "unsupported";
  private readonly nowMs: () => number;
  private readonly pauseStillDebounceMs: number;

  private requestedRenderMode: PlaybackRenderMode;
  private legacyBundleFallback = false;
  private look: string | null;
  private explicitDraftTargetVertices: number | null;
  private draftTargetVertices: number;
  private currentQualitySpec: Readonly<DraftQualitySpec>;
  private requestEpoch = 0;
  private stillEpoch = 0;
  private stillTimer: ReturnType<typeof setTimeout> | null = null;
  private stillState: StillUpgradeState = "idle";
  private heldStillBitmap: ImageBitmapLike | null = null;
  private heldStillFrame: number | null = null;
  private scrubDrawInFlight = false;
  private pendingScrubFrame: number | null = null;
  private lastFrameStats: Record<string, unknown> | null = null;
  private lastCalibration: Record<string, unknown> | null = null;
  private readonly unsubDraftTargetChange: () => void;
  private readonly unsubDraftStylePolicyChange: () => void;
  private readonly presentedFramesSet = new Set<number>();
  private presentedBlits = 0;
  private presentedCanvasFrames = 0;
  private lastPresentedSrcFrame: number | null = null;
  private lastPresentedQualityMode: string | null = null;

  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** Preview index of the frame the clock asks for. */
  private currentFrame = 0;
  /** Preview index currently drawn on the canvas. */
  private lastShownFrame: number | null = null;
  private lastTarget: number | null = null;
  private isBuffering = false;
  private bufferingCount = 0;
  private readyEmitted = false;
  private currentDecision: PlayerDecision = { mode: "live", reason: "ok", state: "drawing" };
  private pumping = false;
  private repumpRequested = false;
  private isDestroyed = false;

  private variant: "live" | "predraw" = "live";
  private plan: PredrawDecision | null = null;
  private aloneSamples: number[] = [];
  private contendedSamples: number[] = [];
  private playbackAloneSamples: number[] = [];
  private firstSampleAfterInit = true;
  private playbackSamplesReported = false;
  private needsPlaybackMeasure: boolean;
  private readonly onPlaybackSamples?: (info: {
    medianMs: number;
    p90Ms: number;
    samples: number;
    aloneSamples: number[];
    reason?: "slow" | "jitter" | "playable-timeout";
  }) => void;
  private readonly activeDrawWorkFn?: () => number;
  private isMeasured = false;
  private measurePromise: Promise<void> | null = null;
  private reinitPromise: Promise<void> | null = null;
  private measuringInFlight = false;
  private activateOnMeasure = false;
  private measuringAnnounced = false;
  private active = false;
  private wantPlaying = false;
  private prefetchFrames = 0;
  private maxPrefetchedFrames = 0;
  private runNeeded = 0;
  private preparing: { needed: number; t0: number; pct: number } | null = null;
  private prepareBegun = false;
  private storedComplete = false;
  private hostInitialized = false;
  private cleanedAtFilmEnd = false;
  private checkingInFlight = false;

  private listeners: Record<PlayerEvent, Set<(detail?: unknown) => void>> = {
    ready: new Set(),
    buffering: new Set(),
    error: new Set(),
    mode: new Set()
  };

  constructor(options: PlatePlayerOptions) {
    this.sceneId = options.id ?? "scene-0";
    this.sceneIdx = typeof options.sceneIndex === "number" ? options.sceneIndex : 0;
    this.traceContext = options.traceContext;
    this.needsPlaybackMeasure = Boolean(options.needsPlaybackMeasure);
    this.onPlaybackSamples = options.onPlaybackSamples;
    this.activeDrawWorkFn = options.activeDrawWork;
    this.bundleDigest = options.bundleDigest;
    this.html = options.html;
    this.params = options.params ? { ...options.params } : {};
    this.previewSize = previewSizeForAspect(options.aspect ?? "16:9", options.fullWidth, options.fullHeight);
    const defaultMode: PlaybackRenderMode =
      isPlateLiveEnabled() && isPlateDraftPreviewEnabled() ? "draft" : "full";
    this.requestedRenderMode = options.renderMode ? normalizePlaybackRenderMode(options.renderMode) : defaultMode;
    this.look = typeof options.look === "string" ? options.look : null;
    this.explicitDraftTargetVertices =
      options.draftTargetVerticesPerFrame !== undefined
        ? validateDraftTargetVerticesPerFrame(options.draftTargetVerticesPerFrame)
        : null;
    const initialDraftSpec = this.resolveDraftSpec();
    this.draftTargetVertices = initialDraftSpec.draftTargetVerticesPerFrame;
    this.currentQualitySpec =
      this.requestedRenderMode === "full" ? FULL_QUALITY_SPEC : initialDraftSpec;
    this.unsubDraftTargetChange = onDraftTargetVerticesChange(() => {
      this.syncResolvedDraftQuality();
    });
    this.unsubDraftStylePolicyChange = onDraftStylePolicyChange(() => {
      this.syncResolvedDraftQuality();
    });
    this.pauseStillDebounceMs = Math.max(0, options.pauseStillDebounceMs ?? PAUSE_STILL_DEBOUNCE_MS);
    this.currentCacheKey = this.computeCacheKey();
    this.store = options.frameStore ?? null;
    this.filmKey = options.filmKey ?? "default-film";
    this.variantKey = options.variantKey ?? `${this.filmKey}:${this.sceneId}`;
    this.nowMs = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.hostOptions = options.hostOptions;
    this.transportFactory = options.transportFactory;

    const fps = options.fps ?? 30;
    const frames = options.frames ?? 90;
    this.frameStep = Math.max(1, Math.floor(options.frameStep ?? PREVIEW_FRAME_STEP));
    this.previewFrames = previewFrameCount(frames, this.frameStep);
    this.previewFps = previewRate(fps, this.frameStep);
    this.meta = {
      width: this.previewSize.width,
      height: this.previewSize.height,
      fps,
      frames,
      sceneSpans: [{ id: this.sceneId, start: 0, end: frames / fps }]
    };

    const defaultBudget =
      this.requestedRenderMode === "draft" ? resolveDraftCacheBudgetBytes() : resolveCacheBudgetBytes();
    const budgetBytes = options.budgetBytes ?? options.cache?.budget ?? defaultBudget;
    this.ownsCache = !options.cache;
    this.cache = options.cache ?? new FrameCache<ImageBitmapLike>(budgetBytes);
    this.windowSplit = computeRollingWindow(
      this.cache.budget,
      this.previewSize.bytesPerFrame,
      options.hasNextScene ?? false
    );

    this.gateSampleFrames = Math.max(1, options.gateSampleFrames ?? 3);
    this.autoPump = options.autoPump ?? true;

    if (options.environment !== undefined) {
      this.envState = environmentStatus(options.environment);
      this.envSupported = supportsWorkerHost(options.environment);
    } else if (options.host || options.transportFactory || options.hostOptions?.transportFactory) {
      this.envState = "verified";
      this.envSupported = true;
    } else {
      this.envState = environmentStatus();
      this.envSupported = supportsWorkerHost();
    }

    if (options.forceClipReason) {
      this.ownsHost = false;
      this.host = null;
      this.currentDecision = {
        mode: "clip",
        state: "clip",
        reason: options.forceClipReason
      };
    } else if (!this.envSupported) {
      this.ownsHost = false;
      this.host = null;
      this.currentDecision = {
        mode: "clip",
        state: "clip",
        reason: this.envState === "unverified" ? "unverified-environment" : "unsupported-environment"
      };
    } else if (!this.html.trim()) {
      this.ownsHost = false;
      this.host = null;
      this.currentDecision = {
        mode: "clip",
        state: "clip",
        reason: "no-bundle"
      };
    } else if (options.host) {
      this.ownsHost = false;
      this.host = options.host;
    } else {
      this.ownsHost = true;
      // Note: WorkerHost constructor does not spawn an iframe or Worker until `init()` or `frame()` is called.
      this.host = new WorkerHost({
        html: this.html,
        params: this.params,
        budgetBytes: this.cache.budget,
        ...(options.transportFactory ? { transportFactory: options.transportFactory } : {}),
        ...(options.hostOptions ?? {})
      });
    }

    if (this.host) {
      this.host.onUnhealthy((reason) => {
        if (this.checkingInFlight) return;
        if (this.isDocumentHidden() && isWatchdogTimeoutError(reason)) {
          this.resetHostForRetry();
          return;
        }
        this.switchToClip(`worker-unhealthy:${reason}`);
      });
    }

    this.scheduler = new FrameScheduler<ImageBitmapLike>({
      cache: this.cache,
      scenes: [{ id: this.cacheKey, frames: this.previewFrames }],
      fps: this.previewFps,
      now: this.nowMs,
      lookahead: Math.min(this.decodedWindowCap(), Math.max(1, this.windowSplit.aheadFrames)),
      head: 0,
      behind: this.effectiveRenderMode === "draft" ? DRAFT_BEHIND_FRAMES : 0,
      strictAhead: true,
      draw: async (sceneKey, previewIdx) => {
        if (this.currentDecision.mode === "clip" || this.isDestroyed) {
          throw new Error("Player is in clip mode or destroyed.");
        }
        const drawEpoch = this.requestEpoch;
        // 1. In Full mode, if the frame is already prepared on disk in FrameStore, load and decode the stored copy without calling WorkerHost!
        if (
          this.shouldUseStore() &&
          this.store!.hasFrame(this.bundleDigest, this.previewSize.label, previewIdx)
        ) {
          const loaded = await this.store!.load(storeFrameKey(this.bundleDigest, this.previewSize.label, previewIdx));
          if (loaded) {
            if (this.isDestroyed || this.isClip() || this.requestEpoch !== drawEpoch || sceneKey !== this.cacheKey) {
              try {
                loaded.close();
              } catch {}
              throw new Error("Player destroyed, switched to clip, or changed mode during store load.");
            }
            return { value: loaded, bytes: this.previewSize.bytesPerFrame };
          }
        }
        // 2. Otherwise draw with the scene code in WorkerHost at the active quality spec (`draft` or `full`).
        const res = await this.timedFrame(
          sourceFrameForPreview(previewIdx, this.meta.frames, this.frameStep),
          this.currentQualitySpec,
          drawEpoch
        );
        if (this.isDestroyed || this.isClip() || this.requestEpoch !== drawEpoch || sceneKey !== this.cacheKey) {
          try {
            res.bitmap.close();
          } catch {}
          throw new Error("Player destroyed, switched to clip, or changed mode during draw.");
        }
        // Draft fast path (§3.1 & §5.3): keep raw ImageBitmaps in the bounded RAM buffer without WebP encoding or IndexedDB writes.
        if (!this.shouldUseStore()) {
          return { value: res.bitmap, bytes: res.bytes };
        }
        // Full mode:
        // - A frame shown at the moment it is drawn is the freshly drawn bitmap (exact), while `saveFrameToStore` encodes a copy in the background.
        // - A frame drawn ahead of playback is saved to FrameStore and shown from the stored copy at the chosen quality (0.4 by default).
        const shownAtMomentDrawn =
          this.active && previewIdx === this.currentFrame && this.lastShownFrame !== previewIdx && this.preparing === null;
        if (shownAtMomentDrawn) {
          void this.saveFrameToStore(previewIdx, res.bitmap);
          return { value: res.bitmap, bytes: res.bytes };
        }
        const resolved = await this.saveAndDecodeForWindow(previewIdx, res.bitmap, res.bytes);
        return { value: resolved.bitmap, bytes: resolved.bytes };
      },
      onError: (_scene, _frame, err) => {
        if (this.host?.unhealthy) {
          this.switchToClip("worker-unhealthy");
        } else {
          this.emit("error", err);
        }
      }
    });
    this.scheduler.focus(this.cacheKey, 0, this.ownsCache);
  }

  get cacheKey(): string {
    return this.currentCacheKey;
  }

  get renderMode(): PlaybackRenderMode {
    return this.requestedRenderMode;
  }

  get effectiveRenderMode(): PlaybackRenderMode {
    return this.legacyBundleFallback ? "full" : this.requestedRenderMode;
  }

  get draftTargetVerticesPerFrame(): number {
    return this.draftTargetVertices;
  }

  get lookId(): string | null {
    return this.look;
  }

  get qualitySpec(): Readonly<DraftQualitySpec> {
    return this.currentQualitySpec;
  }

  private resolveDraftSpec(): Readonly<DraftQualitySpec> {
    return resolveDraftQualitySpecForStyle({
      look: this.look,
      explicitTargetVertices: this.explicitDraftTargetVertices
    });
  }

  private syncResolvedDraftQuality(): void {
    const nextDraftSpec = this.resolveDraftSpec();
    const nextTarget = nextDraftSpec.draftTargetVerticesPerFrame;
    const nextActiveSpec = this.effectiveRenderMode === "full" ? FULL_QUALITY_SPEC : nextDraftSpec;
    const prevProfileKey = draftQualityProfileKey(this.currentQualitySpec);
    const nextProfileKey = draftQualityProfileKey(nextActiveSpec);
    if (nextTarget === this.draftTargetVertices && prevProfileKey === nextProfileKey) {
      return;
    }
    this.cleanedAtFilmEnd = false;
    const prevCacheKey = this.currentCacheKey;
    this.draftTargetVertices = nextTarget;
    this.lastCalibration = null;
    this.currentQualitySpec = nextActiveSpec;
    this.currentCacheKey = this.computeCacheKey();
    this.requestEpoch++;
    this.cancelStillUpgrade(true);
    if (prevCacheKey !== this.currentCacheKey) {
      this.cache.drop(prevCacheKey);
    }
    this.scheduler.setScenes([{ id: this.currentCacheKey, frames: this.previewFrames }], this.ownsCache);
    this.scheduler.focus(this.currentCacheKey, this.currentFrame, this.active || this.ownsCache);
    this.aloneSamples.length = 0;
    this.contendedSamples.length = 0;
    this.playbackAloneSamples.length = 0;
    this.lastShownFrame = null;
    this.lastTarget = null;
    if (this.active && !this.isDestroyed && !this.isClip() && this.effectiveRenderMode === "draft") {
      this.showFrame(this.currentFrame * this.frameStep);
      if (!this.wantPlaying) {
        this.scheduleStillUpgrade();
      }
    } else {
      this.publish();
    }
  }

  get stillUpgradeState(): StillUpgradeState {
    return this.stillState;
  }

  get lastStats(): Record<string, unknown> | null {
    return this.lastFrameStats;
  }

  get lastSceneCalibration(): Record<string, unknown> | null {
    return this.lastCalibration;
  }

  get uniquePresentedFrameCount(): number {
    return this.presentedFramesSet.size;
  }

  get totalPresentedBlits(): number {
    return this.presentedBlits;
  }

  /** Read-only counter of frames blitted to the visible canvas. */
  get presentedFrames(): number {
    return this.presentedCanvasFrames;
  }

  get lastPresentedSourceFrame(): number | null {
    return this.lastPresentedSrcFrame;
  }

  get lastPresentedQuality(): string | null {
    return this.lastPresentedQualityMode;
  }

  private computeCacheKey(): string {
    if (this.effectiveRenderMode === "draft") {
      return sceneCacheKey(
        this.bundleDigest,
        this.previewSize.label,
        draftQualityProfileKey(this.currentQualitySpec)
      );
    }
    return sceneCacheKey(this.bundleDigest, this.previewSize.label);
  }

  private shouldUseStore(): boolean {
    return this.effectiveRenderMode === "full" && this.store !== null && !this.store.disabled;
  }

  /** Explicit 3g player state: `drawing`, `ready`, `playing`, `buffering`, or `clip`. */
  get state(): PlaybackState {
    if (this.currentDecision.mode === "clip") return "clip";
    if (!this.isMeasured || this.preparing !== null) return "drawing";
    if (this.isBuffering) return "buffering";
    if (this.active && this.wantPlaying) return "playing";
    return "ready";
  }

  setWantPlaying(playing: boolean): void {
    const prev = this.wantPlaying;
    this.wantPlaying = playing;
    if (playing) {
      this.cleanedAtFilmEnd = false;
      this.cancelStillUpgrade(true);
    } else if (prev && !playing && this.active && !this.isBuffering && !this.preparing && !this.cleanedAtFilmEnd) {
      this.scheduleStillUpgrade();
    }
  }

  /**
   * Switches playback render mode (`"draft"` vs `"full"`).
   * Cancels any pending pause-still upgrade, drops the previous mode's RAM frames, and re-schedules around `currentFrame`.
   * Never triggers `QualityJob`.
   */
  setRenderMode(mode: PlaybackRenderMode): void {
    const normalized = normalizePlaybackRenderMode(mode);
    if (normalized === this.requestedRenderMode && !this.legacyBundleFallback) return;
    this.cleanedAtFilmEnd = false;
    const prevCacheKey = this.currentCacheKey;
    this.requestedRenderMode = normalized;
    const nextDraftSpec = this.resolveDraftSpec();
    this.draftTargetVertices = nextDraftSpec.draftTargetVerticesPerFrame;
    this.currentQualitySpec = this.effectiveRenderMode === "full" ? FULL_QUALITY_SPEC : nextDraftSpec;
    this.currentCacheKey = this.computeCacheKey();
    this.requestEpoch++;
    this.cancelStillUpgrade(true);
    if (prevCacheKey !== this.currentCacheKey) {
      this.cache.drop(prevCacheKey);
    }
    this.scheduler.setScenes([{ id: this.currentCacheKey, frames: this.previewFrames }], this.ownsCache);
    this.scheduler.focus(this.currentCacheKey, this.currentFrame, this.active || this.ownsCache);
    this.aloneSamples.length = 0;
    this.contendedSamples.length = 0;
    this.playbackAloneSamples.length = 0;
    this.lastShownFrame = null;
    this.lastTarget = null;
    this.storedComplete =
      this.shouldUseStore() &&
      this.store!.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames);
    if (this.active && !this.isDestroyed && !this.isClip()) {
      this.showFrame(this.currentFrame * this.frameStep);
      if (!this.wantPlaying && this.effectiveRenderMode === "draft") {
        this.scheduleStillUpgrade();
      }
    } else {
      this.publish();
    }
  }

  /**
   * Explicitly overrides the draft geometry budget for this player instance (`draftTargetVerticesPerFrame`),
   * or clears the per-player override when `null` is passed (returning to the per-style policy / global target).
   */
  setDraftTargetVertices(targetVertices: number | null): void {
    this.explicitDraftTargetVertices =
      targetVertices !== null && targetVertices !== undefined
        ? validateDraftTargetVerticesPerFrame(targetVertices)
        : null;
    this.syncResolvedDraftQuality();
  }

  /**
   * Updates this player's look/style identifier and re-resolves its Draft quality spec, calibration, and cache key.
   */
  setLook(look: string | null | undefined): void {
    const nextLook = typeof look === "string" ? look : null;
    if (nextLook === this.look) return;
    this.look = nextLook;
    this.syncResolvedDraftQuality();
  }

  private closeHeldStillBitmap(): void {
    if (this.heldStillBitmap) {
      try {
        this.heldStillBitmap.close();
      } catch {}
      this.heldStillBitmap = null;
      this.heldStillFrame = null;
    }
  }

  private cancelStillUpgrade(closeHeldStill = false): void {
    this.stillEpoch++;
    if (this.stillTimer !== null) {
      clearTimeout(this.stillTimer);
      this.stillTimer = null;
    }
    if (closeHeldStill) {
      this.closeHeldStillBitmap();
    }
    if (this.stillState !== "idle") {
      this.stillState = "idle";
      if (!this.isDestroyed && !this.isClip()) {
        this.publish();
      }
    }
  }

  /**
   * Schedules a 250 ms debounced full-quality still upgrade when intentionally paused in Draft mode (§3.2 & §5.4).
   * Never runs during buffer underruns (`this.isBuffering === true`) or while preparing (`this.preparing !== null`).
   */
  scheduleStillUpgrade(): void {
    if (
      this.isDestroyed ||
      this.isClip() ||
      !this.active ||
      this.wantPlaying ||
      this.isBuffering ||
      this.preparing !== null ||
      this.effectiveRenderMode !== "draft"
    ) {
      return;
    }
    const targetPreviewIdx = this.currentFrame;
    if (this.stillState === "showing-still" && this.heldStillFrame === targetPreviewIdx && this.heldStillBitmap) {
      return;
    }
    this.stillEpoch++;
    const epoch = this.stillEpoch;
    if (this.stillTimer !== null) {
      clearTimeout(this.stillTimer);
      this.stillTimer = null;
    }
    this.stillState = "pending-still";
    this.publish();

    this.stillTimer = setTimeout(() => {
      this.stillTimer = null;
      void this.executeStillUpgrade(targetPreviewIdx, epoch);
    }, this.pauseStillDebounceMs);
  }

  private async executeStillUpgrade(targetPreviewIdx: number, epoch: number): Promise<void> {
    if (
      this.isDestroyed ||
      this.isClip() ||
      epoch !== this.stillEpoch ||
      !this.active ||
      this.wantPlaying ||
      this.isBuffering ||
      this.preparing !== null ||
      this.effectiveRenderMode !== "draft" ||
      this.currentFrame !== targetPreviewIdx
    ) {
      return;
    }
    this.stillState = "drawing-still";
    this.publish();

    const sourceFrame = sourceFrameForPreview(targetPreviewIdx, this.meta.frames, this.frameStep);
    try {
      const host = await this.ensureHostInitialized();
      if (
        this.isDestroyed ||
        this.isClip() ||
        epoch !== this.stillEpoch ||
        this.wantPlaying ||
        this.currentFrame !== targetPreviewIdx
      ) {
        return;
      }
      const res = await host.frame(sourceFrame, {
        qualitySpec: FULL_QUALITY_SPEC,
        epoch
      });
      if (
        this.isDestroyed ||
        this.isClip() ||
        epoch !== this.stillEpoch ||
        !this.active ||
        this.wantPlaying ||
        this.isBuffering ||
        this.effectiveRenderMode !== "draft" ||
        this.currentFrame !== targetPreviewIdx
      ) {
        try {
          res.bitmap.close();
        } catch {}
        return;
      }
      this.closeHeldStillBitmap();
      this.heldStillBitmap = res.bitmap;
      this.heldStillFrame = targetPreviewIdx;
      this.lastShownFrame = targetPreviewIdx;
      const bmFrame =
        typeof (res.bitmap as unknown as { __sceneFrame?: number }).__sceneFrame === "number"
          ? (res.bitmap as unknown as { __sceneFrame: number }).__sceneFrame
          : sourceFrame;
      this.lastPresentedSrcFrame = bmFrame;
      this.lastPresentedQualityMode = "full";
      this.presentedFramesSet.add(bmFrame);
      this.presentedBlits++;
      if (this.ctx && this.canvas) {
        try {
          if (this.canvas.dataset) {
            this.canvas.dataset.sceneId = this.sceneId;
            this.canvas.dataset.presentedFrame = String(bmFrame);
            this.canvas.dataset.presentedQuality = "full";
          }
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.drawImage(res.bitmap as unknown as CanvasImageSource, 0, 0, this.canvas.width, this.canvas.height);
          this.presentedCanvasFrames++;
        } catch {}
      } else {
        this.presentedCanvasFrames++;
      }
      this.stillState = "showing-still";
      this.publish();
    } catch {
      if (epoch === this.stillEpoch && !this.isDestroyed && !this.isClip()) {
        this.stillState = "idle";
        this.publish();
      }
    }
  }

  get bufferingPauses(): number {
    return this.bufferingCount;
  }

  get isBufferingNow(): boolean {
    return this.isBuffering;
  }

  get currentPreviewFrame(): number {
    return this.currentFrame;
  }

  decision(): PlayerDecision {
    return {
      ...this.currentDecision,
      state: this.state,
      renderMode: this.requestedRenderMode,
      effectiveRenderMode: this.effectiveRenderMode,
      stillUpgradeState: this.stillState,
      draftTargetVerticesPerFrame: this.draftTargetVertices
    };
  }

  /** Cache key for a specific source frame index: `bundleDigest | frame | previewSize [| qualityKey]`. */
  keyForFrame(frame: number): string {
    if (this.effectiveRenderMode === "draft") {
      return frameCacheKey(
        this.bundleDigest,
        frame,
        this.previewSize.label,
        draftQualityProfileKey(this.currentQualitySpec)
      );
    }
    return frameCacheKey(this.bundleDigest, frame, this.previewSize.label);
  }

  get drawCostMs(): number {
    return this.scheduler.cost;
  }

  /** Recent mean draw cost in ms across the last few draws of this scene (`aloneSamples` / `contendedSamples` or scheduler cost). */
  get recentDrawMsMean(): number {
    const recent = (this.aloneSamples.length ? this.aloneSamples : this.contendedSamples).slice(-5);
    if (recent.length > 0) {
      return Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 100) / 100;
    }
    return Math.round(this.scheduler.cost * 100) / 100;
  }

  /** Current state of this scene's Worker (`"initialising" | "drawing" | "idle"`). */
  get workerState(): "initialising" | "drawing" | "idle" {
    if (!this.host || !this.host.hasActiveTransport) {
      return this.measuringInFlight ? "initialising" : "idle";
    }
    if (!this.hostInitialized || (this.measuringInFlight && !this.isMeasured)) {
      return "initialising";
    }
    if (this.pumping || this.measuringInFlight || this.scrubDrawInFlight || this.stillState === "drawing-still") {
      return "drawing";
    }
    return "idle";
  }

  get workerHost(): WorkerHost | null {
    return this.host;
  }

  get isEnvSupported(): boolean {
    return this.envSupported;
  }

  get envStatus(): "verified" | "unverified" | "unsupported" {
    return this.envState;
  }

  setCheckingInFlight(checking: boolean): void {
    this.checkingInFlight = checking;
  }

  forceClipFallback(reason: string): void {
    this.switchToClip(reason);
    if (this.ownsHost && this.host) {
      try {
        this.host.terminateIdle(reason);
      } catch {}
    }
  }

  /**
   * Recreates a clean `WorkerHost` before retrying a transient check failure so a previous watchdog termination
   * or crashed transport does not poison the retry attempt.
   */
  resetHostForRetry(): void {
    if (this.isDestroyed || !this.ownsHost || !this.envSupported || !this.html.trim()) return;
    if (this.host) {
      try {
        this.host.destroy();
      } catch {}
    }
    this.hostInitialized = false;
    this.firstSampleAfterInit = true;
    this.isMeasured = false;
    this.measurePromise = null;
    this.reinitPromise = null;
    this.measuringInFlight = false;
    this.aloneSamples.length = 0;
    this.contendedSamples.length = 0;
    this.playbackAloneSamples.length = 0;
    this.currentDecision = { mode: "live", reason: "ok", state: "drawing" };
    this.host = new WorkerHost({
      html: this.html,
      params: this.params,
      budgetBytes: this.cache.budget,
      ...(this.transportFactory ? { transportFactory: this.transportFactory } : {}),
      ...(this.hostOptions ?? {})
    });
    this.host.onUnhealthy((reason) => {
      if (this.checkingInFlight) return;
      if (this.isDocumentHidden() && isWatchdogTimeoutError(reason)) {
        this.resetHostForRetry();
        return;
      }
      this.switchToClip(`worker-unhealthy:${reason}`);
    });
  }

  /** The pre-draw plan from the first measurement (`L`, `W`, draw and play rates), or null before the scene is mounted. */
  get predrawPlan(): PredrawDecision | null {
    return this.plan ? { ...this.plan } : null;
  }

  /** Whether a draw-ahead pump (or background measure/re-init) is running right now. */
  get isPumping(): boolean {
    return this.pumping || this.measuringInFlight;
  }

  /** Whether the scene is drawing its initial buffer before playback can start. */
  get isPreparing(): boolean {
    return this.preparing !== null;
  }

  /** `live` when the scene draws at least as fast as it plays, `predraw` when frames are drawn ahead first. */
  get playbackVariant(): "live" | "predraw" {
    return this.variant;
  }

  /** Preview indices that are cached in RAM right now (sorted). */
  cachedPreviewFrames(): number[] {
    return this.cache.frameIndices(this.cacheKey).sort((a, b) => a - b);
  }

  /**
   * Bytes this scene reserves for its decoded memory window:
   * - In Draft mode: bounded to `15..30` frames (`DRAFT_NOMINAL_RUNWAY_FRAMES .. DRAFT_MAX_RUNWAY_FRAMES`).
   * - In Full mode: up to `DECODED_WINDOW_FRAMES` = 90 frames.
   */
  reservedBytes(): number {
    if (this.currentDecision.mode === "clip") return 0;
    const bpf = this.previewSize.bytesPerFrame;
    const remaining = Math.max(1, this.previewFrames - this.currentFrame);
    if (this.effectiveRenderMode === "draft") {
      const draftCap = Math.max(this.draftRunwayFrames(), this.maxPrefetchedFrames);
      return Math.min(remaining, draftCap, Math.floor(this.cache.budget / bpf)) * bpf;
    }
    if (this.storedComplete || (this.store && !this.store.disabled)) {
      return Math.min(remaining, DECODED_WINDOW_FRAMES, Math.floor(this.cache.budget / bpf)) * bpf;
    }
    if (this.variant === "predraw") {
      return Math.min(
        remaining,
        Math.floor(this.cache.budget / bpf),
        Math.max(DECODED_WINDOW_FRAMES, this.runNeeded, this.preparing?.needed ?? 0, this.plan?.startFrames ?? 0)
      ) * bpf;
    }
    return Math.min(remaining, DECODED_WINDOW_FRAMES, this.windowSplit.windowFrames) * bpf;
  }

  private draftRunwayFrames(): number {
    const m = this.measured();
    const want = m.ms > 20 ? DRAFT_MAX_RUNWAY_FRAMES : DRAFT_NOMINAL_RUNWAY_FRAMES;
    return Math.min(this.previewFrames, want);
  }

  private saveFrameToStore(previewIdx: number, bitmap: ImageBitmapLike): Promise<boolean> {
    if (!this.shouldUseStore() || this.isDestroyed) return Promise.resolve(false);
    const key = storeFrameKey(this.bundleDigest, this.previewSize.label, previewIdx);
    return this.store!
      .save(bitmap, key, this.store!.quality, {
        frames: this.previewFrames,
        filmKey: this.filmKey,
        variantKey: this.variantKey
      })
      .then((ok) => {
        if (ok && this.store?.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames)) {
          this.storedComplete = true;
        }
        return ok;
      })
      .catch(() => false);
  }

  /**
   * Saves a frame drawn ahead of playback to `FrameStore` (respecting the bounded 8-frame encoder queue),
   * closes the raw drawn bitmap, and decodes the stored copy at the chosen quality (0.4 by default) for the
   * decoded memory window (`FrameCache`).
   */
  private async saveAndDecodeForWindow(
    previewIdx: number,
    rawBitmap: ImageBitmapLike,
    rawBytes: number
  ): Promise<{ bitmap: ImageBitmapLike; bytes: number }> {
    if (!this.shouldUseStore() || this.isDestroyed) {
      return { bitmap: rawBitmap, bytes: rawBytes };
    }
    const key = storeFrameKey(this.bundleDigest, this.previewSize.label, previewIdx);
    const saved = await this.saveFrameToStore(previewIdx, rawBitmap);
    if (this.isDestroyed || this.isClip()) {
      try {
        rawBitmap.close();
      } catch {}
      throw new Error("Player destroyed or switched to clip.");
    }
    if (saved && !this.store!.disabled) {
      const decoded = await this.store!.load(key);
      if (this.isDestroyed || this.isClip()) {
        try {
          rawBitmap.close();
        } catch {}
        try {
          decoded?.close();
        } catch {}
        throw new Error("Player destroyed or switched to clip.");
      }
      if (decoded) {
        try {
          rawBitmap.close();
        } catch {}
        return { bitmap: decoded, bytes: this.previewSize.bytesPerFrame };
      }
    }
    return { bitmap: rawBitmap, bytes: rawBytes };
  }

  private emit(event: PlayerEvent, detail?: unknown) {
    for (const cb of this.listeners[event]) {
      try {
        cb(detail);
      } catch {}
    }
  }

  private switchToClip(reason: string) {
    if (this.currentDecision.mode === "clip") {
      if (this.currentDecision.reason !== reason) {
        this.currentDecision = { mode: "clip", state: "clip", reason };
        this.emit("mode", { mode: "clip" as const, state: "clip" as const, reason });
      }
      return;
    }
    this.finishTraceEpisode();
    this.cancelStillUpgrade(true);
    if (this.lastShownFrame === null && this.cache.has(this.cacheKey, this.currentFrame)) {
      this.blitFrame(this.currentFrame);
    }
    this.currentDecision = { mode: "clip", state: "clip", reason };
    this.preparing = null;
    this.isBuffering = false;
    this.scheduler.pause();
    this.cache.drop(this.cacheKey);
    const payload = { mode: "clip" as const, state: "clip" as const, reason };
    this.emit("mode", payload);
  }

  private publish(extra: Partial<PlayerDecision> = {}) {
    this.currentDecision = {
      mode: "live",
      state: this.state,
      reason: "ok",
      variant: this.variant,
      renderMode: this.requestedRenderMode,
      effectiveRenderMode: this.effectiveRenderMode,
      stillUpgradeState: this.stillState,
      draftTargetVerticesPerFrame: this.draftTargetVertices,
      ...(this.plan ? { neededFrames: this.plan.startFrames, waitSeconds: this.plan.waitSeconds } : {}),
      ...extra
    };
    this.emit("mode", { ...this.currentDecision });
  }

  private isClip(): boolean {
    return this.currentDecision.mode === "clip";
  }

  private async ensureHostInitialized(): Promise<WorkerHost> {
    if (!this.host) {
      throw new Error("No Worker host.");
    }
    if (!this.hostInitialized) {
      await this.host.init({ scale: this.previewSize.scale, params: this.params });
      this.hostInitialized = true;
      this.firstSampleAfterInit = true;
      // Legacy bundle compatibility (§5.1): if bundle lacks draft capability, fall back cleanly to Full for this scene.
      if (this.requestedRenderMode === "draft" && !this.host.supportsDraftQuality && !this.legacyBundleFallback) {
        this.legacyBundleFallback = true;
        const prevKey = this.currentCacheKey;
        this.currentQualitySpec = FULL_QUALITY_SPEC;
        this.currentCacheKey = this.computeCacheKey();
        if (prevKey !== this.currentCacheKey) {
          this.cache.drop(prevKey);
          this.scheduler.setScenes([{ id: this.currentCacheKey, frames: this.previewFrames }], this.ownsCache);
          this.scheduler.focus(this.currentCacheKey, this.currentFrame, this.active || this.ownsCache);
        }
        try {
          console.warn(
            `[PlatePlayer] Scene ${this.sceneId} (${this.bundleDigest}) bundle does not advertise draft capability; falling back to Full live rendering.`
          );
        } catch {}
      }
    }
    return this.host;
  }

  /** Draws one frame in the Worker, counting it in the page-wide work and timing it as alone or contended. */
  private async timedFrame(
    sourceFrame: number,
    qualitySpec: Readonly<DraftQualitySpec> = this.currentQualitySpec,
    epoch: number = this.requestEpoch
  ): Promise<HostFrameResult> {
    const host = await this.ensureHostInitialized();
    const effectiveSpec = this.legacyBundleFallback ? FULL_QUALITY_SPEC : qualitySpec;
    const othersAtStart = work.count;
    const externalBefore = this.activeDrawWorkFn ? this.activeDrawWorkFn() : 0;
    work.count++;
    const t0 = this.nowMs();
    let res: HostFrameResult;
    let contended = othersAtStart > 0 || externalBefore > 0;
    try {
      res = await host.frame(sourceFrame, {
        qualitySpec: effectiveSpec,
        epoch,
        includeCalibration: this.lastCalibration === null && effectiveSpec.mode === "draft"
      });
      if (work.count > 1 || (this.activeDrawWorkFn ? this.activeDrawWorkFn() > 0 : false)) {
        contended = true;
      }
    } finally {
      work.count--;
    }
    if (res.frameStats) {
      this.lastFrameStats = res.frameStats;
    }
    if (res.calibration) {
      this.lastCalibration = res.calibration;
    }
    const ms = res.drawMs > 0 ? res.drawMs : this.nowMs() - t0;
    const isFirstAfterInit = this.firstSampleAfterInit;
    this.firstSampleAfterInit = false;
    const list = contended ? this.contendedSamples : this.aloneSamples;
    list.push(ms);
    if (list.length > MAX_COST_SAMPLES) list.shift();
    if (!isFirstAfterInit && !contended) {
      this.playbackAloneSamples.push(ms);
      this.maybeEmitPlaybackSamples();
    }
    return res;
  }

  private maybeEmitPlaybackSamples(): void {
    if (
      this.playbackSamplesReported ||
      !this.needsPlaybackMeasure ||
      this.isDestroyed ||
      this.isClip() ||
      this.playbackAloneSamples.length < 8
    ) {
      return;
    }
    this.playbackSamplesReported = true;
    const samplesSnapshot = [...this.playbackAloneSamples];
    const evalRes = isSlowScene(samplesSnapshot);
    this.onPlaybackSamples?.({
      medianMs: evalRes.median,
      p90Ms: evalRes.p90,
      samples: evalRes.n,
      aloneSamples: samplesSnapshot
    });
  }

  /**
   * Used by `QualityJob` (both when raising and when lowering quality) to redraw a frame with the scene code
   * at Full quality through the exclusive draw queue so only one scene draws at a time.
   */
  async redrawFrameForQuality(previewIdx: number): Promise<ImageBitmapLike> {
    const sourceFrame = sourceFrameForPreview(previewIdx, this.meta.frames, this.frameStep);
    return runExclusiveMeasure(async () => {
      const res = await this.timedFrame(sourceFrame, FULL_QUALITY_SPEC, this.requestEpoch);
      return res.bitmap;
    });
  }

  /** Reloads a cached frame in the decoded memory window (and re-blits if on screen) when `QualityJob` saves an updated frame. */
  async reloadCachedFrameFromStore(previewIdx: number, key: string): Promise<void> {
    if (this.isDestroyed || this.isClip() || !this.shouldUseStore()) return;
    if (!this.cache.has(this.cacheKey, previewIdx) && this.lastShownFrame !== previewIdx) return;
    const decoded = await this.store!.load(key);
    if (!decoded) return;
    this.replaceCachedFrame(previewIdx, decoded);
  }

  /** Replaces a cached frame in RAM (and re-blits if currently on screen) when `QualityJob` saves an updated frame. */
  replaceCachedFrame(previewIdx: number, bitmap?: ImageBitmapLike): void {
    if (!bitmap || this.isDestroyed) {
      try {
        bitmap?.close();
      } catch {}
      return;
    }
    if (this.cache.has(this.cacheKey, previewIdx) || this.lastShownFrame === previewIdx) {
      this.cache.put(this.cacheKey, previewIdx, bitmap, this.previewSize.bytesPerFrame);
      if (this.lastShownFrame === previewIdx) {
        this.blitFrame(previewIdx);
      }
    } else {
      try {
        bitmap.close();
      } catch {}
    }
  }

  /**
   * The scene's draw cost: the median of recent draws made alone; only when there are none, the median of contended ones.
   */
  private measured(): { ms: number; contended: boolean } {
    if (this.aloneSamples.length) return { ms: median(this.aloneSamples.slice(-5)), contended: false };
    if (this.contendedSamples.length) return { ms: median(this.contendedSamples.slice(-5)), contended: true };
    return { ms: 0, contended: false };
  }

  private decide(idx: number, extra: { elapsedSeconds?: number; readyAhead?: number } = {}): PredrawDecision {
    const m = this.measured();
    const raw = decidePredraw({
      previewFrames: this.previewFrames - idx,
      rate: this.previewFps,
      avgDrawMs: m.ms,
      bytesPerFrame: this.previewSize.bytesPerFrame,
      budgetBytes: this.cache.budget,
      unhealthy: this.host?.unhealthy ?? false,
      supported: this.envSupported,
      envStatus: this.envState,
      ...extra
    });
    if (this.effectiveRenderMode === "draft" && raw.mode !== "clip") {
      // Bounded Draft runway (§3.1 & §5.3): never pre-draw the whole scene into RAM before starting!
      // Start after at most `DRAFT_NOMINAL_RUNWAY_FRAMES` (15 frames = 0.5 s) when fast, or `DRAFT_MAX_RUNWAY_FRAMES` (30 frames = 1.0 s) when slower.
      const remaining = Math.max(1, this.previewFrames - idx);
      const draftStartCap = raw.mode === "live" ? DRAFT_NOMINAL_RUNWAY_FRAMES : DRAFT_MAX_RUNWAY_FRAMES;
      const cappedNeeded = Math.min(remaining, draftStartCap);
      return {
        ...raw,
        neededFrames: cappedNeeded,
        startFrames: cappedNeeded,
        bytesNeeded: cappedNeeded * this.previewSize.bytesPerFrame
      };
    }
    return raw;
  }

  /** Draws `count` missing preview frames from `start` into the cache, timing each one. False when the Worker failed. */
  private async sampleFrames(count: number, start: number): Promise<boolean> {
    const host = this.host;
    if (!host) return false;
    let drawn = 0;
    const sampleEpoch = this.requestEpoch;
    const wantPlaybackSamples = this.needsPlaybackMeasure && !this.playbackSamplesReported;
    const maxExtraForContention = wantPlaybackSamples ? 12 : 0;
    for (
      let k = start;
      k < this.previewFrames &&
      (drawn < count ||
        (wantPlaybackSamples &&
          !this.playbackSamplesReported &&
          !(this.activeDrawWorkFn && this.activeDrawWorkFn() > 0) &&
          this.playbackAloneSamples.length < 8 &&
          drawn < count + maxExtraForContention));
      k++
    ) {
      if (this.isDestroyed || this.isClip() || this.requestEpoch !== sampleEpoch) return false;
      if (this.shouldUseStore() && this.store!.hasFrame(this.bundleDigest, this.previewSize.label, k)) {
        const loaded = await this.store!.load(storeFrameKey(this.bundleDigest, this.previewSize.label, k));
        if (loaded) {
          if (this.isDestroyed || this.isClip() || this.requestEpoch !== sampleEpoch) {
            try {
              loaded.close();
            } catch {}
            return false;
          }
          this.cache.put(this.cacheKey, k, loaded, this.previewSize.bytesPerFrame);
        }
        continue;
      }
      try {
        const res = await this.timedFrame(
          sourceFrameForPreview(k, this.meta.frames, this.frameStep),
          this.currentQualitySpec,
          sampleEpoch
        );
        if (this.isDestroyed || this.isClip() || this.requestEpoch !== sampleEpoch) {
          try {
            res.bitmap.close();
          } catch {}
          return false;
        }
        const shownAtMoment = k === this.currentFrame && this.lastShownFrame === null;
        if (!this.shouldUseStore()) {
          if (!this.active && !this.activateOnMeasure && this.prefetchFrames > 0 && k >= this.prefetchFrames) {
            try {
              res.bitmap.close();
            } catch {}
          } else {
            this.cache.put(this.cacheKey, k, res.bitmap, res.bytes);
            if (shownAtMoment && (this.active || this.activateOnMeasure)) {
              this.blitFrame(k);
            }
          }
        } else if (shownAtMoment) {
          this.cache.put(this.cacheKey, k, res.bitmap, res.bytes);
          if (this.active || this.activateOnMeasure) {
            this.blitFrame(k);
          }
          void this.saveFrameToStore(k, res.bitmap);
        } else {
          const resolved = await this.saveAndDecodeForWindow(k, res.bitmap, res.bytes);
          this.cache.put(this.cacheKey, k, resolved.bitmap, resolved.bytes);
        }
        drawn++;
      } catch (err) {
        if (this.isDocumentHidden() && isWatchdogTimeoutError(err)) {
          this.resetHostForRetry();
          return false;
        }
        if (host.unhealthy) {
          this.switchToClip("worker-unhealthy");
          return false;
        }
        break;
      }
    }
    return drawn > 0 || start > 0;
  }

  /** Whether the live / pre-draw / clip decision for this scene has been made. */
  get measuredYet(): boolean {
    return this.isMeasured;
  }

  /**
   * Decides how the scene plays:
   * - In Full mode, if the scene is already `complete` in `FrameStore`, plays directly from stored frames without creating/initializing
   *   its drawing `WorkerHost` at all!
   * - Otherwise initializes its Worker and draws the first missing preview frames, one scene at a time page-wide.
   */
  measure(): Promise<void> {
    if (!this.measurePromise) {
      this.measuringInFlight = true;
      const p = this.doMeasure().finally(() => {
        this.measuringInFlight = false;
        if (!this.isMeasured && this.measurePromise === p) {
          this.measurePromise = null;
        }
      });
      this.measurePromise = p;
      return p;
    }
    if (
      this.isMeasured &&
      this.host &&
      this.ownsHost &&
      !this.host.hasActiveTransport &&
      !this.storedComplete &&
      !this.isDestroyed &&
      !this.isClip()
    ) {
      if (this.reinitPromise) {
        return this.reinitPromise;
      }
      this.measuringInFlight = true;
      this.firstSampleAfterInit = true;
      const rp = this.host
        .init({ scale: this.previewSize.scale, params: this.params })
        .then(() => {
          if (this.autoPump && !this.isDestroyed && !this.isClip()) {
            if ((!this.active && this.prefetchFrames > 0) || this.active) {
              if (this.scheduler.isPaused) this.scheduler.resume();
              void this.pumpScheduler();
            }
          }
        })
        .finally(() => {
          this.measuringInFlight = false;
          if (this.reinitPromise === rp) {
            this.reinitPromise = null;
          }
        });
      this.reinitPromise = rp;
      return rp;
    }
    return this.measurePromise;
  }

  /**
   * Consecutive frames prepared on disk (`FrameStore`) from `idx`.
   */
  preparedOnDiskAhead(idx: number): number {
    if (!this.shouldUseStore()) return 0;
    let n = 0;
    while (idx + n < this.previewFrames) {
      if (this.store!.hasFrame(this.bundleDigest, this.previewSize.label, idx + n)) {
        n++;
      } else {
        break;
      }
    }
    return n;
  }

  /**
   * Consecutive decoded `ImageBitmap` frames in the decoded memory window (`FrameCache`) from `idx`.
   */
  decodedWindowAhead(idx: number): number {
    return contiguousFrom(this.cache.frameIndices(this.cacheKey), idx);
  }

  /**
   * Consecutive ready preview frames from `idx` (in the decoded memory window `FrameCache` or prepared on disk `FrameStore`).
   */
  readyAhead(idx: number): number {
    const ramSet = new Set(this.cache.frameIndices(this.cacheKey));
    if (!this.shouldUseStore()) {
      return contiguousFrom(ramSet, idx);
    }
    let n = 0;
    while (idx + n < this.previewFrames) {
      const f = idx + n;
      if (ramSet.has(f) || this.store!.hasFrame(this.bundleDigest, this.previewSize.label, f)) {
        n++;
      } else {
        break;
      }
    }
    return n;
  }

  private ramReadyAhead(idx: number): number {
    return this.decodedWindowAhead(idx);
  }

  async mount(el: HTMLElement, options?: { active?: boolean; deferMeasure?: boolean }): Promise<void> {
    if (this.isDestroyed) throw new Error("Player has been destroyed.");
    this.container = el;
    const isActive = options?.active ?? true;

    if (typeof el.ownerDocument?.createElement === "function") {
      const canvas = el.ownerDocument.createElement("canvas");
      canvas.width = this.previewSize.width;
      canvas.height = this.previewSize.height;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      canvas.style.objectFit = "contain";
      if (canvas.dataset) {
        canvas.dataset.sceneId = this.sceneId;
      }
      el.appendChild(canvas);
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
    }

    if (!this.envSupported || !this.host) {
      const payload = { mode: "clip" as const, state: "clip" as const, reason: this.currentDecision.reason };
      this.emit("mode", payload);
      return;
    }

    if (options?.deferMeasure) return;
    this.activateOnMeasure = isActive;
    await this.measure();
  }

  private async doMeasure(): Promise<void> {
    const host = this.host;
    if (!host || !this.envSupported || this.isDestroyed || this.isClip()) return;

    if (this.shouldUseStore()) {
      await this.store!.registerScene({
        bundleDigest: this.bundleDigest,
        sizeLabel: this.previewSize.label,
        frames: this.previewFrames,
        filmKey: this.filmKey,
        variantKey: this.variantKey
      });
      if (this.isDestroyed || this.isClip()) return;

      // Check if every frame of this scene is already saved in FrameStore (complete scene):
      // If so, play it from FrameStore WITHOUT creating/initializing the drawing Worker at all!
      if (this.store!.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames)) {
        this.storedComplete = true;
        const startNeeded = Math.min(this.previewFrames, START_BUFFER_FRAMES);
        this.plan = {
          mode: "live",
          reason: "ok",
          neededFrames: startNeeded,
          startFrames: startNeeded,
          waitSeconds: 0,
          produceFps: this.previewFps,
          plannedProduceFps: this.previewFps,
          plannedDrawMs: 1000 / this.previewFps,
          safetyMargin: DRAW_TIME_SAFETY_MARGIN,
          consumeFps: this.previewFps,
          bytesNeeded: startNeeded * this.previewSize.bytesPerFrame,
          budgetFrames: Math.floor(this.cache.budget / this.previewSize.bytesPerFrame)
        };
        this.variant = "live";
        this.runNeeded = startNeeded;
        this.isMeasured = true;

        const initialPrefetch = Math.min(
          this.previewFrames,
          DECODED_WINDOW_FRAMES,
          Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame))
        );
        await this.prefetchFromStore(this.currentFrame, initialPrefetch);
        if (this.isDestroyed || this.isClip()) return;

        if ((this.active || this.activateOnMeasure) && this.cache.has(this.cacheKey, this.currentFrame) && this.lastShownFrame === null) {
          this.blitFrame(this.currentFrame);
        }
        this.active = this.activateOnMeasure || this.active;
        this.publish({ reason: "ok", state: this.state });
        if (!this.readyEmitted) {
          this.readyEmitted = true;
          this.emit("ready", { neededFrames: startNeeded, bufferedAheadSeconds: startNeeded / this.previewFps });
        }
        if (this.autoPump && !this.isDestroyed && this.currentDecision.mode === "live") {
          void this.pumpScheduler();
        }
        return;
      }
    }

    const ok = await runExclusiveMeasure(async () => {
      if (this.isDestroyed || this.isClip()) return false;
      try {
        await this.ensureHostInitialized();
      } catch (err) {
        if (this.isDocumentHidden() && isWatchdogTimeoutError(err)) {
          this.resetHostForRetry();
          return false;
        }
        this.switchToClip(host.unhealthy ? "worker-unhealthy" : `init-failed:${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
      let sampleStart = this.currentFrame;
      if (this.shouldUseStore()) {
        const firstMissing = this.store!.firstMissingFrame(this.bundleDigest, this.previewSize.label, this.previewFrames);
        if (firstMissing !== null && firstMissing > sampleStart) {
          await this.prefetchFromStore(sampleStart, Math.min(firstMissing - sampleStart, PLAYBACK_WINDOW_FRAMES));
          sampleStart = firstMissing;
        }
      }
      const minMeasureSamples =
        this.needsPlaybackMeasure && !this.playbackSamplesReported
          ? Math.max(this.gateSampleFrames, 9)
          : this.gateSampleFrames;
      const count = Math.min(minMeasureSamples, Math.max(1, this.previewFrames - sampleStart));
      return this.sampleFrames(count, sampleStart);
    });
    if (!ok || this.isDestroyed || this.isClip()) return;

    if (host.unhealthy || (this.aloneSamples.length === 0 && this.contendedSamples.length === 0)) {
      this.switchToClip("worker-unhealthy");
      return;
    }

    const plan = this.decide(0);
    this.plan = plan;
    this.isMeasured = true;

    if (plan.mode === "clip") {
      this.switchToClip(plan.reason);
      return;
    }

    this.variant = plan.mode === "predraw" ? "predraw" : "live";
    this.runNeeded = plan.startFrames;
    this.publish({ reason: this.variant === "predraw" ? "predraw" : plan.reason });

    // Blit frame 0 immediately if active and available.
    if ((this.active || this.activateOnMeasure) && this.cache.has(this.cacheKey, 0) && this.lastShownFrame === null) {
      this.blitFrame(0);
    }

    if (!this.activateOnMeasure && !this.active) {
      if (!this.readyEmitted) {
        this.readyEmitted = true;
        this.emit("ready", { neededFrames: plan.startFrames, waitSeconds: plan.waitSeconds });
      }
      if (this.autoPump && this.prefetchFrames > 0 && !this.isDestroyed && this.currentDecision.mode === "live") {
        if (this.scheduler.isPaused) this.scheduler.resume();
        if (
          this.effectiveRenderMode === "full" &&
          this.variant === "predraw" &&
          !this.prepareBegun &&
          !this.storedComplete
        ) {
          this.currentFrame = 0;
          this.beginPrepare(0);
        }
        if (this.currentDecision.mode === "live") {
          void this.pumpScheduler();
        }
      }
      return;
    }

    this.active = true;
    if (this.variant === "predraw") {
      this.lastTarget = this.currentFrame;
      this.beginPrepare(this.currentFrame);
      if (this.autoPump && !this.isDestroyed && this.currentDecision.mode === "live") {
        void this.pumpScheduler();
      }
      return;
    }

    await this.fillUntilGate(plan.startFrames);

    if (this.autoPump && !this.isDestroyed && this.currentDecision.mode === "live") {
      void this.pumpScheduler();
    }
    if (this.active && !this.wantPlaying && !this.preparing && this.effectiveRenderMode === "draft") {
      this.scheduleStillUpgrade();
    }
  }

  private async prefetchFromStore(fromFrame: number, count: number): Promise<number> {
    if (!this.store || this.store.disabled) return 0;
    let loadedCount = 0;
    const end = Math.min(this.previewFrames, fromFrame + count);
    for (let f = fromFrame; f < end; f++) {
      if (this.isDestroyed || this.isClip()) break;
      if (this.cache.has(this.cacheKey, f)) {
        loadedCount++;
        continue;
      }
      if (!this.store.hasFrame(this.bundleDigest, this.previewSize.label, f)) break;
      const bm = await this.store.load(storeFrameKey(this.bundleDigest, this.previewSize.label, f));
      if (!bm) break;
      if (this.isDestroyed || this.isClip()) {
        try {
          bm.close();
        } catch {}
        break;
      }
      this.cache.put(this.cacheKey, f, bm, this.previewSize.bytesPerFrame);
      loadedCount++;
    }
    return loadedCount;
  }

  private async fillUntilGate(neededFrames: number): Promise<void> {
    const target = Math.min(neededFrames, this.previewFrames);
    while (!this.isDestroyed && this.currentDecision.mode === "live" && this.variant === "live") {
      const ahead = this.readyAhead(this.currentFrame);
      if (ahead >= target) {
        if (!this.readyEmitted) {
          this.readyEmitted = true;
          this.emit("ready", { neededFrames: target, bufferedAheadSeconds: ahead / this.previewFps });
        }
        return;
      }
      this.configureWindow();
      const drew = await this.scheduler.runNext();
      if (!drew) {
        if (this.host?.unhealthy) {
          this.switchToClip("worker-unhealthy");
        } else if (!this.readyEmitted) {
          this.readyEmitted = true;
          this.emit("ready", { neededFrames: target, bufferedAheadSeconds: ahead / this.previewFps });
        }
        return;
      }
      if (this.scheduler.cost > 0) this.reassessLive();
    }
  }

  /** A scene that was fast at the first measurement and turned out slow switches to pre-draw buffering. */
  private reassessLive() {
    if (this.variant !== "live" || this.currentDecision.mode !== "live" || this.storedComplete) return;
    const d = this.decide(this.currentFrame);
    if (d.mode === "clip") {
      this.switchToClip(d.reason);
    } else if (d.mode === "predraw") {
      this.variant = "predraw";
      this.plan = d;
      this.runNeeded = d.startFrames;
      this.lastTarget = null;
      this.beginPrepare(this.currentFrame);
    }
  }

  /**
   * Decoded memory window (`decodedWindow`):
   * - In Draft mode: bounded to `15..30` frames (`DRAFT_NOMINAL_RUNWAY_FRAMES .. DRAFT_MAX_RUNWAY_FRAMES`).
   * - In Full mode: up to `DECODED_WINDOW_FRAMES` (90 frames, ~3 s at 30 fps) decoded ahead in `FrameCache` within `resolveCacheBudgetBytes`.
   */
  decodedWindowCap(): number {
    const remaining = Math.max(1, this.previewFrames - this.currentFrame);
    const other = this.cache.bytes - this.cache.sceneBytes(this.cacheKey);
    const room = Math.max(1, Math.floor((this.cache.budget - other) / this.previewSize.bytesPerFrame));
    if (this.effectiveRenderMode === "draft") {
      if (!this.active) {
        return Math.max(0, Math.min(this.previewFrames, DRAFT_NEXT_SCENE_HEAD_FRAMES, this.prefetchFrames, room));
      }
      return Math.max(
        1,
        Math.min(remaining, Math.max(this.draftRunwayFrames(), this.runNeeded, this.maxPrefetchedFrames), room)
      );
    }
    if (!this.active) {
      const want =
        this.shouldUseStore()
          ? DECODED_WINDOW_FRAMES
          : Math.max(DECODED_WINDOW_FRAMES, this.runNeeded, this.plan?.startFrames ?? DECODED_WINDOW_FRAMES);
      return Math.max(0, Math.min(this.previewFrames, want, this.prefetchFrames, room));
    }
    if (this.storedComplete || this.shouldUseStore()) {
      return Math.max(1, Math.min(remaining, DECODED_WINDOW_FRAMES, room));
    }
    // Only when no FrameStore exists (in-memory-only unit tests), predraw holds `runNeeded` in RAM within `room`.
    const want = this.variant === "predraw" ? Math.max(DECODED_WINDOW_FRAMES, this.runNeeded) : DECODED_WINDOW_FRAMES;
    return Math.max(1, Math.min(remaining, want, room));
  }

  private aheadCap(): number {
    return this.decodedWindowCap();
  }

  private configureWindow() {
    const cap = Math.max(1, this.decodedWindowCap());
    const behind = this.effectiveRenderMode === "draft" ? DRAFT_BEHIND_FRAMES : 0;
    this.scheduler.setWindow({ lookahead: cap, behind, head: 0, strictAhead: true });
  }

  /** Closes every cached frame behind the playhead (retaining up to `DRAFT_BEHIND_FRAMES` in Draft mode), and (on a jump) the ones beyond the decoded memory window. */
  private evictBehind(idx: number, alsoBeyond = false) {
    const retainBehind = this.effectiveRenderMode === "draft" && !alsoBeyond ? DRAFT_BEHIND_FRAMES : 0;
    const minKeep = Math.max(0, idx - retainBehind);
    for (const i of indicesToEvict(this.cache.frameIndices(this.cacheKey), minKeep)) {
      this.cache.release(this.cacheKey, i);
    }
    if (alsoBeyond) {
      const last = idx + Math.max(1, this.decodedWindowCap()) - 1;
      for (const i of this.cache.frameIndices(this.cacheKey)) {
        if (i > last) this.cache.release(this.cacheKey, i);
      }
    }
  }

  /**
   * Starts (or re-starts) the initial `drawing` buffer wait from preview frame `idx`.
   */
  private beginPrepare(idx: number) {
    if (this.currentDecision.mode !== "live" || this.storedComplete) return;
    this.prepareBegun = true;
    const d = this.decide(idx);
    if (d.mode === "clip") {
      this.switchToClip(d.reason);
      return;
    }
    this.plan = d;
    this.currentFrame = idx;
    const remaining = Math.max(1, this.previewFrames - idx);
    const needed =
      this.effectiveRenderMode === "draft"
        ? Math.min(remaining, d.startFrames)
        : startBufferFrames(remaining, d.neededFrames);
    const maxPossible = this.shouldUseStore()
      ? remaining
      : Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame));
    const clampedNeeded = Math.min(needed, maxPossible);
    this.runNeeded = clampedNeeded;
    if (this.autoPump) {
      this.evictBehind(idx, true);
    }

    const ready = this.readyAhead(idx);
    const decodedNeeded = Math.min(clampedNeeded, Math.max(1, this.decodedWindowCap()));
    if (ready >= clampedNeeded && this.decodedWindowAhead(idx) >= decodedNeeded) {
      this.finishPrepare();
    } else {
      this.preparing = { needed: clampedNeeded, t0: this.nowMs(), pct: -1 };
      this.publishProgress(ready, clampedNeeded);
    }
  }

  private publishProgress(ready: number, needed: number) {
    const prep = this.preparing;
    if (!prep) return;
    const progress = predrawProgress(ready, needed);
    const pct = Math.floor(progress * 100);
    if (pct === prep.pct) return;
    prep.pct = pct;
    this.publish({ reason: "predraw", state: "drawing", progress });
  }

  private finishPrepare() {
    const was = this.preparing !== null;
    this.preparing = null;
    if (was || this.currentDecision.progress !== undefined) {
      this.publish({ reason: "ok", state: this.state, progress: undefined });
    }
    if (this.isBuffering) {
      this.isBuffering = false;
      this.finishTraceEpisode();
      this.emit("buffering", { buffering: false, frame: this.currentFrame * this.frameStep });
    }
    if (this.active && this.cache.has(this.cacheKey, this.currentFrame)) {
      this.blitFrame(this.currentFrame);
    }
    if (this.active && !this.readyEmitted) {
      this.readyEmitted = true;
      this.emit("ready", { neededFrames: this.runNeeded });
    }
    if (this.active && !this.wantPlaying && this.effectiveRenderMode === "draft") {
      this.scheduleStillUpgrade();
    }
  }

  /**
   * Called after every draw while in `drawing` (`preparing`).
   */
  private updatePrepare() {
    const prep = this.preparing;
    if (!prep || this.currentDecision.mode !== "live") return;
    let ready = this.readyAhead(this.currentFrame);

    if (
      (this.active || this.activateOnMeasure) &&
      this.aloneSamples.length + this.contendedSamples.length >= this.gateSampleFrames &&
      !this.storedComplete
    ) {
      const elapsed = (this.nowMs() - prep.t0) / 1000;
      const d = this.decide(this.currentFrame, { elapsedSeconds: elapsed, readyAhead: ready });
      if (d.mode === "clip") {
        this.switchToClip(d.reason);
        return;
      }
      this.plan = d;
      const remaining = Math.max(1, this.previewFrames - this.currentFrame);
      const nextNeeded =
        this.effectiveRenderMode === "draft"
          ? Math.min(remaining, d.startFrames)
          : startBufferFrames(remaining, d.neededFrames);
      const maxPossible = this.shouldUseStore()
        ? remaining
        : Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame));
      const clamped = Math.min(nextNeeded, maxPossible);
      prep.needed = clamped;
      this.runNeeded = clamped;
    }

    ready = this.readyAhead(this.currentFrame);
    const decodedNeeded = Math.min(prep.needed, Math.max(1, this.decodedWindowCap()));
    if (ready >= prep.needed && this.decodedWindowAhead(this.currentFrame) >= decodedNeeded) {
      this.finishPrepare();
      return;
    }
    this.publishProgress(ready, prep.needed);
  }

  /**
   * Pumps the draw-ahead scheduler inside the Worker (or prefetches from `FrameStore`) until the decoded memory window
   * and any required prepared-on-disk frames are ready.
   */
  async pumpScheduler(maxFrames = Math.max(DECODED_WINDOW_FRAMES, this.windowSplit.windowFrames, this.previewFrames)): Promise<number> {
    if (this.isDestroyed || this.currentDecision.mode !== "live") return 0;
    if (this.pumping) {
      this.repumpRequested = true;
      return 0;
    }
    this.pumping = true;
    let count = 0;
    try {
      while (!this.isDestroyed && this.currentDecision.mode === "live" && count < maxFrames) {
        if (this.repumpRequested) {
          this.repumpRequested = false;
          count = 0;
        }
        this.configureWindow();
        if (!this.active && this.decodedWindowCap() <= 0) break;
        if (
          measuringExclusiveCount > 0 &&
          this.active &&
          !this.preparing &&
          !this.isBuffering &&
          this.readyAhead(this.currentFrame) >= 3
        ) {
          await measureChain;
          if (this.isDestroyed || this.currentDecision.mode !== "live") break;
        }
        const drew = await this.scheduler.runNext();
        if (!drew) {
          const drewStoreOnly = await this.drawNextStoreOnlyFrame();
          if (!drewStoreOnly) break;
        }
        count++;
        if (this.currentDecision.mode !== "live") break;
        if (this.active) {
          if (this.preparing) this.updatePrepare();
          if (this.currentDecision.mode !== "live") break;
          if (this.autoPump && !this.preparing) this.blitIfNeeded();
        } else if (this.preparing) {
          this.updatePrepare();
        }
        if (this.host?.unhealthy) {
          this.switchToClip("worker-unhealthy");
          break;
        }
      }
    } finally {
      this.pumping = false;
    }
    if (this.repumpRequested && !this.isDestroyed && this.currentDecision.mode === "live") {
      this.repumpRequested = false;
      void this.pumpScheduler();
    }
    return count;
  }

  /**
   * When the 90-frame decoded memory window (`FrameCache`) is full in Full mode, draws the next missing frame of this scene,
   * saves it on disk in `FrameStore`, and closes the raw bitmap so RAM stays within the decoded memory window.
   */
  private async drawNextStoreOnlyFrame(): Promise<boolean> {
    if (!this.shouldUseStore() || this.storedComplete || this.isClip() || this.isDestroyed) {
      return false;
    }
    let target: number | null = null;
    for (let f = this.currentFrame; f < this.previewFrames; f++) {
      if (!this.cache.has(this.cacheKey, f) && !this.store!.hasFrame(this.bundleDigest, this.previewSize.label, f)) {
        target = f;
        break;
      }
    }
    if (target === null && this.autoPump) {
      target = this.store!.firstMissingFrame(this.bundleDigest, this.previewSize.label, this.previewFrames);
    }
    if (target === null) {
      if (this.store!.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames)) {
        this.storedComplete = true;
      }
      return false;
    }

    let rawBm: ImageBitmapLike | null = null;
    const drawEpoch = this.requestEpoch;
    try {
      const res = await this.timedFrame(
        sourceFrameForPreview(target, this.meta.frames, this.frameStep),
        FULL_QUALITY_SPEC,
        drawEpoch
      );
      rawBm = res.bitmap;
      if (this.isDestroyed || this.isClip() || this.requestEpoch !== drawEpoch || !this.shouldUseStore()) return false;
      const key = storeFrameKey(this.bundleDigest, this.previewSize.label, target);
      const saved = await this.store!.save(rawBm, key, this.store!.quality, {
        frames: this.previewFrames,
        filmKey: this.filmKey,
        variantKey: this.variantKey
      });
      if (saved && this.store!.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames)) {
        this.storedComplete = true;
      }
      if (
        !this.isDestroyed &&
        !this.isClip() &&
        this.requestEpoch === drawEpoch &&
        saved &&
        target >= this.currentFrame &&
        target < this.currentFrame + this.decodedWindowCap() &&
        !this.cache.has(this.cacheKey, target)
      ) {
        const decoded = await this.store!.load(key);
        if (decoded) {
          if (this.isDestroyed || this.isClip() || this.requestEpoch !== drawEpoch) {
            try {
              decoded.close();
            } catch {}
          } else {
            this.cache.put(this.cacheKey, target, decoded, this.previewSize.bytesPerFrame);
          }
        }
      }
      return true;
    } catch {
      if (this.host?.unhealthy) {
        this.switchToClip("worker-unhealthy");
      }
      return false;
    } finally {
      if (rawBm) {
        try {
          rawBm.close();
        } catch {}
      }
    }
  }

  /**
   * Background draw-ahead for an inactive or paused scene in Full mode (plan change F):
   * draws and saves all missing frames into `FrameStore` one frame at a time, yielding immediately when `shouldStop()` is true.
   */
  async drawAllToStore(shouldStop: () => boolean): Promise<boolean> {
    if (!this.shouldUseStore() || this.isDestroyed || this.isClip()) return false;
    if (!this.isMeasured) {
      await this.measure();
    }
    if (!this.shouldUseStore()) return false;
    await this.store!.flush();
    if (this.isDestroyed || this.isClip() || !this.shouldUseStore()) return false;
    if (this.store!.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames)) {
      this.storedComplete = true;
      return true;
    }

    while (!this.isDestroyed && !this.isClip() && this.shouldUseStore() && !shouldStop()) {
      const nextMissing = this.store!.firstMissingFrame(this.bundleDigest, this.previewSize.label, this.previewFrames);
      if (nextMissing === null) {
        this.storedComplete = true;
        return true;
      }
      const drawEpoch = this.requestEpoch;
      const ok = await runExclusiveMeasure(async () => {
        if (this.isDestroyed || this.isClip() || !this.shouldUseStore() || shouldStop()) return false;
        let rawBm: ImageBitmapLike | null = null;
        try {
          const res = await this.timedFrame(
            sourceFrameForPreview(nextMissing, this.meta.frames, this.frameStep),
            FULL_QUALITY_SPEC,
            drawEpoch
          );
          rawBm = res.bitmap;
          if (this.isDestroyed || this.isClip() || this.requestEpoch !== drawEpoch || !this.shouldUseStore()) return false;
          const key = storeFrameKey(this.bundleDigest, this.previewSize.label, nextMissing);
          const saved = await this.store!.save(rawBm, key, this.store!.quality, {
            frames: this.previewFrames,
            filmKey: this.filmKey,
            variantKey: this.variantKey
          });
          if (
            saved &&
            this.active &&
            this.requestEpoch === drawEpoch &&
            nextMissing >= this.currentFrame &&
            nextMissing < this.currentFrame + this.decodedWindowCap() &&
            !this.cache.has(this.cacheKey, nextMissing)
          ) {
            const decoded = await this.store!.load(key);
            if (decoded) {
              if (this.isDestroyed || this.isClip() || this.requestEpoch !== drawEpoch) {
                try {
                  decoded.close();
                } catch {}
              } else {
                this.cache.put(this.cacheKey, nextMissing, decoded, this.previewSize.bytesPerFrame);
              }
            }
          }
          return true;
        } catch {
          if (this.host?.unhealthy) {
            this.switchToClip("worker-unhealthy");
          }
          return false;
        } finally {
          if (rawBm) {
            try {
              rawBm.close();
            } catch {}
          }
        }
      });
      if (!ok) return false;
      await new Promise((r) => setTimeout(r, 0));
    }
    return this.shouldUseStore() && this.store!.isSceneComplete(this.bundleDigest, this.previewSize.label, this.previewFrames);
  }

  /** Resume threshold for catch-up buffering: `min(15, remaining)` in Draft mode, `min(30, remaining)` in Full mode. */
  private resumeThreshold(idx: number): number {
    const remaining = Math.max(1, this.previewFrames - idx);
    if (this.effectiveRenderMode === "draft") {
      const want = Math.min(DRAFT_NOMINAL_RUNWAY_FRAMES, remaining);
      const maxRam = Math.max(1, this.decodedWindowCap());
      return Math.min(want, maxRam);
    }
    const want = resumeBufferFrames(remaining);
    if (this.shouldUseStore()) {
      return want;
    }
    const maxRam = Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame));
    return Math.min(want, maxRam);
  }

  /**
   * Read-only snapshot of the current buffer readiness and threshold for UI feedback:
   * - `readyFrames`: `this.readyAhead(this.currentFrame)`
   * - `neededFrames`: `this.preparing.needed` while preparing initial buffer, otherwise `this.resumeThreshold(this.currentFrame)`
   * - `hasAnyFrame`: true once at least one frame has been drawn/cached or measured for this scene
   */
  bufferingSnapshot(): { readyFrames: number; neededFrames: number; hasAnyFrame: boolean } {
    const idx = this.currentFrame;
    const readyFrames = this.readyAhead(idx);
    const neededFrames = this.preparing ? this.preparing.needed : this.resumeThreshold(idx);
    const hasAnyFrame =
      readyFrames > 0 ||
      this.lastShownFrame !== null ||
      this.presentedBlits > 0 ||
      this.cache.frameIndices(this.cacheKey).length > 0 ||
      (this.shouldUseStore() && this.store!.savedFrames(this.bundleDigest, this.previewSize.label).length > 0);
    return { readyFrames, neededFrames, hasAnyFrame };
  }

  private isDocumentHidden(): boolean {
    try {
      const doc = (globalThis as { document?: { visibilityState?: string; hidden?: boolean } }).document;
      if (!doc) return false;
      return doc.visibilityState === "hidden" || doc.hidden === true;
    } catch {
      return false;
    }
  }

  private beginTraceEpisode(cause: LiveTraceCause, localFrame: number): void {
    if (!this.openJitterEpisode) {
      this.openJitterEpisode = {
        cause,
        t0: this.nowMs(),
        playing: this.wantPlaying,
        documentHidden: this.isDocumentHidden()
      };
    }
    if (!isLiveTraceEnabled()) {
      this.openTraceEpisode = null;
      return;
    }
    if (this.openTraceEpisode) return;
    const snap = this.bufferingSnapshot();
    const ctx = this.traceContext ? this.traceContext() : null;
    const clockSec = ctx ? ctx.clockSec : (this.sceneIdx * this.meta.frames + localFrame) / Math.max(1, this.meta.fps);
    const workersAlive = ctx
      ? ctx.workersAlive
      : Math.max(this.host?.hasActiveTransport ? 1 : 0, getActiveBrowserTransportCount());
    const cacheBytes = this.cache.bytes;
    const cacheBudget = this.cache.budget;
    const entry = appendLiveTraceEntry({
      at: Math.round(clockSec * 1000) / 1000,
      sceneIndex: this.sceneIdx,
      localFrame,
      durationMs: 0,
      cause,
      readyAhead: snap.readyFrames,
      neededFrames: snap.neededFrames,
      workerState: this.workerState,
      drawMsPerFrame: this.recentDrawMsMean,
      cacheBytes,
      cacheBudget,
      cacheBytesBudget: `${cacheBytes}/${cacheBudget}`,
      workersAlive
    });
    this.openTraceEpisode = { entry, t0: this.nowMs() };
  }

  private finishTraceEpisode(): void {
    if (this.openJitterEpisode) {
      const j = this.openJitterEpisode;
      this.openJitterEpisode = null;
      const durationMs = Math.max(0, Math.round((this.nowMs() - j.t0) * 100) / 100);
      const hidden = j.documentHidden || this.isDocumentHidden();
      this.jitterEpisodes.push({
        cause: j.cause,
        durationMs,
        playing: j.playing && this.wantPlaying,
        documentHidden: hidden
      });
      this.maybeEmitSustainedJitter();
    }
    if (!this.openTraceEpisode) return;
    const { entry, t0 } = this.openTraceEpisode;
    this.openTraceEpisode = null;
    entry.durationMs = Math.max(0, Math.round((this.nowMs() - t0) * 100) / 100);
    if (entry.drawMsPerFrame <= 0 && this.recentDrawMsMean > 0) {
      entry.drawMsPerFrame = this.recentDrawMsMean;
    }
  }

  private maybeEmitSustainedJitter(): void {
    if (this.jitterReported || this.isDestroyed || this.isClip()) return;
    const dec = evaluateSustainedJitter({
      episodes: this.jitterEpisodes,
      paused: !this.wantPlaying,
      documentHidden: this.isDocumentHidden()
    });
    if (!dec.jerky) return;
    this.jitterReported = true;
    const rawSamples = this.playbackAloneSamples.length > 0 ? this.playbackAloneSamples : this.aloneSamples.length > 0 ? this.aloneSamples : this.contendedSamples;
    const evalRes = isSlowScene(rawSamples);
    const medianMs = Math.max(65, evalRes.median || this.recentDrawMsMean || 65);
    const p90Ms = Math.max(95, evalRes.p90 || medianMs);
    this.onPlaybackSamples?.({
      medianMs,
      p90Ms,
      samples: Math.max(8, rawSamples.length),
      aloneSamples: rawSamples.length >= 8 ? [...rawSamples] : Array.from({ length: 8 }, () => medianMs),
      reason: "jitter"
    });
  }

  /** Blits the wanted frame and exits `buffering` once the resume threshold is met. */
  private blitIfNeeded() {
    if (!this.cache.has(this.cacheKey, this.currentFrame)) return;
    if (this.isBuffering) {
      // If paused while waiting for a scrubbed frame, show the target frame as soon as it arrives!
      const needed = this.wantPlaying ? this.resumeThreshold(this.currentFrame) : 1;
      const ramNeeded = this.wantPlaying ? Math.min(needed, Math.max(1, this.aheadCap())) : 1;
      if (this.readyAhead(this.currentFrame) < needed || this.ramReadyAhead(this.currentFrame) < ramNeeded) {
        return;
      }
      this.isBuffering = false;
      this.finishTraceEpisode();
      this.blitFrame(this.currentFrame);
      this.emit("buffering", { buffering: false, frame: this.currentFrame * this.frameStep });
      this.publish({ state: this.state });
      if (!this.wantPlaying && this.effectiveRenderMode === "draft") {
        this.scheduleStillUpgrade();
      }
      return;
    }
    if (this.lastShownFrame !== this.currentFrame) {
      this.blitFrame(this.currentFrame);
      if (!this.wantPlaying && this.effectiveRenderMode === "draft") {
        this.scheduleStillUpgrade();
      }
    }
  }

  private blitFrame(frame: number): boolean {
    const bm = this.cache.get(this.cacheKey, frame);
    if (!bm) return false;
    this.lastShownFrame = frame;
    const bmFrame =
      typeof (bm as unknown as { __sceneFrame?: number }).__sceneFrame === "number"
        ? (bm as unknown as { __sceneFrame: number }).__sceneFrame
        : sourceFrameForPreview(frame, this.meta.frames, this.frameStep);
    const bmQuality =
      typeof (bm as unknown as { __renderQualityMode?: string }).__renderQualityMode === "string"
        ? (bm as unknown as { __renderQualityMode: string }).__renderQualityMode
        : this.effectiveRenderMode;
    this.lastPresentedSrcFrame = bmFrame;
    this.lastPresentedQualityMode = bmQuality;
    this.presentedFramesSet.add(bmFrame);
    this.presentedBlits++;
    if (this.ctx && this.canvas) {
      try {
        if (this.canvas.dataset) {
          this.canvas.dataset.sceneId = this.sceneId;
          this.canvas.dataset.presentedFrame = String(bmFrame);
          this.canvas.dataset.presentedQuality = bmQuality;
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(bm as unknown as CanvasImageSource, 0, 0, this.canvas.width, this.canvas.height);
        this.presentedCanvasFrames++;
      } catch {}
    } else {
      this.presentedCanvasFrames++;
    }
    if (this.active) {
      this.evictBehind(frame);
    }
    return true;
  }

  /**
   * Coalesced latest-target scrub draw: when the user scrubs while paused and `currentFrame` is not cached,
   * draws the latest target frame first (at most 1 in-flight scrub draw + 1 pending latest target).
   */
  private triggerCoalescedScrubDraw(targetIdx: number): void {
    this.pendingScrubFrame = targetIdx;
    if (this.scrubDrawInFlight || this.isDestroyed || this.isClip()) return;
    this.scrubDrawInFlight = true;
    void (async () => {
      try {
        while (
          this.pendingScrubFrame !== null &&
          !this.isDestroyed &&
          !this.isClip() &&
          !this.wantPlaying
        ) {
          const nextIdx = this.pendingScrubFrame;
          this.pendingScrubFrame = null;
          if (this.cache.has(this.cacheKey, nextIdx)) {
            if (this.currentFrame === nextIdx) {
              this.blitIfNeeded();
            }
            continue;
          }
          const epoch = this.requestEpoch;
          const sceneKeyAtStart = this.cacheKey;
          try {
            const res = await this.timedFrame(
              sourceFrameForPreview(nextIdx, this.meta.frames, this.frameStep),
              this.currentQualitySpec,
              epoch
            );
            if (this.isDestroyed || this.isClip() || this.requestEpoch !== epoch || sceneKeyAtStart !== this.cacheKey) {
              try {
                res.bitmap.close();
              } catch {}
              continue;
            }
            // If another scrub superseded `nextIdx` and `nextIdx` is outside the active window, close immediately
            if (this.pendingScrubFrame !== null && Math.abs(this.currentFrame - nextIdx) > DRAFT_BEHIND_FRAMES) {
              try {
                res.bitmap.close();
              } catch {}
              continue;
            }
            this.cache.put(this.cacheKey, nextIdx, res.bitmap, res.bytes);
            if (this.currentFrame === nextIdx) {
              this.blitIfNeeded();
            }
          } catch {
            if (this.host?.unhealthy) {
              this.switchToClip("worker-unhealthy");
              break;
            }
          }
        }
      } finally {
        this.scrubDrawInFlight = false;
      }
    })();
  }

  /**
   * Draws (or blits from the cache) a frame now. Never blocks and never throws:
   * - If `frame` is not ready yet, enters `buffering`: holds the last shown frame, pauses the clock, and resumes when
   *   enough frames are ready again.
   * - Never shows a frame other than the one due.
   */
  showFrame(frame: number): void {
    if (this.isDestroyed || this.currentDecision.mode === "clip") return;
    const idx = previewIndexForFrame(frame, this.meta.frames, this.frameStep);
    if (this.cleanedAtFilmEnd) {
      if (!this.wantPlaying && idx === this.currentFrame) {
        return;
      }
      this.cleanedAtFilmEnd = false;
    }
    if (!this.isMeasured && this.host && this.envSupported) {
      this.currentFrame = idx;
      this.active = true;
      this.activateOnMeasure = true;
      this.cache.setSceneReservation(this.cacheKey, null);
      void this.measure();
      if (!this.measuringAnnounced) {
        this.measuringAnnounced = true;
        this.publish({ reason: "predraw", state: "drawing", progress: 0 });
      }
      return;
    }
    const wasActive = this.active;
    this.active = true;
    if (!wasActive) {
      this.cache.setSceneReservation(this.cacheKey, null);
      if (this.scheduler.isPaused) this.scheduler.resume();
      if (
        this.isMeasured &&
        this.host &&
        this.ownsHost &&
        !this.host.hasActiveTransport &&
        !this.storedComplete &&
        !this.isDestroyed &&
        !this.isClip()
      ) {
        void this.measure();
      }
    }

    const last = this.lastTarget;
    const frameChanged = last !== idx;
    const jump = last === null || idx < last || idx > last + PREDRAW_JUMP_FRAMES;
    const alsoBeyond = last !== null || idx > 0;
    this.lastTarget = idx;
    this.currentFrame = idx;

    if (frameChanged) {
      // Moving to a new frame cancels any pending/shown pause still for the previous frame.
      this.cancelStillUpgrade(true);
    }

    if (jump) {
      if (this.autoPump) {
        this.evictBehind(idx, alsoBeyond);
      }
      if (
        !this.storedComplete &&
        this.effectiveRenderMode === "full" &&
        (this.variant === "predraw" || (last === null && this.autoPump)) &&
        this.readyAhead(idx) < Math.max(1, this.runNeeded)
      ) {
        this.beginPrepare(idx);
        if (this.isClip()) return;
      }
    }

    // Re-prioritise the scheduler and cache focus around the requested frame.
    this.scheduler.focus(this.cacheKey, idx, true);

    const choice = chooseFrame({
      target: idx,
      lastShown: this.lastShownFrame,
      isReady: (f) => this.cache.has(this.cacheKey, f)
    });

    if (!choice.stalled) {
      if (this.isBuffering) {
        const needed = this.autoPump && this.wantPlaying ? this.resumeThreshold(idx) : 1;
        const ramNeeded = this.autoPump && this.wantPlaying ? Math.min(needed, Math.max(1, this.aheadCap())) : 1;
        if (this.readyAhead(idx) >= needed && this.ramReadyAhead(idx) >= ramNeeded) {
          this.isBuffering = false;
          this.finishTraceEpisode();
          this.blitFrame(choice.frame);
          this.emit("buffering", { buffering: false, frame });
          this.publish({ state: this.state });
        }
      } else if (this.lastShownFrame !== choice.frame) {
        this.blitFrame(choice.frame);
      } else if (this.active) {
        this.evictBehind(choice.frame);
      }
      if (!this.wantPlaying && !this.isBuffering && !this.preparing && this.effectiveRenderMode === "draft") {
        this.scheduleStillUpgrade();
      }
    } else if (!this.preparing) {
      // Frame due is not ready: enter `buffering`, hold `lastShownFrame` on canvas, pause the clock.
      if (!this.isBuffering) {
        const traceCause: LiveTraceCause =
          last !== null && (idx < last || idx > last + PREDRAW_JUMP_FRAMES)
            ? "seek"
            : (!wasActive || last === null) && idx <= 1
              ? this.sceneIdx === 0 && idx === 0
                ? "start"
                : "boundary"
              : last === null && idx > 1
                ? "seek"
                : "mid-scene";
        this.isBuffering = true;
        this.bufferingCount++;
        this.beginTraceEpisode(traceCause, frame);
        this.emit("buffering", {
          buffering: true,
          frame,
          heldFrame: this.lastShownFrame === null ? null : this.lastShownFrame * this.frameStep
        });
        this.publish({ state: "buffering" });
      }
      if (!this.wantPlaying && this.autoPump) {
        this.triggerCoalescedScrubDraw(idx);
      }
    }

    if (this.autoPump) {
      void this.pumpScheduler();
    }
  }

  ready(frame: number): boolean {
    if (this.currentDecision.mode === "clip") return false;
    return this.cache.has(this.cacheKey, previewIndexForFrame(frame, this.meta.frames, this.frameStep));
  }

  /** Cached ranges in the engine's source frame indices. */
  buffered(): { from: number; to: number }[] {
    const last = this.meta.frames - 1;
    return this.cache.buffered(this.cacheKey).map((r) => ({
      from: r.from * this.frameStep,
      to: Math.min(last, (r.to + 1) * this.frameStep - 1)
    }));
  }

  on(event: PlayerEvent, callback: (detail?: unknown) => void): () => void {
    this.listeners[event].add(callback);
    return () => {
      this.listeners[event].delete(callback);
    };
  }

  /**
   * Pipeline: pre-draws (or prefetches from `FrameStore`) up to `frames` preview frames of this next scene while the
   * current one plays, within the bytes the film can spare.
   */
  prefetch(frames: number): void {
    if (this.isDestroyed || this.active || this.currentDecision.mode !== "live") return;
    const cap = Math.max(0, Math.floor(frames));
    this.prefetchFrames = cap;
    if (cap <= 0) {
      return;
    }
    this.currentFrame = 0;
    this.scheduler.focus(this.cacheKey, 0, this.ownsCache);
    if (this.effectiveRenderMode === "draft") {
      const bpf = this.previewSize.bytesPerFrame;
      const maxByBudget = Math.max(1, Math.floor(this.cache.budget / bpf) - DRAFT_BEHIND_FRAMES - 1);
      const maxPrefetch = Math.min(cap, DRAFT_NEXT_SCENE_HEAD_FRAMES, maxByBudget);
      this.prefetchFrames = maxPrefetch;
      this.maxPrefetchedFrames = Math.max(this.maxPrefetchedFrames, maxPrefetch);
      this.cache.setSceneReservation(this.cacheKey, maxPrefetch * bpf);
    } else {
      this.maxPrefetchedFrames = Math.max(this.maxPrefetchedFrames, cap);
      this.cache.setSceneReservation(this.cacheKey, null);
    }
    if (!this.plan || !this.isMeasured) return;
    if (
      this.host &&
      this.ownsHost &&
      !this.host.hasActiveTransport &&
      !this.storedComplete &&
      !this.isDestroyed &&
      !this.isClip()
    ) {
      void this.measure().catch(() => {});
      return;
    }
    if (this.reinitPromise) return;
    if (this.scheduler.isPaused) this.scheduler.resume();
    if (this.effectiveRenderMode === "full" && this.variant === "predraw" && !this.prepareBegun && !this.storedComplete) {
      this.currentFrame = 0;
      this.beginPrepare(0);
      if (this.currentDecision.mode !== "live") return;
    }
    void this.pumpScheduler();
  }

  /** The film moved to another scene: stop drawing for this one and free its decoded RAM frames (stored WebP copies remain). */
  deactivate(): void {
    if (this.isDestroyed || !this.active) return;
    this.finishTraceEpisode();
    this.requestEpoch++;
    this.active = false;
    this.wantPlaying = false;
    this.currentFrame = 0;
    this.lastTarget = null;
    this.prepareBegun = false;
    this.prefetchFrames = 0;
    this.maxPrefetchedFrames = 0;
    this.isBuffering = false;
    this.pendingScrubFrame = null;
    this.cancelStillUpgrade(true);
    if (this.preparing) {
      this.preparing = null;
      if (this.currentDecision.mode === "live") this.publish({ reason: "ok", state: "ready", progress: undefined });
    }
    this.scheduler.focus(this.cacheKey, 0, this.ownsCache);
    this.scheduler.pause();
    this.cache.drop(this.cacheKey);
    this.lastShownFrame = null;
  }

  /**
   * Releases all RAM bitmaps, cancels timers/pumps, and terminates the scene's Worker transport when the film finishes
   * playing, while keeping the last rendered canvas pixels visible and allowing future seeks to respawn cleanly.
   */
  completeFilmCleanup(): void {
    if (this.isDestroyed) return;
    this.finishTraceEpisode();
    this.requestEpoch++;
    this.cleanedAtFilmEnd = true;
    this.active = false;
    this.wantPlaying = false;
    this.currentFrame = 0;
    this.lastTarget = null;
    this.lastShownFrame = null;
    this.prefetchFrames = 0;
    this.maxPrefetchedFrames = 0;
    this.isBuffering = false;
    this.pendingScrubFrame = null;
    this.cancelStillUpgrade(true);
    if (this.preparing) {
      this.preparing = null;
    }
    this.scheduler.focus(this.cacheKey, 0, this.ownsCache);
    this.scheduler.pause();
    this.cache.dropPrefix(`${this.bundleDigest}|${this.previewSize.label}`);
    if (this.ownsHost && this.host) {
      this.host.terminateIdle("film-ended");
    }
    if (this.currentDecision.mode === "live") {
      this.publish({ reason: "ok", state: "ready", progress: undefined });
    }
  }

  /** Recycles (or terminates if now inactive) the underlying Worker at a scene boundary. */
  async recycle(): Promise<void> {
    if (this.host && this.hostInitialized && !this.isDestroyed && this.currentDecision.mode === "live") {
      this.firstSampleAfterInit = true;
      if (!this.active && this.ownsHost) {
        this.host.terminateIdle("scene-boundary");
        return;
      }
      await this.host.recycle("scene-boundary");
    }
  }

  /** Releases an inactive non-adjacent scene's Worker and prefetched Draft frames so only current + next scene stay resident. */
  releaseIdleWorker(): void {
    if (this.isDestroyed || this.active) return;
    if (this.prefetchFrames > 0 || (this.ownsHost && this.host?.hasActiveTransport)) {
      this.requestEpoch++;
      this.firstSampleAfterInit = true;
      this.currentFrame = 0;
      this.prefetchFrames = 0;
      this.maxPrefetchedFrames = 0;
      this.scheduler.focus(this.cacheKey, 0, this.ownsCache);
      this.scheduler.pause();
      if (this.effectiveRenderMode === "draft") {
        this.cache.drop(this.cacheKey);
      }
      if (this.ownsHost && this.host) {
        this.host.terminateIdle("non-adjacent-scene", {
          keepBitmaps: this.effectiveRenderMode !== "draft"
        });
      }
    }
  }

  /** Toggles visibility of this scene's canvas inside a multi-scene stage container. */
  setCanvasVisible(visible: boolean): void {
    if (this.canvas) {
      this.canvas.style.display = visible ? "block" : "none";
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.finishTraceEpisode();
    this.isDestroyed = true;
    this.unsubDraftTargetChange();
    this.unsubDraftStylePolicyChange();
    this.pendingScrubFrame = null;
    this.cancelStillUpgrade(true);
    this.scheduler.pause();
    this.store?.cancelSceneWork(this.bundleDigest);
    if (this.ownsHost && this.host) {
      this.host.destroy();
    }
    if (this.ownsCache) {
      this.cache.clear();
    } else {
      this.cache.dropPrefix(`${this.bundleDigest}|${this.previewSize.label}`);
    }
    if (this.canvas) {
      try {
        this.canvas.remove();
      } catch {}
      this.canvas = null;
      this.ctx = null;
    }
    this.container = null;
    for (const set of Object.values(this.listeners)) {
      set.clear();
    }
  }
}

export function createPlatePlayer(options: PlatePlayerOptions): PlatePlayer {
  return new PlatePlayer(options);
}

export type ProactiveCheckReport = {
  sceneIndex: number;
  projectId: string;
  variantId: string;
  gen: number;
  bundleDigest: string;
  /** The check outcome (`{ ok: true }` or `{ ok: false, kind: "code" | "env", error }`). */
  results: CheckOutcome;
  /** Alias for `results`. */
  outcome: CheckOutcome;
  /** HTTP/stub response from `reportCheck` (`POST /v1/projects/:id/plates/:variantId/check`). */
  response: ReportCheckResult;
  /** Total check attempts run in this episode (1 on first-try success, up to 3 after 2 transient retries). */
  attempts: number;
};

export type FilmCheckReportEvent = ProactiveCheckReport;

export type FilmSceneSpec = {
  id: string;
  bundleDigest: string;
  html: string;
  params?: Record<string, unknown>;
  look?: string | null;
  draftTargetVerticesPerFrame?: number;
  frames: number;
  durationSeconds?: number;
  environment?: string | EnvironmentProbeInput;
  forceClipReason?: string;
  playback?: "clip";
  drawMsPerFrame?: number;
  hasClip?: boolean;
  clipReady?: boolean;
  variantKey?: string;
  state?: LivePlateVariantState;
  needsCheck?: boolean;
  variantId?: string;
  gen?: number;
  manifest?: BundleManifest;
  onCheckReport?: (report: ProactiveCheckReport) => void | Promise<unknown>;
};

export type FilmPlayerOptions = {
  scenes: FilmSceneSpec[];
  projectId?: string;
  filmKey?: string;
  look?: string | null;
  aspect?: AspectRatio | string;
  fps?: number;
  budgetBytes?: number;
  frameStore?: FrameStore | null;
  previewQuality?: PreviewQuality;
  renderMode?: PlaybackRenderMode;
  draftTargetVerticesPerFrame?: number;
  pauseStillDebounceMs?: number;
  timeSource?: TimeSource;
  clock?: PlaybackClock;
  audio?: FilmAudioBinding<any>;
  audioTimeline?: WebAudioFilmTimeline<any> | null;
  transportFactory?: WorkerTransportFactory;
  environment?: string | EnvironmentProbeInput;
  autoPump?: boolean;
  frameStep?: number;
  now?: () => number;
  onQualityProgress?: (progress: QualityJobProgress) => void;
  onStoreStatus?: (status: FrameStoreStatus) => void;
  api?: LiveApiOptions;
  checkTracker?: CheckOnceTracker;
  reportCheck?: (
    projectId: string,
    variantId: string,
    payload: CheckReportPayload,
    options?: LiveApiOptions
  ) => Promise<ReportCheckResult>;
  onCheckReport?: (report: ProactiveCheckReport) => void | Promise<unknown>;
  checkRetryBackoffMs?: readonly number[];
  checkWatchdogMs?: number;
  frameWatchdogMs?: number;
  initWatchdogMs?: number;
  maxConsecutiveOverBudgetFrames?: number;
  activeDrawWork?: () => number;
};

export interface FilmPlayer extends ScenePlayer {
  readonly clock: PlaybackClock;
  readonly filmClock: FilmClock | null;
  readonly audioTimeline: WebAudioFilmTimeline<any> | null;
  readonly cache: FrameCache<ImageBitmapLike>;
  readonly frameStore: FrameStore | null;
  readonly scenes: readonly PlatePlayer[];
  readonly activeSceneIndex: number;
  readonly state: PlaybackState;
  readonly bufferingPauses: number;
  readonly qualityJob: QualityJob | null;
  readonly renderMode: PlaybackRenderMode;
  readonly draftTargetVerticesPerFrame: number;
  readonly stillUpgradeState: StillUpgradeState;
  readonly checksRun: number;
  readonly checkTracker: CheckOnceTracker;
  readonly presentedFrames: number;
  presentedSummary(): {
    uniquePresentedFrames: number;
    totalBlits: number;
    repeatedBlits: number;
    perSceneUnique: number[];
  };
  decision(sceneIndex?: number): PlayerDecision;
  syncToClock(): void;
  updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void>;
  enqueueSceneCheck(sceneIndex: number, spec?: FilmSceneSpec): void;
  setPreviewQuality(quality: number): Promise<void>;
  setRenderMode(mode: PlaybackRenderMode): void;
  setDraftTargetVertices(targetVertices: number | null): void;
  completeFilmCleanup(): void;
  flushStore(): Promise<void>;
  pendingChecks(): Promise<void>;
  waitForChecks(): Promise<void>;
}

/**
 * Sequences several plate scene players on one timeline using `PlaybackClock` / `FilmClock`, sharing a single
 * byte-budgeted `FrameCache`, persisting drawn frames in `FrameStore` (`gm-live-frames`) in Full mode, running `QualityJob`
 * when quality changes, and supporting bounded Draft preview with 250 ms debounced full-quality pause stills.
 */
export function createFilmPlayer(options: FilmPlayerOptions): FilmPlayer {
  const fps = options.fps ?? 30;
  const aspect = options.aspect ?? "16:9";
  const preview = previewSizeForAspect(aspect);
  const defaultMode: PlaybackRenderMode =
    isPlateLiveEnabled() && isPlateDraftPreviewEnabled() ? "draft" : "full";
  let currentRenderMode: PlaybackRenderMode = options.renderMode
    ? normalizePlaybackRenderMode(options.renderMode)
    : defaultMode;
  let explicitDraftTargetVertices: number | undefined =
    options.draftTargetVerticesPerFrame !== undefined
      ? validateDraftTargetVerticesPerFrame(options.draftTargetVerticesPerFrame)
      : undefined;
  const syncFilmCacheOrder = () => {
    sharedCache.setOrder(players.map((p) => p.cacheKey));
  };
  const unsubFilmDraftTarget = onDraftTargetVerticesChange(() => {
    syncFilmCacheOrder();
  });
  const unsubFilmStylePolicy = onDraftStylePolicyChange(() => {
    syncFilmCacheOrder();
  });

  const defaultBudget =
    currentRenderMode === "draft" ? resolveDraftCacheBudgetBytes() : resolveCacheBudgetBytes();
  const budgetBytes = options.budgetBytes ?? defaultBudget;
  const sharedCache = new FrameCache<ImageBitmapLike>(budgetBytes);
  const filmKey = options.filmKey ?? "default-film";
  const sceneSpecs = options.scenes.map((s) => ({ ...s }));
  const autoPump = options.autoPump ?? true;

  const store: FrameStore | null =
    options.frameStore !== undefined
      ? options.frameStore
      : typeof indexedDB !== "undefined"
        ? new FrameStore({
            openFilmKey: filmKey,
            defaultQuality: options.previewQuality ?? DEFAULT_PREVIEW_QUALITY,
            onStatusChange: options.onStoreStatus
          })
        : null;
  const ownsStore = options.frameStore === undefined && store !== null;
  if (store) {
    store.setOpenFilmKey(filmKey);
    if (options.previewQuality !== undefined) {
      store.setQuality(options.previewQuality);
    }
    if (options.onStoreStatus) {
      store.onStatusChange(options.onStoreStatus);
    }
  }

  const spans: SceneSpan[] = [];
  const startFrames: number[] = [];
  let totalFrames = 1;

  const rebuildSpans = () => {
    spans.length = 0;
    startFrames.length = 0;
    let cursorFrames = 0;
    for (const s of sceneSpecs) {
      const startSec = cursorFrames / fps;
      startFrames.push(cursorFrames);
      const spanFrames =
        typeof s.durationSeconds === "number" && s.durationSeconds > 0
          ? Math.max(s.frames, Math.round(s.durationSeconds * fps))
          : s.frames;
      cursorFrames += spanFrames;
      const endSec = cursorFrames / fps;
      spans.push({ id: s.id, start: startSec, end: endSec });
    }
    totalFrames = Math.max(1, cursorFrames);
  };

  rebuildSpans();

  const audioTimeline = options.audioTimeline ?? options.audio?.timeline ?? null;
  const audioBinding: FilmAudioBinding | null =
    options.audio || audioTimeline
      ? {
          ...(options.audio ?? {}),
          ...(audioTimeline ? { timeline: audioTimeline } : {})
        }
      : null;

  let filmClockInstance: FilmClock | null = null;
  if (audioBinding && !options.clock && !options.timeSource) {
    filmClockInstance = new FilmClock({
      fps,
      frames: totalFrames,
      spans,
      audio: audioBinding
    });
  }
  const defaultSource: TimeSource =
    options.timeSource ?? audioTimeline ?? { currentTime: () => 0, playing: () => false };
  const clock: PlaybackClock = options.clock ?? filmClockInstance ?? new PlaybackClock(defaultSource, fps, totalFrames);

  let activeIdx = 0;
  let destroyed = false;
  let mountedEl: HTMLElement | null = null;
  let mountInFlightPromise: Promise<void> | null = null;
  let currentQualityJob: QualityJob | null = null;
  let bgLoopRunning = false;

  const listeners: Record<PlayerEvent, Set<(detail?: unknown) => void>> = {
    ready: new Set(),
    buffering: new Set(),
    error: new Set(),
    mode: new Set()
  };

  const emit = (event: PlayerEvent, detail?: unknown) => {
    for (const cb of listeners[event]) {
      try {
        cb(detail);
      } catch {}
    }
  };

  const syncAudioOnBufferState = (sceneIndex: number, isBufferingOrPreparing: boolean) => {
    if (sceneIndex !== activeIdx) return;
    if (audioTimeline) {
      audioTimeline.setBuffering(isBufferingOrPreparing);
    }
    if (filmClockInstance) {
      filmClockInstance.setBuffering(isBufferingOrPreparing);
      return;
    }
    if (!audioBinding) return;
    if (isBufferingOrPreparing || !clock.playing()) {
      audioBinding.voices?.forEach((v) => {
        if (v && !v.paused) {
          try {
            v.pause();
          } catch {}
        }
      });
      if (audioBinding.music && !audioBinding.music.paused) {
        try {
          audioBinding.music.pause();
        } catch {}
      }
      if (audioBinding.sfxAudios) {
        for (const el of Object.values(audioBinding.sfxAudios)) {
          if (el && !el.paused) {
            try {
              el.pause();
            } catch {}
          }
        }
      }
    } else if (clock.playing()) {
      const globalSec = clock.now();
      const localSec = Math.max(0, globalSec - (spans[activeIdx]?.start ?? 0));
      const vo = audioBinding.voices?.[activeIdx];
      if (vo) {
        try {
          vo.currentTime =
            typeof vo.duration === "number" && Number.isFinite(vo.duration)
              ? Math.min(Math.max(0, vo.duration - 0.05), localSec)
              : localSec;
          if (vo.paused) void vo.play()?.catch?.(() => undefined);
        } catch {}
      }
      if (audioBinding.music) {
        try {
          audioBinding.music.currentTime = globalSec;
          if (audioBinding.music.paused) void audioBinding.music.play()?.catch?.(() => undefined);
        } catch {}
      }
    }
  };

  const projectId = options.projectId ?? filmKey;
  const checkTracker = options.checkTracker ?? new CheckOnceTracker();
  const retryBackoffMs = options.checkRetryBackoffMs ?? DEFAULT_CHECK_RETRY_BACKOFF_MS;
  const checkWatchdogMs = options.checkWatchdogMs ?? DEFAULT_CHECK_WATCHDOG_MS;
  const sceneCheckEpochs: number[] = sceneSpecs.map(() => 0);
  const playbackReportInFlightScenes = new Set<number>();
  const inFlightPlaybackReports = new Set<Promise<void>>();

  const isSceneClipReady = (sceneIndex: number): boolean => {
    const spec = sceneSpecs[sceneIndex];
    if (!spec) return true;
    if (spec.clipReady === true || spec.hasClip === true) {
      return true;
    }
    if (spec.clipReady === false || spec.hasClip === false) {
      return false;
    }
    if (spec.state === "drawn") {
      return true;
    }
    if (
      spec.state === "rendering" ||
      spec.state === "queued" ||
      spec.state === "authoring" ||
      spec.state === "bundled" ||
      spec.forceClipReason === "pending-live" ||
      spec.forceClipReason === "variant-rendering" ||
      spec.forceClipReason === "slow-draw" ||
      spec.playback === "clip"
    ) {
      return false;
    }
    return true;
  };

  const resolveSpecClipForceReason = (s: FilmSceneSpec): string | undefined => {
    const hasBundleHtml = Boolean(s.html && s.html.trim());
    if (s.forceClipReason && !(s.forceClipReason === "clip-only" && hasBundleHtml)) {
      return s.forceClipReason;
    }
    const rawPlayback = s.playback as unknown;
    const rawPlaybackObj =
      typeof rawPlayback === "object" && rawPlayback !== null
        ? (rawPlayback as { mode?: unknown; reason?: unknown })
        : null;
    if (rawPlayback === "clip" || rawPlaybackObj?.mode === "clip") {
      return rawPlaybackObj && typeof rawPlaybackObj.reason === "string"
        ? rawPlaybackObj.reason
        : "slow-draw";
    }
    if (s.state === "rendering") return "variant-rendering";
    if (!hasBundleHtml && (s.state === "drawn" || s.forceClipReason === "clip-only")) {
      return "clip-only";
    }
    return undefined;
  };

  const specNeedsBrowserCheck = (s: FilmSceneSpec): boolean => {
    if (resolveSpecClipForceReason(s)) return false;
    if (!s.html || !s.html.trim()) return false;
    if (s.needsCheck || s.state === "bundled") return true;
    if ((s.state === "drawn" || s.hasClip) && s.state !== "checked") return true;
    return false;
  };

  const getPlaybackMeasureTarget = (
    s: FilmSceneSpec,
    idx: number
  ): { variantId: string; gen: number; bundleDigest: string } | null => {
    if (s.state !== "checked") return null;
    if (s.needsCheck) return null;
    if (resolveSpecClipForceReason(s)) return null;
    const variantId = s.variantId ?? s.id ?? `scene-${idx}`;
    const gen = typeof s.gen === "number" && Number.isInteger(s.gen) && s.gen >= 1 ? s.gen : 1;
    const bundleDigest = s.bundleDigest;
    if (!bundleDigest || !variantId) return null;
    if (!checkTracker.shouldReportPlayback(variantId, gen, bundleDigest, s.state, s.playback)) {
      return null;
    }
    return { variantId, gen, bundleDigest };
  };

  const makeScenePlayer = (s: FilmSceneSpec, idx: number): PlatePlayer => {
    const sceneExplicitTarget =
      s.draftTargetVerticesPerFrame !== undefined
        ? s.draftTargetVerticesPerFrame
        : explicitDraftTargetVertices;
    const effectiveForceClipReason = resolveSpecClipForceReason(s);
    const needsPlaybackMeasure = Boolean(getPlaybackMeasureTarget(s, idx));
    const p = new PlatePlayer({
      id: s.id,
      sceneIndex: idx,
      traceContext: () => ({
        clockSec: clock.now(),
        workersAlive: countActiveSceneWorkers()
      }),
      bundleDigest: s.bundleDigest,
      html: effectiveForceClipReason ? "" : s.html,
      params: s.params,
      look: s.look ?? options.look ?? null,
      aspect,
      fps,
      frames: s.frames,
      hasNextScene: idx < sceneSpecs.length - 1,
      cache: sharedCache,
      frameStore: store,
      filmKey,
      variantKey: s.variantKey ?? `${filmKey}:scene-${idx}`,
      budgetBytes: sharedCache.budget,
      renderMode: currentRenderMode,
      ...(sceneExplicitTarget !== undefined ? { draftTargetVerticesPerFrame: sceneExplicitTarget } : {}),
      ...(options.pauseStillDebounceMs !== undefined ? { pauseStillDebounceMs: options.pauseStillDebounceMs } : {}),
      transportFactory: options.transportFactory,
      environment: s.environment ?? options.environment,
      forceClipReason: effectiveForceClipReason,
      autoPump,
      needsPlaybackMeasure,
      onPlaybackSamples: (info) => {
        handlePlaybackSamples(idx, p, info);
      },
      ...(options.activeDrawWork ? { activeDrawWork: options.activeDrawWork } : {}),
      ...(options.frameStep !== undefined ? { frameStep: options.frameStep } : {}),
      ...(options.now ? { now: options.now } : {})
    });
    p.on("buffering", (d) => {
      const detail = typeof d === "object" && d ? (d as { buffering?: boolean }) : {};
      syncAudioOnBufferState(idx, Boolean(detail.buffering) || p.isPreparing);
      emit("buffering", { sceneIndex: idx, ...detail });
    });
    p.on("error", (d) => emit("error", { sceneIndex: idx, error: d }));
    p.on("mode", (d) => {
      updateCanvasVisibility();
      const isClip = p.decision().mode === "clip";
      const waiting = isClip ? !isSceneClipReady(idx) : p.isBufferingNow || p.isPreparing;
      syncAudioOnBufferState(idx, waiting);
      emit("mode", { sceneIndex: idx, ...(typeof d === "object" && d ? d : {}) });
    });
    return p;
  };

  const players: PlatePlayer[] = sceneSpecs.map((s, idx) => makeScenePlayer(s, idx));

  const updateCanvasVisibility = () => {
    players.forEach((p, idx) => {
      const showCanvas =
        idx === activeIdx &&
        (p.decision().mode === "live" || (!isSceneClipReady(idx) && p.lastPresentedSourceFrame !== null));
      p.setCanvasVisible(showCanvas);
    });
  };

  sharedCache.setOrder(players.map((p) => p.cacheKey));

  const sceneForGlobalFrame = (globalFrame: number): { sceneIndex: number; localFrame: number } => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, Math.floor(globalFrame)));
    const t = clamped / fps;
    const idx = Math.max(0, sceneAt(spans, t));
    const localFrame = Math.max(0, Math.min((sceneSpecs[idx]?.frames ?? 1) - 1, clamped - (startFrames[idx] ?? 0)));
    return { sceneIndex: idx, localFrame };
  };

  const buildQualitySpecs = (): QualityJobSceneSpec[] =>
    players
      .map((p, idx) => ({
        sceneIndex: idx,
        bundleDigest: p.bundleDigest,
        sizeLabel: p.previewSize.label,
        frames: p.previewFrames,
        isLive: p.decision().mode === "live"
      }))
      .filter((s) => s.isLive);

  const shouldYieldBackgroundWork = (): boolean => {
    if (destroyed) return true;
    const cur = players[activeIdx];
    if (!cur || cur.decision().mode === "clip") return false;
    if (cur.isPreparing || cur.isBufferingNow || !cur.measuredYet) return true;
    if (clock.playing()) {
      const nextDue = Math.min(cur.previewFrames - 1, cur.currentPreviewFrame + 1);
      if (!cur.ready(nextDue * cur.frameStep)) return true;
    }
    return false;
  };

  /**
   * Background drawing ahead (plan change F):
   * Only runs in Full mode (`currentRenderMode === "full"`). In Draft mode, we never pre-draw all scenes into IndexedDB!
   */
  const startBackgroundDrawLoop = () => {
    if (
      currentRenderMode !== "full" ||
      !autoPump ||
      !store ||
      store.disabled ||
      bgLoopRunning ||
      destroyed ||
      clock.playing()
    ) {
      return;
    }
    bgLoopRunning = true;
    void (async () => {
      try {
        while (!destroyed && currentRenderMode === "full" && store && !store.disabled && !clock.playing()) {
          const cur = players[activeIdx];
          if (
            cur &&
            cur.decision().mode === "live" &&
            (cur.isPreparing || cur.isBufferingNow || !cur.measuredYet || cur.isPumping)
          ) {
            await new Promise((r) => setTimeout(r, 25));
            continue;
          }

          let targetIdx: number | null = null;
          for (let offset = 0; offset < players.length; offset++) {
            const idx = (activeIdx + offset) % players.length;
            const p = players[idx]!;
            if (p.decision().mode === "clip") continue;
            if (!store.isSceneComplete(p.bundleDigest, p.previewSize.label, p.previewFrames)) {
              targetIdx = idx;
              break;
            }
          }

          if (targetIdx === null) {
            maybeResumeQualityJob();
            break;
          }

          const targetPlayer = players[targetIdx]!;
          await targetPlayer.drawAllToStore(() => {
            if (destroyed || currentRenderMode !== "full" || clock.playing()) return true;
            const activeP = players[activeIdx];
            if (!activeP) return false;
            if (
              targetIdx !== activeIdx &&
              (activeP.isPreparing || activeP.isBufferingNow || !activeP.measuredYet || activeP.isPumping)
            ) {
              return true;
            }
            return false;
          });

          if (targetIdx !== activeIdx && store.isSceneComplete(targetPlayer.bundleDigest, targetPlayer.previewSize.label, targetPlayer.previewFrames)) {
            await targetPlayer.recycle().catch(() => {});
          }
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        bgLoopRunning = false;
      }
    })();
  };

  const startOrReplaceQualityJob = (targetQuality: number): Promise<void> => {
    if (!store || store.disabled || destroyed) return Promise.resolve();
    const q = store.setQuality(targetQuality);
    if (currentQualityJob) {
      currentQualityJob.cancel();
      currentQualityJob = null;
    }
    const curPlayer = players[activeIdx];
    const job = new QualityJob({
      store,
      scenes: buildQualitySpecs(),
      targetQuality: q,
      initialSceneIndex: activeIdx,
      initialFrame: curPlayer?.currentPreviewFrame ?? 0,
      redrawFrame: async (sceneIndex, frame) => {
        const p = players[sceneIndex];
        if (!p) throw new Error(`No scene player at index ${sceneIndex}`);
        return p.redrawFrameForQuality(frame);
      },
      shouldYield: shouldYieldBackgroundWork,
      onFrameUpdated: (sceneIndex, frame, key) => {
        void players[sceneIndex]?.reloadCachedFrameFromStore(frame, key);
      },
      onProgress: options.onQualityProgress
    });
    currentQualityJob = job;
    return job.start();
  };

  const maybeResumeQualityJob = () => {
    if (currentRenderMode !== "full" || !store || store.disabled || destroyed || currentQualityJob?.running) return;
    const targetQ = store.quality;
    const needsResume = players.some((p) => {
      if (p.decision().mode === "clip") return false;
      const rec = store.getSceneRecord(p.bundleDigest, p.previewSize.label);
      if (!rec || rec.saved === 0) return false;
      return rec.quality === "mixed" || Math.abs(rec.quality - targetQ) > 1e-6;
    });
    if (needsResume) {
      void startOrReplaceQualityJob(targetQ);
    }
  };

  // Note (Requirement 6): when no browser page is open, nothing in the browser can run the Worker check or post
  // `/v1/projects/:id/plates/:variantId/check`; that case is handled by the backend reconciler's server-side
  // `CHECK_GRACE` watchdog fallback to clip rendering.
  type QueuedSceneCheck = {
    sceneIndex: number;
    epoch: number;
    variantId: string;
    gen: number;
    bundleDigest: string;
    manifest: BundleManifest;
    environment?: string | EnvironmentProbeInput;
    onCheckReport?: (report: ProactiveCheckReport) => void | Promise<unknown>;
  };

  const pendingChecksMap = new Map<number, QueuedSceneCheck>();
  const deferredHiddenChecks = new Map<number, QueuedSceneCheck>();
  const recheckCountByKey = new Map<string, number>();
  const lastRecheckEpisodeByKey = new Map<string, number>();
  let visibilityEpisodeId = 1;
  let activeCheckEntry: QueuedSceneCheck | null = null;
  let checkPreempted = false;
  let checkLoopPromise: Promise<void> | null = null;
  let checksRunCount = 0;

  const scheduleVisibilityRecheck = (entry: QueuedSceneCheck, currentEpisode: number): boolean => {
    if (destroyed || sceneCheckEpochs[entry.sceneIndex] !== entry.epoch) {
      deferredHiddenChecks.delete(entry.sceneIndex);
      return false;
    }
    const key = CheckOnceTracker.keyFor(entry.variantId, entry.gen, entry.bundleDigest);
    if (lastRecheckEpisodeByKey.get(key) === currentEpisode) {
      return false;
    }
    const used = recheckCountByKey.get(key) ?? 0;
    if (used >= MAX_VISIBILITY_RECHECKS) {
      deferredHiddenChecks.delete(entry.sceneIndex);
      return false;
    }
    lastRecheckEpisodeByKey.set(key, currentEpisode);
    recheckCountByKey.set(key, used + 1);
    deferredHiddenChecks.delete(entry.sceneIndex);
    players[entry.sceneIndex]?.resetHostForRetry();
    pendingChecksMap.set(entry.sceneIndex, entry);
    return true;
  };

  const onDocumentVisibilityChange = () => {
    if (destroyed || isDocumentHidden()) return;
    visibilityEpisodeId += 1;
    let queuedAny = false;
    for (const entry of [...deferredHiddenChecks.values()]) {
      if (scheduleVisibilityRecheck(entry, visibilityEpisodeId)) {
        queuedAny = true;
      }
    }
    if (queuedAny) {
      void runCheckLoop();
    }
  };

  const docForVis = (
    globalThis as {
      document?: {
        addEventListener?: (t: string, cb: () => void) => void;
        removeEventListener?: (t: string, cb: () => void) => void;
      };
    }
  ).document;
  if (docForVis && typeof docForVis.addEventListener === "function") {
    try {
      docForVis.addEventListener("visibilitychange", onDocumentVisibilityChange);
    } catch {}
  }

  const countActiveSceneWorkers = (): number => {
    let n = 0;
    for (const p of players) {
      if (p.workerHost?.hasActiveTransport) n++;
    }
    return Math.max(n, getActiveBrowserTransportCount());
  };

  const isCurrentSceneWarm = (): boolean => {
    const cur = players[activeIdx];
    if (!cur || cur.decision().mode === "clip") return true;
    if (!cur.measuredYet || cur.isPreparing || cur.isBufferingNow || cur.isPumping) return false;
    if (activeDrawWork() > 0) return false;
    if (!autoPump) return true;
    const remaining = Math.max(0, cur.previewFrames - cur.currentPreviewFrame);
    const minRunway =
      currentRenderMode === "draft"
        ? Math.min(DRAFT_NOMINAL_RUNWAY_FRAMES, remaining)
        : Math.min(START_BUFFER_FRAMES, remaining);
    return cur.readyAhead(cur.currentPreviewFrame) >= Math.max(1, Math.min(10, minRunway));
  };

  const isNextSceneWarm = (): boolean => {
    const nextIdx = activeIdx + 1;
    if (nextIdx >= players.length) return true;
    if (pendingChecksMap.has(nextIdx)) return false;
    const nxt = players[nextIdx];
    if (!nxt) return true;
    const dec = nxt.decision();
    if (dec.mode === "clip") {
      return dec.reason !== "pending-live";
    }
    if (!nxt.measuredYet || nxt.isPreparing || nxt.isBufferingNow || nxt.isPumping) {
      return false;
    }
    if (activeDrawWork() > 0) return false;
    if (!autoPump) return true;
    const maxCap = nxt.decodedWindowCap();
    const warmTarget =
      currentRenderMode === "draft"
        ? Math.min(DRAFT_NEXT_SCENE_HEAD_FRAMES, nxt.previewFrames, maxCap > 0 ? maxCap : DRAFT_NEXT_SCENE_HEAD_FRAMES)
        : Math.min(START_BUFFER_FRAMES, nxt.previewFrames, maxCap > 0 ? maxCap : START_BUFFER_FRAMES);
    return nxt.readyAhead(0) >= warmTarget;
  };

  const releaseWorkersForCheckSlot = (targetSceneIndex: number) => {
    players.forEach((p, idx) => {
      if (idx !== activeIdx && idx !== activeIdx + 1 && idx !== targetSceneIndex) {
        p.releaseIdleWorker();
        p.workerHost?.terminateIdle("non-adjacent-scene");
      }
    });
    if (targetSceneIndex !== activeIdx && targetSceneIndex !== activeIdx + 1) {
      const nextP = players[activeIdx + 1];
      if (nextP && nextP.workerHost?.hasActiveTransport && countActiveSceneWorkers() >= 2) {
        nextP.workerHost.terminateIdle("background-check-slot", { keepBitmaps: true });
      }
      if (!clock.playing() && countActiveSceneWorkers() >= 2) {
        const curP = players[activeIdx];
        if (curP && curP.workerHost?.hasActiveTransport && activeIdx !== targetSceneIndex) {
          curP.workerHost.terminateIdle("background-check-slot", { keepBitmaps: true });
        }
      }
    }
  };

  const preemptBackgroundCheckForScene = (neededSceneIndex: number) => {
    if (!activeCheckEntry) return;
    const checkIdx = activeCheckEntry.sceneIndex;
    if (checkIdx === neededSceneIndex) return;
    const neededPlayer = players[neededSceneIndex];
    if (!neededPlayer || neededPlayer.workerHost?.hasActiveTransport) return;
    if (countActiveSceneWorkers() >= 2) {
      checkPreempted = true;
      players[checkIdx]?.workerHost?.terminateIdle("preempted-by-playback");
    }
  };

  const sendCheckReportWithRetryAndCount = async (
    entry: QueuedSceneCheck,
    outcome: CheckOutcome,
    slowEvalInfo?: { slow: boolean; median: number; p90: number; n: number } | null
  ): Promise<{ response: ReportCheckResult; attempts: number } | null> => {
    if (destroyed || sceneCheckEpochs[entry.sceneIndex] !== entry.epoch) return null;
    const payload: CheckReportPayload = {
      gen: entry.gen,
      bundleDigest: entry.bundleDigest,
      results: outcome,
      device: {
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        env:
          entry.environment !== undefined ? environmentStatus(entry.environment) : environmentStatus()
      }
    };

    let response: ReportCheckResult = slowEvalInfo?.slow
      ? { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "bundled", playback: "clip" }
      : { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    let attempts = 1;
    const shouldCallHttp =
      Boolean(options.reportCheck) ||
      Boolean(options.api?.fetch) ||
      Boolean(options.api?.baseUrl && /^https?:\/\//i.test(options.api.baseUrl)) ||
      typeof window !== "undefined";

    if (shouldCallHttp) {
      const doSend = options.reportCheck ?? reportCheck;
      attempts = 0;
      for (let r = 0; r <= DEFAULT_CHECK_MAX_RETRIES; r++) {
        if (destroyed || sceneCheckEpochs[entry.sceneIndex] !== entry.epoch) return null;
        attempts++;
        try {
          response = await doSend(projectId, entry.variantId, payload, options.api);
        } catch (err) {
          response = {
            status: "network_error",
            ok: false,
            dropped: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
        if (
          response.status === "ok" ||
          response.status === "dropped" ||
          (response.status === "error" && response.httpStatus >= 400 && response.httpStatus < 500)
        ) {
          break;
        }
        if (r < DEFAULT_CHECK_MAX_RETRIES) {
          const delayMs = retryBackoffMs[Math.min(r, retryBackoffMs.length - 1)] ?? 150;
          if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    }

    if (destroyed || sceneCheckEpochs[entry.sceneIndex] !== entry.epoch) return null;
    return { response, attempts };
  };

  const sendCheckReportWithRetry = async (
    entry: QueuedSceneCheck,
    outcome: CheckOutcome,
    slowEvalInfo?: { slow: boolean; median: number; p90: number; n: number } | null
  ): Promise<ReportCheckResult | null> => {
    const res = await sendCheckReportWithRetryAndCount(entry, outcome, slowEvalInfo);
    return res ? res.response : null;
  };

  const notifyCheckReport = async (
    entry: QueuedSceneCheck,
    outcome: CheckOutcome,
    response: ReportCheckResult,
    attempts: number
  ): Promise<void> => {
    if (destroyed || sceneCheckEpochs[entry.sceneIndex] !== entry.epoch) return;
    const reportEvent: ProactiveCheckReport = {
      sceneIndex: entry.sceneIndex,
      projectId,
      variantId: entry.variantId,
      gen: entry.gen,
      bundleDigest: entry.bundleDigest,
      results: outcome,
      outcome,
      response,
      attempts
    };

    if (entry.onCheckReport) {
      await Promise.resolve(entry.onCheckReport(reportEvent)).catch(() => undefined);
    }
    if (options.onCheckReport && options.onCheckReport !== entry.onCheckReport) {
      await Promise.resolve(options.onCheckReport(reportEvent)).catch(() => undefined);
    }
  };

  function handlePlaybackSamples(
    sceneIndex: number,
    player: PlatePlayer,
    info: { medianMs: number; p90Ms: number; samples: number; aloneSamples: number[]; reason?: "slow" | "jitter" | "playable-timeout" }
  ): void {
    if (destroyed || players[sceneIndex] !== player) return;
    if (info.samples < 8 && !info.reason) return;
    const spec = sceneSpecs[sceneIndex];
    if (!spec) return;
    const target = getPlaybackMeasureTarget(spec, sceneIndex);
    if (!target) return;
    if (playbackReportInFlightScenes.has(sceneIndex)) return;
    if (!checkTracker.begin(target.variantId, target.gen, target.bundleDigest)) return;

    playbackReportInFlightScenes.add(sceneIndex);
    const epoch = sceneCheckEpochs[sceneIndex] ?? 0;
    const slowDecision = isSlowScene(info.aloneSamples);
    const isExplicitFallback = info.reason === "jitter" || info.reason === "playable-timeout";
    const drawMs = { medianMs: info.medianMs, p90Ms: info.p90Ms };
    const outcome: CheckOutcome = {
      ok: true,
      source: "playback",
      ...(info.reason ? { reason: info.reason } : {}),
      samples: info.samples,
      drawMs,
      drawMsMedian: info.medianMs,
      drawMsP90: info.p90Ms,
      results: {
        source: "playback",
        ...(info.reason ? { reason: info.reason } : {}),
        samples: info.samples,
        drawMs,
        drawMsMedian: info.medianMs,
        drawMsP90: info.p90Ms
      }
    };
    const entry: QueuedSceneCheck = {
      sceneIndex,
      epoch,
      variantId: target.variantId,
      gen: target.gen,
      bundleDigest: target.bundleDigest,
      manifest: spec.manifest ?? {},
      environment: spec.environment ?? options.environment,
      onCheckReport: spec.onCheckReport
    };

    const reportPromise = (async () => {
      let completed = false;
      try {
        const sendRes = await sendCheckReportWithRetryAndCount(entry, outcome, {
          slow: slowDecision.slow || isExplicitFallback,
          median: info.medianMs,
          p90: info.p90Ms,
          n: info.samples
        });
        if (!sendRes) return;
        const { response, attempts } = sendRes;
        if (
          destroyed ||
          sceneCheckEpochs[sceneIndex] !== epoch ||
          players[sceneIndex] !== player
        ) {
          return;
        }
        checkTracker.complete(target.variantId, target.gen, target.bundleDigest, outcome);
        completed = true;
        checksRunCount++;

        const serverDemotedToClip =
          response.status === "ok" && response.playback === "clip";

        recordSlowSceneTrace({
          sceneIndex,
          median: info.medianMs,
          p90: info.p90Ms,
          n: info.samples,
          decision: serverDemotedToClip ? "clip" : "live",
          source: "playback"
        });

        if (serverDemotedToClip) {
          const prevSpec = sceneSpecs[sceneIndex]!;
          sceneSpecs[sceneIndex] = {
            ...prevSpec,
            state: (response.state as LivePlateVariantState) ?? "bundled",
            playback: "clip",
            needsCheck: false,
            forceClipReason: "slow-draw",
            hasClip: prevSpec.hasClip ?? false,
            clipReady: prevSpec.clipReady ?? false
          };
          player.forceClipFallback("slow-draw");
          player.releaseIdleWorker();
          player.workerHost?.terminateIdle("slow-draw");
          updateCanvasVisibility();
          if (sceneIndex === activeIdx) {
            syncAudioOnBufferState(sceneIndex, !isSceneClipReady(sceneIndex));
          }
        }

        await notifyCheckReport(entry, outcome, response, attempts);
      } finally {
        playbackReportInFlightScenes.delete(sceneIndex);
        if (!completed) {
          checkTracker.failTransient(target.variantId, target.gen, target.bundleDigest);
        }
      }
    })();

    inFlightPlaybackReports.add(reportPromise);
    void reportPromise.finally(() => {
      inFlightPlaybackReports.delete(reportPromise);
    });
  }

  const runCheckLoop = (): Promise<void> => {
    if (checkLoopPromise) return checkLoopPromise;
    const p = (async () => {
      // Yield one macrotask turn so all scenes updated in the same status poll / updateScene batch
      // are registered in `pendingChecksMap` before `orderPendingChecks` selects the closest scene ahead of the playhead.
      await new Promise((r) => setTimeout(r, 0));
      while (!destroyed && pendingChecksMap.size > 0) {
        const ordered = orderPendingChecks(pendingChecksMap.values(), activeIdx, players.length);
        const head = ordered[0];
        if (!head) break;

        if (
          sceneCheckEpochs[head.sceneIndex] !== head.epoch ||
          players[head.sceneIndex]?.bundleDigest !== head.bundleDigest
        ) {
          pendingChecksMap.delete(head.sceneIndex);
          continue;
        }

        if (!checkTracker.shouldCheck(head.variantId, head.gen, head.bundleDigest, "bundled")) {
          pendingChecksMap.delete(head.sceneIndex);
          continue;
        }

        const targetPlayer = players[head.sceneIndex];
        if (!targetPlayer) {
          pendingChecksMap.delete(head.sceneIndex);
          continue;
        }

        // Unsupported / unverified browser environment: report kind:"env" once immediately without spawning a Worker or retrying.
        if (!targetPlayer.isEnvSupported) {
          if (!checkTracker.begin(head.variantId, head.gen, head.bundleDigest)) {
            pendingChecksMap.delete(head.sceneIndex);
            continue;
          }
          pendingChecksMap.delete(head.sceneIndex);
          const envOutcome: CheckOutcome = {
            ok: false,
            kind: "env",
            error: `Browser environment (${targetPlayer.envStatus}) does not support live Worker checks.`
          };
          try {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "live_check_env_failure",
                projectId,
                variantId: head.variantId,
                sceneIndex: head.sceneIndex,
                gen: head.gen,
                bundleDigest: head.bundleDigest,
                attempts: 1,
                error: envOutcome.error
              })
            );
          } catch {}
          checkTracker.complete(head.variantId, head.gen, head.bundleDigest, envOutcome);
          checksRunCount++;
          targetPlayer.forceClipFallback("check-env");
          const envRes = await sendCheckReportWithRetry(head, envOutcome, null);
          if (envRes) {
            await notifyCheckReport(head, envOutcome, envRes, 1);
          }
          continue;
        }

        // While playing, defer background checks to idle gaps when current and next scenes are warm.
        if (clock.playing() && head.sceneIndex !== activeIdx) {
          if (!isCurrentSceneWarm()) {
            const cur = players[activeIdx];
            if (autoPump && cur && cur.decision().mode === "live") {
              if (!cur.measuredYet && activeDrawWork() === 0) {
                void cur.measure().catch(() => {});
              } else if (cur.measuredYet && !cur.isPumping) {
                void cur.pumpScheduler().catch(() => {});
              }
            }
            await new Promise((r) => setTimeout(r, 5));
            continue;
          }
          if (head.sceneIndex !== activeIdx + 1 && !isNextSceneWarm()) {
            const nxt = players[activeIdx + 1];
            if (autoPump && nxt && nxt.decision().mode === "live" && !pendingChecksMap.has(activeIdx + 1)) {
              if (currentRenderMode === "draft") {
                nxt.prefetch(DRAFT_NEXT_SCENE_HEAD_FRAMES);
              } else {
                const bpf = preview.bytesPerFrame;
                const cur = players[activeIdx];
                const spare = sharedCache.budget - (cur ? cur.reservedBytes() : 0) - 2 * bpf;
                nxt.prefetch(Math.max(START_BUFFER_FRAMES, Math.floor(spare / bpf)));
              }
              if ((!nxt.measuredYet || !nxt.workerHost?.hasActiveTransport) && activeDrawWork() === 0) {
                void nxt.measure().catch(() => {});
              }
            }
            await new Promise((r) => setTimeout(r, 5));
            continue;
          }
          if (activeDrawWork() > 0) {
            await new Promise((r) => setTimeout(r, 5));
            continue;
          }
        }

        // Acquire the single page-wide check slot for this scene check.
        await runInSharedCheckSlot(async () => {
          if (destroyed) return;
          // Re-evaluate ordering inside the slot in case playhead moved or another scene was queued.
          const currentOrdered = orderPendingChecks(pendingChecksMap.values(), activeIdx, players.length);
          const entry = currentOrdered[0];
          if (!entry) return;
          const playerForCheck = players[entry.sceneIndex];
          if (
            !playerForCheck ||
            sceneCheckEpochs[entry.sceneIndex] !== entry.epoch ||
            playerForCheck.bundleDigest !== entry.bundleDigest
          ) {
            pendingChecksMap.delete(entry.sceneIndex);
            return;
          }
          if (clock.playing() && entry.sceneIndex !== activeIdx) {
            if (!isCurrentSceneWarm() || (entry.sceneIndex !== activeIdx + 1 && !isNextSceneWarm()) || activeDrawWork() > 0) {
              return;
            }
          }
          if (!checkTracker.begin(entry.variantId, entry.gen, entry.bundleDigest)) {
            pendingChecksMap.delete(entry.sceneIndex);
            return;
          }
          pendingChecksMap.delete(entry.sceneIndex);

          type SlowEvalSummary = { slow: boolean; median: number; p90: number; n: number };
          let attempts = 0;
          let hadTransientFailure = false;
          let lastError: string | undefined;
          let finalOutcome: CheckOutcome = { ok: false, kind: "env", error: "Check did not complete." };
          let slowEvalInfo: SlowEvalSummary | null = null;
          let abortedOrPreempted = false;

          while (!destroyed && attempts <= DEFAULT_CHECK_MAX_RETRIES) {
            if (
              sceneCheckEpochs[entry.sceneIndex] !== entry.epoch ||
              players[entry.sceneIndex] !== playerForCheck
            ) {
              abortedOrPreempted = true;
              break;
            }

            if (clock.playing() && entry.sceneIndex !== activeIdx) {
              if (!isCurrentSceneWarm() || (entry.sceneIndex !== activeIdx + 1 && !isNextSceneWarm()) || activeDrawWork() > 0) {
                checkTracker.failTransient(entry.variantId, entry.gen, entry.bundleDigest);
                if (sceneCheckEpochs[entry.sceneIndex] === entry.epoch) {
                  pendingChecksMap.set(entry.sceneIndex, entry);
                }
                abortedOrPreempted = true;
                break;
              }
            }

            releaseWorkersForCheckSlot(entry.sceneIndex);

            attempts++;
            activeCheckEntry = entry;
            checkPreempted = false;
            let attemptSlowEval: SlowEvalSummary | null = null;
            playerForCheck.setCheckingInFlight(true);
            let outcome: CheckOutcome;
            try {
              if (attempts > 1) {
                playerForCheck.resetHostForRetry();
              }
              outcome = await runCheck(playerForCheck.workerHost, entry.manifest, {
                watchdogMs: checkWatchdogMs,
                ...(options.frameWatchdogMs !== undefined ? { frameWatchdogMs: options.frameWatchdogMs } : {}),
                ...(options.initWatchdogMs !== undefined ? { initWatchdogMs: options.initWatchdogMs } : {}),
                ...(options.maxConsecutiveOverBudgetFrames !== undefined
                  ? { maxConsecutiveOverBudgetFrames: options.maxConsecutiveOverBudgetFrames }
                  : {}),
                previewScale: playerForCheck.previewSize.scale,
                qualitySpec: playerForCheck.qualitySpec,
                params: sceneSpecs[entry.sceneIndex]?.params,
                activeDrawWork,
                getHost: () => playerForCheck.workerHost,
                onResetHost: () => playerForCheck.resetHostForRetry(),
                ...(options.now ? { now: options.now } : {}),
                onSlowSceneEvaluated: (info) => {
                  attemptSlowEval = {
                    slow: info.slow,
                    median: info.median,
                    p90: info.p90,
                    n: info.n
                  };
                }
              });
              const evaluatedSlow = (attemptSlowEval as SlowEvalSummary | null)?.slow ?? false;
              if (
                outcome.ok &&
                !evaluatedSlow &&
                !destroyed &&
                !checkPreempted &&
                sceneCheckEpochs[entry.sceneIndex] === entry.epoch &&
                players[entry.sceneIndex] === playerForCheck
              ) {
                if (!playerForCheck.measuredYet) {
                  await playerForCheck.measure();
                }
                if (
                  playerForCheck.decision().mode === "clip" &&
                  playerForCheck.decision().reason.startsWith("worker-unhealthy")
                ) {
                  if (isDocumentHidden()) {
                    playerForCheck.resetHostForRetry();
                    outcome = {
                      ok: false,
                      kind: "inconclusive",
                      inconclusive: true,
                      reason: "document-hidden",
                      error: "Measure failed while document was hidden."
                    };
                  } else {
                    outcome = { ok: false, kind: "env", error: playerForCheck.decision().reason };
                  }
                }
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              if (isDocumentHidden() && isWatchdogTimeoutError(err)) {
                outcome = {
                  ok: false,
                  kind: "inconclusive",
                  inconclusive: true,
                  reason: "document-hidden",
                  error: errMsg
                };
              } else {
                outcome = {
                  ok: false,
                  kind: "env",
                  error: errMsg
                };
              }
            } finally {
              playerForCheck.setCheckingInFlight(false);
              activeCheckEntry = null;
              if (entry.sceneIndex !== activeIdx && entry.sceneIndex !== activeIdx + 1) {
                playerForCheck.releaseIdleWorker();
                playerForCheck.workerHost?.terminateIdle("background-check-complete");
              }
            }

            if (
              destroyed ||
              sceneCheckEpochs[entry.sceneIndex] !== entry.epoch ||
              players[entry.sceneIndex] !== playerForCheck
            ) {
              checkTracker.failTransient(entry.variantId, entry.gen, entry.bundleDigest);
              playerForCheck.workerHost?.terminateIdle("check-superseded");
              abortedOrPreempted = true;
              break;
            }

            if (checkPreempted) {
              attempts = Math.max(0, attempts - 1);
              playerForCheck.resetHostForRetry();
              checkTracker.failTransient(entry.variantId, entry.gen, entry.bundleDigest);
              pendingChecksMap.set(entry.sceneIndex, entry);
              abortedOrPreempted = true;
              break;
            }

            slowEvalInfo = attemptSlowEval as SlowEvalSummary | null;
            finalOutcome = outcome;

            if (!outcome.ok && outcome.kind === "inconclusive") {
              playerForCheck.resetHostForRetry();
              checkTracker.failTransient(entry.variantId, entry.gen, entry.bundleDigest);
              if (isDocumentHidden()) {
                deferredHiddenChecks.set(entry.sceneIndex, entry);
              } else {
                scheduleVisibilityRecheck(entry, visibilityEpisodeId);
              }
              abortedOrPreempted = true;
              break;
            }

            if (outcome.ok || outcome.kind === "code") {
              break;
            }

            // An init timeout was already retried once inside runCheck (and relative frame watchdog already
            // counted N=3 consecutive over-budget frames or 10s visible time), so do not retry again here.
            if (
              outcome.kind === "env" &&
              (isInitTimeoutError(outcome.error) || outcome.overBudgetExhausted)
            ) {
              if ((outcome.initRetries ?? 0) > 0) {
                attempts += outcome.initRetries!;
                hadTransientFailure = true;
                lastError = outcome.error;
              }
              break;
            }

            hadTransientFailure = true;
            lastError = outcome.error;
            playerForCheck.workerHost?.terminateIdle("check-transient-failure");
            if (attempts <= DEFAULT_CHECK_MAX_RETRIES) {
              const delayMs = retryBackoffMs[Math.min(attempts - 1, retryBackoffMs.length - 1)] ?? 150;
              if (delayMs > 0) {
                await new Promise((r) => setTimeout(r, delayMs));
              }
            }
          }

          if (
            abortedOrPreempted ||
            destroyed ||
            sceneCheckEpochs[entry.sceneIndex] !== entry.epoch ||
            players[entry.sceneIndex] !== playerForCheck ||
            (!finalOutcome.ok && finalOutcome.kind === "inconclusive")
          ) {
            return;
          }

          if (finalOutcome.ok && (finalOutcome.initRetries ?? 0) > 0) {
            attempts += finalOutcome.initRetries!;
            hadTransientFailure = true;
          }

          if (hadTransientFailure || (!finalOutcome.ok && finalOutcome.kind === "env")) {
            try {
              console.warn(
                JSON.stringify({
                  level: "warn",
                  event: finalOutcome.ok ? "live_check_recovered_after_retry" : "live_check_env_failure",
                  projectId,
                  variantId: entry.variantId,
                  sceneIndex: entry.sceneIndex,
                  gen: entry.gen,
                  bundleDigest: entry.bundleDigest,
                  attempts,
                  error: lastError ?? (finalOutcome.ok ? undefined : finalOutcome.error)
                })
              );
            } catch {}
          }

          checkTracker.complete(entry.variantId, entry.gen, entry.bundleDigest, finalOutcome);
          checksRunCount++;

          if (!finalOutcome.ok && finalOutcome.kind === "env") {
            const clipReason = "check-env";
            sceneSpecs[entry.sceneIndex] = {
              ...sceneSpecs[entry.sceneIndex]!,
              needsCheck: false,
              forceClipReason: clipReason
            };
            playerForCheck.forceClipFallback(clipReason);
            playerForCheck.workerHost?.terminateIdle(clipReason);
          }

          const response = await sendCheckReportWithRetry(entry, finalOutcome, slowEvalInfo);
          if (!response) return;

          const serverDemotedToClip =
            finalOutcome.ok && response.status === "ok" && response.playback === "clip";

          if (slowEvalInfo) {
            recordSlowSceneTrace({
              sceneIndex: entry.sceneIndex,
              median: slowEvalInfo.median,
              p90: slowEvalInfo.p90,
              n: slowEvalInfo.n,
              decision: serverDemotedToClip ? "clip" : "live"
            });
          }

          if (
            destroyed ||
            sceneCheckEpochs[entry.sceneIndex] !== entry.epoch ||
            players[entry.sceneIndex] !== playerForCheck
          ) {
            return;
          }

          if (finalOutcome.ok) {
            if (serverDemotedToClip) {
              // Server returned `{ state: "bundled", playback: "clip" }`: demote to clip path immediately,
              // release its Worker, do not retry the check, and do not report again for this digest.
              sceneSpecs[entry.sceneIndex] = {
                ...sceneSpecs[entry.sceneIndex]!,
                state: (response.state as LivePlateVariantState) ?? "bundled",
                playback: "clip",
                needsCheck: false,
                forceClipReason: "slow-draw"
              };
              playerForCheck.forceClipFallback("slow-draw");
              playerForCheck.releaseIdleWorker();
              playerForCheck.workerHost?.terminateIdle("slow-draw");
            } else {
              if (!playerForCheck.measuredYet) {
                await playerForCheck.measure().catch(() => {});
                if (entry.sceneIndex !== activeIdx && entry.sceneIndex !== activeIdx + 1) {
                  playerForCheck.releaseIdleWorker();
                  playerForCheck.workerHost?.terminateIdle("background-check-complete");
                }
              }
              sceneSpecs[entry.sceneIndex] = {
                ...sceneSpecs[entry.sceneIndex]!,
                state: "checked",
                needsCheck: false,
                forceClipReason: undefined
              };
              updateCanvasVisibility();
              if (entry.sceneIndex === activeIdx && mountedEl && !destroyed) {
                const f = frameAt(clock.now(), fps, totalFrames);
                playerForCheck.setWantPlaying(clock.playing());
                const localFrame = sceneForGlobalFrame(f).localFrame;
                playerForCheck.showFrame(localFrame);
              } else if (clock.playing() && !destroyed) {
                const cur = players[activeIdx];
                const nxt = players[activeIdx + 1];
                if (
                  nxt &&
                  cur &&
                  !pendingChecksMap.has(activeIdx + 1) &&
                  nxt.decision().mode === "live"
                ) {
                  const remainingInScene = Math.max(0, cur.previewFrames - cur.currentPreviewFrame);
                  const warmupWindowFrames = Math.ceil(2.5 * cur.previewFps);
                  if (currentRenderMode !== "draft" || remainingInScene <= warmupWindowFrames) {
                    if (currentRenderMode === "draft") {
                      nxt.prefetch(DRAFT_NEXT_SCENE_HEAD_FRAMES);
                    } else {
                      const bpf = preview.bytesPerFrame;
                      const spare = sharedCache.budget - cur.reservedBytes() - 2 * bpf;
                      nxt.prefetch(Math.max(START_BUFFER_FRAMES, Math.floor(spare / bpf)));
                    }
                    if (!nxt.measuredYet || !nxt.workerHost?.hasActiveTransport) {
                      void nxt.measure().catch(() => {});
                    }
                  }
                }
              }
            }
          }

          await notifyCheckReport(entry, finalOutcome, response, attempts);
        });
      }
    })().finally(() => {
      if (checkLoopPromise === p) {
        checkLoopPromise = null;
      }
      if (!destroyed && pendingChecksMap.size > 0) {
        void runCheckLoop();
      }
    });
    checkLoopPromise = p;
    return p;
  };

  const enqueueSceneCheck = (sceneIndex: number, specArg?: FilmSceneSpec) => {
    const spec = specArg ?? sceneSpecs[sceneIndex];
    if (!spec || destroyed || sceneIndex < 0 || sceneIndex >= players.length) return;
    const wantsCheck = specNeedsBrowserCheck(spec);
    if (!wantsCheck) return;
    const variantId = spec.variantId ?? spec.id ?? `scene-${sceneIndex}`;
    const gen = typeof spec.gen === "number" && Number.isInteger(spec.gen) && spec.gen >= 1 ? spec.gen : 1;
    const bundleDigest = spec.bundleDigest;
    if (!bundleDigest) return;
    const checkState: LivePlateVariantState = spec.state === "drawn" ? "drawn" : "bundled";
    if (!checkTracker.shouldCheck(variantId, gen, bundleDigest, checkState)) return;

    const existing = pendingChecksMap.get(sceneIndex) ?? deferredHiddenChecks.get(sceneIndex);
    if (
      existing &&
      existing.variantId === variantId &&
      existing.gen === gen &&
      existing.bundleDigest === bundleDigest &&
      existing.epoch === sceneCheckEpochs[sceneIndex]
    ) {
      return;
    }

    if (
      activeCheckEntry &&
      activeCheckEntry.sceneIndex === sceneIndex &&
      activeCheckEntry.variantId === variantId &&
      activeCheckEntry.gen === gen &&
      activeCheckEntry.bundleDigest === bundleDigest &&
      activeCheckEntry.epoch === sceneCheckEpochs[sceneIndex]
    ) {
      return;
    }

    const epoch = (sceneCheckEpochs[sceneIndex] ?? 0) + 1;
    sceneCheckEpochs[sceneIndex] = epoch;
    deferredHiddenChecks.delete(sceneIndex);
    if (activeCheckEntry && activeCheckEntry.sceneIndex === sceneIndex) {
      players[sceneIndex]?.workerHost?.terminateIdle("check-superseded");
    }
    pendingChecksMap.set(sceneIndex, {
      sceneIndex,
      epoch,
      variantId,
      gen,
      bundleDigest,
      manifest: spec.manifest ?? {},
      environment: spec.environment ?? options.environment,
      onCheckReport: spec.onCheckReport
    });
    if (mountedEl) {
      void runCheckLoop();
    }
  };

  const meta: PlayerMeta = {
    width: preview.width,
    height: preview.height,
    fps,
    get frames() {
      return totalFrames;
    },
    sceneSpans: spans
  };

  return {
    meta,
    clock,
    filmClock: filmClockInstance,
    audioTimeline,
    cache: sharedCache,
    frameStore: store,
    scenes: players,
    get activeSceneIndex() {
      return activeIdx;
    },
    get renderMode(): PlaybackRenderMode {
      return currentRenderMode;
    },
    get draftTargetVerticesPerFrame(): number {
      return (
        players[activeIdx]?.draftTargetVerticesPerFrame ??
        resolveDraftQualitySpecForStyle({
          look: options.look,
          explicitTargetVertices: explicitDraftTargetVertices
        }).draftTargetVerticesPerFrame
      );
    },
    get stillUpgradeState(): StillUpgradeState {
      return players[activeIdx]?.stillUpgradeState ?? "idle";
    },
    get state(): PlaybackState {
      const activePlayer = players[activeIdx];
      if (!activePlayer) return "clip";
      const st = activePlayer.state;
      if (st === "clip") {
        const spec = sceneSpecs[activeIdx];
        if (spec) {
          if (!isSceneClipReady(activeIdx)) {
            return "buffering";
          }
          if (clock.playing()) {
            return "playing";
          }
        }
        return "clip";
      }
      if (st === "ready" && clock.playing()) return "playing";
      return st;
    },
    get bufferingPauses(): number {
      return players.reduce((sum, p) => sum + p.bufferingPauses, 0);
    },
    get qualityJob(): QualityJob | null {
      return currentQualityJob;
    },
    get checksRun(): number {
      return checksRunCount;
    },
    get checkTracker(): CheckOnceTracker {
      return checkTracker;
    },
    get presentedFrames(): number {
      return players.reduce((sum, p) => sum + p.presentedFrames, 0);
    },
    presentedSummary() {
      const perSceneUnique = players.map((p) => p.uniquePresentedFrameCount);
      const uniquePresentedFrames = perSceneUnique.reduce((a, b) => a + b, 0);
      const totalBlits = players.reduce((a, p) => a + p.totalPresentedBlits, 0);
      return {
        uniquePresentedFrames,
        totalBlits,
        repeatedBlits: Math.max(0, totalBlits - uniquePresentedFrames),
        perSceneUnique
      };
    },
    decision(sceneIndex = activeIdx): PlayerDecision {
      return players[sceneIndex]?.decision() ?? { mode: "clip", state: "clip", reason: "no-scene" };
    },
    async mount(el: HTMLElement): Promise<void> {
      if (destroyed) throw new Error("FilmPlayer has been destroyed.");
      const doMount = (async () => {
        mountedEl = el;
        if (store && currentRenderMode === "full") {
          await store.init();
        }
        for (let i = 0; i < players.length; i++) {
          const p = players[i]!;
          if (destroyed) return;
          await p.mount(el, { active: false, deferMeasure: true });
          if (destroyed) {
            p.destroy();
            return;
          }
        }
        updateCanvasVisibility();
        const f = frameAt(clock.now(), fps, totalFrames);
        const first = sceneForGlobalFrame(f).sceneIndex;
        activeIdx = first;
        sceneSpecs.forEach((s, idx) => {
          if (specNeedsBrowserCheck(s)) {
            enqueueSceneCheck(idx, s);
          }
        });
        if (!pendingChecksMap.has(first) && activeCheckEntry?.sceneIndex !== first) {
          await players[first]?.measure().catch(() => {});
        }
        if (destroyed) return;
        const activePlayer = players[activeIdx];
        if (activePlayer && !destroyed && !pendingChecksMap.has(activeIdx) && activeCheckEntry?.sceneIndex !== activeIdx) {
          this.showFrame(f);
        }
        if (currentRenderMode === "full") {
          maybeResumeQualityJob();
          startBackgroundDrawLoop();
        }
        if (pendingChecksMap.size > 0) {
          void runCheckLoop();
        }
        emit("ready");
      })();
      mountInFlightPromise = doMount;
      try {
        await doMount;
      } finally {
        if (mountInFlightPromise === doMount) {
          mountInFlightPromise = null;
        }
      }
    },
    async updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void> {
      if (destroyed || sceneIndex < 0 || sceneIndex >= players.length) return;
      const oldPlayer = players[sceneIndex];
      const oldDigest = oldPlayer?.bundleDigest;
      if (oldDigest && oldDigest !== spec.bundleDigest) {
        currentQualityJob?.cancelScene(oldDigest);
        store?.cancelSceneWork(oldDigest);
      }
      const needsProactiveCheck = specNeedsBrowserCheck(spec);
      if (!needsProactiveCheck) {
        sceneCheckEpochs[sceneIndex] = (sceneCheckEpochs[sceneIndex] ?? 0) + 1;
        pendingChecksMap.delete(sceneIndex);
        deferredHiddenChecks.delete(sceneIndex);
        if (activeCheckEntry && activeCheckEntry.sceneIndex === sceneIndex) {
          oldPlayer?.workerHost?.terminateIdle("check-superseded");
        }
      }
      // If a scene was already demoted to clip mode for the same bundleDigest and is now updating its clip status
      // (e.g. "bundled" -> "rendering" -> "drawn" with hasClip: true), update in place so any held canvas frame stays intact until ready.
      const nextClipReason = resolveSpecClipForceReason(spec);
      if (
        oldPlayer &&
        oldDigest === spec.bundleDigest &&
        oldPlayer.decision().mode === "clip" &&
        nextClipReason &&
        !needsProactiveCheck
      ) {
        sceneSpecs[sceneIndex] = { ...spec };
        rebuildSpans();
        if (filmClockInstance) {
          filmClockInstance.setSpans(spans);
        }
        if (audioTimeline) {
          audioTimeline.setSpans(spans);
        }
        oldPlayer.forceClipFallback(nextClipReason);
        updateCanvasVisibility();
        if (sceneIndex === activeIdx) {
          syncAudioOnBufferState(sceneIndex, !isSceneClipReady(sceneIndex));
        }
        if (mountedEl && !destroyed && (sceneIndex === activeIdx || sceneIndex === activeIdx + 1)) {
          const f = frameAt(clock.now(), fps, totalFrames);
          this.showFrame(f);
        }
        emit("mode", { sceneIndex, mode: "clip", state: "clip", reason: nextClipReason });
        return;
      }
      if (oldPlayer) {
        oldPlayer.destroy();
      }
      sceneSpecs[sceneIndex] = { ...spec };
      rebuildSpans();
      if (filmClockInstance) {
        filmClockInstance.setSpans(spans);
      }
      if (audioTimeline) {
        audioTimeline.setSpans(spans);
      }
      if (store && oldDigest && oldDigest !== spec.bundleDigest) {
        await store.deleteSceneFrames(oldDigest, preview.label);
      }
      const nextPlayer = makeScenePlayer(spec, sceneIndex);
      players[sceneIndex] = nextPlayer;
      sharedCache.setOrder(players.map((p) => p.cacheKey));
      if (currentQualityJob) {
        currentQualityJob.setScenes(buildQualitySpecs());
      }
      if (mountedEl && !destroyed) {
        await nextPlayer.mount(mountedEl, { active: false, deferMeasure: true });
        if (destroyed) {
          nextPlayer.destroy();
          return;
        }
        if (needsProactiveCheck) {
          updateCanvasVisibility();
          enqueueSceneCheck(sceneIndex, spec);
          startBackgroundDrawLoop();
          return;
        }
        if (sceneIndex === activeIdx) {
          await nextPlayer.measure().catch(() => {});
        } else if (sceneIndex === activeIdx + 1) {
          if (nextPlayer.decision().mode === "live") {
            if (currentRenderMode === "draft") {
              nextPlayer.prefetch(DRAFT_NEXT_SCENE_HEAD_FRAMES);
            } else {
              const bpf = preview.bytesPerFrame;
              const cur = players[activeIdx];
              const spare = sharedCache.budget - (cur ? cur.reservedBytes() : 0) - 2 * bpf;
              nextPlayer.prefetch(Math.max(START_BUFFER_FRAMES, Math.floor(spare / bpf)));
            }
          }
          void nextPlayer.measure().catch(() => {});
        }
        if (destroyed) return;
        updateCanvasVisibility();
        if (sceneIndex === activeIdx || sceneIndex === activeIdx + 1) {
          const f = frameAt(clock.now(), fps, totalFrames);
          this.showFrame(f);
        }
        startBackgroundDrawLoop();
      } else if (needsProactiveCheck) {
        enqueueSceneCheck(sceneIndex, spec);
      }
    },
    enqueueSceneCheck(sceneIndex: number, spec?: FilmSceneSpec): void {
      enqueueSceneCheck(sceneIndex, spec);
    },
    showFrame(globalFrame: number): void {
      if (destroyed || !players.length) return;
      const { sceneIndex, localFrame } = sceneForGlobalFrame(globalFrame);
      if (sceneIndex !== activeIdx) {
        const previous = players[activeIdx];
        activeIdx = sceneIndex;
        if (previous) {
          previous.deactivate();
          void previous.recycle().catch(() => {});
        }
        if (currentRenderMode === "draft" || clock.playing()) {
          players.forEach((p, idx) => {
            if (idx !== sceneIndex && idx !== sceneIndex + 1 && idx !== activeCheckEntry?.sceneIndex) {
              p.releaseIdleWorker();
            }
          });
        }
      }
      updateCanvasVisibility();
      const current = players[sceneIndex];
      if (!current) return;
      current.setWantPlaying(clock.playing());
      const next = players[sceneIndex + 1];
      sharedCache.setPinned(next ? [current.cacheKey, next.cacheKey] : [current.cacheKey]);

      if (pendingChecksMap.has(sceneIndex) || activeCheckEntry?.sceneIndex === sceneIndex) {
        syncAudioOnBufferState(sceneIndex, !isSceneClipReady(sceneIndex));
        void runCheckLoop();
        return;
      }

      if (!current.measuredYet && current.workerHost && !current.workerHost.hasActiveTransport) {
        preemptBackgroundCheckForScene(sceneIndex);
      }
      current.showFrame(localFrame);

      if (currentQualityJob) {
        currentQualityJob.recenter(sceneIndex, current.currentPreviewFrame);
      }

      const currentIsClip = current.decision().mode === "clip";
      const currentClipNotReady = currentIsClip && !isSceneClipReady(sceneIndex);
      const isSceneBufferingOrWaiting = currentIsClip
        ? currentClipNotReady
        : current.isBufferingNow || current.isPreparing;

      syncAudioOnBufferState(sceneIndex, isSceneBufferingOrWaiting);
      if (clock.playing() && !isSceneBufferingOrWaiting && audioBinding) {
        const globalSec = clock.now();
        const localSec = Math.max(0, globalSec - (spans[sceneIndex]?.start ?? 0));
        const vo = audioBinding.voices?.[sceneIndex];
        if (vo && !vo.paused && Math.abs(vo.currentTime - localSec) > 1 / fps) {
          try {
            vo.currentTime = localSec;
          } catch {}
        }
      }

      // Pipeline ("the next scene is always ready"):
      // - In Draft mode: during the last ~2.5 s (`ceil(2.5 * fps)` frames) of the active scene, (re)initialise and warm
      //   `next` regardless of `measuredYet` or `activeAhead`, drawing at least `DRAFT_NEXT_SCENE_HEAD_FRAMES` (6) frames
      //   into `FrameCache` within the scene reservation and Draft cache budget. Never warm scenes beyond `current + 1`.
      // - In Full mode: pre-draw the next scene with the spare bytes (>= 30 frames).
      const nextSceneIndex = sceneIndex + 1;
      const nextChecking = pendingChecksMap.has(nextSceneIndex) || activeCheckEntry?.sceneIndex === nextSceneIndex;
      const bgCheckUsingSecondWorker =
        activeCheckEntry !== null &&
        activeCheckEntry.sceneIndex !== sceneIndex &&
        activeCheckEntry.sceneIndex !== nextSceneIndex;

      if (next && !nextChecking && !current.isPreparing && !current.isBufferingNow && (current.measuredYet || currentIsClip)) {
        const nextReleased = Boolean(
          next.measuredYet &&
            next.workerHost &&
            !next.workerHost.hasActiveTransport &&
            next.decision().mode === "live"
        );
        if (currentRenderMode === "draft") {
          const activePreviewFrame = currentIsClip
            ? previewIndexForFrame(localFrame, current.meta.frames, current.frameStep)
            : current.currentPreviewFrame;
          const remainingInScene = Math.max(0, current.previewFrames - activePreviewFrame);
          const warmupWindowFrames = Math.ceil(2.5 * current.previewFps);
          if (clock.playing() && remainingInScene <= warmupWindowFrames) {
            const nextWarmInCache =
              next.measuredYet &&
              next.decision().mode === "live" &&
              next.readyAhead(0) >= Math.min(DRAFT_NEXT_SCENE_HEAD_FRAMES, next.previewFrames);
            if (
              next.decision().mode === "live" &&
              (!bgCheckUsingSecondWorker || next.workerHost?.hasActiveTransport || !nextWarmInCache)
            ) {
              next.prefetch(DRAFT_NEXT_SCENE_HEAD_FRAMES);
            }
            if (!next.measuredYet || nextReleased) {
              if (!bgCheckUsingSecondWorker || remainingInScene <= Math.ceil(1.0 * current.previewFps) || !nextWarmInCache) {
                preemptBackgroundCheckForScene(nextSceneIndex);
                void next.measure().catch(() => {});
              }
            }
          }
        } else {
          const bpf = preview.bytesPerFrame;
          const spare = sharedCache.budget - current.reservedBytes() - 2 * bpf;
          const fullPrefetchFrames = Math.max(START_BUFFER_FRAMES, Math.floor(spare / bpf));
          const nextWarmInCache =
            next.measuredYet &&
            next.decision().mode === "live" &&
            next.readyAhead(0) >= Math.min(START_BUFFER_FRAMES, next.previewFrames);
          if (
            next.decision().mode === "live" &&
            (!bgCheckUsingSecondWorker || next.workerHost?.hasActiveTransport || !nextWarmInCache)
          ) {
            next.prefetch(fullPrefetchFrames);
          }
          if (!next.measuredYet || nextReleased) {
            if (!bgCheckUsingSecondWorker || !nextWarmInCache) {
              preemptBackgroundCheckForScene(nextSceneIndex);
              void next.measure().catch(() => {});
            }
          }
        }
      }
      if (pendingChecksMap.size > 0) {
        void runCheckLoop();
      }
      startBackgroundDrawLoop();
    },
    syncToClock(): void {
      const f = frameAt(clock.now(), fps, totalFrames);
      this.showFrame(f);
    },
    setRenderMode(mode: PlaybackRenderMode): void {
      const nextMode = normalizePlaybackRenderMode(mode);
      if (nextMode === currentRenderMode) return;
      currentRenderMode = nextMode;
      // Switching Draft <-> Full NEVER starts QualityJob; if switching to Draft, cancel any running QualityJob.
      if (nextMode === "draft" && currentQualityJob) {
        currentQualityJob.cancel();
        currentQualityJob = null;
      }
      if (options.budgetBytes === undefined) {
        sharedCache.resize(
          nextMode === "draft" ? resolveDraftCacheBudgetBytes() : resolveCacheBudgetBytes()
        );
      }
      for (const p of players) {
        p.setRenderMode(nextMode);
      }
      sharedCache.setOrder(players.map((p) => p.cacheKey));
      if (nextMode === "full") {
        startBackgroundDrawLoop();
      }
    },
    setDraftTargetVertices(targetVertices: number | null): void {
      const valid =
        targetVertices !== null && targetVertices !== undefined
          ? validateDraftTargetVerticesPerFrame(targetVertices)
          : undefined;
      explicitDraftTargetVertices = valid;
      for (const p of players) {
        p.setDraftTargetVertices(valid ?? null);
      }
      sharedCache.setOrder(players.map((p) => p.cacheKey));
    },
    completeFilmCleanup(): void {
      if (destroyed) return;
      if (currentQualityJob) {
        currentQualityJob.cancel();
        currentQualityJob = null;
      }
      for (const p of players) {
        p.completeFilmCleanup();
      }
      sharedCache.clear();
    },
    async setPreviewQuality(quality: number): Promise<void> {
      await startOrReplaceQualityJob(quality);
    },
    async flushStore(): Promise<void> {
      if (store) {
        await store.flush();
      }
    },
    async pendingChecks(): Promise<void> {
      while (
        (mountInFlightPromise !== null ||
          pendingChecksMap.size > 0 ||
          checkLoopPromise !== null ||
          inFlightPlaybackReports.size > 0) &&
        !destroyed
      ) {
        if (mountInFlightPromise) {
          await mountInFlightPromise.catch(() => {});
        } else if (checkLoopPromise) {
          await checkLoopPromise.catch(() => {});
        } else if (pendingChecksMap.size > 0) {
          await runCheckLoop().catch(() => {});
        } else if (inFlightPlaybackReports.size > 0) {
          await Promise.allSettled([...inFlightPlaybackReports]);
        }
      }
    },
    async waitForChecks(): Promise<void> {
      await this.pendingChecks();
    },
    ready(globalFrame: number): boolean {
      const { sceneIndex, localFrame } = sceneForGlobalFrame(globalFrame);
      return players[sceneIndex]?.ready(localFrame) ?? false;
    },
    buffered(): { from: number; to: number }[] {
      const all: { from: number; to: number }[] = [];
      players.forEach((p, idx) => {
        const offset = startFrames[idx] ?? 0;
        for (const r of p.buffered()) {
          const from = offset + r.from;
          const to = offset + r.to;
          const last = all[all.length - 1];
          if (last && from === last.to + 1) {
            last.to = to;
          } else {
            all.push({ from, to });
          }
        }
      });
      return all;
    },
    on(event: PlayerEvent, callback: (detail?: unknown) => void): () => void {
      listeners[event].add(callback);
      return () => {
        listeners[event].delete(callback);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      pendingChecksMap.clear();
      deferredHiddenChecks.clear();
      if (docForVis && typeof docForVis.removeEventListener === "function") {
        try {
          docForVis.removeEventListener("visibilitychange", onDocumentVisibilityChange);
        } catch {}
      }
      for (let i = 0; i < sceneCheckEpochs.length; i++) {
        sceneCheckEpochs[i] = (sceneCheckEpochs[i] ?? 0) + 1;
      }
      unsubFilmDraftTarget();
      unsubFilmStylePolicy();
      if (currentQualityJob) {
        currentQualityJob.cancel();
        currentQualityJob = null;
      }
      for (const p of players) {
        p.destroy();
      }
      sharedCache.clear();
      if (ownsStore && store) {
        store.destroy();
      }
      for (const set of Object.values(listeners)) {
        set.clear();
      }
    }
  };
}
