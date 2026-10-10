import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readClips } from '../lib/editor/clips-model.ts';
import { injectBridge, isFrameEvent, FRAME_BRIDGE_SCRIPT, frameShellHtml } from '../lib/editor/frame-bridge.ts';
import { DEMO_HTML, demoDoc } from '../lib/editor/fixtures.ts';
import { lintClips } from '../lib/editor/checks.ts';

test('the demo composition parses into the seven prototype clips with tweens relative to each clip', () => {
  const m = readClips(DEMO_HTML);
  assert.deepEqual(m.clips.map((c) => c.id), ['win', 'ring', 'cursor', 'text1', 'demo', 'vo', 'music']);
  assert.deepEqual(m.canvas, { width: 1920, height: 1080 });
  assert.equal(m.duration, 11.97);
  const kinds = Object.fromEntries(m.clips.map((c) => [c.id, c.kind]));
  assert.deepEqual(kinds, { win: 'box', ring: 'box', cursor: 'box', text1: 'text', demo: 'img', vo: 'audio', music: 'audio' });
  const ring = m.clips.find((c) => c.id === 'ring');
  assert.deepEqual(ring.tweens.map((t) => [t.prop, t.from, t.to, t.at]), [['scale', '0.6', '1', 0]]);
  assert.equal(m.clips.find((c) => c.id === 'music').vol, -12);
});

test('the demo composition has no lint errors and one warning (text without tweens)', () => {
  const m = readClips(DEMO_HTML);
  const issues = lintClips(m.clips, m.duration, m.canvas);
  assert.equal(issues.filter((i) => i.lvl === 'error').length, 0);
  assert.ok(issues.some((i) => i.id === 'text1' && /no tweens/.test(i.msg)));
});

test('injectBridge puts one bridge script before </body> and leaves the rest alone', () => {
  const out = injectBridge(DEMO_HTML);
  assert.equal(out.split('data-gm-bridge').length - 1, 1);
  assert.ok(out.indexOf('data-gm-bridge') < out.toLowerCase().lastIndexOf('</body>'));
  assert.equal(out.replace(`<script data-gm-bridge>${FRAME_BRIDGE_SCRIPT}</script>`, ''), DEMO_HTML);
  assert.ok(injectBridge('<div></div>').endsWith('</script>'));
});

test('bridge script is plain ES5 that parses, and only answers gm-frame messages', () => {
  new Function(FRAME_BRIDGE_SCRIPT);
  assert.ok(/m\.target !== "gm-frame"/.test(FRAME_BRIDGE_SCRIPT));
  assert.ok(isFrameEvent({ source: 'gm-frame', type: 'ready' }));
  assert.ok(!isFrameEvent({ source: 'other' }));
  assert.ok(!isFrameEvent(null));
});

test('demoDoc is self-consistent', () => {
  const d = demoDoc();
  assert.equal(d.layers.length, 9);
  assert.ok(d.layers.some((l) => l.parent === 'rig') && d.layers.some((l) => l.id === 'rig'));
});

test('the shell page is the bridge waiting for a load message; the composition copy never replaces its own document', () => {
  const shell = frameShellHtml();
  assert.ok(shell.includes('window.__gmShell = true'));
  assert.ok(shell.includes(FRAME_BRIDGE_SCRIPT));
  assert.ok(!injectBridge(DEMO_HTML).includes('__gmShell = true'), 'only the shell sets the flag, so a composition cannot be reloaded by a stray message');
  assert.ok(/__gmShell = false;[^\n]*\n\s*document\.open/.test(FRAME_BRIDGE_SCRIPT), 'the shell flag is cleared before the document is replaced');
  assert.ok(/__gmHandled/.test(FRAME_BRIDGE_SCRIPT));
  assert.ok(/event\.source !== parent/.test(FRAME_BRIDGE_SCRIPT), 'only the embedding page may drive the frame');
});
