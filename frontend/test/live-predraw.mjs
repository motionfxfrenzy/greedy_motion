import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_FRAME_STEP,
  MAX_PREDRAW_SECONDS,
  FallbackLatch,
  contiguousFrom,
  decidePredraw,
  indicesToEvict,
  predrawProgress,
  previewFrameCount,
  previewIndexForFrame,
  previewRate,
  readPredrawMaxSeconds,
  sourceFrameForPreview
} from "../lib/live/predraw.ts";
import { PlatePlayer, createFilmPlayer, previewSizeForAspect } from "../lib/live/plate-player.ts";

const MB = 1024 * 1024;
const BPF = 640 * 360 * 4;
const base = { rate: 15, bytesPerFrame: BPF, budgetBytes: 160 * MB };

function fakeElement() {
  const doc = {
    createElement() {
      return { style: {}, width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() {} }), remove() {} };
    }
  };
  return { ownerDocument: doc, appendChild: (c) => c };
}

/** Transport on a virtual clock: every frame costs `ms()` virtual milliseconds; bitmaps are tracked so closing can be checked. */
function virtualTransport(clock, ms, bitmaps) {
  return async () => {
    const port = {
      onmessage: null,
      postMessage(msg) {
        if (msg.t === "init") port.onmessage?.({ data: { t: "init", id: msg.id, w: 640, h: 360, meta: { fps: 30, durationFrames: 150 } } });
        else if (msg.t === "hb") port.onmessage?.({ data: { t: "hb", id: msg.id } });
        else if (msg.t === "frame") {
          const d = ms(msg.n);
          clock.t += d;
          const bm = { width: 640, height: 360, frameIndex: msg.n, closed: false, close() { this.closed = true; } };
          bitmaps?.push(bm);
          port.onmessage?.({ data: { t: "frame", id: msg.id, n: msg.n, bitmap: bm, drawMs: d } });
        }
      }
    };
    return { port, terminate() {} };
  };
}

test("PREVIEW_FRAME_STEP mapping: frame indices, durations and the last frame of odd-length scenes", () => {
  assert.equal(PREVIEW_FRAME_STEP, 2);
  assert.equal(previewRate(30), 15);
  assert.equal(previewFrameCount(90), 45);
  assert.equal(previewFrameCount(91), 46, "an odd-length scene still draws its last (even) source frame 90");
  assert.equal(sourceFrameForPreview(45, 91), 90);
  assert.equal(sourceFrameForPreview(44, 90), 88);
  assert.equal(previewIndexForFrame(89, 90), 44, "source frame 89 holds preview frame 44 (source 88)");
  assert.equal(previewIndexForFrame(90, 91), 45);
  assert.equal(previewIndexForFrame(5000, 90), 44, "clamped");
  assert.equal(previewIndexForFrame(-3, 90), 0);
  // each preview frame is shown for two 30 fps ticks
  assert.deepEqual([0, 1, 2, 3, 4].map((f) => previewIndexForFrame(f, 90)), [0, 0, 1, 1, 2]);
  // every drawn source index is below the frame count
  for (const frames of [1, 2, 3, 89, 90, 91, 150]) {
    for (let i = 0; i < previewFrameCount(frames); i++) assert.ok(sourceFrameForPreview(i, frames) <= frames - 1);
  }
  // the step 1 path equals the plain 30 fps path
  assert.equal(previewFrameCount(90, 1), 90);
  assert.equal(previewIndexForFrame(37, 90, 1), 37);
});

test("preview sizes: 640x360, 360x640 and 480x480", () => {
  assert.deepEqual(
    ["16:9", "9:16", "1:1"].map((a) => previewSizeForAspect(a).label),
    ["640x360", "360x640", "480x480"]
  );
  assert.equal(previewSizeForAspect("16:9").bytesPerFrame, 640 * 360 * 4);
  assert.ok(Math.abs(previewSizeForAspect("16:9").scale - 640 / 1920) < 1e-9);
  assert.ok(Math.abs(previewSizeForAspect("9:16").scale - 360 / 1080) < 1e-6);
});

