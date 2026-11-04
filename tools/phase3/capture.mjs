#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { fixturePlateExport, fixturePlateStatus } from "../../frontend/test/fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/workspace");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const outDirArg = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(HERE, "baseline");
mkdirSync(outDirArg, { recursive: true });

const CLIP_16X9 = readFileSync(join(FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(FIXTURES_DIR, "clip-9x16.mp4"));
const CLIP_1X1 = readFileSync(join(FIXTURES_DIR, "clip-1x1.mp4"));
const STILL_16X9_URI = `data:image/png;base64,${readFileSync(join(FIXTURES_DIR, "still-16x9.png")).toString("base64")}`;
const STILL_9X16_URI = `data:image/png;base64,${readFileSync(join(FIXTURES_DIR, "still-9x16.png")).toString("base64")}`;
const STILL_1X1_URI = `data:image/png;base64,${readFileSync(join(FIXTURES_DIR, "still-1x1.png")).toString("base64")}`;
const VOICE_WAV = readFileSync(join(FIXTURES_DIR, "voice.wav"));

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

const DETERMINISTIC_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-play-state: paused !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
nextjs-portal,
video::-webkit-media-controls-loading-panel,
video::-internal-media-controls-loading-panel {
  display: none !important;
  opacity: 0 !important;
}
`;

export const STATES = [
  "a-prep-drawing",
  "b-prep-error",
  "c-ready",
  "d-comments",
  "e-audio-open",
  "f-subtitle-style",
  "g-token-modal",
  "h-scene-updating",
  "i-aspect-picker",
  "j-hover-volume-fullscreen",
  "k-plate-final",
  "l-subtitle-mode",
  "m-subtitle-colors",
  "n-subtitle-opacity",
  "o-subtitle-position",
  "p-aspect-drawing",
  "q-plate-final-approved"
];

const WIDTHS = [1280, 400];
const THEMES = ["light", "dark"];

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
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for Next dev server at ${url}`);
}

