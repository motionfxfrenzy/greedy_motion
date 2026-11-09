/**
 * Pure playback frame-rate (FPS) sliding-window measurement, colour thresholds,
 * UI update throttling (at most 2 updates/s), and slow-playback warning state machine.
 */

export const TARGET_FPS = 30;
export const FPS_WINDOW_MS = 1000;
export const FPS_MIN_WINDOW_SPAN_MS = 200;
export const FPS_STALL_GAP_MS = 150;
export const FPS_UI_THROTTLE_MS = 500;
export const FPS_PAUSE_HOLD_MS = 2000;

export const FPS_NEUTRAL_THRESHOLD = 27;
export const FPS_AMBER_THRESHOLD = 15;
export const BELOW_REALTIME_RATE_THRESHOLD = 0.95;

export const SLOW_PLAYBACK_THRESHOLD = 0.9;
export const SLOW_PLAYBACK_CONSECUTIVE_WINDOWS = 3;
export const SLOW_HINT_MAX_DURATION_MS = 10_000;

export const FPS_TOOLTIP_TEXT =
  "Frames actually shown per second over the last second. The film is 30 fps; below that the device cannot keep up.";

export const SLOW_PLAYBACK_HINT_TEXT = "Playing slower than real time: this device is busy";

export type FpsSource = "clip" | "live";
export type FpsTone = "neutral" | "amber" | "red";

export interface FpsSample {
  wallTimeMs: number;
  presentedFrames: number;
  mediaTimeSec: number;
}

export interface FpsWindowMetrics {
  fps: number;
  mediaPerWall: number;
  tone: FpsTone;
  belowRealTime: boolean;
  spanMs: number;
  frameDelta: number;
  mediaDeltaSec: number;
}

export interface FpsMeterSnapshot {
  visible: boolean;
  fps: number;
  fpsText: string;
  source: FpsSource;
  tone: FpsTone;
  mediaPerWall: number;
  rateText: string | null;
  showRate: boolean;
  showHint: boolean;
  hintText: string | null;
  tooltipText: string;
}

export interface SlowPlaybackHintState {
  slowWindowStreak: number;
  hintVisible: boolean;
  hintShownAtMs: number | null;
  hintDismissed: boolean;
}

/**
 * Colour threshold rule:
 * - >= 27 fps: neutral
 * - 15 to 27 fps: amber
 * - < 15 fps: red
 */
export function fpsTone(fps: number): FpsTone {
  if (fps >= FPS_NEUTRAL_THRESHOLD) return "neutral";
  if (fps >= FPS_AMBER_THRESHOLD) return "amber";
  return "red";
}

export function formatFps(fps: number): string {
  const clamped = Number.isFinite(fps) ? Math.max(0, fps) : 0;
  return `${(Math.round(clamped * 10) / 10).toFixed(1)} fps`;
}

export function formatMediaPerWall(mediaPerWall: number): string {
  const clamped = Number.isFinite(mediaPerWall) ? Math.max(0, mediaPerWall) : 0;
  return `${(Math.round(clamped * 100) / 100).toFixed(2)}x`;
}

export function isBelowRealTime(mediaPerWall: number, fps?: number): boolean {
  if (!Number.isFinite(mediaPerWall)) return false;
  if (mediaPerWall < BELOW_REALTIME_RATE_THRESHOLD) return true;
  if (typeof fps === "number" && Number.isFinite(fps) && fps < FPS_NEUTRAL_THRESHOLD && mediaPerWall < 0.98) {
    return true;
  }
  return false;
}

/**
 * Appends a frame/clock sample to the 1 s sliding window buffer, resetting if counters moved backwards
 * (e.g. scene switch or seek) and pruning samples older than `windowMs` while retaining the anchor sample
 * at the start of the window.
 */
