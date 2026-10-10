// Mechanical check of a seam ledger (velocity-matched cuts): for every row, the outgoing element must be moving
// across its last two frames and the incoming element across its first two, both on the ledger's axis and sign.
// Reads real transforms by seeking the composition's GSAP timeline in headless Chrome.
//   node scripts/verify-seams.mjs <composition dir> <ledger.json>
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const [dir, ledgerFile] = process.argv.slice(2).map((p) => resolve(p));
const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
const fps = ledger.fps ?? 30;
const chrome = execFileSync("npx", ["--no-install", "hyperframes", "browser", "path"], { encoding: "utf8" }).trim().split("\n").pop();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.setViewport({ width: 1080, height: 1080 });
await page.goto(pathToFileURL(join(dir, "index.html")).href, { waitUntil: "load" });
for (let i = 0; ; i++) {
  if (await page.evaluate(() => Boolean(window.__timelines && window.__timelines.main))) break;
  if (i > 100) throw new Error("the composition never registered window.__timelines.main");
  await new Promise((r) => setTimeout(r, 100));
}

const read = (t, sel, axis) => page.evaluate((t, sel, axis) => {
  const tl = window.__timelines.main; tl.seek(t, false);
  return gsap.getProperty(sel, axis === "z" ? "scale" : axis);
}, t, sel, axis);

let failed = 0;
const rows = [];
for (const seam of ledger.seams) {
  const first = Math.round(seam.cut * fps) + 1;      // first frame of the incoming scene (frame numbers are 1-based)
  const F = (n) => (n - 1) / fps;
  const e1 = await read(F(first - 2), seam.exit.selector, seam.exit.axis), e2 = await read(F(first - 1), seam.exit.selector, seam.exit.axis);
  const n1 = await read(F(first), seam.entry.selector, seam.entry.axis), n2 = await read(F(first + 1), seam.entry.selector, seam.entry.axis);
  const dExit = e2 - e1, dEntry = n2 - n1, eps = seam.exit.axis === "z" ? 1e-3 : 0.5;
  const sameAxis = seam.exit.axis === seam.entry.axis && seam.exit.dir === seam.entry.dir;
  const exitOk = Math.abs(dExit) > eps && Math.sign(dExit) === seam.exit.dir;
  const entryOk = Math.abs(dEntry) > eps && Math.sign(dEntry) === seam.entry.dir;
  const ok = sameAxis && exitOk && entryOk;
  if (!ok) failed++;
  rows.push({ id: seam.id, cut: seam.cut, axis: seam.exit.axis, dir: seam.exit.dir, exitDelta: +dExit.toFixed(3), entryDelta: +dEntry.toFixed(3), ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${seam.id}: ${seam.exit.axis}${seam.exit.dir > 0 ? "+" : "−"}  exit Δ ${dExit.toFixed(3)} (f${first - 2}→f${first - 1})  entry Δ ${dEntry.toFixed(3)} (f${first}→f${first + 1})`);
}
await browser.close();
await writeFile(join(dir, "seams-verified.json"), JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2) + "\n");
console.log(failed ? `${failed} seam(s) failed` : `all ${rows.length} seams velocity-matched`);
process.exit(failed ? 1 : 0);
