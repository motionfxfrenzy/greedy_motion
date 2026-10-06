import { currentTake, type BeatPlan, type PlanAudio } from "@videosaas/contracts";
import { actionSeconds, engineKind, typedText, type PlanTiming } from "./timing.ts";

/**
 * The plan's soundtrack as HyperFrames <audio> tracks: the voiceover takes on the clock, the music
 * bed ducked only under words, and SFX on the events the engine animates. The same tags go into the
 * live storyboard page and the render, so the preview sounds like the film.
 *
 * Restraint rules (shared-craft → audio, media-use → sfx): SFX sit under voice and music (~0.35),
 * one sound per event, no two cut sounds within 1.2 s, and nothing on a cut the voice already carries.
 */
export const SOUND_RULES = {
  tracks: { music: 10, voice: 12, sfx: 13 },
  music: { withVoice: 0.5, underWords: 0.17, alone: 0.82, fadeIn: 0.4, fadeOut: 1.2, duckDown: 0.15, duckUp: 0.4, mergeGap: 0.8, loopCrossfade: 1.0 },
  cutSpacing: 1.2
} as const;

/** The shipped library (worker/templates/beat-plan/sfx): length and the point in the file that lands on the event. */
export const SFX = {
  "whoosh-short": { duration: 0.57, sync: 0.155, volume: 0.3 },
  click: { duration: 0.37, sync: 0.024, volume: 0.42 },
  pop: { duration: 0.72, sync: 0.094, volume: 0.3 },
  chime: { duration: 2.5, sync: 0.407, volume: 0.32 },
  typing: { duration: 1.5, sync: 0.443, volume: 0.26 },
  "impact-bass-1": { duration: 2.12, sync: 0.024, volume: 0.3 }
} as const;
export type SfxName = keyof typeof SFX;

export type SfxCue = { name: SfxName; beat: string; event: "cut" | "action" | "result" | "success" | "hook" | "cta"; at: number; length?: number };

export type AudioTrack = {
  id: string;
  src: string;
  start: number;
  duration: number;
  track: number;
  volume: number;
  /** Offset into the file (data-media-start). */
  mediaStart?: number;
  automation?: { t: number; v: number }[];
};

const round = (value: number) => Math.round(value * 1000) / 1000;
const MOVING_CUTS = new Set(["whip", "push-through", "brand-field-wipe"]);

/** When the engine shows a UI action's result (mirrors uiBeat in engine.js). */
function actionDone(beat: BeatPlan["beats"][number], actAt: number): number {
  switch (beat.ui?.action) {
    case "type": return actAt + 0.12 + Math.min(1.4, Math.max(0.5, typedText(beat).length / 22)) + 0.2;
    case "toggle": return actAt + 0.35;
    case "count": return actAt + 0.9;
    case "scroll": return actAt + 1.0;
    case "drag": return actAt + 0.85;
    case "select": return actAt + 0.6;
    default: return actAt + 0.3;
  }
}

/**
 * Where each sound lands, from the plan clock. `hasShot` says whether a UI beat's screenshot exists
 * (the engine draws a UI beat without one as kinetic, so it gets no click).
 */
export function sfxCues(plan: BeatPlan, timing: PlanTiming, hasShot: (screenId: string) => boolean): SfxCue[] {
  const cues: SfxCue[] = [];
  const times = new Map(timing.beats.map((beat) => [beat.id, beat]));
  const last = plan.beats.length - 1;
  const kinds = plan.beats.map((beat, i) => {
    let kind = engineKind(beat);
    if (kind === "ui" && !(beat.ui && hasShot(beat.ui.screen))) kind = "kinetic";
    if (i === last && beat.role === "cta" && kind === "kinetic") kind = "title";
    return kind;
  });
  const hasUi = kinds.includes("ui");
  let lastCut = -Infinity;
  plan.beats.forEach((beat, i) => {
    const time = times.get(beat.id);
    if (!time) return;
    const kind = kinds[i];
    if (i === 0 && beat.energy === "high" && kind === "kinetic") cues.push({ name: "impact-bass-1", beat: beat.id, event: "hook", at: time.start + 0.05 });
    if (kind === "ui" && time.actAt !== null) {
      const action = beat.ui?.action;
      if (action === "type") cues.push({ name: "typing", beat: beat.id, event: "action", at: time.actAt + 0.12, length: Math.min(1.4, Math.max(0.5, typedText(beat).length / 22)) + 0.1 });
      else cues.push({ name: "click", beat: beat.id, event: "action", at: time.actAt });
      if (action === "count" || action === "toggle") cues.push({ name: "pop", beat: beat.id, event: "result", at: actionDone(beat, time.actAt) - 0.05 });
      if (beat.success && time.successAt !== null) cues.push({ name: "chime", beat: beat.id, event: "success", at: Math.max(time.successAt, actionDone(beat, time.actAt) + 0.3) + 0.05 });
    } else if (beat.success && time.successAt !== null) {
      cues.push({ name: "chime", beat: beat.id, event: "success", at: time.successAt + 0.05 });
    }
    // The CTA press (mirrors titleBeat: only after a UI beat, and only when the lockup holds ≥ 2.2 s).
    if (kind === "title" && hasUi && time.end - time.start >= 2.2) {
      cues.push({ name: "click", beat: beat.id, event: "cta", at: Math.min(time.end - 0.9, Math.max(time.start + 1.3, time.vo ? time.vo.start + 0.4 : time.start + 1.3)) });
    }
    // A moving cut gets a whoosh peaking on the cut; a cut the voice carries (j-cut, match-cut) stays clean.
    const cut = time.end;
    const named = beat.sfx && /whoosh|swoosh|swipe/i.test(beat.sfx);
    if (i < last && (MOVING_CUTS.has(beat.transition_out.type) || named) && cut - lastCut >= SOUND_RULES.cutSpacing) {
      cues.push({ name: "whoosh-short", beat: beat.id, event: "cut", at: cut });
      lastCut = cut;
    }
  });
  return cues.sort((a, b) => a.at - b.at);
}

