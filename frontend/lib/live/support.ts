/**
 * Environment support and verified-browser matrix (docs/LIVE_SCENES_PLAN.md §0b, §10, §20).
 *
 * Live preview runs only on environments that (1) provide all required browser APIs (`Worker`,
 * `OffscreenCanvas` 2D, `createImageBitmap`, and sandboxed `srcdoc` iframes) AND (2) appear on
 * the explicit `VERIFIED_ENVIRONMENTS` list. Unverified or unsupported environments always fall
 * back to the worker-drawn clip ("untested" never means "try anyway").
 */

export type EnvironmentStatus = "verified" | "unverified" | "unsupported";

export type DesktopOS = "macOS" | "Windows" | "Linux";
export type PlatformOS = DesktopOS | "iOS" | "Android" | "other";
export type BrowserFamily = "chromium" | "safari" | "firefox" | "other";

export type VerifiedEnvironmentEntry = {
  id: string;
  browser: BrowserFamily;
  os: DesktopOS;
  device: "desktop";
  minVersion: number;
};

/**
 * Explicit verified-environment list as data.
 * Chrome and Chromium-based browsers at version 120 or newer on desktop only (macOS, Windows, Linux)
 * are `verified`; Safari, Firefox, iOS and Android remain `unverified` until measured results are added.
 */
export const VERIFIED_ENVIRONMENTS: readonly VerifiedEnvironmentEntry[] = Object.freeze([
  { id: "chromium-macos-desktop", browser: "chromium", os: "macOS", device: "desktop", minVersion: 120 },
  { id: "chromium-windows-desktop", browser: "chromium", os: "Windows", device: "desktop", minVersion: 120 },
  { id: "chromium-linux-desktop", browser: "chromium", os: "Linux", device: "desktop", minVersion: 120 }
]);

export type FeatureSet = {
  worker: boolean;
  offscreenCanvas2d: boolean;
  createImageBitmap: boolean;
  sandboxedSrcdocIframe: boolean;
};

export type EnvironmentProbeInput = {
  userAgent?: string;
  features?: Partial<FeatureSet> | boolean;
  worker?: boolean;
  offscreenCanvas2d?: boolean;
  createImageBitmap?: boolean;
  sandboxedSrcdocIframe?: boolean;
  scope?: Record<string, unknown>;
};

export type ParsedUserAgent = {
  browser: BrowserFamily;
  version: number;
  os: PlatformOS;
  device: "desktop" | "mobile";
};

