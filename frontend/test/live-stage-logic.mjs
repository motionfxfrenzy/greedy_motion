import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CheckOnceTracker,
  ClipRequestTracker,
  decideSceneMode,
  isPlateLiveEnabled,
  parseGenFromBundleUrl,
  resolveSceneVariant
} from "../lib/live/index.ts";

const CHROME_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.79 Safari/537.36";
const SAFARI_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

test("isPlateLiveEnabled reads NEXT_PUBLIC_PLATE_LIVE and respects explicit overrides", () => {
  const saved = process.env.NEXT_PUBLIC_PLATE_LIVE;
  try {
    delete process.env.NEXT_PUBLIC_PLATE_LIVE;
    assert.equal(isPlateLiveEnabled(), false);
    assert.equal(isPlateLiveEnabled(true), true);
    assert.equal(isPlateLiveEnabled(false), false);

    process.env.NEXT_PUBLIC_PLATE_LIVE = "1";
    assert.equal(isPlateLiveEnabled(), true);
    assert.equal(isPlateLiveEnabled(false), false);

    process.env.NEXT_PUBLIC_PLATE_LIVE = "0";
    assert.equal(isPlateLiveEnabled(), false);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_PLATE_LIVE;
    else process.env.NEXT_PUBLIC_PLATE_LIVE = saved;
  }
});

test("parseGenFromBundleUrl extracts generation from presigned URLs and falls back cleanly", () => {
  assert.equal(
    parseGenFromBundleUrl("http://localhost:59000/plates-uploads/plates/p1/16x9/0/g3/bundle.html?X-Amz=1"),
    3
  );
  assert.equal(
    parseGenFromBundleUrl("/local-storage/uploads/plates%2Fp1%2F16x9%2F0%2Fg2%2Fbundle.html?expires=900"),
    2
  );
  assert.equal(parseGenFromBundleUrl("https://r2.test/bundle.html", 4), 4);
  assert.equal(parseGenFromBundleUrl(null, 1), 1);
});

test("resolveSceneVariant resolves per-aspect variant state, bundleDigest, and clip availability", () => {
  const scene = {
    index: 1,
    keyword: "Footprints in snow",
    state: "checked",
    seconds: 4,
    frames: 120,
    sig: "sig-1",
    rev: 2,
    variantId: "var-16x9",
    bundleDigest: "digest-16x9",
    live: true,
    variants: {
      "16:9": {
        state: "checked",
        sig: "sig-16x9",
        v: null,
        variantId: "var-16x9",
        bundleDigest: "digest-16x9",
        live: true
      },
      "9:16": {
        state: "drawn",
        sig: "sig-9x16",
        v: "cliphash12",
        variantId: "var-9x16",
        bundleDigest: null,
        live: false
      }
    }
  };

  const v169 = resolveSceneVariant(scene, "16:9", "16:9");
  assert.equal(v169.state, "checked");
  assert.equal(v169.variantId, "var-16x9");
  assert.equal(v169.bundleDigest, "digest-16x9");
  assert.equal(v169.hasBundle, true);
  assert.equal(v169.hasClip, false);
  assert.equal(v169.rev, 2);
  assert.equal(v169.gen, 3);

  const v916 = resolveSceneVariant(scene, "9:16", "16:9");
  assert.equal(v916.state, "drawn");
  assert.equal(v916.variantId, "var-9x16");
  assert.equal(v916.hasBundle, false);
  assert.equal(v916.hasClip, true);
  assert.equal(v916.clipVersion, "cliphash12");

  const v1x1 = resolveSceneVariant(scene, "1:1", "16:9");
  assert.equal(v1x1.state, "queued");
  assert.equal(v1x1.hasBundle, false);
  assert.equal(v1x1.hasClip, false);
});

