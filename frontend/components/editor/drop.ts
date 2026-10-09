import { readClips } from "../../lib/editor/clips-model.ts";
import { appendToRoot, uniqueId } from "../../lib/editor/html-source.ts";
import type { Asset } from "../../lib/editor/fixtures.ts";
import * as ops from "../../lib/editor/ops.ts";
import { useEditor } from "../../lib/editor/store.ts";
import { snapToFrame } from "../../lib/editor/time.ts";
import { startDrag } from "./drag.ts";

export type DropPayload =
  | { kind: "asset"; asset: Asset }
  | { kind: "preset"; name: string }
  | { kind: "effect"; name: string };

export const SUPPORTED_TYPES = "PNG, JPEG, SVG, MP4, WAV, MP3, WOFF2";

const label = (p: DropPayload) => (p.kind === "asset" ? p.asset.name : p.name);
const hint = (p: DropPayload, target: string | null) => {
  if (!target) return "Drop on canvas, timeline or a layer";
  if (target === "canvas") return p.kind === "asset" ? "Drop on canvas · at pointer" : "Drop on a layer";
  if (target === "timeline") return "Drop on timeline · at time under pointer";
  return p.kind === "asset" ? "Drop to replace" : p.kind === "preset" ? "Drop to apply preset" : "Drop to add effect";
};

const targetAt = (x: number, y: number): { type: string; el: HTMLElement } | null => {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
  return el ? { type: el.dataset.drop!, el } : null;
};

/** Drag a library item with a ghost chip; highlights the drop target under the pointer and performs the drop. */
export function dragPayload(down: { clientX: number; clientY: number }, payload: DropPayload): void {
  const ghost = document.createElement("div");
  ghost.className = "ed-ghost";
  ghost.innerHTML = `<b></b><span></span>`;
  ghost.querySelector("b")!.textContent = label(payload);
  let lit: HTMLElement | null = null;
  startDrag(down, {
    onStart: () => document.body.appendChild(ghost),
    onMove: (_dx, _dy, e) => {
      ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      const t = targetAt(e.clientX, e.clientY);
      ghost.querySelector("span")!.textContent = hint(payload, t?.type ?? null);
      if (lit !== (t?.el ?? null)) { lit?.classList.remove("drop-on"); lit = t?.el ?? null; lit?.classList.add("drop-on"); }
    },
    onEnd: (e) => {
      const t = targetAt(e.clientX, e.clientY);
      cleanup();
      if (t) performDrop(payload, t.type, e.clientX, e.clientY, t.el);
    },
    onCancel: cleanup
  });
  function cleanup() { ghost.remove(); lit?.classList.remove("drop-on"); lit = null; }
}

export function performDrop(payload: DropPayload, target: string, x: number, y: number, el: HTMLElement): void {
  const s = useEditor.getState();
  if (target.startsWith("layer:")) {
    const id = target.slice(6);
    if (payload.kind === "preset") { s.edit(`Apply ${payload.name}`, (d) => { const l = d.layers.find((v) => v.id === id); if (l) ops.applyPreset(l, payload.name, s.t); }); s.say(`${payload.name} applied.`); }
    else if (payload.kind === "effect") { s.edit(`Add ${payload.name}`, (d) => { const l = d.layers.find((v) => v.id === id); if (l) ops.addEffect(l, payload.name); }); s.say(`${payload.name} added.`); }
    else if (payload.asset.thumb) { s.edit("Replace source", (d) => { const l = d.layers.find((v) => v.id === id); if (l) l.img = payload.asset.thumb; }); s.say("Source replaced."); }
    return;
  }
  if (payload.kind !== "asset") return s.say("Drop presets and effects on a layer.");
  const asset = payload.asset;
  if (asset.kind === "font") return s.say("Font added to the brand kit.");
  const rect = el.getBoundingClientRect();
  if (target === "canvas") {
    const scale = Number(el.dataset.scale ?? 1) || 1;
    const cx = Math.round((x - rect.left) / scale);
    const cy = Math.round((y - rect.top) / scale);
    return placeAsset(asset, s.t, { x: cx, y: cy });
  }
  if (target === "timeline") {
    const px = Number(el.dataset.px ?? 64) || 64;
    return placeAsset(asset, snapToFrame(Math.max(0, (x - rect.left) / px)), null);
  }
}

function placeAsset(asset: Asset, t: number, at: { x: number; y: number } | null): void {
  const s = useEditor.getState();
  const w = asset.w ?? 600;
  const h = asset.h ?? 200;
  if (s.mode === "clips") {
    const model = readClips(s.doc.html);
    const id = uniqueId(s.doc.html, asset.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "-"));
    const track = Math.max(-1, ...model.clips.map((c) => c.track)) + 1;
    const left = Math.round((at?.x ?? model.canvas.width / 2) - w / 2);
    const top = Math.round((at?.y ?? model.canvas.height / 2) - h / 2);
    const markup = asset.kind === "audio"
      ? `<audio id="${id}" src="${asset.name}" data-start="${t}" data-duration="8" data-track-index="${track}" data-volume="0"></audio>`
      : asset.kind === "video"
        ? `<video id="${id}" class="clip" src="${asset.name}" data-start="${t}" data-duration="4" data-track-index="${track}" style="left:${left}px; top:${top}px; width:${w}px" muted></video>`
        : `<img id="${id}" class="clip" src="${asset.thumb ?? asset.name}" data-start="${t}" data-duration="4" data-track-index="${track}" style="left:${left}px; top:${top}px; width:${w}px">`;
    s.edit(`Add ${asset.name}`, (d) => { d.html = appendToRoot(d.html, markup); });
    s.selectClip(id);
    return s.say(`${asset.name} added.`);
  }
  if (asset.kind === "audio") {
    let id = "";
    s.edit(`Add ${asset.name}`, (d) => { id = ops.addLayer(d, "audio", t, s.duration); const l = d.layers.find((v) => v.id === id)!; l.name = asset.name; l.inP = t; l.outP = Math.min(s.duration, t + 8); });
    s.ui({ sel: [id] });
    return s.say(`${asset.name} added to the audio track.`);
  }
  let id = "";
  s.edit(`Add ${asset.name}`, (d) => {
    id = ops.addLayer(d, "image", t, s.duration);
    const l = d.layers.find((v) => v.id === id)!;
    l.name = asset.name; l.img = asset.thumb; l.w = w; l.h = h;
    if (at) l.pos = [at.x, at.y];
  });
  s.ui({ sel: [id] });
  s.say(`${asset.name} added.`);
}
