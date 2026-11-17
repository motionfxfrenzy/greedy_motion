// Recurring props are one object across the film (plates/film-props.ts): planned and drawn ONCE, shared by every scene, a new look only where the script says so.
// Offline: the model calls are fakes. Run: node backend/test/film-props.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const here = dirname(fileURLToPath(import.meta.url));
const fp = await import("../src/plates/film-props.ts");
const { scenePropIssues, probePropsModule } = await import("../src/plan/packs/history-reel/prop-check.ts");
const { templatePack, withPackKit } = await import("../src/plan/template-packs.ts");
const { buildAuthorMessages } = await import("../src/plates/prompt.ts");
const pack = templatePack("history-reel");
const kit = pack.scenes().kit;
const render = readFileSync(join(here, "history-reel-render.mjs"), "utf8");
const NIAGARA = /const SCENE = `([\s\S]*?)`;\n/.exec(render)[1];

// ---- the film: the microwave story (a magnetron box that is rebuilt as a metal box in scene 6)
const beats = [
  { keyword: "Percy", line: "Percy Spencer worked on radar.", visual: "[lab] wide: Percy at the bench, a small grey magnetron box with a blue light sits on it" },
  { keyword: "Candy", line: "A candy bar melted in his pocket.", visual: "[lab] medium: Percy holds a melted candy bar next to the magnetron" },
  { keyword: "Popcorn", line: "He tried popcorn.", visual: "[lab] wide: popcorn kernels jump around the magnetron box" },
  { keyword: "Egg", line: "Then an egg.", visual: "[lab] medium: an egg bursts beside the magnetron" },
  { keyword: "Idea", line: "It was the microwaves.", visual: "[lab] close: Percy points at the box" },
  { keyword: "Metal box", line: "Raytheon built a seven-hundred-pound metal box.", visual: "[lab] wide: a huge steel oven the size of a fridge stands in the lab" },
  { keyword: "Home", line: "Today it fits on a counter.", visual: "[kitchen] wide: a small white microwave on a kitchen counter" }
];
const PLAN_REPLY = JSON.stringify({ props: [
  { id: "magnetron", name: "the magnetron box", aliases: ["magnetron", "box"], description: "a small grey metal box with a round yellow window and a blue indicator light", versions: [{ from: 1, description: "a small grey metal box with a round yellow window and a blue indicator light" }] },
  { id: "microwave", name: "the microwave oven", aliases: ["oven", "microwave"], description: "a huge steel oven the size of a fridge", versions: [{ from: 6, description: "a huge riveted steel oven the size of a fridge" }, { from: 7, description: "a small white kitchen microwave with a dark window" }] }
] });
const CODE = `K.defineProp("magnetron", { w: 190, h: 160, versions: { "1": (c, s) => {
  K.shape(c, () => { c.beginPath(); c.rect(-80, -120, 160, 120); }, "#8b929c", "#6b727c", 20);
  c.fillStyle = "#ffcf3a"; c.beginPath(); c.arc(-20, -62, 26, 0, 7); c.fill(); c.strokeStyle = K.INK; c.lineWidth = 7; c.stroke();
  c.fillStyle = s.active ? "#7ad0ff" : "#2f7fd0"; c.beginPath(); c.arc(50, -96, 10, 0, 7); c.fill();
} } });
K.defineProp("microwave", { w: 300, h: 240, versions: { "1": (c, s) => {
  K.shape(c, () => { c.beginPath(); c.rect(-140, -230, 280, 230); }, "#5f6b76", "#46505a", 30);
  c.fillStyle = "#222"; c.fillRect(-100, -190, 150, 140); c.strokeStyle = K.INK; c.lineWidth = 7; c.strokeRect(-100, -190, 150, 140);
}, "2": (c, s) => {
  K.shape(c, () => { c.beginPath(); c.rect(-90, -110, 180, 110); }, "#f1efe9", "#d6d2c8", 20);
  c.fillStyle = "#1c1c20"; c.fillRect(-70, -90, 100, 70); c.strokeStyle = K.INK; c.lineWidth = 6; c.strokeRect(-70, -90, 100, 70);
} } });`;