async function freezeVideosForScreenshot(page) {
  await page.evaluate(
    async ({ s16x9, s9x16, s1x1 }) => {
      const preload = async (uri) => {
        const img = new Image();
        img.src = uri;
        try {
          await img.decode();
        } catch {
          // ignore
        }
      };
      await Promise.all([preload(s16x9), preload(s9x16), preload(s1x1)]);
      const audios = Array.from(document.querySelectorAll("audio"));
      for (const a of audios) {
        a.pause();
        a.removeAttribute("src");
        a.load();
      }
      const vids = Array.from(document.querySelectorAll("video"));
      for (const v of vids) {
        const src = v.getAttribute("src") ?? "";
        const uri =
          src.includes("aspect=9%3A16") || src.includes("aspect=9:16") || src.endsWith("/9-16")
            ? s9x16
            : src.includes("aspect=1%3A1") || src.includes("aspect=1:1") || src.endsWith("/1-1")
            ? s1x1
            : s16x9;
        v.pause();
        v.style.content = `url("${uri}")`;
        if (!v.controls) {
          v.removeAttribute("src");
          v.load();
        }
      }
      await new Promise((r) => setTimeout(r, 40));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    { s16x9: STILL_16X9_URI, s9x16: STILL_9X16_URI, s1x1: STILL_1X1_URI }
  );
}

async function waitForVideosReady(page) {
  await page.waitForTimeout(120);
  await page.waitForFunction(() => {
    const media = Array.from(document.querySelectorAll("video, audio[src*='/plans/']"));
    return media.every((el) => {
      const s = el.getAttribute("src") ?? "";
      return !s.includes("/v1/") || s.includes("t=fixture-token");
    });
  });
  await page.evaluate(async () => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    await document.fonts.ready;
    const audios = Array.from(document.querySelectorAll("audio"));
    await Promise.all(
      audios.map((a) =>
        a.readyState >= 1
          ? Promise.resolve()
          : new Promise((res) => {
              a.addEventListener("loadedmetadata", () => res(), { once: true });
              a.addEventListener("error", () => res(), { once: true });
            })
      )
    );
    const vids = Array.from(document.querySelectorAll("video"));
    await Promise.all(
      vids.map(
        (v) =>
          new Promise((res) => {
            v.preload = "auto";
            const done = () => {
              v.pause();
              if (v.seeking) {
                v.addEventListener("seeked", () => res(), { once: true });
              } else {
                res();
              }
            };
            if (v.readyState >= 4) {
              done();
            } else {
              v.addEventListener("canplaythrough", done, { once: true });
              v.addEventListener("error", () => res(), { once: true });
              // Nudge preload="metadata" videos to buffer frame data so native controls hide their spinner
              if (v.readyState < 3 && v.currentTime === 0) {
                v.currentTime = 0.001;
              }
            }
          })
      )
    );
    await new Promise((r) => setTimeout(r, 120));
    await Promise.all(
      vids.map((v) =>
        v.seeking
          ? new Promise((res) => v.addEventListener("seeked", () => res(), { once: true }))
          : Promise.resolve()
      )
    );
    for (const v of vids) {
      if (v.classList.contains("on")) {
        v.dispatchEvent(new Event("timeupdate"));
      }
    }
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function main() {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  console.log(`Starting Next dev server on ${origin}...`);

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

  let browser = null;
  const cleanup = () => {
    if (nextProc && !nextProc.killed) {
      try {
        nextProc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    await waitForServer(`${origin}/dev/plate-preview-fixture`);
    console.log("Next dev server ready. Launching headless Chrome...");

    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true
    });

    let activeState = "c-ready";

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1
    });

    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      // Intercept Google Fonts CSS so no external request is ever made
      if (url.hostname === "fonts.googleapis.com") {
        await route.fulfill({
          status: 200,
          contentType: "text/css; charset=utf-8",
          body: FONT_CSS
        });
        return;
      }

      // Intercept media-token
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

      // Intercept plates status & draw
      if (
        /\/projects\/[^/]+\/plates$/.test(url.pathname) ||
        /\/projects\/[^/]+\/plates\/draw$/.test(url.pathname) ||
        /\/projects\/[^/]+\/plates\/draw-aspect$/.test(url.pathname) ||
        /\/projects\/[^/]+\/plates\/fix$/.test(url.pathname)
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fixturePlateStatus(activeState))
        });
        return;
      }

      // Intercept subtitles save
      if (/\/projects\/[^/]+\/plates\/subtitles$/.test(url.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fixturePlateStatus(activeState).subtitles ?? { mode: "full", style: "paper" })
        });
        return;
      }

      // Intercept companion ratio export status
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
          body: JSON.stringify(fixturePlateExport(activeState, aspect))
        });
        return;
      }

      // Intercept video clips & exported videos
      if (/\/plates\/\d+\/clip$/.test(url.pathname) || /\/plates\/export\/(16-9|9-16|1-1)$/.test(url.pathname)) {
        const aspect = url.searchParams.get("aspect") ?? (url.pathname.endsWith("9-16") ? "9:16" : url.pathname.endsWith("1-1") ? "1:1" : "16:9");
        const buf = aspect === "9:16" ? CLIP_9X16 : aspect === "1:1" ? CLIP_1X1 : CLIP_16X9;
        await route.fulfill({
          status: 200,
          contentType: "video/mp4",
          body: buf
        });
        return;
      }

      // Intercept voice, music, and SFX audio files
      if (url.pathname.includes("/audio/") || url.pathname.includes("/plan-sfx/")) {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: VOICE_WAV
        });
        return;
      }

      // Allow Next dev server asset requests on 127.0.0.1:${port}
      if (url.hostname === "127.0.0.1" && url.port === String(port)) {
        await route.continue();
        return;
      }

      // Block any other request
      await route.fulfill({ status: 204, body: "" });
    });

    const page = await context.newPage();

    for (const state of STATES) {
      activeState = state;
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await page.mouse.move(0, 0);
          await page.evaluate((t) => {
            try {
              localStorage.setItem("gm-theme", t);
              document.documentElement.dataset.theme = t;
            } catch {
              // ignore on about:blank
            }
          }, theme);

          const targetUrl = `${origin}/dev/plate-preview-fixture?state=${encodeURIComponent(state)}&theme=${encodeURIComponent(theme)}`;
          await page.goto(targetUrl, { waitUntil: "networkidle" });
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            localStorage.setItem("gm-theme", t);
          }, theme);

          if (state === "k-plate-final" || state === "q-plate-final-approved") {
            await page.waitForSelector(".pf-tabs button:nth-child(3)");
          } else {
            await page.waitForSelector(".pp-segments li:nth-child(5), .aw-segments li:nth-child(5)");
          }

          await waitForVideosReady(page);

          // Perform state-specific interactions
          if (state === "e-audio-open") {
            await page.locator('button[role="tab"]:has-text("Audio")').dispatchEvent("click");
            await page.waitForSelector('[role="group"][aria-label="Audio tracks"]');
          } else if (state === "f-subtitle-style") {
            await page
              .locator('button.pp-pill-item:has-text("Storybook"), button.aw-pill-item:has-text("Storybook")')
              .dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-label="Subtitle style"]');
          } else if (state === "g-token-modal") {
            await page.locator("button.pp-render-top, button.aw-render-top").dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-labelledby="sc-modal-title"]');
          } else if (state === "i-aspect-picker") {
            await page.locator("button.pp-dim-trigger, button.aw-dim-trigger").dispatchEvent("click");
            await page.waitForSelector(".pp-dim-rail.open, .aw-dim-rail.open");
            await page
              .locator('.pp-dim-option:has-text("9:16"), .aw-dim-option:has-text("9:16")')
              .dispatchEvent("click");
            await page.waitForSelector('[data-aspect="9:16"]');
            await waitForVideosReady(page);
          } else if (state === "j-hover-volume-fullscreen") {
            const fsBtn = page.locator('button[aria-label="Full screen"]');
            await fsBtn.focus();
            await page.evaluate(
              () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
            );
            const box = await fsBtn.boundingBox();
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            }
          } else if (state === "l-subtitle-mode") {
            await page
              .locator('button.pp-pill-item:has-text("Subtitles"), button.aw-pill-item:has-text("Subtitles")')
              .dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-label="Subtitle mode"]');
          } else if (state === "m-subtitle-colors") {
            await page.locator('button[aria-label="Subtitle colors"]').dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-label="Colors"]');
          } else if (state === "n-subtitle-opacity") {
            await page.locator('button[aria-label="Transparency"]').dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-label="Transparency"]');
          } else if (state === "o-subtitle-position") {
            await page
              .locator('button.pp-pill-item:has-text("Position"), button.aw-pill-item:has-text("Position")')
              .dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-label*="subtitle position"]');
          } else if (state === "p-aspect-drawing") {
            await page.locator("button.pp-dim-trigger, button.aw-dim-trigger").dispatchEvent("click");
            await page.waitForSelector(".pp-dim-rail.open, .aw-dim-rail.open");
            await page
              .locator('.pp-dim-option:has-text("9:16"), .aw-dim-option:has-text("9:16")')
              .dispatchEvent("click");
          }

          await freezeVideosForScreenshot(page);
          await page.evaluate(
            () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          );

          const fileName = `${state}-${width}-${theme}.png`;
          const filePath = join(outDirArg, fileName);
          await page.screenshot({ path: filePath, fullPage: false });
          console.log(`Captured ${fileName}`);
        }
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    cleanup();
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
