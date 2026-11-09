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
    case "e0-queued":
      return {
        id: "job-hf-queued",
        state: "queued",
        stage: "queued",
        progress: 0,
        attempt: 1,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision
      };
    case "e0-preparing":
      return {
        id: "job-hf-preparing",
        state: "rendering",
        stage: "preparing",
        progress: 25,
        attempt: 1,
        createdAt: "2026-11-04T12:05:00.000Z",
        revision: baseRevision
      };
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

const HOW_MONEY_EVOLVES_BEATS = [
  {
    id: "b1",
    keyword: "A hen wants bread",
    visual: "hen in big shoes hops up to market-stall where loaf waves from the counter, a curl of steam rising off loaf's hat.",
    onScreen: null,
    line: "A hen wants bread.",
    role: "setup" as const
  },
  {
    id: "b2",
    keyword: "Eggs, no thanks",
    visual: "hen lifts egg-basket high; loaf shakes its head, pie-cut eyes squeezed shut, pushing egg-basket back with one gloved hand.",
    onScreen: null,
    line: "She offers eggs. But the loaf already has eggs, and wants a warm coat.",
    role: "problem" as const
  },
  {
    id: "b3",
    keyword: "The long swap",
    visual: "hen trudges a looping dotted path away from market-stall, egg-basket wobbling, feathers drooping lower with each step on twos.",
    onScreen: "Trading thing for thing",
    line: "So she'd have to find someone with shoes who wants eggs, then trade for a coat, then trade for bread.",
    role: "problem" as const
  },
  {
    id: "b4",
    keyword: "A pretty shell",
    visual: "hen and loaf both point at one shell on the counter, nodding together on the beat, shell glinting with a tiny wink.",
    onScreen: "Something everyone agrees on",
    line: "Until they agree a shell is worth something, to anyone, any day.",
    role: "turn" as const
  },
  {
    id: "b5",
    keyword: "Shell to coin",
    visual: "shell on the counter squashes and pops into a round coin with a face, which tips its tiny hat at hen.",
    onScreen: null,
    line: "Shells chip, so the shell becomes a coin. Small, sturdy, easy to count.",
    role: "turn" as const
  },
  {
    id: "b6",
    keyword: "Coin to paper",
    visual: "a tall stack of coin teeters in hen's arms, then flattens into one paper-note that floats down into her glove.",
    onScreen: null,
    line: "Coins get heavy, so a paper note stands in for the stack.",
    role: "turn" as const
  },
  {
    id: "b7",
    keyword: "Still warm",
    visual: "hen hands paper-note to loaf; loaf hands back a slice of itself, steam curling up as hen dances off on twos.",
    onScreen: null,
    line: "She gets her bread. It's still just a promise everyone agrees to keep.",
    role: "resolution" as const
  }
];

