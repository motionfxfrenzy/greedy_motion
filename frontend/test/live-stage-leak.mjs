import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { bundleScene } from "../../packages/plate-engine/lib/engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = join(REPO_ROOT, "packages/plate-engine/test/fixtures");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("headless Chrome leak test: iframes, Workers, canvases, and bitmaps return to zero after aspect switches, project switches, and unmount", async () => {
  assert.ok(existsSync(CHROME_PATH), `Google Chrome binary must exist at ${CHROME_PATH}`);

  const balloonCode = readFileSync(join(FIXTURES_DIR, "balloon-0.ts"), "utf8");
  const blueprintCode = readFileSync(join(FIXTURES_DIR, "blueprint-0.ts"), "utf8");

  const [b169A, b169B, b916A, b11A] = await Promise.all([
    bundleScene({ look: "illus-balloon", code: balloonCode, frames: 105, aspect: "16:9" }),
    bundleScene({ look: "illus-blueprint", code: blueprintCode, frames: 90, aspect: "16:9" }),
    bundleScene({ look: "illus-balloon", code: balloonCode, frames: 105, aspect: "9:16" }),
    bundleScene({ look: "illus-blueprint", code: blueprintCode, frames: 90, aspect: "1:1" })
  ]);

  const compiled = await build({
    entryPoints: [join(REPO_ROOT, "frontend/lib/live/index.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false
  });
  const liveModuleJs = compiled.outputFiles[0].text;

  const testHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="stage" style="width:854px;height:480px"></div>
<script type="module">
import * as Live from "/live-module.js";
window.Live = Live;
</script>
</body></html>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/test.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(testHtml);
      return;
    }
    if (url.pathname === "/live-module.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(liveModuleJs);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/test.html`);
    await page.waitForFunction(() => Boolean(window.Live));

    const results = await page.evaluate(
      async ({ html169A, html169B, html916A, html11A }) => {
        const stage = document.getElementById("stage");
        const snapCounts = (fp) => ({
          iframes: document.querySelectorAll("iframe").length,
          workers: window.Live.getActiveBrowserTransportCount(),
          canvases: stage.querySelectorAll("canvas").length,
          cacheBytes: fp ? fp.cache.bytes : 0,
          hostBytes: fp
            ? fp.scenes.reduce((sum, s) => sum + (s.workerHost ? s.workerHost.bytes : 0), 0)
            : 0
        });

        const before = snapCounts(null);

        // 1. Mount Project A in 16:9 (2 live scenes + 1 clip scene)
        let currentTime = 0;
        let fp169 = window.Live.createFilmPlayer({
          scenes: [
            { id: "s0", bundleDigest: "d-169-0", html: html169A, frames: 105 },
            { id: "s1", bundleDigest: "d-169-1", html: html169B, frames: 90 },
            { id: "s2", bundleDigest: "d-169-2", html: "", frames: 90, forceClipReason: "clip-only" }
          ],
          aspect: "16:9",
          fps: 30,
          timeSource: { currentTime: () => currentTime, playing: () => true },
          autoPump: false
        });
        await fp169.mount(stage);
        fp169.showFrame(0);
        currentTime = 4.0;
        fp169.syncToClock(); // cross scene boundary 0 -> 1 (recycles scene 0 Worker)
        // The film decides lazily (scene on screen + next); decide every scene so the count of live scenes is exact.
        await Promise.all(fp169.scenes.map((sc) => sc.measure()));
        const mounted169 = snapCounts(fp169);

        // 2. Switch aspect to 9:16 (destroy old FilmPlayer, mount 9:16 FilmPlayer)
        fp169.destroy();
        const afterDestroy169 = snapCounts(null);

        let fp916 = window.Live.createFilmPlayer({
          scenes: [
            { id: "s0", bundleDigest: "d-916-0", html: html916A, frames: 105 },
            { id: "s1", bundleDigest: "d-916-1", html: html916A, frames: 105 }
          ],
          aspect: "9:16",
          fps: 30,
          timeSource: { currentTime: () => 0, playing: () => false },
          autoPump: false
        });
        await fp916.mount(stage);
        await Promise.all(fp916.scenes.map((sc) => sc.measure()));
        const mounted916 = snapCounts(fp916);

        // 3. Switch aspect to 1:1 and test hot-reloading a revised scene via updateScene()
        fp916.destroy();
        const afterDestroy916 = snapCounts(null);

        let fp11 = window.Live.createFilmPlayer({
          scenes: [
            { id: "s0", bundleDigest: "d-11-0-r0", html: html11A, frames: 90 },
            { id: "s1", bundleDigest: "d-11-1-r0", html: html11A, frames: 90 }
          ],
          aspect: "1:1",
          fps: 30,
          timeSource: { currentTime: () => 0, playing: () => false },
          autoPump: false
        });
        await fp11.mount(stage);
        await fp11.updateScene(0, {
          id: "s0",
          bundleDigest: "d-11-0-r1",
          html: html11A,
          frames: 90
        });
        await Promise.all(fp11.scenes.map((sc) => sc.measure()));
        const mounted11AfterUpdate = snapCounts(fp11);

        // 4. Unmount workspace (destroy FilmPlayer)
        fp11.destroy();
        const afterUnmount = snapCounts(null);

        return {
          before,
          mounted169,
          afterDestroy169,
          mounted916,
          afterDestroy916,
          mounted11AfterUpdate,
          afterUnmount
        };
      },
      {
        html169A: b169A.html,
        html169B: b169B.html,
        html916A: b916A.html,
        html11A: b11A.html
      }
    );

    // Before mount: 0 iframes, 0 Workers, 0 canvases
    assert.deepEqual(results.before, {
      iframes: 0,
      workers: 0,
      canvases: 0,
      cacheBytes: 0,
      hostBytes: 0
    });

    // While 16:9 mounted (2 live scenes, 1 clip scene): exactly 2 sandboxed iframes & 2 Workers
    assert.equal(results.mounted169.iframes, 2, "exactly 2 sandboxed iframes for 2 live scenes");
    assert.equal(results.mounted169.workers, 2, "exactly 2 active Workers for 2 live scenes");
    assert.equal(results.mounted169.canvases, 3);
    assert.ok(results.mounted169.cacheBytes > 0);
    assert.ok(results.mounted169.hostBytes > 0);

    // After destroying 16:9 before 9:16: returns to 0
    assert.deepEqual(results.afterDestroy169, {
      iframes: 0,
      workers: 0,
      canvases: 0,
      cacheBytes: 0,
      hostBytes: 0
    });

    // While 9:16 mounted (2 live scenes): 2 iframes, 2 Workers
    assert.equal(results.mounted916.iframes, 2);
    assert.equal(results.mounted916.workers, 2);
    assert.equal(results.mounted916.canvases, 2);

    // After destroying 9:16: returns to 0
    assert.deepEqual(results.afterDestroy916, {
      iframes: 0,
      workers: 0,
      canvases: 0,
      cacheBytes: 0,
      hostBytes: 0
    });

    // After updateScene(0) on 1:1: old scene player destroyed, still exactly 2 iframes & 2 Workers
    assert.equal(results.mounted11AfterUpdate.iframes, 2, "updateScene does not leak old scene iframe");
    assert.equal(results.mounted11AfterUpdate.workers, 2, "updateScene does not leak old scene Worker");
    assert.equal(results.mounted11AfterUpdate.canvases, 2, "updateScene does not leak old scene canvas");

    // After final unmount: 0 iframes, 0 Workers, 0 canvases, 0 cache bytes, 0 host bytes
    assert.deepEqual(results.afterUnmount, {
      iframes: 0,
      workers: 0,
      canvases: 0,
      cacheBytes: 0,
      hostBytes: 0
    });
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
});
