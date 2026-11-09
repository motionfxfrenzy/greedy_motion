// Plate scenes, worker half. Consumes:
//   plate-render { variantId, gen }  verify one authored scene bundle in Chromium, draw its frames, publish the clip (preview fallback & clip mode)
//   plate-export { exportId }        verify, draw/cache missing clips, and assemble a companion export from the frozen manifest
// and runs the same manifest-driven verifier, drawer, cache and assembler for the billed final render (render-video input kind "plate-film").
//
// The worker shares nothing with the backend but job-control operations and object-storage keys. Every write is fenced:
//   gen              the row was reset (inputs changed): a worker holding an older gen is dropped, never published
//   render_attempt   raised by each claim; publication is conditional on it, so a stale worker cannot publish over a newer one
//   attempt          render_jobs / plate_exports attempt number fencing clip.record, progress, and finish/ready
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, dirname } from "node:path";
import sharp from "sharp";
import { run } from "./compose.mjs";
import { DISK_FULL_CODE, DISK_FULL_MESSAGE, cleanTempScratchDirs, deleteOutputs, downloadPlateInput, downloadPlateOutput, isDiskFullError, plateKeyOk, uploadPlateOutput, wrapDiskFull } from "./storage.mjs";

export const PLATE_RENDER_QUEUE = "plate-render";
export const PLATE_EXPORT_QUEUE = "plate-export";
export const PLATE_REBUNDLE_QUEUE = "plate-rebundle";
const AUTHOR_QUEUE = "plate-author";
const UUID = /^[a-f0-9-]{36}$/i;
const FPS = 30;
const PROJECT_CAP = Number.parseInt(process.env.PLATE_PROJECT_CAP ?? "16", 10);
const STALE_SECONDS = Number.parseInt(process.env.PLATE_STALE_SECONDS ?? "60", 10);
const MAX_AUTHOR_CALLS = Number.parseInt(process.env.PLATE_MAX_AUTHOR_CALLS ?? "3", 10);
const RENDER_WORKERS = Math.max(1, Number.parseInt(process.env.PLATE_FRAME_WORKERS ?? "2", 10));
const PLATE_DRAW_CONCURRENCY = Math.max(1, Number.parseInt(process.env.PLATE_CONCURRENCY ?? "2", 10));

/** Default 120 s per scene check, env-overridable via PLATE_CHECK_TIMEOUT_MS / PLATE_CHECK_TIMEOUT_SECONDS / PLATE_VERIFY_TIMEOUT_MS. */
export function getCheckTimeoutMs() {
  const ms = Number(process.env.PLATE_CHECK_TIMEOUT_MS ?? process.env.PLATE_VERIFY_TIMEOUT_MS);
  if (Number.isFinite(ms) && ms > 0) return ms;
  const sec = Number(process.env.PLATE_CHECK_TIMEOUT_SECONDS);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return 120_000;
}

/** Default 10 min (600 s) per scene draw, env-overridable via PLATE_DRAW_TIMEOUT_MS / PLATE_DRAW_TIMEOUT_SECONDS. */
export function getDrawTimeoutMs() {
  const ms = Number(process.env.PLATE_DRAW_TIMEOUT_MS);
  if (Number.isFinite(ms) && ms > 0) return ms;
  const sec = Number(process.env.PLATE_DRAW_TIMEOUT_SECONDS);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return 10 * 60_000;
}

const VERIFY_TIMEOUT_MS = getCheckTimeoutMs();
const DRAW_TIMEOUT_MS = getDrawTimeoutMs();
const FRAME_STALL_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.PLATE_FRAME_STALL_TIMEOUT_MS ?? String(DRAW_TIMEOUT_MS), 10));
const SFX_DIR = join(import.meta.dirname, "..", "templates", "beat-plan", "sfx");

const log = (level, event, fields = {}) => console.log(JSON.stringify({ level, event, ...fields }));
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

/** An input that can never work: do not retry. worker.mjs turns it into its PermanentError. */
export class InputError extends Error {
  constructor(message, code = "render_invalid") {
    super(message);
    this.code = code;
    this.permanent = true;
  }
}

/** A scene bundle that failed digest or browser verification before drawing: non-retriable, names the scene, triggers refund. */
export class SceneNeedsFixError extends InputError {
  constructor(sceneIndex, detail) {
    const clean = String(detail || "verification failed").slice(0, 600);
    const prefix = `Scene ${Number(sceneIndex) + 1}`;
    const msg = clean.toLowerCase().includes(prefix.toLowerCase()) ? clean : `${prefix} needs a fix before rendering: ${clean}`;
    super(msg, "scene_needs_fix");
    this.sceneIndex = Number(sceneIndex);
  }
}

/** Non-software WebGL renderer detected on the worker: refuse to draw and retry on another worker. */
export class GpuPathDetectedError extends Error {
  constructor(renderer) {
    super(`Refusing to draw on non-software GL renderer: ${renderer || "unknown"}`);
    this.code = "gpu_path_detected";
    this.renderer = renderer || "unknown";
    this.permanent = false;
  }
}

// ================================================================ digest & GL helpers
/** Deterministic, key-sorted JSON serialisation (identical to backend/src/plates/digest.ts). */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export function paramsDigest(params) {
  return sha256Hex(canonicalJson(params ?? {}));
}

export function fontSetDigest(fontSet = "fonts:none") {
  return sha256Hex(fontSet);
}

/**
 * SHA-256 hex of `[bundleSha, paramsDigest(params), fontSetDigest, engineDigest].join("|")`.
 * Note that `bundleScene` in `packages/plate-engine/lib/engine.mjs` computes `bundleSha` as `sha256(html + "\0").slice(0, 24)`.
 */
export function bundleDigest(input = {}) {
  const m = input.manifest ?? null;
  const manifestFullHash = typeof m?.bundleHash === "string" && m.bundleHash ? m.bundleHash : null;
  const manifestBundleSha = typeof m?.bundleSha === "string" && m.bundleSha ? m.bundleSha : null;
  const manifestEngineDigest = typeof m?.engineDigest === "string" && m.engineDigest ? m.engineDigest : null;

  const resolvedBundleSha = input.bundleHash || manifestFullHash || input.bundleSha || manifestBundleSha || "";
  const resolvedEngineDigest = input.engineDigest ?? manifestEngineDigest ?? "engine:unknown";
  const resolvedFontSetDigest = input.fontSetDigest ?? fontSetDigest(input.fontSet);

  return sha256Hex([resolvedBundleSha, paramsDigest(input.params), resolvedFontSetDigest, resolvedEngineDigest].join("|"));
}

/** Computes the 24-char `bundleSha` of a bundle HTML string using the plate engine's `sha256(html + "\0").slice(0, 24)` definition. */
export function engineBundleSha(html) {
  return createHash("sha256").update(html).update("\0").digest("hex").slice(0, 24);
}

/**
 * Verifies that the downloaded bundle HTML matches the frozen manifest's `bundleDigest`, `bundleSha`, and `paramsDigest`.
 */
export function verifyBundleDigest(html, scene, manifest) {
  if (typeof html !== "string" || !html.length) {
    return { ok: false, reason: "Scene bundle HTML is empty." };
  }
  const params = scene?.params && typeof scene.params === "object" ? scene.params : {};
  const computedParamsDigest = paramsDigest(params);
  if (scene?.paramsDigest && computedParamsDigest !== scene.paramsDigest) {
    return { ok: false, reason: `Scene paramsDigest mismatch (expected ${scene.paramsDigest}, got ${computedParamsDigest}).` };
  }

  const nulFull = createHash("sha256").update(html).update("\0").digest("hex");
  const nulShort = nulFull.slice(0, 24);
  const plainFull = sha256Hex(html);
  const plainShort = plainFull.slice(0, 24);

  if (typeof scene?.bundleSha === "string" && scene.bundleSha.trim()) {
    const prefix = scene.bundleSha.trim().toLowerCase();
    if (!nulFull.startsWith(prefix) && !plainFull.startsWith(prefix)) {
      return { ok: false, reason: `Scene bundle HTML SHA-256 does not match manifest bundleSha "${prefix}".` };
    }
  }

  const eDigest = manifest?.engineDigest ?? "engine:unknown";
  const fsDigest = manifest?.fontSetDigest ?? fontSetDigest();
  const candidates = [nulShort, plainShort, nulFull, plainFull];
  for (const cand of candidates) {
    const d = bundleDigest({
      bundleSha: cand,
      params,
      engineDigest: eDigest,
      fontSetDigest: fsDigest
    });
    if (d === scene?.bundleDigest) {
      return { ok: true, bundleSha: cand, bundleDigest: d };
    }
  }

  return {
    ok: false,
    reason: `Scene bundleDigest mismatch (expected ${scene?.bundleDigest}, computed ${bundleDigest({ bundleSha: nulShort, params, engineDigest: eDigest, fontSetDigest: fsDigest })}).`
  };
}

const SOFTWARE_GL_RE = /\b(swiftshader|llvmpipe|softpipe|lavapipe|software\s+rasterizer|mesa\s+offscreen|basic\s+render\s+driver)\b/i;
const HARDWARE_GL_RE = /\b(nvidia|geforce|quadro|tesla|radeon|amd\s+radeon|apple\s+m\d|apple\s+gpu|intel\(r\)\s+(?:uhd|iris|hd|arc)|adreno|mali)\b/i;

/**
 * Pure decision function for the Software-GL self-check: returns true only when `renderer` identifies a software
 * rasteriser (SwiftShader, llvmpipe, softpipe, lavapipe, etc.) and not a hardware GPU.
 */
export function isSoftwareRenderer(renderer) {
  if (typeof renderer !== "string") return false;
  const trimmed = renderer.trim();
  if (!trimmed) return false;
  if (!SOFTWARE_GL_RE.test(trimmed)) return false;
  if (HARDWARE_GL_RE.test(trimmed) && !/\b(swiftshader|llvmpipe|softpipe|lavapipe)\b/i.test(trimmed)) return false;
  return true;
}

