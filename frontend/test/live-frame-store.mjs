import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_QUALITY,
  FRAME_STORE_DB_NAME,
  FRAME_STORE_MAX_BYTES,
  FrameStore,
  InMemoryFrameStoreBackend,
  QualityJob,
  buildQualityJobOrder,
  normalizePreviewQuality,
  parseStoreFrameKey,
  parseStoreSceneKey,
  previewQualityLabel,
  readStoredPreviewQuality,
  storeFrameKey,
  storeSceneKey,
  writeStoredPreviewQuality
} from "../lib/live/frame-store.ts";
import {
  BufferingStateMachine,
  PLAYBACK_WINDOW_FRAMES,
  RESUME_BUFFER_FRAMES,
  START_BUFFER_FRAMES,
  resumeBufferFrames,
  startBufferFrames
} from "../lib/live/predraw.ts";
import { FilmClock, SfxCueTracker } from "../lib/live/clock.ts";
import { PlatePlayer, createFilmPlayer } from "../lib/live/plate-player.ts";

function fakeBitmap(tag = "bm") {
  return {
    width: 640,
    height: 360,
    tag,
    closed: false,
    close() {
      this.closed = true;
    }
  };
}

function makeFakeEncoder(sizeForQuality = (q) => Math.round(q * 50_000), mimeType = "image/webp") {
  let encodeCalls = 0;
  let reencodeCalls = 0;
  let decodeCalls = 0;
  return {
    get encodeCalls() {
      return encodeCalls;
    },
    get reencodeCalls() {
      return reencodeCalls;
    },
    get decodeCalls() {
      return decodeCalls;
    },
    async encode(bm, q) {
      encodeCalls++;
      assert.equal(bm.closed, false, "shown bitmap is never closed by encode()");
      const bytes = new Uint8Array(sizeForQuality(q));
      return new Blob([bytes], { type: mimeType });
    },
    async reencode(_blob, q) {
      reencodeCalls++;
      const bytes = new Uint8Array(sizeForQuality(q));
      return new Blob([bytes], { type: mimeType });
    },
    async decode(blob) {
      decodeCalls++;
      return {
        width: 640,
        height: 360,
        byteSize: blob.size,
        fromStore: true,
        closed: false,
        close() {
          this.closed = true;
        }
      };
    }
  };
}

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

test("store keys, constants, and localStorage quality persistence", () => {
  assert.equal(FRAME_STORE_DB_NAME, "gm-live-frames");
  assert.equal(FRAME_STORE_MAX_BYTES, 500 * 1024 * 1024);
  assert.equal(DEFAULT_PREVIEW_QUALITY, 0.4);

  const sKey = storeSceneKey("dig-abc", "640x360");
  assert.equal(sKey, "dig-abc|640x360");
  assert.deepEqual(parseStoreSceneKey(sKey), { bundleDigest: "dig-abc", size: "640x360" });
  assert.equal(parseStoreSceneKey("invalid"), null);

  const fKey = storeFrameKey("dig-abc", "640x360", 42);
  assert.equal(fKey, "dig-abc|640x360|42");
  assert.deepEqual(parseStoreFrameKey(fKey), { bundleDigest: "dig-abc", size: "640x360", frame: 42 });
  assert.equal(parseStoreFrameKey("dig-abc|640x360|-1"), null);

  const memStorage = new Map();
  const storageStub = {
    getItem: (k) => memStorage.get(k) ?? null,
    setItem: (k, v) => memStorage.set(k, v)
  };
  assert.equal(readStoredPreviewQuality(storageStub), 0.4);
  assert.equal(writeStoredPreviewQuality(0.6, storageStub), 0.6);
  assert.equal(readStoredPreviewQuality(storageStub), 0.6);
  assert.equal(previewQualityLabel(0.2), "Low");
  assert.equal(previewQualityLabel(0.4), "Standard");
  assert.equal(previewQualityLabel(0.6), "High");
  assert.equal(normalizePreviewQuality("0.2"), 0.2);
  assert.equal(normalizePreviewQuality("invalid"), 0.4);
});

