"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { valueAt, writeProperty } from "../../lib/editor/anim.ts";
import { runCheck } from "../../lib/editor/commands.ts";
import { readClips } from "../../lib/editor/clips-model.ts";
import { addTween, readTweens, removeTween, setAttribute, setStyle, setText, setTiming, updateTween } from "../../lib/editor/html-source.ts";
import { paramRange, BLEND_MODES, BRAND_COLORS, BRAND_FONTS, EASES, FX_FAVOURITES, FX_LIB, newId } from "../../lib/editor/fixtures.ts";
import * as ops from "../../lib/editor/ops.ts";
import { useEditor, useEditorState, type RightTab } from "../../lib/editor/store.ts";
import { formatTime } from "../../lib/editor/time.ts";
import type { Clip, Layer } from "../../lib/editor/types.ts";
import { startDrag } from "./drag.ts";
import { Icon } from "./icons.tsx";
import { Cap, ColorField, IconButton, NumberField, Tabs, scrubRowValue } from "./ui.tsx";
import { AgentDock } from "./AgentDock.tsx";

const TABS_LAYERS: { id: RightTab; label: string }[] = [{ id: "properties", label: "Properties" }, { id: "variables", label: "Variables" }, { id: "review", label: "Review" }, { id: "checks", label: "Checks" }];
const TABS_CLIPS: { id: RightTab; label: string }[] = [{ id: "properties", label: "Properties" }, { id: "source", label: "Source" }, { id: "variables", label: "Variables" }, { id: "review", label: "Review" }, { id: "checks", label: "Checks" }];
const DEFAULTS: Record<string, number | number[]> = { pos: [960, 540], scale: [100, 100], rot: 0, ry: 0, opacity: 100 };

// ---------------------------------------------------------------------------------------------- layer properties

function Row({ children, label, on, animated, onWatch, nav, reset, wide }: { children: ReactNode; label: string; on?: boolean; animated?: boolean; onWatch?: (alt: boolean) => void; nav?: ReactNode; reset?: () => void; wide?: boolean }) {
  return (
    <div className={`ed-prow ${wide ? "wide" : ""}`}>
      {onWatch ? <button type="button" className={`ed-watch ${animated ? "on" : ""}`} aria-pressed={animated} aria-label={`${animated ? "Remove animation from" : "Animate"} ${label}`} title="Animate (Alt-click for an expression)" onClick={(e) => onWatch(e.altKey)}><Icon name="stopwatch" size={12} /></button> : <span />}
      <span className={`ed-plabel ${animated || on ? "on" : ""}`} onPointerDown={scrubRowValue}>{label}</span>
      <div className="ed-pfield">{children}</div>
      <div className="ed-pextra">{nav}{reset ? <button type="button" className="ed-reset" aria-label={`Reset ${label}`} title="Reset" onClick={reset}><Icon name="reset" size={11} /></button> : null}</div>
    </div>
  );
}