/** Validates the renderer string and throws `GpuPathDetectedError` (`code: "gpu_path_detected"`, retriable) if not software GL. */
export function checkSoftwareRenderer(renderer) {
  if (!isSoftwareRenderer(renderer)) {
    throw new GpuPathDetectedError(typeof renderer === "string" ? renderer.trim() : "");
  }
  return { ok: true, renderer: renderer.trim() };
}

let cachedRendererString = null;

const BROWSER_CRASH_RE = /\b(crash|crashed|disconnected|target closed|target page, context or browser has been closed|browser has been closed|context or browser has been closed|frame was detached|execution context was destroyed|session closed|watchdog timeout)\b/i;

/** Returns true when an error came from a crashed/closed/disconnected Chromium page or browser, or a watchdog timeout. */
export function isBrowserCrashOrTimeout(error) {
  if (!error) return false;
  if (error.code === "plate_watchdog_timeout" || error.code === "browser_crashed") return true;
  const msg = `${error.message ?? ""} ${error.cause?.message ?? ""}`;
  return BROWSER_CRASH_RE.test(msg);
}

/** Ensures any browser crash/disconnect/timeout error is marked retryable (`kind: "infra"`, `permanent: false`). */
export function normalizeBrowserError(error) {
  if (isBrowserCrashOrTimeout(error)) {
    const err = error instanceof Error ? error : new Error(String(error));
    err.kind = "infra";
    err.permanent = false;
    return err;
  }
  return error;
}

/** Closes a Playwright browser and kills its underlying OS process so no zombie Chromium survives. */
export async function closeAndKillBrowser(browser) {
  if (!browser) return;
  const proc = typeof browser.process === "function" ? browser.process() : browser._process ?? null;
  try {
    await Promise.race([
      Promise.resolve(browser.close?.()),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  } catch {
    // ignore close error
  } finally {
    const pid = proc?.pid;
    if (typeof proc?.kill === "function") {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    } else if (pid) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }
}

/** Bounds an async browser check/draw operation by `timeoutMs`, aborting its signal and rejecting as a retryable infra error on hang. */
export async function withWatchdog(fn, { timeoutMs, label = "Chromium", signal } = {}) {
  const watchdog = new AbortController();
  const combined = signal ? AbortSignal.any([signal, watchdog.signal]) : watchdog.signal;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = Object.assign(new Error(`${label} hung and exceeded watchdog timeout (${timeoutMs}ms).`), {
        code: "plate_watchdog_timeout",
        kind: "infra",
        permanent: false
      });
      watchdog.abort(err);
      reject(err);
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([fn(combined), timeoutPromise]);
  } catch (error) {
    throw normalizeBrowserError(error);
  } finally {
    clearTimeout(timer);
  }
}

/** Probes Chromium's active WebGL renderer string in the worker environment. */
export async function probeRendererString({
  executablePath = process.env.PLATE_BROWSER_PATH || process.env.HYPERFRAMES_BROWSER_PATH || undefined,
  force = false,
  timeoutMs = getCheckTimeoutMs(),
  signal,
  chromiumImpl
} = {}) {
  if (process.env.PLATE_FAKE_GL_RENDERER) {
    return process.env.PLATE_FAKE_GL_RENDERER;
  }
  if (!force && cachedRendererString) return cachedRendererString;
  const chromium = chromiumImpl ?? (await import("playwright-core")).chromium;
  let browser;
  try {
    return await withWatchdog(async (wdSignal) => {
      browser = await chromium.launch({
        executablePath,
        timeout: timeoutMs,
        args: [
          "--disable-background-timer-throttling",
          "--disable-extensions",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--disable-gpu",
          ...(process.env.PLATE_CHROME_ARGS ? process.env.PLATE_CHROME_ARGS.split(" ") : [])
        ]
      });
      const onAbort = () => { void closeAndKillBrowser(browser); };
      wdSignal?.addEventListener("abort", onAbort, { once: true });
      try {
        let crashReject;
        const crashPromise = new Promise((_, reject) => { crashReject = reject; });
        const onDisconnect = () => crashReject(Object.assign(new Error("Browser disconnected"), { code: "browser_crashed", kind: "infra", permanent: false }));
        const onCrash = () => crashReject(Object.assign(new Error("Page crashed"), { code: "browser_crashed", kind: "infra", permanent: false }));
        const onClose = () => crashReject(Object.assign(new Error("Target closed"), { code: "browser_crashed", kind: "infra", permanent: false }));
        browser.on?.("disconnected", onDisconnect);
        const page = await browser.newPage();
        page.on?.("crash", onCrash);
        page.on?.("close", onClose);
        page.setDefaultTimeout?.(timeoutMs);
        const renderer = await Promise.race([
          page.evaluate(() => {
            const c = document.createElement("canvas");
            const gl = c.getContext("webgl") || c.getContext("experimental-webgl") || c.getContext("webgl2");
            if (!gl) return "Software Canvas2D (SwiftShader)";
            const dbg = gl.getExtension("WEBGL_debug_renderer_info");
            const unmasked = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
            return String(unmasked || gl.getParameter(gl.RENDERER) || "");
          }),
          crashPromise
        ]);
        page.off?.("crash", onCrash);
        page.off?.("close", onClose);
        browser.off?.("disconnected", onDisconnect);
        cachedRendererString = renderer;
        return renderer;
      } finally {
        wdSignal?.removeEventListener("abort", onAbort);
      }
    }, { timeoutMs, label: "Chromium GL probe", signal });
  } finally {
    await closeAndKillBrowser(browser);
  }
}

export function clipCacheKey(projectId, bDigest, eDigest, fsDigest, width, height) {
  return `plates/${projectId}/clips/${String(bDigest).slice(0, 32)}-${String(eDigest).slice(0, 12)}-${String(fsDigest).slice(0, 12)}-${width}x${height}.mp4`;
}

export function stillCacheKey(projectId, bDigest, eDigest, fsDigest, width, height) {
  return `plates/${projectId}/clips/${String(bDigest).slice(0, 32)}-${String(eDigest).slice(0, 12)}-${String(fsDigest).slice(0, 12)}-${width}x${height}.png`;
}

export function bakeSceneParams(html, params) {
  if (!params || typeof params !== "object" || Object.keys(params).length === 0) return html;
  const script = `window.__PARAMS__=${canonicalJson(params)};`;
  if (html.includes("window.__BAKE_SRC__={};")) {
    return html.replace("window.__BAKE_SRC__={};", `window.__BAKE_SRC__={};${script}`);
  }
  return html.replace("<script>", `<script>${script}`);
}

let enginePromise;
/** The capture adapter ships in the image next to the worker (plate-engine/), or from the repository when run from a checkout. */
function engine() {
  enginePromise ??= import(new URL("../plate-engine/capture.mjs", import.meta.url).href).catch(() => import(new URL("../../packages/plate-engine/lib/capture.mjs", import.meta.url).href));
  return enginePromise;
}
let rulesPromise;
const rules = () => (rulesPromise ??= import(new URL("../plate-engine/rules.mjs", import.meta.url).href).catch(() => import(new URL("../../packages/plate-engine/lib/rules.mjs", import.meta.url).href)));

/** Whether this image can draw plate scenes (the capability the backend/launcher can check before enabling the pipeline). */
export async function plateCapability() {
  try { await engine(); await rules(); return { version: 1, kinds: ["anidoodle"], assembler: 1, fps: FPS }; } catch { return null; }
}

// ================================================================ render one scene (preview fallback & clip mode)
const DIM = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };

/** Claims the scene for this attempt (cap per project, stale takeover). On the backend, in one transaction. Never retried: see control.mjs. */
export async function claimVariant(control, variantId, gen) {
  return (await control.op("plate.claim", { variantId, gen }, { retry: false })).row ?? null;
}

/** Fenced writes of the one attempt that owns the row; each returns true while this attempt still owns it. */
const ref = (row) => ({ id: row.id, gen: row.gen, renderAttempt: row.render_attempt });
const fenceProgress = async (control, row, stage, framesDone) => (await control.op("plate.progress", { ...ref(row), stage, framesDone })).ok === true;
const fenceDrawn = async (control, row, args) => (await control.op("plate.drawn", { ...ref(row), ...args })).ok === true;
const fenceFailed = async (control, row, error) => (await control.op("plate.failed", { ...ref(row), error })).ok === true;
const fenceRetry = async (control, row, reason = "the drawing worker restarted") => (await control.op("plate.retry", { ...ref(row), reason })).ok === true;

/** A deterministic defect of the scene code goes back to authoring (bounded); anything else is infrastructure. */
async function sendBackForRepair(control, row, detail) {
  return control.op("plate.sendBackForRepair", { ...ref(row), authored: row.authored, sourceKey: row.source_key, detail });
}

