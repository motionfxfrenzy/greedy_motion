import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECODED_WINDOW_FRAMES,
  DRAW_TIME_SAFETY_MARGIN,
  PREVIEW_FRAME_STEP,
  START_BUFFER_FRAMES,
  RESUME_BUFFER_FRAMES,
  FallbackLatch,
  contiguousFrom,
  decidePredraw,
  indicesToEvict,
  predrawProgress,
  previewFrameCount,
  previewIndexForFrame,
  previewRate,
  resumeBufferFrames,
  sourceFrameForPreview,
  startBufferFrames
} from "../lib/live/predraw.ts";
import { FrameStore, InMemoryFrameStoreBackend } from "../lib/live/frame-store.ts";
import { PlatePlayer, activeDrawWork, createFilmPlayer, previewSizeForAspect } from "../lib/live/plate-player.ts";

const MB = 1024 * 1024;
const BPF = 640 * 360 * 4;
const base = { rate: 30, bytesPerFrame: BPF, budgetBytes: 160 * MB };

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

test("PREVIEW_FRAME_STEP = 1 (30 fps): frame indices, durations, and explicit step parameter", () => {
  assert.equal(PREVIEW_FRAME_STEP, 1);
  assert.equal(previewRate(30), 30);
  assert.equal(previewFrameCount(90), 90);
  assert.equal(previewFrameCount(91), 91);
  assert.equal(sourceFrameForPreview(89, 90), 89);
  assert.equal(previewIndexForFrame(89, 90), 89);
  assert.equal(previewIndexForFrame(5000, 90), 89, "clamped");
  assert.equal(previewIndexForFrame(-3, 90), 0);
  assert.deepEqual([0, 1, 2, 3, 4].map((f) => previewIndexForFrame(f, 90)), [0, 1, 2, 3, 4]);
  for (const frames of [1, 2, 3, 89, 90, 91, 150]) {
    for (let i = 0; i < previewFrameCount(frames); i++) assert.ok(sourceFrameForPreview(i, frames) <= frames - 1);
  }
  // explicit step = 2 still works when passed
  assert.equal(previewRate(30, 2), 15);
  assert.equal(previewFrameCount(90, 2), 45);
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

test("decidePredraw: fast scene is live with cushion lead L=15 and startFrames=max(30, L)=30", () => {
  const d = decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20 }); // 50 fps >= 30 fps
  assert.equal(d.mode, "live");
  assert.equal(d.neededFrames, 15, "0.5 s cushion at 30 fps = 15 frames");
  assert.equal(d.startFrames, 30, "start rule is max(30, L)");
  assert.equal(d.reason, "ok");
  assert.equal(startBufferFrames(150, 15), START_BUFFER_FRAMES);
  assert.equal(resumeBufferFrames(150), RESUME_BUFFER_FRAMES);
  assert.equal(resumeBufferFrames(12), 12);
});

test("decidePredraw: slow scene computes lead L with 1.25x safety margin on measured draw time and startFrames = max(30, L), never falling back for slowness or budget", () => {
  assert.equal(DRAW_TIME_SAFETY_MARGIN, 1.25);
  assert.equal(DECODED_WINDOW_FRAMES, 90);
  // crayon scene 2 numbers at 30 fps: 190 ms/draw -> plannedDrawMs = 190 * 1.25 = 237.5 ms -> p_safe = 4.2105 fps, N = 150 frames
  const d = decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 190 });
  const rawP = 1000 / 190;
  const safeP = 1000 / (190 * 1.25);
  const L = Math.min(150, Math.ceil(150 * (1 - safeP / 30)) + 15);
  assert.equal(d.mode, "predraw");
  assert.equal(d.safetyMargin, 1.25);
  assert.ok(Math.abs(d.produceFps - rawP) < 1e-9);
  assert.ok(Math.abs(d.plannedProduceFps - safeP) < 1e-9);
  assert.equal(d.plannedDrawMs, 237.5);
  assert.equal(d.neededFrames, L);
  assert.equal(L, 144);
  assert.equal(d.startFrames, 144);
  assert.ok(Math.abs(d.waitSeconds - L / safeP) < 1e-9);
  assert.equal(predrawProgress(0, L), 0);
  assert.ok(Math.abs(predrawProgress(Math.floor(L * 0.42), L) - Math.floor(L * 0.42) / L) < 1e-12);
  assert.equal(predrawProgress(L + 5, L), 1);

  // Explicit comparison: 50 ms/frame (raw 20 fps) without 1.25x margin would need ceil(150*(1 - 20/30)) + 15 = 65 frames;
  // WITH 1.25x safety margin on draw time (62.5 ms/frame -> 16 fps), it needs ceil(150*(1 - 16/30)) + 15 = 85 frames!
  const d50NoMargin = decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 50, safetyMargin: 1.0 });
  const d50WithMargin = decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 50 });
  assert.equal(d50NoMargin.startFrames, 65);
  assert.equal(d50WithMargin.startFrames, 85, "1.25x safety margin increases start threshold from 65 to 85 frames");

  // Even a very slow scene (400 ms/frame) or a smaller RAM budget never falls back to clip
  const verySlow = decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 400 });
  assert.equal(verySlow.mode, "predraw");
  const smallBudget = decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 190, budgetBytes: 40 * BPF });
  assert.equal(smallBudget.mode, "predraw");
});

