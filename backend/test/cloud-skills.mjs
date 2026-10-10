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
// The craft every local build follows reaches the hosted author from the same files (shared-craft, watchability, recipes).
for(const stage of ["design","animation","threejs","logo","interaction","skill-authoring","audit"]){
  const { prompt, skills: loaded }=await authorContext("Tidy this scene",stage);
  assert.ok(prompt.includes("## Camera, springs and weight"),`${stage}: shared craft (camera, springs, weight) missing`);
  assert.ok(prompt.includes("## Review: judge frames, not intentions"),`${stage}: review protocol missing`);
  assert.ok(prompt.includes("Explicit identity baseline"),`${stage}: seek-safety craft missing`);
  assert.ok(!prompt.includes("Rendering in this repo")&&!prompt.includes("cloud:skip")&&!prompt.includes("director:skip"),`${stage}: local-only text leaked into the hosted prompt`);
  if(stage!=="threejs")assert.ok(prompt.includes("# Watchability"),`${stage}: watchability missing`);
}
{ const spring=await authorContext("Make the chips pop with a bounce","animation"), flood=await authorContext("The button floods the page and hands over to the chat bubble","animation"), ink=await authorContext("Give the hand-drawn title a living hold","animation"), plain=await authorContext("Make the title bigger","animation");
  for(const r of [spring,flood,ink,plain])assert.ok(r.prompt.includes("stages/recipes/camera-rig.md")&&r.prompt.includes("stages/recipes/spring-settle.md"),"camera-rig and spring-settle are always loaded for animation");
  assert.ok(flood.prompt.includes("stages/recipes/flood-handoff.md")&&!plain.prompt.includes("stages/recipes/flood-handoff.md"),"flood-handoff loads only for a handoff task");
  assert.ok(ink.prompt.includes("stages/recipes/line-boil.md")&&!plain.prompt.includes("stages/recipes/line-boil.md"),"line-boil loads only for a hand-drawn task");
  assert.ok(!spring.prompt.includes("Verified (2026"),"a recipe's evidence section is not sent to the author");
}
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

const {seekWarnings,craftWarnings}=await import("../src/pro/seek-warnings.ts");
assert.equal(seekWarnings('<script>tl.fromTo(".a",{opacity:0},{opacity:1},1)</script>').length,1);
assert.ok(seekWarnings('<script>tl.set(".a",{opacity:1},1)</script>').some(w=>w.includes("bare GSAP")));
assert.ok(proposal.warnings.some(w=>w.includes("not verified")));
assert.deepEqual(craftWarnings("<style>#a{position:absolute;z-index:1}</style><script>gsap.set('#a',{x:0,y:0,scale:1});tl.fromTo('#a',{opacity:0,y:20},{opacity:1,y:0,ease:'power3.out'},0)</script>"),[],"a clean composition raises nothing");
const dirty=craftWarnings("<style>.a{position:absolute;transition:all .3s}.b{position:absolute}.c{position:absolute}</style><script>const r=Math.random();tl.fromTo('.a',{opacity:0,scale:.4},{opacity:1,scale:1,ease:'back.out(2)',repeat:-1});tl.fromTo('.b',{opacity:0,filter:'blur(8px)'},{opacity:1,filter:'blur(0px)'})</script>");
for(const part of ["clock, a timer or a random","CSS transition","infinite repeat","overshooting ease","blur-in","no z-index","identity transform"])assert.ok(dirty.some(w=>w.includes(part)),`craft warning missing: ${part}`);
await import('./anthropic.mjs');
const {loadBundle}=await import('../src/formats/bundle.ts');
assert.equal((await loadBundle()).bundle,proposal.bundleHash,'formats and proposals share one bundle identity');
const {skillBundle}=await import('../src/skills/loader.ts');
const unified=await skillBundle();
assert.ok(unified.text('director/SCRIPT_FOR_MOTION.md').length>100);
const stages=JSON.parse(unified.text('author/stages.json'));
for(const [stage,entry] of Object.entries(stages)) for(const path of [...entry.sources,...(entry.select??[]).flatMap(r=>r.sources)]) assert.ok(docs.has(path),`${stage}: missing ${path}`);
