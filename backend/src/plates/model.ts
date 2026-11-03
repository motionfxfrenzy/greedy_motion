import { createHash } from "node:crypto";
import { voiceText, type ScriptBeat, type VideoProject } from "@videosaas/contracts";

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
export const primaryAspect = (project: VideoProject | null | undefined): Aspect => (project?.brief?.aspect ?? (project?.request.format === "portrait" ? "9:16" : "16:9")) as Aspect;

/**
 * Bump when a change to authoring, bundling or rendering means every stored scene should be drawn again. Signatures start
 * with `v<PIPELINE_VERSION>:`; a stored scene signed by an older pipeline version is never reused (a one-time invalidation:
 * the migration to worker rendering moved every artifact to object storage, and legacy files were never uploaded).
 */
export const PIPELINE_VERSION = 3;
export const SIGNATURE_PREFIX = `v${PIPELINE_VERSION}:`;
/** Bump when the final assembly (worker/src/plates.mjs) produces different bytes from the same inputs. */
export const ASSEMBLER_VERSION = 1;

export type PlateState = "queued" | "authoring" | "rendering" | "drawn" | "failed";
/** The stored state: `bundled` (authored, waiting for a worker) is shown as `rendering`. */
export type VariantState = PlateState | "bundled";
export type PlateVariantView = { state: PlateState; sig: string; /** Changes whenever the stored clip changes, so the browser fetches the new one. */ v: string | null; stage?: string; error?: string };
export type PlateScene = {
  index: number;
  keyword: string;
  state: PlateState;
  seconds: number;
  /** Whole frames at FPS: the unit scene boundaries are measured in, in the preview and in the export. */
  frames: number;
  sig: string;
  /** Bumped when the scene is redrawn from comments, so the browser fetches the new clip. */
  rev?: number;
  error?: string;
  attempts?: number;
  /** Per aspect ratio: each ratio is authored, verified and drawn on its own. */
  variants?: Partial<Record<Aspect, PlateVariantView>>;
};
/** A comment on the film: `at` is film time in seconds, `scene`/`sceneAt` where that falls (the scene is what gets redrawn). */
export type PlateComment = { id: string; at: number; scene: number; sceneAt: number; body: string };
export type SubtitleMode = "none" | "key-phrases" | "full";
export type SubtitleStyle = "pill" | "cinema" | "kinetic" | "paper" | "blueprint";
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
  scenes: PlateScene[];
  comments: PlateComment[];
  subtitles: PlateSubtitles;
  running: boolean;
  drawnAspects?: ("16:9" | "9:16" | "1:1")[];
  drawingAspects?: ("16:9" | "9:16" | "1:1")[];
};

export type PlateSfxName = "whoosh-short" | "click" | "pop" | "chime" | "typing" | "impact-bass-1";
export type PlateSfxCue = { name: PlateSfxName; offset: number; volume: number; mediaStart?: number };

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

export function buildSubtitleCues(scenes: PlateScene[], beats: ScriptBeat[], durations: number[], starts: number[], mode: SubtitleMode): SubtitleCue[] {
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
const subtitleStyles = new Set<SubtitleStyle>(["pill", "cinema", "kinetic", "paper", "blueprint"]);
const hexColor = /^#[0-9a-f]{6}$/i;
const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : fallback;
};

export function defaultSubtitlesFor(project?: VideoProject | null): PlateSubtitles {
  const mode: SubtitleMode = project?.brief?.captions && subtitleModes.has(project.brief.captions) ? project.brief.captions : "full";
  const look = project?.brief?.look ?? "";
  const style: SubtitleStyle = look === "illus-blueprint" ? "blueprint" : /^illus-(balloon|fox|folk-tale|gouache|watercolour)/.test(look) ? "paper" : "pill";
  return { mode, style, size: 100, opacity: 100, x: 50, y: 88, scenePositions: {}, voice: true, music: true, sfx: true, transitions: false };
}