export function parseUserAgent(ua: string): ParsedUserAgent {
  const s = String(ua ?? "");
  let os: PlatformOS = "other";
  let device: "desktop" | "mobile" = "desktop";

  // Check mobile / tablet / iOS / Android tokens first (before generic "Linux" or "Mac OS X")
  if (/iPhone|iPad|iPod/i.test(s) || (/Macintosh/i.test(s) && /Mobile\//i.test(s))) {
    os = "iOS";
    device = "mobile";
  } else if (/Android/i.test(s)) {
    os = "Android";
    device = "mobile";
  } else if (/Mobile|Tablet|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(s)) {
    device = "mobile";
    if (/Windows/i.test(s)) os = "Windows";
    else if (/Linux/i.test(s)) os = "Linux";
    else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  } else if (/Macintosh|Mac OS X/i.test(s)) {
    os = "macOS";
    device = "desktop";
  } else if (/Windows NT/i.test(s)) {
    os = "Windows";
    device = "desktop";
  } else if (/Linux|X11/i.test(s) && !/CrOS/i.test(s)) {
    os = "Linux";
    device = "desktop";
  }

  let browser: BrowserFamily = "other";
  let version = 0;

  if (/Firefox\/(\d+)|FxiOS\/(\d+)/i.test(s)) {
    const m = /Firefox\/(\d+)|FxiOS\/(\d+)/i.exec(s);
    browser = "firefox";
    version = Number(m?.[1] ?? m?.[2] ?? 0);
  } else if (/CriOS\/(\d+)/i.test(s)) {
    // Chrome on iOS uses WebKit under the hood; classified on iOS (unverified)
    const m = /CriOS\/(\d+)/i.exec(s);
    browser = "chromium";
    version = Number(m?.[1] ?? 0);
  } else if (/(?:HeadlessChrome|Chrome|Chromium)\/(\d+)/i.test(s)) {
    const m = /(?:HeadlessChrome|Chrome|Chromium)\/(\d+)/i.exec(s);
    browser = "chromium";
    version = Number(m?.[1] ?? 0);
  } else if (/Safari\//i.test(s)) {
    const m = /Version\/(\d+)/i.exec(s);
    browser = "safari";
    version = Number(m?.[1] ?? 0);
  }

  return { browser, version, os, device };
}

export function detectHostFeatures(scope: Record<string, unknown> = globalThis as Record<string, unknown>): FeatureSet {
  const worker = typeof scope.Worker === "function";
  const createImageBitmap = typeof scope.createImageBitmap === "function";

  let offscreenCanvas2d = false;
  try {
    const OC = scope.OffscreenCanvas as (new (w: number, h: number) => { getContext: (id: string) => unknown }) | undefined;
    if (typeof OC === "function") {
      const c = new OC(1, 1);
      offscreenCanvas2d = Boolean(c && typeof c.getContext === "function" && c.getContext("2d"));
    }
  } catch {
    offscreenCanvas2d = false;
  }

  let sandboxedSrcdocIframe = false;
  try {
    const doc = scope.document as { createElement?: (tag: string) => Record<string, unknown> } | undefined;
    if (doc && typeof doc.createElement === "function") {
      const iframe = doc.createElement("iframe");
      sandboxedSrcdocIframe = Boolean(iframe && "sandbox" in iframe && "srcdoc" in iframe);
    }
  } catch {
    sandboxedSrcdocIframe = false;
  }

  return { worker, offscreenCanvas2d, createImageBitmap, sandboxedSrcdocIframe };
}

function resolveFeatureSupport(input?: string | EnvironmentProbeInput): boolean {
  if (input === undefined) {
    const f = detectHostFeatures();
    return f.worker && f.offscreenCanvas2d && f.createImageBitmap && f.sandboxedSrcdocIframe;
  }
  if (typeof input === "string") {
    return true;
  }
  if (input.features === false) return false;
  if (input.features === true) return true;

  const hasExplicitFlags =
    input.worker !== undefined ||
    input.offscreenCanvas2d !== undefined ||
    input.createImageBitmap !== undefined ||
    input.sandboxedSrcdocIframe !== undefined ||
    (typeof input.features === "object" && input.features !== null);

  if (hasExplicitFlags) {
    const sub = typeof input.features === "object" && input.features !== null ? input.features : {};
    const worker = input.worker ?? sub.worker ?? true;
    const offscreenCanvas2d = input.offscreenCanvas2d ?? sub.offscreenCanvas2d ?? true;
    const createImageBitmap = input.createImageBitmap ?? sub.createImageBitmap ?? true;
    const sandboxedSrcdocIframe = input.sandboxedSrcdocIframe ?? sub.sandboxedSrcdocIframe ?? true;
    return Boolean(worker && offscreenCanvas2d && createImageBitmap && sandboxedSrcdocIframe);
  }

  if (input.scope) {
    const f = detectHostFeatures(input.scope);
    return f.worker && f.offscreenCanvas2d && f.createImageBitmap && f.sandboxedSrcdocIframe;
  }

  if (input.userAgent !== undefined) {
    return true;
  }

  const f = detectHostFeatures();
  return f.worker && f.offscreenCanvas2d && f.createImageBitmap && f.sandboxedSrcdocIframe;
}

/**
 * Classifies the current or provided environment into `"verified"`, `"unverified"`, or `"unsupported"`.
 * - `"unsupported"`: required Worker / OffscreenCanvas 2D / createImageBitmap / sandboxed srcdoc iframe APIs are missing.
 * - `"verified"`: APIs are present AND the user agent matches `VERIFIED_ENVIRONMENTS` (Chromium >= 120 on desktop macOS, Windows, Linux).
 * - `"unverified"`: APIs are present, but the browser/OS is Safari, Firefox, iOS, Android, older Chromium, or otherwise untested.
 */
export function environmentStatus(input?: string | EnvironmentProbeInput): EnvironmentStatus {
  if (!resolveFeatureSupport(input)) {
    return "unsupported";
  }

  const ua =
    typeof input === "string"
      ? input
      : input?.userAgent !== undefined
        ? input.userAgent
        : (input?.scope?.navigator as { userAgent?: string } | undefined)?.userAgent ??
          (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ??
          "";

  if (!ua.trim()) {
    return "unverified";
  }

  const parsed = parseUserAgent(ua);
  const matched = VERIFIED_ENVIRONMENTS.some(
    (entry) =>
      entry.browser === parsed.browser &&
      entry.os === parsed.os &&
      entry.device === parsed.device &&
      parsed.version >= entry.minVersion
  );

  return matched ? "verified" : "unverified";
}

/**
 * Returns true only when all Worker-host features exist AND `environmentStatus()` is `"verified"`.
 * Unsupported or unverified environments always return false ("use the clip", never "try anyway").
 */
export function supportsWorkerHost(input?: string | EnvironmentProbeInput): boolean {
  if (input === undefined) {
    const f = detectHostFeatures();
    if (!(f.worker && f.offscreenCanvas2d && f.createImageBitmap && f.sandboxedSrcdocIframe)) {
      return false;
    }
    return environmentStatus() === "verified";
  }
  return resolveFeatureSupport(input) && environmentStatus(input) === "verified";
}

/**
 * Byte budget (`LIVE_CACHE_MB` in docs/LIVE_SCENES_PLAN.md §6):
 * 160 MB default, 80 MB when `navigator.deviceMemory <= 4`, 60 MB on iOS.
 */
export function resolveCacheBudgetMB(options?: {
  userAgent?: string;
  deviceMemory?: number | null;
  liveCacheMB?: number;
}): number {
  if (typeof options?.liveCacheMB === "number" && options.liveCacheMB > 0) {
    return options.liveCacheMB;
  }
  const nav = (globalThis as { navigator?: { userAgent?: string; deviceMemory?: number } }).navigator;
  const ua = options?.userAgent ?? nav?.userAgent ?? "";
  if (parseUserAgent(ua).os === "iOS") {
    return 60;
  }
  const mem = options?.deviceMemory !== undefined ? options.deviceMemory : (nav?.deviceMemory ?? null);
  if (typeof mem === "number" && mem > 0 && mem <= 4) {
    return 80;
  }
  return 160;
}

export function resolveCacheBudgetBytes(options?: {
  userAgent?: string;
  deviceMemory?: number | null;
  liveCacheMB?: number;
}): number {
  return resolveCacheBudgetMB(options) * 1024 * 1024;
}

/**
 * Bounded shared RAM cache budget for Draft preview mode (§3.1 & §5.3 of TASK-draft-preview-integration.md):
 * 32 MiB default across the film (~36 raw 640×360 RGBA frames), 24 MiB on low-memory devices.
 */
export function resolveDraftCacheBudgetMB(options?: {
  userAgent?: string;
  deviceMemory?: number | null;
  draftCacheMB?: number;
}): number {
  if (typeof options?.draftCacheMB === "number" && options.draftCacheMB > 0) {
    return options.draftCacheMB;
  }
  const nav = (globalThis as { navigator?: { userAgent?: string; deviceMemory?: number } }).navigator;
  const mem = options?.deviceMemory !== undefined ? options.deviceMemory : (nav?.deviceMemory ?? null);
  if (typeof mem === "number" && mem > 0 && mem <= 4) {
    return 24;
  }
  return 32;
}

export function resolveDraftCacheBudgetBytes(options?: {
  userAgent?: string;
  deviceMemory?: number | null;
  draftCacheMB?: number;
}): number {
  return resolveDraftCacheBudgetMB(options) * 1024 * 1024;
}
