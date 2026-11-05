import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCandidatePatchToPreviewHtml,
  classifyEditPatch,
  checkSceneHintLayout,
  describeEditAction,
  deterministicCommentTranslator,
  hasEditPatchOperations,
  isBoxInsideSafeArea,
  isSameTextLengthClass,
  isValidPlanElementId,
  normalizeColorValue,
  resolveBeatWindowTimes,
  safeAreaBounds,
  validateBeatLayoutHint,
  validateCanvasDimensions,
  validateEditPatch,
  validateFrameElementsSnapshots,
  validateHyperFramesOverrides
} from "../../packages/contracts/src/edit-patch.ts";
import { affectedScenesSummary } from "../components/animation-workspace/logic.ts";

const CANVAS = { width: 1920, height: 1080 };

function makeBaseSnapshot(time = 3.2) {
  return {
    time,
    elements: [
      { id: "b2:field:0", role: "decor", text: "", box: [1200, 400, 600, 600], beat: "b2", opacity: 1 },
      { id: "b2:w:0", role: "word", text: "Ready", box: [240, 440, 290, 120], beat: "b2", opacity: 1 },
      { id: "b2:w:1", role: "word", text: "to", box: [555, 440, 100, 120], beat: "b2", opacity: 1 },
      { id: "b2:w:2", role: "accent-word", text: "share.", box: [680, 440, 280, 120], beat: "b2", opacity: 1 },
      { id: "b2:sub:0", role: "subtitle", text: "One prompt builds the plan", box: [240, 610, 560, 46], beat: "b2", opacity: 1 }
    ]
  };
}

test("safeAreaBounds and isBoxInsideSafeArea enforce 90% action-safe and 80% title-safe rules", () => {
  // Title-safe for text roles: 10% inset on each edge -> [192..1728, 108..972] on 1920x1080
  const titleBounds = safeAreaBounds(1920, 1080, "word");
  assert.equal(titleBounds.kind, "title-safe");
  assert.deepEqual(
    { minX: titleBounds.minX, minY: titleBounds.minY, maxX: titleBounds.maxX, maxY: titleBounds.maxY },
    { minX: 192, minY: 108, maxX: 1728, maxY: 972 }
  );
  assert.equal(isBoxInsideSafeArea([240, 440, 280, 120], 1920, 1080, "word").ok, true);
  assert.equal(isBoxInsideSafeArea([150, 440, 280, 120], 1920, 1080, "word").ok, false);
  assert.equal(isBoxInsideSafeArea([1500, 440, 280, 120], 1920, 1080, "word").ok, false);

  // Action-safe for non-text roles: 5% inset on each edge -> [96..1824, 54..1026] on 1920x1080
  const actionBounds = safeAreaBounds(1920, 1080, "card");
  assert.equal(actionBounds.kind, "action-safe");
  assert.deepEqual(
    { minX: actionBounds.minX, minY: actionBounds.minY, maxX: actionBounds.maxX, maxY: actionBounds.maxY },
    { minX: 96, minY: 54, maxX: 1824, maxY: 1026 }
  );
  assert.equal(isBoxInsideSafeArea([150, 440, 280, 120], 1920, 1080, "card").ok, true);
  assert.equal(isBoxInsideSafeArea([40, 440, 280, 120], 1920, 1080, "card").ok, false);
});

test("isSameTextLengthClass accepts equal-length-class replacements and rejects longer or multi-word changes", () => {
  assert.equal(isSameTextLengthClass("share.", "ship."), true);
  assert.equal(isSameTextLengthClass("Ready", "Built"), true);
  assert.equal(isSameTextLengthClass("share.", "distribute immediately"), false);
  assert.equal(isSameTextLengthClass("share.", "go"), false);
});

