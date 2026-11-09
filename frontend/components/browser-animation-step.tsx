"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import {
  applyCandidatePatchToPreviewHtml,
  hasEditPatchOperations,
  mergeWindowElements,
  renderCostMillitokens,
  resolveBeatWindowTimes,
  tokensFromMilli,
  type ActiveElementInfo,
  type AudioMode,
  type EditPatch,
  type FrameElementsSnapshot,
  type ScriptBeat,
  type VideoProject
} from "@videosaas/contracts";
import {
  AnimationPrep,
  AnimationWorkspace,
  anchorCommentAtTime,
  audioModeFromToggles,
  audioTogglesFromMode,
  groupCommentsByScene,
  hfAvailableAudioTracks,
  hfOptionsConfig,
  isPlateLookId,
  plateOptionsConfig,
  sceneSpansFromBeatTimes,
  sortWorkspaceComments,
  toggleAudioTrackMode,
  type HfBeatSpan,
  type WorkspaceAspect,
  type WorkspaceAspectOption,
  type WorkspaceComment,
  type WorkspaceMotionBlurControlState,
  type WorkspaceSceneTab,
  type WorkspaceSubtitleMode,
  type WorkspaceSubtitleStyle
} from "./animation-workspace";
import type { FrameLook } from "./beat-storyboard";
import { TokenModal, svgSrc } from "./script-canvas";
import {
  commitPlanCommentEdits,
  editPlan,
  ensureMediaToken,
  getComposition,
  getMyTokens,
  PlanEditRefusedError,
  projectScreenshotUrl,
  proposePlanCommentEdits,
  undoPlanElementOverride,
  type PlanAudioStatus
} from "../lib/api";

export {
  anchorCommentAtTime,
  audioModeFromToggles,
  audioTogglesFromMode,
  groupCommentsByScene,
  hfAvailableAudioTracks,
  hfOptionsConfig,
  sceneSpansFromBeatTimes,
  toggleAudioTrackMode
};

export type FrameReelItem = {
  /** 0-based scene index in the saved storyboard order (never compacted). */
  index: number;
  /** Scene title / keyword, e.g. "A hen wants bread". */
  label: string;
  /** Optional on-screen copy or spoken line for scene context. */
  subtitle?: string | null;
  /** Primary visual source (raw SVG string, data URI, or authenticated URL). Null when unavailable. */
  src: string | null;
  /** Secondary fallback visual source (e.g. saved storyboard SVG when a plate still URL fails). */
  fallbackSrc?: string | null;
  /** Per-scene state when `src` is not yet ready. */
  state?: "ready" | "loading" | "unavailable";
};

