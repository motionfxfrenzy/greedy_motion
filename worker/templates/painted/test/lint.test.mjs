import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../lint.mjs";

const film = (...shots) => ({ lines: shots.map((s, i) => ({ say: "x" + i, shots: [s] })) });
const shotsOf = (r) => r.spec.lines.map((l) => l.shots[0]);

test("people and grounded props lose the director's y", () => {
  const r = normalize(film({ place: "sea", time: "night", subjects: [{ pose: "stand", y: 0.4 }], props: [{ kind: "lighthouse", y: 0.5 }, { kind: "moon", y: 0.2 }] }));
  const [s] = shotsOf(r);
  assert.equal("y" in s.subjects[0], false);
  assert.equal("y" in s.props[0], false);
  assert.equal(s.props[1].y, 0.2);                                   // a moon stays where it was put
});

test("a lighthouse and a beam are one light", () => {
  const [s] = shotsOf(normalize(film({ place: "sea", time: "night", props: [{ kind: "lighthouse" }, { kind: "beam" }] })));
  assert.deepEqual(s.props.map((p) => p.kind), ["lighthouse"]);
});

test("a beam alone is kept", () => {
  const [s] = shotsOf(normalize(film({ place: "sea", time: "night", props: [{ kind: "boat" }, { kind: "beam" }] })));
  assert.deepEqual(s.props.map((p) => p.kind), ["boat", "beam"]);
});

test("a clear night between two storm shots is the storm", () => {
  const r = normalize(film({ place: "sea", time: "night", weather: "rain" }, { place: "sea", time: "night", weather: "clear" }, { place: "sea", time: "night", weather: "rain" }));
  assert.equal(shotsOf(r)[1].weather, "rain");
});

test("dawn after a storm stays clear", () => {
  const r = normalize(film({ place: "sea", time: "night", weather: "rain" }, { place: "shore", time: "dawn", weather: "clear" }, { place: "shore", time: "morning", weather: "clear" }));
  assert.equal(shotsOf(r)[1].weather, "clear");
});

test("words the vocabulary lacks go to the AI, not to a wrong picture", () => {
  const [s] = shotsOf(normalize(film({ place: "moonbase_interior", time: "teatime", weather: "hail", subjects: [{ pose: "moonwalk" }], props: [{ kind: "brass telescope" }] })));
  assert.equal(s.place, "custom"); assert.equal(s.describe, "moonbase interior");
  assert.equal(s.time, "day"); assert.equal(s.weather, "clear"); assert.equal(s.subjects[0].pose, "stand");
  assert.equal(s.props[0].kind, "custom"); assert.equal(s.props[0].describe, "brass telescope");
});
test("an interior takes its room from the words", () => {
  const r = normalize({ lines: [{ say: "The keeper climbed the stairs of his lighthouse.", shots: [{ place: "interior", time: "night" }] }, { say: "She baked in the kitchen.", shots: [{ place: "interior", time: "day" }] }] });
  assert.deepEqual(r.spec.lines.map((l) => l.shots[0].room), ["lighthouse", "kitchen"]);
});
test("the input is not changed", () => {
  const input = film({ place: "sea", time: "night", props: [{ kind: "lighthouse" }, { kind: "beam" }] });
  const before = JSON.stringify(input); normalize(input); assert.equal(JSON.stringify(input), before);
});

test("storm is a known weather and counts as the storm for continuity", () => {
  const r = normalize(film({ place: "sea", time: "night", weather: "storm" }, { place: "sea", time: "night", weather: "clear" }, { place: "sea", time: "night", weather: "rain" }));
  assert.equal(shotsOf(r)[0].weather, "storm"); assert.equal(shotsOf(r)[1].weather, "storm");
});

test("never two moons or two suns", () => {
  const [s] = shotsOf(normalize(film({ place: "sea", time: "night", props: [{ kind: "moon" }, { kind: "moon", x: 0.3 }, { kind: "sun" }] })));
  assert.deepEqual(s.props.map((p) => p.kind), ["moon"]);
});

test("a river in the words is a river in the picture", () => {
  const r = normalize({ lines: [{ say: "he carried water from the far river", shots: [{ place: "lake", time: "day" }] }, { say: "he looked at the sea", shots: [{ place: "sea", time: "day" }] }] });
  assert.equal(r.spec.lines[0].shots[0].place, "river"); assert.equal(r.spec.lines[1].shots[0].place, "sea");
});

