// Fast export, real browser: a real staging scene bundle (crayon, 1920x1080, 90 frames) is drawn by lib/live/browser-clips.ts in
// headless Chrome (WorkerHost, full quality, scale 1), encoded with WebCodecs H.264 and muxed with mp4-muxer. The MP4 must pass
// the worker's probe (packages/plate-engine/lib/capture.mjs probeVideo + the isClipProbeValid rules) and the backend's
// upload check. When the worker's own capture adapter can run here, the same scene is also drawn the worker's way and the two
// clips are compared (PSNR), so a browser drawing that differs from the worker's shows up as a number.
// Run: node --test test/live-browser-clips-chrome.mjs   (FAST_EXPORT_KEEP=dir keeps the MP4s)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures/crayon-staging");
const PW = existsSync("/Users/osamaehsaan/Code/Market_apps/VideoSaaS-deploy/node_modules/playwright-core/index.mjs")
  ? "/Users/osamaehsaan/Code/Market_apps/VideoSaaS-deploy/node_modules/playwright-core/index.mjs"
  : join(HERE, "../../node_modules/playwright-core/index.mjs");

test("browser clip of a real scene bundle passes the worker's probe", { timeout: 600_000 }, async (t) => {
  if (!existsSync(CHROME_PATH)) return t.skip(`Google Chrome not found at ${CHROME_PATH}`);
  const { chromium } = await import(PW);
  const { probeVideo } = await import("../../packages/plate-engine/lib/capture.mjs");
  const html = readFileSync(join(FIX, "scene0.html"), "utf8");
  const meta = JSON.parse(readFileSync(join(FIX, "scene0.json"), "utf8"));
  const { width, height, frames } = meta.manifest;
  const compiled = await build({
    stdin: { contents: `export * from "./lib/live/browser-clips.ts"; export { createWorkerHost } from "./lib/live/worker-host.ts";`, resolveDir: join(HERE, ".."), loader: "ts" },
    bundle: true, format: "esm", target: "es2022", write: false
  });
  const js = compiled.outputFiles[0].text;
  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (p === "/t.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><meta charset=utf-8><script type="module">import * as B from "/bc.js"; window.BC = B;</script>`); return; }
    if (p === "/bc.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(js); return; }
    if (p === "/scene.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dir = process.env.FAST_EXPORT_KEEP || mkdtempSync(join(tmpdir(), "fast-export-chrome-"));
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/t.html`);
    await page.waitForFunction(() => Boolean(window.BC));
    const out = await page.evaluate(async ({ frames, width, height, params }) => {
      const B = window.BC;
      const html = await (await fetch("/scene.html")).text();
      const config = await B.pickEncoderConfig(width, height, 30);
      if (!config) return { unsupported: true };
      const gl = (() => { try { const c = new OffscreenCanvas(1, 1).getContext("webgl"); const d = c.getExtension("WEBGL_debug_renderer_info"); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?"; } catch { return "?"; } })();
      const runs = [];
      let bytes;
      for (let k = 0; k < 2; k++) {
        const r = await B.encodeSceneClip({ html, params, frames, width, height, fps: 30, config });
        runs.push({ msPerFrame: r.msPerFrame, drawMsPerFrame: r.drawMsPerFrame, msTotal: r.msTotal });
        bytes = r.bytes;
      }
      // The scene's own draw time inside its Worker (FILM.seek) vs the round trip (seek + createImageBitmap + transfer).
      const host = B.createWorkerHost({ html, params, watchdogMs: 15_000 });
      await host.init({ scale: 1, params });
      let seekMs = 0, tripMs = 0;
      for (let i = 0; i < frames; i++) { const t0 = performance.now(); const r = await host.frame(i, { qualitySpec: { mode: "full" } }); tripMs += performance.now() - t0; seekMs += r.drawMs; r.bitmap.close(); }
      host.destroy();
      let draftMs = 0;
      const h2 = B.createWorkerHost({ html, params, watchdogMs: 15_000 });
      await h2.init({ scale: 1, params });
      for (let i = 0; i < frames; i++) { const r = await h2.frame(i, { qualitySpec: { mode: "draft" } }); draftMs += r.drawMs; r.bitmap.close(); }
      h2.destroy();
      // One raw frame (no encoder) to compare with the worker's FILM.png() of the same frame.
      const h3 = B.createWorkerHost({ html, params, watchdogMs: 15_000 });
      await h3.init({ scale: 1, params });
      const mid = Math.floor(frames / 2);
      const fr = await h3.frame(mid, { qualitySpec: { mode: "full" } });
      const oc = new OffscreenCanvas(width, height);
      oc.getContext("2d").drawImage(fr.bitmap, 0, 0);
      fr.bitmap.close();
      h3.destroy();
      const pngBuf = new Uint8Array(await (await oc.convertToBlob({ type: "image/png" })).arrayBuffer());
      let pbin = "";
      for (let i = 0; i < pngBuf.length; i += 0x8000) pbin += String.fromCharCode(...pngBuf.subarray(i, i + 0x8000));
      runs.push({ midPng: btoa(pbin), mid });
      runs.push({ seekMsPerFrame: seekMs / frames, tripMsPerFrame: tripMs / frames, draftSeekMsPerFrame: draftMs / frames });
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { codec: config.codec, gl, runs, b64: btoa(bin), size: bytes.length };
    }, { frames, width, height, params: meta.params });
    if (out.unsupported) return t.skip("This Chrome cannot encode H.264 with WebCodecs.");
    const clip = join(dir, "browser-clip.mp4");
    writeFileSync(clip, Buffer.from(out.b64, "base64"));

    // The worker's probe and its isClipProbeValid rules (worker/src/plates.mjs prepareManifestClips).
    const facts = await probeVideo(clip);
    assert.equal(facts.codec, "h264");
    assert.equal(facts.width, width);
    assert.equal(facts.height, height);
    assert.ok(Math.abs(facts.fps - 30) < 1e-6, `fps ${facts.fps}`);
    assert.equal(facts.frames, frames);
    assert.equal(facts.pixFmt, "yuv420p");
    // The backend's own upload check (forced MP4 demuxer).
    process.env.APP_ENV ??= "local";
    process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
    process.env.PLANNER ??= "deterministic";
    const { probeClip, clipProblem } = await import("../../backend/src/plates/browser-clips.ts");
    assert.equal(clipProblem(await probeClip(clip), { width, height, bundleFrames: frames }), null);

    const warm = out.runs[1];
    const report = {
      codec: out.codec, gl: out.gl, frames, size: `${width}x${height}`, bytes: out.size,
      coldMsPerFrame: +out.runs[0].msPerFrame.toFixed(1), msPerFrame: +warm.msPerFrame.toFixed(1), drawMsPerFrame: +warm.drawMsPerFrame.toFixed(1),
      seekMsPerFrame: +out.runs[3].seekMsPerFrame.toFixed(1), hostRoundTripMsPerFrame: +out.runs[3].tripMsPerFrame.toFixed(1), draftSeekMsPerFrame: +out.runs[3].draftSeekMsPerFrame.toFixed(1),
      sceneSeconds: frames / 30, encodeSeconds: +(warm.msTotal / 1000).toFixed(2)
    };

    // Same scene drawn the worker's way (headless Chromium page + ffmpeg CRF 16), then PSNR browser vs worker.
    try {
      const { renderScene } = await import("../../packages/plate-engine/lib/capture.mjs");
      const page2 = join(dir, "scene.html");
      writeFileSync(page2, html);
      const ref = join(dir, "worker-clip.mp4");
      process.env.PLATE_BROWSER_PATH ??= CHROME_PATH;
      const t0 = Date.now();
      await renderScene(page2, ref, { frames, fps: 30, workers: 2 });
      report.workerWayMsPerFrame = +((Date.now() - t0) / frames).toFixed(1);
      const cmp = spawnSync("ffmpeg", ["-hide_banner", "-i", clip, "-i", ref, "-lavfi", "[0:v][1:v]psnr", "-f", "null", "-"], { encoding: "utf8" });
      report.psnr = /average:\S+/.exec(cmp.stderr)?.[0] ?? "not compared";
      const ssim = spawnSync("ffmpeg", ["-hide_banner", "-i", clip, "-i", ref, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"], { encoding: "utf8" });
      report.ssim = /All:\S+/.exec(ssim.stderr)?.[0] ?? "not compared";
      report.workerClipBytes = readFileSync(ref).length;
      const { openScene } = await import("../../packages/plate-engine/lib/capture.mjs");
      const session = await openScene(page2, { pages: 1 });
      const workerPng = join(dir, "worker-mid.png"), browserPng = join(dir, "browser-mid.png");
      writeFileSync(workerPng, await session.frame(out.runs[2].mid, 0));
      await session.close();
      writeFileSync(browserPng, Buffer.from(out.runs[2].midPng, "base64"));
      const raw = spawnSync("ffmpeg", ["-hide_banner", "-i", browserPng, "-i", workerPng, "-lavfi", "[0:v][1:v]psnr", "-f", "null", "-"], { encoding: "utf8" });
      report.rawMidFramePsnr = /average:\S+/.exec(raw.stderr)?.[0] ?? "not compared";
    } catch (e) {
      const m = /average:([\d.inf]+)/.exec(String(e?.stderr ?? e?.stdout ?? ""));
      report.psnr = m ? `average:${m[1]}` : `not compared (${String(e?.message ?? e).slice(0, 120)})`;
    }
    if (typeof report.psnr === "string" && report.psnr.includes("average:")) report.psnr = /average:\S+/.exec(report.psnr)?.[0] ?? report.psnr;
    console.log("FAST_EXPORT_REPORT", JSON.stringify(report));
  } finally {
    await browser.close();
    server.close();
    if (!process.env.FAST_EXPORT_KEEP) rmSync(dir, { recursive: true, force: true });
  }
});
