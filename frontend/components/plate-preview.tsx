"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scriptFrameKey, voiceText, type VideoProject } from "@videosaas/contracts";
import { addPlateComment, drawPlateAspect, drawPlates, ensureMediaToken, fixPlates, getPlates, planSfxUrl, planVoiceUrl, plateClipUrl, plateExportUrl, removePlateComment, requestPlateExport, savePlateSubtitles, type PlateAspect, type PlateExportState, type PlateScene, type PlateSfxName, type PlateStatus, type SubtitleMode, type SubtitleStyle } from "../lib/api";
import {
  SfxCueTracker,
  WebAudioFilmTimeline,
  isPlateLiveEnabled,
  isWebAudioSupported,
  readStoredPreviewQuality,
  writeStoredPreviewQuality,
  type FrameStoreStatus,
  type LivePlateScene,
  type LivePlateStatus,
  type PreviewQuality,
  type QualityJobProgress,
  type SceneModeResolution
} from "../lib/live";
import { useMediaToken } from "../lib/use-media-token";
import { AnimationPrep, AnimationWorkspace, FinalView, activeSubtitleCueAt, buildPlateFinalRatios, buildSubtitleCues, sortWorkspaceComments, type WorkspaceAspectOption } from "./animation-workspace";
import { PlateLiveStage, type PlateLiveOptions } from "./plate-live-stage";
import { svgSrc } from "./script-canvas";

const SFX_NAMES: PlateSfxName[] = ["whoosh-short", "click", "pop", "chime", "typing", "impact-bass-1"];
type PlateSfxCue = { name: PlateSfxName; offset: number; volume: number; mediaStart?: number };

function selectSceneSfx(beat: { role?: string; sfx?: string | null; keyword?: string; visual?: string | null; transition_out?: { type?: string } } | undefined, index: number): PlateSfxCue {
  const text = `${beat?.sfx ?? ""} ${beat?.keyword ?? ""} ${beat?.visual ?? ""}`.toLowerCase();
  const role = beat?.role ?? "";
  if (/chime|bell|glow|beam|lantern|morning|dawn|smile|warm|resolv|safe|harbor|harbour|dusk/.test(text) || role === "reveal") {
    return { name: "chime", offset: 0.18, mediaStart: 0.2, volume: 0.9 };
  }
  if (/tick|flicker|count|coin|chain|gear|clock|type/.test(text)) {
    return { name: "typing", offset: 0.15, mediaStart: 0.38, volume: 0.92 };
  }
  if (index === 0 || /thud|boom|swell|impact|thunder|storm|dark|tide|wave|rock/.test(text)) {
    return { name: "impact-bass-1", offset: 0.06, volume: 0.4 };
  }
  return { name: "pop", offset: 0.2, volume: 0.72 };
}

function sceneSfxCues(
  beat: { role?: string; sfx?: string | null; keyword?: string; visual?: string | null; line?: string | null; transition_out?: { type?: string } } | undefined,
  words: { text: string; start: number; end: number }[] | undefined,
  duration: number,
  index: number
): PlateSfxCue[] {
  const cues: PlateSfxCue[] = [];
  const rawLine = (beat?.line || beat?.keyword || "").trim();
  const wordList: { text: string; start: number; end: number }[] = (words && words.length > 0)
    ? words
    : rawLine.split(/\s+/).filter(Boolean).map((w, idx, arr) => {
        const span = Math.max(0.8, duration - 0.35);
        const start = 0.08 + (idx / Math.max(1, arr.length)) * span;
        const end = 0.08 + ((idx + 1) / Math.max(1, arr.length)) * span;
        return { text: w, start, end };
      });

  const pushCue = (cue: PlateSfxCue, force = false) => {
    const clampedOffset = Math.max(0.02, Math.min(Math.max(0.1, duration - 0.12), Math.round(cue.offset * 100) / 100));
    if (!force) {
      const tooCloseSame = cues.some((c) => c.name === cue.name && Math.abs(c.offset - clampedOffset) < 1.1);
      if (tooCloseSame) return;
      const tooCloseAny = cues.some((c) => Math.abs(c.offset - clampedOffset) < 0.7);
      if (tooCloseAny) return;
    }
    cues.push({ ...cue, offset: clampedOffset });
  };

  for (const w of wordList) {
    const clean = w.text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!clean) continue;
    const t = Math.max(0.04, w.start + 0.06);

    if (/^(flicker|flickered|flickering|spark|sparks|sparked|buzz|buzzed|tick|ticked|ticking|blink|blinked|twice|shimmer|glitch)/.test(clean)) {
      pushCue({ name: "typing", offset: t, mediaStart: 0.38, volume: 0.95 }, true);
      continue;
    }
    if (/^(dark|darkness|dies|died|die|storm|thunder|crash|crashed|loud|roar|roared|swell|swells|heavy|broke|broken|lost|deep|shadow|shadows|rocks)/.test(clean)) {
      pushCue({ name: "impact-bass-1", offset: t, volume: 0.44 });
      continue;
    }
    if (/^(lantern|light|lights|glow|glowed|glowing|beam|morning|dawn|sun|sunrise|shine|shining|warm|safe|smile|smiled|bright|golden|clear|hope|kindness|heart|dusk)/.test(clean)) {
      pushCue({ name: "chime", offset: Math.max(0.04, t - 0.18), mediaStart: 0.2, volume: 0.92 });
      continue;
    }
    if (/^(lit|lighted|strike|struck|match|flare|flared|boat|boats|home|found|arrive|arrived|together|friend|friends|bowl|soup|umbrella|slipped|wrapped|kept|pocket|coin|coins|gift|table|place|placed|balloon|climbed)/.test(clean)) {
      pushCue({ name: "pop", offset: t, volume: 0.72 });
      continue;
    }
  }

  if (cues.length === 0) {
    pushCue(selectSceneSfx(beat, index), true);
  }

  return cues.sort((a, b) => a.offset - b.offset);
}

function sceneTransitionCues(duration: number, index: number, totalScenes: number): PlateSfxCue[] {
  if (index >= totalScenes - 1) return [];
  const cutAt = Math.max(0.15, Math.round((duration - 0.38) * 100) / 100);
  return [
    { name: "click", offset: cutAt, volume: 0.75 },
    { name: "whoosh-short", offset: Math.max(0.1, cutAt - 0.06), volume: 0.48 }
  ];
}

const LABEL: Record<string, string> = { queued: "Waiting", authoring: "Writing the scene", bundled: "Checking", checked: "Ready", rendering: "Drawing", drawn: "Drawn", failed: "Failed" };
const working = (scene?: PlateScene) => {
  const st = (scene as LivePlateScene | undefined)?.state;
  return st === "queued" || st === "authoring" || st === "bundled" || st === "rendering";
};

