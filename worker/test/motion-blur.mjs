// Motion blur is final-only, opt-in and capped; the capture runs at fps x sub-frames and is blended back to the frame rate.
//   node test/motion-blur.mjs            (offline: a fake runner; no browser, no render)
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOTION_BLUR, blendFilter, renderWithMotionBlur, wantsMotionBlur } from "../src/motion-blur.mjs";

const isPreview = (input) => input.quality === "draft540" || input.quality === "preview720";
const final = { kind: "beat-plan", durationSeconds: 12 };
assert.equal(wantsMotionBlur(final, isPreview), false, "off unless asked");
assert.equal(wantsMotionBlur({ ...final, motionBlur: true }, isPreview), true, "on when asked at final submission");
assert.equal(wantsMotionBlur({ ...final, motionBlur: "yes" }, isPreview), false, "only a real boolean true counts");
assert.equal(wantsMotionBlur({ ...final, motionBlur: true, quality: "draft540" }, isPreview), false, "a preview never takes blur");
assert.equal(wantsMotionBlur({ ...final, motionBlur: true, quality: "preview720" }, isPreview), false, "a 720p preview never takes blur");
assert.equal(wantsMotionBlur({ ...final, motionBlur: true, durationSeconds: MOTION_BLUR.maxSeconds + 1 }, isPreview), false, "a film over the cap renders normally");
assert.equal(wantsMotionBlur({ ...final, motionBlur: true, durationSeconds: MOTION_BLUR.maxSeconds }, isPreview), true, "exactly the cap is allowed");
assert.equal(blendFilter(8), "tmix=frames=8,select='eq(mod(n\\,8)\\,7)',setpts=PTS-STARTPTS");

const dir = await mkdtemp(join(tmpdir(), "blur-test-"));
try {
  const calls = [];
  const output = join(dir, "out.mp4");
  const run = async (command, args) => { calls.push([command, args]); if (command === "hf") await writeFile(args[args.indexOf("--output") + 1], "fine"); else await writeFile(args.at(-1), "blended"); };
  await renderWithMotionBlur({ run, hyperframes: "hf", hyperframesArgs: (to, fps) => ["render", "folder", "--output", to, "--fps", String(fps)], output, options: {}, subframes: 8 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1].slice(-2), ["--fps", "240"], "captures at 30 x 8 = 240 fps");
  assert.ok(calls[1][1].includes(blendFilter(8)) && calls[1][1].includes("copy"), "blends the sub-frames and copies the audio untouched");
  assert.equal(await readFile(output, "utf8"), "blended");
  await assert.rejects(access(`${output}.fine.mp4`), "the 240 fps intermediate is removed");
  // a failed capture still removes the intermediate and leaves no output
  const failing = async (command, args) => { if (command === "hf") { await writeFile(args[args.indexOf("--output") + 1], "partial"); throw new Error("boom"); } };
  await assert.rejects(renderWithMotionBlur({ run: failing, hyperframes: "hf", hyperframesArgs: (to) => ["--output", to], output: join(dir, "bad.mp4"), options: {}, subframes: 4 }), /boom/);
  await assert.rejects(access(join(dir, "bad.mp4.fine.mp4")), "the intermediate is removed on failure too");
} finally { await rm(dir, { recursive: true, force: true }); }
console.log("motion blur: final-only, opt-in, capped, 30 x 8 capture and blend verified offline");
