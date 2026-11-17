// Who and how the storyboard cards draw (lib/storyboard-preview/cast.ts): deterministic from the script, so the same person looks the same on every card and
// an edited beat re-poses at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAST_PREVIEW_TEMPLATES, figuresForBeat, isCrowdBeat, moodFor, namesFrom, planCard, poseFor, seedOf, setOfBeat, cardSignature } from "../lib/storyboard-preview/cast.ts";
import { placeOfBeat, beatPlace } from "../../backend/src/plan/packs/history-reel/index.ts";

test("the pose map follows the brief: walk/run, hold/carry/pull/place, point, sit, push, stand-like words, default stand", () => {
  const cases = [
    ["[street] wide: Farriner walks along the road", "walk"], ["[street] wide: he runs for the door", "walk"],
    ["[lab] medium: Percy holds a magnetron out", "holdOut"], ["[lab] medium: he carries a tray", "holdOut"], ["[lab] close: she pulls the lever", "holdOut"], ["[lab] close: he places the bar on the shelf", "holdOut"],
    ["[lab] medium: the engineer points at the dial", "pointUp"], ["[lab] wide: Percy sits at the bench", "sit"], ["[yard] wide: two men push the cart", "push"],
    ["[lab] medium: Percy yawns and shrugs", "stand"], ["[lab] medium: he stands by the window", "stand"], ["[lab] wide: the room is quiet", "stand"], ["", "stand"]
  ];
  for (const [visual, pose] of cases) assert.equal(poseFor(visual), pose, visual);
  assert.equal(poseFor(null), "stand");
  assert.equal(poseFor("[x] wide: walks and holds"), "walk", "the first rule that matches wins");
});

test("crowds get extra figures, moods follow a few keywords", () => {
  assert.equal(isCrowdBeat("[street] wide: the crowd of neighbours carry buckets"), true);
  assert.equal(isCrowdBeat("[street] wide: Farriner runs"), false);
  assert.equal(planCard(0, [{ visual: "[a] wide: villagers watch" }], [], ["set-a"]).crowd, 3);
  assert.equal(moodFor("[a] wide: flames burst up"), "scared");
  assert.equal(moodFor("[a] medium: the mayor laughs at the fire"), "grin", "a laugh beats the fire word");
  assert.equal(moodFor("[a] wide: a quiet room"), "calm");
});

test("people are found in the script; things are not", () => {
  const beats = [
    { line: "Thomas Farriner forgot to bank his oven.", visual: "[bakery] medium: farriner yawns" },
    { line: "The Lord Mayor looked at the Great Fire and laughed.", visual: "[street] medium: the Lord Mayor stands" },
    { line: "Then Farriner ran.", visual: "[street] wide: Farriner runs" }
  ];
  assert.deepEqual(namesFrom(beats, { idea: "In 1666 a baker named Thomas Farriner started the Great Fire of London." }), ["Thomas Farriner", "Lord Mayor"]);
  assert.deepEqual(namesFrom([{ line: "He walked home.", visual: "[a] wide: a man walks" }], null), [], "no names: the generic figure");
  assert.deepEqual(namesFrom([{ line: "Then When Wide Close.", visual: "[a] wide: hold" }], null), [], "sentence-start words are not people");
});

// the Great Fire of London film (staging project 2bddee53), 8 beats
const FIRE = [
  { keyword: "He forgot", line: "He forgot to put out his oven.", visual: "[bakery] medium: Thomas Farriner yawns and drops his bread-shovel on the flour sacks, a spark floats out of the oven" },
  { keyword: "The embers", line: '"The embers will die down by morning."', visual: "[bakery] wide: farriner shrugs at the glowing oven and walks to bed" },
  { keyword: "Midnight on Pudding Lane", line: "By midnight, the straw floor was blazing.", visual: "[pudding-lane] wide: a spark drops into a straw basket on the floorboards and flames burst upward" },
  { keyword: "The Lord Mayor", line: "The Lord Mayor rushed over, looked at the fire, and laughed.", visual: "[pudding-lane] medium: the Lord Mayor points at the fire and laughs" },
  { keyword: "Pish", line: '"Pish! A woman could piss it out," he declared.', visual: "[pudding-lane] medium: the Mayor shrugs and walks away" },
  { keyword: "London was tinder", line: "London was pure tinder.", visual: "[pudding-lane] wide: the narrow street of wooden houses, flames leaping from roof to roof" },
  { keyword: "Burning for four days", line: "It raged for four straight days.", visual: "[pudding-lane] wide: smoke over the burning rooftops of the city" },
  { keyword: "Run", line: "Thousands fled.", visual: "[pudding-lane] wide: a crowd of residents with bundles runs through the smoke, Farriner among them" }
];
const FIRE_NOTES = { idea: "In 1666 a baker named Thomas Farriner went to bed after banking his oven, and a spark started the Great Fire of London." };

