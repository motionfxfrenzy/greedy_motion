"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isFilmBrief,
  scriptFrameKey,
  type RenderJob,
  type RenderStage,
  type ScriptBeat,
  type VideoProject
} from "@videosaas/contracts";
import { FinalView, buildHfFinalRatios, finalRatioShape, isPlateLookId } from "./animation-workspace";
import { FrameReel, type FrameReelItem } from "./browser-animation-step";
import type { FrameLook } from "./beat-storyboard";
import { svgSrc } from "./script-canvas";
import {
  ensureMediaToken,
  getPlates,
  getProject,
  outputUrl,
  plateStillUrl,
  projectScreenshotUrl,
  type PlateAspect,
  type PlateStatus
} from "../lib/api";
import { useMediaToken } from "../lib/use-media-token";

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

export function friendlyRenderErrorMessage(rawMessage: string | undefined | null, jobId?: string | null): string {
  const msg = (rawMessage ?? "").trim();
  if (!msg) return "We could not finish rendering this video. Click Try again or return to Animation.";
  const sceneMatch = /Scene\s+(\d+)\s+(?:needs a fix before rendering|could not be verified)/i.exec(msg);
  if (sceneMatch) {
    const sceneNum = sceneMatch[1];
    return `Scene ${sceneNum} needed an automatic adjustment before export. Click Try again to render with the updated scene, or go back to Animation to review Scene ${sceneNum}.${jobId ? ` (Ref: ${jobId.slice(0, 8)})` : ""}`;
  }
  return msg;
}

function resolveRenderAspect(project: VideoProject, aspectProp?: string): PlateAspect {
  if (aspectProp === "9:16" || aspectProp === "1:1" || aspectProp === "16:9") return aspectProp;
  if (
    project.brief?.aspect === "9:16" ||
    project.brief?.aspect === "1:1" ||
    project.brief?.aspect === "16:9"
  ) {
    return project.brief.aspect;
  }
  if (
    project.beatPlan?.canvas === "9:16" ||
    project.beatPlan?.canvas === "1:1" ||
    project.beatPlan?.canvas === "16:9"
  ) {
    return project.beatPlan.canvas;
  }
  return project.request.format === "portrait" ? "9:16" : "16:9";
}

function matchSavedScriptFrame(
  project: VideoProject,
  sceneIndex: number,
  beat: ScriptBeat | undefined,
  aspect: PlateAspect
): string | null {
  const saved = project.scriptFrames ?? [];
  if (saved.length > 0 && beat) {
    if (project.brief) {
      const exactKey = scriptFrameKey(beat, {
        styleExample: project.brief.styleExample,
        look: project.brief.look,
        aspect
      });
      const exact = saved.find((f) => f.key === exactKey)?.svg;
      if (exact) return exact;
    }
    const kw = (beat.keyword ?? "").trim().toLowerCase();
    const vis = (beat.visual ?? "").trim().toLowerCase();
    if (kw) {
      if (vis) {
        const byAspectKwVis = saved.find((f) => {
          const parts = f.key.split("\u0001");
          return (
            parts[3] === aspect &&
            (parts[4] ?? "").trim().toLowerCase() === kw &&
            (parts[5] ?? "").trim().toLowerCase() === vis
          );
        })?.svg;
        if (byAspectKwVis) return byAspectKwVis;
      }
      const byAspectKw = saved.find((f) => {
        const parts = f.key.split("\u0001");
        return parts[3] === aspect && (parts[4] ?? "").trim().toLowerCase() === kw;
      })?.svg;
      if (byAspectKw) return byAspectKw;

      const byKw =
        saved.find((f) => {
          const parts = f.key.split("\u0001");
          return (parts[4] ?? "").trim().toLowerCase() === kw;
        })?.svg ??
        saved.find((f) => f.key.toLowerCase().includes(`\u0001${kw}\u0001`))?.svg;
      if (byKw) return byKw;
    }
  }
  if (sceneIndex === 0 && project.coverFrame) {
    return project.coverFrame;
  }
  return null;
}

