// Fast export, worker side: a cached clip whose row says clip_meta.source = "browser" is probed before it is used (a bad one is
// drawn again); a worker-made row with metadata is trusted without a probe, as before.
// Run: node test/plates-browser-clips.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipCacheKey, fontSetDigest, prepareManifestClips } from "../src/plates.mjs";

const scratch = mkdtempSync(join(tmpdir(), "worker-browser-clips-"));
const projectId = randomUUID();
const eDigest = "eng-browser-unit", fsDigest = fontSetDigest("fonts:none");
const manifest = {
  schema: 2, assembler: 1, projectId, aspect: "16:9", width: 1920, height: 1080, fps: 30, totalFrames: 60, watermark: false,
  engineDigest: eDigest, fontSetDigest: fsDigest, signature: "s", timing: { frames: [60], starts: [0], totalFrames: 60 },
  scenes: [{ index: 0, variantId: randomUUID(), gen: 1, rev: 0, sig: "v3:s", bundleDigest: "d".repeat(64), bundleKey: `plates/${projectId}/16x9/0/g1/bundle.html`, bundleSha: "x", paramsDigest: "p", params: {}, frames: 60, bundleFrames: 60, startFrame: 0, clipKey: null, voice: null }],
  music: null, voiceOn: false, subtitles: {}, cues: [], sfx: []
};
const clipKey = clipCacheKey(projectId, "d".repeat(64), eDigest, fsDigest, 1920, 1080);
const row = (meta) => ({ bundle_digest: "d".repeat(64), clip_key: clipKey, width: 1920, height: 1080, fps: 30, frames: 60, clip_meta: meta });

async function run(meta, probeFrames) {
  let probes = 0, verified = 0;
  const dir = join(scratch, randomUUID());
  // verifyScene throws once a miss reaches drawing: enough to tell a cache hit from a miss without a browser.
  const out = await prepareManifestClips(
    { op: async (name) => (name === "clip.lookup" ? { clips: [row(meta)] } : { ok: true }) },
    manifest,
    {
      fence: { jobId: randomUUID(), attempt: 1 }, scratch: dir, concurrency: 1, probeRenderer: async () => "Google SwiftShader",
      storageImpl: {
        downloadPlateInput: async () => { throw Object.assign(new Error("miss reached drawing"), { kind: "infra" }); },
        downloadPlateOutput: async (_key, dest) => writeFileSync(dest, "MP4"),
        uploadPlateOutput: async () => {}, deleteOutputs: async () => {}
      },
      engineImpl: {
        verifyScene: async () => { verified++; return {}; }, renderScene: async () => {},
        probeVideo: async () => { probes++; return { frames: probeFrames, width: 1920, height: 1080, fps: 30, codec: "h264" }; },
        classifyFailure: () => "infra"
      }
    }
  ).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  return { ...out, probes, verified };
}

try {
  const worker = await run({}, 0);
  assert.ok(worker.ok, "worker row is a hit");
  assert.equal(worker.probes, 0, "a worker row with metadata is not probed");

  const browserGood = await run({ source: "browser" }, 60);
  assert.ok(browserGood.ok, "a good browser clip is a hit");
  assert.equal(browserGood.probes, 1, "a browser row is probed");

  const browserBad = await run({ source: "browser" }, 59);
  assert.equal(browserBad.probes, 1);
  assert.equal(browserBad.ok, false, "a browser clip that fails the probe is not used; the scene goes to drawing");
  console.log("plates browser clips worker test: ok");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
