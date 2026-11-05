import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { fixturePlateStatus } from "./fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const NEXT_DEV_LOCK = join(FRONTEND_DIR, ".next/dev/lock");
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

async function auditBarLayout(page, viewportWidth, label) {
  const audit = await page.evaluate(() => {
    const bar = document.querySelector('.aw-floating-bar[role="toolbar"]');
    const frame = document.querySelector(".aw-frame");
    const canvas = document.querySelector(".aw-canvas");
    if (!bar || !frame || !canvas) {
      throw new Error("Missing .aw-floating-bar, .aw-frame, or .aw-canvas");
    }
    const barRect = bar.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

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
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        right: Math.round(r.right * 100) / 100,
        bottom: Math.round(r.bottom * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
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
            x: Math.round(r.x * 100) / 100,
            y: Math.round(r.y * 100) / 100,
            right: Math.round(r.right * 100) / 100,
            width: Math.round(r.width * 100) / 100,
            height: Math.round(r.height * 100) / 100,
            hitSelfOrDescendant: Boolean(hitEl && (statusEl === hitEl || statusEl.contains(hitEl)))
          };
        })()
      : null;

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.documentElement.scrollWidth,
      barRect: {
        x: Math.round(barRect.x * 100) / 100,
        y: Math.round(barRect.y * 100) / 100,
        right: Math.round(barRect.right * 100) / 100,
        bottom: Math.round(barRect.bottom * 100) / 100,
        width: Math.round(barRect.width * 100) / 100,
        height: Math.round(barRect.height * 100) / 100
      },
      frameRect: {
        x: Math.round(frameRect.x * 100) / 100,
        y: Math.round(frameRect.y * 100) / 100,
        right: Math.round(frameRect.right * 100) / 100,
        bottom: Math.round(frameRect.bottom * 100) / 100,
        width: Math.round(frameRect.width * 100) / 100,
        height: Math.round(frameRect.height * 100) / 100
      },
      canvasRect: {
        x: Math.round(canvasRect.x * 100) / 100,
        y: Math.round(canvasRect.y * 100) / 100,
        right: Math.round(canvasRect.right * 100) / 100,
        bottom: Math.round(canvasRect.bottom * 100) / 100,
        width: Math.round(canvasRect.width * 100) / 100,
        height: Math.round(canvasRect.height * 100) / 100
      },
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
    audit.barRect.bottom <= audit.frameRect.y && audit.barRect.bottom <= audit.canvasRect.y,
    `${label}: .aw-floating-bar (bottom=${audit.barRect.bottom}) does not overlap .aw-frame (y=${audit.frameRect.y}) or .aw-canvas (y=${audit.canvasRect.y})`
  );

  for (const ctrl of audit.controls) {
    assert.ok(
      ctrl.x >= 0 && ctrl.right <= audit.innerWidth,
      `${label}: control "${ctrl.label}" horizontally inside viewport (x=${ctrl.x}, right=${ctrl.right}, viewport=${audit.innerWidth})`
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

    // Dismiss with Escape key
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

async function startNextDevServer(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  // Yield briefly when concurrent Next-dev-server tests (hf-step-interaction at 0ms, final-view-interaction at 2500ms) may also be starting
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < deadline) {
    // Wait until .next/dev/lock stays free for 1200ms so final-view-interaction (300ms poll) takes the first handoff
    let freeSince = existsSync(NEXT_DEV_LOCK) ? 0 : Date.now();
    while (Date.now() < deadline) {
      if (existsSync(NEXT_DEV_LOCK)) {
        freeSince = 0;
      } else if (freeSince === 0) {
        freeSince = Date.now();
      } else if (Date.now() - freeSince >= 1200) {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const port = await findFreePort();
    const origin = `http://127.0.0.1:${port}`;
    const proc = spawn(
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
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      }
    );

    let ready = false;
    while (Date.now() < deadline && proc.exitCode === null) {
      try {
        const res = await fetch(`${origin}/dev/plate-preview-fixture`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // still booting
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    if (ready) {
      await waitForServer(`${origin}/dev/hf-step-fixture`, Math.max(10_000, deadline - Date.now()));
      return { proc, origin, port };
    }

    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Timed out starting Next dev server for workspace-bar-narrow");
}

test(
  "OptionsBar layout at 400px and 1280px: Plates (Subtitle & Audio tabs, popovers, status chip) and HyperFrames",
  { timeout: 240_000 },
  async () => {
    const { proc: nextProc, origin, port } = await startNextDevServer();

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

    for (const width of [400, 1280]) {
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

      // 3. Plates h-scene-updating: Subtitle & Audio tabs with statusBadge ("3/5 drawn…")
      activePlateState = "h-scene-updating";
      await page.goto(`${origin}/dev/plate-preview-fixture?state=h-scene-updating&theme=light`, { waitUntil: "networkidle" });
      await page.waitForSelector(".aw-segments li:nth-child(5)");
      await page.evaluate(() => document.fonts.ready);
      const statusSubAudit = await auditBarLayout(page, width, `Plates Subtitle+status tab (${width}px)`);
      assert.ok(statusSubAudit.statusBox, `Plates Subtitle+status tab (${width}px) shows status chip`);

      await page.locator('.aw-floating-bar button[role="tab"]:has-text("Audio")').click();
      await page.waitForSelector('[role="group"][aria-label="Audio tracks"]');
      const statusAudioAudit = await auditBarLayout(page, width, `Plates Audio+status tab (${width}px)`);
      assert.ok(statusAudioAudit.statusBox, `Plates Audio+status tab (${width}px) shows status chip`);

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
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (nextProc && nextProc.pid) {
      try {
        process.kill(-nextProc.pid, "SIGTERM");
      } catch {
        try {
          nextProc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
});
