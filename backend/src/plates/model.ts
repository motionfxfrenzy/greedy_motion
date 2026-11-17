import { createHash } from "node:crypto";
import { voiceText, type ScriptBeat, type VideoProject } from "@videosaas/contracts";
import { SCENE_SOUND_KINDS, templatePack, type SceneSoundKind } from "../plan/template-packs.ts";

/**
 * Plate scenes, pure part: types, subtitle settings, sound-effect cues, the timeline and the cache signatures. Nothing here
 * touches the database, the network or the disk, so every rule that decides what is redrawn or re-assembled is unit-tested
 * (backend/test/plate-model.mjs).
 */

export const FPS = 30;
export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECTS: readonly Aspect[] = ["16:9", "9:16", "1:1"];
export const isAspect = (value: unknown): value is Aspect => typeof value === "string" && (ASPECTS as readonly string[]).includes(value);
export const sizeForAspect = (aspect?: string) => aspect === "9:16" ? { w: 1080, h: 1920, label: "1080x1920 (9:16 portrait)" } : aspect === "1:1" ? { w: 1080, h: 1080, label: "1080x1080 (1:1 square)" } : { w: 1920, h: 1080, label: "1920x1080 (16:9)" };
export const aspectSlug = (aspect: string) => aspect === "9:16" ? "9x16" : aspect === "1:1" ? "1x1" : "16x9";
/** The ratio a project previews and exports by default. */
export const primaryAspect = (project: VideoProject | null | undefined): Aspect => (project?.brief?.aspect ?? (project?.request?.format === "portrait" ? "9:16" : "16:9")) as Aspect;

/**
 * Bump when a change to authoring, bundling or rendering means every stored scene should be drawn again. Signatures start
 * with `v<PIPELINE_VERSION>:`; a stored scene signed by an older pipeline version is never reused (a one-time invalidation:
 * the migration to worker rendering moved every artifact to object storage, and legacy files were never uploaded).
 */
export const PIPELINE_VERSION = 3;
export const SIGNATURE_PREFIX = `v${PIPELINE_VERSION}:`;
/** Bump when the final assembly (worker/src/plates.mjs) produces different bytes from the same inputs. */
export const ASSEMBLER_VERSION = 3;

