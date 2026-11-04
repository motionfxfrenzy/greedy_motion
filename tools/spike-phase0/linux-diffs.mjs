// Phase 0 Job A step 5: for every failed scene, render the Worker preview frame and produce an amplified (x40)
// difference image against the Linux reference frame under $P0/linux/<name>-diff-<n>.png (and <name>-diff.png for the worst frame).
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [S] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const index = JSON.parse(readFileSync(join(S, "index.json"), "utf8")).filter((s) => !s.error);
const jobB = JSON.parse(readFileSync(join(S, "job-b.json"), "utf8"));
const foxparams = JSON.parse(readFileSync(join(S, "foxparams.json"), "utf8"));

const ctx = await chromium.launchPersistentContext(join(S, "p0profile3"), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 2880, height: 1100 }
});
const page = await ctx.newPage();

// Pick representative (middle / worst) frame for each scene
const targets = [
  ...index.map((s) => {
    const frames = Object.keys(s.refs).map(Number).sort((a, b) => a - b);
    return { name: s.name, htmlFile: `${s.name}.html`, params: null, frame: frames[1] ?? frames[0] };
  }),
  { name: "foxparamsA", htmlFile: "foxparams.html", params: foxparams.sets.A.canonical, frame: 45 },
  { name: "foxparamsB", htmlFile: "foxparams.html", params: foxparams.sets.B.canonical, frame: 45 },
  ...jobB.map((s) => ({ name: s.name, htmlFile: `${s.name}.html`, params: null, frame: 45 }))
];

await page.goto("http://127.0.0.1:8766/harness.html");
await page.waitForFunction(() => window.phase0);

for (const t of targets) {
  const b64 = await page.evaluate(
    async ({ htmlFile, params, frame }) => {
      const html = await (await fetch(htmlFile)).text();
      const host = await createHost(html, "csp+neuter", params);
      await host.call({ t: "init", scale: 1 });
      const w = await host.call({ t: "frame", n: frame, mode: "png" });
      host.kill();
      let s = "";
      const u = new Uint8Array(w.png);
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    },
    t
  );
  writeFileSync(join(S, "linux", `${t.name}-${t.frame}-worker.png`), Buffer.from(b64, "base64"));
}

const stats = {};
for (const t of targets) {
  const wParam = encodeURIComponent(`linux/${t.name}-${t.frame}-worker.png`);
  const rParam = encodeURIComponent(`linux/${t.name}-ref-${t.frame}.png`);
  const rlParam = encodeURIComponent("Linux worker export (reference)");
  await page.goto(`http://127.0.0.1:8766/diff.html?name=${t.name}&n=${t.frame}&amp=40&w=${wParam}&r=${rParam}&rl=${rlParam}`);
  await page.waitForFunction(() => window.done);
  const info = JSON.parse(await page.textContent("#t"));
  stats[`${t.name}@${t.frame}`] = info;
  const outPath = join(S, "linux", `${t.name}-diff.png`);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 2880, height: 540 } });
  console.log("diff", outPath, JSON.stringify(info.maxDiffLevelHistogram_0to8plus));
}
writeFileSync(join(S, "linux", "diff-stats.json"), JSON.stringify(stats, null, 1));
await ctx.close();
