#!/usr/bin/env node
/*
 * Live preview of a painted short, edited and watched in the browser.
 *
 *   node preview.mjs <spec.json> [--width 540] [--port 8765]
 *
 * Builds the timeline and the mixed sound (render.mjs --preview, a few seconds), serves the player, and rebuilds whenever the spec file changes
 * (edit it by hand, or run cli.mjs --spec-only / --fix on it): the open page reloads itself at the same moment of the film.
 * Open  http://localhost:<port>/index.html?preview=/p/preview.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const width = flag("--width", "540"), port = Number(flag("--port", "8765")), specPath = args[0] && path.resolve(args[0]);
if (!specPath || !fs.existsSync(specPath)) { console.error("usage: node preview.mjs <spec.json> [--width 540] [--port 8765]"); process.exit(2); }
const outDir = path.join(path.dirname(specPath), "preview");

let building = false, again = false;
function build() {
  if (building) { again = true; return; }
  building = true; const t0 = Date.now();
  const p = spawn("node", [path.join(here, "render.mjs"), specPath, "--preview", outDir, "--width", width], { stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => (err += d)); p.stdout.on("data", () => {});
  p.on("close", (code) => { building = false; console.log(code === 0 ? `· rebuilt in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `· build failed: ${err.slice(-300)}`); if (again) { again = false; build(); } });
}
build();
let mtime = fs.statSync(specPath).mtimeMs;
fs.watchFile(specPath, { interval: 500 }, (s) => { if (s.mtimeMs !== mtime) { mtime = s.mtimeMs; console.log("· spec changed"); build(); } });

const { server } = await serve({ port, outDir });
console.log(`preview: http://localhost:${port}/index.html?preview=/p/preview.json`);
