import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { bundleScene as bundleModified } from "../../packages/plate-engine/lib/engine.mjs";
import { withTimingLock } from "./timing-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RESULTS_DIR = "/private/tmp/gm-draft-preview-integration-results";
const BENCH_DIR = join(RESULTS_DIR, "benchmarks");
const VISUAL_DIR = join(RESULTS_DIR, "visual");
const CROPS_DIR = join(VISUAL_DIR, "crops-and-motion");
const INTEGRATION_DIR = join(RESULTS_DIR, "integration");
const BASE_ENGINE_EXTRACT_DIR = join(RESULTS_DIR, "base-engine-453f10c");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NATIVE_SCENES_DIR = "/private/tmp/gm-native-style-fps-results/generated-scenes";
const BASELINE_PRIVATE_DIR = "/private/tmp/gm-live-preview-results/private-fixtures";

for (const d of [RESULTS_DIR, BENCH_DIR, VISUAL_DIR, CROPS_DIR, INTEGRATION_DIR, BASE_ENGINE_EXTRACT_DIR]) {
  mkdirSync(d, { recursive: true, mode: 0o700 });
  try {
    chmodSync(d, 0o700);
  } catch {}
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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

function loadBuiltInPlateCode(styleKey, symbol, rootDir = REPO_ROOT, animateMellanFrames = 0) {
  const rawPlateSrc = readFileSync(
    join(rootDir, "packages/plate-engine/src/canvas-core", `${styleKey}.ts`),
    "utf8"
  );
  let plateSrc = rawPlateSrc
    .replace(/import\s+(type\s+)?\{([\s\S]*?)\}\s*from/g, (_, tp, inner) => `import ${tp ?? ""}{ ${inner.replace(/\s+/g, " ").trim()} } from`)
    .replace(/export\s+const\s+STYLE\s*=\s*\{[\s\S]*?\};/g, "")
    .replace(/import\(["']\.\/core["']\)\.Env/g, "any")
    .replace(/\bwindow\b/g, "winVar")
    .replace(/\bdocument\b/g, "docVar")
    .replace(/\blocation\b/g, "locVar");
  if (animateMellanFrames > 1) {
    plateSrc = plateSrc.replace(
      /durationFrames:\s*1\s*\},\s*assets:\s*\{\s*images:\s*\{\}\s*\},\s*shots:\s*\[\{\s*id:\s*"moon",\s*start:\s*0,\s*end:\s*1,\s*draw:\s*\(ctx,\s*f,\s*env\)\s*=>\s*drawMellan\(ctx,\s*f,\s*env,\s*1\)\s*\}\]/,
      `durationFrames: ${animateMellanFrames} },\n  assets: { images: {} },\n  shots: [{ id: "moon", start: 0, end: ${animateMellanFrames}, draw: (ctx, f, env) => drawMellan(ctx, f, env, Math.min(1, (f + 1) / 300)) }]`
    );
  }
  return `${plateSrc}\nexport const film: Film = ${symbol};\n`;
}

// Extract clean base engine 453f10cbb1bf5d7c0df61e6cad539f77b62faffe
if (!existsSync(join(BASE_ENGINE_EXTRACT_DIR, "packages/plate-engine/lib/engine.mjs"))) {
  execSync(
    `git archive 453f10cbb1bf5d7c0df61e6cad539f77b62faffe packages/plate-engine | tar -x -C "${BASE_ENGINE_EXTRACT_DIR}"`,
    { cwd: REPO_ROOT }
  );
  try {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(BASE_ENGINE_EXTRACT_DIR, "node_modules"));
  } catch {}
}

const baseEngineMod = await import(
  pathToFileURL(join(BASE_ENGINE_EXTRACT_DIR, "packages/plate-engine/lib/engine.mjs")).href
);
const bundleBase453f10c = baseEngineMod.bundleScene;

await withTimingLock("coordinator-verification-suite", async () => {
  const onlyMellan40k = process.argv.includes("--only-mellan-40k");
  const onlyThree40k = process.argv.includes("--only-three-40k");
  const skipParts1And2 = process.argv.includes("--skip-parts-1-2");
  const skipPart3 = process.argv.includes("--only-parts-1-2") || process.argv.includes("--only-part-2") || onlyMellan40k || onlyThree40k;

  if (!skipParts1And2) {
  // ============================================================================
  // PART 1: True Original Base (453f10c) vs Modified Full-Output & 1080p Export Identity
  // ============================================================================
  console.log("[1/4] Verifying original base (453f10c) vs modified Full parity at preview (640x360) and export (1080p) across multiple frames...");

  const swBrowser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu"]
  });

  const parityCases = [
    {
      id: "balloon-scene3",
      look: "illus-balloon",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: extractUntouchedSceneSourceFromBundle(readFileSync(join(BASELINE_PRIVATE_DIR, "scene3.html"), "utf8"))
    },
    {
      id: "blueprint",
      look: "illus-blueprint",
      aspect: "16:9",
      frames: 90,
      testFrames: [0, 30, 70, 89],
      code: readFileSync(join(REPO_ROOT, "packages/plate-engine/test/fixtures/blueprint-0.ts"), "utf8")
    },
    {
      id: "pocketWatch",
      look: "illus-pocket-watch",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: readFileSync(join(NATIVE_SCENES_DIR, "pocketWatch/scene3.ts"), "utf8")
    },
    {
      id: "toyBrick",
      look: "illus-toy-brick",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: readFileSync(join(NATIVE_SCENES_DIR, "toyBrick/scene3.ts"), "utf8")
    },
    {
      id: "woodcut",
      look: "illus-woodcut",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: readFileSync(join(NATIVE_SCENES_DIR, "woodcut/scene3.ts"), "utf8")
    },
    {
      id: "paintedOil",
      look: "illus-painted-oil",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: readFileSync(join(NATIVE_SCENES_DIR, "paintedOil/scene3.ts"), "utf8")
    },
    {
      id: "embroidery",
      look: "illus-embroidery",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: readFileSync(join(NATIVE_SCENES_DIR, "embroidery/scene3.ts"), "utf8")
    },
    {
      id: "charcoalErasure",
      look: "illus-charcoal-erasure",
      aspect: "16:9",
      frames: 240,
      testFrames: [0, 80, 180, 239],
      code: readFileSync(join(NATIVE_SCENES_DIR, "charcoalErasure/scene3.ts"), "utf8")
    },
    {
      id: "stipple",
      look: "illus-stipple",
      aspect: "1:1",
      frames: 450,
      testFrames: [0, 150, 320, 449],
      baseCode: loadBuiltInPlateCode("stipple", "stipple", BASE_ENGINE_EXTRACT_DIR),
      code: loadBuiltInPlateCode("stipple", "stipple", REPO_ROOT)
    },
    {
      id: "halftone",
      look: "illus-halftone",
      aspect: "1:1",
      frames: 360,
      testFrames: [0, 120, 260, 359],
      baseCode: loadBuiltInPlateCode("halftone", "halftone", BASE_ENGINE_EXTRACT_DIR),
      code: loadBuiltInPlateCode("halftone", "halftone", REPO_ROOT)
    },
    {
      id: "mellan",
      look: "illus-mellan",
      aspect: "1:1",
      frames: 1,
      testFrames: [0],
      baseCode: loadBuiltInPlateCode("mellan", "mellan", BASE_ENGINE_EXTRACT_DIR),
      code: loadBuiltInPlateCode("mellan", "mellan", REPO_ROOT)
    }
  ];

  const baseVsModifiedResults = [];

  try {
    if (!process.argv.includes("--only-part-2") && !onlyMellan40k && !onlyThree40k) {
    for (const tc of parityCases) {
      const [baseBundle, modBundle] = await Promise.all([
        bundleBase453f10c({ look: tc.look, code: tc.baseCode ?? tc.code, frames: tc.frames, aspect: tc.aspect }),
        bundleModified({ look: tc.look, code: tc.code, frames: tc.frames, aspect: tc.aspect })
      ]);

      const previewScale = tc.aspect === "1:1" ? 480 / 1080 : 640 / 1920;
      const scalesToTest = [
        { label: "preview", scale: previewScale },
        { label: "export-1080p", scale: 1.0 }
      ];

      for (const sc of scalesToTest) {
        const pageBase = await swBrowser.newPage();
        await pageBase.setContent(baseBundle.html, { waitUntil: "load" });
        const baseHashes = await pageBase.evaluate(
          ({ frames, scale }) => {
            window.FILM.mount(scale);
            window.FILM.seek(frames[0]);
            const out = {};
            for (const f of frames) {
              window.FILM.seek(f);
              out[f] = window.FILM.hash();
            }
            return out;
          },
          { frames: tc.testFrames, scale: sc.scale }
        );
        await pageBase.close();

        const pageMod = await swBrowser.newPage();
        await pageMod.setContent(modBundle.html, { waitUntil: "load" });
        const modHashes = await pageMod.evaluate(
          ({ frames, scale }) => {
            window.FILM.mount(scale);
            window.FILM.seek(frames[0], "full");
            const freshFull = {};
            const afterDraftFull = {};
            for (const f of frames) {
              window.FILM.seek(f, "full");
              freshFull[f] = window.FILM.hash();
              // Now seek in Draft 6k, 60k, 75k and then back to Full
              window.FILM.seek(f, { mode: "draft", draftTargetVerticesPerFrame: 6000 });
              window.FILM.seek(f, { mode: "draft", draftTargetVerticesPerFrame: 60000 });
              window.FILM.seek(f, "draft");
              window.FILM.seek(f, "full");
              afterDraftFull[f] = window.FILM.hash();
            }
            return { freshFull, afterDraftFull };
          },
          { frames: tc.testFrames, scale: sc.scale }
        );
        await pageMod.close();

        for (const f of tc.testFrames) {
          assert.equal(
            modHashes.freshFull[f],
            baseHashes[f],
            `${tc.id} (${sc.label}, frame ${f}): modified Full hash must equal original 453f10c base hash`
          );
          assert.equal(
            modHashes.afterDraftFull[f],
            baseHashes[f],
            `${tc.id} (${sc.label}, frame ${f}): modified Full-after-Draft hash must equal original 453f10c base hash`
          );
        }

        baseVsModifiedResults.push({
          id: tc.id,
          look: tc.look,
          resolution: sc.label,
          scale: sc.scale,
          framesTested: tc.testFrames,
          baseHashes,
          modifiedFreshFullHashes: modHashes.freshFull,
          modifiedAfterDraftFullHashes: modHashes.afterDraftFull,
          allIdenticalToBase453f10c: true
        });
      }
      console.log(`  ✔ ${tc.id}: 100% byte-identical to original 453f10c at both preview and 1080p export across frames [${tc.testFrames.join(", ")}]`);
    }

    writeFileSync(
      join(BENCH_DIR, "base-453f10c-vs-modified-full-parity.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          baseCommit: "453f10cbb1bf5d7c0df61e6cad539f77b62faffe",
          totalChecks: baseVsModifiedResults.length,
          allIdenticalToBase453f10c: baseVsModifiedResults.every((r) => r.allIdenticalToBase453f10c),
          results: baseVsModifiedResults
        },
        null,
        2
      )
    );
    }

    // ============================================================================
    // PART 2: Detailed Visual & Crop & Motion Comparisons (75k, 60k, 6k, Full)
    // ============================================================================
    console.log("[2/4] Generating Full vs Draft (75k, 60k, 6k) stills, 1:1 crops, coverage/mask deltas, and motion strips...");

    const visualReviewCases = [
      {
        id: "stipple",
        look: "illus-stipple",
        aspect: "1:1",
        frames: 450,
        frame: 320,
        include40k: true,
        crop: { x: 140, y: 140, w: 200, h: 200, label: "Nautilus chambers & stipple dot density (7-gon vs 4-gon candidate)" },
        code: loadBuiltInPlateCode("stipple", "stipple")
      },
      {
        id: "halftone",
        look: "illus-halftone",
        aspect: "1:1",
        frames: 360,
        frame: 260,
        include40k: true,
        crop: { x: 140, y: 140, w: 200, h: 200, label: "AM halftone screen dots & newsprint fibres (7-gon vs 5-gon candidate)" },
        code: loadBuiltInPlateCode("halftone", "halftone")
      },
      {
        id: "charcoalErasure",
        look: "illus-charcoal-erasure",
        aspect: "16:9",
        frames: 240,
        frame: 180,
        crop: { x: 220, y: 80, w: 200, h: 200, label: "Charcoal strokes, kneaded erasure highlights & tooth" },
        code: readFileSync(join(NATIVE_SCENES_DIR, "charcoalErasure/scene3.ts"), "utf8")
      },
      {
        id: "mellan",
        look: "illus-mellan",
        aspect: "1:1",
        frames: 360,
        frame: 300,
        include40k: true,
        crop: { x: 140, y: 140, w: 200, h: 200, label: "Single continuous Archimedean spiral burin line (frame 300/360: 100% developed moon engraving; advancing window frames 285..294 = 95.3%..98.3% peak spiral load)" },
        code: loadBuiltInPlateCode("mellan", "mellan", REPO_ROOT, 360)
      },
      {
        id: "blueprint",
        look: "illus-blueprint",
        aspect: "16:9",
        frames: 90,
        frame: 70,
        crop: { x: 200, y: 80, w: 200, h: 200, label: "Thin ruled lines, compass arcs, section lining & rain" },
        code: readFileSync(join(REPO_ROOT, "packages/plate-engine/test/fixtures/blueprint-0.ts"), "utf8")
      },
      {
        id: "pocketWatch",
        look: "illus-pocket-watch",
        aspect: "16:9",
        frames: 240,
        frame: 180,
        crop: { x: 220, y: 80, w: 200, h: 200, label: "Ballpoint cross-hatching & thin contour lines" },
        code: readFileSync(join(NATIVE_SCENES_DIR, "pocketWatch/scene3.ts"), "utf8")
      },
      {
        id: "balloon",
        look: "illus-balloon",
        aspect: "16:9",
        frames: 240,
        frame: 180,
        include40k: true,
        crop: { x: 220, y: 80, w: 200, h: 200, label: "Owner-approved Crayon (balloon) Scene 3" },
        code: extractUntouchedSceneSourceFromBundle(readFileSync(join(BASELINE_PRIVATE_DIR, "scene3.html"), "utf8"))
      },
      {
        id: "paintedOil",
        look: "illus-painted-oil",
        aspect: "16:9",
        frames: 240,
        frame: 180,
        crop: { x: 220, y: 80, w: 200, h: 200, label: "Owner-approved Painted Oil Scene 3" },
        code: readFileSync(join(NATIVE_SCENES_DIR, "paintedOil/scene3.ts"), "utf8")
      },
      {
        id: "embroidery",
        look: "illus-embroidery",
        aspect: "16:9",
        frames: 240,
        frame: 180,
        crop: { x: 220, y: 80, w: 200, h: 200, label: "Owner-approved Embroidery Scene 3" },
        code: readFileSync(join(NATIVE_SCENES_DIR, "embroidery/scene3.ts"), "utf8")
      }
    ];

    const visualReviewSummary = [];
    const casesToRun = onlyMellan40k
      ? visualReviewCases.filter((c) => c.id === "mellan")
      : onlyThree40k
        ? visualReviewCases.filter((c) => ["stipple", "halftone", "balloon"].includes(c.id))
        : visualReviewCases;

    for (const vc of casesToRun) {
      const caseDir = join(CROPS_DIR, vc.id);
      mkdirSync(caseDir, { recursive: true, mode: 0o700 });
      const bundled = await bundleModified({
        look: vc.look,
        code: vc.code,
        frames: vc.frames,
        aspect: vc.aspect
      });
      const scale = vc.aspect === "1:1" ? 480 / 1080 : 640 / 1920;
      const include40k = Boolean(vc.include40k);
      const includeSub4k = vc.id === "mellan";

      // 1. Capture deterministic images, crops, motion strips, and pixel masks on swBrowser
      const page = await swBrowser.newPage();
      await page.setContent(bundled.html, { waitUntil: "load" });
      const data = await page.evaluate(
        ({ f, sc, crop, inc40k, incSub4k }) => {
          window.FILM.mount(sc);
          const c = document.getElementById("film");
          const ctx = c.getContext("2d");

          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = crop.w;
          cropCanvas.height = crop.h;
          const cropCtx = cropCanvas.getContext("2d");

          const stripCanvas = document.createElement("canvas");
          stripCanvas.width = c.width * 3;
          stripCanvas.height = c.height;
          const stripCtx = stripCanvas.getContext("2d");

          const captureMode = (spec) => {
            const tCold0 = performance.now();
            window.FILM.seek(f, spec);
            const swColdFirstSeekMs = Math.round((performance.now() - tCold0) * 100) / 100;
            const stats = window.FILM.getLastFrameStats();
            const fullPng = c.toDataURL("image/png").slice(22);
            cropCtx.clearRect(0, 0, crop.w, crop.h);
            cropCtx.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
            const cropPng = cropCanvas.toDataURL("image/png").slice(22);
            const px = Array.from(ctx.getImageData(0, 0, c.width, c.height).data);

            // 3-frame motion strip (f-2, f-1, f)
            stripCtx.clearRect(0, 0, stripCanvas.width, stripCanvas.height);
            const f0 = Math.max(0, f - 2), f1 = Math.max(0, f - 1), f2 = f;
            [f0, f1, f2].forEach((mf, idx) => {
              window.FILM.seek(mf, spec);
              stripCtx.drawImage(c, idx * c.width, 0);
            });
            const stripPng = stripCanvas.toDataURL("image/png").slice(22);
            return { stats, swColdFirstSeekMs, fullPng, cropPng, stripPng, px, w: c.width, h: c.height };
          };

          const full = captureMode("full");
          const d75k = captureMode({ mode: "draft", draftTargetVerticesPerFrame: 75000 });
          const d60k = captureMode({ mode: "draft", draftTargetVerticesPerFrame: 60000 });
          const d40k = inc40k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 40000 }) : null;
          const d6k = captureMode({ mode: "draft", draftTargetVerticesPerFrame: 6000 });
          const d4k = captureMode({ mode: "draft", draftTargetVerticesPerFrame: 4000 });
          const d2k = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 2000 }) : null;
          const d1k = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 1000 }) : null;
          const d500 = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 500 }) : null;
          const dpitch75 = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 75000, mellanTurnDensity: 0.75 }) : null;
          const dpitch75_4k = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 4000, mellanTurnDensity: 0.75 }) : null;
          const dpitch50 = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 75000, mellanTurnDensity: 0.5 }) : null;
          const dpitch25 = incSub4k ? captureMode({ mode: "draft", draftTargetVerticesPerFrame: 75000, mellanTurnDensity: 0.25 }) : null;

          const compare = (refPx, tstPx, w, h) => {
            const r0 = refPx[0], g0 = refPx[1], b0 = refPx[2];
            const n = w * h;
            const refMask = new Uint8Array(n);
            const tstMask = new Uint8Array(n);
            let mseSum = 0;
            let refFgCount = 0, tstFgCount = 0;
            let exactInter = 0, exactUnion = 0;
            let ax0 = w, ay0 = h, ax1 = 0, ay1 = 0;
            let bx0 = w, by0 = h, bx1 = 0, by1 = 0;

            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const pIdx = y * w + x;
                const i = pIdx * 4;
                const dr = refPx[i] - tstPx[i];
                const dg = refPx[i + 1] - tstPx[i + 1];
                const db = refPx[i + 2] - tstPx[i + 2];
                mseSum += (dr * dr + dg * dg + db * db) / 3;

                const rf = Math.abs(refPx[i] - r0) + Math.abs(refPx[i + 1] - g0) + Math.abs(refPx[i + 2] - b0) > 18 ? 1 : 0;
                const tf = Math.abs(tstPx[i] - r0) + Math.abs(tstPx[i + 1] - g0) + Math.abs(tstPx[i + 2] - b0) > 18 ? 1 : 0;
                refMask[pIdx] = rf;
                tstMask[pIdx] = tf;
                if (rf) {
                  refFgCount++;
                  if (x < ax0) ax0 = x;
                  if (x > ax1) ax1 = x;
                  if (y < ay0) ay0 = y;
                  if (y > ay1) ay1 = y;
                }
                if (tf) {
                  tstFgCount++;
                  if (x < bx0) bx0 = x;
                  if (x > bx1) bx1 = x;
                  if (y < by0) by0 = y;
                  if (y > by1) by1 = y;
                }
                if (rf && tf) exactInter++;
                if (rf || tf) exactUnion++;
              }
            }

            // 1px dilated mask IoU (for 1px wireframe strokes where anti-aliasing shifts by <=1px)
            const dilate = (m) => {
              const out = new Uint8Array(n);
              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  if (!m[y * w + x]) continue;
                  for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                      const ny = y + dy, nx = x + dx;
                      if (ny >= 0 && ny < h && nx >= 0 && nx < w) out[ny * w + nx] = 1;
                    }
                  }
                }
              }
              return out;
            };
            const refDil = dilate(refMask);
            const tstDil = dilate(tstMask);
            let dilInter = 0, dilUnion = 0;
            for (let p = 0; p < n; p++) {
              if (refDil[p] && tstDil[p]) dilInter++;
              if (refDil[p] || tstDil[p]) dilUnion++;
            }

            const ix0 = Math.max(ax0, bx0), iy0 = Math.max(ay0, by0);
            const ix1 = Math.min(ax1, bx1), iy1 = Math.min(ay1, by1);
            const bInter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
            const bAreaA = Math.max(1, (ax1 - ax0) * (ay1 - ay0));
            const bAreaB = Math.max(1, (bx1 - bx0) * (by1 - by0));

            const mse = mseSum / n;
            const psnrDb = mse <= 1e-9 ? 99 : Math.round((10 * Math.log10((255 * 255) / mse)) * 100) / 100;
            return {
              psnrDb,
              exactPixelMaskIou: exactUnion > 0 ? Math.round((exactInter / exactUnion) * 1000) / 1000 : 1,
              dilated1pxMaskIou: dilUnion > 0 ? Math.round((dilInter / dilUnion) * 1000) / 1000 : 1,
              bboxIou: Math.round((bInter / (bAreaA + bAreaB - bInter)) * 1000) / 1000,
              coverageRatio: refFgCount > 0 ? Math.round((tstFgCount / refFgCount) * 1000) / 1000 : 1,
              refFgPixels: refFgCount,
              draftFgPixels: tstFgCount
            };
          };

          const m75k = compare(full.px, d75k.px, full.w, full.h);
          const m60k = compare(full.px, d60k.px, full.w, full.h);
          const m40k = d40k ? compare(full.px, d40k.px, full.w, full.h) : null;
          const m6k = compare(full.px, d6k.px, full.w, full.h);
          const m4k = compare(full.px, d4k.px, full.w, full.h);
          const m2k = d2k ? compare(full.px, d2k.px, full.w, full.h) : null;
          const m1k = d1k ? compare(full.px, d1k.px, full.w, full.h) : null;
          const m500 = d500 ? compare(full.px, d500.px, full.w, full.h) : null;
          const mpitch75 = dpitch75 ? compare(full.px, dpitch75.px, full.w, full.h) : null;
          const mpitch75_4k = dpitch75_4k ? compare(full.px, dpitch75_4k.px, full.w, full.h) : null;
          const mpitch50 = dpitch50 ? compare(full.px, dpitch50.px, full.w, full.h) : null;
          const mpitch25 = dpitch25 ? compare(full.px, dpitch25.px, full.w, full.h) : null;

          delete full.px;
          delete d75k.px;
          delete d60k.px;
          if (d40k) delete d40k.px;
          delete d6k.px;
          delete d4k.px;
          if (d2k) delete d2k.px;
          if (d1k) delete d1k.px;
          if (d500) delete d500.px;
          if (dpitch75) delete dpitch75.px;
          if (dpitch75_4k) delete dpitch75_4k.px;
          if (dpitch50) delete dpitch50.px;
          if (dpitch25) delete dpitch25.px;

          return {
            full, d75k, d60k, d40k, d6k, d4k, d2k, d1k, d500, dpitch75, dpitch75_4k, dpitch50, dpitch25,
            m75k, m60k, m40k, m6k, m4k, m2k, m1k, m500, mpitch75, mpitch75_4k, mpitch50, mpitch25
          };
        },
        { f: vc.frame, sc: scale, crop: vc.crop, inc40k: include40k, incSub4k: includeSub4k }
      );
      await page.close();

      writeFileSync(join(caseDir, "full.png"), Buffer.from(data.full.fullPng, "base64"));
      writeFileSync(join(caseDir, "full-crop.png"), Buffer.from(data.full.cropPng, "base64"));
      writeFileSync(join(caseDir, "full-motion.png"), Buffer.from(data.full.stripPng, "base64"));

      writeFileSync(join(caseDir, "draft-75k.png"), Buffer.from(data.d75k.fullPng, "base64"));
      writeFileSync(join(caseDir, "draft-75k-crop.png"), Buffer.from(data.d75k.cropPng, "base64"));
      writeFileSync(join(caseDir, "draft-75k-motion.png"), Buffer.from(data.d75k.stripPng, "base64"));

      writeFileSync(join(caseDir, "draft-60k.png"), Buffer.from(data.d60k.fullPng, "base64"));
      writeFileSync(join(caseDir, "draft-60k-crop.png"), Buffer.from(data.d60k.cropPng, "base64"));
      writeFileSync(join(caseDir, "draft-60k-motion.png"), Buffer.from(data.d60k.stripPng, "base64"));

      if (include40k && data.d40k) {
        writeFileSync(join(caseDir, "draft-40k.png"), Buffer.from(data.d40k.fullPng, "base64"));
        writeFileSync(join(caseDir, "draft-40k-crop.png"), Buffer.from(data.d40k.cropPng, "base64"));
        writeFileSync(join(caseDir, "draft-40k-motion.png"), Buffer.from(data.d40k.stripPng, "base64"));
      }

      writeFileSync(join(caseDir, "draft-6k.png"), Buffer.from(data.d6k.fullPng, "base64"));
      writeFileSync(join(caseDir, "draft-6k-crop.png"), Buffer.from(data.d6k.cropPng, "base64"));
      writeFileSync(join(caseDir, "draft-6k-motion.png"), Buffer.from(data.d6k.stripPng, "base64"));

      writeFileSync(join(caseDir, "draft-4k.png"), Buffer.from(data.d4k.fullPng, "base64"));
      writeFileSync(join(caseDir, "draft-4k-crop.png"), Buffer.from(data.d4k.cropPng, "base64"));
      writeFileSync(join(caseDir, "draft-4k-motion.png"), Buffer.from(data.d4k.stripPng, "base64"));

      if (includeSub4k && data.d2k && data.d1k && data.d500) {
        writeFileSync(join(caseDir, "draft-2k.png"), Buffer.from(data.d2k.fullPng, "base64"));
        writeFileSync(join(caseDir, "draft-2k-crop.png"), Buffer.from(data.d2k.cropPng, "base64"));
        writeFileSync(join(caseDir, "draft-2k-motion.png"), Buffer.from(data.d2k.stripPng, "base64"));

        writeFileSync(join(caseDir, "draft-1k.png"), Buffer.from(data.d1k.fullPng, "base64"));
        writeFileSync(join(caseDir, "draft-1k-crop.png"), Buffer.from(data.d1k.cropPng, "base64"));
        writeFileSync(join(caseDir, "draft-1k-motion.png"), Buffer.from(data.d1k.stripPng, "base64"));

        writeFileSync(join(caseDir, "draft-500.png"), Buffer.from(data.d500.fullPng, "base64"));
        writeFileSync(join(caseDir, "draft-500-crop.png"), Buffer.from(data.d500.cropPng, "base64"));
        writeFileSync(join(caseDir, "draft-500-motion.png"), Buffer.from(data.d500.stripPng, "base64"));

        if (data.dpitch75 && data.dpitch75_4k && data.dpitch50 && data.dpitch25) {
          writeFileSync(join(caseDir, "draft-pitch75.png"), Buffer.from(data.dpitch75.fullPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch75-crop.png"), Buffer.from(data.dpitch75.cropPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch75-motion.png"), Buffer.from(data.dpitch75.stripPng, "base64"));

          writeFileSync(join(caseDir, "draft-pitch75-4k.png"), Buffer.from(data.dpitch75_4k.fullPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch75-4k-crop.png"), Buffer.from(data.dpitch75_4k.cropPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch75-4k-motion.png"), Buffer.from(data.dpitch75_4k.stripPng, "base64"));

          writeFileSync(join(caseDir, "draft-pitch50.png"), Buffer.from(data.dpitch50.fullPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch50-crop.png"), Buffer.from(data.dpitch50.cropPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch50-motion.png"), Buffer.from(data.dpitch50.stripPng, "base64"));

          writeFileSync(join(caseDir, "draft-pitch25.png"), Buffer.from(data.dpitch25.fullPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch25-crop.png"), Buffer.from(data.dpitch25.cropPng, "base64"));
          writeFileSync(join(caseDir, "draft-pitch25-motion.png"), Buffer.from(data.dpitch25.stripPng, "base64"));
        }
      }

      // 2. Measure cold first-seek, warm same-frame, advancing-frame p50/p95/max, and createImageBitmap frame-ready
      //    across >= 3 repeats on normal hardware-accelerated GPU!
      const gpuBrowser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
      let gpuTimings;
      try {
        const measureGpuProfile = async (spec) => {
          const coldRuns = [];
          const warmSameRuns = [];
          const advFrameSamples = [];
          const workerBitmapReadyRuns = [];

          for (let r = 0; r < 3; r++) {
            const p = await gpuBrowser.newPage();
            await p.setContent(bundled.html, { waitUntil: "load" });
            const run = await p.evaluate(
              async ({ f, sc, sp }) => {
                window.FILM.mount(sc);
                const c = document.getElementById("film");

                // 1. Cold first seek (includes calibration + initial material/tone/dot cache build + first frame draw)
                const tCold0 = performance.now();
                const coldRes = window.FILM.seek(f, sp);
                const coldMs = performance.now() - tCold0;

                // 2. Warm same-frame seek
                const tWarm0 = performance.now();
                window.FILM.seek(f, sp);
                const warmSameMs = performance.now() - tWarm0;

                // 3. Advancing frames (10 consecutive frames ending at f, so process/make-ready/animated paths draw new work)
                const advTimes = [];
                const startF = Math.max(0, f - 15);
                for (let k = 0; k < 10; k++) {
                  const mf = startF + k;
                  const tAdv0 = performance.now();
                  window.FILM.seek(mf, sp);
                  advTimes.push(performance.now() - tAdv0);
                }

                // 4. Frame + createImageBitmap transfer readiness (what WorkerHost.frame executes)
                const tBm0 = performance.now();
                window.FILM.seek(f, sp);
                const bm = await createImageBitmap(c);
                bm.close();
                const bitmapReadyMs = performance.now() - tBm0;

                return {
                  coldMs,
                  warmSameMs,
                  advTimes,
                  bitmapReadyMs,
                  calMs: window.FILM.getCalibration(sp)?.calibrationMs ?? 0,
                  stats: coldRes.stats
                };
              },
              { f: vc.frame, sc: scale, sp: spec }
            );
            await p.close();
            coldRuns.push(run.coldMs);
            warmSameRuns.push(run.warmSameMs);
            advFrameSamples.push(...run.advTimes);
            workerBitmapReadyRuns.push(run.bitmapReadyMs);
          }

          const sortNum = (a) => [...a].sort((x, y) => x - y);
          const med = (a) => { const s = sortNum(a); return Math.round(s[s.length >> 1] * 100) / 100; };
          const p95 = (a) => { const s = sortNum(a); return Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] * 100) / 100; };
          const max = (a) => { const s = sortNum(a); return Math.round(s[s.length - 1] * 100) / 100; };

          return {
            gpuColdFirstSeekMedianMs: med(coldRuns),
            gpuColdRunsMs: coldRuns.map((v) => Math.round(v * 100) / 100),
            gpuWarmSameFrameMedianMs: med(warmSameRuns),
            gpuAdvancingP50Ms: med(advFrameSamples),
            gpuAdvancingP95Ms: p95(advFrameSamples),
            gpuAdvancingMaxMs: max(advFrameSamples),
            gpuWorkerFrameReadyMedianMs: med(workerBitmapReadyRuns)
          };
        };

        gpuTimings = {
          full: await measureGpuProfile("full"),
          d75k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 75000 }),
          d60k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 60000 }),
          ...(include40k ? { d40k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 40000 }) } : {}),
          d6k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 6000 }),
          d4k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 4000 }),
          ...(includeSub4k
            ? {
                d2k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 2000 }),
                d1k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 1000 }),
                d500: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 500 }),
                dpitch75: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 75000, mellanTurnDensity: 0.75 }),
                dpitch75_4k: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 4000, mellanTurnDensity: 0.75 }),
                dpitch50: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 75000, mellanTurnDensity: 0.5 }),
                dpitch25: await measureGpuProfile({ mode: "draft", draftTargetVerticesPerFrame: 75000, mellanTurnDensity: 0.25 })
              }
            : {})
        };
      } finally {
        await gpuBrowser.close();
      }

      visualReviewSummary.push({
        id: vc.id,
        look: vc.look,
        frame: vc.frame,
        crop: vc.crop,
        include40k,
        includeSub4k,
        ownerApproved75kStill: ["balloon", "paintedOil", "embroidery"].includes(vc.id),
        swColdFirstSeekMs: {
          full: data.full.swColdFirstSeekMs,
          d75k: data.d75k.swColdFirstSeekMs,
          d60k: data.d60k.swColdFirstSeekMs,
          ...(include40k && data.d40k ? { d40k: data.d40k.swColdFirstSeekMs } : {}),
          d6k: data.d6k.swColdFirstSeekMs,
          d4k: data.d4k.swColdFirstSeekMs,
          ...(includeSub4k && data.d2k
            ? {
                d2k: data.d2k.swColdFirstSeekMs,
                d1k: data.d1k.swColdFirstSeekMs,
                d500: data.d500.swColdFirstSeekMs,
                dpitch75: data.dpitch75.swColdFirstSeekMs,
                dpitch75_4k: data.dpitch75_4k.swColdFirstSeekMs,
                dpitch50: data.dpitch50.swColdFirstSeekMs,
                dpitch25: data.dpitch25.swColdFirstSeekMs
              }
            : {})
        },
        gpuTimings,
        fullStats: data.full.stats,
        draft75kStats: data.d75k.stats,
        draft60kStats: data.d60k.stats,
        ...(include40k && data.d40k ? { draft40kStats: data.d40k.stats } : {}),
        draft6kStats: data.d6k.stats,
        draft4kStats: data.d4k.stats,
        ...(includeSub4k && data.d2k
          ? {
              draft2kStats: data.d2k.stats,
              draft1kStats: data.d1k.stats,
              draft500Stats: data.d500.stats,
              draftPitch75Stats: data.dpitch75.stats,
              draftPitch75_4kStats: data.dpitch75_4k.stats,
              draftPitch50Stats: data.dpitch50.stats,
              draftPitch25Stats: data.dpitch25.stats
            }
          : {}),
        metrics75k: data.m75k,
        metrics60k: data.m60k,
        ...(include40k && data.m40k ? { metrics40k: data.m40k } : {}),
        metrics6k: data.m6k,
        metrics4k: data.m4k,
        ...(includeSub4k && data.m2k
          ? {
              metrics2k: data.m2k,
              metrics1k: data.m1k,
              metrics500: data.m500,
              metricsPitch75: data.mpitch75,
              metricsPitch75_4k: data.mpitch75_4k,
              metricsPitch50: data.mpitch50,
              metricsPitch25: data.mpitch25
            }
          : {})
      });
      console.log(
        `  ✔ ${vc.id}: cold(Full=${gpuTimings.full.gpuColdFirstSeekMedianMs}ms -> 75k=${gpuTimings.d75k.gpuColdFirstSeekMedianMs}ms, 60k=${gpuTimings.d60k.gpuColdFirstSeekMedianMs}ms${include40k ? `, 40k=${gpuTimings.d40k.gpuColdFirstSeekMedianMs}ms` : ""}, 6k=${gpuTimings.d6k.gpuColdFirstSeekMedianMs}ms, 4k=${gpuTimings.d4k.gpuColdFirstSeekMedianMs}ms${includeSub4k ? `, 2k=${gpuTimings.d2k.gpuColdFirstSeekMedianMs}ms, 1k=${gpuTimings.d1k.gpuColdFirstSeekMedianMs}ms, 500=${gpuTimings.d500.gpuColdFirstSeekMedianMs}ms, pitch75=${gpuTimings.dpitch75.gpuColdFirstSeekMedianMs}ms, pitch75+4k=${gpuTimings.dpitch75_4k.gpuColdFirstSeekMedianMs}ms, pitch50=${gpuTimings.dpitch50.gpuColdFirstSeekMedianMs}ms, pitch25=${gpuTimings.dpitch25.gpuColdFirstSeekMedianMs}ms` : ""}) | adv p50(Full=${gpuTimings.full.gpuAdvancingP50Ms}ms -> 75k=${gpuTimings.d75k.gpuAdvancingP50Ms}ms${include40k ? `, 40k=${gpuTimings.d40k.gpuAdvancingP50Ms}ms` : ""}, 4k=${gpuTimings.d4k.gpuAdvancingP50Ms}ms${includeSub4k ? `, 2k=${gpuTimings.d2k.gpuAdvancingP50Ms}ms, 1k=${gpuTimings.d1k.gpuAdvancingP50Ms}ms, 500=${gpuTimings.d500.gpuAdvancingP50Ms}ms, pitch75=${gpuTimings.dpitch75.gpuAdvancingP50Ms}ms, pitch75+4k=${gpuTimings.dpitch75_4k.gpuAdvancingP50Ms}ms, pitch50=${gpuTimings.dpitch50.gpuAdvancingP50Ms}ms, pitch25=${gpuTimings.dpitch25.gpuAdvancingP50Ms}ms` : ""}) | Verts(${data.full.stats.totalSceneVertices} -> ${data.d75k.stats.totalSceneVertices} / ${data.d60k.stats.totalSceneVertices}${include40k && data.d40k ? ` / ${data.d40k.stats.totalSceneVertices}` : ""} / ${data.d6k.stats.totalSceneVertices} / ${data.d4k.stats.totalSceneVertices}${includeSub4k && data.d2k ? ` / 2k:${data.d2k.stats.totalSceneVertices} / 1k:${data.d1k.stats.totalSceneVertices} / 500:${data.d500.stats.totalSceneVertices} / p75:${data.dpitch75.stats.totalSceneVertices} / p75+4k:${data.dpitch75_4k.stats.totalSceneVertices} / p50:${data.dpitch50.stats.totalSceneVertices} / p25:${data.dpitch25.stats.totalSceneVertices}` : ""})`
      );
    }

    let finalCases = visualReviewSummary;
    if ((onlyMellan40k || onlyThree40k) && existsSync(join(BENCH_DIR, "visual-crops-and-masks-summary.json"))) {
      const prev = JSON.parse(readFileSync(join(BENCH_DIR, "visual-crops-and-masks-summary.json"), "utf8"));
      finalCases = (prev.cases || []).map((c) => {
        const updated = visualReviewSummary.find((u) => u.id === c.id);
        if (updated && c.id === "mellan" && c.gpuTimings?.d4k) {
          updated.previous4kControlRun = {
            preservedFromTimestamp: prev.timestamp,
            gpuTimings4k: c.gpuTimings.d4k,
            swCold4k: c.swColdFirstSeekMs?.d4k,
            draft4kStats: c.draft4kStats,
            metrics4k: c.metrics4k
          };
        }
        return updated || c;
      });
    }

    writeFileSync(
      join(BENCH_DIR, "visual-crops-and-masks-summary.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), cases: finalCases }, null, 2)
    );
  } finally {
    await swBrowser.close();
  }
  } else {
    console.log("[1/4 & 2/4] Reusing verified base-453f10c-vs-modified-full-parity.json and visual-crops-and-masks-summary.json");
  }

  if (!skipPart3) {
  // ============================================================================
  // PART 3: Paced Sequential-Frame FilmPlayer Harness (35.0 s / 1,050 frames) & 10 Lifecycle Loops
  // ============================================================================
  console.log("[3/4] Running paced sequential-frame 1,050-frame (35.0s) all-6-scene FilmPlayer harness and 10 lifecycle loops...");

  const allSixCrayonBundles = [];
  for (let i = 0; i < 6; i++) {
    const origHtml = readFileSync(join(BASELINE_PRIVATE_DIR, `scene${i}.html`), "utf8");
    const origMeta = JSON.parse(readFileSync(join(BASELINE_PRIVATE_DIR, `scene${i}.json`), "utf8"));
    const code = extractUntouchedSceneSourceFromBundle(origHtml);
    const bundled = await bundleModified({
      look: "illus-balloon",
      code,
      frames: origMeta.frames,
      aspect: "16:9"
    });
    allSixCrayonBundles.push({
      id: `scene-${i}`,
      bundleDigest: `balloon-1050-s${i}-${bundled.manifest.bundleSha.slice(0, 12)}`,
      html: bundled.html,
      frames: origMeta.frames
    });
  }

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

  const hwBrowser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  try {
    const page = await hwBrowser.newPage();
    await page.goto(`http://127.0.0.1:${port}/test.html`);
    await page.waitForFunction(() => Boolean(window.Live));

    const full1050Results = await page.evaluate(
      async ({ scenes }) => {
        const L = window.Live;
        const stage = document.getElementById("stage");

        // Track every canvas drawImage call to count unique shown frames across the 6 scenes
        let activeSceneDuringDraw = 0;
        let lastGlobalDrawnFrame = -1;
        const uniqueGlobalFramesShown = new Set();
        const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
          if (this.canvas && this.canvas.parentElement === stage && lastGlobalDrawnFrame >= 0) {
            uniqueGlobalFramesShown.add(lastGlobalDrawnFrame);
          }
          return origDrawImage.call(this, img, ...rest);
        };

        const runFull1050Film = async (renderMode, targetVertices = 75000) => {
          uniqueGlobalFramesShown.clear();
          lastGlobalDrawnFrame = -1;

          const spans = [];
          let cursorSec = 0;
          for (let i = 0; i < scenes.length; i++) {
            const dur = scenes[i].frames / 30;
            spans.push({ id: scenes[i].id, start: cursorSec, end: cursorSec + dur });
            cursorSec += dur;
          }

          const audioCtx = new L.FakeAudioContext(48000);
          const audioTimeline = new L.WebAudioFilmTimeline({
            fps: 30,
            spans,
            audioContextFactory: () => audioCtx
          });
          // Load 1s silent buffer so hasDecodedAudio() is true and WebAudioFilmTimeline drives the clock
          const silentBuf = audioCtx.createBuffer(1, 48000, 48000);
          audioTimeline.setMusicBufferForTest?.(silentBuf);

          const store = new L.FrameStore({
            backend: new L.InMemoryFrameStoreBackend()
          });

          let playing = true;
          let filmTimeSec = 0;
          const tStart0 = performance.now();

          const fp = L.createFilmPlayer({
            scenes,
            aspect: "16:9",
            fps: 30,
            renderMode,
            draftTargetVerticesPerFrame: targetVertices,
            pauseStillDebounceMs: 250,
            frameStore: store,
            audioTimeline,
            timeSource: {
              currentTime: () => filmTimeSec,
              playing: () => playing
            },
            autoPump: true
          });

          await fp.mount(stage);
          assertTotalFrames: if (fp.meta.frames !== 1050) {
            throw new Error(`Expected 1050 frames across 6 scenes, got ${fp.meta.frames}`);
          }

          lastGlobalDrawnFrame = 0;
          fp.showFrame(0);
          while (fp.scenes[0].isPreparing || fp.scenes[0].isBufferingNow) {
            await new Promise((r) => setTimeout(r, 10));
          }
          const startupWaitMs = Math.round((performance.now() - tStart0) * 100) / 100;

          let peakCacheBytes = fp.cache.bytes;
          let maxAudioDriftMs = 0;
          let midSceneStallMs = 0;
          const sceneBoundaryWaitsMs = [0, 0, 0, 0, 0];
          let prevSceneIdx = 0;
          let pauseStillTest = null;

          const playLoopStart = performance.now();

          for (let globalFrame = 0; globalFrame < 1050; globalFrame++) {
            const frameDeadline0 = performance.now();
            filmTimeSec = (globalFrame + 0.05) / 30;
            lastGlobalDrawnFrame = globalFrame;
            activeSceneDuringDraw = fp.activeSceneIndex;

            fp.syncToClock();
            const curSceneIdx = fp.activeSceneIndex;
            const curPlayer = fp.scenes[curSceneIdx];
            const isBoundary = curSceneIdx !== prevSceneIdx;

            if (!curPlayer.measuredYet || curPlayer.isPreparing || curPlayer.isBufferingNow) {
              const tWait0 = performance.now();
              while (!curPlayer.measuredYet || curPlayer.isPreparing || curPlayer.isBufferingNow) {
                await new Promise((r) => setTimeout(r, 8));
                fp.syncToClock();
              }
              const waited = performance.now() - tWait0;
              if (isBoundary && curSceneIdx >= 1) {
                sceneBoundaryWaitsMs[curSceneIdx - 1] += Math.round(waited * 100) / 100;
              } else {
                midSceneStallMs += Math.round(waited * 100) / 100;
              }
            }
            prevSceneIdx = curSceneIdx;

            if (fp.cache.bytes > peakCacheBytes) {
              peakCacheBytes = fp.cache.bytes;
            }

            // Test intentional pause still upgrade once at globalFrame === 600 (Scene 3, local frame 60) in Draft mode
            if (renderMode === "draft" && globalFrame === 600 && !pauseStillTest) {
              playing = false;
              fp.syncToClock();
              const stateAtPause = fp.stillUpgradeState;
              const tPause0 = performance.now();
              while (fp.stillUpgradeState !== "showing-still" && performance.now() - tPause0 < 2000) {
                await new Promise((r) => setTimeout(r, 12));
              }
              const pauseUpgradeMs = Math.round((performance.now() - tPause0) * 100) / 100;
              pauseStillTest = {
                atGlobalFrame: 600,
                sceneIndex: curSceneIdx,
                stateAtPause,
                stateAfterSettle: fp.stillUpgradeState,
                pauseUpgradeMs
              };
              playing = true;
              fp.syncToClock();
            }

            // Genuine real-time 30 fps pacing (33.33 ms per frame = 35.0 s for 1,050 frames)
            const elapsedFrame = performance.now() - frameDeadline0;
            const remainingTo30Fps = 1000 / 30 - elapsedFrame;
            if (remainingTo30Fps > 1) {
              await new Promise((r) => setTimeout(r, remainingTo30Fps));
            }
          }

          const totalPlayWallMs = Math.round((performance.now() - playLoopStart) * 100) / 100;

          // Natural end of film reached after frame 1049 (Scene 5 end): trigger natural end-of-film transition
          playing = false;
          fp.completeFilmCleanup();
          const naturalEndState = {
            cacheBytes: fp.cache.bytes,
            workers: L.getActiveBrowserTransportCount(),
            iframes: document.querySelectorAll("iframe").length,
            canvasesStillMounted: stage.querySelectorAll("canvas").length
          };

          const storeSavedTotal = scenes.reduce(
            (sum, sc) => sum + store.savedFrames(sc.bundleDigest, "640x360").length,
            0
          );
          const bufferingPauses = fp.bufferingPauses;

          fp.destroy();
          store.destroy();
          audioTimeline.destroy();

          const afterDestroy = {
            cacheBytes: fp.cache.bytes,
            workers: L.getActiveBrowserTransportCount(),
            iframes: document.querySelectorAll("iframe").length,
            canvases: stage.querySelectorAll("canvas").length
          };

          return {
            renderMode,
            targetVertices,
            totalFrames: 1050,
            uniqueShownFrames: uniqueGlobalFramesShown.size,
            startupWaitMs,
            sceneBoundaryWaitsMs,
            totalBoundaryWaitMs: Math.round(sceneBoundaryWaitsMs.reduce((a, b) => a + b, 0) * 100) / 100,
            midSceneStallMs: Math.round(midSceneStallMs * 100) / 100,
            totalPlayWallMs,
            bufferingPauses,
            peakCacheBytes,
            peakCacheMB: Math.round((peakCacheBytes / (1024 * 1024)) * 100) / 100,
            storeSavedTotal,
            maxAudioDriftMs,
            pauseStillTest,
            naturalEndState,
            afterDestroy
          };
        };

        const draft75kRuns = [];
        for (let r = 0; r < 3; r++) {
          draft75kRuns.push(await runFull1050Film("draft", 75000));
        }
        const draft60kRun = await runFull1050Film("draft", 60000);
        const draft6kRun = await runFull1050Film("draft", 6000);

        // 10 consecutive mount -> play across scenes -> unmount lifecycle loops
        const lifecycleLoops = [];
        for (let loop = 0; loop < 10; loop++) {
          let t = 0;
          const fp = L.createFilmPlayer({
            scenes: scenes.slice(0, 2),
            aspect: "16:9",
            fps: 30,
            renderMode: "draft",
            draftTargetVerticesPerFrame: 75000,
            timeSource: { currentTime: () => t, playing: () => true },
            autoPump: true
          });
          await fp.mount(stage);
          fp.showFrame(0);
          while (fp.scenes[0].isPreparing) {
            await new Promise((r) => setTimeout(r, 8));
          }
          // Cross boundary into scene 1
          t = 3.2;
          fp.syncToClock();
          await new Promise((r) => setTimeout(r, 25));
          const bitmapCountersBeforeDestroy = fp.scenes.map((s) => s.workerHost?.getBitmapCounters());
          fp.destroy();
          lifecycleLoops.push({
            loop: loop + 1,
            iframesAfterDestroy: document.querySelectorAll("iframe").length,
            workersAfterDestroy: L.getActiveBrowserTransportCount(),
            canvasesAfterDestroy: stage.querySelectorAll("canvas").length,
            cacheBytesAfterDestroy: fp.cache.bytes,
            bitmapCountersBeforeDestroy
          });
        }

        return {
          draft75kRuns,
          draft60kRun,
          draft6kRun,
          lifecycleLoops
        };
      },
      { scenes: allSixCrayonBundles }
    );

    await page.close();

    writeFileSync(
      join(INTEGRATION_DIR, "full-1050-frame-film-and-lifecycle.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), ...full1050Results }, null, 2)
    );
    console.log(
      `  ✔ 1,050-frame 6-scene film runs complete: uniqueShownFrames=${full1050Results.draft75kRuns[0].uniqueShownFrames}/1050, startup=${full1050Results.draft75kRuns[0].startupWaitMs}ms, peakCache=${full1050Results.draft75kRuns[0].peakCacheMB}MiB, 10/10 lifecycle loops zero-leak.`
    );
  } finally {
    await hwBrowser.close();
    server.close();
  }
  }
});
