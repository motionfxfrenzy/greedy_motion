/**
 * Pure edit operations on an EditorDoc draft (Layers mode). Each mutates the draft it is given, so the
 * store calls them inside `edit()` / `update()` on a clone, and the history keeps the snapshots.
 */
import { valueAt } from "./anim.ts";
import { makeEffect, makeLayer, newId, LABEL_ORDER } from "./fixtures.ts";
import { clamp, round3, snapToFrame } from "./time.ts";
import type { EditorDoc, Keyframe, Layer, LayerType, PropValue } from "./types.ts";

export const MIN_LAYER_SECONDS = 0.1;

const NEW_LAYER: Record<LayerType, Partial<Layer>> = {
  text: { w: 640, h: 160, text: "New text", font: "Plus Jakarta Sans", size: 72, fill: "#0a0d12", label: "blue" },
  solid: { w: 1920, h: 1080, color: "#D6E4F2" },
  shape: { w: 400, h: 400, color: "#0A6CFF", label: "rose" },
  null: { label: "violet" },
  adjustment: { w: 1920, h: 1080, label: "green" },
  camera: { zoom: 2667, dof: false },
  light: { intensity: 100, lcolor: "#FFFFFF", label: "amber" },
  image: { w: 600, h: 400, label: "violet" },
  precomp: { w: 960, h: 540, label: "violet" },
  audio: { label: "green", vol: 0 }
};

const TYPE_NAME: Record<LayerType, string> = { text: "Text", solid: "Solid", shape: "Shape", null: "Null", adjustment: "Adjustment", camera: "Camera", light: "Light", image: "Image", precomp: "Pre-comp", audio: "Audio" };

const indexOf = (doc: EditorDoc, id: string) => doc.layers.findIndex((l) => l.id === id);
const byId = (doc: EditorDoc, id: string) => doc.layers.find((l) => l.id === id);

/** New layer on top of the stack, in at `t` and out at the end of the composition. */
export function addLayer(doc: EditorDoc, type: LayerType, t: number, duration: number): string {
  const count = doc.layers.filter((l) => l.type === type).length + 1;
  const id = newId(type);
  doc.layers.unshift(makeLayer({ id, name: `${TYPE_NAME[type]} ${count}`, type, inP: snapToFrame(t), outP: duration, ...NEW_LAYER[type] }));
  return id;
}

export function deleteLayers(doc: EditorDoc, ids: readonly string[]): void {
  const gone = new Set(ids);
  doc.layers = doc.layers.filter((l) => !gone.has(l.id));
  for (const l of doc.layers) if (l.parent && gone.has(l.parent)) l.parent = null;
}

export function duplicateLayers(doc: EditorDoc, ids: readonly string[]): string[] {
  const created: string[] = [];
  for (const id of ids) {
    const at = indexOf(doc, id);
    if (at < 0) continue;
    const copy = structuredClone(doc.layers[at]!);
    copy.id = newId(copy.type);
    copy.name = `${copy.name} copy`;
    copy.effects = copy.effects.map((fx) => ({ ...fx, id: newId("fx") }));
    doc.layers.splice(at, 0, copy);
    created.push(copy.id);
  }
  return created;
}

/** Wrap the layers in one pre-comp that spans their in/out range. Returns its id. */
export function precompose(doc: EditorDoc, ids: readonly string[]): string | null {
  const picked = doc.layers.filter((l) => ids.includes(l.id));
  if (!picked.length) return null;
  const id = newId("precomp");
  const top = Math.min(...picked.map((l) => indexOf(doc, l.id)));
  const inP = Math.min(...picked.map((l) => l.inP));
  const outP = Math.max(...picked.map((l) => l.outP));
  const comp = makeLayer({ id, name: `Pre-comp ${doc.layers.filter((l) => l.type === "precomp").length + 1}`, type: "precomp", label: "violet", inP, outP, w: 1920, h: 1080 });
  doc.layers = doc.layers.filter((l) => !ids.includes(l.id));
  doc.layers.splice(Math.min(top, doc.layers.length), 0, comp);
  return id;
}

