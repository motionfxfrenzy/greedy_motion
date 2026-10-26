// Real row transactions and pg-boss; only use a disposable test database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.PLANNER = 'deterministic';
process.env.GEMINI_API_KEY = 'offline-test-never-sent';
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL must identify a disposable test database');
const { migrate, pool, query } = await import('../src/db/database.ts');
const { startQueues, boss, QUEUES } = await import('../src/jobs/queues.ts');
const { getProject, updateProjectVisuals } = await import('../src/projects/store.ts');
const { enqueueVisuals, produceVisuals } = await import('../src/plan/visuals.ts');
const brandId=randomUUID();
const id=randomUUID(),owner=randomUUID(),now=new Date().toISOString();
const project={id,ownerId:owner,name:'Material queue test',state:'Draft storyboard',createdAt:now,updatedAt:now,request:{theme:'neutral',template:'product-launch',format:'landscape',style:'kinetic'},screenshots:[],comments:[],brief:{look:'vox-collage'},beatPlan:{canvas:'16:9',beats:[{id:'b1',kind:'kinetic',keyword:'Build'}]}};
const deps={get:getProject,update:updateProjectVisuals,read:async()=>null,save:async()=>{},wait:async()=>{},palette:async()=>'',references:async()=>[],enqueue:(projectId,runId)=>boss.send(QUEUES.visuals,{projectId,runId},{db:{executeSql:(sql,values)=>query(sql,values)}})};
const count=async()=>Number((await query("select count(*) from pgboss.job where name=$1 and data->>'projectId'=$2",[QUEUES.visuals,id])).rows[0].count);
try {
 await migrate();await startQueues();
 await query('insert into app.projects(id,owner_id,name,state,data,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$6)',[id,owner,project.name,project.state,project,now]);
 await assert.rejects(enqueueVisuals(id,25,{...deps,enqueue:async(...args)=>{await deps.enqueue(...args);throw Error('rollback');}}),/rollback/);
 assert.equal(await count(),0);assert.equal((await getProject(id)).planVisuals,undefined);console.log('ok enqueue failure rolls back project and job');
 await Promise.all(Array.from({length:5},()=>enqueueVisuals(id,25,deps)));
 assert.equal(await count(),1);const run=(await getProject(id)).planVisuals.runId;console.log('ok simultaneous enqueue commits one job');
 let entered,release;const entry=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const provider={image:async()=>{entered();await gate;throw Error('unknown provider outcome');},submit:async()=>{throw Error('unexpected');},poll:async()=>null};
 const work=produceVisuals(id,run,provider,deps);await entry;
 await assert.rejects(produceVisuals(id,run,provider,deps),/already running/);
 assert.equal((await getProject(id)).planVisuals.status,'generating');release();await assert.rejects(work,/unknown provider outcome/);
 assert.ok((await getProject(id)).planVisuals.stylePending);console.log('ok real row locking fences duplicate consumer and preserves uncertain request');
 const recoveryDir=await mkdtemp(join(tmpdir(),'material-recovery-'));
 try {
  const file=join(recoveryDir,'recovery.json');await writeFile(file,JSON.stringify({runId:run,action:'release-unsubmitted',evidence:'Offline test provider never sent a request'}));
  const script=resolve(import.meta.dirname,'../scripts/reconcile-visuals.ts');
  execFileSync('node',[script,id,file],{env:process.env});assert.ok((await getProject(id)).planVisuals.stylePending);
  execFileSync('node',[script,id,file,'--apply'],{env:process.env});const recovered=(await getProject(id)).planVisuals;
  assert.equal(recovered.stylePending,false);assert.equal(recovered.reservedUsd,.25);assert.equal(recovered.reconciliations.length,1);
  console.log('ok operator CLI dry run leaves state unchanged; apply preserves evidence and reservation');
 } finally {await rm(recoveryDir,{recursive:true,force:true});}
 await query('insert into app.brand_kits(id,owner_id,name,data,created_at) values($1,$2,$3,$4,$5)',[brandId,owner,'Test palette',{colors:{primary:'#336699'},mode:'light'},now]);
 await query("update app.projects set data=jsonb_set(data,'{request,brandId}',to_jsonb($2::text)) where id=$1",[id,brandId]);
 const before=(await getProject(id)).visualBrandSignature;
 await query("update app.brand_kits set data=jsonb_set(data,'{colors,primary}',to_jsonb($2::text)) where id=$1",[brandId,'#991122']);
 assert.notEqual((await getProject(id)).visualBrandSignature,before);console.log('ok changing brand colors in place refreshes project visual signature');
 const queue=await boss.getQueue(QUEUES.visuals);assert.equal(queue.retryLimit,2);assert.equal(queue.retryDelay,310);assert.equal(queue.heartbeatSeconds,30);console.log('ok bounded queue retries and heartbeat configuration');
 const jobs=await boss.fetch(QUEUES.visuals,{batchSize:1});assert.equal(jobs[0].data.runId,run);await boss.complete(QUEUES.visuals,jobs[0].id);console.log('ok committed queue delivery and completion');
} finally {
 await query("delete from pgboss.job where name=$1 and data->>'projectId'=$2",[QUEUES.visuals,id]).catch(()=>{});
 await query('delete from app.projects where id=$1',[id]).catch(()=>{});await query('delete from app.brand_kits where id=$1',[brandId]).catch(()=>{});await boss.stop({graceful:false});await pool.end();
}
