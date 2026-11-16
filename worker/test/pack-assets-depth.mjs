// Template-pack pictures on the worker: the capture page gets them as data: URLs (window.__ASSETS__) from the keys its bundle names,
// a missing picture is left out, other projects' keys are refused; the depth job writes a map or a failure marker; and, when a
// Chromium and the ONNX model are present locally, a real scene draws its picture and a real depth map is made.
// No network. Run: node worker/test/pack-assets-depth.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { clipCacheDigest, injectPackAssets, withAssetData } from "../src/pack-assets.mjs";
import { depthCapable, depthPng, handlePlateDepth, inputSize } from "../src/depth.mjs";

const PID = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";
const scratch = await mkdtemp(join(tmpdir(), "pack-assets-test-"));
const red = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer();

// ---- fake object storage (two buckets)
const buckets = { uploads: new Map(), outputs: new Map() };
const download = (bucket) => async (key, file) => {
  const bytes = buckets[bucket].get(key);
  if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
  await writeFile(file, bytes);
};
const storage = {
  downloadPlateInput: download("uploads"),
  downloadPlateOutput: download("outputs"),
  uploadPlateOutput: async (file, key) => { buckets.outputs.set(key, await readFile(file)); return 1; }
};
buckets.uploads.set(`plates/${PID}/assets/abc.png`, red);
buckets.uploads.set(`plates/${OTHER}/assets/abc.png`, red);

// ---- injection
const keys = { "set-gorge": `u:plates/${PID}/assets/abc.png`, "depth-gorge": `o:plates/${PID}/assets/abc.depth.png`, "set-other": `u:plates/${OTHER}/assets/abc.png` };
const page = `<script>window.__ASSETS__={};window.__BAKE_SRC__={};</script><script>run()</script>`;
const logs = [];
const injected = await injectPackAssets(page, PID, keys, storage, scratch, (level, event, f) => logs.push(event));
const assets = JSON.parse(/window\.__ASSETS__=(\{.*?\});window\.__BAKE_SRC__/.exec(injected)[1]);
assert.deepEqual(Object.keys(assets), ["set-gorge"], "only this project's existing pictures are inlined");
assert.equal(assets["set-gorge"], `data:image/png;base64,${red.toString("base64")}`);
assert.ok(logs.includes("plate_asset_missing"), "a missing depth map is logged and left out");
assert.ok(logs.includes("plate_asset_ref_refused"), "another project's key is refused");
const noPics = "<script>window.__ASSETS__={};window.__BAKE_SRC__={};</script>";
assert.equal(await injectPackAssets(noPics, PID, {}, storage, scratch), noPics, "scenes without pictures are untouched");
// the clip cache identity: unchanged for scenes without pictures; bundle + pictures otherwise
assert.equal(clipCacheDigest({ bundleDigest: "b1" }), "b1");
assert.notEqual(clipCacheDigest({ bundleDigest: "b1", assetsDigest: "p1" }), clipCacheDigest({ bundleDigest: "b1", assetsDigest: "p2" }), "a landed depth map or a redrawn picture is a new clip");
assert.equal(clipCacheDigest({ bundleDigest: "b1", assetsDigest: "p1" }), clipCacheDigest({ bundleDigest: "b1", assetsDigest: "p1" }));
assert.equal(withAssetData(noPics, {}), noPics);
assert.ok(!withAssetData(noPics, { a: "data:image/png;base64,<" }).includes("<\"}"), "< is escaped inside the script");

