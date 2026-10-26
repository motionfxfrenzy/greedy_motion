import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimisticUpdate } from '../lib/optimistic.ts';

test('shows local change before the server resolves, then uses canonical result', async () => {
  let state = 'before';
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const operation = optimisticUpdate({ apply: () => { state = 'pending'; }, persist: () => response, reconcile: (value) => { state = value; }, rollback: () => { state = 'before'; } });
  assert.equal(state, 'pending');
  resolve('saved');
  await operation;
  assert.equal(state, 'saved');
});

test('rolls back a rejected write, propagates its error and does not retry', async () => {
  let state = 'before';
  let requests = 0;
  const error = new Error('offline');
  await assert.rejects(optimisticUpdate({ apply: () => { state = 'pending'; }, persist: async () => { requests++; throw error; }, reconcile: () => assert.fail('must not reconcile'), rollback: () => { state = 'before'; } }), error);
  assert.equal(state, 'before');
  assert.equal(requests, 1);
});
