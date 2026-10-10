import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSceneRoute,sceneRenderingProblems} from '../../packages/contracts/src/scene-rendering.ts';
import {renderManifest} from '../src/plan/render-manifest.ts';
import {preflightRender} from '../../worker/src/render-preflight.mjs';
const beat={kind:'kinetic',role:'feature',energy:'high'};
assert.equal(resolveSceneRoute(beat).renderer,'canvas2d');
assert.equal(resolveSceneRoute({...beat,energy:'medium'}).renderer,'dom');
assert.equal(resolveSceneRoute({...beat,kind:'ui'}).renderer,'dom');
assert.equal(resolveSceneRoute({...beat,render:{graphic:'dom'}}).renderer,'dom');
for(const treatment of ['doodle','sketch','hairline'])assert.equal(resolveSceneRoute({...beat,render:{treatment}}).renderer,treatment==='hairline'?'hairline-svg':'rough-svg');
assert.equal(resolveSceneRoute(beat,'paper').renderer,'media');
assert.equal(resolveSceneRoute({...beat,role:'cta'},'paper').renderer,'dom');
assert.throws(()=>resolveSceneRoute({...beat,render:{treatment:'clean'}},'paper'),/Material/);
assert.throws(()=>resolveSceneRoute({...beat,kind:'ui',render:{graphic:'particles'}}),/Procedural/);
for(const render of [null,[],{renderer:'rust'},{graphic:'rust'},{treatment:'clay'},'canvas'])assert(sceneRenderingProblems(render).length);
const dir=await mkdtemp(join(tmpdir(),'scene-contract-'));
const route=resolveSceneRoute(beat),plan={canvas:'16:9',beats:[{id:'one',kind:'kinetic',start:0,end:3,route,motion:{entry:{axis:'x',dir:1},exit:{axis:'x',dir:1}},transition_out:{type:'end'}}]};
try{
 await writeFile(join(dir,'index.html'),'fixture');await writeFile(join(dir,'variables.json'),'{}');
 const m=await renderManifest(dir,plan,{},{});
 const save=async x=>writeFile(join(dir,'render-manifest.json'),JSON.stringify(x));await save(m);
 assert.equal((await preflightRender(dir,{requireManifest:true})).legacy,false);
 for(const mutate of [x=>x.version=2,x=>x.files['index.html']=null,x=>x.scenes[0].route.renderer='rust',x=>x.scenes[0].startFrame=1,x=>x.totalFrames++,x=>x.scenes[0].route.renderer='media',x=>x.files['../escape']=x.files['index.html']]){const bad=structuredClone(m);mutate(bad);await save(bad);await assert.rejects(preflightRender(dir));}
 await save(m);await writeFile(join(dir,'index.html'),'changed');await assert.rejects(preflightRender(dir),/changed/);
 await rm(join(dir,'index.html'));await symlink('/etc/hosts',join(dir,'index.html'));await assert.rejects(preflightRender(dir),/escapes/);
 await assert.rejects(renderManifest(dir,{...plan,beats:[{...plan.beats[0],route:{...route,renderer:'media'}}]}, {},{}),/requires footage/);
 await assert.rejects(renderManifest(dir,{...plan,beats:[{...plan.beats[0],kind:'ui'}]}, {},{}),/screenshot/);
 await rm(join(dir,'render-manifest.json'));assert.equal((await preflightRender(dir)).legacy,true);await assert.rejects(preflightRender(dir,{requireManifest:true}));
}finally{await rm(dir,{recursive:true,force:true})}
console.log('Scene routing, invalid requests, asset integrity, path containment, missing-media gates and legacy compatibility passed.');
// Model output must survive normalization, plan serialization and preview/export variable creation.
process.env.PLANNER='deterministic';process.env.DATABASE_URL='postgres://unused@127.0.0.1:1/unused';
const {toPlan}=await import('../src/plan/director.ts');
const {engineVariables}=await import('../src/plan/composition.ts');
const raw={role:'hook',kind:'kinetic',line:null,verb:null,keyword:'Move together',on_screen:null,success:false,energy:'high',ui:null,camera:'locked',entry:{axis:'x',dir:-1},exit:{axis:'x',dir:-1},text_effect:null,generation:null,fallback_keyword:null,sfx:null,transition:'end',carrier:null,render:{treatment:null,graphic:'particles'}};
const brief={scriptMode:'problem',text:'Make releases easier to share.',durationSeconds:15,aspect:'16:9',motionProfile:'smooth',pace:'balanced',audio:{mode:'none'},captions:'none'};
const normalized=toPlan({beats:[raw],characters:[],music_prompt:null,voice_direction:null,suggestions:[]},brief,{brandName:'Test',screenshots:[]});
assert.deepEqual(normalized.beats[0].render,{graphic:'particles'});
const roundtrip=JSON.parse(JSON.stringify(normalized));
const values=engineVariables({plan:roundtrip,timing:{beats:[{id:'b1',start:0,end:3}]},shots:{},brandName:'Test'});
assert.equal(JSON.parse(values.plan).beats[0].route.graphic,'particles');
assert.equal(JSON.parse(values.plan).beats[0].route.renderer,'canvas2d');
console.log('Model direction → persisted plan → shared preview/export route passed.');