/** Cut a layer in two at `t`. The second half is a copy placed just above the first. */
export function splitLayer(doc: EditorDoc, id: string, t: number): string | null {
  const at = indexOf(doc, id);
  if (at < 0) return null;
  const layer = doc.layers[at]!;
  const cut = snapToFrame(t);
  if (cut <= layer.inP + 1e-6 || cut >= layer.outP - 1e-6) return null;
  const second = structuredClone(layer);
  second.id = newId(layer.type);
  second.name = `${layer.name} 2`;
  second.inP = cut;
  second.effects = second.effects.map((fx) => ({ ...fx, id: newId("fx") }));
  layer.outP = cut;
  doc.layers.splice(at, 0, second);
  return second.id;
}

/** Move a layer to sit before `beforeId` (or to the bottom when null). */
export function reorderLayer(doc: EditorDoc, id: string, beforeId: string | null): void {
  const from = indexOf(doc, id);
  if (from < 0 || id === beforeId) return;
  const [layer] = doc.layers.splice(from, 1);
  const to = beforeId === null ? doc.layers.length : indexOf(doc, beforeId);
  doc.layers.splice(to < 0 ? doc.layers.length : to, 0, layer!);
}

/** Set a layer's parent. Refuses a cycle (a layer cannot be parented to its own descendant). */
export function setParent(doc: EditorDoc, id: string, parent: string | null): boolean {
  const layer = byId(doc, id);
  if (!layer) return false;
  for (let cursor = parent; cursor; cursor = byId(doc, cursor)?.parent ?? null) if (cursor === id) return false;
  layer.parent = parent;
  return true;
}

export const cycleLabel = (layer: Layer) => { layer.label = LABEL_ORDER[(LABEL_ORDER.indexOf(layer.label) + 1) % LABEL_ORDER.length]!; };

// ---- bars (in / out)

/** Move the bar by `delta` seconds, keeping its length, inside [0, duration]. */
export function moveLayerBar(layer: Layer, delta: number, duration: number): void {
  const length = layer.outP - layer.inP;
  const inP = clamp(snapToFrame(layer.inP + delta), 0, Math.max(0, duration - length));
  layer.inP = inP;
  layer.outP = round3(inP + length);
}

/** Trim one edge. `ripple` moves every later layer's in/out by the same amount when the out edge moves. */
export function trimLayerEdge(doc: EditorDoc, id: string, edge: "in" | "out", to: number, duration: number, ripple: boolean): void {
  const layer = byId(doc, id);
  if (!layer) return;
  const t = snapToFrame(to);
  if (edge === "in") layer.inP = clamp(t, 0, layer.outP - MIN_LAYER_SECONDS);
  else {
    const previous = layer.outP;
    layer.outP = clamp(t, layer.inP + MIN_LAYER_SECONDS, duration);
    if (ripple) {
      const delta = layer.outP - previous;
      for (const other of doc.layers) if (other.id !== id && other.inP >= previous - 1e-6) { other.inP = round3(other.inP + delta); other.outP = round3(other.outP + delta); }
    }
  }
}

// ---- keyframes

const cloneValue = (v: PropValue): PropValue => (Array.isArray(v) ? [...v] : v);

/** The stopwatch. Turning it on makes a key at `t`; turning it off bakes the value at `t` and drops the keys. */
export function toggleStopwatch(layer: Layer, prop: string, t: number): void {
  if (layer.keys[prop]?.length) {
    (layer as unknown as Record<string, PropValue>)[prop] = cloneValue(valueAt(layer, prop, t));
    delete layer.keys[prop];
  } else {
    layer.keys[prop] = [{ t: snapToFrame(t), v: cloneValue(valueAt(layer, prop, t)), o: 33, i: 33, lin: true }];
  }
}

export function addKeyAt(layer: Layer, prop: string, t: number): void {
  const keys = (layer.keys[prop] ??= []);
  const at = snapToFrame(t);
  if (keys.some((k) => Math.abs(k.t - at) < 1e-6)) return;
  keys.push({ t: at, v: cloneValue(valueAt(layer, prop, at)), o: 33, i: 33, lin: true });
  keys.sort((a, b) => a.t - b.t);
}

