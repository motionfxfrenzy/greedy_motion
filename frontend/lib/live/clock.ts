import type { SceneSpan } from "./types.ts";
import type { WebAudioFilmTimeline } from "./film-audio.ts";

/** Frame shown at time `t` (seconds): floor(t * fps), clamped to the film. */
export function frameAt(t: number, fps: number, frames: number): number {
  if (!(fps > 0) || frames <= 0) return 0;
  const f = Math.floor((Number.isFinite(t) ? t : 0) * fps + 1e-9);
  return Math.min(frames - 1, Math.max(0, f));
}

/** Index of the scene playing at `t`: the last scene whose start is not after `t`; clamped. */
export function sceneAt(spans: SceneSpan[], t: number): number {
  if (!spans.length) return -1;
  let found = 0;
  for (let i = 0; i < spans.length; i++) if (spans[i]!.start <= t + 1e-9) found = i;
  return found;
}

/**
 * Which frame to put on screen. If the target frame is not ready, the previous frame is held and `stalled` tells the player
 * to enter `buffering` and pause the clock. Never shows a frame other than the one due (or the held previous frame).
 */
export function chooseFrame(args: {
  target: number;
  lastShown: number | null;
  isReady: (frame: number) => boolean;
}): { frame: number; stalled: boolean } {
  const { target, lastShown, isReady } = args;
  if (isReady(target)) return { frame: target, stalled: false };
  if (lastShown === null) return { frame: target, stalled: true };
  return { frame: lastShown, stalled: true };
}

/** Seconds of film that are cached ahead of `frame` (for the buffer bar and the "buffering" decision). */
export function bufferedAhead(ranges: { from: number; to: number }[], frame: number, fps: number): number {
  for (const r of ranges) if (frame >= r.from && frame <= r.to) return (r.to - frame + 1) / fps;
  return 0;
}

/** Source of time: the film clock in the studio, or a fake in tests. */
export interface TimeSource {
  currentTime(): number;
  playing(): boolean;
}

export class PlaybackClock {
  private source: TimeSource;
  private fps: number;
  private frames: number;
  constructor(source: TimeSource, fps: number, frames: number) {
    this.source = source;
    this.fps = fps;
    this.frames = frames;
  }
  now() {
    return this.source.currentTime();
  }
  frame() {
    return frameAt(this.source.currentTime(), this.fps, this.frames);
  }
  playing() {
    return this.source.playing();
  }
}

export type SfxCue<Name extends string = string> = {
  name: Name;
  offset: number;
  volume: number;
  mediaStart?: number;
};

/**
 * Clock-driven sound-effect cue crossing detector (phase 3g, plan change C):
 * - Replaces `setTimeout` scheduling with cue crossings checked on each clock tick.
 * - A cue fires once when the clock crosses its `offset` while `playing && !buffering`.
 * - Seeking (`seek(offset)`) moves the cursor without firing any cues jumped over, and re-arms cues after the new position.
 * - Never fires while paused or `buffering`.
 */
export class SfxCueTracker<Name extends string = string> {
  private cues: SfxCue<Name>[] = [];
  private fired = new Set<number>();
  private cursor: number | null = null;

  setCues(cues: readonly SfxCue<Name>[], initialOffset = 0): void {
    this.cues = [...cues].sort((a, b) => a.offset - b.offset);
    this.seek(initialOffset);
  }

  getCues(): readonly SfxCue<Name>[] {
    return this.cues;
  }

  /**
   * Moves the clock cursor to `offset` without firing any cues.
   * Any cue strictly before `offset` is marked as already passed so it will not fire when playback continues forward;
   * cues at or after `offset` are armed to fire when crossed.
   */
  seek(offset: number): void {
    const clamped = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    this.cursor = clamped;
    this.fired.clear();
    for (let i = 0; i < this.cues.length; i++) {
      if (this.cues[i]!.offset < clamped - 1e-9) {
        this.fired.add(i);
      }
    }
  }

  /**
   * Checks whether the clock crossed any armed cues between the previous tick cursor and `offset`.
   * Returns the crossed cues in ascending `offset` order.
   */
  tick(offset: number, state: { playing: boolean; buffering?: boolean }): SfxCue<Name>[] {
    const now = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    if (!state.playing || state.buffering) {
      return [];
    }
    if (this.cursor === null) {
      this.cursor = now;
    }
    // If time moved backwards without an explicit seek (e.g. scene loop), re-arm from `now`.
    if (now < this.cursor - 1e-6) {
      this.seek(now);
    }

    const from = this.cursor!;
    const crossed: SfxCue<Name>[] = [];
    for (let i = 0; i < this.cues.length; i++) {
      if (this.fired.has(i)) continue;
      const cue = this.cues[i]!;
      if (cue.offset >= from - 1e-9 && cue.offset <= now + 1e-9) {
        this.fired.add(i);
        crossed.push(cue);
      }
    }
    this.cursor = now;
    return crossed;
  }
}

