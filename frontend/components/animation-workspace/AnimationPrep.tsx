"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LIVE_TEXT_THROTTLE_MS, stepThrottledLiveText, type LiveTextThrottleState } from "./progress";
import { StatusLine } from "./StatusLine";

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

export interface AnimationPrepStageProps {
  /** Whether the scene failed (hides spinner, shows error message). */
  failed?: boolean;
  /** Whether the scene is stale (storyboard/style updated and awaiting user-authorized rebuild). */
  stale?: boolean;
  /** Whether to render a compact one-line status chip at the bottom-centre of the stage. */
  compact?: boolean;
  /** One-line text for the compact bottom-centre status chip. */
  compactText?: ReactNode;
  /** Primary heading inside the stage wait overlay. */
  title: ReactNode;
  /** Secondary detail text inside the stage wait overlay. */
  detail?: ReactNode;
  /** Optional meaning line explaining the current phase (e.g. "Writing the scene's drawing code"). */
  meaning?: ReactNode;
  /** Optional scene position indicator (e.g. "Scene 3 of 7"). */
  sceneLabel?: ReactNode;
  /** Optional formatted elapsed time string (e.g. "1:07"). */
  elapsedText?: string | null;
  /** Optional 0..1 progress fraction for the stage bar. */
  progressFraction?: number | null;
  /** Whether to show an indeterminate progress bar when `progressFraction` is null/0 (e.g. while opening a worker or checking). */
  progressIndeterminate?: boolean;
  /** Whether the progress bar is a soft estimate (marked "estimated"). */
  progressEstimated?: boolean;
  /** Optional ETA & typical duration note (e.g. "about 3 min left · usually 2-4 min per scene"). */
  etaText?: ReactNode;
  /** Optional storyboard sketch frame URL rendered at full opacity behind the compact status chip. */
  backgroundSketch?: string | null;
  /** Whether to anchor the card compactly so the drawn scene stays visible around it during live buffering. */
  compactCard?: boolean;
  /** Optional primary action button inside the stage overlay (e.g. "Update animation" when stale). */
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
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
  const isStage = props.mode !== "full";
  const isCompact = isStage && !props.failed && !props.stale && Boolean(props.compact || props.compactCard);
  const rawCompactText = isStage
    ? typeof props.compactText === "string"
      ? props.compactText
      : typeof props.title === "string"
        ? props.title
        : ""
    : "";
  const resetKey = isStage
    ? `${String(props.sceneLabel ?? "")}:${typeof props.meaning === "string" ? props.meaning : ""}:${isCompact ? "compact" : "card"}`
    : "full";
  const throttledCompactText = useThrottledPoliteText(isCompact ? rawCompactText : "", resetKey);

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

  const hasDeterminateProgress =
    !props.failed &&
    typeof props.progressFraction === "number" &&
    Number.isFinite(props.progressFraction) &&
    props.progressFraction > 0;
  const isIndeterminate = !props.failed && !hasDeterminateProgress && Boolean(props.progressIndeterminate);
  const showProgressBar = hasDeterminateProgress || isIndeterminate;
  const pct = hasDeterminateProgress
    ? Math.max(2, Math.min(100, Math.round((props.progressFraction ?? 0) * 100)))
    : 0;

  const waitClasses = [
    "aw-wait",
    isCompact ? "aw-wait-compact" : "",
    props.failed ? "aw-wait-failed" : "",
    props.stale ? "aw-wait-stale" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const chipTooltip =
    typeof props.meaning === "string" && props.meaning.trim()
      ? props.meaning
      : undefined;

  const topSlotEl =
    isCompact && typeof document !== "undefined" && typeof document.querySelector === "function"
      ? document.querySelector(".aw-frame .aw-top-wait-slot")
      : null;

  const compactChipNode = isCompact ? (
    <div
      className="aw-wait-body aw-wait-chip"
      role="status"
      aria-live="polite"
      title={chipTooltip}
    >
      <div className="aw-wait-chip-line">
        <i className="aw-spin" aria-hidden="true" />
        <b>{throttledCompactText || props.compactText || props.title}</b>
      </div>
      {showProgressBar && (
        <div className="aw-wait-progress">
          <div
            className={`aw-wait-bar${props.progressEstimated ? " estimated" : ""}${isIndeterminate ? " indeterminate" : ""}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(hasDeterminateProgress ? { "aria-valuenow": pct } : {})}
          >
            <div
              className="aw-wait-bar-fill"
              style={hasDeterminateProgress ? { width: `${pct}%` } : undefined}
            />
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={waitClasses}>
      {props.backgroundSketch && (
        <img
          src={props.backgroundSketch}
          alt=""
          aria-hidden="true"
          className="aw-wait-sketch"
        />
      )}
      {isCompact ? (
        topSlotEl ? createPortal(compactChipNode, topSlotEl) : compactChipNode
      ) : (
        <div className="aw-wait-body">
          {!props.failed && !props.stale && <i className="aw-spin" aria-hidden="true" />}
          <b aria-live="polite">{props.title}</b>
          {props.meaning !== undefined && props.meaning !== null && (
            <span className="aw-wait-meaning">{props.meaning}</span>
          )}
          {props.detail !== undefined && props.detail !== null && <span>{props.detail}</span>}
          {(props.sceneLabel || props.elapsedText) && (
            <div className="aw-wait-meta">
              {props.sceneLabel && <span>{props.sceneLabel}</span>}
              {props.sceneLabel && props.elapsedText && <span aria-hidden="true">·</span>}
              {props.elapsedText && (
                <span className="aw-wait-elapsed" title="Elapsed time on this phase">
                  {props.elapsedText}
                </span>
              )}
            </div>
          )}
          {showProgressBar && (
            <div className="aw-wait-progress">
              <div
                className={`aw-wait-bar${props.progressEstimated ? " estimated" : ""}${isIndeterminate ? " indeterminate" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(hasDeterminateProgress ? { "aria-valuenow": pct } : {})}
              >
                <div
                  className="aw-wait-bar-fill"
                  style={hasDeterminateProgress ? { width: `${pct}%` } : undefined}
                />
              </div>
              {props.progressEstimated && <small className="aw-wait-est-tag">estimated</small>}
            </div>
          )}
          {props.etaText && <small className="aw-wait-eta">{props.etaText}</small>}
          {props.actionLabel && props.onAction && (
            <button
              type="button"
              className="primary-button aw-wait-action"
              disabled={Boolean(props.actionBusy)}
              aria-busy={Boolean(props.actionBusy)}
              onClick={(e) => {
                e.stopPropagation();
                props.onAction?.();
              }}
            >
              {props.actionBusy ? (props.failed ? "Retrying scene…" : "Updating…") : props.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
