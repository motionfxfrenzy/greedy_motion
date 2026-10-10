import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpeedModel, influenceAt, GRAPH } from '../lib/editor/speed.ts';

const key = (t, v, o = 33, i = 33, lin = false) => ({ t, v, o, i, lin });

test('needs two keys and a valid segment', () => {
  assert.equal(buildSpeedModel([key(0, 0)], 0), null);
  assert.equal(buildSpeedModel([key(0, 0), key(1, 10)], 1), null);
  assert.ok(buildSpeedModel([key(0, 0), key(1, 10)], 0));
});

test('the curve spans the graph, peaks at the top, and an eased segment peaks higher than its average', () => {
  const m = buildSpeedModel([key(0, 0, 80, 10), key(2, 100, 0, 0)], 0);
  assert.ok(m.path.startsWith(`M${GRAPH.pad}.0`));
  assert.ok(m.peak > 50, 'peak speed exceeds the average of 50 per second for an eased move');
  assert.ok(m.area.endsWith('Z') && m.areaAll.endsWith('Z'));
  assert.equal(m.bounds.length, 0, 'two keys have no interior boundaries');
});

test('three keys: one interior boundary, and the selected segment is the one highlighted', () => {
  const keys = [key(0, 0), key(1, 100), key(3, 150)];
  const first = buildSpeedModel(keys, 0);
  const second = buildSpeedModel(keys, 1);
  assert.equal(first.bounds.length, 1);
  assert.equal(first.path, second.path, 'the whole curve is the same either way');
  assert.notEqual(first.area, second.area);
  assert.ok(first.x1 <= second.x0 + 1e-6 && second.x0 > first.x0);
});

test('handles sit on the baseline inside their segment and follow the influences', () => {
  const m = buildSpeedModel([key(0, 0, 50, 33), key(4, 80, 33, 20)], 0);
  assert.ok(m.outX > m.x0 && m.outX < m.x1);
  assert.ok(m.inX > m.x0 && m.inX < m.x1);
  assert.ok(Math.abs((m.outX - m.x0) / (m.x1 - m.x0) - 0.5) < 1e-9);
  assert.ok(Math.abs((m.x1 - m.inX) / (m.x1 - m.x0) - 0.2) < 1e-9);
  assert.ok(m.g1.endsWith(` ${GRAPH.base}`) && m.g2.endsWith(` ${GRAPH.base}`));
});

test('a property that does not change draws a flat line and reports no peak', () => {
  const m = buildSpeedModel([key(0, 5), key(1, 5)], 0);
  assert.equal(m.peak, 0);
  assert.ok(!/NaN/.test(m.path + m.area + m.g1 + m.g2));
});

test('vector values use their length, so a move of (3,4) is speed 5 per second at progress-speed 1', () => {
  const lin = (t, v) => key(t, v, 0, 0, true);
  const m = buildSpeedModel([lin(0, [0, 0]), lin(1, [3, 4])], 0);
  assert.ok(Math.abs(m.peak - 5) < 0.25);
});

test('influenceAt maps a pointer to a percentage, clamped to 0.1–100', () => {
  assert.equal(influenceAt(150, 100, 200, 'out'), 50);
  assert.equal(influenceAt(150, 100, 200, 'in'), 50);
  assert.equal(influenceAt(175, 100, 200, 'in'), 25);
  assert.equal(influenceAt(50, 100, 200, 'out'), 0.1);
  assert.equal(influenceAt(500, 100, 200, 'out'), 100);
});
