"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  findTheme,
  themes,
  type RenderJob,
  type VideoProject
} from "@videosaas/contracts";
import type { FrameLook } from "../../../components/beat-storyboard";
import { FinalRenderStep } from "../../../components/final-render-step";
import { useMediaToken } from "../../../lib/use-media-token";
import {
  FIXTURE_HF_FRAMES,
  FIXTURE_HF_PROJECT
} from "../../../test/fixtures/hf/data";

declare global {
  interface Window {
    __hfFinalBackCount?: number;
    __hfFinalApproveCount?: number;
    __hfFinalRetryCount?: number;
    __hfFinalApproveDelayMs?: number;
  }
}

function buildFixtureJob(state: string, projectId: string, aspect: string): RenderJob {
  const baseRevision: RenderJob["revision"] = {
    id: "rev-hf-final-1",
    title: FIXTURE_HF_PROJECT.name,
    scenes: []
  };

  const outFile = aspect === "9:16" ? "output-9x16.mp4" : "output-16x9.mp4";
  const readyOutput: RenderJob["output"] = {
    url: `/v1/projects/${projectId}/${outFile}`,
    format: "mp4",
    durationSeconds: 4
  };

  switch (state) {
    case "e1-rendering-waiting":
      return {
        id: "job-hf-waiting",
        state: "rendering",
        stage: "waiting",
        progress: 10,
        queuePosition: 2,
        attempt: 1,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision
      };
    case "e2-rendering-frames":
    case "e-rendering":
      return {
        id: "job-hf-frames",
        state: "rendering",
        stage: "frames",
        progress: 60,
        frames: { done: 360, total: 600 },
        attempt: 1,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision
      };
    case "e3-rendering-encoding":
      return {
        id: "job-hf-encoding",
        state: "rendering",
        stage: "encoding",
        progress: 90,
        attempt: 1,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision
      };
    case "f-rendering-retry":
      return {
        id: "job-hf-retry",
        state: "rendering",
        stage: "retrying",
        progress: 35,
        attempt: 2,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision
      };
    case "g-failed":
      return {
        id: "job-hf-failed",
        state: "failed",
        stage: "failed",
        progress: 0,
        attempt: 2,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision,
        error: {
          code: "render_failed",
          message: "The renderer timed out while encoding scene 4. Please try again."
        }
      };
    case "a-ready-16x9":
    case "b-ready-9x16":
    case "c-ready-approved":
    case "d-ready-seek-mid":
    default:
      return {
        id: "job-hf-ready",
        state: "ready",
        stage: "done",
        progress: 100,
        attempt: 1,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision,
        output: readyOutput
      };
  }
}

function HfFinalFixtureInner() {
  useMediaToken();
  const searchParams = useSearchParams();
  const state = searchParams.get("state") ?? "a-ready-16x9";
  const theme = searchParams.get("theme");
  const [approvedOverride, setApprovedOverride] = useState(false);

  useEffect(() => {
    setApprovedOverride(false);
  }, [state]);

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const aspect = state === "b-ready-9x16" ? "9:16" : "16:9";
  const isApproved = state === "c-ready-approved" || approvedOverride;

  const project: VideoProject = useMemo(() => {
    return {
      ...FIXTURE_HF_PROJECT,
      state: isApproved ? "Approved" : "Ready for review",
      brief: FIXTURE_HF_PROJECT.brief
        ? {
            ...FIXTURE_HF_PROJECT.brief,
            aspect: aspect as "16:9" | "9:16" | "1:1",
            aspects: [aspect as "16:9" | "9:16" | "1:1"]
          }
        : undefined,
      beatPlan: FIXTURE_HF_PROJECT.beatPlan
        ? {
            ...FIXTURE_HF_PROJECT.beatPlan,
            canvas: aspect as "16:9" | "9:16" | "1:1"
          }
        : undefined
    };
  }, [aspect, isApproved]);

  const look: FrameLook = useMemo(() => {
    const tokens = (findTheme(project.brief?.theme ?? "neutral") ?? themes[0]!).tokens;
    return {
      bg: tokens.bg,
      fg: tokens.fg,
      muted: tokens.muted,
      brand: tokens.brand,
      accent: tokens.accent,
      font: tokens.fontDisplay
    };
  }, [project.brief?.theme]);

  const job = useMemo(
    () => buildFixtureJob(state, project.id, aspect),
    [state, project.id, aspect]
  );

  const error =
    state === "g-failed"
      ? "The renderer timed out while encoding scene 4. Please try again."
      : null;

  return (
    <main
      className="relay-shell"
      data-fixture-state={state}
      style={{
        minHeight: "100vh",
        height: "100vh",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <FinalRenderStep
        project={project}
        job={job}
        frames={FIXTURE_HF_FRAMES}
        aspect={aspect}
        look={look}
        error={error}
        busy={false}
        retry={async () => {
          window.__hfFinalRetryCount = (window.__hfFinalRetryCount ?? 0) + 1;
        }}
        backToAnimation={() => {
          window.__hfFinalBackCount = (window.__hfFinalBackCount ?? 0) + 1;
        }}
        approve={async () => {
          window.__hfFinalApproveCount = (window.__hfFinalApproveCount ?? 0) + 1;
          const delay = window.__hfFinalApproveDelayMs ?? 50;
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
          }
          setApprovedOverride(true);
        }}
      />
    </main>
  );
}

export default function HfFinalFixturePage() {
  if (process.env.NEXT_PUBLIC_LIVE_DEV !== "1") {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <HfFinalFixtureInner />
    </Suspense>
  );
}
