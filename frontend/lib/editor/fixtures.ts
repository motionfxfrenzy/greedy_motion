/** Demo project for /editor/demo: the handoff prototype's data, with the HTML clips as a real composition. */
import type { Effect, EditorDoc, Layer, ReviewComment } from "./types.ts";

export const DEMO_DURATION = 12;
export const DEMO_CANVAS = { width: 1920, height: 1080 };

export const LABELS = { blue: "#168BFF", violet: "#8B5CF6", amber: "#D97706", green: "#16A34A", rose: "#E11D48", gray: "#A3ACB9" } as const;
export const LABEL_ORDER = Object.keys(LABELS) as (keyof typeof LABELS)[];

export const FX_LIB: Record<string, [string, number, string, number][]> = {
  "Glow": [["Radius", 24, "px", 1], ["Intensity", 1.2, "", 0.05]],
  "Gaussian blur": [["Blurriness", 6, "px", 0.5]],
  "Drop shadow": [["Distance", 14, "px", 1], ["Softness", 30, "px", 1], ["Opacity", 30, "%", 1]],
  "Gradient ramp": [["Start", 0, "%", 1], ["End", 100, "%", 1]],
  "Directional blur": [["Direction", 90, "°", 1], ["Length", 10, "px", 1]],
  "Curves": [["Contrast", 8, "%", 1]],
  "Fill": [["Opacity", 100, "%", 1]]
};
/** The range an effect parameter may take: percentages stay 0–100, sizes and lengths are never negative, angles are free. */
export function paramRange(effect: string, param: { n: string; u?: string }): { min?: number; max?: number } {
  if (effect === "Curves" && param.n === "Contrast") return { min: -100, max: 100 };
  if (param.u === "%") return { min: 0, max: 100 };
  if (param.u === "°") return {};
  return { min: 0 };
}
export const FX_FAVOURITES = ["Glow", "Drop shadow", "Gaussian blur"];
export const PRESETS = ["Rise in", "Fade in", "Pop scale", "Blur reveal"];
export const EASES = ["none", "power1.out", "power2.out", "power3.out", "power2.inOut", "expo.out"];
export const BRAND_COLORS = ["#0A6CFF", "#168BFF", "#0a0d12", "#535862", "#F4F8FD", "#FFFFFF", "#C2410C", "#16803C"];
export const BRAND_FONTS = ["Instrument Serif", "Plus Jakarta Sans", "DM Mono", "Inter"];
export const BLEND_MODES = ["Normal", "Multiply", "Screen", "Overlay", "Add"];

export type Asset = { id: string; name: string; meta: string; kind: "image" | "video" | "audio" | "font"; thumb?: string; w?: number; h?: number };
export const ASSETS: Asset[] = [
  { id: "logo", name: "gm-logo.png", meta: "2172 × 724 · PNG", kind: "image", thumb: "/assets/gm-logo.png", w: 600, h: 200 },
  { id: "shot", name: "dashboard.png", meta: "1600 × 900 · PNG", kind: "image", thumb: "/assets/templates/feature-spotlight.jpg", w: 960, h: 540 },
  { id: "demo", name: "product-demo.mp4", meta: "0:08 · H.264", kind: "video", thumb: "/assets/templates/product-launch.jpg", w: 960, h: 540 },
  { id: "music", name: "music-bed.wav", meta: "0:30 · 48 kHz", kind: "audio" },
  { id: "font", name: "Inter-SemiBold.woff2", meta: "Font", kind: "font" }
];
export const TEMPLATES: [string, string][] = [
  ["Product launch", "/assets/templates/product-launch.jpg"],
  ["Feature spotlight", "/assets/templates/feature-spotlight.jpg"],
  ["What's new", "/assets/templates/whats-new.jpg"],
  ["Stat highlight", "/assets/templates/stat-highlight.jpg"]
];

let uid = 0;
export const newId = (prefix: string) => `${prefix}${++uid}${Math.random().toString(36).slice(2, 5)}`;

export function makeEffect(name: string): Effect {
  const rows = FX_LIB[name];
  if (!rows) throw new Error(`Unknown effect: ${name}`);
  return { id: newId("fx"), name, on: true, open: true, params: rows.map(([n, v, u, st]) => ({ n, v, u, st })) };
}

export function makeLayer(over: Partial<Layer> & Pick<Layer, "id" | "name" | "type">): Layer {
  return { vis: true, lock: false, solo: false, inP: 0, outP: DEMO_DURATION, parent: null, pos: [960, 540], scale: [100, 100], rot: 0, ry: 0, opacity: 100, w: 0, h: 0, effects: [], keys: {}, threeD: false, label: "gray", blend: "Normal", ...over };
}

