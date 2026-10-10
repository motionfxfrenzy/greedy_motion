// Deterministic script rules that reach the narrator: what the voice reads is not what a model happens to type.
//   node test/script-rules.mjs
import assert from "node:assert/strict";
const { voiceText, parseMotionBlur, motionBlurProblem, motionBlur } = await import("@videosaas/contracts");
const cases = [
  ["Meet Ledgerly: invoices that match themselves.", "Meet Ledgerly, invoices that match themselves."],
  ["Three things:", "Three things."],
  ["Ready at 3:45 on https://example.com now.", "Ready at 3:45 on https://example.com now."],
  ["  Drop   it in :  done. ", "Drop it in, done."],
  [null, ""]
];
for (const [input, want] of cases) assert.equal(voiceText(input), want, JSON.stringify(input));

// Motion blur is an option of the final submission: off by default, a strict boolean, capped by length.
assert.deepEqual(parseMotionBlur(undefined), { ok: true, on: false });
assert.deepEqual(parseMotionBlur(false), { ok: true, on: false });
assert.deepEqual(parseMotionBlur(true), { ok: true, on: true });
for (const bad of ["true", 1, {}, []]) assert.equal(parseMotionBlur(bad).ok, false, JSON.stringify(bad));
assert.equal(motionBlurProblem(motionBlur.maxSeconds), null);
assert.match(motionBlurProblem(motionBlur.maxSeconds + 0.5), /up to 20 seconds/);
console.log(`script rules passed (${cases.length} voice-text cases, motion-blur option rules)`);