export function recordFpsSample(
  samples: readonly FpsSample[],
  sample: FpsSample,
  windowMs: number = FPS_WINDOW_MS
): FpsSample[] {
  if (
    !Number.isFinite(sample.wallTimeMs) ||
    !Number.isFinite(sample.presentedFrames) ||
    !Number.isFinite(sample.mediaTimeSec)
  ) {
    return [...samples];
  }
  const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
  if (
    last &&
    (sample.wallTimeMs < last.wallTimeMs ||
      sample.presentedFrames < last.presentedFrames ||
      sample.mediaTimeSec < last.mediaTimeSec - 0.05)
  ) {
    return [sample];
  }
  const next = [...samples, sample];
  const cutoff = sample.wallTimeMs - windowMs;
  while (next.length >= 2 && next[1]!.wallTimeMs <= cutoff) {
    next.shift();
  }
  return next;
}

/**
 * Computes achieved FPS and `mediaPerWall = Δ media time / Δ wall time` over a 1 s sliding window.
 * Returns `null` when paused, buffering, or before enough window span has accumulated.
 */
export function computeFpsWindow(
  samples: readonly FpsSample[],
  nowMs?: number,
  options?: {
    windowMs?: number;
    minSpanMs?: number;
    paused?: boolean;
    buffering?: boolean;
  }
): FpsWindowMetrics | null {
  if (options?.paused || options?.buffering) {
    return null;
  }
  if (!samples || samples.length === 0) {
    return null;
  }
  const windowMs = options?.windowMs ?? FPS_WINDOW_MS;
  const minSpanMs = options?.minSpanMs ?? FPS_MIN_WINDOW_SPAN_MS;
  const last = samples[samples.length - 1]!;
  const effectiveNow = typeof nowMs === "number" && Number.isFinite(nowMs) ? Math.max(last.wallTimeMs, nowMs) : last.wallTimeMs;
  const cutoff = effectiveNow - windowMs;

  // If no frame has been presented for at least a full window after at least one prior frame, it is a full stall (0 fps).
  const silentGapMs = effectiveNow - last.wallTimeMs;
  if (silentGapMs >= windowMs && samples.length >= 1) {
    const totalElapsed = effectiveNow - samples[0]!.wallTimeMs;
    if (totalElapsed >= minSpanMs) {
      return {
        fps: 0,
        mediaPerWall: 0,
        tone: "red",
        belowRealTime: true,
        spanMs: windowMs,
        frameDelta: 0,
        mediaDeltaSec: 0
      };
    }
  }

  let anchorIdx = 0;
  while (anchorIdx + 1 < samples.length && samples[anchorIdx + 1]!.wallTimeMs <= cutoff) {
    anchorIdx += 1;
  }
  const first = samples[anchorIdx]!;

  // Use the last sample's timestamp during normal cadence; include trailing silent gap if stalling (> 150 ms).
  const endWallMs = silentGapMs > FPS_STALL_GAP_MS ? effectiveNow : last.wallTimeMs;
  const spanMs = endWallMs - first.wallTimeMs;
  if (spanMs < minSpanMs) {
    return null;
  }

  const wallSec = spanMs / 1000;
  const frameDelta = Math.max(0, last.presentedFrames - first.presentedFrames);
  const mediaDeltaSec = Math.max(0, last.mediaTimeSec - first.mediaTimeSec);

  const rawFps = frameDelta / wallSec;
  const fps = Math.round(rawFps * 10) / 10;
  const rawMediaPerWall = mediaDeltaSec / wallSec;
  const mediaPerWall = Math.round(rawMediaPerWall * 100) / 100;
  const tone = fpsTone(fps);
  const belowRealTime = isBelowRealTime(mediaPerWall, fps);

  return {
    fps,
    mediaPerWall,
    tone,
    belowRealTime,
    spanMs,
    frameDelta,
    mediaDeltaSec
  };
}

export function createSlowPlaybackHintState(): SlowPlaybackHintState {
  return {
    slowWindowStreak: 0,
    hintVisible: false,
    hintShownAtMs: null,
    hintDismissed: false
  };
}

