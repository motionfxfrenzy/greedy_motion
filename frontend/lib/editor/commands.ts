/**
 * The editor's actions. Every button, menu item, key and ⌘K entry runs one of these through the
 * registry, so shortcuts are defined once. Handlers read and write the zustand store directly.
 */
import { ActionRegistry } from "./actions.ts";
import { valueAt, writeProperty } from "./anim.ts";
import { snapToFrame, formatTime } from "./time.ts";
import { checkLayers, lintClips } from "./checks.ts";
import { readClips } from "./clips-model.ts";
import { cloneElement, removeElement, appendToRoot, setTiming, setStyle, uniqueId, removeTween, readTweens } from "./html-source.ts";
import * as ops from "./ops.ts";
import { FX_LIB } from "./fixtures.ts";
import { activeAutosave } from "./remote.ts";
import { remoteLint, startRemoteRender } from "./render-remote.ts";
import { useEditor } from "./store.ts";
import type { CheckIssue, Job, LayerType } from "./types.ts";

const get = () => useEditor.getState();

export function currentChecks(): CheckIssue[] {
  const s = get();
  if (s.mode === "clips") { const m = readClips(s.doc.html); return lintClips(m.clips, m.duration, m.canvas); }
  return checkLayers(s.doc.layers, s.duration, s.canvas, s.t);
}

export function runCheck(announce = true): CheckIssue[] {
  const issues = currentChecks();
  get().ui({ checks: issues, rightTab: "checks", rightOpen: true });
  // A server project is also linted by the real HyperFrames rules; its findings are added when they arrive.
  if (get().remote) void remoteLint().then((found) => {
    if (!found.length) return;
    const merged = [...currentChecks(), ...found.filter((f) => !currentChecks().some((l) => l.msg === f.msg))];
    get().ui({ checks: merged.sort((a, b) => (a.lvl === "error" ? 0 : 1) - (b.lvl === "error" ? 0 : 1)) });
  }).catch(() => undefined);
  if (announce) {
    const e = issues.filter((i) => i.lvl === "error").length;
    const w = issues.length - e;
    get().say(issues.length ? `${e} error${e === 1 ? "" : "s"}, ${w} warning${w === 1 ? "" : "s"}.` : "No problems found.");
  }
  return issues;
}

let jobSeq = 0;
export function startRender(kind: string): void {
  const s = get();
  if (s.remote) { void startRemoteRender(kind); return; }
  const preview = /Preview|MP4/.test(kind) && !/transparent/i.test(kind) ? /Preview/.test(kind) : false;
  if (!preview) {
    const errors = currentChecks().filter((i) => i.lvl === "error");
    if (errors.length) { get().ui({ checks: currentChecks(), rightTab: "checks", rightOpen: true }); get().say(`${errors.length} error${errors.length === 1 ? "" : "s"} block a full render. Fix them in Checks.`); return; }
  }
  const running = s.jobs.some((j) => j.state === "running");
  const job: Job = { id: `job${++jobSeq}`, kind, pct: 0, state: running ? "queued" : "running", rate: preview ? 7 : 2.6, frames: preview ? 180 : 360 };
  get().ui({ jobs: [job, ...s.jobs].slice(0, 12), renderOpen: true, engine: "rendering" });
  get().say(running ? `${kind} queued behind the running render.` : `${kind} started.`);
}

/** Advance simulated render progress. The real adapter reports frames; the demo adapter calls this. */
export function tickJobs(dt: number): void {
  const s = get();
  if (!s.jobs.some((j) => j.state === "running" || j.state === "queued")) return;
  let jobs = s.jobs.map((j) => (j.state === "running" ? { ...j, pct: Math.min(100, j.pct + (j.rate * dt * 100) / j.frames) } : j));
  jobs = jobs.map((j) => (j.state === "running" && j.pct >= 100 ? { ...j, pct: 100, state: "done" as const } : j));
  if (!jobs.some((j) => j.state === "running")) {
    const next = [...jobs].reverse().find((j) => j.state === "queued");
    if (next) jobs = jobs.map((j) => (j.id === next.id ? { ...j, state: "running" as const } : j));
  }
  const busy = jobs.some((j) => j.state === "running");
  get().ui({ jobs, engine: busy ? "rendering" : s.engine === "rendering" ? "ready" : s.engine });
}

