"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PlateFinal, PlatePreview } from "../../../components/plate-preview";
import { TokenModal } from "../../../components/script-canvas";
import { FIXTURE_PROJECT } from "../../../test/fixtures/workspace/data";

function PlatePreviewFixtureInner() {
  const searchParams = useSearchParams();
  const state = searchParams.get("state") ?? "c-ready";
  const theme = searchParams.get("theme");
  const prepParam = searchParams.get("prep") as "sound" | "scenes" | "motion" | null;
  const [tokenModalOpen, setTokenModalOpen] = useState(false);

  useEffect(() => {
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const isFinal = state === "k-plate-final" || state === "q-plate-final-approved";

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
      {isFinal ? (
        <PlateFinal
          project={FIXTURE_PROJECT}
          finalUrl={`/api/backend/projects/${FIXTURE_PROJECT.id}/plates/export/16-9`}
          onBack={() => {}}
          onApprove={() => {}}
          approved={state === "q-plate-final-approved"}
        />
      ) : (
        <PlatePreview
          project={FIXTURE_PROJECT}
          onBack={() => {}}
          onRender={() => setTokenModalOpen(true)}
          rendering={false}
          cost={15}
          prep={prepParam}
        />
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
