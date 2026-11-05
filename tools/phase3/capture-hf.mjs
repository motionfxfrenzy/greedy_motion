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
const HF_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/hf");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const outDirArg = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(HERE, "hf-baseline");
mkdirSync(outDirArg, { recursive: true });

const COMPOSITION_HTML = readFileSync(join(HF_FIXTURES_DIR, "composition.html"), "utf8");
const COMPOSITION_JSON = JSON.parse(readFileSync(join(HF_FIXTURES_DIR, "composition.json"), "utf8"));
const SILENT_WAV = readFileSync(join(HF_FIXTURES_DIR, "silent.wav"));
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");

function makePortraitHtml(html) {
  return html
    .replace(/data-width="1920"/, 'data-width="1080"')
    .replace(/data-height="1080"/, 'data-height="1920"')
    .replace(/content="width=1920, height=1080"/, 'content="width=1080, height=1920"')
    .replace(/\\"canvas\\":\\"16:9\\"/g, '\\"canvas\\":\\"9:16\\"');
}

const COMPOSITION_PORTRAIT_HTML = makePortraitHtml(COMPOSITION_HTML);

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
nextjs-portal {
  display: none !important;
  opacity: 0 !important;
}
`;

export const HF_STATES = [
  "a1-prep-frames",
  "a2-prep-voice",
  "a3-prep-motion",
  "b-prep-error",
  "c-ready",
  "d-comments",
  "e-token-modal",
  "f-scene-selected",
  "g1-prep-no-frames",
  "g2-preview-error",
  "g3-applying-comments",
  "g4-portrait-9x16"
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

const READY_PLAYER_STATES = new Set([
  "c-ready",
  "d-comments",
  "e-token-modal",
  "f-scene-selected",
  "g3-applying-comments",
  "g4-portrait-9x16"
]);

async function waitForHfPlayerReady(page) {
  await page.waitForSelector("hyperframes-player", { timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const player = document.querySelector("hyperframes-player");
      if (!player) return false;
      const iframe = player.iframeElement;
      const win = iframe?.contentWindow;
      const doc = iframe?.contentDocument;
      return Boolean(
        player.ready &&
          win &&
          win.__timelines &&
          win.__timelines.main &&
          doc &&
          doc.readyState === "complete"
      );
    },
    { timeout: 15_000 }
  );
  await page.evaluate(async (cssText) => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    await document.fonts.ready;
    const player = document.querySelector("hyperframes-player");
    if (player?.shadowRoot && !player.shadowRoot.getElementById("hf-deterministic-css")) {
      const s = document.createElement("style");
      s.id = "hf-deterministic-css";
      s.textContent = cssText;
      player.shadowRoot.appendChild(s);
    }
    const doc = player?.iframeElement?.contentDocument;
    if (doc) {
      if (!doc.getElementById("hf-deterministic-css")) {
        const style = doc.createElement("style");
        style.id = "hf-deterministic-css";
        style.textContent = cssText;
        doc.head.appendChild(style);
      }
      if (doc.fonts?.ready) {
        await doc.fonts.ready;
      }
      const audios = Array.from(doc.querySelectorAll("audio"));
      for (const a of audios) {
        a.pause();
      }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, DETERMINISTIC_CSS);
}

async function lockPlayerAtTime(page, targetSeconds) {
  await page.evaluate(async (sec) => {
    window.scrollTo(0, 0);
    const player = document.querySelector("hyperframes-player");
    if (!player) return;
    const visualSec = sec === 0 ? 0.9 : sec === 8 ? 8.9 : sec;
    player.pause();
    player.currentTime = sec;
    const win = player.iframeElement?.contentWindow;
    if (win?.gsap?.globalTimeline) {
      win.gsap.globalTimeline.pause();
    }
    if (win?.__timelines?.main) {
      win.__timelines.main.pause(visualSec);
    }
    await new Promise((r) => setTimeout(r, 80));
    player.pause();
    if (win?.gsap?.globalTimeline) {
      win.gsap.globalTimeline.pause();
    }
    if (win?.__timelines?.main) {
      win.__timelines.main.pause(visualSec);
    }
    player.dispatchEvent(new CustomEvent("timeupdate", { detail: { currentTime: sec } }));
    const doc = player.iframeElement?.contentDocument;
    if (doc) {
      doc.querySelectorAll("audio, video").forEach((m) => {
        try {
          m.pause();
        } catch {
          // ignore
        }
      });
    }
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 40));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, targetSeconds);
}

async function seekOnTimeline(page, targetSeconds, duration = 20) {
  await page.evaluate(
    ({ sec, dur }) => {
      const track = document.querySelector('div.ce-track[role="slider"], div.aw-track[role="slider"]');
      if (!track) throw new Error("Timeline track not found");
      const box = track.getBoundingClientRect();
      const clientX = box.left + (sec / dur) * box.width;
      const clientY = box.top + box.height / 2;
      track.setPointerCapture = () => {};
      track.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          pointerId: 1
        })
      );
      track.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          pointerId: 1
        })
      );
    },
    { sec: targetSeconds, dur: duration }
  );
}

async function addCommentInUi(page, text) {
  await page.evaluate((val) => {
    const textarea = document.querySelector(".ce-composer textarea, .aw-compose textarea");
    if (!textarea) throw new Error("Comment textarea not found");
    const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    proto?.set?.call(textarea, val);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
  const addBtn = page.locator("button.ce-add, .aw-compose button.primary-button").first();
  await addBtn.dispatchEvent("click");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
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
    await waitForServer(`${origin}/dev/hf-step-fixture`);
    console.log("Next dev server ready. Launching headless Chrome...");

    // --disable-partial-raster: Chromium's partial raster (damage-rect re-raster) varies run to run on the multi-step d-comments and
    // g3-applying-comments states (2-56 px, delta <= 18 at rounded corners, even at commits before Phase 4a); full-tile raster is repeatable.
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--disable-partial-raster"]
    });

    let activeState = "c-ready";

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1
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

      if (url.pathname.endsWith("/me/tokens")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            remaining: 5,
            plan: null,
            free: { granted: 33, used: 28, remaining: 5 },
            packs: { remaining: 0 },
            recent: []
          })
        });
        return;
      }

      if (/\/projects\/[^/]+\/composition$/.test(url.pathname)) {
        const meta =
          activeState === "g4-portrait-9x16"
            ? { ...COMPOSITION_JSON, canvas: "9:16" }
            : COMPOSITION_JSON;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(meta)
        });
        return;
      }

      if (/^\/api\/preview\/plans\/[^/]+$/.test(url.pathname)) {
        if (activeState === "g2-preview-error") {
          await route.fulfill({
            status: 503,
            contentType: "text/plain; charset=utf-8",
            body: "Preview unavailable"
          });
          return;
        }
        const html =
          activeState === "g4-portrait-9x16" ? COMPOSITION_PORTRAIT_HTML : COMPOSITION_HTML;
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: html
        });
        return;
      }

      if (
        url.pathname === "/api/preview/runtime.js" ||
        url.pathname.endsWith("hyperframe.runtime.iife.js")
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: RUNTIME_JS
        });
        return;
      }

      if (url.pathname === "/api/preview/gsap.js" || url.pathname.endsWith("gsap.min.js")) {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: GSAP_JS
        });
        return;
      }

      if (url.pathname.startsWith("/api/preview/fonts/")) {
        const fontFile = url.pathname.slice("/api/preview/fonts/".length);
        try {
          const buf = readFileSync(join(WORKER_FONTS_DIR, fontFile));
          await route.fulfill({
            status: 200,
            contentType: "font/woff2",
            body: buf
          });
        } catch {
          await route.fulfill({ status: 404, body: "" });
        }
        return;
      }

      if (url.pathname.includes("/audio/") || url.pathname.includes("/plan-sfx/")) {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: SILENT_WAV
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

    for (const state of HF_STATES) {
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
              // ignore
            }
          }, theme);

          const targetUrl = `${origin}/dev/hf-step-fixture?state=${encodeURIComponent(state)}&theme=${encodeURIComponent(theme)}`;
          await page.goto(targetUrl, { waitUntil: "networkidle" });
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            localStorage.setItem("gm-theme", t);
            document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
          }, theme);

          if (READY_PLAYER_STATES.has(state)) {
            await waitForHfPlayerReady(page);
            await lockPlayerAtTime(page, 0);
          } else {
            await page.evaluate(async () => {
              document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
              await document.fonts.ready;
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            });
          }

          if (state === "d-comments" || state === "g3-applying-comments") {
            await addCommentInUi(page, "Tighten the opening headline so it lands faster.");
            await seekOnTimeline(page, 6);
            await lockPlayerAtTime(page, 6);
            await addCommentInUi(page, "Emphasize the storyboard timeline transition here.");
            if (state === "g3-applying-comments") {
              const applyBtn = page.locator("button.ce-apply, button.aw-apply").first();
              await applyBtn.dispatchEvent("click");
              await page.mouse.move(0, 0);
            }
            await lockPlayerAtTime(page, 6);
          } else if (state === "e-token-modal") {
            const renderBtn = page.locator("button.ce-approve, button.aw-render-top").first();
            await renderBtn.dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-labelledby="sc-modal-title"]');
            await lockPlayerAtTime(page, 0);
          } else if (state === "f-scene-selected") {
            await seekOnTimeline(page, 8);
            const oldStripItem = page.locator(".ce-strip > div:nth-child(3)");
            if ((await oldStripItem.count()) > 0) {
              await oldStripItem.hover();
            } else {
              const newTab = page.locator(".aw-segments > li:nth-child(3)");
              if ((await newTab.count()) > 0) {
                await newTab.hover();
              }
            }
            await lockPlayerAtTime(page, 8);
          }

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