test("FrameStore completion, zero-Worker replay, and resume from first missing frame", async () => {
  const backend = new InMemoryFrameStoreBackend();
  const encoder = makeFakeEncoder();
  const store = new FrameStore({ backend, encoder, openFilmKey: "film-1" });

  await store.registerScene({ bundleDigest: "d-scene-0", sizeLabel: "640x360", frames: 5, filmKey: "film-1" });
  assert.equal(store.isSceneComplete("d-scene-0", "640x360", 5), false);
  assert.equal(store.firstMissingFrame("d-scene-0", "640x360", 5), 0);

  // Save frames 0, 1, 2 (partly saved scene)
  for (let f = 0; f < 3; f++) {
    const bm = fakeBitmap(`f-${f}`);
    const ok = await store.save(bm, storeFrameKey("d-scene-0", "640x360", f), 0.4, { frames: 5, filmKey: "film-1" });
    assert.equal(ok, true);
    assert.equal(bm.closed, false, "shown bitmap is untouched");
  }

  assert.equal(store.isSceneComplete("d-scene-0", "640x360", 5), false);
  assert.equal(store.firstMissingFrame("d-scene-0", "640x360", 5), 3);
  assert.deepEqual(store.missingFrames("d-scene-0", "640x360", 5), [3, 4]);

  // Mount a PlatePlayer on the partly saved scene (frames 0..2 saved, 3..4 missing):
  // It must NOT redraw frames 0, 1, 2; it must only draw frames 3 and 4!
  const drawnFrames = [];
  const partialPlayer = new PlatePlayer({
    bundleDigest: "d-scene-0",
    html: "<script>window.FILM={};</script>",
    frames: 5,
    fps: 30,
    frameStore: store,
    filmKey: "film-1",
    transportFactory: async () => {
      const port = {
        onmessage: null,
        postMessage(msg) {
          if (msg.t === "init") port.onmessage?.({ data: { t: "init", id: msg.id, w: 640, h: 360, meta: { fps: 30, durationFrames: 5 } } });
          else if (msg.t === "frame") {
            drawnFrames.push(msg.n);
            port.onmessage?.({ data: { t: "frame", id: msg.id, n: msg.n, bitmap: fakeBitmap(`drawn-${msg.n}`), drawMs: 10 } });
          }
        }
      };
      return { port, terminate() {} };
    }
  });

  await partialPlayer.mount(fakeElement());
  await store.flush();
  assert.deepEqual(drawnFrames, [3, 4], "partly saved scene drew ONLY missing frames 3 and 4");
  assert.equal(store.isSceneComplete("d-scene-0", "640x360", 5), true, "scene is now marked complete");
  partialPlayer.destroy();

  // Now simulate page reload with a new FrameStore instance over the same backend:
  // Replaying the complete scene must make ZERO Worker transport spawns and ZERO frame draws!
  const storeAfterReload = new FrameStore({ backend, encoder, openFilmKey: "film-1" });
  let workerSpawnsOnReplay = 0;
  let workerFramesOnReplay = 0;
  const replayEl = fakeElement();
  const replayPlayer = new PlatePlayer({
    bundleDigest: "d-scene-0",
    html: "<script>window.FILM={};</script>",
    frames: 5,
    fps: 30,
    frameStore: storeAfterReload,
    filmKey: "film-1",
    transportFactory: async () => {
      workerSpawnsOnReplay++;
      return {
        port: {
          onmessage: null,
          postMessage(msg) {
            if (msg.t === "frame") workerFramesOnReplay++;
          }
        },
        terminate() {}
      };
    }
  });

  await replayPlayer.mount(replayEl);
  for (let f = 0; f < 5; f++) {
    replayPlayer.showFrame(f);
    assert.equal(replayPlayer.ready(f), true);
  }
  assert.equal(workerSpawnsOnReplay, 0, "complete scene replay does not spawn a drawing Worker at all");
  assert.equal(workerFramesOnReplay, 0, "complete scene replay makes zero WorkerHost.frame calls");
  assert.equal(replayEl.drawn.length >= 5, true);
  replayPlayer.destroy();
  store.destroy();
  storeAfterReload.destroy();
});

test("FrameStore: non-WebP blob disables storing for the browser session and reports status", async () => {
  const backend = new InMemoryFrameStoreBackend();
  const pngEncoder = makeFakeEncoder(() => 10_000, "image/png");
  const statuses = [];
  const store = new FrameStore({
    backend,
    encoder: pngEncoder,
    onStatusChange: (st) => statuses.push(st)
  });

  const ok = await store.save(fakeBitmap(), storeFrameKey("d-png", "640x360", 0), 0.4, { frames: 10 });
  assert.equal(ok, false);
  assert.equal(store.disabled, true);
  assert.match(store.disabledReason ?? "", /WebP/i);
  assert.equal(statuses.at(-1)?.disabled, true);
  assert.equal(backend.frames.size, 0, "nothing stored when browser does not return image/webp");
  store.destroy();
});

