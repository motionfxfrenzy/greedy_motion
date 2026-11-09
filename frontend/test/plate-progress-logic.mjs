import assert from "node:assert/strict";
import test from "node:test";
import {
  BUFFERING_SHOW_DELAY_MS,
  BUFFERING_WINDOW_MS,
  CLIP_RENDER_SECONDS_PER_FRAME,
  DEFAULT_TYPICAL_WRITE_SECONDS,
  LIVE_TEXT_THROTTLE_MS,
  RENDER_CONFIRM_MODAL_TITLE,
  TAKING_LONGER_NOTE,
  WATCHED_END_THRESHOLD_SECONDS,
  WATCHED_MIN_LAST_SCENE_PLAY_SECONDS,
  WRITE_PARALLEL,
  bufferingCause,
  buildFilmProgressToast,
  buildRenderConfirmReasons,
  buildStagePrepProps,
  buildUnreadySceneBanner,
  capitalizeReason,
  computeClipPreparationEta,
  computeFilmVersionKey,
  computeServerOffset,
  createWatchedTrackerState,
  estimateBufferingResume,
  estimateClipRenderSeconds,
  filmProgress,
  formatElapsed,
  formatEta,
  formatEtaBrief,
  formatEtaCompact,
  formatFilmButtonProgress,
  formatRetryingSceneText,
  formatSceneStatusText,
  isSceneWorkingState,
  measureTypicalClipRenderSeconds,
  measureTypicalWriteSeconds,
  recordBufferingSample,
  sceneProgress,
  stepThrottledLiveText,
  updateWatchedState
} from "../components/animation-workspace/progress.ts";

function makeScene(overrides = {}) {
  return {
    index: 0,
    keyword: "Lantern in the mist",
    state: "queued",
    seconds: 4,
    frames: 120,
    framesDone: null,
    sig: "sig-0",
    rev: 0,
    ...overrides
  };
}

test("WRITE_PARALLEL is 2 and default typical write time is 180s", () => {
  assert.equal(WRITE_PARALLEL, 2);
  assert.equal(DEFAULT_TYPICAL_WRITE_SECONDS, 180);
});

test("sceneProgress table tests for every state mapping", () => {
  const baseNow = Date.parse("2026-11-07T12:01:00.000Z");
  const sinceIso = "2026-11-07T12:00:00.000Z"; // 60s ago

  const cases = [
    {
      name: "queued -> waiting",
      scene: makeScene({ state: "queued", updatedAt: sinceIso }),
      isLiveMode: false,
      expectedPhase: "waiting",
      expectedLabel: "Waiting in queue",
      expectedChip: "Waiting",
      expectedMeaning: "Queued behind earlier scenes",
      expectedFraction: 0
    },
    {
      name: "authoring -> writing",
      scene: makeScene({ state: "authoring", updatedAt: sinceIso }),
      isLiveMode: false,
      expectedPhase: "writing",
      expectedLabel: "Writing the scene",
      expectedChip: "Writing 33%",
      expectedMeaning: "Writing the scene's drawing code",
      expectedFraction: 60 / 180
    },
    {
      name: "bundled -> checking",
      scene: makeScene({ state: "bundled", updatedAt: sinceIso }),
      isLiveMode: true,
      expectedPhase: "checking",
      expectedLabel: "Checking",
      expectedChip: "Checking",
      expectedMeaning: "Checking it draws correctly",
      expectedFraction: null
    },
    {
      name: "checked but not live -> checking",
      scene: makeScene({ state: "checked", live: false, updatedAt: sinceIso }),
      isLiveMode: false,
      expectedPhase: "checking",
      expectedLabel: "Checking",
      expectedChip: "Checking",
      expectedMeaning: "Checking it draws correctly",
      expectedFraction: null
    },
    {
      name: "rendering with frames -> drawing",
      scene: makeScene({ state: "rendering", frames: 120, framesDone: 42, updatedAt: sinceIso }),
      isLiveMode: false,
      expectedPhase: "drawing",
      expectedLabel: "Drawing the scene",
      expectedChip: "Drawing 42/120",
      expectedMeaning: "Drawing frames 42/120",
      expectedFraction: 42 / 120
    },
    {
      name: "drawn -> ready",
      scene: makeScene({ state: "drawn", updatedAt: sinceIso }),
      isLiveMode: false,
      expectedPhase: "ready",
      expectedLabel: "Ready",
      expectedChip: "Ready",
      expectedMeaning: "Ready to play",
      expectedFraction: 1
    },
    {
      name: "live and checked -> ready",
      scene: makeScene({ state: "checked", live: true, updatedAt: sinceIso }),
      isLiveMode: true,
      expectedPhase: "ready",
      expectedLabel: "Ready",
      expectedChip: "Ready",
      expectedMeaning: "Ready to play",
      expectedFraction: 1
    },
    {
      name: "failed -> failed",
      scene: makeScene({ state: "failed", error: "Timed out while drawing" }),
      isLiveMode: false,
      expectedPhase: "failed",
      expectedLabel: "Failed",
      expectedChip: "Failed",
      expectedMeaning: "Timed out while drawing",
      expectedFraction: null
    }
  ];

  for (const tc of cases) {
    const res = sceneProgress(tc.scene, null, {
      nowClient: baseNow,
      isLiveMode: tc.isLiveMode,
      scenes: [tc.scene]
    });
    assert.equal(res.phase, tc.expectedPhase, `${tc.name}: phase`);
    assert.equal(res.label, tc.expectedLabel, `${tc.name}: label`);
    assert.equal(res.chipLabel, tc.expectedChip, `${tc.name}: chipLabel`);
    assert.equal(res.meaning, tc.expectedMeaning, `${tc.name}: meaning`);
    if (tc.expectedFraction === null) {
      assert.equal(res.fraction, null, `${tc.name}: fraction is null`);
    } else {
      assert.ok(
        Math.abs((res.fraction ?? -1) - tc.expectedFraction) < 1e-6,
        `${tc.name}: fraction ${res.fraction} ~= ${tc.expectedFraction}`
      );
    }
    if (tc.expectedPhase === "ready" || tc.expectedPhase === "failed") {
      assert.equal(res.elapsedMs, null, `${tc.name}: elapsedMs null`);
      assert.equal(res.etaSeconds, null, `${tc.name}: etaSeconds null`);
    } else {
      assert.equal(res.elapsedMs, 60_000, `${tc.name}: elapsedMs is 60000`);
      assert.ok(res.etaSeconds && res.etaSeconds.low <= res.etaSeconds.high, `${tc.name}: eta range valid`);
    }
  }
});

test("writing fraction is clamped between 0.03 and 0.95", () => {
  const now = Date.parse("2026-11-07T12:10:00.000Z");
  // Just started (0s elapsed) -> clamped to 0.03
  const justStarted = sceneProgress(
    makeScene({ state: "authoring", updatedAt: "2026-11-07T12:10:00.000Z" }),
    null,
    { nowClient: now }
  );
  assert.equal(justStarted.fraction, 0.03);
  assert.equal(justStarted.chipLabel, "Writing 3%");

  // Long running (500s elapsed vs 180s typical) -> clamped to 0.95, remaining floored at 10s
  const longRunning = sceneProgress(
    makeScene({ state: "authoring", updatedAt: "2026-11-07T12:00:00.000Z" }),
    null,
    { nowClient: now }
  );
  assert.equal(longRunning.fraction, 0.95);
  assert.equal(longRunning.chipLabel, "Writing 95%");
  assert.deepEqual(longRunning.etaSeconds, { low: 10, high: 20 });
});

test("clock skew offset and never-negative elapsed time", () => {
  const serverNow = "2026-11-07T12:05:00.000Z";
  // Client clock is 2 minutes behind server
  const clientAtFetch = Date.parse("2026-11-07T12:03:00.000Z");
  const offset = computeServerOffset(serverNow, clientAtFetch);
  assert.equal(offset, 120_000);

  // Scene updated 30s before serverNow ("12:04:30Z"), client is now 5s after fetch ("12:03:05Z")
  // Aligned now = 12:05:05Z -> elapsed = 35s
  const scene = makeScene({ state: "authoring", updatedAt: "2026-11-07T12:04:30.000Z" });
  const res = sceneProgress(scene, null, {
    nowClient: clientAtFetch + 5_000,
    serverNow,
    clientNowAtFetch: clientAtFetch
  });
  assert.equal(res.elapsedMs, 35_000);

  // Future updatedAt (e.g. slight jitter) -> never negative, clamped to 0
  const futureScene = makeScene({ state: "authoring", updatedAt: "2026-11-07T12:06:00.000Z" });
  const resFuture = sceneProgress(futureScene, null, {
    nowClient: clientAtFetch,
    serverNow,
    clientNowAtFetch: clientAtFetch
  });
  assert.equal(resFuture.elapsedMs, 0);

  // Unknown updatedAt falls back to browser firstSeenAt
  const noTimestampScene = makeScene({ index: 2, state: "authoring" });
  const resFallback = sceneProgress(noTimestampScene, null, {
    nowClient: clientAtFetch + 18_000,
    serverNow,
    clientNowAtFetch: clientAtFetch,
    firstSeenAt: { "2:writing": Date.parse(serverNow) }
  });
  assert.equal(resFallback.elapsedMs, 18_000);
});

