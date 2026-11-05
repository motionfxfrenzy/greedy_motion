import type { ImageBitmapLike } from "./worker-host.ts";

/**
 * Draw-once browser frame store (`gm-live-frames`) and background `QualityJob` (phase 3g, plan changes D and E).
 *
 * Pure store and job logic are separated from IndexedDB and the browser WebP encoder Worker so they can be unit tested
 * deterministically with an in-memory fake backend and fake encoder, while running against real `IndexedDB` and an
 * `OffscreenCanvas.convertToBlob({ type: "image/webp", quality })` Worker in the browser.
 */

export const FRAME_STORE_DB_NAME = "gm-live-frames";
export const FRAME_STORE_DB_VERSION = 1;
export const FRAME_STORE_FRAMES_OBJECT_STORE = "frames";
export const FRAME_STORE_SCENES_OBJECT_STORE = "scenes";

/** 500 MB per-site cap for stored preview frames. */
export const FRAME_STORE_MAX_BYTES = 500 * 1024 * 1024;

/** Maximum concurrent frames in the encoder queue; when full, the drawing side waits rather than queueing more bitmaps. */
export const MAX_ENCODER_QUEUE = 8;

export const PREVIEW_QUALITY_LOW = 0.2;
export const PREVIEW_QUALITY_STANDARD = 0.4;
export const PREVIEW_QUALITY_HIGH = 0.6;
export const DEFAULT_PREVIEW_QUALITY = PREVIEW_QUALITY_STANDARD;
export const PREVIEW_QUALITY_STORAGE_KEY = "gm-plate-preview-quality";

export type PreviewQuality = 0.2 | 0.4 | 0.6;

export const PREVIEW_QUALITY_OPTIONS: readonly { label: "Low" | "Standard" | "High"; value: PreviewQuality; description: string }[] = [
  { label: "Low", value: 0.2, description: "Smaller storage footprint (0.2)" },
  { label: "Standard", value: 0.4, description: "Balanced quality and size (0.4)" },
  { label: "High", value: 0.6, description: "Sharper stored preview frames (0.6)" }
];

export function normalizePreviewQuality(value: unknown): PreviewQuality {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  if (Math.abs(n - 0.2) < 0.05) return 0.2;
  if (Math.abs(n - 0.6) < 0.05) return 0.6;
  return 0.4;
}

export function previewQualityLabel(quality: number): "Low" | "Standard" | "High" {
  const q = normalizePreviewQuality(quality);
  if (q === 0.2) return "Low";
  if (q === 0.6) return "High";
  return "Standard";
}

export function readStoredPreviewQuality(
  storage?: { getItem(key: string): string | null } | null
): PreviewQuality {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== "undefined" && typeof window.localStorage !== "undefined"
          ? window.localStorage
          : null;
    if (!target) return DEFAULT_PREVIEW_QUALITY;
    const raw = target.getItem(PREVIEW_QUALITY_STORAGE_KEY);
    if (raw === null || raw === "") return DEFAULT_PREVIEW_QUALITY;
    return normalizePreviewQuality(raw);
  } catch {
    return DEFAULT_PREVIEW_QUALITY;
  }
}

export function writeStoredPreviewQuality(
  quality: number,
  storage?: { setItem(key: string, value: string): void } | null
): PreviewQuality {
  const normalized = normalizePreviewQuality(quality);
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== "undefined" && typeof window.localStorage !== "undefined"
          ? window.localStorage
          : null;
    target?.setItem(PREVIEW_QUALITY_STORAGE_KEY, String(normalized));
  } catch {
    // ignore storage errors
  }
  return normalized;
}

/** Canonical key for the `scenes` object store: `${bundleDigest}|${w}x${h}`. */
export function storeSceneKey(bundleDigest: string, sizeLabel: string): string {
  return `${bundleDigest}|${sizeLabel}`;
}

/** Canonical key for the `frames` object store: `${bundleDigest}|${w}x${h}|${frame}`. */
export function storeFrameKey(bundleDigest: string, sizeLabel: string, frame: number): string {
  return `${bundleDigest}|${sizeLabel}|${Math.max(0, Math.floor(frame))}`;
}

export function parseStoreSceneKey(key: string): { bundleDigest: string; size: string } | null {
  const parts = String(key ?? "").split("|");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { bundleDigest: parts[0], size: parts[1] };
}

export function parseStoreFrameKey(key: string): { bundleDigest: string; size: string; frame: number } | null {
  const parts = String(key ?? "").split("|");
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  const frame = Number(parts[2]);
  if (!Number.isInteger(frame) || frame < 0) return null;
  return { bundleDigest: parts[0], size: parts[1], frame };
}

export type StoredFrameRecord = {
  blob: Blob;
  quality: number;
  savedAt: number;
};

export type StoredSceneRecord = {
  frames: number;
  saved: number;
  complete: boolean;
  quality: number | "mixed";
  bytes: number;
  lastUsed: number;
  filmKey: string;
  variantKey?: string;
  frameQualities?: Record<number, number>;
  frameBytes?: Record<number, number>;
};

export interface FrameStoreBackend {
  getFrame(key: string): Promise<StoredFrameRecord | undefined>;
  putFrame(key: string, record: StoredFrameRecord): Promise<void>;
  deleteFrame(key: string): Promise<void>;
  getScene(key: string): Promise<StoredSceneRecord | undefined>;
  putScene(key: string, record: StoredSceneRecord): Promise<void>;
  deleteScene(key: string): Promise<void>;
  getAllScenes(): Promise<Map<string, StoredSceneRecord>>;
  getAllFramesForScene?(sceneKey: string): Promise<Map<number, StoredFrameRecord>>;
  clear?(): Promise<void>;
}

/**
 * Pure in-memory `FrameStoreBackend` for unit tests and environments without IndexedDB.
 */
export class InMemoryFrameStoreBackend implements FrameStoreBackend {
  readonly frames = new Map<string, StoredFrameRecord>();
  readonly scenes = new Map<string, StoredSceneRecord>();

  async getFrame(key: string): Promise<StoredFrameRecord | undefined> {
    const rec = this.frames.get(key);
    return rec ? { ...rec } : undefined;
  }

  async putFrame(key: string, record: StoredFrameRecord): Promise<void> {
    this.frames.set(key, { ...record });
  }

  async deleteFrame(key: string): Promise<void> {
    this.frames.delete(key);
  }

  async getScene(key: string): Promise<StoredSceneRecord | undefined> {
    const rec = this.scenes.get(key);
    return rec ? cloneSceneRecord(rec) : undefined;
  }

