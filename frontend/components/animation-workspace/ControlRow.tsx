"use client";
import type { RefObject } from "react";
import { formatClock } from "./logic";

export interface ControlRowProps {
  playing: boolean;
  playDisabled?: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  totalDuration: number;
  currentSceneLabel: string;
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  onChangeVolume: (volume: number) => void;
  stageRef?: RefObject<HTMLElement | null>;
}

/**
 * Playback control row below the stage:
 * play/pause button, tabular clock, current scene label, minimal line speaker icon,
 * hover/focus-revealed volume slider, and minimal line full-screen icon.
 */
export function ControlRow({
  playing,
  playDisabled = false,
  onTogglePlay,
  currentTime,
  totalDuration,
  currentSceneLabel,
  volume,
  muted,
  onToggleMute,
  onChangeVolume,
  stageRef
}: ControlRowProps) {
  return (
    <div className="aw-controls">
      <button
        type="button"
        className="aw-play"
        onClick={onTogglePlay}
        disabled={playDisabled}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="aw-clock">
        <b>{formatClock(currentTime)}</b> / {formatClock(totalDuration)}
      </span>
      <span className="aw-scene">{currentSceneLabel}</span>
      <span className="aw-options">
        <button
          type="button"
          className="aw-opt"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
            {muted || volume === 0 ? (
              <path d="M16 9.5l5 5M21 9.5l-5 5" />
            ) : (
              <>
                <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
                {volume >= 0.5 && <path d="M18 6.8a7.5 7.5 0 0 1 0 10.4" />}
              </>
            )}
          </svg>
        </button>
        <input
          className="aw-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => onChangeVolume(Number(e.target.value))}
        />
        <button
          type="button"
          className="aw-opt"
          onClick={() => {
            const el = stageRef?.current;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen?.();
          }}
          aria-label="Full screen"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </span>
    </div>
  );
}
