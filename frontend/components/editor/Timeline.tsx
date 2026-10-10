"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { readClips } from "../../lib/editor/clips-model.ts";
import { moveClipInTime, trimClip } from "../../lib/editor/html-source.ts";
import { LABELS, waveform } from "../../lib/editor/fixtures.ts";
import * as ops from "../../lib/editor/ops.ts";
import { boxOf, hasKey, intersects, isAdditive, mergeKeys, modsOf, pickKey, withRect, type KeyRef } from "../../lib/editor/selection.ts";
import { SNAP_RADIUS_PX, radiusInUnits, snapEdges, type SnapCandidate } from "../../lib/editor/snap.ts";
import { useEditor, useEditorState } from "../../lib/editor/store.ts";
import { clamp, formatTime, round3, snapToFrame } from "../../lib/editor/time.ts";
import type { Clip, Layer } from "../../lib/editor/types.ts";
import { startDrag } from "./drag.ts";
import { Icon, LAYER_ICON } from "./icons.tsx";
import { IconButton } from "./ui.tsx";
import { LayerName, LayerSwitches } from "./LayerBits.tsx";
import { useRegistry } from "./registry.ts";
import { SpeedPanel } from "./SpeedPanel.tsx";

const ROW = 36;
const SUB = 26;
const RULER = 52;
const PROP_NAMES: Record<string, string> = { pos: "Position", scale: "Scale", rot: "Rotation", ry: "Y rotation", opacity: "Opacity" };

function Playhead({ nameW, pps, right }: { nameW: number; pps: number; right: number }) {
  const t = useEditor((s) => s.t);
  const fps = useEditor((s) => s.fps);
  const left = nameW + t * pps;
  // The time pill sits on the line where the handle used to be, and stays at the top while the rows scroll.
  // Near either end it slides along the line rather than leaving the timeline.
  const half = 36;
  const shift = Math.min(right - 4 - half, Math.max(nameW + 4 + half, left)) - left;
  return (
    <div className="ed-playhead" style={{ left }} aria-hidden="true">
      <div className="ed-ph-head"><em className="ed-ph-time" style={{ ["--ph-shift" as string]: `${shift}px` }}>{formatTime(t, fps)}</em></div>
    </div>
  );
}

function CurrentTime() {
  const t = useEditor((s) => s.t);
  const fps = useEditor((s) => s.fps);
  return <span className="ed-mono ed-now" aria-live="off" aria-label={`Current time ${formatTime(t, fps)}`}>{formatTime(t, fps)}</span>;
}

type Group = { id: string; label: string };
const LAYER_GROUPS: Group[] = [{ id: "title", label: "Title" }, { id: "shapes", label: "Shapes & footage" }, { id: "audio", label: "Music / Audio" }];
const CLIP_GROUPS: Group[] = [{ id: "text", label: "Text" }, { id: "shapes", label: "Shapes & footage" }, { id: "audio", label: "Audio" }];
const layerGroup = (l: Layer) => (l.type === "text" ? "title" : l.type === "audio" ? "audio" : "shapes");
const clipGroup = (c: Clip) => (c.kind === "text" ? "text" : c.kind === "audio" ? "audio" : "shapes");

