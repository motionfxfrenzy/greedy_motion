import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDoc } from '../lib/editor/fixtures.ts';
import * as ops from '../lib/editor/ops.ts';
import { pick, withRect, pickKey, mergeKeys, hasKey, intersects, boxOf } from '../lib/editor/selection.ts';

const order = ['a', 'b', 'c', 'd', 'e'];

test('click replaces, ⌘-click toggles, Shift-click takes the range from the anchor', () => {
  let s = pick([], null, 'b', order, {});
  assert.deepEqual(s, { ids: ['b'], anchor: 'b' });
  s = pick(s.ids, s.anchor, 'd', order, { toggle: true });
  assert.deepEqual(s.ids, ['b', 'd']);
  s = pick(s.ids, s.anchor, 'b', order, { toggle: true });
  assert.deepEqual(s.ids, ['d']);
  s = pick(['b'], 'b', 'e', order, { range: true });
  assert.deepEqual(s.ids, ['b', 'c', 'd', 'e']);
  assert.equal(s.anchor, 'b');
  s = pick(['d'], 'd', 'b', order, { range: true });
  assert.deepEqual(s.ids, ['d', 'c', 'b'], 'the anchor stays the primary');
  s = pick(['a'], 'a', 'c', order, { range: true, toggle: true });
  assert.deepEqual(s.ids, ['a', 'b', 'c']);
  s = pick([], null, 'c', order, { range: true });
  assert.deepEqual(s.ids, ['c'], 'a range with no anchor selects the item');
});

test('a rectangle replaces the selection, or extends it when additive', () => {
  assert.deepEqual(withRect(['a'], ['c', 'd'], false), ['c', 'd']);
  assert.deepEqual(withRect(['a', 'c'], ['c', 'd'], true), ['a', 'c', 'd']);
  assert.ok(intersects(boxOf(0, 0, 10, 10), boxOf(10, 10, 20, 20)));
  assert.ok(!intersects(boxOf(0, 0, 9, 9), boxOf(10, 10, 20, 20)));
});

test('key picks: plain replaces, ⌘ toggles, Shift adds', () => {
  const a = { id: 'l', prop: 'pos', t: 1 };
  const b = { id: 'l', prop: 'pos', t: 2 };
  assert.deepEqual(pickKey([a], b, {}), [b]);
  assert.deepEqual(pickKey([a], b, { toggle: true }), [a, b]);
  assert.deepEqual(pickKey([a, b], b, { toggle: true }), [a]);
  assert.deepEqual(pickKey([a, b], b, { range: true }), [a, b]);
  assert.equal(mergeKeys([a], [{ ...a, t: 1.0000001 }, b], true).length, 2);
  assert.ok(hasKey([a], { ...a, t: 1.0000001 }));
});

const withKeys = () => {
  const d = demoDoc();
  const l = d.layers.find((v) => v.id === 'title');
  l.keys.opacity = [0, 1, 2, 3].map((t) => ({ t, v: t / 3, o: 33, i: 33, lin: true }));
  l.keys.scale = [{ t: 1, v: [100, 100], o: 33, i: 33, lin: true }, { t: 2, v: [120, 120], o: 33, i: 33, lin: true }];
  return { d, l };
};

test('moveKeys moves a group by one delta, keeping spacing and stopping at the ends', () => {
  const { d, l } = withKeys();
  const refs = [{ id: 'title', prop: 'opacity', t: 1 }, { id: 'title', prop: 'opacity', t: 2 }, { id: 'title', prop: 'scale', t: 1 }];
  const out = ops.moveKeys(d, refs, 0.5, 12);
  assert.deepEqual(l.keys.opacity.map((k) => k.t), [0, 1.5, 2.5, 3]);
  assert.deepEqual(l.keys.scale.map((k) => k.t), [1.5, 2]);
  assert.deepEqual(out.map((r) => r.t), [1.5, 2.5, 1.5]);
  const early = withKeys();
  ops.moveKeys(early.d, [{ id: 'title', prop: 'opacity', t: 1 }, { id: 'title', prop: 'opacity', t: 2 }], -5, 12);
  // The group stops as a unit: the key at 1 reaches 0 (replacing the unselected key there), the key at 2 keeps its gap and lands on 1.
  assert.deepEqual(early.l.keys.opacity.map((k) => k.t), [0, 1, 3]);
});

test('moveKeys replaces unselected keys it lands on, and copy leaves the originals', () => {
  const { d, l } = withKeys();
  ops.moveKeys(d, [{ id: 'title', prop: 'opacity', t: 1 }], 1, 12);
  assert.deepEqual(l.keys.opacity.map((k) => k.t), [0, 2, 3]);
  const c = withKeys();
  ops.moveKeys(c.d, [{ id: 'title', prop: 'opacity', t: 1 }, { id: 'title', prop: 'opacity', t: 2 }], 5, 12, true);
  assert.deepEqual(c.l.keys.opacity.map((k) => k.t), [0, 1, 2, 3, 6, 7]);
});

test('deleteKeys removes several keys across properties; the last key of a property is baked', () => {
  const { d, l } = withKeys();
  const n = ops.deleteKeys(d, [{ id: 'title', prop: 'opacity', t: 0 }, { id: 'title', prop: 'opacity', t: 1 }, { id: 'title', prop: 'scale', t: 1 }, { id: 'title', prop: 'scale', t: 2 }]);
  assert.equal(n, 4);
  assert.deepEqual(l.keys.opacity.map((k) => k.t), [2, 3]);
  assert.ok(!l.keys.scale, 'a property with no keys left is no longer animated');
});

test('allKeys lists every key of the given layers; setKeysEase eases them all', () => {
  const { d, l } = withKeys();
  const refs = ops.allKeys(d, ['title']);
  assert.ok(refs.length >= 6);
  ops.setKeysEase(d, refs, { lin: false, o: 40, i: 20 });
  assert.ok(Object.values(l.keys).flat().every((k) => !k.lin && k.o === 40 && k.i === 20));
});

test('moveLayerBars moves a group together, stops as a unit and skips locked layers', () => {
  const d = demoDoc();
  const [a, b] = d.layers;
  b.lock = true;
  const bIn = b.inP;
  ops.moveLayerBars(d, [a.id, b.id], 0.5, 12);
  assert.equal(b.inP, bIn, 'locked layer stays');
  b.lock = false;
  const before = [a.inP, b.inP];
  ops.moveLayerBars(d, [a.id, b.id], -100, 12);
  assert.equal(Math.min(a.inP, b.inP), 0, 'the earlier bar stopped at 0');
  assert.ok(Math.abs((b.inP - a.inP) - (before[1] - before[0])) < 0.04, 'spacing kept');
});