test("a beat draws only the characters its VISUAL names (also by surname, any case); a crowd gets generic figures; otherwise the set stays empty", () => {
  const names = namesFrom(FIRE, FIRE_NOTES);
  assert.deepEqual([...names].sort(), ["Lord Mayor", "Thomas Farriner"], "the film's named cast (Pudding Lane and the Great Fire are places and things)");
  const plan = (i) => planCard(i, FIRE, names, ["set-bakery", "set-pudding-lane"]);
  // named by surname, lower case
  assert.deepEqual(plan(0).figures.map((f) => f.name), ["Thomas Farriner"]);
  assert.deepEqual(plan(1).figures.map((f) => f.name), ["Thomas Farriner"], '"farriner" is Thomas Farriner');
  // beat 3: a spark in a basket: nobody, no stand-in
  assert.deepEqual(plan(2).figures, []); assert.equal(plan(2).crowd, 0, "no figure at all: the empty set with its key phrase");
  // the mayor, by title and by the shortened "Mayor"
  assert.deepEqual(plan(3).figures.map((f) => f.name), ["Lord Mayor"]);
  assert.deepEqual(plan(4).figures.map((f) => f.name), ["Lord Mayor"]);
  // beats 6 and 7 do not carry the mayor over, and they name nobody
  assert.deepEqual(plan(5).figures, []); assert.equal(plan(5).crowd, 0);
  assert.deepEqual(plan(6).figures, []); assert.equal(plan(6).crowd, 0, '"the city" is not people');
  // a crowd of residents with a named person in it: Farriner in front, two generic figures behind
  assert.deepEqual(plan(7).figures.map((f) => f.name), ["Thomas Farriner"]); assert.equal(plan(7).crowd, 2);
  // never carried over: the cards of the beats after the mayor are not his
  for (const i of [5, 6]) assert.ok(!plan(i).figures.some((f) => f.name === "Lord Mayor"));
});

test("a crowd with nobody named is three generic figures; a film with no names has no stand-in figure", () => {
  const beats = [{ visual: "[a] wide: the townsfolk gather in the square" }, { visual: "[a] wide: a candle on a table" }, { visual: "[a] medium: a man walks past" }];
  const plans = beats.map((_, i) => planCard(i, beats, [], ["set-a"]));
  assert.deepEqual(plans.map((p) => [p.figures.length, p.crowd]), [[0, 3], [0, 0], [0, 0]], '"a man" names nobody: no generic stand-in');
  assert.equal(figuresForBeat({ visual: "[a] wide: the baker waits" }, []).length, 0);
});

test("the same person gets the same seed (and so the same look) on every card", () => {
  const names = ["Thomas Farriner", "Lord Mayor"];
  const a = figuresForBeat({ visual: "[x] wide: Farriner runs" }, names), b = figuresForBeat({ visual: "[y] close: Thomas Farriner shrugs" }, names);
  assert.equal(a[0].seed, b[0].seed);
  assert.equal(a[0].seed, seedOf("Thomas Farriner"));
  assert.notEqual(seedOf("Thomas Farriner"), seedOf("Lord Mayor"));
  assert.equal(seedOf("THOMAS farriner"), seedOf("Thomas Farriner"));
  assert.deepEqual(figuresForBeat({ visual: "[x] wide: Farriner and the Mayor argue" }, names).map((f) => f.name), ["Thomas Farriner", "Lord Mayor"], "two named people are both drawn");
});

test("the place rule is the backend's placeOfBeat", () => {
  const beats = [{ visual: "[gorge] wide: a" }, { visual: "wide: b" }, { visual: "[fort] close: c" }, { visual: "medium: d" }];
  for (let i = 0; i < beats.length; i++) assert.equal(setOfBeat(i, beats, ["set-gorge", "set-fort"]), `set-${placeOfBeat(i, beats)}`, `beat ${i}`);
  assert.equal(setOfBeat(0, [{ visual: "wide: untagged" }], ["set-main"]), "set-main", "no tag: the first set there is");
  assert.equal(setOfBeat(0, [{ visual: "wide: untagged" }], []), null);
  assert.equal(beatPlace({ visual: "[Old Fort] wide" }), "old-fort");
});

test("an edited beat gets a new signature only when what the card shows changes", () => {
  const names = ["Percy Spencer"], beats = [{ line: "Percy Spencer walked.", visual: "[lab] wide: Percy walks", keyword: "Walk" }];
  const sig = (b) => cardSignature(planCard(0, [b], names, ["set-lab"]), "9:16", "1");
  const base = sig(beats[0]);
  assert.equal(sig({ ...beats[0], keyword: "A different key phrase", line: "Another line." }), base, "text that is not drawn changes nothing");
  assert.notEqual(sig({ ...beats[0], visual: "[lab] wide: Percy sits" }), base, "a new action re-poses");
  assert.notEqual(cardSignature(planCard(0, beats, names, ["set-lab"]), "9:16", "2"), base, "a redrawn set redraws the card");
});

test("the templates the page draws cards for are the packs the backend flags", async () => {
  process.env.APP_ENV ??= "local"; process.env.DATABASE_URL ??= "postgres://unused@localhost/unused"; process.env.PLANNER ??= "deterministic";
  const { templatePack } = await import("../../backend/src/plan/template-packs.ts");
  const flagged = ["history-reel", "dark-fable", "picture-film"].filter((id) => templatePack(id)?.storyboardPreviews === "cast");
  assert.deepEqual([...CAST_PREVIEW_TEMPLATES].sort(), flagged.sort());
});
