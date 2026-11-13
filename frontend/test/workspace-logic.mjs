import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeSubtitleCueAt,
  affectedScenesSummary,
  splitCommentsByStatus,
  anchorCommentAtTime,
  buildSubtitleCues,
  formatClock,
  mapSceneTabState,
  plateOptionsConfig,
  resolveVisibleOptions,
  sceneSpansFromDurations,
  sortWorkspaceComments
} from "../components/animation-workspace/logic.ts";
import {
  PLATE_CONFIRM_FALSE_DELAY_MS,
  PLATE_FALLBACK_NOTICE,
  nextPlateAnswer,
  plateRetryDelayMs,
  resolvePlateRouting
} from "../lib/plate-availability.ts";

test("formatClock formats M:SS and clamps negative or invalid values", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(3.9), "0:03");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(-5), "0:00");
  assert.equal(formatClock(NaN), "0:00");
});

test("sceneSpansFromDurations and anchorCommentAtTime map timestamps to scene index and local offset", () => {
  const spans = sceneSpansFromDurations([4, 5, 4, 5, 4]);
  assert.equal(spans.length, 5);
  assert.deepEqual(spans[0], { index: 0, start: 0, end: 4, duration: 4 });
  assert.deepEqual(spans[1], { index: 1, start: 4, end: 9, duration: 5 });
  assert.deepEqual(spans[4], { index: 4, start: 18, end: 22, duration: 4 });

  // Start of film
  assert.deepEqual(anchorCommentAtTime(0, spans), { at: 0, scene: 0, sceneAt: 0 });
  // Negative time clamps to 0
  assert.deepEqual(anchorCommentAtTime(-2, spans), { at: 0, scene: 0, sceneAt: 0 });
  // Inside scene 1 (index 0)
  assert.deepEqual(anchorCommentAtTime(3.25, spans), { at: 3.25, scene: 0, sceneAt: 3.25 });
  // Exact boundary at 4.0s lands on scene 2 (index 1) at offset 0
  assert.deepEqual(anchorCommentAtTime(4.0, spans), { at: 4, scene: 1, sceneAt: 0 });
  // Inside scene 2 (index 1)
  assert.deepEqual(anchorCommentAtTime(6.4, spans), { at: 6.4, scene: 1, sceneAt: 2.4 });
  // Past end of film clamps to total - 0.05 (21.95s) in the last scene (index 4)
  assert.deepEqual(anchorCommentAtTime(30, spans), { at: 21.95, scene: 4, sceneAt: 3.95 });
  // Empty spans
  assert.deepEqual(anchorCommentAtTime(5, []), { at: 0, scene: 0, sceneAt: 0 });
});

test("sortWorkspaceComments and affectedScenesSummary compute sorted list and button labels", () => {
  const raw = [
    { id: "c2", at: 7.5, scene: 1, body: "Second" },
    { id: "c1", at: 1.2, scene: 0, body: "First" },
    { id: "c3", at: 8.1, scene: 1, body: "Third in same scene" }
  ];
  const sorted = sortWorkspaceComments(raw);
  assert.deepEqual(
    sorted.map((c) => c.id),
    ["c1", "c2", "c3"]
  );
  assert.equal(raw[0].id, "c2", "does not mutate input array");

  assert.deepEqual(affectedScenesSummary([]), {
    scenes: [],
    numbersText: "",
    label: "Redraw with comments"
  });
  assert.deepEqual(affectedScenesSummary([{ scene: 2 }]), {
    scenes: [3],
    numbersText: "3",
    label: "Redraw scene 3"
  });
  assert.deepEqual(affectedScenesSummary(sorted), {
    scenes: [1, 2],
    numbersText: "1, 2",
    label: "Redraw scenes 1, 2"
  });
  assert.deepEqual(affectedScenesSummary(sorted, { busy: true }), {
    scenes: [1, 2],
    numbersText: "1, 2",
    label: "Drawing…"
  });
  assert.deepEqual(affectedScenesSummary(sorted, { actionVerb: "Update", emptyLabel: "Apply comments" }), {
    scenes: [1, 2],
    numbersText: "1, 2",
    label: "Update scenes 1, 2"
  });
});

