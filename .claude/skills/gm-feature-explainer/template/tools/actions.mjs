// Runs engine.js headless with the project's variables (verify/harness.html) and writes verify/actions.json:
// every demonstrated action the engine scheduled (time, global target point) plus engine warnings.
// usage: node tools/actions.mjs <project-dir>
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
const require = createRequire("/Users/osamaehsaan/Code/Market_apps/VideoSaaS/worker/package.json");
const puppeteer = require("puppeteer-core");
const proj = path.resolve(process.argv[2] || ".");
const vars = JSON.parse(fs.readFileSync(path.join(proj, "variables.json"), "utf8"));
const tpl = fs.readFileSync(path.join(proj, "tools/harness.tpl"), "utf8");
fs.mkdirSync(path.join(proj, "verify"), { recursive: true });
const harness = path.join(proj, "verify/harness.html");
fs.writeFileSync(harness, tpl.replace("__VARS__", JSON.stringify(vars)));
const exe = fs.readdirSync(path.join(process.env.HOME, ".cache/hyperframes/chrome/chrome-headless-shell"))
  .map((d) => path.join(process.env.HOME, ".cache/hyperframes/chrome/chrome-headless-shell", d, "chrome-headless-shell-mac-arm64/chrome-headless-shell"))
  .find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(pathToFileURL(harness).href, { waitUntil: "load" });
const fx = await page.evaluate(() => ({ actions: window.__fx && window.__fx.actions, warnings: window.__fx && window.__fx.warnings, scenes: window.__fx && window.__fx.scenes, duration: window.__fxTimeline && window.__fxTimeline.duration() }));
await browser.close();
fx.pageErrors = errs;
fs.writeFileSync(path.join(proj, "verify/actions.json"), JSON.stringify(fx, null, 1));
console.log(JSON.stringify({ actions: fx.actions && fx.actions.length, warnings: fx.warnings, errors: errs }));
