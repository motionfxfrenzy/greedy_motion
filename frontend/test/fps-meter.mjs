import assert from "node:assert/strict";
import test from "node:test";
import {
  FPS_AMBER_THRESHOLD,
  FPS_NEUTRAL_THRESHOLD,
  FPS_PAUSE_HOLD_MS,
  FPS_TOOLTIP_TEXT,
  FPS_UI_THROTTLE_MS,
  FPS_WINDOW_MS,
  FpsMeterController,
  SLOW_HINT_MAX_DURATION_MS,
  SLOW_PLAYBACK_CONSECUTIVE_WINDOWS,
  SLOW_PLAYBACK_HINT_TEXT,
  SLOW_PLAYBACK_THRESHOLD,
  computeFpsWindow,
  createSlowPlaybackHintState,
  formatFps,
  formatMediaPerWall,
  fpsTone,
  isBelowRealTime,
  recordFpsSample,
  stepSlowPlaybackHint
} from "../components/animation-workspace/fps.ts";

test("window maths: steady 30 fps, steady 15 fps, a stall, and media advancing 0.17x", () => {
  // 1. Steady 30 fps over a 1 s window (30 frames presented in 1000 ms, media advancing 1.0 s)
  let samples30 = [];
  for (let i = 0; i <= 30; i++) {
    samples30 = recordFpsSample(samples30, {
      wallTimeMs: (i * 1000) / 30,
      presentedFrames: i,
      mediaTimeSec: i / 30
    });
  }
  const win30 = computeFpsWindow(samples30, 1000);
  assert.ok(win30);
  assert.equal(win30.fps, 30);
  assert.equal(win30.mediaPerWall, 1);
  assert.equal(win30.tone, "neutral");
  assert.equal(win30.belowRealTime, false);
  assert.equal(formatFps(win30.fps), "30.0 fps");

  // 2. Steady 15 fps over a 1 s window (15 frames presented in 1000 ms, media advancing 0.50 s)
  let samples15 = [];
  for (let i = 0; i <= 15; i++) {
    samples15 = recordFpsSample(samples15, {
      wallTimeMs: (i * 1000) / 15,
      presentedFrames: i,
      mediaTimeSec: (i * 0.5) / 15
    });
  }
  const win15 = computeFpsWindow(samples15, 1000);
  assert.ok(win15);
  assert.equal(win15.fps, 15);
  assert.equal(win15.mediaPerWall, 0.5);
  assert.equal(win15.tone, "amber");
  assert.equal(win15.belowRealTime, true);
  assert.equal(formatFps(win15.fps), "15.0 fps");
  assert.equal(formatMediaPerWall(win15.mediaPerWall), "0.50x");

  // 3. A stall: after playing 30 fps up to 1000 ms, no new frames arrive between 1000 ms and 2000 ms
  const stalledSilent = computeFpsWindow(samples30, 2000);
  assert.ok(stalledSilent);
  assert.equal(stalledSilent.fps, 0);
  assert.equal(stalledSilent.mediaPerWall, 0);
  assert.equal(stalledSilent.tone, "red");
  assert.equal(stalledSilent.belowRealTime, true);

  // Also test a stall where a polled sample arrives at 2000 ms with unchanged presentedFrames = 30
  const stalledPolledSamples = recordFpsSample(samples30, {
    wallTimeMs: 2000,
    presentedFrames: 30,
    mediaTimeSec: 1
  });
  const stalledPolled = computeFpsWindow(stalledPolledSamples, 2000);
  assert.ok(stalledPolled);
  assert.equal(stalledPolled.fps, 0);
  assert.equal(stalledPolled.mediaPerWall, 0);
  assert.equal(stalledPolled.tone, "red");

  // 4. Heavy-load case from the brief: 1.7 fps with media time advancing 0.17x
  const heavyLoadSamples = [
    { wallTimeMs: 0, presentedFrames: 10, mediaTimeSec: 1.0 },
    { wallTimeMs: 1000, presentedFrames: 11.7, mediaTimeSec: 1.17 }
  ];
  const winHeavy = computeFpsWindow(heavyLoadSamples, 1000);
  assert.ok(winHeavy);
  assert.equal(winHeavy.fps, 1.7);
  assert.equal(winHeavy.mediaPerWall, 0.17);
  assert.equal(winHeavy.tone, "red");
  assert.equal(winHeavy.belowRealTime, true);
  assert.equal(formatFps(winHeavy.fps), "1.7 fps");
  assert.equal(formatMediaPerWall(winHeavy.mediaPerWall), "0.17x");

  // Also test the 25.4 fps (0.86x) measurement from the brief
  const mediumLoadSamples = [
    { wallTimeMs: 0, presentedFrames: 0, mediaTimeSec: 0 },
    { wallTimeMs: 1000, presentedFrames: 25.4, mediaTimeSec: 0.86 }
  ];
  const winMedium = computeFpsWindow(mediumLoadSamples, 1000);
  assert.ok(winMedium);
  assert.equal(winMedium.fps, 25.4);
  assert.equal(winMedium.mediaPerWall, 0.86);
  assert.equal(winMedium.tone, "amber");
  assert.equal(winMedium.belowRealTime, true);
  assert.equal(formatFps(winMedium.fps), "25.4 fps");
  assert.equal(formatMediaPerWall(winMedium.mediaPerWall), "0.86x");
});