test("ETA with and without finished scene history, and concurrency WRITE_PARALLEL = 2", () => {
  const now = Date.parse("2026-11-07T12:02:00.000Z");
  const oneMinAgo = "2026-11-07T12:01:00.000Z";

  // Without history: default typical = 180s
  const scenesNoHistory = [
    makeScene({ index: 0, state: "authoring", updatedAt: oneMinAgo }), // 60s elapsed -> 120s left
    makeScene({ index: 1, state: "authoring", updatedAt: oneMinAgo }), // 60s elapsed -> 120s left
    makeScene({ index: 2, state: "queued", updatedAt: oneMinAgo }),    // waits 120s for slot 0 + 180s write = 300s
    makeScene({ index: 3, state: "queued", updatedAt: oneMinAgo }),    // waits 120s for slot 1 + 180s write = 300s
    makeScene({ index: 4, state: "queued", updatedAt: oneMinAgo })     // waits 300s for slot 0 + 180s write = 480s
  ];

  assert.deepEqual(measureTypicalWriteSeconds(scenesNoHistory), {
    seconds: 180,
    measured: false
  });

  const sp2 = sceneProgress(scenesNoHistory[2], null, { nowClient: now, scenes: scenesNoHistory });
  const sp4 = sceneProgress(scenesNoHistory[4], null, { nowClient: now, scenes: scenesNoHistory });
  // Scene 2: 300s * 0.75 = 225 -> 230, 300s * 1.5 = 450
  assert.deepEqual(sp2.etaSeconds, { low: 230, high: 450 });
  // Scene 4 (5th scene, 2nd wave of waiting): 480s * 0.75 = 360, 480s * 1.5 = 720
  assert.deepEqual(sp4.etaSeconds, { low: 360, high: 720 });

  // With history: median of finished scenes' authorMs (100s, 120s, 140s -> median 120s)
  const scenesWithHistory = [
    makeScene({ index: 0, state: "drawn", authorMs: 100_000 }),
    makeScene({ index: 1, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 2, state: "drawn", authorMs: 140_000 }),
    makeScene({ index: 3, state: "authoring", updatedAt: oneMinAgo }) // 60s elapsed of 120s -> 60s left
  ];
  assert.deepEqual(measureTypicalWriteSeconds(scenesWithHistory), {
    seconds: 120,
    measured: true
  });
  const sp3 = sceneProgress(scenesWithHistory[3], null, { nowClient: now, scenes: scenesWithHistory });
  assert.equal(sp3.fraction, 0.5);
  assert.equal(sp3.chipLabel, "Writing 50%");
  // 60s remaining -> low = roundTo10(45) = 50, high = roundTo10(90) = 90
  assert.deepEqual(sp3.etaSeconds, { low: 50, high: 90 });

  // Fallback history from createdAt -> drawnAt when authorMs is absent
  const scenesTimestampHistory = [
    makeScene({
      index: 0,
      state: "drawn",
      createdAt: "2026-11-07T12:00:00.000Z",
      drawnAt: "2026-11-07T12:01:30.000Z" // 90s
    }),
    makeScene({ index: 1, state: "authoring", updatedAt: "2026-11-07T12:01:30.000Z" }) // 30s elapsed
  ];
  assert.deepEqual(measureTypicalWriteSeconds(scenesTimestampHistory), {
    seconds: 90,
    measured: true
  });
});

test("filmProgress counts written/drawn/failed, excludes failed scenes, and returns null ETA when all ready", () => {
  const now = Date.parse("2026-11-07T12:02:00.000Z");
  const oneMinAgo = "2026-11-07T12:01:00.000Z";

  // Mixed film: 2 ready, 1 rendering (written), 1 authoring, 1 queued, 1 failed
  const mixed = [
    makeScene({ index: 0, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 1, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 2, state: "rendering", frames: 120, framesDone: 60, updatedAt: oneMinAgo }),
    makeScene({ index: 3, state: "authoring", updatedAt: oneMinAgo }),
    makeScene({ index: 4, state: "queued", updatedAt: oneMinAgo }),
    makeScene({ index: 5, state: "failed", error: "Failed scene" })
  ];
  const fp = filmProgress(mixed, { nowClient: now });
  assert.equal(fp.total, 6);
  assert.equal(fp.drawn, 2);
  assert.equal(fp.written, 3, "drawn (2) + rendering (1) are past writing");
  assert.equal(fp.failed, 1);
  assert.ok(fp.fraction > 0 && fp.fraction < 1);
  assert.ok(fp.etaSeconds !== null);

  // All ready => etaSeconds is null, fraction is 1
  const allReady = [
    makeScene({ index: 0, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 1, state: "drawn", authorMs: 120_000 })
  ];
  const fpReady = filmProgress(allReady, { nowClient: now });
  assert.equal(fpReady.total, 2);
  assert.equal(fpReady.written, 2);
  assert.equal(fpReady.drawn, 2);
  assert.equal(fpReady.failed, 0);
  assert.equal(fpReady.fraction, 1);
  assert.equal(fpReady.etaSeconds, null);

  // Only ready + failed (nothing active) => etaSeconds is null (failed scenes excluded from ETA)
  const readyAndFailed = [
    makeScene({ index: 0, state: "drawn" }),
    makeScene({ index: 1, state: "failed", error: "err" })
  ];
  const fpFailedDone = filmProgress(readyAndFailed, { nowClient: now });
  assert.equal(fpFailedDone.failed, 1);
  assert.equal(fpFailedDone.etaSeconds, null, "failed scenes do not produce fake remaining ETA");
});

test("formatEta, formatEtaCompact, and formatElapsed use honest wording", () => {
  assert.equal(formatEta(null), "");
  assert.equal(formatEta({ low: 20, high: 30 }), "under a minute left");
  assert.equal(formatEta({ low: 140, high: 220 }), "about 3 min left"); // midpoint 180s = 3 min
  assert.equal(formatEta({ low: 450, high: 630 }), "about 9 min left"); // midpoint 540s = 9 min

  assert.equal(formatEtaCompact(null), "");
  assert.equal(formatEtaCompact({ low: 20, high: 30 }), "<1 min");
  assert.equal(formatEtaCompact({ low: 450, high: 630 }), "~9 min");

  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(-5000), "0:00");
  assert.equal(formatElapsed(67_000), "1:07");
  assert.equal(formatElapsed(125_900), "2:05");
});

test("estimateBufferingResume: observed rates over ~2s window, no-rate fallback, zero-needed, and clamping", () => {
  assert.equal(BUFFERING_WINDOW_MS, 2_000);
  assert.equal(BUFFERING_SHOW_DELAY_MS, 400);

  // 1. Zero needed or already satisfied -> secondsLeft = 0, "a moment"
  assert.deepEqual(
    estimateBufferingResume({ readyFrames: 30, neededFrames: 30, samples: [] }),
    { rateFps: null, secondsLeft: 0, text: "a moment" }
  );
  assert.deepEqual(
    estimateBufferingResume({ readyFrames: 0, neededFrames: 0, samples: [] }),
    { rateFps: null, secondsLeft: 0, text: "a moment" }
  );

  // 2. No rate yet (fewer than 2 samples, or 0 frame delta, or <200ms span) -> "a moment"
  assert.deepEqual(
    estimateBufferingResume({
      readyFrames: 5,
      neededFrames: 30,
      samples: [{ atMs: 1000, readyFrames: 5 }],
      nowMs: 1000
    }),
    { rateFps: null, secondsLeft: null, text: "a moment" }
  );
  assert.deepEqual(
    estimateBufferingResume({
      readyFrames: 5,
      neededFrames: 30,
      samples: [
        { atMs: 1000, readyFrames: 5 },
        { atMs: 2500, readyFrames: 5 }
      ],
      nowMs: 2500
    }),
    { rateFps: null, secondsLeft: null, text: "a moment" }
  );
  assert.deepEqual(
    estimateBufferingResume({
      readyFrames: 8,
      neededFrames: 30,
      samples: [
        { atMs: 1000, readyFrames: 5 },
        { atMs: 1100, readyFrames: 8 } // only 100ms (< 200ms threshold)
      ],
      nowMs: 1100
    }),
    { rateFps: null, secondsLeft: null, text: "a moment" }
  );

  // 3. Measured rate over ~2s: 12 ready of 30 needed (18 left), 9 frames drawn in 1000ms = 9 fps -> 18 / 9 = 2s -> "about 2 s"
  const rateEst = estimateBufferingResume({
    readyFrames: 12,
    neededFrames: 30,
    samples: [
      { atMs: 1000, readyFrames: 3 },
      { atMs: 2000, readyFrames: 12 }
    ],
    nowMs: 2000
  });
  assert.equal(rateEst.rateFps, 9);
  assert.equal(rateEst.secondsLeft, 2);
  assert.equal(rateEst.text, "about 2 s");

  // 4. Prunes samples older than 2s window and uses recent rate
  let ring = [];
  ring = recordBufferingSample(ring, { atMs: 0, readyFrames: 0 });
  ring = recordBufferingSample(ring, { atMs: 1500, readyFrames: 2 });
  ring = recordBufferingSample(ring, { atMs: 2500, readyFrames: 8 }); // 6 frames in 1000ms = 6 fps
  assert.equal(ring.length, 2, "sample at 0ms was pruned when sample at 2500ms arrived");
  const winEst = estimateBufferingResume({
    readyFrames: 12,
    neededFrames: 30, // 18 remaining / 6 fps = 3s
    samples: ring,
    nowMs: 2500
  });
  assert.equal(winEst.rateFps, 6);
  assert.equal(winEst.secondsLeft, 3);
  assert.equal(winEst.text, "about 3 s");

  // 5. Clamping: very fast rate clamps to 1s; very slow rate clamps to 120s ("about 2 min")
  const fastEst = estimateBufferingResume({
    readyFrames: 28,
    neededFrames: 30,
    samples: [
      { atMs: 1000, readyFrames: 10 },
      { atMs: 2000, readyFrames: 28 } // 18 fps, 2 frames left -> 0.11s -> clamped to 1s
    ],
    nowMs: 2000
  });
  assert.equal(fastEst.secondsLeft, 1);
  assert.equal(fastEst.text, "about 1 s");

  const slowEst = estimateBufferingResume({
    readyFrames: 1,
    neededFrames: 90,
    samples: [
      { atMs: 1000, readyFrames: 0 },
      { atMs: 3000, readyFrames: 1 } // 0.5 fps, 89 frames left -> 178s -> clamped to 120s ("about 2 min")
    ],
    nowMs: 3000
  });
  assert.equal(slowEst.secondsLeft, 120);
  assert.equal(slowEst.text, "about 2 min");
});

