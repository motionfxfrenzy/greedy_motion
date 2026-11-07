import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME,
  DEFAULT_PLAYBACK_RENDER_MODE,
  DRAFT_BEHIND_FRAMES,
  DRAFT_MAX_RUNWAY_FRAMES,
  DRAFT_NEXT_SCENE_HEAD_FRAMES,
  DRAFT_NOMINAL_RUNWAY_FRAMES,
  DRAFT_SHARED_CACHE_BUDGET_BYTES,
  DRAFT_STYLE_ID_TO_LOOK_ID,
  DRAFT_STYLE_POLICY_TABLE,
  FULL_QUALITY_SPEC,
  PAUSE_STILL_DEBOUNCE_MS,
  PlatePlayer,
  buildDraftQualitySpec,
  createFilmPlayer,
  draftQualityProfileKey,
  getDraftTargetForceOverride,
  getDraftTargetVerticesPerFrame,
  isDraftStylePolicyEnabled,
  normalizeListedDraftLook,
  resetDraftStylePolicy,
  resetDraftTargetForceOverride,
  resetDraftTargetVerticesPerFrame,
  resolveDraftQualitySpecForStyle,
  resolveDraftStylePolicyEnabledFromEnv,
  resolveDraftStylePolicyEntry,
  resolveDraftTargetForceFromEnv,
  resolveDraftTargetVerticesFromEnv,
  resolveQualitySpecForMode,
  setDraftStylePolicyEnabled,
  setDraftTargetForceOverride,
  setDraftTargetVerticesPerFrame,
  validateDraftStylePolicyEntry,
  validateDraftStylePolicyTable,
  validateDraftTargetVerticesPerFrame,
  isPlateDraftPreviewEnabled,
  readStoredPlaybackRenderMode,
  writeStoredPlaybackRenderMode,
  FrameStore,
  InMemoryFrameStoreBackend
} from "../lib/live/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function fakeElement() {
  const drawn = [];
  const doc = {
    createElement() {
      return {
        style: {},
        width: 0,
        height: 0,
        getContext: () => ({
          clearRect() {},
          drawImage(bm) {
            drawn.push(bm);
          }
        }),
        remove() {}
      };
    }
  };
  return { ownerDocument: doc, drawn, appendChild: (c) => c };
}

function makeTrackingTransport({
  drawMsDraft = 12,
  drawMsFull = 95,
  draftSupported = true,
  delayFullDrawMs = 0
} = {}) {
  const calls = [];
  const bitmaps = [];
  let activeTransports = 0;

  const factory = async () => {
    activeTransports++;
    let terminated = false;
    const port = {
      onmessage: null,
      postMessage(msg) {
        if (terminated) return;
        if (msg.t === "init") {
          port.onmessage?.({
            data: {
              t: "init",
              id: msg.id,
              w: 640,
              h: 360,
              meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 },
              capabilities: {
                draftSupported,
                seekAcceptsQuality: draftSupported,
                profileVersion: draftSupported ? "v1" : "legacy",
                defaultDraftTargetVerticesPerFrame: 75000
              }
            }
          });
        } else if (msg.t === "hb") {
          port.onmessage?.({ data: { t: "hb", id: msg.id } });
        } else if (msg.t === "dispose") {
          port.onmessage?.({ data: { t: "dispose", id: msg.id, ok: true } });
        } else if (msg.t === "frame") {
          const qSpec = msg.qualitySpec;
          const mode =
            qSpec === "draft" || (typeof qSpec === "object" && qSpec !== null && qSpec.mode === "draft")
              ? "draft"
              : "full";
          const targetVertices =
            typeof qSpec === "object" && qSpec !== null ? (qSpec.draftTargetVerticesPerFrame ?? 0) : 0;
          const mellanTurnDensity =
            typeof qSpec === "object" && qSpec !== null ? qSpec.mellanTurnDensity : undefined;
          calls.push({
            n: msg.n,
            mode,
            targetVertices,
            mellanTurnDensity,
            includeCalibration: Boolean(msg.includeCalibration),
            epoch: msg.epoch
          });

          const respond = () => {
            if (terminated) return;
            const dMs = mode === "draft" ? drawMsDraft : drawMsFull;
            const bm = {
              width: 640,
              height: 360,
              frameIndex: msg.n,
              qualityMode: mode,
              targetVertices,
              mellanTurnDensity,
              closed: false,
              close() {
                this.closed = true;
              }
            };
            bitmaps.push(bm);
            port.onmessage?.({
              data: {
                t: "frame",
                id: msg.id,
                n: msg.n,
                bitmap: bm,
                drawMs: dMs,
                epoch: msg.epoch,
                frameStats: {
                  frame: msg.n,
                  qualityMode: mode,
                  draftTargetVerticesPerFrame: targetVertices,
                  ...(mellanTurnDensity !== undefined ? { mellanTurnDensity } : {}),
                  penRibbonVertices: mode === "draft" ? Math.min(targetVertices || 75000, 18000) : 180000
                },
                ...(msg.includeCalibration
                  ? {
                      calibration: {
                        targetB: targetVertices,
                        mellanTurnDensity: mellanTurnDensity ?? null
                      }
                    }
                  : {})
              }
            });
          };

          if (mode === "full" && delayFullDrawMs > 0) {
            setTimeout(respond, delayFullDrawMs);
          } else {
            respond();
          }
        }
      }
    };
    return {
      port,
      terminate() {
        if (!terminated) {
          terminated = true;
          activeTransports = Math.max(0, activeTransports - 1);
        }
      }
    };
  };

  return {
    factory,
    calls,
    bitmaps,
    get activeTransports() {
      return activeTransports;
    }
  };
}