/** The storyboard's own frames while the film renders: one large, stepping through them, and the whole strip below. */
export function FrameReel({
  frames,
  items,
  aspect = "16:9",
  loading = false,
  projectName
}: {
  frames?: (string | null | undefined)[];
  items?: FrameReelItem[];
  aspect?: string;
  loading?: boolean;
  projectName?: string;
}) {
  const normalizedAspect = aspect === "9:16" || aspect === "1:1" ? aspect : "16:9";
  const sceneItems: FrameReelItem[] = useMemo(() => {
    if (items) return items;
    return (frames ?? []).map((raw, i) => ({
      index: i,
      label: `Scene ${i + 1}`,
      subtitle: null,
      src: raw ? svgSrc(raw) : null
    }));
  }, [items, frames]);

  const [at, setAt] = useState(0);
  const [userSelected, setUserSelected] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Record<string, true>>({});
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const resolveItemSrc = (item: FrameReelItem): { activeSrc: string | null; primarySrc: string | null; fallbackSrc: string | null } => {
    const primarySrc = item.src ? svgSrc(item.src) : null;
    const fallbackSrc = item.fallbackSrc ? svgSrc(item.fallbackSrc) : null;
    const primaryKey = primarySrc ? `${item.index}:${primarySrc}` : "";
    const fallbackKey = fallbackSrc ? `${item.index}:${fallbackSrc}` : "";
    if (primarySrc && !failedUrls[primaryKey]) {
      return { activeSrc: primarySrc, primarySrc, fallbackSrc };
    }
    if (fallbackSrc && !failedUrls[fallbackKey]) {
      return { activeSrc: fallbackSrc, primarySrc, fallbackSrc };
    }
    return { activeSrc: null, primarySrc, fallbackSrc };
  };

  const resolvedList = useMemo(
    () => sceneItems.map((item) => ({ item, ...resolveItemSrc(item) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneItems, failedUrls]
  );

  const readyIndices = useMemo(
    () => resolvedList.filter((r) => Boolean(r.activeSrc)).map((r) => r.item.index),
    [resolvedList]
  );

  useEffect(() => {
    setAt(0);
    setUserSelected(false);
  }, [projectName, sceneItems.length]);

  useEffect(() => {
    if (userSelected) return;
    const currentHasSrc = Boolean(resolvedList[at]?.activeSrc);
    if (!currentHasSrc && readyIndices.length > 0) {
      setAt(readyIndices[0]!);
    }
  }, [at, userSelected, resolvedList, readyIndices]);

  useEffect(() => {
    if (userSelected || readyIndices.length < 2) return;
    const timer = window.setInterval(() => {
      setAt((current) => {
        const pos = readyIndices.indexOf(current);
        if (pos === -1) return readyIndices[0]!;
        return readyIndices[(pos + 1) % readyIndices.length]!;
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [userSelected, readyIndices]);

  const markUrlFailed = (index: number, url: string | null) => {
    if (!url) return;
    const key = `${index}:${url}`;
    setFailedUrls((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const clampedAt = sceneItems.length > 0 ? Math.min(Math.max(0, at), sceneItems.length - 1) : 0;
  const activeEntry = resolvedList[clampedAt];
  const activeItem = activeEntry?.item;
  const activeSrc = activeEntry?.activeSrc ?? null;
  const anyReady = readyIndices.length > 0;
  const isInitialLoading = loading && !anyReady;
  const isActiveSceneLoading = !activeSrc && (loading || activeItem?.state === "loading");

  const selectScene = (nextIdx: number, focusThumb = false) => {
    if (nextIdx < 0 || nextIdx >= sceneItems.length) return;
    setUserSelected(true);
    setAt(nextIdx);
    if (focusThumb) {
      const btn = thumbRefs.current[nextIdx];
      btn?.focus();
      btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const handleStripKeyDown = (ev: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (sceneItems.length < 2) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      ev.preventDefault();
      selectScene((idx + 1) % sceneItems.length, true);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      ev.preventDefault();
      selectScene((idx - 1 + sceneItems.length) % sceneItems.length, true);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      selectScene(0, true);
    } else if (ev.key === "End") {
      ev.preventDefault();
      selectScene(sceneItems.length - 1, true);
    }
  };

  return (
    <div className="frame-reel" data-aspect={normalizedAspect}>
      <header className="frame-reel-head">
        <div className="frame-reel-title">
          <span className="frame-reel-step">
            {sceneItems.length > 0 ? `Scene ${clampedAt + 1} of ${sceneItems.length}` : "Storyboard"}
          </span>
          <strong>{activeItem?.label ?? projectName ?? "Storyboard preview"}</strong>
          {activeItem?.subtitle && <small className="frame-reel-subtitle">{activeItem.subtitle}</small>}
        </div>
        <span className="frame-reel-aspect">{normalizedAspect}</span>
      </header>
      <div className="frame-reel-stage" data-aspect={normalizedAspect}>
        {resolvedList.map(({ item, activeSrc: itemSrc }, i) =>
          itemSrc ? (
            <img
              key={`${item.index}-${itemSrc}`}
              className={i === clampedAt ? "on" : ""}
              src={itemSrc}
              alt={i === clampedAt ? `Storyboard frame ${i + 1} of ${sceneItems.length}: ${item.label}` : ""}
              draggable={false}
              onError={() => markUrlFailed(item.index, itemSrc)}
            />
          ) : null
        )}
        {!activeSrc && (
          <div className="frame-reel-empty" role="status" aria-live="polite">
            {isInitialLoading || isActiveSceneLoading ? (
              <>
                <span className="gm-spinner" aria-hidden="true" />
                <b>Loading storyboard…</b>
                <p>
                  {activeItem
                    ? `Scene ${clampedAt + 1} · ${activeItem.label}`
                    : projectName || "Loading saved storyboard scenes…"}
                </p>
              </>
            ) : anyReady && activeItem ? (
              <>
                <span className="frame-reel-empty-badge">
                  Scene {clampedAt + 1} of {sceneItems.length}
                </span>
                <b>{activeItem.label}</b>
                {activeItem.subtitle && <p className="frame-reel-empty-copy">{activeItem.subtitle}</p>}
                <small>Scene preview unavailable · choose another scene below</small>
              </>
            ) : (
              <>
                <b>Storyboard preview unavailable</b>
                <p>
                  {activeItem
                    ? `Scene ${clampedAt + 1} · ${activeItem.label}${activeItem.subtitle ? ` — ${activeItem.subtitle}` : ""}`
                    : projectName
                    ? `${projectName} continues rendering while the preview is unavailable.`
                    : "Saved scene previews are unavailable for this project right now."}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {sceneItems.length > 0 && (
        <ol className="frame-reel-strip" aria-label="Storyboard scenes">
          {resolvedList.map(({ item, activeSrc: itemSrc }, i) => (
            <li key={item.index}>
              <button
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
                type="button"
                className={i === clampedAt ? "on" : ""}
                aria-label={`Show frame ${i + 1}: ${item.label}`}
                aria-current={i === clampedAt}
                onClick={() => selectScene(i)}
                onKeyDown={(ev) => handleStripKeyDown(ev, i)}
              >
                <span className="frame-reel-thumb" data-aspect={normalizedAspect}>
                  {itemSrc ? (
                    <img
                      src={itemSrc}
                      alt=""
                      draggable={false}
                      onError={() => markUrlFailed(item.index, itemSrc)}
                    />
                  ) : (
                    <i className="frame-reel-thumb-num">{String(i + 1).padStart(2, "0")}</i>
                  )}
                </span>
                <span className="frame-reel-caption">
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  <span>{item.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Preview({
  project,
  title,
  screenshot,
  look
}: {
  project: VideoProject;
  title: string;
  screenshot?: string;
  look?: FrameLook;
}) {
  const branded = look
    ? ({
        "--sm-bg": look.bg,
        "--sm-fg": look.fg,
        "--sm-muted": look.muted,
        "--sm-brand": look.brand,
        "--sm-font": look.font
      } as React.CSSProperties)
    : undefined;
  return (
    <div className={look ? "scene-mock branded" : "scene-mock"} style={branded}>
      <div className="scene-browser">
        <span />
        <span />
        <span />
      </div>
      <div className="scene-copy">
        <small>{project.name.toUpperCase()}</small>
        <h2>{title}</h2>
        <p>{project.script?.lines[0]?.voiceover || "This preview reflects the saved project inputs."}</p>
      </div>
      {screenshot ? (
        <img className="scene-screenshot" src={screenshot} alt="" />
      ) : (
        <div className="scene-product">
          <b>No screenshot yet</b>
          <span>Upload a real product screenshot in the Script step.</span>
        </div>
      )}
    </div>
  );
}

export function formatVideoTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return Math.floor(wholeSeconds / 60) + ":" + String(wholeSeconds % 60).padStart(2, "0");
}

function initialAudioMode(project: VideoProject): AudioMode {
  if (project.brief?.audio?.mode) return project.brief.audio.mode;
  const hasVo = Boolean(project.beatPlan?.audio.voice);
  const hasMu = Boolean(project.beatPlan?.audio.music);
  return hasVo && hasMu ? "both" : hasVo ? "voiceover" : hasMu ? "music" : "none";
}

async function reloadPlayerSrcdocAndWait(
  player: HyperframesPlayer,
  html: string,
  loadToken: string,
  signal: AbortSignal,
  timeoutMs = 8_000
): Promise<{ elementsAt: (t: number) => ActiveElementInfo[] }> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const prevWin = player.iframeElement?.contentWindow as unknown as { __bp?: unknown } | null;
  if (prevWin && prevWin.__bp) {
    delete prevWin.__bp;
  }
  const tokenTag = `<meta name="hf-load-token" content="${loadToken}">`;
  const stampedHtml = html.includes("</head>")
    ? html.replace("</head>", () => `${tokenTag}</head>`)
    : `${tokenTag}${html}`;
  player.setAttribute("srcdoc", stampedHtml);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    await new Promise<void>((resolveWait, rejectWait) => {
      const onAbort = () => {
        window.clearTimeout(timer);
        rejectWait(new DOMException("Aborted", "AbortError"));
      };
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolveWait();
      }, 25);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const win = player.iframeElement?.contentWindow as unknown as {
      __bp?: { elementsAt?: (t: number) => ActiveElementInfo[] };
      document?: Document;
      requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    } | null;
    const doc = win?.document;
    const docToken = doc?.querySelector('meta[name="hf-load-token"]')?.getAttribute("content");
    if (
      win &&
      doc &&
      doc.readyState === "complete" &&
      docToken === loadToken &&
      typeof win.__bp?.elementsAt === "function"
    ) {
      if (doc.fonts?.ready) {
        await doc.fonts.ready.catch(() => undefined);
      }
      if (typeof win.requestAnimationFrame === "function") {
        await new Promise<void>((r) => win.requestAnimationFrame!(() => r()));
      }
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return { elementsAt: win.__bp.elementsAt };
    }
  }
  throw new Error("Timed out reloading the preview composition.");
}

/**
 * Step 3 (Animation) adapter for HyperFrames compositions, built on the shared
 * `AnimationWorkspace` and `AnimationPrep` shell.
 */
export function BrowserAnimationStep({
  project,
  beats,
  frames,
  aspect,
  animating,
  animProgress,
  animStage,
  animScenesDone,
  animError,
  animVersion,
  busy,
  motionBlur,
  setMotionBlur,
  durationSeconds,
  notice,
  onRetryAnimate,
  onBackToStoryboard,
  onStartFinalRender,
  onApplySceneComments
}: {
  project: VideoProject;
  beats: ScriptBeat[];
  frames: string[];
  aspect: string;
  animating: boolean;
  animProgress: number;
  animStage: "frames" | "voice" | "motion";
  animScenesDone: number[];
  animError: string | null;
  animVersion: number;
  busy: boolean;
  motionBlur?: boolean;
  setMotionBlur?: (on: boolean) => void;
  durationSeconds?: number;
  notice?: string | null;
  onRetryAnimate: () => void;
  onBackToStoryboard: () => void;
  onStartFinalRender: () => void;
  onApplySceneComments: (items: { line: number; text: string }[]) => Promise<void>;
}) {
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const autoTriggered = useRef(false);
  const currentTimeRef = useRef(0);
  const applyingRef = useRef(false);
  const reloadAbortRef = useRef<AbortController | null>(null);
  const reloadSeqRef = useRef(0);
  const undoingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      reloadAbortRef.current?.abort();
    };
  }, []);

  const nextReloadJob = () => {
    reloadAbortRef.current?.abort();
    const ctrl = new AbortController();
    reloadAbortRef.current = ctrl;
    reloadSeqRef.current += 1;
    return { token: `hf-load-${reloadSeqRef.current}`, signal: ctrl.signal };
  };

  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    project.beatPlan?.target_duration_s ?? project.brief?.durationSeconds ?? 30
  );
  const [beatSpans, setBeatSpans] = useState<HfBeatSpan[]>([]);
  const [compAudio, setCompAudio] = useState<PlanAudioStatus | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState("");
  const [timedComments, setTimedComments] = useState<WorkspaceComment[]>([]);
  const [applyingComments, setApplyingComments] = useState(false);
  const [updatingScenes, setUpdatingScenes] = useState<number[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [buyingTokens, setBuyingTokens] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);
  const [localMotionBlur, setLocalMotionBlur] = useState(false);

  const effectiveMotionBlur = motionBlur ?? localMotionBlur;
  const effectiveSetMotionBlur = setMotionBlur ?? setLocalMotionBlur;
  const effectiveDuration = durationSeconds ?? duration;

  const defaultAspect = (
    aspect === "9:16" || aspect === "1:1" || aspect === "16:9"
      ? aspect
      : project.beatPlan?.canvas ?? project.brief?.aspect ?? "16:9"
  ) as WorkspaceAspect;
  const [viewAspect, setViewAspect] = useState<WorkspaceAspect>(defaultAspect);

  useEffect(() => {
    setViewAspect(defaultAspect);
  }, [defaultAspect]);

  const [subMode, setSubMode] = useState<WorkspaceSubtitleMode>(
    () => (project.beatPlan?.audio.captions ?? project.brief?.captions ?? "key-phrases") as WorkspaceSubtitleMode
  );
  const [audioModeState, setAudioModeState] = useState<AudioMode>(() => initialAudioMode(project));

  useEffect(() => {
    const nextCap = project.beatPlan?.audio.captions ?? project.brief?.captions;
    if (nextCap) setSubMode(nextCap as WorkspaceSubtitleMode);
  }, [project.beatPlan?.audio.captions, project.brief?.captions]);

  useEffect(() => {
    setAudioModeState(initialAudioMode(project));
  }, [project.brief?.audio?.mode, project.beatPlan?.audio.voice, project.beatPlan?.audio.music]);

  const effectiveVersion = animVersion + localVersion;

  useEffect(() => {
    let live = true;
    void import("@hyperframes/player")
      .then(() => {
        if (live) setPlayerLoaded(true);
      })
      .catch(() => undefined);
    getMyTokens()
      .then((t) => {
        if (live) setBalance(t.remaining);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // If the user jumped to Step 3 (Animation) before beatPlan was built, kick off the parallel animation preparation once
  useEffect(() => {
    if (!project.beatPlan && beats.length > 0 && !animating && !animError && !autoTriggered.current) {
      autoTriggered.current = true;
      onRetryAnimate();
    }
  }, [project.beatPlan, beats.length, animating, animError, onRetryAnimate]);

  // Load the live HyperFrames composition HTML (/api/preview/plans/:id) once animation preparation finishes or version bumps
  useEffect(() => {
    if (animating || !project.beatPlan) return;
    let live = true;
    const controller = new AbortController();
    setPreviewError(null);
    void (async () => {
      try {
        const comp = await getComposition(project.id);
        const token = encodeURIComponent(await ensureMediaToken());
        const res = await fetch(
          `${comp.baseUrl.replace(/^\/v1\/preview\//, "/api/preview/")}?t=${token}&v=${effectiveVersion}`,
          {
            cache: "no-store",
            signal: controller.signal
          }
        );
        if (!res.ok) throw new Error(`Preview returned ${res.status}.`);
        const html = await res.text();
        if (!live) return;
        const nextDur = comp.durationSeconds || project.beatPlan?.target_duration_s || 30;
        setDuration(nextDur);
        if (comp.audio) {
          setCompAudio(comp.audio);
        }
        const spans = sceneSpansFromBeatTimes(
          project.beatPlan?.beats ?? [],
          comp.beatTimes,
          nextDur
        );
        setBeatSpans(spans);
        setPreviewHtml(html);
      } catch (caught) {
        if (!live || controller.signal.aborted) return;
        setPreviewError(caught instanceof Error ? caught.message : "Could not load the browser animation.");
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [animating, project.id, project.beatPlan, effectiveVersion]);

  // Wire <hyperframes-player> events and srcdoc
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerLoaded || !previewHtml) return;
    const onReady = (ev: Event) => {
      const d = (ev as CustomEvent<{ duration: number }>).detail?.duration;
      if (typeof d === "number" && d > 0) setDuration(d);
      if (currentTimeRef.current >= 0) {
        player.currentTime = currentTimeRef.current;
      }
    };
    const onTime = (ev: Event) => {
      const t = (ev as CustomEvent<{ currentTime: number }>).detail?.currentTime;
      if (typeof t === "number") {
        currentTimeRef.current = t;
        setCurrentTime(t);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    player.addEventListener("ready", onReady);
    player.addEventListener("timeupdate", onTime);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    player.setAttribute("srcdoc", previewHtml);
    player.muted = muted;
    player.volume = volume;
    return () => {
      player.removeEventListener("ready", onReady);
      player.removeEventListener("timeupdate", onTime);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
    };
  }, [playerLoaded, previewHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.muted = muted;
    player.volume = volume;
  }, [muted, volume]);

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.muted = muted;
      player.volume = volume;
      player.play();
      setPlaying(true);
    }
  };

  const seek = (seconds: number) => {
    const clamped = Math.max(0, Math.min(duration, seconds));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    const player = playerRef.current;
    if (player) {
      player.pause();
      setPlaying(false);
      player.currentTime = clamped;
    }
  };

  const segments: HfBeatSpan[] = useMemo(
    () =>
      beatSpans.length
        ? beatSpans
        : sceneSpansFromBeatTimes(
            project.beatPlan?.beats?.length ? project.beatPlan.beats : beats,
            undefined,
            duration
          ),
    [beatSpans, project.beatPlan?.beats, beats, duration]
  );

  const activeSceneIndex = useMemo(
    () => anchorCommentAtTime(currentTime, segments).scene,
    [currentTime, segments]
  );

  const sortedComments = useMemo(
    () => sortWorkspaceComments(timedComments),
    [timedComments]
  );

  const cost = tokensFromMilli(renderCostMillitokens(Math.max(5, Math.round(duration))));
  const shortTokens = balance !== null && balance < cost;

  const addComment = () => {
    const body = draft.trim();
    if (!body || animating || applyingComments) return;
    if (playerRef.current && playing) {
      playerRef.current.pause();
      setPlaying(false);
    }
    const at = Math.round(currentTime * 10) / 10;
    const anchored = anchorCommentAtTime(at, segments);
    setTimedComments((curr) => [
      ...curr,
      {
        id: crypto.randomUUID(),
        body,
        at: anchored.at,
        scene: anchored.scene,
        sceneAt: anchored.sceneAt
      }
    ]);
    setDraft("");
  };

  const applyComments = async () => {
    const pendingComments = sortedComments.filter((c) => !c.appliedLabel);
    if (!pendingComments.length || animating || applyingComments || applyingRef.current) return;
    applyingRef.current = true;
    setApplyingComments(true);
    setActionError(null);
    const player = playerRef.current;
    const baseHtml = previewHtml ?? "";
    let committedAny = false;

    try {
      const iframeWin = player?.iframeElement?.contentWindow as unknown as {
        __bp?: { elementsAt?: (t: number) => ActiveElementInfo[] };
      } | null;

      // If the iframe has no __bp.elementsAt (an old composition), fall back to the existing scene-level storyboard rewrite path
      if (typeof iframeWin?.__bp?.elementsAt !== "function") {
        const payload = groupCommentsByScene(pendingComments, segments);
        const pendingIds = new Set(pendingComments.map((c) => c.id));
        setTimedComments((curr) => curr.filter((c) => !pendingIds.has(c.id)));
        try {
          await onApplySceneComments(payload);
          setTimedComments((curr) => [
            ...curr,
            ...pendingComments.map((c) => ({
              ...c,
              appliedLabel: "re-laid out the scene",
              appliedScope: "scene" as const,
              refusedReason: undefined
            }))
          ]);
          setLocalVersion((v) => v + 1);
          onRetryAnimate();
        } catch (err) {
          setTimedComments((curr) => [...curr, ...pendingComments]);
          setActionError(err instanceof Error ? err.message : "Could not apply comments.");
        }
        return;
      }

      // Two-step edit protocol:
      // 1. Sample active elements across the beat window for each comment in the user's browser
      const canvasSize =
        viewAspect === "9:16"
          ? { width: 1080, height: 1920 }
          : viewAspect === "1:1"
          ? { width: 1080, height: 1080 }
          : { width: 1920, height: 1080 };
      const savedTime = currentTimeRef.current;
      const sampleTimesByCommentId = new Map<string, number[]>();
      const beforeSnapshotsByCommentId: Record<string, FrameElementsSnapshot[]> = {};
      const mergedBeforeByCommentId = new Map<string, ActiveElementInfo[]>();
      const timingSlots = segments.map((s, idx) => ({
        id: project.beatPlan?.beats?.[idx]?.id ?? `b${idx + 1}`,
        start: s.start,
        end: s.end
      }));

      for (const c of pendingComments) {
        const beat = project.beatPlan?.beats?.[c.scene];
        const beatId = beat?.id ?? `b${c.scene + 1}`;
        const { sampleTimes } = resolveBeatWindowTimes(
          project.beatPlan
            ? { beats: project.beatPlan.beats, target_duration_s: duration }
            : {
                beats: beats.map((b, idx) => ({ id: `b${idx + 1}`, keyword: b.keyword }) as never),
                target_duration_s: duration
              },
          beatId,
          c.at,
          timingSlots
        );
        sampleTimesByCommentId.set(c.id, sampleTimes);
        const snaps: FrameElementsSnapshot[] = sampleTimes.map((t) => ({
          time: Math.round(t * 1000) / 1000,
          elements: iframeWin.__bp!.elementsAt!(t)
        }));
        beforeSnapshotsByCommentId[c.id] = snaps;
        mergedBeforeByCommentId.set(c.id, mergeWindowElements(snaps));
      }
      try {
        iframeWin.__bp.elementsAt(savedTime);
      } catch {
        // ignore
      }

      // 2. Propose: send comments + measured before-window snapshots to server
      const proposeRes = await proposePlanCommentEdits(project.id, {
        comments: pendingComments.map((c) => ({
          id: c.id,
          at: c.at,
          scene: project.beatPlan?.beats?.[c.scene]?.id ?? `b${c.scene + 1}`,
          body: c.body
        })),
        measured: {
          canvas: canvasSize,
          snapshots: beforeSnapshotsByCommentId
        }
      });

      const refusedById = new Map<string, string>();
      const activeCandidates: { id: string; patch: EditPatch; fallbackRewrite?: boolean }[] = [];
      const seenCandidateIds = new Set<string>();
      for (const cand of proposeRes.candidates) {
        seenCandidateIds.add(cand.id);
        if (cand.refused) {
          refusedById.set(cand.id, cand.refused);
        } else if (cand.patch) {
          activeCandidates.push({
            id: cand.id,
            patch: cand.patch,
            ...(cand.fallbackRewrite ? { fallbackRewrite: true } : {})
          });
        } else {
          refusedById.set(cand.id, "Could not propose an edit for this comment; nothing was saved.");
        }
      }
      for (const c of pendingComments) {
        if (!seenCandidateIds.has(c.id)) {
          refusedById.set(c.id, "No edit candidate was returned for this comment; nothing was saved.");
        }
      }

      if (refusedById.size > 0) {
        setTimedComments((curr) =>
          curr.map((item) => {
            const reason = refusedById.get(item.id);
            return reason ? { ...item, refusedReason: reason, appliedLabel: undefined } : item;
          })
        );
      }

      if (activeCandidates.length === 0) {
        return;
      }

      // 3. Apply each candidate in isolation against baseHtml via hf-variables, reload srcdoc, and re-sample the window
      const commitItems: {
        id: string;
        patch: EditPatch;
        before: FrameElementsSnapshot[];
        after: FrameElementsSnapshot[];
        fallbackRewrite?: boolean;
      }[] = [];

      for (const cand of activeCandidates) {
        const beforeSnaps = beforeSnapshotsByCommentId[cand.id] ?? [];
        const isFallback = cand.fallbackRewrite || (!cand.patch.el && !hasEditPatchOperations(cand.patch));
        if (isFallback) {
          commitItems.push({
            id: cand.id,
            patch: cand.patch,
            before: beforeSnaps,
            after: beforeSnaps,
            fallbackRewrite: true
          });
          continue;
        }

        if (!player || !baseHtml) {
          throw new Error("Preview player is not ready to measure the edit.");
        }
        const candidateHtml = applyCandidatePatchToPreviewHtml(baseHtml, [cand.patch], {
          activeElements: mergedBeforeByCommentId.get(cand.id) ?? []
        });
        if (!candidateHtml) {
          throw new Error("Could not prepare preview composition for measurement.");
        }
        const { token, signal } = nextReloadJob();
        const reloaded = await reloadPlayerSrcdocAndWait(player, candidateHtml, token, signal);
        const sampleTimes = sampleTimesByCommentId.get(cand.id) ?? [cand.patch.atSeconds];
        const afterSnaps: FrameElementsSnapshot[] = sampleTimes.map((t) => ({
          time: Math.round(t * 1000) / 1000,
          elements: reloaded.elementsAt(t)
        }));
        try {
          reloaded.elementsAt(savedTime);
        } catch {
          // ignore
        }
        commitItems.push({
          id: cand.id,
          patch: cand.patch,
          before: beforeSnaps,
          after: afterSnaps
        });
      }

      // 4. Commit: send planVersion + before/after snapshots to server; only mark saved after commit succeeds
      let commitRes;
      try {
        commitRes = await commitPlanCommentEdits(project.id, {
          planVersion: proposeRes.planVersion,
          items: commitItems
        });
        committedAny = true;
      } catch (commitErr) {
        // Revert local preview srcdoc on refusal or commit error
        if (player && baseHtml) {
          player.setAttribute("srcdoc", baseHtml);
          player.currentTime = savedTime;
        }
        if (commitErr instanceof PlanEditRefusedError) {
          const batchIds = new Set(commitItems.map((i) => i.id));
          const hasSpecificId = Boolean(commitErr.commentId && batchIds.has(commitErr.commentId));
          setTimedComments((curr) =>
            curr.map((item) => {
              if (!batchIds.has(item.id)) return item;
              if (!hasSpecificId || item.id === commitErr.commentId) {
                const reason =
                  hasSpecificId && batchIds.size > 1
                    ? `${commitErr.message} (Batch commit is all-or-nothing; no comments were saved.)`
                    : commitErr.message;
                return { ...item, refusedReason: reason, appliedLabel: undefined };
              }
              return {
                ...item,
                refusedReason:
                  "Not saved — batch commit is all-or-nothing on the server because another comment in this batch was refused.",
                appliedLabel: undefined
              };
            })
          );
          return;
        }
        throw commitErr;
      }

      const resultById = new Map(commitRes.results.map((r) => [r.id, r]));
      const committedBatchIds = new Set(commitItems.map((i) => i.id));
      const sceneScopedIndices = new Set<number>();
      const sceneScopedComments: WorkspaceComment[] = [];

      for (const c of pendingComments) {
        const savedResult = resultById.get(c.id);
        if (!savedResult) continue;
        if (savedResult.scope === "scene") {
          sceneScopedIndices.add(c.scene);
          sceneScopedComments.push(c);
        }
      }

      // Mark element-scoped results immediately (they are already saved on the server by commit),
      // and give a visible reason to any comment that was sent in commitItems but missing from results.
      setTimedComments((curr) =>
        curr.map((item) => {
          const savedResult = resultById.get(item.id);
          if (!savedResult) {
            if (committedBatchIds.has(item.id)) {
              return {
                ...item,
                refusedReason: "Server did not return a commit result for this comment.",
                appliedLabel: undefined
              };
            }
            return item;
          }
          if (savedResult.scope === "element") {
            return {
              ...item,
              appliedLabel: savedResult.uiLabel,
              appliedScope: "element",
              ...(savedResult.el ? { appliedEl: savedResult.el } : {}),
              refusedReason: undefined
            };
          }
          return item;
        })
      );

      if (sceneScopedIndices.size > 0) {
        setUpdatingScenes([...sceneScopedIndices]);
      }

      if (sceneScopedComments.length > 0) {
        const payload = groupCommentsByScene(sceneScopedComments, segments);
        try {
          await onApplySceneComments(payload);
          const sceneIds = new Set(sceneScopedComments.map((c) => c.id));
          setTimedComments((curr) =>
            curr.map((item) => {
              if (!sceneIds.has(item.id)) return item;
              const savedResult = resultById.get(item.id);
              if (!savedResult) return item;
              return {
                ...item,
                appliedLabel: savedResult.uiLabel,
                appliedScope: "scene",
                ...(savedResult.el ? { appliedEl: savedResult.el } : {}),
                refusedReason: undefined
              };
            })
          );
        } catch (sceneErr) {
          setActionError(sceneErr instanceof Error ? sceneErr.message : "Could not apply scene comments.");
          setLocalVersion((v) => v + 1);
          onRetryAnimate();
          return;
        }
      }

      setLocalVersion((v) => v + 1);
      onRetryAnimate();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (!committedAny && player && baseHtml) {
        player.setAttribute("srcdoc", baseHtml);
      } else if (committedAny) {
        setLocalVersion((v) => v + 1);
        onRetryAnimate();
      }
      setActionError(err instanceof Error ? err.message : "Could not apply comments.");
    } finally {
      applyingRef.current = false;
      setApplyingComments(false);
      setUpdatingScenes([]);
    }
  };

  const removeOrUndoComment = async (id: string) => {
    if (applyingRef.current || applyingComments || undoingIdsRef.current.has(id)) return;
    const target = timedComments.find((item) => item.id === id);
    if (!target) return;
    if (target.appliedLabel && target.appliedEl) {
      undoingIdsRef.current.add(id);
      setActionError(null);
      const savedPlayhead = currentTimeRef.current;
      try {
        await undoPlanElementOverride(project.id, target.appliedEl, {
          clearHint: target.appliedScope === "scene"
        });
        setTimedComments((curr) => curr.filter((item) => item.id !== id));
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Could not undo the element edit.");
      } finally {
        undoingIdsRef.current.delete(id);
        currentTimeRef.current = savedPlayhead;
        setCurrentTime(savedPlayhead);
        if (playerRef.current) {
          playerRef.current.currentTime = savedPlayhead;
        }
        setLocalVersion((v) => v + 1);
      }
      return;
    }
    setTimedComments((curr) => curr.filter((item) => item.id !== id));
  };

  const availableAudio = useMemo(
    () => hfAvailableAudioTracks(project, compAudio),
    [project, compAudio]
  );

  const isPlate = isPlateLookId(project.brief?.look);

  const motionBlurControls: WorkspaceMotionBlurControlState | undefined = useMemo(
    () =>
      isPlate
        ? undefined
        : {
            enabled: effectiveMotionBlur,
            disabled: busy,
            durationSeconds: effectiveDuration,
            onToggle: effectiveSetMotionBlur
          },
    [isPlate, effectiveMotionBlur, busy, effectiveDuration, effectiveSetMotionBlur]
  );

  const optionsConfig = useMemo(
    () =>
      isPlate
        ? { ...hfOptionsConfig(availableAudio), ...plateOptionsConfig(project.brief?.look) }
        : { ...hfOptionsConfig(availableAudio), motionBlurControls },
    [availableAudio, isPlate, project.brief?.look, motionBlurControls]
  );

  const audioToggles = useMemo(
    () => audioTogglesFromMode(audioModeState, availableAudio),
    [audioModeState, availableAudio]
  );

  const chooseSubMode = (nextMode: WorkspaceSubtitleMode) => {
    const prevMode = subMode;
    setSubMode(nextMode);
    setPreviewError(null);
    void editPlan(project.id, { captions: nextMode })
      .then(() => {
        setLocalVersion((v) => v + 1);
      })
      .catch((caught) => {
        setSubMode(prevMode);
        setPreviewError(caught instanceof Error ? caught.message : "Could not update subtitles.");
      });
  };

  const handleToggleAudio = (track: "voice" | "music") => {
    if (!availableAudio[track]) return;
    const prevMode = audioModeState;
    const nextMode = toggleAudioTrackMode(prevMode, track, availableAudio);
    setAudioModeState(nextMode);
    setPreviewError(null);
    void editPlan(project.id, { audioMode: nextMode })
      .then(() => {
        setLocalVersion((v) => v + 1);
      })
      .catch((caught) => {
        setAudioModeState(prevMode);
        setPreviewError(caught instanceof Error ? caught.message : "Could not update audio settings.");
      });
  };

  if (animating || animError || (!previewHtml && !project.beatPlan)) {
    const sceneCount = Math.max(beats.length, project.beatPlan?.beats.length ?? 0, frames.length);
    const stageLabel =
      animStage === "frames"
        ? "Drawing missing reference frames in parallel…"
        : animStage === "voice"
        ? "Recording voiceover & background music in parallel…"
        : `Directing scene animations in parallel (${animScenesDone.length}/${sceneCount || 1} scenes ready)…`;

    return (
      <AnimationPrep
        mode="full"
        title="Preparing browser animation"
        aspect={aspect}
        stageLabel={stageLabel}
        progress={animProgress}
        sceneCount={sceneCount}
        scenesDone={animScenesDone}
        error={animError}
        busy={animating}
        onRetry={onRetryAnimate}
        onBack={onBackToStoryboard}
        previewSlot={
          frames.length > 0 ? (
            <FrameReel frames={frames} />
          ) : (
            <Preview
              project={project}
              title={project.name}
              screenshot={
                project.screenshots[0]
                  ? projectScreenshotUrl(project.id, project.screenshots[0].id)
                  : undefined
              }
            />
          )
        }
      />
    );
  }

  const aspectOptions: WorkspaceAspectOption[] = (["16:9", "9:16", "1:1"] as const).map((asp) => ({
    aspect: asp,
    status: asp === viewAspect ? "ready" : "available",
    title: asp === viewAspect ? `Viewing ${asp} canvas` : `Switch to ${asp} canvas`
  }));

  const workspaceScenes: WorkspaceSceneTab[] = segments.map((seg, idx) => {
    const isSceneUpdating = updatingScenes.includes(idx);
    const state = previewError
      ? "failed"
      : isSceneUpdating || !previewHtml
      ? "updating"
      : "ready";
    const stateLabel = previewError
      ? "Failed"
      : isSceneUpdating
      ? "Updating scene"
      : previewHtml
      ? "Ready"
      : "Loading";
    return {
      index: idx,
      keyword: seg.label,
      duration: seg.duration,
      state,
      stateLabel
    };
  });

  const errors: string[] = [];
  if (previewError) errors.push(previewError);
  if (actionError) errors.push(actionError);

  const statusBadge = previewError
    ? {
        text: "Preview unavailable",
        showRetry: true,
        onRetry: () => {
          setLocalVersion((v) => v + 1);
          onRetryAnimate();
        }
      }
    : null;

  const nop = () => {};
  const nopStyle = (_s: WorkspaceSubtitleStyle) => {};
  const nopNum = (_n: number) => {};
  const nopStr = (_s: string) => {};
  const nopPos = (_i: number, _p: { x: number; y: number }) => {};
  const nopAllPos = (_p: { x: number; y: number }) => {};

  const handleRender = () => {
    if (playerRef.current && playing) {
      playerRef.current.pause();
      setPlaying(false);
    }
    if (shortTokens) {
      setBuyingTokens(true);
      return;
    }
    onStartFinalRender();
  };

  return (
    <>
      {notice && (
        <p className="aw-error" role="status" style={{ margin: "0 auto", width: "min(1360px, 100%)", boxSizing: "border-box" }}>
          {notice}
        </p>
      )}
      <AnimationWorkspace
        aspect={viewAspect}
        aspects={aspectOptions}
        onSelectAspect={(asp) => {
          if (playerRef.current && playing) {
            playerRef.current.pause();
            setPlaying(false);
          }
          setViewAspect(asp);
        }}
        errors={errors}
        optionsConfig={optionsConfig}
        motionBlurControls={motionBlurControls}
        audioControls={{
          voice: audioToggles.voice,
          music: audioToggles.music,
          sfx: false,
          transitions: false,
          onToggleVoice: () => handleToggleAudio("voice"),
          onToggleMusic: () => handleToggleAudio("music"),
          onToggleSfx: nop,
          onToggleTransitions: nop
        }}
        subtitleControls={{
          mode: subMode,
          style: "pill",
          size: 100,
          opacity: 100,
          textColor: "",
          bgColor: "",
          effectiveTextColor: "#ffffff",
          effectiveBgColor: "#0c0f16",
          position: { x: 50, y: 88 },
          currentSceneIndex: activeSceneIndex,
          onSelectMode: chooseSubMode,
          onSelectStyle: nopStyle,
          onStepSize: nopNum,
          onChangeTextColor: nopStr,
          onChangeBgColor: nopStr,
          onChangeOpacity: nopNum,
          onChangeScenePosition: nopPos,
          onApplyPositionToAll: nopAllPos,
          onResetCustomization: nop
        }}
        statusBadge={statusBadge}
        onStageClick={togglePlay}
        renderStage={() =>
          previewError ? (
            <AnimationPrep
              failed
              title="Could not load the browser animation"
              detail={previewError}
            />
          ) : playerLoaded && previewHtml ? (
            createElement("hyperframes-player", {
              ref: playerRef,
              className: "studio-hyperframes-player",
              "disable-click-to-play": "",
              "assets-loading-ui": "none",
              "aria-label": "In-browser animation preview",
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                maxWidth: "none",
                maxHeight: "none",
                aspectRatio: "auto",
                display: "block"
              }
            })
          ) : (
            <AnimationPrep title="Loading browser animation…" />
          )
        }
        playing={playing}
        playDisabled={!previewHtml || Boolean(previewError)}
        onTogglePlay={togglePlay}
        currentTime={currentTime}
        totalDuration={duration}
        currentSceneIndex={activeSceneIndex}
        currentSceneLabel={
          segments[activeSceneIndex]
            ? `Scene ${activeSceneIndex + 1} · ${segments[activeSceneIndex].label}`
            : ""
        }
        volume={volume}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
        onChangeVolume={(v) => {
          setVolume(v);
          setMuted(v === 0);
        }}
        scenes={workspaceScenes}
        onSeek={seek}
        comments={sortedComments}
        commentDraft={draft}
        onChangeCommentDraft={setDraft}
        onCommentFocus={() => {
          if (playerRef.current && playing) {
            playerRef.current.pause();
            setPlaying(false);
          }
        }}
        canAddComment={!animating && !applyingComments && Boolean(previewHtml)}
        onAddComment={addComment}
        onRemoveComment={removeOrUndoComment}
        onApplyComments={() => void applyComments()}
        applyingComments={applyingComments}
        onRender={handleRender}
        rendering={busy}
        cost={cost}
      />
      {buyingTokens && balance !== null && (
        <TokenModal
          cost={cost}
          balance={balance}
          onClose={() => setBuyingTokens(false)}
        />
      )}
    </>
  );
}