export interface AudioElementLike {
  currentTime: number;
  paused: boolean;
  ended?: boolean;
  duration?: number;
  muted?: boolean;
  volume?: number;
  readyState?: number;
  play(): Promise<void> | void;
  pause(): void;
}

export type FilmAudioBinding<Name extends string = string> = {
  /** Single Web Audio timeline (`AudioContext` master time). When present, drives the clock and all audio. */
  timeline?: WebAudioFilmTimeline<Name> | null;
  voices?: (AudioElementLike | null | undefined)[];
  music?: AudioElementLike | null;
  sfxAudios?: Record<string, AudioElementLike | null | undefined>;
  sceneCues?: (sceneIndex: number) => readonly SfxCue<Name>[];
  voiceOn?: () => boolean;
  musicOn?: () => boolean;
  sfxOn?: () => boolean;
  muted?: () => boolean;
  masterVolume?: () => number;
  onCueFired?: (sceneIndex: number, cue: SfxCue<Name>) => void;
};

/**
 * Single film clock built on `PlaybackClock` that drives both the picture and all audio (voiceover, music, and SFX)
 * in lockstep (phase 3g, plan change C).
 * When `audio.timeline` (`WebAudioFilmTimeline`) is attached, `now()` is derived from `AudioContext.currentTime - offset`.
 */
export class FilmClock<Name extends string = string> extends PlaybackClock {
  private timeSec = 0;
  private wantPlayFlag = false;
  private pausedForBuffer = false;
  private spans: SceneSpan[];
  private activeScene = 0;
  private readonly sfxTracker = new SfxCueTracker<Name>();
  private readonly sfxSlot: Record<string, number> = {};
  private audioBinding: FilmAudioBinding<Name> | null = null;

  constructor(options: {
    fps?: number;
    frames: number;
    spans: SceneSpan[];
    initialTime?: number;
    initialPlaying?: boolean;
    audio?: FilmAudioBinding<Name>;
  }) {
    let selfRef: FilmClock<Name> | null = null;
    super(
      {
        currentTime: () => {
          if (!selfRef) return 0;
          const tl = selfRef.audioBinding?.timeline;
          if (tl) return tl.currentTime();
          return selfRef.timeSec;
        },
        playing: () => {
          if (!selfRef) return false;
          const tl = selfRef.audioBinding?.timeline;
          if (tl) return tl.playing();
          return Boolean(selfRef.wantPlayFlag && !selfRef.pausedForBuffer);
        }
      },
      options.fps ?? 30,
      options.frames
    );
    selfRef = this;
    this.spans = [...options.spans];
    this.timeSec = Math.max(0, options.initialTime ?? 0);
    this.wantPlayFlag = Boolean(options.initialPlaying);
    this.audioBinding = options.audio ?? null;
    this.activeScene = Math.max(0, sceneAt(this.spans, this.timeSec));
    this.loadSceneCues(this.activeScene, this.sceneLocalTime(this.activeScene));
  }

  setSpans(spans: SceneSpan[]): void {
    this.spans = [...spans];
    this.audioBinding?.timeline?.setSpans(spans);
  }

  setAudioBinding(binding: FilmAudioBinding<Name> | null): void {
    this.audioBinding = binding;
    this.loadSceneCues(this.activeScene, this.sceneLocalTime(this.activeScene));
  }

  private loadSceneCues(sceneIdx: number, localOffset: number): void {
    const cues = this.audioBinding?.sceneCues?.(sceneIdx) ?? [];
    this.sfxTracker.setCues(cues, localOffset);
  }

  reloadCues(): void {
    this.audioBinding?.timeline?.reloadCues();
    this.loadSceneCues(this.activeScene, this.sceneLocalTime(this.activeScene));
  }

  sceneLocalTime(sceneIdx = Math.max(0, sceneAt(this.spans, this.now()))): number {
    const tl = this.audioBinding?.timeline;
    if (tl) return tl.sceneLocalTime(sceneIdx);
    const span = this.spans[sceneIdx];
    if (!span) return this.timeSec;
    return Math.max(0, this.timeSec - span.start);
  }

