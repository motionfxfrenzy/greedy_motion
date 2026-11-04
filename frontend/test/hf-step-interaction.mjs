import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { FIXTURE_HF_PROJECT } from "./fixtures/hf/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const HF_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/hf");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const COMPOSITION_HTML = readFileSync(join(HF_FIXTURES_DIR, "composition.html"), "utf8");
const COMPOSITION_JSON = JSON.parse(readFileSync(join(HF_FIXTURES_DIR, "composition.json"), "utf8"));
const SILENT_WAV = readFileSync(join(HF_FIXTURES_DIR, "silent.wav"));
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");

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

test("BrowserAnimationStep headless Chrome interaction: play, pause, scene seek, comments add/remove/apply, subtitle & audio patches with player reload, and token modal", async () => {
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

  let browser = null;
  try {
    await waitForServer(`${origin}/dev/hf-step-fixture`);
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const planPatches = [];
    const previewFetches = [];

    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());

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

      if (/\/projects\/[^/]+\/composition$/.test(url.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(COMPOSITION_JSON)
        });
        return;
      }

      if (/\/projects\/[^/]+\/plan$/.test(url.pathname) && req.method() === "PATCH") {
        const body = JSON.parse(req.postData() ?? "{}");
        planPatches.push(body);
        const updatedProject = structuredClone(FIXTURE_HF_PROJECT);
        if (body.captions && updatedProject.beatPlan && updatedProject.brief) {
          updatedProject.beatPlan.audio.captions = body.captions;
          updatedProject.brief.captions = body.captions;
        }
        if (body.audioMode && updatedProject.brief) {
          updatedProject.brief.audio.mode = body.audioMode;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(updatedProject)
        });
        return;
      }

      if (/^\/api\/preview\/plans\/[^/]+$/.test(url.pathname)) {
        previewFetches.push(url.search);
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: COMPOSITION_HTML
        });
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
        await route.fulfill({ status: 200, contentType: "audio/wav", body: SILENT_WAV });
        return;
      }

      if (url.hostname === "127.0.0.1" && url.port === String(port)) {
        await route.continue();
        return;
      }

      await route.fulfill({ status: 204, body: "" });
    });

    const page = await context.newPage();
    await page.goto(`${origin}/dev/hf-step-fixture?state=c-ready&theme=dark`, { waitUntil: "networkidle" });
    await page.waitForSelector("hyperframes-player");
    await page.waitForFunction(() => Boolean(document.querySelector("hyperframes-player")?.ready));

    assert.equal(previewFetches.length, 1, "initial preview HTML fetched once");
    assert.match(previewFetches[0], /v=0/, "initial preview fetch uses v=0");

    // 1. Play and Pause
    const playBtn = page.locator("button.aw-play");
    assert.equal(await playBtn.getAttribute("aria-label"), "Play");
    await playBtn.click();
    assert.equal(await playBtn.getAttribute("aria-label"), "Pause", "clicking Play enters playing state");
    await playBtn.click();
    assert.equal(await playBtn.getAttribute("aria-label"), "Play", "clicking Pause pauses playback");

    // 2. Seek by clicking a scene tab (Scene 3: 8s..12s, center is 10s -> 0:10)
    const scene3Tab = page.locator(".aw-segments li").nth(2);
    await scene3Tab.click();
    assert.ok(await scene3Tab. evaluate((el) => el.classList.contains("on")), "Scene 3 tab is active after click");
    const sceneLabel = await page.locator(".aw-scene").textContent();
    assert.equal(sceneLabel?.trim(), "Scene 3 · Voice and music");
    const clockText = await page.locator(".aw-clock b").textContent();
    assert.equal(clockText?.trim(), "0:10");

    // 3. Add a timed comment and remove it
    const textarea = page.locator(".aw-compose textarea");
    const addBtn = page.locator(".aw-compose button.primary-button");
    await textarea.fill("Temporary note on scene 3");
    await addBtn.click();
    assert.equal(await page.locator(".aw-comments li:not(.empty)").count(), 1);
    assert.equal(await page.locator(".aw-pin").count(), 1);
    await page.locator('button.aw-x[aria-label="Remove comment"]').click();
    assert.equal(await page.locator(".aw-comments li:not(.empty)").count(), 0);
    assert.equal(await page.locator(".aw-pin").count(), 0);

    // 4. Add comments on Scene 3 and Scene 1, then click Apply comments -> callback fires with right payload
    await textarea.fill("Highlight the ducked music waveform");
    await addBtn.click();
    const scene1Tab = page.locator(".aw-segments li").nth(0);
    await scene1Tab.click();
    await textarea.fill("Make the launch title bolder");
    await addBtn.click();

    const applyBtn = page.locator("button.aw-apply");
    assert.equal((await applyBtn.textContent())?.trim(), "Redraw scenes 1, 3");
    const fetchesBeforeApply = previewFetches.length;
    await applyBtn.click();

    const appliedPayloads = await page.evaluate(() => window.__hfAppliedComments);
    assert.deepEqual(appliedPayloads, [
      [
        { line: 0, text: "Make the launch title bolder" },
        { line: 2, text: "Highlight the ducked music waveform" }
      ]
    ]);
    await page.waitForFunction((prevCount) => prevCount < performance.getEntriesByType("resource").length, fetchesBeforeApply).catch(() => {});
    await page.waitForTimeout(150);
    assert.ok(previewFetches.length > fetchesBeforeApply, "applying comments reloads the composition");

    // 5. Change subtitle mode -> sends PATCH /plan { captions: "none" } and reloads player
    const fetchesBeforeSub = previewFetches.length;
    await page.locator('button.aw-pill-item:has-text("Subtitles")').click();
    await page.waitForSelector('[role="dialog"][aria-label="Subtitle mode"]');
    // Verify unsupported subtitle controls (style, size, colors, opacity, position) are hidden
    assert.equal(await page.locator('[aria-label="Subtitle font size"]').count(), 0);
    assert.equal(await page.locator('[aria-label="Subtitle colors"]').count(), 0);
    assert.equal(await page.locator('[aria-label="Transparency"]').count(), 0);

    await page.locator('button.aw-option-row:has-text("Off")').click();
    await page.waitForFunction((n) => n > 0, planPatches.length);
    await page.waitForTimeout(150);
    assert.deepEqual(planPatches[planPatches.length - 1], { captions: "none" });
    assert.ok(previewFetches.length > fetchesBeforeSub, "changing subtitle mode reloads the composition HTML");

    // 6. Toggle Voice off -> sends PATCH /plan { audioMode: "music" } and reloads player
    const fetchesBeforeAudio = previewFetches.length;
    await page.locator('button[role="tab"]:has-text("Audio")').click();
    const audioGroup = page.locator('[role="group"][aria-label="Audio tracks"]');
    await audioGroup.waitFor();
    // Only Voice and Music chips are shown (no SFX or Transitions)
    const chipTexts = await audioGroup.locator("button.aw-track-chip").allTextContents();
    assert.deepEqual(chipTexts.map((t) => t.trim()), ["Voice", "Music"]);

    const voiceChip = audioGroup.locator('button.aw-track-chip:has-text("Voice")');
    assert.equal(await voiceChip.getAttribute("aria-pressed"), "true");
    await voiceChip.click();
    await page.waitForTimeout(150);
    assert.equal(await voiceChip.getAttribute("aria-pressed"), "false");
    assert.deepEqual(planPatches[planPatches.length - 1], { audioMode: "music" });
    assert.ok(previewFetches.length > fetchesBeforeAudio, "toggling Voice off reloads the composition HTML");

    // 7. Render opens the token modal when balance (5) < cost (12)
    await page.locator("button.aw-render-top").click();
    const modal = page.locator('[role="dialog"][aria-labelledby="sc-modal-title"]');
    await modal.waitFor();
    const modalText = await modal.textContent();
    assert.ok(modalText?.includes("12 tokens"), "token modal displays 12 tokens cost");
    assert.ok(modalText?.includes("7 more"), "token modal displays 7 more needed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (nextProc && !nextProc.killed) {
      try {
        nextProc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
});
