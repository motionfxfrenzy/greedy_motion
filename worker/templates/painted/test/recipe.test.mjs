import test from "node:test";
import assert from "node:assert/strict";
import { validateRecipe } from "../recipe.mjs";

test("a good recipe passes and is cleaned", () => {
  const r = validateRecipe({ floor_y: 0.9, indoors: true, layers: [{ op: "fill", stops: ["#112233", "#445566"] }, { op: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.4, color: "#ff0000" }, { op: "window", x: 0.2, y: 0.3 }] });
  assert.equal(r.layers.length, 3); assert.equal(r.indoors, true); assert.equal(r.floor_y, 0.9);
});
test("nothing outside the whitelist survives", () => {
  const r = validateRecipe({ layers: [{ op: "rect", x: 0, y: 0, w: 1, h: 1, color: "#000000" }, { op: "eval", code: "alert(1)" }, { op: "rect", x: 99999, y: 0, w: 1, h: 1, color: "red; drop table" }, { op: "glow", x: 0.5, y: 0.5, r: 0.2, color: "#ffffff" }] });
  assert.deepEqual(r.layers.map((l) => l.op), ["rect", "rect", "glow"]);
  assert.equal(r.layers[1].x, 3);                       // clamped
  assert.equal("color" in r.layers[1], false);         // a colour that is not #rrggbb is dropped
});
test("a recipe with no usable layers is refused", () => {
  assert.throws(() => validateRecipe({ layers: [{ op: "eval" }] })); assert.throws(() => validateRecipe({}));
});

const localRecipe = () => ({ space: "object", layers: Array.from({ length: 6 }, (_, i) => ({ op: "rect", x: .1 + i * .1, y: .2, w: .1, h: .8, color: ["#997755", "#ddbb88", "#443322"][i % 3] })) });
test("local objects preserve their support contract", () => {
  const surface = { x: .5, y: .2, w: .6 };
  const r = validateRecipe(localRecipe(), { kind: "prop", surface });
  assert.equal(r.space, "object"); assert.deepEqual(r.surface, surface);
});
test("flat, frame-wide and out-of-bounds object recipes are rejected", () => {
  const r = localRecipe();
  assert.throws(() => validateRecipe({ layers: r.layers }, { kind: "prop" }), /local space/);
  assert.throws(() => validateRecipe({ ...r, layers: r.layers.slice(0, 2) }), /six layers/);
  assert.throws(() => validateRecipe({ ...r, layers: r.layers.map(l => ({ ...l, color: "#111111" })) }), /three material tones/);
  assert.throws(() => validateRecipe({ ...r, layers: [...r.layers, { op: "fill", stops: ["#112233"] }] }), /frame-wide/);
  assert.throws(() => validateRecipe({ ...r, layers: [...r.layers, { op: "poly", points: [[0, 0], [1, 0]], color: "#112233" }] }), /local points/);   // a polygon with two points is not a polygon
});

test("near-misses are repaired, not sent back to the artist", () => {
  const r = localRecipe();
  const fixed = validateRecipe({ ...r, layers: [...r.layers, { op: "poly", points: [[-.1, 0], [1.2, 0], [0, 1]], color: "#112233" }, { op: "ellipse", x: 0.9, y: 0.5, rx: 0.4, ry: 0.2, color: "#445566" }] }, { kind: "prop" });
  const el = fixed.layers.at(-1), pg = fixed.layers.at(-2);
  assert.ok(el.x + el.rx <= 1.000001 && el.x - el.rx >= -0.000001);                       // the ellipse was shrunk into its box
  assert.ok(pg.points.every((p) => p.every((v) => v >= 0 && v <= 1)));                      // the polygon was pulled into 0..1
  assert.equal(validateRecipe(r, { surface: { x: .9, y: .1, w: .8 } }).surface, undefined); // a surface that does not fit is dropped
});

test("a drawing that fills little of its box is stretched to fill it", async () => {
  const { fitToBox } = await import("../recipe.mjs");
  const layers = [{ op: "ellipse", x: 0.5, y: 0.5, rx: 0.15, ry: 0.15, color: "#aa0000" }, { op: "rect", x: 0.4, y: 0.4, w: 0.2, h: 0.3, color: "#00aa00" }];
  const { layers: out } = fitToBox(layers);
  const xs = out.flatMap((l) => l.op === "rect" ? [l.x, l.x + l.w] : [l.x - l.rx, l.x + l.rx]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 0.7);
  assert.deepEqual(fitToBox([{ op: "rect", x: 0, y: 0, w: 1, h: 1, color: "#111111" }]).layers[0].w, 1);   // a drawing that fills its box is left alone
});

test("resolveCustom skips the oracle for native doodle story props (trees, fruits, fences, chairs, books, baskets, campfires, etc.)", async () => {
  const { resolveCustom } = await import("../recipe.mjs");
  const spec = {
    style: "doodle",
    lines: [{ say: "They sat by the fire.", shots: [{ place: "meadow", props: [
      { kind: "custom", id: "f", describe: "a wooden fence" },
      { kind: "custom", id: "c", describe: "a worn armchair" },
      { kind: "custom", id: "b", describe: "an open leather book" },
      { kind: "custom", id: "k", describe: "a woven wicker basket" },
      { kind: "custom", id: "fire", describe: "a glowing campfire" },
    ] }] }]
  };
  await resolveCustom(spec, { cacheDir: "/tmp/no-oracle-needed", apiKey: "none", log: () => {} });
  assert.equal(spec.lines[0].shots[0].props.length, 5);
});
