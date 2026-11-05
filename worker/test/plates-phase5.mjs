// Phase 5 worker unit tests (plain Node, no network or external services required):
//   1. bundle digest verification (engine trailing-NUL bundleSha, tampered HTML/params rejected before drawing)
//   2. verify-all-then-draw order (all scenes verified before any scene is drawn)
//   3. scene_needs_fix is non-retriable (permanent: true, code: "scene_needs_fix", names scene, calls plate.sendBackForRepair)
//   4. Software-GL self-check decision function (isSoftwareRenderer / checkSoftwareRenderer / GpuPathDetectedError is retriable)
//   5. digest cache hit and miss (clip.lookup reuses hits, draws only misses, records fenced clip.record, cleans up on fenced loss)
//   6. manifest schema 1 compatibility (loadManifest accepts schema 1 and schema 2; schema 1 keeps its resolveClips path)
// Run: node test/plates-phase5.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bakeSceneParams,
  bundleDigest,
  canonicalJson,
  checkSoftwareRenderer,
  clipCacheKey,
  engineBundleSha,
  fontSetDigest,
  GpuPathDetectedError,
  isSoftwareRenderer,
  loadManifest,
  paramsDigest,
  prepareManifestClips,
  SceneNeedsFixError,
  verifyBundleDigest
} from "../src/plates.mjs";

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");
const scratch = mkdtempSync(join(tmpdir(), "worker-phase5-test-"));