test("decideSceneMode covers flag-off, clip mode, live ready, unverified fallback, check-env, check-code repair, clip_cap, buffering, and comments", () => {
  const checkedVariant = resolveSceneVariant(
    {
      index: 0,
      keyword: "Lantern",
      state: "checked",
      seconds: 4,
      frames: 120,
      sig: "sig-0",
      rev: 0,
      variantId: "v-0",
      bundleDigest: "dig-0"
    },
    "16:9",
    "16:9"
  );

  // 1. Flag off -> clip mode
  const flagOff = decideSceneMode({
    flagEnabled: false,
    projectMode: "live",
    variant: checkedVariant,
    environment: CHROME_MAC_UA,
    bundleLoaded: true
  });
  assert.equal(flagOff.mode, "clip");
  assert.equal(flagOff.reason, "flag-off");
  assert.equal(flagOff.isReady, false);

  // 2. Project mode === "clip" -> clip mode
  const projClip = decideSceneMode({
    flagEnabled: true,
    projectMode: "clip",
    variant: { ...checkedVariant, state: "drawn", hasClip: true },
    environment: CHROME_MAC_UA
  });
  assert.equal(projClip.mode, "clip");
  assert.equal(projClip.reason, "project-clip-mode");
  assert.equal(projClip.isReady, true);

  // 3. Live mode, verified environment, bundle loaded -> live ready & playable
  const liveReady = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: checkedVariant,
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    playerReady: true
  });
  assert.equal(liveReady.mode, "live");
  assert.equal(liveReady.reason, "ok");
  assert.equal(liveReady.isReady, true);
  assert.equal(liveReady.isPlayable, true);
  assert.equal(liveReady.tabClassName, "ready");
  assert.equal(liveReady.stageWait, null);

  // 4. Live mode with pending comment -> tab shows needs-update
  const liveCommented = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: checkedVariant,
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    playerReady: true,
    hasPendingComment: true
  });
  assert.equal(liveCommented.mode, "live");
  assert.equal(liveCommented.tabClassName, "needs-update");
  assert.equal(liveCommented.tabLabel, "Needs update");

  // 5. Live mode while buffering -> stageWait shows Buffering…
  const liveBuffering = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: checkedVariant,
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    playerReady: true,
    isBuffering: true
  });
  assert.equal(liveBuffering.mode, "live");
  assert.equal(liveBuffering.isPlayable, true);
  assert.deepEqual(liveBuffering.stageWait, { failed: false, title: "Buffering…" });

  // 6. Unverified environment (Safari) with no clip yet -> falls back to clip and requests clip
  const unverifiedNoClip = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: checkedVariant,
    environment: SAFARI_MAC_UA,
    bundleLoaded: false
  });
  assert.equal(unverifiedNoClip.mode, "clip");
  assert.equal(unverifiedNoClip.reason, "unverified-environment");
  assert.equal(unverifiedNoClip.needsClipRequest, true);
  assert.equal(unverifiedNoClip.isReady, false);
  assert.equal(unverifiedNoClip.stageWait?.title, "Drawing…");

  // 7. 429 clip_cap on clip request -> calm "Preview video is queued" state, never an error
  const clipCapState = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: checkedVariant,
    environment: SAFARI_MAC_UA,
    clipRequestStatus: "clip_cap"
  });
  assert.equal(clipCapState.mode, "clip");
  assert.equal(clipCapState.needsClipRequest, false);
  assert.equal(clipCapState.tabState, "updating");
  assert.equal(clipCapState.tabLabel, "Preview video is queued");
  assert.deepEqual(clipCapState.stageWait, { failed: false, title: "Preview video is queued…" });

  // 8. Check failure of kind "env" -> falls back to clip and requests clip
  const bundledVariant = { ...checkedVariant, state: "bundled" };
  const checkEnvFail = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: bundledVariant,
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    checkOutcome: { ok: false, kind: "env", error: "OOM" }
  });
  assert.equal(checkEnvFail.mode, "clip");
  assert.equal(checkEnvFail.reason, "check-env");
  assert.equal(checkEnvFail.needsClipRequest, true);

  // 9. Check failure of kind "code" -> reported for repair, tab shows "updating"
  const checkCodeFail = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: bundledVariant,
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    checkOutcome: { ok: false, kind: "code", error: "Non-deterministic frame 45" }
  });
  assert.equal(checkCodeFail.mode, "live");
  assert.equal(checkCodeFail.reason, "check-code-repair");
  assert.equal(checkCodeFail.tabState, "updating");
  assert.equal(checkCodeFail.tabClassName, "updating");
  assert.equal(checkCodeFail.tabLabel, "Updating");
  assert.deepEqual(checkCodeFail.stageWait, { failed: false, title: "Updating…" });

  // 10. Player gate fallback when clip already exists -> plays clip immediately
  const gateFallbackWithClip = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: { ...checkedVariant, state: "drawn", hasClip: true, clipVersion: "v1" },
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    playerDecision: { mode: "clip", reason: "gate-exceeded: lead 3.10s > ahead 2.13s" }
  });
  assert.equal(gateFallbackWithClip.mode, "clip");
  assert.match(gateFallbackWithClip.reason, /gate-exceeded/);
  assert.equal(gateFallbackWithClip.isReady, true);
  assert.equal(gateFallbackWithClip.isPlayable, true);
  assert.equal(gateFallbackWithClip.needsClipRequest, false);
});

