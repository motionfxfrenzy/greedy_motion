// Exports real code-drawn crayon frames at the live-preview size (640x360): lossless WebP plus lossy WebP at several qualities,
// with size and fidelity (pixels changed, PSNR) against exactly what the code drew. Writes frames.json.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const REPO = process.argv[2], OUT = process.argv[3];
const QUALITIES = [0.92, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");
const pages = [0, 1, 2, 3].map((i) => readFileSync(join(FIX, `scene${i}.html`), "utf8"));
const server = createServer((req, res) => { const i = Number(new URL(req.url, "http://x").pathname.slice(1)); res.writeHead(200, { "content-type": "text/html" }); res.end(pages[i] ?? ""); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const out = [];
try {
  for (const [scene, frame] of [[1, 70], [0, 60]]) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/${scene}?adapter=1`);
    out.push(await page.evaluate(async ({ scene, frame, qualities }) => {
      await window.FILM.ready; window.FILM.mount(640 / 1920); window.FILM.seek(frame);
      const src = document.getElementById("film"), W = src.width, H = src.height;
      const toUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      const blobOf = (type, q) => new Promise((res) => src.toBlob(res, type, q));
      const a0 = src.getContext("2d").getImageData(0, 0, W, H).data;
      const stats = async (blob) => { const bm = await createImageBitmap(blob); const c = new OffscreenCanvas(W, H).getContext("2d"); c.drawImage(bm, 0, 0); bm.close(); const b = c.getImageData(0, 0, W, H).data; let se = 0, n = 0, ch = 0; for (let i = 0; i < a0.length; i += 4) { let px = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(a0[i + k] - b[i + k]); se += d * d; n++; if (d > px) px = d; } if (px > 2) ch++; } return { pct: +(100 * ch / (n / 3)).toFixed(1), psnr: +(10 * Math.log10(65025 / (se / n))).toFixed(1) }; };
      const lossless = await blobOf("image/webp", 1);
      const variants = [];
      for (const q of qualities) { const b = await blobOf("image/webp", q); variants.push({ q, url: await toUrl(b), size: b.size, ...(await stats(b)) }); }
      return { scene, frame, w: W, h: H, lossless: { url: await toUrl(lossless), size: lossless.size }, variants };
    }, { scene, frame, qualities: QUALITIES }));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify(out.map((o) => ({ scene: o.scene, lossless: Math.round(o.lossless.size / 1024), v: o.variants.map((v) => `${v.q}: ${Math.round(v.size / 1024)}KB ${v.psnr}dB ${v.pct}%`) }))));