export const demoLayers = (): Layer[] => [
  makeLayer({ id: "cam", name: "Camera 1", type: "camera", zoom: 2667, dof: false }),
  makeLayer({ id: "light", name: "Key light", type: "light", label: "amber", intensity: 100, lcolor: "#FFFFFF" }),
  makeLayer({ id: "grade", name: "Grade", type: "adjustment", label: "green", effects: [makeEffect("Curves")] }),
  makeLayer({ id: "title", name: "Title", type: "text", label: "blue", pos: [540, 470], w: 820, h: 300, text: "Launch videos, built from your product.", font: "Instrument Serif", size: 104, fill: "#0a0d12" }),
  makeLayer({ id: "ui", name: "ui-layer-copy", type: "precomp", label: "violet", pos: [1360, 560], w: 880, h: 495, threeD: true, ry: -12, parent: "rig", inP: 0.3, img: "/assets/templates/feature-spotlight.jpg", src: "HyperFrames · transparent", keys: { opacity: [{ t: 0.3, v: 0, o: 0, i: 0, lin: true }, { t: 0.9, v: 100, o: 0, i: 0, lin: true }] } }),
  makeLayer({ id: "rig", name: "Card rig", type: "null", label: "violet", pos: [1360, 560] }),
  makeLayer({ id: "bg", name: "Background", type: "solid", color: "#F4F8FD", w: 1920, h: 1080 }),
  makeLayer({ id: "vo", name: "voiceover.wav", type: "audio", label: "green", inP: 0.4, outP: 9.6, vol: 0 }),
  makeLayer({ id: "music", name: "music-bed.wav", type: "audio", label: "green", inP: 0, outP: 12, vol: -12 })
];

/**
 * A real HyperFrames-style composition. Same structure the worker renders: a stage with data-width /
 * data-height, clips carrying data-start / data-duration / data-track-index, one paused GSAP timeline.
 */
export const DEMO_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #ffffff; }
  #stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #f4f8fd; font-family: Inter, Helvetica, Arial, sans-serif; }
  .clip { position: absolute; }
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1920" data-height="1080" data-duration="11.97">
  <div id="win" class="clip" data-start="0" data-duration="8" data-track-index="0" style="left:0; right:0; top:0; bottom:0; background:#ffffff"></div>
  <div id="ring" class="clip" data-start="1.2" data-duration="6.68" data-track-index="1" style="left:1150px; top:500px; width:120px; height:120px; border:8px solid #0A6CFF; border-radius:50%"></div>
  <div id="cursor" class="clip" data-start="1.35" data-duration="8" data-track-index="2" style="left:1190px; top:540px; width:36px; height:36px; background:#0a0d12; clip-path:polygon(0 0, 100% 62%, 56% 66%, 36% 100%)"></div>
  <div id="text1" class="clip" data-start="4.275" data-duration="3" data-track-index="3" style="left:0; right:0; top:454px; text-align:center; font:600 72px Inter,sans-serif; color:#000000">New text</div>
  <img id="demo" class="clip" src="/assets/templates/product-launch.jpg" data-start="8.2" data-duration="3.77" data-track-index="4" style="left:560px; top:290px; width:800px; border-radius:18px">
  <audio id="vo" src="voiceover.wav" data-start="0.6" data-duration="8.4" data-track-index="5" data-volume="0"></audio>
  <audio id="music" src="music-bed.wav" data-start="0" data-duration="11.97" data-track-index="6" data-volume="-12"></audio>
</div>
<script src="/editor/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#win", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, 0);
  tl.fromTo("#ring", { scale: 0.6 }, { scale: 1, duration: 0.5, ease: "power3.out" }, 1.2);
  tl.fromTo("#cursor", { x: -220 }, { x: 0, duration: 0.9, ease: "power2.inOut" }, 1.35);
  tl.fromTo("#demo", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 8.2);
  window.__timelines["main"] = tl;
</script>
</body>
</html>
`;

export const demoComments = (): ReviewComment[] => [
  { id: "c1", who: "Mara Chen", ini: "MC", at: 4.3, text: "Can the headline land a beat earlier?", resolved: false },
  { id: "c2", who: "You", ini: "OE", at: 9, text: "Swap this screenshot for the new dashboard.", resolved: false }
];

export function demoDoc(): EditorDoc {
  return { layers: demoLayers(), html: DEMO_HTML, markers: [{ t: 3, label: "Hook" }], workArea: [0, DEMO_DURATION], comments: demoComments(), vars: { headline: true, logo: true, accent: false } };
}

/** Deterministic pseudo-waveform (0..1) so the audio tracks look the same on every load. */
export function waveform(seed: string, bars: number): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
    const envelope = 0.55 + 0.45 * Math.sin(i / 7);
    return 0.18 + 0.82 * envelope * (((h >>> 0) % 1000) / 1000);
  });
}
