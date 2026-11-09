import {
  isSlowScene
} from "./draft-profile.ts";
import type { HostFilmMeta, HostFrameResult, HostInitResult } from "./worker-host.ts";

/**
 * Browser API client and Worker check runner for live plate scenes (docs/LIVE_SCENES_PLAN.md §7, §11).
 * Kept free of React or framework imports so both the studio and standalone tests can use it.
 */

export type BundleManifest = {
  schema?: number;
  kind?: string;
  engineVersion?: string;
  engineDigest?: string;
  styleDigest?: string;
  width?: number;
  height?: number;
  W?: number;
  H?: number;
  fps?: number;
  frames?: number;
  durationFrames?: number;
  aspect?: "16:9" | "9:16" | "1:1" | string;
  sourceSha?: string;
  bundleSha?: string;
  imports?: string[];
  [key: string]: unknown;
};

export type FetchedBundle = {
  html: string;
  bundleDigest: string;
  manifest: BundleManifest;
  params: Record<string, unknown>;
  expiresAt: string;
  url?: string;
  gen?: number;
};

export const DEFAULT_CHECK_WATCHDOG_MS = 10_000;
export const DEFAULT_FRAME_WATCHDOG_MS = 2_000;
export const DEFAULT_INIT_WATCHDOG_MS = 2_000;
export const MAX_CONSECUTIVE_OVER_BUDGET_FRAMES = 3;
export const MAX_VISIBILITY_RECHECKS = 3;
export const DEFAULT_CHECK_MAX_RETRIES = 2;
export const DEFAULT_CHECK_RETRY_BACKOFF_MS: readonly number[] = [150, 400];

export function isDocumentHidden(
  doc?: { hidden?: boolean; visibilityState?: string } | null
): boolean {
  try {
    const d =
      doc !== undefined
        ? doc
        : (globalThis as { document?: { hidden?: boolean; visibilityState?: string } }).document;
    if (!d) return false;
    if (d.hidden === true) return true;
    if (typeof d.visibilityState === "string" && d.visibilityState !== "visible") return true;
    return false;
  } catch {
    return false;
  }
}

export function isWatchdogTimeoutError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("watchdog") ||
    msg.includes("frame-timeout") ||
    msg.includes("init-timeout") ||
    msg.includes("heartbeat-timeout") ||
    msg.includes("check-watchdog")
  );
}

export function isInitTimeoutError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return msg.includes("init-timeout") || (msg.includes("watchdog") && msg.includes("init"));
}

const BUNDLE_URL_GEN_REGEX = /(?:\/|%2F)g(\d+)(?:\/|%2F)(?:bundles(?:\/|%2F)[^/?#]+(?:\/|%2F))?bundle\.html/i;

/**
 * Extracts the variant generation (`gen`) from a presigned bundle URL
 * (`.../g<gen>/bundle.html` or `.../g<gen>/bundles/<sha>/bundle.html`),
 * falling back to `fallbackGen` (default `1`).
 */
export function parseGenFromBundleUrl(url?: string | null, fallbackGen = 1): number {
  if (typeof url === "string" && url.length > 0) {
    const m = BUNDLE_URL_GEN_REGEX.exec(url);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1) return n;
    }
  }
  return Number.isInteger(fallbackGen) && fallbackGen >= 1 ? fallbackGen : 1;
}

export type CheckOutcomeResults = {
  source?: "playback";
  reason?: string;
  samples?: number;
  drawMsMedian?: number;
  drawMsP90?: number;
  drawMs?: { medianMs: number; p90Ms: number };
  [key: string]: unknown;
};

export type CheckOutcome =
  | {
      ok: true;
      source?: "playback";
      reason?: string;
      samples?: number;
      results?: CheckOutcomeResults;
      drawMsMedian?: number;
      drawMsP90?: number;
      drawMs?: { medianMs: number; p90Ms: number };
      initRetries?: number;
    }
  | { ok: false; kind: "code"; error: string; results?: CheckOutcomeResults }
  | {
      ok: false;
      kind: "env";
      error?: string;
      results?: CheckOutcomeResults;
      initRetries?: number;
      overBudgetExhausted?: boolean;
    }
  | {
      ok: false;
      kind: "inconclusive";
      inconclusive: true;
      reason?: string;
      error?: string;
    };

export type CheckReportPayload = {
  gen: number;
  bundleDigest: string;
  results: CheckOutcome;
  device?: Record<string, unknown>;
};

export type ReportCheckResult =
  | {
      status: "ok";
      ok: true;
      dropped: false;
      httpStatus: 200;
      state?: "bundled" | "checked" | "rendering" | "drawn" | "failed" | string;
      repair?: boolean;
      fallback?: boolean;
      playback?: "clip";
    }
  | { status: "dropped"; ok: true; dropped: true; httpStatus: 204 }
  | { status: "error"; ok: false; dropped: false; httpStatus: number; code?: string; message?: string }
  | { status: "network_error"; ok: false; dropped: false; error: string };

