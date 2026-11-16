import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { inlineBundleAssets, verifyBundleHtmlSha } from "./api.ts";
import { createWorkerHost, type ImageBitmapLike, type WorkerHostOptions } from "./worker-host.ts";

/**
 * Fast export (browser half). While Preview is open and idle, each scene whose export clip is not cached yet is drawn here on
 * the user's GPU, frame i = `FILM.seek(i, { mode: "full" })` exactly as the worker's capture adapter draws it
 * (packages/plate-engine/lib/capture.mjs), encoded to H.264 with WebCodecs, muxed to MP4 and uploaded to
 * `PUT /v1/projects/:id/plates/clips`. The export worker then finds every clip in its cache and only joins them.
 *
 * Everything here is best effort: no WebCodecs, no H.264, a scene that fails, a closed tab, or a refused upload all leave
 * the scene to the worker, which draws it as before. Nothing here blocks Preview or Export. Kept free of React.
 */

export type ClipTarget = {
  index: number;
  variantId: string;
  bundleDigest: string;
  bundleSha?: string;
  bundleFrames: number;
  width: number;
  height: number;
  fps: number;
  params: Record<string, unknown>;
  bundleUrl: string;
  /** A scene with template pictures: links to the FULL-size pictures and their digest (the clip is cached under both). */
  assets?: Record<string, string>;
  assetsDigest?: string;
};

export type ClipTargetsResponse = {
  aspect: string;
  enabled: boolean;
  state?: string;
  total: number;
  cached: number;
  targets: ClipTarget[];
};

export type BrowserClipStatus =
  | { state: "off" }
  | { state: "waiting"; done: number; total: number }
  | { state: "preparing"; done: number; total: number; scene: number }
  | { state: "ready"; done: number; total: number };

// ---------------------------------------------------------------- encoder

export const CLIP_BITRATE = 12_000_000;
/** H.264 High 4.0 first (1080x1920 at 30 fps = 8160 macroblocks, within level 4.0), then Main and Baseline at the same level. */
export const H264_CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.640029", "avc1.4d0029"] as const;

type EncoderSupportProbe = (config: VideoEncoderConfig) => Promise<{ supported?: boolean; config?: VideoEncoderConfig }>;

export function encoderConfigFor(codec: string, width: number, height: number, fps: number): VideoEncoderConfig {
  return {
    codec,
    width,
    height,
    framerate: fps,
    bitrate: CLIP_BITRATE,
    bitrateMode: "variable",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
    avc: { format: "avc" }
  };
}

/** The first H.264 configuration this browser can encode at `width`x`height`, or null (then the worker draws). */
export async function pickEncoderConfig(
  width: number,
  height: number,
  fps = 30,
  probe: EncoderSupportProbe | undefined = typeof VideoEncoder !== "undefined" ? (c) => VideoEncoder.isConfigSupported(c) : undefined
): Promise<VideoEncoderConfig | null> {
  if (!probe) return null;
  for (const codec of H264_CODECS) {
    const config = encoderConfigFor(codec, width, height, fps);
    try {
      const res = await probe(config);
      if (res?.supported) return config;
    } catch {}
  }
  return null;
}

/** Cheap synchronous gate: the APIs exist at all (the real H.264 check is `pickEncoderConfig`). */
export function browserClipsSupported(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): boolean {
  return typeof g.VideoEncoder === "function" && typeof g.VideoFrame === "function" && typeof g.OffscreenCanvas === "function" && typeof g.Worker === "function";
}

/** Microsecond timestamp of frame `i`: rounded, so the muxer (frameRate set) lands every frame on an exact 1/fps tick. */
export const frameTimestampUs = (i: number, fps: number) => Math.round((i * 1_000_000) / fps);

export type EncodeApi = {
  VideoEncoder: new (init: VideoEncoderInit) => VideoEncoder;
  VideoFrame: new (source: CanvasImageSource, init: VideoFrameInit) => VideoFrame;
  createMuxer: (width: number, height: number, fps: number) => { addVideoChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void; finalize: () => Uint8Array };
};

export const defaultEncodeApi = (): EncodeApi => ({
  VideoEncoder: VideoEncoder,
  VideoFrame: VideoFrame as unknown as EncodeApi["VideoFrame"],
  createMuxer: (width, height, fps) => {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width, height, frameRate: fps }, fastStart: "in-memory", firstTimestampBehavior: "strict" });
    return {
      addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      finalize: () => {
        muxer.finalize();
        return new Uint8Array(target.buffer);
      }
    };
  }
});

