import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, snapToFrame, clamp } from '../lib/editor/time.ts';
import { nearestSnap, snapEdges, radiusInUnits } from '../lib/editor/snap.ts';
import { bezier, valueAt, writeProperty, speedCurve } from '../lib/editor/anim.ts';
import { layerBox, pointInBox, handlePoint, scaleFromHandle, angleToPoint, safeRect, clipRect } from '../lib/editor/geometry.ts';
import { History } from '../lib/editor/history.ts';
import { checkLayers, lintClips } from '../lib/editor/checks.ts';
import { ActionRegistry, matchesShortcut, formatShortcut } from '../lib/editor/actions.ts';

const layer = (over = {}) => ({ id: 'l', name: 'L', type: 'text', vis: true, lock: false, solo: false, inP: 0, outP: 12, parent: null, pos: [960, 540], scale: [100, 100], rot: 0, ry: 0, opacity: 100, w: 400, h: 200, effects: [], keys: {}, threeD: false, label: 'gray', blend: 'Normal', text: 'Hi', ...over });
const canvas = { width: 1920, height: 1080 };

test('formatTime renders M:SS:FF and clamps negatives', () => {
  assert.equal(formatTime(0), '0:00:00');
  assert.equal(formatTime(1.5), '0:01:15');
  assert.equal(formatTime(61), '1:01:00');
  assert.equal(formatTime(-3), '0:00:00');
  assert.equal(formatTime(2.9999), '0:03:00');
});

test('snapToFrame and clamp', () => {
  assert.equal(snapToFrame(1.01), 1);
  assert.equal(clamp(5, 0, 3), 3);
});

test('nearestSnap picks the closest candidate inside the radius, else null', () => {
  const c = [{ value: 100, label: 'A' }, { value: 104, label: 'B' }];
  assert.equal(nearestSnap(103, c, 5).label, 'B');
  assert.equal(nearestSnap(150, c, 5), null);
  assert.equal(radiusInUnits(50, 10), 0.2);
});

test('snapEdges snaps the moving edge that is closest and returns the delta', () => {
  const r = snapEdges([90, 140, 190], [{ value: 960, label: 'Centre' }, { value: 143, label: 'Edge' }], 5);
  assert.equal(r.delta, 3);
  assert.equal(r.hit.label, 'Edge');
  assert.deepEqual(snapEdges([0], [{ value: 100, label: 'x' }], 5), { delta: 0, hit: null });
});

test('bezier is monotone with fixed ends; linear control points give identity', () => {
  assert.ok(Math.abs(bezier(0.33, 0, 0.67, 1, 0)) < 1e-3);
  assert.ok(Math.abs(bezier(0.33, 0, 0.67, 1, 1) - 1) < 1e-3);
  assert.ok(Math.abs(bezier(1 / 3, 1 / 3, 2 / 3, 2 / 3, 0.4) - 0.4) < 1e-3);
});

test('valueAt interpolates vectors, holds outside the keys, and eases', () => {
  const l = layer({ keys: { pos: [{ t: 0, v: [0, 0], o: 0, i: 0, lin: true }, { t: 2, v: [100, 200], o: 0, i: 0, lin: true }], opacity: [{ t: 0, v: 0, o: 33, i: 33, lin: false }, { t: 1, v: 100, o: 33, i: 33, lin: false }] } });
  assert.deepEqual(valueAt(l, 'pos', 1), [50, 100]);
  assert.deepEqual(valueAt(l, 'pos', -1), [0, 0]);
  assert.deepEqual(valueAt(l, 'pos', 9), [100, 200]);
  assert.equal(valueAt(l, 'rot', 5), 0);
  const mid = valueAt(l, 'opacity', 0.5);
  assert.ok(Math.abs(mid - 50) < 1);
  assert.ok(valueAt(l, 'opacity', 0.1) < 10, 'easy ease starts slow');
});

