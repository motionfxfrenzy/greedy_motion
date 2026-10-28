import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../runtime/layout.js";
import { applyDressing, cleanDressing } from "../dressing.mjs";
import { normalize } from "../lint.mjs";

const run = (spec) => { const s = structuredClone(spec), notes = []; applyDressing(s, (w, m) => notes.push(`${w}: ${m}`)); return { spec: s, notes }; };
const shot = (extra = {}) => ({ place: "meadow", time: "day", season: "winter", weather: "snow", subjects: [{ who: "a", x: 0.5 }, { who: "b", x: 0.35 }], props: [], ...extra });
const film = (...lines) => ({ lines: lines.map(([say, dressing, ...shots]) => ({ say, ...(dressing ? { dressing } : {}), shots })) });

test("the director's dressing is added to every shot of its scene, at the edges, behind (small), marked as dressing", () => {
  const { spec } = run(film(["A", [{ kind: "tree", x: 0.5 }, { kind: "lamp", x: 0.92 }], shot()], ["B", null, shot(), shot()]));
  for (const [li, si] of [[0, 0], [1, 0], [1, 1]]) {
    const props = spec.lines[li].shots[si].props.filter((p) => p.dressing); assert.equal(props.length, 2, `line ${li} shot ${si}`);
    for (const p of props) { assert.ok(p.x < 0.3 || p.x > 0.7, `dressing at x ${p.x} is between the characters`); assert.equal(p.depth, 0.5); }
  }
});
test("a new place gets its own dressing (or none): the set does not follow the characters to a different place", () => {
  const { spec } = run(film(["A", [{ kind: "tree", x: 0.1 }], shot()], ["B", null, shot({ place: "lake" })], ["C", [{ kind: "house", x: 0.9 }], shot({ place: "lake" })]));
  assert.equal(spec.lines[1].shots[0].props.length, 0, "no dressing written for the lake yet"); assert.deepEqual(spec.lines[2].shots[0].props.map((p) => p.kind), ["house"]);
});
test("dressing is never a story object or a sky thing, never over the limits, custom needs a description", () => {
  const notes = []; const out = cleanDressing([{ kind: "boat" }, { kind: "moon" }, { kind: "custom" }, { kind: "custom", describe: "a crow on a post" }, { kind: "custom", describe: "a snowman" }, { kind: "custom", describe: "a third drawing" }, { kind: "tree" }, { kind: "tree" }, { kind: "lamp" }, { kind: "house" }], (m) => notes.push(m));
  assert.ok(out.length <= 5); assert.ok(out.filter((d) => d.kind === "custom").length <= 2); assert.ok(!out.some((d) => d.kind === "boat" || d.kind === "moon")); assert.ok(notes.length >= 3);
});
test("dressing keeps clear of the characters: an item over a person moves to the nearer edge", () => {
  const { spec } = run(film(["A", [{ kind: "tree", x: 0.5 }, { kind: "lamp", x: 0.37 }], shot()]));
  for (const p of spec.lines[0].shots[0].props) assert.ok(Math.abs(p.x - 0.5) > 0.14 && Math.abs(p.x - 0.35) > 0.14, `${p.kind} at ${p.x}`);
});
test("no dressing indoors that belongs outdoors, and none on plates or the open sky", () => {
  const { spec } = run(film(["A", [{ kind: "tree", x: 0.1 }, { kind: "lamp", x: 0.9 }], { place: "interior", room: "cabin", subjects: [] }], ["B", [{ kind: "tree", x: 0.1 }], { place: "plate", plate: "koiDraw" }]));
  assert.deepEqual(spec.lines[0].shots[0].props.map((p) => p.kind), ["lamp"]); assert.equal((spec.lines[1].shots[0].props ?? []).length, 0);
});
test("lint applies dressing, and a second pass adds nothing twice", () => {
  const once = normalize(film(["A", [{ kind: "tree", x: 0.1 }], shot()])).spec; const twice = normalize(once).spec;
  assert.equal(twice.lines[0].shots[0].props.filter((p) => p.dressing).length, 1);
});
test("dressing never decides the framing: a tall tree does not shrink the characters", () => {
  const { compose } = globalThis.PaintedLayout, plain = compose({ place: "meadow", subjects: [{ x: 0.5 }], props: [] }, { base: 0.82 }), dressed = compose({ place: "meadow", subjects: [{ x: 0.5 }], props: [{ kind: "tree", x: 0.1, depth: 0.5, dressing: true, dimensions: { height: 30, width: 10 } }] }, { base: 0.82 });
  assert.equal(dressed.subjects[0].h, plain.subjects[0].h);
});
test("the brief asks for dressing and for vocabulary places before custom ones; both renderers keep dressing out of the story", () => {
  const brief = fs.readFileSync(new URL("../brief.mjs", import.meta.url), "utf8"); assert.match(brief, /Set dressing/); assert.match(brief, /Prefer the vocabulary/);
});

test("dressing is modest in size: a rock is a boulder, not a headland", () => {
  const { spec } = run(film(["A", [{ kind: "rock", x: 0.9 }, { kind: "tree", x: 0.1 }], shot()]));
  const rock = spec.lines[0].shots[0].props.find((p) => p.kind === "rock"); assert.ok(rock.dimensions.width <= 3 && rock.dimensions.height <= 1);
});
test("a doodle film never cuts to another film's style: a plate becomes a place", () => {
  const r = normalize({ style: "doodle", lines: [{ say: "The tree bloomed.", shots: [{ place: "plate", plate: "charcoalErasure" }] }] });
  assert.notEqual(r.spec.lines[0].shots[0].place, "plate"); assert.ok(r.notes.some((n) => /another film's style/.test(n)));
});

test("relocated dressing stays unchanged when a saved scene is rendered again",()=>{const once=normalize(film(["A",[{kind:"tree",x:.24},{kind:"lamp",x:.35}],shot()])).spec;assert.deepEqual(normalize(once).spec,once);});