export function deleteKey(layer: Layer, prop: string, t: number): void {
  const keys = layer.keys[prop];
  if (!keys) return;
  const rest = keys.filter((k) => Math.abs(k.t - t) > 1e-6);
  if (rest.length === keys.length) return;
  if (rest.length) layer.keys[prop] = rest;
  else toggleStopwatch(layer, prop, t); // last key removed: bake it so the value does not jump
}

/** Time of the previous (-1) or next (+1) key relative to `t`, or null. */
export function neighbourKey(layer: Layer, prop: string, t: number, dir: -1 | 1): number | null {
  const times = (layer.keys[prop] ?? []).map((k) => k.t);
  const hit = dir > 0 ? times.find((x) => x > t + 1e-6) : [...times].reverse().find((x) => x < t - 1e-6);
  return hit ?? null;
}

export function moveKey(layer: Layer, prop: string, fromT: number, toT: number, copy = false): void {
  const keys = layer.keys[prop];
  const key = keys?.find((k) => Math.abs(k.t - fromT) < 1e-6);
  if (!keys || !key) return;
  const to = snapToFrame(toT);
  const clash = keys.find((k) => k !== key && Math.abs(k.t - to) < 1e-6);
  if (clash) keys.splice(keys.indexOf(clash), 1);
  if (copy) keys.push({ ...key, v: cloneValue(key.v), t: to });
  else key.t = to;
  keys.sort((a, b) => a.t - b.t);
}

export function setKeyEase(layer: Layer, prop: string, times: readonly number[], ease: Pick<Keyframe, "lin" | "o" | "i">): void {
  for (const k of layer.keys[prop] ?? []) if (times.some((t) => Math.abs(t - k.t) < 1e-6)) Object.assign(k, ease);
}

// ---- effects

export function addEffect(layer: Layer, name: string): string {
  const fx = makeEffect(name);
  layer.effects.unshift(fx);
  return fx.id;
}

export function removeEffect(layer: Layer, id: string): void { layer.effects = layer.effects.filter((f) => f.id !== id); }

export function moveEffect(layer: Layer, id: string, beforeId: string | null): void {
  const from = layer.effects.findIndex((f) => f.id === id);
  if (from < 0 || id === beforeId) return;
  const [fx] = layer.effects.splice(from, 1);
  const to = beforeId === null ? layer.effects.length : layer.effects.findIndex((f) => f.id === beforeId);
  layer.effects.splice(to < 0 ? layer.effects.length : to, 0, fx!);
}

// ---- presets

const easeKey = (t: number, v: PropValue): Keyframe => ({ t: snapToFrame(t), v, o: 33, i: 33, lin: false });

/** Animation presets dropped on a layer row. Keys start at `t` (the playhead). */
export function applyPreset(layer: Layer, name: string, t: number): boolean {
  const at = Math.max(layer.inP, t);
  switch (name) {
    case "Rise in":
      layer.keys.pos = [easeKey(at, [layer.pos[0]!, layer.pos[1]! + 60]), easeKey(at + 0.5, [...layer.pos])];
      layer.keys.opacity = [easeKey(at, 0), easeKey(at + 0.5, layer.opacity)];
      return true;
    case "Fade in":
      layer.keys.opacity = [easeKey(at, 0), easeKey(at + 0.4, layer.opacity)];
      return true;
    case "Pop scale":
      layer.keys.scale = [easeKey(at, [layer.scale[0]! * 0.6, layer.scale[1]! * 0.6]), easeKey(at + 0.4, [...layer.scale])];
      return true;
    case "Blur reveal": {
      layer.keys.opacity = [easeKey(at, 0), easeKey(at + 0.5, layer.opacity)];
      if (!layer.effects.some((f) => f.name === "Gaussian blur")) addEffect(layer, "Gaussian blur");
      return true;
    }
    default:
      return false;
  }
}

