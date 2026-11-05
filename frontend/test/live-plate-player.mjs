import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FrameCache,
  computeRollingWindow,
  frameCacheKey,
  sceneCacheKey
} from "../lib/live/frame-cache.ts";
import { FrameScheduler } from "../lib/live/frame-scheduler.ts";
import {
  PlatePlayer,
  createFilmPlayer,
  evaluatePlaybackGate,
  previewSizeForAspect
} from "../lib/live/plate-player.ts";

function fakeElement() {
  const children = [];
  const drawn = [];
  const doc = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        width: 0,
        height: 0,
        style: {},
        removed: false,
        remove() {
          this.removed = true;
        },
        getContext() {
          return {
            clearRect() {},
            drawImage(bm) {
              drawn.push(bm);
            }
          };
        }
      };
    }
  };
  return {
    ownerDocument: doc,
    children,
    drawn,
    appendChild(child) {
      children.push(child);
      return child;
    }
  };
}

function makeFakeTransport(drawMs = 8) {
  return async () => {
    const port = {
      onmessage: null,
      postMessage(msg) {
        if (msg.t === "init") {
          port.onmessage?.({
            data: { t: "init", id: msg.id, w: 854, h: 480, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } }
          });
        } else if (msg.t === "hb") {
          port.onmessage?.({ data: { t: "hb", id: msg.id } });
        } else if (msg.t === "frame") {
          const bm = {
            width: 854,
            height: 480,
            frameIndex: msg.n,
            closed: false,
            close() {
              this.closed = true;
            }
          };
          port.onmessage?.({
            data: { t: "frame", id: msg.id, n: msg.n, bitmap: bm, drawMs }
          });
        }
      }
    };
    return { port, terminate() {} };
  };
}

test("rolling window split (Plan §6) and resident bytes <= budget for every budget and aspect ratio", async () => {
  // Check exact Plan §6 example: 97 frames -> 19 behind (20%), 14 head (15% capped at 15), 64 ahead
  const split97 = computeRollingWindow(97 * 100, 100, true);
  assert.deepEqual(split97, {
    windowFrames: 97,
    behindFrames: 19,
    headFrames: 14,
    aheadFrames: 64
  });

  // Preview sizes for 16:9, 9:16, 1:1
  assert.equal(previewSizeForAspect("16:9").label, "640x360");
  assert.equal(previewSizeForAspect("9:16").label, "360x640");
  assert.equal(previewSizeForAspect("1:1").label, "480x480");

  // Resident bytes <= budget across all budgets (160, 80, 60 MB) and aspect ratios when filling rolling window
  for (const mb of [160, 80, 60]) {
    for (const aspect of ["16:9", "9:16", "1:1"]) {
      const budget = mb * 1024 * 1024;
      const spec = previewSizeForAspect(aspect);
      const win = computeRollingWindow(budget, spec.bytesPerFrame, true);
      assert.equal(win.behindFrames + win.headFrames + win.aheadFrames, win.windowFrames);
      assert.ok(win.headFrames <= 15);
      assert.ok(win.windowFrames * spec.bytesPerFrame <= budget);

      const cache = new FrameCache(budget);
      const sched = new FrameScheduler({
        cache,
        scenes: [
          { id: "s1", frames: 120 },
          { id: "s2", frames: 120 }
        ],
        fps: 30,
        lookahead: win.aheadFrames,
        head: win.headFrames,
        behind: win.behindFrames,
        draw: (_s, f) => ({ value: { f, close() {} }, bytes: spec.bytesPerFrame })
      });
      sched.focus("s1", 30);
      await sched.runSlice(1e9);
      assert.ok(cache.bytes <= budget, `resident bytes (${cache.bytes}) <= budget (${budget})`);
    }
  }
});

