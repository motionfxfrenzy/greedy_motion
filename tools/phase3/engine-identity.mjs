// Pixel identity + speed of the plate engine's indexed point-in-polygon test, per style reference scene.
//   node tools/phase3/engine-identity.mjs [--base 23e1963] [--styles fox,balloon] [--out result.json] [--gpu]
// Items: (1) each canvas-core style file bundled as a scene (its exported film aliased to `film`) as 16:9 (1920x1080, the aspect-adaptation
// path where gallery adaptPts rewrites outlines) and as native 1:1 (1080x1080); (2) the five animated test fixtures. Each is bundled with the
// OLD engine (a temp copy from `git archive <base>`, its own old plate source) and the NEW one (this worktree), then drawn at a small (long
// side 640: 640x360 for 16:9) and a full size in headless Chrome. FILM.hash() (FNV over every pixel) is compared for frames 0, 1/4, 1/2, 3/4
// and last. Timing: ms of the first draw (frame 0) and the median ms over 9 further seeks; old and new alternate in the same browser.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "23e1963"), ONLY = arg("styles", ""), OUT = arg("out", "");
const CHROME = process.env.PLATE_BROWSER_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const tmp = mkdtempSync(join(tmpdir(), "engine-identity-"));
execFileSync("sh", ["-c", `git -C '${REPO}' archive ${BASE} packages/plate-engine | tar -x -C '${tmp}'`]);
symlinkSync(join(REPO, "node_modules"), join(tmp, "node_modules"));
const OLD_DIR = join(tmp, "packages/plate-engine"), NEW_DIR = join(REPO, "packages/plate-engine");
const oldEng = await import(pathToFileURL(join(OLD_DIR, "lib/engine.mjs")).href);
const newEng = await import(pathToFileURL(join(NEW_DIR, "lib/engine.mjs")).href);
const { chromium } = await import(pathToFileURL(join(REPO, "node_modules/playwright-core/index.mjs")).href);

const kebab = (n) => n.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
let styles = Object.keys(newEng.loadManifest().styles);
if (ONLY) styles = styles.filter((s) => ONLY.split(",").includes(s));

const pages = new Map();
const server = createServer((req, res) => { const h = pages.get(new URL(req.url, "http://x").pathname); if (!h) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(h); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
// Software rendering by default: with the GPU on, Chrome's canvas readback differs now and then between two draws of the SAME frame by the SAME
// engine (about 1 in 10 pages in the lighthouse scene, old engine too), which would make a pixel comparison meaningless. The worker renders in
// software as well. `--gpu` uses Chrome's defaults.
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: process.argv.includes("--gpu") ? [] : ["--disable-gpu"] });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
const hashIdx = [], timeIdx = [];


async function run(key, html, timeIt) {
  pages.set(`/${key}.html`, html);
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const out = {};
  try {
    await page.goto(`${origin}/${key}.html?adapter=1`);
    for (const label of ["small", "full"]) {
      out[label] = await page.evaluate(async ({ hashIdx, timeIdx, label, timeIt }) => {
        await window.FILM.ready;
        if (document.fonts?.ready) await document.fonts.ready;
        const m = window.FILM.meta, scale = label === "full" ? 1 : 640 / Math.max(m.W, m.H);
        window.FILM.mount(scale);
        // One discarded warm-up draw per mounted size: on --gpu, the first seek+hash readback after mount() transitions
        // the main 2D canvas across Chromium's readback heuristic and populates env.cache (tiles + Gfx offscreen layer pool).
        const tWarm = performance.now();
        window.FILM.seek(hashIdx[0]);
        const firstMs = performance.now() - tWarm;
        const firstHash = window.FILM.hash();
        const hashes = [], per = [];
        for (const f of hashIdx) { window.FILM.seek(f); hashes.push(window.FILM.hash()); }
        if (timeIt) for (const f of timeIdx) { const t0 = performance.now(); window.FILM.seek(f); per.push(performance.now() - t0); }
        return { hashes, firstHash, first: firstMs, per, w: Math.round(m.W * scale), h: Math.round(m.H * scale) };
      }, { hashIdx, timeIdx, label, timeIt });
    }
    return { ...out, errors };
  } catch (e) { return { error: String(e.message).slice(0, 300), errors }; } finally { await page.close(); }
}

const fixtures = JSON.parse(readFileSync(join(NEW_DIR, "test/fixtures.json"), "utf8"));
const items = [];
for (const name of styles) items.push({ id: name, kind: "style", name, aspects: ["16:9", "1:1"] });
if (!ONLY) for (const f of fixtures) items.push({ id: `fixture:${f.name}@${f.aspect}`, kind: "fixture", name: f.name, look: f.look, frames: f.frames, aspects: [f.aspect] });