test("decidePredraw and FallbackLatch: only unsupported, unverified, and worker-unhealthy produce clip", () => {
  assert.equal(
    decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20, supported: false, envStatus: "unverified" }).reason,
    "unverified-environment"
  );
  assert.equal(
    decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20, supported: false, envStatus: "unsupported" }).reason,
    "unsupported-environment"
  );
  assert.equal(
    decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20, unhealthy: true }).reason,
    "worker-unhealthy"
  );

  const latch = new FallbackLatch();
  const key = "variant:g1:digest";
  const unhealthy = latch.apply(key, decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20, unhealthy: true }));
  assert.equal(unhealthy.mode, "clip");
  assert.equal(unhealthy.reason, "worker-unhealthy");
  const later = latch.apply(key, decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20 }));
  assert.equal(later.mode, "clip");
  assert.equal(later.reason, "worker-unhealthy");
  assert.equal(latch.apply("other", decidePredraw({ ...base, previewFrames: 150, avgDrawMs: 20 })).mode, "live");
});

test("eviction helpers: only the on-screen frame stays behind the playhead", () => {
  assert.deepEqual(indicesToEvict([0, 1, 2, 3, 7, 8], 3), [0, 1, 2]);
  assert.deepEqual(indicesToEvict([3, 4], 3), []);
  assert.equal(contiguousFrom([5, 6, 7, 9], 5), 3);
  assert.equal(contiguousFrom(new Set([5]), 6), 0);
});

async function settle(...players) {
  for (let i = 0; i < 5000; i++) {
    await new Promise((r) => setImmediate(r));
    if (players.every((p) => !p.isPumping)) return;
  }
  throw new Error("pump did not settle");
}

function crayonLike(clock, bitmaps, ms = () => 190, extra = {}) {
  return new PlatePlayer({
    bundleDigest: "crayon-like",
    html: "<script>window.FILM={};</script>",
    frames: 150,
    fps: 30,
    transportFactory: virtualTransport(clock, ms, bitmaps),
    now: () => clock.t,
    autoPump: true,
    ...extra
  });
}

