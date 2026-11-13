import { motionBlurProblem } from "@videosaas/contracts";
import type {
  FinalViewRatio,
  FinalViewRatioStatus,
  ResolvedWorkspaceOptions,
  WorkspaceAudioTrackId,
  WorkspaceComment,
  WorkspaceOptionsConfig,
  WorkspacePlaybackRenderMode,
  WorkspacePreviewQuality,
  WorkspaceSceneSpan,
  WorkspaceSceneTabVisualState,
  WorkspaceSubtitleMode,
  WorkspaceSubtitleStyle
} from "./types.ts";

export const WORKSPACE_PLAYBACK_RENDER_MODES: readonly {
  id: WorkspacePlaybackRenderMode;
  label: "Draft" | "Full";
  description: string;
}[] = [
  {
    id: "draft",
    label: "Draft",
    description: "Fast live playback · full-detail still when paused"
  },
  {
    id: "full",
    label: "Full",
    description: "Full stroke & texture detail on every frame (buffers if needed)"
  }
];

export const WORKSPACE_PREVIEW_QUALITIES: readonly {
  id: WorkspacePreviewQuality;
  label: "Low" | "Standard" | "High";
  description: string;
}[] = [
  { id: 0.2, label: "Low", description: "Smaller storage footprint (0.2)" },
  { id: 0.4, label: "Standard", description: "Balanced quality and size (0.4)" },
  { id: 0.6, label: "High", description: "Sharper stored preview frames (0.6)" }
];

export const WORKSPACE_SUBTITLE_MODES: readonly { id: WorkspaceSubtitleMode; label: string; description: string }[] = [
  { id: "none", label: "Off", description: "Hide on-screen subtitles" },
  { id: "key-phrases", label: "Key phrases", description: "Short key-phrase callouts per beat" },
  { id: "full", label: "Subtitles", description: "Full narrated lines synced to voice" }
];

export const WORKSPACE_SUBTITLE_STYLES: readonly { id: WorkspaceSubtitleStyle; label: string }[] = [
  { id: "pill", label: "Pill" },
  { id: "cinema", label: "Cinema" },
  { id: "kinetic", label: "Kinetic" },
  { id: "paper", label: "Storybook" },
  { id: "blueprint", label: "Blueprint" }
];

export const DEFAULT_AUDIO_TRACKS: readonly WorkspaceAudioTrackId[] = ["voice", "music", "sfx", "transitions"];
export const DEFAULT_SUBTITLE_MODES: readonly WorkspaceSubtitleMode[] = ["none", "key-phrases", "full"];

const STATE_LABEL_DEFAULTS: Record<string, string> = {
  queued: "Waiting",
  authoring: "Writing the scene",
  rendering: "Drawing",
  bundled: "Checking",
  updating: "Updating",
  drawn: "Rendered",
  checked: "Drawn",
  ready: "Ready",
  failed: "Failed",
  "needs-update": "Needs update",
  stale: "Needs update"
};

