// Mount the application's actual HyperFrames custom element against a synthetic material fixture.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const root=resolve(import.meta.dirname,'..'),dir=process.argv[2];
if(!dir)throw Error('Pass the evidence directory printed by styles:media');
await build({stdin:{contents:`import '@hyperframes/player';`,resolveDir:root},bundle:true,outfile:join(dir,'player.js')});
let current='16x9';
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<script src="/player.js"></script><hyperframes-player id="player" muted style="display:block;width:960px;height:540px"></hyperframes-player>');return;}
 const file=path==='/runtime.js'?join(root,'node_modules/hyperframes/dist/hyperframe-runtime.js'):join(dir,path);
 const bytes=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.mp4':'video/mp4','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');if(extname(file)==='.mp4') {
  res.setHeader('Accept-Ranges','bytes');const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);res.setHeader('Content-Length',end-start+1);res.end(bytes.subarray(start,end+1));return;}
 }
 res.setHeader('Content-Length',bytes.length);res.end(bytes);
 }catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const chrome=execFileSync('npx',['--no-install','hyperframes','browser','path'],{encoding:'utf8'}).trim().split('\n').pop();
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 for(current of ['16x9','9x16','1x1']){
  let html=await readFile(join(dir,current,'index.html'),'utf8');
  const values=Object.fromEntries(JSON.parse(html.match(/data-composition-variables='([^']*)'/)[1]).map(v=>[v.id,v.default]));
  html=html.replace('<head>',`<head><base href="${base}/${current}/"><script>window.__hfVariables=${JSON.stringify(values)};</script><script src="${base}/runtime.js"></script>`);
  await page.evaluate(html=>{const p=document.getElementById('player');window.testReady=false;p.addEventListener('ready',()=>window.testReady=true,{once:true});p.setAttribute('srcdoc',html);},html);
  await page.waitForFunction(()=>window.testReady,{timeout:30000});
  const frame=page.frames().find(f=>f.url()==='about:srcdoc');assert.ok(frame);
  for(const t of [0,1.6,9.8,10.2,11.9,4.6,1.6]){
   await page.evaluate(t=>document.getElementById('player').seek(t),t);
   const id=t<10?'visual-b1':'visual-b2',expected=t<10?t*.8:t-10;
   await frame.waitForFunction(({id,expected})=>{const v=document.getElementById(id);return v.readyState>=2&&Math.abs(v.currentTime-expected)<.12&&getComputedStyle(v).visibility==='visible';},{timeout:10000},{id,expected}).catch(async e=>{console.log(await frame.evaluate(()=>Array.from(document.querySelectorAll("video")).map(v=>({id:v.id,time:v.currentTime,ready:v.readyState,visibility:getComputedStyle(v).visibility,error:v.error?.message,src:v.currentSrc}))));console.log(await frame.evaluate(()=>({playerKeys:Object.keys(window.__player||{}),hfKeys:Object.keys(window.__hf||{}),current:window.__player?.getCurrentTime?.(),html:document.getElementById("visual-b1").outerHTML})));console.log(errors);throw e;});
   assert.ok(await frame.evaluate(id=>document.getElementById(id).muted,id));
  }
  await page.evaluate(()=>document.getElementById('player').play());
  await frame.waitForFunction(()=>document.getElementById('visual-b1').currentTime>1.5,{timeout:5000});
  await page.evaluate(()=>document.getElementById('player').pause());
  console.log(`ok actual player ${current}: ready, playback, reverse seeks and source timing`);
 }
 assert.deepEqual(errors,[]);await writeFile(join(dir,'player-result.json'),JSON.stringify({aspects:3,playback:true,seeks:true,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
