import type { BrandExtraction, BrandKit, BrandKitInput, ScriptBrief, SiteCapture, ProjectStudioDraft, RenderJob, RenderRequest, VideoProject } from "@videosaas/contracts";

// Public by design: the backend origin, e.g. https://api.<domain>. The frontend holds no secrets.
const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

type ApiError = { error?: { message?: string } };

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(payload.error?.message ?? fallback);
  return payload;
}

export async function createRenderJob(request: RenderRequest) {
  const response = await fetch(`${apiOrigin}/v1/render-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  }).catch(() => {
    throw new Error("The backend is not reachable. Start it with npm run dev:backend.");
  });
  return parse<RenderJob>(response, "Could not create the render job.");
}

export async function getRenderJob(id: string) {
  const response = await fetch(`${apiOrigin}/v1/render-jobs/${id}`, { cache: "no-store" });
  return parse<RenderJob>(response, "Could not load the render job.");
}

/** Output URLs from the backend are paths; resolve them against the backend origin. */
export function outputUrl(path: string) {
  return new URL(path, apiOrigin).toString();
}

// ---------- Persisted projects ----------

export async function listProjects() {
  const response = await fetch(apiOrigin + "/v1/projects", { cache: "no-store" });
  return (await parse<{ projects: VideoProject[] }>(response, "Could not load projects.")).projects;
}

export async function createProject(input: { name?: string; request: RenderRequest }) {
  const response = await fetch(apiOrigin + "/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not create the project.");
}

export async function updateProject(id: string, input: Partial<Pick<VideoProject, "name" | "state" | "request" | "script" | "approvedAt">>) {
  const response = await fetch(apiOrigin + "/v1/projects/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not save the project.");
}

/**
 * Persist only template-declared text/number values and verified screenshot ids.
 * The backend validates the payload and increments the authoritative revision.
 */
export type SaveProjectStudioInput = Pick<ProjectStudioDraft, "values" | "assets">;

export async function saveProjectStudio(id: string, input: SaveProjectStudioInput) {
  const response = await fetch(apiOrigin + "/v1/projects/" + encodeURIComponent(id) + "/studio", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parse<VideoProject>(response, "Could not save the Studio revision.");
}

export async function generateProjectScript(id: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + id + "/script", { method: "POST" });
  return parse<VideoProject>(response, "Could not generate the script.");
}

export async function renderProject(id: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + id + "/render", { method: "POST" });
  return parse<RenderJob>(response, "Could not start the render.");
}

export async function approveProject(id: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + id + "/approve", { method: "PUT" });
  return parse<VideoProject>(response, "Could not approve the project.");
}

export async function addProjectReviewComment(projectId: string, input: { body: string; timestampSeconds: number }) {
  const response = await fetch(apiOrigin + "/v1/projects/" + projectId + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not save the review comment.");
}

export async function removeProjectReviewComment(projectId: string, commentId: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + projectId + "/comments/" + commentId, { method: "DELETE" });
  return parse<VideoProject>(response, "Could not remove the review comment.");
}

export async function applyProjectReviewComments(projectId: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + projectId + "/comments/apply", { method: "POST" });
  return parse<{ project: VideoProject; job: RenderJob }>(response, "Could not apply the review comments.");
}

export async function uploadProjectScreenshot(projectId: string, file: File, purpose: "Dashboard" | "Setup" | "Report" | "Mobile" = "Dashboard") {
  const response = await fetch(apiOrigin + "/v1/projects/" + projectId + "/screenshots", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Type": file.type, "X-File-Name": file.name, "X-Screenshot-Purpose": purpose }, body: file });
  return parse<VideoProject>(response, "Could not upload the screenshot.");
}

export async function removeProjectScreenshot(projectId: string, screenshotId: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + projectId + "/screenshots/" + screenshotId, { method: "DELETE" });
  return parse<VideoProject>(response, "Could not remove the screenshot.");
}

export function projectScreenshotUrl(projectId: string, screenshotId: string) {
  return apiOrigin + "/v1/projects/" + projectId + "/screenshots/" + screenshotId;
}

// ---------- Script & Style plan (script director) ----------

export type PlanResult = { project: VideoProject; problems: string[]; model?: string };
export type PlanPatch = {
  beats?: { id: string; keyword?: string; on_screen?: string; line?: string }[];
  order?: string[];
  suggestions?: { index: number; accepted: boolean }[];
};
/** A rejected storyboard edit: `problems` lists every rule it broke, in user-facing words. */
export class PlanProblems extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems[0] ?? "That change breaks a storyboard rule.");
    this.problems = problems;
  }
}
export type Composition = {
  engine: string;
  baseUrl: string;
  canvas: string;
  durationSeconds: number;
  variables: Record<string, string>;
  slots: { id: string; beat: string; budget: { chars?: number; words?: number } }[];
  /** Where each beat sits in the composition (beat-plan engine only), in seconds. */
  beatTimes?: Record<string, { start: number; end: number }>;
  /** Voice and music status for the plan (beat-plan engine). */
  audio?: PlanAudioStatus;
  /** Whether Submit can render the storyboard as is; `blocking` items point at the beat to fix. */
  readiness?: PlanReadiness;
};
export type PlanReadiness = {
  ok: boolean;
  blocking: { beat: string | null; message: string }[];
  warnings: { beat: string | null; message: string }[];
  durationSeconds: number | null;
};
export type PlanAudioStatus = {
  mode: "voiceover" | "music" | "both" | "none";
  voice?: { voice: string; lines: number; ready: number; stale: string[] };
  music?: { ready: boolean; model?: string; seconds?: number };
  ready: boolean;
  cost_usd?: number;
};
export type PlanAudioResult = { project: VideoProject; audio: PlanAudioStatus; durationSeconds: number; beatTimes: Record<string, { start: number; end: number }>; warnings: string[] };

/** Voices each line (cached by text) and makes the music bed. 5–8 s for voice, ~30 s with new music. */
export async function generatePlanAudio(projectId: string, parts?: ("voice" | "music")[]) {
  const response = await fetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parts ? { parts } : {}) });
  return parse<PlanAudioResult>(response, "Could not make the voice and music.");
}

/** Runs the script director (30–60 s): saves the brief, beat plan, and a matching script on the project. */
export async function planProject(projectId: string, brief: ScriptBrief) {
  const response = await fetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) }).catch(() => {
    throw new Error("The backend is not reachable. Start it with npm run dev:backend.");
  });
  return parse<PlanResult>(response, "Could not write the script.");
}

export async function editPlan(projectId: string, patch: PlanPatch) {
  const response = await fetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  if (response.status === 422) {
    const payload = (await response.json().catch(() => ({}))) as { problems?: string[]; error?: { message?: string } };
    throw new PlanProblems(payload.problems?.length ? payload.problems : [payload.error?.message ?? "That change breaks a storyboard rule."]);
  }
  return parse<VideoProject>(response, "Could not save the storyboard.");
}

export async function getComposition(projectId: string, beatId?: string) {
  const query = beatId ? "?beat=" + encodeURIComponent(beatId) : "";
  const response = await fetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/composition" + query, { cache: "no-store" });
  return parse<Composition>(response, "Could not load the composition.");
}

// ---------- Product site read ----------

export type SiteResult = {
  site: SiteCapture;
  /** Not saved: offered to the user for review in the brand kit editor. */
  brand: BrandExtraction | null;
  /** A kit the user already saved for the same host (newest first), if any. */
  savedBrand: BrandKit | null;
  screenshots: { id: string; name: string; section: string }[];
  project: VideoProject;
  warnings: string[];
};

/** Reads the product's site (20–30 s): facts for the script, a brand to review, and section screenshots. */
export async function readProductSite(projectId: string, url: string) {
  const response = await fetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => {
    throw new Error("The backend is not reachable. Start it with npm run dev:backend.");
  });
  return parse<SiteResult>(response, "Could not read that website.");
}

// ---------- Brand kits ----------

export type StagedAsset = { assetId: string; kind: "logo" | "font"; format: string; width?: number; height?: number; tone?: "dark" | "light" | "color" };

export async function extractBrandFromUrl(url: string) {
  const response = await fetch(`${apiOrigin}/v1/brands/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  return parse<BrandExtraction>(response, "Could not read that website.");
}

export async function uploadBrandAsset(kind: "logo" | "font", file: File) {
  const response = await fetch(`${apiOrigin}/v1/brands/assets/${kind}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
  return parse<StagedAsset>(response, `Could not upload that ${kind}.`);
}

export async function saveBrandKit(input: BrandKitInput) {
  const response = await fetch(`${apiOrigin}/v1/brands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<BrandKit>(response, "Could not save the brand kit.");
}

export async function listBrandKits() {
  const response = await fetch(`${apiOrigin}/v1/brands`, { cache: "no-store" });
  return (await parse<{ brands: BrandKit[] }>(response, "Could not load brand kits.")).brands;
}

export const stagedLogoUrl = (assetId: string) => `${apiOrigin}/v1/brands/assets/${assetId}/preview`;
export const brandLogoUrl = (brandId: string) => `${apiOrigin}/v1/brands/${brandId}/logo`;