test("decidePredraw: fast scene is live with the small cushion lead", () => {
  const d = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 35 }); // 28.6 fps > 15
  assert.equal(d.mode, "live");
  assert.equal(d.neededFrames, 8, "0.5 s cushion at 15 fps = 8 frames");
  assert.equal(d.reason, "ok");
});

test("decidePredraw: slow scene that fits pre-draws with the right L, W and progress", () => {
  // crayon scene 2 numbers: 190 ms/draw -> p = 5.263 fps, N = 75 preview frames
  const d = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190 });
  const p = 1000 / 190;
  const L = Math.ceil(75 * (1 - p / 15)) + 8;
  assert.equal(d.mode, "predraw");
  assert.equal(d.neededFrames, L);
  assert.equal(L, 57);
  assert.ok(Math.abs(d.waitSeconds - L / p) < 1e-9);
  assert.ok(d.waitSeconds < MAX_PREDRAW_SECONDS);
  assert.ok(d.bytesNeeded <= base.budgetBytes);
  assert.equal(predrawProgress(0, L), 0);
  assert.ok(Math.abs(predrawProgress(Math.floor(L * 0.42), L) - Math.floor(L * 0.42) / L) < 1e-12);
  assert.equal(predrawProgress(L + 5, L), 1);
});

test("decidePredraw: too slow falls back with predraw-too-slow; the limit is one constant, overridable", () => {
  const d = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 270 }); // crayon scene 1: p = 3.7 fps
  assert.equal(MAX_PREDRAW_SECONDS, 20);
  assert.equal(d.mode, "predraw", "scene 1 at 270 ms waits about 18 s: still under 20 s");
  const slow = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 400 });
  assert.equal(slow.mode, "clip");
  assert.match(slow.reason, /^predraw-too-slow: wait 2\d\.\ds > 20s$/);
  const longer = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 400, maxSeconds: 60 });
  assert.equal(longer.mode, "predraw");
  assert.equal(readPredrawMaxSeconds("45"), 45);
  assert.equal(readPredrawMaxSeconds("nonsense"), 20);
  assert.equal(readPredrawMaxSeconds(-1), 20);
});

test("decidePredraw: over the byte budget falls back with predraw-over-budget", () => {
  const d = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190, budgetBytes: 40 * BPF });
  assert.equal(d.mode, "clip");
  assert.match(d.reason, /^predraw-over-budget/);
  // the same scene fits a 60 MB phone budget (65 frames) and not a 50 MB one (54 frames)
  assert.equal(decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190, budgetBytes: 60 * MB }).mode, "predraw");
  assert.match(decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190, budgetBytes: 50 * MB }).reason, /over-budget/);
});

test("decidePredraw: unsupported, unhealthy and re-assessment (25 % tolerance)", () => {
  assert.equal(decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 20, supported: false, envStatus: "unverified" }).reason, "unverified-environment");
  assert.equal(decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 20, unhealthy: true }).reason, "worker-unhealthy");
  // 18 s waited so far at p = 5.26: 18 + (57 - 10) / 5.26 = 26.9 s > 25 s => clip
  const re = decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190, elapsedSeconds: 18, readyAhead: 10, tolerance: 1.25 });
  assert.equal(re.mode, "clip");
  // 12 s waited with 40 ready: 12 + 17 / 5.26 = 15.2 s: fine
  assert.equal(decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190, elapsedSeconds: 12, readyAhead: 40, tolerance: 1.25 }).mode, "predraw");
  // between 20 s and 25 s the tolerance keeps it going
  assert.equal(decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 190, elapsedSeconds: 14, readyAhead: 30, tolerance: 1.25 }).mode, "predraw");
});

test("no flip-flop: a scene that fell back stays a clip with its first reason", () => {
  const latch = new FallbackLatch();
  const key = "variant:g1:digest";
  const slow = latch.apply(key, decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 400 }));
  assert.equal(slow.mode, "clip");
  const fast = latch.apply(key, decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 20 }));
  assert.equal(fast.mode, "clip");
  assert.equal(fast.reason, slow.reason);
  assert.equal(latch.apply("other", decidePredraw({ ...base, previewFrames: 75, avgDrawMs: 20 })).mode, "live");
});

