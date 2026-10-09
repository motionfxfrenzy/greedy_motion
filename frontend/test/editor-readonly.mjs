import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../lib/editor/remote.ts';
import { useEditor } from '../lib/editor/store.ts';
import { demoDoc } from '../lib/editor/fixtures.ts';
import { setTiming } from '../lib/editor/html-source.ts';

const open = (extra = {}) => {
  const doc = demoDoc();
  useEditor.getState().reset({ doc, mode: 'clips', hfOnly: true, remote: { projectId: 'p1', rev: 4, entry: 'index.html', status: 'idle', frameSrc: 'https://api/' }, ...extra });
  return doc.html;
};
const move = (start) => useEditor.getState().edit('Move', (d) => { d.html = setTiming(d.html, 'text1', { start }); });

test('a view-only project refuses every way of changing the document, and nothing is recorded', () => {
  const initial = open({ readOnly: true });
  const store = useEditor.getState();
  move(2);
  store.begin('Drag'); store.update((d) => { d.html = d.html + '<!-- x -->'; }); store.updateFromBase((d) => { d.html = ''; }); store.commit();
  store.undo(); store.redo(); store.jumpTo(0); store.switchBranch(0);
  const after = useEditor.getState();
  assert.equal(after.doc.html, initial);
  assert.equal(after.dirty, false);
  assert.equal(after.historyRev, 0, 'no history step was recorded');
  assert.equal(after.inTransaction(), false, 'a drag cannot start');
  assert.match(after.toast?.msg ?? '', /view-only/);
});

test('the same project is editable when it is not read-only (the guard is the only difference)', () => {
  const initial = open();
  move(2);
  assert.notEqual(useEditor.getState().doc.html, initial);
  assert.equal(useEditor.getState().dirty, true);
});

test('a project opened view-only never sends a save, even with an autosave attached', async () => {
  const initial = open({ readOnly: true, remote: { projectId: 'p1', rev: 4, entry: 'index.html', status: 'readonly', frameSrc: 'https://api/' } });
  let calls = 0;
  const auto = createAutosave(async () => { calls++; return { rev: 5 }; }, 1);
  auto.attach(initial);
  move(3);
  assert.equal(await auto.flush(), true, 'nothing to save: the edit was refused');
  assert.equal(calls, 0);
  auto.dispose();
});

test('a 403 read_only on save (the plan ended while open) switches to view-only, keeps the edit on screen, and stops saving', async () => {
  const initial = open();
  let calls = 0;
  const auto = createAutosave(async () => { calls++; throw Object.assign(new Error('Your Pro plan has ended.'), { status: 403, code: 'read_only' }); }, 1);
  auto.attach(initial);
  move(2);
  const edited = useEditor.getState().doc.html;
  assert.equal(await auto.flush(), false, 'the server does not hold the edit');
  const s = useEditor.getState();
  assert.equal(s.remote.status, 'readonly');
  assert.equal(s.readOnly, true);
  assert.equal(s.doc.html, edited, 'the unsaved edit is still in the editor');
  assert.match(s.toast.msg, /view-only/);
  assert.equal(calls, 1);
  move(3);
  await auto.flush();
  assert.equal(calls, 1, 'nothing more is sent');
  assert.equal(useEditor.getState().doc.html, edited, 'and further edits are refused');
  auto.dispose();
});

test('other save failures still retry as before (a 500 is not a plan change)', async () => {
  const initial = open();
  let calls = 0;
  const auto = createAutosave(async () => { calls++; throw Object.assign(new Error('boom'), { status: 500 }); }, 1);
  auto.attach(initial);
  move(2);
  await auto.flush();
  assert.equal(useEditor.getState().remote.status, 'error');
  assert.equal(useEditor.getState().readOnly, false);
  auto.dispose();
});