/** Formats a timestamp in seconds as `M:SS` (clamping negative or NaN values to `0:00`). */
export function formatClock(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Builds contiguous scene spans `[{ index, start, end, duration }]` from an array of scene durations. */
export function sceneSpansFromDurations(durations: readonly number[]): WorkspaceSceneSpan[] {
  const spans: WorkspaceSceneSpan[] = [];
  let cursor = 0;
  for (let i = 0; i < durations.length; i++) {
    const raw = durations[i] ?? 0;
    const duration = Number.isFinite(raw) && raw > 0 ? raw : 0;
    spans.push({
      index: i,
      start: cursor,
      end: cursor + duration,
      duration
    });
    cursor += duration;
  }
  return spans;
}

/**
 * Anchors a comment or playhead timestamp (`time` in seconds) to a scene index and scene-local offset.
 * Clamps `time` into `[0, max(0, totalDuration - 0.05)]` so comments at the very end of the film anchor to the last scene.
 */
export function anchorCommentAtTime(
  time: number,
  spans: readonly WorkspaceSceneSpan[]
): { at: number; scene: number; sceneAt: number } {
  if (!spans.length) {
    return { at: 0, scene: 0, sceneAt: 0 };
  }
  const total = spans[spans.length - 1]!.end;
  const safeTime = Number.isFinite(time) ? time : 0;
  const clamped = Math.min(Math.max(0, safeTime), Math.max(0, total - 0.05));
  let index = spans.length - 1;
  for (let i = 0; i < spans.length; i++) {
    if (clamped < spans[i]!.end) {
      index = i;
      break;
    }
  }
  const span = spans[index]!;
  const sceneAt = Math.max(0, Math.round((clamped - span.start) * 1000) / 1000);
  return { at: clamped, scene: index, sceneAt };
}

/** Returns a new array of comments sorted ascending by `at`. */
export function sortWorkspaceComments<T extends Pick<WorkspaceComment, "at">>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) => a.at - b.at);
}

/**
 * Splits comments into the open ones (still to be applied by a redraw) and the applied ones (answered by a redraw).
 * Only open comments count toward the Comments badge, the list and the "Redraw with comments" button; applied ones are history.
 */
export function splitCommentsByStatus<T extends Pick<WorkspaceComment, "appliedLabel">>(
  comments: readonly T[]
): { pending: T[]; applied: T[] } {
  const pending: T[] = [];
  const applied: T[] = [];
  for (const comment of comments) (comment.appliedLabel ? applied : pending).push(comment);
  return { pending, applied };
}

/** Computes the unique 1-based scene numbers targeted by comments and the apply button copy. */
export function affectedScenesSummary(
  comments: readonly Pick<WorkspaceComment, "scene" | "appliedLabel">[],
  options?: {
    busy?: boolean;
    busyLabel?: string;
    emptyLabel?: string;
    actionVerb?: string;
  }
): { scenes: number[]; numbersText: string; label: string } {
  const pending = comments.filter((c) => !c.appliedLabel);
  const uniqueScenes = [...new Set(pending.map((c) => c.scene + 1))];
  const numbersText = uniqueScenes.join(", ");
  const busy = Boolean(options?.busy);
  const busyLabel = options?.busyLabel ?? "Drawing…";
  const emptyLabel = options?.emptyLabel ?? "Redraw with comments";
  const verb = options?.actionVerb ?? "Redraw";

  if (busy) {
    return { scenes: uniqueScenes, numbersText, label: busyLabel };
  }
  if (!pending.length) {
    return { scenes: uniqueScenes, numbersText, label: emptyLabel };
  }
  const plural = uniqueScenes.length > 1 ? "s" : "";
  return {
    scenes: uniqueScenes,
    numbersText,
    label: `${verb} scene${plural} ${numbersText}`
  };
}

/**
 * Maps any engine or workspace scene state into the three canonical visual tab categories
 * (`"ready"`, `"updating"`, `"needs-update"`), its CSS class token, and its tooltip label.
 */
export function mapSceneTabState(
  state: string,
  customLabel?: string
): {
  visualState: WorkspaceSceneTabVisualState;
  cssClass: string;
  label: string;
} {
  const label = customLabel ?? STATE_LABEL_DEFAULTS[state] ?? state;
  if (state === "queued" || state === "authoring" || state === "rendering" || state === "bundled" || state === "updating") {
    const cssClass = state === "queued" || state === "authoring" || state === "rendering" ? state : "updating";
    return { visualState: "updating", cssClass, label };
  }
  if (state === "failed" || state === "needs-update" || state === "stale") {
    const cssClass = state === "failed" ? "failed" : "needs-update";
    return { visualState: "needs-update", cssClass, label };
  }
  const cssClass = state === "drawn" ? "drawn" : "ready";
  return { visualState: "ready", cssClass, label };
}

/**
 * Resolves which controls are visible in `OptionsBar`.
 * Omitted options are hidden (never shown disabled) so engines only expose controls they honour.
 */
