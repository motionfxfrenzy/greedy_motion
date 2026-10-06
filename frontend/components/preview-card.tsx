import type { RenderJob, Template } from "@videosaas/contracts";
import { outputUrl } from "../lib/api";
import { templatePreview } from "./template-picker";

type PreviewCardProps = { job: RenderJob | null; template: Template };

export function PreviewCard({ job, template }: PreviewCardProps) {
  const output = job?.state === "ready" ? job.output : undefined;
  return (
    <section className="preview-shell" aria-labelledby="preview-title">
      <div className="preview-heading">
        <div>
          <span className="eyebrow">02 · Render preview</span>
          <h1 id="preview-title">{job?.revision.title ?? template.name}</h1>
        </div>
        <span className="preview-badge">{output ? "Ready" : "Draft workspace"}</span>
      </div>
      <div className="preview-frame">
        {output ? (
          <video controls playsInline preload="metadata" src={outputUrl(output.url)} aria-label="Generated local preview" />
        ) : (
          <div className={`empty-preview ${job ? "is-working" : ""}`}>
            {/* Before rendering, show a real frame of the chosen template (rendered by the worker). */}
            <img className="template-poster" src={templatePreview(template)} alt={`${template.name} template preview`} />
            {job ? (
              <div className="preview-center">
                <span className="spark">✦</span>
                <p>{job.state === "planning" ? "Claude is writing your scenes…" : "Rendering your video…"}</p>
                <small>This render is kept as its own revision, separate from your next edit.</small>
              </div>
            ) : (
              <span className="poster-badge">Template preview · {template.durationSeconds} sec</span>
            )}
          </div>
        )}
      </div>
      <div className="preview-meta">
        <span>{output ? "Local MP4 · 1920 × 1080" : "No output yet"}</span>
        <span>{output ? `${output.durationSeconds} sec preview` : "Private by default"}</span>
      </div>
    </section>
  );
}
