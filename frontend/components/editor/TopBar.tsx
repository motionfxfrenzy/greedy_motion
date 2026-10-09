"use client";
import { useRef } from "react";
import { formatShortcut } from "../../lib/editor/actions.ts";
import { useEditor, useEditorState, type EngineState } from "../../lib/editor/store.ts";
import { Icon } from "./icons.tsx";
import { IconButton } from "./ui.tsx";
import { useRegistry } from "./registry.ts";

const ENGINE: Record<EngineState, { label: string; cls: string }> = {
  ready: { label: "Engine ready", cls: "ok" },
  updating: { label: "Updating frame…", cls: "busy" },
  rendering: { label: "Rendering", cls: "busy" },
  stopped: { label: "Engine stopped", cls: "bad" }
};

export function TopBar() {
  const registry = useRegistry();
  const { mode, hfOnly, pro, readOnly, engine, jobs, dirty, projectName, compName, canvas, duration, doc, historyRev, checks } = useEditorState();
  const ui = useEditor((s) => s.ui);
  const history = useEditor.getState().history();
  void historyRev;
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const running = jobs.find((j) => j.state === "running");
  const pending = jobs.filter((j) => j.state === "running" || j.state === "queued").length;
  const engineInfo = engine === "rendering" && running ? { label: `Rendering ${Math.round(running.pct)}%`, cls: "busy" } : ENGINE[engine];
  const issues = checks?.length ?? 0;
  const menuBtn = useRef<HTMLButtonElement>(null);
  void doc;

  return (
    <header className="ed-card ed-top" role="banner">
      <button
        ref={menuBtn} type="button" className="ed-project" aria-haspopup="menu"
        onClick={() => { const r = menuBtn.current!.getBoundingClientRect(); ui({ menu: { kind: "project", x: r.left, y: r.bottom + 6 } }); }}
      >
        <img src="/assets/gm-mark.svg" alt="" width={22} height={22} />
        <span className="ed-project-name">{projectName}</span>
        <Icon name="caretDown" size={12} />
      </button>
      <button type="button" className="ed-comp" title="Composition" onClick={() => ui({ leftOpen: true, leftTab: "comps" })}>
        <span>{compName}</span>
        <span className="ed-mono ed-muted">{canvas.width}×{canvas.height} · {duration}s</span>
      </button>

      {pro ? (hfOnly ? <span className="ed-hfbadge" title="This project uses HyperFrames only">HyperFrames</span> : (
        <div className="ed-seg" role="radiogroup" aria-label="Editor mode">
          <button type="button" role="radio" aria-checked={mode === "layers"} className={mode === "layers" ? "on" : ""} onClick={() => registry.run("mode.layers")}>Layers</button>
          <button type="button" role="radio" aria-checked={mode === "clips"} className={mode === "clips" ? "on" : ""} onClick={() => registry.run("mode.clips")}>HTML clips</button>
        </div>
      )) : null}
      {pro ? <span className={`ed-pill ${engineInfo.cls}`} role="status" aria-live="polite"><i />{engineInfo.label}</span> : null}

      <div className="ed-spacer" />
      <IconButton icon="undo" label={history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"} disabled={!history.canUndo} onClick={() => registry.run("undo")} />
      <IconButton icon="redo" label={history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"} disabled={!history.canRedo} onClick={() => registry.run("redo")} />
      <button type="button" className="ed-search" onClick={() => registry.run("palette")} aria-label="Search commands">
        <Icon name="search" size={13} />
        <span className="ed-search-l">Search commands</span>
        <kbd>{formatShortcut("Mod+K", mac)}</kbd>
      </button>
      <span className={`ed-save ${dirty ? "dirty" : ""}`} role="status"><i />{<span className="ed-save-l">{dirty ? "Unsaved" : "Saved"}</span>}</span>
      <button type="button" className="ed-btn" onClick={() => registry.run("check")}>
        <Icon name="check2" size={14} />Check{issues ? <span className="ed-badge">{issues}</span> : null}
      </button>
      <button type="button" className="ed-btn primary" disabled={readOnly} title={readOnly ? "View only: your Pro plan has ended" : undefined} onClick={() => ui({ renderOpen: !useEditor.getState().renderOpen })} aria-haspopup="dialog">
        <Icon name="render" size={13} />Render{pending ? <span className="ed-badge light">{pending}</span> : null}
      </button>
    </header>
  );
}
