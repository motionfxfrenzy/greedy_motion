import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProject, setTiming, setText, setStyle, setAttribute, removeElement, appendToRoot, readTweens, updateTween, addTween, removeTween, moveClipInTime, trimClip, parseStyle } from '../lib/editor/html-source.ts';

const HTML = `<!doctype html>
<html><head><style>#title{color:red} /* <div id="fake" data-start="9"></div> */</style></head>
<body>
<div id="stage" data-composition-id="main" data-width="1920" data-height="1080" data-duration="12">
  <div id="win" class="clip" data-start="0" data-duration="8" data-track-index="0" style="position:absolute; left:0; background:#fff"></div>
  <div id="title" class="clip" data-start="1.2" data-duration="3" data-track-index="1" style="top:454px; font:600 72px Inter">Hello &amp; welcome</div>
  <img id="logo" class="clip" src="logo.png" data-start="2" data-duration="4" data-track-index="2" style="left:100px"/>
  <audio id="vo" src="vo.wav" data-start="0.5" data-duration="8" data-track-index="3" data-volume="-6" muted></audio>
</div>
<script>
const tl = gsap.timeline({ paused: true });
tl.fromTo("#title", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 1.2);
tl.to("#win", { opacity: 1, duration: 0.4, ease: "power1.out" }, 0);
window.__timelines["main"] = tl;
</script>
</body></html>`;

test('parseProject reads canvas, duration and clips; ignores tags inside <style>/<script>', () => {
  const p = parseProject(HTML);
  assert.deepEqual(p.canvas, { width: 1920, height: 1080 });
  assert.equal(p.duration, 12);
  assert.deepEqual(p.clips.map((c) => c.id), ['win', 'title', 'logo', 'vo']);
  const title = p.clips[1];
  assert.equal(title.start, 1.2);
  assert.equal(title.track, 1);
  assert.equal(title.text, 'Hello & welcome');
  assert.ok(title.leaf);
  assert.deepEqual(title.css, [['top', '454px'], ['font', '600 72px Inter']]);
  assert.equal(p.clips[2].tag, 'img');
  assert.equal(p.clips[3].volume, -6);
  assert.ok(p.clips[3].muted);
});

test('setTiming edits only the named attributes, leaving everything else byte-identical', () => {
  const next = setTiming(HTML, 'title', { start: 2.5, dur: 4, track: 3 });
  assert.ok(next.includes('data-start="2.5" data-duration="4" data-track-index="3"'));
  assert.equal(next.replace('data-start="2.5" data-duration="4" data-track-index="3"', 'data-start="1.2" data-duration="3" data-track-index="1"'), HTML);
});

test('setText escapes markup and refuses non-leaf elements', () => {
  const next = setText(HTML, 'title', 'A < B & C');
  assert.ok(next.includes('>A &lt; B &amp; C</div>'));
  assert.equal(parseProject(next).clips[1].text, 'A < B & C');
  assert.equal(setText(`<div id="stage" data-width="1" data-height="1"><div id="p" data-start="0"><b>x</b></div></div>`, 'p', 'y').includes('<b>x</b>'), true);
});

test('setStyle / setAttribute add, replace and remove attributes, also on self-closing tags', () => {
  assert.ok(setStyle(HTML, 'win', [['left', '10px']]).includes('style="left:10px"'));
  assert.ok(!setStyle(HTML, 'win', []).includes('id="win" class="clip" data-start="0" data-duration="8" data-track-index="0" style'));
  const added = setAttribute(HTML, 'logo', 'alt', 'Logo');
  assert.ok(added.includes('alt="Logo"/>'));
  assert.ok(!setAttribute(HTML, 'vo', 'muted', null).includes('muted'));
  assert.throws(() => setAttribute(HTML, 'nope', 'a', 'b'));
});

test('removeElement and appendToRoot', () => {
  const removed = removeElement(HTML, 'title');
  assert.deepEqual(parseProject(removed).clips.map((c) => c.id), ['win', 'logo', 'vo']);
  const appended = appendToRoot(HTML, '<div id="n" class="clip" data-start="3" data-duration="1" data-track-index="4">New</div>');
  assert.deepEqual(parseProject(appended).clips.map((c) => c.id), ['win', 'title', 'logo', 'vo', 'n']);
});

test('tweens: read relative to the clip start', () => {
  const t = readTweens(HTML, 'title', 1.2);
  assert.equal(t.length, 1);
  assert.deepEqual({ prop: t[0].prop, from: t[0].from, to: t[0].to, dur: t[0].dur, ease: t[0].ease, at: t[0].at }, { prop: 'opacity', from: '0', to: '1', dur: 0.5, ease: 'power2.out', at: 0 });
});

test('tweens: update, add and remove round-trip through the GSAP writer', () => {
  const t = readTweens(HTML, 'title', 1.2)[0];
  const updated = updateTween(HTML, t.id, 1.2, { dur: 0.9, ease: 'expo.out', at: 0.3 });
  const u = readTweens(updated, 'title', 1.2)[0];
  assert.equal(u.dur, 0.9);
  assert.equal(u.ease, 'expo.out');
  assert.equal(u.at, 0.3);
  const added = addTween(HTML, 'win', 0, { prop: 'x', from: '', to: '120', dur: 0.4, ease: 'power3.out', at: 1 });
  const win = readTweens(added, 'win', 0);
  assert.equal(win.length, 2);
  assert.ok(win.some((w) => w.prop === 'x' && w.to === '120' && w.at === 1));
  assert.equal(readTweens(removeTween(HTML, t.id), 'title', 1.2).length, 0);
});

test('moveClipInTime shifts the clip and its tweens together; trimClip changes timing only by default', () => {
  const moved = moveClipInTime(HTML, 'title', 1.2, 3.2, 2);
  const m = parseProject(moved).clips[1];
  assert.equal(m.start, 3.2);
  assert.equal(m.track, 2);
  assert.equal(readTweens(moved, 'title', 3.2)[0].at, 0);
  const trimmed = trimClip(HTML, 'title', { start: 1.2, dur: 1.5 }, { start: 1.2, dur: 3 });
  assert.equal(parseProject(trimmed).clips[1].dur, 1.5);
  assert.equal(readTweens(trimmed, 'title', 1.2)[0].dur, 0.5);
});

test('parseStyle tolerates trailing semicolons and values containing colons', () => {
  assert.deepEqual(parseStyle('a:1; background:url(http://x/y.png);'), [['a', '1'], ['background', 'url(http://x/y.png)']]);
});