test("classifyEditPatch keeps colour, opacity, equal-length text, and clean nudges at element scope", () => {
  const before = [makeBaseSnapshot(3.0), makeBaseSnapshot(3.4)];

  // 1. Colour change
  const colorDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { color: "#ff3b6b" } },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: before
  });
  assert.equal(colorDecision.scope, "element");
  assert.equal(colorDecision.escalated, false);
  assert.equal(colorDecision.reason, "pure-visual-override");
  assert.equal(colorDecision.uiLabel, "changed colour");

  // 2. Same-length text change where neighbour boxes do not move
  const afterSameText = before.map((snap) => ({
    ...snap,
    elements: snap.elements.map((el) => (el.id === "b2:w:2" ? { ...el, text: "ship." } : el))
  }));
  const textDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: {}, text: "ship." },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: afterSameText
  });
  assert.equal(textDecision.scope, "element");
  assert.equal(textDecision.escalated, false);
  assert.equal(textDecision.reason, "equal-length-text");
  assert.equal(textDecision.uiLabel, "changed text");

  // 3. Position nudge that stays clear of neighbours and inside title-safe bounds
  const afterNudge = before.map((snap) => ({
    ...snap,
    elements: snap.elements.map((el) =>
      el.id === "b2:w:2" ? { ...el, box: [el.box[0], el.box[1] - 32, el.box[2], el.box[3]] } : el
    )
  }));
  const nudgeDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { dy: -32 } },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: afterNudge
  });
  assert.equal(nudgeDecision.scope, "element");
  assert.equal(nudgeDecision.escalated, false);
  assert.equal(nudgeDecision.reason, "position-nudge-clean");
  assert.equal(nudgeDecision.uiLabel, "nudged position");
});

test("classifyEditPatch escalates scaling, longer text, neighbour box shifts, overlaps, and safe-area exits to scene scope", () => {
  const before = [makeBaseSnapshot(3.0), makeBaseSnapshot(3.4)];

  // 1. Scale / bigger / smaller ALWAYS escalates to scene scope ("it should consider the whole space")
  const scaleDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { scale: 1.3 } },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: before
  });
  assert.equal(scaleDecision.scope, "scene");
  assert.equal(scaleDecision.escalated, true);
  assert.equal(scaleDecision.reason, "scale-requires-scene-layout");
  assert.equal(scaleDecision.uiLabel, "re-laid out the scene");

  // 2. Longer text escalates to scene scope
  const longTextDecision = classifyEditPatch({
    patch: {
      scope: "element",
      scene: "b2",
      atSeconds: 3.2,
      el: "b2:w:2",
      set: {},
      text: "publish everywhere instantaneously."
    },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: before
  });
  assert.equal(longTextDecision.scope, "scene");
  assert.equal(longTextDecision.escalated, true);
  assert.equal(longTextDecision.reason, "longer-or-different-length-text");

  // 3. Same-length text that shifts a neighbour word's box escalates to scene scope
  const afterShiftedNeighbour = before.map((snap) => ({
    ...snap,
    elements: snap.elements.map((el) => {
      if (el.id === "b2:w:0") return { ...el, text: "MMMMM", box: [240, 440, 340, 120] };
      if (el.id === "b2:w:1") return { ...el, box: [605, 440, 100, 120] }; // shifted +50px
      return el;
    })
  }));
  const neighbourShiftDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:0", set: {}, text: "MMMMM" },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: afterShiftedNeighbour
  });
  assert.equal(neighbourShiftDecision.scope, "scene");
  assert.equal(neighbourShiftDecision.escalated, true);
  assert.equal(neighbourShiftDecision.reason, "neighbour-box-changed");
  assert.deepEqual(neighbourShiftDecision.measurements.shiftedNeighbours, ["b2:w:1"]);

  // 4. Move onto another element (overlap) escalates to scene scope
  const afterOverlap = before.map((snap) => ({
    ...snap,
    elements: snap.elements.map((el) =>
      el.id === "b2:w:2" ? { ...el, box: [540, 440, 280, 120] } : el // overlaps b2:w:1 [555..655]
    )
  }));
  const overlapDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { dx: -140 } },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: afterOverlap
  });
  assert.equal(overlapDecision.scope, "scene");
  assert.equal(overlapDecision.escalated, true);
  assert.equal(overlapDecision.reason, "overlap-detected");
  assert.deepEqual(overlapDecision.measurements.collidingElements, ["b2:w:1"]);

  // 5. Off-screen / outside safe area push escalates to scene scope
  const afterOffSafe = before.map((snap) => ({
    ...snap,
    elements: snap.elements.map((el) =>
      el.id === "b2:w:2" ? { ...el, box: [1580, 440, 280, 120] } : el // right edge 1860 > title-safe 1728
    )
  }));
  const safeAreaDecision = classifyEditPatch({
    patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { dx: 900 } },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: afterOffSafe
  });
  assert.equal(safeAreaDecision.scope, "scene");
  assert.equal(safeAreaDecision.escalated, true);
  assert.equal(safeAreaDecision.reason, "left-safe-area");
  assert.equal(safeAreaDecision.measurements.safeAreaViolations.length, 2);
});

