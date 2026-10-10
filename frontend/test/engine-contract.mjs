import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewSize, resolveEngine, showsEngineUi, isPreviewQuality } from '../../packages/contracts/src/engine.ts';

test('previewSize: 540p / 720p per orientation, aspect preserved, even dimensions', () => {
  assert.deepEqual(previewSize({ width: 1920, height: 1080 }, 'draft540'), { width: 960, height: 540 });
  assert.deepEqual(previewSize({ width: 1920, height: 1080 }, 'preview720'), { width: 1280, height: 720 });
  assert.deepEqual(previewSize({ width: 1080, height: 1920 }, 'draft540'), { width: 540, height: 960 });
  assert.deepEqual(previewSize({ width: 1080, height: 1080 }, 'preview720'), { width: 720, height: 720 });
});

test('previewSize never upscales and final is the canvas', () => {
  assert.deepEqual(previewSize({ width: 640, height: 360 }, 'preview720'), { width: 640, height: 360 });
  assert.deepEqual(previewSize({ width: 1920, height: 1080 }, 'final'), { width: 1920, height: 1080 });
  const odd = previewSize({ width: 1366, height: 768 }, 'draft540');
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height, 540);
});

test('resolveEngine: hyperframes by default; effectcraft only for pro callers', () => {
  assert.deepEqual(resolveEngine({ entitlements: { pro: false } }), { engine: 'hyperframes', reason: 'default' });
  assert.deepEqual(resolveEngine({ projectEngine: 'effectcraft', entitlements: { pro: false } }), { engine: 'hyperframes', reason: 'not-pro' });
  assert.deepEqual(resolveEngine({ projectEngine: 'effectcraft', entitlements: { pro: true } }), { engine: 'effectcraft', reason: 'project' });
  assert.deepEqual(resolveEngine({ projectEngine: 'effectcraft', override: 'hyperframes', entitlements: { pro: true } }), { engine: 'hyperframes', reason: 'override' });
  assert.equal(resolveEngine({ override: 'effectcraft', entitlements: { pro: false } }).engine, 'hyperframes');
});

test('engine UI is for pro users only; quality guard', () => {
  assert.equal(showsEngineUi({ pro: false }), false);
  assert.equal(showsEngineUi({ pro: true }), true);
  assert.ok(isPreviewQuality('draft540'));
  assert.ok(!isPreviewQuality('4k'));
});
