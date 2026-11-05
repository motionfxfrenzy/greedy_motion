import { PlaybackClock, chooseFrame, frameAt, sceneAt, type TimeSource } from "./clock.ts";
import { FrameCache, computeRollingWindow, frameCacheKey, sceneCacheKey, type RollingWindowSplit } from "./frame-cache.ts";
import { FrameScheduler } from "./frame-scheduler.ts";
import {
  PREDRAW_JUMP_FRAMES,
  PREDRAW_STALL_REPREPARE_MS,
  PREDRAW_REASSESS_TOLERANCE,
  PREVIEW_FRAME_STEP,
  contiguousFrom,
  decidePredraw,
  indicesToEvict,
  predrawProgress,
  previewFrameCount,
  previewIndexForFrame,
  previewRate,
  sourceFrameForPreview,
  type PredrawDecision
} from "./predraw.ts";
import { environmentStatus, resolveCacheBudgetBytes, supportsWorkerHost, type EnvironmentProbeInput } from "./support.ts";
import type { PlayerDecision, PlayerEvent, PlayerMeta, ScenePlayer, SceneSpan } from "./types.ts";
import { WorkerHost, type HostFrameResult, type ImageBitmapLike, type WorkerHostOptions, type WorkerTransportFactory } from "./worker-host.ts";

/**
 * Live plate scene player and multi-scene film sequencer (docs/LIVE_SCENES_PLAN.md §5, §6, §10, §20; pre-draw: phase 3f).
 *
 * Preview frame indices: the scheduler, the cache and every buffering check work in *preview* indices (0, 1, 2, ...), where
 * preview index `i` is the engine's source frame `i * PREVIEW_FRAME_STEP`. Only `WorkerHost.frame()` and the public
 * `showFrame` / `ready` / `buffered` take or return the engine's 30 fps source indices.
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
    // 1080 * (640 / 1920) = 360; 1920 * (640 / 1920) = 640.
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
 * The phase 3c buffering gate (docs/LIVE_SCENES_PLAN.md §6, §20), kept for reference and its tests:
 * `lead = clipSeconds * max(0, 1 - produceFps / consumeFps) + 0.5 s`; a lead beyond the ahead capacity meant "clip".
 * The player no longer uses it: `decidePredraw` (predraw.ts) replaces "lead > window => clip" with a pre-draw mode.
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
  host?: WorkerHost;
  hostOptions?: Partial<WorkerHostOptions>;
  transportFactory?: WorkerTransportFactory;
  environment?: string | EnvironmentProbeInput;
  forceClipReason?: string;
  gateSampleFrames?: number;
  autoPump?: boolean;
  /** Source frames per preview frame (default `PREVIEW_FRAME_STEP`; tests of the plain 30 fps path pass 1). */
  frameStep?: number;
  /** Longest pre-draw wait in seconds (default `MAX_PREDRAW_SECONDS`). */
  maxPredrawSeconds?: number;
  /** Millisecond clock for the pre-draw wait (default `performance.now`). */
  now?: () => number;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Page-wide draw accounting (phase 3f follow-up). Several Workers drawing at once share the CPU, so a draw timed while another
 * one is in flight is *contended* and says little about how fast the scene is alone. `work.count` is the number of draws in
 * flight on this page; sampling for the live/pre-draw/clip decision is serialised through `measureChain`.
 */
const work = { count: 0 };
let measureChain: Promise<void> = Promise.resolve();

/** Draws in flight on this page right now (all scenes). */
export function activeDrawWork(): number {
  return work.count;
}

