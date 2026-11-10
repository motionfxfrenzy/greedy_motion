"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { outputUrl, plateClipUrl } from "../lib/api";
import {
  CLIP_AFTER_UNPLAYABLE_MS,
  CheckOnceTracker,
  ClipRequestTracker,
  DEFAULT_PLAYBACK_RENDER_MODE,
  SCENE_PLAYABLE_TIMEOUT_MS,
  canTriggerClipRequestForReason,
  createFilmPlayer,
  decideSceneMode,
  environmentStatus,
  fetchBundle,
  getActiveBrowserTransportCount,
  getDraftTargetVerticesPerFrame,
  getLiveTraceLog,
  isDocumentHidden,
  isWatchdogTimeoutError,
  reportCheck,
  requestClip,
  resolveCacheBudgetBytes,
  resolveDraftCacheBudgetBytes,
  resolveSceneVariant,
  stepPlayableTimeout,
  supportsWorkerHost,
  type AspectRatio,
  type FetchedBundle,
  type FilmPlayer,
  type FilmSceneSpec,
  type FrameStoreStatus,
  type LivePlateScene,
  type LiveTraceEntry,
  type PlayableTimeoutState,
  type PlaybackRenderMode,
  type PlayerDecision,
  type PreviewQuality,
  type QualityJobProgress,
  type SceneModeResolution,
  type StillUpgradeState,
  type WebAudioFilmTimeline,
  withBackendAuth
} from "../lib/live";

