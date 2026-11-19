"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderJob } from "@videosaas/contracts";
import { AppShell } from "../../components/app-shell";
import { getCutoutTalesStatus, getRenderJob, outputUrl, startCutoutTales, watchRenderJob, type CutoutTalesStatus } from "../../lib/api";

const SAMPLE = "Eighteen eighty-seven. A lone rider reached the town of Dustwater at sundown. The marshal was waiting at the saloon door. He did not smile. The rider tipped his hat and rode on.";

/** /cutout-tales (staging flag): script in, narrated cutout film out, via the normal render queue. */
export default function CutoutTalesPage() {
  const [status, setStatus] = useState<CutoutTalesStatus | null | "off">(null);
  const [script, setScript] = useState(SAMPLE);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [job, setJob] = useState<RenderJob | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { getCutoutTalesStatus().then((s) => setStatus(s.enabled ? s : "off")).catch(() => setStatus("off")); return () => abort.current?.abort(); }, []);

  async function start() {
    setBusy(true); setMessage("Recording the narration and planning the shots (about 20 seconds)…"); setJob(null);
    try {
      const queued = await startCutoutTales({ script, aspect });
      setJob(queued); setMessage("Rendering…");
      abort.current = new AbortController();
      const done = await watchRenderJob(queued.id, setJob, abort.current.signal).catch(async () => {
        for (;;) { await new Promise((r) => setTimeout(r, 3000)); const next = await getRenderJob(queued.id); setJob(next); if (next.state === "ready" || next.state === "failed") return next; }
      });
      setJob(done); setMessage(done.state === "ready" ? "Done." : done.error?.message ?? "The render failed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong."); } finally { setBusy(false); }
  }

  if (status === null) return <AppShell active="templates"><section style={{ padding: 32 }}>Loading…</section></AppShell>;
  if (status === "off") return <AppShell active="templates"><section style={{ padding: 32 }}><h1>Cutout tales</h1><p>This look is not enabled here.</p></section></AppShell>;
  return <AppShell active="templates"><section style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", display: "grid", gap: 16 }}>
    <h1>Cutout tales <small style={{ fontSize: 14, opacity: 0.7 }}>staging preview</small></h1>
    <p>Write a short story script (one idea per sentence). It is narrated, cut into shots with original characters, and rendered.</p>
    <label>Script<textarea value={script} onChange={(e) => setScript(e.target.value)} rows={6} maxLength={status.limits.scriptMax} style={{ width: "100%" }} /></label>
    <label>Frame <select value={aspect} onChange={(e) => setAspect(e.target.value as "16:9" | "9:16")}><option value="16:9">16:9 landscape</option><option value="9:16">9:16 portrait</option></select></label>
    <button type="button" disabled={busy || script.trim().length < status.limits.scriptMin} onClick={start}>{busy ? "Working…" : "Make the film"}</button>
    {message && <p role="status">{message}{job && job.state === "rendering" ? ` ${Math.round(job.progress)}%` : ""}</p>}
    {job?.state === "ready" && job.output && <video src={outputUrl(job.output.url)} controls style={{ width: "100%", maxHeight: 640 }} />}
  </section></AppShell>;
}