export type RequestClipResult =
  | { status: "rendering"; state: "rendering"; ok: true; capped: false; httpStatus: 202 }
  | { status: "clip_cap"; code: "clip_cap"; state: "clip_cap"; ok: false; capped: true; httpStatus: 429; message?: string }
  | { status: "error"; ok: false; capped: false; httpStatus: number; code?: string; message?: string }
  | { status: "network_error"; ok: false; capped: false; error: string };

export type LiveApiOptions = {
  fetch?: typeof fetch;
  baseUrl?: string;
  headers?: Record<string, string>;
  now?: () => number;
};

const textEncoder = new TextEncoder();

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifies the full SHA-256 of `html` against `manifest.bundleSha` prefix when present.
 * Note: `packages/plate-engine/lib/engine.mjs` computes `bundleSha` via `sha(html)` which hashes `html + "\0"`,
 * whereas standard SHA-256 hashes `html`. Both deterministic SHA-256 forms are checked against the prefix.
 */
export async function verifyBundleHtmlSha(html: string, bundleShaPrefix?: string | null): Promise<boolean> {
  if (!bundleShaPrefix || typeof bundleShaPrefix !== "string" || !bundleShaPrefix.trim()) {
    return true;
  }
  const prefix = bundleShaPrefix.trim().toLowerCase();
  const plainFull = await sha256Hex(html);
  if (plainFull.startsWith(prefix)) return true;
  const engineFull = await sha256Hex(html + "\0");
  return engineFull.startsWith(prefix);
}

function resolveApiUrl(path: string, baseUrl?: string): string {
  // Written as a plain `process.env.NEXT_PUBLIC_API_URL` member access so Next.js can inline it at build time; the try covers
  // plain browser bundles where `process` does not exist.
  const envBase = (() => { try { return process.env.NEXT_PUBLIC_API_URL; } catch { return undefined; } })();
  const base = (baseUrl ?? envBase ?? "").replace(/\/$/, "");
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if ((base.endsWith("/api/backend") || base.endsWith("/v1")) && normalizedPath.startsWith("/v1/")) {
    return `${base}${normalizedPath.slice(3)}`;
  }
  return `${base}${normalizedPath}`;
}

/**
 * Wraps `fetch` so calls to the app's own backend proxy (`/api/backend/...`, relative or on this page's origin) carry the
 * signed-in user's bearer token, as `apiFetch` in `lib/api.ts` does for every other backend call. Any other URL (the
 * presigned object-storage link of a bundle) is fetched untouched: an Authorization header there would break the presigned
 * signature and trigger a CORS preflight the storage bucket does not allow.
 */
export function withBackendAuth(getToken: () => Promise<string | null | undefined>, baseFetch?: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const doFetch = baseFetch ?? globalThis.fetch;
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path = raw;
    if (/^https?:\/\//i.test(raw)) {
      const origin = typeof location !== "undefined" ? location.origin : undefined;
      path = origin && raw.startsWith(origin + "/") ? raw.slice(origin.length) : "";
    }
    if (!path.startsWith("/api/backend/")) return doFetch(input, init);
    const token = await getToken();
    if (!token) return doFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return doFetch(input, { ...init, headers });
  }) as typeof fetch;
}

type BundleRouteResponse = {
  url: string;
  expiresAt: string;
  bundleDigest: string;
  manifest?: BundleManifest;
  params?: Record<string, unknown>;
  gen?: number;
};

/**
 * Fetches a scene's bundle metadata from `GET /v1/projects/:id/plates/:variantId/bundle`,
 * downloads the HTML from the presigned `url` (refreshing an expired link once), and verifies
 * the HTML's full SHA-256 against `manifest.bundleSha` when present.
 */
