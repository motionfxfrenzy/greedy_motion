import { createClient } from "../utils/supabase/client";
import { normalizeSearch } from "@videosaas/contracts/gallery-use-cases";
import type { BrandExtraction, BrandKit, BrandKitInput, GalleryPage, GalleryStyleCard, ScriptBeat, ScriptBrief, ScriptNotes, SiteCapture, ProjectStudioDraft, RenderJob, RenderRequest, VideoProject } from "@videosaas/contracts";

// Public by design: the backend origin, e.g. https://api.<domain>. The frontend holds no secrets.
const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

// Every backend call carries the signed-in user's Supabase access token; a 401 sends them back to sign in.
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await createClient().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  let response: Response;
  try {
    // Browser API calls share the app origin; the server rewrite reaches the configured backend.
    const url = input.startsWith(apiOrigin + "/v1/") ? input.replace(apiOrigin + "/v1/", "/api/backend/") : input;
    response = await fetch(url, { ...init, headers, signal: init.signal ?? ((init.method ?? "GET") === "GET" ? AbortSignal.timeout(15_000) : undefined) });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error("We couldn't reach the service. Your changes are still here. Check your connection and try again.");
  }
  if ([502, 503, 504].includes(response.status)) throw new Error("The service is temporarily unavailable. Please try again shortly.");
  if (response.status === 401 && typeof window !== "undefined") window.location.href = "/auth?next=" + encodeURIComponent(window.location.pathname);
  return response;
}

type ApiError = { error?: { message?: string } };

// ---------- Media links ----------
// <img>, <video> and the preview iframe cannot send the Authorization header, so media URLs carry a
// short-lived media token as ?t= (backend/src/media-links.ts). It is fetched once, shared, and renewed an
// hour before it expires; useMediaToken() re-renders a component when it changes.

type MediaToken = { token: string; expiresAt: string };
let mediaTokenValue: MediaToken | null = null;
let mediaTokenRequest: Promise<string> | null = null;
const mediaTokenListeners = new Set<() => void>();
const freshFor = (token: MediaToken | null, ms: number) => Boolean(token && Date.parse(token.expiresAt) - Date.now() > ms);

/** The current media token ("" until the first one arrives). */
export const currentMediaToken = () => mediaTokenValue?.token ?? "";

export function subscribeMediaToken(listener: () => void) {
  mediaTokenListeners.add(listener);
  return () => { mediaTokenListeners.delete(listener); };
}

/** A media token valid for at least another hour, fetching a new one when needed. */
export function ensureMediaToken(): Promise<string> {
  if (freshFor(mediaTokenValue, 3_600_000)) return Promise.resolve(mediaTokenValue!.token);
  mediaTokenRequest ??= apiFetch(`${apiOrigin}/v1/media-token`, { cache: "no-store" })
    .then((response) => parse<MediaToken>(response, "Could not authorize media."))
    .then((next) => {
      mediaTokenValue = next;
      mediaTokenListeners.forEach((listener) => listener());
      return next.token;
    })
    .finally(() => { mediaTokenRequest = null; });
  return mediaTokenRequest;
}

/** Adds the media token to a backend media URL. */
export function withMediaToken(url: string) {
  const token = currentMediaToken();
  return token ? `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}` : url;
}

async function parse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(payload.error?.message ?? fallback);
  return payload;
}

