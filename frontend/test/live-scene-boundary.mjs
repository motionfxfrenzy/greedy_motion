import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_NEXT_SCENE_HEAD_FRAMES, createFilmPlayer } from "../lib/live/index.ts";

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
 * Fake Worker transport where both spawning the Worker (iframe srcdoc + MessageChannel handshake) and
 * `init` (`FILM.mount(scale)`) are asynchronous, and `frame` only succeeds AFTER `init` has completed
 * on the current Worker transport.
 */
function makeTrackingTransport({
  drawMsDraft = 5,
  drawMsFull = 20,
  spawnDelayMs = 6,
  initDelayMs = 6,
  frameDelayMs = 2
} = {}) {
  let activeTransports = 0;
  const calls = [];
  const bitmaps = [];

  const factory = async () => {
    if (spawnDelayMs > 0) {
      await new Promise((r) => setTimeout(r, spawnDelayMs));
    }
    activeTransports++;
    let terminated = false;
    let initialized = false;
    const port = {
      onmessage: null,
      postMessage(msg) {
        if (terminated) return;
        if (msg.t === "init") {
          setTimeout(() => {
            if (terminated) return;
            initialized = true;
            port.onmessage?.({
              data: {
                t: "init",
                id: msg.id,
                w: 640,
                h: 360,
                meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 },
                capabilities: {
                  draftSupported: true,
                  seekAcceptsQuality: true,
                  profileVersion: "v1",
                  defaultDraftTargetVerticesPerFrame: 75000
                }
              }
            });
          }, initDelayMs);
        } else if (msg.t === "hb") {
          port.onmessage?.({ data: { t: "hb", id: msg.id } });
        } else if (msg.t === "dispose") {
          port.onmessage?.({ data: { t: "dispose", id: msg.id, ok: true } });
        } else if (msg.t === "frame") {
          setTimeout(() => {
            if (terminated) return;
            if (!initialized) {
              port.onmessage?.({
                data: {
                  t: "fail",
                  id: msg.id,
                  message: "Worker frame requested before init completed on respawned transport"
                }
              });
              return;
            }
            const qSpec = msg.qualitySpec;
            const mode =
              qSpec === "draft" || (typeof qSpec === "object" && qSpec !== null && qSpec.mode === "draft")
                ? "draft"
                : "full";
            const dMs = mode === "draft" ? drawMsDraft : drawMsFull;
            calls.push({ n: msg.n, mode, epoch: msg.epoch });
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
                epoch: msg.epoch
              }
            });
          }, frameDelayMs);
        }
      }
    };
    return {
      port,
      terminate() {
        if (!terminated) {
          terminated = true;
          activeTransports = Math.max(0, activeTransports - 1);
        }
      }
    };
  };

  return {
    factory,
    calls,
    bitmaps,
    get activeTransports() {
      return activeTransports;
    }
  };
}

async function waitForIdle(...players) {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 3));
    if (players.every((p) => !p.isPumping && !p.isPreparing)) return;
  }
}

test("(B) 5 scenes, Draft: play scene 1..3, let scene 5's player have been measured then released, then cross into scene 5 by showFrame only (no seek)", async (t) => {
  const tr = makeTrackingTransport({ drawMsDraft: 25, spawnDelayMs: 6, initDelayMs: 6, frameDelayMs: 2 });
  let timeSec = 0;
  let playing = true;

  const film = createFilmPlayer({
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-b-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: tr.factory,
    autoPump: true
  });
  t.after(() => film.destroy());

  const el = fakeElement();
  await film.mount(el);

  // Let scene 5 (index 4) be measured first, then released by Draft idle cleanup as scenes 0..2 play
  await film.scenes[4].measure();
  assert.equal(film.scenes[4].measuredYet, true);
  assert.equal(film.scenes[4].workerHost.hasActiveTransport, true);

  // Play scenes 0..2 up to frame 175 (still in scene 2, so scene 5 / index 4 is non-adjacent)
  for (let f = 0; f <= 175; f += 5) {
    timeSec = f / 30;
    film.showFrame(f);
    await waitForIdle(film.scenes[film.activeSceneIndex]);
  }
  assert.equal(film.activeSceneIndex, 2);
  assert.equal(film.scenes[4].measuredYet, true);
  assert.equal(
    film.scenes[4].workerHost.hasActiveTransport,
    false,
    "scene 5's Worker was released by Draft idle cleanup while non-adjacent"
  );
  assert.equal(film.scenes[4].cachedPreviewFrames().length, 0);

  // Cross into scene 3 (frame 180, 60-frame scene -> remainingInScene = 60 <= ceil(2.5 * 30) = 75)
  // and play scene 3 up to frame 209:
  for (let f = 180; f <= 209; f += 5) {
    timeSec = f / 30;
    film.showFrame(f);
    await waitForIdle(film.scenes[3]);
  }
  // Advance into frame 215 of scene 3:
  // Suppose scene 3 only has 5 frames buffered ahead at frame 215 (e.g. a slower draw in scene 3)
  for (const k of film.scenes[3].cachedPreviewFrames()) {
    if (k >= 40) film.cache.release(film.scenes[3].cacheKey, k);
  }
  timeSec = 215 / 30;
  film.showFrame(215);

  // Even when scene 3's runway is < 10 frames, scene 5 (current+1) whose Worker was released
  // must re-initialise its Worker transport and warm >= 30 frames into cache before scene 4 ends!
  assert.equal(
    film.scenes[4].workerHost.hasActiveTransport,
    true,
    "scene 5 (measured then released) must re-initialise its Worker when it is current+1 in the last 2.5 s of scene 4"
  );

  for (let f = 220; f <= 235; f += 5) {
    timeSec = f / 30;
    film.showFrame(215 + (f - 215));
    await waitForIdle(film.scenes[3], film.scenes[4]);
  }

  const cachedBeforeBoundary = film.scenes[4].cachedPreviewFrames().length;
  assert.ok(
    cachedBeforeBoundary >= 6,
    `before scene 4 ends, >= 6 frames of scene 5 must be cached/decoded (got ${cachedBeforeBoundary})`
  );
  assert.ok(film.scenes[4].readyAhead(0) >= 6);

  // Cross into scene 5 (index 4, global frame 240) by showFrame(240) ONLY (no seek)
  timeSec = 240 / 30;
  film.showFrame(240);

  assert.equal(film.activeSceneIndex, 4);
  assert.equal(
    film.scenes[4].workerHost.errors.length,
    0,
    `scene 5 Worker must not fail with race between frame() and init() (errors=${JSON.stringify(film.scenes[4].workerHost.errors)})`
  );
  assert.equal(film.scenes[4].workerHost.hasActiveTransport, true, "new scene 5 gets an active Worker transport");
  assert.ok(
    film.scenes[4].readyAhead(0) >= 6,
    `rolling window continues across boundary with >= 6 frames ahead (got ${film.scenes[4].readyAhead(0)})`
  );
  assert.equal(
    film.scenes[4].isBufferingNow,
    false,
    `scene 5 must switch at boundary with no buffering state (cached=${film.scenes[4].cachedPreviewFrames().length}, readyAhead=${film.scenes[4].readyAhead(0)}, state=${film.state})`
  );
  assert.equal(film.scenes[4].bufferingPauses, 0, "zero buffering pauses at boundary");
  assert.equal(film.state, "playing", "film state is playing, not stuck on buffering");
  assert.equal(film.scenes[4].lastPresentedSourceFrame, 0, "frame 0 blitted immediately at boundary");
});

test("(A) Scene 5 not ready at film start (decision unavailable) becomes ready mid-playback while playhead is in previous scene, then cross boundary without a seek", async (t) => {
  const tr = makeTrackingTransport({ drawMsDraft: 12, spawnDelayMs: 6, initDelayMs: 6, frameDelayMs: 2 });
  let timeSec = 0;
  let playing = true;

  // Scene 5 (index 4) starts not ready (unavailable / pending-live)
  const film = createFilmPlayer({
    scenes: [0, 1, 2, 3, 4].map((i) =>
      i < 4
        ? {
            id: `s${i}`,
            bundleDigest: `dig-a-${i}`,
            html: `<script>/*scene-${i}*/window.FILM={};</script>`,
            frames: 60
          }
        : {
            id: "s4",
            bundleDigest: "pending-4",
            html: "",
            frames: 60,
            forceClipReason: "pending-live"
          }
    ),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: tr.factory,
    autoPump: true
  });
  t.after(() => film.destroy());

  const el = fakeElement();
  await film.mount(el);
  assert.equal(film.decision(4).mode, "clip");
  assert.equal(film.decision(4).reason, "pending-live");

  // Play into scene 4 (index 3, frame 235)
  for (let f = 0; f <= 235; f += 5) {
    timeSec = f / 30;
    film.showFrame(f);
    await waitForIdle(film.scenes[film.activeSceneIndex]);
  }
  assert.equal(film.activeSceneIndex, 3);

  // Scene 5 (index 4) becomes ready mid-playback via updateScene(4, spec) while playhead is in scene 4 (index 3)
  await film.updateScene(4, {
    id: "s4",
    bundleDigest: "dig-a-4-ready",
    html: "<script>/*scene-4*/window.FILM={};</script>",
    frames: 60
  });

  // Assert that updating current+1 (scene 5 while in scene 4) immediately starts measuring/initialising it!
  assert.equal(
    film.scenes[4].workerHost.hasActiveTransport,
    true,
    "updating current+1 while in current scene must start measuring/initialising it without waiting for another showFrame"
  );

  // Let scene 5 finish its warm-up while playhead is still at frame 235 in scene 4
  await waitForIdle(film.scenes[3], film.scenes[4]);
  const cachedBeforeBoundary = film.scenes[4].cachedPreviewFrames().length;
  assert.ok(
    cachedBeforeBoundary >= 6,
    `scene 5 becoming ready mid-playback as current+1 warms >= 6 frames before boundary (got ${cachedBeforeBoundary})`
  );

  // Cross the boundary into scene 5 (frame 240) by showFrame(240) ONLY (no seek)
  timeSec = 240 / 30;
  film.showFrame(240);

  assert.equal(film.activeSceneIndex, 4);
  assert.equal(film.decision(4).mode, "live", "scene 5 decision is live");
  assert.equal(film.scenes[4].measuredYet, true, "scene 5 was measured");
  assert.equal(film.scenes[4].workerHost.hasActiveTransport, true, "scene 5 has an active Worker transport");
  assert.ok(film.scenes[4].readyAhead(0) >= 6, "scene 5 has >= 6 frames ready ahead at boundary");
  assert.equal(
    film.scenes[4].isBufferingNow,
    false,
    `scene 5 must not enter buffering at boundary (state=${film.state})`
  );
  assert.equal(film.scenes[4].bufferingPauses, 0, "scene 5 had 0 buffering pauses");
  assert.equal(film.scenes[4].isPreparing, false, "scene 5 is not stuck preparing");
  assert.equal(film.state, "playing", "film state is playing");
  assert.equal(film.scenes[4].lastPresentedSourceFrame, 0, "frame 0 was blitted onto scene 5 canvas");
});

test("(C) Scene 5 starts background measure as current+1 (activateOnMeasure=false), then playhead crosses into scene 5 before sampleFrames finishes: must fill start runway and never hang on Buffering", async (t) => {
  const tr = makeTrackingTransport({ drawMsDraft: 18, spawnDelayMs: 6, initDelayMs: 6, frameDelayMs: 10 });
  let timeSec = 0;
  let playing = true;

  const film = createFilmPlayer({
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-c-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 60
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: tr.factory,
    autoPump: true
  });
  t.after(() => film.destroy());

  const el = fakeElement();
  await film.mount(el);

  // Play into scene 4 (index 3) at frame 230
  timeSec = 230 / 30;
  film.showFrame(230);
  await waitForIdle(film.scenes[3]);

  // Trigger frame 238 so `showFrame` kicks off `next.measure()` for scene 5 (index 4) while scene 4 is active
  timeSec = 238 / 30;
  film.showFrame(238);
  assert.equal(film.scenes[4].measuredYet, false, "scene 5 is mid-measure (sampleFrames in flight)");

  // Before scene 5's `sampleFrames` finishes, the playhead crosses into scene 5 (frame 240) by showFrame(240) ONLY
  timeSec = 240 / 30;
  film.showFrame(240);
  assert.equal(film.activeSceneIndex, 4);

  // Wait for scene 5's in-flight `doMeasure()` + pump to finish (without any seek!)
  await new Promise((r) => setTimeout(r, 250));
  await waitForIdle(film.scenes[4]);

  assert.equal(film.scenes[4].measuredYet, true, "scene 5 finished measuring");
  assert.ok(
    film.scenes[4].cachedPreviewFrames().length >= 15,
    `scene 5 must fill its 15-frame Draft start runway even when measure started while inactive (got ${film.scenes[4].cachedPreviewFrames().length})`
  );
  assert.equal(film.scenes[4].isBufferingNow, false, "scene 5 is not buffering");
  assert.equal(film.state, "playing", "film state is playing");
  assert.equal(film.scenes[4].lastPresentedSourceFrame, 0, "frame 0 was blitted onto scene 5 canvas");
});

