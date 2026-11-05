"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { outputUrl, plateClipUrl } from "../lib/api";
import {
  CheckOnceTracker,
  ClipRequestTracker,
  WorkerHost,
  createFilmPlayer,
  decideSceneMode,
  environmentStatus,
  fetchBundle,
  reportCheck,
  requestClip,
  resolveCacheBudgetBytes,
  resolveSceneVariant,
  runCheck,
  supportsWorkerHost,
  type AspectRatio,
  type FetchedBundle,
  type FilmPlayer,
  type FilmSceneSpec,
  type FrameStoreStatus,
  type LivePlateScene,
  type PlayerDecision,
  type PreviewQuality,
  type QualityJobProgress,
  type SceneModeResolution,
  type WebAudioFilmTimeline,
  withBackendAuth
} from "../lib/live";
import { createClient } from "../utils/supabase/client";
import { AnimationPrep } from "./animation-workspace";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Live-scene calls go through the app's backend proxy like every other API call, so they carry the user's token (apiFetch in
// lib/api.ts does the same). Without it every bundle, check and clip request is refused with 401 wherever auth is on.
const LIVE_API = {
  baseUrl: "/api/backend",
  fetch: withBackendAuth(async () => (await createClient().auth.getSession()).data.session?.access_token)
};

export type PlateLiveTelemetry = {
  framesRendered: number;
  distinctFrames: number;
  lateFrames: number;
  achievedFps: number;
  elapsedPlaySeconds: number;
  checksRun: number;
  decisions: {
    index: number;
    mode: "live" | "clip";
    reason: string;
    state: string;
    rev: number;
    gen: number;
    bundleDigest: string | null;
  }[];
};

export type PlateLiveOptions = {
  flagOverride?: boolean;
  environment?: string;
  initialTime?: number;
  initialPlaying?: boolean;
  freezeClockAt?: number;
  forceBuffering?: boolean;
  onDecisionsChange?: (
    decisions: { index: number; mode: "live" | "clip"; reason: string; state: string }[]
  ) => void;
};

export interface PlateLiveStageProps {
  projectId: string;
  scenes: readonly LivePlateScene[];
  referenceFrames?: readonly (string | null | undefined)[];
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
  onQualityJobProgress?: (progress: QualityJobProgress) => void;
  onStoreStatusChange?: (status: FrameStoreStatus) => void;
  audioTimeline?: WebAudioFilmTimeline<any> | null;
  qualityJobText?: string | null;
  storeDisabledReason?: string | null;
  liveOptions?: PlateLiveOptions;
}

function bundleCacheKeys(variantId: string, rev: number, bundleDigest?: string | null): { exact: string; revLatest: string } {
  return {
    exact: `${variantId}:r${rev}:${bundleDigest ?? "latest"}`,
    revLatest: `${variantId}:r${rev}:latest`
  };
}

/**
 * Live scene stage for `PlatePreview` (Phase 3c).
 * Mounts one `createFilmPlayer` per `(projectId, viewAspect)`, runs the fenced browser check once per
 * `(variantId, gen, bundleDigest)`, keeps audio as the master clock, and falls back seamlessly per scene
 * to the worker-drawn MP4 clip when a scene cannot play live.
 */
export function PlateLiveStage({
  projectId,
  scenes,
  referenceFrames,
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
  onQualityJobProgress,
  onStoreStatusChange,
  audioTimeline,
  qualityJobText,
  storeDisabledReason,
  liveOptions
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
  const activeCheckHostsRef = useRef<Set<WorkerHost>>(new Set());
  const checkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const checksRunRef = useRef<number>(0);
  const stillFailedRef = useRef<Set<number>>(new Set());

  const [revisionTick, setRevisionTick] = useState(0);
  const bump = () => {
    if (mountedRef.current) {
      setRevisionTick((n) => n + 1);
    }
  };

  const clockTimeRef = useRef<number>(time);
  const playingRef = useRef<boolean>(playing);
  const playSceneSfxRef = useRef(playSceneSfx);
  const tickSceneSfxRef = useRef(tickSceneSfx);
  const onSetTimeRef = useRef(onSetTime);
  const onAdvanceSceneRef = useRef(onAdvanceScene);
  const lastCheckedFrameRef = useRef<number>(-1);
  clockTimeRef.current = time;
  playingRef.current = playing;
  playSceneSfxRef.current = playSceneSfx;
  tickSceneSfxRef.current = tickSceneSfx;
  onSetTimeRef.current = onSetTime;
  onAdvanceSceneRef.current = onAdvanceScene;

  const telemetryRef = useRef<{
    framesRendered: number;
    distinctFramesSet: Set<number>;
    lateFrames: number;
    playStartMs: number | null;
    accumulatedPlayMs: number;
  }>({
    framesRendered: 0,
    distinctFramesSet: new Set(),
    lateFrames: 0,
    playStartMs: null,
    accumulatedPlayMs: 0
  });

  const resolvedVariants = useMemo(
    () => scenes.map((s) => resolveSceneVariant(s, viewAspect, primaryAspect)),
    [scenes, viewAspect, primaryAspect]
  );

  const resolutions = useMemo(() => {
    void revisionTick;
    return resolvedVariants.map((v, idx) => {
      const keys = v.variantId ? bundleCacheKeys(v.variantId, v.rev, v.bundleDigest) : null;
      const loadedBundle = keys
        ? bundlesRef.current.get(keys.exact) ?? bundlesRef.current.get(keys.revLatest)
        : undefined;
      const effectiveDigest = loadedBundle?.bundleDigest ?? v.bundleDigest ?? null;
      const effectiveGen = Math.max(loadedBundle?.gen ?? 1, v.gen);
      const checkOutcome =
        v.variantId && effectiveDigest
          ? checkTrackerRef.current.getOutcome(v.variantId, effectiveGen, effectiveDigest) ?? null
          : null;
      const clipStatus = clipTrackerRef.current.getState(v.variantId, effectiveDigest);
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
        storeDisabledReason
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
    storeDisabledReason
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
      const win = window as unknown as { __plateLiveTelemetry?: PlateLiveTelemetry };
      win.__plateLiveTelemetry = {
        framesRendered: t.framesRendered,
        distinctFrames: t.distinctFramesSet.size,
        lateFrames: t.lateFrames,
        achievedFps: fps,
        elapsedPlaySeconds: Math.round(elapsedSec * 100) / 100,
        checksRun: checksRunRef.current,
        decisions: resolutions.map((r, i) => ({
          index: i,
          mode: r.mode,
          reason: r.reason,
          state: r.tabState,
          rev: resolvedVariants[i]?.rev ?? 0,
          gen: resolvedVariants[i]?.gen ?? 1,
          bundleDigest: resolvedVariants[i]?.bundleDigest ?? null
        }))
      };
    }
  }, [resolutions, resolvedVariants, onResolutionsChange, liveOptions]);

  // Clean up FilmPlayer and any active check hosts on unmount, project change, or aspect change.
  useEffect(() => {
    mountedRef.current = true;
    const checkHosts = activeCheckHostsRef.current;
    const mountedSpecs = mountedSpecsRef;
    const playerDecisions = playerDecisionsRef.current;
    const playerReady = playerReadyRef.current;
    const bufferingScenes = bufferingScenesRef.current;
    const fetchingBundles = fetchingBundlesRef.current;
    return () => {
      mountedRef.current = false;
      for (const h of checkHosts) {
        try {
          h.destroy();
        } catch {}
      }
      checkHosts.clear();
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
    };
  }, [projectId, viewAspect]);

  // Fetch bundles, run fenced browser checks once per (variantId, gen, bundleDigest), and request fallback clips.
  useEffect(() => {
    const envArg = liveOptions?.environment;
    const envSupported = envArg !== undefined ? supportsWorkerHost(envArg) : supportsWorkerHost();

    const triggerClipRequest = async (variantId: string, bundleDigest: string | null | undefined, hasClip: boolean) => {
      if (!clipTrackerRef.current.shouldRequest(variantId, bundleDigest, hasClip)) return;
      if (!clipTrackerRef.current.begin(variantId, bundleDigest)) return;
      const res = await requestClip(projectId, variantId, LIVE_API);
      if (!mountedRef.current) return;
      if (res.status === "rendering") {
        clipTrackerRef.current.complete(variantId, bundleDigest, "rendering");
        bump();
        onStatusRefresh();
      } else if (res.status === "clip_cap") {
        clipTrackerRef.current.complete(variantId, bundleDigest, "clip_cap");
        bump();
      } else {
        clipTrackerRef.current.failTransient(variantId, bundleDigest);
      }
    };

    resolvedVariants.forEach((v, idx) => {
      // Clear cached bundle entries if a variant is currently queued or authoring a new revision/repair.
      if (v.variantId && (v.state === "queued" || v.state === "authoring")) {
        for (const k of [...bundlesRef.current.keys()]) {
          if (k.startsWith(`${v.variantId}:`)) {
            bundlesRef.current.delete(k);
          }
        }
        return;
      }

      const res = resolutions[idx];
      if (!res) return;

      // If scene needs a clip request (e.g. unverified environment or fallback with no clip yet)
      if (res.needsClipRequest && v.variantId) {
        void triggerClipRequest(v.variantId, v.bundleDigest, v.hasClip);
        return;
      }

      if (!v.hasBundle || !v.variantId || !envSupported) return;

      const keys = bundleCacheKeys(v.variantId, v.rev, v.bundleDigest);
      const existingBundle =
        bundlesRef.current.get(keys.exact) ??
        (v.bundleDigest ? undefined : bundlesRef.current.get(keys.revLatest));

      const runSceneCheckIfNeeded = async (b: FetchedBundle) => {
        const gen = Math.max(b.gen ?? 1, v.gen);
        const digest = b.bundleDigest;
        if (v.state !== "bundled") return;
        if (!checkTrackerRef.current.shouldCheck(v.variantId, gen, digest, v.state)) return;
        if (!checkTrackerRef.current.begin(v.variantId!, gen, digest)) return;

        // One check at a time per page: several full-size Workers drawing at once can push the browser off its GPU canvas path
        // and make a healthy scene look non-deterministic.
        const previousChecks = checkQueueRef.current;
        let releaseCheckSlot: () => void = () => {};
        checkQueueRef.current = new Promise<void>((resolve) => { releaseCheckSlot = resolve; });
        await previousChecks;
        const checkHost = new WorkerHost({ html: b.html, params: b.params });
        activeCheckHostsRef.current.add(checkHost);
        let outcome;
        try {
          checksRunRef.current += 1;
          outcome = await runCheck(checkHost, b.manifest);
        } finally {
          activeCheckHostsRef.current.delete(checkHost);
          checkHost.destroy();
          releaseCheckSlot();
        }

        if (!mountedRef.current) {
          checkTrackerRef.current.failTransient(v.variantId!, gen, digest);
          return;
        }

        checkTrackerRef.current.complete(v.variantId!, gen, digest, outcome);

        if (!outcome.ok && outcome.kind === "env") {
          forcedClipRef.current.set(`${v.variantId}:g${gen}:${digest}`, "check-env");
        }
        bump();

        await reportCheck(
          projectId,
          v.variantId!,
          {
            gen,
            bundleDigest: digest,
            results: outcome,
            device: {
              ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
              env: envArg !== undefined ? environmentStatus(envArg) : environmentStatus()
            }
          },
          LIVE_API
        );

        if (!mountedRef.current) return;

        if (!outcome.ok && outcome.kind === "env") {
          await triggerClipRequest(v.variantId!, digest, v.hasClip);
        }
        bump();
        onStatusRefresh();
      };

      if (existingBundle) {
        void runSceneCheckIfNeeded(existingBundle);
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
          await runSceneCheckIfNeeded(b);
        } catch {
          fetchingBundlesRef.current.delete(keys.exact);
          failedBundleKeysRef.current.add(keys.exact);
          bump();
          // A bundle this page cannot load (route refused, storage unreachable, digest mismatch) never plays live, so ask for
          // the scene's clip instead of leaving it waiting on a check that will not run.
          if (mountedRef.current) await triggerClipRequest(v.variantId!, v.bundleDigest, v.hasClip);
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

    // Wait until at least one scene has a bundle or clip, and wait for initial bundle fetches & checks before first mount.
    if (!filmPlayerRef.current && envSupported) {
      const anyPlayableOrBundled = resolvedVariants.some((v) => v.hasBundle || v.hasClip);
      if (!anyPlayableOrBundled) return;
      const anyInitialBundleOrCheckPending = resolvedVariants.some((v) => {
        if (!v.hasBundle || !v.variantId) return false;
        const keys = bundleCacheKeys(v.variantId, v.rev, v.bundleDigest);
        const loaded = bundlesRef.current.get(keys.exact) ?? bundlesRef.current.get(keys.revLatest);
        if (!loaded) return !failedBundleKeysRef.current.has(keys.exact);
        const effectiveGen = Math.max(loaded.gen ?? 1, v.gen);
        if (v.state === "bundled" && !checkTrackerRef.current.hasCompleted(v.variantId, effectiveGen, loaded.bundleDigest)) {
          return true;
        }
        return false;
      });
      if (anyInitialBundleOrCheckPending) return;
    }

    const buildSpecForIndex = (idx: number): { spec: FilmSceneSpec; key: string } => {
      const v = resolvedVariants[idx]!;
      const durSec = durations[idx] ?? v.seconds;
      const keys = v.variantId ? bundleCacheKeys(v.variantId, v.rev, v.bundleDigest) : null;
      const loadedBundle = keys
        ? bundlesRef.current.get(keys.exact) ?? bundlesRef.current.get(keys.revLatest)
        : undefined;
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

      const canMountLive =
        envSupported &&
        Boolean(loadedBundle) &&
        !forcedReason &&
        (v.state === "checked" || v.state === "drawn" || checkOutcome?.ok === true);

      const forceClipReason = !envSupported
        ? (envArg !== undefined ? environmentStatus(envArg) : environmentStatus()) === "unverified"
          ? "unverified-environment"
          : "unsupported-environment"
        : forcedReason
          ? forcedReason
          : !canMountLive
            ? v.state === "drawn" && !v.hasBundle
              ? "clip-only"
              : "pending-live"
            : undefined;

      const spec: FilmSceneSpec = {
        id: `scene-${idx}`,
        bundleDigest: effectiveDigest,
        html: canMountLive && loadedBundle ? loadedBundle.html : "",
        params: canMountLive && loadedBundle ? loadedBundle.params : {},
        frames: v.frames,
        durationSeconds: durSec,
        environment: envArg,
        variantKey: `${projectId}:${v.variantId ?? `scene-${idx}`}:${viewAspect}`,
        ...(forceClipReason ? { forceClipReason } : {})
      };

      const key = `${idx}:r${v.rev}:g${effectiveGen}:${spec.bundleDigest}:${canMountLive ? "live" : forceClipReason ?? "clip"}:${spec.frames}:${durSec}`;
      return { spec, key };
    };

    const nextSpecsAndKeys = resolvedVariants.map((_, idx) => buildSpecForIndex(idx));

    if (!filmPlayerRef.current) {
      container.innerHTML = "";
      const fp = createFilmPlayer({
        scenes: nextSpecsAndKeys.map((x) => x.spec),
        filmKey: projectId,
        aspect: viewAspect,
        fps: 30,
        budgetBytes: resolveCacheBudgetBytes(),
        previewQuality,
        onQualityProgress: onQualityJobProgress,
        onStoreStatus: onStoreStatusChange,
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
        const d = detail as { sceneIndex?: number; mode?: "live" | "clip"; reason?: string; progress?: number } | undefined;
        if (d && typeof d.sceneIndex === "number" && (d.mode === "live" || d.mode === "clip")) {
          if (d.mode === "clip" && (d.reason === "pending-live" || d.reason === "no-bundle")) {
            return;
          }
          const dec: PlayerDecision = {
            mode: d.mode,
            reason: d.reason ?? "ok",
            ...(typeof d.progress === "number" ? { progress: d.progress } : {})
          };
          playerDecisionsRef.current.set(d.sceneIndex, dec);
          if (d.mode === "clip") {
            const v = resolvedVariants[d.sceneIndex];
            if (v?.variantId && v.bundleDigest) {
              forcedClipRef.current.set(`${v.variantId}:g${v.gen}:${v.bundleDigest}`, d.reason ?? "clip");
            }
          }
          bump();
        }
      });

      fp.on("buffering", (detail) => {
        if (filmPlayerRef.current !== fp) return;
        const d = detail as { sceneIndex?: number; buffering?: boolean } | undefined;
        if (d && typeof d.sceneIndex === "number") {
          if (d.buffering) {
            bufferingScenesRef.current.add(d.sceneIndex);
            if (d.sceneIndex === current) {
              audioTimeline?.setBuffering(true);
              voices.current[current]?.pause();
              musicAudio.current?.pause();
              clearSfxTimers();
              Object.values(sfxAudios.current).forEach((el) => el?.pause());
            }
          } else {
            bufferingScenesRef.current.delete(d.sceneIndex);
            if (d.sceneIndex === current) {
              audioTimeline?.setBuffering(false);
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
              const dec = fp.decision(idx);
              if (dec.reason !== "pending-live" && dec.reason !== "no-bundle") {
                playerDecisionsRef.current.set(idx, dec);
              }
              if (dec.mode === "live") {
                playerReadyRef.current.add(idx);
              }
              if (liveOptions?.forceBuffering && idx === 0) {
                fp.showFrame(45);
              } else {
                fp.syncToClock();
              }
              bump();
            } catch {
              // ignore
            }
          })();
        }
      });
    }
  }, [resolvedVariants, durations, viewAspect, revisionTick, liveOptions?.environment, liveOptions?.forceBuffering]);

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

  // Synchronize FilmPlayer before paint whenever `time` or `current` changes so scene-boundary switches never flash.
  useIsomorphicLayoutEffect(() => {
    clockTimeRef.current = time;
    const fp = filmPlayerRef.current;
    if (fp && !liveOptions?.forceBuffering) {
      fp.syncToClock();
    }
  }, [time, current, liveOptions?.forceBuffering]);

  // Single clock RAF loop when playing a live scene (pauses clock and all audio during initial drawing or mid-scene buffering).
  const activeRes = resolutions[current];
  const activeSceneShowsLive = activeRes?.mode === "live" && activeRes.isPlayable;
  const activeScenePausedForBuffer = Boolean(activeRes?.isPreparing || activeRes?.isBuffering);
  const activeSceneIsLive = activeSceneShowsLive && !activeScenePausedForBuffer;

  useEffect(() => {
    if (!playing || !activeSceneIsLive) {
      if (playing && activeSceneShowsLive && activeScenePausedForBuffer) {
        // Hold clock and suspend Web Audio timeline (and pause fallback elements) at the same instant while buffering or drawing.
        audioTimeline?.setBuffering(true);
        voices.current[current]?.pause();
        musicAudio.current?.pause();
        clearSfxTimers();
        Object.values(sfxAudios.current).forEach((el) => el?.pause());
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
        if (vo.readyState >= 1) {
          vo.currentTime = Number.isFinite(vo.duration)
            ? Math.min(Math.max(0, vo.duration - 0.05), startLocal)
            : startLocal;
        }
        void vo.play().catch(() => undefined);
      }

      if (musicAudio.current && musicSrc) {
        musicAudio.current.muted = !musicOn || muted;
        musicAudio.current.volume = 0.22 * master;
        musicAudio.current.currentTime = clockTimeRef.current;
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

      clockTimeRef.current = nextGlobalTime;
      onSetTimeRef.current(nextGlobalTime);

      if (fp) {
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
        fp.syncToClock();
        if (fp.scenes[current]?.isBufferingNow || fp.scenes[current]?.isPreparing) {
          audioTimeline?.setBuffering(true);
          voices.current[current]?.pause();
          musicAudio.current?.pause();
          Object.values(sfxAudios.current).forEach((el) => el?.pause());
          return;
        }
      }

      const curVo = voices.current[current];
      const voStillRunning = useWebAudio
        ? false
        : Boolean(
            curVo && !curVo.paused && !curVo.ended && Number.isFinite(curVo.duration) && curVo.duration - curVo.currentTime > 0.08
          );

      if (localSec >= sceneDur && !voStillRunning) {
        onAdvanceSceneRef.current(current);
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (telemetryRef.current.playStartMs !== null) {
        telemetryRef.current.accumulatedPlayMs += performance.now() - telemetryRef.current.playStartMs;
        telemetryRef.current.playStartMs = null;
      }
    };
  }, [
    playing,
    activeSceneIsLive,
    activeSceneShowsLive,
    activeScenePausedForBuffer,
    current,
    starts,
    durations,
    resolvedVariants,
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

  // Determine whether the stage wait overlay should be displayed for the currently selected scene.
  let stagePrep: { failed: boolean; title: React.ReactNode; detail?: React.ReactNode } | null = null;
  if (prep === "sound") {
    stagePrep = {
      failed: false,
      title: "Making the voiceover and music…",
      detail: "Recording the narration and building the music bed"
    };
  } else if (prep === "scenes") {
    stagePrep = {
      failed: false,
      title: "Planning the scenes…",
      detail: "Preparing the storyboard timing"
    };
  } else if (!shownResolution || !shownVariant) {
    stagePrep = {
      failed: false,
      title: "Preparing the scenes…",
      detail: <>Scene 1 of {scenes.length || "…"}</>
    };
  } else if (viewAspect !== primaryAspect && !isViewAspectDrawn && !shownResolution.isPlayable && isViewAspectDrawing) {
    stagePrep = {
      failed: false,
      title: <>Drawing scenes in {viewAspect}…</>,
      detail: <>Drawing every scene on a {viewAspect} canvas so no character is cropped</>
    };
  } else if (shownResolution.stageWait) {
    stagePrep = {
      failed: shownResolution.stageWait.failed,
      title: shownResolution.stageWait.title,
      detail:
        shownResolution.stageWait.detail ?? (
          <>
            Scene {current + 1} of {scenes.length || "…"}
          </>
        )
    };
  }

  const refFrameSrc = referenceFrames?.[current] ?? null;
  const showStillFallback =
    Boolean(shownVariant && shownResolution?.mode === "clip" && !shownVariant.hasClip) &&
    (Boolean(refFrameSrc) || !stillFailedRef.current.has(current));
  const stillUrl =
    refFrameSrc ??
    (shownVariant
      ? `${outputUrl(`/v1/projects/${encodeURIComponent(projectId)}/plates/${shownVariant.index}/still`)}${
          outputUrl("/x").includes("?") ? "&" : "?"
        }aspect=${encodeURIComponent(viewAspect)}`
      : null);

  return (
    <>
      <div
        ref={hostContainerRef}
        className="aw-live-canvas-host"
        data-live-active={activeSceneShowsLive ? "true" : "false"}
        data-live-decisions={decisionsSummary}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: activeSceneShowsLive ? 2 : 0,
          opacity: activeSceneShowsLive ? 1 : 0
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
            opacity: 0.45,
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
        const isCurrentClip = v.index === current && res?.mode === "clip";
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
            onLoadedData={() => onLoadedVideo(v.index)}
            onError={(e) => {
              const el = e.currentTarget;
              const tries = Number(el.dataset.retries ?? "0");
              if (tries >= 2) return;
              el.dataset.retries = String(tries + 1);
              window.setTimeout(() => el.load(), 1500 * (tries + 1));
            }}
            onPlay={(e) => {
              if (v.index !== current || res?.mode !== "clip") return;
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
              if (v.index !== current || res?.mode !== "clip") return;
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
              if (v.index === current && res?.mode === "clip" && !playing) {
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
          title={stagePrep.title}
          detail={stagePrep.detail}
        />
      )}
    </>
  );
}