test("eviction helpers: only the on-screen frame stays behind the playhead", () => {
  assert.deepEqual(indicesToEvict([0, 1, 2, 3, 7, 8], 3), [0, 1, 2]);
  assert.deepEqual(indicesToEvict([3, 4], 3), []);
  assert.equal(contiguousFrom([5, 6, 7, 9], 5), 3);
  assert.equal(contiguousFrom(new Set([5]), 6), 0);
});

/** Waits until a player's background pump has gone idle (the fake transport answers at once, so this is a few ticks). */
async function settle(...players) {
  for (let i = 0; i < 5000; i++) {
    await new Promise((r) => setImmediate(r));
    if (players.every((p) => !p.isPumping)) return;
  }
  throw new Error("pump did not settle");
}

function crayonLike(clock, bitmaps, ms = () => 190) {
  return new PlatePlayer({
    bundleDigest: "crayon-like",
    html: "<script>window.FILM={};</script>",
    frames: 150,
    fps: 30,
    transportFactory: virtualTransport(clock, ms, bitmaps),
    now: () => clock.t,
    autoPump: true
  });
}

test("PlatePlayer pre-draw: waits for L frames, plays with zero frames behind, closes every shown frame, flat memory", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  const player = crayonLike(clock, bitmaps);
  const modes = [];
  player.on("mode", (e) => modes.push(e));
  await player.mount(fakeElement());
  const plan = player.predrawPlan;
  assert.equal(player.playbackVariant, "predraw");
  assert.equal(plan.neededFrames, 57);
  assert.ok(Math.abs(plan.waitSeconds - 57 / (1000 / 190)) < 1e-9);
  assert.equal(player.isPreparing, true, "active mount starts preparing at once");

  player.showFrame(0);
  await settle(player);
  const progress = modes.filter((m) => typeof m.progress === "number").map((m) => m.progress);
  assert.ok(progress.length > 5, "progress is reported while drawing");
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), "progress never goes backwards");
  assert.equal(player.isPreparing, false, "enough frames ahead: it can play");
  assert.equal(player.decision().progress, undefined);
  assert.equal(player.decision().reason, "ok");
  assert.equal(player.cachedPreviewFrames().length, 57);

  // play through: one preview frame per two 30 fps ticks
  let peak = 0;
  let stalls = 0;
  let wrong = 0;
  for (let src = 0; src < 150; src++) {
    const idx = Math.floor(src / 2);
    player.showFrame(src);
    if (!player.ready(src)) stalls++;
    await settle(player);
    const cached = player.cachedPreviewFrames();
    assert.ok(cached.every((i) => i >= idx), `no frame behind the playhead at source ${src}`);
    assert.ok(cached.length <= 57, "memory stays flat");
    peak = Math.max(peak, player.cache.bytes);
    const shown = bitmaps.filter((b) => !b.closed && b.frameIndex < idx * 2);
    wrong += shown.length;
  }
  assert.equal(stalls, 0, "no stall after playback starts");
  assert.equal(wrong, 0, "every frame the playhead passed is closed");
  assert.ok(peak <= 57 * BPF);
  assert.ok(peak <= player.cache.budget);
  // frames 0,2,...,148 were drawn once each
  const drawn = new Set(bitmaps.map((b) => b.frameIndex));
  assert.equal(drawn.size, 75);
  player.destroy();
  assert.ok(bitmaps.every((b) => b.closed), "destroy closes the last frame too");
});

