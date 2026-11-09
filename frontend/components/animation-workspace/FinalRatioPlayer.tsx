"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildFinalRatioDownloadUrl, formatClock, formatFinalWaitMessage } from "./logic";
import type { FinalViewRatio } from "./types";

export interface FinalRatioPlayerProps {
  ratio: FinalViewRatio;
  shape: string;
  poster?: string;
  renderPreparingText?: (ratio: FinalViewRatio) => string;
  renderFailedText?: (ratio: FinalViewRatio) => string;
  onMediaPlay?: (videoEl: HTMLVideoElement) => void;
}

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};

function sanitizeDuration(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function sanitizeTime(raw: number, maxDuration: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (maxDuration > 0) return Math.min(raw, maxDuration);
  return raw;
}

function hasAuthTokenParam(url: string | null): boolean {
  return Boolean(url && /[?&](?:mt|t)=[^&]+/.test(url));
}

function baseMediaKey(url: string | null): string {
  if (!url) return "";
  return url
    .replace(/([?&])(?:mt|t)=[^&]+(&|$)/g, "$1")
    .replace(/\?&/g, "?")
    .replace(/[?&]+$/, "");
}

/**
 * Branded per-ratio video frame for FinalView:
 * - Preserves rounded black frame (`aspect-ratio`, `object-fit: contain`)
 * - Places ratio badge (top-left) and download action / status pill (top-right) ON the frame
 * - Provides custom Greedy Motion media controls (play/pause/replay, tabular clock, seek bar,
 *   mute/unmute + volume slider, fullscreen toggle) with no native browser 3-dot chrome
 */
export function FinalRatioPlayer({
  ratio,
  shape,
  poster,
  renderPreparingText,
  renderFailedText,
  onMediaPlay
}: FinalRatioPlayerProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isScrubbingRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(1);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);

  const src = ratio.url;
  const downloadHref = buildFinalRatioDownloadUrl(src, ratio.downloadName);
  const mediaKey = baseMediaKey(src);
  const [videoSrc, setVideoSrc] = useState<string | null>(src);
  const prevMediaKeyRef = useRef<string>(mediaKey);

  useEffect(() => {
    if (!src) {
      prevMediaKeyRef.current = "";
      setVideoSrc(null);
      return;
    }
    const keyChanged = prevMediaKeyRef.current !== mediaKey;
    const tokenAdded = !hasAuthTokenParam(videoSrc) && hasAuthTokenParam(src);
    const el = videoRef.current;
    const isIdleUnloaded = !el || (el.paused && el.currentTime === 0 && el.readyState === 0);
    if (keyChanged || tokenAdded || !videoSrc || mediaError || isIdleUnloaded) {
      prevMediaKeyRef.current = mediaKey;
      if (tokenAdded && mediaError) {
        setMediaError(false);
      }
      if (videoSrc !== src) {
        setVideoSrc(src);
      }
    }
  }, [src, mediaKey, videoSrc, mediaError]);

  useEffect(() => {
    isScrubbingRef.current = false;
    setPlaying(false);
    setEnded(false);
    setCurrentTime(0);
    setDuration(0);
    setScrubTime(null);
    setBuffering(false);
    setMediaError(false);
  }, [mediaKey]);

  useEffect(() => {
    const checkSupport = () => {
      if (typeof document === "undefined") return;
      const doc = document as FullscreenCapableDocument;
      const frame = frameRef.current as FullscreenCapableElement | null;
      const video = videoRef.current as FullscreenCapableVideo | null;
      const canFrameFs =
        Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? true) &&
        Boolean(frame?.requestFullscreen || frame?.webkitRequestFullscreen);
      const canVideoFs = Boolean(
        video?.requestFullscreen ||
          video?.webkitEnterFullscreen ||
          video?.webkitSupportsFullscreen
      );
      setFullscreenSupported(canFrameFs || canVideoFs);
    };
    checkSupport();
  }, [src]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const doc = document as FullscreenCapableDocument;
    const onFsChange = () => {
      const activeEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      const ownsFs =
        Boolean(activeEl) &&
        (activeEl === frameRef.current || activeEl === videoRef.current);
      setIsFullscreen(ownsFs);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;

    const syncDurationAndTime = () => {
      const nextDur = sanitizeDuration(el.duration);
      setDuration(nextDur);
      if (!isScrubbingRef.current) {
        setCurrentTime(sanitizeTime(el.currentTime, nextDur));
      }
    };

    const handleLoadedMetadata = () => {
      syncDurationAndTime();
      setMediaError(false);
    };

    const handleDurationChange = () => {
      syncDurationAndTime();
    };

    const handleTimeUpdate = () => {
      const nextDur = sanitizeDuration(el.duration);
      if (nextDur > 0) setDuration(nextDur);
      if (!isScrubbingRef.current) {
        setCurrentTime(sanitizeTime(el.currentTime, nextDur));
      }
    };

    const handlePlay = () => {
      setPlaying(true);
      setEnded(false);
      setMediaError(false);
      onMediaPlay?.(el);
    };

    const handlePause = () => {
      setPlaying(false);
      setBuffering(false);
    };

    const handleEnded = () => {
      const nextDur = sanitizeDuration(el.duration);
      setPlaying(false);
      setEnded(true);
      setBuffering(false);
      if (nextDur > 0) {
        setCurrentTime(nextDur);
      }
    };

    const handleVolumeChange = () => {
      const nextVol = Number.isFinite(el.volume)
        ? Math.min(1, Math.max(0, el.volume))
        : 1;
      const nextMuted = Boolean(el.muted || nextVol === 0);
      if (nextVol > 0) {
        lastNonZeroVolumeRef.current = nextVol;
      }
      setVolume(nextVol);
      setMuted(nextMuted);
    };

    const handleWaiting = () => {
      if (!el.paused) {
        setBuffering(true);
      }
    };

    const handleCanPlay = () => {
      setBuffering(false);
      setMediaError(false);
    };

    const handleError = () => {
      setPlaying(false);
      setBuffering(false);
      setMediaError(true);
    };

    el.addEventListener("loadedmetadata", handleLoadedMetadata);
    el.addEventListener("durationchange", handleDurationChange);
    el.addEventListener("timeupdate", handleTimeUpdate);
    el.addEventListener("play", handlePlay);
    el.addEventListener("pause", handlePause);
    el.addEventListener("ended", handleEnded);
    el.addEventListener("volumechange", handleVolumeChange);
    el.addEventListener("waiting", handleWaiting);
    el.addEventListener("canplay", handleCanPlay);
    el.addEventListener("playing", handleCanPlay);
    el.addEventListener("loadeddata", handleCanPlay);
    el.addEventListener("error", handleError);

    if (el.readyState >= 1) {
      syncDurationAndTime();
    }
    handleVolumeChange();

    return () => {
      el.removeEventListener("loadedmetadata", handleLoadedMetadata);
      el.removeEventListener("durationchange", handleDurationChange);
      el.removeEventListener("timeupdate", handleTimeUpdate);
      el.removeEventListener("play", handlePlay);
      el.removeEventListener("pause", handlePause);
      el.removeEventListener("ended", handleEnded);
      el.removeEventListener("volumechange", handleVolumeChange);
      el.removeEventListener("waiting", handleWaiting);
      el.removeEventListener("canplay", handleCanPlay);
      el.removeEventListener("playing", handleCanPlay);
      el.removeEventListener("loadeddata", handleCanPlay);
      el.removeEventListener("error", handleError);
    };
  }, [videoSrc, onMediaPlay]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      const safeDur = sanitizeDuration(el.duration);
      if (el.ended || ended || (safeDur > 0 && el.currentTime >= safeDur - 0.02)) {
        try {
          el.currentTime = 0;
        } catch {
          // ignore if unseekable before metadata
        }
        setCurrentTime(0);
        setEnded(false);
      }
      setPlaying(true);
      onMediaPlay?.(el);
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          setPlaying(false);
        });
      }
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [ended, onMediaPlay]);

  const handleSeekInput = useCallback(
    (nextRaw: number) => {
      const el = videoRef.current;
      const safeDur = sanitizeDuration(el?.duration ?? duration);
      const clamped = sanitizeTime(nextRaw, safeDur);
      setScrubTime(clamped);
      setCurrentTime(clamped);
      if (ended && (safeDur === 0 || clamped < safeDur)) {
        setEnded(false);
      }
      if (el && safeDur > 0) {
        try {
          el.currentTime = clamped;
        } catch {
          // ignore transient seek errors
        }
      }
    },
    [duration, ended]
  );

  const finishScrub = useCallback(() => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    setScrubTime(null);
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.muted || el.volume === 0) {
      const restored =
        lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 1;
      el.muted = false;
      el.volume = restored;
      setMuted(false);
      setVolume(restored);
    } else {
      if (el.volume > 0) {
        lastNonZeroVolumeRef.current = el.volume;
      }
      el.muted = true;
      setMuted(true);
    }
  }, []);

  const handleVolumeChange = useCallback((nextRaw: number) => {
    const el = videoRef.current;
    const clamped = Number.isFinite(nextRaw)
      ? Math.min(1, Math.max(0, nextRaw))
      : 1;
    if (clamped > 0) {
      lastNonZeroVolumeRef.current = clamped;
    }
    setVolume(clamped);
    setMuted(clamped === 0);
    if (el) {
      el.volume = clamped;
      el.muted = clamped === 0;
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    const doc = document as FullscreenCapableDocument;
    const frame = frameRef.current as FullscreenCapableElement | null;
    const video = videoRef.current as FullscreenCapableVideo | null;
    const activeEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

    try {
      if (activeEl) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
        return;
      }
      if (frame?.requestFullscreen) {
        await frame.requestFullscreen();
      } else if (frame?.webkitRequestFullscreen) {
        await frame.webkitRequestFullscreen();
      } else if (video?.requestFullscreen) {
        await video.requestFullscreen();
      } else if (video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    } catch {
      // Fullscreen may be blocked by browser permissions or headless policies
    }
  }, []);

  const safeDuration = sanitizeDuration(duration);
  const displayTime = sanitizeTime(scrubTime ?? currentTime, safeDuration);
  const progressPercent =
    safeDuration > 0 ? Math.min(100, Math.max(0, (displayTime / safeDuration) * 100)) : 0;
  const playActionLabel = ended ? "Replay" : playing ? "Pause" : "Play";
  const shapeToken = ratio.id.replace(/:/g, "x");

  const waitMessage =
    ratio.status === "failed"
      ? renderFailedText
        ? renderFailedText(ratio)
        : formatFinalWaitMessage(ratio)
      : renderPreparingText
      ? renderPreparingText(ratio)
      : formatFinalWaitMessage(ratio);

  return (
    <div
      ref={frameRef}
      className={`pf-frame${playing ? " is-playing" : ""}${ended ? " is-ended" : ""}${isFullscreen ? " is-fullscreen" : ""}`}
      style={{ aspectRatio: shape }}
      data-ratio={ratio.id}
      data-status={ratio.status}
      role="group"
      aria-label={`${ratio.label} video player`}
    >
      <div className="pf-frame-top">
        <span className="pf-ratio-badge" aria-hidden="true">
          <i className={`aw-dim-shape aw-dim-${shapeToken}`} />
          <span>{ratio.label}</span>
        </span>
        {src ? (
          <a
            className="aw-btn pf-download-btn"
            href={downloadHref ?? src}
            download={ratio.downloadName}
            aria-label={`Download ${ratio.label}`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
            </svg>
            <span>Download {ratio.label}</span>
          </a>
        ) : (
          <span
            className={`aw-btn pf-download-status pf-download-status--${ratio.status}`}
            aria-busy={ratio.status === "preparing"}
          >
            {ratio.label}: {ratio.status === "failed" ? "failed" : "preparing…"}
          </span>
        )}
      </div>

      {src ? (
        <>
          <video
            ref={videoRef}
            src={videoSrc ?? src}
            poster={poster}
            playsInline
            preload="metadata"
            controlsList="nodownload"
            disablePictureInPicture
            className="pf-video"
            onClick={togglePlay}
          />

          {buffering && (
            <div className="pf-overlay-badge" role="status" aria-live="polite">
              <i className="aw-spin" aria-hidden="true" />
              <span>Buffering…</span>
            </div>
          )}

          {mediaError && (
            <div className="pf-overlay-badge pf-overlay-badge--error" role="status">
              <span className="pf-error-text">Could not load {ratio.label} video.</span>
              <button
                type="button"
                className="pf-retry-media"
                onClick={() => {
                  setMediaError(false);
                  if (src && videoSrc !== src) {
                    setVideoSrc(src);
                  }
                  videoRef.current?.load();
                }}
              >
                Reload
              </button>
            </div>
          )}

          <div
            className="pf-controls"
            role="group"
            aria-label={`${ratio.label} playback controls`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pf-seek-row">
              <input
                type="range"
                className="pf-seek"
                min={0}
                max={safeDuration > 0 ? safeDuration : 1}
                step={0.01}
                value={safeDuration > 0 ? displayTime : 0}
                disabled={safeDuration <= 0}
                aria-label={`Seek ${ratio.label}`}
                aria-valuemin={0}
                aria-valuemax={Math.round(safeDuration * 100) / 100}
                aria-valuenow={Math.round(displayTime * 100) / 100}
                aria-valuetext={`${formatClock(displayTime)} of ${formatClock(safeDuration)}`}
                style={
                  {
                    "--pf-progress": `${progressPercent.toFixed(2)}%`
                  } as React.CSSProperties
                }
                onPointerDown={() => {
                  isScrubbingRef.current = true;
                }}
                onPointerUp={finishScrub}
                onPointerCancel={finishScrub}
                onBlur={finishScrub}
                onKeyUp={finishScrub}
                onChange={(e) => handleSeekInput(Number(e.currentTarget.value))}
              />
            </div>

            <div className="pf-transport-row">
              <button
                type="button"
                className="pf-ctrl-btn pf-play-btn"
                onClick={togglePlay}
                aria-label={playActionLabel}
                title={`${playActionLabel} (${ratio.label})`}
                data-state={ended ? "ended" : playing ? "playing" : "paused"}
              >
                {ended ? (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                ) : playing ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7 5.2v13.6c0 .8.9 1.3 1.6.8l10.6-6.8c.6-.4.6-1.3 0-1.7L8.6 4.4C7.9 3.9 7 4.4 7 5.2Z" />
                  </svg>
                )}
              </button>

              <span className="pf-clock" aria-live="off">
                <b>{formatClock(displayTime)}</b>
                <span> / {formatClock(safeDuration)}</span>
              </span>

              <div className="pf-right-controls">
                <button
                  type="button"
                  className="pf-ctrl-btn pf-mute-btn"
                  onClick={toggleMute}
                  aria-pressed={muted || volume === 0}
                  aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                  title={muted || volume === 0 ? "Unmute" : "Mute"}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
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
                  type="range"
                  className="pf-volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  aria-label={`Volume ${ratio.label}`}
                  onChange={(e) => handleVolumeChange(Number(e.currentTarget.value))}
                />

                {fullscreenSupported && (
                  <button
                    type="button"
                    className="pf-ctrl-btn pf-fullscreen-btn"
                    onClick={() => void toggleFullscreen()}
                    aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
                    title={isFullscreen ? "Exit full screen" : "Full screen"}
                  >
                    {isFullscreen ? (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                      </svg>
                    ) : (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="pf-wait-wrap">
          {ratio.status === "preparing" && <i className="aw-spin" aria-hidden="true" />}
          <p
            className={`pf-wait${ratio.status === "failed" ? " pf-wait--failed" : ""}`}
            role="status"
          >
            {waitMessage}
          </p>
          {ratio.status === "preparing" && (
            <div className="pf-wait-bar" aria-hidden="true">
              <b style={{ width: `${Math.min(100, Math.max(6, ratio.progress ?? 0))}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
