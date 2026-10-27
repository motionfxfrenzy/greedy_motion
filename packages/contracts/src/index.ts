import type { PlanVisuals } from "./visuals.ts";
export * from "./visuals.ts";
export const formats = ["landscape", "portrait"] as const;
import { parseAudioOptions, type AudioOptions, type AudioResult } from "./audio.ts";
import type { BeatPlan, PlanAudio, ScriptBrief, SiteCapture } from "./beat-plan.ts";
import type { FrameMotion, ScriptFrame } from "./script-stream.ts";
import type { ProManifest } from "./engine.ts";
import { defaultTemplateId, templateIds, type TemplateValues } from "./templates.ts";
import { defaultThemeId, themeIds } from "./themes.ts";

export * from "./audio.ts";
export * from "./beat-plan.ts";
export * from "./brand.ts";
export * from "./engine.ts";
export * from "./frame.ts";
export * from "./gallery.ts";
export * from "./looks.ts";
export * from "./style-families.ts";
export * from "./scenes.ts";
export * from "./motion-blur.ts";
export * from "./pricing.ts";
export * from "./script-stream.ts";
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
 * - planning: `planning` (Claude writes the storyboard), `audio` (music and voiceover),
 *   `directing` (a storyboard film: motion directed on the voiceover, composition built and uploaded)
 * - rendering: `waiting` (queued for a free renderer), `preparing` (building the composition),
 *   `frames` (capturing frames; see `frames`), `encoding` (muxing audio and writing the MP4),
 *   `retrying` (an attempt failed and is scheduled to run again)
 */
export type RenderStage = "queued" | "planning" | "audio" | "directing" | "waiting" | "preparing" | "frames" | "encoding" | "retrying" | "done" | "failed";

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
    /** The visual style this draft was rendered in (looks.ts), so Review can tell when the project has moved on to another. */
    look?: string;
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
  /** The beat role this scene plays (question, step, recap, hook ...). Set by the script writer. */
  role?: string;
  /** In plain words, what the picture shows while this is said: the director's intent for the scene. */
  visual?: string;
  /** The uploaded screenshot shown in this scene, or null/absent for none. */
  screenshotId?: string | null;
};

export type ProjectScript = {
  source: "generated" | "provided";
  lines: ProjectScriptLine[];
  confirmed: boolean;
  updatedAt: string;
  /** The film's working title and kind, set by the script writer (backend/src/plan/script-draft.ts). */
  title?: string;
  videoType?: import("./beat-plan.ts").VideoType;
  /** Other first lines (different patterns: question, bold claim, who-it's-for, pattern interrupt) the person can swap in for scene 1. */
  hooks?: string[];
  /** The text to post with the finished video: names the product, ready to paste. */
  caption?: string;
};

/** What a vision read found in an uploaded screenshot: what it is, what is on it and where, so the director can place it. */
export type ScreenshotAnalysis = {
  title: string;
  summary: string;
  /** dashboard, table, chart, form, settings, editor, landing, mobile, chat, code, document or other. */
  kind: string;
  elements: string[];
  /** What a film can honestly use this screen to show. */
  bestFor: string;
  regions: { label: string; where: string }[];
};

export type ProjectScreenshot = {
  id: string;
  name: string;
  purpose: "Dashboard" | "Setup" | "Report" | "Mobile";
  width: number;
  height: number;
  createdAt: string;
  /** Set by the background vision read after upload; absent while pending, or if it failed. */
  analysis?: ScreenshotAnalysis;
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
/** The script director's job for a project: it runs on the server whether or not the page stays open (backend/src/plan/routes.ts). */
export type PlanningState = {
  status: "running" | "failed" | "cancelled";
  startedAt: string;
  /** Why it failed (status "failed"). */
  error?: string;
};

export type VideoProject = {
  id: string;
  /** Supabase user id of the creator; set by the backend, never trusted from a client body. */
  ownerId?: string;
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
  /** The script canvas's reference frames (contracts/script-stream.ts). Left out of the project list; read with the project. */
  scriptFrames?: ScriptFrame[];
  /** The film's first frame (SVG text): the project card's thumbnail, so it matches the video. Kept in the project list. */
  coverFrame?: string;
  /** The rendered film's real length in seconds (set at Render; the card shows it). */
  filmSeconds?: number;
  /** Motion directed for each scene when the film was last rendered (backend/src/plan/frame-motion.ts), by signature. */
  filmMotion?: { signature: string; svg: string; motion: FrameMotion[] }[];
  /** Durable generated style keyframes, clips and provider operation checkpoints. */
  planVisuals?: PlanVisuals;
  /** Loaded from the current brand row, never trusted from client input. */
  visualBrandSignature?: string;
  /** The product website read for this project (backend/src/site). */
  site?: SiteCapture;
  /** Present while the script director is writing (or after it failed or was cancelled); cleared when the plan is applied. */
  planning?: PlanningState;
  /** Present once a pro user has opened the project in the Pro Editor (backend/src/pro). */
  pro?: ProManifest;
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

export * from "./scene-rendering.ts";
