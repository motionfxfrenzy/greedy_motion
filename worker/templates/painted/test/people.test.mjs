import test from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES, GROUPS, inferGroup, peopleBrief } from "../people.mjs";
import { normalize } from "../lint.mjs";
import { directorBrief } from "../brief.mjs";

const HEX = /^#[0-9a-f]{6}$/i, STYLES = ["short", "long", "bun", "beard", "bald", "hood"];
const cast = (...says) => normalize({ lines: says.map(([say, n = 1]) => ({ say, shots: [{ place: "meadow", time: "day", subjects: Array.from({ length: n }, () => ({ pose: "stand" })) }] })) }).spec.lines.map((l) => l.shots[0].subjects);

test("the library has six groups of five people, every trait drawable", () => {
  assert.deepEqual(Object.keys(GROUPS).sort(), ["boy", "girl", "old_man", "old_woman", "young_man", "young_woman"]);
  assert.equal(Object.keys(ARCHETYPES).length, 30);
  for (const a of Object.values(ARCHETYPES)) {
    assert.ok(STYLES.includes(a.hair), a.id); for (const k of ["hairColor", "skin", "top", "bottom"]) assert.match(a[k], HEX, a.id + " " + k);
    assert.ok(["slim", "average", "stocky"].includes(a.build)); assert.ok(a.heightM > 1 && a.heightM < 2.2); assert.ok(a.desc.length > 10);
  }
});
test("the five people of a group differ from one another", () => {
  for (const g of Object.keys(GROUPS)) { const looks = new Set(Object.values(ARCHETYPES).filter((a) => a.group === g).map((a) => [a.hair, a.skin, a.top].join())); assert.equal(looks.size, 5, g); }
});
test("children are shorter than adults, the old stoop (age is carried to the painter)", () => {
  const [[kid], [man]] = cast(["The little girl laughed."], ["The old man nodded."]);
  assert.equal(kid.age, "child"); assert.equal(man.age, "old"); assert.ok(kid.heightM < 1.5 && man.heightM > 1.5);
});
test("the words choose the group", () => {
  assert.equal(inferGroup("An old keeper climbed the stairs.", 0, 1).group, "old_man");
  assert.equal(inferGroup("She walked home.", 0, 1).group, "young_woman");
  assert.equal(inferGroup("The grandmother smiled.", 0, 1).group, "old_woman");
  assert.equal(inferGroup("The boys ran.", 0, 1).group, "boy");
});
test("one character keeps one face across the story, a crowd gets different faces", () => {
  const [a, b, c] = cast(["An old keeper climbed the stairs."], ["He lit the lamp."], ["He only smiled."]);
  assert.equal(a[0].who, b[0].who); assert.equal(b[0].who, c[0].who);
  const [crowd] = cast(["The whole village stood on the shore.", 4]);
  assert.equal(new Set(crowd.map((s) => s.who)).size, 4);
  assert.ok(new Set(crowd.map((s) => s.age)).size >= 2, "mixed ages");
});
test("a named person or group is respected", () => {
  const s = normalize({ lines: [{ say: "x", shots: [{ place: "meadow", time: "day", subjects: [{ who: "old_woman_2" }, { who: "boy" }] }] }] }).spec.lines[0].shots[0].subjects;
  assert.equal(s[0].who, "old_woman_2"); assert.match(s[1].who, /^boy_[1-5]$/);
});
test("the director is shown every person", () => {
  const brief = directorBrief();
  for (const id of Object.keys(ARCHETYPES)) assert.ok(brief.includes(id), id);
  assert.ok(peopleBrief().split("\n").length === 6);
});

test("the words give people moods and gestures; a named feeling beats a word inside a quote", () => {
  const spec = normalize({ lines: [
    { say: "People in the village said he was wasting oil.", shots: [{ place: "village", time: "night", subjects: [{ pose: "stand" }, { pose: "stand" }] }] },
    { say: "He only smiled and said: a light is never wasted.", shots: [{ place: "shore", time: "dawn", subjects: [{ pose: "stand" }] }] },
    { say: "At dawn, the whole village thanked the keeper.", shots: [{ place: "shore", time: "dawn", subjects: [{ pose: "stand" }, { pose: "stand" }, { pose: "stand" }] }] }
  ] }).spec.lines.map((l) => l.shots[0].subjects);
  assert.ok(spec[0].every((s) => s.mood === "skeptical")); assert.equal(new Set(spec[0].map((s) => s.pose)).size, 2, "different gestures");
  assert.equal(spec[1][0].mood, "smile"); assert.equal(spec[1][0].pose, "stand");
  assert.ok(spec[2].every((s) => s.mood === "smile")); assert.ok(spec[2].some((s) => ["cheer", "wave"].includes(s.pose)));
});
test("a mood the director wrote is kept, an unknown one is neutral, extras come from the person", () => {
  const s = normalize({ lines: [{ say: "People were afraid.", shots: [{ place: "village", time: "day", subjects: [{ who: "old_man_2", mood: "laugh" }, { who: "boy_1", mood: "grumpy" }] }] }] }).spec.lines[0].shots[0].subjects;
  assert.equal(s[0].mood, "laugh"); assert.equal(s[1].mood, "neutral"); assert.ok(s[0].extras.includes("cane"));
});

test("people style: the film's choice reaches every shot, a shot's own choice wins, nonsense is repaired", () => {
  const f = (people, shotPeople) => normalize({ people, lines: [{ say: "x", shots: [{ place: "village", time: "night", people: shotPeople, subjects: [{}] }] }] });
  assert.equal(f("silhouette").spec.lines[0].shots[0].people, "silhouette");
  assert.equal(f("silhouette", "lit").spec.lines[0].shots[0].people, "lit");
  assert.equal(f(undefined).spec.lines[0].shots[0].people, undefined);
  assert.equal(f("bogus").spec.people, "lit");
});
