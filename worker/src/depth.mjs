// Depth maps for template sets (`plate-depth` { projectId, name, imageKey, depthKey, failedKey }): one picture in (uploads bucket),
// one 8-bit greyscale PNG out (outputs bucket), near = white, the same size as the picture. Scenes read it as `depth-<place>` and
// draw flat without it, so any failure that is not infrastructure writes a small marker (failedKey) instead of failing a film.
//
// Model: Depth Anything V2 Small, ONNX export by onnx-community, licence Apache-2.0 (model card front matter `license: apache-2.0`
// on both https://huggingface.co/onnx-community/depth-anything-v2-small and its base
// https://huggingface.co/depth-anything/Depth-Anything-V2-Small; checked 2026-11-16). Only the Small checkpoint is Apache-2.0;
// Base/Large are CC-BY-NC-4.0 and must never be swapped in. File: onnx/model.onnx at revision 4472b7362082ad9968fee890ca0f1e5aca36b93d
// (fp32, 99,060,839 bytes, sha256 afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c), baked into the worker image
// by worker/Dockerfile at /app/models/depth-anything-v2-small.onnx (DEPTH_MODEL_PATH overrides).
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLATE_DEPTH_QUEUE = "plate-depth";
export const DEPTH_MODEL_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx";
export const DEPTH_MODEL_SHA256 = "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c";
export const DEPTH_MODEL_LICENSE = "Apache-2.0";

const here = dirname(fileURLToPath(import.meta.url));
/** The image bakes the model next to src/ (/app/models); a checkout keeps it in worker/models (git-ignored). */
export const depthModelPath = () => process.env.DEPTH_MODEL_PATH || resolve(here, "..", "models", "depth-anything-v2-small.onnx");
export const depthCapable = () => existsSync(depthModelPath());

const log = (level, event, fields = {}) => console.log(JSON.stringify({ level, event, at: new Date().toISOString(), ...fields }));
const ASSET_KEY = /^plates\/([0-9a-f-]{36})\/assets\/[A-Za-z0-9_.-]+$/i;
const keyOk = (key, projectId) => typeof key === "string" && !key.includes("..") && ASSET_KEY.exec(key)?.[1] === projectId;

// Depth Anything V2 preprocessing (preprocessor_config.json): the short side to 518, both sides a multiple of 14, bicubic,
// rescale 1/255, ImageNet mean/std, NCHW float32.
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
export const inputSize = (width, height, short = 518) => {
  const s = short / Math.min(width, height);
  const m = (v) => Math.max(14, Math.round((v * s) / 14) * 14);
  return { width: m(width), height: m(height) };
};

let sessionPromise;
async function session() {
  sessionPromise ??= (async () => {
    const ort = await import("onnxruntime-node");
    const s = await ort.InferenceSession.create(depthModelPath(), { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: Math.max(1, Number(process.env.DEPTH_THREADS) || 2) });
    return { ort, s };
  })();
  sessionPromise.catch(() => { sessionPromise = undefined; });
  return sessionPromise;
}

/** Image bytes (any format sharp reads) -> greyscale PNG of the same size, near = white. */
export async function depthPng(imageBytes) {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(imageBytes).metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H) throw Object.assign(new Error("The set picture could not be read."), { kind: "input" });
  const size = inputSize(W, H);
  const { data } = await sharp(imageBytes).removeAlpha().toColourspace("srgb").resize(size.width, size.height, { fit: "fill", kernel: "cubic" }).raw().toBuffer({ resolveWithObject: true });
  const plane = size.width * size.height;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  const { ort, s } = await session();
  const feeds = { [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size.height, size.width]) };
  const out = (await s.run(feeds))[s.outputNames[0]];
  const pred = out.data; // relative inverse depth: larger = nearer
  const [oh, ow] = out.dims.slice(-2);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pred.length; i++) { const v = pred[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const grey = Buffer.alloc(pred.length);
  for (let i = 0; i < pred.length; i++) grey[i] = Math.round(((pred[i] - lo) / span) * 255);
  return sharp(grey, { raw: { width: ow, height: oh, channels: 1 } }).resize(W, H, { fit: "fill", kernel: "cubic" }).toColourspace("b-w").png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Worker handler. Infrastructure errors (storage, a missing model in an image that should have one) throw so the queue retries;
 * a picture the model cannot read writes the failed marker, and the scene draws flat.
 */
export async function handlePlateDepth(job, { storageImpl, depthImpl } = {}) {
  const depthImplGiven = Boolean(depthImpl);
  depthImpl ??= depthPng;
  const { projectId, imageKey, depthKey, failedKey, name } = job.data ?? {};
  if (![imageKey, depthKey, failedKey].every((k) => keyOk(k, projectId))) return { status: "invalid_payload" };
  const storage = storageImpl ?? (await import("./storage.mjs"));
  const scratch = join("/tmp", `plate-depth-${String(depthKey).split("/").pop()}`);
  const started = Date.now();
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    const src = join(scratch, "image"), out = join(scratch, "depth.png");
    await storage.downloadPlateInput(imageKey, src);
    let png;
    try {
      png = await depthImpl(await readFile(src));
    } catch (error) {
      // No model or no runtime in this image: an infrastructure problem, retried (the scene stops waiting after DEPTH_WAIT and draws flat).
      if (error?.code === "ERR_MODULE_NOT_FOUND" || (!depthImplGiven && !depthCapable())) throw error;
      await writeFile(join(scratch, "failed.txt"), String(error?.message ?? error).slice(0, 500));
      await storage.uploadPlateOutput(join(scratch, "failed.txt"), failedKey, "text/plain");
      log("warn", "plate_depth_failed", { projectId, name, message: String(error?.message ?? error).slice(0, 300) });
      return { status: "failed" };
    }
    await writeFile(out, png);
    await storage.uploadPlateOutput(out, depthKey, "image/png");
    log("info", "plate_depth_done", { projectId, name, ms: Date.now() - started, bytes: png.length });
    return { status: "done" };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

// CLI for a manual check: node worker/src/depth.mjs <in.jpg> <out.png>
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error("usage: node worker/src/depth.mjs <in> <out.png>"); process.exit(2); }
  const t0 = Date.now();
  const png = await depthPng(await readFile(input));
  await writeFile(output, png);
  console.log(JSON.stringify({ output, ms: Date.now() - t0, bytes: png.length }));
}
