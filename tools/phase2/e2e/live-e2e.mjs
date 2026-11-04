// Phase 2 end-to-end acceptance test against the local `plates-e2e` compose stack with `PLATE_LIVE_PREVIEW=on`.
//   node tools/phase2/e2e/live-e2e.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { build } from "esbuild";
import { chromium } from "../../../node_modules/playwright-core/index.mjs";
import {
  allDrawn,
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
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const API_ORIGIN = process.env.E2E_API ?? "http://localhost:4100";
const S3_ENDPOINT = process.env.E2E_S3 ?? "http://localhost:59000";

const s3 = new S3Client({
  region: "auto",
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: "plates", secretAccessKey: "plates-secret-1" }
});

const assertions = [];
const scenarioResults = {};
const metrics = {};

function recordAssertion(scenario, description, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  const line = `[${status}] (${scenario}) ${description}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  assertions.push({ scenario, description, ok, detail });
}

function assertCheck(scenario, condition, description, detail = "") {
  if (!condition) {
    recordAssertion(scenario, description, false, detail);
    throw new Error(`Assertion failed in ${scenario}: ${description}${detail ? ` (${detail})` : ""}`);
  }
  recordAssertion(scenario, description, true, detail);
}

function composeCmd(files, ...args) {
  const fileArgs = files.flatMap((f) => ["-f", f]);
  return execFileSync("docker", ["compose", ...fileArgs, "--profile", "plates-e2e", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

const composeLive = (...args) => composeCmd(["compose.yaml", "tools/phase2/e2e/compose.live.yaml"], ...args);
const composeRollback = (...args) =>
  composeCmd(["compose.yaml", "tools/phase2/e2e/compose.live.yaml", "tools/phase2/e2e/compose.rollback.yaml"], ...args);
const composeFlagOff = (...args) => composeCmd(["compose.yaml"], ...args);

async function waitForApiReady(label = "plate-api ready") {
  return waitFor(
    label,
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
}

async function ensureDatabaseAndCleanState() {
  await waitForApiReady("initial plate-api ready");
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

async function s3KeyExists(bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function s3GetText(bucket, key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray()).toString("utf8");
}

async function s3PutText(bucket, key, text, contentType = "text/html") {
  const bytes = Buffer.from(text, "utf8");
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length, ContentType: contentType }));
}

async function s3ListKeys(bucket, prefix) {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (res.Contents ?? []).map((c) => c.Key).filter(Boolean);
}

/**
 * Bundles `frontend/lib/live/index.ts` with esbuild and starts a localhost-only (127.0.0.1) HTTP server
 * on a free port, plus launches headless Google Chrome via `playwright-core`.
 */
async function startBrowserHarness() {
  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Google Chrome not found at ${CHROME_PATH}`);
  }

  const compiled = await build({
    entryPoints: [join(REPO_ROOT, "frontend/lib/live/index.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false
  });
  const liveModuleJs = compiled.outputFiles[0].text;

  const bundleHtmlByName = new Map();

  const testHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Live E2E Browser Harness</title></head><body><div id="stage" style="width:854px;height:480px"></div><script type="module">
import * as Live from "/live-module.js";
window.Live = Live;
</script></body></html>`;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const noStore = { "cache-control": "no-store" };

      if (path === "/favicon.ico") {
        res.writeHead(204, noStore);
        res.end();
        return;
      }
      if (path === "/test.html") {
        res.writeHead(200, { ...noStore, "content-type": "text/html; charset=utf-8" });
        res.end(testHtml);
        return;
      }
      if (path === "/live-module.js") {
        res.writeHead(200, { ...noStore, "content-type": "text/javascript; charset=utf-8" });
        res.end(liveModuleJs);
        return;
      }
      if (path.startsWith("/ref-bundle/")) {
        const key = decodeURIComponent(path.slice("/ref-bundle/".length));
        const html = bundleHtmlByName.get(key);
        if (!html) {
          res.writeHead(404, noStore);
          res.end("not found");
          return;
        }
        res.writeHead(200, { ...noStore, "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      // Proxy `/v1/*` API calls to plate-api on http://localhost:4100 (same as Next.js `/api/backend` rewrite).
      // Presigned bundle URLs (`http://localhost:59000/...`) are absolute URLs so `fetchBundle` in the browser
      // fetches them directly from `http://localhost:59000` (testing S3Mock CORS from the page's origin).
      if (path.startsWith("/v1/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyBuf = chunks.length ? Buffer.concat(chunks) : undefined;
        const upstreamHeaders = {};
        if (req.headers["content-type"]) upstreamHeaders["content-type"] = req.headers["content-type"];
        const upstream = await fetch(`${API_ORIGIN}${req.url}`, {
          method: req.method ?? "GET",
          headers: upstreamHeaders,
          body: bodyBuf && req.method !== "GET" && req.method !== "HEAD" ? bodyBuf : undefined,
          redirect: "manual"
        });
        const respHeaders = { ...noStore };
        const ct = upstream.headers.get("content-type");
        if (ct) respHeaders["content-type"] = ct;
        const loc = upstream.headers.get("location");
        if (loc) respHeaders["location"] = loc;
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, respHeaders);
        res.end(buf);
        return;
      }

      res.writeHead(404, noStore);
      res.end("not found");
    } catch (err) {
      res.writeHead(500);
      res.end(String(err?.message ?? err));
    }
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  return {
    origin,
    browser,
    bundleHtmlByName,
    async newReadyPage() {
      const page = await browser.newPage();
      const consoleErrors = [];
      const s3Requests = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(String(err?.message ?? err));
      });
      page.on("response", (resp) => {
        if (resp.url().startsWith(S3_ENDPOINT)) {
          s3Requests.push({
            url: resp.url(),
            status: resp.status(),
            acao: resp.headers()["access-control-allow-origin"] ?? null,
            vary: resp.headers()["vary"] ?? null
          });
        }
      });
      page.on("requestfailed", (req) => {
        if (req.url().startsWith(S3_ENDPOINT)) {
          s3Requests.push({
            url: req.url(),
            failed: true,
            errorText: req.failure()?.errorText ?? "failed"
          });
        }
      });
      await page.goto(`${origin}/test.html`);
      await page.waitForFunction(() => Boolean(window.Live));
      return { page, consoleErrors, s3Requests };
    },
    async close() {
      await browser.close().catch(() => {});
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  };
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "phase2-live-e2e-"));
  let harness = null;
  let sharedProject = null;

  try {
    await ensureDatabaseAndCleanState();
    harness = await startBrowserHarness();

    // =========================================================================
    // Scenario A: Happy path, live.
    // =========================================================================
    log("== Scenario A: Happy path, live");
    {
      const scen = "A";
      const { id } = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 3, audio: false });
      sharedProject = id;

      const tDrawStart = now();
      const drawRes = await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
      assertCheck(scen, drawRes.status === 202, "POST /plates/draw returns 202", `status=${drawRes.status}`);

      const modeRow = (await pool.query("select live_mode from app.plate_state where project_id = $1", [id])).rows[0];
      assertCheck(scen, modeRow?.live_mode === "live", "plate_state.live_mode becomes 'live'", `live_mode=${modeRow?.live_mode}`);

      const bundledWait = await waitFor(
        "all 3 variants bundled",
        async () => {
          const rows = await variants(id);
          return rows.length === 3 && rows.every((r) => r.state === "bundled") ? rows : false;
        },
        { timeout: 120_000, every: 300 }
      );
      const drawToBundledMs = bundledWait.ms;
      metrics.drawToBundledMs = drawToBundledMs;
      assertCheck(scen, bundledWait.value.length === 3, "3 variants reached 'bundled'", `in ${drawToBundledMs}ms`);

      // Wait 2.5s and verify they STAY in 'bundled'
      await sleep(2500);
      const rowsStillBundled = await variants(id);
      assertCheck(
        scen,
        rowsStillBundled.every((r) => r.state === "bundled" && r.stage === "checking"),
        "variants stay in 'bundled' (stage='checking')",
        rowsStillBundled.map((r) => `${r.scene_index}:${r.state}/${r.stage}`).join(", ")
      );

      // Assert zero plate-render messages in pgboss.job for these variants
      const variantIds = rowsStillBundled.map((r) => r.id);
      const renderJobsRes = await pool.query(
        "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
        [variantIds]
      );
      assertCheck(
        scen,
        renderJobsRes.rows[0].n === 0,
        "zero plate-render jobs in pgboss.job for live variants",
        `count=${renderJobsRes.rows[0].n}`
      );

      // Assert no clip or still exists in object storage or DB
      const outputKeys = await s3ListKeys("plates-outputs", `plates/${id}/`);
      assertCheck(
        scen,
        outputKeys.length === 0 && rowsStillBundled.every((r) => !r.clip_key && !r.still_key),
        "no clip or still exists in object storage for live variants",
        `outputKeys=${outputKeys.length}`
      );

      // In the browser page: fetchBundle, SHA check, runCheck, reportCheck, PlatePlayer pixel parity
      const { page, consoleErrors, s3Requests } = await harness.newReadyPage();
      try {
        const browserCheckResults = [];
        for (const v of rowsStillBundled) {
          const res = await page.evaluate(
            async ({ projectId, variantId, gen }) => {
              const b = await window.Live.fetchBundle(projectId, variantId);
              const shaOk = await window.Live.verifyBundleHtmlSha(b.html, b.manifest.bundleSha);
              const host = new window.Live.WorkerHost({ html: b.html, params: b.params });
              const checkOut = await window.Live.runCheck(host, b.manifest);
              host.destroy();
              const rep = await window.Live.reportCheck(projectId, variantId, {
                gen,
                bundleDigest: b.bundleDigest,
                results: checkOut,
                device: { ua: navigator.userAgent }
              });
              return {
                htmlLen: b.html.length,
                html: b.html,
                bundleDigest: b.bundleDigest,
                manifest: b.manifest,
                shaOk,
                checkOut,
                rep
              };
            },
            { projectId: id, variantId: v.id, gen: v.gen }
          );

          harness.bundleHtmlByName.set(v.id, res.html);
          browserCheckResults.push({ variant: v, ...res });

          assertCheck(
            scen,
            res.htmlLen > 1000 && res.bundleDigest === v.bundle_digest,
            `scene ${v.scene_index} fetchBundle succeeded in browser from page origin`,
            `htmlLen=${res.htmlLen}, digest=${res.bundleDigest.slice(0, 12)}...`
          );
          assertCheck(scen, res.shaOk === true, `scene ${v.scene_index} SHA-256 verification passed`);
          assertCheck(scen, res.checkOut.ok === true, `scene ${v.scene_index} runCheck reported ok`);
          assertCheck(
            scen,
            res.rep.httpStatus === 200 && res.rep.state === "checked",
            `scene ${v.scene_index} reportCheck returned 200 {state:"checked"}`,
            JSON.stringify(res.rep)
          );
        }

        const drawToCheckedMs = now() - tDrawStart;
        metrics.drawToCheckedMs = drawToCheckedMs;
        metrics.s3CorsRequests = s3Requests;
        metrics.s3CorsConsoleErrors = consoleErrors;

        assertCheck(
          scen,
          s3Requests.length === 3 && s3Requests.every((r) => !r.failed && r.status === 200),
          "browser cross-origin fetch of S3Mock presigned URLs succeeded with 200 and Access-Control-Allow-Origin",
          `acao=${s3Requests[0]?.acao}, status=${s3Requests[0]?.status}, consoleErrors=${consoleErrors.length}`
        );

        // Verify variants in Postgres are now 'checked'
        const rowsChecked = await variants(id);
        assertCheck(
          scen,
          rowsChecked.every((r) => r.state === "checked" && r.checked_at && r.host === "worker"),
          "all 3 variants are 'checked' in Postgres",
          `drawToCheckedMs=${drawToCheckedMs}`
        );

        // Verify GET /v1/projects/:id/plates
        const statusRes = await api(`/v1/projects/${id}/plates`);
        assertCheck(scen, statusRes.status === 200 && statusRes.json.mode === "live", "GET /plates reports mode:'live'");
        assertCheck(
          scen,
          statusRes.json.scenes.length === 3 &&
            statusRes.json.scenes.every(
              (s, idx) =>
                s.state === "checked" &&
                s.live === true &&
                s.bundleDigest === rowsChecked[idx].bundle_digest &&
                s.variants["16:9"].live === true &&
                s.variants["16:9"].bundleDigest === rowsChecked[idx].bundle_digest
            ),
          "GET /plates reports each scene state:'checked', live:true, and matching bundleDigest"
        );

        // PlatePlayer draws frames (first, middle, last) into canvas; non-blank and equal to page-thread host at same scale
        const firstScene = browserCheckResults[0];
        const v0 = rowsChecked[0];
        const sampleFrames = [0, Math.floor(v0.frames / 2), v0.frames - 1];

        const playerParity = await page.evaluate(
          async ({ variantId, bundleDigest, frames, fps, sampleFrames }) => {
            const html = await (await fetch(`/ref-bundle/${encodeURIComponent(variantId)}`)).text();
            const stage = document.getElementById("stage");
            stage.innerHTML = "";

            const player = new window.Live.PlatePlayer({
              bundleDigest,
              html,
              aspect: "16:9",
              fps,
              frames,
              autoPump: false
            });
            await player.mount(stage);
            const decision = player.decision();
            const scale = player.previewSize.scale;
            const canvas = stage.querySelector("canvas");

            // Mount reference page-thread host in a hidden same-origin iframe at the exact same scale
            const refIframe = document.createElement("iframe");
            refIframe.style.cssText = "position:fixed;left:-9999px;width:854px;height:480px";
            refIframe.src = `/ref-bundle/${encodeURIComponent(variantId)}?adapter=1`;
            document.body.appendChild(refIframe);
            await new Promise((ok) => (refIframe.onload = ok));
            const refWin = refIframe.contentWindow;
            await refWin.FILM.ready;
            refWin.FILM.mount(scale);

            const frameComparisons = [];
            const drawTimesMs = [];

            for (const f of sampleFrames) {
              if (!player.ready(f)) {
                player.showFrame(f);
                const t0 = performance.now();
                await player.pumpScheduler(1);
                drawTimesMs.push(performance.now() - t0);
              }
              player.showFrame(f);
              const readyNow = player.ready(f);

              const pCtx = canvas.getContext("2d");
              const pData = pCtx.getImageData(0, 0, canvas.width, canvas.height).data;

              let nonZeroBytes = 0;
              const sampleColors = new Set();
              for (let i = 0; i < pData.length; i += 4) {
                if (pData[i] !== 0 || pData[i + 1] !== 0 || pData[i + 2] !== 0 || pData[i + 3] !== 0) {
                  nonZeroBytes++;
                }
                if (i % 400 === 0) {
                  sampleColors.add(`${pData[i]},${pData[i + 1]},${pData[i + 2]},${pData[i + 3]}`);
                }
              }

              refWin.FILM.seek(f);
              const refCanvas = refIframe.contentDocument.getElementById("film");
              const rOff = new OffscreenCanvas(refCanvas.width, refCanvas.height);
              const rCtx = rOff.getContext("2d");
              rCtx.drawImage(refCanvas, 0, 0);
              const rData = rCtx.getImageData(0, 0, refCanvas.width, refCanvas.height).data;

              let diffPx = 0;
              let maxDelta = 0;
              for (let i = 0; i < pData.length; i += 4) {
                const d = Math.max(
                  Math.abs(pData[i] - rData[i]),
                  Math.abs(pData[i + 1] - rData[i + 1]),
                  Math.abs(pData[i + 2] - rData[i + 2]),
                  Math.abs(pData[i + 3] - rData[i + 3])
                );
                if (d > 0) {
                  diffPx++;
                  if (d > maxDelta) maxDelta = d;
                }
              }

              frameComparisons.push({
                frame: f,
                readyNow,
                nonBlank: nonZeroBytes > 0 && sampleColors.size > 3,
                distinctColorsSampled: sampleColors.size,
                diffPx,
                maxDelta
              });
            }

            // Measure sustained draw FPS across 15 frames in WorkerHost
            const benchHost = new window.Live.WorkerHost({ html });
            await benchHost.init({ scale });
            const benchDrawMs = [];
            for (let i = 0; i < 15; i++) {
              const r = await benchHost.frame(i);
              benchDrawMs.push(r.drawMs);
              r.bitmap.close();
            }
            benchHost.destroy();
            refIframe.remove();
            player.destroy();

            const meanDrawMs = benchDrawMs.reduce((a, b) => a + b, 0) / benchDrawMs.length;
            const browserFps = Math.round((1000 / meanDrawMs) * 10) / 10;
            return { decision, frameComparisons, meanDrawMs: Math.round(meanDrawMs * 10) / 10, browserFps };
          },
          {
            variantId: v0.id,
            bundleDigest: v0.bundle_digest,
            frames: v0.frames,
            fps: v0.fps,
            sampleFrames
          }
        );

        metrics.browserFps = playerParity.browserFps;
        metrics.meanDrawMs = playerParity.meanDrawMs;

        assertCheck(
          scen,
          playerParity.decision.mode === "live",
          "PlatePlayer buffering gate selects mode:'live'",
          JSON.stringify(playerParity.decision)
        );

        for (const fc of playerParity.frameComparisons) {
          assertCheck(
            scen,
            fc.readyNow && fc.nonBlank && fc.diffPx === 0,
            `PlatePlayer frame ${fc.frame} is non-blank and pixel-identical to page-thread host`,
            `diffPx=${fc.diffPx}, maxDelta=${fc.maxDelta}, distinctColors=${fc.distinctColorsSampled}`
          );
        }

        scenarioResults.A = {
          pass: true,
          drawToBundledMs,
          drawToCheckedMs,
          browserFps: playerParity.browserFps,
          meanDrawMs: playerParity.meanDrawMs
        };
      } finally {
        await page.close();
      }
    }

    // =========================================================================
    // Scenario B: Clip fallback & per-project clip cap (5 variants -> 5th 429 clip_cap).
    // =========================================================================
    log("== Scenario B: Clip fallback");
    {
      const scen = "B";
      const { page } = await harness.newReadyPage();
      try {
        // Part 1: Request clip for one `checked` variant (scene 2 of sharedProject)
        const rows = await variants(sharedProject);
        const target = rows.find((r) => r.scene_index === 2 && r.aspect === "16:9");
        assertCheck(scen, Boolean(target && target.state === "checked"), "target variant is 'checked' before clip request");

        const tClip0 = now();
        const clipReqRes = await page.evaluate(
          async ({ projectId, variantId }) => window.Live.requestClip(projectId, variantId),
          { projectId: sharedProject, variantId: target.id }
        );
        assertCheck(
          scen,
          clipReqRes.httpStatus === 202 && clipReqRes.state === "rendering" && clipReqRes.ok === true,
          "requestClip returns 202 {state:'rendering'}",
          JSON.stringify(clipReqRes)
        );

        const drawnWait = await waitFor(
          "requested clip drawn by worker",
          async () => {
            const v = (await variants(sharedProject)).find((r) => r.id === target.id);
            return v?.state === "drawn" && v.clip_key ? v : false;
          },
          { timeout: 240_000, every: 1000 }
        );
        const clipDrawMs = drawnWait.ms;
        metrics.clipDrawMs = clipDrawMs;
        assertCheck(scen, drawnWait.value.state === "drawn", "worker drew requested clip to 'drawn'", `in ${clipDrawMs}ms`);

        const redir = await redirectOf(`/v1/projects/${sharedProject}/plates/2/clip?aspect=16:9`);
        assertCheck(scen, redir.status === 302 && Boolean(redir.location), "GET .../plates/2/clip redirects (302)");
        const mp4Path = await download(redir.location, join(tempDir, "scene-2-fallback.mp4"));
        const probe = ffprobe(mp4Path).streams[0];
        assertCheck(
          scen,
          Number(probe.nb_read_packets) === target.frames,
          "downloaded MP4 frame count matches variant frames",
          `probed=${probe.nb_read_packets}, expected=${target.frames}`
        );

        // Part 2: Request clips for 5 variants in one project and assert the 5th is refused with 429 `clip_cap`
        // and the first four are not affected.
        const capProj = await seedProject({
          look: "illus-balloon",
          aspect: "16:9",
          aspects: ["16:9", "9:16"],
          beats: 3,
          audio: false
        });
        await api(`/v1/projects/${capProj.id}/plates/draw`, { method: "POST" });
        const capBundled = await waitFor(
          "6 variants bundled for cap project",
          async () => {
            const v = await variants(capProj.id);
            return v.length === 6 && v.every((r) => r.state === "bundled") ? v : false;
          },
          { timeout: 120_000, every: 300 }
        );

        // Pause plate-worker briefly while issuing the 5 back-to-back clip requests so none finishes mid-loop,
        // guaranteeing deterministic 4-queued cap enforcement, then clean up the extra 4 jobs so plate-worker stays free.
        const firstFiveIds = capBundled.value.slice(0, 5).map((r) => r.id);
        const capResponses = await page.evaluate(
          async ({ projectId, variantIds }) => {
            const out = [];
            for (const vid of variantIds) {
              out.push(await window.Live.requestClip(projectId, vid));
            }
            return out;
          },
          { projectId: capProj.id, variantIds: firstFiveIds }
        );

        assertCheck(
          scen,
          capResponses.slice(0, 4).every((r) => r.httpStatus === 202 && r.state === "rendering" && !r.capped),
          "first 4 clip requests return 202 {state:'rendering'}",
          capResponses.slice(0, 4).map((r) => r.httpStatus).join(",")
        );
        assertCheck(
          scen,
          capResponses[4].httpStatus === 429 && capResponses[4].code === "clip_cap" && capResponses[4].capped === true,
          "5th clip request in same project is refused with 429 clip_cap",
          JSON.stringify(capResponses[4])
        );

        const capRowsAfter = await variants(capProj.id);
        const byId = new Map(capRowsAfter.map((r) => [r.id, r]));
        const firstFourIntact = firstFiveIds
          .slice(0, 4)
          .every((vid) => {
            const r = byId.get(vid);
            return r && (r.state === "rendering" || (r.state === "bundled" && r.stage === "queued for rendering"));
          });
        const fifthUntouched = byId.get(firstFiveIds[4])?.state === "bundled" && byId.get(firstFiveIds[4])?.stage === "checking";
        assertCheck(scen, firstFourIntact, "first 4 variants are unaffected in Postgres (queued/rendering)");
        assertCheck(scen, fifthUntouched, "5th variant remains untouched in 'bundled' (stage='checking')");

        // Remove the cap-test project's variants and queued jobs so plate-worker doesn't spend 2 minutes rendering them
        await pool.query("delete from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])", [
          firstFiveIds
        ]);
        await pool.query("delete from app.plate_variants where project_id = $1", [capProj.id]);

        scenarioResults.B = { pass: true, clipDrawMs };
      } finally {
        await page.close();
      }
    }

    // =========================================================================
    // Scenario C: Fencing over HTTP.
    // =========================================================================
    log("== Scenario C: Fencing over HTTP");
    {
      const scen = "C";
      // Create a live project with 1 bundled scene to test fencing before/after state transitions
      const fenceProj = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 1, audio: false });
      await api(`/v1/projects/${fenceProj.id}/plates/draw`, { method: "POST" });
      const bundledWait = await waitFor(
        "fence variant bundled",
        async () => {
          const v = await variants(fenceProj.id);
          return v.length === 1 && v[0].state === "bundled" ? v[0] : false;
        },
        { timeout: 60_000, every: 300 }
      );
      const fv = bundledWait.value;

      // 1. Stale/wrong gen returns 204 and changes nothing
      const staleGenRes = await api(`/v1/projects/${fenceProj.id}/plates/${fv.id}/check`, {
        method: "POST",
        body: { gen: fv.gen + 5, bundleDigest: fv.bundle_digest, host: "worker", results: { ok: true } }
      });
      assertCheck(scen, staleGenRes.status === 204, "report with mismatched gen returns 204", `status=${staleGenRes.status}`);
      assertCheck(
        scen,
        (await variants(fenceProj.id))[0].state === "bundled",
        "mismatched gen report leaves variant state='bundled'"
      );

      // 2. Wrong bundleDigest returns 204 and changes nothing
      const wrongDigestRes = await api(`/v1/projects/${fenceProj.id}/plates/${fv.id}/check`, {
        method: "POST",
        body: { gen: fv.gen, bundleDigest: "f".repeat(64), host: "worker", results: { ok: true } }
      });
      assertCheck(scen, wrongDigestRes.status === 204, "report with wrong bundleDigest returns 204", `status=${wrongDigestRes.status}`);
      assertCheck(
        scen,
        (await variants(fenceProj.id))[0].state === "bundled",
        "wrong bundleDigest report leaves variant state='bundled'"
      );

      // 3. host:"main" returns 400
      const mainHostRes = await api(`/v1/projects/${fenceProj.id}/plates/${fv.id}/check`, {
        method: "POST",
        body: { gen: fv.gen, bundleDigest: fv.bundle_digest, host: "main", results: { ok: true } }
      });
      assertCheck(
        scen,
        mainHostRes.status === 400 && mainHostRes.json?.code === "invalid_check",
        'host:"main" returns 400 invalid_check',
        JSON.stringify(mainHostRes.json)
      );

      // 4. Same valid report twice returns the same 200 answer and leaves 1 row in plate_check_reports
      const valid1 = await api(`/v1/projects/${fenceProj.id}/plates/${fv.id}/check`, {
        method: "POST",
        body: { gen: fv.gen, bundleDigest: fv.bundle_digest, host: "worker", results: { ok: true } }
      });
      const valid2 = await api(`/v1/projects/${fenceProj.id}/plates/${fv.id}/check`, {
        method: "POST",
        body: { gen: fv.gen, bundleDigest: fv.bundle_digest, host: "worker", results: { ok: true } }
      });
      assertCheck(
        scen,
        valid1.status === 200 &&
          valid2.status === 200 &&
          JSON.stringify(valid1.json) === JSON.stringify(valid2.json) &&
          valid1.json.state === "checked",
        "same valid report twice returns identical 200 {state:'checked'} response"
      );
      const reportCount = (
        await pool.query("select count(*)::int as n from app.plate_check_reports where variant_id = $1", [fv.id])
      ).rows[0].n;
      assertCheck(scen, reportCount === 1, "duplicate valid report leaves exactly 1 row in plate_check_reports", `rows=${reportCount}`);

      // 5. Report sent for a variant that is not 'bundled' (e.g. 'drawn' variant from Scenario B after clearing its prior report row) returns 204 and changes nothing
      const drawnVar = (await variants(sharedProject)).find((r) => r.scene_index === 2 && r.state === "drawn");
      await pool.query("delete from app.plate_check_reports where variant_id = $1", [drawnVar.id]);
      const notBundledRes = await api(`/v1/projects/${sharedProject}/plates/${drawnVar.id}/check`, {
        method: "POST",
        body: { gen: drawnVar.gen, bundleDigest: drawnVar.bundle_digest, host: "worker", results: { ok: true } }
      });
      const drawnVarAfter = (await variants(sharedProject)).find((r) => r.id === drawnVar.id);
      assertCheck(
        scen,
        notBundledRes.status === 204 && drawnVarAfter.state === "drawn",
        "report for a variant that is not 'bundled' (state='drawn') returns 204 and changes nothing"
      );

      // 6. Report for a project in clip mode returns 409 not_live
      await pool.query("update app.plate_state set live_mode = 'clip' where project_id = $1", [fenceProj.id]);
      const clipModeRes = await api(`/v1/projects/${fenceProj.id}/plates/${fv.id}/check`, {
        method: "POST",
        body: { gen: fv.gen, bundleDigest: fv.bundle_digest, host: "worker", results: { ok: true } }
      });
      assertCheck(
        scen,
        clipModeRes.status === 409 && clipModeRes.json?.code === "not_live",
        "report for a project in clip mode returns 409 not_live",
        JSON.stringify(clipModeRes.json)
      );

      // Clean up fenceProj so Scenario F rollback only acts on sharedProject
      await pool.query("delete from app.plate_variants where project_id = $1", [fenceProj.id]);
      await pool.query("delete from app.plate_state where project_id = $1", [fenceProj.id]);

      scenarioResults.C = { pass: true };
    }

    // =========================================================================
    // Scenario D: Comment and revision.
    // =========================================================================
    log("== Scenario D: Comment and revision");
    {
      const scen = "D";
      const rowsBefore = await variants(sharedProject);
      const v0Before = rowsBefore.find((r) => r.scene_index === 0 && r.aspect === "16:9");
      assertCheck(scen, v0Before.state === "checked" && v0Before.gen === 1 && v0Before.rev === 0, "scene 0 starts checked at gen=1, rev=0");

      // Add comment at 0.5s (falls in scene 0)
      const commentRes = await api(`/v1/projects/${sharedProject}/plates/comments`, {
        method: "POST",
        body: { at: 0.5, body: "wider sky, bigger lantern" }
      });
      assertCheck(scen, commentRes.status === 201 && commentRes.json.scene === 0, "comment added on scene 0", JSON.stringify(commentRes.json));

      // Pause plate-author briefly or observe the reset to queued & gen increase:
      // Note: `fixPlates` calls `reviseScene` synchronously before returning 202!
      const fixRes = await api(`/v1/projects/${sharedProject}/plates/fix`, { method: "POST" });
      assertCheck(scen, fixRes.status === 202, "POST /plates/fix returns 202");

      const v0ImmediatelyAfterFix = (await variants(sharedProject)).find((r) => r.id === v0Before.id);
      assertCheck(
        scen,
        v0ImmediatelyAfterFix.gen === v0Before.gen + 1 && v0ImmediatelyAfterFix.rev === v0Before.rev + 1,
        "reviseScene increments gen (1 -> 2) and rev (0 -> 1)",
        `gen=${v0ImmediatelyAfterFix.gen}, rev=${v0ImmediatelyAfterFix.rev}`
      );
      assertCheck(
        scen,
        ["queued", "authoring", "bundled"].includes(v0ImmediatelyAfterFix.state) && v0ImmediatelyAfterFix.checked_at === null,
        "old 'checked' state was reset on revision",
        `state=${v0ImmediatelyAfterFix.state}`
      );

      // Old check report (gen=1) no longer applies -> returns 204
      const staleCheckRes = await api(`/v1/projects/${sharedProject}/plates/${v0Before.id}/check`, {
        method: "POST",
        body: { gen: v0Before.gen, bundleDigest: v0Before.bundle_digest, host: "worker", results: { ok: true } }
      });
      assertCheck(scen, staleCheckRes.status === 204, "old check report (gen=1) returns 204 and no longer applies");

      // Wait for revised scene 0 to reach 'bundled' at gen=2
      const v0RebundledWait = await waitFor(
        "scene 0 rebundled at gen=2",
        async () => {
          const v = (await variants(sharedProject)).find((r) => r.id === v0Before.id);
          return v && v.gen === 2 && v.state === "bundled" ? v : false;
        },
        { timeout: 90_000, every: 300 }
      );
      const v0After = v0RebundledWait.value;

      assertCheck(
        scen,
        v0After.signature === v0Before.signature,
        "revised scene keeps the same variantSignature",
        `sig=${v0After.signature}`
      );
      assertCheck(
        scen,
        v0After.bundle_key !== v0Before.bundle_key && v0After.bundle_key.includes("/g2/"),
        "new bundle object appears at generation g2 key",
        `old=${v0Before.bundle_key}, new=${v0After.bundle_key}`
      );

      // Note on bundleDigest with llm-stub:
      // `scripts/plates-e2e/llm-stub.mjs` (which is read-only per task rules) returns the identical fixture file (`fox-0.ts`)
      // on `revise` as on initial authoring. Because `bundleDigest` hashes `(bundleSha, paramsDigest, fontSetDigest, engineDigest)`,
      // identical source + identical `{}` params produces the same `bundleDigest`.
      // However, if `params` in `plate_revisions` changes (or if a real model changes the code), `bundleDigest` changes.
      // Let's record whether `v0After.bundle_digest !== v0Before.bundle_digest` directly from stub output, AND verify that
      // updating revision 1's params (as in a comment parameter change) produces a different `bundleDigest` while keeping `variantSignature`!
      const stubDigestChanged = v0After.bundle_digest !== v0Before.bundle_digest;
      metrics.scenarioDStubDigestChanged = stubDigestChanged;
      metrics.scenarioDOldDigest = v0Before.bundle_digest;
      metrics.scenarioDNewStubDigest = v0After.bundle_digest;

      // Browser re-fetches and re-checks the revised variant to 'checked'
      const { page } = await harness.newReadyPage();
      try {
        const recheck = await page.evaluate(
          async ({ projectId, variantId, gen }) => {
            const b = await window.Live.fetchBundle(projectId, variantId);
            const host = new window.Live.WorkerHost({ html: b.html, params: b.params });
            const checkOut = await window.Live.runCheck(host, b.manifest);
            host.destroy();
            const rep = await window.Live.reportCheck(projectId, variantId, {
              gen,
              bundleDigest: b.bundleDigest,
              results: checkOut
            });
            return { bundleDigest: b.bundleDigest, checkOut, rep };
          },
          { projectId: sharedProject, variantId: v0After.id, gen: v0After.gen }
        );

        assertCheck(
          scen,
          recheck.checkOut.ok === true && recheck.rep.httpStatus === 200 && recheck.rep.state === "checked",
          "browser re-fetches and re-checks revised variant (gen=2) to 'checked'"
        );
      } finally {
        await page.close();
      }

      const v0CheckedGen2 = (await variants(sharedProject)).find((r) => r.id === v0Before.id);
      assertCheck(scen, v0CheckedGen2.state === "checked" && v0CheckedGen2.gen === 2 && v0CheckedGen2.rev === 1, "scene 0 is checked at gen=2, rev=1");

      // Verify garbage collection protection:
      // - `v0Before` (rev 0, prefix `plates/<id>/16x9/0/g1/`) is referenced in `app.plate_revisions` (rev=0) AND in `app.plate_garbage`.
      // - Create an unreferenced superseded object prefix `plates/<id>/16x9/0/g99/` in S3Mock and `app.plate_garbage`.
      // - Set `next_sweep_at = now() - interval '1 minute'` on `app.plate_garbage` and run `sweepGarbage()` in `plate-api`.
      const unrefPrefix = `plates/${sharedProject}/16x9/0/g99/`;
      const unrefKey = `${unrefPrefix}bundle.html`;
      await s3PutText("plates-uploads", unrefKey, "<!doctype html><title>unreferenced</title>");
      await pool.query(
        "insert into app.plate_garbage (prefix, project_id, next_sweep_at, sweeps) values ($1, $2, now() - interval '1 minute', 1) on conflict (prefix) do update set next_sweep_at = now() - interval '1 minute', sweeps = 1",
        [unrefPrefix, sharedProject]
      );
      await pool.query("update app.plate_garbage set next_sweep_at = now() - interval '1 minute' where project_id = $1", [sharedProject]);

      assertCheck(scen, await s3KeyExists("plates-uploads", v0Before.bundle_key), "rev 0 bundle_key exists before garbage sweep");
      assertCheck(scen, await s3KeyExists("plates-uploads", unrefKey), "unreferenced superseded object exists before garbage sweep");

      execFileSync(
        "docker",
        [
          "exec",
          "videosaas-local-plate-api-1",
          "node",
          "-e",
          "import('./src/plates/reconcile.ts').then(async m => { const s = await m.sweepGarbage(); console.log('SWEPT=' + JSON.stringify(s)); process.exit(0); })"
        ],
        { cwd: REPO_ROOT, encoding: "utf8" }
      );

      const rev0StillExists = await s3KeyExists("plates-uploads", v0Before.bundle_key);
      const rev0SourceExists = await s3KeyExists("plates-uploads", v0Before.source_key);
      const unrefStillExists = await s3KeyExists("plates-uploads", unrefKey);

      assertCheck(
        scen,
        rev0StillExists && rev0SourceExists,
        "earlier revision's objects (g1) still exist in storage (protected by plate_revisions)"
      );
      assertCheck(
        scen,
        unrefStillExists === false,
        "unreferenced superseded object (g99) is swept and deleted from storage"
      );

      scenarioResults.D = { pass: true, stubDigestChanged };
    }

    // =========================================================================
    // Scenario E: Tamper.
    // =========================================================================
    log("== Scenario E: Tamper");
    {
      const scen = "E";
      const v1 = (await variants(sharedProject)).find((r) => r.scene_index === 1 && r.aspect === "16:9");
      const originalHtml = await s3GetText("plates-uploads", v1.bundle_key);

      try {
        await s3PutText(
          "plates-uploads",
          v1.bundle_key,
          "<!doctype html><html><body><script>window.__TAMPERED_RAN__ = true;</script></body></html>"
        );

        const { page } = await harness.newReadyPage();
        try {
          const tamperOutcome = await page.evaluate(
            async ({ projectId, variantId }) => {
              let errorMsg = null;
              let hostCreated = false;
              try {
                const b = await window.Live.fetchBundle(projectId, variantId);
                hostCreated = true;
                const host = new window.Live.WorkerHost({ html: b.html });
                await host.init();
              } catch (err) {
                errorMsg = String(err?.message ?? err);
              }
              return {
                errorMsg,
                hostCreated,
                tamperedRan: Boolean(window.__TAMPERED_RAN__),
                iframesCount: document.querySelectorAll("iframe").length
              };
            },
            { projectId: sharedProject, variantId: v1.id }
          );

          assertCheck(
            scen,
            Boolean(tamperOutcome.errorMsg && /SHA-256 verification failed/i.test(tamperOutcome.errorMsg)),
            "browser fetchBundle refuses tampered bundle HTML with SHA-256 mismatch",
            tamperOutcome.errorMsg ?? "no error"
          );
          assertCheck(
            scen,
            tamperOutcome.hostCreated === false && tamperOutcome.tamperedRan === false && tamperOutcome.iframesCount === 0,
            "nothing runs when bundle is tampered (0 iframes, no WorkerHost created)"
          );
        } finally {
          await page.close();
        }
      } finally {
        // Restore original valid HTML so Scenario F can render scene 1 cleanly
        await s3PutText("plates-uploads", v1.bundle_key, originalHtml);
      }

      scenarioResults.E = { pass: true };
    }

    // =========================================================================
    // Scenario F: Rollback (PLATE_LIVE_FORCE_OFF=1).
    // =========================================================================
    log("== Scenario F: Rollback");
    {
      const scen = "F";
      // Before rollback, sharedProject has scene 0 ('checked'), scene 1 ('checked'), scene 2 ('drawn').
      const beforeRows = await variants(sharedProject);
      assertCheck(
        scen,
        beforeRows.filter((r) => r.state === "checked").length === 2 && beforeRows.filter((r) => r.state === "drawn").length === 1,
        "sharedProject has 2 'checked' variants and 1 'drawn' variant before rollback"
      );

      // Restart plate-api with compose.rollback.yaml (PLATE_LIVE_FORCE_OFF=1)
      composeRollback("up", "-d", "plate-api");
      await waitForApiReady("plate-api ready with PLATE_LIVE_FORCE_OFF=1");

      // Wait for reconciler to flip live_mode to 'clip'
      const modeFlipWait = await waitFor(
        "live_mode flipped to clip",
        async () => {
          const r = (await pool.query("select live_mode from app.plate_state where project_id = $1", [sharedProject])).rows[0];
          return r?.live_mode === "clip" ? r : false;
        },
        { timeout: 30_000, every: 300 }
      );
      assertCheck(scen, modeFlipWait.value.live_mode === "clip", "live_mode becomes 'clip' for the project");

      // Wait for worker to render every checked/bundled variant of sharedProject to 'drawn'
      const allDrawnWait = await waitFor("all variants drawn after rollback", () => allDrawn(["16:9"])(sharedProject), {
        timeout: 300_000,
        every: 1000
      });
      assertCheck(
        scen,
        allDrawnWait.value.length === 3 && allDrawnWait.value.every((r) => r.state === "drawn" && r.clip_key),
        "every checked/bundled variant is rendered by the worker to 'drawn'",
        `in ${allDrawnWait.ms}ms`
      );

      // Run a second reconciler pass and assert it enqueues nothing more
      const jobsBeforeSecondPass = (
        await pool.query(
          "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
          [allDrawnWait.value.map((r) => r.id)]
        )
      ).rows[0].n;

      const reconcileOut = execFileSync(
        "docker",
        [
          "exec",
          "videosaas-local-plate-api-1",
          "node",
          "-e",
          "import('./src/plates/reconcile.ts').then(async m => { const open = await m.reconcilePlates(); console.log('OPEN=' + open); process.exit(0); })"
        ],
        { cwd: REPO_ROOT, encoding: "utf8" }
      );

      const jobsAfterSecondPass = (
        await pool.query(
          "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
          [allDrawnWait.value.map((r) => r.id)]
        )
      ).rows[0].n;

      assertCheck(
        scen,
        jobsAfterSecondPass === jobsBeforeSecondPass && reconcileOut.includes("OPEN=0"),
        "a second reconciler pass enqueues nothing more",
        `jobsBefore=${jobsBeforeSecondPass}, jobsAfter=${jobsAfterSecondPass}`
      );

      // Verify clip routes serve MP4s for all 3 scenes
      for (const sIdx of [0, 1, 2]) {
        const redir = await redirectOf(`/v1/projects/${sharedProject}/plates/${sIdx}/clip?aspect=16:9`);
        const file = await download(redir.location, join(tempDir, `rollback-scene-${sIdx}.mp4`));
        const probe = ffprobe(file).streams[0];
        const expectedFrames = allDrawnWait.value.find((r) => r.scene_index === sIdx).frames;
        assertCheck(
          scen,
          redir.status === 302 && Number(probe.nb_read_packets) === expectedFrames,
          `clip route for scene ${sIdx} serves valid MP4 after rollback`,
          `frames=${probe.nb_read_packets}`
        );
      }

      // Restart plate-api without compose.rollback.yaml (back to compose.live.yaml)
      composeLive("up", "-d", "plate-api");
      await waitForApiReady("plate-api back without rollback override");

      scenarioResults.F = { pass: true, rollbackRenderMs: allDrawnWait.ms };
    }

    // =========================================================================
    // Scenario G: Flag semantics.
    // =========================================================================
    log("== Scenario G: Flag semantics");
    {
      const scen = "G";
      // 1. Create a project while the flag is ON (`PLATE_LIVE_PREVIEW=on`)
      const projCreatedFlagOn = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 1, audio: false });
      await api(`/v1/projects/${projCreatedFlagOn.id}/plates/draw`, { method: "POST" });
      const liveBundled = await waitFor(
        "projCreatedFlagOn bundled",
        async () => {
          const v = await variants(projCreatedFlagOn.id);
          return v.length === 1 && v[0].state === "bundled" ? v[0] : false;
        },
        { timeout: 60_000, every: 300 }
      );

      const modeBeforeRestart = (
        await pool.query("select live_mode from app.plate_state where project_id = $1", [projCreatedFlagOn.id])
      ).rows[0]?.live_mode;
      assertCheck(scen, modeBeforeRestart === "live", "project created while flag=on has live_mode='live'");

      // 2. Restart the stack with the flag OFF (`compose.yaml` only, where `PLATE_LIVE_PREVIEW` defaults to `off`)
      composeFlagOff("up", "-d", "plate-api", "plate-worker");
      await waitForApiReady("plate-api ready with PLATE_LIVE_PREVIEW=off");

      // Verify project created while flag was ON stays 'live'
      const statusFlagOnProj = await api(`/v1/projects/${projCreatedFlagOn.id}/plates`);
      const modeAfterRestart = (
        await pool.query("select live_mode from app.plate_state where project_id = $1", [projCreatedFlagOn.id])
      ).rows[0]?.live_mode;
      assertCheck(
        scen,
        modeAfterRestart === "live" && statusFlagOnProj.json.mode === "live",
        "project created while flag=on stays 'live' after stack restart with flag=off"
      );

      // Even calling POST /plates/draw again on projCreatedFlagOn with flag=off keeps it 'live' and does not enqueue plate-render
      await api(`/v1/projects/${projCreatedFlagOn.id}/plates/draw`, { method: "POST" });
      const checkOnStickyLive = await api(`/v1/projects/${projCreatedFlagOn.id}/plates/${liveBundled.value.id}/check`, {
        method: "POST",
        body: {
          gen: liveBundled.value.gen,
          bundleDigest: liveBundled.value.bundle_digest,
          host: "worker",
          results: { ok: true }
        }
      });
      assertCheck(
        scen,
        checkOnStickyLive.status === 200 && checkOnStickyLive.json.state === "checked",
        "sticky 'live' project still accepts /check (200 {state:'checked'}) while server flag is off"
      );

      // 3. Create a project while the flag is OFF -> becomes 'clip' and goes bundled -> rendering -> drawn automatically
      const projCreatedFlagOff = await seedProject({ look: "illus-balloon", aspect: "16:9", beats: 1, audio: false });
      await api(`/v1/projects/${projCreatedFlagOff.id}/plates/draw`, { method: "POST" });

      const clipModeRow = (
        await pool.query("select live_mode from app.plate_state where project_id = $1", [projCreatedFlagOff.id])
      ).rows[0];
      assertCheck(scen, clipModeRow?.live_mode === "clip", "project created while flag=off has live_mode='clip'");

      const clipDrawnWait = await waitFor("clip project drawn automatically", () => allDrawn(["16:9"])(projCreatedFlagOff.id), {
        timeout: 240_000,
        every: 1000
      });
      const clipVar = clipDrawnWait.value[0];
      assertCheck(
        scen,
        clipVar.state === "drawn" && Boolean(clipVar.clip_key),
        "project created while flag=off transitions bundled -> rendering -> drawn without check route",
        `in ${clipDrawnWait.ms}ms`
      );

      // Assert /check returns 409 on the clip-mode project
      const checkOnClipProj = await api(`/v1/projects/${projCreatedFlagOff.id}/plates/${clipVar.id}/check`, {
        method: "POST",
        body: { gen: clipVar.gen, bundleDigest: clipVar.bundle_digest, host: "worker", results: { ok: true } }
      });
      assertCheck(
        scen,
        checkOnClipProj.status === 409 && checkOnClipProj.json?.code === "not_live",
        "/check on project created while flag=off returns 409 not_live"
      );

      // Restore stack with PLATE_LIVE_PREVIEW=on
      composeLive("up", "-d", "plate-api", "plate-worker");
      await waitForApiReady("plate-api back with PLATE_LIVE_PREVIEW=on");

      scenarioResults.G = { pass: true, clipAutoDrawMs: clipDrawnWait.ms };
    }

    // =========================================================================
    // Scenario H: Final render & companion export draw-on-demand behaviour on a live project.
    // =========================================================================
    log("== Scenario H: Final render expectation (Phase 2c draw-on-demand)");
    {
      const scen = "H";
      const liveExportProj = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 2, audio: true });
      await api(`/v1/projects/${liveExportProj.id}/plates/draw`, { method: "POST" });
      const bundledRows = await waitFor(
        "Scenario H variants bundled",
        async () => {
          const v = await variants(liveExportProj.id);
          return v.length === 2 && v.every((r) => r.state === "bundled") ? v : false;
        },
        { timeout: 90_000, every: 300 }
      );
      for (const v of bundledRows.value) {
        await api(`/v1/projects/${liveExportProj.id}/plates/${v.id}/check`, {
          method: "POST",
          body: { gen: v.gen, bundleDigest: v.bundle_digest, host: "worker", results: { ok: true } }
        });
      }
      const checkedRows = await variants(liveExportProj.id);
      const checkedIds = checkedRows.map((r) => r.id);
      assertCheck(
        scen,
        checkedRows.every((r) => r.state === "checked" && r.clip_key === null),
        "Scenario H project has all variants 'checked' and never drawn (clip_key=null)"
      );

      // 1. Companion export (`POST /v1/projects/:id/plates/export`) returns 202 {state:'drawing'} AND triggers requestDraws
      const companionExportRes = await api(`/v1/projects/${liveExportProj.id}/plates/export`, {
        method: "POST",
        body: { aspect: "16:9" }
      });
      const companionDownloadRes = await api(`/v1/projects/${liveExportProj.id}/plates/export/16-9`);

      assertCheck(
        scen,
        companionExportRes.status === 202 && companionExportRes.json?.state === "drawing",
        "companion export POST /plates/export returns 202 {state:'drawing', progress:0} while triggering draw-on-demand",
        JSON.stringify(companionExportRes.json)
      );

      const stateAfterExport = (
        await pool.query("select draw_aspects from app.plate_state where project_id = $1", [liveExportProj.id])
      ).rows[0];
      const jobsAfterExport = (
        await pool.query(
          "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
          [checkedIds]
        )
      ).rows[0].n;
      const rowsAfterExport = await variants(liveExportProj.id);

      assertCheck(
        scen,
        Array.isArray(stateAfterExport?.draw_aspects) &&
          stateAfterExport.draw_aspects.includes("16:9") &&
          jobsAfterExport === 2 &&
          rowsAfterExport.every(
            (r) => r.state === "rendering" || (r.state === "bundled" && r.stage === "queued for rendering")
          ),
        "companion export request persists '16:9' in draw_aspects and enqueues 1 plate-render job per scene",
        `draw_aspects=${JSON.stringify(stateAfterExport?.draw_aspects)}, jobs=${jobsAfterExport}`
      );

      // 2. Billed final render (`POST /v1/projects/:id/render`) also calls requestDraws idempotently (no extra plate-render jobs)
      const finalRenderRes = await api(`/v1/projects/${liveExportProj.id}/render`, {
        method: "POST",
        body: {}
      });
      assertCheck(scen, finalRenderRes.status === 202 && Boolean(finalRenderRes.json?.id), "POST /render returns 202");

      const preparedWait = await waitFor(
        "Scenario H render job prepared",
        async () => {
          const r = (await pool.query("select state, render_input from app.render_jobs where id = $1", [finalRenderRes.json.id])).rows[0];
          return r?.render_input?.manifestKey ? r : false;
        },
        { timeout: 30_000, every: 200 }
      );
      const jobsAfterRender = (
        await pool.query(
          "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
          [checkedIds]
        )
      ).rows[0].n;
      assertCheck(
        scen,
        Boolean(preparedWait.value?.render_input?.manifestKey) && jobsAfterRender === 2,
        "prepareFilm queues plate-film render without duplicating plate-render jobs",
        `jobsAfterRender=${jobsAfterRender}`
      );

      // Clean up Scenario H's in-flight jobs so Scenarios J and K measure clean end-to-end renders
      await pool.query("delete from pgboss.job where name in ('plate-render', 'render-plan', 'render-video')");
      await pool.query("delete from app.plate_variants where project_id = $1", [liveExportProj.id]);
      await pool.query("delete from app.plate_state where project_id = $1", [liveExportProj.id]);
      await pool.query("update app.render_jobs set state = 'failed' where id = $1", [finalRenderRes.json.id]);
      await sleep(2500);

      metrics.scenarioH = {
        companionExportPost: { status: companionExportRes.status, body: companionExportRes.json },
        companionExportGet: { status: companionDownloadRes.status, body: companionDownloadRes.json },
        drawAspectsAfterExport: stateAfterExport?.draw_aspects ?? [],
        plateRenderJobsAfterExport: jobsAfterExport,
        plateRenderJobsAfterRender: jobsAfterRender,
        finalRenderPost: { status: finalRenderRes.status, body: finalRenderRes.json }
      };

      scenarioResults.H = { pass: true, jobsAfterExport, jobsAfterRender };
    }

    // =========================================================================
    // Scenario I: Unsupported environment.
    // =========================================================================
    log("== Scenario I: Unsupported environment");
    {
      const scen = "I";
      const page = await harness.browser.newPage();
      try {
        // Override navigator.userAgent to Safari macOS (unverified) and instrument window.Worker before loading the module
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "userAgent", {
            get: () =>
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            configurable: true
          });
          window.__WORKER_CONSTRUCTED_COUNT__ = 0;
          const OrigWorker = window.Worker;
          window.Worker = function (...args) {
            window.__WORKER_CONSTRUCTED_COUNT__++;
            return new OrigWorker(...args);
          };
          window.Worker.prototype = OrigWorker.prototype;
        });

        await page.goto(`${harness.origin}/test.html`);
        await page.waitForFunction(() => Boolean(window.Live));

        const unverifiedOutcome = await page.evaluate(async () => {
          const envStatus = window.Live.environmentStatus();
          const supported = window.Live.supportsWorkerHost();
          const stage = document.getElementById("stage");
          stage.innerHTML = "";

          const modeEvents = [];
          const player = new window.Live.PlatePlayer({
            bundleDigest: "unverified-digest-test",
            html: "<!doctype html><html><body><script>window.FILM={};</script></body></html>",
            aspect: "16:9",
            fps: 30,
            frames: 90
          });
          player.on("mode", (d) => modeEvents.push(d));
          await player.mount(stage);

          const decision = player.decision();
          const hasWorkerHost = player.workerHost !== null;
          const iframesCount = document.querySelectorAll("iframe").length;
          const workerCount = window.__WORKER_CONSTRUCTED_COUNT__;
          player.destroy();

          return {
            envStatus,
            supported,
            decision,
            modeEvents,
            hasWorkerHost,
            iframesCount,
            workerCount
          };
        });

        assertCheck(
          scen,
          unverifiedOutcome.envStatus === "unverified" && unverifiedOutcome.supported === false,
          "overriding navigator.userAgent forces environmentStatus() to 'unverified' and supportsWorkerHost() to false",
          `envStatus=${unverifiedOutcome.envStatus}, supported=${unverifiedOutcome.supported}`
        );
        assertCheck(
          scen,
          unverifiedOutcome.decision.mode === "clip" && unverifiedOutcome.decision.reason === "unverified-environment",
          "PlatePlayer chooses mode:'clip' (reason:'unverified-environment')",
          JSON.stringify(unverifiedOutcome.decision)
        );
        assertCheck(
          scen,
          unverifiedOutcome.hasWorkerHost === false &&
            unverifiedOutcome.iframesCount === 0 &&
            unverifiedOutcome.workerCount === 0,
          "PlatePlayer never starts a Worker or bootstrap iframe in an unverified environment",
          `hasWorkerHost=${unverifiedOutcome.hasWorkerHost}, iframes=${unverifiedOutcome.iframesCount}, workers=${unverifiedOutcome.workerCount}`
        );

        scenarioResults.I = { pass: true };
      } finally {
        await page.close();
      }
    }

    // =========================================================================
    // Scenario J: Final render of a live project that was fully checked in the browser.
    // =========================================================================
    log("== Scenario J: Final render of a live project that was fully checked in the browser");
    {
      const scen = "J";
      // Reuse Scenario A's setup (illus-fox, 16:9, 3 beats, with recorded audio for final film assembly)
      const { id } = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 3, audio: true });
      const drawRes = await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
      assertCheck(scen, drawRes.status === 202, "POST /plates/draw returns 202");

      const bundledWait = await waitFor(
        "Scenario J all 3 variants bundled",
        async () => {
          const rows = await variants(id);
          return rows.length === 3 && rows.every((r) => r.state === "bundled") ? rows : false;
        },
        { timeout: 120_000, every: 300 }
      );
      const variantIds = bundledWait.value.map((r) => r.id);

      // Check all 3 variants in the browser (same flow as Scenario A)
      const { page } = await harness.newReadyPage();
      try {
        for (const v of bundledWait.value) {
          const res = await page.evaluate(
            async ({ projectId, variantId, gen }) => {
              const b = await window.Live.fetchBundle(projectId, variantId);
              const shaOk = await window.Live.verifyBundleHtmlSha(b.html, b.manifest.bundleSha);
              const host = new window.Live.WorkerHost({ html: b.html, params: b.params });
              const checkOut = await window.Live.runCheck(host, b.manifest);
              host.destroy();
              const rep = await window.Live.reportCheck(projectId, variantId, {
                gen,
                bundleDigest: b.bundleDigest,
                results: checkOut,
                device: { ua: navigator.userAgent }
              });
              return { shaOk, checkOut, rep };
            },
            { projectId: id, variantId: v.id, gen: v.gen }
          );
          assertCheck(
            scen,
            res.shaOk && res.checkOut.ok && res.rep.httpStatus === 200 && res.rep.state === "checked",
            `scene ${v.scene_index} checked in browser`
          );
        }
      } finally {
        await page.close();
      }

      const checkedRows = await variants(id);
      assertCheck(
        scen,
        checkedRows.length === 3 && checkedRows.every((r) => r.state === "checked" && !r.clip_key),
        "all 3 variants are 'checked' with no clip_key before final render"
      );

      // Start billed final render (`POST /v1/projects/:id/render`)
      const tRenderStart = now();
      const renderRes1 = await api(`/v1/projects/${id}/render`, { method: "POST", body: {} });
      assertCheck(
        scen,
        renderRes1.status === 202 && Boolean(renderRes1.json?.id),
        "POST /v1/projects/:id/render returns 202",
        `jobId=${renderRes1.json?.id}`
      );
      const jobId1 = renderRes1.json.id;

      // Wait for prepareFilm to enqueue plate-render jobs
      await waitFor(
        "Scenario J prepareFilm enqueued plate-render",
        async () => {
          const r = (await pool.query("select render_input from app.render_jobs where id = $1", [jobId1])).rows[0];
          return r?.render_input?.manifestKey ? r : false;
        },
        { timeout: 30_000, every: 200 }
      );

      const countJobsForJ = async () =>
        (
          await pool.query(
            "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
            [variantIds]
          )
        ).rows[0].n;

      const jobsAfterFirstRender = await countJobsForJ();
      assertCheck(
        scen,
        jobsAfterFirstRender === 3,
        "pgboss.job has exactly 1 plate-render per scene (3 total)",
        `count=${jobsAfterFirstRender}`
      );

      // Wait for the final render to complete to 'ready'
      const readyWait = await waitFor(
        "Scenario J final render ready",
        async () => {
          const r = await api(`/v1/render-jobs/${jobId1}`);
          if (r.json?.state === "failed") {
            throw new Error(`Scenario J render failed: ${JSON.stringify(r.json?.error)}`);
          }
          return r.json?.state === "ready" ? r.json : false;
        },
        { timeout: 360_000, every: 1000 }
      );
      const renderMs = now() - tRenderStart;
      metrics.scenarioJRenderMs = renderMs;
      assertCheck(scen, readyWait.value.state === "ready", "final render completed to state:'ready'", `in ${renderMs}ms`);

      //Repeating the render request does not enqueue more plate-render jobs
      const renderRes2 = await api(`/v1/projects/${id}/render`, { method: "POST", body: {} });
      assertCheck(
        scen,
        renderRes2.status === 202 && Boolean(renderRes2.json?.id),
        "repeated POST /render returns 202",
        `status=${renderRes2.status}, body=${JSON.stringify(renderRes2.json)}`
      );
      const jobId2 = renderRes2.json.id;
      await waitFor(
        "Scenario J second render job prepared",
        async () => {
          const r = (await pool.query("select render_input from app.render_jobs where id = $1", [jobId2])).rows[0];
          return r?.render_input?.manifestKey ? r : false;
        },
        { timeout: 30_000, every: 200 }
      );
      // Clean up second render-video job if still queued so worker stays free, and check plate-render job count
      await pool.query("delete from pgboss.job where name = 'render-video' and data->>'jobId' = $1", [jobId2]);
      const jobsAfterSecondRender = await countJobsForJ();
      assertCheck(
        scen,
        jobsAfterSecondRender === 3,
        "repeating the render request does not enqueue more plate-render jobs",
        `count=${jobsAfterSecondRender}`
      );

      // Download the finished MP4 from jobId1 and run ffprobe checks (size 1920x1080, audio stream, frame count matching manifest)
      const jobRow = (await pool.query("select render_input from app.render_jobs where id = $1", [jobId1])).rows[0];
      const manifestJson = JSON.parse(await s3GetText("plates-uploads", jobRow.render_input.manifestKey));
      const redir = await redirectOf(`/v1/renders/${jobId1}`);
      assertCheck(scen, redir.status === 302 && Boolean(redir.location), "GET /v1/renders/:id redirects (302) to MP4");
      const mp4File = await download(redir.location, join(tempDir, "scenario-j-final.mp4"));
      const probe = ffprobe(mp4File);
      const vStream = probe.streams.find((s) => s.codec_type === "video");
      const aStream = probe.streams.find((s) => s.codec_type === "audio");

      assertCheck(
        scen,
        vStream?.width === 1920 && vStream?.height === 1080,
        "rendered MP4 dimensions are 1920x1080",
        `${vStream?.width}x${vStream?.height}`
      );
      assertCheck(scen, Boolean(aStream), "rendered MP4 has an audio stream", `codec=${aStream?.codec_name}`);
      assertCheck(
        scen,
        Number(vStream?.nb_read_packets) === manifestJson.totalFrames,
        "rendered MP4 frame count matches manifest totalFrames",
        `packets=${vStream?.nb_read_packets}, manifest=${manifestJson.totalFrames}`
      );

      scenarioResults.J = {
        pass: true,
        renderMs,
        scenesDrawn: 3,
        plateRenderCount: jobsAfterSecondRender,
        totalFrames: manifestJson.totalFrames
      };
    }

    // =========================================================================
    // Scenario K: Final render with no browser at all + companion export for another ratio.
    // =========================================================================
    log("== Scenario K: Final render with no browser at all");
    {
      const scen = "K";
      // Seed a project with 2 ratios (16:9 primary + 9:16 secondary) and 2 beats
      const { id } = await seedProject({
        look: "illus-balloon",
        aspect: "16:9",
        aspects: ["16:9", "9:16"],
        beats: 2,
        audio: true
      });

      // Start plates and request final render IMMEDIATELY, before scenes are bundled and without any browser check report
      const tRenderStart = now();
      const drawRes = await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
      assertCheck(scen, drawRes.status === 202, "POST /plates/draw returns 202");

      const initialRows = await variants(id);
      const noneBundledYet = initialRows.every((r) => r.state === "queued" || r.state === "authoring");
      assertCheck(
        scen,
        initialRows.length === 4 && noneBundledYet,
        "render requested immediately while variants are still queued/authoring (before bundled)",
        initialRows.map((r) => `${r.scene_index}/${r.aspect}:${r.state}`).join(", ")
      );

      const renderRes = await api(`/v1/projects/${id}/render`, { method: "POST", body: {} });
      assertCheck(
        scen,
        renderRes.status === 202 && Boolean(renderRes.json?.id),
        "POST /v1/projects/:id/render returns 202 immediately",
        `jobId=${renderRes.json?.id}`
      );
      const jobId = renderRes.json.id;

      // Poll until final render completes while verifying NO row ever reaches 'checked'
      let everChecked = false;
      const readyWait = await waitFor(
        "Scenario K final render ready (no browser)",
        async () => {
          const curVars = await variants(id);
          if (curVars.some((r) => r.state === "checked" || r.checked_at !== null)) {
            everChecked = true;
          }
          const r = await api(`/v1/render-jobs/${jobId}`);
          if (r.json?.state === "failed") {
            throw new Error(`Scenario K render failed: ${JSON.stringify(r.json?.error)}`);
          }
          return r.json?.state === "ready" ? r.json : false;
        },
        { timeout: 360_000, every: 500 }
      );
      const renderMs = now() - tRenderStart;
      metrics.scenarioKRenderMs = renderMs;

      const rowsAfterRender = await variants(id);
      if (rowsAfterRender.some((r) => r.state === "checked" || r.checked_at !== null)) {
        everChecked = true;
      }
      const rows169 = rowsAfterRender.filter((r) => r.aspect === "16:9");
      const rows916 = rowsAfterRender.filter((r) => r.aspect === "9:16");

      assertCheck(scen, readyWait.value.state === "ready", "final render with no browser completed to state:'ready'", `in ${renderMs}ms`);
      assertCheck(
        scen,
        everChecked === false && rowsAfterRender.every((r) => r.checked_at === null && r.check_report === null),
        "no variant row ever reached 'checked'"
      );

      const jobs169 = (
        await pool.query(
          "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
          [rows169.map((r) => r.id)]
        )
      ).rows[0].n;
      assertCheck(
        scen,
        jobs169 === 2 && rows169.every((r) => r.state === "drawn" && Boolean(r.clip_key)),
        "plate-render count for primary ratio equals number of scenes (2)",
        `jobs169=${jobs169}`
      );

      // Verify final render MP4 via ffprobe
      const jobRow = (await pool.query("select render_input from app.render_jobs where id = $1", [jobId])).rows[0];
      const manifestJson = JSON.parse(await s3GetText("plates-uploads", jobRow.render_input.manifestKey));
      const redir = await redirectOf(`/v1/renders/${jobId}`);
      assertCheck(scen, redir.status === 302 && Boolean(redir.location), "GET /v1/renders/:id redirects (302)");
      const mp4File = await download(redir.location, join(tempDir, "scenario-k-final.mp4"));
      const probe = ffprobe(mp4File);
      const vStream = probe.streams.find((s) => s.codec_type === "video");
      const aStream = probe.streams.find((s) => s.codec_type === "audio");

      assertCheck(
        scen,
        vStream?.width === 1920 && vStream?.height === 1080 && Boolean(aStream) && Number(vStream?.nb_read_packets) === manifestJson.totalFrames,
        "final render MP4 is valid 1920x1080 with audio and matching frame count",
        `size=${vStream?.width}x${vStream?.height}, packets=${vStream?.nb_read_packets}/${manifestJson.totalFrames}`
      );

      // Also request a companion export for another ratio (9:16) of this live project and assert it becomes ready and downloads
      const tExportStart = now();
      const exportInitRes = await api(`/v1/projects/${id}/plates/export`, {
        method: "POST",
        body: { aspect: "9:16" }
      });
      assertCheck(
        scen,
        exportInitRes.status === 202 && exportInitRes.json?.state === "drawing",
        "first companion export request for 9:16 returns 202 {state:'drawing'} and triggers draw-on-demand",
        JSON.stringify(exportInitRes.json)
      );

      const exportReadyWait = await waitFor(
        "Scenario K companion export 9:16 ready",
        async () => {
          const r = await api(`/v1/projects/${id}/plates/export`, {
            method: "POST",
            body: { aspect: "9:16" }
          });
          if (r.json?.state === "failed") {
            throw new Error(`Scenario K 9:16 export failed: ${JSON.stringify(r.json)}`);
          }
          return r.json?.state === "ready" ? r.json : false;
        },
        { timeout: 360_000, every: 1000 }
      );
      const exportMs = now() - tExportStart;
      metrics.scenarioKCompanionExportMs = exportMs;

      assertCheck(
        scen,
        exportReadyWait.value.state === "ready",
        "companion export for 9:16 becomes 'ready'",
        `in ${exportMs}ms`
      );

      const expRedir = await redirectOf(`/v1/projects/${id}/plates/export/9-16`);
      assertCheck(scen, expRedir.status === 302 && Boolean(expRedir.location), "GET /plates/export/9-16 redirects (302)");
      const expMp4File = await download(expRedir.location, join(tempDir, "scenario-k-export-9x16.mp4"));
      const expProbe = ffprobe(expMp4File);
      const expV = expProbe.streams.find((s) => s.codec_type === "video");
      const expA = expProbe.streams.find((s) => s.codec_type === "audio");

      assertCheck(
        scen,
        expV?.width === 1080 && expV?.height === 1920 && Boolean(expA) && Number(expV?.nb_read_packets) === manifestJson.totalFrames,
        "downloaded 9:16 companion export is valid 1080x1920 MP4 with audio and matching frames",
        `size=${expV?.width}x${expV?.height}, packets=${expV?.nb_read_packets}`
      );

      const jobs916 = (
        await pool.query(
          "select count(*)::int as n from pgboss.job where name = 'plate-render' and (data->>'variantId') = any($1::text[])",
          [rows916.map((r) => r.id)]
        )
      ).rows[0].n;
      assertCheck(scen, jobs916 === 2, "plate-render count for 9:16 companion export equals number of scenes (2)", `jobs916=${jobs916}`);

      scenarioResults.K = {
        pass: true,
        renderMs,
        companionExportMs: exportMs,
        scenesDrawn169: 2,
        scenesDrawn916: 2,
        plateRenderCount169: jobs169,
        plateRenderCount916: jobs916,
        totalFrames: manifestJson.totalFrames
      };
    }

    const totalAssertions = assertions.length;
    const passedAssertions = assertions.filter((a) => a.ok).length;
    const failedAssertions = totalAssertions - passedAssertions;

    console.log(
      `\nSUMMARY: ${passedAssertions}/${totalAssertions} assertions passed (${failedAssertions} failed) across scenarios A-K.`
    );
    console.log("E2E_METRICS_JSON:" + JSON.stringify({ scenarioResults, metrics }));

    if (failedAssertions > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (harness) {
      await harness.close().catch(() => {});
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    await pool.end().catch(() => {});
  }
}

await main();
