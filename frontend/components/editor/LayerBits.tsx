"use client";
import { useRef, useState } from "react";
import { useEditor } from "../../lib/editor/store.ts";
import type { Layer } from "../../lib/editor/types.ts";
import { Icon } from "./icons.tsx";
import { Switch } from "./ui.tsx";

type Flag = "vis" | "solo" | "lock";
const LABEL: Record<Flag, [string, string]> = { vis: ["Hide layer", "Show layer"], solo: ["Solo", "Solo"], lock: ["Lock", "Unlock"] };

/**
 * Flip a switch. On a layer that is part of a group selection, the whole group gets the same value, so
 * "hide these five" is one click instead of five.
 */
function toggleFlag(id: string, flag: Flag) {
  const st = useEditor.getState();
  const layer = st.doc.layers.find((l) => l.id === id);
  if (!layer) return;
  const next = !layer[flag];
  const ids = st.sel.includes(id) && st.sel.length > 1 ? st.sel : [id];
  const name = flag === "vis" ? "visibility" : flag;
  st.edit(`Toggle ${name}${ids.length > 1 ? ` on ${ids.length} layers` : ""}`, (d) => { for (const l of d.layers) if (ids.includes(l.id)) l[flag] = next; });
}

/** Show / hide, solo and lock: the same three switches in the layer list and on the timeline. */
export function LayerSwitches({ layer }: { layer: Layer }) {
  return (
    <>
      <Switch on={layer.vis} label={layer.vis ? LABEL.vis[0] : LABEL.vis[1]} onToggle={() => toggleFlag(layer.id, "vis")}><Icon name={layer.vis ? "eye" : "eyeOff"} size={12} /></Switch>
      <Switch on={layer.solo} tone="solo" label={LABEL.solo[0]} onToggle={() => toggleFlag(layer.id, "solo")}>S</Switch>
      <Switch on={layer.lock} tone="lock" label={layer.lock ? LABEL.lock[1] : LABEL.lock[0]} onToggle={() => toggleFlag(layer.id, "lock")}><Icon name="lock" size={11} /></Switch>
    </>
  );
}

/** The layer's name; double-click turns it into a text box. Enter or leaving the box saves, Esc discards. */
export function LayerName({ layer, className }: { layer: Layer; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  const cancelled = useRef(false);

  const finish = () => {
    setEditing(false);
    const name = draft.trim();
    if (cancelled.current || !name || name === layer.name) return;
    useEditor.getState().edit("Rename layer", (d) => { const l = d.layers.find((v) => v.id === layer.id); if (l) l.name = name; });
  };

  if (editing) {
    return (
      <input
        className="ed-rename" autoFocus value={draft} aria-label="Layer name" maxLength={80}
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDraft(e.target.value)} onBlur={finish}
        onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancelled.current = true; e.currentTarget.blur(); } }}
      />
    );
  }
  return (
    <span className={className} title={`${layer.name} (double-click to rename)`} onDoubleClick={(e) => { e.stopPropagation(); cancelled.current = false; setDraft(layer.name); setEditing(true); }}>{layer.name}</span>
  );
}
