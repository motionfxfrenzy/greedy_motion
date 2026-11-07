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
  getDraftTargetVerticesPerFrame,
  normalizePlaybackRenderMode,
  onDraftStylePolicyChange,
  onDraftTargetVerticesChange,
  resolveDraftQualitySpecForStyle,
  resolveQualitySpecForMode,
  validateDraftTargetVerticesPerFrame,
  type DraftQualitySpec,
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
import { WorkerHost, type HostFrameResult, type ImageBitmapLike, type WorkerHostOptions, type WorkerTransportFactory } from "./worker-host.ts";

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

/** Draws in flight on this page right now (all scenes). */
export function activeDrawWork(): number {
  return work.count;
}

export function runExclusiveMeasure<T>(fn: () => Promise<T>): Promise<T> {
  const run = measureChain.then(fn, fn);
  measureChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Draw samples kept per player for the measured cost. */
const MAX_COST_SAMPLES = 9;

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
  private isMeasured = false;
  private measurePromise: Promise<void> | null = null;
  private activateOnMeasure = false;
  private measuringAnnounced = false;
  private active = false;
  private wantPlaying = false;
  private prefetchFrames = 0;
  private runNeeded = 0;
  private preparing: { needed: number; t0: number; pct: number } | null = null;
  private prepareBegun = false;
  private storedComplete = false;
  private hostInitialized = false;
  private cleanedAtFilmEnd = false;

  private listeners: Record<PlayerEvent, Set<(detail?: unknown) => void>> = {
    ready: new Set(),
    buffering: new Set(),
    error: new Set(),
    mode: new Set()
  };

  constructor(options: PlatePlayerOptions) {
    this.sceneId = options.id ?? "scene-0";
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
    this.scheduler.focus(this.cacheKey, 0);
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
    this.scheduler.setScenes([{ id: this.currentCacheKey, frames: this.previewFrames }]);
    this.scheduler.focus(this.currentCacheKey, this.currentFrame);
    this.aloneSamples.length = 0;
    this.contendedSamples.length = 0;
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
    this.scheduler.setScenes([{ id: this.currentCacheKey, frames: this.previewFrames }]);
    this.scheduler.focus(this.currentCacheKey, this.currentFrame);
    this.aloneSamples.length = 0;
    this.contendedSamples.length = 0;
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
        } catch {}
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

  get workerHost(): WorkerHost | null {
    return this.host;
  }

  /** The pre-draw plan from the first measurement (`L`, `W`, draw and play rates), or null before the scene is mounted. */
  get predrawPlan(): PredrawDecision | null {
    return this.plan ? { ...this.plan } : null;
  }

  /** Whether a draw-ahead pump is running right now. */
  get isPumping(): boolean {
    return this.pumping;
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
    if (this.effectiveRenderMode === "draft") {
      const draftCap = this.draftRunwayFrames();
      return Math.min(this.previewFrames, draftCap, Math.floor(this.cache.budget / bpf)) * bpf;
    }
    if (this.storedComplete || (this.store && !this.store.disabled)) {
      return Math.min(this.previewFrames, DECODED_WINDOW_FRAMES, Math.floor(this.cache.budget / bpf)) * bpf;
    }
    if (this.variant === "predraw") {
      return Math.min(
        this.previewFrames,
        Math.floor(this.cache.budget / bpf),
        Math.max(DECODED_WINDOW_FRAMES, this.runNeeded, this.preparing?.needed ?? 0, this.plan?.startFrames ?? 0)
      ) * bpf;
    }
    return Math.min(this.previewFrames, DECODED_WINDOW_FRAMES, this.windowSplit.windowFrames) * bpf;
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
    if (this.currentDecision.mode === "clip") return;
    this.cancelStillUpgrade(true);
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
      // Legacy bundle compatibility (§5.1): if bundle lacks draft capability, fall back cleanly to Full for this scene.
      if (this.requestedRenderMode === "draft" && !this.host.supportsDraftQuality && !this.legacyBundleFallback) {
        this.legacyBundleFallback = true;
        const prevKey = this.currentCacheKey;
        this.currentQualitySpec = FULL_QUALITY_SPEC;
        this.currentCacheKey = this.computeCacheKey();
        if (prevKey !== this.currentCacheKey) {
          this.cache.drop(prevKey);
          this.scheduler.setScenes([{ id: this.currentCacheKey, frames: this.previewFrames }]);
          this.scheduler.focus(this.currentCacheKey, this.currentFrame);
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
    work.count++;
    const t0 = this.nowMs();
    let res: HostFrameResult;
    let contended = othersAtStart > 0;
    try {
      res = await host.frame(sourceFrame, {
        qualitySpec: effectiveSpec,
        epoch,
        includeCalibration: this.lastCalibration === null && effectiveSpec.mode === "draft"
      });
      if (work.count > 1) contended = true;
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
    const list = contended ? this.contendedSamples : this.aloneSamples;
    list.push(ms);
    if (list.length > MAX_COST_SAMPLES) list.shift();
    return res;
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
    for (let k = start; k < this.previewFrames && drawn < count; k++) {
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
          this.cache.put(this.cacheKey, k, res.bitmap, res.bytes);
          if (shownAtMoment && (this.active || this.activateOnMeasure)) {
            this.blitFrame(k);
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
      } catch {
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
      this.measurePromise = this.doMeasure();
      return this.measurePromise;
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
      return this.measurePromise.then(async () => {
        if (this.isDestroyed || this.isClip() || !this.host || this.host.hasActiveTransport) return;
        await this.host.init({ scale: this.previewSize.scale, params: this.params });
      });
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
      const count = Math.min(this.gateSampleFrames, Math.max(1, this.previewFrames - sampleStart));
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
      return Math.max(1, Math.min(remaining, this.draftRunwayFrames(), room));
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
      const maxRam = Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame));
      return Math.min(want, maxRam);
    }
    const want = resumeBufferFrames(remaining);
    if (this.shouldUseStore()) {
      return want;
    }
    const maxRam = Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame));
    return Math.min(want, maxRam);
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
      } catch {}
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
    }

    const last = this.lastTarget;
    const frameChanged = last !== idx;
    const jump = last === null || idx < last || idx > last + PREDRAW_JUMP_FRAMES;
    this.lastTarget = idx;
    this.currentFrame = idx;

    if (frameChanged) {
      // Moving to a new frame cancels any pending/shown pause still for the previous frame.
      this.cancelStillUpgrade(true);
    }

    if (jump) {
      if (this.autoPump) {
        this.evictBehind(idx, true);
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
    this.scheduler.focus(this.cacheKey, idx);

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
        this.isBuffering = true;
        this.bufferingCount++;
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
    if (!this.plan) return;
    const cap = Math.max(0, Math.floor(frames));
    this.prefetchFrames = cap;
    if (cap <= 0) {
      return;
    }
    if (this.effectiveRenderMode === "draft") {
      const maxPrefetch = Math.min(cap, DRAFT_NEXT_SCENE_HEAD_FRAMES);
      this.prefetchFrames = maxPrefetch;
      this.cache.setSceneReservation(this.cacheKey, maxPrefetch * this.previewSize.bytesPerFrame);
    } else {
      this.cache.setSceneReservation(this.cacheKey, null);
    }
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
    this.requestEpoch++;
    this.active = false;
    this.wantPlaying = false;
    this.lastTarget = null;
    this.prepareBegun = false;
    this.prefetchFrames = 0;
    this.isBuffering = false;
    this.pendingScrubFrame = null;
    this.cancelStillUpgrade(true);
    if (this.preparing) {
      this.preparing = null;
      if (this.currentDecision.mode === "live") this.publish({ reason: "ok", state: "ready", progress: undefined });
    }
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
    this.requestEpoch++;
    this.cleanedAtFilmEnd = true;
    this.active = false;
    this.wantPlaying = false;
    this.lastTarget = null;
    this.lastShownFrame = null;
    this.prefetchFrames = 0;
    this.isBuffering = false;
    this.pendingScrubFrame = null;
    this.cancelStillUpgrade(true);
    if (this.preparing) {
      this.preparing = null;
    }
    this.scheduler.pause();
    this.cache.dropPrefix(`${this.bundleDigest}|${this.previewSize.label}`);
    if (this.ownsHost && this.host) {
      this.host.terminateIdle("film-ended");
    }
    if (this.currentDecision.mode === "live") {
      this.publish({ reason: "ok", state: "ready", progress: undefined });
    }
  }

  /** Recycles (or terminates if now inactive in Draft mode) the underlying Worker at a scene boundary. */
  async recycle(): Promise<void> {
    if (this.host && this.hostInitialized && !this.isDestroyed && this.currentDecision.mode === "live") {
      if (!this.active && this.ownsHost && this.effectiveRenderMode === "draft") {
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
      this.prefetchFrames = 0;
      this.scheduler.pause();
      if (this.effectiveRenderMode === "draft") {
        this.cache.drop(this.cacheKey);
      }
      if (this.ownsHost && this.host) {
        this.host.terminateIdle("non-adjacent-scene");
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
  variantKey?: string;
};

export type FilmPlayerOptions = {
  scenes: FilmSceneSpec[];
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
  presentedSummary(): {
    uniquePresentedFrames: number;
    totalBlits: number;
    repeatedBlits: number;
    perSceneUnique: number[];
  };
  decision(sceneIndex?: number): PlayerDecision;
  syncToClock(): void;
  updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void>;
  setPreviewQuality(quality: number): Promise<void>;
  setRenderMode(mode: PlaybackRenderMode): void;
  setDraftTargetVertices(targetVertices: number | null): void;
  completeFilmCleanup(): void;
  flushStore(): Promise<void>;
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

  const makeScenePlayer = (s: FilmSceneSpec, idx: number): PlatePlayer => {
    const sceneExplicitTarget =
      s.draftTargetVerticesPerFrame !== undefined
        ? s.draftTargetVerticesPerFrame
        : explicitDraftTargetVertices;
    const p = new PlatePlayer({
      id: s.id,
      bundleDigest: s.bundleDigest,
      html: s.html,
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
      forceClipReason: s.forceClipReason,
      autoPump,
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
      syncAudioOnBufferState(idx, p.isBufferingNow || p.isPreparing);
      emit("mode", { sceneIndex: idx, ...(typeof d === "object" && d ? d : {}) });
    });
    return p;
  };

  const players: PlatePlayer[] = sceneSpecs.map((s, idx) => makeScenePlayer(s, idx));

  const updateCanvasVisibility = () => {
    players.forEach((p, idx) => {
      p.setCanvasVisible(idx === activeIdx && p.decision().mode === "live");
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
      if (st === "ready" && clock.playing()) return "playing";
      return st;
    },
    get bufferingPauses(): number {
      return players.reduce((sum, p) => sum + p.bufferingPauses, 0);
    },
    get qualityJob(): QualityJob | null {
      return currentQualityJob;
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
      await players[first]?.measure().catch(() => {});
      if (destroyed) return;
      const activePlayer = players[activeIdx];
      if (activePlayer && !destroyed) {
        this.showFrame(f);
      }
      if (currentRenderMode === "full") {
        maybeResumeQualityJob();
        startBackgroundDrawLoop();
      }
      emit("ready");
    },
    async updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void> {
      if (destroyed || sceneIndex < 0 || sceneIndex >= players.length) return;
      const oldPlayer = players[sceneIndex];
      const oldDigest = oldPlayer?.bundleDigest;
      if (oldDigest && oldDigest !== spec.bundleDigest) {
        currentQualityJob?.cancelScene(oldDigest);
        store?.cancelSceneWork(oldDigest);
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
        if (sceneIndex === activeIdx) await nextPlayer.measure().catch(() => {});
        if (destroyed) return;
        updateCanvasVisibility();
        if (sceneIndex === activeIdx) {
          const f = frameAt(clock.now(), fps, totalFrames);
          this.showFrame(f);
        }
        startBackgroundDrawLoop();
      }
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
        if (currentRenderMode === "draft") {
          players.forEach((p, idx) => {
            if (idx !== sceneIndex && idx !== sceneIndex + 1) {
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
      current.showFrame(localFrame);

      if (currentQualityJob) {
        currentQualityJob.recenter(sceneIndex, current.currentPreviewFrame);
      }

      syncAudioOnBufferState(sceneIndex, current.isBufferingNow || current.isPreparing || !current.measuredYet);
      if (clock.playing() && !current.isBufferingNow && !current.isPreparing && current.measuredYet && audioBinding) {
        const globalSec = clock.now();
        const localSec = Math.max(0, globalSec - (spans[sceneIndex]?.start ?? 0));
        const vo = audioBinding.voices?.[sceneIndex];
        if (vo && !vo.paused && Math.abs(vo.currentTime - localSec) > 1 / fps) {
          try {
            vo.currentTime = localSec;
          } catch {}
        }
      }

      // Pipeline:
      // - In Draft mode (§5.3): only prefetch next scene when within 1.0 s (`30` frames) of the end of the active scene
      //   AND the active scene has >= 10 frames buffered ahead, capped at 6 frames (`DRAFT_NEXT_SCENE_HEAD_FRAMES`).
      // - In Full mode: pre-draw the next scene with the bytes this scene does not need.
      if (next && !current.isPreparing && (current.measuredYet || current.decision().mode === "clip")) {
        if (currentRenderMode === "draft") {
          const remainingInScene = Math.max(0, current.previewFrames - current.currentPreviewFrame);
          const activeAhead = current.decodedWindowAhead(current.currentPreviewFrame);
          if (remainingInScene <= 30 && (activeAhead >= Math.min(10, remainingInScene) || current.decision().mode === "clip")) {
            if (!next.measuredYet) {
              void next.measure().catch(() => {});
            } else if (next.decision().mode === "live") {
              next.prefetch(DRAFT_NEXT_SCENE_HEAD_FRAMES);
            }
          }
        } else {
          if (!next.measuredYet) {
            void next.measure().catch(() => {});
          } else if (next.decision().mode === "live") {
            const bpf = preview.bytesPerFrame;
            const spare = sharedCache.budget - current.reservedBytes() - 2 * bpf;
            next.prefetch(Math.floor(spare / bpf));
          }
        }
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
