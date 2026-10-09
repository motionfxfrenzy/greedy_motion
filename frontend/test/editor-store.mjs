import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useEditor } from '../lib/editor/store.ts';
import { demoDoc } from '../lib/editor/fixtures.ts';
import * as ops from '../lib/editor/ops.ts';

const fresh = () => { useEditor.getState().reset({ doc: demoDoc() }); return useEditor.getState(); };

test('edit records one undo step; undo and redo restore documents', () => {
  const s = fresh();
  s.edit('Add text', (d) => { ops.addLayer(d, 'text', 0, 12); });
  assert.equal(useEditor.getState().doc.layers.length, 10);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.layers.length, 9);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.layers.length, 10);
});

test('a drag transaction is one step: many updates, one commit', () => {
  const s = fresh();
  s.begin('Move Title');
  for (let x = 0; x < 20; x++) useEditor.getState().update((d) => { d.layers.find((l) => l.id === 'title').pos = [540 + x * 5, 470]; });
  useEditor.getState().commit();
  assert.equal(useEditor.getState().history().entries.length, 2);
  assert.deepEqual(useEditor.getState().doc.layers.find((l) => l.id === 'title').pos, [635, 470]);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.layers.find((l) => l.id === 'title').pos, [540, 470]);
});

test('Esc: cancel restores the state the drag started from and records nothing', () => {
  const s = fresh();
  s.begin('Move Title');
  useEditor.getState().update((d) => { d.layers.find((l) => l.id === 'title').pos = [1, 1]; });
  useEditor.getState().cancel();
  assert.deepEqual(useEditor.getState().doc.layers.find((l) => l.id === 'title').pos, [540, 470]);
  assert.equal(useEditor.getState().history().entries.length, 1);
});

test('a drag that changes nothing records nothing; edit() is ignored while a drag is in flight', () => {
  const s = fresh();
  s.begin('noop');
  useEditor.getState().commit();
  assert.equal(useEditor.getState().history().entries.length, 1);
  s.begin('drag');
  useEditor.getState().edit('ignored', (d) => { d.layers.length = 0; });
  assert.equal(useEditor.getState().doc.layers.length, 9);
  useEditor.getState().cancel();
});

test('selection is not an undo step; shift-select toggles; playhead snaps to frames and clamps', () => {
  const s = fresh();
  s.select(['title']);
  s.select(['bg'], true);
  assert.deepEqual(useEditor.getState().sel, ['title', 'bg']);
  useEditor.getState().select(['bg'], true);
  assert.deepEqual(useEditor.getState().sel, ['title']);
  assert.equal(useEditor.getState().history().entries.length, 1);
  useEditor.getState().setT(1.017);
  assert.ok(Math.abs(useEditor.getState().t - 1.0333) < 0.001);
  useEditor.getState().setT(99);
  assert.equal(useEditor.getState().t, 12);
});

test('hfOnly projects cannot switch to Layers; branching keeps abandoned edits', () => {
  useEditor.getState().reset({ doc: demoDoc(), hfOnly: true, mode: 'clips' });
  useEditor.getState().setMode('layers');
  assert.equal(useEditor.getState().mode, 'clips');
  const s = fresh();
  s.edit('A', (d) => { d.markers.push({ t: 1, label: 'A' }); });
  useEditor.getState().undo();
  useEditor.getState().edit('B', (d) => { d.markers.push({ t: 2, label: 'B' }); });
  assert.equal(useEditor.getState().history().branches.length, 1);
  useEditor.getState().switchBranch(useEditor.getState().history().branches[0].id);
  assert.deepEqual(useEditor.getState().doc.markers.map((m) => m.label), ['Hook', 'A']);
});