test("(D) Proactive background checking: a revised scene arriving as bundled/not-yet-checked while playhead is elsewhere is checked one at a time in idle gaps with peakWorkersDuringPlay <= 2 and posts its check report", async (t) => {
  const { parseGenFromBundleUrl } = await import("../lib/live/index.ts");
  assert.equal(
    parseGenFromBundleUrl("https://r2.example.com/uploads/plates/316f1cbd/16x9/2/g3/bundles/abc123/bundle.html", 1),
    3,
    "parseGenFromBundleUrl extracts gen=3 from /g3/bundles/<sha>/bundle.html"
  );

  let peakWorkersDuringPlay = 0;
  const baseTr = makeTrackingTransport({ drawMsDraft: 6, spawnDelayMs: 3, initDelayMs: 3, frameDelayMs: 2 });
  const trackingFactory = async () => {
    const inst = await baseTr.factory();
    peakWorkersDuringPlay = Math.max(peakWorkersDuringPlay, baseTr.activeTransports);
    return inst;
  };

  let timeSec = 0;
  let playing = true;
  const postedReports = [];

  const film = createFilmPlayer({
    scenes: [0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      bundleDigest: `dig-d-${i}`,
      html: `<script>/*scene-${i}*/window.FILM={};</script>`,
      frames: 90
    })),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: trackingFactory,
    autoPump: true,
    onCheckReport: (rep) => {
      postedReports.push(rep);
    }
  });
  t.after(() => film.destroy());

  const el = fakeElement();
  await film.mount(el);

  // Playhead stays in scene 0 (frames 0..10), far away from scenes 2 and 4
  timeSec = 5 / 30;
  film.showFrame(5);
  await waitForIdle(film.scenes[0]);
  assert.equal(film.activeSceneIndex, 0);

  // Now scene 2 (gen 3, rev 1 — like the stuck comment-revised scene) and scene 4 arrive as 'bundled' (needsCheck: true)
  // while the playhead stays in scene 0!
  await film.updateScene(2, {
    id: "s2",
    variantId: "6806947c-7800-42df-a0e3-255ec930e16e",
    gen: 3,
    state: "bundled",
    needsCheck: true,
    bundleDigest: "dig-d-2-gen3",
    html: "<script>/*scene-2-gen3*/window.FILM={};</script>",
    frames: 90,
    manifest: { W: 1920, H: 1080, fps: 30, durationFrames: 90 }
  });

  await film.updateScene(4, {
    id: "s4",
    variantId: "11111111-2222-4333-8444-555555555555",
    gen: 2,
    state: "bundled",
    needsCheck: true,
    bundleDigest: "dig-d-4-gen2",
    html: "<script>/*scene-4-gen2*/window.FILM={};</script>",
    frames: 90,
    manifest: { W: 1920, H: 1080, fps: 30, durationFrames: 90 }
  });

  // Advance playhead slightly inside scene 0 while proactive checks run in idle gaps
  for (let f = 6; f <= 12; f++) {
    timeSec = f / 30;
    film.showFrame(f);
    await new Promise((r) => setTimeout(r, 8));
  }

  await film.pendingChecks();

  assert.equal(postedReports.length, 2, "both non-active bundled scenes were proactively checked and reported");
  assert.deepEqual(
    postedReports.map((r) => ({ sceneIndex: r.sceneIndex, variantId: r.variantId, gen: r.gen, bundleDigest: r.bundleDigest, ok: r.results.ok })),
    [
      {
        sceneIndex: 2,
        variantId: "6806947c-7800-42df-a0e3-255ec930e16e",
        gen: 3,
        bundleDigest: "dig-d-2-gen3",
        ok: true
      },
      {
        sceneIndex: 4,
        variantId: "11111111-2222-4333-8444-555555555555",
        gen: 2,
        bundleDigest: "dig-d-4-gen2",
        ok: true
      }
    ]
  );
  assert.ok(
    peakWorkersDuringPlay <= 2,
    `peakWorkersDuringPlay must be <= 2 during playback and proactive checking (got ${peakWorkersDuringPlay})`
  );
  assert.equal(
    baseTr.activeTransports,
    1,
    "after proactive checks complete, check Workers are destroyed and only active scene 0 holds a Worker"
  );
});

test("(E) 7-scene film straight play (Draft and Full): >= 6 frames (Draft) / >= 30 frames (Full) of N+1 cached before every boundary, zero buffering across all 6 boundaries, rolling window never drops to zero, peakWorkersDuringPlay <= 2, and cache stays within budget", async (t) => {
  assert.equal(
    DRAFT_NEXT_SCENE_HEAD_FRAMES,
    6,
    `DRAFT_NEXT_SCENE_HEAD_FRAMES must be 6 (got ${DRAFT_NEXT_SCENE_HEAD_FRAMES})`
  );

  for (const renderMode of ["draft", "full"]) {
    const minPreBoundaryFrames = renderMode === "draft" ? DRAFT_NEXT_SCENE_HEAD_FRAMES : 30;
    let peakWorkersDuringPlay = 0;
    const baseTr = makeTrackingTransport({
      drawMsDraft: 6,
      drawMsFull: 12,
      spawnDelayMs: 3,
      initDelayMs: 3,
      frameDelayMs: 1
    });
    const trackingFactory = async () => {
      const inst = await baseTr.factory();
      peakWorkersDuringPlay = Math.max(peakWorkersDuringPlay, baseTr.activeTransports);
      return inst;
    };

    let timeSec = 0;
    let playing = true;
    const framesPerScene = 90; // 3.0 s per scene at 30 fps
    const sceneCount = 7;
    const totalFrames = framesPerScene * sceneCount;

    const film = createFilmPlayer({
      scenes: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        id: `s${i}`,
        bundleDigest: `dig-7s-${renderMode}-${i}`,
        html: `<script>/*scene-${i}*/window.FILM={};</script>`,
        frames: framesPerScene
      })),
      fps: 30,
      renderMode,
      frameStore: null,
      timeSource: { currentTime: () => timeSec, playing: () => playing },
      transportFactory: trackingFactory,
      autoPump: true
    });
    t.after(() => film.destroy());

    const bufferingEvents = [];
    film.on("buffering", (ev) => {
      bufferingEvents.push(ev);
    });

    const el = fakeElement();
    await film.mount(el);
    await waitForIdle(film.scenes[0]);

    assert.equal(film.state, "playing", `[${renderMode}] initial scene 0 is playing after mount`);

    // In Draft mode, at frame 5 of scene 0 (remainingInScene = 85 > ceil(2.5*30) = 75), scene 1 has not started warming yet,
    // and scenes 2..6 beyond current+1 are never warmed.
    timeSec = 5 / 30;
    film.showFrame(5);
    if (renderMode === "draft") {
      assert.equal(
        film.scenes[1].workerHost.hasActiveTransport,
        false,
        "[draft] before entering the last 2.5 s of scene 0 (frame 5, remaining=85), scene 1 is not warmed yet"
      );
    }
    for (let farIdx = 2; farIdx < sceneCount; farIdx++) {
      assert.equal(
        film.scenes[farIdx].workerHost.hasActiveTransport,
        false,
        `[${renderMode}] scene ${farIdx} beyond current+1 is never warmed while in scene 0`
      );
      assert.equal(film.scenes[farIdx].cachedPreviewFrames().length, 0);
    }

    const cachedBeforeEachBoundary = [];
    const aheadAtEachBoundarySwitch = [];
    let peakCacheBytes = film.cache.bytes;

    // Play straight through all 7 scenes (frames 0 .. 629)
    for (let f = 5; f < totalFrames; f += 5) {
      timeSec = f / 30;
      film.showFrame(f);
      const curIdx = film.activeSceneIndex;
      const nextScene = film.scenes[curIdx + 1];
      if (nextScene) {
        await waitForIdle(film.scenes[curIdx], nextScene);
      } else {
        await waitForIdle(film.scenes[curIdx]);
      }

      peakCacheBytes = Math.max(peakCacheBytes, film.cache.bytes);
      assert.ok(
        film.cache.bytes <= film.cache.budget,
        `[${renderMode}] cache bytes (${film.cache.bytes}) never exceeds budget (${film.cache.budget}) at frame ${f}`
      );

      // Verify scenes beyond current+1 are never warmed or holding Workers
      for (let k = curIdx + 2; k < sceneCount; k++) {
        assert.equal(
          film.scenes[k].workerHost.hasActiveTransport,
          false,
          `[${renderMode}] scene ${k} (> current+1=${curIdx + 1}) must not hold a Worker at frame ${f}`
        );
      }

      const localFrame = f % framesPerScene;
      // Right before each scene boundary (localFrame === 85, 5 frames before the boundary):
      if (localFrame === framesPerScene - 5 && curIdx < sceneCount - 1) {
        const nextCached = film.scenes[curIdx + 1].cachedPreviewFrames().length;
        const nextReadyAhead = film.scenes[curIdx + 1].readyAhead(0);
        cachedBeforeEachBoundary.push(nextCached);
        assert.ok(
          nextCached >= minPreBoundaryFrames && nextReadyAhead >= minPreBoundaryFrames,
          `[${renderMode}] before scene ${curIdx} ends, scene ${curIdx + 1} must have >= ${minPreBoundaryFrames} frames cached/decoded (got cached=${nextCached}, readyAhead=${nextReadyAhead})`
        );
      }

      // At the first frame of each new scene 1..6 (localFrame === 0 && curIdx > 0):
      if (localFrame === 0 && curIdx > 0) {
        const aheadAtSwitch = film.scenes[curIdx].readyAhead(0);
        aheadAtEachBoundarySwitch.push(aheadAtSwitch);
        assert.ok(
          aheadAtSwitch >= minPreBoundaryFrames,
          `[${renderMode}] rolling window continues across boundary ${curIdx - 1}->${curIdx}: frames ahead must be >= ${minPreBoundaryFrames} (got ${aheadAtSwitch})`
        );
        assert.equal(
          film.scenes[curIdx].isBufferingNow,
          false,
          `[${renderMode}] scene ${curIdx} switches at boundary with no buffering state`
        );
        assert.equal(film.state, "playing", `[${renderMode}] film stays in playing state across boundary ${curIdx - 1}->${curIdx}`);
      }

      assert.equal(
        film.state,
        "playing",
        `[${renderMode}] straight-through playback stays in playing state at frame ${f} (scene ${curIdx})`
      );
    }

    assert.equal(cachedBeforeEachBoundary.length, 6, `[${renderMode}] measured all 6 boundaries of the 7-scene film`);
    assert.ok(
      cachedBeforeEachBoundary.every((n) => n >= minPreBoundaryFrames),
      `[${renderMode}] every boundary had >= ${minPreBoundaryFrames} frames cached before the boundary: ${JSON.stringify(cachedBeforeEachBoundary)}`
    );
    assert.equal(aheadAtEachBoundarySwitch.length, 6);
    assert.ok(
      aheadAtEachBoundarySwitch.every((n) => n >= minPreBoundaryFrames),
      `[${renderMode}] every boundary switch kept >= ${minPreBoundaryFrames} frames ahead: ${JSON.stringify(aheadAtEachBoundarySwitch)}`
    );
    assert.equal(
      film.bufferingPauses,
      0,
      `[${renderMode}] straight play across all 7 scenes never enters buffering (bufferingPauses=${film.bufferingPauses})`
    );
    assert.equal(
      bufferingEvents.length,
      0,
      `[${renderMode}] zero buffering events emitted during straight-through play`
    );
    assert.ok(
      peakWorkersDuringPlay <= 2,
      `[${renderMode}] peakWorkersDuringPlay (${peakWorkersDuringPlay}) must be <= 2`
    );
    assert.ok(
      peakCacheBytes <= film.cache.budget,
      `[${renderMode}] peakCacheBytes (${peakCacheBytes}) <= budget (${film.cache.budget})`
    );
  }
});

