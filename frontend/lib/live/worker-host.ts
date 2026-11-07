import { resolveCacheBudgetBytes, supportsWorkerHost } from "./support.ts";

export { supportsWorkerHost };

/**
 * Contained Worker + OffscreenCanvas host for live plate scenes (docs/LIVE_SCENES_PLAN.md §0b, §10).
 *
 * Architecture:
 * - A trusted bootstrap `<iframe sandbox="allow-scripts" style="display:none">` (NO `allow-same-origin`, giving an opaque origin)
 *   carries only host-written bootstrap code and a strict CSP meta tag:
 *   `default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src data: blob:`.
 * - The iframe creates a dedicated `Worker` from a `Blob` URL and transfers a `MessageChannel` port back to the page.
 *   Because the Worker is created inside the CSP-restricted opaque-origin iframe, it inherits `connect-src 'none'`,
 *   blocking `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, dynamic `import()`, nested Workers, IndexedDB and
 *   Cache Storage at the browser boundary (not by deleting globals).
 * - Model-authored scene code runs ONLY inside the Worker on an `OffscreenCanvas`. Frames travel directly from Worker
 *   to page over the `MessagePort` as transferred `ImageBitmap`s.
 * - Memory note (measured in Phase 0, §0b & §10): a Worker's internal JS heap cannot be read synchronously from the host.
 *   Therefore the host tracks the exact byte count (`width * height * 4`) of all `ImageBitmap`s it holds and recycles
 *   (terminates and recreates) the Worker at every scene boundary and after a fixed 60 s Worker lifetime counted over
 *   all alive time (playing, buffering, scrubbing). Recycling reduces how long leaked scene allocations are retained;
 *   it does NOT bound a scene's peak memory within a single lifetime window.
 */

export const BOOTSTRAP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src data: blob:";

export const DEFAULT_WATCHDOG_MS = 2_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 500;
export const DEFAULT_WORKER_LIFETIME_MS = 60_000;
export const MAX_WATCHDOG_TERMINATIONS = 2;

export interface ImageBitmapLike {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface HostMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer?: unknown[]): void;
  close?: () => void;
}

export interface WorkerTransport {
  port: HostMessagePort;
  terminate(): void;
}

export type WorkerTransportFactory = (
  workerSource: string,
  onRegisterAbort?: (abort: () => void) => void
) => Promise<WorkerTransport>;

export interface HostClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const defaultClock: HostClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
};

