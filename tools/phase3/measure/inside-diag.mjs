// Measurement only: replace the engine's point-in-polygon test inside each server bundle with an exact, indexed version
// (bounding-box reject + edges bucketed by height, built once per outline array) and compare speed and pixels.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const REPO = process.argv[2];
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");

const FAST = `<script>window.__insideFast=(()=>{const C=new WeakMap();
const build=(p)=>{let x0=1e300,y0=1e300,x1=-1e300,y1=-1e300;for(let i=0;i<p.length;i++){const q=p[i];if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];if(q[1]<y0)y0=q[1];if(q[1]>y1)y1=q[1];}
const B=Math.max(1,Math.min(512,p.length>>1)),h=(y1-y0)/B||1,bk=new Array(B);for(let k=0;k<B;k++)bk[k]=[];
for(let i=0,j=p.length-1;i<p.length;j=i++){const ay=p[i][1],by=p[j][1];if(ay===by)continue;const lo=ay<by?ay:by,hi=ay<by?by:ay;let s=Math.floor((lo-y0)/h),e=Math.floor((hi-y0)/h);if(s<0)s=0;if(e>B-1)e=B-1;for(let k=s;k<=e;k++)bk[k].push(i,j);}
return{x0,x1,y0,y1,h,B,bk};};
return(p,x,y)=>{let c=C.get(p);if(!c){c=build(p);C.set(p,c);}
if(!(y>=c.y0&&y<=c.y1&&x>=c.x0&&x<=c.x1))return false;
let k=Math.floor((y-c.y0)/c.h);if(k<0)k=0;if(k>c.B-1)k=c.B-1;const L=c.bk[k];let r=false;
for(let n=0;n<L.length;n+=2){const a=p[L[n]],b=p[L[n+1]];if(a[1]>y!==b[1]>y&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])r=!r;}return r;};})();</script>`;

function patch(html) {
  // engine inside(): `,NAME=(P,X,Y)=>{let S=ADAPT(P),K=!1;for(let ...` ; replace the whole arrow with a call to the indexed test.
  const re = /,([A-Za-z_$][\w$]*)=\(([A-Za-z_$]\w*),([A-Za-z_$]\w*),([A-Za-z_$]\w*)\)=>\{let ([A-Za-z_$]\w*)=([A-Za-z_$][\w$]*)\(\2\),([A-Za-z_$]\w*)=!1;for\(let /g;
  let m, out = html, count = 0;
  while ((m = re.exec(html))) {
    const [, name, P, X, Y, , ADAPT] = m;
    const bodyStart = m.index + m[0].indexOf("{");
    let depth = 0, i = bodyStart;
    for (; i < html.length; i++) { const c = html[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break; } }
    const orig = html.slice(m.index, i + 1);
    out = out.replace(orig, `,${name}=(${P},${X},${Y})=>window.__insideFast(${ADAPT}(${P}),${X},${Y})`);
    count++;
  }
  return { html: out.replace("<head>", `<head>${FAST}`), count };
}

const scenes = [0, 1, 2, 3].map((i) => {
  const raw = readFileSync(join(FIX, `scene${i}.html`), "utf8");
  const p = patch(raw);
  return { i, raw, fast: p.html, count: p.count, frames: JSON.parse(readFileSync(join(FIX, `scene${i}.json`), "utf8")).manifest.frames };
});
const server = createServer((req, res) => {
  const m = /^\/(raw|fast)(\d)\.html$/.exec(new URL(req.url ?? "/", "http://x").pathname);
  if (!m) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(scenes[Number(m[2])][m[1]]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };
try {
  for (const sc of scenes) {
    const idx = []; for (let f = 0; f < sc.frames; f += 2) idx.push(f);
    const res = {};
    for (const kind of ["raw", "fast"]) {
      for (const scale of [640 / 1920, 1]) {
        const page = await browser.newPage();
        await page.goto(`${origin}/${kind}${sc.i}.html?adapter=1`);
        res[`${kind}@${scale === 1 ? "1920" : "640"}`] = await page.evaluate(async ({ idx, scale }) => {
          await window.FILM.ready; window.FILM.mount(scale);
          const per = []; const hashes = [];
          for (const f of idx) { const t0 = performance.now(); window.FILM.seek(f); per.push(performance.now() - t0); }
          for (const f of idx.filter((_, k) => k % 5 === 0)) { window.FILM.seek(f); hashes.push(window.FILM.hash()); }
          return { per, hashes };
        }, { idx, scale });
        await page.close();
      }
    }
    const same = (s) => JSON.stringify(res[`raw@${s}`].hashes) === JSON.stringify(res[`fast@${s}`].hashes);
    console.log(JSON.stringify({
      scene: sc.i, patchedFns: sc.count, previewFrames: idx.length,
      "640: raw ms": med(res["raw@640"].per), "640: fast ms": med(res["fast@640"].per),
      "1920: raw ms": med(res["raw@1920"].per), "1920: fast ms": med(res["fast@1920"].per),
      "640: fast draw fps": +(1000 / med(res["fast@640"].per)).toFixed(1),
      identicalPixels640: same("640"), identicalPixels1920: same("1920"), hashedFrames: res["raw@640"].hashes.length
    }));
  }
} finally { await browser.close(); server.close(); }