test("draft-profile: single tunable draftTargetVerticesPerFrame validation, profile keys, and runtime setter", () => {
  resetDraftTargetVerticesPerFrame();
  assert.equal(DEFAULT_PLAYBACK_RENDER_MODE, "draft");
  assert.equal(DEFAULT_DRAFT_TARGET_VERTICES_PER_FRAME, 75_000);
  assert.equal(getDraftTargetVerticesPerFrame(), 75_000);
  assert.equal(DRAFT_NOMINAL_RUNWAY_FRAMES, 15);
  assert.equal(DRAFT_MAX_RUNWAY_FRAMES, 30);
  assert.equal(DRAFT_BEHIND_FRAMES, 2);
  assert.equal(DRAFT_NEXT_SCENE_HEAD_FRAMES, 6);
  assert.equal(DRAFT_SHARED_CACHE_BUDGET_BYTES, 32 * 1024 * 1024);
  assert.equal(PAUSE_STILL_DEBOUNCE_MS, 250);

  // Validation rejects out-of-range or non-integer values
  for (const invalid of [0, -100, 499, 2_000_001, 123.45, NaN, Infinity, "abc", null, undefined]) {
    assert.throws(() => validateDraftTargetVerticesPerFrame(invalid), RangeError);
  }
  assert.equal(validateDraftTargetVerticesPerFrame(6000), 6000);
  assert.equal(validateDraftTargetVerticesPerFrame("60000"), 60000);
  assert.equal(validateDraftTargetVerticesPerFrame(75000), 75000);

  // Changing single parameter updates spec and cache key
  const key75k = draftQualityProfileKey(buildDraftQualitySpec());
  assert.match(key75k, /:tb75000:/);

  setDraftTargetVerticesPerFrame(6000);
  assert.equal(getDraftTargetVerticesPerFrame(), 6000);
  const spec6k = buildDraftQualitySpec();
  assert.equal(spec6k.draftTargetVerticesPerFrame, 6000);
  assert.equal(spec6k.targetFramePenVertices, 6000);
  const key6k = draftQualityProfileKey(spec6k);
  assert.match(key6k, /:tb6000:/);
  assert.notEqual(key6k, key75k);

  setDraftTargetVerticesPerFrame(60000);
  const key60k = draftQualityProfileKey(buildDraftQualitySpec());
  assert.match(key60k, /:tb60000:/);
  assert.notEqual(key60k, key6k);
  assert.notEqual(key60k, key75k);

  resetDraftTargetVerticesPerFrame();
  assert.equal(getDraftTargetVerticesPerFrame(), 75_000);

  // Verify NEXT_PUBLIC_DRAFT_TARGET_VERTICES env resolution: invalid/unset values fall back safely to 75,000
  for (const invalidEnv of [
    undefined,
    null,
    "",
    "   ",
    "abc",
    "NaN",
    "Infinity",
    "-Infinity",
    "6000.5",
    "123.45",
    "0",
    "-100",
    "499",
    "2000001"
  ]) {
    assert.equal(
      resolveDraftTargetVerticesFromEnv(invalidEnv),
      75_000,
      `invalid env value ${JSON.stringify(invalidEnv)} must safely fall back to 75000`
    );
  }
  for (const validEnv of ["6000", "60000", "75000", 6000, 60000, 75000]) {
    assert.equal(resolveDraftTargetVerticesFromEnv(validEnv), Number(validEnv));
  }

  // Verify process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES flows end-to-end when resetDraftTargetVerticesPerFrame() is called
  const savedEnv = process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES;
  try {
    process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES = "6000";
    assert.equal(resetDraftTargetVerticesPerFrame(), 6000);
    assert.equal(getDraftTargetVerticesPerFrame(), 6000);

    process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES = "60000";
    assert.equal(resetDraftTargetVerticesPerFrame(), 60000);
    assert.equal(getDraftTargetVerticesPerFrame(), 60000);

    process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES = "not-a-number";
    assert.equal(resetDraftTargetVerticesPerFrame(), 75_000);
    assert.equal(getDraftTargetVerticesPerFrame(), 75_000);
  } finally {
    if (savedEnv === undefined) delete process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES;
    else process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES = savedEnv;
    resetDraftTargetVerticesPerFrame();
  }
});

test("client-build static inlining of process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES (with no runtime process global)", async () => {
  const entry = join(HERE, "../lib/live/draft-profile.ts");
  for (const [inlinedVal, expected] of [
    ["6000", 6000],
    ["60000", 60000],
    ["75000", 75000],
    ["", 75000],
    ["invalid", 75000],
    ["123.4", 75000],
    ["100", 75000]
  ]) {
    const res = await build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      target: "es2022",
      write: false,
      define: {
        "process.env.NEXT_PUBLIC_DRAFT_TARGET_VERTICES": JSON.stringify(inlinedVal)
      }
    });
    const code = res.outputFiles[0].text;
    const modUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    const mod = await import(modUrl);
    assert.equal(
      mod.getDraftTargetVerticesPerFrame(),
      expected,
      `client bundle with NEXT_PUBLIC_DRAFT_TARGET_VERTICES=${JSON.stringify(inlinedVal)} resolves to ${expected}`
    );
  }
});