/** Deterministic, key-sorted JSON serialisation so `self.__PARAMS__` is canonical across preview and export. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

/** Extracts inline `<script>` blocks from a scene bundle HTML document and wires `__preloadAssets()` before the scene entry. */
export function extractBundleScripts(html: string): string {
  const list = [...String(html ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
  if (list.length > 1) {
    return `${list[0]}\n;self.__SCRIPTS_READY__ = (async () => {\nawait __preloadAssets();\n${list.slice(1).join("\n;\n")}\n})();\n`;
  }
  return `self.__SCRIPTS_READY__ = (async () => {\nawait __preloadAssets();\n${list.join("\n;\n")}\n})();\n`;
}

const WORKER_PRELUDE = `"use strict";
const __canvas = new OffscreenCanvas(1, 1);
self.window = self;
self.document = {
  getElementById: (id) => (id === "film" ? __canvas : new OffscreenCanvas(1, 1)),
  createElement: () => new OffscreenCanvas(1, 1),
  fonts: self.fonts
};
const __assetBitmaps = new Map();
self.Image = class {
  constructor() { this._src = ""; this._bm = null; this.width = 0; this.height = 0; }
  get src() { return this._src; }
  set src(v) {
    this._src = String(v ?? "");
    this._bm = __assetBitmaps.get(this._src) || null;
    if (this._bm) { this.width = this._bm.width; this.height = this._bm.height; }
  }
  async decode() {
    if (!this._bm) {
      if (!this._src.startsWith("data:")) throw new Error("image assets in worker host must be preloaded or data: URLs");
      const [head, body = ""] = this._src.slice(5).split(",");
      const mime = head.split(";")[0] || "image/png";
      const bin = head.includes(";base64") ? atob(body) : decodeURIComponent(body);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      this._bm = await createImageBitmap(new Blob([u8], { type: mime }));
      __assetBitmaps.set(this._src, this._bm);
    }
    this.width = this._bm.width;
    this.height = this._bm.height;
  }
};
for (const __P of [
  typeof OffscreenCanvasRenderingContext2D !== "undefined" && OffscreenCanvasRenderingContext2D.prototype,
  typeof CanvasRenderingContext2D !== "undefined" && CanvasRenderingContext2D.prototype
]) {
  if (__P && !__P.__imgPatched) {
    const __origDraw = __P.drawImage;
    __P.drawImage = function(img, ...rest) {
      return __origDraw.call(this, img && img._bm ? img._bm : img, ...rest);
    };
    __P.__imgPatched = true;
  }
}
const __preloadAssets = async () => {
  const map = self.__ASSETS__ || {};
  for (const url of Object.values(map)) {
    if (typeof url === "string" && url.startsWith("data:") && !__assetBitmaps.has(url)) {
      const [head, body = ""] = url.slice(5).split(",");
      const mime = head.split(";")[0] || "image/png";
      const bin = head.includes(";base64") ? atob(body) : decodeURIComponent(body);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      __assetBitmaps.set(url, await createImageBitmap(new Blob([u8], { type: mime })));
    }
  }
};
`;

const WORKER_HANDLER = `
let __port = null;
const __post = (m, transfer) => __port && __port.postMessage(m, transfer || []);
self.addEventListener("message", (e) => {
  if (e.data && e.data.t === "port" && e.data.port) {
    __port = e.data.port;
    __port.onmessage = __handleMessage;
    __post({ t: "up" });
  }
});
self.addEventListener("error", (e) => __post({ t: "error", message: String(e.message || e) }));
self.addEventListener("unhandledrejection", (e) => __post({ t: "error", message: String(e.reason && e.reason.message || e.reason) }));

function __frameHash() {
  if (self.FILM && typeof self.FILM.hash === "function") return String(self.FILM.hash());
  const ctx = __canvas.getContext("2d");
  const d = ctx.getImageData(0, 0, __canvas.width, __canvas.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

async function __handleMessage(e) {
  const m = e.data;
  if (!m || typeof m !== "object") return;
  try {
    if (m.t === "hb") {
      __post({ t: "hb", id: m.id });
      return;
    }
    if (m.t === "dispose") {
      for (const bm of __assetBitmaps.values()) { try { bm.close(); } catch {} }
      __assetBitmaps.clear();
      __post({ t: "dispose", id: m.id, ok: true });
      try { self.close(); } catch {}
      return;
    }
    if (m.t === "init") {
      if (m.params !== undefined) {
        self.__PARAMS__ = typeof m.params === "string" ? JSON.parse(m.params) : m.params;
      }
      if (self.__SCRIPTS_READY__) await self.__SCRIPTS_READY__;
      if (!self.FILM) throw new Error("Scene bundle did not register window.FILM");
      await self.FILM.ready;
      const scale = typeof m.scale === "number" && m.scale > 0 ? m.scale : 1;
      self.FILM.mount(scale);
      __canvas.getContext("2d");
      const rawCaps = self.FILM.capabilities && typeof self.FILM.capabilities === "object" ? self.FILM.capabilities : null;
      const seekArity = typeof self.FILM.seek === "function" ? self.FILM.seek.length : 1;
      const capabilities = rawCaps || {
        draftSupported: seekArity >= 2,
        seekAcceptsQuality: seekArity >= 2,
        profileVersion: "legacy"
      };
      __post({
        t: "init",
        id: m.id,
        w: __canvas.width,
        h: __canvas.height,
        meta: self.FILM.meta,
        capabilities,
        paramsEcho: JSON.stringify(self.__PARAMS__ ?? {})
      });
      return;
    }
    if (m.t === "frame") {
      const t0 = performance.now();
      const repeat = typeof m.repeat === "number" && m.repeat > 1 ? Math.floor(m.repeat) : 1;
      const qSpec = m.qualitySpec !== undefined ? m.qualitySpec : "full";
      for (let i = 0; i < repeat; i++) self.FILM.seek(m.n, qSpec);
      const drawMs = (performance.now() - t0) / repeat;
      const hash = m.includeHash ? __frameHash() : undefined;
      const frameStats = typeof self.FILM.getLastFrameStats === "function" ? self.FILM.getLastFrameStats() : undefined;
      const calibration = m.includeCalibration && typeof self.FILM.getCalibration === "function" ? self.FILM.getCalibration() : undefined;
      const bitmap = await createImageBitmap(__canvas);
      __post(
        {
          t: "frame",
          id: m.id,
          n: m.n,
          bitmap,
          drawMs,
          ...(m.epoch !== undefined ? { epoch: m.epoch } : {}),
          ...(frameStats !== undefined ? { frameStats } : {}),
          ...(calibration !== undefined ? { calibration } : {}),
          ...(hash !== undefined ? { hash } : {})
        },
        [bitmap]
      );
      return;
    }
    __post({ t: "fail", id: m.id, message: "Unknown command: " + String(m.t) });
  } catch (err) {
    __post({ t: "fail", id: m.id, message: String(err && err.message || err) });
  }
}
`;

/** Builds the complete self-contained Worker source string from a bundle HTML document and canonical scene params. */
export function buildWorkerSource(html: string, params: Record<string, unknown> = {}): string {
  const canonicalParams = canonicalJson(params ?? {});
  return `${WORKER_PRELUDE}\nself.__PARAMS__ = ${canonicalParams};\n${extractBundleScripts(html)}\n;\n${WORKER_HANDLER}`;
}

/** Builds the sandboxed bootstrap iframe `srcdoc` (contains ONLY host-written code and the CSP meta tag). */
export function buildBootstrapSrcdoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BOOTSTRAP_CSP}"></head><body><script>
"use strict";
let w = null;
onmessage = (e) => {
  const d = e.data;
  if (!d || typeof d !== "object") return;
  if (d.t === "make") {
    try { if (w) w.terminate(); } catch {}
    const u = URL.createObjectURL(new Blob([d.src], { type: "text/javascript" }));
    w = new Worker(u);
    URL.revokeObjectURL(u);
    const ch = new MessageChannel();
    w.postMessage({ t: "port", port: ch.port2 }, [ch.port2]);
    parent.postMessage({ t: "port", nonce: d.nonce, port: ch.port1 }, "*", [ch.port1]);
  } else if (d.t === "terminate") {
    try { if (w) w.terminate(); } catch {}
    w = null;
  }
};
parent.postMessage({ t: "iframe-up" }, "*");
</script></body></html>`;
}

let activeBrowserTransports = 0;

/** Returns the count of currently live sandboxed Worker transports in the browser. */
export function getActiveBrowserTransportCount(): number {
  return activeBrowserTransports;
}

/** Default browser transport: creates the hidden sandboxed bootstrap iframe, spawns the blob Worker inside it, and returns the direct MessagePort. */
export const createBrowserTransport: WorkerTransportFactory = async (
  workerSource: string,
  onRegisterAbort?: (abort: () => void) => void
): Promise<WorkerTransport> => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new Error("Sandboxed iframe Worker transport requires a browser document.");
  }
  const iframe = document.createElement("iframe");
  // Containment (§10): allow-scripts ONLY; NEVER allow-same-origin.
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  let terminated = false;
  let resolvedPort: HostMessagePort | null = null;
  let rejectPortPromise: ((err: Error) => void) | null = null;

  const terminateNow = () => {
    if (terminated) return;
    terminated = true;
    activeBrowserTransports = Math.max(0, activeBrowserTransports - 1);
    try {
      iframe.contentWindow?.postMessage({ t: "terminate" }, "*");
    } catch {}
    try {
      if (resolvedPort) {
        resolvedPort.onmessage = null;
        resolvedPort.close?.();
      }
    } catch {}
    try {
      iframe.remove();
    } catch {}
    rejectPortPromise?.(new Error("Worker transport terminated before bootstrap completed."));
  };

  const portPromise = new Promise<HostMessagePort>((resolve, reject) => {
    rejectPortPromise = reject;
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      terminateNow();
      reject(new Error("Timed out waiting for bootstrap iframe Worker port."));
    }, 5_000);

    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data as { t?: string; nonce?: string; port?: HostMessagePort } | null;
      if (!data || typeof data !== "object") return;
      if (data.t === "iframe-up") {
        iframe.contentWindow?.postMessage({ t: "make", nonce, src: workerSource }, "*");
      } else if (data.t === "port" && data.nonce === nonce && data.port) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        rejectPortPromise = null;
        resolve(data.port);
      }
    };
    window.addEventListener("message", onMessage);
  });

  iframe.srcdoc = buildBootstrapSrcdoc();
  document.body.appendChild(iframe);
  activeBrowserTransports++;
  onRegisterAbort?.(terminateNow);

  const port = await portPromise;
  resolvedPort = port;
  if (terminated) {
    try {
      port.onmessage = null;
      port.close?.();
    } catch {}
    throw new Error("Worker transport was terminated.");
  }
  return {
    port,
    terminate: terminateNow
  };
};

export type HostFilmMeta = {
  title?: string;
  W?: number;
  H?: number;
  width?: number;
  height?: number;
  fps: number;
  durationFrames?: number;
  frames?: number;
  shots?: { id: string; start: number; end: number }[];
};

export type HostCapabilities = {
  draftSupported: boolean;
  seekAcceptsQuality: boolean;
  profileVersion?: string;
  defaultDraftTargetVerticesPerFrame?: number;
};

export type HostInitResult = {
  w: number;
  h: number;
  meta: HostFilmMeta;
  capabilities?: HostCapabilities;
  paramsEcho?: string;
};

export type HostFrameResult = {
  n: number;
  bitmap: ImageBitmapLike;
  drawMs: number;
  bytes: number;
  epoch?: number;
  qualityMode?: "draft" | "full";
  frameStats?: Record<string, unknown>;
  calibration?: Record<string, unknown> | null;
  hash?: string;
};

export type WorkerHostOptions = {
  html: string;
  params?: Record<string, unknown>;
  budgetBytes?: number;
  watchdogMs?: number;
  heartbeatIntervalMs?: number;
  lifetimeMs?: number;
  transportFactory?: WorkerTransportFactory;
  clock?: HostClock;
  onUnhealthy?: (reason: string) => void;
  onError?: (message: string) => void;
  onRecycle?: (reason: "scene-boundary" | "lifetime" | "watchdog", count: number) => void;
};

type PendingCall = {
  t: string;
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: unknown;
};

type HeldBitmapRecord = {
  frame: number;
  bitmap: ImageBitmapLike;
  bytes: number;
  closed: boolean;
};

export class WorkerHost {
  private readonly html: string;
  private params: Record<string, unknown>;
  private readonly budgetBytes: number;
  private readonly watchdogMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly lifetimeMs: number;
  private readonly transportFactory: WorkerTransportFactory;
  private readonly clock: HostClock;
  private readonly onUnhealthyCb?: (reason: string) => void;
  private readonly onErrorCb?: (message: string) => void;
  private readonly onRecycleCb?: (reason: "scene-boundary" | "lifetime" | "watchdog", count: number) => void;

  private transport: WorkerTransport | null = null;
  private spawning: Promise<WorkerTransport> | null = null;
  private pendingSpawnAbort: (() => void) | null = null;
  private seq = 0;
  private waiting = new Map<number, PendingCall>();
  private spawnedAt = 0;
  private lifetimeTimer: unknown = null;
  private heartbeatIntervalTimer: unknown = null;
  private heartbeatInFlight = false;
  private lastInitSpec: { scale: number; params: Record<string, unknown> } | null = null;
  private initResult: HostInitResult | null = null;
  private recreating: Promise<void> | null = null;

  private heldBitmaps = new Map<number, HeldBitmapRecord>();
  private heldBytes = 0;
  private createdBitmapsCount = 0;
  private closedBitmapsCount = 0;

  private watchdogTrips = 0;
  private recycleCount = 0;
  private isUnhealthy = false;
  private isDestroyed = false;
  private unhealthyListeners = new Set<(reason: string) => void>();
  private workerErrors: string[] = [];

  constructor(options: WorkerHostOptions) {
    this.html = options.html;
    this.params = options.params ? { ...options.params } : {};
    this.budgetBytes = options.budgetBytes ?? resolveCacheBudgetBytes();
    if (!(this.budgetBytes > 0)) {
      throw new Error("WorkerHost budgetBytes must be positive.");
    }
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.lifetimeMs = options.lifetimeMs ?? DEFAULT_WORKER_LIFETIME_MS;
    this.transportFactory = options.transportFactory ?? createBrowserTransport;
    this.clock = options.clock ?? defaultClock;
    this.onUnhealthyCb = options.onUnhealthy;
    this.onErrorCb = options.onError;
    this.onRecycleCb = options.onRecycle;
  }

  get bytes(): number {
    return this.heldBytes;
  }

  get budget(): number {
    return this.budgetBytes;
  }

  get capabilities(): HostCapabilities | undefined {
    return this.initResult?.capabilities;
  }

  get supportsDraftQuality(): boolean {
    if (!this.initResult?.capabilities) return true;
    return Boolean(this.initResult.capabilities.draftSupported && this.initResult.capabilities.seekAcceptsQuality);
  }

  get hasActiveTransport(): boolean {
    return this.transport !== null || this.spawning !== null;
  }

  getBitmapCounters(): { created: number; closed: number; held: number; heldBytes: number } {
    return {
      created: this.createdBitmapsCount,
      closed: this.closedBitmapsCount,
      held: this.heldBitmaps.size,
      heldBytes: this.heldBytes
    };
  }

  get unhealthy(): boolean {
    return this.isUnhealthy;
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  get terminations(): number {
    return this.watchdogTrips;
  }

  get recycles(): number {
    return this.recycleCount;
  }

  get errors(): readonly string[] {
    return this.workerErrors;
  }

  get aliveMs(): number {
    if (!this.transport || this.isDestroyed) return 0;
    return Math.max(0, this.clock.now() - this.spawnedAt);
  }

  onUnhealthy(cb: (reason: string) => void): () => void {
    this.unhealthyListeners.add(cb);
    return () => {
      this.unhealthyListeners.delete(cb);
    };
  }

  private async ensureTransport(): Promise<WorkerTransport> {
    if (this.isDestroyed) throw new Error("WorkerHost has been destroyed.");
    if (this.isUnhealthy) throw new Error("WorkerHost is unhealthy after repeated watchdog terminations.");
    if (this.recreating) await this.recreating;
    if (this.isUnhealthy) throw new Error("WorkerHost is unhealthy after repeated watchdog terminations.");

    // Check 60 s fixed Worker lifetime before issuing new work (counts all alive time: playing, buffering, scrubbing).
    if (this.transport && this.clock.now() - this.spawnedAt >= this.lifetimeMs && this.waiting.size === 0) {
      await this.recycle("lifetime");
    }

    if (this.transport) return this.transport;
    if (this.spawning) return this.spawning;

    const src = buildWorkerSource(this.html, this.params);
    this.spawning = (async () => {
      const t = await this.transportFactory(src, (abort) => {
        this.pendingSpawnAbort = abort;
      });
      this.pendingSpawnAbort = null;
      if (this.isDestroyed) {
        t.terminate();
        throw new Error("WorkerHost has been destroyed.");
      }
      this.transport = t;
      this.spawnedAt = this.clock.now();
      t.port.onmessage = (e) => this.handlePortMessage(t, e.data);
      this.startTimers(t);
      return t;
    })().finally(() => {
      this.spawning = null;
      this.pendingSpawnAbort = null;
    });

    return this.spawning;
  }

  private startTimers(t: WorkerTransport) {
    this.clearTimers();

    // Fixed 60 s Worker lifetime timer (counts all time the Worker is alive).
    this.lifetimeTimer = this.clock.setTimeout(() => {
      if (this.transport !== t || this.isDestroyed || this.isUnhealthy) return;
      if (this.waiting.size === 0) {
        void this.recycle("lifetime").catch(() => {});
      }
    }, this.lifetimeMs);

    // Periodic heartbeat probe.
    this.heartbeatIntervalTimer = this.clock.setInterval(() => {
      if (this.transport !== t || this.isDestroyed || this.isUnhealthy) return;
      // Also check lifetime on heartbeat ticks in case fake clocks advance via intervals.
      if (this.clock.now() - this.spawnedAt >= this.lifetimeMs && this.waiting.size === 0) {
        void this.recycle("lifetime").catch(() => {});
        return;
      }
      if (this.heartbeatInFlight || this.waiting.size > 0) return;
      this.heartbeatInFlight = true;
      void this.rawCall(t, { t: "hb" }, this.watchdogMs)
        .catch(() => {})
        .finally(() => {
          this.heartbeatInFlight = false;
        });
    }, this.heartbeatIntervalMs);
  }

  private clearTimers() {
    if (this.lifetimeTimer !== null) {
      this.clock.clearTimeout(this.lifetimeTimer);
      this.lifetimeTimer = null;
    }
    if (this.heartbeatIntervalTimer !== null) {
      this.clock.clearInterval(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = null;
    }
    this.heartbeatInFlight = false;
  }

  private handlePortMessage(fromTransport: WorkerTransport, raw: unknown) {
    const msg = raw as Record<string, unknown> | null;
    const maybeBitmap = msg && typeof msg === "object" ? (msg.bitmap as ImageBitmapLike | undefined) : undefined;
    if (this.transport !== fromTransport || this.isDestroyed) {
      try {
        maybeBitmap?.close?.();
      } catch {}
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.t === "error") {
      const errText = String(msg.message ?? "Worker error");
      this.workerErrors.push(errText);
      this.onErrorCb?.(errText);
      return;
    }

    const id = typeof msg.id === "number" ? msg.id : null;
    if (id !== null && this.waiting.has(id)) {
      const pending = this.waiting.get(id)!;
      this.waiting.delete(id);
      this.clock.clearTimeout(pending.timer);
      if (msg.t === "fail") {
        try {
          maybeBitmap?.close?.();
        } catch {}
        const errText = String(msg.message ?? "Worker operation failed");
        this.workerErrors.push(errText);
        pending.reject(new Error(errText));
      } else {
        pending.resolve(msg);
      }
    } else if (maybeBitmap) {
      try {
        maybeBitmap.close();
      } catch {}
    }
  }

  private rawCall(
    t: WorkerTransport,
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (this.isDestroyed) {
        reject(new Error("WorkerHost has been destroyed."));
        return;
      }
      if (this.isUnhealthy) {
        reject(new Error("WorkerHost is unhealthy."));
        return;
      }
      const id = ++this.seq;
      const timer = this.clock.setTimeout(() => {
        if (!this.waiting.has(id)) return;
        this.waiting.delete(id);
        const reason = payload.t === "hb" ? "heartbeat-timeout" : `${String(payload.t)}-timeout`;
        this.handleWatchdogTrip(t, reason);
        reject(new Error(`Watchdog timeout (${reason}) after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiting.set(id, { t: String(payload.t), resolve, reject, timer });
      try {
        t.port.postMessage({ ...payload, id });
      } catch (err) {
        this.waiting.delete(id);
        this.clock.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private terminateCurrentTransport(reason: string) {
    this.clearTimers();
    const currentAbort = this.pendingSpawnAbort;
    this.pendingSpawnAbort = null;
    if (currentAbort) {
      try {
        currentAbort();
      } catch {}
    }

    const current = this.transport;
    this.transport = null;
    for (const [id, pending] of this.waiting.entries()) {
      this.waiting.delete(id);
      this.clock.clearTimeout(pending.timer);
      pending.reject(new Error(`Worker terminated (${reason})`));
    }
    if (current) {
      try {
        current.terminate();
      } catch {}
    }
  }

  private handleWatchdogTrip(trippedTransport: WorkerTransport, reason: string) {
    if (this.transport !== trippedTransport || this.isDestroyed) return;
    this.watchdogTrips++;
    this.terminateCurrentTransport(reason);

    if (this.watchdogTrips >= MAX_WATCHDOG_TERMINATIONS) {
      this.isUnhealthy = true;
      this.onUnhealthyCb?.(reason);
      for (const listener of this.unhealthyListeners) {
        try {
          listener(reason);
        } catch {}
      }
      return;
    }

    // First termination: automatically recreate the Worker and re-mount it if `init` was already called.
    this.recycleCount++;
    this.onRecycleCb?.("watchdog", this.recycleCount);
    const spec = this.lastInitSpec;
    this.recreating = (async () => {
      try {
        const fresh = await this.ensureTransport();
        if (spec && !this.isDestroyed && !this.isUnhealthy) {
          await this.rawCall(fresh, { t: "init", scale: spec.scale, params: canonicalJson(spec.params) }, this.watchdogMs);
        }
      } catch {
        // Recreation failure will be caught on the next operation or watchdog trip.
      } finally {
        this.recreating = null;
      }
    })();
  }

  /**
   * Terminates and recreates the Worker (at a scene boundary or after the 60 s Worker lifetime).
   * Note: recycling reduces retention of leaked allocations inside the Worker; it does not bound peak scene memory.
   */
  async recycle(reason: "scene-boundary" | "lifetime" = "scene-boundary"): Promise<void> {
    if (this.isDestroyed || this.isUnhealthy) return;
    if (this.recreating) await this.recreating;
    this.terminateCurrentTransport(`recycle:${reason}`);
    this.recycleCount++;
    this.onRecycleCb?.(reason, this.recycleCount);
    const spec = this.lastInitSpec;
    this.recreating = (async () => {
      try {
        const fresh = await this.ensureTransport();
        if (spec && !this.isDestroyed && !this.isUnhealthy) {
          const res = await this.rawCall(
            fresh,
            { t: "init", scale: spec.scale, params: canonicalJson(spec.params) },
            this.watchdogMs
          );
          this.initResult = {
            w: Number(res.w ?? this.initResult?.w ?? 0),
            h: Number(res.h ?? this.initResult?.h ?? 0),
            meta: (res.meta as HostFilmMeta) ?? this.initResult?.meta ?? { fps: 30 },
            ...(res.capabilities && typeof res.capabilities === "object"
              ? { capabilities: res.capabilities as HostCapabilities }
              : this.initResult?.capabilities
                ? { capabilities: this.initResult.capabilities }
                : {}),
            ...(typeof res.paramsEcho === "string" ? { paramsEcho: res.paramsEcho } : {})
          };
        }
      } finally {
        this.recreating = null;
      }
    })();
    await this.recreating;
  }

  /** Initialises the scene in the Worker at the requested scale and canonical params. */
  async init(options?: { scale?: number; params?: Record<string, unknown> }): Promise<HostInitResult> {
    const scale = options?.scale ?? 1;
    if (options?.params) {
      this.params = { ...options.params };
    }
    this.lastInitSpec = { scale, params: { ...this.params } };
    const t = await this.ensureTransport();
    const res = await this.rawCall(
      t,
      { t: "init", scale, params: canonicalJson(this.params) },
      this.watchdogMs
    );
    const out: HostInitResult = {
      w: Number(res.w ?? 0),
      h: Number(res.h ?? 0),
      meta: (res.meta as HostFilmMeta) ?? { fps: 30 },
      ...(res.capabilities && typeof res.capabilities === "object"
        ? { capabilities: res.capabilities as HostCapabilities }
        : { capabilities: { draftSupported: true, seekAcceptsQuality: true } }),
      ...(typeof res.paramsEcho === "string" ? { paramsEcho: res.paramsEcho } : {})
    };
    this.initResult = out;
    return out;
  }

  /**
   * Terminates the underlying Worker and removes its sandboxed bootstrap iframe when the scene or film is idle
   * (e.g. at film end or scene deactivation), without permanently destroying the `WorkerHost` instance.
   * If a future `frame()` or `init()` call is made, `ensureTransport()` will transparently respawn and re-init.
   */
  terminateIdle(reason = "idle-cleanup"): void {
    if (this.isDestroyed) return;
    for (const rec of [...this.heldBitmaps.values()]) {
      rec.bitmap.close();
    }
    this.heldBitmaps.clear();
    this.heldBytes = 0;
    const current = this.transport;
    if (current) {
      try {
        current.port.postMessage({ t: "dispose", id: ++this.seq });
      } catch {}
    }
    this.terminateCurrentTransport(reason);
  }

  /** Sends an explicit heartbeat and resolves when the Worker answers within the watchdog window. */
  async heartbeat(): Promise<void> {
    const t = await this.ensureTransport();
    await this.rawCall(t, { t: "hb" }, this.watchdogMs);
  }

  private trackBitmap(
    n: number,
    rawBitmap: ImageBitmapLike,
    fallbackW: number,
    fallbackH: number,
    qualityMode: "draft" | "full" = "full"
  ): { bitmap: ImageBitmapLike; bytes: number } {
    const w = typeof rawBitmap?.width === "number" && rawBitmap.width > 0 ? rawBitmap.width : fallbackW;
    const h = typeof rawBitmap?.height === "number" && rawBitmap.height > 0 ? rawBitmap.height : fallbackH;
    const bytes = Math.max(4, w * h * 4);
    this.createdBitmapsCount++;

    const origClose = typeof rawBitmap?.close === "function" ? rawBitmap.close.bind(rawBitmap) : () => {};
    const record: HeldBitmapRecord = {
      frame: n,
      bitmap: rawBitmap,
      bytes,
      closed: false
    };

    const releaseRecord = () => {
      if (record.closed) return;
      record.closed = true;
      this.closedBitmapsCount++;
      const current = this.heldBitmaps.get(n);
      if (current === record) {
        this.heldBitmaps.delete(n);
      }
      this.heldBytes = Math.max(0, this.heldBytes - record.bytes);
      try {
        origClose();
      } catch {}
    };

    try {
      rawBitmap.close = releaseRecord;
      (rawBitmap as unknown as Record<string, unknown>).__renderQualityMode = qualityMode;
      (rawBitmap as unknown as Record<string, unknown>).__sceneFrame = n;
    } catch {
      // If `rawBitmap.close` is non-writable, wrap in a proxy object.
      const proxy: ImageBitmapLike & { __renderQualityMode?: string; __sceneFrame?: number } = {
        get width() {
          return w;
        },
        get height() {
          return h;
        },
        __renderQualityMode: qualityMode,
        __sceneFrame: n,
        close: releaseRecord
      };
      record.bitmap = proxy;
    }

    // Refuse to hold a single frame larger than the total host budget.
    if (bytes > this.budgetBytes) {
      try {
        origClose();
      } catch {}
      record.closed = true;
      throw new Error(`Frame ${n} (${bytes} bytes) exceeds host byte budget (${this.budgetBytes} bytes).`);
    }

    // Replace existing bitmap for the same frame index if present.
    const existing = this.heldBitmaps.get(n);
    if (existing) {
      existing.bitmap.close();
    }

    // Evict oldest held bitmaps until adding this frame stays within the host byte budget.
    while (this.heldBytes + bytes > this.budgetBytes && this.heldBitmaps.size > 0) {
      const oldestKey = this.heldBitmaps.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.heldBitmaps.get(oldestKey);
      if (!oldest) break;
      oldest.bitmap.close();
    }

    this.heldBitmaps.set(n, record);
    this.heldBytes += bytes;
    return { bitmap: record.bitmap, bytes };
  }

  /** Evicts and closes the bitmap for frame `n` if currently tracked by the host. */
  evictFrame(n: number): void {
    const rec = this.heldBitmaps.get(n);
    if (rec) {
      rec.bitmap.close();
    }
  }

  /** Draws frame `n` in the Worker (subject to the 2 s draw watchdog and 60 s Worker lifetime) and returns the tracked `ImageBitmap`. */
  async frame(
    n: number,
    options?: {
      includeHash?: boolean;
      includeCalibration?: boolean;
      repeat?: number;
      qualitySpec?: Record<string, unknown> | string;
      epoch?: number;
    }
  ): Promise<HostFrameResult> {
    const hadTransport = this.transport !== null;
    const t = await this.ensureTransport();
    if (!hadTransport && this.lastInitSpec && !this.isDestroyed && !this.isUnhealthy) {
      const initRes = await this.rawCall(
        t,
        { t: "init", scale: this.lastInitSpec.scale, params: canonicalJson(this.lastInitSpec.params) },
        this.watchdogMs
      );
      this.initResult = {
        w: Number(initRes.w ?? this.initResult?.w ?? 0),
        h: Number(initRes.h ?? this.initResult?.h ?? 0),
        meta: (initRes.meta as HostFilmMeta) ?? this.initResult?.meta ?? { fps: 30 },
        ...(initRes.capabilities && typeof initRes.capabilities === "object"
          ? { capabilities: initRes.capabilities as HostCapabilities }
          : this.initResult?.capabilities
            ? { capabilities: this.initResult.capabilities }
            : {}),
        ...(typeof initRes.paramsEcho === "string" ? { paramsEcho: initRes.paramsEcho } : {})
      };
    }

    const qSpec = options?.qualitySpec;
    const resolvedQualityMode: "draft" | "full" =
      qSpec === "draft" || (typeof qSpec === "object" && qSpec !== null && qSpec.mode === "draft")
        ? "draft"
        : "full";

    const res = await this.rawCall(
      t,
      {
        t: "frame",
        n,
        ...(qSpec !== undefined ? { qualitySpec: qSpec } : {}),
        ...(options?.epoch !== undefined ? { epoch: options.epoch } : {}),
        ...(options?.includeHash ? { includeHash: true } : {}),
        ...(options?.includeCalibration ? { includeCalibration: true } : {}),
        ...(options?.repeat && options.repeat > 1 ? { repeat: options.repeat } : {})
      },
      this.watchdogMs
    );

    const rawBitmap = res.bitmap as ImageBitmapLike;
    const fallbackW = this.initResult?.w || 854;
    const fallbackH = this.initResult?.h || 480;
    const { bitmap, bytes } = this.trackBitmap(n, rawBitmap, fallbackW, fallbackH, resolvedQualityMode);

    // Check if the 60 s lifetime expired during this draw so the Worker recycles right after the frame completes.
    if (this.transport === t && this.clock.now() - this.spawnedAt >= this.lifetimeMs && this.waiting.size === 0) {
      await this.recycle("lifetime");
    }

    return {
      n: Number(res.n ?? n),
      bitmap,
      drawMs: Number(res.drawMs ?? 0),
      bytes,
      qualityMode: resolvedQualityMode,
      ...(typeof res.epoch === "number" ? { epoch: res.epoch } : {}),
      ...(res.frameStats && typeof res.frameStats === "object"
        ? { frameStats: res.frameStats as Record<string, unknown> }
        : {}),
      ...(res.calibration !== undefined
        ? { calibration: (res.calibration as Record<string, unknown> | null) ?? null }
        : {}),
      ...(typeof res.hash === "string" ? { hash: res.hash } : {})
    };
  }

  /** Sends `dispose`, closes every tracked bitmap, removes the bootstrap iframe, terminates the Worker, and clears all timers/listeners. */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.clearTimers();

    for (const rec of [...this.heldBitmaps.values()]) {
      rec.bitmap.close();
    }
    this.heldBitmaps.clear();
    this.heldBytes = 0;

    const currentAbort = this.pendingSpawnAbort;
    this.pendingSpawnAbort = null;
    if (currentAbort) {
      try {
        currentAbort();
      } catch {}
    }

    const current = this.transport;
    this.transport = null;
    for (const [id, pending] of this.waiting.entries()) {
      this.waiting.delete(id);
      this.clock.clearTimeout(pending.timer);
      pending.reject(new Error("WorkerHost destroyed"));
    }

    if (current) {
      try {
        current.port.postMessage({ t: "dispose", id: ++this.seq });
      } catch {}
      try {
        current.terminate();
      } catch {}
    }

    this.unhealthyListeners.clear();
  }
}

export function createWorkerHost(options: WorkerHostOptions): WorkerHost {
  return new WorkerHost(options);
}