export type LiveMode = "live" | "clip";
export type PlateState = "queued" | "authoring" | "bundled" | "checked" | "rendering" | "drawn" | "failed";
/** The stored state: `bundled` (authored, waiting for a worker in clip mode or a browser check in live mode). */
export type VariantState = PlateState;
export type ProgressStage = "waiting" | "writing" | "checking" | "drawing" | "ready" | "failed";
export type EtaRange = { low: number; high: number };
export type SceneRetrying = { attempt: number; reason: string };
export type SceneProgress = {
  stage: ProgressStage;
  written?: { chars: number; lines: number; tokens: number };
  fraction?: number;
  elapsedMs?: number;
  etaSeconds?: EtaRange | null;
  attempt?: number;
  retrying?: SceneRetrying;
};
export type FilmProgress = {
  total: number;
  written: number;
  checked: number;
  drawn: number;
  failed: number;
  etaSeconds: EtaRange | null;
  typicalSceneSeconds: EtaRange;
};
export type PlateVariantView = {
  state: PlateState;
  sig: string;
  /** Changes whenever the stored clip changes, so the browser fetches the new one. */
  v: string | null;
  gen?: number;
  rev?: number;
  stage?: string;
  error?: string;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  createdAt?: string;
  updatedAt?: string;
  frames?: number | null;
  framesDone?: number | null;
  authorMs?: number;
  drawnAt?: string | null;
  progress?: SceneProgress;
  retrying?: SceneRetrying;
  /** "clip" when the scene was too slow to draw live and plays from a worker clip (absent = plays live). */
  playback?: "clip";
  /** Median measured draw cost in ms per frame, set with playback. */
  drawMsPerFrame?: number;
  /** True when the stored variant was authored for an older script/style revision and does not match the current storyboard. */
  stale?: boolean;
  /** True when the variant needs reconciliation (either stale or shifted/reordered index). */
  needsReconcile?: boolean;
  /** A template pack's scene sounds (`export const sounds` in this variant's module), when the pack has sceneSounds. */
  sounds?: SceneSound[];
};
export type PlateScene = {
  index: number;
  keyword: string;
  state: PlateState;
  seconds: number;
  /** Whole frames at FPS: the unit scene boundaries are measured in, in the preview and in the export. */
  frames: number;
  framesDone?: number | null;
  sig: string;
  gen?: number;
  /** Bumped when the scene is redrawn from comments, so the browser fetches the new clip. */
  rev?: number;
  stage?: string;
  error?: string;
  attempts?: number;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  createdAt?: string;
  updatedAt?: string;
  authorMs?: number;
  drawnAt?: string | null;
  progress?: SceneProgress;
  /** Set while the server is retrying this scene (worker restarted, check did not report). Read from timings.retrying. */
  retrying?: SceneRetrying;
  /** "clip" when the scene was too slow to draw live and plays from a worker clip (absent = plays live). */
  playback?: "clip";
  /** Median measured draw cost in ms per frame, set with playback. */
  drawMsPerFrame?: number;
  /** True when the scene has no compatible variant for the current script/style revision and requires a redraw. */
  stale?: boolean;
  /** True when the scene needs reconciliation (either stale or shifted/reordered index). */
  needsReconcile?: boolean;
  /** A template pack's scene sounds of the primary-ratio variant (see PlateVariantView.sounds). */
  sounds?: SceneSound[];
  /** Per aspect ratio: each ratio is authored, verified and drawn on its own. */
  variants?: Partial<Record<Aspect, PlateVariantView>>;
};
/** A comment on the film: `at` is film time in seconds, `scene`/`sceneAt` where that falls (the scene is what gets redrawn). */
export type PlateComment = { id: string; at: number; scene: number; sceneAt: number; body: string };
export type SubtitleMode = "none" | "key-phrases" | "full";
export type SubtitleStyle = "pill" | "cinema" | "kinetic" | "paper" | "blueprint" | "shadow";
export type PlateSubtitles = {
  mode: SubtitleMode;
  style: SubtitleStyle;
  /** Font size scale in percent (50..160, default 100). */
  size?: number;
  /** Subtitle opacity in percent (20..100, default 100). */
  opacity?: number;
  /** Custom text hex color (#rrggbb). */
  color?: string;
  /** Custom background hex color (#rrggbb). */
  bgColor?: string;
  /** Default horizontal center position as percent of canvas width (8..92, default 50). */
  x?: number;
  /** Default vertical center position as percent of canvas height (8..92, default 88). */
  y?: number;
  /** Per-scene subtitle position overrides keyed by scene index ("0", "1", ...). */
  scenePositions?: Record<string, { x: number; y: number }>;
  /** Spoken words per cue in "full" mode, timed from the voiceover's word times (1 = one word at a time). Absent = 6-word chunks. */
  wordsPerCue?: number;
  /** Whether voiceover narration is enabled (default true). */
  voice?: boolean;
  /** Whether background music is enabled (default true). */
  music?: boolean;
  /** Whether sound effects (SFX) are enabled alongside voice and music (default true). */
  sfx?: boolean;
  /** Whether scene transition whoosh sounds are enabled (default false). */
  transitions?: boolean;
  /** Dimensions checked by the user to draw at the canvas level ("16:9", "9:16", "1:1"). */
  aspects?: ("16:9" | "9:16" | "1:1")[];
};
export type PlateStatus = {
  available: boolean;
  look: string | null;
  mode?: LiveMode;
  serverNow?: string;
  /** Deterministic digest of the project's current desired plate inputs (style, aspects, and per-scene signatures). */
  revision?: string;
  /** True when one or more scenes of the current storyboard do not have a compatible variant and need to be drawn. */
  stale?: boolean;
  /** True when stored variants differ from desired variants (including free index shifts / reorders or stale scenes). */
  needsReconcile?: boolean;
  film?: FilmProgress;
  scenes: PlateScene[];
  comments: PlateComment[];
  subtitles: PlateSubtitles;
  running: boolean;
  drawnAspects?: ("16:9" | "9:16" | "1:1")[];
  drawingAspects?: ("16:9" | "9:16" | "1:1")[];
};