/** A lane's level at `t` (linear between points, as HyperFrames plays it). */
export function levelAt(lane: { t: number; v: number }[], t: number): number {
  if (!lane.length) return 0;
  if (t <= lane[0].t) return lane[0].v;
  for (let i = 1; i < lane.length; i++) {
    if (t <= lane[i].t) return lane[i - 1].v + ((lane[i].v - lane[i - 1].v) * (t - lane[i - 1].t)) / Math.max(1e-6, lane[i].t - lane[i - 1].t);
  }
  return lane[lane.length - 1].v;
}

/** The music bed's volume lane: up between lines, down only under words, faded in and out. */
export function duckLane(total: number, speech: { start: number; end: number }[]): { t: number; v: number }[] {
  const M = SOUND_RULES.music;
  if (!speech.length) return [{ t: 0, v: 0 }, { t: M.fadeIn, v: M.alone }, { t: Math.max(M.fadeIn, total - M.fadeOut), v: M.alone }, { t: total, v: 0 }];
  const windows: { start: number; end: number }[] = [];
  for (const span of [...speech].sort((a, b) => a.start - b.start)) {
    const prev = windows[windows.length - 1];
    if (prev && span.start - prev.end < M.mergeGap) prev.end = Math.max(prev.end, span.end);
    else windows.push({ ...span });
  }
  const base = M.withVoice;
  const level = (t: number) => windows.some((w) => t >= w.start - M.duckDown && t <= w.end + M.duckUp) ? M.underWords : base;
  const points: { t: number; v: number }[] = [{ t: 0, v: 0 }, { t: M.fadeIn, v: level(M.fadeIn) }];
  for (const w of windows) {
    points.push({ t: w.start - M.duckDown, v: base }, { t: w.start, v: M.underWords }, { t: w.end + 0.1, v: M.underWords }, { t: w.end + M.duckUp, v: base });
  }
  const fadeAt = Math.max(M.fadeIn, total - M.fadeOut);
  points.push({ t: fadeAt, v: level(fadeAt) === base ? base : M.underWords }, { t: total, v: 0 });
  // Keep the lane strictly increasing inside [0, total]; a later point at the same instant wins.
  const lane: { t: number; v: number }[] = [];
  for (const point of points.filter((p) => p.t >= 0 && p.t <= total).sort((a, b) => a.t - b.t)) {
    const t = round(point.t);
    if (lane.length && t - lane[lane.length - 1].t < 0.02) lane[lane.length - 1] = { t: lane[lane.length - 1].t, v: point.v };
    else lane.push({ t, v: point.v });
  }
  // Inside the fades, the fade wins over the duck.
  return lane.map((p) => (p.t < M.fadeIn ? { t: p.t, v: Math.min(p.v, (p.t / M.fadeIn) * base) } : p.t > fadeAt ? { t: p.t, v: Math.min(p.v, ((total - p.t) / M.fadeOut) * base) } : p));
}

export type SoundInputs = {
  plan: BeatPlan;
  timing: PlanTiming;
  audio: PlanAudio | null | undefined;
  /** URL (preview) or project-relative path (render) for a plan-audio file (`vo/…`, `music/…`). */
  fileUrl: (file: string) => string;
  sfxUrl: (name: SfxName) => string;
  hasShot: (screenId: string) => boolean;
  /** The brief's audio mode; SFX play with any mode except "none". */
  mode: "voiceover" | "music" | "both" | "none";
};

