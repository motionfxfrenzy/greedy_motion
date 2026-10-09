/** Renders and lint for a project opened from the backend: the editor saves first, then asks the server. */
import type { PreviewQuality } from "@videosaas/contracts";
import { jobStatus, lintPro, renderPro, ProApiError } from "../pro-api.ts";
import { activeAutosave } from "./remote.ts";
import { useEditor } from "./store.ts";
import type { CheckIssue, Job } from "./types.ts";

const QUALITY: Record<string, PreviewQuality | null> = { "Preview · 540p": "draft540", "Preview · 720p": "preview720", "Render MP4": "final", "Full render": "final", "Render transparent": null };

const get = () => useEditor.getState();
const patchJob = (id: string, patch: Partial<Job>) => get().ui({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });

function poll(jobId: string) {
  const timer = setInterval(async () => {
    try {
      const status = await jobStatus(jobId);
      patchJob(jobId, { state: status.state, pct: status.pct, ...(status.frames ? { frames: status.frames.total, rate: 0 } : {}), ...(status.url ? { url: status.url } : {}), ...(status.error ? { err: status.error } : {}) });
      if (status.state === "done" || status.state === "failed") {
        clearInterval(timer);
        if (!get().jobs.some((j) => j.state === "running" || j.state === "queued")) get().ui({ engine: "ready" });
        get().say(status.state === "done" ? "Render finished." : status.error ?? "The render failed.");
      }
    } catch {
      /* a missed poll is retried on the next tick */
    }
  }, 1500);
}

/** Maps backend lint findings onto the editor's issue list (errors block a final render). */
const toIssues = (findings: { severity: string; message: string; elementId?: string; fixHint?: string; code?: string }[]): CheckIssue[] =>
  findings.filter((f) => f.severity !== "info").map((f) => ({ lvl: f.severity === "error" ? "error" : "warning", id: f.elementId ?? "", msg: f.message, hint: f.fixHint ?? f.code ?? "" }));

export async function remoteLint(): Promise<CheckIssue[]> {
  const remote = get().remote;
  if (!remote) return [];
  if (!(await activeAutosave()?.flush())) return [];
  const result = await lintPro(remote.projectId);
  return toIssues(result.findings);
}

export async function startRemoteRender(kind: string): Promise<void> {
  const s = get();
  const remote = s.remote;
  if (!remote) return;
  const quality = QUALITY[kind];
  if (quality === null || quality === undefined) return s.say("Transparent renders are not available for server projects yet.");
  if (s.readOnly || remote.status === "readonly") return s.say("This project is view-only: your Pro plan has ended.");
  if (remote.status === "conflict") return s.say("This project changed somewhere else. Reload before rendering.");
  if (!(await activeAutosave()?.flush())) return s.say("Your latest edit is not saved yet, so the render would miss it. Try again in a moment.");
  try {
    const job = await renderPro(remote.projectId, quality);
    const entry: Job = { id: job.id, kind, pct: 0, state: "queued", rate: 0, frames: 0 };
    get().ui({ jobs: [entry, ...get().jobs].slice(0, 12), renderOpen: true, engine: "rendering" });
    get().say(`${kind} queued.`);
    poll(job.id);
  } catch (error) {
    if (error instanceof ProApiError && error.code === "lint_errors") {
      const findings = (error.detail.findings as { message: string; elementId?: string; fixHint?: string }[] | undefined) ?? [];
      get().ui({ checks: toIssues(findings.map((f) => ({ ...f, severity: "error" }))), rightTab: "checks", rightOpen: true });
      return get().say(error.message);
    }
    if (error instanceof ProApiError && error.code === "read_only") get().ui({ readOnly: true });
    get().say(error instanceof Error ? error.message : "Could not start the render.");
  }
}