/**
 * Steps the slow-playback warning state machine for a completed 1 s playback window
 * (or pause/expiry transition).
 * Rule: when `mediaPerWall < 0.9` for 3 consecutive windows during playback, show the hint
 * for the first 10 s only; dismissible by pausing.
 */
export function stepSlowPlaybackHint(
  state: SlowPlaybackHintState,
  input: {
    playing: boolean;
    buffering?: boolean;
    mediaPerWall?: number | null;
    windowCompleted?: boolean;
    nowMs: number;
    maxDurationMs?: number;
  }
): SlowPlaybackHintState {
  const maxDurationMs = input.maxDurationMs ?? SLOW_HINT_MAX_DURATION_MS;

  if (!input.playing) {
    return {
      slowWindowStreak: 0,
      hintVisible: false,
      hintShownAtMs: state.hintShownAtMs,
      hintDismissed: state.hintDismissed || state.hintVisible
    };
  }

  if (input.buffering) {
    return {
      ...state,
      slowWindowStreak: 0,
      hintVisible: false
    };
  }

  let { slowWindowStreak, hintVisible, hintShownAtMs, hintDismissed } = state;

  if (hintVisible && hintShownAtMs !== null && input.nowMs - hintShownAtMs >= maxDurationMs) {
    hintVisible = false;
    hintDismissed = true;
  }

  if (input.windowCompleted && typeof input.mediaPerWall === "number" && Number.isFinite(input.mediaPerWall)) {
    if (input.mediaPerWall < SLOW_PLAYBACK_THRESHOLD) {
      slowWindowStreak += 1;
      if (slowWindowStreak >= SLOW_PLAYBACK_CONSECUTIVE_WINDOWS && !hintDismissed && !hintVisible) {
        hintVisible = true;
        hintShownAtMs = input.nowMs;
      }
    } else {
      slowWindowStreak = 0;
    }
  }

  return {
    slowWindowStreak,
    hintVisible,
    hintShownAtMs,
    hintDismissed
  };
}

export interface FpsMeterControllerOptions {
  windowMs?: number;
  throttleMs?: number;
  pauseHoldMs?: number;
  hintMaxDurationMs?: number;
}

/**
 * Stateful controller kept in a React ref so frame callbacks never trigger per-frame renders.
 * Emits UI snapshots at most `1000 / throttleMs` (2) times per second.
 */
export class FpsMeterController {
  private readonly windowMs: number;
  private readonly throttleMs: number;
  private readonly pauseHoldMs: number;
  private readonly hintMaxDurationMs: number;

  private source: FpsSource = "clip";
  private sceneKey: string | number = 0;
  private playing = false;
  private buffering = false;
  private samples: FpsSample[] = [];
  private lastUiUpdateMs: number | null = null;
  private lastWindowEvalMs: number | null = null;
  private hintState: SlowPlaybackHintState = createSlowPlaybackHintState();
  private pausedAtMs: number | null = null;
  private activeSnapshot: FpsMeterSnapshot | null = null;
  private heldSnapshot: FpsMeterSnapshot | null = null;
  private updatesEmitted = 0;

  constructor(options?: FpsMeterControllerOptions) {
    this.windowMs = options?.windowMs ?? FPS_WINDOW_MS;
    this.throttleMs = options?.throttleMs ?? FPS_UI_THROTTLE_MS;
    this.pauseHoldMs = options?.pauseHoldMs ?? FPS_PAUSE_HOLD_MS;
    this.hintMaxDurationMs = options?.hintMaxDurationMs ?? SLOW_HINT_MAX_DURATION_MS;
  }

  get uiUpdateCount(): number {
    return this.updatesEmitted;
  }

  get slowWindowStreak(): number {
    return this.hintState.slowWindowStreak;
  }

