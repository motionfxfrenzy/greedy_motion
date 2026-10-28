import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../lint.mjs";
import "../runtime/layout.js";
const { layout } = globalThis.PaintedLayout;
const shot = props => ({ place: "sea", time: "day", props });
const film = (objects, ...shots) => ({ objects, lines: shots.map(s => ({ say: "The view changed.", shots: [s] })) });
const objects = { island: { kind: "rock", x: .63, w: .54, h: .18 }, tower: { kind: "lighthouse", on: "island", h: .28 } };

test("a recurring tower restores its rock through weather, interiors and camera changes", () => {
  const input = film(objects, shot([{ id: "tower" }]), { place: "interior", time: "night", props: [] }, { ...shot([{ id: "tower" }, { id: "island", x: .3 }]), weather: "storm" });
  const before = structuredClone(input), spec = normalize(input).spec;
  assert.deepEqual(input, before);
  assert.deepEqual(spec.lines[1].shots[0].props, []);
  for (const i of [0, 2]) {
    const props = spec.lines[i].shots[0].props;
    assert.deepEqual(props.map(p => p.id), ["island", "tower"]);
    const [rock, tower] = layout(props, { place: "sea" });
    assert.equal(tower.x, rock.x); assert.equal(tower.y, rock.surface.y);
  }
  assert.equal(spec.lines[2].shots[0].props[0].x, .3);
  assert.deepEqual(normalize(spec).spec, spec);
});
test("the same support mechanism handles a jar on a table and a house on a cliff", () => {
  for (const [support, child] of [["table", "jar"], ["rock", "house"]]) {
    const props = normalize(film({ base: { kind: support }, item: { kind: child, on: "base", offset: .2 } }, shot([{ id: "item" }]))).spec.lines[0].shots[0].props;
    const [base, item] = layout(props);
    assert.equal(item.y, base.surface.y); assert.equal(item.x, base.surface.x + base.surface.w * .2);
  }
});
test("nested arbitrary supports resolve in dependency order, regardless of input order", () => {
  const props = [{ id: "gift", kind: "custom", on: "shelf" }, { id: "shelf", kind: "custom", on: "platform", h: .1, surface: { x: .5, y: .1, w: .8 } }, { id: "platform", kind: "custom", h: .2, surface: { x: .5, y: .2, w: .7 } }];
  const nodes = layout(props);
  assert.deepEqual(nodes.map(n => n.prop.id), ["platform", "shelf", "gift"]);
  assert.equal(nodes[1].y, nodes[0].surface.y); assert.equal(nodes[2].y, nodes[1].surface.y);
});
test("explicit detachment and a new object id do not inherit another object's support", () => {
  const spec = normalize(film(objects, shot([{ id: "tower", on: null }]), shot([{ id: "other", kind: "lighthouse" }]))).spec;
  assert.equal(spec.lines[0].shots[0].props.length, 1);
  assert.equal(spec.lines[1].shots[0].props[0].on, undefined);
});
test("identified objects of the same kind are distinct", () => {
  const s = normalize(film({}, shot([{ id: "east", kind: "lighthouse" }, { id: "west", kind: "lighthouse" }]))).spec.lines[0].shots[0];
  assert.equal(s.props.length, 2);
});
test("bad ids, missing parents, duplicate ids and cycles are repaired and noted, never fatal", () => {
  const said = (spec, re) => assert.ok(normalize(spec).notes.some((n) => re.test(n)), String(re));
  said(film({}, shot([{ id: "unknown" }])), /unknown object/);
  said(film({}, shot([{ kind: "house", on: "missing" }])), /no such object/);
  said(film({}, shot([{ id: "a", kind: "rock" }, { id: "a", kind: "rock" }])), /second/);
  said(film({ a: { kind: "rock", on: "b" }, b: { kind: "rock", on: "a" } }, shot([{ id: "a" }])), /cyclic/);
  const nodes = layout([{ id: "sky", kind: "moon" }, { kind: "house", on: "sky" }]);   // no surface: it sits at the top middle of the thing under it, the film does not abort
  assert.equal(nodes.length, 2);
});
test("people restore their support without requiring an unrelated prop", () => {
  const spec = normalize(film(objects, { ...shot([]), subjects: [{ pose: "stand", on: "island" }] })).spec;
  assert.equal(spec.lines[0].shots[0].props[0].id, "island");
});
test("non-finite and extreme layout inputs produce bounded geometry", () => {
  const nodes = layout([{ id: "r", kind: "rock", x: NaN, h: Infinity }, { kind: "house", on: "r", offset: 999 }]);
  assert.ok(nodes.every(n => [n.x, n.y, n.w, n.h].every(Number.isFinite)));
  assert.equal(nodes[1].x, nodes[0].surface.x + nodes[0].surface.w * .5);
});