const selectedLayers = () => { const s = get(); return s.doc.layers.filter((l) => s.sel.includes(l.id)); };

function splitAtPlayhead() {
  const s = get();
  if (s.mode === "clips") {
    if (!s.clipSel.length) return s.say("Select a clip to split.");
    const model = readClips(s.doc.html);
    const targets = model.clips.filter((c) => s.clipSel.includes(c.id) && s.t > c.start + 1e-6 && s.t < c.start + c.dur - 1e-6);
    if (!targets.length) return s.say(s.clipSel.length > 1 ? "Move the playhead inside a selected clip to split." : "Move the playhead inside the clip to split it.");
    const created: string[] = [];
    s.edit(targets.length > 1 ? `Split ${targets.length} clips` : "Split clip", (d) => {
      const at = snapToFrame(s.t);
      let html = d.html;
      for (const clip of targets) {
        const second = uniqueId(html, `${clip.id}-b`);
        html = cloneElement(html, clip.id, second);
        html = setTiming(html, clip.id, { dur: at - clip.start });
        html = setTiming(html, second, { start: at, dur: clip.start + clip.dur - at });
        for (const tw of readTweens(html, second, at)) html = removeTween(html, tw.id);
        created.push(second);
      }
      d.html = html;
    });
    s.selectClips(created);
    return s.say(`Split ${created.length > 1 ? `${created.length} clips` : "clip"} at ${formatTime(s.t, s.fps)}.`);
  }
  if (!s.sel.length) return s.say("Select a layer to split.");
  let made = 0;
  s.edit(s.sel.length > 1 ? "Split layers" : "Split layer", (d) => { for (const id of s.sel) if (ops.splitLayer(d, id, s.t)) made++; });
  if (made) s.say(`Split ${made > 1 ? `${made} layers` : "layer"} at ${formatTime(s.t, s.fps)}.`);
  else s.say("Move the playhead inside a selected layer to split it.");
}

function deleteSelection() {
  const s = get();
  if (s.mode === "clips") {
    const ids = s.clipSel;
    if (!ids.length) return;
    s.edit(ids.length > 1 ? `Delete ${ids.length} clips` : "Delete clip", (d) => { let html = d.html; for (const id of ids) { for (const tw of readTweens(html, id, 0)) html = removeTween(html, tw.id); html = removeElement(html, id); } d.html = html; });
    s.selectClip(null);
    return s.say(`Deleted ${ids.length === 1 ? ids[0] : `${ids.length} clips`}. ⌘Z brings it back.`);
  }
  // Selected keyframes win over layers: Delete on a key removes the key, not the layer it belongs to.
  if (s.keySel.length) {
    const refs = s.keySel;
    let n = 0;
    s.edit(refs.length > 1 ? "Delete keyframes" : "Delete keyframe", (d) => { n = ops.deleteKeys(d, refs); });
    s.ui({ keySel: [] });
    return s.say(`Deleted ${n} keyframe${n === 1 ? "" : "s"}. ⌘Z brings ${n === 1 ? "it" : "them"} back.`);
  }
  if (!s.sel.length) return;
  const names = selectedLayers().map((l) => l.name);
  s.edit("Delete layer", (d) => ops.deleteLayers(d, s.sel));
  s.ui({ sel: [] });
  s.say(`Deleted ${names.length === 1 ? names[0] : `${names.length} layers`}. ⌘Z brings it back.`);
}

function duplicateSelection() {
  const s = get();
  if (s.mode === "clips") {
    if (!s.clipSel.length) return;
    const copies: string[] = [];
    s.edit(s.clipSel.length > 1 ? "Duplicate clips" : "Duplicate clip", (d) => { let html = d.html; for (const id of s.clipSel) { const copy = uniqueId(html, `${id}-copy`); html = cloneElement(html, id, copy); copies.push(copy); } d.html = html; });
    return s.selectClips(copies);
  }
  if (!s.sel.length) return;
  let created: string[] = [];
  s.edit("Duplicate layer", (d) => { created = ops.duplicateLayers(d, s.sel); });
  s.ui({ sel: created });
}

