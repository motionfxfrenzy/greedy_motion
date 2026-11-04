"use client";

import type { RenderJob, RenderStage, VideoProject } from "@videosaas/contracts";
import { FinalView, buildHfFinalRatios, finalRatioShape } from "./animation-workspace";
import { FrameReel, Preview } from "./browser-animation-step";
import type { FrameLook } from "./beat-storyboard";
import { svgSrc } from "./script-canvas";
import { outputUrl, projectScreenshotUrl } from "../lib/api";

/** White or near-black, whichever reads better on the brand colour (WCAG relative luminance). */
export function readableOnBrand(hex: string): "#fff" | "#0a0d12" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const channel = (i: number) => {
    const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? "#0a0d12" : "#fff";
}

export const renderSteps: { key: string; label: string; stages: RenderStage[] }[] = [
  { key: "plan", label: "Writing the storyboard", stages: ["queued", "planning"] },
  { key: "audio", label: "Making music and voiceover", stages: ["audio"] },
  { key: "wait", label: "Getting your video ready", stages: ["waiting"] },
  { key: "prepare", label: "Preparing composition", stages: ["preparing", "retrying"] },
  { key: "frames", label: "Rendering frames", stages: ["frames"] },
  { key: "encode", label: "Adding audio and encoding", stages: ["encoding"] }
];

/**
 * Step 4 (Render): Vertically locked (100vh) final MP4 encoding & download/approval view.
 * Reached after the user reviews the browser animation in Step 3 and clicks "Final render".
 */
export function FinalRenderStep({
  project,
  job,
  frames,
  aspect,
  look,
  error,
  busy,
  retry,
  backToAnimation,
  approve
}: {
  project: VideoProject;
  job: RenderJob | null;
  frames: string[];
  aspect: string;
  look?: FrameLook;
  error: string | null;
  busy: boolean;
  retry: () => Promise<void>;
  backToAnimation: () => void;
  approve: () => Promise<void>;
}) {
  if (job?.state === "ready" && job.output) {
    const ratioId =
      project.brief?.aspect ??
      (aspect === "9:16" || aspect === "1:1" ? aspect : "16:9");
    const ratios = buildHfFinalRatios(
      project.id,
      ratioId,
      outputUrl(job.output.url)
    );
    const poster = project.brief?.look?.startsWith("illus-")
      ? outputUrl(`/v1/projects/${encodeURIComponent(project.id)}/plates/0/still`)
      : frames[0]
      ? svgSrc(frames[0])
      : project.coverFrame
      ? svgSrc(project.coverFrame)
      : undefined;

    return (
      <FinalView
        title="Your film"
        subtitle="Watch and download your video. Need a change? Go back to Animation, edit, and render again."
        ratios={ratios}
        initialRatio={ratios[0]!.id}
        shape={finalRatioShape}
        poster={poster}
        onBack={backToAnimation}
        onApprove={approve}
        approved={project.state === "Approved"}
      />
    );
  }

  const title = project.script?.lines[0]?.onScreen || "Your video is rendering.";
  const failed = Boolean(error) || job?.state === "failed";
  const steps = renderSteps.filter((item) => item.key !== "plan" && item.key !== "audio");
  const stage: RenderStage = job?.stage ?? (job?.state === "ready" ? "done" : job?.state === "rendering" ? "preparing" : "queued");
  const current = stage === "done" ? steps.length : Math.max(0, steps.findIndex((item) => item.stages.includes(stage)));
  const detail = (key: string) => {
    if (key === "wait" && stage === "waiting") return job?.queuePosition ? `${job.queuePosition} ahead` : "Usually under a minute";
    if (key === "frames" && job?.frames) return `${job.frames.done} / ${job.frames.total}`;
    return null;
  };

  return (
    <div
      className="render-workspace"
      style={{
        flex: "1 1 0",
        minHeight: 0,
        overflow: "hidden",
        padding: "16px 28px 20px",
        boxSizing: "border-box",
        alignItems: "stretch"
      }}
    >
      <section
        className="workspace-player"
        style={{
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {frames.length ? (
          <FrameReel frames={frames} />
        ) : (
          <Preview
            project={project}
            title={title}
            look={look}
            screenshot={project.screenshots[0] ? projectScreenshotUrl(project.id, project.screenshots[0].id) : undefined}
          />
        )}
      </section>
      <aside
        className="render-card"
        style={{
          ...(look ? ({ "--rc": look.brand, "--rc-on": readableOnBrand(look.brand) } as React.CSSProperties) : {}),
          height: "100%",
          minHeight: 0,
          overflowY: "auto"
        }}
      >
        <header>
          <b>{failed ? "Render needs attention" : "Rendering final MP4"}</b>
          <span>{aspect}</span>
        </header>
        {failed ? (
          <div className="render-error">
            <b>We could not render this project.</b>
            <p>{error || job?.error?.message}</p>
            <div className="render-error-actions">
              <button disabled={busy} onClick={() => void retry()}>
                {busy ? "Starting…" : "Try again"}
              </button>
              <button className="render-error-back" onClick={backToAnimation}>
                Back to Animation
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="render-walkaway">
              <b>You can walk away.</b> Final MP4 encoding keeps going on our servers whether or not this page is open.
            </p>
            <ol>
              {steps.map((item, index) => (
                <li className={index < current ? "done" : index === current ? "current" : ""} key={item.key}>
                  <i>{index < current ? "✓" : index + 1}</i>
                  <span>{item.label}</span>
                  {index === current && detail(item.key) && <small>{detail(item.key)}</small>}
                </li>
              ))}
            </ol>
            {stage === "retrying" && (
              <p className="render-retry">Attempt {job?.attempt ?? 1} hit a renderer error. Trying again automatically.</p>
            )}
            <button type="button" className="secondary-button" style={{ marginTop: 12 }} onClick={backToAnimation}>
              ← Back to browser Animation
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
