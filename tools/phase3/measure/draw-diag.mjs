// Diagnostic: where does a server crayon scene's frame time go? Main thread vs Worker, with/without the 1x1 readback, plus a CPU profile.
// Usage: node draw-diag.mjs <repo>   (repo = a worktree with node_modules and the crayon fixtures)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const REPO = process.argv[2];
const { build } = await import(join(REPO, "node_modules/esbuild/lib/main.js"));
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");
const SCALE = 640 / 1920;
const N = 24;

const liveJs = (await build({ entryPoints: [join(REPO, "frontend/lib/live/index.ts")], bundle: true, format: "esm", target: "es2022", write: false })).outputFiles[0].text;
const scenes = [0, 1, 2, 3].map((i) => ({ i, html: readFileSync(join(FIX, `scene${i}.html`), "utf8"), frames: JSON.parse(readFileSync(join(FIX, `scene${i}.json`), "utf8")).manifest.frames }));

const NO_READBACK = `(() => { for (const P of [globalThis.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, globalThis.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype]) { if (!P) continue; const o = P.getImageData; P.getImageData = function (x, y, w, h, ...r) { if (w === 1 && h === 1 && !globalThis.__allowRead) return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; return o.call(this, x, y, w, h, ...r); }; } })();`;

const server = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  const h = { "cache-control": "no-store" };
  if (u.pathname === "/t.html") { res.writeHead(200, { ...h, "content-type": "text/html" }); res.end(`<!doctype html><meta charset=utf-8><body><script type="module">import * as L from "/live.js"; window.Live = L;</script>`); return; }
  if (u.pathname === "/live.js") { res.writeHead(200, { ...h, "content-type": "text/javascript" }); res.end(liveJs); return; }
  const m = /^\/scene(\d)\.html$/.exec(u.pathname);
  if (m) {
    let html = scenes[Number(m[1])].html;
    if (u.searchParams.has("noread")) html = html.replace("<head>", `<head><script>${NO_READBACK}</script>`);
    res.writeHead(200, { ...h, "content-type": "text/html" }); res.end(html); return;
  }
  res.writeHead(404, h); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };
const out = [];

try {
  for (const sc of scenes) {
    const idx = []; const step = Math.max(1, Math.floor(sc.frames / N)); for (let f = 0; f < sc.frames && idx.length < N; f += step) idx.push(f);
    const row = { scene: sc.i };

    // 1+2. Main thread (the bundle's own page), with and without the 1x1 readback.
    for (const [key, q] of [["main", ""], ["mainNoRead", "&noread=1"]]) {
      const page = await browser.newPage();
      await page.goto(`${origin}/scene${sc.i}.html?adapter=1${q}`);
      row[key] = await page.evaluate(async ({ idx, scale }) => {
        await window.FILM.ready; window.FILM.mount(scale); window.FILM.seek(0);
        const per = [];
        for (const f of idx) { const t0 = performance.now(); window.FILM.seek(f); per.push(performance.now() - t0); }
        // Throughput including GPU: draw all, then force one flush.
        globalThis.__allowRead = true;
        const t0 = performance.now(); for (const f of idx) window.FILM.seek(f);
        const c = document.getElementById("film"); c.getContext("2d").getImageData(0, 0, 1, 1);
        const through = (performance.now() - t0) / idx.length;
        return { per, through };
      }, { idx, scale: SCALE });
      await page.close();
    }

    // 3+4. Worker, exactly as the live player builds it, with and without the readback.
    const page = await browser.newPage();
    await page.goto(`${origin}/t.html`);
    await page.waitForFunction(() => Boolean(window.Live));
    for (const [key, patch] of [["worker", ""], ["workerNoRead", NO_READBACK]]) {
      row[key] = await page.evaluate(async ({ i, idx, scale, patch }) => {
        const html = await (await fetch(`/scene${i}.html`)).text();
        const src = patch + "\n" + window.Live.buildWorkerSource(html, {});
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
        const ch = new MessageChannel();
        w.postMessage({ t: "port", port: ch.port2 }, [ch.port2]);
        let id = 0; const pend = new Map();
        ch.port1.onmessage = (e) => { const p = pend.get(e.data.id); if (p) { pend.delete(e.data.id); p(e.data); } };
        await new Promise((r) => { const o = ch.port1.onmessage; ch.port1.onmessage = (e) => { if (e.data.t === "up") { ch.port1.onmessage = o; r(); } else o(e); }; });
        const call = (m) => new Promise((r) => { const k = ++id; pend.set(k, r); ch.port1.postMessage({ ...m, id: k }); });
        const init = await call({ t: "init", scale, params: "{}" });
        if (init.t !== "init") return { error: init.message };
        const draw = [], wall = [];
        for (const f of idx) { const t0 = performance.now(); const r = await call({ t: "frame", n: f }); wall.push(performance.now() - t0); draw.push(r.drawMs); try { r.bitmap.close(); } catch {} }
        w.terminate();
        return { draw, wall, size: `${init.w}x${init.h}` };
      }, { i: sc.i, idx, scale: SCALE, patch });
    }
    await page.close();

    // 5. CPU profile of the main-thread draw (where JS time goes).
    {
      const p = await browser.newPage();
      await p.goto(`${origin}/scene${sc.i}.html?adapter=1`);
      await p.evaluate(async (scale) => { await window.FILM.ready; window.FILM.mount(scale); window.FILM.seek(0); }, SCALE);
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start");
      await p.evaluate((idx) => { for (const f of idx) window.FILM.seek(f); }, idx);
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas; let total = 0;
      profile.samples.forEach((sid, k) => { const n = byId.get(sid); const name = n.callFrame.functionName || "(anon)"; const key = n.callFrame.url ? `${name}` : `[native] ${name}`; const d = dt[k] || 0; total += d; self.set(key, (self.get(key) || 0) + d); });
      row.profileTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`);
      await p.close();
    }
    row.summary = {
      mainPerFrameMs: med(row.main.per), mainThroughputMs: Math.round(row.main.through),
      mainNoReadPerFrameMs: med(row.mainNoRead.per), mainNoReadThroughputMs: Math.round(row.mainNoRead.through),
      workerDrawMs: med(row.worker.draw), workerWallMs: med(row.worker.wall),
      workerNoReadDrawMs: med(row.workerNoRead.draw), workerNoReadWallMs: med(row.workerNoRead.wall)
    };
    out.push({ scene: sc.i, summary: row.summary, profileTop: row.profileTop });
    console.log(JSON.stringify(out[out.length - 1]));
  }
} finally { await browser.close(); server.close(); }