test("bufferingCause: 3-state priority order (writing > opening > drawing)", () => {
  const now = Date.parse("2026-11-07T12:01:00.000Z");
  const authoringScene = makeScene({
    index: 4,
    state: "authoring",
    updatedAt: "2026-11-07T12:00:00.000Z" // 60s elapsed of 180s typical
  });
  const spWriting = sceneProgress(authoringScene, null, {
    nowClient: now,
    isLiveMode: true,
    scenes: [authoringScene]
  });

  // 1. Priority 1: Scene is not ready on the server (queued / authoring / bundled-checking) -> "writing"
  // Even if live player facts pass readyFrames/hasAnyFrame, server unready wins and never says "Buffering"
  const cWriting = bufferingCause({
    sceneIndex: 4,
    sceneCount: 7,
    serverState: "authoring",
    serverPlayable: false,
    sceneProgress: spWriting,
    hasAnyFrame: true,
    readyFrames: 10,
    neededFrames: 30
  });
  assert.equal(cWriting.cause, "writing");
  assert.equal(cWriting.title, "Scene 5 is still being written");
  assert.ok(!cWriting.title.toLowerCase().includes("buffering"), "must NOT use the word Buffering");
  assert.equal(cWriting.sceneLabel, "Scene 5 of 7");
  assert.equal(cWriting.elapsedText, "1:00");
  assert.ok(cWriting.etaText?.includes("about 2 min left"));
  assert.equal(cWriting.progressEstimated, true);
  assert.ok(Math.abs((cWriting.progressFraction ?? 0) - 60 / 180) < 1e-6);

  // Also test bundled (checking on server) -> cause is still "writing" with checking phase info
  const bundledScene = makeScene({ index: 4, state: "bundled", updatedAt: "2026-11-07T12:00:50.000Z" });
  const spChecking = sceneProgress(bundledScene, null, {
    nowClient: now,
    isLiveMode: true,
    scenes: [bundledScene]
  });
  const cChecking = bufferingCause({
    sceneIndex: 4,
    sceneCount: 7,
    serverState: "bundled",
    serverPlayable: false,
    sceneProgress: spChecking,
    hasAnyFrame: false,
    readyFrames: 0,
    neededFrames: 30
  });
  assert.equal(cChecking.cause, "writing");
  assert.equal(cChecking.title, "Scene 5 is still being written");
  assert.ok(cChecking.meaning.includes("Checking"));
  assert.equal(cChecking.progressIndeterminate, true);

  // 1b. Priority 2 ("clip"): Scene is being prepared as a worker clip (state: "rendering" or "bundled" with playback: "clip")
  const clipScene = makeScene({
    index: 1,
    state: "rendering",
    frames: 120,
    framesDone: 48,
    updatedAt: "2026-11-07T12:00:40.000Z",
    playback: "clip",
    drawMsPerFrame: 165
  });
  const spClip = sceneProgress(clipScene, null, {
    nowClient: now,
    isLiveMode: true,
    scenes: [clipScene]
  });
  assert.equal(spClip.phase, "drawing");
  assert.equal(spClip.preparingAsClip, true);
  assert.equal(spClip.label, "Scene 2 is being prepared as a video for smooth playback");
  assert.equal(
    formatSceneStatusText(1, spClip),
    "Scene 2 is being prepared as a video for smooth playback · 48/120"
  );

  const cClip = bufferingCause({
    sceneIndex: 1,
    sceneCount: 7,
    serverState: "rendering",
    serverPlayable: false,
    playback: "clip",
    sceneProgress: spClip,
    hasAnyFrame: true,
    readyFrames: 0,
    neededFrames: 30
  });
  assert.equal(cClip.cause, "clip");
  assert.equal(cClip.title, "Scene 2 is being prepared as a video for smooth playback");
  assert.equal(cClip.meaning, "Drawing frames 48/120");
  assert.equal(cClip.progressFraction, 48 / 120);
  assert.equal(cClip.progressIndeterminate, false);

  // Also verify state: "bundled" with playback: "clip" (queued for rendering right after /check)
  const bundledClipScene = makeScene({
    index: 1,
    state: "bundled",
    frames: 120,
    updatedAt: "2026-11-07T12:00:40.000Z",
    playback: "clip",
    drawMsPerFrame: 165
  });
  const spBundledClip = sceneProgress(bundledClipScene, null, {
    nowClient: now,
    isLiveMode: true,
    scenes: [bundledClipScene]
  });
  assert.equal(spBundledClip.phase, "drawing");
  assert.equal(spBundledClip.preparingAsClip, true);
  assert.equal(spBundledClip.label, "Scene 2 is being prepared as a video for smooth playback");
  const cBundledClip = bufferingCause({
    sceneIndex: 1,
    sceneCount: 7,
    serverState: "bundled",
    serverPlayable: false,
    playback: "clip",
    sceneProgress: spBundledClip
  });
  assert.equal(cBundledClip.cause, "clip");
  assert.equal(cBundledClip.title, "Scene 2 is being prepared as a video for smooth playback");

  // Retrying takes priority over clip wording when retrying is present on a rendering clip scene
  const retryClipScene = makeScene({
    index: 1,
    state: "rendering",
    frames: 120,
    framesDone: 20,
    updatedAt: "2026-11-07T12:00:40.000Z",
    playback: "clip",
    retrying: { attempt: 1, reason: "the drawing worker restarted" }
  });
  const spRetryClip = sceneProgress(retryClipScene, null, {
    nowClient: now,
    isLiveMode: true,
    scenes: [retryClipScene]
  });
  const cRetryClip = bufferingCause({
    sceneIndex: 1,
    sceneCount: 7,
    serverState: "rendering",
    serverPlayable: false,
    playback: "clip",
    sceneProgress: spRetryClip
  });
  assert.equal(cRetryClip.cause, "clip");
  assert.equal(cRetryClip.title, "Retrying scene 2 (the drawing worker restarted)");
  assert.equal(cRetryClip.meaning, "The drawing worker restarted");

  // 2. Priority 3: Scene is ready on the server ("checked"), but Worker is starting / no frame has arrived yet -> "opening"
  const cOpening = bufferingCause({
    sceneIndex: 4,
    sceneCount: 7,
    serverState: "checked",
    serverPlayable: true,
    hasAnyFrame: false,
    readyFrames: 0,
    neededFrames: 30
  });
  assert.equal(cOpening.cause, "opening");
  assert.equal(cOpening.title, "Opening scene 5…");
  assert.equal(cOpening.sceneLabel, "Scene 5 of 7");
  assert.equal(cOpening.progressFraction, null);
  assert.equal(cOpening.progressIndeterminate, true);

  // 3. Priority 3: Frames are being drawn live and buffer is below resume threshold -> "drawing"
  const cDrawing = bufferingCause({
    sceneIndex: 4,
    sceneCount: 7,
    serverState: "checked",
    serverPlayable: true,
    hasAnyFrame: true,
    readyFrames: 12,
    neededFrames: 30,
    samples: [
      { atMs: 1000, readyFrames: 3 },
      { atMs: 2000, readyFrames: 12 } // 9 fps -> 18 frames left = 2s
    ],
    nowMs: 2000
  });
  assert.equal(cDrawing.cause, "drawing");
  assert.equal(cDrawing.title, "Drawing the next frames of scene 5");
  assert.equal(cDrawing.sceneLabel, "Scene 5 of 7");
  assert.ok(cDrawing.meaning.includes("12/30 ready"), `meaning includes 12/30 ready: ${cDrawing.meaning}`);
  assert.ok(cDrawing.meaning.includes("12 of 30 frames ready"), `meaning includes 12 of 30 frames ready: ${cDrawing.meaning}`);
  assert.ok(cDrawing.meaning.includes("resumes in about 2 s"), `meaning includes resumes in about 2 s: ${cDrawing.meaning}`);
  assert.equal(cDrawing.progressFraction, 12 / 30);
  assert.equal(cDrawing.progressIndeterminate, false);
});

