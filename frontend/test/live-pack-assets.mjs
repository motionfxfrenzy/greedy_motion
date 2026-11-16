import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { fetchBundle, injectAssetDataUrls, inlineBundleAssets, reportCheck, serverBundleDigest } from "../lib/live/api.ts";
import { extractBundleScripts } from "../lib/live/worker-host.ts";
import { bundleScene } from "../../packages/plate-engine/lib/engine.mjs";

// Template-pack pictures in the preview: the bundle route links the pictures a scene's bundle names; fetchBundle downloads them and
// writes them into the page's window.__ASSETS__ as data: URLs (the sandboxed worker has no network), a picture that fails to load is
// left out, and the contained WorkerHost draws the scene with its picture.

const HERE = dirname(fileURLToPath(import.meta.url));
const PNG_1PX_RED = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const PAGE = "<script>window.__ASSETS__={};window.__BAKE_SRC__={};</script><script>run()</script>";

const fakeStorage = () => async (input) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("set-gorge")) return new Response(Buffer.from(PNG_1PX_RED, "base64"), { status: 200, headers: { "content-type": "image/png" } });
  return new Response("missing", { status: 404 });
};

test("inlineBundleAssets writes data: URLs into window.__ASSETS__ and leaves out pictures that fail", async () => {
  const html = await inlineBundleAssets(PAGE, { "set-gorge": "https://r2.example/set-gorge.jpg?sig=1", "depth-gorge": "https://r2.example/depth.png?sig=1", "BAD NAME": "https://x" }, fakeStorage());
  const assets = JSON.parse(/window\.__ASSETS__=(\{.*?\});/.exec(html)[1]);
  assert.deepEqual(Object.keys(assets), ["set-gorge"]);
  assert.equal(assets["set-gorge"], `data:image/png;base64,${PNG_1PX_RED}`);
  assert.equal(await inlineBundleAssets(PAGE, undefined, fakeStorage()), PAGE, "no links: unchanged");
  assert.equal(injectAssetDataUrls(PAGE, { x: "https://not-a-data-url" }), PAGE, "only data: image URLs are written");
  // the worker host runs the first script (with the pictures) before preloading and the scene
  const scripts = extractBundleScripts(html);
  assert.ok(scripts.indexOf("data:image/png;base64") < scripts.indexOf("__preloadAssets()"));
});

test("fetchBundle verifies the page, inlines the current pictures, and plays them under bundle + pictures digest", async () => {
  const { manifest, html } = await bundleScene({ look: "illus-flat-vector", code: sceneCode(), frames: 4, aspect: "9:16" });
  let assetsDigest = "aaaa1111";
  const posted = [];
  const fetchImpl = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("bundle.html")) return new Response(html, { status: 200 });
    if (url.includes("/bundle")) return Response.json({ url: "https://r2.example/g1/bundle.html", expiresAt: new Date(Date.now() + 60_000).toISOString(), bundleDigest: "d0", manifest: { ...manifest, assetNames: ["set-gorge", "depth-gorge"] }, gen: 1, assets: { "set-gorge": "https://r2.example/set-gorge.jpg?s=1" }, assetsDigest });
    if (url.includes("/check")) { posted.push(JSON.parse(init.body)); return Response.json({ state: "checked" }); }
    return fakeStorage()(input);
  };
  const ids = ["11111111-2222-3333-4444-555555555555", "22222222-2222-3333-4444-555555555555"];
  const b = await fetchBundle(...ids, { fetch: fetchImpl, baseUrl: "https://app.example/api/backend" });
  assert.match(b.html, /window\.__ASSETS__=\{"set-gorge":"data:image\/png;base64,/);
  assert.equal(b.bundleDigest, "d0~aaaaa1111", "frames are cached under the bundle and its pictures");
  assetsDigest = "bbbb2222"; // the depth map landed: same bundle, new pictures
  const again = await fetchBundle(...ids, { fetch: fetchImpl, baseUrl: "https://app.example/api/backend" });
  assert.notEqual(again.bundleDigest, b.bundleDigest, "the next load plays fresh frames without new authoring");
  assert.equal(serverBundleDigest(again.bundleDigest), "d0");
  await reportCheck(ids[0], ids[1], { gen: 1, bundleDigest: again.bundleDigest, results: { ok: true } }, { fetch: fetchImpl, baseUrl: "https://app.example/api/backend" });
  assert.equal(posted[0].bundleDigest, "d0", "check reports carry the server's digest");
});

function sceneCode() {
  return `import type { Ctx, Env } from "./core";
import type { Film } from "./film";
const durationFrames = 4;
function draw(ctx: Ctx, frame: number, env: Env) {
  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, 1920);
  const s = env.image("set-gorge");
  if (s) ctx.drawImage(s, 0, 0, 1080, 1920);
}
export const film: Film = { meta: { title: "t", W: 1080, H: 1920, fps: 30, bpm: 120, durationFrames }, assets: { images: ((globalThis as any).__ASSETS__ ?? {}) as Record<string, string> }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };
`;
}

const chromePath = [process.env.PLATE_BROWSER_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")].find((p) => p && existsSync(p));

test("headless Chrome: the contained WorkerHost draws a scene's inlined picture", async (t) => {
  if (!chromePath) { t.skip("no local Chrome"); return; }
  const { chromium } = await import("../../node_modules/playwright-core/index.mjs");
  const bundle = await bundleScene({ look: "illus-flat-vector", code: sceneCode(), frames: 4, aspect: "9:16" });
  const html = await inlineBundleAssets(bundle.html, { "set-gorge": "https://r2.example/set-gorge.jpg" }, fakeStorage());
  const compiled = await build({ entryPoints: [join(HERE, "../lib/live/index.ts")], bundle: true, format: "esm", target: "es2022", write: false });
  const server = createServer((req, res) => {
    if (req.url === "/test.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><script type="module">import * as Live from "/live.js"; window.Live = Live;</script>`); return; }
    if (req.url === "/live.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(compiled.outputFiles[0].text); return; }
    if (req.url === "/scene.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/test.html`);
    await page.waitForFunction(() => Boolean(window.Live));
    const pixel = await page.evaluate(async () => {
      const html = await (await fetch("/scene.html")).text();
      const host = new window.Live.WorkerHost({ html });
      const init = await host.init({ scale: 0.25 });
      const f = await host.frame(2);
      const c = new OffscreenCanvas(init.w, init.h);
      const ctx = c.getContext("2d");
      ctx.drawImage(f.bitmap, 0, 0);
      const d = ctx.getImageData(Math.floor(init.w / 2), Math.floor(init.h / 2), 1, 1).data;
      host.destroy();
      return [d[0], d[1], d[2]];
    });
    assert.deepEqual(pixel, [255, 0, 0], "the preview drew the picture");
  } finally {
    await browser.close();
    server.close();
  }
});
