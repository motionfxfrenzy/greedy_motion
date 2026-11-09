import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFilmPlayer,
  distanceAheadOfPlayhead,
  orderPendingChecks,
  parseGenFromBundleUrl
} from "../lib/live/index.ts";

function fakeElement() {
  const drawn = [];
  const doc = {
    createElement() {
      return {
        style: {},
        width: 0,
        height: 0,
        getContext: () => ({
          clearRect() {},
          drawImage(bm) {
            drawn.push(bm);
          }
        }),
        remove() {}
      };
    }
  };
  return { ownerDocument: doc, drawn, appendChild: (c) => c };
}

/**
 * Fake Worker transport in the harness style of `live-scene-boundary.mjs`, extended to track
 * `peakWorkers`, per-scene transport spawns, and optional per-scene failure or hang injection.
 */
function makeProactiveTransport({
  drawMsDraft = 5,
  drawMsFull = 18,
  spawnDelayMs = 4,
  initDelayMs = 4,
  frameDelayMs = 2,
  onSceneInit,
  onSceneFrame
} = {}) {
  let activeTransports = 0;
  let peakTransports = 0;
  let peakTransportsDuringPlay = 0;
  let isPlayingFn = () => false;
  const spawns = [];
  const initCalls = [];
  const frameCalls = [];
  const bitmaps = [];

  const recordActive = (delta) => {
    activeTransports = Math.max(0, activeTransports + delta);
    if (activeTransports > peakTransports) peakTransports = activeTransports;
    if (isPlayingFn() && activeTransports > peakTransportsDuringPlay) {
      peakTransportsDuringPlay = activeTransports;
    }
  };

  const factory = async (workerSource) => {
    const tagMatch = /\/\*scene-([^*]+)\*\//.exec(String(workerSource ?? ""));
    const sceneTag = tagMatch ? tagMatch[1] : "unknown";
    if (spawnDelayMs > 0) {
      await new Promise((r) => setTimeout(r, spawnDelayMs));
    }
    recordActive(1);
    spawns.push({ sceneTag, activeAfterSpawn: activeTransports });
    let terminated = false;
    let initialized = false;

    const port = {
      onmessage: null,
      postMessage(msg) {
        if (terminated) return;
        if (msg.t === "init") {
          initCalls.push({ sceneTag, scale: msg.scale, activeTransports });
          const customInit = onSceneInit?.({ sceneTag, msg, port, isTerminated: () => terminated });
          if (customInit?.handled) return;
          const delay = customInit?.delayMs ?? initDelayMs;
          setTimeout(() => {
            if (terminated) return;
            if (customInit?.failMessage) {
              port.onmessage?.({
                data: { t: "fail", id: msg.id, message: customInit.failMessage }
              });
              return;
            }
            initialized = true;
            port.onmessage?.({
              data: {
                t: "init",
                id: msg.id,
                w: 640,
                h: 360,
                meta: { W: 1920, H: 1080, fps: 30, durationFrames: 60 },
                capabilities: {
                  draftSupported: true,
                  seekAcceptsQuality: true,
                  profileVersion: "v1",
                  defaultDraftTargetVerticesPerFrame: 75000
                }
              }
            });
          }, delay);
        } else if (msg.t === "hb") {
          port.onmessage?.({ data: { t: "hb", id: msg.id } });
        } else if (msg.t === "dispose") {
          port.onmessage?.({ data: { t: "dispose", id: msg.id, ok: true } });
        } else if (msg.t === "frame") {
          const customFrame = onSceneFrame?.({ sceneTag, msg, port, isTerminated: () => terminated });
          if (customFrame?.handled) return;
          const delay = customFrame?.delayMs ?? frameDelayMs;
          setTimeout(() => {
            if (terminated) return;
            if (!initialized) {
              port.onmessage?.({
                data: {
                  t: "fail",
                  id: msg.id,
                  message: "Worker frame requested before init completed"
                }
              });
              return;
            }
            if (customFrame?.failMessage) {
              port.onmessage?.({
                data: { t: "fail", id: msg.id, message: customFrame.failMessage }
              });
              return;
            }
            const qSpec = msg.qualitySpec;
            const mode =
              qSpec === "draft" || (typeof qSpec === "object" && qSpec !== null && qSpec.mode === "draft")
                ? "draft"
                : "full";
            const dMs = mode === "draft" ? drawMsDraft : drawMsFull;
            frameCalls.push({ sceneTag, n: msg.n, mode, activeTransports });
            const bm = {
              width: 640,
              height: 360,
              frameIndex: msg.n,
              qualityMode: mode,
              closed: false,
              close() {
                this.closed = true;
              }
            };
            bitmaps.push(bm);
            port.onmessage?.({
              data: {
                t: "frame",
                id: msg.id,
                n: msg.n,
                bitmap: bm,
                drawMs: dMs,
                hash: `hash-${sceneTag}-${msg.n}`,
                epoch: msg.epoch
              }
            });
          }, delay);
        }
      }
    };

    return {
      port,
      terminate() {
        if (!terminated) {
          terminated = true;
          recordActive(-1);
        }
      }
    };
  };

  return {
    factory,
    spawns,
    initCalls,
    frameCalls,
    bitmaps,
    setPlayingTracker(fn) {
      isPlayingFn = fn;
    },
    get activeTransports() {
      return activeTransports;
    },
    get peakTransports() {
      return peakTransports;
    },
    get peakTransportsDuringPlay() {
      return peakTransportsDuringPlay;
    }
  };
}