test("buildStagePrepProps shared helper gives identical progress props for clip mode and live mode, and respects 400ms buffering gate", () => {
  const now = Date.parse("2026-11-07T12:01:07.000Z");
  const s0 = makeScene({
    index: 0,
    state: "authoring",
    updatedAt: "2026-11-07T12:00:00.000Z" // 1:07 elapsed
  });
  const sp0 = sceneProgress(s0, null, { nowClient: now, isLiveMode: true, scenes: [s0] });

  const clipProps = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 8,
    sceneState: "authoring",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    isPlayable: false,
    sceneProgress: sp0,
    backgroundSketch: "data:image/svg+xml;utf8,<svg/>"
  });

  const liveProps = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 8,
    sceneState: "authoring",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    isPlayable: false,
    sceneProgress: sp0,
    backgroundSketch: "data:image/svg+xml;utf8,<svg/>",
    liveStageWait: { failed: false, title: "Writing the scene…" }
  });

  assert.ok(clipProps && liveProps);
  assert.deepEqual(liveProps, clipProps, "live mode and clip mode produce identical stage prep props while authoring");
  assert.equal(liveProps.compact, true);
  assert.equal(liveProps.compactCard, true);
  assert.equal(liveProps.title, "Writing the scene · 1:07 · about 2 min left");
  assert.equal(liveProps.compactText, "Writing the scene · 1:07 · about 2 min left");
  assert.equal(liveProps.meaning, "Writing the scene's drawing code");
  assert.equal(liveProps.sceneLabel, "Scene 1 of 8");
  assert.equal(liveProps.elapsedText, "1:07");
  assert.ok(liveProps.progressFraction && liveProps.progressFraction > 0);
  assert.equal(liveProps.progressEstimated, true);
  assert.ok(liveProps.etaText?.includes("about 2 min left"));
  assert.equal(liveProps.backgroundSketch, "data:image/svg+xml;utf8,<svg/>");

  // During a tiny stall (< 400ms: visibleAfterDelay = false) on a playable live scene, buildStagePrepProps returns null
  const suppressedStall = buildStagePrepProps({
    sceneIndex: 4,
    sceneCount: 7,
    sceneState: "checked",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    isPlayable: true,
    liveBuffering: {
      active: true,
      visibleAfterDelay: false,
      hasAnyFrame: true,
      readyFrames: 5,
      neededFrames: 30
    }
  });
  assert.equal(suppressedStall, null, "waits under 400ms do not flash a buffering panel");

  // Once > 400ms (visibleAfterDelay = true), returns compact buffering card
  const shownStall = buildStagePrepProps({
    sceneIndex: 4,
    sceneCount: 7,
    sceneState: "checked",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    isPlayable: true,
    liveBuffering: {
      active: true,
      visibleAfterDelay: true,
      hasAnyFrame: true,
      readyFrames: 12,
      neededFrames: 30,
      samples: [
        { atMs: 1000, readyFrames: 3 },
        { atMs: 2000, readyFrames: 12 }
      ],
      nowMs: 2000
    }
  });
  assert.ok(shownStall);
  assert.equal(shownStall.compact, true);
  assert.equal(shownStall.compactCard, true);
  assert.equal(shownStall.cause, "drawing");
  assert.equal(shownStall.title, "Drawing the next frames of scene 5");
  assert.equal(shownStall.compactText, "Drawing the next frames of scene 5 · 12 of 30 frames ready · resumes in about 2 s");
  assert.equal(shownStall.sceneLabel, "Scene 5 of 7");
  assert.equal(shownStall.progressFraction, 12 / 30);
});

test("watched helper: reaches end after >= 1s playback in last scene, seek to end without playing = not watched, reset on bundle digest / rev change", () => {
  assert.equal(WATCHED_END_THRESHOLD_SECONDS, 0.3);
  assert.equal(WATCHED_MIN_LAST_SCENE_PLAY_SECONDS, 1);

  const scenesV1 = [
    makeScene({ index: 0, sig: "s0", rev: 0, bundleDigest: "digest-0a" }),
    makeScene({ index: 1, sig: "s1", rev: 0, bundleDigest: "digest-1a" }),
    makeScene({ index: 2, sig: "s2", rev: 0, bundleDigest: "digest-2a" })
  ];
  const ver1 = computeFilmVersionKey(scenesV1);
  let state = createWatchedTrackerState(ver1);
  assert.equal(state.watched, false);

  // 1. Seek directly to the end (11.95s of 12s) without playing through the last scene -> NOT watched
  state = updateWatchedState(state, {
    playing: false,
    currentTime: 11.95,
    totalDuration: 12,
    currentSceneIndex: 2,
    sceneCount: 3,
    lastSceneDuration: 4,
    seeking: true,
    versionKey: ver1
  });
  assert.equal(state.watched, false, "seeking to end while paused does not mark watched");
  assert.equal(state.lastScenePlayedSeconds, 0);

  // Even if playing is true during a seek/drag to the end without 1s of real playback in the last scene -> NOT watched
  state = updateWatchedState(state, {
    playing: true,
    currentTime: 11.95,
    totalDuration: 12,
    currentSceneIndex: 2,
    sceneCount: 3,
    lastSceneDuration: 4,
    seeking: true,
    versionKey: ver1
  });
  assert.equal(state.watched, false, "seeking to end while playing does not mark watched without >= 1s playback");

  // Play for only 0.4s in the last scene and reach end -> still NOT watched (< 1s)
  state = updateWatchedState(state, {
    playing: true,
    currentTime: 11.5,
    totalDuration: 12,
    currentSceneIndex: 2,
    sceneCount: 3,
    lastSceneDuration: 4,
    versionKey: ver1
  });
  state = updateWatchedState(state, {
    playing: true,
    currentTime: 11.9,
    totalDuration: 12,
    currentSceneIndex: 2,
    sceneCount: 3,
    lastSceneDuration: 4,
    versionKey: ver1
  });
  assert.equal(state.watched, false, "0.4s of playback in the last scene is under 1s threshold");

  // 2. Real playback through the last scene for >= 1s and reaching within 0.3s of totalDuration (or ended) -> watched = true
  let playState = createWatchedTrackerState(ver1);
  for (const t of [8.0, 8.3, 8.6, 8.9, 9.2, 11.75]) {
    playState = updateWatchedState(playState, {
      playing: true,
      currentTime: t,
      totalDuration: 12,
      currentSceneIndex: 2,
      sceneCount: 3,
      lastSceneDuration: 4,
      versionKey: ver1
    });
  }
  assert.ok(playState.lastScenePlayedSeconds >= 1.19, "accumulated >= 1.2s of real playback in the last scene");
  assert.equal(playState.watched, true, "reaching within 0.3s of end after >= 1s playback marks watched");

  // Also test player ended event after >= 1s playback in last scene
  let endedState = createWatchedTrackerState(ver1);
  for (const t of [8.0, 8.4, 8.8, 9.2]) {
    endedState = updateWatchedState(endedState, {
      playing: true,
      currentTime: t,
      totalDuration: 12,
      currentSceneIndex: 2,
      sceneCount: 3,
      lastSceneDuration: 4,
      versionKey: ver1
    });
  }
  assert.equal(endedState.watched, false, "not at end yet at 9.2s");
  endedState = updateWatchedState(endedState, {
    playing: true,
    currentTime: 9.2,
    totalDuration: 12,
    currentSceneIndex: 2,
    sceneCount: 3,
    lastSceneDuration: 4,
    ended: true,
    versionKey: ver1
  });
  assert.equal(endedState.watched, true, "ended event after >= 1s playback marks watched");

  // Seeking back after watching keeps watched = true while versionKey is unchanged
  playState = updateWatchedState(playState, {
    playing: false,
    currentTime: 2.0,
    totalDuration: 12,
    currentSceneIndex: 0,
    sceneCount: 3,
    lastSceneDuration: 4,
    seeking: true,
    versionKey: ver1
  });
  assert.equal(playState.watched, true, "watched stays true on seek when film version has not changed");

  // 3. Reset on bundleDigest change or scene revision (redraw / comment applied)
  const scenesV2 = [
    scenesV1[0],
    makeScene({ index: 1, sig: "s1", rev: 1, bundleDigest: "digest-1b" }),
    scenesV1[2]
  ];
  const ver2 = computeFilmVersionKey(scenesV2);
  assert.notEqual(ver2, ver1);
  playState = updateWatchedState(playState, {
    playing: false,
    currentTime: 2.0,
    totalDuration: 12,
    currentSceneIndex: 0,
    sceneCount: 3,
    lastSceneDuration: 4,
    versionKey: ver2
  });
  assert.equal(playState.watched, false, "bundleDigest / rev change resets watched to false");
  assert.equal(playState.lastScenePlayedSeconds, 0, "bundleDigest / rev change resets accumulated last-scene play time");
});

