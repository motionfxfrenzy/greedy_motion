import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock, bufferedAhead, chooseFrame, frameAt, sceneAt } from '../lib/live/clock.ts';

test('frameAt floors, clamps and survives bad input', () => {
  assert.equal(frameAt(0, 30, 90), 0);
  assert.equal(frameAt(1, 30, 90), 30);
  assert.equal(frameAt(0.999, 30, 90), 29);
  assert.equal(frameAt(100, 30, 90), 89);
  assert.equal(frameAt(-3, 30, 90), 0);
  assert.equal(frameAt(NaN, 30, 90), 0);
  assert.equal(frameAt(1, 0, 90), 0);
  assert.equal(frameAt(1, 30, 0), 0);
  assert.equal(frameAt(0.1 + 0.2, 10, 100), 3, 'float noise does not skip a frame');
});

test('sceneAt picks the scene whose span holds the time and clamps at the ends', () => {
  const spans = [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 9 }, { id: 'c', start: 9, end: 12 }];
  assert.equal(sceneAt(spans, 0), 0);
  assert.equal(sceneAt(spans, 3.99), 0);
  assert.equal(sceneAt(spans, 4), 1);
  assert.equal(sceneAt(spans, 11.9), 2);
  assert.equal(sceneAt(spans, 99), 2);
  assert.equal(sceneAt(spans, -1), 0);
  assert.equal(sceneAt([], 3), -1);
});

test('chooseFrame shows the target when ready, holds the last frame otherwise, and never stalls the clock', () => {
  const ready = new Set([10]);
  assert.deepEqual(chooseFrame({ target: 10, lastShown: 9, isReady: (f) => ready.has(f) }), { frame: 10, stalled: false });
  assert.deepEqual(chooseFrame({ target: 11, lastShown: 10, isReady: (f) => ready.has(f) }), { frame: 10, stalled: true });
  assert.deepEqual(chooseFrame({ target: 5, lastShown: null, isReady: () => false }), { frame: 5, stalled: true });
});

test('bufferedAhead counts seconds of cached film after the playhead', () => {
  const ranges = [{ from: 0, to: 29 }, { from: 40, to: 70 }];
  assert.equal(bufferedAhead(ranges, 0, 30), 1);
  assert.equal(bufferedAhead(ranges, 15, 30), 0.5);
  assert.equal(bufferedAhead(ranges, 35, 30), 0);
  assert.equal(bufferedAhead(ranges, 40, 30), 31 / 30);
  assert.equal(bufferedAhead([], 0, 30), 0);
});

test('PlaybackClock follows the audio source', () => {
  let time = 0, playing = false;
  const clock = new PlaybackClock({ currentTime: () => time, playing: () => playing }, 30, 90);
  assert.equal(clock.frame(), 0);
  time = 1.5; playing = true;
  assert.equal(clock.frame(), 45);
  assert.equal(clock.playing(), true);
  assert.equal(clock.now(), 1.5);
  time = 99;
  assert.equal(clock.frame(), 89);
});
