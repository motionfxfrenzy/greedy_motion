import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "../runtime/plates.js";
import { PLATES, PLATE_CHOICES } from "../vocab.mjs";
import { normalize, nearestPlace } from "../lint.mjs";
import { directorBrief } from "../brief.mjs";
import { platesDir } from "../serve.mjs";
const { plateFrame, fitRect, metaOf } = globalThis.PaintedPlates;
const koi = { frames: 540, fps: 30 }, near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const lineWith = (shot, say = "A fish.") => ({ lines: [{ say, shots: [shot] }] });
const fix = (shot, say) => { const r = normalize(lineWith(shot, say)); return { shot: r.spec.lines[0].shots[0], notes: r.notes }; };

test("shot progress spreads from..to over the shot and holds the last frame", () => {
  assert.equal(plateFrame(0, koi), 0); assert.equal(plateFrame(1, koi), 539); assert.equal(plateFrame(0.5, koi), 270);
  assert.equal(plateFrame(0.25, koi, { from: 100, to: 200 }), 125);
  assert.equal(plateFrame(1.7, koi, { from: 100, to: 200 }), 200, "past the end holds");
  assert.equal(plateFrame(-1, koi, { from: 100, to: 200 }), 100);
  assert.equal(plateFrame(NaN, koi), 0);
});
test("frames outside the film are clamped; a one-frame film is always frame 0", () => {
  assert.equal(plateFrame(1, koi, { from: -5, to: 9999 }), 539);
  assert.equal(plateFrame(0.6, { frames: 1, fps: 30 }), 0);
});
test("no loop unless asked; a loop runs at the film's own speed over the range", () => {
  assert.equal(plateFrame(1, { frames: 120, fps: 30 }, { seconds: 8 }), 119);
  const loop = { loop: true, seconds: 8 }, m = { frames: 120, fps: 30 };                        // 4 s film in an 8 s shot: plays twice
  assert.equal(plateFrame(0, m, loop), 0); assert.equal(plateFrame(0.25, m, loop), 60); assert.equal(plateFrame(0.5, m, loop), 0); assert.equal(plateFrame(0.99, m, loop), 117);
});
test("cover fills the tall picture and crops around the focus point", () => {
  const r = fitRect(1080, 1080, 540, 960, "cover", [0.5, 0.5]);
  near(r.sw / r.sh, 540 / 960); near(r.sh, 1080); near(r.sx, (1080 - r.sw) / 2); assert.deepEqual([r.dx, r.dy, r.dw, r.dh], [0, 0, 540, 960]);
  assert.equal(fitRect(1080, 1080, 540, 960, "cover", [0, 0.5]).sx, 0, "focus at the left edge never crops outside the plate");
  near(fitRect(1080, 1080, 540, 960, "cover", [1, 0.5]).sx + fitRect(1080, 1080, 540, 960, "cover", [1, 0.5]).sw, 1080);
  const wide = fitRect(1920, 1080, 540, 960, "cover", [0.2, 0.5]); near(wide.sh, 1080); assert.ok(wide.sx >= 0 && wide.sx + wide.sw <= 1920);
  const tall = fitRect(1080, 1920, 1080, 1080, "cover", [0.5, 0.9]); assert.ok(tall.sy + tall.sh <= 1920 + 1e-9); near(tall.sy + tall.sh, 1920);
});
test("contain shows the whole plate, centred, with bars", () => {
  const r = fitRect(1080, 1080, 540, 960, "contain");
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [0, 0, 1080, 1080]); near(r.dw, 540); near(r.dh, 540); near(r.dy, 210); near(r.dx, 0);
  const w = fitRect(1920, 1080, 540, 960, "contain"); near(w.dw, 540); near(w.dh, 303.75);
});
test("bad focus falls back to the centre", () => { const a = fitRect(1080, 1080, 540, 960, "cover", ["x", null]), b = fitRect(1080, 1080, 540, 960, "cover"); near(a.sx, b.sx); });

