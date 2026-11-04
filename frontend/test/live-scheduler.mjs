import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameCache } from '../lib/live/frame-cache.ts';
import { FrameScheduler } from '../lib/live/frame-scheduler.ts';

const make = (over = {}) => {
  let t = 0;
  const log = [];
  const cache = new FrameCache(over.budget ?? 1e9);
  const scenes = over.scenes ?? [{ id: 'a', frames: 6 }, { id: 'b', frames: 6 }, { id: 'c', frames: 6 }];
  const sched = new FrameScheduler({
    cache, scenes, fps: 30, lookahead: over.lookahead ?? 2, head: over.head ?? 2,
    now: () => t,
    draw: over.draw ?? ((scene, frame) => { log.push(`${scene}${frame}`); t += over.msPerFrame ?? 1; return { value: { close() {} }, bytes: over.bytes ?? 1 }; }),
    onError: over.onError, maxConsecutiveFailures: over.maxFail,
  });
  return { sched, cache, log, tick: () => t, advance: (ms) => { t += ms; } };
};

test('order: playhead, lookahead, rest of the scene, then heads of neighbours, then the rest', async () => {
  const { sched, log } = make();
  sched.focus('b', 2);
  await sched.runSlice(1e9);
  assert.deepEqual(log.slice(0, 8), ['b2', 'b3', 'b4', 'b5', 'b1', 'b0', 'c0', 'c1'].slice(0, 8).map((x, i) => x), 'playhead first, then ahead; the rest of b follows');
  // b2 (playhead), b3 b4 (lookahead), b5 (rest forward), b1 b0 (rest backward), then next scene head c0 c1, previous a0 a1
  assert.deepEqual(log.slice(0, 11), ['b2', 'b3', 'b4', 'b5', 'b1', 'b0', 'c0', 'c1', 'a0', 'a1', 'c2']);
  assert.equal(log.length, 18, 'every frame of every scene exactly once');
  assert.equal(new Set(log).size, 18);
});

test('lookahead runs on into the next scene when the active one ends', async () => {
  const { sched, log } = make({ lookahead: 4 });
  sched.focus('a', 4);
  await sched.runSlice(1e9);
  assert.deepEqual(log.slice(0, 5), ['a4', 'a5', 'b0', 'b1', 'b2']);
});

test('a seek re-prioritises at once and already cached frames are skipped', async () => {
  const { sched, log } = make({ msPerFrame: 1 });
  sched.focus('a', 0);
  await sched.runSlice(3); // a0 a1 a2
  assert.deepEqual(log, ['a0', 'a1', 'a2']);
  sched.focus('c', 3);
  await sched.runSlice(2);
  assert.deepEqual(log.slice(3), ['c3', 'c4']);
});

test('runSlice stays inside its time budget and can be called again', async () => {
  const { sched, log } = make({ msPerFrame: 4 });
  sched.focus('a', 0);
  const n = await sched.runSlice(8);
  assert.equal(n, 2);
  assert.equal(log.length, 2);
  assert.equal(await sched.runSlice(8), 2);
});

test('pause stops drawing; resume continues', async () => {
  const { sched, log } = make();
  sched.pause();
  assert.equal(await sched.runSlice(100), 0);
  sched.resume();
  assert.ok((await sched.runSlice(100)) > 0);
  assert.ok(log.length > 0);
});

test('a full cache only takes frames about to play', async () => {
  const { sched, cache, log } = make({ budget: 6, bytes: 1 });
  sched.focus('a', 0);
  await sched.runSlice(1e9);
  assert.ok(cache.bytes <= 6);
  assert.equal(log.length < 18, true, 'it stopped instead of churning far frames in and out');
  assert.ok(log.includes('a0') && log.includes('a1') && log.includes('a2'));
});

test('failures are skipped, reported, and a run of them halts the scheduler', async () => {
  const errors = [];
  const { sched } = make({ draw: () => { throw new Error('boom'); }, onError: (s, f) => errors.push(`${s}${f}`), maxFail: 3 });
  sched.focus('a', 0);
  await sched.runSlice(1e9);
  assert.deepEqual(errors, ['a0', 'a1', 'a2']);
  assert.equal(sched.halted, true);
  assert.equal(sched.next(), null);
  sched.setScenes([{ id: 'a', frames: 6 }]); // new scenes: try again
  assert.equal(sched.halted, false);
});

test('one failed frame does not stop the rest', async () => {
  let n = 0;
  const { sched, log } = make({ draw: (s, f) => { if (s === 'a' && f === 1) throw new Error('bad frame'); log2.push(`${s}${f}`); return { value: {}, bytes: 1 }; } });
  const log2 = [];
  sched.focus('a', 0);
  await sched.runSlice(1e9);
  assert.equal(log2.includes('a1'), false);
  assert.equal(log2.length, 17);
  assert.equal(sched.failures, 1);
  void n; void log;
});

test('invalidate drops a scene and lets it be drawn again', async () => {
  const { sched, cache, log } = make();
  sched.focus('a', 0);
  await sched.runSlice(1e9);
  const before = log.length;
  sched.invalidate('b');
  assert.equal(cache.has('b', 0), false);
  await sched.runSlice(1e9);
  assert.equal(log.length - before, 6, 'only b was drawn again');
});

test('advice follows the measured draw cost (33 ms budget at 30 fps)', async () => {
  for (const [ms, want] of [[5, 'ok'], [40, 'downscale'], [80, 'fallback']]) {
    const { sched } = make({ msPerFrame: ms });
    sched.focus('a', 0);
    assert.equal(sched.advice(), 'ok', 'no verdict before enough samples');
    await sched.runSlice(1e9);
    assert.equal(sched.advice(), want, `${ms} ms per frame`);
  }
});

test('empty and unknown scenes are harmless', async () => {
  const { sched } = make({ scenes: [] });
  assert.equal(await sched.runSlice(10), 0);
  const two = make();
  two.sched.focus('nope', 0);
  assert.equal(await two.sched.runSlice(10), 0);
});