test("(1) A scene updated to `bundled` while the playhead is in another scene gets measured and a check report posted without a seek (paused and playing), ordered by distance ahead of playhead", async (t) => {
  // Verify presigned URL gen extraction for bundle keys (`.../g3/bundles/<sha>/bundle.html`)
  assert.equal(
    parseGenFromBundleUrl(
      "/local-storage/uploads/plates%2F316f1cbd%2F16x9%2F2%2Fg3%2Fbundles%2F9a8b7c%2Fbundle.html?expires=900",
      1
    ),
    3
  );
  assert.equal(
    parseGenFromBundleUrl(
      "https://r2.example.com/plates/316f1cbd/16x9/2/g3/bundles/9a8b7c/bundle.html?X-Amz-Signature=1",
      1
    ),
    3
  );

  // Verify pure ordering helper: distance ahead of playhead first, then by index
  assert.deepEqual(
    orderPendingChecks(
      [{ sceneIndex: 0 }, { sceneIndex: 1 }, { sceneIndex: 3 }, { sceneIndex: 4 }],
      2,
      5
    ).map((x) => x.sceneIndex),
    [3, 4, 0, 1]
  );
  assert.equal(distanceAheadOfPlayhead(2, 2, 5), 0);
  assert.equal(distanceAheadOfPlayhead(3, 2, 5), 1);
  assert.equal(distanceAheadOfPlayhead(0, 2, 5), 3);

  // --- Sub-case A: Paused in scene 0, scene 2 (index 2, variant 6806947c…, gen 3) is updated to `bundled` without any seek ---
  const trPaused = makeProactiveTransport({ drawMsDraft: 6, spawnDelayMs: 3, initDelayMs: 3, frameDelayMs: 2 });
  let timeSec = 0;
  let playing = false;
  trPaused.setPlayingTracker(() => playing);
  const postedPaused = [];

  const filmPaused = createFilmPlayer({
    projectId: "316f1cbd-0000-4000-8000-000000000001",
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-init-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: trPaused.factory,
    reportCheck: async (projectId, variantId, payload) => {
      postedPaused.push({ projectId, variantId, ...payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    }
  });
  t.after(() => filmPaused.destroy());

  await filmPaused.mount(fakeElement());
  assert.equal(filmPaused.activeSceneIndex, 0);
  assert.equal(filmPaused.scenes[2].measuredYet, false, "scene 2 not yet measured before revision");

  // Revise scene 2 to `bundled` (gen 3) while playhead remains paused at scene 0 (no seek)
  await filmPaused.updateScene(2, {
    id: "s2",
    state: "bundled",
    variantId: "6806947c-7800-42df-a0e3-255ec930e16e",
    gen: 3,
    bundleDigest: "dig-scene2-gen3",
    html: "<script>/*scene-2-g3*/window.FILM={};</script>",
    frames: 60
  });

  await filmPaused.waitForChecks();

  assert.equal(filmPaused.activeSceneIndex, 0, "playhead stayed in scene 0 without a seek");
  assert.equal(filmPaused.scenes[2].measuredYet, true, "scene 2 was proactively measured in background while paused");
  assert.equal(
    filmPaused.scenes[2].workerHost.hasActiveTransport,
    false,
    "scene 2 background Worker was released after check completed (not current or next)"
  );
  assert.equal(postedPaused.length, 1, "exactly 1 check report posted while paused");
  assert.equal(postedPaused[0].variantId, "6806947c-7800-42df-a0e3-255ec930e16e");
  assert.equal(postedPaused[0].gen, 3);
  assert.equal(postedPaused[0].bundleDigest, "dig-scene2-gen3");
  assert.equal(postedPaused[0].results.ok, true);
  assert.equal(postedPaused[0].results.drawMsMedian, 6);

  // Also verify queue order while paused at scene 2 (index 2): scenes 0, 1, 3, 4 updated to `bundled` -> checked in order [3, 4, 0, 1]
  timeSec = 4.1; // scene 2 (spans: 0..2, 2..4, 4..6)
  filmPaused.syncToClock();
  assert.equal(filmPaused.activeSceneIndex, 2);
  const orderPosted = [];
  for (const idx of [0, 1, 4, 3]) {
    await filmPaused.updateScene(idx, {
      id: `s${idx}`,
      state: "bundled",
      variantId: `var-order-${idx}`,
      gen: 2,
      bundleDigest: `dig-order-${idx}`,
      html: `<script>/*scene-${idx}-order*/window.FILM={};</script>`,
      frames: 60,
      onCheckReport: (ev) => {
        orderPosted.push(ev.sceneIndex);
      }
    });
  }
  await filmPaused.waitForChecks();
  assert.deepEqual(
    orderPosted,
    [3, 4, 0, 1],
    "scenes needing a check are checked by distance ahead of playhead (scene 2 -> 3, 4), then by index (0, 1)"
  );

  // --- Sub-case B: Playing in scene 0, scene 2 is updated to `bundled` without any seek ---
  const trPlaying = makeProactiveTransport({ drawMsDraft: 5, spawnDelayMs: 3, initDelayMs: 3, frameDelayMs: 2 });
  let playTimeSec = 0;
  let isPlaying = true;
  trPlaying.setPlayingTracker(() => isPlaying);
  const postedPlaying = [];

  const filmPlaying = createFilmPlayer({
    projectId: "316f1cbd-0000-4000-8000-000000000002",
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-play-init-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => playTimeSec, playing: () => isPlaying },
    transportFactory: trPlaying.factory,
    reportCheck: async (projectId, variantId, payload) => {
      postedPlaying.push({ projectId, variantId, ...payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    }
  });
  t.after(() => filmPlaying.destroy());

  await filmPlaying.mount(fakeElement());
  filmPlaying.showFrame(0);

  // Update scene 2 to `bundled` while playhead is playing in scene 0 (no seek)
  await filmPlaying.updateScene(2, {
    id: "s2",
    state: "bundled",
    variantId: "6806947c-play",
    gen: 3,
    bundleDigest: "dig-play-s2-g3",
    html: "<script>/*scene-2-play*/window.FILM={};</script>",
    frames: 60
  });

  await filmPlaying.waitForChecks();

  assert.equal(filmPlaying.activeSceneIndex, 0, "playhead remained in scene 0");
  assert.equal(filmPlaying.scenes[2].measuredYet, true, "scene 2 measured in background while playing");
  assert.equal(
    filmPlaying.scenes[2].workerHost.hasActiveTransport,
    false,
    "scene 2 background Worker released after check finished"
  );
  assert.equal(postedPlaying.length, 1, "check report posted while playing in scene 0");
  assert.equal(postedPlaying[0].variantId, "6806947c-play");
  assert.equal(postedPlaying[0].gen, 3);
  assert.equal(postedPlaying[0].bundleDigest, "dig-play-s2-g3");
  assert.equal(postedPlaying[0].results.ok, true);
  assert.equal(postedPlaying[0].results.drawMsMedian, 5);
  assert.ok(
    trPlaying.peakTransportsDuringPlay <= 2,
    `peakWorkersDuringPlay (${trPlaying.peakTransportsDuringPlay}) must stay <= 2`
  );
});

test("(2) During playback peak Workers stays <= 2 and the background check does not start while current or next is not warm", async (t) => {
  let s3CheckInitAt = null;
  let s0WarmAtS3Init = false;
  let s1WarmAtS3Init = false;
  let filmRef = null;

  const tr = makeProactiveTransport({
    drawMsDraft: 8,
    spawnDelayMs: 4,
    initDelayMs: 4,
    frameDelayMs: 4,
    onSceneInit({ sceneTag }) {
      if (sceneTag === "3-bundled" && s3CheckInitAt === null && filmRef) {
        s3CheckInitAt = Date.now();
        const s0 = filmRef.scenes[0];
        const s1 = filmRef.scenes[1];
        s0WarmAtS3Init = Boolean(
          s0.measuredYet && !s0.isPreparing && !s0.isBufferingNow && !s0.isPumping && s0.readyAhead(0) >= 10
        );
        s1WarmAtS3Init = Boolean(
          s1.measuredYet && !s1.isPreparing && !s1.isBufferingNow && !s1.isPumping && s1.readyAhead(0) >= 6
        );
      }
    }
  });

  let timeSec = 0;
  let playing = true;
  tr.setPlayingTracker(() => playing);
  const posted = [];

  const film = createFilmPlayer({
    projectId: "proj-warmth-gate",
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-w-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: tr.factory,
    reportCheck: async (_projectId, variantId, payload) => {
      posted.push({ variantId, ...payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    }
  });
  filmRef = film;
  t.after(() => film.destroy());

  await film.mount(fakeElement());

  // Immediately update scene 3 to `bundled` while scene 0 (current) is still warming up its initial runway
  // and scene 1 (next) has not even been measured yet!
  await film.updateScene(3, {
    id: "s3",
    state: "bundled",
    variantId: "var-s3-warmth",
    gen: 2,
    bundleDigest: "dig-s3-warmth-g2",
    html: "<script>/*scene-3-bundled*/window.FILM={};</script>",
    frames: 60
  });

  // Right after updateScene, scene 0 is still pumping its runway and scene 1 is not measured yet:
  assert.equal(film.scenes[1].measuredYet, false, "scene 1 (next) is not warm yet");
  assert.equal(s3CheckInitAt, null, "background check for scene 3 must NOT start while current or next is not warm");

  // Wait for current (scene 0) and next (scene 1) to warm up and scene 3's background check to complete
  await film.waitForChecks();

  assert.notEqual(s3CheckInitAt, null, "scene 3 background check ran once current and next became warm");
  assert.equal(s0WarmAtS3Init, true, "current scene (scene 0) was warm before scene 3 check started");
  assert.equal(s1WarmAtS3Init, true, "next scene (scene 1) was warm before scene 3 check started");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].variantId, "var-s3-warmth");
  assert.equal(posted[0].results.ok, true);
  assert.equal(posted[0].results.drawMsMedian, 8);
  assert.equal(film.scenes[3].measuredYet, true, "scene 3 is measured after background check");
  assert.equal(
    film.scenes[3].workerHost.hasActiveTransport,
    false,
    "scene 3 Worker was released after background check"
  );

  // Now advance playback across scenes 0 -> 1 -> 2 -> 3 to verify peakWorkersDuringPlay stays <= 2 throughout
  for (let f = 5; f <= 185; f += 15) {
    timeSec = f / 30;
    film.showFrame(f);
    await new Promise((r) => setTimeout(r, 15));
  }

  assert.ok(
    tr.peakTransportsDuringPlay <= 2,
    `peakWorkersDuringPlay (${tr.peakTransportsDuringPlay}) must stay <= 2 (got ${tr.peakTransportsDuringPlay})`
  );
  assert.equal(tr.peakTransportsDuringPlay, 2, "peakWorkersDuringPlay reached 2 and never exceeded 2");
});

test("(3) A digest change while checking (and while queued) re-queues and only the newest digest is reported", async (t) => {
  let notifyStaleInFlight = null;
  const staleInFlightPromise = new Promise((r) => {
    notifyStaleInFlight = r;
  });

  const tr = makeProactiveTransport({
    drawMsDraft: 5,
    spawnDelayMs: 2,
    initDelayMs: 2,
    frameDelayMs: 2,
    onSceneFrame({ sceneTag, msg }) {
      if (sceneTag === "2-stale" && msg.n === 0) {
        notifyStaleInFlight?.();
        return { delayMs: 80 };
      }
      if (sceneTag === "1-gate" && msg.n === 0) {
        return { delayMs: 40 };
      }
    }
  });

  let timeSec = 0;
  let playing = false;
  const posted = [];

  const film = createFilmPlayer({
    projectId: "proj-fenced-digest",
    scenes: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-f0-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: tr.factory,
    reportCheck: async (_projectId, variantId, payload) => {
      posted.push({ variantId, ...payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    }
  });
  t.after(() => film.destroy());

  await film.mount(fakeElement());

  // 1. Start checking scene 2 with `dig-stale-g2`
  await film.updateScene(2, {
    id: "s2",
    state: "bundled",
    variantId: "var-s2",
    gen: 2,
    bundleDigest: "dig-stale-g2",
    html: "<script>/*scene-2-stale*/window.FILM={};</script>",
    frames: 60
  });

  // Wait until `dig-stale-g2` is actively drawing frame 0 inside `runCheck`
  await staleInFlightPromise;

  // While `dig-stale-g2` is mid-check, update scene 2 to `dig-fresh-g3` (gen 3)!
  await film.updateScene(2, {
    id: "s2",
    state: "bundled",
    variantId: "var-s2",
    gen: 3,
    bundleDigest: "dig-fresh-g3",
    html: "<script>/*scene-2-fresh*/window.FILM={};</script>",
    frames: 60
  });

  // Also test changing scene 3's digest while queued behind scene 2:
  await film.updateScene(3, {
    id: "s3",
    state: "bundled",
    variantId: "var-s3",
    gen: 4,
    bundleDigest: "dig-s3-queued-stale-g4",
    html: "<script>/*scene-3-q1*/window.FILM={};</script>",
    frames: 60
  });
  await film.updateScene(3, {
    id: "s3",
    state: "bundled",
    variantId: "var-s3",
    gen: 5,
    bundleDigest: "dig-s3-queued-fresh-g5",
    html: "<script>/*scene-3-q2*/window.FILM={};</script>",
    frames: 60
  });

  await film.waitForChecks();

  // Verify stale digests were NEVER reported, and ONLY the newest digests were reported
  assert.equal(
    posted.some((r) => r.bundleDigest === "dig-stale-g2" || r.gen === 2),
    false,
    "stale in-flight digest dig-stale-g2 (gen 2) must NEVER be reported"
  );
  assert.equal(
    posted.some((r) => r.bundleDigest === "dig-s3-queued-stale-g4" || r.gen === 4),
    false,
    "stale queued digest dig-s3-queued-stale-g4 (gen 4) must NEVER be reported"
  );
  assert.deepEqual(
    posted.map((r) => ({ variantId: r.variantId, gen: r.gen, bundleDigest: r.bundleDigest, ok: r.results.ok })),
    [
      { variantId: "var-s2", gen: 3, bundleDigest: "dig-fresh-g3", ok: true },
      { variantId: "var-s3", gen: 5, bundleDigest: "dig-s3-queued-fresh-g5", ok: true }
    ]
  );
  assert.equal(film.scenes[2].bundleDigest, "dig-fresh-g3");
  assert.equal(film.scenes[2].measuredYet, true);
  assert.equal(film.scenes[3].bundleDigest, "dig-s3-queued-fresh-g5");
  assert.equal(film.scenes[3].measuredYet, true);
});

test("(4) An env failure retries transient failure at most 2 times with backoff, logs one structured warning, and posts kind:'env' once with no infinite retry", async (t) => {
  let failSceneAttempts = 0;
  let transientRecoverAttempts = 0;

  const tr = makeProactiveTransport({
    drawMsDraft: 5,
    spawnDelayMs: 2,
    initDelayMs: 2,
    frameDelayMs: 2,
    onSceneFrame({ sceneTag, msg }) {
      if (sceneTag === "2-env-crash" && msg.n === 0) {
        failSceneAttempts++;
        return { failMessage: "Worker terminated (crash: WebGL context lost)" };
      }
      if (sceneTag === "3-transient" && msg.n === 0) {
        transientRecoverAttempts++;
        if (transientRecoverAttempts === 1) {
          return { failMessage: "Watchdog timeout (frame-timeout) after 2000ms" };
        }
      }
    }
  });

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  t.after(() => {
    console.warn = origWarn;
  });

  const posted = [];
  const events = [];

  const film = createFilmPlayer({
    projectId: "proj-env-fail",
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-e-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => 0, playing: () => false },
    transportFactory: tr.factory,
    checkRetryBackoffMs: [10, 20],
    checkWatchdogMs: 500,
    reportCheck: async (_projectId, variantId, payload) => {
      posted.push({ variantId, ...payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "bundled", fallback: true };
    },
    onCheckReport: (ev) => {
      events.push(ev);
    }
  });
  t.after(() => film.destroy());

  await film.mount(fakeElement());

  // Sub-case A: Scene 2 crashes on every attempt -> retries 2 times (3 attempts total), posts kind:"env" once, never loops
  await film.updateScene(2, {
    id: "s2",
    state: "bundled",
    variantId: "var-env-crash",
    gen: 1,
    bundleDigest: "dig-env-crash",
    html: "<script>/*scene-2-env-crash*/window.FILM={};</script>",
    frames: 60
  });

  // Sub-case B: Scene 3 fails once transiently then succeeds on retry 1 -> posts ok:true once
  await film.updateScene(3, {
    id: "s3",
    state: "bundled",
    variantId: "var-transient-ok",
    gen: 1,
    bundleDigest: "dig-transient-ok",
    html: "<script>/*scene-3-transient*/window.FILM={};</script>",
    frames: 60
  });

  // Sub-case C: Scene 4 in an unsupported/unverified environment -> posts kind:"env" once immediately with 0 Worker retries
  await film.updateScene(4, {
    id: "s4",
    state: "bundled",
    variantId: "var-unsupported-env",
    gen: 1,
    bundleDigest: "dig-unsupported-env",
    html: "<script>/*scene-4-unsupported*/window.FILM={};</script>",
    frames: 60,
    environment: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15"
  });

  await film.waitForChecks();
  // Wait extra time to prove there is no infinite retry loop
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(failSceneAttempts, 3, "crashing scene ran 1 initial attempt + 2 retries = 3 attempts total, then stopped");
  assert.equal(
    events.find((e) => e.variantId === "var-transient-ok")?.attempts,
    2,
    "transiently failing scene succeeded on retry 1 (attempt 2)"
  );
  assert.equal(
    transientRecoverAttempts,
    4,
    "frame 0 was requested 1 time on failed attempt 1 + 2 times in runCheck pass1/pass2 + 1 time in measure() on attempt 2"
  );

  const crashReports = posted.filter((p) => p.variantId === "var-env-crash");
  assert.equal(crashReports.length, 1, "env failure posts check report exactly once");
  assert.equal(crashReports[0].results.ok, false);
  assert.equal(crashReports[0].results.kind, "env");
  assert.equal(film.decision(2).mode, "clip");
  assert.equal(film.decision(2).reason, "check-env");

  const recoveredReports = posted.filter((p) => p.variantId === "var-transient-ok");
  assert.equal(recoveredReports.length, 1, "recovered scene posts check report once");
  assert.equal(recoveredReports[0].results.ok, true);
  assert.equal(recoveredReports[0].results.drawMsMedian, 5);
  assert.equal(film.scenes[3].measuredYet, true);

  const unsupportedReports = posted.filter((p) => p.variantId === "var-unsupported-env");
  assert.equal(unsupportedReports.length, 1, "unsupported environment posts kind:'env' once");
  assert.equal(unsupportedReports[0].results.ok, false);
  assert.equal(unsupportedReports[0].results.kind, "env");
  assert.equal(
    tr.spawns.filter((s) => s.sceneTag === "4-unsupported").length,
    0,
    "unsupported environment spawns 0 Workers"
  );

  // Verify structured console warnings: 1 per episode (1 for crash episode, 1 for transient recovery, 1 for unsupported env)
  const parsedWarnings = warnings
    .map((w) => {
      try {
        return JSON.parse(w);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  assert.equal(
    parsedWarnings.filter((w) => w.variantId === "var-env-crash" && w.event === "live_check_env_failure").length,
    1,
    "exactly one structured console warning logged for the 3-attempt crash episode"
  );
  assert.equal(
    parsedWarnings.find((w) => w.variantId === "var-env-crash")?.attempts,
    3
  );
  assert.equal(
    parsedWarnings.filter((w) => w.variantId === "var-transient-ok" && w.event === "live_check_recovered_after_retry").length,
    1,
    "one structured console warning logged for the transient recovery episode"
  );
});

test("(5) Hidden-tab check timeout is inconclusive (posts nothing, does not demote, re-checks on visibilitychange with cap 3), and init timeout is retried once when visible", async (t) => {
  const savedDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const visListeners = new Set();
  const fakeDoc = {
    hidden: true,
    visibilityState: "hidden",
    addEventListener(type, cb) {
      if (type === "visibilitychange") visListeners.add(cb);
    },
    removeEventListener(type, cb) {
      if (type === "visibilitychange") visListeners.delete(cb);
    },
    dispatchVisibilityChange() {
      for (const cb of [...visListeners]) {
        cb();
      }
    }
  };
  Object.defineProperty(globalThis, "document", {
    value: fakeDoc,
    configurable: true,
    writable: true
  });
  t.after(() => {
    if (savedDoc) Object.defineProperty(globalThis, "document", savedDoc);
    else delete globalThis.document;
  });

  let s1InitAttempts = 0;
  let s2FrameCalls = 0;
  let forceHiddenTimeoutOnS0 = true;

  const tr = makeProactiveTransport({
    drawMsDraft: 16,
    spawnDelayMs: 2,
    initDelayMs: 2,
    frameDelayMs: 2,
    onSceneInit({ sceneTag, msg }) {
      if (sceneTag === "1-init-retry" && msg.scale === 1) {
        s1InitAttempts++;
        if (s1InitAttempts === 1) {
          return { failMessage: "Watchdog timeout (init-timeout) after 2000ms" };
        }
      }
    },
    onSceneFrame({ sceneTag }) {
      if (sceneTag === "0-hidden-watchdog" && (fakeDoc.hidden || forceHiddenTimeoutOnS0)) {
        return { failMessage: "Watchdog timeout (frame-timeout) after 2000ms" };
      }
      if (sceneTag === "2-always-hidden-timeout") {
        s2FrameCalls++;
        fakeDoc.hidden = true;
        fakeDoc.visibilityState = "hidden";
        return { failMessage: "Watchdog timeout (frame-timeout) after 2000ms" };
      }
    }
  });

  const posted = [];
  const film = createFilmPlayer({
    projectId: "324093f5-hidden-tab",
    scenes: [
      {
        id: "s0",
        state: "bundled",
        needsCheck: true,
        variantId: "var-s0-hidden",
        gen: 1,
        bundleDigest: "dig-s0-hidden",
        html: "<script>/*scene-0-hidden-watchdog*/window.FILM={};</script>",
        frames: 60
      },
      {
        id: "s1",
        state: "checked",
        variantId: "var-s1-init",
        gen: 1,
        bundleDigest: "dig-s1-init",
        html: "<script>/*scene-1-init-retry*/window.FILM={};</script>",
        frames: 60
      }
    ],
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => 0, playing: () => false },
    transportFactory: tr.factory,
    checkRetryBackoffMs: [5, 10],
    checkWatchdogMs: 200,
    reportCheck: async (_projectId, variantId, payload) => {
      posted.push({ variantId, ...payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    }
  });
  t.after(() => film.destroy());

  await film.mount(fakeElement());
  await film.waitForChecks();

  // While document.hidden === true, s0 timed out on watchdog:
  // It must post NOTHING to the server and must NOT demote s0 to clip!
  assert.equal(posted.length, 0, "check that times out while document.hidden posts nothing to the server");
  assert.equal(film.decision(0).mode, "live", "check that times out while document.hidden does not demote to clip");
  assert.equal(
    film.checkTracker.hasCompleted("var-s0-hidden", 1, "dig-s0-hidden"),
    false,
    "inconclusive hidden check is not marked completed in CheckOnceTracker"
  );

  // Now the tab becomes visible: s0 re-checks once and s1 checks with 1 init timeout retry while visible!
  forceHiddenTimeoutOnS0 = false;
  fakeDoc.hidden = false;
  fakeDoc.visibilityState = "visible";
  fakeDoc.dispatchVisibilityChange();

  // Also queue s1 (which fails init once with init-timeout while visible, then succeeds on its 1 retry)
  await film.updateScene(1, {
    id: "s1",
    state: "bundled",
    needsCheck: true,
    variantId: "var-s1-init",
    gen: 2,
    bundleDigest: "dig-s1-init-g2",
    html: "<script>/*scene-1-init-retry*/window.FILM={};</script>",
    frames: 60
  });

  await film.waitForChecks();

  const s0Posts = posted.filter((p) => p.variantId === "var-s0-hidden");
  assert.equal(s0Posts.length, 1, "s0 re-checked once after visibility returned and posted ok:true");
  assert.equal(s0Posts[0].results.ok, true);
  assert.equal(s0Posts[0].results.drawMsMedian, 16);
  assert.equal(film.decision(0).mode, "live");

  const s1Posts = posted.filter((p) => p.variantId === "var-s1-init");
  assert.equal(s1Posts.length, 1, "s1 succeeded after 1 init timeout retry while visible");
  assert.equal(s1Posts[0].results.ok, true);
  assert.equal(s1InitAttempts, 2, "s1 init at scale 1 was called twice (initial + 1 retry)");
  assert.equal(film.decision(1).mode, "live");

  // Verify cap of 3 visibility re-checks per (variant, gen, digest):
  await film.updateScene(0, {
    id: "s0",
    state: "bundled",
    needsCheck: true,
    variantId: "var-s0-cap",
    gen: 3,
    bundleDigest: "dig-s0-cap3",
    html: "<script>/*scene-2-always-hidden-timeout*/window.FILM={};</script>",
    frames: 60
  });
  await film.waitForChecks();
  assert.equal(s2FrameCalls, 1, "initial hidden attempt ran once");

  for (let ep = 1; ep <= 5; ep++) {
    fakeDoc.hidden = false;
    fakeDoc.visibilityState = "visible";
    fakeDoc.dispatchVisibilityChange();
    await film.waitForChecks();
  }
  assert.equal(s2FrameCalls, 4, "visibility re-checks are capped at 3 re-checks (1 initial + 3 re-checks = 4 total)");
  assert.equal(
    posted.filter((p) => p.variantId === "var-s0-cap").length,
    0,
    "never posted inconclusive hidden timeouts to the server"
  );
});
