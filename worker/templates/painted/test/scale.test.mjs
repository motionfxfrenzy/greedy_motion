import test from "node:test";
import assert from "node:assert/strict";
import "../runtime/layout.js";
const { compose } = globalThis.PaintedLayout;
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
const workshop = (extra={}) => ({ place:"interior", props:[{id:"table",kind:"table",h:.2,w:.42}], subjects:[{size:"small",x:.25}], ...extra });

test("screenshot regression: a small-person hint cannot make a table taller than its user", () => {
  const scene=compose(workshop(),{base:.9});
  close(scene.props[0].h/scene.subjects[0].h,.78/1.7);
  close(scene.props[0].y,scene.subjects[0].y);
  assert.ok(scene.subjects[0].h >= .35);
});
test("framing changes the whole scene without changing relative object sizes", () => {
  const a=compose(workshop({framing:"wide"})),b=compose(workshop({framing:"close"}));
  assert.ok(b.subjects[0].h>a.subjects[0].h);
  close(b.props[0].h/a.props[0].h,b.subjects[0].h/a.subjects[0].h);
});
test("depth moves feet toward the horizon and shrinks both people and furniture", () => {
  const a=compose(workshop()),b=compose(workshop({props:[{kind:"table",depth:1}],subjects:[{depth:1}]}));
  assert.ok(b.props[0].y<a.props[0].y); assert.ok(b.subjects[0].h<a.subjects[0].h);
  close(b.props[0].h/a.props[0].h,b.subjects[0].h/a.subjects[0].h);
  close(b.props[0].y,b.subjects[0].y);
});
test("a child differs by physical height, not an independent camera size", () => {
  const s=compose(workshop({subjects:[{heightM:1.7},{age:"child"}]}));
  close(s.subjects[1].h/s.subjects[0].h,1.1/1.7);
  close(s.subjects[1].y,s.subjects[0].y);
});
test("arbitrary custom machines and supports accept physical dimensions", () => {
  const scene=compose({place:"interior",props:[{id:"deck",kind:"custom",recipe:{space:"object"},dimensions:{height:.8,width:2},surface:{x:.5,y:.1,w:.8},depth:.7},{id:"machine",kind:"custom",recipe:{space:"object"},on:"deck",dimensions:{height:.4,width:.5},depth:0}],subjects:[{heightM:1.7,depth:.7}]});
  const [deck,machine]=scene.props;
  close(machine.y,deck.surface.y); close(machine.h/scene.subjects[0].h,.4/1.7); close(machine.depth,.7);
});
test("legacy custom assets inherit their support's corrected scale", () => {
  const s=compose(workshop({props:[{id:"table",kind:"table",h:.2,w:.42},{kind:"custom",on:"table",h:.08,w:.2,recipe:{space:"object"}}]}));
  close(s.props[1].h/s.props[0].h,.4);
  close(s.props[1].y,s.props[0].surface.y);
});
test("oversized attachments fit and edge offsets cannot put them beyond the support", () => {
  const s=compose(workshop({props:[{id:"table",kind:"table"},{kind:"custom",on:"table",recipe:{space:"object"},dimensions:{height:2,width:4},offset:.5}]}));
  const [a,b]=s.props; assert.ok(b.w<=a.surface.w);
  assert.ok(b.x+b.w/2<=a.surface.x+a.surface.w/2+1e-9);
});
test("tower, support and person share one physical scale and fit the frame", () => {
  const s=compose({place:"sea",props:[{id:"island",kind:"rock"},{kind:"lighthouse",on:"island"}],subjects:[{on:"island",heightM:1.7}]});
  close(s.props[1].h/s.subjects[0].h,18/1.7);
  assert.ok(s.props[1].h<.64); close(s.props[1].y,s.props[0].surface.y);
});
test("an intentional miniature remains distinct from a standard building", () => {
  const s=compose({place:"meadow",props:[{kind:"house",dimensions:{height:.35,width:.45}},{kind:"house"}],subjects:[{}]});
  close(s.props[0].h/s.props[1].h,.1);
});
test("framing the small keeper cannot crop the tall lighthouse", () => {
  const s=compose({place:"sea",props:[{id:"island",kind:"rock"},{kind:"lighthouse",on:"island"}],subjects:[{on:"island"}]});
  for (const y of [-.09, -.01]) {
    const lift=globalThis.PaintedLayout.frameLift(s.frameBounds,1.1,y);
    assert.ok(s.frameBounds.top*1.1+y-lift>=.08-1e-9);
  }
});
