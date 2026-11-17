// The scene check for props (plan/packs/history-reel/prop-check.ts, kit.txt K.prop): a scene is run against a recording canvas and what would float is reported
// to the author (one repair round, plates/author.ts). Offline. Run: node backend/test/prop-check.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const here = dirname(fileURLToPath(import.meta.url));
const { templatePack } = await import("../src/plan/template-packs.ts");
const { scenePropIssues, probeScene, FLOOR_FROM } = await import("../src/plan/packs/history-reel/prop-check.ts");
const pack = templatePack("history-reel");
const kit = pack.scenes().kit;
const render = readFileSync(join(here, "history-reel-render.mjs"), "utf8");
const NIAGARA = /const SCENE = `([\s\S]*?)`;\n/.exec(render)[1];
const withProps = (body) => NIAGARA.replace("K.motes(g, cam, t);", `K.motes(g, cam, t);\n    ${body}`);
const issues = (code) => scenePropIssues(code, kit);
const has = (list, re) => list.some((m) => re.test(m));

// the pack runs the check as part of its scene rules (the author's one repair round)
assert.deepEqual(pack.sceneIssues(NIAGARA, { visual: "[gorge] a man walks" }), [], "a scene built only from the kit's own calls passes");
assert.ok(has(pack.sceneIssues(withProps(`g.fillStyle = "#222"; g.fillRect(500, 700, 160, 120);`), { visual: "[gorge] x" }), /straight onto the screen/), "and the pack's sceneIssues reports a floating prop");

// scenes that are fine
assert.deepEqual(issues(NIAGARA), [], "the Niagara scene: puppets, crowd, rope, mist and motes are all anchored or kit effects");
assert.deepEqual(issues(withProps(`K.prop(g, cam, { name: "oven", x: 700, y: 1560, on: "bench", draw: (c) => { c.fillStyle = "#222"; c.fillRect(-60, -100, 120, 100); } });`)), [], "a prop through K.prop on a named surface");
assert.deepEqual(issues(withProps(`K.prop(g, cam, { name: "crate", x: 300, y: 1600, draw: (c) => K.crate(c, 0, 0, 120, 90) });`)), [], "the default surface is the ground");
assert.deepEqual(issues(withProps(`K.prop(g, cam, { name: "corn", x: 600 + frame * 3, y: 1560, airborne: 100 + frame, moving: true, draw: (c) => { c.fillStyle = "#fff"; c.fillRect(-8, -16, 16, 16); } });`)), [], "a thrown prop says airborne and moving");
assert.deepEqual(issues(withProps(`K.prop(g, cam, { name: "cart", x: 300 + frame * 2, y: 1600, moving: true, draw: (c) => K.crate(c, 0, 0, 120, 90) });`)), [], "a pushed or carried prop says moving");
assert.deepEqual(issues(withProps(`K.puppet(g, cam, K.makeCast({}), 700, 1600, 400, { face: 1, ...K.pose.holdOut(K.makeCast({}), "three") }, { front: (c, R) => { c.fillStyle = "#333"; c.fillRect(0, 0, 40, 40); } });`)), [], "painting inside a puppet's own prop callback is anchored to the puppet");

