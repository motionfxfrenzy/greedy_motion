export const formats = ["landscape", "portrait"] as const;
import { parseAudioOptions, type AudioOptions, type AudioResult } from "./audio.ts";
import type { BeatPlan, PlanAudio, ScriptBrief, SiteCapture } from "./beat-plan.ts";
import { defaultTemplateId, templateIds, type TemplateValues } from "./templates.ts";
import { defaultThemeId, themeIds } from "./themes.ts";

export * from "./audio.ts";
export * from "./beat-plan.ts";
export * from "./brand.ts";
export * from "./templates.ts";
export * from "./themes.ts";

export const styles = ["clean", "kinetic", "editorial"] as const;

export type RenderRequest = {
  prompt: string;
  format: (typeof formats)[number];
  style: (typeof styles)[number];
  /** Visual theme id from the theme catalog (themes.ts). */
  theme: string;
  /** Starter template id from the template catalog (templates.ts). */
  template: string;
  /** Saved brand kit: its logo, name, website, colors, and fonts override the theme and copy. */
  brandId?: string;
  /** Background music and voiceover. */
  audio?: AudioOptions;
};

export type Scene = {
  id: string;
  label: string;
  detail: string;
  duration: number;
};

export type RenderJobState = "queued" | "planning" | "rendering" | "ready" | "failed";

/**
 * Finer-grained, real progress inside a state. Set by the backend while planning and by the
 * render worker while rendering; the UI never invents stages or percentages.
 * - planning: `planning` (Claude writes the storyboard), `audio` (music and voiceover)
 * - rendering: `waiting` (queued for a free renderer), `preparing` (building the composition),
 *   `frames` (capturing frames; see `frames`), `encoding` (muxing audio and writing the MP4),
 *   `retrying` (an attempt failed and is scheduled to run again)
 */
export type RenderStage = "queued" | "planning" | "audio" | "waiting" | "preparing" | "frames" | "encoding" | "retrying" | "done" | "failed";

/** Which planner produced the storyboard, so the UI can show whether Claude was used. */
export type PlannerInfo = { provider: "anthropic" | "deterministic"; model?: string };

export type RenderJob = {
  id: string;
  state: RenderJobState;
  stage?: RenderStage;
  progress: number;
  /** Captured frames, reported by the renderer while `stage` is `frames`. */
  frames?: { done: number; total: number };
  /** Renders ahead of this one in the queue while `stage` is `waiting`. */
  queuePosition?: number;
  /** 1 for the first render attempt; higher after an automatic retry. */
  attempt?: number;
  createdAt: string;
  updatedAt?: string;
  revision: {
    id: string;
    title: string;
    scenes: Scene[];
    planner?: PlannerInfo;
    /** Template and the variable values the video renders with. */
    template?: string;
    values?: Record<string, string | number>;
    brandId?: string;
    audio?: AudioResult;
  };
  output?: { url: string; format: "mp4"; durationSeconds: number };
  error?: { code: string; message: string };
};

export type ProjectState =
  | "Ready to create"
  | "Finish your brief"
  | "Draft storyboard"
  | "Rendering draft"
  | "Ready for review"
  | "Revisions needed"
  | "Approved"
  | "Render needs attention";

export type ProjectScriptLine = {
  label: string;
  onScreen: string;
  voiceover?: string;
};

export type ProjectScript = {
  source: "generated" | "provided";
  lines: ProjectScriptLine[];
  confirmed: boolean;
  updatedAt: string;
};

export type ProjectScreenshot = {
  id: string;
  name: string;
  purpose: "Dashboard" | "Setup" | "Report" | "Mobile";
  width: number;
  height: number;
  createdAt: string;
};

export type ProjectReviewComment = {
  id: string;
  body: string;
  /** Offset within the rendered video in seconds. */
  timestampSeconds: number;
  createdAt: string;
};

/**
 * A saved, editable template revision. Values are deliberately limited to the
 * template catalog's text and number slots; uploaded media is referenced by its
 * project screenshot id rather than copied into project JSON.
 */
export type ProjectStudioDraft = {
  /** Monotonically increases whenever a saved Studio edit changes the draft. */
  revision: number;
  values: TemplateValues;
  /** Template image-variable id -> a verified `ProjectScreenshot.id`. */
  assets: Record<string, string>;
  updatedAt: string;
};

/** A persisted video brief. Project data deliberately stores inputs and references, never a mock preview. */
export type VideoProject = {
  id: string;
  name: string;
  state: ProjectState;
  createdAt: string;
  updatedAt: string;
  request: RenderRequest;
  script?: ProjectScript;
  screenshots: ProjectScreenshot[];
  comments: ProjectReviewComment[];
  /** Present only after the project has been opened and saved in Studio. */
  studio?: ProjectStudioDraft;
  renderJobId?: string;
  approvedAt?: string;
  /** Product flow v2: the Script & Style brief and the director's beat plan (docs/PRODUCT_FLOW_V2.md). */
  brief?: ScriptBrief;
  beatPlan?: BeatPlan;
  /** The plan's voiceover takes and music bed (backend/src/plan/audio.ts). */
  planAudio?: PlanAudio;
  /** The product website read for this project (backend/src/site). */
  site?: SiteCapture;
};

export function parseRenderRequest(value: unknown): RenderRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim().replace(/\s+/g, " ") : "";
  const format = candidate.format;
  const style = candidate.style;
  const theme = candidate.theme === undefined ? defaultThemeId : candidate.theme;
  if (typeof theme !== "string" || !themeIds.includes(theme)) return null;
  const template = candidate.template === undefined ? defaultTemplateId : candidate.template;
  if (typeof template !== "string" || !templateIds.includes(template)) return null;
  if (prompt.length < 12 || prompt.length > 600 || !formats.includes(format as RenderRequest["format"]) || !styles.includes(style as RenderRequest["style"])) return null;
  const brandId = candidate.brandId;
  if (brandId !== undefined && (typeof brandId !== "string" || !/^[0-9a-f-]{36}$/i.test(brandId))) return null;
  const audio = parseAudioOptions(candidate.audio);
  if (audio === null) return null;
  return { prompt, format: format as RenderRequest["format"], style: style as RenderRequest["style"], theme, template, ...(brandId ? { brandId } : {}), ...(audio ? { audio } : {}) };
}