export async function createRenderJob(request: RenderRequest) {
  const response = await apiFetch(`${apiOrigin}/v1/render-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  return parse<RenderJob>(response, "Could not create the render job.");
}

export async function getRenderJob(id: string) {
  const response = await apiFetch(`${apiOrigin}/v1/render-jobs/${id}`, { cache: "no-store" });
  return parse<RenderJob>(response, "Could not load the render job.");
}

/**
 * Follows a render job as the server pushes it (`GET /v1/renders/:id/events`, server-sent events read with fetch because
 * EventSource cannot send the Authorization header). `onJob` gets the current view at once and after every change.
 * Resolves when the job is ready or failed; rejects when the stream drops, so the caller can fall back to polling.
 */
export async function watchRenderJob(id: string, onJob: (job: RenderJob) => void, signal: AbortSignal): Promise<RenderJob> {
  const response = await apiFetch(`${apiOrigin}/v1/renders/${encodeURIComponent(id)}/events`, { cache: "no-store", signal });
  if (!response.ok || !response.body) throw new Error(`Could not follow the render (${response.status}).`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let last: RenderJob | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const block = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (!block.startsWith("data:")) continue; // ": ping" keep-alives
      last = JSON.parse(block.replace(/^data:\s*/, "")) as RenderJob;
      onJob(last);
    }
  }
  if (last && (last.state === "ready" || last.state === "failed")) return last;
  throw new Error("The render stream closed early.");
}

/** Output URLs from the backend are paths; resolve them against the backend origin. */
export function outputUrl(path: string) {
  return withMediaToken(new URL(path, apiOrigin).toString());
}

// ---------- Plan ----------

/** What the caller's plan allows (backend/src/entitlements). A failed lookup throws; it is never read as "no plan". */
export async function getMyEntitlements(): Promise<unknown> {
  const response = await apiFetch(apiOrigin + "/v1/me/entitlements", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not check the plan (${response.status}).`);
  return response.json();
}

export type TokenEntry = { id: number; amount: number; kind: string; reason: string; pool: "plan" | "free" | "pack"; projectId: string | null; createdAt: string };
export type TokenPool = { granted: number; used: number; remaining: number };
export type TokenSummary = {
  /** Everything that can be spent now. */
  remaining: number;
  /** This month's plan allowance, or null without a paid plan. `used` counts only since the last renewal. */
  plan: (TokenPool & { since: string }) | null;
  free: TokenPool;
  packs: { remaining: number };
  recent: TokenEntry[];
};

/** The caller's token balance and recent activity, read from the backend's ledger. */
export async function getMyTokens(): Promise<TokenSummary> {
  const response = await apiFetch(apiOrigin + "/v1/me/tokens", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read your tokens (${response.status}).`);
  const body = await response.json() as Partial<TokenSummary>;
  if (typeof body.remaining !== "number" || !body.free || !body.packs || !Array.isArray(body.recent)) throw new Error("Unexpected token response.");
  return body as TokenSummary;
}

export type Subscription = {
  tier: "free" | "starter" | "pro" | "business";
  status: string | null;
  renewsAt: string | null;
  endsAt: string | null;
  cancelAtPeriodEnd: boolean;
  portalUrl: string | null;
  updatePaymentUrl: string | null;
  /** False until the billing provider is configured: buy buttons then say paid plans are not open. */
  checkoutAvailable: boolean;
};

export async function getMySubscription(): Promise<Subscription> {
  const response = await apiFetch(apiOrigin + "/v1/me/subscription", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read your plan (${response.status}).`);
  return response.json() as Promise<Subscription>;
}

/** A hosted checkout for a plan or the token pack. The caller sends the browser to the returned link. */
export async function startCheckout(product: "starter" | "pro" | "business" | "topup"): Promise<string> {
  const response = await apiFetch(apiOrigin + "/v1/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product }) });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: { message?: string; portalUrl?: string } };
  if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not open checkout.");
  return body.url;
}

// ---------- Persisted projects ----------

export async function listProjects() {
  const response = await apiFetch(apiOrigin + "/v1/projects", { cache: "no-store" });
  return (await parse<{ projects: VideoProject[] }>(response, "Could not load projects.")).projects;
}

/** One project, for polling the open one while its script is written or its video renders. */
export async function getProject(id: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + id, { cache: "no-store" });
  return parse<VideoProject>(response, "Could not load the project.");
}

export async function createProject(input: { name?: string; request: RenderRequest }) {
  const response = await apiFetch(apiOrigin + "/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not create the project.");
}

export async function updateProject(id: string, input: Partial<Pick<VideoProject, "name" | "state" | "request" | "script" | "approvedAt">>) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not save the project.");
}

/**
 * Persist only template-declared text/number values and verified screenshot ids.
 * The backend validates the payload and increments the authoritative revision.
 */
