"use client";
import { useRef } from "react";
import { formatClock, mapSceneTabState } from "./logic";
import type { WorkspaceComment, WorkspaceSceneTab } from "./types";

export interface SceneTabsProps {
  scenes: readonly WorkspaceSceneTab[];
  currentSceneIndex: number;
  currentTime: number;
  totalDuration: number;
  comments: readonly WorkspaceComment[];
  onSeek: (seconds: number) => void;
  onTogglePlay: () => void;
  /** Optional 0-based scene index currently highlighted by the unready-scene banner (visually links its colour dot). */
  bannerSceneIndex?: number | null;
  onRetryScene?: (sceneIndex: number) => void;
  retryingSceneIndex?: number | null;
}

/**
 * Interactive timeline track (`role="slider"`) with proportional per-scene segments (`01 … 05`),
 * playhead fill and cursor line, pinned comment markers, pointer scrubbing, and keyboard navigation
 * (ArrowLeft / ArrowRight to seek ±1s, Space to toggle play/pause).
 */
export function SceneTabs({
  scenes,
  currentSceneIndex,
  currentTime,
  totalDuration,
  comments,
  onSeek,
  onTogglePlay,
  bannerSceneIndex = null,
  onRetryScene,
  retryingSceneIndex = null
}: SceneTabsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);

  const timeAtPointer = (event: { clientX: number }) => {
    const box = trackRef.current?.getBoundingClientRect();
    return box ? ((event.clientX - box.left) / box.width) * totalDuration : 0;
  };

  return (
    <div
      className="aw-track"
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Film timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalDuration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={formatClock(currentTime)}
      onPointerDown={(e) => {
        dragRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(timeAtPointer(e));
      }}
      onPointerMove={(e) => {
        if (dragRef.current) onSeek(timeAtPointer(e));
      }}
      onPointerUp={() => {
        dragRef.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(currentTime + 1);
        else if (e.key === "ArrowLeft") onSeek(currentTime - 1);
        else if (e.key === " ") {
          e.preventDefault();
          onTogglePlay();
        }
      }}
    >
      <ol className="aw-segments">
        {scenes.map((scene) => {
          const mapped = mapSceneTabState(scene.state, scene.stateLabel);
          const cls = scene.stateClassName ?? mapped.cssClass;
          const statusText = scene.progressLabel ?? mapped.label;
          const hasBar =
            typeof scene.progressFraction === "number" &&
            Number.isFinite(scene.progressFraction) &&
            scene.progressFraction > 0 &&
            mapped.visualState === "updating";
          const pct = hasBar ? Math.max(4, Math.min(100, Math.round((scene.progressFraction ?? 0) * 100))) : 0;
          const showThumb = Boolean(scene.thumbnail && mapped.visualState !== "ready");
          const isBannerLinked = typeof bannerSceneIndex === "number" && scene.index === bannerSceneIndex;
          const chipStateLabel = scene.progressLabel ?? (isBannerLinked ? mapped.label : undefined);
          return (
            <li
              key={scene.index}
              className={`${cls}${scene.index === currentSceneIndex ? " on" : ""}${isBannerLinked ? " banner-linked" : ""}`}
              data-banner-linked={isBannerLinked ? "true" : undefined}
              style={{ flexGrow: scene.duration }}
              title={`${scene.keyword} · ${statusText}`}
            >
              {showThumb && (
                <img
                  src={scene.thumbnail!}
                  alt=""
                  aria-hidden="true"
                  className="aw-seg-thumb"
                />
              )}
              <div className="aw-seg-head">
                <small>{String(scene.index + 1).padStart(2, "0")}</small>
                {(scene.state === "failed" || scene.stuck) && onRetryScene ? (
                  <button
                    type="button"
                    className="aw-seg-retry"
                    aria-label={`Retry Scene ${scene.index + 1}`}
                    title={scene.stuck ? "This scene is taking too long to check. Draw it on the server instead." : undefined}
                    disabled={retryingSceneIndex === scene.index}
                    aria-busy={retryingSceneIndex === scene.index}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryScene(scene.index);
                    }}
                  >
                    {retryingSceneIndex === scene.index ? "Retrying…" : "↻ Retry"}
                  </button>
                ) : (
                  chipStateLabel && (
                    <em className={`aw-seg-state aw-seg-state-${mapped.visualState}`}>
                      <i className="aw-seg-dot" aria-hidden="true" />
                      {chipStateLabel}
                    </em>
                  )
                )}
              </div>
              <span>{scene.keyword}</span>
              {hasBar && (
                <i className="aw-seg-bar" aria-hidden="true">
                  <b style={{ width: `${pct}%` }} />
                </i>
              )}
            </li>
          );
        })}
      </ol>
      <i className="aw-fill" style={{ width: `${totalDuration ? (currentTime / totalDuration) * 100 : 0}%` }} />
      <i className="aw-head-line" style={{ left: `${totalDuration ? (currentTime / totalDuration) * 100 : 0}%` }} />
      {comments.map((comment) => (
        <b
          key={comment.id}
          className="aw-pin"
          style={{ left: `${totalDuration ? (comment.at / totalDuration) * 100 : 0}%` }}
          title={`${formatClock(comment.at)} · ${comment.body}`}
        />
      ))}
    </div>
  );
}
