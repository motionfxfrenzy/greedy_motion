// Explicitly paid opt-in. Local artifacts, no database writes or deployment.
// node --env-file=.env scripts/validate-material-samples.mjs --live --budget=50 --out=/absolute/output
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
const args=process.argv.slice(2),arg=name=>args.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
if(!args.includes('--live'))throw Error('Paid generation is disabled. Obtain explicit approval, then use --live with an approved --budget and --out.');
const budget=Number(arg('budget')),out=arg('out');
if(!out||!Number.isFinite(budget)||budget<=0||budget>50)throw Error('Provide --out and an approved --budget between 0 and 50 USD.');
process.env.PLANNER='deterministic';process.env.DATABASE_URL='postgres://unused@127.0.0.1:1/unused';process.env.PROJECTS_DIR=resolve(out);process.env.STORAGE_DRIVER='filesystem';
const {looks}=await import('../../packages/contracts/src/looks.ts');
const {enqueueVisuals,produceVisuals}=await import('../src/plan/visuals.ts');
const {readMedia,saveMedia}=await import('../src/media.ts');
const {totalReserved}=await import('../src/plan/visual-state.ts');
const selected=arg('styles')?.split(',')??looks.filter(l=>l.renderMode==='generated').map(l=>l.id);
if(selected.some(id=>!looks.some(l=>l.id===id&&l.renderMode==='generated')))throw Error('Unknown generated style.');
await mkdir(out,{recursive:true});const manifestPath=join(out,'samples.json');
const lockPath=join(out,'generation.lock');
const lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
try {
let manifest=await readFile(manifestPath,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return {projects:{}};throw e;});
const persist=async()=>{await writeFile(manifestPath+'.tmp',JSON.stringify(manifest,null,2)+'\n');await rename(manifestPath+'.tmp',manifestPath);};
for(const id of selected){
 const previousTotal=Object.entries(manifest.projects).filter(([key])=>key!==id).reduce((n,[,p])=>n+totalReserved(p.planVisuals),0);
 let project=manifest.projects[id]??{id:randomUUID(),name:'Material fidelity sample',request:{theme:'blue-professional'},brief:{look:id,productName:'A workshop organizing scattered tools'},screenshots:[],beatPlan:{canvas:'16:9',beats:[{id:'gather',kind:'kinetic',keyword:'Gather scattered tools',line:'One small workshop gathers its scattered tools into a tray.'},{id:'organize',kind:'kinetic',keyword:'Organize the same tools',line:'The same tray slides onto an organized shelf in the same workshop.'}]}};
 const deps={get:async()=>project,update:async(_id,fn)=>{project={...project,planVisuals:await fn(structuredClone(project))};manifest.projects[id]=project;await persist();return structuredClone(project);},read:readMedia,save:saveMedia,wait:ms=>new Promise(r=>setTimeout(r,ms)),palette:()=>readFile(resolve(import.meta.dirname,'../../worker/themes/blue-professional.css'),'utf8'),references:names=>Promise.all(names.map(name=>readFile(resolve(import.meta.dirname,'../style-library/references',name)).then(b=>sharp(b).png().toBuffer()))),enqueue:async()=>{}};
 await enqueueVisuals(project.id,budget-previousTotal,deps);
 await produceVisuals(project.id,project.planVisuals.runId,undefined,deps);
 console.log(`${id}: ready; cumulative reserved $${Object.values(manifest.projects).reduce((n,p)=>n+totalReserved(p.planVisuals),0).toFixed(2)}`);
}
console.log(`Review saved clips and recipes before changing any gallery labels: ${manifestPath}`);

} finally {await lock.close();await unlink(lockPath);}