function AnimRow({ layer, prop, label, step = 1, min, max, link }: { layer: Layer; prop: "pos" | "scale" | "rot" | "ry" | "opacity"; label: string; step?: number; min?: number; max?: number; link?: boolean }) {
  const t = useEditor((s) => s.t);
  const [linked, setLinked] = useState(true);
  const [expr, setExpr] = useState(false);
  const value = valueAt(layer, prop, t);
  const vec = Array.isArray(value);
  const animated = (layer.keys[prop]?.length ?? 0) > 0;
  const keys = layer.keys[prop] ?? [];
  const onKey = keys.some((k) => Math.abs(k.t - t) < 0.5 / 30);
  const st = () => useEditor.getState();
  const begin = () => st().begin(`Change ${label}`);
  const write = (v: number | number[]) => st().update((d) => writeProperty(d.layers.find((l) => l.id === layer.id)!, prop, v, st().t));
  const setComponent = (i: number, v: number) => {
    const cur = [...(valueAt(layer, prop, st().t) as number[])];
    if (link && linked && cur[i] !== 0) { const k = v / cur[i]!; write(cur.map((x) => Math.round(x * k * 10) / 10)); } else { cur[i] = v; write(cur); }
  };
  return (
    <>
      <Row label={label} animated={animated} wide={vec}
        onWatch={(alt) => (alt ? setExpr((v) => !v) : st().edit(animated ? `Remove ${label} animation` : `Animate ${label}`, (d) => ops.toggleStopwatch(d.layers.find((l) => l.id === layer.id)!, prop, st().t)))}
        reset={() => st().edit(`Reset ${label}`, (d) => { const l = d.layers.find((v) => v.id === layer.id)!; delete l.keys[prop]; (l as unknown as Record<string, unknown>)[prop] = structuredClone(DEFAULTS[prop]); })}
        nav={animated ? (
          <>
            <button type="button" aria-label="Previous keyframe" onClick={() => { const k = ops.neighbourKey(layer, prop, t, -1); if (k !== null) st().setT(k); }}><Icon name="chevL" size={10} /></button>
            <button type="button" className={onKey ? "on" : ""} aria-label={onKey ? "Remove keyframe here" : "Add keyframe here"} onClick={() => st().edit(onKey ? "Delete keyframe" : "Add keyframe", (d) => { const l = d.layers.find((v) => v.id === layer.id)!; if (onKey) ops.deleteKey(l, prop, t); else ops.addKeyAt(l, prop, t); })}><Icon name="keyframe" size={10} /></button>
            <button type="button" aria-label="Next keyframe" onClick={() => { const k = ops.neighbourKey(layer, prop, t, 1); if (k !== null) st().setT(k); }}><Icon name="chevR" size={10} /></button>
          </>
        ) : null}>
        {vec ? (
          <>
            <NumberField label="X" title={`${label} X`} value={(value as number[])[0]!} step={step} onBegin={begin} onChange={(v) => setComponent(0, v)} onCommit={() => st().commit()} onCancel={() => st().cancel()} />
            <NumberField label="Y" title={`${label} Y`} value={(value as number[])[1]!} step={step} onBegin={begin} onChange={(v) => setComponent(1, v)} onCommit={() => st().commit()} onCancel={() => st().cancel()} />
            {link ? <button type="button" className={`ed-link ${linked ? "on" : ""}`} aria-pressed={linked} aria-label="Keep proportions" title="Keep proportions" onClick={() => setLinked((v) => !v)}><Icon name="link" size={12} /></button> : null}
          </>
        ) : <NumberField title={label} value={value as number} step={step} {...(min === undefined ? {} : { min })} {...(max === undefined ? {} : { max })} onBegin={begin} onChange={write} onCommit={() => st().commit()} onCancel={() => st().cancel()} />}
      </Row>
      {expr ? <div className="ed-expr"><label>Expression · {label}<textarea defaultValue={`wiggle(2, 8)`} spellCheck={false} onKeyDown={(e) => e.stopPropagation()} /></label><p>Expressions are stored with the layer. Evaluating them depends on the engine.</p></div> : null}
    </>
  );
}

function PlainRow({ label, children }: { label: string; children: ReactNode }) {
  return <Row label={label}>{children}</Row>;
}

