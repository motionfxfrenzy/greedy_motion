import { test } from "node:test";
import assert from "node:assert/strict";
const { dominantColors, hueDistance, hueOf } = await import("../src/brand/logo-colors.ts");

const px = (r, g, b, a = 255, n = 1) => Array.from({ length: n }, () => [r, g, b, a]).flat();

test("a blue logo with a small orange mark yields both colours, blue first", () => {
  const rgba = Uint8Array.from([...px(22, 139, 255, 255, 400), ...px(255, 106, 42, 255, 60), ...px(255, 255, 255, 255, 800), ...px(0, 0, 0, 0, 500), ...px(20, 20, 24, 255, 300)]);
  const colors = dominantColors(rgba);
  assert.equal(colors.length, 2);
  assert.ok(hueDistance(colors[0], "#168bff") < 8, colors[0]);
  assert.ok(hueDistance(colors[1], "#ff6a2a") < 8, colors[1]);
});

test("whites, blacks, greys and transparent pixels are never brand colours", () => {
  const rgba = Uint8Array.from([...px(255, 255, 255, 255, 300), ...px(10, 10, 10, 255, 300), ...px(128, 128, 128, 255, 300), ...px(255, 0, 0, 0, 300)]);
  assert.deepEqual(dominantColors(rgba), []);
});

test("shades of one hue merge into a single colour", () => {
  const rgba = Uint8Array.from([...px(22, 139, 255, 255, 200), ...px(40, 150, 250, 255, 200), ...px(10, 100, 230, 255, 200)]);
  assert.equal(dominantColors(rgba).length, 1);
});

test("hue helpers", () => {
  assert.equal(Math.round(hueOf("#ff0000")), 0);
  assert.equal(Math.round(hueOf("#00ff00")), 120);
  assert.equal(hueDistance("#ff0000", "#ff0010") < 5, true);
  assert.equal(Math.round(hueDistance("#ff0000", "#00ffff")), 180);
});
