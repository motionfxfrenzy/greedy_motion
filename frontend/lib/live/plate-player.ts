import { PlaybackClock, bufferedAhead, chooseFrame, frameAt, sceneAt, type TimeSource } from "./clock.ts";
import { FrameCache, computeRollingWindow, frameCacheKey, sceneCacheKey, type RollingWindowSplit } from "./frame-cache.ts";
import { FrameScheduler } from "./frame-scheduler.ts";
import { environmentStatus, resolveCacheBudgetBytes, supportsWorkerHost, type EnvironmentProbeInput } from "./support.ts";
import type { PlayerDecision, PlayerEvent, PlayerMeta, ScenePlayer, SceneSpan } from "./types.ts";
import { WorkerHost, type ImageBitmapLike, type WorkerHostOptions, type WorkerTransportFactory } from "./worker-host.ts";

/**
 * Live plate scene player and multi-scene film sequencer (docs/LIVE_SCENES_PLAN.md §5, §6, §10, §20).
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
 * Preview resolution for each aspect ratio:
 * 854x480 for 16:9, 480x854 for 9:16, 640x640 for 1:1.
 * The Worker is mounted at the matching scale so OffscreenCanvas dimensions equal the preview size.
 */
export function previewSizeForAspect(
  aspect: AspectRatio | string = "16:9",
  fullWidth?: number,
  fullHeight?: number
): PreviewSizeSpec {
  if (aspect === "9:16") {
    const baseW = fullWidth && fullWidth > 0 ? fullWidth : 1080;
    const width = 480;
    const height = 854;
    // Note: 1080 * (854 / 1920) = 480.375 -> Math.round = 480; 1920 * (854 / 1920) = 854.
    const scale = baseW === 1080 ? 854 / 1920 : width / baseW;
    return { width, height, label: "480x854", scale, bytesPerFrame: width * height * 4 };
  }
  if (aspect === "1:1") {
    const baseW = fullWidth && fullWidth > 0 ? fullWidth : 1080;
    const width = 640;
    const height = 640;
    const scale = width / baseW;
    return { width, height, label: "640x640", scale, bytesPerFrame: width * height * 4 };
  }
  const baseW = fullWidth && fullWidth > 0 ? fullWidth : 1920;
  const width = 854;
  const height = 480;
  const scale = width / baseW;
  void fullHeight;
  return { width, height, label: "854x480", scale, bytesPerFrame: width * height * 4 };
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
 * Evaluates the buffering gate and live-vs-clip decision (docs/LIVE_SCENES_PLAN.md §6, §20):
 * `lead = clipSeconds * max(0, 1 - produceFps / consumeFps) + 0.5 s`
 * If `lead` exceeds the ahead capacity from the byte budget, or the host is unhealthy, or
 * `supportsWorkerHost()` is false, returns `mode: "clip"`.
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
  gateSampleFrames?: number;
  autoPump?: boolean;
};

export class PlatePlayer implements ScenePlayer {
  readonly meta: PlayerMeta;
  readonly bundleDigest: string;
  readonly previewSize: PreviewSizeSpec;
  readonly cacheKey: string;
  readonly cache: FrameCache<ImageBitmapLike>;
  readonly windowSplit: RollingWindowSplit;

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

  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private currentFrame = 0;
  private lastShownFrame: number | null = null;
  private isBuffering = false;
  private readyEmitted = false;
  private currentDecision: PlayerDecision = { mode: "live", reason: "ok" };
  private pumping = false;
  private isDestroyed = false;

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

    const fps = options.fps ?? 30;
    const frames = options.frames ?? 90;
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

