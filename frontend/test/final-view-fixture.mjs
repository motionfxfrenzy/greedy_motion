import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { FIXTURE_HF_PROJECT_ID } from "./fixtures/hf/data.ts";
import {
  FIXTURE_PROJECT_ID,
  fixturePlateExport,
  fixturePlateStatus
} from "./fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const WS_FIXTURES_DIR = join(HERE, "fixtures/workspace");
const SCREENSHOT_DIR = join(REPO_ROOT, "docs/handoff/screenshots/final-player-brand");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));
const CLIP_1X1 = readFileSync(join(WS_FIXTURES_DIR, "clip-1x1.mp4"));

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/animation-workspace.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/plate-preview.css"), "utf8")
].join("\n");

export async function startFixtureServer() {
  const navShimPlugin = {
    name: "next-navigation-shim",
    setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({
        path: "next-navigation-shim",
        namespace: "shim"
      }));
      b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
        contents: `
          export function useSearchParams() {
            return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
          }
          export function notFound() {}
        `,
        loader: "ts"
      }));
    }
  };

  const entrySource = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import PlatePreviewFixturePage from "./app/dev/plate-preview-fixture/page.tsx";
    import HfFinalFixturePage from "./app/dev/hf-final-fixture/page.tsx";

    const path = window.location.pathname;
    const el = document.getElementById("root");
    if (el) {
      const root = createRoot(el);
      if (path.includes("hf-final-fixture")) {
        root.render(<HfFinalFixturePage />);
      } else {
        root.render(<PlatePreviewFixturePage />);
      }
    }
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "final-view-fixture-entry.tsx",
      loader: "tsx"
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [navShimPlugin],
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_LIVE_DEV": '"1"',
      "process.env.NEXT_PUBLIC_APP_ENV": '"local"',
      "process.env.NEXT_PUBLIC_API_URL": '"http://127.0.0.1:4000"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://127.0.0.1:54321"',
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"local-dev-anon-key"',
      "process.env": '{"NEXT_PUBLIC_LIVE_DEV":"1","NEXT_PUBLIC_APP_ENV":"local"}'
    }
  });
  const bundleJs = bundled.outputFiles[0].text;

  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname === "/styles.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(COMBINED_CSS);
      return;
    }
    if (url.pathname.startsWith("/dev/")) {
      const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`
      );
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
      const isSquare =
        aspectParam === "1:1" ||
        url.pathname.includes("1x1") ||
        url.pathname.endsWith("1-1");
      const buf = isPortrait ? CLIP_9X16 : isSquare ? CLIP_1X1 : CLIP_16X9;
      const dlParam = url.searchParams.get("download");
      const fnParam = url.searchParams.get("filename");
      const wantAttachment = Boolean(dlParam && dlParam !== "0" && dlParam !== "false") || Boolean(fnParam);
      const safeName = (fnParam || "video.mp4").replace(/[^\w.\- ]/g, "_");
      const attachmentHeaders = wantAttachment
        ? { "content-disposition": `attachment; filename="${safeName}"` }
        : {};
      res.writeHead(200, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-length": String(buf.length),
        ...attachmentHeaders
      });
      res.end(buf);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { srv, origin: `http://127.0.0.1:${port}`, port };
}