export function resolveRenderStoryboardScenes({
  project,
  job,
  aspect: aspectProp,
  frames,
  plateStatus,
  loadingProject = false,
  loadingPlates = false
}: {
  project: VideoProject;
  job?: RenderJob | null;
  aspect?: string;
  frames?: (string | null | undefined)[];
  plateStatus?: PlateStatus | null;
  loadingProject?: boolean;
  loadingPlates?: boolean;
}): {
  aspect: PlateAspect;
  items: FrameReelItem[];
  loading: boolean;
} {
  const aspect = resolveRenderAspect(project, aspectProp);
  const isPlate = isPlateLookId(project.brief?.look);
  const scriptBeats = project.brief?.scriptBeats ?? [];
  const planBeats = project.beatPlan?.beats ?? [];
  const plateScenes = plateStatus?.scenes ?? [];
  const scriptLines = project.script?.lines ?? [];
  const jobScenes = job?.revision?.scenes ?? [];

  const hasSparseEntries = Boolean(frames?.some((f) => f === null || f === undefined || f === ""));
  const authoritativeSceneCount =
    scriptBeats.length ||
    planBeats.length ||
    plateScenes.length ||
    scriptLines.length ||
    jobScenes.length ||
    (frames?.length ?? 0);

  const canIndexDirectFrames =
    Boolean(frames && frames.length > 0) &&
    (frames!.length === authoritativeSceneCount ||
      hasSparseEntries ||
      authoritativeSceneCount === frames!.length);

  const orderedScreenshots = project.brief?.screenshotIds?.length
    ? project.brief.screenshotIds
        .map((id) => project.screenshots.find((shot) => shot.id === id))
        .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot))
    : project.screenshots;

  let nextUiShotIdx = 0;
  const uiScreenshotByScene = new Map<number, string>();
  if ((!project.brief || !isFilmBrief(project.brief)) && orderedScreenshots.length > 0) {
    for (let i = 0; i < authoritativeSceneCount; i++) {
      const planBeat = planBeats[i];
      const scriptLine = scriptLines[i];
      if (scriptLine?.screenshotId) {
        const matched = project.screenshots.find((s) => s.id === scriptLine.screenshotId);
        if (matched) {
          uiScreenshotByScene.set(i, projectScreenshotUrl(project.id, matched.id));
          continue;
        }
      }
      if (planBeat?.kind === "ui") {
        const shot = orderedScreenshots[Math.min(nextUiShotIdx, orderedScreenshots.length - 1)]!;
        uiScreenshotByScene.set(i, projectScreenshotUrl(project.id, shot.id));
        nextUiShotIdx += 1;
      }
    }
  }

  const loading = Boolean(loadingProject || (isPlate && loadingPlates));
  const items: FrameReelItem[] = [];

  for (let i = 0; i < authoritativeSceneCount; i++) {
    const scriptBeat = scriptBeats[i];
    const planBeat = planBeats[i];
    const plateScene = plateScenes.find((s) => s.index === i);
    const scriptLine = scriptLines[i];
    const jobScene = jobScenes[i];

    const synthesizedBeat: ScriptBeat | undefined =
      scriptBeat ??
      (planBeat
        ? {
            keyword: planBeat.keyword,
            visual: null,
            onScreen: planBeat.on_screen ?? null,
            line: planBeat.line ?? null
          }
        : plateScene
        ? {
            keyword: plateScene.keyword,
            visual: null,
            onScreen: null,
            line: null
          }
        : undefined);

    const label =
      scriptBeat?.keyword ||
      planBeat?.keyword ||
      plateScene?.keyword ||
      scriptLine?.label ||
      jobScene?.detail ||
      jobScene?.label ||
      `Scene ${i + 1}`;

    const subtitle =
      scriptBeat?.onScreen ||
      planBeat?.on_screen ||
      scriptBeat?.line ||
      planBeat?.line ||
      scriptLine?.onScreen ||
      scriptLine?.voiceover ||
      null;

    const directRaw = canIndexDirectFrames ? frames?.[i] ?? null : null;
    const savedRaw = matchSavedScriptFrame(project, i, synthesizedBeat, aspect);
    const frameSvgSrc = directRaw ? svgSrc(directRaw) : savedRaw ? svgSrc(savedRaw) : null;

    let stillUrl: string | null = null;
    let isPlateVariantDrawn = false;
    const expectedBeatKeyword = (scriptBeat?.keyword ?? planBeat?.keyword ?? "").trim();
    const plateKeywordMatches =
      !expectedBeatKeyword ||
      !plateScene?.keyword ||
      plateScene.keyword.trim() === expectedBeatKeyword;
    const plateLookMatches =
      !plateStatus?.look ||
      !project.brief?.look ||
      plateStatus.look === project.brief.look;
    if (isPlate && plateScene && plateKeywordMatches && plateLookMatches) {
      const variant = plateScene.variants?.[aspect];
      const isStale = Boolean(
        variant?.stale ||
          plateScene.stale ||
          variant?.stage === "stale" ||
          plateScene.stage === "stale"
      );
      if (!isStale) {
        const vState = variant?.state ?? plateScene.state;
        const variantV = variant?.v ?? null;
        isPlateVariantDrawn = vState === "drawn" || Boolean(variantV);
        const hasBundleCandidate =
          isPlateVariantDrawn ||
          vState === "checked" ||
          vState === "rendering" ||
          Boolean(variant?.bundleDigest ?? plateScene.bundleDigest);
        const isPendingAuthor = vState === "queued" || vState === "authoring";
        if (hasBundleCandidate && !isPendingAuthor) {
          const rev = plateScene.rev ?? 0;
          const digestTag = (variant?.bundleDigest ?? plateScene.bundleDigest ?? plateScene.sig ?? "0").slice(0, 12);
          const vKey = `${variantV ?? digestTag}-${rev}`;
          stillUrl = plateStillUrl(project.id, i, vKey, aspect);
        }
      }
    }

    const uiShotUrl = uiScreenshotByScene.get(i) ?? null;

    let src: string | null = null;
    let fallbackSrc: string | null = null;

    if (isPlateVariantDrawn && stillUrl) {
      src = stillUrl;
      fallbackSrc = frameSvgSrc;
    } else if (frameSvgSrc) {
      src = frameSvgSrc;
      fallbackSrc = stillUrl ?? uiShotUrl;
    } else if (stillUrl) {
      src = stillUrl;
      fallbackSrc = uiShotUrl;
    } else if (uiShotUrl) {
      src = uiShotUrl;
    }

    items.push({
      index: i,
      label,
      subtitle,
      src,
      fallbackSrc,
      state: src ? "ready" : loading ? "loading" : "unavailable"
    });
  }

  return { aspect, items, loading };
}

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
  frames: (string | null | undefined)[];
  aspect: string;
  look?: FrameLook;
  error: string | null;
  busy: boolean;
  retry: () => Promise<void>;
  backToAnimation: () => void;
  approve: () => Promise<void>;
}) {
  const mediaToken = useMediaToken();
  const [loadedProject, setLoadedProject] = useState<VideoProject | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [plateStatus, setPlateStatus] = useState<PlateStatus | null>(null);
  const [loadingPlates, setLoadingPlates] = useState(false);

  const effectiveProject = useMemo(() => {
    if (!loadedProject || loadedProject.id !== project.id) return project;
    return {
      ...project,
      scriptFrames: project.scriptFrames ?? loadedProject.scriptFrames,
      coverFrame: project.coverFrame ?? loadedProject.coverFrame,
      brief: project.brief ?? loadedProject.brief,
      beatPlan: project.beatPlan ?? loadedProject.beatPlan
    };
  }, [project, loadedProject]);

  const isPlate = isPlateLookId(effectiveProject.brief?.look);
  const isReady = job?.state === "ready" && Boolean(job.output);

  useEffect(() => {
    setLoadedProject(null);
    setPlateStatus(null);
  }, [project.id]);

  // `listProjects()` omits `scriptFrames` for payload size; fetch the full project read-only on direct reload at step=3.
  useEffect(() => {
    if (isReady || project.scriptFrames !== undefined) {
      setLoadingProject(false);
      return;
    }
    let live = true;
    setLoadingProject(true);
    void getProject(project.id)
      .then((full) => {
        if (live) setLoadedProject(full);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoadingProject(false);
      });
    return () => {
      live = false;
    };
  }, [project.id, project.scriptFrames, isReady]);

  // For plate-style films, read existing plate scene metadata so drawn scene stills can be resolved without guessing URLs.
  useEffect(() => {
    if (isReady || !isPlate) {
      setLoadingPlates(false);
      return;
    }
    let live = true;
    setLoadingPlates(true);
    void ensureMediaToken()
      .catch(() => "")
      .then(() => getPlates(project.id))
      .then((status) => {
        if (live) setPlateStatus(status);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoadingPlates(false);
      });
    return () => {
      live = false;
    };
  }, [project.id, isPlate, isReady]);

  const storyboard = useMemo(
    () =>
      resolveRenderStoryboardScenes({
        project: effectiveProject,
        job,
        aspect,
        frames,
        plateStatus,
        loadingProject,
        loadingPlates
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mediaToken re-signs asset URLs
    [effectiveProject, job, aspect, frames, plateStatus, loadingProject, loadingPlates, mediaToken]
  );

  if (job?.state === "ready" && job.output) {
    const ratioId = resolveRenderAspect(effectiveProject, aspect);
    const ratios = buildHfFinalRatios(
      effectiveProject.id,
      ratioId,
      outputUrl(job.output.url)
    );
    const firstReadyFrame = storyboard.items.find((item) => item.src)?.src;
    const poster = effectiveProject.brief?.look?.startsWith("illus-")
      ? plateStillUrl(effectiveProject.id, 0, undefined, ratioId)
      : firstReadyFrame
      ? svgSrc(firstReadyFrame)
      : effectiveProject.coverFrame
      ? svgSrc(effectiveProject.coverFrame)
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
        approved={effectiveProject.state === "Approved"}
      />
    );
  }

  const failed = Boolean(error) || job?.state === "failed";
  const steps = renderSteps.filter((item) => item.key !== "plan" && item.key !== "audio");
  const stage: RenderStage =
    job?.stage ?? (job?.state === "ready" ? "done" : job?.state === "rendering" ? "preparing" : "queued");
  const current =
    stage === "done" ? steps.length : Math.max(0, steps.findIndex((item) => item.stages.includes(stage)));
  const detail = (key: string) => {
    if (key === "wait" && stage === "waiting") {
      return job?.queuePosition ? `${job.queuePosition} ahead` : "Usually under a minute";
    }
    if (key === "frames" && job?.frames) {
      return `${job.frames.done} / ${job.frames.total}`;
    }
    return null;
  };

  return (
    <div className="render-workspace">
      <section className="workspace-player" aria-label="Storyboard preview">
        <FrameReel
          items={storyboard.items}
          aspect={storyboard.aspect}
          loading={storyboard.loading}
          projectName={effectiveProject.name}
        />
      </section>
      <aside
        className="render-card"
        style={
          look
            ? ({ "--rc": look.brand, "--rc-on": readableOnBrand(look.brand) } as React.CSSProperties)
            : undefined
        }
      >
        <header>
          <b>{failed ? "Render needs attention" : "Rendering final MP4"}</b>
          <span>{storyboard.aspect}</span>
        </header>
        {failed ? (
          <div className="render-error">
            <b>We could not render this project.</b>
            <p>{friendlyRenderErrorMessage(error || job?.error?.message, job?.id)}</p>
            <div className="render-error-actions">
              <button disabled={busy} aria-busy={busy} onClick={() => void retry()}>
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
              <p className="render-retry">
                {isPlate
                  ? "Fixing a scene before export and continuing automatically…"
                  : `Attempt ${job?.attempt ?? 1} hit a renderer error. Trying again automatically.`}
              </p>
            )}
            <button type="button" className="secondary-button render-back-button" onClick={backToAnimation}>
              ← Back to browser Animation
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