  async putScene(key: string, record: StoredSceneRecord): Promise<void> {
    this.scenes.set(key, cloneSceneRecord(record));
  }

  async deleteScene(key: string): Promise<void> {
    this.scenes.delete(key);
  }

  async getAllScenes(): Promise<Map<string, StoredSceneRecord>> {
    const out = new Map<string, StoredSceneRecord>();
    for (const [k, v] of this.scenes.entries()) {
      out.set(k, cloneSceneRecord(v));
    }
    return out;
  }

  async getAllFramesForScene(sceneKey: string): Promise<Map<number, StoredFrameRecord>> {
    const out = new Map<number, StoredFrameRecord>();
    const prefix = `${sceneKey}|`;
    for (const [k, v] of this.frames.entries()) {
      if (k.startsWith(prefix)) {
        const frame = Number(k.slice(prefix.length));
        if (Number.isInteger(frame) && frame >= 0) {
          out.set(frame, { ...v });
        }
      }
    }
    return out;
  }

  async clear(): Promise<void> {
    this.frames.clear();
    this.scenes.clear();
  }
}

function cloneSceneRecord(rec: StoredSceneRecord): StoredSceneRecord {
  return {
    frames: rec.frames,
    saved: rec.saved,
    complete: rec.complete,
    quality: rec.quality,
    bytes: rec.bytes,
    lastUsed: rec.lastUsed,
    filmKey: rec.filmKey,
    ...(rec.variantKey !== undefined ? { variantKey: rec.variantKey } : {}),
    ...(rec.frameQualities ? { frameQualities: { ...rec.frameQualities } } : {}),
    ...(rec.frameBytes ? { frameBytes: { ...rec.frameBytes } } : {})
  };
}

/**
 * Browser `IndexedDB` implementation of `FrameStoreBackend` (`gm-live-frames`).
 * Object store `frames` keyed `${bundleDigest}|${w}x${h}|${frame}` -> `{ blob, quality, savedAt }`.
 * Object store `scenes` keyed `${bundleDigest}|${w}x${h}` -> `{ frames, saved, complete, quality, bytes, lastUsed, filmKey }`.
 */
export class IndexedDbFrameStoreBackend implements FrameStoreBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(dbName = FRAME_STORE_DB_NAME) {
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment."));
        return;
      }
      const req = indexedDB.open(this.dbName, FRAME_STORE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FRAME_STORE_FRAMES_OBJECT_STORE)) {
          db.createObjectStore(FRAME_STORE_FRAMES_OBJECT_STORE);
        }
        if (!db.objectStoreNames.contains(FRAME_STORE_SCENES_OBJECT_STORE)) {
          db.createObjectStore(FRAME_STORE_SCENES_OBJECT_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB gm-live-frames."));
    });
    return this.dbPromise;
  }

  async getFrame(key: string): Promise<StoredFrameRecord | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE_FRAMES_OBJECT_STORE, "readonly");
      const store = tx.objectStore(FRAME_STORE_FRAMES_OBJECT_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as StoredFrameRecord | undefined) ?? undefined);
      req.onerror = () => reject(req.error ?? new Error(`Failed to get frame ${key}`));
    });
  }

  async putFrame(key: string, record: StoredFrameRecord): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE_FRAMES_OBJECT_STORE, "readwrite");
      const store = tx.objectStore(FRAME_STORE_FRAMES_OBJECT_STORE);
      store.put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to put frame ${key}`));
    });
  }

  async deleteFrame(key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE_FRAMES_OBJECT_STORE, "readwrite");
      const store = tx.objectStore(FRAME_STORE_FRAMES_OBJECT_STORE);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete frame ${key}`));
    });
  }

  async getScene(key: string): Promise<StoredSceneRecord | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE_SCENES_OBJECT_STORE, "readonly");
      const store = tx.objectStore(FRAME_STORE_SCENES_OBJECT_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as StoredSceneRecord | undefined) ?? undefined);
      req.onerror = () => reject(req.error ?? new Error(`Failed to get scene ${key}`));
    });
  }

  async putScene(key: string, record: StoredSceneRecord): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE_SCENES_OBJECT_STORE, "readwrite");
      const store = tx.objectStore(FRAME_STORE_SCENES_OBJECT_STORE);
      store.put(record, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to put scene ${key}`));
    });
  }

  async deleteScene(key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FRAME_STORE_SCENES_OBJECT_STORE, "readwrite");
      const store = tx.objectStore(FRAME_STORE_SCENES_OBJECT_STORE);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete scene ${key}`));
    });
  }

  async getAllScenes(): Promise<Map<string, StoredSceneRecord>> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const out = new Map<string, StoredSceneRecord>();
      const tx = db.transaction(FRAME_STORE_SCENES_OBJECT_STORE, "readonly");
      const store = tx.objectStore(FRAME_STORE_SCENES_OBJECT_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          out.set(String(cursor.key), cursor.value as StoredSceneRecord);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("Failed to read all scenes"));
    });
  }

  async getAllFramesForScene(sceneKey: string): Promise<Map<number, StoredFrameRecord>> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const out = new Map<number, StoredFrameRecord>();
      const prefix = `${sceneKey}|`;
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const tx = db.transaction(FRAME_STORE_FRAMES_OBJECT_STORE, "readonly");
      const store = tx.objectStore(FRAME_STORE_FRAMES_OBJECT_STORE);
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const key = String(cursor.key);
          const frame = Number(key.slice(prefix.length));
          if (Number.isInteger(frame) && frame >= 0) {
            out.set(frame, cursor.value as StoredFrameRecord);
          }
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error ?? new Error(`Failed to scan frames for ${sceneKey}`));
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([FRAME_STORE_FRAMES_OBJECT_STORE, FRAME_STORE_SCENES_OBJECT_STORE], "readwrite");
      tx.objectStore(FRAME_STORE_FRAMES_OBJECT_STORE).clear();
      tx.objectStore(FRAME_STORE_SCENES_OBJECT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to clear gm-live-frames"));
    });
  }
}

export interface FrameEncoder {
  encode(bitmap: ImageBitmapLike, quality: number): Promise<Blob>;
  decode(blob: Blob): Promise<ImageBitmapLike>;
  destroy?(): void;
}

const ENCODER_WORKER_SOURCE = `"use strict";
let canvas = null;
let ctx = null;
self.onmessage = async (e) => {
  const m = e.data || {};
  const id = m.id;
  try {
    const src = m.bitmap || null;
    if (!src) {
      throw new Error("Encoder Worker received no bitmap.");
    }
    const w = src.width || 640;
    const h = src.height || 360;
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h);
      ctx = canvas.getContext("2d");
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0);
    try { src.close(); } catch {}
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: m.quality });
    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    try { if (m.bitmap) m.bitmap.close(); } catch {}
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
`;