export type SaveProjectStudioInput = Pick<ProjectStudioDraft, "values" | "assets">;

export async function saveProjectStudio(id: string, input: SaveProjectStudioInput) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(id) + "/studio", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parse<VideoProject>(response, "Could not save the Studio revision.");
}

export async function generateProjectScript(id: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + id + "/script", { method: "POST" });
  return parse<VideoProject>(response, "Could not generate the script.");
}

/** `motionBlur` is the person's choice at final submission; a preview never takes it. */
export async function renderProject(id: string, options: { motionBlur?: boolean } = {}) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + id + "/render", options.motionBlur ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motionBlur: true }) } : { method: "POST" });
  return parse<RenderJob>(response, "Could not start the render.");
}

export async function approveProject(id: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + id + "/approve", { method: "PUT" });
  return parse<VideoProject>(response, "Could not approve the project.");
}

export async function addProjectReviewComment(projectId: string, input: { body: string; timestampSeconds: number }) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + projectId + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not save the review comment.");
}

export async function removeProjectReviewComment(projectId: string, commentId: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + projectId + "/comments/" + commentId, { method: "DELETE" });
  return parse<VideoProject>(response, "Could not remove the review comment.");
}

export async function applyProjectReviewComments(projectId: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + projectId + "/comments/apply", { method: "POST" });
  return parse<{ project: VideoProject; job: RenderJob }>(response, "Could not apply the review comments.");
}

export async function uploadProjectScreenshot(projectId: string, file: File, purpose: "Dashboard" | "Setup" | "Report" | "Mobile" = "Dashboard") {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + projectId + "/screenshots", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Type": file.type, "X-File-Name": file.name, "X-Screenshot-Purpose": purpose }, body: file });
  return parse<VideoProject>(response, "Could not upload the screenshot.");
}

export async function removeProjectScreenshot(projectId: string, screenshotId: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + projectId + "/screenshots/" + screenshotId, { method: "DELETE" });
  return parse<VideoProject>(response, "Could not remove the screenshot.");
}

export function projectScreenshotUrl(projectId: string, screenshotId: string) {
  return withMediaToken(apiOrigin + "/v1/projects/" + projectId + "/screenshots/" + screenshotId);
}

// ---------- Script & Style plan (script director) ----------

export type PlanResult = { project: VideoProject; problems: string[]; model?: string };
export type PlanPatch = {
  beats?: { id: string; keyword?: string; on_screen?: string; line?: string; camera?: string; text_effect?: string | null; transition?: string; sfx?: string | null; scene?: string | null }[];
  order?: string[];
  suggestions?: { index: number; accepted: boolean }[];
  /** Drawing style (contracts looks.ts); saved without replanning. */
  look?: string;
  /** The style family (a look split into kinds of film); null clears it. */
  styleFamily?: string | null;
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
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parts ? { parts } : {}) });
  return parse<PlanAudioResult>(response, "Could not make the voice and music.");
}

/** Runs the script director (30–60 s): saves the brief, beat plan, and a matching script on the project. */
/** Starts the script director on the server (it keeps running if the page closes); the answer is the project with `planning` set. */
export async function planProject(projectId: string, brief: ScriptBrief) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) }).catch(() => {
    throw new Error("The backend is not reachable. Start it with npm run dev:backend.");
  });
  return parse<{ project: VideoProject }>(response, "Could not write the script.");
}

/** Writes the script first (seconds, not a minute): scene by scene, saved on the project for the person to read and edit. */
export async function draftScriptProject(projectId: string, brief: ScriptBrief) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/script-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) }).catch(() => {
    throw new Error("The backend is not reachable. Start it with npm run dev:backend.");
  });
  return parse<VideoProject>(response, "Could not write the script.");
}

/** Applies an instruction ("make it shorter") to the script as the person has edited it. */
export async function reviseScriptProject(projectId: string, instruction: string, brief: ScriptBrief) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/script-draft/revise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction, brief }) });
  return parse<VideoProject>(response, "Could not change the script.");
}