  /**
   * Returns the active measurement snapshot while playing (strictly `null` when paused or buffering).
   */
  getActiveReading(): FpsMeterSnapshot | null {
    if (!this.playing || this.buffering) return null;
    return this.activeSnapshot;
  }

  /**
   * Returns the UI snapshot to display on the chip: visible while playing (and not buffering),
   * and held for `pauseHoldMs` (2 s) after pausing with the hint dismissed.
   */
  getDisplaySnapshot(nowMs?: number): FpsMeterSnapshot | null {
    if (this.buffering) return null;
    if (this.playing) return this.activeSnapshot;
    if (!this.heldSnapshot || this.pausedAtMs === null || this.pauseHoldMs <= 0) {
      return null;
    }
    if (typeof nowMs === "number" && nowMs - this.pausedAtMs >= this.pauseHoldMs) {
      this.heldSnapshot = null;
      return null;
    }
    return this.heldSnapshot;
  }

  setScene(sceneKey: string | number, source: FpsSource): void {
    if (this.sceneKey !== sceneKey || this.source !== source) {
      this.sceneKey = sceneKey;
      this.source = source;
      this.samples = [];
      this.lastWindowEvalMs = null;
    }
  }

  setPlaybackState(state: {
    playing: boolean;
    buffering?: boolean;
    source?: FpsSource;
    sceneKey?: string | number;
    nowMs: number;
  }): { changed: boolean; snapshot: FpsMeterSnapshot | null } {
    if (state.source !== undefined && state.sceneKey !== undefined) {
      this.setScene(state.sceneKey, state.source);
    } else if (state.source !== undefined && state.source !== this.source) {
      this.source = state.source;
      this.samples = [];
      this.lastWindowEvalMs = null;
    } else if (state.sceneKey !== undefined && state.sceneKey !== this.sceneKey) {
      this.sceneKey = state.sceneKey;
      this.samples = [];
      this.lastWindowEvalMs = null;
    }

    const nextBuffering = Boolean(state.buffering);
    const wasPlaying = this.playing;
    const wasBuffering = this.buffering;
    this.playing = state.playing;
    this.buffering = nextBuffering;

    const prevDisplay = this.heldSnapshot;

    if (!this.playing) {
      if (wasPlaying) {
        this.pausedAtMs = state.nowMs;
      }
      this.samples = [];
      this.lastWindowEvalMs = null;
      this.hintState = stepSlowPlaybackHint(this.hintState, {
        playing: false,
        nowMs: state.nowMs,
        maxDurationMs: this.hintMaxDurationMs
      });
      this.activeSnapshot = null;
      if (this.heldSnapshot) {
        if (
          this.pauseHoldMs <= 0 ||
          (this.pausedAtMs !== null && state.nowMs - this.pausedAtMs >= this.pauseHoldMs)
        ) {
          this.heldSnapshot = null;
        } else if (this.heldSnapshot.showHint) {
          this.heldSnapshot = {
            ...this.heldSnapshot,
            showHint: false,
            hintText: null
          };
        }
      }
      const nextDisplay = this.getDisplaySnapshot(state.nowMs);
      return {
        changed: !snapshotsEqual(prevDisplay, nextDisplay),
        snapshot: nextDisplay
      };
    }

    // Playing is true
    this.pausedAtMs = null;
    if (nextBuffering) {
      this.samples = [];
      this.lastWindowEvalMs = null;
      this.hintState = stepSlowPlaybackHint(this.hintState, {
        playing: true,
        buffering: true,
        nowMs: state.nowMs,
        maxDurationMs: this.hintMaxDurationMs
      });
      this.activeSnapshot = null;
      this.heldSnapshot = null;
      return {
        changed: prevDisplay !== null || wasBuffering !== nextBuffering,
        snapshot: null
      };
    }

    return this.tick(state.nowMs);
  }

