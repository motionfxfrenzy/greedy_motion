import { SfxCueTracker, sceneAt, type SfxCue, type TimeSource } from "./clock.ts";
import type { SceneSpan } from "./types.ts";

/**
 * Single Web Audio timeline for plate films (phase 3g, plan change C):
 * - Plays per-scene voice takes, background music, and sound effects through ONE `AudioContext`.
 * - Each file is decoded once to an `AudioBuffer` and played with `AudioBufferSourceNode`s started against
 *   `AudioContext.currentTime`.
 * - While audio is active, the master film time is `AudioContext.currentTime - offset` (with no audio, uses wall clock).
 * - Buffering (`setBuffering(true)`) immediately calls `context.suspend()` so all sources stop at the exact same instant;
 *   resuming (`setBuffering(false)`) re-anchors `offset = context.currentTime - pausedFilmTime`, calls `context.resume()`,
 *   and reschedules active sources from the clock with zero drift across repeated pauses.
 * - Seeking stops active sources, re-arms `SfxCueTracker` without firing jumped-over cues, and reschedules from the new time
 *   — including playing the remainder of any sound effect whose active window spans the seek target.
 * - On `visibilitychange` to `hidden`, pauses both clock and audio (`suspend()`); on return to `visible`, resumes both in step.
 * - On device sleep / wake (a tick jump > `MAX_SLEEP_JUMP_SECONDS`), clamps the clock advance, re-anchors `offset`, and
 *   reschedules sources so no burst of cues fires and no drift accumulates.
 */

export const MAX_SLEEP_JUMP_SECONDS = 1.5;

export interface AudioParamLike {
  value: number;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length?: number;
  readonly sampleRate?: number;
  readonly numberOfChannels?: number;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  onended: (() => void) | null;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export type AudioContextStateLike = "suspended" | "running" | "closed" | "interrupted";

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: AudioContextStateLike;
  readonly destination: AudioNodeLike;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
  createBufferSource(): AudioBufferSourceNodeLike;
  createGain(): GainNodeLike;
  createBuffer?(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
}

export type ScheduledSourceRecord = {
  kind: "voice" | "music" | "sfx";
  sceneIndex: number;
  cueName?: string;
  source: AudioBufferSourceNodeLike;
  gainNode: GainNodeLike;
  startedAtContextTime: number;
  bufferOffset: number;
  duration: number;
  filmTimeAtStart: number;
  stopped: boolean;
};

/**
 * Deterministic in-memory `AudioContextLike` for unit tests.
 */
export class FakeAudioContext implements AudioContextLike {
  private time = 0;
  private currentState: AudioContextStateLike = "suspended";
  private allowResumeFlag = true;
  readonly destination: AudioNodeLike = {
    connect() {},
    disconnect() {}
  };
  readonly createdSources: (AudioBufferSourceNodeLike & {
    startedAt: number | null;
    startOffset: number;
    startDuration: number | undefined;
    stopped: boolean;
    disconnected: boolean;
    gainNode: GainNodeLike | null;
  })[] = [];
  suspendCount = 0;
  resumeCount = 0;
  decodeCount = 0;

  constructor(options?: { initialState?: AudioContextStateLike; initialTime?: number; allowResume?: boolean }) {
    this.currentState = options?.initialState ?? "running";
    this.time = options?.initialTime ?? 0;
    this.allowResumeFlag = options?.allowResume ?? true;
  }

  get currentTime(): number {
    return this.time;
  }

  get state(): AudioContextStateLike {
    return this.currentState;
  }

  setAllowResume(allow: boolean): void {
    this.allowResumeFlag = allow;
  }

  /** Advances the fake hardware clock (only advances `currentTime` when `"running"`, unless `force` is true). */
  advance(seconds: number, options?: { force?: boolean }): void {
    if (this.currentState === "running" || options?.force) {
      this.time += Math.max(0, seconds);
    }
  }

  setCurrentTime(seconds: number): void {
    this.time = Math.max(0, seconds);
  }

  async suspend(): Promise<void> {
    this.suspendCount++;
    if (this.currentState !== "closed") {
      this.currentState = "suspended";
    }
  }

  async resume(): Promise<void> {
    this.resumeCount++;
    if (this.currentState !== "closed" && this.allowResumeFlag) {
      this.currentState = "running";
    }
  }

  async close(): Promise<void> {
    this.currentState = "closed";
  }

