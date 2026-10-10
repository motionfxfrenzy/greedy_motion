"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readClips } from "../../lib/editor/clips-model.ts";
import { ASSETS, FX_FAVOURITES, FX_LIB, LABELS, PRESETS, TEMPLATES } from "../../lib/editor/fixtures.ts";
import * as ops from "../../lib/editor/ops.ts";
import { useEditor, useEditorState, type LeftTab } from "../../lib/editor/store.ts";
import { formatTime } from "../../lib/editor/time.ts";
import type { Layer } from "../../lib/editor/types.ts";
import { isAdditive, modsOf } from "../../lib/editor/selection.ts";
import { startDrag } from "./drag.ts";
import { dragPayload } from "./drop.ts";
import { Icon, LAYER_ICON, type IconName } from "./icons.tsx";
import { LayerName, LayerSwitches } from "./LayerBits.tsx";
import { useRegistry } from "./registry.ts";
import { IconButton, Switch, Tabs } from "./ui.tsx";

const TABS: Record<"layers" | "clips", { id: LeftTab; label: string }[]> = {
  layers: [{ id: "layers", label: "Layers" }, { id: "comps", label: "Comps" }, { id: "assets", label: "Assets" }, { id: "library", label: "Library" }, { id: "history", label: "History" }],
  clips: [{ id: "clips", label: "Clips" }, { id: "comps", label: "Comps" }, { id: "assets", label: "Assets" }, { id: "history", label: "History" }]
};
const RAIL: Record<LeftTab, IconName> = { layers: "layers", clips: "clips", comps: "comps", assets: "assets", library: "library", history: "history" };

function LayerRow({ layer, index, depth, dragging, over, onDown }: { layer: Layer; index: number; depth: number; dragging: boolean; over: "before" | "parent" | null; onDown: (e: React.PointerEvent) => void }) {
  const selected = useEditor((s) => s.sel.includes(layer.id));
  const hasSolo = useEditor((s) => s.doc.layers.some((l) => l.solo));
  const edit = useEditor((s) => s.edit);
  const parentName = useEditor((s) => (layer.parent ? s.doc.layers.find((l) => l.id === layer.parent)?.name ?? layer.parent : null));
  const dim = !layer.vis || (hasSolo && !layer.solo);
  return (
    <div
      role="option" aria-selected={selected} tabIndex={-1} data-layer-row={layer.id} data-drop={`layer:${layer.id}`}
      className={`ed-lrow ${selected ? "sel" : ""} ${dragging ? "drag" : ""} ${over === "parent" ? "parent-target" : ""} ${dim ? "dim" : ""}`}
      style={{ paddingLeft: 10 + depth * 12 }} onPointerDown={onDown}
      onContextMenu={(e) => { e.preventDefault(); useEditor.getState().ui({ menu: { kind: "layer", x: e.clientX, y: e.clientY, id: layer.id } }); if (!selected) useEditor.getState().select([layer.id]); }}
    >
      {over === "before" ? <i className="ed-insert" /> : null}
      <span className="ed-idx ed-mono">{index + 1}</span>
      <button type="button" className="ed-chip" aria-label={`Label colour: ${layer.label}. Click to change`} style={{ background: LABELS[layer.label] }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); edit("Change label", (d) => { const l = d.layers.find((v) => v.id === layer.id); if (l) ops.cycleLabel(l); }); }} />
      <span className="ed-glyph"><Icon name={LAYER_ICON[layer.type] ?? "solid"} size={13} /></span>
      <span className="ed-lnames">
        <LayerName layer={layer} className="ed-lname" />
        {parentName ? <span className="ed-lparent" title={`Parent: ${parentName}`}>↳ {parentName}</span> : null}
      </span>
      {layer.threeD ? <span className="ed-tag" title="3D layer">3D</span> : null}
      <LayerSwitches layer={layer} />
    </div>
  );
}

const ADD_TYPES: [string, string][] = [["text", "Text"], ["solid", "Solid"], ["shape", "Shape"], ["null", "Null"], ["adjustment", "Adjustment"], ["camera", "Camera"], ["light", "Light"]];

