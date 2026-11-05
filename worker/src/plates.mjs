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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, dirname } from "node:path";
import sharp from "sharp";
import { run } from "./compose.mjs";
import { deleteOutputs, downloadPlateInput, downloadPlateOutput, plateKeyOk, uploadPlateOutput } from "./storage.mjs";

export const PLATE_RENDER_QUEUE = "plate-render";
export const PLATE_EXPORT_QUEUE = "plate-export";
export const PLATE_REBUNDLE_QUEUE = "plate-rebundle";
const AUTHOR_QUEUE = "plate-author";
const UUID = /^[a-f0-9-]{36}$/i;
const FPS = 30;
const PROJECT_CAP = Number.parseInt(process.env.PLATE_PROJECT_CAP ?? "2", 10);
const STALE_SECONDS = Number.parseInt(process.env.PLATE_STALE_SECONDS ?? "90", 10);
const MAX_AUTHOR_CALLS = Number.parseInt(process.env.PLATE_MAX_AUTHOR_CALLS ?? "3", 10);
const RENDER_WORKERS = Math.max(1, Number.parseInt(process.env.PLATE_FRAME_WORKERS ?? "2", 10));
const PLATE_DRAW_CONCURRENCY = Math.max(1, Number.parseInt(process.env.PLATE_CONCURRENCY ?? "2", 10));
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