/** Every <audio> track for the film; empty when the brief asks for no sound. */
export function soundTracks(input: SoundInputs): { tracks: AudioTrack[]; cues: SfxCue[] } {
  const { plan, timing, audio } = input;
  if (input.mode === "none") return { tracks: [], cues: [] };
  const tracks: AudioTrack[] = [];
  const total = timing.total;
  const speech: { start: number; end: number }[] = [];
  const voiced = input.mode === "voiceover" || input.mode === "both";
  if (voiced) {
    for (const beat of plan.beats) {
      const time = timing.beats.find((item) => item.id === beat.id);
      const take = currentTake(audio, beat);
      if (!time?.vo || !take) continue;
      const duration = round(Math.min(take.seconds, total - time.vo.start));
      if (duration <= 0) continue;
      tracks.push({ id: `vo-${beat.id}`, src: input.fileUrl(take.file), start: time.vo.start, duration, track: SOUND_RULES.tracks.voice, volume: 1 });
      speech.push({ start: time.vo.start, end: time.vo.start + duration });
    }
  }
  const music = audio?.music && (input.mode === "music" || input.mode === "both") ? audio.music : null;
  if (music && music.seconds > 1) {
    const lane = duckLane(total, speech);
    if (music.seconds >= total) {
      tracks.push({ id: "music-bed", src: input.fileUrl(music.file), start: 0, duration: round(total), track: SOUND_RULES.tracks.music, volume: 1, automation: lane });
    } else {
      // A bed shorter than the film plays twice: the first copy fades out as the second fades in.
      const x = Math.min(SOUND_RULES.music.loopCrossfade, music.seconds / 4);
      const join = music.seconds - x;
      const firstLane = [...lane.filter((p) => p.t < join), { t: round(join), v: levelAt(lane, join) }, { t: round(music.seconds), v: 0 }];
      const secondLane = [{ t: 0, v: 0 }, { t: round(x), v: levelAt(lane, join + x) }, ...lane.filter((p) => p.t > join + x).map((p) => ({ t: round(p.t - join), v: p.v }))];
      tracks.push({ id: "music-bed", src: input.fileUrl(music.file), start: 0, duration: round(music.seconds), track: SOUND_RULES.tracks.music, volume: 1, automation: firstLane });
      tracks.push({ id: "music-bed-2", src: input.fileUrl(music.file), start: round(join), duration: round(total - join), track: SOUND_RULES.tracks.music + 1, volume: 1, automation: secondLane });
    }
  }
  const cues = sfxCues(plan, timing, input.hasShot);
  const lanes: number[] = [];
  cues.forEach((cue, i) => {
    const sfx = SFX[cue.name];
    const start = cue.at - sfx.sync;
    const mediaStart = start < 0 ? -start : 0;
    const begin = Math.max(0, start);
    const duration = Math.min(cue.length ?? sfx.duration - mediaStart, sfx.duration - mediaStart, total - begin);
    if (duration < 0.05) return;
    let lane = lanes.findIndex((busyUntil) => busyUntil <= begin);
    if (lane < 0) lane = lanes.push(0) - 1;
    lanes[lane] = begin + duration;
    tracks.push({ id: `sfx-${i + 1}-${cue.name}`, src: input.sfxUrl(cue.name), start: round(begin), duration: round(duration), track: SOUND_RULES.tracks.sfx + lane, volume: sfx.volume, ...(mediaStart ? { mediaStart: round(mediaStart) } : {}) });
  });
  return { tracks, cues };
}

const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The tracks as one line of HyperFrames <audio> elements (inserted inside #root). */
export function audioTags(tracks: AudioTrack[]): string {
  return tracks.map((track) => {
    const lane = track.automation ? ` data-automation="${attr(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: track.automation }] }))}"` : "";
    const media = track.mediaStart ? ` data-media-start="${track.mediaStart}"` : "";
    return `<audio id="${attr(track.id)}" src="${attr(track.src)}" data-start="${track.start}" data-duration="${track.duration}"${media} data-track-index="${track.track}" data-volume="${track.volume}"${lane}></audio>`;
  }).join("");
}

/** Inserts the soundtrack right after the root element opens. */
export function withSoundtrack(html: string, tracks: AudioTrack[]): string {
  if (!tracks.length) return html;
  const rootOpen = /<div id="root"[^>]*>/.exec(html);
  if (!rootOpen) throw new Error("The beat-plan template has no #root element for audio.");
  return html.replace(rootOpen[0], () => `${rootOpen[0]}\n    ${audioTags(tracks)}`);
}
