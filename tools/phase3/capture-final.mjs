#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const WS_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/workspace");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const outDirArg = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(HERE, "hf-final-baseline");
mkdirSync(outDirArg, { recursive: true });

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));

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
  scrollbar-width: none !important;
}
*::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
nextjs-portal,
video::-webkit-media-controls-loading-panel,
video::-internal-media-controls-loading-panel {
  display: none !important;
  opacity: 0 !important;
}
`;

export const HF_FINAL_STATES = [
  "a-ready-16x9",
  "b-ready-9x16",
  "c-ready-approved",
  "d-ready-seek-mid",
  "e1-rendering-waiting",
  "e2-rendering-frames",
  "e3-rendering-encoding",
  "f-rendering-retry",
  "g-failed"
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

async function settleFinalPage(page, state) {
  await page.waitForTimeout(80);
  const isReadyState =
    state === "a-ready-16x9" ||
    state === "b-ready-9x16" ||
    state === "c-ready-approved" ||
    state === "d-ready-seek-mid";

  if (isReadyState) {
    await page.waitForSelector("video", { timeout: 10_000 });
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      if (!v) return false;
      const src = v.getAttribute("src") ?? "";
      return src.includes("t=fixture-token");
    });
  } else {
    await page.waitForSelector(".render-workspace", { timeout: 10_000 });
  }

  await page.evaluate(async (st) => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    await document.fonts.ready;

    // Ensure FrameReel is pinned on frame 1 if present
    const firstFrameBtn = document.querySelector('button[aria-label="Show frame 1"]');
    if (firstFrameBtn instanceof HTMLElement) {
      firstFrameBtn.click();
    }

    // Wait for all images (including SVG data URLs) to decode
    const imgs = Array.from(document.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        try {
          if (!img.complete) {
            await new Promise((res) => {
              img.addEventListener("load", () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            });
          }
          await img.decode();
        } catch {
          // ignore
        }
      })
    );

    const v = document.querySelector("video");
    if (v) {
      // Decode poster image if set
      const posterAttr = v.getAttribute("poster");
      if (posterAttr) {
        try {
          const pImg = new Image();
          pImg.src = posterAttr;
          await pImg.decode();
        } catch {
          // ignore
        }
      }

      // Preload full video data so native <video controls> reaches HAVE_ENOUGH_DATA (readyState 4)
      // and hides the buffering spinner while keeping the poster visible at currentTime === 0.
      v.preload = "auto";
      if (v.readyState < 4) {
        await new Promise((res) => {
          const done = () => res();
          v.addEventListener("canplaythrough", done, { once: true });
          v.addEventListener("error", done, { once: true });
          v.load();
        });
      }
      v.pause();

      if (st === "d-ready-seek-mid") {
        const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 4;
        const target = dur / 2;
        await new Promise((res) => {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            res();
          };
          v.addEventListener("seeked", onSeeked);
          v.currentTime = target;
        });
        if (v.readyState < 4) {
          await new Promise((res) => {
            v.addEventListener("canplaythrough", () => res(), { once: true });
            setTimeout(res, 300);
          });
        }
        v.pause();
        v.dispatchEvent(new Event("timeupdate"));
      }
    }

    await new Promise((r) => setTimeout(r, 650));
    for (const anim of document.getAnimations({ subtree: true })) {
      try {
        anim.finish();
      } catch {
        // ignore infinite animations
      }
    }
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, state);
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
  nextProc.stdout?.resume();
  nextProc.stderr?.resume();

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
    await waitForServer(`${origin}/dev/hf-final-fixture`);
    console.log("Next dev server ready. Launching headless Chrome...");

    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1
    });

    // Prevent FrameReel 2500ms interval from advancing frames mid-capture
    await context.addInitScript(() => {
      const origSetInterval = window.setInterval.bind(window);
      window.setInterval = (fn, ms, ...args) => {
        if (ms === 2500) return 0;
        return origSetInterval(fn, ms, ...args);
      };
    });

    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.hostname === "fonts.googleapis.com") {
        await route.fulfill({
          status: 200,
          contentType: "text/css; charset=utf-8",
          body: FONT_CSS
        });
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

      if (url.pathname.endsWith(".mp4")) {
        const isPortrait = url.pathname.includes("9x16") || url.pathname.includes("9-16");
        const buf = isPortrait ? CLIP_9X16 : CLIP_16X9;
        const rangeHeader = req.headers()["range"];
        if (rangeHeader) {
          const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
          if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Math.min(buf.length - 1, Number(m[2])) : buf.length - 1;
            const chunk = buf.subarray(start, end + 1);
            await route.fulfill({
              status: 206,
              headers: {
                "Content-Type": "video/mp4",
                "Accept-Ranges": "bytes",
                "Content-Range": `bytes ${start}-${end}/${buf.length}`,
                "Content-Length": String(chunk.length)
              },
              body: chunk
            });
            return;
          }
        }
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
            "Content-Length": String(buf.length)
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

    for (const state of HF_FINAL_STATES) {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await page.mouse.move(0, 0);
          await page.evaluate((t) => {
            try {
              localStorage.setItem("gm-theme", t);
              document.documentElement.dataset.theme = t;
            } catch {
              // ignore
            }
          }, theme);

          const targetUrl = `${origin}/dev/hf-final-fixture?state=${encodeURIComponent(state)}&theme=${encodeURIComponent(theme)}`;
          await page.goto(targetUrl, { waitUntil: "networkidle" });
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            localStorage.setItem("gm-theme", t);
            document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
          }, theme);

          await settleFinalPage(page, state);
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
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
