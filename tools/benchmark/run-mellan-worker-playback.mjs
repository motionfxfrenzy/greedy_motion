import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
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

function loadAnimatedMellanCode(frames = 180, startProgress = 0.92) {
  const rawPlateSrc = readFileSync(
    join(REPO_ROOT, "packages/plate-engine/src/canvas-core/mellan.ts"),
    "utf8"
  );
  const span = Math.max(0.01, 1 - startProgress);
  const plateSrc = rawPlateSrc
    .replace(/import\s+(type\s+)?\{([\s\S]*?)\}\s*from/g, (_, tp, inner) => `import ${tp ?? ""}{ ${inner.replace(/\s+/g, " ").trim()} } from`)
    .replace(/export\s+const\s+STYLE\s*=\s*\{[\s\S]*?\};/g, "")
    .replace(/import\(["']\.\/core["']\)\.Env/g, "any")
    .replace(
      /durationFrames:\s*1\s*\},\s*assets:\s*\{\s*images:\s*\{\}\s*\},\s*shots:\s*\[\{\s*id:\s*"moon",\s*start:\s*0,\s*end:\s*1,\s*draw:\s*\(ctx,\s*f,\s*env\)\s*=>\s*drawMellan\(ctx,\s*f,\s*env,\s*1\)\s*\}\]/,
      `durationFrames: ${frames} },\n  assets: { images: {} },\n  shots: [{ id: "moon", start: 0, end: ${frames}, draw: (ctx, f, env) => drawMellan(ctx, f, env, Math.min(1, ${startProgress} + ${span} * ((f + 1) / ${frames}))) }]`
    )
    .replace(/\bwindow\b/g, "winVar")
    .replace(/\bdocument\b/g, "docVar")
    .replace(/\blocation\b/g, "locVar");
  return `${plateSrc}\nexport const film: Film = mellan;\n`;
}

await withTimingLock("mellan-worker-playback", async () => {
  const FRAMES = 180; // 6.0s at 30fps
  const code = loadAnimatedMellanCode(FRAMES, 0.92);
  const bundled = await bundleScene({
    look: "illus-mellan",
    code,
    frames: FRAMES,
    aspect: "1:1"
  });

  const compiledLive = await build({
    entryPoints: [join(REPO_ROOT, "frontend/lib/live/index.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: {
      "process.env.NEXT_PUBLIC_PLATE_LIVE": '"1"',
      "process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW": '"1"',
      "process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES": '"75000"'
    }
  });
  const liveJs = compiledLive.outputFiles[0].text;

  const server = createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (p === "/t.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><body><div id="stage"></div><script type="module">import * as L from "/live.js"; window.Live = L;</script></body>`);
      return;
    }
    if (p === "/live.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(liveJs);
      return;
    }
    if (p === "/mellan.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(bundled.html);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/t.html`, { waitUntil: "load" });
    await page.waitForFunction(() => Boolean(window.Live));

    const evalOut = await page.evaluate(async ({ frames }) => {
      const L = window.Live;
      const html = await fetch("/mellan.html").then((r) => r.text());
      const durationSec = frames / 30;

      const testProfiles = [
        { id: "full", label: "Full (Reference)", renderMode: "full", targetVertices: 75000, turnDensity: undefined, expectedKeyPart: "full:1" },
        { id: "draft-75k", label: "Draft 75k (Default)", renderMode: "draft", targetVertices: 75000, turnDensity: undefined, expectedKeyPart: "tb75000" },
        { id: "draft-40k", label: "Draft 40k (arcStep)", renderMode: "draft", targetVertices: 40000, turnDensity: undefined, expectedKeyPart: "tb40000" },
        { id: "draft-4k", label: "Draft 4k (arcStep, Accepted)", renderMode: "draft", targetVertices: 4000, turnDensity: undefined, expectedKeyPart: "tb4000" },
        { id: "draft-2k", label: "Draft 2k (arcStep)", renderMode: "draft", targetVertices: 2000, turnDensity: undefined, expectedKeyPart: "tb2000" },
        { id: "draft-1k", label: "Draft 1k (arcStep)", renderMode: "draft", targetVertices: 1000, turnDensity: undefined, expectedKeyPart: "tb1000" },
        { id: "draft-500", label: "Draft 500 (arcStep)", renderMode: "draft", targetVertices: 500, turnDensity: undefined, expectedKeyPart: "tb500" },
        { id: "draft-pitch75", label: "Pitch 75% Turns (8.27px)", renderMode: "draft", targetVertices: 75000, turnDensity: 0.75, expectedKeyPart: "tb75000:ms48:mc0:bp-scene-calibrated:mtd0.75" },
        { id: "draft-pitch75-4k", label: "Pitch 75% + 4k arcStep", renderMode: "draft", targetVertices: 4000, turnDensity: 0.75, expectedKeyPart: "tb4000:ms48:mc0:bp-scene-calibrated:mtd0.75" },
        { id: "draft-pitch50", label: "Pitch 50% Turns (12.40px)", renderMode: "draft", targetVertices: 75000, turnDensity: 0.5, expectedKeyPart: "tb75000:ms48:mc0:bp-scene-calibrated:mtd0.5" },
        { id: "draft-pitch25", label: "Pitch 25% Turns (24.80px)", renderMode: "draft", targetVertices: 75000, turnDensity: 0.25, expectedKeyPart: "tb75000:ms48:mc0:bp-scene-calibrated:mtd0.25" }
      ];

      // 1. Genuine Autonomous RAF + Real AudioContext (WebAudioFilmTimeline) Playback
      const autonomousRafResults = [];
      for (const prof of testProfiles) {
        const stage = document.getElementById("stage");
        stage.innerHTML = "";

        const audioCtx = new AudioContext();
        await audioCtx.resume();
        const audioTimeline = new L.WebAudioFilmTimeline({
          fps: 30,
          spans: [{ id: "mellan-scene", start: 0, end: durationSec }],
          context: audioCtx
        });
        const buf = audioCtx.createBuffer(1, Math.round(durationSec * 44100), 44100);
        audioTimeline.setVoiceBuffer(0, buf);
        await audioTimeline.unlockFromUserGesture();

        const player = L.createPlatePlayer({
          id: "mellan-scene",
          bundleDigest: `mellan-raf-${prof.id}`,
          html,
          aspect: "1:1",
          fps: 30,
          frames,
          renderMode: prof.renderMode,
          draftTargetVerticesPerFrame: prof.targetVertices
        });

        // For spiral-pitch experiment profiles, inject `mellanTurnDensity` into both the player's cacheKey and WorkerHost.frame qualitySpec
        if (prof.turnDensity !== undefined && player.workerHost) {
          const origFrame = player.workerHost.frame.bind(player.workerHost);
          player.workerHost.frame = (n, opts = {}) => {
            const qs =
              opts.qualitySpec && typeof opts.qualitySpec === "object"
                ? { ...opts.qualitySpec, mellanTurnDensity: prof.turnDensity }
                : opts.qualitySpec;
            return origFrame(n, { ...opts, qualitySpec: qs });
          };
        }

        const tMount0 = performance.now();
        await player.mount(stage, { active: true, deferMeasure: false });
        player.setWantPlaying(true);
        player.showFrame(0);

        while (player.isPreparing || !player.measuredYet || player.isBufferingNow) {
          if (performance.now() - tMount0 > 20_000) {
            throw new Error(`Startup timeout (>20s) on profile ${prof.id}`);
          }
          await new Promise((r) => setTimeout(r, 8));
        }
        const startupWaitMs = Math.round((performance.now() - tMount0) * 100) / 100;

        await audioTimeline.play({ fromUserGesture: true });
        let midPlayStallMs = 0;
        let stallStart = null;
        let peakCacheBytes = player.cache.bytes;
        const driftSamplesMs = [];
        const playWall0 = performance.now();

        await new Promise((resolvePlay, rejectPlay) => {
          const tick = (now) => {
            if (now - playWall0 > 30_000) {
              rejectPlay(new Error(`Playback timeout (>30s) on profile ${prof.id}`));
              return;
            }
            if (player.isBufferingNow || player.isPreparing) {
              if (stallStart === null) {
                stallStart = now;
                audioTimeline.setBuffering(true);
              }
              requestAnimationFrame(tick);
              return;
            }
            if (stallStart !== null) {
              midPlayStallMs += now - stallStart;
              stallStart = null;
              audioTimeline.setBuffering(false);
            }
            const tickRes = audioTimeline.tick();
            const targetFrame = Math.min(frames - 1, Math.max(0, Math.floor(tickRes.filmTime * 30)));
            player.showFrame(targetFrame);
            if (player.isBufferingNow || player.isPreparing) {
              stallStart = performance.now();
              audioTimeline.setBuffering(true);
              requestAnimationFrame(tick);
              return;
            }
            if (player.cache.bytes > peakCacheBytes) peakCacheBytes = player.cache.bytes;
            const presentedFrame = player.lastPresentedSourceFrame;
            if (typeof presentedFrame === "number") {
              const drift = Math.round(Math.abs(tickRes.filmTime - presentedFrame / 30) * 1000 * 100) / 100;
              driftSamplesMs.push(drift);
            }
            if (tickRes.filmTime >= durationSec || tickRes.ended) {
              resolvePlay();
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

        const totalPlayWallMs = Math.round((performance.now() - playWall0) * 100) / 100;
        const activeSeconds = Math.max(0.001, (totalPlayWallMs - midPlayStallMs) / 1000);
        const wallSeconds = Math.max(0.001, totalPlayWallMs / 1000);
        const uniquePresentedFrames = player.uniquePresentedFrameCount;
        const skippedFrames = Math.max(0, frames - uniquePresentedFrames);
        const achievedActiveFps = Math.round((uniquePresentedFrames / activeSeconds) * 10) / 10;
        const achievedWallFps = Math.round((uniquePresentedFrames / wallSeconds) * 10) / 10;
        const appliedQualityKey = player.lastStats?.qualityKey ?? null;
        const lastVertices = player.lastStats?.totalSceneVertices ?? null;
        const budgetExceededByFloor = Boolean(player.lastStats?.budgetExceededByFloor);
        const bufferingPauses = player.bufferingPauses;

        const sortedDrift = [...driftSamplesMs].sort((a, b) => a - b);
        const p50AudioDriftMs = sortedDrift.length ? sortedDrift[sortedDrift.length >> 1] : 0;
        const p95AudioDriftMs = sortedDrift.length
          ? sortedDrift[Math.min(sortedDrift.length - 1, Math.ceil(sortedDrift.length * 0.95) - 1)]
          : 0;
        const maxAudioDriftMs = sortedDrift.length ? sortedDrift[sortedDrift.length - 1] : 0;

        audioTimeline.destroy();
        await audioCtx.close().catch(() => {});
        player.destroy();

        autonomousRafResults.push({
          id: prof.id,
          label: prof.label,
          expectedKeyPart: prof.expectedKeyPart,
          appliedQualityKey,
          verifiedSourceProfile: Boolean(appliedQualityKey && String(appliedQualityKey).includes(prof.expectedKeyPart)),
          startupWaitMs,
          totalPlayWallMs,
          midPlayStallMs: Math.round(midPlayStallMs * 100) / 100,
          bufferingPauses,
          uniquePresentedFrames,
          skippedFrames,
          achievedActiveFps,
          achievedWallFps,
          p50AudioDriftMs,
          p95AudioDriftMs,
          maxAudioDriftMs,
          peakCacheBytes,
          peakCacheMB: Math.round((peakCacheBytes / (1024 * 1024)) * 100) / 100,
          lastVertices,
          budgetExceededByFloor
        });
      }

      return { autonomousRafResults };
    }, { frames: FRAMES });

    for (const r of evalOut.autonomousRafResults) {
      assert.equal(
        r.verifiedSourceProfile,
        true,
        `${r.id}: appliedQualityKey (${r.appliedQualityKey}) must contain ${r.expectedKeyPart}`
      );
      console.log(
        `  ✔ [Autonomous RAF + AudioContext] ${r.id}: startupWait=${r.startupWaitMs}ms, presented=${r.uniquePresentedFrames}/${FRAMES}, pauses=${r.bufferingPauses}, midStall=${r.midPlayStallMs}ms, activeFps=${r.achievedActiveFps}fps, wallFps=${r.achievedWallFps}fps, audioDriftP50=${r.p50AudioDriftMs}ms, verts=${r.lastVertices}, key=${r.appliedQualityKey}`
      );
    }

    writeFileSync(
      join(BENCH_DIR, "mellan-worker-playback-summary.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          frames: FRAMES,
          durationSec: FRAMES / 30,
          startProgress: 0.92,
          endProgress: 1.0,
          autonomousRafWithRealAudioContext: evalOut.autonomousRafResults
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    server.close();
  }
});
