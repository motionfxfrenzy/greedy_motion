import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { fixturePlateStatus } from "./fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const WS_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/workspace");
const HF_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/hf");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const VOICE_WAV = readFileSync(join(WS_FIXTURES_DIR, "voice.wav"));
const COMPOSITION_HTML = readFileSync(join(HF_FIXTURES_DIR, "composition.html"), "utf8");
const COMPOSITION_JSON = JSON.parse(readFileSync(join(HF_FIXTURES_DIR, "composition.json"), "utf8"));
const SILENT_WAV = readFileSync(join(HF_FIXTURES_DIR, "silent.wav"));
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/animation-workspace.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/plate-preview.css"), "utf8")
].join("\n");

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

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

async function auditBarLayout(page, viewportWidth, label) {
  const audit = await page.evaluate(() => {
    const bar = document.querySelector('.aw-floating-bar[role="toolbar"]');
    const stage = document.querySelector(".aw-stage");
    const frame = document.querySelector(".aw-frame");
    const canvas = document.querySelector(".aw-canvas");
    const renderBtn = document.querySelector(".aw-render-top");
    const sidePanel = document.querySelector(".aw-side");
    if (!bar || !stage || !frame || !canvas) {
      throw new Error("Missing .aw-floating-bar, .aw-stage, .aw-frame, or .aw-canvas");
    }
    const roundRect = (r) => ({
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      right: Math.round(r.right * 100) / 100,
      bottom: Math.round(r.bottom * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100
    });
    const barRect = roundRect(bar.getBoundingClientRect());
    const stageRect = roundRect(stage.getBoundingClientRect());
    const frameRect = roundRect(frame.getBoundingClientRect());
    const canvasRect = roundRect(canvas.getBoundingClientRect());
    const renderRect = renderBtn ? roundRect(renderBtn.getBoundingClientRect()) : null;
    const sideRect = sidePanel ? roundRect(sidePanel.getBoundingClientRect()) : null;

    // Buttons plus the motion-blur checkbox label (a control since plate-motion-blur added it to the HyperFrames bar).
    const buttons = Array.from(bar.querySelectorAll("button, label.aw-blur"));
    const controls = buttons.map((btn, idx) => {
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hitEl = document.elementFromPoint(cx, cy);
      const hitSelfOrDescendant = Boolean(hitEl && (btn === hitEl || btn.contains(hitEl)));
      return {
        index: idx,
        label: (btn.textContent || "").trim() || btn.getAttribute("aria-label") || btn.className,
        ...roundRect(r),
        hitSelfOrDescendant,
        hitTag: hitEl ? `${hitEl.tagName}.${hitEl.className}` : "null"
      };
    });

    const statusEl = bar.querySelector(".aw-mini-status");
    const statusBox = statusEl
      ? (() => {
          const r = statusEl.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const hitEl = document.elementFromPoint(cx, cy);
          return {
            text: (statusEl.textContent || "").trim(),
            ...roundRect(r),
            hitSelfOrDescendant: Boolean(hitEl && (statusEl === hitEl || statusEl.contains(hitEl)))
          };
        })()
      : null;

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.documentElement.scrollWidth,
      barRect,
      stageRect,
      frameRect,
      canvasRect,
      renderRect,
      sideRect,
      controls,
      statusBox
    };
  });

  assert.equal(audit.innerWidth, viewportWidth, `${label}: viewport width matches ${viewportWidth}`);
  assert.ok(
    audit.scrollWidth <= audit.innerWidth,
    `${label}: no horizontal page scroll (scrollWidth=${audit.scrollWidth} <= innerWidth=${audit.innerWidth})`
  );
  assert.ok(
    audit.barRect.x >= 0 && audit.barRect.right <= audit.innerWidth,
    `${label}: .aw-floating-bar inside viewport horizontally (${audit.barRect.x}..${audit.barRect.right})`
  );
  assert.ok(
    audit.barRect.x >= audit.stageRect.x - 1 && audit.barRect.right <= audit.stageRect.right + 1,
    `${label}: .aw-floating-bar never exceeds .aw-stage width (bar=${audit.barRect.x}..${audit.barRect.right}, stage=${audit.stageRect.x}..${audit.stageRect.right})`
  );
  assert.ok(
    audit.barRect.bottom <= audit.frameRect.y && audit.barRect.bottom <= audit.canvasRect.y,
    `${label}: .aw-floating-bar (bottom=${audit.barRect.bottom}) does not overlap .aw-frame (y=${audit.frameRect.y}) or .aw-canvas (y=${audit.canvasRect.y})`
  );
  if (audit.renderRect) {
    assert.ok(
      !rectsOverlap(audit.barRect, audit.renderRect),
      `${label}: .aw-floating-bar does not overlap Render button`
    );
    assert.ok(
      audit.renderRect.x >= 0 && audit.renderRect.right <= audit.innerWidth,
      `${label}: Render button fully visible inside viewport (${audit.renderRect.x}..${audit.renderRect.right})`
    );
  }
  if (audit.sideRect) {
    assert.ok(
      !rectsOverlap(audit.barRect, audit.sideRect),
      `${label}: .aw-floating-bar does not overlap Comments panel`
    );
  }

  for (const ctrl of audit.controls) {
    assert.ok(
      ctrl.x >= 0 && ctrl.right <= audit.innerWidth,
      `${label}: control "${ctrl.label}" horizontally inside viewport (x=${ctrl.x}, right=${ctrl.right}, viewport=${audit.innerWidth})`
    );
    assert.ok(
      ctrl.x >= audit.stageRect.x - 1 && ctrl.right <= audit.stageRect.right + 1,
      `${label}: control "${ctrl.label}" inside stage width (x=${ctrl.x}, right=${ctrl.right}, stage=${audit.stageRect.x}..${audit.stageRect.right})`
    );
    assert.ok(
      ctrl.y >= 0 && ctrl.bottom <= audit.innerHeight,
      `${label}: control "${ctrl.label}" vertically inside viewport (y=${ctrl.y}, bottom=${ctrl.bottom})`
    );
    assert.ok(
      ctrl.hitSelfOrDescendant,
      `${label}: control "${ctrl.label}" not covered at centre (elementFromPoint=${ctrl.hitTag})`
    );
    if (viewportWidth <= 560) {
      assert.ok(
        ctrl.height >= 32,
        `${label}: control "${ctrl.label}" touch height >= 32px at ${viewportWidth}px (got ${ctrl.height}px)`
      );
    }
  }

  if (audit.statusBox) {
    assert.ok(
      audit.statusBox.x >= 0 && audit.statusBox.right <= audit.innerWidth,
      `${label}: status chip "${audit.statusBox.text}" horizontally inside viewport (${audit.statusBox.x}..${audit.statusBox.right})`
    );
    assert.ok(
      audit.statusBox.x >= audit.stageRect.x - 1 && audit.statusBox.right <= audit.stageRect.right + 1,
      `${label}: status chip "${audit.statusBox.text}" inside stage width (${audit.statusBox.x}..${audit.statusBox.right})`
    );
    if (audit.renderRect) {
      assert.ok(
        !rectsOverlap(audit.statusBox, audit.renderRect),
        `${label}: status chip does not collide with Render button`
      );
    }
    assert.ok(
      audit.statusBox.hitSelfOrDescendant,
      `${label}: status chip "${audit.statusBox.text}" not covered at centre`
    );
  }

  // Verify sequential keyboard Tab focusability across every enabled button in the bar
  const enabledCount = await page.locator('.aw-floating-bar[role="toolbar"] button:not(:disabled), .aw-floating-bar[role="toolbar"] label.aw-blur input:not(:disabled)').count();
  assert.equal(enabledCount, audit.controls.length, `${label}: all bar controls are enabled`);

  const firstBtn = page.locator('.aw-floating-bar[role="toolbar"] button:not(:disabled), .aw-floating-bar[role="toolbar"] label.aw-blur input:not(:disabled)').first();
  await firstBtn.focus();
  for (let i = 0; i < audit.controls.length; i++) {
    const focusedIndex = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.aw-floating-bar[role="toolbar"] button:not(:disabled), .aw-floating-bar[role="toolbar"] label.aw-blur input:not(:disabled)'));
      return btns.indexOf(document.activeElement);
    });
    assert.equal(
      focusedIndex,
      i,
      `${label}: Tab stop ${i} focuses control "${audit.controls[i].label}" (got index ${focusedIndex})`
    );
    if (i < audit.controls.length - 1) {
      await page.keyboard.press("Tab");
    }
  }

  return audit;
}

