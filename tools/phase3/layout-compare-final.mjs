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
const SBS_DIR = join(HERE, "side-by-side");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(SBS_DIR, { recursive: true });

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));
const CLIP_1X1 = readFileSync(join(WS_FIXTURES_DIR, "clip-1x1.mp4"));

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

const FINAL_REGIONS = [
  { id: "header", selector: ".pf-head" },
  { id: "actions", selector: ".pf-actions" },
  { id: "stage-frame", selector: ".pf-frame" },
  { id: "video", selector: ".pf-video" },
  { id: "downloads", selector: ".pf-downloads" }
];

const MATCHING_FINAL_STATES = [
  { name: "ready-16x9", plateState: "k-plate-final", hfState: "a-ready-16x9" },
  { name: "ready-approved", plateState: "q-plate-final-approved", hfState: "c-ready-approved" }
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

async function measureFinalPage(page) {
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
        height: Math.round(rect.height * 100) / 100
      };
    }
    const tabsEl = document.querySelector(".pf-tabs");
    const tabsRect = tabsEl ? tabsEl.getBoundingClientRect() : null;
    const dlChips = Array.from(document.querySelectorAll(".pf-downloads > *"));
    const firstChipRect = dlChips[0] ? dlChips[0].getBoundingClientRect() : null;
    return {
      regions: out,
      tabsHeight: tabsRect ? Math.round(tabsRect.height * 100) / 100 : 0,
      firstDownloadChipHeight: firstChipRect ? Math.round(firstChipRect.height * 100) / 100 : 0
    };
  }, FINAL_REGIONS);
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
    await waitForServer(`${origin}/dev/plate-preview-fixture`);
    await waitForServer(`${origin}/dev/hf-final-fixture`);
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

    let activePlateState = "k-plate-final";
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
        url.pathname.endsWith(".mp4")
      ) {
        const isPortrait = url.pathname.includes("9x16") || url.pathname.endsWith("9-16");
        const isSquare = url.pathname.endsWith("1-1");
        const buf = isPortrait ? CLIP_9X16 : isSquare ? CLIP_1X1 : CLIP_16X9;
        await route.fulfill({ status: 200, contentType: "video/mp4", body: buf });
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

    for (const pair of MATCHING_FINAL_STATES) {
      activePlateState = pair.plateState;
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });

          // 1. Load Plates final fixture
          await page.goto(
            `${origin}/dev/plate-preview-fixture?state=${encodeURIComponent(pair.plateState)}&theme=${encodeURIComponent(theme)}`,
            { waitUntil: "networkidle" }
          );
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
          await page.evaluate(async (t) => {
            document.documentElement.dataset.theme = t;
            document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
            await document.fonts.ready;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          }, theme);
          await page.waitForSelector(".pf-tabs button:nth-child(3)");
          const plateMeasured = await measureFinalPage(page);

          // 2. Load HyperFrames final fixture
          await page.goto(
            `${origin}/dev/hf-final-fixture?state=${encodeURIComponent(pair.hfState)}&theme=${encodeURIComponent(theme)}`,
            { waitUntil: "networkidle" }
          );
          await page.addStyleTag({ content: DETERMINISTIC_CSS });
          await page.evaluate(async (t) => {
            document.documentElement.dataset.theme = t;
            document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
            await document.fonts.ready;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          }, theme);
          await page.waitForSelector(".pf-video");
          const hfMeasured = await measureFinalPage(page);

          // The ratio tab row (.pf-tabs, 26px + 14px flex gap = 40px) is rendered only when ratios.length > 1 (Plates).
          // At 400x800, Plates' 3 download chips wrap to 2 rows (74px) whereas HyperFrames' 1 download chip is 1 row (32px).
          const tabOffset = plateMeasured.tabsHeight > 0 ? plateMeasured.tabsHeight + 14 : 0;
          const dlWrapDiff =
            (plateMeasured.regions.downloads?.height ?? 0) - (hfMeasured.regions.downloads?.height ?? 0);
          // Because .pf-stage is flex:1 with align-items:center between .pf-head/.pf-tabs and .pf-downloads,
          // removing .pf-tabs shifts .pf-stage's center up by tabOffset/2, and fewer download rows shifts it down by dlWrapDiff/2.
          const stageCenterShiftY = -tabOffset / 2 + dlWrapDiff / 2;

          for (const reg of FINAL_REGIONS) {
            const p = plateMeasured.regions[reg.id];
            const h = hfMeasured.regions[reg.id];
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
                note: "missing",
                pass: false
              });
              continue;
            }

            let expectedY = p.y;
            let expectedH = p.height;
            let note = "exact";

            if (reg.id === "stage-frame" || reg.id === "video") {
              expectedY = p.y + stageCenterShiftY;
              note =
                dlWrapDiff > 0
                  ? `no .pf-tabs (-${tabOffset / 2}px) + 1-row dl (+${dlWrapDiff / 2}px)`
                  : `no .pf-tabs (-${tabOffset / 2}px center shift)`;
            } else if (reg.id === "downloads" && dlWrapDiff > 0) {
              expectedY = p.y + dlWrapDiff;
              expectedH = plateMeasured.firstDownloadChipHeight || h.height;
              note = "1 ratio chip (1 row vs 2 rows at 400px)";
            }

            const dx = Math.abs(p.x - h.x);
            const dy = Math.abs(expectedY - h.y);
            const dw = Math.abs(p.width - h.width);
            const dh = Math.abs(expectedH - h.height);
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
              note,
              pass
            });
          }
        }
      }
    }

    // Produce side-by-side images tools/phase3/side-by-side/final-*.png of plates vs HyperFrames for ready state at 1280x800, light and dark
    const sbsCreated = [];
    const sbsPairs = [
      { outName: "final-ready-1280-light.png", plateImg: "k-plate-final-1280-light.png", hfImg: "a-ready-16x9-1280-light.png" },
      { outName: "final-ready-1280-dark.png", plateImg: "k-plate-final-1280-dark.png", hfImg: "a-ready-16x9-1280-dark.png" },
      { outName: "final-approved-1280-light.png", plateImg: "q-plate-final-approved-1280-light.png", hfImg: "c-ready-approved-1280-light.png" },
      { outName: "final-approved-1280-dark.png", plateImg: "q-plate-final-approved-1280-dark.png", hfImg: "c-ready-approved-1280-dark.png" }
    ];

    for (const item of sbsPairs) {
      const leftPath = join(HERE, "baseline", item.plateImg);
      const rightPath = join(HERE, "hf-final-after", item.hfImg);
      const outPath = join(SBS_DIR, item.outName);
      makeSideBySidePng(leftPath, rightPath, outPath);
      sbsCreated.push(`tools/phase3/side-by-side/${item.outName}`);
    }

    console.log("| State | Viewport | Theme | Region | Plates (x,y w×h) | HyperFrames (x,y w×h) | Note | Max Δ (px) | Status |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | ---: | --- |");
    for (const r of rows) {
      console.log(
        `| \`${r.state}\` | \`${r.viewport}\` | \`${r.theme}\` | \`${r.region}\` | \`${r.plateBox}\` | \`${r.hfBox}\` | ${r.note} | ${r.maxDiffPx} | ${r.pass ? "PASS" : "FAIL"} |`
      );
    }

    const passedCount = rows.filter((r) => r.pass).length;
    console.log(`\nSummary: ${passedCount}/${rows.length} shared final-view region checks coincided within <= 2 px (the .pf-tabs row exists only for plates when ratios.length > 1).`);
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
