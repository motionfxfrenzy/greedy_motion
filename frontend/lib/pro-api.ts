import type { PreviewQuality, ProManifest, RenderJob } from "@videosaas/contracts";
import { createClient } from "../utils/supabase/client";
import { ensureMediaToken, getRenderJob, outputUrl } from "./api.ts";

/**
 * Pro Editor API client (backend/src/pro/routes.ts). Kept apart from api.ts, which the Studio owns; it reuses that file's
 * media token and render-job helpers and adds the editor's own calls. Requests go through the same-origin /api/backend rewrite.
 */
const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ProApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function proFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { data } = await createClient().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api/backend${path}`, { ...init, headers });
  } catch {
    throw new ProApiError(0, "offline", "We couldn't reach the service. Your changes are kept here and will be saved when it is back.");
  }
  if (response.status === 401 && typeof window !== "undefined") window.location.href = "/auth?next=" + encodeURIComponent(window.location.pathname);
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
  if (!response.ok) throw new ProApiError(response.status, body.error?.code ?? "error", body.error?.message ?? "Something went wrong.", { ...(body.error ?? {}), ...body });
  return body;
}

export async function getPro(projectId: string): Promise<ProManifest | null> {
  const body = (await proFetch(`/projects/${projectId}/pro`)) as { pro: ProManifest | null };
  return body.pro;
}

export async function openPro(projectId: string, input: { source?: "beat-plan" | "blank"; aspect?: "16:9" | "9:16" | "1:1"; durationSeconds?: number } = {}): Promise<ProManifest> {
  const body = (await proFetch(`/projects/${projectId}/pro/open`, { method: "POST", body: JSON.stringify(input) })) as { pro: ProManifest };
  return body.pro;
}

export async function readProFile(projectId: string, path: string): Promise<{ path: string; content: string; rev: number }> {
  return (await proFetch(`/projects/${projectId}/pro/file?path=${encodeURIComponent(path)}`)) as { path: string; content: string; rev: number };
}

/** Writes files against a revision. A stale revision throws a ProApiError with status 409 and `detail.rev`. */
export async function writeProFiles(projectId: string, baseRev: number, files: { path: string; content: string }[]): Promise<{ rev: number; updatedAt: string }> {
  return (await proFetch(`/projects/${projectId}/pro/files`, { method: "PUT", body: JSON.stringify({ baseRev, files }) })) as { rev: number; updatedAt: string };
}

export type LintFinding = { code: string; severity: "error" | "warning" | "info"; message: string; line?: number; elementId?: string; fixHint?: string };
export async function lintPro(projectId: string): Promise<{ rev: number; ok: boolean; errorCount: number; warningCount: number; findings: LintFinding[] }> {
  return (await proFetch(`/projects/${projectId}/pro/lint`, { method: "POST", body: JSON.stringify({}) })) as { rev: number; ok: boolean; errorCount: number; warningCount: number; findings: LintFinding[] };
}

export async function renderPro(projectId: string, quality: PreviewQuality): Promise<RenderJob> {
  const body = (await proFetch(`/projects/${projectId}/pro/render`, { method: "POST", body: JSON.stringify({ quality }) })) as { job: RenderJob };
  return body.job;
}

export async function projectName(projectId: string): Promise<string | null> {
  const body = (await proFetch(`/projects/${projectId}`).catch(() => null)) as { name?: string } | null;
  return body?.name ?? null;
}

/**
 * The preview frame's URL. It is served from the backend's origin (not the app's), so the composition's scripts, images and
 * fonts load normally while the frame cannot reach the app's cookies or storage. The media token rides in the path
 * (backend auth.ts `pathToken`), because the page's own relative URLs do not carry a query.
 */
export async function previewFrame(projectId: string): Promise<string> {
  const token = await ensureMediaToken();
  return `${apiOrigin}/v1/preview/projects/${projectId}/pro/@${token}/__frame.html`;
}

export async function jobStatus(jobId: string): Promise<{ state: "queued" | "running" | "done" | "failed"; pct: number; frames?: { done: number; total: number }; url?: string; error?: string }> {
  const job = await getRenderJob(jobId);
  const waiting = job.state === "rendering" && job.stage === "waiting";
  if (job.state === "ready") return { state: "done", pct: 100, url: outputUrl(job.output?.url ?? `/v1/renders/${jobId}`) };
  if (job.state === "failed") return { state: "failed", pct: job.progress, error: job.error?.message ?? "The render failed." };
  return { state: waiting ? "queued" : "running", pct: job.frames ? (job.frames.done / Math.max(1, job.frames.total)) * 100 : job.progress, ...(job.frames ? { frames: job.frames } : {}) };
}
