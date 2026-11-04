"use client";
import type { CSSProperties, ReactNode } from "react";

export interface ProgressButtonProps {
  /** When `busy` is true and `progress` is a number (0..100), renders a `role="progressbar"` button with fill bar. */
  busy?: boolean;
  progress?: number | null;
  disabled?: boolean;
  className?: string;
  title?: string;
  minWidth?: number;
  style?: CSSProperties;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * Reusable action button that smoothly becomes a `role="progressbar"` button with a percentage fill bar
 * when a long operation is running, or a standard disabled/active button when no numeric percentage is supplied.
 */
export function ProgressButton({
  busy = false,
  progress = null,
  disabled = false,
  className = "primary-button",
  title,
  minWidth,
  style,
  onClick,
  children
}: ProgressButtonProps) {
  if (busy && typeof progress === "number") {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    return (
      <button
        type="button"
        className={className}
        disabled
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        title={title}
        style={{
          position: "relative",
          overflow: "hidden",
          ...(minWidth ? { minWidth } : {}),
          fontVariantNumeric: "tabular-nums",
          ...style
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: "linear-gradient(90deg, rgba(22, 139, 255, 0.25), rgba(22, 139, 255, 0.42))",
            transition: "width 0.28s ease",
            pointerEvents: "none"
          }}
        />
        <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <i className="sc-live" />
          {children}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      title={title}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
