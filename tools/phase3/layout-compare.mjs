#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { fixturePlateExport, fixturePlateStatus } from "../../frontend/test/fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const WS_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/workspace");
const HF_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/hf");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const SBS_DIR = join(HERE, "side-by-side");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(SBS_DIR, { recursive: true });

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));
const CLIP_1X1 = readFileSync(join(WS_FIXTURES_DIR, "clip-1x1.mp4"));
const VOICE_WAV = readFileSync(join(WS_FIXTURES_DIR, "voice.wav"));

const COMPOSITION_HTML = readFileSync(join(HF_FIXTURES_DIR, "composition.html"), "utf8");
const COMPOSITION_JSON = JSON.parse(readFileSync(join(HF_FIXTURES_DIR, "composition.json"), "utf8"));
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

const SHELL_REGIONS = [
  { id: "workspace", label: "Workspace root (.animation-workspace)", selector: ".animation-workspace", mode: "box" },
  { id: "options-bar", label: "Options bar ([role=toolbar] .aw-floating-bar)", selector: '.aw-floating-bar[role="toolbar"]', mode: "toolbar" },
  { id: "stage-frame", label: "Stage frame (.aw-frame)", selector: ".aw-frame", mode: "box" },
  { id: "stage-canvas", label: "Stage canvas (.aw-canvas)", selector: ".aw-canvas", mode: "box" },
  { id: "ratio-rail", label: "Ratio rail ([role=group] .aw-dim-rail)", selector: '.aw-dim-rail[role="group"]', mode: "box" },
  { id: "control-row", label: "Control row (.aw-controls)", selector: ".aw-controls", mode: "box" },
  { id: "scene-tabs", label: "Scene tabs ([role=slider] .aw-track)", selector: '.aw-track[role="slider"]', mode: "box" },
  { id: "render-button", label: "Render button (.aw-render-top)", selector: ".aw-render-top", mode: "box" },
  { id: "comments-panel", label: "Comments panel (aside[aria-label=Comments])", selector: 'aside.aw-side[aria-label="Comments"]', mode: "box" }
];

const MATCHING_STATES = [
  { name: "c-ready", plateState: "c-ready", hfState: "c-ready" },
  { name: "d-comments", plateState: "d-comments", hfState: "d-comments" },
  { name: "token-modal", plateState: "g-token-modal", hfState: "e-token-modal" }
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

async function measureRegions(page) {
  return await page.evaluate((regions) => {
    window.scrollTo(0, 0);
    const out = {};
    for (const r of regions) {
      const el = document.querySelector(r.selector);
      if (!el) {
        out[r.id] = null;
        continue;
      }
      const rect = el.getBoundingClientRect();
      out[r.id] = {
        x: Math.round(rect.x * 100) / 100,
        y: Math.round(rect.y * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        centerX: Math.round((rect.x + rect.width / 2) * 100) / 100
      };
    }
    return out;
  }, SHELL_REGIONS);
}

// PNG helpers for building side-by-side images
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatParts = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatParts));
  const pixels = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const byte = raw[rowStart + 1 + x];
      const left = x >= bpp ? curRow[x - bpp] : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp] : 0;
      let val = byte;
      if (filter === 1) val = (byte + left) & 0xff;
      else if (filter === 2) val = (byte + up) & 0xff;
      else if (filter === 3) val = (byte + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) val = (byte + paethPredictor(left, up, upLeft)) & 0xff;
      curRow[x] = val;
    }
    for (let px = 0; px < width; px++) {
      const dst = (y * width + px) * 4;
      const src = px * bpp;
      pixels[dst] = curRow[src];
      pixels[dst + 1] = curRow[src + 1];
      pixels[dst + 2] = curRow[src + 2];
      pixels[dst + 3] = bpp === 4 ? curRow[src + 3] : 255;
    }
    prevRow.set(curRow);
  }
  return { width, height, data: pixels };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    const srcStart = y * stride;
    raw.set(rgba.subarray(srcStart, srcStart + stride), rowStart + 1);
  }
  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function makeSideBySidePng(pathLeft, pathRight, outPath) {
  const left = decodePng(readFileSync(pathLeft));
  const right = decodePng(readFileSync(pathRight));
  const gap = 8;
  const outW = left.width + gap + right.width;
  const outH = Math.max(left.height, right.height);
  const out = new Uint8Array(outW * outH * 4);
  // Fill divider with subtle neutral grey
  for (let i = 0; i < outW * outH * 4; i += 4) {
    out[i] = 30;
    out[i + 1] = 41;
    out[i + 2] = 59;
    out[i + 3] = 255;
  }
  for (let y = 0; y < left.height; y++) {
    const srcRow = left.data.subarray(y * left.width * 4, (y + 1) * left.width * 4);
    out.set(srcRow, y * outW * 4);
  }
  for (let y = 0; y < right.height; y++) {
    const srcRow = right.data.subarray(y * right.width * 4, (y + 1) * right.width * 4);
    out.set(srcRow, (y * outW + left.width + gap) * 4);
  }
  writeFileSync(outPath, encodePng(outW, outH, out));
}

