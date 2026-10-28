import test from "node:test";
import assert from "node:assert/strict";
import { applyFixes, describeSpec, supervise } from "../supervise.mjs";

const base = () => ({ lines: [
  { say: "A boat was lost.", shots: [{ place: "sea", time: "night", weather: "storm", subjects: [{ who: "young_man_1", pose: "hold", x: 0.5, aboard: "boat1" }], props: [{ kind: "boat", id: "boat1", x: 0.5 }] }] },
  { say: "He lit the lamp.", shots: [{ place: "interior", room: "lighthouse", time: "night", weather: "rain", subjects: [{ who: "old_man_3", pose: "reach" }], props: [{ kind: "lamp" }] }, { place: "sea", time: "night", weather: "storm", subjects: [], props: [{ kind: "boat", id: "boat1", x: 0.5 }] }] },
] });
const run = (fixes, spec = base()) => { const notes = []; const n = applyFixes(spec, fixes, (w, m) => notes.push(`${w}: ${m}`)); return { spec, notes, n }; };

test("the supervisor reads a compact description of every shot", () => {
  const t = describeSpec(base()); assert.match(t, /young_man_1 hold@0.5 aboard=boat1/); assert.match(t, /interior\/lighthouse night rain/); assert.match(t, /\[0\]boat#boat1@0.5/);
});
test("the verifier reads the director's scene descriptions next to the shots", () => {
  const s = base(); s.lines[0].scene = "A boat on a frozen puddle at night."; assert.match(describeSpec(s), /scene \(the director.s description\): A boat on a frozen puddle/); assert.match(describeSpec(base()), /\(none written\)/);
});
test("a room fix inside the vocabulary is applied", () => {
  const { spec, n } = run([{ line: 1, shot: 0, op: "setShot", field: "room", value: "lantern", reason: "the lamp is lit in the lamp room" }]); assert.equal(n, 1); assert.equal(spec.lines[1].shots[0].room, "lantern");
});
test("words outside the vocabulary are refused, never applied", () => {
  const { spec, notes, n } = run([{ line: 1, shot: 0, op: "setShot", field: "room", value: "throne room" }, { line: 1, shot: 0, op: "setShot", field: "place", value: "mars" }, { line: 0, shot: 0, op: "setSubject", index: 0, field: "pose", value: "fly" }]);
  assert.equal(n, 0); assert.equal(spec.lines[1].shots[0].room, "lighthouse"); assert.equal(notes.length, 3); assert.ok(notes.every((m) => /skipped/.test(m)));
});
test("a missing crew member is added back from the earlier shot, aboard", () => {
  const { spec } = run([{ line: 1, shot: 1, op: "addSubject", copyFrom: { line: 0, shot: 0, index: 0 }, set: { pose: "hold", x: 0.5, aboard: "boat1" }, reason: "he was aboard" }]);
  const s = spec.lines[1].shots[1].subjects; assert.equal(s.length, 1); assert.equal(s[0].who, "young_man_1"); assert.equal(s[0].aboard, "boat1");
});
test("the same person is never added twice, and a shot holds at most six", () => {
  const spec = base(); spec.lines[1].shots[1].subjects.push({ who: "young_man_1" });
  assert.equal(run([{ line: 1, shot: 1, op: "addSubject", copyFrom: { line: 0, shot: 0, index: 0 } }], spec).spec.lines[1].shots[1].subjects.length, 1);
  const full = base(); full.lines[1].shots[1].subjects = Array.from({ length: 6 }, (_, i) => ({ who: "p" + i }));
  assert.equal(run([{ line: 1, shot: 1, op: "addSubject", copyFrom: { line: 0, shot: 0, index: 0 } }], full).spec.lines[1].shots[1].subjects.length, 6);
});
test("bad indexes, unknown operations and unknown shots are skipped without crashing", () => {
  const { notes, n } = run([{ line: 9, shot: 0, op: "setShot", field: "room", value: "cabin" }, { line: 0, shot: 0, op: "removeSubject", index: 7 }, { line: 0, shot: 0, op: "explode" }, null, { op: "setShot" }]);
  assert.equal(n, 0); assert.ok(notes.length >= 3);
});
test("props: a known kind is added once; a custom object needs a description (the oracle draws it)", () => {
  const { spec, n } = run([{ line: 0, shot: 0, op: "addProp", prop: { kind: "rock", x: 0.3 } }, { line: 0, shot: 0, op: "addProp", prop: { kind: "rock", x: 0.3 } }, { line: 0, shot: 0, op: "addProp", prop: { kind: "custom" } }]);
  assert.equal(n, 1); assert.equal(spec.lines[0].shots[0].props.filter((p) => p.kind === "rock").length, 1);
});
test("a missing named thing is added as a custom object with a description, size and surface, and another object can be put on it", () => {
  const { spec, n } = run([
    { line: 1, shot: 0, op: "addProp", prop: { kind: "custom", id: "puddle", describe: "a small frozen puddle", dimensions: { width: 1.2, height: 0.08 }, surface: { x: 0.5, y: 0.4, w: 0.8 }, x: 0.4 }, reason: "the words name it" },
    { line: 1, shot: 0, op: "addProp", prop: { kind: "boat", id: "b", on: "puddle" } },
    { line: 1, shot: 0, op: "addProp", prop: { kind: "custom" } }]);
  const props = spec.lines[1].shots[0].props; assert.equal(n, 2); const pud = props.find((p) => p.id === "puddle"); assert.equal(pud.kind, "custom"); assert.equal(pud.dimensions.width, 1.2); assert.equal(props.find((p) => p.id === "b").on, "puddle");
});
test("setProp can put an object on another, only on an object that exists", () => {
  const spec = base(); spec.lines[1].shots[0].props.push({ kind: "table", id: "t" });
  assert.equal(run([{ line: 1, shot: 0, op: "setProp", index: 0, field: "on", value: "t" }], spec).spec.lines[1].shots[0].props[0].on, "t");
  const bad = run([{ line: 1, shot: 0, op: "setProp", index: 0, field: "on", value: "nothing" }, { line: 1, shot: 0, op: "setProp", index: 0, field: "color", value: "red" }]); assert.equal(bad.n, 0);
});
test("supervise asks the model once and applies what comes back", async () => {
  let asked = 0; const ask = async ({ user, system }) => { asked++; assert.match(system, /continuity/); assert.match(user, /He lit the lamp/); return { fixes: [{ line: 1, shot: 0, op: "setShot", field: "room", value: "lantern" }] }; };
  const r = await supervise({ spec: base(), script: "A boat was lost.\nHe lit the lamp.", engine: "claude", ask });
  assert.equal(asked, 1); assert.equal(r.applied, 1); assert.equal(r.spec.lines[1].shots[0].room, "lantern");
});
