import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { bundleScene } from "../../packages/plate-engine/lib/engine.mjs";
import { FIXTURE_PROJECT } from "../../frontend/test/fixtures/workspace/data.ts";
import { withTimingLock } from "./timing-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const NEXT_DEV_LOCK = join(FRONTEND_DIR, ".next/dev/lock");
const BASELINE_PRIVATE_DIR = "/private/tmp/gm-live-preview-results/private-fixtures";
const NATIVE_SCENES_DIR = "/private/tmp/gm-native-style-fps-results/generated-scenes";
const RESULTS_DIR = "/private/tmp/gm-draft-preview-integration-results";
const INTEGRATION_DIR = join(RESULTS_DIR, "integration");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(INTEGRATION_DIR, { recursive: true, mode: 0o700 });
try {
  chmodSync(INTEGRATION_DIR, 0o700);
} catch {}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/** Generates a valid mono 16-bit PCM WAV buffer of `durationSeconds` at 24000 Hz so real window.AudioContext.decodeAudioData succeeds with exact duration. */
function makeSyntheticWavBuffer(durationSeconds, freqHz = 220) {
  const sampleRate = 24000;
  const numSamples = Math.max(1, Math.round(durationSeconds * sampleRate));
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 1800);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
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

function loadBuiltInPlateCode(styleKey, symbol, animateMellanFrames = 0) {
  const rawPlateSrc = readFileSync(
    join(REPO_ROOT, "packages/plate-engine/src/canvas-core", `${styleKey}.ts`),
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
      `durationFrames: ${animateMellanFrames} },\n  assets: { images: {} },\n  shots: [{ id: "moon", start: 0, end: ${animateMellanFrames}, draw: (ctx, f, env) => drawMellan(ctx, f, env, Math.min(1, 0.35 + 0.65 * ((f + 1) / ${animateMellanFrames}))) }]`
    );
  }
  return `${plateSrc}\nexport const film: Film = ${symbol};\n`;
}

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? rejectPort(err) : resolvePort(port)));
    });
    srv.on("error", rejectPort);
  });
}