test('writeProperty sets a static value, edits a key at the playhead, or adds a key', () => {
  const l = layer({ keys: { rot: [{ t: 1, v: 10, o: 33, i: 33, lin: true }] } });
  writeProperty(l, 'opacity', 50, 0);
  assert.equal(l.opacity, 50);
  writeProperty(l, 'rot', 20, 1.004);
  assert.equal(l.keys.rot.length, 1);
  assert.equal(l.keys.rot[0].v, 20);
  writeProperty(l, 'rot', 30, 2);
  assert.deepEqual(l.keys.rot.map((k) => k.t), [1, 2]);
});

test('speedCurve peaks higher for an ease than for a linear segment', () => {
  const a = { t: 0, v: 0, o: 80, i: 0, lin: false };
  const b = { t: 1, v: 1, o: 0, i: 80, lin: false };
  const eased = speedCurve(a, b);
  const linear = speedCurve({ ...a, lin: true }, { ...b, lin: true });
  assert.ok(eased.peak > linear.peak);
  assert.ok(Math.abs(linear.peak - 1) < 0.05);
});

test('layerBox applies scale; pointInBox and handles respect rotation', () => {
  const b = layerBox(layer({ scale: [50, 100] }), 0);
  assert.equal(b.w, 200);
  const rotated = { cx: 100, cy: 100, w: 200, h: 20, rot: 90 };
  assert.ok(pointInBox(rotated, 100, 190));
  assert.ok(!pointInBox(rotated, 190, 100));
  const se = handlePoint({ cx: 0, cy: 0, w: 100, h: 50, rot: 0 }, 'se');
  assert.deepEqual([se.x, se.y], [50, 25]);
});

test('scaleFromHandle keeps proportions when linked and frees an axis for edge handles', () => {
  const box = { cx: 500, cy: 500, w: 400, h: 200, rot: 0 };
  const linked = scaleFromHandle(box, [100, 100], 'se', 900, 700, true);
  assert.equal(linked[0], linked[1]);
  assert.equal(linked[0], 200);
  const free = scaleFromHandle(box, [100, 100], 'e', 900, 500, false);
  assert.deepEqual(free, [200, 100]);
});

test('angleToPoint uses 0 = up and snaps to 15 degrees with shift', () => {
  const box = { cx: 0, cy: 0, w: 1, h: 1, rot: 0 };
  assert.equal(angleToPoint(box, 0, -10), 0);
  assert.equal(angleToPoint(box, 10, 0), 90);
  assert.equal(angleToPoint(box, 10, -9, true) % 15, 0);
});

test('safeRect and clipRect read the canvas and inline css', () => {
  assert.deepEqual(safeRect(canvas, 0.05), { x: 96, y: 54, w: 1728, h: 972 });
  const r = clipRect({ id: 'c', name: 'c', track: 0, start: 0, dur: 1, kind: 'box', text: '', css: [['left', '100px'], ['top', '50px'], ['width', '80px']], tweens: [] }, canvas);
  assert.deepEqual(r, { x: 100, y: 50, w: 80, h: 80 });
});

test('History: one step per commit, undo/redo, redo tail becomes a branch that can be switched to', () => {
  const h = new History({ n: 0 }, 80);
  h.commit('a', { n: 1 });
  h.commit('b', { n: 2 });
  assert.equal(h.undoLabel, 'b');
  assert.deepEqual(h.undo().state, { n: 1 });
  assert.equal(h.redoLabel, 'b');
  h.commit('c', { n: 3 });
  assert.equal(h.branches.length, 1);
  assert.equal(h.branches[0].label, 'b');
  assert.deepEqual(h.present, { n: 3 });
  assert.deepEqual(h.switchBranch(h.branches[0].id), { n: 2 });
  assert.equal(h.branches.length, 1, 'the tail we left is kept as a branch');
  assert.equal(h.branches[0].label, 'c');
  assert.equal(h.redo(), null);
});

test('History: capped at the limit and drops orphaned branches', () => {
  const h = new History(0, 3);
  for (let i = 1; i <= 6; i++) h.commit(`s${i}`, i);
  assert.equal(h.entries.length, 4);
  assert.equal(h.present, 6);
  h.undo(); h.undo(); h.undo();
  assert.equal(h.present, 3);
  assert.equal(h.undo(), null);
});