  get wantPlaying(): boolean {
    const tl = this.audioBinding?.timeline;
    if (tl) return tl.wantPlaying;
    return this.wantPlayFlag;
  }

  get buffering(): boolean {
    const tl = this.audioBinding?.timeline;
    if (tl) return tl.buffering;
    return this.pausedForBuffer;
  }

  /**
   * Enters or exits `buffering` (or `drawing` wait):
   * - On `buffering = true`: suspends the `AudioContext` (or pauses fallback `<audio>` elements) at the same instant.
   * - On `buffering = false`: resumes the `AudioContext` and reschedules sources from the clock.
   */
  setBuffering(buffering: boolean): void {
    const tl = this.audioBinding?.timeline;
    if (tl) {
      tl.setBuffering(buffering);
    }
    const next = Boolean(buffering);
    if (this.pausedForBuffer === next) {
      if (next) this.pauseAllAudio();
      return;
    }
    this.pausedForBuffer = next;
    if (next) {
      this.pauseAllAudio();
    } else if (this.wantPlayFlag) {
      this.syncAndPlayAudio();
    }
  }

  play(): void {
    this.wantPlayFlag = true;
    const tl = this.audioBinding?.timeline;
    if (tl) {
      void tl.play({ fromUserGesture: true });
    }
    if (!this.pausedForBuffer) {
      this.syncAndPlayAudio();
    }
  }

  pause(): void {
    this.wantPlayFlag = false;
    this.audioBinding?.timeline?.pause();
    this.pauseAllAudio();
  }

  seek(globalSeconds: number): void {
    const maxEnd = this.spans.length > 0 ? this.spans[this.spans.length - 1]!.end : Number.POSITIVE_INFINITY;
    const clamped = Math.max(0, Math.min(maxEnd, Number.isFinite(globalSeconds) ? globalSeconds : 0));
    this.timeSec = clamped;
    this.audioBinding?.timeline?.seek(clamped);
    const nextScene = Math.max(0, sceneAt(this.spans, clamped));
    const local = Math.max(0, clamped - (this.spans[nextScene]?.start ?? 0));
    this.activeScene = nextScene;
    this.loadSceneCues(nextScene, local);

    const b = this.audioBinding;
    if (!b) return;
    if (b.voices) {
      b.voices.forEach((v, idx) => {
        if (!v) return;
        if (idx !== nextScene && !v.paused) {
          try {
            v.pause();
          } catch {}
        }
      });
      const vo = b.voices[nextScene];
      if (vo && (vo.readyState === undefined || vo.readyState >= 1)) {
        try {
          vo.currentTime =
            typeof vo.duration === "number" && Number.isFinite(vo.duration)
              ? Math.min(Math.max(0, vo.duration - 0.05), local)
              : local;
        } catch {}
      }
    }
    if (b.music) {
      try {
        b.music.currentTime = clamped;
      } catch {}
    }
    if (b.sfxAudios) {
      Object.values(b.sfxAudios).forEach((el) => {
        try {
          el?.pause();
        } catch {}
      });
    }
  }

  /**
   * Advances (or sets) the clock time on a playback tick when not buffering, checks SFX cue crossings,
   * and keeps audio in step with the clock.
   */
  tickTo(globalSeconds?: number): SfxCue<Name>[] {
    const tl = this.audioBinding?.timeline;
    if (tl) {
      const res = tl.tick();
      this.timeSec = res.filmTime;
      this.activeScene = res.sceneIndex;
      return res.crossedCues;
    }
    if (!this.wantPlayFlag || this.pausedForBuffer) {
      return [];
    }
    const clamped = Math.max(0, Number.isFinite(globalSeconds) ? (globalSeconds as number) : this.timeSec);
    const nextScene = Math.max(0, sceneAt(this.spans, clamped));
    if (nextScene !== this.activeScene) {
      const prevVo = this.audioBinding?.voices?.[this.activeScene];
      if (prevVo && !prevVo.paused) {
        try {
          prevVo.pause();
        } catch {}
      }
      this.activeScene = nextScene;
      const localStart = Math.max(0, clamped - (this.spans[nextScene]?.start ?? 0));
      this.loadSceneCues(nextScene, localStart);
      this.timeSec = clamped;
      this.syncAndPlayAudio();
    } else {
      this.timeSec = clamped;
    }

    const local = this.sceneLocalTime(this.activeScene);
    const b = this.audioBinding;
    if (b) {
      const vo = b.voices?.[this.activeScene];
      if (vo) {
        const voiceEnabled = (b.voiceOn ? b.voiceOn() : true) && !(b.muted ? b.muted() : false);
        vo.muted = !voiceEnabled;
        if (b.masterVolume) vo.volume = b.masterVolume();
        if (vo.paused && !(vo.ended ?? false)) {
          try {
            vo.currentTime =
              typeof vo.duration === "number" && Number.isFinite(vo.duration)
                ? Math.min(Math.max(0, vo.duration - 0.05), local)
                : local;
            void vo.play()?.catch?.(() => undefined);
          } catch {}
        } else if (!vo.paused && Math.abs(vo.currentTime - local) > 1 / 30) {
          try {
            vo.currentTime = local;
          } catch {}
        }
      }
      if (b.music) {
        const musicEnabled = (b.musicOn ? b.musicOn() : true) && !(b.muted ? b.muted() : false);
        b.music.muted = !musicEnabled;
        if (b.masterVolume) b.music.volume = 0.22 * b.masterVolume();
        if (b.music.paused) {
          try {
            b.music.currentTime = this.timeSec;
            void b.music.play()?.catch?.(() => undefined);
          } catch {}
        }
      }
    }

    const sfxEnabled = b?.sfxOn ? b.sfxOn() : true;
    if (!sfxEnabled) return [];

    const crossed = this.sfxTracker.tick(local, {
      playing: this.wantPlayFlag,
      buffering: this.pausedForBuffer
    });
    for (const cue of crossed) {
      this.fireCueAudio(this.activeScene, cue);
    }
    return crossed;
  }

