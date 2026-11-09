import { createClient } from "../utils/supabase/client";
import { normalizeSearch } from "@videosaas/contracts/gallery-use-cases";
import type { ActiveElementInfo, Beat, BeatLayoutHint, BeatPlan, ClassifierDecision, EditPatch, FrameElementsSnapshot, HyperFramesOverridesMap, BrandExtraction, BrandKit, BrandKitInput, GalleryPage, GalleryScope, GalleryStyleCard, ScriptBeat, ScriptBrief, ScriptNotes, SiteCapture, ProjectStudioDraft, RenderJob, RenderRequest, VideoProject } from "@videosaas/contracts";

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
  if (response.status === 403 && typeof window !== "undefined") {
    const cloned = response.clone();
    void cloned.json().then((body: ApiError) => {
      if (body?.error?.code === "invalid_email") {
        void createClient().auth.signOut().finally(() => {
          window.location.href = "/auth?error=invalid_email";
        });
      }
    }).catch(() => undefined);
  }
  return response;
}

type ApiError = { error?: { message?: string; code?: string; tier?: string; used?: number; limit?: number; needed?: number; remaining?: number } };

/**
 * The plan's allowance for films (free previews, or a month's films) is used up, or this film has had too many changes. The
 * screen answers it with a plan choice (`code` "preview_limit") or a plain explanation ("preview_call_cap"), never a raw error line.
 */
export class LimitError extends Error {
  constructor(
    message: string,
    /** preview_limit: films allowed by the plan are used; preview_call_cap: this film has had too many changes; insufficient_tokens: the balance does not cover the action; premium_requires_subscription: Free account requested Premium animation. */
    readonly code: "preview_limit" | "preview_call_cap" | "insufficient_tokens" | "premium_requires_subscription",
    readonly tier: string | null,
    readonly used: number | null,
    readonly limit: number | null,
    readonly needed: number | null = null,
    readonly remaining: number | null = null
  ) {
    super(message);
    this.name = "LimitError";
  }
}

/** The error to throw for a failed backend answer: a LimitError for an allowance refusal (402), else a plain Error with the backend's message. */
function failure(response: Response, body: ApiError, fallback: string): Error {
  const error = body.error;
  if (
    response.status === 402 &&
    (error?.code === "preview_limit" ||
      error?.code === "preview_call_cap" ||
      error?.code === "insufficient_tokens" ||
      error?.code === "premium_requires_subscription")
  ) {
    return new LimitError(error.message ?? fallback, error.code, error.tier ?? null, error.used ?? null, error.limit ?? null, error.needed ?? null, error.remaining ?? null);
  }
  return new Error(error?.message ?? fallback);
}

/** Asks the backend to send the one-time welcome email to the signed-in person. Best effort: it must never get in the way of signing up. */
export async function sendWelcomeEmail() {
  try {
    await apiFetch(`${apiOrigin}/v1/me/welcome`, { method: "POST" });
  } catch {
    // The welcome email is a nicety; the account is already created.
  }
}

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
  if (!response.ok) throw failure(response, payload, fallback);
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
/** What the final render takes, worked out by the server with the same function the render charges with (backend: render/quote.ts). */
export type RenderQuote = {
  seconds: number | null;
  tokens: number | null;
  parts: { start: number; perSecond: number; seconds: number | null };
  ready: boolean;
  material: { required: boolean; owedTokens: number };
  balance: number;
  enough: boolean;
  pricingVersion?: "v1_render_only" | "v2_step_tier";
  animationTier?: "standard" | "premium";
  exportTokens?: number | null;
  remainingGenerationTokens?: number;
  alreadyPaidTokens?: number;
  quoteId?: string | null;
};
export async function getRenderQuote(projectId: string): Promise<RenderQuote> {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/render/quote", { cache: "no-store" });
  return parse<RenderQuote>(response, "Could not work out the price.");
}

export type StepQuoteView = {
  quoteId: string;
  projectId: string;
  stage: string;
  pricingVersion: "v1_render_only" | "v2_step_tier";
  animationTier: "standard" | "premium";
  tokens: number;
  milli: number;
  unitsTotal: number;
  reusedUnits: number;
  workFingerprint: string;
  revisionDigest: string;
  expiresAt: string;
};