test("modal reason text builder: all ready+watched = no modal; unready; failed; unwatched; combinations", () => {
  const sevenReady = Array.from({ length: 7 }, (_, i) => makeScene({ index: i, state: "drawn" }));

  // 1. All ready + watched = no modal
  const allGood = buildRenderConfirmReasons({
    scenes: sevenReady,
    watched: true
  });
  assert.equal(allGood.shouldConfirm, false);
  assert.equal(allGood.title, RENDER_CONFIRM_MODAL_TITLE);
  assert.deepEqual(allGood.reasons, []);
  assert.equal(allGood.text, "");

  // 2. Unwatched only (all 7 scenes ready)
  const unwatchedOnly = buildRenderConfirmReasons({
    scenes: sevenReady,
    watched: false
  });
  assert.equal(unwatchedOnly.shouldConfirm, true);
  assert.deepEqual(unwatchedOnly.reasons, ["You haven't watched the preview through."]);

  // 3. Unready only (3 of 7 scenes still being built, watched = true)
  const threeBuilding = [
    makeScene({ index: 0, state: "drawn" }),
    makeScene({ index: 1, state: "drawn" }),
    makeScene({ index: 2, state: "drawn" }),
    makeScene({ index: 3, state: "drawn" }),
    makeScene({ index: 4, state: "authoring" }),
    makeScene({ index: 5, state: "rendering" }),
    makeScene({ index: 6, state: "queued" })
  ];
  const unreadyOnly = buildRenderConfirmReasons({
    scenes: threeBuilding,
    watched: true
  });
  assert.equal(unreadyOnly.shouldConfirm, true);
  assert.deepEqual(unreadyOnly.reasons, ["3 of 7 scenes are still being built."]);

  // Singular unready ("1 of 7 scenes is still being built.")
  const oneBuilding = [
    ...sevenReady.slice(0, 6),
    makeScene({ index: 6, state: "authoring" })
  ];
  assert.deepEqual(
    buildRenderConfirmReasons({ scenes: oneBuilding, watched: true }).reasons,
    ["1 of 7 scenes is still being built."]
  );

  // 4. Failed only (1 scene failed, others ready, watched = true)
  const oneFailed = [
    ...sevenReady.slice(0, 6),
    makeScene({ index: 6, state: "failed", error: "Timed out" })
  ];
  const failedOnly = buildRenderConfirmReasons({
    scenes: oneFailed,
    watched: true
  });
  assert.equal(failedOnly.shouldConfirm, true);
  assert.deepEqual(failedOnly.reasons, ["1 scene failed to draw."]);

  // Plural failed ("2 scenes failed to draw.")
  const twoFailed = [
    ...sevenReady.slice(0, 5),
    makeScene({ index: 5, state: "failed" }),
    makeScene({ index: 6, state: "failed" })
  ];
  assert.deepEqual(
    buildRenderConfirmReasons({ scenes: twoFailed, watched: true }).reasons,
    ["2 scenes failed to draw."]
  );

  // 5. Combinations: 3 of 7 building + 1 failed + unwatched
  const comboScenes = [
    makeScene({ index: 0, state: "drawn" }),
    makeScene({ index: 1, state: "drawn" }),
    makeScene({ index: 2, state: "drawn" }),
    makeScene({ index: 3, state: "authoring" }),
    makeScene({ index: 4, state: "rendering" }),
    makeScene({ index: 5, state: "queued" }),
    makeScene({ index: 6, state: "failed" })
  ];
  const combo = buildRenderConfirmReasons({
    scenes: comboScenes,
    watched: false
  });
  assert.equal(combo.shouldConfirm, true);
  assert.equal(combo.title, "Make the video without reviewing it first?");
  assert.deepEqual(combo.reasons, [
    "3 of 7 scenes are still being built.",
    "1 scene failed to draw.",
    "You haven't watched the preview through."
  ]);
});

test("retrying field: attempt 1 and attempt > 1 wording, capitalised meaning, timeline chip 'Retrying', and priority in banner/toast/stage", () => {
  const now = Date.parse("2026-11-07T12:01:00.000Z");
  const sinceIso = "2026-11-07T12:00:00.000Z";

  assert.equal(capitalizeReason("the drawing worker restarted"), "The drawing worker restarted");
  assert.equal(
    capitalizeReason("the preview check did not report; drawing it on the server"),
    "The preview check did not report; drawing it on the server"
  );
  assert.equal(capitalizeReason("the writing process restarted"), "The writing process restarted");

  // Attempt 1 -> "Retrying scene 3 (the drawing worker restarted)"
  assert.equal(
    formatRetryingSceneText(2, { attempt: 1, reason: "the drawing worker restarted" }),
    "Retrying scene 3 (the drawing worker restarted)"
  );
  // Attempt > 1 -> "Retrying scene 3 · attempt 2 · the writing process restarted"
  assert.equal(
    formatRetryingSceneText(2, { attempt: 2, reason: "the writing process restarted" }),
    "Retrying scene 3 · attempt 2 · the writing process restarted"
  );
  assert.equal(
    formatRetryingSceneText(4, {
      attempt: 1,
      reason: "the preview check did not report; drawing it on the server"
    }),
    "Retrying scene 5 (the preview check did not report; drawing it on the server)"
  );

  // sceneProgress with retrying on an open scene (rendering / authoring / bundled)
  const retryScene1 = makeScene({
    index: 2,
    state: "rendering",
    frames: 120,
    framesDone: 42,
    updatedAt: sinceIso,
    retrying: { attempt: 1, reason: "the drawing worker restarted" }
  });
  const spRetry1 = sceneProgress(retryScene1, null, { nowClient: now, scenes: [retryScene1] });
  assert.equal(spRetry1.phase, "drawing");
  assert.equal(spRetry1.chipLabel, "Retrying", "timeline chip shows Retrying");
  assert.equal(spRetry1.label, "Retrying scene 3 (the drawing worker restarted)");
  assert.equal(spRetry1.meaning, "The drawing worker restarted");
  assert.deepEqual(spRetry1.retrying, { attempt: 1, reason: "the drawing worker restarted" });
  assert.equal(
    formatSceneStatusText(2, spRetry1),
    "Retrying scene 3 (the drawing worker restarted)"
  );

  // Attempt 2 on writing scene
  const retryScene2 = makeScene({
    index: 2,
    state: "authoring",
    updatedAt: sinceIso,
    retrying: { attempt: 2, reason: "the writing process restarted" }
  });
  const spRetry2 = sceneProgress(retryScene2, null, { nowClient: now, scenes: [retryScene2] });
  assert.equal(spRetry2.chipLabel, "Retrying");
  assert.equal(spRetry2.label, "Retrying scene 3 · attempt 2 · the writing process restarted");
  assert.equal(spRetry2.meaning, "The writing process restarted");
  assert.equal(
    formatSceneStatusText(2, spRetry2),
    "Retrying scene 3 · attempt 2 · the writing process restarted"
  );

  // Stage prep props and bufferingCause use retrying title & capitalised reason
  const stageRetry = buildStagePrepProps({
    sceneIndex: 2,
    sceneCount: 7,
    sceneState: "authoring",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    isPlayable: false,
    sceneProgress: spRetry2
  });
  assert.ok(stageRetry);
  assert.equal(stageRetry.title, "Retrying scene 3 · attempt 2 · the writing process restarted");
  assert.equal(stageRetry.meaning, "The writing process restarted");

  const causeRetry = bufferingCause({
    sceneIndex: 2,
    sceneCount: 7,
    serverState: "authoring",
    serverPlayable: false,
    sceneProgress: spRetry1
  });
  assert.equal(causeRetry.title, "Retrying scene 3 (the drawing worker restarted)");
  assert.equal(causeRetry.meaning, "The drawing worker restarted");

  // Drawn (closed) row ignores any stale retrying field
  const closedScene = makeScene({
    index: 2,
    state: "drawn",
    retrying: { attempt: 1, reason: "the drawing worker restarted" }
  });
  const spClosed = sceneProgress(closedScene, null, { nowClient: now, scenes: [closedScene] });
  assert.equal(spClosed.phase, "ready");
  assert.equal(spClosed.chipLabel, "Ready");
  assert.equal(spClosed.retrying, null);
});

