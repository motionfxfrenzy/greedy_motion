import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIP_AFTER_UNPLAYABLE_MS,
  CheckOnceTracker,
  ClipRequestTracker,
  canTriggerClipRequestForReason,
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

test("decideSceneMode: a drawing scene shows 'Drawing scene 2… 42 %', stays playable so the film can move into it, and exposes statusText", () => {
  const variant = {
    index: 1, keyword: "k", aspect: "16:9", state: "checked", sig: "s", rev: 1, gen: 1, frames: 150, seconds: 5,
    variantId: "v1", bundleDigest: "dig", hasBundle: true, hasClip: false, clipVersion: null
  };
  const base = { flagEnabled: true, projectMode: "live", variant, environment: CHROME_MAC_UA, bundleLoaded: true, playerReady: true, checkOutcome: { ok: true } };
  const preparing = decideSceneMode({ ...base, playerDecision: { mode: "live", reason: "predraw", progress: 0.42 } });
  assert.equal(preparing.mode, "live");
  assert.equal(preparing.playerState, "drawing");
  assert.equal(preparing.isPreparing, true);
  assert.equal(preparing.preparingProgress, 0.42);
  assert.equal(preparing.isPlayable, true);
  assert.equal(preparing.isReady, true);
  assert.equal(preparing.tabLabel, "Preparing");
  assert.equal(preparing.tabState, "updating");
  assert.equal(preparing.stageWait.title, "Drawing scene 2… 42 %");
  assert.equal(preparing.statusText, "Drawing scene 2… 42 %");
  assert.equal(decideSceneMode({ ...base, playerDecision: { mode: "live", reason: "predraw", progress: 0 } }).stageWait.title, "Drawing scene 2… 0 %");

  // once the frames are ready the progress is gone: it plays, no wait overlay
  const playing = decideSceneMode({ ...base, playerDecision: { mode: "live", reason: "ok", variant: "predraw" } });
  assert.equal(playing.isPreparing, undefined);
  assert.equal(playing.stageWait, null);

  // background quality job status text is surfaced on the status line without blocking playback
  const raising = decideSceneMode({
    ...base,
    playerDecision: { mode: "live", reason: "ok", state: "playing" },
    qualityJobText: "Raising preview quality… 120 / 450 frames"
  });
  assert.equal(raising.statusText, "Raising preview quality… 120 / 450 frames");
  assert.equal(raising.stageWait, null);

  const lowering = decideSceneMode({
    ...base,
    playerDecision: { mode: "live", reason: "ok", state: "playing" },
    qualityJobText: "Lowering preview quality… 60 / 450 frames"
  });
  assert.equal(lowering.statusText, "Lowering preview quality… 60 / 450 frames");
  assert.equal(lowering.stageWait, null);

  // a scene whose worker became unhealthy falls back to the clip
  const fallen = decideSceneMode({ ...base, variant: { ...variant, hasClip: true }, playerDecision: { mode: "clip", reason: "worker-unhealthy" } });
  assert.equal(fallen.mode, "clip");
  assert.equal(fallen.tabLabel, "Rendered");
  assert.equal(fallen.reason, "worker-unhealthy");

  // a scene marked playback: "clip" and drawMsPerFrame: 185 by the server (while bundled or rendering)
  const slowBundledVar = resolveSceneVariant(
    {
      index: 1,
      keyword: "Crayon forest",
      state: "bundled",
      seconds: 4,
      frames: 120,
      sig: "sig-slow",
      rev: 0,
      variantId: "var-slow",
      bundleDigest: "dig-slow",
      playback: "clip",
      drawMsPerFrame: 185
    },
    "16:9",
    "16:9"
  );
  assert.equal(slowBundledVar.playbackClip, true);
  assert.equal(slowBundledVar.hasBundle, false);
  assert.equal(slowBundledVar.drawMsPerFrame, 185);
  const slowBundledMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: slowBundledVar,
    environment: CHROME_MAC_UA
  });
  assert.equal(slowBundledMode.mode, "clip");
  assert.equal(slowBundledMode.reason, "slow-draw");
  assert.equal(slowBundledMode.needsClipRequest, false, "server already queued render on /check; do not send clip-request");
  assert.equal(slowBundledMode.isPlayable, false);
  assert.equal(
    slowBundledMode.stageWait?.title,
    "Scene 2 is being prepared as a video for smooth playback"
  );

  // immediate client demotion right after POST .../check returns { state: "bundled", playback: "clip" } (before next /plates poll)
  const prePollVar = resolveSceneVariant(
    {
      index: 1,
      keyword: "Crayon forest",
      state: "bundled",
      seconds: 4,
      frames: 120,
      sig: "sig-slow",
      rev: 0,
      variantId: "var-slow",
      bundleDigest: "dig-slow"
    },
    "16:9",
    "16:9"
  );
  const immediateDemotedMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: prePollVar,
    environment: CHROME_MAC_UA,
    checkOutcome: { ok: true, drawMs: { medianMs: 185, p90Ms: 210 } },
    forcedClipReason: "slow-draw"
  });
  assert.equal(immediateDemotedMode.mode, "clip");
  assert.equal(immediateDemotedMode.reason, "slow-draw");
  assert.equal(immediateDemotedMode.needsClipRequest, false, "must not send clip-request when demoted by /check response");
  assert.equal(
    immediateDemotedMode.stageWait?.title,
    "Scene 2 is being prepared as a video for smooth playback"
  );

  const slowUnreadyVar = resolveSceneVariant(
    {
      index: 1,
      keyword: "Crayon forest",
      state: "rendering",
      seconds: 4,
      frames: 120,
      sig: "sig-slow",
      rev: 0,
      variantId: "var-slow",
      bundleDigest: "dig-slow",
      playback: "clip",
      drawMsPerFrame: 185
    },
    "16:9",
    "16:9"
  );
  assert.equal(slowUnreadyVar.playbackClip, true);
  assert.equal(slowUnreadyVar.hasBundle, false);
  assert.equal(slowUnreadyVar.drawMsPerFrame, 185);
  const slowUnreadyMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: slowUnreadyVar,
    environment: CHROME_MAC_UA
  });
  assert.equal(slowUnreadyMode.mode, "clip");
  assert.equal(slowUnreadyMode.reason, "slow-draw");
  assert.equal(slowUnreadyMode.needsClipRequest, false);
  assert.equal(slowUnreadyMode.isPlayable, false);
  assert.equal(
    slowUnreadyMode.stageWait?.title,
    "Scene 2 is being prepared as a video for smooth playback"
  );

  // once the clip is drawn on the worker, the slow-draw scene plays from the clip
  const slowDrawnVar = resolveSceneVariant(
    {
      index: 1,
      keyword: "Crayon forest",
      state: "drawn",
      seconds: 4,
      frames: 120,
      sig: "sig-slow",
      rev: 0,
      variantId: "var-slow",
      bundleDigest: "dig-slow",
      playback: "clip",
      drawMsPerFrame: 185,
      variants: {
        "16:9": {
          state: "drawn",
          sig: "sig-slow",
          v: "clipv1",
          variantId: "var-slow",
          bundleDigest: "dig-slow",
          playback: "clip",
          drawMsPerFrame: 185
        }
      }
    },
    "16:9",
    "16:9"
  );
  const slowDrawnMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: slowDrawnVar,
    environment: CHROME_MAC_UA
  });
  assert.equal(slowDrawnMode.mode, "clip");
  assert.equal(slowDrawnMode.reason, "slow-draw");
  assert.equal(slowDrawnMode.isPlayable, true);
  assert.equal(slowDrawnMode.isReady, true);
  assert.equal(slowDrawnMode.stageWait, null);

  // If state becomes 'drawn' while v is still null on a demoted clip scene, it waits until v is set,
  // and once v is set (even with forcedClipReason and playerDecision from playback demotion still present),
  // it immediately becomes clip-ready with stageWait cleared:
  const slowDrawnNoVVar = resolveSceneVariant(
    {
      index: 1,
      keyword: "Crayon forest",
      state: "drawn",
      seconds: 5,
      frames: 150,
      sig: "sig-slow",
      rev: 0,
      variantId: "var-slow",
      bundleDigest: "dig-slow",
      playback: "clip",
      drawMsPerFrame: 185,
      variants: {
        "16:9": {
          state: "drawn",
          sig: "sig-slow",
          v: null,
          variantId: "var-slow",
          bundleDigest: "dig-slow",
          playback: "clip",
          drawMsPerFrame: 185
        }
      }
    },
    "16:9",
    "16:9"
  );
  assert.equal(slowDrawnNoVVar.hasClip, false);
  const slowDrawnNoVMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: slowDrawnNoVVar,
    environment: CHROME_MAC_UA,
    forcedClipReason: "slow-draw",
    playerDecision: { mode: "clip", state: "clip", reason: "slow-draw" }
  });
  assert.equal(slowDrawnNoVMode.isPlayable, false);
  assert.equal(
    slowDrawnNoVMode.stageWait?.title,
    "Scene 2 is being prepared as a video for smooth playback"
  );

  const slowDrawnWithVMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: slowDrawnVar,
    environment: CHROME_MAC_UA,
    forcedClipReason: "slow-draw",
    playerDecision: { mode: "clip", state: "clip", reason: "slow-draw" }
  });
  assert.equal(slowDrawnWithVMode.mode, "clip");
  assert.equal(slowDrawnWithVMode.isReady, true);
  assert.equal(slowDrawnWithVMode.isPlayable, true);
  assert.equal(slowDrawnWithVMode.stageWait, null);
});