test("a known plate gets defaults: cover, centred, whole film, the plate's own look", () => {
  const { shot, notes } = fix({ place: "plate", plate: "koiDraw" });
  assert.equal(shot.place, "plate"); assert.equal(shot.fit, "cover"); assert.deepEqual(shot.focus, [0.5, 0.5]); assert.equal(shot.from, 0); assert.equal(shot.to, 539); assert.equal(shot.plateLook, "plate"); assert.deepEqual(notes, []);
});
test("an unknown plate becomes the nearest painted place and never crashes", () => {
  const { shot, notes } = fix({ place: "plate", plate: "dragonDance", fit: "contain", from: 3 }, "A fish swam in the sea.");
  assert.equal(shot.place, "sea"); assert.equal(shot.plate, undefined); assert.equal(shot.fit, undefined); assert.ok(notes.some((n) => /unknown plate "dragonDance"/.test(n)));
  assert.equal(fix({ place: "plate" }, "Hello.").shot.place, "meadow", "a plate shot with no plate at all is a meadow");
  assert.equal(nearestPlace("lighthouseKeeper"), "meadow"); assert.equal(nearestPlace(undefined, "a koi pond"), "sea");
});
test("bad fit, focus, range and look are repaired", () => {
  const { shot, notes } = fix({ place: "plate", plate: "koiDraw", fit: "stretch", focus: [2, -1], from: 900, to: 10, plateLook: "neon" });
  assert.equal(shot.fit, "cover"); assert.deepEqual(shot.focus, [1, 0]); assert.deepEqual([shot.from, shot.to], [10, 539]); assert.equal(shot.plateLook, "plate"); assert.ok(notes.length >= 4);
  assert.deepEqual(fix({ place: "plate", plate: "koiDraw", focus: "centre" }).shot.focus, [0.5, 0.5]);
  assert.equal(fix({ place: "plate", plate: "koiDraw", plateLook: "oil" }).shot.plateLook, "oil");
});
test("a plate shot passes the rest of the rule layer without being turned into something else", () => {
  const r = normalize({ lines: [{ say: "They went inside the house by the fire.", shots: [{ place: "plate", plate: "koiDraw" }] }] });
  assert.equal(r.spec.lines[0].shots[0].place, "plate");
});
test("every plate has a manifest entry the player can use; every director choice exists", () => {
  assert.ok(Object.keys(PLATES).length > 0);
  for (const [k, p] of Object.entries(PLATES)) for (const f of ["title", "W", "H", "fps", "frames", "hash"]) assert.ok(p[f] !== undefined && p[f] !== "", `plate ${k} lacks ${f}`);
  for (const k of Object.keys(PLATE_CHOICES)) assert.ok(PLATES[k], `${k} is offered but not in the manifest`);
  assert.ok("koiDraw" in PLATE_CHOICES);
});
test("the director's brief lists every plate it may use", () => { const b = directorBrief(); for (const k of Object.keys(PLATE_CHOICES)) assert.ok(b.includes(`- ${k}:`), `${k} is not in the brief`); });
test("every listed plate has a page in the films folder (skipped when the folder is not on this machine)", (t) => {
  const dist = platesDir(); if (!fs.existsSync(dist)) return t.skip("no ANIDOODLE_DIST here");
  for (const k of Object.keys(PLATES)) assert.ok(fs.existsSync(`${dist}/${k}.html`), `${k}.html is missing in ${dist}`);
});
test("a film's own meta (durationFrames) is read as frames: the screenshot regression where every plate stayed on frame 0", () => {
  const m = metaOf({ title: "Koi", W: 1080, H: 1080, fps: 30, durationFrames: 540 });
  assert.equal(m.frames, 540); assert.equal(plateFrame(0.5, m), 270); assert.equal(plateFrame(1, m), 539);
  assert.equal(metaOf({}).frames, 1); assert.equal(metaOf({ durationFrames: 120 }).fps, 30);
  for (const [k, p] of Object.entries(PLATES)) assert.equal(metaOf({ ...p, durationFrames: p.frames }).frames, p.frames, k);
});