function runExclusiveMeasure<T>(fn: () => Promise<T>): Promise<T> {
  const run = measureChain.then(fn, fn);
  measureChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Draw samples kept per player for the measured cost. */
const MAX_COST_SAMPLES = 9;
/** Longest wait, ms, for the page to go quiet before re-measuring a contended scene alone. */
const REMEASURE_IDLE_WAIT_MS = 8000;

export class PlatePlayer implements ScenePlayer {
  readonly meta: PlayerMeta;
  readonly bundleDigest: string;
  readonly previewSize: PreviewSizeSpec;
  readonly cacheKey: string;
  readonly cache: FrameCache<ImageBitmapLike>;
  readonly windowSplit: RollingWindowSplit;
  /** Source frames per preview frame, and the number of preview frames of this scene. */
  readonly frameStep: number;
  readonly previewFrames: number;
  /** Preview frames per second at playback. */
  readonly previewFps: number;

  private readonly sceneId: string;
  private readonly html: string;
  private readonly params: Record<string, unknown>;
  private readonly host: WorkerHost | null;
  private readonly ownsHost: boolean;
  private readonly ownsCache: boolean;
  private readonly scheduler: FrameScheduler<ImageBitmapLike>;
  private readonly gateSampleFrames: number;
  private readonly autoPump: boolean;
  private readonly envSupported: boolean;
  private readonly envState: "verified" | "unverified" | "unsupported";
  private readonly maxPredrawSeconds: number | undefined;
  private readonly nowMs: () => number;

  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** Preview index of the frame the clock asks for. */
  private currentFrame = 0;
  /** Preview index on the canvas. */
  private lastShownFrame: number | null = null;
  private lastTarget: number | null = null;
  private isBuffering = false;
  private readyEmitted = false;
  private currentDecision: PlayerDecision = { mode: "live", reason: "ok" };
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
  private prefetchFrames = 0;
  private runNeeded = 0;
  private preparing: { needed: number; t0: number; pct: number } | null = null;
  private prepareBegun = false;
  private stallSince: number | null = null;

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
    this.cacheKey = sceneCacheKey(this.bundleDigest, this.previewSize.label);
    this.maxPredrawSeconds = options.maxPredrawSeconds;
    this.nowMs = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));

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

    const budgetBytes = options.budgetBytes ?? options.cache?.budget ?? resolveCacheBudgetBytes();
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
      // Custom host or injected transport in tests: supported unless explicitly overridden.
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
        reason: options.forceClipReason
      };
    } else if (!this.envSupported) {
      this.ownsHost = false;
      this.host = null;
      this.currentDecision = {
        mode: "clip",
        reason: this.envState === "unverified" ? "unverified-environment" : "unsupported-environment"
      };
    } else if (!this.html.trim()) {
      this.ownsHost = false;
      this.host = null;
      this.currentDecision = {
        mode: "clip",
        reason: "no-bundle"
      };
    } else if (options.host) {
      this.ownsHost = false;
      this.host = options.host;
    } else {
      this.ownsHost = true;
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
      lookahead: Math.max(1, this.windowSplit.aheadFrames),
      head: this.windowSplit.headFrames,
      behind: this.windowSplit.behindFrames,
      draw: async (_sceneKey, previewIdx) => {
        if (!this.host || this.currentDecision.mode === "clip") {
          throw new Error("Player is in clip mode.");
        }
        const res = await this.timedFrame(sourceFrameForPreview(previewIdx, this.meta.frames, this.frameStep));
        return { value: res.bitmap, bytes: res.bytes };
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

  decision(): PlayerDecision {
    return { ...this.currentDecision };
  }

  /** Cache key for a specific source frame index: `bundleDigest | frame | previewSize`. */
  keyForFrame(frame: number): string {
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

  /** Whether the scene is pre-drawing before it can play. */
  get isPreparing(): boolean {
    return this.preparing !== null;
  }

  /** `live` when the scene draws at least as fast as it plays, `predraw` when frames are drawn ahead first. */
  get playbackVariant(): "live" | "predraw" {
    return this.variant;
  }

  /** Preview indices that are cached right now (sorted). */
  cachedPreviewFrames(): number[] {
    return this.cache.frameIndices(this.cacheKey).sort((a, b) => a - b);
  }

  /** Bytes this scene may hold at most (what film-level budgeting reserves for it). */
  reservedBytes(): number {
    if (this.currentDecision.mode === "clip" || !this.host) return 0;
    const bpf = this.previewSize.bytesPerFrame;
    if (this.variant === "predraw") {
      return Math.min(this.previewFrames, Math.max(this.runNeeded, this.preparing?.needed ?? 0, this.plan?.neededFrames ?? 0)) * bpf;
    }
    return Math.min(this.previewFrames, this.windowSplit.windowFrames) * bpf;
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
    this.currentDecision = { mode: "clip", reason };
    this.preparing = null;
    this.scheduler.pause();
    // Frames of a scene that plays as its clip are never shown: free them at once.
    this.cache.drop(this.cacheKey);
    const payload = { mode: "clip" as const, reason };
    this.emit("mode", payload);
  }

  private publish(extra: Partial<PlayerDecision> = {}) {
    this.currentDecision = {
      mode: "live",
      reason: "ok",
      variant: this.variant,
      ...(this.plan ? { neededFrames: this.plan.neededFrames, waitSeconds: this.plan.waitSeconds } : {}),
      ...extra
    };
    this.emit("mode", { ...this.currentDecision });
  }

  private isClip(): boolean {
    return this.currentDecision.mode === "clip";
  }

  /** Draws one frame in the Worker, counting it in the page-wide work and timing it as alone or contended. */
  private async timedFrame(sourceFrame: number): Promise<HostFrameResult> {
    if (!this.host) throw new Error("No Worker host.");
    const othersAtStart = work.count;
    work.count++;
    const t0 = this.nowMs();
    let res: HostFrameResult;
    let contended = othersAtStart > 0;
    try {
      res = await this.host.frame(sourceFrame);
      if (work.count > 1) contended = true;
    } finally {
      work.count--;
    }
    // The Worker's own timing when it reports one (it is what the scene costs), else the wall time.
    const ms = res.drawMs > 0 ? res.drawMs : this.nowMs() - t0;
    const list = contended ? this.contendedSamples : this.aloneSamples;
    list.push(ms);
    if (list.length > MAX_COST_SAMPLES) list.shift();
    return res;
  }

  /**
   * The scene's draw cost: the median of recent draws made alone; only when there are none, the median of contended ones
   * (a contended number overstates the cost, so it is never allowed to latch a fallback).
   */
  private measured(): { ms: number; contended: boolean } {
    if (this.aloneSamples.length) return { ms: median(this.aloneSamples.slice(-5)), contended: false };
    if (this.contendedSamples.length) return { ms: median(this.contendedSamples.slice(-5)), contended: true };
    return { ms: 0, contended: false };
  }

  private decide(idx: number, extra: { elapsedSeconds?: number; readyAhead?: number; tolerance?: number } = {}): PredrawDecision {
    const m = this.measured();
    const input = {
      previewFrames: this.previewFrames - idx,
      rate: this.previewFps,
      avgDrawMs: m.ms,
      bytesPerFrame: this.previewSize.bytesPerFrame,
      budgetBytes: this.cache.budget,
      maxSeconds: this.maxPredrawSeconds,
      unhealthy: this.host?.unhealthy ?? false,
      supported: this.envSupported,
      envStatus: this.envState,
      ...extra
    };
    const d = decidePredraw(input);
    if (d.mode === "clip" && m.contended && d.reason.startsWith("predraw-")) {
      // Too slow / too big *as measured while another scene was drawing*: not a reason to give the scene up for the whole page.
      // Keep pre-drawing; the draws that follow are timed alone and the next assessment uses those.
      return {
        ...decidePredraw({ ...input, maxSeconds: Number.POSITIVE_INFINITY, budgetBytes: Number.MAX_SAFE_INTEGER }),
        provisional: true
      };
    }
    return d;
  }

  /** Waits (bounded) until no draw is in flight anywhere on the page. */
  private async waitIdle(maxMs: number): Promise<boolean> {
    const end = Date.now() + maxMs;
    while (work.count > 0) {
      if (this.isDestroyed || Date.now() > end) return false;
      await new Promise<void>((r) => setTimeout(r, 25));
    }
    return true;
  }

  /** Draws `count` preview frames from `start` into the cache, timing each one. False when the Worker failed. */
  private async sampleFrames(count: number, start: number): Promise<boolean> {
    const host = this.host;
    if (!host) return false;
    let drawn = 0;
    for (let k = start; k < Math.min(this.previewFrames, start + count); k++) {
      if (this.isDestroyed || this.isClip()) return false;
      try {
        const res = await this.timedFrame(sourceFrameForPreview(k, this.meta.frames, this.frameStep));
        this.cache.put(this.cacheKey, k, res.bitmap, res.bytes);
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
   * Decides how the scene plays: starts its Worker and draws the first preview frames, one scene at a time page-wide. Idempotent.
   * A measurement taken while another scene was drawing never latches a fallback: it is repeated alone first.
   */
  measure(): Promise<void> {
    if (!this.measurePromise) this.measurePromise = this.doMeasure();
    return this.measurePromise;
  }

  /** Consecutive cached preview frames from `idx`. */
  private readyAhead(idx: number): number {
    return contiguousFrom(this.cache.frameIndices(this.cacheKey), idx);
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
      const payload = { mode: "clip" as const, reason: this.currentDecision.reason };
      this.emit("mode", payload);
      return;
    }

    if (options?.deferMeasure) return; // the film decides lazily: active scene and next only
    this.activateOnMeasure = isActive;
    await this.measure();
  }

  private async doMeasure(): Promise<void> {
    const host = this.host;
    if (!host || !this.envSupported || this.isDestroyed || this.isClip()) return;

    const ok = await runExclusiveMeasure(async () => {
      if (this.isDestroyed || this.isClip()) return false;
      try {
        await host.init({ scale: this.previewSize.scale, params: this.params });
      } catch (err) {
        this.switchToClip(host.unhealthy ? "worker-unhealthy" : `init-failed:${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
      // Draw the first preview frames to measure the draw cost before deciding how the scene plays.
      return this.sampleFrames(Math.min(this.gateSampleFrames, this.previewFrames), 0);
    });
    if (!ok || this.isDestroyed || this.isClip()) return;

    if (host.unhealthy || (this.aloneSamples.length === 0 && this.contendedSamples.length === 0)) {
      this.switchToClip("worker-unhealthy");
      return;
    }

    let plan = this.decide(0);
    if (plan.provisional) {
      // Measured while another scene was drawing and it looked too slow: wait for a quiet moment and measure once alone.
      await this.waitIdle(REMEASURE_IDLE_WAIT_MS);
      if (this.isDestroyed || this.isClip()) return;
      await runExclusiveMeasure(async () => {
        await this.waitIdle(1000);
        return this.sampleFrames(Math.min(3, Math.max(0, this.previewFrames - 3)), 3);
      });
      if (this.isDestroyed || this.isClip()) return;
      plan = this.decide(0);
    }
    if (plan.mode === "clip" && plan.reason.startsWith("predraw-too-slow")) {
      // A fallback is final for the page, so confirm it once with fresh draws (a noisy first sample must not decide it).
      await this.waitIdle(1000);
      await runExclusiveMeasure(() => this.sampleFrames(Math.min(3, Math.max(0, this.previewFrames - 6)), 6));
      if (this.isDestroyed || this.isClip()) return;
      plan = this.decide(0);
    }
    this.plan = plan;
    this.isMeasured = true;

    if (plan.mode === "clip") {
      this.switchToClip(plan.reason);
      return;
    }

    this.variant = plan.mode === "predraw" ? "predraw" : "live";
    this.runNeeded = plan.neededFrames;
    this.publish({ reason: this.variant === "predraw" ? "predraw" : plan.reason });

    // Blit frame 0 immediately if available.
    if (this.cache.has(this.cacheKey, 0) && this.lastShownFrame === null) {
      this.blitFrame(0);
    }

    if (!this.activateOnMeasure && !this.active) {
      if (!this.readyEmitted) {
        this.readyEmitted = true;
        this.emit("ready", { neededFrames: plan.neededFrames, waitSeconds: plan.waitSeconds });
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

    // Buffer the small lead (or start the background pump) so `ready` fires when enough is ahead.
    await this.fillUntilGate(plan.neededFrames);

    if (this.autoPump && !this.isDestroyed && this.currentDecision.mode === "live") {
      void this.pumpScheduler();
    }
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

  /** A scene that was fast at the first measurement and turned out slow becomes a pre-draw scene (or falls back). */
  private reassessLive() {
    if (this.variant !== "live" || this.currentDecision.mode !== "live") return;
    const d = this.decide(this.currentFrame);
    if (d.mode === "clip") {
      this.switchToClip(d.reason);
    } else if (d.mode === "predraw") {
      this.variant = "predraw";
      this.plan = d;
      this.runNeeded = d.neededFrames;
      this.lastTarget = null;
      this.beginPrepare(this.currentFrame);
    }
  }

  /** Window the scheduler may fill, per variant (see `configureWindow`). */
  private aheadCap(): number {
    const remaining = Math.max(1, this.previewFrames - this.currentFrame);
    if (!this.active) {
      const want = this.variant === "predraw" ? Math.max(1, this.runNeeded) : Math.max(1, this.plan?.neededFrames ?? 1);
      return Math.max(0, Math.min(this.previewFrames, want, this.prefetchFrames));
    }
    const other = this.cache.bytes - this.cache.sceneBytes(this.cacheKey);
    const room = Math.max(1, Math.floor((this.cache.budget - other) / this.previewSize.bytesPerFrame));
    return Math.max(1, Math.min(remaining, Math.max(1, this.runNeeded), room));
  }

  private configureWindow() {
    if (!this.active) {
      this.scheduler.setWindow({ lookahead: Math.max(1, this.aheadCap()), behind: 0, head: 0, strictAhead: true });
    } else if (this.variant === "predraw") {
      this.scheduler.setWindow({ lookahead: this.aheadCap(), behind: 0, head: 0, strictAhead: true });
    } else {
      this.scheduler.setWindow({
        lookahead: Math.max(1, this.windowSplit.aheadFrames),
        behind: this.windowSplit.behindFrames,
        head: this.windowSplit.headFrames,
        strictAhead: false
      });
    }
  }

  /** Closes every cached frame the playhead has passed, and (on a jump) the ones beyond the ahead window. */
  private evictBehind(idx: number, alsoBeyond = false) {
    for (const i of indicesToEvict(this.cache.frameIndices(this.cacheKey), idx)) {
      this.cache.release(this.cacheKey, i);
    }
    if (alsoBeyond) {
      const last = idx + Math.max(1, this.aheadCap()) - 1;
      for (const i of this.cache.frameIndices(this.cacheKey)) {
        if (i > last) this.cache.release(this.cacheKey, i);
      }
    }
  }

  /**
   * Starts (or re-starts, after a seek) the pre-draw wait from preview frame `idx`: works out the frames needed ahead and either
   * is ready at once or reports progress until they are drawn. May fall back to the clip.
   */
  private beginPrepare(idx: number) {
    if (this.variant !== "predraw" || this.currentDecision.mode !== "live") return;
    this.prepareBegun = true;
    this.stallSince = null;
    const d = this.decide(idx);
    if (d.mode === "clip") {
      this.switchToClip(d.reason);
      return;
    }
    this.plan = d;
    this.currentFrame = idx;
    this.runNeeded = Math.max(1, d.neededFrames);
    this.evictBehind(idx, true);
    const needed = Math.min(this.runNeeded, Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame)));
    this.runNeeded = needed;
    const ready = this.readyAhead(idx);
    if (ready >= needed) {
      this.finishPrepare();
    } else {
      this.preparing = { needed, t0: this.nowMs(), pct: -1 };
      this.publishProgress(ready, needed);
    }
  }

  private publishProgress(ready: number, needed: number) {
    const prep = this.preparing;
    if (!prep) return;
    const progress = predrawProgress(ready, needed);
    const pct = Math.floor(progress * 100);
    if (pct === prep.pct) return;
    prep.pct = pct;
    this.publish({ reason: "predraw", progress });
  }

  private finishPrepare() {
    const was = this.preparing !== null;
    this.preparing = null;
    if (was || this.currentDecision.progress !== undefined) {
      this.publish({ reason: "ok" });
    }
    if (this.isBuffering) {
      this.isBuffering = false;
      this.emit("buffering", { buffering: false, frame: this.currentFrame * this.frameStep });
    }
    if (this.active && this.cache.has(this.cacheKey, this.currentFrame)) this.blitIfNeeded();
    if (this.active && !this.readyEmitted) {
      this.readyEmitted = true;
      this.emit("ready", { neededFrames: this.runNeeded });
    }
  }

  /** Called after every draw while pre-drawing: progress, start when enough is ready, fall back when it got too slow. */
  private updatePrepare() {
    const prep = this.preparing;
    if (!prep || this.currentDecision.mode !== "live") return;
    const ready = this.readyAhead(this.currentFrame);
    if (ready >= prep.needed) {
      this.finishPrepare();
      return;
    }
    if (this.active && this.scheduler.drawn >= 3) {
      const elapsed = (this.nowMs() - prep.t0) / 1000;
      const d = this.decide(this.currentFrame, { elapsedSeconds: elapsed, readyAhead: ready, tolerance: PREDRAW_REASSESS_TOLERANCE });
      if (d.mode === "clip") {
        this.switchToClip(d.reason);
        return;
      }
      if (d.neededFrames > prep.needed) {
        prep.needed = Math.min(d.neededFrames, Math.max(1, Math.floor(this.cache.budget / this.previewSize.bytesPerFrame)));
        this.runNeeded = prep.needed;
      }
    }
    this.publishProgress(ready, prep.needed);
  }

  /** Pumps the draw-ahead scheduler inside the Worker until the rolling window (or the pre-draw window) is full. */
  async pumpScheduler(maxFrames = this.windowSplit.windowFrames): Promise<number> {
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
        if (!this.active && this.aheadCap() <= 0) break;
        const drew = await this.scheduler.runNext();
        if (!drew) break;
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
    // A request that arrived while the loop was ending (a seek during the last await) must not be lost.
    if (this.repumpRequested && !this.isDestroyed && this.currentDecision.mode === "live") {
      this.repumpRequested = false;
      void this.pumpScheduler();
    }
    return count;
  }

  /** Blits the wanted frame when it has just become available (a held frame was waiting for it). */
  private blitIfNeeded() {
    if (!this.cache.has(this.cacheKey, this.currentFrame)) return;
    if (this.lastShownFrame !== this.currentFrame) {
      this.blitFrame(this.currentFrame);
    }
    if (this.isBuffering) {
      this.isBuffering = false;
      this.emit("buffering", { buffering: false, frame: this.currentFrame * this.frameStep });
    }
  }

  private blitFrame(frame: number): boolean {
    const bm = this.cache.get(this.cacheKey, frame);
    if (!bm) return false;
    this.lastShownFrame = frame;
    if (this.ctx && this.canvas) {
      try {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(bm as unknown as CanvasImageSource, 0, 0, this.canvas.width, this.canvas.height);
      } catch {}
    }
    // Pre-draw mode keeps nothing behind the frame on screen: close every frame the playhead has passed.
    if (this.variant === "predraw" && this.active) this.evictBehind(frame);
    return true;
  }

  /**
   * Draws (or blits from the cache) a frame now. Never blocks and never throws:
   * if `frame` is not cached yet, holds the last shown frame and emits `buffering`.
   * Seek re-prioritises the scheduler immediately. `frame` is the engine's 30 fps source index; each preview frame is held for
   * `frameStep` of them.
   */
  showFrame(frame: number): void {
    if (this.isDestroyed || this.currentDecision.mode === "clip") return;
    const idx = previewIndexForFrame(frame, this.meta.frames, this.frameStep);
    if (!this.isMeasured && this.host && this.envSupported) {
      // Not decided yet (the film decides lazily): decide now, and hold the clock with a "preparing" state meanwhile.
      this.currentFrame = idx;
      this.active = true;
      void this.measure();
      if (!this.measuringAnnounced) {
        this.measuringAnnounced = true;
        this.publish({ reason: "predraw", progress: 0 });
      }
      return;
    }
    const wasActive = this.active;
    this.active = true;
    if (!wasActive && this.scheduler.isPaused) this.scheduler.resume();

    if (this.variant === "predraw") {
      const last = this.lastTarget;
      const jump = last === null || idx < last || idx > last + PREDRAW_JUMP_FRAMES;
      this.lastTarget = idx;
      this.currentFrame = idx;
      if (jump) this.beginPrepare(idx);
      if (this.isClip()) return;
    }
    this.currentFrame = idx;

    // Re-prioritise the scheduler and cache focus around the requested frame.
    this.scheduler.focus(this.cacheKey, idx);

    const choice = chooseFrame({
      target: idx,
      lastShown: this.lastShownFrame,
      isReady: (f) => this.cache.has(this.cacheKey, f)
    });

    if (!choice.stalled) {
      this.stallSince = null;
      this.blitFrame(choice.frame);
      if (this.isBuffering) {
        this.isBuffering = false;
        this.emit("buffering", { buffering: false, frame });
      }
    } else if (!this.preparing) {
      // Hold lastShownFrame on canvas; do not block audio clock. (While pre-drawing the "Preparing" state says it already.)
      const now = this.nowMs();
      if (this.stallSince === null) this.stallSince = now;
      if (this.variant === "predraw" && now - this.stallSince > PREDRAW_STALL_REPREPARE_MS) {
        // Drawing fell behind for good: rebuild the lead from here (or fall back if that would take too long).
        this.beginPrepare(idx);
        if (this.isClip()) return;
      } else if (!this.isBuffering) {
        this.isBuffering = true;
        this.emit("buffering", {
          buffering: true,
          frame,
          heldFrame: this.lastShownFrame === null ? null : this.lastShownFrame * this.frameStep
        });
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

  /** Cached ranges in the engine's source frame indices (each preview frame covers `frameStep` of them). */
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
   * Pipeline: pre-draws up to `frames` preview frames of this (not yet playing) scene while the previous one plays, within the
   * bytes the film can spare. Does nothing for the scene that is playing, a clip scene or an unmounted one.
   */
  prefetch(frames: number): void {
    if (this.isDestroyed || this.active || !this.host || this.currentDecision.mode !== "live") return;
    if (!this.plan) return; // not measured yet
    const cap = Math.max(0, Math.floor(frames));
    this.prefetchFrames = cap;
    if (cap <= 0) return;
    if (this.scheduler.isPaused) this.scheduler.resume();
    if (this.variant === "predraw" && !this.prepareBegun) {
      this.currentFrame = 0;
      this.beginPrepare(0);
      if (this.currentDecision.mode !== "live") return;
    }
    void this.pumpScheduler();
  }

  /** The film moved to another scene: stop drawing for this one and free what pre-draw mode holds. */
  deactivate(): void {
    if (this.isDestroyed || !this.active) return;
    this.active = false;
    this.lastTarget = null;
    this.prepareBegun = false;
    this.prefetchFrames = 0;
    this.isBuffering = false;
    if (this.preparing) {
      this.preparing = null;
      if (this.currentDecision.mode === "live") this.publish({ reason: "ok" });
    }
    this.scheduler.pause();
    if (this.variant === "predraw") {
      // Nothing of a pre-drawn scene is worth keeping once it has played; scrubbing back simply redraws.
      this.cache.drop(this.cacheKey);
      this.lastShownFrame = null;
    }
  }

  /** Recycles the underlying Worker at a scene boundary to release retained Worker memory. */
  async recycle(): Promise<void> {
    if (this.host && !this.isDestroyed && this.currentDecision.mode === "live") {
      await this.host.recycle("scene-boundary");
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
    this.scheduler.pause();
    if (this.ownsHost && this.host) {
      this.host.destroy();
    }
    if (this.ownsCache) {
      this.cache.clear();
    } else {
      this.cache.drop(this.cacheKey);
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
  frames: number;
  durationSeconds?: number;
  environment?: string | EnvironmentProbeInput;
  forceClipReason?: string;
};

export type FilmPlayerOptions = {
  scenes: FilmSceneSpec[];
  aspect?: AspectRatio | string;
  fps?: number;
  budgetBytes?: number;
  timeSource?: TimeSource;
  clock?: PlaybackClock;
  transportFactory?: WorkerTransportFactory;
  environment?: string | EnvironmentProbeInput;
  autoPump?: boolean;
  frameStep?: number;
  maxPredrawSeconds?: number;
  now?: () => number;
};

export interface FilmPlayer extends ScenePlayer {
  readonly clock: PlaybackClock;
  readonly cache: FrameCache<ImageBitmapLike>;
  readonly scenes: readonly PlatePlayer[];
  readonly activeSceneIndex: number;
  decision(sceneIndex?: number): PlayerDecision;
  syncToClock(): void;
  updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void>;
}

/**
 * Sequences several plate scene players on one timeline using `PlaybackClock`, sharing a single
 * byte-budgeted `FrameCache` and recycling the previous scene's Worker at every scene boundary.
 */
export function createFilmPlayer(options: FilmPlayerOptions): FilmPlayer {
  const fps = options.fps ?? 30;
  const aspect = options.aspect ?? "16:9";
  const preview = previewSizeForAspect(aspect);
  const budgetBytes = options.budgetBytes ?? resolveCacheBudgetBytes();
  const sharedCache = new FrameCache<ImageBitmapLike>(budgetBytes);
  const sceneSpecs = options.scenes.map((s) => ({ ...s }));

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

  const defaultSource: TimeSource = options.timeSource ?? { currentTime: () => 0, playing: () => false };
  const clock = options.clock ?? new PlaybackClock(defaultSource, fps, totalFrames);

  let activeIdx = 0;
  let destroyed = false;
  let mountedEl: HTMLElement | null = null;
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

  const makeScenePlayer = (s: FilmSceneSpec, idx: number): PlatePlayer => {
    const p = new PlatePlayer({
      id: s.id,
      bundleDigest: s.bundleDigest,
      html: s.html,
      params: s.params,
      aspect,
      fps,
      frames: s.frames,
      hasNextScene: idx < sceneSpecs.length - 1,
      cache: sharedCache,
      budgetBytes,
      transportFactory: options.transportFactory,
      environment: s.environment ?? options.environment,
      forceClipReason: s.forceClipReason,
      autoPump: options.autoPump ?? true,
      ...(options.frameStep !== undefined ? { frameStep: options.frameStep } : {}),
      ...(options.maxPredrawSeconds !== undefined ? { maxPredrawSeconds: options.maxPredrawSeconds } : {}),
      ...(options.now ? { now: options.now } : {})
    });
    p.on("buffering", (d) => emit("buffering", { sceneIndex: idx, ...(typeof d === "object" && d ? d : {}) }));
    p.on("error", (d) => emit("error", { sceneIndex: idx, error: d }));
    p.on("mode", (d) => {
      updateCanvasVisibility();
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
    cache: sharedCache,
    scenes: players,
    get activeSceneIndex() {
      return activeIdx;
    },
    decision(sceneIndex = activeIdx): PlayerDecision {
      return players[sceneIndex]?.decision() ?? { mode: "clip", reason: "no-scene" };
    },
    async mount(el: HTMLElement): Promise<void> {
      if (destroyed) throw new Error("FilmPlayer has been destroyed.");
      mountedEl = el;
      // Canvases and Workers only: no scene is sampled yet. Only the scene on screen and the next one are ever decided, one at a
      // time, so a scene further away does no work and a measurement never competes with three others.
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
      emit("ready");
    },
    async updateScene(sceneIndex: number, spec: FilmSceneSpec): Promise<void> {
      if (destroyed || sceneIndex < 0 || sceneIndex >= players.length) return;
      const oldPlayer = players[sceneIndex];
      if (oldPlayer) {
        oldPlayer.destroy();
      }
      sceneSpecs[sceneIndex] = { ...spec };
      rebuildSpans();
      const nextPlayer = makeScenePlayer(spec, sceneIndex);
      players[sceneIndex] = nextPlayer;
      sharedCache.setOrder(players.map((p) => p.cacheKey));
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
      }
    },
    showFrame(globalFrame: number): void {
      if (destroyed || !players.length) return;
      const { sceneIndex, localFrame } = sceneForGlobalFrame(globalFrame);
      if (sceneIndex !== activeIdx) {
        const previous = players[activeIdx];
        activeIdx = sceneIndex;
        // Stop the previous scene's drawing, free what pre-draw mode holds, and recycle its Worker at every scene boundary (Plan §10).
        if (previous) {
          previous.deactivate();
          void previous.recycle().catch(() => {});
        }
      }
      updateCanvasVisibility();
      const current = players[sceneIndex];
      if (!current) return;
      const next = players[sceneIndex + 1];
      sharedCache.setPinned(next ? [current.cacheKey, next.cacheKey] : [current.cacheKey]);
      current.showFrame(localFrame);

      // Pipeline: while this scene plays (or plays as its clip), pre-draw the next one with the bytes this one does not need.
      // One scene at a time, so only one extra Worker ever draws.
      // The next scene is decided here too (it was not at mount), once the current one is decided and not busy preparing.
      if (next && !current.isPreparing && (current.measuredYet || current.decision().mode === "clip")) {
        if (!next.measuredYet) {
          void next.measure().catch(() => {});
        } else if (next.decision().mode === "live") {
          const bpf = preview.bytesPerFrame;
          const spare = budgetBytes - current.reservedBytes() - 2 * bpf;
          next.prefetch(Math.floor(spare / bpf));
        }
      }
    },
    syncToClock(): void {
      const f = frameAt(clock.now(), fps, totalFrames);
      this.showFrame(f);
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
      for (const p of players) {
        p.destroy();
      }
      sharedCache.clear();
      for (const set of Object.values(listeners)) {
        set.clear();
      }
    }
  };
}