function LayerEffects({ layer }: { layer: Layer }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; before: string | null } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const edit = useEditor((s) => s.edit);
  const names = Object.keys(FX_LIB).filter((n) => n.toLowerCase().includes(query.toLowerCase()));
  const down = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    let before: string | null = null;
    startDrag(e, {
      onMove: (_dx, _dy, ev) => {
        const cards = [...(list.current?.querySelectorAll<HTMLElement>("[data-fx]") ?? [])];
        const hit = cards.find((c) => { const b = c.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        before = hit?.dataset.fx ?? null;
        setDrag({ id, before });
      },
      onEnd: () => { setDrag(null); edit("Reorder effect", (d) => ops.moveEffect(d.layers.find((l) => l.id === layer.id)!, id, before)); },
      onCancel: () => setDrag(null)
    });
  };
  return (
    <section className="ed-sec">
      <Cap>Effects</Cap>
      <p className="ed-note">Top applies first.</p>
      <div ref={list}>
        {layer.effects.map((fx) => (
          <div key={fx.id} data-fx={fx.id} className={`ed-fx ${drag?.id === fx.id ? "drag" : ""}`}>
            {drag && drag.before === fx.id && drag.id !== fx.id ? <i className="ed-insert" /> : null}
            <div className="ed-fx-h">
              <button type="button" className="ed-grip" aria-label={`Reorder ${fx.name}`} onPointerDown={(e) => down(e, fx.id)}><Icon name="grip" size={12} /></button>
              <input type="checkbox" checked={fx.on} aria-label={`${fx.name} on`} onChange={() => edit("Toggle effect", (d) => { const f = d.layers.find((l) => l.id === layer.id)!.effects.find((x) => x.id === fx.id)!; f.on = !f.on; })} />
              <button type="button" className="ed-fx-name" aria-expanded={fx.open} onClick={() => edit("Collapse effect", (d) => { const f = d.layers.find((l) => l.id === layer.id)!.effects.find((x) => x.id === fx.id)!; f.open = !f.open; })}><b>{fx.name}</b><Icon name={fx.open ? "caretDown" : "caretRight"} size={11} /></button>
              <button type="button" className="ed-x" aria-label={`Remove ${fx.name}`} onClick={() => { edit("Remove effect", (d) => ops.removeEffect(d.layers.find((l) => l.id === layer.id)!, fx.id)); }}><Icon name="close" size={11} /></button>
            </div>
            {fx.open ? fx.params.map((p, i) => (
              <Row key={p.n} label={p.n}>
                <NumberField title={`${p.n}${p.u ? ` (${p.u})` : ""}`} value={p.v} step={p.st} {...paramRange(fx.name, p)}
                  onBegin={() => useEditor.getState().begin(`Change ${fx.name} ${p.n}`)}
                  onChange={(v) => useEditor.getState().update((d) => { const param = d.layers.find((l) => l.id === layer.id)?.effects.find((x) => x.id === fx.id)?.params[i]; if (param) param.v = v; })}
                  onCommit={() => useEditor.getState().commit()} onCancel={() => useEditor.getState().cancel()} />
              </Row>
            )) : null}
          </div>
        ))}
        {drag && drag.before === null ? <i className="ed-insert" /> : null}
      </div>
      <div className="ed-addfx">
        <input placeholder="+ Add effect" aria-label="Add effect" role="combobox" aria-expanded={open} value={query} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && names[0]) { edit(`Add ${names[0]}`, (d) => ops.addEffect(d.layers.find((l) => l.id === layer.id)!, names[0]!)); setQuery(""); } }} />
        {open ? <ul role="listbox" className="ed-listbox">{names.map((n) => <li key={n} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { edit(`Add ${n}`, (d) => ops.addEffect(d.layers.find((l) => l.id === layer.id)!, n)); setQuery(""); setOpen(false); }}>{n}</button></li>)}</ul> : null}
      </div>
      <div className="ed-chips">{FX_FAVOURITES.map((n) => <button key={n} type="button" className="ed-pchip" onClick={() => edit(`Add ${n}`, (d) => ops.addEffect(d.layers.find((l) => l.id === layer.id)!, n))}>★ {n}</button>)}</div>
    </section>
  );
}

/** Live updates for a colour while its picker is dragged: one history step, restored on Esc. */
function colourLive(id: string, key: "fill" | "color" | "lcolor", label: string) {
  return {
    begin: () => useEditor.getState().begin(label),
    update: (hex: string) => useEditor.getState().update((d) => { const l = d.layers.find((v) => v.id === id); if (l) l[key] = hex; }),
    commit: () => useEditor.getState().commit(),
    cancel: () => useEditor.getState().cancel()
  };
}

function setField<K extends keyof Layer>(id: string, key: K, value: Layer[K], label: string) {
  useEditor.getState().edit(label, (d) => { const l = d.layers.find((v) => v.id === id); if (l) l[key] = value; });
}