export type ProjectBillingOverview = {
  projectId: string;
  pricingVersion: "v1_render_only" | "v2_step_tier";
  planTier: "free" | "starter" | "pro" | "business";
  animationTier: "standard" | "premium";
  canUsePremium: boolean;
  premiumLockedCopy: string;
  balance: number;
  alreadyPaidTokens: number;
  steps: {
    scriptWrite: StepQuoteView;
    scriptEditBeat: StepQuoteView;
    storyboardPlan: StepQuoteView;
    frameSketch: StepQuoteView & { uncachedIndices: number[] };
    voiceMusic: StepQuoteView & { uncachedVoiceIndices: number[]; needsMusic: boolean };
    animation: StepQuoteView & { scenesToAuthor: number; scenesReused: number };
    renderExport: {
      seconds: number | null;
      tokens: number | null;
      exportTokens: number | null;
      remainingGenerationTokens: number;
      alreadyPaidTokens: number;
      quoteId: string | null;
    };
  };
  tiers: {
    standard: { available: boolean; animationQuoteTokens: number };
    premium: { available: boolean; lockedCopy: string; animationQuoteTokens: number };
  };
};

export async function getProjectBillingQuote(
  projectId: string,
  options?: { brief?: ScriptBrief; beats?: ScriptBeat[]; animationTier?: "standard" | "premium" }
): Promise<ProjectBillingOverview> {
  if (options?.brief || options?.beats || options?.animationTier) {
    const response = await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/billing/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options)
    });
    return parse<ProjectBillingOverview>(response, "Could not load the step quote.");
  }
  const response = await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/billing/quote`, { cache: "no-store" });
  return parse<ProjectBillingOverview>(response, "Could not load the step quote.");
}

/** Changes made to a film after it was first made, against the ones its start fee covers (backend: revision-meter). */
export type RevisionInfo = { used: number; free: number; tokens: number };
export async function getRevisions(projectId: string): Promise<RevisionInfo> {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/revisions", { cache: "no-store" });
  return parse<RevisionInfo>(response, "Could not load the changes used.");
}

export type PreviewUsage = { tier: string; period: string; used: number; limit: number };
/** Films the person has worked on this period (Free: ever) against their plan's allowance. */
export async function getMyPreviews(): Promise<PreviewUsage> {
  const response = await apiFetch(apiOrigin + "/v1/me/previews", { cache: "no-store" });
  return parse<PreviewUsage>(response, "Could not load your film allowance.");
}

export async function getMyTokens(): Promise<TokenSummary> {
  const response = await apiFetch(apiOrigin + "/v1/me/tokens", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read your tokens (${response.status}).`);
  const body = await response.json() as Partial<TokenSummary>;
  if (typeof body.remaining !== "number" || !body.free || !body.packs || !Array.isArray(body.recent)) throw new Error("Unexpected token response.");
  return body as TokenSummary;
}

export type Subscription = {
  tier: "free" | "starter" | "pro" | "business";
  interval?: "month" | "year" | null;
  status: string | null;
  renewsAt: string | null;
  tokensResetAt?: string | null;
  endsAt: string | null;
  cancelAtPeriodEnd: boolean;
  portalUrl: string | null;
  updatePaymentUrl: string | null;
  /** False until the billing provider is configured: buy buttons then say paid plans are not open. */
  checkoutAvailable: boolean;
  annualCheckoutAvailable?: boolean;
};