test("formatSceneStatusText and buildUnreadySceneBanner: phase wording and coexistence with stage AnimationPrep without duplication", () => {
  const now = Date.parse("2026-11-07T12:01:30.000Z");
  const thirtySecAgo = "2026-11-07T12:01:00.000Z"; // 30s elapsed; with 120s typical -> 90s remaining -> "about 2 min"

  const scenes = [
    makeScene({ index: 0, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 1, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 2, state: "rendering", frames: 120, framesDone: 42, updatedAt: thirtySecAgo }),
    makeScene({ index: 3, state: "queued", updatedAt: thirtySecAgo }),
    makeScene({ index: 4, state: "bundled", updatedAt: thirtySecAgo }),
    makeScene({ index: 5, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 6, state: "authoring", updatedAt: thirtySecAgo })
  ];
  const ctx = { nowClient: now, isLiveMode: true, scenes };
  const spList = scenes.map((s) => sceneProgress(s, null, ctx));

  assert.equal(formatEtaBrief({ low: 20, high: 30 }), "under a minute");
  assert.equal(formatEtaBrief({ low: 90, high: 150 }), "about 2 min");

  // Check exact phase wording examples from the brief:
  assert.equal(formatSceneStatusText(6, spList[6]), "Scene 7 is being written · about 2 min");
  assert.equal(formatSceneStatusText(3, spList[3]), "Scene 4 is waiting");
  assert.equal(formatSceneStatusText(4, spList[4]), "Checking scene 5");
  assert.equal(formatSceneStatusText(2, spList[2]), "Drawing scene 3 · 42/120");

  // 1. Playback is in Scene 6 (index 5, ready -> stagePrepSceneIndex = null), Scene 7 (index 6) ahead is unready:
  const bannerAhead = buildUnreadySceneBanner({
    scenes,
    perSceneProgress: spList,
    currentSceneIndex: 5,
    stagePrepSceneIndex: null
  });
  assert.ok(bannerAhead);
  assert.equal(bannerAhead.sceneIndex, 6);
  assert.equal(bannerAhead.sceneNumber, 7);
  assert.equal(bannerAhead.placement, "timeline");
  assert.equal(bannerAhead.visualState, "updating");
  assert.equal(bannerAhead.text, "Scene 7 is being written · about 2 min");

  // 2. Selected scene is Scene 7 (index 6, unready) and stage AnimationPrep panel IS already explaining Scene 7:
  // Banner must NOT duplicate Scene 7; instead it shows the earliest other unready scene (Scene 3, index 2)
  const bannerNoDup = buildUnreadySceneBanner({
    scenes,
    perSceneProgress: spList,
    currentSceneIndex: 6,
    stagePrepSceneIndex: 6
  });
  assert.ok(bannerNoDup);
  assert.notEqual(bannerNoDup.sceneIndex, 6, "must not duplicate the scene shown by stage AnimationPrep");
  assert.equal(bannerNoDup.sceneIndex, 2);
  assert.equal(bannerNoDup.text, "Drawing scene 3 · 42/120");

  // 3. Single unready scene already explained by stage AnimationPrep -> returns null (no duplicate banner)
  const onlyOneUnready = [
    makeScene({ index: 0, state: "drawn" }),
    makeScene({ index: 1, state: "authoring", updatedAt: thirtySecAgo })
  ];
  assert.equal(
    buildUnreadySceneBanner({
      scenes: onlyOneUnready,
      currentSceneIndex: 1,
      stagePrepSceneIndex: 1
    }),
    null,
    "returns null when the only unready scene is already explained on the stage panel"
  );

  // 4. Selected scene is unready and stage panel is NOT showing -> banner explains selected scene at top
  const bannerTop = buildUnreadySceneBanner({
    scenes: onlyOneUnready,
    currentSceneIndex: 1,
    stagePrepSceneIndex: null
  });
  assert.ok(bannerTop);
  assert.equal(bannerTop.sceneIndex, 1);
  assert.equal(bannerTop.placement, "top");

  // 5. Slow scene being prepared as a video clip (playback: "clip", drawMsPerFrame: 180):
  //    buildUnreadySceneBanner and buildStagePrepProps show "Scene 2 is being prepared as a video for smooth playback" with progress/ETA
  const slowClipScenes = [
    makeScene({ index: 0, state: "checked", live: true }),
    makeScene({
      index: 1,
      state: "rendering",
      frames: 120,
      framesDone: 30,
      updatedAt: thirtySecAgo,
      playback: "clip",
      drawMsPerFrame: 180
    }),
    makeScene({ index: 2, state: "checked", live: true })
  ];
  const slowClipBanner = buildUnreadySceneBanner({
    scenes: slowClipScenes,
    progressContext: { nowClient: now, isLiveMode: true },
    currentSceneIndex: 0,
    stagePrepSceneIndex: null
  });
  assert.ok(slowClipBanner);
  assert.equal(slowClipBanner.sceneIndex, 1);
  assert.equal(slowClipBanner.placement, "timeline");
  assert.equal(
    slowClipBanner.text,
    "Scene 2 is being prepared as a video for smooth playback · 30/120"
  );

  const spSlowClip = sceneProgress(slowClipScenes[1], null, {
    nowClient: now,
    isLiveMode: true,
    scenes: slowClipScenes
  });
  const slowClipStagePrep = buildStagePrepProps({
    sceneIndex: 1,
    sceneCount: 3,
    sceneState: "rendering",
    playback: "clip",
    isClipScene: true,
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    isPlayable: false,
    sceneProgress: spSlowClip
  });
  assert.ok(slowClipStagePrep);
  assert.equal(
    slowClipStagePrep.title,
    "Scene 2 is being prepared as a video for smooth playback"
  );
  assert.equal(slowClipStagePrep.meaning, "Drawing frames 30/120");
  assert.equal(slowClipStagePrep.progressFraction, 30 / 120);
  assert.ok(slowClipStagePrep.etaText?.includes("about 2 min left"));
});

test("buildFilmProgressToast and formatFilmButtonProgress: all ready, n of m with ETA, failed, no ETA yet, and retrying priority", () => {
  const now = Date.parse("2026-11-07T12:01:30.000Z");
  const thirtySecAgo = "2026-11-07T12:01:00.000Z";

  // Case 1: All ready
  const allReadyScenes = Array.from({ length: 7 }, (_, i) =>
    makeScene({ index: i, state: "drawn", authorMs: 120_000 })
  );
  const toastReady = buildFilmProgressToast({ scenes: allReadyScenes, progressContext: { nowClient: now } });
  assert.ok(toastReady);
  assert.equal(toastReady.active, false);
  assert.equal(toastReady.percent, 100);

  const btnReady = formatFilmButtonProgress({
    scenes: allReadyScenes,
    progressContext: { nowClient: now },
    cost: 15
  });
  assert.equal(btnReady.status, "ready");
  assert.equal(btnReady.buttonLabel, "Render · 15 tokens");
  assert.equal(btnReady.progressText, "7 of 7 ready");
  assert.equal(btnReady.fraction, 1);

  // Case 2: n of m with ETA (6 of 7 written, 6 drawn, scene 5/7 being written)
  const buildingScenes = [
    makeScene({ index: 0, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 1, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 2, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 3, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 4, state: "authoring", updatedAt: thirtySecAgo }),
    makeScene({ index: 5, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 6, state: "drawn", authorMs: 120_000 })
  ];
  const toastBuilding = buildFilmProgressToast({
    scenes: buildingScenes,
    progressContext: { nowClient: now }
  });
  assert.ok(toastBuilding);
  assert.equal(toastBuilding.active, true);
  assert.equal(toastBuilding.sceneIndex, 4);
  assert.equal(toastBuilding.sceneNumber, 5);
  assert.equal(toastBuilding.firstLine, "Scene 5 is being written · about 2 min");
  assert.ok(toastBuilding.secondLine.startsWith("6 of 7 written · 6 drawn · about "));
  assert.ok(toastBuilding.compactLine.startsWith("6/7 written · 6 drawn · ~"));
  assert.ok(toastBuilding.percent > 80 && toastBuilding.percent < 100);

  const btnWithEta = formatFilmButtonProgress({
    scenes: buildingScenes,
    progressContext: { nowClient: now },
    cost: 15
  });
  assert.equal(btnWithEta.status, "building");
  assert.equal(btnWithEta.buttonLabel, "Render · 15 tokens");
  assert.ok(btnWithEta.progressText.startsWith("6 of 7 written · 6 drawn · about "));
  assert.ok(btnWithEta.compactText.startsWith("6/7 written · 6 drawn · ~"));

  // Retrying takes priority in toast's first line
  const retryingScenes = [
    makeScene({ index: 0, state: "drawn", authorMs: 120_000 }),
    makeScene({ index: 1, state: "authoring", updatedAt: thirtySecAgo }),
    makeScene({
      index: 2,
      state: "rendering",
      updatedAt: thirtySecAgo,
      retrying: { attempt: 2, reason: "the drawing worker restarted" }
    })
  ];
  const toastRetrying = buildFilmProgressToast({
    scenes: retryingScenes,
    progressContext: { nowClient: now }
  });
  assert.ok(toastRetrying);
  assert.equal(toastRetrying.firstLine, "Retrying scene 3 · attempt 2 · the drawing worker restarted");

  // Case 3: Failed (no active work remaining, 1 scene failed)
  const failedScenes = [
    ...allReadyScenes.slice(0, 6),
    makeScene({ index: 6, state: "failed", error: "Worker failed" })
  ];
  const btnFailed = formatFilmButtonProgress({
    scenes: failedScenes,
    progressContext: { nowClient: now },
    cost: 15
  });
  assert.equal(btnFailed.status, "failed");
  assert.equal(btnFailed.progressText, "1 scene failed to draw");
  assert.equal(btnFailed.compactText, "1 failed");

  // Case 4: Building with no ETA yet (etaSeconds: null)
  const btnNoEta = formatFilmButtonProgress({
    progress: {
      total: 7,
      written: 6,
      drawn: 6,
      failed: 0,
      fraction: 6 / 7,
      etaSeconds: null,
      typicalSceneSeconds: { low: 120, high: 240 }
    },
    cost: 15
  });
  assert.equal(btnNoEta.status, "building");
  assert.equal(btnNoEta.progressText, "6 of 7 written · 6 drawn");
  assert.equal(btnNoEta.compactText, "6/7 written · 6 drawn");
});

