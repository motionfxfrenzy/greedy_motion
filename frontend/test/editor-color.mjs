import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, unitIn } from '../lib/editor/color.ts';

test('hex parsing accepts short and long forms, with or without #', () => {
  assert.equal(normaliseHex('f50'), '#FF5500');
  assert.equal(normaliseHex('#497ad0'), '#497AD0');
  assert.equal(normaliseHex('#49'), null);
  assert.equal(normaliseHex('zzzzzz'), null);
  assert.deepEqual(hexToRgb('#497AD0'), [73, 122, 208]);
  assert.equal(rgbToHex([73, 122, 208]), '#497AD0');
  assert.equal(rgbToHex([300, -5, 12.4]), '#FF000C', 'out-of-range channels are clamped');
});

test('rgb <-> hsv round-trips and handles greys and primaries', () => {
  for (const hex of ['#497AD0', '#FF5500', '#0A6CFF', '#16803C', '#FFFFFF', '#000000', '#808080']) {
    assert.equal(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex)))), hex);
  }
  assert.deepEqual(rgbToHsv([255, 0, 0]), { h: 0, s: 1, v: 1 });
  assert.equal(Math.round(rgbToHsv([0, 0, 255]).h), 240);
  assert.equal(rgbToHsv([128, 128, 128]).s, 0);
});

test('unitIn pins a drag that leaves the box to its edges', () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(unitIn(box, 200, 100), { x: 0.5, y: 0.5 });
  assert.deepEqual(unitIn(box, -40, 999), { x: 0, y: 1 });
  assert.deepEqual(unitIn(box, 999, -40), { x: 1, y: 0 });
});