test("FrameStore revision deletion: changing a scene's bundleDigest deletes the superseded digest's frames only", async () => {
  const backend = new InMemoryFrameStoreBackend();
  const store = new FrameStore({ backend, encoder: makeFakeEncoder(), openFilmKey: "film-rev" });

  await store.registerScene({
    bundleDigest: "dig-s0-v1",
    sizeLabel: "640x360",
    frames: 3,
    filmKey: "film-rev",
    variantKey: "film-rev:scene-0"
  });
  await store.registerScene({
    bundleDigest: "dig-s1-v1",
    sizeLabel: "640x360",
    frames: 3,
    filmKey: "film-rev",
    variantKey: "film-rev:scene-1"
  });

  for (let f = 0; f < 3; f++) {
    await store.save(fakeBitmap(), storeFrameKey("dig-s0-v1", "640x360", f), 0.4, {
      frames: 3,
      filmKey: "film-rev",
      variantKey: "film-rev:scene-0"
    });
    await store.save(fakeBitmap(), storeFrameKey("dig-s1-v1", "640x360", f), 0.4, {
      frames: 3,
      filmKey: "film-rev",
      variantKey: "film-rev:scene-1"
    });
  }
  assert.equal(store.isSceneComplete("dig-s0-v1", "640x360", 3), true);
  assert.equal(store.isSceneComplete("dig-s1-v1", "640x360", 3), true);

  // Scene 0 gets a new revision `dig-s0-v2` for `film-rev:scene-0`
  await store.registerScene({
    bundleDigest: "dig-s0-v2",
    sizeLabel: "640x360",
    frames: 3,
    filmKey: "film-rev",
    variantKey: "film-rev:scene-0"
  });

  assert.equal(store.getSceneRecord("dig-s0-v1", "640x360"), undefined, "superseded scene 0 record deleted");
  assert.equal(await backend.getFrame(storeFrameKey("dig-s0-v1", "640x360", 0)), undefined, "superseded scene 0 frames deleted");
  assert.equal(store.isSceneComplete("dig-s1-v1", "640x360", 3), true, "scene 1 frames kept untouched");
  store.destroy();
});

test("FrameStore LRU eviction: evicts whole films least recently used, never the open film", async () => {
  let clockNow = 1_000;
  const backend = new InMemoryFrameStoreBackend();
  // Each frame at 0.4 is 20,000 bytes; cap at 90,000 bytes (4.5 frames total)
  const encoder = makeFakeEncoder(() => 20_000);
  const store = new FrameStore({
    backend,
    encoder,
    maxBytes: 90_000,
    openFilmKey: "film-old",
    now: () => clockNow
  });

  // 1. Save 2 frames for film-old at t = 1000 (40 KB)
  clockNow = 1_000;
  for (let f = 0; f < 2; f++) {
    await store.save(fakeBitmap(), storeFrameKey("d-old", "640x360", f), 0.4, { frames: 2, filmKey: "film-old" });
  }

  // 2. Save 2 frames for film-mid at t = 2000 (40 KB -> total 80 KB <= 90 KB)
  clockNow = 2_000;
  store.setOpenFilmKey("film-mid");
  for (let f = 0; f < 2; f++) {
    await store.save(fakeBitmap(), storeFrameKey("d-mid", "640x360", f), 0.4, { frames: 2, filmKey: "film-mid" });
  }
  assert.equal(store.totalBytes(), 80_000);

  // 3. Now open film is `film-old` (even though its timestamp is oldest, it is the open film so it must NEVER be evicted!).
  // Add a third film `film-new` at t = 3000 while openFilmKey is `film-old`... wait: in practice the open film is the one
  // being watched; let's test BOTH:
  // (a) When `film-new` is open, `film-old` (least recently used at t=1000) is evicted before `film-mid` (t=2000):
  clockNow = 3_000;
  store.setOpenFilmKey("film-new");
  await store.save(fakeBitmap(), storeFrameKey("d-new", "640x360", 0), 0.4, { frames: 2, filmKey: "film-new" });
  await store.save(fakeBitmap(), storeFrameKey("d-new", "640x360", 1), 0.4, { frames: 2, filmKey: "film-new" });

  assert.equal(store.getSceneRecord("d-old", "640x360"), undefined, "oldest film (film-old) evicted first");
  assert.ok(store.getSceneRecord("d-mid", "640x360"), "newer film (film-mid) kept");
  assert.ok(store.getSceneRecord("d-new", "640x360"), "open film (film-new) kept");
  assert.ok(store.totalBytes() <= 90_000);

  // (b) Even if the open film alone exceeds maxBytes, the open film is NEVER evicted:
  for (let f = 2; f < 6; f++) {
    await store.save(fakeBitmap(), storeFrameKey("d-new", "640x360", f), 0.4, { frames: 6, filmKey: "film-new" });
  }
  assert.equal(store.getSceneRecord("d-mid", "640x360"), undefined, "non-open film-mid evicted");
  assert.equal(store.getSceneRecord("d-new", "640x360")?.saved, 6, "open film is never evicted even when exceeding cap");
  store.destroy();
});