test('checkLayers flags overrun, empty text, action-safe overflow and soft images; errors sort first', () => {
  const issues = checkLayers([
    layer({ id: 'a', outP: 15 }),
    layer({ id: 'b', text: '  ' }),
    layer({ id: 'c', pos: [10, 540], w: 400 }),
    layer({ id: 'd', type: 'image', scale: [200, 200], w: 100, h: 100 })
  ], 12, canvas, 1);
  assert.ok(issues.some((i) => i.id === 'a' && i.lvl === 'error'));
  assert.ok(issues.some((i) => i.id === 'b' && i.lvl === 'error'));
  assert.ok(issues.some((i) => i.id === 'c' && i.lvl === 'warning'));
  assert.ok(issues.some((i) => i.id === 'd' && /soft/.test(i.msg)));
  const firstWarning = issues.findIndex((i) => i.lvl === 'warning');
  assert.ok(issues.slice(firstWarning).every((i) => i.lvl === 'warning'));
});

test('lintClips flags overrun, same-track overlap and text without tweens', () => {
  const clip = (o) => ({ id: 'x', name: 'x', track: 0, start: 0, dur: 1, kind: 'text', text: 'T', css: [], tweens: [], ...o });
  const issues = lintClips([clip({ id: 'a', name: 'a', start: 0, dur: 3 }), clip({ id: 'b', name: 'b', start: 2, dur: 3 }), clip({ id: 'c', name: 'c', track: 1, start: 10, dur: 5 })], 11.97, canvas);
  assert.equal(issues.filter((i) => i.lvl === 'error').length, 2);
  assert.ok(issues.some((i) => i.lvl === 'warning' && /no tweens/.test(i.msg)));
});

test('shortcuts: modifiers match exactly, Mod maps to cmd on mac and ctrl elsewhere', () => {
  const ev = (o) => ({ key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  assert.ok(matchesShortcut(ev({ metaKey: true }), 'Mod+Z', true));
  assert.ok(!matchesShortcut(ev({ ctrlKey: true }), 'Mod+Z', true));
  assert.ok(matchesShortcut(ev({ ctrlKey: true }), 'Mod+Z', false));
  assert.ok(!matchesShortcut(ev({ metaKey: true, shiftKey: true }), 'Mod+Z', true));
  assert.ok(matchesShortcut(ev({ key: ' ' }), 'Space', true));
  assert.ok(matchesShortcut(ev({ key: 'ArrowLeft', altKey: true }), 'Alt+Left', true));
  assert.ok(matchesShortcut(ev({ key: '≈', code: 'KeyX', altKey: true }), 'Alt+X', true));
  assert.equal(formatShortcut('Mod+Shift+D', true), '⌘⇧D');
  assert.equal(formatShortcut('Mod+Shift+D', false), 'Ctrl+Shift+D');
});

test('ActionRegistry: run respects enabled, search is AND over words, conflicts are reported', () => {
  let ran = 0;
  let on = true;
  const reg = new ActionRegistry().register(
    { id: 'split', group: 'Timeline', label: 'Split at playhead', shortcut: 'Mod+Shift+D', run: () => { ran++; } },
    { id: 'dup', group: 'Layer', label: 'Duplicate', shortcut: 'Mod+D', enabled: () => on, run: () => { ran += 10; } }
  );
  assert.throws(() => reg.register({ id: 'dup', group: 'x', label: 'x', run() {} }));
  assert.equal(reg.run('dup'), true);
  on = false;
  assert.equal(reg.run('dup'), false);
  assert.equal(ran, 10);
  assert.deepEqual(reg.search('split play').map((a) => a.id), ['split']);
  assert.deepEqual(reg.search('layer dup').map((a) => a.id), []);
  assert.equal(reg.match({ key: 'd', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, true).id, 'split');
  reg.register({ id: 'clash', group: 'x', label: 'x', shortcut: 'Mod+Shift+D', run() {} });
  assert.deepEqual(reg.conflicts(), [['split', 'clash']]);
});
