import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREVIEW_QUALITY,
  FRAME_STORE_DB_NAME,
  FRAME_STORE_MAX_BYTES,
  FrameStore,
  InMemoryFrameStoreBackend,
  MAX_ENCODER_QUEUE,
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
  DECODED_WINDOW_FRAMES,
  PLAYBACK_WINDOW_FRAMES,
  RESUME_BUFFER_FRAMES,
  START_BUFFER_FRAMES
} from "../lib/live/predraw.ts";
import { FilmClock, SfxCueTracker } from "../lib/live/clock.ts";
import { FakeAudioContext, WebAudioFilmTimeline } from "../lib/live/film-audio.ts";
import { PlatePlayer, createFilmPlayer } from "../lib/live/plate-player.ts";

function makeBitmapCounter() {
  const stats = { opened: 0, closed: 0 };
  const make = (tag = "bm", extra = {}) => {
    stats.opened++;
    let isClosed = false;
    return {
      width: 640,
      height: 360,
      tag,
      ...extra,
      get closed() {
        return isClosed;
      },
      close() {
        if (!isClosed) {
          isClosed = true;
          stats.closed++;
        }
      }
    };
  };
  return { stats, make };
}

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

function makeFakeEncoder(sizeForQuality = (q) => Math.round(q * 50_000), mimeType = "image/webp", bitmapFactory = null) {
  let encodeCalls = 0;
  let decodeCalls = 0;
  return {
    get encodeCalls() {
      return encodeCalls;
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
    async decode(blob) {
      decodeCalls++;
      if (bitmapFactory) {
        return bitmapFactory("decoded", { byteSize: blob.size, fromStore: true });
      }
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
  assert.equal(MAX_ENCODER_QUEUE, 8);
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
  const encoder = makeFakeEncoder(() => 20_000);
  const store = new FrameStore({
    backend,
    encoder,
    maxBytes: 90_000,
    openFilmKey: "film-old",
    now: () => clockNow
  });

  clockNow = 1_000;
  for (let f = 0; f < 2; f++) {
    await store.save(fakeBitmap(), storeFrameKey("d-old", "640x360", f), 0.4, { frames: 2, filmKey: "film-old" });
  }

  clockNow = 2_000;
  store.setOpenFilmKey("film-mid");
  for (let f = 0; f < 2; f++) {
    await store.save(fakeBitmap(), storeFrameKey("d-mid", "640x360", f), 0.4, { frames: 2, filmKey: "film-mid" });
  }
  assert.equal(store.totalBytes(), 80_000);

  clockNow = 3_000;
  store.setOpenFilmKey("film-new");
  await store.save(fakeBitmap(), storeFrameKey("d-new", "640x360", 0), 0.4, { frames: 2, filmKey: "film-new" });
  await store.save(fakeBitmap(), storeFrameKey("d-new", "640x360", 1), 0.4, { frames: 2, filmKey: "film-new" });

  assert.equal(store.getSceneRecord("d-old", "640x360"), undefined, "oldest film (film-old) evicted first");
  assert.ok(store.getSceneRecord("d-mid", "640x360"), "newer film (film-mid) kept");
  assert.ok(store.getSceneRecord("d-new", "640x360"), "open film (film-new) kept");
  assert.ok(store.totalBytes() <= 90_000);

  for (let f = 2; f < 6; f++) {
    await store.save(fakeBitmap(), storeFrameKey("d-new", "640x360", f), 0.4, { frames: 6, filmKey: "film-new" });
  }
  assert.equal(store.getSceneRecord("d-mid", "640x360"), undefined, "non-open film-mid evicted");
  assert.equal(store.getSceneRecord("d-new", "640x360")?.saved, 6, "open film is never evicted even when exceeding cap");
  store.destroy();
});

test("QualityJob: ordering (ahead of playhead first, outward, rest of film; re-centre on scrub), BOTH raise and lower redraw from scene code, persistence & resume", async () => {
  const scenes = [
    { sceneIndex: 0, bundleDigest: "d0", sizeLabel: "640x360", frames: 6 },
    { sceneIndex: 1, bundleDigest: "d1", sizeLabel: "640x360", frames: 4 },
    { sceneIndex: 2, bundleDigest: "d2", sizeLabel: "640x360", frames: 3 }
  ];

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
  const redrawnOnRaise = [];
  const raiseBitmaps = [];
  const progressTexts = [];
  let jobRef = null;
  const raiseJob = new QualityJob({
    store,
    scenes,
    targetQuality: 0.6,
    initialSceneIndex: 0,
    initialFrame: 2,
    redrawFrame: async (sceneIndex, frame) => {
      redrawnOnRaise.push(`${sceneIndex}:${frame}`);
      if (redrawnOnRaise.length === 2) {
        jobRef.recenter(2, 1);
      }
      const bm = fakeBitmap(`raise-${sceneIndex}-${frame}`);
      raiseBitmaps.push(bm);
      return bm;
    },
    onProgress: (p) => {
      if (p.text) progressTexts.push(p.text);
    }
  });
  jobRef = raiseJob;
  await raiseJob.start();

  assert.equal(redrawnOnRaise.length, 13, "raising quality redraws all 13 frames");
  assert.equal(redrawnOnRaise[0], "0:2", "started right at the initial playhead 0:2");
  assert.equal(redrawnOnRaise[1], "0:3", "second frame was 0:3 just ahead of playhead");
  assert.equal(redrawnOnRaise[2], "2:1", "scrubbing to 2:1 immediately re-centred the next upgraded frame to 2:1");
  assert.equal(redrawnOnRaise[3], "2:2", "then 2:2 ahead of the new playhead");
  assert.ok(progressTexts.some((t) => t.startsWith("Raising preview quality… ")));
  assert.ok(raiseBitmaps.every((b) => b.closed), "every bitmap redrawn by raiseJob is closed");
  for (const sc of scenes) {
    assert.equal(store.getSceneRecord(sc.bundleDigest, sc.sizeLabel)?.quality, 0.6);
  }

  // 2. Lower quality 0.6 -> 0.2: MUST ALSO REDRAW with the scene code (never decode-and-re-encode a stored lossy copy)!
  const redrawnOnLower = [];
  const lowerBitmaps = [];
  const lowerTexts = [];
  const decodesBeforeLower = encoder.decodeCalls;
  const lowerJob = new QualityJob({
    store,
    scenes,
    targetQuality: 0.2,
    initialSceneIndex: 1,
    initialFrame: 1,
    redrawFrame: async (sceneIndex, frame) => {
      redrawnOnLower.push(`${sceneIndex}:${frame}`);
      const bm = fakeBitmap(`lower-${sceneIndex}-${frame}`);
      lowerBitmaps.push(bm);
      return bm;
    },
    onProgress: (p) => {
      if (p.text) lowerTexts.push(p.text);
    }
  });
  await lowerJob.start();
  assert.equal(redrawnOnLower.length, 13, "lowering quality 0.6 -> 0.2 redraws all 13 frames with scene code");
  assert.equal(redrawnOnLower[0], "1:1", "lowering starts at playhead 1:1");
  assert.equal(redrawnOnLower[1], "1:2", "then 1:2 ahead of playhead");
  assert.equal(encoder.decodeCalls - decodesBeforeLower, 0, "lowering never decodes a stored blob to re-encode it");
  assert.ok(lowerTexts.some((t) => t.startsWith("Lowering preview quality… ")));
  assert.ok(lowerBitmaps.every((b) => b.closed), "every bitmap redrawn by lowerJob is closed");
  for (const sc of scenes) {
    assert.equal(store.getSceneRecord(sc.bundleDigest, sc.sizeLabel)?.quality, 0.2);
  }

  // 3. Persistence & resume after reload: cancel a raise job halfway through, then reload store and resume!
  let partialRedraws = 0;
  let partialJob = null;
  const partialBitmaps = [];
  partialJob = new QualityJob({
    store,
    scenes,
    targetQuality: 0.6,
    redrawFrame: async (sceneIndex, frame) => {
      partialRedraws++;
      if (partialRedraws >= 5) {
        partialJob.cancel();
      }
      const bm = fakeBitmap(`p-${sceneIndex}-${frame}`);
      partialBitmaps.push(bm);
      return bm;
    }
  });
  await partialJob.start();
  assert.ok(partialBitmaps.every((b) => b.closed), "cancelled job closes in-flight bitmap");
  assert.equal(store.getSceneRecord("d0", "640x360")?.quality, "mixed", "partly upgraded scene has quality 'mixed'");

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

test("Background-work limits: bounded encoder queue (<= 8), bitmap opens == closes on all paths, and cancellation on digest/quality change", async () => {
  const { stats, make } = makeBitmapCounter();
  const backend = new InMemoryFrameStoreBackend();

  let activeEncoderTasks = 0;
  let maxConcurrentEncoderTasks = 0;
  const releaseGate = [];

  const slowBoundedEncoder = {
    async encode(bm, q) {
      assert.equal(bm.closed, false);
      activeEncoderTasks++;
      if (activeEncoderTasks > maxConcurrentEncoderTasks) {
        maxConcurrentEncoderTasks = activeEncoderTasks;
      }
      await new Promise((r) => releaseGate.push(r));
      activeEncoderTasks--;
      return new Blob([new Uint8Array(Math.round(q * 30_000))], { type: "image/webp" });
    },
    async decode(blob) {
      return make("decoded", { byteSize: blob.size, fromStore: true });
    }
  };

  const store = new FrameStore({
    backend,
    encoder: slowBoundedEncoder,
    maxEncoderQueue: MAX_ENCODER_QUEUE,
    openFilmKey: "film-limits"
  });

  // 1. Fire 20 concurrent store.save() calls: only MAX_ENCODER_QUEUE (8) may enter the encoder at once; the rest wait!
  const bms = Array.from({ length: 20 }, (_, i) => make(`raw-${i}`));
  const savePromises = bms.map((bm, i) =>
    store.save(bm, storeFrameKey("dig-bound", "640x360", i), 0.4, { frames: 20, filmKey: "film-limits" }).finally(() => bm.close())
  );

  // Give microtasks a chance to settle
  for (let tick = 0; tick < 10; tick++) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(store.inFlightEncodes, MAX_ENCODER_QUEUE, "in-flight encodes capped at MAX_ENCODER_QUEUE (8)");
  assert.equal(maxConcurrentEncoderTasks, MAX_ENCODER_QUEUE, "encoder never receives more than 8 concurrent frames");

  // Drain all 20 saves in waves
  while (releaseGate.length > 0) {
    const fn = releaseGate.shift();
    fn();
    await new Promise((r) => setImmediate(r));
  }
  await Promise.all(savePromises);
  assert.ok(store.peakEncoderQueue <= MAX_ENCODER_QUEUE, `peakEncoderQueue (${store.peakEncoderQueue}) <= ${MAX_ENCODER_QUEUE}`);
  assert.equal(stats.opened, stats.closed, `all 20 bitmaps closed (${stats.opened} == ${stats.closed})`);

  // 2. End-to-end FilmPlayer with bitmap counter, quality change cancellation, and bundleDigest revision cancellation:
  const { stats: filmStats, make: makeFilmBm } = makeBitmapCounter();
  const fastEncoder = makeFakeEncoder((q) => Math.round(q * 30_000), "image/webp", makeFilmBm);
  const filmStore = new FrameStore({
    backend: new InMemoryFrameStoreBackend(),
    encoder: fastEncoder,
    openFilmKey: "film-cancel"
  });

  let timeSec = 0;
  const film = createFilmPlayer({
    filmKey: "film-cancel",
    scenes: [
      { id: "s0", bundleDigest: "d0-v1", html: "<script>window.FILM={};</script>", frames: 12 },
      { id: "s1", bundleDigest: "d1-v1", html: "<script>window.FILM={};</script>", frames: 12 }
    ],
    fps: 30,
    frameStore: filmStore,
    timeSource: { currentTime: () => timeSec, playing: () => false },
    transportFactory: async () => {
      const port = {
        onmessage: null,
        postMessage(msg) {
          if (msg.t === "init") {
            port.onmessage?.({ data: { t: "init", id: msg.id, w: 640, h: 360, meta: { fps: 30, durationFrames: 12 } } });
          } else if (msg.t === "hb") {
            port.onmessage?.({ data: { t: "hb", id: msg.id } });
          } else if (msg.t === "frame") {
            setTimeout(() => {
              port.onmessage?.({
                data: { t: "frame", id: msg.id, n: msg.n, bitmap: makeFilmBm(`worker-${msg.n}`), drawMs: 5 }
              });
            }, 2);
          }
        }
      };
      return { port, terminate() {} };
    }
  });

  await film.mount(fakeElement());
  for (const sc of film.scenes) {
    await sc.drawAllToStore(() => false);
  }
  await film.flushStore();

  // Start quality job 0.4 -> 0.6, then immediately switch to 0.2 (old job stops, new one starts)
  const p06 = film.setPreviewQuality(0.6);
  const job06 = film.qualityJob;
  await new Promise((r) => setTimeout(r, 5));
  const p02 = film.setPreviewQuality(0.2);
  assert.equal(job06.running, false, "old quality job was cancelled when setting changed");

  // While 0.2 quality job is running, update scene 0's bundleDigest (`d0-v1` -> `d0-v2`): cancels old digest work
  await film.updateScene(0, {
    id: "s0",
    bundleDigest: "d0-v2",
    html: "<script>window.FILM={};</script>",
    frames: 12
  });
  await p06.catch(() => {});
  await p02.catch(() => {});
  await film.scenes[0].drawAllToStore(() => false);
  await film.flushStore();

  assert.equal(filmStore.getSceneRecord("d0-v1", "640x360"), undefined, "cancelled old bundleDigest stays deleted");
  assert.equal(filmStore.isSceneComplete("d0-v2", "640x360", 12), true, "new bundleDigest completed");

  film.destroy();
  filmStore.destroy();
  store.destroy();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    filmStats.opened,
    filmStats.closed,
    `every ImageBitmap created across draw, quality cancel, digest revision, and destroy was closed (opened=${filmStats.opened}, closed=${filmStats.closed})`
  );
});

test("BufferingStateMachine: start rule max(30, L), catch-up enters buffering and holds frame, resume at min(30, framesLeft)", () => {
  assert.equal(START_BUFFER_FRAMES, 30);
  assert.equal(DECODED_WINDOW_FRAMES, 90);
  assert.equal(PLAYBACK_WINDOW_FRAMES, 90);
  assert.equal(RESUME_BUFFER_FRAMES, 30);

  const m = new BufferingStateMachine();
  assert.equal(m.state, "drawing");

  let snap = m.step({ currentFrame: 0, totalFrames: 100, leadFrames: 45, readyAhead: 20, wantPlay: true });
  assert.equal(snap.state, "drawing");
  assert.equal(snap.clockPaused, true);
  assert.equal(snap.neededFrames, 45);
  assert.equal(snap.shownFrame, 0);

  snap = m.step({ currentFrame: 0, totalFrames: 100, leadFrames: 45, readyAhead: 45, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.clockPaused, false);
  assert.equal(snap.shownFrame, 0);

  snap = m.step({ currentFrame: 10, totalFrames: 100, leadFrames: 45, readyAhead: 15, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.shownFrame, 10);

  snap = m.step({ currentFrame: 11, totalFrames: 100, leadFrames: 45, readyAhead: 0, wantPlay: true });
  assert.equal(snap.state, "buffering");
  assert.equal(snap.clockPaused, true);
  assert.equal(snap.shownFrame, 10, "holds last shown frame 10, never shows a wrong frame");
  assert.equal(snap.neededFrames, 30, "resume threshold is min(30, 89) = 30");
  assert.equal(snap.bufferingCount, 1);

  snap = m.step({ currentFrame: 11, totalFrames: 100, leadFrames: 45, readyAhead: 15, wantPlay: true });
  assert.equal(snap.state, "buffering");
  assert.equal(snap.clockPaused, true);
  assert.equal(snap.shownFrame, 10);

  snap = m.step({ currentFrame: 11, totalFrames: 100, leadFrames: 45, readyAhead: 30, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.clockPaused, false);
  assert.equal(snap.shownFrame, 11);

  snap = m.step({ currentFrame: 90, totalFrames: 100, leadFrames: 45, readyAhead: 0, wantPlay: true });
  assert.equal(snap.state, "buffering");
  assert.equal(snap.neededFrames, 10);
  snap = m.step({ currentFrame: 90, totalFrames: 100, leadFrames: 45, readyAhead: 10, wantPlay: true });
  assert.equal(snap.state, "playing");
  assert.equal(snap.shownFrame, 90);
});

test("WebAudioFilmTimeline & SfxCueTracker: master AudioContext time, mid-SFX seek remainder, backward seek, loop, scene boundary, 20 buffering pauses with 0 drift, hidden tab, sleep/resume, and autoplay policy", async () => {
  const cuesScene0 = [
    { name: "impact-bass-1", offset: 0.1, volume: 0.5 },
    { name: "chime", offset: 0.5, volume: 0.8, mediaStart: 0.2 },
    { name: "pop", offset: 2.0, volume: 0.7 }
  ];
  const cuesScene1 = [{ name: "typing", offset: 0.3, volume: 0.9, mediaStart: 0.1 }];

  // 1. Autoplay policy: if AudioContext is suspended and no user gesture occurred, play() refuses to play silently
  const blockedCtx = new FakeAudioContext({ initialState: "suspended", allowResume: false });
  let autoplayBlockedCount = 0;
  const blockedTl = new WebAudioFilmTimeline({
    fps: 30,
    spans: [{ id: "s0", start: 0, end: 3 }],
    context: blockedCtx,
    onAutoplayBlocked: () => {
      autoplayBlockedCount++;
    }
  });
  blockedTl.setVoiceBuffer(0, { duration: 3 });
  const startedWithoutGesture = await blockedTl.play({ fromUserGesture: false });
  assert.equal(startedWithoutGesture, false, "never plays silently when AudioContext is suspended without gesture");
  assert.equal(blockedTl.playing(), false);
  assert.equal(autoplayBlockedCount, 1);
  blockedTl.destroy();

  // 2. Full WebAudioFilmTimeline test on FakeAudioContext
  const ctx = new FakeAudioContext({ initialState: "suspended", initialTime: 10.0, allowResume: true });
  const firedEvents = [];
  const tl = new WebAudioFilmTimeline({
    fps: 30,
    spans: [
      { id: "s0", start: 0, end: 3 },
      { id: "s1", start: 3, end: 6 }
    ],
    context: ctx,
    sceneCues: (idx) => (idx === 0 ? cuesScene0 : cuesScene1),
    onCueFired: (sceneIndex, cue, bufferOffset, remainingDuration) => {
      firedEvents.push({
        sceneIndex,
        name: cue.name,
        bufferOffset: Math.round(bufferOffset * 1000) / 1000,
        remainingDuration: Math.round(remainingDuration * 1000) / 1000
      });
    }
  });

  // Load buffers once: voice0 (3s), voice1 (3s), music (10s), chime (1.2s -> playDuration from mediaStart 0.2 is 1.0s, active [0.5, 1.5]), impact (0.3s), pop (0.3s), typing (0.8s)
  tl.setVoiceBuffer(0, { duration: 3.0 });
  tl.setVoiceBuffer(1, { duration: 3.0 });
  tl.setMusicBuffer({ duration: 10.0 });
  tl.setSfxBuffer("impact-bass-1", { duration: 0.3 });
  tl.setSfxBuffer("chime", { duration: 1.2 });
  tl.setSfxBuffer("pop", { duration: 0.3 });
  tl.setSfxBuffer("typing", { duration: 0.8 });

  // Unlock via user gesture and play from 0
  await tl.unlockFromUserGesture();
  const okPlay = await tl.play({ fromUserGesture: true });
  assert.equal(okPlay, true);
  assert.equal(ctx.state, "running");
  assert.equal(tl.currentTime(), 0, "filmTime = ctx.currentTime (10.0) - offset (10.0) = 0");

  // Advance hardware AudioContext by 0.15s -> crosses `impact-bass-1` at 0.1s
  ctx.advance(0.15);
  assert.ok(Math.abs(tl.currentTime() - 0.15) < 1e-9, "master time is derived from AudioContext.currentTime");
  tl.tick();
  assert.equal(firedEvents.length, 1);
  assert.deepEqual(firedEvents[0], { sceneIndex: 0, name: "impact-bass-1", bufferOffset: 0, remainingDuration: 0.3 });

  // Seek into the middle of the active `chime` sound effect:
  // `chime` starts at offset 0.5s with mediaStart 0.2s and buffer duration 1.2s (active over local [0.5s, 1.5s]).
  // Seeking to 0.8s (0.3s into the cue) must NOT re-fire `impact-bass-1` (already finished at 0.4s),
  // and MUST start `chime` from `mediaStart (0.2) + 0.3 = 0.5s` with remaining duration `1.2 - 0.5 = 0.7s`!
  firedEvents.length = 0;
  tl.seek(0.8);
  assert.equal(firedEvents.length, 1, "seeking into the middle of an active SFX schedules its remainder immediately");
  assert.deepEqual(firedEvents[0], {
    sceneIndex: 0,
    name: "chime",
    bufferOffset: 0.5,
    remainingDuration: 0.7
  });
  // Advancing to 0.9s does NOT fire `chime` a second time
  ctx.advance(0.1);
  tl.tick();
  assert.equal(firedEvents.length, 1);

  // Seek forward to 2.5s (jumping completely over `pop` at 2.0s..2.3s): `pop` must NOT fire!
  firedEvents.length = 0;
  tl.seek(2.5);
  ctx.advance(0.1);
  tl.tick();
  assert.equal(firedEvents.length, 0, "seeking over a finished cue never fires it");

  // Backward seek to 1.8s: re-arms `pop` at 2.0s!
  tl.seek(1.8);
  ctx.advance(0.3); // filmTime = 2.1s -> crosses `pop` at 2.0s
  tl.tick();
  assert.equal(firedEvents.length, 1);
  assert.equal(firedEvents[0].name, "pop");

  // Scene boundary: advance from 2.1s across 3.0s into Scene 1 (at 3.4s, local 0.4s -> crosses `typing` at 0.3s)
  firedEvents.length = 0;
  ctx.advance(0.8); // 2.9s
  tl.tick();
  ctx.advance(0.2); // 3.1s -> enters scene 1 (local 0.1s)
  let stepRes = tl.tick();
  assert.equal(stepRes.sceneIndex, 1);
  ctx.advance(0.25); // 3.35s -> local 0.35s -> crosses `typing` at 0.3s
  stepRes = tl.tick();
  assert.equal(firedEvents.length, 1);
  assert.deepEqual(firedEvents[0], { sceneIndex: 1, name: "typing", bufferOffset: 0.1, remainingDuration: 0.7 });

  // Loop back to 0: stops active sources, re-arms scene 0 cues from 0
  firedEvents.length = 0;
  tl.loop();
  assert.equal(tl.currentTime(), 0);
  ctx.advance(0.12);
  tl.tick();
  assert.equal(firedEvents.length, 1);
  assert.equal(firedEvents[0].name, "impact-bass-1", "loop re-armed cue at 0.1s");

  // Repeated buffering: 20 buffering pauses and resumes -> offset does not drift at all across 20 pauses!
  const timeBefore20Pauses = tl.currentTime();
  for (let p = 0; p < 20; p++) {
    const prePauseTime = tl.currentTime();
    tl.setBuffering(true);
    assert.equal(ctx.state, "suspended", `pause #${p + 1} suspended AudioContext immediately`);
    assert.equal(tl.playing(), false);
    // Simulate wall time passing or small AudioContext jitter while suspended
    ctx.advance(0.05, { force: true });
    assert.equal(tl.currentTime(), prePauseTime, "filmTime is held stationary while buffering");
    tl.setBuffering(false);
    assert.equal(ctx.state, "running", `resume #${p + 1} resumed AudioContext`);
    assert.ok(
      Math.abs(tl.currentTime() - prePauseTime) < 1e-9,
      `zero drift after buffering pause #${p + 1} (got ${tl.currentTime()} vs ${prePauseTime})`
    );
    ctx.advance(1 / 30);
    tl.tick();
  }
  const expectedAfter20 = timeBefore20Pauses + 20 / 30;
  assert.ok(
    Math.abs(tl.currentTime() - expectedAfter20) < 1e-6,
    `after 20 buffering pauses + 20 frames, filmTime (${tl.currentTime()}) matches expected (${expectedAfter20}) with zero drift`
  );

  // Hidden tab (`visibilitychange` to hidden and back to visible): pauses both and resumes together with zero drift
  const timeAtHide = tl.currentTime();
  tl.setHidden(true);
  assert.equal(ctx.state, "suspended", "hidden tab suspends AudioContext");
  assert.equal(tl.playing(), false, "hidden tab pauses film clock");
  ctx.advance(5.0, { force: true });
  assert.equal(tl.currentTime(), timeAtHide, "clock held while tab is hidden");
  tl.setHidden(false);
  assert.equal(ctx.state, "running", "returning tab resumes AudioContext");
  assert.ok(Math.abs(tl.currentTime() - timeAtHide) < 1e-9, "clock and audio stay together after tab returns");

  // Device sleep / resume: simulate a sudden 15-second jump on a single tick while playing
  tl.seek(0.02);
  firedEvents.length = 0;
  ctx.advance(15.0); // Device slept for 15 seconds!
  const wakeRes = tl.tick();
  assert.ok(
    Math.abs(wakeRes.filmTime - (0.02 + 1 / 30)) < 1e-6,
    `device sleep jump clamped to 1 frame (${wakeRes.filmTime.toFixed(4)}s instead of 15.02s)`
  );
  assert.equal(firedEvents.length, 0, "device sleep / resume causes zero burst of cues");

  tl.destroy();
  assert.equal(ctx.state, "closed");
});
