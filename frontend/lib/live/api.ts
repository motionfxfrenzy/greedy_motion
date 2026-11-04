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

/**
 * Extracts the variant generation (`gen`) from a presigned bundle URL (`.../g<gen>/bundle.html`),
 * falling back to `fallbackGen` (default `1`).
 */
export function parseGenFromBundleUrl(url?: string | null, fallbackGen = 1): number {
  if (typeof url === "string" && url.length > 0) {
    const m = /(?:\/|%2F)g(\d+)(?:\/|%2F)bundle\.html/i.exec(url);
    if (m && m[1]) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1) return n;
    }
  }
  return Number.isInteger(fallbackGen) && fallbackGen >= 1 ? fallbackGen : 1;
}

export type CheckOutcome =
  | { ok: true }
  | { ok: false; kind: "code"; error: string }
  | { ok: false; kind: "env"; error?: string };

export type CheckReportPayload = {
  gen: number;
  bundleDigest: string;
  results: CheckOutcome;
  device?: Record<string, unknown>;
};

export type ReportCheckResult =
  | { status: "ok"; ok: true; dropped: false; httpStatus: 200; state?: string; repair?: boolean; fallback?: boolean }
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

  const matchedUrlGen = /(?:\/|%2F)g(\d+)(?:\/|%2F)bundle\.html/i.exec(meta.url ?? "");
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
        ...(typeof body.fallback === "boolean" ? { fallback: body.fallback } : {})
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
  frame(n: number, options?: { includeHash?: boolean }): Promise<Omit<HostFrameResult, "bytes"> & { bytes?: number | Uint8Array; data?: Uint8Array }>;
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
    msg.includes("timed out waiting for bootstrap iframe")
  ) {
    return "env";
  }
  if (beforeFirstFrame && (msg.includes("watchdog") || msg.includes("worker terminated") || msg.includes("unhealthy"))) {
    return "env";
  }
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
  expectedMeta: BundleManifest | HostFilmMeta
): Promise<CheckOutcome> {
  if (!host) {
    return { ok: false, kind: "env", error: "Worker host is not available on this device." };
  }
  if (host.unhealthy) {
    return { ok: false, kind: "env", error: "Worker host is unhealthy." };
  }

  let initRes: HostInitResult;
  try {
    initRes = await host.init({ scale: 1 });
  } catch (err) {
    const kind = classifyFailureKind(err, true);
    const error = err instanceof Error ? err.message : String(err);
    return kind === "env" ? { ok: false, kind: "env", error } : { ok: false, kind: "code", error };
  }

  if (host.errors && host.errors.length > 0) {
    return { ok: false, kind: "code", error: host.errors[0]! };
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
      const r1 = await host.frame(f, { includeHash: true });
      drewFirstFrame = true;
      pass1.set(f, signatureOfFrame(r1));
      try {
        r1.bitmap?.close?.();
      } catch {}
    }

    for (const f of samples) {
      const r2 = await host.frame(f, { includeHash: true });
      const sig2 = signatureOfFrame(r2);
      try {
        r2.bitmap?.close?.();
      } catch {}
      const sig1 = pass1.get(f);
      if (sig1 !== sig2) {
        return {
          ok: false,
          kind: "code",
          error: `Non-deterministic draw on frame ${f} (${sig1} !== ${sig2}).`
        };
      }
    }
  } catch (err) {
    const kind = classifyFailureKind(err, !drewFirstFrame);
    const error = err instanceof Error ? err.message : String(err);
    return kind === "env" ? { ok: false, kind: "env", error } : { ok: false, kind: "code", error };
  }

  if (host.errors && host.errors.length > 0) {
    return { ok: false, kind: "code", error: host.errors[0]! };
  }

  return { ok: true };
}
