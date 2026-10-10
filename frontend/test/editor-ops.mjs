import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDoc } from '../lib/editor/fixtures.ts';
import { valueAt } from '../lib/editor/anim.ts';
import * as ops from '../lib/editor/ops.ts';

const doc = () => demoDoc();
const ids = (d) => d.layers.map((l) => l.id);

test('addLayer puts a typed layer on top, in at the playhead; deleteLayers un-parents children', () => {
  const d = doc();
  const id = ops.addLayer(d, 'text', 2.01, 12);
  assert.equal(d.layers[0].id, id);
  assert.equal(d.layers[0].text, 'New text');
  assert.ok(Math.abs(d.layers[0].inP - 2) < 0.04);
  ops.deleteLayers(d, ['rig']);
  assert.equal(d.layers.find((l) => l.id === 'ui').parent, null);
});

test('duplicateLayers makes independent copies with fresh effect ids', () => {
  const d = doc();
  const [copy] = ops.duplicateLayers(d, ['grade']);
  const a = d.layers.find((l) => l.id === 'grade');
  const b = d.layers.find((l) => l.id === copy);
  assert.notEqual(a.effects[0].id, b.effects[0].id);
  b.effects[0].params[0].v = 99;
  assert.notEqual(a.effects[0].params[0].v, 99);
});

test('precompose wraps layers into one pre-comp spanning their range', () => {
  const d = doc();
  const id = ops.precompose(d, ['title', 'bg']);
  assert.ok(!ids(d).includes('title') && !ids(d).includes('bg'));
  const comp = d.layers.find((l) => l.id === id);
  assert.equal(comp.type, 'precomp');
  assert.deepEqual([comp.inP, comp.outP], [0, 12]);
});

test('splitLayer cuts at the playhead and refuses outside the bar', () => {
  const d = doc();
  const second = ops.splitLayer(d, 'title', 4);
  const first = d.layers.find((l) => l.id === 'title');
  const next = d.layers.find((l) => l.id === second);
  assert.equal(first.outP, 4);
  assert.equal(next.inP, 4);
  assert.equal(ops.splitLayer(d, 'title', 4), null);
  assert.equal(ops.splitLayer(d, 'title', 20), null);
});

test('reorderLayer and setParent (cycle refused)', () => {
  const d = doc();
  ops.reorderLayer(d, 'bg', 'cam');
  assert.equal(d.layers[0].id, 'bg');
  ops.reorderLayer(d, 'bg', null);
  assert.equal(d.layers.at(-1).id, 'bg');
  assert.equal(ops.setParent(d, 'rig', 'ui'), false, 'ui is a child of rig');
  assert.equal(ops.setParent(d, 'title', 'rig'), true);
  assert.equal(ops.setParent(d, 'title', 'title'), false);
});

test('bars: move keeps length inside the comp; trim has a minimum; ripple shifts later layers', () => {
  const d = doc();
  const music = d.layers.find((l) => l.id === 'music');
  ops.moveLayerBar(music, 5, 12);
  assert.equal(music.outP, 12);
  assert.equal(music.inP, 0, 'cannot move past the end: clamped to fit');
  const vo = d.layers.find((l) => l.id === 'vo');
  ops.trimLayerEdge(d, 'vo', 'out', vo.inP, 12, false);
  assert.ok(vo.outP - vo.inP >= 0.1 - 1e-9);
  const title = d.layers.find((l) => l.id === 'title');
  title.outP = 4;
  const ui = d.layers.find((l) => l.id === 'ui');
  ui.inP = 4;
  ui.outP = 6;
  ops.trimLayerEdge(d, 'title', 'out', 5, 12, true);
  assert.equal(ui.inP, 5);
  assert.equal(ui.outP, 7);
});

test('stopwatch: on makes a key holding the current value, off bakes the value at the playhead', () => {
  const d = doc();
  const title = d.layers.find((l) => l.id === 'title');
  ops.toggleStopwatch(title, 'pos', 1);
  assert.deepEqual(title.keys.pos.map((k) => [k.t, k.v]), [[1, [540, 470]]]);
  ops.addKeyAt(title, 'pos', 3);
  title.keys.pos[1].v = [700, 470];
  assert.deepEqual(valueAt(title, 'pos', 2), [620, 470]);
  ops.toggleStopwatch(title, 'pos', 2);
  assert.equal(title.keys.pos, undefined);
  assert.deepEqual(title.pos, [620, 470]);
});

test('keys: navigate, move (copy), delete last key bakes value, ease preset applies to chosen keys', () => {
  const d = doc();
  const ui = d.layers.find((l) => l.id === 'ui');
  assert.equal(ops.neighbourKey(ui, 'opacity', 0, 1), 0.3);
  assert.equal(ops.neighbourKey(ui, 'opacity', 0.5, -1), 0.3);
  assert.equal(ops.neighbourKey(ui, 'opacity', 0.9, 1), null);
  ops.moveKey(ui, 'opacity', 0.9, 2, true);
  assert.deepEqual(ui.keys.opacity.map((k) => k.t), [0.3, 0.9, 2]);
  ops.setKeyEase(ui, 'opacity', [0.3, 2], { lin: false, o: 33, i: 33 });
  assert.deepEqual(ui.keys.opacity.map((k) => k.lin), [false, true, false]);
  ops.deleteKey(ui, 'opacity', 0.3);
  ops.deleteKey(ui, 'opacity', 0.9);
  ops.deleteKey(ui, 'opacity', 2);
  assert.equal(ui.keys.opacity, undefined);
  assert.equal(ui.opacity, 100);
});

test('effects: add on top, reorder, remove', () => {
  const d = doc();
  const title = d.layers.find((l) => l.id === 'title');
  const glow = ops.addEffect(title, 'Glow');
  const blur = ops.addEffect(title, 'Gaussian blur');
  assert.deepEqual(title.effects.map((f) => f.name), ['Gaussian blur', 'Glow']);
  ops.moveEffect(title, blur, null);
  assert.deepEqual(title.effects.map((f) => f.name), ['Glow', 'Gaussian blur']);
  ops.removeEffect(title, glow);
  assert.equal(title.effects.length, 1);
  assert.throws(() => ops.addEffect(title, 'Nope'));
});