export { CLIP_AFTER_UNPLAYABLE_MS };
import { createClient } from "../utils/supabase/client";
import {
  AnimationPrep,
  BUFFERING_SHOW_DELAY_MS,
  buildStagePrepProps,
  recordBufferingSample,
  resolveStagePrepOverlay,
  type BufferingRateSample,
  type SceneProgressResult
} from "./animation-workspace";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Live-scene calls go through the app's backend proxy like every other API call, so they carry the user's token (apiFetch in
// lib/api.ts does the same). Without it every bundle, check and clip request is refused with 401 wherever auth is on.
const LIVE_API = {
  baseUrl: "/api/backend",
  fetch: withBackendAuth(
    async () => (await createClient().auth.getSession()).data.session?.access_token,
    undefined,
    () => {
      if (typeof window !== "undefined") {
        void createClient().auth.signOut().finally(() => {
          window.location.href = "/auth?error=invalid_email";
        });
      }
    }
  )
};

export type PlateLiveTelemetry = {
  framesRendered: number;
  distinctFrames: number;
  lateFrames: number;
  achievedFps: number;
  elapsedPlaySeconds: number;
  checksRun: number;
  renderMode?: PlaybackRenderMode;
  stillUpgradeState?: StillUpgradeState;
  draftTargetVerticesPerFrame?: number;
  cacheBytes?: number;
  cacheBudget?: number;
  activeWorkers?: number;
  bufferingPauses?: number;
  traceLog?: readonly (LiveTraceEntry | Record<string, unknown>)[];
  uniquePresentedFrames?: number;
  totalBlits?: number;
  repeatedBlits?: number;
  perSceneUnique?: number[];
  naturalEndCleanupTriggered?: boolean;
  audioDriftSampleCount?: number;
  p50AudioDriftMs?: number;
  p95AudioDriftMs?: number;
  maxAudioDriftMs?: number;
  decisions: {
    index: number;
    mode: "live" | "clip";
    reason: string;
    state: string;
    rev: number;
    gen: number;
    bundleDigest: string | null;
    renderMode?: PlaybackRenderMode;
    stillUpgradeState?: StillUpgradeState;
  }[];
};

export type PlateLiveOptions = {
  flagOverride?: boolean;
  environment?: string;
  initialTime?: number;
  initialPlaying?: boolean;
  initialRenderMode?: PlaybackRenderMode;
  draftTargetVerticesPerFrame?: number;
  freezeClockAt?: number;
  forceBuffering?: boolean;
  autoDraw?: boolean;
  unplayableTimeoutMs?: number;
  unplayableTickMs?: number;
  onTriggerClipRequest?: (info: {
    variantId: string;
    gen: number;
    bundleDigest: string | null;
    reason: string;
  }) => void;
  onDecisionsChange?: (
    decisions: { index: number; mode: "live" | "clip"; reason: string; state: string }[]
  ) => void;
};

export interface PlateLiveStageProps {
  projectId: string;
  look?: string | null;
  scenes: readonly LivePlateScene[];
  referenceFrames?: readonly (string | null | undefined)[];
  perSceneProgress?: readonly (SceneProgressResult | undefined)[];
  viewAspect: AspectRatio;
  primaryAspect: AspectRatio;
  isViewAspectDrawn: boolean;
  isViewAspectDrawing: boolean;
  prep?: "sound" | "scenes" | "motion" | null;
  current: number;
  playing: boolean;
  time: number;
  durations: readonly number[];
  starts: readonly number[];
  total: number;
  voiceOn: boolean;
  musicOn: boolean;
  master: number;
  muted: boolean;
  musicSrc: string | null;
  pendingCommentScenes: ReadonlySet<number>;
  videos: MutableRefObject<(HTMLVideoElement | null)[]>;
  voices: MutableRefObject<(HTMLAudioElement | null)[]>;
  musicAudio: MutableRefObject<HTMLAudioElement | null>;
  sfxAudios: MutableRefObject<Record<string, HTMLAudioElement | null>>;
  wantPlay: MutableRefObject<boolean>;
  rateFor: (index: number, el: HTMLVideoElement | null) => number;
  onLoadedVideo: (index: number) => void;
  onVideoEnded: (index: number) => void;
  onAdvanceScene: (index: number) => void;
  onSetPlaying: (playing: boolean) => void;
  onSetTime: (time: number) => void;
  playSceneSfx: (index: number, realOffset: number) => void;
  tickSceneSfx?: (index: number, localOffset: number, state: { playing: boolean; buffering: boolean }) => void;
  clearSfxTimers: () => void;
  onStatusRefresh: () => void;
  onResolutionsChange?: (resolutions: SceneModeResolution[]) => void;
  previewQuality?: PreviewQuality;
  renderMode?: PlaybackRenderMode;
  onQualityJobProgress?: (progress: QualityJobProgress) => void;
  onStoreStatusChange?: (status: FrameStoreStatus) => void;
  audioTimeline?: WebAudioFilmTimeline<any> | null;
  qualityJobText?: string | null;
  storeDisabledReason?: string | null;
  liveOptions?: PlateLiveOptions;
  liveStageHandleRef?: MutableRefObject<{
    getPresentedFrames: () => number;
    getMediaTimeSec: () => number;
    isBuffering: () => boolean;
  } | null>;
  onUpdateStale?: () => void;
  updatingStale?: boolean;
  onRetryScene?: (sceneIndex: number) => void;
  retryingSceneIndex?: number | null;
  filmToast?: { active: boolean; sceneIndex: number | null } | null;
}

function bundleCacheKeys(variantId: string, rev: number, bundleDigest?: string | null): { exact: string; revLatest: string } {
  return {
    exact: `${variantId}:r${rev}:${bundleDigest ?? "latest"}`,
    revLatest: `${variantId}:r${rev}:latest`
  };
}

function getLoadedBundle(
  bundles: Map<string, FetchedBundle>,
  v: { variantId?: string; rev: number; bundleDigest?: string | null }
): FetchedBundle | undefined {
  if (!v.variantId) return undefined;
  const keys = bundleCacheKeys(v.variantId, v.rev, v.bundleDigest);
  const exact = bundles.get(keys.exact);
  if (exact) return exact;
  if (v.bundleDigest) return undefined;
  return bundles.get(keys.revLatest);
}

/**
 * Live scene stage for `PlatePreview` (Phase 3c).
 * Mounts one `createFilmPlayer` per `(projectId, viewAspect)`, runs the fenced browser check once per
 * `(variantId, gen, bundleDigest)`, keeps audio as the master clock, and falls back seamlessly per scene
 * to the worker-drawn MP4 clip when a scene cannot play live.
 */
export function PlateLiveStage({
  projectId,
  look,
  scenes,
  referenceFrames,
  perSceneProgress,
  viewAspect,
  primaryAspect,
  isViewAspectDrawn,
  isViewAspectDrawing,
  prep,
  current,
  playing,
  time,
  durations,
  starts,
  total: _total,
  voiceOn,
  musicOn,
  master,
  muted,
  musicSrc,
  pendingCommentScenes,
  videos,
  voices,
  musicAudio,
  sfxAudios,
  wantPlay,
  rateFor,
  onLoadedVideo,
  onVideoEnded,
  onAdvanceScene,
  onSetPlaying,
  onSetTime,
  playSceneSfx,
  tickSceneSfx,
  clearSfxTimers,
  onStatusRefresh,
  onResolutionsChange,
  previewQuality,
  renderMode = DEFAULT_PLAYBACK_RENDER_MODE,
  onQualityJobProgress,
  onStoreStatusChange,
  audioTimeline,
  qualityJobText,
  storeDisabledReason,
  liveOptions,
  liveStageHandleRef,
  onUpdateStale,
  updatingStale,
  onRetryScene,
  retryingSceneIndex = null,
  filmToast = null
}: PlateLiveStageProps) {
  const hostContainerRef = useRef<HTMLDivElement | null>(null);
  const filmPlayerRef = useRef<FilmPlayer | null>(null);
  const mountPromiseRef = useRef<Promise<void> | null>(null);
  const mountedSpecsRef = useRef<string[]>([]);
  const mountedRef = useRef<boolean>(true);

  const bundlesRef = useRef<Map<string, FetchedBundle>>(new Map());
  const failedBundleKeysRef = useRef<Set<string>>(new Set());
  const fetchingBundlesRef = useRef<Set<string>>(new Set());
  const checkTrackerRef = useRef<CheckOnceTracker>(new CheckOnceTracker());
  const clipTrackerRef = useRef<ClipRequestTracker>(new ClipRequestTracker());
  const forcedClipRef = useRef<Map<string, string>>(new Map());
  const playerDecisionsRef = useRef<Map<number, PlayerDecision>>(new Map());
  const playerReadyRef = useRef<Set<number>>(new Set());
  const bufferingScenesRef = useRef<Set<number>>(new Set());
  const lastSceneIdentityRef = useRef<Map<number, string>>(new Map());
  const checksRunRef = useRef<number>(0);
  const stillFailedRef = useRef<Set<number>>(new Set());
  const playableTimeoutRef = useRef<Map<string, PlayableTimeoutState>>(new Map());

  const [revisionTick, setRevisionTick] = useState(0);
  const bump = () => {
    if (mountedRef.current) {
      setRevisionTick((n) => n + 1);
    }
  };

  const clockTimeRef = useRef<number>(time);
  const playingRef = useRef<boolean>(playing);
  const currentRef = useRef<number>(current);
  const audioTimelinePropRef = useRef(audioTimeline);
  const playSceneSfxRef = useRef(playSceneSfx);
  const tickSceneSfxRef = useRef(tickSceneSfx);
  const onSetTimeRef = useRef(onSetTime);
  const onAdvanceSceneRef = useRef(onAdvanceScene);
  const lastCheckedFrameRef = useRef<number>(-1);
  clockTimeRef.current = time;
  playingRef.current = playing;
  currentRef.current = current;
  audioTimelinePropRef.current = audioTimeline;
  playSceneSfxRef.current = playSceneSfx;
  tickSceneSfxRef.current = tickSceneSfx;
  onSetTimeRef.current = onSetTime;
  onAdvanceSceneRef.current = onAdvanceScene;

  if (liveStageHandleRef) {
    liveStageHandleRef.current = {
      getPresentedFrames: () => {
        const fp = filmPlayerRef.current;
        if (!fp) return 0;
        return fp.scenes[current]?.presentedFrames ?? fp.presentedFrames;
      },
      getMediaTimeSec: () => {
        const fp = filmPlayerRef.current;
        const activePlayer = fp?.scenes[current];
        const srcFrame = activePlayer?.lastPresentedSourceFrame ?? null;
        if (srcFrame !== null) {
          return srcFrame / (activePlayer?.meta.fps || 30);
        }
        return Math.max(0, clockTimeRef.current - (starts[current] ?? 0));
      },
      isBuffering: () => {
        const fp = filmPlayerRef.current;
        const activePlayer = fp?.scenes[current];
        return Boolean(
          activePlayer?.isBufferingNow ||
            activePlayer?.isPreparing ||
            bufferingScenesRef.current.has(current) ||
            liveOptions?.forceBuffering
        );
      }
    };
  }

  const telemetryRef = useRef<{
    framesRendered: number;
    distinctFramesSet: Set<number>;
    lateFrames: number;
    playStartMs: number | null;
    accumulatedPlayMs: number;
    audioDriftSamplesMs: number[];
    naturalEndCleanupTriggered: boolean;
  }>({
    framesRendered: 0,
    distinctFramesSet: new Set(),
    lateFrames: 0,
    playStartMs: null,
    accumulatedPlayMs: 0,
    audioDriftSamplesMs: [],
    naturalEndCleanupTriggered: false
  });

  const resolvedVariants = useMemo(
    () => scenes.map((s) => resolveSceneVariant(s, viewAspect, primaryAspect)),
    [scenes, viewAspect, primaryAspect]
  );
  const resolvedVariantsRef = useRef(resolvedVariants);
  resolvedVariantsRef.current = resolvedVariants;

  const resolutions = useMemo(() => {
    void revisionTick;
    // Prune cached decisions/ready state for scenes beyond current scene count or whose revision identity changed
    for (const k of [...lastSceneIdentityRef.current.keys()]) {
      if (k >= resolvedVariants.length) {
        lastSceneIdentityRef.current.delete(k);
        playerDecisionsRef.current.delete(k);
        playerReadyRef.current.delete(k);
        bufferingScenesRef.current.delete(k);
      }
    }
    return resolvedVariants.map((v, idx) => {
      const identityKey = `${v.variantId ?? "none"}:${v.sig}:${v.gen}:${v.rev}:${v.bundleDigest ?? "none"}:${v.look ?? look ?? ""}:${v.stale ? "stale" : "ok"}`;
      const prevIdentity = lastSceneIdentityRef.current.get(idx);
      if (prevIdentity !== undefined && prevIdentity !== identityKey) {
        playerDecisionsRef.current.delete(idx);
        playerReadyRef.current.delete(idx);
        bufferingScenesRef.current.delete(idx);
      }
      lastSceneIdentityRef.current.set(idx, identityKey);

      const loadedBundle = v.stale ? undefined : getLoadedBundle(bundlesRef.current, v);
      const effectiveDigest = loadedBundle?.bundleDigest ?? v.bundleDigest ?? null;
      const effectiveGen = Math.max(loadedBundle?.gen ?? 1, v.gen);
      const checkOutcome =
        v.variantId && effectiveDigest
          ? checkTrackerRef.current.getOutcome(v.variantId, effectiveGen, effectiveDigest) ?? null
          : null;
      const clipStatus =
        clipTrackerRef.current.getState(v.variantId, `${effectiveGen}:${effectiveDigest ?? "default"}`) ??
        clipTrackerRef.current.getState(v.variantId, effectiveDigest);
      const forcedReason =
        (v.variantId && effectiveDigest
          ? forcedClipRef.current.get(`${v.variantId}:g${effectiveGen}:${effectiveDigest}`)
          : undefined) ?? null;
      const playerDecision = playerDecisionsRef.current.get(idx) ?? null;
      const isBuffering =
        Boolean(liveOptions?.forceBuffering && idx === current) || bufferingScenesRef.current.has(idx);

      return decideSceneMode({
        flagEnabled: liveOptions?.flagOverride ?? true,
        projectMode: "live",
        variant: {
          ...v,
          bundleDigest: effectiveDigest,
          gen: effectiveGen
        },
        environment: liveOptions?.environment,
        bundleLoaded: Boolean(loadedBundle),
        playerReady: playerReadyRef.current.has(idx),
        playerDecision,
        checkOutcome,
        forcedClipReason: forcedReason,
        clipRequestStatus: clipStatus,
        isBuffering,
        hasPendingComment: pendingCommentScenes.has(idx),
        qualityJobText,
        storeDisabledReason,
        renderMode,
        stillUpgradeState: playerDecision?.stillUpgradeState
      });
    });
  }, [
    resolvedVariants,
    revisionTick,
    liveOptions?.flagOverride,
    liveOptions?.environment,
    liveOptions?.forceBuffering,
    current,
    pendingCommentScenes,
    qualityJobText,
    storeDisabledReason,
    renderMode
  ]);

  useEffect(() => {
    onResolutionsChange?.(resolutions);
    if (liveOptions?.onDecisionsChange) {
      liveOptions.onDecisionsChange(
        resolutions.map((r, index) => ({
          index,
          mode: r.mode,
          reason: r.reason,
          state: r.tabState
        }))
      );
    }
    if (typeof window !== "undefined") {
      const t = telemetryRef.current;
      const elapsedSec =
        (t.accumulatedPlayMs + (t.playStartMs !== null ? performance.now() - t.playStartMs : 0)) / 1000;
      const fps = elapsedSec > 0.1 ? Math.round((t.framesRendered / elapsedSec) * 10) / 10 : 0;
      const fp = filmPlayerRef.current;
      const pres = fp?.presentedSummary() ?? {
        uniquePresentedFrames: 0,
        totalBlits: 0,
        repeatedBlits: 0,
        perSceneUnique: []
      };
      const sortedDrifts = [...t.audioDriftSamplesMs].sort((a, b) => a - b);
      const p50Drift =
        sortedDrifts.length > 0 ? sortedDrifts[sortedDrifts.length >> 1]! : 0;
      const p95Drift =
        sortedDrifts.length > 0
          ? sortedDrifts[Math.min(sortedDrifts.length - 1, Math.ceil(sortedDrifts.length * 0.95) - 1)]!
          : 0;
      const maxDrift = sortedDrifts.length > 0 ? sortedDrifts[sortedDrifts.length - 1]! : 0;
      const win = window as unknown as { __plateLiveTelemetry?: PlateLiveTelemetry };
      win.__plateLiveTelemetry = {
        framesRendered: t.framesRendered,
        distinctFrames: t.distinctFramesSet.size,
        lateFrames: t.lateFrames,
        achievedFps: fps,
        elapsedPlaySeconds: Math.round(elapsedSec * 100) / 100,
        checksRun: checksRunRef.current,
        renderMode: fp?.renderMode ?? renderMode,
        stillUpgradeState: fp?.stillUpgradeState ?? resolutions[current]?.stillUpgradeState ?? "idle",
        draftTargetVerticesPerFrame: fp?.draftTargetVerticesPerFrame ?? getDraftTargetVerticesPerFrame(),
        cacheBytes: fp?.cache.bytes ?? 0,
        cacheBudget: fp?.cache.budget ?? 0,
        activeWorkers: getActiveBrowserTransportCount(),
        bufferingPauses: fp?.bufferingPauses ?? 0,
        traceLog: getLiveTraceLog(),
        uniquePresentedFrames: pres.uniquePresentedFrames,
        totalBlits: pres.totalBlits,
        repeatedBlits: pres.repeatedBlits,
        perSceneUnique: pres.perSceneUnique,
        naturalEndCleanupTriggered: t.naturalEndCleanupTriggered,
        audioDriftSampleCount: sortedDrifts.length,
        p50AudioDriftMs: p50Drift,
        p95AudioDriftMs: p95Drift,
        maxAudioDriftMs: maxDrift,
        decisions: resolutions.map((r, i) => ({
          index: i,
          mode: r.mode,
          reason: r.reason,
          state: r.tabState,
          rev: resolvedVariants[i]?.rev ?? 0,
          gen: resolvedVariants[i]?.gen ?? 1,
          bundleDigest: resolvedVariants[i]?.bundleDigest ?? null,
          renderMode: r.renderMode,
          stillUpgradeState: r.stillUpgradeState
        }))
      };
    }
  }, [resolutions, resolvedVariants, onResolutionsChange, liveOptions, renderMode, current]);

  // Clean up FilmPlayer on unmount, project change, or aspect change.
  // Note (Requirement 6): when no browser page is open, nothing in the browser can check a `bundled` scene;
  // that case is handled by the backend reconciler's server-side CHECK_GRACE fallback to clip rendering.
  useEffect(() => {
    mountedRef.current = true;
    const mountedSpecs = mountedSpecsRef;
    const playerDecisions = playerDecisionsRef.current;
    const playerReady = playerReadyRef.current;
    const bufferingScenes = bufferingScenesRef.current;
    const fetchingBundles = fetchingBundlesRef.current;
    return () => {
      mountedRef.current = false;
      if (filmPlayerRef.current) {
        filmPlayerRef.current.destroy();
        filmPlayerRef.current = null;
      }
      mountPromiseRef.current = null;
      mountedSpecs.current = [];
      playerDecisions.clear();
      playerReady.clear();
      bufferingScenes.clear();
      fetchingBundles.clear();
      playableTimeoutRef.current.clear();
    };
  }, [projectId, viewAspect]);

  const triggerClipRequest = async (
    variantId: string,
    bundleDigest: string | null | undefined,
    hasClip: boolean,
    reason: string,
    gen = 1
  ) => {
    if (!canTriggerClipRequestForReason(reason)) return;
    const trackerDigestKey = `${gen}:${bundleDigest ?? "default"}`;
    if (!clipTrackerRef.current.shouldRequest(variantId, trackerDigestKey, hasClip)) return;
    if (!clipTrackerRef.current.begin(variantId, trackerDigestKey)) return;
    liveOptions?.onTriggerClipRequest?.({
      variantId,
      gen,
      bundleDigest: bundleDigest ?? null,
      reason
    });
    const res = await requestClip(projectId, variantId, LIVE_API);
    if (!mountedRef.current) return;
    if (res.status === "rendering") {
      clipTrackerRef.current.complete(variantId, trackerDigestKey, "rendering");
      bump();
      onStatusRefresh();
    } else if (res.status === "clip_cap") {
      clipTrackerRef.current.complete(variantId, trackerDigestKey, "clip_cap");
      bump();
    } else {
      clipTrackerRef.current.failTransient(variantId, trackerDigestKey);
    }
  };
  const triggerClipRequestRef = useRef(triggerClipRequest);
  triggerClipRequestRef.current = triggerClipRequest;

  // Three-minute (180 s) active foreground playable timeout per scene (`CLIP_AFTER_UNPLAYABLE_MS = 180_000`).
  // Background-tab time (`document.visibilityState === "hidden"`) never counts.
  useEffect(() => {
    const tickMs = liveOptions?.unplayableTickMs ?? 1000;
    const timeoutMs = liveOptions?.unplayableTimeoutMs ?? CLIP_AFTER_UNPLAYABLE_MS ?? SCENE_PLAYABLE_TIMEOUT_MS;
    const nowFn = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    let lastTickMs = nowFn();

    const onVisChange = () => {
      lastTickMs = nowFn();
    };
    const doc = typeof document !== "undefined" ? document : null;
    if (doc && typeof doc.addEventListener === "function") {
      try {
        doc.addEventListener("visibilitychange", onVisChange);
      } catch {}
    }

    const timer = window.setInterval(() => {
      if (!mountedRef.current) return;
      const nowMs = nowFn();
      const docHidden = isDocumentHidden();
      if (docHidden) {
        lastTickMs = nowMs;
        return;
      }
      const elapsed = Math.max(0, nowMs - lastTickMs);
      const dtMs = elapsed >= 1 ? elapsed : tickMs;
      lastTickMs = nowMs;

      const variants = resolvedVariantsRef.current;
      variants.forEach((v, idx) => {
        if (v.stale || !v.hasBundle || !v.variantId || v.hasClip || v.playbackClip) return;
        const loaded = getLoadedBundle(bundlesRef.current, v);
        const effDigest = loaded?.bundleDigest ?? v.bundleDigest;
        if (!effDigest) return;
        const effGen = Math.max(loaded?.gen ?? 1, v.gen);
        const key = `${v.variantId}:g${effGen}:${effDigest}`;
        if (forcedClipRef.current.has(key)) return;

        const player = filmPlayerRef.current?.scenes[idx];
        const isPlayableNow =
          playerReadyRef.current.has(idx) &&
          Boolean(loaded) &&
          !player?.isPreparing &&
          player?.decision().mode === "live";

        const prev = playableTimeoutRef.current.get(key) ?? { activeWaitMs: 0, timedOut: false };
        const next = stepPlayableTimeout(prev, {
          dtMs,
          hasBundle: true,
          isPlayable: isPlayableNow,
          isActiveWork: !isPlayableNow,
          documentHidden: docHidden,
          timeoutMs
        });
        playableTimeoutRef.current.set(key, next);
        if (next.timedOut && !prev.timedOut) {
          forcedClipRef.current.set(key, "unplayable-timeout");
          playerReadyRef.current.delete(idx);
          bufferingScenesRef.current.delete(idx);
          playerDecisionsRef.current.set(idx, { mode: "clip", state: "clip", reason: "unplayable-timeout" });
          player?.forceClipFallback("unplayable-timeout");
          bump();
          void triggerClipRequestRef.current(v.variantId, effDigest, v.hasClip, "unplayable-timeout", effGen);
        }
      });
    }, tickMs);
    return () => {
      window.clearInterval(timer);
      if (doc && typeof doc.removeEventListener === "function") {
        try {
          doc.removeEventListener("visibilitychange", onVisChange);
        } catch {}
      }
    };
  }, [projectId, viewAspect, liveOptions?.unplayableTickMs, liveOptions?.unplayableTimeoutMs, onStatusRefresh]);

  // Fetch bundles, handle unsupported-env fallback reports, and request fallback clips.
  // Actual Worker measurement + check execution for `bundled` variants runs through `FilmPlayer`'s single shared
  // background check slot so `peakWorkersDuringPlay <= 2` and checks are ordered by distance ahead of the playhead.
  useEffect(() => {
    const envArg = liveOptions?.environment;
    const envSupported = envArg !== undefined ? supportsWorkerHost(envArg) : supportsWorkerHost();

    resolvedVariants.forEach((v, idx) => {
      // Clear cached bundle entries if a variant is stale or currently queued/authoring a new revision/repair.
      if (v.stale || v.state === "queued" || v.state === "authoring") {
        if (v.variantId) {
          for (const k of [...bundlesRef.current.keys()]) {
            if (k.startsWith(`${v.variantId}:`)) {
              bundlesRef.current.delete(k);
            }
          }
          for (const k of [...failedBundleKeysRef.current]) {
            if (k.startsWith(`${v.variantId}:`)) {
              failedBundleKeysRef.current.delete(k);
            }
          }
        }
        playerDecisionsRef.current.delete(idx);
        playerReadyRef.current.delete(idx);
        bufferingScenesRef.current.delete(idx);
        return;
      }

      const res = resolutions[idx];
      if (!res) return;

      // If environment cannot run Worker checks and variant is bundled, report kind:"env" once so server falls back cleanly.
      if (!envSupported && v.state === "bundled" && v.variantId && v.bundleDigest) {
        if (
          checkTrackerRef.current.shouldCheck(v.variantId, v.gen, v.bundleDigest, v.state) &&
          checkTrackerRef.current.begin(v.variantId, v.gen, v.bundleDigest)
        ) {
          const outcome = {
            ok: false as const,
            kind: "env" as const,
            error: "Worker host is not supported in this browser environment."
          };
          checkTrackerRef.current.complete(v.variantId, v.gen, v.bundleDigest, outcome);
          forcedClipRef.current.set(`${v.variantId}:g${v.gen}:${v.bundleDigest}`, "check-env");
          checksRunRef.current += 1;
          void reportCheck(
            projectId,
            v.variantId,
            {
              gen: v.gen,
              bundleDigest: v.bundleDigest,
              results: outcome,
              device: {
                ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
                env: envArg !== undefined ? environmentStatus(envArg) : environmentStatus()
              }
            },
            LIVE_API
          ).then(() => {
            if (mountedRef.current) onStatusRefresh();
          });
        }
      }

      // If scene needs a clip request for a valid fallback trigger (e.g. unverified/unsupported environment)
      if (res.needsClipRequest && v.variantId) {
        void triggerClipRequestRef.current(v.variantId, v.bundleDigest, v.hasClip, res.reason, v.gen);
        return;
      }

      if (!v.hasBundle || !v.variantId || !envSupported) return;

      const keys = bundleCacheKeys(v.variantId, v.rev, v.bundleDigest);
      const existingBundle = getLoadedBundle(bundlesRef.current, v);
      if (existingBundle) {
        return;
      }

      if (fetchingBundlesRef.current.has(keys.exact) || failedBundleKeysRef.current.has(keys.exact)) return;
      fetchingBundlesRef.current.add(keys.exact);

      void (async () => {
        try {
          const b = await fetchBundle(projectId, v.variantId!, LIVE_API);
          if (!mountedRef.current) return;
          const resolvedKeys = bundleCacheKeys(v.variantId!, v.rev, b.bundleDigest);
          bundlesRef.current.set(resolvedKeys.exact, b);
          bundlesRef.current.set(resolvedKeys.revLatest, b);
          bundlesRef.current.set(keys.exact, b);
          fetchingBundlesRef.current.delete(keys.exact);
          bump();
        } catch {
          fetchingBundlesRef.current.delete(keys.exact);
          failedBundleKeysRef.current.add(keys.exact);
          bump();
        }
      })();
    });
  }, [projectId, viewAspect, resolvedVariants, resolutions, liveOptions?.environment, onStatusRefresh]);

  // Mount and hot-update the single createFilmPlayer instance per (projectId, viewAspect).
  useEffect(() => {
    const container = hostContainerRef.current;
    if (!container || resolvedVariants.length === 0) return;

    const envArg = liveOptions?.environment;
    const envSupported = envArg !== undefined ? supportsWorkerHost(envArg) : supportsWorkerHost();

    // Wait until at least one scene has a bundle or clip, and wait for initial bundle fetches before first mount.
    if (!filmPlayerRef.current && envSupported) {
      const anyPlayableOrBundled = resolvedVariants.some((v) => v.hasBundle || v.hasClip);
      if (!anyPlayableOrBundled) return;
      const anyInitialBundlePending = resolvedVariants.some((v) => {
        if (!v.hasBundle || !v.variantId) return false;
        const keys = bundleCacheKeys(v.variantId, v.rev, v.bundleDigest);
        const loaded = getLoadedBundle(bundlesRef.current, v);
        if (!loaded) return !failedBundleKeysRef.current.has(keys.exact);
        return false;
      });
      if (anyInitialBundlePending) return;
    }

    const buildSpecForIndex = (idx: number): { spec: FilmSceneSpec; key: string } => {
      const v = resolvedVariants[idx]!;
      const durSec = durations[idx] ?? v.seconds;
      const loadedBundle = getLoadedBundle(bundlesRef.current, v);
      const effectiveDigest = loadedBundle?.bundleDigest ?? v.bundleDigest ?? `pending-${idx}`;
      const effectiveGen = Math.max(loadedBundle?.gen ?? 1, v.gen);
      const checkOutcome =
        v.variantId && loadedBundle
          ? checkTrackerRef.current.getOutcome(v.variantId, effectiveGen, effectiveDigest)
          : undefined;
      const forcedReason =
        v.variantId && effectiveDigest
          ? forcedClipRef.current.get(`${v.variantId}:g${effectiveGen}:${effectiveDigest}`)
          : undefined;

      const checkFailed = checkOutcome?.ok === false && checkOutcome.kind !== "inconclusive";
      const serverForceClip = v.playbackClip;
      const canMountLive =
        envSupported &&
        !serverForceClip &&
        Boolean(loadedBundle) &&
        !forcedReason &&
        !checkFailed &&
        (v.state === "bundled" ||
          v.state === "checked" ||
          (v.state === "drawn" && v.hasBundle) ||
          checkOutcome?.ok === true);

      const needsCheck =
        canMountLive &&
        (v.state === "bundled" || (v.state === "drawn" && v.hasBundle && !checkOutcome?.ok)) &&
        Boolean(v.variantId) &&
        checkTrackerRef.current.shouldCheck(v.variantId, effectiveGen, effectiveDigest, v.state);

      const forceClipReason = !envSupported
        ? (envArg !== undefined ? environmentStatus(envArg) : environmentStatus()) === "unverified"
          ? "unverified-environment"
          : "unsupported-environment"
        : forcedReason
          ? forcedReason
          : serverForceClip
            ? v.playbackReason === "slow-draw" || v.playbackReason === "slow"
              ? "slow-draw"
              : v.state === "drawn"
                ? "clip-only"
                : "variant-rendering"
            : !canMountLive
              ? v.state === "drawn" && !v.hasBundle
                ? "clip-only"
                : "pending-live"
              : undefined;

      const sceneLook = v.look ?? look ?? null;
      const spec: FilmSceneSpec = {
        id: `scene-${idx}`,
        bundleDigest: effectiveDigest,
        html: canMountLive && loadedBundle ? loadedBundle.html : "",
        params: canMountLive && loadedBundle ? loadedBundle.params : {},
        look: sceneLook,
        frames: v.frames,
        durationSeconds: durSec,
        environment: envArg,
        variantKey: `${projectId}:${v.variantId ?? `scene-${idx}`}:${viewAspect}`,
        state: v.state,
        needsCheck,
        variantId: v.variantId,
        gen: effectiveGen,
        hasClip: v.hasClip,
        clipReady: v.hasClip,
        ...(v.playbackClip || forceClipReason === "slow-draw" ? { playback: "clip" as const } : {}),
        ...(loadedBundle ? { manifest: loadedBundle.manifest } : {}),
        ...(forceClipReason ? { forceClipReason } : {})
      };

      const key = canMountLive
        ? `${idx}:r${v.rev}:g${effectiveGen}:${spec.bundleDigest}:live:${needsCheck ? "check" : "ok"}:${spec.frames}:${durSec}:${sceneLook ?? ""}`
        : `${idx}:r${v.rev}:g${effectiveGen}:${spec.bundleDigest}:${forceClipReason ?? "clip"}:${v.state}:${v.hasClip ? "clip-ready" : "clip-wait"}:${v.clipVersion ?? ""}:${spec.frames}:${durSec}:${sceneLook ?? ""}`;
      return { spec, key };
    };

    const nextSpecsAndKeys = resolvedVariants.map((_, idx) => buildSpecForIndex(idx));

    if (!filmPlayerRef.current) {
      container.innerHTML = "";
      const explicitTargetVertices = liveOptions?.draftTargetVerticesPerFrame;
      const fp = createFilmPlayer({
        scenes: nextSpecsAndKeys.map((x) => x.spec),
        projectId,
        filmKey: projectId,
        look: look ?? null,
        aspect: viewAspect,
        fps: 30,
        budgetBytes: renderMode === "draft" ? resolveDraftCacheBudgetBytes() : resolveCacheBudgetBytes(),
        previewQuality,
        renderMode,
        ...(explicitTargetVertices !== undefined ? { draftTargetVerticesPerFrame: explicitTargetVertices } : {}),
        onQualityProgress: onQualityJobProgress,
        onStoreStatus: onStoreStatusChange,
        api: LIVE_API,
        checkTracker: checkTrackerRef.current,
        onCheckReport: ({ sceneIndex, variantId, gen, bundleDigest, outcome, response }) => {
          checksRunRef.current += 1;
          if (!mountedRef.current) return;
          if (response.status === "dropped") {
            const curVar = resolvedVariantsRef.current[sceneIndex];
            const stillSameTuple =
              curVar &&
              curVar.variantId === variantId &&
              curVar.gen === gen &&
              curVar.bundleDigest === bundleDigest;
            if (stillSameTuple && outcome.ok) {
              playerReadyRef.current.add(sceneIndex);
              const dec = filmPlayerRef.current?.decision(sceneIndex);
              if (dec && dec.reason !== "pending-live" && dec.reason !== "no-bundle") {
                playerDecisionsRef.current.set(sceneIndex, dec);
              }
              bump();
              onStatusRefresh();
              return;
            }
            if (!stillSameTuple) {
              for (const k of [...bundlesRef.current.keys()]) {
                if (k.startsWith(`${variantId}:`)) {
                  bundlesRef.current.delete(k);
                }
              }
              checkTrackerRef.current.failTransient(variantId, gen, bundleDigest);
            }
            bump();
            onStatusRefresh();
            return;
          }
          if (outcome.ok) {
            if (response.status === "ok" && response.playback === "clip") {
              const fallbackReason = outcome.reason === "jitter" ? "jitter" : "slow-draw";
              forcedClipRef.current.set(`${variantId}:g${gen}:${bundleDigest}`, fallbackReason);
              playerReadyRef.current.delete(sceneIndex);
              bufferingScenesRef.current.delete(sceneIndex);
              playerDecisionsRef.current.set(sceneIndex, { mode: "clip", state: "clip", reason: "slow-draw" });
            } else if (outcome.reason === "jitter") {
              forcedClipRef.current.set(`${variantId}:g${gen}:${bundleDigest}`, "jitter");
              playerReadyRef.current.delete(sceneIndex);
              bufferingScenesRef.current.delete(sceneIndex);
              playerDecisionsRef.current.set(sceneIndex, { mode: "clip", state: "clip", reason: "jitter" });
              const curVar = resolvedVariantsRef.current[sceneIndex];
              void triggerClipRequestRef.current(variantId, bundleDigest, curVar?.hasClip ?? false, "jitter", gen);
            } else {
              playerReadyRef.current.add(sceneIndex);
              const dec = filmPlayerRef.current?.decision(sceneIndex);
              if (dec && dec.reason !== "pending-live" && dec.reason !== "no-bundle") {
                playerDecisionsRef.current.set(sceneIndex, dec);
              }
            }
          } else if (outcome.kind === "code") {
            if (response.status === "ok" && response.fallback === true) {
              forcedClipRef.current.set(`${variantId}:g${gen}:${bundleDigest}`, "check-code-failed");
              const curVar = resolvedVariantsRef.current[sceneIndex];
              void triggerClipRequestRef.current(
                variantId,
                bundleDigest,
                curVar?.hasClip ?? false,
                "code-permanent",
                gen
              );
            }
          } else if (outcome.kind === "env") {
            if (!isWatchdogTimeoutError(outcome.error)) {
              forcedClipRef.current.set(`${variantId}:g${gen}:${bundleDigest}`, "check-env");
              if (!(response.status === "ok" && response.playback === "clip")) {
                const curVar = resolvedVariantsRef.current[sceneIndex];
                void triggerClipRequestRef.current(
                  variantId,
                  bundleDigest,
                  curVar?.hasClip ?? false,
                  "device-env",
                  gen
                );
              }
            }
          }
          bump();
          onStatusRefresh();
        },
        timeSource: {
          currentTime: () => clockTimeRef.current,
          playing: () => playingRef.current
        },
        environment: envArg,
        autoPump: !liveOptions?.forceBuffering
      });

      filmPlayerRef.current = fp;
      mountedSpecsRef.current = nextSpecsAndKeys.map((x) => x.key);

      fp.on("mode", (detail) => {
        if (filmPlayerRef.current !== fp) return;
        const d = detail as {
          sceneIndex?: number;
          mode?: "live" | "clip";
          reason?: string;
          progress?: number;
          state?: PlayerDecision["state"];
          renderMode?: PlaybackRenderMode;
          effectiveRenderMode?: PlaybackRenderMode;
          stillUpgradeState?: StillUpgradeState;
          draftTargetVerticesPerFrame?: number;
        } | undefined;
        if (d && typeof d.sceneIndex === "number" && (d.mode === "live" || d.mode === "clip")) {
          if (d.mode === "clip" && (d.reason === "pending-live" || d.reason === "no-bundle" || d.reason === "clip-only")) {
            return;
          }
          const dec: PlayerDecision = {
            mode: d.mode,
            reason: d.reason ?? "ok",
            ...(d.state ? { state: d.state } : {}),
            ...(typeof d.progress === "number" ? { progress: d.progress } : {}),
            ...(d.renderMode ? { renderMode: d.renderMode } : {}),
            ...(d.effectiveRenderMode ? { effectiveRenderMode: d.effectiveRenderMode } : {}),
            ...(d.stillUpgradeState ? { stillUpgradeState: d.stillUpgradeState } : {}),
            ...(typeof d.draftTargetVerticesPerFrame === "number"
              ? { draftTargetVerticesPerFrame: d.draftTargetVerticesPerFrame }
              : {})
          };
          playerDecisionsRef.current.set(d.sceneIndex, dec);
          if (d.mode === "clip") {
            bufferingScenesRef.current.delete(d.sceneIndex);
            const v = resolvedVariantsRef.current[d.sceneIndex];
            const loaded = v ? getLoadedBundle(bundlesRef.current, v) : undefined;
            const effGen = v ? Math.max(loaded?.gen ?? 1, v.gen) : 1;
            const effDigest = loaded?.bundleDigest ?? v?.bundleDigest;
            const checkOut =
              v?.variantId && effDigest
                ? checkTrackerRef.current.getOutcome(v.variantId, effGen, effDigest)
                : undefined;
            const isWatchdogEnv =
              isWatchdogTimeoutError(d.reason) ||
              Boolean(checkOut && !checkOut.ok && isWatchdogTimeoutError(checkOut.error));
            if (v?.variantId && effDigest && !isWatchdogEnv) {
              forcedClipRef.current.set(`${v.variantId}:g${effGen}:${effDigest}`, d.reason ?? "clip");
            }
          } else if (d.mode === "live") {
            playerReadyRef.current.add(d.sceneIndex);
          }
          bump();
        }
      });

      fp.on("buffering", (detail) => {
        if (filmPlayerRef.current !== fp) return;
        const d = detail as { sceneIndex?: number; buffering?: boolean } | undefined;
        if (d && typeof d.sceneIndex === "number") {
          const curIdx = currentRef.current;
          const activeAudioTl = audioTimelinePropRef.current;
          if (d.buffering) {
            bufferingScenesRef.current.add(d.sceneIndex);
            if (d.sceneIndex === curIdx) {
              activeAudioTl?.setBuffering(true);
              voices.current[curIdx]?.pause();
              musicAudio.current?.pause();
              clearSfxTimers();
              Object.values(sfxAudios.current).forEach((el) => el?.pause());
            }
          } else {
            bufferingScenesRef.current.delete(d.sceneIndex);
            if (d.sceneIndex === curIdx) {
              activeAudioTl?.setBuffering(false);
            }
          }
          bump();
        }
      });

      const mountPromise = (async () => {
        try {
          await fp.mount(container);
          if (filmPlayerRef.current !== fp) return;
          fp.scenes.forEach((p, idx) => {
            if (nextSpecsAndKeys[idx]?.spec.needsCheck) return;
            const dec = p.decision();
            if (dec.reason !== "pending-live" && dec.reason !== "no-bundle") {
              playerDecisionsRef.current.set(idx, dec);
            }
            if (dec.mode === "live") {
              playerReadyRef.current.add(idx);
            }
          });
          if (liveOptions?.forceBuffering) {
            fp.showFrame(45);
          } else {
            fp.syncToClock();
          }
          bump();
        } catch {
          // ignore mount error after unmount
        }
      })();
      mountPromiseRef.current = mountPromise;
    } else {
      const fp = filmPlayerRef.current;
      nextSpecsAndKeys.forEach(({ spec, key }, idx) => {
        if (mountedSpecsRef.current[idx] !== key) {
          mountedSpecsRef.current[idx] = key;
          void (async () => {
            try {
              if (mountPromiseRef.current) {
                await mountPromiseRef.current;
              }
              if (filmPlayerRef.current !== fp) return;
              await fp.updateScene(idx, spec);
              if (filmPlayerRef.current !== fp) return;
              if (!spec.needsCheck) {
                const dec = fp.decision(idx);
                if (dec.reason !== "pending-live" && dec.reason !== "no-bundle") {
                  playerDecisionsRef.current.set(idx, dec);
                }
                if (dec.mode === "live") {
                  playerReadyRef.current.add(idx);
                }
              }
              if (liveOptions?.forceBuffering && idx === 0) {
                fp.showFrame(45);
              } else if (idx === current || idx === current + 1) {
                fp.syncToClock();
              }
              bump();
            } catch {
              // ignore
            }
          })();
        } else if (spec.needsCheck) {
          fp.enqueueSceneCheck(idx, spec);
        }
      });
    }
  }, [resolvedVariants, durations, viewAspect, look, revisionTick, liveOptions?.environment, liveOptions?.forceBuffering]);

  // Trigger background QualityJob whenever the user changes `previewQuality`.
  const prevQualityRef = useRef<PreviewQuality | undefined>(previewQuality);
  useEffect(() => {
    if (previewQuality === undefined) return;
    if (prevQualityRef.current !== undefined && prevQualityRef.current !== previewQuality) {
      prevQualityRef.current = previewQuality;
      const fp = filmPlayerRef.current;
      if (fp) {
        void fp.setPreviewQuality(previewQuality);
      }
    } else {
      prevQualityRef.current = previewQuality;
    }
  }, [previewQuality]);

  // Synchronize FilmPlayer when the user switches `renderMode` ("draft" <-> "full") without starting QualityJob.
  const prevRenderModeRef = useRef<PlaybackRenderMode>(renderMode);
  useEffect(() => {
    if (prevRenderModeRef.current !== renderMode) {
      prevRenderModeRef.current = renderMode;
      const fp = filmPlayerRef.current;
      if (fp) {
        fp.setRenderMode(renderMode);
        bump();
      }
    }
  }, [renderMode]);

  // Synchronize FilmPlayer when `liveOptions.draftTargetVerticesPerFrame` changes.
  useEffect(() => {
    const target = liveOptions?.draftTargetVerticesPerFrame;
    if (typeof target === "number" && filmPlayerRef.current) {
      filmPlayerRef.current.setDraftTargetVertices(target);
      bump();
    }
  }, [liveOptions?.draftTargetVerticesPerFrame]);

  // Synchronize FilmPlayer when `playing` changes so intentional pause schedules the 250 ms full-quality still upgrade.
  const prevPlayingRef = useRef<boolean>(playing);
  useEffect(() => {
    if (prevPlayingRef.current !== playing) {
      prevPlayingRef.current = playing;
      const fp = filmPlayerRef.current;
      if (fp && !liveOptions?.forceBuffering) {
        const localSec = Math.max(0, clockTimeRef.current - (starts[current] ?? 0));
        fp.syncToScene(current, localSec);
      }
    }
  }, [playing, current, starts, liveOptions?.forceBuffering]);

  // Synchronize FilmPlayer before paint whenever `time` or `current` changes so scene-boundary switches never flash.
  useIsomorphicLayoutEffect(() => {
    clockTimeRef.current = time;
    const fp = filmPlayerRef.current;
    if (fp && !liveOptions?.forceBuffering) {
      const localSec = Math.max(0, time - (starts[current] ?? 0));
      fp.syncToScene(current, localSec);
    }
  }, [time, current, starts, liveOptions?.forceBuffering]);

  // Single clock RAF loop when playing a live scene or a storyboard sketch fallback while a scene is still being processed.
  const activeRes = resolutions[current];
  const activeSceneShowsLive = activeRes?.mode === "live" && activeRes.isPlayable;
  const activeSceneShowsClipMeanwhile =
    Boolean(activeRes?.mode === "live" && !activeRes.isPlayable && resolvedVariants[current]?.hasClip);
  const activeSceneShowsClip =
    (activeRes?.mode === "clip" && activeRes.isPlayable) || activeSceneShowsClipMeanwhile;
  const activeScenePausedForBuffer = Boolean(activeRes?.isPreparing || activeRes?.isBuffering);
  const activeSceneIsLive = activeSceneShowsLive && !activeScenePausedForBuffer;
  const activeVariant = resolvedVariants[current];
  const activeSceneShowsSketchFallback = Boolean(
    !activeSceneShowsLive &&
      !activeSceneShowsClip &&
      !activeScenePausedForBuffer &&
      activeVariant &&
      !activeVariant.stale &&
      activeVariant.state !== "failed" &&
      Boolean(referenceFrames?.[current])
  );
  const activeSceneDrivesClock = activeSceneIsLive || activeSceneShowsSketchFallback;

  useEffect(() => {
    if (!playing || !activeSceneDrivesClock) {
      const waitingOnUnreadyClip = Boolean(
        activeRes?.mode === "clip" && !activeRes.isPlayable && !activeSceneShowsSketchFallback
      );
      if (playing && ((activeSceneShowsLive && activeScenePausedForBuffer) || waitingOnUnreadyClip)) {
        // Hold clock and suspend Web Audio timeline (and pause fallback elements) at the same instant while buffering, drawing, or waiting for a demoted slow-scene clip.
        audioTimeline?.setBuffering(true);
        voices.current[current]?.pause();
        musicAudio.current?.pause();
        clearSfxTimers();
        Object.values(sfxAudios.current).forEach((el) => el?.pause());
        if (activeSceneShowsLive && !liveOptions?.forceBuffering) {
          const syncPausedScene = () => {
            const fp = filmPlayerRef.current;
            if (!fp) return;
            const localSec = Math.max(0, clockTimeRef.current - (starts[current] ?? 0));
            if (fp.activeSceneIndex !== current || !fp.scenes[current]?.isPumping) {
              fp.syncToScene(current, localSec);
            }
          };
          syncPausedScene();
          const recoveryTimer = window.setInterval(syncPausedScene, 120);
          return () => {
            window.clearInterval(recoveryTimer);
          };
        }
      } else if ((playing || wantPlay.current) && activeSceneShowsClip) {
        const localSec = Math.max(0, clockTimeRef.current - (starts[current] ?? 0));
        audioTimeline?.setBuffering(false);
        const el = videos.current[current];
        if (el) {
          const rate = rateFor(current, el);
          el.playbackRate = rate;
          if (localSec > 0 && Math.abs((el.currentTime || 0) / (rate || 1) - localSec) > 0.05) {
            try {
              el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, localSec * rate) : localSec;
            } catch {}
          }
          void el.play?.()?.catch?.(() => undefined);
        }
        const vo = voices.current[current];
        if (vo && (!audioTimeline || !audioTimeline.hasDecodedAudio())) {
          vo.muted = !voiceOn || muted;
          vo.volume = master;
          if (vo.readyState >= 1) {
            vo.currentTime = Number.isFinite(vo.duration)
              ? Math.min(Math.max(0, vo.duration - 0.05), localSec)
              : localSec;
          }
          if (vo.paused) {
            void vo.play?.()?.catch?.(() => undefined);
          }
        }
        if (musicAudio.current && musicSrc && (!audioTimeline || !audioTimeline.hasDecodedAudio())) {
          musicAudio.current.muted = !musicOn || muted;
          musicAudio.current.volume = 0.22 * master;
          if (musicAudio.current.paused) {
            musicAudio.current.currentTime = clockTimeRef.current;
            void musicAudio.current.play?.()?.catch?.(() => undefined);
          }
        }
      }
      if (telemetryRef.current.playStartMs !== null) {
        telemetryRef.current.accumulatedPlayMs += performance.now() - telemetryRef.current.playStartMs;
        telemetryRef.current.playStartMs = null;
      }
      return;
    }

    if (typeof liveOptions?.freezeClockAt === "number") {
      clockTimeRef.current = liveOptions.freezeClockAt;
      onSetTimeRef.current(liveOptions.freezeClockAt);
      filmPlayerRef.current?.syncToClock();
      return;
    }

    // Switching from clip-meanwhile to live: pause the hidden video element without restarting the film clock.
    videos.current[current]?.pause?.();

    const startLocal = Math.max(0, clockTimeRef.current - (starts[current] ?? 0));
    const useWebAudio = Boolean(audioTimeline && audioTimeline.hasDecodedAudio());

    if (useWebAudio && audioTimeline) {
      audioTimeline.setBuffering(false);
      if (!audioTimeline.playing()) {
        audioTimeline.seek(clockTimeRef.current);
        void audioTimeline.play();
      }
      // Ensure fallback HTMLAudioElements stay paused while WebAudioFilmTimeline is driving audio.
      voices.current[current]?.pause();
      musicAudio.current?.pause();
    } else {
      const vo = voices.current[current];
      if (vo) {
        vo.muted = !voiceOn || muted;
        vo.volume = master;
        if (vo.readyState >= 1 && (vo.paused || Math.abs(vo.currentTime - startLocal) > 0.08)) {
          vo.currentTime = Number.isFinite(vo.duration)
            ? Math.min(Math.max(0, vo.duration - 0.05), startLocal)
            : startLocal;
        }
        if (vo.paused) {
          void vo.play().catch(() => undefined);
        }
      }

      if (musicAudio.current && musicSrc) {
        musicAudio.current.muted = !musicOn || muted;
        musicAudio.current.volume = 0.22 * master;
        if (musicAudio.current.paused || Math.abs(musicAudio.current.currentTime - clockTimeRef.current) > 0.08) {
          musicAudio.current.currentTime = clockTimeRef.current;
        }
        if (musicAudio.current.paused) {
          void musicAudio.current.play().catch(() => undefined);
        }
      }

      playSceneSfxRef.current(current, startLocal);
    }

    let wallAnchorMs = performance.now() - startLocal * 1000;
    if (telemetryRef.current.playStartMs === null) {
      telemetryRef.current.playStartMs = performance.now();
    }
    let raf = 0;
    let fallbackTimer = 0;

    const scheduleNextTick = () => {
      let fired = false;
      raf = requestAnimationFrame((now) => {
        if (fired) return;
        fired = true;
        window.clearTimeout(fallbackTimer);
        tick(now);
      });
      fallbackTimer = window.setTimeout(() => {
        if (fired) return;
        fired = true;
        cancelAnimationFrame(raf);
        if (!isDocumentHidden()) {
          tick(performance.now());
        }
      }, 33);
    };

    const tick = (now: number) => {
      const fp = filmPlayerRef.current;
      const activePlayer = fp?.scenes[current];
      if (activePlayer && (activePlayer.isBufferingNow || activePlayer.isPreparing)) {
        // Hold the clock and suspend Web Audio timeline immediately when entering buffering.
        audioTimeline?.setBuffering(true);
        voices.current[current]?.pause();
        musicAudio.current?.pause();
        Object.values(sfxAudios.current).forEach((el) => el?.pause());
        return;
      }

      const sceneDur = durations[current] ?? resolvedVariants[current]?.seconds ?? 4;
      let localSec: number;
      let nextGlobalTime: number;

      if (useWebAudio && audioTimeline && audioTimeline.audioContext?.state === "running") {
        // Master clock is derived from AudioContext.currentTime (film time = contextTime - offset)
        const tickRes = audioTimeline.tick();
        localSec = Math.max(0, tickRes.filmTime - (starts[current] ?? 0));
        const clampedLocal = Math.min(sceneDur, localSec);
        nextGlobalTime = (starts[current] ?? 0) + clampedLocal;
        wallAnchorMs = now - localSec * 1000;
      } else {
        const curVo = voices.current[current];
        if (!useWebAudio && curVo && !curVo.paused && !curVo.ended && curVo.currentTime > 0) {
          localSec = curVo.currentTime;
          wallAnchorMs = now - localSec * 1000;
        } else {
          localSec = Math.max(0, (now - wallAnchorMs) / 1000);
          if (!useWebAudio && curVo && !curVo.paused && !curVo.ended && Math.abs(curVo.currentTime - localSec) > 1 / 30) {
            try {
              curVo.currentTime = localSec;
            } catch {}
          }
        }
        const clampedLocal = Math.min(sceneDur, localSec);
        nextGlobalTime = (starts[current] ?? 0) + clampedLocal;
        if (!useWebAudio) {
          tickSceneSfxRef.current?.(current, clampedLocal, { playing: true, buffering: false });
        }
      }

      const inSceneGlobalTime =
        localSec >= sceneDur && current < resolvedVariants.length - 1
          ? (starts[current] ?? 0) + Math.max(0, sceneDur - 1 / 60)
          : nextGlobalTime;
      clockTimeRef.current = inSceneGlobalTime;
      onSetTimeRef.current(nextGlobalTime);

      if (fp && activeSceneIsLive) {
        const targetFrame = fp.clock.frame();
        if (targetFrame !== lastCheckedFrameRef.current) {
          lastCheckedFrameRef.current = targetFrame;
          const wasReady = fp.ready(targetFrame);
          if (!wasReady) {
            telemetryRef.current.lateFrames += 1;
          }
          telemetryRef.current.framesRendered += 1;
          telemetryRef.current.distinctFramesSet.add(targetFrame);
        }
        const localForSync = Math.min(Math.max(0, sceneDur - 1 / 60), Math.max(0, localSec));
        fp.syncToScene(current, localForSync);
        clockTimeRef.current = nextGlobalTime;
        if (fp.scenes[current]?.isBufferingNow || fp.scenes[current]?.isPreparing) {
          audioTimeline?.setBuffering(true);
          voices.current[current]?.pause();
          musicAudio.current?.pause();
          Object.values(sfxAudios.current).forEach((el) => el?.pause());
          return;
        }
        const presentedSrcFrame = fp.scenes[current]?.lastPresentedSourceFrame ?? null;
        if (
          presentedSrcFrame !== null &&
          useWebAudio &&
          audioTimeline &&
          audioTimeline.audioContext?.state === "running"
        ) {
          const presentedLocalSec = presentedSrcFrame / 30;
          const clampedTargetSec = Math.min(( fp.scenes[current]!.meta.frames - 1 ) / 30, Math.max(0, localSec));
          const driftMs = Math.round(Math.abs(clampedTargetSec - presentedLocalSec) * 1000 * 100) / 100;
          if (telemetryRef.current.audioDriftSamplesMs.length < 2500) {
            telemetryRef.current.audioDriftSamplesMs.push(driftMs);
          }
        }
      }

      const curVo = voices.current[current];
      const voStillRunning = useWebAudio
        ? false
        : Boolean(
            curVo && !curVo.paused && !curVo.ended && Number.isFinite(curVo.duration) && curVo.duration - curVo.currentTime > 0.08
          );

      if (localSec >= sceneDur && !voStillRunning) {
        const hasPlayableAfter = resolvedVariants.some(
          (v, i) =>
            i > current &&
            Boolean(
              resolutions[i]?.isPlayable ||
                (!v.stale && v.state !== "failed" && Boolean(referenceFrames?.[i]))
            )
        );
        if (!hasPlayableAfter) {
          telemetryRef.current.naturalEndCleanupTriggered = true;
          filmPlayerRef.current?.completeFilmCleanup();
          bump();
        }
        onAdvanceSceneRef.current(current);
        return;
      }

      scheduleNextTick();
    };

    scheduleNextTick();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallbackTimer);
      if (telemetryRef.current.playStartMs !== null) {
        telemetryRef.current.accumulatedPlayMs += performance.now() - telemetryRef.current.playStartMs;
        telemetryRef.current.playStartMs = null;
      }
    };
  }, [
    playing,
    activeSceneDrivesClock,
    activeSceneIsLive,
    activeSceneShowsLive,
    activeSceneShowsClip,
    activeSceneShowsSketchFallback,
    activeScenePausedForBuffer,
    current,
    starts,
    durations,
    resolvedVariants,
    referenceFrames,
    voiceOn,
    musicOn,
    master,
    muted,
    musicSrc,
    voices,
    musicAudio,
    sfxAudios,
    clearSfxTimers,
    audioTimeline,
    liveOptions?.freezeClockAt
  ]);

  const shownVariant = resolvedVariants[current];
  const shownResolution = resolutions[current];
  const decisionsSummary = resolutions
    .map((r, i) => `S${i + 1}:${r.mode}(${r.reason})`)
    .join(" | ");

  const shownProgress = perSceneProgress?.[current] ?? null;
  const refFrameSrc = referenceFrames?.[current] ?? null;
  const isLiveBufferOrPrepare =
    Boolean(shownResolution?.mode === "live" && (shownResolution.isBuffering || shownResolution.isPreparing)) ||
    Boolean(liveOptions?.forceBuffering);

  const bufferingSamplesRef = useRef<BufferingRateSample[]>([]);
  const [bufferingVisible, setBufferingVisible] = useState<boolean>(Boolean(liveOptions?.forceBuffering));
  const [bufferingTick, setBufferingTick] = useState<number>(0);

  useEffect(() => {
    bufferingSamplesRef.current = [];
    if (!isLiveBufferOrPrepare) {
      setBufferingVisible(false);
      return;
    }
    if (liveOptions?.forceBuffering) {
      setBufferingVisible(true);
    }
    const samplePlayer = () => {
      const p = filmPlayerRef.current?.scenes[current];
      if (!p) return;
      const snap = p.bufferingSnapshot();
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      bufferingSamplesRef.current = recordBufferingSample(bufferingSamplesRef.current, {
        atMs: nowMs,
        readyFrames: snap.readyFrames
      });
    };
    samplePlayer();

    const showTimer = window.setTimeout(() => {
      samplePlayer();
      setBufferingVisible(true);
      setBufferingTick((n) => n + 1);
    }, liveOptions?.forceBuffering ? 0 : BUFFERING_SHOW_DELAY_MS);

    const sampleTimer = window.setInterval(() => {
      samplePlayer();
    }, 250);

    const uiTimer = window.setInterval(() => {
      samplePlayer();
      setBufferingTick((n) => n + 1);
    }, 1000);

    return () => {
      window.clearTimeout(showTimer);
      window.clearInterval(sampleTimer);
      window.clearInterval(uiTimer);
    };
  }, [isLiveBufferOrPrepare, current, liveOptions?.forceBuffering]);

  void bufferingTick;
  const activePlayerForFeedback = filmPlayerRef.current?.scenes[current];
  const playerSnap = isLiveBufferOrPrepare && activePlayerForFeedback ? activePlayerForFeedback.bufferingSnapshot() : null;
  const nowMsForEst = typeof performance !== "undefined" ? performance.now() : Date.now();

  const fallbackNeededFrames = shownVariant ? Math.min(30, Math.max(1, shownVariant.frames)) : 30;
  const fallbackReadyFrames =
    typeof shownResolution?.preparingProgress === "number"
      ? Math.round(shownResolution.preparingProgress * fallbackNeededFrames)
      : 0;

  const liveBufferingInfo = isLiveBufferOrPrepare
    ? {
        active: true,
        visibleAfterDelay: bufferingVisible || Boolean(liveOptions?.forceBuffering),
        hasAnyFrame:
          playerSnap?.hasAnyFrame ??
          (Boolean(liveOptions?.forceBuffering) ||
            (typeof shownResolution?.preparingProgress === "number" && shownResolution.preparingProgress > 0)),
        readyFrames: playerSnap ? playerSnap.readyFrames : fallbackReadyFrames,
        neededFrames: playerSnap ? playerSnap.neededFrames : fallbackNeededFrames,
        samples: bufferingSamplesRef.current,
        nowMs: nowMsForEst
      }
    : null;

  // Determine whether the stage wait overlay should be displayed for the currently selected scene.
  const shownScene = scenes[current];
  const shownPlayback = shownScene?.variants?.[viewAspect]?.playback ?? shownScene?.playback;
  const stagePrep = buildStagePrepProps({
    prep,
    sceneIndex: current,
    sceneCount: scenes.length,
    sceneState: shownVariant?.state ?? shownScene?.state ?? "queued",
    sceneStale: Boolean(shownVariant?.stale || shownScene?.stale),
    sceneError: shownVariant?.error ?? shownScene?.error ?? null,
    playback: shownPlayback,
    isClipScene: Boolean(
      !shownVariant?.stale &&
        (shownVariant?.playbackClip ||
          (shownResolution?.mode === "clip" &&
            (shownResolution.reason === "slow-draw" ||
              shownResolution.reason === "check-env" ||
              shownResolution.reason === "variant-rendering")))
    ),
    viewAspect,
    primaryAspect,
    isViewAspectDrawn,
    isViewAspectDrawing,
    isPlayable: Boolean(shownResolution && shownVariant && !shownVariant.stale && shownResolution.isPlayable),
    sceneProgress: shownProgress,
    backgroundSketch: refFrameSrc,
    liveStageWait: !isLiveBufferOrPrepare ? (shownResolution?.stageWait ?? null) : null,
    liveBuffering: liveBufferingInfo
  });

  const stageOverlay = resolveStagePrepOverlay({
    currentSceneIndex: current,
    filmToast,
    stagePrep,
    prep,
    isSecondaryAspectDrawing: isViewAspectDrawing && !isViewAspectDrawn
  });

  const activeSceneHoldingLastFrameForClip =
    Boolean(shownVariant && !shownVariant.stale && shownResolution?.mode === "clip" && !shownVariant.hasClip) &&
    (filmPlayerRef.current?.scenes[current]?.lastPresentedSourceFrame ?? null) !== null;
  const activeSceneShowsCanvas = activeSceneShowsLive || activeSceneHoldingLastFrameForClip;

  const canUseServerStill =
    Boolean(shownVariant && !shownVariant.stale && shownVariant.state !== "queued" && shownVariant.state !== "authoring");
  const showStillFallback =
    Boolean(shownVariant && shownResolution?.mode === "clip" && !shownVariant.hasClip) &&
    !activeSceneHoldingLastFrameForClip &&
    (Boolean(refFrameSrc) || (canUseServerStill && !stillFailedRef.current.has(current)));
  const stillUrl =
    refFrameSrc ??
    (shownVariant && canUseServerStill
      ? `${outputUrl(`/v1/projects/${encodeURIComponent(projectId)}/plates/${shownVariant.index}/still`)}${
          outputUrl("/x").includes("?") ? "&" : "?"
        }aspect=${encodeURIComponent(viewAspect)}&v=${encodeURIComponent(`${shownVariant.sig}-${shownVariant.rev}`)}`
      : null);

  return (
    <>
      <div
        ref={hostContainerRef}
        className="aw-live-canvas-host"
        data-live-active={activeSceneShowsLive ? "true" : "false"}
        data-live-decisions={decisionsSummary}
        data-live-render-mode={shownResolution?.renderMode ?? renderMode}
        data-live-still-state={shownResolution?.stillUpgradeState ?? "idle"}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: activeSceneShowsCanvas ? 2 : 0,
          opacity: activeSceneShowsCanvas ? 1 : 0
        }}
      />

      {showStillFallback && stillUrl && (
        <img
          src={stillUrl}
          alt=""
          className="aw-live-still"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 1,
            pointerEvents: "none",
            zIndex: 1
          }}
          onError={() => {
            stillFailedRef.current.add(current);
            bump();
          }}
        />
      )}

      {resolvedVariants.map((v) => {
        const res = resolutions[v.index];
        if (!v.hasClip && res?.mode !== "clip") return null;
        if (!v.hasClip) return null;
        const clipSrc = plateClipUrl(
          projectId,
          v.index,
          `${v.clipVersion ?? v.sig}-${v.rev}-${viewAspect}`,
          viewAspect
        );
        const isCurrentClip =
          v.index === current &&
          (res?.mode === "clip" || (res?.mode === "live" && !res.isPlayable && v.hasClip));
        return (
          <video
            key={`${v.index}-${clipSrc}`}
            ref={(el) => {
              videos.current[v.index] = el;
            }}
            className={isCurrentClip ? "on" : ""}
            src={clipSrc}
            preload="auto"
            muted
            playsInline
            onLoadedData={(e) => {
              if (isCurrentClip && (playingRef.current || wantPlay.current)) {
                const rate = rateFor(v.index, e.currentTarget);
                e.currentTarget.playbackRate = rate;
                const localSec = Math.max(0, clockTimeRef.current - (starts[v.index] ?? 0));
                if (localSec > 0) {
                  try {
                    e.currentTarget.currentTime = Number.isFinite(e.currentTarget.duration)
                      ? Math.min(e.currentTarget.duration, localSec * rate)
                      : localSec;
                  } catch {}
                }
                audioTimeline?.setBuffering(false);
                void e.currentTarget.play().catch(() => undefined);
              }
              onLoadedVideo(v.index);
            }}
            onError={(e) => {
              const el = e.currentTarget;
              const tries = Number(el.dataset.retries ?? "0");
              if (tries >= 2) return;
              el.dataset.retries = String(tries + 1);
              window.setTimeout(() => el.load(), 1500 * (tries + 1));
            }}
            onPlay={(e) => {
              if (!isCurrentClip) return;
              onSetPlaying(true);
              const rate = rateFor(v.index, e.currentTarget);
              e.currentTarget.playbackRate = rate;
              const realOffset = e.currentTarget.currentTime / (rate || 1);
              const vo = voices.current[v.index];
              if (vo) {
                vo.muted = !voiceOn || muted;
                vo.currentTime = Number.isFinite(vo.duration)
                  ? Math.min(Math.max(0, vo.duration - 0.05), realOffset)
                  : realOffset;
                vo.volume = master;
                void vo.play().catch(() => undefined);
              }
              if (musicAudio.current && musicSrc) {
                musicAudio.current.muted = !musicOn || muted;
                musicAudio.current.volume = 0.22 * master;
                if (musicAudio.current.paused) {
                  musicAudio.current.currentTime = (starts[v.index] ?? 0) + realOffset;
                  void musicAudio.current.play().catch(() => undefined);
                }
              }
              playSceneSfx(v.index, realOffset);
            }}
            onPause={(e) => {
              if (!isCurrentClip) return;
              if (!wantPlay.current || !e.currentTarget.ended) voices.current[v.index]?.pause();
              if (!wantPlay.current) {
                onSetPlaying(false);
                musicAudio.current?.pause();
                clearSfxTimers();
                Object.values(sfxAudios.current).forEach((el) => el?.pause());
              }
            }}
            onEnded={() => onVideoEnded(v.index)}
            onTimeUpdate={(e) => {
              if (isCurrentClip && !playing) {
                const rate = rateFor(current, e.currentTarget);
                onSetTime((starts[current] ?? 0) + e.currentTarget.currentTime / (rate || 1));
              }
            }}
          />
        );
      })}

      {stagePrep && (
        <AnimationPrep
          failed={stagePrep.failed}
          stale={stagePrep.stale}
          compact={stagePrep.compact}
          compactText={stagePrep.compactText}
          title={stagePrep.title}
          meaning={stagePrep.meaning}
          detail={stagePrep.detail}
          sceneLabel={stagePrep.sceneLabel}
          elapsedText={stagePrep.elapsedText}
          progressFraction={stagePrep.progressFraction}
          progressIndeterminate={stagePrep.progressIndeterminate}
          progressEstimated={stagePrep.progressEstimated}
          etaText={stagePrep.etaText}
          backgroundSketch={stagePrep.backgroundSketch}
          compactCard={stagePrep.compactCard}
          actionLabel={stagePrep.actionLabel}
          onAction={stagePrep.failed && onRetryScene ? () => onRetryScene(current) : stagePrep.stale ? onUpdateStale : undefined}
          actionBusy={stagePrep.failed ? retryingSceneIndex === current : updatingStale}
          suppressDuplicateText={stageOverlay.suppressDuplicateText}
          placement={stageOverlay.placement}
          bottomText={stageOverlay.bottomText}
        />
      )}
    </>
  );
}