/** Probes Chromium's active WebGL renderer string in the worker environment. */
export async function probeRendererString({
  executablePath = process.env.PLATE_BROWSER_PATH || process.env.HYPERFRAMES_BROWSER_PATH || undefined,
  force = false
} = {}) {
  if (process.env.PLATE_FAKE_GL_RENDERER) {
    return process.env.PLATE_FAKE_GL_RENDERER;
  }
  if (!force && cachedRendererString) return cachedRendererString;
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath,
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
  try {
    const page = await browser.newPage();
    const renderer = await page.evaluate(() => {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl") || c.getContext("webgl2");
      if (!gl) return "Software Canvas2D (SwiftShader)";
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const unmasked = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
      return String(unmasked || gl.getParameter(gl.RENDERER) || "");
    });
    cachedRendererString = renderer;
    return renderer;
  } finally {
    await browser.close().catch(() => undefined);
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
const fenceRetry = async (control, row) => (await control.op("plate.retry", ref(row))).ok === true;

/** A deterministic defect of the scene code goes back to authoring (bounded); anything else is infrastructure. */
async function sendBackForRepair(control, row, detail) {
  return control.op("plate.sendBackForRepair", { ...ref(row), authored: row.authored, sourceKey: row.source_key, detail });
}

export async function handlePlateRender(job, { control, probeRenderer = probeRendererString } = {}) {
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
  const started = Date.now();
  const lost = new AbortController();
  const signal = AbortSignal.any([job.signal, lost.signal]);
  const scratch = join("/tmp", `plate-${row.id}-a${row.render_attempt}`);
  const uploaded = [];
  let framesDone = 0, stage = "verifying", ticking = Promise.resolve();
  const tick = setInterval(() => {
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
    await downloadPlateInput(row.bundle_key, page);
    const [w, h] = DIM[row.aspect] ?? [];
    if (row.width !== w || row.height !== h || row.fps !== FPS) throw new InputError("The scene's size does not match its ratio.");
    const prefix = row.bundle_key.slice(0, row.bundle_key.lastIndexOf("/") + 1);
    const { verifyScene, renderScene, probeVideo, classifyFailure } = await engine();

    const renderer = await probeRenderer({ signal });
    checkSoftwareRenderer(renderer);

    // 1. verify in Chromium: first, true middle and last frame, each drawn twice and again on a second page
    const t0 = Date.now();
    let verified;
    try {
      verified = await verifyScene(page, { frames: row.frames, signal });
    } catch (error) {
      if (lost.signal.aborted) return;
      if (job.signal.aborted) throw error;
      if (classifyFailure(error) === "code") {
        const sent = await sendBackForRepair(control, row, messageOf(error));
        log("warn", "plate_scene_code_failure", { variantId, scene: row.scene_index, aspect: row.aspect, exhausted: sent.exhausted, message: messageOf(error).slice(0, 300) });
        return;
      }
      throw error;
    }
    if (verified.blocked.length) log("warn", "plate_network_blocked", { variantId, blocked: verified.blocked.slice(0, 5) });
    const verifyMs = Date.now() - t0;
    const stillKey = `${prefix}still-a${row.render_attempt}.png`;
    await writeFile(join(scratch, "still.png"), verified.midPng);
    await uploadPlateOutput(join(scratch, "still.png"), stillKey, "image/png");
    uploaded.push(stillKey);
    if (lost.signal.aborted) return;

    // 2. draw every frame and encode
    stage = "rendering";
    const t1 = Date.now();
    const video = join(scratch, "clip.mp4");
    await renderScene(page, video, { frames: row.frames, fps: FPS, workers: RENDER_WORKERS, signal, onProgress: (n) => { framesDone = n; } });
    const renderMs = Date.now() - t1;
    const facts = await probeVideo(video);
    if (facts.frames !== row.frames || facts.width !== w || facts.height !== h || Math.abs(facts.fps - FPS) > 1e-6) {
      throw Object.assign(new Error(`The drawn clip is ${facts.width}x${facts.height} with ${facts.frames} frames, expected ${w}x${h} with ${row.frames}.`), { kind: "code" });
    }
    const clipKey = `${prefix}clip-a${row.render_attempt}.mp4`;
    const t2 = Date.now();
    await uploadPlateOutput(video, clipKey, "video/mp4");
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
      await deleteOutputs(uploaded).catch(() => undefined);
      log("info", "plate_render_superseded", { variantId, gen: row.gen, attempt: row.render_attempt });
      return;
    }
    log("info", "plate_drawn", { variantId, projectId: row.project_id, scene: row.scene_index, aspect: row.aspect, frames: row.frames, verifyMs, renderMs, uploadMs, seconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    if (lost.signal.aborted) {
      await deleteOutputs(uploaded).catch(() => undefined);
      log("info", "plate_render_dropped", { variantId, gen: row.gen });
      return;
    }
    if (error?.permanent) {
      await fenceFailed(control, row, { code: "scene_invalid", message: error.message });
      return;
    }
    const { classifyFailure } = await engine();
    if (!job.signal.aborted && classifyFailure(error) === "code") {
      // A scene that fails while drawing (or draws a clip that breaks its contract) is a code defect: bounded repair.
      await sendBackForRepair(control, row, messageOf(error));
      return;
    }
    const final = (job.retryCount ?? 0) >= 2;
    log("warn", "plate_render_interrupted", { variantId, gen: row.gen, attempt: row.render_attempt, final, message: messageOf(error).slice(-300) });
    await deleteOutputs(uploaded).catch(() => undefined);
    if (job.signal.aborted) throw error; // worker stopping or heartbeat lost: the lease ages out and a retry takes over
    // Browser start-up, Spot interruption, storage or network failure: the same bundle is tried again, no model call.
    if (final) await fenceFailed(control, row, { code: "render_failed", message: "Drawing this scene did not finish. Press Draw to try again.", detail: messageOf(error).slice(-400) });
    else await fenceRetry(control, row);
    if (!final) throw error;
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

/** The Free plan's mark ("Made with Greedy Motion", lower right), sized from the frame like the other pipeline's. */
export async function renderWatermarkPng(w, h) {
  const size = Math.round(w * 0.016), pad = Math.round(w * 0.02);
  const label = "Made with Greedy Motion";
  const padX = Math.round(size * 0.8), padY = Math.round(size * 0.45);
  const boxW = Math.round(label.length * size * 0.56 + padX * 2), boxH = Math.round(size + padY * 2);
  const x = w - pad - boxW, y = h - pad - boxH;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${Math.round(boxH / 2)}" fill="rgba(10,13,18,0.62)"/><text x="${x + boxW / 2}" y="${y + padY + size * 0.82}" text-anchor="middle" font-family="'Plus Jakarta Sans', Inter, Arial, sans-serif" font-size="${size}" font-weight="600" fill="#ffffff">${escapeXml(label)}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Assembles the film from a manifest: scene clips (already local), voice, music, word-aligned effects, subtitles, watermark.
 * One timeline, integer frames. Stream copy only when the clips are exactly the timeline and nothing touches pixels.
 * Returns facts about what it wrote.
 */
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
      const png = join(scratch, "watermark.png");
      await writeFile(png, await renderWatermarkPng(W, H));
      overlayFiles.push({ png, enable: null });
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
  else args.push("-map", "[vout]", ...aargs, "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", String(FPS), "-t", total.toFixed(6), "-movflags", "+faststart", output);
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
 *  1. Downloads and verifies EVERY scene bundle first (storage existence, SHA-256 bundleDigest check, in-browser verifyScene).
 *     If any scene fails verification, stops immediately BEFORE drawing any frame, sends the scene to `plate.sendBackForRepair`
 *     (for code failures), and throws `SceneNeedsFixError` (`code: "scene_needs_fix"`, non-retriable).
 *  2. Looks up each scene's clip in `app.plate_clips` by `(bundleDigest, engineDigest, fontSetDigest, size)`.
 *  3. Runs the Software-GL self-check (`checkSoftwareRenderer`), then draws cache misses with bounded concurrency (`PLATE_CONCURRENCY`),
 *     uploads each to a content-addressed key, and records it via `clip.record` (fenced by job attempt).
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
    concurrency = PLATE_DRAW_CONCURRENCY
  }
) {
  const downloadInput = storageImpl?.downloadPlateInput ?? downloadPlateInput;
  const downloadOutput = storageImpl?.downloadPlateOutput ?? downloadPlateOutput;
  const uploadOutput = storageImpl?.uploadPlateOutput ?? uploadPlateOutput;
  const deleteOut = storageImpl?.deleteOutputs ?? deleteOutputs;
  const { verifyScene, renderScene, probeVideo, classifyFailure } = engineImpl ?? (await engine());

  await mkdir(scratch, { recursive: true });
  const size = `${manifest.width}x${manifest.height}`;
  const pages = [];
  const verifiedByIndex = new Map();

  // ---- 1. Download and verify EVERY bundle before drawing ANY frame
  for (const [idx, scene] of manifest.scenes.entries()) {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
    const sceneIndex = scene.index ?? idx;
    if (!plateKeyOk(scene.bundleKey, manifest.projectId)) {
      throw new SceneNeedsFixError(sceneIndex, "The scene bundle location is invalid.");
    }
    const pagePath = join(scratch, `scene-${sceneIndex}.html`);
    try {
      await downloadInput(scene.bundleKey, pagePath);
    } catch (error) {
      throw new SceneNeedsFixError(sceneIndex, `Scene bundle could not be downloaded: ${messageOf(error)}`);
    }
    const rawHtml = await readFile(pagePath, "utf8");
    const digestCheck = verifyBundleDigest(rawHtml, scene, manifest);
    if (!digestCheck.ok) {
      throw new SceneNeedsFixError(sceneIndex, digestCheck.reason);
    }
    const bakedHtml = bakeSceneParams(rawHtml, scene.params);
    if (bakedHtml !== rawHtml) {
      await writeFile(pagePath, bakedHtml, "utf8");
    }
    const sceneFrames = Number(scene.bundleFrames ?? scene.frames);
    let verified;
    try {
      verified = await verifyScene(pagePath, { frames: sceneFrames, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (classifyFailure(error) === "code") {
        await control.op("plate.sendBackForRepair", {
          id: scene.variantId,
          gen: scene.gen,
          detail: messageOf(error)
        }).catch((err) => log("warn", "plate_repair_op_failed", { variantId: scene.variantId, message: messageOf(err) }));
        throw new SceneNeedsFixError(sceneIndex, messageOf(error));
      }
      throw error;
    }
    if (verified?.blocked?.length) {
      log("warn", "plate_network_blocked", { variantId: scene.variantId, blocked: verified.blocked.slice(0, 5) });
    }
    pages.push({ scene, sceneIndex, pagePath, sceneFrames });
    verifiedByIndex.set(sceneIndex, verified);
  }

  // ---- 2. Look up clip cache by (bundleDigest, engineDigest, fontSetDigest, size)
  const lookupRes = await control.op("clip.lookup", {
    keys: pages.map(({ scene }) => ({
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

  const clipFiles = new Array(pages.length);
  const misses = [];
  let cacheHits = 0;
  const framesByScene = pages.map(() => 0);

  for (let i = 0; i < pages.length; i++) {
    const item = pages[i];
    const cached = cachedByDigest.get(item.scene.bundleDigest);
    if (cached && cached.clip_key) {
      const localClip = join(scratch, `clip-${item.sceneIndex}.mp4`);
      const downloaded = await downloadOutput(cached.clip_key, localClip).then(() => true, () => false);
      if (downloaded) {
        clipFiles[i] = localClip;
        framesByScene[i] = item.scene.frames;
        cacheHits += 1;
        continue;
      }
    }
    misses.push({ slot: i, ...item });
  }

  const reportFrames = async () => {
    const done = framesByScene.reduce((a, b) => a + b, 0);
    await report?.({ stage: "frames", done, total: manifest.totalFrames });
  };
  await reportFrames();

  // ---- 3. Software-GL self-check & draw misses with bounded concurrency
  let renderer = "cached";
  if (misses.length > 0) {
    renderer = await probeRenderer({ signal });
    checkSoftwareRenderer(renderer);
    log("info", "plate_gl_renderer", { projectId: manifest.projectId, renderer, misses: misses.length, cacheHits });

    let nextMiss = 0;
    const laneCount = Math.min(Math.max(1, concurrency), misses.length);
    const lanes = Array.from({ length: laneCount }, async () => {
      for (;;) {
        const idx = nextMiss++;
        if (idx >= misses.length) break;
        if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
        const { slot, scene, sceneIndex, pagePath, sceneFrames } = misses[idx];
        const localClip = join(scratch, `clip-${sceneIndex}.mp4`);
        const verified = verifiedByIndex.get(sceneIndex);
        let lastReportAt = 0;

        try {
          await renderScene(pagePath, localClip, {
            frames: sceneFrames,
            fps: FPS,
            workers: RENDER_WORKERS,
            signal,
            onProgress: (n) => {
              framesByScene[slot] = Math.min(scene.frames, n);
              const nowMs = Date.now();
              if (nowMs - lastReportAt >= 1000) {
                lastReportAt = nowMs;
                void reportFrames().catch(() => undefined);
              }
            }
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          if (classifyFailure(error) === "code") {
            await control.op("plate.sendBackForRepair", {
              id: scene.variantId,
              gen: scene.gen,
              detail: messageOf(error)
            }).catch(() => undefined);
            throw new SceneNeedsFixError(sceneIndex, messageOf(error));
          }
          throw error;
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

        framesByScene[slot] = scene.frames;
        clipFiles[slot] = localClip;
        await reportFrames();
      }
    });
    await Promise.all(lanes);
  }

  return {
    clipFiles,
    cacheHits,
    cacheMisses: misses.length,
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
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
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
    if (job.signal.aborted) throw error;
    const final = error?.permanent || (job.retryCount ?? 0) >= 2;
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
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// ================================================================ re-bundle verification (phase 2: worker verifies in Chromium -> backend commits pointer swap)
export async function handlePlateRebundle(job, { control, engineImpl, storageImpl } = {}) {
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
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
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
      verified = await verifyScene(pagePath, { frames: Number(frames) || 90, signal: job.signal });
    } catch (error) {
      if (job.signal?.aborted) throw error;
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
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