export type EncodeClipOptions = {
  frames: number;
  width: number;
  height: number;
  fps?: number;
  config: VideoEncoderConfig;
  /** Draws frame `i` and resolves its bitmap; the pipeline closes it once the VideoFrame holds the pixels. */
  drawFrame: (i: number) => Promise<ImageBitmapLike>;
  /** Awaited before every frame: holds the encode while the user plays or scrubs. */
  gate?: () => Promise<void>;
  signal?: AbortSignal;
  api?: EncodeApi;
  keyFrameEvery?: number;
  maxQueue?: number;
};

export type EncodeClipResult = { bytes: Uint8Array; frames: number; msTotal: number; msPerFrame: number; drawMsPerFrame: number; codec: string };

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Aborted.");
};

/** Draws, encodes and muxes `frames` frames into one MP4 (the picture only; captions, audio and watermark come at export). */
export async function encodeClip(options: EncodeClipOptions): Promise<EncodeClipResult> {
  const fps = options.fps ?? 30;
  const api = options.api ?? defaultEncodeApi();
  const keyEvery = options.keyFrameEvery ?? fps;
  const maxQueue = options.maxQueue ?? 4;
  const started = performance.now();
  let drawMs = 0;
  let chunks = 0;
  let failure: Error | null = null;
  const muxer = api.createMuxer(options.width, options.height, fps);
  const encoder = new api.VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
        chunks++;
      } catch (e) {
        failure ??= e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => { failure ??= e instanceof Error ? e : new Error(String(e)); }
  });
  try {
    encoder.configure(options.config);
    for (let i = 0; i < options.frames; i++) {
      aborted(options.signal);
      if (failure) throw failure;
      if (options.gate) await options.gate();
      aborted(options.signal);
      while (encoder.encodeQueueSize > maxQueue) await new Promise((r) => setTimeout(r, 2));
      const t0 = performance.now();
      const bitmap = await options.drawFrame(i);
      drawMs += performance.now() - t0;
      if (bitmap.width !== options.width || bitmap.height !== options.height) {
        bitmap.close();
        throw new Error(`Frame ${i} is ${bitmap.width}x${bitmap.height}, expected ${options.width}x${options.height}.`);
      }
      let frame: VideoFrame;
      try {
        frame = new api.VideoFrame(bitmap as unknown as CanvasImageSource, { timestamp: frameTimestampUs(i, fps), duration: frameTimestampUs(i + 1, fps) - frameTimestampUs(i, fps) });
      } finally {
        bitmap.close();
      }
      try {
        encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      } finally {
        frame.close();
      }
    }
    await encoder.flush();
    if (failure) throw failure;
    if (chunks !== options.frames) throw new Error(`The encoder produced ${chunks} chunks for ${options.frames} frames.`);
    const bytes = muxer.finalize();
    const msTotal = performance.now() - started;
    return { bytes, frames: options.frames, msTotal, msPerFrame: msTotal / options.frames, drawMsPerFrame: drawMs / options.frames, codec: options.config.codec };
  } finally {
    if (encoder.state !== "closed") {
      try { encoder.close(); } catch {}
    }
  }
}

/** Draws one scene bundle in its own WorkerHost (scale 1, full quality) and encodes it. */
export async function encodeSceneClip(options: {
  html: string;
  params: Record<string, unknown>;
  frames: number;
  width: number;
  height: number;
  fps?: number;
  config?: VideoEncoderConfig | null;
  gate?: () => Promise<void>;
  signal?: AbortSignal;
  hostOptions?: Partial<WorkerHostOptions>;
  api?: EncodeApi;
}): Promise<EncodeClipResult> {
  const fps = options.fps ?? 30;
  const config = options.config ?? (await pickEncoderConfig(options.width, options.height, fps));
  if (!config) throw new Error("This browser cannot encode H.264 at the export size.");
  // A generous watchdog: an export frame is drawn at full quality and full size, and nothing waits on it.
  const host = createWorkerHost({ html: options.html, params: options.params, watchdogMs: 15_000, ...(options.hostOptions ?? {}) });
  const onAbort = () => host.destroy();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const init = await host.init({ scale: 1, params: options.params });
    if (init.w !== options.width || init.h !== options.height) throw new Error(`The scene draws at ${init.w}x${init.h}, expected ${options.width}x${options.height}.`);
    const sceneFrames = Number(init.meta?.durationFrames ?? init.meta?.frames ?? options.frames);
    if (sceneFrames !== options.frames) throw new Error(`The scene lasts ${sceneFrames} frames, expected ${options.frames}.`);
    return await encodeClip({
      frames: options.frames,
      width: options.width,
      height: options.height,
      fps,
      config,
      gate: options.gate,
      signal: options.signal,
      api: options.api,
      drawFrame: async (i) => (await host.frame(i, { qualitySpec: { mode: "full" } })).bitmap
    });
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    host.destroy();
  }
}

// ---------------------------------------------------------------- scheduler

const attemptKey = (t: ClipTarget) => (t.assetsDigest ? `${t.bundleDigest}~a${t.assetsDigest}` : t.bundleDigest);