test("deterministicCommentTranslator parses natural-language comments into structured EditPatches", () => {
  const activeElements = makeBaseSnapshot(3.2).elements;

  const pColor = deterministicCommentTranslator.translate({
    comment: 'Make "share." pink',
    atSeconds: 3.2,
    scene: "b2",
    activeElements
  });
  assert.equal(pColor.el, "b2:w:2");
  assert.equal(pColor.set.color, "#ff3b6b");
  assert.equal(pColor.scope, "element");

  const pBigger = deterministicCommentTranslator.translate({
    comment: "Make share. bigger",
    atSeconds: 3.2,
    scene: "b2",
    activeElements
  });
  assert.equal(pBigger.el, "b2:w:2");
  assert.equal(pBigger.set.scale, 1.3);
  assert.equal(pBigger.scope, "scene");

  const pOnto = deterministicCommentTranslator.translate({
    comment: 'Move "share." onto "Ready"',
    atSeconds: 3.2,
    scene: "b2",
    activeElements
  });
  assert.equal(pOnto.el, "b2:w:2");
  assert.ok(typeof pOnto.set.dx === "number" && pOnto.set.dx < -200);
});

test("validateEditPatch, validateHyperFramesOverrides, validateBeatLayoutHint, checkSceneHintLayout, and affectedScenesSummary", () => {
  assert.ok("patch" in validateEditPatch({ scope: "element", scene: "b1", atSeconds: 1.2, el: "b1:w:0", set: { color: "pink", dy: -20 } }));
  assert.ok("error" in validateEditPatch({ scope: "invalid", scene: "b1", atSeconds: 1.2, set: {} }));
  assert.ok("error" in validateEditPatch({ scope: "element", scene: "b1", atSeconds: -1, set: {} }));

  const ovCheck = validateHyperFramesOverrides({ "b1:w:0": { color: "#ff3b6b", dy: -20 } });
  assert.ok("overrides" in ovCheck);
  assert.equal(ovCheck.overrides["b1:w:0"].color, "#ff3b6b");

  assert.ok("hints" in validateBeatLayoutHint({ emphasize: "b2:w:2", factor: 1.3 }));
  assert.ok("error" in validateBeatLayoutHint({ emphasize: "b2:w:2", factor: 5.0 }));

  const cleanCheck = checkSceneHintLayout([makeBaseSnapshot(3.2)], CANVAS, "b2");
  assert.equal(cleanCheck.ok, true);

  assert.equal(describeEditAction({ scope: "element", set: { color: "#ff3b6b" } }), "changed colour");
  assert.equal(describeEditAction({ scope: "scene", set: { factor: 1.3 } }), "re-laid out the scene");

  const summary = affectedScenesSummary([
    { scene: 0, appliedLabel: "changed colour" },
    { scene: 2 }
  ]);
  assert.deepEqual(summary.scenes, [3]);
  assert.equal(summary.label, "Redraw scene 3");
});

