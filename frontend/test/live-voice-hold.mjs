import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeAudioContext, WebAudioFilmTimeline } from "../lib/live/film-audio.ts";

// A scene's voice take that is still decoding when the scene starts must hold the clock, then start from its first word.
test("clock holds at a scene start until that scene's voice take is decoded", async () => {
  const ctx = new FakeAudioContext({ initialState: "running", initialTime: 5, allowResume: true });
  let release;
  const gate = new Promise((r) => (release = r));
  const tl = new WebAudioFilmTimeline({
    fps: 30,
    spans: [{ id: "s0", start: 0, end: 3 }, { id: "s1", start: 3, end: 6 }],
    context: ctx,
    fetchBuffer: async (url) => { if (url === "slow") await gate; return new ArrayBuffer(8); }
  });
  ctx.decodeAudioData = async () => ({ duration: 3 });
  tl.setVoiceBuffer(0, { duration: 3 });
  const slow = tl.loadVoice(1, "slow");
  tl.userGestureUnlocked = true;
  tl.seek(2.9);
  assert.equal(await tl.play({ fromUserGesture: true }), true);
  ctx.advance(0.2); // crosses into scene 1 while its take is pending
  const tick = tl.tick();
  assert.equal(tick.sceneIndex, 1);
  const heldAt = tick.filmTime;
  ctx.advance(1);
  assert.equal(tl.tick().filmTime, heldAt, "clock must not run ahead of the missing voice");
  release();
  await slow;
  const voice = [...tl.activeScheduledSources].find((r) => r.kind === "voice" && r.sceneIndex === 1);
  assert.ok(voice, "voice scheduled after decode");
  assert.ok(Math.abs(voice.bufferOffset - (heldAt - 3)) < 1e-6, "voice starts where the clock held, not seconds in");
  tl.destroy();
});
