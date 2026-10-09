import assert from "node:assert/strict";
process.env.APP_ENV="local";process.env.AUTH_MODE="none";process.env.PLANNER="deterministic";process.env.DATABASE_URL="postgres://unused@127.0.0.1:1/unused";process.env.ANTHROPIC_API_KEY="offline-test-key";
const { loadAuthorSkills, authorContext, routeAuthorStage }=await import("../src/author-skills/bundle.ts");
const { applySourceEdits, proposeCompositionEdit }=await import("../src/pro/assistant.ts");
const { blankComposition }=await import("../src/pro/blank.ts");
const docs=await loadAuthorSkills();assert.ok(docs.size>25);
const cases=[
  ["Animate the headline text", "animation", ["lottie/text-to-lottie/SKILL.md","rive-interactive/skills/rive-interactive/SKILL.md","gsap-timeline/SKILL.md"]],
  ["Make the logo arrive", "logo", ["wiggle-logo/wiggle/SKILL.md","recipe-logo.md"]],
  ["Create a Three.js mesh with GLB loader", "threejs", ["threejs-loaders/SKILL.md"]],
  ["Create a new style skill", "skill-authoring", ["modern-web-design/skills/modern-web-design/SKILL.md"]],
  ["Build a Rive hover interaction", "interaction", ["rive-interactive/skills/rive-interactive/SKILL.md"]],
  ["Review animation pacing", "audit", ["review-animations/SKILL.md"]]
];
for(const [task,stage,paths] of cases){ assert.equal(await routeAuthorStage(task, async()=>({ok:true,json:async()=>({content:[{type:"text",text:JSON.stringify({stage})}]})})),stage);const result=await authorContext(task,stage);assert.equal(result.stage,stage);for(const path of paths)assert.ok(result.skills.some(p=>p.includes(path)),`${task}: missing ${path}`);assert.ok(result.prompt.includes("HyperFrames"));assert.match(result.bundleHash,/^[0-9a-f]{64}$/); }
const html=blankComposition().html;
const edit={find:"Your title",replace:"Better title"};
assert.ok(applySourceEdits(html,[edit]).includes("Better title"));
assert.throws(()=>applySourceEdits("abc abc",[{find:"abc",replace:"x"}]),/one exact/);
let sent;
const fake=async (_url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({stop_reason:"end_turn",content:[{type:"text",text:JSON.stringify({summary:"Change the title",edits:[edit]})}]})};};
const proposal=await proposeCompositionEdit("Animate the title", "title", html, fake, "animation");
assert.equal(proposal.stage,"animation");assert.equal(proposal.edits[0].replace,"Better title");assert.notEqual(proposal.afterHash,proposal.beforeHash);
assert.ok(sent.system[0].text.includes("lottie/text-to-lottie/SKILL.md"));
assert.ok(sent.system[0].text.includes("rive-interactive/skills/rive-interactive/SKILL.md"));
console.log(`Cloud skill routing and offline Claude proposal passed (${docs.size} documents).`);

for (const [task, expected] of [["Add a bold style to the headline","design"],["3D tilt feel","animation"],["toggle-like switch animation","animation"]]) {
  let routingBody;
  const stage = await routeAuthorStage(task, async (_, init) => { routingBody=JSON.parse(init.body); return {ok:true,json:async()=>({content:[{type:"text",text:JSON.stringify({stage:expected})}]})}; });
  assert.equal(stage,expected); assert.equal(routingBody.messages[0].content,task);
  assert.ok(routingBody.output_config.format.schema.properties.stage.enum.includes(expected));
}
let calls=0;
await proposeCompositionEdit("Change the title", "threejs-logo-toggle", html, async (url,init)=>{calls++;const body=JSON.parse(init.body); if(calls===1){assert.equal(body.messages[0].content,"Change the title");return {ok:true,json:async()=>({content:[{type:"text",text:'{"stage":"design"}'}]})};}return fake(url,init);});
assert.equal(calls,2);
assert.equal(await routeAuthorStage("unclear",async()=>({ok:true,json:async()=>({content:[{type:"text",text:'{"stage":"invalid"}'}]})})),"animation");

let repairCalls=0;
const repaired=await proposeCompositionEdit("Change the title","title",html,async(_,init)=>{
 const body=JSON.parse(init.body);repairCalls++;
 if(repairCalls===2)assert.match(body.messages.at(-1).content,/one exact source location/);
 return {ok:true,json:async()=>({content:[{type:"text",text:JSON.stringify({summary:"Retitle",edits:repairCalls===1?[{find:"missing target",replace:"New"}]:[edit]})}]})};
},"animation");
assert.equal(repaired.attempts,2);
let failedCalls=0;
await assert.rejects(()=>proposeCompositionEdit("Retitle","title",html,async()=>{failedCalls++;return {ok:true,json:async()=>({content:[{type:"text",text:JSON.stringify({summary:"bad",edits:[{find:"missing",replace:"other"}]})}]})};},"animation"),/one exact source location/);
assert.equal(failedCalls,3);
let lintCalls=0;
await proposeCompositionEdit("Retitle","title",html,async(_,init)=>{
 const body=JSON.parse(init.body);lintCalls++;
 if(lintCalls===2)assert.match(body.messages.at(-1).content,/HyperFrames lint errors:/);
 const edits=lintCalls===1?[{find:'const tl = gsap.timeline({ paused: true });',replace:'const tl = gsap.timeline({ paused: true }); Math.random();'}]:[edit];
 return {ok:true,json:async()=>({content:[{type:"text",text:JSON.stringify({summary:"Retitle",edits})}]})};
},"animation");
assert.equal(lintCalls,2);

const {seekWarnings}=await import("../src/pro/seek-warnings.ts");
assert.equal(seekWarnings('<script>tl.fromTo(".a",{opacity:0},{opacity:1},1)</script>').length,1);
assert.ok(seekWarnings('<script>tl.set(".a",{opacity:1},1)</script>').some(w=>w.includes("bare GSAP")));
assert.ok(proposal.warnings.some(w=>w.includes("not verified")));
await import('./anthropic.mjs');