test("validateFrameElementsSnapshots, isValidPlanElementId, resolveBeatWindowTimes, and applyCandidatePatchToPreviewHtml", () => {
  const beatIds = new Set(["b1", "b2", "b3"]);
  assert.equal(isValidPlanElementId("b2:w:2", beatIds), true);
  assert.equal(isValidPlanElementId("g:cap:0", beatIds), true);
  assert.equal(isValidPlanElementId("b1_wipe:wipe:0", beatIds), true);
  assert.equal(isValidPlanElementId("b99:w:2", beatIds), false);
  assert.equal(isValidPlanElementId("invalid-id", beatIds), false);

  assert.ok("canvas" in validateCanvasDimensions({ width: 1920, height: 1080 }));
  assert.ok("error" in validateCanvasDimensions({ width: -10, height: 1080 }));

  const validSnaps = validateFrameElementsSnapshots([makeBaseSnapshot(3.2)], beatIds);
  assert.ok("snapshots" in validSnaps);

  const badIdSnaps = validateFrameElementsSnapshots(
    [{ time: 3.2, elements: [{ id: "b99:w:0", role: "word", text: "hi", box: [10, 10, 50, 20] }] }],
    beatIds
  );
  assert.ok("error" in badIdSnaps);

  assert.equal(hasEditPatchOperations({ scope: "element", scene: "b1", atSeconds: 1, set: {} }), false);
  assert.equal(hasEditPatchOperations({ scope: "element", scene: "b1", atSeconds: 1, set: { color: "#ff3b6b" } }), true);

  const win = resolveBeatWindowTimes(
    { beats: [{ id: "b1" }, { id: "b2" }], target_duration_s: 8 },
    "b2",
    5.5,
    { b1: { start: 0, end: 4 }, b2: { start: 4, end: 8 } }
  );
  assert.equal(win.beat.id, "b2");
  assert.equal(win.start, 4);
  assert.equal(win.end, 8);
  assert.ok(win.sampleTimes.length >= 2);

  const sampleHtml = `<html><head><script>window.__hfVariables = {"plan":"{\\"beats\\":[{\\"id\\":\\"b2\\",\\"keyword\\":\\"Ready to share.\\"}]}"};</script><script id="hf-variables" type="application/json">{"b2.keyword":"Ready to share."}</script></head></html>`;
  const withElementOv = applyCandidatePatchToPreviewHtml(sampleHtml, [
    { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { color: "#ff3b6b", dx: 24 } }
  ]);
  assert.ok(withElementOv.includes('"#ff3b6b"'));
  assert.ok(withElementOv.includes('"dx":24'));

  const withHint = applyCandidatePatchToPreviewHtml(sampleHtml, [
    { scope: "scene", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { scale: 1.3 } }
  ]);
  assert.ok(withHint.includes('\\"factor\\":1.3'));
});