function makeSceneHtml(label) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>scene</title></head><body><canvas id="film"></canvas><script>window.__ASSETS__={};window.__BAKE_SRC__={};</script><script>window.SCENE_LABEL=${JSON.stringify(label)};</script></body></html>`;
}

function makeSchema2Manifest(projectId, sceneSpecs) {
  const eDigest = "eng-phase5-unit";
  const fsDigest = fontSetDigest("fonts:none");
  let startFrame = 0;
  const scenes = sceneSpecs.map((spec, i) => {
    const html = spec.html ?? makeSceneHtml(`scene-${i}`);
    const bSha = engineBundleSha(html);
    const params = spec.params ?? {};
    const pDigest = paramsDigest(params);
    const bDigest = spec.bundleDigest ?? bundleDigest({ bundleSha: bSha, params, engineDigest: eDigest, fontSetDigest: fsDigest });
    const frames = spec.frames ?? 60;
    const entry = {
      index: i,
      variantId: spec.variantId ?? randomUUID(),
      gen: spec.gen ?? 1,
      rev: spec.rev ?? 0,
      sig: `v3:sig-${i}`,
      bundleDigest: bDigest,
      bundleKey: `plates/${projectId}/16x9/${i}/g1/bundle.html`,
      bundleSha: bSha,
      paramsDigest: pDigest,
      params,
      frames,
      bundleFrames: frames,
      startFrame,
      clipKey: null,
      voice: null
    };
    startFrame += frames;
    return entry;
  });
  const manifest = {
    schema: 2,
    assembler: 1,
    projectId,
    aspect: "16:9",
    width: 1920,
    height: 1080,
    fps: 30,
    totalFrames: startFrame,
    watermark: false,
    engineDigest: eDigest,
    fontSetDigest: fsDigest,
    signature: "x1:test",
    timing: {
      frames: scenes.map((s) => s.frames),
      starts: scenes.map((s) => s.startFrame),
      totalFrames: startFrame
    },
    scenes,
    music: null,
    voiceOn: false,
    subtitles: { mode: "none", style: "pill" },
    cues: [],
    sfx: []
  };
  const digest = sha256Hex(canonicalJson(manifest));
  const key = `plates/${projectId}/manifests/${digest}/manifest.json`;
  return { manifest, manifestKey: key, manifestDigest: digest };
}

try {
  // =========================================================================
  // 1. Bundle digest verification & trailing-NUL bundleSha
  // =========================================================================
  {
    const projectId = randomUUID();
    const html0 = makeSceneHtml("valid-fox-scene");
    const expectedNulSha = createHash("sha256").update(html0).update("\0").digest("hex").slice(0, 24);
    assert.equal(engineBundleSha(html0), expectedNulSha, "engineBundleSha hashes HTML + trailing NUL byte");

    const { manifest } = makeSchema2Manifest(projectId, [{ html: html0, params: { sky: "#112233" } }]);
    const scene0 = manifest.scenes[0];

    const okCheck = verifyBundleDigest(html0, scene0, manifest);
    assert.equal(okCheck.ok, true, "valid HTML and params pass verifyBundleDigest");

    const tamperedHtml = html0.replace("valid-fox-scene", "tampered-fox-scene");
    const tamperedCheck = verifyBundleDigest(tamperedHtml, scene0, manifest);
    assert.equal(tamperedCheck.ok, false, "tampered HTML fails verifyBundleDigest");

    const tamperedParamsScene = { ...scene0, params: { sky: "#990000" } };
    const tamperedParamsCheck = verifyBundleDigest(html0, tamperedParamsScene, manifest);
    assert.equal(tamperedParamsCheck.ok, false, "tampered params fails verifyBundleDigest");

    // In prepareManifestClips, a tampered bundle in storage is rejected before verifyScene or renderScene is called
    let verifyCalled = 0;
    let renderCalled = 0;
    const dir1 = join(scratch, "t1");
    await assert.rejects(
      () =>
        prepareManifestClips(
          { op: async () => ({ clips: [] }) },
          manifest,
          {
            fence: { jobId: randomUUID(), attempt: 1 },
            scratch: dir1,
            probeRenderer: async () => "Google SwiftShader",
            storageImpl: {
              downloadPlateInput: async (_key, dest) => {
                writeFileSync(dest, tamperedHtml, "utf8");
              },
              downloadPlateOutput: async () => {},
              uploadPlateOutput: async () => {},
              deleteOutputs: async () => {}
            },
            engineImpl: {
              verifyScene: async () => { verifyCalled++; return { blocked: [] }; },
              renderScene: async () => { renderCalled++; },
              probeVideo: async () => ({ frames: 60, width: 1920, height: 1080, fps: 30 }),
              classifyFailure: (e) => (e?.kind === "code" ? "code" : "infra")
            }
          }
        ),
      (err) => {
        assert.ok(err instanceof SceneNeedsFixError);
        assert.equal(err.code, "scene_needs_fix");
        assert.equal(err.permanent, true);
        assert.equal(err.sceneIndex, 0);
        assert.match(err.message, /Scene 1/i);
        return true;
      }
    );
    assert.equal(verifyCalled, 0, "verifyScene not called when bundle digest is tampered");
    assert.equal(renderCalled, 0, "renderScene not called when bundle digest is tampered");
  }

  // =========================================================================
  // 2. Verify-all-then-draw order & scene_needs_fix non-retriable + repair op
  // =========================================================================
  {
    const projectId = randomUUID();
    const htmls = [makeSceneHtml("s0"), makeSceneHtml("s1"), makeSceneHtml("s2")];
    const { manifest } = makeSchema2Manifest(
      projectId,
      htmls.map((html, i) => ({ html, frames: 60, params: i === 1 ? { lantern: "#ffaa00" } : {} }))
    );

    // 2a. All 3 pass: verify:0, verify:1, verify:2 happen BEFORE draw:0, draw:1, draw:2
    const eventsOrder = [];
    const dir2a = join(scratch, "t2a");
    await prepareManifestClips(
      {
        op: async (name) => {
          if (name === "clip.lookup") return { clips: [] };
          if (name === "clip.record") return { ok: true, duplicate: false };
          return { ok: true };
        }
      },
      manifest,
      {
        fence: { jobId: randomUUID(), attempt: 1 },
        scratch: dir2a,
        concurrency: 1,
        probeRenderer: async () => "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)",
        storageImpl: {
          downloadPlateInput: async (key, dest) => {
            const idx = manifest.scenes.findIndex((s) => s.bundleKey === key);
            writeFileSync(dest, htmls[idx], "utf8");
          },
          downloadPlateOutput: async () => {},
          uploadPlateOutput: async () => {},
          deleteOutputs: async () => {}
        },
        engineImpl: {
          verifyScene: async (pagePath) => {
            const m = /scene-(\d+)\.html$/.exec(pagePath);
            const idx = Number(m[1]);
            eventsOrder.push(`verify:${idx}`);
            if (idx === 1) {
              const baked = readFileSync(pagePath, "utf8");
              assert.ok(baked.includes('window.__PARAMS__={"lantern":"#ffaa00"};'), "params baked into scene HTML before verification");
            }
            return { blocked: [], midPng: Buffer.from("PNG") };
          },
          renderScene: async (pagePath, outFile, { onProgress }) => {
            const m = /scene-(\d+)\.html$/.exec(pagePath);
            const idx = Number(m[1]);
            eventsOrder.push(`draw:${idx}`);
            onProgress?.(60);
            writeFileSync(outFile, "MP4");
          },
          probeVideo: async () => ({ frames: 60, width: 1920, height: 1080, fps: 30 }),
          classifyFailure: (e) => (e?.kind === "code" ? "code" : "infra")
        }
      }
    );
    assert.deepEqual(
      eventsOrder,
      ["verify:0", "verify:1", "verify:2", "draw:0", "draw:1", "draw:2"],
      "every scene is verified before any scene is drawn"
    );

    // 2b. Scene 2 fails verification: scenes 0 and 1 are NEVER drawn, plate.sendBackForRepair is called for scene 2,
    //     and SceneNeedsFixError (permanent: true, code: "scene_needs_fix") is thrown naming Scene 3.
    const eventsFail = [];
    const repairCalls = [];
    const dir2b = join(scratch, "t2b");
    await assert.rejects(
      () =>
        prepareManifestClips(
          {
            op: async (name, args) => {
              if (name === "plate.sendBackForRepair") {
                repairCalls.push(args);
                return { applied: true, exhausted: false, rev: 1 };
              }
              return { clips: [] };
            }
          },
          manifest,
          {
            fence: { jobId: randomUUID(), attempt: 1 },
            scratch: dir2b,
            probeRenderer: async () => "Google SwiftShader",
            storageImpl: {
              downloadPlateInput: async (key, dest) => {
                const idx = manifest.scenes.findIndex((s) => s.bundleKey === key);
                writeFileSync(dest, htmls[idx], "utf8");
              },
              downloadPlateOutput: async () => {},
              uploadPlateOutput: async () => {},
              deleteOutputs: async () => {}
            },
            engineImpl: {
              verifyScene: async (pagePath) => {
                const m = /scene-(\d+)\.html$/.exec(pagePath);
                const idx = Number(m[1]);
                eventsFail.push(`verify:${idx}`);
                if (idx === 2) {
                  throw Object.assign(new Error("DETERMINISM FAILURE: frame 0 differed"), { kind: "code" });
                }
                return { blocked: [] };
              },
              renderScene: async (pagePath) => {
                const m = /scene-(\d+)\.html$/.exec(pagePath);
                eventsFail.push(`draw:${m[1]}`);
              },
              probeVideo: async () => ({ frames: 60, width: 1920, height: 1080, fps: 30 }),
              classifyFailure: (e) => (e?.kind === "code" ? "code" : "infra")
            }
          }
        ),
      (err) => {
        assert.ok(err instanceof SceneNeedsFixError);
        assert.equal(err.code, "scene_needs_fix");
        assert.equal(err.permanent, true, "scene_needs_fix is non-retriable");
        assert.equal(err.sceneIndex, 2);
        assert.match(err.message, /Scene 3 needs a fix before rendering: DETERMINISM FAILURE/);
        return true;
      }
    );
    assert.deepEqual(eventsFail, ["verify:0", "verify:1", "verify:2"], "zero scenes drawn when scene 2 fails verification");
    assert.equal(repairCalls.length, 1, "plate.sendBackForRepair called once for failed scene 2");
    assert.equal(repairCalls[0].id, manifest.scenes[2].variantId);
    assert.equal(repairCalls[0].gen, manifest.scenes[2].gen);
    assert.match(repairCalls[0].detail, /DETERMINISM FAILURE/);
  }

  // =========================================================================
  // 3. Software-GL self-check decision function
  // =========================================================================
  {
    const validSoftwareRenderers = [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 16.0.0) (0x0000C0DE)), SwiftShader driver)",
      "Google SwiftShader",
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.6, 256 bits)",
      "Gallium 0.4 on llvmpipe (LLVM 3.8, 128 bits)",
      "Mesa OffScreen (softpipe)",
      "Vulkan 1.3.255 (lvp - lavapipe)",
      "Microsoft Basic Render Driver",
      "Software Rasterizer"
    ];
    for (const r of validSoftwareRenderers) {
      assert.equal(isSoftwareRenderer(r), true, `expected software renderer to pass: ${r}`);
      assert.equal(checkSoftwareRenderer(r).ok, true);
    }

    const rejectedHardwareRenderers = [
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)",
      "Apple GPU",
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "NVIDIA A10G/PCIe/SSE2",
      "AMD Radeon Pro 5500M OpenGL Engine",
      "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)",
      "Intel(R) Iris(TM) Plus Graphics",
      "Adreno (TM) 740",
      "Mali-G710 MC10",
      "WebKit WebGL",
      "",
      "   ",
      null,
      undefined
    ];
    for (const r of rejectedHardwareRenderers) {
      assert.equal(isSoftwareRenderer(r), false, `expected non-software renderer to be rejected: ${String(r)}`);
      assert.throws(
        () => checkSoftwareRenderer(r),
        (err) => {
          assert.ok(err instanceof GpuPathDetectedError);
          assert.equal(err.code, "gpu_path_detected");
          assert.equal(err.permanent, false, "gpu_path_detected is retriable on another worker");
          return true;
        }
      );
    }

    // Also verify prepareManifestClips refuses to draw when probeRenderer reports a hardware GPU
    const projectId = randomUUID();
    const html0 = makeSceneHtml("gpu-check-scene");
    const { manifest } = makeSchema2Manifest(projectId, [{ html: html0 }]);
    let drewFrames = 0;
    const dir3 = join(scratch, "t3");
    await assert.rejects(
      () =>
        prepareManifestClips(
          { op: async () => ({ clips: [] }) },
          manifest,
          {
            fence: { jobId: randomUUID(), attempt: 1 },
            scratch: dir3,
            probeRenderer: async () => "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, D3D11)",
            storageImpl: {
              downloadPlateInput: async (_key, dest) => writeFileSync(dest, html0, "utf8"),
              downloadPlateOutput: async () => {},
              uploadPlateOutput: async () => {},
              deleteOutputs: async () => {}
            },
            engineImpl: {
              verifyScene: async () => ({ blocked: [] }),
              renderScene: async () => { drewFrames++; },
              probeVideo: async () => ({ frames: 60, width: 1920, height: 1080, fps: 30 }),
              classifyFailure: () => "infra"
            }
          }
        ),
      (err) => err instanceof GpuPathDetectedError && err.code === "gpu_path_detected" && err.permanent === false
    );
    assert.equal(drewFrames, 0, "refuses to draw when GPU path is detected");
  }

  // =========================================================================
  // 4. Digest cache hit and miss (clip.lookup & fenced clip.record)
  // =========================================================================
  {
    const projectId = randomUUID();
    const html0 = makeSceneHtml("cached-scene-0");
    const html1 = makeSceneHtml("missed-scene-1");
    const { manifest } = makeSchema2Manifest(projectId, [{ html: html0, frames: 60 }, { html: html1, frames: 90 }]);
    const s0 = manifest.scenes[0];
    const s1 = manifest.scenes[1];

    const drawnScenes = [];
    const recordedClips = [];
    const uploadedKeys = [];
    const dir4 = join(scratch, "t4");
    const jobId = randomUUID();

    const result = await prepareManifestClips(
      {
        op: async (name, args) => {
          if (name === "clip.lookup") {
            // Scene 0 is a cache hit; Scene 1 is a cache miss
            return {
              clips: [
                {
                  bundle_digest: s0.bundleDigest,
                  engine_digest: manifest.engineDigest,
                  font_set_digest: manifest.fontSetDigest,
                  size: "1920x1080",
                  clip_key: `plates/${projectId}/clips/cached-s0.mp4`,
                  frames: 60
                }
              ]
            };
          }
          if (name === "clip.record") {
            recordedClips.push(args);
            return { ok: true, duplicate: false };
          }
          return { ok: true };
        }
      },
      manifest,
      {
        fence: { jobId, attempt: 2 },
        scratch: dir4,
        probeRenderer: async () => "Google SwiftShader",
        storageImpl: {
          downloadPlateInput: async (key, dest) => {
            writeFileSync(dest, key === s0.bundleKey ? html0 : html1, "utf8");
          },
          downloadPlateOutput: async (key, dest) => {
            assert.equal(key, `plates/${projectId}/clips/cached-s0.mp4`);
            writeFileSync(dest, "CACHED_MP4_0");
          },
          uploadPlateOutput: async (_file, key) => {
            uploadedKeys.push(key);
          },
          deleteOutputs: async () => {}
        },
        engineImpl: {
          verifyScene: async () => ({ blocked: [], midPng: Buffer.from("PNG") }),
          renderScene: async (pagePath, outFile) => {
            const idx = Number(/scene-(\d+)\.html$/.exec(pagePath)[1]);
            drawnScenes.push(idx);
            writeFileSync(outFile, `DRAWN_MP4_${idx}`);
          },
          probeVideo: async () => ({ frames: 90, width: 1920, height: 1080, fps: 30 }),
          classifyFailure: () => "infra"
        }
      }
    );

    assert.equal(result.cacheHits, 1, "1 cache hit reused");
    assert.equal(result.cacheMisses, 1, "1 cache miss drawn");
    assert.deepEqual(drawnScenes, [1], "only cache miss (scene 1) was drawn; scene 0 was reused");
    assert.equal(recordedClips.length, 1, "clip.record called once for the drawn miss");
    assert.equal(recordedClips[0].jobId, jobId);
    assert.equal(recordedClips[0].attempt, 2);
    assert.equal(recordedClips[0].bundleDigest, s1.bundleDigest);
    assert.equal(
      recordedClips[0].clipKey,
      clipCacheKey(projectId, s1.bundleDigest, manifest.engineDigest, manifest.fontSetDigest, 1920, 1080)
    );
    assert.equal(readFileSync(result.clipFiles[0], "utf8"), "CACHED_MP4_0");
    assert.equal(readFileSync(result.clipFiles[1], "utf8"), "DRAWN_MP4_1");

    // Also verify that if clip.record returns { ok: false, fenced: true }, uploaded outputs are deleted and attempt aborts
    const deletedOnFenceLoss = [];
    const dir4b = join(scratch, "t4b");
    await assert.rejects(
      () =>
        prepareManifestClips(
          {
            op: async (name) => {
              if (name === "clip.lookup") return { clips: [] };
              if (name === "clip.record") return { ok: false, fenced: true };
              return { ok: true };
            }
          },
          makeSchema2Manifest(projectId, [{ html: html1, frames: 90 }]).manifest,
          {
            fence: { jobId, attempt: 1 },
            scratch: dir4b,
            probeRenderer: async () => "Google SwiftShader",
            storageImpl: {
              downloadPlateInput: async (_key, dest) => writeFileSync(dest, html1, "utf8"),
              downloadPlateOutput: async () => {},
              uploadPlateOutput: async () => {},
              deleteOutputs: async (keys) => deletedOnFenceLoss.push(...keys)
            },
            engineImpl: {
              verifyScene: async () => ({ blocked: [], midPng: Buffer.from("PNG") }),
              renderScene: async (_p, outFile) => writeFileSync(outFile, "MP4"),
              probeVideo: async () => ({ frames: 90, width: 1920, height: 1080, fps: 30 }),
              classifyFailure: () => "infra"
            }
          }
        ),
      /no longer owns the job/i
    );
    assert.equal(deletedOnFenceLoss.length, 2, "uploaded clip and still are deleted if clip.record fence fails");
  }

  // =========================================================================
  // 5. Manifest Schema 1 compatibility
  // =========================================================================
  {
    const projectId = randomUUID();
    const schema1Manifest = {
      schema: 1,
      assembler: 1,
      projectId,
      aspect: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      totalFrames: 150,
      watermark: false,
      scenes: [
        { index: 0, variantId: randomUUID(), sig: "v3:s0", clipKey: `plates/${projectId}/16x9/0/g1/clip-a1.mp4`, frames: 60, startFrame: 0, voice: null },
        { index: 1, variantId: randomUUID(), sig: "v3:s1", clipKey: `plates/${projectId}/16x9/1/g1/clip-a1.mp4`, frames: 90, startFrame: 60, voice: null }
      ],
      music: null,
      voiceOn: false,
      subtitles: { mode: "none", style: "pill" },
      cues: [],
      sfx: []
    };
    const schema1Key = `plates/${projectId}/exports/x1_legacy/manifest.json`;
    const dir5 = join(scratch, "t5");
    rmSync(dir5, { recursive: true, force: true });
    writeFileSync(join(scratch, "m1.json"), JSON.stringify(schema1Manifest));

    const loaded1 = await loadManifest(schema1Key, projectId, scratch, {
      storageImpl: {
        downloadPlateInput: async (_key, dest) => writeFileSync(dest, JSON.stringify(schema1Manifest))
      }
    });
    assert.equal(loaded1.schema, 1, "loadManifest accepts schema 1 manifests for in-flight jobs");
    assert.equal(loaded1.totalFrames, 150);

    // Schema 2 content-addressed key tamper check in loadManifest
    const { manifest: m2, manifestKey: m2Key } = makeSchema2Manifest(projectId, [{ html: makeSceneHtml("s0"), frames: 60 }]);
    const loaded2 = await loadManifest(m2Key, projectId, scratch, {
      storageImpl: {
        downloadPlateInput: async (_key, dest) => writeFileSync(dest, canonicalJson(m2))
      }
    });
    assert.equal(loaded2.schema, 2, "loadManifest accepts valid content-addressed schema 2 manifest");

    const mutatedM2 = { ...m2, watermark: true };
    await assert.rejects(
      () =>
        loadManifest(m2Key, projectId, scratch, {
          storageImpl: {
            downloadPlateInput: async (_key, dest) => writeFileSync(dest, canonicalJson(mutatedM2))
          }
        }),
      /content hash does not match its content-addressed key/i,
      "loadManifest rejects a schema 2 manifest whose content was mutated under its content-addressed key"
    );
  }

  console.log("plates phase 5 worker tests: ok");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