export async function getMySubscription(): Promise<Subscription> {
  const response = await apiFetch(apiOrigin + "/v1/me/subscription", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read your plan (${response.status}).`);
  return response.json() as Promise<Subscription>;
}

/** A hosted checkout for a plan (monthly or annual) or the token pack. The caller sends the browser to the returned link. */
export async function startCheckout(product: "starter" | "pro" | "business" | "topup", interval: "month" | "year" = "month"): Promise<string> {
  const payload = product === "topup" || interval === "month" ? { product } : { product, interval };
  const response = await apiFetch(apiOrigin + "/v1/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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

export async function updateProject(id: string, input: Partial<Pick<VideoProject, "name" | "state" | "request" | "brief" | "script" | "approvedAt" | "archived" | "keepOverLength">>) {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parse<VideoProject>(response, "Could not save the project.");
}

export async function deleteProject(id: string): Promise<void> {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(id), { method: "DELETE" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? "Could not delete the project.");
  }
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
export async function renderProject(id: string, options: { motionBlur?: boolean; quoteId?: string | null } = {}) {
  const hasBody = Boolean(options.motionBlur || options.quoteId);
  const response = await apiFetch(
    apiOrigin + "/v1/projects/" + id + "/render",
    hasBody
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(options.motionBlur ? { motionBlur: true } : {}),
            ...(options.quoteId ? { quoteId: options.quoteId } : {})
          })
        }
      : { method: "POST" }
  );
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
  beats?: { id: string; keyword?: string; on_screen?: string; line?: string; camera?: string; text_effect?: string | null; transition?: string; sfx?: string | null; scene?: string | null; hints?: BeatLayoutHint | null }[];
  order?: string[];
  suggestions?: { index: number; accepted: boolean }[];
  /** Drawing style (contracts looks.ts); saved without replanning. */
  look?: string;
  /** The style family (a look split into kinds of film); null clears it. */
  styleFamily?: string | null;
  /** The gallery template example for the chosen style; null clears it. */
  styleExample?: string | null;
  /** Caption mode ("key-phrases" | "full" | "none"). */
  captions?: "key-phrases" | "full" | "none";
  /** Film audio mode ("voiceover" | "music" | "both" | "none"). */
  audioMode?: "voiceover" | "music" | "both" | "none";
  /** Primary aspect ratio ("16:9" | "9:16" | "1:1"). */
  aspect?: "16:9" | "9:16" | "1:1";
  /** Selected multi-format aspect ratios. */
  aspects?: ("16:9" | "9:16" | "1:1")[];
  /** Animation authoring quality tier ("standard" | "premium"). */
  animationTier?: "standard" | "premium";
  /** Element-level overrides keyed by stable element id (`data-el`); null clears an entry or all overrides. */
  overrides?: Record<string, HyperFramesOverridesMap[string] | null> | null;
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
  overrides?: HyperFramesOverridesMap;
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
    throw failure(response, failed, "Could not write the script.");
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

export type SceneInsertResult = {
  project: VideoProject;
  insertedBeat: ScriptBeat;
  position: number;
  beats: ScriptBeat[];
  notes: ScriptNotes | null;
  flags: ScriptFlag[];
};

export type SceneRemoveResult = {
  project: VideoProject;
  index: number;
  removedBeat: ScriptBeat;
  removedPlanBeat: Beat | null;
  removedOverrides: Record<string, unknown>;
  beats: ScriptBeat[];
};

export type SceneRestoreResult = {
  project: VideoProject;
  index: number;
  restoredBeat: ScriptBeat;
  beats: ScriptBeat[];
};

/**
 * Generates and inserts ONE new scene at `input.position` (`0..previous.length`, e.g. `2` = between Scene 2 and Scene 3)
 * using neighboring story/style/cast context, without rewriting any other scene.
 */
export async function insertScriptScene(
  projectId: string,
  input: {
    brief: ScriptBrief;
    previous: ScriptBeat[];
    position: number;
    prompt: string;
    notes?: ScriptNotes | null;
    idempotencyKey?: string;
  },
  signal?: AbortSignal
): Promise<SceneInsertResult> {
  const response = await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/script/scenes/insert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {})
    },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {})
  });
  return parse<SceneInsertResult>(response, "Could not add the scene.");
}

/** Removes the scene at `input.index` (`0..beats.length - 1`), keeping cached frames and voice takes intact for Undo. */
export async function removeScriptScene(
  projectId: string,
  input: { index: number; brief?: ScriptBrief; beats?: ScriptBeat[] }
): Promise<SceneRemoveResult> {
  const response = await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/script/scenes/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parse<SceneRemoveResult>(response, "Could not remove the scene.");
}

/** Restores a removed scene at `input.index`, re-attaching its saved beat, plan beat, overrides, frame, and voice take. */
export async function restoreScriptScene(
  projectId: string,
  input: {
    index: number;
    beat: ScriptBeat;
    planBeat?: Beat | null;
    overrides?: Record<string, unknown> | null;
    brief?: ScriptBrief;
    beats?: ScriptBeat[];
  }
): Promise<SceneRestoreResult> {
  const response = await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/script/scenes/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parse<SceneRestoreResult>(response, "Could not restore the scene.");
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
    throw failure(response, failed, "Could not draw the frames.");
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

export type VoiceStreamEvent =
  | { type: "start"; total: number; progress: number }
  | { type: "take"; index: number; file: string; seconds: number; progress: number }
  | { type: "take-error"; index: number; error: string; progress: number }
  | { type: "music"; file: string; seconds: number; progress: number }
  | { type: "music-error"; error: string; progress: number }
  | { type: "done"; progress: number; failed: number; project: VideoProject | null };

/**
 * Streams voiceover takes (4 in parallel) and optional background music as each finishes, so each scene's
 * audio player appears immediately and the progress bar advances from 0% to 100%.
 */
export async function streamScriptVoice(
  projectId: string,
  input: { brief: ScriptBrief; beats: ScriptBeat[]; indices?: number[]; force?: boolean; includeMusic?: boolean },
  onEvent: (event: VoiceStreamEvent) => void,
  signal?: AbortSignal
): Promise<VideoProject | null> {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/script/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {})
  });
  if (!response.ok || !response.body) {
    const failed = (await response.json().catch(() => ({}))) as ApiError;
    throw failure(response, failed, "Could not record the voiceover.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let finalProject: VideoProject | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return finalProject;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const event = JSON.parse(buffered.slice(0, end).replace(/^data:\s*/, "")) as VoiceStreamEvent;
      buffered = buffered.slice(end + 2);
      onEvent(event);
      if (event.type === "done") finalProject = event.project ?? null;
    }
  }
}

export type AnimateStreamEvent =
  | { type: "stage"; stage: "frames" | "voice" | "motion"; done: number; total: number; progress: number }
  | { type: "frame"; index: number; done: number; total: number; progress: number }
  | { type: "voice"; index: number; done: number; total: number; progress: number }
  | { type: "music"; done: number; total: number; progress: number }
  | { type: "motion"; index: number; done: number; total: number; cached: boolean; progress: number }
  | { type: "done"; progress: number; project: VideoProject | null }
  | { type: "error"; error: string };

/**
 * Prepares the in-browser animation (drawing any missing frames, recording any missing voice/music,
 * and directing per-scene SVG motion in parallel) while streaming `0% -> 100%` progress.
 */
export async function streamScriptAnimate(
  projectId: string,
  input: { brief: ScriptBrief; beats: ScriptBeat[]; animationTier?: "standard" | "premium"; quoteId?: string },
  onEvent: (event: AnimateStreamEvent) => void,
  signal?: AbortSignal
): Promise<VideoProject | null> {
  const response = await apiFetch(apiOrigin + "/v1/projects/" + encodeURIComponent(projectId) + "/script/animate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {})
  });
  if (!response.ok || !response.body) {
    const failed = (await response.json().catch(() => ({}))) as ApiError;
    throw failure(response, failed, "Could not prepare the browser animation.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let finalProject: VideoProject | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return finalProject;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf("\n\n")) >= 0) {
      const event = JSON.parse(buffered.slice(0, end).replace(/^data:\s*/, "")) as AnimateStreamEvent;
      buffered = buffered.slice(end + 2);
      onEvent(event);
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "done") finalProject = event.project ?? null;
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

export type ProposePlanCommentCandidate = {
  id: string;
  patch?: EditPatch;
  refused?: string;
  fallbackRewrite?: boolean;
};

export type ProposePlanCommentEditsResponse = {
  planVersion: string;
  candidates: ProposePlanCommentCandidate[];
};

export type CommitPlanCommentItemResult = {
  id: string;
  scope: "element" | "scene";
  uiLabel: string;
  el?: string;
  fallbackRewrite?: boolean;
  patch: EditPatch;
  decision: ClassifierDecision;
  elementsBefore: ActiveElementInfo[];
  elementsAfter: ActiveElementInfo[];
};

export type CommitPlanCommentEditsResponse = {
  project: VideoProject;
  plan: BeatPlan;
  planVersion: string;
  results: CommitPlanCommentItemResult[];
  patch?: EditPatch;
  decision?: ClassifierDecision;
};

export class PlanEditRefusedError extends Error {
  readonly commentId: string | null;
  readonly problems: string[];
  constructor(message: string, commentId: string | null = null, problems: string[] = [message]) {
    super(message);
    this.name = "PlanEditRefusedError";
    this.commentId = commentId;
    this.problems = problems;
  }
}

/**
 * Step 1 of the two-step comment edit protocol (`POST /v1/projects/:id/plan/edit/propose`):
 * Sends comments + active-window snapshots measured in the user's browser; returns per-comment
 * candidate `EditPatch`es (or `{ refused: reason }`) and `planVersion`. Nothing is saved.
 */
export async function proposePlanCommentEdits(
  projectId: string,
  input: {
    comments: { id: string; at: number; scene?: number | string; body: string; patch?: EditPatch }[];
    measured: {
      canvas: { width: number; height: number };
      snapshots: Record<string, FrameElementsSnapshot[]>;
    };
  }
): Promise<ProposePlanCommentEditsResponse> {
  const response = await apiFetch(
    `${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plan/edit/propose`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (response.status === 409) {
    throw new Error("The plan changed; apply again");
  }
  return parse<ProposePlanCommentEditsResponse>(response, "Could not propose comment edits.");
}

/**
 * Step 2 of the two-step comment edit protocol (`POST /v1/projects/:id/plan/edit/commit`):
 * Sends `planVersion` and per-comment `{ id, patch, before, after }` snapshots measured in the browser
 * after locally applying the candidate patches. Re-runs the pure classifier on the server and saves.
 */
export async function commitPlanCommentEdits(
  projectId: string,
  input: {
    planVersion: string;
    items: {
      id: string;
      patch: EditPatch;
      before: FrameElementsSnapshot[];
      after: FrameElementsSnapshot[];
      fallbackRewrite?: boolean;
    }[];
  }
): Promise<CommitPlanCommentEditsResponse> {
  const response = await apiFetch(
    `${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plan/edit/commit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (response.status === 409) {
    throw new Error("The plan changed; apply again");
  }
  if (response.status === 422) {
    const payload = (await response.json().catch(() => ({}))) as {
      problems?: string[];
      commentId?: string;
      error?: { message?: string; commentId?: string };
    };
    const msg = payload.problems?.[0] ?? payload.error?.message ?? "That edit cannot be applied.";
    const cid = payload.commentId ?? payload.error?.commentId ?? null;
    throw new PlanEditRefusedError(msg, cid, payload.problems?.length ? payload.problems : [msg]);
  }
  return parse<CommitPlanCommentEditsResponse>(response, "Could not save comment edits.");
}

/** Undoes an element-level override (`DELETE /v1/projects/:id/plan/overrides/:el`). */
export async function undoPlanElementOverride(projectId: string, elId: string, options?: { clearHint?: boolean; planVersion?: string }): Promise<VideoProject> {
  const params = new URLSearchParams();
  if (options?.clearHint) params.set("hint", "1");
  if (options?.planVersion) params.set("planVersion", options.planVersion);
  const query = params.size ? `?${params.toString()}` : "";
  const response = await apiFetch(
    `${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plan/overrides/${encodeURIComponent(elId)}${query}`,
    { method: "DELETE" }
  );
  if (response.status === 409) {
    throw new Error("The plan changed; apply again");
  }
  return parse<VideoProject>(response, "Could not undo the element edit.");
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

/** Code-drawn plate scenes (backend plates/): one clip per storyboard beat, authored and drawn in the chosen style. */
export type PlateAspect = "16:9" | "9:16" | "1:1";
export type PlateVariantState = "queued" | "authoring" | "bundled" | "checked" | "rendering" | "drawn" | "failed";
export type PlateRetrying = { attempt: number; reason: string };
/** One ratio of one scene: `v` changes whenever its stored clip changes, so the player fetches the new one. */
export type PlateVariant = {
  state: PlateVariantState;
  sig: string;
  v: string | null;
  gen?: number;
  rev?: number;
  stage?: string;
  error?: string;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  playback?: "clip";
  drawMsPerFrame?: number;
  createdAt?: string;
  updatedAt?: string;
  frames?: number | null;
  framesDone?: number | null;
  authorMs?: number;
  drawnAt?: string | null;
  retrying?: PlateRetrying;
  stale?: boolean;
  needsReconcile?: boolean;
};
export type PlateScene = {
  index: number;
  keyword: string;
  state: PlateVariantState;
  seconds: number;
  frames?: number;
  framesDone?: number | null;
  sig: string;
  gen?: number;
  rev?: number;
  stage?: string;
  error?: string;
  attempts?: number;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
  playback?: "clip";
  drawMsPerFrame?: number;
  createdAt?: string;
  updatedAt?: string;
  authorMs?: number;
  drawnAt?: string | null;
  retrying?: PlateRetrying;
  stale?: boolean;
  needsReconcile?: boolean;
  variants?: Partial<Record<PlateAspect, PlateVariant>>;
};
export type PlateComment = { id: string; at: number; scene: number; sceneAt: number; body: string };
export type SubtitleMode = "none" | "key-phrases" | "full";
export type SubtitleStyle = "pill" | "cinema" | "kinetic" | "paper" | "blueprint";
export type PlateSubtitles = {
  mode: SubtitleMode;
  style: SubtitleStyle;
  size?: number;
  opacity?: number;
  color?: string | null;
  bgColor?: string | null;
  x?: number;
  y?: number;
  scenePositions?: Record<string, { x: number; y: number } | null> | null;
  voice?: boolean;
  music?: boolean;
  sfx?: boolean;
  transitions?: boolean;
  aspects?: ("16:9" | "9:16" | "1:1")[];
};
export type PlateSfxName = "whoosh-short" | "click" | "pop" | "chime" | "typing" | "impact-bass-1";
export const planSfxUrl = (name: PlateSfxName) => `${apiOrigin}/v1/preview/plan-sfx/${encodeURIComponent(name)}.mp3`;
export type PlateStatus = {
  available: boolean;
  look: string | null;
  mode?: "live" | "clip";
  serverNow?: string;
  revision?: string;
  stale?: boolean;
  needsReconcile?: boolean;
  scenes: PlateScene[];
  comments: PlateComment[];
  subtitles?: PlateSubtitles;
  running: boolean;
  drawnAspects?: ("16:9" | "9:16" | "1:1")[];
  drawingAspects?: ("16:9" | "9:16" | "1:1")[];
};
export async function getPlates(projectId: string): Promise<PlateStatus> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates`), "Could not load the scenes.");
}
export async function savePlateSubtitles(projectId: string, input: Partial<PlateSubtitles>): Promise<PlateSubtitles> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/subtitles`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }), "Could not update subtitles.");
}
export async function drawPlates(projectId: string, options?: { animationTier?: "standard" | "premium"; quoteId?: string }): Promise<PlateStatus> {
  return parse(
    await apiFetch(
      `${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/draw`,
      options
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }
        : { method: "POST" }
    ),
    "Could not start drawing the scenes."
  );
}
export async function drawPlateAspect(projectId: string, aspect: "16:9" | "9:16" | "1:1", options?: { animationTier?: "standard" | "premium"; quoteId?: string }): Promise<PlateStatus> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/draw-aspect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspect, ...(options ?? {}) }) }), "Could not draw this dimension.");
}
export async function addPlateComment(projectId: string, at: number, body: string): Promise<PlateComment> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ at, body }) }), "Could not add the comment.");
}
export async function removePlateComment(projectId: string, id: string): Promise<void> {
  const response = await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) throw new Error("Could not remove the comment.");
}
export async function fixPlates(projectId: string, options?: { animationTier?: "standard" | "premium"; quoteId?: string }): Promise<PlateStatus> {
  return parse(
    await apiFetch(
      `${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/fix`,
      options
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options) }
        : { method: "POST" }
    ),
    "Could not redraw the scenes."
  );
}
export function plateClipUrl(projectId: string, index: number, version: string, aspect?: "16:9" | "9:16" | "1:1") {
  const base = outputUrl(`/v1/projects/${encodeURIComponent(projectId)}/plates/${index}/clip`) + (outputUrl("/x").includes("?") ? "&" : "?") + `v=${encodeURIComponent(version)}`;
  return aspect ? `${base}&aspect=${encodeURIComponent(aspect)}` : base;
}
export function plateStillUrl(projectId: string, index: number, version?: string | null, aspect?: "16:9" | "9:16" | "1:1") {
  const raw = outputUrl(`/v1/projects/${encodeURIComponent(projectId)}/plates/${index}/still`);
  const params = new URLSearchParams();
  if (version) params.set("v", version);
  if (aspect) params.set("aspect", aspect);
  const qs = params.toString();
  if (!qs) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}${qs}`;
}
/** Where a companion export of one ratio stands. It is assembled on the render worker; this asks for it (once) and reports progress. */
export type PlateExportState = { state: "queued" | "assembling" | "ready" | "failed" | "drawing"; progress: number; stage?: string | null; error?: string; signature?: string; url?: string };
export async function requestPlateExport(projectId: string, aspect: PlateAspect): Promise<PlateExportState> {
  return parse(await apiFetch(`${apiOrigin}/v1/projects/${encodeURIComponent(projectId)}/plates/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspect }) }), "Could not prepare the video.");
}
export function plateExportUrl(projectId: string, aspect: "16:9" | "9:16" | "1:1", version?: string | null) {
  const slug = aspect === "9:16" ? "9-16" : aspect === "1:1" ? "1-1" : "16-9";
  const raw = outputUrl(`/v1/projects/${encodeURIComponent(projectId)}/plates/export/${slug}`);
  if (!version) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}