async function main() {
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
    await waitForServer(`${origin}/dev/hf-step-fixture`);
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

    let activePlateState = "c-ready";
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

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
      if (/\/plates\/\d+\/clip$/.test(url.pathname)) {
        const aspect = url.searchParams.get("aspect") ?? "16:9";
        const buf = aspect === "9:16" ? CLIP_9X16 : aspect === "1:1" ? CLIP_1X1 : CLIP_16X9;
        await route.fulfill({ status: 200, contentType: "video/mp4", body: buf });
        return;
      }
      if (/\/projects\/[^/]+\/composition$/.test(url.pathname)) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COMPOSITION_JSON) });
        return;
      }
      if (/^\/api\/preview\/plans\/[^/]+$/.test(url.pathname)) {
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
        await route.fulfill({ status: 200, contentType: "audio/wav", body: VOICE_WAV });
        return;
      }
      if (url.hostname === "127.0.0.1" && url.port === String(port)) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 204, body: "" });
    });

    const page = await context.newPage();
    const rows = [];
    let anyFailed = false;

    for (const pair of MATCHING_STATES) {
      activePlateState = pair.plateState;
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });

          // 1. Load Plates fixture
          await page.goto(
            `${origin}/dev/plate-preview-fixture?state=${encodeURIComponent(pair.plateState)}&theme=${encodeURIComponent(theme)}`,
            { waitUntil: "networkidle" }
          );
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
          }, theme);
          await page.waitForSelector(".aw-segments li:nth-child(5)");
          if (pair.name === "token-modal") {
            await page.locator("button.aw-render-top").dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-labelledby="sc-modal-title"]');
          }
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          const plateRects = await measureRegions(page);

          // 2. Load HyperFrames fixture
          await page.goto(
            `${origin}/dev/hf-step-fixture?state=${encodeURIComponent(pair.hfState)}&theme=${encodeURIComponent(theme)}`,
            { waitUntil: "networkidle" }
          );
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
          }, theme);
          await page.waitForSelector(".aw-segments li:nth-child(5)");
          await page.waitForSelector("hyperframes-player");

          if (pair.name === "d-comments") {
            await page.evaluate(() => {
              const setComment = (val) => {
                const ta = document.querySelector(".aw-compose textarea");
                const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
                proto?.set?.call(ta, val);
                ta.dispatchEvent(new Event("input", { bubbles: true }));
              };
              setComment("Keep the fox's scarf a warmer rust colour throughout.");
              document.querySelector(".aw-compose button.primary-button").click();
              const track = document.querySelector('.aw-track[role="slider"]');
              const box = track.getBoundingClientRect();
              track.setPointerCapture = () => {};
              track.dispatchEvent(
                new PointerEvent("pointerdown", {
                  bubbles: true,
                  clientX: box.left + (6 / 20) * box.width,
                  clientY: box.top + box.height / 2,
                  pointerId: 1
                })
              );
              track.dispatchEvent(
                new PointerEvent("pointerup", {
                  bubbles: true,
                  clientX: box.left + (6 / 20) * box.width,
                  clientY: box.top + box.height / 2,
                  pointerId: 1
                })
              );
              setComment("Make the snow footprints glow softly as she steps.");
              document.querySelector(".aw-compose button.primary-button").click();
              window.scrollTo(0, 0);
            });
          } else if (pair.name === "token-modal") {
            await page.locator("button.aw-render-top").dispatchEvent("click");
            await page.waitForSelector('[role="dialog"][aria-labelledby="sc-modal-title"]');
          }

          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          const hfRects = await measureRegions(page);

          for (const reg of SHELL_REGIONS) {
            const p = plateRects[reg.id];
            const h = hfRects[reg.id];
            if (!p || !h) {
              anyFailed = true;
              rows.push({
                state: pair.name,
                viewport: `${width}x800`,
                theme,
                region: reg.id,
                plateBox: p ? `${p.x},${p.y} ${p.width}×${p.height}` : "MISSING",
                hfBox: h ? `${h.x},${h.y} ${h.width}×${h.height}` : "MISSING",
                maxDiffPx: 999,
                pass: false
              });
              continue;
            }
            const dy = Math.abs(p.y - h.y);
            const dh = Math.abs(p.height - h.height);
            const dx = reg.mode === "toolbar" ? Math.abs(p.centerX - h.centerX) : Math.abs(p.x - h.x);
            const dw = reg.mode === "toolbar" ? 0 : Math.abs(p.width - h.width);
            const maxDiffPx = Math.round(Math.max(dx, dy, dw, dh) * 100) / 100;
            const pass = maxDiffPx <= 2;
            if (!pass) anyFailed = true;
            rows.push({
              state: pair.name,
              viewport: `${width}x800`,
              theme,
              region: reg.id,
              plateBox: `${p.x},${p.y} ${p.width}×${p.height}`,
              hfBox: `${h.x},${h.y} ${h.width}×${h.height}`,
              maxDiffPx,
              pass
            });
          }
        }
      }
    }

    // Generate side-by-side PNGs for states (c) and (d) at 1280x800 (light & dark)
    const sbsCreated = [];
    for (const st of ["c-ready", "d-comments"]) {
      for (const th of ["light", "dark"]) {
        const plateImg = join(HERE, "after", `${st}-1280-${th}.png`);
        const hfImg = join(HERE, "hf-after", `${st}-1280-${th}.png`);
        const outImg = join(SBS_DIR, `${st}-1280-${th}.png`);
        makeSideBySidePng(plateImg, hfImg, outImg);
        sbsCreated.push(`tools/phase3/side-by-side/${st}-1280-${th}.png`);
      }
    }

    console.log("| State | Viewport | Theme | Region | Plates (x,y w×h) | HyperFrames (x,y w×h) | Max Δ (px) | Status |");
    console.log("| --- | --- | --- | --- | --- | --- | ---: | --- |");
    for (const r of rows) {
      console.log(
        `| \`${r.state}\` | \`${r.viewport}\` | \`${r.theme}\` | \`${r.region}\` | \`${r.plateBox}\` | \`${r.hfBox}\` | ${r.maxDiffPx} | ${r.pass ? "PASS" : "FAIL"} |`
      );
    }

    const passedCount = rows.filter((r) => r.pass).length;
    console.log(`\nSummary: ${passedCount}/${rows.length} region checks coincided within <= 2 px.`);
    console.log(`Side-by-side images written:\n  - ${sbsCreated.join("\n  - ")}`);

    if (anyFailed) {
      process.exit(1);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    cleanup();
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
