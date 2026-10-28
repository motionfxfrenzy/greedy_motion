#!/usr/bin/env node
/*
 * Writes plates.json, the manifest of the anidoodle films a shot can use as a plate: opens each dist/*.html once and records window.FILM.meta.
 *   node make-plates.mjs [dist-dir]      (default: ANIDOODLE_DIST, see serve.mjs)
 * anidoodle runs on plain Canvas 2D, so this needs no GPU.
 */
import fs from "node:fs";
import path from "node:path";
import { serve, here, platesDir } from "./serve.mjs";
import { findBrowser } from "./browser.mjs";

const dist = process.argv[2] ? path.resolve(process.argv[2]) : platesDir();
if (process.argv[2]) process.env.ANIDOODLE_DIST = dist;
const names = fs.readdirSync(dist).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).sort();
const { default: puppeteer } = await import("puppeteer-core");
const { server, port } = await serve();
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ["--no-sandbox"] });
const manifest = {}, skipped = [];
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  for (const name of names) {
    try {
      const m = await page.evaluate(async (n) => {
        const f = document.createElement("iframe"); f.style.cssText = "position:fixed;left:-99999px;width:1080px;height:1080px"; document.body.appendChild(f);
        try { await new Promise((r, j) => { f.onload = r; f.onerror = j; f.src = `/plates/${n}.html?adapter=1`; }); const F = f.contentWindow.FILM; await F.ready; return { ...F.meta, hash: String(F.hash) }; }
        finally { f.remove(); }
      }, name);
      manifest[name] = { title: m.title, W: m.W, H: m.H, fps: m.fps, frames: m.durationFrames, kind: m.kind ?? "film", hash: m.hash };
    } catch (e) { skipped.push(`${name}: ${e.message.split("\n")[0]}`); }
  }
} finally { await browser.close(); server.close(); }
fs.writeFileSync(path.join(here, "plates.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`✓ plates.json: ${Object.keys(manifest).length} plates` + (skipped.length ? `, skipped ${skipped.length}:\n  ${skipped.join("\n  ")}` : ""));