function selectAll() {
  const s = get();
  if (s.mode === "clips") { const ids = readClips(s.doc.html).clips.map((c) => c.id); s.selectClips(ids); return s.say(`${ids.length} clip${ids.length === 1 ? "" : "s"} selected.`); }
  const ids = s.doc.layers.map((l) => l.id);
  s.ui({ sel: ids, keySel: [], anchor: ids[0] ?? null });
  s.say(`${ids.length} layer${ids.length === 1 ? "" : "s"} selected.`);
}

function addLayer(type: LayerType) {
  const s = get();
  let id = "";
  s.edit(`New ${type} layer`, (d) => { id = ops.addLayer(d, type, s.t, s.duration); });
  s.ui({ sel: [id], leftTab: "layers" });
}

function addTextClip() {
  const s = get();
  const id = uniqueId(s.doc.html, "text");
  const model = readClips(s.doc.html);
  const track = Math.max(-1, ...model.clips.map((c) => c.track)) + 1;
  s.edit("New text clip", (d) => {
    d.html = appendToRoot(d.html, `<div id="${id}" class="clip" data-start="${snapToFrame(s.t)}" data-duration="3" data-track-index="${track}" style="left:0; right:0; top:${Math.round(model.canvas.height * 0.42)}px; text-align:center; font:600 72px Inter,sans-serif; color:#000000">New text</div>`);
  });
  s.selectClip(id);
}

function easyEase() {
  const s = get();
  if (s.mode !== "layers") return;
  // Selected keys first; otherwise the keys of the selected layers that sit on the playhead.
  const refs = s.keySel.length ? s.keySel : selectedLayers().flatMap((l) => Object.entries(l.keys).flatMap(([prop, keys]) => keys.filter((k) => Math.abs(k.t - s.t) < 0.5 / s.fps).map((k) => ({ id: l.id, prop, t: k.t }))));
  if (!refs.length) return s.say("Select a keyframe, or put the playhead on one.");
  s.edit("Easy ease", (d) => ops.setKeysEase(d, refs, { lin: false, o: 33, i: 33 }));
  if (refs.length > 1) s.say(`Easy ease on ${refs.length} keyframes.`);
}

function jumpKey(dir: -1 | 1) {
  const s = get();
  const layer = s.doc.layers.find((l) => l.id === s.sel[0]);
  if (!layer) return;
  const times = Object.keys(layer.keys).map((p) => ops.neighbourKey(layer, p, s.t, dir)).filter((x): x is number => x !== null);
  if (!times.length) return;
  s.setT(dir > 0 ? Math.min(...times) : Math.max(...times));
}