test("colour thresholds: >= 27 neutral, 15 to 27 amber, < 15 red", () => {
  assert.equal(FPS_NEUTRAL_THRESHOLD, 27);
  assert.equal(FPS_AMBER_THRESHOLD, 15);

  assert.equal(fpsTone(30), "neutral");
  assert.equal(fpsTone(29.8), "neutral");
  assert.equal(fpsTone(27), "neutral");

  assert.equal(fpsTone(26.9), "amber");
  assert.equal(fpsTone(25.4), "amber");
  assert.equal(fpsTone(22.5), "amber");
  assert.equal(fpsTone(15), "amber");

  assert.equal(fpsTone(14.9), "red");
  assert.equal(fpsTone(1.7), "red");
  assert.equal(fpsTone(0), "red");

  assert.equal(isBelowRealTime(1.0, 30), false);
  assert.equal(isBelowRealTime(0.99, 29.8), false);
  assert.equal(isBelowRealTime(0.86, 25.4), true);
  assert.equal(isBelowRealTime(0.17, 1.7), true);
});

test("throttling: updates UI at most 2 times per second (every >= 500 ms)", () => {
  assert.equal(FPS_WINDOW_MS, 1000);
  assert.equal(FPS_UI_THROTTLE_MS, 500);

  const ctrl = new FpsMeterController();
  ctrl.setPlaybackState({ playing: true, buffering: false, source: "clip", sceneKey: 0, nowMs: 0 });

  // Feed 60 frame callbacks over 2000 ms (30 fps = every 33.33 ms)
  let changedCount = 0;
  for (let i = 0; i <= 60; i++) {
    const t = Math.round((i * 1000) / 30);
    const res = ctrl.recordSample({
      wallTimeMs: t,
      presentedFrames: i,
      mediaTimeSec: i / 30
    });
    if (res.changed) {
      changedCount += 1;
    }
  }

  // Over a 2.0 s span, at most 2 updates per second (<= 4 total UI updates)
  assert.ok(ctrl.uiUpdateCount <= 4, `expected <= 4 UI updates over 2s, got ${ctrl.uiUpdateCount}`);
  assert.ok(changedCount <= 4, `expected <= 4 state changes over 2s, got ${changedCount}`);

  // Within a single 1000 ms window (from t = 1001 ms to t = 2000 ms), count updates
  const updatesAt1s = ctrl.uiUpdateCount;
  for (let i = 61; i <= 90; i++) {
    const t = Math.round((i * 1000) / 30);
    ctrl.recordSample({
      wallTimeMs: t,
      presentedFrames: i,
      mediaTimeSec: i / 30
    });
  }
  const updatesInOneSecond = ctrl.uiUpdateCount - updatesAt1s;
  assert.ok(updatesInOneSecond <= 2, `expected <= 2 UI updates in 1s, got ${updatesInOneSecond}`);

  const snap = ctrl.getActiveReading();
  assert.ok(snap);
  assert.equal(snap.fpsText, "30.0 fps");
  assert.equal(snap.source, "clip");
  assert.equal(snap.tone, "neutral");
  assert.equal(snap.showRate, false);
  assert.equal(snap.tooltipText, FPS_TOOLTIP_TEXT);
});