export type PlateSfxName = "whoosh-short" | "click" | "pop" | "chime" | "typing" | "impact-bass-1" | `foley-${SceneSoundKind}`;
export type PlateSfxCue = { name: PlateSfxName; offset: number; volume: number; mediaStart?: number };

/** One sound a template pack's scene places itself: `kind` (SCENE_SOUND_KINDS) on `frame` (scene frame at FPS). */
export type SceneSound = { kind: SceneSoundKind; frame: number };
const SCENE_SOUND_MAX = 16;
const SCENE_SOUND_VOLUME = 0.9;
const soundKinds = new Set<string>(SCENE_SOUND_KINDS);

/**
 * Reads `export const sounds = [{ kind: "mark", frame: 53 }, ...]` from a scene module AS DATA (never evaluated): the array
 * literal is cut out, comments, `as const` and trailing commas dropped, keys and single quotes made JSON, then JSON.parse.
 * Keeps known kinds on whole frames inside the scene (0 <= frame < frames), sorted, at most 16. Returns null when the module
 * exports no readable list (the scene then gets the keyword sounds); an exported list with nothing usable is [] (silence).
 */
export function parseSceneSounds(code: string, frames: number): SceneSound[] | null {
  const match = /export\s+const\s+sounds\b[^=]*=\s*(\[[\s\S]*?\])\s*(?:as\s+const\b|satisfies\b|;|\n|$)/.exec(code ?? "");
  if (!match || match[1]!.length > 8000) return null;
  let list: unknown;
  try {
    list = JSON.parse(
      match[1]!
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\bas const\b/g, "")
        .replace(/'/g, "\"")
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/,\s*([\]}])/g, "$1")
    );
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const sounds: SceneSound[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { kind, frame } = item as { kind?: unknown; frame?: unknown };
    const f = typeof frame === "number" ? Math.round(frame) : NaN;
    if (typeof kind !== "string" || !soundKinds.has(kind) || !Number.isFinite(f) || f < 0 || !(f < frames)) continue;
    sounds.push({ kind: kind as SceneSoundKind, frame: f });
  }
  return sounds.sort((a, b) => a.frame - b.frame).slice(0, SCENE_SOUND_MAX);
}

/** A pack scene's own sounds as cues: `foley-<kind>` at frame / FPS (the files start on the hit). */
export function sceneSoundCues(sounds: readonly SceneSound[]): PlateSfxCue[] {
  return sounds.map((s) => ({ name: `foley-${s.kind}` as PlateSfxName, offset: Math.round((s.frame / FPS) * 1000) / 1000, volume: SCENE_SOUND_VOLUME }));
}