export async function runFinalViewAssertions(origin, port) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1135, height: 775 },
      acceptDownloads: true
    });

    let activePlateState = "r-plate-final-all-ready";

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
        const isSquare =
          aspectParam === "1:1" ||
          url.pathname.includes("1x1") ||
          url.pathname.endsWith("1-1");
        const buf = isPortrait ? CLIP_9X16 : isSquare ? CLIP_1X1 : CLIP_16X9;
        const dlParam = url.searchParams.get("download");
        const fnParam = url.searchParams.get("filename");
        const wantAttachment = Boolean(dlParam && dlParam !== "0" && dlParam !== "false") || Boolean(fnParam);
        const safeName = (fnParam || "video.mp4").replace(/[^\w.\- ]/g, "_");
        const attachmentHeaders = wantAttachment
          ? { "content-disposition": `attachment; filename="${safeName}"` }
          : {};
        const rangeHeader = req.headers()["range"];
        if (rangeHeader) {
          const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
          if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Math.min(buf.length - 1, Number(m[2])) : buf.length - 1;
            const chunk = buf.subarray(start, end + 1);
            await route.fulfill({
              status: 206,
              contentType: "video/mp4",
              headers: {
                "accept-ranges": "bytes",
                "content-range": `bytes ${start}-${end}/${buf.length}`,
                "content-length": String(chunk.length),
                ...attachmentHeaders
              },
              body: chunk
            });
            return;
          }
        }
        await route.fulfill({
          status: 200,
          contentType: "video/mp4",
          headers: {
            "accept-ranges": "bytes",
            "content-length": String(buf.length),
            ...attachmentHeaders
          },
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
    // Part 1: HyperFrames single-ratio views (/dev/hf-final-fixture)
    // =========================================================================
    // 1a. Portrait 9:16 dark theme at reference 1135x775
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.goto(`${origin}/dev/hf-final-fixture?state=b-ready-9x16&theme=dark`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="9:16"] video.pf-video');
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "hf-single-9x16-dark-1135x775.png")
    });

    // No legacy bottom download row or ratio tablist
    assert.equal(await page.locator(".pf-downloads").count(), 0, "Must not render bottom .pf-downloads row");
    assert.equal(await page.locator(".pf-tabs").count(), 0, "Must not render .pf-tabs");

    // Verify centered single portrait frame & aspect ratio
    const single916Check = await page.evaluate(() => {
      const stage = document.querySelector(".pf-stage");
      const frame = document.querySelector('.pf-frame[data-ratio="9:16"]');
      const dl = frame?.querySelector("a.pf-download-btn");
      const video = frame?.querySelector("video.pf-video");
      if (!stage || !frame || !dl || !video) return null;
      const sr = stage.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      const dr = dl.getBoundingClientRect();
      const style = getComputedStyle(frame);
      return {
        stageCenterX: sr.left + sr.width / 2,
        frameCenterX: fr.left + fr.width / 2,
        aspect: fr.width / fr.height,
        dlInTopRight:
          dr.left >= fr.left + fr.width * 0.35 &&
          dr.right <= fr.right + 1 &&
          dr.top >= fr.top &&
          dr.bottom <= fr.top + fr.height * 0.25,
        borderRadius: style.borderRadius,
        bg: style.backgroundColor,
        nativeControls: video.controls,
        docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1
      };
    });
    assert.ok(single916Check, "Single 9:16 frame elements must exist");
    assert.ok(
      Math.abs(single916Check.stageCenterX - single916Check.frameCenterX) < 4,
      `Expected single 9:16 frame to be horizontally centered, delta=${Math.abs(single916Check.stageCenterX - single916Check.frameCenterX)}`
    );
    assert.ok(
      Math.abs(single916Check.aspect - 9 / 16) < 0.03,
      `Expected 9:16 aspect ratio (~0.5625), got ${single916Check.aspect}`
    );
    assert.equal(single916Check.dlInTopRight, true, "Download 9:16 must be in the top-right corner of the player frame");
    assert.equal(single916Check.nativeControls, false, "Native browser video controls must be disabled");
    assert.equal(single916Check.docOverflowY, false, "Reference 1135x775 must not overflow vertically");

    // 1b. Landscape 16:9 single output & custom controls verification
    await page.goto(`${origin}/dev/hf-final-fixture?state=a-ready-16x9&theme=light`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="16:9"] video.pf-video');
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "hf-single-16x9-light-1135x775.png")
    });

    const hfFrame = page.locator('.pf-frame[data-ratio="16:9"]');
    const hfVideo = hfFrame.locator("video.pf-video");
    const hfPlayBtn = hfFrame.locator("button.pf-play-btn");
    const hfSeek = hfFrame.locator("input.pf-seek");
    const hfMuteBtn = hfFrame.locator("button.pf-mute-btn");
    const hfVolume = hfFrame.locator("input.pf-volume");
    const hfFullscreenBtn = hfFrame.locator("button.pf-fullscreen-btn");
    const hfDownload = hfFrame.locator("a.pf-download-btn");

    // Verify top-right download attributes
    assert.equal(await hfDownload.count(), 1);
    const hfHref = await hfDownload.getAttribute("href");
    const hfDownloadName = await hfDownload.getAttribute("download");
    const hfAriaLabel = await hfDownload.getAttribute("aria-label");
    assert.ok(
      hfHref?.includes(`/v1/projects/${FIXTURE_HF_PROJECT_ID}/output-16x9.mp4`),
      `Expected HF download href to reference project output, got ${hfHref}`
    );
    assert.equal(hfDownloadName, "relay-launch-reel-16x9.mp4");
    assert.equal(hfAriaLabel, "Download 16:9");

    // Wait for metadata duration > 0
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && Number.isFinite(v.duration) && v.duration > 0;
    });

    // Play via custom play button, then pause via clicking video surface
    assert.equal(await hfPlayBtn.getAttribute("aria-label"), "Play");
    await hfPlayBtn.click();
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && !v.paused;
    });
    assert.equal(await hfPlayBtn.getAttribute("aria-label"), "Pause");

    await hfVideo.click();
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && v.paused;
    });
    assert.equal(await hfPlayBtn.getAttribute("aria-label"), "Play");

    // Seek slider updates currentTime & clock via real pointer click on the track
    const seekBox = await hfSeek.boundingBox();
    assert.ok(seekBox, "Seek slider must have a bounding box");
    await page.mouse.click(seekBox.x + seekBox.width * 0.5, seekBox.y + seekBox.height / 2);
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && v.currentTime > 0.3;
    });
    const curAfterSeek = await hfVideo.evaluate((v) => v.currentTime);
    assert.ok(curAfterSeek > 0.3, `Expected currentTime > 0.3s after midpoint seek, got ${curAfterSeek}`);

    // Mute/unmute & volume slider via real pointer interaction
    assert.equal(await hfMuteBtn.getAttribute("aria-pressed"), "false");
    await hfMuteBtn.click();
    assert.equal(await hfMuteBtn.getAttribute("aria-pressed"), "true");
    assert.equal(await hfVideo.evaluate((v) => v.muted), true);

    await hfMuteBtn.click();
    assert.equal(await hfMuteBtn.getAttribute("aria-pressed"), "false");
    assert.equal(await hfVideo.evaluate((v) => v.muted), false);

    const volBox = await hfVolume.boundingBox();
    assert.ok(volBox, "Volume slider must have a bounding box");
    await page.mouse.click(volBox.x + volBox.width * 0.4, volBox.y + volBox.height / 2);
    const volAfter = await hfVideo.evaluate((v) => v.volume);
    assert.ok(volAfter > 0.15 && volAfter < 0.75, `Expected volume between 0.15 and 0.75 after click, got ${volAfter}`);

    // End -> Replay state transition
    await hfVideo.evaluate((v) => {
      v.currentTime = v.duration;
      v.dispatchEvent(new Event("ended"));
    });
    await page.waitForFunction(() => {
      const btn = document.querySelector("button.pf-play-btn");
      return btn && btn.getAttribute("data-state") === "ended";
    });
    assert.equal(await hfPlayBtn.getAttribute("aria-label"), "Replay");

    await hfPlayBtn.click();
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && !v.paused && v.currentTime < 1;
    });
    await hfPlayBtn.click();

    // Fullscreen button presence, entry, and exit
    assert.equal(await hfFullscreenBtn.count(), 1);
    assert.equal(await hfFullscreenBtn.getAttribute("aria-label"), "Full screen");
    await hfFullscreenBtn.click();
    await page.waitForFunction(() => {
      const btn = document.querySelector("button.pf-fullscreen-btn");
      return btn && btn.getAttribute("aria-label") === "Exit full screen";
    });
    await hfFullscreenBtn.click();
    await page.waitForFunction(() => {
      const btn = document.querySelector("button.pf-fullscreen-btn");
      return btn && btn.getAttribute("aria-label") === "Full screen" && !document.fullscreenElement;
    });

    // Keyboard accessibility & non-hijacking when focus is in another control
    await hfPlayBtn.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && !v.paused;
    });
    await page.keyboard.press("Space");
    await page.waitForFunction(() => {
      const v = document.querySelector("video.pf-video");
      return v && v.paused;
    });

    const hfBackBtn = page.locator('.pf-actions button.aw-btn:has-text("Back to Animation")');
    await hfBackBtn.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await hfVideo.evaluate((v) => v.paused),
      true,
      "Arrow keys while focused outside player controls must not hijack playback"
    );

    // Back to Animation & Approve final in-flight/locked states
    await hfBackBtn.click();
    assert.equal(await page.evaluate(() => window.__hfFinalBackCount ?? 0), 1);

    await page.evaluate(() => {
      window.__hfFinalApproveDelayMs = 300;
    });
    const hfApproveBtn = page.locator('.pf-actions button.aw-btn-primary:has-text("Approve final")');
    await hfApproveBtn.click();

    const inFlightBtn = page.locator('.pf-actions button.aw-btn-primary:has-text("Approving…")');
    await inFlightBtn.waitFor({ state: "visible", timeout: 5_000 });
    assert.equal(await inFlightBtn.isDisabled(), true);

    const hfLocked = page.locator(".pf-actions .aw-locked");
    await hfLocked.waitFor({ state: "visible", timeout: 5_000 });
    assert.equal((await hfLocked.textContent())?.trim(), "✓ Approved · locked");
    assert.equal(await page.evaluate(() => window.__hfFinalApproveCount ?? 0), 1);

    // =========================================================================
    // Part 2: Plates 3-output ready view (/dev/plate-preview-fixture)
    // =========================================================================
    activePlateState = "r-plate-final-all-ready";
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.goto(`${origin}/dev/plate-preview-fixture?state=r-plate-final-all-ready&theme=dark`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="1:1"] video.pf-video');
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-three-ratios-dark-1135x775.png")
    });

    // Check 1280x900 desktop and shorter 1135x620 desktop as well
    const threeUpLayout = await page.evaluate(() => {
      const frames = [...document.querySelectorAll(".pf-frame")];
      return {
        count: frames.length,
        docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
        docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        items: frames.map((f) => {
          const r = f.getBoundingClientRect();
          const dl = f.querySelector("a.pf-download-btn");
          const dr = dl ? dl.getBoundingClientRect() : null;
          return {
            ratio: f.getAttribute("data-ratio"),
            width: r.width,
            height: r.height,
            aspect: r.width / r.height,
            inViewport:
              r.left >= 0 &&
              r.top >= 0 &&
              r.right <= window.innerWidth + 1 &&
              r.bottom <= window.innerHeight + 1,
            dlHref: dl?.getAttribute("href"),
            dlDownload: dl?.getAttribute("download"),
            dlAria: dl?.getAttribute("aria-label"),
            dlInTopRight: dr
              ? dr.left >= r.left + r.width * 0.25 &&
                dr.right <= r.right + 1 &&
                dr.top >= r.top &&
                dr.bottom <= r.top + r.height * 0.3
              : false
          };
        })
      };
    });

    assert.equal(threeUpLayout.count, 3, "All 3 ratios must render side-by-side");
    assert.equal(threeUpLayout.docOverflowY, false, "1135x775 must not overflow vertically");
    assert.equal(threeUpLayout.docOverflowX, false, "1135x775 must not overflow horizontally");

    const [f16x9, f9x16, f1x1] = threeUpLayout.items;
    assert.equal(f16x9.ratio, "16:9");
    assert.ok(Math.abs(f16x9.aspect - 16 / 9) < 0.04, `16:9 aspect mismatch: ${f16x9.aspect}`);
    assert.equal(f16x9.inViewport, true);
    assert.equal(f16x9.dlInTopRight, true);
    assert.equal(f16x9.dlDownload, "the-foxs-winter-lantern-16x9.mp4");
    assert.equal(f16x9.dlAria, "Download 16:9");

    assert.equal(f9x16.ratio, "9:16");
    assert.ok(Math.abs(f9x16.aspect - 9 / 16) < 0.04, `9:16 aspect mismatch: ${f9x16.aspect}`);
    assert.equal(f9x16.inViewport, true);
    assert.equal(f9x16.dlInTopRight, true);
    assert.equal(f9x16.dlDownload, "the-foxs-winter-lantern-9x16.mp4");
    assert.equal(f9x16.dlAria, "Download 9:16");

    assert.equal(f1x1.ratio, "1:1");
    assert.ok(Math.abs(f1x1.aspect - 1) < 0.04, `1:1 aspect mismatch: ${f1x1.aspect}`);
    assert.equal(f1x1.inViewport, true);
    assert.equal(f1x1.dlInTopRight, true);
    assert.equal(f1x1.dlDownload, "the-foxs-winter-lantern-1x1.mp4");
    assert.equal(f1x1.dlAria, "Download 1:1");

    // Verify clicking top-right Download for every ratio (16:9, 9:16, 1:1) triggers a real browser download
    // with the expected filename, valid non-empty MP4 bytes, and no page navigation.
    const urlBeforeDownloads = page.url();
    for (const [ratioId, expectedFilename] of [
      ["16:9", "the-foxs-winter-lantern-16x9.mp4"],
      ["9:16", "the-foxs-winter-lantern-9x16.mp4"],
      ["1:1", "the-foxs-winter-lantern-1x1.mp4"]
    ]) {
      const dlLink = page.locator(`.pf-frame[data-ratio="${ratioId}"] a.pf-download-btn`);
      const hrefVal = await dlLink.getAttribute("href");
      assert.ok(hrefVal?.includes("download=1"), `Expected download=1 on ${ratioId} href: ${hrefVal}`);
      assert.ok(
        hrefVal?.includes(`filename=${encodeURIComponent(expectedFilename)}`),
        `Expected filename query param on ${ratioId} href: ${hrefVal}`
      );
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10_000 }),
        dlLink.click()
      ]);
      assert.equal(download.suggestedFilename(), expectedFilename);
      const savedPath = await download.path();
      assert.ok(savedPath, `Download for ${ratioId} must resolve a local path`);
      const downloadedBytes = readFileSync(savedPath);
      assert.ok(downloadedBytes.length > 100, `Downloaded MP4 for ${ratioId} must be non-empty`);
      assert.equal(downloadedBytes.subarray(4, 8).toString("ascii"), "ftyp", `Downloaded file for ${ratioId} must be a valid MP4`);
      assert.equal(page.url(), urlBeforeDownloads, `Clicking Download ${ratioId} must not change page URL`);
    }

    // Verify pause-other-player coordination (and that unrelated videos outside .pf are not paused)
    const playBtn16x9 = page.locator('.pf-frame[data-ratio="16:9"] button.pf-play-btn');
    const playBtn9x16 = page.locator('.pf-frame[data-ratio="9:16"] button.pf-play-btn');

    await page.evaluate(() => {
      const ext = document.createElement("video");
      ext.id = "external-site-video";
      ext.muted = true;
      ext.src = "/api/backend/projects/ext/plates/export/16-9";
      document.body.appendChild(ext);
      return ext.play();
    });

    await playBtn16x9.click();
    await page.waitForFunction(() => {
      const v = document.querySelector('.pf-frame[data-ratio="16:9"] video.pf-video');
      return v && !v.paused;
    });

    await playBtn9x16.click();
    await page.waitForFunction(() => {
      const v16 = document.querySelector('.pf-frame[data-ratio="16:9"] video.pf-video');
      const v9 = document.querySelector('.pf-frame[data-ratio="9:16"] video.pf-video');
      return v16 && v16.paused && v9 && !v9.paused;
    });
    const externalStillPlaying = await page.evaluate(() => {
      const ext = document.getElementById("external-site-video");
      const ok = Boolean(ext && !ext.paused);
      ext?.remove();
      return ok;
    });
    assert.equal(externalStillPlaying, true, "Unrelated video outside FinalView must not be paused");
    await playBtn9x16.click();

    // Check 1280x900 desktop
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-three-ratios-dark-1280x900.png")
    });

    // Check shorter desktop 1135x620
    await page.setViewportSize({ width: 1135, height: 620 });
    const shortCheck = await page.evaluate(() => ({
      overflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    assert.equal(shortCheck.overflowY, false, "Shorter desktop 1135x620 must not overflow vertically");
    assert.equal(shortCheck.overflowX, false, "Shorter desktop 1135x620 must not overflow horizontally");
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-three-ratios-dark-1135x620.png")
    });

    // Check narrow/mobile 390x844 layout
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCheck = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      framesCount: document.querySelectorAll(".pf-frame").length
    }));
    assert.equal(mobileCheck.overflowX, false, "Mobile 390x844 must not overflow horizontally");
    assert.equal(mobileCheck.framesCount, 3);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-three-ratios-dark-390x844.png")
    });

    // =========================================================================
    // Part 3: Plates single 9:16, Two-ratio view, Preparing state, and Failed+Approved state
    // =========================================================================
    await page.setViewportSize({ width: 1135, height: 775 });
    activePlateState = "t-plate-final-single-9x16";
    await page.goto(`${origin}/dev/plate-preview-fixture?state=t-plate-final-single-9x16&theme=dark`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="9:16"] video.pf-video');
    assert.equal(await page.locator(".pf-frame").count(), 1, "Single-ratio Plates state must render 1 centered player");
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-single-9x16-dark-1135x775.png")
    });

    activePlateState = "s-plate-final-two-ratios";
    await page.goto(`${origin}/dev/plate-preview-fixture?state=s-plate-final-two-ratios&theme=dark`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="9:16"] video.pf-video');
    assert.equal(await page.locator(".pf-frame").count(), 2, "Two-ratio state must render exactly 2 players");
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-two-ratios-dark-1135x775.png")
    });

    // Mixed ready + preparing (k-plate-final)
    activePlateState = "k-plate-final";
    await page.goto(`${origin}/dev/plate-preview-fixture?state=k-plate-final&theme=light`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="9:16"] video.pf-video');
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-mixed-preparing-light-1135x775.png")
    });

    assert.equal(await page.locator(".pf-frame a.pf-download-btn").count(), 2);
    const prepFrame = page.locator('.pf-frame[data-ratio="1:1"]');
    assert.equal(await prepFrame.locator("a.pf-download-btn").count(), 0, "Preparing ratio must not have a download link");
    const prepChip = prepFrame.locator('.pf-download-status[aria-busy="true"]');
    assert.equal((await prepChip.textContent())?.trim(), "1:1: preparing…");
    assert.equal((await prepFrame.locator(".pf-wait").textContent())?.trim(), "Preparing 1:1… 65%");

    // Mixed ready + failed + approved (q-plate-final-approved)
    activePlateState = "q-plate-final-approved";
    await page.goto(`${origin}/dev/plate-preview-fixture?state=q-plate-final-approved&theme=light`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="1:1"] .pf-wait');
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-mixed-failed-approved-light-1135x775.png")
    });

    const failedFrame = page.locator('.pf-frame[data-ratio="1:1"]');
    assert.equal(await failedFrame.locator("a.pf-download-btn").count(), 0, "Failed ratio must not have a download link");
    assert.equal(
      (await failedFrame.locator(".pf-download-status").textContent())?.trim(),
      "1:1: failed"
    );
    assert.equal(
      (await failedFrame.locator(".pf-wait").textContent())?.trim(),
      "Square 1:1 export timed out."
    );
    const plateLocked = page.locator(".pf-actions .aw-locked");
    assert.equal((await plateLocked.textContent())?.trim(), "✓ Approved · locked");

    // =========================================================================
    // Part 4: Sleek media error overlay & Reload action (1135x775 single 9:16, 3-up narrow portrait, and 390x844 mobile)
    // =========================================================================
    activePlateState = "t-plate-final-single-9x16";
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.goto(`${origin}/dev/plate-preview-fixture?state=t-plate-final-single-9x16&theme=dark`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="9:16"] video.pf-video');
    await page.evaluate(() => {
      const v = document.querySelector('.pf-frame[data-ratio="9:16"] video.pf-video');
      v?.dispatchEvent(new Event("error"));
    });
    const errOverlay916 = page.locator('.pf-frame[data-ratio="9:16"] .pf-overlay-badge--error');
    await errOverlay916.waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-error-single-9x16-dark-1135x775.png")
    });

    const errSingleMetrics = await page.evaluate(() => {
      const frame = document.querySelector('.pf-frame[data-ratio="9:16"]');
      const badge = frame?.querySelector(".pf-overlay-badge--error");
      const btn = badge?.querySelector("button.pf-retry-media");
      if (!frame || !badge || !btn) return null;
      const fr = frame.getBoundingClientRect();
      const br = badge.getBoundingClientRect();
      const btr = btn.getBoundingClientRect();
      const style = getComputedStyle(badge);
      return {
        frameWidth: fr.width,
        badgeWidth: br.width,
        badgeHeight: br.height,
        borderRadius: parseFloat(style.borderRadius),
        fitsInsideFrame: br.left >= fr.left + 8 && br.right <= fr.right - 8,
        btnWidth: btr.width,
        btnHeight: btr.height,
        text: badge.textContent?.trim()
      };
    });
    assert.ok(errSingleMetrics, "Error overlay metrics must exist");
    assert.ok(errSingleMetrics.borderRadius <= 14, `Expected modest corner radius <= 14px (not 999px pill), got ${errSingleMetrics.borderRadius}`);
    assert.equal(errSingleMetrics.fitsInsideFrame, true, "Error overlay must fit inside portrait frame with safe margins");
    assert.ok(errSingleMetrics.badgeHeight <= 84, `Expected sleek compact error panel height <= 84px, got ${errSingleMetrics.badgeHeight}`);
    assert.ok(errSingleMetrics.btnHeight >= 24 && errSingleMetrics.btnWidth >= 48, `Expected accessible Reload button size, got ${errSingleMetrics.btnWidth}x${errSingleMetrics.btnHeight}`);

    // Keyboard activation on Reload clears error and reloads video metadata
    const retryBtn = errOverlay916.locator("button.pf-retry-media");
    await retryBtn.focus();
    await page.keyboard.press("Enter");
    await errOverlay916.waitFor({ state: "hidden", timeout: 5_000 });

    // Check narrow portrait inside 3-up comparison at 1135x775 and mobile 390x844
    activePlateState = "r-plate-final-all-ready";
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.goto(`${origin}/dev/plate-preview-fixture?state=r-plate-final-all-ready&theme=dark`, {
      waitUntil: "networkidle"
    });
    await page.waitForSelector('.pf-frame[data-ratio="9:16"] video.pf-video');
    await page.evaluate(() => {
      const v = document.querySelector('.pf-frame[data-ratio="9:16"] video.pf-video');
      v?.dispatchEvent(new Event("error"));
    });
    await errOverlay916.waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-error-three-up-9x16-dark-1135x775.png")
    });
    const narrow3UpMetrics = await page.evaluate(() => {
      const frame = document.querySelector('.pf-frame[data-ratio="9:16"]');
      const badge = frame?.querySelector(".pf-overlay-badge--error");
      if (!frame || !badge) return null;
      const fr = frame.getBoundingClientRect();
      const br = badge.getBoundingClientRect();
      return {
        fits: br.left >= fr.left + 4 && br.right <= fr.right - 4,
        badgeHeight: br.height
      };
    });
    assert.equal(narrow3UpMetrics?.fits, true, "Error overlay must fit inside narrow 3-up 9:16 portrait frame without clipping");
    assert.ok((narrow3UpMetrics?.badgeHeight ?? 999) <= 90, `Expected compact height in narrow 3-up portrait frame, got ${narrow3UpMetrics?.badgeHeight}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "plates-error-mobile-390x844.png")
    });
    const mobileErrMetrics = await page.evaluate(() => {
      const frame = document.querySelector('.pf-frame[data-ratio="9:16"]');
      const badge = frame?.querySelector(".pf-overlay-badge--error");
      if (!frame || !badge) return null;
      const fr = frame.getBoundingClientRect();
      const br = badge.getBoundingClientRect();
      return {
        fits: br.left >= fr.left + 6 && br.right <= fr.right - 6,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });
    assert.equal(mobileErrMetrics?.fits, true, "Error overlay must fit on mobile 390x844");
    assert.equal(mobileErrMetrics?.overflowX, false, "Mobile 390x844 with error overlay must not overflow horizontally");
  } finally {
    await browser.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  test(
    "FinalView headless Chrome interaction on both fixture pages: branded video controls, per-player top-right downloads, multi-ratio comparison layout, pause-other-player coordination, and Approve/Back states",
    { timeout: 120_000 },
    async () => {
      const { srv, origin, port } = await startFixtureServer();
      try {
        await runFinalViewAssertions(origin, port);
      } finally {
        await new Promise((r) => srv.close(r));
      }
    }
  );
}