test("stepThrottledLiveText enforces 5-second polite announcement interval", () => {
  assert.equal(LIVE_TEXT_THROTTLE_MS, 5_000);
  let st = { text: "", updatedAtMs: null };

  // Initial appearance adopts text immediately
  const r0 = stepThrottledLiveText(st, "Scene 5 is being written · about 2 min", 1_000);
  st = r0.state;
  assert.equal(st.text, "Scene 5 is being written · about 2 min");
  assert.equal(r0.delayMs, null);

  // Change 2s later (< 5s) holds previous text and reports 3000ms remaining delay
  const r1 = stepThrottledLiveText(st, "Scene 5 is being written · about 1 min", 3_000);
  st = r1.state;
  assert.equal(st.text, "Scene 5 is being written · about 2 min");
  assert.equal(r1.delayMs, 3_000);

  // At 6000ms (>= 5s since 1000ms), adopts new text
  const r2 = stepThrottledLiveText(st, "Scene 5 is being written · about 1 min", 6_000);
  st = r2.state;
  assert.equal(st.text, "Scene 5 is being written · about 1 min");
  assert.equal(r2.delayMs, null);
});

test("clip preparation honest ETA: all branches (a: framesDone/frames, b: measured film clip median & drawMsPerFrame lower bound, c: CLIP_RENDER_SECONDS_PER_FRAME = 1) and Crayon 150-frame incident at 1:43 and 2:49", () => {
  assert.equal(CLIP_RENDER_SECONDS_PER_FRAME, 1);
  assert.equal(TAKING_LONGER_NOTE, "taking longer than usual");

  // --- Branch (c): Default constant CLIP_RENDER_SECONDS_PER_FRAME = 1 (150 frames -> 150s estimate) ---
  assert.equal(estimateClipRenderSeconds({ frames: 150 }), 150);
  assert.equal(estimateClipRenderSeconds({ frames: 120 }), 120);

  // --- Crayon incident reproduction: 150-frame clip at elapsed 1:43 (103s) and 2:49 (169s) ---
  const sinceIso = "2026-11-08T04:12:54.000Z";
  const nowAt1m43s = Date.parse(sinceIso) + 103_000; // 1:43 elapsed
  const nowAt2m49s = Date.parse(sinceIso) + 169_000; // 2:49 elapsed

  const crayonScenes = [
    makeScene({ index: 0, state: "checked", live: true }),
    makeScene({
      index: 1,
      keyword: "Crayon forest",
      state: "rendering",
      seconds: 5,
      frames: 150,
      framesDone: null,
      updatedAt: sinceIso,
      playback: "clip",
      drawMsPerFrame: 185
    }),
    makeScene({ index: 2, state: "checked", live: true })
  ];

  // At 1:43 elapsed (103s of 150s estimate -> 47s raw -> rounded to 50s -> "about 1 min left", NEVER "under a minute left"):
  const sp1m43s = sceneProgress(crayonScenes[1], null, {
    nowClient: nowAt1m43s,
    isLiveMode: true,
    scenes: crayonScenes
  });
  assert.equal(sp1m43s.elapsedMs, 103_000);
  assert.equal(formatElapsed(sp1m43s.elapsedMs), "1:43");
  assert.equal(sp1m43s.fractionEstimated, true, "without framesDone, progress bar is estimated");
  assert.ok(sp1m43s.fraction !== null && sp1m43s.fraction > 0.6 && sp1m43s.fraction < 0.75);
  assert.equal(sp1m43s.takingLongerThanUsual, undefined);
  assert.ok(
    !formatEta(sp1m43s.etaSeconds).includes("under a minute"),
    `elapsed 1:43 of 150-frame clip must NOT say 'under a minute left' (got: ${formatEta(sp1m43s.etaSeconds)})`
  );
  assert.equal(formatEta(sp1m43s.etaSeconds), "about 1 min left");

  const stagePrep1m43s = buildStagePrepProps({
    sceneIndex: 1,
    sceneCount: 3,
    sceneState: "rendering",
    playback: "clip",
    isClipScene: true,
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: sp1m43s
  });
  assert.ok(stagePrep1m43s);
  assert.equal(stagePrep1m43s.elapsedText, "1:43");
  assert.equal(stagePrep1m43s.progressEstimated, true, "stage prep marks bar as estimated when framesDone is absent");
  assert.equal(stagePrep1m43s.progressIndeterminate, false);
  assert.ok(
    !String(stagePrep1m43s.etaText ?? "").includes("under a minute"),
    `stagePrep at 1:43 must NOT say 'under a minute left' (got: ${stagePrep1m43s.etaText})`
  );

  const banner1m43s = buildUnreadySceneBanner({
    scenes: crayonScenes,
    perSceneProgress: crayonScenes.map((s) =>
      sceneProgress(s, null, { nowClient: nowAt1m43s, isLiveMode: true, scenes: crayonScenes })
    ),
    currentSceneIndex: 0,
    stagePrepSceneIndex: null
  });
  assert.ok(banner1m43s);
  assert.ok(
    !banner1m43s.text.includes("under a minute"),
    `banner at 1:43 must NOT say 'under a minute' (got: ${banner1m43s.text})`
  );

  // At 2:49 elapsed (169s >= 150s estimate -> shows "taking longer than usual", no countdown, NEVER "under a minute left"):
  const sp2m49s = sceneProgress(crayonScenes[1], null, {
    nowClient: nowAt2m49s,
    isLiveMode: true,
    scenes: crayonScenes
  });
  assert.equal(sp2m49s.elapsedMs, 169_000);
  assert.equal(formatElapsed(sp2m49s.elapsedMs), "2:49");
  assert.equal(sp2m49s.etaSeconds, null, "no countdown when elapsed >= estimate");
  assert.equal(sp2m49s.etaNote, "taking longer than usual");
  assert.equal(sp2m49s.takingLongerThanUsual, true);
  assert.equal(sp2m49s.fraction, 0.95);
  assert.equal(sp2m49s.fractionEstimated, true);

  const stagePrep2m49s = buildStagePrepProps({
    sceneIndex: 1,
    sceneCount: 3,
    sceneState: "rendering",
    playback: "clip",
    isClipScene: true,
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: sp2m49s
  });
  assert.ok(stagePrep2m49s);
  assert.equal(stagePrep2m49s.elapsedText, "2:49");
  assert.equal(stagePrep2m49s.etaText, "taking longer than usual");
  assert.ok(!String(stagePrep2m49s.etaText).includes("under a minute"));
  assert.equal(stagePrep2m49s.progressEstimated, true);

  const cause2m49s = bufferingCause({
    sceneIndex: 1,
    sceneCount: 3,
    serverState: "rendering",
    serverPlayable: false,
    playback: "clip",
    isClipScene: true,
    sceneProgress: sp2m49s
  });
  assert.equal(cause2m49s.cause, "clip");
  assert.equal(cause2m49s.elapsedText, "2:49");
  assert.equal(cause2m49s.etaText, "taking longer than usual");
  assert.equal(cause2m49s.progressEstimated, true);

  const banner2m49s = buildUnreadySceneBanner({
    scenes: crayonScenes,
    perSceneProgress: crayonScenes.map((s) =>
      sceneProgress(s, null, { nowClient: nowAt2m49s, isLiveMode: true, scenes: crayonScenes })
    ),
    currentSceneIndex: 0,
    stagePrepSceneIndex: null
  });
  assert.ok(banner2m49s);
  assert.equal(
    banner2m49s.text,
    "Scene 2 is being prepared as a video for smooth playback · taking longer than usual"
  );

  // --- Branch (a): Real framesDone/frames progress ---
  // Once f >= 0.1, remaining = elapsed * (1 - f) / f rounded to 10s, determinate bar (fractionEstimated: false)
  const realProg30Pct = computeClipPreparationEta({
    framesDone: 45,
    frames: 150,
    elapsedSec: 45 // f = 0.3 >= 0.1 -> remaining = 45 * 0.7 / 0.3 = 105s -> rounded to 10s = 110s
  });
  assert.equal(realProg30Pct.fraction, 0.3);
  assert.equal(realProg30Pct.fractionEstimated, false, "determinate bar when framesDone/frames is available");
  assert.equal(realProg30Pct.remainingSeconds, 110);
  assert.deepEqual(realProg30Pct.etaSeconds, { low: 80, high: 170 });
  assert.equal(realProg30Pct.takingLongerThanUsual, false);

  // When 0 < f < 0.1 (e.g. 6/150 frames done = 4% at 1:43 elapsed), shown ETA never shrinks below real remaining work (1 - f) * estimate
  const lowProgAt1m43s = computeClipPreparationEta({
    framesDone: 6,
    frames: 150,
    elapsedSec: 103 // estimate - elapsed = 47s, but 96% of 150 frames (144s work) still remain!
  });
  assert.equal(lowProgAt1m43s.fraction, 6 / 150);
  assert.equal(lowProgAt1m43s.fractionEstimated, false);
  assert.equal(lowProgAt1m43s.remainingSeconds, 140, "never shrinks below remaining work (144s -> 140s)");
  assert.equal(formatEta(lowProgAt1m43s.etaSeconds), "about 3 min left");

  // When 0 < f < 0.1 and elapsed >= estimate (e.g. 2:49 elapsed with only 6/150 frames done), shows "taking longer than usual"
  const lowProgAt2m49s = computeClipPreparationEta({
    framesDone: 6,
    frames: 150,
    elapsedSec: 169
  });
  assert.equal(lowProgAt2m49s.etaSeconds, null);
  assert.equal(lowProgAt2m49s.etaNote, "taking longer than usual");
  assert.equal(lowProgAt2m49s.takingLongerThanUsual, true);

  // --- Branch (b): Measured clip render time (median of finished clip scenes in film, or drawMsPerFrame * frames lower bound) ---
  const filmWithFinishedClips = [
    makeScene({
      index: 0,
      state: "drawn",
      createdAt: "2026-11-08T04:00:00.000Z",
      drawnAt: "2026-11-08T04:03:20.000Z" // 200s
    }),
    makeScene({
      index: 1,
      state: "drawn",
      createdAt: "2026-11-08T04:00:00.000Z",
      drawnAt: "2026-11-08T04:04:00.000Z" // 240s
    }),
    makeScene({
      index: 2,
      state: "rendering",
      playback: "clip",
      frames: 120
    })
  ];
  const measuredClip = measureTypicalClipRenderSeconds(filmWithFinishedClips);
  assert.deepEqual(measuredClip, { seconds: 220, measured: true });
  assert.equal(
    estimateClipRenderSeconds({ frames: 120, scenes: filmWithFinishedClips }),
    220,
    "uses median of finished clip scenes in this film (220s)"
  );

  // Server's drawMsPerFrame * frames acts as a lower bound when larger than default/measured
  assert.equal(
    estimateClipRenderSeconds({ frames: 150, drawMsPerFrame: 1400 }),
    210,
    "drawMsPerFrame (1.4s) * 150 frames = 210s lower bound beats 150s default"
  );

  // Also verify isSceneWorkingState keeps polling while a demoted clip scene is rendering or drawn without v
  assert.equal(
    isSceneWorkingState(makeScene({ state: "rendering", playback: "clip" })),
    true
  );
  assert.equal(
    isSceneWorkingState(makeScene({ state: "checked", playback: "clip" })),
    true,
    "demoted scene still in checked state with playback:'clip' counts as working"
  );
  assert.equal(
    isSceneWorkingState(
      makeScene({
        state: "drawn",
        playback: "clip",
        variants: { "16:9": { state: "drawn", sig: "s", v: null, playback: "clip" } }
      })
    ),
    true,
    "demoted scene in drawn state with v:null counts as working until clip version v is set"
  );
  assert.equal(
    isSceneWorkingState(
      makeScene({
        state: "drawn",
        playback: "clip",
        variants: { "16:9": { state: "drawn", sig: "s", v: "clipv1", playback: "clip" } }
      })
    ),
    false,
    "once state is drawn and v is set, scene is no longer working"
  );
});

