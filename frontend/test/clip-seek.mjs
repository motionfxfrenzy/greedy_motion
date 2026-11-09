import assert from "node:assert/strict";
import test from "node:test";
import { SEEK_DRIFT_SECONDS, shouldSeekClip } from "../components/animation-workspace/clip-seek.ts";

test("a clip playing in step with the film clock is never re-seeked", () => {
  // 3 s of playback at 60 clock ticks per second: the clip's own playhead follows the clock within a frame
  let seeks = 0, media = 0;
  for (let tick = 0; tick < 180; tick++) {
    const expected = tick / 60;
    media = expected - 0.016; // one frame behind at most
    if (shouldSeekClip({ mediaTime: media, expected })) seeks++;
  }
  assert.equal(seeks, 0);
});

test("a clip that has drifted or a user seek is re-seeked once, then follows", () => {
  assert.equal(shouldSeekClip({ mediaTime: 0, expected: 1.4 }), true);
  assert.equal(shouldSeekClip({ mediaTime: 1.4, expected: 1.4 }), false);
  assert.equal(shouldSeekClip({ mediaTime: 1.0, expected: 1.0 + SEEK_DRIFT_SECONDS + 0.01 }), true);
  assert.equal(shouldSeekClip({ mediaTime: 1.0, expected: 1.0 + SEEK_DRIFT_SECONDS - 0.01 }), false);
});

test("non-finite times fall back to seeking", () => {
  assert.equal(shouldSeekClip({ mediaTime: NaN, expected: 1 }), true);
});
