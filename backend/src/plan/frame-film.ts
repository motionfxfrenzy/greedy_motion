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
    frames[i]!.motion = directed.get(motionSignature(scene))?.motion ?? [];
  });
  return frames;
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
    .replace("</head>", () => `  <style id="frame-film-css">#stage, #captions { display: none !important; } #frame-film { position: absolute; inset: 0; background: ${ground}; } .ff-layer { position: absolute; inset: 0; } .ff-layer svg { display: block; width: 100%; height: 100%; }</style>\n</head>`)
    .replace('<div id="captions" data-layout-allow-overlap></div>', (tag) => `<div id="frame-film" data-layout-allow-overflow></div>\n    ${tag}`)
    .replace("</body>", () => `  <script id="ff-data" type="application/json">${data}</script>\n  <script id="ff-script">${script}</script>\n</body>`);
}