export function selectSceneSfx(beat: { role?: string; sfx?: string | null; keyword?: string; visual?: string | null; transition_out?: { type?: string } } | undefined, index: number): PlateSfxCue {
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

/** Key-moment story & action SFX cues inside a scene (never includes shutter clicks or transition whooshes). */
export function sceneSfxCues(
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

/** Transition sound cues (`click` shutter / `whoosh-short`) between scenes, controlled by the separate Transitions toggle. */
export function sceneTransitionCues(duration: number, index: number, totalScenes: number): PlateSfxCue[] {
  if (index >= totalScenes - 1) return [];
  const cutAt = Math.max(0.15, Math.round((duration - 0.38) * 100) / 100);
  return [
    { name: "click", offset: cutAt, volume: 0.75 },
    { name: "whoosh-short", offset: Math.max(0.1, cutAt - 0.06), volume: 0.48 }
  ];
}

export type SubtitleCue = { scene: number; start: number; end: number; text: string };
export type CueWord = { text: string; start: number; end: number };

/**
 * Cues of `perCue` spoken words for one scene's line. Word times come from the voiceover take (seconds into the scene) when it
 * has them, else the words are spread evenly over the scene. The cues are back to back: the first opens with the scene, each
 * holds until the next one's first word, the last until just before the cut, so the caption never blinks off mid-line.
 */
export function wordSubtitleCues(scene: number, line: string, start: number, dur: number, perCue: number, spoken?: readonly CueWord[]): SubtitleCue[] {
  const lineWords = line.split(/\s+/).filter(Boolean);
  const timed = (spoken ?? []).filter((w) => w && typeof w.text === "string" && w.text.trim() && Number.isFinite(w.start));
  const end = start + dur - 0.05;
  let words: { text: string; at: number }[];
  if (timed.length) {
    // The script's own words (with their punctuation) when the take has one time per word, else the take's words.
    const texts = timed.length === lineWords.length ? lineWords : timed.map((w) => w.text.trim());
    words = timed.map((w, k) => ({ text: texts[k]!, at: Math.min(Math.max(0, w.start), Math.max(0, dur - 0.1)) }));
  } else {
    const usable = Math.max(0.4, dur - 0.2);
    words = lineWords.map((text, k) => ({ text, at: 0.08 + (k / Math.max(1, lineWords.length)) * usable }));
  }
  if (!words.length) return [];
  const n = Math.max(1, Math.floor(perCue));
  const cues: SubtitleCue[] = [];
  let last = start - 1;
  for (let k = 0; k < words.length; k += n) {
    const group = words.slice(k, k + n);
    const at = k === 0 ? start : Math.max(start + group[0]!.at, last + 0.04);
    if (at >= end) { if (cues.length) cues[cues.length - 1]!.text += ` ${group.map((w) => w.text).join(" ")}`; continue; }
    if (cues.length) cues[cues.length - 1]!.end = at;
    cues.push({ scene, start: at, end, text: group.map((w) => w.text).join(" ") });
    last = at;
  }
  return cues;
}

export function buildSubtitleCues(
  scenes: PlateScene[], beats: ScriptBeat[], durations: number[], starts: number[], mode: SubtitleMode,
  options: { wordsPerCue?: number; words?: (readonly CueWord[] | undefined)[] } = {}
): SubtitleCue[] {
  if (mode === "none") return [];
  const cues: SubtitleCue[] = [];
  scenes.forEach((scene, i) => {
    const beat = beats[i];
    const start = starts[i] ?? 0;
    const dur = durations[i] ?? scene.seconds;
    if (mode === "key-phrases") {
      const text = (beat?.onScreen || beat?.keyword || scene.keyword || "").trim();
      if (text) cues.push({ scene: i, start: start + 0.1, end: Math.max(start + 0.3, start + dur - 0.15), text });
      return;
    }
    const line = (beat?.line || beat?.onScreen || beat?.keyword || scene.keyword || "").trim();
    if (!line) return;
    if (options.wordsPerCue && options.wordsPerCue >= 1) {
      cues.push(...wordSubtitleCues(i, line, start, dur, options.wordsPerCue, options.words?.[i]));
      return;
    }
    const words = line.split(/\s+/).filter(Boolean);
    const maxWords = 6;
    const chunks: string[] = [];
    for (let k = 0; k < words.length; k += maxWords) {
      chunks.push(words.slice(k, k + maxWords).join(" "));
    }
    const usable = Math.max(0.4, dur - 0.2);
    let cursor = start + 0.08;
    const totalWords = words.length || 1;
    chunks.forEach((chunk, idx) => {
      const wCount = chunk.split(/\s+/).length;
      const chunkDur = idx === chunks.length - 1 ? Math.max(0.25, start + dur - 0.1 - cursor) : Math.max(0.35, usable * (wCount / totalWords));
      cues.push({ scene: i, start: cursor, end: Math.min(start + dur - 0.05, cursor + chunkDur), text: chunk });
      cursor += chunkDur;
    });
  });
  return cues;
}


// ---------------------------------------------------------------- subtitle settings
const subtitleModes = new Set<SubtitleMode>(["none", "key-phrases", "full"]);
const subtitleStyles = new Set<SubtitleStyle>(["pill", "cinema", "kinetic", "paper", "blueprint", "shadow"]);
/**
 * The "shadow" style's text is twice the boxed styles' base (6.6% of a portrait frame's width: 71 px on 1080). A pack gives its
 * caption size in pixels on a 1080-wide frame; this is that size as the size setting (percent of the style's base).
 */
export const SHADOW_BASE_PX = 1080 * 0.066;
export const captionSizePercent = (px: number) => Math.min(160, Math.max(50, Math.round((px / SHADOW_BASE_PX) * 100)));
const hexColor = /^#[0-9a-f]{6}$/i;
const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : fallback;
};

export function defaultSubtitlesFor(project?: VideoProject | null): PlateSubtitles {
  const mode: SubtitleMode = project?.brief?.captions && subtitleModes.has(project.brief.captions) ? project.brief.captions : "full";
  const look = project?.brief?.look ?? "";
  const style: SubtitleStyle = look === "illus-blueprint" ? "blueprint" : /^illus-(balloon|fox|folk-tale|gouache|watercolour)/.test(look) ? "paper" : "pill";
  const primary = primaryAspect(project);
  const briefAspects = (project?.brief?.aspects ?? []).filter(isAspect);
  const aspects: Aspect[] = [primary, ...briefAspects.filter((a) => a !== primary)];
  // A template pack's captions (template-packs.ts): its style, size, height and words per cue, e.g. one word at a time.
  const pack = templatePack(project?.brief?.styleExample)?.captions;
  if (pack) {
    return { mode, style: pack.style, size: captionSizePercent(pack.size), opacity: 100, x: 50, y: Math.min(92, Math.max(8, pack.y)), wordsPerCue: pack.wordsPerCue, scenePositions: {}, voice: true, music: true, sfx: true, transitions: false, aspects };
  }
  return { mode, style, size: 100, opacity: 100, x: 50, y: 80, scenePositions: {}, voice: true, music: true, sfx: true, transitions: false, aspects };
}

/** Applies an update to the stored settings: unknown or out-of-range values keep the current setting. */
export function mergeSubtitles(current: PlateSubtitles, input: Record<string, unknown>, fallbackAspect: Aspect): PlateSubtitles {
  const mode = typeof input.mode === "string" && subtitleModes.has(input.mode as SubtitleMode) ? (input.mode as SubtitleMode) : current.mode;
  const style = typeof input.style === "string" && subtitleStyles.has(input.style as SubtitleStyle) ? (input.style as SubtitleStyle) : current.style;
  const size = input.size !== undefined ? clampNum(input.size, 50, 160, current.size ?? 100) : (current.size ?? 100);
  const opacity = input.opacity !== undefined ? clampNum(input.opacity, 20, 100, current.opacity ?? 100) : (current.opacity ?? 100);
  const x = input.x !== undefined ? clampNum(input.x, 8, 92, current.x ?? 50) : (current.x ?? 50);
  const y = input.y !== undefined ? clampNum(input.y, 8, 92, current.y ?? 80) : (current.y ?? 80);
  const color = input.color === null || input.color === "" ? undefined : typeof input.color === "string" && hexColor.test(input.color) ? input.color : current.color;
  const bgColor = input.bgColor === null || input.bgColor === "" ? undefined : typeof input.bgColor === "string" && hexColor.test(input.bgColor) ? input.bgColor : current.bgColor;
  let scenePositions: Record<string, { x: number; y: number }> = { ...(current.scenePositions ?? {}) };
  if (input.scenePositions === null) {
    scenePositions = {};
  } else if (input.scenePositions && typeof input.scenePositions === "object") {
    for (const [k, v] of Object.entries(input.scenePositions as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) continue;
      if (v === null) delete scenePositions[k];
      else if (v && typeof v === "object") {
        const pos = v as { x?: unknown; y?: unknown };
        scenePositions[k] = { x: clampNum(pos.x, 8, 92, scenePositions[k]?.x ?? x), y: clampNum(pos.y, 8, 92, scenePositions[k]?.y ?? y) };
      }
    }
  }
  const flag = (value: unknown, now: boolean | undefined, fallback: boolean) => typeof value === "boolean" ? value : (now ?? fallback);
  const aspects = Array.isArray(input.aspects) ? input.aspects.filter(isAspect) : (current.aspects ?? [fallbackAspect]);
  const wordsPerCue = input.wordsPerCue === null || input.wordsPerCue === 0 ? undefined : input.wordsPerCue !== undefined && Number.isFinite(Number(input.wordsPerCue)) ? Math.min(12, Math.max(1, Math.round(Number(input.wordsPerCue)))) : current.wordsPerCue;
  return {
    mode, style, size, opacity, x, y, scenePositions, ...(wordsPerCue ? { wordsPerCue } : {}),
    voice: flag(input.voice, current.voice, true), music: flag(input.music, current.music, true), sfx: flag(input.sfx, current.sfx, true), transitions: flag(input.transitions, current.transitions, false),
    aspects: aspects.length ? aspects : ["16:9"], ...(color ? { color } : {}), ...(bgColor ? { bgColor } : {})
  };
}

// ---------------------------------------------------------------- timing
const wordsOf = (text: string | null) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;
/**
 * A scene runs at least as long as its voiceover clip (plus a short breath), or its word-count estimate when unvoiced.
 * With `followAudio` (narration in another language than English) a voiced scene follows its own clip with no word-count
 * floor, never under 1.5 s so the picture can land: a 0.8 s line of Hindi is not followed by seconds of silence.
 */
export const secondsFor = (beat: ScriptBeat, voiceSeconds?: number, followAudio = false) => {
  const estimated = Math.round(Math.min(8, Math.max(3, wordsOf(beat.line) / 2.6 + 0.8)) * 2) / 2;
  if (!(voiceSeconds && voiceSeconds > 0)) return estimated;
  const voiced = Math.ceil((voiceSeconds + 0.3) * 2) / 2;
  return followAudio ? Math.max(1.5, voiced) : Math.max(estimated, voiced);
};
/** Narration in another language than English: plate scenes follow the voice (see `secondsFor`). */
export const followsAudio = (project: Pick<VideoProject, "brief">) => Boolean(project.brief?.audio?.language && project.brief.audio.language !== "en");
export const framesForSeconds = (seconds: number) => Math.max(1, Math.round(seconds * FPS));

export type Take = { beat?: string; text: string; seconds?: number; file?: string; words?: { text: string; start: number; end: number }[] };
/** The voiceover take of beat `index` (matched by text and beat id, never leaking a shifted neighbour's take onto an unvoiced scene). */
export function takeFor(project: VideoProject, index: number): Take | undefined {
  const lines = (project.planAudio?.voice?.lines ?? []) as Take[];
  const beat = project.brief?.scriptBeats?.[index];
  const beatId = project.beatPlan?.beats?.[index]?.id;
  const line = beat?.line ?? project.beatPlan?.beats?.[index]?.line;
  const cleaned = line ? voiceText(line) : "";
  const exact = lines.find(
    (item) =>
      (cleaned && item.text === cleaned && (!beatId || !item.beat || item.beat === beatId)) ||
      (beatId && item.beat === beatId && (!cleaned || !item.text || item.text === cleaned))
  );
  if (exact) return exact;
  if (cleaned) return lines.find((item) => item.text === cleaned);
  if (beatId) return lines.find((item) => item.beat === beatId && !item.text);
  const positional = lines[index];
  return positional && !positional.beat && !positional.text ? positional : undefined;
}

/**
 * THE timeline: integer frames per scene. A scene lasts its drawn frames, or longer when its voiceover (plus a quarter second)
 * needs more; never shorter. Preview, subtitles, sound-effect offsets and the encoded export all read these numbers.
 */
export function buildTimeline(clipFrames: number[], voiceSeconds: (number | undefined)[]) {
  const frames = clipFrames.map((n, i) => Math.max(n, voiceSeconds[i] && voiceSeconds[i]! > 0 ? Math.ceil((voiceSeconds[i]! + 0.25) * FPS - 1e-9) : 0));
  const starts = frames.reduce<number[]>((acc, _, i) => { acc.push(i ? acc[i - 1]! + frames[i - 1]! : 0); return acc; }, []);
  return { frames, starts, totalFrames: frames.reduce((a, b) => a + b, 0) };
}

export { canStreamCopy, type ClipFacts } from "@videosaas/plate-engine/rules";

// ---------------------------------------------------------------- cache signatures
const sha = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/**
 * Everything that can change a scene's artwork, and nothing else. NOT included, on purpose: subtitles, music, voice volume,
 * sound effects (they only touch the export), and the other scenes' pictures (the model sees them as story context, but
 * editing scene 3 must not redraw scene 4; the film brief and the list of scene keywords carry the shared cast).
 */
export function variantSignature(input: {
  look: string;
  styleFamily?: string | null;
  styleExample?: string | null;
  /** Code versions (engine, style recipe, prompt and template kit). Accepted so callers can pass them, but NOT part of the signature: a deploy must never
   *  make an already-drawn scene look stale or charge for a redraw. New code applies to scenes drawn from then on; only the person's own edits change a signature. */
  engineDigest?: string;
  styleDigest?: string;
  promptDigest?: string;
  film: string;
  castKeywords: string[];
  beat: Pick<ScriptBeat, "keyword" | "visual" | "onScreen" | "line">;
  frames: number;
  aspect: Aspect;
}) {
  const size = sizeForAspect(input.aspect);
  const familyPart = input.styleFamily ? [`family:${input.styleFamily}`] : [];
  const examplePart =
    input.styleExample &&
    input.styleExample !== `story-${input.look}` &&
    input.styleExample !== `style-${input.look}`
      ? [`example:${input.styleExample}`]
      : [];
  return (
    SIGNATURE_PREFIX +
    sha(
      PIPELINE_VERSION,
      input.look,
      input.film,
      input.castKeywords,
      input.beat.keyword,
      input.beat.visual,
      input.beat.onScreen,
      input.beat.line,
      input.frames,
      FPS,
      input.aspect,
      size.w,
      size.h,
      ...familyPart,
      ...examplePart
    ).slice(0, 24)
  );
}

/** A stored signature from an older pipeline version (or the legacy file pipeline): never reusable. */
export const isCurrentSignature = (sig: string | null | undefined) => typeof sig === "string" && sig.startsWith(SIGNATURE_PREFIX);

/** True when `sig` is a real 24-hex-character SHA-256 signature computed by `variantSignature` (as opposed to a short synthetic test token). */
export const isComputedVariantSignature = (sig: string | null | undefined): boolean =>
  typeof sig === "string" && new RegExp(`^v${PIPELINE_VERSION}:[0-9a-f]{24}$`).test(sig);

/** Deterministic revision digest for the project's current desired scene variants across wanted aspects. */
export function plateRevisionDigest(input: {
  look: string | null | undefined;
  styleFamily?: string | null;
  styleExample?: string | null;
  aspects: readonly Aspect[];
  desired: readonly { index: number; aspect: Aspect; signature: string }[];
}): string {
  return (
    `r${PIPELINE_VERSION}:` +
    sha(
      PIPELINE_VERSION,
      input.look ?? "",
      input.styleFamily ?? "",
      input.styleExample ?? "",
      input.aspects,
      input.desired.map((d) => `${d.index}:${d.aspect}:${d.signature}`)
    ).slice(0, 20)
  );
}

/** Everything that changes the assembled film but not the artwork: pass to the worker as the export's identity. */
export function exportSignature(input: { aspect: Aspect; clips: { sig: string; clipKey: string }[]; timelineFrames: number[]; subtitles: PlateSubtitles; audio: unknown; cues: unknown; watermark: boolean }) {
  return "x" + ASSEMBLER_VERSION + ":" + sha(ASSEMBLER_VERSION, input.aspect, input.clips, input.timelineFrames, input.subtitles, input.audio, input.cues, input.watermark).slice(0, 24);
}