test("PlatePlayer: too slow and over budget fall back to the clip with the new reasons, and stay a clip", async () => {
  const clock = { t: 0 };
  const slow = crayonLike(clock, [], () => 400);
  await slow.mount(fakeElement());
  assert.equal(slow.decision().mode, "clip");
  assert.match(slow.decision().reason, /^predraw-too-slow: wait 2\d\.\ds > 20s$/);
  slow.showFrame(10);
  assert.equal(slow.decision().mode, "clip", "no flip back to live");
  slow.destroy();

  const small = new PlatePlayer({
    bundleDigest: "small",
    html: "<script>window.FILM={};</script>",
    frames: 150,
    budgetBytes: 40 * BPF,
    transportFactory: virtualTransport(clock, () => 190),
    now: () => clock.t
  });
  await small.mount(fakeElement());
  assert.equal(small.decision().mode, "clip");
  assert.match(small.decision().reason, /^predraw-over-budget/);
  small.destroy();
});

test("PlatePlayer: drawing that gets slower during the wait falls back (re-assessment), once", async () => {
  const clock = { t: 0 };
  let cost = 190;
  const player = crayonLike(clock, [], () => cost);
  const modes = [];
  player.on("mode", (e) => modes.push(e));
  await player.mount(fakeElement());
  assert.equal(player.decision().mode, "live");
  cost = 900; // the machine got busy
  player.showFrame(0);
  await settle(player);
  const clips = modes.filter((m) => m.mode === "clip");
  assert.equal(clips.length, 1);
  assert.match(clips[0].reason, /^predraw-too-slow/);
  player.destroy();
});

test("PlatePlayer: a seek during play rebuilds the lead and frees what is behind", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  const player = crayonLike(clock, bitmaps);
  await player.mount(fakeElement());
  player.showFrame(0);
  await settle(player);
  assert.equal(player.isPreparing, false);
  player.showFrame(100); // scrub forward to preview frame 50
  assert.equal(player.isPreparing, true, "a jump to an undrawn frame prepares again");
  assert.ok(player.cachedPreviewFrames().every((i) => i >= 50), "nothing behind the new playhead");
  await settle(player);
  assert.equal(player.isPreparing, false);
  player.showFrame(100);
  assert.equal(player.ready(100), true);
  player.showFrame(20); // scrub back: simply redraws
  assert.equal(player.isPreparing, true);
  await settle(player);
  assert.equal(player.ready(20), true);
  player.destroy();
});

test("film pipeline: while scene 0 plays, scene 1 pre-draws within the spare bytes; leaving scene 0 frees it", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  let timeSec = 0;
  const budget = 130 * BPF; // 57 frames for scene 0, the rest spare for scene 1
  const film = createFilmPlayer({
    scenes: [
      { id: "s0", bundleDigest: "d0", html: "<script>window.FILM={};</script>", frames: 150 },
      { id: "s1", bundleDigest: "d1", html: "<script>window.FILM={};</script>", frames: 150 }
    ],
    fps: 30,
    budgetBytes: budget,
    timeSource: { currentTime: () => timeSec, playing: () => true },
    transportFactory: virtualTransport(clock, () => 190, bitmaps),
    now: () => clock.t
  });
  const [s0, s1] = film.scenes;
  await film.mount(fakeElement());
  assert.equal(s0.playbackVariant, "predraw");
  film.showFrame(0);
  await settle(s0);
  assert.equal(s0.isPreparing, false);
  film.showFrame(0); // the film now sees scene 0 playing and starts scene 1
  await settle(s0, s1);
  const ahead = s1.cachedPreviewFrames().length;
  assert.ok(ahead > 0, "the next scene started pre-drawing while the current one plays");
  assert.ok(film.cache.bytes <= budget, `peak ${film.cache.bytes} <= budget ${budget}`);
  assert.ok(ahead <= Math.floor((budget - s0.reservedBytes()) / BPF), "only the spare bytes are used");

  // cross into scene 1: scene 0 gives back everything
  timeSec = 5.1;
  film.syncToClock();
  assert.equal(film.activeSceneIndex, 1);
  assert.equal(s0.cachedPreviewFrames().length, 0, "the scene that played holds nothing");
  assert.ok(film.cache.bytes <= budget);
  film.destroy();
  assert.ok(bitmaps.every((b) => b.closed));
});
