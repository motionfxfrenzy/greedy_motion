import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { bundleScene, loadManifest } from "../../packages/plate-engine/lib/engine.mjs";
import { withTimingLock } from "./timing-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RESULTS_DIR = "/private/tmp/gm-draft-preview-integration-results";
const BENCH_DIR = join(RESULTS_DIR, "benchmarks");
const VISUAL_DIR = join(RESULTS_DIR, "visual");
const INTEGRATION_DIR = join(RESULTS_DIR, "integration");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NATIVE_SCENES_DIR = "/private/tmp/gm-native-style-fps-results/generated-scenes";
const BASELINE_PRIVATE_DIR = "/private/tmp/gm-live-preview-results/private-fixtures";

for (const d of [RESULTS_DIR, BENCH_DIR, VISUAL_DIR, INTEGRATION_DIR]) {
  mkdirSync(d, { recursive: true, mode: 0o700 });
  try {
    chmodSync(d, 0o700);
  } catch {}
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function p95(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1);
  return s[idx];
}

function styleToLookId(styleKey) {
  return "illus-" + styleKey.replace(/([A-Z])/g, "-$1").toLowerCase();
}

function extractUntouchedSceneSourceFromBundle(origHtml) {
  const js = [...origHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  const adaptMarker = "globalThis.__ANIDOODLE_ADAPT__=void 0;";
  const adaptIdx = js.indexOf(adaptMarker);
  const before = js.slice(0, adaptIdx);
  const endIdx = js.indexOf("]};var ", adaptIdx) + 3;
  const sceneBody = js.slice(adaptIdx + adaptMarker.length, endIdx);

  const mAdapt = /var ([A-Za-z0-9_$]+)=\(\)=>globalThis\.__ANIDOODLE_ADAPT__,([A-Za-z0-9_$]+)=new WeakMap,([A-Za-z0-9_$]+)=/.exec(before);
  const mRng = /([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+=>\{let [A-Za-z0-9_$]+=[A-Za-z0-9_$]+>>>0;return\(\)=>/.exec(before);
  const mFractal = /([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=]+\)=>\{let [A-Za-z0-9_$]+=0,[A-Za-z0-9_$]+=1/.exec(before);
  const mSample = /([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=!]+?\)=>\{if\([A-Za-z0-9_$]+\.length<2\)return/.exec(before);
  const mGfx = /var ([A-Za-z0-9_$]+)=class\{constructor\(/.exec(before);
  const gfxEnd = before.indexOf("*2),") + before.slice(before.indexOf("*2),")).indexOf("}};") + 3;
  const galleryPart = before.slice(gfxEnd);

  const mClamp = /([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=]+\)=>Math\.max\([A-Za-z0-9_$]+,Math\.min\(/.exec(galleryPart);
  const mLerp = /([A-Za-z0-9_$]+)=\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)=>\2\+\(\3-\2\)\*\4/.exec(galleryPart);
  const mSmooth = /var ([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=!]+?\)=>[A-Za-z0-9_$]+\([A-Za-z0-9_$]+\([A-Za-z0-9_$]+\)/.exec(galleryPart);
  const mMix = /([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,]+\)=>\{let [A-Za-z0-9_$]+=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+\),[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+\);return"#"/.exec(galleryPart);
  const mTrace = /var ([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=!]+?\)=>\{[A-Za-z0-9_$]+\.beginPath\(\)/.exec(galleryPart);
  const mBounds = /return\{x0:[A-Za-z0-9_$]+,y0:[A-Za-z0-9_$]+,x1:[A-Za-z0-9_$]+,y1:[A-Za-z0-9_$]+\}\},([A-Za-z0-9_$]+)=[A-Za-z0-9_$]+,([A-Za-z0-9_$]+)=\(/.exec(galleryPart);
  const mBlob = /var ([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=.]+?\)=>\{let [A-Za-z0-9_$]+=[A-Za-z0-9_$]+\([A-Za-z0-9_$]+\),[A-Za-z0-9_$]+=[A-Za-z0-9_$]+\(\)\*6\.28/.exec(galleryPart);
  const mHatch = /\},([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,=]+?\)=>\{let [A-Za-z0-9_$]+=Math\.cos\(/.exec(galleryPart);
  const mInside = /\},([A-Za-z0-9_$]+)=\([A-Za-z0-9_$,]+\)=>[A-Za-z0-9_$]+\([A-Za-z0-9_$]+\(/.exec(galleryPart);
  const mFilmVar = /,([A-Za-z0-9_$]+)=\{meta:\{title:/.exec(sceneBody);

  const coreImports = [
    `Gfx as ${mGfx[1]}`,
    `rng as ${mRng[1]}`,
    `fractal as ${mFractal[1]}`,
    `sample as ${mSample[1]}`,
    `adaptPts as ${mAdapt[3]}`
  ];
  const galleryImports = [
    mClamp ? `clamp as ${mClamp[1]}` : null,
    mLerp ? `lerp as ${mLerp[1]}` : null,
    mSmooth ? `smooth as ${mSmooth[1]}` : null,
    mMix ? `mix as ${mMix[1]}` : null,
    mTrace ? `trace as ${mTrace[1]}` : null,
    mBounds ? `bounds as ${mBounds[1]}` : null,
    mBounds ? `fillShape as ${mBounds[2]}` : null,
    mBlob ? `blob as ${mBlob[1]}` : null,
    mHatch ? `hatchRuns as ${mHatch[1]}` : null,
    mInside ? `inside as ${mInside[1]}` : null
  ].filter(Boolean);

  return [
    `import { ${coreImports.join(", ")} } from "./core";`,
    `import type { Film } from "./film";`,
    `import { ${galleryImports.join(", ")} } from "./gallery";`,
    sceneBody.replace(`,${mFilmVar[1]}={meta:{title:`, `;export const film: Film = {meta:{title:`)
  ].join("\n");
}

function findExportedFilmSymbol(styleKey) {
  const plateSrc = readFileSync(
    join(REPO_ROOT, "packages/plate-engine/src/canvas-core", `${styleKey}.ts`),
    "utf8"
  );
  const m = /export\s+const\s+([A-Za-z0-9_]+)\s*:\s*Film\b/.exec(plateSrc);
  if (m) return { symbol: m[1], isFilm: true };
  return null;
}

await withTimingLock("draft-preview-integration-suite", async () => {
  console.log("[1/3] Running 31-style manifest verification & 6k/60k/75k budget sweep...");
  const manifest = loadManifest();
  const styleKeys = Object.keys(manifest.styles);
  assert.equal(styleKeys.length, 31);

  const forceAll = process.argv.includes("--force");
  const hasPart1 = !forceAll && existsSync(join(BENCH_DIR, "all-31-styles-verification.json"));
  const hasPart2 = !forceAll && existsSync(join(BENCH_DIR, "multi-scene-style-benchmarks.json"));

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu"]
  });

  const manifestStyleResults = [];
  const styleBenchmarks = [];
  let filmPlayerSummary = null;

  try {
    if (!hasPart1) {
    for (const styleKey of styleKeys) {
      const look = styleToLookId(styleKey);
      let code;
      let frames = 120;
      let aspect = "16:9";

      const nativeScene3 = join(NATIVE_SCENES_DIR, styleKey, "scene3.ts");
      if (existsSync(nativeScene3)) {
        code = readFileSync(nativeScene3, "utf8");
        frames = 240;
        aspect = "16:9";
      } else {
        const exp = findExportedFilmSymbol(styleKey);
        if (exp) {
          const rawPlateSrc = readFileSync(
            join(REPO_ROOT, "packages/plate-engine/src/canvas-core", `${styleKey}.ts`),
            "utf8"
          );
          const plateSrc = rawPlateSrc
            .replace(/import\s+(type\s+)?\{([\s\S]*?)\}\s*from/g, (_, tp, inner) => `import ${tp ?? ""}{ ${inner.replace(/\s+/g, " ").trim()} } from`)
            .replace(/export\s+const\s+STYLE\s*=\s*\{[\s\S]*?\};/g, "")
            .replace(/import\(["']\.\/core["']\)\.Env/g, "any")
            .replace(/\bwindow\b/g, "winVar")
            .replace(/\bdocument\b/g, "docVar")
            .replace(/\blocation\b/g, "locVar");
          const wMatch = /W\s*[:=]\s*(\d+)/.exec(rawPlateSrc);
          const hMatch = /H\s*[:=]\s*(\d+)/.exec(rawPlateSrc);
          const w = wMatch ? Number(wMatch[1]) : 1080;
          const h = hMatch ? Number(hMatch[1]) : 1080;
          aspect = w === h ? "1:1" : w > h ? "16:9" : "9:16";
          const nMatch = /const\s+(?:N|FRAMES)\s*=\s*(\d+)/.exec(rawPlateSrc);
          frames = nMatch ? Number(nMatch[1]) : 120;
          code = `${plateSrc}\nexport const film: Film = ${exp.symbol};\n`;
        } else {
          // storybook exports drawBit helper rather than a Film constant; inline its body with a 120-frame Film
          const rawPlateSrc = readFileSync(
            join(REPO_ROOT, "packages/plate-engine/src/canvas-core", `${styleKey}.ts`),
            "utf8"
          );
          const plateSrc = rawPlateSrc.replace(/export\s+const\s+STYLE\s*=\s*\{[\s\S]*?\};/g, "");
          const nonImportLines = plateSrc.replace(/^import[^\n]*\n/gm, "");
          aspect = "1:1";
          frames = 120;
          code = `import { Env, GRAPHITE, Gfx, P, PENCIL, TINT, arc, heart, line, oval, rng, tube, turn, Ctx } from "./core";\nimport type { Film } from "./film";\n${nonImportLines}\nexport const film: Film = {\n  meta: { title: "Storybook Bit", W: 560, H: 560, fps: 30, bpm: 120, durationFrames: 120 },\n  assets: { images: {} },\n  shots: [{ id: "s", start: 0, end: 120, draw: drawStorybook }]\n};\n`;
        }
      }

      const bundled = await bundleScene({ look, code, frames, aspect });
      const testFrame = Math.min(frames - 1, Math.max(1, Math.floor(frames * 0.72)));
      const scale = aspect === "1:1" ? 480 / 1080 : 640 / 1920;

      // Fresh Full reference page (warm once, then capture reference hash)
      const pageRef = await browser.newPage();
      await pageRef.setContent(bundled.html, { waitUntil: "load" });
      const refHash = await pageRef.evaluate(
        ({ f, sc }) => {
          window.FILM.mount(sc);
          window.FILM.seek(f, "full");
          window.FILM.seek(f, "full");
          return window.FILM.hash();
        },
        { f: testFrame, sc: scale }
      );
      await pageRef.close();

      // Mixed evaluation page: measure Full, Draft 75k, Draft 60k, Draft 6k, and Full-after-Draft
      const page = await browser.newPage();
      await page.setContent(bundled.html, { waitUntil: "load" });
      const evalResult = await page.evaluate(
        ({ f, sc }) => {
          window.FILM.mount(sc);
          const c = document.getElementById("film");
          const ctx = c.getContext("2d");

          const getPixelsAndMetrics = (spec, repeats = 3) => {
            // Warm once so any one-time tile/calibration cache is populated, then time 3 repeats
            window.FILM.seek(f, spec);
            const times = [];
            let res;
            for (let r = 0; r < repeats; r++) {
              res = window.FILM.seek(f, spec);
              times.push(res.stats.totalSeekMs);
            }
            const img = ctx.getImageData(0, 0, c.width, c.height).data;
            return {
              hash: window.FILM.hash(),
              times,
              stats: res.stats,
              calibration: window.FILM.getCalibration(spec),
              pixels: Array.from(img)
            };
          };

          const fullRun = getPixelsAndMetrics("full", 3);
          const d75kRun = getPixelsAndMetrics({ mode: "draft", draftTargetVerticesPerFrame: 75000 }, 3);
          const d60kRun = getPixelsAndMetrics({ mode: "draft", draftTargetVerticesPerFrame: 60000 }, 3);
          const d6kRun = getPixelsAndMetrics({ mode: "draft", draftTargetVerticesPerFrame: 6000 }, 3);
          window.FILM.seek(f, "full");
          const fullAfterDraftHash = window.FILM.hash();

          const compareVisual = (refPx, testPx, w, h) => {
            const r0 = refPx[0], g0 = refPx[1], b0 = refPx[2];
            let mseSum = 0;
            let fgInter = 0, fgUnion = 0;
            let edgeRef = 0, edgeRecallHits = 0;
            const n = w * h;
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const dr = refPx[i] - testPx[i];
                const dg = refPx[i + 1] - testPx[i + 1];
                const db = refPx[i + 2] - testPx[i + 2];
                mseSum += (dr * dr + dg * dg + db * db) / 3;

                const refFg = Math.abs(refPx[i] - r0) + Math.abs(refPx[i + 1] - g0) + Math.abs(refPx[i + 2] - b0) > 18;
                const tstFg = Math.abs(testPx[i] - r0) + Math.abs(testPx[i + 1] - g0) + Math.abs(testPx[i + 2] - b0) > 18;
                if (refFg && tstFg) fgInter++;
                if (refFg || tstFg) fgUnion++;

                if (x + 1 < w && y + 1 < h) {
                  const ir = i + 4, id = i + w * 4;
                  const refGrad =
                    Math.abs(refPx[i] - refPx[ir]) +
                    Math.abs(refPx[i + 1] - refPx[ir + 1]) +
                    Math.abs(refPx[i] - refPx[id]);
                  if (refGrad > 45) {
                    edgeRef++;
                    const tstGrad =
                      Math.abs(testPx[i] - testPx[ir]) +
                      Math.abs(testPx[i + 1] - testPx[ir + 1]) +
                      Math.abs(testPx[i] - testPx[id]);
                    if (tstGrad > 22 || tstFg) edgeRecallHits++;
                  }
                }
              }
            }
            const mse = mseSum / n;
            const psnr = mse <= 1e-9 ? 99 : Math.round((10 * Math.log10((255 * 255) / mse)) * 100) / 100;
            const maskIou = fgUnion > 0 ? Math.round((fgInter / fgUnion) * 1000) / 1000 : 1;
            const edgeRecall = edgeRef > 0 ? Math.round((edgeRecallHits / edgeRef) * 1000) / 1000 : 1;
            return { psnr, maskIou, edgeRecall };
          };

          const vis75k = compareVisual(fullRun.pixels, d75kRun.pixels, c.width, c.height);
          const vis60k = compareVisual(fullRun.pixels, d60kRun.pixels, c.width, c.height);
          const vis6k = compareVisual(fullRun.pixels, d6kRun.pixels, c.width, c.height);

          delete fullRun.pixels;
          delete d75kRun.pixels;
          delete d60kRun.pixels;
          delete d6kRun.pixels;

          return {
            fullAfterDraftHash,
            fullRun,
            d75kRun: { ...d75kRun, visual: vis75k },
            d60kRun: { ...d60kRun, visual: vis60k },
            d6kRun: { ...d6kRun, visual: vis6k }
          };
        },
        { f: testFrame, sc: scale }
      );
      await page.close();

      assert.equal(
        evalResult.fullAfterDraftHash,
        refHash,
        `${styleKey}: Full hash after Draft renders must equal fresh Full reference hash`
      );

      const fullMedMs = Math.round(median(evalResult.fullRun.times) * 100) / 100;
      const d75kMedMs = Math.round(median(evalResult.d75kRun.times) * 100) / 100;
      const d60kMedMs = Math.round(median(evalResult.d60kRun.times) * 100) / 100;
      const d6kMedMs = Math.round(median(evalResult.d6kRun.times) * 100) / 100;

      manifestStyleResults.push({
        style: styleKey,
        look,
        aspect,
        frames,
        testFrame,
        fullIdentityVerified: evalResult.fullAfterDraftHash === refHash,
        fullHash: refHash,
        fullSeekMs: fullMedMs,
        draft75kSeekMs: d75kMedMs,
        draft60kSeekMs: d60kMedMs,
        draft6kSeekMs: d6kMedMs,
        speedup75k: fullMedMs > 0 ? Math.round((fullMedMs / Math.max(0.05, d75kMedMs)) * 100) / 100 : 1,
        fullStats: evalResult.fullRun.stats,
        draft75kStats: evalResult.d75kRun.stats,
        draft60kStats: evalResult.d60kRun.stats,
        draft6kStats: evalResult.d6kRun.stats,
        visual75k: evalResult.d75kRun.visual,
        visual60k: evalResult.d60kRun.visual,
        visual6k: evalResult.d6kRun.visual
      });
    }

    writeFileSync(
      join(BENCH_DIR, "all-31-styles-verification.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          totalStyles: manifestStyleResults.length,
          allFullIdentityVerified: manifestStyleResults.every((r) => r.fullIdentityVerified),
          styles: manifestStyleResults
        },
        null,
        2
      )
    );
    console.log(`  ✔ All ${manifestStyleResults.length}/31 manifest styles verified with zero-diff Full identity.`);
    } else {
      console.log("  ✔ Reusing existing all-31-styles-verification.json");
    }

    // Close software-GL browser and launch hardware-accelerated headless Chromium for timing benchmarks & E2E
    await browser.close();
    const perfBrowser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true
    });

    try {
    // [2/3] Multi-scene 3-repeat benchmark across the 8 benchmark styles (balloon/crayon + 7 native styles)
    console.log("[2/3] Running multi-scene 3-repeat benchmarks & saving visual comparison PNGs...");
    const benchmarkFamilies = [
      {
        style: "balloon",
        look: "illus-balloon",
        loadScenes: () => {
          const out = [];
          for (let i = 0; i < 6; i++) {
            const origHtml = readFileSync(join(BASELINE_PRIVATE_DIR, `scene${i}.html`), "utf8");
            const origMeta = JSON.parse(readFileSync(join(BASELINE_PRIVATE_DIR, `scene${i}.json`), "utf8"));
            out.push({
              sceneIndex: i,
              code: extractUntouchedSceneSourceFromBundle(origHtml),
              frames: origMeta.frames
            });
          }
          return out;
        }
      },
      ...[
        ["pocketWatch", "illus-pocket-watch"],
        ["toyBrick", "illus-toy-brick"],
        ["woodcut", "illus-woodcut"],
        ["paintedOil", "illus-painted-oil"],
        ["embroidery", "illus-embroidery"],
        ["charcoalErasure", "illus-charcoal-erasure"],
        ["moonPhases", "illus-moon-phases"]
      ].map(([style, look]) => ({
        style,
        look,
        loadScenes: () => {
          const out = [];
          for (let i = 0; i < 6; i++) {
            const code = readFileSync(join(NATIVE_SCENES_DIR, style, `scene${i}.ts`), "utf8");
            out.push({ sceneIndex: i, code, frames: 240 });
          }
          return out;
        }
      }))
    ];

    const balloonBundles = [];

    for (const fam of benchmarkFamilies) {
      const scenes = fam.loadScenes();
      const sceneRows = [];
      const styleVisDir = join(VISUAL_DIR, fam.style);
      mkdirSync(styleVisDir, { recursive: true, mode: 0o700 });

      for (const sc of scenes) {
        const bundled = await bundleScene({
          look: fam.look,
          code: sc.code,
          frames: sc.frames,
          aspect: "16:9"
        });
        if (fam.style === "balloon") {
          balloonBundles.push({
            id: `scene-${sc.sceneIndex}`,
            bundleDigest: `balloon-s${sc.sceneIndex}-${bundled.manifest.bundleSha.slice(0, 12)}`,
            html: bundled.html,
            frames: sc.frames
          });
        }
        if (hasPart2) continue;

        const sampleFrames = [
          Math.floor(sc.frames * 0.2),
          Math.floor(sc.frames * 0.5),
          Math.floor(sc.frames * 0.8),
          sc.frames - 1
        ];
        const page = await perfBrowser.newPage();
        await page.setContent(bundled.html, { waitUntil: "load" });

        const metrics = await page.evaluate(
          ({ framesList, savePng }) => {
            window.FILM.mount(640 / 1920);
            const runMode = (spec) => {
              // Cold calibration + first frame
              const tCold0 = performance.now();
              window.FILM.seek(framesList[0], spec);
              const coldFirstMs = performance.now() - tCold0;

              const repeatMedians = [];
              let lastStats = null;
              for (let r = 0; r < 3; r++) {
                const frameTimes = [];
                for (const f of framesList) {
                  const res = window.FILM.seek(f, spec);
                  frameTimes.push(res.stats.totalSeekMs);
                  lastStats = res.stats;
                }
                repeatMedians.push(frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length);
              }
              const png = savePng ? window.FILM.png() : null;
              return {
                coldFirstMs: Math.round(coldFirstMs * 100) / 100,
                repeatMeansMs: repeatMedians.map((v) => Math.round(v * 100) / 100),
                stats: lastStats,
                calibration: window.FILM.getCalibration(spec),
                hash: window.FILM.hash(),
                png
              };
            };

            const full = runMode("full");
            const d75k = runMode({ mode: "draft", draftTargetVerticesPerFrame: 75000 });
            const d60k = runMode({ mode: "draft", draftTargetVerticesPerFrame: 60000 });
            const d6k = runMode({ mode: "draft", draftTargetVerticesPerFrame: 6000 });
            const pauseStill = runMode("full");

            return { full, d75k, d60k, d6k, pauseStill };
          },
          { framesList: sampleFrames, savePng: sc.sceneIndex === 2 }
        );
        await page.close();

        assert.equal(
          metrics.pauseStill.hash,
          metrics.full.hash,
          `${fam.style} scene ${sc.sceneIndex}: pause-still Full hash equals baseline Full hash`
        );

        if (sc.sceneIndex === 2 && metrics.full.png) {
          writeFileSync(join(styleVisDir, "full.png"), Buffer.from(metrics.full.png, "base64"));
          writeFileSync(join(styleVisDir, "draft-75k.png"), Buffer.from(metrics.d75k.png, "base64"));
          writeFileSync(join(styleVisDir, "draft-60k.png"), Buffer.from(metrics.d60k.png, "base64"));
          writeFileSync(join(styleVisDir, "draft-6k.png"), Buffer.from(metrics.d6k.png, "base64"));
          writeFileSync(join(styleVisDir, "pause-still-full.png"), Buffer.from(metrics.pauseStill.png, "base64"));
        }

        const fullMs = Math.round(median(metrics.full.repeatMeansMs) * 100) / 100;
        const d75kMs = Math.round(median(metrics.d75k.repeatMeansMs) * 100) / 100;
        const d60kMs = Math.round(median(metrics.d60k.repeatMeansMs) * 100) / 100;
        const d6kMs = Math.round(median(metrics.d6k.repeatMeansMs) * 100) / 100;

        sceneRows.push({
          sceneIndex: sc.sceneIndex,
          frames: sc.frames,
          fullSeekMs: fullMs,
          draft75kSeekMs: d75kMs,
          draft60kSeekMs: d60kMs,
          draft6kSeekMs: d6kMs,
          speedup75k: fullMs > 0 ? Math.round((fullMs / Math.max(0.05, d75kMs)) * 100) / 100 : 1,
          speedup60k: fullMs > 0 ? Math.round((fullMs / Math.max(0.05, d60kMs)) * 100) / 100 : 1,
          speedup6k: fullMs > 0 ? Math.round((fullMs / Math.max(0.05, d6kMs)) * 100) / 100 : 1,
          fullEffectiveFps: Math.round((1000 / Math.max(0.1, fullMs)) * 10) / 10,
          draft75kEffectiveFps: Math.round((1000 / Math.max(0.1, d75kMs)) * 10) / 10,
          fullVertices: metrics.full.stats.totalSceneVertices,
          draft75kVertices: metrics.d75k.stats.totalSceneVertices,
          draft60kVertices: metrics.d60k.stats.totalSceneVertices,
          draft6kVertices: metrics.d6k.stats.totalSceneVertices,
          fullPenVertices: metrics.full.stats.penRibbonVertices,
          draft75kPenVertices: metrics.d75k.stats.penRibbonVertices,
          draft60kPenVertices: metrics.d60k.stats.penRibbonVertices,
          draft6kPenVertices: metrics.d6k.stats.penRibbonVertices,
          protectedPolygons: metrics.d75k.stats.protectedPolygons,
          protectedVertices: metrics.d75k.stats.protectedVertices,
          kitMaterialOpsReduced: metrics.d75k.stats.kitMaterialOpsReduced,
          floorDegraded6k: metrics.d6k.stats.floorDegraded,
          budgetExceededByFloor6k: metrics.d6k.stats.budgetExceededByFloor,
          effectiveOptimization: metrics.d75k.stats.effectiveOptimization,
          pauseStillMatchesFull: metrics.pauseStill.hash === metrics.full.hash
        });
      }

      if (!hasPart2) {
      const medFull = Math.round(median(sceneRows.map((r) => r.fullSeekMs)) * 100) / 100;
      const med75k = Math.round(median(sceneRows.map((r) => r.draft75kSeekMs)) * 100) / 100;
      const med60k = Math.round(median(sceneRows.map((r) => r.draft60kSeekMs)) * 100) / 100;
      const med6k = Math.round(median(sceneRows.map((r) => r.draft6kSeekMs)) * 100) / 100;
      styleBenchmarks.push({
        style: fam.style,
        look: fam.look,
        sceneCount: sceneRows.length,
        medianFullSeekMs: medFull,
        p95FullSeekMs: Math.round(p95(sceneRows.map((r) => r.fullSeekMs)) * 100) / 100,
        medianDraft75kSeekMs: med75k,
        p95Draft75kSeekMs: Math.round(p95(sceneRows.map((r) => r.draft75kSeekMs)) * 100) / 100,
        medianDraft60kSeekMs: med60k,
        medianDraft6kSeekMs: med6k,
        medianSpeedup75k: medFull > 0 ? Math.round((medFull / Math.max(0.05, med75k)) * 100) / 100 : 1,
        medianFullFps: Math.round((1000 / Math.max(0.1, medFull)) * 10) / 10,
        medianDraft75kFps: Math.round((1000 / Math.max(0.1, med75k)) * 10) / 10,
        scenes: sceneRows
      });
      console.log(
        `  ✔ ${fam.style}: Full p50=${medFull}ms (${Math.round(1000 / Math.max(0.1, medFull))} fps) -> Draft 75k p50=${med75k}ms (${Math.round(1000 / Math.max(0.1, med75k))} fps, ${(medFull / Math.max(0.05, med75k)).toFixed(2)}x)`
      );
      }
    }

    if (!hasPart2) {
      writeFileSync(
        join(BENCH_DIR, "multi-scene-style-benchmarks.json"),
        JSON.stringify({ timestamp: new Date().toISOString(), styles: styleBenchmarks }, null, 2)
      );
    } else {
      console.log("  ✔ Reusing existing multi-scene-style-benchmarks.json");
    }

    // [3/3] End-to-end FilmPlayer 6-scene film playback & pause-still & cleanup benchmark in Chromium
    console.log("[3/3] Running FilmPlayer 6-scene film playback & lifecycle benchmark in Chromium...");
    const compiled = await build({
      entryPoints: [join(REPO_ROOT, "frontend/lib/live/index.ts")],
      bundle: true,
      format: "esm",
      target: "es2022",
      write: false
    });
    const liveModuleJs = compiled.outputFiles[0].text;

    const testHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="stage" style="width:640px;height:360px;position:relative"></div>
<script type="module">
import * as Live from "/live-module.js";
window.Live = Live;
</script>
</body></html>`;

    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname === "/test.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(testHtml);
        return;
      }
      if (u.pathname === "/live-module.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(liveModuleJs);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const page = await perfBrowser.newPage();
      await page.goto(`http://127.0.0.1:${port}/test.html`);
      await page.waitForFunction(() => Boolean(window.Live));

      filmPlayerSummary = await page.evaluate(async ({ scenes }) => {
        const stage = document.getElementById("stage");

        const runFilmBench = async (renderMode, targetVertices = 75000) => {
          let currentTime = 0;
          let playing = true;
          const store = new window.Live.FrameStore({
            backend: new window.Live.InMemoryFrameStoreBackend()
          });

          const tMount0 = performance.now();
          const fp = window.Live.createFilmPlayer({
            scenes: scenes.slice(0, 3), // 3 heavy crayon scenes for fast 3-repeat full-film run
            aspect: "16:9",
            fps: 30,
            renderMode,
            draftTargetVerticesPerFrame: targetVertices,
            pauseStillDebounceMs: 250,
            frameStore: store,
            timeSource: { currentTime: () => currentTime, playing: () => playing },
            autoPump: true
          });

          let readyMs = 0;
          await fp.mount(stage);
          fp.showFrame(0);

          // Wait until scene 0 exits "drawing" (initial buffer ready)
          while (fp.scenes[0].isPreparing) {
            await new Promise((r) => setTimeout(r, 15));
          }
          readyMs = Math.round((performance.now() - tMount0) * 100) / 100;

          let peakCacheBytes = fp.cache.bytes;
          // Advance across frames and test intentional pause -> 250ms full still upgrade
          for (let f = 0; f < 30; f += 5) {
            currentTime = f / 30;
            fp.syncToClock();
            await new Promise((r) => setTimeout(r, 10));
            if (fp.cache.bytes > peakCacheBytes) peakCacheBytes = fp.cache.bytes;
          }

          // Pause intentionally at frame 25 and measure pause-still upgrade
          playing = false;
          fp.syncToClock();
          const stateRightAfterPause = fp.stillUpgradeState;
          const tPause0 = performance.now();
          let upgradedMs = 0;
          if (renderMode === "draft") {
            while (fp.stillUpgradeState !== "showing-still" && performance.now() - tPause0 < 2000) {
              await new Promise((r) => setTimeout(r, 15));
            }
            upgradedMs = Math.round((performance.now() - tPause0) * 100) / 100;
          }
          const stateAfterDebounce = fp.stillUpgradeState;

          const storeSavedScene0 = store.savedFrames(scenes[0].bundleDigest, "640x360").length;

          // Complete film cleanup
          fp.completeFilmCleanup();
          const afterFilmEnd = {
            cacheBytes: fp.cache.bytes,
            workers: window.Live.getActiveBrowserTransportCount(),
            iframes: document.querySelectorAll("iframe").length
          };

          fp.destroy();
          store.destroy();
          const afterDestroy = {
            cacheBytes: fp.cache.bytes,
            workers: window.Live.getActiveBrowserTransportCount(),
            iframes: document.querySelectorAll("iframe").length,
            canvases: stage.querySelectorAll("canvas").length
          };

          return {
            renderMode,
            targetVertices,
            readyMs,
            startFramesNeeded: fp.scenes[0].predrawPlan?.startFrames ?? 0,
            peakCacheBytes,
            peakCacheMB: Math.round((peakCacheBytes / (1024 * 1024)) * 100) / 100,
            storeSavedScene0,
            stateRightAfterPause,
            stateAfterDebounce,
            upgradedMs,
            afterFilmEnd,
            afterDestroy
          };
        };

        const draft75kRuns = [];
        const draft60kRuns = [];
        const draft6kRuns = [];
        const fullRuns = [];

        for (let r = 0; r < 3; r++) {
          draft75kRuns.push(await runFilmBench("draft", 75000));
          draft60kRuns.push(await runFilmBench("draft", 60000));
          draft6kRuns.push(await runFilmBench("draft", 6000));
          fullRuns.push(await runFilmBench("full", 75000));
        }

        return {
          draft75kRuns,
          draft60kRuns,
          draft6kRuns,
          fullRuns
        };
      }, { scenes: balloonBundles });

      await page.close();
    } finally {
      server.close();
    }

    writeFileSync(
      join(INTEGRATION_DIR, "film-player-e2e-summary.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), ...filmPlayerSummary }, null, 2)
    );
    console.log("  ✔ FilmPlayer E2E benchmark & pause-still & cleanup verification complete.");
    } finally {
      await perfBrowser.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
});
