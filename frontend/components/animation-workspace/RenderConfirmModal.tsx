"use client";
import { useEffect, useId, useRef } from "react";

export interface RenderConfirmModalProps {
  open: boolean;
  reasons: readonly string[];
  onReviewFirst: () => void;
  onMakeVideo: () => void;
}

/**
 * Accessible confirmation modal shown when the user clicks Render while any scene is not ready
 * or the preview has not been watched through.
 */
export function RenderConfirmModal({
  open,
  reasons,
  onReviewFirst,
  onMakeVideo
}: RenderConfirmModalProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reviewBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    reviewBtnRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onReviewFirst();
        return;
      }
      if (event.key === "Tab") {
        const dlg = dialogRef.current;
        if (!dlg) return;
        const focusable = Array.from(
          dlg.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (!active || !dlg.contains(active) || active === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (!active || !dlg.contains(active) || active === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, onReviewFirst]);

  if (!open) return null;

  return (
    <div
      className="sc-modal-backdrop aw-confirm-backdrop"
      onClick={onReviewFirst}
    >
      <div
        ref={dialogRef}
        className="sc-modal aw-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id={titleId}>Make the video without reviewing it first?</h2>
        </header>
        <div id={bodyId} className="aw-confirm-reasons">
          {reasons.length === 1 ? (
            <p className="sc-modal-sum">{reasons[0]}</p>
          ) : (
            <ul className="aw-confirm-list">
              {reasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="sc-modal-actions aw-confirm-actions">
          <button
            ref={reviewBtnRef}
            type="button"
            className="primary-button aw-confirm-review"
            onClick={onReviewFirst}
          >
            Review first
          </button>
          <button
            type="button"
            className="secondary-button aw-confirm-proceed"
            onClick={onMakeVideo}
          >
            Make the video
          </button>
        </div>
      </div>
    </div>
  );
}
