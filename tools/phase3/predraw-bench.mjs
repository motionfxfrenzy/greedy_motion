// Per-frame draw-time bench for the crayon staging fixtures (phase 3f).
// Usage: node tools/phase3/predraw-bench.mjs [--frames 40] [--json out.json]
// Drives each fixture through WorkerHost in headless Chrome at 854x480, 640x360 and 480x270 and prints a table.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");
const args = process.argv.slice(2);
const argVal = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = Math.max(30, Number(argVal("--frames", 40)));
const JSON_OUT = argVal("--json", null);
const SIZES = [
  { label: "854x480", w: 854 },
  { label: "640x360", w: 640 },
  { label: "480x270", w: 480 }
];

if (!existsSync(CHROME_PATH)) { console.error(`Chrome not found at ${CHROME_PATH}`); process.exit(2); }

const compiled = await build({
  entryPoints: [join(REPO, "frontend/lib/live/index.ts")],
  bundle: true, format: "esm", target: "es2022", write: false
});
const liveJs = compiled.outputFiles[0].text;
const scenes = [0, 1, 2, 3].map((i) => ({
  i,
  html: readFileSync(join(FIX, `scene${i}.html`), "utf8"),
  meta: JSON.parse(readFileSync(join(FIX, `scene${i}.json`), "utf8"))
}));

const server = createServer((req, res) => {
  const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const h = { "cache-control": "no-store" };
  if (p === "/t.html") { res.writeHead(200, { ...h, "content-type": "text/html" }); res.end(`<!doctype html><meta charset=utf-8><body><script type="module">import * as L from "/live.js"; window.Live = L;</script>`); return; }
  if (p === "/live.js") { res.writeHead(200, { ...h, "content-type": "text/javascript" }); res.end(liveJs); return; }
  const m = /^\/scene(\d)\.html$/.exec(p);
  if (m) { res.writeHead(200, { ...h, "content-type": "text/html" }); res.end(scenes[Number(m[1])].html); return; }
  res.writeHead(404, h); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const results = [];
let gpu = "unavailable";
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/t.html`);
  await page.waitForFunction(() => Boolean(window.Live));
  gpu = await page.evaluate(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return "unavailable";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unavailable (no debug info)";
    } catch { return "unavailable"; }
  });
  const version = browser.version();
  for (const sc of scenes) {
    for (const size of SIZES) {
      const r = await page.evaluate(async ({ i, scale, sample, frames }) => {
        const html = await (await fetch(`/scene${i}.html`)).text();
        const host = new window.Live.WorkerHost({ html, params: {}, budgetBytes: 512 * 1024 * 1024 });
        const init = await host.init({ scale });
        const step = Math.max(1, Math.floor(frames / sample));
        const idx = [];
        for (let f = 0; f < frames && idx.length < sample; f += step) idx.push(f);
        const worker = [], wall = [];
        let firstWall = 0;
        for (const f of idx) {
          const t0 = performance.now();
          const res = await host.frame(f);
          const dt = performance.now() - t0;
          if (!worker.length && !firstWall) firstWall = dt;
          worker.push(res.drawMs); wall.push(dt);
          res.bitmap.close();
        }
        host.destroy();
        return { w: init.w, h: init.h, n: idx.length, worker, wall, firstWall };
      }, { i: sc.i, scale: size.w / 1920, sample: SAMPLE, frames: sc.meta.manifest.frames });
      const stat = (a) => {
        const s = [...a].sort((x, y) => x - y);
        const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
        return { median: q(0.5), p90: q(0.9), max: s[s.length - 1], mean: a.reduce((x, y) => x + y, 0) / a.length };
      };
      results.push({ scene: sc.i, frames: sc.meta.manifest.frames, size: size.label, out: `${r.w}x${r.h}`, n: r.n, worker: stat(r.worker), wall: stat(r.wall), firstWallMs: r.firstWall });
    }
  }
  const out = { gpu, chrome: version, sample: SAMPLE, results };
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  console.log(`Chrome ${version}; WebGL renderer: ${gpu}; frames sampled per cell: >= ${SAMPLE}`);
  console.log("scene | frames | size    | n  | worker ms med/p90/max | wall ms med/p90/max | est draw fps (wall mean)");
  for (const r of results) {
    const f = (s) => `${s.median.toFixed(1)}/${s.p90.toFixed(1)}/${s.max.toFixed(1)}`;
    console.log(`${r.scene}     | ${String(r.frames).padEnd(6)} | ${r.size} | ${String(r.n).padEnd(2)} | ${f(r.worker).padEnd(21)} | ${f(r.wall).padEnd(19)} | ${(1000 / r.wall.mean).toFixed(1)}`);
  }
} finally {
  await browser.close();
  server.close();
}
