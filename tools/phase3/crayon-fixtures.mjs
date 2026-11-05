// Measurement only (adapted from the manager's inside-diag.mjs): replace the old point-in-polygon test inside each prebuilt crayon staging bundle
// with the new engine's insideRing and compare speed and pixels.  node tools/phase3/crayon-fixtures.mjs
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(join(REPO, "node_modules/playwright-core/index.mjs"));
const FIX = join(REPO, "frontend/test/fixtures/crayon-staging");

// The NEW engine's own insideRing + ringNewFrame (packages/plate-engine/src/canvas-core/core.ts), compiled and injected where the staging
// bundles' old `inside` stood. Staging bundles are prebuilt with the OLD engine, so this measures what a re-bundle would bring.
const { build } = await import(join(REPO, "node_modules/esbuild/lib/main.js"));
const built = await build({
  stdin: {
    contents: `import { insideRing, ringNewFrame } from "./core"; window.__insideFast = insideRing; window.__ringNewFrame = ringNewFrame;`,
    resolveDir: join(REPO, "packages/plate-engine/src/canvas-core"),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  minify: true,
  logLevel: "silent"
});
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
        res[`${kind}@${scale === 1 ? "1920" : "640"}`] = await page.evaluate(async ({ idx, scale, isFast }) => {
          await window.FILM.ready; window.FILM.mount(scale);
          if (isFast && window.__ringNewFrame) {
            const origSeek = window.FILM.seek;
            window.FILM.seek = (f) => { window.__ringNewFrame(); return origSeek(f); };
          }
          // One warm-up draw on the mounted surface before timing/hashing
          window.FILM.seek(idx[0]); window.FILM.hash();
          const per = []; const hashes = [];
          for (const f of idx) { const t0 = performance.now(); window.FILM.seek(f); per.push(performance.now() - t0); }
          for (const f of idx.filter((_, k) => k % 5 === 0)) { window.FILM.seek(f); hashes.push(window.FILM.hash()); }
          return { per, hashes };
        }, { idx, scale, isFast: kind === "fast" });
        await page.close();
      }
    }
    // Measure the per-frame cost of the mutation guard's full-content check (ringSame on first use per outline per epoch)
    const guardPage = await browser.newPage();
    await guardPage.goto(`${origin}/fast${sc.i}.html?adapter=1`);
    const guardStats = await guardPage.evaluate(async ({ idx }) => {
      await window.FILM.ready; window.FILM.mount(640 / 1920);
      const sampleIdx = idx.slice(0, Math.min(10, idx.length));
      const origInside = window.__insideFast;
      const seen = new WeakMap();
      let epoch = 0, queries = 0, builds = 0, epochChecks = 0, epochVerts = 0;
      const epochOutlines = [];
      const origSeek = window.FILM.seek;
      window.FILM.seek = (f) => { epoch++; window.__ringNewFrame(); return origSeek(f); };
      window.__insideFast = (p, x, y) => {
        const n = p.length;
        if (n >= 16) {
          queries++;
          let c = seen.get(p);
          if (c && c.ep !== epoch) {
            epochChecks++;
            epochVerts += n;
            epochOutlines.push([p, c]);
            c.ep = epoch;
          } else if (!c) {
            builds++;
            const xy = new Float64Array(2 * n);
            for (let i = 0; i < n; i++) { xy[2 * i] = p[i][0]; xy[2 * i + 1] = p[i][1]; }
            c = { n, fx: p[0][0], fy: p[0][1], mx: p[n >> 1][0], my: p[n >> 1][1], lx: p[n - 1][0], ly: p[n - 1][1], ep: epoch, xy };
            seen.set(p, c);
            epochOutlines.push([p, c]);
          }
        }
        return origInside(p, x, y);
      };
      // Warm up frame 0 so module-scope outlines are indexed before measuring steady-state frames
      window.FILM.seek(sampleIdx[0]);
      queries = 0; builds = 0; epochChecks = 0; epochVerts = 0; epochOutlines.length = 0;
      for (const f of sampleIdx) window.FILM.seek(f);
      const frames = sampleIdx.length;
      // Time the full-content Object.is check (ringSame) across all recorded per-frame outline checks (averaged over 500 passes)
      const REPS = 500;
      let sink = 0;
      const t0 = performance.now();
      for (let r = 0; r < REPS; r++) {
        for (let k = 0; k < epochOutlines.length; k++) {
          const [p, c] = epochOutlines[k], xy = c.xy, n = c.n;
          let same = p.length === n;
          if (same) {
            for (let i = 0; i < n; i++) {
              if (!Object.is(p[i][0], xy[2 * i]) || !Object.is(p[i][1], xy[2 * i + 1])) { same = false; break; }
            }
          }
          if (same) sink++;
        }
      }
      const fullCheckMsTotal = (performance.now() - t0) / REPS;
      const fullCheckMsPerFrame = +(fullCheckMsTotal / frames).toFixed(4);
      return {
        guardMsPerFrame: fullCheckMsPerFrame,
        queriesPerFrame: Math.round(queries / frames),
        buildsPerFrame: +(builds / frames).toFixed(1),
        epochChecksPerFrame: +(epochChecks / frames).toFixed(1),
        epochVertsPerFrame: Math.round(epochVerts / frames),
        outlinesPerFrame: +(epochOutlines.length / frames).toFixed(1),
        sink
      };
    }, { idx });
    await guardPage.close();

    const same = (s) => JSON.stringify(res[`raw@${s}`].hashes) === JSON.stringify(res[`fast@${s}`].hashes);
    const fast640 = med(res["fast@640"].per);
    console.log(JSON.stringify({
      scene: sc.i, patchedFns: sc.count, previewFrames: idx.length,
      "640: raw ms": med(res["raw@640"].per), "640: fast ms": fast640,
      "1920: raw ms": med(res["raw@1920"].per), "1920: fast ms": med(res["fast@1920"].per),
      "640: fast draw fps": +(1000 / fast640).toFixed(1),
      guardMsPerFrame: guardStats.guardMsPerFrame,
      guardPctOfDraw640: +((guardStats.guardMsPerFrame / fast640) * 100).toFixed(2),
      guardStats,
      identicalPixels640: same("640"), identicalPixels1920: same("1920"), hashedFrames: res["raw@640"].hashes.length,
      hashes640: res["fast@640"].hashes,
      hashes1920: res["fast@1920"].hashes
    }));
  }
} finally { await browser.close(); server.close(); }
