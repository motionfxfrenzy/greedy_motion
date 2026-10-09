"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { valueAt, writeProperty } from "../../lib/editor/anim.ts";
import { readClips } from "../../lib/editor/clips-model.ts";
import { ACTION_SAFE, TITLE_SAFE, angleToPoint, boxBounds, handlePoint, layerBox, pointInBox, rectsIntersect, safeRect, scaleFromHandle, HANDLE_IDS, type HandleId } from "../../lib/editor/geometry.ts";
import { setStyle, setText } from "../../lib/editor/html-source.ts";
import type { FrameRects } from "../../lib/editor/frame-bridge.ts";
import { isAdditive, withRect } from "../../lib/editor/selection.ts";
import { SNAP_RADIUS_PX, radiusInUnits, snapEdges, type SnapCandidate } from "../../lib/editor/snap.ts";
import { useEditor, useEditorState } from "../../lib/editor/store.ts";
import type { Box, Layer, Rect } from "../../lib/editor/types.ts";
import { ClipFrame, type ClipFrameHandle } from "./ClipFrame.tsx";
import { startDrag } from "./drag.ts";
import { LayerStage } from "./LayerStage.tsx";
import { Transport } from "./Transport.tsx";
import { Icon } from "./icons.tsx";

type Guide = { axis: "x" | "y"; at: number; label: string };
const ZOOMS = ["fit", 25, 50, 75, 100, 200] as const;
const HANDLE_CURSOR: Record<HandleId, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const DRAWABLE = new Set(["text", "solid", "shape", "image", "precomp"]);
const px = (v: string | undefined) => Number.parseFloat(v ?? "") || 0;

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Canvas() {
  const s = useEditorState();
  const t = useEditor((state) => state.t);
  const [areaRef, area] = useSize();
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<ClipFrameHandle>(null);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>("fit");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  // Every clip's rectangle is kept in a ref: the frame reports them on each seek, and re-rendering for all of them would
  // cost a render per frame. Only a change to the selected clip's box re-renders (its selection overlay).
  const rectsRef = useRef<FrameRects>({});
  const [, redraw] = useState(0);
  const shownRect = useRef("");
  const setRects = (next: FrameRects) => {
    rectsRef.current = next;
    const key = useEditor.getState().clipSel.map((id) => next[id]?.join(",") ?? "").join("|");
    if (key !== shownRect.current) { shownRect.current = key; redraw((n) => n + 1); }
  };
  const rects = rectsRef.current;
  const [clipDrag, setClipDrag] = useState<{ id: string; css: [string, string][] } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const { canvas } = s;
  const pad = s.rulersOn ? 52 : 36;
  const fit = Math.max(0.05, Math.min((area.w - pad * 2) / canvas.width, (area.h - pad * 2) / canvas.height));
  const scale = zoom === "fit" ? fit : zoom / 100;
  const model = useMemo(() => (s.mode === "clips" ? readClips(s.doc.html) : null), [s.mode, s.doc.html]);

  const toCanvas = (cx: number, cy: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
  };

  // ------------------------------------------------------------------ layers mode
  const snapCandidates = (skip: string[]) => {
    const st = useEditor.getState();
    const act = safeRect(canvas, ACTION_SAFE);
    const title = safeRect(canvas, TITLE_SAFE);
    const xs: SnapCandidate[] = [{ value: canvas.width / 2, label: "Centre" }, { value: act.x, label: "Action safe" }, { value: act.x + act.w, label: "Action safe" }, { value: title.x, label: "Title safe" }, { value: title.x + title.w, label: "Title safe" }];
    const ys: SnapCandidate[] = [{ value: canvas.height / 2, label: "Centre" }, { value: act.y, label: "Action safe" }, { value: act.y + act.h, label: "Action safe" }, { value: title.y, label: "Title safe" }, { value: title.y + title.h, label: "Title safe" }];
    for (const l of st.doc.layers) {
      if (skip.includes(l.id) || !DRAWABLE.has(l.type) || !l.vis) continue;
      const b = layerBox(l, st.t);
      xs.push({ value: b.cx - b.w / 2, label: l.name }, { value: b.cx, label: l.name }, { value: b.cx + b.w / 2, label: l.name });
      ys.push({ value: b.cy - b.h / 2, label: l.name }, { value: b.cy, label: l.name }, { value: b.cy + b.h / 2, label: l.name });
    }
    return { xs, ys };
  };

  const hitLayer = (x: number, y: number): Layer | null => {
    const st = useEditor.getState();
    const soloed = st.doc.layers.some((l) => l.solo);
    for (const l of st.doc.layers) {
      if (!l.vis || (soloed && !l.solo) || st.t < l.inP || st.t >= l.outP) continue;
      if (l.type === "null") { const p = valueAt(l, "pos", st.t) as number[]; if (Math.hypot(p[0]! - x, p[1]! - y) < 14 / scale) return l; continue; }
      if (!DRAWABLE.has(l.type)) continue;
      if (pointInBox(layerBox(l, st.t), x, y)) return l;
    }
    return null;
  };

  const startMove = (e: React.PointerEvent, ids: string[], onClick?: () => void) => {
    const st = useEditor.getState();
    const movers = st.doc.layers.filter((l) => ids.includes(l.id));
    if (movers.every((l) => l.lock)) { st.say("That layer is locked."); return; }
    const free = movers.filter((l) => !l.lock);
    const starts = free.map((l) => ({ id: l.id, pos: [...(valueAt(l, "pos", st.t) as number[])] }));
    const primary = layerBox(free[0]!, st.t);
    const { xs, ys } = snapCandidates(ids);
    startDrag(e, {
      onStart: () => st.begin(free.length === 1 ? `Move ${free[0]!.name}` : "Move layers"),
      onMove: (dx, dy, ev) => {
        let ddx = dx / scale;
        let ddy = dy / scale;
        if (ev.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; }
        const found: Guide[] = [];
        if (useEditor.getState().snapOn && !ev.metaKey && !ev.ctrlKey) {
          const r = radiusInUnits(scale);
          const sx = ddy === 0 && ev.shiftKey ? { delta: 0, hit: null } : snapEdges([primary.cx - primary.w / 2 + ddx, primary.cx + ddx, primary.cx + primary.w / 2 + ddx], xs, r);
          const sy = ddx === 0 && ev.shiftKey ? { delta: 0, hit: null } : snapEdges([primary.cy - primary.h / 2 + ddy, primary.cy + ddy, primary.cy + primary.h / 2 + ddy], ys, r);
          ddx += sx.delta; ddy += sy.delta;
          if (sx.hit) found.push({ axis: "x", at: sx.hit.value, label: sx.hit.label });
          if (sy.hit) found.push({ axis: "y", at: sy.hit.value, label: sy.hit.label });
        }
        setGuides(found);
        useEditor.getState().update((d) => { for (const o of starts) { const l = d.layers.find((v) => v.id === o.id)!; writeProperty(l, "pos", [Math.round(o.pos[0]! + ddx), Math.round(o.pos[1]! + ddy)], st.t); } });
      },
      onEnd: () => { setGuides([]); useEditor.getState().commit(); },
      onCancel: () => { setGuides([]); useEditor.getState().cancel(); },
      onClick
    });
  };

  const startResize = (e: React.PointerEvent, layer: Layer, id: HandleId) => {
    e.stopPropagation();
    const st = useEditor.getState();
    if (layer.lock) return st.say("That layer is locked.");
    if (layer.threeD) return st.say("Use the 3D gizmo to move or scale a 3D layer.");
    const box = layerBox(layer, st.t);
    const base = [...(valueAt(layer, "scale", st.t) as number[])];
    startDrag(e, {
      onStart: () => st.begin(`Resize ${layer.name}`),
      onMove: (_dx, _dy, ev) => {
        const p = toCanvas(ev.clientX, ev.clientY);
        const next = scaleFromHandle(box, base, id, p.x, p.y, !ev.altKey);
        useEditor.getState().update((d) => writeProperty(d.layers.find((v) => v.id === layer.id)!, "scale", next, st.t));
      },
      onEnd: () => useEditor.getState().commit(),
      onCancel: () => useEditor.getState().cancel()
    });
  };

  const startRotate = (e: React.PointerEvent, layer: Layer) => {
    e.stopPropagation();
    const st = useEditor.getState();
    if (layer.lock) return st.say("That layer is locked.");
    const box = layerBox(layer, st.t);
    startDrag(e, {
      onStart: () => st.begin(`Rotate ${layer.name}`),
      onMove: (_dx, _dy, ev) => { const p = toCanvas(ev.clientX, ev.clientY); const deg = angleToPoint(box, p.x, p.y, ev.shiftKey); useEditor.getState().update((d) => writeProperty(d.layers.find((v) => v.id === layer.id)!, "rot", deg, st.t)); },
      onEnd: () => useEditor.getState().commit(),
      onCancel: () => useEditor.getState().cancel()
    });
  };

  const startMarquee = (e: React.PointerEvent) => {
    const origin = toCanvas(e.clientX, e.clientY);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const before = useEditor.getState().sel;
    startDrag(e, {
      onMove: (_dx, _dy, ev) => {
        const p = toCanvas(ev.clientX, ev.clientY);
        const r = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) };
        setMarquee(r);
        const st = useEditor.getState();
        const hit = st.doc.layers.filter((l) => l.vis && DRAWABLE.has(l.type) && st.t >= l.inP && st.t < l.outP && rectsIntersect(boxBounds(layerBox(l, st.t)), r)).map((l) => l.id);
        st.ui({ sel: withRect(before, hit, additive), keySel: [] });
      },
      onEnd: () => setMarquee(null),
      onCancel: () => { setMarquee(null); useEditor.getState().ui({ sel: [...before] }); },
      onClick: () => { setMarquee(null); if (!additive) useEditor.getState().select([]); }
    });
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = toCanvas(e.clientX, e.clientY);
    const st = useEditor.getState();
    if (st.mode === "layers") {
      const hit = hitLayer(p.x, p.y);
      if (!hit) return startMarquee(e);
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      // ⌘ / Shift-click on a selected layer removes it; otherwise a press on a selected layer keeps the group so it moves together.
      if (additive) st.select([hit.id], true);
      else if (!st.sel.includes(hit.id)) st.select([hit.id]);
      const now = useEditor.getState().sel;
      if (!now.includes(hit.id)) return;
      startMove(e, now, () => { if (!additive && useEditor.getState().sel.length > 1) useEditor.getState().select([hit.id]); });
      return;
    }
    // HTML clips
    const clips = model?.clips ?? [];
    const hit = [...clips].reverse().find((c) => { if (c.kind === "audio" || st.t < c.start || st.t >= c.start + c.dur) return false; const r = rects[c.id]; return r && p.x >= r[0] && p.x <= r[0] + r[2] && p.y >= r[1] && p.y <= r[1] + r[3]; });
    if (!hit) { startClipMarquee(e); return; }
    const mods = { toggle: e.shiftKey || e.metaKey || e.ctrlKey };
    const order = clips.map((c) => c.id);
    // Pressing a selected clip keeps the group so it can be dragged together; a plain click without a drag narrows to it.
    if (!st.clipSel.includes(hit.id) || isAdditive(mods)) st.pickClip(hit.id, order, mods);
    const now = useEditor.getState().clipSel;
    if (!now.includes(hit.id)) return;
    startClipMove(e, now, () => { if (!isAdditive(mods) && useEditor.getState().clipSel.length > 1) useEditor.getState().pickClip(hit.id, order, {}); });
  };

  /** Drag on empty canvas in HTML clips mode: select every visible clip the rectangle touches. */
  const startClipMarquee = (e: React.PointerEvent) => {
    const origin = toCanvas(e.clientX, e.clientY);
    const mods = { toggle: e.shiftKey || e.metaKey || e.ctrlKey };
    const before = useEditor.getState().clipSel;
    startDrag(e, {
      onMove: (_dx, _dy, ev) => {
        const p = toCanvas(ev.clientX, ev.clientY);
        const r = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) };
        setMarquee(r);
        const st = useEditor.getState();
        const hit = (model?.clips ?? []).filter((c) => c.kind !== "audio" && st.t >= c.start && st.t < c.start + c.dur && rects[c.id] && rectsIntersect({ x: rects[c.id]![0], y: rects[c.id]![1], w: rects[c.id]![2], h: rects[c.id]![3] }, r)).map((c) => c.id);
        st.selectClips(withRect(before, hit, isAdditive(mods)));
      },
      onEnd: () => setMarquee(null),
      onCancel: () => { setMarquee(null); useEditor.getState().selectClips([...before]); },
      onClick: () => { setMarquee(null); if (!isAdditive(mods)) useEditor.getState().selectClip(null); }
    });
  };

  // ------------------------------------------------------------------ HTML clips mode
  const clipCss = (id: string) => model?.clips.find((c) => c.id === id)?.css ?? [];
  const startClipMove = (e: React.PointerEvent, ids: readonly string[], onClick?: () => void) => {
    const items = ids.map((id) => {
      const base = clipCss(id).map((r) => [...r] as [string, string]);
      const has = (k: string) => base.some((r) => r[0] === k);
      return { id, base, lockX: has("right") && has("left"), left0: px(base.find((r) => r[0] === "left")?.[1]), top0: px(base.find((r) => r[0] === "top")?.[1]) };
    });
    const last = new Map(items.map((i) => [i.id, i.base]));
    startDrag(e, {
      onMove: (dx, dy, ev) => {
        let ddx = dx / scale;
        let ddy = dy / scale;
        if (ev.shiftKey) { if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0; else ddx = 0; }
        for (const item of items) {
          const css = item.base.map((r) => [...r] as [string, string]);
          const put = (k: string, v: number) => { const row = css.find((r) => r[0] === k); if (row) row[1] = `${Math.round(v)}px`; else css.push([k, `${Math.round(v)}px`]); };
          if (!item.lockX) put("left", item.left0 + ddx);
          put("top", item.top0 + ddy);
          last.set(item.id, css);
          frameRef.current?.style(item.id, { left: css.find((r) => r[0] === "left")?.[1] ?? "", top: css.find((r) => r[0] === "top")?.[1] ?? "" });
        }
        setClipDrag({ id: items[0]!.id, css: last.get(items[0]!.id)! });
      },
      onEnd: () => {
        useEditor.getState().edit(items.length > 1 ? `Move ${items.length} clips` : "Move clip", (d) => { let html = d.html; for (const item of items) html = setStyle(html, item.id, last.get(item.id)!); d.html = html; });
        setClipDrag(null);
      },
      onCancel: () => { setClipDrag(null); for (const item of items) frameRef.current?.style(item.id, { left: item.base.find((r) => r[0] === "left")?.[1] ?? "", top: item.base.find((r) => r[0] === "top")?.[1] ?? "" }); },
      onClick
    });
  };

  const startClipResize = (e: React.PointerEvent, id: string, handle: HandleId, rect: Rect) => {
    e.stopPropagation();
    const base = clipCss(id).map((r) => [...r] as [string, string]);
    let last = base;
    const [sx, sy] = [handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0, handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0];
    startDrag(e, {
      onMove: (dx, dy, ev) => {
        const css = base.map((r) => [...r] as [string, string]);
        const put = (k: string, v: number) => { const row = css.find((r) => r[0] === k); if (row) row[1] = `${Math.round(v)}px`; else css.push([k, `${Math.round(v)}px`]); };
        let w = rect.w + sx * (dx / scale);
        let h = rect.h + sy * (dy / scale);
        if (ev.shiftKey || (sx && sy)) { const k = sx ? w / rect.w : h / rect.h; w = rect.w * k; h = rect.h * k; }
        w = Math.max(8, w); h = Math.max(8, h);
        if (sx) put("width", w);
        if (sy || (sx && sy)) put("height", h);
        if (sx < 0) put("left", rect.x + rect.w - w);
        if (sy < 0) put("top", rect.y + rect.h - h);
        last = css;
        setClipDrag({ id, css });
        frameRef.current?.style(id, Object.fromEntries(css.map(([k, v]) => [k, v])));
      },
      onEnd: () => { useEditor.getState().edit("Resize clip", (d) => { d.html = setStyle(d.html, id, last); }); setClipDrag(null); },
      onCancel: () => { setClipDrag(null); frameRef.current?.style(id, Object.fromEntries(base)); }
    });
  };

  // ------------------------------------------------------------------ overlay pieces
  const sx = (v: number) => v * scale;
  const stale = s.frameStale;
  const primaryLayer = s.mode === "layers" ? s.doc.layers.find((l) => l.id === s.sel[0]) : undefined;

  const selectionBox = (box: Box, key: string, opts: { name: string; size: string; handles: boolean; layer?: Layer; clipRect?: Rect; clipId?: string }) => (
    <div key={key} className={`ed-selbox ${stale ? "stale" : ""}`} style={{ left: sx(box.cx - box.w / 2), top: sx(box.cy - box.h / 2), width: sx(box.w), height: sx(box.h), transform: `rotate(${box.rot}deg)` }}>
      <span className="ed-nametag">{opts.name}</span>
      <span className="ed-sizetag ed-mono">{opts.size}</span>
      {opts.handles ? (
        <>
          {HANDLE_IDS.map((h) => {
            const [hx, hy] = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] }[h]!;
            return <i key={h} className="ed-handle" role="button" aria-label={`Resize ${opts.name}, ${{ nw: "top-left", n: "top", ne: "top-right", e: "right", se: "bottom-right", s: "bottom", sw: "bottom-left", w: "left" }[h]}`} style={{ left: `${hx}%`, top: `${hy}%`, cursor: HANDLE_CURSOR[h] }}
              onPointerDown={(e) => (opts.layer ? startResize(e, opts.layer, h) : opts.clipRect && opts.clipId ? startClipResize(e, opts.clipId, h, opts.clipRect) : undefined)} />;
          })}
          {opts.layer ? <i className="ed-rotknob" role="button" aria-label={`Rotate ${opts.name}`} onPointerDown={(e) => startRotate(e, opts.layer!)} /> : null}
        </>
      ) : null}
    </div>
  );

  const layersOverlay = () => {
    const out: React.ReactNode[] = [];
    for (const id of s.sel) {
      const l = s.doc.layers.find((v) => v.id === id);
      if (!l || !l.vis || t < l.inP || t >= l.outP) continue;
      if (l.type === "null") { const p = valueAt(l, "pos", t) as number[]; out.push(<i key={l.id} className="ed-null" style={{ left: sx(p[0]!), top: sx(p[1]!) }} />); continue; }
      if (!DRAWABLE.has(l.type)) continue;
      const box = layerBox(l, t);
      out.push(selectionBox(box, l.id, { name: l.name, size: `${Math.round(box.w)}×${Math.round(box.h)}`, handles: l.id === primaryLayer?.id && !l.lock && !l.threeD, layer: l }));
    }
    if (primaryLayer?.threeD) {
      const p = valueAt(primaryLayer, "pos", t) as number[];
      out.push(
        <div key="gizmo" className="ed-gizmo" style={{ left: sx(p[0]!), top: sx(p[1]!) }} aria-label="3D gizmo">
          <span className="x" role="button" aria-label="Move on X" onPointerDown={(e) => gizmoMove(e, primaryLayer, "x")} />
          <span className="y" role="button" aria-label="Move on Y" onPointerDown={(e) => gizmoMove(e, primaryLayer, "y")} />
          <span className="z" aria-hidden="true" />
        </div>
      );
    }
    return out;
  };

  const gizmoMove = (e: React.PointerEvent, layer: Layer, axis: "x" | "y") => {
    e.stopPropagation();
    const st = useEditor.getState();
    const start = [...(valueAt(layer, "pos", st.t) as number[])];
    startDrag(e, {
      onStart: () => st.begin(`Move ${layer.name} on ${axis.toUpperCase()}`),
      onMove: (dx, dy) => useEditor.getState().update((d) => writeProperty(d.layers.find((v) => v.id === layer.id)!, "pos", axis === "x" ? [Math.round(start[0]! + dx / scale), start[1]!] : [start[0]!, Math.round(start[1]! + dy / scale)], st.t)),
      onEnd: () => useEditor.getState().commit(),
      onCancel: () => useEditor.getState().cancel()
    });
  };

  const clipsOverlay = () => {
    if (!s.clipSel.length || !model) return null;
    // Every selected clip gets an outline; only a lone selection gets resize handles.
    return s.clipSel.map((id) => {
      const clip = model.clips.find((c) => c.id === id);
      if (!clip || clip.kind === "audio" || t < clip.start || t >= clip.start + clip.dur) return null;
      const r = rects[clip.id];
      if (!r) return null;
      const rect = { x: r[0], y: r[1], w: r[2], h: r[3] };
      const box: Box = { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, w: rect.w, h: rect.h, rot: 0 };
      return selectionBox(box, clip.id, { name: `#${clip.id}`, size: `${Math.round(rect.w)}×${Math.round(rect.h)}`, handles: s.clipSel.length === 1 && !clip.css.some((c) => c[0] === "right"), clipRect: rect, clipId: clip.id });
    });
  };

  const onDouble = (e: React.MouseEvent) => {
    const p = toCanvas(e.clientX, e.clientY);
    const st = useEditor.getState();
    if (st.mode === "layers") {
      const hit = hitLayer(p.x, p.y);
      if (hit?.type === "text") setEditing({ id: hit.id, text: hit.text ?? "" });
      else if (hit?.type === "precomp") st.say("Pre-comps open inline in this build.");
    } else {
      const c = model?.clips.find((v) => v.kind === "text" && rects[v.id] && p.x >= rects[v.id]![0] && p.x <= rects[v.id]![0] + rects[v.id]![2] && p.y >= rects[v.id]![1] && p.y <= rects[v.id]![1] + rects[v.id]![3]);
      if (c) setEditing({ id: c.id, text: c.text });
    }
  };

  const commitText = () => {
    if (!editing) return;
    const { id, text } = editing;
    setEditing(null);
    const st = useEditor.getState();
    if (st.mode === "layers") st.edit("Edit text", (d) => { const l = d.layers.find((v) => v.id === id); if (l) l.text = text; });
    else st.edit("Edit text", (d) => { d.html = setText(d.html, id, text); });
  };

  // Zoom steps through the presets from wherever the canvas is now (Fit counts as its current percentage).
  const percent = Math.round(scale * 100);
  const stepZoom = (dir: -1 | 1) => {
    const steps = ZOOMS.filter((z): z is Exclude<(typeof ZOOMS)[number], "fit"> => z !== "fit");
    const next = dir > 0 ? steps.find((z) => z > percent) : [...steps].reverse().find((z) => z < percent);
    if (next) setZoom(next);
  };
  const zoomPill = (
    <div className="ed-zoompill" role="group" aria-label="Canvas zoom">
      <button type="button" aria-label="Zoom out" onClick={() => stepZoom(-1)} disabled={percent <= 25}>−</button>
      <button type="button" className="ed-zoomval" title="Fit to window" onClick={() => setZoom("fit")}>{zoom === "fit" ? `Fit · ${percent}%` : `${percent}%`}</button>
      <button type="button" aria-label="Zoom in" onClick={() => stepZoom(1)} disabled={percent >= 200}>+</button>
    </div>
  );

  const safeBoxes = s.safeOn ? [{ ins: ACTION_SAFE, cls: "act", label: "Action safe" }, { ins: TITLE_SAFE, cls: "ttl", label: "Title safe" }] : [];
  const stageW = canvas.width * scale;
  const stageH = canvas.height * scale;

  return (
    <section className="ed-card ed-canvas" data-region tabIndex={-1} aria-label="Canvas">
      {stale ? <div className="ed-sheen" aria-hidden="true" /> : null}
      <div className="ed-canvastop" role="toolbar" aria-label="Canvas view">
        <button type="button" className={`ed-vpill ${s.safeOn ? "on" : ""}`} aria-pressed={s.safeOn} title="Safe areas (')" onClick={() => s.ui({ safeOn: !s.safeOn })}>Safe areas</button>
        <button type="button" className={`ed-vpill ${s.rulersOn ? "on" : ""}`} aria-pressed={s.rulersOn} title="Rulers (⌘R)" onClick={() => s.ui({ rulersOn: !s.rulersOn })}>Rulers</button>
        <button type="button" className={`ed-vpill ${s.snapOn ? "on" : ""}`} aria-pressed={s.snapOn} title={`Snaps within ${SNAP_RADIUS_PX}px. Hold ⌘ to skip`} onClick={() => s.ui({ snapOn: !s.snapOn })}>Snapping</button>
        <span className="ed-canvasnote">{stale ? <><i className="ed-pulse" />Updating frame</> : null}</span>
      </div>
      <div className="ed-stagewrap" ref={areaRef} data-drop="canvas-area">
        <div className={`ed-stage ${s.engine === "stopped" ? "dim" : ""}`} ref={stageRef} data-drop="canvas" data-stage data-scale={scale} style={{ width: stageW, height: stageH }}
          onPointerDown={down} onDoubleClick={onDouble}>
          {s.rulersOn ? <Rulers scale={scale} width={canvas.width} height={canvas.height} /> : null}
          <div className="ed-frame" style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }}>
            {s.mode === "layers"
              ? <LayerStage layers={s.doc.layers} t={t} />
              : <ClipFrame ref={frameRef} html={s.doc.html} t={t} playing={s.playing} width={canvas.width} height={canvas.height} src={s.remote ? s.remote.frameSrc : "/editor/frame.html"} trusted={!s.remote} onRects={setRects} />}
          </div>
          {safeBoxes.map((b) => <div key={b.cls} className={`ed-safe ${b.cls}`} style={{ inset: `${b.ins * 100}%` }}><span>{b.label}</span></div>)}
          <div className="ed-overlay">
            {s.mode === "layers" ? layersOverlay() : clipsOverlay()}
            {clipDrag ? null : null}
            {guides.map((g, i) => g.axis === "x"
              ? <div key={i} className="ed-guide x" style={{ left: sx(g.at) }}><span>{g.label}</span></div>
              : <div key={i} className="ed-guide y" style={{ top: sx(g.at) }}><span>{g.label}</span></div>)}
            {marquee ? <div className="ed-marquee" style={{ left: sx(marquee.x), top: sx(marquee.y), width: sx(marquee.w), height: sx(marquee.h) }} /> : null}
          </div>
          {editing ? (
            <textarea
              className="ed-inplace" autoFocus value={editing.text} aria-label="Edit text in place"
              style={inplaceStyle(s.mode, s.doc.layers, model?.clips ?? [], rects, editing.id, scale, t)}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })} onBlur={commitText}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setEditing(null); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitText(); }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>
        {s.mode === "layers" && s.doc.layers.length === 0 ? <div className="ed-empty-canvas"><b>This composition is empty</b><span>Drop a file here, or press ⌘K and choose New text layer.</span></div> : null}
        {s.engine === "stopped" ? (
          <div className="ed-engine-error" role="alert">
            <b>The engine stopped</b>
            <p>The last good frame is shown. Your edits are kept and will replay after a restart.</p>
            <button type="button" className="ed-btn primary" onClick={() => useEditor.getState().ui({ engine: "ready", frameStale: false })}>Restart engine</button>
          </div>
        ) : null}
      </div>
      <Transport trailing={zoomPill} />
    </section>
  );
}

