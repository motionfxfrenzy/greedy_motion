"use client";
import { useEffect, useRef, useState } from "react";
import { CommentsPanel } from "./CommentsPanel";
import { ControlRow } from "./ControlRow";
import { FpsMeter } from "./FpsMeter";
import { OptionsBar } from "./OptionsBar";
import { LIVE_TEXT_THROTTLE_MS, stepThrottledLiveText, type LiveTextThrottleState } from "./progress";
import { SceneTabs } from "./SceneTabs";
import type { AnimationWorkspaceProps, WorkspaceFilmToast } from "./types";

const TOAST_FADE_MS = 300;

function useThrottledPoliteText(rawText: string, resetKey?: string): string {
  const stateRef = useRef<LiveTextThrottleState>({ text: "", updatedAtMs: null });
  const prevResetKeyRef = useRef<string | undefined>(resetKey);
  if (prevResetKeyRef.current !== resetKey) {
    prevResetKeyRef.current = resetKey;
    stateRef.current = { text: "", updatedAtMs: null };
  }
  const latestRawRef = useRef<string>(rawText);
  latestRawRef.current = rawText;
  const [, setTick] = useState(0);

  const now = Date.now();
  const stepped = stepThrottledLiveText(stateRef.current, rawText, now, LIVE_TEXT_THROTTLE_MS);
  stateRef.current = stepped.state;

  useEffect(() => {
    const cur = stateRef.current;
    const target = latestRawRef.current;
    if (!target || cur.text === target || cur.updatedAtMs === null) return;
    const waitMs = Math.max(1, LIVE_TEXT_THROTTLE_MS - (Date.now() - cur.updatedAtMs));
    const timer = window.setTimeout(() => {
      const next = stepThrottledLiveText(stateRef.current, latestRawRef.current, Date.now(), LIVE_TEXT_THROTTLE_MS);
      stateRef.current = next.state;
      setTick((n) => n + 1);
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [rawText, resetKey]);

  return stateRef.current.text;
}

/**
 * Shared step 3 ("Animation") workspace shell for both engines:
 * - Top floating options bar (`OptionsBar`) with engine-filtered audio and subtitle controls plus status chip
 * - Stage frame with floating aspect ratio picker (`16:9`, `9:16`, `1:1`) and engine-rendered stage (`renderStage()`)
 * - Minimal playback control row (`ControlRow`) with hover-revealed volume slider and full screen toggle
 * - Interactive timeline with per-scene tabs and comment pins (`SceneTabs`)
 * - Right-hand primary render button and timed comments panel (`CommentsPanel`)
 */
export function AnimationWorkspace({
  aspect,
  aspects,
  onSelectAspect,
  errors,
  optionsConfig,
  audioControls,
  subtitleControls,
  previewQualityControls,
  motionBlurControls,
  statusBadge,
  filmToast,
  sceneBanner,
  fpsMeter,
  renderStage,
  onStageClick,
  canvasRef,
  frameExtras,
  playing,
  playDisabled = false,
  onTogglePlay,
  currentTime,
  totalDuration,
  currentSceneIndex,
  currentSceneLabel,
  volume,
  muted,
  onToggleMute,
  onChangeVolume,
  scenes,
  onSeek,
  onRetryScene,
  retryingSceneIndex = null,
  comments,
  commentDraft,
  onChangeCommentDraft,
  onCommentFocus,
  canAddComment,
  addingComment = false,
  onAddComment,
  onRemoveComment,
  onApplyComments,
  applyingComments = false,
  applyBusyLabel,
  applyIdleEmptyLabel,
  applyPrefix,
  commentsNote,
  onRender,
  rendering = false,
  renderDisabled = false,
  renderTitle,
  cost,
  renderButtonRef
}: AnimationWorkspaceProps & { renderButtonRef?: import("react").RefObject<HTMLButtonElement | null> }) {
  const stageRef = useRef<HTMLElement>(null);
  const dimRailRef = useRef<HTMLDivElement>(null);
  const [dimOpen, setDimOpen] = useState(false);

  const isToastActive = Boolean(filmToast?.active);
  const lastToastRef = useRef<WorkspaceFilmToast | null>(filmToast?.active ? filmToast : null);
  if (filmToast?.active) {
    lastToastRef.current = filmToast;
  } else if (filmToast && lastToastRef.current) {
    lastToastRef.current = {
      ...lastToastRef.current,
      secondLine: filmToast.secondLine,
      compactLine: filmToast.compactLine,
      percent: filmToast.percent
    };
  }

  const [toastMounted, setToastMounted] = useState<boolean>(isToastActive);
  const [toastExiting, setToastExiting] = useState<boolean>(false);
  const prevToastActiveRef = useRef<boolean>(isToastActive);

  useEffect(() => {
    if (isToastActive) {
      prevToastActiveRef.current = true;
      setToastExiting(false);
      setToastMounted(true);
      return;
    }
    if (!prevToastActiveRef.current) {
      return;
    }
    prevToastActiveRef.current = false;
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setToastExiting(false);
      setToastMounted(false);
      return;
    }
    setToastExiting(true);
    const timer = window.setTimeout(() => {
      setToastExiting(false);
      setToastMounted(false);
    }, TOAST_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [isToastActive]);

  const activeToast = filmToast?.active ? filmToast : lastToastRef.current;
  const showToast = (isToastActive || toastMounted) && Boolean(activeToast);

  const throttledToastFirst = useThrottledPoliteText(showToast && activeToast ? activeToast.firstLine : "");
  const throttledToastSecond = useThrottledPoliteText(showToast && activeToast ? activeToast.secondLine : "");
  const throttledToastCompact = useThrottledPoliteText(showToast && activeToast ? activeToast.compactLine : "");
  const throttledBannerText = useThrottledPoliteText(
    sceneBanner ? sceneBanner.text : "",
    sceneBanner ? `${sceneBanner.sceneIndex}:${sceneBanner.visualState}` : ""
  );

  const currentScene = scenes[currentSceneIndex];

  return (
    <div className="animation-workspace" data-aspect={aspect}>
      {errors?.map((err, i) => (
        <p key={i} className="aw-error" role={i === 0 ? "alert" : undefined}>
          {err}
        </p>
      ))}

      <section className="aw-stage" aria-label="Film player" ref={stageRef}>
        <OptionsBar
          optionsConfig={optionsConfig}
          audio={audioControls}
          subtitles={subtitleControls}
          previewQuality={previewQualityControls}
          motionBlur={motionBlurControls}
          statusBadge={statusBadge}
        />

        <div className="aw-frame">
          <div
            ref={dimRailRef}
            className={`aw-dim-rail${dimOpen ? " open" : ""}`}
            role="group"
            aria-label="Canvas dimensions"
          >
            <button
              type="button"
              className="aw-dim-trigger"
              aria-expanded={dimOpen}
              onClick={() => setDimOpen((prev) => !prev)}
              title="Click to open dimensions (16:9, 9:16, 1:1)"
            >
              <i className={`aw-dim-shape aw-dim-${aspect.replace(":", "x")}`} />
              <span>{aspect}</span>
              <small className="aw-dim-caret">{dimOpen ? "▴" : "▾"}</small>
            </button>
            <div className="aw-dim-drawer" aria-hidden={!dimOpen}>
              {aspects.map((opt) => {
                const isActive = aspect === opt.aspect;
                return (
                  <button
                    key={opt.aspect}
                    type="button"
                    className={`aw-dim-option${isActive ? " on" : ""}`}
                    aria-pressed={isActive}
                    onClick={() => onSelectAspect(opt.aspect)}
                    title={opt.title}
                  >
                    <i className={`aw-dim-shape aw-dim-${opt.aspect.replace(":", "x")}`} />
                    <span>{opt.aspect}</span>
                    <small>{opt.status === "busy" ? "⏳" : opt.status === "ready" ? "✓" : "+"}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="aw-canvas" ref={canvasRef} onClick={onStageClick}>
            {renderStage()}
            {fpsMeter && <FpsMeter {...fpsMeter} />}
          </div>

          <div className="aw-top-status-stack">
            {showToast && activeToast && (
              <div
                className={`aw-film-toast${toastExiting ? " exiting" : ""}`}
                role="status"
                aria-live="polite"
              >
                <div className="aw-film-toast-card">
                  <span className="aw-film-toast-primary">
                    <i className="aw-film-toast-dot" aria-hidden="true" />
                    <span className="aw-film-toast-primary-text">
                      {throttledToastFirst || activeToast.firstLine}
                    </span>
                  </span>
                  <span className="aw-film-toast-summary aw-film-toast-summary-full">
                    {throttledToastSecond || activeToast.secondLine}
                  </span>
                  <span className="aw-film-toast-summary aw-film-toast-summary-short" aria-hidden="true">
                    {throttledToastCompact || activeToast.compactLine}
                  </span>
                  <div
                    className="aw-film-toast-bar"
                    role="progressbar"
                    aria-label="Film build progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={activeToast.percent}
                  >
                    <b style={{ width: `${activeToast.percent}%` }} />
                  </div>
                </div>
              </div>
            )}

            {sceneBanner && (
              <div
                className={`aw-scene-banner aw-scene-banner-${sceneBanner.placement}${
                  showToast ? " below-toast" : ""
                }`}
                role="status"
                aria-live="polite"
                data-scene-index={sceneBanner.sceneIndex}
                data-visual-state={sceneBanner.visualState}
              >
                <div className={`aw-scene-banner-card aw-seg-state-${sceneBanner.visualState}`}>
                  <i className="aw-seg-dot" aria-hidden="true" />
                  <span className="aw-scene-banner-text">{throttledBannerText || sceneBanner.text}</span>
                </div>
              </div>
            )}

            <div className="aw-top-wait-slot" data-has-toast={showToast ? "true" : "false"} />
          </div>

          {frameExtras}
        </div>

        <ControlRow
          playing={playing}
          playDisabled={playDisabled}
          onTogglePlay={onTogglePlay}
          currentTime={currentTime}
          totalDuration={totalDuration}
          currentSceneLabel={currentSceneLabel}
          volume={volume}
          muted={muted}
          onToggleMute={onToggleMute}
          onChangeVolume={onChangeVolume}
          stageRef={stageRef}
        />

        <SceneTabs
          scenes={scenes}
          currentSceneIndex={currentSceneIndex}
          currentTime={currentTime}
          totalDuration={totalDuration}
          comments={comments}
          onSeek={onSeek}
          onTogglePlay={onTogglePlay}
          bannerSceneIndex={sceneBanner?.sceneIndex ?? null}
          onRetryScene={onRetryScene}
          retryingSceneIndex={retryingSceneIndex}
        />
      </section>

      <CommentsPanel
        currentTime={currentTime}
        currentSceneIndex={currentSceneIndex}
        currentSceneKeyword={currentScene?.keyword}
        hasCurrentScene={Boolean(currentScene)}
        comments={comments}
        draft={commentDraft}
        onChangeDraft={onChangeCommentDraft}
        onFocusDraft={onCommentFocus}
        canAdd={canAddComment}
        adding={addingComment}
        onAddComment={onAddComment}
        onRemoveComment={onRemoveComment}
        onSeekToComment={onSeek}
        onApply={onApplyComments}
        applying={applyingComments}
        applyBusyLabel={applyBusyLabel}
        applyIdleEmptyLabel={applyIdleEmptyLabel}
        applyPrefix={applyPrefix}
        note={commentsNote}
        onRender={onRender}
        rendering={rendering}
        renderDisabled={renderDisabled}
        renderTitle={renderTitle}
        cost={cost}
        renderButtonRef={renderButtonRef}
      />
    </div>
  );
}
