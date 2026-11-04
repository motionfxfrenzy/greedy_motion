"use client";
import type { ReactNode } from "react";
import { StatusLine } from "./StatusLine";

export interface AnimationPrepStageProps {
  /** Whether the scene failed (hides spinner, shows error message). */
  failed?: boolean;
  /** Primary heading inside the stage wait overlay. */
  title: ReactNode;
  /** Secondary detail text inside the stage wait overlay. */
  detail?: ReactNode;
}

export interface AnimationPrepFullProps {
  title?: string;
  aspect?: string;
  stageLabel?: string;
  progress?: number;
  sceneCount?: number;
  scenesDone?: readonly number[];
  error?: string | null;
  busy?: boolean;
  onRetry?: () => void;
  onBack?: () => void;
  previewSlot?: ReactNode;
}

export type AnimationPrepProps =
  | ({ mode?: "stage" } & AnimationPrepStageProps)
  | ({ mode: "full" } & AnimationPrepFullProps);

/**
 * Preparation and error display for the animation workspace:
 * - `mode="stage"` (default): the in-stage `.aw-wait` overlay with spinner or failure message.
 * - `mode="full"`: full two-column preparation screen with 0->100% progress bar, per-scene `✓`/`⋯` status grid,
 *   and error + retry actions.
 */
export function AnimationPrep(props: AnimationPrepProps) {
  if (props.mode === "full") {
    const {
      title = "Preparing browser animation",
      aspect = "16:9",
      stageLabel = "Preparing scenes…",
      progress = 0,
      sceneCount = 0,
      scenesDone = [],
      error = null,
      busy = false,
      onRetry,
      onBack,
      previewSlot
    } = props;
    const pctNum = Math.max(0, Math.min(100, Math.round(progress)));

    return (
      <div className="aw-prep-screen">
        {previewSlot && <section className="aw-prep-preview">{previewSlot}</section>}
        <aside className="aw-prep-card">
          <header className="aw-prep-head">
            <b>{error ? "Animation needs attention" : title}</b>
            <span>{aspect}</span>
          </header>
          {error ? (
            <div className="aw-prep-error" role="alert">
              <b>We could not prepare the animation.</b>
              <p>{error}</p>
              <div className="aw-prep-actions">
                {onRetry && (
                  <button type="button" className="primary-button" disabled={busy} onClick={onRetry}>
                    Try again
                  </button>
                )}
                {onBack && (
                  <button type="button" className="secondary-button" onClick={onBack}>
                    Back to storyboard
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="aw-prep-progress">
                <div className="aw-prep-progress-row">
                  <StatusLine variant="line" live>
                    {stageLabel}
                  </StatusLine>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{pctNum}%</b>
                </div>
                <div
                  className="aw-prep-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pctNum}
                >
                  <div className="aw-prep-bar-fill" style={{ width: `${pctNum}%` }} />
                </div>
              </div>
              {sceneCount > 0 && (
                <div className="aw-prep-scenes">
                  <small>
                    Parallel scene animation status ({scenesDone.length}/{sceneCount})
                  </small>
                  <div className="aw-prep-scene-grid">
                    {Array.from({ length: sceneCount }, (_, idx) => {
                      const done = scenesDone.includes(idx);
                      return (
                        <div key={idx} className={`aw-prep-scene-chip${done ? " done" : ""}`}>
                          <span>{done ? "✓" : "⋯"}</span>
                          <span>Scene {idx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {onBack && (
                <button type="button" className="secondary-button" style={{ marginTop: "auto" }} onClick={onBack}>
                  ← Back to Storyboard
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="aw-wait">
      {!props.failed && <i className="aw-spin" />}
      <b>{props.title}</b>
      {props.detail !== undefined && <span>{props.detail}</span>}
    </div>
  );
}
