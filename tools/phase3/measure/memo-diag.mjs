// Measurement only: how fast would the server crayon scenes draw if the engine's hatchRuns remembered its result for a shape
// it has already filled? Wraps hatchRuns in each bundle with a memo keyed by its arguments plus the keep() answers at 64
// sample points (an approximation good enough to estimate the gain; not a product fix). Main thread, 640x360.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const REPO = process.argv[2];
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");
const N = 24;

const MEMO = `<script>window.__memoRun=(()=>{const m=new Map();let hit=0,miss=0;const f=(b,ang,gap,keep,step,seed,run)=>{const sig=[];for(let i=0;i<8;i++)for(let j=0;j<8;j++){const x=b.x0+(b.x1-b.x0)*(i+.5)/8,y=b.y0+(b.y1-b.y0)*(j+.5)/8;sig.push(keep(x,y)?1:0)}const k=[b.x0,b.y0,b.x1,b.y1,ang,gap,step,seed].map(v=>Math.round(v*100)).join(",")+"|"+sig.join("");let r=m.get(k);if(r){hit++;return r}miss++;r=run();m.set(k,r);return r};f.stats=()=>({hit,miss,size:m.size});return f})();</script>`;

function patch(html) {
  // hatchRuns: `,NAME=(b,ang,gap,keep,step=3,seed=1)=>{ ... return RES},` where the body ends right before the even-odd test fn.
  const re = /,([A-Za-z_$][\w$]*)=\(([A-Za-z_$]\w*),([A-Za-z_$]\w*),([A-Za-z_$]\w*),([A-Za-z_$]\w*),([A-Za-z_$]\w*)=3,([A-Za-z_$]\w*)=1\)=>\{let /;
  const m = re.exec(html);
  if (!m) throw new Error("hatchRuns not found");
  const [, name, b, ang, gap, keep, step, seed] = m;
  const start = m.index;
  const bodyStart = start + m[0].length - "let ".length;
  // find matching closing brace of the arrow body
  let depth = 0, i = bodyStart - 1;
  for (; i < html.length; i++) { const c = html[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break; } }
  const body = html.slice(bodyStart, i);
  const replaced = `,${name}=(${b},${ang},${gap},${keep},${step}=3,${seed}=1)=>window.__memoRun(${b},${ang},${gap},${keep},${step},${seed},()=>{${body}})`;
  return { html: html.slice(0, start) + replaced + html.slice(i + 1), name };
}

const scenes = [0, 1, 2, 3].map((i) => {
  const raw = readFileSync(join(FIX, `scene${i}.html`), "utf8");
  const p = patch(raw);
  return { i, raw, memo: p.html.replace("<head>", `<head>${MEMO}`), name: p.name, frames: JSON.parse(readFileSync(join(FIX, `scene${i}.json`), "utf8")).manifest.frames };
});
const server = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  const m = /^\/(raw|memo)(\d)\.html$/.exec(u.pathname);
  if (!m) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(scenes[Number(m[2])][m[1]]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };
try {
  for (const sc of scenes) {
    const idx = []; for (let f = 0; f < sc.frames; f += 2) idx.push(f); // every preview frame in order, as playback draws them
    const res = {};
    for (const kind of ["raw", "memo"]) {
      const page = await browser.newPage();
      await page.goto(`${origin}/${kind}${sc.i}.html?adapter=1`);
      res[kind] = await page.evaluate(async ({ idx }) => {
        await window.FILM.ready; window.FILM.mount(640 / 1920);
        const per = []; let pixels = null;
        for (const f of idx) { const t0 = performance.now(); window.FILM.seek(f); per.push(performance.now() - t0); }
        // a pixel hash of three frames, to check the memo did not change the picture
        const hashes = [idx[0], idx[Math.floor(idx.length / 2)], idx[idx.length - 1]].map((f) => { window.FILM.seek(f); return window.FILM.hash(); });
        return { per, hashes, stats: window.__memoRun ? window.__memoRun.stats() : null };
      }, { idx });
      await page.close();
    }
    const first = (a) => Math.round(a[0]);
    console.log(JSON.stringify({
      scene: sc.i, fn: sc.name, previewFrames: idx.length,
      rawMedianMs: med(res.raw.per), memoMedianMs: med(res.memo.per), memoFirstFrameMs: first(res.memo.per),
      rawDrawFps: +(1000 / med(res.raw.per)).toFixed(1), memoDrawFps: +(1000 / med(res.memo.per)).toFixed(1),
      samePixels: JSON.stringify(res.raw.hashes) === JSON.stringify(res.memo.hashes), memo: res.memo.stats
    }));
  }
} finally { await browser.close(); server.close(); }