test("gate and clip decision table: fast scene live, heavy scene clip, unhealthy host clip, unsupported/unverified env clip", async () => {
  // 1. Fast scene (10 ms/frame -> 100 fps -> lead = 0.5 s <= aheadSeconds) -> live
  const fastGate = evaluatePlaybackGate({
    frames: 90,
    fps: 30,
    avgDrawMs: 10,
    aheadFrames: 64,
    bufferedAheadSeconds: 0.6,
    unhealthy: false,
    supported: true,
    envStatus: "verified"
  });
  assert.equal(fastGate.mode, "live");
  assert.equal(fastGate.canStartPlayback, true);

  // 2. Heavy scene (65 ms/frame on a 210-frame / 7 s scene -> produceFps = 15.38, lead = 7*(1 - 15.38/30)+0.5 = 3.91 s > 2.13 s ahead) -> clip
  const heavyGate = evaluatePlaybackGate({
    frames: 210,
    fps: 30,
    avgDrawMs: 65,
    aheadFrames: 64,
    bufferedAheadSeconds: 1.0,
    unhealthy: false,
    supported: true,
    envStatus: "verified"
  });
  assert.equal(heavyGate.mode, "clip");
  assert.match(heavyGate.reason, /gate-exceeded/);

  // 3. Unhealthy host -> clip
  const unhealthyGate = evaluatePlaybackGate({
    frames: 90,
    fps: 30,
    avgDrawMs: 10,
    aheadFrames: 64,
    unhealthy: true,
    supported: true,
    envStatus: "verified"
  });
  assert.equal(unhealthyGate.mode, "clip");
  assert.equal(unhealthyGate.reason, "worker-unhealthy");

  // 4. Unsupported / unverified environment -> clip
  const unverifiedGate = evaluatePlaybackGate({
    frames: 90,
    fps: 30,
    avgDrawMs: 10,
    aheadFrames: 64,
    unhealthy: false,
    supported: false,
    envStatus: "unverified"
  });
  assert.equal(unverifiedGate.mode, "clip");
  assert.equal(unverifiedGate.reason, "unverified-environment");

  // Also test full PlatePlayer mounting for heavy scene and unsupported environment.
  // 250 ms per frame at 15 fps preview: L = ceil(105 * (1 - 4/15)) + 8 = 85 frames, W = 85 / 4 = 21 s > 20 s -> clip (phase 3f).
  const modeEvents = [];
  const heavyPlayer = new PlatePlayer({
    bundleDigest: "heavy-digest",
    html: "<script>window.FILM={};</script>",
    frames: 210,
    fps: 30,
    transportFactory: makeFakeTransport(250),
    autoPump: false
  });
  heavyPlayer.on("mode", (e) => modeEvents.push(e));
  await heavyPlayer.mount(fakeElement());
  assert.equal(heavyPlayer.decision().mode, "clip");
  assert.match(heavyPlayer.decision().reason, /predraw-too-slow: wait 2\d\.\ds > 20s/);
  assert.equal(modeEvents[0]?.mode, "clip");
  heavyPlayer.destroy();

  const safariUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15";
  const unverifiedPlayer = new PlatePlayer({
    bundleDigest: "safari-digest",
    html: "<script>window.FILM={};</script>",
    environment: safariUa,
    autoPump: false
  });
  const unverifiedModes = [];
  unverifiedPlayer.on("mode", (e) => unverifiedModes.push(e));
  await unverifiedPlayer.mount(fakeElement());
  assert.equal(unverifiedPlayer.decision().mode, "clip");
  assert.equal(unverifiedPlayer.decision().reason, "unverified-environment");
  assert.equal(unverifiedModes[0]?.mode, "clip");
  unverifiedPlayer.destroy();
});