test("(F) Scenes becoming ready mid-playback (both non-adjacent and already-next) are warmed once they are next, and seeks to unvisited places may buffer briefly and recover", async (t) => {
  let peakWorkersDuringPlay = 0;
  const baseTr = makeTrackingTransport({
    drawMsDraft: 6,
    spawnDelayMs: 3,
    initDelayMs: 3,
    frameDelayMs: 1
  });
  const trackingFactory = async () => {
    const inst = await baseTr.factory();
    peakWorkersDuringPlay = Math.max(peakWorkersDuringPlay, baseTr.activeTransports);
    return inst;
  };

  let timeSec = 0;
  let playing = true;

  // 6-scene film (60 frames each): scene 2 and scene 3 start as not-ready (pending-live)
  const film = createFilmPlayer({
    scenes: [0, 1, 2, 3, 4, 5].map((i) =>
      i === 2 || i === 3
        ? {
            id: `s${i}`,
            bundleDigest: `pending-f-${i}`,
            html: "",
            frames: 60,
            forceClipReason: "pending-live"
          }
        : {
            id: `s${i}`,
            bundleDigest: `dig-f-${i}`,
            html: `<script>/*scene-${i}*/window.FILM={};</script>`,
            frames: 60
          }
    ),
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: trackingFactory,
    autoPump: true
  });
  t.after(() => film.destroy());

  const el = fakeElement();
  await film.mount(el);
  await waitForIdle(film.scenes[0], film.scenes[1]);

  // 1. While playing in scene 0 (frame 5), scene 2 (non-adjacent: index 2 > activeIdx + 1) becomes ready on the server!
  timeSec = 5 / 30;
  film.showFrame(5);
  await waitForIdle(film.scenes[0]);
  await film.updateScene(2, {
    id: "s2",
    bundleDigest: "dig-f-2-ready",
    html: "<script>/*scene-2*/window.FILM={};</script>",
    frames: 60
  });

  // Because scene 2 is beyond current+1 while playhead is in scene 0, it must NOT be warmed yet
  assert.equal(
    film.scenes[2].workerHost.hasActiveTransport,
    false,
    "scene 2 becoming ready while playhead is in scene 0 is not warmed before it becomes current+1"
  );
  assert.equal(film.scenes[2].cachedPreviewFrames().length, 0);

  // 2. Play through scene 0 into scene 1 (frames 10..115): once in scene 1, scene 2 IS next (current+1) and warms >= 6 frames!
  for (let f = 10; f <= 115; f += 5) {
    timeSec = f / 30;
    film.showFrame(f);
    await waitForIdle(film.scenes[film.activeSceneIndex], film.scenes[film.activeSceneIndex + 1]);
  }
  assert.equal(film.activeSceneIndex, 1);
  assert.ok(
    film.scenes[2].cachedPreviewFrames().length >= 6,
    `scene 2 (ready mid-playback) warmed >= 6 frames once it became next (got ${film.scenes[2].cachedPreviewFrames().length})`
  );

  // Cross into scene 2 (frame 120): zero buffering!
  timeSec = 120 / 30;
  film.showFrame(120);
  assert.equal(film.activeSceneIndex, 2);
  assert.equal(film.scenes[2].isBufferingNow, false);
  assert.equal(film.bufferingPauses, 0);

  // 3. While playing in scene 2 (at frame 160, remainingInScene = 20 <= 75), scene 3 (which IS already next = current+1)
  //    becomes ready on the server via updateScene(3, ...): warms immediately!
  for (let f = 125; f <= 160; f += 5) {
    timeSec = f / 30;
    film.showFrame(f);
    await waitForIdle(film.scenes[2]);
  }
  await film.updateScene(3, {
    id: "s3",
    bundleDigest: "dig-f-3-ready",
    html: "<script>/*scene-3*/window.FILM={};</script>",
    frames: 60
  });
  await waitForIdle(film.scenes[2], film.scenes[3]);
  assert.ok(
    film.scenes[3].cachedPreviewFrames().length >= 6,
    `scene 3 (becoming ready while already current+1) warmed >= 6 frames before boundary (got ${film.scenes[3].cachedPreviewFrames().length})`
  );

  // Cross into scene 3 (frame 180): zero buffering!
  timeSec = 180 / 30;
  film.showFrame(180);
  assert.equal(film.activeSceneIndex, 3);
  assert.equal(film.scenes[3].isBufferingNow, false);
  assert.equal(film.bufferingPauses, 0, "straight play across scenes 0..3 had 0 buffering pauses");
  assert.ok(peakWorkersDuringPlay <= 2, `peakWorkersDuringPlay (${peakWorkersDuringPlay}) <= 2`);

  // 4. Requirement 5: Seeking to an unvisited place (e.g. frame 330 in scene 5) may buffer briefly, then resumes cleanly
  timeSec = 330 / 30;
  film.showFrame(330);
  assert.equal(film.activeSceneIndex, 5);
  await waitForIdle(film.scenes[5]);
  film.showFrame(330);
  assert.equal(film.scenes[5].isBufferingNow, false, "unvisited seek recovers from brief buffer once runway is drawn");
  assert.equal(film.state, "playing");
  assert.ok(film.cache.bytes <= film.cache.budget);
});

test("(G) Mixed live/clip boundary (fake workers: scene k is clip, others live): no buffering state at live->clip and clip->live when clip is ready; clip-not-ready boundary reports cause 'clip'; slow check posts ok:true with drawMs, demotes on server {state:'bundled', playback:'clip'}, and logs slow-scene trace", async (t) => {
  const {
    SLOW_DRAW_MEDIAN_MS,
    SLOW_DRAW_P90_MS,
    clearLiveTraceLog,
    getLiveTraceLog
  } = await import("../lib/live/index.ts");
  const { bufferingCause, sceneProgress } = await import("../components/animation-workspace/progress.ts");

  let peakWorkersDuringPlay = 0;
  const baseTr = makeTrackingTransport({
    drawMsDraft: 6,
    spawnDelayMs: 3,
    initDelayMs: 3,
    frameDelayMs: 1
  });
  const trackingFactory = async (workerSource) => {
    const isSlowScene = String(workerSource ?? "").includes("/*slow-scene*/");
    const tr = isSlowScene
      ? makeTrackingTransport({ drawMsDraft: 185, drawMsFull: 210, spawnDelayMs: 2, initDelayMs: 2, frameDelayMs: 1 })
      : baseTr;
    const inst = await tr.factory(workerSource);
    peakWorkersDuringPlay = Math.max(peakWorkersDuringPlay, baseTr.activeTransports);
    return inst;
  };

  // 1. Slow check reports ok:true with drawMs:{ medianMs, p90Ms }, demotes on server { state:"bundled", playback:"clip" },
  //    releases Worker, does not retry or report a second time for that digest, and logs slow-scene trace with server decision
  globalThis.__gmLiveTrace = true;
  clearLiveTraceLog();
  t.after(() => {
    delete globalThis.__gmLiveTrace;
    clearLiveTraceLog();
  });

  const postedPayloads = [];
  const checkReports = [];
  const checkFilm = createFilmPlayer({
    projectId: "49e78637-crayon",
    scenes: [
      {
        id: "s0",
        variantId: "var-fast-0",
        gen: 1,
        state: "bundled",
        needsCheck: true,
        bundleDigest: "dig-fast-0",
        html: "<script>/*fast-scene-0*/window.FILM={};</script>",
        frames: 90,
        manifest: { W: 1920, H: 1080, fps: 30, durationFrames: 90 }
      },
      {
        id: "s1",
        variantId: "var-slow-1",
        gen: 1,
        state: "bundled",
        needsCheck: true,
        bundleDigest: "dig-slow-1",
        html: "<script>/*slow-scene*/window.FILM={};</script>",
        frames: 90,
        manifest: { W: 1920, H: 1080, fps: 30, durationFrames: 90 }
      }
    ],
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => 0, playing: () => false },
    transportFactory: trackingFactory,
    reportCheck: async (_projectId, variantId, payload) => {
      postedPayloads.push({ variantId, payload });
      const d = payload.results?.drawMs;
      if (d && (d.medianMs > SLOW_DRAW_MEDIAN_MS || d.p90Ms > SLOW_DRAW_P90_MS)) {
        return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "bundled", playback: "clip" };
      }
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    },
    onCheckReport: (rep) => checkReports.push(rep)
  });
  t.after(() => checkFilm.destroy());

  await checkFilm.mount(fakeElement());
  await checkFilm.waitForChecks();

  assert.equal(checkReports.length, 2);
  assert.equal(postedPayloads.length, 2);
  const fastRep = checkReports.find((r) => r.sceneIndex === 0);
  const slowRep = checkReports.find((r) => r.sceneIndex === 1);
  assert.ok(fastRep && slowRep);
  assert.equal(fastRep.outcome.ok, true);
  assert.deepEqual(fastRep.outcome.drawMs, { medianMs: 6, p90Ms: 6 });
  assert.equal(fastRep.response.state, "checked");
  assert.equal(fastRep.response.playback, undefined);

  assert.equal(slowRep.outcome.ok, true, "slow scene reports a successful check with drawMs");
  assert.deepEqual(slowRep.outcome.drawMs, { medianMs: 185, p90Ms: 185 });
  assert.deepEqual(slowRep.outcome.results?.drawMs, { medianMs: 185, p90Ms: 185 });
  assert.equal(slowRep.attempts, 1, "does not retry the check");
  assert.equal(slowRep.response.state, "bundled");
  assert.equal(slowRep.response.playback, "clip");
  assert.equal(checkFilm.decision(1).mode, "clip", "slow scene is demoted to clip mode on server response");
  assert.equal(checkFilm.decision(1).reason, "slow-draw");
  assert.equal(checkFilm.scenes[1].workerHost?.hasActiveTransport ?? false, false, "slow clip scene holds no drawing Worker");

  // Re-enqueuing check for the same digest must NOT report a second time
  checkFilm.enqueueSceneCheck(1);
  await checkFilm.waitForChecks();
  assert.equal(postedPayloads.length, 2, "does not report again for the same digest");

  const traceEntries = getLiveTraceLog().filter((e) => e.kind === "slow-scene");
  assert.equal(traceEntries.length, 2);
  assert.deepEqual(
    traceEntries.map((e) => ({ sceneIndex: e.sceneIndex, median: e.median, p90: e.p90, decision: e.decision })),
    [
      { sceneIndex: 0, median: 6, p90: 6, decision: "live" },
      { sceneIndex: 1, median: 185, p90: 185, decision: "clip" }
    ]
  );
  assert.ok(traceEntries.every((e) => e.n >= 5), "both slow-scene trace entries measured >= 5 alone samples");

  // 2. Mixed live/clip film playback: Scene 0 (live) -> Scene 1 (clip, ready) -> Scene 2 (live)
  //    Verify zero buffering state at live->clip and clip->live boundaries, seeking in both kinds, and peakWorkersDuringPlay <= 2!
  peakWorkersDuringPlay = 0;
  let timeSec = 0;
  let playing = true;
  const mixedFilm = createFilmPlayer({
    scenes: [
      { id: "s0", bundleDigest: "dig-m-0", html: "<script>/*scene-0*/window.FILM={};</script>", frames: 60 },
      {
        id: "s1",
        bundleDigest: "dig-m-1",
        html: "",
        frames: 60,
        state: "drawn",
        playback: "clip",
        drawMsPerFrame: 185,
        hasClip: true,
        clipReady: true
      },
      { id: "s2", bundleDigest: "dig-m-2", html: "<script>/*scene-2*/window.FILM={};</script>", frames: 60 }
    ],
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => playing },
    transportFactory: trackingFactory,
    autoPump: true
  });
  t.after(() => mixedFilm.destroy());

  const mixedBufferingEvents = [];
  mixedFilm.on("buffering", (ev) => mixedBufferingEvents.push(ev));

  await mixedFilm.mount(fakeElement());
  await waitForIdle(mixedFilm.scenes[0]);

  assert.equal(mixedFilm.decision(0).mode, "live");
  assert.equal(mixedFilm.decision(1).mode, "clip");
  assert.equal(mixedFilm.decision(1).reason, "slow-draw");
  assert.equal(mixedFilm.decision(2).mode, "live");
  assert.equal(mixedFilm.scenes[1].workerHost, null, "clip scene creates no drawing Worker");

  // Play through Scene 0 (frames 0..59) -> cross live->clip boundary into Scene 1 (frames 60..119) -> cross clip->live boundary into Scene 2 (frames 120..179)
  for (let f = 0; f < 180; f += 5) {
    timeSec = f / 30;
    mixedFilm.showFrame(f);
    const curIdx = mixedFilm.activeSceneIndex;
    const nxt = mixedFilm.scenes[curIdx + 1];
    if (nxt && nxt.decision().mode === "live") {
      await waitForIdle(mixedFilm.scenes[curIdx], nxt);
    } else {
      await waitForIdle(mixedFilm.scenes[curIdx]);
    }
    assert.equal(
      mixedFilm.state,
      "playing",
      `mixed film stays in 'playing' state across live->clip and clip->live at frame ${f} (scene ${curIdx})`
    );
    assert.equal(
      mixedFilm.scenes[curIdx].isBufferingNow,
      false,
      `no buffering state entered at frame ${f} (scene ${curIdx})`
    );
  }

  assert.equal(mixedFilm.bufferingPauses, 0, "zero buffering pauses across live->clip and clip->live boundaries");
  assert.equal(mixedBufferingEvents.length, 0, "zero buffering events emitted");
  assert.ok(peakWorkersDuringPlay <= 2, `peakWorkersDuringPlay (${peakWorkersDuringPlay}) <= 2`);

  // Verify seeking works in both kinds (into clip scene 1 at frame 85, and back into live scene 0 at frame 15)
  timeSec = 85 / 30;
  mixedFilm.showFrame(85);
  assert.equal(mixedFilm.activeSceneIndex, 1);
  assert.equal(mixedFilm.state, "playing");

  timeSec = 15 / 30;
  mixedFilm.showFrame(15);
  assert.equal(mixedFilm.activeSceneIndex, 0);
  await waitForIdle(mixedFilm.scenes[0]);
  mixedFilm.showFrame(15);
  assert.equal(mixedFilm.scenes[0].isBufferingNow, false);

  // 3. When the clip scene at the boundary is NOT ready yet (state: "rendering", hasClip: false):
  //    Crossing into scene 1 enters buffering on the film and `bufferingCause` returns cause: "clip"
  //    with "Scene 2 is being prepared as a video for smooth playback"
  await mixedFilm.updateScene(1, {
    id: "s1",
    bundleDigest: "dig-m-1",
    html: "",
    frames: 60,
    state: "rendering",
    playback: "clip",
    drawMsPerFrame: 185,
    hasClip: false,
    clipReady: false
  });
  timeSec = 60 / 30;
  mixedFilm.showFrame(60);
  assert.equal(mixedFilm.activeSceneIndex, 1);
  assert.equal(mixedFilm.state, "buffering", "film reports buffering when playhead reaches a not-yet-ready clip scene");

  const unreadyClipScene = {
    index: 1,
    keyword: "Crayon forest",
    state: "rendering",
    seconds: 2,
    frames: 60,
    framesDone: 18,
    sig: "sig-1",
    playback: "clip",
    drawMsPerFrame: 185
  };
  const spUnready = sceneProgress(unreadyClipScene, null, { isLiveMode: true, scenes: [unreadyClipScene] });
  const boundaryCause = bufferingCause({
    sceneIndex: 1,
    sceneCount: 3,
    serverState: unreadyClipScene.state,
    serverPlayable: false,
    playback: unreadyClipScene.playback,
    sceneProgress: spUnready
  });
  assert.equal(boundaryCause.cause, "clip");
  assert.equal(boundaryCause.title, "Scene 2 is being prepared as a video for smooth playback");
});