export function resolveVisibleOptions(config?: WorkspaceOptionsConfig): ResolvedWorkspaceOptions {
  const audioTracks = config?.audioTracks ?? DEFAULT_AUDIO_TRACKS;
  const subtitleModes = config?.subtitleModes ?? DEFAULT_SUBTITLE_MODES;
  const showAudioTab = audioTracks.length > 0;
  const showSubtitleTab = subtitleModes.length > 0;
  return {
    showAudioTab,
    audioTracks,
    showSubtitleTab,
    subtitleModes,
    subtitleStyle: showSubtitleTab && (config?.subtitleStyle ?? true),
    subtitleSize: showSubtitleTab && (config?.subtitleSize ?? true),
    subtitleColors: showSubtitleTab && (config?.subtitleColors ?? true),
    subtitleOpacity: showSubtitleTab && (config?.subtitleOpacity ?? true),
    subtitlePosition: showSubtitleTab && (config?.subtitlePosition ?? true),
    previewQuality: config?.previewQuality ?? true,
    motionBlur: config?.motionBlur ?? true
  };
}

export interface SubtitleCue {
  scene: number;
  start: number;
  end: number;
  text: string;
}

/** Builds timed subtitle cues across scenes for `"key-phrases"` or `"full"` mode. */
export function buildSubtitleCues(
  mode: WorkspaceSubtitleMode,
  scenes: readonly { seconds: number; keyword?: string }[],
  beats: readonly { line?: string | null; onScreen?: string | null; keyword?: string }[] | undefined,
  starts: readonly number[],
  durations: readonly number[]
): SubtitleCue[] {
  if (mode === "none" || !scenes.length) return [];
  const beatList = beats ?? [];
  const cues: SubtitleCue[] = [];
  scenes.forEach((scene, i) => {
    const beat = beatList[i];
    const start = starts[i] ?? 0;
    const dur = durations[i] ?? scene.seconds;
    if (mode === "key-phrases") {
      const text = (beat?.onScreen || beat?.keyword || scene.keyword || "").trim();
      if (text) cues.push({ scene: i, start, end: start + dur, text });
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
    let cursor = start;
    const totalWords = words.length || 1;
    chunks.forEach((chunk, idx) => {
      const wCount = chunk.split(/\s+/).length;
      const chunkDur =
        idx === chunks.length - 1
          ? Math.max(0.25, start + dur - cursor)
          : Math.max(0.35, dur * (wCount / totalWords));
      cues.push({ scene: i, start: cursor, end: cursor + chunkDur, text: chunk });
      cursor += chunkDur;
    });
  });
  return cues;
}

/** Finds the active subtitle cue for the current playback time and scene index. */
export function activeSubtitleCueAt(
  mode: WorkspaceSubtitleMode,
  cues: readonly SubtitleCue[],
  time: number,
  currentScene: number
): SubtitleCue | null {
  if (mode === "none" || !cues.length) return null;
  return cues.find((c) => time >= c.start && time < c.end) ?? cues.find((c) => c.scene === currentScene) ?? null;
}

export type HfAudioMode = "voiceover" | "music" | "both" | "none";

export interface HfBeatSpan extends WorkspaceSceneSpan {
  label: string;
}

/**
 * Builds contiguous scene spans `[{ index, label, start, end, duration }]` from a beat list and
 * optional `beatTimes` dictionary (`{ [beatId]: { start, end } }`), falling back to equal slices of `totalDuration`.
 */
export function sceneSpansFromBeatTimes(
  beats: readonly { id?: string; keyword?: string | null }[],
  beatTimes: Readonly<Record<string, { start: number; end: number }>> | undefined,
  totalDuration: number
): HfBeatSpan[] {
  const safeTotal = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 30;
  const list = beats.length > 0 ? beats : [{ id: "b1", keyword: "Scene 1" }];
  const count = Math.max(1, list.length);
  return list.map((b, i) => {
    const bt = b.id && beatTimes ? beatTimes[b.id] : undefined;
    const start = typeof bt?.start === "number" && Number.isFinite(bt.start) ? bt.start : (i / count) * safeTotal;
    const end = typeof bt?.end === "number" && Number.isFinite(bt.end) ? bt.end : ((i + 1) / count) * safeTotal;
    const duration = Math.max(0.01, end - start);
    return {
      index: i,
      label: (b.keyword ?? "").trim() || `Scene ${i + 1}`,
      start,
      end,
      duration
    };
  });
}

/**
 * Groups timed comments by the scene they fall into and formats them into `{ line, text }[]`
 * for `onApplySceneComments`.
 */
export function groupCommentsByScene(
  comments: readonly { at: number; body: string }[],
  spans: readonly WorkspaceSceneSpan[]
): { line: number; text: string }[] {
  const sorted = sortWorkspaceComments(comments);
  const byLine = new Map<number, string[]>();
  for (const c of sorted) {
    const { scene } = anchorCommentAtTime(c.at, spans);
    const list = byLine.get(scene) ?? [];
    list.push(c.body);
    byLine.set(scene, list);
  }
  return [...byLine.entries()].map(([line, texts]) => ({
    line,
    text: texts.join(". ")
  }));
}

/**
 * Determines which audio tracks (voice, music) have been generated and exist for a HyperFrames project.
 * Toggles are only shown for tracks that exist; toggling never triggers generation.
 */
export function hfAvailableAudioTracks(
  project: {
    planAudio?: {
      voice?: { lines?: readonly unknown[] } | null;
      music?: { file?: string | null } | null;
    } | null;
  },
  compAudio?: {
    voice?: { ready?: number } | null;
    music?: { ready?: boolean } | null;
  } | null
): { voice: boolean; music: boolean } {
  const voice = Boolean(
    (project.planAudio?.voice?.lines?.length ?? 0) > 0 || (compAudio?.voice?.ready ?? 0) > 0
  );
  const music = Boolean(project.planAudio?.music?.file || compAudio?.music?.ready);
  return { voice, music };
}

/**
 * Builds the `WorkspaceOptionsConfig` for HyperFrames in phase 3b:
 * - Only `voice` and/or `music` toggles that exist on the project
 * - Subtitle modes `["none", "key-phrases", "full"]`
 * - Style, size, colors, opacity, position, SFX, and transitions are hidden (`false` / omitted)
 */
export function hfOptionsConfig(availableAudio: { voice: boolean; music: boolean }): WorkspaceOptionsConfig {
  const audioTracks: WorkspaceAudioTrackId[] = [];
  if (availableAudio.voice) audioTracks.push("voice");
  if (availableAudio.music) audioTracks.push("music");
  return {
    audioTracks,
    subtitleModes: ["none", "key-phrases", "full"],
    subtitleStyle: true,
    subtitleSize: true,
    subtitleColors: true,
    subtitleOpacity: true,
    subtitlePosition: true,
    previewQuality: false
  };
}

/** Whether a project look identifier is a code-drawn plate style (`illus-*`). */
export function isPlateLookId(look?: string | null): boolean {
  return Boolean(look?.startsWith("illus-"));
}

/**
 * Builds the `WorkspaceOptionsConfig` for plate films (or for a given look id):
 * plate renders ignore motion blur, so `motionBlur` is hidden (`false`).
 */
export function plateOptionsConfig(look?: string | null): WorkspaceOptionsConfig {
  if (look !== undefined && !isPlateLookId(look)) {
    return {};
  }
  return {
    motionBlur: false
  };
}

/**
 * Resolves whether the motion-blur control is shown and whether the film length exceeds the limit.
 * Plate films hide the control and never run the length check.
 */
export function motionBlurControl(
  look: string | null | undefined,
  lengthSeconds: number
): { shown: boolean; problem: string | null } {
  const visible = resolveVisibleOptions(isPlateLookId(look) ? plateOptionsConfig() : undefined);
  if (!visible.motionBlur) {
    return { shown: false, problem: null };
  }
  return { shown: true, problem: motionBlurProblem(lengthSeconds) };
}

/** Maps a film's audio mode (`"voiceover" | "music" | "both" | "none"`) to `{ voice, music }` toggle states. */
export function audioTogglesFromMode(
  mode: HfAudioMode,
  available: { voice: boolean; music: boolean } = { voice: true, music: true }
): { voice: boolean; music: boolean } {
  return {
    voice: available.voice && (mode === "voiceover" || mode === "both"),
    music: available.music && (mode === "music" || mode === "both")
  };
}

/** Maps `{ voice, music }` toggle states back to the film's `HfAudioMode` (`"voiceover" | "music" | "both" | "none"`). */
export function audioModeFromToggles(toggles: { voice: boolean; music: boolean }): HfAudioMode {
  if (toggles.voice && toggles.music) return "both";
  if (toggles.voice) return "voiceover";
  if (toggles.music) return "music";
  return "none";
}

/** Computes the next `HfAudioMode` when a user clicks the `voice` or `music` toggle chip. */
export function toggleAudioTrackMode(
  currentMode: HfAudioMode,
  track: "voice" | "music",
  available: { voice: boolean; music: boolean } = { voice: true, music: true }
): HfAudioMode {
  if (!available[track]) return currentMode;
  const current = audioTogglesFromMode(currentMode, available);
  const next = {
    voice: track === "voice" ? !current.voice : current.voice,
    music: track === "music" ? !current.music : current.music
  };
  return audioModeFromToggles(next);
}

const FINAL_RATIO_SHAPES: Readonly<Record<string, string>> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1"
};

