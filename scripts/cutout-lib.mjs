// Headless-Chrome harness shared by the Cutout Tales QC sheet and the seek-determinism test.
// Loads the SAME kit.js the HyperFrames template inlines, with the bundled fonts, and exposes frame rendering.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");
export const TEMPLATE = join(ROOT, "worker/templates/cutout-tales");

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
  for (const v of readdirSync(base)) {
    const p = join(base, v, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  throw new Error("No headless Chrome found; set CHROME_PATH.");
}

export async function openKit() {
  const browser = await puppeteer.launch({ executablePath: chromePath(), args: ["--no-sandbox", "--force-color-profile=srgb"] });
  const page = await browser.newPage();
  const fontCss = (await readFile(join(ROOT, "worker/fonts/fonts.css"), "utf8")).replaceAll('url("fonts/', `url("${pathToFileURL(join(ROOT, "worker/fonts")).href}/`);
  const dir = await mkdtemp(join(tmpdir(), "cutout-"));
  await writeFile(join(dir, "index.html"), `<!doctype html><html><head><style>${fontCss}</style></head><body style="margin:0;background:#000"><canvas id="cv"></canvas></body></html>`);
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await page.addScriptTag({ content: await readFile(join(TEMPLATE, "kit.js"), "utf8") });
  await page.evaluate(async () => { await document.fonts.load('700 38px "Hanken Grotesk"'); await document.fonts.load('400 20px "Hanken Grotesk"'); await document.fonts.ready; });
  return {
    page,
    async close() { await browser.close(); },
    /** Render frames at `times`; returns SHA-256 of raw pixels for each (fast determinism checks). */
    async hashes(spec, times) {
      return page.evaluate(async (spec, times) => {
        const d = CutoutKit.dims(spec), cv = document.getElementById("cv"); cv.width = d.W; cv.height = d.H;
        const ctx = cv.getContext("2d", { willReadFrequently: true }); const out = [];
        for (const t of times) {
          CutoutKit.drawFrame(ctx, spec, t);
          const buf = await crypto.subtle.digest("SHA-256", ctx.getImageData(0, 0, d.W, d.H).data);
          out.push(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
        }
        return out;
      }, spec, times);
    },
    /** Collision boxes at each time (overlays vs overlays vs heads). */
    async boxes(spec, times) {
      return page.evaluate((spec, times) => {
        const d = CutoutKit.dims(spec), cv = document.getElementById("cv"); cv.width = d.W; cv.height = d.H;
        const ctx = cv.getContext("2d");
        return times.map((t) => ({ t, ...CutoutKit.collectBoxes(ctx, spec, t) }));
      }, spec, times);
    },
    /** One PNG data URL per time. */
    async frames(spec, times, scale = 1) {
      return page.evaluate((spec, times, scale) => {
        const d = CutoutKit.dims(spec), cv = document.getElementById("cv"); cv.width = d.W; cv.height = d.H;
        const ctx = cv.getContext("2d");
        return times.map((t) => { CutoutKit.drawFrame(ctx, spec, t); const o = document.createElement("canvas"); o.width = Math.round(d.W * scale); o.height = Math.round(d.H * scale); o.getContext("2d").drawImage(cv, 0, 0, o.width, o.height); return o.toDataURL("image/jpeg", 0.9); });
      }, spec, times, scale);
    },
    /** 2x2 (or n-up) contact sheet as a JPEG buffer. */
    async sheet(spec, times, cols = 2, cellW = 960) {
      const url = await page.evaluate(async (spec, times, cols, cellW) => {
        const d = CutoutKit.dims(spec), cv = document.getElementById("cv"); cv.width = d.W; cv.height = d.H;
        const ctx = cv.getContext("2d"), cellH = Math.round(cellW * d.H / d.W), rows = Math.ceil(times.length / cols);
        const sheet = document.createElement("canvas"); sheet.width = cellW * cols; sheet.height = cellH * rows; const sc = sheet.getContext("2d");
        times.forEach((t, i) => { CutoutKit.drawFrame(ctx, spec, t); sc.drawImage(cv, (i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH); });
        return sheet.toDataURL("image/jpeg", 0.88);
      }, spec, times, cols, cellW);
      return Buffer.from(url.split(",")[1], "base64");
    },
  };
}
