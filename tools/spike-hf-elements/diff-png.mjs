import { chromium } from "/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const pg = await b.newPage();
const [a, c] = process.argv.slice(2).map((f) => readFileSync(f).toString("base64"));
console.log(JSON.stringify(await pg.evaluate(async ([a, c]) => {
  const load = async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const cv = new OffscreenCanvas(i.width, i.height), x = cv.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
  const [p, q] = [await load(a), await load(c)]; let n = 0, max = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let i = 0; i < p.length; i += 4) { const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])); if (d) { n++; max = Math.max(max, d); const px = (i / 4) % 1920, py = Math.floor(i / 4 / 1920); minx = Math.min(minx, px); maxx = Math.max(maxx, px); miny = Math.min(miny, py); maxy = Math.max(maxy, py); } }
  return { differing: n, max, bbox: [minx, miny, maxx, maxy] };
}, [a, c])));
await b.close();
