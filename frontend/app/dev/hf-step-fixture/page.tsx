"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { VideoProject } from "@videosaas/contracts";
import { BrowserAnimationStep } from "../../../components/browser-animation-step";
import {
  FIXTURE_HF_BEATS,
  FIXTURE_HF_FRAMES,
  FIXTURE_HF_PROJECT
} from "../../../test/fixtures/hf/data";

declare global {
  interface Window {
    __hfAppliedComments?: { line: number; text: string }[][];
    __hfRetryCount?: number;
    __hfBackCount?: number;
    __hfRenderCount?: number;
  }
}

function HfStepFixtureInner() {
  const searchParams = useSearchParams();
  const state = searchParams.get("state") ?? "c-ready";
  const theme = searchParams.get("theme");
  const audioModeParam = searchParams.get("audioMode") as
    | "voiceover"
    | "music"
    | "both"
    | "none"
    | null;
  const noVoiceTakes = searchParams.get("noVoice") === "1";
  const noMusicBed = searchParams.get("noMusic") === "1";

  const [animVersion, setAnimVersion] = useState(0);

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const aspect = state === "g4-portrait-9x16" ? "9:16" : "16:9";

  const project: VideoProject = useMemo(() => {
    const mode = audioModeParam ?? "both";
    return {
      ...FIXTURE_HF_PROJECT,
      brief: FIXTURE_HF_PROJECT.brief
        ? {
            ...FIXTURE_HF_PROJECT.brief,
            aspect: aspect as "16:9" | "9:16" | "1:1",
            audio: {
              ...FIXTURE_HF_PROJECT.brief.audio,
              mode
            }
          }
        : undefined,
      beatPlan: FIXTURE_HF_PROJECT.beatPlan
        ? {
            ...FIXTURE_HF_PROJECT.beatPlan,
            canvas: aspect as "16:9" | "9:16" | "1:1"
          }
        : undefined,
      planAudio: FIXTURE_HF_PROJECT.planAudio
        ? {
            ...FIXTURE_HF_PROJECT.planAudio,
            voice: noVoiceTakes ? null : FIXTURE_HF_PROJECT.planAudio.voice,
            music: noMusicBed ? null : FIXTURE_HF_PROJECT.planAudio.music
          }
        : undefined
    };
  }, [aspect, audioModeParam, noVoiceTakes, noMusicBed]);

  const animating =
    state === "a1-prep-frames" ||
    state === "a2-prep-voice" ||
    state === "a3-prep-motion" ||
    state === "g1-prep-no-frames";

  const animStage: "frames" | "voice" | "motion" =
    state === "a1-prep-frames" || state === "g1-prep-no-frames"
      ? "frames"
      : state === "a2-prep-voice"
      ? "voice"
      : "motion";

  const animProgress =
    state === "g1-prep-no-frames"
      ? 15
      : state === "a1-prep-frames"
      ? 20
      : state === "a2-prep-voice"
      ? 45
      : state === "a3-prep-motion"
      ? 70
      : 100;

  const animScenesDone = state === "a3-prep-motion" ? [0, 1, 2] : [0, 1, 2, 3, 4];

  const animError =
    state === "b-prep-error"
      ? "Timed out while directing scene 3 motion. Please try again."
      : null;

  const frames = state === "g1-prep-no-frames" ? [] : FIXTURE_HF_FRAMES;

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
      <BrowserAnimationStep
        project={project}
        beats={FIXTURE_HF_BEATS}
        frames={frames}
        aspect={aspect}
        animating={animating}
        animProgress={animProgress}
        animStage={animStage}
        animScenesDone={animScenesDone}
        animError={animError}
        animVersion={animVersion}
        busy={false}
        onRetryAnimate={() => {
          window.__hfRetryCount = (window.__hfRetryCount ?? 0) + 1;
          setAnimVersion((v) => v + 1);
        }}
        onBackToStoryboard={() => {
          window.__hfBackCount = (window.__hfBackCount ?? 0) + 1;
        }}
        onStartFinalRender={() => {
          window.__hfRenderCount = (window.__hfRenderCount ?? 0) + 1;
        }}
        onApplySceneComments={async (items) => {
          window.__hfAppliedComments = [...(window.__hfAppliedComments ?? []), items];
          if (state === "g3-applying-comments") {
            await new Promise(() => {});
          }
        }}
      />
    </main>
  );
}

export default function HfStepFixturePage() {
  if (process.env.NEXT_PUBLIC_LIVE_DEV !== "1") {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <HfStepFixtureInner />
    </Suspense>
  );
}
