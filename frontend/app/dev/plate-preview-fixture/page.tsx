"use client";

import type { VideoProject } from "@videosaas/contracts";
import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { PlateLiveOptions } from "../../../components/plate-live-stage";
import { PlateFinal, PlatePreview } from "../../../components/plate-preview";
import { TokenModal } from "../../../components/script-canvas";
import { getProject, renderProject } from "../../../lib/api";
import { isPlateLiveEnabled } from "../../../lib/live/flag";
import { FIXTURE_PROJECT } from "../../../test/fixtures/workspace/data";

const UNVERIFIED_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

function PlatePreviewFixtureInner() {
  const searchParams = useSearchParams();
  const state = searchParams.get("state") ?? "c-ready";
  const theme = searchParams.get("theme");
  const prepParam = searchParams.get("prep") as "sound" | "scenes" | "motion" | null;
  const projectParam = searchParams.get("project");
  const envParam = searchParams.get("env");

  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [realProject, setRealProject] = useState<VideoProject | null>(null);
  const [rendering, setRendering] = useState(false);
  const [decisions, setDecisions] = useState<
    { index: number; mode: "live" | "clip"; reason: string; state: string }[]
  >([]);

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    if (!projectParam) return;
    let active = true;
    getProject(projectParam)
      .then((proj) => {
        if (active) setRealProject(proj);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectParam]);

  const handleDecisionsChange = useCallback(
    (next: { index: number; mode: "live" | "clip"; reason: string; state: string }[]) => {
      setDecisions(next);
    },
    []
  );

  const liveEnabled = isPlateLiveEnabled();
  const isLiveFixtureState = state.startsWith("live-");

  const liveOptions: PlateLiveOptions | undefined = useMemo(() => {
    if (!liveEnabled && !isLiveFixtureState && !envParam) return undefined;
    const forceUnverified = state === "live-b-clip-fallback" || envParam === "unverified";
    return {
      ...(isLiveFixtureState ? { flagOverride: true } : {}),
      ...(forceUnverified ? { environment: UNVERIFIED_SAFARI_UA } : {}),
      ...(state === "live-a-playing" ? { initialTime: 2.0, initialPlaying: true, freezeClockAt: 2.0 } : {}),
      ...(state === "live-d-buffering" ? { forceBuffering: true } : {}),
      onDecisionsChange: handleDecisionsChange
    };
  }, [liveEnabled, isLiveFixtureState, envParam, state, handleDecisionsChange]);

  const isFinal = state === "k-plate-final" || state === "q-plate-final-approved";
  const activeProject = projectParam ? realProject : FIXTURE_PROJECT;

  const handleRender = () => {
    if (projectParam && activeProject) {
      setRendering(true);
      void renderProject(activeProject.id)
        .then((job) => {
          (window as unknown as { __lastRenderJobId?: string }).__lastRenderJobId = job.id;
        })
        .finally(() => {
          setRendering(false);
        });
      return;
    }
    setTokenModalOpen(true);
  };

  return (
    <main
      className="relay-shell"
      data-fixture-state={state}
      style={{
        minHeight: "100vh",
        height: isFinal ? "100vh" : undefined,
        display: "flex",
        flexDirection: "column"
      }}
    >
      {!activeProject ? null : isFinal ? (
        <PlateFinal
          project={activeProject}
          finalUrl={`/api/backend/projects/${activeProject.id}/plates/export/16-9`}
          onBack={() => {}}
          onApprove={() => {}}
          approved={state === "q-plate-final-approved"}
        />
      ) : (
        <PlatePreview
          project={activeProject}
          onBack={() => {}}
          onRender={handleRender}
          rendering={rendering}
          cost={15}
          prep={prepParam}
          liveOptions={liveOptions}
        />
      )}
      {(liveEnabled || isLiveFixtureState) && decisions.length > 0 && (
        <div
          data-testid="dev-live-decisions"
          style={{
            position: "fixed",
            bottom: 3,
            left: 24,
            zIndex: 35,
            pointerEvents: "none",
            fontFamily: "DMMono, monospace",
            fontSize: 10.5,
            lineHeight: 1.2,
            padding: "2px 7px",
            borderRadius: 6,
            background: "rgba(15, 23, 42, 0.78)",
            color: "#cbd5e1",
            border: "1px solid rgba(148, 163, 184, 0.25)"
          }}
        >
          {decisions.map((d) => `S${d.index + 1}:${d.mode}(${d.reason})`).join(" · ")}
        </div>
      )}
      {tokenModalOpen && (
        <TokenModal cost={15} balance={5} onClose={() => setTokenModalOpen(false)} />
      )}
    </main>
  );
}

export default function PlatePreviewFixturePage() {
  if (process.env.NEXT_PUBLIC_LIVE_DEV !== "1") {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <PlatePreviewFixtureInner />
    </Suspense>
  );
}
