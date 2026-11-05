// Measurement only: per lossy quality, the cost of keeping code-drawn crayon frames (640x360): bytes, PSNR vs the drawn frame,
// time to save (encode) and to load back (decode) one frame, averaged over frames of all four staging scenes.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const REPO = process.argv[2];
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");
const pages = [0, 1, 2, 3].map((i) => readFileSync(join(FIX, `scene${i}.html`), "utf8"));
const server = createServer((req, res) => { const i = Number(new URL(req.url, "http://x").pathname.slice(1)); res.writeHead(200, { "content-type": "text/html" }); res.end(pages[i] ?? ""); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const acc = {};
try {
  for (let s = 0; s < 4; s++) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/${s}?adapter=1`);
    const r = await page.evaluate(async () => {
      await window.FILM.ready; window.FILM.mount(640 / 1920);
      const src = document.getElementById("film"), W = src.width, H = src.height, out = {};
      for (const q of [0.2, 0.4, 0.6]) {
        const rows = [];
        for (let f = 0; f < window.FILM.meta.durationFrames; f += 25) {
          window.FILM.seek(f);
          const a = src.getContext("2d").getImageData(0, 0, W, H).data;
          let t0 = performance.now(); const blob = await new Promise((res) => src.toBlob(res, "image/webp", q)); const enc = performance.now() - t0;
          t0 = performance.now(); const bm = await createImageBitmap(blob); const dec = performance.now() - t0;
          const c = new OffscreenCanvas(W, H).getContext("2d"); c.drawImage(bm, 0, 0); bm.close();
          const b = c.getImageData(0, 0, W, H).data; let se = 0, n = 0;
          for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = a[i + k] - b[i + k]; se += d * d; n++; }
          rows.push({ kb: blob.size / 1024, enc, dec, psnr: 10 * Math.log10(65025 / (se / n)) });
        }
        out[q] = rows;
      }
      return out;
    });
    for (const [q, rows] of Object.entries(r)) (acc[q] ??= []).push(...rows);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
for (const [q, rows] of Object.entries(acc)) {
  const kb = avg(rows, "kb");
  console.log(JSON.stringify({ q, frames: rows.length, kbPerFrame: Math.round(kb), film15sMB: Math.round(kb * 450 / 1024), film60sMB: Math.round(kb * 1800 / 1024), psnrDb: +avg(rows, "psnr").toFixed(1), saveMs: +avg(rows, "enc").toFixed(1), loadMs: +avg(rows, "dec").toFixed(1) }));
}