function LayerProps({ layer, filter }: { layer: Layer; filter: string }) {
  const layers = useEditor((s) => s.doc.layers);
  const duration = useEditor((s) => s.duration);
  const show = (...names: string[]) => !filter || names.some((n) => n.toLowerCase().includes(filter.toLowerCase()));
  const drawn = ["text", "solid", "shape", "image", "precomp"].includes(layer.type);
  return (
    <>
      {show("Transform", "Position", "Scale", "Rotation", "Opacity") && drawn ? (
        <section className="ed-sec"><Cap>Transform</Cap>
          {show("Position") ? <AnimRow layer={layer} prop="pos" label="Position" /> : null}
          {show("Scale") ? <AnimRow layer={layer} prop="scale" label="Scale" link step={1} /> : null}
          {show("Rotation") ? <AnimRow layer={layer} prop="rot" label="Rotation" step={1} /> : null}
          {layer.threeD && show("Y rotation") ? <AnimRow layer={layer} prop="ry" label="Y rotation" step={1} /> : null}
          {show("Opacity") ? <AnimRow layer={layer} prop="opacity" label="Opacity" min={0} max={100} step={1} /> : null}
        </section>
      ) : null}
      {layer.type === "text" && show("Text", "Font", "Size", "Fill") ? (
        <section className="ed-sec"><Cap>Text</Cap>
          <Row label="Text" wide><textarea className="ed-ta" aria-label="Layer text" defaultValue={layer.text} key={layer.id + (layer.text ?? "")} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => e.target.value !== layer.text && setField(layer.id, "text", e.target.value, "Edit text")} /></Row>
          <PlainRow label="Font"><select aria-label="Font" value={layer.font} onChange={(e) => setField(layer.id, "font", e.target.value, "Change font")}>{BRAND_FONTS.map((f) => <option key={f}>{f}</option>)}</select><span className="ed-tag">Brand kit</span></PlainRow>
          <PlainRow label="Size"><NumberField title="Font size (px)" value={layer.size ?? 48} min={4} onBegin={() => useEditor.getState().begin("Change size")} onChange={(v) => useEditor.getState().update((d) => { d.layers.find((l) => l.id === layer.id)!.size = v; })} onCommit={() => useEditor.getState().commit()} /></PlainRow>
          <PlainRow label="Fill"><ColorField label="Fill" value={layer.fill ?? "#000000"} brand={BRAND_COLORS} onChange={(c) => setField(layer.id, "fill", c, "Change fill")} live={colourLive(layer.id, "fill", "Change fill")} /></PlainRow>
        </section>
      ) : null}
      {(layer.type === "solid" || layer.type === "shape") && show("Appearance", "Colour", "Blend") ? (
        <section className="ed-sec"><Cap>Appearance</Cap>
          <PlainRow label="Colour"><ColorField label="Colour" value={layer.color ?? "#0A6CFF"} brand={BRAND_COLORS} onChange={(c) => setField(layer.id, "color", c, "Change colour")} live={colourLive(layer.id, "color", "Change colour")} /></PlainRow>
          <PlainRow label="Blend"><select aria-label="Blend mode" value={layer.blend} onChange={(e) => setField(layer.id, "blend", e.target.value, "Change blend mode")}>{BLEND_MODES.map((b) => <option key={b}>{b}</option>)}</select></PlainRow>
        </section>
      ) : null}
      {layer.type === "camera" ? <section className="ed-sec"><Cap>Camera</Cap><PlainRow label="Zoom"><NumberField title="Zoom (px)" value={layer.zoom ?? 2667} onBegin={() => useEditor.getState().begin("Change zoom")} onChange={(v) => useEditor.getState().update((d) => { d.layers.find((l) => l.id === layer.id)!.zoom = v; })} onCommit={() => useEditor.getState().commit()} /></PlainRow><PlainRow label="Depth of field"><input type="checkbox" checked={Boolean(layer.dof)} aria-label="Depth of field" onChange={(e) => setField(layer.id, "dof", e.target.checked, "Toggle depth of field")} /></PlainRow></section> : null}
      {layer.type === "light" ? <section className="ed-sec"><Cap>Light</Cap><PlainRow label="Intensity"><NumberField title="Intensity (%)" value={layer.intensity ?? 100} onBegin={() => useEditor.getState().begin("Change intensity")} onChange={(v) => useEditor.getState().update((d) => { d.layers.find((l) => l.id === layer.id)!.intensity = v; })} onCommit={() => useEditor.getState().commit()} /></PlainRow><PlainRow label="Colour"><ColorField label="Light colour" value={layer.lcolor ?? "#FFFFFF"} brand={BRAND_COLORS} onChange={(c) => setField(layer.id, "lcolor", c, "Change light colour")} live={colourLive(layer.id, "lcolor", "Change light colour")} /></PlainRow></section> : null}
      {layer.type === "audio" ? <section className="ed-sec"><Cap>Audio</Cap><PlainRow label="Volume"><NumberField title="Volume (dB)" value={layer.vol ?? 0} min={-60} max={12} onBegin={() => useEditor.getState().begin("Change volume")} onChange={(v) => useEditor.getState().update((d) => { d.layers.find((l) => l.id === layer.id)!.vol = v; })} onCommit={() => useEditor.getState().commit()} /></PlainRow></section> : null}
      {show("Timing", "In", "Out", "Parent", "3D") ? (
        <section className="ed-sec"><Cap>Timing and structure</Cap>
          <PlainRow label="In / out">
            <NumberField label="In" title="In point (s)" value={layer.inP} step={0.05} min={0} max={layer.outP - 0.1} onBegin={() => useEditor.getState().begin("Change in point")} onChange={(v) => useEditor.getState().update((d) => { d.layers.find((l) => l.id === layer.id)!.inP = v; })} onCommit={() => useEditor.getState().commit()} />
            <NumberField label="Out" title="Out point (s)" value={layer.outP} step={0.05} min={layer.inP + 0.1} max={duration} onBegin={() => useEditor.getState().begin("Change out point")} onChange={(v) => useEditor.getState().update((d) => { d.layers.find((l) => l.id === layer.id)!.outP = v; })} onCommit={() => useEditor.getState().commit()} />
          </PlainRow>
          <PlainRow label="Parent"><select aria-label="Parent layer" value={layer.parent ?? ""} onChange={(e) => { const v = e.target.value || null; useEditor.getState().edit("Set parent", (d) => { if (!ops.setParent(d, layer.id, v)) useEditor.getState().say("A layer cannot be parented to its own child."); }); }}><option value="">None</option>{layers.filter((l) => l.id !== layer.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></PlainRow>
          {drawn ? <PlainRow label="3D layer"><input type="checkbox" checked={layer.threeD} aria-label="3D layer" onChange={(e) => setField(layer.id, "threeD", e.target.checked, "Toggle 3D")} /></PlainRow> : null}
        </section>
      ) : null}
      {layer.type === "precomp" && layer.src ? <section className="ed-sec"><Cap>Source</Cap><p className="ed-bridge-src"><Icon name="bridge" size={13} />{layer.src}</p></section> : null}
      {show("Effects") ? <LayerEffects layer={layer} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------- clip properties

function CssRows({ clip }: { clip: Clip }) {
  const [rows, setRows] = useState(clip.css);
  useEffect(() => setRows(clip.css), [clip.css]);
  const save = (next: [string, string][]) => useEditor.getState().edit("Edit CSS", (d) => { d.html = setStyle(d.html, clip.id, next); });
  return (
    <>
      {rows.map(([k, v], i) => (
        <div key={i} className="ed-css">
          <input className="ed-mono key" aria-label="CSS property" value={k} spellCheck={false} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} onBlur={() => save(rows)} onKeyDown={(e) => e.stopPropagation()} />
          <input aria-label={`${k} value`} value={v} spellCheck={false} onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} onBlur={() => save(rows)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          {/^#[0-9a-f]{6}$/i.test(v) ? <input type="color" aria-label={`${k} colour`} value={v} onChange={(e) => { const next = rows.map((r, j) => (j === i ? [r[0], e.target.value] as [string, string] : r)); setRows(next); save(next); }} /> : <span />}
          <button type="button" className="ed-x" aria-label={`Remove ${k}`} onClick={() => save(rows.filter((_, j) => j !== i))}><Icon name="close" size={11} /></button>
        </div>
      ))}
      <button type="button" className="ed-btn small" onClick={() => save([...rows, ["opacity", "1"]])}><Icon name="plus" size={11} />Property</button>
    </>
  );
}

function ClipProps({ clip }: { clip: Clip }) {
  const html = useEditor((s) => s.doc.html);
  const hfOnly = useEditor((s) => s.hfOnly);
  const tweens = readTweens(html, clip.id, clip.start);
  const edit = useEditor((s) => s.edit);
  const [text, setLocalText] = useState(clip.text);
  useEffect(() => setLocalText(clip.text), [clip.text, clip.id]);
  const timing = (patch: { start?: number; dur?: number; track?: number }) => edit("Change timing", (d) => { d.html = setTiming(d.html, clip.id, patch); });
  const audio = clip.kind === "audio";
  return (
    <>
      {clip.gen ? <p className="ed-note">Generated by code. Simple edits work here; ask the agent for structural changes.</p> : null}
      <section className="ed-sec"><Cap>Timing</Cap>
        <PlainRow label="Start"><NumberField title="Start (s)" value={clip.start} step={0.05} min={0} onChange={(v) => timing({ start: v })} /></PlainRow>
        <PlainRow label="Duration"><NumberField title="Duration (s)" value={clip.dur} step={0.05} min={0.1} onChange={(v) => timing({ dur: v })} /></PlainRow>
        <PlainRow label="Track"><NumberField title="Track" value={clip.track} min={0} step={1} onChange={(v) => timing({ track: Math.round(v) })} /></PlainRow>
      </section>
      {clip.kind === "text" ? <section className="ed-sec"><Cap>Text</Cap><textarea className="ed-ta" aria-label="Clip text" value={text} onChange={(e) => setLocalText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onBlur={() => text !== clip.text && edit("Edit text", (d) => { d.html = setText(d.html, clip.id, text); })} /></section> : null}
      {audio ? (
        <section className="ed-sec"><Cap>Audio</Cap>
          <PlainRow label="Volume"><NumberField title="Volume (dB)" value={clip.vol ?? 0} min={-60} max={12} onChange={(v) => edit("Change volume", (d) => { d.html = setAttribute(d.html, clip.id, "data-volume", String(v)); })} /></PlainRow>
          <PlainRow label="Mute"><input type="checkbox" checked={Boolean(clip.mute)} aria-label="Mute" onChange={(e) => edit("Toggle mute", (d) => { d.html = setAttribute(d.html, clip.id, "muted", e.target.checked ? "" : null); })} /></PlainRow>
        </section>
      ) : (
        <>
          <section className="ed-sec"><Cap>Inline CSS</Cap><CssRows clip={clip} /></section>
          <section className="ed-sec"><Cap>Animation</Cap>
            {tweens.map((tw, i) => (
              <div key={tw.id + i} className={`ed-tween-card ${useEditor.getState().keySel[0]?.prop === tw.id ? "on" : ""}`} onClick={() => useEditor.getState().ui({ keySel: [{ id: clip.id, prop: tw.id, t: 0 }] })}>
                <div className="ed-tween-h"><b>{tw.prop}</b><span className="ed-mono ed-muted">{tw.from || "—"} → {tw.to}</span><button type="button" className="ed-x" aria-label={`Remove ${tw.prop} tween`} onClick={() => edit("Remove tween", (d) => { d.html = removeTween(d.html, tw.id); })}><Icon name="close" size={11} /></button></div>
                <div className="ed-tween-g">
                  <PlainRow label="From"><input className="ed-mono" aria-label="From" defaultValue={tw.from} key={tw.id + tw.from} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => e.target.value !== tw.from && edit("Edit tween", (d) => { d.html = updateTween(d.html, tw.id, clip.start, { from: e.target.value }); })} /></PlainRow>
                  <PlainRow label="To"><input className="ed-mono" aria-label="To" defaultValue={tw.to} key={tw.id + tw.to} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => e.target.value !== tw.to && edit("Edit tween", (d) => { d.html = updateTween(d.html, tw.id, clip.start, { to: e.target.value }); })} /></PlainRow>
                  <PlainRow label="Duration"><NumberField title="Duration (s)" value={tw.dur} step={0.05} min={0.05} onChange={(v) => edit("Edit tween", (d) => { d.html = updateTween(d.html, tw.id, clip.start, { dur: v }); })} /></PlainRow>
                  <PlainRow label="At"><NumberField title="At (s from clip start)" value={tw.at} step={0.05} min={0} onChange={(v) => edit("Edit tween", (d) => { d.html = updateTween(d.html, tw.id, clip.start, { at: v }); })} /></PlainRow>
                  <PlainRow label="Ease"><select aria-label="Ease" value={tw.ease} onChange={(e) => edit("Change ease", (d) => { d.html = updateTween(d.html, tw.id, clip.start, { ease: e.target.value }); })}>{[...new Set([...EASES, tw.ease])].map((x) => <option key={x}>{x}</option>)}</select></PlainRow>
                </div>
              </div>
            ))}
            <button type="button" className="ed-btn small" onClick={() => edit("Add tween", (d) => { d.html = addTween(d.html, clip.id, clip.start, { prop: "opacity", from: "0", to: "1", dur: 0.4, ease: "power2.out" }); })}><Icon name="plus" size={11} />Tween</button>
          </section>
        </>
      )}
      {!hfOnly ? (
        <section className="ed-bridge-card"><b>Send to Layers</b><span>Render this clip as a transparent layer inside a Layers composition.</span>
          <button type="button" className="ed-btn small" onClick={() => useEditor.getState().ui({ modal: "bridge" })}>Send to Layers…</button></section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------- other tabs

function VariablesTab() {
  const vars = useEditor((s) => s.doc.vars);
  const labels: Record<string, [string, string]> = { headline: ["Headline", "Guided editors can change the headline text."], logo: ["Logo", "Guided editors can swap the logo from their brand kit."], accent: ["Accent colour", "Guided editors can pick another brand colour."] };
  return (
    <div className="ed-pad">
      <p className="ed-note">Tick the fields a guided-editor user may change. Everything else stays locked.</p>
      {Object.entries(vars).map(([k, on]) => (
        <label key={k} className={`ed-var ${on ? "on" : ""}`}><input type="checkbox" checked={on} onChange={() => useEditor.getState().edit("Toggle variable", (d) => { d.vars[k] = !d.vars[k]; })} /><span><b>{labels[k]?.[0] ?? k}</b><em>{labels[k]?.[1] ?? ""}</em></span></label>
      ))}
      <button type="button" className="ed-btn primary" onClick={() => useEditor.getState().ui({ modal: "publish" })}>Publish as template…</button>
    </div>
  );
}

function ReviewTab() {
  const comments = useEditor((s) => s.doc.comments);
  const t = useEditor((s) => s.t);
  const [draft, setDraft] = useState("");
  return (
    <div className="ed-pad">
      {comments.map((c) => (
        <article key={c.id} className={`ed-comment ${c.resolved ? "done" : ""}`}>
          <span className="ed-avatar">{c.ini}</span>
          <div><div className="ed-comment-h"><b>{c.who}</b><button type="button" className="ed-timechip ed-mono" onClick={() => useEditor.getState().setT(c.at)} aria-label={`Seek to ${formatTime(c.at)}`}>{formatTime(c.at)}</button></div><p>{c.text}</p>
            <button type="button" className="ed-linkbtn" onClick={() => useEditor.getState().edit(c.resolved ? "Reopen comment" : "Resolve comment", (d) => { const x = d.comments.find((v) => v.id === c.id)!; x.resolved = !x.resolved; })}>{c.resolved ? "Reopen" : "Resolve"}</button></div>
        </article>
      ))}
      {!comments.length ? <p className="ed-note">No comments yet.</p> : null}
      <label className="ed-pin-form"><span>Pin a comment at {formatTime(t)}</span><textarea value={draft} placeholder="What should change here?" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
      <button type="button" className="ed-btn primary" disabled={!draft.trim()} onClick={() => { useEditor.getState().edit("Pin comment", (d) => { d.comments.push({ id: newId("c"), who: "You", ini: "OE", at: t, text: draft.trim(), resolved: false }); }); setDraft(""); }}>Pin comment</button>
    </div>
  );
}

function ChecksTab() {
  const checks = useEditor((s) => s.checks);
  const mode = useEditor((s) => s.mode);
  const goTo = (i: { id: string; t?: number }) => {
    const st = useEditor.getState();
    if (st.mode === "clips") { const c = readClips(st.doc.html).clips.find((v) => v.id === i.id); st.selectClip(i.id); if (c) st.setT(c.start); }
    else { st.select([i.id]); if (i.t !== undefined) st.setT(i.t); }
    st.ui({ rightTab: "properties" });
  };
  const errors = checks?.filter((c) => c.lvl === "error").length ?? 0;
  return (
    <div className="ed-pad">
      <div className="ed-checks-h"><b>{checks === null ? "Not checked yet" : checks.length ? `${errors} error${errors === 1 ? "" : "s"}, ${checks.length - errors} warning${checks.length - errors === 1 ? "" : "s"}` : "Ready to render"}</b><button type="button" className="ed-btn small" onClick={() => runCheck()}>Run again</button></div>
      <p className="ed-note">{mode === "clips" ? "Lint runs on the HTML composition." : "Composition checks."} Errors block a full render; warnings do not.</p>
      {checks?.length === 0 ? <div className="ed-ok"><Icon name="check2" size={14} />Ready to render</div> : null}
      {checks?.map((c, i) => (
        <div key={i} className={`ed-issue ${c.lvl}`}><span className="ed-issue-i">{c.lvl === "error" ? "✕" : "!"}</span><div><b>{c.msg}</b><em>{c.hint}</em></div><button type="button" className="ed-linkbtn" onClick={() => goTo(c)}>Go to</button></div>
      ))}
    </div>
  );
}

function SourceTab() {
  const html = useEditor((s) => s.doc.html);
  const [text, setLocal] = useState(html);
  useEffect(() => setLocal(html), [html]);
  return (
    <div className="ed-pad grow">
      <p className="ed-note">The whole composition. Changes apply when you leave the box.</p>
      <textarea className="ed-source ed-mono" spellCheck={false} value={text} aria-label="Composition source" onChange={(e) => setLocal(e.target.value)} onKeyDown={(e) => e.stopPropagation()} onBlur={() => text !== html && useEditor.getState().edit("Edit source", (d) => { d.html = text; })} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- shell

export function Inspector() {
  const s = useEditorState();
  const [filter, setFilter] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const tabs = s.mode === "clips" ? TABS_CLIPS : TABS_LAYERS;
  const tab = tabs.some((t) => t.id === s.rightTab) ? s.rightTab : "properties";
  const model = useMemo(() => (s.mode === "clips" ? readClips(s.doc.html) : null), [s.mode, s.doc.html]);
  const layer = s.mode === "layers" ? s.doc.layers.find((l) => l.id === s.sel[0]) : undefined;
  const clip = model?.clips.find((c) => c.id === s.clipSel[0]);
  const issues = s.checks?.length ?? 0;

  if (!s.rightOpen) {
    return (
      <aside className="ed-card ed-right collapsed" aria-label="Inspector">
        <button type="button" className="ed-ibtn" aria-label="Open inspector" onClick={() => s.ui({ rightOpen: true })}><Icon name="chevL" size={14} /></button>
        <span className="ed-vert">Inspector</span>
      </aside>
    );
  }
  const target = s.mode === "clips" ? (clip ? `#${clip.id}` : "main") : layer ? layer.name : "main";
  return (
    <aside className="ed-card ed-right" aria-label="Inspector">
      <div className="ed-panel-head">
        <Tabs tabs={tabs} value={tab} onChange={(id) => s.ui({ rightTab: id })} badge={{ checks: issues }} />
        <IconButton icon="chevR" label="Collapse inspector" onClick={() => s.ui({ rightOpen: false })} />
      </div>
      <div className="ed-ins-body" ref={body}>
        <div className="ed-ins-main">
        {tab === "properties" ? (
          s.mode === "layers" ? (
            layer ? (
              <>
                <div className="ed-ins-head">
                  <input className="ed-name" aria-label="Layer name" key={layer.id + layer.name} defaultValue={layer.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={(e) => e.target.value.trim() && e.target.value !== layer.name && setField(layer.id, "name", e.target.value.trim(), "Rename layer")} />
                  <span className="ed-typebadge ed-mono">{layer.type}</span>
                </div>
                {s.sel.length > 1 ? <p className="ed-note">{s.sel.length} layers selected. Showing {layer.name}.</p> : null}
                <div className="ed-filter"><Icon name="search" size={12} /><input placeholder="Filter properties" aria-label="Filter properties" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
                <LayerProps layer={layer} filter={filter} />
              </>
            ) : <Empty text="Select a layer to edit its properties." hint="Click a layer on the canvas, in the list or on the timeline." />
          ) : clip ? (
            <>
              <div className="ed-ins-head"><b className="ed-name static">#{clip.id}</b><span className="ed-typebadge ed-mono">&lt;{clip.kind === "text" ? "div" : clip.kind === "img" ? "img" : clip.kind === "video" ? "video" : clip.kind === "audio" ? "audio" : "div"}&gt;</span><span className="ed-fileselect ed-mono">index.html</span></div>
              <ClipProps clip={clip} />
            </>
          ) : <Empty text="Select a clip to edit it." hint="Click a clip on the canvas or timeline." />
        ) : tab === "variables" ? <VariablesTab /> : tab === "review" ? <ReviewTab /> : tab === "checks" ? <ChecksTab /> : <SourceTab />}
        </div>
        <AgentDock target={target} />
      </div>
    </aside>
  );
}

function Empty({ text, hint }: { text: string; hint: string }) {
  return <div className="ed-empty"><b>{text}</b><span>{hint}</span></div>;
}