// ---- the plan: parsed, clamped, versions by beat, props named by a scene
const plan = fp.parsePropsPlan(PLAN_REPLY, beats.length);
assert.deepEqual(plan.props.map((p) => p.id), ["magnetron", "microwave"]);
assert.deepEqual(plan.props[0].aliases, ["magnetron"], "a general word (box) names nothing: \"the metal box\" must not claim every box");
assert.deepEqual(plan.props[1].versions.map((v) => [v.version, v.from]), [["1", 5], ["2", 6]], "versions start where the script rebuilds or replaces the object (1-based scene -> 0-based beat)");
assert.equal(fp.propVersionForBeat(plan.props[1], 2), "1", "before it appears: its first version");
assert.equal(fp.propVersionForBeat(plan.props[1], 5), "1"); assert.equal(fp.propVersionForBeat(plan.props[1], 6), "2");
assert.deepEqual(fp.propsNamedBy(beats[2], plan).map((p) => p.id), ["magnetron"], "popcorn around the magnetron box");
assert.deepEqual(fp.propsNamedBy(beats[5], plan).map((p) => p.id), ["microwave"], "the steel oven is the microwave prop");
assert.deepEqual(fp.propsNamedBy(beats[6], plan).map((p) => p.id), ["microwave"], '"a small white microwave" is the microwave prop');
assert.deepEqual(fp.propsNamedBy({ visual: "[x] wide: a man walks" }, plan), []);
assert.deepEqual(fp.parsePropsPlan("not json", 5), { props: [] });
assert.deepEqual(fp.parsePropsPlan('{"props":[{"id":"x","aliases":["ab"],"description":"d"}]}', 5).props, [], "an id shorter than 3 characters is dropped");
assert.equal(fp.parsePropsPlan(JSON.stringify({ props: Array.from({ length: 9 }, (_, i) => ({ id: `prop-${i}`, name: "p", aliases: ["thing"], description: "a thing" })) }), 5).props.length, fp.MAX_FILM_PROPS);