test("CheckOnceTracker and ClipRequestTracker enforce the check-once and request-once rules per tuple", () => {
  const tracker = new CheckOnceTracker();

  // Only "bundled" variants with valid variantId, gen >= 1, and bundleDigest should be checked
  assert.equal(tracker.shouldCheck("v1", 1, "dig-1", "checked"), false);
  assert.equal(tracker.shouldCheck("v1", 1, "dig-1", "bundled"), true);

  // Begin marks in-flight and blocks concurrent duplicate
  assert.equal(tracker.begin("v1", 1, "dig-1"), true);
  assert.equal(tracker.hasInFlight("v1", 1, "dig-1"), true);
  assert.equal(tracker.shouldCheck("v1", 1, "dig-1", "bundled"), false);
  assert.equal(tracker.begin("v1", 1, "dig-1"), false);

  // Complete records outcome and permanently blocks re-checking the same (variantId, gen, bundleDigest)
  tracker.complete("v1", 1, "dig-1", { ok: true });
  assert.equal(tracker.hasInFlight("v1", 1, "dig-1"), false);
  assert.equal(tracker.hasCompleted("v1", 1, "dig-1"), true);
  assert.deepEqual(tracker.getOutcome("v1", 1, "dig-1"), { ok: true });
  assert.equal(tracker.shouldCheck("v1", 1, "dig-1", "bundled"), false);
  assert.equal(tracker.begin("v1", 1, "dig-1"), false);

  // A new generation (gen = 2, even with the same bundleDigest) or a new bundleDigest is allowed once
  assert.equal(tracker.shouldCheck("v1", 2, "dig-1", "bundled"), true);
  assert.equal(tracker.shouldCheck("v1", 1, "dig-2", "bundled"), true);

  // Transient failure clears in-flight so it can retry
  assert.equal(tracker.begin("v1", 2, "dig-1"), true);
  tracker.failTransient("v1", 2, "dig-1");
  assert.equal(tracker.shouldCheck("v1", 2, "dig-1", "bundled"), true);

  // ClipRequestTracker deduplicates per (variantId, bundleDigest)
  const clipTracker = new ClipRequestTracker();
  assert.equal(clipTracker.shouldRequest("v1", "dig-1", true), false, "never requests when clip already exists");
  assert.equal(clipTracker.shouldRequest("v1", "dig-1", false), true);
  assert.equal(clipTracker.begin("v1", "dig-1"), true);
  assert.equal(clipTracker.shouldRequest("v1", "dig-1", false), false);
  clipTracker.complete("v1", "dig-1", "clip_cap");
  assert.equal(clipTracker.getState("v1", "dig-1"), "clip_cap");
  assert.equal(clipTracker.shouldRequest("v1", "dig-1", false), false);
});

test("decideSceneMode: a pre-drawing scene shows 'Preparing this scene… N%', stays playable so the film can move into it, and is not buffering", () => {
  const variant = {
    index: 1, keyword: "k", aspect: "16:9", state: "checked", sig: "s", rev: 1, gen: 1, frames: 150, seconds: 5,
    variantId: "v1", bundleDigest: "dig", hasBundle: true, hasClip: false, clipVersion: null
  };
  const base = { flagEnabled: true, projectMode: "live", variant, environment: CHROME_MAC_UA, bundleLoaded: true, playerReady: true, checkOutcome: { ok: true } };
  const preparing = decideSceneMode({ ...base, playerDecision: { mode: "live", reason: "predraw", progress: 0.42 } });
  assert.equal(preparing.mode, "live");
  assert.equal(preparing.isPreparing, true);
  assert.equal(preparing.preparingProgress, 0.42);
  assert.equal(preparing.isPlayable, true);
  assert.equal(preparing.isReady, true);
  assert.equal(preparing.tabLabel, "Preparing");
  assert.equal(preparing.tabState, "updating");
  assert.equal(preparing.stageWait.title, "Preparing this scene… 42%");
  assert.equal(decideSceneMode({ ...base, playerDecision: { mode: "live", reason: "predraw", progress: 0 } }).stageWait.title, "Preparing this scene… 0%");

  // once the frames are ready the progress is gone: it plays, no wait overlay
  const playing = decideSceneMode({ ...base, playerDecision: { mode: "live", reason: "ok", variant: "predraw" } });
  assert.equal(playing.isPreparing, undefined);
  assert.equal(playing.stageWait, null);

  // a scene that fell back looks exactly as the clip fallback does today
  const fallen = decideSceneMode({ ...base, variant: { ...variant, hasClip: true }, playerDecision: { mode: "clip", reason: "predraw-too-slow: wait 25.1s > 20s" } });
  assert.equal(fallen.mode, "clip");
  assert.equal(fallen.tabLabel, "Drawn");
  assert.equal(fallen.reason, "predraw-too-slow: wait 25.1s > 20s");
});
