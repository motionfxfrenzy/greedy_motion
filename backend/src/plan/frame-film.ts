import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scriptFrameKey, type FrameMotion, type VideoProject } from "@videosaas/contracts";
import { filmScenes, motionSignature } from "./frame-motion.ts";
import { config } from "../config.ts";
import { cleanSvg } from "./frame-sketch.ts";
import type { PlanTiming } from "./timing.ts";

export type FilmFrame = { start: number; end: number; svg: string; motion: FrameMotion[] };

/**
 * The approved reference frames for a film written in the script canvas, one per beat on the film clock, or null when
 * any beat has none (the film then renders with the scene engine as before). The frames are what the person approved,
 * so when they exist the film animates them (worker/templates/frame-film) instead of drawing its own scenes.
 */
export function filmFrames(project: VideoProject, timing: PlanTiming): FilmFrame[] | null {
  const brief = project.brief;
  const plan = project.beatPlan;
  const script = brief?.scriptBeats;
  if (!brief || !plan || !script || script.length !== plan.beats.length || timing.beats.length !== plan.beats.length) return null;
  const saved = new Map((project.scriptFrames ?? []).map((frame) => [frame.key, frame.svg]));
  const frames: FilmFrame[] = [];
  for (const [i, beat] of script.entries()) {
    const svg = saved.get(scriptFrameKey(beat, brief));
    // Cleaned again here: the render page is the one place a frame is inlined rather than shown as an image.
    const clean = svg ? cleanSvg(svg) : null;
    if (!clean) return null;
    frames.push({ start: timing.beats[i]!.start, end: timing.beats[i]!.end, svg: clean, motion: [] });
  }
  // The motion directed at Render (frame-motion.ts) names elements by the ids it added, so the film uses those svgs.
  const directed = new Map((project.filmMotion ?? []).map((entry) => [entry.signature, entry]));
  filmScenes(project, timing, frames).forEach((scene, i) => {
    frames[i]!.svg = scene.svg;
    frames[i]!.motion = enrichMotion(scene.svg, scene.previous, directed.get(motionSignature(scene))?.motion ?? [], scene.seconds);
  });
  // After the motion lookup (its signature is of the unscoped svg): each frame gets its own gradients, filters and clips.
  frames.forEach((frame, i) => { frame.svg = scopeDefs(frame.svg, `f${i + 1}`); });
  return frames;
}


/**
 * The film puts every frame's SVG into one page, so an id used in two frames (bg-grad, card-shadow: models reuse the same names in
 * every frame) points at the FIRST frame's definition. When that frame is hidden, the gradient or filter it defines does not render, and
 * a fill or filter that resolves to it paints nothing: cards and panels go blank. Ids that are only the target of a url(#id) or
 * href="#id" reference (gradients, filters, clips, masks) are renamed per frame, with their references, so each frame uses its own.
 * Ids that elements are animated by (title, m1, cursor) are left alone: the directed motion names them.
 */