async function startNextDevServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(NEXT_DEV_LOCK)) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    const port = await findFreePort();
    const origin = `http://127.0.0.1:${port}`;
    const proc = spawn(
      "npx",
      ["next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
      {
        cwd: FRONTEND_DIR,
        env: {
          ...process.env,
          NEXT_PUBLIC_LIVE_DEV: "1",
          NEXT_PUBLIC_PLATE_LIVE: "1",
          NEXT_PUBLIC_PLATE_DRAFT_PREVIEW: "1",
          NEXT_PUBLIC_DRAFT_TARGET_VERTICES: "75000",
          NEXT_PUBLIC_APP_ENV: "local",
          NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-dev-anon-key"
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      }
    );

    let ready = false;
    while (Date.now() < deadline && proc.exitCode === null) {
      try {
        const res = await fetch(`${origin}/dev/plate-preview-fixture?state=live-c-ready`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 350));
    }
    if (ready) {
      return { proc, origin, port };
    }
    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("Timed out starting Next dev server for real-app playback verification");
}

console.log("[1/4] Bundling 6 crayon scenes (1,050 frames = 35.0s) and 4 heavy-style scenes (halftone, stipple, paintedOil, mellan)...");
const TARGET_PROJECT_ID = "e9ce7b08-759d-4604-a277-a2b9ec8763fc";
const HEAVY_PROJECT_ID = "heavy-styles-project";
const rebundledScenes = [];
const wavByScene = [];

for (let i = 0; i < 6; i++) {
  const origHtml = readFileSync(join(BASELINE_PRIVATE_DIR, `scene${i}.html`), "utf8");
  const origMeta = JSON.parse(readFileSync(join(BASELINE_PRIVATE_DIR, `scene${i}.json`), "utf8"));
  const code = extractUntouchedSceneSourceFromBundle(origHtml);
  const bundled = await bundleScene({
    look: "illus-balloon",
    code,
    frames: origMeta.frames,
    aspect: "16:9"
  });
  const bundleDigest = sha256(
    `${bundled.manifest.bundleSha}|${sha256("{}")}|${bundled.manifest.engineDigest}`
  );
  const seconds = origMeta.frames / 30;
  rebundledScenes.push({
    index: i,
    variantId: `var-real-16x9-${i}`,
    keyword: origMeta.keyword || `Scene ${i + 1}`,
    frames: origMeta.frames,
    seconds,
    sig: `sig-real-${i}`,
    bundleDigest,
    html: bundled.html,
    manifest: bundled.manifest
  });
  wavByScene.push(makeSyntheticWavBuffer(Math.max(0.5, seconds - 0.25), 220 + i * 30));
}

// Bundle 4 heavy styles (halftone, stipple, paintedOil, mellan) for real-UI production watchdog testing
const heavyDefs = [
  {
    id: "halftone",
    look: "illus-halftone",
    aspect: "1:1",
    frames: 420,
    code: loadBuiltInPlateCode("halftone", "halftone").replace("firstSheet: 60", "firstSheet: 0")
  },
  { id: "stipple", look: "illus-stipple", aspect: "1:1", frames: 450, code: loadBuiltInPlateCode("stipple", "stipple") },
  { id: "paintedOil", look: "illus-painted-oil", aspect: "16:9", frames: 240, code: readFileSync(join(NATIVE_SCENES_DIR, "paintedOil/scene3.ts"), "utf8") },
  { id: "mellan", look: "illus-mellan", aspect: "1:1", frames: 90, code: loadBuiltInPlateCode("mellan", "mellan", 90) }
];
const heavyScenes = [];
for (let i = 0; i < heavyDefs.length; i++) {
  const hd = heavyDefs[i];
  const bundled = await bundleScene({
    look: hd.look,
    code: hd.code,
    frames: hd.frames,
    aspect: hd.aspect
  });
  const bundleDigest = sha256(
    `${bundled.manifest.bundleSha}|${sha256("{}")}|${bundled.manifest.engineDigest}`
  );
  heavyScenes.push({
    index: i,
    styleId: hd.id,
    look: hd.look,
    variantId: `var-heavy-${hd.id}`,
    keyword: `Heavy ${hd.id}`,
    frames: hd.frames,
    seconds: hd.frames / 30,
    sig: `sig-heavy-${hd.id}`,
    bundleDigest,
    html: bundled.html,
    manifest: bundled.manifest
  });
}

const allMockVariants = new Map();
for (const s of rebundledScenes) allMockVariants.set(s.variantId, s);
for (const s of heavyScenes) allMockVariants.set(s.variantId, s);

const musicWav = makeSyntheticWavBuffer(36.0, 140);
const sfxWav = makeSyntheticWavBuffer(0.35, 440);

function buildProjectPayload(projId, name, scenesList) {
  const totalSec = scenesList.reduce((a, s) => a + s.seconds, 0);
  return {
    ...FIXTURE_PROJECT,
    id: projId,
    name,
    brief: {
      ...FIXTURE_PROJECT.brief,
      look: "illus-balloon",
      durationSeconds: totalSec,
      aspect: "16:9",
      aspects: ["16:9"],
      scriptBeats: scenesList.map((s) => ({
        keyword: s.keyword,
        visual: s.keyword,
        onScreen: s.keyword,
        line: `Narration for ${s.keyword}.`
      }))
    },
    beatPlan: {
      ...FIXTURE_PROJECT.beatPlan,
      target_duration_s: totalSec,
      beats: scenesList.map((s, i) => ({
        ...FIXTURE_PROJECT.beatPlan.beats[0],
        id: `beat-${i + 1}`,
        keyword: s.keyword,
        on_screen: s.keyword,
        line: `Narration for ${s.keyword}.`,
        success: i === scenesList.length - 1
      }))
    },
    planAudio: {
      voice: {
        engine: "gemini-tts",
        model: "gemini-2.5-flash-preview-tts",
        voice: "Aoede",
        direction: "Warm",
        pace: "calm",
        lines: scenesList.map((s, i) => ({
          beat: `beat-${i + 1}`,
          text: `Narration for ${s.keyword}.`,
          file: `vo/scene-${i + 1}.wav`,
          seconds: Math.max(0.5, s.seconds - 0.25),
          words: [{ text: s.keyword, start: 0.1, end: 0.8 }],
          aligned: "whisper"
        }))
      },
      music: {
        source: "lyria",
        file: "music/bed.wav",
        seconds: totalSec + 1,
        bpm: 84
      }
    }
  };
}

function buildLivePlateStatus(scenesList) {
  return {
    available: true,
    look: "illus-balloon",
    mode: "live",
    running: false,
    drawnAspects: ["16:9"],
    drawingAspects: [],
    comments: [],
    subtitles: {
      mode: "full",
      style: "paper",
      size: 100,
      opacity: 100,
      voice: true,
      music: true,
      sfx: true,
      transitions: false
    },
    scenes: scenesList.map((s) => ({
      index: s.index,
      keyword: s.keyword,
      state: "checked",
      seconds: s.seconds,
      frames: s.frames,
      sig: s.sig,
      rev: 0,
      gen: 1,
      variantId: s.variantId,
      bundleDigest: s.bundleDigest,
      live: true,
      variants: {
        "16:9": {
          state: "checked",
          sig: s.sig,
          v: null,
          variantId: s.variantId,
          bundleDigest: s.bundleDigest,
          live: true,
          gen: 1
        }
      }
    }))
  };
}

const projectPayload = buildProjectPayload(
  TARGET_PROJECT_ID,
  "6-Scene Crayon Target Film (1,050 Frames / 35.0s)",
  rebundledScenes
);
const livePlateStatus = buildLivePlateStatus(rebundledScenes);

const heavyProjectPayload = buildProjectPayload(
  HEAVY_PROJECT_ID,
  "4-Scene Heavy Styles Film (halftone, stipple, paintedOil, mellan)",
  heavyScenes
);
const heavyLivePlateStatus = buildLivePlateStatus(heavyScenes);

console.log("[2/4] Starting Next.js dev server...");
const { proc: nextProc, origin, port } = await startNextDevServer();
let browser = null;
let clipRequestsCount = 0;
const clipRequestedVariants = [];

try {
  await withTimingLock("real-app-playback-verification", async () => {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"]
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1
    });

    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.hostname === "fonts.googleapis.com") {
        await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: "" });
        return;
      }
      if (url.pathname.endsWith("/media-token")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ token: "fixture-token", expiresAt: "2099-01-01T00:00:00.000Z" })
        });
        return;
      }
      if (url.pathname.endsWith(`/projects/${TARGET_PROJECT_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(projectPayload)
        });
        return;
      }
      if (url.pathname.endsWith(`/projects/${HEAVY_PROJECT_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(heavyProjectPayload)
        });
        return;
      }
      if (
        url.pathname.endsWith(`/projects/${TARGET_PROJECT_ID}/plates`) ||
        url.pathname.endsWith(`/projects/${TARGET_PROJECT_ID}/plates/draw`)
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(livePlateStatus)
        });
        return;
      }
      if (
        url.pathname.endsWith(`/projects/${HEAVY_PROJECT_ID}/plates`) ||
        url.pathname.endsWith(`/projects/${HEAVY_PROJECT_ID}/plates/draw`)
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(heavyLivePlateStatus)
        });
        return;
      }
      if (url.pathname.endsWith("/plates/subtitles")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(livePlateStatus.subtitles)
        });
        return;
      }
      const bundleMetaMatch = /\/plates\/(?:variants\/)?([^/]+)\/bundle$/.exec(url.pathname);
      if (bundleMetaMatch) {
        const varId = decodeURIComponent(bundleMetaMatch[1]);
        const sc = allMockVariants.get(varId);
        if (sc) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              url: `${origin}/mock-bundles/${encodeURIComponent(varId)}/g1/bundle.html`,
              bundleDigest: sc.bundleDigest,
              params: {},
              manifest: sc.manifest,
              expiresAt: "2099-01-01T00:00:00.000Z"
            })
          });
          return;
        }
      }
      if (/\/plates\/(?:variants\/)?[^/]+\/check$/.test(url.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, state: "checked" })
        });
        return;
      }
      const bundleHtmlMatch = /\/mock-bundles\/([^/]+)\/g1\/bundle\.html$/.exec(url.pathname);
      if (bundleHtmlMatch) {
        const varId = decodeURIComponent(bundleHtmlMatch[1]);
        const sc = allMockVariants.get(varId);
        if (sc) {
          await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: sc.html
          });
          return;
        }
      }
      const clipMatch = /\/plates\/(?:variants\/)?([^/]+)\/clip$/.exec(url.pathname);
      if (clipMatch) {
        clipRequestsCount++;
        clipRequestedVariants.push(decodeURIComponent(clipMatch[1]));
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ status: "rendering" })
        });
        return;
      }
      const voMatch = /\/audio\/vo\/scene-(\d+)\.wav$/.exec(url.pathname);
      if (voMatch) {
        const idx = Number(voMatch[1]) - 1;
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: wavByScene[idx] ?? wavByScene[0]
        });
        return;
      }
      if (url.pathname.includes("/audio/music/")) {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: musicWav
        });
        return;
      }
      if (url.pathname.includes("/plan-sfx/")) {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: sfxWav
        });
        return;
      }
      if (url.hostname === "127.0.0.1" && url.port === String(port)) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    });

    const page = await context.newPage();

    // Inject drawImage instrumentation BEFORE page scripts run so every actual presented ImageBitmap is recorded
    await page.addInitScript(() => {
      const presentedLog = [];
      const uniqueByScene = new Map();
      const uniqueGlobal = new Set();
      let totalStageBlits = 0;
      let peakTelemetryCacheBytes = 0;

      const origDraw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
        const c = this.canvas;
        if (c && c.dataset && c.dataset.sceneId) {
          const sceneId = c.dataset.sceneId;
          const sceneIdx = Number(sceneId.replace("scene-", ""));
          const bmFrame =
            img && typeof img.__sceneFrame === "number"
              ? img.__sceneFrame
              : c.dataset.presentedFrame !== undefined
                ? Number(c.dataset.presentedFrame)
                : null;
          const bmQuality =
            (img && img.__renderQualityMode) || c.dataset.presentedQuality || "unknown";
          if (bmFrame !== null && Number.isFinite(bmFrame)) {
            totalStageBlits++;
            const key = `${sceneIdx}:${bmFrame}`;
            uniqueGlobal.add(key);
            if (!uniqueByScene.has(sceneIdx)) uniqueByScene.set(sceneIdx, new Set());
            uniqueByScene.get(sceneIdx).add(bmFrame);
            presentedLog.push({
              tMs: Math.round(performance.now() * 10) / 10,
              sceneIdx,
              frame: bmFrame,
              quality: bmQuality
            });
          }
          const tel = window.__plateLiveTelemetry;
          if (tel && typeof tel.cacheBytes === "number" && tel.cacheBytes > peakTelemetryCacheBytes) {
            peakTelemetryCacheBytes = tel.cacheBytes;
          }
        }
        return origDraw.call(this, img, ...rest);
      };

      window.__realAppBitmapAudit = {
        getSummary(sceneCount = 6) {
          const perScene = Array.from({ length: sceneCount }, (_, i) => uniqueByScene.get(i)?.size ?? 0);
          return {
            uniquePresentedFrames: uniqueGlobal.size,
            totalStageBlits,
            repeatedBlits: Math.max(0, totalStageBlits - uniqueGlobal.size),
            perSceneUniquePresented: perScene,
            peakTelemetryCacheBytes,
            lastPresented: presentedLog.at(-1) ?? null,
            fullQualityPresentations: presentedLog.filter((p) => p.quality === "full").length,
            draftQualityPresentations: presentedLog.filter((p) => p.quality === "draft").length
          };
        },
        reset() {
          presentedLog.length = 0;
          uniqueByScene.clear();
          uniqueGlobal.clear();
          totalStageBlits = 0;
          peakTelemetryCacheBytes = 0;
        }
      };
    });

    const onlyPart4 = process.argv.includes("--only-part-4");
    let initialReadyMs = 0;
    let totalPlayWallMs = 0;
    let peakCacheDuringPlay = 0;
    let peakWorkersDuringPlay = 0;
    let peakIframesDuringPlay = 0;
    const workerResidencySamples = [];
    let naturalEndAudit = null;
    let pauseUpgradeLatencyMs = 0;
    let pauseStillAudit = null;
    let backseekReplayMs = 0;
    let backseekAudit = null;
    let fullModeAudit = null;
    const realAppLifecycle10Cycles = [];

    if (!onlyPart4) {
    console.log("[3/4] Running 1,050-frame (35.0s) autonomous RAF + WebAudio playback, Worker residency audit, backseek/replay & 10 lifecycle cycles...");
    const tNav0 = performance.now();
    await page.goto(
      `${origin}/dev/plate-preview-fixture?project=${TARGET_PROJECT_ID}&state=live-c-ready&theme=dark`,
      { waitUntil: "networkidle" }
    );

    await page.waitForSelector(".aw-segments li:nth-child(6)");
    await page.waitForFunction(() => {
      const tel = window.__plateLiveTelemetry;
      const audit = window.__realAppBitmapAudit?.getSummary();
      return Boolean(
        tel &&
          tel.decisions &&
          tel.decisions.length === 6 &&
          tel.decisions.every((d) => d.mode === "live" && d.state === "checked") &&
          audit &&
          audit.uniquePresentedFrames >= 1
      );
    }, null, { timeout: 30_000 });
    initialReadyMs = Math.round((performance.now() - tNav0) * 100) / 100;

    const defaultModeAttr = await page
      .locator('.aw-floating-bar button[aria-label="Preview quality"]')
      .getAttribute("data-render-mode");
    assert.equal(defaultModeAttr, "draft", "OptionsBar defaults to Draft playback quality");

    const playBtn = page.locator('.aw-controls button[aria-label="Play"]');
    await playBtn.click();

    let lastLogSec = -5;
    const playStartWall = performance.now();
    while (performance.now() - playStartWall < 90_000) {
      const snap = await page.evaluate(() => {
        const tel = window.__plateLiveTelemetry;
        const audit = window.__realAppBitmapAudit?.getSummary();
        const playButton = document.querySelector('.aw-controls button[aria-label="Play"]');
        const pauseButton = document.querySelector('.aw-controls button[aria-label="Pause"]');
        return {
          tel,
          uniquePresentedFrames: audit?.uniquePresentedFrames ?? 0,
          lastPresented: audit?.lastPresented ?? null,
          isPausedNow: Boolean(playButton && !pauseButton),
          iframes: document.querySelectorAll("iframe").length
        };
      });
      const elapsedSec = Math.floor((performance.now() - playStartWall) / 1000);
      if (elapsedSec >= lastLogSec + 5) {
        lastLogSec = elapsedSec;
        console.log(
          `    [${elapsedSec}s] scene=${snap.lastPresented?.sceneIdx ?? "?"} frame=${snap.lastPresented?.frame ?? "?"} uniquePresented=${snap.uniquePresentedFrames} activeWorkers=${snap.tel?.activeWorkers ?? 0} iframes=${snap.iframes} cacheBytes=${snap.tel?.cacheBytes ?? 0} naturalEnd=${snap.tel?.naturalEndCleanupTriggered ?? false}`
        );
      }
      if (snap.tel) {
        if ((snap.tel.cacheBytes ?? 0) > peakCacheDuringPlay) {
          peakCacheDuringPlay = snap.tel.cacheBytes;
        }
        if ((snap.tel.activeWorkers ?? 0) > peakWorkersDuringPlay) {
          peakWorkersDuringPlay = snap.tel.activeWorkers;
        }
        if (snap.iframes > peakIframesDuringPlay) {
          peakIframesDuringPlay = snap.iframes;
        }
        workerResidencySamples.push({
          tSec: Math.round(((performance.now() - playStartWall) / 1000) * 10) / 10,
          sceneIdx: snap.lastPresented?.sceneIdx ?? 0,
          activeWorkers: snap.tel.activeWorkers ?? 0,
          iframes: snap.iframes,
          cacheBytes: snap.tel.cacheBytes ?? 0
        });
        if (snap.tel.naturalEndCleanupTriggered && snap.isPausedNow) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    totalPlayWallMs = Math.round((performance.now() - playStartWall) * 100) / 100;

    // Collect post-natural-end telemetry & bitmap audit WITHOUT calling any cleanup function from the test
    naturalEndAudit = await page.evaluate(() => {
      return {
        telemetry: window.__plateLiveTelemetry,
        bitmapAudit: window.__realAppBitmapAudit.getSummary(),
        iframesAfterNaturalEnd: document.querySelectorAll("iframe").length,
        canvasesInHost: document.querySelectorAll(".aw-live-canvas-host canvas").length
      };
    });

    assert.ok(
      peakWorkersDuringPlay <= 2,
      `Peak active Workers during 6-scene playback (${peakWorkersDuringPlay}) must be <= 2 (active scene + next-scene head prefetch)`
    );
    assert.ok(
      peakIframesDuringPlay <= 2,
      `Peak bootstrap iframes during 6-scene playback (${peakIframesDuringPlay}) must be <= 2`
    );
    assert.equal(
      naturalEndAudit.telemetry?.naturalEndCleanupTriggered,
      true,
      "PlateLiveStage automatically triggered natural end-of-film cleanup at the end of Scene 5"
    );
    assert.equal(
      naturalEndAudit.telemetry?.cacheBytes,
      0,
      "FrameCache bytes automatically dropped to 0 at natural film end"
    );
    assert.equal(
      naturalEndAudit.telemetry?.activeWorkers,
      0,
      "All scene Workers automatically terminated at natural film end"
    );
    assert.equal(
      naturalEndAudit.iframesAfterNaturalEnd,
      0,
      "All sandboxed bootstrap iframes automatically removed at natural film end"
    );

    // Test intentional pause -> 250ms debounced full-quality still upgrade in the real app (seeking to Scene 1 while paused)
    const tPauseStill0 = performance.now();
    await page.locator(".aw-segments li:nth-child(2)").click();
    await page.waitForFunction(
      () => {
        const host = document.querySelector(".aw-live-canvas-host");
        return host?.getAttribute("data-live-still-state") === "showing-still";
      },
      null,
      { timeout: 10_000 }
    );
    pauseUpgradeLatencyMs = Math.round((performance.now() - tPauseStill0) * 100) / 100;
    pauseStillAudit = await page.evaluate(() => {
      const host = document.querySelector(".aw-live-canvas-host");
      const activeCanvas = document.querySelector('.aw-live-canvas-host canvas[data-scene-id="scene-1"]');
      return {
        stillState: host?.getAttribute("data-live-still-state"),
        presentedQuality: activeCanvas?.getAttribute("data-presented-quality"),
        presentedFrame: activeCanvas?.getAttribute("data-presented-frame"),
        activeWorkers: window.__plateLiveTelemetry?.activeWorkers ?? 0,
        iframes: document.querySelectorAll("iframe").length
      };
    });
    assert.equal(pauseStillAudit.stillState, "showing-still");
    assert.equal(pauseStillAudit.presentedQuality, "full", "Paused still upgraded canvas to full-quality bitmap");
    assert.ok(pauseStillAudit.activeWorkers <= 1, "Only Scene 1 Worker was respawned on backwards seek to Scene 1");

    // Test backwards seek to Scene 0 + replay (proving a scene whose Worker was released at S0->S1 and natural end re-initializes cleanly)
    const tBackseek0 = performance.now();
    await page.locator(".aw-segments li:nth-child(1)").click();
    await page.locator('.aw-controls button[aria-label="Play"]').click();
    await page.waitForFunction(
      () => {
        const c0 = document.querySelector('.aw-live-canvas-host canvas[data-scene-id="scene-0"]');
        const f = Number(c0?.getAttribute("data-presented-frame") ?? -1);
        return f >= 15 && c0?.getAttribute("data-presented-quality") === "draft";
      },
      null,
      { timeout: 10_000 }
    );
    backseekReplayMs = Math.round((performance.now() - tBackseek0) * 100) / 100;
    await page.locator('.aw-controls button[aria-label="Pause"]').click();
    backseekAudit = await page.evaluate(() => {
      const c0 = document.querySelector('.aw-live-canvas-host canvas[data-scene-id="scene-0"]');
      return {
        scene0PresentedFrame: Number(c0?.getAttribute("data-presented-frame") ?? -1),
        scene0PresentedQuality: c0?.getAttribute("data-presented-quality"),
        activeWorkers: window.__plateLiveTelemetry?.activeWorkers ?? 0,
        iframes: document.querySelectorAll("iframe").length,
        cacheBytes: window.__plateLiveTelemetry?.cacheBytes ?? 0
      };
    });
    assert.ok(backseekAudit.scene0PresentedFrame >= 15, "Backwards seek to Scene 0 re-initialized Worker and played frames");
    assert.ok(backseekAudit.activeWorkers <= 2, "Backwards seek kept activeWorkers <= 2");

    // Test explicit Full mode selection via OptionsBar popover in the real app
    await page.locator('.aw-floating-bar button[aria-label="Preview quality"]').click();
    await page.locator('[role="dialog"][aria-label="Preview quality"] button[data-playback-mode="full"]').click();
    await page.waitForFunction(() => {
      const host = document.querySelector(".aw-live-canvas-host");
      return host?.getAttribute("data-live-render-mode") === "full";
    });

    fullModeAudit = await page.evaluate(() => {
      const host = document.querySelector(".aw-live-canvas-host");
      const btn = document.querySelector('.aw-floating-bar button[aria-label="Preview quality"]');
      return {
        hostRenderMode: host?.getAttribute("data-live-render-mode"),
        buttonRenderMode: btn?.getAttribute("data-render-mode"),
        buttonText: btn?.textContent?.trim(),
        storedMode: window.localStorage.getItem("gm-plate-playback-render-mode")
      };
    });
    assert.equal(fullModeAudit.hostRenderMode, "full");
    assert.equal(fullModeAudit.buttonRenderMode, "full");
    assert.equal(fullModeAudit.storedMode, "full");
    assert.equal(clipRequestsCount, 0, "Zero requestClip calls occurred during Draft or Full playback");

    // Reset back to Draft mode in localStorage before 10 open/play/close cycles
    await page.evaluate(() => {
      window.localStorage.setItem("gm-plate-playback-render-mode", "draft");
    });

    // Run 10 Open / Play / Boundary-Cross / Close (unmount) cycles on the real Next.js UI
    for (let cycle = 0; cycle < 10; cycle++) {
      await page.goto(
        `${origin}/dev/plate-preview-fixture?project=${TARGET_PROJECT_ID}&state=live-c-ready&theme=dark`,
        { waitUntil: "domcontentloaded" }
      );
      await page.waitForFunction(() => {
        const tel = window.__plateLiveTelemetry;
        return Boolean(tel && tel.decisions && tel.decisions.length === 6 && tel.decisions[0]?.mode === "live");
      }, null, { timeout: 15_000 });
      await page.locator('.aw-controls button[aria-label="Play"]').click();
      await page.waitForTimeout(220);
      await page.locator(".aw-segments li:nth-child(2)").click();
      await page.waitForTimeout(150);
      const midSnap = await page.evaluate(() => ({
        activeWorkers: window.__plateLiveTelemetry?.activeWorkers ?? 0,
        iframes: document.querySelectorAll("iframe").length
      }));
      await page.goto("about:blank");
      const afterUnmount = await page.evaluate(() => ({
        iframesAfterUnmount: document.querySelectorAll("iframe").length,
        canvasesAfterUnmount: document.querySelectorAll("canvas").length
      }));
      assert.ok(midSnap.activeWorkers <= 2, `Cycle ${cycle + 1}: activeWorkers <= 2 during play/seek`);
      assert.equal(afterUnmount.iframesAfterUnmount, 0, `Cycle ${cycle + 1}: 0 iframes after unmount`);
      assert.equal(afterUnmount.canvasesAfterUnmount, 0, `Cycle ${cycle + 1}: 0 canvases after unmount`);
      realAppLifecycle10Cycles.push({ cycle: cycle + 1, ...midSnap, ...afterUnmount });
    }
    console.log("  ✔ Completed 10/10 real-app Open/Play/Seek/Close lifecycle cycles with 0 leaked iframes/canvases and <= 2 active Workers!");
    }

    // ============================================================================
    // PART 4: Heavy-Style Production WorkerHost Default (DEFAULT_WATCHDOG_MS=2000) Real-UI Verification
    //         (halftone, stipple, paintedOil, mellan)
    // ============================================================================
    console.log("[4/4] Testing heavy styles (halftone, stipple, paintedOil, mellan) through real UI with DEFAULT_WATCHDOG_MS=2000...");
    await page.goto(
      `${origin}/dev/plate-preview-fixture?project=${HEAVY_PROJECT_ID}&state=live-c-ready&theme=dark`,
      { waitUntil: "networkidle" }
    );
    await page.waitForSelector(".aw-segments li:nth-child(4)");
    try {
      await page.waitForFunction(() => {
        const tel = window.__plateLiveTelemetry;
        return Boolean(
          tel &&
            tel.decisions &&
            tel.decisions.length === 4 &&
            tel.decisions.every((d) => d.mode === "live" && d.state === "checked")
        );
      }, null, { timeout: 10_000 });
    } catch (err) {
      const dbg = await page.evaluate(() => ({
        tel: window.__plateLiveTelemetry,
        text: document.body.innerText.slice(0, 500)
      }));
      console.error("DEBUG [4/4] telemetry:", JSON.stringify(dbg, null, 2));
      throw err;
    }

    const heavyStyleResults = [];
    for (let idx = 0; idx < heavyScenes.length; idx++) {
      const hs = heavyScenes[idx];
      // Ensure we start in Draft mode
      const curMode = await page.locator(".aw-live-canvas-host").getAttribute("data-live-render-mode");
      if (curMode !== "draft") {
        await page.locator('.aw-floating-bar button[aria-label="Preview quality"]').click();
        await page.locator('[role="dialog"][aria-label="Preview quality"] button[data-playback-mode="draft"]').click();
        await page.waitForFunction(() => document.querySelector(".aw-live-canvas-host")?.getAttribute("data-live-render-mode") === "draft");
      }

      // 1. Select the heavy style scene tab and play in Draft mode for ~600ms
      const tSelect0 = performance.now();
      await page.locator(`.aw-segments li:nth-child(${idx + 1})`).click();
      await page.waitForFunction(
        (sIdx) => {
          const c = document.querySelector(`.aw-live-canvas-host canvas[data-scene-id="scene-${sIdx}"]`);
          return c && c.style.display === "block" && c.getAttribute("data-presented-frame") !== null;
        },
        idx,
        { timeout: 15_000 }
      );
      const draftStageReadyMs = Math.round((performance.now() - tSelect0) * 100) / 100;

      // Play in Draft mode
      await page.locator('.aw-controls button[aria-label="Play"]').click();
      await page.waitForTimeout(650);

      // 2. Rapid Pause -> Play -> Pause fencing, then wait for 250ms debounced Full-quality still upgrade!
      await page.locator('.aw-controls button[aria-label="Pause"]').click();
      await page.waitForTimeout(80); // < 250ms debounce: must cancel when we click Play!
      const stateDuringShortPause = await page.locator(".aw-live-canvas-host").getAttribute("data-live-still-state");
      await page.locator('.aw-controls button[aria-label="Play"]').click();
      await page.waitForTimeout(180);

      // Intentional pause -> wait for Full-quality still upgrade (under DEFAULT_WATCHDOG_MS=2000!)
      const tPause0 = performance.now();
      await page.locator('.aw-controls button[aria-label="Pause"]').click();
      await page.waitForFunction(
        (sIdx) => {
          const host = document.querySelector(".aw-live-canvas-host");
          const c = document.querySelector(`.aw-live-canvas-host canvas[data-scene-id="scene-${sIdx}"]`);
          return (
            host?.getAttribute("data-live-still-state") === "showing-still" &&
            c?.getAttribute("data-presented-quality") === "full"
          );
        },
        idx,
        { timeout: 10_000 }
      );
      const fullPauseUpgradeMs = Math.round((performance.now() - tPause0) * 100) / 100;

      // 3. Switch explicitly to Full mode via OptionsBar and verify Full-quality frame rendering & local buffering without watchdog failure or AWS clip fallback!
      const tFullSwitch0 = performance.now();
      await page.locator('.aw-floating-bar button[aria-label="Preview quality"]').click();
      await page.locator('[role="dialog"][aria-label="Preview quality"] button[data-playback-mode="full"]').click();
      await page.waitForFunction(
        (sIdx) => {
          const host = document.querySelector(".aw-live-canvas-host");
          const c = document.querySelector(`.aw-live-canvas-host canvas[data-scene-id="scene-${sIdx}"]`);
          return (
            host?.getAttribute("data-live-render-mode") === "full" &&
            c?.getAttribute("data-presented-quality") === "full"
          );
        },
        idx,
        { timeout: 15_000 }
      );
      const explicitFullReadyMs = Math.round((performance.now() - tFullSwitch0) * 100) / 100;

      // Play briefly in explicit Full mode to verify local buffering/playback without watchdog trip or clip fallback
      await page.locator('.aw-controls button[aria-label="Play"]').click();
      await page.waitForTimeout(500);
      await page.locator('.aw-controls button[aria-label="Pause"]').click();

      const snap = await page.evaluate((sIdx) => {
        const tel = window.__plateLiveTelemetry;
        const c = document.querySelector(`.aw-live-canvas-host canvas[data-scene-id="scene-${sIdx}"]`);
        return {
          decision: tel?.decisions?.[sIdx] ?? null,
          presentedQuality: c?.getAttribute("data-presented-quality"),
          presentedFrame: Number(c?.getAttribute("data-presented-frame") ?? -1),
          activeWorkers: tel?.activeWorkers ?? 0,
          cacheBytes: tel?.cacheBytes ?? 0
        };
      }, idx);

      assert.equal(snap.decision?.mode, "live", `${hs.styleId}: remained in live mode (never fell back to clip)`);
      assert.equal(snap.presentedQuality, "full", `${hs.styleId}: presented full quality in explicit Full mode`);
      assert.equal(clipRequestsCount, 0, `${hs.styleId}: zero requestClip (AWS) calls`);

      heavyStyleResults.push({
        styleId: hs.styleId,
        look: hs.look,
        draftStageReadyMs,
        stateDuringShortPause,
        fullPauseUpgradeMs,
        explicitFullReadyMs,
        decisionAfterFullPlay: snap.decision,
        presentedQuality: snap.presentedQuality,
        presentedFrame: snap.presentedFrame,
        activeWorkers: snap.activeWorkers,
        clipRequestsCount
      });
      console.log(
        `  ✔ ${hs.styleId} (${hs.look}): draftReady=${draftStageReadyMs}ms, pauseStillUpgrade=${fullPauseUpgradeMs}ms (quality=full), explicitFullReady=${explicitFullReadyMs}ms, mode=${snap.decision?.mode}, clipRequests=${clipRequestsCount}`
      );
    }

    const finalOutput = {
      timestamp: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        browser: "Google Chrome Headless 156.0",
        viewport: "1280x800 (deviceScaleFactor=1)",
        previewResolution16x9: "640x360",
        previewResolution1x1: "480x480",
        defaultWatchdogMs: 2000,
        defaultHeartbeatIntervalMs: 500,
        defaultDraftTargetVertices: 75000
      },
      initialReadyMs,
      totalPlayWallMs,
      peakCacheDuringPlayBytes: Math.max(peakCacheDuringPlay, naturalEndAudit?.bitmapAudit?.peakTelemetryCacheBytes ?? 0),
      peakCacheDuringPlayMB:
        Math.round(
          (Math.max(peakCacheDuringPlay, naturalEndAudit?.bitmapAudit?.peakTelemetryCacheBytes ?? 0) / (1024 * 1024)) * 100
        ) / 100,
      peakWorkersDuringPlay,
      peakIframesDuringPlay,
      workerResidencySamples,
      clipRequestsCount,
      clipRequestedVariants,
      naturalEndAudit,
      pauseUpgradeLatencyMs,
      pauseStillAudit,
      backseekReplayMs,
      backseekAudit,
      fullModeAudit,
      realAppLifecycle10Cycles,
      heavyStyleResults
    };

    writeFileSync(
      join(INTEGRATION_DIR, "real-app-autonomous-playback-and-audio.json"),
      JSON.stringify(finalOutput, null, 2)
    );
    console.log("  ✔ All real Next.js app autonomous playback, Worker residency (<=2), backseek/replay, 10 lifecycle cycles, and heavy-style production watchdog checks passed!");
  });
} finally {
  if (browser) await browser.close().catch(() => {});
  if (nextProc && nextProc.pid) {
    try {
      process.kill(-nextProc.pid, "SIGTERM");
    } catch {
      try {
        nextProc.kill("SIGTERM");
      } catch {}
    }
  }
}
