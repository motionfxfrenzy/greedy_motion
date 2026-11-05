#!/usr/bin/env node
// Phase 4a render-parity harness:
// 1. Starts `plate-api` and `plate-worker` on the local stack (`compose.yaml` + `compose.live.yaml`)
// 2. Seeds a HyperFrames project with both an element-level override (`overrides["b2:w:2"] = { color: "#ff3b6b", dx: 24 }`)
//    and a scene-level layout hint (`beat.hints = { emphasize: "b3:w:2", factor: 1.3 }`)
// 3. Fetches the live preview HTML (`GET /v1/preview/plans/:id`) and captures preview frames at 3 timestamps
//    (Beat 1 unedited, Beat 2 element override, Beat 3 scene hint)
// 4. Triggers the real final render (`POST /v1/projects/:id/render`), waits for the worker to finish the MP4,
//    extracts the exact same 3 timestamps from the rendered MP4 with `ffmpeg`, and measures frame-by-frame parity
//    (plus compares the worker's rendered composition inside the worker container's Chromium vs the MP4).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import {
  OWNER,
  api,
  download,
  ffprobe,
  log,
  now,
  pool,
  redirectOf,
  waitFor
} from "../../scripts/plates-e2e/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");

function composeLive(...args) {
  return execFileSync(
    "docker",
    ["compose", "-f", "compose.yaml", "-f", "tools/phase2/e2e/compose.live.yaml", "--profile", "plates-e2e", ...args],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
}

async function waitForApiReady() {
  return waitFor(
    "plate-api ready",
    async () => {
      try {
        const r = await api("/readyz");
        return r.status === 200 && r.json?.ready === true;
      } catch {
        return false;
      }
    },
    { timeout: 60_000, every: 400 }
  );
}

async function capturePreviewFrames(browser, previewHtml, times) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  try {
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/preview.html") {
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: previewHtml });
      }
      if (u.pathname.endsWith("/runtime.js")) {
        return route.fulfill({ status: 200, contentType: "application/javascript", body: RUNTIME_JS });
      }
      if (u.pathname.endsWith("/gsap.js")) {
        return route.fulfill({ status: 200, contentType: "application/javascript", body: GSAP_JS });
      }
      if (u.pathname.includes("/fonts/")) {
        const fontFile = u.pathname.split("/fonts/")[1].split("?")[0];
        try {
          return route.fulfill({
            status: 200,
            contentType: "font/woff2",
            body: readFileSync(join(WORKER_FONTS_DIR, fontFile))
          });
        } catch {
          return route.fulfill({ status: 404, body: "" });
        }
      }
      return route.fulfill({ status: 204, body: "" });
    });

    const page = await context.newPage();
    await page.goto("http://127.0.0.1:18997/preview.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await page.waitForFunction(() => Boolean(window.__timelines?.main));
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });

    const out = {};
    for (const t of times) {
      await page.evaluate((sec) => {
        window.__timelines.main.seek(sec, false);
      }, t);
      await page.waitForTimeout(60);
      out[t] = await page.screenshot();
    }
    return out;
  } finally {
    await context.close();
  }
}