test("mapSceneTabState normalizes engine and workspace states into ready, updating, and needs-update", () => {
  assert.deepEqual(mapSceneTabState("drawn"), {
    visualState: "ready",
    cssClass: "drawn",
    label: "Drawn"
  });
  assert.deepEqual(mapSceneTabState("ready"), {
    visualState: "ready",
    cssClass: "ready",
    label: "Ready"
  });
  assert.deepEqual(mapSceneTabState("checked"), {
    visualState: "ready",
    cssClass: "ready",
    label: "Ready"
  });
  assert.deepEqual(mapSceneTabState("queued"), {
    visualState: "updating",
    cssClass: "queued",
    label: "Waiting"
  });
  assert.deepEqual(mapSceneTabState("authoring"), {
    visualState: "updating",
    cssClass: "authoring",
    label: "Writing the scene"
  });
  assert.deepEqual(mapSceneTabState("rendering"), {
    visualState: "updating",
    cssClass: "rendering",
    label: "Drawing"
  });
  assert.deepEqual(mapSceneTabState("updating"), {
    visualState: "updating",
    cssClass: "updating",
    label: "Updating"
  });
  assert.deepEqual(mapSceneTabState("failed"), {
    visualState: "needs-update",
    cssClass: "failed",
    label: "Failed"
  });
  assert.deepEqual(mapSceneTabState("needs-update"), {
    visualState: "needs-update",
    cssClass: "needs-update",
    label: "Needs update"
  });
});

test("resolveVisibleOptions hides unsupported engine options instead of disabling them", () => {
  // Default (plates): all audio tracks and subtitle controls visible
  const full = resolveVisibleOptions();
  assert.equal(full.showAudioTab, true);
  assert.deepEqual(full.audioTracks, ["voice", "music", "sfx", "transitions"]);
  assert.equal(full.showSubtitleTab, true);
  assert.deepEqual(full.subtitleModes, ["none", "key-phrases", "full"]);
  assert.equal(full.subtitleStyle, true);
  assert.equal(full.subtitleSize, true);
  assert.equal(full.subtitleColors, true);
  assert.equal(full.subtitleOpacity, true);
  assert.equal(full.subtitlePosition, true);
  assert.equal(full.previewQuality, true);
  assert.equal(full.motionBlur, true);

  // Plate config hides motionBlur while keeping default capabilities
  const plate = resolveVisibleOptions(plateOptionsConfig());
  assert.equal(plate.motionBlur, false);

  // HyperFrames-style subset: only voice/music and subtitle mode (no style/size/colors/opacity/position)
  const hf = resolveVisibleOptions({
    audioTracks: ["voice", "music"],
    subtitleModes: ["none", "key-phrases"],
    subtitleStyle: false,
    subtitleSize: false,
    subtitleColors: false,
    subtitleOpacity: false,
    subtitlePosition: false
  });
  assert.equal(hf.showAudioTab, true);
  assert.deepEqual(hf.audioTracks, ["voice", "music"]);
  assert.equal(hf.showSubtitleTab, true);
  assert.deepEqual(hf.subtitleModes, ["none", "key-phrases"]);
  assert.equal(hf.subtitleStyle, false);
  assert.equal(hf.subtitleSize, false);
  assert.equal(hf.subtitleColors, false);
  assert.equal(hf.subtitleOpacity, false);
  assert.equal(hf.subtitlePosition, false);

  // Engine with no subtitle support hides the entire subtitle tab and all sub-controls
  const noSubs = resolveVisibleOptions({ subtitleModes: [] });
  assert.equal(noSubs.showSubtitleTab, false);
  assert.equal(noSubs.subtitleStyle, false);
  assert.equal(noSubs.subtitleSize, false);
});