/** Stops the script director; nothing is applied. */
export type ScriptFlag = { beat: number; message: string };
export type ScriptStreamResult = { beats: ScriptBeat[]; notes: ScriptNotes | null; flags: ScriptFlag[]; ms: number };

/**
 * Writes the script and streams it into the canvas: `onText` gets every piece as it is written. With `change` it rewrites
 * the current script as asked (with `only`, just those beats come back, merged into the rest). Resolves with the finished, checked script; `signal` stops it.
 */
export async function streamScript(projectId: string, input: { brief: ScriptBrief; change?: { instruction: string; previous: ScriptBeat[]; notes?: ScriptNotes | null; only?: number[] } }, onText: (text: string) => void, signal?: AbortSignal): Promise<ScriptStreamResult> {
  const body = { brief: input.brief, ...(input.change ? { instruction: input.change.instruction, previous: input.change.previous, ...(input.change.notes ? { notes: input.change.notes } : {}), ...(input.change.only?.length ? { only: input.change.only } : {}) } : {}) };
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/script/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body) {
    const failed = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(failed.error?.message ?? "Could not write the script.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const event = JSON.parse(buffered.slice(0, end).replace(/^data:\s*/, "")) as { t?: string; done?: boolean; error?: string } & Partial<ScriptStreamResult>;
      buffered = buffered.slice(end + 2);
      if (event.t) onText(event.t);
      if (event.error) throw new Error(event.error);
      if (event.done) return { beats: event.beats ?? [], notes: event.notes ?? null, flags: event.flags ?? [], ms: event.ms ?? 0 };
    }
  }
  throw new Error("The script stopped before it finished. Try again.");
}

/** A voiceover take made by generatePlanAudio (`file` is "vo/<hash>.wav"), playable in an <audio> element (signed with the media token). */
export function planVoiceUrl(projectId: string, file: string) {
  return withMediaToken(`${apiOrigin}/v1/preview/plans/${encodeURIComponent(projectId)}/audio/${file.split("/").map(encodeURIComponent).join("/")}`);
}

export type FrameEvent = { index: number; svg?: string; error?: string };

/**
 * Draws a reference frame (SVG text) per beat in the template's style; `onFrame` gets each one as it lands, in any order.
 * `indices` limits it to the beats that changed. Resolves when every frame is drawn or has failed.
 */
export async function streamFrames(projectId: string, input: { brief: ScriptBrief; beats: ScriptBeat[]; indices?: number[]; notes?: ScriptNotes | null }, onFrame: (event: FrameEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/script/frames", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body) {
    const failed = (await response.json().catch(() => ({}))) as ApiError;
    throw new Error(failed.error?.message ?? "Could not draw the frames.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const event = JSON.parse(buffered.slice(0, end).replace(/^data:\s*/, "")) as FrameEvent & { done?: boolean };
      buffered = buffered.slice(end + 2);
      if (event.done) return;
      onFrame(event);
    }
  }
}

export async function cancelPlanJob(projectId: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan/job", { method: "DELETE" });
  return parse<{ project: VideoProject }>(response, "Could not cancel the script.");
}

export async function editPlan(projectId: string, patch: PlanPatch) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  if (response.status === 422) {
    const payload = (await response.json().catch(() => ({}))) as { problems?: string[]; error?: { message?: string } };
    throw new PlanProblems(payload.problems?.length ? payload.problems : [payload.error?.message ?? "That change breaks a storyboard rule."]);
  }
  return parse<VideoProject>(response, "Could not save the storyboard.");
}

export async function rewriteFrame(projectId: string, beatId: string, instruction: string) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/plan/beats/" + encodeURIComponent(beatId) + "/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction }) });
  return parse<VideoProject>(response, "Could not rewrite the frame.");
}

export async function getComposition(projectId: string, beatId?: string) {
  const query = beatId ? "?beat=" + encodeURIComponent(beatId) : "";
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/composition" + query, { cache: "no-store" });
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
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => {
    throw new Error("The backend is not reachable. Start it with npm run dev:backend.");
  });
  return parse<SiteResult>(response, "Could not read that website.");
}

// ---------- Brand kits ----------

