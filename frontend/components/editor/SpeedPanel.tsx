"use client";
import { useRef } from "react";
import { EASE_PRESETS } from "../../lib/editor/anim.ts";
import * as ops from "../../lib/editor/ops.ts";
import { GRAPH, buildSpeedModel, influenceAt } from "../../lib/editor/speed.ts";
import { useEditor, useEditorState } from "../../lib/editor/store.ts";
import { formatTime } from "../../lib/editor/time.ts";
import { startDrag } from "./drag.ts";

const PROP_NAMES: Record<string, string> = { pos: "Position", scale: "Scale", rot: "Rotation", ry: "Y rotation", opacity: "Opacity" };
const PRESETS = [["linear", "Linear"], ["easeIn", "Ease in"], ["easeOut", "Ease out"], ["easyEase", "Easy ease"]] as const;
const short = (t: number) => formatTime(t).replace(/:\d\d$/, "");

/**
 * Speed graph (Layers mode), after the design handoff: one property's whole speed curve with the selected segment highlighted,
 * chips to switch property and segment, two influence handles on the baseline, and the presets. Docked on the timeline's right.
 */
export function SpeedPanel() {
  const s = useEditorState();
  const graph = useRef<HTMLDivElement>(null);
  const key = s.keySel[0];
  const layer = s.doc.layers.find((l) => l.id === key?.id);
  const props = layer ? Object.entries(layer.keys).filter(([, ks]) => ks.length > 0) : [];
  const keys = layer && key ? layer.keys[key.prop] : undefined;
  const at = keys && key ? keys.findIndex((k) => Math.abs(k.t - key.t) < 1e-6) : -1;
  const segment = keys && at >= 0 ? Math.min(at, keys.length - 2) : -1;
  const model = keys && segment >= 0 ? buildSpeedModel(keys, segment) : null;
  const a = keys && segment >= 0 ? keys[segment] : undefined;
  const b = keys && segment >= 0 ? keys[segment + 1] : undefined;

  const select = (prop: string, t: number) => s.ui({ keySel: [{ id: layer!.id, prop, t }] });
  const empty = !layer || !key
    ? "Select a keyframe on the timeline to edit how it eases."
    : !model ? "This property has one keyframe. Add another to shape the motion between them." : null;

  const preset = (name: keyof typeof EASE_PRESETS) => {
    if (!layer || !key || !a || !b) return;
    useEditor.getState().edit(`Ease: ${name}`, (d) => {
      const l = d.layers.find((v) => v.id === layer.id)!;
      const all = l.keys[key.prop]!;
      ops.setKeyEase(l, key.prop, s.spAll ? all.map((k) => k.t) : [a.t, b.t], EASE_PRESETS[name]);
    });
  };

  const drag = (e: React.PointerEvent, which: "out" | "in") => {
    e.stopPropagation();
    if (!layer || !key || !model || !graph.current) return;
    const box = graph.current;
    startDrag(e, {
      onStart: () => useEditor.getState().begin("Edit keyframe influence"),
      onMove: (_dx, _dy, ev) => {
        const rect = box.getBoundingClientRect();
        const influence = influenceAt(((ev.clientX - rect.left) / rect.width) * GRAPH.width, model.x0, model.x1, which);
        useEditor.getState().updateFromBase((d) => {
          const ks = d.layers.find((v) => v.id === layer.id)!.keys[key.prop]!;
          ks.forEach((k, i) => {
            // Out influence belongs to a segment's first key, in influence to its last; "All selected" edits every key.
            if (which === "out" && (s.spAll || i === segment)) k.o = influence;
            if (which === "in" && (s.spAll || i === segment + 1)) k.i = influence;
          });
          // Shaping the curve makes the segment eased (a linear key ignores its influences).
          for (const i of s.spAll ? ks.keys() : [segment]) ks[i]!.lin = false;
        });
      },
      onEnd: () => useEditor.getState().commit(),
      onCancel: () => useEditor.getState().cancel()
    });
  };

  return (
    <aside className="ed-speed" style={{ width: s.spW }} aria-label="Speed graph">
      <div className="ed-resizer x left" role="separator" aria-orientation="vertical" aria-label="Resize speed graph" title="Drag to resize"
        onPointerDown={(e) => { e.preventDefault(); const base = s.spW; startDrag(e, { onMove: (dx) => s.ui({ spW: Math.max(280, Math.min(640, base - dx)) }) }, 0); }} />
      <div className="ed-sp-head"><strong>Speed graph</strong><span className="ed-muted">{layer && key ? `${layer.name} · ${PROP_NAMES[key.prop] ?? key.prop}` : ""}</span></div>
      {empty ? <div className="ed-sp-empty">{empty}</div> : null}
      {layer && key && keys ? (
        <>
          <div className="ed-sp-chips">
            {props.map(([prop, ks]) => (
              <button key={prop} type="button" className={`ed-spchip ${prop === key.prop ? "on" : ""}`} aria-pressed={prop === key.prop} onClick={() => select(prop, ks[0]!.t)}>{PROP_NAMES[prop] ?? prop}</button>
            ))}
            {keys.length > 1 ? <span className="ed-sp-sep" aria-hidden="true" /> : null}
            {keys.slice(0, -1).map((k, i) => (
              <button key={k.t} type="button" className={`ed-spchip seg ed-mono ${i === segment ? "on" : ""}`} aria-pressed={i === segment} onClick={() => select(key.prop, k.t)}>{short(k.t)}–{short(keys[i + 1]!.t)}</button>
            ))}
          </div>
          {model && a && b ? (
            <>
              <div className="ed-sp-graph" ref={graph}>
                <svg viewBox={`0 0 ${GRAPH.width} ${GRAPH.height}`} preserveAspectRatio="none" role="img" aria-label={`Speed graph for ${PROP_NAMES[key.prop] ?? key.prop}`}>
                  <path d={`M${GRAPH.pad} ${GRAPH.base} L${GRAPH.width - GRAPH.pad} ${GRAPH.base}`} className="axis" />
                  <path d={model.areaAll} className="area-all" />
                  <path d={model.area} className="area" />
                  <path d={model.path} className="curve" />
                  <path d={model.g1} className="guide" />
                  <path d={model.g2} className="guide" />
                </svg>
                {model.bounds.map((x) => <span key={x} className="ed-sp-bound" style={{ left: `${(x / GRAPH.width) * 100}%` }} />)}
                {([["out", model.outX, "Out influence"], ["in", model.inX, "In influence"]] as const).map(([which, x, title]) => (
                  <span key={which} className="ed-sp-handle" role="slider" tabIndex={0} aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(which === "out" ? a.o : b.i)} title={title}
                    style={{ left: `${(x / GRAPH.width) * 100}%` }} onPointerDown={(e) => drag(e, which)}><i /></span>
                ))}
                <span className="ed-sp-t ed-mono l">{formatTime(a.t)}</span><span className="ed-sp-t ed-mono r">{formatTime(b.t)}</span>
              </div>
              <div className="ed-sp-fields">
                <label>Out influence<span className="ed-mono">{Math.round(a.o * 10) / 10}%</span></label>
                <label>In influence<span className="ed-mono">{Math.round(b.i * 10) / 10}%</span></label>
              </div>
              <div className="ed-sp-presets">
                {PRESETS.map(([id, label]) => <button key={id} type="button" className="ed-pchip" onClick={() => preset(id)}>{label}</button>)}
                <label className="ed-check"><input type="checkbox" checked={s.spAll} onChange={(e) => s.ui({ spAll: e.target.checked })} />All selected</label>
              </div>
              <span className="ed-sp-read ed-mono">{model.peak > 0 ? `Peak speed ${model.peak.toFixed(1)} /s` : "No change between these keys"}</span>
            </>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