    if (!this.envSupported) {
      this.ownsHost = false;
      this.host = null;
      this.currentDecision = {
        mode: "clip",
        reason: this.envState === "unverified" ? "unverified-environment" : "unsupported-environment"
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
      scenes: [{ id: this.cacheKey, frames }],
      fps,
      lookahead: Math.max(1, this.windowSplit.aheadFrames),
      head: this.windowSplit.headFrames,
      behind: this.windowSplit.behindFrames,
      draw: async (_sceneKey, frame) => {
        if (!this.host || this.currentDecision.mode === "clip") {
          throw new Error("Player is in clip mode.");
        }
        const res = await this.host.frame(frame);
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

  /** Cache key for a specific frame index: `bundleDigest | frame | previewSize`. */
  keyForFrame(frame: number): string {
    return frameCacheKey(this.bundleDigest, frame, this.previewSize.label);
  }

  get drawCostMs(): number {
    return this.scheduler.cost;
  }

  get workerHost(): WorkerHost | null {
    return this.host;
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
    this.scheduler.pause();
    const payload = { mode: "clip" as const, reason };
    this.emit("mode", payload);
  }

  async mount(el: HTMLElement): Promise<void> {
    if (this.isDestroyed) throw new Error("Player has been destroyed.");
    this.container = el;

    if (typeof el.ownerDocument?.createElement === "function") {
      const canvas = el.ownerDocument.createElement("canvas");
      canvas.width = this.previewSize.width;
      canvas.height = this.previewSize.height;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      el.appendChild(canvas);
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
    }

    if (!this.envSupported || !this.host) {
      const payload = { mode: "clip" as const, reason: this.currentDecision.reason };
      this.emit("mode", payload);
      return;
    }

    try {
      await this.host.init({ scale: this.previewSize.scale, params: this.params });
    } catch (err) {
      this.switchToClip(
        this.host.unhealthy ? "worker-unhealthy" : `init-failed:${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    // Draw initial sample frames to measure draw cost and evaluate the buffering gate before starting playback.
    const samplesToDraw = Math.min(this.gateSampleFrames, this.meta.frames);
    let drawSumMs = 0;
    let drawnCount = 0;

    for (let f = 0; f < samplesToDraw; f++) {
      if (this.isDestroyed || this.currentDecision.mode === "clip") return;
      try {
        const res = await this.host.frame(f);
        this.cache.put(this.cacheKey, f, res.bitmap, res.bytes);
        drawSumMs += res.drawMs;
        drawnCount++;
      } catch {
        if (this.host.unhealthy) {
          this.switchToClip("worker-unhealthy");
          return;
        }
        break;
      }
    }

    if (this.host.unhealthy || drawnCount === 0) {
      this.switchToClip("worker-unhealthy");
      return;
    }

    const avgDrawMs = drawSumMs / drawnCount;
    const aheadBufferedSec = bufferedAhead(this.cache.buffered(this.cacheKey), this.currentFrame, this.meta.fps);
    const gate = evaluatePlaybackGate({
      frames: this.meta.frames,
      fps: this.meta.fps,
      avgDrawMs,
      aheadFrames: this.windowSplit.aheadFrames,
      bufferedAheadSeconds: aheadBufferedSec,
      unhealthy: this.host.unhealthy,
      supported: this.envSupported,
      envStatus: this.envState
    });

    if (gate.mode === "clip") {
      this.switchToClip(gate.reason);
      return;
    }

    this.currentDecision = { mode: "live", reason: gate.reason };
    this.emit("mode", { mode: "live", reason: gate.reason });

    // Blit frame 0 immediately if available.
    if (this.cache.has(this.cacheKey, 0)) {
      this.blitFrame(0);
    }

    // Buffer up to `lead` (or start background pump) so `ready` fires when bufferedAhead >= lead.
    await this.fillUntilGate(gate.leadSeconds);

    if (this.autoPump && !this.isDestroyed && this.currentDecision.mode === "live") {
      void this.pumpScheduler();
    }
  }

  private async fillUntilGate(leadSeconds: number): Promise<void> {
    const targetSec = Math.min(leadSeconds, this.meta.frames / this.meta.fps);
    while (!this.isDestroyed && this.currentDecision.mode === "live") {
      const aheadSec = bufferedAhead(this.cache.buffered(this.cacheKey), this.currentFrame, this.meta.fps);
      if (aheadSec + 1e-6 >= targetSec) {
        if (!this.readyEmitted) {
          this.readyEmitted = true;
          this.emit("ready", { leadSeconds, bufferedAheadSeconds: aheadSec });
        }
        return;
      }
      const drew = await this.scheduler.runNext();
      if (!drew) {
        if (this.host?.unhealthy) {
          this.switchToClip("worker-unhealthy");
        } else if (!this.readyEmitted) {
          this.readyEmitted = true;
          this.emit("ready", { leadSeconds, bufferedAheadSeconds: aheadSec });
        }
        return;
      }
      if (this.scheduler.cost > 0) {
        const recheck = evaluatePlaybackGate({
          frames: this.meta.frames,
          fps: this.meta.fps,
          avgDrawMs: this.scheduler.cost,
          aheadFrames: this.windowSplit.aheadFrames,
          bufferedAheadSeconds: bufferedAhead(this.cache.buffered(this.cacheKey), this.currentFrame, this.meta.fps),
          unhealthy: this.host?.unhealthy ?? false,
          supported: this.envSupported,
          envStatus: this.envState
        });
        if (recheck.mode === "clip") {
          this.switchToClip(recheck.reason);
          return;
        }
      }
    }
  }

  /** Pumps the draw-ahead scheduler inside the Worker until the rolling window is full. */
  async pumpScheduler(maxFrames = this.windowSplit.windowFrames): Promise<number> {
    if (this.pumping || this.isDestroyed || this.currentDecision.mode !== "live") return 0;
    this.pumping = true;
    let count = 0;
    try {
      while (!this.isDestroyed && this.currentDecision.mode === "live" && count < maxFrames) {
        const drew = await this.scheduler.runNext();
        if (!drew) break;
        count++;
        if (this.host?.unhealthy) {
          this.switchToClip("worker-unhealthy");
          break;
        }
      }
    } finally {
      this.pumping = false;
    }
    return count;
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
    return true;
  }

  /**
   * Draws (or blits from the cache) a frame now. Never blocks and never throws:
   * if `frame` is not cached yet, holds the last shown frame and emits `buffering`.
   * Seek re-prioritises the scheduler immediately.
   */
  showFrame(frame: number): void {
    if (this.isDestroyed || this.currentDecision.mode === "clip") return;
    const clamped = Math.max(0, Math.min(this.meta.frames - 1, Math.floor(frame)));
    this.currentFrame = clamped;

    // Re-prioritise the scheduler and cache focus around the requested frame.
    this.scheduler.focus(this.cacheKey, clamped);

    const choice = chooseFrame({
      target: clamped,
      lastShown: this.lastShownFrame,
      isReady: (f) => this.cache.has(this.cacheKey, f)
    });

    if (!choice.stalled) {
      this.blitFrame(choice.frame);
      if (this.isBuffering) {
        this.isBuffering = false;
        this.emit("buffering", { buffering: false, frame: clamped });
      }
    } else {
      // Hold lastShownFrame on canvas; do not block audio clock.
      if (!this.isBuffering) {
        this.isBuffering = true;
        this.emit("buffering", { buffering: true, frame: clamped, heldFrame: this.lastShownFrame });
      }
    }

    if (this.autoPump) {
      void this.pumpScheduler();
    }
  }

  ready(frame: number): boolean {
    if (this.currentDecision.mode === "clip") return false;
    const clamped = Math.max(0, Math.min(this.meta.frames - 1, Math.floor(frame)));
    return this.cache.has(this.cacheKey, clamped);
  }

  buffered(): { from: number; to: number }[] {
    return this.cache.buffered(this.cacheKey);
  }

  on(event: PlayerEvent, callback: (detail?: unknown) => void): () => void {
    this.listeners[event].add(callback);
    return () => {
      this.listeners[event].delete(callback);
    };
  }

  /** Recycles the underlying Worker at a scene boundary to release retained Worker memory. */
  async recycle(): Promise<void> {
    if (this.host && !this.isDestroyed && this.currentDecision.mode === "live") {
      await this.host.recycle("scene-boundary");
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
};

export interface FilmPlayer extends ScenePlayer {
  readonly clock: PlaybackClock;
  readonly cache: FrameCache<ImageBitmapLike>;
  readonly scenes: readonly PlatePlayer[];
  readonly activeSceneIndex: number;
  decision(sceneIndex?: number): PlayerDecision;
  syncToClock(): void;
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

  const spans: SceneSpan[] = [];
  const startFrames: number[] = [];
  let cursorFrames = 0;

  for (const s of options.scenes) {
    const startSec = cursorFrames / fps;
    startFrames.push(cursorFrames);
    cursorFrames += s.frames;
    const endSec = cursorFrames / fps;
    spans.push({ id: s.id, start: startSec, end: endSec });
  }

  const totalFrames = Math.max(1, cursorFrames);
  const defaultSource: TimeSource = options.timeSource ?? { currentTime: () => 0, playing: () => false };
  const clock = options.clock ?? new PlaybackClock(defaultSource, fps, totalFrames);

  const players = options.scenes.map(
    (s, idx) =>
      new PlatePlayer({
        id: s.id,
        bundleDigest: s.bundleDigest,
        html: s.html,
        params: s.params,
        aspect,
        fps,
        frames: s.frames,
        hasNextScene: idx < options.scenes.length - 1,
        cache: sharedCache,
        budgetBytes,
        transportFactory: options.transportFactory,
        environment: options.environment,
        autoPump: options.autoPump ?? true
      })
  );

  sharedCache.setOrder(players.map((p) => p.cacheKey));

  let activeIdx = 0;
  let destroyed = false;
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

  players.forEach((p, idx) => {
    p.on("buffering", (d) => emit("buffering", { sceneIndex: idx, ...(typeof d === "object" && d ? d : {}) }));
    p.on("error", (d) => emit("error", { sceneIndex: idx, error: d }));
    p.on("mode", (d) => emit("mode", { sceneIndex: idx, ...(typeof d === "object" && d ? d : {}) }));
  });

  const sceneForGlobalFrame = (globalFrame: number): { sceneIndex: number; localFrame: number } => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, Math.floor(globalFrame)));
    const t = clamped / fps;
    const idx = Math.max(0, sceneAt(spans, t));
    const localFrame = Math.max(0, Math.min((options.scenes[idx]?.frames ?? 1) - 1, clamped - (startFrames[idx] ?? 0)));
    return { sceneIndex: idx, localFrame };
  };

  const meta: PlayerMeta = {
    width: preview.width,
    height: preview.height,
    fps,
    frames: totalFrames,
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
      for (const p of players) {
        await p.mount(el);
      }
      emit("ready");
    },
    showFrame(globalFrame: number): void {
      if (destroyed || !players.length) return;
      const { sceneIndex, localFrame } = sceneForGlobalFrame(globalFrame);
      if (sceneIndex !== activeIdx) {
        const previous = players[activeIdx];
        activeIdx = sceneIndex;
        // Recycle the previous scene's Worker at every scene boundary (Plan §10).
        if (previous) {
          void previous.recycle().catch(() => {});
        }
      }
      const current = players[sceneIndex];
      if (!current) return;
      const next = players[sceneIndex + 1];
      sharedCache.setPinned(next ? [current.cacheKey, next.cacheKey] : [current.cacheKey]);
      current.showFrame(localFrame);
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