export type StagedAsset = { assetId: string; kind: "logo" | "font"; format: string; width?: number; height?: number; tone?: "dark" | "light" | "color" };

export async function extractBrandFromUrl(url: string) {
  const response = await apiFetch(`${apiOrigin}/v1/brands/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  return parse<BrandExtraction>(response, "Could not read that website.");
}

export async function uploadBrandAsset(kind: "logo" | "font", file: File) {
  const response = await apiFetch(`${apiOrigin}/v1/brands/assets/${kind}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file });
  return parse<StagedAsset>(response, `Could not upload that ${kind}.`);
}

export async function saveBrandKit(input: BrandKitInput) {
  const response = await apiFetch(`${apiOrigin}/v1/brands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<BrandKit>(response, "Could not save the brand kit.");
}

/** Edits a saved kit in place. The logo is kept unless `logoAssetId` replaces it or `removeLogo` clears it. */
export async function updateBrandKit(id: string, input: BrandKitInput, options: { removeLogo?: boolean; removeVariants?: string[] } = {}) {
  const response = await apiFetch(`${apiOrigin}/v1/brands/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...(options.removeLogo ? { removeLogo: true } : {}), ...(options.removeVariants?.length ? { removeVariants: options.removeVariants } : {}) }) });
  return parse<BrandKit>(response, "Could not save the brand kit.");
}

export async function listBrandKits() {
  const response = await apiFetch(`${apiOrigin}/v1/brands`, { cache: "no-store" });
  return (await parse<{ brands: BrandKit[] }>(response, "Could not load brand kits.")).brands;
}

export const stagedLogoUrl = (assetId: string) => withMediaToken(`${apiOrigin}/v1/brands/assets/${assetId}/preview`);
export const brandLogoUrl = (brandId: string, variant?: string) => withMediaToken(`${apiOrigin}/v1/brands/${brandId}/logo${variant ? `?variant=${variant}` : ""}`);

export async function getPlanVisuals(projectId: string): Promise<import("@videosaas/contracts").VisualStatus> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/visuals`), "Could not load material generation.");
}
export async function generatePlanVisuals(projectId: string, budgetUsd: number): Promise<import("@videosaas/contracts").VisualStatus> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/visuals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ budgetUsd }) }), "Could not start material generation.");
}

// ---------- Template gallery (public; paging, filtering and search run on the backend) ----------
/** `reference` is the hand-built clip's source code (plain text), when the template has one: the author can reuse its structure and components. */
export type GalleryTemplateBrief = { id: string; name: string; starterId?: string; brief: Partial<ScriptBrief>; reference?: { name: string; url: string } };

export async function listGalleryTemplates(params: { useCase?: string; q?: string; look?: string; cursor?: string | null; limit?: number; featured?: boolean }, signal?: AbortSignal): Promise<GalleryPage> {
  const query = new URLSearchParams();
  if (params.useCase && params.useCase !== "all") query.set("use_case", params.useCase);
  const text = normalizeSearch(params.q);
  if (text) query.set("q", text);
  if (params.look) query.set("look", params.look);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.featured) query.set("featured", "1");
  const response = await fetch(`${apiOrigin}/v1/gallery/templates${query.size ? `?${query}` : ""}`, { signal });
  if (!response.ok) throw new Error("Could not load templates.");
  return response.json() as Promise<GalleryPage>;
}

/** Every visual style with its example count and one real example clip (the style picker). */
export async function listGalleryStyles(signal?: AbortSignal): Promise<GalleryStyleCard[]> {
  const response = await fetch(`${apiOrigin}/v1/gallery/styles`, { signal });
  if (!response.ok) throw new Error("Could not load styles.");
  return ((await response.json()) as { items: GalleryStyleCard[] }).items;
}

/** The starting values for a chosen template: example prompt, structure skill, look, length and sound. */
export async function getGalleryTemplate(id: string): Promise<GalleryTemplateBrief> {
  const response = await fetch(`${apiOrigin}/v1/gallery/templates/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Could not open that template.");
  return response.json() as Promise<GalleryTemplateBrief>;
}

