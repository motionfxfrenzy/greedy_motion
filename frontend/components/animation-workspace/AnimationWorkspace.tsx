"use client";
import { useRef, useState } from "react";
import { CommentsPanel } from "./CommentsPanel";
import { ControlRow } from "./ControlRow";
import { OptionsBar } from "./OptionsBar";
import { SceneTabs } from "./SceneTabs";
import type { AnimationWorkspaceProps } from "./types";

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
  statusBadge,
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
  cost
}: AnimationWorkspaceProps & { renderDisabled?: boolean }) {
  const stageRef = useRef<HTMLElement>(null);
  const dimRailRef = useRef<HTMLDivElement>(null);
  const [dimOpen, setDimOpen] = useState(false);

  const currentScene = scenes[currentSceneIndex];
  const readyCount = scenes.filter((s) => s.state === "drawn" || s.state === "ready" || s.state === "checked").length;
  const renderDisabled =
    applyingComments || Boolean(rendering) || scenes.length === 0 || readyCount < scenes.length;

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
        renderDisabled={renderDisabled}
        rendering={rendering}
        cost={cost}
      />
    </div>
  );
}