export function scopeDefs(svg: string, scope: string): string {
  const targets = new Set<string>();
  for (const m of svg.matchAll(/url\(\s*['"]?#([A-Za-z0-9_.:-]+)['"]?\s*\)/g)) targets.add(m[1]!);
  for (const m of svg.matchAll(/\b(?:xlink:)?href\s*=\s*["']#([A-Za-z0-9_.:-]+)["']/g)) targets.add(m[1]!);
  if (targets.size === 0) return svg;
  let out = svg;
  for (const id of targets) {
    const renamed = `${id}-${scope}`;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`(\\sid\\s*=\\s*)(["'])${escaped}\\2`, "g"), `$1$2${renamed}$2`)
      .replace(new RegExp(`url\\(\\s*(['"]?)#${escaped}\\1\\s*\\)`, "g"), `url(#${renamed})`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*)(["'])#${escaped}\\2`, "g"), `$1$2#${renamed}$2`);
  }
  return out;
}


const PLAIN_ID = /^(m\d+|bg|background|ground|backdrop|title|subtitle|caption(-\d+)?|cursor)$/i;
const DEF_ID = /(clip|grad|gradient|shadow|glow|filter|mask|pattern)(-f\d+)?$/i;
const ENTRANCES: Record<string, string>[] = [
  { opacity: "0", transform: "translate(0 18)" },
  { opacity: "0", transform: "translate(-30 0)" },
  { opacity: "0", transform: "translate(30 0)" },
  { opacity: "0", transform: "translate(0 22) scale(0.92)" }
];

/**
 * A safety net under the directed motion: pieces the director left out (named groups and shapes the frame has but no entry moves)
 * still arrive, one after another, sliding or popping in from varying directions instead of sitting there from the first frame.
 * Pieces that were already on screen in the previous scene are left alone (they are carried over, not new). Only data: the same
 * validated "move" entries the director writes, so the runtime plays them like any other.
 */
export function enrichMotion(svg: string, previous: string | null, motion: FrameMotion[], seconds: number): FrameMotion[] {
  if (motion.length >= 16 || seconds < 1.4) return motion;
  const body = (text: string) => text.replace(/<defs[\s\S]*?<\/defs>/gi, "");
  const named = (text: string) => [...body(text).matchAll(/<(?:g|rect|path|circle|ellipse|line|polyline|polygon|text)\b[^>]*?\sid="([^"]+)"/g)].map((m) => m[1]!).filter((id) => !PLAIN_ID.test(id) && !DEF_ID.test(id));
  const touched = new Set<string>();
  for (const entry of motion) { if (entry.kind === "sweep") entry.ids.forEach((id) => touched.add(id)); else touched.add(entry.id); }
  const before = new Set(previous ? [...previous.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!) : []);
  const fresh = [...new Set(named(svg))].filter((id) => !touched.has(id) && !before.has(id)).slice(0, Math.min(10, 20 - motion.length));
  if (fresh.length === 0) return motion;
  const window = Math.min(seconds * 0.5, 2);
  const step = Math.max(0.07, window / fresh.length);
  const extra: FrameMotion[] = fresh.map((id, k) => {
    const start = Math.min(seconds - 0.7, 0.15 + k * step);
    return { kind: "move", id, from: ENTRANCES[k % ENTRANCES.length]!, start: +start.toFixed(2), end: +Math.min(seconds - 0.2, start + 0.45).toFixed(2) };
  });
  return [...motion, ...extra];
}

/** A film about a topic (no product, site or brand kit) moves like a 3Blue1Brown explainer: unhurried, smooth, no hard cuts. */
export const filmFeel = (project: VideoProject): "explainer" | "default" =>
  !project.brief?.productName && !project.brief?.productUrl && !(project.brief?.brandId ?? project.request.brandId) ? "explainer" : "default";

/** Puts the frames and their animation into the engine page: same clock, voiceover and music; the frames replace its scenes. */
export async function withFrameFilm(html: string, frames: FilmFrame[], feel: "explainer" | "default" = "default"): Promise<string> {
  // Inlined in a <script> tag, so a "</script" anywhere in it (even a comment) would end the tag early.
  const script = (await readFile(join(config.templatesDir, "frame-film", "frame-film.js"), "utf8")).replace(/<\/script/gi, "<\\/script");
  const ground = /<rect[^>]*width="(?:100%|\d{3,})"[^>]*fill="(#[0-9a-fA-F]{3,8})"/.exec(frames[0]!.svg)?.[1] ?? "#0b0d12";
  const data = JSON.stringify({ feel, beats: frames }).replace(/</g, "\\u003c");
  return html
    .replace("</head>", () => `  <style id="frame-film-css">#stage { display: none !important; } #frame-film { position: absolute; inset: 0; background: ${ground}; } #captions { z-index: 20; pointer-events: none; } #captions .cap { top: 80%; bottom: auto; } #captions .cap span { background: rgba(12, 15, 22, 0.86); color: #f8fafc; border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38); } .ff-layer { position: absolute; inset: 0; } .ff-layer svg { display: block; width: 100%; height: 100%; }</style>\n</head>`)
    .replace('<div id="captions" data-layout-allow-overlap></div>', (tag) => `<div id="frame-film" data-layout-allow-overflow></div>\n    ${tag}`)
    .replace("</body>", () => `  <script id="ff-data" type="application/json">${data}</script>\n  <script id="ff-script">${script}</script>\n</body>`);
}
