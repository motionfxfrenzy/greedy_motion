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
  onTogglePlay
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
          return (
            <li
              key={scene.index}
              className={`${cls}${scene.index === currentSceneIndex ? " on" : ""}`}
              style={{ flexGrow: scene.duration }}
              title={`${scene.keyword} · ${mapped.label}`}
            >
              <small>{String(scene.index + 1).padStart(2, "0")}</small>
              <span>{scene.keyword}</span>
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