async function auditPopovers(page, viewportWidth, popovers, label) {
  for (const pop of popovers) {
    const trigger = page.locator(pop.triggerSelector);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator(pop.dialogSelector);
    await dialog.waitFor({ state: "visible" });

    const box = await dialog.boundingBox();
    assert.ok(box, `${label}: popover "${pop.name}" has boundingBox`);
    assert.ok(
      box.x >= 0 && box.x + box.width <= viewportWidth,
      `${label}: popover "${pop.name}" horizontally inside viewport (x=${box.x}, right=${box.x + box.width}, viewport=${viewportWidth})`
    );
    assert.ok(
      box.y >= 0 && box.y + box.height <= 800,
      `${label}: popover "${pop.name}" vertically inside viewport (y=${box.y}, bottom=${box.y + box.height})`
    );

    const geom = await page.evaluate((sel) => {
      const dlg = document.querySelector(sel);
      const stage = document.querySelector(".aw-stage");
      const renderBtn = document.querySelector(".aw-render-top");
      const sidePanel = document.querySelector(".aw-side");
      if (!dlg || !stage) return null;
      const roundRect = (r) => ({
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        right: Math.round(r.right * 100) / 100,
        bottom: Math.round(r.bottom * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100
      });
      return {
        dlgRect: roundRect(dlg.getBoundingClientRect()),
        stageRect: roundRect(stage.getBoundingClientRect()),
        renderRect: renderBtn ? roundRect(renderBtn.getBoundingClientRect()) : null,
        sideRect: sidePanel ? roundRect(sidePanel.getBoundingClientRect()) : null
      };
    }, pop.dialogSelector);

    assert.ok(geom, `${label}: popover "${pop.name}" geometry measured`);
    assert.ok(
      geom.dlgRect.x >= geom.stageRect.x - 1 && geom.dlgRect.right <= geom.stageRect.right + 1,
      `${label}: popover "${pop.name}" stays inside stage horizontally (dlg=${geom.dlgRect.x}..${geom.dlgRect.right}, stage=${geom.stageRect.x}..${geom.stageRect.right})`
    );
    assert.ok(
      geom.dlgRect.width <= Math.min(320, geom.stageRect.width) + 1,
      `${label}: popover "${pop.name}" width <= min(320, stageWidth) (width=${geom.dlgRect.width})`
    );
    if (geom.renderRect) {
      assert.ok(
        !rectsOverlap(geom.dlgRect, geom.renderRect),
        `${label}: popover "${pop.name}" does not cover Render button`
      );
    }
    if (geom.sideRect && viewportWidth > 860) {
      assert.ok(
        !rectsOverlap(geom.dlgRect, geom.sideRect),
        `${label}: popover "${pop.name}" does not cover Comments panel`
      );
    }

    const scrollWidth = await page.evaluate(() =>
      document.scrollingElement ? document.scrollingElement.scrollWidth : document.documentElement.scrollWidth
    );
    assert.ok(
      scrollWidth <= viewportWidth,
      `${label}: opening popover "${pop.name}" does not cause horizontal scroll (scrollWidth=${scrollWidth} <= ${viewportWidth})`
    );

    const dialogUncovered = await page.evaluate((sel) => {
      const dlg = document.querySelector(sel);
      if (!dlg) return false;
      const r = dlg.getBoundingClientRect();
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 12, r.top + r.height / 2],
        [r.right - 12, r.top + r.height / 2]
      ];
      return pts.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (dlg === hit || dlg.contains(hit)));
      });
    }, pop.dialogSelector);
    assert.ok(dialogUncovered, `${label}: popover "${pop.name}" is not covered by stage overlays`);

    // Dismiss with Escape key and verify focus returns to trigger pill
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0, `${label}: Escape closes popover "${pop.name}"`);
  }

  // Also verify outside-click dismissal on the first popover
  if (popovers.length > 0) {
    const first = popovers[0];
    await page.locator(first.triggerSelector).click();
    const dlg = page.locator(first.dialogSelector);
    await dlg.waitFor({ state: "visible" });
    await page.mouse.click(5, 500);
    assert.equal(await dlg.count(), 0, `${label}: outside click closes popover "${first.name}"`);
  }
}