test("buildSubtitleCues and activeSubtitleCueAt chunk full lines and select active cue", () => {
  const scenes = [
    { seconds: 4, keyword: "Scene one" },
    { seconds: 4, keyword: "Scene two" }
  ];
  const beats = [
    { keyword: "Scene one", onScreen: "Hold the light", line: "One two three four five six seven eight" },
    { keyword: "Scene two", onScreen: "Follow trail", line: "Short second line" }
  ];
  const starts = [0, 4];
  const durations = [4, 4];

  assert.deepEqual(buildSubtitleCues("none", scenes, beats, starts, durations), []);

  const keyCues = buildSubtitleCues("key-phrases", scenes, beats, starts, durations);
  assert.equal(keyCues.length, 2);
  assert.equal(keyCues[0].text, "Hold the light");
  assert.equal(keyCues[1].text, "Follow trail");

  const fullCues = buildSubtitleCues("full", scenes, beats, starts, durations);
  assert.equal(fullCues.length, 3);
  assert.equal(fullCues[0].text, "One two three four five six");
  assert.equal(fullCues[1].text, "seven eight");
  assert.equal(fullCues[2].text, "Short second line");

  assert.equal(activeSubtitleCueAt("full", fullCues, 0.5, 0)?.text, "One two three four five six");
  assert.equal(activeSubtitleCueAt("full", fullCues, 3.5, 0)?.text, "seven eight");
  assert.equal(activeSubtitleCueAt("full", fullCues, 4.5, 1)?.text, "Short second line");
  assert.equal(activeSubtitleCueAt("none", fullCues, 0.5, 0), null);
});