/** Maps a ratio identifier (`"16:9"`, `"9:16"`, `"1:1"`) to its CSS `aspect-ratio` value. */
export function finalRatioShape(ratioId: string): string {
  return FINAL_RATIO_SHAPES[ratioId] ?? "16 / 9";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMPT_PREFIX_RE = /^(?:(?:please\s+)?(?:make|create|build|generate|write|produce|design|render|show|explain)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:\d+\s*(?:-|\s)?\s*(?:second|sec|s|minute|min)\s+)?(?:[\w-]+\s+){0,4}?(?:video|reel|film|explainer|animation|short|story|clip|ad|promo)\s+(?:about|on|for|explaining|showing|that\s+explains|of)\s+)/i;

/**
 * Turns a project name (or brief text) into a clean, human-readable filename stem (e.g. "overthinking" or "relay-launch-reel").
 * Strips leading prompt boilerplate like "Make a 15 second concept reel about..." when present.
 */
export function slugifyProjectDownloadStem(projectName?: string | null, fallbackId?: string | null): string {
  const raw = typeof projectName === "string" ? projectName.trim() : "";
  if (raw && !UUID_RE.test(raw) && raw.toLowerCase() !== "untitled video" && raw.toLowerCase() !== "draft product video") {
    const stripped = raw.replace(PROMPT_PREFIX_RE, "").trim() || raw;
    const slug = stripped
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");
    if (slug) return slug;
  }
  const fb = typeof fallbackId === "string" ? fallbackId.trim() : "";
  if (fb && !UUID_RE.test(fb)) {
    const slug = fb
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");
    if (slug) return slug;
  }
  return fb || "video";
}

