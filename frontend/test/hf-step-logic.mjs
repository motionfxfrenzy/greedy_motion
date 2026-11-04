import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorCommentAtTime,
  audioModeFromToggles,
  audioTogglesFromMode,
  groupCommentsByScene,
  hfAvailableAudioTracks,
  hfOptionsConfig,
  resolveVisibleOptions,
  sceneSpansFromBeatTimes,
  toggleAudioTrackMode
} from "../components/animation-workspace/logic.ts";

test("sceneSpansFromBeatTimes builds scene spans from composition beatTimes and falls back to equal slices", () => {
  const beats = [
    { id: "b1", keyword: "Launch in minutes" },
    { id: "b2", keyword: "Paste your brief" },
    { id: "b3", keyword: "Voice and music" },
    { id: "b4", keyword: "Preview in browser" },
    { id: "b5", keyword: "Render when ready" }
  ];
  const beatTimes = {
    b1: { start: 0, end: 3.5 },
    b2: { start: 3.5, end: 8.0 },
    b3: { start: 8.0, end: 12.2 },
    b4: { start: 12.2, end: 16.0 },
    b5: { start: 16.0, end: 20.0 }
  };

  const spans = sceneSpansFromBeatTimes(beats, beatTimes, 20);
  assert.equal(spans.length, 5);
  assert.deepEqual(spans[0], { index: 0, label: "Launch in minutes", start: 0, end: 3.5, duration: 3.5 });
  assert.deepEqual(spans[1], { index: 1, label: "Paste your brief", start: 3.5, end: 8.0, duration: 4.5 });
  assert.deepEqual(spans[4], { index: 4, label: "Render when ready", start: 16.0, end: 20.0, duration: 4.0 });

  // Fallback when beatTimes is undefined
  const equalSpans = sceneSpansFromBeatTimes(beats, undefined, 25);
  assert.equal(equalSpans.length, 5);
  assert.deepEqual(equalSpans[0], { index: 0, label: "Launch in minutes", start: 0, end: 5, duration: 5 });
  assert.deepEqual(equalSpans[4], { index: 4, label: "Render when ready", start: 20, end: 25, duration: 5 });

  // Fallback when beats array is empty
  const emptySpans = sceneSpansFromBeatTimes([], undefined, 15);
  assert.deepEqual(emptySpans, [{ index: 0, label: "Scene 1", start: 0, end: 15, duration: 15 }]);
});

test("groupCommentsByScene anchors, sorts, and merges timed comments per scene for onApplySceneComments", () => {
  const spans = sceneSpansFromBeatTimes(
    [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
    {
      b1: { start: 0, end: 4 },
      b2: { start: 4, end: 8 },
      b3: { start: 8, end: 12 }
    },
    12
  );

  // Out-of-order comments across scene 1 and scene 3
  const comments = [
    { at: 9.5, body: "Add more contrast to the CTA" },
    { at: 1.2, body: "Shorten the opening hook" },
    { at: 8.1, body: "Slow down the final zoom" },
    { at: 12.0, body: "Keep the logo visible longer" } // Clamps to end of scene 3 (index 2)
  ];

  assert.equal(anchorCommentAtTime(1.2, spans).scene, 0);
  assert.equal(anchorCommentAtTime(8.1, spans).scene, 2);
  assert.equal(anchorCommentAtTime(12.0, spans).scene, 2);

  const grouped = groupCommentsByScene(comments, spans);
  assert.deepEqual(grouped, [
    { line: 0, text: "Shorten the opening hook" },
    {
      line: 2,
      text: "Slow down the final zoom. Add more contrast to the CTA. Keep the logo visible longer"
    }
  ]);
});

test("hfAvailableAudioTracks and hfOptionsConfig expose only existing voice/music tracks and hide unsupported controls", () => {
  // Both voice and music generated
  const availBoth = hfAvailableAudioTracks({
    planAudio: {
      voice: { lines: [{ file: "vo/1.wav" }] },
      music: { file: "music/bed.wav" }
    }
  });
  assert.deepEqual(availBoth, { voice: true, music: true });
  const cfgBoth = hfOptionsConfig(availBoth);
  const visBoth = resolveVisibleOptions(cfgBoth);
  assert.equal(visBoth.showAudioTab, true);
  assert.deepEqual(visBoth.audioTracks, ["voice", "music"]);
  assert.equal(visBoth.showSubtitleTab, true);
  assert.deepEqual(visBoth.subtitleModes, ["none", "key-phrases", "full"]);
  assert.equal(visBoth.subtitleStyle, false);
  assert.equal(visBoth.subtitleSize, false);
  assert.equal(visBoth.subtitleColors, false);
  assert.equal(visBoth.subtitleOpacity, false);
  assert.equal(visBoth.subtitlePosition, false);

  // Only music generated (voice never generated)
  const availMusicOnly = hfAvailableAudioTracks({
    planAudio: {
      voice: null,
      music: { file: "music/bed.wav" }
    }
  });
  assert.deepEqual(availMusicOnly, { voice: false, music: true });
  const visMusicOnly = resolveVisibleOptions(hfOptionsConfig(availMusicOnly));
  assert.equal(visMusicOnly.showAudioTab, true);
  assert.deepEqual(visMusicOnly.audioTracks, ["music"]);

  // Neither voice nor music generated -> hides Audio tab completely
  const availNone = hfAvailableAudioTracks({ planAudio: null }, null);
  assert.deepEqual(availNone, { voice: false, music: false });
  const visNone = resolveVisibleOptions(hfOptionsConfig(availNone));
  assert.equal(visNone.showAudioTab, false);
  assert.deepEqual(visNone.audioTracks, []);
});

test("audioTogglesFromMode, audioModeFromToggles, and toggleAudioTrackMode map cleanly between UI chips and audio modes", () => {
  assert.deepEqual(audioTogglesFromMode("both"), { voice: true, music: true });
  assert.deepEqual(audioTogglesFromMode("voiceover"), { voice: true, music: false });
  assert.deepEqual(audioTogglesFromMode("music"), { voice: false, music: true });
  assert.deepEqual(audioTogglesFromMode("none"), { voice: false, music: false });

  // Respects track availability
  assert.deepEqual(audioTogglesFromMode("both", { voice: false, music: true }), {
    voice: false,
    music: true
  });

  assert.equal(audioModeFromToggles({ voice: true, music: true }), "both");
  assert.equal(audioModeFromToggles({ voice: true, music: false }), "voiceover");
  assert.equal(audioModeFromToggles({ voice: false, music: true }), "music");
  assert.equal(audioModeFromToggles({ voice: false, music: false }), "none");

  const bothAvail = { voice: true, music: true };
  assert.equal(toggleAudioTrackMode("both", "voice", bothAvail), "music");
  assert.equal(toggleAudioTrackMode("music", "voice", bothAvail), "both");
  assert.equal(toggleAudioTrackMode("both", "music", bothAvail), "voiceover");
  assert.equal(toggleAudioTrackMode("voiceover", "voice", bothAvail), "none");
  assert.equal(toggleAudioTrackMode("none", "music", bothAvail), "music");

  // Toggling a non-existent track is a no-op
  assert.equal(
    toggleAudioTrackMode("music", "voice", { voice: false, music: true }),
    "music"
  );
});
