"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRegistry, nudge, tickJobs } from "../../lib/editor/commands.ts";
import { demoDoc, DEMO_DURATION, DEMO_CANVAS } from "../../lib/editor/fixtures.ts";
import { createAutosave, setActiveAutosave } from "../../lib/editor/remote.ts";
import { useEditor, useEditorState } from "../../lib/editor/store.ts";
import { getPro, openPro, previewFrame, projectName, readProFile, writeProFiles, ProApiError } from "../../lib/pro-api.ts";
import { startDrag } from "./drag.ts";
import { Canvas } from "./Canvas.tsx";
import { Inspector } from "./Inspector.tsx";
import { LeftPanel } from "./LeftPanel.tsx";
import { Overlays } from "./Overlays.tsx";
import { Timeline } from "./Timeline.tsx";
import { TopBar } from "./TopBar.tsx";
import { RegistryContext } from "./registry.ts";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function useViewport() {
  const [size, setSize] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

/** Thin strip on a panel edge that resizes it. Shows a blue hint on hover. */
function Resizer({ axis, edge, start, apply }: { axis: "x" | "y"; edge: "left" | "right" | "top"; start: () => number; apply: (base: number, delta: number) => void }) {
  return (
    <div
      className={`ed-resizer ${axis} ${edge}`} role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onPointerDown={(e) => { e.preventDefault(); const base = start(); startDrag(e, { onMove: (dx, dy) => apply(base, axis === "x" ? dx : dy) }, 0); }}
    />
  );
}

type Load = { phase: "loading" } | { phase: "ready" } | { phase: "closed" } | { phase: "blocked"; message: string } | { phase: "error"; message: string };

function OpenScreen({ load, projectId, onOpen, onRetry }: { load: Exclude<Load, { phase: "loading" } | { phase: "ready" }>; projectId: string; onOpen: (source: "beat-plan" | "blank") => void; onRetry: () => void }) {
  return (
    <div className="ed-boot">
      <div className="ed-opencard">
        {load.phase === "closed" ? (
          <>
            <h1>Open in the Pro editor</h1>
            <p>This copies the project into an editable composition. The storyboard and its Studio render stay as they are; edits here don’t flow back into the storyboard.</p>
            <div className="ed-opencard-a">
              <button type="button" className="ed-btn primary" onClick={() => onOpen("beat-plan")}>Open from the storyboard</button>
              <button type="button" className="ed-btn" onClick={() => onOpen("blank")}>Start blank</button>
            </div>
            <p className="ed-note">Project {projectId.slice(0, 8)}. A storyboard is a generated page, so it has few clips to edit; “Start blank” gives you tracks to build on.</p>
          </>
        ) : (
          <>
            <h1>{load.phase === "blocked" ? "The Pro editor isn’t on your plan" : "Could not open the project"}</h1>
            <p>{load.message}</p>
            {load.phase === "error" ? <div className="ed-opencard-a"><button type="button" className="ed-btn primary" onClick={onRetry}>Try again</button></div> : null}
            <a className="ed-linkbtn" href="/studio">Back to Studio</a>
          </>
        )}
      </div>
    </div>
  );
}

export function EditorApp({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const registry = useMemo(() => buildRegistry(), []);
  const vp = useViewport();
  const s = useEditorState();
  const shell = useRef<HTMLDivElement>(null);

  const openProject = useCallback(async () => {
    setLoad({ phase: "loading" });
    try {
      const { pro, access } = await getPro(projectId);
      if (!pro) {
        return setLoad(access === "view"
          ? { phase: "blocked", message: "Your Pro plan has ended, so new projects can’t be opened in the Pro editor. Projects you already opened stay available to view." }
          : { phase: "closed" });
      }
      const [file, base, name] = await Promise.all([readProFile(projectId, pro.entry), previewFrame(projectId), projectName(projectId)]);
      useEditor.getState().reset({
        doc: { layers: [], html: file.content, markers: [], workArea: [0, pro.durationSeconds], comments: [], vars: {} },
        projectName: name ?? projectId.slice(0, 8), compName: pro.entry.replace(/\.html$/, ""),
        duration: pro.durationSeconds, canvas: pro.canvas, mode: "clips", hfOnly: true, pro: true,
        remote: { projectId, rev: pro.rev, entry: pro.entry, status: access === "view" ? "readonly" : "idle", frameSrc: base }, readOnly: access === "view"
      });
      if (access === "edit") {
        const autosave = createAutosave(writeProFiles);
        autosave.attach(file.content);
        setActiveAutosave(autosave);
      }
      setLoad({ phase: "ready" });
    } catch (error) {
      if (error instanceof ProApiError && error.code === "not_pro") return setLoad({ phase: "blocked", message: error.message });
      setLoad({ phase: "error", message: error instanceof Error ? error.message : "Could not open the project." });
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId === "demo") {
      const doc = demoDoc();
      useEditor.getState().reset({ doc, projectName: "ui-layer-copy", compName: "main", duration: DEMO_DURATION, canvas: DEMO_CANVAS, mode: "layers", hfOnly: false, pro: true, sel: ["title"], pxPerSecond: 0 });
      setLoad({ phase: "ready" });
      return;
    }
    void openProject();
    return () => { setActiveAutosave(null); };
  }, [projectId, openProject]);

  // A server project keeps edits in the browser until saved; leaving then loses them.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { const st = useEditor.getState(); if (st.remote && st.dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Playback: advance the playhead in real time, looping inside the work area.
  useEffect(() => {
    if (!s.playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const st = useEditor.getState();
      const [a, b] = st.doc.workArea;
      let t = st.t + (now - last) / 1000;
      last = now;
      if (t >= b) t = a;
      // Continuous while playing, so the playhead and the animation move at the display's rate instead of in 30 fps steps.
      st.ui({ t: Math.min(t, st.duration) });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Landing on a frame when playback stops keeps edits, keys and markers on the frame grid.
    return () => { cancelAnimationFrame(raf); const st = useEditor.getState(); st.setT(st.t); };
  }, [s.playing]);

  // Demo render queue: a real adapter replaces this with engine progress events.
  useEffect(() => {
    const id = setInterval(() => tickJobs(0.1), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      if (e.key === "F6") {
        e.preventDefault();
        const regions = [...(shell.current?.querySelectorAll<HTMLElement>("[data-region]") ?? [])];
        const at = regions.findIndex((r) => r.contains(document.activeElement));
        regions[(at + (e.shiftKey ? -1 : 1) + regions.length) % regions.length]?.focus();
        return;
      }
      if (editable(e.target) && !(e.metaKey || e.ctrlKey)) return;
      if (editable(e.target) && !["k", "s", "z"].includes(e.key.toLowerCase())) return;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = arrows[e.key];
      const hasTarget = st.mode === "clips" ? st.clipSel.length > 0 : st.sel.length > 0;
      if (dir && hasTarget && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); nudge(dir[0], dir[1], e.shiftKey ? 10 : 1); return; }
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && st.mode === "clips" && st.clipSel.length) return; // clip frame moves are handled by the timeline
      const hit = registry.match(e, isMac());
      if (hit) { e.preventDefault(); hit.run(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);

  useEffect(() => {
    const title = `${s.projectName} · Pro editor`;
    document.title = title;
  }, [s.projectName]);

  if (load.phase === "loading") return <div className="ed-boot" aria-busy="true">Opening project…</div>;
  if (load.phase !== "ready") return <OpenScreen load={load} projectId={projectId} onOpen={async (source) => { setLoad({ phase: "loading" }); try { await openPro(projectId, { source }); await openProject(); } catch (error) { setLoad({ phase: "error", message: error instanceof Error ? error.message : "Could not open the project." }); } }} onRetry={openProject} />;

  const compact = vp.w < 1200;
  const leftDocked = s.leftOpen && !s.leftFloat;
  const leftCol = leftDocked ? (compact ? Math.min(s.leftW, 316) : s.leftW) : 54;
  const rightCol = s.rightOpen ? (compact ? 312 : s.rightW) : 40;
  const maxTl = Math.max(170, Math.round(vp.h * 0.34));
  const tlRow = s.tlOpen ? (compact ? Math.min(250, s.tlH, maxTl) : Math.max(170, Math.min(s.tlH, maxTl))) : 44;

  return (
    <RegistryContext.Provider value={registry}>
      <div
        ref={shell} className={`ed ${compact ? "compact" : ""}`} data-theme={s.theme}
        style={{ gridTemplateColumns: `${leftCol}px minmax(0,1fr) ${rightCol}px`, gridTemplateRows: `56px minmax(0,1fr) ${tlRow}px` }}
      >
        <TopBar />
        <div className="ed-left-wrap" data-region tabIndex={-1} aria-label="Left panel">
          <LeftPanel compact={compact} width={compact ? Math.min(s.leftW, 316) : s.leftW} />
          {leftDocked && !compact ? <Resizer axis="x" edge="right" start={() => leftCol} apply={(b, d) => useEditor.getState().ui({ leftW: Math.max(316, Math.min(440, b + d)) })} /> : null}
        </div>
        <Canvas />
        <div className="ed-right-wrap" data-region tabIndex={-1} aria-label="Inspector">
          <Inspector />
          {s.rightOpen && !compact ? <Resizer axis="x" edge="left" start={() => rightCol} apply={(b, d) => useEditor.getState().ui({ rightW: Math.max(280, Math.min(460, b - d)) })} /> : null}
        </div>
        <div className="ed-tl-wrap" data-region tabIndex={-1} aria-label="Timeline">
          <Timeline />
          {s.tlOpen && !compact ? <Resizer axis="y" edge="top" start={() => tlRow} apply={(b, d) => useEditor.getState().ui({ tlH: Math.max(170, Math.min(480, b - d)) })} /> : null}
        </div>
        {s.readOnly ? <div className="ed-banner" role="status"><b>View only.</b><span>Your Pro plan has ended. You can look at this project and its checks, but not change or render it. Your files are kept.</span></div> : null}
        {!s.readOnly && s.remote?.status === "conflict" ? <div className="ed-banner" role="alert"><b>This project changed somewhere else.</b><span>Your edits here were not saved, so nothing was overwritten.</span><button type="button" className="ed-btn small" onClick={() => window.location.reload()}>Reload</button></div> : null}
        <Overlays />
      </div>
    </RegistryContext.Provider>
  );
}