export const Timeline = memo(function Timeline() {
  const registry = useRegistry();
  const s = useEditorState();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [clipDrag, setClipDrag] = useState<Record<string, { start: number; dur: number; track: number }> | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  /** The rubber band, in the content's own coordinates, and what it currently touches (shown, not yet selected, until release). */
  const [band, setBand] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const [hot, setHot] = useState<{ kind: "bars"; ids: string[] } | { kind: "keys"; keys: KeyRef[] } | null>(null);
  const model = useMemo(() => (s.mode === "clips" ? readClips(s.doc.html) : null), [s.mode, s.doc.html]);
  const nameW = s.rightOpen && width < 700 ? 188 : 236;
  const duration = s.duration;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [s.tlOpen]);

  const fitPps = Math.max(12, (width - nameW - 28) / duration);
  const pps = s.pxPerSecond > 0 ? s.pxPerSecond : fitPps;
  const trackW = Math.max(width - nameW, duration * pps + 28);
  const tOf = (clientX: number) => clamp((clientX - scroller.current!.getBoundingClientRect().left + scroller.current!.scrollLeft - nameW) / pps, 0, duration);
  const radius = radiusInUnits(pps);

  const closed = s.grpClosed;
  // The order the user sees, for Shift-click ranges.
  const layerOrder = s.mode === "layers" ? LAYER_GROUPS.flatMap((g) => (closed[g.id] ? [] : s.doc.layers.filter((l) => layerGroup(l) === g.id).map((l) => l.id))) : [];
  const clipOrder = (() => {
    if (!model) return [] as string[];
    const tracks = [...new Set(model.clips.map((c) => c.track))].sort((a, b) => a - b);
    return CLIP_GROUPS.flatMap((g) => (closed[g.id] ? [] : tracks.filter((t) => clipGroup(model.clips.find((c) => c.track === t)!) === g.id).flatMap((t) => model.clips.filter((c) => c.track === t).sort((a, b) => a.start - b.start).map((c) => c.id))));
  })();

  const candidates = (skip: string | readonly string[]): SnapCandidate[] => {
    const skipped = typeof skip === "string" ? [skip] : skip;
    const st = useEditor.getState();
    const out: SnapCandidate[] = [{ value: st.t, label: "Playhead" }, { value: st.doc.workArea[0], label: "Work area" }, { value: st.doc.workArea[1], label: "Work area" }];
    for (const m of st.doc.markers) out.push({ value: m.t, label: m.label });
    if (st.mode === "layers") for (const l of st.doc.layers) { if (!skipped.includes(l.id)) out.push({ value: l.inP, label: l.name }, { value: l.outP, label: l.name }); }
    else for (const c of readClips(st.doc.html).clips) { if (!skipped.includes(c.id)) out.push({ value: c.start, label: c.id }, { value: c.start + c.dur, label: c.id }); }
    return out;
  };

  const seek = (e: React.PointerEvent) => {
    e.preventDefault();
    useEditor.getState().setT(tOf(e.clientX));
    startDrag(e, { onMove: (_dx, _dy, ev) => useEditor.getState().setT(tOf(ev.clientX)) }, 0);
  };

  // ------------------------------------------------------------------ layer bar gestures
  const nameDown = (e: React.PointerEvent, layer: Layer) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    const mods = modsOf(e);
    const st = useEditor.getState();
    if (!st.sel.includes(layer.id) || isAdditive(mods)) st.pickLayer(layer.id, layerOrder, mods);
  };

  const barDown = (e: React.PointerEvent, layer: Layer, zone: "body" | "in" | "out") => {
    e.stopPropagation();
    const st = useEditor.getState();
    const mods = modsOf(e);
    const additive = isAdditive(mods);
    // Pressing inside the current selection keeps it, so the whole group drags; a click without a drag narrows to this layer.
    if (!st.sel.includes(layer.id) || additive) st.pickLayer(layer.id, layerOrder, mods);
    const chosen = useEditor.getState().sel;
    if (!chosen.includes(layer.id)) return; // ⌘-click took it out of the selection
    if (layer.lock) return st.say("That layer is locked.");
    const ids = zone === "body" ? chosen : [layer.id];
    const movers = st.doc.layers.filter((l) => ids.includes(l.id) && !l.lock);
    const group = { inP: Math.min(...movers.map((l) => l.inP)), outP: Math.max(...movers.map((l) => l.outP)) };
    const cands = candidates(ids);
    startDrag(e, {
      onStart: () => st.begin(zone !== "body" ? `Trim ${layer.name}` : movers.length > 1 ? `Move ${movers.length} layers` : `Move ${layer.name}`),
      onMove: (dx, _dy, ev) => {
        let dt = dx / pps;
        const snapping = useEditor.getState().snapOn && !ev.metaKey && !ev.ctrlKey;
        const edges = zone === "body" ? [group.inP + dt, group.outP + dt] : zone === "in" ? [layer.inP + dt] : [layer.outP + dt];
        if (snapping) { const r = snapEdges(edges, cands, radius); dt += r.delta; setSnapAt(r.hit ? r.hit.value : null); } else setSnapAt(null);
        useEditor.getState().updateFromBase((d) => {
          if (zone === "body") ops.moveLayerBars(d, ids, dt, duration);
          else ops.trimLayerEdge(d, layer.id, zone, (zone === "in" ? layer.inP : layer.outP) + dt, duration, useEditor.getState().rippleOn);
        });
      },
      onEnd: () => { setSnapAt(null); useEditor.getState().commit(); },
      onCancel: () => { setSnapAt(null); useEditor.getState().cancel(); },
      onClick: () => { if (!additive && useEditor.getState().sel.length > 1) useEditor.getState().pickLayer(layer.id, layerOrder, {}); }
    });
  };

  const keyDown = (e: React.PointerEvent, layer: Layer, prop: string, t: number) => {
    e.stopPropagation();
    const st = useEditor.getState();
    const ref: KeyRef = { id: layer.id, prop, t };
    const mods = modsOf(e);
    const additive = isAdditive(mods);
    if (!hasKey(st.keySel, ref) || additive) st.selectKeys(pickKey(st.keySel, ref, mods));
    const refs = useEditor.getState().keySel;
    if (!hasKey(refs, ref)) return; // ⌘-click took it out of the selection
    const copy = e.altKey;
    const cands = candidates("");
    let landed: KeyRef[] = refs;
    startDrag(e, {
      onStart: () => useEditor.getState().begin(refs.length > 1 ? (copy ? `Copy ${refs.length} keyframes` : `Move ${refs.length} keyframes`) : copy ? "Copy keyframe" : "Move keyframe"),
      onMove: (dx, _dy, ev) => {
        let to = t + dx / pps;
        if (useEditor.getState().snapOn && !ev.metaKey) { const r = snapEdges([to], cands, radius); to += r.delta; }
        const delta = clamp(snapToFrame(to), 0, duration) - t;
        useEditor.getState().updateFromBase((d) => { landed = ops.moveKeys(d, refs, delta, duration, copy); });
      },
      onEnd: () => { useEditor.getState().commit(); useEditor.getState().selectKeys(landed); },
      onCancel: () => useEditor.getState().cancel(),
      onClick: () => { if (!additive && refs.length > 1) useEditor.getState().selectKeys([ref]); }
    });
  };

  // ------------------------------------------------------------------ clip gestures
  const clipDown = (e: React.PointerEvent, clip: Clip, zone: "body" | "in" | "out") => {
    e.stopPropagation();
    const st = useEditor.getState();
    const mods = modsOf(e);
    const additive = isAdditive(mods);
    if (!st.clipSel.includes(clip.id) || additive) st.pickClip(clip.id, clipOrder, mods);
    const chosen = useEditor.getState().clipSel;
    if (!chosen.includes(clip.id)) return;
    const ids = zone === "body" ? chosen : [clip.id];
    const items = model!.clips.filter((c) => ids.includes(c.id)).map((c) => ({ id: c.id, start: c.start, dur: c.dur, track: c.track }));
    const base = items.find((i) => i.id === clip.id)!;
    const cands = candidates(ids);
    const tracks = [...new Set(model!.clips.map((c) => c.track))].sort((a, b) => a - b);
    const rowOf = (track: number) => tracks.indexOf(track);
    const groupStart = Math.min(...items.map((i) => i.start));
    const groupEnd = Math.max(...items.map((i) => i.start + i.dur));
    const rowLo = Math.min(...items.map((i) => rowOf(i.track)));
    const rowHi = Math.max(...items.map((i) => rowOf(i.track)));
    let last: Record<string, { start: number; dur: number; track: number }> = Object.fromEntries(items.map((i) => [i.id, { start: i.start, dur: i.dur, track: i.track }]));
    startDrag(e, {
      onMove: (dx, dy, ev) => {
        let dt = dx / pps;
        const snapping = useEditor.getState().snapOn && !ev.metaKey && !ev.ctrlKey;
        const edges = zone === "body" ? [groupStart + dt, groupEnd + dt] : zone === "in" ? [base.start + dt] : [base.start + base.dur + dt];
        if (snapping) { const r = snapEdges(edges, cands, radius); dt += r.delta; setSnapAt(r.hit ? r.hit.value : null); } else setSnapAt(null);
        const next: Record<string, { start: number; dur: number; track: number }> = {};
        if (zone === "body") {
          // The group moves as a unit: it stops when its first or last clip reaches an end, and keeps its row spacing.
          const shift = clamp(dt, -groupStart, Math.max(0, model!.duration - groupEnd));
          const rows = clamp(Math.round(dy / ROW), -rowLo, tracks.length - 1 - rowHi);
          for (const i of items) next[i.id] = { start: clamp(round3(i.start + shift), 0, Math.max(0, model!.duration - i.dur)), dur: i.dur, track: tracks[rowOf(i.track) + rows]! };
        } else if (zone === "in") {
          const start = clamp(round3(base.start + dt), 0, base.start + base.dur - 0.1);
          next[base.id] = { start, dur: round3(base.start + base.dur - start), track: base.track };
        } else next[base.id] = { start: base.start, dur: Math.max(0.1, round3(base.dur + dt)), track: base.track };
        last = next;
        setClipDrag(next);
      },
      onEnd: () => {
        setSnapAt(null);
        setClipDrag(null);
        const moved = items.filter((i) => { const l = last[i.id]!; return l.start !== i.start || l.dur !== i.dur || l.track !== i.track; });
        if (!moved.length) return;
        useEditor.getState().edit(zone !== "body" ? "Trim clip" : moved.length > 1 ? `Move ${moved.length} clips` : "Move clip", (d) => {
          let html = d.html;
          if (zone === "body") for (const i of moved) html = moveClipInTime(html, i.id, i.start, last[i.id]!.start, last[i.id]!.track);
          else {
            const l = last[base.id]!;
            html = trimClip(html, clip.id, { start: l.start, dur: l.dur }, { start: base.start, dur: base.dur });
            const grew = l.start + l.dur - (base.start + base.dur);
            if (useEditor.getState().rippleOn && zone === "out" && grew !== 0) {
              for (const o of readClips(d.html).clips) if (o.id !== clip.id && o.start >= base.start + base.dur - 1e-6) html = moveClipInTime(html, o.id, o.start, round3(o.start + grew));
            }
          }
          d.html = html;
        });
      },
      onCancel: () => { setSnapAt(null); setClipDrag(null); },
      onClick: () => { if (!additive && useEditor.getState().clipSel.length > 1) useEditor.getState().pickClip(clip.id, clipOrder, {}); }
    });
  };

  // ------------------------------------------------------------------ rubber band
  /** Drag on empty timeline space: select the bars (or, when it touches any, the keyframes) the rectangle covers. A plain click seeks. */
  const rowsDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || !content.current || target.closest("[data-bar], .ed-key, .ed-tname, button")) return;
    e.preventDefault();
    const root = content.current;
    const additive = isAdditive(modsOf(e));
    const st0 = useEditor.getState();
    const beforeBars = st0.mode === "layers" ? st0.sel : st0.clipSel;
    const beforeKeys = st0.keySel;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const seekTo = tOf(e.clientX);
    const rectOf = (el: Element): { l: number; t: number; r: number; b: number } => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    let found: typeof hot = null;
    startDrag(e, {
      onMove: (_dx, _dy, ev) => {
        const box = boxOf(x0, y0, ev.clientX, ev.clientY);
        const origin = root.getBoundingClientRect();
        setBand({ l: box.l - origin.left, t: box.t - origin.top, w: box.r - box.l, h: box.b - box.t });
        const keys = [...root.querySelectorAll<HTMLElement>("[data-key-id]")].filter((el) => intersects(box, rectOf(el))).map((el) => ({ id: el.dataset.keyId!, prop: el.dataset.keyProp!, t: Number(el.dataset.keyT) }));
        if (keys.length) found = { kind: "keys", keys: mergeKeys(beforeKeys, keys, additive) };
        else {
          const ids = [...root.querySelectorAll<HTMLElement>("[data-bar]")].filter((el) => intersects(box, rectOf(el))).map((el) => el.dataset.bar!);
          found = { kind: "bars", ids: withRect(beforeBars, ids, additive) };
        }
        setHot(found);
      },
      onEnd: () => {
        setBand(null);
        setHot(null);
        const st = useEditor.getState();
        if (found?.kind === "keys") st.selectKeys(found.keys);
        else if (found?.kind === "bars") { if (st.mode === "layers") st.ui({ sel: found.ids, keySel: [], anchor: found.ids[0] ?? null }); else st.selectClips(found.ids); }
      },
      onCancel: () => { setBand(null); setHot(null); },
      onClick: () => {
        setBand(null);
        const st = useEditor.getState();
        if (!additive) st.ui({ sel: [], clipSel: [], keySel: [], anchor: null });
        st.setT(seekTo);
      }
    });
  };

  // ------------------------------------------------------------------ rows
  const ticks = useMemo(() => {
    const step = pps >= 160 ? 0.5 : pps >= 70 ? 1 : pps >= 34 ? 2 : 5;
    return Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  }, [pps, duration]);

  const toggleGroup = (id: string) => s.ui({ grpClosed: { ...closed, [id]: !closed[id] } });
  const hasSolo = s.doc.layers.some((l) => l.solo);

  const rows: React.ReactNode[] = [];
  const groupHeader = (g: Group, count: number) => (
    <div key={`g-${g.id}`} className={`ed-trow grp g-${g.id}`} style={{ height: 30 }}>
      <button type="button" className="ed-tname grp" style={{ width: nameW }} aria-expanded={!closed[g.id]} onClick={() => toggleGroup(g.id)}>
        <Icon name={closed[g.id] ? "caretRight" : "caretDown"} size={11} /><i className="ed-gdot" aria-hidden="true" /><b>{g.label}</b><span className="ed-gcount">{count}</span>
      </button>
      <div className="ed-tcell" style={{ width: trackW }} />
    </div>
  );

  if (s.mode === "layers") {
    for (const g of LAYER_GROUPS) {
      const members = s.doc.layers.filter((l) => layerGroup(l) === g.id);
      if (!members.length) continue;
      rows.push(groupHeader(g, members.length));
      if (closed[g.id]) continue;
      for (const l of members) {
        const selected = s.sel.includes(l.id);
        // While the rubber band is down, bars light up as it touches them; the selection (and so the key rows) changes on release.
        const lit = hot?.kind === "bars" ? hot.ids.includes(l.id) : selected;
        const dim = !l.vis || (hasSolo && !l.solo);
        const color = LABELS[l.label];
        rows.push(
          <div key={l.id} className={`ed-trow ${lit ? "sel" : ""}`} style={{ height: ROW }}>
            <div className={`ed-tname layer ${nameW < 200 ? "tight" : ""}`} style={{ width: nameW }} onPointerDown={(e) => nameDown(e, l)}>
              <i className="ed-chip" style={{ background: color }} /><Icon name={LAYER_ICON[l.type] ?? "solid"} size={12} /><LayerName layer={l} className="ed-tn-text" />
              <div className="ed-tsw"><LayerSwitches layer={l} /></div>
            </div>
            <div className="ed-tcell" style={{ width: trackW }} data-drop="timeline" data-px={pps}>
              <div data-bar={l.id} className={`ed-bar ${lit ? "sel" : ""} ${dim ? "dim" : ""} ${l.type === "audio" ? "audio" : ""}`} style={{ left: l.inP * pps, width: Math.max(8, (l.outP - l.inP) * pps), ["--label" as string]: color }} onPointerDown={(e) => barDown(e, l, "body")}>
                <i className="trim in" onPointerDown={(e) => barDown(e, l, "in")} /><i className="trim out" onPointerDown={(e) => barDown(e, l, "out")} />
                {l.type === "audio" ? <Wave id={l.id} w={(l.outP - l.inP) * pps} /> : <span className="ed-bar-l">{l.name}</span>}
                {!lit ? Object.values(l.keys).flat().map((k, i) => <u key={i} className="ed-minikey" style={{ left: (k.t - l.inP) * pps }} />) : null}
              </div>
            </div>
          </div>
        );
        if (selected) {
          for (const [prop, keys] of Object.entries(l.keys)) {
            if (!keys.length) continue;
            rows.push(
              <div key={`${l.id}-${prop}`} className="ed-trow sub" style={{ height: SUB }}>
                <div className="ed-tname sub" style={{ width: nameW }}>
                  <button type="button" aria-label="Previous keyframe" onClick={() => { const t = ops.neighbourKey(l, prop, useEditor.getState().t, -1); if (t !== null) s.setT(t); }}><Icon name="chevL" size={10} /></button>
                  <Icon name="keyframe" size={9} />
                  <button type="button" aria-label="Next keyframe" onClick={() => { const t = ops.neighbourKey(l, prop, useEditor.getState().t, 1); if (t !== null) s.setT(t); }}><Icon name="chevR" size={10} /></button>
                  <span>{PROP_NAMES[prop] ?? prop}</span>
                </div>
                <div className="ed-tcell" style={{ width: trackW }}>
                  {keys.map((k) => {
                    const on = hasKey(hot?.kind === "keys" ? hot.keys : s.keySel, { id: l.id, prop, t: k.t });
                    return <button key={k.t} type="button" className={`ed-key ${k.lin ? "lin" : "eased"} ${on ? "on" : ""}`} style={{ left: k.t * pps }} data-key-id={l.id} data-key-prop={prop} data-key-t={k.t}
                      aria-label={`${PROP_NAMES[prop] ?? prop} keyframe at ${formatTime(k.t)}, ${k.lin ? "linear" : "eased"}`} onPointerDown={(e) => keyDown(e, l, prop, k.t)} />;
                  })}
                </div>
              </div>
            );
          }
        }
      }
    }
  } else if (model) {
    const byTrack = new Map<number, Clip[]>();
    for (const c of model.clips) byTrack.set(c.track, [...(byTrack.get(c.track) ?? []), c]);
    const tracks = [...byTrack.keys()].sort((a, b) => a - b);
    for (const g of CLIP_GROUPS) {
      const members = tracks.filter((t) => clipGroup(byTrack.get(t)![0]!) === g.id);
      if (!members.length) continue;
      rows.push(groupHeader(g, members.length));
      if (closed[g.id]) continue;
      for (const track of members) {
        const clips = byTrack.get(track)!;
        rows.push(
          <div key={`t-${track}`} className="ed-trow" style={{ height: ROW }}>
            <div className="ed-tname" style={{ width: nameW }} title={clips.map((c) => c.id).join(", ")}><span className="ed-mono ed-muted">{track}</span><span>{clips.map((c) => `#${c.id}`).join(" ")}</span></div>
            <div className="ed-tcell" style={{ width: trackW }} data-drop="timeline" data-px={pps}>
              <div className="ed-hatch" style={{ left: model.duration * pps }} />
              {clips.map((c0) => {
                const moving = clipDrag?.[c0.id];
                const c = moving ? { ...c0, start: moving.start, dur: moving.dur } : c0;
                const active = (hot?.kind === "bars" ? hot.ids : s.clipSel).includes(c.id);
                const lift = moving ? (tracks.indexOf(moving.track) - tracks.indexOf(track)) * ROW : 0;
                return (
                  <div key={c.id} data-bar={c.id} className={`ed-bar clip ${active ? "active" : ""} ${c.kind === "audio" ? "audio" : ""}`} style={{ left: c.start * pps, width: Math.max(8, c.dur * pps), transform: lift ? `translateY(${lift}px)` : undefined, zIndex: lift ? 5 : undefined }}
                    onPointerDown={(e) => clipDown(e, c0, "body")}>
                    <i className="trim in" onPointerDown={(e) => clipDown(e, c0, "in")} /><i className="trim out" onPointerDown={(e) => clipDown(e, c0, "out")} />
                    {c.kind === "audio" ? <Wave id={c.id} w={c.dur * pps} /> : <span className="ed-bar-l">#{c.id}</span>}
                    {c0.tweens.map((tw, i) => <u key={i} className="ed-tween" style={{ left: tw.at * pps, width: Math.max(3, tw.dur * pps) }} />)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }
    }
  }

  const [wa0, wa1] = s.doc.workArea;
  const bodyH = rows.length * 30 + 120;

  if (!s.tlOpen) {
    return (
      <section className="ed-card ed-timeline collapsed" aria-label="Timeline">
        <Toolbar registry={registry} />
      </section>
    );
  }

  return (
    <section className="ed-card ed-timeline" aria-label="Timeline">
      <Toolbar registry={registry} />
      <div className="ed-tl-body">
        <div className="ed-tl-scroll" ref={scroller}>
          <div className="ed-tl-content" ref={content} style={{ width: nameW + trackW, minHeight: "100%" }}>
            <div className="ed-ruler-row" style={{ height: RULER }}>
              <div className="ed-ruler-name" style={{ width: nameW }}><span className="ed-cap">TIMELINE</span></div>
              <div className="ed-ruler-track" style={{ width: trackW }} onPointerDown={seek}>
                {ticks.map((t) => <i key={t} className="ed-tick" style={{ left: t * pps }}><b className="ed-mono">{formatTime(t).replace(/:00$/, "")}</b></i>)}
                <div className="ed-wa" style={{ left: wa0 * pps, width: Math.max(8, (wa1 - wa0) * pps) }} title="Work area (B / N)">
                  <i className="grip l" onPointerDown={(e) => waDown(e, "in")} /><i className="grip r" onPointerDown={(e) => waDown(e, "out")} />
                </div>
                {s.doc.markers.map((m, i) => <span key={i} className="ed-marker" style={{ left: m.t * pps }} title={`${m.label} · ${formatTime(m.t)}`}><Icon name="flag" size={11} /></span>)}
                {s.doc.comments.filter((c) => !c.resolved).map((c) => (
                  <button key={c.id} type="button" className="ed-pin" style={{ left: c.at * pps }} aria-label={`Comment by ${c.who} at ${formatTime(c.at)}`} title={`${c.who}: ${c.text}`}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => { s.setT(c.at); s.ui({ rightTab: "review", rightOpen: true }); }}><span>{c.ini}</span></button>
                ))}
              </div>
            </div>
            <div className="ed-rows" style={{ minHeight: bodyH }} onPointerDown={rowsDown}>
              {rows}
              {!rows.length ? <div className="ed-empty small">Nothing on the timeline yet.</div> : null}
            </div>
            {band ? <div className="ed-tl-band" style={{ left: band.l, top: band.t, width: band.w, height: band.h }} aria-hidden="true" /> : null}
            {snapAt !== null ? <div className="ed-snapline" style={{ left: nameW + snapAt * pps }} aria-hidden="true" /> : null}
            <Playhead nameW={nameW} pps={pps} right={nameW + trackW} />
          </div>
        </div>
        {s.speedOpen && s.mode === "layers" ? <SpeedPanel /> : null}
      </div>
    </section>
  );

  function waDown(e: React.PointerEvent, edge: "in" | "out") {
    e.stopPropagation();
    startDrag(e, {
      onStart: () => useEditor.getState().begin("Set work area"),
      onMove: (_dx, _dy, ev) => { const t = snapToFrame(tOf(ev.clientX)); useEditor.getState().update((d) => { d.workArea = edge === "in" ? [Math.min(t, d.workArea[1] - 0.1), d.workArea[1]] : [d.workArea[0], Math.max(t, d.workArea[0] + 0.1)]; }); },
      onEnd: () => useEditor.getState().commit(),
      onCancel: () => useEditor.getState().cancel()
    }, 0);
  }
});

function Toolbar({ registry }: { registry: ReturnType<typeof useRegistry> }) {
  const s = useEditorState();
  const [w0, w1] = s.doc.workArea;
  return (
    <div className="ed-tl-toolbar" role="toolbar" aria-label="Timeline tools">
      <span className="ed-cap">TIMELINE</span>
      <IconButton icon={s.playing ? "pause" : "play"} label={s.playing ? "Pause (Space)" : "Play (Space)"} onClick={() => registry.run("play")} />
      <button type="button" className="ed-tbtn" onClick={() => registry.run("split")} title="Split at playhead (⌘⇧D)"><Icon name="split" size={13} />Split</button>
      <button type="button" className={`ed-tbtn ${s.rippleOn ? "on" : ""}`} aria-pressed={s.rippleOn} onClick={() => registry.run("ripple")}><Icon name="ripple" size={13} />Ripple</button>
      <button type="button" className={`ed-tbtn ${s.snapOn ? "on" : ""}`} aria-pressed={s.snapOn} onClick={() => registry.run("snap")} title={`Snaps within ${SNAP_RADIUS_PX}px. Hold ⌘ to skip`}><Icon name="snap" size={13} />Snap</button>
      <button type="button" className="ed-tbtn" onClick={() => registry.run("marker")}><Icon name="plus" size={12} />Marker</button>
      {s.mode === "layers" ? <button type="button" className="ed-tbtn" onClick={() => registry.run("ease")} title="Easy ease (F9)">Easy ease<kbd>F9</kbd></button> : null}
      {s.mode === "layers" ? <button type="button" className={`ed-tbtn ${s.speedOpen ? "on" : ""}`} aria-pressed={s.speedOpen} onClick={() => s.ui({ speedOpen: !s.speedOpen, tlOpen: true })}><Icon name="speed" size={13} />Speed graph</button> : null}
      <div className="ed-spacer" />
      <Picked />
      <span className="ed-mono ed-muted ed-wa-l">Work area {formatTime(w0)}–{formatTime(w1)}</span>
      <CurrentTime />
      <IconButton icon="minus" label="Zoom out (−)" onClick={() => registry.run("zoom.out")} />
      <button type="button" className="ed-tbtn" onClick={() => registry.run("zoom.fit")}>Fit</button>
      <IconButton icon="plus" label="Zoom in (=)" onClick={() => registry.run("zoom.in")} />
      <IconButton icon={s.tlOpen ? "caretDown" : "caretUp"} label={s.tlOpen ? "Collapse timeline" : "Expand timeline"} onClick={() => s.ui({ tlOpen: !s.tlOpen })} />
    </div>
  );
}

/** What is selected, so a group selection is visible at a glance: "3 layers · 5 keyframes". */
function Picked() {
  const layers = useEditor((s) => s.sel.length);
  const clips = useEditor((s) => s.clipSel.length);
  const keys = useEditor((s) => s.keySel.length);
  const mode = useEditor((s) => s.mode);
  const bars = mode === "layers" ? layers : clips;
  const parts = [bars > 1 ? `${bars} ${mode === "layers" ? "layers" : "clips"}` : "", keys > 1 || (keys === 1 && bars > 1) ? `${keys} keyframe${keys === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? <span className="ed-picked ed-mono" role="status">{parts.join(" · ")} selected</span> : null;
}

function Wave({ id, w }: { id: string; w: number }) {
  const bars = Math.max(4, Math.floor(w / 3));
  const data = useMemo(() => waveform(id, bars), [id, bars]);
  return <span className="ed-wave" aria-hidden="true">{data.map((v, i) => <i key={i} style={{ height: `${Math.round(v * 100)}%` }} />)}</span>;
}