test("PlatePlayer: showFrame never blocks, holds last good frame and emits buffering on uncached frame, and seek re-prioritises", async () => {
  const el = fakeElement();
  const bufferingEvents = [];
  let readyFired = false;

  const player = new PlatePlayer({
    bundleDigest: "fast-digest",
    html: "<script>window.FILM={};</script>",
    frames: 90,
    fps: 30,
    transportFactory: makeFakeTransport(8),
    autoPump: false
  });
  player.on("ready", () => {
    readyFired = true;
  });
  player.on("buffering", (e) => bufferingEvents.push(e));

  await player.mount(el);
  assert.equal(player.decision().mode, "live");
  assert.equal(readyFired, true, "ready fires once bufferedAhead >= lead");
  assert.equal(player.ready(0), true);

  // Show cached frame 0
  player.showFrame(0);
  assert.equal(el.drawn.at(-1)?.frameIndex, 0);

  // Seek to uncached frame 75 (preview draws source frames 0, 2, 4, ...: source 75 is shown from preview frame 74): never blocks, holds frame 0, emits buffering: true, and re-prioritises scheduler to 75
  assert.equal(player.ready(75), false);
  player.showFrame(75);
  assert.equal(bufferingEvents.at(-1)?.buffering, true);
  assert.equal(bufferingEvents.at(-1)?.heldFrame, 0);

  // Pumping 1 frame now draws frame 75 first because seek re-prioritised the scheduler!
  await player.pumpScheduler(1);
  assert.equal(player.ready(75), true, "seek re-prioritised scheduler to draw frame 75 immediately");

  // Showing frame 75 now blits frame 75 and clears buffering
  player.showFrame(75);
  assert.equal(el.drawn.at(-1)?.frameIndex, 74, "source frame 75 is held on preview frame 74");
  assert.equal(bufferingEvents.at(-1)?.buffering, false);

  player.destroy();
  assert.equal(el.children[0]?.removed, true, "destroy removes the player-owned canvas");
});

test("cache keyed by bundleDigest | frame | previewSize: a params-only digest change never hits old frames", () => {
  const cache = new FrameCache(10 * 1024 * 1024);
  const digestA = "digest-params-sky-blue";
  const digestB = "digest-params-sky-green"; // same HTML, different params -> different bundleDigest

  const keyA = sceneCacheKey(digestA, "640x360");
  const keyB = sceneCacheKey(digestB, "640x360");
  assert.notEqual(keyA, keyB);
  assert.notEqual(frameCacheKey(digestA, 0, "640x360"), frameCacheKey(digestB, 0, "640x360"));

  const bmA = { tag: "blue", closed: false, close() { this.closed = true; } };
  cache.put(keyA, 0, bmA, 1000);

  assert.equal(cache.has(keyA, 0), true);
  assert.equal(cache.has(keyB, 0), false, "new bundleDigest never hits old cached frames");
  assert.equal(cache.get(keyB, 0), undefined);
});

test("createFilmPlayer sequences multiple scenes with PlaybackClock and recycles Worker at scene boundaries", async () => {
  let timeSec = 0;
  const recycled = [];

  const film = createFilmPlayer({
    scenes: [
      { id: "s0", bundleDigest: "dig-0", html: "<script>window.FILM={};</script>", frames: 30 },
      { id: "s1", bundleDigest: "dig-1", html: "<script>window.FILM={};</script>", frames: 30 }
    ],
    fps: 30,
    timeSource: { currentTime: () => timeSec, playing: () => true },
    transportFactory: makeFakeTransport(5),
    autoPump: false
  });

  film.scenes.forEach((p, idx) => {
    const orig = p.recycle.bind(p);
    p.recycle = async () => {
      recycled.push(idx);
      return orig();
    };
  });

  const el = fakeElement();
  await film.mount(el);
  assert.equal(film.meta.frames, 60);
  assert.deepEqual(film.meta.sceneSpans, [
    { id: "s0", start: 0, end: 1 },
    { id: "s1", start: 1, end: 2 }
  ]);

  timeSec = 0.2;
  film.syncToClock();
  assert.equal(film.activeSceneIndex, 0);
  assert.equal(recycled.length, 0);

  // Advance clock across the scene boundary at t = 1.1s (frame 33 -> scene 1, local frame 3)
  timeSec = 1.1;
  film.syncToClock();
  assert.equal(film.activeSceneIndex, 1);
  assert.deepEqual(recycled, [0], "crossing scene 0 -> scene 1 recycles scene 0's Worker");

  film.destroy();
});