async function startFixtureServer() {
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
    import HfStepFixturePage from "./app/dev/hf-step-fixture/page.tsx";

    const path = window.location.pathname;
    const el = document.getElementById("root");
    if (el) {
      const root = createRoot(el);
      if (path.includes("hf-step-fixture")) {
        root.render(<HfStepFixturePage />);
      } else {
        root.render(<PlatePreviewFixturePage />);
      }
    }
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "workspace-bar-fixture-entry.tsx",
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
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'
      );
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

test(
  "OptionsBar layout at 400px, 900px, 1100px, and 1280px: Plates (Subtitle & Audio tabs, popovers, status chip) and HyperFrames",
  { timeout: 120_000 },
  async () => {
    const { srv, origin, port } = await startFixtureServer();

    let browser = null;
    let activePlateState = "c-ready";

    try {
      browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
      const context = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });

      await context.route("**/*", async (route) => {
        const req = route.request();
        const url = new URL(req.url());

        if (url.hostname === "fonts.googleapis.com") {
          await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: FONT_CSS });
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
        if (
          /\/projects\/[^/]+\/plates$/.test(url.pathname) ||
          /\/projects\/[^/]+\/plates\/draw$/.test(url.pathname) ||
          /\/projects\/[^/]+\/plates\/draw-aspect$/.test(url.pathname) ||
          /\/projects\/[^/]+\/plates\/fix$/.test(url.pathname)
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fixturePlateStatus(activePlateState))
          });
          return;
        }
        if (/\/projects\/[^/]+\/plates\/subtitles$/.test(url.pathname)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fixturePlateStatus(activePlateState).subtitles ?? { mode: "full", style: "paper" })
          });
          return;
        }
        if (/\/plates\/\d+\/clip$/.test(url.pathname)) {
          await route.fulfill({ status: 200, contentType: "video/mp4", body: CLIP_16X9 });
          return;
        }
        if (/\/projects\/[^/]+\/composition$/.test(url.pathname)) {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COMPOSITION_JSON) });
          return;
        }
        if (/^\/api\/preview\/plans\/[^/]+$/.test(url.pathname)) {
          if (activePlateState === "g2-preview-error") {
            await route.fulfill({ status: 503, contentType: "text/plain; charset=utf-8", body: "Preview unavailable" });
            return;
          }
          await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: COMPOSITION_HTML });
          return;
        }
        if (url.pathname === "/api/preview/runtime.js") {
          await route.fulfill({ status: 200, contentType: "application/javascript", body: RUNTIME_JS });
          return;
        }
        if (url.pathname === "/api/preview/gsap.js") {
          await route.fulfill({ status: 200, contentType: "application/javascript", body: GSAP_JS });
          return;
        }
        if (url.pathname.startsWith("/api/preview/fonts/")) {
          const fontFile = url.pathname.slice("/api/preview/fonts/".length);
          try {
            await route.fulfill({ status: 200, contentType: "font/woff2", body: readFileSync(join(WORKER_FONTS_DIR, fontFile)) });
          } catch {
            await route.fulfill({ status: 404, body: "" });
          }
          return;
        }
        if (url.pathname.includes("/audio/") || url.pathname.includes("/plan-sfx/")) {
          await route.fulfill({ status: 200, contentType: "audio/wav", body: url.pathname.includes("silent") ? SILENT_WAV : VOICE_WAV });
          return;
        }
        if (url.hostname === "127.0.0.1" && url.port === String(port)) {
          await route.continue();
          return;
        }
        await route.fulfill({ status: 204, body: "" });
      });

      const page = await context.newPage();

      const plateSubtitlePopovers = [
        {
          name: "captions",
          triggerSelector: '.aw-floating-bar button.aw-pill-item:has-text("Subtitles")',
          dialogSelector: '[role="dialog"][aria-label="Subtitle mode"]'
        },
        {
          name: "style",
          triggerSelector: '.aw-floating-bar button.aw-pill-item:has-text("Storybook")',
          dialogSelector: '[role="dialog"][aria-label="Subtitle style"]'
        },
        {
          name: "colors",
          triggerSelector: '.aw-floating-bar button[aria-label="Subtitle colors"]',
          dialogSelector: '[role="dialog"][aria-label="Colors"]'
        },
        {
          name: "opacity",
          triggerSelector: '.aw-floating-bar button[aria-label="Transparency"]',
          dialogSelector: '[role="dialog"][aria-label="Transparency"]'
        },
        {
          name: "position",
          triggerSelector: '.aw-floating-bar button.aw-pill-item:has-text("Position")',
          dialogSelector: '[role="dialog"][aria-label*="subtitle position"]'
        },
        {
          name: "quality",
          triggerSelector: '.aw-floating-bar button[aria-label="Preview quality"]',
          dialogSelector: '[role="dialog"][aria-label="Preview quality"]'
        }
      ];

      const plateAudioPopovers = [
        {
          name: "quality",
          triggerSelector: '.aw-floating-bar button[aria-label="Preview quality"]',
          dialogSelector: '[role="dialog"][aria-label="Preview quality"]'
        }
      ];

      const hfSubtitlePopovers = [
        {
          name: "captions",
          triggerSelector: '.aw-floating-bar button.aw-pill-item:has-text("Subtitles")',
          dialogSelector: '[role="dialog"][aria-label="Subtitle mode"]'
        }
      ];

      for (const width of [400, 900, 1100, 1280]) {
        await page.setViewportSize({ width, height: 800 });

        // 1. Plates c-ready: Subtitle tab (all 10 controls) + all 6 popovers
        activePlateState = "c-ready";
        await page.goto(`${origin}/dev/plate-preview-fixture?state=c-ready&theme=light`, { waitUntil: "networkidle" });
        await page.waitForSelector(".aw-segments li:nth-child(5)");
        await page.evaluate(() => document.fonts.ready);

        const subAudit = await auditBarLayout(page, width, `Plates Subtitle tab (${width}px)`);
        assert.equal(subAudit.controls.length, 10, `Plates Subtitle tab (${width}px) renders all 10 controls`);
        await auditPopovers(page, width, plateSubtitlePopovers, `Plates Subtitle popovers (${width}px)`);

        // 2. Plates c-ready: Audio tab (all 7 controls) + quality popover
        await page.locator('.aw-floating-bar button[role="tab"]:has-text("Audio")').click();
        await page.waitForSelector('[role="group"][aria-label="Audio tracks"]');
        const audioAudit = await auditBarLayout(page, width, `Plates Audio tab (${width}px)`);
        assert.equal(audioAudit.controls.length, 7, `Plates Audio tab (${width}px) renders all 7 controls`);
        await auditPopovers(page, width, plateAudioPopovers, `Plates Audio popovers (${width}px)`);

        // 3. Plates h-scene-updating: toolbar stays free of film chip; film progress toast & unready-scene banner float over stage
        activePlateState = "h-scene-updating";
        await page.goto(`${origin}/dev/plate-preview-fixture?state=h-scene-updating&theme=light`, { waitUntil: "networkidle" });
        await page.waitForSelector(".aw-segments li:nth-child(5)");
        await page.evaluate(() => document.fonts.ready);
        const statusSubAudit = await auditBarLayout(page, width, `Plates Subtitle+updating tab (${width}px)`);
        assert.equal(statusSubAudit.statusBox, null, `Plates Subtitle+updating tab (${width}px) keeps toolbar slot free of film chip`);
        assert.equal(await page.locator(".aw-floating-bar .aw-film-chip").count(), 0);
        await page.locator('.aw-frame .aw-film-toast[role="status"][aria-live="polite"]').waitFor({ state: "visible" });
        await page.locator('.aw-frame .aw-scene-banner[role="status"][aria-live="polite"]').waitFor({ state: "visible" });
        assert.equal(await page.locator('.aw-segments li[data-banner-linked="true"]').count(), 1);
        await auditPopovers(page, width, plateAudioPopovers, `Plates Subtitle+updating quality popover (${width}px)`);

        await page.locator('.aw-floating-bar button[role="tab"]:has-text("Audio")').click();
        await page.waitForSelector('[role="group"][aria-label="Audio tracks"]');
        const statusAudioAudit = await auditBarLayout(page, width, `Plates Audio+updating tab (${width}px)`);
        assert.equal(statusAudioAudit.statusBox, null, `Plates Audio+updating tab (${width}px) keeps toolbar slot free of film chip`);

        // 4. HyperFrames c-ready: Subtitle tab & Audio tab
        await page.goto(`${origin}/dev/hf-step-fixture?state=c-ready&theme=light`, { waitUntil: "networkidle" });
        await page.waitForSelector("hyperframes-player");
        await page.evaluate(() => document.fonts.ready);

        const hfSubAudit = await auditBarLayout(page, width, `HyperFrames Subtitle tab (${width}px)`);
        assert.equal(hfSubAudit.controls.length, 4, `HyperFrames Subtitle tab (${width}px) renders 4 controls (3 + the motion-blur checkbox)`);
        await auditPopovers(page, width, hfSubtitlePopovers, `HyperFrames Subtitle popovers (${width}px)`);

        await page.locator('.aw-floating-bar button[role="tab"]:has-text("Audio")').click();
        await page.waitForSelector('[role="group"][aria-label="Audio tracks"]');
        const hfAudioAudit = await auditBarLayout(page, width, `HyperFrames Audio tab (${width}px)`);
        assert.equal(hfAudioAudit.controls.length, 5, `HyperFrames Audio tab (${width}px) renders 5 controls (4 + the motion-blur checkbox)`);

        // 5. HyperFrames g2-preview-error: statusBadge with Retry button
        activePlateState = "g2-preview-error";
        await page.goto(`${origin}/dev/hf-step-fixture?state=g2-preview-error&theme=light`, { waitUntil: "networkidle" });
        await page.waitForSelector('.aw-floating-bar button:has-text("Retry")');
        await page.evaluate(() => document.fonts.ready);
        const hfErrAudit = await auditBarLayout(page, width, `HyperFrames g2-preview-error (${width}px)`);
        assert.equal(hfErrAudit.controls.length, 5, `HyperFrames g2-preview-error (${width}px) renders 5 controls including Retry (and the motion-blur checkbox)`);
        assert.ok(hfErrAudit.statusBox, `HyperFrames g2-preview-error (${width}px) shows status chip`);
      }

      // 6. Owner's 1200px 9:16 live-mode + live-progress scenario:
      // Draft quality pill popover (Draft (Default) / Full) + live progress status chip
      await page.setViewportSize({ width: 1200, height: 800 });
      activePlateState = "live-c-mixed";
      await page.goto(`${origin}/dev/plate-preview-fixture?state=live-c-mixed&theme=light`, { waitUntil: "networkidle" });
      await page.waitForSelector('.aw-floating-bar button[aria-label="Preview quality"]');
      // Switch to 9:16 aspect
      await page.locator(".aw-dim-trigger").click();
      await page.locator('.aw-dim-option:has-text("9:16")').click();
      await page.waitForSelector('.animation-workspace[data-aspect="9:16"]');

      const qualityBtn = page.locator('.aw-floating-bar button[aria-label="Preview quality"]');
      assert.equal(await qualityBtn.getAttribute("aria-haspopup"), "dialog");
      assert.equal(await qualityBtn.getAttribute("aria-expanded"), "false");

      await qualityBtn.click();
      assert.equal(await qualityBtn.getAttribute("aria-expanded"), "true");
      const qualityDialog = page.locator('[role="dialog"][aria-label="Preview quality"]');
      await qualityDialog.waitFor({ state: "visible" });

      // Check Draft (Default) and Full radio options and keyboard arrow navigation
      const playbackRadios = qualityDialog.locator('[role="radiogroup"][aria-label="Playback quality"] button[role="radio"]');
      assert.equal(await playbackRadios.count(), 2, "Quality popover renders Draft and Full radio options");
      await page.keyboard.press("ArrowDown");
      const firstFocused = await page.evaluate(() => document.activeElement?.getAttribute("data-playback-mode"));
      assert.ok(firstFocused === "draft" || firstFocused === "full", "ArrowDown focuses a playback quality option");

      //Verify selecting an option closes the popover and returns focus to the pill
      await qualityDialog.locator('button[data-playback-mode="draft"]').click();
      assert.equal(await qualityDialog.count(), 0, "Choosing quality option closes popover");
      const activeAriaLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      assert.equal(activeAriaLabel, "Preview quality", "Focus returns to Preview quality pill after choosing");

      // Verify popover does not overlap Render button or Comments panel at 1200px 9:16
      await auditPopovers(page, 1200, plateAudioPopovers, "Plates 1200px 9:16 live Draft quality popover");

      // 7. Render button is ALWAYS enabled (even in h-scene-updating with unready & failed scenes) and opens accessible confirmation modal
      await page.setViewportSize({ width: 1280, height: 800 });
      activePlateState = "h-scene-updating";
      await page.goto(`${origin}/dev/plate-preview-fixture?state=h-scene-updating&theme=light`, { waitUntil: "networkidle" });
      await page.waitForSelector("button.aw-render-top");

      const renderBtn = page.locator("button.aw-render-top");
      assert.equal(await renderBtn.isDisabled(), false, "Render button must be enabled even when scenes are updating/failed");
      assert.ok((await renderBtn.textContent())?.includes("15 tokens"), "Render button keeps cost text");
      const descId = await renderBtn.getAttribute("aria-describedby");
      assert.ok(descId, "Render button has aria-describedby");

      await renderBtn.click();
      const confirmModal = page.locator('.aw-confirm-modal[role="dialog"][aria-modal="true"]');
      await confirmModal.waitFor({ state: "visible" });
      assert.equal((await confirmModal.locator("h2").textContent())?.trim(), "Make the video without reviewing it first?");

      const modalReasonTexts = await confirmModal.locator(".aw-confirm-list li").allTextContents();
      assert.deepEqual(modalReasonTexts, [
        "1 of 5 scenes is still being built.",
        "1 scene failed to draw.",
        "You haven't watched the preview through."
      ]);

      // Default focus is on "Review first"
      const focusedLabel = await page.evaluate(() => document.activeElement?.textContent?.trim());
      assert.equal(focusedLabel, "Review first", "Default focus is on Review first button");

      // Focus trap: Tab -> "Make the video", Tab -> wraps back to "Review first"
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Make the video");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Review first");

      // Escape closes modal and returns focus to Render button
      await page.keyboard.press("Escape");
      assert.equal(await confirmModal.count(), 0, "Escape closes confirmation modal");
      await page.waitForFunction(() => document.activeElement?.classList.contains("aw-render-top"));

      // At 400px viewport, buttons stack vertically inside the modal
      await page.setViewportSize({ width: 400, height: 800 });
      await renderBtn.click();
      await confirmModal.waitFor({ state: "visible" });
      const reviewBox = await confirmModal.locator("button.aw-confirm-review").boundingBox();
      const proceedBox = await confirmModal.locator("button.aw-confirm-proceed").boundingBox();
      assert.ok(reviewBox && proceedBox && proceedBox.y >= reviewBox.y + reviewBox.height - 1, "At 400px, modal buttons stack vertically");
      await confirmModal.locator("button.aw-confirm-review").click();
      assert.equal(await confirmModal.count(), 0);
    } finally {
      if (browser) await browser.close().catch(() => {});
      await new Promise((r) => srv.close(r));
    }
  }
);