  async decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike> {
    this.decodeCount++;
    // Convention for tests: if the first 8 bytes encode a positive float64 duration, use it; otherwise 3.0s.
    let dur = 3.0;
    if (audioData.byteLength >= 8) {
      const f64 = new Float64Array(audioData, 0, 1)[0];
      if (typeof f64 === "number" && Number.isFinite(f64) && f64 > 0 && f64 < 3600) {
        dur = f64;
      }
    }
    return {
      duration: dur,
      length: Math.round(dur * 44100),
      sampleRate: 44100,
      numberOfChannels: 2
    };
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return {
      duration: sampleRate > 0 ? length / sampleRate : 0,
      length,
      sampleRate,
      numberOfChannels
    };
  }

  createGain(): GainNodeLike {
    const g: GainNodeLike = {
      gain: { value: 1 },
      connect() {},
      disconnect() {}
    };
    return g;
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const node = {
      buffer: null as AudioBufferLike | null,
      loop: false,
      onended: null as (() => void) | null,
      startedAt: null as number | null,
      startOffset: 0,
      startDuration: undefined as number | undefined,
      stopped: false,
      disconnected: false,
      gainNode: null as GainNodeLike | null,
      connect(dest: AudioNodeLike) {
        if ("gain" in dest) {
          node.gainNode = dest as GainNodeLike;
        }
      },
      disconnect() {
        node.disconnected = true;
      },
      start(when = 0, offset = 0, duration?: number) {
        node.startedAt = when;
        node.startOffset = offset;
        node.startDuration = duration;
      },
      stop() {
        if (node.stopped) return;
        node.stopped = true;
        node.onended?.();
      }
    };
    this.createdSources.push(node);
    return node;
  }
}

export function isWebAudioSupported(): boolean {
  if (typeof globalThis === "undefined") return false;
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return typeof g.AudioContext === "function" || typeof g.webkitAudioContext === "function";
}

export function createBrowserAudioContext(): AudioContextLike | null {
  if (!isWebAudioSupported()) return null;
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export type WebAudioFilmTimelineOptions<Name extends string = string> = {
  fps?: number;
  spans: SceneSpan[];
  context?: AudioContextLike | null;
  createContext?: () => AudioContextLike | null;
  fetchBuffer?: (url: string) => Promise<ArrayBuffer>;
  sceneCues?: (sceneIndex: number) => readonly SfxCue<Name>[];
  voiceOn?: boolean;
  musicOn?: boolean;
  sfxOn?: boolean;
  muted?: boolean;
  masterVolume?: number;
  initialTime?: number;
  nowMs?: () => number;
  onCueFired?: (sceneIndex: number, cue: SfxCue<Name>, bufferOffset: number, remainingDuration: number) => void;
  onSceneEnded?: (sceneIndex: number) => void;
  onAutoplayBlocked?: () => void;
  onVoiceDurationDecoded?: (sceneIndex: number, durationSeconds: number) => void;
};

export class WebAudioFilmTimeline<Name extends string = string> implements TimeSource {
  private fps: number;
  private spans: SceneSpan[];
  private ctx: AudioContextLike | null;
  private readonly createContextFn: () => AudioContextLike | null;
  private readonly ownsContext: boolean;
  private readonly fetchBufferFn: (url: string) => Promise<ArrayBuffer>;
  private readonly nowMs: () => number;
  private sceneCuesFn?: (sceneIndex: number) => readonly SfxCue<Name>[];
  private readonly onCueFiredCb?: (sceneIndex: number, cue: SfxCue<Name>, bufferOffset: number, remainingDuration: number) => void;
  private readonly onSceneEndedCb?: (sceneIndex: number) => void;
  private readonly onAutoplayBlockedCb?: () => void;
  private readonly onVoiceDurationDecodedCb?: (sceneIndex: number, durationSeconds: number) => void;

  private voiceEnabled: boolean;
  private musicEnabled: boolean;
  private sfxEnabled: boolean;
  private isMuted: boolean;
  private masterVol: number;

  private readonly decodedByUrl = new Map<string, Promise<AudioBufferLike | null>>();
  private readonly voiceBuffers = new Map<number, AudioBufferLike>();
  private musicBuffer: AudioBufferLike | null = null;
  private readonly sfxBuffers = new Map<string, AudioBufferLike>();

  private wantPlayFlag = false;
  private pausedForBuffer = false;
  private pausedForHidden = false;
  /** True while the clock waits for the active scene's voice take to finish decoding (so its first words are not skipped). */
  private pausedForVoice = false;
  private readonly pendingVoices = new Set<number>();
  private userGestureUnlocked = false;
  private destroyed = false;

  /** Film time in seconds when paused, buffering, or hidden. */
  private pausedFilmTime = 0;
  /** Offset such that `filmTime = ctx.currentTime - offset` while `ctx` is running. */
  private contextOffset = 0;
  /** Fallback wall-clock offset (`nowMs() / 1000 - wallOffset`) when no AudioContext is running or no audio exists. */
  private wallOffset = 0;
  /** Last observed film time on `tick()` (used to detect device sleep jumps and scene crossings). */
  private lastTickFilmTime = 0;
  private activeScene = 0;

  private readonly sfxTracker = new SfxCueTracker<Name>();
  private readonly activeSources = new Set<ScheduledSourceRecord>();
  private visibilityListener: (() => void) | null = null;

  constructor(options: WebAudioFilmTimelineOptions<Name>) {
    this.fps = options.fps && options.fps > 0 ? options.fps : 30;
    this.spans = [...options.spans];
    this.ownsContext = options.context === undefined;
    this.ctx = options.context ?? null;
    this.createContextFn = options.createContext ?? createBrowserAudioContext;
    this.fetchBufferFn =
      options.fetchBuffer ??
      (async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch audio ${url} (${res.status})`);
        return res.arrayBuffer();
      });
    this.nowMs = options.nowMs ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.sceneCuesFn = options.sceneCues;
    this.voiceEnabled = options.voiceOn ?? true;
    this.musicEnabled = options.musicOn ?? true;
    this.sfxEnabled = options.sfxOn ?? true;
    this.isMuted = options.muted ?? false;
    this.masterVol = options.masterVolume ?? 1;
    this.onCueFiredCb = options.onCueFired;
    this.onSceneEndedCb = options.onSceneEnded;
    this.onAutoplayBlockedCb = options.onAutoplayBlocked;
    this.onVoiceDurationDecodedCb = options.onVoiceDurationDecoded;

    const initTime = Math.max(0, options.initialTime ?? 0);
    this.pausedFilmTime = initTime;
    this.lastTickFilmTime = initTime;
    this.activeScene = Math.max(0, sceneAt(this.spans, initTime));
    this.loadSceneCues(this.activeScene, this.sceneLocalTime(this.activeScene, initTime));

    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      this.visibilityListener = () => {
        this.setHidden(document.visibilityState === "hidden");
      };
      document.addEventListener("visibilitychange", this.visibilityListener);
    }
  }

  get audioContext(): AudioContextLike | null {
    return this.ctx;
  }

  get offset(): number {
    return this.contextOffset;
  }

  get buffering(): boolean {
    return this.pausedForBuffer;
  }

  get hidden(): boolean {
    return this.pausedForHidden;
  }

  get wantPlaying(): boolean {
    return this.wantPlayFlag;
  }

  get activeScheduledSources(): ReadonlySet<ScheduledSourceRecord> {
    return this.activeSources;
  }

  private ensureContext(): AudioContextLike | null {
    if (this.destroyed) return null;
    if (!this.ctx) {
      this.ctx = this.createContextFn();
    }
    return this.ctx;
  }

  /**
   * Called inside the user's play click handler to satisfy browser autoplay policy.
   * Creates or resumes the `AudioContext` synchronously on the user gesture.
   */
  unlockFromUserGesture(): Promise<boolean> {
    this.userGestureUnlocked = true;
    const ctx = this.ensureContext();
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      return ctx
        .resume()
        .then(() => ctx.state === "running")
        .catch(() => false);
    }
    return Promise.resolve(ctx.state === "running");
  }

  setSpans(spans: SceneSpan[]): void {
    this.spans = [...spans];
    this.activeScene = Math.max(0, sceneAt(this.spans, this.currentTime()));
  }

  setSceneCuesProvider(fn: (sceneIndex: number) => readonly SfxCue<Name>[]): void {
    this.sceneCuesFn = fn;
    const now = this.currentTime();
    const sc = Math.max(0, sceneAt(this.spans, now));
    this.loadSceneCues(sc, this.sceneLocalTime(sc, now));
  }

  reloadCues(): void {
    const now = this.currentTime();
    const sc = Math.max(0, sceneAt(this.spans, now));
    this.loadSceneCues(sc, this.sceneLocalTime(sc, now));
  }

  setVoiceBuffer(sceneIndex: number, buffer: AudioBufferLike | null): void {
    if (!buffer) {
      this.voiceBuffers.delete(sceneIndex);
      return;
    }
    this.voiceBuffers.set(sceneIndex, buffer);
    this.onVoiceDurationDecodedCb?.(sceneIndex, buffer.duration);
    if (this.pausedForVoice && sceneIndex === this.activeScene) {
      this.resumeFromVoiceHold();
      return;
    }
    if (this.playing() && sceneIndex === this.activeScene && !this.hasActiveSource("voice", sceneIndex)) {
      this.scheduleVoiceForScene(sceneIndex, this.currentTime());
    }
  }

  /** Leaves the voice hold: the clock restarts from where it stopped, with the voice take starting at that same instant. */
  private resumeFromVoiceHold(): void {
    if (!this.pausedForVoice) return;
    this.pausedForVoice = false;
    if (this.wantPlayFlag && !this.pausedForBuffer && !this.pausedForHidden) {
      this.anchorClockAt(this.pausedFilmTime);
      this.rescheduleAllFrom(this.pausedFilmTime);
    }
  }

  /**
   * The active scene's voice take is still downloading or decoding. Starting the scene without it would run the clock
   * ahead of the voice and the take would join mid-sentence, so hold the clock at this instant until it arrives.
   */
  private holdForVoice(filmTime: number): void {
    this.pausedFilmTime = filmTime;
    this.lastTickFilmTime = filmTime;
    this.pausedForVoice = true;
    this.stopAllSources();
  }

  setMusicBuffer(buffer: AudioBufferLike | null): void {
    this.musicBuffer = buffer;
    if (this.playing() && buffer && !this.hasActiveSource("music", -1)) {
      this.scheduleMusic(this.currentTime());
    }
  }

  setSfxBuffer(name: string, buffer: AudioBufferLike | null): void {
    if (!buffer) {
      this.sfxBuffers.delete(name);
      return;
    }
    this.sfxBuffers.set(name, buffer);
  }

  getVoiceBuffer(sceneIndex: number): AudioBufferLike | undefined {
    return this.voiceBuffers.get(sceneIndex);
  }

  getMusicBuffer(): AudioBufferLike | null {
    return this.musicBuffer;
  }

  getSfxBuffer(name: string): AudioBufferLike | undefined {
    return this.sfxBuffers.get(name);
  }

  private async decodeUrlOnce(url: string): Promise<AudioBufferLike | null> {
    if (!url || this.destroyed) return null;
    const existing = this.decodedByUrl.get(url);
    if (existing) return existing;
    const task = (async () => {
      try {
        const ctx = this.ensureContext();
        if (!ctx) return null;
        const raw = await this.fetchBufferFn(url);
        if (this.destroyed) return null;
        return await ctx.decodeAudioData(raw);
      } catch {
        return null;
      }
    })();
    this.decodedByUrl.set(url, task);
    return task;
  }

  async loadVoice(sceneIndex: number, url: string | null | undefined): Promise<AudioBufferLike | null> {
    if (!url) {
      this.voiceBuffers.delete(sceneIndex);
      return null;
    }
    this.pendingVoices.add(sceneIndex);
    let buf: AudioBufferLike | null = null;
    try {
      buf = await this.decodeUrlOnce(url);
    } finally {
      this.pendingVoices.delete(sceneIndex);
    }
    if (buf && !this.destroyed) {
      this.setVoiceBuffer(sceneIndex, buf);
    } else if (this.pausedForVoice && sceneIndex === this.activeScene) {
      // The take failed to load: play the scene without it rather than hold forever.
      this.resumeFromVoiceHold();
    }
    return buf;
  }

  async loadMusic(url: string | null | undefined): Promise<AudioBufferLike | null> {
    if (!url) {
      this.musicBuffer = null;
      return null;
    }
    const buf = await this.decodeUrlOnce(url);
    if (buf && !this.destroyed) {
      this.setMusicBuffer(buf);
    }
    return buf;
  }

  async loadSfx(name: string, url: string | null | undefined): Promise<AudioBufferLike | null> {
    if (!url) return null;
    const buf = await this.decodeUrlOnce(url);
    if (buf && !this.destroyed) {
      this.setSfxBuffer(name, buf);
    }
    return buf;
  }

  hasDecodedAudio(): boolean {
    return this.voiceBuffers.size > 0 || this.musicBuffer !== null || this.sfxBuffers.size > 0;
  }

  private isAudioMasterActive(): boolean {
    return Boolean(this.ctx && this.ctx.state === "running");
  }

  /**
   * Master film time in seconds:
   * - While playing and `AudioContext` is running: `ctx.currentTime - contextOffset`.
   * - While playing with no running `AudioContext` (silent film): `nowMs() / 1000 - wallOffset`.
   * - While paused, buffering, or hidden: `pausedFilmTime`.
   */
  currentTime(): number {
    if (!this.playing()) {
      return this.pausedFilmTime;
    }
    if (this.isAudioMasterActive() && this.ctx) {
      return Math.max(0, this.ctx.currentTime - this.contextOffset);
    }
    return Math.max(0, this.nowMs() / 1000 - this.wallOffset);
  }

  playing(): boolean {
    return this.wantPlayFlag && !this.pausedForBuffer && !this.pausedForHidden && !this.pausedForVoice && !this.destroyed;
  }

  sceneLocalTime(sceneIdx = Math.max(0, sceneAt(this.spans, this.currentTime())), globalTime = this.currentTime()): number {
    const span = this.spans[sceneIdx];
    if (!span) return Math.max(0, globalTime);
    return Math.max(0, globalTime - span.start);
  }

  private loadSceneCues(sceneIdx: number, localOffset: number): void {
    const cues = this.sceneCuesFn?.(sceneIdx) ?? [];
    this.sfxTracker.setCues(cues, localOffset);
  }

  private anchorClockAt(filmSeconds: number): void {
    const clamped = Math.max(0, Number.isFinite(filmSeconds) ? filmSeconds : 0);
    this.pausedFilmTime = clamped;
    this.lastTickFilmTime = clamped;
    if (this.ctx) {
      this.contextOffset = this.ctx.currentTime - clamped;
    }
    this.wallOffset = this.nowMs() / 1000 - clamped;
  }

  /**
   * Starts playback from the current film time:
   * - Resumes the `AudioContext` if needed.
   * - If the `AudioContext` remains `suspended` because there was no user gesture, reverts to paused and notifies
   *   `onAutoplayBlocked` so the UI shows the normal play button instead of playing silently.
   */
  async play(options?: { fromUserGesture?: boolean }): Promise<boolean> {
    if (this.destroyed) return false;
    if (options?.fromUserGesture) {
      this.userGestureUnlocked = true;
    }
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") {
      if (!this.userGestureUnlocked && this.hasDecodedAudio()) {
        this.wantPlayFlag = false;
        this.onAutoplayBlockedCb?.();
        return false;
      }
      try {
        await ctx.resume();
      } catch {}
      if (ctx.state === "suspended" && this.hasDecodedAudio()) {
        this.wantPlayFlag = false;
        this.onAutoplayBlockedCb?.();
        return false;
      }
    }

    this.wantPlayFlag = true;
    if (!this.pausedForBuffer && !this.pausedForHidden) {
      this.pausedForVoice = false;
      this.anchorClockAt(this.pausedFilmTime);
      this.rescheduleAllFrom(this.pausedFilmTime);
    }
    return true;
  }

  pause(): void {
    if (this.playing()) {
      this.pausedFilmTime = this.currentTime();
    }
    this.wantPlayFlag = false;
    this.stopAllSources();
    if (this.ctx && this.ctx.state === "running") {
      void this.ctx.suspend().catch(() => {});
    }
  }

  /**
   * Enters or exits `buffering`:
   * - `setBuffering(true)`: freezes `pausedFilmTime`, stops scheduled source nodes, and calls `ctx.suspend()` synchronously
   *   so voice, music, and sound effects stop at the exact same instant (within 0 frames).
   * - `setBuffering(false)`: re-anchors `contextOffset = ctx.currentTime - pausedFilmTime`, calls `ctx.resume()`, and
   *   reschedules sources from `pausedFilmTime` with zero drift across 20+ buffering pauses.
   */
  setBuffering(buffering: boolean): void {
    const next = Boolean(buffering);
    if (this.pausedForBuffer === next) return;
    if (next) {
      if (this.wantPlayFlag && !this.pausedForHidden) {
        this.pausedFilmTime = this.currentTime();
      }
      this.pausedForBuffer = true;
      this.stopAllSources();
      if (this.ctx && this.ctx.state === "running") {
        void this.ctx.suspend().catch(() => {});
      }
    } else {
      this.pausedForBuffer = false;
      if (this.wantPlayFlag && !this.pausedForHidden) {
        if (this.ctx && this.ctx.state === "suspended") {
          void this.ctx.resume().catch(() => {});
        }
        this.anchorClockAt(this.pausedFilmTime);
        this.rescheduleAllFrom(this.pausedFilmTime);
      }
    }
  }

  /**
   * Handles tab visibility changes (`visibilitychange`):
   * - `hidden = true`: pauses both clock and audio (`ctx.suspend()`).
   * - `hidden = false`: resumes both from `pausedFilmTime` with zero drift.
   */
  setHidden(hidden: boolean): void {
    const next = Boolean(hidden);
    if (this.pausedForHidden === next) return;
    if (next) {
      if (this.wantPlayFlag && !this.pausedForBuffer) {
        this.pausedFilmTime = this.currentTime();
      }
      this.pausedForHidden = true;
      this.stopAllSources();
      if (this.ctx && this.ctx.state === "running") {
        void this.ctx.suspend().catch(() => {});
      }
    } else {
      this.pausedForHidden = false;
      if (this.wantPlayFlag && !this.pausedForBuffer) {
        if (this.ctx && this.ctx.state === "suspended") {
          void this.ctx.resume().catch(() => {});
        }
        this.anchorClockAt(this.pausedFilmTime);
        this.rescheduleAllFrom(this.pausedFilmTime);
      }
    }
  }

  /**
   * Seeks to `globalSeconds`:
   * - Stops all active `AudioBufferSourceNode`s.
   * - Updates `SfxCueTracker` without firing jumped-over cues (and re-arms cues on backward seek).
   * - Reschedules voice, music, and any active mid-effect SFX from the new position.
   */
  seek(globalSeconds: number): void {
    const maxEnd = this.spans.length > 0 ? this.spans[this.spans.length - 1]!.end : Number.POSITIVE_INFINITY;
    const clamped = Math.max(0, Math.min(maxEnd, Number.isFinite(globalSeconds) ? globalSeconds : 0));
    this.stopAllSources();
    this.pausedForVoice = false;
    this.anchorClockAt(clamped);
    const nextScene = Math.max(0, sceneAt(this.spans, clamped));
    this.activeScene = nextScene;
    const localSec = this.sceneLocalTime(nextScene, clamped);
    this.loadSceneCues(nextScene, localSec);

    if (this.playing()) {
      this.rescheduleAllFrom(clamped);
    }
  }

  /** Loops back to the beginning of the film (`0` s), stopping active sources, re-arming cues, and rescheduling. */
  loop(): void {
    this.seek(0);
  }

  /**
   * Evaluates one playback tick:
   * - Reads film time from `AudioContext.currentTime - offset` (or wall clock fallback).
   * - Detects device sleep / wake jumps (`dt > MAX_SLEEP_JUMP_SECONDS`) and clamps the advance to `1 / fps`,
   *   re-anchoring `offset` and rescheduling audio so no burst of cues fires and no drift occurs.
   * - Handles scene boundary transitions.
   * - Checks `SfxCueTracker` crossings and schedules crossed SFX `AudioBufferSourceNode`s against `AudioContext.currentTime`.
   */
  tick(): { filmTime: number; sceneIndex: number; localTime: number; crossedCues: SfxCue<Name>[] } {
    if (!this.playing()) {
      const sc = Math.max(0, sceneAt(this.spans, this.pausedFilmTime));
      return {
        filmTime: this.pausedFilmTime,
        sceneIndex: sc,
        localTime: this.sceneLocalTime(sc, this.pausedFilmTime),
        crossedCues: []
      };
    }

    let rawFilmTime = this.currentTime();
    const dt = rawFilmTime - this.lastTickFilmTime;

    // Device sleep / resume protection: if a single tick jumps forward by > MAX_SLEEP_JUMP_SECONDS (250 ms),
    // clamp the advance to 1 frame (1 / fps), re-anchor the AudioContext offset, and reschedule sources.
    if (dt > MAX_SLEEP_JUMP_SECONDS) {
      rawFilmTime = this.lastTickFilmTime + 1 / this.fps;
      this.anchorClockAt(rawFilmTime);
      this.stopAllSources();
      this.rescheduleAllFrom(rawFilmTime);
    }

    const maxEnd = this.spans.length > 0 ? this.spans[this.spans.length - 1]!.end : Number.POSITIVE_INFINITY;
    const filmTime = Math.max(0, Math.min(maxEnd, rawFilmTime));
    this.pausedFilmTime = filmTime;
    this.lastTickFilmTime = filmTime;

    const nextScene = Math.max(0, sceneAt(this.spans, filmTime));
    if (nextScene !== this.activeScene) {
      this.stopSceneSources(this.activeScene);
      this.activeScene = nextScene;
      const localStart = this.sceneLocalTime(nextScene, filmTime);
      this.loadSceneCues(nextScene, localStart);
      if (this.voiceEnabled && !this.voiceBuffers.has(nextScene) && this.pendingVoices.has(nextScene)) {
        this.holdForVoice(filmTime);
        return { filmTime, sceneIndex: nextScene, localTime: localStart, crossedCues: [] };
      }
      this.scheduleVoiceForScene(nextScene, filmTime);
      this.scheduleActiveMidCues(nextScene, localStart, filmTime);
    }

    const localTime = this.sceneLocalTime(this.activeScene, filmTime);
    let crossedCues: SfxCue<Name>[] = [];
    if (this.sfxEnabled) {
      crossedCues = this.sfxTracker.tick(localTime, {
        playing: true,
        buffering: false
      });
      for (const cue of crossedCues) {
        this.scheduleSfxCue(this.activeScene, cue, cue.mediaStart ?? 0, filmTime);
      }
    }

    return {
      filmTime,
      sceneIndex: this.activeScene,
      localTime,
      crossedCues
    };
  }

  setVoiceOn(on: boolean): void {
    this.voiceEnabled = on;
    this.updateGains();
    if (on && this.playing() && !this.hasActiveSource("voice", this.activeScene)) {
      this.scheduleVoiceForScene(this.activeScene, this.currentTime());
    }
  }

  setMusicOn(on: boolean): void {
    this.musicEnabled = on;
    this.updateGains();
    if (on && this.playing() && !this.hasActiveSource("music", -1)) {
      this.scheduleMusic(this.currentTime());
    }
  }

  setSfxOn(on: boolean): void {
    this.sfxEnabled = on;
    if (!on) {
      for (const rec of [...this.activeSources]) {
        if (rec.kind === "sfx") {
          this.stopRecord(rec);
        }
      }
    } else {
      this.reloadCues();
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.updateGains();
  }

  setMasterVolume(volume: number): void {
    this.masterVol = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    this.updateGains();
  }

  private effectiveGain(kind: "voice" | "music" | "sfx", cueVolume = 1): number {
    if (this.isMuted) return 0;
    if (kind === "voice") return this.voiceEnabled ? this.masterVol : 0;
    if (kind === "music") return this.musicEnabled ? 0.22 * this.masterVol : 0;
    return this.sfxEnabled ? Math.min(1, Math.max(0, cueVolume * this.masterVol)) : 0;
  }

  private updateGains(): void {
    for (const rec of this.activeSources) {
      if (rec.kind === "voice") {
        rec.gainNode.gain.value = this.effectiveGain("voice");
      } else if (rec.kind === "music") {
        rec.gainNode.gain.value = this.effectiveGain("music");
      } else if (rec.kind === "sfx") {
        const cue = (this.sceneCuesFn?.(rec.sceneIndex) ?? []).find((c) => c.name === rec.cueName);
        rec.gainNode.gain.value = this.effectiveGain("sfx", cue?.volume ?? 1);
      }
    }
  }

  private hasActiveSource(kind: "voice" | "music" | "sfx", sceneIndex: number): boolean {
    for (const rec of this.activeSources) {
      if (!rec.stopped && rec.kind === kind && (sceneIndex < 0 || rec.sceneIndex === sceneIndex)) {
        return true;
      }
    }
    return false;
  }

  private rescheduleAllFrom(filmTime: number): void {
    this.stopAllSources();
    if (!this.playing()) return;
    const sc = Math.max(0, sceneAt(this.spans, filmTime));
    this.activeScene = sc;
    if (this.voiceEnabled && !this.voiceBuffers.has(sc) && this.pendingVoices.has(sc)) {
      this.holdForVoice(filmTime);
      return;
    }
    const localSec = this.sceneLocalTime(sc, filmTime);
    this.scheduleVoiceForScene(sc, filmTime);
    this.scheduleMusic(filmTime);
    this.scheduleActiveMidCues(sc, localSec, filmTime);
  }

  private scheduleVoiceForScene(sceneIndex: number, filmTime: number): void {
    const ctx = this.ensureContext();
    const buf = this.voiceBuffers.get(sceneIndex);
    if (!ctx || !buf) return;
    const localSec = this.sceneLocalTime(sceneIndex, filmTime);
    if (localSec >= buf.duration - 0.02) return;

    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    gainNode.gain.value = this.effectiveGain("voice");
    source.buffer = buf;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const rem = Math.max(0, buf.duration - localSec);
    const rec: ScheduledSourceRecord = {
      kind: "voice",
      sceneIndex,
      source,
      gainNode,
      startedAtContextTime: ctx.currentTime,
      bufferOffset: localSec,
      duration: rem,
      filmTimeAtStart: filmTime,
      stopped: false
    };
    source.onended = () => {
      rec.stopped = true;
      this.activeSources.delete(rec);
      try {
        source.disconnect();
        gainNode.disconnect();
      } catch {}
    };
    this.activeSources.add(rec);
    try {
      source.start(ctx.currentTime, localSec);
    } catch {
      this.stopRecord(rec);
    }
  }

  private scheduleMusic(filmTime: number): void {
    const ctx = this.ensureContext();
    const buf = this.musicBuffer;
    if (!ctx || !buf || !(buf.duration > 0)) return;
    const offset = ((filmTime % buf.duration) + buf.duration) % buf.duration;

    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    gainNode.gain.value = this.effectiveGain("music");
    source.buffer = buf;
    source.loop = true;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const rec: ScheduledSourceRecord = {
      kind: "music",
      sceneIndex: -1,
      source,
      gainNode,
      startedAtContextTime: ctx.currentTime,
      bufferOffset: offset,
      duration: buf.duration,
      filmTimeAtStart: filmTime,
      stopped: false
    };
    source.onended = () => {
      rec.stopped = true;
      this.activeSources.delete(rec);
      try {
        source.disconnect();
        gainNode.disconnect();
      } catch {}
    };
    this.activeSources.add(rec);
    try {
      source.start(ctx.currentTime, offset);
    } catch {
      this.stopRecord(rec);
    }
  }

  /**
   * When seeking into (or resuming inside) the middle of an active sound effect cue,
   * schedules the remaining tail of that SFX buffer (`from mediaStart + (localSec - cue.offset)`).
   */
  private scheduleActiveMidCues(sceneIndex: number, localSec: number, filmTime: number): void {
    if (!this.sfxEnabled) return;
    const cues = this.sceneCuesFn?.(sceneIndex) ?? [];
    for (const cue of cues) {
      const buf = this.sfxBuffers.get(cue.name);
      if (!buf) continue;
      const mediaStart = cue.mediaStart ?? 0;
      const playDuration = Math.max(0, buf.duration - mediaStart);
      if (playDuration <= 0) continue;
      if (localSec > cue.offset + 1e-6 && localSec < cue.offset + playDuration - 1e-4) {
        const elapsedInCue = localSec - cue.offset;
        const bufferOffset = mediaStart + elapsedInCue;
        this.scheduleSfxCue(sceneIndex, cue, bufferOffset, filmTime);
      }
    }
  }

  private scheduleSfxCue(sceneIndex: number, cue: SfxCue<Name>, bufferOffset: number, filmTime: number): void {
    const ctx = this.ensureContext();
    const buf = this.sfxBuffers.get(cue.name);
    const rem = buf ? Math.max(0, buf.duration - bufferOffset) : 0;
    this.onCueFiredCb?.(sceneIndex, cue, bufferOffset, rem);
    if (!ctx || !buf || rem <= 0) return;

    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    gainNode.gain.value = this.effectiveGain("sfx", cue.volume);
    source.buffer = buf;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const rec: ScheduledSourceRecord = {
      kind: "sfx",
      sceneIndex,
      cueName: cue.name,
      source,
      gainNode,
      startedAtContextTime: ctx.currentTime,
      bufferOffset,
      duration: rem,
      filmTimeAtStart: filmTime,
      stopped: false
    };
    source.onended = () => {
      rec.stopped = true;
      this.activeSources.delete(rec);
      try {
        source.disconnect();
        gainNode.disconnect();
      } catch {}
    };
    this.activeSources.add(rec);
    try {
      source.start(ctx.currentTime, bufferOffset);
    } catch {
      this.stopRecord(rec);
    }
  }

  private stopRecord(rec: ScheduledSourceRecord): void {
    if (rec.stopped) return;
    rec.stopped = true;
    this.activeSources.delete(rec);
    try {
      rec.source.onended = null;
      rec.source.stop();
    } catch {}
    try {
      rec.source.disconnect();
      rec.gainNode.disconnect();
    } catch {}
  }

  private stopSceneSources(sceneIndex: number): void {
    for (const rec of [...this.activeSources]) {
      if (rec.sceneIndex === sceneIndex && rec.kind !== "music") {
        this.stopRecord(rec);
      }
    }
  }

  stopAllSources(): void {
    for (const rec of [...this.activeSources]) {
      this.stopRecord(rec);
    }
    this.activeSources.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.wantPlayFlag = false;
    this.stopAllSources();
    if (this.visibilityListener && typeof document !== "undefined") {
      try {
        document.removeEventListener("visibilitychange", this.visibilityListener);
      } catch {}
      this.visibilityListener = null;
    }
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close().catch(() => {});
    }
    this.voiceBuffers.clear();
    this.sfxBuffers.clear();
    this.decodedByUrl.clear();
    this.musicBuffer = null;
  }
}