/**
 * Dedicated browser WebP encoder Worker with a bounded queue (`MAX_ENCODER_QUEUE`).
 * Copies the incoming `ImageBitmap` via `createImageBitmap(bitmap)` and transfers the copy to the Worker so the shown
 * frame is never delayed or closed. When `pending.size >= maxQueue`, waits before creating or transferring another copy.
 */
export class BrowserWebpEncoder implements FrameEncoder {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (blob: Blob) => void; reject: (err: Error) => void }>();
  private slotWaiters: { resolve: () => void; reject: (err: Error) => void }[] = [];
  private inFlightSlots = 0;
  private readonly maxQueue: number;
  private destroyed = false;
  peakPending = 0;

  constructor(maxQueue = MAX_ENCODER_QUEUE) {
    this.maxQueue = Math.max(1, Math.floor(maxQueue));
  }

  get inFlight(): number {
    return this.inFlightSlots;
  }

  private releaseSlot(): void {
    if (this.slotWaiters.length > 0 && !this.destroyed) {
      const next = this.slotWaiters.shift()!;
      next.resolve();
      return;
    }
    this.inFlightSlots = Math.max(0, this.inFlightSlots - 1);
  }

  private ensureWorker(): Worker {
    if (this.destroyed) throw new Error("BrowserWebpEncoder has been destroyed.");
    if (this.worker) return this.worker;
    const url = URL.createObjectURL(new Blob([ENCODER_WORKER_SOURCE], { type: "text/javascript" }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = (e: MessageEvent) => {
      const data = e.data as { id?: number; ok?: boolean; blob?: Blob; error?: string } | null;
      if (!data || typeof data.id !== "number") return;
      const waiter = this.pending.get(data.id);
      if (!waiter) return;
      this.pending.delete(data.id);
      this.releaseSlot();
      if (data.ok && data.blob) {
        waiter.resolve(data.blob);
      } else {
        waiter.reject(new Error(data.error ?? "WebP encoding failed"));
      }
    };
    w.onerror = () => {
      const count = this.pending.size;
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error("WebP encoder Worker error"));
      }
      this.pending.clear();
      for (let i = 0; i < count; i++) {
        this.releaseSlot();
      }
    };
    this.worker = w;
    return w;
  }

  private async waitForSlot(): Promise<void> {
    if (this.destroyed) throw new Error("BrowserWebpEncoder has been destroyed.");
    if (this.inFlightSlots < this.maxQueue) {
      this.inFlightSlots++;
      if (this.inFlightSlots > this.peakPending) {
        this.peakPending = this.inFlightSlots;
      }
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.slotWaiters.push({ resolve, reject });
    });
    if (this.destroyed) throw new Error("BrowserWebpEncoder has been destroyed.");
  }

  async encode(bitmap: ImageBitmapLike, quality: number): Promise<Blob> {
    if (typeof createImageBitmap !== "function") {
      throw new Error("createImageBitmap is not supported.");
    }
    await this.waitForSlot();
    let w: Worker;
    let copy: ImageBitmap;
    try {
      w = this.ensureWorker();
      copy = await createImageBitmap(bitmap as unknown as ImageBitmap);
    } catch (err) {
      this.releaseSlot();
      throw err;
    }
    if (this.destroyed) {
      this.releaseSlot();
      try {
        copy.close();
      } catch {}
      throw new Error("BrowserWebpEncoder has been destroyed.");
    }
    const id = ++this.seq;
    return new Promise<Blob>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        w.postMessage({ id, bitmap: copy, quality }, [copy]);
      } catch (err) {
        this.pending.delete(id);
        this.releaseSlot();
        try {
          copy.close();
        } catch {}
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async decode(blob: Blob): Promise<ImageBitmapLike> {
    if (this.destroyed) throw new Error("BrowserWebpEncoder has been destroyed.");
    const bm = await createImageBitmap(blob);
    if (this.destroyed) {
      try {
        bm.close();
      } catch {}
      throw new Error("BrowserWebpEncoder has been destroyed.");
    }
    return bm as unknown as ImageBitmapLike;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const waiter of this.slotWaiters) {
      waiter.reject(new Error("Encoder destroyed"));
    }
    this.slotWaiters.length = 0;
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error("Encoder destroyed"));
    }
    this.pending.clear();
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {}
      this.worker = null;
    }
  }
}

export type FrameStoreStatus = {
  disabled: boolean;
  disabledReason: string | null;
  totalBytes: number;
  qualityJobText: string | null;
};

export type FrameStoreOptions = {
  backend?: FrameStoreBackend;
  encoder?: FrameEncoder;
  maxBytes?: number;
  maxEncoderQueue?: number;
  openFilmKey?: string;
  defaultQuality?: number;
  now?: () => number;
  estimateStorage?: () => Promise<{ usage?: number; quota?: number }>;
  onStatusChange?: (status: FrameStoreStatus) => void;
};

function computeSceneSummary(
  totalFrames: number,
  frameQualities: Record<number, number>,
  frameBytes: Record<number, number>
): { saved: number; complete: boolean; quality: number | "mixed"; bytes: number } {
  let saved = 0;
  let bytes = 0;
  let firstQuality: number | null = null;
  let mixed = false;

  for (let f = 0; f < totalFrames; f++) {
    const q = frameQualities[f];
    if (typeof q === "number") {
      saved++;
      bytes += frameBytes[f] ?? 0;
      if (firstQuality === null) {
        firstQuality = q;
      } else if (Math.abs(firstQuality - q) > 1e-6) {
        mixed = true;
      }
    }
  }

  const complete = totalFrames > 0 && saved >= totalFrames;
  const quality: number | "mixed" = mixed ? "mixed" : (firstQuality ?? DEFAULT_PREVIEW_QUALITY);
  return { saved, complete, quality, bytes };
}

export class FrameStore {
  readonly backend: FrameStoreBackend;
  readonly encoder: FrameEncoder;
  readonly maxBytes: number;
  readonly maxEncoderQueue: number;
  private openFilmKey: string;
  private targetQuality: PreviewQuality;
  private readonly now: () => number;
  private readonly estimateStorage?: () => Promise<{ usage?: number; quota?: number }>;
  private readonly statusListeners = new Set<(status: FrameStoreStatus) => void>();