/** "+ Add" with the layer types, as in the design. Each entry runs the same action as ⌘K, so there is one place that creates layers. */
function AddMenu() {
  const registry = useRegistry();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!(e.target instanceof Node) || !box.current?.contains(e.target)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className="ed-addwrap" ref={box}>
      <button type="button" className="ed-pillbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>+ Add</button>
      {open ? (
        <div className="ed-addmenu" role="menu" aria-label="Add layer">
          {ADD_TYPES.map(([type, label]) => (
            <button key={type} type="button" role="menuitem" onClick={() => { setOpen(false); registry.run(`new.${type}`); }}><Icon name={LAYER_ICON[type] ?? "solid"} size={14} />{label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function depthOf(layers: Layer[], layer: Layer): number {
  let depth = 0;
  for (let p = layer.parent; p && depth < 8; p = layers.find((l) => l.id === p)?.parent ?? null) depth++;
  return depth;
}

function LayerList() {
  const layers = useEditor((s) => s.doc.layers);
  const [drag, setDrag] = useState<{ id: string; over: string | null; mode: "before" | "parent" | null } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

  const down = (layer: Layer) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const st = useEditor.getState();
    const mods = modsOf(e);
    const order = (filter ? layers.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase())) : layers).map((l) => l.id);
    // Pressing inside the current selection keeps it, so the whole group can be dragged; a plain click without a drag narrows it to this layer.
    if (!st.sel.includes(layer.id) || isAdditive(mods)) st.pickLayer(layer.id, order, mods);
    const narrow = () => { if (!isAdditive(mods) && useEditor.getState().sel.length > 1) useEditor.getState().pickLayer(layer.id, order, {}); };
    if (filter) return startDrag(e, { onMove: () => undefined, onClick: narrow });
    let target: { id: string | null; mode: "before" | "parent" } | null = null;
    startDrag(e, {
      onStart: () => setDrag({ id: layer.id, over: null, mode: null }),
      onMove: (_dx, _dy, ev) => {
        const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-layer-row]") ?? [])];
        const hit = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
        if (!hit || hit.dataset.layerRow === layer.id) { target = null; return setDrag({ id: layer.id, over: null, mode: null }); }
        const b = hit.getBoundingClientRect();
        const frac = (ev.clientY - b.top) / b.height;
        target = frac > 0.25 && frac < 0.75 ? { id: hit.dataset.layerRow!, mode: "parent" } : { id: frac <= 0.25 ? hit.dataset.layerRow! : (hit.nextElementSibling as HTMLElement | null)?.dataset.layerRow ?? null, mode: "before" };
        setDrag({ id: layer.id, over: frac > 0.25 && frac < 0.75 ? hit.dataset.layerRow! : hit.dataset.layerRow!, mode: target.mode });
      },
      onEnd: () => {
        setDrag(null);
        if (!target) return;
        const t = target;
        if (t.mode === "parent" && t.id) { const ok = ops.setParent(structuredClone(useEditor.getState().doc), layer.id, t.id); if (!ok) return useEditor.getState().say("A layer cannot be parented to its own child."); useEditor.getState().edit("Parent layer", (d) => { ops.setParent(d, layer.id, t.id); }); }
        else useEditor.getState().edit("Reorder layer", (d) => ops.reorderLayer(d, layer.id, t.id));
      },
      onCancel: () => setDrag(null),
      onClick: narrow
    });
  };

  const shown = filter ? layers.filter((l) => l.name.toLowerCase().includes(filter.toLowerCase())) : layers;
  const picked = useEditor((s) => s.sel.length);
  const registry = useRegistry();
  return (
    <>
      <div className="ed-lhead"><span className="ed-cap">Layers</span><span className="ed-lcount">{layers.length}</span><AddMenu /></div>
      <div className="ed-filter"><Icon name="search" size={12} /><input placeholder="Filter layers" aria-label="Filter layers" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
      <div className="ed-list" role="listbox" aria-multiselectable="true" aria-label="Layers" ref={ref} onPointerDown={(e) => { if (e.target === e.currentTarget) useEditor.getState().select([]); }}>
        {shown.map((l, i) => (
          <LayerRow key={l.id} layer={l} index={layers.indexOf(l)} depth={filter ? 0 : depthOf(layers, l)} dragging={drag?.id === l.id} over={drag?.over === l.id ? drag.mode : null} onDown={down(l)} />
        ))}
        {!shown.length ? <div className="ed-empty small">{filter ? `No layers match “${filter}”.` : "No layers yet. Use + Add."}</div> : null}
      </div>
      <div className="ed-lfoot">
        <button type="button" disabled={!picked} onClick={() => registry.run("precompose")}>Pre-compose</button>
        <button type="button" className="danger" disabled={!picked} onClick={() => registry.run("delete")}>{picked > 1 ? `Delete ${picked}` : "Delete"}</button>
      </div>
    </>
  );
}

function ClipList() {
  const html = useEditor((s) => s.doc.html);
  const sel = useEditor((s) => s.clipSel);
  const { clips } = readClips(html);
  const sorted = [...clips].sort((a, b) => a.track - b.track);
  const order = sorted.map((c) => c.id);
  const registry = useRegistry();
  return (
    <>
    <div className="ed-lhead"><span className="ed-cap">Clips</span><span className="ed-lcount">{clips.length}</span><button type="button" className="ed-pillbtn" style={{ marginLeft: "auto" }} onClick={() => registry.run("new.textclip")}>+ Text clip</button></div>
    <div className="ed-list" role="listbox" aria-multiselectable="true" aria-label="Clips" onPointerDown={(e) => { if (e.target === e.currentTarget) useEditor.getState().selectClips([]); }}>
      {sorted.map((c) => (
        <div key={c.id} role="option" aria-selected={sel.includes(c.id)} className={`ed-lrow ${sel.includes(c.id) ? "sel" : ""}`} onClick={(e) => useEditor.getState().pickClip(c.id, order, modsOf(e))}>
          <span className="ed-idx ed-mono">{c.track}</span>
          <span className="ed-glyph"><Icon name={c.kind === "audio" ? "audio" : c.kind === "video" ? "video" : c.kind === "img" ? "image" : c.kind === "text" ? "text" : "shape"} size={13} /></span>
          <span className="ed-lname">#{c.id}</span>
          <span className="ed-tag">{c.tweens.length ? `${c.tweens.length} tween${c.tweens.length > 1 ? "s" : ""}` : c.kind}</span>
          <span className="ed-mono ed-muted">{formatTime(c.start)}</span>
        </div>
      ))}
    </div>
    <div className="ed-lfoot">
      <button type="button" className="danger" disabled={!sel.length} onClick={() => registry.run("delete")}>{sel.length > 1 ? `Delete ${sel.length} clips` : "Delete clip"}</button>
    </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ed-sec"><div className="ed-cap">{title}</div>{children}</section>;
}

function AssetsTab() {
  const mode = useEditor((s) => s.mode);
  return (
    <div className="ed-scroll">
      <div className="ed-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); useEditor.getState().say(`That file type is not supported. Use ${"PNG, JPEG, SVG, MP4, WAV, MP3 or WOFF2"}.`); }}>
        <Icon name="download" size={16} /><b>Drop files here</b><span>{mode === "clips" ? "Images, video and audio become clips" : "Images, video, audio and fonts"}</span>
      </div>
      <div className="ed-assets">
        {ASSETS.map((a) => (
          <button key={a.id} type="button" className="ed-asset" onPointerDown={(e) => { e.preventDefault(); dragPayload(e, { kind: "asset", asset: a }); }}>
            <span className="ed-thumb" style={a.thumb ? { backgroundImage: `url(${a.thumb})` } : undefined}>{!a.thumb ? <Icon name={a.kind === "audio" ? "audio" : "text"} size={18} /> : null}</span>
            <b>{a.name}</b><span className="ed-muted">{a.meta}</span>
          </button>
        ))}
      </div>
      <Section title="Templates">
        <div className="ed-tpl">{TEMPLATES.map(([name, src]) => <div key={name} className="ed-tplc"><span style={{ backgroundImage: `url(${src})` }} /><b>{name}</b></div>)}</div>
      </Section>
    </div>
  );
}

function LibraryTab() {
  return (
    <div className="ed-scroll">
      <Section title="Animation presets">
        <div className="ed-chips">{PRESETS.map((p) => <button key={p} type="button" className="ed-pchip" onPointerDown={(e) => { e.preventDefault(); dragPayload(e, { kind: "preset", name: p }); }}>{p}</button>)}</div>
        <p className="ed-note">Drag a preset onto a layer row.</p>
      </Section>
      <Section title="Effects">
        <div className="ed-chips">{Object.keys(FX_LIB).map((n) => <button key={n} type="button" className="ed-pchip" onPointerDown={(e) => { e.preventDefault(); dragPayload(e, { kind: "effect", name: n }); }}>{FX_FAVOURITES.includes(n) ? "★ " : ""}{n}</button>)}</div>
      </Section>
    </div>
  );
}

function CompsTab() {
  const { compName, canvas, duration, doc, mode } = useEditorState();
  const pre = doc.layers.filter((l) => l.type === "precomp");
  return (
    <div className="ed-scroll">
      <div className="ed-comp-row active"><Icon name="comps" size={14} /><b>{compName}</b><span className="ed-mono ed-muted">{canvas.width}×{canvas.height} · {duration}s</span></div>
      {mode === "layers" ? pre.map((l) => <div key={l.id} className="ed-comp-row"><Icon name="precomp" size={14} /><b>{l.name}</b><span className="ed-muted">Pre-comp · edits inline</span></div>) : null}
      {mode === "layers" && !pre.length ? <p className="ed-note">No pre-comps yet. Select layers and press ⌘⇧C.</p> : null}
    </div>
  );
}

function HistoryTab() {
  const rev = useEditor((s) => s.historyRev);
  const history = useEditor.getState().history();
  void rev;
  return (
    <div className="ed-scroll">
      {history.entries.map((e, i) => (
        <button key={e.id} type="button" className={`ed-hrow ${i === history.index ? "now" : i > history.index ? "future" : ""}`} onClick={() => useEditor.getState().jumpTo(i)}>
          <span className="ed-mono ed-muted">{i}</span><b>{e.label}</b>{i === history.index ? <span className="ed-tag">now</span> : null}
        </button>
      ))}
      {history.branches.length ? <Section title="Branches">
        {history.branches.map((b) => <button key={b.id} type="button" className="ed-hrow" onClick={() => useEditor.getState().switchBranch(b.id)}><Icon name="history" size={12} /><b>{b.label}</b><span className="ed-muted">{b.entries.length} step{b.entries.length > 1 ? "s" : ""}</span></button>)}
      </Section> : null}
    </div>
  );
}

export function LeftPanel({ compact, width }: { compact: boolean; width: number }) {
  const { mode, leftOpen, leftFloat, leftTab } = useEditorState();
  const ui = useEditor((s) => s.ui);
  const tabs = TABS[mode];
  const tab = tabs.some((t) => t.id === leftTab) ? leftTab : tabs[0]!.id;
  const showPanel = leftOpen;
  const floating = leftFloat;

  const rail = (
    <nav className="ed-card ed-rail" aria-label="Panels">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={`ed-rail-b ${showPanel && tab === t.id ? "on" : ""}`} aria-label={t.label} aria-pressed={showPanel && tab === t.id}
          onClick={() => (showPanel && tab === t.id ? ui({ leftOpen: false }) : ui({ leftOpen: true, leftTab: t.id }))}>
          <Icon name={RAIL[t.id]} size={15} /><span>{t.label}</span>
        </button>
      ))}
    </nav>
  );

  if (!showPanel) return rail;
  return (
    <>
      <aside className={`ed-card ed-left ${floating ? "float" : ""}`} style={floating ? { width: 320 } : { width: "100%" }} aria-label="Project panel" data-width={width}>
        <div className="ed-panel-head">
          <Tabs tabs={tabs} value={tab} onChange={(id) => ui({ leftTab: id })} />
          <IconButton icon={leftFloat ? "dock" : "float"} label={leftFloat ? "Dock panel" : "Float panel over canvas"} onClick={() => ui({ leftFloat: !leftFloat })} />
          <IconButton icon="chevL" label="Collapse panel" onClick={() => ui({ leftOpen: false })} />
        </div>
        {tab === "layers" ? <LayerList /> : tab === "clips" ? <ClipList /> : tab === "assets" ? <AssetsTab /> : tab === "library" ? <LibraryTab /> : tab === "comps" ? <CompsTab /> : <HistoryTab />}
      </aside>
    </>
  );
}
