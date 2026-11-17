// Who and how the storyboard cards draw (lib/storyboard-preview/cast.ts): deterministic from the script, so the same person looks the same on every card and
// an edited beat re-poses at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAST_PREVIEW_TEMPLATES, figureForBeat, isCrowdBeat, moodFor, namesFrom, planCard, poseFor, seedOf, setOfBeat, GENERIC_FIGURE, cardSignature } from "../lib/storyboard-preview/cast.ts";
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
  assert.equal(planCard(0, [{ visual: "[a] wide: villagers watch" }], [], ["set-a"]).extras, 2);
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

test("the same person gets the same seed (and so the same look) on every card; continuity carries the person over beats that name nobody", () => {
  const names = ["Thomas Farriner", "Lord Mayor"];
  const beats = [{ line: "Thomas Farriner slept." }, { line: "The oven glowed." }, { line: "The Lord Mayor laughed." }, { line: "Nobody moved." }];
  assert.equal(figureForBeat(0, beats, names).seed, seedOf("Thomas Farriner"));
  assert.equal(figureForBeat(1, beats, names).seed, seedOf("Thomas Farriner"), "a beat that names nobody keeps the person before it");
  assert.equal(figureForBeat(2, beats, names).name, "Lord Mayor");
  assert.equal(figureForBeat(3, beats, names).name, "Lord Mayor");
  assert.equal(figureForBeat(0, [{ line: "x" }], []).seed, GENERIC_FIGURE.seed, "no names: one generic figure");
  assert.notEqual(seedOf("Thomas Farriner"), seedOf("Lord Mayor"));
  assert.equal(seedOf("THOMAS farriner"), seedOf("Thomas Farriner"));
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
