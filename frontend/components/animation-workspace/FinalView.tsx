"use client";

import { useCallback, useRef, useState } from "react";
import { FinalRatioPlayer } from "./FinalRatioPlayer";
import type { FinalViewProps } from "./types";

/**
 * Shared Step 4 (Final review) view used by both Plates and HyperFrames:
 * - Renders all available/generated ratios side-by-side in a responsive comparison stage
 *   (or a centered single frame when `ratios.length === 1`)
 * - Each player frame carries its own top-right download action (or preparing/failed status chip)
 *   and branded Greedy Motion media controls
 * - Coordinates playback so starting one player pauses any other active player in this view
 * - Preserves `← Back to Animation` and `Approve final` (with in-flight & locked states)
 */
export function FinalView({
  title,
  subtitle,
  ratios,
  shape,
  poster,
  onBack,
  onApprove,
  approved,
  backLabel = "← Back to Animation",
  renderPreparingText,
  renderFailedText
}: FinalViewProps) {
  const [approving, setApproving] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const handleMediaPlay = useCallback((activeVideo: HTMLVideoElement) => {
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const videos = stageEl.querySelectorAll<HTMLVideoElement>("video.pf-video");
    videos.forEach((v) => {
      if (v !== activeVideo && !v.paused) {
        v.pause();
      }
    });
  }, []);

  return (
    <div className="pf" role="region" aria-label="Final film" data-ratio-count={ratios.length}>
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

      {ratios.length > 0 && (
        <div
          ref={stageRef}
          className="pf-stage"
          data-count={ratios.length}
        >
          {ratios.map((ratio) => (
            <FinalRatioPlayer
              key={ratio.id}
              ratio={ratio}
              shape={shape(ratio.id)}
              poster={poster}
              renderPreparingText={renderPreparingText}
              renderFailedText={renderFailedText}
              onMediaPlay={handleMediaPlay}
            />
          ))}
        </div>
      )}
    </div>
  );
}
