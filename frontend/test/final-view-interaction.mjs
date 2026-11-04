import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { FIXTURE_HF_PROJECT_ID } from "./fixtures/hf/data.ts";
import {
  FIXTURE_PROJECT_ID,
  fixturePlateExport,
  fixturePlateStatus
} from "./fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const NEXT_DEV_LOCK = join(FRONTEND_DIR, ".next/dev/lock");
const WS_FIXTURES_DIR = join(HERE, "fixtures/workspace");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));
const CLIP_1X1 = readFileSync(join(WS_FIXTURES_DIR, "clip-1x1.mp4"));

async function waitForNextDevLockFree(timeoutMs = 60_000) {
  // Yield briefly so concurrent test files (hf-step-interaction.mjs & live-chrome-integration.mjs) acquire .next/dev/lock and finish first
  await new Promise((r) => setTimeout(r, 2500));
  const start = Date.now();
  while (existsSync(NEXT_DEV_LOCK) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 300));
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

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for Next dev server at ${url}`);
}

test(
  "FinalView headless Chrome interaction on both fixture pages: native video controls play/pause, download href & filename, Approve final in-flight & locked states, Back to Animation, and Plates ratio tab switching",
  { timeout: 120_000 },
  async () => {
    await waitForNextDevLockFree();
    const port = await findFreePort();
    const origin = `http://127.0.0.1:${port}`;

    const nextProc = spawn(
      "npx",
      ["next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
      {
        cwd: FRONTEND_DIR,
        env: {
          ...process.env,
          NEXT_PUBLIC_LIVE_DEV: "1",
          NEXT_PUBLIC_APP_ENV: "local",
          NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-dev-anon-key"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    nextProc.stdout?.resume();
    nextProc.stderr?.resume();

    let browser = null;
    try {
      await waitForServer(`${origin}/dev/hf-final-fixture`);
      await waitForServer(`${origin}/dev/plate-preview-fixture`);
      browser = await chromium.launch({
        executablePath: CHROME_PATH,
        headless: true
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
      });

      let activePlateState = "k-plate-final";

      await context.route("**/*", async (route) => {
        const req = route.request();
        const url = new URL(req.url());

        if (url.hostname === "fonts.googleapis.com") {
          await route.fulfill({ status: 200, contentType: "text/css", body: "" });
          return;
        }
        if (url.pathname.endsWith("/media-token")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              token: "fixture-token",
              expiresAt: "2099-01-01T00:00:00.000Z"
            })
          });
          return;
        }
        if (/\/projects\/[^/]+\/plates$/.test(url.pathname)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fixturePlateStatus(activePlateState))
          });
          return;
        }
        if (/\/projects\/[^/]+\/plates\/export$/.test(url.pathname) && req.method() === "POST") {
          let aspect = "9:16";
          try {
            const body = JSON.parse(req.postData() ?? "{}");
            if (body.aspect) aspect = body.aspect;
          } catch {
            // ignore
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fixturePlateExport(activePlateState, aspect))
          });
          return;
        }
        if (
          /\/plates\/export\/(16-9|9-16|1-1)$/.test(url.pathname) ||
          /\/plates\/export$/.test(url.pathname) ||
          url.pathname.endsWith(".mp4")
        ) {
          const aspectParam = url.searchParams.get("aspect");
          const isPortrait =
            aspectParam === "9:16" ||
            url.pathname.includes("9x16") ||
            url.pathname.endsWith("9-16");
          const isSquare = aspectParam === "1:1" || url.pathname.endsWith("1-1");
          const buf = isPortrait ? CLIP_9X16 : isSquare ? CLIP_1X1 : CLIP_16X9;
          await route.fulfill({
            status: 200,
            contentType: "video/mp4",
            body: buf
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

      // =========================================================================
      // Part 1: HyperFrames final fixture (/dev/hf-final-fixture)
      // =========================================================================
      await page.goto(`${origin}/dev/hf-final-fixture?state=a-ready-16x9&theme=light`, {
        waitUntil: "networkidle"
      });
      await page.waitForSelector("video.pf-video");

      // 1a. Single-ratio rule: .pf-tabs is not rendered when there is only 1 ratio
      assert.equal(
        await page.locator(".pf-tabs").count(),
        0,
        "HyperFrames single-ratio view must not render .pf-tabs"
      );

      // 1b. Video element has controls and plays/pauses through native controls interaction
      const hfVideo = page.locator("video.pf-video");
      const hasControls = await hfVideo.evaluate((v) => v.controls);
      assert.equal(hasControls, true, "Video element must have native controls enabled");

      // Click center of the video to play via native controls, then click again to pause
      const hfBox = await hfVideo.boundingBox();
      assert.ok(hfBox, "Video element must have a bounding box");
      await page.mouse.click(hfBox.x + hfBox.width / 2, hfBox.y + hfBox.height / 2);
      await page.waitForFunction(() => {
        const v = document.querySelector("video.pf-video");
        return v && !v.paused;
      });
      await page.mouse.click(hfBox.x + hfBox.width / 2, hfBox.y + hfBox.height / 2);
      await page.waitForFunction(() => {
        const v = document.querySelector("video.pf-video");
        return v && v.paused;
      });

      // 1c. Download link has the right href and download filename
      const hfDownload = page.locator(".pf-downloads a.aw-btn");
      assert.equal(await hfDownload.count(), 1);
      const hfHref = await hfDownload.getAttribute("href");
      const hfDownloadName = await hfDownload.getAttribute("download");
      assert.ok(
        hfHref?.includes(`/v1/projects/${FIXTURE_HF_PROJECT_ID}/output-16x9.mp4`),
        `Expected HF download href to reference project output, got ${hfHref}`
      );
      assert.equal(hfDownloadName, `${FIXTURE_HF_PROJECT_ID}-16x9.mp4`);

      // 1d. Back to Animation calls its callback
      const hfBackBtn = page.locator('.pf-actions button.aw-btn:has-text("Back to Animation")');
      await hfBackBtn.click();
      const hfBackCount = await page.evaluate(() => window.__hfFinalBackCount ?? 0);
      assert.equal(hfBackCount, 1);

      // 1e. Approve final calls callback once, shows in-flight "Approving…" state, then shows locked state
      await page.evaluate(() => {
        window.__hfFinalApproveDelayMs = 300;
      });
      const hfApproveBtn = page.locator('.pf-actions button.aw-btn-primary:has-text("Approve final")');
      await hfApproveBtn.click();

      // Verify in-flight state
      const inFlightBtn = page.locator('.pf-actions button.aw-btn-primary:has-text("Approving…")');
      await inFlightBtn.waitFor({ state: "visible", timeout: 5_000 });
      assert.equal(await inFlightBtn.isDisabled(), true);

      // Verify locked state after resolution
      const hfLocked = page.locator(".pf-actions .aw-locked");
      await hfLocked.waitFor({ state: "visible", timeout: 5_000 });
      assert.equal((await hfLocked.textContent())?.trim(), "✓ Approved · locked");
      const hfApproveCount = await page.evaluate(() => window.__hfFinalApproveCount ?? 0);
      assert.equal(hfApproveCount, 1);

      // =========================================================================
      // Part 2: Plates final fixture (/dev/plate-preview-fixture)
      // =========================================================================
      activePlateState = "k-plate-final";
      await page.goto(`${origin}/dev/plate-preview-fixture?state=k-plate-final&theme=light`, {
        waitUntil: "networkidle"
      });
      await page.waitForSelector(".pf-tabs button:nth-child(3)");

      // 2a. Multi-ratio rule: .pf-tabs renders 3 tabs
      const plateTabs = page.locator('.pf-tabs button[role="tab"]');
      assert.equal(await plateTabs.count(), 3);

      // 2b. Video plays and pauses through its controls
      const plateVideo = page.locator("video.pf-video");
      const pBox = await plateVideo.boundingBox();
      assert.ok(pBox, "Plates video must have a bounding box");
      await page.mouse.click(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
      await page.waitForFunction(() => {
        const v = document.querySelector("video.pf-video");
        return v && !v.paused;
      });
      await page.mouse.click(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
      await page.waitForFunction(() => {
        const v = document.querySelector("video.pf-video");
        return v && v.paused;
      });

      // 2c. Download links have the right href and download names
      const plateDownloadLinks = page.locator(".pf-downloads a.aw-btn");
      assert.equal(await plateDownloadLinks.count(), 2);
      assert.equal(
        await plateDownloadLinks.nth(0).getAttribute("href"),
        `/api/backend/projects/${FIXTURE_PROJECT_ID}/plates/export/16-9`
      );
      assert.equal(
        await plateDownloadLinks.nth(0).getAttribute("download"),
        `${FIXTURE_PROJECT_ID}-16x9.mp4`
      );
      const dl916Href = await plateDownloadLinks.nth(1).getAttribute("href");
      assert.ok(
        dl916Href?.includes(`/projects/${FIXTURE_PROJECT_ID}/plates/export/9-16`),
        `Expected 9:16 download href, got ${dl916Href}`
      );
      assert.equal(
        await plateDownloadLinks.nth(1).getAttribute("download"),
        `${FIXTURE_PROJECT_ID}-9x16.mp4`
      );
      const preparingChip = page.locator('.pf-downloads span.aw-btn[aria-busy="true"]');
      assert.equal((await preparingChip.textContent())?.trim(), "1:1: preparing…");

      // 2d. Switching ratio tabs changes the video source and frame ratio
      const src16x9 = await plateVideo.getAttribute("src");
      assert.equal(src16x9, `/api/backend/projects/${FIXTURE_PROJECT_ID}/plates/export/16-9`);

      // Install spies on the FinalView React fiber before switching ratio tab (which re-renders FinalView with our spies)
      await page.evaluate(() => {
        window.__plateBackCalls = 0;
        window.__plateApproveCalls = 0;
        const onBack = () => {
          window.__plateBackCalls = (window.__plateBackCalls ?? 0) + 1;
        };
        const onApprove = async () => {
          window.__plateApproveCalls = (window.__plateApproveCalls ?? 0) + 1;
          await new Promise((r) => setTimeout(r, 250));
        };
        const pf = document.querySelector(".pf");
        const key = Object.keys(pf).find((k) => k.startsWith("__reactFiber$"));
        let f = pf[key];
        while (f) {
          if (f.memoizedProps && typeof f.memoizedProps.onApprove === "function") {
            f.memoizedProps = { ...f.memoizedProps, onBack, onApprove };
            if (f.pendingProps && typeof f.pendingProps.onApprove === "function") {
              f.pendingProps = { ...f.pendingProps, onBack, onApprove };
            }
            if (f.alternate?.memoizedProps && typeof f.alternate.memoizedProps.onApprove === "function") {
              f.alternate.memoizedProps = { ...f.alternate.memoizedProps, onBack, onApprove };
            }
          }
          f = f.return;
        }
      });

      await plateTabs.nth(1).click();
      await page.waitForSelector('.pf-frame[data-ratio="9:16"]');
      const src9x16 = await plateVideo.getAttribute("src");
      assert.ok(
        src9x16?.includes("/plates/export/9-16"),
        `Expected video src to switch to 9:16 export URL, got ${src9x16}`
      );
      assert.notEqual(src9x16, src16x9);

      // Switching to preparing 1:1 tab shows waiting status text
      await plateTabs.nth(2).click();
      await page.waitForSelector(".pf-wait");
      assert.equal(
        (await page.locator(".pf-wait").textContent())?.trim(),
        "Preparing 1:1… 65%"
      );

      // Switch back to 16:9
      await plateTabs.nth(0).click();
      await page.waitForSelector('.pf-frame[data-ratio="16:9"] video.pf-video');

      // 2e. Back to Animation & Approve final on Plates fixture
      await page.locator('.pf-actions button.aw-btn:has-text("Back to Animation")').click();
      assert.equal(await page.evaluate(() => window.__plateBackCalls), 1);

      await page.locator('.pf-actions button.aw-btn-primary:has-text("Approve final")').click();
      const plateApproving = page.locator('.pf-actions button.aw-btn-primary:has-text("Approving…")');
      await plateApproving.waitFor({ state: "visible", timeout: 5_000 });
      assert.equal(await plateApproving.isDisabled(), true);
      await page.waitForFunction(() => window.__plateApproveCalls === 1);

      // Verify locked state on q-plate-final-approved
      activePlateState = "q-plate-final-approved";
      await page.goto(
        `${origin}/dev/plate-preview-fixture?state=q-plate-final-approved&theme=light`,
        { waitUntil: "networkidle" }
      );
      const plateLocked = page.locator(".pf-actions .aw-locked");
      await plateLocked.waitFor({ state: "visible", timeout: 5_000 });
      assert.equal((await plateLocked.textContent())?.trim(), "✓ Approved · locked");
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (!nextProc.killed) {
        try {
          nextProc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
);
