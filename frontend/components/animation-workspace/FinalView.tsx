"use client";

import { useEffect, useState } from "react";
import {
  formatFinalRatioTabLabel,
  formatFinalWaitMessage,
  shouldShowFinalRatioTabs
} from "./logic";
import type { FinalViewProps } from "./types";

/**
 * Shared Step 4 (Final review) view used by both Plates and HyperFrames.
 * Extracted from `PlateFinal` with identical DOM structure and styling:
 * - Renders ratio tabs only when `ratios.length > 1`
 * - One native `<video controls>` stage frame
 * - Download button/chip per ratio
 * - `← Back to Animation` and `Approve final` (with in-flight & locked states)
 */
export function FinalView({
  title,
  subtitle,
  ratios,
  initialRatio,
  shape,
  poster,
  onBack,
  onApprove,
  approved,
  backLabel = "← Back to Animation",
  renderPreparingText,
  renderFailedText
}: FinalViewProps) {
  const [view, setView] = useState<string>(initialRatio);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    setView(initialRatio);
  }, [initialRatio]);

  const activeRatio = ratios.find((r) => r.id === view) ?? ratios[0];
  const showTabs = shouldShowFinalRatioTabs(ratios);
  const src = activeRatio?.url ?? null;

  return (
    <div className="pf" role="region" aria-label="Final film">
      <div className="pf-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="pf-actions">
          <button type="button" className="aw-btn" onClick={onBack}>
            {backLabel}
          </button>
          {approved ? (
            <span className="aw-locked">✓ Approved · locked</span>
          ) : (
            <button
              type="button"
              className="aw-btn-primary"
              disabled={approving}
              onClick={async () => {
                setApproving(true);
                try {
                  await onApprove();
                } finally {
                  setApproving(false);
                }
              }}
            >
              {approving ? "Approving…" : "Approve final"}
            </button>
          )}
        </div>
      </div>
      {showTabs && (
        <div className="pf-tabs" role="tablist" aria-label="Ratio">
          {ratios.map((ratio) => (
            <button
              key={ratio.id}
              type="button"
              role="tab"
              aria-selected={activeRatio?.id === ratio.id}
              className={`pp-track-chip${activeRatio?.id === ratio.id ? " on" : ""}`}
              onClick={() => setView(ratio.id)}
            >
              {formatFinalRatioTabLabel(ratio)}
            </button>
          ))}
        </div>
      )}
      {activeRatio && (
        <div className="pf-stage">
          <div
            className="pf-frame"
            style={{ aspectRatio: shape(activeRatio.id) }}
            data-ratio={activeRatio.id}
          >
            {src ? (
              <video
                key={src}
                src={src}
                poster={poster}
                controls
                playsInline
                preload="metadata"
                className="pf-video"
              />
            ) : (
              <p className="pf-wait" role="status">
                {activeRatio.status === "failed"
                  ? renderFailedText
                    ? renderFailedText(activeRatio)
                    : formatFinalWaitMessage(activeRatio)
                  : renderPreparingText
                  ? renderPreparingText(activeRatio)
                  : formatFinalWaitMessage(activeRatio)}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="pf-downloads">
        {ratios.map((ratio) =>
          ratio.url ? (
            <a
              key={ratio.id}
              className="aw-btn"
              href={ratio.url}
              download={ratio.downloadName}
            >
              Download {ratio.label}
            </a>
          ) : (
            <span
              key={ratio.id}
              className="aw-btn"
              aria-busy={ratio.status === "preparing"}
            >
              {ratio.label}: {ratio.status === "failed" ? "failed" : "preparing…"}
            </span>
          )
        )}
      </div>
    </div>
  );
}
