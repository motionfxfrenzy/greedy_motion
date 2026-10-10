import assert from 'node:assert/strict';
const { anthropicMessage } = await import('../src/anthropic.ts');
const logs = [], delays = [];
let calls = 0;
const payload = { content: [{type:'text',text:'ok'}], stop_reason:'end_turn', usage:{ input_tokens:10, output_tokens:2, cache_read_input_tokens:3, cache_creation_input_tokens:4 } };
const result = await anthropicMessage({max_tokens:10}, {errorPrefix:'Test', sleep:async ms=>delays.push(ms), log:line=>logs.push(JSON.parse(line)), request:async (_url,init)=>{
  calls++;
  assert.equal(init.headers['anthropic-version'],'2023-06-01');
  assert.ok(JSON.parse(init.body).model);
  assert.ok(init.signal);
  return calls < 3 ? new Response('{}',{status:calls===1?429:529}) : Response.json(payload);
}});
assert.deepEqual(result,payload); assert.deepEqual(delays,[500,1000]); assert.equal(calls,3);
assert.deepEqual(Object.fromEntries(Object.entries(logs[0]).filter(([k])=>!['model','event'].includes(k))),{input:10,output:2,cache_read:3,cache_creation:4});
for (const status of [400,500]) {
  let count=0;
  await assert.rejects(()=>anthropicMessage({}, {errorPrefix:'Existing message',includeErrorDetail:true,sleep:async()=>{},request:async()=>{count++;return Response.json({error:{message:'detail'}},{status});}}),new RegExp(`Existing message \\(${status}\\): detail`));
  assert.equal(count,status===400?1:3);
}
for (const reason of ['refusal','max_tokens']) await assert.rejects(()=>anthropicMessage({}, {errorPrefix:'Test',stopErrors:{[reason]:'Original stop message'},log:()=>{},request:async()=>Response.json({stop_reason:reason})}),/Original stop message/);
console.log('shared Anthropic client: retries, limits, headers, usage, stop reasons verified offline');