  private scenesCache = new Map<string, StoredSceneRecord>();
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private isDisabled = false;
  private isDestroyed = false;
  private disableMsg: string | null = null;
  private qualityJobText: string | null = null;
  private pendingSaves = new Set<Promise<unknown>>();
  private inFlightEncodesCount = 0;
  private peakInFlightEncodesCount = 0;
  private encodeSlotWaiters: (() => void)[] = [];
  private digestEpochs = new Map<string, number>();

  constructor(options: FrameStoreOptions = {}) {
    this.maxEncoderQueue = Math.max(1, Math.floor(options.maxEncoderQueue ?? MAX_ENCODER_QUEUE));
    this.backend =
      options.backend ??
      (typeof indexedDB !== "undefined" ? new IndexedDbFrameStoreBackend() : new InMemoryFrameStoreBackend());
    this.encoder =
      options.encoder ??
      (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
        ? new BrowserWebpEncoder(this.maxEncoderQueue)
        : {
            async encode(_bm, q) {
              const size = Math.round(q * 60_000);
              return new Blob([new Uint8Array(size)], { type: "image/webp" });
            },
            async decode(blob) {
              const fake: ImageBitmapLike & { byteSize: number; fromStore: boolean; closed: boolean } = {
                width: 640,
                height: 360,
                byteSize: blob.size,
                fromStore: true,
                closed: false,
                close() {
                  fake.closed = true;
                }
              };
              return fake;
            }
          });
    this.maxBytes = options.maxBytes ?? FRAME_STORE_MAX_BYTES;
    this.openFilmKey = options.openFilmKey ?? "default-film";
    this.targetQuality = normalizePreviewQuality(options.defaultQuality ?? readStoredPreviewQuality());
    this.now = options.now ?? (() => Date.now());
    this.estimateStorage =
      options.estimateStorage ??
      (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.estimate === "function"
        ? () => navigator.storage.estimate()
        : undefined);
    if (options.onStatusChange) {
      this.statusListeners.add(options.onStatusChange);
    }
  }

  get disabled(): boolean {
    return this.isDisabled;
  }

  get disabledReason(): string | null {
    return this.disableMsg;
  }

  get quality(): PreviewQuality {
    return this.targetQuality;
  }

  /** Number of frame encodes currently in flight (never exceeds `maxEncoderQueue`). */
  get inFlightEncodes(): number {
    return this.inFlightEncodesCount;
  }

  /** Peak concurrent frame encodes observed by this store instance. */
  get peakEncoderQueue(): number {
    return this.peakInFlightEncodesCount;
  }

  private async acquireEncodeSlot(): Promise<void> {
    if (this.isDestroyed) throw new Error("FrameStore destroyed");
    if (this.inFlightEncodesCount < this.maxEncoderQueue) {
      this.inFlightEncodesCount++;
      if (this.inFlightEncodesCount > this.peakInFlightEncodesCount) {
        this.peakInFlightEncodesCount = this.inFlightEncodesCount;
      }
      return;
    }
    await new Promise<void>((resolve) => {
      this.encodeSlotWaiters.push(resolve);
    });
  }

  private releaseEncodeSlot(): void {
    if (this.encodeSlotWaiters.length > 0 && !this.isDestroyed) {
      // Hand the slot directly to the next waiting caller (inFlightEncodesCount stays unchanged).
      const next = this.encodeSlotWaiters.shift()!;
      next();
      return;
    }
    this.inFlightEncodesCount = Math.max(0, this.inFlightEncodesCount - 1);
  }

  private epochForDigest(bundleDigest: string): number {
    return this.digestEpochs.get(bundleDigest) ?? 0;
  }

  /**
   * Cancels any in-flight or queued frame saves for `bundleDigest` (e.g. when a scene revision changes).
   */
  cancelSceneWork(bundleDigest: string): void {
    this.digestEpochs.set(bundleDigest, this.epochForDigest(bundleDigest) + 1);
  }

  setQuality(q: number): PreviewQuality {
    this.targetQuality = normalizePreviewQuality(q);
    writeStoredPreviewQuality(this.targetQuality);
    return this.targetQuality;
  }

  setOpenFilmKey(filmKey: string): void {
    this.openFilmKey = filmKey;
  }

  getOpenFilmKey(): string {
    return this.openFilmKey;
  }

  setQualityJobStatus(text: string | null): void {
    if (this.qualityJobText === text) return;
    this.qualityJobText = text;
    this.emitStatus();
  }

  status(): FrameStoreStatus {
    return {
      disabled: this.isDisabled,
      disabledReason: this.disableMsg,
      totalBytes: this.totalBytes(),
      qualityJobText: this.qualityJobText
    };
  }