export async function fetchBundle(
  projectId: string,
  variantId: string,
  options?: LiveApiOptions
): Promise<FetchedBundle> {
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const now = options?.now ?? (() => Date.now());
  const routeUrl = resolveApiUrl(
    `/v1/projects/${encodeURIComponent(projectId)}/plates/${encodeURIComponent(variantId)}/bundle`,
    options?.baseUrl
  );

  const loadMeta = async (): Promise<BundleRouteResponse> => {
    const res = await fetchImpl(routeUrl, {
      method: "GET",
      headers: { ...(options?.headers ?? {}) },
      cache: "no-store"
    });
    if (!res.ok) {
      throw new Error(`Could not load bundle metadata (${res.status}).`);
    }
    return (await res.json()) as BundleRouteResponse;
  };

  let meta = await loadMeta();
  let refreshed = false;

  const isExpired = (expiresAt: string): boolean => {
    const t = Date.parse(expiresAt);
    return Number.isFinite(t) && t <= now();
  };

  if (isExpired(meta.expiresAt)) {
    meta = await loadMeta();
    refreshed = true;
    if (isExpired(meta.expiresAt)) {
      throw new Error("Presigned bundle link is still expired after refresh.");
    }
  }

  let htmlRes = await fetchImpl(resolveApiUrl(meta.url, options?.baseUrl), { method: "GET" });
  if (!htmlRes.ok && !refreshed && (htmlRes.status === 401 || htmlRes.status === 403 || htmlRes.status === 410)) {
    meta = await loadMeta();
    refreshed = true;
    htmlRes = await fetchImpl(resolveApiUrl(meta.url, options?.baseUrl), { method: "GET" });
  }

  if (!htmlRes.ok) {
    throw new Error(`Could not download bundle HTML (${htmlRes.status}).`);
  }

  const html = await htmlRes.text();
  const manifest: BundleManifest = meta.manifest ?? {};
  const matches = await verifyBundleHtmlSha(html, manifest.bundleSha);
  if (!matches) {
    throw new Error(
      `Bundle SHA-256 verification failed: HTML does not match manifest bundleSha prefix "${manifest.bundleSha}".`
    );
  }

  const matchedUrlGen = BUNDLE_URL_GEN_REGEX.exec(meta.url ?? "");
  const resolvedGen =
    typeof meta.gen === "number" && Number.isInteger(meta.gen) && meta.gen >= 1
      ? meta.gen
      : matchedUrlGen?.[1]
        ? Number(matchedUrlGen[1])
        : undefined;

  return {
    html,
    bundleDigest: meta.bundleDigest,
    manifest,
    params: meta.params ?? {},
    expiresAt: meta.expiresAt,
    url: meta.url,
    ...(resolvedGen !== undefined ? { gen: resolvedGen } : {})
  };
}

/**
 * Posts a fenced browser check report to `POST /v1/projects/:id/plates/:variantId/check` (`host: "worker"`).
 * Treats HTTP 204 as `{ status: "dropped", ok: true, dropped: true }` and never throws on network errors.
 */