test("PlatePlayer at 30 fps: waits for max(30, L) frames (1.25x safety margin), plays with zero frames behind, closes every shown frame, flat memory", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  const player = crayonLike(clock, bitmaps);
  const modes = [];
  player.on("mode", (e) => modes.push(e));
  await player.mount(fakeElement());
  const plan = player.predrawPlan;
  assert.equal(player.playbackVariant, "predraw");
  assert.equal(plan.neededFrames, 144);
  assert.equal(plan.startFrames, 144);
  assert.equal(player.state, "drawing");
  assert.equal(player.isPreparing, true, "active mount starts drawing initial buffer at once");

  player.showFrame(0);
  await settle(player);
  const progress = modes.filter((m) => typeof m.progress === "number").map((m) => m.progress);
  assert.ok(progress.length > 5, "progress is reported while drawing");
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), "progress never goes backwards");
  assert.equal(player.isPreparing, false, "enough frames ahead: it can play");
  assert.equal(player.state, "ready");
  assert.equal(player.decision().progress, undefined);
  assert.equal(player.decision().reason, "ok");
  assert.equal(player.cachedPreviewFrames().length, 144);

  // play through all 150 frames at 30 fps
  let peak = 0;
  let stalls = 0;
  let wrong = 0;
  for (let src = 0; src < 150; src++) {
    player.showFrame(src);
    if (!player.ready(src)) stalls++;
    await settle(player);
    const cached = player.cachedPreviewFrames();
    assert.ok(cached.every((i) => i >= src), `no frame behind the playhead at source ${src}`);
    peak = Math.max(peak, player.cache.bytes);
    const shownBehind = bitmaps.filter((b) => !b.closed && b.frameIndex < src);
    wrong += shownBehind.length;
  }
  assert.equal(stalls, 0, "no stall after playback starts");
  assert.equal(wrong, 0, "every frame the playhead passed is closed");
  assert.ok(peak <= 144 * BPF);
  assert.ok(peak <= player.cache.budget);
  const drawn = new Set(bitmaps.map((b) => b.frameIndex));
  assert.equal(drawn.size, 150, "all 150 frames at 30 fps were drawn once each");
  player.destroy();
  assert.ok(bitmaps.every((b) => b.closed), "destroy closes the last frame too");
});

test("PlatePlayer start rule with 1.25x safety margin, re-measurement while drawing, decoded window vs prepared on disk, and exact-vs-stored blits", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  const store = new FrameStore({ backend: new InMemoryFrameStoreBackend() });
  const drawnToCanvas = [];
  const el = {
    ownerDocument: {
      createElement() {
        return {
          style: {},
          width: 0,
          height: 0,
          getContext: () => ({
            clearRect() {},
            drawImage(bm) {
              drawnToCanvas.push(bm);
            }
          }),
          remove() {}
        };
      }
    },
    appendChild: (c) => c
  };

  // Slow fake scene: 50 ms/frame initially -> 1.25x safety margin gives 62.5 ms/frame (16 fps) -> start threshold = 85 frames (not 65).
  let currentDrawMs = 50;
  const player = new PlatePlayer({
    bundleDigest: "slow-50ms-scene",
    html: "<script>window.FILM={};</script>",
    frames: 150,
    fps: 30,
    frameStore: store,
    transportFactory: virtualTransport(clock, () => currentDrawMs, bitmaps),
    now: () => clock.t,
    autoPump: false
  });

  await player.mount(el);
  assert.equal(player.predrawPlan.startFrames, 85, "start threshold uses 1.25x measured draw time (85 frames, not 65)");
  assert.equal(player.state, "drawing");
  // Frame 0 was blitted at the moment it was drawn -> must be the exact freshly drawn bitmap (not fromStore)
  assert.equal(drawnToCanvas.length, 1);
  assert.equal(Boolean(drawnToCanvas[0].fromStore), false, "frame shown at the moment it is drawn is exact");

  // Pump 62 more frames (total 65 frames ready: 3 initial samples + 62): without 1.25x margin 65 would start, but with 1.25x it stays in `drawing`!
  await player.pumpScheduler(62);
  assert.equal(player.readyAhead(0), 65);
  assert.equal(player.state, "drawing", "still drawing at 65 frames because 1.25x safety margin requires 85 frames");

  // Pump remaining 20 frames to reach 85 frames ready ahead -> transitions to `ready`!
  await player.pumpScheduler(20);
  assert.equal(player.readyAhead(0), 85);
  assert.equal(player.state, "ready", "transitions to ready once 85 frames (with 1.25x safety margin) are ready ahead");

  // Pump the rest of the 150-frame scene: verify `decoded window` stays capped at DECODED_WINDOW_FRAMES (90) while all 150 are `prepared on disk`!
  await player.pumpScheduler(100);
  await store.flush();
  assert.equal(player.preparedOnDiskAhead(0), 150, "all 150 frames are prepared on disk in FrameStore");
  assert.ok(
    player.decodedWindowAhead(0) <= DECODED_WINDOW_FRAMES,
    `decoded memory window (${player.decodedWindowAhead(0)}) is capped at DECODED_WINDOW_FRAMES (${DECODED_WINDOW_FRAMES})`
  );

  // Show frame 1 (which was drawn ahead of playback): must be shown from the stored copy (`fromStore === true`)!
  player.showFrame(1);
  assert.equal(Boolean(drawnToCanvas.at(-1)?.fromStore), true, "frame drawn ahead of playback is shown from stored copy");

  player.destroy();
  store.destroy();
  assert.ok(bitmaps.every((b) => b.closed), "all raw bitmaps closed");
});