  onStatusChange(cb: (status: FrameStoreStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private emitStatus(): void {
    const st = this.status();
    for (const cb of this.statusListeners) {
      try {
        cb(st);
      } catch {}
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const all = await this.backend.getAllScenes();
          for (const [key, rec] of all.entries()) {
            // Hydrate per-frame quality map if an older scene record lacked `frameQualities`
            if ((!rec.frameQualities || Object.keys(rec.frameQualities).length === 0) && rec.saved > 0 && this.backend.getAllFramesForScene) {
              const framesMap = await this.backend.getAllFramesForScene(key);
              const fq: Record<number, number> = {};
              const fb: Record<number, number> = {};
              for (const [fIdx, fRec] of framesMap.entries()) {
                fq[fIdx] = fRec.quality;
                fb[fIdx] = fRec.blob?.size ?? 0;
              }
              const summary = computeSceneSummary(rec.frames, fq, fb);
              rec.frameQualities = fq;
              rec.frameBytes = fb;
              rec.saved = summary.saved;
              rec.complete = summary.complete;
              rec.quality = summary.quality;
              rec.bytes = summary.bytes;
            }
            this.scenesCache.set(key, cloneSceneRecord(rec));
          }
        } catch {
          // If IndexedDB fails to open, keep in-memory map empty
        }
        this.initialized = true;
      })();
    }
    return this.initPromise;
  }

  totalBytes(): number {
    let sum = 0;
    for (const rec of this.scenesCache.values()) {
      sum += rec.bytes;
    }
    return sum;
  }

  getSceneRecord(bundleDigest: string, sizeLabel: string): StoredSceneRecord | undefined {
    const rec = this.scenesCache.get(storeSceneKey(bundleDigest, sizeLabel));
    return rec ? cloneSceneRecord(rec) : undefined;
  }

  isSceneComplete(bundleDigest: string, sizeLabel: string, expectedFrames?: number): boolean {
    if (this.isDisabled) return false;
    const rec = this.scenesCache.get(storeSceneKey(bundleDigest, sizeLabel));
    if (!rec || !rec.complete) return false;
    if (expectedFrames !== undefined && rec.frames !== expectedFrames) return false;
    return rec.saved >= rec.frames;
  }

  hasFrame(bundleDigest: string, sizeLabel: string, frame: number): boolean {
    if (this.isDisabled) return false;
    const rec = this.scenesCache.get(storeSceneKey(bundleDigest, sizeLabel));
    if (!rec) return false;
    if (rec.frameQualities) {
      return typeof rec.frameQualities[frame] === "number";
    }
    return rec.complete && frame >= 0 && frame < rec.frames;
  }

  getFrameQuality(bundleDigest: string, sizeLabel: string, frame: number): number | undefined {
    const rec = this.scenesCache.get(storeSceneKey(bundleDigest, sizeLabel));
    if (!rec) return undefined;
    if (rec.frameQualities && typeof rec.frameQualities[frame] === "number") {
      return rec.frameQualities[frame];
    }
    if (rec.complete && typeof rec.quality === "number" && frame >= 0 && frame < rec.frames) {
      return rec.quality;
    }
    return undefined;
  }

  savedFrames(bundleDigest: string, sizeLabel: string): number[] {
    const rec = this.scenesCache.get(storeSceneKey(bundleDigest, sizeLabel));
    if (!rec) return [];
    if (rec.frameQualities) {
      return Object.keys(rec.frameQualities)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < rec.frames)
        .sort((a, b) => a - b);
    }
    if (rec.complete) {
      return Array.from({ length: rec.frames }, (_, i) => i);
    }
    return [];
  }

  missingFrames(bundleDigest: string, sizeLabel: string, totalFrames: number): number[] {
    const saved = new Set(this.savedFrames(bundleDigest, sizeLabel));
    const missing: number[] = [];
    for (let f = 0; f < totalFrames; f++) {
      if (!saved.has(f)) missing.push(f);
    }
    return missing;
  }

  firstMissingFrame(bundleDigest: string, sizeLabel: string, totalFrames: number): number | null {
    const saved = new Set(this.savedFrames(bundleDigest, sizeLabel));
    for (let f = 0; f < totalFrames; f++) {
      if (!saved.has(f)) return f;
    }
    return null;
  }

  /**
   * Registers a scene's metadata (`frames`, `filmKey`, `variantKey`) and deletes any superseded `bundleDigest`
   * for the same `variantKey` and `sizeLabel` once the new revision is registered.
   */
  async registerScene(meta: {
    bundleDigest: string;
    sizeLabel: string;
    frames: number;
    filmKey?: string;
    variantKey?: string;
  }): Promise<StoredSceneRecord> {
    await this.init();
    const sKey = storeSceneKey(meta.bundleDigest, meta.sizeLabel);
    const filmKey = meta.filmKey ?? this.openFilmKey;

    if (meta.variantKey) {
      await this.replaceVariantRevision(meta.variantKey, meta.bundleDigest, meta.sizeLabel);
    }

    let existing = this.scenesCache.get(sKey);
    if (!existing) {
      existing = await this.backend.getScene(sKey);
    }
    const now = this.now();
    if (existing) {
      existing.frames = meta.frames;
      existing.filmKey = filmKey;
      existing.lastUsed = now;
      if (meta.variantKey) existing.variantKey = meta.variantKey;
      const fq = existing.frameQualities ?? {};
      const fb = existing.frameBytes ?? {};
      const summary = computeSceneSummary(meta.frames, fq, fb);
      existing.saved = summary.saved;
      existing.complete = summary.complete;
      existing.quality = summary.quality;
      existing.bytes = summary.bytes;
      this.scenesCache.set(sKey, cloneSceneRecord(existing));
      await this.backend.putScene(sKey, cloneSceneRecord(existing)).catch(() => {});
      return cloneSceneRecord(existing);
    }

    const fresh: StoredSceneRecord = {
      frames: meta.frames,
      saved: 0,
      complete: false,
      quality: this.targetQuality,
      bytes: 0,
      lastUsed: now,
      filmKey,
      ...(meta.variantKey ? { variantKey: meta.variantKey } : {}),
      frameQualities: {},
      frameBytes: {}
    };
    this.scenesCache.set(sKey, cloneSceneRecord(fresh));
    await this.backend.putScene(sKey, cloneSceneRecord(fresh)).catch(() => {});
    return cloneSceneRecord(fresh);
  }

  /**
   * Deletes a single frame from both the in-memory scene index and the underlying store backend.
   */
  async deleteFrame(bundleDigest: string, sizeLabel: string, frame: number): Promise<void> {
    await this.init();
    const sKey = storeSceneKey(bundleDigest, sizeLabel);
    const fKey = storeFrameKey(bundleDigest, sizeLabel, frame);
    await this.backend.deleteFrame(fKey).catch(() => {});
    const rec = this.scenesCache.get(sKey);
    if (rec) {
      const fq = { ...(rec.frameQualities ?? {}) };
      const fb = { ...(rec.frameBytes ?? {}) };
      delete fq[frame];
      delete fb[frame];
      const summary = computeSceneSummary(rec.frames, fq, fb);
      rec.frameQualities = fq;
      rec.frameBytes = fb;
      rec.saved = summary.saved;
      rec.complete = summary.complete;
      rec.quality = summary.quality;
      rec.bytes = summary.bytes;
      this.scenesCache.set(sKey, cloneSceneRecord(rec));
      await this.backend.putScene(sKey, cloneSceneRecord(rec)).catch(() => {});
    }
  }

  /**
   * Deletes a scene's stored frames and scene record for `(bundleDigest, sizeLabel)` and cancels any in-flight saves for it.
   */
  async deleteSceneFrames(bundleDigest: string, sizeLabel: string): Promise<void> {
    this.cancelSceneWork(bundleDigest);
    await this.init();
    const sKey = storeSceneKey(bundleDigest, sizeLabel);
    const rec = this.scenesCache.get(sKey) ?? (await this.backend.getScene(sKey));
    const maxFrames = rec?.frames ?? 0;
    const frameIndices = new Set<number>(Array.from({ length: maxFrames }, (_, i) => i));
    if (rec?.frameQualities) {
      for (const k of Object.keys(rec.frameQualities)) frameIndices.add(Number(k));
    }
    this.scenesCache.delete(sKey);
    await Promise.all([
      ...[...frameIndices].map((f) => this.backend.deleteFrame(storeFrameKey(bundleDigest, sizeLabel, f)).catch(() => {})),
      this.backend.deleteScene(sKey).catch(() => {})
    ]);
  }

  /**
   * Deletes any superseded `bundleDigest` for the given `variantKey` and `sizeLabel`.
   */
  async replaceVariantRevision(variantKey: string, newBundleDigest: string, sizeLabel: string): Promise<string[]> {
    await this.init();
    const removedDigests: string[] = [];
    for (const [sKey, rec] of [...this.scenesCache.entries()]) {
      const parsed = parseStoreSceneKey(sKey);
      if (!parsed || parsed.size !== sizeLabel) continue;
      if (rec.variantKey === variantKey && parsed.bundleDigest !== newBundleDigest) {
        removedDigests.push(parsed.bundleDigest);
        await this.deleteSceneFrames(parsed.bundleDigest, sizeLabel);
      }
    }
    return removedDigests;
  }

  /**
   * Saves a drawn `frameBitmap` under `key` (`${bundleDigest}|${w}x${h}|${frame}`) at `quality`.
   * Bounded by `maxEncoderQueue` (8 frames): when the encoder queue is full, the drawing side waits rather than queueing more bitmaps.
   * Never delays the shown bitmap: `BrowserWebpEncoder` clones `frameBitmap` via `createImageBitmap` and transfers the copy.
   * If the returned blob type is not `image/webp`, disables storing for this browser session.
   */
  save(
    frameBitmap: ImageBitmapLike,
    key: string,
    quality: number = this.targetQuality,
    meta?: { frames?: number; filmKey?: string; variantKey?: string }
  ): Promise<boolean> {
    const task = this.doSave(frameBitmap, key, quality, meta);
    this.pendingSaves.add(task);
    void task.finally(() => {
      this.pendingSaves.delete(task);
    });
    return task;
  }

  private async doSave(
    frameBitmap: ImageBitmapLike,
    key: string,
    quality: number,
    meta?: { frames?: number; filmKey?: string; variantKey?: string }
  ): Promise<boolean> {
    if (this.isDisabled || this.isDestroyed) return false;
    await this.init();
    if (this.isDisabled || this.isDestroyed) return false;
    const parsed = parseStoreFrameKey(key);
    if (!parsed) throw new Error(`Invalid frame store key: ${key}`);
    const startEpoch = this.epochForDigest(parsed.bundleDigest);

    try {
      await this.acquireEncodeSlot();
    } catch {
      return false;
    }

    let blob: Blob;
    try {
      if (this.isDisabled || this.isDestroyed || this.epochForDigest(parsed.bundleDigest) !== startEpoch) {
        return false;
      }
      blob = await this.encoder.encode(frameBitmap, quality);
    } catch {
      return false;
    } finally {
      this.releaseEncodeSlot();
    }

    if (this.isDestroyed || this.epochForDigest(parsed.bundleDigest) !== startEpoch) {
      return false;
    }

    if (blob.type !== "image/webp") {
      this.isDisabled = true;
      this.disableMsg = "WebP frame storage unsupported in this browser (replays redraw)";
      this.emitStatus();
      return false;
    }

    return this.commitFrameBlob(parsed.bundleDigest, parsed.size, parsed.frame, blob, quality, startEpoch, meta);
  }

  private async commitFrameBlob(
    bundleDigest: string,
    sizeLabel: string,
    frame: number,
    blob: Blob,
    quality: number,
    expectedEpoch: number,
    meta?: { frames?: number; filmKey?: string; variantKey?: string }
  ): Promise<boolean> {
    if (this.isDestroyed || this.epochForDigest(bundleDigest) !== expectedEpoch) return false;
    const now = this.now();
    const fKey = storeFrameKey(bundleDigest, sizeLabel, frame);
    const sKey = storeSceneKey(bundleDigest, sizeLabel);
    const existing = this.scenesCache.get(sKey) ?? (await this.backend.getScene(sKey));
    if (this.isDestroyed || this.epochForDigest(bundleDigest) !== expectedEpoch) return false;
    const totalFrames = Math.max(meta?.frames ?? existing?.frames ?? frame + 1, frame + 1);
    const filmKey = meta?.filmKey ?? existing?.filmKey ?? this.openFilmKey;
    const variantKey = meta?.variantKey ?? existing?.variantKey;

    const fq: Record<number, number> = { ...(existing?.frameQualities ?? {}) };
    const fb: Record<number, number> = { ...(existing?.frameBytes ?? {}) };
    fq[frame] = quality;
    fb[frame] = blob.size;

    const summary = computeSceneSummary(totalFrames, fq, fb);
    const sceneRecord: StoredSceneRecord = {
      frames: totalFrames,
      saved: summary.saved,
      complete: summary.complete,
      quality: summary.quality,
      bytes: summary.bytes,
      lastUsed: now,
      filmKey,
      ...(variantKey ? { variantKey } : {}),
      frameQualities: fq,
      frameBytes: fb
    };

    this.scenesCache.set(sKey, cloneSceneRecord(sceneRecord));
    try {
      await this.backend.putFrame(fKey, { blob, quality, savedAt: now });
      await this.backend.putScene(sKey, cloneSceneRecord(sceneRecord));
      await this.evictIfNeeded();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads a stored frame by `key` (`${bundleDigest}|${w}x${h}|${frame}`) and decodes it via `createImageBitmap(blob)`.
   */
  async load(key: string): Promise<ImageBitmapLike | null> {
    if (this.isDisabled || this.isDestroyed) return null;
    await this.init();
    if (this.isDisabled || this.isDestroyed) return null;
    const parsed = parseStoreFrameKey(key);
    if (!parsed) return null;
    const startEpoch = this.epochForDigest(parsed.bundleDigest);

    let frameRec: StoredFrameRecord | undefined;
    try {
      frameRec = await this.backend.getFrame(key);
    } catch {
      return null;
    }
    if (!frameRec || !frameRec.blob || this.isDestroyed || this.epochForDigest(parsed.bundleDigest) !== startEpoch) {
      return null;
    }

    const sKey = storeSceneKey(parsed.bundleDigest, parsed.size);
    const sceneRec = this.scenesCache.get(sKey);
    if (sceneRec) {
      sceneRec.lastUsed = this.now();
      void this.backend.putScene(sKey, cloneSceneRecord(sceneRec)).catch(() => {});
    }

    try {
      const bm = await this.encoder.decode(frameRec.blob);
      if (this.isDestroyed || this.epochForDigest(parsed.bundleDigest) !== startEpoch) {
        try {
          bm.close();
        } catch {}
        return null;
      }
      return bm;
    } catch {
      return null;
    }
  }

  /**
   * Enforces the 500 MB cap across the site. Evicts whole films least recently used, never the open film.
   */
  async evictIfNeeded(): Promise<string[]> {
    await this.init();
    let effectiveCap = this.maxBytes;
    if (this.estimateStorage) {
      try {
        const est = await this.estimateStorage();
        if (typeof est?.quota === "number" && est.quota > 0) {
          effectiveCap = Math.min(effectiveCap, Math.floor(est.quota * 0.8));
        }
      } catch {}
    }

    let currentBytes = this.totalBytes();
    if (currentBytes <= effectiveCap) return [];

    // Group non-open films by filmKey and find each film's most recent `lastUsed` timestamp.
    const films = new Map<string, { lastUsed: number; sceneKeys: string[]; bytes: number }>();
    for (const [sKey, rec] of this.scenesCache.entries()) {
      if (rec.filmKey === this.openFilmKey) continue;
      const entry = films.get(rec.filmKey) ?? { lastUsed: 0, sceneKeys: [], bytes: 0 };
      if (rec.lastUsed > entry.lastUsed) entry.lastUsed = rec.lastUsed;
      entry.sceneKeys.push(sKey);
      entry.bytes += rec.bytes;
      films.set(rec.filmKey, entry);
    }

    const sortedFilms = [...films.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const evictedFilms: string[] = [];

    for (const [filmKey, info] of sortedFilms) {
      if (currentBytes <= effectiveCap) break;
      evictedFilms.push(filmKey);
      for (const sKey of info.sceneKeys) {
        const parsed = parseStoreSceneKey(sKey);
        if (parsed) {
          await this.deleteSceneFrames(parsed.bundleDigest, parsed.size);
        }
      }
      currentBytes = this.totalBytes();
    }

    return evictedFilms;
  }

  /** Waits for all in-flight frame saves to finish writing. */
  async flush(): Promise<void> {
    while (this.pendingSaves.size > 0) {
      await Promise.allSettled([...this.pendingSaves]);
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    for (const resolve of this.encodeSlotWaiters) {
      resolve();
    }
    this.encodeSlotWaiters.length = 0;
    this.encoder.destroy?.();
    this.statusListeners.clear();
  }
}

export type QualityJobSceneSpec = {
  sceneIndex: number;
  bundleDigest: string;
  sizeLabel: string;
  frames: number;
};

export type QualityJobSlot = {
  sceneIndex: number;
  bundleDigest: string;
  sizeLabel: string;
  frame: number;
};

/**
 * Pure frame ordering for `QualityJob`:
 * 1. Frames just ahead of the playhead in the focus scene (`[focusFrame .. min(frames - 1, focusFrame + aheadCount - 1)]`).
 * 2. Outward from that window in the focus scene (alternating behind and further ahead).
 * 3. Remaining scenes of the film: following scenes in order, then preceding scenes outward.
 */
export function buildQualityJobOrder(
  scenes: readonly QualityJobSceneSpec[],
  focusSceneIndex: number,
  focusFrame: number,
  aheadCount = 30
): QualityJobSlot[] {
  if (!scenes.length) return [];
  const clampedSceneIdx = Math.max(0, Math.min(scenes.length - 1, Math.floor(focusSceneIndex)));
  const active = scenes[clampedSceneIdx]!;
  const maxFrame = Math.max(0, active.frames - 1);
  const anchor = Math.max(0, Math.min(maxFrame, Math.floor(focusFrame)));
  const out: QualityJobSlot[] = [];

  // 1. Frames just ahead of the playhead (including playhead)
  const aheadEnd = Math.min(maxFrame, anchor + Math.max(1, aheadCount) - 1);
  for (let f = anchor; f <= aheadEnd; f++) {
    out.push({
      sceneIndex: active.sceneIndex,
      bundleDigest: active.bundleDigest,
      sizeLabel: active.sizeLabel,
      frame: f
    });
  }

  // 2. Outward from `[anchor .. aheadEnd]` in the focus scene
  let left = anchor - 1;
  let right = aheadEnd + 1;
  while (left >= 0 || right <= maxFrame) {
    if (left >= 0) {
      out.push({
        sceneIndex: active.sceneIndex,
        bundleDigest: active.bundleDigest,
        sizeLabel: active.sizeLabel,
        frame: left--
      });
    }
    if (right <= maxFrame) {
      out.push({
        sceneIndex: active.sceneIndex,
        bundleDigest: active.bundleDigest,
        sizeLabel: active.sizeLabel,
        frame: right++
      });
    }
  }

  // 3. Rest of the film: following scenes in order, then preceding scenes backwards from focusSceneIndex
  for (let s = clampedSceneIdx + 1; s < scenes.length; s++) {
    const sc = scenes[s]!;
    for (let f = 0; f < sc.frames; f++) {
      out.push({
        sceneIndex: sc.sceneIndex,
        bundleDigest: sc.bundleDigest,
        sizeLabel: sc.sizeLabel,
        frame: f
      });
    }
  }
  for (let s = clampedSceneIdx - 1; s >= 0; s--) {
    const sc = scenes[s]!;
    for (let f = 0; f < sc.frames; f++) {
      out.push({
        sceneIndex: sc.sceneIndex,
        bundleDigest: sc.bundleDigest,
        sizeLabel: sc.sizeLabel,
        frame: f
      });
    }
  }

  return out;
}

export type QualityJobProgress = {
  running: boolean;
  direction: "raising" | "lowering";
  targetQuality: PreviewQuality;
  done: number;
  total: number;
  text: string | null;
};

export type QualityJobOptions = {
  store: FrameStore;
  scenes: readonly QualityJobSceneSpec[];
  targetQuality: number;
  initialSceneIndex?: number;
  initialFrame?: number;
  /** Redraws a frame using the scene's code (`WorkerHost` via the exclusive draw queue). */
  redrawFrame: (sceneIndex: number, frame: number) => Promise<ImageBitmapLike>;
  /** True when playback is buffering or a frame is due within the next tick so the job must yield the CPU. */
  shouldYield?: () => boolean;
  /** Called immediately when a frame is saved at the new quality so in-memory caches switch at once. */
  onFrameUpdated?: (sceneIndex: number, frame: number, key: string) => void;
  onProgress?: (progress: QualityJobProgress) => void;
};

/**
 * Background quality-change job (plan change E):
 * - Both raising and lowering quality redraw frames with the scene code (an idle `WorkerHost` for that scene,
 *   through the exclusive draw queue so only one scene draws at a time) and save at the new quality.
 *   Never decodes-and-re-encodes a stored lossy copy (detail would be lost twice).
 * - Processes frames just ahead of the playhead first, then outward, then the rest of the film; `recenter()` re-centres on scrub/click.
 * - Yields whenever `shouldYield()` is true (playback buffering or frame due).
 * - Persists per-frame quality in `FrameStore` so a reload resumes from where it left off.
 */
export class QualityJob {
  private readonly store: FrameStore;
  private scenes: QualityJobSceneSpec[];
  private targetQuality: PreviewQuality;
  private focusSceneIndex: number;
  private focusFrame: number;
  private readonly redrawFrame: (sceneIndex: number, frame: number) => Promise<ImageBitmapLike>;
  private readonly shouldYield: () => boolean;
  private readonly onFrameUpdated?: (sceneIndex: number, frame: number, key: string) => void;
  private readonly onProgress?: (progress: QualityJobProgress) => void;

  private direction: "raising" | "lowering" = "raising";
  private isRunning = false;
  private isCancelled = false;
  private cancelledDigests = new Set<string>();
  private runPromise: Promise<void> | null = null;
  readonly processedOrder: QualityJobSlot[] = [];

  constructor(options: QualityJobOptions) {
    this.store = options.store;
    this.scenes = options.scenes.map((s) => ({ ...s }));
    this.targetQuality = normalizePreviewQuality(options.targetQuality);
    this.focusSceneIndex = options.initialSceneIndex ?? 0;
    this.focusFrame = options.initialFrame ?? 0;
    this.redrawFrame = options.redrawFrame;
    this.shouldYield = options.shouldYield ?? (() => false);
    this.onFrameUpdated = options.onFrameUpdated;
    this.onProgress = options.onProgress;
    this.direction = this.detectDirection();
  }

  private detectDirection(): "raising" | "lowering" {
    for (const sc of this.scenes) {
      for (let f = 0; f < sc.frames; f++) {
        const q = this.store.getFrameQuality(sc.bundleDigest, sc.sizeLabel, f);
        if (typeof q === "number" && Math.abs(q - this.targetQuality) > 1e-6) {
          return this.targetQuality > q ? "raising" : "lowering";
        }
      }
    }
    return "raising";
  }

  recenter(sceneIndex: number, frame: number): void {
    this.focusSceneIndex = sceneIndex;
    this.focusFrame = frame;
  }

  /** Cancels work for a superseded `bundleDigest` and updates the scene list. */
  cancelScene(oldBundleDigest: string): void {
    this.cancelledDigests.add(oldBundleDigest);
    this.store.cancelSceneWork(oldBundleDigest);
  }

  setScenes(scenes: readonly QualityJobSceneSpec[]): void {
    const nextDigests = new Set(scenes.map((s) => s.bundleDigest));
    for (const prev of this.scenes) {
      if (!nextDigests.has(prev.bundleDigest)) {
        this.cancelledDigests.add(prev.bundleDigest);
      }
    }
    this.scenes = scenes.map((s) => ({ ...s }));
  }

  get running(): boolean {
    return this.isRunning;
  }

  counts(): { done: number; total: number } {
    let total = 0;
    let done = 0;
    for (const sc of this.scenes) {
      if (this.cancelledDigests.has(sc.bundleDigest)) continue;
      for (let f = 0; f < sc.frames; f++) {
        const q = this.store.getFrameQuality(sc.bundleDigest, sc.sizeLabel, f);
        total++;
        if (typeof q === "number" && Math.abs(q - this.targetQuality) <= 1e-6) {
          done++;
        }
      }
    }
    return { done, total };
  }

  progress(): QualityJobProgress {
    const { done, total } = this.counts();
    const verb = this.direction === "raising" ? "Raising preview quality" : "Lowering preview quality";
    const active = this.isRunning && done < total;
    const text = active ? `${verb}… ${done} / ${total} frames` : null;
    return {
      running: active,
      direction: this.direction,
      targetQuality: this.targetQuality,
      done,
      total,
      text
    };
  }

  private emitProgress(): void {
    const p = this.progress();
    this.store.setQualityJobStatus(p.text);
    this.onProgress?.(p);
  }

  private pickNextSlot(): QualityJobSlot | null {
    const order = buildQualityJobOrder(this.scenes, this.focusSceneIndex, this.focusFrame);
    for (const slot of order) {
      if (this.cancelledDigests.has(slot.bundleDigest)) continue;
      const q = this.store.getFrameQuality(slot.bundleDigest, slot.sizeLabel, slot.frame);
      if (typeof q === "number" && Math.abs(q - this.targetQuality) <= 1e-6) {
        continue;
      }
      return slot;
    }
    return null;
  }

  start(): Promise<void> {
    if (this.runPromise) return this.runPromise;
    this.isCancelled = false;
    this.isRunning = true;
    this.runPromise = this.runLoop().finally(() => {
      this.isRunning = false;
      this.runPromise = null;
      this.emitProgress();
    });
    return this.runPromise;
  }

  cancel(): void {
    this.isCancelled = true;
    this.isRunning = false;
    this.store.setQualityJobStatus(null);
  }

  private async runLoop(): Promise<void> {
    await this.store.init();
    this.direction = this.detectDirection();
    this.emitProgress();

    while (!this.isCancelled && !this.store.disabled) {
      while (!this.isCancelled && this.shouldYield()) {
        await new Promise((r) => setTimeout(r, 16));
      }
      if (this.isCancelled) break;

      const slot = this.pickNextSlot();
      if (!slot) break;

      const key = storeFrameKey(slot.bundleDigest, slot.sizeLabel, slot.frame);
      const sc = this.scenes.find((s) => s.sceneIndex === slot.sceneIndex && s.bundleDigest === slot.bundleDigest);

      // Both raising and lowering quality redraw from the scene code and save at targetQuality.
      let bm: ImageBitmapLike | null = null;
      try {
        bm = await this.redrawFrame(slot.sceneIndex, slot.frame);
        if (this.isCancelled || this.cancelledDigests.has(slot.bundleDigest)) {
          break;
        }
        const ok = await this.store.save(bm, key, this.targetQuality, {
          frames: sc?.frames
        });
        if (!ok || this.isCancelled || this.cancelledDigests.has(slot.bundleDigest)) {
          if (!ok && !this.cancelledDigests.has(slot.bundleDigest)) break;
          continue;
        }
        this.processedOrder.push(slot);
        this.onFrameUpdated?.(slot.sceneIndex, slot.frame, key);
      } catch {
        if (!this.cancelledDigests.has(slot.bundleDigest)) {
          break;
        }
      } finally {
        if (bm) {
          try {
            bm.close();
          } catch {}
        }
      }

      this.emitProgress();
      // Yield a macrotask between frames so playback and UI events always get the CPU first
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}