/** Builds the canonical MP4 download filename `<project-slug>-<ratio>.mp4` (with `:` replaced by `x`). */
export function finalRatioDownloadName(projectIdOrName: string, ratioId: string, projectName?: string | null): string {
  const stem = slugifyProjectDownloadStem(projectName ?? projectIdOrName, projectIdOrName);
  return `${stem}-${ratioId.replace(/:/g, "x")}.mp4`;
}

/**
 * Builds an explicit attachment download URL from a playback media URL and target filename.
 * Preserves existing query parameters (such as `?t=` media tokens) while signalling `download=1&filename=...`
 * so the backend/storage response carries `Content-Disposition: attachment` across origins.
 */
export function buildFinalRatioDownloadUrl(
  url: string | null | undefined,
  downloadName: string
): string | null {
  if (!url) return null;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  const [withoutHash, hashPart] = url.split("#", 2);
  const hash = hashPart !== undefined ? `#${hashPart}` : "";
  const qIndex = withoutHash!.indexOf("?");
  const basePath = qIndex >= 0 ? withoutHash!.slice(0, qIndex) : withoutHash!;
  const params = new URLSearchParams(qIndex >= 0 ? withoutHash!.slice(qIndex + 1) : "");
  params.set("download", "1");
  if (downloadName) {
    params.set("filename", downloadName);
  }
  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ""}${hash}`;
}

/** Returns whether the ratio tablist should be rendered (hidden when there is only a single ratio). */
export function shouldShowFinalRatioTabs(ratios: readonly { id: string }[]): boolean {
  return ratios.length > 1;
}

/** Maps a plate ratio's export state to `"ready" | "preparing" | "failed"`. */
export function mapPlateRatioStatus(
  ratio: string,
  primary: string,
  exportState?: { state?: string; progress?: number; error?: string } | null
): FinalViewRatioStatus {
  if (ratio === primary || exportState?.state === "ready") return "ready";
  if (exportState?.state === "failed") return "failed";
  return "preparing";
}

/** Builds the `FinalViewRatio[]` list for `PlateFinal`. */
export function buildPlateFinalRatios<R extends string>(
  projectId: string,
  primary: R,
  ratios: readonly R[],
  finalUrl: string,
  exportsMap: Partial<Record<R, { state?: string; progress?: number; error?: string }>>,
  exportUrlFor: (ratio: R) => string,
  projectName?: string | null
): FinalViewRatio[] {
  return ratios.map((ratio) => {
    const exp = exportsMap[ratio];
    const status = mapPlateRatioStatus(ratio, primary, exp);
    const url =
      ratio === primary
        ? finalUrl
        : exp?.state === "ready"
        ? exportUrlFor(ratio)
        : null;
    return {
      id: ratio,
      label: ratio,
      status,
      progress: exp?.progress ?? 0,
      url,
      ...(exp?.error ? { error: exp.error } : {}),
      downloadName: finalRatioDownloadName(projectId, ratio, projectName)
    };
  });
}

/** Builds the single-item `FinalViewRatio[]` list for HyperFrames `FinalRenderStep`. */
export function buildHfFinalRatios(
  projectId: string,
  aspect: string,
  url: string,
  projectName?: string | null
): FinalViewRatio[] {
  const ratioId = aspect === "9:16" || aspect === "1:1" ? aspect : "16:9";
  return [
    {
      id: ratioId,
      label: ratioId,
      status: "ready",
      url,
      downloadName: finalRatioDownloadName(projectId, ratioId, projectName)
    }
  ];
}

/** Formats the ratio tab chip text (`"16:9"`, `"1:1 · 65%"`, `"1:1 · failed"`). */
export function formatFinalRatioTabLabel(
  ratio: Pick<FinalViewRatio, "label" | "status" | "progress">
): string {
  if (ratio.status === "preparing") {
    return `${ratio.label} · ${ratio.progress ?? 0}%`;
  }
  if (ratio.status === "failed") {
    return `${ratio.label} · failed`;
  }
  return ratio.label;
}

/** Formats the default waiting / failed status message inside `.pf-frame` when `url` is null. */
export function formatFinalWaitMessage(
  ratio: Pick<FinalViewRatio, "label" | "status" | "progress" | "error">
): string {
  if (ratio.status === "failed") {
    return ratio.error ?? "This ratio could not be prepared.";
  }
  return `Preparing ${ratio.label}… ${ratio.progress ?? 0}%`;
}
