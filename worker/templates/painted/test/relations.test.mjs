import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../lint.mjs";
import { applyRelations } from "../relations.mjs";
import { ROOMS } from "../vocab.mjs";
import fs from "node:fs";

const keeper = { who: "old_man_3", hair: "beard", hairColor: "#9ca3a8", skin: "#d9a077", top: "#c46b33", bottom: "#4a4843", build: "stocky", age: "old" };
const sailor = { who: "young_man_1", hair: "short", hairColor: "#1a1a1a", skin: "#6b442a", top: "#4a7c49", bottom: "#c29b62", build: "average", age: "young" };
const woman = { who: "young_woman_2", hair: "long", hairColor: "#5a3a22", skin: "#e8bd96", top: "#8a3b32", bottom: "#2f3a55", build: "slim", age: "young" };
const film = (...shots) => ({ lines: shots.map(([say, ...ss]) => ({ say, shots: ss })) });
const sea = (subjects, extra = {}) => ({ place: "sea", time: "night", weather: "storm", subjects, props: [{ id: "fishing_boat", kind: "boat", x: 0.5 }], ...extra });
const run = (spec) => { const notes = []; const s = structuredClone(spec); applyRelations(s, (w, m) => notes.push(`${w}: ${m}`)); return { spec: s, notes }; };

test("a boat seen with one person keeps that one person aboard in every later shot of the boat", () => {
  const { spec, notes } = run(film(["A boat was lost.", sea([{ ...sailor, x: 0.5 }])], ["It sailed on.", sea([])], ["Home.", sea([{ ...sailor, x: 0.2 }])]));
  assert.equal(spec.lines[0].shots[0].subjects[0].aboard, "fishing_boat");
  const later = spec.lines[1].shots[0].subjects; assert.equal(later.length, 1); assert.equal(later[0].who, "young_man_1"); assert.equal(later[0].aboard, "fishing_boat");
  assert.equal(spec.lines[2].shots[0].subjects[0].aboard, "fishing_boat", "even drawn far from the boat, the crew member is aboard");
  assert.ok(notes.some((n) => /back aboard/.test(n)));
});
test("strangers near a boat are on the shore, never aboard by accident", () => {
  const { spec } = run(film(["A boat was lost.", sea([{ ...sailor, x: 0.5 }])], ["The village waited.", sea([{ ...sailor, x: 0.5 }, { ...woman, x: 0.55 }, { ...keeper, x: 0.2 }], { place: "shore" })]));
  const subs = spec.lines[1].shots[0].subjects, by = (id) => subs.find((s) => s.who === id);
  assert.equal(subs.length, 3); assert.equal(by("young_man_1").aboard, "fishing_boat"); assert.equal(by("young_woman_2").aboard, false); assert.equal(by("old_man_3").aboard, false);
});
test("the crew is released when the words land them", () => {
  const { spec } = run(film(["A boat was lost.", sea([{ ...sailor, x: 0.5 }])], ["The sailor stepped ashore.", sea([])], ["He walked home.", sea([])]));
  assert.equal(spec.lines[2].shots[0].subjects.length, 0);
});
test("a boat with two people keeps both", () => {
  const { spec } = run(film(["Two fished.", sea([{ ...sailor, x: 0.45 }, { ...woman, x: 0.55 }])], ["They hauled the net.", sea([{ ...sailor, x: 0.45 }])]));
  assert.deepEqual(spec.lines[1].shots[0].subjects.map((s) => s.who).sort(), ["young_man_1", "young_woman_2"]);
});
test("the stairwell and the lamp room are different rooms", () => {
  const r = normalize(film(["He climbed the stairs of the lighthouse.", { place: "interior", room: "lighthouse", time: "night", subjects: [{ who: "old_man_3", pose: "climb", x: 0.5 }] }], ["He lit the lamp.", { place: "interior", room: "lighthouse", time: "night", subjects: [{ who: "old_man_3", pose: "reach", x: 0.45 }], props: [{ kind: "lamp" }] }], ["He kept the light burning through every storm.", { place: "interior", room: "lighthouse", time: "night", subjects: [{ who: "old_man_3", pose: "stand", x: 0.5 }] }]));
  assert.equal(r.spec.lines[0].shots[0].room, "lighthouse"); assert.equal(r.spec.lines[1].shots[0].room, "lantern"); assert.equal(r.spec.lines[2].shots[0].room, "lantern");
});
test("a boat needs water", () => {
  const { spec } = run(film(["The boat rested.", { place: "meadow", time: "day", props: [{ kind: "boat", x: 0.5 }] }]));
  assert.equal(spec.lines[0].shots[0].place, "shore");
});
test("every room, the lamp room included, is drawn by both renderers", () => {
  const kit = fs.readFileSync(new URL("../runtime/kit.js", import.meta.url), "utf8"), doodle = fs.readFileSync(new URL("../runtime/doodle.js", import.meta.url), "utf8");
  assert.ok("lantern" in ROOMS); assert.ok(kit.includes('room === "lantern"')); assert.ok(doodle.includes('kind === "lantern"'));
});
test("no weather is drawn inside a room by the doodle renderer (it shows in the window only)", () => {
  const doodle = fs.readFileSync(new URL("../runtime/doodle.js", import.meta.url), "utf8");
  assert.ok(/Wt = indoors \? WEATHER\.clear : Wo/.test(doodle));
});

test("a toy boat is the story's boat: the director's extra full-size boat is removed and nobody rides the toy", () => {
  const toy = { kind: "custom", id: "toy_boat", describe: "a small wooden toy boat", dimensions: { width: 0.3, height: 0.2 } };
  const { spec, notes } = run(film(["The boy set the toy on the pond.", { place: "lake", time: "day", subjects: [{ ...sailor, x: 0.5 }, { ...keeper, x: 0.4 }], props: [toy, { kind: "boat" }] }]));
  const shot = spec.lines[0].shots[0]; assert.equal(shot.props.some((p) => p.kind === "boat"), false); assert.ok(shot.props.some((p) => p.id === "toy_boat"));
  assert.ok(shot.subjects.every((s) => s.aboard === undefined)); assert.ok(notes.some((n) => /toy/.test(n)));
});
test("a small boat never has a crew", () => {
  const { spec } = run(film(["A model sailed.", sea([{ ...sailor, x: 0.5 }], { props: [{ id: "tiny", kind: "boat", x: 0.5, dimensions: { width: 0.4, height: 0.3 } }] })]));
  assert.equal(spec.lines[0].shots[0].subjects[0].aboard, undefined);
});

test("the vocabulary has a small pond that is not a lake, and the director and verifier are told", async () => {
  const { PROPS } = await import("../vocab.mjs"), { directorBrief } = await import("../brief.mjs"), sup = fs.readFileSync(new URL("../supervise.mjs", import.meta.url), "utf8");
  assert.ok("pond" in PROPS); assert.match(directorBrief(), /pond or a puddle is the small prop "pond"/); assert.match(sup, /not a lake that fills the picture/);
});