test("QualityJob: ordering (ahead of playhead first, outward, rest of film; re-centre on scrub), raise=redraw, lower=re-encode, persistence & resume", async () => {
  const scenes = [
    { sceneIndex: 0, bundleDigest: "d0", sizeLabel: "640x360", frames: 6 },
    { sceneIndex: 1, bundleDigest: "d1", sizeLabel: "640x360", frames: 4 },
    { sceneIndex: 2, bundleDigest: "d2", sizeLabel: "640x360", frames: 3 }
  ];

  // Test pure ordering from scene 1, frame 2 with aheadCount = 2:
  // 1. Focus scene 1 ahead window: frames 2, 3
  // 2. Focus scene 1 outward behind: frames 1, 0
  // 3. Following scenes: scene 2 frames 0, 1, 2
  // 4. Preceding scenes: scene 0 frames 0..5
  const order = buildQualityJobOrder(scenes, 1, 2, 2);
  assert.deepEqual(
    order.map((s) => `${s.sceneIndex}:${s.frame}`),
    ["1:2", "1:3", "1:1", "1:0", "2:0", "2:1", "2:2", "0:0", "0:1", "0:2", "0:3", "0:4", "0:5"]
  );

  // Populate store at quality 0.4 for all 3 scenes (13 frames total)
  const backend = new InMemoryFrameStoreBackend();
  const encoder = makeFakeEncoder();
  const store = new FrameStore({ backend, encoder, openFilmKey: "film-q" });
  for (const sc of scenes) {
    await store.registerScene({ bundleDigest: sc.bundleDigest, sizeLabel: sc.sizeLabel, frames: sc.frames, filmKey: "film-q" });
    for (let f = 0; f < sc.frames; f++) {
      await store.save(fakeBitmap(), storeFrameKey(sc.bundleDigest, sc.sizeLabel, f), 0.4, { frames: sc.frames, filmKey: "film-q" });
    }
  }

  // 1. Raise quality 0.4 -> 0.6, scrubbing to (scene 2, frame 1) after the first 2 frames:
  const redrawn = [];
  const progressTexts = [];
  let jobRef = null;
  const raiseJob = new QualityJob({
    store,
    scenes,
    targetQuality: 0.6,
    initialSceneIndex: 0,
    initialFrame: 2,
    redrawFrame: async (sceneIndex, frame) => {
      redrawn.push(`${sceneIndex}:${frame}`);
      if (redrawn.length === 2) {
        // Simulate user scrubbing to scene 2, frame 1 mid-job!
        jobRef.recenter(2, 1);
      }
      return fakeBitmap(`redraw-${sceneIndex}-${frame}`);
    },
    onProgress: (p) => {
      if (p.text) progressTexts.push(p.text);
    }
  });
  jobRef = raiseJob;
  await raiseJob.start();

  assert.equal(redrawn.length, 13, "raising quality redraws all 13 frames");
  assert.equal(redrawn[0], "0:2", "started right at the initial playhead 0:2");
  assert.equal(redrawn[1], "0:3", "second frame was 0:3 just ahead of playhead");
  assert.equal(redrawn[2], "2:1", "scrubbing to 2:1 immediately re-centred the next upgraded frame to 2:1");
  assert.equal(redrawn[3], "2:2", "then 2:2 ahead of the new playhead");
  assert.ok(progressTexts.some((t) => t.startsWith("Raising preview quality… ")));
  for (const sc of scenes) {
    assert.equal(store.getSceneRecord(sc.bundleDigest, sc.sizeLabel)?.quality, 0.6);
  }

  // 2. Lower quality 0.6 -> 0.2: must use re-encode path with ZERO redraws!
  let redrawsOnLower = 0;
  const reencodesBefore = encoder.reencodeCalls;
  const lowerTexts = [];
  const lowerJob = new QualityJob({
    store,
    scenes,
    targetQuality: 0.2,
    initialSceneIndex: 1,
    initialFrame: 1,
    redrawFrame: async () => {
      redrawsOnLower++;
      return fakeBitmap();
    },
    onProgress: (p) => {
      if (p.text) lowerTexts.push(p.text);
    }
  });
  await lowerJob.start();
  assert.equal(redrawsOnLower, 0, "lowering quality makes zero WorkerHost redraw calls");
  assert.equal(encoder.reencodeCalls - reencodesBefore, 13, "all 13 frames were re-encoded from stored blobs");
  assert.ok(lowerTexts.some((t) => t.startsWith("Lowering preview quality… ")));
  for (const sc of scenes) {
    assert.equal(store.getSceneRecord(sc.bundleDigest, sc.sizeLabel)?.quality, 0.2);
  }

  // 3. Persistence & resume after reload: cancel a raise job halfway through, then reload store and resume!
  let partialRedraws = 0;
  let partialJob = null;
  partialJob = new QualityJob({
    store,
    scenes,
    targetQuality: 0.6,
    redrawFrame: async (sceneIndex, frame) => {
      partialRedraws++;
      if (partialRedraws >= 5) {
        partialJob.cancel();
      }
      return fakeBitmap(`p-${sceneIndex}-${frame}`);
    }
  });
  await partialJob.start();
  assert.equal(store.getSceneRecord("d0", "640x360")?.quality, "mixed", "partly upgraded scene has quality 'mixed'");

  // Reload store from backend and run a resumed QualityJob to 0.6: only the remaining un-upgraded frames redraw!
  const reloadedStore = new FrameStore({ backend, encoder, openFilmKey: "film-q", defaultQuality: 0.6 });
  await reloadedStore.init();
  let resumedRedraws = 0;
  const resumeJob = new QualityJob({
    store: reloadedStore,
    scenes,
    targetQuality: 0.6,
    redrawFrame: async () => {
      resumedRedraws++;
      return fakeBitmap();
    }
  });
  await resumeJob.start();
  assert.equal(resumedRedraws, 13 - 4, "resumed job only redrew the remaining 9 frames that were still at 0.2");
  for (const sc of scenes) {
    assert.equal(reloadedStore.getSceneRecord(sc.bundleDigest, sc.sizeLabel)?.quality, 0.6);
  }
  store.destroy();
  reloadedStore.destroy();
});

