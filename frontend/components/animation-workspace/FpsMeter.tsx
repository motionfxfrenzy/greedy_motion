"use client";
import { useEffect, useRef, useState } from "react";
import {
  FPS_PAUSE_HOLD_MS,
  FPS_TOOLTIP_TEXT,
  FpsMeterController,
  SLOW_PLAYBACK_HINT_TEXT,
  type FpsMeterSnapshot
} from "./fps";
import type { WorkspaceFpsMeterProps } from "./types";

type VideoFrameCallbackMetadataLike = {
  presentedFrames?: number;
  mediaTime?: number;
};

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadataLike) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function FpsMeter({
  playing,
  buffering = false,
  source,
  sceneKey,
  getVideoElement,
  getLiveMetrics,
  snapshot: snapshotOverride
}: WorkspaceFpsMeterProps) {
  const controllerRef = useRef<FpsMeterController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new FpsMeterController();
  }

  const getVideoRef = useRef(getVideoElement);
  const getLiveRef = useRef(getLiveMetrics);
  getVideoRef.current = getVideoElement;
  getLiveRef.current = getLiveMetrics;

  const [snapshot, setSnapshot] = useState<FpsMeterSnapshot | null>(null);

  useEffect(() => {
    const ctrl = controllerRef.current!;
    const initialRes = ctrl.setPlaybackState({
      playing,
      buffering,
      source,
      sceneKey,
      nowMs: nowMs()
    });
    setSnapshot(initialRes.snapshot);

    if (!playing) {
      if (!initialRes.snapshot) return;
      const timer = window.setTimeout(() => {
        const expired = ctrl.tick(nowMs());
        setSnapshot(expired.snapshot);
      }, FPS_PAUSE_HOLD_MS + 20);
      return () => window.clearTimeout(timer);
    }

    if (buffering) {
      return;
    }

    let active = true;
    let attachedVideo: VideoWithRvfc | null = null;
    let rvfcHandle: number | null = null;
    let fallbackFrames = 0;

    const detachVideo = () => {
      if (attachedVideo && rvfcHandle !== null && typeof attachedVideo.cancelVideoFrameCallback === "function") {
        try {
          attachedVideo.cancelVideoFrameCallback(rvfcHandle);
        } catch {}
      }
      rvfcHandle = null;
      attachedVideo = null;
    };

    const onVideoFrame = (frameNow: number, metadata: VideoFrameCallbackMetadataLike) => {
      if (!active) return;
      const v = (getVideoRef.current?.() ?? attachedVideo) as VideoWithRvfc | null;
      if (!v || v !== attachedVideo) {
        return;
      }
      if (!v.paused && !v.ended && !v.seeking && v.readyState >= 2) {
        fallbackFrames += 1;
        const presentedFrames =
          typeof metadata?.presentedFrames === "number" ? metadata.presentedFrames : fallbackFrames;
        const mediaTimeSec =
          typeof metadata?.mediaTime === "number" ? metadata.mediaTime : v.currentTime;
        const res = ctrl.recordSample({
          wallTimeMs: frameNow,
          presentedFrames,
          mediaTimeSec
        });
        if (res.changed) {
          setSnapshot(res.snapshot);
        }
      }
      if (active && typeof v.requestVideoFrameCallback === "function") {
        rvfcHandle = v.requestVideoFrameCallback(onVideoFrame);
      }
    };

    const ensureVideoAttached = () => {
      if (source !== "clip") return;
      const nextVideo = (getVideoRef.current?.() ?? null) as VideoWithRvfc | null;
      if (nextVideo === attachedVideo) return;
      detachVideo();
      if (nextVideo && typeof nextVideo.requestVideoFrameCallback === "function") {
        attachedVideo = nextVideo;
        fallbackFrames = 0;
        rvfcHandle = nextVideo.requestVideoFrameCallback(onVideoFrame);
      }
    };

    if (source === "clip") {
      ensureVideoAttached();
      const timer = window.setInterval(() => {
        if (!active) return;
        ensureVideoAttached();
        const v = getVideoRef.current?.() ?? null;
        const now = nowMs();
        if (!v || v.paused || v.ended || v.seeking || v.readyState < 2) {
          const res = ctrl.setPlaybackState({
            playing: true,
            buffering: true,
            source: "clip",
            sceneKey,
            nowMs: now
          });
          if (res.changed) setSnapshot(res.snapshot);
          return;
        }
        if (attachedVideo && typeof attachedVideo.requestVideoFrameCallback !== "function") {
          // Fallback if browser lacks requestVideoFrameCallback
          const quality = typeof v.getVideoPlaybackQuality === "function" ? v.getVideoPlaybackQuality() : null;
          const presentedFrames = quality ? quality.totalVideoFrames : Math.round(v.currentTime * 30);
          const res = ctrl.recordSample({
            wallTimeMs: now,
            presentedFrames,
            mediaTimeSec: v.currentTime
          });
          if (res.changed) setSnapshot(res.snapshot);
          return;
        }
        const res = ctrl.setPlaybackState({
          playing: true,
          buffering: false,
          source: "clip",
          sceneKey,
          nowMs: now
        });
        if (res.changed) {
          setSnapshot(res.snapshot);
        }
      }, 250);

      return () => {
        active = false;
        window.clearInterval(timer);
        detachVideo();
      };
    }

    // Live-drawn scene sampling
    const sampleLive = () => {
      if (!active) return;
      const now = nowMs();
      const liveMetrics = getLiveRef.current?.() ?? null;
      if (!liveMetrics || liveMetrics.buffering) {
        const res = ctrl.setPlaybackState({
          playing: true,
          buffering: true,
          source: "live",
          sceneKey,
          nowMs: now
        });
        if (res.changed) setSnapshot(res.snapshot);
        return;
      }
      ctrl.setPlaybackState({
        playing: true,
        buffering: false,
        source: "live",
        sceneKey,
        nowMs: now
      });
      const res = ctrl.recordSample({
        wallTimeMs: now,
        presentedFrames: liveMetrics.presentedFrames,
        mediaTimeSec: liveMetrics.mediaTimeSec
      });
      if (res.changed) {
        setSnapshot(res.snapshot);
      }
    };

    sampleLive();
    const liveTimer = window.setInterval(sampleLive, 100);
    return () => {
      active = false;
      window.clearInterval(liveTimer);
    };
  }, [playing, buffering, source, sceneKey]);

  const effective = snapshotOverride !== undefined ? snapshotOverride : snapshot;
  if (!effective || !effective.visible) {
    return null;
  }

  return (
    <div
      className={`aw-fps-meter aw-fps-${effective.tone}`}
      aria-hidden="true"
      title={effective.tooltipText || FPS_TOOLTIP_TEXT}
      data-fps-source={effective.source}
      data-fps-tone={effective.tone}
    >
      <div className="aw-fps-chip">
        <span className="aw-fps-value">{effective.fpsText}</span>
        <span className="aw-fps-source">{effective.source}</span>
        {effective.showRate && effective.rateText && (
          <span className="aw-fps-rate">{effective.rateText}</span>
        )}
      </div>
      {effective.showHint && (
        <div className="aw-fps-hint">{effective.hintText || SLOW_PLAYBACK_HINT_TEXT}</div>
      )}
    </div>
  );
}
