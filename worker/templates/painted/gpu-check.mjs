#!/usr/bin/env node
/*
 * GPU preflight for the painted renderer: launches headless Chromium the same way render.mjs does and reads the
 * WebGL renderer string straight off a live context.
 *
 *   node gpu-check.mjs
 *
 * Prints the renderer ("ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, ...)" on a Mac) and exits 0. When a
 * hardware GPU is required — always on macOS, or anywhere with PAINTED_REQUIRE_GPU=1 (the AWS GPU worker image) —
 * it exits 1 refusing a software renderer (SwiftShader / llvmpipe / Mesa) so a CPU fallback never ships silently.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { findBrowser } from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sizeArg = args.includes("--width") ? Number(args[args.indexOf("--width") + 1] || 320) : 320;

const browser = await (await import("puppeteer-core")).default.launch({
  executablePath: findBrowser(),
  headless: true,
  ignoreDefaultArgs: ["--disable-gpu"],
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--ignore-gpu-blocklist",
    "--use-angle=" + (process.env.PAINTED_ANGLE || (process.platform === "darwin" ? "metal" : process.env.PAINTED_REQUIRE_GPU === "1" ? "vulkan" : "swiftshader")),
    "--hide-scrollbars",
    "--mute-audio",
    `--window-size=${sizeArg},${Math.round(sizeArg * 9 / 16)}`,
  ],
});
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(here, "index.html")).href);
  const info = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return { renderer: "", error: "webgl2-unavailable" };
    const e = gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "", error: null };
  });
  console.log(`gpu renderer: ${info.renderer || info.error || "?"}`);
  if (process.env.PAINTED_DEBUG_GPU) console.log("gpu info:", JSON.stringify(info));
  const GPU_BLOCKED = /swiftshader|llvmpipe|software|mesa|lvp/i;
  const gpuBackend = process.env.PAINTED_ANGLE || (process.platform === "darwin" ? "metal" : "vulkan");
  const gpuRequired = process.platform === "darwin" || process.env.PAINTED_REQUIRE_GPU === "1";
  if (gpuRequired && GPU_BLOCKED.test(info.renderer || "")) {
    console.error(`GPU preflight failed: software renderer (${info.renderer || info.error}); this render requires a hardware GPU (${gpuBackend}).`);
    process.exit(1);
  }
  console.log("gpu preflight ok");
} finally {
  await browser.close().catch(() => {});
}