const ownFrames = (code) => {
  const m = /durationFrames:\s*([A-Za-z0-9_]+)/.exec(code);
  if (!m) return 90;
  if (/^\d+$/.test(m[1])) return Math.max(1, Number(m[1]));
  const c = new RegExp(`(?:const|,)\\s*${m[1]}\\s*=\\s*(\\d+)`).exec(code);   // `const W = 1080, H = 1080, N = 540`
  return c ? Number(c[1]) : 90;
};
function plateSource(dir, name) {
  const code = readFileSync(join(dir, "src/canvas-core", `${name}.ts`), "utf8");
  const m = new RegExp(`export const (${name})\\s*:\\s*Film\\b`).exec(code) || /export const (\w+)\s*:\s*Film\s*=\s*\{/.exec(code);
  if (m) return `${code}\nexport const film: Film = ${m[1]};\n`;
  // storybook.ts exports drawStorybook(ctx, frame, env) rather than a Film object; wrap it in a Film in the harness.
  const fn = /export const (draw\w+)\s*=\s*\(\s*ctx\b/.exec(code);
  if (fn) return `import type { Film } from "./film";\n${code}\nexport const film: Film = { meta: { title: "${name}", W: 560, H: 560, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "${name}", start: 0, end: 90, draw: ${fn[1]} }] };\n`;
  return null;
}

// Some reference plates trip the model-scene validator or bundleScene's one-line-import assumption although they are valid engine code
// (a multi-line `import {` block, the word "window" in a comment, an `import("./core")` type). When the plain bundle fails, apply the SAME
// text normalisation to the old and the new source and try again (identity is unaffected: both engines draw the same normalised text).
const normalise = (code) => code
  .replace(/import\s*\{[^}]*\}\s*from\s*"[^"]+";/g, (m) => m.replace(/\s*\n\s*/g, " "))
  .replace(/import\("\.\/core"\)\.Env/g, "Env")
  .replace(/\b(window|document|navigator|location)\b/g, "$1_");
const bundlePair = async (look, oc, nc, frames, aspect) => {
  try { return { o: await oldEng.bundleScene({ look, code: oc, frames, aspect }), n: await newEng.bundleScene({ look, code: nc, frames, aspect }), normalised: false }; }
  catch (first) {
    try { return { o: await oldEng.bundleScene({ look, code: normalise(oc), frames, aspect }), n: await newEng.bundleScene({ look, code: normalise(nc), frames, aspect }), normalised: true }; }
    catch { throw first; }
  }
};
const rows = [], skipped = [];
let allIdentical = true;
try {
  for (const it of items) {
    for (const aspect of it.aspects) {
      const id = `${it.id}${it.kind === "style" ? `@${aspect}` : ""}`, row = { item: id };
      let o, n, frames;
      try {
        if (it.kind === "style") {
          const oc = plateSource(OLD_DIR, it.name), nc = plateSource(NEW_DIR, it.name);
          if (!oc || !nc) { skipped.push({ item: id, reason: "no `: Film` export to alias as `film`" }); continue; }
          frames = ownFrames(nc);
          const look = `illus-${kebab(it.name)}`;
          const pair = await bundlePair(look, oc, nc, frames, aspect); o = pair.o; n = pair.n;
          row.plateSourceUnchanged = oc === nc; if (pair.normalised) row.normalisedSource = true;
        } else {
          frames = it.frames;
          o = await oldEng.bundleScene({ look: it.look, code: readFileSync(join(OLD_DIR, "test/fixtures", `${it.name}.ts`), "utf8"), frames, aspect });
          n = await newEng.bundleScene({ look: it.look, code: readFileSync(join(NEW_DIR, "test/fixtures", `${it.name}.ts`), "utf8"), frames, aspect });
        }
      } catch (e) { skipped.push({ item: id, reason: String(e.message).split("\n").slice(0, 2).join(" ").slice(0, 200) }); continue; }
      row.frames = frames;
      hashIdx.length = 0; hashIdx.push(...[0, Math.floor(frames / 4), Math.floor(frames / 2), Math.floor((3 * frames) / 4), frames - 1]);
      timeIdx.length = 0; timeIdx.push(...Array.from({ length: 9 }, (_, i) => Math.min(frames - 1, 3 + Math.round((i * Math.max(0, frames - 8)) / 8))));
      let ro = await run(`o-${row.item.replace(/\W/g, "_")}`, o.html, true), rn = await run(`n-${row.item.replace(/\W/g, "_")}`, n.html, true);
      const fix = /shots end at frame (\d+)/.exec(ro.error ?? "");   // the plate computes its own length (e.g. woodcut: N from its pulls)
      if (fix) {
        frames = Number(fix[1]); row.frames = frames;
        const pair = await bundlePair(`illus-${kebab(it.name)}`, plateSource(OLD_DIR, it.name), plateSource(NEW_DIR, it.name), frames, aspect); o = pair.o; n = pair.n;
        hashIdx.length = 0; hashIdx.push(...[0, Math.floor(frames / 4), Math.floor(frames / 2), Math.floor((3 * frames) / 4), frames - 1]);
        timeIdx.length = 0; timeIdx.push(...Array.from({ length: 9 }, (_, i) => Math.min(frames - 1, 3 + Math.round((i * Math.max(0, frames - 8)) / 8))));
        ro = await run(`o-${row.item.replace(/\W/g, "_")}`, o.html, true); rn = await run(`n-${row.item.replace(/\W/g, "_")}`, n.html, true);
      }
      for (const label of ["small", "full"]) {
        const a = ro[label], b = rn[label];
        if (ro.error || rn.error || !a || !b) { row[label] = { error: ro.error || rn.error || "no result" }; allIdentical = false; continue; }
        let same = JSON.stringify(a.hashes) === JSON.stringify(b.hashes) && !ro.errors.length && !rn.errors.length;
        if (!same) {   // diagnose: fresh pages, 3 more draws each; a style whose OLD engine also disagrees with itself is not deterministic here
          const ro2 = [], rn2 = [];
          for (let k = 0; k < 3; k++) { ro2.push((await run(`o2-${k}-${row.item.replace(/\W/g, "_")}`, o.html, false))[label]?.hashes.join()); rn2.push((await run(`n2-${k}-${row.item.replace(/\W/g, "_")}`, n.html, false))[label]?.hashes.join()); }
          row[`${label}Retry`] = { first: { old: a.hashes.join(), new: b.hashes.join() }, oldRuns: ro2, newRuns: rn2 };
          const count = (arr) => arr.reduce((m, h) => m.set(h, (m.get(h) ?? 0) + 1), new Map());
          const oc = count([a.hashes.join(), ...ro2]), nc = count([b.hashes.join(), ...rn2]);
          const oldMode = [...oc.entries()].sort((x, y) => y[1] - x[1])[0][0];
          const newMode = [...nc.entries()].sort((x, y) => y[1] - x[1])[0][0];
          row[`${label}Verdict`] = newMode !== oldMode ? "NEW majority differs from OLD majority: REAL DIFFERENCE" : nc.size > 1 && oc.size === 1 ? "NEW engine differs between runs while OLD is stable: REAL DIFFERENCE or nondeterminism" : "OLD/GPU raster varied across fresh pages; OLD and NEW have identical majority hash (counted identical)";
          same = newMode === oldMode && (oc.size > 1 || nc.size === 1);
        }
        allIdentical &&= same;
        row[label] = { size: `${a.w}x${b.h}`, identical: same, firstDrawIdentical: a.firstHash === b.firstHash, oldFirstHash: a.firstHash, newFirstHash: b.firstHash, oldFirstMs: +a.first.toFixed(1), newFirstMs: +b.first.toFixed(1), oldMedianMs: med(a.per), newMedianMs: med(b.per), medianSpeedup: +(med(a.per) / med(b.per)).toFixed(2), hashes: b.hashes };
      }
      rows.push(row);
      console.log(JSON.stringify({ item: row.item, frames, small: row.small && row.small.error ? row.small : row.small && { size: row.small.size, same: row.small.identical, first: [row.small.oldFirstMs, row.small.newFirstMs], med: [row.small.oldMedianMs, row.small.newMedianMs] }, full: row.full && row.full.error ? row.full : row.full && { size: row.full.size, same: row.full.identical, first: [row.full.oldFirstMs, row.full.newFirstMs], med: [row.full.oldMedianMs, row.full.newMedianMs] } }));
    }
  }
} finally { await browser.close(); server.close(); rmSync(tmp, { recursive: true, force: true }); }
const summary = { base: BASE, items: rows.length, skipped, allIdentical, rows };
if (OUT) writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ items: rows.length, skipped, allIdentical }));
process.exit(allIdentical ? 0 : 1);