async function comparePngBuffers(browser, bufA, bufB, roiBox = null) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([a, b, roi]) => {
        const load = async (b64) => {
          const img = new Image();
          img.src = "data:image/png;base64," + b64;
          await img.decode();
          const cv = new OffscreenCanvas(img.width, img.height);
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0);
          return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
        };
        const [pa, pb] = [await load(a), await load(b)];
        const W = pa.width;
        const H = pa.height;
        const p = pa.data;
        const q = pb.data;
        let totalPx = 0;
        let diffOver2 = 0;
        let diffOver16 = 0;
        let sumAbs = 0;
        let maxDelta = 0;
        const x0 = roi ? Math.max(0, roi[0]) : 0;
        const y0 = roi ? Math.max(0, roi[1]) : 0;
        const x1 = roi ? Math.min(W, roi[0] + roi[2]) : W;
        const y1 = roi ? Math.min(H, roi[1] + roi[3]) : H;

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * W + x) * 4;
            const dr = Math.abs(p[idx] - q[idx]);
            const dg = Math.abs(p[idx + 1] - q[idx + 1]);
            const db = Math.abs(p[idx + 2] - q[idx + 2]);
            const d = Math.max(dr, dg, db);
            totalPx++;
            sumAbs += (dr + dg + db) / 3;
            if (d > 2) diffOver2++;
            if (d > 16) diffOver16++;
            if (d > maxDelta) maxDelta = d;
          }
        }
        return {
          totalPx,
          meanAbsDiff: Number((sumAbs / Math.max(1, totalPx)).toFixed(3)),
          pctOver2: Number(((diffOver2 / Math.max(1, totalPx)) * 100).toFixed(3)),
          pctOver16: Number(((diffOver16 / Math.max(1, totalPx)) * 100).toFixed(3)),
          maxDelta
        };
      },
      [bufA.toString("base64"), bufB.toString("base64"), roiBox]
    );
  } finally {
    await page.close();
  }
}

async function sampleDominantColorInBox(browser, buf, box) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([b64, [bx, by, bw, bh]]) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const cv = new OffscreenCanvas(img.width, img.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(bx, by, bw, bh).data;
        let pinkLike = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // #ff3b6b -> high R (>200), low G (<110), mid-high B (>70)
          if (r > 200 && g < 110 && b > 70) pinkLike++;
        }
        return { pinkPixels: pinkLike };
      },
      [buf.toString("base64"), box]
    );
  } finally {
    await page.close();
  }
}