// ---- the shared module must run
assert.deepEqual(probePropsModule(CODE, kit, plan), [], "the shared drawings run and paint");
assert.ok(probePropsModule(CODE.replace('"microwave"', '"oven"'), kit, plan).some((m) => /K\.defineProp\("microwave"/.test(m)), "a missing prop is reported");
assert.ok(probePropsModule(CODE.replace('}, "2": (c, s) => {', "}, \"3\": (c, s) => {"), kit, plan).some((m) => /no version "2"/.test(m)), "a missing version is reported");
assert.ok(probePropsModule(CODE.replace("c.fillStyle = s.active", "nope.x; c.fillStyle = s.active"), kit, plan).some((m) => /throws/.test(m)), "a drawing that throws is reported");
assert.ok(probePropsModule('K.defineProp("magnetron", { versions: { "1": () => {} } }); K.defineProp("microwave", { versions: { "1": () => {}, "2": () => {} } });', kit, plan).some((m) => /paints almost nothing/.test(m)), "an empty drawing is reported");

// ---- loadFilmProps: made once for every scene, cached, stable
const store = new Map();
const calls = { plan: 0, code: 0 };
const deps = (over = {}) => ({
  getObject: async (b, k) => store.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { store.set(`${b}:${k}`, Buffer.from(body)); },
  kitHash: "kit1", plan: async () => { calls.plan += 1; return PLAN_REPLY; }, code: async () => { calls.code += 1; return "```ts\n" + CODE + "\n```"; },
  validate: (code, p) => probePropsModule(code, kit, p), ...over
});
const project = { id: "11111111-2222-3333-4444-555555555555", brief: { scriptBeats: beats, scriptNotes: { idea: "the microwave oven" } } };
const [a, b, c] = await Promise.all([fp.loadFilmProps(project, deps()), fp.loadFilmProps(project, deps()), fp.loadFilmProps(project, deps())]);
assert.deepEqual([calls.plan, calls.code], [1, 1], "scenes authored in parallel share ONE plan call and ONE drawing call");
assert.equal(a.code, CODE, "the fence is stripped"); assert.equal(a, b); assert.equal(b, c);
await fp.loadFilmProps(project, deps());
assert.deepEqual([calls.plan, calls.code], [1, 1], "the second read comes from storage: no model call");
// a line edited elsewhere in the script: the same props are planned again, so their drawings are KEPT (the look never changes by accident)
const edited = { ...project, brief: { ...project.brief, scriptBeats: beats.map((x, i) => (i === 1 ? { ...x, line: "A candy bar melted in his pocket one day." } : x)) } };
const kept = await fp.loadFilmProps(edited, deps({ code: async () => { calls.code += 1; return "K.defineProp('magnetron', { versions: { '1': (c) => { c.fillRect(0, 0, 5, 5); c.fillRect(1, 1, 5, 5); } } });"; } }));
assert.equal(kept.code, CODE, "same props planned: the earlier drawings stay"); assert.equal(calls.code, 1); assert.notEqual(kept.hash, a.hash);
// a changed set of props draws again
const newPlan = JSON.stringify({ props: [{ id: "lantern", name: "the lantern", aliases: ["lantern"], description: "a brass lantern", versions: [{ from: 1, description: "a brass lantern" }] }] });
const redrawn = await fp.loadFilmProps({ ...project, brief: { ...project.brief, scriptBeats: [...beats, { line: "x", visual: "[lab] a lantern" }] } }, deps({ plan: async () => newPlan, code: async () => { calls.code += 1; return `K.defineProp("lantern", { w: 90, h: 140, versions: { "1": (c) => { c.fillRect(-20, -100, 40, 100); c.fillRect(-10, -120, 20, 20); } } });`; } }));
assert.equal(redrawn.plan.props[0].id, "lantern"); assert.equal(calls.code, 2);
// no prop recurs: null, and the answer is stored (no second plan call)
const store2 = new Map(); let plans = 0;
const none = (over = {}) => ({ ...deps(), getObject: async (b, k) => store2.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { store2.set(`${b}:${k}`, Buffer.from(body)); }, plan: async () => { plans += 1; return '{"props":[]}'; }, ...over });
assert.equal(await fp.loadFilmProps({ ...project, id: "22222222-2222-3333-4444-555555555555" }, none()), null);
assert.equal(await fp.loadFilmProps({ ...project, id: "22222222-2222-3333-4444-555555555555" }, none()), null); assert.equal(plans, 1);
// a drawing that fails the check gets ONE repair round (with the error), then the film is written without shared props (null)
const store3 = new Map(); const seen = [];
const bad = { ...deps(), getObject: async (b, k) => store3.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { store3.set(`${b}:${k}`, Buffer.from(body)); }, code: async (request) => { seen.push(request.user); return "K.defineProp('magnetron', { versions: { '1': () => {} } });"; } };
assert.equal(await fp.loadFilmProps({ ...project, id: "33333333-2222-3333-4444-555555555555" }, bad), null);
assert.equal(seen.length, 2, "one first try and one repair round"); assert.match(seen[1], /YOUR PREVIOUS CODE FAILED/); assert.match(seen[1], /paints almost nothing|is missing/);

// ---- the scene check: a scene that names a recurring prop must use the shared one
const filmProps = { plan, code: CODE };
const scene = (body) => NIAGARA.replace("K.motes(g, cam, t);", `K.motes(g, cam, t);\n    ${body}`);
const issuesFor = (code, i) => scenePropIssues(code, kit, { filmProps, beat: beats[i], beatIndex: i, aspect: "16:9" });
const USE = (v) => `K.prop(g, cam, { use: "magnetron", version: "${v}", x: 640, y: 1560, on: "bench", state: { t, active: frame > 40 ? 1 : 0 } });`;
assert.deepEqual(issuesFor(scene(USE("1")), 2), [], "scene 3 names the magnetron and uses the shared drawing");
const own = issuesFor(scene(`K.prop(g, cam, { name: "magnetron", x: 640, y: 1560, on: "bench", draw: (c) => { c.fillStyle = "#555"; c.fillRect(-60, -80, 120, 80); } });`), 2);
assert.ok(own.some((m) => /recurring prop "magnetron".*draws its own/.test(m)), `its own drawing of the magnetron is rejected: ${own[0]?.slice(0, 120)}`);
assert.ok(issuesFor(scene(""), 2).some((m) => /does not use the shared drawing/.test(m)), "a scene that names the magnetron but never shows it is sent back too");
assert.ok(issuesFor(scene(USE("2")), 2).some((m) => /no version "2"/.test(m)), "a version the prop does not have is rejected");
assert.ok(issuesFor(scene(`K.defineProp("magnetron", { versions: { "1": (c) => {} } }); ${USE("1")}`), 2).some((m) => /K\.defineProp belongs to the film/.test(m)));
assert.deepEqual(issuesFor(scene(`K.prop(g, cam, { use: "microwave", version: "1", x: 640, y: 1560, on: "ground" });`), 5), [], "the steel oven of scene 6 is microwave version 1");
assert.deepEqual(issuesFor(scene(`K.prop(g, cam, { use: "microwave", version: "2", x: 640, y: 1560, on: "counter" });`), 6), [], "the kitchen microwave of scene 7 is version 2");
assert.ok(issuesFor(scene(`K.prop(g, cam, { use: "microwave", version: "1", x: 640, y: 1560, on: "counter" });`), 6).some((m) => /version "1".*shows version "2"/.test(m)));
assert.ok(issuesFor(scene(`K.prop(g, cam, { use: "toaster", x: 640, y: 1560, draw: () => {} });`), 4).some((m) => /not a recurring prop of this film \(known: magnetron, microwave\)/.test(m)), "an unknown id is reported with the known ones");
assert.deepEqual(issuesFor(NIAGARA, 3).filter((m) => /recurring/.test(m)).length, 1, "a scene that names the magnetron (beat 4) and draws nothing for it is flagged; a scene that does not name any prop is not");
assert.deepEqual(scenePropIssues(NIAGARA, kit, { filmProps, beat: { visual: "[gorge] a man walks", line: "He walked." }, beatIndex: 0, aspect: "16:9" }), [], "no prop named, none drawn: fine");

// ---- the shared module goes into every scene bundle, once, right after the kit
const bundled = withPackKit(`import type { Ctx, Env } from "./core";\nconst x = 1;\n`, pack, CODE);
assert.equal(bundled.split('K.defineProp("magnetron"').length - 1, 1, "once in the bundle");
assert.ok(bundled.indexOf("const K = ") < bundled.indexOf('K.defineProp("magnetron"') && bundled.indexOf('K.defineProp("magnetron"') < bundled.indexOf("const x = 1"), "after the kit, before the scene");
assert.equal(withPackKit(`import type { Ctx } from "./core";\n`, pack), withPackKit(`import type { Ctx } from "./core";\n`, pack, null), "no recurring props: the bundle is what it was");

// ---- the author prompt: the writer is told which props exist, which version this scene shows, and not to draw them
const req = await buildAuthorMessages({ look: "illus-flat-vector", plateName: "illus-flat-vector", film: "the microwave", beats, aspect: "9:16", index: 2, frames: 90, styleExample: "history-reel", filmProps });
const sceneText = req.messages[0].content.at(-1).text;
assert.match(sceneText, /THE FILM'S RECURRING PROPS \(drawn ONCE for the whole film/);
assert.match(sceneText, /"magnetron" \(the magnetron box\): version "1": a small grey metal box/);
assert.match(sceneText, /"microwave" \(the microwave oven\): version "1" from scene 6: a huge riveted steel oven the size of a fridge \| version "2" from scene 7/);
assert.match(sceneText, /THIS SCENE SHOWS: "magnetron" version "1"\. Draw them ONLY with K\.prop\(g, cam, \{ use: "<id>"/);
const sceneNone = (await buildAuthorMessages({ look: "illus-flat-vector", plateName: "illus-flat-vector", film: "x", beats, aspect: "9:16", index: 4 - 4, frames: 90, styleExample: "history-reel", filmProps: { plan: { props: [plan.props[1]] }, code: CODE } })).messages[0].content.at(-1).text;
assert.match(sceneNone, /THIS SCENE SHOWS NONE of them, so do not draw any of these objects/);
const noProps = (await buildAuthorMessages({ look: "illus-flat-vector", plateName: "illus-flat-vector", film: "x", beats, aspect: "9:16", index: 2, frames: 90, styleExample: "history-reel" })).messages[0].content.at(-1).text;
assert.ok(!/RECURRING PROPS/.test(noProps), "a film without recurring props gets the prompt it had");

// ---- the wiring: the author loads the film props once and passes them to the prompt, the check and the bundle
const author = readFileSync(join(here, "../src/plates/author.ts"), "utf8");
assert.match(author, /const filmProps = pack\?\.filmProps \? await filmPropsFor\(project, pack\)/);
assert.match(author, /sceneIssues\?\.\(code, project\.brief\?\.scriptBeats\?\.\[row\.scene_index\], \{ filmProps, beatIndex: row\.scene_index, aspect: row\.aspect \}\)/);
assert.match(author, /withPackKit\(code, pack, filmProps\?\.code\)/);
assert.equal(pack.filmProps, true); assert.equal(templatePack("dark-fable").filmProps, undefined);
// the shared drawing is the kit's, so a recurring prop is anchored in the set like any prop (K.prop with `use`)
assert.match(kit, /const defineProp = \(id: string/); assert.match(kit, /spec\.use as string \| undefined/);

// ---- the cost: one shared share per film, quoted inside the Animation batch setup (30% margin), the real cost logged
assert.equal(await fp.filmPropsMilli(), 729, "0.03 USD of provider cost at the 30% material margin (2.43x, 0.1 USD per token)");
assert.equal(await fp.filmPropsPending({ id: "99999999-2222-3333-4444-555555555555" }, { scriptBeats: beats, scriptNotes: null }, templatePack("dark-fable")), false, "a template without recurring props pays nothing");
assert.equal(await fp.filmPropsPending({ id: "99999999-2222-3333-4444-555555555555" }, { scriptBeats: beats, scriptNotes: null }, pack), true, "a history film whose props are not made yet");
assert.equal(await fp.filmPropsPending({ id: "99999999-2222-3333-4444-555555555555" }, { scriptBeats: beats.slice(0, 1), scriptNotes: null }, pack), false, "one scene cannot have a recurring prop");
const billing = readFileSync(join(here, "../src/billing/step-billing.ts"), "utf8");
assert.match(billing, /const pending = await filmPropsPending\(input\.project[\s\S]*?setupMilli \+= propsMilli; animCodeMilli \+= propsMilli;/, "the quote adds the props once to the batch setup, only while they are not made");
const live = readFileSync(join(here, "../src/plates/film-props.ts"), "utf8");
assert.match(live, /event: "film_props_cost", project: project\.id, calls, usd: .*quotedUsd: FILM_PROPS_USD_ESTIMATE/, "the real cost of each film is logged next to the quote");
assert.match(live, /spent \+= reply\.usd \?\? 0/);

console.log("film-props: a recurring prop is planned and drawn once, shared by every scene, new only where the script says so: ok");