export function buildRegistry(): ActionRegistry {
  const layersOnly = () => get().mode === "layers";
  const clipsOnly = () => get().mode === "clips";
  const r = new ActionRegistry();
  r.register(
    { id: "palette", group: "Help", label: "Command palette", shortcut: "Mod+K", run: () => get().ui({ modal: "palette" }) },
    { id: "shortcuts", group: "Help", label: "Keyboard shortcuts", shortcut: "Shift+?", run: () => get().ui({ modal: "keys" }) },
    { id: "undo", group: "Edit", label: "Undo", shortcut: "Mod+Z", run: () => get().undo() },
    { id: "redo", group: "Edit", label: "Redo", shortcut: "Mod+Shift+Z", run: () => get().redo() },
    { id: "save", group: "File", label: "Save", shortcut: "Mod+S", run: () => { const auto = activeAutosave(); if (auto) void auto.flush().then((ok) => get().say(ok ? "Saved." : "Could not save yet.")); else { get().ui({ dirty: false }); get().say("Saved."); } } },
    { id: "saveas", group: "File", label: "Save as…", shortcut: "Mod+Shift+S", run: () => get().ui({ modal: "saveas" }) },
    { id: "open", group: "File", label: "Open project…", shortcut: "Mod+O", run: () => get().ui({ modal: "open" }) },
    { id: "publish", group: "File", label: "Publish as template…", run: () => get().ui({ modal: "publish" }) },
    { id: "play", group: "Playback", label: "Play / pause", shortcut: "Space", run: () => get().ui({ playing: !get().playing }) },
    { id: "frame.prev", group: "Playback", label: "Previous frame", shortcut: "Left", enabled: () => !get().sel.length && !get().clipSel.length, run: () => get().setT(get().t - 1 / get().fps) },
    { id: "frame.next", group: "Playback", label: "Next frame", shortcut: "Right", enabled: () => !get().sel.length && !get().clipSel.length, run: () => get().setT(get().t + 1 / get().fps) },
    { id: "split", group: "Timeline", label: "Split at playhead", shortcut: "Mod+Shift+D", run: splitAtPlayhead },
    { id: "marker", group: "Timeline", label: "Add marker", shortcut: "M", run: () => { const s = get(); s.edit("Add marker", (d) => { d.markers.push({ t: snapToFrame(s.t, s.fps), label: `Marker ${d.markers.length + 1}` }); }); s.say(`Marker at ${formatTime(s.t, s.fps)}.`); } },
    { id: "wa.in", group: "Timeline", label: "Work area start here", shortcut: "B", run: () => { const s = get(); s.edit("Set work area", (d) => { d.workArea = [Math.min(s.t, d.workArea[1] - 0.1), d.workArea[1]]; }); } },
    { id: "wa.out", group: "Timeline", label: "Work area end here", shortcut: "N", run: () => { const s = get(); s.edit("Set work area", (d) => { d.workArea = [d.workArea[0], Math.max(s.t, d.workArea[0] + 0.1)]; }); } },
    { id: "zoom.in", group: "Timeline", label: "Zoom in", shortcut: "=", run: () => get().ui({ pxPerSecond: Math.min(400, get().pxPerSecond * 1.25) }) },
    { id: "zoom.out", group: "Timeline", label: "Zoom out", shortcut: "-", run: () => get().ui({ pxPerSecond: Math.max(12, get().pxPerSecond / 1.25) }) },
    { id: "zoom.fit", group: "Timeline", label: "Zoom to fit", shortcut: "Shift+Z", run: () => get().ui({ pxPerSecond: 0 }) },
    { id: "snap", group: "Timeline", label: "Toggle snapping", run: () => get().ui({ snapOn: !get().snapOn }) },
    { id: "ripple", group: "Timeline", label: "Toggle ripple", run: () => get().ui({ rippleOn: !get().rippleOn }) },
    { id: "safe", group: "View", label: "Toggle safe areas", shortcut: "'", run: () => get().ui({ safeOn: !get().safeOn }) },
    { id: "rulers", group: "View", label: "Toggle rulers", shortcut: "Mod+R", run: () => get().ui({ rulersOn: !get().rulersOn }) },
    { id: "duplicate", group: "Layer", label: "Duplicate", shortcut: "Mod+D", run: duplicateSelection },
    { id: "delete", group: "Layer", label: "Delete", shortcut: "Backspace", run: deleteSelection },
    { id: "delete2", group: "Layer", label: "Delete", shortcut: "Delete", run: deleteSelection },
    { id: "precompose", group: "Layer", label: "Pre-compose", shortcut: "Mod+Shift+C", enabled: layersOnly, run: () => { const s = get(); if (!s.sel.length) return s.say("Select layers to pre-compose."); let id: string | null = null; s.edit("Pre-compose", (d) => { id = ops.precompose(d, s.sel); }); if (id) s.ui({ sel: [id] }); } },
    ...layerTypes.map(([type, label]): Parameters<ActionRegistry["register"]>[0] => ({ id: `new.${type}`, group: "Layer", label: `New ${label}`, enabled: layersOnly, run: () => addLayer(type) })),
    { id: "new.textclip", group: "Clip", label: "New text clip", enabled: clipsOnly, run: addTextClip },
    ...Object.keys(FX_LIB).slice(0, 4).map((name): Parameters<ActionRegistry["register"]>[0] => ({ id: `fx.${name}`, group: "Effect", label: `Add ${name}`, enabled: layersOnly, run: () => { const s = get(); const id = s.sel[0]; if (!id) return s.say("Select a layer first."); s.edit(`Add ${name}`, (d) => { const l = d.layers.find((x) => x.id === id); if (l) ops.addEffect(l, name); }); } })),
    { id: "ease", group: "Keyframes", label: "Easy ease", shortcut: "F9", enabled: layersOnly, run: easyEase },
    { id: "key.prev", group: "Keyframes", label: "Previous keyframe", shortcut: "J", enabled: layersOnly, run: () => jumpKey(-1) },
    { id: "key.next", group: "Keyframes", label: "Next keyframe", shortcut: "K", enabled: layersOnly, run: () => jumpKey(1) },
    { id: "check", group: "Check", label: "Check composition", run: () => { runCheck(); } },
    { id: "render.preview", group: "Render", label: "Preview · 540p", run: () => startRender("Preview · 540p") },
    { id: "render.full", group: "Render", label: "Full render", enabled: layersOnly, run: () => startRender("Full render") },
    { id: "render.mp4", group: "Render", label: "Render MP4", enabled: clipsOnly, run: () => startRender("Render MP4") },
    { id: "render.alpha", group: "Render", label: "Render transparent", enabled: clipsOnly, run: () => startRender("Render transparent") },
    { id: "mode.clips", group: "Mode", label: "Switch to HTML clips", enabled: () => get().mode !== "clips", run: () => get().setMode("clips") },
    { id: "mode.layers", group: "Mode", label: "Switch to Layers", enabled: () => get().mode !== "layers" && !get().hfOnly, run: () => get().setMode("layers") },
    { id: "bridge", group: "Mode", label: "Send clip to Layers…", enabled: () => get().mode === "clips" && !get().hfOnly, run: () => get().ui({ modal: "bridge" }) },
    { id: "deselect", group: "Edit", label: "Clear selection", shortcut: "Escape", run: () => get().ui({ sel: [], clipSel: [], keySel: [], anchor: null, menu: null }) },
    { id: "select.all", group: "Edit", label: "Select all", shortcut: "Mod+A", run: selectAll },
    { id: "select.keys", group: "Keyframes", label: "Select all keyframes of the selected layers", enabled: layersOnly, run: () => { const s = get(); const refs = ops.allKeys(s.doc, s.sel); if (!refs.length) return s.say(s.sel.length ? "The selected layers have no keyframes." : "Select a layer first."); s.selectKeys(refs); s.say(`${refs.length} keyframe${refs.length === 1 ? "" : "s"} selected.`); } }
  );
  return r;
}

