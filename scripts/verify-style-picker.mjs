// Isolated browser integration of the real React picker, CSS and public assets (no auth/database).
import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import puppeteer from "puppeteer-core";
import { looks } from "../packages/contracts/src/looks.ts";
const root=resolve(import.meta.dirname,"..");
const out=await mkdtemp(join(tmpdir(),"style-picker-"));
await build({stdin:{contents:`import React, {useState} from 'react';import {createRoot} from 'react-dom/client';import {StylePicker} from './frontend/components/style-picker';function App(){const [value,setValue]=useState('clean');return <main style={{maxWidth:960,margin:'30px auto',padding:20}}><h1>Choose your visual style</h1><StylePicker value={value} onChange={setValue}/><output id="selection">{value}</output></main>}createRoot(document.getElementById('app')).render(<App/>);`,resolveDir:root,loader:"tsx"},bundle:true,jsx:"automatic",outfile:join(out,"app.js"),define:{"process.env.NODE_ENV":'"production"'}});
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div><script src="/app.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,"http://localhost");let path=url.pathname==="/"?null:url.pathname==="/app.js"?join(out,"app.js"):url.pathname==="/styles.css"?join(root,"frontend/app/styles.css"):join(root,"frontend/public",url.pathname);const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.mp4':'video/mp4'};res.setHeader('Content-Type',path?mime[extname(path)]||'application/octet-stream':'text/html');res.end(path?await readFile(path):html);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const chrome=process.env.HYPERFRAMES_BROWSER_PATH||execFileSync("npx",["--no-install","hyperframes","browser","path"],{cwd:root,encoding:"utf8"}).trim().split("\n").pop();
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox"]});
try{
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1200,height:1000});await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
 await page.waitForSelector('.style-choice');
 assert.equal(await page.$$eval('.style-choice',cards=>cards.length),looks.length);
 for(const look of looks){await page.evaluate(name=>{Array.from(document.querySelectorAll('.style-choice')).find(e=>e.querySelector('b').textContent===name).click();},look.name);await page.waitForFunction(id=>document.getElementById('selection').textContent===id,{},look.id);assert.equal(await page.$$eval('.style-choice[aria-pressed="true"]',v=>v.length),1);}
 await page.evaluate(()=>Array.from(document.querySelectorAll('.style-filters button')).find(e=>e.textContent==='Paper').click());
 assert.equal(await page.$$eval('.style-choice',v=>v.length),6);
 await page.evaluate(()=>Array.from(document.querySelectorAll('.style-filters button')).find(e=>e.textContent==='All').click());
 // Trigger every lazy thumbnail then verify it decoded.
 for(const img of await page.$$('.style-thumbnail img')) await img.scrollIntoView();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.style-thumbnail img')).every(i=>i.complete&&i.naturalWidth>0));
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(out,'desktop.png'),fullPage:true});
 await page.setViewport({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile horizontal overflow');
 await page.screenshot({path:join(out,'mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(`Picker passed: ${looks.length} selections, family filters, all preview images, mobile overflow. Screenshots: ${out}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
