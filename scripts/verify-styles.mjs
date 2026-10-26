// Full native-engine style matrix. No model keys, network, database, or paid generation.
// --previews deliberately replaces catalog PNGs with actual rendered frames.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { looks } from "../packages/contracts/src/looks.ts";
const root = resolve(import.meta.dirname, "..");
const out = await mkdtemp(join(tmpdir(), "style-matrix-"));
const chrome = process.env.HYPERFRAMES_BROWSER_PATH || execFileSync("npx", ["--no-install", "hyperframes", "browser", "path"], { cwd:root, encoding:"utf8" }).trim().split("\n").pop();
const browser = await puppeteer.launch({ executablePath:chrome, headless:true, args:["--allow-file-access-from-files", "--disable-gpu", "--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const report = [];
const unique = new Set();
async function capture(time) {
  await page.evaluate((t) => { window.__timelines.main.seek(t, false); }, time);
  return page.screenshot({ type:"png" });
}
try {
  for (const look of looks.filter((item) => item.available)) {
    console.log(`checking ${look.id}`);
    const dir = join(out,look.id);
    await cp(join(root,`validation/creative-libraries/engine-${look.id}`),dir,{recursive:true});
    await mkdir(join(dir,"vendor"),{recursive:true});
    await cp(join(root,"node_modules/gsap/dist/gsap.min.js"),join(dir,"vendor/gsap.min.js"));
    // Reproduce HyperFrames' variable hydration when driving the registered timeline directly.
    const original = (await readFile(join(dir,"index.html"),"utf8")).replace('<script id="bp-engine">', `<script>window.__hfVariables = Object.fromEntries(JSON.parse(document.documentElement.getAttribute('data-composition-variables')).map(v => [v.id, v.default]));</script><script id="bp-engine">`);
    const themeA = await readFile(join(root,"worker/themes/blue-professional.css"),"utf8");
    const themeB = await readFile(join(root,"worker/themes/biennale-yellow.css"),"utf8");
    await writeFile(join(dir,"theme.css"),themeA);
    const hashes = [];
    for (const [width,height] of [[1920,1080],[1080,1920],[1080,1080]]) {
      await page.setViewport({width,height,deviceScaleFactor:1});
      const html = original.replace(/data-width="\d+"/,`data-width="${width}"`).replace(/data-height="\d+"/,`data-height="${height}"`).replace("</head>",`<style>#root{width:${width}px;height:${height}px}</style></head>`);
      await writeFile(join(dir,"index.html"),html);
      console.log(`  loading ${width}x${height}`);
      await page.goto(pathToFileURL(join(dir,"index.html")).href,{waitUntil:"networkidle0"});
      await page.waitForFunction(() => document.fonts.status === "loaded", { timeout: 10000 });
      assert.equal(await page.evaluate(() => window.__bp.look),look.id);
      assert.equal(await page.evaluate(() => window.__bp.beats.length),4,"fixture must render all four scenes");
      assert.deepEqual(errors,[],`${look.id}: runtime or asset error`);
      const times=[1.6,4.6,8.6,11.5];
      const first=[];
      for (const t of times) {
        const image=await capture(t);
        first.push(hash(image));
        await writeFile(join(dir,`${width}-${t}.png`),image);
        if (width===1920 && t===1.6) {
          assert.ok(!unique.has(hash(image)),`${look.id} visually duplicates another style`);
          unique.add(hash(image));
          hashes.push(hash(image));
          if (process.argv.includes("--previews") && look.preview.kind === "image" && look.preview.src.endsWith(".png")) {
            await sharp(image).resize(480,270).png().toFile(join(root,"frontend/public",look.preview.src));
          }
        }
      }
      // Seek in reverse then repeat all scene frames, catching accumulated animation state.
      for (const t of [...times].reverse()) await capture(t);
      for (let i=0;i<times.length;i++) assert.equal(hash(await capture(times[i])),first[i],`${look.id} ${width} nondeterministic at ${times[i]}`);
      const shifted = hash(await capture(1.8));
      assert.notEqual(shifted,first[0],`${look.id}: timeline is static`);
      if(width===1920) {
        await page.addStyleTag({content:themeB});
        assert.notEqual(hash(await capture(1.6)),first[0],`${look.id}: ignores brand tokens`);
      }
    }
    report.push({id:look.id,aspects:3,scenes:4,backwardSeek:true,brandBound:true,distinct:true});
    console.log(`ok ${look.id}: 12 scene/aspect captures, backward seek, motion, brand binding`);
  }
} finally { await browser.close(); }
await writeFile(join(out,"report.json"),JSON.stringify({styles:report},null,2)+"\n");
console.log(`Verified ${report.length} styles. Captures and report: ${out}`);