test("(H) Already-checked scenes (existing films): >= 8 alone samples (first ignored) posts one playback report; 150 ms/frame demotes on {state:'bundled', playback:'clip'} mid-playback without breaking film clock or peakWorkersDuringPlay > 2; 20 ms/frame stays live; contended-only / <8 / drawn / playback:'clip' post nothing; retries at most twice", async (t) => {
  const {
    SLOW_DRAW_MEDIAN_MS,
    SLOW_DRAW_P90_MS,
    clearLiveTraceLog,
    getLiveTraceLog
  } = await import("../lib/live/index.ts");
  const { buildStagePrepProps, sceneProgress } = await import("../components/animation-workspace/progress.ts");

  globalThis.__gmLiveTrace = true;
  clearLiveTraceLog();
  t.after(() => {
    delete globalThis.__gmLiveTrace;
    clearLiveTraceLog();
  });

  // 1. Contended-only samples, < 8 samples, already playback:"clip", and state:"drawn" must post NOTHING and never demote
  const contendedPosts = [];
  const contendedTr = makeTrackingTransport({ drawMsDraft: 150, spawnDelayMs: 1, initDelayMs: 1, frameDelayMs: 1 });
  const contendedFilm = createFilmPlayer({
    projectId: "49e78637-contended",
    scenes: [
      {
        id: "s0-contended",
        variantId: "var-contended-0",
        gen: 1,
        state: "checked",
        bundleDigest: "dig-contended-0",
        html: "<script>/*contended-0*/window.FILM={};</script>",
        frames: 60
      },
      {
        id: "s1-short",
        variantId: "var-short-1",
        gen: 1,
        state: "checked",
        bundleDigest: "dig-short-1",
        html: "<script>/*short-1*/window.FILM={};</script>",
        frames: 5 // max 4 post-init samples (< 8)
      },
      {
        id: "s2-already-clip",
        variantId: "var-clip-2",
        gen: 1,
        state: "checked",
        playback: "clip",
        bundleDigest: "dig-clip-2",
        html: "<script>/*clip-2*/window.FILM={};</script>",
        frames: 60
      },
      {
        id: "s3-drawn",
        variantId: "var-drawn-3",
        gen: 1,
        state: "drawn",
        hasClip: true,
        clipReady: true,
        bundleDigest: "dig-drawn-3",
        html: "",
        frames: 60
      }
    ],
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    activeDrawWork: () => 1, // all draws in s0 are contended
    timeSource: { currentTime: () => 0, playing: () => false },
    transportFactory: contendedTr.factory,
    reportCheck: async (_projectId, variantId, payload) => {
      contendedPosts.push({ variantId, payload });
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "bundled", playback: "clip" };
    }
  });
  t.after(() => contendedFilm.destroy());

  await contendedFilm.mount(fakeElement());
  await waitForIdle(contendedFilm.scenes[0]);
  await contendedFilm.scenes[1].measure();
  await contendedFilm.waitForChecks();

  assert.equal(contendedPosts.length, 0, "contended-only, <8 samples, playback:'clip', and drawn scenes post nothing");
  assert.equal(contendedFilm.decision(0).mode, "live", "contended-only scene is not demoted");
  assert.equal(contendedFilm.decision(1).mode, "live", "fewer than 8 samples scene is not demoted");
  assert.equal(contendedFilm.decision(2).mode, "clip", "scene with playback:'clip' already set stays clip without reporting");
  assert.equal(contendedFilm.decision(3).mode, "clip", "drawn scene stays clip without reporting");

  // 2. Existing film with `checked` scenes:
  //    - Scene 0: `checked`, fast 20 ms/frame (with a 240 ms first frame after init to prove first sample is ignored) -> posts 1 report on page load, stays live
  //    - Scene 1: `checked`, slow 150 ms/frame -> warmed as next scene during playback, posts 1 report with n >= 8 & median=150/p90=150, demoted mid-playback on {state:"bundled", playback:"clip"}
  //    - Scene 2: `checked`, fast 20 ms/frame -> plays live after Scene 1's clip finishes
  //    - Scene 3: `checked`, slow 150 ms/frame -> becomes active scene, posts 1 report (which fails twice then succeeds on retry 2 = 3 attempts), demotes mid-playback while active, holds last frame / cause "clip" banner until clip is ready, then switches to clip without a seek!
  clearLiveTraceLog();
  let peakWorkersDuringPlay = 0;
  let activeTransports = 0;
  let playing = false;
  let timeSec = 0;

  const customFactory = async (workerSource) => {
    const src = String(workerSource ?? "");
    const tagMatch = /\/\*scene-([^*]+)\*\//.exec(src);
    const sceneTag = tagMatch ? tagMatch[1] : "unknown";
    const isSlow = src.includes("/*slow-150*/");
    await new Promise((r) => setTimeout(r, 2));
    activeTransports++;
    if (playing && activeTransports > peakWorkersDuringPlay) {
      peakWorkersDuringPlay = activeTransports;
    }
    let terminated = false;
    let initialized = false;
    let framesAfterInit = 0;

    const port = {
      onmessage: null,
      postMessage(msg) {
        if (terminated) return;
        if (msg.t === "init") {
          setTimeout(() => {
            if (terminated) return;
            initialized = true;
            framesAfterInit = 0;
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
          }, 2);
        } else if (msg.t === "hb") {
          port.onmessage?.({ data: { t: "hb", id: msg.id } });
        } else if (msg.t === "dispose") {
          port.onmessage?.({ data: { t: "dispose", id: msg.id, ok: true } });
        } else if (msg.t === "frame") {
          setTimeout(() => {
            if (terminated || !initialized) return;
            framesAfterInit++;
            // First frame after init is intentionally slow (240 ms) on all scenes to verify first-sample-after-init is ignored
            const dMs = framesAfterInit === 1 ? 240 : isSlow ? 150 : 20;
            const bm = {
              width: 640,
              height: 360,
              frameIndex: msg.n,
              __sceneFrame: msg.n,
              closed: false,
              close() {
                this.closed = true;
              }
            };
            port.onmessage?.({
              data: {
                t: "frame",
                id: msg.id,
                n: msg.n,
                bitmap: bm,
                drawMs: dMs,
                hash: `h-${sceneTag}-${msg.n}`,
                epoch: msg.epoch
              }
            });
          }, 1);
        }
      }
    };
    return {
      port,
      terminate() {
        if (!terminated) {
          terminated = true;
          activeTransports = Math.max(0, activeTransports - 1);
        }
      }
    };
  };

  const posted = [];
  const reportEvents = [];
  let s3Attempts = 0;

  const voices = [0, 1, 2, 3].map(() => ({
    currentTime: 0,
    duration: 2,
    paused: true,
    ended: false,
    muted: false,
    volume: 1,
    readyState: 4,
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    }
  }));

  const crayonFilm = createFilmPlayer({
    projectId: "49e78637-existing-crayon",
    scenes: [
      {
        id: "s0",
        variantId: "var-s0-fast",
        gen: 2,
        state: "checked",
        bundleDigest: "dig-s0-fast",
        html: "<script>/*scene-0*//*fast-20*/window.FILM={};</script>",
        frames: 60
      },
      {
        id: "s1",
        variantId: "var-s1-slow",
        gen: 2,
        state: "checked",
        bundleDigest: "dig-s1-slow",
        html: "<script>/*scene-1*//*slow-150*/window.FILM={};</script>",
        frames: 60
      },
      {
        id: "s2",
        variantId: "var-s2-fast",
        gen: 2,
        state: "checked",
        bundleDigest: "dig-s2-fast",
        html: "<script>/*scene-2*//*fast-20*/window.FILM={};</script>",
        frames: 60
      },
      {
        id: "s3",
        variantId: "var-s3-slow-active",
        gen: 2,
        state: "checked",
        bundleDigest: "dig-s3-slow",
        html: "<script>/*scene-3*//*slow-150*/window.FILM={};</script>",
        frames: 60
      }
    ],
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    audio: { voices },
    checkRetryBackoffMs: [5, 10],
    transportFactory: customFactory,
    reportCheck: async (_projectId, variantId, payload) => {
      posted.push({ variantId, payload: structuredClone(payload) });
      if (variantId === "var-s3-slow-active") {
        s3Attempts++;
        if (s3Attempts <= 2) {
          return { status: "network_error", ok: false, dropped: false, error: "transient network error" };
        }
      }
      const d = payload.results?.drawMs;
      if (
        payload.results?.source === "playback" &&
        (payload.results?.samples ?? 0) >= 8 &&
        d &&
        (d.medianMs > SLOW_DRAW_MEDIAN_MS || d.p90Ms > SLOW_DRAW_P90_MS)
      ) {
        return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "bundled", playback: "clip" };
      }
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    },
    onCheckReport: (ev) => {
      reportEvents.push(ev);
    }
  });
  t.after(() => crayonFilm.destroy());

  const el = fakeElement();
  await crayonFilm.mount(el);
  await crayonFilm.waitForChecks();

  // Verify first measure on page load (Scene 0: 20 ms/frame, first frame 240 ms ignored):
  const s0Posts = posted.filter((p) => p.variantId === "var-s0-fast");
  assert.equal(s0Posts.length, 1, "Scene 0 (20 ms/frame) posted exactly 1 playback report on page load");
  assert.equal(s0Posts[0].payload.gen, 2);
  assert.equal(s0Posts[0].payload.bundleDigest, "dig-s0-fast");
  assert.equal(s0Posts[0].payload.results.ok, true);
  assert.equal(s0Posts[0].payload.results.source, "playback");
  assert.ok(s0Posts[0].payload.results.samples >= 8, `samples >= 8 (got ${s0Posts[0].payload.results.samples})`);
  assert.deepEqual(s0Posts[0].payload.results.drawMs, { medianMs: 20, p90Ms: 20 }, "first 240ms sample after init was ignored");
  assert.equal(crayonFilm.decision(0).mode, "live", "20 ms/frame scene is not demoted");

  // Re-measuring or updating Scene 0 with the same (variantId, gen, bundleDigest) must NOT send a second report
  await crayonFilm.scenes[0].measure();
  await crayonFilm.updateScene(0, {
    id: "s0",
    variantId: "var-s0-fast",
    gen: 2,
    state: "checked",
    bundleDigest: "dig-s0-fast",
    html: "<script>/*scene-0*//*fast-20*/window.FILM={};</script>",
    frames: 60
  });
  await crayonFilm.waitForChecks();
  assert.equal(
    posted.filter((p) => p.variantId === "var-s0-fast").length,
    1,
    "second report for the same (variant, gen, bundleDigest) is never sent"
  );

  // Start playing Scene 0: Scene 1 (`checked`, 150 ms/frame) warms as next scene and gets demoted mid-playback!
  playing = true;
  crayonFilm.filmClock.play();
  await waitForIdle(crayonFilm.scenes[0]);

  for (let f = 0; f <= 40; f += 5) {
    timeSec = f / 30;
    crayonFilm.filmClock.tickTo(timeSec);
    crayonFilm.syncToClock();
    await waitForIdle(crayonFilm.scenes[0]);
  }
  await crayonFilm.waitForChecks();

  const s1Posts = posted.filter((p) => p.variantId === "var-s1-slow");
  assert.equal(s1Posts.length, 1, "warmed next scene (Scene 1, 150 ms/frame) posted exactly 1 playback report");
  assert.equal(s1Posts[0].payload.results.ok, true);
  assert.equal(s1Posts[0].payload.results.source, "playback");
  assert.ok(s1Posts[0].payload.results.samples >= 8);
  assert.deepEqual(s1Posts[0].payload.results.drawMs, { medianMs: 150, p90Ms: 150 });
  assert.equal(crayonFilm.decision(1).mode, "clip", "Scene 1 was demoted to clip mode on {state:'bundled', playback:'clip'}");
  assert.equal(crayonFilm.decision(1).reason, "slow-draw");
  assert.equal(
    crayonFilm.scenes[1].workerHost?.hasActiveTransport ?? false,
    false,
    "Scene 1 released its Worker upon demotion"
  );
  // Film clock and audio in Scene 0 are completely unbroken by Scene 1's demotion:
  assert.equal(crayonFilm.state, "playing", "film stays playing in Scene 0 while Scene 1 demotes");
  assert.equal(crayonFilm.filmClock.buffering, false, "film clock continues without pause in Scene 0");
  assert.equal(voices[0].paused, false, "Scene 0 voiceover stays playing in sync");

  // Play to the boundary into Scene 1 (frame 60, t = 2.0s) while Scene 1's clip is still being prepared (`state: "bundled", playback: "clip"`):
  timeSec = 60 / 30;
  crayonFilm.filmClock.tickTo(timeSec);
  crayonFilm.syncToClock();
  assert.equal(crayonFilm.activeSceneIndex, 1);
  assert.equal(crayonFilm.state, "buffering", "at boundary into not-yet-ready demoted clip scene, film waits in buffering");
  assert.equal(crayonFilm.filmClock.buffering, true, "filmClock pauses while waiting for clip");

  // Banner / stage prep shows "Scene 2 is being prepared as a video for smooth playback" with cause "clip":
  const s1ServerScene = {
    index: 1,
    keyword: "Crayon castle",
    state: "bundled",
    seconds: 2,
    frames: 60,
    sig: "sig-s1",
    playback: "clip"
  };
  const spS1 = sceneProgress(s1ServerScene, null, { isLiveMode: true, scenes: [s1ServerScene] });
  const stagePrepS1 = buildStagePrepProps({
    sceneIndex: 1,
    sceneCount: 4,
    sceneState: "bundled",
    playback: "clip",
    isClipScene: true,
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: false,
    isViewAspectDrawing: true,
    isPlayable: false,
    sceneProgress: spS1
  });
  assert.equal(stagePrepS1?.cause, "clip");
  assert.equal(stagePrepS1?.title, "Scene 2 is being prepared as a video for smooth playback");

  // Now Scene 1's clip finishes rendering on the worker (`state: "drawn", playback: "clip", hasClip: true`):
  // Switches to playing the clip without a seek by the user!
  await crayonFilm.updateScene(1, {
    id: "s1",
    variantId: "var-s1-slow",
    gen: 2,
    state: "drawn",
    playback: "clip",
    hasClip: true,
    clipReady: true,
    bundleDigest: "dig-s1-slow",
    html: "",
    frames: 60
  });
  assert.equal(crayonFilm.state, "playing", "switches to playing the clip as soon as clip is ready without a seek");
  assert.equal(crayonFilm.filmClock.buffering, false, "filmClock resumes automatically when clip is ready");
  assert.equal(voices[1].paused, false, "Scene 1 voiceover plays in sync");

  // Advance through Scene 1 (clip) into Scene 2 (live 20 ms/frame) and then into Scene 3 (active slow 150 ms/frame scene):
  for (let f = 65; f < 180; f += 15) {
    timeSec = f / 30;
    crayonFilm.filmClock.tickTo(timeSec);
    crayonFilm.syncToClock();
    const cur = crayonFilm.scenes[crayonFilm.activeSceneIndex];
    const nxt = crayonFilm.scenes[crayonFilm.activeSceneIndex + 1];
    if (nxt && nxt.decision().mode === "live") {
      await waitForIdle(cur, nxt);
    } else {
      await waitForIdle(cur);
    }
  }

  // Enter Scene 3 (frame 180, t = 6.0s) as the active scene:
  timeSec = 180 / 30;
  crayonFilm.filmClock.tickTo(timeSec);
  crayonFilm.syncToClock();
  await waitForIdle(crayonFilm.scenes[3]);
  await crayonFilm.waitForChecks();

  // Verify Scene 3 retried its failed request twice with backoff (3 attempts total) and then demoted mid-playback while active:
  const s3Posts = posted.filter((p) => p.variantId === "var-s3-slow-active");
  assert.equal(s3Posts.length, 3, "failed playback report retried at most twice (1 initial + 2 retries = 3 calls)");
  const s3Event = reportEvents.find((e) => e.variantId === "var-s3-slow-active");
  assert.equal(s3Event?.attempts, 3, "reported 3 attempts after 2 retries");
  assert.equal(crayonFilm.decision(3).mode, "clip", "active slow Scene 3 was demoted to clip mode");
  assert.equal(crayonFilm.decision(3).reason, "slow-draw");
  assert.equal(
    crayonFilm.scenes[3].workerHost?.hasActiveTransport ?? false,
    false,
    "active slow Scene 3 released its Worker on demotion"
  );
  assert.notEqual(
    crayonFilm.scenes[3].lastPresentedSourceFrame,
    null,
    "active slow Scene 3 holds its last drawn frame on canvas while waiting for clip"
  );
  assert.equal(crayonFilm.state, "buffering", "film waits with cause 'clip' until Scene 3 clip is ready");

  // When Scene 3's clip arrives, it resumes playing without a seek:
  await crayonFilm.updateScene(3, {
    id: "s3",
    variantId: "var-s3-slow-active",
    gen: 2,
    state: "drawn",
    playback: "clip",
    hasClip: true,
    clipReady: true,
    bundleDigest: "dig-s3-slow",
    html: "",
    frames: 60
  });
  assert.equal(crayonFilm.state, "playing", "Scene 3 switches to playing clip without a seek");
  assert.equal(crayonFilm.filmClock.buffering, false, "filmClock continues after Scene 3 clip is ready");

  assert.ok(
    peakWorkersDuringPlay <= 2,
    `peakWorkersDuringPlay (${peakWorkersDuringPlay}) must never exceed 2`
  );

  // Verify slow-scene trace entries have source:"playback" and server's decision
  const playbackTraces = getLiveTraceLog().filter((e) => e.kind === "slow-scene" && e.source === "playback");
  assert.equal(playbackTraces.length, 4, "logged 1 playback slow-scene trace per checked scene (4 scenes)");
  assert.deepEqual(
    playbackTraces.map((e) => ({
      sceneIndex: e.sceneIndex,
      source: e.source,
      median: e.median,
      p90: e.p90,
      decision: e.decision
    })),
    [
      { sceneIndex: 0, source: "playback", median: 20, p90: 20, decision: "live" },
      { sceneIndex: 1, source: "playback", median: 150, p90: 150, decision: "clip" },
      { sceneIndex: 2, source: "playback", median: 20, p90: 20, decision: "live" },
      { sceneIndex: 3, source: "playback", median: 150, p90: 150, decision: "clip" }
    ]
  );
});

