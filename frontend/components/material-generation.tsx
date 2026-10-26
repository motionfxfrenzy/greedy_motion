"use client";
import { useEffect, useRef, useState } from "react";
import { getLook, type VideoProject, type VisualStatus } from "@videosaas/contracts";
import { generatePlanVisuals, getPlanVisuals } from "../lib/api";

export function MaterialGeneration({ project, onReady }: { project: VideoProject; onReady: () => unknown }) {
  const [status, setStatus] = useState<VisualStatus | null>(null);
  const [budget, setBudget] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const refreshedRun = useRef<string | null>(null);
  const ready = useRef(onReady); ready.current = onReady;
  const required = getLook(project.brief?.look).renderMode === "generated";
  useEffect(() => {
    if (!required) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await getPlanVisuals(project.id);
        if (!live) return;
        setStatus(next); setError(null);
        if (next.status === "ready" && next.runId && refreshedRun.current !== next.runId) { refreshedRun.current = next.runId; ready.current(); }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "Could not check generation."); }
      if (live) timer = setTimeout(refresh, 5000);
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [project.id, project.updatedAt, required]);
  if (!required || status?.required === false) return null;
  const busy = sending || status?.status === "queued" || status?.status === "generating";
  return <section className="bs-warnings material-generation" aria-label="Material scenes">
    <b>{getLook(project.brief?.look).name} scenes</b>
    <p role="status">{status?.status === "ready" ? `All ${status.total} material scenes are ready for preview and export.` : busy ? `Generating scenes: ${status?.ready ?? 0}/${status?.total ?? "…"} ready. You can leave this page; work continues.` : "The preview starts as a layout draft. Generate the material scenes before submitting the film."}</p>
    {(error || status?.error) && <p role="alert">{error ?? status?.error}</p>}
    {status && !status.available && <p>Material generation is unavailable until the service’s generation provider is configured.</p>}
    {status && status.status !== "ready" && <>
      <p>New-run estimate: ${status.estimateUsd.toFixed(2)} · Project reservations: ${status.reservedUsd.toFixed(2)}. Includes earlier runs. This is an application estimate, not a provider billing cap.</p>
      <label>Project reservation ceiling (USD) <input type="number" min="1" max={status.maxBudgetUsd} step="0.01" value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))} /></label>{" "}
      <button type="button" disabled={busy || !status.available || budget <= 0 || budget > status.maxBudgetUsd} onClick={async () => {
        setSending(true); setError(null);
        try { setStatus(await generatePlanVisuals(project.id, budget)); }
        catch (e) { setError(e instanceof Error ? e.message : "Could not start generation."); }
        finally { setSending(false); }
      }}>{busy ? "Generating…" : status.status === "failed" ? "Resume generation" : "Generate material scenes"}</button>
    </>}
  </section>;
}