export type UploadOutcome = "stored" | "duplicate" | "stale" | "rejected" | "limited" | "error";

export type BrowserClipSchedulerDeps = {
  fetchTargets: () => Promise<ClipTargetsResponse>;
  loadBundle: (target: ClipTarget) => Promise<string>;
  encode: (target: ClipTarget, html: string, ctx: { gate: () => Promise<void>; signal: AbortSignal }) => Promise<Uint8Array>;
  upload: (target: ClipTarget, bytes: Uint8Array) => Promise<UploadOutcome>;
  /** True while the user plays or scrubs: the scheduler waits, and a running encode pauses between frames. */
  isBusy: () => boolean;
  /** Real H.264 support at this size; false switches the scheduler off for this film. */
  canEncode: (target: ClipTarget) => Promise<boolean>;
  onStatus?: (status: BrowserClipStatus) => void;
  onLog?: (event: string, detail?: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Idle this long before starting or resuming. */
  idleMs?: number;
  /** Re-check for changed scenes (a comment fix) this often while idle. */
  pollMs?: number;
};

/**
 * One film, one ratio. Waits for an idle Preview, asks which scene clips the export still needs, and draws them one at a time.
 * A digest is attempted at most once per session (success or failure), so a comment fix re-encodes only the scene it changed.
 */
export class BrowserClipScheduler {
  private stopped = false;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private attempted = new Set<string>();
  private wake: (() => void) | null = null;
  private lastBusyAt = 0;
  private readonly deps: Required<Pick<BrowserClipSchedulerDeps, "sleep" | "now" | "idleMs" | "pollMs">> & BrowserClipSchedulerDeps;

  constructor(deps: BrowserClipSchedulerDeps) {
    this.deps = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      idleMs: 1500,
      pollMs: 20_000,
      ...deps
    };
  }

  get attemptedDigests(): ReadonlySet<string> {
    return this.attempted;
  }

  start(): void {
    if (this.running || this.stopped) return;
    this.running = this.loop().catch((e) => this.deps.onLog?.("browser_clips_loop_failed", { message: String((e as Error)?.message ?? e) })).finally(() => { this.running = null; });
  }

  /** Check again now (the storyboard or a scene changed). */
  poke(): void {
    this.wake?.();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort(new Error("stopped"));
    this.wake?.();
  }

  get done(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private status(s: BrowserClipStatus) {
    this.deps.onStatus?.(s);
  }

  /** Resolves once the user has been neither playing nor scrubbing for `idleMs`. */
  private async waitIdle(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const now = this.deps.now();
      if (this.deps.isBusy()) this.lastBusyAt = now;
      else if (now - this.lastBusyAt >= this.deps.idleMs) return;
      await this.deps.sleep(100);
    }
  }

  private async nap(ms: number): Promise<void> {
    await Promise.race([this.deps.sleep(ms), new Promise<void>((r) => { this.wake = r; })]);
    this.wake = null;
  }

  private async loop(): Promise<void> {
    let backoff = 0;
    while (!this.stopped) {
      await this.waitIdle();
      if (this.stopped) return;
      let res: ClipTargetsResponse;
      try {
        res = await this.deps.fetchTargets();
        backoff = 0;
      } catch {
        backoff = Math.min(backoff ? backoff * 2 : 5_000, 120_000);
        await this.nap(backoff);
        continue;
      }
      if (!res.enabled) {
        this.status({ state: "off" });
        return;
      }
      const todo = res.targets.filter((t) => !this.attempted.has(attemptKey(t)));
      const total = res.total;
      let done = res.cached;
      if (!total) this.status({ state: "off" });
      else if (!res.targets.length) this.status({ state: "ready", done, total });
      else this.status({ state: "waiting", done, total });
      if (!todo.length) {
        await this.nap(this.deps.pollMs);
        continue;
      }
      if (!(await this.deps.canEncode(todo[0]!).catch(() => false))) {
        this.deps.onLog?.("browser_clips_unsupported");
        this.status({ state: "off" });
        return;
      }
      for (const target of todo) {
        if (this.stopped) return;
        await this.waitIdle();
        if (this.stopped) return;
        this.attempted.add(attemptKey(target));
        this.status({ state: "preparing", done, total, scene: target.index });
        const outcome = await this.runOne(target);
        if (outcome === "stored" || outcome === "duplicate") done++;
        if (outcome === "limited") break;
        if (outcome === "stale") break; // the film changed: list the targets again
      }
      if (this.stopped) return;
      // Short pause, then re-list: the next pass reports "ready" or picks up anything a fix changed meanwhile.
      await this.nap(2_000);
    }
  }

  private async runOne(target: ClipTarget): Promise<UploadOutcome | "failed"> {
    const controller = new AbortController();
    this.controller = controller;
    const t0 = this.deps.now();
    try {
      const html = await this.deps.loadBundle(target);
      const gate = async () => {
        if (this.deps.isBusy()) {
          this.deps.onLog?.("browser_clips_paused", { scene: target.index });
          await this.waitIdle();
        }
      };
      const bytes = await this.deps.encode(target, html, { gate, signal: controller.signal });
      if (this.stopped) return "failed";
      const outcome = await this.deps.upload(target, bytes);
      this.deps.onLog?.("browser_clip_" + outcome, { scene: target.index, bytes: bytes.length, ms: this.deps.now() - t0 });
      return outcome;
    } catch (e) {
      this.deps.onLog?.("browser_clip_failed", { scene: target.index, message: String((e as Error)?.message ?? e) });
      return "failed";
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}

// ---------------------------------------------------------------- HTTP

const enc = encodeURIComponent;

export function clipTargetsUrl(baseUrl: string, projectId: string, aspect: string) {
  return `${baseUrl}/projects/${enc(projectId)}/plates/clip-targets?aspect=${enc(aspect)}`;
}
export function clipUploadUrl(baseUrl: string, projectId: string, aspect: string, bundleDigest: string, assetsDigest?: string) {
  return `${baseUrl}/projects/${enc(projectId)}/plates/clips?aspect=${enc(aspect)}&bundleDigest=${enc(bundleDigest)}${assetsDigest ? `&assetsDigest=${enc(assetsDigest)}` : ""}`;
}

export function uploadOutcomeFor(status: number, body: { duplicate?: boolean; error?: { code?: string } } | null): UploadOutcome {
  if (status === 201) return "stored";
  if (status === 200) return body?.duplicate ? "duplicate" : "stored";
  if (status === 429) return "limited";
  if (status === 409 && (body?.error?.code === "stale_scene" || body?.error?.code === "not_drawn")) return "stale";
  if (status === 409 || status === 415 || status === 422 || status === 400) return "rejected";
  return "error";
}

/** Wires the scheduler to the backend (`baseUrl` like "/api/backend", `fetchImpl` carrying the user's token). */
export function createBrowserClipScheduler(options: {
  projectId: string;
  aspect: string;
  baseUrl: string;
  fetch: typeof fetch;
  isBusy: () => boolean;
  onStatus?: (status: BrowserClipStatus) => void;
  onLog?: (event: string, detail?: Record<string, unknown>) => void;
}): BrowserClipScheduler {
  const { projectId, aspect, baseUrl } = options;
  const f = options.fetch;
  return new BrowserClipScheduler({
    isBusy: options.isBusy,
    onStatus: options.onStatus,
    onLog: options.onLog,
    fetchTargets: async () => {
      const res = await f(clipTargetsUrl(baseUrl, projectId, aspect), { cache: "no-store" });
      if (!res.ok) throw new Error(`clip-targets ${res.status}`);
      return (await res.json()) as ClipTargetsResponse;
    },
    loadBundle: async (target) => {
      const res = await f(target.bundleUrl.startsWith("/v1/") ? `${baseUrl}${target.bundleUrl.slice(3)}` : target.bundleUrl);
      if (!res.ok) throw new Error(`bundle ${res.status}`);
      const html = await res.text();
      if (!(await verifyBundleHtmlSha(html, target.bundleSha))) throw new Error("The bundle does not match its digest.");
      // template pictures: the full-size files (never the preview copies), inlined the way the live preview does
      return target.assets ? await inlineBundleAssets(html, target.assets, f, baseUrl) : html;
    },
    canEncode: async (target) => browserClipsSupported() && Boolean(await pickEncoderConfig(target.width, target.height, target.fps)),
    encode: async (target, html, ctx) =>
      (await encodeSceneClip({ html, params: target.params, frames: target.bundleFrames, width: target.width, height: target.height, fps: target.fps, gate: ctx.gate, signal: ctx.signal })).bytes,
    upload: async (target, bytes) => {
      try {
        const res = await f(clipUploadUrl(baseUrl, projectId, aspect, target.bundleDigest, target.assetsDigest), {
          method: "PUT",
          headers: { "Content-Type": "video/mp4" },
          body: bytes as unknown as BodyInit
        });
        const body = await res.json().catch(() => null);
        return uploadOutcomeFor(res.status, body);
      } catch {
        return "error";
      }
    }
  });
}

/** Short label for the Render button: nothing while there is nothing to say. */
export function browserClipNote(status: BrowserClipStatus | null | undefined): string | undefined {
  if (!status || status.state === "off") return undefined;
  if (status.state === "ready") return "Export ready";
  if (status.state === "preparing") return `Preparing export… ${status.done}/${status.total} scenes`;
  return status.done > 0 ? `Preparing export… ${status.done}/${status.total} scenes` : undefined;
}
