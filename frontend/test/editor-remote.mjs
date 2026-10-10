import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../lib/editor/remote.ts';
import { useEditor } from '../lib/editor/store.ts';
import { demoDoc } from '../lib/editor/fixtures.ts';
import { setTiming } from '../lib/editor/html-source.ts';

const open = () => {
  const doc = demoDoc();
  useEditor.getState().reset({ doc, mode: 'clips', hfOnly: true, remote: { projectId: 'p1', rev: 4, entry: 'index.html', status: 'idle', base: 'https://api/' } });
  return doc.html;
};
const edit = (start) => useEditor.getState().edit('Move', (d) => { d.html = setTiming(d.html, 'text1', { start }); });

test('a save sends the document against the held revision and advances it', async () => {
  const initial = open();
  const calls = [];
  const auto = createAutosave(async (project, rev, files) => { calls.push({ project, rev, files }); return { rev: rev + 1 }; }, 5);
  auto.attach(initial);
  edit(2);
  assert.equal(useEditor.getState().dirty, true);
  assert.equal(await auto.flush(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rev, 4);
  assert.equal(calls[0].files[0].path, 'index.html');
  assert.match(calls[0].files[0].content, /data-start="2"/);
  assert.equal(useEditor.getState().remote.rev, 5);
  assert.equal(useEditor.getState().dirty, false);
  assert.equal(await auto.flush(), true);
  assert.equal(calls.length, 1, 'nothing changed, nothing sent');
  auto.dispose();
});

test('edits made while a save is in flight go out in the next one, one at a time, in order of revision', async () => {
  const initial = open();
  const seen = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const auto = createAutosave(async (_p, rev, files) => { seen.push({ rev, active: seen.length }); if (seen.length === 1) await gate; return { rev: rev + 1, content: files[0].content }; }, 1);
  auto.attach(initial);
  edit(2);
  const first = auto.flush();
  await new Promise((r) => setTimeout(r, 10));
  edit(3);
  const second = auto.flush();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen.length, 1, 'the second save waits for the first');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(seen.map((s) => s.rev), [4, 5]);
  assert.equal(useEditor.getState().remote.rev, 6);
  assert.equal(useEditor.getState().dirty, false);
  auto.dispose();
});

test('a 409 stops saving, keeps the edit in the editor and says so; nothing more is sent', async () => {
  const initial = open();
  let calls = 0;
  const auto = createAutosave(async () => { calls++; throw Object.assign(new Error('changed'), { status: 409 }); }, 1);
  auto.attach(initial);
  edit(2);
  assert.equal(await auto.flush(), false);
  assert.equal(useEditor.getState().remote.status, 'conflict');
  assert.match(useEditor.getState().toast.msg, /changed somewhere else/);
  edit(3);
  await auto.flush();
  assert.equal(calls, 1);
  assert.equal(useEditor.getState().dirty, true);
  auto.dispose();
});

test('a network error is reported, the edit stays dirty, and the next flush retries', async () => {
  const initial = open();
  let fail = true;
  const auto = createAutosave(async (_p, rev) => { if (fail) throw new Error('offline'); return { rev: rev + 1 }; }, 1);
  auto.attach(initial);
  edit(2);
  await auto.flush();
  assert.equal(useEditor.getState().remote.status, 'error');
  assert.equal(useEditor.getState().dirty, true);
  fail = false;
  assert.equal(await auto.flush(), true);
  assert.equal(useEditor.getState().remote.status, 'idle');
  auto.dispose();
});

test('the duration and canvas follow the composition root when the HTML changes', async () => {
  const initial = open();
  const auto = createAutosave(async (_p, rev) => ({ rev: rev + 1 }), 1);
  auto.attach(initial);
  useEditor.getState().edit('Resize stage', (d) => { d.html = d.html.replace('data-duration="11.97"', 'data-duration="20"').replace('data-width="1920" data-height="1080"', 'data-width="1080" data-height="1920"'); });
  assert.equal(useEditor.getState().duration, 20);
  assert.deepEqual(useEditor.getState().canvas, { width: 1080, height: 1920 });
  await auto.flush();
  auto.dispose();
});