// ---- the depth job: success, failure marker, bad payload
assert.deepEqual(inputSize(1536, 2752), { width: 518, height: 924 }, "short side 518, multiples of 14");
assert.deepEqual(inputSize(1920, 1080), { width: 924, height: 518 });
const job = (extra = {}) => ({ data: { projectId: PID, name: "depth-gorge", imageKey: `plates/${PID}/assets/abc.png`, depthKey: `plates/${PID}/assets/abc.depth.png`, failedKey: `plates/${PID}/assets/abc.depth.failed`, ...extra } });
assert.deepEqual(await handlePlateDepth(job(), { storageImpl: storage, depthImpl: async () => Buffer.from("fake-png") }), { status: "done" });
assert.equal(buckets.outputs.get(`plates/${PID}/assets/abc.depth.png`).toString(), "fake-png");
assert.deepEqual(await handlePlateDepth(job({ depthKey: `plates/${PID}/assets/x.depth.png`, failedKey: `plates/${PID}/assets/x.depth.failed` }), { storageImpl: storage, depthImpl: async () => { throw new Error("unreadable"); } }), { status: "failed" });
assert.match(buckets.outputs.get(`plates/${PID}/assets/x.depth.failed`).toString(), /unreadable/, "a failure writes the marker the backend reads");
assert.deepEqual(await handlePlateDepth(job({ imageKey: `plates/${OTHER}/assets/abc.png` }), { storageImpl: storage }), { status: "invalid_payload" });
assert.deepEqual(await handlePlateDepth(job({ depthKey: "plates/../x" }), { storageImpl: storage }), { status: "invalid_payload" });

// ---- the real model (skipped when worker/models/depth-anything-v2-small.onnx is not downloaded)
if (depthCapable()) {
  // near (bottom, large) bright square on a far (top) gradient: the output keeps the size, is one channel, and is not flat
  const img = await sharp({ create: { width: 360, height: 640, channels: 3, background: "#6a8fb5" } })
    .composite([{ input: await sharp({ create: { width: 360, height: 260, channels: 3, background: "#3c5a1e" } }).png().toBuffer(), top: 380, left: 0 }])
    .jpeg().toBuffer();
  const t0 = Date.now();
  const png = await depthPng(img);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 360);
  assert.equal(meta.height, 640);
  assert.equal(meta.channels, 1, "8-bit greyscale");
  const stats = await sharp(png).stats();
  assert.ok(stats.channels[0].max - stats.channels[0].min > 50, "the map is not flat");
  console.log(`depth model: ${Date.now() - t0} ms for 360x640`);
} else {
  console.log("depth model not present locally: real-model check skipped");
}

// ---- a real scene in Chromium reads its picture (skipped without a local Chromium for playwright-core)
let chromiumOk = false;
try { const { chromium } = await import("playwright-core"); chromiumOk = existsSync(chromium.executablePath()) || Boolean(process.env.PLATE_BROWSER_PATH); } catch { /* no playwright */ }
if (chromiumOk) {
  const { bundleScene } = await import("../../packages/plate-engine/lib/engine.mjs");
  const { verifyScene } = await import("../../packages/plate-engine/lib/capture.mjs");
  const code = `import type { Ctx, Env } from "./core";
import type { Film } from "./film";
const durationFrames = 6;
function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, 1920);
  const s = env.image("set-gorge"); const d = env.image("depth-gorge");
  if (s) ctx.drawImage(s, 0, 0, 1080, 1920);
  if (d) { ctx.fillStyle = "#00f"; ctx.fillRect(0, 0, 10, 10); }
}
export const film: Film = { meta: { title: "t", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames }, assets: { images: ((globalThis as any).__ASSETS__ ?? {}) as Record<string, string> }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
`;
  const bundle = await bundleScene({ look: "illus-flat-vector", code, frames: 6, aspect: "9:16" });
  const dir = join(scratch, "page");
  await mkdir(dir, { recursive: true });
  const pagePath = join(dir, "scene.html");
  const html = await injectPackAssets(bundle.html, PID, { "set-gorge": keys["set-gorge"], "depth-gorge": `o:plates/${PID}/assets/none.depth.png` }, storage, dir);
  await writeFile(pagePath, html);
  const verified = await verifyScene(pagePath, { frames: 6 });
  const { data, info } = await sharp(verified.midPng).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.deepEqual(px(540, 960), [255, 0, 0], "the scene drew its picture (export path)");
  assert.notDeepEqual(px(2, 2), [0, 0, 255], "the missing depth map is absent: the scene drew without it");
  console.log("chromium: scene drew its inlined picture; missing depth map left out");
} else {
  console.log("no local Chromium for playwright-core: capture check skipped");
}

await rm(scratch, { recursive: true, force: true });
console.log("pack-assets-depth: ok");
