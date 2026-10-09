import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntitlementsStore, isEntitlements, proMenuEntry } from '../lib/entitlements-store.ts';

const answer = (proEditor, extra = {}) => ({ plan: proEditor === 'edit' ? 'pro' : 'free', features: { proEditor }, validUntil: null, source: 'manual', reason: null, cancelAtPeriodEnd: false, asOf: '2026-11-01T00:00:00.000Z', ...extra });

/** A store on a fake clock and fake timers, with a fetcher the test controls. */
function harness(options = {}) {
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  const calls = [];
  const queue = [];
  const store = createEntitlementsStore({
    fetcher: () => new Promise((resolve, reject) => { calls.push(clock); queue.push({ resolve, reject }); }),
    now: () => clock,
    setTimer: (callback, ms) => { const id = nextId++; timers.set(id, { callback, at: clock + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    ...options
  });
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    store, calls, queue, flush,
    answer: async (value) => { queue.shift().resolve(value); await flush(); },
    fail: async (error = new Error('offline')) => { queue.shift().reject(error); await flush(); },
    advance: async (ms) => {
      clock += ms;
      for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.callback(); }
      await flush();
    },
    pending: () => timers.size
  };
}

test('starts loading, becomes ready with the answer', async () => {
  const h = harness();
  assert.equal(h.store.getState().status, 'loading');
  h.store.start();
  await h.answer(answer('edit'));
  assert.deepEqual([h.store.getState().status, h.store.getState().stale], ['ready', false]);
  assert.equal(h.store.getState().entitlements.features.proEditor, 'edit');
});

test('a failed first lookup is "unavailable", never "no plan"', async () => {
  const h = harness();
  h.store.start();
  await h.fail();
  assert.equal(h.store.getState().status, 'unavailable');
  assert.equal(proMenuEntry(h.store.getState()).action, 'retry', 'the menu offers a retry, not nothing');
});

test('5xx, network error, timeout and a malformed answer all count as failures', async () => {
  for (const make of [
    (h) => h.fail(Object.assign(new Error('Could not check the plan (503).'), { status: 503 })),
    (h) => h.fail(new TypeError('Failed to fetch')),
    (h) => h.answer({ error: { code: 'entitlements_unavailable' } }),
    (h) => h.answer(null),
    (h) => h.answer({ features: { proEditor: 'maybe' }, plan: 'pro' })
  ]) {
    const h = harness();
    h.store.start();
    await make(h);
    assert.equal(h.store.getState().status, 'unavailable');
  }
  const h = harness({ timeoutMs: 1000 });
  h.store.start();
  await h.advance(1001);
  assert.equal(h.store.getState().status, 'unavailable', 'a lookup that never answers times out');
});

test('automatic retries back off, then stop; a manual retry starts over', async () => {
  const h = harness({ retryDelaysMs: [2000, 5000] });
  h.store.start();
  await h.fail();
  await h.advance(1999);
  assert.equal(h.queue.length, 0, 'not before the first delay');
  await h.advance(1);
  assert.equal(h.queue.length, 1, 'retry after 2 s');
  await h.fail();
  await h.advance(5000);
  assert.equal(h.queue.length, 1, 'retry after 5 s');
  await h.fail();
  await h.advance(60_000);
  assert.equal(h.queue.length, 0, 'automatic retries are used up');
  assert.equal(h.store.getState().status, 'unavailable');
  void h.store.retry();
  assert.equal(h.queue.length, 1, 'a manual retry asks at once');
  await h.answer(answer('edit'));
  assert.equal(h.store.getState().status, 'ready');
});

test('recovery after retries shows the plan', async () => {
  const h = harness();
  h.store.start();
  await h.fail();
  await h.advance(2000);
  await h.answer(answer('view', { reason: 'revoked' }));
  assert.equal(h.store.getState().status, 'ready');
  assert.equal(h.store.getState().entitlements.reason, 'revoked');
});

test('a failed refresh after a good answer keeps the last answer, marked stale', async () => {
  const h = harness();
  h.store.start();
  await h.answer(answer('edit'));
  void h.store.refresh();
  await h.fail();
  const s = h.store.getState();
  assert.deepEqual([s.status, s.stale, s.entitlements.features.proEditor], ['ready', true, 'edit']);
  assert.equal(proMenuEntry(s).label, 'Open in Pro editor', 'the editor does not disappear on a blip');
  await h.advance(2000);
  await h.answer(answer('edit'));
  assert.equal(h.store.getState().stale, false);
});

test('focus or coming online refreshes when there is no good answer or it is old, and not otherwise', async () => {
  const h = harness({ maxAgeMs: 10_000 });
  h.store.refreshIfNeeded();
  assert.equal(h.queue.length, 0, 'nothing before start');
  h.store.start();
  await h.answer(answer('edit'));
  h.store.refreshIfNeeded();
  assert.equal(h.queue.length, 0, 'fresh answer: leave it');
  await h.advance(11_000);
  h.store.refreshIfNeeded();
  assert.equal(h.queue.length, 1, 'old answer: ask again');
  await h.fail();
  await h.advance(999_999);
  while (h.queue.length) await h.fail();
  assert.equal(h.store.getState().stale, true);
  h.store.refreshIfNeeded();
  assert.equal(h.queue.length, 1, 'stale: ask again');
});

test('only a real "none" answer hides the Pro editor; every other state keeps an entry', () => {
  const entry = (state) => proMenuEntry(state);
  assert.equal(entry({ status: 'ready', stale: false, entitlements: answer('none') }), null);
  assert.deepEqual(entry({ status: 'ready', stale: false, entitlements: answer('edit') }), { label: 'Open in Pro editor', disabled: false, action: 'open' });
  assert.deepEqual(entry({ status: 'ready', stale: false, entitlements: answer('view') }), { label: 'Open in Pro editor (view only)', disabled: false, action: 'open' });
  assert.deepEqual(entry({ status: 'loading' }), { label: 'Pro editor…', disabled: true, action: null });
  assert.equal(entry({ status: 'unavailable' }).action, 'retry');
  assert.equal(entry({ status: 'ready', stale: true, entitlements: answer('none') }), null, 'a stale "none" is still an answer');
});

test('isEntitlements accepts the backend shape and rejects look-alikes', () => {
  assert.equal(isEntitlements(answer('edit')), true);
  for (const bad of [null, undefined, {}, { features: {} }, { plan: 'pro', features: { proEditor: 'yes' } }, { plan: 'gold', features: { proEditor: 'edit' } }, 'edit']) assert.equal(isEntitlements(bad), false);
});

test('subscribers hear every change', async () => {
  const h = harness();
  const seen = [];
  const off = h.store.subscribe(() => seen.push(h.store.getState().status));
  h.store.start();
  await h.fail();
  await h.advance(2000);
  await h.answer(answer('edit'));
  off();
  assert.deepEqual(seen, ['unavailable', 'ready']);
});