export async function handlePlateRender(job, {
  control,
  probeRenderer = probeRendererString,
  verifyTimeoutMs,
  checkTimeoutMs,
  drawTimeoutMs,
  frameStallTimeoutMs,
  engineImpl,
  storageImpl
} = {}) {
  const effectiveCheckTimeoutMs = checkTimeoutMs ?? verifyTimeoutMs ?? getCheckTimeoutMs();
  const effectiveDrawTimeoutMs = drawTimeoutMs ?? getDrawTimeoutMs();
  const effectiveStallTimeoutMs = frameStallTimeoutMs ?? Math.min(effectiveDrawTimeoutMs, FRAME_STALL_TIMEOUT_MS);
  const { variantId, gen } = job.data ?? {};
  if (typeof variantId !== "string" || !UUID.test(variantId) || !Number.isInteger(gen)) return;
  const row = await claimVariant(control, variantId, gen);
  if (!row) {
    // At the project's cap: look again shortly without spending a retry. Superseded, drawn, or held by a live attempt: nothing to do.
    const { row: now } = await control.op("plate.state", { variantId });
    if (now?.gen === gen && (now?.state === "bundled" || now?.state === "checked")) await control.op("plate.sendLater", { variantId, gen, startAfter: 4 });
    // Redelivered (a worker died or was stopped) while the previous holder's last write is still recent: look again once it would
    // count as silent, instead of letting this delivery complete and nothing take the scene over. Bounded.
    else if (now?.gen === gen && now?.state === "rendering" && (job.retryCount > 0 || job.data?.looks > 0) && (job.data?.looks ?? 0) < 6) await control.op("plate.sendLater", { variantId, gen, looks: (job.data?.looks ?? 0) + 1, startAfter: Math.ceil(STALE_SECONDS / 2) });
    return;
  }
  const downloadInput = storageImpl?.downloadPlateInput ?? downloadPlateInput;
  const uploadOutput = storageImpl?.uploadPlateOutput ?? uploadPlateOutput;
  const deleteOut = storageImpl?.deleteOutputs ?? deleteOutputs;
  const started = Date.now();
  const lost = new AbortController();
  const stall = new AbortController();
  const signal = AbortSignal.any([job.signal, lost.signal, stall.signal]);
  const scratch = join("/tmp", `plate-${row.id}-a${row.render_attempt}`);
  const uploaded = [];
  let framesDone = 0, stage = "verifying", lastActivityAt = Date.now(), ticking = Promise.resolve();
  const tick = setInterval(() => {
    if (Date.now() - lastActivityAt > Math.max(effectiveCheckTimeoutMs, effectiveDrawTimeoutMs)) {
      stall.abort(new Error(`Chromium stalled in stage "${stage}" with ${framesDone}/${row.frames} frames.`));
      return;
    }
    ticking = ticking.then(async () => {
      if (!(await fenceProgress(control, row, stage, framesDone))) lost.abort(new Error("superseded"));
    }).catch((error) => log("warn", "plate_progress_failed", { variantId, message: messageOf(error) }));
  }, 2000);
  log("info", "plate_render_started", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, gen: row.gen, attempt: row.render_attempt });
  try {
    if (!plateKeyOk(row.bundle_key, row.project_id)) throw new InputError("The scene bundle location is invalid.");
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    const page = join(scratch, "scene.html");
    await downloadInput(row.bundle_key, page);
    lastActivityAt = Date.now();
    const [w, h] = DIM[row.aspect] ?? [];
    if (row.width !== w || row.height !== h || row.fps !== FPS) throw new InputError("The scene's size does not match its ratio.");
    const prefix = row.bundle_key.slice(0, row.bundle_key.lastIndexOf("/") + 1);
    const { verifyScene, renderScene, probeVideo, classifyFailure } = engineImpl ?? (await engine());

    const renderer = await probeRenderer({ signal, timeoutMs: effectiveCheckTimeoutMs });
    checkSoftwareRenderer(renderer);
    lastActivityAt = Date.now();

    // 1. verify in Chromium: first, true middle and last frame, each drawn twice and again on a second page
    const t0 = Date.now();
    let verified;
    try {
      verified = await withWatchdog(
        (wdSignal) => verifyScene(page, { frames: row.frames, signal: wdSignal }),
        { timeoutMs: effectiveCheckTimeoutMs, label: "Chromium scene check", signal }
      );
    } catch (error) {
      if (lost.signal.aborted) return;
      if (job.signal.aborted) throw error;
      if (!isBrowserCrashOrTimeout(error) && classifyFailure(error) === "code") {
        const sent = await sendBackForRepair(control, row, messageOf(error));
        log("warn", "plate_scene_code_failure", { variantId, scene: row.scene_index, aspect: row.aspect, exhausted: sent.exhausted, message: messageOf(error).slice(0, 300) });
        return;
      }
      throw normalizeBrowserError(error);
    }
    lastActivityAt = Date.now();
    if (verified.blocked.length) log("warn", "plate_network_blocked", { variantId, blocked: verified.blocked.slice(0, 5) });
    const verifyMs = Date.now() - t0;
    const stillKey = `${prefix}still-a${row.render_attempt}.png`;
    await writeFile(join(scratch, "still.png"), verified.midPng);
    await uploadOutput(join(scratch, "still.png"), stillKey, "image/png");
    uploaded.push(stillKey);
    lastActivityAt = Date.now();
    if (lost.signal.aborted) return;

    // 2. draw every frame and encode
    stage = "rendering";
    const t1 = Date.now();
    const video = join(scratch, "clip.mp4");
    const renderStall = new AbortController();
    let stallTimer = setTimeout(() => renderStall.abort(new Error(`Chromium hung drawing frames (${framesDone}/${row.frames}).`)), effectiveStallTimeoutMs);
    stallTimer.unref?.();
    const resetStall = () => {
      lastActivityAt = Date.now();
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => renderStall.abort(new Error(`Chromium hung drawing frames (${framesDone}/${row.frames}).`)), effectiveStallTimeoutMs);
      stallTimer.unref?.();
    };
    try {
      await withWatchdog(
        (wdSignal) =>
          renderScene(page, video, {
            frames: row.frames,
            fps: FPS,
            workers: RENDER_WORKERS,
            signal: AbortSignal.any([wdSignal, renderStall.signal]),
            onProgress: (n) => {
              framesDone = n;
              resetStall();
            }
          }),
        { timeoutMs: effectiveDrawTimeoutMs, label: "Chromium scene draw", signal }
      );
    } finally {
      clearTimeout(stallTimer);
    }
    if (renderStall.signal.aborted) throw normalizeBrowserError(renderStall.signal.reason ?? new Error("Chromium hung drawing frames."));
    const renderMs = Date.now() - t1;
    const facts = await probeVideo(video);
    if (facts.frames !== row.frames || facts.width !== w || facts.height !== h || Math.abs(facts.fps - FPS) > 1e-6) {
      throw Object.assign(new Error(`The drawn clip is ${facts.width}x${facts.height} with ${facts.frames} frames, expected ${w}x${h} with ${row.frames}.`), { kind: "code" });
    }
    const clipKey = `${prefix}clip-a${row.render_attempt}.mp4`;
    const t2 = Date.now();
    await uploadOutput(video, clipKey, "video/mp4");
    uploaded.push(clipKey);
    const uploadMs = Date.now() - t2;

    // 3. publish: only the attempt that still owns the row can put its key there (also writes to app.plate_clips)
    const published = await fenceDrawn(control, row, {
      clipKey,
      stillKey,
      clipMeta: { ...facts, renderer, worker: hostname(), attempt: row.render_attempt },
      timings: { verifyMs, renderMs, uploadMs, workerTotalMs: Date.now() - started }
    });
    if (!published) {
      await deleteOut(uploaded).catch(() => undefined);
      log("info", "plate_render_superseded", { variantId, gen: row.gen, attempt: row.render_attempt });
      return;
    }
    log("info", "plate_drawn", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, frames: row.frames, verifyMs, renderMs, uploadMs, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    if (lost.signal.aborted) {
      await deleteOut(uploaded).catch(() => undefined);
      log("info", "plate_render_dropped", { variantId, gen: row.gen });
      return;
    }
    if (isDiskFullError(error)) {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      await cleanTempScratchDirs("/tmp").catch(() => undefined);
      await deleteOut(uploaded).catch(() => undefined);
      await fenceFailed(control, row, {
        code: DISK_FULL_CODE,
        message: DISK_FULL_MESSAGE,
        detail: messageOf(error).slice(-400)
      });
      log("error", "plate_render_disk_full", { variantId, gen: row.gen, attempt: row.render_attempt });
      return;
    }
    if (error?.permanent && !isBrowserCrashOrTimeout(error)) {
      await fenceFailed(control, row, { code: error.code || "scene_invalid", message: error.message });
      return;
    }
    const { classifyFailure } = engineImpl ?? (await engine());
    if (!job.signal.aborted && !isBrowserCrashOrTimeout(error) && classifyFailure(error) === "code") {
      // A scene that fails while drawing (or draws a clip that breaks its contract) is a code defect: bounded repair.
      await sendBackForRepair(control, row, messageOf(error));
      return;
    }
    const final = (job.retryCount ?? 0) >= 2;
    log("warn", "plate_render_interrupted", { variantId, gen: row.gen, attempt: row.render_attempt, final, message: messageOf(error).slice(-300) });
    await deleteOut(uploaded).catch(() => undefined);
    if (job.signal.aborted) {
      // Worker stopping or heartbeat lost. Put the row back to "bundled" (fenced by this attempt, so a no-op if another attempt already owns
      // it) so the retry can claim it at once instead of waiting for the row to go stale; the lease/job is handed back by runLeased.
      await fenceRetry(control, row, "the drawing worker restarted").catch(() => undefined);
      throw error;
    }
    // Browser start-up, Spot interruption, storage or network failure: the same bundle is tried again, no model call.
    if (final) await fenceFailed(control, row, { code: "render_failed", message: "Drawing this scene did not finish. Press Draw to try again.", detail: messageOf(error).slice(-400) });
    else await fenceRetry(control, row, "the drawing worker restarted");
    if (!final) throw normalizeBrowserError(error);
  } finally {
    clearInterval(tick);
    await ticking;
    await rm(scratch, { recursive: true, force: true });
  }
}

