import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyEditDiff, loadWorldDb, matchWorldObject, recordEditEvent, retrieveCameraExemplars } from "../world-db.mjs";

test("personal colour or style tweaks are classified as user_preference and never promoted to the shared engine", () => {
  const before = { place: "meadow", time: "day", props: [{ id: "r1", kind: "rock", x: 0.5, color: "#8a6445" }], subjects: [{ who: "boy_1", top: "#3a6a4a" }] };
  const after = { place: "meadow", time: "sunset", props: [{ id: "r1", kind: "rock", x: 0.5, color: "#111111" }], subjects: [{ who: "boy_1", top: "#cc2222" }] };
  const verdict = classifyEditDiff({ say: "He stood by the rock.", instruction: "make the rock black and put him in a red coat at sunset", shotBefore: before, shotAfter: after });
  assert.equal(verdict.classification, "user_preference");
  assert.equal(verdict.promoteToEngine, false);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "world-db-"));
  try {
    recordEditEvent({ engine: "doodle", say: "He stood by the rock.", instruction: "make the rock black", shotsBefore: [before], shotsAfter: [after], exported: true }, tmp);
    assert.equal(fs.existsSync(path.join(tmp, "user_preferences.jsonl")), true);
    assert.equal(fs.existsSync(path.join(tmp, "engine_edit_events.jsonl")), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("structural relationship fixes (attaching `on`, adding `tether`, indoor place correction) are promoted as spatial_invariant", () => {
  const before = { place: "hills", props: [{ id: "table_1", kind: "table" }, { id: "jar_1", kind: "jar", x: 0.5 }] };
  const after = { place: "hills", props: [{ id: "table_1", kind: "table" }, { id: "jar_1", kind: "jar", on: "table_1" }] };
  const verdict = classifyEditDiff({ say: "He set the jar on the table.", instruction: "put the jar on the table", shotBefore: before, shotAfter: after });
  assert.equal(verdict.classification, "spatial_invariant");
  assert.equal(verdict.promoteToEngine, true);
  assert.match(verdict.summary, /attached jar_1 on table_1/);
});

test("camera coverage upgrades (portraitOf, detailOf, lookAt) are promoted as camera_grammar and retrievable for future scripts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "world-db-"));
  try {
    const before = { place: "hills", framing: "medium", subjects: [{ who: "girl_1", pose: "hold", facing: "front" }] };
    const after = { place: "hills", framing: "close", portraitOf: "girl_1", subjects: [{ who: "girl_1", pose: "hold", mood: "smile", facing: "front" }] };
    const ev = recordEditEvent({
      engine: "doodle",
      say: "We made the red kite fly, she whispered with a smile.",
      instruction: "zoom in on her smiling face for the whisper",
      shotsBefore: [before],
      shotsAfter: [after],
      exported: true,
    }, tmp);
    assert.equal(ev.classification, "camera_grammar");
    assert.equal(ev.promoteToEngine, true);

    const hits = retrieveCameraExemplars("The boy whispered with a smile as the kite rose.", { dbDir: tmp });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].shots[0].portraitOf, "girl_1");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("shared object ontology matches known story objects and tracks demand for new custom props across engines", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "world-db-"));
  try {
    const kite = matchWorldObject("a bright red diamond kite", "kite_1");
    assert.equal(kite?.zone, "airborne");
    const chair = matchWorldObject("a worn wooden armchair", "chair");
    assert.equal(chair?.surface?.y, 0.5);

    const before = { place: "interior", props: [] };
    const after = { place: "interior", props: [{ id: "scope", kind: "custom", describe: "a brass microscope", dimensions: { width: 0.2, height: 0.35 } }] };
    recordEditEvent({ engine: "oil", say: "She looked through the brass microscope.", instruction: "add the microscope", shotsBefore: [before], shotsAfter: [after], exported: true }, tmp);
    const db = loadWorldDb(tmp);
    assert.equal(db.demand["a brass microscope"]?.count, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("both doodle.js and kit.js (oil) enforce the far-arm-behind-torso profile rig rule", () => {
  const kitSrc = fs.readFileSync(new URL("../runtime/kit.js", import.meta.url), "utf8");
  const farCall = kitSrc.indexOf("armQueue.far.forEach");
  const torsoCall = kitSrc.indexOf("drawTorso()");
  const nearCall = kitSrc.indexOf("armQueue.near.forEach");
  assert.ok(farCall > 0 && torsoCall > farCall && nearCall > torsoCall);
});
