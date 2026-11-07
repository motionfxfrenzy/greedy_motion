import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { bundleScene } from "../../packages/plate-engine/lib/engine.mjs";
import { withTimingLock } from "./timing-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RESULTS_DIR = "/private/tmp/gm-draft-preview-integration-results";
const BENCH_DIR = join(RESULTS_DIR, "benchmarks");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(BENCH_DIR, { recursive: true, mode: 0o700 });
try {
  chmodSync(BENCH_DIR, 0o700);
} catch {}

function toKebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function loadBuiltInStyleBundleCode(styleKey, fileRel) {
  const raw = readFileSync(join(REPO_ROOT, "packages/plate-engine/src", fileRel), "utf8");
  const mExport = /export const ([A-Za-z0-9_]+)\s*:\s*Film\s*=/.exec(raw);
  const cleaned = raw
    .replace(/import\s+(type\s+)?\{([\s\S]*?)\}\s*from/g, (_, tp, inner) => `import ${tp ?? ""}{ ${inner.replace(/\s+/g, " ").trim()} } from`)
    .replace(/export\s+const\s+STYLE\s*=\s*\{[\s\S]*?\};/g, "")
    .replace(/import\(["']\.\/core["']\)\.Env/g, "any")
    .replace(/\bwindow\b/g, "winVar")
    .replace(/\bdocument\b/g, "docVar")
    .replace(/\blocation\b/g, "locVar");
  if (!mExport) {
    const drawFnMatches = [...raw.matchAll(/export const (draw[A-Za-z0-9_]+)\s*=/g)];
    const drawFn = drawFnMatches.at(-1)?.[1] ?? "drawStorybook";
    return `${cleaned}\nimport type { Film } from "./film";\nexport const film: Film = { meta: { title: "${styleKey}", W: 560, H: 560, fps: 30, bpm: 120, durationFrames: 90 }, assets: { images: {} }, shots: [{ id: "main", start: 0, end: 90, draw: ${drawFn} }] };\n`;
  }
  return `${cleaned}\nexport const film: Film = ${mExport[1]};\n`;
}

await withTimingLock("all-31-active-frame-audit", async () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages/plate-engine/manifest.json"), "utf8"));
  const styleEntries = Object.entries(manifest.styles);

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const results = [];

  try {
    for (const [styleId, info] of styleEntries) {
      const look = `illus-${toKebab(styleId)}`;
      const code = loadBuiltInStyleBundleCode(styleId, info.file);
      const rawSrc = readFileSync(join(REPO_ROOT, "packages/plate-engine/src", info.file), "utf8");
      const nMatch = /const\s+N\s*=\s*(\d+)/.exec(rawSrc);
      const durMatch = /durationFrames:\s*(\d+)/.exec(rawSrc);
      const nativeFrames = durMatch ? Number(durMatch[1]) : nMatch ? Number(nMatch[1]) : 120;
      const wMatch = /W:\s*(\d+),\s*H:\s*(\d+)/.exec(rawSrc);
      const aspect = wMatch && wMatch[1] === wMatch[2] ? "1:1" : "16:9";
      const scale = aspect === "1:1" ? 480 / 1080 : 640 / 1920;

      const bundled = await bundleScene({
        look,
        code,
        frames: nativeFrames,
        aspect
      });

      const activeFrame = nativeFrames <= 1 ? 0 : Math.floor(nativeFrames * 0.72);

      const measureStyleMode = async (spec) => {
        const page = await browser.newPage();
        await page.setContent(bundled.html, { waitUntil: "load" });
        const m = await page.evaluate(
          async ({ f, sc, sp, totalF }) => {
            window.FILM.mount(sc);
            const c = document.getElementById("film");

            const tCold0 = performance.now();
            const coldRes = window.FILM.seek(f, sp);
            const coldSeekMs = Math.round((performance.now() - tCold0) * 100) / 100;
            const stats = coldRes.stats;

            const tWarm0 = performance.now();
            window.FILM.seek(f, sp);
            const warmSameMs = Math.round((performance.now() - tWarm0) * 100) / 100;

            const advTimes = [];
            if (totalF > 1) {
              const startF = Math.max(0, f - 5);
              for (let k = 0; k < 5; k++) {
                const mf = Math.min(totalF - 1, startF + k);
                const tAdv0 = performance.now();
                window.FILM.seek(mf, sp);
                advTimes.push(performance.now() - tAdv0);
              }
            } else {
              for (let k = 0; k < 3; k++) {
                const tAdv0 = performance.now();
                window.FILM.seek(0, sp);
                advTimes.push(performance.now() - tAdv0);
              }
            }
            advTimes.sort((a, b) => a - b);
            const advP50Ms = Math.round(advTimes[advTimes.length >> 1] * 100) / 100;

            const tBm0 = performance.now();
            window.FILM.seek(f, sp);
            const bm = await createImageBitmap(c);
            bm.close();
            const domDrawPlusBitmapMs = Math.round((performance.now() - tBm0) * 100) / 100;

            return {
              coldSeekMs,
              warmSameMs,
              advP50Ms,
              domDrawPlusBitmapMs,
              stats
            };
          },
          { f: activeFrame, sc: scale, sp: spec, totalF: nativeFrames }
        );
        await page.close();
        return m;
      };

      const full = await measureStyleMode("full");
      const d75k = await measureStyleMode({ mode: "draft", draftTargetVerticesPerFrame: 75000 });
      const d6k = await measureStyleMode({ mode: "draft", draftTargetVerticesPerFrame: 6000 });

      results.push({
        styleId,
        look,
        file: info.file,
        nativeFrames,
        activeFrame,
        aspect,
        previewResolution: aspect === "1:1" ? "480x480" : "640x360",
        full,
        d75k,
        d6k
      });
      console.log(
        `  ✔ ${styleId.padEnd(16)} (f=${activeFrame}/${nativeFrames}): Full(cold=${full.coldSeekMs}ms, advP50=${full.advP50Ms}ms, verts=${full.stats.totalSceneVertices}) -> 75k(cold=${d75k.coldSeekMs}ms, advP50=${d75k.advP50Ms}ms, verts=${d75k.stats.totalSceneVertices}, opt=${d75k.stats.effectiveOptimization})`
      );
    }

    writeFileSync(
      join(BENCH_DIR, "all-31-active-frame-audit.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), totalStyles: results.length, styles: results }, null, 2)
    );
  } finally {
    await browser.close();
  }
});