test("by the fire is indoors", () => {
  const r = normalize({ lines: [{ say: "By the fire, they shared the bread", shots: [{ place: "village", time: "night" }] }] });
  assert.equal(r.spec.lines[0].shots[0].place, "interior");
});

test("a deliberate outside shot in an indoor line is left alone", () => {
  const r = normalize({ lines: [{ say: "By the fire, they shared the bread", shots: [{ place: "interior", time: "night" }, { place: "mountains", time: "night" }] }] });
  assert.deepEqual(r.spec.lines[0].shots.map((s) => s.place), ["interior", "mountains"]);
});

test("after the door opens, people are inside until the words take them out", () => {
  const lines = [
    { say: "Far ahead, a lantern glowed in a window.", shots: [{ place: "hills", time: "night", weather: "snow", subjects: [{ pose: "stand" }] }] },
    { say: "She knocked on the door three times.", shots: [{ place: "village", time: "night", weather: "snow", subjects: [{ pose: "reach" }], props: [{ kind: "house" }] }] },
    { say: "Her grandmother opened it and hugged her tightly.", shots: [{ place: "village", time: "night", weather: "snow", subjects: [{ pose: "hug" }, { pose: "hug" }] }] },
    { say: "They shared the bread.", shots: [{ place: "village", time: "night", weather: "snow", subjects: [{ pose: "sit" }] }, { place: "mountains", time: "night", weather: "snow" }] },
    { say: "In the morning she went home.", shots: [{ place: "road", time: "morning", weather: "clear", subjects: [{ pose: "walk" }] }] }
  ];
  const r = normalize({ lines });
  const places = r.spec.lines.map((l) => l.shots.map((s) => s.place));
  assert.deepEqual(places, [["hills"], ["village"], ["interior"], ["interior", "mountains"], ["road"]]);
  assert.equal(r.spec.lines[2].shots[0].weather, "snow");                      // the snow is outside the window
  assert.ok(r.spec.lines[3].shots[0].props.some((p) => p.kind === "table"));    // the bread is on a table
});

test("the season is set by the words and holds until they change it", () => {
  const lines = [
    { say: "Every winter, Mina carried bread over the mountain.", shots: [{ place: "mountains", time: "morning" }] },
    { say: "She walked on and on.", shots: [{ place: "road", time: "day" }] },
    { say: "Then spring came to the valley.", shots: [{ place: "meadow", time: "day" }] }
  ];
  const r = normalize({ lines });
  assert.deepEqual(r.spec.lines.map((l) => l.shots[0].season), ["winter", "winter", "spring"]);
});

test("a named object in the words is added to the picture", () => {
  const r = normalize({ lines: [{ say: "They lifted the heavy jar together.", shots: [{ place: "desert", time: "day", subjects: [{ pose: "hold" }, { pose: "hold" }] }] }] });
  assert.ok(r.spec.lines[0].shots[0].props.some((p) => p.kind === "jar"));
});
test("an object already shown is not added twice", () => {
  const r = normalize({ lines: [{ say: "He lifted the jar.", shots: [{ place: "desert", time: "day", subjects: [{ pose: "hold" }], props: [{ kind: "jar" }] }] }] });
  assert.equal(r.spec.lines[0].shots[0].props.filter((p) => p.kind === "jar").length, 1);
});

test("a carried jar stays in every shot with people until it is put down", () => {
  const sh = (extra = {}) => ({ place: "desert", time: "day", subjects: [{ pose: "hold" }], ...extra });
  const r = normalize({ lines: [{ say: "He carried the heavy jar.", shots: [sh()] }, { say: "His steps grew slower.", shots: [sh()] }, { say: "At last he set it down.", shots: [sh()] }, { say: "He rested.", shots: [sh()] }] });
  const has = (i) => r.spec.lines[i].shots[0].props.some((p) => p.kind === "jar");
  assert.deepEqual([has(0), has(1), has(2), r.spec.lines[3].shots[0].props?.some((p) => p.kind === "jar") ?? false], [true, true, true, false]);
});

test("a fishing boat has a fisherman aboard, once", () => {
  const f = { lines: [{ say: "A small fishing boat, lost in the dark.", shots: [{ place: "sea", time: "night", weather: "storm", props: [{ kind: "boat", x: 0.3 }] }] }] };
  const r = normalize(f), s = shotsOf(r)[0];
  assert.equal(s.subjects.length, 1); assert.equal(s.subjects[0].x, 0.3);
  assert.equal(shotsOf(normalize(r.spec))[0].subjects.length, 1);          // idempotent
  assert.equal(shotsOf(normalize(film({ place: "sea", time: "day", props: [{ kind: "boat" }] })))[0].subjects.length, 0);   // no words, no person
});