/** Applies an update to the stored settings: unknown or out-of-range values keep the current setting. */
export function mergeSubtitles(current: PlateSubtitles, input: Record<string, unknown>, fallbackAspect: Aspect): PlateSubtitles {
  const mode = typeof input.mode === "string" && subtitleModes.has(input.mode as SubtitleMode) ? (input.mode as SubtitleMode) : current.mode;
  const style = typeof input.style === "string" && subtitleStyles.has(input.style as SubtitleStyle) ? (input.style as SubtitleStyle) : current.style;
  const size = input.size !== undefined ? clampNum(input.size, 50, 160, current.size ?? 100) : (current.size ?? 100);
  const opacity = input.opacity !== undefined ? clampNum(input.opacity, 20, 100, current.opacity ?? 100) : (current.opacity ?? 100);
  const x = input.x !== undefined ? clampNum(input.x, 8, 92, current.x ?? 50) : (current.x ?? 50);
  const y = input.y !== undefined ? clampNum(input.y, 8, 92, current.y ?? 88) : (current.y ?? 88);
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
  return {
    mode, style, size, opacity, x, y, scenePositions,
    voice: flag(input.voice, current.voice, true), music: flag(input.music, current.music, true), sfx: flag(input.sfx, current.sfx, true), transitions: flag(input.transitions, current.transitions, false),
    aspects: aspects.length ? aspects : ["16:9"], ...(color ? { color } : {}), ...(bgColor ? { bgColor } : {})
  };
}

// ---------------------------------------------------------------- timing
const wordsOf = (text: string | null) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;
/** A scene runs at least as long as its voiceover clip (plus a short breath), or its word-count estimate when unvoiced. */
export const secondsFor = (beat: ScriptBeat, voiceSeconds?: number) => {
  const estimated = Math.round(Math.min(8, Math.max(3, wordsOf(beat.line) / 2.6 + 0.8)) * 2) / 2;
  return voiceSeconds && voiceSeconds > 0 ? Math.max(estimated, Math.ceil((voiceSeconds + 0.3) * 2) / 2) : estimated;
};
export const framesForSeconds = (seconds: number) => Math.max(1, Math.round(seconds * FPS));

export type Take = { beat?: string; text: string; seconds?: number; file?: string; words?: { text: string; start: number; end: number }[] };
/** The voiceover take of beat `index` (matched by beat id or text, else by position). */
export function takeFor(project: VideoProject, index: number): Take | undefined {
  const lines = (project.planAudio?.voice?.lines ?? []) as Take[];
  const beat = project.brief?.scriptBeats?.[index];
  const beatId = project.beatPlan?.beats?.[index]?.id;
  const line = beat?.line ?? project.beatPlan?.beats?.[index]?.line;
  return lines.find((item) => (beatId && item.beat === beatId) || (line && item.text === voiceText(line))) ?? lines[index];
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
  look: string; engineDigest: string; styleDigest: string; promptDigest: string; film: string; castKeywords: string[];
  beat: Pick<ScriptBeat, "keyword" | "visual" | "onScreen" | "line">; frames: number; aspect: Aspect;
}) {
  const size = sizeForAspect(input.aspect);
  return SIGNATURE_PREFIX + sha(PIPELINE_VERSION, input.look, input.engineDigest, input.styleDigest, input.promptDigest, input.film, input.castKeywords, input.beat.keyword, input.beat.visual, input.beat.onScreen, input.beat.line, input.frames, FPS, input.aspect, size.w, size.h).slice(0, 24);
}

/** A stored signature from an older pipeline version (or the legacy file pipeline): never reusable. */
export const isCurrentSignature = (sig: string | null | undefined) => typeof sig === "string" && sig.startsWith(SIGNATURE_PREFIX);

/** Everything that changes the assembled film but not the artwork: pass to the worker as the export's identity. */
export function exportSignature(input: { aspect: Aspect; clips: { sig: string; clipKey: string }[]; timelineFrames: number[]; subtitles: PlateSubtitles; audio: unknown; cues: unknown; watermark: boolean }) {
  return "x" + ASSEMBLER_VERSION + ":" + sha(ASSEMBLER_VERSION, input.aspect, input.clips, input.timelineFrames, input.subtitles, input.audio, input.cues, input.watermark).slice(0, 24);
}