// scenes that float
const rawBox = issues(withProps(`g.fillStyle = "#22252e"; g.fillRect(440, 1040, 170, 120); g.fillStyle = "#3aa0ff"; g.beginPath(); g.arc(560, 1100, 14, 0, 7); g.fill();`));
assert.ok(has(rawBox, /Frame 0: the scene paints straight onto the screen \(fillRect x1, fill x1\)/), `a box painted on the screen: ${rawBox[0]?.slice(0, 120)}`);
assert.ok(has(rawBox, /K\.prop\(g, cam/), "the message says what to do instead");
assert.ok(has(issues(withProps(`ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1080, 1920);`)), /straight onto the screen/), "a full-screen fill by the scene is flagged too (use K.fade)");
assert.deepEqual(issues(withProps(`K.at(g, cam, 700, 1500, 1, (c) => { c.fillStyle = "#222"; c.fillRect(-40, -60, 80, 60); });`)), [], "K.at is an anchored placement too: painting inside its callback is fine");
const crate = issues(withProps(`K.crate(g, 710, 1690, 220, 340, "#5a646c");`));
assert.ok(has(crate, /K\.crate\(\.\.\.\) straight on the screen/), "a kit crate called on the screen floats like a hand-painted box");
assert.deepEqual(issues(withProps(`K.prop(g, cam, { name: "c", x: 710, y: 1600, draw: (c) => K.crate(c, 0, 0, 220, 340, "#5a646c") });`)), [], "the same crate inside K.prop is fine");
const hover = issues(withProps(`K.prop(g, cam, { name: "oven", x: 700, y: 900, draw: (c) => { c.fillRect(-60, -100, 120, 100); } });`));
assert.ok(has(hover, /Prop "oven" stands at floor y 900.*mid-air/), "a resting prop whose floor is above the floor of the set hangs in mid-air");
assert.ok(900 / 1935 < FLOOR_FROM);
const drift = issues(withProps(`K.prop(g, cam, { name: "oven", x: 600 + frame, y: 1560, on: "bench", draw: (c) => { c.fillRect(-60, -100, 120, 100); } });`));
assert.ok(has(drift, /Prop "oven" rests in the set but moves/), "a resting prop that moves between frames");
const unknown = issues(withProps(`K.prop(g, cam, { name: "oven", x: 600, y: 1560, on: "ceiling", draw: (c) => { c.fillRect(-60, -100, 120, 100); } });`));
assert.ok(has(unknown, /unknown surface "ceiling"/), "an unknown surface is reported with the valid names");

// what the check records: the placements the kit logged
const probe = probeScene(withProps(`K.prop(g, cam, { name: "oven", x: 700, y: 1560, on: "bench", draw: (c) => { c.fillRect(-60, -100, 120, 100); } });`), kit);
assert.ok(probe.props.length >= 4 && probe.props.every((r) => r.name === "oven" && r.surface === 96 && r.on === "bench" && r.airborne === 0), "one record per probed frame: name, surface height, airborne lift");
assert.deepEqual([...new Set(probe.props.map((r) => r.frame))].length, probe.props.length);

// the probe never throws: a scene it cannot run reports nothing
assert.deepEqual(scenePropIssues("this is not a scene {{{", kit), []);
assert.deepEqual(scenePropIssues(`export const film = { meta: {}, shots: [] };`, kit), []);

// the kit and the author prompt carry the rule
assert.match(kit, /function prop\(ctx: any, cam: any, spec: any\)/);
assert.match(kit, /SURFACES: Record<string, number> = \{ ground: 0/);
assert.match(kit, /let ANCHOR = 0/);
const direction = readFileSync(join(here, "../src/plan/packs/history-reel/index.ts"), "utf8");
assert.match(direction, /ALWAYS \\`K\.prop\\`/, "the author prompt says every standing prop is a K.prop");
assert.match(direction, /NEVER paint a prop straight on \\`g\\`/);
assert.match(pack.drawRule, /K\.prop\(g, cam, \{ name, x, y: floorY, on, draw \}\)/);

// owner scenes (if present): PROP_SCENES=<dir> with scene-1.ts .. scene-9.ts of production film 0ea430cc. The owner reported scenes 5 and 9 (a prop floating above the
// bench); the others are not individually confirmed, so what the check says about them is printed as a finding, not asserted.
const dir = process.env.PROP_SCENES;
if (dir && existsSync(dir)) {
  for (let n = 1; n <= 9; n++) {
    const file = join(dir, `scene-${n}.ts`);
    if (!existsSync(file)) continue;
    const found = issues(readFileSync(file, "utf8"));
    if (n === 5 || n === 9) assert.ok(found.length > 0, `scene ${n} (reported by the owner): the check flags it`);
    console.log(`  scene ${n}${n === 5 || n === 9 ? " (reported)" : ""}: ${found.length ? "flagged: " + found.map((m) => m.slice(0, 90)).join(" | ") : "passes"}`);
  }
}
console.log("prop-check: standing props stay in the set; floating ones go back to the author: ok");