// ---------- Template gallery (public; paging, filtering and search run on the backend) ----------
/** `reference` is the hand-built clip's source code (plain text), when the template has one: the author can reuse its structure and components. */
export type GalleryTemplateBrief = { id: string; name: string; starterId?: string; brief: Partial<ScriptBrief>; reference?: { name: string; url: string } };

export const voicePreviewUrl = (voice: string) => `${apiOrigin}/v1/voices/${encodeURIComponent(voice)}/preview`;

export async function listGalleryTemplates(params: { useCase?: string; q?: string; look?: string; scope?: GalleryScope; cursor?: string | null; limit?: number; featured?: boolean }, signal?: AbortSignal): Promise<GalleryPage> {
  const query = new URLSearchParams();
  if (params.useCase && params.useCase !== "all") query.set("use_case", params.useCase);
  const text = normalizeSearch(params.q);
  if (text) query.set("q", text);
  if (params.look) query.set("look", params.look);
  if (params.scope && params.scope !== "all") query.set("scope", params.scope);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.featured) query.set("featured", "1");
  const response = await fetch(`${apiOrigin}/v1/gallery/templates${query.size ? `?${query}` : ""}`, { signal });
  if (!response.ok) throw new Error("Could not load templates.");
  return response.json() as Promise<GalleryPage>;
}

/** Every visual style with its example count and one real example clip (the style picker). */
export async function listGalleryStyles(signalOrOptions?: AbortSignal | { scope?: GalleryScope; signal?: AbortSignal }, maybeSignal?: AbortSignal): Promise<GalleryStyleCard[]> {
  const isSignal = Boolean(signalOrOptions && typeof (signalOrOptions as AbortSignal).aborted === "boolean");
  const scope = isSignal ? undefined : (signalOrOptions as { scope?: GalleryScope } | undefined)?.scope;
  const signal = isSignal ? (signalOrOptions as AbortSignal) : (maybeSignal ?? (signalOrOptions as { signal?: AbortSignal } | undefined)?.signal);
  const query = new URLSearchParams();
  if (scope && scope !== "all") query.set("scope", scope);
  const response = await fetch(`${apiOrigin}/v1/gallery/styles${query.size ? `?${query}` : ""}`, { signal });
  if (!response.ok) throw new Error("Could not load styles.");
  const payload = (await response.json()) as { items?: GalleryStyleCard[] } | GalleryStyleCard[];
  return Array.isArray(payload) ? payload : (payload.items ?? []);
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