test("BufferingStateMachine: start rule max(30, L), catch-up enters buffering and holds frame, resume at min(30, framesLeft)", () => {
  assert.equal(START_BUFFER_FRAMES, 30);
  assert.equal(PLAYBACK_WINDOW_FRAMES, 90);
  assert.equal(RESUME_BUFFER_FRAMES, 30);

  const m = new BufferingStateMachine();
  assert.equal(m.state, "drawing");

  // Scene with 100 frames and lead L = 45 -> start threshold is max(30, 45) = 45 frames
  let snap = m.step({ currentFrame: 0, totalFrames: 100, leadFrames: 45, readyAhead: 20, wantPlay: true });
  assert.equal(snap.state, "drawing");
  assert.equal(snap.clockPaused, true);
  assert.equal(snap.neededFrames, 45);
  assert.equal(snap.shownFrame, 0);

  // Reach 45 frames ready ahead -> transitions to `playing`, clock unpauses
  snap = m.step({ currentFrame: 0, totalFrames: 100, leadFrames: 45, readyAhead: 45, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.clockPaused, false);
  assert.equal(snap.shownFrame, 0);

  // Play to frame 10 (ready)
  snap = m.step({ currentFrame: 10, totalFrames: 100, leadFrames: 45, readyAhead: 15, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.shownFrame, 10);

  // Frame 11 is NOT ready (readyAhead = 0) -> enters `buffering`, holds frame 10, pauses clock!
  snap = m.step({ currentFrame: 11, totalFrames: 100, leadFrames: 45, readyAhead: 0, wantPlay: true });
  assert.equal(snap.state, "buffering");
  assert.equal(snap.clockPaused, true);
  assert.equal(snap.shownFrame, 10, "holds last shown frame 10, never shows a wrong frame");
  assert.equal(snap.neededFrames, 30, "resume threshold is min(30, 89) = 30");
  assert.equal(snap.bufferingCount, 1);

  // Only 15 frames ready ahead at frame 11 -> stays in `buffering`, still holds frame 10
  snap = m.step({ currentFrame: 11, totalFrames: 100, leadFrames: 45, readyAhead: 15, wantPlay: true });
  assert.equal(snap.state, "buffering");
  assert.equal(snap.clockPaused, true);
  assert.equal(snap.shownFrame, 10);

  // 30 frames ready ahead at frame 11 -> exits `buffering` to `playing`, shows frame 11, clock unpauses!
  snap = m.step({ currentFrame: 11, totalFrames: 100, leadFrames: 45, readyAhead: 30, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.clockPaused, false);
  assert.equal(snap.shownFrame, 11);

  // Near the end of the scene (frame 90 of 100 -> 10 frames left): missing frame 90 resumes when min(30, 10) = 10 frames are ready
  snap = m.step({ currentFrame: 90, totalFrames: 100, leadFrames: 45, readyAhead: 0, wantPlay: true });
  assert.equal(snap.state, "buffering");
  assert.equal(snap.neededFrames, 10);
  snap = m.step({ currentFrame: 90, totalFrames: 100, leadFrames: 45, readyAhead: 10, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.shownFrame, 90);
});

test("SfxCueTracker and FilmClock: cue plays once when crossed while playing, never when jumped over by seek, never while buffering", () => {
  const tracker = new SfxCueTracker();
  const cues = [
    { name: "impact-bass-1", offset: 0.1, volume: 0.5 },
    { name: "pop", offset: 0.5, volume: 0.7 },
    { name: "chime", offset: 1.2, volume: 0.9 }
  ];
  tracker.setCues(cues, 0);

  // 1. Cross 0.1 while playing -> fires once, never twice
  assert.deepEqual(tracker.tick(0.05, { playing: true, buffering: false }), []);
  assert.deepEqual(
    tracker.tick(0.15, { playing: true, buffering: false }).map((c) => c.name),
    ["impact-bass-1"]
  );
  assert.deepEqual(tracker.tick(0.20, { playing: true, buffering: false }), [], "never fires a second time");

  // 2. While buffering (or paused), even if tick is called across 0.5, it NEVER fires and does not consume the cue
  assert.deepEqual(tracker.tick(0.60, { playing: true, buffering: true }), []);
  assert.deepEqual(tracker.tick(0.60, { playing: false, buffering: false }), []);
  // Once buffering ends and clock ticks to 0.55, the cue at 0.5 fires!
  assert.deepEqual(
    tracker.tick(0.55, { playing: true, buffering: false }).map((c) => c.name),
    ["pop"]
  );

  // 3. Seek from 0.55 to 1.50 jumps over the cue at 1.2 -> NEVER fires 1.2!
  tracker.seek(1.5);
  assert.deepEqual(tracker.tick(1.6, { playing: true, buffering: false }), [], "seeking over 1.2 never fires it");

  // 4. Seek backwards to 0.40 re-arms cues >= 0.40 (`pop` at 0.5 and `chime` at 1.2), but NOT `impact-bass-1` at 0.1
  tracker.seek(0.4);
  assert.deepEqual(
    tracker.tick(0.6, { playing: true, buffering: false }).map((c) => c.name),
    ["pop"]
  );

  // 5. FilmClock pauses voice & music on buffering and resyncs currentTime on resume
  const stubVo = {
    currentTime: 0,
    paused: true,
    play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    }
  };
  const stubMusic = {
    currentTime: 0,
    paused: true,
    play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    }
  };
  const firedInClock = [];
  const fc = new FilmClock({
    fps: 30,
    frames: 90,
    spans: [{ id: "s0", start: 0, end: 3 }],
    audio: {
      voices: [stubVo],
      music: stubMusic,
      sceneCues: () => cues,
      onCueFired: (_idx, c) => firedInClock.push(c.name)
    }
  });

  fc.play();
  assert.equal(stubVo.paused, false);
  assert.equal(stubMusic.paused, false);
  fc.tickTo(0.2);
  assert.deepEqual(firedInClock, ["impact-bass-1"]);

  // Enter buffering -> pauses voice and music immediately
  fc.setBuffering(true);
  assert.equal(stubVo.paused, true);
  assert.equal(stubMusic.paused, true);
  assert.equal(fc.playing(), false);

  // Simulate audio element drifting while paused/buffered, then exit buffering -> resyncs to 0.2 and plays
  stubVo.currentTime = 0.99;
  fc.setBuffering(false);
  assert.equal(stubVo.paused, false);
  assert.equal(stubMusic.paused, false);
  assert.ok(Math.abs(stubVo.currentTime - 0.2) < 1e-6, "voice currentTime resynced to clock on resume");
});