test("B5 hardening: prototype keys, colour injection strings, duplicate snapshot ids, bounds, scope downgrade guard, and unequal snapshot refusal", () => {
  // 1. Prototype keys rejected by normalizeColorValue and validateEditPatch
  for (const protoKey of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
    assert.equal(normalizeColorValue(protoKey), null, `prototype key "${protoKey}" must not be accepted as a colour`);
    const patchCheck = validateEditPatch({
      scope: "element",
      scene: "b1",
      atSeconds: 1.0,
      el: "b1:w:0",
      set: { color: protoKey }
    });
    assert.ok("error" in patchCheck, `validateEditPatch must reject prototype colour "${protoKey}"`);
  }

  // 2. Colour injection string rejected by normalizeColorValue, validateEditPatch, validateHyperFramesOverrides, and applyCandidatePatchToPreviewHtml
  const injectionColor = "red}*{display:none";
  assert.equal(normalizeColorValue(injectionColor), null);
  assert.ok(
    "error" in
      validateEditPatch({
        scope: "element",
        scene: "b1",
        atSeconds: 1.0,
        el: "b1:w:0",
        set: { color: injectionColor }
      })
  );
  assert.ok(
    "error" in
      validateHyperFramesOverrides({
        "b1:w:0": { color: injectionColor }
      })
  );

  // 3. Upper bound on atSeconds (> 3600 rejected) and scene id format check
  assert.ok(
    "error" in
      validateEditPatch({
        scope: "element",
        scene: "b1",
        atSeconds: 3601,
        el: "b1:w:0",
        set: { color: "#ff3b6b" }
      }),
    "atSeconds > 3600 must be rejected"
  );
  assert.ok(
    "error" in
      validateEditPatch({
        scope: "element",
        scene: "bad scene id!",
        atSeconds: 1.0,
        el: "b1:w:0",
        set: { color: "#ff3b6b" }
      }),
    "invalid scene id format must be rejected"
  );
  assert.ok(
    "error" in
      validateEditPatch({
        scope: "element",
        scene: 999,
        atSeconds: 1.0,
        el: "b1:w:0",
        set: { color: "#ff3b6b" }
      }),
    "out-of-range numeric scene index must be rejected"
  );

  // 4. Length cap on override text (> 280 chars rejected) and strict data-el id check in validateHyperFramesOverrides
  assert.ok(
    "error" in
      validateHyperFramesOverrides({
        "b1:w:0": { text: "x".repeat(281) }
      }),
    "override text > 280 chars must be rejected"
  );
  assert.ok(
    "error" in
      validateHyperFramesOverrides({
        "not-a-data-el": { color: "#ff3b6b" }
      }),
    "invalid data-el id in overrides must be rejected"
  );

  // 5. Duplicate element ids in a snapshot rejected
  const beatIds = new Set(["b1", "b2"]);
  const dupCheck = validateFrameElementsSnapshots(
    [
      {
        time: 3.2,
        elements: [
          { id: "b2:w:0", role: "word", text: "Ready", box: [240, 440, 290, 120] },
          { id: "b2:w:0", role: "word", text: "Ready", box: [240, 440, 290, 120] }
        ]
      }
    ],
    beatIds
  );
  assert.ok("error" in dupCheck, "duplicate element ids in a snapshot must be rejected");
  assert.match(dupCheck.error, /Duplicate element id/i);

  // 6. validateBeatLayoutHint applied to set.scale before becoming hints.factor, and accumulated dx/dy capped at ±4000
  const sampleHtml = `<html><head><script>window.__hfVariables = {"plan":"{\\"beats\\":[{\\"id\\":\\"b2\\",\\"keyword\\":\\"Ready to share.\\"}]}"};</script><script id="hf-variables" type="application/json">{"b2.keyword":"Ready to share."}</script></head></html>`;
  const withOutOfBoundsScale = applyCandidatePatchToPreviewHtml(sampleHtml, [
    { scope: "scene", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { scale: 4.5 } }
  ]);
  assert.ok(!withOutOfBoundsScale.includes("4.5"), "out-of-bounds scale 4.5 must not become hints.factor");

  const withAccumulatedDx = applyCandidatePatchToPreviewHtml(sampleHtml, [
    { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { dx: 2500, dy: -2600 } },
    { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { dx: 2500, dy: -2600 } }
  ]);
  assert.ok(withAccumulatedDx.includes('"dx":4000'), "accumulated dx must be capped at +4000");
  assert.ok(withAccumulatedDx.includes('"dy":-4000'), "accumulated dy must be capped at -4000");

  // 7. Classifier: explicit scope="scene" with an el must NOT be downgraded to "element"
  const before = [makeBaseSnapshot(3.0), makeBaseSnapshot(3.4)];
  const explicitSceneWithEl = classifyEditPatch({
    patch: { scope: "scene", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { color: "#ff3b6b" } },
    canvas: CANVAS,
    beforeWindow: before,
    afterWindow: before
  });
  assert.equal(explicitSceneWithEl.scope, "scene", "explicit scope='scene' with el must remain 'scene'");
  assert.equal(explicitSceneWithEl.escalated, false);
  assert.equal(explicitSceneWithEl.reason, "explicit-scene-patch");

  // 8. Classifier: unequal before/after snapshot lengths must be refused (thrown), never silently truncated
  assert.throws(
    () =>
      classifyEditPatch({
        patch: { scope: "element", scene: "b2", atSeconds: 3.2, el: "b2:w:2", set: { color: "#ff3b6b" } },
        canvas: CANVAS,
        beforeWindow: [makeBaseSnapshot(3.0), makeBaseSnapshot(3.4)],
        afterWindow: [makeBaseSnapshot(3.0)]
      }),
    /equal length/i
  );
  assert.throws(
    () => checkSceneHintLayout([makeBaseSnapshot(3.0), makeBaseSnapshot(3.4)], CANVAS, "b2", [makeBaseSnapshot(3.0)]),
    /equal length/i
  );
});