test("PlatePlayer: very slow scenes and small RAM budgets never fall back to clip (frames wait in FrameStore)", async () => {
  const clock = { t: 0 };
  const store = new FrameStore({ backend: new InMemoryFrameStoreBackend() });
  const slow = crayonLike(clock, [], () => 400, { frameStore: store });
  await slow.mount(fakeElement());
  assert.equal(slow.decision().mode, "live", "400 ms/frame scene stays live (never predraw-too-slow)");
  slow.destroy();

  const small = new PlatePlayer({
    bundleDigest: "small-budget-scene",
    html: "<script>window.FILM={};</script>",
    frames: 150,
    budgetBytes: 40 * BPF,
    frameStore: store,
    transportFactory: virtualTransport(clock, () => 190),
    now: () => clock.t
  });
  await small.mount(fakeElement());
  assert.equal(small.decision().mode, "live", "small RAM budget uses FrameStore instead of predraw-over-budget");
  await settle(small);
  assert.ok(small.cache.bytes <= 40 * BPF, "RAM cache stays within the 40-frame budget");
  assert.equal(small.isPreparing, false, "scene finishes preparing with frames in RAM + FrameStore");
  small.destroy();
  store.destroy();
});

test("PlatePlayer: a seek during play frees frames behind and rebuilds the lead if target is undrawn", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  const player = crayonLike(clock, bitmaps);
  await player.mount(fakeElement());
  player.showFrame(0);
  await settle(player);
  assert.equal(player.isPreparing, false);
  // Seek forward to frame 145 (beyond the initial 139 buffered frames)
  player.showFrame(145);
  assert.equal(player.isPreparing, true, "a jump to an undrawn frame prepares the remaining frames");
  assert.ok(player.cachedPreviewFrames().every((i) => i >= 145), "nothing behind the new playhead");
  await settle(player);
  assert.equal(player.isPreparing, false);
  player.showFrame(145);
  assert.equal(player.ready(145), true);
  // Seek back to frame 20 (which was evicted from RAM when seeking to 145): redraws when no FrameStore is attached
  player.showFrame(20);
  assert.equal(player.isPreparing, true);
  await settle(player);
  assert.equal(player.ready(20), true);
  player.destroy();
});

