// Call-contract tests only: no rasterization, software renderer or GPU substitute.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { normalize } from "../lint.mjs";
function draw(shot) {
  const calls = [], g = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const window = { PaintedKit: { mix: c => c, lerp: (a,b,t) => a+(b-a)*t } };
  const context = vm.createContext({ window });
  for (const f of ["layout", "scenes"]) vm.runInContext(fs.readFileSync(new URL(`../runtime/${f}.js`, import.meta.url), "utf8"), context);
  window.PaintedLayout = context.PaintedLayout;
  const kit = new Proxy({ g, H: 960, W: 540, X: x => x*540, Y: y => y*960 }, { get: (obj, key) => key in obj ? obj[key] : (...args) => calls.push([key, ...args]) });
  window.PaintedScenes.draw(kit, shot);
  return calls;
}
test("a supported building does not replace the sea with a full-width ground strip", () => {
  const spec = normalize({ objects: { r: { kind: "rock" }, l: { kind: "lighthouse", on: "r" } }, lines: [{ shots: [{ place: "sea", time: "day", props: [{ id: "l" }] }] }] }).spec;
  const calls = draw(spec.lines[0].shots[0]), rock = calls.find(c => c[0] === "rock"), tower = calls.find(c => c[0] === "lighthouse");
  assert.ok(!calls.some(c => c[0] === "ground"));
  assert.ok(calls.indexOf(rock) < calls.indexOf(tower));
  assert.equal(tower[1].y, rock[1].y - rock[1].h*.8);
});
test("an attached jar stays on the table even with people in the scene", () => {
  const calls = draw({ place: "meadow", time: "day", props: [{ id: "t", kind: "table", bread: false }, { kind: "jar", on: "t" }], subjects: [{ pose: "stand", size: "small", x: .2 }] });
  const jars = calls.filter(c => c[0] === "jar"), table = calls.find(c => c[0] === "table");
  assert.equal(jars.length, 1); assert.equal(jars[0][1].y, table[1].y-table[1].h);
});
test("local custom assets are translated, scaled, and cannot extend like scenery", () => {
  const calls = draw({ place: "meadow", time: "day", props: [{ kind: "custom", x: .7, w: .2, h: .15, recipe: { space: "object", layers: [] } }] });
  const scale = calls.find(c => c[0] === "scale"), translate = calls.find(c => c[0] === "translate");
  assert.ok(Math.abs(translate[1] + scale[1] * 540 / 2 - .7 * 540) < 1e-8);
  assert.ok(scale[1] > 0 && scale[2] > 0);
  assert.equal(calls.find(c => c[0] === "recipe")[2].extend, false);
});
test("people placed on a support stand on its actual top", () => {
  const calls = draw({ place: "sea", time: "day", props: [{ id: "r", kind: "rock" }], subjects: [{ on: "r", size: "small", pose: "stand" }] });
  const rock = calls.find(c => c[0] === "rock")[1], person = calls.find(c => c[0] === "person")[1];
  assert.equal(person.y, rock.y - rock.h*.8); assert.equal(person.x, rock.x);
  assert.ok(!calls.some(c => c[0] === "ground"));
});
test("explicit tabletop objects suppress automatic bread and duplicate room tables", () => {
  const plain = draw({ place: "meadow", time: "day", props: [{ kind: "table" }] });
  assert.equal(plain.find(c => c[0] === "table")[1].bread, true);
  const calls = draw({ place: "interior", time: "day", room: "workshop", props: [{ id: "t", kind: "table" }, { kind: "jar", on: "t" }] });
  assert.equal(calls.find(c => c[0] === "roomOf")[1].includeTable, false);
  assert.equal(calls.find(c => c[0] === "table")[1].bread, false);
  const explicit = draw({ place: "meadow", time: "day", props: [{ id: "t", kind: "table", bread: true }, { kind: "jar", on: "t" }] });
  assert.equal(explicit.find(c => c[0] === "table")[1].bread, true);
});
test("autumn leaves belong to vegetation, not the open sea or desert", () => {
  for (const place of ["sea", "desert", "sky"]) assert.ok(!draw({ place, time: "day", season: "autumn" }).some(c => c[0] === "leaves"));
  assert.ok(draw({ place: "forest", time: "day", season: "autumn" }).some(c => c[0] === "leaves"));
});

test("a boat on a shore floats at the waterline, not on the sand", () => {
  const boat = draw({ place: "shore", time: "dawn", props: [{ kind: "boat", x: .85 }], subjects: [{ pose: "stand", x: .3 }] }).find(c => c[0] === "boat");
  assert.ok(boat[1].y < .765 && boat[1].y > .6, "boat y " + boat[1].y);
});

test("a nearer prop is drawn after a farther one, whatever the listing order", () => {
  const calls = draw({ place: "sea", time: "day", weather: "clear", props: [{ kind: "boat", x: .3 }, { kind: "rock", id: "r", depth: .6 }, { kind: "lighthouse", on: "r" }] });
  const order = ["rock", "lighthouse", "boat"].map(n => calls.findIndex(c => c[0] === n));
  assert.ok(order.every(i => i >= 0), "all drawn"); assert.ok(order[0] < order[1] && order[1] < order[2], order.join());
});
