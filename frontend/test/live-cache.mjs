import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameCache } from '../lib/live/frame-cache.ts';

const bitmap = () => ({ closed: false, close() { this.closed = true; } });
const fill = (cache, scene, from, to, bytes = 10) => { const made = []; for (let f = from; f <= to; f++) { const b = bitmap(); made.push(b); cache.put(scene, f, b, bytes); } return made; };

test('get/put/has count hits and misses, and put replaces an entry without leaking bytes', () => {
  const c = new FrameCache(1000);
  const a = bitmap(), b = bitmap();
  c.put('s1', 0, a, 100);
  assert.equal(c.get('s1', 0), a);
  assert.equal(c.get('s1', 1), undefined);
  assert.equal(c.hits, 1); assert.equal(c.misses, 1);
  c.put('s1', 0, b, 40);
  assert.equal(a.closed, true, 'the replaced bitmap is released');
  assert.equal(c.bytes, 40);
  assert.ok(c.has('s1', 0));
});

test('a positive budget and positive sizes are required', () => {
  assert.throws(() => new FrameCache(0));
  const c = new FrameCache(10);
  assert.throws(() => c.put('s', 0, bitmap(), 0));
  assert.throws(() => c.resize(-1));
});

test('over budget: the scene farthest from the viewer goes first, whole frames at a time, and is closed', () => {
  const c = new FrameCache(100);
  c.setOrder(['a', 'b', 'c']);
  c.setFocus('b', 0);
  const a = fill(c, 'a', 0, 2), cc = fill(c, 'c', 0, 2), b = fill(c, 'b', 0, 3); // 100 bytes in total... 10 frames
  assert.equal(c.bytes, 100);
  c.put('b', 4, bitmap(), 10);
  assert.ok(c.bytes <= 100);
  assert.equal(c.evictions, 1);
  // a and c are equally far from b; one of their frames went, none of b's
  for (const f of b) assert.equal(f.closed, false);
  assert.equal([...a, ...cc].filter((x) => x.closed).length, 1);
});

test('inside the chosen scene the frame farthest from the playhead is evicted', () => {
  const c = new FrameCache(50);
  c.setOrder(['a']);
  c.setFocus('a', 20);
  fill(c, 'a', 18, 22); // 5 frames
  c.setFocus('a', 22);
  c.put('a', 23, bitmap(), 10);
  assert.equal(c.has('a', 18), false, 'the frame farthest behind the playhead goes');
  assert.ok(c.has('a', 22) && c.has('a', 23));
});

test('a frame of a far unpinned scene into a full cache is the first to go, not a pinned neighbour', () => {
  const c = new FrameCache(60);
  c.setOrder(['a', 'b', 'c']);
  c.setFocus('a', 0);
  c.setPinned(['a', 'b']);
  fill(c, 'a', 0, 2); fill(c, 'b', 0, 2);
  fill(c, 'c', 0, 5);
  assert.equal(c.has('a', 0) && c.has('a', 2) && c.has('b', 0) && c.has('b', 2), true);
  assert.ok(c.bytes <= 60);
});

test('when everything is pinned the farthest frames still go (the budget is a hard limit)', () => {
  const c = new FrameCache(30);
  c.setOrder(['a']); c.setFocus('a', 0); c.pin('a');
  fill(c, 'a', 0, 5);
  assert.ok(c.bytes <= 30);
  assert.ok(c.has('a', 5), 'the newest entry is kept');
});

test('an entry larger than the whole budget is kept alone rather than looping forever', () => {
  const c = new FrameCache(10);
  c.setOrder(['a']); c.setFocus('a', 0);
  c.put('a', 0, bitmap(), 50);
  assert.equal(c.has('a', 0), true);
  c.put('a', 1, bitmap(), 50);
  assert.equal(c.has('a', 1), true);
  assert.equal(c.has('a', 0), false);
});

test('drop closes every bitmap of the scene and frees its bytes; clear empties the cache', () => {
  const c = new FrameCache(1000);
  const a = fill(c, 'a', 0, 3), b = fill(c, 'b', 0, 1);
  c.drop('a');
  assert.ok(a.every((x) => x.closed));
  assert.equal(c.bytes, 20);
  c.clear();
  assert.ok(b.every((x) => x.closed));
  assert.equal(c.bytes, 0);
  c.drop('missing'); // harmless
});

test('buffered() reports sorted, merged inclusive ranges', () => {
  const c = new FrameCache(1000);
  for (const f of [5, 1, 2, 3, 9, 10]) c.put('a', f, bitmap(), 1);
  assert.deepEqual(c.buffered('a'), [{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 9, to: 10 }]);
  assert.deepEqual(c.buffered('nope'), []);
});

test('resize shrinks at once and closes what it evicts', () => {
  const c = new FrameCache(100);
  c.setOrder(['a']); c.setFocus('a', 0);
  const all = fill(c, 'a', 0, 9);
  c.resize(30);
  assert.ok(c.bytes <= 30);
  assert.equal(all.filter((x) => x.closed).length, 7);
  assert.ok(c.has('a', 0), 'the frames nearest the playhead stay');
});

test('a focus on an unknown scene does not break eviction', () => {
  const c = new FrameCache(20);
  c.setOrder(['a', 'b']); c.setFocus('zzz', 0);
  fill(c, 'a', 0, 2); fill(c, 'b', 0, 2);
  assert.ok(c.bytes <= 20);
});