test("buildStagePrepProps picture-visible variants: sketch present (writing/checking/drawing/clip-preparing) -> compact one-line text; sketch absent -> big card; failed -> failure card", () => {
  const sketchUrl = "data:image/svg+xml;utf8,<svg viewBox='0 0 160 90'/>";
  const sinceIso = "2026-11-08T10:00:00.000Z";

  // 1. Sketch present + writing (0:37 elapsed) -> compact one-line text with elapsed and ETA
  const nowWriting = Date.parse(sinceIso) + 37_000;
  const writingScene = makeScene({ index: 0, state: "authoring", updatedAt: sinceIso });
  const finishedHistoryScene = makeScene({ index: 1, state: "drawn", authorMs: 145_000 });
  const spWriting = sceneProgress(writingScene, null, {
    nowClient: nowWriting,
    isLiveMode: true,
    scenes: [writingScene, finishedHistoryScene]
  });
  const writingWithSketch = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 7,
    sceneState: "authoring",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: spWriting,
    backgroundSketch: sketchUrl
  });
  assert.ok(writingWithSketch);
  assert.equal(writingWithSketch.compact, true);
  assert.equal(writingWithSketch.compactCard, true);
  assert.equal(writingWithSketch.failed, false);
  assert.equal(writingWithSketch.title, "Writing the scene · 0:37 · about 2 min left");
  assert.equal(writingWithSketch.compactText, "Writing the scene · 0:37 · about 2 min left");
  assert.equal(writingWithSketch.meaning, "Writing the scene's drawing code");
  assert.equal(writingWithSketch.backgroundSketch, sketchUrl);

  // 2. Sketch present + checking (0:12 elapsed) -> compact one-line text
  const nowChecking = Date.parse(sinceIso) + 12_000;
  const checkingScene = makeScene({ index: 0, state: "bundled", updatedAt: sinceIso });
  const spChecking = sceneProgress(checkingScene, null, {
    nowClient: nowChecking,
    isLiveMode: true,
    scenes: [checkingScene]
  });
  const checkingWithSketch = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 7,
    sceneState: "bundled",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: spChecking,
    backgroundSketch: sketchUrl
  });
  assert.ok(checkingWithSketch);
  assert.equal(checkingWithSketch.compact, true);
  assert.equal(checkingWithSketch.title, "Checking · 0:12 · under a minute left");
  assert.equal(checkingWithSketch.meaning, "Checking it draws correctly");

  // 3. Sketch present + drawing (0:25 elapsed, 42/120 frames) -> compact one-line text
  const nowDrawing = Date.parse(sinceIso) + 25_000;
  const drawingScene = makeScene({
    index: 0,
    state: "rendering",
    frames: 120,
    framesDone: 42,
    updatedAt: sinceIso
  });
  const spDrawing = sceneProgress(drawingScene, null, {
    nowClient: nowDrawing,
    isLiveMode: false,
    scenes: [drawingScene]
  });
  const drawingWithSketch = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 7,
    sceneState: "rendering",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: spDrawing,
    backgroundSketch: sketchUrl
  });
  assert.ok(drawingWithSketch);
  assert.equal(drawingWithSketch.compact, true);
  assert.equal(drawingWithSketch.title, "Drawing the scene · 0:25 · about 1 min left");
  assert.equal(drawingWithSketch.meaning, "Drawing frames 42/120");

  // 4. Sketch present + clip-preparing (0:40 elapsed, 30/120 frames, playback: "clip") -> compact one-line text
  const nowClip = Date.parse(sinceIso) + 40_000;
  const clipPrepScene = makeScene({
    index: 1,
    state: "rendering",
    frames: 120,
    framesDone: 30,
    updatedAt: sinceIso,
    playback: "clip",
    drawMsPerFrame: 180
  });
  const spClipPrep = sceneProgress(clipPrepScene, null, {
    nowClient: nowClip,
    isLiveMode: true,
    scenes: [clipPrepScene]
  });
  const clipWithSketch = buildStagePrepProps({
    sceneIndex: 1,
    sceneCount: 7,
    sceneState: "rendering",
    playback: "clip",
    isClipScene: true,
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: spClipPrep,
    backgroundSketch: sketchUrl
  });
  assert.ok(clipWithSketch);
  assert.equal(clipWithSketch.compact, true);
  assert.equal(
    clipWithSketch.title,
    "Scene 2 is being prepared as a video for smooth playback · 0:40 · about 2 min left"
  );
  assert.equal(clipWithSketch.meaning, "Drawing frames 30/120");

  // 5. Sketch absent -> big card as before (compact: false)
  const writingNoSketch = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 7,
    sceneState: "authoring",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: spWriting,
    backgroundSketch: null
  });
  assert.ok(writingNoSketch);
  assert.equal(writingNoSketch.compact, false);
  assert.equal(writingNoSketch.compactCard, undefined);
  assert.equal(writingNoSketch.title, "Writing the scene…");
  assert.equal(writingNoSketch.meaning, "Writing the scene's drawing code");
  assert.equal(writingNoSketch.sceneLabel, "Scene 1 of 7");
  assert.equal(writingNoSketch.elapsedText, "0:37");
  assert.equal(writingNoSketch.etaText, "about 2 min left · usually 2-4 min per scene");
  assert.equal(writingNoSketch.backgroundSketch, null);

  // 6. Failed scene (even when sketch is present) -> prominent failure card (compact: false, failed: true)
  const failedScene = makeScene({
    index: 0,
    state: "failed",
    error: "Worker timed out while drawing scene 1"
  });
  const spFailed = sceneProgress(failedScene, null, {
    nowClient: nowWriting,
    isLiveMode: true,
    scenes: [failedScene]
  });
  const failedWithSketch = buildStagePrepProps({
    sceneIndex: 0,
    sceneCount: 7,
    sceneState: "failed",
    sceneError: "Worker timed out while drawing scene 1",
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: false,
    isPlayable: false,
    sceneProgress: spFailed,
    backgroundSketch: sketchUrl
  });
  assert.ok(failedWithSketch);
  assert.equal(failedWithSketch.failed, true);
  assert.equal(failedWithSketch.compact, false);
  assert.equal(failedWithSketch.title, "This scene didn't draw");
  assert.equal(failedWithSketch.detail, "Worker timed out while drawing scene 1");
  assert.equal(failedWithSketch.sceneLabel, "Scene 1 of 7");
  assert.equal(failedWithSketch.backgroundSketch, sketchUrl);
});