test("nextPlateAnswer and resolvePlateRouting: errors keep unknown, available:true is known true, available:false requires non-plate look or 2 confirmations for plate looks", () => {
  const id = "324093f5-0000-4000-8000-000000000001";

  // 1. Error / 401 / timeout keeps answer unknown (never caches available:false)
  const afterErr = nextPlateAnswer(null, id, { ok: false, error: new Error("401") }, "illus-folk-tale");
  assert.equal(afterErr, null, "transient error on unknown state stays null (unknown)");
  assert.deepEqual(resolvePlateRouting(true, id, afterErr), {
    plateKnown: false,
    isPlateStyle: false,
    plateChecking: true
  });

  // 2. Success { available: true } -> immediately known true
  const afterTrue = nextPlateAnswer(afterErr, id, { ok: true, available: true, look: "illus-folk-tale" }, "illus-folk-tale");
  assert.deepEqual(afterTrue, { id, available: true, falseCount: 0 });
  assert.deepEqual(resolvePlateRouting(true, id, afterTrue), {
    plateKnown: true,
    isPlateStyle: true,
    plateChecking: false
  });

  // Transient error after already known true preserves the known true state for the same project
  const errAfterTrue = nextPlateAnswer(afterTrue, id, { ok: false }, "illus-folk-tale");
  assert.deepEqual(errAfterTrue, { id, available: true, falseCount: 0 });

  // 3. Non-plate look with { available: false } -> trusted immediately on first response
  const nonPlateFalse = nextPlateAnswer(null, id, { ok: true, available: false, look: "clean" }, "clean");
  assert.deepEqual(nonPlateFalse, { id, available: false, falseCount: 1 });
  assert.deepEqual(resolvePlateRouting(false, id, nonPlateFalse), {
    plateKnown: true,
    isPlateStyle: false,
    plateChecking: false
  });

  // 4. Plate look (`illus-*`) with { available: false }:
  //    First false -> stays unknown (`available: null, falseCount: 1`), `plateChecking` stays true
  const firstFalse = nextPlateAnswer(null, id, { ok: true, available: false, look: null }, "illus-folk-tale");
  assert.deepEqual(firstFalse, { id, available: null, falseCount: 1 });
  assert.deepEqual(resolvePlateRouting(true, id, firstFalse), {
    plateKnown: false,
    isPlateStyle: false,
    plateChecking: true
  });

  //    If an error happens between first and second false, it stays unknown with falseCount: 1
  const errBetween = nextPlateAnswer(firstFalse, id, { ok: false }, "illus-folk-tale");
  assert.deepEqual(errBetween, { id, available: null, falseCount: 1 });
  assert.equal(resolvePlateRouting(true, id, errBetween).plateChecking, true);

  //    If the second check 2s later returns { available: true } (brief.look now saved), it resolves to known true!
  const recoveredTrue = nextPlateAnswer(errBetween, id, { ok: true, available: true, look: "illus-folk-tale" }, "illus-folk-tale");
  assert.deepEqual(recoveredTrue, { id, available: true, falseCount: 0 });
  assert.deepEqual(resolvePlateRouting(true, id, recoveredTrue), {
    plateKnown: true,
    isPlateStyle: true,
    plateChecking: false
  });

  //    If the second check 2s later ALSO returns { available: false }, it is confirmed false
  const secondFalse = nextPlateAnswer(firstFalse, id, { ok: true, available: false, look: "illus-folk-tale" }, "illus-folk-tale");
  assert.deepEqual(secondFalse, { id, available: false, falseCount: 2 });
  assert.deepEqual(resolvePlateRouting(true, id, secondFalse), {
    plateKnown: true,
    isPlateStyle: false,
    plateChecking: false
  });

  // 5. Switching project ID resets state for the new project
  const otherId = "other-project-id";
  assert.deepEqual(resolvePlateRouting(true, otherId, secondFalse), {
    plateKnown: false,
    isPlateStyle: false,
    plateChecking: true
  });

  // 6. Backoff schedule: 1s, 2s, 4s, capped at 8s, stops at 120s
  assert.equal(PLATE_CONFIRM_FALSE_DELAY_MS, 2_000);
  assert.equal(plateRetryDelayMs(0, 0), 1_000);
  assert.equal(plateRetryDelayMs(1, 1_000), 2_000);
  assert.equal(plateRetryDelayMs(2, 3_000), 4_000);
  assert.equal(plateRetryDelayMs(3, 7_000), 8_000);
  assert.equal(plateRetryDelayMs(4, 15_000), 8_000);
  assert.equal(plateRetryDelayMs(5, 120_000), null);
  assert.equal(
    PLATE_FALLBACK_NOTICE,
    "This is a quick preview. Your styled scenes aren't drawn in this setup."
  );
});

test("splitCommentsByStatus: applied comments leave the open list, the count and the redraw button", () => {
  const all = [
    { id: "a", at: 5, scene: 1, body: "show the logo in the box", appliedLabel: "re-laid out the scene", appliedScope: "scene" },
    { id: "b", at: 43, scene: 12, body: "show the logo here", appliedLabel: "re-laid out the scene", appliedScope: "scene" },
    { id: "c", at: 50, scene: 13, body: "bigger", refusedReason: "Can't do that" }
  ];
  const { pending, applied } = splitCommentsByStatus(all);
  assert.deepEqual(pending.map((c) => c.id), ["c"], "a refused comment stays open");
  assert.deepEqual(applied.map((c) => c.id), ["a", "b"]);
  // After a redraw answered every comment nothing is open: empty list, no pending scenes, button idle.
  const afterRedraw = splitCommentsByStatus(all.slice(0, 2));
  assert.equal(afterRedraw.pending.length, 0);
  assert.equal(afterRedraw.applied.length, 2);
  assert.deepEqual(affectedScenesSummary(all.slice(0, 2)).scenes, [], "no pending scenes");
  assert.equal(affectedScenesSummary(all.slice(0, 2)).label, "Redraw with comments");
  assert.deepEqual(splitCommentsByStatus([]), { pending: [], applied: [] });
});