const layerTypes: [LayerType, string][] = [["text", "text layer"], ["solid", "solid"], ["shape", "shape layer"], ["null", "null object"], ["adjustment", "adjustment layer"], ["camera", "camera"], ["light", "light"]];

/** Arrow-key nudge: 1 px (10 with Shift); on a keyframed position it writes a key at the playhead. */
export function nudge(dx: number, dy: number, amount: number): void {
  const s = get();
  if (s.mode === "clips") {
    if (!s.clipSel.length) return;
    const clips = readClips(s.doc.html).clips.filter((c) => s.clipSel.includes(c.id));
    s.edit(clips.length > 1 ? "Nudge clips" : "Nudge clip", (d) => {
      for (const clip of clips) {
        const px = (key: string) => Number.parseFloat(clip.css.find((r) => r[0] === key)?.[1] ?? "") || 0;
        const css = clip.css.map((r) => [...r] as [string, string]);
        const set = (k: string, v: number) => { const row = css.find((r) => r[0] === k); if (row) row[1] = `${v}px`; else css.push([k, `${v}px`]); };
        if (dx) set("left", px("left") + dx * amount);
        if (dy) set("top", px("top") + dy * amount);
        d.html = setStyle(d.html, clip.id, css);
      }
    });
    return;
  }
  if (!s.sel.length) return;
  s.edit("Nudge", (d) => {
    for (const layer of d.layers) {
      if (!s.sel.includes(layer.id) || layer.lock) continue;
      const base = valueAt(layer, "pos", s.t) as number[];
      writeProperty(layer, "pos", [base[0]! + dx * amount, base[1]! + dy * amount], s.t);
    }
  });
}

