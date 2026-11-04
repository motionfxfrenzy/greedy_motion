import type {
  ResolvedWorkspaceOptions,
  WorkspaceAudioTrackId,
  WorkspaceComment,
  WorkspaceOptionsConfig,
  WorkspaceSceneSpan,
  WorkspaceSceneTabVisualState,
  WorkspaceSubtitleMode,
  WorkspaceSubtitleStyle
} from "./types.ts";

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
  drawn: "Drawn",
  checked: "Ready",
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

/** Computes the unique 1-based scene numbers targeted by comments and the apply button copy. */
export function affectedScenesSummary(
  comments: readonly Pick<WorkspaceComment, "scene">[],
  options?: {
    busy?: boolean;
    busyLabel?: string;
    emptyLabel?: string;
    actionVerb?: string;
  }
): { scenes: number[]; numbersText: string; label: string } {
  const uniqueScenes = [...new Set(comments.map((c) => c.scene + 1))];
  const numbersText = uniqueScenes.join(", ");
  const busy = Boolean(options?.busy);
  const busyLabel = options?.busyLabel ?? "Drawing…";
  const emptyLabel = options?.emptyLabel ?? "Redraw with comments";
  const verb = options?.actionVerb ?? "Redraw";

  if (busy) {
    return { scenes: uniqueScenes, numbersText, label: busyLabel };
  }
  if (!comments.length) {
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
    subtitlePosition: showSubtitleTab && (config?.subtitlePosition ?? true)
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
