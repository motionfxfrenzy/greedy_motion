"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { voiceText, type VideoProject } from "@videosaas/contracts";
import { addPlateComment, drawPlateAspect, drawPlates, ensureMediaToken, fixPlates, getPlates, planSfxUrl, planVoiceUrl, plateClipUrl, plateExportUrl, removePlateComment, requestPlateExport, savePlateSubtitles, type PlateAspect, type PlateExportState, type PlateScene, type PlateSfxName, type PlateStatus, type SubtitleMode, type SubtitleStyle } from "../lib/api";
import { useMediaToken } from "../lib/use-media-token";

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

const SUBTITLE_MODES: { id: SubtitleMode; label: string }[] = [
  { id: "none", label: "Off" },
  { id: "key-phrases", label: "Key phrases" },
  { id: "full", label: "Subtitles" }
];
const SUBTITLE_STYLES: { id: SubtitleStyle; label: string }[] = [
  { id: "pill", label: "Pill" },
  { id: "cinema", label: "Cinema" },
  { id: "kinetic", label: "Kinetic" },
  { id: "paper", label: "Storybook" },
  { id: "blueprint", label: "Blueprint" }
];

const LABEL: Record<PlateScene["state"], string> = { queued: "Waiting", authoring: "Writing the scene", rendering: "Drawing", drawn: "Drawn", failed: "Failed" };
const clock = (seconds: number) => { const s = Math.max(0, seconds); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
const working = (scene?: PlateScene) => scene?.state === "queued" || scene?.state === "authoring" || scene?.state === "rendering";

/**
 * The Preview of a code-drawn style (backend plates/): the storyboard's scenes drawn in the style's medium, played as ONE film on
 * one timeline. Comments are pinned to a moment of the film; applying them redraws only the scenes they fall in. The final video
 * for these styles is not built yet.
 */
export function PlatePreview({ project, onBack, onRender, rendering, cost, prep }: { project: VideoProject; onBack: () => void; onRender?: () => void; rendering?: boolean; cost?: number; prep?: "sound" | "scenes" | "motion" | null }) {
  useMediaToken();
  const [status, setStatus] = useState<PlateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
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
  // Player options: master volume and mute for voice, music and effects together.
  const [master, setMaster] = useState(1);
  const [muted, setMuted] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const [transitionsOn, setTransitionsOn] = useState<boolean>(false);
  const [barMode, setBarMode] = useState<"audio" | "subtitles" | null>("subtitles");
  const [openMenu, setOpenMenu] = useState<"captions" | "style" | "colors" | "opacity" | "position" | null>(null);
  const [dimOpen, setDimOpen] = useState<boolean>(false);
  const headBarRef = useRef<HTMLDivElement>(null);
  const dimRailRef = useRef<HTMLDivElement>(null);
  const subLoaded = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const subDrag = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const voices = useRef<(HTMLAudioElement | null)[]>([]);
  const sfxAudios = useRef<Record<string, HTMLAudioElement | null>>({});
  const sfxSlot = useRef<Record<string, number>>({});
  const sfxTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const musicAudio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const wantPlay = useRef(false);
  const pending = useRef<number | null>(null);
  const scenes = useMemo(() => status?.scenes ?? [], [status]);
  const comments = useMemo(() => [...(status?.comments ?? [])].sort((a, b) => a.at - b.at), [status]);
  const voiceTakes = useMemo(() => {
    const voiceLines = project.planAudio?.voice?.lines ?? [];
    return scenes.map((_, idx) => {
      const beatLine = project.brief?.scriptBeats?.[idx]?.line ?? project.beatPlan?.beats?.[idx]?.line;
      const beatId = project.beatPlan?.beats?.[idx]?.id;
      const take = voiceLines.find((item) => (beatId && item.beat === beatId) || (beatLine && item.text === voiceText(beatLine))) ?? voiceLines[idx];
      return take ? { url: planVoiceUrl(project.id, take.file), seconds: take.seconds, words: take.words } : null;
    });
  }, [project, scenes]);
  // Prioritize the voiceover clip: each scene runs at least as long as its voiceover take (plus a 0.25s breath).
  const durations = useMemo(
    () => scenes.map((scene, idx) => {
      const voSec = voiceDurations[idx] ?? voiceTakes[idx]?.seconds ?? 0;
      return Math.max(scene.seconds, voSec > 0 ? Math.round((voSec + 0.25) * 100) / 100 : 0);
    }),
    [scenes, voiceTakes, voiceDurations]
  );
  const starts = useMemo(() => durations.reduce<number[]>((acc, _, i) => { acc.push(i ? acc[i - 1]! + durations[i - 1]! : 0); return acc; }, []), [durations]);
  const total = durations.reduce((sum, sec) => sum + sec, 0);
  const drawn = scenes.filter((scene) => scene.state === "drawn").length;
  const busy = Boolean(status?.running) || scenes.some(working);
  const failed = scenes.filter((scene) => scene.state === "failed").length;
  const shown = scenes[current];
  const musicSrc = project.planAudio?.music?.file ? planVoiceUrl(project.id, project.planAudio.music.file) : null;

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
        // Opening the Preview draws the scenes, once (the backend keeps every scene whose storyboard line is unchanged).
        let shouldKeepPolling = Boolean(next.running) || next.scenes.some(working) || (next.drawingAspects?.length ?? 0) > 0;
        if (next.available && !started.current && !next.running) {
          started.current = true;
          if (!next.scenes.length || next.scenes.some((s) => s.state !== "drawn")) {
            const drawnStatus = await drawPlates(project.id);
            setStatus(drawnStatus);
            shouldKeepPolling = Boolean(drawnStatus.running) || drawnStatus.scenes.some(working) || (drawnStatus.drawingAspects?.length ?? 0) > 0;
          }
        }
        if (live && shouldKeepPolling) timer = setTimeout(poll, 3000);
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : "Could not load the scenes.");
          timer = setTimeout(poll, 3000);
        }
      }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [project.id, project.brief?.scriptBeats?.length, prep, busy]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (headBarRef.current && !headBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  // The film clock follows the playing clip (prioritizing the real-time voiceover clock when active), frame by frame.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = videos.current[current];
      const vo = voices.current[current];
      const rate = rateFor(current, el);
      const vidElapsed = el ? el.currentTime / (rate || 1) : 0;
      const voElapsed = vo && (!vo.paused || vo.ended) ? vo.currentTime : 0;
      const local = Math.min(durations[current] ?? 0, Math.max(vidElapsed, voElapsed));
      setTime((starts[current] ?? 0) + local);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, current, starts, durations, rateFor]);

  // Whenever `current` changes while playing or after a seek, start or position the already-mounted scene clip without remounting.
  useEffect(() => {
    videos.current.forEach((el, idx) => {
      if (idx !== current && el && !el.paused) el.pause();
    });
    voices.current.forEach((el, idx) => {
      if (idx !== current && el && !el.paused) el.pause();
    });
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
    if (wantPlay.current) {
      void el.play().catch(() => setPlaying(false));
    }
  }, [current, rateFor]);

  const seek = useCallback((at: number) => {
    if (!scenes.length) return;
    const clamped = Math.min(Math.max(0, at), Math.max(0, total - 0.05));
    let index = scenes.length - 1;
    for (let i = 0; i < scenes.length; i++) if (clamped < starts[i]! + durations[i]!) { index = i; break; }
    const local = clamped - starts[index]!;
    setTime(clamped);
    if (musicAudio.current) musicAudio.current.currentTime = clamped;
    const el = videos.current[index];
    const vo = voices.current[index];
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
  }, [scenes, starts, durations, total, current, rateFor]);

  const onLoaded = (index: number) => {
    const el = videos.current[index];
    const vo = voices.current[index];
    if (!el) return;
    const rate = rateFor(index, el);
    el.playbackRate = rate;
    if (index !== current) {
      // Pre-decode frame 0 so switching to this scene never flashes a black frame.
      el.currentTime = 0.001;
      return;
    }
    const offset = pending.current;
    if (offset !== null) {
      el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, offset * rate) : offset;
      if (vo) vo.currentTime = Number.isFinite(vo.duration) ? Math.min(Math.max(0, vo.duration - 0.05), offset) : offset;
      pending.current = null;
    } else if (!wantPlay.current && el.currentTime === 0) {
      el.currentTime = 0.001;
    }
    if (wantPlay.current) void el.play().catch(() => setPlaying(false));
  };
  const toggle = () => {
    const el = videos.current[current];
    const vo = voices.current[current];
    if (!el || shown?.state !== "drawn") return;
    if (!playing) {
      wantPlay.current = true;
      if (time >= total - 0.1) seek(0);
      el.playbackRate = rateFor(current, el);
      void el.play().catch(() => undefined);
    } else {
      wantPlay.current = false;
      el.pause();
      vo?.pause();
      musicAudio.current?.pause();
      setPlaying(false);
    }
  };
  const advanceFrom = (index: number) => {
    if (index !== current) return;
    voices.current[index]?.pause();
    const after = scenes.findIndex((scene, i) => i > current && scene.state === "drawn");
    if (after >= 0) {
      const nextVideo = videos.current[after];
      const nextVoice = voices.current[after];
      if (nextVideo && nextVideo.readyState >= 1) {
        nextVideo.playbackRate = rateFor(after, nextVideo);
        nextVideo.currentTime = 0;
        if (nextVoice && nextVoice.readyState >= 1) nextVoice.currentTime = 0;
        pending.current = null;
      } else {
        pending.current = 0;
      }
      setCurrent(after);
    } else {
      wantPlay.current = false;
      setPlaying(false);
      musicAudio.current?.pause();
      setTime(total);
    }
  };
  const onVideoEnded = (index: number) => {
    if (index !== current) return;
    const vo = voices.current[index];
    // Never cut off an active voiceover clip: wait for the voiceover to finish before advancing.
    if (vo && !vo.paused && !vo.ended) return;
    advanceFrom(index);
  };
  const onVoiceEnded = (index: number) => {
    if (index !== current) return;
    const el = videos.current[index];
    if (!el || el.ended || el.paused || (Number.isFinite(el.duration) && el.duration - el.currentTime <= 0.2)) {
      advanceFrom(index);
    }
  };

  // Scrubbing: press or drag anywhere on the timeline.
  const at = (event: { clientX: number }) => { const box = track.current?.getBoundingClientRect(); return box ? ((event.clientX - box.left) / box.width) * total : 0; };
  const drag = useRef(false);

  const add = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); wantPlay.current = false; videos.current[current]?.pause();
    try { await addPlateComment(project.id, time, body); setDraft(""); setStatus(await getPlates(project.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not add the comment."); }
    finally { setSending(false); }
  };
  const apply = async () => { setError(null); try { setStatus(await fixPlates(project.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not redraw the scenes."); } };
  const remove = async (id: string) => { try { await removePlateComment(project.id, id); setStatus(await getPlates(project.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not remove the comment."); } };
  const redraws = [...new Set(comments.map((c) => c.scene + 1))].join(", ");

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
  const clearSfxTimers = () => {
    sfxTimers.current.forEach((id) => clearTimeout(id));
    sfxTimers.current = [];
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

  const playSceneSfx = (index: number, realOffset: number, overrides?: { sfx?: boolean; transitions?: boolean }) => {
    clearSfxTimers();
    const useSfx = overrides?.sfx ?? sfxOn;
    const useTransitions = overrides?.transitions ?? transitionsOn;
    if (!useSfx && !useTransitions) return;
    const planBeat = project.beatPlan?.beats?.[index];
    const scriptBeat = project.brief?.scriptBeats?.[index];
    const sceneDur = durations[index] ?? scenes[index]?.seconds ?? 4;
    const cues = [
      ...(useSfx
        ? sceneSfxCues({
            role: planBeat?.role,
            sfx: planBeat?.sfx,
            keyword: scriptBeat?.keyword ?? planBeat?.keyword,
            visual: scriptBeat?.visual,
            line: scriptBeat?.line ?? planBeat?.line,
            transition_out: planBeat?.transition_out
          }, voiceTakes[index]?.words, sceneDur, index)
        : []),
      ...(useTransitions ? sceneTransitionCues(sceneDur, index, scenes.length) : [])
    ];

    cues.forEach((cue) => {
      if (realOffset > cue.offset + 0.25) return;
      const delayMs = Math.max(0, (cue.offset - realOffset) * 1000);
      const tid = setTimeout(() => {
        if (!wantPlay.current) return;
        const slot = (sfxSlot.current[cue.name] ?? 0) % 2;
        sfxSlot.current[cue.name] = slot + 1;
        const el = sfxAudios.current[`${cue.name}:${slot}`] ?? sfxAudios.current[`${cue.name}:0`];
        if (!el) return;
        el.volume = Math.min(1, Math.max(0, cue.volume * master));
        el.currentTime = cue.mediaStart ?? 0;
        void el.play().catch(() => undefined);
      }, delayMs);
      sfxTimers.current.push(tid);
    });
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

  const subtitleCues = useMemo(() => {
    if (subMode === "none" || !scenes.length) return [];
    const beats = project.brief?.scriptBeats ?? [];
    const cues: { scene: number; start: number; end: number; text: string }[] = [];
    scenes.forEach((scene, i) => {
      const beat = beats[i];
      const start = starts[i] ?? 0;
      const dur = durations[i] ?? scene.seconds;
      if (subMode === "key-phrases") {
        const text = (beat?.onScreen || beat?.keyword || scene.keyword || "").trim();
        if (text) cues.push({ scene: i, start, end: start + dur, text });
        return;
      }
      const line = (beat?.line || beat?.onScreen || beat?.keyword || scene.keyword || "").trim();
      if (!line) return;
      const words = line.split(/\s+/).filter(Boolean);
      const maxWords = 6;
      const chunks: string[] = [];
      for (let k = 0; k < words.length; k += maxWords) chunks.push(words.slice(k, k + maxWords).join(" "));
      let cursor = start;
      const totalWords = words.length || 1;
      chunks.forEach((chunk, idx) => {
        const wCount = chunk.split(/\s+/).length;
        const chunkDur = idx === chunks.length - 1 ? Math.max(0.25, start + dur - cursor) : Math.max(0.35, dur * (wCount / totalWords));
        cues.push({ scene: i, start: cursor, end: cursor + chunkDur, text: chunk });
        cursor += chunkDur;
      });
    });
    return cues;
  }, [subMode, scenes, project.brief?.scriptBeats, starts, durations]);

  const activeCue = useMemo(() => {
    if (subMode === "none" || !subtitleCues.length) return null;
    return subtitleCues.find((c) => time >= c.start && time < c.end) ?? subtitleCues.find((c) => c.scene === current) ?? null;
  }, [subMode, subtitleCues, time, current]);

  const curScenePos = scenePositions[String(current)] ?? subPos;
  const curModeLabel = SUBTITLE_MODES.find((m) => m.id === subMode)?.label ?? "Subtitles";
  const curStyleLabel = SUBTITLE_STYLES.find((s) => s.id === subStyle)?.label ?? "Pill";
  const effectiveTextColor = subColor || (subStyle === "cinema" ? "#fef08a" : subStyle === "kinetic" || subStyle === "paper" ? "#1e1b18" : "#ffffff");
  const effectiveBgColor = subBgColor || (subStyle === "kinetic" ? "#facc15" : subStyle === "paper" ? "#faf5e8" : subStyle === "blueprint" ? "#0c2a4a" : "#0c0f16");
  const defaultAspect = (project.brief?.aspect ?? (project.request.format === "portrait" ? "9:16" : "16:9")) as "16:9" | "9:16" | "1:1";
  const selectedBriefAspects: ("16:9" | "9:16" | "1:1")[] = project.brief?.aspects && project.brief.aspects.length > 0
    ? project.brief.aspects
    : [defaultAspect];
  const [viewAspect, setViewAspect] = useState<"16:9" | "9:16" | "1:1">(selectedBriefAspects[0] ?? defaultAspect);
  const drawnAspects = status?.drawnAspects ?? [defaultAspect];
  const drawingAspects = status?.drawingAspects ?? [];
  const isViewAspectDrawn = drawnAspects.includes(viewAspect);
  const isViewAspectDrawing = drawingAspects.includes(viewAspect);

  const selectOrDrawAspect = (asp: "16:9" | "9:16" | "1:1") => {
    wantPlay.current = false;
    videos.current[current]?.pause();
    setViewAspect(asp);
    if (!drawnAspects.includes(asp) && !drawingAspects.includes(asp) && drawn === scenes.length && scenes.length > 0) {
      void drawPlateAspect(project.id, asp).then(setStatus).catch((e) => setError(e instanceof Error ? e.message : "Could not draw this dimension."));
    }
  };
  return <div className="plate-preview" data-aspect={viewAspect}>
    {error && <p className="pp-error" role="alert">{error}</p>}
    {status && !status.available && <p className="pp-error">Code-drawn scenes aren't available for this project right now.</p>}

    <section className="pp-stage" aria-label="Film player" ref={stageRef}>
      <div className="pp-floating-bar" ref={headBarRef} role="toolbar" aria-label="Canvas options">
        {/* Top-level 2-mode switcher: Audio | Subtitle */}
        <div className="pp-mode-tabs" role="tablist" aria-label="Toolbar mode">
          <button
            type="button"
            role="tab"
            aria-selected={barMode === "audio"}
            className={`pp-mode-tab${barMode === "audio" ? " on" : ""}`}
            onClick={() => { setBarMode(barMode === "audio" ? null : "audio"); setOpenMenu(null); }}
          >
            <span className="pp-tool-icon">♫</span>
            <span>Audio</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={barMode === "subtitles"}
            className={`pp-mode-tab${barMode === "subtitles" ? " on" : ""}`}
            onClick={() => { setBarMode(barMode === "subtitles" ? null : "subtitles"); setOpenMenu(null); }}
          >
            <span className="pp-tool-icon">💬</span>
            <span>Subtitle</span>
          </button>
        </div>

        {/* Audio Mode Options (expands bar width, fixed 40px height) */}
        {barMode === "audio" && (
          <>
            <i className="pp-bar-sep" />
            <div className="pp-inline-group" role="group" aria-label="Audio tracks">
              <button type="button" className={`pp-track-chip${voiceOn ? " on" : ""}`} aria-pressed={voiceOn} onClick={toggleVoice} title="Toggle voiceover narration">Voice</button>
              <button type="button" className={`pp-track-chip${musicOn ? " on" : ""}`} aria-pressed={musicOn} onClick={toggleMusic} title="Toggle background music">Music</button>
              <button type="button" className={`pp-track-chip${sfxOn ? " on" : ""}`} aria-pressed={sfxOn} onClick={toggleSfx} title="Toggle key-moment sound effects">SFX</button>
              <button type="button" className={`pp-track-chip${transitionsOn ? " on" : ""}`} aria-pressed={transitionsOn} onClick={toggleTransitions} title="Toggle transition whoosh sounds">Transitions</button>
            </div>
          </>
        )}

        {/* Subtitle Mode Options (expands bar width, fixed 40px height) */}
        {barMode === "subtitles" && (
          <>
            <i className="pp-bar-sep" />

            {/* 1. Subtitle Mode Dropdown */}
            <div className="pp-menu-wrap">
              <button
                type="button"
                className={`pp-pill-item${openMenu === "captions" ? " active" : ""}`}
                aria-expanded={openMenu === "captions"}
                onClick={() => setOpenMenu(openMenu === "captions" ? null : "captions")}
              >
                <span>{subMode === "none" ? "Off" : curModeLabel}</span>
                <span className="pp-caret">▾</span>
              </button>
              {openMenu === "captions" && (
                <div className="pp-dialog pp-dialog-list" role="dialog" aria-label="Subtitle mode">
                  <div className="pp-dialog-head">
                    <b>Subtitle Mode</b>
                    <span>Choose how captions appear on screen</span>
                  </div>
                  {SUBTITLE_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`pp-option-row${subMode === m.id ? " on" : ""}`}
                      onClick={() => { chooseSubMode(m.id); setOpenMenu(null); }}
                    >
                      <div>
                        <b>{m.label}</b>
                        <small>{m.id === "full" ? "Full narrated lines synced to voice" : m.id === "key-phrases" ? "Short key-phrase callouts per beat" : "Hide on-screen subtitles"}</small>
                      </div>
                      {subMode === m.id && <span className="pp-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {subMode !== "none" && (
              <>
                <i className="pp-bar-sep" />

                {/* 2. Visual Style Picker */}
                <div className="pp-menu-wrap">
                  <button
                    type="button"
                    className={`pp-pill-item${openMenu === "style" ? " active" : ""}`}
                    aria-expanded={openMenu === "style"}
                    onClick={() => setOpenMenu(openMenu === "style" ? null : "style")}
                  >
                    <span>{curStyleLabel}</span>
                    <span className="pp-caret">▾</span>
                  </button>
                  {openMenu === "style" && (
                    <div className="pp-dialog pp-dialog-styles" role="dialog" aria-label="Subtitle style">
                      <div className="pp-dialog-head">
                        <b>Subtitle Style</b>
                        <span>Pick a look for your captions</span>
                      </div>
                      <div className="pp-style-grid">
                        {SUBTITLE_STYLES.map((st) => (
                          <button
                            key={st.id}
                            type="button"
                            className={`pp-style-card pp-style-preview-${st.id}${subStyle === st.id ? " on" : ""}`}
                            onClick={() => { chooseSubStyle(st.id); setOpenMenu(null); }}
                          >
                            <span className="pp-style-sample">Sample</span>
                            <small>{st.label}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <i className="pp-bar-sep" />

                {/* 3. Minimal Font Size Stepper */}
                <div className="pp-inline-stepper" role="group" aria-label="Subtitle font size">
                  <button type="button" onClick={() => changeSubSize(-10)} disabled={subSize <= 50} aria-label="Decrease font size" title="Decrease font size">−</button>
                  <span title="Font size scale">{subSize}</span>
                  <button type="button" onClick={() => changeSubSize(10)} disabled={subSize >= 160} aria-label="Increase font size" title="Increase font size">+</button>
                </div>

                <i className="pp-bar-sep" />

                {/* 4. Canva-style Dual Color Circles */}
                <div className="pp-menu-wrap">
                  <button
                    type="button"
                    className={`pp-pill-item pp-pill-swatches${openMenu === "colors" ? " active" : ""}`}
                    aria-expanded={openMenu === "colors"}
                    aria-label="Subtitle colors"
                    title="Text &amp; Box colors"
                    onClick={() => setOpenMenu(openMenu === "colors" ? null : "colors")}
                  >
                    <i className="pp-circle-swatch" style={{ background: effectiveTextColor }} />
                    <i className="pp-circle-swatch" style={{ background: effectiveBgColor }} />
                  </button>
                  {openMenu === "colors" && (
                    <div className="pp-dialog pp-dialog-colors" role="dialog" aria-label="Colors">
                      <div className="pp-dialog-head">
                        <b>Subtitle Colors</b>
                        <span>Text and box colors</span>
                      </div>
                      <div className="pp-dialog-section">
                        <div className="pp-sec-label"><span>Text Color</span><code>{effectiveTextColor}</code></div>
                        <div className="pp-swatches">
                          {["#ffffff", "#fef08a", "#facc15", "#7dd3fc", "#fca5a5", "#231f1b", "#0b0d12"].map((hex) => (
                            <button key={hex} type="button" className={`pp-swatch${effectiveTextColor.toLowerCase() === hex ? " on" : ""}`} style={{ background: hex }} onClick={() => changeSubColor(hex)} aria-label={`Text color ${hex}`} />
                          ))}
                          <label className="pp-swatch pp-swatch-custom" title="Custom text color">
                            <span>+</span>
                            <input type="color" value={effectiveTextColor} onChange={(e) => changeSubColor(e.target.value)} />
                          </label>
                        </div>
                      </div>
                      <div className="pp-dialog-section">
                        <div className="pp-sec-label"><span>Box / Outline Color</span><code>{effectiveBgColor}</code></div>
                        <div className="pp-swatches">
                          {["#0c0f16", "#faf5e8", "#facc15", "#0c2a4a", "#1e293b", "#451a03", "#3b0764"].map((hex) => (
                            <button key={hex} type="button" className={`pp-swatch${effectiveBgColor.toLowerCase() === hex ? " on" : ""}`} style={{ background: hex }} onClick={() => changeSubBgColor(hex)} aria-label={`Box color ${hex}`} />
                          ))}
                          <label className="pp-swatch pp-swatch-custom" title="Custom box color">
                            <span>+</span>
                            <input type="color" value={effectiveBgColor} onChange={(e) => changeSubBgColor(e.target.value)} />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <i className="pp-bar-sep" />

                {/* 5. Canva-style Checkerboard Transparency Button */}
                <div className="pp-menu-wrap">
                  <button
                    type="button"
                    className={`pp-pill-item pp-pill-icon${openMenu === "opacity" ? " active" : ""}`}
                    aria-expanded={openMenu === "opacity"}
                    aria-label="Transparency"
                    title={`Subtitle transparency (${subOpacity}%)`}
                    onClick={() => setOpenMenu(openMenu === "opacity" ? null : "opacity")}
                  >
                    <span className="pp-checker-icon" aria-hidden="true" />
                  </button>
                  {openMenu === "opacity" && (
                    <div className="pp-dialog pp-dialog-opacity" role="dialog" aria-label="Transparency">
                      <div className="pp-sec-label"><span>Transparency</span><b>{subOpacity}%</b></div>
                      <input
                        type="range"
                        className="pp-range"
                        min={20}
                        max={100}
                        step={5}
                        value={subOpacity}
                        onChange={(e) => setSubOpacityDirect(Number(e.target.value))}
                        aria-label="Subtitle opacity"
                      />
                    </div>
                  )}
                </div>

                <i className="pp-bar-sep" />

                {/* 6. Subtitle Position Dropdown (for current Scene) */}
                <div className="pp-menu-wrap">
                  <button
                    type="button"
                    className={`pp-pill-item${openMenu === "position" ? " active" : ""}`}
                    aria-expanded={openMenu === "position"}
                    onClick={() => setOpenMenu(openMenu === "position" ? null : "position")}
                  >
                    <span>Position</span>
                    <span className="pp-caret">▾</span>
                  </button>
                  {openMenu === "position" && (
                    <div className="pp-dialog pp-dialog-pos" role="dialog" aria-label={`Scene ${current + 1} subtitle position`}>
                      <div className="pp-dialog-head">
                        <b>Subtitle Position · Scene {current + 1}</b>
                        <span>Align Scene {current + 1}&apos;s subtitle or drag it on the video</span>
                      </div>
                      <div className="pp-dialog-section">
                        <div className="pp-sec-label"><span>Align (Scene {current + 1})</span></div>
                        <div className="pp-pos-grid">
                          <button type="button" className={Math.abs(curScenePos.y - 16) <= 6 ? "on" : ""} onClick={() => setSceneSubtitlePos(current, { x: curScenePos.x, y: 16 })}>⬆ Top</button>
                          <button type="button" className={Math.abs(curScenePos.y - 50) <= 6 ? "on" : ""} onClick={() => setSceneSubtitlePos(current, { x: curScenePos.x, y: 50 })}>↕ Middle</button>
                          <button type="button" className={Math.abs(curScenePos.y - 88) <= 6 ? "on" : ""} onClick={() => setSceneSubtitlePos(current, { x: curScenePos.x, y: 88 })}>⬇ Bottom</button>
                          <button type="button" className={Math.abs(curScenePos.x - 24) <= 6 ? "on" : ""} onClick={() => setSceneSubtitlePos(current, { x: 24, y: curScenePos.y })}>⬅ Left</button>
                          <button type="button" className={Math.abs(curScenePos.x - 50) <= 6 ? "on" : ""} onClick={() => setSceneSubtitlePos(current, { x: 50, y: curScenePos.y })}>↔ Center</button>
                          <button type="button" className={Math.abs(curScenePos.x - 76) <= 6 ? "on" : ""} onClick={() => setSceneSubtitlePos(current, { x: 76, y: curScenePos.y })}>➡ Right</button>
                        </div>
                      </div>
                      <div className="pp-dialog-section">
                        <div className="pp-sec-label"><span>Vertical offset (Y)</span><b>{Math.round(curScenePos.y)}%</b></div>
                        <input
                          type="range"
                          className="pp-range"
                          min={8}
                          max={92}
                          step={1}
                          value={Math.round(curScenePos.y)}
                          onChange={(e) => setSceneSubtitlePos(current, { x: curScenePos.x, y: Number(e.target.value) })}
                        />
                      </div>
                      <div className="pp-dialog-foot">
                        <button type="button" className="pp-foot-btn" onClick={() => applyPosToAllScenes(curScenePos)}>Apply to all scenes</button>
                        <button type="button" className="pp-foot-btn" onClick={resetSubCustomization}>Reset all</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {(busy || failed > 0 || (scenes.length > 0 && drawn < scenes.length)) && (
          <>
            <i className="pp-bar-sep" />
            <span className="pp-mini-status">{drawn}/{scenes.length || "…"} drawn{busy ? "…" : ""}</span>
            {!busy && <button type="button" className="pp-pill-item" onClick={() => { void drawPlates(project.id).then(setStatus).catch((e) => setError(e instanceof Error ? e.message : "Could not start drawing.")); }}>Retry</button>}
          </>
        )}
      </div>
      <div className="pp-frame">
        {/* Left-middle floating vertical sliding pill for selecting/drawing dimensions */}
        <div
          ref={dimRailRef}
          className={`pp-dim-rail${dimOpen ? " open" : ""}`}
          role="group"
          aria-label="Canvas dimensions"
        >
          <button
            type="button"
            className="pp-dim-trigger"
            aria-expanded={dimOpen}
            onClick={() => setDimOpen((prev) => !prev)}
            title="Click to open dimensions (16:9, 9:16, 1:1)"
          >
            <i className={`pp-dim-shape pp-dim-${viewAspect.replace(":", "x")}`} />
            <span>{viewAspect}</span>
            <small className="pp-dim-caret">{dimOpen ? "▴" : "▾"}</small>
          </button>
          <div className="pp-dim-drawer" aria-hidden={!dimOpen}>
            {(["16:9", "9:16", "1:1"] as const).map((asp) => {
              const isDrawn = drawnAspects.includes(asp);
              const isDrawing = drawingAspects.includes(asp);
              const isActive = viewAspect === asp;
              return (
                <button
                  key={asp}
                  type="button"
                  className={`pp-dim-option${isActive ? " on" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => {
                    selectOrDrawAspect(asp);
                  }}
                  title={isDrawn ? `Switch to drawn ${asp} canvas` : isDrawing ? `Drawing ${asp} canvas…` : `Draw & preview ${asp} canvas`}
                >
                  <i className={`pp-dim-shape pp-dim-${asp.replace(":", "x")}`} />
                  <span>{asp}</span>
                  <small>{isDrawing ? "⏳" : isDrawn ? "✓" : "+"}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="pp-canvas" ref={canvasRef} onClick={toggle}>
          {isViewAspectDrawn && scenes.map((scene) => {
            if (scene.state !== "drawn") return null;
            const clipSrc = plateClipUrl(project.id, scene.index, `${scene.variants?.[viewAspect]?.v ?? scene.sig}-${scene.rev ?? 0}-${viewAspect}`, viewAspect);
            return (
            <video
              key={`${scene.index}-${clipSrc}`}
              ref={(el) => { videos.current[scene.index] = el; }}
              className={scene.index === current ? "on" : ""}
              src={clipSrc}
              preload="auto"
              muted
              playsInline
              onLoadedData={() => onLoaded(scene.index)}
              // A clip that failed to load (a hiccup while the link was being made) is asked for again, twice, instead of staying black.
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
                // HTML5 <video> fires `pause` right before `ended` when it reaches the end of the clip; do not cut off an active voiceover.
                if (!wantPlay.current || !e.currentTarget.ended) {
                  voices.current[scene.index]?.pause();
                }
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
            />
            );
          })}
          {(shown?.state !== "drawn" || !isViewAspectDrawn) && (
            <div className="pp-wait">{shown?.state === "failed" ? <><b>This scene didn't draw</b><span>{shown.error}</span></> : isViewAspectDrawing || (shown?.state === "drawn" && !isViewAspectDrawn) ? <><i className="pp-spin" /><b>Drawing scenes in {viewAspect}…</b><span>Drawing every scene on a {viewAspect} canvas so no character is cropped</span></> : prep === "sound" ? <><i className="pp-spin" /><b>Making the voiceover and music…</b><span>Recording the narration and building the music bed</span></> : prep === "scenes" ? <><i className="pp-spin" /><b>Planning the scenes…</b><span>Preparing the storyboard timing</span></> : <><i className="pp-spin" /><b>{shown ? `${LABEL[shown.state]}…` : "Preparing the scenes…"}</b><span>Scene {(shown?.index ?? 0) + 1} of {scenes.length || "…"}</span></>}</div>
          )}
          {shown?.state === "drawn" && isViewAspectDrawn && activeCue && (
            <div
              className={`pp-subtitle pp-sub-${subStyle}`}
              aria-live="polite"
              title={`Drag to move Scene ${current + 1}'s subtitle anywhere on the screen`}
              style={{
                left: `${curScenePos.x}%`,
                top: `${curScenePos.y}%`,
                opacity: subOpacity / 100,
                "--sub-scale": String(subSize / 100)
              } as React.CSSProperties}
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
            </div>
          )}
        </div>
        {voiceTakes.map((take, idx) => take ? (
          <audio
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
          />
        ) : null)}
        {musicSrc && <audio ref={musicAudio} src={musicSrc} muted={!musicOn || muted} loop preload="auto" />}
        {SFX_NAMES.flatMap((sfxName) => [0, 1].map((slot) => (
          <audio key={`${sfxName}:${slot}`} ref={(el) => { sfxAudios.current[`${sfxName}:${slot}`] = el; }} src={planSfxUrl(sfxName)} muted={muted} preload="auto" />
        )))}
      </div>
      <div className="pp-controls">
        <button type="button" className="pp-play" onClick={toggle} disabled={shown?.state !== "drawn" || !isViewAspectDrawn} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <span className="pp-clock"><b>{clock(time)}</b> / {clock(total)}</span>
        <span className="pp-scene">{shown ? `Scene ${shown.index + 1} · ${shown.keyword}` : ""}</span>
        <span className="pp-options">
          <button type="button" className="pp-opt" onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>{muted || master === 0 ? "🔇" : master < 0.5 ? "🔉" : "🔊"}</button>
          <input className="pp-volume" type="range" min={0} max={1} step={0.05} value={muted ? 0 : master} aria-label="Volume" onChange={(e) => { const v = Number(e.target.value); setMaster(v); setMuted(v === 0); }} />
          <button type="button" className="pp-opt" onClick={() => { const el = stageRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }} aria-label="Full screen">⛶</button>
        </span>
      </div>
      <div className="pp-track" ref={track} role="slider" tabIndex={0} aria-label="Film timeline" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(time)} aria-valuetext={clock(time)}
        onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(at(e)); }}
        onPointerMove={(e) => { if (drag.current) seek(at(e)); }}
        onPointerUp={() => { drag.current = false; }}
        onKeyDown={(e) => { if (e.key === "ArrowRight") seek(time + 1); else if (e.key === "ArrowLeft") seek(time - 1); else if (e.key === " ") { e.preventDefault(); toggle(); } }}>
        <ol className="pp-segments">{scenes.map((scene) => <li key={scene.index} className={`${scene.state}${scene.index === current ? " on" : ""}`} style={{ flexGrow: durations[scene.index] ?? scene.seconds }} title={`${scene.keyword} · ${LABEL[scene.state]}`}><small>{String(scene.index + 1).padStart(2, "0")}</small><span>{scene.keyword}</span></li>)}</ol>
        <i className="pp-fill" style={{ width: `${total ? (time / total) * 100 : 0}%` }} />
        <i className="pp-head-line" style={{ left: `${total ? (time / total) * 100 : 0}%` }} />
        {comments.map((comment) => <b key={comment.id} className="pp-pin" style={{ left: `${total ? (comment.at / total) * 100 : 0}%` }} title={`${clock(comment.at)} · ${comment.body}`} />)}
      </div>
    </section>

    <div className="pp-right-col">
      {onRender && (
        <button
          type="button"
          className="primary-button pp-render-top"
          disabled={busy || Boolean(rendering) || scenes.length === 0 || drawn < scenes.length}
          onClick={() => { wantPlay.current = false; videos.current[current]?.pause(); onRender(); }}
        >
          <span>{rendering ? "Rendering…" : "Render"}</span>
          {cost != null && !rendering && <small>{cost} tokens</small>}
        </button>
      )}
      <aside className="pp-side" aria-label="Comments">
        <header><b>Comments</b><span>{comments.length ? `${comments.length}` : ""}</span></header>
        <div className="pp-at"><span>At {clock(time)}</span>{shown && <span>Scene {shown.index + 1} · {shown.keyword}</span>}</div>
        <div className="pp-compose">
          <textarea value={draft} maxLength={600} rows={3} placeholder="What should change here? e.g. the girl should look up, make the sun bigger" aria-label="Comment" onFocus={() => { wantPlay.current = false; videos.current[current]?.pause(); }} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void add(); }} />
          <button className="primary-button" disabled={!draft.trim() || sending || drawn === 0} onClick={() => void add()}>Add</button>
        </div>
        <ul className="pp-comments">{comments.length === 0 && <li className="empty">Comments you add are pinned to this moment of the film.</li>}{comments.map((comment) => <li key={comment.id}><button type="button" className="pp-time" onClick={() => seek(comment.at)} title="Go to this moment">{clock(comment.at)}</button><p>{comment.body}<small>Scene {comment.scene + 1}</small></p><button type="button" className="pp-x" aria-label="Remove comment" onClick={() => void remove(comment.id)}>×</button></li>)}</ul>
        <button className="primary-button pp-apply" disabled={!comments.length || busy} onClick={() => void apply()}>{busy ? "Drawing…" : comments.length ? `Redraw scene${comments.length && new Set(comments.map((c) => c.scene)).size > 1 ? "s" : ""} ${redraws}` : "Redraw with comments"}</button>
        <p className="pp-note">Only the scenes you comment on are redrawn.</p>
      </aside>
    </div>
  </div>;
}

/**
 * Downloads of the other selected ratios (the primary ratio is the final render itself). Each is assembled on the render worker
 * (free): this asks once per ratio and follows it until it is ready.
 */
export function PlateExports({ project }: { project: VideoProject }) {
  useMediaToken();
  const primary: PlateAspect = project.brief?.aspect === "1:1" ? "1:1" : project.request.format === "portrait" || project.brief?.aspect === "9:16" ? "9:16" : "16:9";
  const [ratios, setRatios] = useState<PlateAspect[]>([]);
  const [exports, setExports] = useState<Partial<Record<PlateAspect, PlateExportState>>>({});
  useEffect(() => {
    let live = true;
    getPlates(project.id).then((st) => { if (live) setRatios([...new Set([...(st.subtitles?.aspects ?? []), ...(st.drawnAspects ?? [])])].filter((a) => a !== primary)); }).catch(() => undefined);
    return () => { live = false; };
  }, [project.id, primary]);
  const key = ratios.join(",");
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
          // A hiccup is retried; only a repeated failure is shown.
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
  if (!ratios.length) return null;
  return <div className="pp-exports" role="group" aria-label="Other ratios" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "8px 24px", justifyContent: "center" }}>
    {ratios.map((ratio) => exports[ratio]?.state === "ready"
      ? <a key={ratio} className="ce-download" href={plateExportUrl(project.id, ratio)} download={`${project.id}-${ratio.replace(":", "x")}.mp4`}>Download {ratio}</a>
      : <span key={ratio} className="ce-download" role="status" aria-busy={exports[ratio]?.state !== "failed"}>
        {exports[ratio]?.state === "failed" ? `${ratio}: ${exports[ratio]?.error ?? "Could not prepare the video."}` : `Preparing ${ratio}${exports[ratio]?.progress ? ` ${exports[ratio]?.progress}%` : "…"}`}
      </span>)}
  </div>;
}