// ---- several keyframes at once

type KeyRef = { id: string; prop: string; t: number };

/**
 * Move every key in `refs` by the same `delta` seconds, or copy them there. The group stops at the ends of the composition
 * as a unit, so keys keep their spacing. A key landing on an unselected key replaces it. Returns where the keys ended up.
 */
export function moveKeys(doc: EditorDoc, refs: readonly KeyRef[], delta: number, duration: number, copy = false): KeyRef[] {
  if (!refs.length) return [];
  const lo = Math.min(...refs.map((r) => r.t));
  const hi = Math.max(...refs.map((r) => r.t));
  const shift = clamp(delta, -lo, Math.max(0, duration - hi));
  const landed = (t: number) => clamp(snapToFrame(t + shift), 0, duration);
  const groups = new Map<string, KeyRef[]>();
  for (const r of refs) groups.set(`${r.id}\u0000${r.prop}`, [...(groups.get(`${r.id}\u0000${r.prop}`) ?? []), r]);
  for (const group of groups.values()) {
    const layer = byId(doc, group[0]!.id);
    const keys = layer?.keys[group[0]!.prop];
    if (!layer || !keys) continue;
    const moving = group.map((r) => ({ r, key: keys.find((k) => Math.abs(k.t - r.t) < 1e-6) })).filter((m): m is { r: KeyRef; key: Keyframe } => Boolean(m.key));
    const dests = moving.map((m) => landed(m.r.t));
    const movingKeys = new Set(moving.map((m) => m.key));
    const clash = (k: Keyframe) => dests.some((t) => Math.abs(t - k.t) < 1e-6);
    let kept = keys.filter((k) => (copy ? !clash(k) : movingKeys.has(k) || !clash(k)));
    if (copy) kept = [...kept, ...moving.map((m, i) => ({ ...m.key, v: cloneValue(m.key.v), t: dests[i]! }))];
    else moving.forEach((m, i) => { m.key.t = dests[i]!; });
    layer.keys[group[0]!.prop] = kept.sort((a, b) => a.t - b.t);
  }
  return refs.map((r) => ({ ...r, t: landed(r.t) }));
}

/** Delete every key in `refs`. The last key of a property is baked into its value (see deleteKey). */
export function deleteKeys(doc: EditorDoc, refs: readonly KeyRef[]): number {
  let n = 0;
  for (const r of refs) {
    const layer = byId(doc, r.id);
    if (!layer?.keys[r.prop]?.some((k) => Math.abs(k.t - r.t) < 1e-6)) continue;
    deleteKey(layer, r.prop, r.t);
    n++;
  }
  return n;
}

/** Apply one easing to every key in `refs`. */
export function setKeysEase(doc: EditorDoc, refs: readonly KeyRef[], ease: Pick<Keyframe, "lin" | "o" | "i">): void {
  for (const r of refs) { const layer = byId(doc, r.id); if (layer) setKeyEase(layer, r.prop, [r.t], ease); }
}

/** Every key of the given layers, for "select all keyframes". */
export function allKeys(doc: EditorDoc, layerIds: readonly string[]): KeyRef[] {
  const out: KeyRef[] = [];
  for (const id of layerIds) { const layer = byId(doc, id); if (layer) for (const [prop, keys] of Object.entries(layer.keys)) for (const k of keys) out.push({ id, prop, t: k.t }); }
  return out;
}

/** Move several layer bars by the same amount. The group stops as a unit when one reaches an end, so spacing is kept. Locked layers stay. */
export function moveLayerBars(doc: EditorDoc, ids: readonly string[], delta: number, duration: number): void {
  const movable = doc.layers.filter((l) => ids.includes(l.id) && !l.lock);
  if (!movable.length) return;
  const lo = Math.min(...movable.map((l) => l.inP));
  const hi = Math.max(...movable.map((l) => l.outP));
  const shift = clamp(delta, -lo, Math.max(0, duration - hi));
  for (const l of movable) moveLayerBar(l, shift, duration);
}