function HfFinalFixtureInner() {
  useMediaToken();
  const searchParams = useSearchParams();
  const state = searchParams.get("state") ?? "a-ready-16x9";
  const theme = searchParams.get("theme");
  const mode = searchParams.get("mode");
  const aspectParam = searchParams.get("aspect");
  const showHeader = searchParams.get("header") === "1";
  const [approvedOverride, setApprovedOverride] = useState(false);

  useEffect(() => {
    setApprovedOverride(false);
  }, [state]);

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const aspect =
    aspectParam === "9:16" || aspectParam === "1:1" || aspectParam === "16:9"
      ? aspectParam
      : mode === "plate-reload" || state === "b-ready-9x16"
      ? "9:16"
      : "16:9";
  const isApproved = state === "c-ready-approved" || approvedOverride;

  const project: VideoProject = useMemo(() => {
    if (mode === "plate-reload") {
      return {
        ...FIXTURE_HF_PROJECT,
        id: "316f1cbd-b5b9-49af-ae3b-2add10a18ed5",
        name: "how money evolves",
        state: isApproved ? "Approved" : "Rendering draft",
        request: {
          ...FIXTURE_HF_PROJECT.request,
          prompt: "how money evolves",
          format: aspect === "9:16" ? "portrait" : "landscape"
        },
        brief: {
          ...FIXTURE_HF_PROJECT.brief!,
          text: "how money evolves",
          aspect: aspect as "16:9" | "9:16" | "1:1",
          aspects: [aspect as "16:9" | "9:16" | "1:1"],
          look: "illus-rubber-hose",
          styleExample: "story-illus-rubber-hose",
          videoType: "story",
          scriptBeats: HOW_MONEY_EVOLVES_BEATS.map((b) => ({
            keyword: b.keyword,
            visual: b.visual,
            onScreen: b.onScreen,
            line: b.line
          }))
        },
        beatPlan: {
          ...FIXTURE_HF_PROJECT.beatPlan!,
          canvas: aspect as "16:9" | "9:16" | "1:1",
          beats: HOW_MONEY_EVOLVES_BEATS.map((b, i) => ({
            ...FIXTURE_HF_PROJECT.beatPlan!.beats[0]!,
            id: b.id,
            role: b.role,
            keyword: b.keyword,
            on_screen: b.onScreen ?? null,
            line: b.line,
            success: i === HOW_MONEY_EVOLVES_BEATS.length - 1
          }))
        },
        // Simulates listProjects() stripping scriptFrames on direct reload at step=3
        scriptFrames: undefined
      };
    }

    const baseBeats =
      mode === "long"
        ? FIXTURE_HF_PROJECT.brief!.scriptBeats!.map((b, i) => ({
            ...b,
            keyword: `Scene ${i + 1}: ${b.keyword} — Extended Narrative Storyboard Sequence`,
            onScreen: `${b.onScreen} with detailed subtitle and on-screen callout copy`
          }))
        : FIXTURE_HF_PROJECT.brief?.scriptBeats;

    return {
      ...FIXTURE_HF_PROJECT,
      name:
        mode === "long"
          ? "How Money Evolves: From Barter Markets and Cowrie Shells to Modern Digital Ledgers"
          : FIXTURE_HF_PROJECT.name,
      state: isApproved ? "Approved" : "Ready for review",
      brief: FIXTURE_HF_PROJECT.brief
        ? {
            ...FIXTURE_HF_PROJECT.brief,
            aspect: aspect as "16:9" | "9:16" | "1:1",
            aspects: [aspect as "16:9" | "9:16" | "1:1"],
            scriptBeats: baseBeats
          }
        : undefined,
      beatPlan: FIXTURE_HF_PROJECT.beatPlan
        ? {
            ...FIXTURE_HF_PROJECT.beatPlan,
            canvas: aspect as "16:9" | "9:16" | "1:1"
          }
        : undefined,
      scriptFrames:
        mode === "hf-reload"
          ? undefined
          : mode === "empty" || mode === "partial"
          ? []
          : FIXTURE_HF_PROJECT.scriptFrames
    };
  }, [aspect, isApproved, mode]);

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
      ? mode === "long"
        ? "The renderer timed out while encoding scene 4 (Shell to coin — 1080x1920 @ 30fps) after 2 automatic retries. Your storyboard and scene assets are saved; click Try again to resume."
        : "The renderer timed out while encoding scene 4. Please try again."
      : null;

  const framesProp = useMemo(() => {
    if (mode === "plate-reload" || mode === "hf-reload" || mode === "empty") {
      return [];
    }
    if (mode === "partial") {
      return [
        FIXTURE_HF_FRAMES[0]!,
        null,
        FIXTURE_HF_FRAMES[2]!,
        null,
        FIXTURE_HF_FRAMES[4]!
      ];
    }
    return FIXTURE_HF_FRAMES;
  }, [mode]);

  return (
    <main
      className="relay-shell"
      data-fixture-state={state}
      style={{
        minHeight: "100vh",
        height: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}
    >
      {showHeader && (
        <header className="creation-header">
          <div className="creation-project">
            <button type="button">← Projects</button>
            <i />
            <strong>{project.name}</strong>
            <span>{job.state === "ready" ? "Ready for review" : failedStateLabel(job, error)}</span>
          </div>
          <ol className="flow-steps">
            {(
              [
                [0, "Brief"],
                [1, "Storyboard"],
                [2, "Animation"],
                [3, "Render"]
              ] as const
            ).map(([id, label], position) => (
              <li key={label}>
                <button
                  type="button"
                  className={id === 3 ? "current" : "complete"}
                >
                  <b>{id < 3 ? "✓" : position + 1}</b>
                  {label}
                </button>
                {position !== 3 && <i />}
              </li>
            ))}
          </ol>
        </header>
      )}
      <FinalRenderStep
        project={project}
        job={job}
        frames={framesProp}
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

function failedStateLabel(job: RenderJob, error: string | null) {
  if (error || job.state === "failed") return "Render needs attention";
  return "Rendering draft";
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