export async function reportCheck(
  projectId: string,
  variantId: string,
  payload: CheckReportPayload,
  options?: LiveApiOptions
): Promise<ReportCheckResult> {
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const routeUrl = resolveApiUrl(
    `/v1/projects/${encodeURIComponent(projectId)}/plates/${encodeURIComponent(variantId)}/check`,
    options?.baseUrl
  );

  try {
    const res = await fetchImpl(routeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {})
      },
      body: JSON.stringify({
        gen: payload.gen,
        bundleDigest: payload.bundleDigest,
        host: "worker",
        ...(payload.device ? { device: payload.device } : {}),
        results: payload.results
      })
    });

    if (res.status === 204) {
      return { status: "dropped", ok: true, dropped: true, httpStatus: 204 };
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: { code?: string; message?: string };
    };

    if (res.status === 200) {
      return {
        status: "ok",
        ok: true,
        dropped: false,
        httpStatus: 200,
        ...(typeof body.state === "string" ? { state: body.state } : {}),
        ...(typeof body.repair === "boolean" ? { repair: body.repair } : {}),
        ...(typeof body.fallback === "boolean" ? { fallback: body.fallback } : {}),
        ...(body.playback === "clip" ? { playback: "clip" as const } : {})
      };
    }

    return {
      status: "error",
      ok: false,
      dropped: false,
      httpStatus: res.status,
      code: (typeof body.code === "string" ? body.code : body.error?.code) ?? undefined,
      message: body.error?.message
    };
  } catch (err) {
    return {
      status: "network_error",
      ok: false,
      dropped: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Requests a worker-drawn fallback clip via `POST /v1/projects/:id/plates/:variantId/clip-request`.
 * Surfaces HTTP 429 `clip_cap` as a value (`{ status: "clip_cap", code: "clip_cap", capped: true }`), never an exception.
 */
export async function requestClip(
  projectId: string,
  variantId: string,
  options?: LiveApiOptions
): Promise<RequestClipResult> {
  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const routeUrl = resolveApiUrl(
    `/v1/projects/${encodeURIComponent(projectId)}/plates/${encodeURIComponent(variantId)}/clip-request`,
    options?.baseUrl
  );

  try {
    const res = await fetchImpl(routeUrl, {
      method: "POST",
      headers: { ...(options?.headers ?? {}) }
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: { code?: string; message?: string };
    };

    if (res.status === 202) {
      return { status: "rendering", state: "rendering", ok: true, capped: false, httpStatus: 202 };
    }

    if (res.status === 429) {
      return {
        status: "clip_cap",
        code: "clip_cap",
        state: "clip_cap",
        ok: false,
        capped: true,
        httpStatus: 429,
        message: body.error?.message
      };
    }

    return {
      status: "error",
      ok: false,
      capped: false,
      httpStatus: res.status,
      code: (typeof body.code === "string" ? body.code : body.error?.code) ?? undefined,
      message: body.error?.message
    };
  } catch (err) {
    return {
      status: "network_error",
      ok: false,
      capped: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export interface CheckableHost {
  readonly unhealthy?: boolean;
  readonly errors?: readonly string[];
  init(options?: { scale?: number; params?: Record<string, unknown> }): Promise<HostInitResult>;
  frame(n: number, options?: { includeHash?: boolean; qualitySpec?: unknown; epoch?: number; includeCalibration?: boolean }): Promise<Omit<HostFrameResult, "bytes"> & { bytes?: number | Uint8Array; data?: Uint8Array }>;
  terminateIdle?(reason?: string): void;
}

export type RunCheckOptions = {
  /** Overall visible wall-clock watchdog timeout for a check in milliseconds (default `DEFAULT_CHECK_WATCHDOG_MS` = 10_000 ms). */
  watchdogMs?: number;
  /** Per-frame visible wall-clock budget in milliseconds (default `DEFAULT_FRAME_WATCHDOG_MS` = 2_000 ms). */
  frameWatchdogMs?: number;
  /** Optional `init` watchdog timeout in milliseconds (default `DEFAULT_INIT_WATCHDOG_MS` = 2_000 ms when enforced). */
  initWatchdogMs?: number;
  /** Consecutive over-budget frames required before reporting a frame watchdog timeout (default `MAX_CONSECUTIVE_OVER_BUDGET_FRAMES` = 3). */
  maxConsecutiveOverBudgetFrames?: number;
  /** Preview scale at which to measure slow-draw sample frames (e.g. `640 / 1920`). When provided (or when `measureSlowDraw` is true), draws >= 8 sample frames spread across first, middle, and last thirds and evaluates `isSlowScene`. */
  previewScale?: number;
  /** Quality spec to pass when drawing preview-scale slow-draw sample frames. */
  qualitySpec?: unknown;
  /** Params to pass when re-initialising at `previewScale`. */
  params?: Record<string, unknown>;
  /** Explicitly enable or disable the slow-draw check pass (defaults to `true` when `previewScale` is provided). */
  measureSlowDraw?: boolean;
  /** Optional hook returning whether another Worker draw is concurrently in flight on the page (`> 0` means contended). */
  activeDrawWork?: () => number;
  /** Optional getter for the active host instance (used when `onResetHost` recreates the host on an `init` retry). */
  getHost?: () => CheckableHost | null | undefined;
  /** Optional callback to recreate/reset the host before retrying a timed-out `init` or frame. */
  onResetHost?: () => void;
  /** Optional millisecond clock (default `performance.now`). */
  now?: () => number;
  /** Optional callback invoked with the computed `isSlowScene` decision and raw samples. */
  onSlowSceneEvaluated?: (info: {
    slow: boolean;
    median: number;
    p90: number;
    n: number;
    aloneSamples: number[];
    contendedSamples: number[];
  }) => void;
};

/**
 * Picks at least `minCount` (default 8) sample frame indices spread across the first, middle, and last thirds of `[0, totalFrames - 1]`.
 */
export function buildCheckSampleFrames(totalFrames: number, minCount = 8): number[] {
  const count = Math.max(8, minCount);
  const maxFrame = Math.max(0, Math.floor(totalFrames) - 1);
  if (maxFrame <= 1) {
    return Array.from({ length: count }, () => maxFrame);
  }
  const indices: number[] = [];
  // Spread evenly across first, middle, and last thirds of [1, maxFrame] (since frame 0 was already drawn in pass1/pass2)
  for (let i = 0; i < count; i++) {
    const f = 1 + Math.round((i * (maxFrame - 1)) / Math.max(1, count - 1));
    indices.push(Math.max(1, Math.min(maxFrame, f)));
  }
  return indices;
}

function classifyFailureKind(err: unknown, beforeFirstFrame: boolean): "env" | "code" {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes("unsupported") ||
    msg.includes("unverified") ||
    msg.includes("out of memory") ||
    msg.includes("oom") ||
    msg.includes("allocation failed") ||
    msg.includes("exceeds host byte budget") ||
    msg.includes("timed out waiting for bootstrap iframe") ||
    msg.includes("watchdog") ||
    msg.includes("check-watchdog") ||
    msg.includes("worker terminated") ||
    msg.includes("unhealthy") ||
    msg.includes("crash") ||
    msg.includes("webgl") ||
    msg.includes("context lost")
  ) {
    return "env";
  }
  void beforeFirstFrame;
  return "code";
}

function signatureOfFrame(r: Omit<HostFrameResult, "bytes"> & { bytes?: number | Uint8Array; data?: Uint8Array }): string {
  if (typeof r.hash === "string" && r.hash.length > 0) {
    return r.hash;
  }
  const bm = r.bitmap as unknown as { data?: Uint8Array | number[]; hash?: string; pixels?: Uint8Array | number[] };
  if (bm && typeof bm.hash === "string") return bm.hash;
  const arr = bm?.data ?? bm?.pixels ?? (r.data instanceof Uint8Array ? r.data : typeof r.bytes === "object" && r.bytes instanceof Uint8Array ? r.bytes : null);
  if (arr) {
    let h = 0x811c9dc5;
    for (let i = 0; i < arr.length; i++) {
      h ^= arr[i]!;
      h = Math.imul(h, 0x01000193);
    }
    return `fnv:${(h >>> 0).toString(16)}:len:${arr.length}`;
  }
  return `dim:${r.bitmap?.width ?? 0}x${r.bitmap?.height ?? 0}`;
}

/**
 * Runs the Plan §7 browser check inside the Worker host:
 * 1. `init` succeeds with no uncaught errors.
 * 2. `FILM.meta` matches the manifest (`width`/`W`, `height`/`H`, `fps`, `frames`/`durationFrames`).
 * 3. Frames `0`, `Math.floor(frames / 2)`, and `frames - 1` drawn twice produce identical pixel bytes (determinism).
 * Returns `{ ok: true }`, `{ ok: false, kind: "code", error }` for scene errors, or `{ ok: false, kind: "env" }`
 * when the device could not draw (worker unsupported, OOM, or watchdog termination on the first frame).
 */
export async function runCheck(
  host: CheckableHost | null | undefined,
  expectedMeta: BundleManifest | HostFilmMeta = {},
  options?: RunCheckOptions
): Promise<CheckOutcome> {
  const resolveActiveHost = (): CheckableHost | null | undefined =>
    options?.getHost ? options.getHost() : host;

  const initialHost = resolveActiveHost();
  if (!initialHost) {
    return { ok: false, kind: "env", error: "Worker host is not available on this device." };
  }
  if (initialHost.unhealthy) {
    return { ok: false, kind: "env", error: "Worker host is unhealthy." };
  }

  const now = options?.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const watchdogMs = options?.watchdogMs ?? DEFAULT_CHECK_WATCHDOG_MS;
  const frameBudgetMs = options?.frameWatchdogMs ?? DEFAULT_FRAME_WATCHDOG_MS;
  const maxConsecutiveOverBudget =
    options?.maxConsecutiveOverBudgetFrames ?? MAX_CONSECUTIVE_OVER_BUDGET_FRAMES;

  let sawHidden = isDocumentHidden();
  let visibleElapsedMs = 0;
  let consecutiveOverBudgetFrames = 0;
  let initRetriesUsed = 0;
  let overBudgetExhausted = false;

  const checkHidden = (): boolean => {
    if (isDocumentHidden()) {
      sawHidden = true;
    }
    return sawHidden;
  };

  const onVisibilityChange = () => {
    sawHidden = true;
  };

  const doc = (
    globalThis as {
      document?: {
        addEventListener?: (t: string, cb: () => void) => void;
        removeEventListener?: (t: string, cb: () => void) => void;
      };
    }
  ).document;
  if (doc && typeof doc.addEventListener === "function") {
    try {
      doc.addEventListener("visibilitychange", onVisibilityChange);
    } catch {}
  }

  const makeInconclusiveOutcome = (error?: string): CheckOutcome => ({
    ok: false,
    kind: "inconclusive",
    inconclusive: true,
    reason: "document-hidden",
    ...(error ? { error } : {})
  });

  const nonTimeoutHostErrors = (): readonly string[] => {
    const h = resolveActiveHost();
    if (!h?.errors || h.errors.length === 0) return [];
    return h.errors.filter((e) => !isWatchdogTimeoutError(e));
  };

  const runInitWithOneRetry = async (initOpts: {
    scale?: number;
    params?: Record<string, unknown>;
  }): Promise<HostInitResult> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      checkHidden();
      const t0 = now();
      let initTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        const activeHost = resolveActiveHost();
        if (!activeHost) throw new Error("Worker host is not available on this device.");
        const initCall = activeHost.init(initOpts);
        const res =
          typeof options?.initWatchdogMs === "number" && options.initWatchdogMs > 0
            ? await Promise.race([
                initCall,
                new Promise<HostInitResult>((_res, rej) => {
                  initTimer = setTimeout(() => {
                    rej(new Error(`Watchdog timeout (init-timeout) after ${options.initWatchdogMs}ms`));
                  }, options.initWatchdogMs);
                })
              ])
            : await initCall;
        const wallMs = Math.max(0, now() - t0);
        if (!checkHidden()) {
          visibleElapsedMs += wallMs;
        }
        return res;
      } catch (err) {
        const wallMs = Math.max(0, now() - t0);
        if (!checkHidden()) {
          visibleElapsedMs += wallMs;
        }
        lastErr = err;
        if (checkHidden()) {
          throw err;
        }
        if (attempt === 0 && isInitTimeoutError(err)) {
          initRetriesUsed += 1;
          try {
            options?.onResetHost?.();
          } catch {}
          continue;
        }
        throw err;
      } finally {
        if (initTimer !== null) {
          clearTimeout(initTimer);
        }
      }
    }
    throw lastErr;
  };

  const drawFrameWithWatchdog = async (
    n: number,
    frameOpts?: { includeHash?: boolean; qualitySpec?: unknown; epoch?: number; includeCalibration?: boolean }
  ): Promise<Omit<HostFrameResult, "bytes"> & { bytes?: number | Uint8Array; data?: Uint8Array; drawMs?: number }> => {
    while (true) {
      checkHidden();
      const t0 = now();
      try {
        const activeHost = resolveActiveHost();
        if (!activeHost) throw new Error("Worker host is not available on this device.");
        const r = await activeHost.frame(n, frameOpts);
        const wallMs = Math.max(0, now() - t0);
        if (checkHidden()) {
          try {
            r.bitmap?.close?.();
          } catch {}
          throw new Error("Check inconclusive: document was hidden or visibility changed during frame draw.");
        }
        const reportedDrawMs = typeof r.drawMs === "number" && r.drawMs > 0 ? r.drawMs : 0;
        const effectiveFrameMs = Math.max(wallMs, reportedDrawMs);
        visibleElapsedMs += wallMs;
        if (effectiveFrameMs > frameBudgetMs) {
          consecutiveOverBudgetFrames += 1;
          if (
            consecutiveOverBudgetFrames >= maxConsecutiveOverBudget ||
            (watchdogMs > 0 && visibleElapsedMs >= watchdogMs)
          ) {
            overBudgetExhausted = true;
            try {
              r.bitmap?.close?.();
            } catch {}
            throw new Error(
              `Watchdog timeout (frame-timeout) after ${consecutiveOverBudgetFrames} consecutive over-budget frames (${Math.round(effectiveFrameMs)}ms > ${frameBudgetMs}ms, visible ${Math.round(visibleElapsedMs)}ms)`
            );
          }
        } else {
          consecutiveOverBudgetFrames = 0;
        }
        if (watchdogMs > 0 && visibleElapsedMs >= watchdogMs) {
          overBudgetExhausted = true;
          try {
            r.bitmap?.close?.();
          } catch {}
          throw new Error(`Check watchdog timeout (check-watchdog) after ${Math.round(visibleElapsedMs)}ms of visible time`);
        }
        return r;
      } catch (err) {
        const wallMs = Math.max(0, now() - t0);
        if (checkHidden()) {
          throw err;
        }
        visibleElapsedMs += Math.max(wallMs, isWatchdogTimeoutError(err) ? frameBudgetMs : 0);
        const activeHost = resolveActiveHost();
        const hasHostErrors = Boolean(activeHost?.errors && activeHost.errors.length > 0);
        if (
          !overBudgetExhausted &&
          isWatchdogTimeoutError(err) &&
          !isInitTimeoutError(err) &&
          !hasHostErrors
        ) {
          consecutiveOverBudgetFrames += 1;
          if (
            consecutiveOverBudgetFrames < maxConsecutiveOverBudget &&
            !(watchdogMs > 0 && visibleElapsedMs >= watchdogMs)
          ) {
            try {
              options?.onResetHost?.();
            } catch {}
            continue;
          }
          overBudgetExhausted = true;
        }
        throw err;
      }
    }
  };

  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const checkPromise = (async (): Promise<CheckOutcome> => {
    let initRes: HostInitResult;
    try {
      initRes = await runInitWithOneRetry({ scale: 1 });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (checkHidden() && isWatchdogTimeoutError(err)) {
        return makeInconclusiveOutcome(error);
      }
      const kind = classifyFailureKind(err, true);
      if (checkHidden() && kind !== "env") {
        return makeInconclusiveOutcome(error);
      }
      return kind === "env"
        ? {
            ok: false,
            kind: "env",
            error,
            ...(initRetriesUsed > 0 ? { initRetries: initRetriesUsed } : {})
          }
        : { ok: false, kind: "code", error };
    }

    const initErrors = nonTimeoutHostErrors();
    if (initErrors.length > 0) {
      return { ok: false, kind: "code", error: initErrors[0]! };
    }

    const m = initRes.meta ?? ({} as HostFilmMeta);
    const actualW = m.W ?? m.width ?? initRes.w;
    const actualH = m.H ?? m.height ?? initRes.h;
    const actualFps = m.fps;
    const actualFrames = m.durationFrames ?? m.frames;

    const wantW = expectedMeta.width ?? expectedMeta.W;
    const wantH = expectedMeta.height ?? expectedMeta.H;
    const wantFps = expectedMeta.fps;
    const wantFrames = expectedMeta.frames ?? expectedMeta.durationFrames;

    if (wantW !== undefined && actualW !== wantW) {
      return { ok: false, kind: "code", error: `Width mismatch: scene reported ${actualW}, manifest expected ${wantW}.` };
    }
    if (wantH !== undefined && actualH !== wantH) {
      return { ok: false, kind: "code", error: `Height mismatch: scene reported ${actualH}, manifest expected ${wantH}.` };
    }
    if (wantFps !== undefined && actualFps !== wantFps) {
      return { ok: false, kind: "code", error: `FPS mismatch: scene reported ${actualFps}, manifest expected ${wantFps}.` };
    }
    if (wantFrames !== undefined && actualFrames !== wantFrames) {
      return { ok: false, kind: "code", error: `Frames mismatch: scene reported ${actualFrames}, manifest expected ${wantFrames}.` };
    }

    const totalFrames = Math.max(1, Number(actualFrames ?? wantFrames ?? 90));
    const midFrame = Math.floor(totalFrames / 2);
    const lastFrame = Math.max(0, totalFrames - 1);
    const samples = [...new Set([0, midFrame, lastFrame])];

    const pass1 = new Map<number, string>();
    let drewFirstFrame = false;

    try {
      for (const f of samples) {
        const r1 = await drawFrameWithWatchdog(f, { includeHash: true });
        drewFirstFrame = true;
        pass1.set(f, signatureOfFrame(r1));
        try {
          r1.bitmap?.close?.();
        } catch {}
      }

      for (const f of samples) {
        const r2 = await drawFrameWithWatchdog(f, { includeHash: true });
        const sig2 = signatureOfFrame(r2);
        try {
          r2.bitmap?.close?.();
        } catch {}
        const sig1 = pass1.get(f);
        if (sig1 !== sig2) {
          // A mismatch can be the browser changing raster path under load (for example a GPU canvas falling back to software while
          // several scenes are checked at once), which says nothing about the scene's code and must never start a paid repair.
          // Draw the frame twice more, one after the other: a scene whose code is really non-deterministic keeps disagreeing with
          // itself; a transient raster change settles.
          const r3 = await drawFrameWithWatchdog(f, { includeHash: true });
          const sig3 = signatureOfFrame(r3);
          try { r3.bitmap?.close?.(); } catch {}
          const r4 = await drawFrameWithWatchdog(f, { includeHash: true });
          const sig4 = signatureOfFrame(r4);
          try { r4.bitmap?.close?.(); } catch {}
          if (sig3 !== sig4) {
            return {
              ok: false,
              kind: "code",
              error: `Non-deterministic draw on frame ${f} (${sig1} !== ${sig2}, and again ${sig3} !== ${sig4}).`
            };
          }
          pass1.set(f, sig4);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (checkHidden() && (isWatchdogTimeoutError(err) || error.includes("Check inconclusive"))) {
        return makeInconclusiveOutcome(error);
      }
      const kind = classifyFailureKind(err, !drewFirstFrame);
      if (checkHidden() && kind !== "env") {
        return makeInconclusiveOutcome(error);
      }
      return kind === "env"
        ? {
            ok: false,
            kind: "env",
            error,
            ...(initRetriesUsed > 0 ? { initRetries: initRetriesUsed } : {}),
            ...(overBudgetExhausted ? { overBudgetExhausted: true } : {})
          }
        : { ok: false, kind: "code", error };
    }

    const detErrors = nonTimeoutHostErrors();
    if (detErrors.length > 0) {
      return { ok: false, kind: "code", error: detErrors[0]! };
    }

    const shouldMeasureSlowDraw =
      options?.measureSlowDraw ?? (typeof options?.previewScale === "number" && options.previewScale > 0);

    if (shouldMeasureSlowDraw) {
      const previewScale =
        typeof options?.previewScale === "number" && options.previewScale > 0 ? options.previewScale : 1;
      const sampleFrames = buildCheckSampleFrames(totalFrames, 8);
      const rawAlone: number[] = [];
      const rawContended: number[] = [];

      try {
        if (previewScale !== 1 || options?.params) {
          await runInitWithOneRetry({
            scale: previewScale,
            ...(options?.params ? { params: options.params } : {})
          });
        }
        // Draw at least 8 sample frames spread across the scene (first, middle, last third) at the preview scale,
        // and ignore the first sample (`i === 0`) so shader compile / first draw never marks a fast scene slow.
        const framesToDraw = sampleFrames;
        for (let i = 0; i < framesToDraw.length; i++) {
          const fn = framesToDraw[i]!;
          const contendedBefore = (options?.activeDrawWork?.() ?? 0) > 0;
          const t0 = now();
          const rf = await drawFrameWithWatchdog(fn, {
            ...(options?.qualitySpec !== undefined ? { qualitySpec: options.qualitySpec } : {})
          });
          const elapsed = now() - t0;
          const drawMs = typeof rf.drawMs === "number" && rf.drawMs > 0 ? rf.drawMs : Math.max(0, elapsed);
          const contendedAfter = (options?.activeDrawWork?.() ?? 0) > 0;
          try {
            rf.bitmap?.close?.();
          } catch {}
          // Never mark slow from the first frame only (shader compile / first draw is slow): ignore the first sample (i === 0).
          if (i === 0) continue;
          if (contendedBefore || contendedAfter) {
            rawContended.push(drawMs);
          } else {
            rawAlone.push(drawMs);
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (checkHidden() && (isWatchdogTimeoutError(err) || error.includes("Check inconclusive"))) {
          return makeInconclusiveOutcome(error);
        }
        const kind = classifyFailureKind(err, false);
        if (checkHidden() && kind !== "env") {
          return makeInconclusiveOutcome(error);
        }
        return kind === "env"
          ? {
              ok: false,
              kind: "env",
              error,
              ...(initRetriesUsed > 0 ? { initRetries: initRetriesUsed } : {}),
              ...(overBudgetExhausted ? { overBudgetExhausted: true } : {})
            }
          : { ok: false, kind: "code", error };
      }

      const slowErrors = nonTimeoutHostErrors();
      if (slowErrors.length > 0) {
        return { ok: false, kind: "code", error: slowErrors[0]! };
      }

      if (checkHidden()) {
        return makeInconclusiveOutcome("Check ran while document was hidden or visibility changed.");
      }

      // `isSlowScene` is a local helper for the trace log and tests; its numbers (60 ms median / 80 ms p90)
      // mirror the server's constants, and the server (`POST .../check`) is the single decision point.
      // Always report a successful check (`ok: true`) with `drawMs = { medianMs, p90Ms }`; keep `kind: "env"` for real device failures only.
      const slowDecision = isSlowScene(rawAlone, {
        contendedSamplesMs: rawContended
      });
      options?.onSlowSceneEvaluated?.({
        ...slowDecision,
        aloneSamples: rawAlone,
        contendedSamples: rawContended
      });

      const drawMs = { medianMs: slowDecision.median, p90Ms: slowDecision.p90 };
      return {
        ok: true,
        drawMs,
        drawMsMedian: slowDecision.median,
        drawMsP90: slowDecision.p90,
        ...(initRetriesUsed > 0 ? { initRetries: initRetriesUsed } : {}),
        results: {
          drawMs,
          drawMsMedian: slowDecision.median,
          drawMsP90: slowDecision.p90
        }
      };
    }

    if (checkHidden()) {
      return makeInconclusiveOutcome("Check ran while document was hidden or visibility changed.");
    }

    return {
      ok: true,
      ...(initRetriesUsed > 0 ? { initRetries: initRetriesUsed } : {})
    };
  })();

  if (!(watchdogMs > 0)) {
    try {
      return await checkPromise;
    } finally {
      if (doc && typeof doc.removeEventListener === "function") {
        try {
          doc.removeEventListener("visibilitychange", onVisibilityChange);
        } catch {}
      }
    }
  }

  let checkFinished = false;
  let lastWatchdogTickMs = now();
  let accumulatedVisibleWatchdogMs = 0;

  const timeoutPromise = new Promise<CheckOutcome>((resolve) => {
    const scheduleWatchdogTick = (delayMs: number) => {
      watchdogTimer = setTimeout(() => {
        if (checkFinished) return;
        const curMs = now();
        const dt = Math.max(0, curMs - lastWatchdogTickMs);
        lastWatchdogTickMs = curMs;
        if (checkHidden()) {
          try {
            resolveActiveHost()?.terminateIdle?.("check-watchdog");
          } catch {}
          resolve(makeInconclusiveOutcome(`Check watchdog timeout while tab was hidden (${watchdogMs}ms)`));
          return;
        }
        accumulatedVisibleWatchdogMs += Math.max(dt, delayMs);
        if (accumulatedVisibleWatchdogMs >= watchdogMs) {
          try {
            resolveActiveHost()?.terminateIdle?.("check-watchdog");
          } catch {}
          resolve({
            ok: false,
            kind: "env",
            overBudgetExhausted: true,
            error: `Check watchdog timeout (check-watchdog) after ${watchdogMs}ms`
          });
          return;
        }
        scheduleWatchdogTick(Math.max(50, watchdogMs - accumulatedVisibleWatchdogMs));
      }, delayMs);
    };
    scheduleWatchdogTick(watchdogMs);
  });

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } finally {
    checkFinished = true;
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
    }
    if (doc && typeof doc.removeEventListener === "function") {
      try {
        doc.removeEventListener("visibilitychange", onVisibilityChange);
      } catch {}
    }
  }
}
