import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
const root=resolve(import.meta.dirname,'../validation/mixed-renderer'),aspects=['16x9','9x16','1x1'];
const server=createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return}const a=req.url?.slice(1);if(!aspects.includes(a)){res.writeHead(404).end();return}const bytes=await readFile(join(root,a,'output.mp4'));const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');if(match){const start=+match[1],end=Math.min(match[2]?+match[2]:bytes.length-1,bytes.length-1);if(start>end){res.writeHead(416).end();return}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1))}else res.end(bytes)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:execFileSync('npx',['--no-install','hyperframes','browser','path'],{encoding:'utf8'}).trim().split('\n').pop(),headless:true,args:['--no-sandbox','--disable-gpu']});
const result=[];
try{for(const aspect of aspects){const dir=join(root,aspect),m=JSON.parse(await readFile(join(dir,'render-manifest.json'),'utf8'));const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(dir,'output.mp4')],{encoding:'utf8'}));const v=meta.streams.find(s=>s.codec_type==='video');assert.equal(v.width,m.canvas.width);assert.equal(v.height,m.canvas.height);assert.equal(v.nb_frames,String(m.totalFrames));assert.equal(v.r_frame_rate,'30/1');assert.equal(Number(v.duration),m.totalFrames/30);execFileSync('ffmpeg',['-v','error','-i',join(dir,'output.mp4'),'-f','null','-']);
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.setContent(`<video muted controls src="http://127.0.0.1:${server.address().port}/${aspect}"></video>`);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 const advance=await page.$eval('video',async v=>{await v.play();await new Promise(r=>setTimeout(r,500));v.pause();return v.currentTime});assert(advance>.15);
 for(const t of [13.5,1.5,10.5,4.5,7.5,3]){await page.$eval('video',async(v,t)=>{await new Promise((r,j)=>{const timeout=setTimeout(()=>j(Error('Seek timeout')),10000);v.onseeked=()=>{clearTimeout(timeout);r()};v.currentTime=t})},t);const png=await page.$eval('video',v=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png').split(',')[1]});const b=Buffer.from(png,'base64');assert(Math.max(...(await sharp(b).stats()).channels.map(c=>c.stdev))>3);await writeFile(join(dir,`export-${t}.png`),b)}
 assert.deepEqual(errors,[]);await page.close();result.push({aspect,dimensions:[v.width,v.height],fps:v.r_frame_rate,frames:v.nb_frames,seconds:v.duration,fullDecode:true,playback:true,nonchronologicalSeeks:6,silentFixture:true,errors});console.log(aspect,'export passed');
}}finally{await browser.close();await new Promise(r=>server.close(r))}
await writeFile(join(root,'export-check.json'),JSON.stringify(result,null,2));
