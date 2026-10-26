import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
const root=resolve(import.meta.dirname,'../validation/mixed-renderer');
console.log('launching browser');
const browser=await puppeteer.launch({executablePath:execFileSync('npx',['--no-install','hyperframes','browser','path'],{encoding:'utf8'}).trim().split('\n').pop(),headless:true,protocolTimeout:30000,args:['--disable-gpu','--no-sandbox','--allow-file-access-from-files']});
const results=[];
try{for(const aspect of ['16x9','9x16','1x1']){
 const dir=join(root,aspect),m=JSON.parse(await readFile(join(dir,'render-manifest.json'),'utf8')),page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()));
 console.log('checking',aspect);await page.evaluateOnNewDocument(v=>{window.__hfVariables=v},JSON.parse(await readFile(join(dir,'variables.json'),'utf8')));await page.setViewport(m.canvas);await page.goto(pathToFileURL(join(dir,'index.html')).href);await page.addStyleTag({content:'html,body{width:100%;height:100%}'});console.log('page loaded');await page.evaluate(async()=>{await document.fonts.ready;return true});console.log('fonts ready');
 assert.deepEqual(await page.evaluate(()=>window.__bp.beats.map(b=>b.route.renderer)),['canvas2d','dom','rough-svg','hairline-svg','dom']);
 const hashes=new Map(),frames=new Map(),seekComparisons=[];const times=[1.5,4.5,7.5,10.5,13.5,2.966666667,3,3.033333333,5.966666667,6,6.033333333,8.966666667,9,9.033333333,11.966666667,12,12.033333333];
 async function capture(t){console.log(aspect,t);await page.evaluate(t=>{window.__timelines.main.seek(t,false)},t);return page.screenshot()}
 for(const t of times){const b=await capture(t);const stats=await sharp(b).stats();assert(Math.max(...stats.channels.map(c=>c.stdev))>3,`blank image at ${aspect} ${t}`);frames.set(t,b);hashes.set(t,createHash('sha256').update(b).digest('hex'));await writeFile(join(dir,`pose-${t}.png`),b);
  assert(await page.evaluate(()=>[...document.querySelectorAll('.beat')].some(el=>getComputedStyle(el).visibility==='visible'&&Number(getComputedStyle(el).opacity)>0)),`blank scene at ${t}`);
 }
 assert(new Set(hashes.values()).size>=5,'Scenes must be visually distinct');
 for(const t of [...times].reverse()){
   const b=await capture(t),exact=createHash('sha256').update(b).digest('hex')===hashes.get(t);
   const left=await sharp(frames.get(t)).removeAlpha().raw().toBuffer(),right=await sharp(b).removeAlpha().raw().toBuffer();let sum=0,max=0,changed=0;
   for(let i=0;i<left.length;i++){const d=Math.abs(left[i]-right[i]);sum+=d;max=Math.max(max,d);if(d)changed++;}
   const mae=sum/left.length,changedFraction=changed/left.length;
   // Chromium can rasterize a subpixel edge differently after a reverse transform. This bound
   // permits tiny antialias variation, not missing shapes, altered poses or a different frame.
   assert(mae<=.005 && changedFraction<=.001,`${aspect} reverse seek ${t}: MAE ${mae}, max ${max}, changed ${changedFraction}`);
   seekComparisons.push({time:t,exact,mae,max,changedFraction});
 }

 await page.evaluate(()=>{window.__timelines.main.seek(1.5,false)});
 const before=await page.evaluate(()=>window.__bp.canvas[0].draws);
 await page.evaluate(()=>{for(let i=0;i<100;i++)window.__timelines.main.seek(4+i*.001,false)});
 assert.equal(await page.evaluate(()=>window.__bp.canvas[0].draws),before,'inactive canvas did work');
 assert.equal(await page.evaluate(()=>document.querySelector('[data-beat="interface"]').classList.contains('look-drawn')),false);
 // Exercise the automatic high-energy route's other Canvas implementation too.
 const orbits=await page.evaluate(()=>{
   window.__bp.beats[0].route.graphic='orbits';
   const c=document.querySelector('canvas');
   window.__timelines.main.seek(1.2,false);const a=c.toDataURL();
   window.__timelines.main.seek(1.5,false);const b=c.toDataURL();
   window.__timelines.main.seek(1.2,false);const again=c.toDataURL();
   return {moves:a!==b,reverseExact:a===again};
 });
 assert.deepEqual(orbits,{moves:true,reverseExact:true});
 assert.deepEqual(errors,[]);
 const result={aspect,reverseSeeks:times.length,seekComparisons,seamFrames:12,routes:m.scenes.map(s=>s.route.renderer),canvas:await page.evaluate(()=>window.__bp.canvas),inactiveCanvasSkipped:true,orbits,errors};results.push(result);await page.close();console.log(result);
}}finally{await browser.close()}
await writeFile(join(root,'browser-check.json'),JSON.stringify(results,null,2));