test("Draft mode: bounded 15..30 frame RAM runway, zero FrameStore/WebP writes, and strict Draft/Full store separation", async () => {
  const tr = makeTrackingTransport({ drawMsDraft: 10, drawMsFull: 120 });
  let encodeCalls = 0;
  const store = new FrameStore({
    backend: new InMemoryFrameStoreBackend(),
    encoder: {
      async encode() {
        encodeCalls++;
        return new Blob([new Uint8Array(1024)], { type: "image/webp" });
      },
      async decode() {
        return { width: 640, height: 360, close() {} };
      }
    }
  });

  const el = fakeElement();
  const player = new PlatePlayer({
    bundleDigest: "draft-scene-0",
    html: "<script>window.FILM={};</script>",
    frames: 150,
    fps: 30,
    renderMode: "draft",
    frameStore: store,
    transportFactory: tr.factory,
    autoPump: false
  });
  player.setWantPlaying(true);

  await player.mount(el);
  assert.equal(player.renderMode, "draft");
  assert.equal(player.effectiveRenderMode, "draft");
  assert.equal(player.state, "playing");

  // Start buffer in Draft mode is bounded to 15 frames (never 144 frames!)
  assert.equal(player.predrawPlan?.startFrames, 15);
  assert.ok(player.cachedPreviewFrames().length <= 16, "Draft buffer holds at most 15..16 frames on start");

  // Play frames 0..25 in Draft mode and pump scheduler
  for (let f = 0; f <= 25; f++) {
    player.showFrame(f);
    await player.pumpScheduler(2);
    const cached = player.cachedPreviewFrames();
    assert.ok(
      cached.every((idx) => idx >= Math.max(0, f - DRAFT_BEHIND_FRAMES)),
      `frames older than f - ${DRAFT_BEHIND_FRAMES} are evicted and closed at frame ${f}`
    );
    assert.ok(
      cached.length <= DRAFT_MAX_RUNWAY_FRAMES + DRAFT_BEHIND_FRAMES + 1,
      `Draft RAM buffer never exceeds bounded runway (got ${cached.length})`
    );
  }

  // Verify zero FrameStore saves and zero WebP encode calls occurred on the Draft path
  await store.flush();
  assert.equal(encodeCalls, 0, "Draft mode never invokes WebP encoder");
  assert.equal(store.savedFrames("draft-scene-0", "640x360").length, 0, "Draft mode never writes to FrameStore");
  assert.ok(tr.calls.every((c) => c.mode === "draft"), "Every playback draw used Draft qualitySpec");

  player.destroy();
  store.destroy();
  assert.ok(tr.bitmaps.every((b) => b.closed), "All bitmaps closed on destroy");
});