// ================================================================ assembly
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** One subtitle cue as a full-frame transparent PNG (the same drawing rules the preview's styles describe). */
export async function renderSubtitlePng(text, sub, w, h) {
  const style = sub.style;
  const scale = (sub.size ?? 100) / 100;
  const isPortrait = h > w;
  const baseFont = isPortrait ? w * 0.033 : h * 0.036;
  const fontSize = Math.max(16, Math.round(baseFont * scale));
  const display = style === "kinetic" ? text.toUpperCase() : text;
  const maxChars = Math.max(14, Math.round((isPortrait ? 28 : 44) / Math.max(0.75, scale * 0.9)));
  const lines = [];
  let current = "";
  for (const word of display.split(/\s+/)) {
    if (current && (current.length + 1 + word.length) > maxChars) { lines.push(current); current = word; }
    else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  const lineHeight = Math.round(fontSize * 1.28);
  const blockH = lines.length * lineHeight;
  const padX = Math.round(fontSize * 0.72);
  const padY = Math.round(fontSize * 0.42);
  const maxLineChars = Math.max(...lines.map((l) => l.length), 1);
  const charWidth = style === "blueprint" ? 0.61 : style === "kinetic" ? 0.63 : 0.55;
  const boxW = Math.min(w - 48, Math.round(maxLineChars * fontSize * charWidth + padX * 2));
  const boxH = blockH + padY * 2;
  const centerX = Math.round(((sub.x ?? 50) / 100) * w);
  const centerY = Math.round(((sub.y ?? 88) / 100) * h);
  const boxX = Math.max(20, Math.min(w - boxW - 20, Math.round(centerX - boxW / 2)));
  const boxY = Math.max(20, Math.min(h - boxH - 20, Math.round(centerY - boxH / 2)));
  const textX = Math.round(boxX + boxW / 2);
  const fontStack = style === "blueprint" ? "'SF Mono', 'Menlo', 'Courier New', monospace" : style === "paper" ? "'Georgia', 'Times New Roman', serif" : "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";
  const fontWeight = style === "kinetic" ? 800 : style === "paper" ? 600 : 700;
  let bgSvg = "", textColor = sub.color || "#ffffff", strokeAttr = "";
  if (style === "pill") {
    bgSvg = `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${Math.round(boxH / 2)}" fill="${sub.bgColor || "rgba(12,15,22,0.82)"}" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>`;
    if (!sub.color) textColor = "#f8fafc";
  } else if (style === "cinema") {
    if (!sub.color) textColor = "#fef08a";
    strokeAttr = `stroke="${sub.bgColor || "#090b10"}" stroke-width="${Math.max(4, Math.round(fontSize * 0.16))}" paint-order="stroke fill" stroke-linejoin="round"`;
  } else if (style === "kinetic") {
    bgSvg = `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="12" fill="${sub.bgColor || "#facc15"}" stroke="#0b0d12" stroke-width="3.5"/>`;
    if (!sub.color) textColor = "#0b0d12";
  } else if (style === "paper") {
    bgSvg = `<rect x="${boxX + 3}" y="${boxY + 4}" width="${boxW}" height="${boxH}" rx="10" fill="rgba(30,22,14,0.32)"/><rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="10" fill="${sub.bgColor || "#faf5e8"}" stroke="#3b3228" stroke-width="2.5"/>`;
    if (!sub.color) textColor = "#231f1b";
  } else if (style === "blueprint") {
    bgSvg = `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="6" fill="${sub.bgColor || "rgba(12,42,74,0.9)"}" stroke="#7dd3fc" stroke-width="2"/>`;
    if (!sub.color) textColor = "#f0f9ff";
  }
  const textEls = lines.map((line, idx) => `<text x="${textX}" y="${boxY + padY + Math.round((idx + 0.8) * lineHeight)}" text-anchor="middle" font-family="${fontStack}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${textColor}" ${strokeAttr}>${escapeXml(line)}</text>`).join("");
  const alpha = Math.min(1, Math.max(0.2, (sub.opacity ?? 100) / 100));
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g opacity="${alpha.toFixed(2)}">${bgSvg}${textEls}</g></svg>`)).png().toBuffer();
}

export const WATERMARK_INTERVAL_SECONDS = 4;
const GM_MARK_SVG_PATHS = `<g fill="#168BFF"><rect x="18" y="55" width="42" height="12" rx="6"/><rect x="8" y="74" width="58" height="12" rx="6"/><rect x="20" y="93" width="34" height="12" rx="6"/><path d="M76 49C76 31 96 20 114 28c26 12 46 32 64 52-18 20-38 40-64 52-18 8-38-3-38-21V49Z"/></g><path fill="#FF5A1F" d="M192 54c0-9 10-14 18-9l31 20c8 5 8 16 0 21l-31 20c-8 5-18 0-18-9V54Z"/>`;

/**
 * Deterministic layout for the Free plan's narrow centered stacked Greedy Motion watermark:
 *   [Greedy Motion logo]
 *         Greedy
 *         Motion
 * Alternates every `WATERMARK_INTERVAL_SECONDS` (4 s) between LEFT above vertical midpoint (~40% frame height)
 * and RIGHT below vertical midpoint (~60% frame height), never using top or bottom corners.
 */
export function watermarkLayout(w, h) {
  const ref = Math.min(w, h);
  const lines = ["Greedy", "Motion"];
  const label = "Greedy Motion";
  const fontSize = Math.max(10, Math.round(ref * 0.022));
  const lineHeight = Math.max(12, Math.round(fontSize * 1.15));
  const logoH = Math.max(14, Math.round(fontSize * 1.65));
  const logoW = Math.round(logoH * 1.6);
  const gap = Math.max(3, Math.round(fontSize * 0.25));
  const padX = Math.max(8, Math.round(fontSize * 0.65));
  const padY = Math.max(6, Math.round(fontSize * 0.5));
  const textW = Math.round(fontSize * 3.8);
  const boxW = Math.max(logoW, textW) + padX * 2;
  const textBlockH = fontSize + lineHeight;
  const boxH = padY + logoH + gap + textBlockH + padY;
  const rx = Math.max(8, Math.round(fontSize * 0.65));
  const strokeW = Math.max(1, Math.round(fontSize * 0.06));
  const marginX = Math.max(10, Math.round(w * 0.035));
  const leftX = marginX;
  const leftCenterY = Math.round(h * 0.40);
  const leftY = Math.max(marginX, Math.min(h - marginX - boxH, Math.round(leftCenterY - boxH / 2)));
  const rightX = Math.max(marginX, w - marginX - boxW);
  const rightCenterY = Math.round(h * 0.60);
  const rightY = Math.max(marginX, Math.min(h - marginX - boxH, Math.round(rightCenterY - boxH / 2)));
  return {
    label,
    lines,
    intervalSeconds: WATERMARK_INTERVAL_SECONDS,
    fontSize,
    lineHeight,
    logoW,
    logoH,
    gap,
    padX,
    padY,
    boxW,
    boxH,
    rx,
    strokeW,
    marginX,
    left: { x: leftX, y: leftY, centerY: Math.round(leftY + boxH / 2) },
    right: { x: rightX, y: rightY, centerY: Math.round(rightY + boxH / 2) }
  };
}

/** The Free plan's narrow stacked mark (logo / Greedy / Motion), rendered on `side` ("left" | "right"). */
export async function renderWatermarkPng(w, h, { side = "left" } = {}) {
  const layout = watermarkLayout(w, h);
  const pos = side === "right" ? layout.right : layout.left;
  const { x, y } = pos;
  const { lines, fontSize, lineHeight, logoW, logoH, gap, padY, boxW, boxH, rx, strokeW } = layout;
  const logoX = Math.round(x + (boxW - logoW) / 2);
  const logoY = y + padY;
  const textX = Math.round(x + boxW / 2);
  const line1Y = logoY + logoH + gap + Math.round(fontSize * 0.84);
  const line2Y = line1Y + lineHeight;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${rx}" fill="rgba(10,14,22,0.64)" stroke="rgba(255,255,255,0.18)" stroke-width="${strokeW}"/><svg x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" viewBox="0 0 256 160">${GM_MARK_SVG_PATHS}</svg><text x="${textX}" y="${line1Y}" text-anchor="middle" font-family="'Plus Jakarta Sans', 'Liberation Sans', Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" letter-spacing="0.01em">${escapeXml(lines[0])}</text><text x="${textX}" y="${line2Y}" text-anchor="middle" font-family="'Plus Jakarta Sans', 'Liberation Sans', Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" letter-spacing="0.01em">${escapeXml(lines[1])}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Assembles the film from a manifest: scene clips (already local), voice, music, word-aligned effects, subtitles, watermark.
 * One timeline, integer frames. Stream copy only when the clips are exactly the timeline and nothing touches pixels.
 * Returns facts about what it wrote.
 */
/** The final re-encode matches the per-scene clips (CRF 16, preset medium; packages/plate-engine/lib/capture.mjs), so it adds no visible loss. */
export const PLATE_FINAL_VIDEO_ARGS = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p"];

export async function assemble(manifest, { clipFiles, scratch, output, signal, onProgress, audioFiles, storageImpl }) {
  const downloadInput = storageImpl?.downloadPlateInput ?? downloadPlateInput;
  const { canStreamCopy } = await rules();
  const { probeVideo } = await engine();
  const { width: W, height: H } = manifest;
  const total = manifest.totalFrames / FPS;
  const probes = await Promise.all(clipFiles.map((file) => probeVideo(file)));
  const frames = manifest.scenes.map((s) => s.frames);
  const overlays = manifest.cues.length + (manifest.watermark ? 1 : 0);
  const copy = canStreamCopy(probes, frames, { w: W, h: H }, overlays);

  const inputs = [], filters = [];
  let next = 0;
  if (copy) {
    const list = join(scratch, "scenes.txt");
    await writeFile(list, clipFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    inputs.push("-f", "concat", "-safe", "0", "-i", list);
    next = 1;
  } else {
    clipFiles.forEach((file, i) => {
      inputs.push("-i", file);
      const retime = probes[i].frames && probes[i].frames !== frames[i] ? `setpts=${(frames[i] / probes[i].frames).toFixed(6)}*PTS,` : "";
      filters.push(`[${i}:v]${retime}fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${(frames[i] / FPS).toFixed(6)},setpts=PTS-STARTPTS[v${i}]`);
    });
    const needsOverlay = overlays > 0;
    filters.push(`${clipFiles.map((_, i) => `[v${i}]`).join("")}concat=n=${clipFiles.length}:v=1:a=0${needsOverlay ? "[vbase0]" : "[vout]"}`);
    next = clipFiles.length;
    const overlayFiles = [];
    for (const [i, cue] of manifest.cues.entries()) {
      const pos = manifest.subtitles.scenePositions?.[String(cue.scene)];
      const sub = pos ? { ...manifest.subtitles, x: pos.x, y: pos.y } : manifest.subtitles;
      const png = join(scratch, `sub-${i}.png`);
      await writeFile(png, await renderSubtitlePng(cue.text, sub, W, H));
      overlayFiles.push({ png, enable: `between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})` });
    }
    if (manifest.watermark) {
      const leftPng = join(scratch, "watermark-left.png");
      const rightPng = join(scratch, "watermark-right.png");
      await Promise.all([
        renderWatermarkPng(W, H, { side: "left" }).then((buf) => writeFile(leftPng, buf)),
        renderWatermarkPng(W, H, { side: "right" }).then((buf) => writeFile(rightPng, buf))
      ]);
      overlayFiles.push({ png: leftPng, enable: `eq(mod(floor(t/${WATERMARK_INTERVAL_SECONDS}),2),0)` });
      overlayFiles.push({ png: rightPng, enable: `eq(mod(floor(t/${WATERMARK_INTERVAL_SECONDS}),2),1)` });
    }
    overlayFiles.forEach((o, i) => {
      inputs.push("-i", o.png);
      filters.push(`[vbase${i}][${next}:v]overlay=0:0${o.enable ? `:enable='${o.enable}'` : ""}[${i === overlayFiles.length - 1 ? "vout" : `vbase${i + 1}`}]`);
      next += 1;
    });
  }

  const audio = [];
  const staged = new Map();
  const stage = async (key, expectedDigest) => {
    if (!key) return null;
    if (audioFiles?.[key]) {
      const localPath = audioFiles[key];
      if (expectedDigest) {
        const bytes = await readFile(localPath);
        if (sha256Hex(bytes) !== expectedDigest) throw new InputError("The staged audio file digest does not match the manifest.");
      }
      return localPath;
    }
    if (!staged.has(key)) {
      if (!plateKeyOk(key, manifest.projectId)) throw new InputError("An audio location in the manifest is invalid.");
      const file = join(scratch, `audio-${staged.size}${key.slice(key.lastIndexOf("."))}`);
      await downloadInput(key, file);
      if (expectedDigest) {
        const bytes = await readFile(file);
        if (sha256Hex(bytes) !== expectedDigest) throw new InputError("The downloaded audio file digest does not match the manifest.");
      }
      staged.set(key, file);
    }
    return staged.get(key);
  };
  const tail = () => "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  if (manifest.voiceOn) {
    for (const [i, scene] of manifest.scenes.entries()) {
      const file = await stage(scene.voice?.key, scene.voice?.digest);
      if (!file) continue;
      inputs.push("-i", file);
      const ms = Math.round((scene.startFrame / FPS) * 1000);
      filters.push(`[${next}:a]${tail()},adelay=${ms}|${ms},apad=whole_dur=${total.toFixed(3)}[avo${i}]`);
      audio.push(`[avo${i}]`); next += 1;
    }
  }
  const music = await stage(manifest.music?.key, manifest.music?.digest);
  if (music) {
    inputs.push("-stream_loop", "-1", "-i", music);
    filters.push(`[${next}:a]${tail()},volume=0.22,atrim=0:${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5,asetpts=PTS-STARTPTS[amusic]`);
    audio.push("[amusic]"); next += 1;
  }
  const sfxFiles = new Map();
  for (const cue of manifest.sfx) {
    if (!/^[a-z0-9-]+$/.test(cue.name)) continue;
    const file = join(SFX_DIR, `${cue.name}.mp3`);
    if (!sfxFiles.has(file)) sfxFiles.set(file, await readFile(file).then(() => true, () => false));
    if (!sfxFiles.get(file)) continue;
    inputs.push("-i", file);
    const ms = Math.round(((manifest.scenes[cue.scene].startFrame / FPS) + cue.offset) * 1000);
    const trim = cue.mediaStart ? `atrim=start=${cue.mediaStart.toFixed(3)},asetpts=PTS-STARTPTS,` : "";
    filters.push(`[${next}:a]${tail()},${trim}volume=${cue.volume.toFixed(2)},adelay=${ms}|${ms},apad=whole_dur=${total.toFixed(3)}[asfx${next}]`);
    audio.push(`[asfx${next}]`); next += 1;
  }

  const args = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", ...inputs];
  if (audio.length) filters.push(`${audio.join("")}amix=inputs=${audio.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  const aargs = audio.length ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"] : [];
  if (copy) args.push("-map", "0:v:0", ...aargs, "-c:v", "copy", "-t", total.toFixed(6), "-movflags", "+faststart", output);
  else args.push("-map", "[vout]", ...aargs, ...PLATE_FINAL_VIDEO_ARGS, "-r", String(FPS), "-t", total.toFixed(6), "-movflags", "+faststart", output);
  await run("ffmpeg", args, { signal, onLine: (line) => { const m = /^out_time_(?:us|ms)=(\d+)/.exec(line); if (m) onProgress?.(Math.min(1, Number(m[1]) / 1e6 / total)); } });
  const facts = await probeVideo(output);
  if (facts.frames !== manifest.totalFrames) throw new Error(`The assembled film has ${facts.frames} frames, expected ${manifest.totalFrames}.`);
  return { streamCopy: copy, frames: facts.frames, width: facts.width, height: facts.height, audioTracks: audio.length };
}

export async function loadManifest(manifestKey, projectId, scratch, { storageImpl } = {}) {
  const downloadInput = storageImpl?.downloadPlateInput ?? downloadPlateInput;
  if (!plateKeyOk(manifestKey, projectId)) throw new InputError("The export manifest location is invalid.");
  const file = join(scratch, "manifest.json");
  await downloadInput(manifestKey, file);
  const raw = await readFile(file, "utf8");
  const manifest = JSON.parse(raw);
  if ((manifest?.schema !== 1 && manifest?.schema !== 2) || manifest.projectId !== projectId || !Array.isArray(manifest.scenes) || !manifest.scenes.length || !DIM[manifest.aspect]) {
    throw new InputError("The export manifest is invalid.");
  }
  const [w, h] = DIM[manifest.aspect];
  if (manifest.width !== w || manifest.height !== h || manifest.fps !== FPS) throw new InputError("The export manifest has the wrong size.");
  let at = 0;
  for (const scene of manifest.scenes) {
    if (scene.startFrame !== at || !Number.isInteger(scene.frames) || scene.frames < 1) throw new InputError("The export timeline is not contiguous.");
    at += scene.frames;
  }
  if (at !== manifest.totalFrames) throw new InputError("The export timeline does not add up.");
  if (manifest.schema === 2) {
    if (typeof manifest.engineDigest !== "string" || !manifest.engineDigest || typeof manifest.fontSetDigest !== "string" || !manifest.fontSetDigest) {
      throw new InputError("The schema 2 export manifest is missing engineDigest or fontSetDigest.");
    }
    for (const scene of manifest.scenes) {
      if (
        typeof scene.variantId !== "string" ||
        !Number.isInteger(scene.gen) ||
        !Number.isInteger(scene.rev) ||
        typeof scene.bundleDigest !== "string" ||
        !scene.bundleDigest ||
        typeof scene.bundleKey !== "string" ||
        !scene.bundleKey ||
        typeof scene.paramsDigest !== "string" ||
        !scene.paramsDigest
      ) {
        throw new InputError(`The schema 2 export manifest has an incomplete scene entry at index ${scene.index}.`);
      }
    }
    const contentAddrMatch = /^plates\/[a-f0-9-]{36}\/manifests\/([a-f0-9]{64})\/manifest\.json$/i.exec(manifestKey);
    if (contentAddrMatch) {
      const expectedDigest = contentAddrMatch[1].toLowerCase();
      const actualDigest = sha256Hex(canonicalJson(manifest));
      if (actualDigest !== expectedDigest) {
        throw new InputError("The export manifest content hash does not match its content-addressed key.");
      }
    }
  }
  return manifest;
}

/** Legacy schema 1 helper: waits for every scene of a schema 1 manifest to be drawn by `plate-render`. */
async function resolveClips(control, manifest, { signal, report }) {
  const ids = manifest.scenes.map((s) => s.variantId);
  let lastDone = -1, stalledSince = Date.now();
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new Error("Aborted.");
    const { rows } = await control.op("scenes.states", { ids });
    const byId = new Map(rows.map((r) => [r.id, r]));
    let done = 0;
    for (const scene of manifest.scenes) {
      const row = byId.get(scene.variantId);
      if (!row || row.project_id !== manifest.projectId || row.signature !== scene.sig) throw new InputError("The scenes were changed after this film was started. Start it again to export the latest version.");
      if (row.state === "failed") throw new InputError(row.error?.message ?? "A scene could not be drawn.");
      if (row.state === "drawn" && row.clip_key) done += 1;
    }
    if (done === manifest.scenes.length) return manifest.scenes.map((s) => byId.get(s.variantId).clip_key);
    if (done !== lastDone) { lastDone = done; stalledSince = Date.now(); }
    if (Date.now() - stalledSince > 20 * 60_000) throw new Error("The scenes stopped making progress.");
    await report?.({ stage: "frames", done, total: manifest.scenes.length });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function downloadClips(manifest, keys, scratch, { storageImpl } = {}) {
  const downloadOutput = storageImpl?.downloadPlateOutput ?? downloadPlateOutput;
  const files = [];
  for (const [i, key] of keys.entries()) {
    if (!plateKeyOk(key, manifest.projectId)) throw new InputError("A scene clip location is invalid.");
    const file = join(scratch, `clip-${i}.mp4`);
    await downloadOutput(key, file);
    files.push(file);
  }
  return files;
}

/**
 * Schema 2 worker pipeline:
 *  1. Looks up each scene's clip FIRST in `app.plate_clips` by `(bundleDigest, engineDigest, fontSetDigest, size)`.
 *     For any cached hit (or matching `scene.clipKey`), downloads the MP4 and validates its integrity via `probeVideo`
 *     (`frames === sceneFrames`, `width === manifest.width`, `height === manifest.height`, `fps === 30`).
 *     Trusted valid cache hits skip bundle download and skip Chromium `verifyScene` / `renderScene` completely!
 *     Missing or corrupt cached objects fall back cleanly to cache misses.
 *  2. For cache misses ONLY: downloads and verifies EVERY missed scene bundle first (`verifyBundleDigest` + in-browser `verifyScene`).
 *     If any scene fails verification, stops immediately BEFORE drawing any frame, sends the scene to `plate.sendBackForRepair`
 *     (for code failures), and throws `SceneNeedsFixError` (`code: "scene_needs_fix"`, non-retriable).
 *  3. When multiple cache misses exist, dispatches them to `plate-render` (`plate.enqueueMisses`) so the AWS Fargate worker fleet
 *     scales out in parallel for all ready scene jobs, while local lanes also draw misses and poll `clip.lookup` to pick up clips
 *     completed by peer workers without drawing any scene twice.
 */
export async function prepareManifestClips(
  control,
  manifest,
  {
    fence,
    scratch,
    signal,
    report,
    engineImpl,
    storageImpl,
    probeRenderer = probeRendererString,
    concurrency = PLATE_DRAW_CONCURRENCY,
    checkTimeoutMs = getCheckTimeoutMs(),
    drawTimeoutMs = getDrawTimeoutMs(),
    fleetPollMs = 1500
  }
) {
  const downloadInput = storageImpl?.downloadPlateInput ?? downloadPlateInput;
  const downloadOutput = storageImpl?.downloadPlateOutput ?? downloadPlateOutput;
  const uploadOutput = storageImpl?.uploadPlateOutput ?? uploadPlateOutput;
  const deleteOut = storageImpl?.deleteOutputs ?? deleteOutputs;
  const { verifyScene, renderScene, probeVideo, classifyFailure } = engineImpl ?? (await engine());

  try {
    await mkdir(scratch, { recursive: true });
  } catch (error) {
    throw wrapDiskFull(error);
  }
  const size = `${manifest.width}x${manifest.height}`;
  const sceneEntries = manifest.scenes.map((scene, idx) => ({
    slot: idx,
    scene,
    sceneIndex: scene.index ?? idx,
    sceneFrames: Number(scene.bundleFrames ?? scene.frames)
  }));

  // ---- 1. Look up clip cache FIRST by (bundleDigest, engineDigest, fontSetDigest, size)
  const lookupRes = await control.op("clip.lookup", {
    keys: sceneEntries.map(({ scene }) => ({
      bundleDigest: scene.bundleDigest,
      engineDigest: manifest.engineDigest,
      fontSetDigest: manifest.fontSetDigest,
      size,
      width: manifest.width,
      height: manifest.height
    }))
  });
  const cachedByDigest = new Map();
  for (const row of lookupRes?.clips ?? []) {
    if (row?.bundle_digest && row?.clip_key) {
      cachedByDigest.set(row.bundle_digest, row);
    }
  }

  const isClipProbeValid = (facts, expectedFrames) => {
    if (!facts || typeof facts !== "object") return false;
    if (facts.width !== manifest.width || facts.height !== manifest.height) return false;
    if (Math.abs(Number(facts.fps) - FPS) > 1e-6) return false;
    if (facts.codec && facts.codec !== "h264") return false;
    if (facts.frames !== expectedFrames && facts.frames !== manifest.scenes[0]?.frames) {
      return facts.frames === expectedFrames;
    }
    return facts.frames === expectedFrames;
  };

  const tryUseCachedClip = async (item, candidateKey, cachedRow = null) => {
    if (!candidateKey || !plateKeyOk(candidateKey, manifest.projectId)) return false;
    const rowHasMetadata = Boolean(cachedRow && Number(cachedRow.frames) > 0);
    if (cachedRow) {
      if (cachedRow.width && Number(cachedRow.width) !== manifest.width) return false;
      if (cachedRow.height && Number(cachedRow.height) !== manifest.height) return false;
      if (cachedRow.fps && Number(cachedRow.fps) !== FPS) return false;
      if (cachedRow.frames && Number(cachedRow.frames) !== item.sceneFrames) return false;
    }
    const localClip = join(scratch, `clip-${item.sceneIndex}.mp4`);
    try {
      await downloadOutput(candidateKey, localClip);
      const statBytes = (await readFile(localClip)).length;
      if (statBytes === 0) {
        await rm(localClip, { force: true }).catch(() => undefined);
        return false;
      }
      if (!rowHasMetadata) {
        const facts = await probeVideo(localClip);
        if (!isClipProbeValid(facts, item.sceneFrames)) {
          log("warn", "plate_cached_clip_invalid_probe", {
            projectId: manifest.projectId,
            scene: item.sceneIndex,
            clipKey: candidateKey,
            expectedFrames: item.sceneFrames,
            actualFrames: facts?.frames,
            actualWidth: facts?.width,
            actualHeight: facts?.height
          });
          await rm(localClip, { force: true }).catch(() => undefined);
          return false;
        }
      }
      clipFiles[item.slot] = localClip;
      framesByScene[item.slot] = item.scene.frames;
      return true;
    } catch (error) {
      if (isDiskFullError(error)) throw wrapDiskFull(error);
      await rm(localClip, { force: true }).catch(() => undefined);
      return false;
    }
  };

  const clipFiles = new Array(sceneEntries.length);
  const uncachedEntries = [];
  let cacheHits = 0;
  const framesByScene = sceneEntries.map(() => 0);

  for (const item of sceneEntries) {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
    const cached = cachedByDigest.get(item.scene.bundleDigest);
    if (cached && cached.clip_key && (await tryUseCachedClip(item, cached.clip_key, cached))) {
      cacheHits += 1;
      continue;
    }
    if (item.scene.clipKey && item.scene.clipKey !== cached?.clip_key && (await tryUseCachedClip(item, item.scene.clipKey, null))) {
      cacheHits += 1;
      continue;
    }
    uncachedEntries.push(item);
  }

  // ---- 2. Download and verify bundles ONLY for cache misses before drawing ANY frame
  const misses = [];
  const verifiedByIndex = new Map();

  for (const item of uncachedEntries) {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
    const { scene, sceneIndex, sceneFrames } = item;
    if (!plateKeyOk(scene.bundleKey, manifest.projectId)) {
      throw new SceneNeedsFixError(sceneIndex, "The scene bundle location is invalid.");
    }
    const pagePath = join(scratch, `scene-${sceneIndex}.html`);
    try {
      await downloadInput(scene.bundleKey, pagePath);
    } catch (error) {
      if (isDiskFullError(error)) throw wrapDiskFull(error);
      throw new SceneNeedsFixError(sceneIndex, `Scene bundle could not be downloaded: ${messageOf(error)}`);
    }
    const rawHtml = await readFile(pagePath, "utf8");
    const digestCheck = verifyBundleDigest(rawHtml, scene, manifest);
    if (!digestCheck.ok) {
      throw new SceneNeedsFixError(sceneIndex, digestCheck.reason);
    }
    const bakedHtml = bakeSceneParams(rawHtml, scene.params);
    if (bakedHtml !== rawHtml) {
      try {
        await writeFile(pagePath, bakedHtml, "utf8");
      } catch (error) {
        throw wrapDiskFull(error);
      }
    }
    let verified;
    try {
      verified = await withWatchdog(
        (wdSignal) => verifyScene(pagePath, { frames: sceneFrames, signal: wdSignal }),
        { timeoutMs: checkTimeoutMs, label: `Scene ${sceneIndex + 1} check`, signal }
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isDiskFullError(error)) throw wrapDiskFull(error);
      if (!isBrowserCrashOrTimeout(error) && classifyFailure(error) === "code") {
        const repairOut = await control
          .op("plate.sendBackForRepair", {
            id: scene.variantId,
            gen: scene.gen,
            detail: messageOf(error)
          })
          .catch((err) => {
            log("warn", "plate_repair_op_failed", { variantId: scene.variantId, message: messageOf(err) });
            return null;
          });
        if (repairOut && (repairOut.applied || repairOut.duplicate) && !repairOut.exhausted) {
          await report?.({ stage: "retrying", done: 0, total: manifest.totalFrames, fixingScene: sceneIndex + 1 }).catch(() => undefined);
          const waited = await control
            .op("plate.awaitRepair", {
              id: scene.variantId,
              gen: scene.gen,
              minRev: repairOut.rev ?? (Number(scene.rev) || 0) + 1
            })
            .catch(() => null);
          if (waited?.repaired && waited.bundleKey && waited.bundleDigest && plateKeyOk(waited.bundleKey, manifest.projectId)) {
            scene.bundleKey = waited.bundleKey;
            scene.bundleDigest = waited.bundleDigest;
            if (waited.params && typeof waited.params === "object") {
              scene.params = waited.params;
            }
            await downloadInput(scene.bundleKey, pagePath);
            const repairedRawHtml = await readFile(pagePath, "utf8");
            const repairedBakedHtml = bakeSceneParams(repairedRawHtml, scene.params);
            if (repairedBakedHtml !== repairedRawHtml) {
              await writeFile(pagePath, repairedBakedHtml, "utf8");
            }
            try {
              verified = await withWatchdog(
                (wdSignal) => verifyScene(pagePath, { frames: sceneFrames, signal: wdSignal }),
                { timeoutMs: checkTimeoutMs, label: `Scene ${sceneIndex + 1} repaired check`, signal }
              );
              log("info", "plate_export_repaired_in_place", {
                projectId: manifest.projectId,
                sceneIndex,
                variantId: scene.variantId,
                rev: waited.rev
              });
            } catch (reverifyErr) {
              if (signal?.aborted) throw reverifyErr;
              throw new SceneNeedsFixError(sceneIndex, messageOf(reverifyErr));
            }
          }
        }
        if (!verified) {
          throw new SceneNeedsFixError(sceneIndex, messageOf(error));
        }
      } else {
        throw normalizeBrowserError(error);
      }
    }
    if (verified?.blocked?.length) {
      log("warn", "plate_network_blocked", { variantId: scene.variantId, blocked: verified.blocked.slice(0, 5) });
    }
    misses.push({ ...item, pagePath });
    verifiedByIndex.set(sceneIndex, verified);
  }

  const reportFrames = async () => {
    const done = framesByScene.reduce((a, b) => a + b, 0);
    await report?.({ stage: "frames", done, total: manifest.totalFrames });
  };
  await reportFrames();

  // ---- 3. Software-GL self-check & draw misses (with parallel fleet fan-out when multiple misses exist)
  let renderer = "cached";
  let drawnLocally = 0;
  let fleetCompleted = 0;
  if (misses.length > 0) {
    renderer = await probeRenderer({ signal, timeoutMs: checkTimeoutMs });
    checkSoftwareRenderer(renderer);
    log("info", "plate_gl_renderer", { projectId: manifest.projectId, renderer, misses: misses.length, cacheHits });

    // When multiple scenes are cache misses, enqueue the tail misses on `plate-render` so separate Fargate workers
    // spin up in parallel and draw from the back of the list while this worker draws from the front!
    if (misses.length > 1) {
      await control.op("plate.enqueueMisses", {
        ...fence,
        scenes: misses.slice(1).map((m) => ({
          variantId: m.scene.variantId,
          gen: m.scene.gen,
          bundleDigest: m.scene.bundleDigest
        }))
      }).catch(() => undefined);
    }

    const activeLocalControllers = new Map();
    let pollTimer = null;
    const checkFleetHits = async () => {
      const unresolved = misses.filter((m) => !clipFiles[m.slot]);
      if (unresolved.length === 0) return;
      try {
        const pollRes = await control.op("clip.lookup", {
          keys: unresolved.map(({ scene }) => ({
            bundleDigest: scene.bundleDigest,
            engineDigest: manifest.engineDigest,
            fontSetDigest: manifest.fontSetDigest,
            size,
            width: manifest.width,
            height: manifest.height
          }))
        });
        const pollMap = new Map();
        for (const r of pollRes?.clips ?? []) {
          if (r?.bundle_digest && r?.clip_key) pollMap.set(r.bundle_digest, r);
        }
        for (const m of unresolved) {
          if (clipFiles[m.slot]) continue;
          const hit = pollMap.get(m.scene.bundleDigest);
          if (!hit?.clip_key) continue;
          // Download to a fleet-staging path first so we don't collide with an active local ffmpeg write
          const fleetClipPath = join(scratch, `clip-fleet-${m.sceneIndex}.mp4`);
          const finalClipPath = join(scratch, `clip-${m.sceneIndex}.mp4`);
          try {
            await downloadOutput(hit.clip_key, fleetClipPath);
            const rowFramesValid = hit.frames ? Number(hit.frames) === m.sceneFrames : true;
            const rowWidthValid = hit.width ? Number(hit.width) === manifest.width : true;
            const rowHeightValid = hit.height ? Number(hit.height) === manifest.height : true;
            const statBytes = (await readFile(fleetClipPath)).length;
            if (statBytes > 0 && rowFramesValid && rowWidthValid && rowHeightValid) {
              const ctrl = activeLocalControllers.get(m.slot);
              if (ctrl) {
                ctrl.abort(Object.assign(new Error("Completed by peer worker"), { fleetDone: true, fleetClipPath, finalClipPath }));
              } else if (!clipFiles[m.slot]) {
                await rename(fleetClipPath, finalClipPath).catch(async () => {
                  await writeFile(finalClipPath, await readFile(fleetClipPath));
                });
                clipFiles[m.slot] = finalClipPath;
                framesByScene[m.slot] = m.scene.frames;
                fleetCompleted += 1;
                await reportFrames();
              }
            } else {
              await rm(fleetClipPath, { force: true }).catch(() => undefined);
            }
          } catch {
            await rm(fleetClipPath, { force: true }).catch(() => undefined);
          }
        }
      } catch {
        // Ignore transient lookup poll error
      }
    };

    if (misses.length > 1 && fleetPollMs > 0) {
      pollTimer = setInterval(() => {
        void checkFleetHits();
      }, fleetPollMs);
      pollTimer.unref?.();
    }

    let nextMiss = 0;
    const laneCount = Math.min(Math.max(1, concurrency), misses.length);
    try {
      const lanes = Array.from({ length: laneCount }, async () => {
        for (;;) {
          const idx = nextMiss++;
          if (idx >= misses.length) break;
          if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
          const item = misses[idx];
          const { slot, scene, sceneIndex, pagePath, sceneFrames } = item;
          if (clipFiles[slot]) continue;

          // Check if a peer Fargate worker already finished this scene before starting local Chromium
          if (misses.length > 1) {
            await checkFleetHits();
            if (clipFiles[slot]) continue;
          }

          const localClip = join(scratch, `clip-${sceneIndex}.mp4`);
          const verified = verifiedByIndex.get(sceneIndex);
          let lastReportAt = 0;
          const fleetAbort = new AbortController();
          activeLocalControllers.set(slot, fleetAbort);

          try {
            await withWatchdog(
              (wdSignal) =>
                renderScene(pagePath, localClip, {
                  frames: sceneFrames,
                  fps: FPS,
                  workers: RENDER_WORKERS,
                  signal: AbortSignal.any([wdSignal, fleetAbort.signal]),
                  onProgress: (n) => {
                    if (clipFiles[slot]) return;
                    framesByScene[slot] = Math.min(scene.frames, n);
                    const nowMs = Date.now();
                    if (nowMs - lastReportAt >= 1000) {
                      lastReportAt = nowMs;
                      void reportFrames().catch(() => undefined);
                    }
                  }
                }),
              { timeoutMs: drawTimeoutMs, label: `Scene ${sceneIndex + 1} draw`, signal }
            );
          } catch (error) {
            activeLocalControllers.delete(slot);
            if (fleetAbort.signal.aborted && fleetAbort.signal.reason?.fleetDone) {
              const { fleetClipPath, finalClipPath } = fleetAbort.signal.reason;
              await rm(localClip, { force: true }).catch(() => undefined);
              await rename(fleetClipPath, finalClipPath).catch(async () => {
                await writeFile(finalClipPath, await readFile(fleetClipPath));
              });
              clipFiles[slot] = finalClipPath;
              framesByScene[slot] = scene.frames;
              fleetCompleted += 1;
              await reportFrames();
              continue;
            }
            if (signal?.aborted) throw error;
            if (isDiskFullError(error)) throw wrapDiskFull(error);
            if (!isBrowserCrashOrTimeout(error) && classifyFailure(error) === "code") {
              await control.op("plate.sendBackForRepair", {
                id: scene.variantId,
                gen: scene.gen,
                detail: messageOf(error)
              }).catch(() => undefined);
              throw new SceneNeedsFixError(sceneIndex, messageOf(error));
            }
            throw normalizeBrowserError(error);
          } finally {
            activeLocalControllers.delete(slot);
          }

          const facts = await probeVideo(localClip);
          if (
            facts.frames !== sceneFrames ||
            facts.width !== manifest.width ||
            facts.height !== manifest.height ||
            Math.abs(facts.fps - FPS) > 1e-6
          ) {
            const detail = `The drawn clip is ${facts.width}x${facts.height} with ${facts.frames} frames, expected ${manifest.width}x${manifest.height} with ${sceneFrames}.`;
            await control.op("plate.sendBackForRepair", {
              id: scene.variantId,
              gen: scene.gen,
              detail
            }).catch(() => undefined);
            throw new SceneNeedsFixError(sceneIndex, detail);
          }

          const clipKey = clipCacheKey(
            manifest.projectId,
            scene.bundleDigest,
            manifest.engineDigest,
            manifest.fontSetDigest,
            manifest.width,
            manifest.height
          );
          const stillKey = stillCacheKey(
            manifest.projectId,
            scene.bundleDigest,
            manifest.engineDigest,
            manifest.fontSetDigest,
            manifest.width,
            manifest.height
          );
          const uploadedKeys = [];
          if (verified?.midPng) {
            const stillPath = join(scratch, `still-${sceneIndex}.png`);
            await writeFile(stillPath, verified.midPng);
            await uploadOutput(stillPath, stillKey, "image/png");
            uploadedKeys.push(stillKey);
          }
          await uploadOutput(localClip, clipKey, "video/mp4");
          uploadedKeys.push(clipKey);

          const rec = await control.op("clip.record", {
            ...fence,
            variantId: scene.variantId,
            gen: scene.gen,
            bundleDigest: scene.bundleDigest,
            engineDigest: manifest.engineDigest,
            fontSetDigest: manifest.fontSetDigest,
            size,
            width: manifest.width,
            height: manifest.height,
            fps: FPS,
            frames: sceneFrames,
            clipKey,
            stillKey: verified?.midPng ? stillKey : null,
            clipMeta: { ...facts, renderer, worker: hostname() }
          });

          if (!rec?.ok) {
            await deleteOut(uploadedKeys).catch(() => undefined);
            throw new Error("This attempt no longer owns the job.");
          }

          drawnLocally += 1;
          framesByScene[slot] = scene.frames;
          clipFiles[slot] = localClip;
          await reportFrames();
        }
      });
      await Promise.all(lanes);
    } finally {
      if (pollTimer) clearInterval(pollTimer);
    }
  }

  return {
    clipFiles,
    cacheHits,
    cacheMisses: misses.length,
    drawnLocally,
    fleetCompleted,
    renderer
  };
}

/**
 * The billed final render (render-video, kind "plate-film"): verifies every scene bundle in the frozen manifest, reuses
 * cached clips from `app.plate_clips` or draws misses on CPU (software GL), assembles voice/music/effects/subtitles,
 * and writes the finished MP4 to `output`. Keeps schema 1 readable for any in-flight legacy job.
 */
export async function renderPlateFilmJob(
  id,
  input,
  attempt,
  { control, signal, report, output, engineImpl, storageImpl, probeRenderer, concurrency }
) {
  if (!UUID.test(input.projectId ?? "")) throw new InputError("A valid project id is required.");
  const scratch = join("/tmp", `plate-film-${id}-a${attempt}`);
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    const manifest = await loadManifest(input.manifestKey, input.projectId, scratch, { storageImpl });
    let clips;
    let cacheStats = { cacheHits: 0, cacheMisses: 0, renderer: "legacy" };
    if (manifest.schema === 1) {
      const keys = await resolveClips(control, manifest, {
        signal,
        report: ({ done, total }) =>
          report({ stage: "frames", progress: 52 + Math.round((done / total) * 30), framesDone: done, framesTotal: total })
      });
      clips = await downloadClips(manifest, keys, scratch, { storageImpl });
    } else {
      const prepared = await prepareManifestClips(control, manifest, {
        fence: { jobId: id, attempt },
        scratch,
        signal,
        engineImpl,
        storageImpl,
        probeRenderer,
        concurrency,
        report: ({ done, total }) =>
          report({
            stage: "frames",
            progress: 52 + Math.round((done / Math.max(1, total)) * 30),
            framesDone: done,
            framesTotal: total
          })
      });
      clips = prepared.clipFiles;
      cacheStats = { cacheHits: prepared.cacheHits, cacheMisses: prepared.cacheMisses, renderer: prepared.renderer };
    }
    await report({ stage: "encoding", progress: 84, framesDone: manifest.totalFrames, framesTotal: manifest.totalFrames });
    const started = Date.now();
    const facts = await assemble(manifest, {
      clipFiles: clips,
      scratch,
      output,
      signal,
      storageImpl,
      onProgress: (p) =>
        void report({
          stage: "encoding",
          progress: 84 + Math.round(p * 12),
          framesDone: manifest.totalFrames,
          framesTotal: manifest.totalFrames
        }).catch(() => undefined)
    });
    log("info", "plate_film_assembled", {
      jobId: id,
      ...facts,
      ...cacheStats,
      scenes: manifest.scenes.length,
      assembleSeconds: Math.round((Date.now() - started) / 100) / 10
    });
    return { durationSeconds: Math.round((manifest.totalFrames / FPS) * 10) / 10, facts, ...cacheStats };
  } catch (error) {
    if (isDiskFullError(error)) {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      await cleanTempScratchDirs("/tmp").catch(() => undefined);
      throw wrapDiskFull(error);
    }
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// ================================================================ companion export
export async function handlePlateExport(job, { control, engineImpl, storageImpl, probeRenderer, concurrency } = {}) {
  const { exportId } = job.data ?? {};
  if (typeof exportId !== "string" || !UUID.test(exportId)) return;
  const { row } = await control.op("export.claim", { exportId }, { retry: false });
  if (!row) return;
  const uploadOutput = storageImpl?.uploadPlateOutput ?? uploadPlateOutput;
  const deleteOut = storageImpl?.deleteOutputs ?? deleteOutputs;
  const lost = new AbortController();
  const signal = AbortSignal.any([job.signal, lost.signal]);
  const scratch = join("/tmp", `plate-export-${row.id}-a${row.attempt}`);
  const key = `plates/${row.project_id}/exports/${dirname(row.manifest_key).split("/").pop()}/a${row.attempt}.mp4`;
  let uploaded = false, last = 0;
  const report = async (stage, progress, force = false) => {
    if (!force && Date.now() - last < 1000) return;
    last = Date.now();
    if (!(await control.op("export.progress", { id: row.id, attempt: row.attempt, stage, progress })).ok) {
      lost.abort(new Error("superseded"));
    }
  };
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    const manifest = await loadManifest(row.manifest_key, row.project_id, scratch, { storageImpl });
    await report("preparing", 10, true);
    let clips;
    if (manifest.schema === 1) {
      const keys = manifest.scenes.map((s) => s.clipKey);
      if (keys.some((k) => !k)) throw new InputError("The export manifest lists scenes that are not drawn.");
      clips = await downloadClips(manifest, keys, scratch, { storageImpl });
    } else {
      const prepared = await prepareManifestClips(control, manifest, {
        fence: { exportId: row.id, attempt: row.attempt },
        scratch,
        signal,
        engineImpl,
        storageImpl,
        probeRenderer,
        concurrency,
        report: ({ done, total }) =>
          report("frames", 15 + Math.round((done / Math.max(1, total)) * 45))
      });
      clips = prepared.clipFiles;
    }
    const output = join(scratch, "out.mp4");
    const started = Date.now();
    const facts = await assemble(manifest, {
      clipFiles: clips,
      scratch,
      output,
      signal,
      storageImpl,
      onProgress: (p) => void report("encoding", 60 + Math.round(p * 30)).catch(() => undefined)
    });
    await uploadOutput(output, key, "video/mp4");
    uploaded = true;
    const done = await control.op("export.ready", { id: row.id, attempt: row.attempt, outputKey: key });
    if (!done.ok) { await deleteOut([key]).catch(() => undefined); return; }
    log("info", "plate_export_ready", { exportId, projectId: row.project_id, aspect: row.aspect, ...facts, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    if (uploaded) await deleteOut([key]).catch(() => undefined);
    if (lost.signal.aborted) return;
    if (isDiskFullError(error)) {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      await cleanTempScratchDirs("/tmp").catch(() => undefined);
      await control.op("export.failed", {
        id: row.id,
        attempt: row.attempt,
        error: {
          code: DISK_FULL_CODE,
          message: DISK_FULL_MESSAGE
        }
      });
      return;
    }
    if (job.signal.aborted) throw error;
    const final = (error?.permanent && !isBrowserCrashOrTimeout(error)) || (job.retryCount ?? 0) >= 2;
    log("warn", "plate_export_failed", { exportId, final, code: error?.code, message: messageOf(error).slice(-300) });
    if (final) {
      await control.op("export.failed", {
        id: row.id,
        attempt: row.attempt,
        error: {
          code: error?.code ?? "export_failed",
          message: error?.permanent ? error.message : "The export did not finish. Try again."
        }
      });
      return;
    }
    await control.op("export.requeue", { id: row.id, attempt: row.attempt });
    throw normalizeBrowserError(error);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// ================================================================ re-bundle verification (phase 2: worker verifies in Chromium -> backend commits pointer swap)
export async function handlePlateRebundle(job, { control, engineImpl, storageImpl, checkTimeoutMs = getCheckTimeoutMs() } = {}) {
  const data = job.data ?? {};
  const {
    variantId,
    projectId,
    gen,
    rev,
    frames,
    expectedBundleDigest = null,
    bundleKey,
    bundleDigest: bDigest,
    bundleSha,
    bundleManifest,
    sourceKey,
    params = {}
  } = data;
  if (typeof variantId !== "string" || !UUID.test(variantId) || typeof projectId !== "string" || !UUID.test(projectId) || !Number.isInteger(gen) || !Number.isInteger(rev)) {
    return { status: "invalid_payload" };
  }
  const downloadInput = storageImpl?.downloadPlateInput ?? downloadPlateInput;
  const { verifyScene } = engineImpl ?? (await engine());
  const scratch = join("/tmp", `plate-rebundle-${variantId}-g${gen}-r${rev}`);
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    if (!plateKeyOk(bundleKey, projectId)) {
      log("warn", "plate_rebundle_verify_failed", { variantId, projectId, gen, rev, reason: "invalid_bundle_key" });
      return { status: "failed", reason: "invalid_bundle_key" };
    }
    const pagePath = join(scratch, "scene.html");
    await downloadInput(bundleKey, pagePath);
    const rawHtml = await readFile(pagePath, "utf8");
    const eDigest = typeof bundleManifest?.engineDigest === "string" ? bundleManifest.engineDigest : "engine:unknown";
    const digestCheck = verifyBundleDigest(
      rawHtml,
      { bundleSha, bundleDigest: bDigest, params, paramsDigest: paramsDigest(params) },
      { engineDigest: eDigest, fontSetDigest: fontSetDigest() }
    );
    if (!digestCheck.ok) {
      log("warn", "plate_rebundle_verify_failed", { variantId, projectId, gen, rev, reason: digestCheck.reason });
      return { status: "failed", reason: digestCheck.reason };
    }
    const bakedHtml = bakeSceneParams(rawHtml, params);
    if (bakedHtml !== rawHtml) {
      await writeFile(pagePath, bakedHtml, "utf8");
    }
    let verified;
    try {
      verified = await withWatchdog(
        (wdSignal) => verifyScene(pagePath, { frames: Number(frames) || 90, signal: wdSignal }),
        { timeoutMs: checkTimeoutMs, label: "Chromium rebundle check", signal: job.signal }
      );
    } catch (error) {
      if (job.signal?.aborted) throw error;
      if (isDiskFullError(error)) throw wrapDiskFull(error);
      if (isBrowserCrashOrTimeout(error)) throw normalizeBrowserError(error);
      log("warn", "plate_rebundle_verify_failed", { variantId, projectId, gen, rev, reason: messageOf(error).slice(0, 300) });
      return { status: "failed", reason: messageOf(error) };
    }
    if (verified?.blocked?.length) {
      log("warn", "plate_network_blocked", { variantId, blocked: verified.blocked.slice(0, 5) });
    }
    const committed = await control.op("rebundle.commit", {
      variantId,
      gen,
      rev,
      expectedBundleDigest,
      bundleKey,
      bundleDigest: bDigest,
      bundleManifest,
      sourceKey,
      params,
      author: "engine-rebundle",
      host: "worker"
    });
    if (!committed?.committed) {
      log("info", "plate_rebundle_fenced", { variantId, projectId, gen, rev, reason: committed?.reason ?? "fenced" });
      return { status: "fenced", reason: committed?.reason ?? "fenced" };
    }
    log("info", "plate_rebundle_committed", { variantId, projectId, gen, rev: committed.rev, bundleKey, bundleDigest: bDigest });
    return { status: "committed", rev: committed.rev, bundleKey, bundleDigest: bDigest };
  } catch (error) {
    if (isDiskFullError(error)) {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      await cleanTempScratchDirs("/tmp").catch(() => undefined);
      throw wrapDiskFull(error);
    }
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