test("warning hint rule: 3 consecutive slow windows (< 0.9x), first 10 s only, dismissible by pausing", () => {
  assert.equal(SLOW_PLAYBACK_THRESHOLD, 0.9);
  assert.equal(SLOW_PLAYBACK_CONSECUTIVE_WINDOWS, 3);
  assert.equal(SLOW_HINT_MAX_DURATION_MS, 10_000);
  assert.equal(SLOW_PLAYBACK_HINT_TEXT, "Playing slower than real time: this device is busy");

  // 1. Pure state machine: 2 slow windows then 1 normal window resets streak and does not show hint
  let hint = createSlowPlaybackHintState();
  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.75, windowCompleted: true, nowMs: 1000 });
  assert.equal(hint.slowWindowStreak, 1);
  assert.equal(hint.hintVisible, false);

  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.85, windowCompleted: true, nowMs: 2000 });
  assert.equal(hint.slowWindowStreak, 2);
  assert.equal(hint.hintVisible, false);

  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.95, windowCompleted: true, nowMs: 3000 });
  assert.equal(hint.slowWindowStreak, 0);
  assert.equal(hint.hintVisible, false);

  // 2. 3 consecutive windows with mediaPerWall < 0.9 triggers the hint on window 3
  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.86, windowCompleted: true, nowMs: 4000 });
  assert.equal(hint.hintVisible, false);
  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.75, windowCompleted: true, nowMs: 5000 });
  assert.equal(hint.hintVisible, false);
  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.17, windowCompleted: true, nowMs: 6000 });
  assert.equal(hint.slowWindowStreak, 3);
  assert.equal(hint.hintVisible, true);
  assert.equal(hint.hintShownAtMs, 6000);

  // Still visible at +9.9 s (first 10 s), auto-hides at +10.0 s
  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.5, windowCompleted: true, nowMs: 15_900 });
  assert.equal(hint.hintVisible, true);
  hint = stepSlowPlaybackHint(hint, { playing: true, mediaPerWall: 0.5, windowCompleted: true, nowMs: 16_000 });
  assert.equal(hint.hintVisible, false);
  assert.equal(hint.hintDismissed, true);

  // 3. End-to-end controller test: 3 consecutive 1 s windows at 0.5x triggers hint, and pausing dismisses it immediately
  const ctrl = new FpsMeterController();
  ctrl.setPlaybackState({ playing: true, buffering: false, source: "live", sceneKey: 0, nowMs: 0 });

  // Feed 15 fps / 0.5x media over 3 seconds (t = 0..3000 ms)
  for (let step = 0; step <= 30; step++) {
    const t = step * 100; // every 100 ms
    const frames = Math.round(step * 1.5); // 15 fps
    const mediaSec = step * 0.05; // 0.5x media time
    ctrl.recordSample({ wallTimeMs: t, presentedFrames: frames, mediaTimeSec: mediaSec });
  }

  const snapAt3s = ctrl.getActiveReading();
  assert.ok(snapAt3s);
  assert.equal(snapAt3s.source, "live");
  assert.equal(snapAt3s.showRate, true);
  assert.equal(snapAt3s.rateText, "0.50x");
  assert.equal(snapAt3s.showHint, true);
  assert.equal(snapAt3s.hintText, "Playing slower than real time: this device is busy");

  // Pausing dismisses the hint immediately while holding the chip for 2 s
  const pauseRes = ctrl.setPlaybackState({ playing: false, nowMs: 3100 });
  assert.ok(pauseRes.snapshot, "chip remains visible during the 2 s post-pause hold");
  assert.equal(pauseRes.snapshot.showHint, false, "hint is dismissed immediately on pause");
  assert.equal(pauseRes.snapshot.hintText, null);
});

test("no output while paused or buffering, and 2 s post-pause chip hold expiry", () => {
  // 1. computeFpsWindow returns null when paused or buffering
  const samples = [
    { wallTimeMs: 0, presentedFrames: 0, mediaTimeSec: 0 },
    { wallTimeMs: 1000, presentedFrames: 30, mediaTimeSec: 1 }
  ];
  assert.equal(computeFpsWindow(samples, 1000, { paused: true }), null);
  assert.equal(computeFpsWindow(samples, 1000, { buffering: true }), null);

  // 2. Controller while initially paused produces no output even if samples are passed
  const ctrl = new FpsMeterController();
  ctrl.setPlaybackState({ playing: false, buffering: false, source: "clip", sceneKey: 0, nowMs: 0 });
  for (let i = 0; i <= 30; i++) {
    const res = ctrl.recordSample({
      wallTimeMs: i * 33.33,
      presentedFrames: i,
      mediaTimeSec: i / 30
    });
    assert.equal(res.snapshot, null);
  }
  assert.equal(ctrl.getActiveReading(), null);
  assert.equal(ctrl.getDisplaySnapshot(1000), null);
  assert.equal(ctrl.uiUpdateCount, 0);

  // 3. Play for 1 s -> reading is present -> pause -> active reading is immediately null, display holds for 2 s then becomes null
  ctrl.setPlaybackState({ playing: true, buffering: false, source: "clip", sceneKey: 0, nowMs: 2000 });
  ctrl.recordSample({ wallTimeMs: 2000, presentedFrames: 0, mediaTimeSec: 0 });
  ctrl.recordSample({ wallTimeMs: 3000, presentedFrames: 30, mediaTimeSec: 1 });
  assert.ok(ctrl.getActiveReading());
  assert.equal(ctrl.getActiveReading().fps, 30);

  ctrl.setPlaybackState({ playing: false, nowMs: 3000 });
  assert.equal(ctrl.getActiveReading(), null, "no active reading while paused");
  assert.ok(ctrl.getDisplaySnapshot(3000 + FPS_PAUSE_HOLD_MS - 100), "held within 2 s of pausing");
  assert.equal(ctrl.tick(3000 + FPS_PAUSE_HOLD_MS).snapshot, null, "cleared at 2 s after pausing");

  // 4. Buffering while playing shows nothing immediately
  ctrl.setPlaybackState({ playing: true, buffering: false, source: "clip", sceneKey: 0, nowMs: 6000 });
  ctrl.recordSample({ wallTimeMs: 6000, presentedFrames: 0, mediaTimeSec: 0 });
  ctrl.recordSample({ wallTimeMs: 7000, presentedFrames: 30, mediaTimeSec: 1 });
  assert.ok(ctrl.getDisplaySnapshot(7000));

  const bufRes = ctrl.setPlaybackState({ playing: true, buffering: true, source: "clip", sceneKey: 0, nowMs: 7100 });
  assert.equal(bufRes.snapshot, null);
  assert.equal(ctrl.getActiveReading(), null);
  assert.equal(ctrl.getDisplaySnapshot(7100), null);
});