  private fireCueAudio(sceneIndex: number, cue: SfxCue<Name>): void {
    const b = this.audioBinding;
    b?.onCueFired?.(sceneIndex, cue);
    if (!b?.sfxAudios) return;
    if (b.muted?.()) return;
    const slot = (this.sfxSlot[cue.name] ?? 0) % 2;
    this.sfxSlot[cue.name] = slot + 1;
    const el = b.sfxAudios[`${cue.name}:${slot}`] ?? b.sfxAudios[`${cue.name}:0`] ?? b.sfxAudios[cue.name];
    if (!el) return;
    const master = b.masterVolume ? b.masterVolume() : 1;
    try {
      el.volume = Math.min(1, Math.max(0, cue.volume * master));
      el.currentTime = cue.mediaStart ?? 0;
      void el.play()?.catch?.(() => undefined);
    } catch {}
  }

  syncAndPlayAudio(): void {
    const b = this.audioBinding;
    if (!b || !this.wantPlayFlag || this.pausedForBuffer) return;
    const sceneIdx = Math.max(0, sceneAt(this.spans, this.timeSec));
    this.activeScene = sceneIdx;
    const local = this.sceneLocalTime(sceneIdx);
    const muted = b.muted ? b.muted() : false;
    const master = b.masterVolume ? b.masterVolume() : 1;

    if (b.voices) {
      b.voices.forEach((v, idx) => {
        if (idx !== sceneIdx && v && !v.paused) {
          try {
            v.pause();
          } catch {}
        }
      });
      const vo = b.voices[sceneIdx];
      if (vo) {
        const voiceEnabled = (b.voiceOn ? b.voiceOn() : true) && !muted;
        vo.muted = !voiceEnabled;
        vo.volume = master;
        try {
          if (vo.readyState === undefined || vo.readyState >= 1) {
            vo.currentTime =
              typeof vo.duration === "number" && Number.isFinite(vo.duration)
                ? Math.min(Math.max(0, vo.duration - 0.05), local)
                : local;
          }
          void vo.play()?.catch?.(() => undefined);
        } catch {}
      }
    }

    if (b.music) {
      const musicEnabled = (b.musicOn ? b.musicOn() : true) && !muted;
      b.music.muted = !musicEnabled;
      b.music.volume = 0.22 * master;
      try {
        b.music.currentTime = this.timeSec;
        if (b.music.paused) {
          void b.music.play()?.catch?.(() => undefined);
        }
      } catch {}
    }
  }

  pauseAllAudio(): void {
    const b = this.audioBinding;
    if (!b) return;
    if (b.voices) {
      for (const vo of b.voices) {
        if (vo && !vo.paused) {
          try {
            vo.pause();
          } catch {}
        }
      }
    }
    if (b.music && !b.music.paused) {
      try {
        b.music.pause();
      } catch {}
    }
    if (b.sfxAudios) {
      for (const el of Object.values(b.sfxAudios)) {
        if (el && !el.paused) {
          try {
            el.pause();
          } catch {}
        }
      }
    }
  }
}