test("(I) Demoted scene clip pickup without reload (Crayon 49e78637…): live scene demoted by playback measurement -> status moves rendering (playback:'clip', v:null) -> drawn (playback:'clip', v set) while playing inside that scene and while in an earlier scene", async (t) => {
  const { build } = await import("esbuild");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { buildUnreadySceneBanner, sceneProgress } = await import("../components/animation-workspace/progress.ts");

  const here = dirname(fileURLToPath(import.meta.url));
  const stageEntry = join(here, "../components/plate-live-stage.tsx");

  const bundleRes = await build({
    entryPoints: [stageEntry],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "headless-stage-harness",
        setup(b) {
          b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (args) => ({
            path: args.path,
            namespace: "react-stub"
          }));
          b.onLoad({ filter: /.*/, namespace: "react-stub" }, (args) => {
            if (args.path === "react/jsx-runtime") {
              return {
                contents: `
                  export const Fragment = Symbol.for("react.fragment");
                  export function jsx(type, props, key) { return { type, props: props || {}, key: key ?? null }; }
                  export const jsxs = jsx;
                `,
                loader: "js"
              };
            }
            return {
              contents: `
                export function useRef(init) { return globalThis.__stageHook.useRef(init); }
                export function useState(init) { return globalThis.__stageHook.useState(init); }
                export function useMemo(fn, deps) { return globalThis.__stageHook.useMemo(fn, deps); }
                export function useEffect(fn, deps) { return globalThis.__stageHook.useEffect(fn, deps); }
                export function useLayoutEffect(fn, deps) { return globalThis.__stageHook.useLayoutEffect(fn, deps); }
                export function useCallback(fn, deps) { return globalThis.__stageHook.useMemo(() => fn, deps); }
                export function useId() { return "id-0"; }
              `,
              loader: "js"
            };
          });
          b.onResolve({ filter: /utils\/supabase\/client$/ }, () => ({
            path: "supabase-stub",
            namespace: "supabase-stub"
          }));
          b.onLoad({ filter: /.*/, namespace: "supabase-stub" }, () => ({
            contents: `
              export function createClient() {
                return { auth: { async getSession() { return { data: { session: { access_token: "test-token" } } }; } } };
              }
            `,
            loader: "js"
          }));
          b.onResolve({ filter: /^\.\.\/lib\/live$/ }, (args) => ({
            path: join(dirname(args.importer), "../lib/live/index.ts"),
            namespace: "live-wrap"
          }));
          b.onLoad({ filter: /.*/, namespace: "live-wrap" }, async (args) => {
            const realPath = JSON.stringify(args.path);
            return {
              contents: `
                export * from ${realPath};
                import { createFilmPlayer as realCreateFilmPlayer } from ${realPath};
                export function createFilmPlayer(opts) {
                  const hookOpts = globalThis.__stageFilmPlayerHook ? globalThis.__stageFilmPlayerHook(opts) : opts;
                  const fp = realCreateFilmPlayer(hookOpts);
                  globalThis.__lastStageFilmPlayer = fp;
                  return fp;
                }
              `,
              loader: "ts",
              resolveDir: dirname(args.path)
            };
          });
        }
      }
    ]
  });

  const code = bundleRes.outputFiles[0].text;
  const modUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const stageMod = await import(modUrl);
  const { PlateLiveStage } = stageMod;

  function createStageHarness() {
    const hooks = [];
    let cursor = 0;
    let pendingEffects = [];
    let pendingLayoutEffects = [];
    let lastTree = null;
    let lastProps = null;
    let dirty = false;

    const depsEqual = (a, b) => {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false;
      }
      return true;
    };

    const hookApi = {
      useRef(init) {
        const idx = cursor++;
        if (!(idx in hooks)) hooks[idx] = { current: init };
        return hooks[idx];
      },
      useState(init) {
        const idx = cursor++;
        if (!(idx in hooks)) {
          const val = typeof init === "function" ? init() : init;
          const setter = (next) => {
            const resolved = typeof next === "function" ? next(hooks[idx].value) : next;
            if (!Object.is(resolved, hooks[idx].value)) {
              hooks[idx].value = resolved;
              dirty = true;
            }
          };
          hooks[idx] = { value: val, setter };
        }
        return [hooks[idx].value, hooks[idx].setter];
      },
      useMemo(fn, deps) {
        const idx = cursor++;
        if (!(idx in hooks) || !depsEqual(hooks[idx].deps, deps)) {
          hooks[idx] = { value: fn(), deps };
        }
        return hooks[idx].value;
      },
      useEffect(fn, deps) {
        const idx = cursor++;
        if (!(idx in hooks) || !depsEqual(hooks[idx].deps, deps)) {
          pendingEffects.push({ idx, fn, deps });
        }
      },
      useLayoutEffect(fn, deps) {
        const idx = cursor++;
        if (!(idx in hooks) || !depsEqual(hooks[idx].deps, deps)) {
          pendingLayoutEffects.push({ idx, fn, deps });
        }
      }
    };

    const attachHostContainer = (node, containerEl) => {
      if (!node || typeof node !== "object") return;
      if (node.props?.className === "aw-live-canvas-host" && node.props?.ref && typeof node.props.ref === "object") {
        node.props.ref.current = containerEl;
      }
      const children = node.props?.children;
      if (Array.isArray(children)) children.forEach((c) => attachHostContainer(c, containerEl));
      else if (children) attachHostContainer(children, containerEl);
    };

    const runEffects = (list) => {
      for (const item of list) {
        if (hooks[item.idx]?.cleanup) {
          try {
            hooks[item.idx].cleanup();
          } catch {}
        }
        const cleanup = item.fn();
        hooks[item.idx] = { deps: item.deps, cleanup };
      }
    };

    const containerEl = {
      ...fakeElement(),
      innerHTML: ""
    };

    return {
      containerEl,
      render(props) {
        lastProps = props;
        let guard = 0;
        do {
          dirty = false;
          cursor = 0;
          pendingEffects = [];
          pendingLayoutEffects = [];
          globalThis.__stageHook = hookApi;
          lastTree = PlateLiveStage(lastProps);
          attachHostContainer(lastTree, containerEl);
          runEffects(pendingLayoutEffects);
          runEffects(pendingEffects);
          guard++;
        } while (dirty && guard < 10);
        return lastTree;
      },
      flush() {
        if (dirty && lastProps) {
          return this.render(lastProps);
        }
        return lastTree;
      },
      unmount() {
        for (const h of hooks) {
          if (h?.cleanup) {
            try {
              h.cleanup();
            } catch {}
          }
        }
      }
    };
  }

  function findNodes(node, pred, out = []) {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) {
      node.forEach((c) => findNodes(c, pred, out));
      return out;
    }
    if (pred(node)) out.push(node);
    const children = node.props?.children;
    if (Array.isArray(children)) children.forEach((c) => findNodes(c, pred, out));
    else if (children) findNodes(children, pred, out);
    return out;
  }

  const origFetch = globalThis.fetch;
  const origWindow = globalThis.window;
  globalThis.window = globalThis;
  globalThis.window.setTimeout = setTimeout;
  globalThis.window.clearTimeout = clearTimeout;
  globalThis.window.setInterval = setInterval;
  globalThis.window.clearInterval = clearInterval;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  t.after(() => {
    globalThis.fetch = origFetch;
    if (origWindow === undefined) delete globalThis.window;
    else globalThis.window = origWindow;
    delete globalThis.__stageHook;
    delete globalThis.__stageFilmPlayerHook;
    delete globalThis.__lastStageFilmPlayer;
  });

  const makeTransport = () =>
    async (workerSource) => {
      const src = String(workerSource ?? "");
      const isSlow = src.includes("/*slow-150*/");
      let terminated = false;
      let initialized = false;
      let framesAfterInit = 0;
      const port = {
        onmessage: null,
        postMessage(msg) {
          if (terminated) return;
          if (msg.t === "init") {
            setTimeout(() => {
              if (terminated) return;
              initialized = true;
              framesAfterInit = 0;
              port.onmessage?.({
                data: {
                  t: "init",
                  id: msg.id,
                  w: 640,
                  h: 360,
                  meta: { W: 1920, H: 1080, fps: 30, durationFrames: 150 },
                  capabilities: {
                    draftSupported: true,
                    seekAcceptsQuality: true,
                    profileVersion: "v1",
                    defaultDraftTargetVerticesPerFrame: 75000
                  }
                }
              });
            }, 1);
          } else if (msg.t === "hb") {
            port.onmessage?.({ data: { t: "hb", id: msg.id } });
          } else if (msg.t === "dispose") {
            port.onmessage?.({ data: { t: "dispose", id: msg.id, ok: true } });
          } else if (msg.t === "frame") {
            setTimeout(() => {
              if (terminated || !initialized) return;
              framesAfterInit++;
              const dMs = framesAfterInit === 1 ? 220 : isSlow ? 150 : 18;
              const bm = {
                width: 640,
                height: 360,
                frameIndex: msg.n,
                __sceneFrame: msg.n,
                closed: false,
                close() {
                  this.closed = true;
                }
              };
              port.onmessage?.({
                data: {
                  t: "frame",
                  id: msg.id,
                  n: msg.n,
                  bitmap: bm,
                  drawMs: dMs,
                  hash: `h-${msg.n}`,
                  epoch: msg.epoch
                }
              });
            }, 1);
          }
        }
      };
      return {
        port,
        terminate() {
          terminated = true;
        }
      };
    };

  const makeScenesStatus = (s1Patch = {}) => [
    {
      index: 0,
      keyword: "Crayon dawn",
      state: "checked",
      seconds: 2,
      frames: 60,
      sig: "sig-0",
      rev: 0,
      gen: 2,
      variantId: "var-crayon-0",
      bundleDigest: "dig-crayon-0",
      live: true,
      variants: {
        "16:9": {
          state: "checked",
          sig: "sig-0",
          v: null,
          gen: 2,
          rev: 0,
          variantId: "var-crayon-0",
          bundleDigest: "dig-crayon-0",
          live: true,
          frames: 60,
          framesDone: null
        }
      }
    },
    {
      index: 1,
      keyword: "Crayon forest",
      state: s1Patch.state ?? "checked",
      seconds: 5,
      frames: 150,
      framesDone: s1Patch.framesDone ?? null,
      sig: "sig-1",
      rev: 0,
      gen: 2,
      variantId: "var-crayon-1",
      bundleDigest: "dig-crayon-1",
      live: (s1Patch.state ?? "checked") === "checked" && !s1Patch.playback,
      ...(s1Patch.playback ? { playback: s1Patch.playback } : {}),
      ...(s1Patch.drawMsPerFrame ? { drawMsPerFrame: s1Patch.drawMsPerFrame } : {}),
      variants: {
        "16:9": {
          state: s1Patch.state ?? "checked",
          sig: "sig-1",
          v: s1Patch.v ?? null,
          gen: 2,
          rev: 0,
          variantId: "var-crayon-1",
          bundleDigest: "dig-crayon-1",
          live: (s1Patch.state ?? "checked") === "checked" && !s1Patch.playback,
          frames: 150,
          framesDone: s1Patch.framesDone ?? null,
          ...(s1Patch.playback ? { playback: s1Patch.playback } : {}),
          ...(s1Patch.drawMsPerFrame ? { drawMsPerFrame: s1Patch.drawMsPerFrame } : {})
        }
      }
    },
    {
      index: 2,
      keyword: "Crayon harbor",
      state: "checked",
      seconds: 2,
      frames: 60,
      sig: "sig-2",
      rev: 0,
      gen: 2,
      variantId: "var-crayon-2",
      bundleDigest: "dig-crayon-2",
      live: true,
      variants: {
        "16:9": {
          state: "checked",
          sig: "sig-2",
          v: null,
          gen: 2,
          rev: 0,
          variantId: "var-crayon-2",
          bundleDigest: "dig-crayon-2",
          live: true,
          frames: 60,
          framesDone: null
        }
      }
    }
  ];

  // Install fake fetch for bundle + check endpoints
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/bundle")) {
      const isSlow = u.includes("var-crayon-1");
      const vid = u.includes("var-crayon-0") ? "0" : isSlow ? "1" : "2";
      return new Response(
        JSON.stringify({
          url: `http://localhost:4000/local/plates/g2/bundle-${vid}.html`,
          expiresAt: "2099-01-01T00:00:00.000Z",
          bundleDigest: `dig-crayon-${vid}`,
          gen: 2,
          rev: 0,
          manifest: { W: 1920, H: 1080, fps: 30, durationFrames: isSlow ? 150 : 60 },
          params: {}
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (u.includes("/local/plates/")) {
      const isSlow = u.includes("bundle-1.html");
      return new Response(
        `<script>/*${isSlow ? "slow-150" : "fast-18"}*/window.FILM={};</script>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }
    if (u.endsWith("/check") && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      const d = body.results?.drawMs;
      if (d && d.medianMs > 60) {
        return new Response(JSON.stringify({ state: "bundled", playback: "clip" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ state: "checked" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  async function runScenario({ playheadInSceneIndex }) {
    const voices = [0, 1, 2].map((i) => ({
      currentTime: 0,
      duration: i === 1 ? 5 : 2,
      paused: true,
      ended: false,
      muted: false,
      volume: 1,
      readyState: 4,
      play() {
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      }
    }));

    delete globalThis.__lastStageFilmPlayer;
    globalThis.__stageFilmPlayerHook = (opts) => ({
      ...opts,
      transportFactory: makeTransport(),
      frameStore: null,
      audio: { voices }
    });

    const harness = createStageHarness();
    let latestResolutions = [];
    let refreshCount = 0;
    let currentScene = playheadInSceneIndex;
    let currentTime = playheadInSceneIndex === 1 ? 2.5 : 0.5;
    let isPlaying = true;
    const videosRef = { current: [null, null, null] };
    const voicesRef = { current: voices };
    const musicRef = { current: null };
    const sfxRef = { current: {} };
    const wantPlayRef = { current: true };

    const buildProps = (scenes) => {
      const perSceneProgress = scenes.map((s) =>
        sceneProgress(s, s.variants?.["16:9"] ?? null, { isLiveMode: true, viewAspect: "16:9", scenes })
      );
      return {
        projectId: "49e78637-0000-4000-8000-000000000001",
        look: "illus-crayon",
        scenes,
        referenceFrames: [null, null, null],
        perSceneProgress,
        viewAspect: "16:9",
        primaryAspect: "16:9",
        isViewAspectDrawn: scenes.some((s) => s.state === "drawn"),
        isViewAspectDrawing: scenes.some((s) => s.state === "rendering" || s.state === "bundled"),
        prep: null,
        current: currentScene,
        playing: isPlaying,
        time: currentTime,
        durations: [2, 5, 2],
        starts: [0, 2, 7],
        total: 9,
        voiceOn: true,
        musicOn: false,
        master: 1,
        muted: false,
        musicSrc: null,
        pendingCommentScenes: new Set(),
        videos: videosRef,
        voices: voicesRef,
        musicAudio: musicRef,
        sfxAudios: sfxRef,
        wantPlay: wantPlayRef,
        rateFor: () => 1,
        onLoadedVideo: () => {},
        onVideoEnded: () => {},
        onAdvanceScene: (idx) => {
          currentScene = idx + 1;
        },
        onSetPlaying: (p) => {
          isPlaying = p;
        },
        onSetTime: (tVal) => {
          currentTime = tVal;
        },
        playSceneSfx: () => {},
        tickSceneSfx: () => {},
        clearSfxTimers: () => {},
        onStatusRefresh: () => {
          refreshCount++;
        },
        onResolutionsChange: (r) => {
          latestResolutions = r;
        },
        renderMode: "draft",
        liveOptions: {
          flagOverride: true,
          environment:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.79 Safari/537.36"
        }
      };
    };

    try {
      // 1. Initial status: all scenes checked
      const scenesInitial = makeScenesStatus({ state: "checked" });
      harness.render(buildProps(scenesInitial));

      // Wait for bundle fetches to resolve and mount createFilmPlayer
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 10));
        harness.flush();
        if (globalThis.__lastStageFilmPlayer) break;
      }
      const fp = globalThis.__lastStageFilmPlayer;
      assert.ok(fp, "FilmPlayer mounted by PlateLiveStage");

      // Wait for initial mount & measurement
      await new Promise((r) => setTimeout(r, 60));
      await waitForIdle(fp.scenes[playheadInSceneIndex]);
      harness.flush();

      if (playheadInSceneIndex === 0) {
        // Warm scene 1 as next scene in the last 2.5s of scene 0 so scene 1 gets measured during playback while playhead is in scene 0
        currentTime = 1.2;
        harness.render(buildProps(scenesInitial));
        fp.syncToClock();
      } else {
        fp.syncToClock();
      }

      // Wait for scene 1 playback measurement (>= 8 alone samples) and check report response
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 15));
        harness.flush();
        if (latestResolutions[1]?.mode === "clip") break;
      }
      await fp.waitForChecks();
      harness.flush();

      assert.ok(refreshCount >= 1, "playback measurement demotion triggered onStatusRefresh");
      assert.equal(latestResolutions[1]?.mode, "clip", "Scene 2 demoted to clip mode");
      assert.equal(latestResolutions[1]?.isPlayable, false, "Scene 2 not playable while waiting for clip");

      // 2. Status moves to `rendering` (playback: "clip", v: null)
      const scenesRendering = makeScenesStatus({
        state: "rendering",
        playback: "clip",
        drawMsPerFrame: 150,
        v: null,
        framesDone: 45
      });
      const treeRendering = harness.render(buildProps(scenesRendering));
      await new Promise((r) => setTimeout(r, 20));
      harness.flush();

      assert.equal(latestResolutions[1]?.mode, "clip");
      assert.equal(latestResolutions[1]?.isPlayable, false);
      assert.equal(
        latestResolutions[1]?.stageWait?.title,
        "Scene 2 is being prepared as a video for smooth playback"
      );

      if (playheadInSceneIndex === 1) {
        assert.equal(fp.state, "buffering", "FilmPlayer waits in buffering while Scene 2 clip is rendering");
        const prepNodes = findNodes(treeRendering, (n) => typeof n.type === "function" && n.type.name === "AnimationPrep");
        assert.equal(prepNodes.length, 1, "AnimationPrep overlay is shown while Scene 2 is rendering");
        assert.equal(prepNodes[0].props.title, "Scene 2 is being prepared as a video for smooth playback");
      } else {
        const perSceneProg = scenesRendering.map((s) =>
          sceneProgress(s, s.variants?.["16:9"] ?? null, { isLiveMode: true, viewAspect: "16:9", scenes: scenesRendering })
        );
        const bannerWhileRendering = buildUnreadySceneBanner({
          scenes: scenesRendering,
          perSceneProgress: perSceneProg,
          currentSceneIndex: 0,
          stagePrepSceneIndex: null
        });
        assert.ok(bannerWhileRendering?.text.includes("Scene 2 is being prepared as a video for smooth playback"));
      }

      // 3. Status moves to `drawn` (playback: "clip", v: "clipv2") — ONE status refresh!
      const scenesDrawn = makeScenesStatus({
        state: "drawn",
        playback: "clip",
        drawMsPerFrame: 150,
        v: "clipv2",
        framesDone: 150
      });
      const treeDrawn = harness.render(buildProps(scenesDrawn));
      await new Promise((r) => setTimeout(r, 30));
      const treeAfterUpdate = harness.flush();

      // Assert 1: Within one status refresh, Scene 2 resolution is clip-ready with stageWait cleared
      assert.equal(latestResolutions[1]?.mode, "clip");
      assert.equal(latestResolutions[1]?.isReady, true, "Scene 2 resolution isReady === true within one status refresh");
      assert.equal(latestResolutions[1]?.isPlayable, true, "Scene 2 resolution isPlayable === true within one status refresh");
      assert.equal(latestResolutions[1]?.stageWait, null, "Scene 2 stageWait is cleared within one status refresh");

      // Assert 2: The clip <video> source is set to the new version ("clipv2")
      const videoNodes = findNodes(treeAfterUpdate, (n) => n.type === "video");
      const scene2Video = videoNodes.find((n) => String(n.props?.src ?? "").includes("/plates/1/clip"));
      assert.ok(scene2Video, "Scene 2 <video> element is rendered");
      assert.match(String(scene2Video.props.src), /v=clipv2-0-16%3A9/, "Scene 2 <video> src carries the new clip version clipv2");

      // Assert 3: Banner / "prepared as a video" text disappears
      const prepNodesAfter = findNodes(treeAfterUpdate, (n) => typeof n.type === "function" && n.type.name === "AnimationPrep");
      assert.equal(prepNodesAfter.length, 0, "Stage AnimationPrep overlay ('prepared as a video') disappeared");
      const perSceneProgDrawn = scenesDrawn.map((s) =>
        sceneProgress(s, s.variants?.["16:9"] ?? null, { isLiveMode: true, viewAspect: "16:9", scenes: scenesDrawn })
      );
      const bannerAfter = buildUnreadySceneBanner({
        scenes: scenesDrawn,
        perSceneProgress: perSceneProgDrawn,
        currentSceneIndex: currentScene,
        stagePrepSceneIndex: null
      });
      assert.equal(bannerAfter, null, "Unready scene banner disappeared");

      // Assert 4: Film player switches Scene 2 to the clip without a seek (film clock keeps running, audio sync intact)
      if (playheadInSceneIndex === 0) {
        // Advance playhead naturally across boundary into Scene 2 (t = 2.1s, frame 63) without a seek
        currentScene = 1;
        currentTime = 2.1;
        harness.render(buildProps(scenesDrawn));
      }
      assert.equal(fp.activeSceneIndex, 1, "FilmPlayer active scene is Scene 2 (index 1)");
      assert.equal(
        fp.state,
        "playing",
        `FilmPlayer must switch Scene 2 to playing clip without a seek (got fp.state=${fp.state})`
      );
      assert.equal(voices[1].paused, false, "Scene 2 audio is playing in sync");
    } finally {
      harness.unmount();
    }
  }

  // Case 1: Playhead is inside Scene 2 (playing) when demoted and when status moves rendering -> drawn
  await runScenario({ playheadInSceneIndex: 1 });

  // Case 2: Playhead is in an earlier scene (Scene 1, index 0) when Scene 2 is demoted and moves rendering -> drawn
  await runScenario({ playheadInSceneIndex: 0 });
});

test("(J) Browser-first (project 324093f5…): fast scenes (16 ms & 21 ms) stay live even when a clip exists and clip-only status is present; truly slow scene (72 ms) goes to clip once; drawn/checked bundles queue no clip request (triggerClipRequest not called); 3-minute CLIP_AFTER_UNPLAYABLE_MS timer fires once only while visible", async (t) => {
  const { build } = await import("esbuild");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { CLIP_AFTER_UNPLAYABLE_MS, SLOW_DRAW_MEDIAN_MS, SLOW_DRAW_P90_MS } = await import("../lib/live/index.ts");

  assert.equal(CLIP_AFTER_UNPLAYABLE_MS, 180_000);

  const here = dirname(fileURLToPath(import.meta.url));
  const stageEntry = join(here, "../components/plate-live-stage.tsx");

  const bundleRes = await build({
    entryPoints: [stageEntry],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "headless-stage-harness-j",
        setup(b) {
          b.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (args) => ({
            path: args.path,
            namespace: "react-stub"
          }));
          b.onLoad({ filter: /.*/, namespace: "react-stub" }, (args) => {
            if (args.path === "react/jsx-runtime") {
              return {
                contents: `
                  export const Fragment = Symbol.for("react.fragment");
                  export function jsx(type, props, key) { return { type, props: props || {}, key: key ?? null }; }
                  export const jsxs = jsx;
                `,
                loader: "js"
              };
            }
            return {
              contents: `
                export function useRef(init) { return globalThis.__stageHook.useRef(init); }
                export function useState(init) { return globalThis.__stageHook.useState(init); }
                export function useMemo(fn, deps) { return globalThis.__stageHook.useMemo(fn, deps); }
                export function useEffect(fn, deps) { return globalThis.__stageHook.useEffect(fn, deps); }
                export function useLayoutEffect(fn, deps) { return globalThis.__stageHook.useLayoutEffect(fn, deps); }
                export function useCallback(fn, deps) { return globalThis.__stageHook.useMemo(() => fn, deps); }
                export function useId() { return "id-0"; }
              `,
              loader: "js"
            };
          });
          b.onResolve({ filter: /utils\/supabase\/client$/ }, () => ({
            path: "supabase-stub",
            namespace: "supabase-stub"
          }));
          b.onLoad({ filter: /.*/, namespace: "supabase-stub" }, () => ({
            contents: `
              export function createClient() {
                return { auth: { async getSession() { return { data: { session: { access_token: "test-token" } } }; } } };
              }
            `,
            loader: "js"
          }));
          b.onResolve({ filter: /^\.\.\/lib\/live$/ }, (args) => ({
            path: join(dirname(args.importer), "../lib/live/index.ts"),
            namespace: "live-wrap"
          }));
          b.onLoad({ filter: /.*/, namespace: "live-wrap" }, async (args) => {
            const realPath = JSON.stringify(args.path);
            return {
              contents: `
                export * from ${realPath};
                import { createFilmPlayer as realCreateFilmPlayer } from ${realPath};
                export function createFilmPlayer(opts) {
                  const hookOpts = globalThis.__stageFilmPlayerHook ? globalThis.__stageFilmPlayerHook(opts) : opts;
                  const fp = realCreateFilmPlayer(hookOpts);
                  globalThis.__lastStageFilmPlayer = fp;
                  return fp;
                }
              `,
              loader: "ts",
              resolveDir: dirname(args.path)
            };
          });
        }
      }
    ]
  });

  const code = bundleRes.outputFiles[0].text;
  const modUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const { PlateLiveStage } = await import(modUrl);

  function createStageHarness() {
    const hooks = [];
    let cursor = 0;
    let pendingEffects = [];
    let pendingLayoutEffects = [];
    let lastTree = null;
    let lastProps = null;
    let dirty = false;

    const depsEqual = (a, b) => {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false;
      }
      return true;
    };

    const hookApi = {
      useRef(init) {
        const idx = cursor++;
        if (!(idx in hooks)) hooks[idx] = { current: init };
        return hooks[idx];
      },
      useState(init) {
        const idx = cursor++;
        if (!(idx in hooks)) {
          const val = typeof init === "function" ? init() : init;
          const setter = (next) => {
            const resolved = typeof next === "function" ? next(hooks[idx].value) : next;
            if (!Object.is(resolved, hooks[idx].value)) {
              hooks[idx].value = resolved;
              dirty = true;
            }
          };
          hooks[idx] = { value: val, setter };
        }
        return [hooks[idx].value, hooks[idx].setter];
      },
      useMemo(fn, deps) {
        const idx = cursor++;
        if (!(idx in hooks) || !depsEqual(hooks[idx].deps, deps)) {
          hooks[idx] = { value: fn(), deps };
        }
        return hooks[idx].value;
      },
      useEffect(fn, deps) {
        const idx = cursor++;
        if (!(idx in hooks) || !depsEqual(hooks[idx].deps, deps)) {
          pendingEffects.push({ idx, fn, deps });
        }
      },
      useLayoutEffect(fn, deps) {
        const idx = cursor++;
        if (!(idx in hooks) || !depsEqual(hooks[idx].deps, deps)) {
          pendingLayoutEffects.push({ idx, fn, deps });
        }
      }
    };

    const attachHostContainer = (node, containerEl) => {
      if (!node || typeof node !== "object") return;
      if (node.props?.className === "aw-live-canvas-host" && node.props?.ref && typeof node.props.ref === "object") {
        node.props.ref.current = containerEl;
      }
      const children = node.props?.children;
      if (Array.isArray(children)) children.forEach((c) => attachHostContainer(c, containerEl));
      else if (children) attachHostContainer(children, containerEl);
    };

    const runEffects = (list) => {
      for (const item of list) {
        if (hooks[item.idx]?.cleanup) {
          try {
            hooks[item.idx].cleanup();
          } catch {}
        }
        const cleanup = item.fn();
        hooks[item.idx] = { deps: item.deps, cleanup };
      }
    };

    const containerEl = {
      ...fakeElement(),
      innerHTML: ""
    };

    return {
      containerEl,
      render(props) {
        lastProps = props;
        let guard = 0;
        do {
          dirty = false;
          cursor = 0;
          pendingEffects = [];
          pendingLayoutEffects = [];
          globalThis.__stageHook = hookApi;
          lastTree = PlateLiveStage(lastProps);
          attachHostContainer(lastTree, containerEl);
          runEffects(pendingLayoutEffects);
          runEffects(pendingEffects);
          guard++;
        } while (dirty && guard < 10);
        return lastTree;
      },
      flush() {
        if (dirty && lastProps) {
          return this.render(lastProps);
        }
        return lastTree;
      },
      unmount() {
        for (const h of hooks) {
          if (h?.cleanup) {
            try {
              h.cleanup();
            } catch {}
          }
        }
      }
    };
  }

  // 1. Direct FilmPlayer check: fast scenes (16 ms and 21 ms) with hasClip:true, state:"drawn", and forceClipReason:"clip-only"
  //    stay live; slow scene (72 ms) goes to clip once!
  const checkCalls = [];
  const makeMsTransport = () => async (workerSource) => {
    const src = String(workerSource ?? "");
    const msMatch = /\/\*ms-(\d+)\*\//.exec(src);
    const drawMs = msMatch ? Number(msMatch[1]) : 16;
    let terminated = false;
    let initialized = false;
    const port = {
      onmessage: null,
      postMessage(msg) {
        if (terminated) return;
        if (msg.t === "init") {
          setTimeout(() => {
            if (terminated) return;
            initialized = true;
            port.onmessage?.({
              data: {
                t: "init",
                id: msg.id,
                w: 640,
                h: 360,
                meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 },
                capabilities: { draftSupported: true, seekAcceptsQuality: true, profileVersion: "v1" }
              }
            });
          }, 1);
        } else if (msg.t === "hb") {
          port.onmessage?.({ data: { t: "hb", id: msg.id } });
        } else if (msg.t === "dispose") {
          port.onmessage?.({ data: { t: "dispose", id: msg.id, ok: true } });
        } else if (msg.t === "frame") {
          setTimeout(() => {
            if (terminated || !initialized) return;
            const bm = { width: 640, height: 360, __sceneFrame: msg.n, close() {} };
            port.onmessage?.({
              data: {
                t: "frame",
                id: msg.id,
                n: msg.n,
                bitmap: bm,
                drawMs,
                hash: `h-${drawMs}-${msg.n}`,
                epoch: msg.epoch
              }
            });
          }, 1);
        }
      }
    };
    return {
      port,
      terminate() {
        terminated = true;
      }
    };
  };

  const directFilm = createFilmPlayer({
    projectId: "324093f5-direct",
    scenes: [
      {
        id: "s4-16ms",
        variantId: "var-s4",
        gen: 1,
        state: "drawn",
        hasClip: true,
        clipReady: true,
        forceClipReason: "clip-only",
        bundleDigest: "dig-s4",
        html: "<script>/*ms-16*/window.FILM={};</script>",
        frames: 90
      },
      {
        id: "s6-21ms",
        variantId: "var-s6",
        gen: 1,
        state: "drawn",
        hasClip: true,
        clipReady: true,
        forceClipReason: "clip-only",
        bundleDigest: "dig-s6",
        html: "<script>/*ms-21*/window.FILM={};</script>",
        frames: 90
      },
      {
        id: "s2-72ms",
        variantId: "var-s2",
        gen: 1,
        state: "drawn",
        hasClip: true,
        clipReady: true,
        forceClipReason: "clip-only",
        bundleDigest: "dig-s2",
        html: "<script>/*ms-72*/window.FILM={};</script>",
        frames: 90
      }
    ],
    fps: 30,
    renderMode: "draft",
    frameStore: null,
    timeSource: { currentTime: () => 0, playing: () => false },
    transportFactory: makeMsTransport(),
    reportCheck: async (_projectId, variantId, payload) => {
      checkCalls.push({ variantId, payload });
      const d = payload.results?.drawMs;
      if (d && (d.medianMs > SLOW_DRAW_MEDIAN_MS || d.p90Ms > SLOW_DRAW_P90_MS)) {
        return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "bundled", playback: "clip" };
      }
      return { status: "ok", ok: true, dropped: false, httpStatus: 200, state: "checked" };
    }
  });
  t.after(() => directFilm.destroy());

  await directFilm.mount(fakeElement());
  await directFilm.waitForChecks();

  assert.equal(directFilm.decision(0).mode, "live", "16 ms scene stays live even when clip exists and clip-only status was present");
  assert.equal(directFilm.decision(1).mode, "live", "21 ms scene stays live even when clip exists and clip-only status was present");
  assert.equal(directFilm.decision(2).mode, "clip", "72 ms slow scene goes to clip");
  assert.equal(directFilm.decision(2).reason, "slow-draw");
  assert.equal(checkCalls.filter((c) => c.variantId === "var-s2").length, 1, "72 ms slow scene goes to clip exactly once");

  // 2. Full PlateLiveStage test:
  //    - Drawn/checked bundles with clips queue NO clip request (assert triggerClipRequest is not called)
  //    - Fast scenes (16 ms, 21 ms) switch to live when verdict is ok without restarting the film clock
  //    - Slow scene (72 ms) goes to clip once
  //    - 3-minute unplayable timer (CLIP_AFTER_UNPLAYABLE_MS = 180_000) fires triggerClipRequest once, only while visible
  const origFetch = globalThis.fetch;
  const origWindow = globalThis.window;
  const savedDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const visListeners = new Set();

  let fakeNowMs = 1_000;
  const origPerfNow = performance.now.bind(performance);
  performance.now = () => fakeNowMs;

  const fakeDoc = {
    hidden: false,
    visibilityState: "visible",
    addEventListener(type, cb) {
      if (type === "visibilitychange") visListeners.add(cb);
    },
    removeEventListener(type, cb) {
      if (type === "visibilitychange") visListeners.delete(cb);
    },
    dispatchVisibilityChange() {
      for (const cb of [...visListeners]) cb();
    }
  };
  Object.defineProperty(globalThis, "document", {
    value: fakeDoc,
    configurable: true,
    writable: true
  });

  globalThis.window = globalThis;
  globalThis.window.setTimeout = setTimeout;
  globalThis.window.clearTimeout = clearTimeout;
  globalThis.window.setInterval = setInterval;
  globalThis.window.clearInterval = clearInterval;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(fakeNowMs), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  t.after(() => {
    performance.now = origPerfNow;
    globalThis.fetch = origFetch;
    if (savedDoc) Object.defineProperty(globalThis, "document", savedDoc);
    else delete globalThis.document;
    if (origWindow === undefined) delete globalThis.window;
    else globalThis.window = origWindow;
    delete globalThis.__stageHook;
    delete globalThis.__stageFilmPlayerHook;
    delete globalThis.__lastStageFilmPlayer;
  });

  const clipRequestUrls = [];
  const triggerClipRequestCalls = [];

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/clip-request")) {
      clipRequestUrls.push(u);
      return new Response(JSON.stringify({ state: "rendering" }), {
        status: 202,
        headers: { "content-type": "application/json" }
      });
    }
    if (u.endsWith("/bundle")) {
      if (u.includes("var-unplayable")) {
        return new Response("Not Found", { status: 404 });
      }
      const ms = u.includes("var-16") ? 16 : u.includes("var-21") ? 21 : 72;
      const vid = u.includes("var-16") ? "16" : u.includes("var-21") ? "21" : "72";
      return new Response(
        JSON.stringify({
          url: `http://localhost:4000/local/plates/g1/bundle-${vid}.html`,
          expiresAt: "2099-01-01T00:00:00.000Z",
          bundleDigest: `dig-${vid}`,
          gen: 1,
          rev: 0,
          manifest: { W: 1920, H: 1080, fps: 30, durationFrames: 90 },
          params: { ms }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (u.includes("/local/plates/")) {
      const ms = u.includes("bundle-16") ? 16 : u.includes("bundle-21") ? 21 : 72;
      return new Response(`<script>/*ms-${ms}*/window.FILM={};</script>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
    if (u.endsWith("/check") && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      const d = body.results?.drawMs;
      if (d && (d.medianMs > SLOW_DRAW_MEDIAN_MS || d.p90Ms > SLOW_DRAW_P90_MS)) {
        return new Response(JSON.stringify({ state: "bundled", playback: "clip" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ state: "checked" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  globalThis.__stageFilmPlayerHook = (opts) => ({
    ...opts,
    transportFactory: makeMsTransport(),
    frameStore: null
  });

  const harness = createStageHarness();
  let latestResolutions = [];
  let currentClockSec = 1.25;
  const scenesWithClips = [
    {
      index: 0,
      keyword: "S4 16ms drawn with clip",
      state: "drawn",
      seconds: 3,
      frames: 90,
      sig: "sig-16",
      rev: 0,
      gen: 1,
      v: "clipv1",
      variantId: "var-16",
      bundleDigest: "dig-16",
      live: false,
      variants: {
        "16:9": {
          state: "drawn",
          sig: "sig-16",
          v: "clipv1",
          gen: 1,
          rev: 0,
          variantId: "var-16",
          bundleDigest: "dig-16",
          live: false
        }
      }
    },
    {
      index: 1,
      keyword: "S6 21ms drawn with clip",
      state: "drawn",
      seconds: 3,
      frames: 90,
      sig: "sig-21",
      rev: 0,
      gen: 1,
      v: "clipv1",
      variantId: "var-21",
      bundleDigest: "dig-21",
      live: false,
      variants: {
        "16:9": {
          state: "drawn",
          sig: "sig-21",
          v: "clipv1",
          gen: 1,
          rev: 0,
          variantId: "var-21",
          bundleDigest: "dig-21",
          live: false
        }
      }
    },
    {
      index: 2,
      keyword: "S2 72ms slow",
      state: "drawn",
      seconds: 3,
      frames: 90,
      sig: "sig-72",
      rev: 0,
      gen: 1,
      v: "clipv1",
      variantId: "var-72",
      bundleDigest: "dig-72",
      live: false,
      variants: {
        "16:9": {
          state: "drawn",
          sig: "sig-72",
          v: "clipv1",
          gen: 1,
          rev: 0,
          variantId: "var-72",
          bundleDigest: "dig-72",
          live: false
        }
      }
    }
  ];

  const makeProps = (scenes) => ({
    projectId: "324093f5-0000-4000-8000-000000000000",
    look: "mellan",
    scenes,
    referenceFrames: [null, null, null],
    viewAspect: "16:9",
    primaryAspect: "16:9",
    isViewAspectDrawn: true,
    isViewAspectDrawing: false,
    prep: null,
    current: 0,
    playing: false,
    time: currentClockSec,
    durations: [3, 3, 3],
    starts: [0, 3, 6],
    total: 9,
    voiceOn: true,
    musicOn: false,
    master: 1,
    muted: false,
    musicSrc: null,
    pendingCommentScenes: new Set(),
    videos: { current: [null, null, null] },
    voices: { current: [null, null, null] },
    musicAudio: { current: null },
    sfxAudios: { current: {} },
    wantPlay: { current: false },
    rateFor: () => 1,
    onLoadedVideo: () => {},
    onVideoEnded: () => {},
    onAdvanceScene: () => {},
    onSetPlaying: () => {},
    onSetTime: (tVal) => {
      currentClockSec = tVal;
    },
    playSceneSfx: () => {},
    tickSceneSfx: () => {},
    clearSfxTimers: () => {},
    onStatusRefresh: () => {},
    onResolutionsChange: (r) => {
      latestResolutions = r;
    },
    renderMode: "draft",
    liveOptions: {
      flagOverride: true,
      unplayableTickMs: 10,
      environment:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.79 Safari/537.36",
      onTriggerClipRequest: (info) => {
        triggerClipRequestCalls.push(info);
      }
    }
  });

  try {
    harness.render(makeProps(scenesWithClips));
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 10));
      harness.flush();
      if (globalThis.__lastStageFilmPlayer) break;
    }
    const fp = globalThis.__lastStageFilmPlayer;
    assert.ok(fp, "FilmPlayer mounted");
    await fp.waitForChecks();
    await waitForIdle(...fp.scenes);
    await new Promise((r) => setTimeout(r, 30));
    harness.flush();

    // Assert fast scenes (16 ms and 21 ms) switched to live without restarting the film clock, and 72 ms went to clip:
    assert.equal(latestResolutions[0]?.mode, "live", "16 ms scene switched to live");
    assert.equal(latestResolutions[0]?.isPlayable, true);
    assert.equal(latestResolutions[1]?.mode, "live", "21 ms scene switched to live");
    assert.equal(latestResolutions[1]?.isPlayable, true);
    assert.equal(latestResolutions[2]?.mode, "clip", "72 ms slow scene went to clip");
    assert.equal(latestResolutions[2]?.reason, "slow-draw");
    assert.equal(currentClockSec, 1.25, "film clock was not restarted when switching to live");

    // Assert a bundle that is merely drawn/checked queues NO clip request:
    assert.equal(triggerClipRequestCalls.length, 0, "triggerClipRequest is NOT called for drawn/checked bundles");
    assert.equal(clipRequestUrls.length, 0, "zero /clip-request calls made for drawn/checked bundles");

    // Now test the 3-minute unplayable timer (CLIP_AFTER_UNPLAYABLE_MS = 180_000):
    // Revise scene 1 to a new revision whose bundle 404s so it stays unplayable in browser
    const scenesWithUnplayable = [
      scenesWithClips[0],
      {
        index: 1,
        keyword: "Unplayable scene",
        state: "checked",
        seconds: 3,
        frames: 90,
        sig: "sig-unp",
        rev: 1,
        gen: 2,
        v: null,
        variantId: "var-unplayable",
        bundleDigest: "dig-unplayable",
        live: true,
        variants: {
          "16:9": {
            state: "checked",
            sig: "sig-unp",
            v: null,
            gen: 2,
            rev: 1,
            variantId: "var-unplayable",
            bundleDigest: "dig-unplayable",
            live: true
          }
        }
      },
      scenesWithClips[2]
    ];
    harness.render(makeProps(scenesWithUnplayable));
    await new Promise((r) => setTimeout(r, 25));
    harness.flush();

    // Even after bundle fetch fails (404), triggerClipRequest must NOT be called eagerly before 3 minutes!
    assert.equal(
      triggerClipRequestCalls.length,
      0,
      "bundle failing to load does not eagerly call triggerClipRequest before 3 minutes"
    );

    const waitOneTimerTick = () => new Promise((r) => setTimeout(r, 20));

    // 1) Advance 5 minutes while tab is HIDDEN -> must NOT count toward the 3-minute timer!
    fakeDoc.hidden = true;
    fakeDoc.visibilityState = "hidden";
    fakeDoc.dispatchVisibilityChange();
    fakeNowMs += 300_000;
    await waitOneTimerTick();
    harness.flush();
    assert.equal(triggerClipRequestCalls.length, 0, "hidden tab time does not count toward 3-minute unplayable timer");

    // 2) Return tab to VISIBLE and advance 179,000 ms (< 180,000 ms) -> still does not fire
    fakeDoc.hidden = false;
    fakeDoc.visibilityState = "visible";
    fakeDoc.dispatchVisibilityChange();
    fakeNowMs += 179_000;
    await waitOneTimerTick();
    harness.flush();
    assert.equal(triggerClipRequestCalls.length, 0, "timer does not fire at 179s (< 180s)");

    // 3) Advance another 1,000 ms (total 180,000 ms = CLIP_AFTER_UNPLAYABLE_MS while visible) -> fires ONCE!
    fakeNowMs += 1_000;
    await waitOneTimerTick();
    harness.flush();
    assert.equal(triggerClipRequestCalls.length, 1, "3-minute unplayable timer fires triggerClipRequest at 180s visible time");
    assert.deepEqual(triggerClipRequestCalls[0], {
      variantId: "var-unplayable",
      gen: 2,
      bundleDigest: "dig-unplayable",
      reason: "unplayable-timeout"
    });
    assert.equal(clipRequestUrls.length, 1);

    // 4) Advance another 5 minutes while visible -> never fires a second time for the same (variant, gen, digest)
    fakeNowMs += 300_000;
    await waitOneTimerTick();
    harness.flush();
    assert.equal(triggerClipRequestCalls.length, 1, "3-minute unplayable timer fires at most once per (variant, gen, digest)");
    assert.equal(clipRequestUrls.length, 1);
  } finally {
    harness.unmount();
  }
});


