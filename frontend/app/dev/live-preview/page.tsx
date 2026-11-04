"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { fetchBundle, reportCheck, requestClip, runCheck } from "../../../lib/live/api";
import { environmentStatus, resolveCacheBudgetBytes } from "../../../lib/live/support";
import { createFilmPlayer, type FilmPlayer, type FilmSceneSpec } from "../../../lib/live/plate-player";
import { WorkerHost } from "../../../lib/live/worker-host";

type StatusScene = {
  index: number;
  keyword: string;
  state: string;
  seconds: number;
  frames?: number;
  variantId?: string;
  bundleDigest?: string | null;
  live?: boolean;
};

type PlateStatusResponse = {
  mode?: "live" | "clip";
  look?: string | null;
  scenes?: StatusScene[];
};

function LivePreviewDevInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project") ?? "";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<FilmPlayer | null>(null);

  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(90);
  const [fps, setFps] = useState(30);
  const [scenes, setScenes] = useState<StatusScene[]>([]);
  const [activeScene, setActiveScene] = useState(0);
  const [modeText, setModeText] = useState<string>("idle");
  const [bufferedText, setBufferedText] = useState<string>("none");
  const [budgetText, setBudgetText] = useState<string>("0 / 0 MB");
  const [decisionsText, setDecisionsText] = useState<string>("");
  const [statusLog, setStatusLog] = useState<string>("");

  const playingRef = useRef(false);
  const timeRef = useRef(0);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    async function loadProject() {
      try {
        setStatusLog("Loading plate status...");
        const statusRes = await fetch(`/api/backend/projects/${encodeURIComponent(projectId)}/plates`, {
          cache: "no-store"
        });
        if (!statusRes.ok) {
          setStatusLog(`Status error: ${statusRes.status}`);
          return;
        }
        const status = (await statusRes.json()) as PlateStatusResponse;
        if (cancelled) return;
        const list = status.scenes ?? [];
        setScenes(list);

        const specs: FilmSceneSpec[] = [];
        for (const s of list) {
          if (!s.variantId) continue;
          const b = await fetchBundle(projectId, s.variantId, { baseUrl: "/api/backend" });
          if (cancelled) return;

          if (s.state === "bundled") {
            const checkHost = new WorkerHost({ html: b.html, params: b.params });
            const checkOut = await runCheck(checkHost, b.manifest);
            checkHost.destroy();
            await reportCheck(
              projectId,
              s.variantId,
              {
                gen: 1,
                bundleDigest: b.bundleDigest,
                results: checkOut,
                device: { env: environmentStatus() }
              },
              { baseUrl: "/api/backend" }
            );
            if (!checkOut.ok && checkOut.kind === "env") {
              await requestClip(projectId, s.variantId, { baseUrl: "/api/backend" });
            }
          }

          specs.push({
            id: `scene-${s.index}`,
            bundleDigest: b.bundleDigest,
            html: b.html,
            params: b.params,
            frames: s.frames ?? b.manifest.frames ?? Math.max(1, Math.round((s.seconds || 3) * 30))
          });
        }

        if (cancelled || !specs.length || !stageRef.current) {
          setStatusLog(specs.length ? "Mounted." : "No live-eligible scenes with variantId.");
          return;
        }

        stageRef.current.innerHTML = "";
        const fp = createFilmPlayer({
          scenes: specs,
          budgetBytes: resolveCacheBudgetBytes(),
          timeSource: {
            currentTime: () => timeRef.current,
            playing: () => playingRef.current
          }
        });
        playerRef.current = fp;
        await fp.mount(stageRef.current);
        if (cancelled) {
          fp.destroy();
          return;
        }
        setTotalFrames(fp.meta.frames);
        setFps(fp.meta.fps);
        setStatusLog(`Ready (${specs.length} scenes, env=${environmentStatus()})`);
      } catch (err) {
        if (!cancelled) {
          setStatusLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [projectId]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const fp = playerRef.current;
      if (fp) {
        if (playingRef.current) {
          const duration = fp.meta.frames / fp.meta.fps;
          timeRef.current = (timeRef.current + dt) % Math.max(0.033, duration);
          fp.syncToClock();
          setFrame(fp.clock.frame());
          setActiveScene(fp.activeSceneIndex);
        }
        const dec = fp.decision();
        const activePlayer = fp.scenes[fp.activeSceneIndex];
        const drawMs = activePlayer?.drawCostMs ?? 0;
        const prodFps = drawMs > 0 ? (1000 / drawMs).toFixed(1) : "-";
        setModeText(`${dec.mode} (${dec.reason})`);
        setFps(Number(prodFps) || fp.meta.fps);
        setBufferedText(
          fp
            .buffered()
            .map((r) => `${r.from}-${r.to}`)
            .join(", ") || "none"
        );
        setBudgetText(
          `${(fp.cache.bytes / 1048576).toFixed(1)} / ${(fp.cache.budget / 1048576).toFixed(0)} MB`
        );
        setDecisionsText(
          fp.scenes.map((s, idx) => `S${idx + 1}:${s.decision().mode}(${s.decision().reason})`).join(" | ")
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onSeek = (nextFrame: number) => {
    const fp = playerRef.current;
    setFrame(nextFrame);
    if (fp) {
      timeRef.current = nextFrame / fp.meta.fps;
      fp.showFrame(nextFrame);
      setActiveScene(fp.activeSceneIndex);
    }
  };

  return (
    <main style={{ padding: 16, fontFamily: "monospace" }}>
      <h1>Live Plate Preview (Dev)</h1>
      <div>Project: {projectId || "(pass ?project=<uuid>)"}</div>
      <div>{statusLog}</div>
      <div
        ref={stageRef}
        style={{ width: 854, height: 480, background: "#111", margin: "12px 0", position: "relative" }}
      />
      <div>
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>{" "}
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={frame}
          onChange={(e) => onSeek(Number(e.target.value))}
          style={{ width: 480, verticalAlign: "middle" }}
        />{" "}
        <span>
          Frame {frame} / {totalFrames}
        </span>
      </div>
      <div style={{ marginTop: 8 }}>
        Mode: {modeText} | FPS: {fps} | Buffered: [{bufferedText}] | Memory: {budgetText} | Decisions:{" "}
        {decisionsText || "n/a"}
      </div>
      <ul style={{ marginTop: 12 }}>
        {scenes.map((s, i) => (
          <li key={s.variantId ?? s.index}>
            <button
              type="button"
              onClick={() => {
                const fp = playerRef.current;
                const span = fp?.meta.sceneSpans[i];
                if (fp && span) {
                  onSeek(Math.floor(span.start * fp.meta.fps));
                }
              }}
            >
              Scene {s.index + 1}
            </button>{" "}
            {i === activeScene ? "[active] " : ""}
            {s.keyword} — state={s.state} live={String(Boolean(s.live))} digest=
            {(s.bundleDigest ?? "").slice(0, 12)}
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function LivePreviewDevPage() {
  if (process.env.NEXT_PUBLIC_LIVE_DEV !== "1") {
    notFound();
  }
  return (
    <Suspense fallback={<div>Loading live preview dev...</div>}>
      <LivePreviewDevInner />
    </Suspense>
  );
}
