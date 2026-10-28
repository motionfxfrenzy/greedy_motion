/* Finds a Chrome for puppeteer-core (the painter, the plate manifest). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function findBrowser() {
  const c = [process.env.PAINTED_BROWSER, process.env.HYPERFRAMES_BROWSER_PATH, process.env.CHROME].filter(Boolean);
  const cache = path.join(os.homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
  if (fs.existsSync(cache)) for (const v of fs.readdirSync(cache).sort().reverse()) { const d = path.join(cache, v); for (const sub of fs.readdirSync(d)) { const f = path.join(d, sub, "chrome-headless-shell"); if (fs.existsSync(f)) c.push(f); } }
  c.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome");
  const found = c.find((f) => fs.existsSync(f)); if (!found) throw new Error("No Chrome or Chromium found (set PAINTED_BROWSER)."); return found;
}
