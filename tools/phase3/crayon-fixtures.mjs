// Measurement only (adapted from the manager's inside-diag.mjs): replace the old point-in-polygon test inside each prebuilt crayon staging bundle
// with the new engine's insideRing and compare speed and pixels.  node tools/phase3/crayon-fixtures.mjs
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");

// The NEW engine's own insideRing (packages/plate-engine/src/canvas-core/core.ts), compiled and injected where the staging bundles' old
// `inside` stood. Staging bundles are prebuilt with the OLD engine, so this measures what a re-bundle would bring.
const { build } = await import(join(REPO, "node_modules/esbuild/lib/main.js"));
const built = await build({ stdin: { contents: `import { insideRing } from "./core"; window.__insideFast = insideRing;`, resolveDir: join(REPO, "packages/plate-engine/src/canvas-core"), loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser", minify: true, logLevel: "silent" });
const FAST = `<script>${built.outputFiles[0].text}</script>`;

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
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: process.argv.includes("--gpu") ? [] : ["--disable-gpu"] });
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
