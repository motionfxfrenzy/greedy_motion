import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.PLANNER = 'deterministic';
process.env.STORAGE_DRIVER = 'filesystem';
process.env.PROJECTS_DIR = await mkdtemp(join(tmpdir(), 'visual-test-media-'));
after(()=>rm(process.env.PROJECTS_DIR,{recursive:true,force:true}));
process.env.DATABASE_URL = 'postgres://unused@127.0.0.1:1/unused';
process.env.GEMINI_API_KEY = 'offline-test-never-sent';
const { looks } = await import('../../packages/contracts/src/looks.ts');
const { produceVisuals, enqueueVisuals, VISUAL_LEASE_MS } = await import('../src/plan/visuals.ts');
const { visualFingerprint, visualStatus, totalReserved, digest, requireReadyVisuals, verifyVisualAssets } = await import('../src/plan/visual-state.ts');
const { validateVideo, VisualProviderTerminalError } = await import('../src/plan/visual-provider.ts');
const temp = await mkdtemp(join(tmpdir(), 'visual-tests-'));
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=12','-t','2','-c:v','libx264','-pix_fmt','yuv420p',join(temp,'clip.mp4')]);
const video = await readFile(join(temp,'clip.mp4'));
await rm(temp,{recursive:true,force:true});
const imageBytes=await sharp({create:{width:300,height:180,channels:3,background:'#336699'}}).png().toBuffer();
export function harness(look = 'vox-collage') {
  let p = { id:'00000000-0000-4000-8000-000000000001', name:'Test', request:{theme:'neutral'}, screenshots:[], brief:{look,productName:'Test'}, beatPlan:{canvas:'16:9', beats:[{id:'hook',kind:'kinetic',keyword:'Build',line:'One action'},{id:'title',kind:'title'},{id:'cta',role:'cta',kind:'kinetic'}]} };
  const files = new Map(), calls = {image:[],submit:[],poll:[]}, queued = [];
  let time = 0, chain = Promise.resolve();
  const deps = {
    get: async()=>structuredClone(p),
    update: (_id, fn) => { const job = chain.catch(()=>{}).then(async()=>{ const v = await fn(structuredClone(p)); p.planVisuals=v; return structuredClone(p); }); chain=job; return job; },
    read: async path=>files.get(path)??null, save: async(path,bytes)=>{files.set(path,bytes);},
    wait:async()=>{}, now:()=>time, palette:async()=>':root{--color-primary:#336699}', references:async()=>[Buffer.from('ref')], enqueue:async(...args)=>{queued.push(args);}
  };
  const provider = { image:async(...args)=>{calls.image.push(args);return imageBytes;},submit:async(...args)=>{calls.submit.push(args);return 'op/1';},poll:async(...args)=>{calls.poll.push(args);return video;} };
  return { get p(){return p;},deps,provider,calls,files,queued,advance:()=>{time+=VISUAL_LEASE_MS+1;},start:async(budget=25)=>{await enqueueVisuals(p.id,budget,deps);},run:()=>produceVisuals(p.id,p.planVisuals.runId,provider,deps) };
}
for (const look of looks.filter(l=>l.renderMode==='generated')) test(`${look.id}: recipe, shared reference, durable clip and readiness`,async()=>{
  const h=harness(look.id); await h.start(); await h.run();
  assert.equal(h.calls.image.length,look.id==='paper-cut'?3:2);assert.equal(h.calls.submit.length,1);
  assert.ok(h.calls.image[0][0].includes(look.instructions.image));
  assert.ok(h.calls.submit[0][0].includes(look.instructions.motion));
  assert.deepEqual(h.calls.image[1][1],[imageBytes]);
  assert.equal(h.p.planVisuals.reservedUsd,look.id==='paper-cut'?2.35:2.1);
  if(look.id==='paper-cut'){assert.ok(h.p.planVisuals.shots.hook.assemblySheet);assert.ok(h.p.planVisuals.shots.hook.startFrame);assert.deepEqual(h.calls.submit[0][4],imageBytes);assert.match(h.calls.submit[0][0],/Never show a grid/);}
  assert.equal(visualStatus(h.p).ready,1);requireReadyVisuals(h.p);
  assert.equal(h.p.planVisuals.worker,undefined);await verifyVisualAssets(h.p,h.deps.read);
  await h.run();assert.equal(h.calls.submit.length,1);
});
test('native styles never enqueue or call providers',async()=>{for(const look of looks.filter(l=>l.renderMode==='native')){const h=harness(look.id);await assert.rejects(h.start(),/does not need/);assert.equal(h.queued.length,0);}});
test('saved operation resumes without another paid request',async()=>{const h=harness();await h.start();h.provider.poll=async()=>{throw Error('transient');};await assert.rejects(h.run(),/transient/);const reserved=h.p.planVisuals.reservedUsd;h.provider.poll=async()=>video;await h.start();await h.run();assert.equal(h.calls.submit.length,1);assert.equal(h.calls.image.length,2);assert.equal(h.p.planVisuals.reservedUsd,reserved);});
test('duplicate consumer cannot fail an active run',async()=>{const h=harness();await h.start();let release,entered;const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);const image=h.provider.image;h.provider.image=async(...args)=>{entered();await gate;return image(...args);};const first=h.run();await entry;await assert.rejects(h.run(),/already running/);assert.equal(h.p.planVisuals.status,'generating');release();await first;assert.equal(h.calls.image.length,2);assert.equal(h.calls.submit.length,1);});
test('unknown submission outcome blocks retries and keeps reservation',async()=>{const h=harness();await h.start();h.provider.submit=async()=>{throw Error('connection lost');};await assert.rejects(h.run(),/connection lost/);assert.equal(h.p.planVisuals.shots.hook.pending,'video');await assert.rejects(h.start(),/Reconcile/);h.p.brief.productName='Edited';await assert.rejects(h.start(),/Reconcile/);assert.equal(totalReserved(h.p.planVisuals),2.1);});
test('missing local reference does not reserve or mark submission pending',async()=>{const h=harness();await h.start();h.deps.references=async()=>{throw Error('missing ref');};await assert.rejects(h.run(),/missing ref/);assert.equal(h.p.planVisuals.reservedUsd,0);assert.ok(!h.p.planVisuals.stylePending);assert.equal(h.calls.image.length,0);});
test('stale success is archived and cumulative budget is enforced',async()=>{const h=harness();await h.start();await h.run();h.p.brief.productName='New';assert.equal(visualStatus(h.p).status,'stale');assert.equal(visualStatus(h.p).reservedUsd,2.1);await assert.rejects(h.start(4),/cumulative/);await h.start(4.2);assert.equal(h.p.planVisuals.history.length,1);await h.run();assert.equal(totalReserved(h.p.planVisuals),4.2);});
test('in-flight operation receipt survives storyboard edit',async()=>{const h=harness();await h.start();h.provider.submit=async()=>{h.p.brief.productName='Changed';return 'accepted-op';};await assert.rejects(h.run(),/storyboard changed/);assert.equal(h.p.planVisuals.shots.hook.operation,'accepted-op');assert.ok(!h.p.planVisuals.shots.hook.pending);assert.throws(()=>requireReadyVisuals(h.p),/current and complete/);});
test('expired consumer is fenced from a replacement owner',async()=>{const h=harness();await h.start();let release,entered;const gate=new Promise(r=>release=r),entry=new Promise(r=>entered=r);h.provider.image=async()=>{entered();await gate;return Buffer.from('old');};const old=h.run();await entry;h.advance();await assert.rejects(h.run(),/submission interrupted/);release();await assert.rejects(old,/ownership changed/);assert.equal(h.p.planVisuals.status,'failed');assert.ok(h.p.planVisuals.stylePending);});
test('terminal operation is not presented as resumable',async()=>{const h=harness();await h.start();h.provider.poll=async()=>{throw new VisualProviderTerminalError('filtered');};await assert.rejects(h.run(),/filtered/);await assert.rejects(h.start(),/permanently/);assert.equal(h.calls.submit.length,1);});
test('budget bounds reject before enqueue or provider calls',async()=>{for(const value of [NaN,Infinity,0,-1,51,2.09]){const h=harness();await assert.rejects(h.start(value));assert.equal(h.queued.length,0);assert.equal(h.calls.image.length,0);}});
test('missing/corrupt clip fails storage verification',async()=>{const h=harness();await h.start();await h.run();for(const key of h.files.keys())if(key.endsWith('.mp4'))h.files.set(key,Buffer.from('corrupt'));await assert.rejects(verifyVisualAssets(h.p,h.deps.read),/corrupt/);});
test('overlay/screenshot changes preserve footage; subject and brand changes invalidate',()=>{const h=harness();const initial=visualFingerprint(h.p);h.p.screenshots.push({id:'new'});h.p.beatPlan.beats[0].on_screen='New overlay';assert.equal(visualFingerprint(h.p),initial);h.p.visualBrandSignature='changed';assert.notEqual(visualFingerprint(h.p),initial);});
test('MP4 must contain decodable video, not merely movie duration',async()=>{await assert.rejects(validateVideo(Buffer.from('invalid')),/invalid MP4/);const mvhd=Buffer.alloc(32);mvhd.writeUInt32BE(32);mvhd.write('mvhd',4);mvhd.writeUInt32BE(1000,20);mvhd.writeUInt32BE(2000,24);const moov=Buffer.alloc(8);moov.writeUInt32BE(40);moov.write('moov',4);await assert.rejects(validateVideo(Buffer.concat([moov,mvhd])),/undecodable/);});
test('operator recovery is evidence-bound, fenced and preserves charges',async()=>{
 const {reconcileVisuals}=await import('../src/plan/visual-recovery.ts');const h=harness();await h.start();h.provider.submit=async()=>{throw Error('unknown');};await assert.rejects(h.run());
 const input={runId:h.p.planVisuals.runId,shot:'hook',action:'attach-operation',operation:'models/veo/operations/known',evidence:'provider receipt 123'};
 assert.throws(()=>reconcileVisuals(h.p.planVisuals,{...input,evidence:''}),/evidence/);
 const fixed=reconcileVisuals(h.p.planVisuals,input);assert.equal(fixed.reservedUsd,2.1);assert.equal(fixed.shots.hook.operation,input.operation);assert.equal(fixed.reconciliations.length,1);assert.ok(!fixed.shots.hook.pending);
 assert.throws(()=>reconcileVisuals({...h.p.planVisuals,worker:{token:'active',expiresAt:Date.now()+60000}},input),/active worker/);
});
test('paper-cut assembly resumes its saved sheet and endpoints without more images',async()=>{
 const h=harness('paper-cut');await h.start();h.provider.poll=async()=>{throw Error('transient');};await assert.rejects(h.run(),/transient/);
 assert.equal(h.calls.image.length,3);const reserved=h.p.planVisuals.reservedUsd;h.provider.poll=async()=>video;await h.start();await h.run();assert.equal(h.calls.image.length,3);assert.equal(h.calls.submit.length,1);assert.equal(h.p.planVisuals.reservedUsd,reserved);
});
test('paper-cut ambiguous sheet submission blocks replay',async()=>{
 const h=harness('paper-cut');await h.start();const image=h.provider.image;let n=0;h.provider.image=async(...args)=>{if(++n===3)throw Error('sheet outcome unknown');return image(...args);};await assert.rejects(h.run(),/sheet outcome/);assert.equal(h.p.planVisuals.shots.hook.pending,'assembly');await assert.rejects(h.start(),/Reconcile/);assert.equal(h.calls.submit.length,0);
});
test('production preview and export builders use the same saved material bytes and reject a draft',async()=>{
 const {buildPlanRenderProject}=await import('../src/plan/render-project.ts');
 const {planPreviewHtml}=await import('../src/plan/preview.ts');const {visualDir}=await import('../src/plan/visual-state.ts');
 const h=harness();h.p.id=randomUUID();h.p.brief={...h.p.brief,theme:'neutral',pace:'balanced',durationSeconds:8,audio:{mode:'none'},captions:'none'};
 h.p.beatPlan.brand={motion_profile:'smooth'};h.p.beatPlan.audio={captions:'none'};
 h.p.beatPlan.beats=h.p.beatPlan.beats.map((b,i)=>({...b,role:i===0?'hook':'cta',keyword:b.keyword??'Ready',motion:{entry:{axis:'x',dir:-1},exit:{axis:'x',dir:1}},transition_out:{type:'cut'}}));
 const output=await mkdtemp(join(tmpdir(),'material-builders-'));
 try{
  await assert.rejects(buildPlanRenderProject(h.p,output),/current and complete/);
  await h.start();await h.run();
  for(const [path,bytes] of h.files){await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
  await buildPlanRenderProject(h.p,output,{check:true});const preview=await planPreviewHtml(h.p),render=await readFile(join(output,'index.html'),'utf8');
  const file=h.p.planVisuals.shots.hook.clip.file;assert.ok(preview.includes('/visuals/'+file));assert.ok(render.includes('visuals/'+file));assert.equal(digest(await readFile(join(output,'visuals',file))),h.p.planVisuals.shots.hook.clip.sha256);
  await writeFile(join(visualDir(h.p.id),file),'corrupt');await assert.rejects(buildPlanRenderProject(h.p,output),/corrupt/);await assert.rejects(planPreviewHtml(h.p),/corrupt/);
 }finally{await rm(output,{recursive:true,force:true});await rm(dirname(visualDir(h.p.id)),{recursive:true,force:true});}
});
test('a live brand change after project load cannot slip into a material export',async()=>{
 const {requireCurrentPalette}=await import('../src/plan/visual-state.ts');const h=harness();await h.start();await h.run();
 assert.throws(()=>requireCurrentPalette(h.p,{colors:{primary:'#991122'},mode:'light'}),/brand palette changed/);
 assert.doesNotThrow(()=>requireCurrentPalette(h.p,null));
});