// ---------- Library (screenshots across projects, paged by the backend) ----------
export type LibraryItem = { id: string; projectId: string; projectName: string; name: string; purpose: string; width: number; height: number; createdAt: string };
export type LibraryPage = { items: LibraryItem[]; total: number; nextCursor: string | null };

export async function listLibrary(params: { cursor?: string | null; limit?: number }): Promise<LibraryPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const response = await apiFetch(`${apiOrigin}/v1/library${query.size ? `?${query}` : ""}`);
  if (!response.ok) throw new Error("Could not load the library.");
  return response.json() as Promise<LibraryPage>;
}

// ---------- Story films (painted engine) ----------

export type PaintedLookOption = { id: string; engine: "doodle" | "oil"; name: string; blurb: string; script: string; available: boolean };
export type PaintedFilm = { id: string; projectId?: string; state: RenderJob["state"]; stage: string; progress: number; createdAt: string; look: string; script: string; drawIn: string; changedFrom?: string; durationSeconds?: number | null; lines?: string[]; error?: string };

export async function listPaintedLooks() {
  const response = await apiFetch(`${apiOrigin}/v1/painted/looks`);
  return parse<{ looks: PaintedLookOption[]; scriptMin: number; scriptMax: number }>(response, "Could not load the looks.");
}

export async function listPaintedFilms() {
  const response = await apiFetch(`${apiOrigin}/v1/painted/films`, { cache: "no-store" });
  return (await parse<{ films: PaintedFilm[] }>(response, "Could not load your films.")).films;
}

export async function getPaintedFilm(id: string) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/films/${encodeURIComponent(id)}`, { cache: "no-store" });
  return parse<PaintedFilm>(response, "Could not load the film.");
}

export async function createPaintedFilm(input: { script: string; look: string; drawIn: "opening" | "each" }) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/films`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<RenderJob & { seconds: number; tokens: number }>(response, "Could not start the film.");
}

export async function changePaintedFilm(id: string, comments: { line: number; text: string }[]) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/films/${encodeURIComponent(id)}/changes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comments }) });
  return parse<RenderJob>(response, "Could not apply the changes.");
}

export async function generatePaintedProjectStoryboard(input: {
  projectId?: string;
  mode: "idea" | "script";
  text: string;
  look: string;
  drawIn: "opening" | "each";
  aspect: "9:16" | "16:9";
  voice: string;
  musicMood?: string;
}) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return (await parse<{ project: VideoProject }>(response, "Could not start the storyboard.")).project;
}

export async function hydratePaintedProject(id: string) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/projects/${encodeURIComponent(id)}/hydrate`, {
    method: "POST"
  });
  return (await parse<{ project: VideoProject }>(response, "Could not load the film data.")).project;
}

export async function patchPaintedProject(
  id: string,
  patch: {
    look?: string;
    drawIn?: "opening" | "each";
    aspect?: "9:16" | "16:9";
    voice?: string;
    musicMood?: string;
    coverFrame?: string;
    lines?: { index: number; say?: string; scene?: string }[];
  }
) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  return (await parse<{ project: VideoProject }>(response, "Could not save your changes.")).project;
}

export async function changePaintedProjectScenes(id: string, comments: { line: number; text: string }[]) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/projects/${encodeURIComponent(id)}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comments })
  });
  return (await parse<{ project: VideoProject }>(response, "Could not apply the scene changes.")).project;
}

export async function animatePaintedProject(id: string) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/projects/${encodeURIComponent(id)}/animate`, {
    method: "POST"
  });
  return (await parse<{ project: VideoProject }>(response, "Could not start the animation.")).project;
}

export async function renderPaintedProject(id: string) {
  const response = await apiFetch(`${apiOrigin}/v1/painted/projects/${encodeURIComponent(id)}/render`, {
    method: "POST"
  });
  return parse<{ job: RenderJob; project: VideoProject; seconds: number; tokens: number }>(response, "Could not start the final render.");
}

export function paintedAudioUrl(projectId: string, version?: number) {
  return withMediaToken(`${apiOrigin}/v1/preview/projects/${encodeURIComponent(projectId)}/painted-audio?v=${version ?? 1}`);
}
