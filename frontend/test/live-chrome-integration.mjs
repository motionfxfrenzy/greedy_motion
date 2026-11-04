import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { bundleScene } from "../../packages/plate-engine/lib/engine.mjs";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FIXTURES_DIR = join(REPO_ROOT, "packages/plate-engine/test/fixtures");

test("headless Chrome integration: pixel parity (fox & balloon), containment (0 network hits), watchdog (<100ms main-thread stall), memory bomb survival, byte budget, and clean destroy", async (t) => {
  if (!existsSync(CHROME_PATH)) {
    t.skip(`Skipping headless Chrome integration test: Google Chrome not found at ${CHROME_PATH}`);
    return;
  }

  // 1. Build real `fox` and `balloon` scene bundles from fixtures using `bundleScene`
  const foxCode = readFileSync(join(FIXTURES_DIR, "fox-0.ts"), "utf8");
  const balloonCode = readFileSync(join(FIXTURES_DIR, "balloon-0.ts"), "utf8");

  const foxBundle = await bundleScene({ look: "illus-fox", code: foxCode, frames: 90, aspect: "16:9" });
  const balloonBundle = await bundleScene({ look: "illus-balloon", code: balloonCode, frames: 105, aspect: "16:9" });

  // 2. Bundle `frontend/lib/live/index.ts` for the browser
  const compiled = await build({
    entryPoints: [join(HERE, "../lib/live/index.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false
  });
  const liveModuleJs = compiled.outputFiles[0].text;

  // 3. Start localhost-only (127.0.0.1) HTTP server on an ephemeral free port
  const probeHits = [];
  const testHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Live Scene Integration Test</title></head><body><div id="stage"></div><script type="module">
import * as Live from "/live-module.js";
window.Live = Live;
</script></body></html>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const headers = { "cache-control": "no-store" };

    if (path === "/probe-hit") {
      probeHits.push({ url: req.url, at: Date.now() });
      res.writeHead(200, { ...headers, "access-control-allow-origin": "*" });
      res.end("hit");
      return;
    }
    if (path === "/probe-hits") {
      res.writeHead(200, { ...headers, "content-type": "application/json" });
      res.end(JSON.stringify(probeHits));
      return;
    }
    if (path === "/test.html") {
      res.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      res.end(testHtml);
      return;
    }
    if (path === "/live-module.js") {
      res.writeHead(200, { ...headers, "content-type": "text/javascript; charset=utf-8" });
      res.end(liveModuleJs);
      return;
    }
    if (path === "/fox.html") {
      res.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      res.end(foxBundle.html);
      return;
    }
    if (path === "/balloon.html") {
      res.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
      res.end(balloonBundle.html);
      return;
    }
    res.writeHead(404, headers);
    res.end("not found");
  });

  server.on("upgrade", (req, socket) => {
    probeHits.push({ url: req.url, via: "ws", at: Date.now() });
    socket.destroy();
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  let browser = null;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true
    });
    const page = await browser.newPage();
    await page.goto(`${origin}/test.html`);
    await page.waitForFunction(() => Boolean(window.Live));

    // Verify environment detection in real headless Chrome
    const envCheck = await page.evaluate(() => ({
      status: window.Live.environmentStatus(),
      supported: window.Live.supportsWorkerHost()
    }));
    assert.equal(envCheck.status, "verified");
    assert.equal(envCheck.supported, true);

    // --- A. Pixel parity: contained WorkerHost vs page-thread host for `fox` and `balloon` at preview scale
    const parityResult = await page.evaluate(async () => {
      const scale = 854 / 1920;
      const compareScene = async (name, sampleFrames) => {
        const html = await (await fetch(`/${name}.html`)).text();
        const host = new window.Live.WorkerHost({ html });
        const init = await host.init({ scale });

        // Mount page-thread reference in a temporary same-origin iframe
        const refIframe = document.createElement("iframe");
        refIframe.style.cssText = "position:fixed;left:-9999px;width:854px;height:480px";
        refIframe.src = `/${name}.html?adapter=1`;
        document.body.appendChild(refIframe);
        await new Promise((ok) => (refIframe.onload = ok));
        const refWin = refIframe.contentWindow;
        await refWin.FILM.ready;
        refWin.FILM.mount(scale);

        const frameResults = {};
        const drawMsList = [];
        for (const n of sampleFrames) {
          const wf = await host.frame(n);
          drawMsList.push(wf.drawMs);
          const wc = new OffscreenCanvas(init.w, init.h);
          const wctx = wc.getContext("2d");
          wctx.drawImage(wf.bitmap, 0, 0);
          const wData = wctx.getImageData(0, 0, init.w, init.h).data;
          wf.bitmap.close();

          refWin.FILM.seek(n);
          const rc = refIframe.contentDocument.getElementById("film");
          const pc = new OffscreenCanvas(rc.width, rc.height);
          const pctx = pc.getContext("2d");
          pctx.drawImage(rc, 0, 0);
          const pData = pctx.getImageData(0, 0, rc.width, rc.height).data;

          let diffPx = 0;
          let maxDelta = 0;
          for (let i = 0; i < wData.length; i += 4) {
            const d = Math.max(
              Math.abs(wData[i] - pData[i]),
              Math.abs(wData[i + 1] - pData[i + 1]),
              Math.abs(wData[i + 2] - pData[i + 2]),
              Math.abs(wData[i + 3] - pData[i + 3])
            );
            if (d > 0) {
              diffPx++;
              if (d > maxDelta) maxDelta = d;
            }
          }
          frameResults[n] = { diffPx, maxDelta, drawMs: Math.round(wf.drawMs * 10) / 10 };
        }

        refIframe.remove();
        host.destroy();
        const meanDrawMs = Math.round((drawMsList.reduce((a, b) => a + b, 0) / drawMsList.length) * 10) / 10;
        return { size: `${init.w}x${init.h}`, meanDrawMs, frames: frameResults };
      };

      const fox = await compareScene("fox", [0, 45, 89]);
      const balloon = await compareScene("balloon", [0, 52, 104]);
      return { fox, balloon, iframesAfterParity: document.querySelectorAll("iframe").length };
    });

    for (const [f, res] of Object.entries(parityResult.fox.frames)) {
      assert.equal(res.diffPx, 0, `fox frame ${f} must have 0 differing pixels vs page host`);
    }
    for (const [f, res] of Object.entries(parityResult.balloon.frames)) {
      assert.equal(res.diffPx, 0, `balloon frame ${f} must have 0 differing pixels vs page host`);
    }
    assert.equal(parityResult.iframesAfterParity, 0);

    // --- B. Containment: sandboxed iframe Worker cannot reach the network (0 hits to /probe-hit)
    probeHits.length = 0;
    const containmentResult = await page.evaluate(async (srvOrigin) => {
      const probeHtml = `<script>
window.FILM = {
  meta: { W: 854, H: 480, fps: 30, durationFrames: 10 },
  ready: Promise.resolve(),
  mount(s) { const c = document.getElementById("film"); c.width = 854; c.height = 480; c.getContext("2d").fillRect(0, 0, 854, 480); },
  seek(n) { document.getElementById("film").getContext("2d").fillRect(0, 0, 10, 10); }
};
</script><script>
self.__PROBE_RESULTS__ = (async () => {
  const out = {};
  try {
    await fetch(${JSON.stringify(srvOrigin)} + "/probe-hit?via=fetch", { mode: "no-cors" });
    out.fetch = "allowed";
  } catch (e) { out.fetch = "blocked:" + e.name; }
  try {
    await new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open("GET", ${JSON.stringify(srvOrigin)} + "/probe-hit?via=xhr");
      x.onload = () => ok();
      x.onerror = () => no(new Error("xhr-blocked"));
      x.send();
    });
    out.xhr = "allowed";
  } catch (e) { out.xhr = "blocked"; }
  try {
    await new Promise((ok, no) => {
      const ws = new WebSocket(${JSON.stringify(srvOrigin.replace("http", "ws"))} + "/probe-hit?via=ws");
      ws.onopen = () => ok();
      ws.onerror = () => no(new Error("ws-blocked"));
      setTimeout(() => no(new Error("ws-timeout")), 400);
    });
    out.ws = "allowed";
  } catch (e) { out.ws = "blocked"; }
  return out;
})();
</script>`;
      const host = new window.Live.WorkerHost({ html: probeHtml });
      await host.init({ scale: 1 });
      const f = await host.frame(0);
      f.bitmap.close();
      await new Promise((r) => setTimeout(r, 500));
      host.destroy();
      return { iframesAfter: document.querySelectorAll("iframe").length };
    }, origin);

    assert.equal(probeHits.length, 0, `Expected 0 network probe hits from contained Worker, got ${probeHits.length}`);
    assert.equal(containmentResult.iframesAfter, 0);

    // --- C. Infinite-loop scene is terminated within watchdog budget and main thread stays responsive (<100 ms stall)
    const hangResult = await page.evaluate(async () => {
      const hangHtml = `<script>
window.FILM = {
  meta: { W: 854, H: 480, fps: 30, durationFrames: 30 },
  ready: Promise.resolve(),
  mount() { const c = document.getElementById("film"); c.width = 854; c.height = 480; },
  seek(n) {
    if (n === 99) { for (;;) {} }
    const ctx = document.getElementById("film").getContext("2d");
    ctx.fillStyle = "#2a6b3a";
    ctx.fillRect(0, 0, 854, 480);
  }
};
</script>`;
      const host = new window.Live.WorkerHost({ html: hangHtml, watchdogMs: 2_000 });
      await host.init({ scale: 1 });

      let maxStallMs = 0;
      let lastTick = performance.now();
      const interval = setInterval(() => {
        const now = performance.now();
        const gap = now - lastTick;
        if (gap > maxStallMs) maxStallMs = gap;
        lastTick = now;
      }, 10);

      const t0 = performance.now();
      let terminatedErr = null;
      try {
        await host.frame(99);
      } catch (err) {
        terminatedErr = String(err.message || err);
      }
      const detectedMs = Math.round(performance.now() - t0);
      clearInterval(interval);

      // Host automatically recreates the Worker on first watchdog termination; verify frame 0 draws cleanly
      const recoveredFrame = await host.frame(0);
      recoveredFrame.bitmap.close();
      const terminations = host.terminations;
      const unhealthy = host.unhealthy;
      host.destroy();

      return {
        detectedMs,
        maxStallMs: Math.round(maxStallMs * 10) / 10,
        terminatedErr,
        terminations,
        unhealthy,
        recovered: recoveredFrame.n === 0
      };
    });

    assert.ok(hangResult.terminatedErr?.includes("Watchdog timeout"), `Expected watchdog timeout, got ${hangResult.terminatedErr}`);
    assert.ok(hangResult.detectedMs >= 1_900 && hangResult.detectedMs <= 3_000, `Watchdog detected in ${hangResult.detectedMs}ms`);
    assert.ok(hangResult.maxStallMs < 100, `Main-thread longest stall (${hangResult.maxStallMs}ms) must stay under 100ms`);
    assert.equal(hangResult.recovered, true, "Fresh Worker draws frame 0 after terminating infinite loop");

    // --- D. Memory-hungry loop does not crash the page
    const bombResult = await page.evaluate(async () => {
      const bombHtml = `<script>
window.FILM = {
  meta: { W: 854, H: 480, fps: 30, durationFrames: 30 },
  ready: Promise.resolve(),
  mount() { const c = document.getElementById("film"); c.width = 854; c.height = 480; },
  seek(n) {
    if (n === 88) {
      const chunks = [];
      for (;;) {
        const a = new Uint8Array(25 * 1024 * 1024);
        a.fill(7);
        chunks.push(a);
        if (chunks.length >= 30) { for (;;) {} }
      }
    }
    const ctx = document.getElementById("film").getContext("2d");
    ctx.fillStyle = "#3b2c55";
    ctx.fillRect(0, 0, 854, 480);
  }
};
</script>`;
      const host = new window.Live.WorkerHost({ html: bombHtml, watchdogMs: 2_000 });
      await host.init({ scale: 1 });
      let caught = false;
      try {
        await host.frame(88);
      } catch {
        caught = true;
      }
      const after = await host.frame(0);
      after.bitmap.close();
      host.destroy();
      return { caught, survivedAndDrew: after.n === 0 };
    });

    assert.equal(bombResult.caught, true);
    assert.equal(bombResult.survivedAndDrew, true);

    // --- E. Playback stays within byte budget and destroy() leaves 0 iframes and 0 bytes
    const budgetAndDestroyResult = await page.evaluate(async () => {
      const html = await (await fetch("/balloon.html")).text();
      const frameBytes = 854 * 480 * 4;
      const budgetBytes = frameBytes * 24; // 24 frames (~39.3 MB) budget: aheadFrames = 20 (0.67s >= 0.5s gate lead)
      const stage = document.getElementById("stage");

      const player = new window.Live.PlatePlayer({
        bundleDigest: "balloon-live-int-digest",
        html,
        aspect: "16:9",
        fps: 30,
        frames: 45,
        budgetBytes,
        autoPump: false
      });

      await player.mount(stage);
      let maxCacheBytes = player.cache.bytes;
      let maxHostBytes = player.workerHost.bytes;

      for (let f = 0; f < 32; f++) {
        player.showFrame(f);
        await player.pumpScheduler(2);
        if (player.cache.bytes > maxCacheBytes) maxCacheBytes = player.cache.bytes;
        if (player.workerHost.bytes > maxHostBytes) maxHostBytes = player.workerHost.bytes;
      }

      const decision = player.decision();
      player.destroy();

      return {
        decision,
        budgetBytes,
        maxCacheBytes,
        maxHostBytes,
        cacheBytesAfterDestroy: player.cache.bytes,
        hostBytesAfterDestroy: player.workerHost.bytes,
        iframesRemaining: document.querySelectorAll("iframe").length,
        canvasesRemaining: stage.querySelectorAll("canvas").length
      };
    });

    assert.equal(budgetAndDestroyResult.decision.mode, "live");
    assert.ok(
      budgetAndDestroyResult.maxCacheBytes <= budgetAndDestroyResult.budgetBytes,
      `maxCacheBytes (${budgetAndDestroyResult.maxCacheBytes}) <= budget (${budgetAndDestroyResult.budgetBytes})`
    );
    assert.ok(
      budgetAndDestroyResult.maxHostBytes <= budgetAndDestroyResult.budgetBytes,
      `maxHostBytes (${budgetAndDestroyResult.maxHostBytes}) <= budget (${budgetAndDestroyResult.budgetBytes})`
    );
    assert.equal(budgetAndDestroyResult.cacheBytesAfterDestroy, 0);
    assert.equal(budgetAndDestroyResult.hostBytesAfterDestroy, 0);
    assert.equal(budgetAndDestroyResult.iframesRemaining, 0, "destroy() must leave 0 iframes");
    assert.equal(budgetAndDestroyResult.canvasesRemaining, 0, "destroy() must remove player canvas");

    console.log(
      "LIVE_CHROME_METRICS:",
      JSON.stringify({
        parity: parityResult,
        containmentProbeHits: probeHits.length,
        hang: hangResult,
        bomb: bombResult,
        budget: budgetAndDestroyResult
      })
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