test("Intentional pause -> 250ms debounced full-quality still upgrade, cancellation on resume/scrub, and underrun immunity", async () => {
  const tr = makeTrackingTransport({ drawMsDraft: 8, drawMsFull: 45, delayFullDrawMs: 40 });
  const el = fakeElement();
  const player = new PlatePlayer({
    bundleDigest: "pause-still-scene",
    html: "<script>window.FILM={};</script>",
    frames: 90,
    fps: 30,
    renderMode: "draft",
    pauseStillDebounceMs: 60, // short debounce for fast unit test
    transportFactory: tr.factory,
    autoPump: false
  });

  // Start playing: no pause still should be scheduled while playing
  player.setWantPlaying(true);
  await player.mount(el);
  player.showFrame(0);
  assert.equal(player.stillUpgradeState, "idle");

  // 1. Underrun stall while wantPlaying === true MUST NOT trigger a pause still upgrade
  player.showFrame(50); // frame 50 is uncached -> enters buffering
  assert.equal(player.isBufferingNow, true);
  assert.equal(player.stillUpgradeState, "idle", "buffer underrun never schedules a pause still upgrade");
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(
    tr.calls.filter((c) => c.mode === "full").length,
    0,
    "zero full-quality draws during buffer underrun"
  );

  // Return to cached frame 0 and clear buffering
  await player.pumpScheduler(15);
  player.showFrame(0);
  assert.equal(player.isBufferingNow, false);

  // 2. Intentional pause on frame 0 -> schedules pending-still, then if resumed before debounce fires, cancels!
  player.setWantPlaying(false);
  assert.equal(player.stillUpgradeState, "pending-still");
  await new Promise((r) => setTimeout(r, 20));
  player.setWantPlaying(true); // resume before 60ms debounce
  assert.equal(player.stillUpgradeState, "idle");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(
    tr.calls.filter((c) => c.mode === "full").length,
    0,
    "resuming before debounce window cancels full-quality still draw"
  );

  // 3. Intentional pause that settles past debounce window -> upgrades to showing-still with 1 full-quality draw
  player.setWantPlaying(false);
  assert.equal(player.stillUpgradeState, "pending-still");
  await new Promise((r) => setTimeout(r, 75));
  // Now in drawing-still (since delayFullDrawMs = 40)
  assert.ok(
    player.stillUpgradeState === "drawing-still" || player.stillUpgradeState === "showing-still",
    `expected drawing-still or showing-still, got ${player.stillUpgradeState}`
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(player.stillUpgradeState, "showing-still");
  const fullCalls = tr.calls.filter((c) => c.mode === "full");
  assert.equal(fullCalls.length, 1, "exactly ONE full-quality still frame drawn on pause");
  assert.equal(fullCalls[0].n, 0);
  assert.equal(el.drawn.at(-1)?.qualityMode, "full", "canvas displays the full-quality still bitmap");

  // 4. Pause on frame 1, let drawing-still start, then resume mid-flight -> stale full bitmap is closed and discarded!
  player.showFrame(1);
  assert.equal(player.stillUpgradeState, "pending-still");
  await new Promise((r) => setTimeout(r, 70)); // drawing-still in flight
  assert.equal(player.stillUpgradeState, "drawing-still");
  player.setWantPlaying(true); // cancel while full draw is in flight!
  assert.equal(player.stillUpgradeState, "idle");
  await new Promise((r) => setTimeout(r, 60)); // let stale full draw return
  const staleFullBitmaps = tr.bitmaps.filter((b) => b.qualityMode === "full" && b.frameIndex === 1);
  assert.equal(staleFullBitmaps.length, 1);
  assert.equal(staleFullBitmaps[0].closed, true, "stale in-flight full bitmap is immediately closed on arrival");

  player.destroy();
  assert.ok(tr.bitmaps.every((b) => b.closed), "All bitmaps closed on destroy");
});

test("Explicit Full mode, Draft<->Full switching without QualityJob, legacy bundle fallback, and end-of-film cleanup", async () => {
  const tr = makeTrackingTransport({ drawMsDraft: 8, drawMsFull: 30, draftSupported: true });
  const legacyTr = makeTrackingTransport({ drawMsDraft: 8, drawMsFull: 30, draftSupported: false });
  const store = new FrameStore({ backend: new InMemoryFrameStoreBackend() });

  let timeSec = 0;
  let isPlaying = false;
  const film = createFilmPlayer({
    scenes: [
      { id: "s0", bundleDigest: "dig-0", html: "<script>window.FILM={};</script>", frames: 30 },
      { id: "s1", bundleDigest: "dig-1", html: "<script>window.FILM={};</script>", frames: 30 }
    ],
    fps: 30,
    renderMode: "draft",
    pauseStillDebounceMs: 50,
    frameStore: store,
    timeSource: { currentTime: () => timeSec, playing: () => isPlaying },
    transportFactory: tr.factory,
    autoPump: false
  });

  const el = fakeElement();
  await film.mount(el);
  assert.equal(film.renderMode, "draft");
  assert.equal(film.qualityJob, null);

  // Switch to Full mode: updates renderMode to "full", does NOT start QualityJob
  film.setRenderMode("full");
  assert.equal(film.renderMode, "full");
  assert.equal(film.qualityJob, null, "switching Draft -> Full never starts QualityJob");
  assert.equal(film.scenes[0].effectiveRenderMode, "full");

  // Switch back to Draft mode and test single global setDraftTargetVerticesPerFrame(6000) updating active FilmPlayer
  film.setRenderMode("draft");
  const prevCacheKey = film.scenes[0].cacheKey;
  assert.match(prevCacheKey, /:tb75000:/);
  setDraftTargetVerticesPerFrame(6000);
  assert.equal(film.draftTargetVerticesPerFrame, 6000, "global setDraftTargetVerticesPerFrame updates active FilmPlayer");
  assert.equal(film.scenes[0].draftTargetVerticesPerFrame, 6000, "global setDraftTargetVerticesPerFrame updates active PlatePlayer");
  assert.match(film.scenes[0].cacheKey, /:tb6000:/);
  assert.notEqual(film.scenes[0].cacheKey, prevCacheKey);
  await film.scenes[0].pumpScheduler(1);
  assert.equal(tr.calls.at(-1)?.targetVertices, 6000, "Worker receives updated 6000 vertex budget from global setter");
  resetDraftTargetVerticesPerFrame();

  // End-of-film cleanup: closes all cached bitmaps and terminates idle scene Workers
  assert.ok(tr.activeTransports >= 1);
  film.completeFilmCleanup();
  assert.equal(film.cache.bytes, 0, "completeFilmCleanup empties FrameCache bytes to 0");
  assert.equal(tr.activeTransports, 0, "completeFilmCleanup terminates idle scene Workers");

  // Seeking after completeFilmCleanup transparently respawns the Worker
  timeSec = 0.1;
  film.syncToClock();
  await film.scenes[0].pumpScheduler(1);
  assert.equal(tr.activeTransports, 1, "seeking after film end transparently respawns active scene Worker");

  film.destroy();
  store.destroy();
  assert.equal(tr.activeTransports, 0);
  assert.ok(tr.bitmaps.every((b) => b.closed));

  // Verify legacy bundle without draft capability falls back cleanly to Full without crashing or switching to clip
  const legacyPlayer = new PlatePlayer({
    bundleDigest: "legacy-digest",
    html: "<script>window.FILM={};</script>",
    frames: 30,
    fps: 30,
    renderMode: "draft",
    transportFactory: legacyTr.factory,
    autoPump: false
  });
  await legacyPlayer.mount(fakeElement());
  assert.equal(legacyPlayer.decision().mode, "live", "legacy bundle stays live (never requests clip)");
  assert.equal(legacyPlayer.effectiveRenderMode, "full", "legacy bundle falls back to effectiveRenderMode=full");
  legacyPlayer.destroy();

  // Verify NEXT_PUBLIC_PLATE_DRAFT_PREVIEW rollback flag and localStorage renderMode persistence
  const savedDraftFlag = process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW;
  const savedLiveFlag = process.env.NEXT_PUBLIC_PLATE_LIVE;
  try {
    process.env.NEXT_PUBLIC_PLATE_LIVE = "1";
    delete process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW;
    assert.equal(isPlateDraftPreviewEnabled(), true);
    const defaultDraftPlayer = new PlatePlayer({
      bundleDigest: "flag-on-digest",
      html: "<script>window.FILM={};</script>",
      frames: 30,
      fps: 30,
      transportFactory: tr.factory,
      autoPump: false
    });
    assert.equal(defaultDraftPlayer.renderMode, "draft", "NEXT_PUBLIC_PLATE_LIVE=1 defaults PlatePlayer to draft");
    defaultDraftPlayer.destroy();

    process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW = "0";
    assert.equal(isPlateDraftPreviewEnabled(), false);
    const rollbackFullPlayer = new PlatePlayer({
      bundleDigest: "flag-off-digest",
      html: "<script>window.FILM={};</script>",
      frames: 30,
      fps: 30,
      transportFactory: tr.factory,
      autoPump: false
    });
    assert.equal(
      rollbackFullPlayer.renderMode,
      "full",
      "NEXT_PUBLIC_PLATE_DRAFT_PREVIEW=0 rolls back default renderMode to full"
    );
    rollbackFullPlayer.destroy();
  } finally {
    if (savedDraftFlag === undefined) delete process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW;
    else process.env.NEXT_PUBLIC_PLATE_DRAFT_PREVIEW = savedDraftFlag;
    if (savedLiveFlag === undefined) delete process.env.NEXT_PUBLIC_PLATE_LIVE;
    else process.env.NEXT_PUBLIC_PLATE_LIVE = savedLiveFlag;
  }

  const memStorage = new Map();
  const storageStub = {
    getItem: (k) => memStorage.get(k) ?? null,
    setItem: (k, v) => memStorage.set(k, v)
  };
  assert.equal(readStoredPlaybackRenderMode(storageStub), "draft");
  assert.equal(writeStoredPlaybackRenderMode("full", storageStub), "full");
  assert.equal(readStoredPlaybackRenderMode(storageStub), "full");
  assert.equal(writeStoredPlaybackRenderMode("draft", storageStub), "draft");
  assert.equal(readStoredPlaybackRenderMode(storageStub), "draft");
});

test("draft-style-policy: 9-style table, unlisted styles, precedence (C1-C7), calibration/cache re-keying, and validation", async () => {
  resetDraftTargetVerticesPerFrame();
  resetDraftTargetForceOverride(undefined);
  resetDraftStylePolicy(undefined);

  // (a) Each of the 9 owner-approved table entries resolves to its exact spec & key for both lookId and camelCase styleId
  const expectedEntries = [
    {
      styleId: "stipple",
      lookId: "illus-stipple",
      target: 75_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb75000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "halftone",
      lookId: "illus-halftone",
      target: 75_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb75000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "charcoalErasure",
      lookId: "illus-charcoal-erasure",
      target: 6_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb6000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "mellan",
      lookId: "illus-mellan",
      target: 4_000,
      mtd: 0.75,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb4000:ms48:mc0:bp-scene-calibrated:mtd0.75"
    },
    {
      styleId: "blueprint",
      lookId: "illus-blueprint",
      target: 6_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb6000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "pocketWatch",
      lookId: "illus-pocket-watch",
      target: 6_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb6000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "balloon",
      lookId: "illus-balloon",
      target: 75_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb75000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "paintedOil",
      lookId: "illus-painted-oil",
      target: 6_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb6000:ms48:mc0:bp-scene-calibrated"
    },
    {
      styleId: "embroidery",
      lookId: "illus-embroidery",
      target: 6_000,
      mtd: undefined,
      key: "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb6000:ms48:mc0:bp-scene-calibrated"
    }
  ];

  assert.equal(Object.keys(DRAFT_STYLE_POLICY_TABLE).length, 9);
  assert.equal(Object.keys(DRAFT_STYLE_ID_TO_LOOK_ID).length, 9);

  for (const item of expectedEntries) {
    assert.equal(normalizeListedDraftLook(item.lookId), item.lookId);
    assert.equal(normalizeListedDraftLook(item.styleId), item.lookId);

    const specByLook = resolveDraftQualitySpecForStyle({ look: item.lookId });
    const specByStyle = resolveDraftQualitySpecForStyle({ look: item.styleId });
    assert.equal(specByLook.draftTargetVerticesPerFrame, item.target, `${item.lookId} target`);
    assert.equal(specByStyle.draftTargetVerticesPerFrame, item.target, `${item.styleId} target`);
    assert.equal(specByLook.mellanTurnDensity, item.mtd, `${item.lookId} mellanTurnDensity`);
    assert.equal(specByStyle.mellanTurnDensity, item.mtd, `${item.styleId} mellanTurnDensity`);
    assert.equal(draftQualityProfileKey(specByLook), item.key, `${item.lookId} profileKey`);
    assert.equal(draftQualityProfileKey(specByStyle), item.key, `${item.styleId} profileKey`);
  }

  // (b) All 22 unlisted styles + unknown/fuzzy strings + null/undefined resolve to global target (C1 & C3)
  const unlistedStyles = [
    "brokenColour",
    "illus-broken-colour",
    "colouredPencil",
    "illus-coloured-pencil",
    "flatVector",
    "illus-flat-vector",
    "folkTale",
    "illus-folk-tale",
    "fox",
    "illus-fox",
    "isometric",
    "illus-isometric",
    "koi",
    "illus-koi",
    "lighthouse",
    "illus-lighthouse",
    "lowPoly",
    "illus-low-poly",
    "midCentury",
    "illus-mid-century",
    "moonPhases",
    "illus-moon-phases",
    "paperCraft",
    "illus-paper-craft",
    "pixelArt",
    "illus-pixel-art",
    "ranunculus",
    "illus-ranunculus",
    "rubberHose",
    "illus-rubber-hose",
    "scrapbook",
    "illus-scrapbook",
    "scratchboard",
    "illus-scratchboard",
    "storybook",
    "illus-storybook",
    "sumiE",
    "illus-sumi-e",
    "toyBrick",
    "illus-toy-brick",
    "woodcut",
    "illus-woodcut",
    "wren",
    "illus-wren",
    // Fuzzy / non-exact strings must NOT match (C3)
    "ILLUS-MELLAN",
    "illus_mellan",
    "mellan ",
    "charcoal-erasure",
    "illus-charcoalErasure",
    "",
    null,
    undefined
  ];

  for (const unlisted of unlistedStyles) {
    assert.equal(normalizeListedDraftLook(unlisted), null, `unlisted ${String(unlisted)} normalizes to null`);
    const spec = resolveDraftQualitySpecForStyle({ look: unlisted });
    assert.equal(spec.draftTargetVerticesPerFrame, 75_000, `unlisted ${String(unlisted)} uses global 75000`);
    assert.equal(spec.mellanTurnDensity, undefined, `unlisted ${String(unlisted)} never gets mtd`);
    assert.equal(
      draftQualityProfileKey(spec),
      "draft:v1:hg1:hs3:sub1:sp2:ds6:tol0.8:rt-skip:tb75000:ms48:mc0:bp-scene-calibrated"
    );
  }

  // (c) Env global target (NEXT_PUBLIC_DRAFT_TARGET_VERTICES) and global setter affect ONLY unlisted styles;
  //     listed styles stay at their table entry (C4)
  resetDraftTargetVerticesPerFrame("42000");
  assert.equal(getDraftTargetVerticesPerFrame(), 42_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-fox" }).draftTargetVerticesPerFrame, 42_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: null }).draftTargetVerticesPerFrame, 42_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-mellan" }).draftTargetVerticesPerFrame, 4_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-mellan" }).mellanTurnDensity, 0.75);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-blueprint" }).draftTargetVerticesPerFrame, 6_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-balloon" }).draftTargetVerticesPerFrame, 75_000);

  setDraftTargetVerticesPerFrame(30_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-woodcut" }).draftTargetVerticesPerFrame, 30_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-charcoal-erasure" }).draftTargetVerticesPerFrame, 6_000);
  assert.equal(resolveDraftQualitySpecForStyle({ look: "illus-stipple" }).draftTargetVerticesPerFrame, 75_000);
  resetDraftTargetVerticesPerFrame();

  // (d) Force override (NEXT_PUBLIC_DRAFT_TARGET_FORCE / setDraftTargetForceOverride) wins for ALL styles (listed & unlisted)
  assert.equal(resolveDraftTargetForceFromEnv(undefined), null);
  assert.equal(resolveDraftTargetForceFromEnv(""), null);
  assert.equal(resolveDraftTargetForceFromEnv("off"), null);
  assert.equal(resolveDraftTargetForceFromEnv("15000"), 15_000);
  setDraftTargetForceOverride(15_000);
  assert.equal(getDraftTargetForceOverride(), 15_000);
  for (const look of ["illus-mellan", "illus-blueprint", "illus-balloon", "illus-fox", null]) {
    const forcedSpec = resolveDraftQualitySpecForStyle({ look });
    assert.equal(forcedSpec.draftTargetVerticesPerFrame, 15_000, `force override wins for ${String(look)}`);
    assert.equal(forcedSpec.mellanTurnDensity, undefined, `force override omits mtd for ${String(look)}`);
  }
  setDraftTargetForceOverride(null);
  assert.equal(getDraftTargetForceOverride(), null);

  // (e) Kill switch (NEXT_PUBLIC_DRAFT_STYLE_POLICY=off / setDraftStylePolicyEnabled(false)) returns today's behaviour
  assert.equal(resolveDraftStylePolicyEnabledFromEnv(undefined), true);
  assert.equal(resolveDraftStylePolicyEnabledFromEnv("on"), true);
  assert.equal(resolveDraftStylePolicyEnabledFromEnv("off"), false);
  assert.equal(resolveDraftStylePolicyEnabledFromEnv("0"), false);
  assert.equal(resolveDraftStylePolicyEnabledFromEnv("false"), false);

  setDraftTargetVerticesPerFrame(55_000);
  setDraftStylePolicyEnabled(false);
  assert.equal(isDraftStylePolicyEnabled(), false);
  for (const look of ["illus-mellan", "illus-blueprint", "illus-balloon", "illus-fox", null]) {
    const offSpec = resolveDraftQualitySpecForStyle({ look });
    assert.equal(offSpec.draftTargetVerticesPerFrame, 55_000, `kill switch off uses global target for ${String(look)}`);
    assert.equal(offSpec.mellanTurnDensity, undefined, `kill switch off omits mtd for ${String(look)}`);
  }
  setDraftStylePolicyEnabled(true);
  resetDraftTargetVerticesPerFrame();

  // (f) Full mode, pause Full still, and export stay "full:1" with no look influence (C7)
  for (const look of ["illus-mellan", "illus-blueprint", "illus-balloon", "illus-fox", null]) {
    const fullSpec = resolveQualitySpecForMode("full", undefined, look);
    assert.equal(fullSpec, FULL_QUALITY_SPEC);
    assert.equal(draftQualityProfileKey(fullSpec), "full:1");
    assert.equal(fullSpec.mellanTurnDensity, undefined);
  }

  // (g) mtd is never applied to non-mellan styles & invalid entry handling
  assert.throws(
    () =>
      validateDraftStylePolicyEntry({
        styleId: "blueprint",
        lookId: "illus-blueprint",
        draftTargetVerticesPerFrame: 6_000,
        mellanTurnDensity: 0.75
      }),
    RangeError,
    "mellanTurnDensity on non-mellan throws RangeError"
  );
  assert.throws(
    () =>
      validateDraftStylePolicyEntry({
        styleId: "mellan",
        lookId: "illus-mellan",
        draftTargetVerticesPerFrame: 4_000,
        mellanTurnDensity: 1.5
      }),
    RangeError,
    "mellanTurnDensity > 1 throws RangeError"
  );
  assert.throws(
    () =>
      validateDraftStylePolicyEntry({
        styleId: "mellan",
        lookId: "illus-mellan",
        draftTargetVerticesPerFrame: 100
      }),
    RangeError,
    "out-of-range target throws RangeError"
  );
  assert.throws(
    () =>
      validateDraftStylePolicyEntry({
        styleId: "mellan",
        lookId: "illus-blueprint",
        draftTargetVerticesPerFrame: 4_000
      }),
    RangeError,
    "mismatched lookId/styleId throws RangeError"
  );
  assert.throws(
    () =>
      validateDraftStylePolicyTable({
        "illus-mellan": {
          styleId: "mellan",
          lookId: "illus-mellan",
          draftTargetVerticesPerFrame: -50
        }
      }),
    RangeError
  );

  // Runtime fallback on invalid custom table entry: never throws, falls back to global target
  const corruptedTable = {
    "illus-blueprint": {
      styleId: "blueprint",
      lookId: "illus-blueprint",
      draftTargetVerticesPerFrame: -999
    }
  };
  assert.equal(resolveDraftStylePolicyEntry("illus-blueprint", corruptedTable), null);
  const fallbackSpec = resolveDraftQualitySpecForStyle({
    look: "illus-blueprint",
    customTable: corruptedTable
  });
  assert.equal(fallbackSpec.draftTargetVerticesPerFrame, 75_000);

  // (h) Player-level behavior: C4 (global setter ignores listed styles), C5 (explicit option forces player target),
  //     and C6 (spec change resets calibration, re-keys, drops old cached frames, and never serves old frames)
  const tr = makeTrackingTransport({ draftSupported: true, drawMsDraft: 3, drawMsFull: 15 });

  const mellanEl = fakeElement();
  const mellanPlayer = new PlatePlayer({
    id: "scene-mellan",
    bundleDigest: "digest-mellan",
    html: "<script>window.FILM={};</script>",
    look: "illus-mellan",
    frames: 30,
    fps: 30,
    renderMode: "draft",
    transportFactory: tr.factory,
    autoPump: false
  });
  const foxEl = fakeElement();
  const foxPlayer = new PlatePlayer({
    id: "scene-fox",
    bundleDigest: "digest-fox",
    html: "<script>window.FILM={};</script>",
    look: "illus-fox",
    frames: 30,
    fps: 30,
    renderMode: "draft",
    transportFactory: tr.factory,
    autoPump: false
  });
  const explicitBenchPlayer = new PlatePlayer({
    id: "scene-bench-override",
    bundleDigest: "digest-bench",
    html: "<script>window.FILM={};</script>",
    look: "illus-mellan",
    draftTargetVerticesPerFrame: 60_000,
    frames: 30,
    fps: 30,
    renderMode: "draft",
    transportFactory: tr.factory,
    autoPump: false
  });

  // Verify initial resolved specs and keys
  assert.equal(mellanPlayer.draftTargetVerticesPerFrame, 4_000);
  assert.equal(mellanPlayer.qualitySpec.mellanTurnDensity, 0.75);
  assert.match(mellanPlayer.cacheKey, /:tb4000:ms48:mc0:bp-scene-calibrated:mtd0\.75$/);

  assert.equal(foxPlayer.draftTargetVerticesPerFrame, 75_000);
  assert.equal(foxPlayer.qualitySpec.mellanTurnDensity, undefined);
  assert.match(foxPlayer.cacheKey, /:tb75000:ms48:mc0:bp-scene-calibrated$/);

  // C5: Explicit draftTargetVerticesPerFrame in PlatePlayer options acts as a force for that player only
  assert.equal(explicitBenchPlayer.draftTargetVerticesPerFrame, 60_000);
  assert.equal(explicitBenchPlayer.qualitySpec.mellanTurnDensity, undefined);
  assert.match(explicitBenchPlayer.cacheKey, /:tb60000:ms48:mc0:bp-scene-calibrated$/);

  await mellanPlayer.mount(mellanEl);
  await foxPlayer.mount(foxEl);
  assert.deepEqual(mellanPlayer.lastSceneCalibration, { targetB: 4_000, mellanTurnDensity: 0.75 });
  assert.deepEqual(foxPlayer.lastSceneCalibration, { targetB: 75_000, mellanTurnDensity: null });

  const oldMellanCacheKey = mellanPlayer.cacheKey;
  const oldFoxCacheKey = foxPlayer.cacheKey;
  const oldMellanBitmaps = tr.bitmaps.filter((b) => b.targetVertices === 4_000 && b.mellanTurnDensity === 0.75);
  const oldFoxBitmaps = tr.bitmaps.filter((b) => b.targetVertices === 75_000);
  assert.ok(oldMellanBitmaps.length > 0);
  assert.ok(oldFoxBitmaps.length > 0);

  // C4: Global setDraftTargetVerticesPerFrame(25000) updates unlisted foxPlayer, but leaves listed mellanPlayer untouched!
  setDraftTargetVerticesPerFrame(25_000);
  assert.equal(mellanPlayer.draftTargetVerticesPerFrame, 4_000, "listed mellan ignores global setter");
  assert.equal(mellanPlayer.cacheKey, oldMellanCacheKey, "listed mellan cacheKey unchanged by global setter");
  assert.ok(oldMellanBitmaps.every((b) => !b.closed), "listed mellan cached bitmaps remain live");

  assert.equal(foxPlayer.draftTargetVerticesPerFrame, 25_000, "unlisted fox updates on global setter");
  assert.notEqual(foxPlayer.cacheKey, oldFoxCacheKey, "unlisted fox re-keys on global setter");
  assert.equal(foxPlayer.cache.has(oldFoxCacheKey, 0), false, "old fox cache key dropped");
  assert.ok(oldFoxBitmaps.every((b) => b.closed), "all bitmaps under old fox key closed immediately");

  // C6: Force override changes listed mellanPlayer -> resets calibration, drops old cache key, and never serves old frames
  mellanEl.drawn.length = 0;
  setDraftTargetForceOverride(12_000);
  assert.equal(mellanPlayer.draftTargetVerticesPerFrame, 12_000);
  assert.equal(mellanPlayer.qualitySpec.mellanTurnDensity, undefined);
  assert.notEqual(mellanPlayer.cacheKey, oldMellanCacheKey);
  assert.equal(mellanPlayer.cache.has(oldMellanCacheKey, 0), false, "old mellan cache key dropped on force override");
  assert.ok(oldMellanBitmaps.every((b) => b.closed), "old mellan bitmaps closed so they can never be served");
  await mellanPlayer.pumpScheduler(2);
  mellanPlayer.showFrame(0);
  assert.ok(mellanEl.drawn.length > 0, "new frame drawn after force override");
  assert.ok(
    mellanEl.drawn.every((bm) => bm.targetVertices === 12_000 && bm.mellanTurnDensity === undefined && !bm.closed),
    "only frames from the new 12000 key are served (no stale 4000 frame served)"
  );
  assert.deepEqual(
    mellanPlayer.lastSceneCalibration,
    { targetB: 12_000, mellanTurnDensity: null },
    "calibration was reset and re-fetched for the new 12000 spec"
  );

  // Clear force override and test style change via setLook("illus-blueprint") (C6)
  setDraftTargetForceOverride(null);
  resetDraftTargetVerticesPerFrame();
  await mellanPlayer.pumpScheduler(2);
  assert.equal(mellanPlayer.draftTargetVerticesPerFrame, 4_000);
  const keyBeforeLookChange = mellanPlayer.cacheKey;
  mellanEl.drawn.length = 0;
  mellanPlayer.setLook("illus-blueprint");
  assert.equal(mellanPlayer.draftTargetVerticesPerFrame, 6_000);
  assert.equal(mellanPlayer.qualitySpec.mellanTurnDensity, undefined);
  assert.notEqual(mellanPlayer.cacheKey, keyBeforeLookChange);
  assert.equal(mellanPlayer.cache.has(keyBeforeLookChange, 0), false, "previous look cache key dropped");
  await mellanPlayer.pumpScheduler(2);
  mellanPlayer.showFrame(0);
  assert.ok(
    mellanEl.drawn.every((bm) => bm.targetVertices === 6_000 && bm.mellanTurnDensity === undefined),
    "after setLook(illus-blueprint), only 6000-target frames are served"
  );
  assert.deepEqual(mellanPlayer.lastSceneCalibration, { targetB: 6_000, mellanTurnDensity: null });

  mellanPlayer.destroy();
  foxPlayer.destroy();
  explicitBenchPlayer.destroy();

  // (i) Mixed-style FilmPlayer and updateScene re-keying (C6)
  const filmEl = fakeElement();
  const mixedFilm = createFilmPlayer({
    filmKey: "mixed-style-film",
    look: "illus-fox",
    renderMode: "draft",
    transportFactory: tr.factory,
    autoPump: false,
    scenes: [
      { id: "s0", bundleDigest: "d-mellan", html: "<script>window.FILM={};</script>", look: "illus-mellan", frames: 30 },
      { id: "s1", bundleDigest: "d-blueprint", html: "<script>window.FILM={};</script>", look: "illus-blueprint", frames: 30 },
      { id: "s2", bundleDigest: "d-balloon", html: "<script>window.FILM={};</script>", look: "illus-balloon", frames: 30 },
      { id: "s3", bundleDigest: "d-default-fox", html: "<script>window.FILM={};</script>", frames: 30 }
    ]
  });

  assert.equal(mixedFilm.scenes[0].draftTargetVerticesPerFrame, 4_000);
  assert.equal(mixedFilm.scenes[0].qualitySpec.mellanTurnDensity, 0.75);
  assert.equal(mixedFilm.scenes[1].draftTargetVerticesPerFrame, 6_000);
  assert.equal(mixedFilm.scenes[1].qualitySpec.mellanTurnDensity, undefined);
  assert.equal(mixedFilm.scenes[2].draftTargetVerticesPerFrame, 75_000);
  assert.equal(mixedFilm.scenes[3].draftTargetVerticesPerFrame, 75_000);

  await mixedFilm.mount(filmEl);
  const oldScene1Key = mixedFilm.scenes[1].cacheKey;
  await mixedFilm.updateScene(1, {
    id: "s1",
    bundleDigest: "d-blueprint",
    html: "<script>window.FILM={};</script>",
    look: "illus-mellan",
    frames: 30
  });
  assert.equal(mixedFilm.scenes[1].draftTargetVerticesPerFrame, 4_000);
  assert.equal(mixedFilm.scenes[1].qualitySpec.mellanTurnDensity, 0.75);
  assert.notEqual(mixedFilm.scenes[1].cacheKey, oldScene1Key);
  assert.equal(mixedFilm.cache.has(oldScene1Key, 0), false);
  mixedFilm.destroy();
});
