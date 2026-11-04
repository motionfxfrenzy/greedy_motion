"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import {
  renderCostMillitokens,
  tokensFromMilli,
  type AudioMode,
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
  sceneSpansFromBeatTimes,
  sortWorkspaceComments,
  toggleAudioTrackMode,
  type HfBeatSpan,
  type WorkspaceAspect,
  type WorkspaceAspectOption,
  type WorkspaceComment,
  type WorkspaceSceneTab,
  type WorkspaceSubtitleMode,
  type WorkspaceSubtitleStyle
} from "./animation-workspace";
import type { FrameLook } from "./beat-storyboard";
import { TokenModal, svgSrc } from "./script-canvas";
import {
  editPlan,
  ensureMediaToken,
  getComposition,
  getMyTokens,
  projectScreenshotUrl,
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

/** The storyboard's own frames while the film renders: one large, stepping through them, and the whole strip below. */
export function FrameReel({ frames }: { frames: string[] }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = window.setInterval(() => setAt((current) => (current + 1) % frames.length), 2500);
    return () => window.clearInterval(timer);
  }, [frames.length]);
  return (
    <div className="frame-reel">
      <div className="frame-reel-stage">
        {frames.map((svg, i) => (
          <img
            key={i}
            className={i === at ? "on" : ""}
            src={svgSrc(svg)}
            alt={i === at ? `Storyboard frame ${i + 1} of ${frames.length}` : ""}
            draggable={false}
          />
        ))}
      </div>
      <ol className="frame-reel-strip">
        {frames.map((svg, i) => (
          <li key={i}>
            <button
              type="button"
              aria-label={`Show frame ${i + 1}`}
              aria-current={i === at}
              onClick={() => setAt(i)}
            >
              <img src={svgSrc(svg)} alt="" draggable={false} />
            </button>
          </li>
        ))}
      </ol>
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
  onRetryAnimate: () => void;
  onBackToStoryboard: () => void;
  onStartFinalRender: () => void;
  onApplySceneComments: (items: { line: number; text: string }[]) => Promise<void>;
}) {
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const autoTriggered = useRef(false);
  const currentTimeRef = useRef(0);

  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
  const [balance, setBalance] = useState<number | null>(null);
  const [buyingTokens, setBuyingTokens] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);

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
      if (currentTimeRef.current > 0) {
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
    if (!sortedComments.length || animating || applyingComments) return;
    setApplyingComments(true);
    try {
      const payload = groupCommentsByScene(sortedComments, segments);
      setTimedComments([]);
      await onApplySceneComments(payload);
      onRetryAnimate();
    } finally {
      setApplyingComments(false);
    }
  };

  const availableAudio = useMemo(
    () => hfAvailableAudioTracks(project, compAudio),
    [project, compAudio]
  );

  const optionsConfig = useMemo(
    () => hfOptionsConfig(availableAudio),
    [availableAudio]
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

  const workspaceScenes: WorkspaceSceneTab[] = segments.map((seg, idx) => ({
    index: idx,
    keyword: seg.label,
    duration: seg.duration,
    state: previewError ? "failed" : previewHtml ? "ready" : "updating",
    stateLabel: previewError ? "Failed" : previewHtml ? "Ready" : "Loading"
  }));

  const errors: string[] = [];
  if (previewError) errors.push(previewError);

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
        onRemoveComment={(id) =>
          setTimedComments((curr) => curr.filter((item) => item.id !== id))
        }
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