test("film pipeline: while scene 0 plays, scene 1 pre-draws within the spare bytes; leaving scene 0 frees its RAM frames", async () => {
  const clock = { t: 0 };
  const bitmaps = [];
  let timeSec = 0;
  const budget = 180 * BPF; // 139 frames for scene 0, the rest spare for scene 1
  const film = createFilmPlayer({
    scenes: [
      { id: "s0", bundleDigest: "d0", html: "<script>window.FILM={};</script>", frames: 150 },
      { id: "s1", bundleDigest: "d1", html: "<script>window.FILM={};</script>", frames: 150 }
    ],
    fps: 30,
    budgetBytes: budget,
    frameStore: null,
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
  film.showFrame(0); // scene 0 is playing -> starts scene 1
  await settle(s0, s1);
  const ahead = s1.cachedPreviewFrames().length;
  assert.ok(ahead > 0, "the next scene started pre-drawing while the current one plays");
  assert.ok(film.cache.bytes <= budget, `peak ${film.cache.bytes} <= budget ${budget}`);

  // cross into scene 1: scene 0 frees its RAM frames
  timeSec = 5.1;
  film.syncToClock();
  assert.equal(film.activeSceneIndex, 1);
  assert.equal(s0.cachedPreviewFrames().length, 0, "the scene that played holds nothing in RAM");
  assert.ok(film.cache.bytes <= budget);
  film.destroy();
  assert.ok(bitmaps.every((b) => b.closed));
});

function sharedCpuTransport(clock, baseMs, counts) {
  return async (workerSource) => {
    const tag = /\/\*scene-(\d)\*\//.exec(workerSource)?.[1] ?? "?";
    const port = {
      onmessage: null,
      postMessage(msg) {
        if (msg.t === "init") port.onmessage?.({ data: { t: "init", id: msg.id, w: 640, h: 360, meta: { fps: 30, durationFrames: 150 } } });
        else if (msg.t === "hb") port.onmessage?.({ data: { t: "hb", id: msg.id } });
        else if (msg.t === "frame") {
          counts[tag] = (counts[tag] ?? 0) + 1;
          const d = baseMs * Math.max(1, activeDrawWork());
          clock.t += d;
          const bm = { width: 640, height: 360, frameIndex: msg.n, close() {} };
          port.onmessage?.({ data: { t: "frame", id: msg.id, n: msg.n, bitmap: bm, drawMs: d } });
        }
      }
    };
    return { port, terminate() {} };
  };
}

async function until(cond, ms = 15000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("four slow scenes mounted together: sampling is one at a time, each gets its alone plan L=144 at 30 fps", async () => {
  const clock = { t: 0 };
  const counts = {};
  const players = [0, 1, 2, 3].map(
    (i) =>
      new PlatePlayer({
        id: `s${i}`,
        bundleDigest: `quad-${i}`,
        html: `<script>/*scene-${i}*/window.FILM={};</script>`,
        frames: 150,
        transportFactory: sharedCpuTransport(clock, 190, counts),
        now: () => clock.t
      })
  );
  await Promise.all(players.map((p) => p.mount(fakeElement(), { active: false })));
  for (const p of players) {
    assert.equal(p.decision().mode, "live", `${p.decision().reason}`);
    assert.equal(p.playbackVariant, "predraw");
    assert.equal(p.predrawPlan.neededFrames, 144, "each scene was timed alone at 30 fps with 1.25x safety margin: L=144");
  }
  players.forEach((p) => p.destroy());
});

test("film decides lazily and plays all four scenes at 30 fps with zero clip fallbacks", async () => {
  const clock = { t: 0 };
  const counts = {};
  let timeSec = 0;
  const film = createFilmPlayer({
    scenes: [0, 1, 2, 3].map((i) => ({ id: `s${i}`, bundleDigest: `lazy-${i}`, html: `<script>/*scene-${i}*/window.FILM={};</script>`, frames: 150 })),
    fps: 30,
    frameStore: null,
    timeSource: { currentTime: () => timeSec, playing: () => true },
    transportFactory: sharedCpuTransport(clock, 190, counts),
    now: () => clock.t
  });
  const modes = [];
  film.on("mode", (e) => modes.push(e));
  const [s0, s1, s2, s3] = film.scenes;
  await film.mount(fakeElement());
  assert.equal(s0.measuredYet, true, "the scene on screen is decided before the film shows");
  assert.equal(s2.measuredYet, false);
  assert.equal(s3.measuredYet, false);
  assert.equal(counts["2"] ?? 0, 0, "a scene two away does no drawing at mount");
  assert.equal(counts["3"] ?? 0, 0);

  await until(() => !s0.isPreparing && !s0.isPumping);
  film.showFrame(0);
  await until(() => s1.measuredYet);
  assert.equal(s1.decision().mode, "live", s1.decision().reason);
  assert.equal(s1.predrawPlan.neededFrames, 144);

  let guard = 0;
  while (timeSec < 19.9 && guard++ < 20000) {
    film.syncToClock();
    const a = film.scenes[film.activeSceneIndex];
    if (a.decision().mode === "clip") break;
    if (!a.isPreparing && !a.isBufferingNow && a.measuredYet) timeSec += 1 / 30;
    await new Promise((r) => setImmediate(r));
    if (guard % 50 === 0) await new Promise((r) => setTimeout(r, 1));
  }
  assert.ok(timeSec >= 19.9, `played to the end (t=${timeSec.toFixed(2)})`);
  for (const [i, p] of film.scenes.entries()) {
    assert.equal(p.decision().mode, "live", `scene ${i} must not fall back: ${p.decision().reason}`);
  }
  assert.equal(modes.filter((m) => m.mode === "clip").length, 0);
  film.destroy();
});
