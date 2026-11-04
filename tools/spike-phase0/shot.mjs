import { chromium } from "../../node_modules/playwright-core/index.mjs";
const [S, name, n, amp, out] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(S + "/p0profile3", { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, viewport: { width: 2880, height: 1100 } });
const page = await ctx.newPage(); await page.goto(`http://127.0.0.1:8766/diff.html?name=${name}&n=${n}&amp=${amp}`); await page.waitForFunction(() => window.done);
console.log(await page.textContent("#t")); await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 2880, height: 540 } }); await ctx.close();