function inplaceStyle(mode: string, layers: Layer[], clips: { id: string; css: [string, string][] }[], rects: FrameRects, id: string, scale: number, t: number): React.CSSProperties {
  if (mode === "layers") {
    const l = layers.find((v) => v.id === id);
    if (!l) return {};
    const b = layerBox(l, t);
    return { left: (b.cx - b.w / 2) * scale, top: (b.cy - b.h / 2) * scale, width: b.w * scale, height: b.h * scale, fontSize: (l.size ?? 48) * scale, fontFamily: `"${l.font}", serif`, color: l.fill, textAlign: "center" };
  }
  const r = rects[id];
  const font = clips.find((c) => c.id === id)?.css.find((c) => c[0] === "font")?.[1] ?? "";
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? "48");
  return r ? { left: r[0] * scale, top: r[1] * scale, width: r[2] * scale, height: Math.max(r[3] * scale, size * scale * 1.3), fontSize: size * scale, textAlign: "center" } : {};
}

function Rulers({ scale, width, height }: { scale: number; width: number; height: number }) {
  const step = scale > 0.6 ? 100 : scale > 0.25 ? 200 : 500;
  const marks = (len: number) => Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => i * step);
  return (
    <>
      <div className="ed-ruler h" aria-hidden="true">{marks(width).map((m) => <i key={m} style={{ left: m * scale }}><b className="ed-mono">{m}</b></i>)}</div>
      <div className="ed-ruler v" aria-hidden="true">{marks(height).map((m) => <i key={m} style={{ top: m * scale }}><b className="ed-mono">{m}</b></i>)}</div>
    </>
  );
}
