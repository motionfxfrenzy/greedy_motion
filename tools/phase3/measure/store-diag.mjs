// Measurement only: if every drawn frame were kept so a scene can replay forever, what does it cost?
// Draws crayon frames at 640x360 and 960x540, then keeps each as raw RGBA, WebP 0.92, WebP lossless (quality 1) and PNG.
// Reports bytes per frame, encode ms, decode ms (createImageBitmap), and the blit time of a decoded frame (playback cost).
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const REPO = process.argv[2];
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");
const html = readFileSync(join(FIX, "scene1.html"), "utf8");
const server = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const W of [640, 960]) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/?adapter=1`);
    const r = await page.evaluate(async (W) => {
      await window.FILM.ready; window.FILM.mount(W / 1920);
      const src = document.getElementById("film");
      const H = src.height;
      const out = { size: `${src.width}x${H}`, raw: src.width * H * 4 };
      const kinds = [["webp92", "image/webp", 0.92], ["webpLossless", "image/webp", 1], ["png", "image/png", undefined]];
      const view = new OffscreenCanvas(src.width, H).getContext("2d");
      for (const [k, type, q] of kinds) {
        const sizes = [], enc = [], dec = [], blit = [];
        for (let f = 0; f < 150; f += 15) {
          window.FILM.seek(f);
          let t0 = performance.now();
          const blob = await new Promise((res) => src.toBlob(res, type, q));
          enc.push(performance.now() - t0); sizes.push(blob.size);
          t0 = performance.now(); const bm = await createImageBitmap(blob); dec.push(performance.now() - t0);
          t0 = performance.now(); for (let i = 0; i < 20; i++) view.drawImage(bm, 0, 0); view.getImageData(0, 0, 1, 1); blit.push((performance.now() - t0) / 20);
          bm.close();
        }
        const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
        out[k] = { kbPerFrame: Math.round(avg(sizes) / 1024), encodeMs: +avg(enc).toFixed(1), decodeMs: +avg(dec).toFixed(1), blitMs: +avg(blit).toFixed(2) };
      }
      return out;
    }, W);
    const per = (kb) => ({ "15s film @30fps (450 frames) MB": Math.round(kb * 450 / 1024), "60s film MB": Math.round(kb * 1800 / 1024) });
    console.log(JSON.stringify({ ...r, rawKbPerFrame: Math.round(r.raw / 1024), raw15sMB: Math.round(r.raw * 450 / 1048576), raw60sMB: Math.round(r.raw * 1800 / 1048576), webp92Film: per(r.webp92.kbPerFrame), losslessFilm: per(r.webpLossless.kbPerFrame), pngFilm: per(r.png.kbPerFrame) }));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