test("clothes the painter cannot paint never reach it: a person from the library is painted whole", () => {
  const r = normalize(film({ place: "interior", time: "night", subjects: [{ pose: "walk", hair: "grey", top: "heavy wool coat", bottom: "dark blue trousers" }] }));
  const s = shotsOf(r)[0].subjects[0];
  assert.ok(s.who, "cast"); assert.match(s.top, /^#[0-9a-f]{6}$/i); assert.match(s.bottom, /^#[0-9a-f]{6}$/i); assert.ok(["short", "long", "bun", "beard", "bald", "hood"].includes(s.hair));
  assert.deepEqual(shotsOf(normalize(r.spec))[0].subjects[0], s);          // idempotent
});
test("a director's own hex colour wins over the library, a word does not", () => {
  const s = shotsOf(normalize(film({ place: "meadow", time: "day", subjects: [{ who: "girl_3", top: "#112233", bottom: "navy" }] })))[0].subjects[0];
  assert.equal(s.who, "girl_3"); assert.equal(s.top, "#112233"); assert.notEqual(s.bottom, "navy"); assert.match(s.bottom, /^#[0-9a-f]{6}$/i);
});
test("climbing the lighthouse stairs is shown as climbing", () => {
  const f = { lines: [{ say: "An old keeper climbed the stairs of his lighthouse.", shots: [{ place: "interior", room: "lighthouse", time: "night", subjects: [{ pose: "walk" }] }] }] };
  assert.equal(shotsOf(normalize(f))[0].subjects[0].pose, "climb");
  const g = { lines: [{ say: "He walked the stairs.", shots: [{ place: "interior", room: "lighthouse", time: "night", subjects: [{ pose: "walk" }] }] }] };
  assert.equal(shotsOf(normalize(g))[0].subjects[0].pose, "walk");
});

test("a boat in front of an island: the island is set back and the boat clear of it", () => {
  const f = film({ place: "sea", time: "night", props: [{ kind: "boat", x: 0.4 }, { kind: "rock", id: "r" }, { kind: "lighthouse", id: "l", on: "r", x: 0.8 }] });
  const [s] = shotsOf(normalize(f));
  assert.equal(s.props.find((p) => p.id === "r").depth, 0.6);
  const bx = s.props.find((p) => p.kind === "boat").x; assert.ok(Math.abs(bx - 0.5) >= 0.15 && bx >= 0.34 && bx <= 0.74);   // clear of the island, and inside the frame
  assert.equal(shotsOf(normalize(film({ place: "sea", time: "day", props: [{ kind: "boat" }] })))[0].props[0].depth, undefined);
});
test("climbing is framed wide", () => {
  const f = { lines: [{ say: "He climbed the stairs of the lighthouse.", shots: [{ place: "interior", room: "lighthouse", time: "night", framing: "medium", subjects: [{ pose: "walk" }] }] }] };
  assert.equal(shotsOf(normalize(f))[0].framing, "wide");
});

test("a tree bears the fruit the narrator shows, from that line on, never in winter or spring", async () => {
  const { applyFruit } = await import("../lint.mjs");
  const tree = () => ({ kind: "tree" });
  const spec = { lines: [
    { say: "She digs beside the lemon sapling.", shots: [{ season: "summer", props: [tree()] }] },
    { say: "Heavy yellow lemons pull the branches down.", shots: [{ season: "summer", props: [tree()] }] },
    { say: "She picks one.", shots: [{ season: "summer", props: [tree()] }] },
    { say: "Snow covers the hill.", shots: [{ season: "winter", props: [tree()] }] },
  ] };
  applyFruit(spec, () => {});
  const f = spec.lines.map((l) => l.shots[0].props[0].fruit);
  assert.deepEqual(f, [undefined, "lemon", "lemon", undefined]);
});

test("someone sitting is moved beside a tree trunk, not left in front of it", async () => {
  const { applyClearance } = await import("../lint.mjs");
  const spec = { lines: [{ say: "He sits.", shots: [{ props: [{ kind: "tree", x: 0.5 }], subjects: [{ who: "a", pose: "sit", x: 0.5 }, { who: "b", pose: "stand", x: 0.7 }] }] }] };
  applyClearance(spec, () => {});
  const a = spec.lines[0].shots[0].subjects[0].x;
  assert.ok(Math.abs(a - 0.5) >= 0.14 && Math.abs(a - 0.7) > 0.14, `moved to ${a}`);
});

test("people and trees stay where they were put within a place, unless the words move them", async () => {
  const { applyContinuity } = await import("../lint.mjs");
  const shot = (subs, tx) => ({ place: "hills", subjects: subs, props: [{ kind: "tree", x: tx }] });
  const spec = { lines: [
    { say: "They stand together.", shots: [shot([{ who: "g", pose: "stand", x: 0.3 }, { who: "o", pose: "stand", x: 0.7 }], 0.5)] },
    { say: "He leans on his cane.", shots: [shot([{ who: "g", pose: "stand", x: 0.4 }, { who: "o", pose: "stand", x: 0.3 }], 0.7)] },
    { say: "She walks to the tree.", shots: [shot([{ who: "g", pose: "walk", x: 0.6 }, { who: "o", pose: "stand", x: 0.3 }], 0.7)] },
    { say: "He sits down.", shots: [shot([{ who: "g", pose: "stand", x: 0.6 }, { who: "o", pose: "sit", x: 0.5 }], 0.6)] },
  ] };
  applyContinuity(spec, () => {});
  const o = spec.lines.map((l) => l.shots[0].subjects[1].x), g = spec.lines.map((l) => l.shots[0].subjects[0].x);
  assert.deepEqual(o, [0.7, 0.7, 0.7, 0.7]);               // the grandfather never moves
  assert.deepEqual(g, [0.3, 0.3, 0.6, 0.6]);               // the girl moves only where the words say she walks
  const trees = spec.lines.map((l) => l.shots[0].props[0].x);
  assert.equal(new Set(trees).size, 1);                    // one tree, one place
  assert.ok(Math.abs(trees[0] - 0.7) >= 0.19);             // and not where the grandfather sits
});

test("people face what they are doing; hills have a path only when the story has one", async () => {
  const { applyGaze, applyPath } = await import("../lint.mjs");
  const spec = { lines: [{ say: "They bury a sapling.", scene: "a girl and her grandfather plant a tree", shots: [{ place: "hills", props: [{ kind: "sprout", x: 0.5 }], subjects: [{ who: "g", pose: "kneel", x: 0.4, facing: "right" }, { who: "o", pose: "kneel", x: 0.6, facing: "right" }] }] }] };
  applyGaze(spec, () => {}); applyPath(spec, () => {});
  const [g, o] = spec.lines[0].shots[0].subjects;
  assert.equal(g.facing, "right"); assert.equal(o.facing, "left");      // both look at the sapling between them
  assert.equal(spec.lines[0].shots[0].path, false);                      // and there is no path in the story
  const walk = { lines: [{ say: "They climb the path.", shots: [{ place: "hills" }] }] }; applyPath(walk, () => {});
  assert.equal(walk.lines[0].shots[0].path, true);
});

test("someone put 'on' a chair sits in it, with the gesture kept for the arms", async () => {
  const { applySeating } = await import("../lint.mjs");
  const spec = { lines: [{ say: "He holds the lemon to his face.", shots: [{ place: "interior", props: [{ kind: "custom", id: "chair", describe: "a worn armchair", x: 0.35 }], subjects: [{ who: "o", pose: "hold", on: "chair", x: 0.35 }] }] }] };
  applySeating(spec, () => {});
  const o = spec.lines[0].shots[0].subjects[0];
  assert.equal(o.pose, "sit"); assert.equal(o.gesture, "hold"); assert.equal(o.on, "chair");
});

test("what the narrator says someone holds is drawn in their hand", async () => {
  const { applyHolding } = await import("../lint.mjs");
  const spec = { lines: [{ say: "The wind keeps stealing his hat, so she holds it while he digs.", shots: [{ props: [{ kind: "custom", id: "hat", describe: "an old brown felt hat", x: 0.3 }], subjects: [{ who: "old_man_3", pose: "reach", x: 0.55 }, { who: "girl_1", pose: "stand", x: 0.3 }] }] }] };
  applyHolding(spec, () => {});
  const sh = spec.lines[0].shots[0];
  assert.deepEqual(sh.props[0].heldBy, { who: "girl_1", hand: "right" });   // "she" is the girl
  assert.equal(sh.subjects[1].gesture, "hold");
});
