import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { writeFileSync } from "node:fs";
const S = process.argv[2], name = process.argv[3], n = Number(process.argv[4]);
const ctx = await chromium.launchPersistentContext(S + "/p0profile2", { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await ctx.newPage(); await page.goto("http://127.0.0.1:8766/harness.html"); await page.waitForFunction(() => window.phase0);
const r = await page.evaluate(`(async()=>{
  const html = await (await fetch("${name}.html")).text();
  const meta = html.match(/raster[^,}]{0,30}/g);
  const host = await createHost(html, "csp+neuter"); await host.call({t:"init",scale:1});
  const w = await host.call({t:"frame",n:${n},mode:"png"}); host.kill();
  const b64 = (buf)=>{let s="";const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s)};
  return {worker:b64(w.png), meta};
})()`).catch(e=>({err:String(e)}));
console.log(JSON.stringify(r.meta ?? r.err));
if (r.worker) writeFileSync(`${S}/${name}-${n}-worker.png`, Buffer.from(r.worker, "base64"));
await ctx.close();
