// Measurement only: how far is a stored WebP picture from the code-drawn frame it came from?
// For crayon frames at 640x360: per quality, mean and max channel difference, share of pixels changed, PSNR, size.
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
const agg = {};
try {
  for (let s = 0; s < 4; s++) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/${s}?adapter=1`);
    const r = await page.evaluate(async () => {
      await window.FILM.ready; window.FILM.mount(640 / 1920);
      const src = document.getElementById("film"), W = src.width, H = src.height;
      const out = {};
      for (const q of [0.92, 0.97, 1]) {
        let sum = 0, max = 0, changed = 0, n = 0, se = 0, bytes = 0, frames = 0;
        for (let f = 0; f < window.FILM.meta.durationFrames; f += 20) {
          window.FILM.seek(f);
          const a = src.getContext("2d").getImageData(0, 0, W, H).data;
          const blob = await new Promise((res) => src.toBlob(res, "image/webp", q)); bytes += blob.size; frames++;
          const bm = await createImageBitmap(blob); const oc = new OffscreenCanvas(W, H).getContext("2d"); oc.drawImage(bm, 0, 0); bm.close();
          const b = oc.getImageData(0, 0, W, H).data;
          for (let i = 0; i < a.length; i += 4) {
            let px = 0;
            for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; se += d * d; n++; if (d > max) max = d; if (d > px) px = d; }
            if (px > 2) changed++;
          }
        }
        const mse = se / n;
        out[q] = { meanDiff: +(sum / n).toFixed(3), maxDiff: max, pctPixelsOver2Levels: +(100 * changed / (n / 3)).toFixed(2), psnrDb: mse === 0 ? "identical" : +(10 * Math.log10(255 * 255 / mse)).toFixed(1), kbPerFrame: Math.round(bytes / frames / 1024) };
      }
      return out;
    });
    console.log(JSON.stringify({ scene: s, ...r }));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