  /**
   * Records a presented frame sample and updates the throttled UI snapshot if at least `throttleMs` (500 ms)
   * has elapsed since the last UI update. Ignored when paused or buffering.
   */
  recordSample(sample: FpsSample): { changed: boolean; snapshot: FpsMeterSnapshot | null } {
    if (!this.playing || this.buffering) {
      return {
        changed: false,
        snapshot: this.getDisplaySnapshot(sample.wallTimeMs)
      };
    }
    this.samples = recordFpsSample(this.samples, sample, this.windowMs);
    return this.tick(sample.wallTimeMs);
  }

  /**
   * Evaluates the sliding window at `nowMs` (handles both normal cadence and stalls when no frames arrive,
   * plus post-pause hold expiry).
   */
  tick(nowMs: number): { changed: boolean; snapshot: FpsMeterSnapshot | null } {
    if (!this.playing || this.buffering) {
      const prev = this.heldSnapshot;
      const next = this.getDisplaySnapshot(nowMs);
      return {
        changed: !snapshotsEqual(prev, next),
        snapshot: next
      };
    }

    const metrics = computeFpsWindow(this.samples, nowMs, {
      windowMs: this.windowMs,
      paused: false,
      buffering: false
    });

    if (!metrics) {
      return {
        changed: false,
        snapshot: this.activeSnapshot
      };
    }

    // Check if a 1 s window completed for the 3-consecutive-windows hint rule
    let windowCompleted = false;
    if (this.lastWindowEvalMs === null) {
      if (metrics.spanMs >= this.windowMs - 50) {
        windowCompleted = true;
        this.lastWindowEvalMs = nowMs;
      }
    } else if (nowMs - this.lastWindowEvalMs >= this.windowMs - 50) {
      windowCompleted = true;
      this.lastWindowEvalMs = nowMs;
    }

    const prevHintVisible = this.hintState.hintVisible;
    this.hintState = stepSlowPlaybackHint(this.hintState, {
      playing: true,
      buffering: false,
      mediaPerWall: metrics.mediaPerWall,
      windowCompleted,
      nowMs,
      maxDurationMs: this.hintMaxDurationMs
    });
    const hintVisibilityChanged = prevHintVisible !== this.hintState.hintVisible;

    const canUpdateUi =
      this.lastUiUpdateMs === null || nowMs - this.lastUiUpdateMs >= this.throttleMs;

    if (!canUpdateUi && !hintVisibilityChanged) {
      return {
        changed: false,
        snapshot: this.activeSnapshot
      };
    }

    if (canUpdateUi) {
      this.lastUiUpdateMs = nowMs;
      this.updatesEmitted += 1;
    }

    const nextSnapshot: FpsMeterSnapshot = {
      visible: true,
      fps: metrics.fps,
      fpsText: formatFps(metrics.fps),
      source: this.source,
      tone: metrics.tone,
      mediaPerWall: metrics.mediaPerWall,
      rateText: metrics.belowRealTime ? formatMediaPerWall(metrics.mediaPerWall) : null,
      showRate: metrics.belowRealTime,
      showHint: this.hintState.hintVisible,
      hintText: this.hintState.hintVisible ? SLOW_PLAYBACK_HINT_TEXT : null,
      tooltipText: FPS_TOOLTIP_TEXT
    };

    const prev = this.activeSnapshot;
    this.activeSnapshot = nextSnapshot;
    this.heldSnapshot = nextSnapshot;

    return {
      changed: !snapshotsEqual(prev, nextSnapshot),
      snapshot: nextSnapshot
    };
  }
}

function snapshotsEqual(a: FpsMeterSnapshot | null, b: FpsMeterSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.visible === b.visible &&
    a.fps === b.fps &&
    a.fpsText === b.fpsText &&
    a.source === b.source &&
    a.tone === b.tone &&
    a.mediaPerWall === b.mediaPerWall &&
    a.rateText === b.rateText &&
    a.showRate === b.showRate &&
    a.showHint === b.showHint &&
    a.hintText === b.hintText
  );
}
