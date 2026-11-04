// Phase 3c end-to-end UI acceptance test on the real local stack (`PLATE_LIVE_PREVIEW=on` + Next dev server with `NEXT_PUBLIC_PLATE_LIVE=1`).
//   node tools/phase2/e2e/live-ui-e2e.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import {
  api,
  download,
  ffprobe,
  log,
  now,
  pool,
  redirectOf,
  resetStub,
  seedProject,
  sleep,
  variants,
  waitFor
} from "../../../scripts/plates-e2e/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API_ORIGIN = process.env.E2E_API ?? "http://127.0.0.1:4100";
const S3_ENDPOINT = process.env.E2E_S3 ?? "http://localhost:59000";

const s3 = new S3Client({
  region: "auto",
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: "plates", secretAccessKey: "plates-secret-1" }
});

const FONT_CSS = `
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 400 600;
  src: url('/fonts/inter-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 700 800;
  src: url('/fonts/inter-700.woff2') format('woff2');
}
`;

const assertions = [];
const metrics = {};

function assertCheck(condition, description, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] (3c-E2E) ${description}${detail ? ` — ${detail}` : ""}`);
  assertions.push({ description, ok: Boolean(condition), detail });
  if (!condition) {
    throw new Error(`Assertion failed: ${description}${detail ? ` (${detail})` : ""}`);
  }
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

async function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function s3ListKeys(bucket, prefix) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (res.Contents ?? []).map((c) => c.Key).filter(Boolean);
}

async function ensureCleanStackState() {
  await waitFor(
    "plate-api ready",
    async () => {
      try {
        const r = await api("/readyz");
        return r.status === 200 && r.json?.ready === true;
      } catch {
        return false;
      }
    },
    { timeout: 60_000, every: 500 }
  );

  await pool.query(`
    TRUNCATE TABLE
      app.plate_check_reports,
      app.plate_revisions,
      app.plate_garbage,
      app.plate_exports,
      app.plate_variants,
      app.plate_state,
      app.render_jobs
    CASCADE
  `);
  await pool.query("DELETE FROM app.token_ledger WHERE kind = 'spend'");
  await pool.query(
    `INSERT INTO app.token_ledger (user_id, amount, kind, reason, ref, actor, pool)
     VALUES ('00000000-0000-4000-8000-000000000000', 1000000, 'grant', 'e2e test allowance', 'e2e-pack-grant', 'system', 'pack')
     ON CONFLICT (user_id, ref) WHERE ref IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount`
  );
  await pool.query(`
    DELETE FROM pgboss.job
    WHERE name IN ('plate-author', 'plate-render', 'plate-export', 'render-plan', 'render-video', 'render-finished', '__pgboss__send-it')
  `);
  await resetStub();
}

async function main() {
  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Google Chrome not found at ${CHROME_PATH}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "phase3c-live-ui-e2e-"));
  let nextProc = null;
  let browser = null;

  const stopNext = () => {
    if (nextProc && nextProc.pid) {
      try {
        process.kill(-nextProc.pid, "SIGTERM");
      } catch {
        try {
          nextProc.kill("SIGTERM");
        } catch {}
      }
    }
  };
  process.on("SIGINT", () => {
    stopNext();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stopNext();
    process.exit(143);
  });

  try {
    await ensureCleanStackState();

    // 1. Seed a real 3-beat illus-balloon project with recorded voiceover and music bed
    log("Seeding real 3-beat illus-balloon project with audio...");
    const { id: projectId, data: projectData } = await seedProject({
      look: "illus-balloon",
      aspect: "16:9",
      beats: 3,
      audio: true
    });
    const voiceWavBytes = readFileSync(join(FRONTEND_DIR, "test/fixtures/workspace/voice.wav"));
    for (const file of [...(projectData.planAudio?.voice?.lines ?? []).map((l) => l.file), projectData.planAudio?.music?.file]) {
      if (!file) continue;
      await s3.send(
        new PutObjectCommand({
          Bucket: "plates-uploads",
          Key: `media/audio/plans/${projectId}/${file}`,
          Body: voiceWavBytes,
          ContentType: file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav"
        })
      );
    }
    metrics.projectId = projectId;

    // 2. Start Next.js dev server with NEXT_PUBLIC_PLATE_LIVE=1 pointing at local plate-api
    const port = await findFreePort();
    const nextOrigin = `http://127.0.0.1:${port}`;
    log(`Starting Next dev server on ${nextOrigin} with NEXT_PUBLIC_PLATE_LIVE=1...`);

    nextProc = spawn(
      "npx",
      ["next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
      {
        cwd: FRONTEND_DIR,
        env: {
          ...process.env,
          NEXT_PUBLIC_LIVE_DEV: "1",
          NEXT_PUBLIC_PLATE_LIVE: "1",
          NEXT_PUBLIC_APP_ENV: "local",
          NEXT_PUBLIC_API_URL: API_ORIGIN,
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-dev-anon-key"
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      }
    );

    await waitForHttp(`${nextOrigin}/dev/plate-preview-fixture`);
    log("Next dev server ready. Launching headless Chrome...");

    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1
    });

    // Only intercept Google Fonts so no external internet call is made; all local stack & S3Mock requests pass through
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "fonts.googleapis.com") {
        await route.fulfill({
          status: 200,
          contentType: "text/css; charset=utf-8",
          body: FONT_CSS
        });
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    const tOpenStart = now();

    // 3. Open the real PlatePreview in the browser against the real project
    await page.goto(`${nextOrigin}/dev/plate-preview-fixture?project=${encodeURIComponent(projectId)}`, {
      waitUntil: "domcontentloaded"
    });

    // Wait for PlatePreview to trigger drawPlates, author all 3 scenes to `bundled`, and PlateLiveStage to check all 3 to `checked`
    const checkedWait = await waitFor(
      "all 3 scenes checked in Postgres by PlateLiveStage",
      async () => {
        const rows = await variants(projectId);
        return rows.length === 3 && rows.every((r) => r.state === "checked" && r.checked_at) ? rows : false;
      },
      { timeout: 120_000, every: 400 }
    );
    metrics.openToAllCheckedMs = now() - tOpenStart;
    const checkedRows = checkedWait.value;

    assertCheck(
      checkedRows.length === 3 && checkedRows.every((r) => r.state === "checked" && r.host === "worker" && !r.clip_key),
      "all 3 scenes transitioned bundled -> checked via real PlatePreview with clip_key=null",
      `in ${metrics.openToAllCheckedMs}ms`
    );

    // Assert zero plate-render jobs and zero clips in S3
    const variantIds = checkedRows.map((r) => r.id);
    const renderJobsBefore = (
      await pool.query(
        "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
        [variantIds]
      )
    ).rows[0].n;
    const outputKeysBefore = await s3ListKeys("plates-outputs", `plates/${projectId}/`);

    assertCheck(
      renderJobsBefore === 0 && outputKeysBefore.length === 0,
      "zero plate-render jobs and zero rendered clips exist for live-checked scenes",
      `jobs=${renderJobsBefore}, outputKeys=${outputKeysBefore.length}`
    );

    // Wait for the FilmPlayer in PlateLiveStage to finish mounting all 3 live scenes and blitting frame 0
    await page.waitForFunction(
      () => {
        const dev = document.querySelector('[data-testid="dev-live-decisions"]')?.textContent ?? "";
        const host = document.querySelector(".aw-live-canvas-host");
        const canvas = host?.querySelector("canvas");
        if (!canvas || canvas.width === 0) return false;
        const ctx = canvas.getContext("2d");
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonZero = 0;
        for (let i = 0; i < d.length; i += 400) {
          if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0 || d[i + 3] !== 0) nonZero++;
        }
        return (
          dev.includes("S1:live(ok)") &&
          dev.includes("S2:live(ok)") &&
          dev.includes("S3:live(ok)") &&
          nonZero >= 10 &&
          !document.querySelector(".aw-wait")
        );
      },
      { timeout: 30_000 }
    );

    const devDecisionsText = await page.locator('[data-testid="dev-live-decisions"]').textContent();
    assertCheck(
      Boolean(devDecisionsText?.includes("S1:live(ok)") && devDecisionsText?.includes("S2:live(ok)") && devDecisionsText?.includes("S3:live(ok)")),
      "UI reports all 3 scenes in live(ok) mode",
      devDecisionsText ?? ""
    );

    // 4. Press Play and run live playback for >= 5.2 seconds with audio running
    log("Starting live playback for >= 5 seconds with audio running...");
    const playBtn = page.locator("button.aw-play");
    await playBtn.click();

    await page.waitForFunction(
      () => {
        const btn = document.querySelector("button.aw-play");
        return btn?.getAttribute("aria-label") === "Pause";
      },
      { timeout: 5_000 }
    );
    assertCheck(true, "pressing Play switches control button to Pause");

    // Verify audio is running during playback
    await sleep(600);
    const audioRunningState = await page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll("audio"));
      const activeAudio = audios.find((a) => !a.paused && a.currentTime > 0);
      return {
        audioElementCount: audios.length,
        anyPlaying: Boolean(activeAudio),
        activeCurrentTime: activeAudio ? Math.round(activeAudio.currentTime * 100) / 100 : 0
      };
    });
    assertCheck(
      audioRunningState.anyPlaying,
      "voice/music audio element is actively playing as master clock",
      `audioElements=${audioRunningState.audioElementCount}, currentTime=${audioRunningState.activeCurrentTime}s`
    );

    // Let playback run until elapsedPlaySeconds >= 5.2s
    await page.waitForFunction(
      () => {
        const t = window.__plateLiveTelemetry;
        return Boolean(t && t.elapsedPlaySeconds >= 5.2 && t.framesRendered >= 60);
      },
      { timeout: 20_000 }
    );

    // Press Pause
    await playBtn.click();
    await page.waitForFunction(
      () => {
        const btn = document.querySelector("button.aw-play");
        return btn?.getAttribute("aria-label") === "Play";
      },
      { timeout: 5_000 }
    );

    const playTelemetry = await page.evaluate(() => {
      const host = document.querySelector(".aw-live-canvas-host");
      const visibleCanvas = Array.from(host?.querySelectorAll("canvas") ?? []).find(
        (c) => c.style.display !== "none"
      );
      let nonZeroSamples = 0;
      if (visibleCanvas) {
        const ctx = visibleCanvas.getContext("2d");
        const data = ctx.getImageData(0, 0, visibleCanvas.width, visibleCanvas.height).data;
        for (let i = 0; i < data.length; i += 400) {
          if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) {
            nonZeroSamples++;
          }
        }
      }
      const clockText = document.querySelector(".aw-clock")?.textContent ?? "";
      const sceneLabel = document.querySelector(".aw-scene")?.textContent ?? "";
      return {
        telemetry: window.__plateLiveTelemetry,
        nonZeroSamples,
        clockText,
        sceneLabel
      };
    });

    metrics.playbackTelemetry = playTelemetry.telemetry;

    assertCheck(
      playTelemetry.telemetry.elapsedPlaySeconds >= 5.0 &&
        playTelemetry.telemetry.framesRendered >= 60 &&
        playTelemetry.telemetry.distinctFrames >= 30 &&
        playTelemetry.nonZeroSamples >= 10,
      "live canvas drew frames for >= 5 s of playback and crossed scene boundary cleanly",
      `elapsed=${playTelemetry.telemetry.elapsedPlaySeconds}s, framesRendered=${playTelemetry.telemetry.framesRendered}, distinctFrames=${playTelemetry.telemetry.distinctFrames}, achievedFps=${playTelemetry.telemetry.achievedFps}, lateFrames=${playTelemetry.telemetry.lateFrames}, sceneLabel="${playTelemetry.sceneLabel}"`
    );
    assertCheck(true, "pressing Pause stops playback cleanly", `clock="${playTelemetry.clockText}"`);

    // 5. Test Seek across scenes (seek to Scene 3 and then back to Scene 1)
    const slider = page.locator('.aw-track[role="slider"]');
    const sliderBox = await slider.boundingBox();
    await page.mouse.click(sliderBox.x + sliderBox.width * 0.8, sliderBox.y + sliderBox.height / 2);

    await page.waitForFunction(
      () => (document.querySelector(".aw-scene")?.textContent ?? "").includes("Scene 3"),
      { timeout: 5_000 }
    );
    const sceneAfterSeek3 = await page.locator(".aw-scene").textContent();
    assertCheck(
      Boolean(sceneAfterSeek3?.includes("Scene 3")),
      "seeking on timeline slider jumps to Scene 3 and updates live canvas",
      `sceneLabel="${sceneAfterSeek3}"`
    );

    // Seek back to Scene 1 (near 0:01) for adding a comment
    await page.mouse.click(sliderBox.x + sliderBox.width * 0.08, sliderBox.y + sliderBox.height / 2);
    await page.waitForFunction(
      () => (document.querySelector(".aw-scene")?.textContent ?? "").includes("Scene 1"),
      { timeout: 5_000 }
    );

    // 6. Add a comment on Scene 1 and click Apply comments (`Redraw scene 1`)
    log("Adding comment on Scene 1 and applying comments...");
    const checksBeforeComment = (await page.evaluate(() => window.__plateLiveTelemetry?.checksRun ?? 0));
    const commentBox = page.locator("aside.aw-side textarea");
    await commentBox.fill("Make the moon glow brighter over the water");
    await page.locator('aside.aw-side button:has-text("Add")').click();

    await page.waitForSelector(".aw-comments li:not(.empty)", { timeout: 10_000 });
    const applyBtn = page.locator("button.aw-apply");
    const applyBtnText = await applyBtn.textContent();
    const scene1HasNeedsUpdate = await page.evaluate(() =>
      Boolean(document.querySelector(".aw-segments li:first-child")?.classList.contains("needs-update"))
    );
    assertCheck(
      Boolean(applyBtnText?.includes("Redraw scene 1")) && scene1HasNeedsUpdate,
      "adding comment marks Scene 1 tab as needs-update and enables Redraw scene 1",
      `applyBtn="${applyBtnText}"`
    );

    const tApplyStart = now();
    await applyBtn.click();

    // Wait for Scene 1 in Postgres to advance to rev=1, gen=2 and be re-checked by PlateLiveStage back to state='checked'
    const revisedWait = await waitFor(
      "Scene 1 revised (rev=1, gen=2) and re-checked to 'checked' by PlateLiveStage",
      async () => {
        const rows = await variants(projectId);
        const s0 = rows.find((r) => r.scene_index === 0 && r.aspect === "16:9");
        return s0 && s0.rev === 1 && s0.gen === 2 && s0.state === "checked" && s0.checked_at ? s0 : false;
      },
      { timeout: 90_000, every: 400 }
    );
    metrics.commentApplyAndRecheckMs = now() - tApplyStart;

    // Wait for UI telemetry to reflect rev=1, gen=2 on Scene 1
    await page.waitForFunction(
      (prevChecks) => {
        const t = window.__plateLiveTelemetry;
        const d0 = t?.decisions?.[0];
        return Boolean(t && t.checksRun > prevChecks && d0 && d0.rev === 1 && d0.gen === 2 && d0.mode === "live");
      },
      checksBeforeComment,
      { timeout: 20_000 }
    );

    const postApplyTelemetry = await page.evaluate(() => window.__plateLiveTelemetry);
    assertCheck(
      revisedWait.value.state === "checked" &&
        postApplyTelemetry.decisions[0].rev === 1 &&
        postApplyTelemetry.decisions[0].gen === 2 &&
        postApplyTelemetry.checksRun > checksBeforeComment,
      "Apply comments produced a new revision (rev=1, gen=2) that PlateLiveStage checked and reloaded",
      `in ${metrics.commentApplyAndRecheckMs}ms, checksRun=${checksBeforeComment}->${postApplyTelemetry.checksRun}`
    );

    // 7. Forced-unsupported / unverified browser plays clips
    log("Opening forced-unverified browser page to verify clip fallback...");
    const fallbackPage = await context.newPage();
    try {
      const tFallbackStart = now();
      await fallbackPage.goto(
        `${nextOrigin}/dev/plate-preview-fixture?project=${encodeURIComponent(projectId)}&env=unverified`,
        { waitUntil: "domcontentloaded" }
      );

      await fallbackPage.waitForFunction(
        () => {
          const text = document.querySelector('[data-testid="dev-live-decisions"]')?.textContent ?? "";
          return text.includes("S1:clip(unverified-environment)");
        },
        { timeout: 20_000 }
      );

      const fallbackInitial = await fallbackPage.evaluate(() => ({
        decisions: document.querySelector('[data-testid="dev-live-decisions"]')?.textContent ?? "",
        iframes: document.querySelectorAll("iframe").length
      }));
      assertCheck(
        fallbackInitial.decisions.includes("S1:clip(unverified-environment)") && fallbackInitial.iframes === 0,
        "forced-unverified browser selects clip(unverified-environment) with 0 Worker iframes",
        fallbackInitial.decisions
      );

      // Wait for at least Scene 1's clip-request to be rendered by plate-worker so the fallback page plays its MP4 clip
      await waitFor(
        "Scene 1 fallback clip drawn by plate-worker",
        async () => {
          const rows = await variants(projectId);
          const s0 = rows.find((r) => r.scene_index === 0 && r.aspect === "16:9");
          return s0?.state === "drawn" && s0.clip_key ? s0 : false;
        },
        { timeout: 240_000, every: 1000 }
      );
      metrics.unverifiedFallbackClipDrawMs = now() - tFallbackStart;

      // Wait for fallbackPage to mount <video class="on"> for Scene 1 and play it
      await fallbackPage.waitForFunction(
        () => {
          const v = document.querySelector(".aw-canvas video.on");
          return Boolean(v && v.readyState >= 2);
        },
        { timeout: 30_000 }
      );

      await fallbackPage.locator("button.aw-play").click();
      await sleep(800);
      const videoPlaying = await fallbackPage.evaluate(() => {
        const v = document.querySelector(".aw-canvas video.on");
        return Boolean(v && (!v.paused || v.currentTime > 0));
      });
      assertCheck(
        videoPlaying,
        "forced-unverified browser plays the worker-drawn MP4 clip in <video class='on'>",
        `clipDrawMs=${metrics.unverifiedFallbackClipDrawMs}ms`
      );
    } finally {
      await fallbackPage.close();
    }

    // 8. Click Render on the live page and verify finished MP4 (Phase 2c draw-on-demand path)
    log("Clicking Render on PlatePreview and waiting for finished MP4...");
    const tRenderStart = now();
    await page.locator("button.aw-render-top").click();

    await page.waitForFunction(() => Boolean(window.__lastRenderJobId), { timeout: 15_000 });
    const renderJobId = await page.evaluate(() => window.__lastRenderJobId);
    assertCheck(Boolean(renderJobId), "clicking Render button starts render job", `jobId=${renderJobId}`);

    const renderReady = await waitFor(
      "final render job ready",
      async () => {
        const r = await api(`/v1/render-jobs/${renderJobId}`);
        if (r.json?.state === "failed") {
          throw new Error(`Render job failed: ${JSON.stringify(r.json?.error)}`);
        }
        return r.json?.state === "ready" ? r.json : false;
      },
      { timeout: 360_000, every: 1000 }
    );
    metrics.finalRenderMs = now() - tRenderStart;

    const redir = await redirectOf(`/v1/renders/${renderJobId}`);
    assertCheck(redir.status === 302 && Boolean(redir.location), "GET /v1/renders/:id redirects (302) to finished MP4");

    const mp4Path = await download(redir.location, join(tempDir, "phase3c-final.mp4"));
    const probe = ffprobe(mp4Path);
    const vStream = probe.streams.find((s) => s.codec_type === "video");
    const aStream = probe.streams.find((s) => s.codec_type === "audio");

    assertCheck(
      renderReady.value.state === "ready" &&
        vStream?.width === 1920 &&
        vStream?.height === 1080 &&
        Boolean(aStream) &&
        Number(vStream?.nb_read_packets) > 0,
      "Render produced a valid 1920x1080 MP4 with audio stream",
      `in ${metrics.finalRenderMs}ms, size=${vStream?.width}x${vStream?.height}, audio=${aStream?.codec_name}, frames=${vStream?.nb_read_packets}`
    );
    metrics.finalMp4Frames = Number(vStream?.nb_read_packets);

    await page.close();

    console.log(`\nSUMMARY: ${assertions.length}/${assertions.length} assertions passed.`);
    console.log("PHASE3C_E2E_METRICS_JSON:" + JSON.stringify(metrics));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stopNext();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    await pool.end().catch(() => {});
  }
}

await main();