/**
 * The Preview of a code-drawn style (backend plates/): the storyboard's scenes drawn in the style's medium, played as ONE film on
 * one timeline. Comments are pinned to a moment of the film; applying them redraws only the scenes they fall in.
 */
export function PlatePreview({ project, onBack: _onBack, onRender, rendering, cost, prep, liveOptions }: { project: VideoProject; onBack: () => void; onRender?: () => void; rendering?: boolean; cost?: number; prep?: "sound" | "scenes" | "motion" | null; liveOptions?: PlateLiveOptions }) {
  useMediaToken();
  const [status, setStatus] = useState<PlateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(Boolean(liveOptions?.initialPlaying));
  const [time, setTime] = useState(liveOptions?.freezeClockAt ?? liveOptions?.initialTime ?? 0);
  const [liveResolutions, setLiveResolutions] = useState<SceneModeResolution[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceDurations, setVoiceDurations] = useState<Record<number, number>>({});
  const defaultStyle: SubtitleStyle = project.brief?.look === "illus-blueprint" ? "blueprint" : /^illus-(balloon|fox|folk-tale|gouache|watercolour)/.test(project.brief?.look ?? "") ? "paper" : "pill";
  const [subMode, setSubMode] = useState<SubtitleMode>(() => (project.brief?.captions as SubtitleMode) ?? "full");
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(defaultStyle);
  const [subSize, setSubSize] = useState<number>(100);
  const [subOpacity, setSubOpacity] = useState<number>(100);
  const [subColor, setSubColor] = useState<string>("");
  const [subBgColor, setSubBgColor] = useState<string>("");
  const [subPos, setSubPos] = useState<{ x: number; y: number }>({ x: 50, y: 88 });
  const [scenePositions, setScenePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [voiceOn, setVoiceOn] = useState<boolean>(true);
  const [musicOn, setMusicOn] = useState<boolean>(true);
  const [sfxOn, setSfxOn] = useState<boolean>(true);
  const [master, setMaster] = useState(1);
  const [muted, setMuted] = useState(false);
  const [transitionsOn, setTransitionsOn] = useState<boolean>(false);
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>(() => readStoredPreviewQuality());
  const [qualityJobProgress, setQualityJobProgress] = useState<QualityJobProgress | null>(null);
  const [storeStatus, setStoreStatus] = useState<FrameStoreStatus | null>(null);
  const subLoaded = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const subDrag = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const voices = useRef<(HTMLAudioElement | null)[]>([]);
  const sfxAudios = useRef<Record<string, HTMLAudioElement | null>>({});
  const sfxSlot = useRef<Record<string, number>>({});
  const sfxTracker = useRef<SfxCueTracker<PlateSfxName>>(new SfxCueTracker());
  const sfxSceneIndex = useRef<number>(-1);
  const audioTimelineRef = useRef<WebAudioFilmTimeline<PlateSfxName> | null>(null);
  const musicAudio = useRef<HTMLAudioElement>(null);
  const started = useRef(false);
  const wantPlay = useRef(false);
  const pending = useRef<number | null>(null);
  const scenes = useMemo(() => status?.scenes ?? [], [status]);
  const comments = useMemo(() => sortWorkspaceComments(status?.comments ?? []), [status]);
  const voiceTakes = useMemo(() => {
    const voiceLines = project.planAudio?.voice?.lines ?? [];
    return scenes.map((_, idx) => {
      const beatLine = project.brief?.scriptBeats?.[idx]?.line ?? project.beatPlan?.beats?.[idx]?.line;
      const beatId = project.beatPlan?.beats?.[idx]?.id;
      const take = voiceLines.find((item) => (beatId && item.beat === beatId) || (beatLine && item.text === voiceText(beatLine))) ?? voiceLines[idx];
      return take ? { url: planVoiceUrl(project.id, take.file), seconds: take.seconds, words: take.words } : null;
    });
  }, [project, scenes]);
  const durations = useMemo(
    () => scenes.map((scene, idx) => {
      const voSec = voiceDurations[idx] ?? voiceTakes[idx]?.seconds ?? 0;
      return Math.max(scene.seconds, voSec > 0 ? Math.round((voSec + 0.25) * 100) / 100 : 0);
    }),
    [scenes, voiceTakes, voiceDurations]
  );
  const starts = useMemo(() => durations.reduce<number[]>((acc, _, i) => { acc.push(i ? acc[i - 1]! + durations[i - 1]! : 0); return acc; }, []), [durations]);
  const total = durations.reduce((sum, sec) => sum + sec, 0);
  const flagEnabled = isPlateLiveEnabled(liveOptions?.flagOverride);
  const liveStatus = status as (PlateStatus & Partial<LivePlateStatus>) | null;
  const isLiveMode = flagEnabled && liveStatus?.mode === "live";
  const drawn = scenes.filter((scene) => scene.state === "drawn").length;
  const liveReadyCount = scenes.filter((scene, idx) => liveResolutions[idx]?.isReady ?? ((scene as LivePlateScene).state === "checked" || scene.state === "drawn")).length;
  const readyCount = isLiveMode ? liveReadyCount : drawn;
  const busy = Boolean(status?.running) || scenes.some(working) || (isLiveMode && liveResolutions.some((r) => r.tabState === "updating"));
  const failed = scenes.filter((scene) => scene.state === "failed").length;
  const shown = scenes[current];
  const musicSrc = project.planAudio?.music?.file ? planVoiceUrl(project.id, project.planAudio.music.file) : null;
  const pendingCommentScenes = useMemo(() => new Set(comments.map((c) => c.scene)), [comments]);
  const referenceFrames = useMemo(() => {
    const saved = project.scriptFrames ?? [];
    if (!saved.length) return [];
    const byKey = new Map(saved.map((f) => [f.key, f.svg]));
    const beats = project.brief?.scriptBeats ?? [];
    return scenes.map((_, idx) => {
      const beat = beats[idx];
      const svg = (beat && project.brief ? byKey.get(scriptFrameKey(beat, project.brief)) : undefined) ?? saved[idx]?.svg;
      return svg ? svgSrc(svg) : null;
    });
  }, [project.scriptFrames, project.brief, scenes]);

  const refreshStatus = useCallback(() => {
    void ensureMediaToken()
      .then(() => getPlates(project.id))
      .then((next) => { setStatus(next); setError(null); })
      .catch(() => undefined);
  }, [project.id]);

  const rateFor = useCallback((index: number, el: HTMLVideoElement | null) => {
    const sceneDur = durations[index] ?? scenes[index]?.seconds ?? 0;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0 || sceneDur <= el.duration) return 1;
    return Math.max(0.5, Math.min(1, el.duration / sceneDur));
  }, [durations, scenes]);

  useEffect(() => {
    if (prep) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await ensureMediaToken();
        const next = await getPlates(project.id);
        if (!live) return;
        setStatus(next); setError(null);
        if (!subLoaded.current && next.subtitles) {
          subLoaded.current = true;
          setSubMode(next.subtitles.mode);
          setSubStyle(next.subtitles.style);
          if (typeof next.subtitles.size === "number") setSubSize(next.subtitles.size);
          if (typeof next.subtitles.opacity === "number") setSubOpacity(next.subtitles.opacity);
          if (next.subtitles.color) setSubColor(next.subtitles.color);
          if (next.subtitles.bgColor) setSubBgColor(next.subtitles.bgColor);
          if (typeof next.subtitles.x === "number" && typeof next.subtitles.y === "number") {
            setSubPos({ x: next.subtitles.x, y: next.subtitles.y });
          }
          if (next.subtitles.scenePositions && typeof next.subtitles.scenePositions === "object") {
            const cleanPos: Record<string, { x: number; y: number }> = {};
            for (const [k, v] of Object.entries(next.subtitles.scenePositions)) {
              if (v && typeof v.x === "number" && typeof v.y === "number") cleanPos[k] = { x: v.x, y: v.y };
            }
            setScenePositions(cleanPos);
          }
          if (typeof next.subtitles.voice === "boolean") setVoiceOn(next.subtitles.voice);
          if (typeof next.subtitles.music === "boolean") setMusicOn(next.subtitles.music);
          if (typeof next.subtitles.sfx === "boolean") setSfxOn(next.subtitles.sfx);
          if (typeof next.subtitles.transitions === "boolean") setTransitionsOn(next.subtitles.transitions);
        }
        let shouldKeepPolling = Boolean(next.running) || next.scenes.some(working) || (next.drawingAspects?.length ?? 0) > 0;
        if (next.available && !started.current && !next.running) {
          started.current = true;
          const nextMode = (next as Partial<LivePlateStatus>).mode;
          const isSceneDone = (s: { state: string }) =>
            flagEnabled && nextMode === "live" ? s.state === "checked" || s.state === "drawn" : s.state === "drawn";
          if (!next.scenes.length || next.scenes.some((s) => !isSceneDone(s))) {
            const drawnStatus = await drawPlates(project.id);
            setStatus(drawnStatus);
            shouldKeepPolling = Boolean(drawnStatus.running) || drawnStatus.scenes.some(working) || (drawnStatus.drawingAspects?.length ?? 0) > 0;
          }
        }
        if (live && shouldKeepPolling) timer = setTimeout(poll, flagEnabled ? 1500 : 3000);
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : "Could not load the scenes.");
          timer = setTimeout(poll, 3000);
        }
      }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [project.id, project.brief?.scriptBeats?.length, prep, busy, flagEnabled]);

  const clearSfxTimers = useCallback(() => {
    // No setTimeout timers are used; reset tracker cursor on stop/clear.
  }, []);

  const buildCuesForScene = useCallback(
    (index: number, overrides?: { sfx?: boolean; transitions?: boolean }): PlateSfxCue[] => {
      const useSfx = overrides?.sfx ?? sfxOn;
      const useTransitions = overrides?.transitions ?? transitionsOn;
      if (!useSfx && !useTransitions) return [];
      const planBeat = project.beatPlan?.beats?.[index];
      const scriptBeat = project.brief?.scriptBeats?.[index];
      const sceneDur = durations[index] ?? scenes[index]?.seconds ?? 4;
      return [
        ...(useSfx
          ? sceneSfxCues(
              {
                role: planBeat?.role,
                sfx: planBeat?.sfx,
                keyword: scriptBeat?.keyword ?? planBeat?.keyword,
                visual: scriptBeat?.visual,
                line: scriptBeat?.line ?? planBeat?.line,
                transition_out: planBeat?.transition_out
              },
              voiceTakes[index]?.words,
              sceneDur,
              index
            )
          : []),
        ...(useTransitions ? sceneTransitionCues(sceneDur, index, scenes.length) : [])
      ];
    },
    [sfxOn, transitionsOn, project.beatPlan?.beats, project.brief?.scriptBeats, durations, scenes, voiceTakes]
  );

  const playSceneSfx = useCallback(
    (index: number, realOffset: number, overrides?: { sfx?: boolean; transitions?: boolean }) => {
      sfxSceneIndex.current = index;
      const cues = buildCuesForScene(index, overrides);
      sfxTracker.current.setCues(cues, realOffset);
      audioTimelineRef.current?.reloadCues();
    },
    [buildCuesForScene]
  );

  // Initialize and keep the single Web Audio timeline in sync when AudioContext is available.
  useEffect(() => {
    if (!isWebAudioSupported()) return;
    const spans = durations.map((dur, idx) => ({
      id: `scene-${idx}`,
      start: starts[idx] ?? 0,
      end: (starts[idx] ?? 0) + dur
    }));
    const tl = new WebAudioFilmTimeline<PlateSfxName>({
      fps: 30,
      spans,
      sceneCues: (idx) => buildCuesForScene(idx),
      voiceOn,
      musicOn,
      sfxOn: sfxOn || transitionsOn,
      muted,
      masterVolume: master,
      initialTime: time,
      onAutoplayBlocked: () => {
        wantPlay.current = false;
        setPlaying(false);
      },
      onVoiceDurationDecoded: (idx, durSec) => {
        if (Number.isFinite(durSec) && durSec > 0) {
          setVoiceDurations((prev) => (prev[idx] === durSec ? prev : { ...prev, [idx]: durSec }));
        }
      }
    });
    audioTimelineRef.current = tl;
    for (const sfxName of SFX_NAMES) {
      void tl.loadSfx(sfxName, planSfxUrl(sfxName));
    }
    return () => {
      tl.destroy();
      if (audioTimelineRef.current === tl) {
        audioTimelineRef.current = null;
      }
    };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const tl = audioTimelineRef.current;
    if (!tl) return;
    const spans = durations.map((dur, idx) => ({
      id: `scene-${idx}`,
      start: starts[idx] ?? 0,
      end: (starts[idx] ?? 0) + dur
    }));
    tl.setSpans(spans);
    tl.setSceneCuesProvider((idx) => buildCuesForScene(idx));
  }, [durations, starts, buildCuesForScene]);

  useEffect(() => {
    const tl = audioTimelineRef.current;
    if (!tl) return;
    voiceTakes.forEach((take, idx) => {
      void tl.loadVoice(idx, take?.url);
    });
  }, [voiceTakes]);

  useEffect(() => {
    const tl = audioTimelineRef.current;
    if (!tl) return;
    void tl.loadMusic(musicSrc);
  }, [musicSrc]);

  useEffect(() => {
    const tl = audioTimelineRef.current;
    if (!tl) return;
    tl.setVoiceOn(voiceOn);
    tl.setMusicOn(musicOn);
    tl.setSfxOn(sfxOn || transitionsOn);
    tl.setMuted(muted);
    tl.setMasterVolume(master);
  }, [voiceOn, musicOn, sfxOn, transitionsOn, muted, master]);

  const tickSceneSfx = useCallback(
    (index: number, localOffset: number, state: { playing: boolean; buffering: boolean }) => {
      if (!sfxOn && !transitionsOn) return;
      if (sfxSceneIndex.current !== index) {
        sfxSceneIndex.current = index;
        sfxTracker.current.setCues(buildCuesForScene(index), localOffset);
      }
      const crossed = sfxTracker.current.tick(localOffset, state);
      if (muted || !wantPlay.current || state.buffering) return;
      for (const cue of crossed) {
        const slot = (sfxSlot.current[cue.name] ?? 0) % 2;
        sfxSlot.current[cue.name] = slot + 1;
        const el = sfxAudios.current[`${cue.name}:${slot}`] ?? sfxAudios.current[`${cue.name}:0`];
        if (!el) continue;
        el.volume = Math.min(1, Math.max(0, cue.volume * master));
        el.currentTime = cue.mediaStart ?? 0;
        void el.play().catch(() => undefined);
      }
    },
    [sfxOn, transitionsOn, buildCuesForScene, muted, master]
  );

  useEffect(() => {
    if (!playing) return;
    if (isLiveMode && liveResolutions[current]?.mode === "live") return;
    let frame = 0;
    const tick = () => {
      const isSceneBuffering = Boolean(liveResolutions[current]?.isBuffering || liveResolutions[current]?.isPreparing);
      if (isSceneBuffering) {
        audioTimelineRef.current?.setBuffering(true);
        voices.current[current]?.pause();
        musicAudio.current?.pause();
        Object.values(sfxAudios.current).forEach((s) => s?.pause());
        frame = requestAnimationFrame(tick);
        return;
      }
      audioTimelineRef.current?.setBuffering(false);
      const el = videos.current[current];
      const vo = voices.current[current];
      const rate = rateFor(current, el);
      const vidElapsed = el ? el.currentTime / (rate || 1) : 0;
      const voElapsed = vo && (!vo.paused || vo.ended) ? vo.currentTime : 0;
      const local = Math.min(durations[current] ?? 0, Math.max(vidElapsed, voElapsed));
      setTime((starts[current] ?? 0) + local);
      tickSceneSfx(current, local, { playing: true, buffering: isSceneBuffering });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, current, starts, durations, rateFor, isLiveMode, liveResolutions, tickSceneSfx]);

  useEffect(() => {
    videos.current.forEach((el, idx) => { if (idx !== current && el && !el.paused) el.pause(); });
    voices.current.forEach((el, idx) => { if (idx !== current && el && !el.paused) el.pause(); });
    if (isLiveMode && liveResolutions[current]?.mode === "live") {
      if (pending.current !== null) {
        const offset = pending.current;
        const vo = voices.current[current];
        if (vo && vo.readyState >= 1) vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), offset) : offset;
        pending.current = null;
      }
      return;
    }
    const el = videos.current[current];
    const vo = voices.current[current];
    if (!el) return;
    const rate = rateFor(current, el);
    el.playbackRate = rate;
    if (pending.current !== null) {
      const offset = pending.current;
      el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, offset * rate) : offset;
      if (vo) vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), offset) : offset;
      pending.current = null;
    }
    if (wantPlay.current) void el.play().catch(() => setPlaying(false));
  }, [current, rateFor, isLiveMode, liveResolutions]);

  const seek = useCallback((at: number) => {
    if (!scenes.length) return;
    const clamped = Math.min(Math.max(0, at), Math.max(0, total - 0.05));
    let index = scenes.length - 1;
    for (let i = 0; i < scenes.length; i++) if (clamped < starts[i]! + durations[i]!) { index = i; break; }
    const local = clamped - starts[index]!;
    setTime(clamped);
    audioTimelineRef.current?.seek(clamped);
    if (musicAudio.current) musicAudio.current.currentTime = clamped;
    const vo = voices.current[index];
    if (isLiveMode && liveResolutions[index]?.mode === "live") {
      videos.current.forEach((v) => { if (v && !v.paused) v.pause(); });
      voices.current.forEach((v, idx) => { if (idx !== index && v && !v.paused) v.pause(); });
      if (vo && vo.readyState >= 1) {
        vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), local) : local;
      } else {
        pending.current = local;
      }
      if (wantPlay.current) playSceneSfx(index, local);
      else clearSfxTimers();
      if (index !== current) setCurrent(index);
      return;
    }
    const el = videos.current[index];
    const rate = rateFor(index, el);
    if (index === current && el) {
      el.playbackRate = rate;
      el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, local * rate) : local;
      if (vo) vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), local) : local;
      if (wantPlay.current) playSceneSfx(index, local);
      else clearSfxTimers();
    } else {
      if (el && el.readyState >= 1) {
        el.playbackRate = rate;
        el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, local * rate) : local;
        if (vo && vo.readyState >= 1) vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), local) : local;
        pending.current = null;
      } else {
        pending.current = local;
      }
      setCurrent(index);
    }
  }, [scenes, starts, durations, total, current, rateFor, isLiveMode, liveResolutions]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLoaded = (index: number) => {
    const el = videos.current[index];
    const vo = voices.current[index];
    if (!el) return;
    const rate = rateFor(index, el);
    el.playbackRate = rate;
    if (index !== current) { el.currentTime = 0.001; return; }
    const offset = pending.current;
    if (offset !== null) {
      el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, offset * rate) : offset;
      if (vo) vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), offset) : offset;
      pending.current = null;
    } else if (!wantPlay.current && el.currentTime === 0) {
      el.currentTime = 0.001;
    }
    if (wantPlay.current && (!isLiveMode || liveResolutions[index]?.mode === "clip")) void el.play().catch(() => setPlaying(false));
  };

  const toggle = () => {
    const el = videos.current[current];
    const vo = voices.current[current];
    if (isLiveMode) {
      const curRes = liveResolutions[current];
      if (!curRes?.isPlayable) return;
      if (!playing) {
        wantPlay.current = true;
        if (time >= total - 0.1) seek(0);
        void audioTimelineRef.current?.unlockFromUserGesture();
        if (curRes.mode === "live") {
          setPlaying(true);
          void audioTimelineRef.current?.play({ fromUserGesture: true });
        } else if (el) {
          el.playbackRate = rateFor(current, el);
          void el.play().catch(() => setPlaying(false));
        }
      } else {
        wantPlay.current = false;
        audioTimelineRef.current?.pause();
        el?.pause();
        vo?.pause();
        musicAudio.current?.pause();
        clearSfxTimers();
        Object.values(sfxAudios.current).forEach((s) => s?.pause());
        setPlaying(false);
      }
      return;
    }
    if (!el || shown?.state !== "drawn") return;
    if (!playing) {
      wantPlay.current = true;
      if (time >= total - 0.1) seek(0);
      void audioTimelineRef.current?.unlockFromUserGesture();
      el.playbackRate = rateFor(current, el);
      void el.play().catch(() => undefined);
    } else {
      wantPlay.current = false;
      audioTimelineRef.current?.pause();
      el.pause();
      vo?.pause();
      musicAudio.current?.pause();
      setPlaying(false);
    }
  };

  const advanceFrom = useCallback((index: number) => {
    if (index !== current) return;
    voices.current[index]?.pause();
    const after = scenes.findIndex((scene, i) =>
      i > current && (isLiveMode ? Boolean(liveResolutions[i]?.isPlayable) : scene.state === "drawn")
    );
    if (after >= 0) {
      const nextVideo = videos.current[after];
      const nextVoice = voices.current[after];
      if (isLiveMode && liveResolutions[after]?.mode === "live") {
        if (nextVoice && nextVoice.readyState >= 1) nextVoice.currentTime = 0;
        pending.current = null;
        const nextStart = starts[after] ?? 0;
        setTime(nextStart);
        audioTimelineRef.current?.seek(nextStart);
        setCurrent(after);
      } else {
        audioTimelineRef.current?.pause();
        if (nextVideo && nextVideo.readyState >= 1) {
          nextVideo.playbackRate = rateFor(after, nextVideo);
          nextVideo.currentTime = 0;
          if (nextVoice && nextVoice.readyState >= 1) nextVoice.currentTime = 0;
          pending.current = null;
        } else {
          pending.current = 0;
        }
        setCurrent(after);
      }
    } else {
      wantPlay.current = false;
      audioTimelineRef.current?.pause();
      setPlaying(false);
      musicAudio.current?.pause();
      setTime(total);
    }
  }, [current, scenes, isLiveMode, liveResolutions, starts, rateFor, total]);

  const onVideoEnded = (index: number) => {
    if (index !== current) return;
    const vo = voices.current[index];
    if (vo && !vo.paused && !vo.ended) return;
    advanceFrom(index);
  };

  const onVoiceEnded = (index: number) => {
    if (index !== current) return;
    if (isLiveMode && liveResolutions[index]?.mode === "live") return;
    const el = videos.current[index];
    if (!el || el.ended || el.paused || (Number.isFinite(el.duration) && el.duration - el.currentTime <= 0.2)) {
      advanceFrom(index);
    }
  };

  const add = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); wantPlay.current = false; setPlaying(false); audioTimelineRef.current?.pause(); videos.current[current]?.pause(); voices.current[current]?.pause(); musicAudio.current?.pause();
    try { await addPlateComment(project.id, time, body); setDraft(""); setStatus(await getPlates(project.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not add the comment."); }
    finally { setSending(false); }
  };
  const apply = async () => { setError(null); try { setStatus(await fixPlates(project.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not redraw the scenes."); } };
  const remove = async (id: string) => { try { await removePlateComment(project.id, id); setStatus(await getPlates(project.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove the comment."); } };

  const chooseSubMode = (nextMode: SubtitleMode) => {
    subLoaded.current = true;
    setSubMode(nextMode);
    void savePlateSubtitles(project.id, { mode: nextMode, style: subStyle, size: subSize, color: subColor || null, bgColor: subBgColor || null, x: subPos.x, y: subPos.y }).catch(() => undefined);
  };
  const chooseSubStyle = (nextStyle: SubtitleStyle) => {
    subLoaded.current = true;
    setSubStyle(nextStyle);
    setSubColor("");
    setSubBgColor("");
    void savePlateSubtitles(project.id, { mode: subMode, style: nextStyle, size: subSize, color: null, bgColor: null, x: subPos.x, y: subPos.y }).catch(() => undefined);
  };
  const changeSubSize = (delta: number) => {
    subLoaded.current = true;
    const nextSize = Math.min(160, Math.max(50, subSize + delta));
    setSubSize(nextSize);
    void savePlateSubtitles(project.id, { size: nextSize }).catch(() => undefined);
  };
  const setSubOpacityDirect = (nextOpacity: number) => {
    subLoaded.current = true;
    const clamped = Math.min(100, Math.max(20, nextOpacity));
    setSubOpacity(clamped);
    void savePlateSubtitles(project.id, { opacity: clamped }).catch(() => undefined);
  };
  const applyPosToAllScenes = (pos: { x: number; y: number }) => {
    subLoaded.current = true;
    setSubPos(pos);
    setScenePositions({});
    void savePlateSubtitles(project.id, { x: pos.x, y: pos.y, scenePositions: null }).catch(() => undefined);
  };
  const setSceneSubtitlePos = (sceneIdx: number, pos: { x: number; y: number }) => {
    subLoaded.current = true;
    const key = String(sceneIdx);
    setScenePositions((prev) => ({ ...prev, [key]: pos }));
    void savePlateSubtitles(project.id, { scenePositions: { [key]: pos } }).catch(() => undefined);
  };
  const changeSubColor = (hex: string) => {
    subLoaded.current = true;
    setSubColor(hex);
    void savePlateSubtitles(project.id, { color: hex }).catch(() => undefined);
  };
  const changeSubBgColor = (hex: string) => {
    subLoaded.current = true;
    setSubBgColor(hex);
    void savePlateSubtitles(project.id, { bgColor: hex }).catch(() => undefined);
  };

  const toggleVoice = () => {
    subLoaded.current = true;
    const nextVoice = !voiceOn;
    setVoiceOn(nextVoice);
    voices.current.forEach((el) => { if (el) el.muted = !nextVoice; });
    void savePlateSubtitles(project.id, { voice: nextVoice }).catch(() => undefined);
  };
  useEffect(() => {
    voices.current.forEach((el) => { if (el) el.volume = master; });
    if (musicAudio.current) musicAudio.current.volume = 0.22 * master;
  }, [master]);

  const toggleMusic = () => {
    subLoaded.current = true;
    const nextMusic = !musicOn;
    setMusicOn(nextMusic);
    if (musicAudio.current) {
      musicAudio.current.muted = !nextMusic || muted;
      if (nextMusic && wantPlay.current && musicAudio.current.paused) {
        musicAudio.current.volume = 0.22 * master;
        musicAudio.current.currentTime = time;
        void musicAudio.current.play().catch(() => undefined);
      }
    }
    void savePlateSubtitles(project.id, { music: nextMusic }).catch(() => undefined);
  };
  const toggleSfx = () => {
    subLoaded.current = true;
    const nextSfx = !sfxOn;
    setSfxOn(nextSfx);
    if (!nextSfx && !transitionsOn) {
      clearSfxTimers();
      Object.values(sfxAudios.current).forEach((el) => el?.pause());
    } else if (wantPlay.current) {
      const local = Math.max(0, time - (starts[current] ?? 0));
      playSceneSfx(current, local, { sfx: nextSfx, transitions: transitionsOn });
    }
    void savePlateSubtitles(project.id, { sfx: nextSfx }).catch(() => undefined);
  };
  const toggleTransitions = () => {
    subLoaded.current = true;
    const nextTransitions = !transitionsOn;
    setTransitionsOn(nextTransitions);
    if (!nextTransitions) {
      sfxAudios.current["whoosh-short:0"]?.pause();
      sfxAudios.current["whoosh-short:1"]?.pause();
      sfxAudios.current["click:0"]?.pause();
      sfxAudios.current["click:1"]?.pause();
    }
    if (wantPlay.current) {
      const local = Math.max(0, time - (starts[current] ?? 0));
      playSceneSfx(current, local, { sfx: sfxOn, transitions: nextTransitions });
    }
    void savePlateSubtitles(project.id, { transitions: nextTransitions }).catch(() => undefined);
  };
  const resetSubCustomization = () => {
    subLoaded.current = true;
    setSubSize(100);
    setSubOpacity(100);
    setSubColor("");
    setSubBgColor("");
    setSubPos({ x: 50, y: 88 });
    setScenePositions({});
    void savePlateSubtitles(project.id, { size: 100, opacity: 100, color: null, bgColor: null, x: 50, y: 88, scenePositions: null }).catch(() => undefined);
  };

  const subtitleCues = useMemo(() => buildSubtitleCues(subMode, scenes, project.brief?.scriptBeats, starts, durations), [subMode, scenes, project.brief?.scriptBeats, starts, durations]);
  const activeCue = useMemo(() => activeSubtitleCueAt(subMode, subtitleCues, time, current), [subMode, subtitleCues, time, current]);
  const curScenePos = scenePositions[String(current)] ?? subPos;
  const effectiveTextColor = subColor || (subStyle === "cinema" ? "#fef08a" : subStyle === "kinetic" || subStyle === "paper" ? "#1e1b18" : "#ffffff");
  const effectiveBgColor = subBgColor || (subStyle === "kinetic" ? "#facc15" : subStyle === "paper" ? "#faf5e8" : subStyle === "blueprint" ? "#0c2a4a" : "#0c0f16");
  const defaultAspect = (project.brief?.aspect ?? (project.request.format === "portrait" ? "9:16" : "16:9")) as "16:9" | "9:16" | "1:1";
  const selectedBriefAspects: ("16:9" | "9:16" | "1:1")[] = project.brief?.aspects && project.brief.aspects.length > 0 ? project.brief.aspects : [defaultAspect];
  const [viewAspect, setViewAspect] = useState<"16:9" | "9:16" | "1:1">(selectedBriefAspects[0] ?? defaultAspect);
  const drawnAspects = status?.drawnAspects ?? [defaultAspect];
  const drawingAspects = status?.drawingAspects ?? [];
  const isViewAspectDrawn = drawnAspects.includes(viewAspect);
  const isViewAspectDrawing = drawingAspects.includes(viewAspect);

  const selectOrDrawAspect = (asp: "16:9" | "9:16" | "1:1") => {
    wantPlay.current = false;
    setPlaying(false);
    audioTimelineRef.current?.pause();
    videos.current[current]?.pause();
    voices.current[current]?.pause();
    musicAudio.current?.pause();
    setViewAspect(asp);
    if (!drawnAspects.includes(asp) && !drawingAspects.includes(asp) && readyCount === scenes.length && scenes.length > 0) {
      void drawPlateAspect(project.id, asp).then(setStatus).catch((e) => setError(e instanceof Error ? e.message : "Could not draw this dimension."));
    }
  };

  const aspectOptions: WorkspaceAspectOption[] = (["16:9", "9:16", "1:1"] as const).map((asp) => {
    const isDrawn = drawnAspects.includes(asp);
    const isDrawing = drawingAspects.includes(asp);
    return {
      aspect: asp,
      status: isDrawing ? "busy" : isDrawn ? "ready" : "available",
      title: isDrawn ? `Switch to drawn ${asp} canvas` : isDrawing ? `Drawing ${asp} canvas…` : `Draw & preview ${asp} canvas`
    };
  });

  const choosePreviewQuality = (nextQuality: PreviewQuality) => {
    const q = writeStoredPreviewQuality(nextQuality);
    setPreviewQuality(q);
  };

  const errors: string[] = [];
  if (error) errors.push(error);
  if (status && !status.available) errors.push("Code-drawn scenes aren't available for this project right now.");

  const currentLiveStatusText = isLiveMode ? liveResolutions[current]?.statusText : undefined;
  const activeQualityJobText =
    (qualityJobProgress?.running && qualityJobProgress.text) ? qualityJobProgress.text : (storeStatus?.qualityJobText ?? null);

  const statusBadge = activeQualityJobText
    ? {
        text: activeQualityJobText,
        showRetry: false
      }
    : currentLiveStatusText
      ? {
          text: currentLiveStatusText,
          showRetry: false
        }
      : storeStatus?.disabled && storeStatus.disabledReason
        ? {
            text: storeStatus.disabledReason,
            showRetry: false
          }
        : busy || failed > 0 || (scenes.length > 0 && readyCount < scenes.length)
          ? {
              text: isLiveMode ? <>{readyCount}/{scenes.length || "…"} ready{busy ? "…" : ""}</> : <>{drawn}/{scenes.length || "…"} drawn{busy ? "…" : ""}</>,
              showRetry: !busy,
              onRetry: () => { void drawPlates(project.id).then(setStatus).catch((e) => setError(e instanceof Error ? e.message : "Could not start drawing.")); }
            }
          : null;

  const isCurrentScenePlayable = isLiveMode ? Boolean(liveResolutions[current]?.isPlayable) : (shown?.state === "drawn" && isViewAspectDrawn);

  return <AnimationWorkspace
    aspect={viewAspect}
    aspects={aspectOptions}
    onSelectAspect={selectOrDrawAspect}
    errors={errors}
    audioControls={{ voice: voiceOn, music: musicOn, sfx: sfxOn, transitions: transitionsOn, onToggleVoice: toggleVoice, onToggleMusic: toggleMusic, onToggleSfx: toggleSfx, onToggleTransitions: toggleTransitions }}
    subtitleControls={{ mode: subMode, style: subStyle, size: subSize, opacity: subOpacity, textColor: subColor, bgColor: subBgColor, effectiveTextColor, effectiveBgColor, position: curScenePos, currentSceneIndex: current, onSelectMode: chooseSubMode, onSelectStyle: chooseSubStyle, onStepSize: changeSubSize, onChangeTextColor: changeSubColor, onChangeBgColor: changeSubBgColor, onChangeOpacity: setSubOpacityDirect, onChangeScenePosition: setSceneSubtitlePos, onApplyPositionToAll: applyPosToAllScenes, onResetCustomization: resetSubCustomization }}
    previewQualityControls={{ quality: previewQuality, onSelectQuality: choosePreviewQuality }}
    statusBadge={statusBadge}
    canvasRef={canvasRef}
    onStageClick={toggle}
    renderStage={() => <>
      {isLiveMode ? (
        <PlateLiveStage
          projectId={project.id}
          scenes={scenes as LivePlateScene[]}
          referenceFrames={referenceFrames}
          viewAspect={viewAspect}
          primaryAspect={defaultAspect}
          isViewAspectDrawn={isViewAspectDrawn}
          isViewAspectDrawing={isViewAspectDrawing}
          prep={prep}
          current={current}
          playing={playing}
          time={time}
          durations={durations}
          starts={starts}
          total={total}
          voiceOn={voiceOn}
          musicOn={musicOn}
          master={master}
          muted={muted}
          musicSrc={musicSrc}
          pendingCommentScenes={pendingCommentScenes}
          videos={videos}
          voices={voices}
          musicAudio={musicAudio}
          sfxAudios={sfxAudios}
          wantPlay={wantPlay}
          rateFor={rateFor}
          onLoadedVideo={onLoaded}
          onVideoEnded={onVideoEnded}
          onAdvanceScene={advanceFrom}
          onSetPlaying={setPlaying}
          onSetTime={setTime}
          playSceneSfx={playSceneSfx}
          tickSceneSfx={tickSceneSfx}
          clearSfxTimers={clearSfxTimers}
          onStatusRefresh={refreshStatus}
          onResolutionsChange={setLiveResolutions}
          previewQuality={previewQuality}
          onQualityJobProgress={setQualityJobProgress}
          onStoreStatusChange={setStoreStatus}
          audioTimeline={audioTimelineRef.current}
          qualityJobText={activeQualityJobText}
          storeDisabledReason={storeStatus?.disabled ? storeStatus.disabledReason : null}
          liveOptions={liveOptions}
        />
      ) : (
        <>
          {isViewAspectDrawn && scenes.map((scene) => {
            if (scene.state !== "drawn") return null;
            const clipSrc = plateClipUrl(project.id, scene.index, `${scene.variants?.[viewAspect]?.v ?? scene.sig}-${scene.rev ?? 0}-${viewAspect}`, viewAspect);
            return <video
              key={`${scene.index}-${clipSrc}`}
              ref={(el) => { videos.current[scene.index] = el; }}
              className={scene.index === current ? "on" : ""}
              src={clipSrc}
              preload="auto"
              muted
              playsInline
              onLoadedData={() => onLoaded(scene.index)}
              onError={(e) => {
                const el = e.currentTarget;
                const tries = Number(el.dataset.retries ?? "0");
                if (tries >= 2) return;
                el.dataset.retries = String(tries + 1);
                window.setTimeout(() => el.load(), 1500 * (tries + 1));
              }}
              onPlay={(e) => {
                if (scene.index !== current) return;
                setPlaying(true);
                const rate = rateFor(scene.index, e.currentTarget);
                e.currentTarget.playbackRate = rate;
                const realOffset = e.currentTarget.currentTime / (rate || 1);
                const vo = voices.current[scene.index];
                if (vo) {
                  vo.muted = !voiceOn;
                  vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), realOffset) : realOffset;
                  vo.volume = master; void vo.play().catch(() => undefined);
                }
                if (musicAudio.current && musicSrc) {
                  musicAudio.current.muted = !musicOn || muted;
                  musicAudio.current.volume = 0.22 * master;
                  if (musicAudio.current.paused) {
                    musicAudio.current.currentTime = (starts[scene.index] ?? 0) + realOffset;
                    void musicAudio.current.play().catch(() => undefined);
                  }
                }
                playSceneSfx(scene.index, realOffset);
              }}
              onPause={(e) => {
                if (scene.index !== current) return;
                if (!wantPlay.current || !e.currentTarget.ended) voices.current[scene.index]?.pause();
                if (!wantPlay.current) {
                  setPlaying(false);
                  musicAudio.current?.pause();
                  clearSfxTimers();
                  Object.values(sfxAudios.current).forEach((el) => el?.pause());
                }
              }}
              onEnded={() => onVideoEnded(scene.index)}
              onTimeUpdate={(e) => {
                if (scene.index === current && !playing) {
                  const rate = rateFor(current, e.currentTarget);
                  setTime((starts[current] ?? 0) + e.currentTarget.currentTime / (rate || 1));
                }
              }}
            />;
          })}
          {(shown?.state !== "drawn" || !isViewAspectDrawn) && <AnimationPrep
            failed={shown?.state === "failed"}
            title={shown?.state === "failed" ? "This scene didn't draw" : isViewAspectDrawing || (shown?.state === "drawn" && !isViewAspectDrawn) ? <>Drawing scenes in {viewAspect}…</> : prep === "sound" ? "Making the voiceover and music…" : prep === "scenes" ? "Planning the scenes…" : shown ? `${LABEL[shown.state]}…` : "Preparing the scenes…"}
            detail={shown?.state === "failed" ? shown.error : isViewAspectDrawing || (shown?.state === "drawn" && !isViewAspectDrawn) ? <>Drawing every scene on a {viewAspect} canvas so no character is cropped</> : prep === "sound" ? "Recording the narration and building the music bed" : prep === "scenes" ? "Preparing the storyboard timing" : <>Scene {(shown?.index ?? 0) + 1} of {scenes.length || "…"}</>}
          />}
        </>
      )}
      {isCurrentScenePlayable && activeCue && <div
        className={`aw-subtitle aw-sub-${subStyle}`}
        aria-live="polite"
        title={`Drag to move Scene ${current + 1}'s subtitle anywhere on the screen`}
        style={{ left: `${curScenePos.x}%`, top: `${curScenePos.y}%`, opacity: subOpacity / 100, "--sub-scale": String(subSize / 100) } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          subDrag.current = { startX: e.clientX, startY: e.clientY, origX: curScenePos.x, origY: curScenePos.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = subDrag.current;
          const box = canvasRef.current?.getBoundingClientRect();
          if (!d || !box || !box.width || !box.height) return;
          const dx = ((e.clientX - d.startX) / box.width) * 100;
          const dy = ((e.clientY - d.startY) / box.height) * 100;
          if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) d.moved = true;
          const nx = Math.min(92, Math.max(8, Math.round((d.origX + dx) * 10) / 10));
          const ny = Math.min(92, Math.max(8, Math.round((d.origY + dy) * 10) / 10));
          setScenePositions((prev) => ({ ...prev, [String(current)]: { x: nx, y: ny } }));
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const d = subDrag.current;
          subDrag.current = null;
          if (d?.moved) {
            const latest = scenePositions[String(current)] ?? curScenePos;
            void savePlateSubtitles(project.id, { scenePositions: { [String(current)]: latest } }).catch(() => undefined);
          }
        }}
      >
        <span style={{
          ...(subColor ? { color: subColor } : {}),
          ...(subBgColor ? (subStyle === "cinema" ? { textShadow: `0 2px 4px ${subBgColor}, -1.5px -1.5px 0 ${subBgColor}, 1.5px -1.5px 0 ${subBgColor}, -1.5px 1.5px 0 ${subBgColor}, 1.5px 1.5px 0 ${subBgColor}` } : { backgroundColor: subBgColor }) : {})
        }}>{activeCue.text}</span>
      </div>}
    </>}
    frameExtras={<>
      {voiceTakes.map((take, idx) => take ? <audio
        key={`${idx}-${take.url}`}
        ref={(el) => { voices.current[idx] = el; }}
        src={take.url}
        muted={!voiceOn || muted}
        preload="auto"
        onLoadedMetadata={(e) => {
          const dur = e.currentTarget.duration;
          if (Number.isFinite(dur) && dur > 0) setVoiceDurations((prev) => prev[idx] === dur ? prev : { ...prev, [idx]: dur });
        }}
        onEnded={() => onVoiceEnded(idx)}
      /> : null)}
      {musicSrc && <audio ref={musicAudio} src={musicSrc} muted={!musicOn || muted} loop preload="auto" />}
      {SFX_NAMES.flatMap((sfxName) => [0, 1].map((slot) => <audio key={`${sfxName}:${slot}`} ref={(el) => { sfxAudios.current[`${sfxName}:${slot}`] = el; }} src={planSfxUrl(sfxName)} muted={muted} preload="auto" />))}
    </>}
    playing={playing}
    playDisabled={!isCurrentScenePlayable}
    onTogglePlay={toggle}
    currentTime={time}
    totalDuration={total}
    currentSceneIndex={current}
    currentSceneLabel={shown ? `Scene ${shown.index + 1} · ${shown.keyword}` : ""}
    volume={master}
    muted={muted}
    onToggleMute={() => setMuted((m) => !m)}
    onChangeVolume={(v) => { setMaster(v); setMuted(v === 0); }}
    scenes={scenes.map((scene, idx) => {
      if (!isLiveMode) {
        return { index: scene.index, keyword: scene.keyword, duration: durations[scene.index] ?? scene.seconds, state: scene.state, stateLabel: LABEL[scene.state], stateClassName: scene.state, error: scene.error };
      }
      const res = liveResolutions[idx];
      return {
        index: scene.index,
        keyword: scene.keyword,
        duration: durations[scene.index] ?? scene.seconds,
        state: res?.tabState ?? scene.state,
        stateLabel: res?.tabLabel ?? LABEL[scene.state] ?? "Ready",
        stateClassName: res?.tabClassName ?? scene.state,
        error: scene.error
      };
    })}
    onSeek={seek}
    comments={comments}
    commentDraft={draft}
    onChangeCommentDraft={setDraft}
    onCommentFocus={() => { wantPlay.current = false; setPlaying(false); audioTimelineRef.current?.pause(); videos.current[current]?.pause(); voices.current[current]?.pause(); musicAudio.current?.pause(); }}
    canAddComment={readyCount > 0}
    addingComment={sending}
    onAddComment={() => void add()}
    onRemoveComment={(id) => void remove(id)}
    onApplyComments={() => void apply()}
    applyingComments={busy}
    onRender={onRender ? () => { wantPlay.current = false; setPlaying(false); audioTimelineRef.current?.pause(); videos.current[current]?.pause(); voices.current[current]?.pause(); musicAudio.current?.pause(); onRender(); } : undefined}
    rendering={rendering}
    cost={cost}
  />;
}

/** The ratios of a film (its own first) and where each one's finished export stands: asked once, followed until ready. */
export function usePlateRatios(project: VideoProject) {
  useMediaToken();
  const primary: PlateAspect = project.brief?.aspect === "1:1" ? "1:1" : project.request.format === "portrait" || project.brief?.aspect === "9:16" ? "9:16" : "16:9";
  const [others, setOthers] = useState<PlateAspect[]>([]);
  const [exports, setExports] = useState<Partial<Record<PlateAspect, PlateExportState>>>({});
  useEffect(() => {
    let live = true;
    getPlates(project.id).then((st) => { if (live) setOthers([...new Set([...(st.subtitles?.aspects ?? []), ...(st.drawnAspects ?? [])])].filter((a) => a !== primary)); }).catch(() => undefined);
    return () => { live = false; };
  }, [project.id, primary]);
  const key = others.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const misses: Record<string, number> = {};
    const tick = async () => {
      let waiting = false;
      for (const ratio of key.split(",") as PlateAspect[]) {
        try {
          const next = await requestPlateExport(project.id, ratio);
          if (!live) return;
          misses[ratio] = 0;
          setExports((all) => ({ ...all, [ratio]: next }));
          if (next.state !== "ready" && next.state !== "failed") waiting = true;
        } catch (e) {
          misses[ratio] = (misses[ratio] ?? 0) + 1;
          if (misses[ratio]! < 3) waiting = true;
          else if (live) setExports((all) => ({ ...all, [ratio]: { state: "failed", progress: 0, error: e instanceof Error ? e.message : "Could not prepare the video." } }));
        }
      }
      if (live && waiting) timer = setTimeout(() => void tick(), 2500);
    };
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, [project.id, key]);
  return { primary, ratios: [primary, ...others] as PlateAspect[], exports };
}

const SHAPE: Record<PlateAspect, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1" };

/**
 * The finished film of a code-drawn project: one player with a switch for every ratio (each plays its own finished file), a
 * download for each, and the approve / back actions. Replaces the scene list: the film itself is the page.
 */
export function PlateFinal({ project, finalUrl, onBack, onApprove, approved }: { project: VideoProject; finalUrl: string; onBack: () => void; onApprove: () => void | Promise<void>; approved: boolean }) {
  const { primary, ratios, exports } = usePlateRatios(project);
  const ratioItems = buildPlateFinalRatios(project.id, primary, ratios, finalUrl, exports, (ratio) => plateExportUrl(project.id, ratio));
  return <FinalView
    title="Your film"
    subtitle="Watch and download every ratio. Each one was drawn for its own frame, not cropped."
    ratios={ratioItems}
    initialRatio={primary}
    shape={(ratioId) => SHAPE[ratioId as PlateAspect] ?? "16 / 9"}
    onBack={onBack}
    onApprove={onApprove}
    approved={approved}
  />;
}