test("Browser-first decision order: hasClip with no browser verdict runs check/measure instead of clip-only, switches to live on ok verdict, and never requests clips on watchdog timeouts or drawn/checked bundles", () => {
  assert.equal(CLIP_AFTER_UNPLAYABLE_MS, 180_000);

  // Drawn scene with a clip AND a bundle, but no server playback:'clip' and no browser verdict yet (e.g. S1, S4, S6 in 324093f5…)
  const drawnWithBundle = resolveSceneVariant(
    {
      index: 3,
      keyword: "Fast scene 4",
      state: "drawn",
      seconds: 3,
      frames: 90,
      sig: "sig-s4",
      rev: 0,
      v: "clipv1",
      variantId: "var-s4",
      bundleDigest: "dig-s4",
      live: false,
      variants: {
        "16:9": {
          state: "drawn",
          sig: "sig-s4",
          v: "clipv1",
          variantId: "var-s4",
          bundleDigest: "dig-s4",
          live: false
        }
      }
    },
    "16:9",
    "16:9"
  );
  assert.equal(drawnWithBundle.hasBundle, true);
  assert.equal(drawnWithBundle.hasClip, true);
  assert.equal(drawnWithBundle.playbackClip, false, "drawn variant with bundle and no server playback:'clip' is not forced to clip");

  // 1. Before bundle load / verdict: must lead to a browser check, NOT clip-only!
  const beforeVerdict = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: drawnWithBundle,
    environment: CHROME_MAC_UA,
    bundleLoaded: false
  });
  assert.equal(beforeVerdict.mode, "live", "must not choose clip-only when bundle exists and no browser verdict");
  assert.notEqual(beforeVerdict.reason, "clip-only");
  assert.equal(beforeVerdict.needsBundleFetch, true);
  assert.equal(beforeVerdict.needsCheck, true);
  assert.equal(beforeVerdict.needsClipRequest, false);
  assert.equal(beforeVerdict.stageWait, null, "existing clip covers stage while live check runs");

  // 2. CheckOnceTracker allows checking a 'drawn' variant that has no browser verdict yet
  const tracker = new CheckOnceTracker();
  assert.equal(tracker.shouldCheck("var-s4", 1, "dig-s4", "drawn"), true);

  // 3. Once browser check verdict is ok and player is ready -> plays live!
  const afterVerdictOk = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: drawnWithBundle,
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    playerReady: true,
    checkOutcome: { ok: true, drawMs: { medianMs: 16, p90Ms: 18 } }
  });
  assert.equal(afterVerdictOk.mode, "live");
  assert.equal(afterVerdictOk.reason, "ok");
  assert.equal(afterVerdictOk.isPlayable, true);
  assert.equal(afterVerdictOk.needsClipRequest, false);

  // 4. Inconclusive check outcome (from hidden tab) does not demote to clip or request a clip
  const inconclusiveMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: { ...drawnWithBundle, state: "bundled", hasClip: false, clipVersion: null },
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    checkOutcome: { ok: false, kind: "inconclusive", inconclusive: true, reason: "document-hidden" }
  });
  assert.equal(inconclusiveMode.mode, "live");
  assert.equal(inconclusiveMode.needsCheck, true);
  assert.equal(inconclusiveMode.needsClipRequest, false);

  // 5. Watchdog timeout error in checkOutcome or reason must never trigger a client clip request
  const watchdogEnvMode = decideSceneMode({
    flagEnabled: true,
    projectMode: "live",
    variant: { ...drawnWithBundle, state: "bundled", hasClip: false, clipVersion: null },
    environment: CHROME_MAC_UA,
    bundleLoaded: true,
    checkOutcome: { ok: false, kind: "env", error: "Watchdog timeout (frame-timeout) after 2000ms" }
  });
  assert.equal(watchdogEnvMode.needsClipRequest, false, "watchdog timeout must not request a clip from client");
  assert.equal(canTriggerClipRequestForReason("check-env", "Watchdog timeout (init-timeout) after 2000ms"), false);
  assert.equal(canTriggerClipRequestForReason("worker-unhealthy:frame-timeout"), false);
  assert.equal(canTriggerClipRequestForReason("clip-only"), false);
  assert.equal(canTriggerClipRequestForReason("slow-draw"), false);
  assert.equal(canTriggerClipRequestForReason("unplayable-timeout"), true);
  assert.equal(canTriggerClipRequestForReason("jitter"), true);
  assert.equal(canTriggerClipRequestForReason("code-permanent"), true);
  assert.equal(canTriggerClipRequestForReason("device-env", "WebGL context creation failed"), true);
});
