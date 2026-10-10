// Local synthetic media only. Exercises the shared production media builder through HyperFrames.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
process.env.PLANNER='deterministic';process.env.DATABASE_URL='postgres://unused@127.0.0.1:1/unused';
const { withVisuals }=await import('../backend/src/plan/visual-composition.ts');
const { visualFingerprint,digest }=await import('../backend/src/plan/visual-state.ts');
const { declareVariables,stampCanvas }=await import('../backend/src/plan/composition.ts');
const run=promisify(execFile),root=resolve(import.meta.dirname,'..');
const out=await mkdtemp(join(tmpdir(),'material-playback-'));
console.log(`Evidence: ${out}`);
const source=join(out,'source.mp4');
await run('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-f','lavfi','-i','sine=frequency=440','-t','8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
const bytes=await readFile(source),hash=digest(bytes),report=[];
for(const aspect of ['16:9','9:16','1:1']){
 const dir=join(out,aspect.replace(':','x'));await cp(join(root,'validation/creative-libraries/engine-vox-collage'),dir,{recursive:true});
 await mkdir(join(dir,'vendor'),{recursive:true});await cp(join(root,'node_modules/gsap/dist/gsap.min.js'),join(dir,'vendor/gsap.min.js'));
 await cp(join(root,'worker/themes/blue-professional.css'),join(dir,'theme.css'));await cp(source,join(dir,'source.mp4'));
 let html=await readFile(join(dir,'index.html'),'utf8');
 const defaults=JSON.parse(html.match(/data-composition-variables='([^']*)'/)[1]);
 const values=Object.fromEntries(defaults.map(v=>[v.id,v.default]));const plan=JSON.parse(values.plan);plan.canvas=aspect;
 // A ten-second scene proves slow playback of an eight-second source.
 plan.beats[0].end=10;plan.beats[1].start=10;plan.beats[1].end=12;plan.beats[1].act_at=11;plan.beats=plan.beats.slice(0,2);
 const project={id:'fixture',name:'Fixture',request:{theme:'neutral'},brief:{look:'vox-collage'},beatPlan:plan,screenshots:[]};
 project.planVisuals={fingerprint:visualFingerprint(project),status:'ready',shots:Object.fromEntries(plan.beats.map(b=>[b.id,{clip:{file:'source.mp4',sha256:hash,duration:8}}]))};
 values.plan=JSON.stringify(plan);for(const b of plan.beats)values['visual.'+b.id]=true;
 html=declareVariables(stampCanvas(html,aspect),values,{asDefaults:true});html=withVisuals(html,project,{beats:plan.beats},f=>f);
 await writeFile(join(dir,'index.html'),html);
 const cli=async(args)=>run('npx',['--no-install','hyperframes',...args],{cwd:root,maxBuffer:16*1024*1024,timeout:300000});
 try {const check=await cli(['check',dir,'--json']);await writeFile(join(dir,'audit.json'),check.stdout);}catch(e){await writeFile(join(dir,'audit.json'),e.stdout||e.message);throw new Error(`HyperFrames audit failed: ${dir}/audit.json`,{cause:e});}
 for(const [name,times] of [['forward','0,1.6,4.6,9.8,10.2,11.9'],['reverse','11.9,10.2,9.8,4.6,1.6,0']]){
  await cli(['snapshot',dir,'--at',times,'--no-end','--no-browser-gpu','--describe','false','-o',join(dir,name)]);
 }
 const snapshots=await readdir(join(dir,'forward'));assert.ok(snapshots.some(f=>f.endsWith('.png')));
 // Compare decoded pixels, not metadata, for every repeated forward/reverse seek.
 const signature=async(folder)=>{const result=[];for(const f of (await readdir(folder)).filter(f=>f.endsWith('.png')))result.push(digest(await sharp(join(folder,f)).raw().toBuffer()));return result.sort();};
 assert.deepEqual(await signature(join(dir,'forward')),await signature(join(dir,'reverse')),'reverse seek changes pixels');
 const render=await cli(['render',dir,'--fps','12','--quality','draft','--workers','1','--no-browser-gpu','-o',join(dir,'export.mp4')]);await writeFile(join(dir,'render.log'),render.stdout+render.stderr);
 const {stdout}=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(dir,'export.mp4')]);const probe=JSON.parse(stdout);
 assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(!probe.streams.some(s=>s.codec_type==='audio'),'muted source leaked audio');assert.ok(Math.abs(Number(probe.format.duration)-12)<0.15);
 await run('ffmpeg',['-v','error','-ss','1.6','-i',join(dir,'export.mp4'),'-frames:v','1',join(dir,'export-frame.png')]);
 report.push({aspect,reverseSeek:true,export:true,muted:true,duration:probe.format.duration});console.log(`ok ${aspect}: snapshots, reverse seek and muted export`);
}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));

const player=await run('node',[join(root,'scripts/verify-material-player.mjs'),out],{cwd:root,maxBuffer:1024*1024,timeout:120000});console.log(player.stdout);