async function main() {
  const scratchDir = "/private/var/folders/fg/pm6g3v59295czky6kyy8zj2h0000gn/T/opencode/p4-render-parity";
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(scratchDir, { recursive: true });

  let browser = null;
  try {
    log("Building and starting plate-api and plate-worker for Phase 4a render parity...");
    composeLive("up", "-d", "--build", "--scale", "plate-worker=1", "plate-api", "plate-worker");
    await waitForApiReady();

    await pool.query(
      `INSERT INTO app.token_ledger (user_id, amount, kind, reason, ref, actor, pool)
       VALUES ($1, 1000000, 'grant', 'phase4 parity allowance', 'phase4-pack-grant', 'system', 'pack')
       ON CONFLICT (user_id, ref) WHERE ref IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount`,
      [OWNER]
    );

    // Seed a 3-beat HyperFrames project (look='clean') from template
    const local = new (await import("pg")).default.Pool({
      connectionString: "postgres://videosaas:videosaas@localhost:55432/videosaas"
    });
    const { rows } = await local.query("SELECT data FROM app.projects WHERE id = $1", [
      "58059549-16ed-4c21-93f9-4739976c8e4a"
    ]);
    await local.end();

    const data = structuredClone(rows[0].data);
    const hfId = randomUUID();
    data.id = hfId;
    data.ownerId = OWNER;
    data.name = "Phase 4a Render Parity Film";
    data.state = "Draft storyboard";
    delete data.renderJobId;
    delete data.planAudio;
    delete data.brief.brandId;
    if (data.request) delete data.request.brandId;
    data.brief.look = "clean";
    data.brief.audio = { mode: "none" };
    data.brief.durationSeconds = 9;
    data.beatPlan.beats = [
      {
        ...data.beatPlan.beats[0],
        id: "b1",
        role: "hook",
        kind: "kinetic",
        producer: "hyperframes",
        keyword: "Your story, moving.",
        on_screen: "Every beat on screen",
        line: null,
        motion: { camera: "steady", entry: { axis: "x", dir: -1 }, exit: { axis: "y", dir: -1 }, text_effect: "waterfall" },
        transition_out: { type: "j-cut" }
      },
      {
        ...data.beatPlan.beats[1],
        id: "b2",
        role: "problem",
        kind: "kinetic",
        producer: "hyperframes",
        keyword: "Ready to share.",
        on_screen: "One prompt builds the plan",
        line: null,
        motion: { camera: "steady", entry: { axis: "y", dir: -1 }, exit: { axis: "x", dir: -1 }, text_effect: "waterfall" },
        transition_out: { type: "j-cut" }
      },
      {
        ...data.beatPlan.beats[2],
        id: "b3",
        role: "cta",
        kind: "kinetic",
        producer: "hyperframes",
        keyword: "Make it move.",
        on_screen: "Get started",
        line: null,
        motion: { camera: "steady", entry: { axis: "x", dir: -1 }, exit: { axis: "z", dir: 1 }, text_effect: "waterfall" },
        transition_out: { type: "end" }
      }
    ];
    data.beatPlan.target_duration_s = 9;
    data.beatPlan.audio = { voice: null, music: null, captions: "key-phrases" };

    await pool.query("INSERT INTO app.projects (id, owner_id, name, state, data) VALUES ($1, $2, $3, $4, $5)", [
      hfId,
      OWNER,
      data.name,
      data.state,
      data
    ]);

    // 1. Render baseline (unedited) MP4 first so we can also prove that the edited MP4 differs from unedited MP4
    const baseCompRes = await api(`/v1/projects/${hfId}/composition`);
    assert.equal(baseCompRes.status, 200);
    const beatTimes = baseCompRes.json.beatTimes;
    const f1 = Math.round(((beatTimes.b1.start + beatTimes.b1.end) / 2) * 30);
    const f2 = Math.round(((beatTimes.b2.start + beatTimes.b2.end) / 2) * 30);
    const f3 = Math.round(((beatTimes.b3.start + beatTimes.b3.end) / 2) * 30);
    const t1 = Number((f1 / 30).toFixed(4));
    const t2 = Number((f2 / 30).toFixed(4));
    const t3 = Number((f3 / 30).toFixed(4));
    const sampleFrames = [f1, f2, f3];
    const sampleTimes = [t1, t2, t3];
    log(`Sample frames/times: f1=${f1} (${t1}s), f2=${f2} (${t2}s), f3=${f3} (${t3}s)`);

    // Apply element-level override on b2 ("b2:w:2": pink + dx: 24) and scene-level hint on b3 ("b3:pill:0": bigger factor 1.3) via PATCH /plan
    const patchRes = await api(`/v1/projects/${hfId}/plan`, {
      method: "PATCH",
      body: {
        overrides: {
          "b2:w:2": { color: "#ff3b6b", dx: 24 }
        },
        beats: [
          {
            id: "b3",
            hints: { emphasize: "b3:pill:0", factor: 1.3 }
          }
        ]
      }
    });
    assert.equal(patchRes.status, 200, `PATCH /plan failed: ${JSON.stringify(patchRes.json)}`);

    // Fetch live preview HTML from plate-api
    const previewRes = await fetch(`http://127.0.0.1:4100/v1/preview/plans/${hfId}`);
    assert.equal(previewRes.status, 200);
    const previewHtml = await previewRes.text();
    assert.ok(previewHtml.includes('"#ff3b6b"'), "preview HTML hf-variables block carries #ff3b6b override");
    assert.ok(previewHtml.includes('\\"factor\\":1.3'), "preview HTML plan variable carries beat.hints factor=1.3");

    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
    const previewFrames = await capturePreviewFrames(browser, previewHtml, sampleTimes);
    for (const t of sampleTimes) {
      writeFileSync(join(scratchDir, `preview-${t}.png`), previewFrames[t]);
    }

    // Trigger real final render on plate-api + plate-worker
    const tRender0 = now();
    const renderRes = await api(`/v1/projects/${hfId}/render`, { method: "POST", body: {} });
    assert.equal(renderRes.status, 202, `POST /render failed: ${JSON.stringify(renderRes.json)}`);
    const jobId = renderRes.json.id;

    const readyJob = await waitFor(
      "HyperFrames edited render job ready",
      async () => {
        const r = await api(`/v1/render-jobs/${jobId}`);
        if (r.json?.state === "failed") {
          throw new Error(`Render failed: ${JSON.stringify(r.json?.error)}`);
        }
        return r.json?.state === "ready" ? r.json : false;
      },
      { timeout: 180_000, every: 1000 }
    );
    log(`Edited HyperFrames render finished in ${now() - tRender0}ms`);

    const redir = await redirectOf(`/v1/renders/${jobId}`);
    assert.equal(redir.status, 302);
    const mp4Path = await download(redir.location, join(scratchDir, "edited.mp4"));
    const probe = ffprobe(mp4Path);
    const vStream = probe.streams.find((s) => s.codec_type === "video");
    assert.equal(vStream.width, 1920);
    assert.equal(vStream.height, 1080);

    // Extract exact frame numbers f1, f2, f3 from rendered MP4 using ffmpeg select=eq(n\,f)
    const renderFrames = {};
    for (let i = 0; i < sampleTimes.length; i++) {
      const t = sampleTimes[i];
      const f = sampleFrames[i];
      const outPng = join(scratchDir, `render-${t}.png`);
      execFileSync(
        "ffmpeg",
        ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4Path, "-vf", `select=eq(n\\,${f})`, "-frames:v", "1", outPng],
        { stdio: "inherit" }
      );
      renderFrames[t] = readFileSync(outPng);
    }

    // Compare preview vs rendered MP4 at t1, t2, t3
    const parityTable = [];
    for (const [idx, t] of sampleTimes.entries()) {
      const cmp = await comparePngBuffers(browser, previewFrames[t], renderFrames[t]);
      const label =
        idx === 0
          ? "Beat 1 (unedited kinetic)"
          : idx === 1
          ? "Beat 2 (element override: b2:w:2 pink #ff3b6b + dx 24px)"
          : "Beat 3 (scene hint: b3:pill:0 factor 1.3)";
      parityTable.push({ frame: sampleFrames[idx], time: t, label, ...cmp });
      log(`Parity at frame ${sampleFrames[idx]} (t=${t}s, ${label}): ${JSON.stringify(cmp)}`);
      assert.ok(
        cmp.meanAbsDiff < 5.0,
        `Expected preview and rendered MP4 at t=${t}s (${label}) to match closely, got meanAbsDiff=${cmp.meanAbsDiff}`
      );
    }

    // Verify that in both preview and rendered MP4 at t2, the word "share." (b2:w:2) has > 5,000 pink (#ff3b6b) pixels!
    const previewPink = await sampleDominantColorInBox(browser, previewFrames[t2], [250, 450, 750, 380]);
    const renderPink = await sampleDominantColorInBox(browser, renderFrames[t2], [250, 450, 750, 380]);
    log(`Pink pixels on b2:w:2 at t=${t2}s: preview=${previewPink.pinkPixels}, render=${renderPink.pinkPixels}`);
    assert.ok(previewPink.pinkPixels > 5000, `Expected >5000 pink pixels in preview at t=${t2}s, got ${previewPink.pinkPixels}`);
    assert.ok(renderPink.pinkPixels > 5000, `Expected >5000 pink pixels in rendered MP4 at t=${t2}s, got ${renderPink.pinkPixels}`);
    const pinkRatio = renderPink.pinkPixels / previewPink.pinkPixels;
    assert.ok(pinkRatio > 0.9 && pinkRatio < 1.1, `Expected preview and render pink pixel counts to match within 10%, got ratio ${pinkRatio.toFixed(3)}`);

    console.log("RENDER_PARITY_JSON:" + JSON.stringify({ parityTable, previewPink, renderPink, durationSeconds: readyJob.value.output?.durationSeconds }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await pool.end().catch(() => {});
  }
}

await main();
