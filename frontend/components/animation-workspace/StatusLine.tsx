"use client";
import type { ReactNode } from "react";

export interface StatusLineProps {
  /** Text or nodes to display. */
  children: ReactNode;
  /** When true, renders the pulsing `.sc-live` dot before the text (`aria-live="polite"`). */
  live?: boolean;
  /** `"inline"` renders the compact toolbar status chip (`.aw-mini-status`); `"line"` renders a full status paragraph. */
  variant?: "inline" | "line";
  /** Optional retry action rendered alongside the inline status chip. */
  showRetry?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}

/**
 * Shared status indicator for the animation workspace:
 * - `variant="inline"` (default in `OptionsBar`): compact status text (`3/5 drawn…`) plus optional `Retry` pill button.
 * - `variant="line"` (under headings / in prep screens): `role="status" aria-live="polite"` with optional `.sc-live` dot.
 */
export function StatusLine({
  children,
  live = false,
  variant = "inline",
  showRetry = false,
  retryLabel = "Retry",
  onRetry
}: StatusLineProps) {
  if (variant === "line") {
    return (
      <p className="aw-status-line" role="status" aria-live="polite">
        {live && <i className="sc-live" />}
        {children}
      </p>
    );
  }

  return (
    <>
      <span className="aw-mini-status">{children}</span>
      {showRetry && onRetry && (
        <button type="button" className="aw-pill-item" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </>
  );
}
